#!/usr/bin/env python3
"""Offline Schwarzschild transfer-table compiler (SciPy is build-time only).

This independent implementation tabulates u'' = 3 u**2 / 2 - u, u = rs/r,
starting at infinity with u(0)=0 and u'(0)=1/b. Spherical symmetry turns all
camera locations and orientations into queries of this two-dimensional family.
It uses the same geodesic equation as Schwarzschild null-ray methods; it is not
a port of Bruneton's beam tracing, filtering, or implementation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile
import time

import numpy as np

ROOT = Path(__file__).resolve().parent
DEFAULT_PATH = ROOT / "artifacts/lensing_schwarzschild.npz"
B_CRITICAL = 3 * np.sqrt(3) / 2
CRITICAL_EPSILON = 1e-6
R_MIN, R_MAX = 6., 8192.
B_MAX = 8300.


def compile_table(path=DEFAULT_PATH, impact_samples=1024, phase_samples=2049,
                  inverse_samples=1025, progress=True):
    """Compile both sides of the capture boundary; return artifact metadata.

    impact_samples is the sample count PER branch. Default uncompressed float
    arrays occupy ~25 MB. Captured and escaping trajectories are never mixed.
    """
    from scipy.integrate import solve_ivp

    if min(impact_samples, phase_samples, inverse_samples) < 32:
        raise ValueError("At least 32 samples are required for every axis")
    started = time.perf_counter()
    cap_coordinate = np.linspace(0, -np.log(CRITICAL_EPSILON), impact_samples)
    esc_coordinate = np.linspace(np.log(CRITICAL_EPSILON),
                                 np.log(B_MAX / B_CRITICAL - 1), impact_samples)
    capture_b = B_CRITICAL * (-np.expm1(-cap_coordinate))
    escape_b = B_CRITICAL * (1 + np.exp(esc_coordinate))
    impacts = np.concatenate((capture_b, escape_b))
    phase_end = np.empty(len(impacts), np.float64)
    u_end = np.empty(len(impacts), np.float64)
    forward = np.empty((len(impacts), phase_samples), np.float32)
    inverse = np.empty((len(impacts), inverse_samples), np.float32)
    normalized_phase = np.linspace(0, 1, phase_samples)
    inverse_axis = np.linspace(0, 1, inverse_samples)
    dense_axis = np.linspace(0, 1, max(8193, phase_samples * 4 + 1))

    def equation(phi, state):
        u, q = state
        return (q, 1.5 * u * u - u)

    def horizon(phi, state):
        return state[0] - 1

    horizon.terminal = True
    horizon.direction = 1

    def turning(phi, state):
        return state[1]

    turning.terminal = True
    turning.direction = -1

    for row, b in enumerate(impacts):
        capture = row < impact_samples
        if b == 0:
            # Smooth b->0 limit, expressed in normalized angular phase. The
            # exactly radial ray itself is handled analytically at runtime.
            phase_end[row], u_end[row] = 0., 1.
            forward[row] = normalized_phase
            inverse[row] = inverse_axis / R_MIN
            continue
        solution = solve_ivp(equation, (0, 40), (0., 1 / b), method="DOP853",
                             rtol=3e-12, atol=1e-13, max_step=.08,
                             dense_output=True, events=horizon if capture else turning)
        if not solution.success or not len(solution.t_events[0]):
            raise RuntimeError(f"Geodesic failed to terminate for impact b={b}: {solution.message}")
        phi = float(solution.t_events[0][0])
        endpoint = float(solution.y_events[0][0, 0])
        phase_end[row], u_end[row] = phi, endpoint
        forward[row] = solution.sol(normalized_phase * phi)[0] / endpoint
        # Store the inverse phase map too: camera initialization must also be
        # a table query, not a per-ray root solve or geodesic integration.
        dense_u = solution.sol(dense_axis * phi)[0]
        if capture:
            targets = inverse_axis / R_MIN
        else:
            # Quadratic concentration near the radial turning point resolves
            # the inverse map's square-root endpoint without oversized tables.
            targets = np.sin(inverse_axis * np.pi / 2) * endpoint
        inverse[row] = np.interp(targets, dense_u, dense_axis)
        forward[row, 0], forward[row, -1] = 0., 1.
        inverse[row, 0] = 0.
        if not capture:
            inverse[row, -1] = 1.
        if progress and (row + 1) % max(1, len(impacts) // 8) == 0:
            print(f"Compiled {row + 1}/{len(impacts)} universal geodesics", flush=True)

    metadata = {
        "format": "compileuniverse.schwarzschild-transfer.v1",
        "model": "nonrotating Schwarzschild; static local observer; rs=1",
        "equation": "d2u/dphi2 = 1.5*u*u-u; u(0)=0; du/dphi(0)=1/b",
        "b_critical": float(B_CRITICAL), "critical_relative_cutoff": CRITICAL_EPSILON,
        "observer_radius_min": R_MIN, "observer_radius_max": R_MAX,
        "impact_max": B_MAX, "impact_samples_per_branch": impact_samples,
        "phase_samples": phase_samples, "inverse_samples": inverse_samples,
        "disk_plane": "y=0; infinite thin plane; caller applies inner/outer radii",
        "integrator": "offline DOP853, rtol=3e-12, atol=1e-13, max_step=0.08 rad",
        "interpolation": "bilinear in branch-specific impact coordinate and normalized phase",
        "limitations": [
            "No spin/Kerr geometry, time-delay transport, finite beam filtering or wave optics.",
            "Relative impacts within 1e-6 of critical use nearest same-branch profile; arbitrarily high winding is truncated.",
            "Exactly critical inward rays are treated as dark/captured (their ideal path approaches the photon sphere).",
            "Coplanar rays have no isolated crossings of an infinitely thin disk.",
            "Observer motion and relativistic aberration are not included.",
            "Float32 table entries and bilinear interpolation approximate the integrated null geodesics.",
        ],
        "method_reference": "https://ebruneton.github.io/black_hole_shader/",
        "independent_implementation": True,
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replacement allows concurrent startup readers to see a full file.
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.stem + "-",
                                     suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            np.savez_compressed(stream, metadata=np.array(json.dumps(metadata, sort_keys=True)),
                                cap_coordinate=cap_coordinate, esc_coordinate=esc_coordinate,
                                phase_end=phase_end, u_end=u_end,
                                forward=forward, inverse=inverse)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(path)
    if progress:
        print(f"Saved {path}: {path.stat().st_size / 1e6:.2f} MB, "
              f"{time.perf_counter() - started:.2f} seconds", flush=True)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--impact-samples", type=int, default=1024)
    parser.add_argument("--phase-samples", type=int, default=2049)
    parser.add_argument("--inverse-samples", type=int, default=1025)
    args = parser.parse_args()
    compile_table(args.output, args.impact_samples, args.phase_samples, args.inverse_samples)


if __name__ == "__main__":
    main()
