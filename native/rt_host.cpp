#include <cuda_runtime.h>
#include <optix.h>
#include <optix_stubs.h>
#include <optix_function_table_definition.h>
#include <optix_stack_size.h>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "rt_api.h"
#include "rt_shared.h"

namespace {
thread_local std::string last_error;

void check_cuda(cudaError_t code, const char* call) {
    if (code != cudaSuccess)
        throw std::runtime_error(std::string(call) + ": " + cudaGetErrorString(code));
}
void check_optix(OptixResult code, const char* call, const char* log = "") {
    if (code != OPTIX_SUCCESS)
        throw std::runtime_error(std::string(call) + ": " +
                                 optixGetErrorName(code) + " " + log);
}
#define CUDA_OK(call) check_cuda((call), #call)
#define OPTIX_OK(call) check_optix((call), #call)

struct Buffer {
    CUdeviceptr ptr = 0;
    size_t capacity = 0;
    ~Buffer() { if (ptr) cudaFree(reinterpret_cast<void*>(ptr)); }
    void reserve(size_t bytes) {
        if (bytes <= capacity) return;
        void* next = nullptr;
        CUDA_OK(cudaMalloc(&next, bytes));
        if (ptr) cudaFree(reinterpret_cast<void*>(ptr));
        ptr = reinterpret_cast<CUdeviceptr>(next);
        capacity = bytes;
    }
    void upload(const void* data, size_t bytes, cudaStream_t stream) {
        reserve(bytes);
        if (bytes) CUDA_OK(cudaMemcpyAsync(reinterpret_cast<void*>(ptr), data,
                                          bytes, cudaMemcpyHostToDevice, stream));
    }
};

struct alignas(OPTIX_SBT_RECORD_ALIGNMENT) SbtRecord {
    char header[OPTIX_SBT_RECORD_HEADER_SIZE];
};

struct Context {
    OptixDeviceContext optix = nullptr;
    OptixModule module = nullptr;
    OptixProgramGroup raygen = nullptr, miss = nullptr, hit = nullptr;
    OptixPipeline pipeline = nullptr;
    OptixShaderBindingTable sbt = {};
    OptixTraversableHandle handle = 0;
    cudaStream_t stream = nullptr;
    cudaEvent_t begin = nullptr, end = nullptr;
    Buffer rg_record, ms_record, hg_record, spheres, aabbs, scratch, gas;
    Buffer origins, directions, tmax, hit_ids, hit_distances, launch_params;
    uint32_t sphere_count = 0;
    double build_ms = 0.0, trace_ms = 0.0;

    ~Context() {
        if (stream) cudaStreamSynchronize(stream);
        if (pipeline) optixPipelineDestroy(pipeline);
        if (hit) optixProgramGroupDestroy(hit);
        if (miss) optixProgramGroupDestroy(miss);
        if (raygen) optixProgramGroupDestroy(raygen);
        if (module) optixModuleDestroy(module);
        if (optix) optixDeviceContextDestroy(optix);
        if (begin) cudaEventDestroy(begin);
        if (end) cudaEventDestroy(end);
        if (stream) cudaStreamDestroy(stream);
    }

