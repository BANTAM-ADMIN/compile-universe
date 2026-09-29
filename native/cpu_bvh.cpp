#include "cpu_api.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <exception>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using Clock = std::chrono::steady_clock;
constexpr double kMinT = 1.0e-5;
constexpr double kInfinity = std::numeric_limits<double>::infinity();
thread_local std::string last_error;

struct Sphere {
    std::array<double, 3> center;
    double radius;
};

struct Bounds {
    std::array<double, 3> lo{kInfinity, kInfinity, kInfinity};
    std::array<double, 3> hi{-kInfinity, -kInfinity, -kInfinity};

    void add(const Sphere& sphere) {
        for (int axis = 0; axis < 3; ++axis) {
            // Round outward so a tangency cannot be lost at the BVH boundary.
            lo[axis] = std::min(lo[axis], std::nextafter(
                sphere.center[axis] - sphere.radius, -kInfinity));
            hi[axis] = std::max(hi[axis], std::nextafter(
                sphere.center[axis] + sphere.radius, kInfinity));
        }
    }
};

struct Node {
    Bounds bounds;
    uint32_t left = 0;
    uint32_t right = 0;
    uint32_t start = 0;
    uint32_t count = 0;
};

struct Context {
    std::vector<Sphere> spheres;
    std::vector<uint32_t> order;
    std::vector<Node> nodes;
    double build_ms = 0;
    double trace_ms = 0;
    uint64_t sphere_tests = 0;
    uint64_t node_tests = 0;

    uint32_t build(uint32_t begin, uint32_t end) {
        const uint32_t node_id = static_cast<uint32_t>(nodes.size());
        nodes.emplace_back();
        Bounds bounds;
        std::array<double, 3> low{kInfinity, kInfinity, kInfinity};
        std::array<double, 3> high{-kInfinity, -kInfinity, -kInfinity};
        for (uint32_t i = begin; i < end; ++i) {
            const Sphere& sphere = spheres[order[i]];
            bounds.add(sphere);
            for (int axis = 0; axis < 3; ++axis) {
                low[axis] = std::min(low[axis], sphere.center[axis]);
                high[axis] = std::max(high[axis], sphere.center[axis]);
            }
        }
        nodes[node_id].bounds = bounds;
        if (end - begin <= 4) {
            nodes[node_id].start = begin;
            nodes[node_id].count = end - begin;
            return node_id;
        }
        int axis = 0;
        for (int candidate = 1; candidate < 3; ++candidate) {
            if (high[candidate] - low[candidate] > high[axis] - low[axis])
                axis = candidate;
        }
        const uint32_t middle = begin + (end - begin) / 2;
        std::nth_element(order.begin() + begin, order.begin() + middle,
                         order.begin() + end, [&](uint32_t a, uint32_t b) {
            const double x = spheres[a].center[axis];
            const double y = spheres[b].center[axis];
            return x < y || (x == y && a < b);
        });
        const uint32_t left = build(begin, middle);
        const uint32_t right = build(middle, end);
        nodes[node_id].left = left;
        nodes[node_id].right = right;
        return node_id;
    }
};

struct Ray {
    std::array<double, 3> origin;
    std::array<double, 3> direction;
    double length_squared;
};

bool box_hit(const Bounds& bounds, const Ray& ray, double maximum, double& near) {
    double low = kMinT;
    double high = maximum;
    for (int axis = 0; axis < 3; ++axis) {
        const double origin = ray.origin[axis];
        const double direction = ray.direction[axis];
        if (direction == 0) {
            // A parallel ray on a face is inside this slab. Avoid 0 * infinity.
            if (origin < bounds.lo[axis] || origin > bounds.hi[axis]) return false;
            continue;
        }
        double first = (bounds.lo[axis] - origin) / direction;
        double second = (bounds.hi[axis] - origin) / direction;
        if (first > second) std::swap(first, second);
        low = std::max(low, first);
        high = std::min(high, second);
        if (low > high) return false;
    }
    near = low;
    return true;
}

