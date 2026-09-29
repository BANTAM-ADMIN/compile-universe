// Actual-browser responsiveness checks. CPU throttling is a stress test, not a
// claim that an RTX workstation has become a particular low-end computer.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.dirname(fileURLToPath(import.meta.url));
const url=process.argv[2] || 'http://127.0.0.1:8766/index.html';
const output=process.argv[3] || path.join(root,'artifacts/browser-performance.json');
const requestedGrid=process.argv[4] || 'adaptive';
const durationMs=4000;
const summary=values=>{
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const quantile=p=>a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];
  return {samples:a.length,median:quantile(.5),p95:quantile(.95),max:a.at(-1)};
};
const asArray=value=>Array.isArray(value)?value:Number.isFinite(value)?[value]:[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const failures=[];
const requests=[];
page.on('pageerror',error=>failures.push(error.message));
page.on('request',request=>requests.push({url:request.url(),method:request.method(),time:performance.now()}));
const report={url,generatedUTC:new Date().toISOString(),durationMs,requestedGrid,cases:[],pageErrors:failures,
  scope:'Headless Chromium on this workstation; 4x/6x CPU throttling is synthetic. GPU, memory and thermal limits are not emulated.'};
try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__compiledUniverse?.metrics?.frames>1,null,{timeout:90000});
  await page.evaluate(grid=>{const select=document.querySelector('#resolution');
    if(!Array.from(select.options).some(option=>option.value===grid))throw new Error(`Unknown grid ${grid}`);
    select.value=grid;select.dispatchEvent(new Event('change',{bubbles:true}));},requestedGrid);
  report.browser=await browser.version();
  report.environment=await page.evaluate(()=>{
    const canvas=document.querySelector('canvas');
    let renderer='none';
    if(canvas){const gl=canvas.getContext('webgl2') || canvas.getContext('webgl');
      if(gl){const extension=gl.getExtension('WEBGL_debug_renderer_info');renderer=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}}
    return {userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,renderer,
      canvasCount:document.querySelectorAll('canvas').length};
  });
  const cdp=await page.context().newCDPSession(page);
  for(const throttle of [1,4,6]){
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
    for(const motion of ['stationary animation','dragged camera']){
      await page.evaluate(()=>{window.__compiledUniverse.setPreset('horizon');window.__compiledUniverse.setPaused(false);});
      await page.waitForTimeout(1200);
      const baseline=await page.evaluate(()=>window.__compiledUniverse.metrics);
      const requestStart=requests.length;
      const start=performance.now();
      if(motion==='dragged camera'){
        await page.mouse.move(790,450);await page.mouse.down();
        await page.keyboard.down('ArrowRight');
        let i=0;
        while(performance.now()-start<durationMs){
          await page.mouse.move(790+Math.sin(i*.23)*140,450+Math.sin(i*.13)*50);
          i++;
          await page.waitForTimeout(50);
        }
        await page.keyboard.up('ArrowRight');
        await page.mouse.up();
      }else await page.waitForTimeout(durationMs);
      const elapsed=performance.now()-start;
      const after=await page.evaluate(()=>window.__compiledUniverse.metrics);
      const frames=after.frames-baseline.frames;
      const count=Math.min(frames,asArray(after.frameIntervals).length);
      const inputCount=asArray(after.inputLatencyMs).length-asArray(baseline.inputLatencyMs).length;
      const sample={throttle,motion,elapsedMs:elapsed,frames,actualFramesPerSecond:frames/(elapsed/1000),
        frameIntervalMs:summary(asArray(after.frameIntervals).slice(-count)),
        computeMs:summary(asArray(after.computeTimes ?? after.computeMs).slice(-Math.max(1,frames))),
        displayMs:summary(asArray(after.displayTimes ?? after.displayMs).slice(-Math.max(1,frames))),
        workerRoundtripMs:summary(asArray(after.workerRoundtrips ?? after.workerRoundtripMs).slice(-Math.max(1,frames))),
        inputToDisplayedFrameMs:motion==='dragged camera' && inputCount>0?summary(asArray(after.inputLatencyMs).slice(-inputCount)):null,
        perFrameHttpRequests:requests.slice(requestStart).filter(r=>r.method==='POST' || /\/api\/frame/.test(r.url)).length,
        grid:await page.evaluate(()=>({cols:window.__compiledUniverse.data?.stats?.cols,rows:window.__compiledUniverse.data?.stats?.rows})),
        rawAfter:after};
      report.cases.push(sample);
      console.log(JSON.stringify({...sample,rawAfter:undefined}));
    }
  }
  report.perFrameHttpFree=report.cases.every(c=>c.perFrameHttpRequests===0);
  const normal=report.cases.find(c=>c.throttle===1 && c.motion==='dragged camera');
  const slow=report.cases.find(c=>c.throttle===6 && c.motion==='dragged camera');
  report.workerComputeSlowdownAt6x=normal?.computeMs && slow?.computeMs ? slow.computeMs.median/normal.computeMs.median:null;
  report.throttlingScope=report.workerComputeSlowdownAt6x>3 ?
    'Main page throttled; worker compute also slowed in observed wall measurements. This remains a synthetic test.' :
    'Main page CPU throttling only: worker compute did not show a 6x slowdown. Do not interpret these cases as fully CPU-throttled hardware.';
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  const blocked=[];
  await page.route('**/*',route=>{blocked.push(route.request().url());return route.abort();});
  const beforeOffline=await page.evaluate(()=>window.__compiledUniverse.metrics.frames);
  await page.evaluate(()=>{window.__compiledUniverse.setPreset('above');window.__compiledUniverse.setPaused(false);});
  await page.waitForTimeout(1200);
  const afterOffline=await page.evaluate(()=>({frames:window.__compiledUniverse.metrics.frames,state:window.__compiledUniverse.state,ready:window.__compiledUniverse.localReady}));
  report.offlineAfterBootstrap={framesDisplayed:afterOffline.frames-beforeOffline,blockedRequests:blocked,
    workerReady:afterOffline.ready,passed:afterOffline.frames-beforeOffline>20 && blocked.length===0};
  report.requests=requests;
  report.finalState=await page.evaluate(()=>window.__compiledUniverse.state);
}finally{
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
if(failures.length || report.perFrameHttpFree===false || report.offlineAfterBootstrap?.passed===false)process.exitCode=1;
