#!/usr/bin/env python3
"""Compile curated planetary destinations with explicit measurement provenance.

Major solar-system centers use geometric JPL Horizons states at J2000 TDB.
Smaller moons use labeled mean-element approximations; dwarf companions and
exoplanets use explicitly illustrative placements at published distance scales.
Exoplanet hosts retain HYG coordinates.
All source responses are cached; normal rebuilds are deterministic and offline.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import hashlib
import html
import json
import math
from pathlib import Path
import re
import struct
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "data/sources"
OUTPUT = ROOT / "artifacts/systems.json"
KM_PER_PC = 3.085677581491367e13
PC_PER_AU = math.pi / 648000
EARTH_NOMINAL_KM = 6378.1
JUPITER_NOMINAL_KM = 71492.
PHYSICAL_URL = "https://ssd.jpl.nasa.gov/planets/phys_par.html"
SATELLITE_URL = "https://ssd.jpl.nasa.gov/sats/phys_par/"
SATURN_URL = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturnfact.html"
RINGS_URL = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html"
PS_QUERY = "select pl_name,hostname,hd_name,hip_name,soltype,pl_controv_flag,pl_orbper,pl_orbsmax,pl_rade,pl_radeerr1,pl_radeerr2,pl_radelim,pl_radj,pl_bmasse,pl_bmassprov,pl_orbeccen,pl_orbincl,discoverymethod,disc_year,ra,dec,sy_dist,pl_refname from ps where default_flag=1 and pl_name in ('Proxima Cen b','51 Peg b','HD 209458 b','55 Cnc e')"
SMA_QUERY = "select pl_name,pl_orbsmax,pl_orbsmax_reflink from pscomppars where pl_name='HD 209458 b'"

# Mean radii in km from JPL tables, plus stable UI/native record indices.
# Periods are deliberately not used to animate orbital centers.
SOLAR = [
    ("mercury", "Mercury", -3, 199, 2439.4, "sun", "Rocky planet", "rocky"),
    ("venus", "Venus", -4, 299, 6051.8, "sun", "Cloud-covered rocky planet", "rocky"),
    ("earth", "Earth", -2, 399, 6371.0084, "sun", "Rocky planet", "water"),
    ("mars", "Mars", -5, 499, 3389.50, "sun", "Rocky planet", "rocky"),
    ("jupiter", "Jupiter", -6, 599, 69911., "sun", "Gas giant", "gas"),
    ("saturn", "Saturn", -7, 699, 58232., "sun", "Ringed gas giant", "gas"),
    ("uranus", "Uranus", -8, 799, 25362., "sun", "Ice giant", "ice"),
    ("neptune", "Neptune", -9, 899, 24622., "sun", "Ice giant", "ice"),
    ("moon", "Moon", -10, 301, 1737.4, "earth", "Earth's natural satellite", "rocky"),
    ("io", "Io", -11, 501, 1821.49, "jupiter", "Jovian moon", "rocky"),
    ("europa", "Europa", -12, 502, 1560.80, "jupiter", "Icy Jovian moon", "ice"),
    ("titan", "Titan", -13, 606, 2574.76, "saturn", "Hazy Saturnian moon", "rocky"),
    ("enceladus", "Enceladus", -14, 602, 252.10, "saturn", "Icy Saturnian moon", "ice"),
]
EXOPLANETS = [
    ("proxima-b", "Proxima Centauri b", -20, "Proxima Cen b", 70890, "temperate-rock", "Confirmed low-mass exoplanet", 1.1 * EARTH_NOMINAL_KM),
    ("51-peg-b", "51 Pegasi b", -21, "51 Peg b", 113357, "hot-jupiter", "Confirmed hot Jupiter", JUPITER_NOMINAL_KM),
    ("hd209458-b", "HD 209458 b", -22, "HD 209458 b", 108859, "hot-jupiter", "Confirmed transiting hot Jupiter", None),
    ("55-cnc-e", "55 Cancri e", -23, "55 Cnc e", 43587, "lava", "Confirmed transiting super-Earth", None),
]
STELLAR = [
    (71456, "Alpha Centauri A", "Nearby stars"), (71453, "Alpha Centauri B", "Nearby stars"),
    (70666, "Proxima Centauri", "Nearby stars"), (32263, "Sirius", "Nearby stars"),
    (87665, "Barnard's Star", "Nearby stars"), (103879, "61 Cygni A", "Nearby stars"),
    (103883, "61 Cygni B", "Nearby stars"), (90979, "Vega", "Bright stars"),
    (97338, "Altair", "Bright stars"), (69451, "Arcturus", "Giant stars"),
    (21368, "Aldebaran", "Giant stars"), (24378, "Rigel", "Supergiant stars"),
    (80519, "Antares", "Supergiant stars"), (27919, "Betelgeuse", "Supergiant stars"),
    (101767, "Deneb", "Supergiant stars"), (11734, "Polaris", "Sky landmarks"),
    (17661, "Alcyone", "Sky landmarks"),
]


def fetch(url, filename, refresh=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / filename
    if refresh or not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "COMPILEUNIVERSE/1.0 offline astronomy compiler"})
        raw = urllib.request.urlopen(request, timeout=60).read()
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(raw)
        temporary.replace(path)
    raw = path.read_bytes()
    return raw, {"url": url, "cache": "data/sources/" + filename, "sha256": hashlib.sha256(raw).hexdigest()}


def horizons_url(number):
    parameters = {"format": "json", "COMMAND": f"'{number}'", "EPHEM_TYPE": "'VECTORS'",
                  "CENTER": "'500@10'", "TLIST": "'2451545.0'", "REF_PLANE": "'FRAME'",
                  "REF_SYSTEM": "'ICRF'", "OUT_UNITS": "'AU-D'", "VEC_TABLE": "'2'", "CSV_FORMAT": "'YES'"}
    return "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(parameters)


def parse_horizons(raw, number, expected_name=None):
    result = json.loads(raw)["result"]
    for required in ("Reference frame : ICRF", "Center body name: Sun (10)", "Output units    : AU-D", "GEOMETRIC cartesian states"):
        if required not in result:
            raise ValueError("Unexpected Horizons convention: " + required)
    target = re.search(r"Target body name: (.*?)\s+\{source: ([^}]+)\}", result)
    if not target or (f"({number})" not in target[1] if expected_name is None else not re.search(r"\b" + re.escape(expected_name) + r"\b", target[1])):
        raise ValueError("Horizons returned a different target")
    data = result.split("$$SOE\n", 1)[1].split("\n$$EOE", 1)[0].strip().split(",")
    if float(data[0]) != 2451545:
        raise ValueError("Unexpected Horizons epoch")
    position = [float(v) for v in data[2:5]]
    if len(position) != 3 or not all(math.isfinite(v) for v in position):
        raise ValueError("Nonfinite Horizons position")
    return position, target[2]


def tap_url(query):
    return "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?" + urllib.parse.urlencode({"query": query, "format": "json"})


def reference(markup):
    href = re.search(r"href=['\"]?([^\s'\">]+)", markup or "")
    return {"citation": html.unescape(re.sub(r"<[^>]*>", "", markup or "")), "url": html.unescape(href[1]) if href else ""}


def catalog_records():
    payload = (ROOT / "artifacts/atlas.bin").read_bytes()
    header = struct.unpack_from("<9I", payload)
    if header[0] != 0x54415543:
        raise ValueError("Unknown stellar catalog format")
    with gzip.open(ROOT / "data/hygdata_v42.csv.gz", "rt") as stream:
        source = {int(row["id"]): row for row in csv.DictReader(stream)}
    records = {}
    for index in range(header[2]):
        item = struct.unpack_from("<3d7f3I", payload, header[4] + index * 64)
        row = source[item[10]]
        records[item[10]] = dict(index=index, id=item[10], name="Sun" if index == 0 else row["proper"] or row["bf"] or f"HYG {item[10]}",
            position=list(item[:3]), radius_pc=item[4], radiusPc=item[4], absmag=item[3], flags=item[11],
            spect=row["spect"], hip=int(row["hip"]) if row["hip"] else None,
            hd=int(row["hd"]) if row["hd"] else None, distance=float(row["dist"]),
            kind="star", dataClass="catalog-star", source="HYG v4.2; fixed J2000 position")
    return records


def pole(ra_deg, dec_deg):
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    return [math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)]


def apply_appearances(bodies):
    """Bind the actual compiled map hashes and credits, not generic map claims."""
    surfaces = json.loads((ROOT / "artifacts/surface-metadata.json").read_text())
    earth = json.loads((ROOT / "artifacts/solar.json").read_text())["earth"]
    by_url = {value["url"]: value for value in surfaces["surfaces"].values()}
    for body in bodies:
        if body["id"] == "earth":
            descriptor = dict(earth["texture"])
            if earth.get('emission'):body['emission']=earth['emission']
            appearance_class = "NASA source map"
            provenance = dict(earth["appearanceSource"])
        else:
            surface = by_url[body["texture"]["url"]]
            descriptor = {key: surface[key] for key in ("url", "width", "height", "channels", "sha256", "format")}
            appearance_class = surface["appearanceClass"]
            provenance = dict(surface.get("source", {"name": "COMPILEUNIVERSE authored illustration", "note": "No measured geography, weather, or colors claimed"}))
        raw = (ROOT / descriptor["url"].lstrip("/")).read_bytes()
        if len(raw) != descriptor["width"] * descriptor["height"] * descriptor["channels"] or hashlib.sha256(raw).hexdigest() != descriptor["sha256"]:
            raise ValueError("Compiled surface dimensions/hash do not match metadata")
        body["texture"] = descriptor
        body["appearanceDataClass"] = appearance_class
        body["provenance"]["appearance"] = provenance
        if "ring" in body:
            ring = surfaces["rings"][body["id"]]
            if ring["innerRadiusKm"] != body["ring"]["innerRadiusKm"] or ring["outerRadiusKm"] != body["ring"]["outerRadiusKm"]:
                raise ValueError("Ring geometry and chart parameterization disagree")
            body["ring"]["texture"] = {key: ring[key] for key in ("url", "width", "channels", "sha256")}
            body["ring"]["texture"]["format"] = ring.get("format", "RGBA8 radial chart, linear inner to outer")
            ring_bytes = (ROOT / ring["url"].lstrip("/")).read_bytes()
            if len(ring_bytes) != ring["width"] * ring["channels"] or hashlib.sha256(ring_bytes).hexdigest() != ring["sha256"]:
                raise ValueError("Compiled ring chart dimensions/hash do not match metadata")



ELEMENTS_URL = "https://ssd.jpl.nasa.gov/sats/elem/"
DISCOVERY_URL = "https://ssd.jpl.nasa.gov/sats/discovery.html"
DWARFS = [("pluto", -30, 999, 1188.3), ("ceres", -31, "1;", 469.7),
          ("eris", -32, "136199;", 1200.), ("haumea", -33, "136108;", 715.),
          ("makemake", -34, "136472;", 714.)]


def table_rows(raw, table_id=None):
    """JPL tables omit closing td tags: do not treat nested cells as text."""
    text = raw.decode() if isinstance(raw, bytes) else raw
    if table_id:
        table = re.search(r'<table[^>]*id="' + re.escape(table_id) + r'".*?</table>', text, re.S)
        if not table:
            raise ValueError("Missing JPL table " + table_id)
        text = table[0]
    rows = []
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', text, re.S):
        cells = [' '.join(html.unescape(re.sub('<[^>]+>', ' ', cell)).split())
                 for cell in re.findall(r'<td\b[^>]*>(.*?)(?=<td\b|$)', row, re.S)]
        if cells:
            rows.append(cells)
    return rows


def parse_moon_elements(raw):
    records = []
    for cells in table_rows(raw, "sat_elem"):
        if len(cells) != 20:
            raise ValueError("Changed satellite element table schema")
        name = {519: "Megaclite", 558: "Philophrosyne"}.get(int(cells[3]), cells[2])
        name = re.sub(r'^S(\d+)_(\w)_(\d+)$', r'S/\1 \2 \3', name)
        item = dict(name=name, parent=cells[1].lower(), code=int(cells[3]), ephemeris=cells[4],
                    frame=cells[5], epoch=cells[6], semimajorAxisKm=float(cells[7]),
                    eccentricity=float(cells[8]), argumentPeriapsisDeg=float(cells[9]),
                    meanAnomalyDeg=float(cells[10]), inclinationDeg=float(cells[11]),
                    ascendingNodeDeg=float(cells[12]), periodDays=float(cells[13]), reference=cells[19])
        if cells[16]:
            item.update(poleRADeg=float(cells[16]), poleDecDeg=float(cells[17]))
        if not (item['semimajorAxisKm'] > 0 and 0 <= item['eccentricity'] < 1 and item['periodDays'] > 0):
            raise ValueError("Invalid satellite orbit")
        records.append(item)
    unique = {}
    for item in records:
        if item['code'] in unique:
            previous = unique[item['code']]
            if item['code'] != 715 or previous['name'] != item['name']:
                raise ValueError('Unexpected duplicate satellite orbit ID')
            # JPL lists Puck in two frames/epochs. Prefer its J2000 solution
            # over propagating the 2025 solution backward for 25 years.
            if previous['epoch'] != '2000-01-01.5':
                unique[item['code']] = item
        else:
            unique[item['code']] = item
    return list(unique.values())


def plane_basis(orbit):
    """Reference-plane node on ICRF equator, as defined by JPL's element table."""
    if orbit['frame'] == 'ecliptic':
        e = math.radians(23.439291111)
        return [[1., 0., 0.], [0., math.cos(e), math.sin(e)]]
    if orbit['frame'] == 'Laplace':
        normal = pole(orbit['poleRADeg'], orbit['poleDecDeg'])
    elif orbit['frame'] == 'equatorial' and orbit['parent'] == 'uranus':
        normal = pole(257.311, -15.175)
    elif orbit['frame'] == 'equatorial' and orbit['parent'] == 'pluto':
        normal = pole(132.99, -6.16)
    elif orbit['frame'] == 'saturn-equator':
        normal = pole(40.589, 83.537)
    else:
        raise ValueError("Unsupported satellite reference plane")
    norm = math.hypot(normal[0], normal[1])
    x = [-normal[1] / norm, normal[0] / norm, 0.]
    y = [-normal[2] * x[1], normal[2] * x[0], normal[0] * x[1] - normal[1] * x[0]]
    return [x, y]


