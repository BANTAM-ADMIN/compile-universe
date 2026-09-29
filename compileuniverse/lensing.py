"""Offline-compiled Schwarzschild null rays, evaluated directly for text cells.

Coordinates use Schwarzschild areal radius with rs=1 and center at the origin.
Directions are measured in a local STATIC observer's orthonormal basis. Camera
positions can move freely within 6 <= r <= 8192. Runtime uses lookup/interpolation
and analytic plane geometry only; it does not step or integrate trajectories.

The independent compiler solves u''=1.5*u**2-u from infinity. An observer simply
selects a starting phase; escaping paths mirror around their periapsis. Separate
impact grids preserve the analytic captured/escaping boundary. Inspiration and
primary method reference: https://ebruneton.github.io/black_hole_shader/ . This
is not Bruneton's implementation and omits beam filtering and travel-time tables.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "artifacts/lensing_schwarzschild.npz"
B_CRITICAL = 3 * np.sqrt(3) / 2


class LensingTable:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else DEFAULT_PATH
        if not self.path.is_file():
            subprocess.run([sys.executable, str(ROOT / "compile_lensing.py"),
                            "--output", str(self.path)], check=True)
        with np.load(self.path, allow_pickle=False) as data:
            self.metadata = json.loads(str(data["metadata"]))
            if self.metadata.get("format") != "compileuniverse.schwarzschild-transfer.v1":
                raise ValueError("Unrecognized Schwarzschild transfer table")
            self.cap_coordinate = data["cap_coordinate"]
            self.esc_coordinate = data["esc_coordinate"]
            self.phase_end = data["phase_end"]
            self.u_end = data["u_end"]
            self.forward = data["forward"]
            self.inverse = data["inverse"]
        self.table_bytes = self.path.stat().st_size
        self._n = len(self.cap_coordinate)
        expected = self._n + len(self.esc_coordinate)
        if (len(self.phase_end) != expected or self.forward.shape[0] != expected or
                self.inverse.shape[0] != expected):
            raise ValueError("Inconsistent Schwarzschild transfer-table dimensions")

    @staticmethod
    def _sample(data, low, high, weight, coordinate):
        """Bilinear sample with arbitrary query shape, all indices vectorized."""
        scaled = np.clip(coordinate, 0, 1) * (data.shape[1] - 1)
        column = np.minimum(scaled.astype(np.int64), data.shape[1] - 2)
        alpha = scaled - column
        a = data[low, column] * (1 - alpha) + data[low, column + 1] * alpha
        b = data[high, column] * (1 - alpha) + data[high, column + 1] * alpha
        return a * (1 - weight) + b * weight

    def trace(self, origins, directions, max_crossings=3):
        """Return background directions and ordered isolated crossings of y=0.

        origins: (3,) or (N,3), directions: (N,3); inputs must be finite, with
        nonzero directions. Output directions are normalized; captured rays use
        the original direction as a finite placeholder and MUST be masked.

        crossings/tangents: (N,K,3), crossing_valid: (N,K). Invalid entries are
        zero. Tangents are unit LOCAL STATIC-frame directions along the backward
        camera ray (toward the source), suitable for a separate Doppler model.
        The caller filters crossing radii against its disk's inner/outer edge.
        Rays lying exactly in the disk plane have no isolated crossings.
        """
        started = time.perf_counter()
        if not isinstance(max_crossings, (int, np.integer)) or not 0 <= max_crossings <= 16:
            raise ValueError("max_crossings must be an integer in [0,16]")
        d = np.asarray(directions, dtype=np.float64)
        if d.ndim != 2 or d.shape[1] != 3:
            raise ValueError("directions must have shape (N,3)")
        origin = np.asarray(origins, dtype=np.float64)
        if origin.shape == (3,):
            origin = np.broadcast_to(origin, d.shape)
        elif origin.shape != d.shape:
            raise ValueError("origins must have shape (3,) or (N,3)")
        if not np.all(np.isfinite(d)) or not np.all(np.isfinite(origin)):
            raise ValueError("origins and directions must be finite")
        norm = np.linalg.norm(d, axis=1)
        if np.any(norm < 1e-15):
            raise ValueError("directions must be nonzero")
        d = d / norm[:, None]
        radius = np.linalg.norm(origin, axis=1)
        rmin = self.metadata["observer_radius_min"]
        rmax = self.metadata["observer_radius_max"]
        if np.any(radius < rmin - 1e-9) or np.any(radius > rmax + 1e-9):
            raise ValueError(f"observer radius must be within [{rmin}, {rmax}] Schwarzschild radii")
        radial = origin / radius[:, None]
        radial_velocity = np.einsum("ij,ij->i", radial, d)
        transverse = d - radial_velocity[:, None] * radial
        sine = np.linalg.norm(transverse, axis=1)
        tangent = transverse / np.maximum(sine[:, None], 1e-30)
        b = radius * sine / np.sqrt(1 - 1 / radius)
        inward = radial_velocity < 0
        capture_branch = b <= B_CRITICAL
        captured = inward & capture_branch

        # No interpolation can cross the critical impact boundary. Saturation
        # affects only unresolved high-winding rays, not capture classification.
        epsilon = self.metadata["critical_relative_cutoff"]
        relative = b / B_CRITICAL - 1
        coordinate = np.where(capture_branch,
                              -np.log(np.maximum(-relative, epsilon)),
                              np.log(np.maximum(relative, epsilon)))
        coordinate_low = np.where(capture_branch, self.cap_coordinate[0], self.esc_coordinate[0])
        coordinate_high = np.where(capture_branch, self.cap_coordinate[-1], self.esc_coordinate[-1])
        scaled = ((coordinate - coordinate_low) / (coordinate_high - coordinate_low) * (self._n - 1))
        scaled = np.clip(scaled, 0, self._n - 1)
        low_local = np.minimum(scaled.astype(np.int64), self._n - 2)
        weight = scaled - low_local
        low = low_local + np.where(capture_branch, 0, self._n)
        high = low + 1
        end = self.phase_end[low] * (1 - weight) + self.phase_end[high] * weight

        # Use the analytic turning radius when normalizing escape profiles.
        # This avoids interpolating a neighboring row's physically inaccessible
        # turning radius across rays that start exactly tangent to their sphere.
        safe_b = np.maximum(b, B_CRITICAL * (1 + epsilon))
        angle = (np.arccos(np.clip(1 - 27 / (2 * safe_b * safe_b), -1, 1)) + 4 * np.pi) / 3
        maximum_u = np.where(capture_branch, 1., (1 + 2 * np.cos(angle)) / 3)
        u0 = 1 / radius
        inverse_coordinate = np.where(capture_branch, u0 * rmin,
                                      2 / np.pi * np.arcsin(np.clip(u0 / maximum_u, 0, 1)))
        starting_fraction = self._sample(self.inverse, low, high, weight, inverse_coordinate)
        starting_phase = starting_fraction * end
        end_relative = np.where(inward, np.where(capture_branch, end, 2 * end) - starting_phase,
                                starting_phase)
        exact_radial = sine < 1e-12
        end_relative[exact_radial] = 0
        outgoing = (np.cos(end_relative)[:, None] * radial +
                    np.sin(end_relative)[:, None] * tangent)
        outgoing[captured] = d[captured]
        outgoing[exact_radial & ~inward] = radial[exact_radial & ~inward]
        outgoing /= np.maximum(np.linalg.norm(outgoing, axis=1)[:, None], 1e-30)

        # Every ray stays in its orbital plane. Intersect that plane's circle
        # of radial directions with y=0 analytically; then ask the transfer
        # table how far along each direction the curved null ray travels.
        first_crossing = np.mod(np.arctan2(-radial[:, 1], tangent[:, 1]), np.pi)
        first_crossing = np.where(first_crossing < 1e-9, first_crossing + np.pi, first_crossing)
        phi = first_crossing[:, None] + np.arange(max_crossings)[None, :] * np.pi
        coplanar = (np.abs(radial[:, 1]) + np.abs(tangent[:, 1])) < 1e-12
        valid = ((phi < end_relative[:, None] - 1e-9) & ~coplanar[:, None] &
                 ~exact_radial[:, None])
        # Most rays have zero or one crossing: do not evaluate tables, trig or
        # tangent vectors for the unused higher-order slots.
        ray_index, slot_index = np.nonzero(valid)
        crossing_phi = phi[ray_index, slot_index]
        canonical = np.where(inward[ray_index], starting_phase[ray_index] + crossing_phi,
                             starting_phase[ray_index] - crossing_phi)
        after_turn = inward[ray_index] & ~capture_branch[ray_index] & (canonical > end[ray_index])
        canonical = np.where(after_turn, 2 * end[ray_index] - canonical, canonical)
        fraction = canonical / np.maximum(end[ray_index], 1e-30)
        u = self._sample(self.forward, low[ray_index], high[ray_index], weight[ray_index], fraction)
        u *= maximum_u[ray_index]
        usable = (u > 1e-12) & (u < 1)
        valid[ray_index[~usable], slot_index[~usable]] = False
        cp, sp = np.cos(crossing_phi)[:, None], np.sin(crossing_phi)[:, None]
        crossing_radial = cp * radial[ray_index] + sp * tangent[ray_index]
        crossing_angular = -sp * radial[ray_index] + cp * tangent[ray_index]
        crossing_points = crossing_radial / np.maximum(u[:, None], 1e-12)
        crossing_points[:, 1] = 0.  # Remove floating-point residue in the plane equation.
        sine_at_crossing = np.clip(b[ray_index] * u * np.sqrt(np.maximum(1 - u, 0)), 0, 1)
        radial_sign = np.where(~inward[ray_index] | after_turn, 1., -1.)
        cos_at_crossing = radial_sign * np.sqrt(np.maximum(1 - sine_at_crossing ** 2, 0))
        crossing_tangents = (cos_at_crossing[:, None] * crossing_radial +
                             sine_at_crossing[:, None] * crossing_angular)
        points = np.zeros((len(d), max_crossings, 3), dtype=np.float64)
        tangents = np.zeros_like(points)
        points[ray_index[usable], slot_index[usable]] = crossing_points[usable]
        tangents[ray_index[usable], slot_index[usable]] = crossing_tangents[usable]
        stats = {
            "lensing_ms": (time.perf_counter() - started) * 1000,
            "lensing_rays": len(d), "captured_rays": int(captured.sum()),
            "disk_crossings": int(valid.sum()), "lensing_table_bytes": self.table_bytes,
            "critical_clamped_rays": int((np.abs(relative) < epsilon).sum()),
            "coplanar_rays": int(coplanar.sum()), "runtime_integration_steps": 0,
        }
        return {"outgoing": outgoing, "captured": captured, "crossings": points,
                "crossing_valid": valid, "tangents": tangents,
                "impact": b, "swept_angle": end_relative,
                "stats": stats, "metadata": self.metadata}
