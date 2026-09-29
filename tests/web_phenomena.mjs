/** Unified atlas destinations: real animated travel, local views, and recovery. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const origin=process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8781';
const browser=await chromium.launch({headless:true}),errors=[],report={scenes:[],journeys:[]};
async function open(page,path='/'){
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+path);
 await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
}
async function next(page){const n=await page.evaluate(()=>__atlas.metrics.frames);await page.waitForFunction(n=>__atlas.metrics.frames>n,n);}
async function arrived(page,id){
 await page.waitForFunction(id=>!__atlas.journey&&__atlas.selected.id===id&&__atlas.data.stats.active_destination===__atlas.selected.index,id,{timeout:30000});
 await next(page);
}
async function inspect(page,id){await page.evaluate(id=>__atlas.travelTo(id,{instant:true}),id);await arrived(page,id);}
async function sampleFlight(page,id){
 await page.waitForFunction(id=>__atlas.journey?.destination.id===id,id,{timeout:45000});
 const start=await page.evaluate(()=>{
  window.tripSamples=[];window.tripTimer=setInterval(()=>{const a=__atlas;tripSamples.push({position:[...a.state.position],elapsed:a.journey?.elapsed,scene:a.data.stats.active_scene,active:a.data.stats.active_destination,blend:a.data.stats.blend,localDistance:a.data.stats.local_distance_model,lit:a.data.frame.glyphsUint8.reduce((n,ch)=>n+(ch!==32),0),cells:a.data.frame.cols*a.data.frame.rows});},80);
  return {at:performance.now(),frames:__atlas.metrics.frames,duration:__atlas.journey.duration,start:__atlas.journey.start,endpoint:__atlas.journey.endpoint};
 });
 assert.ok(start.duration>=10,'Distant destinations must use an actual animated journey');
 await arrived(page,id);
 const end=await page.evaluate(()=>{clearInterval(tripTimer);return {at:performance.now(),frames:__atlas.metrics.frames,samples:tripSamples,position:__atlas.state.position,target:__atlas.selected,stats:__atlas.data.stats};});
 assert.ok(end.samples.length>40,'Trip must present moving frames');
 // An exterior source-facing departure can turn through genuinely empty sky.
 // After that turn, the Galactic-center cruise and approach must stay visible.
 if(id==='sagittarius-a')assert.ok(end.samples.filter(sample=>sample.elapsed>=start.duration*.24).every(sample=>sample.lit>20),'The Milky Way must remain visible throughout the Galactic-center cruise and approach');
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 const total=distance(start.start,start.endpoint);
 assert.ok(end.samples.some(s=>distance(s.position,start.start)>total*.2&&distance(s.position,start.start)<total*.8),'Camera must cross the catalog between its endpoints');
 assert.ok(end.samples.some(s=>s.active===end.target.index&&s.elapsed<start.duration-.08),'Local view must resolve before the journey finishes');
 const offset=distance(end.position,end.target.position)/end.target.radius_pc;
 assert.ok(Math.abs(offset-end.target.viewDistanceRadii)<.005,'Arrival must use the destination model scale');
 report.journeys.push({id,duration:start.duration,elapsedSeconds:(end.at-start.at)/1000,fps:(end.frames-start.frames)*1000/(end.at-start.at),arrivalModelUnits:offset,approachFrames:end.samples.filter(s=>s.active===end.target.index).length});
}
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});let serverFrames=0;
 page.on('request',r=>{if(r.url().includes('/api/frame'))serverFrames++;});await open(page);
 await page.evaluate(()=>{window.originalCanvas=document.querySelector('#glyphscreen');window.originalTimeOrigin=performance.timeOrigin;});
 const originalURL=page.url();
 assert.equal(await page.evaluate(()=>__atlas.phenomena.length),7);
 await page.locator('#phenomena-open').click();
 assert.equal(await page.locator('#search-results .destination').count(),7);
 await page.getByRole('button',{name:'Discover VFTS 352',exact:true}).click();await page.locator('#fly-preview').click();
 await sampleFlight(page,'vfts-352');
 await page.screenshot({path:'artifacts/unified-vfts-352-flight.png'});
 // The dedicated header control now starts the same journey used by stars.
 await page.locator('#blackhole-open').click();await sampleFlight(page,'sagittarius-a');
 assert.ok(await page.evaluate(()=>__atlas.data.stats.shadow_cells>20&&__atlas.data.stats.disk_cells>100));
 await page.waitForTimeout(220);await page.screenshot({path:'artifacts/unified-sagittarius-a-flight.png'});
 // Every remaining phenomenon resolves in the same renderer and coordinate frame.
 for(const id of ['vfts-352','betelgeuse-study','crab-nebula','orion-nebula','crab-pulsar','3c-273','sagittarius-a']){
  await inspect(page,id);await page.waitForTimeout(500);
  const start=await page.evaluate(()=>({at:performance.now(),frames:__atlas.metrics.frames}));await page.waitForTimeout(1200);
  const end=await page.evaluate(()=>({at:performance.now(),frames:__atlas.metrics.frames,stats:__atlas.data.stats,grid:[__atlas.state.cols,__atlas.state.rows],selected:__atlas.selected.id}));
  if(id==='crab-pulsar')assert.deepEqual(end.stats.context_layers,[-50002],'The pulsar must retain its surrounding remnant');
  if(id==='sagittarius-a')assert.equal(end.stats.lensed_environment,true,'The surrounding universe must be lensed');
  assert.ok(end.stats.local_cells>20,`${id} must visibly resolve`);assert.ok(end.stats.frame_ms>0);
  report.scenes.push({id,grid:end.grid,fps:(end.frames-start.frames)*1000/(end.at-start.at),computeMs:end.stats.frame_ms,cells:end.stats.local_cells});
  await page.screenshot({path:`artifacts/unified-${id}.png`});
 }
 assert.equal(page.url(),originalURL);assert.equal(await page.evaluate(()=>document.querySelector('#glyphscreen')===originalCanvas&&performance.timeOrigin===originalTimeOrigin),true);
 assert.equal(await page.locator('iframe').count(),0);
 // Orbit and zoom share the usual controls, including the supported BH boundary.
 const before=await page.evaluate(()=>[...__atlas.state.position]);await page.locator('#viewport').focus();
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(180);await page.keyboard.up('ArrowRight');await next(page);
 assert.notDeepEqual(await page.evaluate(()=>__atlas.state.position),before);
 await page.mouse.move(1100,350);await page.mouse.wheel(0,-20000);await next(page);
 assert.ok(await page.evaluate(()=>__atlas.data.stats.local_distance_model>=6.05));
 assert.equal(await page.locator('#error').isVisible(),false);
 await inspect(page,'sagittarius-a');
 // Free look can leave the object out of view; it isn't a fixed full-screen movie.
 await page.locator('#mode-toggle').click();
 await page.evaluate(()=>{__atlas.state.yaw+=Math.PI;__atlas.state.pitch=-__atlas.state.pitch;});await next(page);await next(page);
 assert.equal(await page.evaluate(()=>__atlas.data.stats.local_cells),0);
 await inspect(page,'sagittarius-a');
 await page.locator('#pause').click();await page.waitForTimeout(150);
 const paused=await page.evaluate(()=>({time:__atlas.state.time,frames:__atlas.metrics.frames}));await page.waitForTimeout(180);
 assert.deepEqual(await page.evaluate(()=>({time:__atlas.state.time,frames:__atlas.metrics.frames})),paused);
 await page.locator('#viewport').focus();await page.keyboard.down('ArrowLeft');await page.waitForTimeout(120);await page.keyboard.up('ArrowLeft');
 assert.ok(await page.evaluate(n=>__atlas.metrics.frames>n,paused.frames));
 await page.locator('#pause').click();
 // Departing keeps the source scene, and cancellation/resume preserves the route.
 await page.evaluate(()=>__atlas.travelTo('earth'));
 await page.waitForFunction(()=>__atlas.journey?.destination.id==='earth');await page.waitForTimeout(100);await next(page);
 assert.equal(await page.evaluate(()=>__atlas.data.stats.active_destination),-50006);
 await page.locator('#cancel-journey').click();assert.equal(await page.evaluate(()=>__atlas.journey),null);
 assert.equal(await page.evaluate(()=>__atlas.resumeTarget.id),'earth');await page.locator('#resume-journey').click();
 await page.waitForFunction(()=>__atlas.journey?.destination.id==='earth');
 await page.evaluate(()=>__atlas.travelTo('earth',{instant:true}));await next(page);await next(page);
 assert.equal(await page.evaluate(()=>__atlas.selected.id),'earth');assert.equal(await page.evaluate(()=>__atlas.data.stats.active_scene),'atlas');
 // Both text exports are of the same composed destination seen in the atlas.
 await inspect(page,'orion-nebula');await page.locator('#info-open').click();await page.locator('#density').selectOption('160,70');await page.locator('#display-mode').selectOption('text');
 await page.waitForFunction(()=>document.querySelector('#textscreen').textContent.split('\n').length===70);
 assert.equal(await page.locator('#textscreen').isVisible(),true);assert.equal(await page.locator('#glyphscreen').isVisible(),false);
 const plainDownload=page.waitForEvent('download');await page.locator('#save-text').click();const file=await plainDownload,text=await readFile(await file.path(),'utf8');
 assert.equal(text.split('\n').length,71);assert.ok(text.split('\n').slice(0,-1).every(row=>row.length===160));
 const ansiDownload=page.waitForEvent('download');await page.locator('#save-ansi').click();assert.ok((await readFile(await(await ansiDownload).path(),'utf8')).includes('\x1b[48;2;'));
 await page.locator('#display-mode').selectOption('accelerated');await page.locator('#close-panel').click();
 await page.context().setOffline(true);await inspect(page,'sagittarius-a');await inspect(page,'crab-nebula');assert.equal(serverFrames,0);report.offline=true;report.serverFrameRequests=serverFrames;await page.close();
 // Reduced-motion deep links use the shared mobile canvas and arrive immediately.
 const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,reducedMotion:'reduce'});
 await open(phone,'/?destination=crab-nebula');await arrived(phone,'crab-nebula');
 assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await phone.screenshot({path:'artifacts/unified-phenomena-mobile.png'});report.mobile=true;await phone.close();
 // A pack failure leaves the atlas usable; Retry resumes only the failed destination.
 const retry=await browser.newPage({reducedMotion:'reduce'});let failed=false;
 await retry.route('**/artifacts/phenomena.bin',async route=>{if(!failed){failed=true;await route.fulfill({status:503,body:'temporary test failure'});}else await route.continue();});
 await open(retry);await retry.evaluate(()=>__atlas.travelTo('vfts-352'));await retry.locator('#error').waitFor({state:'visible'});
 assert.equal(await retry.evaluate(()=>__atlas.selected.id),'earth');await next(retry);await retry.locator('#retry').click();await arrived(retry,'vfts-352');report.retry=true;await retry.close();
 // Cancel while a pack is loading must not launch a stale flight when it completes.
 const delayed=await browser.newPage();let release,intercepted=false;const gate=new Promise(resolve=>{release=resolve;});
 await delayed.route('**/artifacts/phenomena.bin',async route=>{intercepted=true;await gate;await route.continue();});await open(delayed);
 await delayed.evaluate(()=>{__atlas.travelTo('vfts-352');});await delayed.locator('#preparing').waitFor({state:'visible'});await delayed.locator('#cancel-preparing').click();release();
 await delayed.waitForTimeout(900);assert.equal(intercepted,true);assert.equal(await delayed.evaluate(()=>__atlas.selected.id),'earth');assert.equal(await delayed.evaluate(()=>__atlas.journey),null);report.cancelPreparation=true;await delayed.close();
 const canvas=await browser.newPage({reducedMotion:'reduce'});
 await canvas.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:get.call(this,type,...args);};});
 await open(canvas,'/?destination=orion-nebula');await arrived(canvas,'orion-nebula');assert.equal(await canvas.locator('#glyphscreen').isVisible(),true);report.canvas2D=true;await canvas.close();
 for(const [path,location] of [['/blackhole','/?destination=sagittarius-a'],['/phenomena','/?category=phenomena'],['/phenomena?scene=pulsar','/?destination=crab-pulsar']]){
  const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),location);
 }
 report.legacyRedirects=true;assert.deepEqual(errors,[]);report.errors=errors;report.passed=true;console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await writeFile('artifacts/phenomena-browser-validation.json',JSON.stringify(report,null,2)+'\n');}
