/** Distinguish an empty source-facing departure from a dark Galactic approach. */
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),origin=process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8781';
const browser=await chromium.launch({headless:true}),report={};
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(origin);await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
 await page.evaluate(()=>__atlas.travelTo('vfts-352',{instant:true}));
 await page.waitForFunction(()=>__atlas.data.stats.active_destination===-50000);
 await page.evaluate(()=>__atlas.travelTo('sagittarius-a'));
 await page.waitForFunction(()=>__atlas.journey?.destination.id==='sagittarius-a');
 await page.evaluate(()=>{
  window.exteriorSamples=[];let lastFrame=-1;
  const collect=()=>{
   const a=__atlas,t=a.journey;
   if(a.metrics.frames!==lastFrame){
    lastFrame=a.metrics.frames;
    const direction=[Math.sin(a.state.yaw)*Math.cos(a.state.pitch),Math.sin(a.state.pitch),Math.cos(a.state.yaw)*Math.cos(a.state.pitch)];
    const offset=a.selected.position.map((v,i)=>v-a.state.position[i]),length=Math.hypot(...offset);
    exteriorSamples.push({elapsed:t?.elapsed??14,phase:t?t.elapsed/t.duration:null,position:[...a.state.position],yaw:a.state.yaw,pitch:a.state.pitch,
     coreAngleDegrees:Math.acos(Math.max(-1,Math.min(1,direction.reduce((n,v,i)=>n+v*offset[i]/length,0))))*180/Math.PI,
     lit:a.data.frame.glyphsUint8.reduce((n,ch)=>n+(ch!==32),0),galacticCells:a.data.stats.galactic_cells,
     active:a.data.stats.active_destination,blend:a.data.stats.blend,grid:[a.state.cols,a.state.rows],fov:a.state.fov});
   }
   if(t)requestAnimationFrame(collect);
  };requestAnimationFrame(collect);
 });
 for(const second of [.5,1,1.5,2,3,5,8,10,12,14]){
  await page.waitForFunction(second=>!__atlas.journey||__atlas.journey.elapsed>=second,second);
  await page.screenshot({path:new URL(`artifacts/exterior-saga-${second}.png`,root).pathname});
 }
 report.samples=await page.evaluate(()=>exteriorSamples);
 report.dark=report.samples.filter(row=>row.lit<=20);
 report.summary={darkFrames:report.dark.length,firstDark:report.dark[0],lastDark:report.dark.at(-1),
  minimumAfterTurn:Math.min(...report.samples.filter(row=>row.phase>=.24).map(row=>row.lit)),
  minimumApproach:Math.min(...report.samples.filter(row=>row.phase>=.5).map(row=>row.lit))};
 console.log(JSON.stringify(report.summary,null,2));
}finally{await browser.close();await writeFile(new URL('artifacts/exterior-saga-route.json',root),JSON.stringify(report,null,2)+'\n');}
