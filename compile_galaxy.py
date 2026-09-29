#!/usr/bin/env python3
"""Compile seeded three-dimensional Galactic light samples.

The default product is a spatial point pack, not a panorama. Individual sample
positions and light weights are authored, not measured star records. A legacy
panorama compiler remains available for component-reference compatibility.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT, SEED, SCALE = 1024, 512, 261026, 4.0
SPATIAL_SEED = 261027
ICRS_TO_GALACTIC = np.array([
    [-.0548755604162154, -.8734370902348850, -.4838350155487132],
    [ .4941094278755837, -.4448296299600112,  .7469822444972189],
    [-.8676661490190047, -.1980763734312015,  .4559837761750669],
])


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def panorama() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    lon = ((np.arange(WIDTH) + .5) / WIDTH - .5) * (2 * np.pi)
    lat = (.5 - (np.arange(HEIGHT) + .5) / HEIGHT) * np.pi
    longitude, latitude = np.meshgrid(lon, lat)
    # Spherical waves keep the longitude seam and poles continuous.
    sphere = np.stack((np.cos(latitude) * np.cos(longitude),
                       np.cos(latitude) * np.sin(longitude),
                       np.sin(latitude)), axis=-1)
    coarse = np.zeros((HEIGHT, WIDTH))
    fine = np.zeros_like(coarse)
    for octave in range(19):
        axis = rng.normal(size=3)
        axis *= (3.5 * 1.39 ** octave) / np.linalg.norm(axis)
        wave = np.sin(sphere @ axis + rng.uniform(0, 2 * np.pi))
        coarse += wave * .76 ** octave
        if octave > 4:
            fine += wave * .84 ** (octave - 5)
    texture = np.clip(.7 + .25 * coarse, .15, 1.7)
    # Galactic latitude zero is the disk's center; these small corrugations
    # and obscuring lanes are authored, not an inferred Milky Way geometry.
    center = .018 * np.sin(longitude * 3) + .009 * np.sin(longitude * 7)
    band = np.exp(-((latitude - center) / .19) ** 2)
    broad = np.exp(-((latitude - center) / .43) ** 2)
    lane_center = center + .013 * fine
    dust = np.exp(-((latitude - lane_center) / (.027 + .009 * texture)) ** 2)
    side_lane = np.exp(-((latitude - center - .09 - .018 * coarse) / .025) ** 2)
    transmission = np.clip(1 - .77 * dust - .24 * side_lane, .1, 1)
    center_weight = np.exp(-(longitude / 1.25) ** 2)
    warm = np.clip(.40 + .22 * coarse + .20 * center_weight, 0, 1)[..., None]
    color = np.array([.078, .073, .16]) * (1 - warm) + np.array([.23, .155, .078]) * warm
    sky = np.broadcast_to(np.array([.001, .002, .004]), (HEIGHT, WIDTH, 3)).copy()
    sky += broad[..., None] * np.array([.012, .016, .032]) * .25
    sky += (band * texture * transmission * (1 + .28 * center_weight))[..., None] * color * .45
    wisps = np.exp(-((latitude + .21 + .06 * np.sin(longitude * 2)) / .12) ** 2)
    sky += (wisps * np.maximum(coarse, 0))[..., None] * np.array([.011, .027, .035])

    # Each source is integrated into several texels offline. These decorative
    # stars are not selectable and must never receive HYG catalog labels.
    count = 24000
    star_lon = rng.uniform(-np.pi, np.pi, count)
    star_lat = np.arcsin(rng.uniform(-1, 1, count))
    clustered = rng.random(count) < .57
    star_lat[clustered] = np.clip(rng.normal(0, .17, clustered.sum()), -1.5, 1.5)
    x = (star_lon / (2 * np.pi) + .5) * WIDTH - .5
    y = (.5 - star_lat / np.pi) * HEIGHT - .5
    brightness = np.minimum(.07 / rng.uniform(.025, 1, count) ** 1.3, 4)
    palette = np.array([[.59, .72, 1], [.86, .91, 1], [1, .86, .63], [1, .56, .30]])
    colors = palette[rng.choice(4, count, p=[.25, .33, .33, .09])]
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            ix, iy = np.floor(x).astype(int) + dx, np.floor(y).astype(int) + dy
            power = np.exp(-((ix - x) ** 2 + (iy - y) ** 2) / .58)
            valid = (iy >= 0) & (iy < HEIGHT)
            np.add.at(sky, (iy[valid], ix[valid] % WIDTH),
                      colors[valid] * (brightness[valid] * power[valid])[:, None])
    return sky.astype(np.float32)


def compile_galaxy(destination: Path = ROOT / 'artifacts/galaxy.bin') -> dict:
    """Reproduce the retained angular component-reference asset."""
    destination = Path(destination)
    sky = panorama()
    assert np.isfinite(sky).all() and np.min(sky) >= 0
    encoded = np.rint(np.clip(sky / SCALE, 0, 1) * 255).astype(np.uint8)
    blob = encoded.tobytes()
    atomic_write(destination, blob)
    atomic_write(destination.with_suffix(destination.suffix + '.gz'), gzip.compress(blob, compresslevel=9, mtime=0))
    decoded = encoded.astype(np.float32) * (SCALE / 255)
    metadata = {
        'version': 1, 'width': WIDTH, 'height': HEIGHT, 'channels': 3,
        'format': 'RGB8, no header, row-major; decoded linear RGB = byte * (4 / 255)',
        'linearScale': SCALE, 'bytes': len(blob), 'seed': SEED,
        'sha256': hashlib.sha256(blob).hexdigest(),
        'compilerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'coordinates': 'Galactic angular axes; u = longitude / (2*pi) + 0.5, periodic; v = 0.5 - latitude / pi; row 0 north; longitude zero at image center',
        'dataClass': 'authored illustrative Galactic context',
        'source': 'Deterministic spherical waves and 24000 authored unresolved sources; no telescope image or measured catalog used',
        'description': 'A dusty warm/violet/cyan angular disk with gentle central enhancement. The separate runtime spatial core supplies the approaching Galactic bulge.',
        'limitations': 'Not a Milky Way reconstruction or calibrated radiance map. Decorative points have no measured positions, distances, names or proper motions. The distant angular field supplies visual context, not galactic-scale parallax.',
        'decodedMeanRGB': decoded.mean((0, 1)).astype(float).tolist(),
        'decodedPeakQuantiles': np.quantile(decoded.max(-1), [.1, .5, .9, .99]).tolist(),
        'preview': 'Tone-mapped inspection image only; runtime reads galaxy.bin',
    }
    json_bytes = (json.dumps(metadata, indent=2) + '\n').encode()
    atomic_write(destination.with_suffix('.json'), json_bytes)
    atomic_write(destination.with_suffix('.json.gz'), gzip.compress(json_bytes, compresslevel=9, mtime=0))
    preview = np.rint(np.sqrt(1 - np.exp(-decoded * 2.2)) * 255).astype(np.uint8)
    Image.fromarray(preview).save(destination.with_name(destination.stem + '-preview.png'))
    return metadata


def spatial_samples() -> np.ndarray:
    """Return row-major [ICRS xyz pc relative SgrA, light proxy, RGB, group]."""
    rng = np.random.default_rng(SPATIAL_SEED)
    counts = (32000, 16000, 12000)
    points, lights, colors, groups = [], [], [], []

    # Six authored streams spread samples through a flattened spiral disk.
    # The number/pitch/phases are display choices, not measured Galactic arms.
    count = counts[0]
    r = np.clip(rng.gamma(2.3, 2250, count), 250, 15000)
    arm = rng.integers(0, 6, count)
    theta = arm * (2 * np.pi / 6) + np.log(r / 2400) / np.tan(np.deg2rad(14))
    theta += rng.normal(0, .13, count)
    # A minority of inter-arm points avoids artificial empty channels.
    interarm = rng.random(count) < .23
    theta[interarm] = rng.uniform(0, 2 * np.pi, interarm.sum())
    z = np.clip(rng.normal(0, 65 + .012 * r), -1000, 1000)
    points.append(np.column_stack((r * np.cos(theta), r * np.sin(theta), z)))
    lights.append(np.clip(2e5 * 10 ** rng.normal(0, .58, count), 3500, 8e6))
    palette = np.array([[.62,.77,1], [.83,.91,1], [1,.88,.69], [1,.67,.40]])
    colors.append(palette[rng.choice(4, count, p=[.27,.34,.29,.10])])
    groups.append(np.zeros(count))

    # An authored compact triaxial distribution, represented only by points.
    # This is not a fitted Galactic bar/bulge model or additive emission volume.
    count = counts[1]
    direction = rng.normal(size=(count, 3))
    direction /= np.linalg.norm(direction, axis=1)[:, None]
    radius = np.clip(rng.gamma(2.4, 270, count), 8, 2700)
    p = direction * radius[:, None] * [1.0, .62, .40]
    angle = .42
    p[:, :2] = p[:, :2] @ np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
    points.append(p)
    lights.append(np.clip(2e4 * 10 ** rng.normal(0, .62, count), 350, 9e5))
    colors.append(palette[rng.choice(4, count, p=[.05,.14,.52,.29])])
    groups.append(np.ones(count))

    # Resolve the inner neighborhood with low-weight samples instead of
    # giving all nuclear points the large aggregate weights of distant arms.
    # Log radius supplies continuous coverage across 0.1..10 parsecs.
    count = counts[2]
    direction = rng.normal(size=(count, 3))
    direction /= np.linalg.norm(direction, axis=1)[:, None]
    radius = np.exp(rng.uniform(np.log(.1), np.log(10), count))
    points.append(direction * radius[:, None])
    lights.append(np.clip(.004 * 10 ** rng.normal(0, .68, count), 2e-5, .3))
    colors.append(palette[rng.choice(4, count, p=[.23,.36,.31,.10])])
    groups.append(np.full(count, 2))

    galactic = np.concatenate(points)
    # For row vectors, Galactic->ICRS uses the inverse rotation's transpose.
    # The matrix is orthogonal, therefore this row-vector product is correct.
    icrs = galactic @ ICRS_TO_GALACTIC
    result = np.column_stack((icrs, np.concatenate(lights), np.concatenate(colors), np.concatenate(groups))).astype('<f4')
    if result.shape != (60000, 8) or not np.isfinite(result).all():
        raise ValueError('Invalid spatial Galactic samples')
    return result


def compile_spatial_galaxy(destination: Path = ROOT / 'artifacts/galaxy-stars.bin') -> dict:
    destination = Path(destination)
    samples = spatial_samples()
    blob = samples.tobytes()
    atomic_write(destination, blob)
    compressed = gzip.compress(blob, compresslevel=9, mtime=0)
    atomic_write(destination.with_suffix(destination.suffix + '.gz'), compressed)
    anchors = json.loads((ROOT / 'artifacts/phenomena-destinations.json').read_text())
    center = next(item for item in anchors['destinations'] if item['id'] == 'sagittarius-a')
    metadata = {
        'version': 1, 'count': len(samples), 'stride': 32, 'components': 8,
        'format': 'Headerless little-endian float32 rows [x_pc, y_pc, z_pc, light_proxy, red, green, blue, group]',
        'url': '/artifacts/galaxy-stars.bin', 'bytes': len(blob), 'gzipBytes': len(compressed),
        'sha256': hashlib.sha256(blob).hexdigest(), 'seed': SPATIAL_SEED,
        'compilerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'coordinates': 'Fixed ICRS Cartesian offsets from Sagittarius A*, parsecs. World position = centerPc + xyz. Same equatorial axes as the HYG atlas.',
        'centerId': 'sagittarius-a', 'centerPc': center['position'],
        'orientationSource': 'https://github.com/liberfa/erfa/blob/master/src/icrs2g.c',
        'groups': [
            {'id': 0, 'name': 'authored-disk-streams', 'count': 32000, 'radialExtentPc': [250, 15000], 'maximumHeightPc': 1000, 'streams': 6, 'pitchDegrees': 14, 'medianLightProxy': 2e5},
            {'id': 1, 'name': 'authored-central-concentration', 'count': 16000, 'maximumEllipsoidSemiaxesPc': [2700, 1674, 1080], 'medianLightProxy': 2e4},
            {'id': 2, 'name': 'authored-nuclear-neighborhood', 'count': 12000, 'radialExtentPc': [.1, 10], 'medianLightProxy': .004},
        ],
        'dataClass': 'seeded illustrative three-dimensional Milky Way light samples',
        'lightConvention': 'Relative linear light proxy: suggested contribution light_proxy / distance_pc^2, with finite camera-near softening and display saturation. Values are exposure weights for aggregate samples, not solar luminosities, absolute magnitudes or stellar masses.',
        'source': 'Coordinates, colors and light weights are deterministically authored. No measured source catalog or telescope image is used for these samples.',
        'morphologyContext': {'url': 'https://supernova.eso.org/exhibition/1004/?lang=en', 'note': 'Primary educational source supports only the broad disk/spiral/central-concentration context. Exact sample positions, six streams, dimensions and colors here are not an observational fit.'},
        'limitations': 'These samples are not individual cataloged stars and have no measured names, radii, proper motions or orbits. Their fixed three-dimensional positions support actual camera-relative parallax and distance fading. This coarse point representation is not a calibrated Milky Way census, extinction model or dynamically evolving galaxy.',
    }
    payload = (json.dumps(metadata, indent=2) + '\n').encode()
    atomic_write(destination.with_suffix('.json'), payload)
    atomic_write(destination.with_suffix('.json.gz'), gzip.compress(payload, compresslevel=9, mtime=0))
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--legacy-panorama', action='store_true', help='Rebuild the retained angular component-reference asset instead')
    arguments = parser.parse_args()
    build = compile_galaxy if arguments.legacy_panorama else compile_spatial_galaxy
    default = 'galaxy.bin' if arguments.legacy_panorama else 'galaxy-stars.bin'
    print(json.dumps(build(arguments.out or ROOT / 'artifacts' / default), indent=2))