    void initialize(const char* ptx_path) {
        if (!ptx_path || !*ptx_path) throw std::runtime_error("PTX path is empty");
        std::ifstream file(ptx_path, std::ios::binary);
        if (!file) throw std::runtime_error(std::string("Cannot open PTX: ") + ptx_path);
        std::ostringstream content;
        content << file.rdbuf();
        const std::string ptx = content.str();
        CUDA_OK(cudaFree(nullptr));
        CUDA_OK(cudaStreamCreate(&stream));
        CUDA_OK(cudaEventCreate(&begin));
        CUDA_OK(cudaEventCreate(&end));
        OPTIX_OK(optixInit());
        OptixDeviceContextOptions context_options = {};
        OPTIX_OK(optixDeviceContextCreate(nullptr, &context_options, &optix));
        OptixModuleCompileOptions compile = {};
        compile.maxRegisterCount = OPTIX_COMPILE_DEFAULT_MAX_REGISTER_COUNT;
        compile.optLevel = OPTIX_COMPILE_OPTIMIZATION_DEFAULT;
        compile.debugLevel = OPTIX_COMPILE_DEBUG_LEVEL_NONE;
        OptixPipelineCompileOptions pipeline_options = {};
        pipeline_options.traversableGraphFlags = OPTIX_TRAVERSABLE_GRAPH_FLAG_ALLOW_SINGLE_GAS;
        pipeline_options.numPayloadValues = 2;
        pipeline_options.numAttributeValues = 0;
        pipeline_options.exceptionFlags = OPTIX_EXCEPTION_FLAG_NONE;
        pipeline_options.pipelineLaunchParamsVariableName = "params";
        pipeline_options.usesPrimitiveTypeFlags = OPTIX_PRIMITIVE_TYPE_FLAGS_CUSTOM;
        char log[8192] = {};
        size_t log_size = sizeof(log);
        OptixResult result;
#if OPTIX_VERSION >= 70700
        result = optixModuleCreate(optix, &compile, &pipeline_options, ptx.data(),
                                   ptx.size(), log, &log_size, &module);
#else
        result = optixModuleCreateFromPTX(optix, &compile, &pipeline_options, ptx.data(),
                                          ptx.size(), log, &log_size, &module);
#endif
        check_optix(result, "Create OptiX module", log);

        OptixProgramGroupOptions group_options = {};
        auto create_group = [&](OptixProgramGroupDesc& desc, OptixProgramGroup& group) {
            log_size = sizeof(log); log[0] = 0;
            const auto status = optixProgramGroupCreate(optix, &desc, 1, &group_options,
                                                        log, &log_size, &group);
            check_optix(status, "Create OptiX program group", log);
        };
        OptixProgramGroupDesc desc = {};
        desc.kind = OPTIX_PROGRAM_GROUP_KIND_RAYGEN;
        desc.raygen.module = module;
        desc.raygen.entryFunctionName = "__raygen__universe";
        create_group(desc, raygen);
        desc = {};
        desc.kind = OPTIX_PROGRAM_GROUP_KIND_MISS;
        desc.miss.module = module;
        desc.miss.entryFunctionName = "__miss__universe";
        create_group(desc, miss);
        desc = {};
        desc.kind = OPTIX_PROGRAM_GROUP_KIND_HITGROUP;
        desc.hitgroup.moduleIS = module;
        desc.hitgroup.entryFunctionNameIS = "__intersection__sphere";
        desc.hitgroup.moduleCH = module;
        desc.hitgroup.entryFunctionNameCH = "__closesthit__sphere";
        create_group(desc, hit);

        OptixProgramGroup groups[] = {raygen, miss, hit};
        OptixPipelineLinkOptions link = {};
        link.maxTraceDepth = 1;
        log_size = sizeof(log); log[0] = 0;
        result = optixPipelineCreate(optix, &pipeline_options, &link, groups, 3,
                                     log, &log_size, &pipeline);
        check_optix(result, "Create OptiX pipeline", log);
        OptixStackSizes stack = {};
        for (const auto group : groups) {
#if OPTIX_VERSION >= 70700
            OPTIX_OK(optixUtilAccumulateStackSizes(group, &stack, pipeline));
#else
            OPTIX_OK(optixUtilAccumulateStackSizes(group, &stack));
#endif
        }
        unsigned int direct_traversal = 0, direct_state = 0, continuation = 0;
        OPTIX_OK(optixUtilComputeStackSizes(&stack, 1, 0, 0, &direct_traversal,
                                            &direct_state, &continuation));
        OPTIX_OK(optixPipelineSetStackSize(pipeline, direct_traversal, direct_state,
                                           continuation, 1));
        SbtRecord record = {};
        OPTIX_OK(optixSbtRecordPackHeader(raygen, &record));
        rg_record.upload(&record, sizeof(record), stream);
        CUDA_OK(cudaStreamSynchronize(stream));
        OPTIX_OK(optixSbtRecordPackHeader(miss, &record));
        ms_record.upload(&record, sizeof(record), stream);
        CUDA_OK(cudaStreamSynchronize(stream));
        OPTIX_OK(optixSbtRecordPackHeader(hit, &record));
        hg_record.upload(&record, sizeof(record), stream);
        CUDA_OK(cudaStreamSynchronize(stream));
        sbt.raygenRecord = rg_record.ptr;
        sbt.missRecordBase = ms_record.ptr;
        sbt.missRecordStrideInBytes = sizeof(record);
        sbt.missRecordCount = 1;
        sbt.hitgroupRecordBase = hg_record.ptr;
        sbt.hitgroupRecordStrideInBytes = sizeof(record);
        sbt.hitgroupRecordCount = 1;
    }

