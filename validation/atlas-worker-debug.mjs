import createAtlas from './atlas-debug.js';
import {earthOrientation} from '../web/earth-orientation.js';

let engine, ready, owned = [], catalogPointer = 0, starOffset = 0;
const textureAssets = new Map();
const localAnchors=new Map();
const volumeFrames=new Map();
let phenomenonEngine=null,blackholeEngine=null,phenomenonLoading=null,blackholeLoading=null;
let overlayPointer=0,overlayCapacity=0;
let lastActiveDestination=null;
let galacticBytes=null,galacticPointer=0,environmentParameters=0;
let galacticCenter=[-452.40000969794926,-7224.528431592306,-4013.757861697653];
let galacticCount=0, surveyPointer=0, surveyInfo=null, surveyObservations=null, surveyMode=1;
let earthOrientationMetadata=null,earthOrientationChart=null;
function setEnvironment(module,texture,parameters,position,blackhole=false){
 new Float64Array(module.HEAPU8.buffer,parameters,3).set(position.map((value,i)=>value-galacticCenter[i]));
 if(surveyMode===2){texture=0;}
 const result=blackhole?module._cu_set_galaxy(texture,galacticCount,parameters):module._atlas_set_galaxy(texture,galacticCount,parameters);
 if(result)throw new Error(module.UTF8ToString(blackhole?module._cu_error():module._atlas_error()));
}
async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
function allocate(bytes) {
  const pointer = engine._malloc(bytes.byteLength);
  if (!pointer) throw new Error('Atlas asset allocation failed');
  engine.HEAPU8.set(bytes, pointer); owned.push(pointer); return pointer;
}
function check(result) {
  if (result) throw new Error(engine.UTF8ToString(engine._atlas_error()));
}
function anchorRecord(destination){
  if(!destination||!['phenomenon','blackhole'].includes(destination.sceneKind))return null;
  const radius=Number(destination.modelUnitPc ?? destination.radiusPc ?? destination.radius_pc);
  if(!Number.isInteger(destination.index)||destination.index>-2||!Array.isArray(destination.position)||destination.position.length!==3||!destination.position.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)
    throw new Error('Invalid world destination transform');
  if(destination.sceneKind==='phenomenon'&&(!Number.isInteger(destination.sceneId)||destination.sceneId<0||destination.sceneId>5))throw new Error('Unknown phenomenon scene');
  const record={...destination,radiusPc:radius,position:[...destination.position]};
  localAnchors.set(record.index,record);
  return record;
}
async function loadLocalEngine(kind){
  if(kind==='phenomenon'){
    if(phenomenonEngine)return phenomenonEngine;
    if(!phenomenonLoading)phenomenonLoading=(async()=>{
      const [{default:create},bytes]=await Promise.all([import('../web/phenomena-engine.js'),fetchBytes('/artifacts/phenomena.bin')]);
      const module=await create(),pointer=module._malloc(bytes.length);if(!pointer)throw new Error('Could not allocate the phenomenon field');module.HEAPU8.set(bytes,pointer);
      if(module._phenomena_init(pointer,bytes.length))throw new Error(module.UTF8ToString(module._phenomena_error()));
      phenomenonEngine={module,pointer,assetBytes:bytes.length};return phenomenonEngine;
    })().catch(error=>{phenomenonLoading=null;throw error;});
    return phenomenonLoading;
  }
  if(blackholeEngine)return blackholeEngine;
  if(!blackholeLoading)blackholeLoading=(async()=>{
    const [{default:create},bytes]=await Promise.all([import('../web/engine.js'),fetchBytes('/artifacts/universe.bin')]);
    const module=await create(),pointer=module._malloc(bytes.length);if(!pointer)throw new Error('Could not allocate the black-hole lookup table');module.HEAPU8.set(bytes,pointer);
    if(module._cu_init(pointer,bytes.length))throw new Error(module.UTF8ToString(module._cu_error()));
    const environmentPointer=module._malloc(galacticBytes.length),parametersPointer=module._malloc(128);
    if(!environmentPointer||!parametersPointer)throw new Error('Could not allocate the shared galactic sky');
    module.HEAPU8.set(galacticBytes,environmentPointer);
    blackholeEngine={module,pointer,environmentPointer,parametersPointer,assetBytes:bytes.length};return blackholeEngine;
  })().catch(error=>{blackholeLoading=null;throw error;});
  return blackholeLoading;
}
function nearestLocal(position,preferredIndex){
  let nearest=null;
  for(const anchor of localAnchors.values()){
    const resource=anchor.sceneKind==='blackhole'?blackholeEngine:phenomenonEngine;if(!resource)continue;
    const local=position.map((value,i)=>(value-anchor.position[i])/anchor.radiusPc),distance=Math.hypot(...local);
    const outer=anchor.sceneKind==='blackhole'?8192:80,inner=anchor.sceneKind==='blackhole'?4096:35;
    if(distance>=outer)continue;
    const t=Math.max(0,Math.min(1,(outer-distance)/(outer-inner))),blend=t*t*(3-2*t),score=distance/outer;
    const candidate={anchor,resource,local,distance,blend,score};
    if(anchor.index===preferredIndex)return candidate;
    if(!nearest||anchor.index===lastActiveDestination||nearest.anchor.index!==lastActiveDestination&&score<nearest.score)nearest=candidate;
  }
  return nearest;
}
function compositeLocal(active,s,cols,rows){
  const {anchor,resource,local,distance,blend}=active,module=resource.module,n=cols*rows;
  let output,mask,objectMask=0,details,colors=null,coverage=null;
  if(anchor.sceneKind==='phenomenon'){
    const staticVolume=anchor.sceneId===2||anchor.sceneId===3;
    const key=staticVolume?[cols,rows,...local,s.yaw??0,s.pitch??0,s.fov??55,s.exposure??1]:null;
    let cached=staticVolume?volumeFrames.get(anchor.sceneId):null;
    if(cached&&key.every((value,i)=>value===cached.key[i])){
      colors=cached.colors;coverage=cached.coverage;
      details={local_frame_ms:0,field_samples:0,phenomenon_scene:anchor.sceneId,volume_cached:true};
    }else{
      if(module._phenomena_frame_camera(cols,rows,anchor.sceneId,...local,s.yaw ?? 0,s.pitch ?? 0,s.fov ?? 55,s.time ?? 0,s.exposure ?? 1))throw new Error(module.UTF8ToString(module._phenomena_error()));
      output=module._phenomena_output();mask=module._phenomena_mask();const values=module.HEAPF32.subarray(module._phenomena_stats()>>2,(module._phenomena_stats()>>2)+4);
      details={local_frame_ms:values[0],field_samples:values[1],phenomenon_scene:anchor.sceneId,volume_cached:false};
      if(staticVolume){
        if(!cached||cached.colors.length!==n*7)cached={colors:new Uint8Array(n*7),coverage:new Uint8Array(n)};
        cached.key=key;cached.colors.set(module.HEAPU8.subarray(output,output+n*7));cached.coverage.set(module.HEAPU8.subarray(mask,mask+n));
        volumeFrames.set(anchor.sceneId,cached);colors=cached.colors;coverage=cached.coverage;
      }
    }
  }else{
    // The extended table follows the same tiny disk all the way to 8192 Rs.
    // UI enforces 6.05 Rs; tolerate only roundoff at that known boundary.
    if(distance<6-1e-4)throw new Error('Black-hole camera must remain outside 6.05 Schwarzschild radii');
    const position=local;
    setEnvironment(module,resource.environmentPointer,resource.parametersPointer,s.position,true);
    module._cu_set_overlay(surveyMode===2?1:0);
    module._cu_set_lens_strength(blend);
    const far=anchor.farAppearance;
    // Retain unresolved emission until the disk actually covers characters,
    // independently of when background lensing finishes its spatial handoff.
    const diskCells=16/distance/(2*Math.tan((s.fov??55)*Math.PI/360)/rows);
    const resolved=Math.max(0,Math.min(1,(diskCells-.2)/.6));
    module._cu_set_point_source((far?.flux??0)*(1-resolved*resolved*(3-2*resolved)),...(far?.color??[1,.72,.32]));
    if(module._cu_frame(cols,rows,...position,s.yaw ?? 0,s.pitch ?? 0,s.fov ?? 55,s.time ?? 0,s.exposure ?? 1,1,0))throw new Error(module.UTF8ToString(module._cu_error()));
    output=module._cu_output();mask=module._cu_mask();objectMask=module._cu_object_mask();const values=module.HEAPF32.subarray(module._cu_stats()>>2,(module._cu_stats()>>2)+12);
    details={local_frame_ms:values[0],lookup_ms:values[1],disk_ms:values[2],shadow_cells:values[4],disk_cells:values[5],cached_geometry:!!values[6],camera_radius:values[7],lensed_environment:!!values[8],environment_cells:values[9],captured_cells:values[10],lens_strength:values[11]};
  }
  if(overlayCapacity<n*9){
    const replacement=engine._malloc(n*9);if(!replacement)throw new Error('Could not allocate character composition buffers');
    if(overlayPointer)engine._free(overlayPointer);overlayPointer=replacement;overlayCapacity=n*9;
  }
  engine.HEAPU8.set(colors||module.HEAPU8.subarray(output,output+n*7),overlayPointer);
  engine.HEAPU8.set(coverage||module.HEAPU8.subarray(mask,mask+n),overlayPointer+n*7);
  if(objectMask)engine.HEAPU8.set(module.HEAPU8.subarray(objectMask,objectMask+n),overlayPointer+n*8);
  const priorCells=engine.HEAPF32[(engine._atlas_stats()>>2)+22];
  check(engine._atlas_overlay_layers(overlayPointer,overlayPointer+n*7,objectMask?overlayPointer+n*8:0,anchor.sceneKind==='blackhole'?1:blend,anchor.index));
  const primaryCells=engine.HEAPF32[(engine._atlas_stats()>>2)+22]-priorCells;
  return {...details,primary_cells:primaryCells,active_scene:anchor.sceneKind,active_destination:anchor.index,local_distance_model:distance,blend};
}
async function textureAsset(texture, channels) {
  if (!textureAssets.has(texture.url)) textureAssets.set(texture.url, fetchBytes(texture.url).then(bytes => ({pointer:allocate(bytes),bytes:bytes.byteLength})));
  const asset = await textureAssets.get(texture.url);
  if (asset.bytes !== (texture.bytes ?? texture.width * (texture.height ?? 1) * channels)) throw new Error(`Chart dimensions mismatch: ${texture.url}`);
  return asset.pointer;
}
async function prepareBody(body) {
  const [pixels, ring, emission] = await Promise.all([textureAsset(body.texture,3),body.ring?.texture?textureAsset(body.ring.texture,4):0,body.emission?.texture?textureAsset(body.emission.texture,1):0]);
  return {body,pixels,ring,emission};
}
function registerBody({body,pixels,ring,emission}) {
  const parameters = new Float64Array(21), atmosphere=body.atmosphere || {};
  parameters.set(body.position,0); parameters[3]=body.radiusPc ?? body.radius_pc;
  parameters.set(body.hostPosition || [0,0,0],4); parameters.set(body.axis || [0,0,1],7);
  parameters[10]=body.primeMeridian ?? 0; parameters[11]=body.rotationRate ?? .012;
  parameters[12]=body.ring?.innerRadius ?? 0; parameters[13]=body.ring?.outerRadius ?? 0;
  parameters[14]=body.comet?.tailLengthRadii ?? 0;
  parameters[15]=({rocky:0,gas:1,ice:2,lava:3,water:4,comet:5})[body.appearanceKind] ?? 0;
  parameters[16]=atmosphere.strength ?? 0; parameters.set(atmosphere.color || [.08,.4,1],17);
  parameters[20]=body.parentStarIndex ?? body.hostStarIndex ?? 0;
  const pointer=engine._malloc(parameters.byteLength);
  engine.HEAPU8.set(new Uint8Array(parameters.buffer),pointer);
  try { check(engine._atlas_add_body(body.index,pointer,pixels,body.texture.width,body.texture.height,ring,body.ring?.texture?.width ?? 0)); }
  finally { engine._free(pointer); }
  if(emission){const t=body.emission.texture;check(engine._atlas_set_body_emission(body.index,emission,t.width,t.height,t.bytes,body.emission.strength??1));}
  if(body.shape)check(engine._atlas_set_body_shape(body.index,...body.shape));
  if(body.comet)check(engine._atlas_set_body_comet(body.index,body.comet.tailLengthRadii ?? 50,body.comet.comaRadiusRadii ?? 3));
}
function registerBelt(belt) {
  const au=1/206264.80624709636, p=new Float64Array(16);
  p.set(belt.position || [0,0,0],0);p.set(belt.axis || [0,0,1],3);
  p[6]=belt.innerRadiusPc ?? belt.innerRadiusAU*au;p[7]=belt.outerRadiusPc ?? belt.outerRadiusAU*au;
  p[8]=belt.halfThicknessPc ?? (belt.thicknessAU ?? (belt.outerRadiusAU-belt.innerRadiusAU)*.035)*au;
  p[9]=belt.seed ?? 12345;p[10]=belt.count ?? 1400;p[11]=belt.hostStarIndex ?? 0;
  p.set(belt.color || [.72,.61,.43],12);p[15]=belt.brightness ?? 1;
  const pointer=engine._malloc(p.byteLength);engine.HEAPU8.set(new Uint8Array(p.buffer),pointer);
  try {check(engine._atlas_add_belt(pointer));}finally{engine._free(pointer);}
}
async function initialize() {
  const surveyResponse=await fetch('/artifacts/gaia.json');
  if(!surveyResponse.ok&&surveyResponse.status!==404)throw new Error('Could not load Gaia metadata');
  const available=surveyResponse.ok;
  const [module, catalog, solarResponse, systemsResponse, galaxyBytes, galaxyResponse, destinationsResponse, summaryBytes, observationBytes] = await Promise.all([
    createAtlas(), fetchBytes(available?'/artifacts/gaia-atlas.bin':'/artifacts/atlas.bin'), fetch('/artifacts/solar.json'),fetch('/artifacts/systems.json'),fetchBytes('/artifacts/galaxy-stars.bin'),fetch('/artifacts/galaxy-stars.json'),fetch('/artifacts/phenomena-destinations.json'),available?fetchBytes('/artifacts/gaia-light.bin'):null,available?fetchBytes('/artifacts/gaia-observations.bin'):null
  ]);
  engine = module;
  catalogPointer = allocate(catalog);
  starOffset = new DataView(catalog.buffer, catalog.byteOffset).getUint32(16, true);
  check(engine._atlas_init(catalogPointer, catalog.byteLength));
  if(available){
    surveyInfo=await surveyResponse.json();surveyObservations=new Float32Array(observationBytes.buffer,observationBytes.byteOffset,observationBytes.byteLength/4);
    if(summaryBytes.length!==surveyInfo.nodeCount*64||surveyObservations.length!==(surveyInfo.totalCount-surveyInfo.baseCount)*4)throw new Error('Inconsistent Gaia catalog artifacts');
    surveyPointer=allocate(summaryBytes);check(engine._atlas_set_survey(surveyPointer,surveyInfo.nodeCount,1,1));
  }
  if(!galaxyResponse.ok)throw new Error(`galaxy-stars.json: HTTP ${galaxyResponse.status}`);
  const galaxy=await galaxyResponse.json();galacticCount=galaxy.count;
  if(!Number.isInteger(galacticCount)||galacticCount<1||galaxyBytes.length!==galacticCount*32)throw new Error('Invalid spatial Milky Way dimensions');
  galacticBytes=galaxyBytes;galacticPointer=allocate(galacticBytes);environmentParameters=engine._malloc(128);
  if(!environmentParameters)throw new Error('Could not allocate environment parameters');
  if(!destinationsResponse.ok)throw new Error(`phenomena-destinations.json: HTTP ${destinationsResponse.status}`);
  const destinations=await destinationsResponse.json();
  for(const destination of destinations.destinations||[]){
    anchorRecord(destination);
    const far=destination.farAppearance;
    if(far)check(engine._atlas_add_destination(destination.index,destination.linkedCatalogIndex??-1,...destination.position,...far.color,far.flux));
  }
  const core=(destinations.destinations||[]).find(destination=>destination.sceneKind==='blackhole');if(core)galacticCenter=core.position;
  if (!solarResponse.ok) throw new Error(`solar.json: HTTP ${solarResponse.status}`);
  const solar = await solarResponse.json(), earth = solar.earth;
  let bodies, fixedBelts=[];
  if (systemsResponse.ok) {const systems=await systemsResponse.json();bodies=systems.bodies;fixedBelts=systems.belts || [];}
  else if(systemsResponse.status===404) bodies=[{...earth,index:-2,hostPosition:[0,0,0],appearanceKind:'water',atmosphere:{strength:1,color:[.08,.4,1]}}];
  else throw new Error(`systems.json: HTTP ${systemsResponse.status}`);
  if (!Array.isArray(bodies)) throw new Error('Planetary body registry is malformed');
  // The small shared authored palette is part of bootstrap, so generating a
  // previously unvisited system needs no network after the ready message.
  const generatedCharts=['lava','desert','ocean','temperate-rock','carbon','jupiter','hot-jupiter','neptune','ice-rock','violet'];
  const preloads=generatedCharts.map(key=>textureAsset({url:`/artifacts/surface-${key}.bin`,width:512,height:256},3));
  preloads.push(textureAsset({url:'/artifacts/rings-saturn.bin',width:1024},4));
  const [prepared]=await Promise.all([Promise.all(bodies.map(prepareBody)),Promise.all(preloads)]);
  prepared.forEach(registerBody);
  fixedBelts.forEach(registerBelt);
  const [orientationResponse,orientationBytes]=await Promise.all([fetch('/artifacts/earth-orientation.json'),fetchBytes('/artifacts/earth-orientation.bin')]);
  if(!orientationResponse.ok)throw Error('Could not load Earth orientation metadata');
  earthOrientationMetadata=await orientationResponse.json();
  if(orientationBytes.byteLength!==earthOrientationMetadata.count*24)throw Error('Earth orientation chart dimensions mismatch');
  earthOrientationChart=new Float32Array(orientationBytes.buffer,orientationBytes.byteOffset,orientationBytes.byteLength/4);
  return {catalogCount: new DataView(catalog.buffer, catalog.byteOffset).getUint32(8, true), solar,bodies,fixedBodies:bodies,fixedBelts,bodyByIndex:new Map(bodies.map(body=>[body.index,body])),systemRequest:0};
}
function starInfo(index, info) {
  if (index <= -2) { const body=info.bodyByIndex.get(index)||localAnchors.get(index);return body?{...body,radius_pc:body.radiusPc ?? body.radius_pc}:null; }
  if (!Number.isInteger(index) || index < 0 || index >= info.catalogCount) return null;
  const record = new DataView(engine.HEAPU8.buffer, catalogPointer + starOffset + index * 64, 64);
  const id = record.getUint32(52,true), radius = record.getFloat32(28,true), flags=record.getUint32(56,true);
  if(flags&32){
    const sourceId=((BigInt(record.getUint32(60,true))<<32n)|BigInt(id)).toString(),o=(index-surveyInfo.baseCount)*4;
    const reconstructed=Boolean(flags&64);
    return {index,id:`gaia-${sourceId}`,gaia_id:sourceId,name:`Gaia DR3 ${sourceId}`,flags,
      position:[0,8,16].map(offset=>record.getFloat64(offset,true)),radius_pc:radius,radiusPc:radius,
      absmag:record.getFloat32(24,true),luminosity:record.getFloat32(44,true),temperature:record.getFloat32(48,true),
      parallax:surveyObservations[o],parallaxError:surveyObservations[o+1],photG:surveyObservations[o+2],bpRp:surveyObservations[o+3],
      dataClass:reconstructed?'Observed sky · reconstructed depth':'Gaia DR3 · inverse parallax',
      description:reconstructed?'LMC candidate: measured sky position and G-band light; individual depth is reconstructed in an inclined disk. Surface and any generated planets are imagined.':'Measured Gaia DR3 astrometry and photometry. Distance uses high-S/N inverse parallax; surface and any generated planets are imagined.'};
  }
  return {index,name:index===0?'Sun':`HYG ${id}`,position:[0,8,16].map(offset=>record.getFloat64(offset,true)),
    radius_pc:radius,radiusPc:radius,absmag:record.getFloat32(24,true),
    luminosity:record.getFloat32(44,true),temperature:record.getFloat32(48,true),
    id,hyg_id:id,flags:record.getUint32(56,true)};
}
self.onmessage = async ({data}) => {
  const id = data.id;
  try {
    if (!ready) ready = initialize();
    const info = await ready;
    if (data.type === 'init') {
      self.postMessage({type:'ready', id, surveyAvailable:!!surveyInfo, catalogCount:info.catalogCount,bodies:info.bodies,
        stats:{backend:'catalog-wasm',catalog_stars:info.catalogCount,planetary_bodies:info.bodies.length,heap_bytes:engine.HEAPU8.byteLength}});
    } else if (data.type === 'frame') {
      const started = performance.now(), s = data.state || data;
      const cols = s.cols ?? 220, rows = s.rows ?? 94;
      const selected=anchorRecord(s.selectedDestination);
      if(selected&&!((selected.sceneKind==='phenomenon'&&phenomenonEngine)||(selected.sceneKind==='blackhole'&&blackholeEngine)))
        loadLocalEngine(selected.sceneKind).catch(()=>{});
      const active=nearestLocal(s.position,selected?.index);
      // Free flight can discover a closeup without selecting it first. Its
      // persistent unresolved source stays visible until preparation finishes.
      for(const anchor of localAnchors.values())if(Math.hypot(...s.position.map((v,i)=>(v-anchor.position[i])/anchor.radiusPc))<(anchor.sceneKind==='blackhole'?16384:200))loadLocalEngine(anchor.sceneKind).catch(()=>{});
      if(active)lastActiveDestination=active.anchor.index;
      check(engine._atlas_set_local_destination(active?.anchor.index??-1,active?.blend??0));
      engine._atlas_hide_star(active&&active.blend>.9&&Number.isInteger(active.anchor.linkedCatalogIndex)?active.anchor.linkedCatalogIndex:-1);
      surveyMode=s.surveyMode??1;
      check(engine._atlas_set_survey(surveyPointer,surveyInfo?.nodeCount??0,surveyMode,s.surveyGain??1));
      setEnvironment(engine,galacticPointer,environmentParameters,s.position);
      check(engine._atlas_set_camera_roll(s.roll??0));
      let orientation=null;
      if(Number.isFinite(s.earthUtcMs)){
        orientation=earthOrientation(s.earthUtcMs,earthOrientationMetadata,earthOrientationChart);
        check(engine._atlas_set_body_orientation(-2,...orientation.axis,orientation.primeMeridian));
      }
      check(engine._atlas_frame(cols, rows, ...s.position, s.yaw ?? 0, s.pitch ?? 0, s.fov ?? 55,
        s.time ?? 0, s.exposure ?? 1, s.selectedIndex ?? -1));
      const contextLayers=[],cachedContextLayers=[];
      // The Crab pulsar lives inside the remnant. Keep that volume around the
      // freely moving camera even when the compact pulsar is the selected object.
      if(active?.anchor.sceneId===4&&phenomenonEngine){
        const remnant=[...localAnchors.values()].find(anchor=>anchor.sceneId===2);
        if(remnant){const local=s.position.map((value,i)=>(value-remnant.position[i])/remnant.radiusPc),distance=Math.hypot(...local);
          if(distance<80){const t=Math.max(0,Math.min(1,(80-distance)/45));
            const context=compositeLocal({anchor:remnant,resource:phenomenonEngine,local,distance,blend:t*t*(3-2*t)},s,cols,rows);contextLayers.push(remnant.index);if(context.volume_cached)cachedContextLayers.push(remnant.index);}}
      }
      let localStats={active_scene:'atlas',active_destination:null,blend:0};
      if(active){try{localStats=compositeLocal(active,s,cols,rows);}catch(error){localStats.local_error=String(error.message||error);localStats.local_error_stack=String(error.stack||error);}}
      const count = cols * rows, output = engine._atlas_output();
      const buffer = engine.HEAPU8.slice(output, output + count * 7).buffer;
      const values = engine.HEAPF32.slice(engine._atlas_stats() >> 2, (engine._atlas_stats() >> 2) + 32);
      const labelCount = engine._atlas_label_count(), labelBase = engine._atlas_labels() >> 2, labels = [];
      const labelIndices=new Int32Array(engine.HEAPU8.buffer,engine._atlas_label_indices(),labelCount);
      for (let i=0;i<labelCount;i++) {
        const p=labelBase+i*4,x=engine.HEAPF32[p+1],y=engine.HEAPF32[p+2];
        if(active&&localStats.active_scene!=='atlas'&&x>=0&&x<1&&y>=0&&y<1&&
           engine.HEAPU8[overlayPointer+count*7+Math.floor(y*rows)*cols+Math.floor(x*cols)]*(active.anchor.sceneKind==='blackhole'?1:active.blend)>128)continue;
        labels.push({index:labelIndices[i],x,y,magnitude:engine.HEAPF32[p+3]});
      }
      const stats={survey_mode:surveyMode,survey_nodes:values[28],survey_groups:values[29],survey_individuals:values[30],survey_represented:values[31],backend:'catalog-wasm',frame_ms:values[0],geometry_ms:values[1],surface_ms:values[2],
        stars_tested:values[3],visible_stars:values[4],catalog_stars:values[5],resolved_bodies:values[6],
        surface_cells:values[7],glow_ms:values[8],hierarchy_nodes:values[9],projected_stars:values[10],
        ring_cells:values[12],planetary_bodies:values[13],visible_planets:values[14],
        persistent_destinations:values[15],
        belt_particles:values[16],visible_belt_particles:values[17],belt_ms:values[18],
        comet_cells:values[20],active_stellar_flares:values[21],
        local_cells:values[22],composited_cells:values[23],galactic_ms:values[24],galactic_cells:values[25],context_layers:contextLayers,cached_context_layers:cachedContextLayers,
        ...localStats,frame_ms:performance.now()-started,worker_ms:performance.now()-started,cols,rows,
        heap_bytes:engine.HEAPU8.byteLength+(phenomenonEngine?.module.HEAPU8.byteLength||0)+(blackholeEngine?.module.HEAPU8.byteLength||0)};
      self.postMessage({type:'frame',id,cols,rows,buffer,stats,labels,earthOrientation:orientation},[buffer]);
    } else if (data.type === 'pick') {
      const index=engine._atlas_pick(data.x,data.y);
      const star=starInfo(index,info);
      self.postMessage({type:'pick',id,index,star,body:index<=-2?star:null});
    } else if (data.type === 'star') {
      self.postMessage({type:'star',id,index:data.index,star:starInfo(data.index,info)});
    } else if (data.type === 'set-system') {
      const bodies=data.bodies || [];
      if(!Array.isArray(bodies)||bodies.length+info.fixedBodies.length>2048||
         bodies.some(body=>!Number.isInteger(body.index)||body.index>-100000)||new Set(bodies.map(body=>body.index)).size!==bodies.length)
        throw new Error('Generated systems require unique indices <= -100000 and at most 2048 registered bodies');
      const request=++info.systemRequest;
      const prepared=await Promise.all(bodies.map(prepareBody));
      if(request!==info.systemRequest){self.postMessage({type:'system-ready',id,bodies,superseded:true});return;}
      // All network waits finish before the synchronous registry swap. Frames
      // therefore see either the previous complete system or its replacement.
      check(engine._atlas_clear_generated());prepared.forEach(registerBody);
      check(engine._atlas_clear_belts());
      const belts=[...info.fixedBelts,...(data.belts || [])],uniqueBelts=new Map(belts.map(belt=>[belt.id || JSON.stringify(belt),belt]));
      for(const belt of uniqueBelts.values())registerBelt(belt);
      info.bodies=[...info.fixedBodies,...bodies];info.bodyByIndex=new Map(info.bodies.map(body=>[body.index,body]));
      self.postMessage({type:'system-ready',id,bodies});
    } else if(data.type==='prepare-destination'){
      const destination=anchorRecord(data.destination);
      if(!destination)throw new Error('The selected destination has no local phenomenon renderer');
      await loadLocalEngine(destination.sceneKind);
      self.postMessage({type:'destination-ready',id,destinationIndex:destination.index});
    }
  } catch (error) {
    self.postMessage({type:'error',id,scope:data.type==='prepare-destination'?'destination':undefined,
      destinationIndex:data.destination?.index,error:String(error?.message || error),stack:String(error?.stack || error)});
  }
};
