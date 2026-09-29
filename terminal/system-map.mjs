// A chart over the live map camera. Keep physical positions, but spend the
// terminal's limited cells on orbit geometry rather than background texture.
import {colors as C,ascii} from './display.mjs';
import {project,clamp,smooth,sub,length,basis,dot,distanceText} from './navigation.mjs';

function fadeSky(g,strength){
 const fade=1-strength*.93;
 for(let i=0;i<g.glyphs.length;i++){
  const j=i*3,peak=Math.max(...g.fg.subarray(j,j+3));
  // Remove most background glyphs as well as dimming them, so monochrome
  // terminals and copied text get a quiet chart too. The remaining dots are
  // sampled from actual bright sources in the moving sky.
  const keep=peak>190&&((i*2654435761)>>>0)%19===0;
  const threshold=(((i*1103515245+12345)>>>0)%997)/997;
  if(threshold<strength){g.glyphs[i]=keep?46:32;g.fg.set([28,40,49],j);g.bg.set(C.bg,j);}
  else for(let k=0;k<3;k++){g.fg[j+k]*=fade;g.bg[j+k]*=fade;}
 }
}

const within=(p,a)=>p&&p[0]>=a.left&&p[0]<=a.right&&p[1]>=a.top&&p[1]<=a.bottom;
const overlap=(a,b)=>a.x<=b.x+b.w&&a.x+a.w>=b.x&&Math.abs(a.y-b.y)<1.1;

function chart(g,center,records,paths,point,area,selected,fly){
 const nodes=[center,...records].map(r=>({r,p:point(r.position)})).filter(n=>within(n.p,area));
 const priorities=[...nodes].sort((a,b)=>(b.r.index===selected?.index)-(a.r.index===selected?.index)||(b.r.index===center.index)-(a.r.index===center.index));
 const projected=paths.map(path=>path.map(point));
 // Dim sparse orbit lines first; draw the selected orbit last and brighter.
 const order=records.map((r,i)=>i).sort((a,b)=>(records[a].index===selected?.index)-(records[b].index===selected?.index));
 const radii=[];
 for(const index of order){
  const path=projected[index],active=records[index].index===selected?.index,points=path.filter(Boolean);
  if(points.length<2)continue;
  const span=Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));
  // Orbits closer together than a row cannot carry useful separate lines.
  if(!active&&(span<1.8||radii.some(r=>Math.abs(span-r)<1.3)))continue;
  radii.push(span);
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i];if(!a||!b)continue;
   const dx=b[0]-a[0],dy=b[1]-a[1],ch=Math.abs(dx)>Math.abs(dy)*2.5?'-':Math.abs(dy)>Math.abs(dx)*1.5?'|':dx*dy>=0?'\\':'/';
   g.line(...a,...b,ch,active?C.gold:C.dim,area);
  }
 }
 const labels=[],markers=[],used=new Set();
 for(const n of priorities){
  const [x,y]=n.p.map(Math.round),key=`${x},${y}`;if(used.has(key))continue;used.add(key);markers.push({...n,x,y});
  const name=ascii(n.r.name).slice(0,Math.min(22,Math.floor((area.right-area.left)/2))),w=name.length+2;
  const candidates=[];
  for(const dy of [0,-1,1,-2,2])for(const lx of [x+2,x-w-2]){
   const candidate={x:lx,y:y+dy,w};
   if(lx<area.left||lx+w-1>area.right||candidate.y<area.top||candidate.y>area.bottom)continue;
   if(labels.some(p=>overlap(p,candidate)))continue;
   if(nodes.some(other=>Math.abs(other.p[1]-candidate.y)<.8&&other.p[0]>=lx-1&&other.p[0]<=lx+w))continue;
   candidates.push({...candidate,cost:Math.abs(dy)*3+(lx<x?.5:0)});
  }
  candidates.sort((a,b)=>a.cost-b.cost);
  if(candidates.length)labels.push({...candidates[0],name,r:n.r});
 }
 // Markers and names have their own exact hit targets; no cross-chart leaders.
 for(const {r,x,y}of markers){g.text(x,y,r.index===selected?.index?'@':r.index===center.index?'*':'o',r.index===selected?.index?C.gold:C.cyan);g.hits.push({x,y,w:1,h:1,label:r.name,kind:'map-node',index:r.index,action:()=>fly(r)});}
 for(const p of labels){g.button(p.x,p.y,p.name,()=>fly(p.r),p.w);Object.assign(g.hits.at(-1),{kind:'map-label',index:p.r.index});if(p.r.index===selected?.index)g.text(p.x,p.y,`[${p.name}]`,C.gold);}
 return {nodes:markers,labels,paths:projected};
}

