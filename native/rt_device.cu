#include <optix.h>
#include <cuda_runtime.h>
#include <math_constants.h>
#include "rt_shared.h"

extern "C" {
__constant__ UniverseLaunchParams params;
}

extern "C" __global__ void __raygen__universe() {
    const uint32_t i = optixGetLaunchIndex().x;
    if (i >= params.count) return;
    unsigned int id = 0xffffffffu;
    unsigned int distance = __float_as_uint(CUDART_INF_F);
    if (params.tmax[i] > 1e-5f) {
        optixTrace(params.handle, params.origins[i], params.directions[i],
                   1e-5f, params.tmax[i], 0.0f, OptixVisibilityMask(255),
                   OPTIX_RAY_FLAG_DISABLE_ANYHIT, 0, 1, 0, id, distance);
    }
    params.hit_ids[i] = static_cast<int32_t>(id);
    params.hit_distances[i] = __uint_as_float(distance);
}

extern "C" __global__ void __intersection__sphere() {
    const float4 s = params.spheres[optixGetPrimitiveIndex()];
    const float3 origin = optixGetObjectRayOrigin();
    const float3 direction = optixGetObjectRayDirection();
    // Double intermediates prevent catastrophic cancellation for small spheres
    // far from the camera. RTX traverses AABBs; this shader tests real surfaces.
    const double x = double(origin.x) - s.x;
    const double y = double(origin.y) - s.y;
    const double z = double(origin.z) - s.z;
    const double dx = direction.x, dy = direction.y, dz = direction.z;
    const double a = dx * dx + dy * dy + dz * dz;
    const double b = x * dx + y * dy + z * dz;
    const double cx = y * dz - z * dy;
    const double cy = z * dx - x * dz;
    const double cz = x * dy - y * dx;
    const double discriminant = a * double(s.w) * s.w -
                                (cx * cx + cy * cy + cz * cz);
    if (discriminant < 0.0) return;
    const double root = sqrt(discriminant);
    const double near_t = (-b - root) / a;
    const double far_t = (-b + root) / a;
    const double t = near_t > double(1e-5f) ? near_t : far_t;
    const float hit_t = float(t);
    if (t > double(1e-5f) && hit_t > 1e-5f &&
        t <= double(optixGetRayTmax())) {
        optixReportIntersection(hit_t, 0);
    }
}

extern "C" __global__ void __closesthit__sphere() {
    optixSetPayload_0(optixGetPrimitiveIndex());
    optixSetPayload_1(__float_as_uint(optixGetRayTmax()));
}

extern "C" __global__ void __miss__universe() {
    optixSetPayload_0(0xffffffffu);
    optixSetPayload_1(__float_as_uint(CUDART_INF_F));
}
