import {readFile} from 'node:fs/promises';
import {Engine} from './engine.mjs';
import {generateSystem} from '../web/system-generator.js';
import {tourStops} from './tour.mjs';
import * as N from './navigation.mjs';
const {add,sub,scale,length,normalize,dot,cross,clamp,smooth,radius,isPhenomenon,bearing,forward,basis}=N;
const read=name=>readFile(new URL(`../artifacts/${name}.json`,import.meta.url),'utf8').then(JSON.parse);
const closeWorld=r=>r.index< -1&&!isPhenomenon(r)&&!r.ring&&r.kind!=='comet'&&!r.viewDistanceRadii&&radius(r)*N.PC_KM<=3000;
const GALACTIC_NORTH=[-.8676661490190047,-.1980763734312015,.4559837761750669];
export class Universe {
 constructor(engine=new Engine()){
  this.engine=engine;this.state={cols:120,rows:42,position:[0,0,0],yaw:0,pitch:0,roll:0,fov:50,time:0,earthUtcMs:Date.now(),exposure:1,surveyMode:1,selectedIndex:-2};
  this.byId=new Map();this.byIndex=new Map();this.generated=new Map();this.registration=Promise.resolve();this.registered='';this.intent=0;this.mode='orbit';this.paused=false;this.motionHeld=false;this.clockOffset=0;this.clockHeld=false;this.ready=false;this.notice='Loading the compiled universe...';this.tour=null;this.speed=1e-8;
 }
 add(record){
  const r={...this.byIndex.get(record.index),...record};r.search=[r.name,r.id,r.kind,r.parentId,...(r.aliases||[])].join(' ').toLowerCase();
  this.byIndex.set(r.index,r);this.byId.set(String(r.id),r);if(r.index>=0){this.byId.set(`star-${r.index}`,r);this.byId.set(`hyg-${r.id}`,r);}return r;
 }
 async init(){
  const [catalog,systems,phenomena,ready]=await Promise.all([read('atlas-search'),read('systems'),read('phenomena-destinations'),this.engine.request({type:'init'})]);
  this.systems=systems.systems;this.stars=catalog.stars.map(r=>this.add(r));
  for(const sys of this.systems)if(sys.host)this.add({...sys.host,index:sys.hostStarIndex});
  for(const r of systems.stellarDestinations)this.add(r);
  this.fixed=ready.bodies.map(r=>this.add(r));this.phenomena=phenomena.destinations.map(r=>this.add(r));
  this.sun=this.byIndex.get(0);this.byId.set('sun',this.sun);this.earth=this.byId.get('earth');this.selected=this.earth;
  this.ready=true;this.notice='';this.home();return this;
 }
 resolve(value){
  if(typeof value==='object')return value;
  const direct=this.byId.get(String(value));if(direct)return direct;
  const q=String(value).toLowerCase();return [...this.byIndex.values()].find(r=>r.name?.toLowerCase()===q||r.aliases?.some(a=>a.toLowerCase()===q));
 }
 search(query='',kind='all'){
  const q=query.trim().toLowerCase(),rows=[...this.byIndex.values()].filter(r=>kind==='phenomena'?isPhenomenon(r):kind==='worlds'?r.index< -1&&!isPhenomenon(r):true);
  if(q)return rows.filter(r=>r.search.includes(q)).sort((a,b)=>(b.name?.toLowerCase()===q)-(a.name?.toLowerCase()===q)||((a.name?.toLowerCase().indexOf(q)??999)-(b.name?.toLowerCase().indexOf(q)??999))||radius(b)-radius(a)).slice(0,200);
  const featured=['earth','moon','mars','saturn','jupiter','pluto','ceres','Sirius','Proxima Centauri','vfts-352','betelgeuse-study','crab-pulsar','orion-nebula','sagittarius-a'].map(id=>this.resolve(id)).filter(Boolean);
  return [...new Map([...featured.filter(r=>rows.includes(r)),...rows.filter(r=>r.index<0||r.mag<2)].map(r=>[r.index,r])).values()].slice(0,200);
 }
 host(record=this.selected){return record.index>=0?record:this.byIndex.get(record.parentStarIndex)||this.sun;}
 children(record){return [...this.byIndex.values()].filter(r=>r.index< -1&&!isPhenomenon(r)&&String(r.parentId??r.parentBodyId)===String(record.id));}
 async system(star=this.host()){
  if(star.index===0)return this.systems.find(s=>s.hostStarIndex===0);
  if(!this.generated.has(star.index)){
   const system=generateSystem(star,this.fixed);this.generated.set(star.index,system);for(const r of system.bodies)this.add(r);
   // Keep world definitions bounded; seeds reproduce evicted systems on demand.
   const protectedHosts=new Set([star.index,this.host().index,this.travel?.destination.parentStarIndex]);
   for(const [id,old]of this.generated){if(this.generated.size<=12)break;if(protectedHosts.has(id))continue;this.generated.delete(id);for(const r of old.bodies)if(r.generated){this.byIndex.delete(r.index);this.byId.delete(r.id);}}
  }
  return this.generated.get(star.index);
 }
 async register(record){
  const hosts=new Set([this.host().index,this.host(record).index]);
  const systems=[...hosts].map(id=>this.generated.get(id)).filter(Boolean),signature=systems.map(s=>s.hostStarIndex).sort((a,b)=>a-b).join(',');
  this.registration=this.registration.catch(()=>{}).then(async()=>{if(this.registered===signature)return;await this.engine.request({type:'set-system',bodies:systems.flatMap(s=>s.bodies.filter(b=>b.generated)),belts:systems.flatMap(s=>s.belts)});this.registered=signature;});
  await this.registration;
 }
 align(position){Object.assign(this.state,bearing(sub(position,this.state.position)));}
 orbitFromCamera(){const d=sub(this.state.position,this.selected.position),r=length(d),distance=Math.max(N.minimumOrbitRadius(this.selected),r);this.orbit={radius:distance,target:distance,offset:r>1e-30?normalize(d):scale(forward(this.state),-1)};if(this.selected.id==='moon'){const axis=normalize(cross(this.orbit.offset,normalize(sub(this.sun.position,this.selected.position))));if(length(axis)>.1)this.orbit.cruiseAxis=axis;}}
 galaxyRevealDirection(){const center=this.byId.get('sagittarius-a');return center&&length(this.selected.position)<100?normalize(add(scale(GALACTIC_NORTH,.82),scale(normalize(sub(this.selected.position,center.position)),.57))):null;}
 syncOrbit(){const o=this.orbit;this.state.position=add(this.selected.position,scale(o.offset,o.radius));let target=this.selected.position;if(o.galaxyFocus){const center=this.byId.get('sagittarius-a'),blend=smooth(clamp((Math.log10(Math.max(o.radius,1))-3)/1.25,0,1));if(center)target=add(scale(target,1-blend),scale(center.position,blend));}this.align(target);}
 home(){this.cancel();this.selected=this.earth;this.state.position=this.endpoint(this.earth);this.state.fov=50;this.state.roll=0;this.mode='orbit';this.align(this.earth.position);this.orbitFromCamera();this.speed=radius(this.earth)*3;}
 endpoint(record,options={}){
  const r=radius(record),stellar=record.index>=0||record.stellarSurface;
  const aspect=this.state.cols/(this.state.rows*1.8),fit=Math.max(1,.85/aspect);
  let distance=record.kind==='region'?r*(record.viewDistanceRadii||3.5):stellar?isPhenomenon(record)?r*record.viewDistanceRadii:Math.max(r*1.18,5*N.SOLAR_RADIUS_PC*Math.pow(Math.max(r/N.SOLAR_RADIUS_PC,.03),.35)):(record.id==='moon'?2400/N.PC_KM:r*(record.viewDistanceRadii||(record.ring?record.ring.outerRadius*3.2:record.id==='earth'?3.4:closeWorld(record)?2.65:3.5)))*fit;
  if(options.inspect&&stellar)distance=r*(record.overviewDistanceRadii||4.8)*fit;
  let direction;
  if(isPhenomenon(record))direction=normalize(record.viewDirection||[.25,.18,.95]);
  else if(record.index< -1){
   const light=normalize(sub(record.hostPosition||this.sun.position,record.position)),axis=normalize(record.axis||[0,0,1]);let tangent=normalize(cross(axis,light));if(length(tangent)<.1)tangent=normalize(cross([0,1,0],light));
   if(record.ring){const plane=normalize(sub(light,scale(axis,dot(light,axis)))),pole=dot(light,axis)<0?scale(axis,-1):axis;direction=normalize(add(scale(plane,Math.cos(.48)),scale(pole,Math.sin(.48))));}
   else if(options.view==='night')direction=normalize(add(add(scale(light,-.92),scale(tangent,.39)),scale(axis,.18)));
   else if(record.id==='moon'&&options.view!=='limb'){
    const earthward=normalize(sub(this.earth.position,record.position)),across=normalize(sub(earthward,scale(light,dot(earthward,light))));
    direction=normalize(add(length(across)>.1?across:tangent,scale(light,.18)));
   }
   else direction=normalize(add(scale(light,options.view==='limb'?.28:.92),scale(tangent,options.view==='limb'?.96:.39)));
   if(record.kind==='comet'){if(options.inspect)distance=r*3.5*fit;else direction=normalize(add(scale(light,.25),scale(tangent,.97)));}
  }else direction=normalize(sub(this.state.position,record.position));
  if(length(direction)<.1)direction=[0,.2,1];
  return add(record.position,scale(direction,Math.max(distance,N.minimumOrbitRadius(record))));
 }
 arrivalDescent(record,endpoint,start,obstacles,options){
  if(!closeWorld(record)||options.instant||options.view==='system')return null;
  const r=radius(record),final=sub(endpoint,record.position),endDistance=length(final),endDirection=normalize(final);
  const light=normalize(sub(record.hostPosition||this.sun.position,record.position));
  const startDirection=normalize(sub(endDirection,scale(light,record.id==='moon'?.22:.12)));
  const startDistance=Math.max(r*5.5,endDistance*1.65);
  if(length(sub(start,record.position))<startDistance*1.15)return null;
  const stage=add(record.position,scale(startDirection,startDistance));
  if(obstacles.some(body=>body.index!==record.index&&N.navigationRadius(body)>0&&N.segmentDistance(stage,endpoint,body.position).distance<N.navigationRadius(body)*1.08))return null;
  return {stage,startDirection,startDistance,endDirection,endDistance,seconds:record.id==='moon'?4.5:3};
 }
 obstacles(record){return [...this.byIndex.values()].filter(r=>r.index< -1&&!isPhenomenon(r)||r.sceneKind==='blackhole'||r===this.selected||r===record||r===this.sun);}
 cancel(){this.intent++;this.preparing=null;this.tour=null;this.travel=null;if(this.map){this.map=null;this.mode='free';}this.notice='';}
 async fly(value,options={}){
  let record=this.resolve(value);if(!record)throw Error(`Unknown destination: ${value}`);
  const token=++this.intent;if(!options.tour)this.tour=null;this.preparing=record.name;this.travel=null;this.notice='';
  try{
   if(isPhenomenon(record))await this.engine.request({type:'prepare-destination',destination:record});
   if(record.generated){await this.system(this.host(record));record=this.byIndex.get(record.index)||record;}
   await this.register(record);if(token!==this.intent)return;
   this.map=null;const start=[...this.state.position],endpoint=this.endpoint(record,options),obstacles=this.obstacles(record);
   const source=obstacles.filter(r=>length(sub(start,r.position))/radius(r)<50).sort((a,b)=>length(sub(start,a.position))/radius(a)-length(sub(start,b.position))/radius(b))[0];
   const sameTarget=source?.index===record.index,descent=this.arrivalDescent(record,endpoint,start,obstacles,options);let points=[start];const gap=length(sub(endpoint,start));
   if(source&&!sameTarget){const offset=sub(start,source.position),d=length(offset),pull=Math.min(gap*.12,Math.max(radius(source)*5,d*.85));if(pull>radius(source)*.1)points.push(add(source.position,scale(normalize(offset),d+pull)));}
   if(!sameTarget)points.push(...N.phenomenonWaypoints(points.at(-1),endpoint,record));points.push(descent?.stage||endpoint);
   const route=N.safeWaypoints(points,obstacles),baseDuration=options.instant?0:options.duration??(isPhenomenon(record)&&!sameTarget?18:N.travelDuration(route.length,sameTarget)),duration=descent?Math.max(baseDuration,options.tour?11:8.5):baseDuration,leg=route.length*(route.length/N.AU_PC<.02?.18:.035);
   this.selected=record;this.mode='free';this.travel={endpoint,route,duration,elapsed:0,destination:record,source,sameTarget,leg,nearStart:Math.max(source?radius(source)*1.5:route.length*.002,1e-13),nearEnd:Math.max(radius(record)*2,1e-13),closeApproach:N.localApproach(record,route,duration-(descent?.seconds||0),sameTarget,leg),from:forward(this.state),baseFov:this.state.fov,targetFov:record.viewFov||50,descent};
   if(descent)this.travel.transit={...this.travel,duration:duration-descent.seconds,elapsed:0,descent:null};
   if(!duration||route.length<rSafe(record)){this.state.position=endpoint;this.state.fov=record.viewFov||50;this.align(record.position);this.arrive();}
  }finally{if(token===this.intent)this.preparing=null;}
 }
 arrive(){this.travel=null;this.mode='orbit';this.orbitFromCamera();this.speed=radius(this.selected)*3;}
 resize(cols,rows){const changed=cols!==this.state.cols||rows!==this.state.rows;this.state.cols=cols;this.state.rows=rows;if(changed&&this.map&&!this.map.closing)this.overview(false);}
 pause(){if(this.tour){this.tour.paused=!this.tour.paused;return;}this.paused=!this.paused;}
 brake(){
  if(this.tour||this.travel)this.cancel();
  if(this.mode==='orbit'){this.motionHeld=!this.motionHeld;if(this.motionHeld)this.orbit.target=this.orbit.radius;}
  else if(this.selected.index< -1&&!isPhenomenon(this.selected)&&length(sub(this.state.position,this.selected.position))<radius(this.selected)*30){this.mode='orbit';this.orbitFromCamera();this.motionHeld=false;}
  else this.notice='Holding position. Select a nearby world to settle into orbit.';
 }
 tick(dt){
  dt=clamp(dt,0,.12);if(!this.ready)return;
  const held=this.paused||this.tour?.paused,now=Date.now();
  if(!held){if(this.clockHeld)this.clockOffset=now-this.state.earthUtcMs;this.state.time+=dt;this.state.earthUtcMs=now-this.clockOffset;}this.clockHeld=!!held;
  // The map owns the camera while open, including after its maneuver settles.
  if(this.map){if(this.map.move)this.updateMap(dt);else this.updateMapZoom(dt);return;}
  if(this.tour?.paused)return;
  if(this.travel){
   const travel=this.travel,descent=travel.descent,transitDuration=travel.duration-(descent?.seconds||0);
   if(descent&&travel.elapsed+dt>=transitDuration){
    travel.elapsed=Math.min(travel.duration,travel.elapsed+dt);
    const ease=smooth(clamp((travel.elapsed-transitDuration)/descent.seconds,0,1));
    const direction=normalize(add(scale(descent.startDirection,1-ease),scale(descent.endDirection,ease)));
    const distance=descent.startDistance*Math.exp(Math.log(descent.endDistance/descent.startDistance)*ease);
    this.state.position=add(travel.destination.position,scale(direction,distance));this.align(travel.destination.position);
    this.state.fov=travel.baseFov+(travel.targetFov-travel.baseFov)*smooth(travel.elapsed/travel.duration);
    if(travel.elapsed>=travel.duration){this.state.position=[...travel.endpoint];this.arrive();}
   }else{
    const s=N.sampleFlight(travel.transit||travel,dt);if(descent)travel.elapsed=travel.transit.elapsed;
    this.state.position=s.position;this.state.fov=s.fov;const aim=sub(travel.destination.position,s.position);
    Object.assign(this.state,bearing(s.t<.22?N.blendDirection(travel.from,aim,smooth(s.t/.22)):aim));
    if(!descent&&s.t>=1){this.state.position=[...travel.endpoint];this.arrive();}
   }
  }
  else if(this.mode==='orbit'&&this.orbit){
   const o=this.orbit,ratio=o.target/o.radius;
   if(Math.abs(ratio-1)>1e-6)o.radius*=Math.exp(Math.log(ratio)*(1-Math.exp(-dt*9)));
   if(!this.motionHeld&&!this.tour&&o.radius<1&&this.selected.index< -1&&!isPhenomenon(this.selected)){
    const axis=o.cruiseAxis||normalize(this.selected.axis||[0,1,0]),angle=clamp(.07*Math.pow(3.5*radius(this.selected)/Math.max(o.radius,1e-25),.35),.008,.09)*dt,v=o.offset;
    o.offset=normalize(add(add(scale(v,Math.cos(angle)),scale(cross(axis,v),Math.sin(angle))),scale(axis,dot(axis,v)*(1-Math.cos(angle)))));
   }
   if(o.galaxyReveal){
    const desired=this.galaxyRevealDirection(),progress=smooth(clamp((Math.log10(Math.max(o.radius,1))-3)/1.35,0,1));
    if(desired&&progress>0){
     const v=o.offset,separation=Math.acos(clamp(dot(v,desired),-1,1)),step=Math.min(separation,dt*.8*progress);
     let axis=normalize(cross(v,desired));if(length(cross(v,desired))<1e-8)axis=normalize(cross(v,Math.abs(v[1])<.9?[0,1,0]:[1,0,0]));
     o.offset=normalize(add(add(scale(v,Math.cos(step)),scale(cross(axis,v),Math.sin(step))),scale(axis,dot(axis,v)*(1-Math.cos(step)))));
     if(separation<.002&&Math.abs(Math.log(o.target/o.radius))<.01)o.galaxyReveal=false;
    }
   }
   this.syncOrbit();
  }
  if((!this.paused||this.travel)&&!(this.mode==='orbit'&&this.orbit?.manual)){const axis=['earth','moon'].includes(this.selected?.id)?this.selected.axis||[0,0,1]:null,b=basis({...this.state,roll:0}),target=axis?Math.atan2(-dot(axis,b.right),dot(axis,b.up)):0,d=Math.atan2(Math.sin(target-this.state.roll),Math.cos(target-this.state.roll));this.state.roll+=d*(1-Math.exp(-dt*5));}
  if(this.tour&&!this.preparing&&!this.travel){const t=this.tour,stop=tourStops[t.index];if(!t.offset){t.offset=sub(this.state.position,this.selected.position);t.axis=normalize(this.selected.axis||[0,1,0]);t.elapsed=0;}t.elapsed+=dt;const angle=stop.sweep*smooth(clamp(t.elapsed/stop.hold,0,1)),v=t.offset,a=t.axis;this.state.position=add(this.selected.position,add(add(scale(v,Math.cos(angle)),scale(cross(a,v),Math.sin(angle))),scale(a,dot(a,v)*(1-Math.cos(angle)))));this.align(this.selected.position);this.orbitFromCamera();if(t.elapsed>=stop.hold)this.nextTour().catch(e=>{this.notice=e.message;this.tour=null;});}
 }
 look(dx,dy){
  if(this.map||this.preparing)return;this.tour=null;this.travel=null;
  const angle=Math.hypot(dx,dy);if(!angle)return;
  const b=basis(this.state),tangent=normalize(add(scale(b.right,dx),scale(b.up,dy))),orbiting=this.mode==='orbit';
  const direction=orbiting?this.orbit.offset:b.forward,axis=normalize(cross(direction,tangent)),c=Math.cos(angle),s=Math.sin(angle);
  const rotate=v=>add(add(scale(v,c),scale(cross(axis,v),s)),scale(axis,dot(axis,v)*(1-c)));
  if(orbiting){this.orbit.offset=normalize(rotate(direction));this.orbit.manual=true;this.orbit.galaxyReveal=false;this.syncOrbit();}
  else Object.assign(this.state,bearing(rotate(direction)));
  // Transport camera-up through the same rotation. Reconstructing yaw/pitch
  // alone flips the view 180 degrees at a pole and traps repeated up/down input.
  const up=rotate(b.up),flat=basis({...this.state,roll:0});
  this.state.roll=Math.atan2(-dot(up,flat.right),dot(up,flat.up));
 }

