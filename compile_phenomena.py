#!/usr/bin/env python3
"""Bake authored nebula/remnant volumes for a direct-to-character interpreter.

These are illustrative emission fields, not observations or hydrodynamic
simulations. Expensive spatial noise is computed once, outside playback.
"""
from pathlib import Path
import gzip
import hashlib
import json
import struct

import numpy as np
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent
DIM, SEED = 64, 14683
Z, Y, X = np.meshgrid(*[np.linspace(-2, 2, DIM)]*3, indexing="ij")
R = np.sqrt(X*X+Y*Y+Z*Z)
RNG = np.random.default_rng(SEED)


def noise(scales):
    field = np.zeros(X.shape)
    for k, scale in enumerate(scales):
        n = gaussian_filter(RNG.standard_normal(X.shape), scale, mode="wrap")
        field += n/n.std() * .55**k
    return field/field.std()


def rgba(color, density):
    return np.concatenate([np.clip(color,0,255), np.clip(density,0,1)[...,None]*255],axis=-1).astype(np.uint8)


def build():
    coarse, detail = noise((5,2,1)), noise((2.2,.7))
    theta = np.arctan2(Y,X)
    latitude = np.arcsin(np.clip(Z/np.maximum(R,1e-5),-1,1))
    shell_radius = 1.2 + .09*np.sin(theta*7+latitude*3) + .065*coarse
    elliptical = np.sqrt((X/1.08)**2+(Y/1.2)**2+(Z/.87)**2)
    shell = np.exp(-((elliptical-shell_radius)/.1)**2)
    veins = .025+.975*np.exp(-(np.sin(detail*2.1+theta*4)/.24)**2)
    density = shell*veins*np.clip(coarse+.85,.08,1)*1.15
    # A broken inner shock and thin filaments in the ejected envelope.
    density += .24*np.exp(-((elliptical-.82-.06*coarse)/.07)**2)*np.clip(detail+.1,0,1)
    density += .12*np.exp(-((R-1.35)/.27)**2)*np.exp(-(np.sin(theta*13+latitude*11+detail)/.14)**2)
    warm = np.clip(.23+(elliptical-1)*1.7+.22*coarse,0,1)[...,None]
    color = np.array([33,143,255])*(1-warm)+np.array([255,114,35])*warm
    remnant = rgba(color,density)

    field = noise((8,3,1))
    density = np.zeros(X.shape)
    for i in range(5):
        center_y = (i-2)*.29 + .25*np.sin(X*1.7+i*1.6)
        center_z = .25*np.sin(X*2+i*1.8)
        distance = ((Y-center_y)/(.16+i*.022))**2+((Z-center_z)/(.24+i*.023))**2
        density += np.exp(-distance)*(.14+.22*np.clip(field+.8,0,2))
    envelope = np.exp(-((X/1.6)**4+(Y/1.5)**4+(Z/1.1)**4))
    edge=np.prod([np.clip((2-np.abs(c))/.45,0,1)**2 for c in (X,Y,Z)],axis=0)
    density = np.clip((density+.10*np.clip(field+.5,0,1))*envelope*edge,0,1)
    # Sculpt an irregular dark lane through the glowing gas.
    lane = np.exp(-((Y-.18*np.sin(X*2.2)-.06*field)/.105)**2-(Z/.28)**2)
    density *= 1-.88*lane
    warm = np.clip(.5+.28*X+.1*field,0,1)[...,None]
    color = np.array([58,124,250])*(1-warm)+np.array([255,137,69])*warm
    nebula = rgba(color,density)
    fields=[remnant.tobytes(),nebula.tobytes()]
    total=32+sum(map(len,fields))
    blob=struct.pack('<8I',0x48505543,1,DIM,2,32,total,0,0)+b''.join(fields)
    out=ROOT/'artifacts'
    (out/'phenomena.bin').write_bytes(blob)
    (out/'phenomena.bin.gz').write_bytes(gzip.compress(blob,compresslevel=9,mtime=0))
    metadata={'version':1,'seed':SEED,'dimension':DIM,'fieldCount':2,'bytes':len(blob),
        'sha256':hashlib.sha256(blob).hexdigest(),'bounds':[-2,2],
        'fields':[{'name':'supernova-remnant','offset':32},{'name':'stellar-nursery','offset':32+len(fields[0])}],
        'format':'32-byte CUPH header; RGBA8, X fastest then Y then Z; alpha is authored emission density',
        'dataClass':'illustrative appearances of observed phenomena',
        'objects':[
            {'id':'binary','name':'VFTS 352','source':'https://www.eso.org/public/news/eso1540/'},
            {'id':'giant','name':'Betelgeuse','source':'https://science.nasa.gov/universe/what-is-betelgeuse-inside-the-strange-volatile-star/'},
            {'id':'remnant','name':'Crab Nebula','source':'https://science.nasa.gov/missions/hubble/the-crab-nebula/'},
            {'id':'nebula','name':'Orion Nebula','source':'https://science.nasa.gov/asset/hubble/orion-nebula-3/'},
            {'id':'pulsar','name':'Crab Pulsar','source':'https://science.nasa.gov/missions/hubble/the-crab-nebula/'},
            {'id':'quasar','name':'3C 273','source':'https://science.nasa.gov/missions/hubble/nasas-hubble-takes-the-closest-ever-look-at-a-quasar/'}],
        'limitations':'Illustrative fields in model units. Colors, motion and timescales are composed for exploration; not measured objects, an imminent-event prediction, a hydrodynamic simulation or calibrated radiation transport.'}
    (out/'phenomena.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(f'Compiled two {DIM}³ phenomenon fields: {len(blob):,} bytes; gzip {(out/"phenomena.bin.gz").stat().st_size:,}')


if __name__=='__main__':
    build()
