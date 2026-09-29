"""Independent physical-unit, provenance, and destination consistency checks."""
import copy
import gzip
import hashlib
import json
import math
import re
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import compile_systems as compiler


class PlanetarySystemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / "artifacts/systems.json").read_text())
        cls.bodies = {b["id"]: b for b in cls.data["bodies"]}

    def test_complete_curated_graph_and_unique_native_indices(self):
        self.assertEqual(len(self.bodies), 490)
        self.assertEqual(len({b["index"] for b in self.bodies.values()}), 490)
        self.assertEqual(self.bodies["earth"]["index"], -2)
        self.assertEqual(sum(b["kind"] == "planet" for b in self.bodies.values()), 8)
        self.assertEqual(sum(b["kind"] == "moon" for b in self.bodies.values()), 465)
        self.assertEqual(sum(b["kind"] == "exoplanet" for b in self.bodies.values()), 4)
        all_ids = [i for s in self.data["systems"] for i in s["bodyIds"]]
        self.assertEqual(sorted(all_ids), sorted(self.bodies))
        self.assertEqual(len(all_ids), len(set(all_ids)))
        for body in self.bodies.values():
            if body["kind"] == "moon":
                self.assertIn(body["parentId"], self.bodies)
                self.assertIn(self.bodies[body["parentId"]]["kind"], ("planet", "dwarf"))

    def test_all_solar_positions_independently_match_cached_horizons(self):
        # Parse CSV independently, and use the AU-to-pc relation directly.
        for body in self.bodies.values():
            if body["dataClass"] != "solar-system-ephemeris":
                continue
            source = body["provenance"]["position"]
            raw = (ROOT / source["cache"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), source["sha256"])
            result = json.loads(raw)["result"]
            self.assertIn("GEOMETRIC cartesian states", result)
            self.assertIn("Reference frame : ICRF", result)
            self.assertIn("Center body name: Sun (10)", result)
            data = result.split("$$SOE")[1].split("$$EOE")[0].strip().split(",")
            self.assertEqual(float(data[0]), 2451545.)
            reference = np.array([float(v) for v in data[2:5]]) / (180 * 3600 / math.pi)
            np.testing.assert_allclose(body["position"], reference, rtol=2e-16, atol=1e-20)
        earth = json.loads((ROOT / "artifacts/solar.json").read_text())["earth"]
        self.assertEqual(earth["position"], self.bodies["earth"]["position"])
        self.assertEqual(earth["radiusPc"], self.bodies["earth"]["radiusPc"])

    def test_moon_parent_separations_are_physical_not_solar_scale(self):
        bounds_km = {"moon": (350000, 410000), "io": (380000, 460000),
                     "europa": (600000, 750000), "titan": (1100000, 1350000),
                     "enceladus": (210000, 265000)}
        for ident, (low, high) in bounds_km.items():
            body = self.bodies[ident]
            parent = self.bodies[body["parentId"]]
            distance = math.dist(body["position"], parent["position"]) * 3.085677581491367e13
            self.assertGreater(distance, low, ident)
            self.assertLess(distance, high, ident)
            self.assertEqual(body["hostPosition"], [0., 0., 0.])

    def test_mean_radii_and_ring_geometry_have_consistent_units(self):
        expected = {"earth": 6371.0084, "jupiter": 69911., "saturn": 58232.,
                    "moon": 1737.4, "europa": 1560.8, "enceladus": 252.1}
        for ident, radius in expected.items():
            self.assertEqual(self.bodies[ident]["radiusKm"], radius)
            self.assertAlmostEqual(self.bodies[ident]["radiusPc"] * 3.085677581491367e13, radius, places=8)
        saturn = self.bodies["saturn"]
        self.assertAlmostEqual(saturn["ring"]["innerRadius"] * saturn["radiusKm"], 74658., places=8)
        self.assertAlmostEqual(saturn["ring"]["outerRadius"] * saturn["radiusKm"], 136780., places=8)
        x, y, z = saturn["axis"]
        self.assertAlmostEqual(math.degrees(math.atan2(y, x)), 40.589, places=8)
        self.assertAlmostEqual(math.degrees(math.asin(z)), 83.537, places=8)

    def test_exoplanet_confirmation_host_crossmatch_and_illustrative_offsets(self):
        archive = {r["pl_name"]: r for r in json.loads((ROOT / "data/sources/exoplanet-systems-ps.json").read_text())}
        payload = (ROOT / "artifacts/atlas.bin").read_bytes()
        header = struct.unpack_from("<9I", payload)
        expected_hip = {"proxima-b": 70890, "51-peg-b": 113357, "hd209458-b": 108859, "55-cnc-e": 43587}
        for ident, hip in expected_hip.items():
            body = self.bodies[ident]
            row = archive[body["aliases"][0]]
            self.assertEqual(row["soltype"], "Published Confirmed")
            self.assertEqual(row["pl_controv_flag"], 0)
            self.assertEqual(row["hip_name"], f"HIP {hip}")
            index = body["parentStarIndex"]
            host_xyz = struct.unpack_from("<3d", payload, header[4] + index * 64)
            self.assertEqual(body["hostPosition"], list(host_xyz))
            separation = math.dist(body["position"], host_xyz) * (648000 / math.pi)
            self.assertAlmostEqual(separation, body["orbit"]["semimajorAxisAU"], delta=2e-9)
            self.assertIn("illustrative", body["positionDataClass"])
            self.assertIn("not an ephemeris", body["positionDataClass"])
            self.assertEqual(body["orbit"]["periodDays"], row["pl_orbper"])
            if ident in ("proxima-b", "51-peg-b"):
                self.assertIsNone(row["pl_rade"])
                self.assertIn("illustrative radius", body["radiusDataClass"])
                self.assertIsNone(body["radiusUncertaintyEarth"])
            else:
                self.assertEqual(row["pl_radelim"], 0)
                self.assertEqual(body["radiusKm"], row["pl_rade"] * 6378.1)
                self.assertEqual(body["radiusDataClass"], "published transit radius")

    def test_actual_maps_and_illustrated_surfaces_are_distinguished_and_hashes_match(self):
        for body in self.bodies.values():
            texture = body["texture"]
            raw = (ROOT / texture["url"].lstrip("/")).read_bytes()
            self.assertEqual(len(raw), texture["width"] * texture["height"] * texture["channels"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), texture["sha256"])
            measured_map = body["id"] in ("earth", "moon", "mars")
            self.assertEqual(body["appearanceDataClass"] == "NASA source map", measured_map)
            if measured_map:
                self.assertIn("nasa.gov", body["provenance"]["appearance"]["url"])
            else:
                self.assertEqual(body["appearanceDataClass"], "authored illustration")
        ring = self.bodies["saturn"]["ring"]["texture"]
        raw = (ROOT / ring["url"].lstrip("/")).read_bytes()
        self.assertEqual(len(raw), 4 * ring["width"])
        self.assertEqual(hashlib.sha256(raw).hexdigest(), ring["sha256"])

    def test_complete_discovery_registry_and_duplicate_puck_handling(self):
        normalize = lambda name: re.sub("[^a-z0-9]", "", name.lower())
        rows = compiler.table_rows((ROOT / "data/sources/jpl-moon-discovery.html").read_bytes())
        discovered = {normalize(r[1] or r[2]) for r in rows if len(r) == 6}
        emitted = {normalize(b["name"]) for b in self.bodies.values() if b["kind"] == "moon"}
        self.assertEqual(discovered | {"moon", "dysnomia", "hiiaka", "namaka", "mk2"}, emitted)
        self.assertEqual(self.data["moonRegistry"]["byParent"],
                         {"earth": 1, "mars": 2, "jupiter": 115, "saturn": 293, "uranus": 29, "neptune": 16, "pluto": 5, "eris": 1, "haumea": 2, "makemake": 1})
        self.assertEqual(self.bodies["puck"]["orbit"]["epoch"], "2000-01-01.5")
        self.assertEqual(self.data["moonRegistry"]["uniqueMeanElementMoons"], 459)
        self.assertEqual(sum(b["kind"] == "dwarf" for b in self.bodies.values()), 5)
        self.assertEqual(sum(b["kind"] == "moon" and b["radiusDataClass"] == "published mean radius" for b in self.bodies.values()), 46)

    def test_mean_orbit_positions_obey_independent_elliptical_distance_bounds(self):
        approximate = 0
        for body in self.bodies.values():
            if body["dataClass"] != "solar-system-approximate-orbit":
                continue
            approximate += 1
            orbit = body["orbit"]
            a, e = orbit["semimajorAxisKm"], orbit["eccentricity"]
            radius = math.dist(body["position"], self.bodies[body["parentId"]]["position"]) * compiler.KM_PER_PC
            self.assertGreaterEqual(radius, a * (1 - e) - .001, body["name"])
            self.assertLessEqual(radius, a * (1 + e) + .001, body["name"])
            self.assertEqual(body["radiusKm"], 2.)
            self.assertTrue(body["radiusEstimated"])
            self.assertIn("illustrative", body["radiusDataClass"])
        self.assertEqual(approximate, 415)

    def test_kepler_solver_circular_quarter_orbit_and_eccentric_apsides(self):
        orbit = dict(parent="earth", frame="ecliptic", epoch="2000-01-01.5", semimajorAxisKm=1000.,
                     eccentricity=0., argumentPeriapsisDeg=0., meanAnomalyDeg=90.,
                     inclinationDeg=0., ascendingNodeDeg=0., periodDays=20.)
        actual = compiler.element_position_km(orbit)
        obliquity = math.radians(23.439291111)
        np.testing.assert_allclose(actual, [0, 1000 * math.cos(obliquity), 1000 * math.sin(obliquity)], atol=1e-10)
        # A source epoch five days later must propagate backward by a quarter orbit.
        orbit["epoch"] = "2000-01-06.5"
        np.testing.assert_allclose(compiler.element_position_km(orbit), [1000, 0, 0], atol=1e-10)
        orbit.update(epoch="2000-01-01.5", eccentricity=.909, meanAnomalyDeg=0.)
        self.assertAlmostEqual(math.dist(compiler.element_position_km(orbit), [0, 0, 0]), 91., places=9)
        orbit["meanAnomalyDeg"] = 180.
        self.assertAlmostEqual(math.dist(compiler.element_position_km(orbit), [0, 0, 0]), 1909., places=9)

    def test_phobos_deimos_shape_extents_match_nasa_dimensions(self):
        for ident, dimensions in [("phobos", [27., 22., 18.]), ("deimos", [15., 12., 11.])]:
            body = self.bodies[ident]
            np.testing.assert_allclose(np.array(body["shape"]) * 2 * body["radiusKm"], dimensions, rtol=1e-15)
            self.assertIn("orientation illustrative", body["shapeDataClass"])
            self.assertIn("science.nasa.gov", body["provenance"]["shape"]["url"])

    def test_known_dwarf_companions_use_estimated_radii_and_honest_placement(self):
        expected = {"dysnomia": (350., 37273.), "hiiaka": (150., 49880.),
                    "namaka": (75., 25657.), "mk2": (80., 20921.472)}
        for ident, (radius, separation) in expected.items():
            body = self.bodies[ident]
            self.assertEqual(body["radiusKm"], radius)
            self.assertIn("model-dependent", body["radiusDataClass"])
            self.assertIn("illustrative", body["positionDataClass"])
            actual = math.dist(body["position"], self.bodies[body["parentId"]]["position"]) * compiler.KM_PER_PC
            self.assertAlmostEqual(actual, separation, delta=.001)
        self.assertIn("projected separation", self.bodies["mk2"]["orbit"]["separationType"])
        self.assertIsNone(self.bodies["mk2"]["orbit"]["periodDays"])

    def test_belts_are_ecliptic_and_particles_are_explicit_illustrations(self):
        self.assertEqual(len(self.data["belts"]), 2)
        self.assertEqual(self.data["systems"][0]["belts"], self.data["belts"])
        for belt, expected in zip(self.data["belts"], [(2.2, 3.3), (30., 50.)]):
            self.assertEqual((belt["innerRadiusAU"], belt["outerRadiusAU"]), expected)
            self.assertEqual(belt["dataClass"], "illustrative-particles-observed-belt")
            self.assertEqual(belt["count"], 1400)
            self.assertEqual(belt["position"], [0., 0., 0.])
            self.assertAlmostEqual(math.dist(belt["axis"], [0, 0, 0]), 1.)
            self.assertAlmostEqual(math.degrees(math.atan2(-belt["axis"][1], belt["axis"][2])), 23.439291111)

    def test_minor_body_radii_shapes_and_comet_appearance_disclosures(self):
        self.assertEqual(sum(b["kind"] == "asteroid" for b in self.bodies.values()), 6)
        self.assertEqual(sum(b["kind"] == "comet" for b in self.bodies.values()), 2)
        for ident in ("vesta", "pallas", "eros", "bennu", "ryugu", "itokawa", "halley", "67p"):
            body = self.bodies[ident]
            source = json.loads((ROOT / f"data/sources/sbdb-{ident}.json").read_text())
            diameter = next(p for p in source["phys_par"] if p["name"] == "diameter")
            self.assertEqual(body["radiusKm"] * 2, float(diameter["value"]))
            self.assertEqual(body["sbdbDesignation"], source["object"]["des"])
            self.assertEqual(body["dataClass"], "solar-system-ephemeris")
            if "shape" in body:
                self.assertTrue(all(0 < x < 3 for x in body["shape"]))
                self.assertIn("illustrative", body["shapeDataClass"])
            if body["kind"] == "comet":
                self.assertIn("illustrative", body["comet"]["dataClass"])
                self.assertIn("not an observation", body["activityDataClass"])
                self.assertEqual(body["viewDistanceRadii"], 64.)
        np.testing.assert_allclose(np.array(self.bodies["itokawa"]["shape"]) * self.bodies["itokawa"]["radiusKm"] * 2,
                                   [.535, .294, .209], rtol=1e-15)

    def test_haumea_ellipsoid_volume_pole_and_narrow_ring_units(self):
        body = self.bodies["haumea"]
        axes = np.array(body["shape"]) * body["radiusKm"]
        np.testing.assert_allclose(axes, [1161., 852., 513.], rtol=1e-15)
        self.assertAlmostEqual(body["radiusKm"] ** 3, 1161. * 852 * 513, delta=1e-6)
        self.assertIn("volume-equivalent", body["radiusDataClass"])
        self.assertAlmostEqual((math.degrees(math.atan2(body["axis"][1], body["axis"][0])) + 360) % 360, 285.1)
        self.assertAlmostEqual(math.degrees(math.asin(body["axis"][2])), -10.6)
        inner = body["ring"]["innerRadius"] * body["radiusKm"]
        outer = body["ring"]["outerRadius"] * body["radiusKm"]
        self.assertAlmostEqual((inner + outer) / 2, 2287.)
        self.assertAlmostEqual(outer - inner, 70.)
        self.assertGreater(inner, max(axes))
        chart = body["ring"]["texture"]
        raw = (ROOT / chart["url"].lstrip("/")).read_bytes()
        self.assertEqual(len(raw), chart["width"] * 4)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), chart["sha256"])

    def test_cached_rebuild_reproducible_without_any_network(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch("urllib.request.urlopen", side_effect=AssertionError("Offline rebuild requested network")):
            output = Path(folder) / "systems.json"
            compiler.compile_systems(output)
            self.assertEqual(output.read_bytes(), (ROOT / "artifacts/systems.json").read_bytes())
            self.assertEqual(output.with_suffix(".json.gz").read_bytes(), (ROOT / "artifacts/systems.json.gz").read_bytes())

    def test_wrong_horizons_target_frame_epoch_and_duplicate_identifiers_rejected(self):
        raw = (ROOT / "data/sources/horizons-mars-j2000.json").read_bytes()
        for replace_from, replace_to in (("Reference frame : ICRF", "Reference frame : ecliptic"),
                                         ("2451545.000000000", "2451546.000000000"),
                                         ("Mars (499)", "Mars (599)")):
            altered = raw.decode().replace(replace_from, replace_to).encode()
            self.assertNotEqual(altered, raw)
            with self.assertRaises(ValueError):
                compiler.parse_horizons(altered, 499)
        data = copy.deepcopy(self.data)
        data["bodies"][1]["index"] = data["bodies"][0]["index"]
        with self.assertRaises(ValueError):
            compiler.validate(data)


if __name__ == "__main__":
    unittest.main()
