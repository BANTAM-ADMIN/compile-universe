import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8768/');await page.waitForFunction(()=>__atlas.ready&&__atlas.ui?.cols>0);
  const click=async(label)=>{await page.waitForFunction(label=>__atlas.ui.debug().hits.some(h=>h.label===label),label);const p=await page.evaluate(label=>{const ui=__atlas.ui.debug(),h=ui.hits.find(h=>h.label===label),r=document.querySelector('#glyphscreen').getBoundingClientRect();return {x:r.x+(h.x+h.w/2)*r.width/ui.cols,y:r.y+(h.y+.5)*r.height/ui.rows};},label);await page.mouse.click(p.x,p.y);};
  await click('map');await page.waitForFunction(()=>__atlas.map&&!__atlas.map.move,{},{timeout:20000});await page.waitForTimeout(400);
  const fit=await page.evaluate(()=>{const ui=__atlas.ui,a=ui.mapLayout(),pts=ui.mapProjection.paths.flat().filter(Boolean);return {area:a,rows:ui.rows,cols:ui.cols,bounds:[Math.min(...pts.map(p=>p[0]*ui.cols)),Math.max(...pts.map(p=>p[0]*ui.cols)),Math.min(...pts.map(p=>p[1]*ui.rows)),Math.max(...pts.map(p=>p[1]*ui.rows))],hits:ui.debug().hits.filter(h=>h.kind==='map-node').length};});
  await page.screenshot({path:`validation/ascii-map-${viewport.width}.png`});
  assert.ok(fit.bounds[0]>=0&&fit.bounds[1]<=fit.cols,JSON.stringify(fit));assert.ok(fit.bounds[2]>=fit.area.top&&fit.bounds[3]<fit.area.y,JSON.stringify(fit));
  // The label and list share the same direct-flight action. Use an orbit label.
  await click('Neptune');await page.waitForFunction(()=>!__atlas.map&&__atlas.travel?.destination.id==='neptune');
  await page.waitForFunction(()=>!__atlas.travel&&__atlas.selected.id==='neptune',null,{timeout:25000});
  assert.deepEqual(errors,[]);results.push({viewport,fit,directFlight:true});await page.close();
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
