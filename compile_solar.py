#!/usr/bin/env python3
"""Compile the Earth reference body, without network access during playback.

Source inputs are cached verbatim. Repeat builds reuse them unless --refresh is
given. Positions are a fixed J2000 snapshot, not a running solar-system model.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data/sources"
ARTIFACTS = ROOT / "artifacts"
EARTH_URL = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/august/world.topo.200408.3x5400x2700.jpg"
KM_PER_PC = 3.085677581491367e13
PC_PER_AU = math.pi / (180 * 3600)


def fetch(url, name, refresh=False):
    path = CACHE / name
    if refresh or not path.exists():
        print(f"Downloading {name}", flush=True)
        request = urllib.request.Request(url, headers={"User-Agent": "COMPILEUNIVERSE/1.0 scientific-data compiler"})
        data = urllib.request.urlopen(request, timeout=60).read()
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)
    return path.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    ARTIFACTS.mkdir(exist_ok=True)
    params = {"format": "json", "COMMAND": "'399'", "EPHEM_TYPE": "'VECTORS'",
              "CENTER": "'500@10'", "TLIST": "'2451545.0'", "REF_PLANE": "'FRAME'",
              "REF_SYSTEM": "'ICRF'", "OUT_UNITS": "'AU-D'", "VEC_TABLE": "'2'", "CSV_FORMAT": "'YES'"}
    query = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    source = fetch(query, "horizons-earth-j2000.json", args.refresh)
    result = json.loads(source)["result"]
    if "Reference frame : ICRF" not in result or "Center body name: Sun (10)" not in result:
        raise ValueError("Unexpected Horizons reference frame or origin")
    record = result.split("$$SOE\n", 1)[1].split("\n$$EOE", 1)[0].strip().split(",")
    if float(record[0]) != 2451545:
        raise ValueError("Unexpected Horizons epoch")
    position_au = [float(x) for x in record[2:5]]
    if not all(math.isfinite(x) for x in position_au) or not .98 < math.dist(position_au, [0, 0, 0]) < 1.02:
        raise ValueError("Unexpected Earth position")

    original = fetch(EARTH_URL, "earth-nasa-topography-august.jpg", args.refresh)
    chart = Image.open(io.BytesIO(original)).convert("RGB").resize((1024, 512), Image.Resampling.LANCZOS)
    data = chart.tobytes()
    (ARTIFACTS / "earth.bin").write_bytes(data)
    (ARTIFACTS / "earth.bin.gz").write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    from compile_night import compile_night
    night=compile_night(args.refresh)
    from compile_orientation import compile_orientation
    compile_orientation()
    metadata = {
        "version": 1, "epoch": "J2000.0", "julianDateTDB": 2451545.0,
        "epochDescription": "2000-01-01 12:00 TDB; positions remain fixed during travel",
        "frame": "ICRF heliocentric; aligned with catalog J2000 axes to displayed precision",
        "earth": {
            "id": "earth", "name": "Earth", "position": [x * PC_PER_AU for x in position_au],
            "emission": night,
            "positionAU": position_au, "radiusKm": 6371.0084, "radiusPc": 6371.0084 / KM_PER_PC,
            "texture": {"url": "/artifacts/earth.bin", "width": 1024, "height": 512, "channels": 3,
                        "format": "RGB8, row-major, equirectangular, west -180 to east +180, north to south",
                        "sha256": hashlib.sha256(data).hexdigest()},
            "positionSource": {"name": "NASA/JPL Horizons, DE441", "url": query,
                               "sha256": hashlib.sha256(source).hexdigest()},
            "radiusSource": "https://ssd.jpl.nasa.gov/planets/phys_par.html",
            "appearanceSource": {"name": "NASA Blue Marble Next Generation, August 2004, topography; no ocean-floor relief",
                                 "url": EARTH_URL, "sha256": hashlib.sha256(original).hexdigest(),
                                 "credit": "NASA Earth Observatory; Reto Stockli and Robert Simmon",
                                 "usage": "https://www.nasa.gov/nasa-brand-center/images-and-media/"},
            "orientationSource": {"url": "/artifacts/earth-orientation.json", "model": "IAU 2006 / 2000A, UTC-driven Earth rotation angle"},
            "limitations": "Spherical mean-radius Earth. Rotation follows the UTC clock; UT1-UTC and polar motion are omitted. The planet center and sunlight geometry retain the fixed J2000 scene epoch. NASA surface maps are downsampled offline; atmosphere, exposure and tint are illustrative, not current weather."
        }
    }
    (ARTIFACTS / "solar.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Compiled Earth: {len(data):,} RGB bytes; JPL position {metadata['earth']['position']} pc")


if __name__ == "__main__":
    main()
