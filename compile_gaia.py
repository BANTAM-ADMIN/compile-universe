#!/usr/bin/env python3
"""Compile cached Gaia DR3 observations and flux-conserving spatial summaries.

Nearby distances use high-S/N inverse parallax. LMC candidate sky positions are
observed; their individual depths are explicitly a seeded disk reconstruction.
No runtime queries or telescope images are needed by the player.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import struct
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from compile_catalog import STAR_DTYPE, NODE_DTYPE, MAGIC, SOLAR_RADIUS_PC, build_bvh

ROOT = Path(__file__).resolve().parent
CLOUD_DISPLAY_GAIN = 4.0  # Artistic exposure, also used for resolved points in atlas_engine.cpp.
FIELDS = 'source_id,ra,dec,parallax,parallax_error,pmra,pmdec,phot_g_mean_mag,bp_rp,ruwe'
NEAR_WHERE = 'parallax>2 AND parallax_over_error>10 AND phot_g_mean_mag<12 AND ruwe<1.4 AND bp_rp IS NOT NULL'
LMC_WHERE = "1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',80.8939,-69.7561,6)) AND phot_g_mean_mag<16 AND parallax<0.2 AND pmra BETWEEN 0.5 AND 3.5 AND pmdec BETWEEN -0.8 AND 2 AND ruwe<1.4 AND bp_rp IS NOT NULL"
AUX_DTYPE = np.dtype({'names':['center','light','rgb','gaia_count','hyg_count','pad'],
    'formats':[('<f8',3),'<f8',('<f4',3),'<u4','<u4',('<u4',3)],
    'offsets':[0,24,32,44,48,52],'itemsize':64})


def save(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix+'.part')
    temporary.write_bytes(data)
    temporary.replace(path)
    if path.parent.name == 'artifacts':
        path.with_suffix(path.suffix+'.gz').write_bytes(gzip.compress(data, mtime=0))


def download(kind):
    path = ROOT / f'data/gaia-dr3-{kind}.csv.gz'
    if path.exists(): return path
    from fetch_gaia_async import run
    run(kind)
    return path


def read_rows(path):
    with gzip.open(path, 'rt') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != FIELDS.split(','): raise ValueError(f'Unexpected schema: {reader.fieldnames}')
        ids, rows = [], []
        for row in reader:
            ids.append(int(row['source_id']))
            rows.append([float(row[k]) if row[k] else np.nan for k in reader.fieldnames[1:]])
    if len(rows) >= 1000000: raise ValueError('Possible TAP row-limit truncation')
    return np.asarray(ids, dtype='<u8'), np.asarray(rows, dtype=np.float64)


def directions(ra, dec):
    ra, dec = np.deg2rad(ra), np.deg2rad(dec)
    return np.column_stack((np.cos(dec)*np.cos(ra),np.cos(dec)*np.sin(ra),np.sin(dec)))


def make_stars(ids, rows, lmc=False):
    valid = np.isfinite(rows).all(axis=1)
    ids, rows = ids[valid], rows[valid]
    ra, dec, parallax, error, pmra, pmdec, mag, color, ruwe = rows.T
    if not lmc:
        if not ((parallax>2)&(parallax/error>10)&(mag<12)&(ruwe<1.4)).all(): raise ValueError('Nearby selection contract')
        distance = 1000/parallax
    else:
        if not ((mag<16)&(parallax<.2)&(ruwe<1.4)).all(): raise ValueError('LMC candidate selection contract')
        # van der Marel & Cioni (2001) viewing angles; this is a model, not an
        # individual distance measurement. The sign convention is documented.
        a, d = np.deg2rad([80.8939,-69.7561])
        center = directions(np.array([80.8939]),np.array([-69.7561]))[0]
        east = np.array([-np.sin(a),np.cos(a),0])
        north = np.array([-np.sin(d)*np.cos(a),-np.sin(d)*np.sin(a),np.cos(d)])
        theta, inclination = np.deg2rad([122.5,34.7])
        line = north*np.cos(theta)+east*np.sin(theta)
        # Position angle is east of north; the northeast side is nearer.
        normal = center*np.cos(inclination)+np.cross(center,line)*np.sin(inclination)
        # Stable per-source depth, independent of CSV row order. It expresses
        # unresolved disk thickness; IDs/angles/photometry remain observed.
        mixed = ids ^ (ids >> np.uint64(29))
        u = (mixed & np.uint64(0xffffff)).astype(float)/0xffffff
        depth = (u-.5)*600
        distance = (49590*np.dot(center,normal)+depth)/(directions(ra,dec)@normal)
    # Gaia DR3 astrometry is J2016.0. Propagate angular proper motion to the
    # existing J2000 scene, holding radial distance fixed (no RV propagation).
    a, d = np.deg2rad(ra), np.deg2rad(dec)
    unit = directions(ra,dec)
    east = np.column_stack((-np.sin(a),np.cos(a),np.zeros(len(a))))
    north = np.column_stack((-np.sin(d)*np.cos(a),-np.sin(d)*np.sin(a),np.cos(d)))
    unit += -16*np.pi/(180*3600000)*(east*pmra[:,None]+north*pmdec[:,None])
    unit /= np.linalg.norm(unit,axis=1)[:,None]
    stars = np.zeros(len(ids),dtype=STAR_DTYPE)
    stars['position'] = unit*distance[:,None]
    stars['absmag'] = mag-5*np.log10(distance)+5
    # G-band light is not bolometric luminosity. Appearance and physical-size
    # estimates are intentionally illustrative, separate from measured fields.
    luminosity = 10**(-.4*(stars['absmag'].astype(float)-4.67))
    bv = np.clip(color*.70,-.35,2.4)
    temperature = 4600*(1/(.92*bv+1.7)+1/(.92*bv+.62))
    stars['temperature'] = temperature
    stars['luminosity'] = luminosity
    stars['radius_pc'] = np.clip(np.sqrt(luminosity)*(5772/temperature)**2,.05,1500)*SOLAR_RADIUS_PC
    palette = np.array([[.48,.65,1],[.70,.81,1],[.92,.94,1],[1,.89,.66],[1,.66,.37],[1,.40,.19]])
    stars['rgb'] = np.stack([np.interp(color,[-.5,0,.6,1.2,2,3.5],palette[:,k]) for k in range(3)],axis=1)
    stars['id'] = (ids & np.uint64(0xffffffff)).astype('<u4')
    stars['reserved'] = (ids >> np.uint64(32)).astype('<u4')
    stars['flags'] = 32 | 2 | 8 | (64 if lmc else 0)
    observations = np.column_stack((parallax,error,mag,color)).astype('<f4')
    return stars, observations, ids


def summaries(stars,nodes,indices):
    result = np.zeros(len(nodes),dtype=AUX_DTYPE)
    for i in range(len(nodes)-1,-1,-1):
        node = nodes[i]
        if node['count']:
            members = stars[indices[int(node['start']):int(node['start']+node['count'])]]
            mask = (members['flags']&32)!=0
            result['gaia_count'][i] = mask.sum(); result['hyg_count'][i] = (~mask).sum()
            subset = members[mask]
            if not len(subset): continue
            light = 10**(-.4*subset['absmag'].astype(float))
            light *= np.where(subset['flags'] & 64, CLOUD_DISPLAY_GAIN, 1.)
            total = light.sum()
            result['center'][i] = (subset['position']*light[:,None]).sum(axis=0)/total
            result['rgb'][i] = (subset['rgb']*light[:,None]).sum(axis=0)/total
        else:
            children = result[[node['left'],node['right']]]
            light = children['light']; total = light.sum()
            result['gaia_count'][i] = children['gaia_count'].sum()
            result['hyg_count'][i] = children['hyg_count'].sum()
            if total<=0: continue
            result['center'][i] = (children['center']*light[:,None]).sum(axis=0)/total
            result['rgb'][i] = (children['rgb']*light[:,None]).sum(axis=0)/total
        result['light'][i] = total
    return result


def compile_all():
    original = (ROOT/'artifacts/atlas.bin').read_bytes()
    header = struct.unpack_from('<9I',original)
    base = np.frombuffer(original,dtype=STAR_DTYPE,count=header[2],offset=header[4]).copy()
    inputs=[]; arrays=[base]; observations=[]; counts={}
    base_distance=np.linalg.norm(base['position'][1:],axis=1)
    tree=cKDTree(base['position'][1:]/base_distance[:,None])
    for kind in ['500pc','lmc']:
        path=ROOT/f'data/gaia-dr3-{kind}.csv.gz'
        ids,rows=read_rows(path); rawcount=len(ids)
        if len(np.unique(ids))!=len(ids):raise ValueError('Duplicate Gaia source IDs')
        query=json.loads(path.with_suffix('.query.json').read_text())
        expected=f'SELECT {FIELDS} FROM gaiadr3.gaia_source WHERE '+(NEAR_WHERE if kind=='500pc' else LMC_WHERE)
        if query.get('verifiedCount')!=rawcount:raise ValueError('Input row count was not verified against TAP COUNT(*)')
        if query['query']!=expected:raise ValueError('Cached query does not match compiler selection')
        if kind=='500pc' and (np.histogram(rows[:,0],bins=np.arange(0,361,30))[0].min()<1000 or rows[:,1].min()>-80 or rows[:,1].max()<80):raise ValueError('Incomplete all-sky coverage')
        stars,obs,ids=make_stars(ids,rows,kind=='lmc')
        # Conservative positional match to avoid two lights for retained HYG
        # stars. This is a display cross-match, not an official Gaia identifier.
        distance=np.linalg.norm(stars['position'],axis=1)
        separation,match=tree.query(stars['position']/distance[:,None])
        duplicate=(separation<2*np.pi/(180*3600))&(np.abs(base_distance[match]/distance-1)<.25)
        stars,obs=stars[~duplicate],obs[~duplicate]
        arrays.append(stars); observations.append(obs)
        counts[kind]={'downloaded':rawcount,'retained':len(stars),'hygMatchesRemoved':int(duplicate.sum()),'raHistogram30deg':np.histogram(rows[:,0],bins=np.arange(0,361,30))[0].tolist()}
        inputs.append({'path':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'download':query})
    stars=np.concatenate(arrays)
    print('Building hierarchy for',len(stars),'stars',flush=True)
    nodes,indices=build_bvh(stars,leaf_size=16)
    aux=summaries(stars,nodes,indices)
    payload=bytearray(64);offsets=[]
    for values in (stars,nodes,indices):
        payload.extend(bytes((-len(payload))%64));offsets.append(len(payload));payload.extend(values.tobytes())
    struct.pack_into('<9I',payload,0,MAGIC,1,len(stars),len(nodes),*offsets,0,len(payload))
    save(ROOT/'artifacts/gaia-atlas.bin',payload)
    save(ROOT/'artifacts/gaia-light.bin',aux.tobytes())
    save(ROOT/'artifacts/gaia-observations.bin',np.concatenate(observations).tobytes())
    metadata={'version':1,'baseCount':len(base),'totalCount':len(stars),'nodeCount':len(nodes),'counts':counts,'inputs':inputs,
      'queries':{'nearby':f'SELECT {FIELDS} FROM gaiadr3.gaia_source WHERE {NEAR_WHERE}','lmc':f'SELECT {FIELDS} FROM gaiadr3.gaia_source WHERE {LMC_WHERE}'},
      'coordinateEpoch':'J2000 angular proper-motion propagation from Gaia DR3 J2016.0; fixed radial distance',
      'nearbyDistance':'1000/parallax_mas; S/N >10, within 500 pc, G<12. No Gaia parallax zero-point correction; formal uncertainties retained.',
      'lmcDistance':'Candidate members by sky/proper-motion/parallax cuts. Observed angles and photometry; reconstructed inclined disk at 49.59 kpc, inclination 34.7 deg, line-of-nodes 122.5 deg, seeded thickness ±300 pc. Individual depths are not measured.',
      'appearance':'BP−RP drives illustrative RGB/temperature; G-band photometry drives summed relative light. Display exposure is artistic. Extinction is not removed or recomputed for displaced observers; radius estimates are illustrative.',
      'cloudDisplayGain':CLOUD_DISPLAY_GAIN,'scope':'A quality-filtered, magnitude-limited nearby sample plus LMC candidate field, not the entire Gaia catalog or a complete Milky Way census.',
      'sources':['https://www.cosmos.esa.int/web/gaia/dr3','https://arxiv.org/abs/1903.08096','https://arxiv.org/abs/astro-ph/0105339','https://www.eso.org/public/news/eso1540/'],
      'credit':'ESA/Gaia/DPAC; Gaia DR3. HYG credits and license retained separately.',
      'atlasSha256':hashlib.sha256(payload).hexdigest(),'lightSha256':hashlib.sha256(aux.tobytes()).hexdigest()}
    save(ROOT/'artifacts/gaia.json',(json.dumps(metadata,indent=2)+'\n').encode())
    print(json.dumps(counts,indent=2),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--download',action='store_true');parser.add_argument('--download-only',action='store_true');args=parser.parse_args()
    if args.download or args.download_only:
        for kind in ['500pc','lmc']:download(kind)
    if not args.download_only:compile_all()
