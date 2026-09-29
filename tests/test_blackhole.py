"""Independent geometry and end-to-end checks for the compiled black hole.

The scalar RK4 oracle below exists only in validation. The live player uses its
compiled transfer artifact and must not call this numerical reference.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock
from urllib import error as urlerror, request as urlrequest
import zlib

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compileuniverse.blackhole import BlackHoleRenderer
from compileuniverse.lensing import LensingTable
from compileuniverse.render import Camera, TextFrame


def escaping_direction_reference(origin, direction, step=0.0005):
    """Integrate Schwarzschild's Binet equation in float64 with scalar RK4.

    Coordinates use r_s=1. Input direction belongs to a static observer's
    orthonormal frame. This independent implementation deliberately uses no
    table, production compiler, or production interpolation helper.
    """
    origin = np.asarray(origin, dtype=np.float64)
    direction = np.asarray(direction, dtype=np.float64)
    direction /= np.linalg.norm(direction)
    radius = np.linalg.norm(origin)
    radial = origin / radius
    radial_cosine = float(np.dot(radial, direction))
    transverse = direction - radial_cosine * radial
    transverse /= np.linalg.norm(transverse)
    impact = radius * np.sqrt(1 - radial_cosine ** 2) / np.sqrt(1 - 1 / radius)
    u = 1 / radius
    q = np.sqrt(max(0., 1 / impact ** 2 - u * u + u ** 3))
    if radial_cosine > 0:
        q = -q
    phi = 0.
    for _ in range(80_000):
        old_u = u
        k1u, k1q = q, 1.5 * u * u - u
        mid_u, mid_q = u + .5 * step * k1u, q + .5 * step * k1q
        k2u, k2q = mid_q, 1.5 * mid_u * mid_u - mid_u
        mid_u, mid_q = u + .5 * step * k2u, q + .5 * step * k2q
        k3u, k3q = mid_q, 1.5 * mid_u * mid_u - mid_u
        end_u, end_q = u + step * k3u, q + step * k3q
        k4u, k4q = end_q, 1.5 * end_u * end_u - end_u
        u += step * (k1u + 2 * k2u + 2 * k3u + k4u) / 6
        q += step * (k1q + 2 * k2q + 2 * k3q + k4q) / 6
        if u <= 0:
            phi += step * old_u / (old_u - u)
            return np.cos(phi) * radial + np.sin(phi) * transverse
        phi += step
        if u >= 1:
            raise ValueError("oracle ray was captured")
    raise AssertionError("reference integration exceeded its bounded work limit")


def disk_crossings_reference(origin, direction, step=0.0005):
    """Independent RK4 path plus sign-change detection for disk-plane crossings."""
    origin, direction = np.asarray(origin, float), np.asarray(direction, float)
    direction = direction / np.linalg.norm(direction)
    radius = np.linalg.norm(origin)
    radial = origin / radius
    cosine = float(np.dot(radial, direction))
    transverse = direction - cosine * radial
    transverse /= np.linalg.norm(transverse)
    impact = radius * np.sqrt(1 - cosine ** 2) / np.sqrt(1 - 1 / radius)
    u, q = 1 / radius, np.sqrt(max(0., 1 / impact ** 2 - 1 / radius ** 2 + 1 / radius ** 3))
    if cosine > 0:
        q = -q
    phi, points, tangents = 0., [], []
    for _ in range(80_000):
        old_u, old_q = u, q
        k1u, k1q = q, 1.5 * u * u - u
        v, w = u + .5 * step * k1u, q + .5 * step * k1q
        k2u, k2q = w, 1.5 * v * v - v
        v, w = u + .5 * step * k2u, q + .5 * step * k2q
        k3u, k3q = w, 1.5 * v * v - v
        v, w = u + step * k3u, q + step * k3q
        k4u, k4q = w, 1.5 * v * v - v
        u += step * (k1u + 2 * k2u + 2 * k3u + k4u) / 6
        q += step * (k1q + 2 * k2q + 2 * k3q + k4q) / 6
        old_y = np.cos(phi) * radial[1] + np.sin(phi) * transverse[1]
        new_y = np.cos(phi + step) * radial[1] + np.sin(phi + step) * transverse[1]
        if old_y * new_y < 0:
            fraction = old_y / (old_y - new_y)
            hit_phi = phi + fraction * step
            hit_u = old_u + fraction * (u - old_u)
            hit_q = old_q + fraction * (q - old_q)
            if 0 < hit_u < 1:
                unit_radial = np.cos(hit_phi) * radial + np.sin(hit_phi) * transverse
                unit_angular = -np.sin(hit_phi) * radial + np.cos(hit_phi) * transverse
                angular_speed = impact * hit_u * np.sqrt(1 - hit_u)
                radial_speed = -np.sign(hit_q) * np.sqrt(max(0., 1 - angular_speed ** 2))
                points.append(unit_radial / hit_u)
                tangents.append(unit_radial * radial_speed + unit_angular * angular_speed)
        phi += step
        if u <= 0 or u >= 1:
            return np.asarray(points).reshape(-1, 3), np.asarray(tangents).reshape(-1, 3)
    raise AssertionError("disk reference exceeded its bounded work limit")


class TestCompiledLensing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.table = LensingTable()

    def test_capture_matches_analytic_critical_impact_parameter(self):
        critical_impact = 3 * np.sqrt(3) / 2
        for radius in (6., 17.3, 149.):
            with self.subTest(radius=radius):
                critical_angle = np.arcsin(critical_impact * np.sqrt(1 - 1 / radius) / radius)
                angles = critical_angle * np.array([.45, .8, 1.25, 1.6])
                inward = np.column_stack((np.sin(angles), np.zeros(4), np.cos(angles)))
                result = self.table.trace(np.array([0., 0., -radius]), inward)
                np.testing.assert_array_equal(result["captured"], [True, True, False, False])
                outward = inward.copy()
                outward[:, 2] *= -1
                result = self.table.trace(np.array([0., 0., -radius]), outward)
                self.assertFalse(result["captured"].any())

    def test_escaping_directions_match_independent_rk4_at_unsampled_views(self):
        # Non-grid radii and directions exercise interpolation, away from the
        # critical curve where tiny impact changes produce very large angles.
        for radius, impact in ((8.37, 3.9), (17.31, 5.2), (43.27, 12.7)):
            with self.subTest(radius=radius, impact=impact):
                beta = np.arcsin(impact * np.sqrt(1 - 1 / radius) / radius)
                origin = np.array([0., 0., -radius])
                direction = np.array([np.sin(beta), 0., np.cos(beta)])
                result = self.table.trace(origin, direction[None, :])
                self.assertFalse(result["captured"][0])
                expected = escaping_direction_reference(origin, direction)
                actual = result["outgoing"][0]
                error = np.arctan2(np.linalg.norm(np.cross(expected, actual)), np.dot(expected, actual))
                self.assertLess(error, .0001, f"angular error {np.degrees(error):.4f} degrees")

    def test_critical_curve_preserves_capture_on_both_sides_of_saturation(self):
        radius = 24.
        impacts = 3 * np.sqrt(3) / 2 * np.array([1 - 1e-8, 1 + 1e-8])
        beta = np.arcsin(impacts * np.sqrt(1 - 1 / radius) / radius)
        directions = np.column_stack((np.sin(beta), np.zeros(2), np.cos(beta)))
        result = self.table.trace(np.array([0., 0., -radius]), directions)
        np.testing.assert_array_equal(result["captured"], [True, False])
        self.assertTrue(np.isfinite(result["outgoing"]).all())

    def test_rotation_about_disk_axis_preserves_geometry(self):
        origin = np.array([0., 3., 21.])
        directions = np.array([[.11, -.12, -1], [.32, -.2, -1], [-.42, -.23, -1], [.1, .2, 1]])
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        angle = .713
        rotation = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
        before = self.table.trace(origin, directions)
        after = self.table.trace(rotation @ origin, directions @ rotation.T)
        np.testing.assert_array_equal(after["captured"], before["captured"])
        np.testing.assert_array_equal(after["crossing_valid"], before["crossing_valid"])
        escaped = ~before["captured"]
        np.testing.assert_allclose(after["outgoing"][escaped], before["outgoing"][escaped] @ rotation.T, atol=2e-4)
        valid = before["crossing_valid"]
        np.testing.assert_allclose(after["crossings"][valid], before["crossings"][valid] @ rotation.T, atol=2e-3)
        np.testing.assert_allclose(after["crossings"][valid][:, 1], 0., atol=2e-4)

    def test_disk_intersections_and_doppler_tangents_match_independent_rk4(self):
        origin = np.array([0., 4., 24.])
        # Includes an escaping path with two disk images, and an observer ray
        # initially pointing above the disk that gravity bends back through it.
        directions = np.array([[.15, -.2, -1.], [.27, -.25, -1.], [.1, .12, -1.]])
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        actual = self.table.trace(origin, directions)
        for ray, direction in enumerate(directions):
            with self.subTest(ray=ray):
                expected_points, expected_tangents = disk_crossings_reference(origin, direction)
                valid = actual["crossing_valid"][ray]
                self.assertEqual(int(valid.sum()), len(expected_points))
                np.testing.assert_allclose(actual["crossings"][ray, valid], expected_points, rtol=2e-4, atol=5e-4)
                np.testing.assert_allclose(actual["tangents"][ray, valid], expected_tangents, atol=2e-4)

    def test_radial_and_random_rays_are_finite(self):
        rng = np.random.default_rng(6917)
        directions = rng.normal(size=(1024, 3))
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        directions[:2] = [[0, 0, 1], [0, 0, -1]]
        result = self.table.trace(np.array([0., 0., -24.]), directions)
        np.testing.assert_array_equal(result["captured"][:2], [True, False])
        self.assertTrue(np.isfinite(result["outgoing"]).all())
        escaped = ~result["captured"]
        np.testing.assert_allclose(np.linalg.norm(result["outgoing"][escaped], axis=1), 1., atol=2e-4)
        valid = result["crossing_valid"]
        self.assertTrue(np.isfinite(result["crossings"][valid]).all())
        self.assertTrue(np.isfinite(result["tangents"][valid]).all())
        self.assertTrue((np.linalg.norm(result["crossings"][valid], axis=1) >= 1).all())


class TestCompiledArtifacts(unittest.TestCase):
    def test_geodesic_compiler_reproduces_identical_arrays(self):
        from compile_lensing import compile_table

        with tempfile.TemporaryDirectory(prefix="compileuniverse-lensing-") as directory:
            first, second = Path(directory) / "one.npz", Path(directory) / "two.npz"
            options = dict(impact_samples=32, phase_samples=65, inverse_samples=65, progress=False)
            first_metadata = compile_table(first, **options)
            second_metadata = compile_table(second, **options)
            self.assertEqual(first_metadata, second_metadata)
            with np.load(first, allow_pickle=False) as a, np.load(second, allow_pickle=False) as b:
                self.assertEqual(sorted(a.files), sorted(b.files))
                for key in a.files:
                    np.testing.assert_array_equal(a[key], b[key], err_msg=f"compiled {key} differs")

    def test_appearance_compiler_reproduces_identical_payload(self):
        from compileuniverse.appearance import compile_appearance

        with tempfile.TemporaryDirectory(prefix="compileuniverse-appearance-") as directory:
            first, second = Path(directory) / "one.npz", Path(directory) / "two.npz"
            first_metadata = compile_appearance(first)
            second_metadata = compile_appearance(second)
            self.assertEqual(first_metadata["arrays_sha256"], second_metadata["arrays_sha256"])
            with np.load(first, allow_pickle=False) as a, np.load(second, allow_pickle=False) as b:
                self.assertEqual(sorted(a.files), sorted(b.files))
                for key in a.files:
                    np.testing.assert_array_equal(a[key], b[key], err_msg=f"compiled {key} differs")

    def test_existing_assets_do_not_compile_during_loading_or_new_camera_queries(self):
        fail = AssertionError("offline compilation was called during playback")
        with mock.patch("compileuniverse.lensing.subprocess.run", side_effect=fail), \
             mock.patch("compileuniverse.appearance.compile_appearance", side_effect=fail):
            renderer = BlackHoleRenderer()
            try:
                for time, position in ((.137, [1.37, 3.17, 22.73]), (2.1, [-4.1, 8.17, 26.37])):
                    position = np.asarray(position)
                    inward = -position / np.linalg.norm(position)
                    camera = Camera(position, np.arctan2(inward[0], inward[2]), np.arcsin(inward[1]))
                    frame = renderer.frame(camera, time=time, cols=65, rows=31)
                    self.assertEqual(frame.stats["backend"], "compiled-lut")
            finally:
                renderer.close()


class TestBlackHoleTextPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer = BlackHoleRenderer()

    @classmethod
    def tearDownClass(cls):
        cls.renderer.close()

    @staticmethod
    def camera(position=(0., 4., 24.)):
        position = np.asarray(position, dtype=np.float64)
        inward = -position / np.linalg.norm(position)
        return Camera(position=position, yaw=np.arctan2(inward[0], inward[2]), pitch=np.arcsin(inward[1]))

    def test_complete_frame_is_printable_text_and_finite_colors(self):
        frame = self.renderer.frame(self.camera(), cols=81, rows=41)
        self.assertEqual(frame.glyphs.shape, (41, 81))
        self.assertEqual(frame.colors.shape, (41, 81, 3))
        self.assertEqual(frame.backgrounds.shape, (41, 81, 3))
        self.assertEqual(frame.colors.dtype, np.uint8)
        self.assertEqual(frame.backgrounds.dtype, np.uint8)
        self.assertTrue(all(32 <= ord(character) <= 126 for character in frame.glyphs.flat))
        self.assertEqual([len(line) for line in frame.plain().splitlines()], [81] * 41)
        self.assertEqual(frame.stats["scene"], "blackhole")
        self.assertEqual(frame.stats["backend"], "compiled-lut")
        self.assertGreater(frame.stats["disk_cells"], 0)
        self.assertGreater(frame.stats["shadow_cells"], 0)
        json.dumps(frame.stats, allow_nan=False)
        runs = frame.runs()
        reconstructed = "\n".join("".join(run[1] for run in row) for row in runs)
        self.assertEqual(reconstructed, frame.plain())
        self.assertTrue(all(len(run) == 3 for row in runs for run in row))

    def test_captured_center_stays_black_with_character_bloom(self):
        for bloom in (False, True):
            with self.subTest(bloom=bloom):
                frame = self.renderer.frame(self.camera(), cols=81, rows=41, bloom=bloom)
                self.assertEqual(frame.glyphs[20, 40], " ")
                np.testing.assert_array_equal(frame.colors[20, 40], [0, 0, 0])
                np.testing.assert_array_equal(frame.backgrounds[20, 40], [0, 0, 0])

    def test_time_and_camera_are_independent_and_same_state_is_deterministic(self):
        camera = self.camera((.37, 4.21, 23.8))
        first = self.renderer.frame(camera, time=.73, cols=90, rows=44)
        repeat = self.renderer.frame(camera, time=.73, cols=90, rows=44)
        np.testing.assert_array_equal(first.glyphs, repeat.glyphs)
        np.testing.assert_array_equal(first.colors, repeat.colors)
        np.testing.assert_array_equal(first.backgrounds, repeat.backgrounds)
        self.assertTrue(repeat.stats["cached_geometry"])
        later = self.renderer.frame(camera, time=3.71, cols=90, rows=44)
        self.assertTrue(later.stats["cached_geometry"])
        self.assertFalse(np.array_equal(first.colors, later.colors) and np.array_equal(first.glyphs, later.glyphs))
        shifted = self.renderer.frame(self.camera((5.7, 7.1, 20.3)), time=.73, cols=90, rows=44)
        self.assertFalse(shifted.stats["cached_geometry"])
        self.assertFalse(np.array_equal(first.glyphs, shifted.glyphs))

    def test_camera_and_display_controls_reject_invalid_numeric_states(self):
        invalid = [
            {"camera": self.camera((0., 0., 5.))},
            {"camera": self.camera((0., 0., 8193.))},
            {"camera": Camera(position=np.array([0., np.nan, 20.]))},
            {"time": float("inf")}, {"exposure": float("nan")},
            {"cols": 0}, {"rows": 0},
        ]
        for parameters in invalid:
            with self.subTest(parameters=parameters):
                with self.assertRaises(ValueError):
                    self.renderer.frame(**parameters)


class TestTextBackgrounds(unittest.TestCase):
    def test_blank_cell_background_survives_runs_and_ansi(self):
        glyphs = np.array([list(" A ")])
        colors = np.array([[[0, 0, 0], [255, 170, 85], [0, 0, 0]]], dtype=np.uint8)
        backgrounds = np.array([[[17, 34, 51], [17, 34, 51], [68, 85, 102]]], dtype=np.uint8)
        frame = TextFrame(glyphs, colors, {}, backgrounds=backgrounds)
        expanded = []
        for foreground, text, background in frame.runs()[0]:
            expanded.extend([background] * len(text))
        self.assertEqual(expanded, ["#112233", "#112233", "#445566"])
        ansi = frame.ansi()
        self.assertIn("48;2;17;34;51", ansi)
        self.assertIn("48;2;68;85;102", ansi)

    def test_background_only_changes_trigger_ansi_row_update(self):
        glyphs = np.array([list(" . ")])
        colors = np.full((1, 3, 3), 85, dtype=np.uint8)
        before = TextFrame(glyphs.copy(), colors.copy(), {}, backgrounds=np.zeros((1, 3, 3), dtype=np.uint8))
        after = TextFrame(glyphs.copy(), colors.copy(), {}, backgrounds=np.full((1, 3, 3), 17, dtype=np.uint8))
        ansi = after.ansi(before)
        self.assertIn("\x1b[1;1H", ansi)
        self.assertIn("48;2;17;17;17", ansi)


class TestBlackHoleRecording(unittest.TestCase):
    def test_seven_byte_recording_and_standalone_replay_preserve_backgrounds(self):
        from run import record
        from replay import ansi, decode

        with tempfile.TemporaryDirectory(prefix="compileuniverse-blackhole-record-") as directory:
            stem = Path(directory) / "tiny"
            args = SimpleNamespace(scene="blackhole", backend="cpu", out=str(stem),
                                   seconds=.25, fps=12, cols=17, rows=9)
            with redirect_stdout(io.StringIO()):
                record(args)
            metadata = json.loads(stem.with_suffix(".json").read_text())
            self.assertEqual(metadata["bytes_per_cell"], 7)
            self.assertEqual(metadata["frames"], 3)
            full = zlib.decompress(stem.with_suffix(".cells.zlib").read_bytes())
            delta = zlib.decompress(stem.with_suffix(".delta.zlib").read_bytes())
            cells, frame_size = 17 * 9, 17 * 9 * 7
            self.assertEqual(len(full), frame_size * 3)
            frame, offset = bytearray(frame_size), 0
            for index in range(3):
                mask = delta[offset:offset + (cells + 7) // 8]
                offset += (cells + 7) // 8
                for cell in range(cells):
                    if mask[cell // 8] & (1 << (cell % 8)):
                        frame[cell * 7:cell * 7 + 7] = delta[offset:offset + 7]
                        offset += 7
                self.assertEqual(bytes(frame), full[index * frame_size:(index + 1) * frame_size])
            self.assertEqual(offset, len(delta))
            info, replayed = decode(stem.with_suffix(".json"))
            self.assertEqual(info["bytes_per_cell"], 7)
            self.assertEqual(b"".join(frame.tobytes() for frame in replayed), full)
            self.assertTrue(any(np.any(frame[:, 4:] > 0) for frame in replayed))
            self.assertIn(";48;2;", ansi(replayed[0], 17, 9))


class TestBlackHoleAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        cls.url = f"http://127.0.0.1:{port}"
        cls.log = tempfile.TemporaryFile(mode="w+")
        cls.process = subprocess.Popen(
            [sys.executable, "run.py", "web", "--backend", "cpu", "--port", str(port)],
            cwd=root, stdout=cls.log, stderr=subprocess.STDOUT,
        )
        cls.addClassCleanup(cls.stop_server)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and cls.process.poll() is None:
            try:
                with urlrequest.urlopen(cls.url + "/health", timeout=.5) as response:
                    json.load(response)
                return
            except (OSError, urlerror.URLError):
                time.sleep(.03)
        cls.log.seek(0)
        raise AssertionError("test server did not start: " + cls.log.read())

    @classmethod
    def stop_server(cls):
        if cls.process.poll() is None:
            cls.process.send_signal(signal.SIGINT)
            try:
                cls.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                cls.process.kill()
                cls.process.wait(timeout=3)
        cls.log.close()

    def post(self, data):
        query = urlrequest.Request(self.url + "/api/frame", data=json.dumps(data).encode(),
                                   headers={"Content-Type": "application/json"})
        try:
            response = urlrequest.urlopen(query, timeout=3)
        except urlerror.HTTPError as response:
            with response:
                return response.code, json.load(response)
        with response:
            return response.status, json.load(response)

    def test_api_returns_complete_text_and_background_cells(self):
        status, data = self.post({"scene": "blackhole", "cols": 65, "rows": 31, "time": .37})
        self.assertEqual(status, 200)
        self.assertEqual(data["stats"]["backend"], "compiled-lut")
        self.assertEqual(len(data["rows"]), 31)
        for row in data["rows"]:
            self.assertEqual(sum(len(run[1]) for run in row), 65)
            for foreground, text, background in row:
                self.assertRegex(foreground, r"^#[0-9a-f]{6}$")
                self.assertRegex(background, r"^#[0-9a-f]{6}$")
                self.assertTrue(all(32 <= ord(character) <= 126 for character in text))

    def test_invalid_requests_are_rejected_and_server_remains_usable(self):
        bad_requests = [
            [], {"scene": "missing"},
            {"scene": "blackhole", "position": [0, 0, 0]},
            {"scene": "blackhole", "position": [0, 0, 8193]},
            {"scene": "blackhole", "position": [0, None, 24]},
            {"scene": "blackhole", "exposure": float("nan")},
            {"scene": "blackhole", "cols": 0},
        ]
        for data in bad_requests:
            with self.subTest(data=data):
                status, response = self.post(data)
                self.assertEqual(status, 400)
                self.assertIn("error", response)
        status, _ = self.post({"scene": "blackhole", "cols": 17, "rows": 9})
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
