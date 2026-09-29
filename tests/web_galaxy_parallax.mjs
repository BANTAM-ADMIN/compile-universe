/** Verify worker camera propagation and real orbit dolly with an isolated source. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('artifacts/galaxy-stars.json', root)));
const center = metadata.centerPc, eye = [400, 500, 600], offset = [6, 0, 100];
const position = eye.map((v,i) => v + center[i]);
const fixture = new Float32Array([...eye.map((v,i) => v + offset[i]), .6 * (6*6+100*100), 1, .8, .6, 0]);
const catalog = Buffer.alloc(128), header = [0x54415543,1,1,0,64,128,128,0,128];
header.forEach((v,i) => catalog.writeUInt32LE(v,i*4));
[0,0,-1e12].forEach((v,i) => catalog.writeDoubleLE(v,64+i*8));
[100,1e-20,1,1,1,0,5772].forEach((v,i) => catalog.writeFloatLE(v,88+i*4));
const origin = process.env.COMPILEUNIVERSE_URL || 'http://127.0.0.1:8781';
const browser = await chromium.launch({headless:true}), errors = [], report = {};
try {
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  let pointsLoaded=0, metadataLoaded=0;
  await context.route('**/artifacts/galaxy-stars.bin', route => { pointsLoaded++; return route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.from(fixture.buffer)}); });
  await context.route('**/artifacts/galaxy-stars.json', route => { metadataLoaded++; return route.fulfill({status:200,json:{...metadata,count:1,bytes:32,stride:32,components:8}}); });
  await context.route('**/artifacts/atlas.bin', route => route.fulfill({status:200,contentType:'application/octet-stream',body:catalog}));
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__compiledAtlas?.ready && __compiledAtlas.data.frame,null,{timeout:60000});
  assert.ok(pointsLoaded>0&&metadataLoaded>0,'The worker must consume the finite production point-pack interface');
  await page.locator('#info-open').click(); await page.locator('#density').selectOption('220,94'); await page.locator('#close-panel').click();
  async function setCamera(pos) {
    const before=await page.evaluate(({position,target}) => {
      const a=__compiledAtlas, frame=a.metrics.frames;
      a.selectTarget({index:0,id:'parallax-fixture',name:'Finite source fixture',position:target,radius_pc:.01},{look:true});
      Object.assign(a.state,{position,yaw:0,pitch:0,fov:50,time:1.337,exposure:1,selectedDestination:null});
      a.setPaused(true); return frame;
    },{position:pos,target:position.map((v,i)=>v+(i===2?100:0))});
    await page.waitForFunction(before=>__compiledAtlas.metrics.frames>before,before);
  }
  async function snapshot() {
    return page.evaluate(() => {
      const a=__compiledAtlas,f=a.data.frame,n=f.cols*f.rows; let total=0,moment=0,hash=2166136261;
      for(let i=0;i<n;i++) {
        const foreground=f.glyphsUint8[i]===32?0:Math.max(...f.foregroundRGBUint8.subarray(i*3,i*3+3));
        const background=Math.max(...f.backgroundRGBUint8.subarray(i*3,i*3+3)), weight=foreground+background;
        total+=weight;moment+=(i%f.cols)*weight;
      }
      for(const bytes of [f.glyphsUint8,f.foregroundRGBUint8,f.backgroundRGBUint8]) for(const byte of bytes) hash=Math.imul(hash^byte,16777619)>>>0;
      return {centroid:moment/total,energy:total,hash,position:[...a.state.position],fov:a.state.fov,time:a.state.time,mode:a.mode,cols:f.cols,rows:f.rows};
    });
  }
  await setCamera(position); const initial=await snapshot();
  await setCamera(position.map((v,i)=>v+(i===0?10:0))); const translated=await snapshot();
  const tanx=Math.tan(25*Math.PI/180)*220/(94*1.8), expectedShift=10/100/tanx*110;
  assert.ok(initial.energy>0); assert.ok(Math.abs(initial.centroid-translated.centroid-expectedShift)<.65,'The real worker must translate finite samples with the camera');
  await setCamera(position); const returned=await snapshot();
  assert.equal(initial.hash,returned.hash,'Returning to the same position/time must restore the exact character frame');
  // In free flight the wheel changes speed. In orbit it changes world position,
  // not FOV. Exercise the actual input path rather than setting orbit state.
  await page.mouse.move(1100,350); await page.mouse.wheel(0,-200); await page.waitForTimeout(80);
  assert.deepEqual(await page.evaluate(()=>__compiledAtlas.state.position),position);
  await page.locator('#mode-toggle').click();
  await page.waitForTimeout(80); const orbitBefore=await snapshot();
  const frames=await page.evaluate(()=>__compiledAtlas.metrics.frames);
  await page.mouse.move(1100,350); await page.mouse.wheel(0,-200);
  await page.waitForFunction(frames=>__compiledAtlas.metrics.frames>frames,frames);
  await page.waitForTimeout(850);
  const approached=await snapshot(), forwardTravel=approached.position[2]-orbitBefore.position[2];
  assert.equal(approached.mode,'orbit'); assert.equal(approached.fov,orbitBefore.fov);
  assert.ok(forwardTravel>5&&forwardTravel<99,'Orbit wheel must dolly through the finite scene');
  const expectedCentroid=(1+6/(100-forwardTravel)/tanx)*110-.5;
  assert.ok(Math.abs(approached.centroid-expectedCentroid)<.65,'Dolly must change the finite source projection');
  assert.equal(approached.time,initial.time,'Scene time stays frozen while the camera moves');
  report.initial=initial; report.translated=translated; report.expectedShiftCells=expectedShift;
  report.returnedExactly=initial.hash===returned.hash; report.orbitDolly=approached; report.forwardTravelPc=forwardTravel;
  report.errors=errors; assert.deepEqual(errors,[]); report.passed=true;
  console.log(JSON.stringify(report,null,2));
} finally {
  await browser.close(); await writeFile(new URL('artifacts/galaxy-parallax-browser.json',root),JSON.stringify(report,null,2)+'\n');
}