double sphere_hit(const Sphere& sphere, const Ray& ray, double maximum) {
    const double x = ray.origin[0] - sphere.center[0];
    const double y = ray.origin[1] - sphere.center[1];
    const double z = ray.origin[2] - sphere.center[2];
    const double dx = ray.direction[0];
    const double dy = ray.direction[1];
    const double dz = ray.direction[2];
    const double b = x * dx + y * dy + z * dz;
    // Equivalent to b*b-a*c, without subtracting two squared ray distances.
    // This retains small distant spheres and exact axis-aligned tangencies.
    const double cross_x = y * dz - z * dy;
    const double cross_y = z * dx - x * dz;
    const double cross_z = x * dy - y * dx;
    const double discriminant = ray.length_squared * sphere.radius * sphere.radius
        - (cross_x * cross_x + cross_y * cross_y + cross_z * cross_z);
    if (discriminant < 0) return kInfinity;
    const double root = std::sqrt(discriminant);
    double hit = (-b - root) / ray.length_squared;
    if (hit <= kMinT) hit = (-b + root) / ray.length_squared;
    if (hit <= kMinT || hit > maximum) return kInfinity;
    return hit;
}

void consider(Context& context, uint32_t sphere_id, const Ray& ray,
              double& best, int32_t& id) {
    ++context.sphere_tests;
    const double distance = sphere_hit(context.spheres[sphere_id], ray, best);
    if (std::isfinite(distance) &&
        (distance < best || (distance == best &&
          (id < 0 || sphere_id < static_cast<uint32_t>(id))))) {
        best = distance;
        id = static_cast<int32_t>(sphere_id);
    }
}

void trace_bvh(Context& context, const Ray& ray, double& best, int32_t& id) {
    if (context.nodes.empty()) return;
    double root_near;
    ++context.node_tests;
    if (!box_hit(context.nodes[0].bounds, ray, best, root_near)) return;
    struct Entry { uint32_t id; double near; };
    // Median splitting and uint32_t primitive counts bound tree depth to 32.
    std::array<Entry, 64> stack;
    size_t size = 0;
    stack[size++] = {0, root_near};
    while (size) {
        const Entry entry = stack[--size];
        if (entry.near > best) continue;
        const Node& node = context.nodes[entry.id];
        if (node.count) {
            for (uint32_t i = 0; i < node.count; ++i)
                consider(context, context.order[node.start + i], ray, best, id);
            continue;
        }
        double left_near, right_near;
        context.node_tests += 2;
        const bool left = box_hit(context.nodes[node.left].bounds, ray, best, left_near);
        const bool right = box_hit(context.nodes[node.right].bounds, ray, best, right_near);
        if (left && right) {
            if (left_near <= right_near) {
                stack[size++] = {node.right, right_near};
                stack[size++] = {node.left, left_near};
            } else {
                stack[size++] = {node.left, left_near};
                stack[size++] = {node.right, right_near};
            }
        } else if (left) {
            stack[size++] = {node.left, left_near};
        } else if (right) {
            stack[size++] = {node.right, right_near};
        }
    }
}

Context& require_context(void* opaque) {
    if (!opaque) throw std::invalid_argument("null CPU context");
    return *static_cast<Context*>(opaque);
}

template<class Function>
int protect(Function&& function) {
    try {
        last_error.clear();
        function();
        return 0;
    } catch (const std::exception& error) {
        last_error = error.what();
    } catch (...) {
        last_error = "unknown CPU backend error";
    }
    return -1;
}

