// Regression: the real Grand Tour departure that formerly exhausted WASM
// while growing a contiguous buffer beyond 524,288 projected catalog stars.
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(!isMainThread){
 globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
 globalThis.fetch=async url=>new Response(await readFile(new URL(`..${url}`,import.meta.url)));
 await import('../web/atlas-worker.js');
 parentPort.on('message',data=>self.onmessage({data}));
}else{
 const worker=new Worker(new URL(import.meta.url));let id=0;const pending=new Map(),report=[];
 worker.on('message',data=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.type==='error'?p.reject(Object.assign(Error(data.error),data)):p.resolve(data);});
 worker.on('error',error=>{for(const p of pending.values())p.reject(error);});
 const request=data=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});worker.postMessage({...data,id:key});});
 try{
  await request({type:'init'});
  const state=JSON.parse(await readFile(new URL('./orion-departure-state.json',import.meta.url)));
  const destinations=JSON.parse(await readFile(new URL('../artifacts/phenomena-destinations.json',import.meta.url))).destinations;
  await request({type:'prepare-destination',destination:destinations.find(d=>d.id==='crab-pulsar')});
  const frame=async s=>{
   const f=await request({type:'frame',state:s});
   assert.ok(!f.stats.local_error,f.stats.local_error);
   assert.equal(f.buffer.byteLength,s.cols*s.rows*7);
   assert.ok(f.stats.heap_bytes<256*1024**2,'Atlas plus phenomenon engine stays within 256 MiB');
   report.push({grid:[s.cols,s.rows],stars:f.stats.projected_stars,heapBytes:f.stats.heap_bytes,ms:f.stats.frame_ms});
   return f;
  };
  const original=await frame(state);
  assert.ok(original.stats.projected_stars>524288,'Exercise the old failing allocation without removing stars');
  const wide={...state,cols:320,rows:160,fov:35,yaw:Math.atan2(-state.position[0],-state.position[2]),pitch:Math.asin(-state.position[1]/Math.hypot(...state.position))};
  const maximum=await frame(wide);
  assert.ok(maximum.stats.projected_stars>780000,`A centered view must exercise nearly the entire nearby Gaia sample (${maximum.stats.projected_stars})`);
  await frame({...state,cols:96,rows:48});
  const back=await frame(state);
  assert.deepEqual(new Uint8Array(back.buffer),new Uint8Array(original.buffer),'Page reuse and resizing must retain every character/color');
  const stable=await frame(wide);
  assert.deepEqual(new Uint8Array(stable.buffer),new Uint8Array(maximum.buffer));
  const repeat=await frame(wide);
  assert.equal(repeat.stats.heap_bytes,stable.stats.heap_bytes,'A stationary dense view must reuse allocations');
  console.log(JSON.stringify({passed:true,frames:report},null,2));
 }finally{await worker.terminate();}
}
