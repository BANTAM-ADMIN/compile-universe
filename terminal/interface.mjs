import {Grid,colors as C,ascii} from './display.mjs';
import {distanceText,sub,length,isPhenomenon,clamp} from './navigation.mjs';
import {tourStops} from './tour.mjs';
import {drawSystemMap} from './system-map.mjs';
export class Interface {
 constructor(universe,{quit,snapshot,suspend}={}){this.u=universe;this.quit=quit;this.snapshot=snapshot;this.suspend=suspend;this.panel=null;this.query='';this.category='all';this.index=0;this.scroll=0;this.mapIndex=0;this.familyPage=0;this.showLabels=true;this.focus=-1;}
 run(action){try{Promise.resolve(action?.()).catch(e=>{this.u.notice=e.message;});}catch(e){this.u.notice=e.message;}}
 find(category='all'){this.panel='search';this.category=category;this.query='';this.index=0;this.scroll=0;this.preview=null;this.focus=-1;}
 fly(record,options){this.panel=null;this.run(()=>this.u.fly(record,options));}
 map(record=this.u.selected){this.panel=null;this.mapIndex=0;this.run(async()=>{await this.u.openMap(record);if(this.u.map)this.mapIndex=Math.max(0,this.mapList().findIndex(r=>r.index===record.index));});}
 matches(){return this.u.search(this.query,this.category);}
 previewRecord(record){if(!record)return;this.find();this.query=record.name;this.preview=record;}
 render(base){
  const u=this.u,{cols,rows}=u.state,g=new Grid(cols,rows,base);this.grid=g;
  if(!u.ready){g.text(2,2,'+ COMPILE UNIVERSE / TERMINAL',C.gold);g.text(2,4,u.notice||'Loading local universe data...',C.muted);g.text(2,6,'[Q] quit',C.dim);return g;}
  if(u.map)this.drawMap(g,base?.camera||u.state);
  else if(this.showLabels&&!u.travel&&!this.panel)for(const label of (base?.labels||[]).slice(0,5)){
   const r=u.byIndex.get(label.index);if(!r||r.index===u.selected.index||label.y<.15||label.y>.7)continue;
   const x=clamp(Math.round(label.x*cols),1,cols-Math.min(24,ascii(r.name).length)-3),y=Math.round(label.y*rows);g.button(x,y,r.name,()=>this.previewRecord(r),24);
  }
  g.clear(0,0,cols,1);g.text(1,0,'+ COMPILE UNIVERSE',C.gold);
  g.buttons([['find /',()=>this.find()],['? help',()=>{this.panel='help';this.scroll=0;}],['quit q',this.quit]],Math.max(23,cols-30),0,cols-Math.max(23,cols-30));
  if(u.map)this.mapDock(g);
  else{
   const info=rows-7;g.clear(0,info,Math.min(cols,Math.max(28,ascii(u.selected.name).length+3)),2);
   g.text(1,info,u.selected.name,C.white);g.text(1,info+1,(u.selected.generated?'GENERATED WORLD / ':isPhenomenon(u.selected)?'PHENOMENON / ':'')+distanceText(length(sub(u.state.position,u.selected.position))),C.muted);
   if(u.tour){const t=u.tour,stop=tourStops[t.index];g.text(1,info-2,`TOUR ${t.index+1}/${tourStops.length}  ${stop?.title||''}  ${t.paused?'PAUSED':u.travel?'IN FLIGHT':'EXPLORING'}`,C.gold);}
   else if(u.travel){const t=u.travel,n=Math.floor(t.elapsed/t.duration*18);g.text(1,info-2,'FLYING TO '+t.destination.name+' ['+'='.repeat(n)+'>'+'.'.repeat(Math.max(0,18-n))+']',C.cyan);}
   const items=u.tour?[['space '+(u.tour.paused?'resume':'pause'),()=>u.pause()],['next n',()=>this.run(()=>u.nextTour())],['take control',()=>u.cancel()],['story',()=>{this.panel='story';}]]:[['find /',()=>this.find()],['map m',()=>this.map()],['tour t',()=>this.run(()=>u.startTour())],['orbit/free o',()=>u.free()],[u.motionHeld?'cruise b':'hold b',()=>u.brake()],['space '+(u.paused?'resume':'pause'),()=>u.pause()]];
   g.clear(0,rows-3,cols,2);g.buttons(items,1,rows-3,cols-2);
  }
  g.clear(0,rows-1,cols,1);g.text(1,rows-1,(u.map?'wheel +/-: zoom / 0: fit / arrows: select / Enter: fly / Esc: return':u.mode==='orbit'?'arrows/drag: steer  B: hold/cruise  WS/wheel: zoom':'arrows/drag: look  WASD/RF: fly  B: settle').slice(0,Math.max(1,cols-16)),C.dim);
  g.text(cols-14,rows-1,`${this.fps||0} fps ${u.map?'MAP':u.mode==='orbit'?'ORBIT':'FREE'}`,C.muted);
  if(this.panel==='search')this.searchPanel(g);
  else if(this.panel)this.helpPanel(g);
  if(u.notice){g.box(2,2,cols-4,4,' MESSAGE ');g.text(4,3,u.notice.slice(0,cols-8),C.gold);g.button(cols-13,4,'dismiss',()=>{u.notice='';});}
  if(u.preparing){const w=Math.min(64,cols-4),x=Math.floor((cols-w)/2),y=Math.max(4,Math.floor(rows/2)-2);g.box(x,y,w,5,' PREPARING ');g.text(x+2,y+1,ascii(u.preparing).slice(0,w-4));g.button(x+2,y+3,'cancel / esc',()=>u.cancel());}
  if(this.focus>=0&&g.hits.length){this.focus%=g.hits.length;const h=g.hits[this.focus];g.text(Math.max(0,h.x-1),h.y,'>',C.gold);}
  return g;
 }
 searchPanel(g){
  const u=this.u,w=Math.min(76,g.cols-2),x=Math.floor((g.cols-w)/2),y=2,h=g.rows-4;g.box(x,y,w,h,' DESTINATIONS ');this.panelArea={x,y,w,h};
  g.button(x+w-9,y,'close',()=>{this.panel=null;});
  g.buttons([['all',()=>this.find()],['worlds',()=>this.find('worlds')],['phenomena',()=>this.find('phenomena')]],x+2,y+1,w-4);
  g.text(x+2,y+3,('/ '+ascii(this.query)+'_').slice(-(w-4)).padEnd(w-4),C.white);
  const records=this.matches();this.results=records;this.index=clamp(this.index,0,Math.max(0,records.length-1));
  const count=Math.max(2,h-12);this.scroll=clamp(this.scroll,Math.max(0,this.index-count+1),this.index);
  for(let j=0;j<count;j++){const i=this.scroll+j,r=records[i];if(!r)break;const yy=y+5+j;g.text(x+2,yy,i===this.index?'>':' ',C.gold);g.button(x+4,yy,r.name,()=>{this.index=i;this.preview=r;},w-13);g.button(x+w-7,yy,'>',()=>this.fly(r));}
  if(!records.length)g.text(x+3,y+5,'No destinations match.',C.muted);
  const target=this.preview&&records.some(r=>r.index===this.preview.index)?this.preview:records[this.index];this.target=target;
  const footer=y+h-6;
  g.text(x+2,footer,`${records.length?' '+(this.index+1):0}/${records.length}  arrows / PgUp PgDn / type to search`,C.dim);
  if(target){g.text(x+2,footer+1,ascii(target.name+' / '+(target.generated?'generated':target.kind||'catalog star')).slice(0,w-4),C.gold);g.text(x+2,footer+2,ascii(target.description||'').slice(0,w-4),C.muted);
   g.buttons([['fly enter',()=>this.fly(target)],['inspect',()=>this.fly(target,{inspect:true})],...(!isPhenomenon(target)?[['system',()=>this.map(target)]]:[]),...(target.emission?[['night',()=>this.fly(target,{view:'night'})]]:[])],x+2,footer+3,w-4);}
 }
 helpPanel(g){
  const u=this.u,w=Math.min(76,g.cols-2),x=Math.floor((g.cols-w)/2),y=2,h=g.rows-4;g.box(x,y,w,h,this.panel==='story'?' GRAND TOUR ':' CONTROLS / DISPLAY ');this.panelArea={x,y,w,h};g.button(x+w-9,y,'close',()=>{this.panel=null;});
  let lines=this.panel==='story'?[tourStops[u.tour?.index]?.title||u.selected.name,tourStops[u.tour?.index]?.caption||u.selected.description||'']:['Arrows or mouse drag: look / orbit','+ / - or wheel: approach / pull back','Orbit: A/D circle, R/F rise/lower, W/S zoom','Free: WASD fly; R/F move up/down','O: toggle free flight / lock orbit on the object','B: hold / resume cruise or settle near a world','In free flight +/- changes movement speed.','/: search destinations. Enter flies to a result.','M: system map. Click a world to fly to it.','Map: planets / inner / all; [ / ]: moon families','Map arrows: select; PgUp/PgDn: turn the page','Map wheel or +/-: zoom; 0 or Home: fit the system','T: Grand Tour. N: next stop. Space: pause','Esc: cancel flight / close panel / leave map','H: return to Earth. I: inspect selected world','L: toggle star names. P: save text + ANSI frame','Q or Ctrl-C: quit and restore the terminal','',`Exposure: ${u.state.exposure.toFixed(1)}  ( , / . )`,`Star field: ${['Original HYG + galaxy','Gaia + modeled galaxy','Survey stars only'][u.state.surveyMode]} ( G cycles )`,'','Generated worlds and stellar activity are imagined.','Solar positions retain the fixed J2000 scene epoch.','Earth rotation follows UTC; lunar alignment is approximate.','Use your terminal font size to change text resolution.'];
  const wrapped=[];for(const line of lines){let value=ascii(line);while(value.length>w-4){let end=value.lastIndexOf(' ',w-4);if(end<1)end=w-4;wrapped.push(value.slice(0,end));value=value.slice(end).trim();}wrapped.push(value);}
  this.scroll=clamp(this.scroll,0,Math.max(0,wrapped.length-h+4));wrapped.slice(this.scroll,this.scroll+h-4).forEach((line,i)=>g.text(x+2,y+2+i,line,i===0?C.gold:C.muted));g.text(x+2,y+h-2,'up/down or wheel: scroll / esc: close',C.dim);
 }
 mapList(){return this.u.map?[this.u.map.center,...this.u.mapRecords()]:[];}
 drawMap(g,camera){
  const list=this.mapList();this.mapIndex=clamp(this.mapIndex,0,Math.max(0,list.length-1));
  this.mapDrawing=drawSystemMap(g,this.u,camera,list[this.mapIndex],r=>this.fly(r));
 }
 mapScope(scope){this.u.mapScope(scope);this.mapIndex=0;}
 selectMap(delta){this.mapIndex=clamp(this.mapIndex+delta,0,Math.max(0,this.mapList().length-1));}

