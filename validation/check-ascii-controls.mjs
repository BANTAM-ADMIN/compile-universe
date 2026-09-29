import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8768/');await page.waitForFunction(()=>__atlas?.ready,null,{timeout:30000});
 async function click(value,id=false){
  await page.waitForFunction(({value,id})=>__atlas.ui.debug().hits.some(h=>(id?h.id:h.label)===value),{value,id});
  const p=await page.evaluate(({value,id})=>{const ui=__atlas.ui.debug(),h=ui.hits.find(h=>(id?h.id:h.label)===value),r=document.querySelector(__atlas.displayMode==='text'?'#textscreen':'#glyphscreen').getBoundingClientRect();return{x:r.x+(h.x+h.w/2)*r.width/ui.cols,y:r.y+(h.y+.5)*r.height/ui.rows};},{value,id});
  await page.mouse.click(p.x,p.y);await page.waitForTimeout(120);
 }
 await click('info-open',true);await click('density',true);await click('220 x 94');
 await page.waitForFunction(()=>__atlas.state.cols===220);
 const exposure=await page.evaluate(()=>__atlas.state.exposure);await click('+');assert.ok(await page.evaluate(()=>__atlas.state.exposure)>exposure);
 await click('density',true);await click('Adaptive . smooth motion');
 await click('display-mode',true);await click('Selectable text . 15 fps');await page.waitForFunction(()=>__atlas.displayMode==='text'&&document.querySelector('#textscreen').textContent.includes('OBSERVATORY'));
 await click('display-mode',true);await click('Accelerated glyphs');
 await click('close-panel',true);await click('search-open',true);await page.keyboard.type('Moon');
 await click('Moon');await click('fly-preview',true);await page.waitForFunction(()=>!__atlas.travel&&__atlas.selected.id==='moon',null,{timeout:25000});
 assert.ok(await page.evaluate(()=>[...__atlas.data.frame.glyphsUint8].every(c=>c>=32&&c<=126)),'Universe frame must remain printable ASCII');
 assert.ok(await page.evaluate(()=>__atlas.ui.debug().printable));
 // Scene pause should keep controls alive and restore Space to the viewport.
 await click('pause',true);assert.equal(await page.evaluate(()=>__atlas.paused),true);await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>__atlas.paused),false);
 const downloadPromise=page.waitForEvent('download');await page.keyboard.press('Shift+T');const download=await downloadPromise;await download.saveAs('validation/moon-letters.ansi');
 await page.screenshot({path:'validation/moon-letters-final.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({settings:true,searchFlight:true,textMode:true,pauseKeyboard:true,ansiExport:true,printableASCII:true}));
}finally{await browser.close();}
