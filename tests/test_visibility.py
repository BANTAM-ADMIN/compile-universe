"""Geometry checks for the direct-to-character visibility backends.

Run from COMPILEUNIVERSE with:
    python3 -m unittest discover -s tests -v

RT availability is reported as a skip. Set COMPILEUNIVERSE_REQUIRE_RT=1 to
make missing/broken RT initialization fail (useful on the development GPU).
"""

from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import zlib

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compileuniverse.visibility import Visibility
from compileuniverse.render import Camera, Renderer


def reference_trace(spheres, origins, directions, tmax):
    """Independent float64 quadratic oracle; no backend traversal is reused."""
    spheres = np.asarray(spheres, dtype=np.float64).reshape(-1, 4)
    origins = np.asarray(origins, dtype=np.float64).reshape(-1, 3)
    directions = np.asarray(directions, dtype=np.float64).reshape(-1, 3)
    limits = np.broadcast_to(np.asarray(tmax, dtype=np.float64), (len(origins),))
    ids = np.full(len(origins), -1, dtype=np.int32)
    distances = np.full(len(origins), np.inf)
    a = np.einsum("ij,ij->i", directions, directions)
    # Loop over primitives to keep the oracle's memory bounded.
    for sphere_id, sphere in enumerate(spheres):
        delta = origins - sphere[:3]
        b = np.einsum("ij,ij->i", delta, directions)
        c = np.einsum("ij,ij->i", delta, delta) - sphere[3] ** 2
        discriminant = b * b - a * c
        root = np.sqrt(np.maximum(discriminant, 0))
        near = (-b - root) / a
        far = (-b + root) / a
        candidate = np.where(near > 1e-5, near, far)
        accept = ((discriminant >= 0) & (candidate > 1e-5)
                  & (candidate <= limits) & (candidate < distances))
        distances[accept] = candidate[accept]
        ids[accept] = sphere_id
    return ids, distances


class VisibilityChecks:
    backend = "cpu"

    @classmethod
    def setUpClass(cls):
        try:
            cls.visibility = Visibility(backend=cls.backend)
        except (RuntimeError, OSError) as error:
            if cls.backend == "rt" and os.environ.get("COMPILEUNIVERSE_REQUIRE_RT") != "1":
                raise unittest.SkipTest(f"OptiX RT unavailable: {error}") from error
            raise

    @classmethod
    def tearDownClass(cls):
        cls.visibility.close()

    def check_scene(self, spheres, origins, directions, tmax=1000.0, expected_ids=None):
        spheres = np.asarray(spheres, dtype=np.float32).reshape(-1, 4)
        origins = np.asarray(origins, dtype=np.float32).reshape(-1, 3)
        directions = np.asarray(directions, dtype=np.float32).reshape(-1, 3)
        limits = np.broadcast_to(np.asarray(tmax, dtype=np.float32), (len(origins),)).copy()
        self.visibility.set_spheres(spheres)
        actual_ids, actual_distances = self.visibility.trace(origins, directions, limits)
        oracle_ids, oracle_distances = reference_trace(spheres, origins, directions, limits)
        self.assertEqual(actual_ids.shape, (len(origins),))
        self.assertEqual(actual_distances.shape, (len(origins),))
        np.testing.assert_array_equal(actual_ids, oracle_ids)
        self.assertTrue(np.isposinf(actual_distances[oracle_ids < 0]).all())
        if expected_ids is not None:
            np.testing.assert_array_equal(actual_ids, expected_ids)
        hits = oracle_ids >= 0
        np.testing.assert_allclose(actual_distances[hits], oracle_distances[hits], rtol=2e-4, atol=2e-4)
        return actual_ids, actual_distances

    def test_front_behind_and_miss(self):
        self.check_scene(
            [[0, 0, 5, 1]], [[0, 0, 0]] * 3,
            [[0, 0, 1], [0, 0, -1], [1, 0, 0]], expected_ids=[0, -1, -1],
        )

    def test_closest_surface_wins_independent_of_input_order(self):
        self.check_scene(
            [[0, 0, 12, 2], [0, 0, 5, 1], [0, 0, 9, 1]],
            [[0, 0, 0]], [[0, 0, 1]], expected_ids=[1],
        )

    def test_inside_sphere_uses_exit_surface(self):
        _, distances = self.check_scene(
            [[0, 0, 0, 2]], [[0, 0, 0], [1, 0, 0]],
            [[0, 0, 1], [-1, 0, 0]], expected_ids=[0, 0],
        )
        np.testing.assert_allclose(distances, [2, 3])

    def test_tangent_is_a_hit(self):
        self.check_scene(
            [[0, 0, 5, 1]], [[1, 0, 0], [1.01, 0, 0]],
            [[0, 0, 1], [0, 0, 1]], expected_ids=[0, -1],
        )

    def test_finite_star_distance_excludes_geometry_beyond_star(self):
        self.check_scene(
            [[0, 0, 5, 1]], [[0, 0, 0]] * 4, [[0, 0, 1]] * 4,
            tmax=[3.0, 3.99, 4.0, 4.01], expected_ids=[-1, -1, 0, 0],
        )

    def test_axis_parallel_rays_and_aabb_boundaries(self):
        # Include a tangent on an AABB face: a naive 0 * infinity slab test
        # produces NaN here and can incorrectly prune a valid hit.
        self.check_scene(
            [[0, 0, 5, 1], [6, 0, 0, 1], [0, -6, 0, 1]],
            [[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]],
            [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, 1]],
            expected_ids=[0, 1, 2, 0, -1],
        )

    def test_empty_scene(self):
        self.check_scene([], [[0, 0, 0]], [[0, 0, 1]], expected_ids=[-1])

    def test_empty_ray_batch(self):
        self.check_scene([[0, 0, 5, 1]], [], [], tmax=[])

    def test_rebuilding_after_motion_does_not_keep_stale_bounds(self):
        origins = np.array([[0, 0, 0]], dtype=np.float32)
        directions = np.array([[0, 0, 1]], dtype=np.float32)
        limits = np.array([100], dtype=np.float32)
        self.visibility.set_spheres(np.array([[0, 0, 5, 1]], dtype=np.float32))
        np.testing.assert_array_equal(self.visibility.trace(origins, directions, limits)[0], [0])
        self.visibility.set_spheres(np.array([[10, 0, 5, 1]], dtype=np.float32))
        np.testing.assert_array_equal(self.visibility.trace(origins, directions, limits)[0], [-1])
        self.visibility.set_spheres(np.array([[0, 0, 9, 2]], dtype=np.float32))
        ids, distances = self.visibility.trace(origins, directions, limits)
        np.testing.assert_array_equal(ids, [0])
        np.testing.assert_allclose(distances, [7])

    def test_randomized_against_independent_float64_reference(self):
        rng = np.random.default_rng(47219)
        for count in (1, 19, 137):
            with self.subTest(spheres=count):
                spheres = np.column_stack((
                    rng.uniform([-8, -8, 5], [8, 8, 30], (count, 3)),
                    rng.uniform(0.35, 1.0, count),
                )).astype(np.float32)
                origins = rng.uniform(-2, 2, (2048, 3)).astype(np.float32)
                directions = rng.normal(size=(2048, 3))
                # Deliberate hits as well as full-sphere random misses.
                targets = spheres[rng.integers(0, count, 1024), :3]
                directions[:1024] = targets - origins[:1024]
                directions /= np.linalg.norm(directions, axis=1, keepdims=True)
                limits = rng.uniform(3, 50, 2048).astype(np.float32)
                self.check_scene(spheres, origins, directions, limits)


