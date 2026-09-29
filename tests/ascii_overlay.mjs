// A readable UI must not resample or blur the native character sky beneath it.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:8768/health');
 const result=await page.evaluate(async()=>{
  const {GlyphDisplay}=await import('/glyph-display.js');document.body.innerHTML='<div style="width:1440px;height:1000px"><canvas></canvas></div>';
  const display=new GlyphDisplay(document.querySelector('canvas')),cols=220,rows=94,n=cols*rows;
  const base={cols,rows,glyphsUint8:new Uint8Array(n),foregroundRGBUint8:new Uint8Array(n*3),backgroundRGBUint8:new Uint8Array(n*3)};
  for(let i=0;i<n;i++){base.glyphsUint8[i]=32+i%95;for(let k=0;k<3;k++)base.foregroundRGBUint8[i*3+k]=(i*13+k*63)%256;}
  const gl=display.gl,capture=()=>{const bytes=new Uint8Array(display.canvas.width*display.canvas.height*4);gl.readPixels(0,0,display.canvas.width,display.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
  display.render(base);const before=capture();
  const overlay={cols:180,rows:69,glyphsUint8:new Uint8Array(180*69),foregroundRGBUint8:new Uint8Array(180*69*3).fill(255),backgroundRGBUint8:new Uint8Array(180*69*3)};
  for(let y=5;y<10;y++)for(let x=10;x<30;x++)overlay.glyphsUint8[y*180+x]=x%2?65:32;
  display.render(base,overlay);const after=capture(),w=display.canvas.width,h=display.canvas.height;let changed=0,outside=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2]){changed++;const ux=(x+.5)*180/w,uy=(h-y-.5)*69/h;if(ux<10||ux>=30||uy<5||uy>=10)outside++;}}
  return {changed,outside};
 });assert.ok(result.changed>0);assert.equal(result.outside,0);console.log(result);
}finally{await browser.close();}
