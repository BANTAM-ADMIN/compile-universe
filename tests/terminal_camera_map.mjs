// Regression coverage for the user's orbit failure and wide/short map capture.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Universe} from '../terminal/universe.mjs';
import {Interface} from '../terminal/interface.mjs';
import {saveFrame} from '../terminal/main.mjs';
import {basis,project,length,sub,dot,forward,radius} from '../terminal/navigation.mjs';

const u=new Universe(),ui=new Interface(u),report={orbits:[],maps:[]};
const pose=()=>({position:[...u.state.position],yaw:u.state.yaw,pitch:u.state.pitch,roll:u.state.roll,fov:u.state.fov});
const settle=()=>{for(let i=0;i<800&&(u.travel||u.map?.move);i++)u.tick(.1);assert.ok(!u.travel&&!u.map?.move);};
const centered=()=>{const p=project(u.selected.position,u.state);assert.ok(p&&Math.abs(p[0]-.5)<1e-6&&Math.abs(p[1]-.5)<1e-6,`Target drift: ${p}`);};
const capture=async name=>{const frame=await u.frame(),g=ui.render(frame);await saveFrame(g,fileURLToPath(new URL(`../validation/terminal-fixed-${name}`,import.meta.url)));return g;};
try{
 await u.init();
 for(const id of ['earth','moon','Sirius','sagittarius-a']){
  await u.fly(id,{instant:true});u.state.roll=1.2;
  const r=length(sub(u.state.position,u.selected.position));
  for(let i=0;i<180;i++){
   const before=[...u.state.position],b=basis(u.state);u.look(.055,.035);u.tick(1/60);centered();
   assert.ok(dot(sub(u.state.position,before),b.right)>0,'Right orbits in screen-right direction, including a rolled camera');
   assert.ok(Math.abs(length(sub(u.state.position,u.selected.position))/r-1)<1e-5,'Orbit must not spiral inward/outward');
  }
  for(const key of ['a','d','r','f','left','right','up','down']){ui.key(key);u.tick(1/60);assert.equal(u.mode,'orbit');centered();}
  ui.key('w');for(let i=0;i<30;i++)u.tick(.1);assert.equal(u.mode,'orbit');centered();assert.ok(u.orbit.radius<r);
  ui.key('s');for(let i=0;i<30;i++)u.tick(.1);assert.equal(u.mode,'orbit');centered();
  ui.key('o');assert.equal(u.mode,'free');const b=basis(u.state);u.look(.2,0);assert.ok(dot(forward(u.state),b.right)>0,'Free-flight right must look right');
  ui.key('o');assert.equal(u.mode,'orbit');centered(); // Re-entry locks immediately.
  const poleRadius=u.orbit.radius;u.state.position=[...u.selected.position];u.state.position[2]+=poleRadius;u.align(u.selected.position);u.state.roll=0;u.orbitFromCamera();
  let minimumUpDot=1;
  for(let i=0;i<300;i++){const up=basis(u.state).up;u.look(0,.025);u.tick(1/60);centered();minimumUpDot=Math.min(minimumUpDot,dot(up,basis(u.state).up));}
  assert.ok(minimumUpDot>.999,'Crossing a pole must not flip or trap the camera');
  report.orbits.push({id,locked:true,poleAndRollCoverage:true,minimumUpDot,modePreserved:true});
 }
 u.home();
 for(const [cols,rows]of[[150,26],[120,42],[80,24],[60,20],[60,40]]){
  u.resize(cols,rows);u.zoom(-.2);const original=pose();await u.openMap();settle();
  const settled=pose();for(let i=0;i<180;i++)u.tick(.1);
  assert.deepEqual(pose(),settled,'Settled map must resist stale orbit zoom and north-up roll updates');
  assert.equal(u.mapRecords().length,8,'Default chart shows all eight planets');
  const layout=u.mapLayout(),points=u.map.guides.flat().map(p=>project(p,u.state));
  assert.ok(points.every(p=>p&&p[0]>=0&&p[0]<=1&&p[1]*rows>=layout.top&&p[1]*rows<=layout.bottom),'All physical orbits must fit above the dock');
  let g=await capture(`map-${cols}x${rows}`);
  assert.ok(g.glyphs.every(c=>c>=32&&c<=126));
  assert.ok(!g.plain().includes(':::::'),'No long label leaders or leftover star-field bands');
  const cells=g.glyphs.subarray(layout.top*cols,(layout.bottom+1)*cols),density=cells.filter(c=>c!==32).length/cells.length;
  assert.ok(density<.55,`Chart overcrowded: ${density}`);
  const itemHits=g.hits.filter(h=>h.kind==='map-item');
  if(cols===150){assert.equal(itemHits.length,9,'The short wide dock must fit Sun and all planets');assert.ok(ui.mapDrawing.inset,'Wide chart should resolve inner planets in its spare space');}
  // Every advertised click target must still have a complete visible label.
  for(const h of g.hits.filter(h=>h.kind==='map-item'||h.kind==='map-label')){
   const text=String.fromCharCode(...g.glyphs.subarray(h.y*cols+h.x,h.y*cols+h.x+h.w));assert.equal(text,'['+h.label.slice(0,h.w-2)+']',`Overwritten label ${h.label}`);
  }
  report.maps.push({cols,rows,density,listed:itemHits.length,inset:!!ui.mapDrawing.inset});
  ui.mapScope('inner');settle();assert.deepEqual(u.mapRecords().map(r=>r.id),['mercury','venus','earth','mars']);await capture(`inner-${cols}x${rows}`);
  ui.mapScope('all');settle();assert.ok(u.mapRecords().some(r=>r.id==='ceres'));assert.ok(u.mapRecords().some(r=>r.id==='pluto'));assert.ok(u.mapRecords().some(r=>r.kind==='comet'));
  await capture(`all-${cols}x${rows}`);ui.key('pagedown');ui.render(await u.frame());assert.ok(ui.mapIndex>0);assert.ok(ui.grid.hits.some(h=>h.kind==='map-item'&&h.index===ui.mapList()[ui.mapIndex].index));
  u.family(u.earth);ui.mapIndex=1;settle();g=await capture(`moon-family-${cols}x${rows}`);assert.ok(g.hits.some(h=>h.label==='Moon'));
  u.closeMap();settle();assert.deepEqual(pose(),original,'Closing the map restores the pre-map camera');
 }
 u.look(.2,.1);const manualRoll=u.state.roll;await u.openMap();settle();u.closeMap();let maxRollStep=0;while(u.map){const before=u.state.roll;u.tick(1/60);maxRollStep=Math.max(maxRollStep,Math.abs(Math.atan2(Math.sin(u.state.roll-before),Math.cos(u.state.roll-before))));}assert.ok(maxRollStep<.06,'Map return must interpolate the saved roll without an arrival snap');report.mapReturnMaxRollStep=maxRollStep;for(let i=0;i<50;i++)u.tick(.1);assert.ok(u.orbit.manual);assert.equal(u.state.roll,manualRoll,'Map return preserves manual camera-up');
 // Click an inset world, return to normal fly mode and actually reach it.
 u.resize(150,26);await u.openMap();settle();let g=await capture('click');
 let hit=g.hits.find(h=>h.kind==='map-label'&&h.label==='Earth'&&h.x<40);assert.ok(hit,'The inset itself must be interactive');
 ui.mouse({code:0,x:hit.x,y:hit.y});ui.mouse({code:0,x:hit.x,y:hit.y,release:true});
 for(let i=0;i<100&&u.preparing;i++)await delay(10);
 assert.equal(u.map,null);assert.equal(u.selected.id,'earth');assert.ok(u.travel);settle();centered();
 // The same map modes and selection work for generated systems and moons.
 await u.fly('Sirius',{instant:true});await u.openMap();settle();g=await capture('sirius');assert.ok(u.mapRecords().length>=3);
 const parent=u.mapRecords().find(r=>u.children(r).length);assert.ok(parent);u.family(parent);settle();await capture('sirius-moons');
 const moon=u.mapRecords()[0];await u.fly(moon);settle();centered();assert.ok((await u.frame()).stats.surface_cells>0);
 report.generatedMoon=moon.name;report.passed=true;
}finally{await u.close();await writeFile(new URL('../validation/terminal-camera-map-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
