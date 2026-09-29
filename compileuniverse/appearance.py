"""Offline appearance compiler and inexpensive, deterministic asset samplers.

The disk charts are in object coordinates, never camera coordinates. The sky is
an illustrative distant environment, not a catalog as seen from Sagittarius A*.
No procedural noise or star population generation runs in the frame loop.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "artifacts/appearance.npz"
VERSION = 1


def compile_appearance(destination=ASSET):
    started = time.perf_counter()
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20260926)
    # Seamless spherical signal. All expensive layered noise is evaluated once.
    width, height = 1536, 768
    longitude = (np.arange(width, dtype=np.float32) + .5) / width * (2 * np.pi) - np.pi
    latitude = np.pi / 2 - (np.arange(height, dtype=np.float32) + .5) / height * np.pi
    lon, lat = np.meshgrid(longitude, latitude)
    sphere = np.stack((np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)), axis=-1)
    cloud = np.zeros((height, width), np.float32)
    detail = np.zeros_like(cloud)
    for k in range(18):
        axis = rng.normal(size=3)
        axis *= (4.5 * 1.38 ** k) / np.linalg.norm(axis)
        wave = np.sin(np.sum(sphere * axis, axis=-1) + rng.uniform(0, 2 * np.pi))
        cloud += wave * (.78 ** k)
        if k > 5:
            detail += wave * (.86 ** (k - 6))
    cloud = .5 + .19 * cloud
    band_distance = lat - .27 * np.sin(lon + .7) + .1
    band = np.exp(-(band_distance / .21) ** 2)
    haze = np.maximum(cloud, .0) ** 2 * band
    dust = np.exp(-((band_distance + .035 * detail) / .045) ** 2) * .7
    sky = np.zeros((height, width, 3), np.float32)
    sky += np.array([.0007, .0010, .0025], np.float32)
    sky += (haze * (1 - dust))[..., None] * np.array([.033, .024, .068])
    sky += (haze * np.maximum(detail, 0) * .25)[..., None] * np.array([.055, .022, .018])
    sky += (np.exp(-((lat + .36 + .17 * np.sin(lon * 2)) / .35) ** 2)
            * np.maximum(cloud - .5, 0))[..., None] * np.array([.008, .029, .036])

    # Stable unresolved sources, prefiltered into a sky pyramid. Their locations
    # are intentionally illustrative; metadata keeps them separate from the lab.
    count = 17000
    star_lon = rng.uniform(-np.pi, np.pi, count)
    star_lat = np.arcsin(rng.uniform(-1, 1, count))
    clustered = rng.random(count) < .56
    star_lat[clustered] = np.clip(.27 * np.sin(star_lon[clustered] + .7) - .1
                                + rng.normal(0, .16, clustered.sum()), -1.5, 1.5)
    star_x = (star_lon / (2 * np.pi) + .5) * width - .5
    star_y = (.5 - star_lat / np.pi) * height - .5
    brightness = np.minimum(.22 / rng.uniform(.02, 1, count) ** 1.2, 24)
    star_palette = np.array([[.65, .78, 1.], [.84, .88, 1.], [1., .93, .78], [1., .62, .35]], np.float32)
    star_colors = star_palette[rng.choice(4, count, p=[.30, .30, .32, .08])]
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            ix, iy = np.floor(star_x).astype(int) + dx, np.floor(star_y).astype(int) + dy
            power = np.exp(-((ix - star_x) ** 2 + (iy - star_y) ** 2) / .65)
            valid = (iy >= 0) & (iy < height)
            np.add.at(sky, (iy[valid], ix[valid] % width),
                      star_colors[valid] * (brightness[valid] * power[valid])[:, None])

    # Differentially rotating, periodic charts. The runtime advects the chart
    # by each radius's compiled orbital speed; no prerecorded camera frames.
    disk_h, disk_w = 384, 1024
    radial = np.linspace(3., 16., disk_h, dtype=np.float32)[:, None]
    angle = (np.arange(disk_w, dtype=np.float32) + .5)[None, :] / disk_w * 2 * np.pi
    noise = np.zeros((disk_h, disk_w), np.float32)
    for k in range(24):
        angular_frequency = int(rng.integers(1, 4 + k * 3))
        radial_frequency = rng.uniform(1, 3 + k * .7)
        phase = rng.uniform(0, 2 * np.pi)
        noise += np.sin(angle * angular_frequency + radial * radial_frequency + phase) * (.89 ** k)
    noise *= .23
    strands = .5 + .5 * np.sin(radial * 32 + noise * 3 + .7 * np.sin(angle * 5 + radial))
    fine = .5 + .5 * np.sin(radial * 78 + .5 * np.sin(angle * 13 - radial * 2))
    density = np.clip(.52 + noise * .5 + strands * .28 + fine * .08, .08, 1.6)
    # A few bright filaments form long coherent features under orbital shear.
    filaments = np.exp(-((np.sin(angle * 3 - np.log(radial) * 4 + noise * .4)) / .12) ** 2)
    density += .3 * filaments
    temperature = np.clip(.92 + noise * .18 + strands * .1, .65, 1.3)
    disk = np.stack((density, temperature), axis=-1).astype(np.float16)

    r = np.linspace(3., 16., 1024)
    profile = np.maximum((3 / r) ** 3 * (1 - np.sqrt(3 / r)), 0)
    profile /= profile.max()
    edge = np.clip((r - 3) / .38, 0, 1) * np.clip((16 - r) / 3, 0, 1)
    # Artistically exposed disk; the real Sgr A* flow is different and much dimmer.
    radial_data = np.stack((profile ** .95 * edge, .45 * (r / 3) ** -1.5,
                           3900 + 7000 * profile ** .25, edge), axis=-1).astype(np.float32)
    temps = np.array([1800, 2600, 3600, 4800, 6500, 8500, 11000, 16000, 28000])
    # An explicit art palette, not a claim of colorimetric black-body accuracy.
    shades = np.array([[1., .14, .016], [1., .28, .038], [1., .46, .10], [1., .65, .25],
                       [1., .81, .49], [1., .92, .73], [1., .98, .92], [.79, .88, 1.], [.59, .75, 1.]])
    temperature_axis = np.linspace(1800, 28000, 1024)
    color_table = np.stack([np.interp(temperature_axis, temps, shades[:, k]) for k in range(3)], axis=-1).astype(np.float32)

    arrays = {"version": np.array(VERSION), "disk": disk, "radial": radial_data, "temperature": color_table}
    for level in range(7):
        arrays[f"sky{level}"] = sky.astype(np.float16)
        if level != 6:
            sky = .25 * (sky[0::2, 0::2] + sky[1::2, 0::2] + sky[0::2, 1::2] + sky[1::2, 1::2])
    np.savez_compressed(destination, **arrays)
    metadata = {"version": VERSION, "bytes": destination.stat().st_size,
                "compile_seconds": round(time.perf_counter() - started, 3),
                "seed": 20260926, "sky_sources": count,
                "disk": "Periodic density and temperature charts in object coordinates; differential rotation at playback",
                "sky": "Illustrative distant stars and galactic haze; seven levels of integrated angular detail",
                "color": "Authored temperature palette; disk brightness and time are illustrative",
                "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "arrays_sha256": hashlib.sha256(b"".join(np.ascontiguousarray(arrays[k]).tobytes() for k in sorted(arrays))).hexdigest()}
    destination.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def sample_chart(chart, u, v):
    """Bilinear periodic longitude / clamped latitude sampling."""
    height, width = chart.shape[:2]
    x = (np.asarray(u) % 1) * width - .5
    y = np.clip(np.asarray(v), 0, 1) * (height - 1)
    ix, iy = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    fx, fy = (x - ix)[..., None], (y - iy)[..., None]
    top = chart[iy, ix % width] * (1 - fx) + chart[iy, (ix + 1) % width] * fx
    iy1 = np.minimum(iy + 1, height - 1)
    bottom = chart[iy1, ix % width] * (1 - fx) + chart[iy1, (ix + 1) % width] * fx
    return top * (1 - fy) + bottom * fy


class Appearance:
    def __init__(self, path=ASSET):
        path = Path(path)
        if not path.exists():
            compile_appearance(path)
        with np.load(path, allow_pickle=False) as source:
            if int(source["version"]) != VERSION:
                raise ValueError("Appearance asset version mismatch; run compile_appearance.py")
            self.sky_levels = [source[f"sky{k}"].astype(np.float32) for k in range(7)]
            self.disk = source["disk"].astype(np.float32)
            self.radial = source["radial"].copy()
            self.temperature = source["temperature"].copy()
        self.bytes = path.stat().st_size

    def sky(self, directions, footprint):
        u = np.arctan2(directions[:, 0], directions[:, 2]) / (2 * np.pi) + .5
        v = .5 - np.arcsin(np.clip(directions[:, 1], -1, 1)) / np.pi
        # Filter by the angular size of a character. Lensing changes that size,
        # so callers supply local ray-direction derivatives, not just FOV.
        level = np.clip(np.log2(np.maximum(footprint, 1e-6) * self.sky_levels[0].shape[1] / (2 * np.pi)), 0, 6)
        low = np.floor(level).astype(int)
        result = np.zeros((len(u), 3), np.float64)
        for k in range(7):
            mask = (low == k)
            if np.any(mask):
                a = sample_chart(self.sky_levels[k], u[mask], v[mask])
                b = sample_chart(self.sky_levels[min(k + 1, 6)], u[mask], v[mask])
                weight = (level[mask] - k)[:, None]
                result[mask] = a * (1 - weight) + b * weight
        return result

    def disk_light(self, points, tangents, time, camera_radius, palette="ember"):
        radius = np.linalg.norm(points, axis=1)
        ix = np.clip((radius - 3) / 13 * (len(self.radial) - 1), 0, len(self.radial) - 1)
        base = np.floor(ix).astype(int)
        f = (ix - base)[:, None]
        radial = self.radial[base] * (1 - f) + self.radial[np.minimum(base + 1, len(self.radial) - 1)] * f
        angle = np.arctan2(points[:, 2], points[:, 0])
        u = (angle - time * radial[:, 1]) / (2 * np.pi)
        fields = sample_chart(self.disk, u, (radius - 3) / 13)
        velocity = np.stack((-points[:, 2], np.zeros(len(points)), points[:, 0]), axis=-1)
        velocity /= np.maximum(radius[:, None], 1e-12)
        beta = np.sqrt(.5 / np.maximum(radius - 1, .01))
        toward_camera = -np.sum(velocity * tangents, axis=1)
        doppler = np.sqrt(1 - beta * beta) / (1 - beta * toward_camera)
        shift = doppler * np.sqrt(np.maximum(1 - 1 / radius, .01) / (1 - 1 / camera_radius))
        temperature = radial[:, 2] * fields[:, 1] * shift
        ti = np.clip((temperature - 1800) / (28000 - 1800) * (len(self.temperature) - 1), 0, len(self.temperature) - 1)
        t0 = np.floor(ti).astype(int)
        tf = (ti - t0)[:, None]
        rgb = self.temperature[t0] * (1 - tf) + self.temperature[np.minimum(t0 + 1, len(self.temperature) - 1)] * tf
        if palette == "ice":
            rgb = rgb[:, [2, 1, 0]] * np.array([.75, 1., 1.2])
        emission = rgb * (radial[:, 0] * fields[:, 0] ** 1.35 * np.clip(shift, .15, 3) ** 2.6 * 3.1)[:, None]
        alpha = np.clip((.56 + .35 * fields[:, 0]) * radial[:, 3], 0, .96)
        return emission, alpha
