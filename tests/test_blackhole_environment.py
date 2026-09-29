"""Native shared-environment integration, checked against Python optical queries."""
import ctypes as ct
from pathlib import Path
import unittest

import numpy as np

from compileuniverse.blackhole import BlackHoleRenderer
from compileuniverse.render import Camera

ROOT=Path(__file__).resolve().parents[1]
LIBRARY=ROOT/'native/build/libuniverse_text.so'
GALACTIC=np.array([[-.0548755604162154,-.8734370902348850,-.4838350155487132],
 [.4941094278755837,-.4448296299600112,.7469822444972180],
 [-.8676661490190047,-.1980763734312015,.4559837761750669]])


class NativeEnvironment:
    def __init__(self):
        self.lib=ct.CDLL(str(LIBRARY));self.lib.cu_shutdown()
        self.lib.cu_init.argtypes=[ct.c_void_p,ct.c_uint32]
        self.lib.cu_frame.argtypes=[ct.c_int]*2+[ct.c_float]*8+[ct.c_int]*2
        self.lib.cu_set_environment.argtypes=[ct.c_void_p,ct.c_int,ct.c_int,ct.c_void_p]
        self.lib.cu_set_lens_strength.argtypes=[ct.c_float]
        self.lib.cu_set_galaxy.argtypes=[ct.c_void_p,ct.c_int,ct.c_void_p]
        for name in ('cu_output','cu_mask','cu_object_mask'):
            getattr(self.lib,name).restype=ct.POINTER(ct.c_uint8)
        self.lib.cu_stats.restype=ct.POINTER(ct.c_float)
        self.lib.cu_error.restype=ct.c_char_p
        data=(ROOT/'artifacts/universe.bin').read_bytes();self.asset=ct.create_string_buffer(data)
        assert self.lib.cu_init(self.asset,len(data))==0,self.lib.cu_error()

    def environment(self,texture,eye=(0.,0.,0.)):
        if texture is None:
            return self.lib.cu_set_environment(None,0,0,None)
        self.texture=np.ascontiguousarray(texture,dtype=np.uint8)
        self.params=(ct.c_double*16)(*eye)
        return self.lib.cu_set_environment(self.texture.ctypes.data,self.texture.shape[1],self.texture.shape[0],self.params)

    def frame(self,camera=None,cols=81,rows=41,bloom=False):
        camera=camera or Camera(np.array([0.,4.,24.]),np.pi,-np.arctan2(4,24),55)
        code=self.lib.cu_frame(cols,rows,*camera.position,camera.yaw,camera.pitch,camera.fov,.713,1.,int(bloom),0)
        assert code==0,self.lib.cu_error()
        n=cols*rows
        return (np.ctypeslib.as_array(self.lib.cu_output(),shape=(n*7,)).copy(),
                np.ctypeslib.as_array(self.lib.cu_mask(),shape=(n,)).copy(),
                np.ctypeslib.as_array(self.lib.cu_object_mask(),shape=(n,)).copy(),
                np.ctypeslib.as_array(self.lib.cu_stats(),shape=(12,)).copy())

    def galaxy(self,points,eye=(0.,0.,0.)):
        self.points=np.ascontiguousarray(points,dtype=np.float32)
        self.params=(ct.c_double*3)(*eye)
        return self.lib.cu_set_galaxy(self.points.ctypes.data,len(self.points),self.params)


def chart_sample(texture,directions):
    gal=directions@GALACTIC.T
    u=(np.arctan2(gal[:,1],gal[:,0])/(2*np.pi)+.5)%1
    v=.5-np.arcsin(np.clip(gal[:,2],-1,1))/np.pi
    h,w=texture.shape[:2];x=u*w-.5;y=v*(h-1)
    ix=np.floor(x).astype(int);iy=np.floor(y).astype(int);fx=(x-ix)[:,None];fy=(y-iy)[:,None]
    a=texture[iy,ix%w].astype(float)*(1-fx)+texture[iy,(ix+1)%w]*fx
    b=texture[np.minimum(iy+1,h-1),ix%w]*(1-fx)+texture[np.minimum(iy+1,h-1),(ix+1)%w]*fx
    light=(a*(1-fy)+b*fy)*(4/255)
    peak=light.max(axis=1)
    return light*(np.maximum(peak-.16,0)/np.maximum(peak,1e-12)*.8*.75)[:,None]