 families(){const m=this.u.map;if(!m)return [];return [m.host,...m.system.bodyIds.map(id=>this.u.byId.get(String(id))).filter(r=>r&&this.u.children(r).length)];}
 cycleFamily(delta){const list=this.families(),i=list.findIndex(r=>r.index===this.u.map.center.index);this.u.family(list[(i+delta+list.length)%list.length]);this.mapIndex=0;}
 mapDock(g){
  const u=this.u,m=u.map,{x,y,w,h}=u.mapLayout();
  g.clear(0,2,g.cols,2);
  const scope=m.center.index!==m.host.index?'MOON FAMILY':m.scope==='inner'?'INNER SYSTEM':m.scope==='all'?'ALL BODIES':'PLANETARY SYSTEM';
  g.text(1,2,ascii(m.center.name+' / '+scope).slice(0,g.cols-20),C.gold);
  g.button(g.cols-15,2,'close / esc',()=>u.closeMap());
  const mapStatus=m.move?(m.closing?'Returning to flight...':'Flying above the orbital plane...'):'Fixed positions / click a world to fly';
  g.text(1,3,mapStatus.slice(0,g.cols-29),C.dim);
  g.text(g.cols-26,3,m.zoom.toFixed(2)+'x',C.muted);
  g.buttons([['-',()=>u.zoom(.18)],['+',()=>u.zoom(-.18)],['fit 0',()=>u.fitMap()]],g.cols-18,3,17);
  g.box(x,y,w,h,' SYSTEM / CLICK TO FLY ');
  g.buttons([['planets',()=>this.mapScope('planets')],['inner',()=>this.mapScope('inner')],['all',()=>this.mapScope('all')],['moons <',()=>this.cycleFamily(-1)],['moons >',()=>this.cycleFamily(1)],['find /',()=>this.find('worlds')]],x+2,y+1,w-4);
  const list=this.mapList();this.mapResults=list;this.mapIndex=clamp(this.mapIndex,0,list.length-1);
  const columns=Math.min(5,Math.max(1,Math.floor((w-4)/25))),cellWidth=Math.floor((w-4)/columns),listRows=Math.max(1,h-5),perPage=listRows*columns,start=Math.floor(this.mapIndex/perPage)*perPage;
  this.mapColumns=columns;this.mapPageSize=perPage;
  for(let j=0;j<perPage;j++){
   const i=start+j,r=list[i];if(!r)break;const xx=x+2+j%columns*cellWidth,yy=y+3+Math.floor(j/columns),selected=i===this.mapIndex;
   g.text(xx,yy,selected?'>':' ',C.gold);g.button(xx+2,yy,r.name,()=>this.fly(r),cellWidth-3);
   Object.assign(g.hits.at(-1),{kind:'map-item',index:r.index});
   if(selected)g.text(xx+2,yy,'['+ascii(r.name).slice(0,cellWidth-5)+']',C.gold);
  }
  const last=Math.min(list.length,start+perPage),status=`${start+1}-${last}/${list.length}  ${m.system.dataClass==='generated-system'?'generated / ':''}arrows: select / Enter: fly`;
  g.text(x+2,y+h-2,status.slice(0,w-18),C.muted);
  g.button(x+w-15,y+h-2,'<',()=>this.selectMap(-perPage));g.button(x+w-11,y+h-2,'>',()=>this.selectMap(perPage));
 }

