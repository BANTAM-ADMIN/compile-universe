#!/usr/bin/env python3
"""Independent native previews of compiled minor bodies and a real occultation."""
import ctypes as ct
import json
import math
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'tests'))
from test_atlas_renderer import NativeAtlas


def main():
    data = json.loads((ROOT / 'artifacts/systems.json').read_text())
    bodies = {body['id']: body for body in data['bodies']}
    engine = NativeAtlas((ROOT / 'artifacts/atlas.bin').read_bytes())
    engine.lib.atlas_set_body_comet.argtypes = [ct.c_int, ct.c_double, ct.c_double]
    assets = {}
    def asset(texture):
        if texture['url'] not in assets:
            assets[texture['url']] = ct.create_string_buffer((ROOT / texture['url'].lstrip('/')).read_bytes())
        return assets[texture['url']]
    for body in bodies.values():
        atmosphere = body.get('atmosphere', {})
        ring = body.get('ring', {})
        params = (ct.c_double * 21)(*body['position'], body['radiusPc'], *body['hostPosition'], *body['axis'],
                    body.get('primeMeridian', 0), body.get('rotationRate', 0), ring.get('innerRadius', 0),
                    ring.get('outerRadius', 0), body.get('comet', {}).get('tailLengthRadii', 0),
                    {'rocky':0, 'gas':1, 'ice':2, 'lava':3, 'water':4, 'comet':5}[body['appearanceKind']],
                    atmosphere.get('strength', 0), *atmosphere.get('color', [.08, .4, 1]), body['parentStarIndex'])
        texture = body['texture']
        assert engine.lib.atlas_add_body(body['index'], params, asset(texture), texture['width'], texture['height'],
                                        asset(ring['texture']) if ring else None, ring.get('texture', {}).get('width', 0)) == 0
        if 'shape' in body:
            assert engine.lib.atlas_set_body_shape(body['index'], *body['shape']) == 0
        if 'comet' in body:
            assert engine.lib.atlas_set_body_comet(body['index'], 50., 3.) == 0

    cols, rows = 160, 80
    def render(body, camera):
        toward = np.array(body['position']) - camera
        yaw, pitch = math.atan2(toward[0], toward[2]), math.atan2(toward[1], math.hypot(toward[0], toward[2]))
        output, _ = engine.frame(position=camera, yaw=yaw, pitch=pitch, cols=cols, rows=rows, time=0)
        stats = np.ctypeslib.as_array(engine.lib.atlas_stats(), shape=(24,)).copy()
        mask = np.array([engine.lib.atlas_pick((x+.5)/cols, (y+.5)/rows) == body['index']
                         for y in range(rows) for x in range(cols)])
        # Brightness includes the actual per-cell foreground and background bytes.
        fg = output[cols*rows:cols*rows*4].reshape(-1, 3)
        bg = output[cols*rows*4:].reshape(-1, 3)
        brightness = float((fg[mask].astype(float) + bg[mask]).mean()) if mask.any() else 0.
        return dict(centerPick=engine.lib.atlas_pick(.5, .5), targetCells=int(mask.sum()),
                    meanTargetRGB=brightness, frameMs=float(stats[0]), surfaceCells=int(stats[7]),
                    visibleBodies=int(stats[14]), cometCells=int(stats[20]), glyphHash=int(np.sum(output[:cols*rows]))), output

    reports = []
    for ident in ('vesta','pallas','eros','bennu','ryugu','itokawa','halley','67p','phobos'):
        body = bodies[ident]
        center = np.array(body['position'])
        light = np.array(body['hostPosition']) - center
        light /= np.linalg.norm(light)
        tangent = np.cross(body['axis'], light)
        tangent /= np.linalg.norm(tangent)
        direction = .92 * light + .39 * tangent
        direction /= np.linalg.norm(direction)
        distance = body['radiusPc'] * max(body.get('shape', [1])) * 3.5
        day, output = render(body, center + distance * direction)
        night, _ = render(body, center - distance * direction)
        assert day['centerPick'] == body['index'], (ident, day)
        assert day['targetCells'] >= 10, (ident, day)
        # Coma cells share the comet pick ID and remain emissive in the authored
        # activity model; only the sign of the phase response is asserted there.
        contrast = 1.0 if body['kind'] == 'comet' else 1.5
        assert day['meanTargetRGB'] > night['meanTargetRGB'] * contrast, (ident, day, night)
        shape_cells_changed = None
        if 'shape' in body:
            assert engine.lib.atlas_set_body_shape(body['index'], 1., 1., 1.) == 0
            sphere, spherical_output = render(body, center + distance * direction)
            shape_cells_changed = int(np.count_nonzero(output != spherical_output))
            assert shape_cells_changed > 50, ident
            assert engine.lib.atlas_set_body_shape(body['index'], *body['shape']) == 0
        default_comet_view = None
        if body['kind'] == 'comet':
            side = .25 * light + .97 * tangent
            side /= np.linalg.norm(side)
            default_comet_view, _ = render(body, center + side * distance / 3.5 * body['viewDistanceRadii'])
            assert default_comet_view['centerPick'] == body['index']
            assert default_comet_view['cometCells'] > 0, (ident, default_comet_view)
        reports.append(dict(id=ident, radiusKm=body['radiusKm'], day=day, night=night,
                            shapeChangedBytes=shape_cells_changed, defaultCometView=default_comet_view))

    mars, phobos = bodies['mars'], bodies['phobos']
    direction = np.array(phobos['position']) - mars['position']
    direction /= np.linalg.norm(direction)
    camera = np.array(mars['position']) - direction * mars['radiusPc'] * 10
    occulted, _ = render(phobos, camera)
    assert occulted['centerPick'] == mars['index'], occulted
    assert occulted['targetCells'] == 0, occulted
    result = dict(bodyCount=len(bodies), previews=reports, phobosBehindMars=occulted, passed=True)
    (ROOT / 'artifacts/minor-body-previews.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
