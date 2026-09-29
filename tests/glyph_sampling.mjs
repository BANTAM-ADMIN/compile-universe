// Uniform characters must not form dark columns when the font is reduced.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true}),results=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`${process.env.COMPILEUNIVERSE_URL||'http://127.0.0.1:8768'}/health`);
 for(const [width,height,cols,rows] of [[1440,1000,220,94],[1366,768,240,93],[390,844,96,65]]){
  for(const glyph of ['!','+','r','L','t']){
   results.push(await page.evaluate(async({width,height,cols,rows,glyph})=>{
    const {GlyphDisplay}=await import('/glyph-display.js');
    document.body.innerHTML=`<div style="width:${width}px;height:${height}px"><canvas></canvas></div>`;
    const display=new GlyphDisplay(document.querySelector('canvas')),n=cols*rows;
    display.render({cols,rows,glyphsUint8:new Uint8Array(n).fill(glyph.charCodeAt(0)),foregroundRGBUint8:new Uint8Array(n*3).fill(255),backgroundRGBUint8:new Uint8Array(n*3)});
    const gl=display.gl,w=display.canvas.width,h=display.canvas.height,pixels=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const columns=[];
    for(let col=1;col<cols-1;col++){
     const start=col*w/cols,end=(col+1)*w/cols;let sum=0;
     for(let x=Math.floor(start);x<Math.ceil(end);x++){
      const overlap=Math.max(0,Math.min(x+1,end)-Math.max(x,start));
      for(let y=0;y<h;y++)sum+=pixels[(y*w+x)*4]*overlap;
     }
     columns.push(sum/((end-start)*h));
    }
    const mean=columns.reduce((a,b)=>a+b,0)/columns.length,spread=Math.sqrt(columns.reduce((a,b)=>a+(b-mean)**2,0)/columns.length)/mean;
    const result={width,height,cols,rows,glyph,mean,columnVariation:spread,min:Math.min(...columns),max:Math.max(...columns)};
    display.observer.disconnect();gl.getExtension('WEBGL_lose_context')?.loseContext();return result;
   },{width,height,cols,rows,glyph}));
  }
 }
 console.log(JSON.stringify(results,null,2));
 if(process.env.REPORT)await writeFile(process.env.REPORT,JSON.stringify(results,null,2)+'\n');
 for(const row of results)assert.ok(row.columnVariation<.10,`${row.glyph} at ${row.cols} columns has ${row.columnVariation} vertical variation`);
}finally{await browser.close();}
