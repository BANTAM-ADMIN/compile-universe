// Seeded, seamless spherical terrain compiled once on the worker, never per frame.
// RGB albedo + tangent normals retain arbitrary viewpoints and moving sunlight.
// All generated geography is fictional; the real Moon uses NASA maps separately.
export const SURFACE_VERSION=1;
export const SURFACE_WIDTH=384,SURFACE_HEIGHT=192;
export function surfaceSeed(value){let h=2166136261;for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;}
function random(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const sqr=x=>x*x;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*clamp(t);
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const palettes={
 rocky:[[[48,44,43],[207,187,158]],[[58,65,76],[203,210,213]],[[64,42,36],[203,144,99]]],
 carbon:[[[18,23,30],[139,153,166]],[[27,23,28],[162,137,140]]],
 ice:[[[52,101,133],[232,243,242]],[[96,67,48],[244,228,193]],[[54,76,100],[224,230,250]]],
 desert:[[[99,40,23],[244,199,115]],[[102,66,51],[236,212,170]]],
 violet:[[[48,29,68],[206,170,212]],[[46,49,70],[175,203,218]]],
 lava:[[[21,23,29],[102,80,76]],[[31,20,21],[128,64,41]]],
 ocean:[[[8,29,81],[28,113,165]]],
 gas:[[[89,49,33],[240,218,175]],[[96,74,85],[244,223,206]],[[78,90,104],[218,214,187]]],
 hotgas:[[[105,35,38],[247,177,96]],[[76,39,67],[239,171,172]]],
 icegiant:[[[18,49,120],[101,183,224]],[[32,91,101],[166,227,211]]],
};
let sphere;
function grid(){
 if(sphere)return sphere;const n=SURFACE_WIDTH*SURFACE_HEIGHT;sphere=new Float32Array(n*3);
 for(let y=0;y<SURFACE_HEIGHT;y++){const lat=Math.PI*(.5-y/(SURFACE_HEIGHT-1)),z=Math.sin(lat),r=Math.cos(lat);
  for(let x=0;x<SURFACE_WIDTH;x++){const lon=2*Math.PI*((x+.5)/SURFACE_WIDTH-.5),i=(y*SURFACE_WIDTH+x)*3;sphere[i]=r*Math.cos(lon);sphere[i+1]=r*Math.sin(lon);sphere[i+2]=z;}}
 return sphere;
}
export function compileSurface(descriptor){
 const width=SURFACE_WIDTH,height=SURFACE_HEIGHT,n=width*height,xyz=grid(),seed=descriptor.seed>>>0,rng=random(seed);
 const style=descriptor.style,gas=['gas','hotgas','icegiant'].includes(style),frozen=style==='ice',lava=style==='lava',ocean=style==='ocean';
 const options=palettes[style]||palettes.rocky,[dark,pale]=options[Math.floor(rng()*options.length)];
 const waves=Array.from({length:6},(_,i)=>{const f=(2.2+i*i*.75)*(1+rng()*.4);return [(rng()-.5)*f,(rng()-.5)*f,(rng()-.5)*f,rng()*6.283,1/(1+i*.65)];});
 const craters=[],count=gas||ocean?0:lava?24:style==='desert'?45:100;
 for(let i=0;i<count;i++){
  const z=rng()*2-1,lon=rng()*Math.PI*2,r=Math.sqrt(1-z*z),radius=i<5?.15+rng()*.24:.022+rng()**1.5*.12;
  craters.push({x:r*Math.cos(lon),y:r*Math.sin(lon),z,radius,cut:1-(radius*1.7)**2/2,age:rng(),rays:rng()*8+7});
 }
 const pixels=new Uint8Array(n*3),heights=new Float32Array(n),normals=new Uint8Array(n*3);
 const bandCount=10+rng()*24,phase=rng()*6.283,fractureScale=2.4+rng()*2.5;
 const storms=Array.from({length:3},()=>({z:rng()*1.3-.65,lon:rng()*6.283-Math.PI,size:.11+rng()*.16}));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,j=i*3,px=xyz[j],py=xyz[j+1],pz=xyz[j+2];
  let field=0;for(const w of waves)field+=Math.sin(px*w[0]+py*w[1]+pz*w[2]+w[3])*w[4];field*=.48;
  let terrain=.004*field,t=.5+field*.23,scar=0,emissive=0;
  if(gas){
   const latitude=Math.asin(pz),lon=Math.atan2(py,px),q=latitude*bandCount+.8*field+.2*Math.sin(lon*3+phase);
   t=.51+.29*Math.sin(q)+.12*Math.sin(q*2.7+.6*field);
   for(const storm of storms){const dl=Math.atan2(Math.sin(lon-storm.lon),Math.cos(lon-storm.lon));const d=(dl/(storm.size*2.1))**2+((pz-storm.z)/storm.size)**2;
    if(d<2.2)t=mix(t,.22+.19*Math.sin(d*19+field*2),clamp((2.2-d)*.8));}
   terrain=0;
  }else{
   for(const c of craters){
    const dprod=px*c.x+py*c.y+pz*c.z;if(dprod<c.cut)continue;
    const d=Math.sqrt(Math.max(0,2*(1-dprod)))/c.radius;
    const rim=Math.exp(-sqr((d-1)/.115)),bowl=1-smooth(d/.96),peak=c.radius>.12?Math.exp(-sqr(d/.16)):0;
    terrain+=c.radius*(.052*rim-.085*bowl+.048*peak);
    const young=1-c.age,ray=young>.55?(.5+.5*Math.sin((px*c.y-py*c.x)*c.rays/c.radius+phase))**6:0;
    scar+=.35*rim-.20*bowl+(c.age>.66?-.13*bowl:0)+.18*young*ray*Math.exp(-sqr((d-1.2)/.38))+.15*peak;
   }
   t+=scar;
   if(frozen||lava){
    const v=Math.sin(field*fractureScale+px*5+py*3),v2=Math.sin(field*3.1-pz*7+py*4);
    const cracks=Math.max(Math.exp(-sqr(v/.065)),Math.exp(-sqr(v2/.05))*.65);
    terrain-=cracks*(frozen?.0025:.001);t-=cracks*(frozen?.65:.25);
    if(lava)emissive=clamp(cracks*1.3);
   }
  }
  heights[i]=terrain;
  for(let k=0;k<3;k++){
   let color=mix(dark[k],pale[k],t);
   if(ocean){const land=smooth((field-.05)*4),coast=[63,122,101],upland=[198,183,126];color=mix(color,mix(coast[k],upland[k],field*.65),land);const cloud=smooth((Math.sin(px*11+py*7+field*4)+Math.cos(pz*17-px*8)-1.1)*1.3);color=mix(color,[224,235,241][k],cloud*.82);}
   if(lava)color=mix(color,[255,139,29][k],emissive);
   pixels[j+k]=Math.round(clamp(color,0,255));
  }
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,j=i*3,cos=Math.max(.035,Math.cos(Math.PI*(.5-y/(height-1))));
  const east=-(heights[y*width+(x+1)%width]-heights[y*width+(x+width-1)%width])*width/(4*Math.PI*cos);
  const north=(heights[Math.min(height-1,y+1)*width+x]-heights[Math.max(0,y-1)*width+x])*(height-1)/(2*Math.PI);
  const len=Math.hypot(east,north,1);normals[j]=Math.round(128+127*east/len);normals[j+1]=Math.round(128+127*north/len);normals[j+2]=Math.round(255/len);
 }
 return {pixels,normals,width,height,bytes:pixels.byteLength+normals.byteLength};
}
