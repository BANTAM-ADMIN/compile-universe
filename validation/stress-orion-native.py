import ctypes as ct, json, sys, struct
from pathlib import Path
import numpy as np
sys.path.insert(0,'tests')
import test_atlas_renderer as atlas
atlas.LIBRARY=Path('native/build/libatlas_asan.so').resolve()
e=atlas.NativeAtlas(Path('artifacts/gaia-atlas.bin').read_bytes())
e.lib.atlas_set_survey.argtypes=[ct.c_void_p,ct.c_uint32,ct.c_int,ct.c_float]
e.lib.atlas_set_galaxy.argtypes=[ct.c_void_p,ct.c_int,ct.c_void_p]
retained=[]
def asset(path):
 b=ct.create_string_buffer(Path(path.removeprefix('/')).read_bytes());retained.append(b);return b
summaries=asset('artifacts/gaia-light.bin')
meta=json.loads(Path('artifacts/gaia.json').read_text())
assert e.lib.atlas_set_survey(summaries,meta['nodeCount'],1,1)==0
points=asset('artifacts/galaxy-stars.bin');galaxy=json.loads(Path('artifacts/galaxy-stars.json').read_text())
destinations=json.loads(Path('artifacts/phenomena-destinations.json').read_text())['destinations']
orion=next(d for d in destinations if d['id']=='orion-nebula');crab=next(d for d in destinations if d['id']=='crab-pulsar')
for body in json.loads(Path('artifacts/systems.json').read_text())['bodies']:
 a=body.get('atmosphere',{});ring=body.get('ring') or {};tex=body['texture']
 p=(ct.c_double*21)(*body['position'],body.get('radiusPc',body.get('radius_pc')),*body.get('hostPosition',[0,0,0]),*body.get('axis',[0,0,1]),body.get('primeMeridian',0),body.get('rotationRate',.012),ring.get('innerRadius',0),ring.get('outerRadius',0),body.get('comet',{}).get('tailLengthRadii',0),{'rocky':0,'gas':1,'ice':2,'lava':3,'water':4,'comet':5}.get(body.get('appearanceKind'),0),a.get('strength',0),*a.get('color',[.08,.4,1]),body.get('parentStarIndex',body.get('hostStarIndex',0)))
 assert e.lib.atlas_add_body(body['index'],p,asset(tex['url']),tex['width'],tex['height'],asset(ring['texture']['url']) if ring.get('texture') else None,ring.get('texture',{}).get('width',0))==0
rng=np.random.default_rng(8271)
for i in range(100):
 if i<32:
  u=i/31;pos=np.array(crab['position'])*(1-u)+np.array(orion['position'])*u
  pos+=np.array([.1,1,6])*orion['radiusPc']
 else:
  pos=np.array(orion['position'])+rng.normal(size=3)*orion['radiusPc']*10**rng.uniform(-2,2)
 direction=np.array(orion['position'])-pos;direction/=np.linalg.norm(direction)
 yaw=np.arctan2(direction[0],direction[2]);pitch=np.arcsin(direction[1]);params=(ct.c_double*3)(*(pos-np.array(galaxy['centerPc'])))
 assert e.lib.atlas_set_galaxy(points,galaxy['count'],params)==0
 cols,rows=[(132,51),(280,118),(320,160),(96,65)][i%4]
 state={'i':i,'position':pos.tolist(),'yaw':yaw,'pitch':pitch,'cols':cols,'rows':rows}
 Path('validation/native-crash-state.json').write_text(json.dumps(state))
 e.frame(position=pos,yaw=yaw,pitch=pitch,cols=cols,rows=rows,time=i/10)
 if i%50==0:print(i,flush=True)
print('PASS: 100 Orion camera/grid transitions under ASan/UBSan',flush=True)
e.lib.atlas_shutdown()
