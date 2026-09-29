"""Observed catalog integrity, camera handedness and tiny-disk regressions."""
import ctypes as ct
import hashlib
import json
import struct
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from compile_catalog import STAR_DTYPE, NODE_DTYPE
from compile_gaia import AUX_DTYPE, CLOUD_DISPLAY_GAIN, make_stars, directions
from compileuniverse.render import Camera
from test_atlas_renderer import NativeAtlas, catalog
from test_blackhole_environment import NativeEnvironment
ROOT=Path(__file__).resolve().parents[1]

class SurveyIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta=json.loads((ROOT/'artifacts/gaia.json').read_text())
        with (ROOT/'artifacts/gaia-atlas.bin').open('rb') as f:cls.h=struct.unpack('<9I',f.read(36))
        cls.stars=np.memmap(ROOT/'artifacts/gaia-atlas.bin',dtype=STAR_DTYPE,mode='r',offset=cls.h[4],shape=(cls.h[2],))
        cls.nodes=np.memmap(ROOT/'artifacts/gaia-atlas.bin',dtype=NODE_DTYPE,mode='r',offset=cls.h[5],shape=(cls.h[3],))
        cls.aux=np.memmap(ROOT/'artifacts/gaia-light.bin',dtype=AUX_DTYPE,mode='r')
        cls.obs=np.memmap(ROOT/'artifacts/gaia-observations.bin',dtype='<f4',mode='r').reshape(-1,4)
    def test_counts_are_independently_verified_and_identifiers_survive(self):
        self.assertEqual(self.meta['totalCount'],len(self.stars))
        for item in self.meta['inputs']:
            self.assertEqual(item['download']['verifiedCount'],self.meta['counts']['500pc' if '500pc' in item['path'] else 'lmc']['downloaded'])
        gaia=self.stars[self.meta['baseCount']:]
        ids=(gaia['reserved'].astype(np.uint64)<<np.uint64(32))|gaia['id'].astype(np.uint64)
        self.assertGreater(np.mean(ids>2**53),.99);self.assertEqual(len(ids),len(np.unique(ids)))
        self.assertTrue(np.isfinite(gaia['position']).all())
        self.assertEqual(np.count_nonzero(gaia['flags']&64),109008)
    def test_inverse_parallax_and_g_photometry_match_observations(self):
        gaia=self.stars[self.meta['baseCount']:];d=np.linalg.norm(gaia['position'],axis=1);near=(gaia['flags']&64)==0
        np.testing.assert_allclose(d[near],1000/self.obs[near,0],rtol=2e-7)
        self.assertTrue((d[near]<500).all());self.assertTrue((self.obs[near,0]/self.obs[near,1]>10).all())
        np.testing.assert_allclose(gaia['absmag']+5*np.log10(d)-5,self.obs[:,2],atol=2e-6)
    def test_hierarchy_conserves_summed_light(self):
        stars=self.stars[self.meta['baseCount']:]
        light=10**(-.4*stars['absmag'].astype(float))
        light*=np.where(stars['flags']&64,CLOUD_DISPLAY_GAIN,1.)
        self.assertAlmostEqual(self.aux[0]['light']/light.sum(),1,places=12)
        self.assertEqual(self.aux[0]['gaia_count'],len(stars))
        parents=self.nodes['count']==0
        np.testing.assert_allclose(self.aux['light'][parents],self.aux['light'][self.nodes['left'][parents]]+self.aux['light'][self.nodes['right'][parents]],rtol=1e-14)
    def test_source_id_depth_is_repeatable_and_not_claimed_measured(self):
        ids=np.array([4657893922535335424,4657893922535335552],dtype=np.uint64)
        rows=np.array([[80.89,-69.75,.02,.03,1.8,.2,14.,.5,1.1],[81.,-70.,.04,.04,1.6,.1,15.,1.,1.2]])
        a,_,_=make_stars(ids,rows,True);b,_,_=make_stars(ids[::-1],rows[::-1],True)
        np.testing.assert_array_equal(a,b[::-1]);self.assertTrue((a['flags']&64).all())
        self.assertIn('not measured',self.meta['lmcDistance'])
    def test_lmc_near_side_and_vfts_host_surroundings(self):
        # Equal source seeds isolate the geometric inclination from thickness.
        ids=np.array([123,123],dtype=np.uint64)
        rows=np.array([[84.,-68.5,.02,.03,1.8,.2,14.,.5,1.1],[77.,-71.,.02,.03,1.8,.2,14.,.5,1.1]])
        stars,_,_=make_stars(ids,rows,True)
        self.assertLess(np.linalg.norm(stars['position'][0]),np.linalg.norm(stars['position'][1]))
        vfts=directions(np.array([84.618567]),np.array([-69.188647]))[0]*49056.223
        cloud=self.stars['position'][(self.stars['flags']&64)!=0]
        distances=np.linalg.norm(cloud-vfts,axis=1)
        self.assertLess(distances.min(),100)
        self.assertGreater(np.count_nonzero(distances<500),100)

