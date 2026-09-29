// Portable direct-to-character interpreter of precompiled optical tables.
// No graphics API, mesh/raster image, geodesic stepping, or GPU dependency.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>
#include "galactic_environment.h"
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

namespace {
constexpr float PI = 3.14159265358979323846f;
constexpr const char* GLYPHS = " .,:;!i~+*rnxzjftLCJUYXZO0Qmwqpdbkhao#MW&8%B@$";
struct V { float x=0,y=0,z=0; };
V operator+(V a,V b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
V operator-(V a,V b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
V operator*(V a,float b){return {a.x*b,a.y*b,a.z*b};}
V operator/(V a,float b){return a*(1.f/b);}
float dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
float length(V a){return std::sqrt(dot(a,a));}
V normalize(V a){return a/std::max(length(a),1e-30f);}
V cross(V a,V b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
float clip(float x,float a,float b){return std::max(a,std::min(x,b));}
float mix(float a,float b,float t){return a+(b-a)*t;}
V mix(V a,V b,float t){return a+(b-a)*t;}
V direction_mix(V a,V b,float t){
 if(t<=0)return a;if(t>=1)return b;
 float cosine=clip(dot(a,b),-1,1);if(cosine>.9995f)return normalize(mix(a,b,t));
 V tangent=b-a*cosine;float sine=length(tangent);
 // Exactly opposite directions have no unique shortest arc. Pick a stable
 // orthogonal axis instead of normalizing the zero vector at half strength.
 if(sine<1e-6f)tangent=normalize(cross(a,std::abs(a.x)<.8f?V{1,0,0}:V{0,1,0}));
 else tangent=tangent/sine;
 float angle=std::atan2(sine,cosine)*t;
 return normalize(a*std::cos(angle)+tangent*std::sin(angle));
}
float wrap(float x){return x-std::floor(x);}
double now_ms(){
#ifdef __EMSCRIPTEN__
 return emscripten_get_now();
#else
 return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
#endif
}
struct Array {const float* data=nullptr;int h=0,w=0,c=0;};
struct Crossing {float angle=0,v=0,omega=0,flux=0,temperature=0,edge=0; bool valid=false;};
struct Geometry {V straight,outgoing,sky;Crossing disk[3];bool captured=false,shadow=false,has_disk=false;};
struct DiskBeam {Geometry geometry;float x,y,area;};
struct Engine {
 Array a[13];bool initialized=false,cached=false;int nimpact=0,nphase=0,ninverse=0;
 float bc=0,epsilon=0,rmin=0,rmax=0,caplo=0,caphi=0,esclo=0,eschi=0;
 int cols=0,rows=0;float key[6]={},camera_radius=0;int shadows=0,disks=0;
 std::vector<Geometry> geo;std::vector<V> light,emission,glow,temp,blurred;
 float pointFlux=0;V pointColor={1,.72f,.32f};
 std::vector<DiskBeam> beams;float filteredDisk=0;
 std::vector<uint8_t> output,mask,objectMask,material;std::vector<float> coverage;bool overlay=false,environmentEnabled=false;
 galaxy::Context environment={};int environmentCells=0,capturedCells=0;float lensStrength=1;
 float stats[12]={};const char* error="";
} g;

float scalar(const Array& a,int i,int j){return a.data[size_t(i)*a.w+j];}
float table(const Array& a,int row,float weight,float x){
 float col=clip(x,0,1)*(a.w-1);int j=std::min(int(col),a.w-2);float t=col-j;
 return mix(mix(scalar(a,row,j),scalar(a,row,j+1),t),
            mix(scalar(a,row+1,j),scalar(a,row+1,j+1),t),weight);
}
V pixel(const Array& a,int x,int y){const float* p=a.data+(size_t(y)*a.w+x)*a.c;return {p[0],a.c>1?p[1]:0,a.c>2?p[2]:0};}
V chart(const Array& a,float u,float v){
 float x=wrap(u)*a.w-.5f,y=clip(v,0,1)*(a.h-1);int ix=int(std::floor(x)),iy=int(y);
 float tx=x-ix,ty=y-iy;int x0=(ix+a.w)%a.w,x1=(x0+1)%a.w,y1=std::min(iy+1,a.h-1);
 return mix(mix(pixel(a,x0,iy),pixel(a,x1,iy),tx),mix(pixel(a,x0,y1),pixel(a,x1,y1),tx),ty);
}

void optical(Geometry& out,V origin,V radial,V direction,float radius){
 out.straight=direction;
 float velocity=dot(radial,direction);V transverse=direction-radial*velocity;
 float sine=length(transverse);V angular=transverse/std::max(sine,1e-30f);
 float b=radius*sine/std::sqrt(1-1/radius);bool inward=velocity<0,cap=b<=g.bc;
 out.captured=inward&&cap;
 float relative=b/g.bc-1;
 float coord=cap?-std::log(std::max(-relative,g.epsilon)):std::log(std::max(relative,g.epsilon));
 float index=(coord-(cap?g.caplo:g.esclo))/((cap?g.caphi:g.eschi)-(cap?g.caplo:g.esclo))*(g.nimpact-1);
 index=clip(index,0,g.nimpact-1);int row=std::min(int(index),g.nimpact-2);float weight=index-row;
 if(!cap)row+=g.nimpact;
 float end=mix(g.a[0].data[row],g.a[0].data[row+1],weight);
 // Evaluate the cubic turning point in double precision: float cancellation
 // otherwise distorts grazing rays viewed from the far end of the domain.
 double safe_b=std::max(double(b),double(g.bc)*(1+g.epsilon));
 double angle=(std::acos(std::clamp(1.-27./(2*safe_b*safe_b),-1.,1.))+4*3.14159265358979323846)/3;
 float umax=cap?1.f:float((1+2*std::cos(angle))/3);
 float invcoord=cap?g.rmin/radius:2/PI*std::asin(clip(1/(radius*umax),0,1));
 float start=table(g.a[2],row,weight,invcoord)*end;
 float total=inward?(cap?end:2*end)-start:start;
 bool radial_ray=sine<1e-10f;if(radial_ray)total=0;
 out.outgoing=out.captured?direction:normalize(radial*std::cos(total)+angular*std::sin(total));
 if(radial_ray&&!inward)out.outgoing=radial;
 float first=std::fmod(std::atan2(-radial.y,angular.y)+2*PI,PI);
 if(first<1e-7f)first+=PI;
 bool coplanar=std::abs(radial.y)+std::abs(angular.y)<1e-10f;
 out.has_disk=false;
 for(int k=0;k<3;++k){
  Crossing& cross=out.disk[k];cross.valid=false;float phi=first+k*PI;
  if(coplanar||radial_ray||phi>=total-1e-7f)continue;
  float canonical=inward?start+phi:start-phi;
  bool after=inward&&!cap&&canonical>end;
  if(after)canonical=2*end-canonical;
  float u=table(g.a[1],row,weight,canonical/std::max(end,1e-30f))*umax;
  if(!(u>1.f/16&&u<1.f/3))continue;
  float r=1/u;V er=radial*std::cos(phi)+angular*std::sin(phi);
  V ea=radial*(-std::sin(phi))+angular*std::cos(phi);V point=er*r;point.y=0;
  float st=clip(b*u*std::sqrt(std::max(1-u,0.f)),0,1);
  float ct=std::sqrt(std::max(1-st*st,0.f))*((!inward||after)?1:-1);
  V tangent=er*ct+ea*st;
  // Static quantities are compiled once per camera, not recomputed as disk
  // animation advances. Only chart phase and temperature lookup remain live.
  float ri=clip((r-3)/13*(g.a[11].h-1),0,g.a[11].h-1);int j=int(ri);float f=ri-j;
  const float* p=g.a[11].data+j*4;const float* q=g.a[11].data+std::min(j+1,g.a[11].h-1)*4;
  float profile=mix(p[0],q[0],f),omega=mix(p[1],q[1],f),temp=mix(p[2],q[2],f),edge=mix(p[3],q[3],f);
  float beta=std::sqrt(.5f/(r-1)),toward=-dot(V{-point.z/r,0,point.x/r},tangent);
  float shift=std::sqrt(1-beta*beta)/(1-beta*toward)*std::sqrt((1-1/r)/(1-1/radius));
  cross={std::atan2(point.z,point.x),(r-3)/13,omega,
         profile*std::pow(clip(shift,.15f,3),2.6f)*3.1f,temp*shift,edge,true};
  out.has_disk=true;
 }
 out.shadow=out.captured&&!out.has_disk;
}

// Integrate radiance before choosing a character. The same compiled crossings
// shade both resolved cells and sub-character beams; no separate disk sprite.
V disk_light(const Geometry& cell,float time,int palette,float strength,float& transmission){
 V light={};transmission=1;
 for(const auto& cross:cell.disk){if(!cross.valid)continue;
  V fields=chart(g.a[10],(cross.angle-time*cross.omega)/(2*PI),cross.v);
  float ti=clip((cross.temperature*fields.y-1800)/26200*(g.a[12].h-1),0,g.a[12].h-1);int j=int(ti);float f=ti-j;
  const float* p=g.a[12].data+j*3;const float* q=g.a[12].data+std::min(j+1,g.a[12].h-1)*3;
  V rgb={mix(p[0],q[0],f),mix(p[1],q[1],f),mix(p[2],q[2],f)};
  if(palette)rgb={rgb.z*.75f,rgb.y,rgb.x*1.2f};
  float alpha=clip((.56f+.35f*fields.x)*cross.edge,0,.96f)*strength;
  light=light+rgb*(transmission*alpha*cross.flux*std::pow(std::max(fields.x,0.f),1.35f));transmission*=1-alpha;
 }
 return light;
}
void geometry(int cols,int rows,V position,float yaw,float pitch,float fov){
 float radius=clip(length(position),g.rmin,g.rmax);V radial=normalize(position);
 float sy=std::sin(yaw),cy=std::cos(yaw),sp=std::sin(pitch),cp=std::cos(pitch);
 V forward={sy*cp,sp,cy*cp},right={-cy,0,sy},up={-sy*sp,cp,-cy*sp};
 float tany=std::tan(fov*PI/360),tanx=tany*cols/(rows*1.8f);
 galaxy::set_footprint(g.environment,2*tany/rows);
 g.shadows=g.disks=g.environmentCells=g.capturedCells=0;
 g.beams.clear();g.filteredDisk=0;
 float z=-dot(position,forward);
 if(z>32){
  float cx=(-dot(position,right)/z/tanx+1)*cols*.5f-.5f;
  float cy=(1+dot(position,up)/z/tany)*rows*.5f-.5f;
  float rx=18/z/tanx*cols*.5f,ry=18/z/tany*rows*.5f;
  float resolved=clip((ry-3)/3,0,1);g.filteredDisk=1-resolved*resolved*(3-2*resolved);
  if(g.filteredDisk>0&&cx+rx+1>=0&&cy+ry+1>=0&&cx-rx-1<cols&&cy-ry-1<rows){
   constexpr int samples=40;
   float area=4*rx*ry/(samples*samples);
   g.beams.reserve(samples*samples);
   for(int y=0;y<samples;++y)for(int x=0;x<samples;++x){
    DiskBeam beam={};beam.x=cx+rx*(2*(x+.5f)/samples-1);beam.y=cy+ry*(2*(y+.5f)/samples-1);beam.area=area;
    float xx=((beam.x+.5f)/cols*2-1)*tanx,yy=(1-(beam.y+.5f)/rows*2)*tany;
    optical(beam.geometry,position,radial,normalize(forward+right*xx+up*yy),radius);
    if(beam.geometry.has_disk||beam.geometry.captured)g.beams.push_back(beam);
   }
  }
 }
 for(int y=0;y<rows;++y)for(int x=0;x<cols;++x){
  float xx=((x+.5f)/cols*2-1)*tanx,yy=(1-(y+.5f)/rows*2)*tany;
  auto& cell=g.geo[y*cols+x];optical(cell,position,radial,normalize(forward+right*xx+up*yy),radius);
  g.shadows+=cell.shadow;g.disks+=cell.has_disk;g.capturedCells+=cell.captured;
 }
 for(int y=0;y<rows;++y)for(int x=0;x<cols;++x){
  auto& cell=g.geo[y*cols+x];
  if(g.environmentEnabled){
   // These are the actual asymptotic directions from the compiled geodesic
   // transfer, in the same ICRS/world axes as the straight atlas camera rays.
   // The shared environment therefore bends continuously around the hole.
   if(cell.captured&&g.lensStrength>=1&&g.filteredDisk==0){cell.sky={};continue;}
   V direction=direction_mix(cell.straight,cell.outgoing,g.lensStrength);
   auto sky=galaxy::sample(g.environment,direction.x,direction.y,direction.z);
   cell.sky={sky.x,sky.y,sky.z};if(!cell.captured)++g.environmentCells;continue;
  }
  if(cell.captured&&g.filteredDisk==0){cell.sky={};continue;}
  if(g.overlay){cell.sky={};continue;}
  V dx=g.geo[y*cols+std::min(x+1,cols-1)].outgoing-g.geo[y*cols+std::max(x-1,0)].outgoing;
  V dy=g.geo[std::min(y+1,rows-1)*cols+x].outgoing-g.geo[std::max(y-1,0)*cols+x].outgoing;
  float lx=length(dx)*(x==0||x==cols-1?1:.5f),ly=length(dy)*(y==0||y==rows-1?1:.5f);
  float footprint=clip(std::sqrt(std::max(lx*ly,1e-10f)),1e-5f,.35f);
  float u=std::atan2(cell.outgoing.x,cell.outgoing.z)/(2*PI)+.5f;
  float v=.5f-std::asin(clip(cell.outgoing.y,-1,1))/PI;
  float level=clip(std::log2(std::max(footprint,1e-6f)*g.a[3].w/(2*PI)),0,6);int low=int(level);
  V sky=mix(chart(g.a[3+low],u,v),chart(g.a[3+std::min(low+1,6)],u,v),level-low);
  float peak=std::max({sky.x,sky.y,sky.z});cell.sky=sky*(std::max(peak-.025f,0.f)/std::max(peak,1e-12f));
 }
 g.camera_radius=radius;
}

void box(const std::vector<V>& in,std::vector<V>& out,int radius,bool vertical){
 int lines=vertical?g.cols:g.rows,span=vertical?g.rows:g.cols;
 for(int line=0;line<lines;++line){
  auto at=[&](int i)->int{ i=std::clamp(i,0,span-1);return vertical?i*g.cols+line:line*g.cols+i;};
  V sum={};for(int k=-radius;k<=radius;++k)sum=sum+in[at(k)];
  for(int i=0;i<span;++i){out[at(i)]=sum/float(radius*2+1);sum=sum-in[at(i-radius)]+in[at(i+radius+1)];}
 }
}
}

extern "C" {
const char* cu_error(){return g.error;}
int cu_init(const uint8_t* bytes,uint32_t size){
 g.error="";g.initialized=false;g.cached=false;
 if(!bytes||size<384){g.error="Optical asset header is missing";return -1;}
 const uint32_t* h=reinterpret_cast<const uint32_t*>(bytes);
 if(h[0]!=0x31575543||h[1]!=1||h[2]!=size||h[3]!=13){g.error="Unsupported optical asset format";return -1;}
 g.nimpact=h[4];g.nphase=h[5];g.ninverse=h[6];
 if(g.nimpact<32||g.nphase<32||g.ninverse<32){g.error="Invalid table dimensions";return -1;}
 const float* f=reinterpret_cast<const float*>(bytes+64);
 g.bc=f[0];g.epsilon=f[1];g.rmin=f[2];g.rmax=f[3];g.caplo=f[4];g.caphi=f[5];g.esclo=f[6];g.eschi=f[7];
 for(int i=0;i<13;++i){const uint32_t* d=h+32+i*4;
  uint64_t count=uint64_t(d[1])*d[2]*d[3];
  if(d[0]%4||d[0]<h[7]||!count||uint64_t(d[0])+count*4>size){g.error="Invalid table offset/shape";return -1;}
  g.a[i]={reinterpret_cast<const float*>(bytes+d[0]),int(d[1]),int(d[2]),int(d[3])};
 }
 if(g.a[0].h!=g.nimpact*2||g.a[1].h!=g.nimpact*2||g.a[1].w!=g.nphase||g.a[2].h!=g.nimpact*2||g.a[2].w!=g.ninverse||g.a[10].c!=2||g.a[11].w!=4||g.a[12].w!=3){g.error="Inconsistent optical asset arrays";return -1;}
 // The 2D radial/color arrays use h rows and w components, unlike charts.
 g.initialized=true;return 0;
}
int cu_frame(int cols,int rows,float px,float py,float pz,float yaw,float pitch,float fov,
             float time,float exposure,int bloom,int palette){
 double began=now_ms();g.error="";
 if(!g.initialized){g.error="Engine is not initialized";return -1;}
 V position={px,py,pz};float radius=length(position);
 if(cols<16||cols>320||rows<8||rows>160||!std::isfinite(radius)||radius<g.rmin-1e-4f||radius>g.rmax+1e-4f||
    !std::isfinite(yaw)||!std::isfinite(pitch)||!std::isfinite(fov)||fov<.05||fov>120||
    !std::isfinite(time)||std::abs(time)>1e9||!std::isfinite(exposure)||exposure<.05f||exposure>10||palette<0||palette>1){g.error="Frame parameters outside supported range";return -1;}
 float key[]={px,py,pz,yaw,pitch,fov};bool cached=g.cached&&g.cols==cols&&g.rows==rows&&!std::memcmp(key,g.key,sizeof(key));
 size_t n=size_t(cols)*rows;
 if(g.cols!=cols||g.rows!=rows){g.geo.resize(n);g.light.resize(n);g.emission.resize(n);g.glow.resize(n);g.temp.resize(n);g.blurred.resize(n);g.output.resize(n*7);g.mask.resize(n);g.objectMask.resize(n);g.material.resize(n);g.coverage.resize(n);}
 g.cols=cols;g.rows=rows;double phase=now_ms();
 float strength=g.environmentEnabled?g.lensStrength:1.f;
 if(!cached){geometry(cols,rows,position,yaw,pitch,fov);std::memcpy(g.key,key,sizeof(key));g.cached=true;}
 g.stats[1]=float(now_ms()-phase);phase=now_ms();
 for(size_t i=0;i<n;++i){const auto& cell=g.geo[i];V light={};float transmission=1;
  light=disk_light(cell,time,palette,strength,transmission);
  light=light*(1-g.filteredDisk);transmission=1-(1-transmission)*(1-g.filteredDisk);
  V transmittedSky=cell.sky*(transmission*(g.environmentEnabled?(cell.captured?1-strength*(1-g.filteredDisk):1):.7f));
  g.light[i]=cell.shadow&&strength>=1&&g.filteredDisk==0?V{}:light+transmittedSky;
  g.emission[i]=light;
  // A geometric disk crossing alone is insufficient to classify a character
  // as material: its faded emission must actually dominate the visible sky.
  float diskPeak=std::max({light.x,light.y,light.z});
  g.material[i]=diskPeak>.012f&&diskPeak>std::max({transmittedSky.x,transmittedSky.y,transmittedSky.z});
  // A lensed sky replaces the straight sky once. Partial coverage here would
  // retain an unbent duplicate behind the curved field and brighten it twice.
  g.coverage[i]=g.environmentEnabled||cell.captured?1:1-transmission;
  g.objectMask[i]=uint8_t(std::nearbyint(255*(cell.captured?strength*(1-g.filteredDisk):1-transmission)));
 }
 // A fixed angular quadrature conserves small-disk energy as it moves across
 // the character grid. Bilinear deposits prevent cell-boundary flicker.
 for(const auto& beam:g.beams){
  float transmission;V emission=disk_light(beam.geometry,time,palette,strength,transmission);
  float absorbed=beam.geometry.captured?strength:1-transmission;
  int ix=int(std::floor(beam.x)),iy=int(std::floor(beam.y));float fx=beam.x-ix,fy=beam.y-iy;
  for(int dy=0;dy<2;++dy)for(int dx=0;dx<2;++dx){
   int x=ix+dx,y=iy+dy;if(x<0||x>=cols||y<0||y>=rows)continue;
   size_t i=size_t(y)*cols+x;float weight=beam.area*g.filteredDisk*(dx?fx:1-fx)*(dy?fy:1-fy);
   V delta=(emission-g.geo[i].sky*absorbed)*weight;
   g.light[i]=g.light[i]+delta;
   g.emission[i]=g.emission[i]+emission*weight;
   g.light[i]={std::max(0.f,g.light[i].x),std::max(0.f,g.light[i].y),std::max(0.f,g.light[i].z)};
   if(std::max({emission.x,emission.y,emission.z})*weight>.001f)g.material[i]=1;
   g.coverage[i]=clip(g.coverage[i]+absorbed*weight,0,1);
   g.objectMask[i]=uint8_t(clip(g.objectMask[i]+255*absorbed*weight,0,255));
  }
 }
 // Continue the world's unresolved accretion light through the same position
 // while its resolved disk takes over. It is never an extra background field.
 if(g.pointFlux>0){
  float sy=std::sin(yaw),cy=std::cos(yaw),sp=std::sin(pitch),cp=std::cos(pitch);
  V forward={sy*cp,sp,cy*cp},right={-cy,0,sy},up={-sy*sp,cp,-cy*sp};
  float z=-dot(position,forward),ty=std::tan(fov*PI/360),tx=ty*cols/(rows*1.8f);
  if(z>0){float x=(-dot(position,right)/z/tx+1)*cols*.5f-.5f,y=(1+dot(position,up)/z/ty)*rows*.5f-.5f;
   int ix=int(std::floor(x)),iy=int(std::floor(y));float fx=x-ix,fy=y-iy;
   for(int dy=0;dy<2;++dy)for(int dx=0;dx<2;++dx){int xx=ix+dx,yy=iy+dy;if(xx<0||xx>=cols||yy<0||yy>=rows)continue;
    size_t i=size_t(yy)*cols+xx;float flux=g.pointFlux*(dx?fx:1-fx)*(dy?fy:1-fy);
    g.light[i]=g.light[i]+g.pointColor*flux;
    if(flux>.025f){g.coverage[i]=1;g.objectMask[i]=255;}}
  }
 }
 g.stats[2]=float(now_ms()-phase);phase=now_ms();std::fill(g.glow.begin(),g.glow.end(),V{});
 if(bloom&&g.environmentEnabled){
  // Preserve the atlas's compact star glow. Broad accretion halos must blur
  // disk emission alone: blurring the entire sky introduces a second veil of
  // light as the black-hole interpreter takes over.
  box(g.light,g.temp,2,false);box(g.temp,g.blurred,1,true);
  for(size_t i=0;i<n;++i)g.glow[i]=g.blurred[i]*.10f;
 }
 if(bloom){const int rx[]={2,6,14},ry[]={1,3,7};const float weights[]={.15f,.12f,.10f};
  for(int k=0;k<3;++k){box(g.environmentEnabled?g.emission:g.light,g.temp,rx[k],false);box(g.temp,g.blurred,ry[k],true);
   // The zero-strength environment uses the atlas's same compact sky bloom.
   // Wider disk halos grow continuously with the optical transfer.
   float weight=g.environmentEnabled?(k==0?.05f*strength:weights[k]*strength):weights[k];
   for(size_t i=0;i<n;++i)if(!g.geo[i].shadow||strength<1||g.filteredDisk>0)g.glow[i]=g.glow[i]+g.blurred[i]*weight;}
 }
 g.stats[3]=float(now_ms()-phase);
 uint8_t* glyph=g.output.data();uint8_t* fg=glyph+n;uint8_t* bg=fg+n*3;int ramp=int(std::strlen(GLYPHS))-1;
 for(size_t i=0;i<n;++i){
  V combined=g.light[i]+g.glow[i]*(g.environmentEnabled?.25f:.2f);float peak=std::max({combined.x,combined.y,combined.z});
  float brightness=1-std::exp(-peak*exposure*(g.environmentEnabled?1.f:.86f));int index=int(std::floor(std::pow(std::max(brightness,0.f),g.environmentEnabled?.65f:.64f)*ramp+.5f));
  uint8_t ch=brightness<(g.environmentEnabled?.011f:.009f)?' ':GLYPHS[std::clamp(index,0,ramp)];
  if(!g.environmentEnabled&&!g.geo[i].has_disk&&peak>.18f&&peak<1)ch=peak>.5f?'+':'*';
  if(g.environmentEnabled&&!g.material[i]){
   // Distant light remains a sparse star field in both renderers; only actual
   // surfaces and the disk use the dense material alphabet.
   if(brightness<.025f||std::max({g.light[i].x,g.light[i].y,g.light[i].z})<.012f)ch=' ';
   else if(brightness<.075f)ch='.';
   else if(brightness<.15f)ch=':';
   else if(brightness<.30f)ch='*';
   else if(brightness<.55f)ch='+';
   else ch='#';
  }
  bool blackShadow=g.geo[i].shadow&&strength>=1&&g.filteredDisk==0;
  if(blackShadow)ch=' ';glyph[i]=ch;
  float boost=(g.environmentEnabled?.20f+.80f*std::pow(std::max(brightness,0.f),.33f):.15f+.85f*std::pow(std::max(brightness,0.f),.37f))/std::max(peak,1e-12f);
  float cs[]={combined.x,combined.y,combined.z},gs[]={g.glow[i].x,g.glow[i].y,g.glow[i].z};
  for(int k=0;k<3;++k){fg[i*3+k]=(ch==' ')?0:g.environmentEnabled?uint8_t(clip(std::round(cs[k]*boost*255),0,255)):uint8_t(clip(std::nearbyint(cs[k]*boost*31),0,31)*(255.f/31));
   bg[i*3+k]=blackShadow?0:g.environmentEnabled?uint8_t(clip(std::round((1-std::exp(-gs[k]*exposure))*38),0,38)):uint8_t(clip(std::nearbyint((1-std::exp(-gs[k]*exposure*1.2f))*64/3),0,85)*3);}
  float halo=1-std::exp(-std::max({g.glow[i].x,g.glow[i].y,g.glow[i].z})*.7f);
  g.mask[i]=uint8_t(std::nearbyint(255*std::max(g.coverage[i],halo)));
 }
 g.stats[0]=float(now_ms()-began);g.stats[4]=g.shadows;g.stats[5]=g.disks;g.stats[6]=cached;g.stats[7]=g.camera_radius;
 g.stats[8]=g.environmentEnabled;g.stats[9]=g.environmentCells;g.stats[10]=g.capturedCells;g.stats[11]=strength;
 return 0;
}
uint8_t* cu_output(){return g.output.data();}
uint8_t* cu_mask(){return g.mask.data();}
uint8_t* cu_object_mask(){return g.objectMask.data();}
void cu_set_overlay(int enabled){if(g.overlay!=bool(enabled)){g.overlay=bool(enabled);g.cached=false;}}
int cu_set_point_source(float flux,float r,float green,float b){
 if(!std::isfinite(flux)||flux<0||flux>10||!std::isfinite(r)||!std::isfinite(green)||!std::isfinite(b)||r<0||green<0||b<0){g.error="Invalid unresolved source";return -1;}
 g.pointFlux=flux;g.pointColor={r,green,b};return 0;
}
int cu_set_lens_strength(float strength){
 g.error="";if(!std::isfinite(strength)||strength<0||strength>1){g.error="Lens strength must be between zero and one";return -1;}
 if(g.lensStrength!=strength){g.lensStrength=strength;if(g.environmentEnabled)g.cached=false;}return 0;
}
int cu_set_environment(const uint8_t* rgb,int width,int height,const double* params){
 g.error="";
 if(!rgb){if(g.environmentEnabled){g.environmentEnabled=false;g.cached=false;}g.environment={};return 0;}
 if(!params||width<2||height<2||width>8192||height>4096){g.error="Invalid galactic environment texture";return -1;}
 for(int i=0;i<3;++i)if(!std::isfinite(params[i])||std::abs(params[i])>1e15){g.error="Invalid galactic observer position";return -1;}
 bool changed=!g.environmentEnabled||g.environment.rgb!=rgb||g.environment.w!=width||g.environment.h!=height;
 for(int i=0;i<3;++i)changed=changed||g.environment.eye[i]!=params[i];
 g.environment.rgb=rgb;g.environment.w=width;g.environment.h=height;
 g.environment.points=nullptr;g.environment.pointCount=0;g.environment.indexReady=false;
 for(int i=0;i<3;++i)g.environment.eye[i]=params[i];
 galaxy::prepare(g.environment);
 g.environmentEnabled=true;if(changed)g.cached=false;return 0;
}
int cu_set_galaxy(const float* points,int count,const double* params){
 g.error="";
 if(!points||count==0){if(g.environmentEnabled)g.cached=false;g.environmentEnabled=false;g.environment={};return 0;}
 if(!params||count<0||count>1000000){g.error="Invalid finite Galactic point catalog";return -1;}
 for(int i=0;i<3;++i)if(!std::isfinite(params[i])||std::abs(params[i])>1e15){g.error="Invalid Galactic observer position";return -1;}
 bool changed=!g.environmentEnabled||g.environment.points!=points||g.environment.pointCount!=count;
 for(int i=0;i<3;++i)changed=changed||g.environment.eye[i]!=params[i];
 galaxy::set_points(g.environment,points,count,params);g.environmentEnabled=true;if(changed)g.cached=false;return 0;
}
float* cu_stats(){return g.stats;}
void cu_shutdown(){g=Engine{};}
}
