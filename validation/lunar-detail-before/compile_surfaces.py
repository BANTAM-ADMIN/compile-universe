#!/usr/bin/env python3
"""Compile compact surface charts for direct character-cell sampling.

Moon and Mars use credited NASA maps. All other charts in this file are
deterministic illustrations, not observations or inferred exoplanet geography.
No mesh, scene renderer, or image-generation service is used by this compiler.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import urllib.request

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data/sources"
OUT = ROOT / "artifacts"
WIDTH, HEIGHT = 512, 256
LAT, LON = np.meshgrid(np.linspace(np.pi / 2, -np.pi / 2, HEIGHT),
                       np.linspace(-np.pi, np.pi, WIDTH, endpoint=False), indexing="ij")
XYZ = np.stack((np.cos(LAT) * np.cos(LON), np.cos(LAT) * np.sin(LON), np.sin(LAT)), -1)
SEED = 20260926
SOURCES = {
    "moon": {
        "url": "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg",
        "cache": "moon-lroc-2025.jpg", "name": "NASA CGI Moon Kit, updated 2025 LROC color map",
        "page": "https://svs.gsfc.nasa.gov/4720/", "credit": "NASA's Scientific Visualization Studio; Ernie Wright",
    },
    "mars": {
        "url": "https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/mars/Mars.jpg",
        "cache": "mars-viking.jpg", "name": "NASA Mars texture; Viking imagery processed by USGS",
        "page": "https://science.nasa.gov/3d-resources/mars/", "credit": "NASA/Jet Propulsion Laboratory & Caltech",
    },
}


def noise(seed, scales=(32, 14, 5, 1.6)):
    """Periodic longitude, with decreasing high-frequency contribution."""
    rng = np.random.default_rng(seed)
    result = np.zeros((HEIGHT, WIDTH))
    for octave, scale in enumerate(scales):
        field = gaussian_filter(rng.standard_normal(result.shape), scale, mode=("reflect", "wrap"))
        result += field / max(field.std(), 1e-9) * .52 ** octave
    return result / result.std()


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def cratered(seed, low, high, count=160):
    n = noise(seed)
    relief = np.zeros((HEIGHT, WIDTH))
    rng = np.random.default_rng(seed + 1)
    for _ in range(count):
        z, lon = rng.uniform(-1, 1), rng.uniform(-np.pi, np.pi)
        direction = [np.sqrt(1 - z*z) * np.cos(lon), np.sqrt(1 - z*z) * np.sin(lon), z]
        radius = rng.uniform(.012, .13)
        d = np.arccos(np.clip(XYZ @ direction, -1, 1)) / radius
        relief += .3 * np.exp(-((d - 1) / .15)**2) - .18 * np.exp(-(d / .72)**4)
    return mix(low, high, .48 + .14 * n + relief)


def bands(seed, low, high, frequency, contrast=1):
    n = noise(seed)
    phase = LAT * frequency + .25 * n + .35 * np.sin(3 * LON + 4 * LAT)
    t = .48 + contrast * (.22 * np.sin(phase) + .13 * np.sin(phase * 2.3) + .045 * n)
    return mix(low, high, t)


def authored_charts():
    charts = {}
    charts["mercury"] = cratered(SEED, [66, 61, 57], [191, 181, 163])
    charts["venus"] = bands(SEED + 2, [166, 122, 58], [250, 227, 164], 8, .65)
    jupiter = bands(SEED + 3, [110, 57, 39], [244, 224, 185], 23, 1.35)
    # An authored storm emblem, not a dated photograph of the Great Red Spot.
    dl = np.arctan2(np.sin(LON - .6), np.cos(LON - .6))
    oval = (dl / .25)**2 + ((LAT + .38) / .105)**2
    storm = np.clip(1.5 - oval, 0, 1)[..., None]
    storm_color = mix([170, 69, 42], [232, 152, 92], .5 + .3 * np.sin(oval * 13))
    charts["jupiter"] = jupiter * (1 - storm) + storm_color * storm
    charts["saturn"] = bands(SEED + 4, [159, 128, 82], [242, 220, 170], 30, .8)
    charts["uranus"] = bands(SEED + 5, [90, 178, 180], [184, 232, 218], 13, .45)
    charts["neptune"] = bands(SEED + 6, [31, 67, 155], [92, 162, 224], 16, 1)
    n = noise(SEED + 7)
    io = mix([192, 127, 39], [248, 224, 133], .56 + .22 * n)
    volcano = np.clip((-n - 1.3) * 2.1, 0, 1)[..., None]
    charts["io"] = io * (1 - volcano) + np.array([91, 51, 30]) * volcano
    for key, seed, dark, pale, amount in [
        ("europa", SEED + 8, [130, 81, 54], [233, 222, 195], .7),
        ("enceladus", SEED + 9, [97, 139, 164], [236, 244, 241], .42),
    ]:
        n = noise(seed)
        cracks = np.exp(-(np.sin(7*LON + 3*np.sin(5*LAT) + .7*n) / .09)**2)
        cross = np.exp(-(np.sin(11*LAT + 2*np.sin(4*LON) + .45*n) / .065)**2)
        t = np.clip(.91 + .035*n - amount*np.maximum(cracks, cross*.7), 0, 1)
        charts[key] = mix(dark, pale, t)
    charts["titan"] = bands(SEED + 10, [155, 94, 32], [232, 184, 91], 5, .5)
    charts["temperate-rock"] = cratered(SEED + 11, [67, 62, 64], [190, 150, 115], 100)
    charts["hot-jupiter"] = bands(SEED + 12, [107, 51, 74], [239, 168, 112], 13, 1.2)
    n = noise(SEED + 13)
    lava = mix([36, 32, 39], [120, 83, 68], .42 + .19*n)
    fissures = np.exp(-(np.sin(6*LON + 2*np.sin(5*LAT) + .9*n) / .12)**2)
    glow = np.clip(fissures * 1.4, 0, 1)[..., None]
    charts["lava"] = lava*(1-glow) + np.array([255, 142, 37])*glow
    n = noise(SEED + 14)
    continents = np.clip((n-.15)*3, 0, 1)[..., None]
    sea = mix([13, 40, 112], [28, 104, 157], .5+.14*n)
    land = mix([47, 88, 62], [175, 165, 101], .5+.17*n)
    ocean = sea*(1-continents)+land*continents
    clouds = np.clip((noise(SEED+15,(20,7,2))-1.2)*.45,0,.8)[...,None]
    charts["ocean"] = ocean*(1-clouds)+np.array([221,232,232])*clouds
    charts["desert"] = mix([121,57,37],[235,192,120],.5+.18*noise(SEED+16))
    charts["violet"] = mix([65,44,90],[190,153,182],.48+.17*noise(SEED+17))
    charts["carbon"] = cratered(SEED+18,[29,32,37],[113,115,119],140)
    charts["ice-rock"] = cratered(SEED+19,[86,132,162],[226,235,234],110)
    return charts


def ring_chart():
    """Illustrated C/B/A rings, sampled over the documented physical bounds."""
    radius = np.linspace(74658, 136780, 1024)
    stripe = .065*np.sin(radius*.009) + .035*np.sin(radius*.034) + .018*np.sin(radius*.097)
    alpha = np.where(radius < 92000, .27, np.where(radius < 117507, .89, .64)) + stripe
    alpha[(radius >= 117507) & (radius <= 122340)] = .018  # Cassini division
    alpha[np.abs(radius-133590) < 160] = .04  # Encke gap, simplified
    alpha *= np.minimum((radius-radius[0])/350, 1) * np.minimum((radius[-1]-radius)/350, 1)
    shade = np.clip(.6 + 2*stripe + .16*np.sin(radius*.00031), 0, 1)
    rgb = mix([117, 106, 91], [230, 215, 182], shade)
    return np.concatenate([rgb, np.clip(alpha, 0, 1)[:, None]*255], axis=1).astype(np.uint8)


def write_asset(name, pixels):
    data = np.clip(pixels, 0, 255).astype(np.uint8).tobytes()
    (OUT / name).write_bytes(data)
    (OUT / (name + ".gz")).write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    return {"url": "/artifacts/"+name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(exist_ok=True)
    metadata = {"version": 1, "seed": SEED, "surfaces": {},
                "limitations": "Maps are downsampled to 512×256 for character-cell sampling. Apart from the credited NASA Moon/Mars maps and the separately compiled Earth map, every appearance is an authored illustration. Exoplanet colors, weather and geography are not measured. Rotation phase and speed are illustrative."}
    charts = authored_charts()
    for key, source in SOURCES.items():
        path = CACHE / source["cache"]
        if args.refresh or not path.exists():
            request = urllib.request.Request(source["url"], headers={"User-Agent": "COMPILEUNIVERSE/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                path.write_bytes(response.read())
        charts[key] = np.array(Image.open(io.BytesIO(path.read_bytes())).convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS))
    for key, chart in charts.items():
        entry = write_asset(f"surface-{key}.bin", chart)
        entry.update(width=WIDTH, height=HEIGHT, channels=3,
                     format="RGB8 equirectangular; longitude -180..180, latitude +90..-90",
                     appearanceClass="NASA source map" if key in SOURCES else "authored illustration")
        if key in SOURCES:
            entry["source"] = {**SOURCES[key], "sha256": hashlib.sha256((CACHE / SOURCES[key]["cache"]).read_bytes()).hexdigest()}
        metadata["surfaces"][key] = entry
    metadata["rings"] = {"saturn": {**write_asset("rings-saturn.bin", ring_chart()),
        "width": 1024, "channels": 4, "format": "RGBA8 radial chart, linear inner to outer",
        "innerRadiusKm": 74658, "outerRadiusKm": 136780,
        "appearanceClass": "authored illustration",
        "limitations": "Illustrated C, B and A rings; opacity, color and fine banding are authored. D, E, F and G rings omitted. Finite thin annulus, not individual particles."}}
    narrow_ring=np.zeros((256,4),dtype=np.uint8)
    shade=1+.08*np.sin(np.linspace(0,20*np.pi,256))
    narrow_ring[:,:3]=(np.array([194,196,203])*shade[:,None]).astype(np.uint8)
    narrow_ring[:,3]=128
    metadata["rings"]["haumea"]={**write_asset("rings-haumea.bin",narrow_ring),"width":256,"channels":4,
        "innerRadiusKm":2252,"outerRadiusKm":2322,"appearanceClass":"authored color and fine banding; approximate published width and opacity",
        "source":"https://arxiv.org/abs/2006.03113"}
    (OUT / "surface-metadata.json").write_text(json.dumps(metadata, indent=2)+"\n")
    print(f"Compiled {len(charts)} surface charts and {len(metadata['rings'])} radial ring charts")


if __name__ == "__main__":
    main()