def element_position_km(orbit):
    """Two-body mean-element approximation at J2000; not a precision ephemeris."""
    date, fraction = orbit['epoch'].rsplit('.', 1)
    epoch_days = (datetime.date.fromisoformat(date) - datetime.date(2000, 1, 1)).days + float('.' + fraction)
    mean = (math.radians(orbit['meanAnomalyDeg']) + 2 * math.pi * (.5 - epoch_days) / orbit['periodDays']) % (2 * math.pi)
    e = orbit['eccentricity']
    anomaly = mean if e < .8 else math.pi
    for _ in range(40):
        delta = (anomaly - e * math.sin(anomaly) - mean) / (1 - e * math.cos(anomaly))
        anomaly -= delta
        if abs(delta) < 1e-14:
            break
    if abs(anomaly - e * math.sin(anomaly) - mean) > 1e-11:
        raise ValueError("Kepler solve did not converge")
    x = orbit['semimajorAxisKm'] * (math.cos(anomaly) - e)
    y = orbit['semimajorAxisKm'] * math.sqrt(1 - e * e) * math.sin(anomaly)
    w, inc, node = (math.radians(orbit[key]) for key in ('argumentPeriapsisDeg', 'inclinationDeg', 'ascendingNodeDeg'))
    # Rz(node) Rx(inclination) Rz(argument of periapsis).
    u, v = x * math.cos(w) - y * math.sin(w), x * math.sin(w) + y * math.cos(w)
    x, y, z = u * math.cos(node) - v * math.cos(inc) * math.sin(node), u * math.sin(node) + v * math.cos(inc) * math.cos(node), v * math.sin(inc)
    basis_x, basis_y = plane_basis(orbit)
    basis_z = [basis_x[1] * basis_y[2] - basis_x[2] * basis_y[1],
               basis_x[2] * basis_y[0] - basis_x[0] * basis_y[2],
               basis_x[0] * basis_y[1] - basis_x[1] * basis_y[0]]
    return [x * basis_x[k] + y * basis_y[k] + z * basis_z[k] for k in range(3)]