class Geography(unittest.TestCase):
    def test_camera_basis_is_not_mirrored(self):
        right,up,forward=Camera(np.zeros(3),0.,0.,50).basis()
        np.testing.assert_allclose(np.cross(right,up),-forward)
    def test_nasa_map_has_land_and_water_at_known_coordinates(self):
        metadata=json.loads((ROOT/'artifacts/solar.json').read_text())['earth']['texture']
        raw=(ROOT/'artifacts/earth.bin').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),metadata['sha256'])
        image=np.frombuffer(raw,np.uint8).reshape(metadata['height'],metadata['width'],3)
        for lon,lat,land in [(15,23,True),(-60,-5,True),(135,-25,True),(80,25,True),(-130,0,False),(-30,0,False),(70,-25,False)]:
            r,g,b=map(int,image[int((90-lat)/180*len(image)),int((lon+180)/360*image.shape[1])])
            self.assertEqual(max(r,g)>b,land,(lon,lat,(r,g,b)))
    def test_east_is_right_when_looking_at_earth_with_north_up(self):
        engine=NativeAtlas(catalog([((10,0,0),100.,1e-12)]))
        # A longitude-coded globe, lit from the observer side. Red east,
        # green west, blue reference; read the actual native character colors.
        chart=np.zeros((32,64,3),np.uint8);chart[:,:,:]=[15,180,20];chart[:,32:]=[180,15,20]
        texture=ct.create_string_buffer(chart.tobytes());r=1e-7
        p=(ct.c_double*21)(0,0,0,r,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0)
        self.assertEqual(engine.lib.atlas_add_body(-2,p,texture,64,32,None,0),0)
        engine.lib.atlas_set_camera_roll.argtypes=[ct.c_double]
        self.assertEqual(engine.lib.atlas_set_camera_roll(np.pi/2),0)
        data,_=engine.frame(position=(3*r,0,0),yaw=-np.pi/2,cols=160,rows=80)
        colors=data[12800:51200].reshape(80,160,3).astype(float)
        east=colors[35:45,90:102].mean(axis=(0,1));west=colors[35:45,58:70].mean(axis=(0,1))
        self.assertGreater(east[0],east[1]*2);self.assertGreater(west[1],west[0]*2)
        engine.lib.atlas_shutdown()

class DistantDisk(unittest.TestCase):
    def test_disk_is_visible_thousands_of_radii_before_old_cutoff(self):
        e=NativeEnvironment();e.lib.cu_set_overlay(1)
        sizes=[]
        for distance in [4096,2048,1024,512,150]:
            c=Camera(np.array([0.,distance*.2,distance])/np.sqrt(1.04),np.pi,-np.arctan(.2),50)
            output,_,_,_=e.frame(c,cols=160,rows=80,bloom=True)
            sizes.append(np.count_nonzero(output[:12800]!=32))
        self.assertGreater(sizes[0],0);self.assertLess(sizes[0],10)
        self.assertGreater(sizes[-1],sizes[0]*15)
        self.assertTrue(all(a<=b for a,b in zip(sizes,sizes[1:])),sizes)
    def test_tiny_disk_survives_sub_character_camera_motion(self):
        e=NativeEnvironment();e.lib.cu_set_overlay(1);counts=[]
        for yaw in np.linspace(np.pi-.003,np.pi+.003,17):
            c=Camera(np.array([0.,4096*.2,4096])/np.sqrt(1.04),yaw,-np.arctan(.2),50)
            output,_,_,_=e.frame(c,cols=160,rows=80,bloom=True)
            counts.append(np.count_nonzero(output[:12800]!=32))
        self.assertGreater(min(counts),0,counts)

if __name__=='__main__':unittest.main()