def foreground(light):
    maximum=light.max(axis=1);brightness=1-np.exp(-maximum)
    scale=(.20+.80*np.maximum(brightness,0)**.33)/np.maximum(maximum,1e-12)
    result=np.clip(np.floor(light*scale[:,None]*255+.5),0,255).astype(np.uint8)
    result[(brightness<.025)|(maximum<.012)]=0
    return result


def finite_point_sample(points,eye,rays,fov=55,rows=41):
    relative=points[:,:3].astype(float)-eye
    distance2=np.sum(relative**2,axis=1)
    directions=relative/np.sqrt(distance2)[:,None]
    flux=np.minimum(points[:,3]/(distance2+.025**2),8)
    radius=.75*2*np.tan(np.deg2rad(fov)/2)/rows
    separation=np.sum((rays[:,None,:]-directions[None,:,:])**2,axis=2)
    weights=np.maximum(1-separation/radius**2,0)**2
    gal=np.asarray(eye)@GALACTIC.T
    q=np.sqrt((gal[0]**2+gal[1]**2)/15000**2+gal[2]**2/4000**2)
    fade=np.clip((q-1.1)/1.4,0,1);gain=1+31*fade**2*(3-2*fade)
    return (weights@(points[:,4:7]*flux[:,None]))*gain


