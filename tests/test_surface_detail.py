"""Terrain relief must retain printable ASCII and stable frozen-camera output."""
import ctypes as ct
import hashlib
import json
import unittest
from pathlib import Path
import numpy as np
from test_atlas_renderer import NativeAtlas, catalog
ROOT=Path(__file__).resolve().parents[1]

class SurfaceDetail(unittest.TestCase):
    def test_moon_chart_and_fixed_near_side(self):
        bodies=json.loads((ROOT/'artifacts/systems.json').read_text())['bodies']
        moon=next(b for b in bodies if b['id']=='moon'); earth=next(b for b in bodies if b['id']=='earth')
        self.assertEqual(moon['rotationRate'],0)
        self.assertGreaterEqual(moon['texture']['width'],2048)
        t=moon['relief']['texture']; data=(ROOT/t['url'].lstrip('/')).read_bytes()
        self.assertEqual(len(data),t['width']*t['height']*3)
        self.assertEqual(hashlib.sha256(data).hexdigest(),t['sha256'])
        axis=np.array(moon['axis']); toward=np.array(earth['position'])-np.array(moon['position']);toward/=np.linalg.norm(toward)
        reference=np.array([1.,0,0]) if abs(axis[0])<.9 else np.array([0.,1,0])
        ex=reference-axis*np.dot(reference,axis);ex/=np.linalg.norm(ex);ey=np.cross(axis,ex)
        longitude=np.arctan2(np.dot(toward,ey),np.dot(toward,ex))+moon['primeMeridian']
        self.assertAlmostEqual(longitude,0,places=10)
        self.assertAlmostEqual(np.dot(toward,axis),0,places=10)

    def test_relief_ascii_stability_and_validation(self):
        atlas=NativeAtlas(catalog([((0,0,-1),5.,1e-7)]));atlas.body(-10,radius=1,host=(1,0,-3),color=(150,150,150))
        lib=atlas.lib;lib.atlas_set_body_relief.argtypes=[ct.c_int,ct.c_void_p,ct.c_uint32,ct.c_uint32,ct.c_double]
        plain,_=atlas.frame(position=(0,0,-4))
        chart=np.empty((32,64,3),np.uint8);chart[:]=[128,128,255];chart[:,16:32]=[75,158,240]
        raw=ct.create_string_buffer(chart.tobytes());atlas.retained.append(raw)
        self.assertNotEqual(lib.atlas_set_body_relief(-10,raw,0,32,1),0)
        self.assertNotEqual(lib.atlas_set_body_relief(-999,raw,64,32,1),0)
        self.assertEqual(lib.atlas_set_body_relief(-10,raw,64,32,1),0)
        detailed,_=atlas.frame(position=(0,0,-4));repeated,_=atlas.frame(position=(0,0,-4))
        self.assertTrue(np.array_equal(detailed,repeated))
        self.assertFalse(np.array_equal(plain,detailed))
        self.assertTrue(np.all((detailed[:96*48]>=32)&(detailed[:96*48]<=126)))
        # Only letter/punctuation foregrounds express the relief, never filled blocks.
        self.assertLessEqual(int(detailed[96*48*4:].max()),38)

if __name__=='__main__':unittest.main()
