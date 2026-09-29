import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 for(const port of [8765,8768]) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(()=>window.__atlas?.ready&&__atlas.data.frame,null,{timeout:60000});
  await page.evaluate(()=>{__atlas.setPaused(true);__atlas.state.time=0;});
  await page.waitForTimeout(1200);
  await page.screenshot({path:`COMPILEUNIVERSE_GAIA/validation/earth-port-${port}.png`});
  console.log(port,await page.evaluate(()=>({camera:__atlas.state,selected:__atlas.selected.id,frames:__atlas.metrics.frames})));
  await page.close();
 }
}finally{await browser.close();}
