"""The production Milky Way must resolve as a galaxy when leaving Earth."""
import unittest

import numpy as np

from galaxy_overview_capture import cameras, GZ, GX
from test_galaxy_parallax import NativeGalaxy, ROOT, COLS, ROWS, LIBRARY


@unittest.skipUnless(LIBRARY.exists(), 'Build the native atlas first')
class TestGalaxyZoom(unittest.TestCase):
    def setUp(self):
        self.engine = NativeGalaxy()
        self.engine.sources(np.fromfile(ROOT / 'artifacts/galaxy-stars.bin', dtype='<f4').reshape(-1, 8))

    def tearDown(self):
        self.engine.lib.atlas_shutdown()

    def view(self, eye, target):
        delta = np.asarray(target) - eye
        delta /= np.linalg.norm(delta)
        frame = self.engine.frame(eye, yaw=float(np.arctan2(delta[0], delta[2])), pitch=float(np.arcsin(delta[1])))
        pixels = np.argwhere((frame[:COLS*ROWS] != 32).reshape(ROWS, COLS))
        return frame, pixels

    def test_earth_pullback_retains_light_and_reveals_extended_structure(self):
        views = {}
        for name, eye, target in cameras():
            if not name.startswith('earth-pullback-'):
                continue
            frame, pixels = self.view(eye, target)
            self.assertGreater(len(pixels), 50, name + ' must not become an empty frame')
            views[name] = (frame, pixels)
        near = views['earth-pullback-30000pc'][1]
        far = views['earth-pullback-60000pc'][1]
        self.assertGreater(len(near), 2000, 'The galaxy must reveal extended structure, not just a bright nucleus')
        self.assertGreater(len(far), 500, 'Unresolved light must survive a full-galaxy view')
        self.assertGreater(np.ptp(near[:, 1]), 150)
        self.assertGreater(np.ptp(far[:, 1]), 70)
        self.assertLess(np.ptp(far[:, 1]), np.ptp(near[:, 1]) * .7,
                        'The galaxy must shrink spatially as the observer recedes')

    def test_exterior_inclination_and_distance_change_the_galaxy(self):
        original, face = self.view(GZ * 40000, np.zeros(3))
        _, edge = self.view(GX * 40000 + GZ * 4000, np.zeros(3))
        _, distant = self.view(GZ * 80000, np.zeros(3))
        self.assertGreater(len(face), 1500)
        self.assertGreater(len(edge), 500)
        self.assertGreater(len(distant), 400)
        # Rotation in ICRS changes the on-screen angle; covariance eigenvalues
        # measure disk flattening without assuming a horizontal Galactic plane.
        def flattening(xy):
            eigenvalues = np.linalg.eigvalsh(np.cov(xy.T))
            return eigenvalues[1] / eigenvalues[0]
        self.assertGreater(flattening(edge), flattening(face) * 3,
                           'The same finite disk must become narrow when viewed edge-on')
        self.assertLess(np.ptp(distant[:, 1]), np.ptp(face[:, 1]) * .6)
        returned, _ = self.view(GZ * 40000, np.zeros(3))
        np.testing.assert_array_equal(original, returned)


if __name__ == '__main__':
    unittest.main()
