"""Compile the parent atlas's numeric catalog into a standalone sparse asset.

The catalog is measured data. The deliberately enormous moving test planet and
its surface are illustrative: this is a visibility experiment, not an ephemeris.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "artifacts/stars.npz"


def compile_catalog(source=None, destination=ASSET):
    source = Path(source) if source else ROOT.parent / "src/05-data.js"
    raw = source.read_text()
    match = re.search(r"const STAR_DATA\s*=\s*(\[[^;]+\]);", raw)
    if not match:
        raise ValueError("could not find the atlas's numeric STAR_DATA array")
    values = np.asarray(json.loads(match.group(1)), dtype=np.float64)
    if values.size % 8:
        raise ValueError("STAR_DATA does not contain complete eight-value records")
    data = values.reshape(-1, 8)
    if not np.isfinite(data).all():
        raise ValueError("non-finite catalog records")
    positions = data[:, :3]
    distance2 = (positions * positions).sum(axis=1)
    # Store a brightness coefficient; moving the camera updates inverse square
    # falloff instead of keeping the Earth's apparent magnitude everywhere.
    luminosity = np.power(10., -.4 * data[:, 3]) * distance2
    # An illustrative palette derived from the catalog's measured B-V values.
    anchors = np.array([-.4, 0., .4, .8, 1.3, 2.])
    rgb = np.array([[145, 178, 255], [197, 214, 255], [245, 244, 255],
                    [255, 233, 179], [255, 185, 114], [255, 129, 73]])
    colors = np.stack([np.interp(data[:, 4], anchors, rgb[:, k]) for k in range(3)], axis=1).astype(np.uint8)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(destination, positions=positions, luminosity=luminosity, colors=colors)
    metadata = {
        "stars": len(data), "bytes": destination.stat().st_size,
        "source": "gcdatlas src/05-data.js STAR_DATA (Hipparcos/Gaia catalog as bundled)",
        "source_sha256": hashlib.sha256(match.group(1).encode()).hexdigest(),
        "coordinates": "heliocentric galactic, light-years",
        "appearance": "compressed brightness and illustrative B-V palette",
        "test_planet": "synthetic, intentionally oversized; not a real astronomical body",
        "format": "compressed NumPy arrays; no frames, meshes, or raster textures",
    }
    destination.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


class Scene:
    def __init__(self, asset=ASSET):
        asset = Path(asset)
        if not asset.exists():
            compile_catalog(destination=asset)
        with np.load(asset, allow_pickle=False) as a:
            self.positions = a["positions"].copy()
            self.luminosity = a["luminosity"].copy()
            self.colors = a["colors"].copy()

    def spheres(self, time):
        return np.array([[2.1 * np.sin(time * .24), .28 * np.cos(time * .31),
                          5.5 + .3 * np.sin(time * .15), 1.35]], dtype=np.float64)
