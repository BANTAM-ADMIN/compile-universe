#!/usr/bin/env python3
"""Compile HYG v4.2 into a spatial star catalog for the local text engine.

The source coordinates are fixed J2000 heliocentric equatorial parsecs. The
compiler removes the catalog's unknown-distance sentinel, builds a conservative
BVH, and derives explicitly illustrative colors, temperatures, and radii. No
catalog is downloaded unless the local source is absent or --download is used.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import struct
import urllib.request

import numpy as np

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "data/hygdata_v42.csv.gz"
DEFAULT_OUTPUT = ROOT / "artifacts/atlas.bin"
SOURCE_URL = "https://www.astronexus.com/downloads/catalogs/hygdata_v42.csv.gz"
SOURCE_SHA256 = "5ca9431ff364c8002a4a3efa91b2b9296746aea1543374db4cb6b4fab049d601"
SOLAR_RADIUS_PC = 2.25461e-8
MAGIC = 0x54415543
FLAG_SUN = 1
FLAG_ESTIMATED_RADIUS = 2
FLAG_IMPUTED_BV = 4
FLAG_ESTIMATED_TEMPERATURE = 8
FLAG_MEASURED_RADIUS = 16
CURATED_RADIUS_PATH = ROOT / "data/stellar-radii.json"

STAR_DTYPE = np.dtype({
    "names": ["position", "absmag", "radius_pc", "rgb", "luminosity", "temperature", "id", "flags", "reserved"],
    "formats": [("<f8", 3), "<f4", "<f4", ("<f4", 3), "<f4", "<f4", "<u4", "<u4", "<u4"],
    "offsets": [0, 24, 28, 32, 44, 48, 52, 56, 60], "itemsize": 64,
})
NODE_DTYPE = np.dtype({
    "names": ["center", "halfextent", "min_absmag", "max_radius_pc", "left", "right", "start", "count", "reserved"],
    "formats": [("<f8", 3), ("<f4", 3), "<f4", "<f4", "<u4", "<u4", "<u4", "<u4", "<u4"],
    "offsets": [0, 24, 36, 40, 44, 48, 52, 56, 60], "itemsize": 64,
})

ALIASES = {
    0: ["Sun", "Sol", "Solar System"],
    71456: ["Alpha Centauri A", "Alpha Cen A", "Rigil Kentaurus"],
    71453: ["Alpha Centauri B", "Alpha Cen B", "Toliman"],
    70666: ["Proxima Centauri", "Proxima", "Alpha Centauri C"],
    32263: ["Sirius", "Alpha Canis Majoris"],
    17661: ["Alcyone", "Pleiades (Alcyone member star)"],
}


def download_source(path: Path = DEFAULT_SOURCE) -> None:
    """Fetch the pinned original release; reject altered or non-gzip responses."""
    with urllib.request.urlopen(SOURCE_URL, timeout=120) as response:
        raw = response.read()
    if not raw.startswith(b"\x1f\x8b") or hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("Downloaded HYG source does not match the pinned v4.2 SHA256")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)


def _number(row, key):
    value = float(row[key])
    if not math.isfinite(value):
        raise ValueError(f"Nonfinite {key}")
    return value


def read_source(path: Path):
    """Return valid spatial source rows and disjoint exclusion counts."""
    raw = Path(path).read_bytes()
    counts = dict(source_rows=0, source_sun_replaced=0, distance_sentinel=0,
                  invalid_spatial_or_photometric=0, excluded_named=0)
    rows = []
    ids = set()
    with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            counts["source_rows"] += 1
            ident = int(row["id"])
            if ident in ids:
                raise ValueError(f"Duplicate source id {ident}")
            ids.add(ident)
            if ident == 0:
                counts["source_sun_replaced"] += 1
                continue
            try:
                distance = _number(row, "dist")
                if distance >= 100000:
                    counts["distance_sentinel"] += 1
                    counts["excluded_named"] += bool(row.get("proper"))
                    continue
                required = {key: _number(row, key) for key in ("x", "y", "z", "mag", "absmag", "lum")}
                if distance <= 0 or required["lum"] <= 0:
                    raise ValueError("Nonpositive distance or luminosity")
                # These are approximate rendering inputs, but must be finite.
                ci = float(row["ci"]) if row.get("ci") else None
                if ci is not None and not math.isfinite(ci):
                    ci = None
            except (ValueError, KeyError, OverflowError):
                counts["invalid_spatial_or_photometric"] += 1
                counts["excluded_named"] += bool(row.get("proper"))
                continue
            row = dict(row)
            row.update(required, id=ident, dist=distance, ci=ci)
            rows.append(row)
    # The source's approximate apparent Sun position is replaced by the
    # coordinate origin. This is an explicit synthetic reference record.
    sun = dict(id=0, proper="Sun", x=0., y=0., z=0., dist=0., mag=-26.74,
               absmag=4.83, lum=1., ci=.656, spect="G2V", hip="", hd="", hr="", gl="", bf="")
    return [sun, *rows], counts, hashlib.sha256(raw).hexdigest()


def compile_stars(rows):
    stars = np.zeros(len(rows), dtype=STAR_DTYPE)
    stars["position"] = [[r["x"], r["y"], r["z"]] for r in rows]
    stars["id"] = [r["id"] for r in rows]
    stars["absmag"] = [r["absmag"] for r in rows]
    stars["luminosity"] = [r["lum"] for r in rows]
    bv = np.array([r["ci"] if r["ci"] is not None else .65 for r in rows])
    # Ballesteros' B-V approximation; clipping only applies to the illustrative
    # temperature/color model, never to source photometry or coordinates.
    bounded_bv = np.clip(bv, -.4, 2.5)
    temperature = 4600 * (1 / (.92 * bounded_bv + 1.7) + 1 / (.92 * bounded_bv + .62))
    radius_solar = np.sqrt(stars["luminosity"].astype(np.float64)) * (5772 / temperature) ** 2
    stars["temperature"] = temperature
    stars["radius_pc"] = radius_solar * SOLAR_RADIUS_PC
    anchors = [-.4, 0, .4, .8, 1.3, 2.]
    colors = np.array([[145, 178, 255], [197, 214, 255], [245, 244, 255],
                       [255, 233, 179], [255, 185, 114], [255, 129, 73]]) / 255.
    stars["rgb"] = np.stack([np.interp(bv, anchors, colors[:, c]) for c in range(3)], axis=1)
    stars["flags"] = FLAG_ESTIMATED_RADIUS | FLAG_ESTIMATED_TEMPERATURE
    stars["flags"] |= np.array([FLAG_IMPUTED_BV if r["ci"] is None else 0 for r in rows], dtype=np.uint32)
    stars["flags"][0] = FLAG_SUN
    stars["radius_pc"][0] = SOLAR_RADIUS_PC
    stars["temperature"][0] = 5772
    curated = json.loads(CURATED_RADIUS_PATH.read_text())["stars"]
    for i, row in enumerate(rows):
        measurement = curated.get(str(row["id"]))
        if measurement:
            stars["radius_pc"][i] = measurement["radius_solar"] * SOLAR_RADIUS_PC
            stars["flags"][i] = (int(stars["flags"][i]) & ~FLAG_ESTIMATED_RADIUS) | FLAG_MEASURED_RADIUS
    for name in ("position", "absmag", "radius_pc", "rgb", "luminosity", "temperature"):
        if not np.isfinite(stars[name]).all():
            raise ValueError(f"Compiled star field {name} contains nonfinite values")
    return stars


def build_bvh(stars, leaf_size=128):
    """Deterministic median tree, with bounds enclosing the emitted spheres."""
    if leaf_size < 1:
        raise ValueError("leaf_size must be positive")
    permutation = np.arange(len(stars), dtype="<u4")
    positions = stars["position"]
    radii = stars["radius_pc"].astype(np.float64)
    nodes = []

    def visit(start, end):
        indices = permutation[start:end]
        lo = np.min(positions[indices] - radii[indices, None], axis=0)
        hi = np.max(positions[indices] + radii[indices, None], axis=0)
        center = lo + (hi - lo) * .5
        # A nextafter even when exactly representable also covers midpoint
        # arithmetic error and gives zero-width boxes a conservative extent.
        extent = np.nextafter(np.maximum(hi - center, center - lo).astype(np.float32), np.float32(np.inf))
        brightest = np.nextafter(np.float32(np.min(stars["absmag"][indices])), np.float32(-np.inf))
        radius = np.nextafter(np.float32(np.max(radii[indices])), np.float32(np.inf))
        index = len(nodes)
        nodes.append((center, extent, brightest, radius, 0, 0, start, end - start, 0))
        if end - start > leaf_size:
            axis = int(np.argmax(hi - lo))
            order = np.argsort(positions[indices, axis], kind="stable")
            permutation[start:end] = indices[order]
            midpoint = (start + end) // 2
            left, right = visit(start, midpoint), visit(midpoint, end)
            nodes[index] = (center, extent, brightest, radius, left, right, 0, 0, 0)
        return index

    visit(0, len(stars))
    return np.array(nodes, dtype=NODE_DTYPE), permutation


def make_search(rows, stars, extra_limit=10000):
    curated = json.loads(CURATED_RADIUS_PATH.read_text())["stars"]
    named = {i for i, row in enumerate(rows) if row.get("proper")}
    # A balanced merge of nearest and visually brightest source stars makes
    # useful catalog IDs searchable without shipping all 109k descriptive rows.
    by_distance = sorted(range(len(rows)), key=lambda i: (rows[i]["dist"], rows[i]["id"]))
    by_brightness = sorted(range(len(rows)), key=lambda i: (rows[i]["mag"], rows[i]["id"]))
    selected = set(named)
    extra_count = 0
    for near, bright in zip(by_distance, by_brightness):
        for i in (near, bright):
            if extra_count >= extra_limit:
                break
            extra_count += i not in selected
            selected.add(i)
        if extra_count >= extra_limit:
            break
    entries = []
    for i in sorted(selected):
        row, star = rows[i], stars[i]
        aliases = list(ALIASES.get(row["id"], []))
        aliases += [row.get(key, "") for key in ("proper", "bf", "gl")]
        aliases += [f"{prefix} {row[key]}" for key, prefix in (("hip", "HIP"), ("hd", "HD"), ("hr", "HR")) if row.get(key)]
        aliases.append(f"HYG {row['id']}")
        aliases = list(dict.fromkeys(alias for alias in aliases if alias))
        name = row.get("proper") or row.get("bf") or row.get("gl") or aliases[0]
        entry = dict(index=i, id=row["id"], name=name, aliases=aliases,
                            position=star["position"].tolist(), mag=row["mag"], absmag=row["absmag"],
                            bv=row["ci"], spect=row.get("spect", ""), distance=row["dist"],
                            hip=int(row["hip"]) if row.get("hip") else None,
                            radius_solar=float(star["radius_pc"]) / SOLAR_RADIUS_PC,
                     radius_pc=float(star["radius_pc"]), flags=int(star["flags"]),
                     radius_source="solar reference" if i == 0 else "illustrative estimate")
        measurement = curated.get(str(row["id"]))
        if measurement:
            entry.update(radius_source=measurement["citation"], radius_source_url=measurement["url"],
                         radius_uncertainty_solar=measurement["uncertainty_solar"],
                         radius_method=measurement["method"])
        entries.append(entry)
    return dict(version=1, epoch="J2000", frame="heliocentric equatorial", units="pc",
                named_count=len(named), additional_count=len(selected - named), stars=entries)


def compile_catalog(source=DEFAULT_SOURCE, output=DEFAULT_OUTPUT, *, extra_limit=10000, leaf_size=128):
    source, output = Path(source), Path(output)
    if not source.exists():
        download_source(source)
    rows, counts, source_hash = read_source(source)
    stars = compile_stars(rows)
    nodes, indices = build_bvh(stars, leaf_size)
    payload = bytearray(64)
    offsets = []
    for values in (stars, nodes, indices):
        payload.extend(bytes((-len(payload)) % 64))
        offsets.append(len(payload))
        payload.extend(values.tobytes())
    struct.pack_into("<9I", payload, 0, MAGIC, 1, len(stars), len(nodes), *offsets, 0, len(payload))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    compressed = gzip.compress(payload, compresslevel=6, mtime=0)
    output.with_suffix(output.suffix + ".gz").write_bytes(compressed)
    search = make_search(rows, stars, extra_limit)
    search_path = output.with_name(output.stem + "-search.json")
    search_path.write_text(json.dumps(search, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    search_path.with_suffix(".json.gz").write_bytes(gzip.compress(search_path.read_bytes(), compresslevel=6, mtime=0))
    counts.update(emitted_records=len(stars), catalog_stars=len(stars) - 1,
                  synthetic_sun_records=1, emitted_named=search["named_count"],
                  missing_bv=int(np.count_nonzero(stars["flags"] & FLAG_IMPUTED_BV)),
                  measured_radius=int(np.count_nonzero(stars["flags"] & FLAG_MEASURED_RADIUS)))
    metadata = dict(
        format="CUAT", version=1, byte_order="little-endian", star_bytes=64, node_bytes=64,
        bytes=len(payload), gzip_bytes=len(compressed), sha256=hashlib.sha256(payload).hexdigest(),
        counts=counts, nodes=len(nodes), leaf_size=leaf_size,
        offsets=dict(zip(("stars", "nodes", "indices"), offsets)),
        search=dict(file=search_path.name, records=len(search["stars"]),
                    named=search["named_count"], additional=search["additional_count"]),
        source=dict(name="HYG Database", version="4.2", publisher="Astronomy Nexus",
                    url=SOURCE_URL, project="https://www.astronexus.com/projects/hyg",
                    documentation="https://www.astronexus.com/projects/hyg-details",
                    sha256=source_hash, official_release_hash_matches=source_hash == SOURCE_SHA256,
                    license="CC BY-SA 4.0", license_url="https://creativecommons.org/licenses/by-sa/4.0/"),
        coordinates=dict(epoch="J2000.0", equinox="J2000.0", origin="Sun", units="parsec",
                         frame="heliocentric equatorial", x="RA 0h, Dec 0 degrees (vernal equinox)",
                         y="RA 6h, Dec 0 degrees", z="north celestial pole",
                         motion="Fixed source epoch; no proper-motion, orbit, or radial-velocity propagation"),
        bounds_pc=dict(min=stars["position"].min(axis=0).tolist(), max=stars["position"].max(axis=0).tolist()),
        flags={"synthetic_sun": FLAG_SUN, "illustrative_radius": FLAG_ESTIMATED_RADIUS,
               "missing_bv_imputed": FLAG_IMPUTED_BV, "estimated_temperature": FLAG_ESTIMATED_TEMPERATURE,
               "measured_radius": FLAG_MEASURED_RADIUS},
        modifications=["Remove source rows with dist >= 100000 pc (unknown/dubious parallax sentinel)",
                       "Remove nonfinite or invalid spatial/photometric records; counts reported separately",
                       "Replace source id 0 Sun with a synthetic reference at the exact coordinate origin",
                       "Compile illustrative colors, temperatures, and stellar radii; retain original HYG IDs",
                       "Replace radii for Alpha Centauri A/B, Proxima, and Sirius with cited interferometric measurements",
                       "Pack records in source order; build a conservative median-split BVH and search subset"],
        appearance=dict(
            colors="Authored B-V color palette; illustrative display RGB, not calibrated spectra",
            temperature="Approximate Ballesteros B-V formula, input clipped to [-0.4, 2.5]; missing B-V=0.65",
            temperature_reference="https://arxiv.org/abs/1201.1809",
            radius="Illustrative sqrt(HYG luminosity) * (5772 / estimated_temperature)^2 solar radii",
            luminosity="HYG lum derives from visual absolute magnitude; not a validated bolometric luminosity",
            radius_warning="Except for Sun and four explicitly flagged interferometric measurements, radii are visual scale cues, especially uncertain for giants or cool dwarfs",
            curated_radii=json.loads(CURATED_RADIUS_PATH.read_text()),
            sun=dict(radius_pc=SOLAR_RADIUS_PC, temperature_k=5772, luminosity_solar=1, absmag_v=4.83)),
        limitations=["HYG is a heterogeneous Hipparcos/Yale/Gliese catalog, not a complete census or a full Milky Way model",
                     "Distance and component identifiers inherit source limitations; per-star uncertainty estimates are not supplied here",
                     "Fixed J2000 source positions are not current-time ephemerides or precise binary-star orbits",
                     "Catalog visual luminosities omit bolometric corrections; non-Sun temperatures and uncurated radii are illustrative",
                     "Pleiades search alias points to its member Alcyone, not a measured cluster centroid"],
    )
    metadata_path = output.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    metadata_path.with_suffix(".json.gz").write_bytes(gzip.compress(metadata_path.read_bytes(), compresslevel=6, mtime=0))
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--download", action="store_true", help="Re-fetch and verify the pinned official source")
    args = parser.parse_args()
    if args.download:
        download_source(args.source)
    report = compile_catalog(args.source, args.output)
    print(json.dumps({key: report[key] for key in ("counts", "nodes", "bytes", "gzip_bytes", "sha256")}, indent=2))
