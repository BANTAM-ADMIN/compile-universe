// Production worker timings: finite Galactic catalog, atlas, lensing and composition.
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
if(!isMainThread){
  globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
  globalThis.fetch=async url=>new Response(await readFile(new URL(`..${url}`,import.meta.url)),{status:200});
  await import('../web/atlas-worker.js');
  parentPort.on('message',data=>self.onmessage({data}));
}else{
  const worker=new Worker(new URL(import.meta.url)),pending=new Map();let next=0;
  worker.on('message',data=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.type==='error')request.reject(new Error(data.error));else request.resolve(data);});
  worker.on('error',error=>{for(const request of pending.values())request.reject(error);});
  const request=data=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({...data,id});});
  const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))];
  const manifest=JSON.parse(await readFile(new URL('../artifacts/phenomena-destinations.json',import.meta.url)));
  const destination=manifest.destinations.find(item=>item.sceneKind==='blackhole'),records=[];
  try{
    await request({type:'init'});
    await request({type:'prepare-destination',destination});
    for(const [cols,rows] of [[160,70],[220,94],[280,118]])for(const radius of [140,52,24]){
      const wall=[],workerTimes=[],optical=[],galactic=[];let finalStats;
      for(let i=-15;i<60;++i){
        const angle=(i+15)*.005,horizontal=radius*Math.sqrt(1-.06**2);
        const local=[Math.sin(angle)*horizontal,radius*.06,Math.cos(angle)*horizontal];
        const state={cols,rows,position:destination.position.map((value,k)=>value+local[k]*destination.radiusPc),
          yaw:Math.atan2(-local[0],-local[2]),pitch:Math.asin(-local[1]/radius),fov:40,time:(i+15)*.03,exposure:1,
          selectedIndex:destination.index,selectedDestination:destination};
        const began=performance.now(),frame=await request({type:'frame',state}),elapsed=performance.now()-began;
        if(frame.stats.active_scene!=='blackhole'||frame.buffer.byteLength!==cols*rows*7)throw new Error('Black-hole worker frame is incomplete');
        finalStats=frame.stats;
        if(i>=0){wall.push(elapsed);workerTimes.push(frame.stats.worker_ms);optical.push(frame.stats.local_frame_ms);galactic.push(frame.stats.galactic_ms);}
      }
      records.push({cols,rows,radiusRs:radius,samples:wall.length,wallMedianMs:quantile(wall,.5),wallP95Ms:quantile(wall,.95),
        workerMedianMs:quantile(workerTimes,.5),workerP95Ms:quantile(workerTimes,.95),blackholeFrameMedianMs:quantile(optical,.5),
        atlasGalacticSampleMedianMs:quantile(galactic,.5),lensStrength:finalStats.lens_strength,heapBytes:finalStats.heap_bytes});
    }
    const report={description:'Actual Node production-worker CPU/WASM timings, including finite Galactic source index updates, straight atlas sky, black-hole transfer, deflected point sampling, character composition and the transferred 7-byte cell buffer. Observer moves each frame; 15 warmup and 60 measured frames per case. Wall timing includes Node worker dispatch/transfer. These are not browser FPS or low-end hardware measurements. Phenomenon engine is not loaded in this run.',node:process.version,records};
    await writeFile(new URL('../artifacts/blackhole-worker-performance.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await worker.terminate();}
}
