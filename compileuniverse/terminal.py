"""Interactive ANSI terminal frontend with free camera motion."""
from __future__ import annotations

import os
import select
import shutil
import sys
import termios
import time
import tty

import numpy as np

from .render import Camera, Renderer


def play(backend="auto", fps=20, scene="lab"):
    if scene not in {"lab", "blackhole"}:
        raise ValueError("scene must be lab or blackhole")
    if not np.isfinite(fps) or not 1 <= fps <= 120:
        raise ValueError("fps must be within 1..120")
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise RuntimeError("view requires a terminal; use snapshot or web for noninteractive output")
    blackhole = scene == "blackhole"
    if blackhole:
        from .blackhole import BlackHoleRenderer, default_camera
        renderer, camera = BlackHoleRenderer(), default_camera()
        radius = float(np.linalg.norm(camera.position))
        azimuth = float(np.arctan2(camera.position[0], camera.position[2]))
        elevation = float(np.arcsin(camera.position[1] / radius))
    else:
        renderer, camera = Renderer(backend), Camera()
    settings = termios.tcgetattr(sys.stdin)
    previous, last, sim_time, paused, planet = None, time.monotonic(), 0., False, True
    exposure, pending_keys = 1., ""
    try:
        tty.setcbreak(sys.stdin.fileno())
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[40m\x1b[2J")
        while True:
            now = time.monotonic()
            dt, last = min(now - last, .1), now
            if not paused:
                sim_time += dt
            keys = pending_keys
            pending_keys = ""
            if select.select([sys.stdin], [], [], 0)[0]:
                chunk = os.read(sys.stdin.fileno(), 128)
                if not chunk:
                    break
                keys += chunk.decode(errors="ignore")
            if "q" in keys.lower() or "\x03" in keys:
                break
            # Arrow sequences can arrive in separate reads from a terminal.
            for suffix in ("\x1b[", "\x1b"):
                if keys.endswith(suffix):
                    pending_keys, keys = suffix, keys[:-len(suffix)]
                    break
            for seq, action in (("\x1b[A", "k"), ("\x1b[B", "j"), ("\x1b[C", "l"), ("\x1b[D", "h")):
                keys = keys.replace(seq, action)
            for key in keys.lower():
                if blackhole:
                    if key == "w": radius *= .94
                    elif key == "s": radius /= .94
                    elif key in "ah": azimuth -= .065
                    elif key in "dl": azimuth += .065
                    elif key in "rk": elevation += .045
                    elif key in "fj": elevation -= .045
                    elif key in "+=": exposure = min(4., exposure * 1.12)
                    elif key == "-": exposure = max(.1, exposure / 1.12)
                    elif key == " ": paused = not paused
                    elif key in "123":
                        radius, elevation = {"1": (22., .16), "2": (22., .8), "3": (16., .025)}[key]
                        azimuth = 0.
                    elif key == "0":
                        camera, sim_time, exposure = default_camera(), 0., 1.
                        radius = float(np.linalg.norm(camera.position))
                        azimuth = float(np.arctan2(camera.position[0], camera.position[2]))
                        elevation = float(np.arcsin(camera.position[1] / radius))
                    radius = float(np.clip(radius, 6.01, 120.))
                    elevation = float(np.clip(elevation, -1.3, 1.3))
                    azimuth = float((azimuth + np.pi) % (2 * np.pi) - np.pi)
                    camera.position = radius * np.array([np.cos(elevation) * np.sin(azimuth),
                                                         np.sin(elevation),
                                                         np.cos(elevation) * np.cos(azimuth)])
                    camera.yaw, camera.pitch = azimuth + np.pi, -elevation
                    continue
                right, up, forward = camera.basis()
                if key in "wasdrf":
                    direction = {"w": forward, "s": -forward, "a": -right, "d": right,
                                 "r": np.array([0., 1., 0.]), "f": np.array([0., -1., 0.])}[key]
                    camera.position += direction * .25
                elif key == "h": camera.yaw -= .06
                elif key == "l": camera.yaw += .06
                elif key == "k": camera.pitch = min(1.5, camera.pitch + .06)
                elif key == "j": camera.pitch = max(-1.5, camera.pitch - .06)
                elif key in "+=": camera.fov = max(20., camera.fov - 3)
                elif key == "-": camera.fov = min(110., camera.fov + 3)
                elif key == " ": paused = not paused
                elif key == "p": planet = not planet
                elif key == "0": camera, sim_time = Camera(), 0.
            width, height = shutil.get_terminal_size((120, 42))
            cols, rows = min(320, width - 1), min(120, height - 4)
            if cols < 16 or rows < 8:
                previous = None
                sys.stdout.write("\x1b[HTerminal too small; resize to at least 17 x 12.\x1b[K")
                sys.stdout.flush()
                time.sleep(.1)
                continue
            if previous is None or previous.glyphs.shape != (rows, cols):
                previous = None
                sys.stdout.write("\x1b[2J")
            if blackhole:
                frame = renderer.frame(camera, sim_time, cols, rows, exposure=exposure)
            else:
                frame = renderer.frame(camera, sim_time, cols, rows, planet)
            sys.stdout.write("\x1b[40m" + frame.ansi(previous) + "\x1b[40m")
            stats = frame.stats
            if blackhole:
                lines = [f"COMPILEUNIVERSE | {stats['backend']} | {stats['camera_radius']:.1f} rs | {stats['frame_ms']:.1f} ms | disk {stats['disk_cells']} / shadow {stats['shadow_cells']}",
                         "W/S dolly, A/D orbit, R/F height | arrows/HJKL orbit | SPACE pause | Q quit",
                         f"1 Horizon | 2 Above | 3 Ring | 0 reset | +/- exposure {exposure:.2f} | {'PAUSED' if paused else 'PLAYING'}"]
            else:
                lines = [f"COMPILEUNIVERSE | {stats['backend']} | visible {stats['visible_stars']} / blocked {stats['blocked_stars']} | {stats['frame_ms']:.2f} ms/frame",
                         "WASD move | R/F up/down | arrows/HJKL look | +/- FOV | space pause | P planet | 0 reset | Q quit",
                         "Real star catalog; synthetic oversized planet. Direct character output, no pixel image."]
            for i, line in enumerate(lines):
                sys.stdout.write(f"\x1b[{rows + i + 1};1H\x1b[38;2;159;178;190m{line[:cols]}\x1b[K")
            sys.stdout.flush()
            previous = frame
            time.sleep(max(0, 1 / fps - (time.monotonic() - now)))
    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, settings)
        sys.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()
        renderer.close()
