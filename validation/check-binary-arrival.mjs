import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true}),report={samples:[],errors:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 assert.ok(Math.abs(await page.evaluate(()=>__atlas.state.earthUtcMs-Date.now()))<1000);
 await page.evaluate(()=>__atlas.beginJourney('vfts-352'));
 await page.waitForFunction(()=>__atlas.travel?.destination.id==='vfts-352');
 assert.equal(await page.evaluate(()=>__atlas.travel.closeApproach.closeSeconds),8);
 for(const radius of [1e7,1000,80,35,5.5]){
  await page.waitForFunction(radius=>{
   const a=__atlas,d=a.selected;
   return Math.hypot(...a.state.position.map((x,i)=>(x-d.position[i])/d.radiusPc))<radius;
  },radius,{timeout:45000});
  const sample=await page.evaluate(()=>{
   const a=__atlas,f=a.data.frame,cx=Math.floor(f.cols/2),cy=Math.floor(f.rows/2);let centerLight=0;
   for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++){
    const i=y*f.cols+x;if(f.glyphsUint8[i]!==32)centerLight+=Math.max(...f.foregroundRGBUint8.subarray(i*3,i*3+3));
   }
   return {elapsed:a.travel?.elapsed??18,centerLight,stats:a.data.stats};
  });
  assert.ok(sample.centerLight>0,'The destination is present before the closeup');
  if(radius>=1000){assert.equal(sample.stats.active_scene,'atlas');assert.ok(sample.stats.persistent_destinations>0);}
  assert.ok(!sample.stats.local_error);
  report.samples.push({radius,...sample});
  await page.screenshot({path:`validation/binary-arrival-${radius}.png`});
 }
 await page.waitForFunction(()=>!__atlas.travel);
 // Holding scene time must also hold Earth’s UTC orientation for export.
 await page.evaluate(()=>__atlas.setPaused(true));
 const held=await page.evaluate(()=>__atlas.state.earthUtcMs);
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>__atlas.state.earthUtcMs),held);
 await page.evaluate(()=>__atlas.setPaused(false));await page.waitForTimeout(250);
 assert.ok(await page.evaluate(held=>__atlas.state.earthUtcMs>held,held));
 assert.deepEqual(report.errors,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,samples:report.samples.map(({radius,elapsed,centerLight})=>({radius,elapsed,centerLight}))}));
}finally{await browser.close();await writeFile('validation/binary-arrival-result.json',JSON.stringify(report,null,2)+'\n');}
