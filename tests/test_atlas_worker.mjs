// Exercise the actual browser worker and WASM module in a CPU-only Node worker.
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

if(!isMainThread){
  globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
  globalThis.fetch=async url=>{
    try{return new Response(await readFile(new URL(`..${url}`,import.meta.url)),{status:200});}
    catch(error){if(error.code==='ENOENT')return new Response('Missing',{status:404});throw error;}
  };
  await import('../web/atlas-worker.js');
  parentPort.on('message',data=>self.onmessage({data}));
}else{
  const worker=new Worker(new URL(import.meta.url));let next=0;
  const pending=new Map();worker.on('message',data=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.type==='error'?p.reject(new Error(data.error)):p.resolve(data);});
  worker.on('error',error=>{for(const p of pending.values())p.reject(error);});
  const request=data=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({...data,id});});
  try{
    const ready=await request({type:'init'});assert.equal(ready.type,'ready');
    assert.equal(ready.surveyAvailable,true);
    const gaiaIndex=ready.catalogCount-1,{star:gaia}=await request({type:'star',index:gaiaIndex});
    const pack=await readFile(new URL('../artifacts/gaia-atlas.bin',import.meta.url)),offset=pack.readUInt32LE(16)+gaiaIndex*64;
    const expectedId=(BigInt(pack.readUInt32LE(offset+60))<<32n)|BigInt(pack.readUInt32LE(offset+52));
    assert.equal(gaia.gaia_id,expectedId.toString());assert.ok(expectedId>2n**53n);
    assert.ok(Number.isFinite(gaia.photG));assert.match(gaia.dataClass,/reconstructed/);
    const body={index:-128000001,id:'test-generated',name:'Worker test world',position:[2,0,0],radiusPc:1e-7,
      hostPosition:[2,0,-1],parentStarIndex:0,texture:{url:'/artifacts/surface-mercury.bin',width:512,height:256},shape:[1.2,.8,1]};
    const belt={id:'test-belt',position:[2,0,0],axis:[0,0,1],innerRadiusAU:1,outerRadiusAU:2,count:1400,seed:1729};
    const state={cols:96,rows:48,position:[2,0,-3e-7],yaw:0,pitch:0,time:1.2,fov:55,selectedIndex:body.index};
    const baseline=await request({type:'frame',state});
    const registered=await request({type:'set-system',bodies:[body],belts:[belt]});assert.equal(registered.type,'system-ready');
    const a=await request({type:'frame',state});
    assert.equal(a.buffer.byteLength,96*48*7);assert.equal(a.stats.planetary_bodies,ready.bodies.length+1);assert.equal(a.stats.belt_particles,baseline.stats.belt_particles+1400);
    const picked=await request({type:'pick',x:.5,y:.5});assert.equal(picked.index,body.index);assert.equal(picked.body.name,body.name);
    assert.ok(a.labels.some(label=>label.index===body.index),'Large generated-body IDs must survive label transport exactly');
    const b=await request({type:'frame',state});assert.deepEqual(new Uint8Array(a.buffer),new Uint8Array(b.buffer));
    await request({type:'set-system',bodies:[],belts:[]});
    const cleared=await request({type:'frame',state});assert.equal(cleared.stats.planetary_bodies,ready.bodies.length);
    const absent=await request({type:'star',index:body.index});assert.equal(absent.star,null);
    console.log(JSON.stringify({passed:true,fixedBodies:ready.bodies.length,heapBytes:a.stats.heap_bytes,frameMs:a.stats.frame_ms}));
  }finally{await worker.terminate();}
}
