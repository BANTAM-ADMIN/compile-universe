import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {Universe} from '../terminal/universe.mjs';
import {length,sub,dot,normalize} from '../terminal/navigation.mjs';

const KM_PER_PC=3.085677581491367e13;
const browser=await chromium.launch({headless:true}),errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8768/');
  await page.waitForFunction(()=>__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
  await page.evaluate(()=>__atlas.beginJourney('moon'));
  await page.waitForFunction(()=>__atlas.travel?.arrivalDescent);
  const descent=await page.evaluate(()=>__atlas.travel.arrivalDescent);
  assert.ok(descent.startDistance>descent.endDistance*3);
  await page.evaluate(()=>{__atlas.travel.elapsed=__atlas.travel.duration-2;});
  await page.waitForFunction(()=>document.querySelector('#journey-stage').textContent.includes('TERMINATOR'));
  await page.evaluate(()=>{__atlas.travel.elapsed=__atlas.travel.duration;});
  await page.waitForFunction(()=>!__atlas.travel);
  await page.waitForFunction(()=>__atlas.data.stats?.surface_cells>10000);
  const sample=()=>page.evaluate(()=>{
    const a=__atlas,m=a.selected,s=a.destinations.sun;
    const offset=a.state.position.map((x,i)=>x-m.position[i]),light=s.position.map((x,i)=>x-m.position[i]);
    return {km:Math.hypot(...offset)*3.085677581491367e13,
      light:offset.reduce((sum,x,i)=>sum+x*light[i],0)/(Math.hypot(...offset)*Math.hypot(...light)),
      surface:a.data.stats.surface_cells};
  });
  const arrival=await sample();
  assert.ok(Math.abs(arrival.km-2400)<1,`Moon arrival ${arrival.km} km from center`);
  assert.ok(arrival.light>.05&&arrival.light<.4,'Moon arrives near the illuminated terminator');
  assert.ok(arrival.surface>10000,'Close arrival resolves the lunar surface');
  await page.waitForTimeout(700);
  const cruise=await sample();
  assert.ok(cruise.light>arrival.light+.02,'Lunar cruise moves toward sunlight');
  await page.evaluate(()=>__atlas.homeCamera());
  await page.mouse.move(1100,350);
  let radius=0;
  for(let i=0;i<75&&radius<25000;i++){
    await page.mouse.wheel(0,100);await page.waitForTimeout(50);
    radius=await page.evaluate(()=>Math.hypot(...__atlas.state.position.map((x,i)=>x-__atlas.selected.position[i])));
  }
  assert.ok(radius>=25000,'Wheel reaches an external Galactic view');
  await page.waitForTimeout(4000);
  const galactic=await page.evaluate(()=>{
    const a=__atlas,north=[-.8676661490190047,-.1980763734312015,.4559837761750669];
    const offset=a.state.position.map((x,i)=>x-a.selected.position[i]);
    return {above:offset.reduce((sum,x,i)=>sum+x*north[i],0)/Math.hypot(...offset),
      hint:document.querySelector('#navigation-hint').textContent};
  });
  assert.ok(galactic.above>.6,'Wide view rises above the Galactic plane');
  assert.match(galactic.hint,/MILKY WAY VISTA/);
  assert.deepEqual(errors,[]);
  console.log('Browser: 2400 km Moon descent, sunward cruise, oblique Milky Way view passed');
} finally {await browser.close();}

const universe=new Universe();
try {
  await universe.init();await universe.fly('moon');
  assert.ok(universe.travel.descent);
  for(let i=0;i<160&&universe.travel;i++)universe.tick(.1);
  assert.equal(universe.travel,null);
  const moon=universe.selected,offset=sub(universe.state.position,moon.position),light=normalize(sub(universe.sun.position,moon.position));
  assert.ok(Math.abs(length(offset)*KM_PER_PC-2400)<1);
  const phase=dot(normalize(offset),light);
  universe.tick(.5);
  assert.ok(dot(normalize(sub(universe.state.position,moon.position)),light)>phase);
  universe.home();universe.orbit.radius=universe.orbit.target=20000;
  universe.zoom(.45);
  for(let i=0;i<100;i++)universe.tick(.1);
  const galacticNorth=[-.8676661490190047,-.1980763734312015,.4559837761750669];
  assert.ok(dot(universe.orbit.offset,galacticNorth)>.6);
  console.log('Terminal: 2400 km Moon descent, sunward cruise, oblique Milky Way view passed');
} finally {await universe.close();}
