/** Artificial worker/main-thread slowdown; this is not a hardware benchmark. */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin=process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8780/index.html';
const original=await readFile(fileURLToPath(new URL('../web/player-worker.js',import.meta.url)),'utf8');
const browser=await chromium.launch({headless:true});
const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.min(a.length-1,Math.floor(a.length*q))]:0;};
const reports=[];
try{
for(const factor of [4,6]){
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/player-worker.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:original.replace('const pointer = engine._cu_output(), count = cols * rows;',`const artificialCost=performance.now()-start; const artificialUntil=performance.now()+artificialCost*${factor-1}; while(performance.now()<artificialUntil){}\n    const pointer = engine._cu_output(), count = cols * rows;`)}));
 const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:factor});
 await page.goto(origin);await page.waitForFunction(()=>window.__compiledUniverse?.data,{timeout:60000});
 await page.locator('#viewport').focus();await page.keyboard.down('ArrowRight');
 await page.waitForTimeout(5000);
 const start=await page.evaluate(()=>{const a=__compiledUniverse;for(const k of ['frameIntervals','inputLatencyMs','computeTimes','displayTimes','workerRoundtrips'])a.metrics[k].length=0;return {at:performance.now(),frames:a.metrics.frames,grid:[a.state.cols,a.state.rows]};});
 // Real pointer events exercise accepted-input to displayed-frame latency.
 for(let i=0;i<10;i++){await page.mouse.move(580+i*3,320);await page.mouse.down();await page.mouse.move(585+i*3,322);await page.mouse.up();await page.waitForTimeout(450);}
 const finish=await page.evaluate(()=>({at:performance.now(),frames:__compiledUniverse.metrics.frames,grid:[__compiledUniverse.state.cols,__compiledUniverse.state.rows],metrics:__compiledUniverse.metrics,stats:__compiledUniverse.data.stats}));
 await page.keyboard.up('ArrowRight');
 const report={artificialWorkerFactor:factor,mainThreadCDPFactor:factor,settleMs:5000,measurementMs:finish.at-start.at,fps:(finish.frames-start.frames)*1000/(finish.at-start.at),startGrid:start.grid,finalGrid:finish.grid,frameP50Ms:quantile(finish.metrics.frameIntervals,.5),frameP95Ms:quantile(finish.metrics.frameIntervals,.95),computeP50Ms:quantile(finish.metrics.computeTimes,.5),displayP50Ms:quantile(finish.metrics.displayTimes,.5),workerRoundtripP50Ms:quantile(finish.metrics.workerRoundtrips,.5),inputP95Ms:quantile(finish.metrics.inputLatencyMs,.95),inputSamples:finish.metrics.inputLatencyMs.length,errors};reports.push(report);console.log(JSON.stringify(report));await page.close();
}
}finally{await browser.close();}
await writeFile(fileURLToPath(new URL('../artifacts/browser-artificial-stress.json',import.meta.url)),JSON.stringify({description:'Artificial proportional busywork in test-routed worker plus main-thread CDP throttling. Not a real low-end hardware measurement.',reports},null,2)+'\n');
