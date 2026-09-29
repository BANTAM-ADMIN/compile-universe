import ctypes as ct, sys
from pathlib import Path
import numpy as np
sys.path.insert(0,'tests')
import test_phenomena_engine as p
p.LIBRARY=Path('native/build/libphenomena_asan.so').resolve()
e=p.NativePhenomena();rng=np.random.default_rng(394)
for i in range(100):
 pos=rng.normal(size=3)*10**rng.uniform(-3,2)
 d=-pos/np.linalg.norm(pos);yaw=np.arctan2(d[0],d[2]);pitch=np.arcsin(d[1]);cols,rows=[(132,51),(280,118),(320,160),(96,65)][i%4]
 for scene in [2,4,3]:
  assert e.lib.phenomena_frame_camera(cols,rows,scene,*pos,yaw,pitch,55.,i/10,1.)==0
 if i%20==0:print(i,flush=True)
print('PASS: 300 Crab/Orion field frames under ASan/UBSan',flush=True)
e.lib.phenomena_shutdown()
