"""Real compiled CPU-engine tests: precision, visibility, and hierarchy parity."""
import ctypes as ct
import json
from pathlib import Path
import struct
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "native/build/libuniverse_atlas.so"


def catalog(stars):
    records = b"".join(struct.pack("<3d7f3I", *position, magnitude, radius,
                                   1., .9, .7, 1., 5772., i, 0, 0)
                        for i, (position, magnitude, radius) in enumerate(stars))
    end = 64 + len(records)
    header = struct.pack("<9I", 0x54415543, 1, len(stars), 0, 64, end, end, 0, end)
    return header + bytes(64-len(header)) + records


class NativeAtlas:
    def __init__(self, data):
        self.lib = ct.CDLL(str(LIBRARY))
        self.lib.atlas_init.argtypes = [ct.c_void_p, ct.c_uint32]
        self.lib.atlas_set_earth.argtypes = [ct.c_double]*4 + [ct.c_void_p, ct.c_uint32, ct.c_uint32]
        self.lib.atlas_add_body.argtypes = [ct.c_int, ct.c_void_p, ct.c_void_p, ct.c_uint32,
                                           ct.c_uint32, ct.c_void_p, ct.c_uint32]
        self.lib.atlas_set_body_shape.argtypes = [ct.c_int]+[ct.c_double]*3
        self.lib.atlas_add_belt.argtypes = [ct.c_void_p]
        self.lib.atlas_frame.argtypes = [ct.c_int, ct.c_int] + [ct.c_double]*8 + [ct.c_int]
        self.lib.atlas_output.restype = ct.POINTER(ct.c_uint8)
        self.lib.atlas_stats.restype = ct.POINTER(ct.c_float)
        self.lib.atlas_pick.argtypes = [ct.c_float, ct.c_float]
        self.lib.atlas_error.restype = ct.c_char_p
        self.lib.atlas_shutdown()
        self.asset = ct.create_string_buffer(bytes(data))
        self.retained = []
        assert self.lib.atlas_init(self.asset, len(data)) == 0, self.lib.atlas_error()

    def earth(self, position, radius):
        self.rgb = ct.create_string_buffer(bytes([20, 90, 160]) * 16 * 8)
        assert self.lib.atlas_set_earth(*position, radius, self.rgb, 16, 8) == 0

    def body(self, index, position=(0,0,0), radius=1e-7, host=(0,0,-1),
             ring_alpha=None, axis=(0,0,1), color=(160,110,50),kind=0):
        parameters = (ct.c_double*21)(*position,radius,*host,*axis,0,.012,
                                    1.3 if ring_alpha is not None else 0,
                                    2.4 if ring_alpha is not None else 0,
                                    50 if kind==5 else 0,kind,0,.08,.4,1,0)
        texture = ct.create_string_buffer(bytes(color)*16*8)
        ring = None if ring_alpha is None else ct.create_string_buffer(bytes([180,140,90,ring_alpha])*64)
        self.retained.extend([parameters,texture,ring])
        assert self.lib.atlas_add_body(index,parameters,texture,16,8,ring,64 if ring else 0) == 0, self.lib.atlas_error()

    def frame(self, position=(0,0,0), yaw=0., pitch=0., time=0., cols=96, rows=48):
        code = self.lib.atlas_frame(cols, rows, *position, yaw, pitch, 55., time, 1., -1)
        assert code == 0, self.lib.atlas_error()
        return (np.ctypeslib.as_array(self.lib.atlas_output(), shape=(cols*rows*7,)).copy(),
                np.ctypeslib.as_array(self.lib.atlas_stats(), shape=(24,)).copy())


