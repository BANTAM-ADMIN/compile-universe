// Host the exact browser rendering worker locally; no DOM, HTTP or WebGL.
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!isMainThread){
 globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
 globalThis.fetch=async url=>{
  const path=resolve(root,String(url).replace(/^\//,''));
  if(!path.startsWith(root.endsWith(sep)?root:root+sep))throw Error('Asset path escapes the universe directory');
  try{return new Response(await readFile(path),{status:200});}
  catch(e){if(e.code==='ENOENT')return new Response('Missing local asset',{status:404});throw e;}
 };
 await import('../web/atlas-worker.js');
 parentPort.on('message',data=>self.onmessage({data}));
}
export class Engine {
 constructor(){
  this.worker=new Worker(new URL(import.meta.url),{stdout:true,stderr:true});this.logs='';
  for(const stream of [this.worker.stdout,this.worker.stderr])stream.on('data',chunk=>{this.logs=(this.logs+chunk).slice(-4096);});
  this.pending=new Map();this.next=0;this.closed=false;
  this.worker.on('message',data=>{const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);if(data.type==='error')p.reject(new Error(data.error));else p.resolve(data);});
  this.worker.on('error',error=>this.fail(error));
  this.worker.on('exit',code=>{if(!this.closed)this.fail(new Error(`Renderer worker exited (${code})`));});
 }
 fail(error){this.error=error;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 request(data){
  if(this.closed||this.error)return Promise.reject(this.error||Error('Renderer is closed'));
  return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Renderer request timed out'));},90000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({...data,id});});
 }
 async close(){this.closed=true;this.fail(Error('Renderer closed'));await this.worker.terminate();}
}