 key(key){
  const u=this.u;
  if(key==='ctrl-c'||key==='ctrl-d'){this.quit?.();return;}if(key==='ctrl-z'){this.suspend?.();return;}
  if(!u.ready){if(key==='q')this.quit?.();return;}
  if(key==='escape'){this.focus=-1;if(u.preparing){u.cancel();return;}if(this.panel){this.panel=null;return;}if(u.notice){u.notice='';return;}if(u.map){u.closeMap();return;}u.cancel();return;}
  if(key==='tab'||key==='shift-tab'){const count=this.grid?.hits.length||0;if(count)this.focus=(this.focus+(key==='tab'?1:-1)+count)%count;return;}
  if(key==='enter'&&this.focus>=0){this.run(this.grid?.hits[this.focus]?.action);this.focus=-1;return;}
  this.focus=-1;
  if(this.panel==='search'){
   const count=this.matches().length;
   if(['up','down','pageup','pagedown'].includes(key)){this.index=clamp(this.index+({up:-1,down:1,pageup:-8,pagedown:8})[key],0,Math.max(0,count-1));this.preview=null;return;}
   if(key==='enter'){const r=this.matches()[this.index];if(r)this.fly(r);return;}
   if(key==='backspace'){this.query=this.query.slice(0,-1);this.index=0;this.preview=null;return;}
   if(key.length===1||key==='space'){this.query=(this.query+(key==='space'?' ':key)).slice(0,120);this.index=0;this.preview=null;}return;
  }
  if(key==='q'){this.quit?.();return;}if(key==='p'){this.snapshot?.();return;}
  if(this.panel){if(['down','pagedown','space'].includes(key))this.scroll+=key==='down'?1:6;else if(['up','pageup'].includes(key))this.scroll=Math.max(0,this.scroll-(key==='up'?1:6));return;}
  if(key==='/'){this.find();return;}if(key==='?'){this.panel='help';this.scroll=0;return;}
  if(u.map){if(key==='+'||key==='='||key==='-'){u.zoom(key==='-'?.18:-.18);return;}if(key==='0'||key==='home'){u.fitMap();return;}if(key==='m'){u.closeMap();return;}if(key==='['||key===']'){this.cycleFamily(key==='['?-1:1);return;}if(['up','down','left','right','pageup','pagedown'].includes(key)){const stride=this.mapColumns||1;this.selectMap(({up:-stride,down:stride,left:-1,right:1,pageup:-(this.mapPageSize||1),pagedown:this.mapPageSize||1})[key]);return;}if(key==='enter'){const r=this.mapList()[this.mapIndex];if(r)this.fly(r);}return;}
  if(key==='m'){this.map();return;}if(key==='t'){this.run(()=>u.startTour());return;}if(key==='n'&&u.tour){this.run(()=>u.nextTour());return;}
  if(key==='space'){u.pause();return;}if(key==='o'){u.free();return;}if(key==='b'){u.brake();return;}if(key==='h'){this.fly(u.earth);return;}if(key==='i'){this.fly(u.selected,{inspect:true});return;}if(key==='l'){this.showLabels=!this.showLabels;return;}
  if(key==='g'){u.state.surveyMode=(u.state.surveyMode+1)%3;return;}if(key===','||key==='.'){u.state.exposure=clamp(u.state.exposure+(key==='.'?.1:-.1),.4,3);return;}
  if(key==='+'||key==='='||key==='-'){u.zoom(key==='-'?.18:-.18);return;}
  if(['up','down','left','right'].includes(key)){u.look(key==='left'?-.045:key==='right'?.045:0,key==='up'?.045:key==='down'?-.045:0);return;}
  if('wasdrf'.includes(key)&&key.length===1)u.move(key==='a'?-1:key==='d'?1:0,key==='r'?1:key==='f'?-1:0,key==='w'?1:key==='s'?-1:0);
 }
 paste(text){if(this.panel==='search'){this.query=(this.query+ascii(text)).slice(0,120);this.index=0;this.preview=null;}}
 mouse(e){
  const g=this.grid;if(!g)return;this.focus=-1;
  if(e.wheel){const delta=e.code&1?1:-1;if(this.panel==='search'){this.index=clamp(this.index+delta*3,0,Math.max(0,this.matches().length-1));this.preview=null;}else if(this.panel)this.scroll=Math.max(0,this.scroll+delta*3);else this.u.zoom(delta*.14);return;}
  if(e.motion){if(this.drag&&!this.drag.hit&&!this.panel&&!this.u.map){const dx=e.x-this.drag.lastX,dy=e.y-this.drag.lastY;if(dx||dy){this.drag.moved=true;this.u.look(dx*.014,dy*.026);this.drag.lastX=e.x;this.drag.lastY=e.y;}}return;}
  if(e.release){const d=this.drag;this.drag=null;if(!d)return;const hit=g.hit(e.x,e.y);if(d.hit&&hit?.label===d.hit.label)this.run(hit.action);else if(!d.hit&&!d.moved&&!this.panel&&!this.u.map&&!this.u.preparing)this.run(async()=>this.previewRecord(await this.u.pick(e.x/g.cols,e.y/g.rows)));return;}
  if((e.code&3)!==0)return;const hit=g.hit(e.x,e.y);this.drag={lastX:e.x,lastY:e.y,moved:false,hit};
 }
}