@unittest.skipUnless(LIBRARY.exists(), "Build native atlas with native/build_atlas.py --native")
class TestAtlasRenderer(unittest.TestCase):
    def test_point_source_between_cell_rays_is_not_missed(self):
        # Even grid: optical axis lies exactly between four character centers.
        engine = NativeAtlas(catalog([((0,0,2), 1., 2e-8)]))
        output, stats = engine.frame()
        self.assertEqual(stats[4], 1)
        self.assertTrue(np.any(output[:96*48] != 32))
        self.assertEqual(engine.lib.atlas_pick(.5, .5), 0)

    def test_actual_earth_sphere_occludes_background_source(self):
        engine = NativeAtlas(catalog([((0,0,2), 1., 2e-8)]))
        _, clear = engine.frame(position=(0,0,-3e-7))
        engine.earth((0,0,0), 1e-7)
        _, blocked = engine.frame(position=(0,0,-3e-7))
        self.assertEqual(clear[4], 1)
        self.assertEqual(blocked[4], 0)
        self.assertGreater(blocked[7], 0)
        self.assertEqual(engine.lib.atlas_pick(.5, .5), -2)
        engine.earth((1e-6,0,0), 1e-7)
        _, moved = engine.frame(position=(0,0,-3e-7))
        self.assertEqual(moved[4], 1)

    def test_tiny_occluders_block_subcell_sources_at_viewport_edges(self):
        # A point on the view boundary projects half a character outside the
        # grid, but still contributes to its edge cell. Clipped occluder bounds
        # must include that footprint as well as sources between cell centers.
        cols, rows = 96, 48
        tany = np.tan(np.deg2rad(55)/2)
        tanx = tany*cols/(rows*1.8)
        cells = [(x, 23.5) for x in (-.5, -.25, .1, 45.2, 94.8, 95.25, 95.5)]
        cells += [(47.5, y) for y in (-.5, -.25, 47.25, 47.5)]
        for x, y in cells:
            with self.subTest(cell=(x, y)):
                star = np.array([-(2*(x+.5)/cols-1)*tanx*2,
                                 (1-2*(y+.5)/rows)*tany*2, 2.])
                engine = NativeAtlas(catalog([(star, -2., 1e-9)]))
                _, clear = engine.frame(cols=cols, rows=rows)
                self.assertEqual(clear[4], 1)
                engine.body(-2, position=star*.5, radius=1e-5)
                _, blocked = engine.frame(cols=cols, rows=rows)
                self.assertEqual(blocked[4], 0)
                engine.lib.atlas_shutdown()

    def test_solar_radius_detail_survives_parsec_scale_translation(self):
        radius = 2.25461e-8
        engine = NativeAtlas(catalog([((0,0,0), 4.83, radius)]))
        original, a = engine.frame(position=(0,0,-radius*3.4))
        offset = np.array([1.23456789, -.92837164, 4.22117539])
        engine = NativeAtlas(catalog([(offset, 4.83, radius)]))
        translated, b = engine.frame(position=offset+[0,0,-radius*3.4])
        self.assertEqual(a[7], b[7])
        self.assertGreater(b[7], 100)
        self.assertLess(np.mean(original != translated), .001)

    def test_identical_camera_and_time_repeat_exactly(self):
        engine = NativeAtlas(catalog([((0,0,0), 4.83, 2.25461e-8), ((.1,.3,2),1.,2e-8)]))
        a, _ = engine.frame(position=(0,0,-8e-8), time=1.337)
        b, _ = engine.frame(position=(0,0,-8e-8), time=1.337)
        np.testing.assert_array_equal(a,b)

    def test_independent_planet_ids_pick_and_host_lighting(self):
        engine = NativeAtlas(catalog([((0,0,2),1.,2e-8)]))
        engine.body(-6,position=(2,0,0),host=(2,0,-1))
        day,a = engine.frame(position=(2,0,-3e-7))
        self.assertEqual(engine.lib.atlas_pick(.5,.5),-6)
        engine.body(-6,position=(2,0,0),host=(2,0,1))
        night,b = engine.frame(position=(2,0,-3e-7))
        self.assertEqual(a[7],b[7])
        self.assertGreater(day[96*48:96*48*4].sum(),night[96*48:96*48*4].sum()*3)
        engine.body(-5,position=(2,0,-1e-7),radius=2e-8,host=(2,0,-1))
        _,c = engine.frame(position=(2,0,-3e-7))
        self.assertEqual(engine.lib.atlas_pick(.5,.5),-5)
        self.assertEqual(c[13],2)

    def test_ring_annulus_has_real_hole_and_preserves_planet_depth(self):
        engine = NativeAtlas(catalog([((0,0,-2),1.,2e-8)]))
        engine.body(-7,ring_alpha=255)
        _,stats = engine.frame(position=(0,0,-5e-7))
        self.assertGreater(stats[12],100)
        self.assertEqual(engine.lib.atlas_pick(.5,.5),-7)
        tanx=np.tan(np.deg2rad(55)/2)*96/(48*1.8)
        def pick_at_radius(r):
            return engine.lib.atlas_pick((r/5/tanx+1)/2,.5)
        self.assertEqual(pick_at_radius(1.15),-1)
        self.assertEqual(pick_at_radius(1.75),-7)
        self.assertEqual(pick_at_radius(2.65),-1)

    def test_ring_opacity_blocks_background_sources_but_not_hole(self):
        # Projected rays cross the z=0 annulus at r=1.7 and r=1.15 radii.
        for x,expected in ((.68,0),(.46,1)):
            engine = NativeAtlas(catalog([((x,0,2),1.,2e-8)]))
            engine.body(-7,ring_alpha=255)
            _,opaque = engine.frame(position=(0,0,-5e-7))
            engine.body(-7,ring_alpha=0)
            _,clear = engine.frame(position=(0,0,-5e-7))
            self.assertEqual(opaque[4],expected)
            self.assertEqual(clear[4],1)
            self.assertEqual(clear[12],0)

    def test_planet_and_ring_repeat_exactly_at_fixed_time(self):
        engine = NativeAtlas(catalog([((0,0,2),1.,2e-8)]))
        engine.body(-7,ring_alpha=130,axis=(.2,.5,1))
        a,_ = engine.frame(position=(0,0,-5e-7),time=2.137)
        b,_ = engine.frame(position=(0,0,-5e-7),time=2.137)
        np.testing.assert_array_equal(a,b)

    def test_ellipsoid_surface_and_occlusion_use_axis_lengths(self):
        radius=1e-7
        # Background ray crosses the projected z=0 plane at x=1.3 radii:
        # outside a sphere, inside an ellipsoid stretched 1.8 along x.
        engine=NativeAtlas(catalog([((.52,0,2),1.,2e-8)]))
        engine.body(-11,radius=radius)
        _,sphere=engine.frame(position=(0,0,-5*radius))
        self.assertEqual(sphere[4],1)
        self.assertEqual(engine.lib.atlas_set_body_shape(-11,1.8,.6,1),0)
        _,stretched=engine.frame(position=(0,0,-5*radius))
        self.assertEqual(stretched[4],0)
        tanx=np.tan(np.deg2rad(55)/2)*96/(48*1.8)
        self.assertEqual(engine.lib.atlas_pick((1.3/5/tanx+1)/2,.5),-11)
        self.assertEqual(engine.lib.atlas_set_body_shape(-11,.6,1.8,1),0)
        _,compressed=engine.frame(position=(0,0,-5*radius))
        self.assertEqual(compressed[4],1)

    def test_generated_registry_replacement_preserves_fixed_bodies(self):
        engine=NativeAtlas(catalog([((0,0,-2),1.,2e-8)]))
        engine.body(-2,position=(0,0,0))
        for i in range(520):
            engine.body(-100000-i,position=(10+i*.1,0,0),radius=1e-9)
        _,registered=engine.frame(position=(0,0,-3e-7))
        self.assertEqual(registered[13],521)
        self.assertEqual(engine.lib.atlas_clear_generated(),0)
        _,cleared=engine.frame(position=(0,0,-3e-7))
        self.assertEqual(cleared[13],1)
        self.assertEqual(engine.lib.atlas_pick(.5,.5),-2)

    def test_sparse_belt_is_local_deterministic_and_body_occluded(self):
        engine=NativeAtlas(catalog([((0,0,-20),1.,2e-8)]))
        parameters=(ct.c_double*16)(0,0,0,0,0,1,1,2,.02,1729,1400,0,.72,.61,.43,1)
        self.assertEqual(engine.lib.atlas_add_belt(parameters),0)
        a,near=engine.frame(position=(0,0,-4))
        b,repeat=engine.frame(position=(0,0,-4))
        np.testing.assert_array_equal(a,b)
        self.assertEqual(near[16],1400)
        self.assertGreater(near[17],100)
        _,far=engine.frame(position=(0,0,-100))
        self.assertEqual(far[17],0)
        engine.body(-3,position=(0,0,-2),radius=1.5)
        _,blocked=engine.frame(position=(0,0,-4))
        self.assertEqual(blocked[17],0)
        self.assertEqual(engine.lib.atlas_clear_belts(),0)
        _,cleared=engine.frame(position=(0,0,-4))
        self.assertEqual(cleared[16],0)

    def test_rare_solar_flare_has_bounded_deterministic_window(self):
        radius=2.25461e-8
        engine=NativeAtlas(catalog([((0,0,0),4.83,radius)]))
        anchor=np.array([.77,.35,.53]);anchor/=np.linalg.norm(anchor)
        options=dict(position=anchor*radius*4,yaw=np.arctan2(-anchor[0],-anchor[2]),pitch=np.arcsin(-anchor[1]))
        _,quiet=engine.frame(time=0,**options)
        active,a=engine.frame(time=23,**options)
        repeat,b=engine.frame(time=23,**options)
        _,over=engine.frame(time=31,**options)
        self.assertEqual(quiet[21],0)
        self.assertEqual(a[21],1)
        self.assertEqual(over[21],0)
        np.testing.assert_array_equal(active,repeat)
        self.assertEqual(a[21],b[21])

    def test_comet_tail_points_away_from_host_and_remains_local(self):
        radius=1e-8
        engine=NativeAtlas(catalog([((0,0,-2),1.,2e-8)]))
        engine.body(-56,radius=radius,host=(-1,0,0),kind=5)
        right,a=engine.frame(position=(0,0,-24*radius))
        self.assertGreater(a[20],0)
        engine.body(-56,radius=radius,host=(1,0,0),kind=5)
        left,b=engine.frame(position=(0,0,-24*radius))
        self.assertGreater(b[20],0)
        right=right[:96*48].reshape(48,96)!=32
        left=left[:96*48].reshape(48,96)!=32
        self.assertGreater(np.count_nonzero(right[:,:33]),np.count_nonzero(right[:,63:])+10)
        self.assertGreater(np.count_nonzero(left[:,63:]),np.count_nonzero(left[:,:33])+10)
        _,distant=engine.frame(position=(0,0,-.1))
        self.assertEqual(distant[20],0)

    def test_resolving_subcell_star_stays_visible(self):
        radius = 2.25461e-8
        engine = NativeAtlas(catalog([((0,0,0), 4.83, radius)]))
        for angular_cells in (.3,.39,.5,.7,1.,1.2):
            angular = angular_cells * 2*np.tan(np.deg2rad(55)/2)/48
            distance = radius/np.sin(angular)
            output, stats = engine.frame(position=(0,0,-distance))
            self.assertEqual(stats[4], 1)
            self.assertTrue(np.any(output[:96*48] != 32))

    def test_compiled_hierarchy_preserves_full_scan_visibility(self):
        asset = ROOT / "artifacts/atlas.bin"
        if not asset.exists():
            self.skipTest("Compiled real catalog is unavailable")
        raw = asset.read_bytes()
        engine = NativeAtlas(raw)
        accelerated, a = engine.frame(position=(.7,-.2,.13), yaw=1.31,pitch=-.29)
        full = bytearray(raw)
        struct.pack_into("<I", full, 12, 0)  # Same records, no hierarchy.
        engine = NativeAtlas(full)
        reference, b = engine.frame(position=(.7,-.2,.13), yaw=1.31,pitch=-.29)
        self.assertEqual(a[4],b[4])
        self.assertEqual(a[10],b[10])
        self.assertLess(a[3],b[3])
        # Different addition order may alter an occasional quantized channel.
        self.assertLess(np.mean(accelerated != reference), .001)


if __name__ == "__main__":
    unittest.main()
