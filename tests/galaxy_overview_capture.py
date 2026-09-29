"""Capture the production finite Milky Way along interior/exterior cameras."""
import ctypes as ct
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from test_galaxy_parallax import NativeGalaxy, ANCHOR, COLS, ROWS, ROOT

GZ = np.array([-.8676661490190047, -.1980763734312015, .4559837761750669])
GX = np.array([-.0548755604162154, -.8734370902348850, -.4838350155487132])


def image(frame):
    n = COLS * ROWS
    foreground = frame[n:4*n].reshape(ROWS, COLS, 3)
    background = frame[4*n:].reshape(ROWS, COLS, 3)
    canvas = Image.fromarray(background).resize((COLS * 6, ROWS * 11), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf', 10)
    for y in range(ROWS):
        for x in range(COLS):
            char = int(frame[y * COLS + x])
            if char != 32:
                draw.text((x*6,y*11-2),chr(char),font=font,fill=tuple(foreground[y,x]))
    return canvas


def cameras():
    solar = json.loads((ROOT / 'artifacts/solar.json').read_text())
    earth = solar['earth']
    position = np.asarray(earth['position'])
    toward = -position / np.linalg.norm(position)
    home = np.array([toward[0]*.95-toward[1]*.31,toward[0]*.31+toward[1]*.95,toward[2]+.10])
    home /= np.linalg.norm(home)
    for distance in (1e-6, .01, 10, 1000, 10000, 30000, 60000):
        yield f'earth-pullback-{distance:g}pc', position + home * distance - ANCHOR, position - ANCHOR
    for distance in (20000, 40000, 80000):
        yield f'galaxy-pole-{distance:g}pc', GZ*distance, np.zeros(3)
    yield 'galaxy-edge-40000pc', GX*40000+GZ*4000, np.zeros(3)


def capture():
    engine = NativeGalaxy()
    engine.sources(np.fromfile(ROOT / 'artifacts/galaxy-stars.bin',dtype='<f4').reshape(-1,8))
    engine.lib.atlas_stats.restype = ct.POINTER(ct.c_float)
    report = []
    previews = []
    for name, eye, target in cameras():
        direction = target-eye
        direction /= np.linalg.norm(direction)
        began = time.perf_counter()
        frame = engine.frame(eye, yaw=float(np.arctan2(direction[0],direction[2])),pitch=float(np.arcsin(direction[1])))
        elapsed = (time.perf_counter()-began)*1000
        n = COLS*ROWS
        foreground = frame[n:4*n].reshape(n,3)
        light = foreground.max(axis=1).astype(float)
        light[frame[:n]==32]=0
        xy = np.argwhere(light.reshape(ROWS,COLS)>0)
        report.append({'name':name,'glyphs':int(np.count_nonzero(light)), 'meanSignal':float(light.mean()),
                       'sampleMs':float(engine.lib.atlas_stats()[24]),'totalMs':elapsed,
                       'bounds': np.ptp(xy,axis=0).tolist() if len(xy) else [0,0]})
        shot=image(frame)
        shot.save(ROOT / f'artifacts/{name}.png')
        thumb=shot.resize((660,517))
        labeled=Image.new('RGB',(660,542));labeled.paste(thumb,(0,25))
        ImageDraw.Draw(labeled).text((8,6),f'{name} | {report[-1]["glyphs"]} lit cells',fill='white')
        previews.append(labeled)
    montage=Image.new('RGB',(660*3,542*((len(previews)+2)//3)))
    for i,preview in enumerate(previews):montage.paste(preview,((i%3)*660,(i//3)*542))
    montage.save(ROOT / 'artifacts/galaxy-zoom-overview.png')
    (ROOT / 'artifacts/galaxy-zoom-overview.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    capture()
