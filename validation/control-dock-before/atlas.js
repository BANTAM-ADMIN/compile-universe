import { GlyphDisplay } from './glyph-display.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const PC_KM = 3.085677581491367e13;
const AU_PC = Math.PI / (180 * 3600);
const SOLAR_RADIUS_PC = 2.25461e-8;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { cols: 220, rows: 94, position: [0, 0, 0], yaw: 0, pitch: 0, roll: 0,
  fov: 50, time: 0, earthUtcMs:Date.now(), exposure: 1, surveyMode: 1, surveyGain: 1, selectedIndex: -2 };
let earthClockOffset=0,earthClockHeld=state.earthUtcMs;
const metrics = { frames: 0, computeMs: 0, displayMs: 0, workerRoundtripMs: 0,
  frameIntervals: [], computeTimes: [], displayTimes: [], inputLatencyMs: [] };
const keys = new Set(), pointers = new Map(), byIndex = new Map();
// Catalog identities survive filtering and packing; native array offsets do not.
const landmarks = {
  sun: { hyg: 0, name: 'Sun' },
  polaris: { hyg: 11734, hip: 11767, name: 'Polaris' },
  pleiades: { hyg: 17661, hip: 17702, name: 'Alcyone' },
  betelgeuse: { hyg: 27919, hip: 27989, name: 'Betelgeuse' },
  sirius: { hyg: 32263, hip: 32349, name: 'Sirius' },
  proxima: { hyg: 70666, hip: 70890, name: 'Proxima Centauri' },
  alphaB: { hyg: 71453, hip: 71681, name: 'Alpha Centauri B' },
  alpha: { hyg: 71456, hip: 71683, name: 'Alpha Centauri A' },
};
const namedIndex = {}, knownNames = {};
function resolveLandmarks(records) {
  for (const key of Object.keys(namedIndex)) delete namedIndex[key];
  for (const key of Object.keys(knownNames)) delete knownNames[key];
  for (const [key, landmark] of Object.entries(landmarks)) {
    const record = records.find(star => String(star.id) === String(landmark.hyg)) ||
      (landmark.hip ? records.find(star => Number(star.hip) === landmark.hip) : null);
    if (record) { namedIndex[key] = record.index; knownNames[record.index] = landmark.name; }
  }
}
let phenomena = [], preparedScenes = new Map(), preparingIntent = 0, failedDestination = null;
let stars = [], earth = null, sun = null, selected = null, searchDocument = null;
let systemsDocument = null, systems = [], bodies = [], previewed = null, activeCategory = 'solar', activeSystemId = '', arrivalView = 'day';
const byId = new Map();
let resumeTarget = null, currentPrimaryTarget = null;
let surfaceMetadata = {}, fixedBodies = [], mapScene = null, cameraSystemHost = null, mapListLimit = 36;
let generatorModule = null, registrationPending = false, registrationQueue = Promise.resolve(), registrationSignature = '', journeyIntent = 0;
const generatedSystems = new Map(), registrationRequests = new Map(), registrationPins = new Map();
let worker = null, workerReady = false, sceneReady = false, pending = null, ticketId = 0;
let presenter = null, latestFrame = null, latestStats = null, lastSignature = '', generation = 0;
let paused = false, mode = 'orbit', orbit = { radius: 1, targetRadius: 1, azimuth: 0, elevation: 0 };
let travel = null, flightSpeed = 1e-9, dragOrigin = null, pinchDistance = 0;
let tour = null;
const tourStops = [
  {id:'earth',title:'A world that glows',view:'night',hold:12,sweep:.32,caption:'The night side of home. NASA’s 2016 Black Marble traces observed lights across the continents.'},
  {id:'moon',title:'Across the quiet sea',hold:8,sweep:.25,caption:'Our nearest companion: ancient impact basins and bright highlands, mapped by NASA’s lunar cameras.'},
  {id:'saturn',title:'A planet wearing sunlight',hold:12,sweep:.38,caption:'The main C, B and A rings, at their published radial bounds. Ice, gaps and a vast, banded world.'},
  {id:'67p',title:'A small world, a long shadow',hold:9,sweep:.35,caption:'Comet 67P: a cataloged destination with an imagined active coma and a tail swept away from the Sun.'},
  {id:'betelgeuse-study',title:'The restless giant',hold:12,sweep:.3,caption:'A photosphere larger than your view. Scroll out to find its edge. The boiling surface illustrates convection, not an imminent explosion.'},
  {id:'vfts-352',title:'Two suns, one embrace',hold:12,sweep:.35,caption:'A real overcontact binary in the Large Magellanic Cloud. Its surrounding stars have observed Gaia sky positions; their depths are reconstructed.'},
  {id:'crab-pulsar',title:'The heart of an explosion',hold:12,sweep:.22,caption:'A compact stellar remnant inside the Crab Nebula. The rotating beams and glowing remnant are illustrative views of a real pulsar.'},
  {id:'orion-nebula',title:'Where new stars begin',hold:12,sweep:.28,caption:'A stellar nursery in Orion. Fly through an interpreted emission field anchored to the observed nebula’s location.'},
  {id:'sagittarius-a',title:'The center holds',hold:18,sweep:.4,caption:'The Milky Way’s central black hole. Compiled Schwarzschild optics bend the surrounding Galactic light around an illustrative accretion disk.'},
];
let width = innerWidth, height = innerHeight, displayBox = { left: 0, top: 0, width, height };
let density = 'adaptive', quality = 1, costAverage = 0, lastQualityChange = 0;
let displayMode = 'accelerated', lastRequestAt = -Infinity, lastDisplayAt = 0, lastHudAt = 0;
let lastTick = performance.now(), acceptedInputAt = 0, inputSerial = 0, displayedInputSerial = 0;
let initPromise = null, labelButtons = new Map(), showLabels = true, textRows = [];
const fmt = new Intl.NumberFormat('en-US');
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const length = vector => Math.hypot(...vector);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, value) => a.map(v => v * value);
const normalize = a => scale(a, 1 / Math.max(length(a), 1e-30));
const smooth = t => t * t * (3 - 2 * t);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function remember(array, value) { array.push(value); if (array.length > 240) array.shift(); }
function input() { acceptedInputAt = performance.now(); inputSerial++; }
function invalidate() { generation++; lastSignature = ''; }
function setText(id, value) { const element = $(id); if (element.textContent !== value) element.textContent = value; }
function showError(message) { $('error-message').textContent = message; $('error').hidden = false; }
function friendly(record) { return knownNames[record.index] || record.name || `Catalog star ${record.id ?? record.index}`; }
function radius(record) { return Number(record?.radius_pc ?? record?.radiusPc) || Number(record?.radius_solar || 1) * SOLAR_RADIUS_PC; }
function distanceLabel(pc, compact = false) {
  const km = Math.max(0, pc) * PC_KM;
  if (km < 1) return { value: fmt.format(Math.round(km * 1000)), unit: compact ? 'm' : 'METERS' };
  if (km < 1e6) return { value: fmt.format(Math.round(km)), unit: compact ? 'km' : 'KILOMETERS' };
  const au = pc / AU_PC;
  if (au < 1000) return { value: au.toFixed(au < 10 ? 2 : 1), unit: compact ? 'AU' : 'ASTRONOMICAL UNITS' };
  const ly = pc * 3.261563777;
  if (ly >= 1e9) return { value: (ly / 1e9).toFixed(3), unit: compact ? 'Gly' : 'BILLION LIGHT-YEARS' };
  if (ly >= 1e6) return { value: (ly / 1e6).toFixed(2), unit: compact ? 'Mly' : 'MILLION LIGHT-YEARS' };
  return { value: ly.toFixed(ly < 10 ? 3 : ly < 100 ? 2 : 1), unit: compact ? 'ly' : 'LIGHT-YEARS' };
}
function compactDistance(pc) { const d = distanceLabel(pc, true); return `${d.value} ${d.unit}`; }
function alignTo(target) {
  const d = sub(target, state.position), horizontal = Math.hypot(d[0], d[2]);
  if (length(d) < 1e-24) return;
  state.yaw = Math.atan2(d[0], d[2]); state.pitch = Math.atan2(d[1], horizontal);
}
function cameraBasis() {
  const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw), sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);
  const forward=[sy*cp,sp,cy*cp],r=[-cy,0,sy],v=cross(r,forward),c=Math.cos(state.roll),s=Math.sin(state.roll);
  return { forward, right:add(scale(r,c),scale(v,s)), up:sub(scale(v,c),scale(r,s)) };
}
function syncOrbit() {
  if (!selected) return;
  const ce = Math.cos(orbit.elevation);
  state.position = add(selected.position, [orbit.radius * Math.sin(orbit.azimuth) * ce,
    orbit.radius * Math.sin(orbit.elevation), orbit.radius * Math.cos(orbit.azimuth) * ce]);
  let target = selected.position;
  if (selected.kind === 'comet') {
    const pull = radius(selected) * 12 * smooth(clamp((orbit.radius / radius(selected) - 4) / 18, 0, 1));
    target = add(target, scale(normalize(sub(selected.position, selected.hostPosition || sun.position)), pull));
  }
  alignTo(target);
}
function orbitFromCamera() {
  const d = sub(state.position, selected.position), distance = length(d);
  const cameraRadius = Math.max(minimumOrbitRadius(selected), distance);
  orbit = { radius: cameraRadius, targetRadius: cameraRadius,
    azimuth: Math.atan2(d[0], d[2]), elevation: clamp(Math.asin(d[1] / Math.max(distance, 1e-25)), -1.48, 1.48) };
}
function setMode(value) {
  if (value === mode) return;
  mode = value;
  if (mode === 'orbit' && selected) { orbitFromCamera(); syncOrbit(); }
  updateMode(); invalidate();
}
function updateMode() {
  $('mode-toggle').setAttribute('aria-pressed', String(mode === 'free'));
  setText('mode-button-label', mode === 'orbit' ? 'Orbit' : 'Free flight');
  setText('navigation-hint', mode === 'orbit' ? 'DRAG TO ORBIT · SCROLL TO APPROACH' : 'W A S D TO FLY · SCROLL TO CHANGE SPEED');
  setText('navigation-mode', travel ? 'TRAVEL IN PROGRESS' : mode === 'orbit' ? `ORBITING ${selected ? friendly(selected).toUpperCase() : 'EARTH'}` : 'FREE FLIGHT');
}
function isPhenomenon(record) { return record?.sceneKind === 'phenomenon' || record?.sceneKind === 'blackhole'; }
function isStellarSurface(record) { return !!record && record.kind!=='region' && (!isBody(record) || record.stellarSurface===true); }
function minimumOrbitRadius(record) { if(record?.kind==='region')return .01;return radius(record) * (isPhenomenon(record) ? (Number(record.minimumViewRadius) ? Number(record.minimumViewRadius) + 1e-4 : 0) || (record.sceneKind === 'blackhole' ? 6.051 : .02) : 1.04); }
function navigationRadius(record) { if(record?.kind==='region')return 0;return radius(record) * (record?.sceneKind === 'blackhole' ? Number(record.minimumViewRadius) || 6.05 : 1); }
function isBody(record) { return record && record.index < -1; }
function bodyKind(record) { return String(record?.kind || record?.type || (isBody(record) ? 'world' : 'star')).replaceAll('_', ' '); }
function getSystem(record) {
  if (!record) return null;
  return systems.find(system => system.bodyIds?.includes(record.id) || system.hostStarIndex === record.index || system.id === record.systemId) || null;
}
function childrenOf(record) {
  if (!record || isPhenomenon(record)) return [];
  if (!isBody(record)) return bodies.filter(body => body.parentStarIndex === record.index && !String(body.kind).includes('moon'));
  return bodies.filter(body => String(body.parentId) === String(record.id));
}
function subjectContext(record) {
  if (isPhenomenon(record)) return record.sceneKind === 'blackhole' ? 'THE GALACTIC CENTER' : record.context || 'PHENOMENA OF THE REAL SKY';
  const parent = byId.get(String(record?.parentId));
  if (parent && parent.index !== namedIndex.sun) return `${friendly(parent).toUpperCase()} SYSTEM`;
  const system = getSystem(record);
  return system ? system.name.toUpperCase() : record?.index === namedIndex.sun ? 'SOLAR SYSTEM' : 'THE STELLAR NEIGHBORHOOD';
}
function appearanceLabel(record) {
  if (isPhenomenon(record)) return 'REAL OBJECT · ILLUSTRATIVE CLOSEUP';
  if(record?.kind==='region')return 'GAIA SKY POSITIONS · RECONSTRUCTED DEPTH';
  if (record?.generated || record?.index <= -100000) return 'GENERATED WORLD · NOT AN OBSERVED PLANET';
  if (!isBody(record)) return record.gaia_id?(record.flags&64?'OBSERVED SKY · RECONSTRUCTED DEPTH':'GAIA ASTROMETRY · ILLUSTRATIVE SURFACE'):'ILLUSTRATIVE PHOTOSPHERE';
  if (record.kind === 'comet') return 'J2000 POSITION · ILLUSTRATIVE ACTIVITY';
  if (record.index === -2 || String(surfaceMetadata?.surfaces?.[record.id]?.appearanceClass).includes('NASA')) return 'NASA MAP · J2000 POSITION';
  const cls = String(record.dataClass || record.classification || '').toLowerCase();
  if (String(record.kind).includes('exo') || cls.includes('exoplanet') || cls.includes('confirmed')) return 'CONFIRMED WORLD · IMAGINED SURFACE';
  if (/approximate|mean.element/i.test(String(record.positionDataClass || '') + ' ' + String(record.dataClass || ''))) return 'APPROXIMATE ORBIT · ILLUSTRATIVE VIEW';
  return 'J2000 POSITION · ILLUSTRATIVE VIEW';
}
function suggestedNext(record) {
  if(record?.kind==='region')return byId.get('vfts-352')||earth;
  if (isPhenomenon(record)) return phenomena[(phenomena.findIndex(item => item.index === record.index) + 1) % phenomena.length] || earth;
  const nextWorld = { earth: 'moon', moon: 'mars', mercury: 'venus', venus: 'earth', mars: 'jupiter', jupiter: 'europa', europa: 'saturn', saturn: 'titan', titan: 'enceladus', enceladus: 'neptune', uranus: 'neptune', neptune: 'proxima-b' }[record?.id];
  if (nextWorld && byId.has(nextWorld)) return byId.get(nextWorld);
  const children = childrenOf(record);
  const preferred = ['moon', 'europa', 'titan', 'proxima-b'];
  for (const id of preferred) { const child = children.find(body => body.id === id); if (child) return child; }
  if (children.length) return children[0];
  if (record?.parentId && byId.has(String(record.parentId))) return byId.get(String(record.parentId));
  if (record?.index === -2) return byIndex.get(namedIndex.alpha);
  if (record?.index === namedIndex.alpha) return byIndex.get(namedIndex.alphaB);
  if (record?.index === namedIndex.alphaB) return byIndex.get(namedIndex.proxima);
  if (record?.index === namedIndex.sun) return earth;
  return bodies.find(body => body.id === 'saturn') || earth;
}
function updatePrimaryAction() {
  if (!selected) return;
  const near = length(sub(state.position, selected.position)) < minimumDistance(selected) * 1.8;
  currentPrimaryTarget = near ? suggestedNext(selected) : selected;
  $('primary-journey').disabled = !currentPrimaryTarget;
  setText('primary-journey-label', currentPrimaryTarget ? `Fly to ${friendly(currentPrimaryTarget)}` : 'Choose a destination');
}
const worldIntroductions = { earth: 'An ocean world. Our starting point.', moon: 'An airless companion, marked by ancient impacts.', mercury: 'A cratered world close to the Sun.', venus: 'Bright clouds hide a volcanic world.', mars: 'Rust-colored deserts beneath a thin atmosphere.', jupiter: 'Cloud bands on a giant with worlds of its own.', saturn: 'Immense rings. A family of extraordinary moons.', uranus: 'A pale blue giant, turned on its side.', neptune: 'Deep blue clouds in the outer Solar System.', io: 'Volcanic terrain in Jupiter’s powerful embrace.', europa: 'An icy shell, with an ocean beneath.', titan: 'An orange haze above Saturn’s largest moon.', enceladus: 'Small, bright and icy. A world that vents an ocean.' };
function selectObject(record, { look = false } = {}) {
  if (!record || !Array.isArray(record.position)) return;
  selected = record; state.selectedIndex = record.index; state.selectedDestination = isPhenomenon(record) ? { index: record.index, id: record.id, name: record.name, position: record.position, radiusPc: radius(record), modelUnitPc: record.modelUnitPc ?? radius(record), sceneKind: record.sceneKind, sceneId: record.sceneId, linkedCatalogIndex: record.linkedCatalogIndex } : null;
  $('system-map-open').hidden = isPhenomenon(record)||record.kind==='region'; setText('explore-system', isPhenomenon(record)||record.kind==='region' ? 'More phenomena ↗' : 'Explore this system ↗');
  $('night-side').hidden=record.id!=='earth';
  setText('object-title', friendly(record));
  const isEarth = record.index === -2, isSun = record.index === namedIndex.sun, body = isBody(record);
  const near = length(sub(state.position, record.position)) < minimumDistance(record) * 2;
  setText('object-kicker', record.kind==='region'?'BEYOND THE MILKY WAY':body ? subjectContext(record) : near ? (isSun ? 'OUR NEAREST STAR' : 'A SUN IN THE REAL SKY') : 'SELECTED DESTINATION');
  $('object-description').replaceChildren();
  const description = worldIntroductions[record.id] || record.description || (isEarth ? 'Every journey starts somewhere.' : isSun ? 'The star that makes home possible.' : record.index === namedIndex.alpha ? 'Another sun, in our nearest stellar neighborhood.' : record.index === namedIndex.proxima ? 'The nearest known star beyond the Sun.' : record.spect ? `A ${record.spect} star in the measured catalog.` : 'A measured point in a much larger universe.');
  const first = document.createTextNode(description.length > 145 ? description.slice(0, 142) + '…' : description), second = document.createElement('span');
  second.textContent = record.kind==='region'?'Observed stars in a reconstructed neighboring galaxy.':isStellarSurface(record)&&radius(record)>8*SOLAR_RADIUS_PC?'A vast photosphere. Scroll out to take in the whole star.':body ? (childrenOf(record).length ? `${childrenOf(record).length} nearby ${childrenOf(record).length === 1 ? 'moon to discover' : 'moons to discover'}.` : appearanceLabel(record).toLowerCase()) : isEarth ? 'This one starts at home.' : isSun ? 'Look farther. You can always come back.':`${compactDistance(length(record.position))} from the Sun.`;
  $('object-description').append(first, document.createElement('br'), second);
  setText('object-facts', record.kind==='region'?'GAIA DR3 · RECONSTRUCTED CLOUD DEPTH':body ? `${bodyKind(record).toUpperCase()} · ${appearanceLabel(record)}` : `${record.spect || 'CATALOG STAR'} · ${(radius(record)/SOLAR_RADIUS_PC).toLocaleString(undefined,{maximumFractionDigits:2})} SOLAR RADII${record.flags&2?' · ESTIMATED':''}`);
  setText('inspect-selected', record.kind==='region'?'View cloud ↗':isStellarSurface(record) ? 'Frame whole star ↗' : `Inspect ${friendly(record)}`);
  if (look) { mode = 'free'; alignTo(record.position); }
  updatePrimaryAction(); updateMode(); invalidate();
}
function homeCamera() {
  const towardSun = normalize(scale(earth.position, -1));
  const offset = normalize([towardSun[0] * .95 - towardSun[1] * .31,
    towardSun[0] * .31 + towardSun[1] * .95, towardSun[2] + .10]);
  state.position = add(earth.position, scale(offset, minimumDistance(earth)));
  state.fov = 50; mode = 'orbit'; cameraSystemHost = sun.index; selectObject(earth); orbitFromCamera(); alignTo(earth.position); state.roll=northRoll(earth.axis||[0,0,1]);
  flightSpeed = earth.radius_pc * 2; invalidate();
}
function minimumDistance(record) {
  if(record.kind==='region')return radius(record)*(record.viewDistanceRadii||3.5);
  // Illustrated stellar surfaces share the large-star arrival experience;
  // fitting an entire phenomenon into a portrait screen shrank the giant.
  if(isPhenomenon(record)&&isStellarSurface(record))return Math.max(minimumOrbitRadius(record),radius(record)*record.viewDistanceRadii);
  if(!isBody(record)){
    const solar=radius(record)/SOLAR_RADIUS_PC;
    // Arrival keeps physical size differences: small stars stay compact,
    // giants engulf the view. The safety floor remains outside the surface.
    return Math.max(radius(record)*1.18,5*SOLAR_RADIUS_PC*Math.pow(Math.max(solar,.03),.35));
  }
  const ring=Number(record?.ring?.outerRadius||1),scale=Number(record?.viewDistanceRadii)||(ring>1?ring*3.2:record?.index===-2?3.4:3.5);
  return radius(record)*scale*Math.max(1,.85/(width/Math.max(height,1)));
}
function endpointFor(record, options = {}) {
  let distance = isStellarSurface(record)&&options.inspect ? radius(record)*(Number(record.overviewDistanceRadii)||4.8)*Math.max(1,.85/(width/Math.max(height,1))) : minimumDistance(record), direction;
  if (isPhenomenon(record)) {
    direction = normalize(record.viewDirection || [.25, .18, .95]);
  } else if (isBody(record)) {
    const light = normalize(sub(record.hostPosition || sun.position, record.position));
    const axis = normalize(record.axis || [0, 0, 1]);
    let tangent = normalize(cross(axis, light)); if (length(tangent) < .1) tangent = normalize(cross([0, 1, 0], light));
    if (record.ring) {
      const inPlane = normalize(sub(light, scale(axis, dot(light, axis))));
      const pole = dot(light, axis) < 0 ? scale(axis, -1) : axis;
      direction = normalize(add(scale(inPlane, Math.cos(.48)), scale(pole, Math.sin(.48))));
    } else if(options.view==='night') direction=normalize(add(add(scale(light,-.92),scale(tangent,.39)),scale(axis,.18)));
    else if (record.kind === 'comet' && !options.inspect) direction = normalize(add(scale(light, .25), scale(tangent, .97)));
    else direction = normalize(add(scale(light, options.view === 'limb' ? .28 : .92), scale(tangent, options.view === 'limb' ? .96 : .39)));
    if (record.kind === 'comet' && options.inspect) distance = radius(record) * 3.5 * Math.max(1, .85 / (width / Math.max(height, 1)));
    if (options.view === 'system') {
      const parent = byId.get(String(record.parentId));
      distance = parent && isBody(parent) ? Math.max(distance * 4, length(sub(parent.position, record.position)) * 1.3) : distance * 4;
    }
  } else {
    direction = normalize(sub(state.position, record.position));
    if (length(direction) < .1) direction = [0, .2, 1];
  }
  return add(record.position, scale(direction, distance));
}
function navigationObstacles(destination) {
  const records = [sun, selected, destination, ...bodies, ...phenomena.filter(item => item.sceneKind === 'blackhole'), ...systems.map(system => byIndex.get(system.hostStarIndex))];
  const seen = new Set(); return records.filter(record => { if (!record || (isPhenomenon(record) && record.sceneKind !== 'blackhole') || seen.has(record.index)) return false; seen.add(record.index); return true; });
}
function nearestDeparture(records) {
  let result = null, closest = Infinity;
  for (const record of records) { const r = length(sub(state.position, record.position)) / radius(record); if (r < closest && r < 50) { closest = r; result = record; } }
  return result;
}
function segmentDistance(a, b, center) {
  const d = sub(b, a), squared = dot(d, d);
  const t = squared > 0 ? clamp(dot(sub(center, a), d) / squared, 0, 1) : 0;
  const point = add(a, scale(d, t)); return { distance: length(sub(point, center)), point, t, direction: d };
}
function safeWaypoints(initial, obstacles) {
  const points = initial.map(point => [...point]);
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    outer: for (let i = 0; i < points.length - 1; i++) {
      for (const body of obstacles) {
        const hit = segmentDistance(points[i], points[i + 1], body.position), clearance = navigationRadius(body) * 1.10;
        if (hit.distance >= clearance) continue;
        // A radial departure segment is safe even when a freely positioned
        // starting camera lies inside the extra navigation margin.
        const da = length(sub(points[i], body.position)), db = length(sub(points[i + 1], body.position));
        if (hit.t < 1e-10 && da >= radius(body) * 1.015 && db > da) continue;
        if (hit.t > 1 - 1e-10 && db >= radius(body) * 1.015 && da > db) continue;
        let offset = sub(hit.point, body.position);
        if (length(offset) < clearance * .05) { offset = cross(hit.direction, body.axis || [0, 0, 1]); if (length(offset) < 1e-25) offset = cross(hit.direction, [0, 1, 0]); }
        const waypoint = add(body.position, scale(normalize(offset), clearance * 3));
        points.splice(i + 1, 0, waypoint); changed = true; break outer;
      }
    }
    if (!changed) break;
  }
  const cumulative = [0]; for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + length(sub(points[i], points[i - 1])));
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
}
function pointOnRoute(route, distance) {
  const along = clamp(distance, 0, route.length);
  for (let i = 1; i < route.points.length; i++) if (along <= route.cumulative[i] || i === route.points.length - 1) {
    const segmentLength = route.cumulative[i] - route.cumulative[i - 1], u = segmentLength > 0 ? (along - route.cumulative[i - 1]) / segmentLength : 1;
    // Subtract from the nearby endpoint on arrival: adding almost a whole
    // interstellar segment discards useful precision near a tiny target.
    return u > .5 ? add(route.points[i], scale(sub(route.points[i - 1], route.points[i]), 1 - u))
      : add(route.points[i - 1], scale(sub(route.points[i], route.points[i - 1]), u));
  }
  return [...route.points[route.points.length - 1]];
}
// Walk back along the already collision-checked route to its first crossing
// of the requested camera radius. This preserves detours and world positions.
function remainingAtRadius(route, center, boundary) {
  let remaining = 0;
  for (let i = route.points.length - 1; i > 0; i--) {
    const end = route.points[i], previous = route.points[i - 1], segment = sub(previous, end), span = length(segment);
    if (length(sub(previous, center)) >= boundary && span > 0) {
      const offset = sub(end, center), direction = scale(segment, 1 / span), projection = dot(offset, direction);
      const crossing = -projection + Math.sqrt(Math.max(0, projection * projection + boundary * boundary - dot(offset, offset)));
      return remaining + clamp(crossing, 0, span);
    }
    remaining += span;
  }
  return null;
}
function phenomenonWaypoints(start, endpoint, record) {
  if (!isPhenomenon(record)) return [];
  const blackhole = record.sceneKind === 'blackhole';
  const incoming = sub(start, record.position), startRadius = length(incoming), unit = radius(record);
  if (startRadius < unit * (blackhole ? 500 : 100)) return [];
  const from = normalize(incoming), to = normalize(sub(endpoint, record.position));
  const cosine = clamp(dot(from, to), -1, 1), angle = Math.acos(cosine);
  let tangent = sub(to, scale(from, cosine));
  if (length(tangent) < 1e-8) tangent = cross(from, Math.abs(from[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
  tangent = normalize(tangent);
  // Turn toward the final viewing bearing before the close-up region. The
  // angular easing has radial tangents at both ends, so the last leg can keep
  // one steady view while the shadow grows. Even opposite bearings remain
  // outside the object rather than cutting a chord through its center.
  const endRadius = Math.max(unit * (blackhole ? 420 : 90), startRadius * .035);
  const beginRadius = Math.min(startRadius * .94, Math.max(endRadius * 1.08, startRadius * .65));
  const points = [];
  for (let i = 0; i <= 96; i++) {
    const u = i / 96, bearing = angle * smooth(u);
    const direction = i === 96 ? to : add(scale(from, Math.cos(bearing)), scale(tangent, Math.sin(bearing)));
    const distance = beginRadius * Math.exp(Math.log(endRadius / beginRadius) * u);
    points.push(add(record.position, scale(direction, distance)));
  }
  return points;
}
function localApproach(record, route, duration, sameTarget, leg) {
  if (!isPhenomenon(record) || sameTarget || duration <= 0) return null;
  const blackhole=record.sceneKind==='blackhole';
  const remaining = remainingAtRadius(route, record.position, radius(record) * (blackhole?4096:512));
  if (!(remaining > 0) || remaining >= leg) return null;
  const closeSeconds = Math.min(8, duration * .45), closeStart = duration - closeSeconds, approachStart = duration * .38;
  const logarithm = Math.log(leg / remaining);
  const targetScale = Math.max(radius(record) * (blackhole?24:record.viewDistanceRadii||6), 1e-13), closeLog = Math.log1p(remaining / targetScale);
  const span = closeStart - approachStart, e = Math.exp(-closeLog), q = 1 - e;
  const terminalSlope = -2 * closeLog / q * span / (closeSeconds * logarithm);
  const terminalCurvature = (2 * closeLog / q - 4 * closeLog * closeLog * e / (q * q)) * span * span / (closeSeconds * closeSeconds * logarithm);
  return { remaining, closeStart, closeSeconds, approachStart, logarithm, targetScale, closeLog,
    // Match position, velocity and acceleration at the start of the final
    // braking leg; a velocity-only match still produced a sharp slowdown.
    terminalSlope, terminalCurvature,
    exponentCoefficients: [-10 - 4 * terminalSlope + .5 * terminalCurvature,
      15 + 7 * terminalSlope - terminalCurvature, -6 - 3 * terminalSlope + .5 * terminalCurvature] };
}
function travelDuration(distance, sameTarget) {
  if (sameTarget) return 2.8;
  const au = distance / AU_PC;
  if (au < .01) return 4.4;
  if (au < 1000) return clamp(5.1 + Math.log10(Math.max(.02, au) + .2) * 1.45, 4.8, 9.3);
  return clamp(10.5 + Math.log10(Math.max(1, distance)) * 1.15, 10.5, 14);
}
async function beginJourney(record, options = {}) {
  if (typeof record === 'string') record = byId.get(record) || stars.find(star => friendly(star).toLocaleLowerCase() === record.toLocaleLowerCase());
  if (!record || !sceneReady) return;
  if(!options.tour)stopTour();
  const intent = ++journeyIntent;
  if (!isPhenomenon(record)) { failedDestination = null; preparingIntent = 0; $('preparing').hidden = true; }
  if (isPhenomenon(record)) {
    preparingIntent = intent; failedDestination = null; $('error').hidden = true; setText('preparing-message', `Preparing ${friendly(record)}…`); $('preparing').hidden = false;
    try { await prepareDestination(record); } catch (error) { if (intent === journeyIntent) { failedDestination = record; showError(error.message); } return; }
    finally { if (preparingIntent === intent) { preparingIntent = 0; $('preparing').hidden = true; } }
    if (intent !== journeyIntent) return;
  }
  if ((record.generated || record.index <= -100000) && !generatedSystems.has(record.parentStarIndex)) { const host = byIndex.get(record.parentStarIndex); if (host) { await generateForStar(host); record = byIndex.get(record.index) || record; } }
  if (record.generated || record.index <= -100000 || generatedSystems.has(record.parentStarIndex ?? record.index)) { try { await ensureRegistered(record); } catch (error) { showError(error.message); return; } if (intent !== journeyIntent) return; }
  if (travel?.destination.index === record.index && !options.inspect && !options.view && !options.instant) return;
  if (travel) { state.fov = travel.baseFov; travel = null; }
  input(); closeSystemMap(true); keys.clear(); resumeTarget = null; $('resume-card').hidden = true;
  const obstacles = navigationObstacles(record), source = nearestDeparture(obstacles) || (isPhenomenon(selected) && length(sub(state.position, selected.position)) < radius(selected) * (selected.sceneKind === 'blackhole' ? 150 : 80) ? selected : null), sameTarget = source?.index === record.index;
  const start = [...state.position], endpoint = endpointFor(record, options), distance = length(sub(endpoint, start));
  const from = source ? friendly(source) : 'Your viewpoint';
  let points = [start];
  if (source && !sameTarget) {
    const offset = sub(start, source.position), startRadius = length(offset), pull = Math.min(distance * .12, Math.max(radius(source) * 5, startRadius * .85));
    if (pull > radius(source) * .1) points.push(add(source.position, scale(normalize(offset), startRadius + pull)));
  }
  if (!sameTarget) points.push(...phenomenonWaypoints(points[points.length - 1], endpoint, record));
  points.push(endpoint); const route = safeWaypoints(points, obstacles);
  const duration = options.instant || reducedMotion ? 0 : options.duration ?? (isPhenomenon(record) && !sameTarget ? 18 : travelDuration(route.length, sameTarget));
  const fromYaw = state.yaw, fromPitch = state.pitch;
  selectObject(record); mode = 'free';
  if (duration === 0 || route.length < radius(record) * .025) {
    state.position = endpoint; state.fov = Number(record.viewFov) || 50; alignTo(record.position); travel = null; finishJourney(); closePanel(); viewport.focus({ preventScroll: true }); return;
  }
  const leg = route.length * (route.length / AU_PC < .02 ? .18 : .035);
  travel = { start, endpoint, route, distance: route.length, source, destination: record, from, elapsed: 0, duration,
    nearStart: Math.max(source ? radius(source) * 1.5 : route.length * .002, 1e-13),
    nearEnd: Math.max(radius(record) * 2, 1e-13), leg, closeApproach: localApproach(record, route, duration, sameTarget, leg), fromYaw, fromPitch, baseFov: state.fov, targetFov: Number(record.viewFov) || 50, sameTarget,
    options: { view: options.view || 'day', inspect: Boolean(options.inspect) } };
  $('journey').hidden = false; $('atlas').classList.add('travelling');
  setText('journey-from', from); setText('journey-to', friendly(record)); setText('object-kicker', 'EN ROUTE');
  updateMode(); invalidate(); closePanel(); viewport.focus({ preventScroll: true });
}
function finishJourney() {
  if (travel) state.fov = travel.targetFov;
  travel = null; resumeTarget = null; $('resume-card').hidden = true; $('journey').hidden = true; $('atlas').classList.remove('travelling');
  mode = 'orbit'; orbitFromCamera(); syncOrbit(); flightSpeed = radius(selected) * 3; cameraSystemHost = selected.parentStarIndex ?? selected.index;
  selectObject(selected); updateMode(); invalidate(); hud(performance.now(), true);
}
function cancelJourney() {
  stopTour();
  journeyIntent++; preparingIntent = 0; $('preparing').hidden = true;
  if (!travel) return;
  resumeTarget = travel.destination; state.fov = travel.baseFov;
  travel = null; mode = 'free'; $('journey').hidden = true; $('atlas').classList.remove('travelling');
  $('resume-card').hidden = false; setText('resume-label', `Journey to ${friendly(resumeTarget)} interrupted`);
  setText('object-kicker', 'YOUR JOURNEY · YOUR PACE');
  flightSpeed = Math.max(radius(selected) * 3, length(sub(selected.position, state.position)) * .08);
  updateMode(); updatePrimaryAction(); invalidate();
}
function blendLook(a, b, blend) {
  const from = normalize(a), to = normalize(b), cosine = clamp(dot(from, to), -1, 1);
  let direction;
  if (cosine > .9995) direction = normalize(add(scale(from, 1 - blend), scale(to, blend)));
  else {
    let tangent = sub(to, scale(from, cosine));
    if (length(tangent) < 1e-8) tangent = cross(from, Math.abs(from[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
    const angle = Math.acos(cosine) * blend;
    direction = add(scale(from, Math.cos(angle)), scale(normalize(tangent), Math.sin(angle)));
  }
  state.yaw = Math.atan2(direction[0], direction[2]); state.pitch = Math.atan2(direction[1], Math.hypot(direction[0], direction[2]));
}
function updateJourney(dt) {
  if (!travel) return;
  travel.elapsed = Math.min(travel.duration, travel.elapsed + dt);
  const t = travel.elapsed / travel.duration, D = travel.route.length, leg = travel.leg;
  let distance;
  if (travel.sameTarget) distance = D * smooth(t);
  else if (t < .24) distance = travel.nearStart * Math.expm1(Math.log1p(leg / travel.nearStart) * smooth(t / .24));
  else if (travel.closeApproach) {
    const approach = travel.closeApproach, elapsed = travel.elapsed;
    if (elapsed < approach.approachStart) distance = leg + (D - 2 * leg) * smooth((t - .24) / (approach.approachStart / travel.duration - .24));
    else if (elapsed < approach.closeStart) {
      const u = clamp((elapsed - approach.approachStart) / (approach.closeStart - approach.approachStart), 0, 1);
      const [a, b, c] = approach.exponentCoefficients;
      const exponent = 1 + u * u * u * (a + u * (b + u * c));
      distance = D - approach.remaining * Math.exp(approach.logarithm * exponent);
    } else {
      const u = clamp((elapsed - approach.closeStart) / approach.closeSeconds, 0, 1);
      distance = D - approach.targetScale * Math.expm1(approach.closeLog * (1 - u) ** 2);
    }
  } else if (t < .64) distance = leg + (D - 2 * leg) * smooth((t - .24) / .40);
  else distance = D - travel.nearEnd * Math.expm1(Math.log1p(leg / travel.nearEnd) * (1 - smooth((t - .64) / .36)));
  state.position = pointOnRoute(travel.route, distance);
  const toTarget = sub(travel.destination.position, state.position);
  if (travel.source && !travel.sameTarget && t < .22) {
    // Begin from the actual opening camera bearing. Chasing the departing
    // source after a tiny close-up leg can reverse that bearing abruptly.
    const cp = Math.cos(travel.fromPitch), opening = [Math.sin(travel.fromYaw) * cp, Math.sin(travel.fromPitch), Math.cos(travel.fromYaw) * cp];
    blendLook(opening, toTarget, smooth(clamp(t / .22, 0, 1)));
  } else alignTo(travel.destination.position);
  // A mild field-of-view pulse suggests acceleration while the camera
  // follows the same continuous route through world coordinates.
  const pulse = travel.sameTarget || reducedMotion ? 0 : Math.sin(Math.PI * clamp((t - .15) / .72, 0, 1)) ** 2;
  state.fov = travel.baseFov + (travel.targetFov - travel.baseFov) * smooth(t) + pulse * 8;
  $('journey-progress').style.width = (t * 100).toFixed(2) + '%';
  const phase = t < .24 ? 'departure' : t < (travel.closeApproach ? .38 : .64) ? 'cruise' : 'approach';
  for (const name of ['departure', 'cruise', 'approach']) $('phase-' + name).classList.toggle('active', name === phase);
  setText('journey-stage', travel.sameTarget ? 'FINDING YOUR VIEW' : phase === 'departure' ? `PULLING AWAY${travel.source ? ' FROM ' + friendly(travel.source).toUpperCase() : ''}` : phase === 'cruise' ? (D / AU_PC < 1000 ? 'CROSSING THE SYSTEM' : 'BETWEEN THE STARS') : `APPROACHING ${friendly(travel.destination).toUpperCase()}`);
  if (t >= 1) { state.position = [...travel.endpoint]; finishJourney(); }
}
function lookAtSun() {
  if (!sun) return;
  input(); cancelJourney(); selectObject(sun, { look: true });
}
function setPaused(value) {
  if(value&&!paused)earthClockHeld=Date.now()-earthClockOffset;
  if(!value&&paused)earthClockOffset=Date.now()-earthClockHeld;
  state.earthUtcMs=value?earthClockHeld:Date.now()-earthClockOffset;
  paused = Boolean(value); $('pause').setAttribute('aria-pressed', String(paused));
  $('pause').setAttribute('aria-label', paused ? 'Resume scene time' : 'Pause scene time');
  $('pause').textContent = paused ? '▷' : 'Ⅱ'; $('pause-setting').checked = paused; invalidate();
}
function stopTour(){
  tour=null;$('tour-card').hidden=true;$('atlas').classList.remove('touring');
}
function showTour(){
  if(!tour)return;
  const stop=tourStops[tour.index],complete=tour.phase==='complete';
  $('tour-card').hidden=false;$('atlas').classList.add('touring');
  setText('tour-chapter',`GRAND TOUR · ${String(tour.index+1).padStart(2,'0')} / ${tourStops.length}`);
  setText('tour-title',complete?'The universe is yours':stop.title);
  setText('tour-caption',complete?'Stay here, take the controls, or begin another journey.':stop.caption);
  setText('tour-state',complete?'COMPLETE':tour.paused?'HOLDING POSITION':tour.phase==='dwell'?'LOOK AROUND':tour.phase==='preparing'?'PREPARING':'IN FLIGHT');
  setText('tour-pause',tour.paused?'Continue tour':'Pause tour');$('tour-pause').setAttribute('aria-pressed',String(tour.paused));$('tour-pause').hidden=complete;
  setText('tour-next',complete?'Start again ↗':'Next stop →');
}
async function nextTourStop(){
  if(!tour||tour.phase==='complete'){startTour();return;}
  const current=tour,index=++current.index;
  if(index>=tourStops.length){current.index=tourStops.length-1;current.phase='complete';showTour();return;}
  const stop=tourStops[index],target=byId.get(stop.id);
  current.phase='preparing';current.elapsed=0;current.paused=false;showTour();
  await beginJourney(target,{view:stop.view||'day',duration:index===0?5:undefined,tour:true});
  if(tour!==current||current.index!==index)return;
  if(!target||selected?.index!==target.index||!$('error').hidden){stopTour();return;}
  current.phase='travel';showTour();
}
function startTour(){
  if(!sceneReady)return;
  cancelJourney();closeSystemMap(true);closePanel();keys.clear();$('error').hidden=true;
  tour={index:-1,phase:'ready',elapsed:0,paused:false};nextTourStop();
}
function updateTour(dt){
  if(!tour||tour.paused||tour.phase==='preparing'||tour.phase==='complete')return;
  const stop=tourStops[tour.index];
  if(tour.phase==='travel'&&!travel){
    tour.phase='dwell';tour.elapsed=0;tour.offset=sub(state.position,selected.position);
    tour.axis=normalize(selected.axis||[0,1,0]);showTour();
    const next=byId.get(tourStops[tour.index+1]?.id);if(next&&isPhenomenon(next))prepareDestination(next).catch(()=>{});
  }
  const phaseProgress=tour.phase==='travel'?(travel?.elapsed||0)/(travel?.duration||1):1;
  $('tour-progress').style.width=`${(tour.index+(tour.phase==='dwell'?.65+.35*tour.elapsed/stop.hold:.65*phaseProgress))/tourStops.length*100}%`;
  if(tour.phase!=='dwell')return;
  tour.elapsed=Math.min(stop.hold,tour.elapsed+dt);
  const angle=reducedMotion?0:stop.sweep*smooth(tour.elapsed/stop.hold),v=tour.offset,a=tour.axis;
  const offset=add(add(scale(v,Math.cos(angle)),scale(cross(a,v),Math.sin(angle))),scale(a,dot(a,v)*(1-Math.cos(angle))));
  state.position=add(selected.position,offset);alignTo(selected.position);orbitFromCamera();
  if(tour.elapsed>=stop.hold)nextTourStop();
}
function openPanel(tab = 'destinations') {
  $('panel').hidden = false;
  const destinations = tab === 'destinations';
  $('destinations-panel').hidden = !destinations; $('observatory-panel').hidden = destinations;
  $('tab-destinations').setAttribute('aria-selected', String(destinations));
  $('tab-observatory').setAttribute('aria-selected', String(!destinations));
  $('search-open').setAttribute('aria-expanded', String(destinations));
  $('info-open').setAttribute('aria-expanded', String(!destinations));
  keys.clear(); lastHudAt = 0;
  if (destinations) { renderSearch(); $('star-search').focus({ preventScroll: true }); }
}
function closePanel() {
  $('panel').hidden = true; $('search-open').setAttribute('aria-expanded', 'false'); $('info-open').setAttribute('aria-expanded', 'false');
}
function previewTarget(record) {
  if (!record) return;
  previewed = record; $('target-card').hidden = false;
  setText('target-kind', `${bodyKind(record).toUpperCase()} · ${subjectContext(record)}`);
  setText('target-data-class', appearanceLabel(record)); setText('target-name', friendly(record));
  setText('target-description', worldIntroductions[record.id] || record.description || (record.index === namedIndex.pleiades ? 'Alcyone is a luminous member of the Pleiades cluster. Travel here to see the catalog sky from its place in the cluster.' : `A ${record.spect || 'catalog'} star, ${compactDistance(length(record.position))} from the Sun. Its real position anchors the surrounding sky.`));
  const facts = document.createDocumentFragment();
  const entries = Array.isArray(record.facts) ? record.facts.map(fact => Array.isArray(fact) ? fact : [fact.label || fact.name || '', `${fact.value ?? fact.text ?? ''}${fact.unit ? ' ' + fact.unit : ''}`]) : Object.entries(record.facts || {});
  const supplied = entries.filter(([, value]) => typeof value === 'string' || typeof value === 'number').slice(0, isPhenomenon(record) ? 4 : 3);
  const details = supplied.length ? supplied : [['Distance', compactDistance(length(sub(record.position, state.position)))], ['Radius', `${fmt.format(Math.round(radius(record) * PC_KM))} km`]];
  for (const [key, value] of details) { const span = document.createElement('span'), strong = document.createElement('strong'); strong.textContent = String(value); span.append(document.createTextNode(String(key).replaceAll('_', ' ') + ' '), strong); facts.append(span); }
  $('target-facts').replaceChildren(facts); setText('fly-preview', `Fly to ${friendly(record)} ↗`);
  setText('inspect-preview', isStellarSurface(record)?'Frame whole star':'Inspect');
  $('target-view-options').hidden = !isBody(record) || isPhenomenon(record); $('map-preview').hidden = isPhenomenon(record)||record.kind==='region'; arrivalView = 'day';
  document.querySelectorAll('[data-arrival-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.arrivalView === arrivalView)));
  document.querySelector('[data-arrival-view="night"]').hidden=!record.emission;
  renderDestinationRows();
}
function categoryRecords() {
  const query = $('star-search').value.trim().toLocaleLowerCase();
  if (query) {
    const all = [...phenomena, ...bodies, ...stars]; const seen = new Set();
    return all.filter(record => { const searchable = record.search || [record.name, record.description, record.id, bodyKind(record)].join(' ').toLocaleLowerCase(); if (!searchable.includes(query) || seen.has(record.index)) return false; seen.add(record.index); return true; }).sort((a, b) => Number(friendly(b).toLocaleLowerCase() === query) - Number(friendly(a).toLocaleLowerCase() === query) || Number(isBody(b)) - Number(isBody(a)) || (Number(a.mag) || 0) - (Number(b.mag) || 0)).slice(0, 24);
  }
  if (activeCategory === 'phenomena') return [byId.get('large-magellanic-cloud'),...phenomena].filter(Boolean);
  if (activeCategory === 'solar') {
    const solar = bodies.filter(body => body.parentStarIndex === sun?.index || ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon', 'io', 'europa', 'titan', 'enceladus'].includes(body.id));
    if (activeSystemId && byId.has(activeSystemId)) return solar.filter(body => body.id === activeSystemId || body.parentId === activeSystemId).sort((a, b) => radius(b) - radius(a)).slice(0, 30);
    const featuredMoons = new Set(['moon', 'phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'enceladus', 'triton', 'charon']);
    return [sun, ...solar.filter(body => !bodyKind(body).includes('moon') || featuredMoons.has(body.id))].filter(Boolean);
  }
  if (activeCategory === 'systems') {
    if (activeSystemId === 'centauri-trio') return ['alpha', 'alphaB', 'proxima'].map(key => byIndex.get(namedIndex[key])).filter(Boolean).concat(bodies.filter(body => body.parentStarIndex === namedIndex.proxima));
    const system = systems.find(item => item.id === activeSystemId) || systems.find(item => item.hostStarIndex !== sun?.index);
    if (system) return [byIndex.get(system.hostStarIndex), ...(system.bodyIds || []).map(id => byId.get(String(id)))].filter(Boolean);
    return ['alpha', 'alphaB', 'proxima', 'sirius'].map(key => byIndex.get(namedIndex[key])).filter(Boolean);
  }
  const curated = (systemsDocument?.stellarDestinations || []).map(item => byIndex.get(item.index)).filter(Boolean);
  const names = ['Betelgeuse', 'Rigel', 'Antares', 'Deneb', 'Vega', 'Altair', 'Arcturus', 'Aldebaran', 'Spica', 'Fomalhaut', 'Capella', 'Polaris', 'Alcyone', 'Sirius'];
  const records = [...curated, ...names.map(name => stars.find(star => star.name.toLowerCase() === name.toLowerCase())).filter(Boolean)];
  const seen = new Set(); return records.filter(record => { if (seen.has(record.index)) return false; seen.add(record.index); return true; });
}
function renderDestinationRows() {
  const query = $('star-search').value.trim(), records = categoryRecords();
  setText('search-caption', query ? `${records.length ? 'MATCHING DESTINATIONS' : 'NO MATCHES'} · SEARCH THE CATALOG` : activeCategory === 'solar' ? 'PLANETS, MOONS & OUR STAR' : activeCategory === 'systems' ? 'A STAR IS ONLY THE BEGINNING' : 'EXTRAORDINARY PLACES IN THE REAL SKY');
  const fragment = document.createDocumentFragment();
  for (const record of records) {
    const row = document.createElement('div'); row.className = 'destination-row' + (previewed?.index === record.index ? ' selected' : '');
    const button = document.createElement('button'); button.className = 'destination'; button.setAttribute('aria-label', `Discover ${friendly(record)}`);
    const dot = document.createElement('span'); dot.className = 'body-dot'; dot.style.setProperty('--body-color', record.color || (bodyKind(record).includes('moon') ? '#b7b9b0' : isBody(record) ? '#9dbdcd' : '#dcc695'));
    const content = document.createElement('span'), name = document.createElement('span'), description = document.createElement('span'), distance = document.createElement('span');
    name.className = 'destination-name'; name.textContent = friendly(record); description.className = 'destination-description';
    const children = childrenOf(record); description.textContent = isPhenomenon(record) ? 'Real object · illustrative closeup at its sourced location' : isBody(record) ? [bodyKind(record), children.length ? `${children.length} moons` : byId.get(String(record.parentId)) ? `${friendly(byId.get(String(record.parentId)))} system` : record.classification || 'A world to explore'].join(' · ') : [record.spect || 'Catalog star', children.length ? `${children.length} ${children.length === 1 ? 'world' : 'worlds'} to explore` : record.index === namedIndex.pleiades ? 'Pleiades member' : 'Inspect its surface'].join(' · ');
    distance.className = 'destination-distance'; distance.textContent = compactDistance(length(sub(record.position, state.position))); content.append(name, description); button.append(dot, content, distance);
    button.addEventListener('click', () => previewTarget(record));
    const fly = document.createElement('button'); fly.className = 'destination-arrow'; fly.textContent = '↗'; fly.title = `Fly to ${friendly(record)}`; fly.setAttribute('aria-label', `Fly to ${friendly(record)}`); fly.addEventListener('click', () => beginJourney(record));
    row.append(button, fly); fragment.append(row);
  }
  $('search-results').replaceChildren(fragment);
}
function renderSystemCards() {
  const fragment = document.createDocumentFragment(), cards = [];
  if (activeCategory === 'solar') {
    cards.push({ id: '', name: 'The Solar System', subtitle: 'Eight planets. Many perspectives.', caption: `${bodies.filter(body => body.parentStarIndex === sun?.index).length} WORLDS` });
    for (const id of bodies.filter(body => body.parentStarIndex === sun?.index && !bodyKind(body).includes('moon') && childrenOf(body).length).map(body => body.id)) { const body = byId.get(id); if (body && childrenOf(body).length) cards.push({ id, name: `${friendly(body)} & its moons`, subtitle: id === 'earth' ? 'Begin close to home.' : id === 'jupiter' ? 'Cloud bands, fire and ice.' : id === 'saturn' ? 'Rings, haze and hidden oceans.' : 'Explore a family of worlds.', caption: `${childrenOf(body).length + 1} DESTINATIONS` }); }
  } else if (activeCategory === 'systems') {
    cards.push({ id: 'centauri-trio', name: 'Alpha Centauri', subtitle: 'Three suns. Our nearest neighbors.', caption: 'STELLAR NEIGHBORHOOD' });
    for (const system of systems.filter(system => system.hostStarIndex !== sun?.index)) cards.push({ id: system.id, name: system.name, subtitle: system.description || 'Confirmed worlds around a distant sun.', caption: system.dataClass === 'generated-system' ? `${system.bodyIds?.length || 0} WORLDS · GENERATED + KNOWN` : `${system.bodyIds?.length || 0} CONFIRMED ${(system.bodyIds?.length || 0) === 1 ? 'WORLD' : 'WORLDS'}` });
  } else if (activeCategory === 'phenomena') cards.push({ id: '', name: 'Follow the extraordinary', subtitle: 'A contact binary. A stellar remnant. The center of our galaxy.', caption: 'REAL ANCHORS · ILLUSTRATED CLOSEUPS' });
  else cards.push({ id: '', name: 'Stellar wonders', subtitle: 'Giants, blue stars, clusters and beacons.', caption: 'THE REAL CATALOG' });
  for (const card of cards) { const button = document.createElement('button'); button.className = 'system-card'; button.setAttribute('aria-pressed', String(card.id === activeSystemId)); const title = document.createElement('strong'), subtitle = document.createElement('span'), caption = document.createElement('small'); title.textContent = card.name; subtitle.textContent = card.subtitle; caption.textContent = card.caption; button.append(title, subtitle, caption); button.addEventListener('click', () => { activeSystemId = card.id; previewed = null; $('target-card').hidden = true; renderSearch(); }); fragment.append(button); }
  $('system-cards').replaceChildren(fragment);
}
function renderSearch() {
  const query = $('star-search').value.trim(); $('system-cards').hidden = Boolean(query); $('quick-destinations').hidden = Boolean(query);
  if (!query) renderSystemCards(); renderDestinationRows();
}
function setCategory(category, systemId = '') {
  activeCategory = category; activeSystemId = systemId; $('star-search').value = ''; previewed = null; $('target-card').hidden = true;
  document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
  renderSearch();
}
function exploreSystem(record = selected) {
  if (isPhenomenon(record)||record?.kind==='region') { openPanel('destinations'); setCategory('phenomena'); previewTarget(record); return; }
  const system = getSystem(record), solar = isBody(record) && record.parentStarIndex === sun?.index || record?.index === sun?.index;
  openPanel('destinations'); setCategory(solar ? 'solar' : 'systems', solar ? (childrenOf(record).length ? record.id : record.parentId === 'sun' ? '' : record.parentId || '') : system?.id || 'centauri-trio');
  previewTarget(record);
}
function buildQuickDestinations() {
  const fragment = document.createDocumentFragment();
  for (const [record, label] of [[earth, 'Earth'], [byId.get('moon'), 'Moon'], [byId.get('saturn'), 'Saturn'], [byIndex.get(namedIndex.alpha), 'Alpha Centauri'], [byId.get('large-magellanic-cloud'),'Magellanic Cloud']]) {
    if (!record) continue; const button = document.createElement('button'); button.textContent = label; button.addEventListener('click', () => beginJourney(record)); fragment.append(button);
  }
  $('quick-destinations').replaceChildren(fragment);
}
function prepareSystems(document) {
  systemsDocument = document || { systems: [], bodies: [] }; systems = [...(systemsDocument.systems || [])]; bodies = [];
  byId.clear(); byId.set('sun', sun);
  for (const system of systems) {
    const host = system.host || system.hostStar;
    if (host && Array.isArray(host.position) && Number.isFinite(host.index)) {
      const existing = byIndex.get(host.index), record = { ...host, ...existing, name: existing?.name || host.name || system.name };
      record.search = [record.name, system.name, ...(record.aliases || [])].join(' ').toLocaleLowerCase(); byIndex.set(record.index, record);
      if (!stars.some(star => star.index === record.index)) stars.push(record);
      if (!Number.isFinite(system.hostStarIndex)) system.hostStarIndex = record.index;
      byId.set(String(host.id ?? system.id), record); byId.set('hyg-' + record.id, record); byId.set('star-' + record.index, record);
    }
  }
  for (const body of systemsDocument.bodies || []) {
    if (!Array.isArray(body.position) || !Number.isFinite(body.index)) continue;
    const record = { ...body, radius_pc: Number(body.radiusPc ?? body.radius_pc), search: [body.name, body.id, body.kind, body.parentId, ...(body.aliases || [])].join(' ').toLocaleLowerCase() };
    bodies.push(record); byIndex.set(record.index, record); byId.set(String(record.id), record);
  }
  const compiledEarth = bodies.find(body => body.index === -2);
  if (compiledEarth) { earth = { ...earth, ...compiledEarth }; byIndex.set(-2, earth); byId.set('earth', earth); bodies[bodies.indexOf(compiledEarth)] = earth; }
  else { earth.kind = 'planet'; earth.parentId = 'sun'; earth.parentStarIndex = sun.index; earth.id = 'earth'; bodies.unshift(earth); byIndex.set(-2, earth); byId.set('earth', earth); }
  for (const entry of systemsDocument.stellarDestinations || []) { let star = byIndex.get(entry.index); if (!star && Array.isArray(entry.position)) { star = { ...entry, search: [entry.name, entry.id, entry.description].join(' ').toLocaleLowerCase() }; byIndex.set(star.index, star); stars.push(star); } if (star && entry.description) star.description = entry.description; }
  fixedBodies = [...bodies];
  setText('destinations-count', `${bodies.length} worlds · ${fmt.format(stars.length)} searchable stars`);
}
function trimGeneratedSystems(currentHost) {
  const hostOf = record => record ? record.parentStarIndex ?? record.index : null;
  const protectedHosts = new Set([currentHost, cameraSystemHost, hostOf(selected), hostOf(resumeTarget), hostOf(previewed), mapScene?.host.index, ...registrationPins.keys(), ...registrationSignature.split(',').filter(Boolean).map(Number)]);
  const active = systems.find(system => system.id === activeSystemId); if (active) protectedHosts.add(active.hostStarIndex);
  for (const [host, system] of generatedSystems) {
    if (generatedSystems.size <= 32) break;
    if (protectedHosts.has(host)) continue;
    generatedSystems.delete(host);
    for (const body of system.bodies) if (body.generated) { byIndex.delete(body.index); byId.delete(String(body.id)); }
    bodies = bodies.filter(body => !body.generated || body.parentStarIndex !== host);
    systems = systems.filter(item => item.hostStarIndex !== host);
    const observed = systemsDocument.systems?.find(item => item.hostStarIndex === host); if (observed) systems.push(observed);
  }
}
async function generateForStar(star) {
  if (!star || star.index === sun.index) return systems.find(system => system.hostStarIndex === sun.index);
  if (generatedSystems.has(star.index)) { const cached = generatedSystems.get(star.index); generatedSystems.delete(star.index); generatedSystems.set(star.index, cached); return cached; }
  if (!generatorModule) generatorModule = import('./system-generator.js');
  const { generateSystem } = await generatorModule;
  const generated = generateSystem({ ...star, name: friendly(star) }, fixedBodies.filter(body => body.parentStarIndex === star.index));
  generatedSystems.set(star.index, generated);
  if (!byIndex.has(star.index)) byIndex.set(star.index, star);
  const previous = systems.findIndex(system => system.hostStarIndex === star.index);
  if (previous >= 0) systems[previous] = generated; else systems.push(generated);
  byId.set('star-' + star.index, star); byId.set('hyg-' + star.id, star);
  for (const raw of generated.bodies) {
    if (!raw.generated || byIndex.has(raw.index)) continue;
    const record = { ...raw, radius_pc: Number(raw.radiusPc ?? raw.radius_pc), search: [raw.name, raw.id, raw.kind, raw.classification, star.name].join(' ').toLocaleLowerCase() };
    byIndex.set(record.index, record); byId.set(record.id, record); bodies.push(record);
  }
  trimGeneratedSystems(star.index);
  setText('destinations-count', `${bodies.length} known + generated worlds · ${fmt.format(stars.length)} searchable stars`);
  return generated;
}
function ensureRegistered(record) {
  const destinationHost = isBody(record) ? record.parentStarIndex : record.index;
  const sourceHost = cameraSystemHost;
  const hosts = [...new Set([sourceHost, destinationHost])].filter(index => generatedSystems.has(index));
  const signature = hosts.sort((a, b) => a - b).join(',');
  if (signature === registrationSignature) return Promise.resolve();
  for (const host of hosts) registrationPins.set(host, (registrationPins.get(host) || 0) + 1);
  const task = registrationQueue.catch(() => {}).then(async () => {
    if (signature === registrationSignature) return;
    registrationPending = true;
    try {
      const generated = hosts.flatMap(index => generatedSystems.get(index).bodies.filter(body => body.generated));
      const belts = hosts.flatMap(index => generatedSystems.get(index).belts || []);
      const id = ++ticketId;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { registrationRequests.delete(id); reject(new Error('The generated system took too long to load. Try selecting it again.')); }, 20000);
        registrationRequests.set(id, { resolve, reject, timer });
        worker.postMessage({ type: 'set-system', id, bodies: generated, belts });
      });
      registrationSignature = signature; invalidate();
    } finally { registrationPending = false; }
  });
  const tracked = task.finally(() => { for (const host of hosts) { const count = registrationPins.get(host) || 0; if (count <= 1) registrationPins.delete(host); else registrationPins.set(host, count - 1); } });
  registrationQueue = tracked; return tracked;
}
function systemHost(record) {
  if (!isBody(record)) return record;
  return byIndex.get(record.parentStarIndex) || sun;
}
async function openSystemMap(record = selected, options = {}) {
  if (isPhenomenon(record)||record?.kind==='region') { exploreSystem(record); return; }
  if (!record || !sceneReady) return;
  input(); cancelJourney(); keys.clear();
  const host = systemHost(record), system = await generateForStar(host);
  await ensureRegistered(host);
  if (!system) return;
  let center = host;
  if (options.family && isBody(record)) center = childrenOf(record).length ? record : byId.get(String(record.parentId)) || host;
  mapScene = { system, host, center, original: {position:[...state.position],yaw:state.yaw,pitch:state.pitch,roll:state.roll,fov:state.fov,mode}, candidate:null, inner:false }; mapListLimit = 36; $('map-search').value = '';
  closePanel(); $('system-map').hidden = false; $('map-close').focus({ preventScroll: true });
  $('atlas').classList.add('mapping'); renderSystemMap(); flyToOverview();
}
function closeSystemMap(immediate = false) {
  if (!mapScene) return;
  if(immediate === true){mapScene=null;$('system-map').hidden=true;$('atlas').classList.remove('mapping');mode='free';updateMode();invalidate();return;}
  if(mapScene.closing)return;
  mapScene.closing=true;startMapMove(mapScene.original.position,mapScene.original,2.8);
}
function mapRecords() {
  if (!mapScene) return [];
  const { system, host, center } = mapScene;
  if (center.index !== host.index) return bodies.filter(body => String(body.parentId || body.parentBodyId) === String(center.id));
  return (system.bodyIds || []).map(id => byId.get(String(id))).filter(record => record && !String(record.kind).includes('moon'));
}
function svgElement(name, attributes = {}, content = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content) node.textContent = content; return node;
}
function renderSystemMap() {
  if (!mapScene) return;
  const { system, host, center } = mapScene;
  const query = $('map-search').value.trim().toLocaleLowerCase();
  const allRecords = query && center.index === host.index ? (system.bodyIds || []).map(id => byId.get(String(id))).filter(Boolean) : mapRecords();
  const records = allRecords.filter(record => (!mapScene.inner || length(sub(record.position,center.position))<4*AU_PC)).filter(record => !query || [friendly(record), record.id, bodyKind(record)].join(' ').toLocaleLowerCase().includes(query)).sort((a, b) => radius(b) - radius(a));
  const diagramRecords = records.filter(r=>query||!['asteroid','comet'].includes(r.kind)||r.index===mapScene.candidate?.index).slice(0,24), listRecords = records.slice(0, mapListLimit);
  setText('map-title', center.index === host.index ? system.name : `${friendly(center)} & its moons`);
  setText('map-subtitle', system.dataClass === 'generated-system' ? 'A persistent imagined system around a real catalog star. Confirmed worlds remain separately identified.' : 'Your ship is above the system. Select a world, then fly into its sky.');
  setText('map-data-note', system.dataClass === 'generated-system' ? 'Purple nodes are generated worlds, not discoveries. Their layouts are repeatable. Catalog star positions and separately labeled confirmed worlds keep their source data.' : 'Circular distance guides are aids, not orbital predictions. Positions and distances remain to scale. Solar positions use J2000 JPL ephemerides or labeled approximate mean-element placements. Many tiny moons have illustrative sizes. Exoplanet orientation and phase may be illustrative.');
  const families = document.createDocumentFragment();
  const familyTargets = [host, ...(system.bodyIds || []).map(id => byId.get(String(id))).filter(body => body && childrenOf(body).length)];
  for (const parent of familyTargets) { const button = document.createElement('button'); button.textContent = parent.index === host.index ? 'Whole system' : `${friendly(parent)} + moons`; button.setAttribute('aria-pressed', String(parent.index === center.index)); button.addEventListener('click', () => { mapScene.center = parent; mapScene.inner=false;mapScene.candidate=null;mapListLimit = 36; $('map-search').value = ''; renderSystemMap();flyToOverview(); }); families.append(button); }
  if(host.index===namedIndex.sun){const button=document.createElement('button');button.textContent='Inner planets';button.setAttribute('aria-pressed',String(mapScene.inner));button.onclick=()=>{mapScene.center=host;mapScene.inner=true;renderSystemMap();flyToOverview();};families.append(button);}
  $('map-families').replaceChildren(families);
  mapScene.records=diagramRecords;
  mapScene.axis=normalize(system.axis || system.belts?.[0]?.axis || [0,-.397777,.917482]);
  mapScene.guides=diagramRecords.map(record=>{
    const offset=sub(record.position,center.position),r=length(offset),a=normalize(offset);
    let b=normalize(cross(mapScene.axis,a));if(length(b)<.1)b=normalize(cross([1,0,0],a));
    return {record,points:Array.from({length:97},(_,i)=>add(center.position,scale(add(scale(a,Math.cos(i*Math.PI/48)),scale(b,Math.sin(i*Math.PI/48))),r)))};
  });
  drawSystemProjection(state);
  const list = document.createDocumentFragment();
  for (const record of [center, ...listRecords]) { const button = document.createElement('button'); button.className = 'map-world'; button.setAttribute('aria-label', `Select ${friendly(record)}`); const text = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small'), arrow = document.createElement('span'); name.textContent = friendly(record); detail.textContent = record.generated ? 'Generated world · persistent layout' : record.index === host.index ? 'Measured catalog star' : `${bodyKind(record)} · ${childrenOf(record).length ? childrenOf(record).length + ' moons' : appearanceLabel(record).toLowerCase()}`; text.append(name, detail); arrow.textContent = '↗'; button.append(text, arrow); button.addEventListener('click', () => chooseMapWorld(record)); list.append(button); }
  $('map-body-list').replaceChildren(list); $('map-more').hidden = listRecords.length >= records.length; setText('map-more', `Show ${Math.min(36, records.length - listRecords.length)} more worlds`); setText('map-count', `${allRecords.length} ${center.index === host.index ? 'WORLDS' : 'MOONS'}${allRecords.length > 24 ? ' · LARGEST 24 LABELED' : ''} · SELECT TO EXPLORE`);
}

function chooseMapWorld(record){
 if(!mapScene||mapScene.closing)return;
 mapScene.candidate=record;$('map-selection').hidden=false;setText('map-selected-name',friendly(record));
 const reference=mapScene.center.index===record.index?mapScene.host:mapScene.center;
 setText('map-selected-detail',record.generated?'Imagined world · repeatable system':bodyKind(record)+' · '+compactDistance(length(sub(record.position,reference.position)))+' from '+friendly(reference));
 setText('map-fly','Fly to '+friendly(record)+' ↗');$('map-focus').hidden=!childrenOf(record).length;
 drawSystemProjection(state);
}
function cameraForward(camera){const cp=Math.cos(camera.pitch);return [Math.sin(camera.yaw)*cp,Math.sin(camera.pitch),Math.cos(camera.yaw)*cp];}
function startMapMove(endpoint,look,duration){
 const source=nearestDeparture(navigationObstacles(mapScene.center));let points=[[...state.position]];
 if(source){const offset=sub(state.position,source.position);points.push(add(source.position,scale(normalize(offset),Math.max(length(offset)*3,radius(source)*8))));}
 points.push(endpoint);
 mapScene.move={route:safeWaypoints(points,navigationObstacles(mapScene.center)),start:{...state,position:[...state.position]},look,elapsed:0,duration:reducedMotion?0:duration};
 invalidate();
}
function flyToOverview(){
 const scene=mapScene;if(!scene)return;
 const axis=scene.axis,center=scene.center;
 const extent=Math.max(radius(center)*12,...mapRecords().filter(r=>!scene.inner||length(sub(r.position,center.position))<4*AU_PC).map(r=>length(sub(r.position,center.position))))*1.2;
 const aspect=state.cols/(state.rows*1.8),distance=extent/Math.tan(50*Math.PI/360)/Math.min(1,aspect)*1.65;
 const offset=normalize(add(axis,scale(normalize(cross(axis,[1,0,0])),.28)));
 const endpoint=add(center.position,scale(offset,distance));
 $('map-selection').hidden=true;scene.extent=extent;
 startMapMove(endpoint,{target:center.position,fov:50},5);
}
function updateMapMove(dt){
 const scene=mapScene,m=scene?.move;if(!m)return;
 m.elapsed+=dt;const t=m.duration?clamp(m.elapsed/m.duration,0,1):1,u=t*t*t*(10+t*(-15+6*t));
 state.position=pointOnRoute(m.route,m.route.length*u);
 const look=m.look.target?sub(m.look.target,state.position):cameraForward(m.look);
 blendLook(cameraForward(m.start),look,smooth(clamp(t/.8,0,1)));
 state.fov=m.start.fov+(m.look.fov-m.start.fov)*u;state.roll=m.start.roll+Math.atan2(Math.sin((m.look.roll||0)-m.start.roll),Math.cos((m.look.roll||0)-m.start.roll))*u;
 scene.reveal=scene.closing?1-u:smooth(clamp((t-.25)/.6,0,1));
 if(t===1){scene.move=null;if(scene.closing){Object.assign(state,{position:[...scene.original.position],yaw:scene.original.yaw,pitch:scene.original.pitch,roll:scene.original.roll,fov:scene.original.fov});mode=scene.original.mode;mapScene=null;$('system-map').hidden=true;$('atlas').classList.remove('mapping');if(mode==='orbit')orbitFromCamera();updateMode();viewport.focus({preventScroll:true});}else scene.reveal=1;}
}
function drawSystemProjection(camera){
 const scene=mapScene;if(!scene||!camera)return;
 const svg=$('map-svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
 const forward=cameraForward(camera),r=[-Math.cos(camera.yaw),0,Math.sin(camera.yaw)],v=cross(r,forward),right=add(scale(r,Math.cos(camera.roll||0)),scale(v,Math.sin(camera.roll||0))),up=sub(scale(v,Math.cos(camera.roll||0)),scale(r,Math.sin(camera.roll||0)));
 const ty=Math.tan(camera.fov*Math.PI/360),tx=ty*camera.cols/(camera.rows*1.8);
 const project=position=>{const d=sub(position,camera.position),z=dot(d,forward);if(z<=0)return null;return [displayBox.left+displayBox.width*(.5+dot(d,right)/(2*z*tx)),displayBox.top+displayBox.height*(.5-dot(d,up)/(2*z*ty))];};
  if(scene.svgGuides!==scene.guides){
    scene.svgGuides=scene.guides;const fragment=document.createDocumentFragment();
    scene.pathNodes=(scene.guides||[]).map(guide=>{const node=svgElement('path',{});fragment.append(node);return {guide,node};});
    scene.labelNodes=[scene.center,...(scene.records||[])].map(record=>{
      const group=svgElement('g',{class:'map-node'+(record.generated?' generated':'')+(record.index===scene.center.index?' map-host':''),tabindex:0,role:'button','aria-label':'Select '+friendly(record),'data-world':record.id||record.index});
      const leader=svgElement('path',{class:'map-leader'}),core=svgElement('circle',{r:record.index===scene.center.index?5:3,class:'node-core'}),hit=svgElement('rect',{width:Math.max(110,friendly(record).length*7+15),height:31,rx:4,class:'node-hit'}),name=svgElement('text',{},friendly(record)),kind=svgElement('text',{class:'node-kind'},record.generated?'GENERATED':bodyKind(record).toUpperCase());
      group.append(leader,core,hit,name,kind);group.onclick=()=>chooseMapWorld(record);group.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseMapWorld(record);}};fragment.append(group);return {record,group,leader,core,hit,name,kind};
    });svg.replaceChildren(fragment);
  }
  svg.style.opacity=String(scene.reveal??0);const occupied=[];
  for(const {guide,node} of scene.pathNodes){let path='';for(const point of guide.points){const p=project(point);if(!p){path='';break;}path+=(path?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1);}node.setAttribute('d',path);node.setAttribute('class','map-orbit'+(guide.record.generated?' generated':'')+(guide.record.index===scene.candidate?.index?' selected':''));}
  for(const {record,group,leader,core,hit,name,kind} of scene.labelNodes){
    const p=project(record.position);const visible=p&&p[0]>=-10&&p[0]<=width+10&&p[1]>=-10&&p[1]<=height+10;group.style.display=visible?'':'none';if(!visible)continue;
    let lx=clamp(p[0]+16,20,width-(width>700?315:160)),ly=clamp(p[1]-8,245,height-100);
    for(let i=0;i<28&&occupied.some(q=>Math.abs(q[0]-lx)<140&&Math.abs(q[1]-ly)<33);i++){
      ly+=34;if(ly>height-125){ly=260;lx=Math.max(20,lx-150);}
    }occupied.push([lx,ly]);
    leader.setAttribute('d',`M${p[0]},${p[1]}L${lx-5},${ly}`);core.setAttribute('cx',p[0]);core.setAttribute('cy',p[1]);hit.setAttribute('x',lx-7);hit.setAttribute('y',ly-15);name.setAttribute('x',lx);name.setAttribute('y',ly);kind.setAttribute('x',lx);kind.setAttribute('y',ly+13);
  }

}

function preparePhenomena(document) {
  phenomena = (document?.destinations || []).filter(record => Array.isArray(record.position)).map(record => ({ ...record, radius_pc: Number(record.radius_pc ?? record.radiusPc ?? record.modelUnitPc), search: [record.name, record.id, record.sceneKey, record.description, ...(record.aliases || [])].join(' ').toLocaleLowerCase() }));
  for (const record of phenomena) { byIndex.set(record.index, record); byId.set(String(record.id), record); }
}
function prepareDestination(record) {
  if (preparedScenes.has(record.index)) return preparedScenes.get(record.index);
  const id = ++ticketId;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { registrationRequests.delete(id); preparedScenes.delete(record.index); reject(new Error('This destination took too long to prepare. Select it again to retry.')); }, 45000);
    registrationRequests.set(id, { resolve, reject, timer }); worker.postMessage({ type: 'prepare-destination', id, destination: record });
  }).catch(error => { preparedScenes.delete(record.index); throw error; });
  preparedScenes.set(record.index, promise); return promise;
}
function applyInitialDestination() {
  const query = new URLSearchParams(location.search), id = query.get('destination');
  if(query.get('tour')==='grand'){startTour();return;}
  if (id) { const record = byId.get(id) || phenomena.find(item => item.sceneKey === id); if (record) beginJourney(record); }
  else if (query.get('category') === 'phenomena') { openPanel('destinations'); setCategory('phenomena'); }
}
function adaptiveGrid() {
  if (density !== 'adaptive') return;
  const aspect = width / Math.max(height, 1);
  const cols = clamp(Math.round(Math.min(240, 150 * aspect * 1.8) * quality), 40, 320);
  const rows = clamp(Math.round(cols / (aspect * 1.8)), 16, 160);
  if (cols !== state.cols || rows !== state.rows) { state.cols = cols; state.rows = rows; invalidate(); }
}
function resizeText(cols, rows) {
  const cell = Math.min(width / cols, height / (rows * 1.8));
  $('textscreen').style.fontSize = `${cell / .6}px`; $('textscreen').style.width = `${cols}ch`; $('textscreen').style.height = `${rows * 1.8}ch`;
}
const colorHex = (array, offset) => '#' + array[offset].toString(16).padStart(2, '0') + array[offset + 1].toString(16).padStart(2, '0') + array[offset + 2].toString(16).padStart(2, '0');
function drawText(frame) {
  const { cols, rows, glyphsUint8: g, foregroundRGBUint8: fg, backgroundRGBUint8: bg } = frame;
  if (textRows.length !== rows) {
    textRows = []; const fragment = document.createDocumentFragment();
    for (let y = 0; y < rows; y++) { const element = document.createElement('span'); element.className = 'text-row'; textRows.push({ element, cached: '' }); fragment.append(element); }
    $('textscreen').replaceChildren(fragment);
  }
  for (let y = 0; y < rows; y++) {
    const runs = []; let old = '', text = '', foreground = '', background = '';
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, f = colorHex(fg, i * 3), b = colorHex(bg, i * 3), key = f + b;
      if (key !== old && text) { runs.push([foreground, background, text]); text = ''; }
      old = key; foreground = f; background = b; text += String.fromCharCode(g[i]);
    }
    runs.push([foreground, background, text]); const signature = JSON.stringify(runs);
    if (textRows[y].cached === signature) continue;
    const fragment = document.createDocumentFragment();
    for (const [foreground, background, text] of runs) { const span = document.createElement('span'); span.style.color = foreground; span.style.backgroundColor = background; span.textContent = text; fragment.append(span); }
    if (y < rows - 1) fragment.append(document.createTextNode('\n'));
    textRows[y].element.replaceChildren(fragment); textRows[y].cached = signature;
  }
  resizeText(cols, rows);
}
function updateLabels(labels) {
  const active = new Set();
  if (showLabels && !travel) for (const label of labels || []) {
    const record = label.index === -2 ? earth : byIndex.get(label.index);
    if (!record || label.index === selected?.index || active.size >= 5 || label.x < .05 || label.x > .95 || label.y < .12 || label.y > .68) continue;
    active.add(label.index); let button = labelButtons.get(label.index);
    if (!button) { button = document.createElement('button'); button.className = 'star-label'; button.textContent = friendly(record); button.setAttribute('aria-label', `Select ${friendly(record)}`); button.addEventListener('click', event => { event.stopPropagation(); input(); cancelJourney(); selectObject(record, { look: true }); openPanel('destinations'); $('star-search').value = friendly(record); renderSearch(); }); $('labels').append(button); labelButtons.set(label.index, button); }
    button.hidden = false; const alignLeft = label.x > .75; button.classList.toggle('left', alignLeft); button.style.transform = `translate3d(${displayBox.left + label.x * displayBox.width}px,${displayBox.top + label.y * displayBox.height}px,0)${alignLeft ? ' translateX(-100%)' : ''}`;
  }
  for (const [index, button] of labelButtons) if (!active.has(index)) button.hidden = true;
}
function displayFrame(data, ticket) {
  const started = performance.now(), { cols, rows } = data.stats, count = cols * rows;
  const frame = { cols, rows, glyphsUint8: new Uint8Array(data.buffer, 0, count),
    foregroundRGBUint8: new Uint8Array(data.buffer, count, count * 3), backgroundRGBUint8: new Uint8Array(data.buffer, count * 4, count * 3) };
  if (displayMode === 'text') drawText(frame); else presenter.render(frame);
  const aspect = cols / (rows * 1.8), boxWidth = Math.min(width, height * aspect), boxHeight = boxWidth / aspect;
  displayBox = { width: boxWidth, height: boxHeight, left: (width - boxWidth) / 2, top: (height - boxHeight) / 2 };
  latestFrame = frame; latestStats = data.stats; updateLabels(mapScene?[]:data.labels); if(mapScene)drawSystemProjection(ticket.camera);
  $('atlas').classList.add('ready'); if (!failedDestination) $('error').hidden = true;
  const now = performance.now(), compute = Number(data.stats.worker_ms ?? data.stats.frame_ms ?? 0);
  metrics.frames++; metrics.computeMs = Number(data.stats.frame_ms ?? compute); metrics.displayMs = now - started; metrics.workerRoundtripMs = now - ticket.started;
  if (lastDisplayAt) remember(metrics.frameIntervals, now - lastDisplayAt); lastDisplayAt = now;
  remember(metrics.computeTimes, metrics.computeMs); remember(metrics.displayTimes, metrics.displayMs);
  if (ticket.inputSerial > displayedInputSerial) { remember(metrics.inputLatencyMs, now - ticket.inputAt); displayedInputSerial = ticket.inputSerial; }
  const cost = compute + metrics.displayMs;
  costAverage = costAverage ? costAverage * .9 + cost * .1 : cost;
  if (density === 'adaptive') {
    if (metrics.frames>30 && now - lastQualityChange > 750 && costAverage > 13 && quality > .55) { quality = Math.max(.55, quality * .8); lastQualityChange = now; adaptiveGrid(); }
    // Hold the arrival grid while its scene animates. Raising it every 1.5 s
    // rebuilt cached optics and changed the footprint of every distant light.
    else if (!travel && data.stats.active_scene==='atlas' && now - lastQualityChange > 1500 && costAverage < 8 && quality < 1) { quality = Math.min(1, quality * 1.10); lastQualityChange = now; adaptiveGrid(); }
  }
}
function requestFrame(now) {
  if (!workerReady || !sceneReady || pending || !presenter || registrationPending) return;
  if (displayMode === 'text' && now - lastRequestAt < 1000 / 15) return;
  const signature = paused && !travel ? JSON.stringify(state) : '';
  if (signature && signature === lastSignature) return;
  lastSignature = signature; lastRequestAt = now;
  pending = { id: ++ticketId, generation, started: now, inputSerial, inputAt: acceptedInputAt, camera: {...state, position:[...state.position]} };
  worker.postMessage({ type: 'frame', id: pending.id, state });
}
async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!presenter) presenter = new GlyphDisplay($('glyphscreen'));
    if (worker) worker.terminate(); workerReady = false; sceneReady = false; pending = null;
    for (const request of registrationRequests.values()) { clearTimeout(request.timer); request.reject(new Error('The atlas is restarting. Choose the destination again.')); }
    registrationRequests.clear(); preparedScenes.clear(); registrationPins.clear(); registrationSignature = ''; registrationPending = false; registrationQueue = Promise.resolve(); generatedSystems.clear(); travel = null; mapScene = null; $('system-map').hidden = true;
    worker = new Worker('/atlas-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { setText('loading-message', data.message || 'Loading the stellar catalog…'); return; }
      if (data.type === 'system-ready' || data.type === 'destination-ready') { const request = registrationRequests.get(data.id); if (request) { registrationRequests.delete(data.id); clearTimeout(request.timer); request.resolve(data); } return; }
      if (data.type === 'ready') { workerReady = true; $('survey-mode').disabled=!data.surveyAvailable;if(!data.surveyAvailable){state.surveyMode=0;$('survey-mode').value='0';setText('survey-status','Gaia catalog is still compiling. This view currently uses the original HYG catalog.');} setText('catalog-count', fmt.format(data.catalogCount || data.stats?.catalog_stars || 0)); invalidate(); return; }
      if (data.type === 'error' || data.type === 'destination-error') { const registration = registrationRequests.get(data.id); if (registration) { registrationRequests.delete(data.id); clearTimeout(registration.timer); registration.reject(new Error(data.message || data.error || 'This system could not be loaded.')); return; } pending = null; lastSignature = ''; showError(data.message || data.error || 'The atlas could not produce a frame.'); if (!workerReady) initPromise = null; return; }
      if (data.type === 'pick') {
        const record = data.index === -2 ? earth : byIndex.get(data.index) || data.star;
        if (record) { if (!record.name) record.name = `Catalog star ${record.id ?? record.index}`; input(); cancelJourney(); selectObject(record, { look: false }); orbitFromCamera(); }
        return;
      }
      if (data.type !== 'frame') return;
      const ticket = pending; pending = null;
      if (!ticket || ticket.id !== data.id || ticket.generation !== generation) return;
      if(data.earthOrientation&&earth)earth.axis=data.earthOrientation.axis;
      try { displayFrame(data, ticket); } catch (error) { showError(error.message); }
    };
    worker.onerror = event => { workerReady = false; pending = null; initPromise = null; showError(event.message || 'The local atlas could not start.'); };
    worker.postMessage({ type: 'init' });
    if (!generatorModule) generatorModule = import('./system-generator.js');
    const [catalogResponse, solarResponse, manifestResponse, systemsResponse, surfacesResponse, phenomenaResponse] = await Promise.all([fetch('/artifacts/atlas-search.json'), fetch('/artifacts/solar.json'), fetch('/artifacts/atlas.json'), fetch('/artifacts/systems.json'), fetch('/artifacts/surface-metadata.json'), fetch('/artifacts/phenomena-destinations.json')]);
    await generatorModule;
    if (!catalogResponse.ok || !solarResponse.ok) throw Error('The star catalog or Earth metadata could not be loaded.');
    const [catalog, solar, manifest, planetarySystems, surfaces, phenomenaDocument] = await Promise.all([catalogResponse.json(), solarResponse.json(), manifestResponse.ok ? manifestResponse.json() : Promise.resolve(null), systemsResponse.ok ? systemsResponse.json() : Promise.resolve(null), surfacesResponse.ok ? surfacesResponse.json() : Promise.resolve({}), phenomenaResponse.ok ? phenomenaResponse.json() : Promise.resolve({})]);
    surfaceMetadata = surfaces;
    searchDocument = catalog;
    resolveLandmarks(catalog.stars || []);
    stars = (catalog.stars || []).filter(record => Array.isArray(record.position) && record.position.length === 3).map(record => ({ ...record,
      name: record.name || `Catalog star ${record.id ?? record.index}`,
      search: [record.name, friendly(record), ...(record.aliases || []), record.hip ? `HIP ${record.hip}` : '', record.id ? `HYG ${record.id}` : ''].join(' ').toLocaleLowerCase() }));
    byIndex.clear(); for (const record of stars) byIndex.set(record.index, record);
    earth = { ...solar.earth, index: -2, name: 'Earth', radius_pc: Number(solar.earth.radiusPc), position: solar.earth.position, spect: '', search: 'earth home solar system' };
    sun = byIndex.get(namedIndex.sun) || { index: 0, name: 'Sun', position: [0, 0, 0], radius_pc: SOLAR_RADIUS_PC, spect: 'G2 V', search: 'sun sol' }; byIndex.set(sun.index, sun); namedIndex.sun = sun.index;
    setText('epoch-note', `${solar.epoch || 'J2000'} · positions and sunlight geometry. Earth’s orientation follows the UTC clock at its real rotation rate, using IAU precession/nutation. UTC approximates UT1; live polar motion is omitted. Pause holds the clock.`);
    setText('provenance', 'Gaia DR3 adds quality-filtered nearby observations plus LMC candidates. Nearby distances use inverse parallax; LMC depths use a reconstructed inclined disk. Gaia colors and stellar sizes are illustrative, and the sample is incomplete. Survey mode removes the authored wider galaxy. Named and cataloged stars use HYG positions. The wider Milky Way uses authored light samples at finite positions in the simulation, so the view changes as you travel. These samples illustrate the Galactic disk and core; they are not measured stars or additional catalog discoveries. Solar positions are fixed J2000 ephemerides or explicitly approximate moon orbits. Alpha Centauri A and B, Proxima, and Sirius use cited measured radii; other stellar radii are illustrative estimates. Stellar surfaces and colors are illustrative. Earth, Moon and Mars use compiled NASA surface maps. Other surfaces are illustrative. Generated systems around catalog stars are imagined, repeatable layouts; they are not claimed discoveries.');
    const credit = $('license-note'); credit.replaceChildren();
    const link = (label, href) => { const anchor = document.createElement('a'); anchor.textContent = label; anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor; };
    credit.append(link('Gaia DR3 · ESA/Gaia/DPAC', 'https://www.cosmos.esa.int/web/gaia/dr3'), document.createElement('br'));
    credit.append(link('HYG 4.2 · Astronomy Nexus', manifest?.source?.project || 'https://www.astronexus.com/projects/hyg'), document.createTextNode(' · '), link('CC BY-SA 4.0', manifest?.source?.license_url || 'https://creativecommons.org/licenses/by-sa/4.0/'), document.createElement('br'));
    if(solar.earth.emission)credit.append(link('NASA Black Marble 2016 · night lights',solar.earth.emission.source.page),document.createElement('br'));
    credit.append(link('NASA Earth Observatory', solar.earth.appearanceSource?.url || 'https://earthobservatory.nasa.gov/'), document.createTextNode(' · Reto Stockli and Robert Simmon.'), document.createElement('br'));
    credit.append(link('Earth position: JPL Horizons', solar.earth.positionSource?.url || 'https://ssd.jpl.nasa.gov/horizons/'), document.createTextNode(' · fixed J2000 epoch.'));
    if (manifest?.appearance?.curated_radii?.stars) { const sources = Object.values(manifest.appearance.curated_radii.stars); const seen = new Set(); for (const source of sources) { if (seen.has(source.url)) continue; seen.add(source.url); credit.append(document.createElement('br'), link(source.citation || source.name, source.url)); } }

    prepareSystems(planetarySystems); preparePhenomena(phenomenaDocument);
    const a=80.8939*Math.PI/180,d=-69.7561*Math.PI/180;
    const cloud={id:'large-magellanic-cloud',index:2000000,name:'Large Magellanic Cloud',kind:'region',position:[Math.cos(d)*Math.cos(a)*49590,Math.cos(d)*Math.sin(a)*49590,Math.sin(d)*49590],radius_pc:2500,radiusPc:2500,viewDistanceRadii:6,description:'A neighboring dwarf galaxy, home to VFTS 352 and the Tarantula stellar nursery. Gaia supplies the stars’ observed sky positions and light; individual depths are reconstructed.',search:'large magellanic cloud lmc tarantula gaia'};
    byId.set(cloud.id,cloud);byIndex.set(cloud.index,cloud);stars.push(cloud); sceneReady = true; homeCamera(); buildQuickDestinations(); renderSearch(); adaptiveGrid(); applyInitialDestination();
  })().catch(error => { initPromise = null; generatorModule = null; showError(error.message); });
  return initPromise;
}
function updateMotion(dt) {
  if(tour?.paused)return;
  if (travel) { updateJourney(dt); return; }
  const h = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  const v = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
  const horizontal=h*Math.cos(state.roll)-v*Math.sin(state.roll),vertical=h*Math.sin(state.roll)+v*Math.cos(state.roll);
  if (mode === 'orbit') {
    const target = orbit.targetRadius ?? orbit.radius, difference = Math.log(target / orbit.radius);
    const dollying = orbit.radius !== target;
    if (dollying) orbit.radius = Math.abs(difference) < 1e-6 ? target : orbit.radius * Math.exp(difference * (1 - Math.exp(-dt * 14)));
    if (horizontal || vertical) { orbit.azimuth += horizontal * dt * .6; orbit.elevation = clamp(orbit.elevation + vertical * dt * .6, -1.48, 1.48); }
    if (dollying || horizontal || vertical) syncOrbit();
  } else {
    state.yaw -= horizontal * dt * .7; state.pitch = clamp(state.pitch + vertical * dt * .7, -1.5, 1.5);
    const f = Number(keys.has('KeyW')) - Number(keys.has('KeyS')), r = Number(keys.has('KeyD')) - Number(keys.has('KeyA')), u = Number(keys.has('KeyR')) - Number(keys.has('KeyV'));
    const magnitude = Math.hypot(f, r, u);
    if (magnitude) { const { forward, right, up } = cameraBasis(), amount = dt * flightSpeed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 8 : 1) / magnitude;
      state.position = state.position.map((value, axis) => value + amount * (f * forward[axis] + r * right[axis] + u * up[axis]));
      for (const body of navigationObstacles(selected)) { const offset = sub(state.position, body.position), minimum = navigationRadius(body) * 1.025; if (length(offset) < minimum) state.position = add(body.position, scale(length(offset) > 1e-25 ? normalize(offset) : [0, 0, 1], minimum)); }
    }
  }
}
function hud(now, force = false) {
  if (!selected || (!force && now - lastHudAt < 180)) return; lastHudAt = now;
  if(selected.id==='earth')setText('object-facts',`PLANET · NASA MAP · ${new Date(state.earthUtcMs).toISOString().slice(11,19)} UTC${paused?' · HELD':''}`);
  const distance = length(sub(state.position, selected.position)), body = isBody(selected);
  const model = isPhenomenon(selected), blackhole = selected.sceneKind === 'blackhole';
  const modelDistance = distance / radius(selected), closeModel = model && !travel && modelDistance <= (blackhole ? 150 : 80);
  const shown = closeModel ? { value: modelDistance.toFixed(2), unit: blackhole ? 'SCHWARZSCHILD RADII' : 'MODEL UNITS' } : distanceLabel(body && !model ? Math.max(0, distance - radius(selected)) : distance);
  const bodyLabel = distance > radius(selected) * 10000 ? `DISTANCE FROM ${friendly(selected).toUpperCase()}` : 'ABOVE THE SURFACE';
  setText('distance-label', selected.kind==='region'?'DISTANCE TO CLOUD CENTER':model ? (travel ? 'DISTANCE TO DESTINATION' : blackhole ? 'DISTANCE TO BLACK HOLE' : closeModel ? 'MODEL VIEW' : 'DISTANCE TO DESTINATION') : body ? bodyLabel : 'DISTANCE TO STAR'); setText('distance-value', shown.value); setText('distance-unit', shown.unit);
  if (travel) setText('journey-detail', `${compactDistance(length(sub(travel.endpoint, state.position)))} remaining · ${Math.max(0, travel.duration - travel.elapsed).toFixed(1)} seconds of your journey`);
  setText('speed-readout', mode === 'free' && !travel ? `${compactDistance(flightSpeed)}/s · FLIGHT SPEED` : 'A REAL, NAVIGABLE SKY');
  setText('grid-readout', `${state.cols} × ${state.rows}${density === 'adaptive' ? ' · AUTO' : ''}`);
  const intervals = metrics.frameIntervals.slice(-35), mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  setText('fps-readout', paused && !travel && !pending ? 'TIME PAUSED' : mean ? `${Math.round(1000 / mean)} FPS` : 'LIVE');
  if (!$('observatory-panel').hidden && !$('panel').hidden) {
    setText('compute-ms', metrics.computeMs.toFixed(2) + ' ms'); setText('display-ms', metrics.displayMs.toFixed(2) + ' ms'); setText('camera-distance', compactDistance(length(state.position)));
  }
}
function tick(now) {
  const dt = Math.min(.075, Math.max(0, (now - lastTick) / 1000)); lastTick = now;
  if (!document.hidden && sceneReady && workerReady) { if (!paused) {state.time += dt;state.earthUtcMs=Date.now()-earthClockOffset;} if(mapScene)updateMapMove(dt);else {updateTour(dt);updateMotion(dt);updateCameraRoll(dt);}hud(now);requestFrame(now); }
  requestAnimationFrame(tick);
}
function northRoll(axis){
 const forward=cameraForward(state),right=[-Math.cos(state.yaw),0,Math.sin(state.yaw)],up=cross(right,forward);
 return Math.atan2(-dot(axis,right),dot(axis,up));
}
function updateCameraRoll(dt){
 if(tour?.paused||paused&&!travel)return;
 const nearEarth=selected?.id==='earth'&&length(sub(state.position,selected.position))<radius(selected)*500;
 const target=nearEarth?northRoll(selected.axis||[0,0,1]):0;
 const delta=Math.atan2(Math.sin(target-state.roll),Math.cos(target-state.roll));state.roll+=delta*(1-Math.exp(-dt*5));
 if(Math.abs(delta)<1e-7)state.roll=target;
}
function look(dx, dy) {
 const c=Math.cos(state.roll),s=Math.sin(state.roll),x=dx;dx=c*dx+s*dy;dy=-s*x+c*dy;
  input(); cancelJourney();
  if (mode === 'orbit') { orbit.azimuth += dx * .004; orbit.elevation = clamp(orbit.elevation + dy * .004, -1.48, 1.48); syncOrbit(); }
  else { state.yaw += dx * .004; state.pitch = clamp(state.pitch + dy * .004, -1.5, 1.5); }
}
function zoom(amount) {
  input(); cancelJourney();
  if (mode === 'orbit') {
    const target = orbit.targetRadius ?? orbit.radius;
    // Keep nearby inspection precise, then cross astronomical scales with
    // progressively larger logarithmic steps. Motion itself is eased by the
    // camera loop; the wheel never changes the field of view.
    const blackhole = selected.sceneKind === 'blackhole';
    const scale = smooth(clamp(Math.log10(Math.max(1, target / (radius(selected) * (blackhole ? 150 : 1)))) / (blackhole ? 3 : 6), 0, 1));
    const gain = blackhole ? 1 + scale * 6 : 1.4 + scale * 5.6;
    const maximum = length(selected.position) <= 100000 ? 150000 : 1e10;
    orbit.targetRadius = clamp(target * Math.exp(clamp(amount * gain, -1.25, 1.25)), minimumOrbitRadius(selected), maximum);
  }
  else flightSpeed = clamp(flightSpeed * Math.exp(amount * 2), 1e-13, 1e5);
}
function snapshot(ansi = false) {
  if (!latestFrame) return;
  const { cols, rows, glyphsUint8: g, foregroundRGBUint8: fg, backgroundRGBUint8: bg } = latestFrame;
  let text = '';
  for (let y = 0; y < rows; y++) { let old = ''; for (let x = 0; x < cols; x++) { const i = y * cols + x, k = i * 3;
    if (ansi) { const escape = `\x1b[38;2;${fg[k]};${fg[k + 1]};${fg[k + 2]}m\x1b[48;2;${bg[k]};${bg[k + 1]};${bg[k + 2]}m`; if (escape !== old) { text += escape; old = escape; } }
    text += String.fromCharCode(g[i]); } text += (ansi ? '\x1b[0m' : '') + '\n'; }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a');
  link.href = url; link.download = (selected ? friendly(selected).toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-') : 'star-atlas') + (ansi ? '.ansi' : '.txt'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('atlas').requestFullscreen(); } catch { showError('Fullscreen is unavailable in this window.'); } }
function formTarget(target) { return target instanceof Element && Boolean(target.closest('input,select,textarea,button,a,[contenteditable="true"]')); }
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { if (mapScene) { closeSystemMap(); return; } cancelJourney(); closePanel(); keys.clear(); return; }
  if (mapScene) {
    if (event.code === 'Tab') { const focusable = [...$('system-map').querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter(node => node.getClientRects().length); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    return;
  }
  if (formTarget(event.target)) return;
  if (event.key === '?') { event.preventDefault(); openPanel('observatory'); return; }
  if (event.code === 'Slash') { event.preventDefault(); openPanel('destinations'); return; }
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) setPaused(!paused); return; }
  if (event.code === 'KeyO') { event.preventDefault(); input(); cancelJourney(); setMode(mode === 'orbit' ? 'free' : 'orbit'); return; }
  if (event.code === 'KeyM') { event.preventDefault(); openSystemMap(selected).catch(error => showError(error.message)); return; }
  if (event.code === 'KeyL') { event.preventDefault(); lookAtSun(); return; }
  if (event.code === 'KeyF') { event.preventDefault(); if (!event.repeat) fullscreen(); return; }
  if (event.code === 'KeyT') { event.preventDefault(); if (!event.repeat) snapshot(event.shiftKey); return; }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyV', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
    event.preventDefault(); input(); cancelJourney();
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyV'].includes(event.code)) setMode('free');
    keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); pointers.clear(); viewport.classList.remove('dragging'); });
