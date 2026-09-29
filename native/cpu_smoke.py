#!/usr/bin/env python3
"""Geometry, empty-input and randomized BVH/reference checks for the CPU ABI."""
import ctypes as ct
from pathlib import Path

import numpy as np


def main() -> None:
    lib = ct.CDLL(str(Path(__file__).resolve().parent / "build/libuniverse_cpu.so"))
    fptr = ct.POINTER(ct.c_float)
    iptr = ct.POINTER(ct.c_int32)
    lib.cu_cpu_create.argtypes = [ct.c_char_p]
    lib.cu_cpu_create.restype = ct.c_void_p
    lib.cu_cpu_destroy.argtypes = [ct.c_void_p]
    lib.cu_cpu_set_spheres.argtypes = [ct.c_void_p, fptr, ct.c_uint32]
    lib.cu_cpu_error.restype = ct.c_char_p
    for name in ("cu_cpu_trace", "cu_cpu_trace_brute"):
        getattr(lib, name).argtypes = [ct.c_void_p, fptr, fptr, fptr, ct.c_uint32, iptr, fptr]
    for name in ("cu_cpu_sphere_tests", "cu_cpu_node_tests"):
        getattr(lib, name).argtypes = [ct.c_void_p]
        getattr(lib, name).restype = ct.c_uint64

    def check(code: int) -> None:
        assert code == 0, lib.cu_cpu_error().decode()

    def set_spheres(values):
        values = np.ascontiguousarray(values, dtype=np.float32).reshape(-1, 4)
        check(lib.cu_cpu_set_spheres(ctx, values.ctypes.data_as(fptr), len(values)))

    def trace(origins, directions, maximum=None, brute=False):
        origins = np.ascontiguousarray(origins, dtype=np.float32).reshape(-1, 3)
        directions = np.ascontiguousarray(directions, dtype=np.float32).reshape(-1, 3)
        assert len(origins) == len(directions)
        maximum = np.full(len(origins), np.inf, dtype=np.float32) if maximum is None else np.ascontiguousarray(maximum, dtype=np.float32)
        ids = np.empty(len(origins), dtype=np.int32)
        distances = np.empty(len(origins), dtype=np.float32)
        function = lib.cu_cpu_trace_brute if brute else lib.cu_cpu_trace
        check(function(ctx, origins.ctypes.data_as(fptr), directions.ctypes.data_as(fptr),
                       maximum.ctypes.data_as(fptr), len(origins), ids.ctypes.data_as(iptr),
                       distances.ctypes.data_as(fptr)))
        return ids, distances

    ctx = lib.cu_cpu_create(None)
    assert ctx, lib.cu_cpu_error().decode()
    try:
        check(lib.cu_cpu_set_spheres(ctx, None, 0))
        check(lib.cu_cpu_trace(ctx, None, None, None, 0, None, None))
        ids, distance = trace([[0, 0, 0]], [[0, 0, 1]])
        assert ids[0] == -1 and np.isinf(distance[0])

        # Duplicate spheres enforce deterministic smaller-ID ties.
        set_spheres([[0, 0, 5, 1], [0, 0, 5, 1], [10, 0, 5, 1],
                     [-10, 0, 5, 1], [0, 10, 5, 1], [0, -10, 5, 1]])
        origins = [[0, 0, 0], [0, 0, 5], [1, 0, 0], [1.001, 0, 0],
                   [0, 0, 0], [0, 0, 0], [0, 0, 6], [0, 0, 6], [0, 0, 0]]
        directions = [[0, 0, 1]] * 7 + [[0, 0, -1], [0, 0, -1]]
        maximum = [np.inf, np.inf, np.inf, np.inf, 4, 3.99, np.inf, np.inf, np.inf]
        expected_ids = np.array([0, 0, 0, -1, 0, -1, -1, 0, -1])
        expected_distance = [4, 1, 5, np.inf, 4, np.inf, np.inf, 2, np.inf]
        for brute in (False, True):
            ids, distance = trace(origins, directions, maximum, brute)
            np.testing.assert_array_equal(ids, expected_ids)
            np.testing.assert_allclose(distance, expected_distance, rtol=0, atol=1e-6)

        rng = np.random.default_rng(1409)
        spheres = np.column_stack((rng.uniform(-30, 30, (257, 3)), rng.uniform(0.05, 3, 257))).astype(np.float32)
        set_spheres(spheres)
        origins = rng.uniform(-40, 40, (4096, 3)).astype(np.float32)
        directions = rng.normal(size=(4096, 3))
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        directions = directions.astype(np.float32)
        maximum = rng.uniform(0, 100, 4096).astype(np.float32)
        ids, distance = trace(origins, directions, maximum)
        bvh_tests = lib.cu_cpu_sphere_tests(ctx)
        brute_ids, brute_distance = trace(origins, directions, maximum, brute=True)
        np.testing.assert_array_equal(ids, brute_ids)
        np.testing.assert_array_equal(distance, brute_distance)

        # Independent vectorized quadratic reference, using ordinary-scale data.
        offset = origins.astype(np.float64)[:, None, :] - spheres[None, :, :3].astype(np.float64)
        d = directions.astype(np.float64)
        a = np.sum(d * d, axis=1)[:, None]
        half_b = np.sum(offset * d[:, None, :], axis=2)
        c = np.sum(offset * offset, axis=2) - spheres[None, :, 3].astype(np.float64) ** 2
        discriminant = half_b ** 2 - a * c
        root = np.sqrt(np.maximum(discriminant, 0))
        near = (-half_b - root) / a
        far = (-half_b + root) / a
        hits = np.where(near > 1e-5, near, far)
        hits[(discriminant < 0) | (hits <= 1e-5) | (hits > maximum[:, None])] = np.inf
        reference_id = np.argmin(hits, axis=1)
        reference_distance = hits[np.arange(len(origins)), reference_id]
        reference_id[~np.isfinite(reference_distance)] = -1
        np.testing.assert_array_equal(ids, reference_id)
        np.testing.assert_allclose(distance, reference_distance, rtol=2e-6, atol=2e-6)
        print(f"CPU geometry checks passed: 4096 rays × 257 spheres; BVH {bvh_tests:,} sphere tests vs brute {4096*257:,}.")
    finally:
        lib.cu_cpu_destroy(ctx)


if __name__ == "__main__":
    main()
