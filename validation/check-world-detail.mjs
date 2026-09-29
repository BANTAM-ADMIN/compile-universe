import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8768/?destination=moon');await page.waitForFunction(()=>__atlas.ready&&!__atlas.travel&&__atlas.selected.id==='moon',null,{timeout:60000});await page.waitForTimeout(1500);
 console.log('moon',await page.evaluate(()=>({stats:__atlas.data.stats,grid:[__atlas.state.cols,__atlas.state.rows],rotation:__atlas.selected.rotationRate,relief:__atlas.selected.relief?.texture.width})));
 await page.screenshot({path:'validation/moon-detail-after.png'});
 const system=await page.evaluate(async()=>{const star=__atlas.destinations.sirius;const system=await __atlas.generateForStar(star);await __atlas.ensureRegistered(star);return system;});
 console.log('system',system.bodies.filter(b=>b.generated).map(b=>({id:b.id,kind:b.kind,surface:b.surface})));
 const samples=['rocky','ice','lava','gas'].map(style=>system.bodies.find(b=>b.surface?.style===style)).filter(Boolean);
 for(const body of samples){await page.evaluate(id=>__atlas.beginJourney(id,{instant:true}),body.id);await page.waitForTimeout(1800);await page.screenshot({path:`validation/generated-${body.surface.style}-after.png`});console.log(body.id,await page.evaluate(()=>__atlas.data.stats));}
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
