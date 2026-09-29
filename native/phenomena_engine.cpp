// Direct-character illustrative close-ups of real astrophysical phenomena.
// Analytic surfaces and compiled 3-D emission fields are queried at cell rays;
// this module never creates a pixel framebuffer, image render, or ODE solution.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif
namespace {
constexpr double PI=3.14159265358979323846;
struct D{double x=0,y=0,z=0;};
D operator+(D a,D b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
D operator-(D a,D b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
D operator*(D a,double b){return {a.x*b,a.y*b,a.z*b};}
double dot(D a,D b){return a.x*b.x+a.y*b.y+a.z*b.z;}
D cross(D a,D b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
double length(D a){return std::sqrt(dot(a,a));}
D unit(D a){return a*(1/std::max(length(a),1e-20));}
D rotate(D p,double angle){double c=std::cos(angle),s=std::sin(angle);return {c*p.x+s*p.z,p.y,-s*p.x+c*p.z};}
struct V{float x=0,y=0,z=0;};
V operator+(V a,V b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
V operator*(V a,float s){return {a.x*s,a.y*s,a.z*s};}
V mix(V a,V b,float f){return a*(1-f)+b*f;}
float peak(V a){return std::max({a.x,a.y,a.z});}
template<class T>T clamp(T v,T a,T b){return std::max(a,std::min(v,b));}
double now(){
#ifdef __EMSCRIPTEN__
return emscripten_get_now();
#else
return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
#endif
}
float hash(int x,int y,int z,int salt=0){uint32_t h=uint32_t(x)*374761393u+uint32_t(y)*668265263u+uint32_t(z)*2246822519u+uint32_t(salt);h=(h^(h>>13))*1274126177u;h^=h>>16;return (h&0xffffffu)/16777215.f;}
float cells(D p){
 int ix=int(std::floor(p.x)),iy=int(std::floor(p.y)),iz=int(std::floor(p.z));double a=1e20,b=1e20;
 for(int z=-1;z<=1;++z)for(int y=-1;y<=1;++y)for(int x=-1;x<=1;++x){int xx=ix+x,yy=iy+y,zz=iz+z;
  D c={xx+.16+.68*hash(xx,yy,zz),yy+.16+.68*hash(xx,yy,zz,82371),zz+.16+.68*hash(xx,yy,zz,182771)};D delta=c-p;double r=dot(delta,delta);
  if(r<a){b=a;a=r;}else b=std::min(b,r);
 }float f=float(clamp((std::sqrt(b)-std::sqrt(a))/.29,0.,1.));return f*f*(3-2*f);
}
struct State{
 const uint8_t* fields=nullptr;int dim=0;const char* error="";
 int cols=0,rows=0,scene=0;D camera,forward,right,up,magnetic;double tanx=0,tany=0,time=0,exposure=1,orbit=0;
 std::vector<V> light,temp,glow;std::vector<double> depth;std::vector<float> transmission;
 std::vector<uint8_t> material,output,mask;float chart[2][128*64]={};uint8_t occupancy[2][8*8*8]={};
 bool freeCamera=false,unified=false;D freePosition;double freeFov=54;
 D sky[160];float stats[4]={};
} g;
float chart(int kind,double u,double v){
 u-=std::floor(u);double x=u*128,y=clamp(v,0.,1.)*63;int ix=int(x),iy=int(y);float fx=float(x-ix),fy=float(y-iy);const float* data=g.chart[kind];
 auto row=[&](int yy){return data[yy*128+ix]*(1-fx)+data[yy*128+(ix+1)%128]*fx;};return row(iy)*(1-fy)+row(std::min(iy+1,63))*fy;
}
bool sphere(D origin,D ray,D center,double radius,double& near,double& far){D p=origin-center;double b=dot(p,ray),disc=radius*radius-dot(cross(p,ray),cross(p,ray));if(disc<0)return false;double root=std::sqrt(disc);near=-b-root;far=-b+root;return far>0;}
bool ellipsoid(D origin,D ray,D center,D radii,double& distance,D& normal){
 D p=origin-center,c={p.x/radii.x,p.y/radii.y,p.z/radii.z},d={ray.x/radii.x,ray.y/radii.y,ray.z/radii.z};
 double a=dot(d,d),b=dot(c,d),disc=a-dot(cross(c,d),cross(c,d));if(disc<0)return false;
 double root=std::sqrt(disc),near=(-b-root)/a,far=(-b+root)/a;distance=near>0?near:far;if(distance<=0)return false;
 D point=p+ray*distance;normal=unit({point.x/(radii.x*radii.x),point.y/(radii.y*radii.y),point.z/(radii.z*radii.z)});return true;
}
D ray_at(int x,int y){return unit(g.forward+g.right*(((x+.5)/g.cols*2-1)*g.tanx)+g.up*((1-(y+.5)/g.rows*2)*g.tany));}
void add(int x,int y,V color,double distance){if(x<0||y<0||x>=g.cols||y>=g.rows)return;size_t i=size_t(y)*g.cols+x;if(distance>=g.depth[i])return;g.light[i]=g.light[i]+color*g.transmission[i];}
void point(D world,V color,float intensity=1,bool flare=false){D p=world-g.camera;double z=dot(p,g.forward);if(z<=0)return;
 double xx=dot(p,g.right)/z/g.tanx,yy=dot(p,g.up)/z/g.tany;if(std::abs(xx)>1.1||std::abs(yy)>1.1)return;
 float x=float((xx+1)*.5*g.cols-.5),y=float((1-yy)*.5*g.rows-.5),fx=x-std::floor(x),fy=y-std::floor(y);int ix=int(std::floor(x)),iy=int(std::floor(y));double distance=length(p);color=color*intensity;
 add(ix,iy,color*((1-fx)*(1-fy)),distance);add(ix+1,iy,color*(fx*(1-fy)),distance);add(ix,iy+1,color*((1-fx)*fy),distance);add(ix+1,iy+1,color*(fx*fy),distance);
 if(flare)for(int k=1;k<=4;++k){add(int(std::round(x))+k,int(std::round(y)),color*(.04f/(k*k)),distance);add(int(std::round(x))-k,int(std::round(y)),color*(.04f/(k*k)),distance);if(k<=2){add(int(std::round(x)),int(std::round(y))+k,color*(.028f/(k*k)),distance);add(int(std::round(x)),int(std::round(y))-k,color*(.028f/(k*k)),distance);}}
}
V star_surface(D normal,D ray,int kind,int which){
 double u=std::atan2(normal.z,normal.x)/(2*PI)+.5+g.time*(kind==1?.0013:.008)+which*.27;
 double v=.5-std::asin(clamp(normal.y,-1.,1.))/PI;
 float mu=float(std::max(-dot(normal,ray),0.));float fine=chart(0,u+.008*std::sin(g.time*.19+v*11),v);
 if(kind==1){float a=chart(1,u+.008*std::sin(g.time*.035+v*6),v),b=chart(1,u+.22-g.time*.0004,clamp(v+.015*std::sin(g.time*.12),0.,1.));
  float c=.78f*a+.22f*b,hot=clamp((c-.42f)*2.8f,0.f,1.f);V color=mix(V{.96f,.16f,.022f},V{1,.74f,.32f},hot);
  float brightness=(.28f+.72f*std::pow(mu,.4f))*(.22f+2.8f*c*c)*(.72f+.32f*fine);return color*brightness;
 }
 float brightness=(.32f+.68f*std::pow(mu,.45f))*(.68f+.68f*fine);return mix(V{.24f,.52f,1},V{.76f,.94f,1},fine)*brightness;
}
void stellar_cell(size_t i,D ray){
 D origin=rotate(g.camera,-g.orbit),direction=rotate(ray,-g.orbit);double nearest=1e30;V color={};bool hit=false;
 int count=g.scene==0?2:1;
 for(int k=0;k<count;++k){D center=g.scene==0?D{k==0?-.82:.82,0,0}:D{};D radii=g.scene==0?(k==0?D{.91,.77,.78}:D{.88,.75,.76}):D{1.17,1.13,1.15};double t;D normal;
  if(ellipsoid(origin,direction,center,radii,t,normal)&&t<nearest){nearest=t;hit=true;color=star_surface(normal,direction,g.scene==1?1:0,k);
   if(g.scene==0){float facing=float(k==0?normal.x:-normal.x);float neck=std::max(facing,0.f);color=color+V{.20f,.37f,.50f}*(neck*neck*.25f);}
  }
 }
 if(hit){g.light[i]=color;g.depth[i]=nearest;g.material[i]=1;return;}
 for(int k=0;k<count;++k){D center=g.scene==0?D{k==0?-.82:.82,0,0}:D{},relative=center-origin;double along=dot(relative,direction);if(along<=0)continue;D perpendicular=relative-direction*along;double radius=g.scene==0?.82:1.15,ratio=length(perpendicular)/radius;
  if(ratio<1||ratio>2.05)continue;double angle=std::atan2(perpendicular.y,perpendicular.x);float halo;
  if(g.scene==1){double plume=std::pow(std::max(std::cos(angle*3+g.time*.027),0.),10);halo=float(std::exp(-(ratio-1)*7)*.13+std::exp(-(ratio-1)*4.5)*plume*(.12+.045*std::sin(g.time*.13)));g.light[i]=g.light[i]+V{1,.22f,.028f}*halo;}
  else {halo=float(std::exp(-(ratio-1)*13)*.13);g.light[i]=g.light[i]+V{.21f,.48f,1}*halo;}
 }
}
bool cube(D origin,D ray,double& near,double& far){near=0;far=1e30;double o[]={origin.x,origin.y,origin.z},d[]={ray.x,ray.y,ray.z};
 for(int k=0;k<3;++k){if(std::abs(d[k])<1e-12){if(o[k]<-2||o[k]>2)return false;continue;}double a=(-2-o[k])/d[k],b=(2-o[k])/d[k];if(a>b)std::swap(a,b);near=std::max(near,a);far=std::min(far,b);}return far>near;
}
V field(int which,D p,float& density){
 double x=clamp((p.x+2)*.25*(g.dim-1),0.,double(g.dim-1)),y=clamp((p.y+2)*.25*(g.dim-1),0.,double(g.dim-1)),z=clamp((p.z+2)*.25*(g.dim-1),0.,double(g.dim-1));
 int ix=int(x),iy=int(y),iz=int(z),ox=std::min(ix+1,g.dim-1),oy=std::min(iy+1,g.dim-1),oz=std::min(iz+1,g.dim-1);float fx=float(x-ix),fy=float(y-iy),fz=float(z-iz);float out[4]={};
 const uint8_t* base=g.fields+size_t(which)*g.dim*g.dim*g.dim*4;
 for(int zz=0;zz<2;++zz)for(int yy=0;yy<2;++yy)for(int xx=0;xx<2;++xx){const uint8_t* v=base+((size_t(zz?oz:iz)*g.dim+(yy?oy:iy))*g.dim+(xx?ox:ix))*4;float w=(xx?fx:1-fx)*(yy?fy:1-fy)*(zz?fz:1-fz)/255.f;for(int k=0;k<4;++k)out[k]+=v[k]*w;}
 density=out[3];g.stats[1]+=1;return {out[0],out[1],out[2]};
}
void volume_cell(size_t i,D ray,int which,int x,int y){
 double near,far;if(!cube(g.camera,ray,near,far))return;
 constexpr int samples=28;double step=(far-near)/samples;float trans=1;V sum={};
 // Static cell jitter removes regular slice bands without temporal sparkle.
 double jitter=.25+.5*hash(x,y,41);
 for(int k=0;k<samples;++k){D p=g.camera+ray*(near+(k+jitter)*step);int bx=clamp(int((p.x+2)*2),0,7),by=clamp(int((p.y+2)*2),0,7),bz=clamp(int((p.z+2)*2),0,7);
  if(g.occupancy[which][(bz*8+by)*8+bx]<3)continue;float density;V color=field(which,p,density);if(density<.005f)continue;
  float opacity=float(1-std::exp(-density*step*(which==0?2.8:2.1)));float emission=which==0?2.45f:2.2f;
  sum=sum+color*(opacity*trans*emission);trans*=1-opacity*.68f;if(trans<.025f)break;
 }
 g.light[i]=sum;g.transmission[i]=trans;g.material[i]=peak(sum)>.014f?2:0;
}
void jets(size_t i,D ray,D axis,bool pulsar){
 double near,far;if(!sphere(g.camera,ray,{},3.5,near,far))return;near=std::max(near,0.);far=std::min(far,g.depth[i]);if(far<=near)return;
 // Gaussian cross-section has an analytic line integral. Evaluating its axial
 // envelope at the closest point avoids missed thin jet bases between slices.
 // The widening/knotted envelope is an illustrative local approximation.
 double da=dot(ray,axis),oa=dot(g.camera,axis),a=std::max(1-da*da,1e-5);
 double t=clamp(-(dot(g.camera,ray)-oa*da)/a,near,far);D p=g.camera+ray*t;
 double h=dot(p,axis),height=std::abs(h);if(height>3.4)return;
 D perpendicular=p-axis*h;double width=pulsar?.075+.145*height:.035+.095*height;
 double ratio=dot(perpendicular,perpendicular)/(width*width);if(ratio>9)return;
 double sigma=width/std::sqrt(1.7*a),span=std::min(std::sqrt(PI)*sigma,far-near);
 double cutoff=.5*(std::erf((far-t)/std::max(sigma,1e-8))-std::erf((near-t)/std::max(sigma,1e-8)));
 float density=float(std::exp(-ratio*1.7)*std::pow(std::max(1-height/3.4,0.),.55));
 float knots=pulsar?1:.55f+.45f*float(std::pow(.5+.5*std::sin(height*8-g.time*.8),4));
 float pulse=pulsar?float(.70+.30*std::pow(.5+.5*std::sin(g.time*.62),3)):float(h>0?1:.24);
 V sum=mix(V{.12f,.35f,1},V{.60f,.95f,1},float(std::exp(-ratio*3)))*(density*float(span*cutoff)*(pulsar?3.1f:5.7f)*pulse*knots);
 g.light[i]=g.light[i]+sum;if(peak(sum)>.022f)g.material[i]=2;
}
void compact_cell(size_t i,D ray){
 double near,far;double radius=g.scene==4?.28:.37;
 if(sphere(g.camera,ray,{},radius,near,far)){double t=near>0?near:far;D normal=unit(g.camera+ray*t);g.depth[i]=t;g.material[i]=1;
  if(g.scene==4){float mu=float(std::max(-dot(normal,ray),0.));double hot=std::pow(std::abs(dot(normal,g.magnetic)),9);g.light[i]=mix(V{.22f,.50f,1},V{.82f,.95f,1},float(hot))*(1.1f+.6f*mu);}
  else g.light[i]={};
 }
 if(g.scene==5&&std::abs(ray.y)>1e-9){double t=-g.camera.y/ray.y;if(t>0&&t<g.depth[i]){D p=g.camera+ray*t;double r=std::sqrt(p.x*p.x+p.z*p.z);
   if(r>.43&&r<1.78){double a=std::atan2(p.z,p.x),u=a/(2*PI)+g.time*.035/std::pow(r,.8);float grain=chart(0,u,r*.47),spiral=float(.5+.5*std::sin(a*3+std::log(r)*17-g.time*.7));
    float heat=float(clamp((1.7-r)/1.3,0.,1.));V color=mix(V{.92f,.17f,.025f},V{1,.89f,.62f},std::pow(heat,.6f));
    D motion={-p.z/r,0,p.x/r};float beaming=float(.86+.26*dot(motion,unit(g.camera-p)));float emission=(.28f+2.2f*heat*heat)*(.61f+.30f*grain+.20f*spiral)*beaming;
    g.light[i]=color*emission;g.depth[i]=t;g.material[i]=1;
   }
  }}
 jets(i,ray,g.scene==4?g.magnetic:D{0,1,0},g.scene==4);
}
void scene_points(){
 // A sparse, explicitly decorative background is never a catalog or map.
 if(!g.unified)for(int k=0;k<160;++k){float brightness=.07f+.23f*hash(k,1,3);point(g.sky[k]*45,mix(V{.52f,.69f,1},V{1,.75f,.43f},hash(k,2,3)),brightness);}
 if(g.scene==0){
  // Shared-envelope rim follows a stable orbital cycle. No merger/inspiral.
  for(int k=0;k<84;++k){double a=k*2*PI/84;D p={0,.31*std::cos(a),.32*std::sin(a)};float moving=float(.55+.45*std::sin(a*5-g.time*1.3));point(rotate(p,g.orbit),{.37f,.68f,1},.12f+.08f*moving);}
 }else if(g.scene==1){
  for(int loop=0;loop<5;++loop){double longitude=loop*2*PI/5+.25,latitude=.18+.40*std::sin(loop*1.9);D anchor={std::cos(latitude)*std::cos(longitude),std::sin(latitude),std::cos(latitude)*std::sin(longitude)};
   D tangent=unit(cross(anchor,{0,1,0}));double phase=.5+.5*std::sin(g.time*.065+loop*1.3),height=.13+.42*phase;
   for(int k=0;k<52;++k){double a=k*PI/51;D p=anchor*(1.14+height*std::sin(a))+tangent*(.22*std::cos(a));float flow=float(.22+.78*std::pow(.5+.5*std::sin(a*5-g.time*.48-loop),2));point(p,mix(V{1,.16f,.015f},V{1,.54f,.11f},flow),(.035f+.11f*flow)*float(std::sin(a)));}
  }
 }else if(g.scene==2){point({0,0,0},{.30f,.76f,1},3.3f,true);}
 else if(g.scene==3){D cluster[]={{-.12,-.05,.04},{.10,.04,.08},{-.035,.16,-.02},{.21,-.13,.035}};for(int k=0;k<4;++k)point(cluster[k],k==2?V{1,.70f,.37f}:V{.46f,.70f,1},1.8f+k*.3f,true);
  for(int k=0;k<28;++k){D p={(hash(k,3,8)-.5)*2.8,(hash(k,7,8)-.5)*2.8,(hash(k,9,8)-.5)*2.0};point(p,{1,.64f,.35f},.15f+.45f*hash(k,12,8));}
 }else if(g.scene==4){
  D axis=g.magnetic,ex=unit(cross(axis,std::abs(axis.y)<.9?D{0,1,0}:D{1,0,0})),ey=cross(axis,ex);
  for(int loop=0;loop<9;++loop){double phi=loop*2*PI/9;D outward=ex*std::cos(phi)+ey*std::sin(phi);
   for(int k=0;k<44;++k){double a=.17+(PI-.34)*k/43,r=.95*std::sin(a)*std::sin(a);D p=axis*(r*std::cos(a))+outward*(r*std::sin(a));point(p,{.20f,.28f,1},.023f);}
  }
 }
}
void encode(){
 for(int y=0;y<g.rows;++y)for(int x=0;x<g.cols;++x){V sum={};for(int k=-2;k<=2;++k)sum=sum+g.light[y*g.cols+clamp(x+k,0,g.cols-1)];g.temp[y*g.cols+x]=sum*.2f;}
 for(int y=0;y<g.rows;++y)for(int x=0;x<g.cols;++x){V sum={};for(int k=-1;k<=1;++k)sum=sum+g.temp[clamp(y+k,0,g.rows-1)*g.cols+x];g.glow[y*g.cols+x]=sum*(.18f/3);}
 const char* ramp=" .,:;!i~+*rnxzjftLCJUYXZO0Qmwqpdbkhao#MW&8%B@$";int last=int(std::strlen(ramp))-1;size_t n=size_t(g.cols)*g.rows;uint8_t* glyph=g.output.data();uint8_t* fg=glyph+n;uint8_t* bg=fg+n*3;
 for(size_t i=0;i<n;++i){V color=g.light[i]+g.glow[i]*.3f;float p=peak(color),b=1-std::exp(-p*float(g.exposure));int c=clamp(int(std::pow(std::max(b,0.f),.70f)*last+.5f),0,last);uint8_t symbol=b<.012f?' ':ramp[c];
  if(!g.material[i]){if(b<.025f||peak(g.light[i])<.012f)symbol=' ';else if(b<.10f)symbol='.';else if(b<.22f)symbol=':';else if(b<.45f)symbol='*';else symbol='+';}
  glyph[i]=symbol;float s=(.17f+.83f*std::pow(std::max(b,0.f),.34f))/std::max(p,1e-20f);float rgb[]={color.x,color.y,color.z},blur[]={g.glow[i].x,g.glow[i].y,g.glow[i].z};
  for(int k=0;k<3;++k){fg[i*3+k]=symbol==' '?0:uint8_t(clamp(std::round(rgb[k]*s*255),0.f,255.f));bg[i*3+k]=uint8_t(clamp(std::round((1-std::exp(-blur[k]*float(g.exposure)))*58),0.f,58.f));}
  float coverage=std::isfinite(g.depth[i])?1.f:g.material[i]==2?clamp((1-g.transmission[i])*1.7f+b*.65f,0.f,1.f):std::pow(b,.65f);
  if(symbol==' '&&!std::isfinite(g.depth[i]))coverage=clamp(peak(g.glow[i])*.6f,0.f,.4f);
  g.mask[i]=uint8_t(clamp(std::round(coverage*255),0.f,255.f));
 }
}
}
extern "C" {
const char* phenomena_error(){return g.error;}
int phenomena_init(const uint8_t* asset,uint32_t bytes){
 g.error="";if(!asset||bytes<32){g.error="Missing compiled phenomenon fields";return -1;}const uint32_t* h=reinterpret_cast<const uint32_t*>(asset);
 if(h[0]!=0x48505543||h[1]!=1||h[2]!=64||h[3]!=2||h[4]!=32||h[5]!=bytes||bytes!=32+2*64*64*64*4){g.error="Invalid CUPH field pack";return -1;}
 g.fields=asset+32;g.dim=64;std::memset(g.occupancy,0,sizeof(g.occupancy));
 for(int f=0;f<2;++f)for(int z=0;z<64;++z)for(int y=0;y<64;++y)for(int x=0;x<64;++x){uint8_t density=g.fields[((size_t(f)*64+z)*64*64+y*64+x)*4+3];
  // Neighbor dilation makes the coarse skip conservative for interpolation.
  for(int dz=-1;dz<=1;++dz)for(int dy=-1;dy<=1;++dy)for(int dx=-1;dx<=1;++dx){int bx=clamp((x+dx)/8,0,7),by=clamp((y+dy)/8,0,7),bz=clamp((z+dz)/8,0,7);auto& entry=g.occupancy[f][(bz*8+by)*8+bx];entry=std::max(entry,density);}
 }
 for(int y=0;y<64;++y)for(int x=0;x<128;++x){double a=x*2*PI/128,lat=PI/2-y*PI/63;D p={std::cos(lat)*std::cos(a),std::sin(lat),std::cos(lat)*std::sin(a)};g.chart[0][y*128+x]=.10f+.68f*cells(p*18)+.22f*cells(p*8);g.chart[1][y*128+x]=.08f+.72f*cells(p*2.7)+.20f*cells(p*5);}
 for(int i=0;i<160;++i){double z=hash(i,3,17)*2-1,a=hash(i,7,19)*2*PI;g.sky[i]={std::sqrt(1-z*z)*std::cos(a),z,std::sqrt(1-z*z)*std::sin(a)};}
 return 0;
}
int phenomena_frame(int cols,int rows,int scene,double yaw,double pitch,double distance,double time,double exposure){
 double start=now();g.error="";
 if(!g.fields){g.error="Phenomena engine is not initialized";return -1;}
 if(cols<16||cols>320||rows<8||rows>160||scene<0||scene>5||!std::isfinite(yaw)||!std::isfinite(pitch)||!std::isfinite(distance)||distance<.5||distance>100||!std::isfinite(time)||std::abs(time)>1e10||!std::isfinite(exposure)||exposure<.05||exposure>10){g.error="Invalid phenomenon camera or display parameters";return -1;}
 g.cols=cols;g.rows=rows;g.scene=scene;g.time=time;g.exposure=exposure;g.orbit=scene==0?time*.13:0;g.unified=g.freeCamera;
 if(g.freeCamera){g.camera=g.freePosition;double sy=std::sin(yaw),cy=std::cos(yaw),sp=std::sin(pitch),cp=std::cos(pitch);g.forward={sy*cp,sp,cy*cp};g.right={-cy,0,sy};g.up={-sy*sp,cp,-cy*sp};}
 else {g.camera={distance*std::sin(yaw)*std::cos(pitch),distance*std::sin(pitch),distance*std::cos(yaw)*std::cos(pitch)};g.forward=unit(g.camera*-1);g.right=unit({std::cos(yaw),0,-std::sin(yaw)});g.up=cross(g.right,g.forward);}
 g.tany=std::tan((g.freeCamera?g.freeFov:54)*PI/360);g.tanx=g.tany*cols/(rows*1.8);
 g.magnetic=unit({std::sin(.60)*std::cos(time*.62),std::cos(.60),std::sin(.60)*std::sin(time*.62)});
 size_t n=size_t(cols)*rows;g.light.assign(n,V{});g.depth.assign(n,std::numeric_limits<double>::infinity());g.transmission.assign(n,1);g.material.assign(n,0);g.temp.resize(n);g.glow.resize(n);g.output.resize(n*7);g.mask.resize(n);g.stats[1]=0;
 for(int y=0;y<rows;++y)for(int x=0;x<cols;++x){size_t i=size_t(y)*cols+x;D ray=ray_at(x,y);if(scene<=1)stellar_cell(i,ray);else if(scene<=3)volume_cell(i,ray,scene-2,x,y);else compact_cell(i,ray);}
 scene_points();encode();g.stats[0]=float(now()-start);g.stats[2]=float(n);g.stats[3]=float(scene);return 0;
}
int phenomena_frame_camera(int cols,int rows,int scene,double px,double py,double pz,double yaw,double pitch,double fov,double time,double exposure){
 if(!std::isfinite(px)||!std::isfinite(py)||!std::isfinite(pz)||std::max({std::abs(px),std::abs(py),std::abs(pz)})>1e12||!std::isfinite(fov)||fov<.05||fov>120){g.error="Invalid local phenomenon camera";return -1;}
 g.freeCamera=true;g.freePosition={px,py,pz};g.freeFov=fov;int result=phenomena_frame(cols,rows,scene,yaw,pitch,5,time,exposure);g.freeCamera=false;return result;
}
uint8_t* phenomena_output(){return g.output.data();}
uint8_t* phenomena_mask(){return g.mask.data();}
float* phenomena_stats(){return g.stats;}
void phenomena_shutdown(){g=State{};}
}
