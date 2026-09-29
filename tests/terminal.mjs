// Exercise the actual local WASM worker, navigation, UI, and terminal protocol.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Universe} from '../terminal/universe.mjs';
import {Interface} from '../terminal/interface.mjs';
import {InputParser} from '../terminal/input.mjs';
import {Grid,encodeANSI} from '../terminal/display.mjs';
import {saveFrame} from '../terminal/main.mjs';
import {project,radius,length,sub,minimumOrbitRadius} from '../terminal/navigation.mjs';
import {tourStops} from '../terminal/tour.mjs';

const report={passed:false,scenes:[],maps:[]},u=new Universe(),ui=new Interface(u);
const printable=frame=>assert.ok(frame.glyphs.every(c=>c>=32&&c<=126),'Every scene and UI cell must be printable ASCII');
const settle=()=>{for(let i=0;i<800&&(u.travel||u.map?.move);i++)u.tick(.1);assert.ok(!u.travel&&!u.map?.move,'Camera must complete the maneuver');};
const shot=async name=>{const frame=await u.frame(),grid=ui.render(frame);printable(grid);await saveFrame(grid,fileURLToPath(new URL(`../validation/terminal-${name}`,import.meta.url)));return frame;};
try{
 await u.init();u.resize(120,42);assert.equal(u.selected.id,'earth');
 assert.equal(u.resolve('Moon').id,'moon');assert.ok(u.search('Sirius').length);assert.equal(u.search('crab','phenomena').length,2);
 await shot('earth');
 const before=[...u.state.position];await u.fly('moon');u.tick(.1);assert.notDeepEqual(u.state.position,before);assert.ok(u.travel);settle();
 assert.equal(u.mode,'orbit');assert.ok(length(sub(u.state.position,u.selected.position))/radius(u.selected)>1);
 const cruising=[...u.state.position];u.tick(.1);assert.notDeepEqual(u.state.position,cruising,'Moon cruise moves the camera');
 u.brake();const held=[...u.state.position];u.tick(.1);assert.deepEqual(u.state.position,held,'B holds the orbit position');
 u.brake();u.tick(.1);assert.notDeepEqual(u.state.position,held,'B resumes cruise');
 const moon=await shot('moon'),repeat=await u.engine.request({type:'frame',state:moon.camera});
 assert.deepEqual(new Uint8Array(moon.buffer),new Uint8Array(repeat.buffer),'Terminal sky must equal the unmodified browser worker cell for cell');
 report.exactSharedRenderer=true;
 const oldRadius=u.orbit.radius;u.zoom(-.2);for(let i=0;i<20;i++)u.tick(.1);assert.ok(u.orbit.radius<oldRadius);u.look(.1,.02);assert.ok(u.state.position.every(Number.isFinite));
 for(const size of [[120,42],[60,40],[80,24]]){
  u.resize(...size);const original={...u.state,position:[...u.state.position]};await u.openMap();settle();
  const area=u.mapLayout(),points=u.map.guides.flat().map(p=>project(p,u.state));
  assert.ok(points.every(p=>p&&p[0]>=0&&p[0]<=1&&p[1]*size[1]>=area.top&&p[1]*size[1]<=area.bottom),`System must fit above the dock at ${size}`);
  await shot(`map-${size.join('x')}`);report.maps.push({cols:size[0],rows:size[1],orbits:u.map.guides.length});
  u.family(u.earth);settle();assert.deepEqual(u.mapRecords().map(r=>r.id),['moon']);
  await shot(`moons-${size.join('x')}`);
  u.closeMap();settle();assert.equal(u.map,null);assert.deepEqual(u.state.position,original.position);assert.equal(u.state.fov,original.fov);
 }
 u.resize(120,42);await u.openMap();settle();u.family(u.earth);settle();const grid=ui.render(await u.frame()),hit=grid.hits.find(h=>h.label==='Moon');assert.ok(hit);
 ui.mouse({code:0,x:hit.x,y:hit.y});ui.mouse({code:0,x:hit.x,y:hit.y,release:true});
 for(let i=0;i<100&&u.preparing;i++)await delay(10);
 assert.equal(u.map,null);assert.equal(u.selected.id,'moon');assert.ok(u.travel);settle();
 await u.fly('Sirius',{instant:true});await u.openMap();settle();
 assert.ok(u.map.system.bodies.some(b=>b.generated));const planet=u.map.system.bodies.find(b=>b.kind==='planet');
 await shot('sirius-system');await u.fly(planet,{instant:true});const world=await shot('generated-world');assert.ok(world.stats.surface_cells>20);report.generatedWorld=planet.name;
 // Cancellation must win even while a destination is asynchronously prepared.
 const pending=u.fly('sagittarius-a');u.cancel();await pending;assert.equal(u.travel,null);assert.equal(u.selected.index,planet.index);
 for(const d of u.phenomena){await u.fly(d,{instant:true});const frame=await shot(d.id);assert.equal(frame.stats.active_destination,d.index);assert.equal(frame.stats.active_scene,d.sceneKind);assert.ok(frame.stats.local_cells>0);report.scenes.push({name:d.name,frameMs:frame.stats.frame_ms,localCells:frame.stats.local_cells});}
 u.orbit.radius=u.orbit.target=minimumOrbitRadius(u.selected);u.syncOrbit();u.free();const nearHole=[...u.state.position];u.move(0,0,-1);assert.notDeepEqual(u.state.position,nearHole,'Free flight must escape the close-approach safety margin');
 await u.fly('moon',{instant:true});await u.fly('sagittarius-a');assert.ok(u.travel.closeApproach);u.tick(1/30);const progress=u.travel.elapsed;
 u.tour={index:8,paused:true};u.tick(.1);assert.equal(u.travel.elapsed,progress);u.pause();settle();u.cancel();assert.equal(u.selected.id,'sagittarius-a');
 await u.startTour();for(let i=0;i<tourStops.length;i++){assert.equal(u.selected.id,tourStops[i].id);settle();printable(await u.frame());await u.nextTour();}assert.equal(u.tour,null);report.tourStops=tourStops.length;
 // Input survives arbitrary boundaries, including split mouse reports/pastes.
 const events=[],parser=new InputParser(e=>events.push(e));
 for(const chunk of ['\x1b','[A','\x1b[<0;12;','7M','\x1b[<0;12;7m','\x1b[200~Si','rius\x1b[2','01~','\x03'])parser.feed(chunk);
 assert.equal(events[0].key,'up');assert.deepEqual([events[1].x,events[1].y],[11,6]);assert.equal(events[2].release,true);assert.equal(events[3].text,'Sirius');assert.equal(events[4].key,'ctrl-c');
 parser.feed('\x1b');await delay(60);assert.equal(events.at(-1).key,'escape');parser.close();
 const a=new Grid(60,20);a.text(4,7,'Moon',[12,34,56],[3,4,5]);const b=new Grid(60,20,a);b.text(5,7,'O',[12,34,57],[3,4,5]);
 assert.equal(encodeANSI(a,a),'');const delta=encodeANSI(b,a);assert.ok(delta.startsWith('\x1b[8;6H'));assert.ok(delta.endsWith('O'));assert.ok(delta.length<60);
 assert.ok(encodeANSI(a,null,'256').includes('38;5;'));assert.ok(!encodeANSI(a,null,'none').includes('38;'));
 report.inputAndDeltaOutput=true;report.passed=true;
}finally{await u.close();await mkdir(new URL('../validation/',import.meta.url),{recursive:true});await writeFile(new URL('../validation/terminal-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