class TestCPU(VisibilityChecks, unittest.TestCase):
    backend = "cpu"


class TestBrute(VisibilityChecks, unittest.TestCase):
    backend = "brute"


class TestRT(VisibilityChecks, unittest.TestCase):
    backend = "rt"


class TestTextPipeline(unittest.TestCase):
    def renderer(self, backend="cpu", positions=None):
        scene = None
        if positions is not None:
            scene = SimpleNamespace(
                positions=np.asarray(positions, dtype=np.float64),
                luminosity=np.ones(len(positions)),
                colors=np.full((len(positions), 3), 255, dtype=np.uint8),
                spheres=lambda time: np.array([[0, 0, 5, 1]], dtype=np.float64),
            )
        renderer = Renderer(backend, scene=scene)
        self.addCleanup(renderer.close)
        return renderer

    def test_planet_blocks_background_star_but_preserves_foreground_star(self):
        renderer = self.renderer(positions=[[0, 0, 2], [0, 0, 10], [3, 0, 10]])
        with_body = renderer.frame(Camera(), cols=64, rows=32)
        without_body = renderer.frame(Camera(), cols=64, rows=32, planet=False)
        self.assertEqual(with_body.stats["candidates"], 3)
        self.assertEqual(with_body.stats["visible_stars"], 2)
        self.assertEqual(with_body.stats["blocked_stars"], 1)
        self.assertGreater(with_body.stats["surface_cells"], 0)
        self.assertEqual(without_body.stats["visible_stars"], 3)
        self.assertEqual(without_body.stats["blocked_stars"], 0)
        self.assertEqual(without_body.stats["surface_cells"], 0)

    def test_free_camera_motion_reveals_an_occluded_star(self):
        renderer = self.renderer(positions=[[0, 0, 10]])
        original = renderer.frame(Camera(), cols=64, rows=32)
        moved = renderer.frame(
            Camera(position=np.array([3., 0., 0.]), yaw=-np.arctan2(3, 10)),
            cols=64, rows=32,
        )
        self.assertEqual(original.stats["blocked_stars"], 1)
        self.assertEqual(moved.stats["candidates"], 1)
        self.assertEqual(moved.stats["blocked_stars"], 0)
        self.assertEqual(moved.stats["visible_stars"], 1)

    def test_inside_planet_has_no_false_silhouette_at_its_center(self):
        renderer = self.renderer(positions=[[0, 0, -10]])
        frame = renderer.frame(
            Camera(position=np.array([0., 0., 5.]), yaw=np.pi), cols=64, rows=32,
        )
        self.assertEqual(frame.stats["surface_cells"], 64 * 32)
        self.assertEqual(frame.stats["blocked_stars"], 1)
        # Every exit ray is perpendicular to the sphere surface at its center.
        # None should become a grazing-angle silhouette, including on the lit side.
        self.assertFalse(np.isin(frame.glyphs, list("/|\\-")).any())
        self.assertGreater(np.count_nonzero(frame.glyphs != " "), 0)

    def test_catalog_to_ascii_cpu_and_brute_agree(self):
        cpu, brute = self.renderer("cpu"), self.renderer("brute")
        camera = Camera(position=np.array([.2, -.1, .5]), yaw=.13, pitch=-.05)
        for time in (0., 7.5):
            with self.subTest(time=time):
                actual = cpu.frame(camera, time=time, cols=96, rows=40)
                expected = brute.frame(camera, time=time, cols=96, rows=40)
                np.testing.assert_array_equal(actual.glyphs, expected.glyphs)
                np.testing.assert_array_equal(actual.colors, expected.colors)
                self.assertEqual(actual.stats["visible_stars"], expected.stats["visible_stars"])
                self.assertTrue(actual.plain().isascii())
                self.assertEqual([len(line) for line in actual.plain().splitlines()], [96] * 40)
                self.assertEqual(actual.colors.dtype, np.uint8)
                reconstructed = "\n".join("".join(text for color, text in row) for row in actual.runs())
                self.assertEqual(reconstructed, actual.plain())


