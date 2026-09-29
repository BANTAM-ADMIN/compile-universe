#!/usr/bin/env python3
"""Standalone runner for COMPILEUNIVERSE."""
from __future__ import annotations

import argparse
import html
import json
import os
import shutil
from pathlib import Path
import sys
import zlib

ROOT = Path(__file__).resolve().parent


def make_renderer(args):
    from compileuniverse.render import Camera, Renderer
    if getattr(args, "scene", "lab") == "blackhole":
        from compileuniverse.blackhole import BlackHoleRenderer, default_camera
        return BlackHoleRenderer(), default_camera()
    return Renderer(args.backend), Camera()


def snapshot(args):
    renderer, camera = make_renderer(args)
    try:
        options = {} if getattr(args, "scene", "lab") == "blackhole" else {"planet": not args.no_planet}
        frame = renderer.frame(camera, args.time, args.cols, args.rows, **options)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.with_suffix(".txt").write_text(frame.plain() + "\n")
        out.with_suffix(".ansi").write_text("\x1b[2J" + frame.ansi() + f"\x1b[{args.rows + 1};1H\n")
        lines = ["".join(f'<span style="color:{run[0]};background:{run[2] if len(run) > 2 else "#000"}">{html.escape(run[1])}</span>' for run in row) for row in frame.runs()]
        description = ("Sagittarius A*: compiled Schwarzschild light paths; illustrative accretion disk and distant sky."
                       if getattr(args, "scene", "lab") == "blackhole" else "Real catalog stars, synthetic oversized test planet.")
        page = '<!doctype html><meta charset="utf-8"><title>COMPILEUNIVERSE snapshot</title><style>body{background:#000;color:#b8c7d2;font-family:monospace;padding:24px}pre{font-size:10px;line-height:1.8ch}p{max-width:80ch}</style><h1>COMPILEUNIVERSE</h1><p>' + description + ' Selectable colored text.</p><pre>'
        out.with_suffix(".html").write_text(page + "\n".join(lines) + "</pre><p>" + html.escape(json.dumps(frame.stats)) + "</p>")
        out.with_suffix(".json").write_text(json.dumps(frame.stats, indent=2) + "\n")
        print(json.dumps(frame.stats, indent=2))
        print(f"Wrote {out}.txt / .ansi / .html / .json")
    finally:
        renderer.close()


