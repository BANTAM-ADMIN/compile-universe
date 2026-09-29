import ctypes as ct, json, sys, struct
from pathlib import Path
import numpy as np
sys.path.insert(0,'tests')
import test_atlas_renderer as atlas
import os
atlas.LIBRARY=Path(os.environ['ATLAS_NATIVE_LIBRARY']).resolve()
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
s=json.loads(Path('tests/orion-departure-state.json').read_text());pos=np.array(s['position']);params=(ct.c_double*3)(*(pos-np.array(galaxy['centerPc'])))
assert e.lib.atlas_set_galaxy(points,galaxy['count'],params)==0
print('Replay failing frame',flush=True)
assert e.lib.atlas_frame(s['cols'],s['rows'],*pos,s['yaw'],s['pitch'],s['fov'],s['time'],1.,s['selectedIndex'])==0
print('PASS', np.ctypeslib.as_array(e.lib.atlas_stats(),shape=(32,)).tolist(),flush=True)

import hashlib
raw=ct.string_at(e.lib.atlas_output(),s["cols"]*s["rows"]*7)
print("SHA256",hashlib.sha256(raw).hexdigest())
