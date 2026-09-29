/** Real wheel input traverses from Earth to a useful external Galactic view. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const root = new URL('../',import.meta.url), origin=process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8781';
const browser=await chromium.launch({headless:true}),errors=[],report={milestones:[]};
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message)); await page.goto(origin);
  await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
  const start=await page.evaluate(()=>{
    const a=__atlas;a.setPaused(true);window.zoomPath=[];window.recordZoom=true;
    const collect=()=>{const a=__atlas;zoomPath.push({radius:Math.hypot(...a.state.position.map((v,i)=>v-a.selected.position[i])),fov:a.state.fov,time:a.state.time});if(recordZoom)requestAnimationFrame(collect);};
    requestAnimationFrame(collect);
    return {position:[...a.state.position],center:[...a.selected.position],radius:a.selected.radius_pc,time:a.state.time,fov:a.state.fov};
  });
  await page.mouse.move(1100,350);
  const thresholds=[['solar',Math.PI/(180*3600)],['neighborhood',1],['disk',1000],['galaxy',25000]];
  let steps=0;
  for(;steps<48;steps++) {
    await page.mouse.wheel(0,100); await page.waitForTimeout(80);
    const sample=await page.evaluate(()=>{const a=__atlas;return {radius:Math.hypot(...a.state.position.map((v,i)=>v-a.selected.position[i])),grid:[a.state.cols,a.state.rows],visibleGlyphs:a.data.frame.glyphsUint8.reduce((n,ch)=>n+(ch!==32),0),stats:a.data.stats};});
    while(thresholds.length&&sample.radius>=thresholds[0][1]) {
      const [name]=thresholds.shift(); report.milestones.push({name,steps:steps+1,...sample});
      await page.screenshot({path:new URL(`artifacts/galaxy-zoom-${name}.png`,root).pathname});
    }
    if(!thresholds.length)break;
  }
  assert.equal(thresholds.length,0,'A short sequence of wheel steps must cross planetary, stellar and Galactic scales');
  for(let i=0;i<8;i++){await page.mouse.wheel(0,100);await page.waitForTimeout(40);}
  await page.waitForTimeout(1100);
  const end=await page.evaluate(()=>{window.recordZoom=false;const a=__atlas;return {position:[...a.state.position],radius:Math.hypot(...a.state.position.map((v,i)=>v-a.selected.position[i])),fov:a.state.fov,time:a.state.time,selected:a.selected.id,mode:a.mode,label:document.querySelector('#distance-label').textContent,path:zoomPath};});
  assert.equal(end.selected,'earth');assert.equal(end.mode,'orbit');assert.equal(end.fov,start.fov);assert.equal(end.time,start.time);
  assert.ok(Math.abs(end.radius-150000)<2,'Earth pullback stops at the external Milky Way scale');
  assert.equal(end.label,'DISTANCE FROM EARTH');
  const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
  const before=normalize(start.position.map((v,i)=>v-start.center[i])),after=normalize(end.position.map((v,i)=>v-start.center[i]));
  const north=[-.8676661490190047,-.1980763734312015,.4559837761750669];
  assert.ok(after.reduce((sum,v,i)=>sum+v*north[i],0)>.6,'External view rises above the Galactic plane');
  assert.ok(Math.hypot(...before.map((v,i)=>v-after[i]))>.1,'Pullback deliberately changes its bearing');
  let largestFrameFactor=1;
  for(let i=1;i<end.path.length;i++) {
    assert.ok(end.path[i].radius>=end.path[i-1].radius*(1-1e-8));
    largestFrameFactor=Math.max(largestFrameFactor,end.path[i].radius/end.path[i-1].radius);
  }
  assert.ok(largestFrameFactor<2.2,'Wheel notches are eased through successive world positions');
  const frames=await page.evaluate(()=>__atlas.metrics.frames);
  await page.mouse.wheel(0,-100);await page.waitForTimeout(500);
  assert.ok(await page.evaluate(radius=>Math.hypot(...__atlas.state.position.map((v,i)=>v-__atlas.selected.position[i]))<radius*.8,end.radius));
  assert.ok(await page.evaluate(frames=>__atlas.metrics.frames>frames,frames));
  report.stepsToGalacticScale=steps+1;report.maximumRadiusPc=end.radius;report.largestFrameFactor=largestFrameFactor;
  report.constantFov=end.fov;report.pausedCameraMoves=true;
  // The compiled lens has a finite domain, but its boundary is not a camera
  // wall. Actual wheel input must leave it for the same spatial universe.
  await page.evaluate(()=>__atlas.travelTo('sagittarius-a',{instant:true}));
  await page.waitForFunction(()=>__atlas.data.stats.active_scene==='blackhole');
  await page.mouse.move(1100,350);
  for(let i=0;i<32;i++){await page.mouse.wheel(0,100);await page.waitForTimeout(40);if(await page.evaluate(()=>__atlas.data.stats.active_scene==='atlas'))break;}
  await page.waitForFunction(()=>__atlas.data.stats.active_scene==='atlas',null,{timeout:10000});
  const outside=await page.evaluate(()=>({radius:Math.hypot(...__atlas.state.position.map((v,i)=>v-__atlas.selected.position[i]))/__atlas.selected.radius_pc,scene:__atlas.data.stats.active_scene,fov:__atlas.state.fov,unit:document.querySelector('#distance-unit').textContent,label:document.querySelector('#distance-label').textContent}));
  assert.ok(outside.radius>4096,'Zooming out of Sagittarius A* must cross the lookup boundary');
  assert.equal(outside.scene,'atlas');assert.equal(outside.fov,40);
  assert.equal(outside.unit,'ASTRONOMICAL UNITS');assert.equal(outside.label,'DISTANCE TO BLACK HOLE');
  for(let i=0;i<32;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(40);if(await page.evaluate(()=>__atlas.data.stats.active_scene==='blackhole'&&Math.hypot(...__atlas.state.position.map((v,i)=>v-__atlas.selected.position[i]))/__atlas.selected.radius_pc<150))break;}
  await page.waitForFunction(()=>__atlas.data.stats.active_scene==='blackhole',null,{timeout:10000});
  await page.waitForFunction(()=>Math.hypot(...__atlas.state.position.map((v,i)=>v-__atlas.selected.position[i]))/__atlas.selected.radius_pc<150,null,{timeout:10000});
  const returned=await page.evaluate(()=>({radius:Math.hypot(...__atlas.state.position.map((v,i)=>v-__atlas.selected.position[i]))/__atlas.selected.radius_pc,scene:__atlas.data.stats.active_scene,fov:__atlas.state.fov,unit:document.querySelector('#distance-unit').textContent}));
  assert.ok(returned.radius>=6.05&&returned.radius<8192);assert.equal(returned.scene,'blackhole');assert.equal(returned.fov,40);
  assert.equal(returned.unit,'SCHWARZSCHILD RADII');
  report.blackholeBoundary={outside,returned};
  report.errors=errors;assert.deepEqual(errors,[]);report.passed=true;
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();await writeFile(new URL('artifacts/galaxy-zoom-browser.json',root),JSON.stringify(report,null,2)+'\n');}
