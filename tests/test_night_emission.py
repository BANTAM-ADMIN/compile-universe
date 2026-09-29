"""Observed night-light geography and actual native day/night compositing."""
import ctypes as ct
import hashlib
import json
import unittest
from pathlib import Path
import numpy as np
from test_atlas_renderer import NativeAtlas, catalog

ROOT=Path(__file__).resolve().parents[1]


class NightEmission(unittest.TestCase):
    def test_observed_light_centers_and_dark_oceans(self):
        metadata=json.loads((ROOT/'artifacts/earth-night.json').read_text())['texture']
        raw=(ROOT/'artifacts/earth-night.bin').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),metadata['sha256'])
        self.assertEqual(len(raw),sum(x['width']*x['height'] for x in metadata['levels']))
        atlas=np.frombuffer(raw[:1024*512],np.uint8).reshape(512,1024)
        for lon,lat in [(-74,40.7),(-.1,51.5),(72.88,19.08)]:
            x=int((lon+180)/360*1024);y=int((90-lat)/180*512)
            self.assertGreater(atlas[y-1:y+2,x-1:x+2].mean(),30)
        for lon,lat in [(-140,20),(-30,0)]:
            x=int((lon+180)/360*1024);y=int((90-lat)/180*512)
            self.assertEqual(atlas[y-1:y+2,x-1:x+2].max(),0)

    def test_emission_lights_night_but_does_not_paint_the_day_side(self):
        engine=NativeAtlas(catalog([((10,0,0),100,1e-12)]))
        engine.lib.atlas_set_body_emission.argtypes=[ct.c_int,ct.c_void_p,ct.c_uint32,ct.c_uint32,ct.c_uint32,ct.c_double]
        pixels=ct.create_string_buffer(bytes([128])*43)  # 8x4 + 4x2 + 2x1 + 1x1.
        def frame(host,emission):
            engine.body(-2,host=host,color=(20,20,20))
            if emission:self.assertEqual(engine.lib.atlas_set_body_emission(-2,pixels,8,4,43,6.5),0)
            data,_=engine.frame(position=(3e-7,0,0),yaw=-np.pi/2)
            return data[96*48:4*96*48].reshape(48,96,3)[20:28,43:53].copy()
        day=frame((1,0,0),False);dayLit=frame((1,0,0),True)
        np.testing.assert_array_equal(day,dayLit)
        night=frame((-1,0,0),False);nightLit=frame((-1,0,0),True)
        self.assertGreater(nightLit[:,:,0].mean(),night[:,:,0].mean()+60)
        self.assertGreater(nightLit[:,:,0].mean(),nightLit[:,:,2].mean())
        self.assertNotEqual(engine.lib.atlas_set_body_emission(-2,pixels,8,4,42,6.5),0)
        engine.lib.atlas_shutdown()


if __name__=='__main__':unittest.main()
