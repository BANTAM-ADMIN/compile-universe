"""Independent projection tests for finite, camera-relative Galactic samples."""
import ctypes as ct
import json
from pathlib import Path
import struct
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "native/build/libuniverse_atlas.so"
COLS, ROWS, FOV = 220, 94, 50.
ANCHOR = np.array(json.loads((ROOT / "artifacts/galaxy-stars.json").read_text())["centerPc"])
MEASUREMENTS = {}


def empty_sky_catalog():
    # Native atlas requires a nonempty catalog. This source is far behind all
    # fixture cameras and too faint to contribute: every tested pixel is ours.
    record = struct.pack("<3d7f3I", 0., 0., -1e12, 100., 1e-20,
                         1., 1., 1., 0., 5772., 0, 0, 0)
    header = struct.pack("<9I", 0x54415543, 1, 1, 0, 64, 128, 128, 0, 128)
    return header + bytes(64 - len(header)) + record


class NativeGalaxy:
    def __init__(self):
        self.lib = ct.CDLL(str(LIBRARY))
        self.lib.atlas_init.argtypes = [ct.c_void_p, ct.c_uint32]
        self.lib.atlas_set_galaxy.argtypes = [ct.c_void_p, ct.c_uint32, ct.c_void_p]
        self.lib.atlas_frame.argtypes = [ct.c_int, ct.c_int] + [ct.c_double] * 8 + [ct.c_int]
        self.lib.atlas_output.restype = ct.POINTER(ct.c_uint8)
        self.lib.atlas_error.restype = ct.c_char_p
        self.lib.atlas_shutdown()
        self.asset = ct.create_string_buffer(empty_sky_catalog())
        self.check(self.lib.atlas_init(self.asset, len(empty_sky_catalog())))
        self.points = np.empty((0, 8), dtype=np.float32)

    def check(self, code):
        if code != 0:
            raise AssertionError(self.lib.atlas_error().decode())

    def sources(self, values):
        self.points = np.ascontiguousarray(values, dtype=np.float32).reshape((-1, 8))

    def frame(self, eye=(0, 0, 0), yaw=0., pitch=0., time=1.337):
        eye = np.ascontiguousarray(eye, dtype=np.float64)
        self.check(self.lib.atlas_set_galaxy(self.points.ctypes.data if len(self.points) else None,
                                           len(self.points), eye.ctypes.data))
        self.check(self.lib.atlas_frame(COLS, ROWS, *(ANCHOR + eye), yaw, pitch, FOV, time, 1., -1))
        return np.ctypeslib.as_array(self.lib.atlas_output(), shape=(COLS * ROWS * 7,)).copy()


def source(position, strength=.6):
    distance_squared = float(np.dot(position, position))
    return [*position, strength * distance_squared, 1., .8, .6, 0.]


def energy(frame):
    n = COLS * ROWS
    foreground = frame[n:4*n].reshape(n, 3).astype(float).max(axis=1)
    foreground[frame[:n] == 32] = 0
    background = frame[4*n:].reshape(n, 3).astype(float).max(axis=1)
    return (foreground + background).reshape(ROWS, COLS)


def centroid(frame):
    weights = energy(frame)
    if weights.sum() <= 0:
        raise AssertionError("The isolated finite source must light visible cells")
    return float((weights * np.arange(COLS)[None, :]).sum() / weights.sum())


def expected_x(position, eye=(0, 0, 0), yaw=0.):
    delta = np.asarray(position) - eye
    right = np.array([-np.cos(yaw), 0., np.sin(yaw)])
    forward = np.array([np.sin(yaw), 0., np.cos(yaw)])
    tanx = np.tan(np.deg2rad(FOV / 2)) * COLS / (ROWS * 1.8)
    return (1 + np.dot(delta, right) / (np.dot(delta, forward) * tanx)) * COLS / 2 - .5


