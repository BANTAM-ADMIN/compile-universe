#!/usr/bin/env python3
"""Build a smaller standalone atlas with an explicit, documented data budget."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import sys

import numpy as np
from PIL import Image

import build

ROOT = Path(__file__).resolve().parent
UPSTREAM = ROOT / "upstream"
sys.path.insert(0, str(UPSTREAM))
from compile_catalog import STAR_DTYPE, MAGIC, build_bvh
from compile_gaia import summaries
from compile_lensing import compile_table


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def sample_catalog(source, target, count):
    metadata = json.loads((source / "gaia.json").read_text())
    raw = (source / "gaia-atlas.bin").read_bytes()
    header = struct.unpack_from("<9I", raw)
    stars = np.frombuffer(raw, dtype=STAR_DTYPE, count=header[2], offset=header[4])
    observations = np.fromfile(source / "gaia-observations.bin", dtype="<f4").reshape(-1, 4)
    base = metadata["baseCount"]
    cloud = (stars["flags"][base:] & 64) != 0
    selected = []
    counts = {}
    for kind, mask in (("500pc", ~cloud), ("lmc", cloud)):
        candidates = np.flatnonzero(mask)
        # Retain original measurements and coordinates; take each region's
        # brightest G-band observations, with a deterministic stable tie order.
        order = np.argsort(observations[candidates, 2], kind="stable")
        chosen = candidates[order[:count]]
        selected.extend(chosen.tolist())
        counts[kind] = {**metadata["counts"][kind], "fullRetained": len(candidates),
                       "retained": len(chosen), "compactSelection": "brightest G-band observations"}
    selected = np.asarray(selected, dtype=int)
    compact = np.concatenate((stars[:base], stars[base + selected])).copy()
    nodes, indices = build_bvh(compact, leaf_size=32)
    light = summaries(compact, nodes, indices)
    payload = bytearray(64)
    offsets = []
    for values in (compact, nodes, indices):
        payload.extend(bytes((-len(payload)) % 64))
        offsets.append(len(payload))
        payload.extend(values.tobytes())
    struct.pack_into("<9I", payload, 0, MAGIC, 1, len(compact), len(nodes), *offsets, 0, len(payload))
    (target / "gaia-atlas.bin").write_bytes(payload)
    light.tofile(target / "gaia-light.bin")
    observations[selected].tofile(target / "gaia-observations.bin")
    metadata.update(totalCount=len(compact), nodeCount=len(nodes), counts=counts,
                    fullCatalogCount=header[2], compactGaiaCount=len(selected),
                    compactSelection="All original HYG stars plus the brightest G-band Gaia observations in each input region; not a complete or statistically representative sample",
                    atlasSha256=hashlib.sha256(payload).hexdigest(),
                    lightSha256=hashlib.sha256(light.tobytes()).hexdigest())
    write_json(target / "gaia.json", metadata)
    return len(compact), base, len(selected)


def compact_optics(source, target):
    optical_path = target / "compact-optics.npz"
    if not optical_path.exists():
        compile_table(optical_path, impact_samples=256, phase_samples=513, inverse_samples=257)
    with np.load(optical_path, allow_pickle=False) as optical:
        meta = json.loads(str(optical["metadata"]))
        arrays = [optical[key].copy() for key in ("phase_end", "forward", "inverse")]
        coordinates = [float(optical[key][i]) for key in ("cap_coordinate", "esc_coordinate") for i in (0, -1)]
    raw = (source / "universe.bin").read_bytes()
    originals = []
    for i in range(13):
        offset, height, width, channels = struct.unpack_from("<4I", raw, 128 + 16 * i)
        originals.append(np.frombuffer(raw, dtype="<f4", count=height * width * channels,
                                       offset=offset).reshape(height, width, channels))
    sky = originals[5].copy()  # The original sky's second mip level: 384x192.
    for level in range(7):
        arrays.append(sky.copy())
        if level < 6:
            sky = (sky[0::2, 0::2] + sky[1::2, 0::2] + sky[0::2, 1::2] + sky[1::2, 1::2]) * .25
    disk = originals[10]
    disk = (disk[0::2, 0::2] + disk[1::2, 0::2] + disk[0::2, 1::2] + disk[1::2, 1::2]) * .25
    arrays.extend((disk, originals[11], originals[12]))
    payload = bytearray(384)
    struct.pack_into("<8I", payload, 0, 0x31575543, 1, 0, 13, 256, 513, 257, 384)
    struct.pack_into("<8f", payload, 64, meta["b_critical"], meta["critical_relative_cutoff"],
                     meta["observer_radius_min"], meta["observer_radius_max"], *coordinates)
    for i, values in enumerate(arrays):
        values = np.ascontiguousarray(values, dtype="<f4")
        payload.extend(bytes((-len(payload)) % 64))
        shape = tuple(values.shape) + (1,) * (3 - values.ndim)
        struct.pack_into("<4I", payload, 128 + 16 * i, len(payload), *shape)
        payload.extend(values.tobytes())
    struct.pack_into("<I", payload, 8, len(payload))
    (target / "universe.bin").write_bytes(payload)


def resize_moon(source, target):
    surfaces = json.loads((source / "surface-metadata.json").read_text())
    moon = surfaces["surfaces"]["moon"]
    descriptors = {}
    for descriptor, normal in ((moon, False), (moon["relief"]["texture"], True)):
        name = descriptor["url"].split("/")[-1]
        pixels = np.fromfile(source / name, dtype=np.uint8).reshape(descriptor["height"], descriptor["width"], 3)
        image = Image.fromarray(pixels).resize((512, 256), Image.Resampling.BOX if normal else Image.Resampling.LANCZOS)
        resized = np.array(image)
        if normal:
            vectors = (resized.astype(float) - [128, 128, 0]) / [127, 127, 255]
            vectors /= np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)
            resized = np.rint(np.clip(vectors * [127, 127, 255] + [128, 128, 0], 0, 255)).astype(np.uint8)
        payload = resized.tobytes()
        (target / name).write_bytes(payload)
        descriptors[descriptor["url"]] = {"width": 512, "height": 256, "bytes": len(payload),
                                          "sha256": hashlib.sha256(payload).hexdigest()}
    def update(value):
        if isinstance(value, dict):
            if value.get("url") in descriptors:
                value.update(descriptors[value["url"]])
            for child in value.values():
                update(child)
        elif isinstance(value, list):
            for child in value:
                update(child)
    for name in ("surface-metadata.json", "systems.json"):
        document = json.loads((source / name).read_text())
        update(document)
        document["compactNote"] = "Moon albedo and relief reduced to 512x256 for the compact edition."
        write_json(target / name, document)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gaia-per-region", type=int, default=4000)
    parser.add_argument("--output", type=Path, default=ROOT / "compact.html")
    args = parser.parse_args()
    if args.gaia_per_region < 1:
        parser.error("--gaia-per-region must be positive")
    source = ROOT / "compact-source"
    artifacts = source / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    for directory in ("web", "data"):
        (source / directory).mkdir(exist_ok=True)
    for name in build.MODULES + ["atlas.html", "atlas.css", "atlas-engine.wasm", "engine.wasm", "phenomena-engine.wasm"]:
        shutil.copyfile(UPSTREAM / "web" / name, source / "web" / name)
    for name in ("HYG-LICENSE.md", "PHENOMENA-SOURCES.md", "GRAND-TOUR-SOURCES.md"):
        shutil.copyfile(UPSTREAM / "data" / name, source / "data" / name)
    names = build.ASSETS + sorted(path.name for path in (UPSTREAM / "artifacts").glob("surface-*.bin"))
    for name in names:
        shutil.copyfile(UPSTREAM / "artifacts" / name, artifacts / name)
    total, base, gaia = sample_catalog(UPSTREAM / "artifacts", artifacts, args.gaia_per_region)
    compact_optics(UPSTREAM / "artifacts", artifacts)
    resize_moon(UPSTREAM / "artifacts", artifacts)
    note = (f"Compact edition: all {base:,} HYG stars plus {gaia:,} brightness-selected Gaia observations "
            f"({args.gaia_per_region:,} nearby and {args.gaia_per_region:,} LMC). "
            "The full million-star Gaia field is omitted. Moon maps are 512x256; black-hole optical tables "
            "and background/disk charts use lower resolution. Other scenes, named destinations and controls are retained. ")
    atlas = source / "web/atlas.js"
    code = atlas.read_text().replace("setText('provenance', '", "setText('provenance', '" + note)
    atlas.write_text(code)
    interface = source / "web/ascii-interface.js"
    interface.write_text(interface.read_text().replace("GAIA / A SKY WRITTEN IN CHARACTERS", "COMPACT / A SKY WRITTEN IN CHARACTERS"))
    page = source / "web/atlas.html"
    page.write_text(page.read_text().replace("Gaia adds measured nearby stars and Magellanic Cloud candidates.", note + " Gaia adds measured nearby stars and Magellanic Cloud candidates."))
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=UPSTREAM, text=True).strip()
    output = args.output.resolve()
    build.build(source, output, revision=revision, edition={"name": "compact", "stars": total, "note": note})
    if output.stat().st_size > 20_000_000:
        raise SystemExit(f"Compact HTML is {output.stat().st_size:,} bytes; lower --gaia-per-region to meet 20 MB.")
    print(f"Compact target met: {output.stat().st_size:,} bytes; {total:,} stars, 490 bodies, all scenes")


if __name__ == "__main__":
    main()
