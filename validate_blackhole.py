#!/usr/bin/env python3
"""Measure complete compiled black-hole frames and text serialization separately.

Geometry correctness lives in tests/test_blackhole.py. This benchmark makes no
claim about browser layout, network latency, or terminal refresh performance.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
from time import perf_counter

import numpy as np

from compileuniverse.blackhole import BlackHoleRenderer
from compileuniverse.render import Camera


def looking_at_origin(position):
    position = np.asarray(position, dtype=np.float64)
    inward = -position / np.linalg.norm(position)
    return Camera(position=position, yaw=float(np.arctan2(inward[0], inward[2])), pitch=float(np.arcsin(inward[1])))


def summarize(samples):
    return {"median": float(np.median(samples)), "p95": float(np.percentile(samples, 95)),
            "minimum": float(np.min(samples)), "maximum": float(np.max(samples))}


def run_case(renderer, cameras, times, cols, rows):
    samples = []
    for camera, time in zip(cameras, times):
        started = perf_counter()
        frame = renderer.frame(camera, time=float(time), cols=cols, rows=rows)
        frame_wall_ms = (perf_counter() - started) * 1000
        started = perf_counter()
        wire = json.dumps({"rows": frame.runs(), "stats": frame.stats}, separators=(",", ":"), allow_nan=False).encode()
        serialization_ms = (perf_counter() - started) * 1000
        samples.append({
            "frame_wall_ms": frame_wall_ms,
            "text_serialization_ms": serialization_ms,
            "compute_and_serialize_ms": frame_wall_ms + serialization_ms,
            "wire_bytes": len(wire), "camera_position": camera.position.tolist(),
            "time": float(time), "stats": frame.stats,
        })
    return {
        "frame_wall_ms": summarize([sample["frame_wall_ms"] for sample in samples]),
        "text_serialization_ms": summarize([sample["text_serialization_ms"] for sample in samples]),
        "compute_and_serialize_ms": summarize([sample["compute_and_serialize_ms"] for sample in samples]),
        "wire_bytes": summarize([sample["wire_bytes"] for sample in samples]),
        "samples": samples,
    }


def markdown(report):
    lines = [
        "# Compiled black-hole frame benchmark", "",
        f"Generated: {report['generated_utc']}", "",
        f"Host: {report['host']}; Python {report['python']}; NumPy {report['numpy']}", "",
        f"Character grid: {report['cols']} × {report['rows']}. {report['frames']} samples per scenario.", "",
        f"Renderer initialization and artifact loading: {report['initialization_wall_ms']:.3f} ms. Initial frame: {report['first_frame_wall_ms']:.3f} ms.", "",
        "| Scenario | Frame median ms | Frame p95 ms | Text serialization median ms | Combined median ms | Median JSON bytes |",
        "| :--- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, case in report["cases"].items():
        lines.append(f"| {name} | {case['frame_wall_ms']['median']:.3f} | {case['frame_wall_ms']['p95']:.3f} | "
                     f"{case['text_serialization_ms']['median']:.3f} | {case['compute_and_serialize_ms']['median']:.3f} | "
                     f"{case['wire_bytes']['median']:.0f} |")
    lines += [
        "", "Stationary-camera samples advance animation time with cached curved-ray geometry. Moving-camera samples use new positions at fixed animation time, so view movement cannot be simulated by changing a prerecorded time index.", "",
        "Frame wall time includes live transfer-table queries when necessary, disk/background evaluation, cell composition, bloom, and glyph/color selection. Serialization time includes color-run construction and JSON encoding. Initialization and the initial frame are reported separately.", "",
        "These are CPU host wall measurements, not RT device-kernel timings. HTTP transport, browser DOM updates/layout, font rasterization, and physical display refresh are excluded. The table reports a local experiment, not browser FPS or a claim of full physical accuracy.", "",
        "Run `python3 -m unittest discover -s tests -v` for independent geometry, finite output, camera/time separation, shadow, and ANSI checks.", "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cols", type=int, default=220)
    parser.add_argument("--rows", type=int, default=94)
    parser.add_argument("--frames", type=int, default=12)
    parser.add_argument("--radius", type=float, default=60., help="Nominal initial z distance in Schwarzschild radii")
    parser.add_argument("--out", type=Path, default=Path("artifacts/blackhole-validation"))
    args = parser.parse_args()
    if args.frames < 2:
        parser.error("use at least two measured frames")
    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "host": platform.platform(), "python": platform.python_version(), "numpy": np.__version__,
        "cols": args.cols, "rows": args.rows, "frames": args.frames, "radius": args.radius, "cases": {},
    }
    started = perf_counter()
    renderer = BlackHoleRenderer()
    report["initialization_wall_ms"] = (perf_counter() - started) * 1000
    try:
        camera = looking_at_origin([0, .06 * args.radius, args.radius])
        started = perf_counter()
        first = renderer.frame(camera, time=0, cols=args.cols, rows=args.rows)
        report["first_frame_wall_ms"] = (perf_counter() - started) * 1000
        report["first_frame_stats"] = first.stats
        report["cases"]["stationary camera, advancing time"] = run_case(
            renderer, [camera] * args.frames, np.linspace(.137, 3.913, args.frames), args.cols, args.rows,
        )
        phase = np.linspace(.173, 1.937, args.frames)
        cameras = [looking_at_origin([np.sin(p) * (args.radius + 2 * np.sin(p * 2.3)),
                                      .06 * args.radius + 3 * np.sin(p * 1.7),
                                      np.cos(p) * (args.radius + 2 * np.sin(p * 2.3))]) for p in phase]
        report["cases"]["moving camera, fixed time"] = run_case(
            renderer, cameras, [.731] * args.frames, args.cols, args.rows,
        )
    finally:
        renderer.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.with_suffix(".json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    args.out.with_suffix(".md").write_text(markdown(report))
    print(markdown(report))
    print(f"Saved {args.out.with_suffix('.json')} and {args.out.with_suffix('.md')}")


if __name__ == "__main__":
    main()
