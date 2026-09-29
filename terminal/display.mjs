import {once} from 'node:events';
export const ascii=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[—–−]/g,'-').replace(/[·•]/g,'.').replace(/…/g,'...').replace(/[↗→]/g,'>').replace(/[^\x20-\x7e]/g,'');
export const colors={text:[197,216,220],muted:[113,146,160],dim:[60,84,95],gold:[225,189,125],cyan:[137,211,222],white:[242,249,245],bg:[3,8,12],panel:[5,12,17]};
export class Grid {
 constructor(cols,rows,base){this.cols=cols;this.rows=rows;const n=cols*rows;this.glyphs=new Uint8Array(n).fill(32);this.fg=new Uint8Array(n*3);this.bg=new Uint8Array(n*3);this.hits=[];if(base?.cols===cols&&base?.rows===rows){this.glyphs.set(base.glyphs);this.fg.set(base.fg);this.bg.set(base.bg);}}
 text(x,y,value,color=colors.text,bg=colors.bg){x=Math.round(x);y=Math.round(y);if(y<0||y>=this.rows)return;const text=ascii(value);for(let k=0;k<text.length;k++){const xx=x+k;if(xx<0||xx>=this.cols)continue;const i=y*this.cols+xx;this.glyphs[i]=text.charCodeAt(k);this.fg.set(color,i*3);this.bg.set(bg,i*3);}}
 clear(x,y,w,h){this.hits=this.hits.filter(r=>r.x+r.w<=x||r.x>=x+w||r.y+r.h<=y||r.y>=y+h);for(let k=0;k<h;k++)this.text(x,y+k,' '.repeat(Math.max(0,w)),colors.text,colors.panel);}
 box(x,y,w,h,title=''){if(w<4||h<3)return;this.clear(x,y,w,h);this.text(x,y,'+'+'-'.repeat(w-2)+'+',colors.dim);this.text(x,y+h-1,'+'+'-'.repeat(w-2)+'+',colors.dim);for(let yy=y+1;yy<y+h-1;yy++){this.text(x,yy,'|',colors.dim);this.text(x+w-1,yy,'|',colors.dim);}this.text(x+2,y,ascii(title).slice(0,w-4),colors.gold);}
 button(x,y,label,action,width){const s='['+ascii(label).slice(0,width?width-2:100)+']';this.text(x,y,s,colors.cyan);this.hits.push({x,y,w:s.length,h:1,label:ascii(label),action});return s.length+1;}
 buttons(items,x,y,width){let xx=x;for(const [label,action]of items){const size=Math.min(width,ascii(label).length+2);if(xx>x&&xx+size>x+width){xx=x;y++;}xx+=this.button(xx,y,label,action,width);}return y+1;}
 line(x0,y0,x1,y1,char='.',color=colors.dim,clip={}){if(![x0,y0,x1,y1].every(Number.isFinite))return;const left=Math.max(0,clip.left??0),right=Math.min(this.cols-1,clip.right??this.cols-1),top=Math.max(0,clip.top??0),bottom=Math.min(this.rows-1,clip.bottom??this.rows-1);if(left>right||top>bottom)return;const dx=x1-x0,dy=y1-y0;let lo=0,hi=1;for(const[p,q]of[[-dx,x0-left],[dx,right-x0],[-dy,y0-top],[dy,bottom-y0]]){if(!p){if(q<0)return;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return;}const sx=x0+dx*lo,sy=y0+dy*lo,ex=x0+dx*hi,ey=y0+dy*hi,n=Math.max(1,Math.ceil(Math.max(Math.abs(ex-sx),Math.abs(ey-sy))));for(let i=0;i<=n;i++)this.text(sx+(ex-sx)*i/n,sy+(ey-sy)*i/n,char,color);}
 hit(x,y){return [...this.hits].reverse().find(h=>x>=h.x&&x<h.x+h.w&&y>=h.y&&y<h.y+h.h);}
 plain(){return Array.from({length:this.rows},(_,y)=>String.fromCharCode(...this.glyphs.subarray(y*this.cols,(y+1)*this.cols))).join('\n')+'\n';}
}
function color256(r,g,b){const v=[r,g,b].map(x=>Math.round(x/51)),cube=v.map(x=>x*51),mean=(r+g+b)/3,gray=Math.max(0,Math.min(23,Math.round((mean-8)/10))),gv=8+10*gray;return [r,g,b].reduce((s,x)=>s+(x-gv)**2,0)<[r,g,b].reduce((s,x,i)=>s+(x-cube[i])**2,0)?232+gray:16+36*v[0]+6*v[1]+v[2];}
export function encodeANSI(frame,previous=null,mode='truecolor'){
 const {cols,rows,glyphs:g,fg,bg}=frame,same=previous&&previous.cols===cols&&previous.rows===rows;let out='',oldColor='';
 const changed=i=>!same||g[i]!==previous.glyphs[i]||fg[i*3]!==previous.fg[i*3]||fg[i*3+1]!==previous.fg[i*3+1]||fg[i*3+2]!==previous.fg[i*3+2]||bg[i*3]!==previous.bg[i*3]||bg[i*3+1]!==previous.bg[i*3+1]||bg[i*3+2]!==previous.bg[i*3+2];
 for(let y=0;y<rows;y++){let cursor=-1;for(let x=0;x<cols;x++){const i=y*cols+x;if(!changed(i))continue;if(cursor!==x)out+=`\x1b[${y+1};${x+1}H`;const j=i*3,color=mode==='none'?'':mode==='256'?`\x1b[38;5;${color256(fg[j],fg[j+1],fg[j+2])};48;5;${color256(bg[j],bg[j+1],bg[j+2])}m`:`\x1b[38;2;${fg[j]};${fg[j+1]};${fg[j+2]};48;2;${bg[j]};${bg[j+1]};${bg[j+2]}m`;if(color!==oldColor){out+=color;oldColor=color;}out+=String.fromCharCode(g[i]>=32&&g[i]<=126?g[i]:32);cursor=x+1;}}
 return out;
}
export class TerminalDisplay {
 constructor(output=process.stdout,{mouse=true,sync=false,colors='truecolor'}={}){this.output=output;this.mouse=mouse;this.sync=sync;this.colors=colors;this.active=false;this.previous=null;}
 enter(){if(this.active)return;this.active=true;this.output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h\x1b[0m\x1b[2J'+(this.mouse?'\x1b[?1000h\x1b[?1002h\x1b[?1006h':''));this.previous=null;}
 reset(){this.previous=null;if(this.active)this.output.write('\x1b[0m\x1b[2J');}
 leave(){if(!this.active)return;this.active=false;this.output.write('\x1b[?2026l\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?2004l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l');}
 async present(frame){const bytes=encodeANSI(frame,this.previous,this.colors);if(!bytes)return;if(!this.output.write((this.sync?'\x1b[?2026h':'')+bytes+(this.sync?'\x1b[?2026l':'')))await once(this.output,'drain');this.previous=frame;}
}
