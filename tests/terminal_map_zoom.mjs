// Exercise map zoom through the real camera, WASM scene and terminal controls.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Universe} from '../terminal/universe.mjs';
import {Interface} from '../terminal/interface.mjs';
import {Grid} from '../terminal/display.mjs';
import {saveFrame} from '../terminal/main.mjs';
import {project,length,sub,radius} from '../terminal/navigation.mjs';

const u=new Universe(),ui=new Interface(u),report={maps:[],passed:false};
const pose=()=>({position:[...u.state.position],yaw:u.state.yaw,pitch:u.state.pitch,roll:u.state.roll,fov:u.state.fov});
const settle=()=>{
 for(let i=0;i<1200&&(u.travel||u.map?.move||u.map&&u.map.zoom!==u.map.zoomTarget);i++)u.tick(1/30);
 assert.ok(!u.travel&&!u.map?.move&&(!u.map||u.map.zoom===u.map.zoomTarget),'Camera and zoom must settle');
};
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
const anchored=(before)=>{const p=project(u.map.center.position,u.state);assert.ok(p);p.forEach((v,i)=>near(v,before[i],1e-5));};
const render=async()=>ui.render(await u.frame());
const capture=async name=>{const g=await render();await saveFrame(g,fileURLToPath(new URL(`../validation/terminal-zoom-${name}`,import.meta.url)));return g;};
const checkLabels=g=>{
 for(const h of g.hits.filter(h=>h.kind==='map-label'||h.kind==='map-item')){
  const shown=String.fromCharCode(...g.glyphs.subarray(h.y*g.cols+h.x,h.y*g.cols+h.x+h.w));
  assert.equal(shown,'['+h.label.slice(0,h.w-2)+']',`Covered click target: ${h.label}`);
 }
};
try{
 // Even a segment with both ends outside must cross only the chart rectangle.
 const clipped=new Grid(60,20),region={left:8,right:48,top:4,bottom:10};
 clipped.line(-1e8,7,1e8,7,'-',undefined,region);
 assert.equal(clipped.plain().split('\n')[7].slice(8,49),'-'.repeat(41));
 clipped.line(20,-1e8,20,1e8,'|',undefined,region);
 for(let y=0;y<20;y++)for(let x=0;x<60;x++)if(x<8||x>48||y<4||y>10)assert.equal(clipped.glyphs[y*60+x],32);
 await u.init();
 for(const [cols,rows]of[[150,26],[120,42],[80,24],[60,20],[60,40]]){
  u.resize(cols,rows);const original=pose();await u.openMap();
  // Inputs during the opening flight are queued instead of interrupting it.
  const opening=u.map.move;ui.key('+');assert.equal(u.map.move,opening);settle();assert.ok(u.map.zoom>1);
  ui.key('0');settle();const fitPose=pose(),center=project(u.map.center.position,u.state),distance=length(sub(u.state.position,u.map.center.position));
  await render();const selection=ui.mapIndex;
  ui.mouse({wheel:true,code:64,x:Math.floor(cols/2),y:8});
  assert.equal(ui.mapIndex,selection,'Wheel zoom must not change selection');
  assert.deepEqual(pose(),fitPose,'Zoom input must not jump the camera');
  u.tick(1/60);assert.ok(u.map.zoom>1&&u.map.zoom<u.map.zoomTarget);assert.equal(u.map.move,null);anchored(center);
  const during=await render();assert.ok(ui.mapDrawing.nodes.length,'Guides stay visible during zoom');checkLabels(during);
  settle();assert.ok(length(sub(u.state.position,u.map.center.position))<distance);anchored(center);
  ui.key('=');ui.key('+');ui.key('-');settle();assert.ok(u.map.zoom>1);
  ui.key('home');settle();near(length(sub(u.state.position,u.map.center.position))/distance,1);anchored(center);
  ui.mouse({wheel:true,code:65,x:10,y:8});settle();assert.ok(u.map.zoom<1,'Wheel down pulls back');
  const fitButton=(await render()).hits.find(h=>h.label==='fit 0');assert.ok(fitButton);
  ui.mouse({code:0,x:fitButton.x,y:fitButton.y});ui.mouse({code:0,x:fitButton.x,y:fitButton.y,release:true});settle();assert.equal(u.map.zoom,1);
  for(const label of ['+','-']){const hit=(await render()).hits.find(h=>h.label===label);assert.ok(hit);hit.action();settle();}
  near(u.map.zoom,1);
  u.zoom(-Math.log(8));settle();anchored(center);let g=await capture(`${cols}x${rows}-8x`);checkLabels(g);
  // Outer orbits may leave the chart; they must not paint over the dock/header.
  const {top,bottom}=u.mapLayout();
  for(const h of g.hits.filter(h=>h.kind==='map-label'||h.kind==='map-node'))assert.ok(h.y>=top&&h.y<=bottom);
  const earthBefore=project(u.earth.position,{...fitPose,cols,rows}),earthAfter=project(u.earth.position,u.state);
  const separation=p=>Math.hypot((p[0]-center[0])*cols,(p[1]-center[1])*rows);
  assert.ok(earthBefore&&earthAfter&&separation(earthAfter)>separation(earthBefore)*7,'Zoom must actually spread the projected planets apart');
  report.maps.push({cols,rows,zoom:u.map.zoom,labels:ui.mapDrawing.labels.length});
  u.zoom(-1000);const zoomBefore=u.map.zoom;u.tick(1/60);assert.ok(u.map.zoom/zoomBefore<=Math.exp(4/60)+1e-12,'Rapid scroll bursts have bounded zoom speed');settle();
  assert.equal(u.map.zoom,u.map.zoomMax);assert.ok(length(sub(u.state.position,u.map.center.position))>radius(u.map.center)*2.5);anchored(center);checkLabels(await render());
  u.zoom(1000);settle();assert.equal(u.map.zoom,.2);anchored(center);checkLabels(await capture(`${cols}x${rows}-out`));
  const stable=pose();for(let i=0;i<60;i++)u.tick(1/30);assert.deepEqual(pose(),stable,'Idle zoom must stop updating the camera');
  u.closeMap();const closing=u.map.move;ui.key('+');ui.key('0');settle();assert.ok(closing);assert.equal(u.map,null);assert.deepEqual(pose(),original,'Exit restores the pre-map view after any zoom');
 }
 // Scope/family changes fit the new chart; resize keeps the chosen magnification.
 u.resize(150,26);await u.openMap();settle();u.zoom(-Math.log(3));settle();
 u.resize(60,20);settle();near(u.map.zoom,3);const area=u.mapLayout(),p=project(u.map.center.position,u.state);near(p[1]*20,(area.top+area.bottom)/2);
 ui.mapScope('inner');settle();assert.equal(u.map.zoom,1);u.zoom(-.4);settle();
 ui.mapScope('all');settle();assert.equal(u.map.zoom,1);u.zoom(-.4);settle();checkLabels(await render());
 u.family(u.earth);settle();assert.equal(u.map.zoom,1);u.zoom(-.5);settle();checkLabels(await render());
 u.closeMap();settle();
 // A label from the zoomed camera must still launch an actual flight.
 u.resize(150,26);await u.openMap();settle();u.zoom(-Math.log(8));settle();let g=await render();
 let hit=g.hits.find(h=>h.kind==='map-label'&&h.label==='Earth');assert.ok(hit,'Earth should be selectable in the zoomed chart');
 ui.mouse({code:0,x:hit.x,y:hit.y});ui.mouse({code:0,x:hit.x,y:hit.y,release:true});
 for(let i=0;i<100&&u.preparing;i++)await delay(10);
 assert.equal(u.map,null);assert.equal(u.selected.id,'earth');assert.ok(u.travel);settle();
 // Generated systems also retain their center at map zoom precision.
 await u.fly('Sirius',{instant:true});await u.openMap();settle();const anchor=project(u.map.center.position,u.state);u.zoom(-Math.log(4));settle();anchored(anchor);checkLabels(await capture('sirius'));
 const parent=u.mapRecords().find(r=>u.children(r).length);u.family(parent);settle();assert.equal(u.map.zoom,1);
 u.zoom(-Math.log(2));settle();checkLabels(await capture('sirius-moons'));
 report.passed=true;
}finally{await u.close();await writeFile(new URL('../validation/terminal-map-zoom-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
