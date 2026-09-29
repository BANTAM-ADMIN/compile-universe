"""Visibility -> scalar cell contributions -> glyph/color. No pixel framebuffer."""
from __future__ import annotations

from dataclasses import dataclass, field
import time as clock

import numpy as np

from .scene import Scene
from .visibility import Visibility

RAMP = np.array(list(" .,:;irsXA253hMHGS#9B&@"))


@dataclass
class Camera:
    position: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=np.float64))
    yaw: float = 0.
    pitch: float = 0.
    fov: float = 55.

    def basis(self):
        sy, cy = np.sin(self.yaw), np.cos(self.yaw)
        sp, cp = np.sin(self.pitch), np.cos(self.pitch)
        forward = np.array([sy * cp, sp, cy * cp])
        right = np.array([-cy, 0., sy])
        up = np.cross(right, forward)
        return right, up, forward


@dataclass
class TextFrame:
    glyphs: np.ndarray
    colors: np.ndarray
    stats: dict
    backgrounds: np.ndarray | None = None

    def plain(self):
        return "\n".join("".join(row) for row in self.glyphs)

    def runs(self):
        rows = []
        for y, (glyphs, colors) in enumerate(zip(self.glyphs, self.colors)):
            row = []
            last, chars = None, []
            for x, (ch, col) in enumerate(zip(glyphs, colors)):
                fg = tuple(map(int, col)) if ch != " " else (last[:3] if last else (0, 0, 0))
                rgb = fg if self.backgrounds is None else fg + tuple(map(int, self.backgrounds[y, x]))
                if rgb != last and chars:
                    run = ["#%02x%02x%02x" % last[:3], "".join(chars)]
                    if self.backgrounds is not None:
                        run.append("#%02x%02x%02x" % last[3:])
                    row.append(run)
                    chars = []
                last = rgb
                chars.append(ch)
            if chars:
                run = ["#%02x%02x%02x" % last[:3], "".join(chars)]
                if self.backgrounds is not None:
                    run.append("#%02x%02x%02x" % last[3:])
                row.append(run)
            rows.append(row)
        return rows

    def ansi(self, previous=None):
        """Emit changed rows, grouping foreground and optional background colors."""
        parts = []
        for y, row in enumerate(self.runs()):
            same_background = previous is not None and ((self.backgrounds is None and previous.backgrounds is None) or
                (self.backgrounds is not None and previous.backgrounds is not None and
                 np.array_equal(self.backgrounds[y], previous.backgrounds[y])))
            if previous is not None and same_background and np.array_equal(self.glyphs[y], previous.glyphs[y]) and np.array_equal(self.colors[y], previous.colors[y]):
                continue
            parts.append(f"\x1b[{y + 1};1H")
            for run in row:
                color, text = run[:2]
                r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
                if len(run) == 3:
                    br, bg, bb = (int(run[2][i:i + 2], 16) for i in (1, 3, 5))
                    parts.append(f"\x1b[38;2;{r};{g};{b};48;2;{br};{bg};{bb}m{text}")
                else:
                    parts.append(f"\x1b[38;2;{r};{g};{b};49m{text}")
        parts.append("\x1b[0m")
        return "".join(parts)


