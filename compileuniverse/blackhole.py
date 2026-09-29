"""Compiled optical queries -> composed character cells -> ANSI.

Free camera motion samples the geodesic transfer table; disk animation samples
object-space charts. There is no mesh, scene raster, or runtime ODE integrator.
"""
from __future__ import annotations

from pathlib import Path
import time as clock

import numpy as np

from .appearance import Appearance
from .lensing import LensingTable
from .render import Camera, TextFrame

GLYPHS = np.array(list(" .,:;!i~+*rnxzjftLCJUYXZO0Qmwqpdbkhao#MW&8%B@$"))


def default_camera():
    position = np.array([0., 3.6, 60.])
    return Camera(position, np.pi, -np.arctan2(3.6, 60.), 22.)


def box_blur(values, radius, axis):
    if radius == 0:
        return values
    padding = [(0, 0)] * values.ndim
    padding[axis] = (radius, radius)
    expanded = np.pad(values, padding, mode="edge")
    cumulative = np.cumsum(expanded, axis=axis)
    leading = [(0, 0)] * values.ndim
    leading[axis] = (1, 0)
    cumulative = np.pad(cumulative, leading)
    left, right = [slice(None)] * values.ndim, [slice(None)] * values.ndim
    left[axis] = slice(None, -(2 * radius + 1))
    right[axis] = slice(2 * radius + 1, None)
    return (cumulative[tuple(right)] - cumulative[tuple(left)]) / (2 * radius + 1)


def blur(values, x, y):
    return box_blur(box_blur(values, x, 1), y, 0)


