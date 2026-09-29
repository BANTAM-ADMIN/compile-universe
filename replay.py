#!/usr/bin/env python3
"""Replay recorded cell changes as ANSI; no catalog, geometry or native libraries.

Usage: python replay.py artifacts/orbit.json
       python replay.py artifacts/orbit.json --verify
"""
import argparse
import json
from pathlib import Path
import sys
import time
import zlib

import numpy as np


def decode(metadata):
    path = Path(metadata)
    info = json.loads(path.read_text())
    payload = zlib.decompress(path.with_suffix(".delta.zlib").read_bytes())
    count, cols, rows = info["frames"], info["cols"], info["rows"]
    n, offset = cols * rows, 0
    cell_bytes = info.get("bytes_per_cell", 4)
    if cell_bytes not in (4, 7):
        raise ValueError("unsupported recorded cell size")
    bitmap_size = (n + 7) // 8
    current = np.zeros((n, cell_bytes), dtype=np.uint8)
    frames = []
    for _ in range(count):
        bits = payload[offset:offset + bitmap_size]
        if len(bits) != bitmap_size:
            raise ValueError("truncated change bitmap")
        offset += bitmap_size
        mask = np.unpackbits(np.frombuffer(bits, dtype=np.uint8), bitorder="little")[:n].astype(bool)
        size = int(mask.sum()) * cell_bytes
        values = payload[offset:offset + size]
        if len(values) != size:
            raise ValueError("truncated cell values")
        current[mask] = np.frombuffer(values, dtype=np.uint8).reshape(-1, cell_bytes)
        offset += size
        frames.append(current.copy())
    if offset != len(payload):
        raise ValueError("unexpected trailing data")
    return info, frames


def ansi(cells, cols, rows):
    pieces = ["\x1b[H"]
    last = None
    for y, row in enumerate(cells.reshape(rows, cols, cells.shape[-1])):
        if y:
            pieces.append(f"\x1b[{y + 1};1H")
        for cell in row:
            char, r, g, b = cell[:4]
            color = tuple(cell[1:])
            if color != last and (char != 32 or len(cell) == 7):
                if len(cell) == 7:
                    br, bg, bb = cell[4:]
                    pieces.append(f"\x1b[38;2;{r};{g};{b};48;2;{br};{bg};{bb}m")
                else:
                    pieces.append(f"\x1b[38;2;{r};{g};{b};40m")
                last = color
            pieces.append(chr(int(char)))
    return "".join(pieces)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    info, frames = decode(args.metadata)
    if args.verify:
        original = zlib.decompress(Path(args.metadata).with_suffix(".cells.zlib").read_bytes())
        if b"".join(frame.tobytes() for frame in frames) != original:
            raise RuntimeError("recording differs from full cell stream")
        print(f"Exact reconstruction: {len(frames)} frames, {info['cols']} x {info['rows']} cells.")
        return
    if not sys.stdout.isatty():
        parser.error("ANSI playback requires a terminal; use --verify to check the file")
    try:
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[40m\x1b[2J")
        started = time.monotonic()
        for i, cells in enumerate(frames):
            time.sleep(max(0, started + i / info["fps"] - time.monotonic()))
            sys.stdout.write(ansi(cells, info["cols"], info["rows"]))
            sys.stdout.flush()
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
