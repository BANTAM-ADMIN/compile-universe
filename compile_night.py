#!/usr/bin/env python3
"""Compile NASA's 2016 Black Marble into a filtered night-emission chart."""
import gzip
import hashlib
import io
import json
import numpy as np
from PIL import Image
from compile_solar import ROOT, fetch

URL='https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_01deg_gray.jpg'
PAGE='https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/'


def compile_night(refresh=False):
    raw=fetch(URL,'earth-black-marble-2016-gray.jpg',refresh)
    source=Image.open(io.BytesIO(raw)).convert('L')
    if source.size!=(3600,1800):raise ValueError('Expected NASA global equirectangular map')
    # Suppress JPEG's black-background noise before spatial filtering. This is
    # display imagery, not calibrated radiance. Keep source geography intact.
    values=np.clip((np.asarray(source,dtype=float)-8)/247,0,1)**1.2
    chart=Image.fromarray(np.uint8(np.rint(values*255))).resize((1024,512),Image.Resampling.BOX)
    levels=[];payload=bytearray()
    while True:
        levels.append({'width':chart.width,'height':chart.height,'offset':len(payload)})
        payload.extend(chart.tobytes())
        if chart.size==(1,1):break
        chart=chart.resize((max(1,chart.width//2),max(1,chart.height//2)),Image.Resampling.BOX)
    out=ROOT/'artifacts';out.mkdir(exist_ok=True)
    (out/'earth-night.bin').write_bytes(payload)
    (out/'earth-night.bin.gz').write_bytes(gzip.compress(payload,mtime=0))
    metadata={'texture':{'url':'/artifacts/earth-night.bin','width':1024,'height':512,'channels':1,'levels':levels,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),'format':'R8 mip chain, west -180 to east +180, north to south'},
      'strength':6.5,'source':{'name':'NASA Black Marble 2016, Suomi NPP VIIRS night lights','url':URL,'page':PAGE,'sha256':hashlib.sha256(raw).hexdigest(),'credit':'NASA Earth Observatory / Joshua Stevens; Suomi NPP VIIRS data from Miguel Roman, NASA GSFC'},
      'limitations':'2016 composite, not live city activity. Includes observed non-city light sources. Warm tint and display brightness are illustrative; lights fade into daylight. No current weather or outages are simulated.'}
    (out/'earth-night.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(f'Compiled Black Marble: {len(payload):,} bytes, {len(levels)} filtered levels')
    return metadata


if __name__=='__main__':compile_night()
