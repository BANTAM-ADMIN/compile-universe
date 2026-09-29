"""Local assets and the legacy text API; atlas and black-hole frames run in WASM."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import numpy as np

from .render import Camera, Renderer
from .blackhole import BlackHoleRenderer, default_camera


def serve(backend="auto", port=8765):
    blackhole = [None]
    lab = [None]
    index = Path(__file__).resolve().parents[1] / "web/index.html"
    surface_assets = {f"/artifacts/surface-{key}.bin" for key in (
        "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "moon",
        "io", "europa", "titan", "enceladus", "temperate-rock", "hot-jupiter", "lava",
        "ocean", "desert", "violet", "carbon", "ice-rock")}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, content, mime):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            path = urlsplit(self.path).path
            if path in {"/", "/atlas", "/atlas.html"}:
                self.send(200, index.with_name("atlas.html").read_bytes(), "text/html; charset=utf-8")
            elif path in {"/blackhole", "/phenomena", "/phenomena.html"}:
                aliases = {"binary": "vfts-352", "giant": "betelgeuse-study", "remnant": "crab-nebula",
                           "nebula": "orion-nebula", "pulsar": "crab-pulsar", "quasar": "3c-273"}
                scene = parse_qs(urlsplit(self.path).query).get("scene", [""])[0]
                destination = "sagittarius-a" if path == "/blackhole" else aliases.get(scene)
                self.send_response(302)
                self.send_header("Location", "/?destination=" + destination if destination else "/?category=phenomena")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()
            elif path == "/index.html":
                self.send(200, index.read_bytes(), "text/html; charset=utf-8")
            elif path == "/health":
                self.send(200, json.dumps({"ok": True, "backend": "compiled-lut",
                    "scenes": ["atlas", "blackhole", "phenomena", "lab"], "lab_backend": lab[0].visibility.backend if lab[0] else backend}).encode(), "application/json")
            elif path in {"/glyph-display.js", "/player-worker.js", "/engine.js", "/engine.wasm",
                          "/atlas.js", "/atlas.css", "/ascii-interface.js", "/atlas-worker.js", "/atlas-engine.js", "/atlas-engine.wasm", "/system-generator.js", "/surface-compiler.js", "/earth-orientation.js",
                          "/phenomena-engine.js", "/phenomena-engine.wasm",
                          "/artifacts/universe.bin", "/artifacts/universe.json",
                          "/artifacts/gaia-atlas.bin", "/artifacts/gaia-light.bin", "/artifacts/gaia-observations.bin", "/artifacts/gaia.json",
                          "/artifacts/atlas.bin", "/artifacts/atlas.json", "/artifacts/atlas-search.json",
                          "/artifacts/solar.json", "/artifacts/earth.bin", "/artifacts/earth-night.bin", "/artifacts/earth-night.json", "/artifacts/earth-orientation.bin", "/artifacts/earth-orientation.json", "/artifacts/systems.json",
                          "/artifacts/galaxy-stars.bin", "/artifacts/galaxy-stars.json", "/artifacts/phenomena.bin", "/artifacts/phenomena.json",
                          "/artifacts/phenomena-destinations.json",
                          "/artifacts/surface-metadata.json", "/artifacts/relief-moon.bin", "/artifacts/rings-saturn.bin", "/artifacts/rings-haumea.bin"} | surface_assets:
                target = index.parent.parent / path.lstrip("/") if path.startswith("/artifacts/") else index.parent / path[1:]
                if not target.is_file():
                    self.send(404, b"Compiled asset missing; rebuild the web player.", "text/plain")
                    return
                tag = f'"{target.stat().st_mtime_ns:x}-{target.stat().st_size:x}"'
                if self.headers.get("If-None-Match") == tag:
                    self.send_response(304)
                    self.send_header("ETag", tag)
                    self.end_headers()
                    return
                mime = {".js": "text/javascript", ".wasm": "application/wasm", ".bin": "application/octet-stream"}.get(target.suffix,
                    mimetypes.guess_type(str(target))[0] or "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("ETag", tag)
                self.send_header("Cache-Control", "no-cache")
                zipped = target.with_suffix(target.suffix + ".gz")
                if "gzip" in self.headers.get("Accept-Encoding", "") and zipped.is_file() and zipped.stat().st_mtime >= target.stat().st_mtime:
                    self.send_header("Content-Encoding", "gzip")
                    target = zipped
                self.send_header("Vary", "Accept-Encoding")
                self.send_header("Content-Length", str(target.stat().st_size))
                self.end_headers()
                try:
                    with target.open("rb") as source:
                        while chunk := source.read(1024 * 1024):
                            self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.send(404, b"Not found", "text/plain")

        def do_POST(self):
            if self.path != "/api/frame":
                self.send(404, b"Not found", "text/plain")
                return
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 8192:
                    raise ValueError("invalid request size")
                request = json.loads(self.rfile.read(size))
                if not isinstance(request, dict):
                    raise ValueError("frame request must be a JSON object")
                scene = request.get("scene", "lab")
                if scene not in ("lab", "blackhole"):
                    raise ValueError("scene must be blackhole or lab")
                default = default_camera() if scene == "blackhole" else Camera()
                position = np.asarray(request.get("position", default.position), dtype=np.float64)
                values = [float(request.get(key, default)) for key, default in
                          (("yaw", default.yaw), ("pitch", default.pitch), ("fov", default.fov), ("time", 0))]
                if position.shape != (3,) or not np.isfinite(position).all() or np.abs(position).max() > 1e6 or not np.isfinite(values).all():
                    raise ValueError("camera and time must contain finite values")
                yaw, pitch, fov, time = values
                if abs(time) > 1e9:
                    raise ValueError("time outside experiment range")
                camera = Camera(position, yaw, float(np.clip(pitch, -1.5, 1.5)), float(np.clip(fov, 15, 110)))
                cols, rows = int(request.get("cols", 150)), int(request.get("rows", 48))
                if scene == "blackhole":
                    if blackhole[0] is None:
                        blackhole[0] = BlackHoleRenderer()
                    frame = blackhole[0].frame(camera, time, cols, rows,
                        exposure=float(request.get("exposure", 1)), bloom=bool(request.get("bloom", True)),
                        palette=request.get("palette", "ember"))
                else:
                    if lab[0] is None:
                        lab[0] = Renderer(backend)
                    frame = lab[0].frame(camera, time, cols, rows, bool(request.get("planet", True)))
                result = {"rows": frame.runs(), "stats": frame.stats}
                self.send(200, json.dumps(result, separators=(",", ":")).encode(), "application/json")
            except (ValueError, TypeError, KeyError, OverflowError) as error:
                self.send(400, json.dumps({"error": str(error)}).encode(), "application/json")
            except RuntimeError as error:
                self.send(500, json.dumps({"error": str(error)}).encode(), "application/json")

    # Keep CUDA context ownership and all native calls on the creation thread.
    # The browser holds at most one frame request in flight.
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"COMPILEUNIVERSE · compiled light · http://127.0.0.1:{port}", flush=True)
    print("Measured star atlas → local WASM → live character cells. Phenomena and Sagittarius A* are flight destinations. Ctrl-C stops.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if blackhole[0] is not None:
            blackhole[0].close()
        if lab[0] is not None:
            lab[0].close()
