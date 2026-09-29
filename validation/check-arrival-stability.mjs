import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:8768/');
 await page.waitForFunction(()=>window.__atlas?.ready,null,{timeout:60000});
 await page.click('#blackhole-open');
 await page.waitForFunction(()=>__atlas.travel);
 await page.waitForFunction(()=>!__atlas.travel,null,{timeout:45000});
 await page.evaluate(()=>{
  window.arrivalSamples=[];const start=performance.now();let previous=-1;
  const sample=()=>{
   if(__atlas.metrics.frames!==previous){previous=__atlas.metrics.frames;arrivalSamples.push({t:performance.now()-start,cols:__atlas.state.cols,rows:__atlas.state.rows,ms:__atlas.data.stats.worker_ms,cached:__atlas.data.stats.cached_geometry});}
   if(performance.now()-start<14000)requestAnimationFrame(sample);
  };sample();
 });
 await page.waitForTimeout(14500);
 const samples=await page.evaluate(()=>arrivalSamples);
 const report={grids:[...new Set(samples.map(x=>`${x.cols}x${x.rows}`))],samples};
 await writeFile(`validation/arrival-${process.argv[2]||'after'}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({grids:report.grids,frames:samples.length}));
}finally{await browser.close();}
