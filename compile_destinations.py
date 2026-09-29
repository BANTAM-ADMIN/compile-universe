#!/usr/bin/env python3
"""Anchor illustrated closeups to catalog positions without inventing detections.

Positions are fixed heliocentric/equatorial scene coordinates. Model units describe
presentation geometry, not necessarily the physical radius of an object. Cached
SIMBAD query results and curated NASA/ESO source facts make rebuilds offline.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import urllib.parse

from compile_systems import KM_PER_PC, atomic_write, fetch

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / 'data/sources'
OUTPUT = ROOT / 'artifacts/phenomena-destinations.json'
C_KM_S = 299792.458
JULIAN_YEAR_S = 365.25 * 86400
LY_PER_PC = KM_PER_PC / (C_KM_S * JULIAN_YEAR_S)
SOLAR_GM_KM3_S2 = 1.3271244e11  # IAU 2015 nominal solar mass parameter.
SIMBAD_QUERY = "SELECT i.id, b.main_id, b.ra, b.dec, b.coo_bibcode FROM ident AS i JOIN basic AS b ON i.oidref=b.oid WHERE i.id IN ('VFTS 352','M 1','M 42','PSR B0531+21','3C 273','Sgr A*')"
SIMBAD_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync?' + urllib.parse.urlencode(dict(REQUEST='doQuery', LANG='ADQL', FORMAT='json', QUERY=SIMBAD_QUERY))


def position_from_sky(ra_deg, dec_deg, distance_pc):
    if not all(math.isfinite(x) for x in (ra_deg, dec_deg, distance_pc)) or not 0 <= ra_deg < 360 or not -90 <= dec_deg <= 90 or distance_pc <= 0:
        raise ValueError('Invalid sky anchor')
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    return [distance_pc * math.cos(dec) * math.cos(ra), distance_pc * math.cos(dec) * math.sin(ra), distance_pc * math.sin(dec)]


def catalog_betelgeuse():
    raw = (ROOT / 'artifacts/atlas.bin').read_bytes()
    header = struct.unpack_from('<9I', raw)
    for index in range(header[2]):
        at = header[4] + index * 64
        if struct.unpack_from('<I', raw, at + 52)[0] == 27919:
            return index, list(struct.unpack_from('<3d', raw, at)), struct.unpack_from('<f', raw, at + 28)[0]
    raise ValueError('HYG Betelgeuse anchor is absent')


def compile_destinations(output=OUTPUT, refresh=False):
    raw, query_source = fetch(SIMBAD_URL, 'phenomena-simbad-coordinates.json', refresh)
    document = json.loads(raw)
    columns = [column['name'] for column in document['metadata']]
    if columns != ['id', 'main_id', 'ra', 'dec', 'coo_bibcode']:
        raise ValueError('SIMBAD coordinate schema changed')
    normalize = lambda value: ' '.join(value.split()).removeprefix('NAME ')
    coordinates = {normalize(row[0]): dict(zip(columns, row)) for row in document['data']}
    facts_path = CACHE / 'phenomena-anchor-facts.json'
    facts_document = json.loads(facts_path.read_text())
    sources = {'coordinates': query_source,
               'facts': {'cache': 'data/sources/' + facts_path.name,
                         'sha256': hashlib.sha256(facts_path.read_bytes()).hexdigest()},
               'units': {'url': 'https://arxiv.org/abs/1510.07674', 'note': 'IAU 2015 nominal solar mass parameter; Julian-year light-year conversion'}}
    destinations = []
    for spec in facts_document['objects']:
        record = dict(spec)
        radius = record.pop('modelUnitPc')
        if record['id'] == 'betelgeuse-study':
            index, position, catalog_radius = catalog_betelgeuse()
            distance = math.dist(position, [0, 0, 0])
            ra = math.degrees(math.atan2(position[1], position[0])) % 360
            dec = math.degrees(math.asin(position[2] / distance))
            # Match the existing atlas silhouette approximately; the HYG radius
            # itself was an illustrative luminosity/temperature estimate.
            radius = catalog_radius / 1.15
            record.update(linkedCatalogIndex=index, linkedHygId=27919,
                          physicalproperties={'catalogDistancePc': distance, 'catalogRadiusPc': catalog_radius,
                                              'catalogRadiusClass': 'illustrative luminosity/temperature estimate, not a measured radius'})
            coordinate_source = {'catalog': 'HYG v4.2', 'hygId': 27919, 'catalogIndex': index,
                                 'url': 'https://www.astronexus.com/projects/hyg',
                                 'note': 'Exact existing compiled position retained; no duplicate star or changed distance'}
        else:
            coord = coordinates[record.pop('coordinateId')]
            ra, dec = coord['ra'], coord['dec']
            distance = record.pop('distancePc', None)
            if distance is None:
                distance = record.pop('distanceLightYears') / LY_PER_PC
            position = position_from_sky(ra, dec, distance)
            coordinate_source = dict(query_source, identifier=coord['main_id'], coordinateReference=coord['coo_bibcode'],
                                     frame='ICRS, fixed catalog position; SIMBAD metadata labels epoch J2000')
        if record['sceneKind'] == 'blackhole':
            mass = record['physicalproperties']['massSolar']
            radius = 2 * SOLAR_GM_KM3_S2 * mass / C_KM_S ** 2 / KM_PER_PC
            record['physicalproperties']['schwarzschildRadiusPc'] = radius
            record['physicalproperties']['schwarzschildRadiusKm'] = radius * KM_PER_PC
        view = record['viewDirection']
        norm = math.hypot(*view)
        record.update(kind='phenomenon', position=position, radiusPc=radius, radius_pc=radius,
                      modelUnitPc=radius, distancePc=distance, distanceLightYears=distance * LY_PER_PC,
                      raDeg=ra, decDeg=dec, viewDirection=[v / norm for v in view],
                      appearanceDataClass='illustrative closeup', dataClass='observed-object-illustrated-closeup',
                      positionDataClass='fixed catalog direction with approximate adopted distance',
                      radiusDataClass='Schwarzschild radius from adopted mass; nonrotating model' if record['sceneKind'] == 'blackhole' else 'visualization model unit; not a measured object radius')
        record['sources'] = {'coordinates': coordinate_source, 'distance': record.pop('distanceSource'),
                             'physical': record.pop('physicalSources', []), 'facts': sources['facts']}
        colors = {'vfts-352': [.48, .70, 1.], 'betelgeuse-study': [1., .40, .12],
                  'crab-nebula': [.75, .48, .80], 'orion-nebula': [.70, .46, .90],
                  'crab-pulsar': [.35, .65, 1.], '3c-273': [.60, .75, 1.],
                  'sagittarius-a': [1., .72, .32]}
        record['farAppearance'] = {'color': colors[record['id']], 'flux': .65,
                                  'dataClass': 'illustrative visibility floor; not measured apparent magnitude',
                                  'note': 'Persistent unresolved emission at the same world position as the closeup. A linked catalog star supplies its existing distant appearance.'}
        record['facts'] = [{'label': 'Object', 'value': record['classification']},
                           {'label': 'Adopted distance', 'value': round(distance * LY_PER_PC, 3), 'unit': 'light-years'},
                           {'label': 'Closeup', 'value': 'Illustrative appearance at a real catalog anchor'},
                           {'label': 'Scale', 'value': record['modelScaleDescription']}]
        destinations.append(record)
    result = dict(version=1, frame='heliocentric ICRS/equatorial Cartesian parsecs; +X RA0, +Y RA90, +Z north',
                  destinations=destinations, sources=sources,
                  license='CC BY-SA 4.0 for adapted HYG position; SIMBAD/CDS and individual scientific sources credited per record',
                  limitations=[
                      'Catalog directions and adopted distances anchor the scene; closeup geometry, colors, animation and orientation are authored interpretations',
                      'No current ephemeris, stellar-motion propagation, light-travel-time history or prediction of an impending event is implied',
                      'Pulsar and quasar relative scales are deliberately exaggerated or compressed; modelUnitPc is not a stellar or event-horizon radius',
                      '3C 273 uses a rounded NASA public distance as a scene radial coordinate; this is not a cosmological comoving-distance model',
                      'Sagittarius A* uses a nonrotating Schwarzschild visualization normalized by its adopted mass, not an inference that the real black hole has zero spin'])
    validate(result)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
    atomic_write(output, encoded)
    atomic_write(output.with_suffix(output.suffix + '.gz'), gzip.compress(encoded, compresslevel=9, mtime=0))
    return result


def validate(document):
    records = document['destinations']
    if len(records) != 7 or len({r['id'] for r in records}) != 7 or len({r['index'] for r in records}) != 7:
        raise ValueError('Expected seven distinct observed destinations')
    reserved = {body['index'] for body in json.loads((ROOT / 'artifacts/systems.json').read_text())['bodies']}
    for record in records:
        if record['index'] in reserved or not -50006 <= record['index'] <= -50000:
            raise ValueError('Destination index collision')
        if len(record['position']) != 3 or not all(math.isfinite(v) for v in record['position']):
            raise ValueError('Nonfinite position')
        if not math.isfinite(record['radiusPc']) or record['radiusPc'] <= 0 or record['modelUnitPc'] != record['radiusPc']:
            raise ValueError('Invalid model scale')
        if not math.isclose(math.dist(record['position'], [0, 0, 0]), record['distancePc'], rel_tol=1e-14):
            raise ValueError('Position/distance mismatch')
        if not math.isclose(math.hypot(*record['viewDirection']), 1., abs_tol=1e-14):
            raise ValueError('Invalid viewing direction')
        if record['sceneKind'] == 'phenomenon' and record['sceneId'] not in range(6):
            raise ValueError('Invalid local scene')
        if 'not' not in record['radiusDataClass'] and record['sceneKind'] != 'blackhole':
            raise ValueError('Model radius needs an explicit physical-scale distinction')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    result = compile_destinations(args.output, args.refresh)
    print(f"Compiled {len(result['destinations'])} observed anchors → {args.output}")
