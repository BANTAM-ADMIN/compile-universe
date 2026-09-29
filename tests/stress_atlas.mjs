/** Artificial slowdown of both UI and worker. Not physical low-end hardware. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin=process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8781';
const source=await readFile(new URL('../web/atlas-worker.js',import.meta.url),'utf8');
const marker="const stats={backend:'catalog-wasm'";
assert.ok(source.includes(marker),'Stress injection must match the current worker');
const browser=await chromium.launch({headless:true}),reports=[];
const quantile=(a,q)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*q))]||0;
try{
 for(const factor of [4,6]){
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const body=source.replace(marker,`const extra=(performance.now()-started)*${factor-1};const until=performance.now()+extra;while(performance.now()<until){}\n      ${marker}`);
  await page.route('**/atlas-worker.js',route=>route.fulfill({status:200,contentType:'text/javascript',body}));
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:factor});
  await page.goto(origin);await page.waitForFunction(()=>window.__compiledAtlas?.ready&&__compiledAtlas.data.frame,{timeout:45000});
  await page.locator('#viewport').focus();await page.keyboard.down('ArrowRight');await page.waitForTimeout(5500);
  const start=await page.evaluate(()=>{const a=__compiledAtlas;for(const key of ['frameIntervals','computeTimes','displayTimes','inputLatencyMs'])a.metrics[key].length=0;return {at:performance.now(),frames:a.metrics.frames,grid:[a.state.cols,a.state.rows]};});
  for(let i=0;i<10;i++){await page.mouse.move(550,310);await page.mouse.down();await page.mouse.move(572,315,{steps:2});await page.mouse.up();await page.waitForTimeout(450);}
  const end=await page.evaluate(()=>({at:performance.now(),frames:__compiledAtlas.metrics.frames,metrics:__compiledAtlas.metrics,grid:[__compiledAtlas.state.cols,__compiledAtlas.state.rows]}));
  await page.keyboard.up('ArrowRight');
  reports.push({artificialWorkerFactor:factor,mainThreadCDPFactor:factor,settleMs:5500,measurementMs:end.at-start.at,
   fps:(end.frames-start.frames)*1000/(end.at-start.at),initialGrid:start.grid,finalGrid:end.grid,
   frameP95Ms:quantile(end.metrics.frameIntervals,.95),inputP95Ms:quantile(end.metrics.inputLatencyMs,.95),
   displayMedianMs:quantile(end.metrics.displayTimes,.5),errors});
  assert.deepEqual(errors,[]);await page.close();
 }
}finally{await browser.close();}
const report={description:'Test-only proportional busywork makes each worker frame approximately 4x/6x as expensive; Chromium CDP separately throttles the main thread. Continuous orbit plus real pointer input. This is not a real low-end hardware measurement.',reports};
await writeFile(fileURLToPath(new URL('../artifacts/atlas-artificial-stress.json',import.meta.url)),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
