// Actual WASM integration of the shared galactic field and outgoing-ray lookup.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import createUniverse from '../web/engine.js';
const engine=await createUniverse({wasmBinary:await readFile(new URL('../web/engine.wasm',import.meta.url))});
const allocate=bytes=>{const p=engine._malloc(bytes.byteLength);assert.ok(p);engine.HEAPU8.set(bytes,p);return p;};
const optical=await readFile(new URL('../artifacts/universe.bin',import.meta.url));
assert.equal(engine._cu_init(allocate(optical),optical.byteLength),0);
const galaxy=allocate(await readFile(new URL('../artifacts/galaxy.bin',import.meta.url)));
const params=allocate(new Uint8Array(new Float64Array(16).buffer));
const cols=96,rows=48,n=cols*rows;
function frame(yaw=Math.PI,pitch=-Math.atan2(4,24)){
  assert.equal(engine._cu_frame(cols,rows,0,4,24,yaw,pitch,55,.713,1,1,0),0,engine.UTF8ToString(engine._cu_error()));
  return {output:engine.HEAPU8.slice(engine._cu_output(),engine._cu_output()+7*n),
    mask:engine.HEAPU8.slice(engine._cu_mask(),engine._cu_mask()+n),
    objects:engine.HEAPU8.slice(engine._cu_object_mask(),engine._cu_object_mask()+n),
    stats:engine.HEAPF32.slice(engine._cu_stats()>>2,(engine._cu_stats()>>2)+12)};
}
const baseline=frame().output;
engine._cu_set_overlay(1);
assert.equal(engine._cu_set_environment(galaxy,1024,512,params),0);
const lensed=frame();assert.equal(lensed.stats[8],1);assert.ok(lensed.stats[9]>0&&lensed.stats[10]>0);
assert.ok(lensed.mask.every(x=>x===255));assert.ok(lensed.objects.some(x=>x===0));assert.ok(lensed.objects.some(x=>x===255));
assert.deepEqual(frame().output,lensed.output);
assert.equal(engine._cu_set_lens_strength(0),0);
const straight=frame();assert.equal(straight.stats[11],0);assert.ok(straight.objects.every(x=>x===0));
assert.ok(straight.mask.every(x=>x===255));assert.ok(straight.output.subarray(0,n).every(x=>[32,46,58,42,43,35].includes(x)));
assert.equal(engine._cu_set_lens_strength(.5),0);
const halfway=frame();assert.equal(halfway.stats[11],.5);assert.ok(halfway.objects.some(x=>x>0&&x<255));
assert.ok(halfway.mask.every(x=>x===255));assert.notDeepEqual(halfway.output,straight.output);assert.notDeepEqual(halfway.output,lensed.output);
assert.equal(engine._cu_set_lens_strength(1),0);assert.deepEqual(frame().output,lensed.output);
const away=frame(0,0);assert.ok(away.objects.every(x=>x===0));assert.ok(away.output.subarray(0,n).some(x=>x!==32));
assert.ok(away.mask.every(x=>x===255));
const spatialBytes=await readFile(new URL('../artifacts/galaxy-stars.bin',import.meta.url));
const spatialPointer=allocate(spatialBytes);
assert.equal(engine._cu_set_galaxy(spatialPointer,spatialBytes.length/32,params),0);
const spatial=frame();assert.ok(spatial.mask.every(x=>x===255));
assert.ok(spatial.output.subarray(0,n).filter((x,i)=>x!==32&&spatial.objects[i]===0).length>20);
new Float64Array(engine.HEAPU8.buffer,params,3).set([2,0,0]);
assert.equal(engine._cu_set_galaxy(spatialPointer,spatialBytes.length/32,params),0);
const displaced=frame();assert.notDeepEqual(displaced.output,spatial.output);
assert.equal(engine._cu_set_galaxy(0,0,params),0);
assert.equal(engine._cu_set_environment(0,0,0,0),0);engine._cu_set_overlay(0);
assert.deepEqual(frame().output,baseline);
console.log(JSON.stringify({passed:true,escapingSkyCells:lensed.stats[9],capturedCells:lensed.stats[10],objectOnlyPicking:true,finitePointParallax:true,defaultRestored:true}));
