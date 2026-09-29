import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true}),errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 await page.waitForFunction(()=>__atlas.ui?.hits.some(hit=>hit.element?.id==='motion-toggle'));
 const position=()=>page.evaluate(()=>[...__atlas.state.position]);
 let before=await position();await page.waitForTimeout(500);
 assert.notDeepEqual(await position(),before,'Earth view cruises after opening');
 const hold=await page.evaluate(()=>{const hit=__atlas.ui.hits.find(h=>h.element?.id==='motion-toggle'),canvas=document.querySelector('#glyphscreen').getBoundingClientRect();return {x:canvas.left+(hit.x+hit.w/2)*canvas.width/__atlas.ui.cols,y:canvas.top+(hit.y+.5)*canvas.height/__atlas.ui.rows};});
 await page.mouse.click(hold.x,hold.y);assert.equal(await page.evaluate(()=>__atlas.motionHeld),true);
 before=await position();await page.waitForTimeout(400);
 assert.deepEqual(await position(),before,'Hold keeps the camera still');
 await page.locator('#viewport').focus();await page.keyboard.press('b');assert.equal(await page.evaluate(()=>__atlas.motionHeld),false);
 before=await position();await page.waitForTimeout(400);
 assert.notDeepEqual(await position(),before,'Cruise resumes');
 await page.evaluate(()=>__atlas.beginJourney('moon',{instant:true}));
 await page.waitForFunction(()=>__atlas.selected.id==='moon'&&!__atlas.travel);
 before=await position();await page.waitForTimeout(450);
 assert.notDeepEqual(await position(),before,'Moon moves across the view after arrival');
 await page.locator('#viewport').focus();await page.keyboard.press('o');
 assert.equal(await page.evaluate(()=>__atlas.mode),'free');
 before=await position();await page.waitForTimeout(350);
 assert.notDeepEqual(await position(),before,'Free flight inherits the orbit velocity');
 // The close lunar arrival puts forward thrust into the surface. Thrust away
 // from the Moon to verify coasting without triggering collision braking.
 await page.keyboard.down('s');await page.waitForTimeout(350);await page.keyboard.up('s');
 assert.ok(await page.evaluate(()=>Math.hypot(...__atlas.velocity)>0));
 before=await position();await page.waitForTimeout(350);
 assert.notDeepEqual(await position(),before,'The ship coasts after thrust is released');
 await page.keyboard.press('b');
 assert.equal(await page.evaluate(()=>__atlas.mode),'orbit');
 assert.deepEqual(await page.evaluate(()=>__atlas.velocity),[0,0,0]);
 assert.deepEqual(errors,[]);
 const reduced=await browser.newPage({reducedMotion:'reduce'});
 await reduced.goto('http://127.0.0.1:8768/');
 await reduced.waitForFunction(()=>__atlas?.ready,null,{timeout:60000});
 assert.equal(await reduced.evaluate(()=>__atlas.motionHeld),true);
 console.log('Ship motion: cruise, hold, coast, brake and reduced motion passed');
}finally{await browser.close();}
