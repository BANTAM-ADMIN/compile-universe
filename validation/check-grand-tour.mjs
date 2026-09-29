import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true}),report={chapters:[]},errors=[];
try {
 const page=await browser.newPage({viewport:{width:Number(process.env.WIDTH||1440),height:Number(process.env.HEIGHT||1000)}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__workerFailures=[];
  const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.requests=new Map();this.addEventListener('message',({data})=>{
    if(data.type==='error'||data.stats?.local_error)window.__workerFailures.push({request:this.requests.get(data.id),response:data});
    this.requests.delete(data.id);
   });}
   postMessage(data,...args){this.requests.set(data.id,structuredClone(data));super.postMessage(data,...args);}
  };
 });
 await page.goto('http://127.0.0.1:8768');
 await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 if(process.env.DENSITY){await page.click('#info-open');await page.selectOption('#density',process.env.DENSITY);await page.click('#close-panel');}
 const start=await page.evaluate(()=>[...__atlas.state.position]);
 await page.click('#tour-open');await page.waitForFunction(()=>__atlas.tour?.phase==='travel');
 await page.waitForTimeout(400);
 assert.notDeepEqual(await page.evaluate(()=>__atlas.state.position),start,'The opening is an actual flight');
 await page.click('#tour-pause');
 const held=await page.evaluate(()=>({position:[...__atlas.state.position],elapsed:__atlas.travel.elapsed}));
 await page.waitForTimeout(500);
 assert.deepEqual(await page.evaluate(()=>({position:__atlas.state.position,elapsed:__atlas.travel.elapsed})),held,'Pause tour holds the flight camera');
 await page.click('#tour-pause');
 const stopCount=await page.evaluate(()=>__atlas.tourStops.length);
 assert.equal(stopCount,19);
 for(let chapter=0;chapter<stopCount;chapter++){
  await page.waitForFunction(i=>__workerFailures.length||__atlas.tour?.index===i&&__atlas.tour.phase==='dwell',chapter,{timeout:70000});
  report.workerFailures=await page.evaluate(()=>__workerFailures);
  assert.deepEqual(report.workerFailures,[]);
  await page.waitForTimeout(800);
  const entry=await page.evaluate(()=>({index:__atlas.tour.index,id:__atlas.selected.id,title:document.querySelector('#tour-title').textContent,position:[...__atlas.state.position],stats:__atlas.data.stats}));
  assert.equal(entry.id,await page.evaluate(i=>__atlas.tourStops[i].id,chapter));
  assert.equal(await page.locator('#error').isVisible(),false);
  assert.ok(!entry.stats.local_error,entry.stats.local_error);
  if(chapter===0)assert.ok(entry.stats.surface_cells>500);
  report.chapters.push(entry);
  await page.screenshot({path:`validation/tour-${chapter}-${entry.id}.png`});
  console.log('Arrived',chapter,entry.id,entry.stats.worker_ms,'ms');
 }
 await page.waitForFunction(()=>__atlas.tour?.phase==='complete',null,{timeout:30000});
 report.workerFailures=await page.evaluate(()=>__workerFailures);assert.deepEqual(report.workerFailures,[]);
 assert.equal(await page.evaluate(()=>__atlas.selected.id),'3c-273');
 await page.click('#tour-stop');assert.equal(await page.evaluate(()=>__atlas.tour),null);
 // Restart, then verify that normal manual input cancels the entire tour.
 await page.evaluate(()=>__atlas.returnEarth({instant:true}));await page.click('#tour-open');
 await page.waitForFunction(()=>!!__atlas.travel);await page.locator('#viewport').focus();
 await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>__atlas.tour),null);assert.equal(await page.evaluate(()=>__atlas.travel),null);
 assert.deepEqual(errors,[]);report.passed=true;report.errors=errors;
}finally{await browser.close();await writeFile('validation/grand-tour-result.json',JSON.stringify(report,null,2)+'\n');}
