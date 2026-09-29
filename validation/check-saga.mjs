import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8768');await page.waitForFunction(()=>window.__atlas?.ready,null,{timeout:60000});
await page.evaluate(()=>{window.samples=[];let previous=0;const sample=()=>{const a=__atlas,s=a.data.stats,d=a.destinations['sagittarius-a'];if(d&&a.selected.id===d.id&&a.metrics.frames!==previous){previous=a.metrics.frames;const r=Math.hypot(...a.state.position.map((x,i)=>x-d.position[i]))/d.radiusPc;samples.push({elapsed:a.travel?.elapsed??18,r,active:s.active_scene,local:s.local_distance_model,disk:s.disk_cells,lens:s.lens_strength,ms:s.worker_ms,cols:s.cols,rows:s.rows});}requestAnimationFrame(sample);};sample();});
await page.evaluate(()=>__atlas.beginJourney('sagittarius-a'));
for(const radius of [5000,2000,700,150,24.2]){await page.waitForFunction(r=>{const a=__atlas,d=a.destinations['sagittarius-a'];return Math.hypot(...a.state.position.map((x,i)=>x-d.position[i]))/d.radiusPc<r;},radius,{timeout:30000});await page.screenshot({path:`validation/saga-${radius}.png`});}
await page.waitForTimeout(500);const samples=await page.evaluate(()=>samples);await writeFile('validation/saga-flight.json',JSON.stringify(samples,null,2));
const active=samples.filter(s=>s.active==='blackhole');console.log(JSON.stringify({firstActive:active[0],firstResolvedDisk:active.find(s=>s.disk>0),last:active.at(-1),frames:samples.length,errors},null,2));await browser.close();
