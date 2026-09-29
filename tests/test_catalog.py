"""Catalog provenance, independent binary decoding, and spatial-bound checks."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import compile_catalog as compiler


def decode_binary(payload):
    """Decode the public wire layout without using production NumPy dtypes."""
    h = struct.unpack_from("<16I", payload)
    if h[0] != 0x54415543 or h[1] != 1 or h[8] != len(payload):
        raise AssertionError("invalid header")
    stars = [struct.unpack_from("<3d7f3I", payload, h[4] + 64 * i) for i in range(h[2])]
    nodes = [struct.unpack_from("<3d5f5I", payload, h[5] + 64 * i) for i in range(h[3])]
    permutation = np.frombuffer(payload, dtype="<u4", count=h[2], offset=h[6])
    return h, stars, nodes, permutation


class CatalogReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = (ROOT / "artifacts/atlas.bin").read_bytes()
        cls.header, cls.stars, cls.nodes, cls.permutation = decode_binary(cls.payload)
        cls.metadata = json.loads((ROOT / "artifacts/atlas.json").read_text())
        cls.search = json.loads((ROOT / "artifacts/atlas-search.json").read_text())
        cls.by_id = {s[10]: (i, s) for i, s in enumerate(cls.stars)}
        with gzip.open(compiler.DEFAULT_SOURCE, "rt") as stream:
            cls.source = list(csv.DictReader(stream))

    def test_pinned_release_count_hash_and_filter_reconciliation(self):
        digest = hashlib.sha256(compiler.DEFAULT_SOURCE.read_bytes()).hexdigest()
        self.assertEqual(digest, compiler.SOURCE_SHA256)
        self.assertEqual(len(self.source), 119626)
        sentinels = {int(r["id"]) for r in self.source if float(r["dist"]) >= 100000}
        self.assertEqual(len(sentinels), 10225)
        self.assertEqual(len(self.stars), 109401)
        self.assertFalse(sentinels.intersection(self.by_id))
        self.assertEqual(set(self.by_id), {int(r["id"]) for r in self.source} - sentinels)
        self.assertEqual(self.metadata["counts"]["invalid_spatial_or_photometric"], 0)
        self.assertEqual(self.metadata["source"]["license"], "CC BY-SA 4.0")
        self.assertEqual(hashlib.sha256(self.payload).hexdigest(), self.metadata["sha256"])

    def test_wire_layout_alignment_finiteness_and_source_order(self):
        for offset in self.header[4:7]:
            self.assertEqual(offset % 64, 0)
        self.assertEqual(self.header[7], 0)
        self.assertEqual(self.header[9:], (0,) * 7)
        values = np.array([s[:10] for s in self.stars])
        self.assertTrue(np.isfinite(values).all())
        self.assertTrue(np.all(values[:, 4] > 0))
        self.assertTrue(np.all((values[:, 5:8] >= 0) & (values[:, 5:8] <= 1)))
        ids = [s[10] for s in self.stars]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(s[12] == 0 for s in self.stars))

    def test_landmark_positions_remain_source_double_precision(self):
        # Independent fixed source values also protect names/component IDs.
        landmarks = {
            32263: (-.494323, 2.476731, -.758485),
            70666: (-.472264, -.361451, -1.151219),
            71453: (-.495181, -.413973, -1.156674),
            71456: (-.495203, -.414084, -1.156625),
        }
        for ident, xyz in landmarks.items():
            self.assertEqual(self.by_id[ident][1][:3], xyz)
        a, b = np.array(landmarks[71456]), np.array(landmarks[71453])
        self.assertGreater(np.linalg.norm(a - b), 1e-5)
        self.assertLess(np.linalg.norm(a - b), .001)
        # Every retained coordinate is preserved exactly, not just landmarks.
        for row in self.source:
            ident = int(row["id"])
            if ident and ident in self.by_id:
                self.assertEqual(self.by_id[ident][1][:3], tuple(float(row[k]) for k in ("x", "y", "z")))

    def test_synthetic_sun_and_curated_radius_flags(self):
        sun = self.stars[0]
        self.assertEqual(sun[:3], (0., 0., 0.))
        self.assertEqual(sun[10:12], (0, 1))
        self.assertAlmostEqual(sun[4] / compiler.SOLAR_RADIUS_PC, 1., places=6)
        self.assertEqual(sun[9], 5772.)
        expected = {71456: 1.2234, 71453: .8632, 70666: .141, 32263: 1.713}
        for ident, radius in expected.items():
            star = self.by_id[ident][1]
            self.assertTrue(star[11] & 16)
            self.assertFalse(star[11] & 2)
            self.assertAlmostEqual(star[4] / compiler.SOLAR_RADIUS_PC, radius, places=6)
        self.assertEqual(sum(bool(s[11] & 16) for s in self.stars), 4)
        self.assertTrue(all(s[11] & (1 | 2 | 16) for s in self.stars))

    def test_bvh_contains_all_descendant_spheres_and_photometric_bounds(self):
        self.assertEqual(sorted(self.permutation.tolist()), list(range(len(self.stars))))
        xyz = np.array([s[:3] for s in self.stars])
        radii = np.array([s[4] for s in self.stars])
        magnitudes = np.array([s[3] for s in self.stars])
        visited = set()

        def visit(index):
            self.assertNotIn(index, visited)
            visited.add(index)
            node = self.nodes[index]
            left, right, start, count = node[8:12]
            if count:
                self.assertLessEqual(count, 128)
                ids = self.permutation[start:start + count]
                self.assertEqual(len(ids), count)
            else:
                self.assertGreater(left, index)
                self.assertGreater(right, index)
                ids = np.concatenate((visit(left), visit(right)))
            center, extent = np.array(node[:3]), np.array(node[3:6])
            self.assertTrue(np.all(xyz[ids] - radii[ids, None] >= center - extent))
            self.assertTrue(np.all(xyz[ids] + radii[ids, None] <= center + extent))
            self.assertLessEqual(node[6], float(magnitudes[ids].min()))
            self.assertGreaterEqual(node[7], float(radii[ids].max()))
            return ids

        ids = visit(0)
        self.assertEqual(len(visited), len(self.nodes))
        self.assertEqual(sorted(ids.tolist()), list(range(len(self.stars))))

    def test_search_indices_aliases_and_all_retained_named_stars(self):
        search_by_id = {s["id"]: s for s in self.search["stars"]}
        self.assertEqual(len(search_by_id), 10493)
        self.assertEqual(self.search["named_count"], 493)
        self.assertEqual(self.search["additional_count"], 10000)
        for row in self.source:
            if row["proper"] and int(row["id"]) in self.by_id:
                self.assertIn(int(row["id"]), search_by_id)
        for entry in self.search["stars"]:
            i, star = self.by_id[entry["id"]]
            self.assertEqual(entry["index"], i)
            self.assertEqual(entry["position"], list(star[:3]))
            self.assertEqual(entry["radius_pc"], star[4])
            self.assertEqual(entry["flags"], star[11])
            self.assertLess(entry["distance"], 100000)
            if entry["flags"] & 16:
                self.assertTrue(entry["radius_source_url"].startswith("https://arxiv.org/"))
                self.assertGreater(entry["radius_uncertainty_solar"], 0)
        self.assertIn("Alpha Centauri A", search_by_id[71456]["aliases"])
        self.assertIn("Alpha Centauri B", search_by_id[71453]["aliases"])
        self.assertIn("Proxima", search_by_id[70666]["aliases"])
        self.assertIn("Pleiades (Alcyone member star)", search_by_id[17661]["aliases"])

    def test_offline_rebuild_is_byte_reproducible_including_gzip_and_search(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "atlas.bin"
            compiler.compile_catalog(compiler.DEFAULT_SOURCE, output)
            for name in ("atlas.bin", "atlas.bin.gz", "atlas.json", "atlas.json.gz", "atlas-search.json", "atlas-search.json.gz"):
                self.assertEqual((Path(folder) / name).read_bytes(), (ROOT / "artifacts" / name).read_bytes(), name)


class CatalogInputValidationTests(unittest.TestCase):
    def source(self, folder, changes):
        fields = "id,proper,x,y,z,dist,mag,absmag,lum,ci,spect,hip,hd,hr,gl,bf".split(",")
        out = io.StringIO()
        writer = csv.DictWriter(out, fields)
        writer.writeheader()
        for i, change in enumerate(changes, 1):
            row = dict(id=i, proper="", x=1., y=2., z=3., dist=4., mag=3., absmag=4., lum=1., ci=.6,
                       spect="G2V", hip="", hd="", hr="", gl="", bf="")
            row.update(change)
            writer.writerow(row)
        path = Path(folder) / "fixture.csv.gz"
        path.write_bytes(gzip.compress(out.getvalue().encode(), mtime=0))
        return path

    def test_sentinel_nonfinite_and_nonpositive_source_rows_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.source(folder, [{}, {"dist": 100000}, {"dist": 200000}, {"x": "nan"},
                                        {"mag": "inf"}, {"dist": -1}, {"lum": 0}, {"ci": "nan"}])
            rows, counts, _ = compiler.read_source(path)
            self.assertEqual([r["id"] for r in rows], [0, 1, 8])
            self.assertEqual(counts["distance_sentinel"], 2)
            self.assertEqual(counts["invalid_spatial_or_photometric"], 4)
            stars = compiler.compile_stars(rows)
            self.assertTrue(stars["flags"][-1] & 4)
            self.assertTrue(np.isfinite(stars["temperature"]).all())

    def test_duplicate_ids_fail_instead_of_aliasing_search_targets(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.source(folder, [{"id": 4}, {"id": 4}])
            with self.assertRaisesRegex(ValueError, "Duplicate source id"):
                compiler.read_source(path)

    def test_empty_valid_catalog_still_has_finite_sun_tree(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.source(folder, [{"dist": 100000}])
            output = Path(folder) / "atlas.bin"
            compiler.compile_catalog(path, output, extra_limit=2)
            h, stars, nodes, permutation = decode_binary(output.read_bytes())
            self.assertEqual((h[2], h[3]), (1, 1))
            self.assertEqual(nodes[0][11], 1)
            self.assertEqual(permutation.tolist(), [0])
            self.assertEqual(stars[0][:3], (0., 0., 0.))


if __name__ == "__main__":
    unittest.main()
