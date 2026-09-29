"""Finite Galactic point pack, independently checked basis and rebuilds."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import compile_galaxy


def reference_icrs_to_galactic():
    """Canonical Hipparcos angles and passive rotations from ERFA icrs2g."""
    p, q, r = np.deg2rad([192.85948, 27.12825, 32.93192])

    def rx(angle):
        c, s = np.cos(angle), np.sin(angle)
        return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])

    def rz(angle):
        c, s = np.cos(angle), np.sin(angle)
        return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])

    return rz(-r) @ rx(np.pi / 2 - q) @ rz(np.pi / 2 + p)


class SpatialGalacticDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / 'artifacts/galaxy-stars.bin'
        cls.blob = cls.path.read_bytes()
        cls.metadata = json.loads(cls.path.with_suffix('.json').read_text())
        cls.points = np.frombuffer(cls.blob, dtype='<f4').reshape(-1, 8)

    def test_binary_contract_finite_fields_and_source_provenance(self):
        m, points = self.metadata, self.points
        self.assertEqual(points.shape, (60000, 8))
        self.assertEqual((m['count'], m['stride'], m['components']), (60000, 32, 8))
        self.assertEqual(len(self.blob), m['bytes'])
        self.assertEqual(hashlib.sha256(self.blob).hexdigest(), m['sha256'])
        compressed = self.path.with_suffix('.bin.gz').read_bytes()
        self.assertEqual(len(compressed), m['gzipBytes'])
        self.assertEqual(gzip.decompress(compressed), self.blob)
        self.assertTrue(np.isfinite(points).all())
        self.assertTrue((points[:, 3] > 0).all())
        self.assertTrue(((points[:, 4:7] >= 0) & (points[:, 4:7] <= 1)).all())
        groups, counts = np.unique(points[:, 7], return_counts=True)
        np.testing.assert_array_equal(groups, [0, 1, 2])
        np.testing.assert_array_equal(counts, [32000, 16000, 12000])
        anchors = json.loads((ROOT / 'artifacts/phenomena-destinations.json').read_text())
        center = next(item for item in anchors['destinations'] if item['id'] == 'sagittarius-a')
        self.assertEqual(m['centerPc'], center['position'])
        self.assertIn('illustrative', m['dataClass'])
        self.assertIn('not solar luminosities', m['lightConvention'])

    def test_independent_reference_basis_preserves_spatial_component_bounds(self):
        matrix = reference_icrs_to_galactic()
        np.testing.assert_allclose(compile_galaxy.ICRS_TO_GALACTIC, matrix, atol=2e-15, rtol=0)
        # Decoding with the independently reconstructed basis catches swapped
        # coordinates or a wrong transpose in the binary packing step.
        galactic = self.points[:, :3].astype(np.float64) @ matrix.T
        disk = galactic[self.points[:, 7] == 0]
        cylindrical_radius = np.hypot(disk[:, 0], disk[:, 1])
        self.assertGreaterEqual(cylindrical_radius.min(), 250 - .002)
        self.assertLessEqual(cylindrical_radius.max(), 15000 + .002)
        self.assertLessEqual(np.max(abs(disk[:, 2])), 1000 + .002)
        self.assertLess(np.median(abs(disk[:, 2]) / cylindrical_radius), .04)
        bulge = galactic[self.points[:, 7] == 1]
        self.assertLessEqual(np.max(np.linalg.norm(bulge, axis=1)), 2700 + .002)
        nuclear = galactic[self.points[:, 7] == 2]
        radius = np.linalg.norm(nuclear, axis=1)
        self.assertGreaterEqual(radius.min(), .1 - 1e-6)
        self.assertLessEqual(radius.max(), 10 + 1e-6)
        # Sources occupy a volume, not a fixed-radius angular shell.
        self.assertGreater(np.quantile(radius, .9) / np.quantile(radius, .1), 30)
        singular_values = np.linalg.svd(nuclear - nuclear.mean(0), compute_uv=False)
        self.assertGreater(singular_values[-1] / singular_values[0], .9)

    def test_compiler_reproduces_published_binary_metadata_and_gzip(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'galaxy-stars.bin'
            compile_galaxy.compile_spatial_galaxy(path)
            for suffix in ('.bin', '.bin.gz', '.json', '.json.gz'):
                self.assertEqual(path.with_suffix(suffix).read_bytes(), self.path.with_suffix(suffix).read_bytes(), suffix)


if __name__ == '__main__':
    unittest.main()
