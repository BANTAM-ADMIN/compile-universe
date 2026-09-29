import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:get.call(this,type,...args);};});
 await page.goto('http://127.0.0.1:8768/?destination=moon');await page.waitForFunction(()=>__atlas?.ready&&!__atlas.travel&&__atlas.selected.id==='moon',null,{timeout:30000});
 const point=await page.evaluate(()=>{const ui=__atlas.ui.debug(),h=ui.hits.find(h=>h.id==='system-map-open'),r=document.querySelector('#glyphscreen').getBoundingClientRect();return{x:r.x+(h.x+h.w/2)*r.width/ui.cols,y:r.y+(h.y+.5)*r.height/ui.rows};});await page.mouse.click(point.x,point.y);
 await page.waitForFunction(()=>__atlas.map&&!__atlas.map.move,null,{timeout:20000});await page.screenshot({path:'validation/ascii-fallback-mobile.png'});
 assert.equal(await page.evaluate(()=>__atlas.ui.debug().printable&&[...__atlas.data.frame.glyphsUint8].every(c=>c>=32&&c<=126)),true);assert.deepEqual(errors,[]);console.log('Canvas 2D mobile: Moon, printable UI and system-map transition passed');
}finally{await browser.close();}