class Renderer:
    def __init__(self, backend="auto", scene=None):
        self.scene = scene or Scene()
        self.visibility = Visibility(backend)

    def close(self):
        self.visibility.close()

    def frame(self, camera=None, time=0., cols=150, rows=48, planet=True):
        started = clock.perf_counter()
        camera = camera or Camera()
        if not (16 <= cols <= 320 and 8 <= rows <= 120):
            raise ValueError("grid must be 16..320 columns and 8..120 rows")
        right, up, forward = camera.basis()
        tan_y = np.tan(np.radians(camera.fov) / 2)
        tan_x = tan_y * cols / (rows * 1.8)
        x = ((np.arange(cols) + .5) / cols * 2 - 1) * tan_x
        y = (1 - (np.arange(rows) + .5) / rows * 2) * tan_y
        xx, yy = np.meshgrid(x, y)
        rays = forward + xx.reshape(-1, 1) * right + yy.reshape(-1, 1) * up
        rays /= np.linalg.norm(rays, axis=1)[:, None]

        relative = self.scene.positions - camera.position
        distance2 = np.einsum("ij,ij->i", relative, relative)
        depth = relative @ forward
        safe_depth = np.maximum(depth, 1e-12)
        sx = (relative @ right) / safe_depth / tan_x
        sy = (relative @ up) / safe_depth / tan_y
        in_view = (depth > 1e-5) & (np.abs(sx) < 1) & (np.abs(sy) < 1) & (distance2 > 1e-10)
        indices = np.flatnonzero(in_view)
        star_distances = np.sqrt(distance2[indices])
        star_rays = relative[indices] / star_distances[:, None]
        # Camera-relative geometry keeps the GPU's local values small.
        spheres = self.scene.spheres(time) if planet else np.empty((0, 4))
        spheres[:, :3] -= camera.position
        build_started = clock.perf_counter()
        self.visibility.set_spheres(spheres)
        build_wall_ms = (clock.perf_counter() - build_started) * 1000
        all_rays = np.ascontiguousarray(np.concatenate((rays, star_rays)), dtype=np.float32)
        tmax = np.concatenate((np.full(len(rays), 1e12), np.maximum(star_distances - 1e-4, 0))).astype(np.float32)
        trace_started = clock.perf_counter()
        hit_ids, distances = self.visibility.trace(np.zeros_like(all_rays), all_rays, tmax)
        trace_wall_ms = (clock.perf_counter() - trace_started) * 1000
        n = cols * rows
        light = np.zeros((n, 3), dtype=np.float64)
        surface = np.flatnonzero(hit_ids[:n] >= 0)
        edge_glyphs = None
        if surface.size:
            sphere = spheres[hit_ids[surface]]
            normal = (rays[surface] * distances[surface, None] - sphere[:, :3]) / sphere[:, 3, None]
            normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-12)
            sun = np.array([-.6, .7, -.9]); sun /= np.linalg.norm(sun)
            lambert = np.maximum(normal @ sun, 0)
            longitude = np.arctan2(normal[:, 0], normal[:, 2]) + time * .12
            bands = .5 + .5 * np.sin(normal[:, 1] * 27 + 2 * np.sin(longitude * 3))
            turbulence = .5 + .5 * np.sin(longitude * 8 + normal[:, 1] * 13)
            cold = np.array([.13, .34, .52])
            warm = np.array([.80, .60, .30])
            albedo = cold + bands[:, None] * (warm - cold)
            shade = (.025 + .85 * lambert) * (.78 + .22 * turbulence)
            light[surface] = albedo * shade[:, None]
            facing = -(normal * rays[surface]).sum(axis=1)
            edge = np.abs(facing) < .25
            angles = np.arctan2(normal @ up, normal @ right)
            directions = np.array(list("|/-\\"))[(np.floor((angles + np.pi) / (np.pi / 4)).astype(int) // 2) % 4]
            edge_glyphs = (surface[edge], directions[edge])

        visible = hit_ids[n:] < 0
        star_ids = indices[visible]
        cell_x = np.minimum(cols - 1, ((sx[star_ids] + 1) * .5 * cols).astype(int))
        cell_y = np.minimum(rows - 1, ((1 - sy[star_ids]) * .5 * rows).astype(int))
        # Log-compressed apparent brightness makes the small catalog readable.
        flux = self.scene.luminosity[star_ids] / distance2[star_ids]
        strength = np.clip(.10 + .30 * np.log1p(35 * flux), .10, 1.)
        contribution = self.scene.colors[star_ids] / 255. * strength[:, None]
        np.add.at(light, cell_y * cols + cell_x, contribution)
        brightness = np.clip(light.max(axis=1), 0, 1)
        ramp_index = np.clip(np.ceil(brightness ** .8 * (len(RAMP) - 1)).astype(int), 0, len(RAMP) - 1)
        glyphs = RAMP[ramp_index]
        if edge_glyphs is not None:
            ix, chars = edge_glyphs
            lit = brightness[ix] > .07
            glyphs[ix[lit]] = chars[lit]
        rgb = light / np.maximum(brightness[:, None], 1e-9)
        rgb *= (.35 + .65 * np.sqrt(brightness))[:, None]
        colors = (np.clip(np.round(rgb * 15), 0, 15) * 17).astype(np.uint8)
        colors[glyphs == " "] = 0
        stats = {"backend": self.visibility.backend, "stars": len(self.scene.positions),
                 "candidates": len(indices), "visible_stars": int(visible.sum()),
                 "blocked_stars": int((~visible).sum()), "surface_cells": len(surface),
                 "rays": len(all_rays), "cols": cols, "rows": rows, "time": round(float(time), 3),
                 "build_ms": self.visibility.build_ms, "build_wall_ms": build_wall_ms,
                 "trace_ms": self.visibility.trace_ms, "trace_wall_ms": trace_wall_ms,
                 "frame_ms": (clock.perf_counter() - started) * 1000,
                 **self.visibility.stats}
        return TextFrame(glyphs.reshape(rows, cols), colors.reshape(rows, cols, 3), stats)
