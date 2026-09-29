import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileSurface,surfaceSeed} from '../web/surface-compiler.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const seen=new Set(),timings=[];
for(const style of ['rocky','carbon','ice','lava','desert','ocean','gas','hotgas','icegiant','violet']){
 const seed=surfaceSeed(`world:${style}`),start=performance.now(),a=compileSurface({seed,style}),b=compileSurface({seed,style}),other=compileSurface({seed:seed+1,style});
 assert.equal(a.pixels.length,a.width*a.height*3);assert.equal(a.normals.length,a.pixels.length);
 assert.equal(hash(a.pixels),hash(b.pixels));assert.equal(hash(a.normals),hash(b.normals));assert.notEqual(hash(a.pixels),hash(other.pixels));
 assert.ok(!seen.has(hash(a.pixels)));seen.add(hash(a.pixels));
 // Longitude wraps continuously. A seam jump must be comparable to adjacent
 // texels, not a discontinuity created by independent map edges.
 let seam=0,near=0;for(let y=1;y<a.height-1;y++)for(let k=0;k<3;k++){const row=y*a.width*3;seam+=Math.abs(a.pixels[row+k]-a.pixels[row+(a.width-1)*3+k]);near+=Math.abs(a.pixels[row+k]-a.pixels[row+3+k])+Math.abs(a.pixels[row+(a.width-1)*3+k]-a.pixels[row+(a.width-2)*3+k]);}
 assert.ok(seam<near*1.7+20,`${style}: seam ${seam}, adjacent ${near}`);
 if(['rocky','carbon','ice','lava'].includes(style))assert.ok(a.normals.some((v,i)=>i%3!==2&&Math.abs(v-128)>12),`${style}: missing terrain relief`);
 timings.push({style,msForThree:Math.round(performance.now()-start),bytes:a.bytes});
}
assert.notEqual(surfaceSeed('67559816087678336'),surfaceSeed('67559816087678337'));
console.log(JSON.stringify({deterministic:true,distinctStyles:seen.size,timings},null,2));
