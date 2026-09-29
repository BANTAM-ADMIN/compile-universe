import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {earthOrientation,earthRotationAngle} from '../web/earth-orientation.js';
const metadata=JSON.parse(await readFile(new URL('../artifacts/earth-orientation.json',import.meta.url)));
const bytes=await readFile(new URL('../artifacts/earth-orientation.bin',import.meta.url));
const chart=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
const reference=JSON.parse(await readFile(new URL('./earth-orientation-reference.json',import.meta.url)));
let largestError=0;
for(const row of reference.cases){
 const actual=earthOrientation(row.utcMs,metadata,chart);
 for(const key of ['axis','greenwich']){
  const error=Math.hypot(...actual[key].map((x,i)=>x-row[key][i]));
  assert.ok(error<3e-7,`${row.iso} ${key}: ${error} radians`);
  largestError=Math.max(largestError,error);
 }
}
const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
const epoch=Date.UTC(2026,8,27),rate=wrap(earthRotationAngle(epoch+1000)-earthRotationAngle(epoch));
assert.ok(Math.abs(rate-2*Math.PI*1.00273781191135448/86400)<1e-11,'Real sidereal rate, not an accelerated spin');
assert.throws(()=>earthOrientation(NaN,metadata,chart));
console.log(JSON.stringify({passed:true,cases:reference.cases.length,maxErrorArcseconds:largestError*180/Math.PI*3600}));
