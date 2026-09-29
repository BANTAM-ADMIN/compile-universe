// The same real worker, world coordinates, compiled engines, and packed cells
// used by the browser; this harness only replaces HTTP with local asset reads.
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(!isMainThread){
  const failures=new Set();
  globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
  globalThis.fetch=async url=>{
    if(failures.delete(url))return new Response('Intentional fixture failure',{status:503});
    try{return new Response(await readFile(new URL(`..${url}`,import.meta.url)),{status:200});}
    catch(error){if(error.code==='ENOENT')return new Response('Missing',{status:404});throw error;}
  };
  await import('../web/atlas-worker.js');
  parentPort.on('message',data=>{
    if(data.type==='test-fail-once'){failures.add(data.url);parentPort.postMessage({type:'test-ready',id:data.id});}
    else self.onmessage({data});
  });
}else{
  const worker=new Worker(new URL(import.meta.url));let next=0;const pending=new Map();
  worker.on('message',data=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.type==='error')p.reject(Object.assign(new Error(data.error),data));else p.resolve(data);});
  worker.on('error',error=>{for(const p of pending.values())p.reject(error);});
  const request=data=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({...data,id});});
  const manifest=JSON.parse(await readFile(new URL('../artifacts/phenomena-destinations.json',import.meta.url))),destinations=manifest.destinations;
  const state=(d,distance=6,extra={})=>({cols:96,rows:48,position:d.position.map((v,i)=>v+(i===2?distance*d.radiusPc:0)),yaw:Math.PI,pitch:0,fov:54,time:1.5,exposure:1,selectedDestination:d,selectedIndex:d.index,...extra});
  try{
    await request({type:'init'});
    await request({type:'test-fail-once',url:'/artifacts/phenomena.bin'});
    await assert.rejects(request({type:'prepare-destination',destination:destinations[0]}),error=>error.scope==='destination');
    const ordinary=await request({type:'frame',state:{cols:96,rows:48,position:[0,0,-1],yaw:0,pitch:0}});
    assert.equal(ordinary.stats.active_scene,'atlas');
    const distantBinary=state(destinations[0],1000,{selectedDestination:null,selectedIndex:-1});
    const unselected=await request({type:'frame',state:distantBinary});
    assert.equal(unselected.stats.active_scene,'atlas');
    assert.ok(unselected.stats.persistent_destinations>0,'Real destination exists before its closeup is active');
    const distantPick=await request({type:'pick',x:.5,y:.5});
    assert.equal(distantPick.index,destinations[0].index,'The distant dot is the binary at its real world position');
    const selectedBinary=await request({type:'frame',state:{...distantBinary,selectedIndex:destinations[0].index}});
    assert.deepEqual(new Uint8Array(unselected.buffer),new Uint8Array(selectedBinary.buffer),'Selection must not spawn or brighten the binary');
    const reports=[];
    for(const d of destinations){
      await request({type:'prepare-destination',destination:d});
      const s=state(d,d.sceneKind==='blackhole'?24:6);
      const near=await request({type:'frame',state:s});
      assert.equal(near.stats.active_scene,d.sceneKind);assert.equal(near.stats.active_destination,d.index);assert.equal(near.stats.blend,1);
      assert.ok(near.stats.local_cells>10);assert.equal(near.buffer.byteLength,96*48*7);
      const repeat=await request({type:'frame',state:s});assert.deepEqual(new Uint8Array(near.buffer),new Uint8Array(repeat.buffer));
      if(d.sceneId===2||d.sceneId===3){
        const later=await request({type:'frame',state:{...s,time:24}});assert.equal(later.stats.volume_cached,true);
        assert.deepEqual(new Uint8Array(near.buffer),new Uint8Array(later.buffer),'Static volume cache must preserve exact character bytes across animation time');
        const moved=await request({type:'frame',state:{...s,yaw:s.yaw+.1}});assert.equal(moved.stats.volume_cached,false,'Free camera motion must reproject the volume');
      }
      if(d.sceneId===4)assert.deepEqual(repeat.stats.cached_context_layers,[-50002],'Animating pulsar must reuse its stationary remnant');
      const away=await request({type:'frame',state:{...s,yaw:0}});assert.equal(away.stats.primary_cells,0,`${d.name}: looking away still paints the selected object`);
      // Outside our Galaxy, looking away from it may correctly reveal empty
      // space. Galactic destinations must retain their actual surrounding sky.
      if(!['vfts-352','3c-273'].includes(d.id))assert.ok(away.stats.galactic_cells>15,`${d.name}: surrounding Milky Way lost (${away.stats.galactic_cells} cells)`);
      if(d.sceneId===4){assert.deepEqual(near.stats.context_layers,[-50002]);assert.ok(away.stats.local_cells>100,'The Crab remnant must still surround its pulsar');}
      if(d.sceneKind==='blackhole'){assert.equal(near.stats.lensed_environment,true);assert.ok(near.stats.environment_cells>1000);}
      const departure=await request({type:'frame',state:{...s,selectedDestination:null,selectedIndex:0}});assert.equal(departure.stats.active_destination,d.index);
      reports.push({name:d.name,frameMs:near.stats.frame_ms,cells:near.stats.local_cells});
    }
    const bh=destinations.find(d=>d.sceneKind==='blackhole');
    const transition=await request({type:'frame',state:state(bh,7577.6,{surveyMode:0})});assert.ok(Math.abs(transition.stats.blend-.06075)<.002);
    const outside=await request({type:'frame',state:state(bh,8192.001,{surveyMode:0})});assert.equal(outside.stats.active_scene,'atlas');
    const onset=await request({type:'frame',state:state(bh,8191.999,{surveyMode:0})});
    const straightBytes=new Uint8Array(outside.buffer),curvedBytes=new Uint8Array(onset.buffer),n=96*48;
    let glyphChanges=0,meanColorChange=0;
    for(let i=0;i<n;i++)glyphChanges+=Number(straightBytes[i]!==curvedBytes[i]);
    for(let i=n;i<n*7;i++)meanColorChange+=Math.abs(straightBytes[i]-curvedBytes[i])/(n*6);
    assert.ok(glyphChanges<=8,`Renderer handoff changed ${glyphChanges} glyphs at effectively zero lens strength`);
    assert.ok(meanColorChange<.1,`Renderer handoff flashed by ${meanColorChange} color levels`);
    assert.ok(onset.stats.lens_strength<1e-6);
    assert.ok(transition.stats.lens_strength>.05&&transition.stats.lens_strength<.07);
    console.log(JSON.stringify({passed:true,recoverablePreloadFailure:true,worldCamera:true,sourceRetained:true,seamlessHandoff:{glyphChanges,meanColorChange},scenes:reports,heapBytes:outside.stats.heap_bytes},null,2));
  }finally{await worker.terminate();}
}
