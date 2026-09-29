/** Exercise the production flight functions without a browser or renderer. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../web/atlas.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../artifacts/phenomena-destinations.json', import.meta.url), 'utf8'));
const solar = JSON.parse(await readFile(new URL('../artifacts/solar.json', import.meta.url), 'utf8'));
const destination = manifest.destinations.find(record => record.id === 'sagittarius-a');
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`), next = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0, `Missing production function ${name}`);
  return source.slice(start, next < 0 ? source.length : next);
}
function simulate(text, direction = null, secondsPerFrame = 1 / 120, target = destination) {
  const approachFunction=text.includes('function localApproach(')?'localApproach':'blackholeApproach';
  const context = vm.createContext({ Math, destination: target, solar, direction, secondsPerFrame });
  const helpers = text.slice(text.indexOf('const clamp ='), text.indexOf('function remember('));
  const functions = ['radius', 'isPhenomenon', 'navigationRadius', 'segmentDistance', 'safeWaypoints', 'pointOnRoute', 'remainingAtRadius',
    ...(text.includes('function phenomenonWaypoints(') ? ['phenomenonWaypoints'] : []),
    ...(text.includes('function blackholeWaypoints(') ? ['blackholeWaypoints'] : []), approachFunction, 'alignTo', 'blendLook', 'updateJourney'];
  vm.runInContext(`${helpers}
    const SOLAR_RADIUS_PC=2.25461e-8, AU_PC=Math.PI/(180*3600), reducedMotion=false;
    const $=()=>({style:{},classList:{toggle(){}}}), setText=()=>{}, friendly=record=>record.name;
    let travel; const state={position:[0,0,0],yaw:0,pitch:0,fov:50};
    function finishJourney(){state.fov=travel.targetFov;travel=null;}
    ${functions.map(name => functionSource(text, name)).join('\n')}
    const earth={...solar.earth,index:-2,radius_pc:solar.earth.radiusPc};
    const light=normalize(scale(earth.position,-1));
    const offset=normalize([light[0]*.95-light[1]*.31,light[0]*.31+light[1]*.95,light[2]+.10]);
    const start=direction ? add(destination.position,scale(normalize(direction),8277)) : add(earth.position,scale(offset,radius(earth)*3.4));
    const endpoint=add(destination.position,scale(normalize(destination.viewDirection),radius(destination)*destination.viewDistanceRadii));
    const points=[start];
    if (!direction) points.push(add(earth.position,scale(offset,radius(earth)*8.4)));
    if(typeof blackholeWaypoints==='function') points.push(...blackholeWaypoints(points[points.length-1],endpoint,destination));
    if(typeof phenomenonWaypoints==='function') points.push(...phenomenonWaypoints(points[points.length-1],endpoint,destination));
    points.push(endpoint);
    const route=safeWaypoints(points,[destination,earth,{index:0,position:[0,0,0],radius_pc:SOLAR_RADIUS_PC}]);
    const leg=route.length*.035;
    travel={route,leg,elapsed:0,duration:18,sameTarget:false,source:direction?null:earth,destination,
      nearStart:radius(earth)*1.5,nearEnd:radius(destination)*2,endpoint,
      fromYaw:Math.atan2(-offset[0],-offset[2]),fromPitch:Math.atan2(-offset[1],Math.hypot(offset[0],offset[2])),
      closeApproach:${approachFunction}(destination,route,18,false,leg),baseFov:50,targetFov:40};
    const envelope={...travel.closeApproach}, rows=[];
    while(travel){updateJourney(secondsPerFrame); const offset=sub(state.position,destination.position);
      rows.push({time:travel?.elapsed??18,position:[...state.position],radius:length(offset)/radius(destination),
        bearing:normalize(offset),yaw:state.yaw,pitch:state.pitch,fov:state.fov});}
    globalThis.result={rows,envelope,waypoints:route.points.length,unit:radius(destination)};`, context);
  return JSON.parse(JSON.stringify(context.result));
}
function summarize(result) {
  const near = result.rows.filter(row => row.time >= 9), speeds = [], angularSpeeds = [], visibleAngularSpeeds = [];
  for (let i = 1; i < near.length; i++) {
    const a = near[i - 1], b = near[i], dt = b.time - a.time;
    if (dt < 1e-5) continue;
    const dot = a.bearing.reduce((sum, value, axis) => sum + value * b.bearing[axis], 0);
    const cross = [a.bearing[1]*b.bearing[2]-a.bearing[2]*b.bearing[1],a.bearing[2]*b.bearing[0]-a.bearing[0]*b.bearing[2],a.bearing[0]*b.bearing[1]-a.bearing[1]*b.bearing[0]];
    const angularSpeed = Math.atan2(Math.hypot(...cross), dot) * 180 / Math.PI / dt;
    angularSpeeds.push(angularSpeed); if (b.radius < 80) visibleAngularSpeeds.push(angularSpeed);
    speeds.push({ time: (a.time + b.time) / 2, radius: b.radius,
      velocity: b.position.map((v,axis) => (v-a.position[axis])/result.unit/dt) });
  }
  const pre = speeds.filter(row => row.time < 10).at(-1), post = speeds.find(row => row.time >= 10);
  return { maxAngularDegreesPerSecondLast5: Math.max(...angularSpeeds),
    maxAngularDegreesPerSecondWithin80: Math.max(...visibleAngularSpeeds),
    speedBefore10: Math.hypot(...pre.velocity), speedAfter10: Math.hypot(...post.velocity),
    radiusAt10: result.rows.find(row => row.time >= 10).radius,
    radiusAt12: result.rows.find(row => row.time >= 12).radius,
    radiusAt18: result.rows.at(-1).radius, waypoints: result.waypoints };
}
const current = simulate(source);
assert.ok(current.rows.every(row => Number.isFinite(row.yaw) && Number.isFinite(row.pitch)), 'The entire camera turn must have a finite bearing');
const report = { current: summarize(current) };
report.otherPhenomena = Object.fromEntries(manifest.destinations.filter(record => record.sceneKind === 'phenomenon')
  .map(record => [record.id, summarize(simulate(source, null, 1 / 120, record))]));
if (process.env.BASELINE_SOURCE) report.previous = summarize(simulate(await readFile(process.env.BASELINE_SOURCE, 'utf8')));
assert.ok(report.current.maxAngularDegreesPerSecondLast5 < .02, 'The final view must remain steady before lensing starts');
assert.ok(Math.abs(report.current.radiusAt10 - 4096) < 1);
assert.ok(Math.abs(report.current.radiusAt12 - 432) < 5);
assert.ok(Math.abs(report.current.radiusAt18 - 24) < .00001);
assert.ok(Math.abs(report.current.speedAfter10 / report.current.speedBefore10 - 1) < .03, 'Match velocity through the 4096Rs handoff');
for (const [id, result] of Object.entries(report.otherPhenomena)) {
  const tolerance = id === 'vfts-352' ? .05 : .02; // Float64 world positions: subpixel rounding at49kpc.
  assert.ok(result.maxAngularDegreesPerSecondWithin80 < tolerance, `${id} must settle its viewing bearing before the close-up`);
  const record = manifest.destinations.find(item => item.id === id);
  const rows = simulate(source, null, 1 / 60, record).rows.filter(row => row.time >= 9);
  for (let i=1;i<rows.length;i++) assert.ok(rows[i].radius <= rows[i-1].radius + .00001, `${id} must not overshoot and back out`);
}
for (const direction of [[0, 0, -1], [0, 1, 0], destination.viewDirection.map(v => -v)]) {
  const run = simulate(source, direction, 1 / 60), summary = summarize(run);
  assert.ok(Math.min(...run.rows.map(row => row.radius)) > 23.99, 'Opposite-side arrivals must never cut through the black hole');
  assert.ok(summary.maxAngularDegreesPerSecondLast5 < .02);
}
// The production clock bounds one camera step to 75ms after a delayed frame.
// Verify that braking remains monotonic even at that unusually low cadence.
const delayed = simulate(source, null, .075).rows.filter(row => row.time >= 10);
for (let i=1;i<delayed.length;i++) assert.ok(delayed[i].radius <= delayed[i-1].radius + .001);
report.passed = true;
await writeFile(new URL('../artifacts/flight-route-math.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