class BlackHoleRenderer:
    def __init__(self):
        self.lensing = LensingTable()
        self.appearance = Appearance()
        self._geometry_key = None
        self._geometry = None
        asset = Path(__file__).resolve().parents[1] / "artifacts"
        self.asset_bytes = self.appearance.bytes + sum(p.stat().st_size for p in asset.glob("lensing*.npz"))

    def close(self):
        self._geometry = None
        self._geometry_key = None

    def geometry(self, camera, cols, rows):
        key = (tuple(camera.position), camera.yaw, camera.pitch, camera.fov, cols, rows)
        if self._geometry_key == key:
            return self._geometry, True, 0.
        started = clock.perf_counter()
        right, up, forward = camera.basis()
        tan_y = np.tan(np.radians(camera.fov) / 2)
        tan_x = tan_y * cols / (rows * 1.8)
        x = ((np.arange(cols) + .5) / cols * 2 - 1) * tan_x
        y = (1 - (np.arange(rows) + .5) / rows * 2) * tan_y
        xx, yy = np.meshgrid(x, y)
        rays = forward + xx.reshape(-1, 1) * right + yy.reshape(-1, 1) * up
        rays /= np.linalg.norm(rays, axis=1)[:, None]
        result = self.lensing.trace(camera.position, rays)
        sky_directions = result["outgoing"].reshape(rows, cols, 3)
        dx = np.linalg.norm(np.gradient(sky_directions, axis=1), axis=2)
        dy = np.linalg.norm(np.gradient(sky_directions, axis=0), axis=2)
        footprint = np.clip(np.sqrt(np.maximum(dx * dy, 1e-10)), 1e-5, .35).ravel()
        result["sky"] = self.appearance.sky(result["outgoing"], footprint)
        sky_peak = np.max(result["sky"], axis=1)
        # An exposure floor keeps the unresolved galactic haze from filling
        # every otherwise empty cell, while preserving the brighter sources.
        result["sky"] *= np.maximum(sky_peak - .025, 0)[:, None] / np.maximum(sky_peak[:, None], 1e-12)
        result["sky"][result["captured"]] = 0
        result["rays"] = rays
        radius = np.linalg.norm(result["crossings"], axis=-1)
        result["disk_valid"] = result["crossing_valid"] & (radius > 3.) & (radius < 16.)
        self._geometry_key, self._geometry = key, result
        return result, False, (clock.perf_counter() - started) * 1000

    def frame(self, camera=None, time=0., cols=220, rows=94, exposure=1., bloom=True, palette="ember"):
        started = clock.perf_counter()
        camera = camera or default_camera()
        if not isinstance(cols, (int, np.integer)) or not isinstance(rows, (int, np.integer)) or not (16 <= cols <= 320 and 8 <= rows <= 120):
            raise ValueError("grid must be 16..320 columns and 8..120 rows")
        position = np.asarray(camera.position)
        numbers = [camera.yaw, camera.pitch, camera.fov, time, exposure]
        if position.shape != (3,) or not np.isfinite(position).all() or not np.isfinite(numbers).all():
            raise ValueError("camera, time, and exposure must be finite")
        radius = float(np.linalg.norm(position))
        rmin, rmax = (self.lensing.metadata[k] for k in ("observer_radius_min", "observer_radius_max"))
        if not rmin <= radius <= rmax:
            raise ValueError(f"black-hole camera must be {rmin:g}..{rmax:g} Schwarzschild radii from the origin")
        if not 15 <= camera.fov <= 110 or not .1 <= exposure <= 4 or abs(time) > 1e9:
            raise ValueError("FOV must be 15..110, exposure .1..4, and time within +/-1e9 seconds")
        if palette not in {"ember", "ice"}:
            raise ValueError("palette must be ember or ice")
        geometry, cached, lookup_ms = self.geometry(camera, cols, rows)
        count = cols * rows
        light = np.zeros((count, 3))
        transmission = np.ones(count)
        disk_valid = geometry["disk_valid"]
        # Multiple disk images are composited in ray order, before glyphs.
        for crossing in range(disk_valid.shape[1]):
            valid = disk_valid[:, crossing]
            if not np.any(valid):
                continue
            emission, alpha = self.appearance.disk_light(geometry["crossings"][valid, crossing],
                geometry["tangents"][valid, crossing], time, radius, palette)
            light[valid] += (transmission[valid] * alpha)[:, None] * emission
            transmission[valid] *= (1 - alpha)
        light += transmission[:, None] * geometry["sky"] * .7
        # Captured rays may see foreground disk; otherwise absolutely no sky or
        # display glow is allowed into the shadow, including background colors.
        shadow = geometry["captured"] & ~np.any(disk_valid, axis=1)
        light[shadow] = 0
        light = np.maximum(light.reshape(rows, cols, 3), 0)
        mask = shadow.reshape(rows, cols)
        if bloom:
            glow = blur(light, 2, 1) * .15 + blur(light, 6, 3) * .12 + blur(light, 14, 7) * .10
            glow[mask] = 0
        else:
            glow = np.zeros_like(light)
        combined = light + glow * .20
        peak = np.max(combined, axis=2)
        brightness = 1 - np.exp(-peak * exposure * .86)
        index = np.clip(np.floor(brightness ** .64 * (len(GLYPHS) - 1) + .5).astype(int), 0, len(GLYPHS) - 1)
        glyphs = GLYPHS[index]
        glyphs[brightness < .009] = " "
        # Tiny point sources read better as punctuation. The structure of the
        # disk comes from the actual filtered light field, not random symbols.
        points = ~np.any(disk_valid, axis=1).reshape(rows, cols) & (peak > .18) & (peak < 1.)
        glyphs[points] = np.where(peak[points] > .5, "+", "*")
        chroma = combined / np.maximum(peak[..., None], 1e-12)
        foreground = chroma * (.15 + .85 * brightness ** .37)[..., None]
        colors = (np.clip(np.round(foreground * 31), 0, 31) * (255 / 31)).astype(np.uint8)
        colors[glyphs == " "] = 0
        background = (1 - np.exp(-glow * exposure * 1.2)) * 64
        backgrounds = (np.clip(np.round(background / 3), 0, 85) * 3).astype(np.uint8)
        glyphs[mask], colors[mask], backgrounds[mask] = " ", 0, 0
        stats = {"scene": "blackhole", "backend": "compiled-lut", "cols": cols, "rows": rows,
                 "time": float(time), "camera_radius": radius, "exposure": float(exposure),
                 "shadow_cells": int(shadow.sum()), "disk_cells": int(np.any(disk_valid, axis=1).sum()),
                 "samples": count, "rays": count, "asset_bytes": self.asset_bytes,
                 "cached_geometry": cached, "lookup_ms": lookup_ms,
                 "frame_ms": (clock.perf_counter() - started) * 1000,
                 "description": "Compiled Schwarzschild paths; illustrative disk, color, time, and distant sky"}
        return TextFrame(glyphs, colors, stats, backgrounds)