def add_complete_solar_registry(bodies, sources, refresh=False):
    elements_raw, sources['satelliteElements'] = fetch(ELEMENTS_URL, 'jpl-moon-elements.html', refresh)
    discovery_raw, sources['satelliteDiscovery'] = fetch(DISCOVERY_URL, 'jpl-moon-discovery.html', refresh)
    _, sources['uranusPole'] = fetch('https://nssdc.gsfc.nasa.gov/planetary/factsheet/uranusfact.html', 'nasa-uranus-facts.html', refresh)
    physical = {int(c[2]): dict(name=c[1], radius=float(c[6]), uncertainty=c[7], reference=c[8])
                for c in table_rows((CACHE / 'jpl-moon-physical.html').read_bytes(), 'sat_phys_par')}
    elements = parse_moon_elements(elements_raw)
    existing = {body['id']: body for body in bodies}
    maps = json.loads((ROOT / 'artifacts/surface-metadata.json').read_text())['surfaces']

    def make_body(ident, name, index, radius, parent, kind, position, position_class, radius_class, source, texture=None):
        texture = texture or (ident if ident in maps else 'ice-rock' if parent not in ('sun', 'mars') else 'carbon')
        return dict(id=ident, index=index, name=name, kind=kind, systemId='solar-system',
                    position=position, positionAU=[v / PC_PER_AU for v in position],
                    radiusPc=radius / KM_PER_PC, radius_pc=radius / KM_PER_PC, radiusKm=radius,
                    parentId=parent, parentStarIndex=0, hostPosition=[0., 0., 0.],
                    classification='Dwarf planet' if kind == 'dwarf' else parent.title() + ' moon',
                    dataClass='solar-system-ephemeris' if 'JPL ephemeris' in position_class else 'solar-system-approximate-orbit',
                    positionDataClass=position_class, radiusDataClass=radius_class,
                    description=('Dwarf planet' if kind == 'dwarf' else parent.title() + ' satellite') + '. ' + position_class + '. ' + radius_class + '. Surface and rotation are illustrated.',
                    texture={'url': f'/artifacts/surface-{texture}.bin', 'width': 512, 'height': 256, 'channels': 3},
                    appearanceKind='ice' if texture == 'ice-rock' else 'rocky', axis=[0., 0., 1.], primeMeridian=0., rotationRate=.008,
                    axisDataClass='illustrative orientation', rotationDataClass='illustrative animation; not elapsed astronomical time',
                    facts=[{'label': 'Mean radius' if radius_class == 'published mean radius' else 'Illustrative radius', 'value': radius, 'unit': 'km'},
                           {'label': 'Parent', 'value': parent.title()}, {'label': 'Position', 'value': position_class}],
                    provenance={'position': source, 'radius': sources['planetPhysical' if kind == 'dwarf' else 'satellitePhysical']
                                if radius_class == 'published mean radius' else {'note': 'Authored 2 km radius placeholder; no measured size claimed'}})

    for ident, index, command, radius in DWARFS:
        raw, source = fetch(horizons_url(command), f'horizons-{ident}-j2000.json', refresh)
        xyz, ephemeris = parse_horizons(raw, command, ident.title())
        source.update(name='NASA/JPL Horizons', ephemeris=ephemeris)
        body = make_body(ident, ident.title(), index, radius, 'sun', 'dwarf', [v * PC_PER_AU for v in xyz],
                         'geometric JPL ephemeris at JD 2451545.0 TDB', 'published mean radius', source,
                         ident if ident in maps else 'ice-rock' if ident != 'ceres' else 'carbon')
        if ident == 'haumea':
            shape_path = CACHE / 'haumea-occultation-model.json'
            model = json.loads(shape_path.read_text())
            geometry_source = dict(url=model['source'], citation=model['citation'], note=model['note'],
                                   cache='data/sources/' + shape_path.name, sha256=hashlib.sha256(shape_path.read_bytes()).hexdigest())
            radius = math.cbrt(math.prod(model['semiaxesKm']))
            body.update(radiusKm=radius, radiusPc=radius / KM_PER_PC, radius_pc=radius / KM_PER_PC,
                        shape=[v / radius for v in model['semiaxesKm']],
                        shapeDataClass='occultation and light-curve triaxial model; rotational phase illustrative',
                        radiusDataClass='volume-equivalent radius derived from published triaxial model semiaxes',
                        axis=pole(model['poleRaDeg'], model['poleDecDeg']),
                        axisDataClass='preferred J2000 pole from occultation ring model; rotational phase illustrative')
            body['facts'][0] = {'label': 'Model volume-equivalent radius', 'value': radius, 'unit': 'km'}
            body['facts'].append({'label': 'Model semiaxes', 'value': '1161 × 852 × 513', 'unit': 'km'})
            for key in ('radius', 'shape', 'axis'):
                body['provenance'][key] = geometry_source
            body['description'] = 'An elongated dwarf planet with a narrow ring. Shape and ring scale follow the 2017 occultation model; surface appearance and rotational phase are illustrated.'
            body['ring'] = dict(innerRadius=2252 / radius, outerRadius=2322 / radius, innerRadiusKm=2252., outerRadiusKm=2322.,
                                texture={'url': '/artifacts/rings-haumea.bin', 'width': 256, 'channels': 4},
                                dataClass='published occultation ring radius/width; authored color and opacity chart',
                                limitations='Thin circular model; no resolved particle structure or time-dependent precession', source=geometry_source)
        existing[ident] = body
        bodies.append(body)

    for orbit in elements:
        ident = re.sub(r'[^a-z0-9]+', '-', orbit['name'].lower()).strip('-')
        if ident in existing:
            existing[ident]['orbit'] = dict(orbit, placement='fixed Horizons snapshot; mean elements shown for context')
            existing[ident]['jplSatelliteCode'] = orbit['code']
            continue
        measured = physical.get(orbit['code'])
        radius = measured['radius'] if measured else 2.
        if measured:
            raw, source = fetch(horizons_url(orbit['code']), f'horizons-{ident}-j2000.json', refresh)
            xyz, ephemeris = parse_horizons(raw, orbit['code'])
            position = [v * PC_PER_AU for v in xyz]
            source.update(name='NASA/JPL Horizons', ephemeris=ephemeris)
            position_class = 'geometric JPL ephemeris at JD 2451545.0 TDB'
        else:
            offset = element_position_km(orbit)
            position = [p + d / KM_PER_PC for p, d in zip(existing[orbit['parent']]['position'], offset)]
            source = dict(sources['satelliteElements'], ephemeris=orbit['ephemeris'], reference=orbit['reference'])
            position_class = 'approximate J2000 two-body propagation of published mean elements; not a precision ephemeris'
        body = make_body(ident, orbit['name'], -1000 - orbit['code'], radius, orbit['parent'], 'moon', position,
                         position_class, 'published mean radius' if measured else 'illustrative 2 km radius; published size unavailable in selected JPL table', source)
        body['jplSatelliteCode'] = orbit['code']
        body['orbit'] = dict(orbit, placement='fixed Horizons snapshot; mean elements shown for context' if measured else 'Keplerian mean-element approximation; precession and perturbations omitted')
        body['radiusEstimated'] = not bool(measured)
        if ident in ('phobos', 'deimos'):
            dimensions = [27., 22., 18.] if ident == 'phobos' else [15., 12., 11.]
            _, shape_source = fetch(f'https://science.nasa.gov/mars/moons/{ident}/', f'nasa-{ident}-shape.html', refresh)
            body.update(shape=[d / (2 * radius) for d in dimensions], shapeDataClass='ellipsoid from NASA rounded dimensions; orientation illustrative')
            body['provenance']['shape'] = shape_source
            body['facts'].append({'label': 'Approximate dimensions', 'value': ' × '.join(f'{d:g}' for d in dimensions), 'unit': 'km'})
        existing[ident] = body
        bodies.append(body)

    # The two published B-ring moonlets have no row in the selected JPL mean-element table.
    # Their radial locations are sourced, while longitude and radius are explicitly authored.
    _, s1_source = fetch('https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturniansatfact.html', 'nasa-saturn-satellites.html', refresh)
    s2_path = CACHE / 'mpc-2009-s2.json'
    s2_facts = json.loads(s2_path.read_text())
    s2_source = dict(url=s2_facts['source'], cache='data/sources/mpc-2009-s2.json', sha256=hashlib.sha256(s2_path.read_bytes()).hexdigest())
    for order, (ident, name, distance, source) in enumerate([('s-2009-s-1', 'S/2009 S 1', 117000., s1_source),
                                                            ('s-2009-s-2', 'S/2009 S 2', s2_facts['orbitalRadiusKm'], s2_source)]):
        orbit = dict(parent='saturn', frame='saturn-equator', epoch='2000-01-01.5', semimajorAxisKm=distance,
                     eccentricity=0., argumentPeriapsisDeg=0., meanAnomalyDeg=67. + 133. * order,
                     inclinationDeg=0., ascendingNodeDeg=0., periodDays=2 * math.pi * math.sqrt(distance ** 3 / 37931206.23) / 86400.,
                     placement='published orbital distance; illustrative circular plane/phase, derived Kepler period')
        position = [p + d / KM_PER_PC for p, d in zip(existing['saturn']['position'], element_position_km(orbit))]
        body = make_body(ident, name, -90001 - order, 2., 'saturn', 'moon', position,
                         'published B-ring orbital distance; illustrative circular orbit plane and phase, not an ephemeris',
                         'illustrative 2 km radius; no measured size claimed', source, 'carbon')
        body.update(orbit=orbit, radiusEstimated=True)
        bodies.append(body)

    companion_path = CACHE / 'dwarf-companions.json'
    companion_data = json.loads(companion_path.read_text())
    sources['dwarfCompanions'] = dict(cache='data/sources/dwarf-companions.json',
                                    sha256=hashlib.sha256(companion_path.read_bytes()).hexdigest(),
                                    note='Curated factual scalar values; primary publication links retained per object')
    for order, item in enumerate(companion_data['records']):
        phase, tilt = .6 + order * 1.7, .3 + order * .2
        offset = [math.cos(phase), math.sin(phase) * math.cos(tilt), math.sin(phase) * math.sin(tilt)]
        position = [p + d * item['separationKm'] / KM_PER_PC for p, d in zip(existing[item['parent']]['position'], offset)]
        body = make_body(item['id'], item['name'], item['index'], item['radiusKm'], item['parent'], 'moon', position,
                         item['separationType'] + '; illustrative plane and phase, not an ephemeris',
                         'published model-dependent radius estimate', item['positionSource'], 'ice-rock')
        body.update(dataClass='solar-system-literature-placement', aliases=item.get('aliases', []),
                    radiusEstimated=True, orbit={'placement': 'illustrative static offset at published distance scale',
                                                'separationKm': item['separationKm'], 'separationType': item['separationType'],
                                                'periodDays': item['periodDays']})
        body['provenance']['radius'] = item['radiusSource']
        body['facts'][0]['label'] = 'Published radius estimate'
        bodies.append(body)

    minor_bodies = [('vesta', 'Vesta', '4', -50, 'asteroid'), ('pallas', 'Pallas', '2', -51, 'asteroid'),
                    ('eros', 'Eros', '433', -52, 'asteroid'), ('bennu', 'Bennu', '101955', -53, 'asteroid'),
                    ('ryugu', 'Ryugu', '162173', -54, 'asteroid'), ('itokawa', 'Itokawa', '25143', -55, 'asteroid'),
                    ('halley', '1P/Halley', '1P', -56, 'comet'),
                    ('67p', '67P/Churyumov-Gerasimenko', '67P', -57, 'comet')]
    for ident, name, designation, index, kind in minor_bodies:
        query = 'https://ssd-api.jpl.nasa.gov/sbdb.api?' + urllib.parse.urlencode({'sstr': designation, 'phys-par': '1'})
        raw, physical_source = fetch(query, 'sbdb-' + ident + '.json', refresh)
        document = json.loads(raw)
        if document['object']['des'] != designation:
            raise ValueError('SBDB returned a different minor body')
        parameters = {item['name']: item for item in document['phys_par']}
        diameter = parameters['diameter']
        if diameter['units'] != 'km' or not math.isfinite(float(diameter['value'])) or float(diameter['value']) <= 0:
            raise ValueError('Invalid SBDB diameter units or value')
        radius = float(diameter['value']) / 2
        command = designation + ';' if designation.isdigit() else 'DES=' + designation + '; CAP; NOFRAG;'
        raw, position_source = fetch(horizons_url(command), f'horizons-{ident}-j2000.json', refresh)
        xyz, ephemeris = parse_horizons(raw, command, name)
        position_source.update(name='NASA/JPL Horizons', ephemeris=ephemeris)
        body = make_body(ident, name, index, radius, 'sun', kind, [v * PC_PER_AU for v in xyz],
                         'geometric JPL ephemeris at JD 2451545.0 TDB', 'published effective diameter divided by two', position_source, 'carbon')
        body.update(classification=document['object']['orbit_class']['name'],
                    aliases=[document['object']['fullname'], designation], sbdbDesignation=designation,
                    radiusUncertaintyKm=float(diameter['sigma']) / 2 if diameter.get('sigma') is not None else None)
        body['facts'][0]['label'] = 'Effective radius'
        body['provenance']['radius'] = dict(physical_source, citation=diameter['ref'], note=diameter.get('notes'))
        body['description'] = name + ': ' + body['classification'] + '. Fixed Horizons J2000 center; published effective size. Surface, orientation and animation are illustrated.'
        extent = parameters.get('extent')
        if extent and extent['units'] == 'km':
            dimensions = [float(v.strip()) for v in extent['value'].split('x')]
            if len(dimensions) == 3:
                body['shape'] = [value / (2 * radius) for value in dimensions]
                body['shapeDataClass'] = 'ellipsoid from published three-axis dimensions; orientation illustrative'
                body['provenance']['shape'] = dict(physical_source, citation=extent['ref'])
                body['facts'].append({'label': 'Published dimensions', 'value': extent['value'], 'unit': 'km'})
        if kind == 'comet':
            body.update(appearanceKind='comet', viewDistanceRadii=64.,
                        comet={'tailLengthRadii': 50., 'comaRadiusRadii': 3.,
                               'dataClass': 'illustrative activity; not observed tail geometry or J2000 outgassing'},
                        activityDataClass='illustrative coma and anti-solar tail; active appearance is not an observation at this fixed ephemeris')
            if ident == 'halley':
                body['shape'] = [14.9 / (2 * radius), 8.2 / (2 * radius), 8.2 / (2 * radius)]
                body['shapeDataClass'] = 'published two-axis extent with illustrative equal short axes; orientation illustrative'
                body['provenance']['shape'] = dict(physical_source, citation=parameters['extent']['ref'])
            body['description'] += ' Coma and tail activity are illustrative, including at this fixed historical position.'
        bodies.append(body)

    counts = {}
    for body in bodies:
        if body['kind'] == 'moon':
            counts[body['parentId']] = counts.get(body['parentId'], 0) + 1
    return dict(meanElementRows=460, uniqueMeanElementMoons=len(elements), publishedRadiusRows=len(physical), additionalRingMoonlets=2, additionalDwarfCompanions=4,
                duplicateRows=[{'name': 'Puck', 'code': 715, 'selection': 'J2000 equatorial URA182 row; duplicate 2025 Laplace URA184 row omitted'}],
                byParent=counts, coverage='Union of the cached JPL mean-element table and two published Saturn ring moonlets; duplicate Puck rows are merged',
                limitations='Snapshot of these source tables, not a continuously updated census; unknown-size moons have explicit illustrative 2 km radii')

