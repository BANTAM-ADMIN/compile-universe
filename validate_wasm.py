#!/usr/bin/env python3
"""Compare the browser's actual WASM engine with independent Python cell output."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from compileuniverse.blackhole import BlackHoleRenderer
from compileuniverse.render import Camera

ROOT = Path(__file__).resolve().parent


def fixture(name, position, time=0., cols=81, rows=41, exposure=1., bloom=True, palette="ember", yaw_offset=0.):
    position = np.asarray(position, dtype=np.float64)
    inward = -position / np.linalg.norm(position)
    return dict(name=name, position=position.tolist(), yaw=float(np.arctan2(inward[0], inward[2]) + yaw_offset),
                pitch=float(np.arcsin(inward[1])), fov=55., time=time, cols=cols, rows=rows,
                exposure=exposure, bloom=bloom, palette=palette)


def fixtures():
    return [
        fixture("default", [0., 3.6, 60.]),
        fixture("time advances, camera fixed", [0., 3.6, 60.], time=2.731),
        fixture("same state repeated", [0., 3.6, 60.], time=2.731),
        fixture("translated and turned", [8.71, 4.17, 23.31], time=.713),
        fixture("above disk", [0., 18.73, 24.17], time=1.31),
        fixture("below disk", [-3.7, -8.3, 31.1], time=.413),
        fixture("close observer", [.37, 1.13, 6.1], time=.317),
        fixture("far observer", [18.7, 7.3, 141.1], time=.97),
        fixture("looking away", [0., 3.6, 60.], yaw_offset=1.83, time=.117),
        fixture("no bloom", [1.3, 4.1, 26.7], time=.19, bloom=False),
        fixture("ice palette", [1.3, 4.1, 26.7], time=3.73, palette="ice"),
        fixture("high exposure", [2.7, 6.3, 35.1], time=.719, exposure=2.1),
        fixture("browser grid", [0., 3.6, 60.], time=.137, cols=220, rows=94),
        fixture("browser moving grid", [3.17, 7.31, 58.73], time=.713, cols=220, rows=94),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "artifacts/wasm-validation.json")
    parser.add_argument("--max-glyph-mismatch", type=float, default=.002)
    parser.add_argument("--max-color-mae", type=float, default=.15)
    parser.add_argument("--max-background-mae", type=float, default=.10)
    args = parser.parse_args()
    cases = fixtures()
    report = {"scope": "WASM vs Python final cells; independent Schwarzschild ODE checks live in tests/test_blackhole.py",
              "limits": {"glyph_mismatch_fraction": args.max_glyph_mismatch,
                         "foreground_mean_absolute_error_0_255": args.max_color_mae,
                         "background_mean_absolute_error_0_255": args.max_background_mae},
              "cases": [], "passed": True}
    renderer = BlackHoleRenderer()
    try:
        with tempfile.TemporaryDirectory(prefix="compileuniverse-wasm-") as directory:
            temporary = Path(directory)
            query = temporary / "fixtures.json"
            query.write_text(json.dumps(cases))
            subprocess.run(["node", str(ROOT / "validate_wasm.mjs"), str(query), str(temporary / "results")], check=True)
            actual = json.loads((temporary / "results/manifest.json").read_text())
            encoded = []
            for case, result in zip(cases, actual):
                raw = (temporary / "results" / result["filename"]).read_bytes()
                encoded.append(raw)
                cells = case["cols"] * case["rows"]
                if len(raw) != cells * 7:
                    raise AssertionError(f"{case['name']}: unexpected packed cell size")
                array = np.frombuffer(raw, dtype=np.uint8)
                glyphs = array[:cells]
                foreground = array[cells:cells * 4].reshape(-1, 3)
                background = array[cells * 4:].reshape(-1, 3)
                camera = Camera(np.asarray(case["position"]), case["yaw"], case["pitch"], case["fov"])
                frame = renderer.frame(camera, case["time"], case["cols"], case["rows"],
                                       case["exposure"], case["bloom"], case["palette"])
                expected_glyphs = np.frombuffer("".join(frame.glyphs.flat).encode("ascii"), dtype=np.uint8)
                glyph_mismatches = int(np.count_nonzero(glyphs != expected_glyphs))
                color_error = np.abs(foreground.astype(float) - frame.colors.reshape(-1, 3))
                background_error = np.abs(background.astype(float) - frame.backgrounds.reshape(-1, 3))
                valid = (glyph_mismatches / cells <= args.max_glyph_mismatch and
                         float(color_error.mean()) <= args.max_color_mae and
                         float(background_error.mean()) <= args.max_background_mae and
                         bool(((glyphs >= 32) & (glyphs <= 126)).all()))
                detail = {"name": case["name"], "cells": cells, "glyph_mismatches": glyph_mismatches,
                          "foreground_mae": float(color_error.mean()), "foreground_max_error": float(color_error.max()),
                          "background_mae": float(background_error.mean()), "background_max_error": float(background_error.max()),
                          "wasm_frame_wall_ms": result["frameWallMs"], "wasm_stats": result["stats"],
                          "python_shadow_cells": frame.stats["shadow_cells"], "python_disk_cells": frame.stats["disk_cells"],
                          "passed": valid}
                report["cases"].append(detail)
                report["passed"] &= valid
                print(f"{case['name']}: glyph errors {glyph_mismatches}/{cells}, "
                      f"foreground MAE {color_error.mean():.6f}, background MAE {background_error.mean():.6f}")
            report["repeat_is_byte_identical"] = encoded[1] == encoded[2]
            report["time_changes_cells"] = encoded[0] != encoded[1]
            report["passed"] &= report["repeat_is_byte_identical"] and report["time_changes_cells"]
    finally:
        renderer.close()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{'PASS' if report['passed'] else 'FAIL'}: {args.out}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