    double finish_timing() {
        CUDA_OK(cudaEventRecord(end, stream));
        CUDA_OK(cudaEventSynchronize(end));
        float milliseconds = 0;
        CUDA_OK(cudaEventElapsedTime(&milliseconds, begin, end));
        return milliseconds;
    }

    void set_spheres(const float* xyzw, uint32_t count) {
        build_ms = 0;
        if (!count) { sphere_count = 0; handle = 0; return; }
        if (!xyzw) throw std::runtime_error("Sphere array is null");
        if (count > uint32_t(std::numeric_limits<int32_t>::max()))
            throw std::runtime_error("Sphere count exceeds int32 primitive ids");
        std::vector<OptixAabb> boxes(count);
        for (uint32_t i = 0; i < count; ++i) {
            const float* p = xyzw + size_t(i) * 4;
            if (!std::isfinite(p[0]) || !std::isfinite(p[1]) ||
                !std::isfinite(p[2]) || !std::isfinite(p[3]) || p[3] <= 0)
                throw std::runtime_error("Sphere coordinates/radius must be finite with radius > 0");
            // Round outwards so float AABB rounding never excludes the surface.
            const float inf = std::numeric_limits<float>::infinity();
            boxes[i] = {std::nextafter(p[0] - p[3], -inf),
                        std::nextafter(p[1] - p[3], -inf),
                        std::nextafter(p[2] - p[3], -inf),
                        std::nextafter(p[0] + p[3], inf),
                        std::nextafter(p[1] + p[3], inf),
                        std::nextafter(p[2] + p[3], inf)};
            if (!std::isfinite(boxes[i].minX) || !std::isfinite(boxes[i].minY) ||
                !std::isfinite(boxes[i].minZ) || !std::isfinite(boxes[i].maxX) ||
                !std::isfinite(boxes[i].maxY) || !std::isfinite(boxes[i].maxZ))
                throw std::runtime_error("Sphere bounds overflow float32; use local coordinates");
        }
        // Once buffers change, an error leaves an empty scene, never stale GAS.
        sphere_count = 0; handle = 0;
        spheres.upload(xyzw, size_t(count) * sizeof(float4), stream);
        aabbs.upload(boxes.data(), boxes.size() * sizeof(OptixAabb), stream);
        unsigned int flags = OPTIX_GEOMETRY_FLAG_DISABLE_ANYHIT;
        OptixBuildInput input = {};
        input.type = OPTIX_BUILD_INPUT_TYPE_CUSTOM_PRIMITIVES;
        input.customPrimitiveArray.aabbBuffers = &aabbs.ptr;
        input.customPrimitiveArray.numPrimitives = count;
        input.customPrimitiveArray.flags = &flags;
        input.customPrimitiveArray.numSbtRecords = 1;
        OptixAccelBuildOptions options = {};
        options.buildFlags = OPTIX_BUILD_FLAG_PREFER_FAST_TRACE;
        options.operation = OPTIX_BUILD_OPERATION_BUILD;
        OptixAccelBufferSizes sizes = {};
        OPTIX_OK(optixAccelComputeMemoryUsage(optix, &options, &input, 1, &sizes));
        scratch.reserve(sizes.tempSizeInBytes);
        gas.reserve(sizes.outputSizeInBytes);
        CUDA_OK(cudaEventRecord(begin, stream));
        OPTIX_OK(optixAccelBuild(optix, stream, &options, &input, 1, scratch.ptr,
                                 sizes.tempSizeInBytes, gas.ptr, sizes.outputSizeInBytes,
                                 &handle, nullptr, 0));
        build_ms = finish_timing();
        sphere_count = count;
    }

