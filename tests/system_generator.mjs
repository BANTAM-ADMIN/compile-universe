/** World persistence, identity, bounds and honest separation from observations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateSystem} from '../web/system-generator.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../artifacts/atlas-search.json',import.meta.url)));
const source=JSON.parse(fs.readFileSync(new URL('../artifacts/systems.json',import.meta.url)));
const chosen=catalog.stars.filter(s=>s.index>0).filter((s,i)=>i%23===0);
const seen=new Set();let planets=0,moons=0;
for(const star of chosen){
 const system=generateSystem(star,source.bodies),again=generateSystem(JSON.parse(JSON.stringify(star)),source.bodies);
 assert.deepEqual(system,again,'Revisiting a star must reconstruct exactly the same system');
 assert.deepEqual(system.host.position,star.position);
 assert.ok(system.bodies.length<=45,'Bounded local work per star');
 for(const b of system.bodies.filter(b=>b.generated)){
  assert.ok(b.index<=-100000 && b.index>-(2**24));assert.ok(!seen.has(b.index),'Stable pick IDs must not collide across stars');seen.add(b.index);
  assert.ok(b.position.every(Number.isFinite));assert.ok(b.radiusPc>0);assert.equal(b.dataClass,'generated-world');
  assert.ok(fs.existsSync(new URL('..'+b.texture.url,import.meta.url)),`Missing generated chart ${b.texture.url}`);
  assert.equal(b.parentStarIndex,star.index);assert.deepEqual(b.hostPosition,star.position);
  const parent=system.bodies.find(p=>p.id===b.parentId)||star;
  const separation=Math.hypot(...b.position.map((v,i)=>v-parent.position[i]));
  assert.ok(separation>(parent.radius_pc||parent.radiusPc)+b.radiusPc,'A generated world must be outside its parent');
  assert.ok(Math.abs(separation/(b.orbitalSemiMajorAxisAU*Math.PI/648000)-1)<.002,'Metadata must describe the generated position');
  if(b.kind==='moon')moons++;else planets++;
 }
}
for(const known of source.systems.filter(s=>s.hostStarIndex>0)){
 const original=source.bodies.filter(b=>b.parentStarIndex===known.hostStarIndex),out=generateSystem(known.host,source.bodies);
 for(const b of original)assert.deepEqual(out.bodies.find(x=>x.id===b.id),b,'Generation must not rewrite measured exoplanets');
}
assert.throws(()=>generateSystem({index:0,position:[0,0,0]}));
const gaia={index:900000,id:'gaia-4657893922535335424',gaia_id:'4657893922535335424',position:[2,3,4],luminosity:1,radius_pc:2.25461e-8};
const first=generateSystem(gaia),second=generateSystem({...gaia,index:900001,id:'gaia-4657893922535335552',gaia_id:'4657893922535335552'});
assert.deepEqual(generateSystem(gaia),first,'Long Gaia identities remain deterministic');
assert.notDeepEqual(first.axis,second.axis,'Distinct Gaia IDs must not collapse into the same random seed');
assert.notDeepEqual(first.bodies.map(b=>b.radiusPc),second.bodies.map(b=>b.radiusPc));
assert.ok(first.bodies.every(b=>b.index>=-(2**31)&&b.position.every(Number.isFinite)));
console.log(JSON.stringify({passed:true,systems:chosen.length,generatedPlanetsAndDwarfs:planets,generatedMoons:moons,uniqueIds:seen.size}));