export function drawSystemMap(g,u,camera,selected,fly){
 const m=u.map,layout=u.mapLayout(),area={left:2,right:g.cols-3,top:layout.top,bottom:layout.bottom};
 const progress=m.move?clamp(m.move.elapsed/m.move.duration,0,1):1;
 const strength=m.closing?1-smooth(clamp(progress*2,0,1)):smooth(clamp(progress*1.8,0,1));
 fadeSky(g,strength);
 if(m.move)return {transition:true}; // Draw guides only once the camera settles.
 const point=p=>{const q=project(p,camera);return q?[q[0]*g.cols,q[1]*g.rows]:null;};
 const bounds=m.guides.flat().map(point).filter(Boolean);
 const left=Math.min(...bounds.map(p=>p[0])),right=Math.max(...bounds.map(p=>p[0]));
 const insetWidth=Math.min(38,Math.floor(left)-6),height=area.bottom-area.top+1;
 const hasInset=m.center===m.host&&m.scope==='planets'&&m.records.length>4&&insetWidth>=30&&height>=10;
 const inner=hasInset?[...m.records].sort((a,b)=>length(sub(a.position,m.center.position))-length(sub(b.position,m.center.position))).slice(0,4):[];
 const mainRecords=hasInset?m.records.filter(r=>!inner.includes(r)):m.records;
 const result=chart(g,m.center,mainRecords,mainRecords.map(r=>m.guides[m.records.indexOf(r)]),point,hasInset?{...area,left:insetWidth+5}:area,selected,fly);
 // Wide, short windows have spare space beside the full system. Use it for a
 // true-position magnification of the inner orbits, with the same click actions.
 if(hasInset){
  const paths=inner.map(r=>m.guides[m.records.indexOf(r)]),box={x:2,y:area.top,w:insetWidth,h:height};
  g.box(box.x,box.y,box.w,box.h,' INNER ORBITS ');
  const region={left:box.x+2,right:box.x+box.w-3,top:box.y+2,bottom:box.y+box.h-3},b=basis(camera);
  const extent=Math.max(...inner.map(r=>length(sub(r.position,m.center.position)))),scale=Math.min((region.right-region.left)/3.6,(region.bottom-region.top)/2)/extent*.87;
  const centerX=(region.left+region.right)/2,centerY=(region.top+region.bottom)/2;
  const magnify=p=>{const d=sub(p,m.center.position);return [centerX+dot(d,b.right)*scale*1.8,centerY-dot(d,b.up)*scale];};
  result.inset=chart(g,m.center,inner,paths,magnify,region,selected,fly);
  g.text(box.x+2,box.y+box.h-2,'same positions / enlarged',C.muted);
 }
 if(selected&&g.cols-right>50){
  const x=Math.max(Math.ceil(right)+25,g.cols-32),w=g.cols-x-2;
  g.text(x,area.top+1,ascii(selected.name).slice(0,w),C.gold);
  g.text(x,area.top+3,selected===m.center?'SYSTEM CENTER':distanceText(length(sub(selected.position,m.center.position)))+' from '+ascii(m.center.name),C.muted);
  g.text(x,area.top+5,'@ selected / o world',C.dim);
  if(height>=10){g.text(x,area.top+7,'Enter or click to fly',C.cyan);g.text(x,area.top+8,'Inner view: close orbits'.slice(0,w),C.dim);}
 }
 return result;
}