document.addEventListener('visibilitychange', () => { keys.clear(); lastTick = performance.now(); });
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('button') || !sceneReady || mapScene) return;
  if(tour)cancelJourney();
  viewport.focus({ preventScroll: true }); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  viewport.setPointerCapture(event.pointerId); viewport.classList.add('dragging'); dragOrigin = { x: event.clientX, y: event.clientY, moved: false };
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); }
});
viewport.addEventListener('pointermove', event => {
  const previous = pointers.get(event.pointerId); if (!previous) return;
  const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (dragOrigin && Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) > 5) dragOrigin.moved = true;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y); if (distance > 0 && pinchDistance > 0) zoom(Math.log(pinchDistance / distance)); pinchDistance = distance; }
  else if (pointers.size === 1 && dragOrigin?.moved) look(dx, dy);
});
function releasePointer(event) {
  if (event.type === 'pointerup' && pointers.size === 1 && dragOrigin && !dragOrigin.moved && workerReady && !travel) {
    const x = (event.clientX - displayBox.left) / displayBox.width, y = (event.clientY - displayBox.top) / displayBox.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) worker.postMessage({ type: 'pick', id: ++ticketId, x, y });
  }
  pointers.delete(event.pointerId); if (pointers.size < 2) pinchDistance = 0;
  if (!pointers.size) { viewport.classList.remove('dragging'); dragOrigin = null; }
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, releasePointer);
viewport.addEventListener('wheel', event => { if (!sceneReady) return; event.preventDefault(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1; zoom(clamp(event.deltaY * unit * .0015, -.5, .5)); }, { passive: false });
$('primary-journey').addEventListener('click', () => beginJourney(currentPrimaryTarget));
$('destinations').addEventListener('click', () => openPanel('destinations')); $('search-open').addEventListener('click', () => openPanel('destinations'));
$('info-open').addEventListener('click', () => openPanel('observatory')); $('help-footer').addEventListener('click', () => openPanel('observatory'));
$('tab-destinations').addEventListener('click', () => openPanel('destinations')); $('tab-observatory').addEventListener('click', () => openPanel('observatory')); $('close-panel').addEventListener('click', closePanel);
$('star-search').addEventListener('input', renderSearch);
for (const button of document.querySelectorAll('[data-category]')) button.addEventListener('click', () => setCategory(button.dataset.category, button.dataset.category === 'systems' ? 'centauri-trio' : ''));
$('fly-preview').addEventListener('click', () => beginJourney(previewed, { view: arrivalView }));
$('inspect-preview').addEventListener('click', () => beginJourney(previewed, { inspect: true, view: arrivalView }));
$('inspect-selected').addEventListener('click', () => beginJourney(selected, { inspect: true }));
$('night-side').addEventListener('click',()=>beginJourney(earth,{view:'night',duration:5}));
$('tour-open').addEventListener('click',startTour);
$('tour-stop').addEventListener('click',()=>{cancelJourney();viewport.focus({preventScroll:true});});
$('tour-next').addEventListener('click',()=>nextTourStop());
$('tour-pause').addEventListener('click',()=>{if(tour){tour.paused=!tour.paused;showTour();}});
$('explore-system').addEventListener('click', () => openSystemMap(selected, { family: isBody(selected) }).catch(error => showError(error.message)));
$('phenomena-open').addEventListener('click', () => { openPanel('destinations'); setCategory('phenomena'); });
$('phenomena-feature').addEventListener('click', () => { openPanel('destinations'); setCategory('phenomena'); });
$('blackhole-open').addEventListener('click', () => { const record = phenomena.find(item => item.sceneKind === 'blackhole'); if (record) beginJourney(record); else { openPanel('destinations'); setCategory('phenomena'); } });
$('system-map-open').addEventListener('click', () => openSystemMap(selected).catch(error => showError(error.message)));
$('map-search').addEventListener('input', () => { mapListLimit = 36; renderSystemMap(); });
$('map-more').addEventListener('click', () => { mapListLimit += 36; renderSystemMap(); });
$('map-preview').addEventListener('click', () => openSystemMap(previewed, { family: isBody(previewed) }).catch(error => showError(error.message)));
$('map-close').addEventListener('click', () => closeSystemMap());
$('map-fly').addEventListener('click',()=>{const record=mapScene?.candidate;if(record)beginJourney(record);});
$('map-focus').addEventListener('click',()=>{const record=mapScene?.candidate;if(record&&childrenOf(record).length){mapScene.center=record;mapScene.inner=false;mapScene.candidate=null;renderSystemMap();flyToOverview();}});
for (const button of document.querySelectorAll('[data-arrival-view]')) button.addEventListener('click', () => { arrivalView = button.dataset.arrivalView; document.querySelectorAll('[data-arrival-view]').forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button))); });
$('mode-toggle').addEventListener('click', () => { input(); cancelJourney(); setMode(mode === 'orbit' ? 'free' : 'orbit'); viewport.focus({ preventScroll: true }); });
$('look-sun').addEventListener('click', () => { lookAtSun(); viewport.focus({ preventScroll: true }); });
$('pause').addEventListener('click', () => { setPaused(!paused); viewport.focus({ preventScroll: true }); }); $('pause-setting').addEventListener('change', event => setPaused(event.target.checked));
$('cancel-journey').addEventListener('click', cancelJourney);
$('resume-journey').addEventListener('click', () => { if (resumeTarget) beginJourney(resumeTarget); });
$('dismiss-resume').addEventListener('click', () => { resumeTarget = null; $('resume-card').hidden = true; }); $('reset-earth').addEventListener('click', () => beginJourney(earth));
$('survey-mode').addEventListener('change', event => { input(); state.surveyMode=Number(event.target.value); invalidate(); });
$('density').addEventListener('change', event => { input(); density = event.target.value; quality = 1; if (density === 'adaptive') adaptiveGrid(); else [state.cols, state.rows] = density.split(',').map(Number); invalidate(); });
$('exposure').addEventListener('input', event => { input(); state.exposure = Number(event.target.value); setText('exposure-value', state.exposure.toFixed(1) + '×'); invalidate(); });
$('show-labels').addEventListener('change', event => { showLabels = event.target.checked; if (!showLabels) updateLabels([]); invalidate(); });
$('display-mode').addEventListener('change', event => { displayMode = event.target.value; $('glyphscreen').hidden = displayMode === 'text'; $('textscreen').hidden = displayMode !== 'text'; invalidate(); });
$('save-text').addEventListener('click', () => snapshot()); $('save-ansi').addEventListener('click', () => snapshot(true)); $('fullscreen').addEventListener('click', fullscreen);
$('retry').addEventListener('click', () => { invalidate(); if (failedDestination) { const record = failedDestination; failedDestination = null; beginJourney(record); } else if (!workerReady || !sceneReady) init(); });
$('cancel-preparing').addEventListener('click', cancelJourney);
new ResizeObserver(entries => { width = entries[0].contentRect.width; height = entries[0].contentRect.height; adaptiveGrid(); if (latestFrame && displayMode === 'text') resizeText(latestFrame.cols, latestFrame.rows); }).observe(viewport);
window.__atlas = { state, metrics, beginJourney, cancelJourney, selectObject, setPaused, lookAtSun, homeCamera, snapshot,
  get tour(){return tour;}, tourStops, startTour, nextTourStop,
  get ready() { return sceneReady && workerReady; }, get selected() { return selected; }, get travel() { return travel; },
  get journey() { return travel; }, get resumeTarget() { return resumeTarget; }, resumeJourney() { if (resumeTarget) beginJourney(resumeTarget); },
  get data() { return { frame: latestFrame, stats: latestStats }; }, get destinations() { return { earth, sun, ...Object.fromEntries(Object.entries(namedIndex).map(([key, index]) => [key, byIndex.get(index)])), ...Object.fromEntries([...bodies, ...phenomena].map(body => [body.id, body])) }; },
  get phenomena() { return phenomena; }, get systems() { return systems; }, get map() { return mapScene; }, openSystemMap, closeSystemMap, generateForStar, ensureRegistered, get bodies() { return bodies; }, get previewed() { return previewed; }, previewTarget, setCategory, exploreSystem,
  get catalog() { return searchDocument; }, get mode() { return mode; }, get paused() { return paused; }, get displayMode() { return displayMode; } };
window.__compiledAtlas = window.__atlas;
window.__compiledAtlas.travelTo = beginJourney;
window.__compiledAtlas.selectTarget = selectObject;
window.__compiledAtlas.inspect = record => beginJourney(record || selected, { inspect: true });
window.__compiledAtlas.returnEarth = options => beginJourney(earth, options);
init(); requestAnimationFrame(tick);
