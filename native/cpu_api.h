#ifndef COMPILEUNIVERSE_CPU_API_H
#define COMPILEUNIVERSE_CPU_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Return 0 on success, -1 on error; cu_cpu_error is thread-local.
 * A context is not safe to mutate or trace from multiple threads concurrently.
 * Ray vectors are interleaved XYZ float32 arrays. Directions must be nonzero;
 * unit directions make hit distances and tmax distances in world units.
 * Spheres are interleaved XYZR float32, with finite nonnegative radii.
 * tmax may be +infinity. A miss is (-1, +infinity).
 */
void* cu_cpu_create(const char* ignored);
int cu_cpu_set_spheres(void* ctx, const float* xyzw, uint32_t count);
int cu_cpu_trace(void* ctx, const float* origins, const float* directions,
                 const float* tmax, uint32_t count, int32_t* hit_ids,
                 float* hit_distances);
int cu_cpu_trace_brute(void* ctx, const float* origins, const float* directions,
                       const float* tmax, uint32_t count, int32_t* hit_ids,
                       float* hit_distances);
void cu_cpu_destroy(void* ctx);
const char* cu_cpu_error(void);
double cu_cpu_build_ms(void* ctx);
double cu_cpu_trace_ms(void* ctx);
uint64_t cu_cpu_sphere_tests(void* ctx);
uint64_t cu_cpu_node_tests(void* ctx);

#ifdef __cplusplus
}
#endif
#endif
