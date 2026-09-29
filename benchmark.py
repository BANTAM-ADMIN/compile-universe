#!/usr/bin/env python3
"""Reproducible visibility benchmark; reports host wall and GPU time separately."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import statistics
import subprocess
import sys
from time import perf_counter

import numpy as np

from compileuniverse.visibility import Visibility


def make_scene(sphere_count, ray_count, seed):
    rng = np.random.default_rng(seed)
    spheres = np.column_stack((
        rng.uniform([-45, -45, 10], [45, 45, 120], (sphere_count, 3)),
        rng.uniform(0.5, 1.5, sphere_count),
    )).astype(np.float32)
    origins = rng.uniform(-1, 1, (ray_count, 3)).astype(np.float32)
    directions = rng.normal(size=(ray_count, 3))
    aimed = ray_count // 2
    targets = spheres[rng.integers(0, sphere_count, aimed), :3]
    directions[:aimed] = targets - origins[:aimed]
    directions /= np.linalg.norm(directions, axis=1, keepdims=True)
    tmax = np.full(ray_count, 250, dtype=np.float32)
    # Some rays terminate at stars in front of the sampled body.
    tmax[:aimed:5] = np.linalg.norm(targets[::5] - origins[:aimed:5], axis=1) * 0.7
    return spheres, origins, directions.astype(np.float32), tmax


def gpu_info():
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def measure(visibility, spheres, origins, directions, tmax, repeats):
    started = perf_counter()
    visibility.set_spheres(spheres)
    build_wall_ms = (perf_counter() - started) * 1000
    build_native_ms = float(visibility.build_ms)
    visibility.trace(origins, directions, tmax)  # Warm code, allocations, clocks.
    wall, native = [], []
    result = None
    for _ in range(repeats):
        started = perf_counter()
        result = visibility.trace(origins, directions, tmax)
        wall.append((perf_counter() - started) * 1000)
        native.append(float(visibility.trace_ms))
    median = statistics.median(wall)
    return {
        "build_wall_ms": build_wall_ms,
        "build_native_ms": build_native_ms,
        "trace_wall_ms_samples": wall,
        "trace_native_ms_samples": native,
        "trace_wall_ms_median": median,
        "trace_native_ms_median": statistics.median(native),
        "trace_million_rays_per_second_wall": len(origins) / median / 1000,
        "native_query_counts": visibility.stats,
    }, result


def parity(reference, actual):
    reference_ids, reference_distances = reference
    actual_ids, actual_distances = actual
    same_hit = (reference_ids >= 0) & (actual_ids == reference_ids)
    errors = np.abs(reference_distances[same_hit] - actual_distances[same_hit])
    tolerance_ok = np.isclose(reference_distances[same_hit], actual_distances[same_hit], rtol=5e-4, atol=2e-3)
    return {
        "id_mismatches": int(np.count_nonzero(reference_ids != actual_ids)),
        "distance_mismatches": int(np.count_nonzero(~tolerance_ok)),
        "max_matching_hit_distance_error": float(np.max(errors)) if len(errors) else 0.0,
    }


def markdown(report):
    lines = [
        "# COMPILEUNIVERSE visibility benchmark", "",
        f"Generated: {report['generated_utc']}", "",
        f"Host: {report['host']}; Python {report['python']}; NumPy {report['numpy']}", "",
        f"GPU: {report['gpu'] or 'unavailable'}", "",
        f"Fixed seed: {report['seed']}. {report['rays']:,} rays per scene; {report['repeats']} measured repeats after one warm-up.", "",
        "Half of rays aim at sphere centers, with every fifth aimed ray ending before its target; the other half use random directions. This includes deliberate hits, misses, and finite-distance visibility queries.", "",
        "| Spheres | Backend | Build wall ms | Trace wall ms | Native trace ms | Wall Mray/s | Brute / wall | ID errors | Distance errors |",
        "| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for scene in report["scenes"]:
        for backend, result in scene["backends"].items():
            if result["status"] != "ok":
                continue
            lines.append(
                f"| {scene['spheres']} | {backend} | {result['build_wall_ms']:.3f} | "
                f"{result['trace_wall_ms_median']:.3f} | {result['trace_native_ms_median']:.3f} | "
                f"{result['trace_million_rays_per_second_wall']:.3f} | "
                f"{result['speedup_vs_brute_wall']:.2f}x | {result['id_mismatches']} | {result['distance_mismatches']} |"
            )
    lines += [
        "", "All trace times are medians. Wall time includes Python, input/output handling, native calls, and GPU transfers/synchronization when applicable. Initialization and geometry construction are excluded from trace time and reported separately.", "",
        "Native trace time means CPU traversal for cpu/brute and device launch time for rt. These columns are different timing scopes: no speedup is computed from GPU device-only time versus CPU wall time. The difference between RT wall and native time includes more than transfer cost.", "",
        "Build wall time includes set_spheres and geometry upload/build when applicable. Native build time is device-only for RT and native CPU construction for cpu/brute; it and every timing sample are in the JSON. Moving geometry can require another build, so static-scene trace throughput is not whole-animation throughput.", "",
        "Parity uses the brute backend on exactly the same input. Independent float64 geometry validation is provided by tests/test_visibility.py. Distance tolerance: rtol=5e-4, atol=2e-3. Exact primitive IDs must agree.", "",
        "This measures visibility queries only. It does not measure character selection, ANSI encoding, terminal display, scene compilation, or full application FPS.", "",
    ]
    for backend, info in report["availability"].items():
        if info["status"] == "skipped":
            lines.append(f"- {backend}: **SKIPPED**, not validated: {info['reason']}")
        else:
            lines.append(f"- {backend}: initialization {info['initialization_wall_ms']:.3f} ms.")
    lines += ["", f"Result: **{report['status'].upper()}**.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rays", type=int, default=20_000)
    parser.add_argument("--spheres", type=int, nargs="+", default=[1, 100, 1000])
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20260926)
    parser.add_argument("--out", type=Path, default=Path("artifacts/benchmark"), help="Output file stem; writes .json and .md")
    parser.add_argument("--require-rt", action="store_true", help="Exit nonzero if OptiX cannot initialize")
    args = parser.parse_args()
    if args.rays < 2 or args.repeats < 1 or any(count < 1 for count in args.spheres):
        parser.error("Use at least two rays, one repeat, and positive sphere counts")
    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "host": platform.platform(), "python": platform.python_version(),
        "numpy": np.__version__, "gpu": gpu_info(),
        "seed": args.seed, "rays": args.rays, "repeats": args.repeats,
        "availability": {}, "scenes": [], "status": "passed",
    }
    engines = {}
    try:
        for backend in ("brute", "cpu", "rt"):
            started = perf_counter()
            try:
                engines[backend] = Visibility(backend=backend)
            except (RuntimeError, OSError) as error:
                if backend != "rt":
                    raise
                report["availability"][backend] = {"status": "skipped", "reason": str(error)}
                if args.require_rt:
                    report["status"] = "failed"
                continue
            report["availability"][backend] = {
                "status": "ok", "initialization_wall_ms": (perf_counter() - started) * 1000,
                "native_trace_timing_scope": "device launch only" if backend == "rt" else "native CPU traversal",
                "native_build_timing_scope": "device acceleration structure build only" if backend == "rt" else "native CPU construction",
            }
        for count in args.spheres:
            inputs = make_scene(count, args.rays, args.seed + count)
            scene = {"spheres": count, "backends": {}}
            reference = None
            for backend, engine in engines.items():
                metrics, result = measure(engine, *inputs, args.repeats)
                if backend == "brute":
                    reference = result
                    scene["reference_hits"] = int(np.count_nonzero(result[0] >= 0))
                metrics.update(parity(reference, result))
                metrics["status"] = "ok"
                metrics["native_trace_timing_scope"] = report["availability"][backend]["native_trace_timing_scope"]
                metrics["native_build_timing_scope"] = report["availability"][backend]["native_build_timing_scope"]
                scene["backends"][backend] = metrics
                if metrics["id_mismatches"] or metrics["distance_mismatches"]:
                    report["status"] = "failed"
                print(f"{count:5d} spheres / {backend:5s}: {metrics['trace_wall_ms_median']:9.3f} ms wall, "
                      f"{metrics['trace_native_ms_median']:9.3f} ms native, "
                      f"{metrics['id_mismatches']} ID / {metrics['distance_mismatches']} distance mismatches")
            baseline = scene["backends"]["brute"]["trace_wall_ms_median"]
            for metrics in scene["backends"].values():
                metrics["speedup_vs_brute_wall"] = baseline / metrics["trace_wall_ms_median"]
            report["scenes"].append(scene)
    finally:
        for engine in engines.values():
            engine.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    args.out.with_suffix(".md").write_text(markdown(report))
    print(f"Reports: {args.out.with_suffix('.json')} and {args.out.with_suffix('.md')}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
