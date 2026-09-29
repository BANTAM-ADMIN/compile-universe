"""Distant destinations belong to the world before their closeup is prepared."""
import ctypes as ct
import unittest
import numpy as np
from test_atlas_renderer import NativeAtlas, catalog


class WorldDestinations(unittest.TestCase):
    def setUp(self):
        self.engine=NativeAtlas(catalog([((10,0,0),100,1e-12)]))
        self.lib=self.engine.lib
        self.lib.atlas_add_destination.argtypes=[ct.c_int,ct.c_int]+[ct.c_double]*7
        self.lib.atlas_set_local_destination.argtypes=[ct.c_int,ct.c_double]
        self.assertEqual(self.lib.atlas_add_destination(-50000,-1,0,0,10,.48,.70,1,.65),0)

    def tearDown(self):
        self.lib.atlas_shutdown()

    def test_distant_point_is_visible_and_pickable_before_selection(self):
        for distance in [1e6,1e3,1,.001]:
            frame,_=self.engine.frame(position=(0,0,10-distance))
            self.assertGreater(np.count_nonzero(frame[:96*48]!=32),0)
            self.assertEqual(self.lib.atlas_pick(.5,.5),-50000)
        self.assertEqual(self.lib.atlas_set_local_destination(-50000,.5),0)
        partial,_=self.engine.frame(position=(0,0,9))
        self.assertGreater(np.count_nonzero(partial[:96*48]!=32),0)
        self.assertEqual(self.lib.atlas_set_local_destination(-50000,1),0)
        resolved,_=self.engine.frame(position=(0,0,9))
        self.assertEqual(np.count_nonzero(resolved[:96*48]!=32),0)

    def test_point_is_occluded_by_a_foreground_world(self):
        self.engine.body(-2,position=(0,0,1),radius=.5)
        self.engine.frame()
        self.assertEqual(self.lib.atlas_pick(.5,.5),-2)
        self.assertNotEqual(self.lib.atlas_add_destination(-50009,-1,float('nan'),0,0,1,1,1,.5),0)

    def test_linked_catalog_star_is_not_duplicated(self):
        self.assertEqual(self.lib.atlas_add_destination(-50000,0,0,0,10,.48,.70,1,.65),0)
        frame,_=self.engine.frame()
        self.assertEqual(np.count_nonzero(frame[:96*48]!=32),0)
