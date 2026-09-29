import {readFile} from 'node:fs/promises';
import createPhenomena from '../web/phenomena-engine.js';
const wasmBinary=await readFile(new URL('../web/phenomena-engine.wasm',import.meta.url));
const module=await createPhenomena({wasmBinary});
const asset=await readFile(new URL('../artifacts/phenomena.bin',import.meta.url)),ptr=module._malloc(asset.length);
module.HEAPU8.set(asset,ptr);
if(module._phenomena_init(ptr,asset.length))throw new Error(module.UTF8ToString(module._phenomena_error()));
const scenes=[];
for(let scene=0;scene<6;scene++){
  const times=[];let samples=0;
  for(let i=0;i<65;i++){
    if(module._phenomena_frame(220,94,scene,.25+i*.004,.18,5.,i*.07,1.))throw new Error(module.UTF8ToString(module._phenomena_error()));
    const base=module._phenomena_stats()>>2;if(i>=5)times.push(module.HEAPF32[base]);samples=module.HEAPF32[base+1];
  }
  times.sort((a,b)=>a-b);scenes.push({scene,median_ms:times[30],p95_ms:times[57],field_samples:samples});
}
console.log(JSON.stringify({cols:220,rows:94,heap_bytes:module.HEAPU8.byteLength,scenes},null,2));
