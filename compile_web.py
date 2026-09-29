#!/usr/bin/env python3
"""Pack existing compiled optical/appearance arrays for the portable WASM player.

This performs no integration or procedural generation. The binary contains a
small fixed descriptor header followed by aligned little-endian float32 arrays.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import struct

import numpy as np

ROOT = Path(__file__).resolve().parent


def pack(output=ROOT / "artifacts/universe.bin"):
    with np.load(ROOT / "artifacts/lensing_schwarzschild.npz", allow_pickle=False) as optical:
        metadata = json.loads(str(optical["metadata"]))
        arrays = [(name, optical[name].copy()) for name in ("phase_end", "forward", "inverse")]
        coordinates = [float(optical[name][index]) for name in ("cap_coordinate", "esc_coordinate") for index in (0, -1)]
    with np.load(ROOT / "artifacts/appearance.npz", allow_pickle=False) as appearance:
        arrays += [(f"sky{k}", appearance[f"sky{k}"].copy()) for k in range(7)]
        arrays += [(name, appearance[name].copy()) for name in ("disk", "radial", "temperature")]
    header_size = ((128 + 16 * len(arrays) + 63) // 64) * 64
    payload = bytearray(header_size)
    struct.pack_into("<8I", payload, 0, 0x31575543, 1, 0, len(arrays),
                     metadata["impact_samples_per_branch"], metadata["phase_samples"],
                     metadata["inverse_samples"], header_size)
    struct.pack_into("<8f", payload, 64, metadata["b_critical"], metadata["critical_relative_cutoff"],
                     metadata["observer_radius_min"], metadata["observer_radius_max"], *coordinates)
    descriptors = []
    for i, (name, values) in enumerate(arrays):
        values = np.ascontiguousarray(values, dtype="<f4")
        payload.extend(bytes((-len(payload)) % 64))
        offset = len(payload)
        shape = tuple(values.shape) + (1,) * (3 - values.ndim)
        struct.pack_into("<4I", payload, 128 + 16 * i, offset, *shape)
        payload.extend(values.tobytes())
        descriptors.append({"name": name, "offset": offset, "shape": list(values.shape),
                            "dtype": "float32-le", "bytes": values.nbytes})
    struct.pack_into("<I", payload, 8, len(payload))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    compressed = gzip.compress(payload, compresslevel=6, mtime=0)
    output.with_suffix(output.suffix + ".gz").write_bytes(compressed)
    report = {"format": "CUW1", "version": 1, "bytes": len(payload),
              "gzip_bytes": len(compressed),
              "sha256": hashlib.sha256(payload).hexdigest(), "arrays": descriptors,
              "optics": metadata, "runtime": "WASM scalar CPU; direct character cells; no runtime ODE"}
    output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Packed {output}: {len(payload) / 1e6:.2f} MB ({len(compressed) / 1e6:.2f} MB gzip)")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/universe.bin")
    pack(parser.parse_args().output)