class TestRecording(unittest.TestCase):
    def check_recording(self, stem):
        metadata = json.loads(stem.with_suffix(".json").read_text())
        full = zlib.decompress(stem.with_suffix(".cells.zlib").read_bytes())
        packed = zlib.decompress(stem.with_suffix(".delta.zlib").read_bytes())
        cell_count = metadata["cols"] * metadata["rows"]
        frame_bytes = cell_count * 4
        mask_bytes = (cell_count + 7) // 8
        self.assertEqual(len(full), metadata["frames"] * frame_bytes)
        frame = bytearray(frame_bytes)
        cursor = 0
        changed_counts = []
        for index in range(metadata["frames"]):
            mask = packed[cursor:cursor + mask_bytes]
            self.assertEqual(len(mask), mask_bytes, f"truncated mask at frame {index}")
            cursor += mask_bytes
            changed = 0
            # Decode with byte operations, independently of the encoder's NumPy
            # packbits/boolean indexing, retaining prior cells where bits are zero.
            for cell in range(cell_count):
                if mask[cell // 8] & (1 << (cell % 8)):
                    value = packed[cursor:cursor + 4]
                    self.assertEqual(len(value), 4, f"truncated cell at frame {index}")
                    frame[cell * 4:cell * 4 + 4] = value
                    cursor += 4
                    changed += 1
            changed_counts.append(changed)
            self.assertEqual(bytes(frame), full[index * frame_bytes:(index + 1) * frame_bytes],
                             f"delta differs from full-cell stream at frame {index}")
            if cell_count % 8:
                self.assertEqual(mask[-1] >> (cell_count % 8), 0, "nonzero mask padding")
        self.assertEqual(cursor, len(packed), "unconsumed bytes after last frame")
        self.assertEqual(changed_counts[0], cell_count, "first frame must be self contained")
        self.assertTrue(any(count < cell_count for count in changed_counts[1:]))
        return metadata

    def test_generated_recording_decodes_all_48_frames_exactly(self):
        from run import record

        with tempfile.TemporaryDirectory(prefix="compileuniverse-record-") as directory:
            stem = Path(directory) / "tiny"
            # 153 cells exercises the final partially occupied change-mask byte.
            args = SimpleNamespace(backend="cpu", out=str(stem), seconds=1, fps=48, cols=17, rows=9)
            with redirect_stdout(io.StringIO()):
                record(args)
            metadata = self.check_recording(stem)
            self.assertEqual(metadata["frames"], 48)

    def test_shipped_orbit_recording_decodes_every_frame_exactly(self):
        stem = Path(__file__).resolve().parents[1] / "artifacts/orbit"
        if not all(stem.with_suffix(suffix).exists() for suffix in (".json", ".cells.zlib", ".delta.zlib")):
            self.skipTest("optional recorded orbit artifacts are not present")
        self.check_recording(stem)


if __name__ == "__main__":
    unittest.main()
