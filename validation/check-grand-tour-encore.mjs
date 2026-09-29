// Exercise every real browser tour arrival without waiting through each dwell.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:8768/?tour=grand');
 await page.waitForFunction(()=>__atlas?.ready&&__atlas.tour?.index===0,null,{timeout:60000});
 const ids=await page.evaluate(()=>__atlas.tourStops.map(stop=>stop.id));
 assert.equal(ids.length,19);
 for(let i=0;i<ids.length;i++){
  await page.waitForFunction(index=>__atlas.tour?.index===index&&__atlas.travel,i,{timeout:60000});
  await page.evaluate(()=>{__atlas.travel.elapsed=__atlas.travel.duration;});
  await page.waitForFunction(index=>__atlas.tour?.index===index&&__atlas.tour.phase==='dwell',i,{timeout:30000});
  await page.waitForFunction(()=>__atlas.data.frame&&__atlas.data.stats&&!__atlas.data.stats.local_error,null,{timeout:30000});
  assert.equal(await page.evaluate(()=>__atlas.selected.id),ids[i]);
  assert.equal(await page.locator('#error').isVisible(),false);
  console.log(`${i+1}/${ids.length} ${ids[i]}`);
  if(i<ids.length-1)await page.evaluate(()=>__atlas.nextTourStop());
 }
 await page.evaluate(()=>__atlas.nextTourStop());
 assert.equal(await page.evaluate(()=>__atlas.tour?.phase),'complete');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
