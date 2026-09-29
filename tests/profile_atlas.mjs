/** Actual CPU/WASM timings. No browser, artificial slowdown, or GPU rendering. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import createAtlas from '../web/atlas-engine.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const asset=fs.readFileSync(`${root}artifacts/atlas.bin`);
const solar=JSON.parse(fs.readFileSync(`${root}artifacts/solar.json`));
const systems=JSON.parse(fs.readFileSync(`${root}artifacts/systems.json`));
const search=JSON.parse(fs.readFileSync(`${root}artifacts/atlas-search.json`));
const destinations=JSON.parse(fs.readFileSync(`${root}artifacts/phenomena-destinations.json`)).destinations;
const galacticCenter=destinations.find(destination=>destination.sceneKind==='blackhole');
const galaxy=fs.readFileSync(`${root}artifacts/galaxy-stars.bin`),galaxyMetadata=JSON.parse(fs.readFileSync(`${root}artifacts/galaxy-stars.json`));
const alpha=search.stars.find(s=>s.aliases.includes('Alpha Centauri A'));
const engine=await createAtlas({wasmBinary:fs.readFileSync(`${root}web/atlas-engine.wasm`)});
const alloc=data=>{const p=engine._malloc(data.length);engine.HEAPU8.set(data,p);return p;};
if(engine._atlas_init(alloc(asset),asset.length))throw Error(engine.UTF8ToString(engine._atlas_error()));
if(!galacticCenter||galaxy.length!==galaxyMetadata.count*32)throw Error('Invalid finite Galactic source catalog');
const galaxyPointer=alloc(galaxy),environmentPointer=engine._malloc(16*8);
if(!environmentPointer)throw Error('Could not allocate galactic observer parameters');
const earth=solar.earth, textures=new Map();
const texture=t=>{if(!textures.has(t.url))textures.set(t.url,alloc(fs.readFileSync(root+t.url.slice(1))));return textures.get(t.url);};
for(const b of systems.bodies){
 const p=new Float64Array(21);p.set(b.position);p[3]=b.radiusPc;p.set(b.hostPosition,4);p.set(b.axis||[0,0,1],7);
 p[10]=b.primeMeridian||0;p[11]=b.rotationRate??.012;p[12]=b.ring?.innerRadius||0;p[13]=b.ring?.outerRadius||0;
 p[14]=b.comet?.tailLengthRadii||0;p[15]=({rocky:0,gas:1,ice:2,lava:3,water:4,comet:5})[b.appearanceKind]||0;p[16]=b.atmosphere?.strength||0;p.set(b.atmosphere?.color||[.08,.4,1],17);p[20]=b.parentStarIndex||0;
 const pointer=alloc(new Uint8Array(p.buffer));
 if(engine._atlas_add_body(b.index,pointer,texture(b.texture),b.texture.width,b.texture.height,b.ring?texture(b.ring.texture):0,b.ring?.texture.width||0))throw Error(engine.UTF8ToString(engine._atlas_error()));
 engine._free(pointer);
 if(b.shape&&engine._atlas_set_body_shape(b.index,...b.shape))throw Error(engine.UTF8ToString(engine._atlas_error()));
 if(b.comet&&engine._atlas_set_body_comet(b.index,b.comet.tailLengthRadii,b.comet.comaRadiusRadii))throw Error(engine.UTF8ToString(engine._atlas_error()));
}
for(const b of systems.belts||[]){
 const au=Math.PI/648000,p=new Float64Array(16);p.set(b.position||[0,0,0]);p.set(b.axis||[0,0,1],3);p[6]=b.innerRadiusAU*au;p[7]=b.outerRadiusAU*au;p[8]=(b.outerRadiusAU-b.innerRadiusAU)*.035*au;p[9]=b.seed;p[10]=b.count||1400;p[11]=b.hostStarIndex||0;p.set(b.color||[.72,.61,.43],12);p[15]=b.brightness||1;
 const pointer=alloc(new Uint8Array(p.buffer));if(engine._atlas_add_belt(pointer))throw Error(engine.UTF8ToString(engine._atlas_error()));engine._free(pointer);
}
const direction=(from,to)=>{const d=to.map((v,i)=>v-from[i]);return [Math.atan2(d[0],d[2]),Math.asin(d[1]/Math.hypot(...d))];};
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length*.5)];
const percentile=(a,q)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*q))];
const measuredFrames=Number(process.env.COMPILEUNIVERSE_PROFILE_SAMPLES||60),warmupFrames=15,records=[];
if(!Number.isInteger(measuredFrames)||measuredFrames<20||measuredFrames>1000)throw Error('COMPILEUNIVERSE_PROFILE_SAMPLES must be an integer from20 to1000');
for(const [cols,rows] of [[160,70],[220,94],[280,118]])for(const scenario of ['earth-orbit','interstellar-flight','alpha-surface','jupiter','saturn','moon','phobos','halley','proxima-b','galactic-core-environment','galaxy-overview-faceon','galaxy-overview-edge']){
 const elapsed=[],compute=[],tested=[],visible=[],environment=[],environmentCells=[];
 for(let i=-warmupFrames;i<measuredFrames;i++){
  const t=(i+warmupFrames)/(measuredFrames+warmupFrames);let position,target,selected;
  if(scenario==='earth-orbit'){const a=t*.6;position=earth.position.map((v,k)=>v+earth.radiusPc*3.4*[Math.sin(a),.35,-Math.cos(a)][k]);target=earth.position;selected=-2;}
  else if(scenario==='interstellar-flight'){position=alpha.position.map(v=>v*(.03+.94*t));target=alpha.position;selected=alpha.index;}
  else if(scenario==='alpha-surface'){const a=t*.7;position=alpha.position.map((v,k)=>v+alpha.radius_pc*3.4*[Math.sin(a),.15,-Math.cos(a)][k]);target=alpha.position;selected=alpha.index;}
  else if(scenario==='galactic-core-environment'){const a=t*.7;position=galacticCenter.position.map((v,k)=>v+galacticCenter.radiusPc*24*[Math.sin(a),.2,Math.cos(a)][k]);target=galacticCenter.position;selected=galacticCenter.index;}
  else if(scenario.startsWith('galaxy-overview-')){
   const gx=[-.0548755604162154,-.8734370902348850,-.4838350155487132],gy=[.4941094278755837,-.4448296299600112,.7469822444972180],gz=[-.8676661490190047,-.1980763734312015,.4559837761750669];
   const radial=scenario.endsWith('faceon')?1200:60000,height=scenario.endsWith('faceon')?40000:3000,a=t*.35;
   position=galacticCenter.position.map((v,k)=>v+radial*(gx[k]*Math.cos(a)+gy[k]*Math.sin(a))+height*gz[k]);target=galacticCenter.position;selected=galacticCenter.index;
  }
  else {const b=systems.bodies.find(b=>b.id===scenario),light=b.hostPosition.map((v,k)=>v-b.position[k]),ln=Math.hypot(...light),axis=b.axis||[0,0,1];
   const look=light.map((v,k)=>v/ln*(b.comet?.25:1)+axis[k]*(b.comet?.97:b.ring?.9:.2)+[Math.sin(t*.6)*.3,0,0][k]),n=Math.hypot(...look),r=b.radiusPc*(b.comet?64:b.ring?7:3.5);
   position=b.position.map((v,k)=>v+look[k]/n*r);target=b.position;selected=b.index;}
  const [yaw,pitch]=direction(position,target),start=performance.now();
  new Float64Array(engine.HEAPU8.buffer,environmentPointer,3).set(position.map((value,k)=>value-galacticCenter.position[k]));
  if(engine._atlas_set_galaxy(galaxyPointer,galaxyMetadata.count,environmentPointer))throw Error(engine.UTF8ToString(engine._atlas_error()));
  if(engine._atlas_frame(cols,rows,...position,yaw,pitch,55,t,1,selected))throw Error(engine.UTF8ToString(engine._atlas_error()));
  // Include a real transferable-sized output copy, as the browser worker does.
  const bytes=engine.HEAPU8.slice(engine._atlas_output(),engine._atlas_output()+cols*rows*7);
  if(bytes.length!==cols*rows*7)throw Error('Incomplete frame');
  const done=performance.now(),s=engine.HEAPF32.slice(engine._atlas_stats()>>2,(engine._atlas_stats()>>2)+28);
  if(i>=0){elapsed.push(done-start);compute.push(s[0]);tested.push(s[3]);visible.push(s[4]);environment.push(s[24]);environmentCells.push(s[25]);}
 }
 records.push({scenario,cols,rows,samples:elapsed.length,wallMedianMs:median(elapsed),wallP95Ms:percentile(elapsed,.95),
  computeMedianMs:median(compute),environmentMedianMs:median(environment),environmentCellsMedian:median(environmentCells),testedMedian:median(tested),visibleMedian:median(visible)});
}
const report={description:`Actual Node CPU/WASM atlas timings with the production finite 3D Galactic source catalog updated from world camera minus Sagittarius A* each frame, including rebuilding the angular source index and copying the 7-byte character output; ${warmupFrames} warmup frames then ${measuredFrames} changing camera frames per case. Galactic-core-environment measures the straight atlas sky near the core, not black-hole disk/lensing or scene composition. These are not browser FPS or low-end hardware measurements.`,
 node:process.version,heapBytes:engine.HEAPU8.byteLength,catalogBytes:asset.length,galaxyBytes:galaxy.length,galaxyPointCount:galaxyMetadata.count,environmentEnabled:true,bodyCount:systems.bodies.length,beltCount:systems.belts?.length||0,uniqueTextureAssets:textures.size,measuredFrames,warmupFrames,records};
fs.writeFileSync(`${root}artifacts/atlas-wasm-performance.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
