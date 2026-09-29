#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Synchronous calls; one context must not be used concurrently. All host arrays
// are contiguous float32. Directions must be nonzero (normally unit length),
// and distances are ray parameters. Errors return nullptr/-1 with thread-local
// diagnostic text available through cu_rt_error(); no C++ exception escapes.
void* cu_rt_create(const char* ptx_path);
int cu_rt_set_spheres(void* ctx, const float* xyzw, uint32_t count);
int cu_rt_trace(void* ctx, const float* origins, const float* directions,
                const float* tmax, uint32_t count, int32_t* hit_ids,
                float* hit_distances);
void cu_rt_destroy(void* ctx);
const char* cu_rt_error(void);

// CUDA-event durations. Build covers optixAccelBuild only; trace covers
// optixLaunch only. Both exclude allocations, host work and array transfers.
// Empty geometry / query batches report zero. Invalid contexts return NaN.
double cu_rt_build_ms(void* ctx);
double cu_rt_trace_ms(void* ctx);

#ifdef __cplusplus
}
#endif