    void trace(const float* ray_origins, const float* ray_directions,
               const float* ray_tmax, uint32_t count, int32_t* ids, float* distances) {
        trace_ms = 0;
        if (!count) return;
        if (!ray_origins || !ray_directions || !ray_tmax || !ids || !distances)
            throw std::runtime_error("A ray input/output array is null");
        for (uint32_t i = 0; i < count; ++i) {
            const float* o = ray_origins + size_t(i) * 3;
            const float* d = ray_directions + size_t(i) * 3;
            if (!std::isfinite(o[0]) || !std::isfinite(o[1]) || !std::isfinite(o[2]) ||
                !std::isfinite(d[0]) || !std::isfinite(d[1]) || !std::isfinite(d[2]) ||
                (d[0] == 0 && d[1] == 0 && d[2] == 0) ||
                std::isnan(ray_tmax[i]) || ray_tmax[i] < 0)
                throw std::runtime_error("Invalid ray: finite origin/nonzero direction and tmax >= 0 required");
        }
        if (!sphere_count) {
            std::fill(ids, ids + count, -1);
            std::fill(distances, distances + count, std::numeric_limits<float>::infinity());
            return;
        }
        origins.upload(ray_origins, size_t(count) * sizeof(float3), stream);
        directions.upload(ray_directions, size_t(count) * sizeof(float3), stream);
        tmax.upload(ray_tmax, size_t(count) * sizeof(float), stream);
        hit_ids.reserve(size_t(count) * sizeof(int32_t));
        hit_distances.reserve(size_t(count) * sizeof(float));
        UniverseLaunchParams params = {};
        params.handle = handle;
        params.spheres = reinterpret_cast<const float4*>(spheres.ptr);
        params.origins = reinterpret_cast<const float3*>(origins.ptr);
        params.directions = reinterpret_cast<const float3*>(directions.ptr);
        params.tmax = reinterpret_cast<const float*>(tmax.ptr);
        params.hit_ids = reinterpret_cast<int32_t*>(hit_ids.ptr);
        params.hit_distances = reinterpret_cast<float*>(hit_distances.ptr);
        params.count = count;
        launch_params.upload(&params, sizeof(params), stream);
        CUDA_OK(cudaEventRecord(begin, stream));
        OPTIX_OK(optixLaunch(pipeline, stream, launch_params.ptr, sizeof(params),
                             &sbt, count, 1, 1));
        trace_ms = finish_timing();
        CUDA_OK(cudaMemcpyAsync(ids, reinterpret_cast<void*>(hit_ids.ptr),
                                size_t(count) * sizeof(int32_t), cudaMemcpyDeviceToHost, stream));
        CUDA_OK(cudaMemcpyAsync(distances, reinterpret_cast<void*>(hit_distances.ptr),
                                size_t(count) * sizeof(float), cudaMemcpyDeviceToHost, stream));
        CUDA_OK(cudaStreamSynchronize(stream));
    }
};

Context& checked(void* ptr) {
    if (!ptr) throw std::runtime_error("OptiX context is null");
    return *static_cast<Context*>(ptr);
}

template <typename F> int guarded(F&& call) noexcept {
    try { last_error.clear(); call(); return 0; }
    catch (const std::exception& error) { last_error = error.what(); return -1; }
    catch (...) { last_error = "Unknown native exception"; return -1; }
}
}

extern "C" void* cu_rt_create(const char* ptx_path) {
    void* out = nullptr;
    guarded([&] {
        auto context = std::make_unique<Context>();
        context->initialize(ptx_path);
        out = context.release();
    });
    return out;
}
extern "C" int cu_rt_set_spheres(void* ctx, const float* xyzw, uint32_t count) {
    return guarded([&] { checked(ctx).set_spheres(xyzw, count); });
}
extern "C" int cu_rt_trace(void* ctx, const float* origins, const float* directions,
                            const float* tmax, uint32_t count, int32_t* ids, float* distances) {
    return guarded([&] { checked(ctx).trace(origins, directions, tmax, count, ids, distances); });
}
extern "C" void cu_rt_destroy(void* ctx) { delete static_cast<Context*>(ctx); }
extern "C" const char* cu_rt_error() { return last_error.c_str(); }
extern "C" double cu_rt_build_ms(void* ctx) {
    double result = std::numeric_limits<double>::quiet_NaN();
    guarded([&] { result = checked(ctx).build_ms; });
    return result;
}
extern "C" double cu_rt_trace_ms(void* ctx) {
    double result = std::numeric_limits<double>::quiet_NaN();
    guarded([&] { result = checked(ctx).trace_ms; });
    return result;
}