def compile_systems(output=OUTPUT, refresh=False):
    catalog = catalog_records()
    by_hip = {r["hip"]: r for r in catalog.values() if r["hip"]}
    sources = {}
    for key, url, filename in (("planetPhysical", PHYSICAL_URL, "jpl-planet-physical.html"),
                              ("satellitePhysical", SATELLITE_URL, "jpl-moon-physical.html"),
                              ("saturnPole", SATURN_URL, "nasa-saturn-facts.html"),
                              ("saturnRings", RINGS_URL, "nasa-saturn-rings.html")):
        _, sources[key] = fetch(url, filename, refresh)
    bodies = []
    for ident, name, index, number, radius_km, parent, classification, appearance_kind in SOLAR:
        raw, source = fetch(horizons_url(number), f"horizons-{ident}-j2000.json", refresh)
        position_au, ephemeris = parse_horizons(raw, number)
        source.update(name="NASA/JPL Horizons", ephemeris=ephemeris)
        moon = parent != "sun"
        body = dict(id=ident, index=index, name=name, kind="moon" if moon else "planet", systemId="solar-system",
            position=[v * PC_PER_AU for v in position_au], positionAU=position_au,
            radiusPc=radius_km / KM_PER_PC, radius_pc=radius_km / KM_PER_PC, radiusKm=radius_km,
            parentId=parent, parentStarIndex=0, hostPosition=[0., 0., 0.],
            classification=classification, dataClass="solar-system-ephemeris", appearanceKind=appearance_kind,
            description=f"{classification}. Its center is a fixed JPL Horizons J2000 snapshot; its displayed rotation is illustrative.",
            texture={"url": "/artifacts/earth.bin" if ident == "earth" else f"/artifacts/surface-{ident}.bin", "width": 512, "height": 256, "channels": 3},
            axis=[0., 0., 1.], primeMeridian=0., rotationRate=.018 if ident in ("jupiter", "saturn") else .008,
            axisDataClass="illustrative orientation", rotationDataClass="illustrative animation; not elapsed astronomical time",
            positionDataClass="geometric JPL ephemeris at JD 2451545.0 TDB", radiusDataClass="published mean radius",
            facts=[{"label": "Mean radius", "value": radius_km, "unit": "km"},
                   {"label": "Position epoch", "value": "J2000.0 TDB"}, {"label": "Parent", "value": parent.title()}],
            provenance={"position": source, "radius": sources["satellitePhysical" if moon else "planetPhysical"],
                        "appearance": {"url": "/artifacts/surface-metadata.json", "note": "See per-body map credits; rotation and atmospheric glow are illustrative"}})
        if ident == "earth":
            body["axisDataClass"] = "UTC clock, IAU 2006 / 2000A celestial pole"
            body["rotationDataClass"] = "UTC-driven Earth rotation angle; UT1 approximated by UTC"
            body["rotationRate"] = 0
            body["description"] = "Earth’s rotation follows the UTC clock at its real rate. Its center and sunlight direction retain the fixed J2000 scene epoch."
            body['facts'].append({'label': 'Rotation', 'value': 'UTC clock · real rate'})
        if ident in ("earth", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "titan"):
            body["atmosphere"] = {"strength": .08 if ident == "mars" else .16,
                                  "color": [.3, .65, 1.] if ident in ("earth", "uranus", "neptune") else [1., .66, .3]}
        if ident == "saturn":
            body["axis"] = pole(40.589, 83.537)
            body["axisDataClass"] = "NASA reference north pole at J2000; illustrative rotational phase"
            body["provenance"]["axis"] = sources["saturnPole"]
            body["ring"] = dict(innerRadius=74658 / radius_km, outerRadius=136780 / radius_km,
                innerRadiusKm=74658, outerRadiusKm=136780,
                texture={"url": "/artifacts/rings-saturn.bin", "width": 1024, "channels": 4},
                dataClass="published C/B/A radial bounds; authored radial opacity and color",
                limitations="Only the main C/B/A ring span is shown; thin planar rings, not individual particles", source=sources["saturnRings"])
        bodies.append(body)

    moon_registry = add_complete_solar_registry(bodies, sources, refresh)

    raw, exo_source = fetch(tap_url(PS_QUERY), "exoplanet-systems-ps.json", refresh)
    rows = {r["pl_name"]: r for r in json.loads(raw)}
    supplemental, sma_source = fetch(tap_url(SMA_QUERY), "exoplanet-hd209458-sma.json", refresh)
    sma_row = json.loads(supplemental)[0]
    sources.update(exoplanetArchive=exo_source, hd209458SemimajorAxis=sma_source)
    systems = [dict(id="solar-system", name="Solar System", hostStarIndex=0, host=catalog[0],
                    description="Eight planets, five dwarf planets, 465 moons, six selected asteroids and two comets; precise snapshots and approximate mean-element placements are distinguished.",
                    bodyIds=[b["id"] for b in bodies], dataClass="solar-system-ephemeris")]
    for order, (ident, name, index, archive_name, hip, texture, classification, placeholder_radius) in enumerate(EXOPLANETS):
        row = rows[archive_name]
        if row["soltype"] != "Published Confirmed" or row["pl_controv_flag"] != 0:
            raise ValueError(f"Review confirmation status before publishing {archive_name}")
        host = dict(by_hip[hip])
        if row["hip_name"] != f"HIP {hip}":
            raise ValueError("Exoplanet host HIP mismatch")
        if row["hd_name"] and row["hd_name"] != f"HD {host['hd']}":
            raise ValueError("Exoplanet host HD mismatch")
        literature = reference(row["pl_refname"])
        sma = row["pl_orbsmax"]
        sma_reference = literature
        if sma is None:
            if sma_row["pl_name"] != archive_name:
                raise ValueError("Unexpected supplemental orbit source")
            sma, sma_reference = sma_row["pl_orbsmax"], reference(sma_row["pl_orbsmax_reflink"])
        if not math.isfinite(sma) or sma <= 0 or not row["pl_orbper"] or row["pl_orbper"] <= 0:
            raise ValueError("Invalid exoplanet orbital scale")
        observed_radius = row["pl_rade"] is not None and row["pl_radelim"] == 0
        radius_km = row["pl_rade"] * EARTH_NOMINAL_KM if observed_radius else placeholder_radius
        if radius_km is None or radius_km <= 0:
            raise ValueError("Missing exoplanet radius and explicit placeholder")
        # An authored phase and tilted plane, with separation equal to a.
        # The object is real; this particular center is NOT an ephemeris.
        phase, tilt = .7 + order * 1.1, .28 + order * .14
        offset_au = [sma * math.cos(phase), sma * math.sin(phase) * math.cos(tilt), sma * math.sin(phase) * math.sin(tilt)]
        system_id = ident + "-system"
        body = dict(id=ident, index=index, name=name, aliases=[archive_name], kind="exoplanet", systemId=system_id,
            position=[h + offset * PC_PER_AU for h, offset in zip(host["position"], offset_au)],
            hostOffsetAU=offset_au, hostPosition=host["position"], parentId=f"hyg-{host['id']}", parentStarIndex=host["index"],
            radiusPc=radius_km / KM_PER_PC, radius_pc=radius_km / KM_PER_PC, radiusKm=radius_km,
            classification=classification, dataClass="confirmed-exoplanet-illustrative-placement",
            positionDataClass="illustrative orbital plane and phase at published semimajor-axis scale; not an ephemeris",
            radiusDataClass="published transit radius" if observed_radius else "illustrative radius; unmeasured in selected archive solution",
            description=f"{classification} around {host['name']}. Orbital size and period come from the NASA Exoplanet Archive; surface, orientation, and current orbital phase are illustrative.",
            texture={"url": f"/artifacts/surface-{texture}.bin", "width": 512, "height": 256, "channels": 3},
            appearanceKind="gas" if texture == "hot-jupiter" else "lava" if texture == "lava" else "rocky",
            axis=[0., 0., 1.], primeMeridian=order * .5, rotationRate=.006,
            axisDataClass="illustrative orientation", rotationDataClass="illustrative animation",
            atmosphere={"strength": .15 if texture == "hot-jupiter" else .045, "color": [1., .55, .28]},
            orbit=dict(semimajorAxisAU=sma, periodDays=row["pl_orbper"], eccentricity=row["pl_orbeccen"],
                       publishedInclinationDeg=row["pl_orbincl"], placement="static illustrative circular offset; no orbit propagation"),
            radiusEarth=radius_km / EARTH_NOMINAL_KM,
            radiusUncertaintyEarth=[row["pl_radeerr2"], row["pl_radeerr1"]] if observed_radius else None,
            facts=[{"label": "Orbital period", "value": row["pl_orbper"], "unit": "days"},
                   {"label": "Semimajor axis", "value": sma, "unit": "AU"},
                   {"label": "Radius" if observed_radius else "Illustrative radius", "value": radius_km / EARTH_NOMINAL_KM, "unit": "Earth radii"},
                   {"label": "Discovery", "value": f"{row['discoverymethod']}, {row['disc_year']}"}],
            provenance={"archive": exo_source, "parameters": literature, "semimajorAxis": sma_reference,
                        "archiveStatus": row["soltype"], "controversial": bool(row["pl_controv_flag"]),
                        "host": {"catalog": "HYG v4.2", "hip": hip, "hygId": host["id"],
                                 "note": "HYG host position retained; newer archive distance is not substituted into this fixed catalog"},
                        "radius": literature if observed_radius else {"note": f"Authored display scale of {radius_km:g} km; no measured radius claimed"},
                        "appearance": {"note": "Authored illustration, not an observed exoplanet surface or atmospheric map"}})
        bodies.append(body)
        systems.append(dict(id=system_id, name=f"{row['hostname']} system", hostStarIndex=host["index"], host=host,
                            bodyIds=[ident], dataClass="confirmed-exoplanet-illustrative-placement",
                            description="A selected confirmed planet; this is not a census of every object in the system."))

    stellar = []
    for ident, name, category in STELLAR:
        record = dict(catalog[ident])
        record.update(name=name, category=category,
                      description=f"HYG spectral classification {record['spect']}; fixed catalog position, illustrative photosphere.")
        if ident == 17661:
            record["description"] = "Alcyone is the selected Pleiades member star; this destination is not a cluster centroid."
        stellar.append(record)
    obliquity = math.radians(23.439291111)
    belt_axis = [0., -math.sin(obliquity), math.cos(obliquity)]
    belts = []
    for ident, name, inner, outer, seed, url in [
        ('solar-main-belt', 'Main asteroid belt', 2.2, 3.3, 2052001, 'https://www.jpl.nasa.gov/news/galileo-flyby-of-gaspra-yields-new-information/'),
        ('solar-kuiper-belt', 'Kuiper Belt', 30., 50., 2052002, 'https://science.nasa.gov/solar-system/kuiper-belt/facts/')]:
        bounds_path = CACHE / (ident + '-bounds.json')
        bound_source = json.loads(bounds_path.read_text())
        if [inner, outer] != bound_source['boundsAU'] or url != bound_source['source']:
            raise ValueError('Belt bounds differ from curated primary-source facts')
        source = dict(url=url, cache='data/sources/' + bounds_path.name, sha256=hashlib.sha256(bounds_path.read_bytes()).hexdigest())
        belts.append(dict(id=ident, name=name, innerRadiusAU=inner, outerRadiusAU=outer,
                          axis=belt_axis, position=[0., 0., 0.], hostStarIndex=0, seed=seed, count=1400,
                          dataClass='illustrative-particles-observed-belt', provenance=source,
                          description='Observed belt region; individual displayed particles are deterministic illustrations, not cataloged object positions',
                          limitations='Approximate main-region radial span; excludes scattered/detached populations and orbital substructure'))
    systems[0]['belts'] = belts
    apply_appearances(bodies)
    result = dict(version=1, epoch="J2000.0", julianDateTDB=2451545., units="parsec",
        frame="heliocentric ICRF; HYG equatorial J2000 star coordinates treated as aligned at displayed precision",
        epochScope="Solar-system centers and HYG stellar reference frame; exoplanet offsets are illustrative and have no observation epoch",
        systems=systems, bodies=bodies, belts=belts, stellarDestinations=stellar, sources=sources, moonRegistry=moon_registry,
        license="CC BY-SA 4.0; this metadata includes adapted HYG positions. Individual source credits are retained.",
        counts={"solarPlanets": 8, "dwarfPlanets": 5, "selectedMoons": sum(b["kind"] == "moon" for b in bodies),
                "moonsWithPublishedRadii": 46, "dwarfCompanionsWithPublishedRadiusEstimates": 4, "moonsWithIllustrativeRadii": 415, "confirmedExoplanets": 4, "selectedAsteroids": 6, "selectedComets": 2, "stellarDestinations": len(stellar), "observedBeltRegions": len(belts)},
        conversions={"kilometersPerParsec": KM_PER_PC, "parsecsPerAU": PC_PER_AU,
                     "exoplanetEarthRadiusKm": EARTH_NOMINAL_KM, "nominalJupiterRadiusKm": JUPITER_NOMINAL_KM,
                     "reference": "https://arxiv.org/abs/1510.07674"},
        credits=[{"name": "NASA/JPL Horizons", "url": "https://ssd.jpl.nasa.gov/horizons/"},
                 {"name": "NASA Exoplanet Archive; operated by Caltech under NASA contract through the Exoplanet Exploration Program", "url": "https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html", "datasetDOI": "10.26133/NEA12"},
                 {"name": "HYG v4.2 / Astronomy Nexus", "url": "https://www.astronexus.com/projects/hyg", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/"}],
        limitations=["Solar-system bodies remain at fixed positions; animation is not orbital time evolution. Eight planets, five dwarfs, 46 moons and eight selected minor bodies use geometric Horizons J2000 states; other moon positions are approximate",
                     "46 moons have published mean radii; 415 others use clearly marked illustrative 2 km radii. Phobos and Deimos use approximate ellipsoids; other topographic heights and oblateness are not represented",
                     "Exoplanets are confirmed objects, but scene orbital plane, phase, rotation and appearance are authored illustrations",
                     "Proxima b and 51 Pegasi b use explicitly unmeasured illustrative radii; no surface or habitability claim is made",
                     "Selected exoplanet hosts retain HYG distances; catalog uncertainties and stellar motion are not propagated",
                     "Moon coverage follows the cached JPL tables plus two published Saturn ring moonlets; four additional dwarf-planet companions use published scale estimates with authored phase; later discoveries and other minor-planet satellites are not a complete census",
                     "Asteroid and comet nuclei use published effective diameters; coma/tail activity and surface appearance are illustrative, not observations at the displayed historical position",
                     "Two-body propagation of mean elements omits perturbations and precession; orbital phases are approximate and the two extra ring-moonlet phases are authored",
                     "Only selected confirmed exoplanets and stellar destinations are included; absence is not evidence an object does not exist"])
    validate(result)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()
    atomic_write(output, data)
    atomic_write(output.with_suffix(output.suffix + ".gz"), gzip.compress(data, compresslevel=9, mtime=0))
    return result


def atomic_write(path, payload):
    """Readers see the old or complete new artifact, never a partial JSON/stream."""
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def validate(data):
    indices, ids = set(), set()
    for body in data["bodies"]:
        if body["index"] in indices or body["id"] in ids or body["index"] >= -1:
            raise ValueError("Duplicate or invalid body identifier")
        indices.add(body["index"])
        ids.add(body["id"])
        for key in ("position", "hostPosition", "axis"):
            if len(body[key]) != 3 or not all(math.isfinite(v) for v in body[key]):
                raise ValueError(f"Invalid body {key}")
        if not math.isfinite(body["radiusPc"]) or body["radiusPc"] <= 0:
            raise ValueError("Invalid radius")
        if not math.isclose(math.dist(body["axis"], [0, 0, 0]), 1., abs_tol=1e-12):
            raise ValueError("Axis is not normalized")
    for body in data["bodies"]:
        if body["kind"] == "moon" and body["parentId"] not in ids:
            raise ValueError("Moon references a missing parent")
        if "shape" in body and (len(body["shape"]) != 3 or not all(math.isfinite(v) and v > 0 for v in body["shape"])):
            raise ValueError("Invalid body shape")
    for system in data["systems"]:
        if not set(system["bodyIds"]) <= ids:
            raise ValueError("System references a missing body")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    data = compile_systems(args.output, args.refresh)
    print(json.dumps(data["counts"], indent=2))
    print(f"Compiled {len(data['bodies'])} bodies and {len(data['systems'])} systems → {args.output}")
