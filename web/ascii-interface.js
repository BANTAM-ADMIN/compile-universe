/* The visible interface is printable ASCII + RGB cells, like the sky.
 * Existing HTML is a nonvisual semantic/action model for keyboard, IME and
 * assistive technology. No HTML or SVG is captured, rasterized, or shown. */
const asciiCells = value => String(value ?? '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
  .replace(/…/g,'...').replace(/[—–−]/g,'-').replace(/[·•]/g,'.')
  .replace(/[↗→›]/g,'>').replace(/←/g,'<').replace(/×/g,'x')
  .replace(/Ⅱ/g,'||').replace(/[▷▶]/g,'>').replace(/☉/g,'*').replace(/[✧☷⌕]/g,'+')
  .replace(/°/g,' deg').replace(/[^\x20-\x7e\n]/g,'');
export const ascii = value => asciiCells(value).replace(/[ \t]+/g,' ').trim();
const $ = id => document.getElementById(id);
const ink={text:[202,219,220],muted:[125,156,169],dim:[70,101,113],gold:[221,189,130],cyan:[155,217,225],white:[239,249,246],bg:[3,8,12],panel:[5,12,17]};
const visible=e=>e&&!e.closest('[hidden]');
const text=id=>{const e=$(id);if(!e)return '';const copy=e.cloneNode(true);copy.querySelectorAll('br').forEach(br=>br.replaceWith(' '));return ascii(copy.textContent);};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=(value,width)=>{
 const lines=[];let line='';
 for(const word of ascii(value).split(/\s+/)){if(line&&line.length+word.length+1>width){lines.push(line);line='';}if(word.length>width){if(line){lines.push(line);line='';}for(let i=0;i<word.length;i+=width)lines.push(word.slice(i,i+width));}else line+=(line?' ':'')+word;}
 if(line)lines.push(line);return lines;
};

export class AsciiInterface {
 constructor(root,viewport){
  this.root=root;this.viewport=viewport;this.cols=0;this.rows=0;this.dirty=true;this.scroll=0;this.mapScroll=0;
  this.hits=[];this.hover=null;this.pressed=null;this.dropdown=null;this.lastLayout=0;this.mapProjection=null;this.labels=[];
  this.pointerIds=new Set();this.onChange=()=>{this.dirty=true;};
  const observer=new MutationObserver(this.onChange);
  for(const child of root.children)if(child!==viewport)observer.observe(child,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-pressed','aria-selected','aria-expanded','disabled']});
  root.addEventListener('input',e=>{this.dirty=true;if(e.target.matches('[type=search]')){this.scroll=0;this.mapScroll=0;}});
  root.addEventListener('change',this.onChange);document.addEventListener('focusin',this.onChange);
  viewport.addEventListener('pointerdown',e=>this.pointerDown(e),true);
  viewport.addEventListener('pointermove',e=>this.pointerMove(e),true);
  viewport.addEventListener('pointerup',e=>this.pointerUp(e),true);
  viewport.addEventListener('pointercancel',e=>{if(this.pointerIds.delete(e.pointerId)){e.stopImmediatePropagation();this.pressed=null;}},true);
  viewport.addEventListener('wheel',e=>this.wheel(e),{capture:true,passive:false});
  document.addEventListener('keydown',e=>this.key(e),true);
 }
 resize(width,height){
  // Stable, readable terminal cells. Scene sampling stays independently adaptive.
  const cols=clamp(Math.floor(width/8),40,240),rows=Math.max(20,Math.round(cols*height/(width*1.8)));
  if(cols===this.cols&&rows===this.rows)return;
  this.cols=cols;this.rows=rows;const n=cols*rows;
  this.frame={cols,rows,glyphsUint8:new Uint8Array(n),foregroundRGBUint8:new Uint8Array(n*3),backgroundRGBUint8:new Uint8Array(n*3)};
  this.ui=new Uint8Array(n);this.fg=new Uint8Array(n*3);this.bg=new Uint8Array(n*3);this.mask=new Uint8Array(n);this.indices=new Uint32Array(n);
  this.dirty=true;
 }
 put(x,y,value,color=ink.text,background=ink.bg){
  if(y<0||y>=this.rows)return;
  const s=asciiCells(value);x=Math.round(x);y=Math.round(y);
  for(let k=0;k<s.length;k++){const xx=x+k;if(xx<0||xx>=this.cols)continue;const i=y*this.cols+xx,j=i*3;
   if(!this.mask[i]){this.mask[i]=1;this.indices[this.count++]=i;}
   this.ui[i]=s.charCodeAt(k);this.fg.set(color,j);this.bg.set(background,j);
  }
 }
 clear(x,y,w,h,background=ink.panel){
  this.hits=this.hits.filter(hit=>hit.x+hit.w<=x||hit.x>=x+w||hit.y+hit.h<=y||hit.y>=y+h);
  for(let yy=Math.max(0,y);yy<Math.min(this.rows,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(this.cols,x+w);xx++){
   const i=yy*this.cols+xx,j=i*3;if(!this.mask[i]){this.mask[i]=1;this.indices[this.count++]=i;}this.ui[i]=32;this.fg.set(ink.text,j);this.bg.set(background,j);
  }
 }
 line(x0,y0,x1,y1,char='.',color=ink.dim){
  if(![x0,y0,x1,y1].every(Number.isFinite))return;
  // Clip distant endpoints before walking; a near-plane projection can be huge.
  const dx=x1-x0,dy=y1-y0;let a=0,b=1;
  for(const [p,q] of [[-dx,x0],[dx,this.cols-1-x0],[-dy,y0],[dy,this.rows-1-y0]]){if(!p){if(q<0)return;continue;}const t=q/p;if(p<0)a=Math.max(a,t);else b=Math.min(b,t);if(a>b)return;}
  const sx=x0+dx*a,sy=y0+dy*a,ex=x0+dx*b,ey=y0+dy*b,n=Math.max(1,Math.ceil(Math.max(Math.abs(ex-sx),Math.abs(ey-sy))));
  for(let i=0;i<=n;i++)this.put(Math.round(sx+(ex-sx)*i/n),Math.round(sy+(ey-sy)*i/n),char,color);
 }
 box(x,y,w,h,title=''){
  this.clear(x,y,w,h);this.panelArea={x,y,w,h};this.put(x,y,'+'+'-'.repeat(w-2)+'+',ink.dim,ink.panel);
  this.put(x,y+h-1,'+'+'-'.repeat(w-2)+'+',ink.dim,ink.panel);
  for(let yy=y+1;yy<y+h-1;yy++){this.put(x,yy,'|',ink.dim,ink.panel);this.put(x+w-1,yy,'|',ink.dim,ink.panel);}
  if(title)this.put(x+2,y,title.slice(0,w-4),ink.gold,ink.panel);
 }
 addHit(x,y,w,h,element,label,action,kind='button'){
  const hit={x,y,w,h,element,label:ascii(label),action,kind};this.hits.push(hit);return hit;
 }
 button(x,y,element,label,action,max=99){
  if(!element&&!action)return 0;if(element&&!visible(element))return 0;
  label=ascii(label??element.textContent).slice(0,Math.max(1,max-2));const s='['+label+']';
  const active=element===document.activeElement||this.hover?.element===element&&element||this.hover?.label===label&&!element;
  const checked=element?.getAttribute('aria-pressed')==='true'||element?.getAttribute('aria-selected')==='true';
  this.put(x,y,s,element?.disabled?ink.dim:active?ink.white:checked?ink.gold:ink.cyan);
  this.addHit(x,y,s.length,1,element,label,action);return s.length;
 }
 buttons(items,x,y,width,center=false){
  const rows=[];let row=[],len=0;
  for(const item of items){if(!item)continue;const [el,label,action]=item;if(el&&!visible(el))continue;const s=ascii(label??el?.textContent).slice(0,width-2);const n=s.length+2;
   if(row.length&&len+n+1>width){rows.push({items:row,len});row=[];len=0;}row.push([el,s,action]);len+=n+(row.length>1?1:0);
  }if(row.length)rows.push({items:row,len});
  for(const row of rows){let xx=x+(center?Math.floor((width-row.len)/2):0);for(const item of row.items)xx+=this.button(xx,y,...item,width)+1;y++;}
  return y;
 }
 field(x,y,width,element,label=''){
  const value=ascii(element.value),active=document.activeElement===element;
  const prefix=label?label+': ':'';const available=Math.max(3,width-prefix.length-2);
  const caret=element.selectionStart??value.length,offset=Math.max(0,caret-available+1);
  let shown=value.slice(offset,offset+available);if(active){const at=clamp(caret-offset,0,available-1);shown=shown.slice(0,at)+'_'+shown.slice(at+1);}
  const s=prefix+'['+(shown||'type to search...').padEnd(available).slice(0,available)+']';
  this.put(x,y,s,active?ink.white:ink.muted,ink.panel);this.addHit(x,y,width,1,element,label,()=>element.focus({preventScroll:true}),'input');
 }
 compose(base,model,now=performance.now(),flatten=true){
  this.resize(model.width,model.height);this.model=model;
  if(this.dirty||model.mapping||now-this.lastLayout>250){this.layout(model);this.lastLayout=now;this.dirty=false;}
  this.overlay={cols:this.cols,rows:this.rows,glyphsUint8:this.ui,foregroundRGBUint8:this.fg,backgroundRGBUint8:this.bg};
  return flatten?this.flatten(base):this.overlay;
 }
 flatten(base){
  const out=this.frame,g=out.glyphsUint8,f=out.foregroundRGBUint8,b=out.backgroundRGBUint8;
  if(base){
   const sx=base.cols/this.cols,sy=base.rows/this.rows;
   for(let y=0;y<this.rows;y++){const by=Math.min(base.rows-1,Math.floor((y+.5)*sy))*base.cols;
    for(let x=0;x<this.cols;x++){const i=y*this.cols+x,j=i*3,k=by+Math.min(base.cols-1,Math.floor((x+.5)*sx)),q=k*3;
     g[i]=base.glyphsUint8[k];f[j]=base.foregroundRGBUint8[q];f[j+1]=base.foregroundRGBUint8[q+1];f[j+2]=base.foregroundRGBUint8[q+2];b[j]=base.backgroundRGBUint8[q];b[j+1]=base.backgroundRGBUint8[q+1];b[j+2]=base.backgroundRGBUint8[q+2];}
   }
  }else{g.fill(32);f.fill(0);b.fill(0);}
  for(let k=0;k<this.count;k++){const i=this.indices[k],j=i*3;g[i]=this.ui[i];f[j]=this.fg[j];f[j+1]=this.fg[j+1];f[j+2]=this.fg[j+2];b[j]=this.bg[j];b[j+1]=this.bg[j+1];b[j+2]=this.bg[j+2];}
  return out;
 }
 layout(model){
  this.mask.fill(0);this.ui.fill(0);this.count=0;this.hits=[];this.scrollArea=null;this.panelArea=null;
  const C=this.cols,R=this.rows,narrow=C<90;
  // Labels and orbit guides are characters, too; HUD cells overwrite them.
  if(model.mapping)this.drawMap();else if(model.showLabels&&!model.travelling)for(const label of this.labels){
   const e=label.element;if(!e||e.hidden)continue;let x=Math.floor(label.x*C),y=Math.floor(label.y*R);const name=ascii(e.textContent);if(x+name.length>C-2)x-=name.length;
   this.put(x,y,'+ '+name,ink.muted);this.addHit(x,y,name.length+2,1,e,name);
  }
  this.put(2,1,'+ COMPILE UNIVERSE',ink.gold);
  const top=[[$('search-open'),'find'],[$('phenomena-open'),'phenomena'],[$('blackhole-open'),'Sag A*'],[$('info-open'),'?']];
  this.buttons(top,narrow?2:C-46,narrow?3:1,narrow?C-4:44);
  if(!narrow)this.put(2,2,'GAIA / A SKY WRITTEN IN CHARACTERS',ink.dim);
  const footer=R-1;
  this.put(2,footer,(narrow?'drag: look / scroll: travel':text('navigation-hint').toLowerCase()).slice(0,C-18),ink.dim);
  this.put(C-13,footer,text('fps-readout').slice(0,11),ink.muted);
  if(model.mapping)this.mapPanel();else this.navigation(model);
  if(visible($('panel')))this.panel();
  if(!model.ready&&!visible($('error')))this.message('OPENING THE ATLAS',text('loading-message'),[]);
  if(visible($('preparing')))this.message('PREPARING DESTINATION',text('preparing-message'),[[$('cancel-preparing'),'cancel']]);
  if(visible($('error')))this.message('ATLAS MESSAGE',text('error-message'),[[$('retry'),'try again']]);
  if(this.dropdown)this.drawDropdown();
  // A character highlight replaces all browser focus rings and tooltips.
  if(this.hover?.element?.title&&!this.dropdown&&!visible($('panel'))){
   const title=ascii(this.hover.element.title).slice(0,C-4);this.put(Math.max(2,Math.floor((C-title.length)/2)),R-2,title,ink.muted);
  }
 }
 navigation(model){
  const C=this.cols,R=this.rows,w=Math.min(C-4,86),x=Math.floor((C-w)/2);
  let items;
  if(model.touring)items=[[$('tour-pause'),model.tourPaused?'continue':'pause'],[$('tour-next'),text('tour-next').includes('Restart')?'restart':'next >'],[$('tour-stop'),'take control'],[$('destinations'),'explore'],[$('system-map-open'),'map']];
  else items=[[$('primary-journey'),text('primary-journey-label').slice(0,26)],[$('destinations'),'explore'],[$('tour-open'),'tour'],[$('system-map-open'),'map'],[$('mode-toggle'),text('mode-button-label')],[$('motion-toggle'),text('motion-toggle')],[$('look-sun'),'sun'],[$('pause'),model.paused?'>':'||']];
  // Compute the number of wrapped command rows without building a second UI.
  let lines=1,len=0;for(const [el,label]of items){if(!visible(el))continue;const n=ascii(label).length+2;if(len&&len+n+1>w){lines++;len=0;}len+=n+(len?1:0);}
  const controlsY=R-3-lines;this.buttons(items,x,controlsY,w,true);let top=controlsY-2;
  if(model.touring){
   this.put(x,top,text('tour-progress'),ink.gold);this.put(x+w-12,top,text('tour-state').toLowerCase(),ink.muted);top-=2;
   this.put(x,top,text('tour-chapter').toLowerCase(),ink.gold);
   this.put(x+12,top,text('tour-title').slice(0,w-18),ink.text);this.button(x+w-5,top,$('tour-details'),$('tour-caption').hidden?'+':'-');
   if(!$('tour-caption').hidden){const caption=wrap(text('tour-caption'),w);const cap=caption.slice(0,Math.max(2,Math.min(7,top-6)));const yy=top-cap.length-1;cap.forEach((s,i)=>this.put(x,yy+i,s,ink.muted));top=yy;}
  }else if(visible($('journey'))){
   this.put(x,top,text('journey-detail').slice(0,w-11),ink.muted);this.button(x+w-8,top,$('cancel-journey'),'stop');top--;
   this.put(x,top,(text('journey-from')+' > '+text('journey-to')).slice(0,w),ink.cyan);top--;
   this.put(x,top,text('journey-stage').toLowerCase().slice(0,w),ink.dim);
  }else if(visible($('resume-card'))){
   this.put(x,top-1,text('resume-label').slice(0,w),ink.muted);this.buttons([[$('resume-journey'),'resume >'],[$('dismiss-resume'),'dismiss']],x,top,w,true);top-=2;
  }
  if(!model.touring&&!model.travelling&&!visible($('panel'))){
   const leftWidth=C<90?C-4:Math.min(60,C-40);const desc=wrap(text('object-description'),leftWidth).slice(0,2);
   let y=Math.max(6,top-7-desc.length);this.put(2,y++,text('object-kicker').slice(0,leftWidth),ink.dim);this.put(2,y++,text('object-title').slice(0,leftWidth),ink.white);
   desc.forEach(s=>this.put(2,y++,s,ink.muted));y++;
   this.buttons([[$('inspect-selected'),text('inspect-selected')],[$('explore-system'),'system'],[$('night-side'),'night side']],2,y,leftWidth);
  }
  if(C>=90&&!visible($('panel'))){
   const value=text('distance-value')+' '+text('distance-unit').toLowerCase();this.put(C-2-Math.min(35,value.length),top-3,value.slice(0,35),ink.muted);
  }
 }
 // Panel content is a list of semantic text rows, not a raster of HTML.
 panel(){
  const C=this.cols,R=this.rows,w=Math.min(62,C-4),x=C-w-2,y=C<90?5:4,h=R-y-3;
  const dest=!$('destinations-panel').hidden,key=dest?'destinations':'observatory';if(key!==this.panelKey){this.panelKey=key;this.scroll=0;}
  this.box(x,y,w,h,dest?' DESTINATIONS ':' OBSERVATORY ');
  this.buttons([[$('tab-destinations'),'destinations'],[$('tab-observatory'),'settings']],x+2,y+1,w-9);this.button(x+w-5,y+1,$('close-panel'),'x');
  const doc=this.document(w-4);
  if(dest){
   doc.field($('star-search'),'find');doc.gap();
   doc.buttons([...document.querySelectorAll('[data-category]')].map(e=>[e,({solar:'solar',systems:'systems',wonders:'stars',phenomena:'phenomena'})[e.dataset.category]]));
   doc.p(text('destinations-count'),ink.dim);doc.gap();
   if(visible($('target-card'))){
    doc.p(text('target-name'),ink.gold);doc.p(text('target-kind')+' / '+text('target-data-class'),ink.dim);doc.p(text('target-description'));
    doc.p(text('target-facts'),ink.muted);doc.buttons([[$('fly-preview'),'fly >'],[$('inspect-preview'),text('inspect-preview')],[$('map-preview'),'map']]);
    if(visible($('target-view-options')))doc.buttons([...document.querySelectorAll('[data-arrival-view]')].map(e=>[e,e.textContent]));doc.gap();
   }
   if(visible($('system-cards')))for(const e of $('system-cards').querySelectorAll('button'))doc.buttons([[e,e.querySelector('strong')?.textContent||e.textContent]]);
   if(visible($('quick-destinations')))doc.buttons([...$('quick-destinations').querySelectorAll('button')].map(e=>[e,e.textContent]));
   doc.gap();doc.p(text('search-caption'),ink.dim);
   for(const row of $('search-results').children){const e=row.querySelector('.destination');if(!e)continue;
    const name=ascii(e.querySelector('.destination-name')?.textContent),distance=ascii(e.querySelector('.destination-distance')?.textContent);
    doc.buttons([[e,name],[row.querySelector('.destination-arrow'),'>']]);doc.p(ascii(e.querySelector('.destination-description')?.textContent)+' / '+distance,ink.muted);
   }
   doc.gap();doc.buttons([[$('phenomena-feature'),'phenomena observatory >']]);doc.p($('destinations-panel').querySelector('.panel-note')?.textContent,ink.dim);
  }else{
   for(const id of ['survey-mode','density','exposure','display-mode'])doc.setting($(id));
   doc.check($('show-labels'),'names in the sky');doc.check($('pause-setting'),'pause scene time');doc.p('Scene pause holds animation. Camera travel remains available.',ink.dim);doc.gap();
   doc.buttons([[$('fullscreen'),'fullscreen'],[$('reset-earth'),'return to Earth']]);doc.buttons([[$('save-text'),'save text'],[$('save-ansi'),'save ANSI']]);doc.gap();
   doc.p('AT THE CONTROLS',ink.gold);for(const dt of document.querySelectorAll('.keyboard-help dt'))doc.p(ascii(dt.textContent)+' : '+ascii(dt.nextElementSibling.textContent));
   doc.gap();doc.p('THE MEASURED AND THE IMAGINED',ink.gold);
   for(const id of ['survey-status','provenance','epoch-note']){doc.p(text(id),ink.muted);doc.gap();}
   for(const a of $('license-note').querySelectorAll('a'))doc.buttons([[a,ascii(a.textContent)]]);
   for(const e of document.querySelectorAll('.metrics>div'))doc.p(ascii(e.textContent),ink.dim);
  }
  this.showDocument(doc,x+2,y+3,w-4,h-5,'scroll');
 }
 document(width){
  const rows=[],d={rows,width};
  d.p=(value,color=ink.text)=>{for(const s of wrap(value,width))rows.push({kind:'text',value:s,color});};
  d.gap=()=>rows.push({kind:'text',value:''});
  d.buttons=items=>{let line=[],len=0;for(const [el,label,action]of items){if(el&&!visible(el))continue;const name=ascii(label??el?.textContent).slice(0,width-2),n=name.length+2;if(line.length&&len+n+1>width){rows.push({kind:'buttons',items:line});line=[];len=0;}line.push([el,name,action]);len+=n+(len?1:0);}if(line.length)rows.push({kind:'buttons',items:line});};
  d.field=(element,label)=>rows.push({kind:'field',element,label});
  d.check=(e,label)=>{d.buttons([[e,(e.checked?'x':' ')+'] '+label]]);};
  d.setting=e=>{
   const label=ascii(e.closest('label').querySelector('span')?.textContent);d.p(label,ink.muted);
   if(e.tagName==='SELECT')d.buttons([[e,ascii(e.selectedOptions[0]?.textContent)+' v',()=>{this.dropdown=e;this.dirty=true;}] ]);
   else{const adjust=delta=>()=>{e.value=String(clamp(Number(e.value)+delta*Number(e.step||1),Number(e.min),Number(e.max)));e.dispatchEvent(new Event('input',{bubbles:true}));this.dirty=true;};d.buttons([[null,'-',adjust(-1)],[null,e.value+'x',()=>{}],[null,'+',adjust(1)]]);}
   d.gap();
  };return d;
 }
 showDocument(doc,x,y,w,h,property){
  const max=Math.max(0,doc.rows.length-h);this[property]=clamp(this[property],0,max);const start=this[property];
  for(let i=0;i<h;i++){const row=doc.rows[start+i];if(!row)break;if(row.kind==='text')this.put(x,y+i,row.value,row.color,ink.panel);else if(row.kind==='field')this.field(x,y+i,w,row.element,row.label);else this.buttons(row.items,x,y+i,w);}
  const yy=y+h;this.put(x,yy,`${Math.min(doc.rows.length,start+1)}-${Math.min(doc.rows.length,start+h)}/${doc.rows.length}`,ink.dim,ink.panel);
  if(max)this.button(x+w-20,yy,null,'up',()=>{this[property]=Math.max(0,start-Math.max(1,h-2));this.dirty=true;});
  if(max)this.button(x+w-14,yy,null,'down',()=>{this[property]=Math.min(max,start+Math.max(1,h-2));this.dirty=true;});
  if(max)this.put(x+w-7,yy,'scroll',ink.dim,ink.panel);this.scrollArea={x,y,w,h,property,max};
 }
 mapLayout(){
  const C=this.cols,R=this.rows;
  const lineCount=selector=>{let rows=1,n=0;for(const e of document.querySelectorAll(selector)){const size=Math.min(C-10,ascii(e.querySelector('strong')?.textContent||e.textContent).length)+3;if(n&&n+size>C-8){rows++;n=0;}n+=size;}return rows;};
  const needed=5+lineCount('#map-families button')+lineCount('#map-body-list button');
  const h=clamp(needed,8,Math.max(10,Math.min(18,Math.round(R*.29)))),y=R-h-3;
  return {x:2,y,w:C-4,h,top:7,bottom:y-2};
 }
 drawMap(){
  const map=this.mapProjection;if(!map)return;
  const area=this.mapLayout();
  for(const path of map.paths)for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];if(a&&b)this.line(a[0]*this.cols,a[1]*this.rows,b[0]*this.cols,b[1]*this.rows,'.',ink.dim);}
  const occupied=[];
  for(const node of map.nodes){
   if(!node.p)continue;const x=Math.round(node.p[0]*this.cols),y=Math.round(node.p[1]*this.rows);
   if(x<0||x>=this.cols||y<area.top||y>area.bottom)continue;
   const name=ascii(node.name).slice(0,Math.min(25,Math.floor(this.cols/2)-5)),w=name.length+2;
   let best=null;
   for(const lx of [clamp(x+2,2,this.cols-w-2),clamp(x-w-2,2,this.cols-w-2),2,this.cols-w-2]){
    for(let ly=area.top;ly<=area.bottom;ly++){
     if(occupied.some(p=>Math.abs(p.y-ly)<1.5&&lx<p.x+p.w+1&&lx+w+1>p.x))continue;
     const cost=Math.abs(ly-y)*2+Math.abs(lx+w/2-x)*.18;
     if(!best||cost<best.cost)best={x:lx,y:ly,w,cost};
    }
   }
   if(best){occupied.push(best);this.line(x,y,x<best.x?best.x-1:best.x+best.w,best.y,':',ink.dim);this.button(best.x,best.y,node.element,name,node.action,w);}
   this.put(x,y,'*',node.selected?ink.gold:ink.cyan);
   this.addHit(x-1,y,3,1,null,name,node.action,'map-node');
  }
 }
 mapPanel(){
  const C=this.cols;this.put(2,5,text('map-title'),ink.gold);this.button(C-11,5,$('map-close'),'close x');
  const {x,y,w,h}=this.mapLayout();
  this.box(x,y,w,h,' SYSTEM / CLICK A WORLD TO FLY ');const doc=this.document(w-4);
  doc.buttons([...$('map-families').querySelectorAll('button')].map(e=>[e,e.textContent]));
  doc.field($('map-search'),'find');
  doc.buttons([...$('map-body-list').querySelectorAll('button')].map(e=>[e,e.querySelector('strong')?.textContent||e.textContent]));
  if(visible($('map-more')))doc.buttons([[$('map-more'),'more worlds']]);
  doc.p('Orbit guides show distances. Choose a planet + moons above for its family.',ink.dim);
  this.showDocument(doc,x+2,y+1,w-4,h-3,'mapScroll');
 }
 message(title,value,buttons){
  const w=Math.min(this.cols-4,64),lines=wrap(value,w-4),h=Math.min(this.rows-6,lines.length+5),x=Math.floor((this.cols-w)/2),y=Math.max(4,Math.floor((this.rows-h)/2));
  this.box(x,y,w,h,title);lines.slice(0,h-4).forEach((s,i)=>this.put(x+2,y+2+i,s,ink.text,ink.panel));this.buttons(buttons,x+2,y+h-2,w-4,true);
 }
 drawDropdown(){
  const e=this.dropdown;if(!visible(e)){this.dropdown=null;return;}const options=[...e.options],w=Math.min(this.cols-6,60),h=options.length+4,x=Math.floor((this.cols-w)/2),y=Math.max(4,Math.floor((this.rows-h)/2));
  this.box(x,y,w,h,' CHOOSE ');this.button(x+w-5,y,null,'x',()=>{this.dropdown=null;this.dirty=true;});
  options.forEach((option,i)=>this.button(x+2,y+2+i,null,(option.selected?'* ':'  ')+ascii(option.text).slice(0,w-6),()=>{e.value=option.value;e.dispatchEvent(new Event('change',{bubbles:true}));this.dropdown=null;this.dirty=true;e.focus({preventScroll:true});},w-4));
  this.modal={x,y,w,h};
 }
 point(event){const r=this.viewport.querySelector(this.model?.textMode?'pre':'canvas').getBoundingClientRect();return {x:(event.clientX-r.left)*this.cols/r.width,y:(event.clientY-r.top)*this.rows/r.height};}
 hit(point){return [...this.hits].reverse().find(h=>point.x>=h.x&&point.x<h.x+h.w&&point.y>=h.y-.25&&point.y<h.y+h.h+.25);}
 inArea(p,a){return a&&p.x>=a.x&&p.x<a.x+a.w&&p.y>=a.y&&p.y<a.y+a.h+1;}
 consume(e){e.preventDefault();e.stopImmediatePropagation();}
 pointerDown(e){
  const p=this.point(e);
  if(this.dropdown&&!this.inArea(p,this.modal)){this.consume(e);this.dropdown=null;this.dirty=true;return;}
  const hit=this.hit(p);
  this.keyboardHit=null;
  if(!hit&&!this.inArea(p,this.panelArea)&&!this.dropdown)return;
  this.consume(e);this.pointerIds.add(e.pointerId);this.pressed=hit;this.startPoint=p;this.viewport.setPointerCapture(e.pointerId);
  if(hit?.kind==='input'){hit.action();this.pressed=null;}this.dirty=true;
 }
 pointerMove(e){
  const p=this.point(e);if(this.pointerIds.has(e.pointerId)){this.consume(e);if(this.inArea(p,this.scrollArea)&&Math.abs(p.y-this.startPoint.y)>1){const a=this.scrollArea;this[a.property]=clamp(this[a.property]+Math.round(this.startPoint.y-p.y),0,a.max);this.startPoint=p;this.pressed=null;this.dirty=true;}return;}
  const hit=this.hit(p);if(hit?.element!==this.hover?.element||hit?.label!==this.hover?.label){this.hover=hit;this.dirty=true;}
  this.viewport.style.cursor=hit?'pointer':'grab';
 }
 pointerUp(e){
  if(!this.pointerIds.delete(e.pointerId))return;this.consume(e);const hit=this.hit(this.point(e)),old=this.pressed;this.pressed=null;
  if(old&&hit&&(old.element?old.element===hit.element:old.label===hit.label))this.activate(hit);
 }
 activate(hit){
  if(hit.element?.disabled)return;
  if(hit.element?.matches('.destination,.system-card,[data-category]'))this.scroll=0;
  if(hit.element?.matches('.map-world'))this.mapScroll=0;
  if(hit.action)hit.action();else if(hit.element){hit.element.focus({preventScroll:true});hit.element.click();if(document.activeElement===hit.element&&hit.element.tagName==='BUTTON')this.viewport.focus({preventScroll:true});}
  this.dirty=true;
 }
 wheel(e){const p=this.point(e);if(this.inArea(p,this.scrollArea)){this.consume(e);const a=this.scrollArea;this[a.property]=clamp(this[a.property]+Math.sign(e.deltaY)*3,0,a.max);this.dirty=true;}}
 key(e){
  if(e.key==='Tab'){
   const area=this.dropdown?this.modal:visible($('panel'))?this.panelArea:null;
   const hits=this.hits.filter(h=>!h.element?.disabled&&(!area||this.inArea(h,area))),current=hits.findIndex(h=>this.keyboardHit ? (this.keyboardHit.element ? h.element===this.keyboardHit.element : !h.element&&h.label===this.keyboardHit.label) : h.element===document.activeElement);
   if(hits.length){this.consume(e);const hit=hits[(current+(e.shiftKey?-1:1)+hits.length)%hits.length];this.keyboardHit=hit;if(hit.element)hit.element.focus({preventScroll:true});else this.viewport.focus({preventScroll:true});this.hover=hit;this.dirty=true;}return;
  }
  if(e.key==='Escape'&&this.dropdown){this.consume(e);this.dropdown=null;this.dirty=true;return;}
  if(document.activeElement?.tagName==='SELECT'&&['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){this.consume(e);this.dropdown=document.activeElement;this.dirty=true;return;}
  if((e.key==='Enter'||e.key===' ')&&this.keyboardHit&&!this.keyboardHit.element&&document.activeElement===this.viewport){this.consume(e);this.activate(this.keyboardHit);return;}
  if((e.key==='PageDown'||e.key==='PageUp')&&this.scrollArea){this.consume(e);const a=this.scrollArea;this[a.property]=clamp(this[a.property]+(e.key==='PageDown'?1:-1)*(a.h-2),0,a.max);this.dirty=true;}
 }
 debug(){return {cols:this.cols,rows:this.rows,hits:this.hits.map(({x,y,w,h,element,label,kind})=>({x,y,w,h,id:element?.id,label,kind})),scroll:this.scroll,mapScroll:this.mapScroll,printable:[...this.ui].every(c=>c===0||c>=32&&c<=126)};}
}
