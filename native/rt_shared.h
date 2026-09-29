#pragma once

#include <optix.h>
#include <stdint.h>

// All coordinates must share one local, float32 coordinate system. Large-scale
// camera-relative origin rebasing belongs to the caller.
struct UniverseLaunchParams {
    OptixTraversableHandle handle;
    const float4* spheres;
    const float3* origins;
    const float3* directions;
    const float* tmax;
    int32_t* hit_ids;
    float* hit_distances;
    uint32_t count;
};