 zoom(amount){if(this.map){if(!this.map.closing)this.map.zoomTarget=clamp(this.map.zoomTarget*Math.exp(-amount),.2,this.map.zoomMax);return;}if(this.preparing)return;this.tour=null;this.travel=null;if(this.mode==='orbit'){const vista=this.orbit.target>1000&&this.galaxyRevealDirection(),step=vista ? .45 : 1.25;this.orbit.target=clamp(this.orbit.target*Math.exp(clamp(amount,-step,step)),N.minimumOrbitRadius(this.selected),1e8);if(amount>0&&this.orbit.target>1000&&this.galaxyRevealDirection()){this.orbit.galaxyReveal=true;this.orbit.galaxyFocus=true;}if(amount<0)this.orbit.galaxyReveal=false;}else this.speed=clamp(this.speed*Math.exp(amount),1e-13,1e5);}
 fitMap(){if(this.map&&!this.map.closing)this.map.zoomTarget=1;}
 updateMapZoom(dt){
  const m=this.map;if(m.zoom===m.zoomTarget)return;
  const step=clamp(Math.log(m.zoomTarget/m.zoom)*(1-Math.exp(-dt*12)),-dt*4,dt*4);
  m.zoom=Math.abs(Math.log(m.zoomTarget/m.zoom))<1e-6?m.zoomTarget:m.zoom*Math.exp(step);
  // Scale both the altitude and the framing offset about the system center.
  // The center stays above the dock at every magnification, without a new flight.
  this.state.position=add(m.center.position,scale(m.fitOffset,1/m.zoom));
  Object.assign(this.state,m.fitView);
 }
 free(){if(this.map||this.preparing)return;this.tour=null;this.travel=null;if(this.mode==='orbit')this.mode='free';else{this.mode='orbit';this.orbitFromCamera();this.syncOrbit();}}
 move(x,y,z,amount=.16){if(this.map||this.preparing)return;this.tour=null;this.travel=null;
  if(this.mode==='orbit'){if(x||y)this.look(x*amount*.6,y*amount*.6);if(z)this.zoom(-z*amount);return;}
  const b=basis(this.state),step=scale(add(add(scale(b.right,x),scale(b.up,y)),scale(b.forward,z)),this.speed*amount);const next=add(this.state.position,step);
  for(const r of this.obstacles(this.selected)){const clearance=N.navigationRadius(r)*1.015,hit=N.segmentDistance(this.state.position,next,r.position),departing=hit.t<1e-10&&length(sub(next,r.position))>length(sub(this.state.position,r.position));if(clearance&&hit.distance<clearance&&!departing){this.notice='Surface ahead: turn, strafe, or move away.';return;}}
  this.notice='';this.state.position=next;
 }
 async nextTour(){
  if(!this.tour)this.tour={index:-1,paused:false};const t=this.tour;if(++t.index>=tourStops.length){this.tour=null;this.notice='Grand Tour complete. The universe is yours.';return;}
  t.offset=null;t.paused=false;const stop=tourStops[t.index];await this.fly(stop.id,{view:stop.view,tour:true});
 }
 async startTour(){this.cancel();this.tour={index:-1,paused:false};await this.nextTour();}
 async openMap(record=this.selected){
  if(isPhenomenon(record)){this.notice='This phenomenon has no planetary system map.';return;}
  const token=++this.intent;this.tour=null;this.travel=null;this.preparing='System map';
  try{const host=this.host(record),system=await this.system(host);await this.register(host);if(token!==this.intent)return;
   this.map={host,system,center:host,scope:'planets',original:{...this.state,position:[...this.state.position],mode:this.mode,orbitManual:!!this.orbit?.manual},page:0};this.overview();
  }finally{if(token===this.intent)this.preparing=null;}
 }
 mapRecords(){
  if(!this.map)return [];const {center,host,system,scope}=this.map;
  if(center.index!==host.index)return this.children(center);
  const all=system.bodyIds.map(id=>this.byId.get(String(id))).filter(r=>r&&!String(r.kind).includes('moon'));
  if(scope==='all')return all;
  const planets=all.filter(r=>r.kind==='planet'),main=planets.length?planets:all;
  return scope==='inner'?[...main].sort((a,b)=>length(sub(a.position,host.position))-length(sub(b.position,host.position))).slice(0,4):main;
 }
 mapScope(scope){if(!this.map)return;this.map.scope=scope;this.map.center=this.map.host;this.overview();}
 family(record){if(!this.map)return;this.map.center=record;this.map.page=0;this.overview();}
 mapLayout(){const {cols,rows}=this.state,h=Math.min(13,Math.max(7,Math.floor(rows*.28))),y=rows-h-2;return {x:1,y,w:cols-2,h,top:4,bottom:y-2};}
 overview(resetZoom=true){
  const m=this.map,center=m.center,records=this.mapRecords();m.closing=false;m.records=records;m.axis=normalize(center.index===m.host.index?m.system.axis||m.system.belts?.[0]?.axis||[0,-.397777,.917482]:center.axis||m.system.axis||[0,-.397777,.917482]);
  m.guides=records.map(r=>{const a=normalize(sub(r.position,center.position)),b=normalize(cross(m.axis,a)),rad=length(sub(r.position,center.position));return Array.from({length:97},(_,i)=>add(center.position,scale(add(scale(a,Math.cos(i*Math.PI/48)),scale(b,Math.sin(i*Math.PI/48))),rad)));});
  const extent=Math.max(radius(center)*12,...records.map(r=>length(sub(r.position,center.position))))*1.06,area=this.mapLayout(),ty=Math.tan(50*Math.PI/360),vertical=Math.max(.08,(area.bottom-area.top-1)/this.state.rows),middle=(area.top+area.bottom)/2/this.state.rows,aspect=this.state.cols/(this.state.rows*1.8);
  // Offset the camera parallel to the orbital plane instead of tilting it to
  // move the map above the dock. This preserves a readable top-down projection.
  const distance=extent/(ty*Math.min(aspect*.88,vertical))*1.04,offset=normalize(add(m.axis,scale(normalize(cross(m.axis,[1,0,0])),.12))),camera={...bearing(scale(offset,-1)),roll:0},up=basis(camera).up,shift=scale(up,-(.5-middle)*2*ty*distance);
  m.zoomMax=Math.min(128,distance/(radius(center)*2.5));
  m.zoom=resetZoom?1:clamp(m.zoom,.2,m.zoomMax);m.zoomTarget=resetZoom?1:clamp(m.zoomTarget,.2,m.zoomMax);
  m.fitOffset=add(shift,scale(offset,distance));m.fitView=camera;
  const target=add(center.position,scale(shift,1/m.zoom)),position=add(center.position,scale(m.fitOffset,1/m.zoom));
  m.move={start:{...this.state,position:[...this.state.position]},route:N.safeWaypoints([this.state.position,position],this.obstacles(center)),target,fov:50,elapsed:0,duration:3.5};
 }
 closeMap(){if(!this.map||this.map.closing)return;const m=this.map;m.closing=true;m.move={start:{...this.state,position:[...this.state.position]},route:N.safeWaypoints([this.state.position,m.original.position],this.obstacles(m.center)),look:forward(m.original),roll:m.original.roll,fov:m.original.fov,elapsed:0,duration:2.5};}
 updateMap(dt){const m=this.map,t=m.move;t.elapsed+=dt;const u=clamp(t.elapsed/t.duration,0,1),ease=u*u*u*(10+u*(-15+6*u));this.state.position=N.pointOnRoute(t.route,t.route.length*ease);Object.assign(this.state,bearing(N.blendDirection(forward(t.start),t.look||sub(t.target,this.state.position),smooth(clamp(u/.8,0,1)))));this.state.fov=t.start.fov+(t.fov-t.start.fov)*ease;this.state.roll=t.start.roll+Math.atan2(Math.sin((t.roll||0)-t.start.roll),Math.cos((t.roll||0)-t.start.roll))*ease;if(u===1){m.move=null;if(m.closing){const {mode,orbitManual,...original}=m.original;Object.assign(this.state,original,{cols:this.state.cols,rows:this.state.rows,time:this.state.time,earthUtcMs:this.state.earthUtcMs});this.mode=mode;this.map=null;this.orbitFromCamera();this.orbit.manual=orbitManual;}}}
 async frame(){
  const state={...this.state,position:[...this.state.position],selectedIndex:this.selected.index,selectedDestination:isPhenomenon(this.selected)?this.selected:null};
  const data=await this.engine.request({type:'frame',state});if(data.stats.local_error)throw Error(data.stats.local_error);
  if(data.earthOrientation)this.earth.axis=data.earthOrientation.axis;
  const n=data.cols*data.rows;return {...data,camera:state,glyphs:new Uint8Array(data.buffer,0,n),fg:new Uint8Array(data.buffer,n,n*3),bg:new Uint8Array(data.buffer,n*4,n*3)};
 }
 async pick(x,y){const p=await this.engine.request({type:'pick',x,y});const raw=p.body||p.star;if(!raw)return null;return this.byIndex.get(raw.index)||this.add(raw);}
 async close(){await this.engine.close();}
}
function rSafe(record){return radius(record)*.025;}