def record(args):
    """Record exact cell output; measure full-frame vs change-mask compression.

    This is a secondary storage probe, not the representation used by the live
    scene. Compression includes RGB bytes, and decoding is checked bit-for-bit.
    """
    import numpy as np
    renderer, camera = make_renderer(args)
    blackhole = getattr(args, "scene", "lab") == "blackhole"
    cell_bytes = 7 if blackhole else 4
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    count = max(1, round(args.seconds * args.fps))
    raw, delta, previous, previous_frame = bytearray(), bytearray(), None, None
    header = {"version": 3, "term": {"cols": args.cols, "rows": args.rows}, "title": "COMPILEUNIVERSE direct text"}
    try:
        with out.with_suffix(".cast").open("w") as cast:
            cast.write(json.dumps(header) + "\n")
            for i in range(count):
                frame = renderer.frame(camera, i / args.fps, args.cols, args.rows)
                chars = np.frombuffer("".join(frame.glyphs.flat).encode("ascii"), dtype=np.uint8)
                cells = np.column_stack((chars, frame.colors.reshape(-1, 3)))
                if blackhole:
                    cells = np.column_stack((cells, frame.backgrounds.reshape(-1, 3)))
                raw.extend(cells.tobytes())
                changed = np.ones(len(cells), dtype=bool) if previous is None else np.any(cells != previous, axis=1)
                bitmap = np.packbits(changed, bitorder="little").tobytes()
                payload = cells[changed].tobytes()
                delta.extend(bitmap); delta.extend(payload)
                restored = np.zeros_like(cells) if previous is None else previous.copy()
                decoded_mask = np.unpackbits(np.frombuffer(bitmap, dtype=np.uint8), bitorder="little")[:len(cells)].astype(bool)
                restored[decoded_mask] = np.frombuffer(payload, dtype=np.uint8).reshape(-1, cell_bytes)
                if not np.array_equal(restored, cells):
                    raise RuntimeError("cell delta reconstruction mismatch")
                ansi = ("\x1b[2J" if i == 0 else "") + frame.ansi(previous_frame)
                cast.write(json.dumps([0 if i == 0 else 1 / args.fps, "o", ansi]) + "\n")
                previous, previous_frame = restored, frame
        raw_compressed, delta_compressed = zlib.compress(raw, 9), zlib.compress(delta, 9)
        out.with_suffix(".cells.zlib").write_bytes(raw_compressed)
        out.with_suffix(".delta.zlib").write_bytes(delta_compressed)
        stats = {"backend": "compiled-lut" if blackhole else renderer.visibility.backend,
                 "scene": "blackhole" if blackhole else "lab", "frames": count, "fps": args.fps,
                 "cols": args.cols, "rows": args.rows, "bytes_per_cell": cell_bytes,
                 "cell_format": "ASCII byte + foreground RGB" + (" + background RGB" if blackhole else ""),
                 "delta_format": "per-frame ceil(cols*rows/8) changed-bit mask, little bit order, then changed cells",
                 "raw_cell_bytes": len(raw), "full_cells_zlib_bytes": len(raw_compressed),
                 "delta_zlib_bytes": len(delta_compressed), "ansi_cast_bytes": out.with_suffix(".cast").stat().st_size,
                 "exact_roundtrip": True, "scope": "fixed camera, animated " + ("disk" if blackhole else "test planet") + "; interactive scene remains separate from recording"}
        out.with_suffix(".json").write_text(json.dumps(stats, indent=2) + "\n")
        print(json.dumps(stats, indent=2))
    finally:
        renderer.close()


def main():
    # Let Node parse its own options; exec preserves the terminal and signals.
    if len(sys.argv) > 1 and sys.argv[1] == "terminal":
        node = shutil.which("node")
        if not node:
            print("COMPILEUNIVERSE: terminal mode requires Node.js 18+", file=sys.stderr)
            return 1
        os.execv(node, [node, str(ROOT / "terminal/main.mjs"), *sys.argv[2:]])
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("web", "view", "snapshot", "record"):
        p = sub.add_parser(command)
        p.add_argument("--backend", choices=["auto", "cpu", "brute", "rt"], default="auto")
        if command != "web":
            p.add_argument("--scene", choices=["lab", "blackhole"], default="lab")
        if command in {"snapshot", "record"}:
            p.add_argument("--cols", type=int, default=150)
            p.add_argument("--rows", type=int, default=48)
            p.add_argument("--out", default=str(ROOT / f"artifacts/{command}"))
        if command in {"view", "record"}:
            p.add_argument("--fps", type=int, default=20)
        if command == "web": p.add_argument("--port", type=int, default=8765)
        if command == "snapshot":
            p.add_argument("--time", type=float, default=0.)
            p.add_argument("--no-planet", action="store_true")
        if command == "record": p.add_argument("--seconds", type=float, default=4.)
    sub.add_parser("terminal", help="Interactive full-universe ANSI player (Node.js)")
    args = parser.parse_args()
    if hasattr(args, "fps") and not 1 <= args.fps <= 120:
        parser.error("fps must be 1..120")
    if hasattr(args, "seconds") and not 0 < args.seconds <= 120:
        parser.error("seconds must be greater than 0 and at most 120")
    try:
        if args.command == "web":
            from compileuniverse.server import serve
            serve(args.backend, args.port)
        elif args.command == "view":
            from compileuniverse.terminal import play
            play(args.backend, args.fps, args.scene)
        elif args.command == "snapshot": snapshot(args)
        elif args.command == "record": record(args)
    except (RuntimeError, ValueError, OSError) as error:
        print(f"COMPILEUNIVERSE: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