@unittest.skipUnless(LIBRARY.exists(),'Build native/build_wasm.py --native')
class TestBlackHoleEnvironment(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference=BlackHoleRenderer()

    def setUp(self):
        self.engine=NativeEnvironment()

    def test_disk_glow_does_not_brighten_the_whole_background_during_handoff(self):
        self.assertEqual(self.engine.environment(np.full((32,64,3),60,np.uint8),(1e9,2e9,3e9)),0)
        # Looking away excludes the disk: bending a uniform sky must leave its
        # brightness alone, rather than fade in a second halo over every star.
        camera=Camera(np.array([0.,4.,24.]),0.,0.,55)
        self.assertEqual(self.engine.lib.cu_set_lens_strength(0),0)
        straight=self.engine.frame(camera,bloom=True)[0]
        self.assertEqual(self.engine.lib.cu_set_lens_strength(1),0)
        bent=self.engine.frame(camera,bloom=True)[0]
        np.testing.assert_array_equal(straight,bent)

    def test_environment_uses_deflected_world_rays_not_straight_camera_rays(self):
        h,w=256,512
        lon=(np.arange(w)+.5)/w*2*np.pi-np.pi;lat=np.pi/2-(np.arange(h)+.5)/h*np.pi
        ll,bb=np.meshgrid(lon,lat)
        texture=np.stack((55+35*np.cos(3*ll)*np.cos(bb)**2,
                          60+40*np.sin(4*ll+bb),45+35*np.sin(3*bb)),axis=-1).astype(np.uint8)
        # Far from both Gaussian populations, only the directional chart remains
        # with its documented point highpass and far-field gain. No C++ sampler
        # is used as the oracle.
        self.assertEqual(self.engine.environment(texture,(1e9,2e9,3e9)),0)
        camera=Camera(np.array([0.,4.,24.]),np.pi,-np.arctan2(4,24),55)
        result=self.reference.geometry(camera,81,41)[0]
        data,mask,objects,stats=self.engine.frame(camera)
        escaped=~result['captured']&~result['disk_valid'].any(axis=1)
        bent=np.linalg.norm(result['outgoing']-result['rays'],axis=1)>.08
        selected=escaped&bent
        self.assertGreater(np.count_nonzero(selected),200)
        actual=data[81*41:81*41*4].reshape(-1,3)[selected].astype(float)
        expected=foreground(chart_sample(texture,result['outgoing']))[selected].astype(float)
        straight=foreground(chart_sample(texture,result['rays']))[selected].astype(float)
        error=np.abs(actual-expected).mean();unbent_error=np.abs(actual-straight).mean()
        self.assertLess(error,.15)
        self.assertGreater(unbent_error,4)
        self.assertGreater(unbent_error,error*20)
        self.assertTrue((mask==255).all())
        self.assertGreater(np.count_nonzero(objects==0),1000)
        self.assertEqual(stats[8],1)
        self.assertEqual(stats[9]+stats[10],81*41)

    def test_strength_rotates_rays_continuously_and_fades_only_objects(self):
        h,w=256,512
        lon=(np.arange(w)+.5)/w*2*np.pi-np.pi;lat=np.pi/2-(np.arange(h)+.5)/h*np.pi
        ll,bb=np.meshgrid(lon,lat)
        texture=np.stack((65+35*np.cos(3*ll)*np.cos(bb)**2,
                          70+40*np.sin(4*ll+bb),55+35*np.sin(3*bb)),axis=-1).astype(np.uint8)
        self.assertEqual(self.engine.environment(texture,(1e9,2e9,3e9)),0)
        camera=Camera(np.array([0.,4.,24.]),np.pi,-np.arctan2(4,24),55)
        result=self.reference.geometry(camera,81,41)[0]
        straight=result['rays'];outgoing=result['outgoing']
        cosine=np.clip(np.sum(straight*outgoing,axis=1),-1,1)
        angle=np.arccos(cosine)
        tangent=outgoing-straight*cosine[:,None]
        tangent/=np.maximum(np.linalg.norm(tangent,axis=1),1e-30)[:,None]
        selected=~result['captured']&~result['disk_valid'].any(axis=1)&(angle>.08)&(angle<3)
        self.assertGreater(np.count_nonzero(selected),200)
        zero=None
        for strength in [0.,1e-6,.2,.5,.8,1.]:
            self.assertEqual(self.engine.lib.cu_set_lens_strength(strength),0)
            data,mask,objects,stats=self.engine.frame(camera)
            rays=straight*np.cos(angle*strength)[:,None]+tangent*np.sin(angle*strength)[:,None]
            expected=foreground(chart_sample(texture,rays))[selected].astype(float)
            actual=data[81*41:81*41*4].reshape(-1,3)[selected].astype(float)
            self.assertLess(np.abs(actual-expected).mean(),.15)
            self.assertTrue((mask==255).all())
            self.assertAlmostEqual(stats[11],strength,places=6)
            if strength==0:
                zero=data.copy()
                self.assertTrue((objects==0).all())
                self.assertTrue(np.isin(data[:81*41],list(b' .:*+#')).all())
                # Captured rays also become the ordinary straight environment
                # at the outer handoff, rather than popping in as black cells.
                expected=foreground(chart_sample(texture,straight)).astype(float)
                self.assertLess(np.abs(data[81*41:81*41*4].reshape(-1,3)-expected).mean(),.15)
            if strength==1e-6:
                self.assertLess(np.mean(data[:81*41]!=zero[:81*41]),.001)
                self.assertLess(np.abs(data.astype(float)-zero).mean(),.01)
        self.assertNotEqual(self.engine.lib.cu_set_lens_strength(float('nan')),0)
        self.assertNotEqual(self.engine.lib.cu_set_lens_strength(-.1),0)
        self.assertNotEqual(self.engine.lib.cu_set_lens_strength(1.1),0)

    def test_capture_stays_black_and_full_sky_does_not_become_pickable(self):
        texture=np.frombuffer((ROOT/'artifacts/galaxy.bin').read_bytes(),np.uint8).reshape(512,1024,3)
        self.assertEqual(self.engine.environment(texture),0)
        data,mask,objects,stats=self.engine.frame(bloom=True)
        self.assertTrue((mask==255).all())
        self.assertLess(np.count_nonzero(objects),len(objects)*.65)
        geometry=self.reference.geometry(Camera(np.array([0.,4.,24.]),np.pi,-np.arctan2(4,24),55),81,41)[0]
        shadow=geometry['captured']&~geometry['disk_valid'].any(axis=1)
        self.assertGreater(np.count_nonzero(shadow),10)
        self.assertTrue((data[:81*41][shadow]==32).all())
        self.assertTrue((data[81*41:81*41*4].reshape(-1,3)[shadow]==0).all())
        self.assertTrue((data[81*41*4:].reshape(-1,3)[shadow]==0).all())

    def test_finite_three_dimensional_sources_use_deflected_rays(self):
        camera=Camera(np.array([0.,4.,24.]),np.pi,-np.arctan2(4,24),55)
        result=self.reference.geometry(camera,81,41)[0]
        escaped=~result['captured']&~result['disk_valid'].any(axis=1)
        bent=np.linalg.norm(result['outgoing']-result['rays'],axis=1)>.1
        targets=np.flatnonzero(escaped&bent)[::31]
        points=np.zeros((len(targets),8),np.float32)
        distance=np.linspace(100,1000,len(targets))
        points[:,:3]=result['outgoing'][targets]*distance[:,None]
        points[:,3]=.7*distance**2;points[:,4:7]=[.65,.8,1.]
        self.assertEqual(self.engine.galaxy(points),0)
        actual,mask,objects,_=self.engine.frame(camera)
        expected=foreground(finite_point_sample(points,np.zeros(3),result['outgoing']))
        straight=foreground(finite_point_sample(points,np.zeros(3),result['rays']))
        colors=actual[81*41:81*41*4].reshape(-1,3)
        self.assertLess(np.abs(colors[escaped].astype(float)-expected[escaped]).mean(),.2)
        self.assertGreater(np.abs(colors[escaped].astype(float)-straight[escaped]).mean(),2.)
        self.assertTrue((mask==255).all())
        self.assertEqual(self.engine.lib.cu_set_lens_strength(0),0)
        unlensed=self.engine.frame(camera)[0][81*41:81*41*4].reshape(-1,3)
        self.assertLess(np.abs(unlensed.astype(float)-straight).mean(),.2)

    def test_finite_index_has_no_cube_face_seams_or_brightest_rank_culling(self):
        camera=Camera(np.array([0.,4.,24.]),np.pi/4,.45,110)
        rays=self.reference.geometry(camera,81,41)[0]['rays']
        rng=np.random.default_rng(92813)
        targets=rng.choice(len(rays),180,replace=False)
        directions=np.concatenate((rays[targets],np.repeat(rays[[len(rays)//2]],40,axis=0)))
        points=np.zeros((len(directions),8),np.float32)
        points[:,:3]=directions*100
        points[:,3]=.02*100**2;points[:,4:7]=[1.,.7,.4]
        self.assertEqual(self.engine.galaxy(points),0)
        self.assertEqual(self.engine.lib.cu_set_lens_strength(0),0)
        actual=self.engine.frame(camera)[0][81*41:81*41*4].reshape(-1,3)
        expected=foreground(finite_point_sample(points,np.zeros(3),rays,fov=110))
        self.assertLess(np.abs(actual.astype(float)-expected).mean(),.2)
        center=len(rays)//2
        np.testing.assert_allclose(actual[center],expected[center],atol=1)

    def test_unresolved_finite_sources_sum_before_visibility_threshold(self):
        points=np.zeros((200,8),np.float32)
        points[:,:3]=[0,0,100];points[:,3]=5;points[:,4:7]=1
        self.assertEqual(self.engine.galaxy(points),0)
        self.assertEqual(self.engine.lib.cu_set_lens_strength(0),0)
        camera=Camera(np.array([0.,0.,24.]),0,0,55)
        data=self.engine.frame(camera)[0];n=81*41;center=n//2
        self.assertNotEqual(data[center],32)
        expected=foreground(np.full((1,3),200*5/(100**2+.025**2)))[0]
        np.testing.assert_allclose(data[n:4*n].reshape(-1,3)[center],expected,atol=1)

    def test_external_overview_gain_applies_to_accumulated_point_light(self):
        eye=np.array([0.,0.,50000.]);points=np.zeros((1,8),np.float32)
        points[0,:3]=eye+[0,0,100];points[0,3]=20;points[0,4:7]=[1.,.8,.6]
        self.assertEqual(self.engine.galaxy(points,eye),0)
        self.assertEqual(self.engine.lib.cu_set_lens_strength(0),0)
        camera=Camera(np.array([0.,0.,24.]),0,0,55)
        data=self.engine.frame(camera)[0];n=81*41;center=n//2
        expected=foreground(finite_point_sample(points,eye,np.array([[0.,0.,1.]])))[0]
        self.assertNotEqual(data[center],32)
        np.testing.assert_allclose(data[n:4*n].reshape(-1,3)[center],expected,atol=1)

    @unittest.skipUnless((ROOT/'native/build/libuniverse_atlas.so').exists(),'Build native atlas engine')
    def test_zero_strength_matches_atlas_sky_including_bloom(self):
        atlas=ct.CDLL(str(ROOT/'native/build/libuniverse_atlas.so'))
        atlas.atlas_shutdown()
        atlas.atlas_init.argtypes=[ct.c_void_p,ct.c_uint32]
        atlas.atlas_frame.argtypes=[ct.c_int]*2+[ct.c_double]*8+[ct.c_int]
        atlas.atlas_set_environment.argtypes=[ct.c_void_p,ct.c_int,ct.c_int,ct.c_void_p]
        atlas.atlas_output.restype=ct.POINTER(ct.c_uint8)
        data=(ROOT/'artifacts/atlas.bin').read_bytes();asset=ct.create_string_buffer(data)
        self.assertEqual(atlas.atlas_init(asset,len(data)),0)
        texture=np.frombuffer((ROOT/'artifacts/galaxy.bin').read_bytes(),np.uint8).reshape(512,1024,3)
        eye=(1e9,2e9,3e9)
        self.assertEqual(self.engine.environment(texture,eye),0)
        self.assertEqual(atlas.atlas_set_environment(self.engine.texture.ctypes.data,1024,512,self.engine.params),0)
        self.assertEqual(self.engine.lib.cu_set_lens_strength(0),0)
        camera=Camera(np.array([0.,4.,24.]),float(np.float32(np.pi)),float(np.float32(-np.arctan2(4,24))),55)
        # At this remote test position the real catalog contributes no points,
        # isolating both independent engines' shared environment and quantizer.
        self.assertEqual(atlas.atlas_frame(81,41,*eye,camera.yaw,camera.pitch,55,.713,1.,-1),0)
        expected=np.ctypeslib.as_array(atlas.atlas_output(),shape=(81*41*7,)).copy()
        actual,mask,objects,_=self.engine.frame(camera,bloom=True)
        self.assertLess(np.mean(expected[:81*41]!=actual[:81*41]),.001)
        self.assertLess(np.abs(expected.astype(float)-actual).mean(),.02)
        self.assertTrue((mask==255).all());self.assertTrue((objects==0).all())
        points=np.fromfile(ROOT/'artifacts/galaxy-stars.bin',dtype='<f4').reshape(-1,8)
        self.assertEqual(self.engine.galaxy(points),0)
        atlas.atlas_set_galaxy.argtypes=[ct.c_void_p,ct.c_int,ct.c_void_p]
        self.assertEqual(atlas.atlas_set_galaxy(self.engine.points.ctypes.data,len(points),self.engine.params),0)
        self.assertEqual(atlas.atlas_frame(81,41,*eye,camera.yaw,camera.pitch,55,.713,1.,-1),0)
        expected=np.ctypeslib.as_array(atlas.atlas_output(),shape=(81*41*7,)).copy()
        actual,mask,objects,_=self.engine.frame(camera,bloom=True)
        self.assertLess(np.mean(expected[:81*41]!=actual[:81*41]),.001)
        self.assertLess(np.abs(expected.astype(float)-actual).mean(),.02)
        self.assertTrue((mask==255).all());self.assertTrue((objects==0).all())
        atlas.atlas_shutdown()

    def test_eye_updates_invalidate_cache_and_disable_restores_standalone(self):
        baseline=self.engine.frame()[0]
        texture=np.frombuffer((ROOT/'artifacts/galaxy.bin').read_bytes(),np.uint8).reshape(512,1024,3)
        self.assertEqual(self.engine.environment(texture,(0,0,0)),0)
        near,_,_,first=self.engine.frame();self.assertEqual(first[6],0)
        self.assertEqual(self.engine.frame()[3][6],1)
        self.assertEqual(self.engine.environment(texture,(8000,0,0)),0)
        far,_,_,changed=self.engine.frame();self.assertEqual(changed[6],0)
        n=81*41
        visible=(near[:n]!=32)|(far[:n]!=32)
        self.assertGreater(np.count_nonzero(visible),n*.05)
        # Sparse sky should change actual visible features, not a large
        # arbitrary fraction of the empty character buffer.
        self.assertGreater(np.mean(near[n:4*n].reshape(-1,3)[visible]!=far[n:4*n].reshape(-1,3)[visible]),.1)
        self.assertEqual(self.engine.environment(None),0)
        np.testing.assert_array_equal(self.engine.frame()[0],baseline)

    def test_looking_away_still_sees_the_shared_universe(self):
        texture=np.frombuffer((ROOT/'artifacts/galaxy.bin').read_bytes(),np.uint8).reshape(512,1024,3)
        self.engine.lib.cu_set_overlay(1)
        camera=Camera(np.array([0.,4.,24.]),0,0,55)
        previous=self.engine.frame(camera)[0]
        self.assertEqual(self.engine.environment(texture),0)
        data,mask,objects,stats=self.engine.frame(camera)
        self.assertGreater(np.count_nonzero(data[:81*41]!=32),81*41*.05)
        self.assertEqual(np.count_nonzero(objects),0)
        self.assertTrue((mask==255).all())
        self.assertGreater(np.mean(data!=previous),.02)


if __name__=='__main__':
    unittest.main()
