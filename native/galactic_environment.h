// Shared finite Galactic light sources for straight atlas and deflected rays.
// The 3-D catalog is an authored statistical model, not an observed star census.
// The legacy RGB sampler below is retained only for backwards-compatible tests.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>
namespace galaxy {
struct Color {float x=0,y=0,z=0;};
constexpr int tileSide=128,tileCount=6*tileSide*tileSide;
struct Point {float x,y,z,flux;Color color;};
struct Context {
 const uint8_t* rgb=nullptr;int w=0,h=0;double eye[3]={};double local[3]={};float density=1;bool prepared=false;
 const float* points=nullptr;int pointCount=0;float footprint=.01f,overviewGain=1;bool indexReady=false;
 std::vector<Point> directions;std::vector<uint32_t> tiles,next;
};
constexpr double pi=3.14159265358979323846;
// ICRS equatorial -> Galactic axes. The atlas's positions use these same ICRS axes.
constexpr double gx[3]={-.0548755604162154,-.8734370902348850,-.4838350155487132};
constexpr double gy[3]={ .4941094278755837,-.4448296299600112, .7469822444972180};
constexpr double gz[3]={-.8676661490190047,-.1980763734312015, .4559837761750669};
inline double axis(const double* a,double x,double y,double z){return a[0]*x+a[1]*y+a[2]*z;}
inline bool enabled(const Context& c){return (c.points&&c.pointCount>0)||(c.rgb&&c.w>1&&c.h>1);}
inline int tile(float u){return std::clamp(int((u+1)*.5f*tileSide),0,tileSide-1);}
inline void face(float x,float y,float z,int& f,float& u,float& v){
 float ax=std::abs(x),ay=std::abs(y),az=std::abs(z);
 if(ax>=ay&&ax>=az){f=x>=0?0:1;u=y/ax;v=z/ax;}
 else if(ay>=az){f=y>=0?2:3;u=x/ay;v=z/ay;}
 else{f=z>=0?4:5;u=x/az;v=y/az;}
}
inline void prepare_points(Context& c){
 // Explicit artistic overview exposure: the Solar neighborhood and interior
 // are unchanged. Only accumulated Galactic light brightens from outside the
 // disk, so unresolved populations remain readable in the character display.
 double ex=axis(gx,c.eye[0],c.eye[1],c.eye[2]),ey=axis(gy,c.eye[0],c.eye[1],c.eye[2]),ez=axis(gz,c.eye[0],c.eye[1],c.eye[2]);
 double q=std::sqrt((ex*ex+ey*ey)/(15000.*15000.)+ez*ez/(4000.*4000.));
 float fade=float(std::clamp((q-1.1)/1.4,0.,1.));c.overviewGain=1+31*fade*fade*(3-2*fade);
 c.directions.clear();c.directions.reserve(c.pointCount);c.next.clear();c.next.reserve(c.pointCount);c.tiles.assign(tileCount,UINT32_MAX);
 for(int i=0;i<c.pointCount;++i){const float* p=c.points+size_t(i)*8;
  double x=double(p[0])-c.eye[0],y=double(p[1])-c.eye[1],z=double(p[2])-c.eye[2],distance2=x*x+y*y+z*z;
  if(!std::isfinite(distance2)||distance2<1e-24||!std::isfinite(p[3])||p[3]<=0)continue;
  // L is an authored aggregate-light proxy, not solar luminosity. The finite
  // source softening is 0.025 pc; display clipping prevents singular closeups.
  float flux=float(std::min(double(p[3])/(distance2+.025*.025),8.));
  double inverse=1/std::sqrt(distance2);Point point={float(x*inverse),float(y*inverse),float(z*inverse),flux,{p[4]*flux,p[5]*flux,p[6]*flux}};
  int f;float u,v;face(point.x,point.y,point.z,f,u,v);int bucket=(f*tileSide+tile(v))*tileSide+tile(u);
  // Retain all positive contributors, including individually unresolved ones.
  // They must sum before display thresholding when viewing the whole galaxy.
  // A brightest-K cap would also pop as camera shifts changed tile membership.
  c.next.push_back(c.tiles[bucket]);c.tiles[bucket]=uint32_t(c.directions.size());c.directions.push_back(point);
 }
 c.indexReady=true;c.prepared=true;
}
inline void set_points(Context& c,const float* points,int count,const double* eye){
 if(!points||count<=0){c=Context{};return;}
 bool changed=c.points!=points||c.pointCount!=count||!c.indexReady;
 for(int i=0;i<3;++i)changed=changed||c.eye[i]!=eye[i];
 c.points=points;c.pointCount=count;c.rgb=nullptr;c.w=c.h=0;
 for(int i=0;i<3;++i)c.eye[i]=eye[i];
 if(changed)prepare_points(c);
}
inline void set_footprint(Context& c,float angle){c.footprint=std::clamp(angle,1e-6f,1.f);}
inline Color sample_points(const Context& c,float x,float y,float z){
 if(!c.indexReady)return {};
 // A compact angular point kernel is queried directly from the source index.
 // Tile contents are source IDs, never a rasterized or painted sky image.
 float radius=std::clamp(c.footprint*.75f,1e-6f,.6f),radius2=radius*radius;
 float threshold=.577350269f*(1-radius2*.5f)-.816496581f*radius;
 Color sum={};
 for(int f=0;f<6;++f){float a=f<2?x:f<4?y:z,d=(f&1)?-a:a;if(d<threshold||d<=0)continue;
  float u=(f<2?y:x)/d,v=(f<4?z:y)/d;
  float du=radius*(1+std::abs(u))/std::max(d-radius,.02f),dv=radius*(1+std::abs(v))/std::max(d-radius,.02f);
  if(u+du<-1||u-du>1||v+dv<-1||v-dv>1)continue;
  int loX=tile(u-du),hiX=tile(u+du),loY=tile(v-dv),hiY=tile(v+dv);
  for(int yy=loY;yy<=hiY;++yy)for(int xx=loX;xx<=hiX;++xx){int bucket=(f*tileSide+yy)*tileSide+xx;
   for(uint32_t k=c.tiles[bucket];k!=UINT32_MAX;k=c.next[k]){const Point& p=c.directions[k];float dx=p.x-x,dy=p.y-y,dz=p.z-z;
    float squared=dx*dx+dy*dy+dz*dz;if(squared>=radius2)continue;float weight=1-squared/radius2;weight*=weight;
    sum.x+=p.color.x*weight;sum.y+=p.color.y*weight;sum.z+=p.color.z*weight;
   }
  }
 }
 return {sum.x*c.overviewGain,sum.y*c.overviewGain,sum.z*c.overviewGain};
}
inline void prepare(Context& c){
 if(c.points){prepare_points(c);return;}
 for(int i=0;i<3;++i)c.local[i]=axis(i==0?gx:i==1?gy:gz,c.eye[0],c.eye[1],c.eye[2]);
 double distance=std::sqrt(c.local[0]*c.local[0]+c.local[1]*c.local[1]+c.local[2]*c.local[2]);
 c.density=float(.80+.85*std::exp(-distance/1600)+.60*std::exp(-distance/24));c.prepared=true;
}
inline Color pixel(const Context& c,int x,int y){const uint8_t* p=c.rgb+(size_t(y)*c.w+x)*3;return {p[0]*(4.f/255),p[1]*(4.f/255),p[2]*(4.f/255)};}
inline Color lerp(Color a,Color b,float t){return {a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t};}
inline Color chart(const Context& c,double u,double v){
 u-=std::floor(u);double x=u*c.w-.5,y=std::clamp(v,0.,1.)*(c.h-1);int ix=int(std::floor(x)),iy=int(y),x0=(ix+c.w)%c.w,x1=(x0+1)%c.w,y1=std::min(iy+1,c.h-1);
 return lerp(lerp(pixel(c,x0,iy),pixel(c,x1,iy),float(x-ix)),lerp(pixel(c,x0,y1),pixel(c,x1,y1),float(x-ix)),float(y-iy));
}
// Analytic half-ray column through an ellipsoidal Gaussian. No volume marching.
// It grows in angular extent during approach and surrounds the observer inside.
inline double column(double ex,double ey,double ez,double dx,double dy,double dz,double radial,double height){
 ex/=radial;ey/=radial;ez/=height;dx/=radial;dy/=radial;dz/=height;
 double a=dx*dx+dy*dy+dz*dz,b=ex*dx+ey*dy+ez*dz,c=ex*ex+ey*ey+ez*ez;
 double perpendicular=std::max(0.,c-b*b/a);if(perpendicular>30)return 0;
 return .5*std::exp(-.5*perpendicular)*std::erfc(b/std::sqrt(2*a))/(std::sqrt(a)*radial);
}
inline Color sample(const Context& c,float x,float y,float z){
 if(c.points)return sample_points(c,x,y,z);
 if(!c.rgb||c.w<2||c.h<2)return {};
 double dx=axis(gx,x,y,z),dy=axis(gy,x,y,z),dz=axis(gz,x,y,z);
 double u=std::atan2(dy,dx)/(2*pi)+.5,v=.5-std::asin(std::clamp(dz,-1.,1.))/pi;
 Color sky=chart(c,u,v);
 double ex=c.prepared?c.local[0]:axis(gx,c.eye[0],c.eye[1],c.eye[2]),ey=c.prepared?c.local[1]:axis(gy,c.eye[0],c.eye[1],c.eye[2]),ez=c.prepared?c.local[2]:axis(gz,c.eye[0],c.eye[1],c.eye[2]);
 double distance=std::sqrt(ex*ex+ey*ey+ez*ez);
 float density=c.prepared?c.density:float(.80+.85*std::exp(-distance/1600)+.60*std::exp(-distance/24));
 double bulge=0,nuclear=0;
 if(distance>.05&&distance<100000){bulge=column(ex,ey,ez,dx,dy,dz,680,320);nuclear=column(ex,ey,ez,dx,dy,dz,14,8);}
 // The background must remain a field of points, not a carpet of luminous
 // characters. Reject diffuse texels; brighten actual angular features in
 // the projected core. The same transfer is used before and after lensing.
 float peak=std::max({sky.x,sky.y,sky.z});
 float central=float(bulge*std::min(1.,distance*distance/(650*650))+nuclear*std::min(1.,distance*distance/(14*14)));
 float cutoff=.16f/(1+.7f*central);
 float gain=std::max(peak-cutoff,0.f)/std::max(peak,1e-12f)*density*.75f*(1+central*1.3f);
 return {sky.x*gain,sky.y*gain,sky.z*gain};
}
}
