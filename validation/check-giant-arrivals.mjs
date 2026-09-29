import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true}),report={stars:[],errors:[],approach:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 const nextFrame=async()=>{const n=await page.evaluate(()=>__atlas.metrics.frames);await page.waitForFunction(n=>__atlas.metrics.frames>n+1,n);};
 const sample=()=>page.evaluate(()=>{
  const a=__atlas,d=a.selected,f=a.data.frame,r=d.radius_pc??d.radiusPc,n=f.cols*f.rows;
  let red=0;for(let i=0;i<n;i++)if(f.glyphsUint8[i]!==32&&f.foregroundRGBUint8[3*i]>80&&f.foregroundRGBUint8[3*i]>1.2*f.foregroundRGBUint8[3*i+1])red++;
  return {name:d.name,id:d.id,distanceRadii:Math.hypot(...a.state.position.map((v,i)=>(v-d.position[i])/r)),surfaceFraction:a.data.stats.surface_cells/n,redFraction:red/n,stats:a.data.stats};
 });
 // Catalog arrival sizes remain distinct, including giants that exceed both
 // screen dimensions. These use the actual normal arrival policy.
 for(const name of ['Proxima Centauri','Sun','Rigel','Antares']){
  await page.evaluate(name=>__atlas.beginJourney(name,{instant:true}),name);await nextFrame();
  const s=await sample();report.stars.push(s);
  await page.screenshot({path:`validation/giant-${name.replaceAll(' ','-')}.png`});
 }
 assert.ok(report.stars[0].surfaceFraction<.04,'The red dwarf should arrive small');
 assert.ok(report.stars[1].surfaceFraction>report.stars[0].surfaceFraction*3,'The Sun is visibly larger than the dwarf');
 for(const giant of report.stars.slice(2))assert.ok(giant.surfaceFraction>.95,`${giant.name} should engulf the viewport`);
 await page.evaluate(()=>__atlas.beginJourney('betelgeuse-study'));
 await page.waitForFunction(()=>__atlas.travel?.destination.id==='betelgeuse-study');
 for(const threshold of [35,6,3,2]){
  await page.waitForFunction(r=>{
   const a=__atlas,d=a.selected;return Math.hypot(...a.state.position.map((v,i)=>(v-d.position[i])/d.radiusPc))<r;
  },threshold,{timeout:35000});
  await nextFrame();report.approach.push(await sample());
 }
 await page.waitForFunction(()=>!__atlas.travel);await nextFrame();
 report.close=await sample();
 assert.ok(Math.abs(report.close.distanceRadii-1.9)<.0001);
 assert.ok(report.close.redFraction>.8,'The rolling photosphere must actually fill the character display');
 assert.equal(await page.locator('#inspect-selected').textContent(),'Frame whole star ↗');
 assert.ok(!report.close.stats.local_error);
 await page.screenshot({path:'validation/giant-Betelgeuse-arrival.png'});
 await page.click('#inspect-selected');await page.waitForFunction(()=>!!__atlas.travel);
 assert.ok(await page.evaluate(()=>__atlas.travel.duration>0),'The overview must be an animated pullback');
 await page.waitForFunction(()=>!__atlas.travel);await nextFrame();report.overview=await sample();
 assert.ok(Math.abs(report.overview.distanceRadii-5.6)<.0001);
 assert.ok(report.overview.redFraction<report.close.redFraction*.4,'Pullback must reveal the whole disk');
 await page.screenshot({path:'validation/giant-Betelgeuse-overview.png'});
 // The tour must use the close arrival too. Advance through its real Next stop
 // control to the giant chapter, then allow its complete approach and orbit.
 await page.evaluate(()=>__atlas.returnEarth({instant:true}));await page.click('#tour-open');
 for(let i=0;i<4;i++)await page.click('#tour-next');
 await page.waitForFunction(()=>__atlas.tour?.index===4&&__atlas.tour.phase==='dwell',null,{timeout:45000});
 await page.waitForTimeout(1000);report.tour=await sample();
 assert.equal(report.tour.id,'betelgeuse-study');assert.ok(report.tour.redFraction>.8);
 assert.ok(Math.abs(report.tour.distanceRadii-1.9)<.0001);
 await page.click('#tour-stop');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>__atlas.beginJourney('betelgeuse-study',{instant:true}));await nextFrame();
 report.mobile=await sample();assert.ok(Math.abs(report.mobile.distanceRadii-1.9)<.0001);
 assert.ok(report.mobile.redFraction>.8,'Portrait arrival must not automatically shrink the giant');
 await page.screenshot({path:'validation/giant-Betelgeuse-mobile.png'});
 await page.mouse.move(200,350);await page.mouse.wheel(0,-3000);await page.waitForTimeout(1400);await nextFrame();
 report.closest=await sample();assert.ok(report.closest.distanceRadii>1.22,'Zoom must stay outside the photosphere');
 assert.ok(report.closest.distanceRadii<1.23,'The minimum radius clamp is exercised');
 assert.ok(!report.closest.stats.local_error);
 assert.equal(await page.locator('#error').isVisible(),false);assert.deepEqual(report.errors,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,stars:report.stars.map(s=>({name:s.name,coverage:s.surfaceFraction})),close:report.close.redFraction,overview:report.overview.redFraction,mobile:report.mobile.redFraction}));
}finally{await browser.close();await writeFile('validation/giant-arrivals-result.json',JSON.stringify(report,null,2)+'\n');}
