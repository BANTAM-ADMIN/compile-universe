import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const browser=await chromium.launch({headless:true});
const report={errors:[],layouts:[],checks:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)report.errors.push(`${response.status()} ${response.url()}`);});
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 async function layout(name){
  const result=await page.evaluate(()=>{
   const dock=document.getElementById('navigation-dock'),r=dock.getBoundingClientRect();
   return {viewport:[innerWidth,innerHeight],height:r.height,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
    buttons:[...dock.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>{
     const b=e.getBoundingClientRect();return {id:e.id,reachable:b.width>0&&b.height>=40&&b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom&&e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};
    })};
  });
  assert.ok(result.inside,`${name}: dock stays on screen`);
  for(const button of result.buttons)assert.ok(button.reachable,`${name}: ${button.id} must be reachable`);
  report.layouts.push({name,...result});
  await page.screenshot({path:`validation/dock-${name}.png`});
 }
 for(const [width,height] of [[1440,1000],[390,844],[320,568],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await layout(`home-${width}`);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.click('#tour-open');await page.waitForFunction(()=>__atlas.travel&&__atlas.travel.elapsed>.3);
 await page.click('#tour-pause');
 const held=await page.evaluate(()=>({position:[...__atlas.state.position],elapsed:__atlas.travel.elapsed}));
 await page.waitForTimeout(400);
 assert.deepEqual(await page.evaluate(()=>({position:[...__atlas.state.position],elapsed:__atlas.travel.elapsed})),held);
 assert.equal(await page.locator('#tour-caption').isVisible(),false);
 for(const [width,height] of [[1440,1000],[390,844],[320,568],[844,390]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);await layout(`tour-${width}`);
  assert.ok(report.layouts.at(-1).height<=100,'Collapsed tour and controls together stay under 100px');
  await page.click('#tour-details');assert.equal(await page.locator('#tour-details').getAttribute('aria-expanded'),'true');
  assert.ok(await page.locator('#tour-caption').isVisible());await layout(`story-${width}`);
  await page.click('#destinations');await page.waitForTimeout(100);
  assert.ok(await page.evaluate(()=>document.getElementById('panel').getBoundingClientRect().bottom<document.getElementById('navigation-dock').getBoundingClientRect().top),'Panel stays above the expanded dock');
  await page.click('#close-panel');await page.click('#tour-details');
 }
 await page.locator('#viewport').focus();await page.keyboard.press('Space');
 await page.waitForFunction(elapsed=>__atlas.travel.elapsed>elapsed,held.elapsed);
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>__atlas.tour.paused),true);
 report.checks.push('Tour pause, continue and Space hold/resume the actual flight');
 await page.click('#tour-next');await page.waitForFunction(()=>__atlas.tour?.index===1&&__atlas.travel);
 await page.click('#tour-stop');assert.equal(await page.evaluate(()=>__atlas.tour),null);
 assert.ok(await page.locator('#resume-card').isVisible());await layout('interrupted-844');
 await page.click('#resume-journey');await page.waitForFunction(()=>!!__atlas.travel);
 assert.equal(await page.locator('#tour-card').isVisible(),false);assert.ok(await page.locator('#journey').isVisible());
 await page.setViewportSize({width:320,height:568});await layout('flight-320');
 await page.click('#cancel-journey');assert.equal(await page.evaluate(()=>__atlas.travel),null);
 await page.click('#dismiss-resume');assert.equal(await page.locator('#resume-card').isVisible(),false);
 report.checks.push('Next, take control, resume flight, stop and dismiss');
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>__atlas.returnEarth({instant:true}));
 await page.click('#system-map-open');await page.waitForFunction(()=>!!__atlas.map);
 assert.equal(await page.locator('#navigation-dock').isVisible(),false);
 await page.click('#map-close');await page.waitForFunction(()=>!__atlas.map);await layout('map-closed');
 report.checks.push('Map hides the dock and restores it on close');
 await page.click('#tour-open');await page.waitForFunction(()=>!!__atlas.travel);
 await page.waitForFunction(()=>__atlas.tour.phase==='dwell',null,{timeout:15000});
 await page.evaluate(()=>{__atlas.tour.index=__atlas.tourStops.length-1;__atlas.nextTourStop();});
 assert.equal(await page.locator('#tour-pause').isVisible(),false);
 assert.match(await page.locator('#tour-next').textContent(),/Restart/);
 await page.click('#tour-next');await page.waitForFunction(()=>__atlas.tour?.index===0&&__atlas.tour.phase!=='complete');
 await page.locator('#viewport').focus();await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>__atlas.tour),null);
 const paused=await page.evaluate(()=>__atlas.paused);await page.keyboard.press('Space');
 assert.equal(await page.evaluate(()=>__atlas.paused),!paused);
 report.checks.push('Tour completion, restart, Escape, and scene pause outside tour');
 // Readability over the bright giant surface, not only the black background.
 await page.evaluate(()=>{__atlas.setPaused(false);return __atlas.beginJourney('betelgeuse-study',{instant:true});});
 const frames=await page.evaluate(()=>__atlas.metrics.frames);
 await page.waitForFunction(n=>__atlas.metrics.frames>n+2,frames);
 await layout('giant-desktop');await page.click('#tour-open');
 for(let i=0;i<4;i++)await page.click('#tour-next');
 await page.waitForFunction(()=>__atlas.tour?.index===4&&__atlas.tour.phase==='dwell',null,{timeout:45000});
 await page.click('#tour-pause');await layout('giant-tour');
 await page.setViewportSize({width:390,height:844});await layout('giant-tour-mobile');
 assert.equal(await page.locator('#error').isVisible(),false);assert.deepEqual(report.errors,[]);
 report.passed=true;console.log(JSON.stringify({passed:true,layouts:report.layouts.length,checks:report.checks}));
} finally {await browser.close();await writeFile('validation/control-dock-result.json',JSON.stringify(report,null,2)+'\n');}
