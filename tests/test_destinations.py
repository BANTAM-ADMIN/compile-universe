"""Catalog anchors, local model scales, provenance and deterministic rebuilds."""
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import compile_destinations as compiler


class ObservedDestinationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'artifacts/phenomena-destinations.json').read_text())
        cls.records = {r['id']: r for r in cls.data['destinations']}

    def test_complete_seven_anchor_registry_has_no_native_id_collisions(self):
        expected = ['vfts-352','betelgeuse-study','crab-nebula','orion-nebula','crab-pulsar','3c-273','sagittarius-a']
        self.assertEqual(list(self.records), expected)
        self.assertEqual([r['index'] for r in self.records.values()], list(range(-50000, -50007, -1)))
        body_indices = {b['index'] for b in json.loads((ROOT / 'artifacts/systems.json').read_text())['bodies']}
        self.assertFalse(body_indices.intersection(r['index'] for r in self.records.values()))
        self.assertTrue(all(r['kind'] == 'phenomenon' for r in self.records.values()))

    def test_position_roundtrips_independently_to_cached_simbad_directions(self):
        source = json.loads((ROOT / 'data/sources/phenomena-simbad-coordinates.json').read_text())
        coords = {' '.join(row[0].split()).removeprefix('NAME '): row for row in source['data']}
        ids = {'vfts-352':'VFTS 352','crab-nebula':'M 1','orion-nebula':'M 42',
               'crab-pulsar':'PSR B0531+21','3c-273':'3C 273','sagittarius-a':'Sgr A*'}
        for ident, simbad in ids.items():
            record = self.records[ident]
            x, y, z = record['position']
            distance = math.sqrt(x*x + y*y + z*z)
            self.assertAlmostEqual((math.degrees(math.atan2(y, x)) + 360) % 360, coords[simbad][2], places=11)
            self.assertAlmostEqual(math.degrees(math.atan2(z, math.hypot(x, y))), coords[simbad][3], places=11)
            self.assertAlmostEqual(distance / record['distancePc'], 1., places=14)
            self.assertEqual(record['sources']['coordinates']['coordinateReference'], coords[simbad][4])
        # These are independent point and nebular-centroid catalog positions.
        self.assertNotEqual(self.records['crab-pulsar']['position'], self.records['crab-nebula']['position'])
        self.assertLess(math.dist(self.records['crab-pulsar']['position'], self.records['crab-nebula']['position']), 1.)

    def test_cartesian_convention_matches_hyg_axes(self):
        for ra, dec, expected in [(0,0,[2,0,0]),(90,0,[0,2,0]),(180,0,[-2,0,0]),(0,90,[0,0,2]),(0,-90,[0,0,-2])]:
            actual = compiler.position_from_sky(ra, dec, 2)
            self.assertLess(math.dist(actual, expected), 1e-14)
        self.assertLess(self.records['sagittarius-a']['position'][1], 0)
        self.assertLess(self.records['sagittarius-a']['position'][2], 0)

    def test_betelgeuse_is_the_exact_existing_catalog_object(self):
        record = self.records['betelgeuse-study']
        raw = (ROOT / 'artifacts/atlas.bin').read_bytes()
        header = struct.unpack_from('<9I', raw)
        at = header[4] + record['linkedCatalogIndex'] * 64
        self.assertEqual(struct.unpack_from('<I', raw, at + 52)[0], 27919)
        self.assertEqual(list(struct.unpack_from('<3d', raw, at)), record['position'])
        original_radius = struct.unpack_from('<f', raw, at + 28)[0]
        self.assertAlmostEqual(record['modelUnitPc'] * 1.15 / original_radius, 1., places=14)
        self.assertIn('illustrative', record['physicalproperties']['catalogRadiusClass'])

    def test_sagittarius_mass_sets_physical_schwarzschild_unit(self):
        record = self.records['sagittarius-a']
        expected_meters = 2 * 1.3271244e20 * 4297000 / 299792458**2
        self.assertAlmostEqual(record['radiusPc'] * 3.085677581491367e16 / expected_meters, 1., places=14)
        self.assertAlmostEqual(record['distancePc'], 8277.)
        self.assertEqual(record['physicalproperties']['distanceStatisticalUncertaintyPc'], 9.)
        self.assertEqual(record['physicalproperties']['distanceSystematicUncertaintyPcApprox'], 30.)
        self.assertIn('nonrotating', record['radiusDataClass'])
        self.assertEqual(record['viewDistanceRadii'], 24.)
        self.assertGreater(record['minimumViewRadius'], 6.)

    def test_visual_model_scales_are_distinct_from_physical_radii(self):
        for record in self.records.values():
            self.assertEqual(record['modelUnitPc'], record['radiusPc'])
            self.assertEqual(record['appearanceDataClass'], 'illustrative closeup')
            self.assertTrue(record['modelScaleDescription'])
            if record['sceneKind'] != 'blackhole':
                self.assertIn('not a measured', record['radiusDataClass'])
            self.assertAlmostEqual(math.hypot(*record['viewDirection']), 1., places=14)
            self.assertGreater(record['viewDistanceRadii'], 0)
        self.assertIn('not its physical radius', self.records['crab-pulsar']['modelScaleDescription'])
        self.assertIn('compressed', self.records['3c-273']['modelScaleDescription'])
        binary = self.records['vfts-352']
        self.assertAlmostEqual(binary['modelUnitPc'] * 1.64 * 3.085677581491367e13, 12000000., places=6)
        self.assertIn('cosmological', ' '.join(self.data['limitations']))

    def test_caches_and_offline_rebuild_are_exact(self):
        for entry in self.data['sources'].values():
            if 'cache' in entry:
                self.assertEqual(hashlib.sha256((ROOT / entry['cache']).read_bytes()).hexdigest(), entry['sha256'])
        path = ROOT / 'artifacts/phenomena-destinations.json'
        with tempfile.TemporaryDirectory() as folder, mock.patch('urllib.request.urlopen', side_effect=AssertionError('Offline compile attempted network')):
            output = Path(folder) / 'destinations.json'
            compiler.compile_destinations(output)
            self.assertEqual(output.read_bytes(), path.read_bytes())
            self.assertEqual(output.with_suffix('.json.gz').read_bytes(), path.with_suffix('.json.gz').read_bytes())
            self.assertEqual(gzip.decompress(output.with_suffix('.json.gz').read_bytes()), output.read_bytes())

    def test_invalid_coordinates_nonfinite_scales_and_duplicate_ids_are_rejected(self):
        for values in [(0,91,1),(-1,0,1),(360,0,1),(0,0,0),(0,0,float('inf'))]:
            with self.assertRaises(ValueError): compiler.position_from_sky(*values)
        for field, value in [('index',-2), ('position',[0,0]), ('radiusPc',float('nan'))]:
            altered = copy.deepcopy(self.data)
            altered['destinations'][0][field] = value
            with self.assertRaises(ValueError): compiler.validate(altered)
        altered = copy.deepcopy(self.data)
        altered['destinations'][1]['index'] = altered['destinations'][0]['index']
        with self.assertRaises(ValueError): compiler.validate(altered)


if __name__ == '__main__':
    unittest.main()
