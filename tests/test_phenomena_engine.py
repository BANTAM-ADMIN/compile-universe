"""CPU-only checks for the direct-cell illustrative phenomenon interpreter."""
import ctypes as ct
from pathlib import Path
import unittest
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
LIBRARY=ROOT/'native/build/libuniverse_phenomena.so'


class NativePhenomena:
    def __init__(self):
        self.lib=ct.CDLL(str(LIBRARY))
        self.lib.phenomena_init.argtypes=[ct.c_void_p,ct.c_uint32]
        self.lib.phenomena_frame.argtypes=[ct.c_int]*3+[ct.c_double]*5
        self.lib.phenomena_frame_camera.argtypes=[ct.c_int]*3+[ct.c_double]*8
        self.lib.phenomena_output.restype=ct.POINTER(ct.c_uint8)
        self.lib.phenomena_mask.restype=ct.POINTER(ct.c_uint8)
        self.lib.phenomena_stats.restype=ct.POINTER(ct.c_float)
        self.lib.phenomena_error.restype=ct.c_char_p
        self.lib.phenomena_shutdown()
        data=(ROOT/'artifacts/phenomena.bin').read_bytes()
        self.asset=ct.create_string_buffer(data)
        assert self.lib.phenomena_init(self.asset,len(data))==0,self.lib.phenomena_error()

    def frame(self,scene=0,yaw=.25,pitch=.18,distance=5.,time=0.,cols=128,rows=64):
        assert self.lib.phenomena_frame(cols,rows,scene,yaw,pitch,distance,time,1.)==0,self.lib.phenomena_error()
        return (np.ctypeslib.as_array(self.lib.phenomena_output(),shape=(cols*rows*7,)).copy(),
                np.ctypeslib.as_array(self.lib.phenomena_stats(),shape=(4,)).copy())


@unittest.skipUnless(LIBRARY.exists(),'Build native/build_phenomena.py --native')
class TestPhenomena(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine=NativePhenomena()

    def test_all_six_scenes_have_visible_colored_cells(self):
        for scene in range(6):
            with self.subTest(scene=scene):
                data,stats=self.engine.frame(scene)
                n=128*64
                self.assertGreater(np.count_nonzero(data[:n]!=32),n*.025)
                self.assertGreater(np.max(data[n:n*4]),100)
                self.assertEqual(stats[2],n)
                self.assertEqual(stats[3],scene)
                self.assertTrue(np.all((data[:n]>=32)&(data[:n]<=126)))
                self.assertGreater(stats[0],0)
                self.assertEqual(stats[1]>0,scene in (2,3))

    def test_identical_state_is_byte_reproducible(self):
        for scene in range(6):
            a,_=self.engine.frame(scene,time=2.137)
            b,_=self.engine.frame(scene,time=2.137)
            np.testing.assert_array_equal(a,b)

    def test_free_orbit_reprojects_compiled_volume_in_three_dimensions(self):
        for scene in (2,3):
            a,_=self.engine.frame(scene,yaw=.17,pitch=.1)
            b,_=self.engine.frame(scene,yaw=.73,pitch=.4)
            self.assertGreater(np.mean(a!=b),.10)

    def test_dynamic_surface_and_beam_families_animate(self):
        for scene in (0,1,4,5):
            a,_=self.engine.frame(scene,time=0)
            b,_=self.engine.frame(scene,time=4.7)
            self.assertGreater(np.mean(a!=b),.01)

    def test_static_volume_cache_is_valid_across_time_and_other_scene_renders(self):
        lib=self.engine.lib;cols,rows=81,41;n=cols*rows
        for scene in (2,3):
            for position in ((.2,.1,.3),(0.,.3,5.)):
                expected=None
                for time in (0.,17.3,913.7):
                    self.engine.frame(4,time=time,cols=cols,rows=rows)
                    self.assertEqual(lib.phenomena_frame_camera(cols,rows,scene,*position,.17,-.1,54.,time,1.),0)
                    result=np.concatenate((np.ctypeslib.as_array(lib.phenomena_output(),shape=(n*7,)),
                                           np.ctypeslib.as_array(lib.phenomena_mask(),shape=(n,)))).copy()
                    if expected is None:expected=result
                    else:np.testing.assert_array_equal(result,expected)

    def test_resize_and_camera_inside_volume(self):
        for scene in range(6):
            data,stats=self.engine.frame(scene,distance=.8,cols=320,rows=160)
            self.assertEqual(len(data),320*160*7)
            self.assertTrue(np.isfinite(stats).all())
        self.assertNotEqual(self.engine.lib.phenomena_frame(0,0,0,0.,0.,5.,0.,1.),0)


if __name__=='__main__':
    unittest.main()
