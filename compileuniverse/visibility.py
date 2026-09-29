"""Small, shared ctypes interface to the CPU and OptiX experiments."""
from __future__ import annotations

import ctypes as ct
from pathlib import Path
import subprocess
import sys
import warnings

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
F32 = ct.POINTER(ct.c_float)
I32 = ct.POINTER(ct.c_int32)


class Visibility:
    def __init__(self, backend="cpu"):
        self.ctx = None
        if backend not in {"auto", "cpu", "brute", "rt"}:
            raise ValueError("backend must be auto, cpu, brute, or rt")
        if backend == "auto":
            if (ROOT / "native/build/libuniverse_rt.so").exists():
                try:
                    self._initialize("rt")
                    return
                except (OSError, RuntimeError) as error:
                    warnings.warn(f"RT initialization failed; using CPU BVH: {error}", RuntimeWarning)
            backend = "cpu"
        self._initialize(backend)

    def _initialize(self, backend):
        self.backend = backend
        kind = "cpu" if backend == "brute" else backend
        libpath = ROOT / f"native/build/libuniverse_{kind}.so"
        if not libpath.exists() and kind == "cpu":
            subprocess.run([sys.executable, str(ROOT / "native/build_cpu.py")], check=True)
        if not libpath.exists():
            raise RuntimeError(f"Build {kind} first: python native/build_{kind}.py")
        self.lib = ct.CDLL(str(libpath))
        prefix = "cu_" + kind + "_"
        def bind(name, restype, args):
            f = getattr(self.lib, prefix + name)
            f.restype, f.argtypes = restype, args
            return f
        self._create = bind("create", ct.c_void_p, [ct.c_char_p])
        self._set = bind("set_spheres", ct.c_int, [ct.c_void_p, F32, ct.c_uint32])
        self._trace = bind("trace_brute" if backend == "brute" else "trace", ct.c_int,
                           [ct.c_void_p, F32, F32, F32, ct.c_uint32, I32, F32])
        self._destroy = bind("destroy", None, [ct.c_void_p])
        self._error = bind("error", ct.c_char_p, [])
        self._build_ms = bind("build_ms", ct.c_double, [ct.c_void_p])
        self._trace_ms = bind("trace_ms", ct.c_double, [ct.c_void_p])
        self._counts = {}
        if kind == "cpu":
            for name in ("sphere_tests", "node_tests"):
                if hasattr(self.lib, prefix + name):
                    self._counts[name] = bind(name, ct.c_uint64, [ct.c_void_p])
        # The build helper writes this filename; accepting an explicit path avoids
        # the working-directory fragility in the original RT Tau harness.
        self.ctx = self._create(str(ROOT / "native/build/rt_device.ptx").encode())
        if not self.ctx:
            raise RuntimeError(self._message())

    def _message(self):
        return (self._error() or b"native visibility error").decode(errors="replace")

    def _check(self, code):
        if code:
            raise RuntimeError(self._message())

    def _open(self):
        if not self.ctx:
            raise RuntimeError("visibility backend is closed")

    def set_spheres(self, spheres):
        self._open()
        a = np.ascontiguousarray(spheres, dtype=np.float32)
        if a.ndim != 2 or a.shape[1] != 4 or not np.isfinite(a).all() or (a[:, 3] <= 0).any():
            raise ValueError("spheres must be finite Mx4 center/radius records with positive radii")
        self._check(self._set(self.ctx, a.ctypes.data_as(F32), len(a)))

    def trace(self, origins, directions, tmax):
        self._open()
        origins = np.ascontiguousarray(origins, dtype=np.float32)
        directions = np.ascontiguousarray(directions, dtype=np.float32)
        tmax = np.ascontiguousarray(tmax, dtype=np.float32)
        if origins.ndim != 2 or origins.shape[1] != 3 or directions.shape != origins.shape or tmax.shape != (len(origins),):
            raise ValueError("expected Nx3 origins/directions and N tmax values")
        if not np.isfinite(origins).all() or not np.isfinite(directions).all() or np.isnan(tmax).any() or (tmax < 0).any():
            raise ValueError("invalid ray coordinates or distance limits")
        if len(directions) and not np.allclose(np.linalg.norm(directions, axis=1), 1, rtol=2e-4, atol=2e-4):
            raise ValueError("ray directions must be normalized")
        ids = np.empty(len(origins), dtype=np.int32)
        distances = np.empty(len(origins), dtype=np.float32)
        self._check(self._trace(self.ctx, origins.ctypes.data_as(F32), directions.ctypes.data_as(F32),
                                tmax.ctypes.data_as(F32), len(origins), ids.ctypes.data_as(I32),
                                distances.ctypes.data_as(F32)))
        return ids, distances

    @property
    def build_ms(self):
        self._open()
        return self._build_ms(self.ctx)

    @property
    def trace_ms(self):
        self._open()
        return self._trace_ms(self.ctx)

    @property
    def stats(self):
        self._open()
        return {name: f(self.ctx) for name, f in self._counts.items()}

    def close(self):
        if getattr(self, "ctx", None):
            self._destroy(self.ctx)
            self.ctx = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def __del__(self):
        self.close()
