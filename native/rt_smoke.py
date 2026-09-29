#!/usr/bin/env python3
"""Check native RT sphere hits against analytic cases and a float64 reference.

Requires NumPy, an RTX GPU/driver, and a completed native/build_rt.py build.
This uses ctypes directly so it independently checks the native ABI.
"""
import ctypes as ct
from pathlib import Path
import time

import numpy as np


def main():
    build = Path(__file__).resolve().parent / "build"
    lib = ct.CDLL(str(build / "libuniverse_rt.so"))
    fp = ct.POINTER(ct.c_float)
    ip = ct.POINTER(ct.c_int32)
    lib.cu_rt_create.argtypes = [ct.c_char_p]
    lib.cu_rt_create.restype = ct.c_void_p
    lib.cu_rt_set_spheres.argtypes = [ct.c_void_p, fp, ct.c_uint32]
    lib.cu_rt_trace.argtypes = [ct.c_void_p, fp, fp, fp, ct.c_uint32, ip, fp]
    lib.cu_rt_destroy.argtypes = [ct.c_void_p]
    lib.cu_rt_error.restype = ct.c_char_p
    for name in ("cu_rt_build_ms", "cu_rt_trace_ms"):
        getattr(lib, name).argtypes = [ct.c_void_p]
        getattr(lib, name).restype = ct.c_double
    ptr = lambda data: data.ctypes.data_as(fp)

    def check(code):
        assert code == 0, lib.cu_rt_error().decode()

    assert not lib.cu_rt_create(b"/nonexistent/compileuniverse.ptx")
    assert b"Cannot open PTX" in lib.cu_rt_error()
    start = time.perf_counter()
    ctx = lib.cu_rt_create(str(build / "rt_device.ptx").encode())
    assert ctx, lib.cu_rt_error().decode()
    init_ms = (time.perf_counter() - start) * 1000

    def scene(spheres):
        spheres = np.ascontiguousarray(spheres, dtype=np.float32).reshape(-1, 4)
        check(lib.cu_rt_set_spheres(ctx, ptr(spheres), len(spheres)))

    def trace(origins, directions, maximum):
        origins = np.ascontiguousarray(origins, dtype=np.float32).reshape(-1, 3)
        directions = np.ascontiguousarray(directions, dtype=np.float32).reshape(-1, 3)
        maximum = np.broadcast_to(maximum, (len(origins),)).astype(np.float32)
        ids, distances = np.empty(len(origins), np.int32), np.empty(len(origins), np.float32)
        check(lib.cu_rt_trace(ctx, ptr(origins), ptr(directions), ptr(maximum), len(origins),
                             ids.ctypes.data_as(ip), ptr(distances)))
        return ids, distances

    try:
        scene([[0, 0, 0, 1], [0, 0, 5, 1]])
        # Exact surface hits, AABB false positive, inside exit, clipping,
        # inclusive tmax, second primitive, and tangent.
        origins = [[0, 0, -3], [.9, .9, -3], [0, 0, 0], [0, 0, -3],
                   [0, 0, -3], [0, 0, 3], [1, 0, -3]]
        ids, distances = trace(origins, [[0, 0, 1]] * len(origins),
                               [np.inf, np.inf, np.inf, 1, 2, np.inf, np.inf])
        np.testing.assert_array_equal(ids, [0, -1, 0, -1, 0, 1, 0])
        np.testing.assert_allclose(distances, [2, np.inf, 1, np.inf, 2, 1, 3])
        scene([[3, 0, 0, 1]])
        np.testing.assert_array_equal(trace([[0, 0, -3]], [[0, 0, 1]], np.inf)[0], [-1])
        scene([])
        ids, distances = trace(origins, [[0, 0, 1]] * len(origins), np.inf)
        assert np.all(ids == -1) and np.all(np.isinf(distances))
        assert lib.cu_rt_build_ms(ctx) == 0 and lib.cu_rt_trace_ms(ctx) == 0
        check(lib.cu_rt_trace(ctx, None, None, None, 0, None, None))
        bad = np.array([[0, 0, 0, -1]], np.float32)
        assert lib.cu_rt_set_spheres(ctx, ptr(bad), 1) != 0

        rng = np.random.default_rng(81289)
        spheres = np.column_stack([rng.uniform(-20, 20, (127, 3)),
                                   rng.uniform(.1, 3, 127)]).astype(np.float32)
        scene(spheres)
        build_ms = lib.cu_rt_build_ms(ctx)
        origins = rng.uniform(-30, 30, (7200, 3)).astype(np.float32)
        directions = rng.normal(size=(len(origins), 3))
        directions /= np.linalg.norm(directions, axis=1, keepdims=True)
        directions = directions.astype(np.float32)
        maximum = rng.uniform(0, 100, len(origins)).astype(np.float32)
        ids, distances = trace(origins, directions, maximum)
        # Independent quadratic reference; double inputs reflect float32 ABI.
        o, d, s = origins.astype(float), directions.astype(float), spheres.astype(float)
        offset = o[:, None, :] - s[None, :, :3]
        a = np.sum(d * d, axis=1)[:, None]
        b = np.sum(offset * d[:, None, :], axis=2)
        c = np.sum(offset * offset, axis=2) - s[None, :, 3] ** 2
        discriminant = b * b - a * c
        root = np.sqrt(np.maximum(discriminant, 0))
        near, far = (-b - root) / a, (-b + root) / a
        expected_t = np.where(near > np.float32(1e-5), near, far)
        valid = (discriminant >= 0) & (expected_t > np.float32(1e-5)) & (expected_t <= maximum[:, None])
        expected_t = np.where(valid, expected_t, np.inf)
        expected_ids = np.argmin(expected_t, axis=1)
        nearest = expected_t[np.arange(len(origins)), expected_ids]
        expected_ids[np.isinf(nearest)] = -1
        np.testing.assert_array_equal(ids, expected_ids)
        np.testing.assert_allclose(distances, nearest, rtol=2e-6, atol=1e-5)
        timings, wall = [], []
        for _ in range(30):
            start = time.perf_counter()
            trace(origins, directions, maximum)
            wall.append((time.perf_counter() - start) * 1000)
            timings.append(lib.cu_rt_trace_ms(ctx))
        print(f"PASS analytic edge cases + 7,200 rays / 127 spheres; {np.sum(ids >= 0)} hits")
        print(f"Context initialization: {init_ms:.3f} ms")
        print(f"Device GAS build: {build_ms:.4f} ms")
        print(f"Median device trace: {np.median(timings):.4f} ms")
        print(f"Median ctypes trace including transfers/allocations: {np.median(wall):.4f} ms")
    finally:
        lib.cu_rt_destroy(ctx)


if __name__ == "__main__":
    main()