int trace(void* opaque, const float* origins, const float* directions,
          const float* tmax, uint32_t count, int32_t* hit_ids,
          float* hit_distances, bool brute) {
    return protect([&] {
        Context& context = require_context(opaque);
        if (count && (!origins || !directions || !tmax || !hit_ids || !hit_distances))
            throw std::invalid_argument("null nonempty ray/output array");
        context.sphere_tests = 0;
        context.node_tests = 0;
        const auto start = Clock::now();
        for (uint32_t i = 0; i < count; ++i) {
            hit_ids[i] = -1;
            hit_distances[i] = std::numeric_limits<float>::infinity();
        }
        // Validate the entire batch before producing any partial hit results.
        for (uint32_t i = 0; i < count; ++i) {
            const size_t offset = static_cast<size_t>(i) * 3;
            double squared = 0;
            for (int axis = 0; axis < 3; ++axis) {
                if (!std::isfinite(origins[offset + axis]) ||
                    !std::isfinite(directions[offset + axis]))
                    throw std::invalid_argument("ray contains nonfinite coordinates");
                const double d = directions[offset + axis];
                squared += d * d;
            }
            if (squared == 0 || std::isnan(tmax[i]) || tmax[i] < 0)
                throw std::invalid_argument("ray direction is zero or tmax is invalid");
        }
        for (uint32_t i = 0; i < count; ++i) {
            const size_t offset = static_cast<size_t>(i) * 3;
            Ray ray;
            ray.length_squared = 0;
            for (int axis = 0; axis < 3; ++axis) {
                ray.origin[axis] = origins[offset + axis];
                ray.direction[axis] = directions[offset + axis];
                ray.length_squared += ray.direction[axis] * ray.direction[axis];
            }
            double best = tmax[i];
            int32_t id = -1;
            if (best > kMinT) {
                if (brute) {
                    for (uint32_t j = 0; j < context.spheres.size(); ++j)
                        consider(context, j, ray, best, id);
                } else {
                    trace_bvh(context, ray, best, id);
                }
            }
            if (id >= 0) {
                hit_ids[i] = id;
                hit_distances[i] = static_cast<float>(best);
            }
        }
        context.trace_ms = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
    });
}
}  // namespace

extern "C" {
void* cu_cpu_create(const char*) {
    Context* context = nullptr;
    protect([&] { context = new Context; });
    return context;
}

int cu_cpu_set_spheres(void* opaque, const float* xyzw, uint32_t count) {
    return protect([&] {
        Context& destination = require_context(opaque);
        if (count && !xyzw) throw std::invalid_argument("null nonempty sphere array");
        if (count > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()))
            throw std::invalid_argument("sphere count exceeds signed hit ID range");
        const auto start = Clock::now();
        Context next;
        next.spheres.reserve(count);
        for (uint32_t i = 0; i < count; ++i) {
            const size_t offset = static_cast<size_t>(i) * 4;
            for (int axis = 0; axis < 4; ++axis)
                if (!std::isfinite(xyzw[offset + axis]))
                    throw std::invalid_argument("sphere contains nonfinite coordinates");
            if (xyzw[offset + 3] < 0)
                throw std::invalid_argument("sphere radius must be nonnegative");
            next.spheres.push_back({{xyzw[offset], xyzw[offset + 1], xyzw[offset + 2]},
                                    xyzw[offset + 3]});
        }
        next.order.resize(count);
        std::iota(next.order.begin(), next.order.end(), uint32_t{0});
        if (count) {
            next.nodes.reserve(static_cast<size_t>(count));
            next.build(0, count);
        }
        next.build_ms = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
        destination = std::move(next);
    });
}

int cu_cpu_trace(void* context, const float* origins, const float* directions,
                 const float* tmax, uint32_t count, int32_t* hit_ids,
                 float* hit_distances) {
    return trace(context, origins, directions, tmax, count, hit_ids, hit_distances, false);
}

int cu_cpu_trace_brute(void* context, const float* origins, const float* directions,
                       const float* tmax, uint32_t count, int32_t* hit_ids,
                       float* hit_distances) {
    return trace(context, origins, directions, tmax, count, hit_ids, hit_distances, true);
}

void cu_cpu_destroy(void* context) { delete static_cast<Context*>(context); }
const char* cu_cpu_error(void) { return last_error.c_str(); }
double cu_cpu_build_ms(void* context) { return context ? static_cast<Context*>(context)->build_ms : 0; }
double cu_cpu_trace_ms(void* context) { return context ? static_cast<Context*>(context)->trace_ms : 0; }
uint64_t cu_cpu_sphere_tests(void* context) { return context ? static_cast<Context*>(context)->sphere_tests : 0; }
uint64_t cu_cpu_node_tests(void* context) { return context ? static_cast<Context*>(context)->node_tests : 0; }
}