@unittest.skipUnless(LIBRARY.exists(), "Build native/build/libuniverse_atlas.so first")
class TestGalaxyParallax(unittest.TestCase):
    def setUp(self):
        self.engine = NativeGalaxy()

    def tearDown(self):
        self.engine.lib.atlas_shutdown()

    def test_lateral_motion_has_correct_depth_dependent_parallax(self):
        shifts = []
        for depth in (100., 1000.):
            point = np.array([depth * .06, 0., depth])
            self.engine.sources([source(point)])
            original = self.engine.frame()
            moved = self.engine.frame(eye=(10., 0., 0.))
            before, after = centroid(original), centroid(moved)
            predicted = expected_x(point) - expected_x(point, np.array([10., 0., 0.]))
            self.assertAlmostEqual(before, expected_x(point), delta=.6)
            self.assertAlmostEqual(before - after, predicted, delta=.65)
            self.assertGreater(after - before, 1., "A finite distant source cannot remain screen-fixed")
            self.assertFalse(np.array_equal(original, moved))
            np.testing.assert_array_equal(original, self.engine.frame())
            shifts.append(before - after)
            MEASUREMENTS[f"source_{int(depth)}pc"] = {
                "beforeCell": before, "afterCell": after,
                "shiftCells": before - after, "expectedShiftCells": predicted,
            }
        self.assertGreater(shifts[0] / shifts[1], 5., "Nearer objects must show substantially more parallax")

    def test_dolly_resolves_the_extent_of_a_finite_cluster(self):
        positions = []
        for x in (-3., 3.):
            point = np.array([x, 0., 100.])
            self.engine.sources([source(point, .2)])
            positions.append((centroid(self.engine.frame()), centroid(self.engine.frame(eye=(0., 0., 50.)))))
        before = positions[1][0] - positions[0][0]
        after = positions[1][1] - positions[0][1]
        self.assertAlmostEqual(after / before, 2., delta=.12)
        MEASUREMENTS["clusterDolly"] = {"separationBeforeCells": before, "separationAfterCells": after}

    def test_rotation_and_return_preserve_world_anchoring(self):
        point = np.array([6., 0., 100.])
        self.engine.sources([source(point)])
        original = self.engine.frame()
        rotated = self.engine.frame(yaw=.08)
        self.assertAlmostEqual(centroid(rotated), expected_x(point, yaw=.08), delta=.65)
        self.assertFalse(np.array_equal(original, rotated))
        np.testing.assert_array_equal(original, self.engine.frame())

    def test_frozen_spatial_samples_do_not_animate_to_fake_motion(self):
        self.engine.sources([source((6., 0., 100.)), source((-12., 3., 180.))])
        original = self.engine.frame(time=0.)
        np.testing.assert_array_equal(original, self.engine.frame(time=123.456))
        np.testing.assert_array_equal(original, self.engine.frame(time=0.))

    def test_solar_neighborhood_translation_uses_the_same_finite_offsets(self):
        eye = -ANCHOR
        self.engine.sources([source((6., 0., 100.))])
        reference = centroid(self.engine.frame())
        point = eye + [6., 0., 100.]
        shifted_source = source((6., 0., 100.))
        shifted_source[:3] = point
        self.engine.sources([shifted_source])
        local = centroid(self.engine.frame(eye=eye))
        moved = centroid(self.engine.frame(eye=eye + [10., 0., 0.]))
        self.assertAlmostEqual(local, reference, delta=.05)
        self.assertAlmostEqual(local - moved, expected_x((6., 0., 100.)) - expected_x((6., 0., 100.), np.array([10., 0., 0.])), delta=.65)

    def test_clearing_the_environment_leaves_no_angular_backdrop(self):
        self.engine.sources([source((6., 0., 100.))])
        self.assertGreater(energy(self.engine.frame()).sum(), 0)
        self.engine.sources([])
        self.assertEqual(energy(self.engine.frame()).sum(), 0)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestGalaxyParallax)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {"tests": result.testsRun, "passed": result.wasSuccessful(), "measurements": MEASUREMENTS}
    (ROOT / "artifacts/galaxy-parallax-native.json").write_text(json.dumps(report, indent=2) + "\n")
    raise SystemExit(not result.wasSuccessful())
