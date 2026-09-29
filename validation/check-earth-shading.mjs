import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const browser=await chromium.launch({headless:true}),report={errors:[],views:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 await page.evaluate(()=>{__atlas.setPaused(true);__atlas.state.time=0;__atlas.homeCamera();});
 for(const value of ['220,94','160,70']){
  await page.click('#info-open');
  await page.locator('#density').selectOption(value);
  await page.click('#close-panel');
  await page.waitForFunction(cols=>__atlas.data.frame.cols===cols,Number(value.split(',')[0]));
  await page.waitForTimeout(300);
  await page.screenshot({path:`validation/earth-day-${value.replace(',','x')}.png`});
  report.views.push(await page.evaluate(()=>({grid:[__atlas.data.frame.cols,__atlas.data.frame.rows],stats:__atlas.data.stats})));
 }
 // The shared tour link must really launch and fly to the night hemisphere.
 await page.goto('http://127.0.0.1:8768/?tour=grand');
 await page.waitForFunction(()=>__atlas.ready&&__atlas.tour?.phase==='dwell',null,{timeout:60000});
 assert.equal(await page.evaluate(()=>__atlas.selected.id),'earth');
 await page.click('#tour-pause');
 const held=await page.evaluate(()=>[...__atlas.state.position]);
 await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(()=>__atlas.state.position),held);
 await page.screenshot({path:'validation/earth-night-tour.png'});
 report.liveTour=true;
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(500);
 for(const id of ['tour-pause','tour-next','tour-stop']){
  assert.ok(await page.locator(`#${id}`).isVisible());
  assert.ok(await page.evaluate(id=>{
   const button=document.getElementById(id),r=button.getBoundingClientRect();
   return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&
     button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
  },id),`${id} must be reachable on mobile`);
 }
 await page.screenshot({path:'validation/earth-night-mobile.png'});
 await page.click('#tour-stop');
 assert.equal(await page.evaluate(()=>__atlas.tour),null);
 assert.equal(await page.locator('#error').isVisible(),false);
 report.mobileControls=true;
 assert.deepEqual(report.errors,[]);
 report.passed=true;
 console.log(JSON.stringify({passed:true,liveTour:true,mobileControls:true,errors:report.errors}));
} finally {
 await browser.close();
 await writeFile('validation/earth-shading-result.json',JSON.stringify(report,null,2)+'\n');
}
