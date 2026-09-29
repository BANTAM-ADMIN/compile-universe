import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFile,writeFile} from 'node:fs/promises';
if(!isMainThread){
 globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
 globalThis.fetch=async url=>new Response(await readFile(new URL(`..${url}`,import.meta.url)));
 if(process.env.DEBUG){
  const source=(await readFile(new URL('../web/atlas-worker.js',import.meta.url),'utf8')).replaceAll("'./","'../web/").replace("'../web/atlas-engine.js'","'./atlas-debug.js'");
  await writeFile(new URL('./atlas-worker-debug.mjs',import.meta.url),source);
  await import('./atlas-worker-debug.mjs');
 }else await import('../web/atlas-worker.js');
 parentPort.on('message',data=>self.onmessage({data}));
}else{
 const worker=new Worker(new URL(import.meta.url));let id=0;const pending=new Map();
 worker.on('message',data=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.type==='error'?p.reject(Object.assign(Error(data.error),data)):p.resolve(data);});
 worker.on('error',e=>{for(const p of pending.values())p.reject(e)});
 const request=data=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});worker.postMessage({...data,id:key});});
 try{
  await request({type:'init'});
  const state=JSON.parse(await readFile(new URL('../tests/orion-departure-state.json',import.meta.url)));
  const near=await request({type:'frame',state});console.log(near.stats);
 }finally{await new Promise(resolve=>setTimeout(resolve,100));await worker.terminate();}
}
