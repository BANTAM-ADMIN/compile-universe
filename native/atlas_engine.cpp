// Direct-character stellar atlas. Double-precision heliocentric parsecs enter
// the visibility query; no world position is reduced to float before subtraction.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <vector>
#include "galactic_environment.h"
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif
namespace {
constexpr double PI=3.14159265358979323846;
constexpr const char* RAMP=" .,:;!i~+*rnxzjftLCJUYXZO0Qmwqpdbkhao#MW&8%B@$";
// Approximate ink coverage in the display's default monospace face, ordered by
// actual density. The legacy alphabet has large reversals (i -> ~, + -> *):
// on a smooth ocean those become bright/dark rings even with spatial rounding.
constexpr char PLANET_RAMP[]=" .,:~;*!+rLtJixYzjnfoCk#XahZwUdqOb0p8m&%MBWQ$@";
constexpr float PLANET_INK[]={0,19.18f,34.79f,37.75f,42.81f,53.7f,58.38f,59,75.61f,80.1f,
 100.71f,103.17f,108.98f,109.56f,112.25f,112.91f,113.6f,123.64f,124.82f,125.12f,
 131.19f,135.12f,136.26f,140.25f,141.68f,141.76f,145.71f,149.24f,157.19f,158.08f,
 159.93f,163.51f,163.95f,165.54f,167.14f,169.22f,170.46f,170.89f,177.53f,180.4f,
 188.27f,189.39f,194.87f,198.78f,200.97f,238.21f};
static_assert(sizeof(PLANET_RAMP)-1==sizeof(PLANET_INK)/sizeof(float),"Planet ink ramp");
uint8_t planet_glyph(float brightness,size_t cell,int cols){
 if(brightness<.011f)return ' ';
 constexpr int last=sizeof(PLANET_RAMP)-2;
 const float ink=std::sqrt(brightness)*PLANET_INK[last];
 int upper=int(std::lower_bound(PLANET_INK,PLANET_INK+last,ink)-PLANET_INK);
 if(!upper)return PLANET_RAMP[0];
 const float fraction=(ink-PLANET_INK[upper-1])/(PLANET_INK[upper]-PLANET_INK[upper-1]);
 // Interleaved spatial thresholds never depend on time. They mix neighboring
 // densities without turning a frozen world into animated grain.
 double phase=.06711056*double(cell%cols)+.00583715*double(cell/cols);
 double threshold=52.9829189*(phase-std::floor(phase));threshold-=std::floor(threshold);
 return PLANET_RAMP[upper-(fraction<=threshold)];
}
struct D {double x=0,y=0,z=0;};
D operator+(D a,D b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
D operator-(D a,D b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
D operator*(D a,double b){return {a.x*b,a.y*b,a.z*b};}
D operator/(D a,double b){return a*(1/b);}
double dot(D a,D b){return a.x*b.x+a.y*b.y+a.z*b.z;}
double norm(D a){return std::sqrt(dot(a,a));}
D unit(D a){return a/std::max(norm(a),1e-300);}
D cross(D a,D b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
struct V {float x=0,y=0,z=0;};
V operator+(V a,V b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
V operator-(V a,V b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
V operator*(V a,float b){return {a.x*b,a.y*b,a.z*b};}
V multiply(V a,V b){return {a.x*b.x,a.y*b.y,a.z*b.z};}
V mix(V a,V b,float t){return a+(b-a)*t;}
float maxv(V a){return std::max({a.x,a.y,a.z});}
float hash3(int x,int y,int z,uint32_t salt=0){
 uint32_t h=uint32_t(x)*374761393u+uint32_t(y)*668265263u+uint32_t(z)*2246822519u+salt;
 h=(h^(h>>13))*1274126177u;h^=h>>16;return (h&0xffffffu)/16777215.f;
}
float cellular(D p){
 int ix=int(std::floor(p.x)),iy=int(std::floor(p.y)),iz=int(std::floor(p.z));double first=1e9,second=1e9;
 for(int z=-1;z<=1;++z)for(int y=-1;y<=1;++y)for(int x=-1;x<=1;++x){
  int a=ix+x,b=iy+y,c=iz+z;
  D center={a+.18+.64*hash3(a,b,c),b+.18+.64*hash3(a,b,c,789221),c+.18+.64*hash3(a,b,c,1376312589)};
  D delta=center-p;double distance=dot(delta,delta);
  if(distance<first){second=first;first=distance;}else second=std::min(second,distance);
 }
 float edge=float(std::min((std::sqrt(second)-std::sqrt(first))/.28,1.));
 return edge*edge*(3-2*edge);
}
template<class T>T clamp(T x,T a,T b){return std::max(a,std::min(b,x));}
double now(){
#ifdef __EMSCRIPTEN__
return emscripten_get_now();
#else
return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
#endif
}
struct Star {double x,y,z;float absmag,radius,r,g,b,luminosity,temperature;uint32_t id,flags,reserved;};
struct Node {double x,y,z;float hx,hy,hz,minmag,maxradius;uint32_t left,right,start,count,reserved;};
struct SurveyNode {double x,y,z,light;float r,g,b;uint32_t gaiaCount,hygCount,pad[3];};
static_assert(sizeof(SurveyNode)==64,"Survey summary ABI");
static_assert(sizeof(Star)==64&&sizeof(Node)==64,"Atlas binary ABI");
struct Planet {
 int index=-2,kind=0,hostIndex=0,w=0,h=0,ringWidth=0;D position,host,axis,ex,ey;
 D shape={1,1,1};double maxScale=1;
 double tailLength=50,comaRadius=3;
 double radius=0,prime=0,rotation=.012,ringInner=0,ringOuter=0;
 const uint8_t* texture=nullptr;const uint8_t* ring=nullptr;
 const uint8_t* relief=nullptr;int reliefW=0,reliefH=0;float reliefStrength=1;
 struct EmissionLevel {const uint8_t* pixels;int width,height;};
 std::vector<EmissionLevel> emission;float emissionStrength=0;
 V atmosphere={.08f,.4f,1},average={.3f,.5f,.8f};float atmosphereStrength=0;
};
struct Projection {int index;float x,y,mag,flux;double distance;D direction;bool resolved=false,visible=false;V color;float angularCells=0;};
// Dense Gaia views can contain most of the catalog. A contiguous vector's
// doubling step keeps both its old and new allocation alive, exceeding the
// WASM heap during the Crab-to-Orion departure. Retain reusable pages instead:
// growth never copies the existing stars, and label pointers stay stable.
struct Projections {
 static constexpr size_t pageSize=4096;
 std::vector<std::unique_ptr<Projection[]>> pages;
 size_t used=0;
 size_t size() const{return used;}
 void clear(){used=0;}
 void reserve(size_t count){while(pages.size()<(count+pageSize-1)/pageSize)pages.push_back(std::make_unique<Projection[]>(pageSize));}
 void push_back(const Projection& point){reserve(used+1);pages[used/pageSize][used%pageSize]=point;++used;}
 struct Iterator {
  Projections* owner;size_t offset;
  Projection& operator*() const{return owner->pages[offset/pageSize][offset%pageSize];}
  Iterator& operator++(){++offset;return *this;}
  bool operator!=(const Iterator& other) const{return offset!=other.offset;}
 };
 Iterator begin(){return {this,0};}
 Iterator end(){return {this,used};}
};
struct Body {int index;D relative;double radius,distance;V color;float angular;const Planet* planet=nullptr;int x0=0,y0=0,x1=0,y1=0;};
struct BeltPoint {D offset;float brightness;};
struct Belt {D position;double inner=0,outer=0;V color;float strength=1;std::vector<BeltPoint> points;};
struct Destination {int index,linked;D position;V color;float flux;};
struct Atlas {
const Star* stars=nullptr;const Node* nodes=nullptr;const uint32_t* indices=nullptr;
uint32_t count=0,nodecount=0,root=0;const char* error="";
std::vector<uint8_t> detailed;
std::vector<Planet> planets;
std::vector<Belt> belts;
std::vector<Destination> destinations;int localDestination=-1;float localBlend=0;
int cols=0,rows=0,selected=-1,hiddenStar=-1;D position,right,up,forward;double tanx=0,tany=0,time=0,exposure=1;
std::vector<V> light,glow,temp;std::vector<double> depth;std::vector<int> surface;
std::vector<double> visibility_distance_squared;
std::vector<uint8_t> output;Projections projected;std::vector<Body> bodies;std::vector<uint32_t> stack;
 std::vector<std::vector<uint32_t>> occluderTiles;int tileCols=0,tileRows=0;
galaxy::Context environment;
const SurveyNode* survey=nullptr;int surveyMode=1;float surveyGain=1;
double cameraRoll=0;
float stats[32]={},labels[4*32]={};int32_t labelIndices[32]={};int labelcount=0;bool selected_seen=false;
float granulation[128*64]={};
float giantCells[128*64]={};
} g;

bool sphere_hit(D center,double radius,D ray,double& t){
 double along=dot(center,ray);D cross={center.y*ray.z-center.z*ray.y,center.z*ray.x-center.x*ray.z,center.x*ray.y-center.y*ray.x};
 double disc=radius*radius-dot(cross,cross);if(disc<0)return false;
 double root=std::sqrt(disc),near=along-root,far=along+root;
 t=near>radius*1e-10?near:far;return t>radius*1e-10;
}
bool planet_hit(D center,const Planet& p,D ray,double& t){
 if(p.shape.x==1&&p.shape.y==1&&p.shape.z==1)return sphere_hit(center,p.radius,ray,t);
 D c={dot(center,p.ex)/(p.radius*p.shape.x),dot(center,p.ey)/(p.radius*p.shape.y),dot(center,p.axis)/(p.radius*p.shape.z)};
 D d={dot(ray,p.ex)/(p.radius*p.shape.x),dot(ray,p.ey)/(p.radius*p.shape.y),dot(ray,p.axis)/(p.radius*p.shape.z)};
 double a=dot(d,d),along=dot(c,d),disc=a-dot(cross(c,d),cross(c,d));if(disc<0)return false;
 double root=std::sqrt(disc),near=(along-root)/a,far=(along+root)/a;
 t=near>p.radius*1e-10?near:far;return t>p.radius*1e-10;
}
bool body_hit(const Body& b,D ray,double& t){return b.planet?planet_hit(b.relative,*b.planet,ray,t):sphere_hit(b.relative,b.radius,ray,t);}
D ray_at(double x,double y){return unit(g.forward+g.right*(((x+.5)/g.cols*2-1)*g.tanx)+g.up*((1-(y+.5)/g.rows*2)*g.tany));}
bool project(D p,float& x,float& y,double margin=0){
 double z=dot(p,g.forward),rx=dot(p,g.right),uy=dot(p,g.up);
 if(z+margin<=0||std::abs(rx)>z*g.tanx+margin*std::sqrt(1+g.tanx*g.tanx)||std::abs(uy)>z*g.tany+margin*std::sqrt(1+g.tany*g.tany))return false;
 if(z<=0){x=y=-1000000;return true;}
 double safe=std::max(z,1e-300);x=float((rx/safe/g.tanx+1)*.5*g.cols-.5);y=float((1-uy/safe/g.tany)*.5*g.rows-.5);return true;
}
bool node_visible(const Node& node,float limit){
 D relative={node.x-g.position.x,node.y-g.position.y,node.z-g.position.z};
 double bound=std::sqrt(double(node.hx)*node.hx+double(node.hy)*node.hy+double(node.hz)*node.hz)+node.maxradius;
 float x,y;if(!project(relative,x,y,bound))return false;
 double nearest=std::max(norm(relative)-bound,1e-20);
 return node.minmag+5*std::log10(nearest)-5<=limit;
}
void visit_star(uint32_t index,float limit,bool survey=false,float weight=1){
 if(int(index)==g.hiddenStar)return;
 if((g.stars[index].flags&32)&&!survey&&int(index)!=g.selected)return;
 const Star& s=g.stars[index];g.stats[3]+=1;bool selected=int(index)==g.selected;if(selected)g.selected_seen=true;
 D relative={s.x-g.position.x,s.y-g.position.y,s.z-g.position.z};
 // Leaf nodes overlap the view conservatively. Reject their offscreen members
 // before the square root and logarithm needed for apparent magnitude.
 float x,y;if(!project(relative,x,y,s.radius))return;
 double distance_squared=dot(relative,relative);
 // Magnitude limit changes with 2.5 log10(exposure), so its squared-distance
 // bound scales linearly with exposure. The conservative cached bound rejects
 // only certain misses; the original magnitude comparison remains authoritative.
 if(!survey&&!selected&&distance_squared>g.visibility_distance_squared[index]*g.exposure)return;
 double distance=std::sqrt(distance_squared);
 float mag=survey&&!selected?5.f:float(s.absmag+5*std::log10(std::max(distance,double(s.radius)))-5);
 if(mag>limit&&!selected&&!survey)return;
 float angular=float(std::asin(clamp(double(s.radius)/std::max(distance,1e-300),0.,1.)));
 bool resolved=angular/(2*g.tany/g.rows)>.38;
 float flux=survey?0.f:std::min(60.f,.14f*std::pow(10.f,-.23f*(mag-6.f)));
 float fade=clamp((limit-mag)/.6f,0.f,1.f);flux*=fade*fade*(3-2*fade);
 if(survey)flux=float(std::min(60.,47.657146502395584*g.surveyGain*((s.flags&64)?4.:1.)*s.luminosity/std::max(distance_squared,1e-24)))*weight;
 if(selected)flux=std::max(flux,.13f);
 g.projected.push_back({int(index),x,y,mag,flux,distance,unit(relative),resolved,false,{s.r,s.g,s.b},float(angular/(2*g.tany/g.rows))});
 if(resolved)g.bodies.push_back({int(index),relative,s.radius,distance,{s.r,s.g,s.b},angular});
}
void gather(){
 g.projected.clear();g.bodies.clear();g.stats[3]=g.stats[4]=g.stats[7]=g.stats[12]=g.stats[14]=g.stats[15]=0;g.selected_seen=false;
 float limit=7.7f+float(2.5*std::log10(g.exposure));
 if(g.nodecount){g.stack.clear();g.stack.push_back(g.root);
  while(!g.stack.empty()){uint32_t i=g.stack.back();g.stack.pop_back();const auto& node=g.nodes[i];
   if(g.survey&&!g.survey[i].hygCount)continue;
   if(!node_visible(node,limit))continue;
   if(node.count){for(uint32_t k=0;k<node.count;++k)visit_star(g.indices[node.start+k],limit);}
   else {g.stack.push_back(node.left);g.stack.push_back(node.right);}
  }
 }else for(uint32_t i=0;i<g.count;++i)visit_star(i,limit);
 if(g.selected>=0&&uint32_t(g.selected)<g.count&&!g.selected_seen)visit_star(uint32_t(g.selected),limit);
 // Persistent world positions, registered at bootstrap and independent of
 // selection or whether the more detailed local interpreter has been loaded.
 for(const auto& destination:g.destinations){
  if(destination.linked>=0)continue; // The catalog already supplies this star.
  D relative=destination.position-g.position;float x,y;if(!project(relative,x,y))continue;
  float weight=destination.index==g.localDestination?1-g.localBlend:1;
  if(weight<=0)continue;
  g.projected.push_back({destination.index,x,y,5,destination.flux*weight,norm(relative),unit(relative),false,false,destination.color,0});
  g.stats[15]+=1;
 }
 for(const auto& planet:g.planets){D relative=planet.position-g.position;float x,y;
  if(!project(relative,x,y,planet.radius*std::max({planet.ringOuter,planet.maxScale,planet.kind==5?planet.tailLength:0.})))continue;
  double d=norm(relative);
  float angle=float(std::asin(clamp(planet.radius/std::max(d,1e-300),0.,1.)));
  g.bodies.push_back({planet.index,relative,planet.radius*planet.maxScale,d,planet.average,angle,&planet});
  double hostDistance=norm(planet.host-planet.position);
  double cosine=clamp(dot(unit(planet.host-planet.position),unit(relative*-1)),-1.,1.);
  double phase=std::acos(cosine),lambert=(std::sin(phase)+(PI-phase)*cosine)/PI;
  double absolute=planet.hostIndex>=0&&uint32_t(planet.hostIndex)<g.count?g.stars[planet.hostIndex].absmag:4.83;
  float mag=float(absolute+5*std::log10(std::max(hostDistance*d/planet.radius,1e-30))-5-2.5*std::log10(std::max(.3*lambert,.0001)));
  float flux=std::min(25.f,.14f*std::pow(10.f,-.23f*(mag-6.f)));
  float fade=clamp((limit-mag)/.6f,0.f,1.f);flux*=fade*fade*(3-2*fade);
  if(planet.index==g.selected)flux=std::max(flux,.13f);
  if(flux>.0001f||angle/(2*g.tany/g.rows)>.38)
   g.projected.push_back({planet.index,x,y,mag,flux,d,unit(relative),angle/(2*g.tany/g.rows)>.38,false,planet.kind==5?mix(planet.average,V{.28f,.70f,.72f},.45f):planet.average,float(angle/(2*g.tany/g.rows))});
 }
 // Depth compositing is done far-to-near, including each body's cosmetic halo.
 std::sort(g.bodies.begin(),g.bodies.end(),[](const Body& a,const Body& b){return a.distance>b.distance;});
}
void bounds(const Body& body,double multiplier,int& x0,int& y0,int& x1,int& y1){
 double z=dot(body.relative,g.forward),r=body.radius*multiplier;
 x0=0;y0=0;x1=g.cols-1;y1=g.rows-1;if(z<=r)return;
 auto slopes=[&](double c,double& lo,double& hi){double denom=z*z-r*r,spread=r*std::sqrt(std::max(z*z+c*c-r*r,0.));lo=(c*z-spread)/denom;hi=(c*z+spread)/denom;};
 double lo,hi;slopes(dot(body.relative,g.right),lo,hi);x0=int(std::floor((lo/g.tanx+1)*.5*g.cols-1));x1=int(std::ceil((hi/g.tanx+1)*.5*g.cols));
 slopes(dot(body.relative,g.up),lo,hi);y0=int(std::floor((1-hi/g.tany)*.5*g.rows-1));y1=int(std::ceil((1-lo/g.tany)*.5*g.rows));
 x0=std::max(x0,0);y0=std::max(y0,0);x1=std::min(x1,g.cols-1);y1=std::min(y1,g.rows-1);
}
void index_occluders(){
 g.tileCols=(g.cols+15)/16;g.tileRows=(g.rows+15)/16;g.occluderTiles.resize(g.tileCols*g.tileRows);
 for(auto& tile:g.occluderTiles)tile.clear();
 for(uint32_t i=0;i<g.bodies.size();++i){Body& b=g.bodies[i];int x0,y0,x1,y1;
  bounds(b,b.planet?std::max(1.,b.planet->ringOuter/b.planet->maxScale):1.,x0,y0,x1,y1);
  b.x0=x0;b.y0=y0;b.x1=x1;b.y1=y1;
  if(x0>x1||y0>y1)continue;
  for(int y=y0/16;y<=y1/16;++y)for(int x=x0/16;x<=x1/16;++x)g.occluderTiles[y*g.tileCols+x].push_back(i);
 }
}
float granule(double u,double v,const float* chart=nullptr){
 if(!chart)chart=g.granulation;
 u-=std::floor(u);v=clamp(v,0.,1.);double x=u*128,y=v*63;int ix=int(x)%128,iy=int(y);float fx=float(x-std::floor(x)),fy=float(y-iy);
 return (chart[iy*128+ix]*(1-fx)+chart[iy*128+(ix+1)%128]*fx)*(1-fy)+
        (chart[std::min(iy+1,63)*128+ix]*(1-fx)+chart[std::min(iy+1,63)*128+(ix+1)%128]*fx)*fy;
}
V chart_sample(const uint8_t* pixels,int w,int h,double u,double v){
 u-=std::floor(u);double x=u*w-.5,y=clamp(v,0.,1.)*(h-1);int ix=int(std::floor(x)),iy=int(y);float fx=float(x-ix),fy=float(y-iy);
 int xa=(ix+w)%w,xb=(xa+1)%w,yb=std::min(iy+1,h-1);
 auto at=[&](int xx,int yy){const uint8_t* p=pixels+(size_t(yy)*w+xx)*3;return V{p[0]/255.f,p[1]/255.f,p[2]/255.f};};
 return mix(mix(at(xa,iy),at(xb,iy),fx),mix(at(xa,yb),at(xb,yb),fx),fy);
}
V planet_sample(const Planet& planet,double u,double v){return chart_sample(planet.texture,planet.w,planet.h,u,v);}

V ring_sample(const Planet& p,double radial,float& alpha){
 double index=clamp((radial/p.radius-p.ringInner)/(p.ringOuter-p.ringInner),0.,1.)*(p.ringWidth-1);
 int i=int(index),j=std::min(i+1,p.ringWidth-1);float f=float(index-i);const uint8_t* a=p.ring+i*4;const uint8_t* b=p.ring+j*4;
 alpha=(a[3]*(1-f)+b[3]*f)/255.f;
 return {(a[0]*(1-f)+b[0]*f)/255.f,(a[1]*(1-f)+b[1]*f)/255.f,(a[2]*(1-f)+b[2]*f)/255.f};
}
float night_sample(const Planet& planet,double u,double v,double lod){
 u-=std::floor(u);lod=clamp(lod,0.,double(planet.emission.size()-1));
 auto sample=[&](int level){const auto& map=planet.emission[level];double x=u*map.width-.5,y=clamp(v,0.,1.)*(map.height-1);int ix=int(std::floor(x)),iy=int(y);
  float fx=float(x-ix),fy=float(y-iy);int xa=(ix+map.width)%map.width,xb=(xa+1)%map.width,yb=std::min(iy+1,map.height-1);
  return ((map.pixels[iy*map.width+xa]*(1-fx)+map.pixels[iy*map.width+xb]*fx)*(1-fy)+(map.pixels[yb*map.width+xa]*(1-fx)+map.pixels[yb*map.width+xb]*fx)*fy)/255.f;};
 int a=int(lod),b=std::min(a+1,int(planet.emission.size()-1));float f=float(lod-a);return sample(a)*(1-f)+sample(b)*f;
}
bool ring_hit(const Body& b,D direction,double& distance,double& radial){
 const Planet* p=b.planet;if(!p||!p->ring)return false;
 double denominator=dot(direction,p->axis);if(std::abs(denominator)<1e-12)return false;
 distance=dot(b.relative,p->axis)/denominator;if(distance<=p->radius*1e-10)return false;
 D offset=direction*distance-b.relative;radial=norm(offset);
 return radial>=p->radius*p->ringInner&&radial<=p->radius*p->ringOuter;
}
V planet_light(const Planet* planet,D point,D ray,D sunlight,V hostTint,double nightLod,float angular){
 D normal;float mu;V color;

    D parameter=unit({dot(point,planet->ex)/planet->shape.x,dot(point,planet->ey)/planet->shape.y,dot(point,planet->axis)/planet->shape.z});
    normal=unit(planet->ex*(parameter.x/planet->shape.x)+planet->ey*(parameter.y/planet->shape.y)+planet->axis*(parameter.z/planet->shape.z));
    mu=float(std::max(-dot(normal,ray),0.));
    double longitude=std::atan2(parameter.y,parameter.x)+planet->prime+g.time*planet->rotation;
    double u=longitude/(2*PI)+.5,v=.5-std::asin(clamp(parameter.z,-1.,1.))/PI;
    V albedo=planet_sample(*planet,u,v);
    if(planet->relief){
     V slope=chart_sample(planet->relief,planet->reliefW,planet->reliefH,u,v);
     // Tangents use the geometric longitude. The chart rotates with the body.
     D east=unit(planet->ey*parameter.x-planet->ex*parameter.y),north=unit(cross(normal,east));
     float footprint=float(planet->reliefW*g.tany/(PI*std::max(double(angular),1e-12)*g.rows));
     float strength=planet->reliefStrength/std::max(1.f,footprint*.32f);
     normal=unit(normal*std::max(.15f,slope.z)+east*((slope.x*255-128)/127*strength)+north*((slope.y*255-128)/127*strength));
    }
    float solarAngle=float(dot(normal,sunlight)),light=std::max(solarAngle,0.f);float day=.004f+1.18f*std::pow(light,planet->kind==1?.72f:.86f);
    // Airless lunar regolith has a much flatter illuminated disk than a
    // Lambert sphere; use a simple Lommel-Seeliger approximation, not a BRDF claim.
    if(planet->index==-10&&planet->relief)day=.006f+1.05f*light/std::max(.04f,light+mu*.45f);
    color=multiply(albedo,hostTint)*day;
    if(!planet->emission.empty()&&solarAngle<.04f){
     float night=clamp((.04f-solarAngle)/.18f,0.f,1.f);night=night*night*(3-2*night);
     float emission=night_sample(*planet,longitude/(2*PI)+.5,.5-std::asin(clamp(parameter.z,-1.,1.))/PI,nightLod-std::log2(std::max(mu,.15f))*.5);
     color=color+V{1.f,.67f,.27f}*(emission*planet->emissionStrength*night*(.35f+.65f*std::sqrt(mu)));
    }
    if(planet->kind==3)color=color+albedo*(.12f+.18f*std::pow(std::max(albedo.x-albedo.y,0.f),.6f));
    float limb=std::pow(1-mu,4.f)*(.006f+.18f*std::sqrt(light))*planet->atmosphereStrength;
    color=color+planet->atmosphere*limb;
 return color;
}
void draw_body(const Body& body){
 const Planet* planet=body.planet;
 const float stellarTemperature=planet?0:g.stars[body.index].temperature;
 const double solarRadius=body.radius/2.25461e-8;
 bool supergiant=!planet&&stellarTemperature<5000&&solarRadius>10;
 bool coolDwarf=!planet&&stellarTemperature<4400&&solarRadius<.8;
 bool hotStar=!planet&&stellarTemperature>7500;
 bool compactStar=!planet&&solarRadius<.035&&stellarTemperature>6000;
 int x0,y0,x1,y1;bounds(body,planet?(planet->kind==5?planet->comaRadius/planet->maxScale:1+.10*planet->atmosphereStrength):supergiant?1.95:1.65,x0,y0,x1,y1);
 D sunlight=planet?unit(planet->host-planet->position):D{};
 const double nightLod=planet&&!planet->emission.empty()?std::log2(std::max(1.,planet->emission[0].width*g.tany/(PI*std::max(double(body.angular),1e-12)*g.rows))):0;
 V hostTint={1,1,1};
 if(planet&&planet->hostIndex>=0&&uint32_t(planet->hostIndex)<g.count){const Star& s=g.stars[planet->hostIndex];hostTint=mix(hostTint,{s.r,s.g,s.b},.25f);}
 for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){size_t i=size_t(y)*g.cols+x;D ray=ray_at(x,y);double t;
  if(body_hit(body,ray,t)){
   if(t>=g.depth[i])continue;D normal=unit((ray*t-body.relative)/body.radius);float mu=float(std::max(-dot(normal,ray),0.));
   V color;
   if(planet){
    color=planet_light(planet,ray*t-body.relative,ray,sunlight,hostTint,nightLod,body.angular);
   }else {
    float temperature=g.stars[body.index].temperature;double spin=.0023+clamp((temperature-3000)/16000.,0.,1.)*.003;
    double u=std::atan2(normal.y,normal.x)/(2*PI)+.5+g.time*spin+body.index*.137,v=.5-std::asin(clamp(normal.z,-1.,1.))/PI;
    float a=granule(u+.007*std::sin(g.time*.31+v*9),v);
    float b=granule(u+.21-g.time*.0007,clamp(v+.013*std::sin(g.time*.27+u*15),0.,1.));
    float granulation=.76f*a+.24f*b;float emission=(.32f+.68f*std::pow(mu,.48f))*(.28f+1.43f*granulation)*1.55f;
    if(temperature<4300)emission*=.88f+.12f*std::sin(float(u*12+v*7+g.time*.21));
    if(supergiant){
     // Low-frequency convection is an illustrative stellar-family chart,
     // independently sampled from ordinary photospheric granulation.
     float cells=granule(u+g.time*.0008,clamp(v+.018*std::sin(g.time*.08+u*8),0.,1.),g.giantCells);
     float second=granule(u+.27-g.time*.0004,v,g.giantCells);
     float evolution=float(.5+.5*std::sin(g.time*.075+body.index));
     float convection=cells*(.8f-.18f*evolution)+second*(.2f+.18f*evolution);
     float hot=clamp((convection-.56f)*3.3f,0.f,1.f);
     emission=(.34f+.66f*std::pow(mu,.38f))*(.18f+2.5f*convection*convection)*(.90f+.14f*granulation);
     color=mix(body.color,V{1,.78f,.40f},hot*.48f)*emission;
    }else if(compactStar){
     color=mix(body.color,V{.72f,.85f,1},.25f)*((.45f+.55f*std::pow(mu,.35f))*(1.18f+.08f*granulation));
    }else if(hotStar){
     // Smooth hot photosphere with faint traveling structure; winds below.
     float wave=float(.5+.5*std::sin(u*45+v*18-g.time*.33));
     emission=(.38f+.62f*std::pow(mu,.42f))*(1.05f+.28f*granulation+.07f*wave);
     color=mix(body.color,V{.57f,.75f,1},.18f)*emission;
    }else{
     float patches=granule(u+.19,v,g.giantCells);
     float spot=clamp((patches-(coolDwarf?.59f:.68f))*8,0.f,1.f);
     float latitude=float(std::exp(-std::pow((v-.5)*3.3,2)));
     emission*=1-spot*latitude*(coolDwarf?.74f:.55f);
     color=mix(body.color,V{1,.39f,.16f},coolDwarf?.24f:0.f)*emission;
    }
   }
   g.light[i]=color;g.depth[i]=t;g.surface[i]=body.index;g.detailed[i]=planet&&planet->relief;
  }else if(dot(body.relative,ray)>0&&body.distance<g.depth[i]){
   D perpendicular=body.relative-ray*dot(body.relative,ray);double ratio=norm(perpendicular)/body.radius;
   if(ratio>1){float halo;
    if(planet)halo=planet->kind==5?float(std::exp(-(ratio-1)*1.40)*.45):float(std::exp(-(ratio-1)*48)*.055)*planet->atmosphereStrength;
    else {double angle=std::atan2(perpendicular.y,perpendicular.x);
     float stream=float(.5+.5*std::sin(angle*7+std::log(ratio)*9+g.time*.19+body.index));
     double active=std::pow(std::max(std::cos(angle*3-body.index*.6-g.time*.12),0.),12);
     float pulse=float(.35+.65*std::pow(.5+.5*std::sin(g.time*.45+body.index),3));
     halo=float(std::exp(-(ratio-1)*11)*.13)*(.45f+.55f*stream*stream)+float(std::exp(-(ratio-1)*6)*active)*pulse*.065f;
     if(supergiant){double plume=std::pow(std::max(std::cos(angle*2-body.index*.77-g.time*.027),0.),8);
      halo+=float(std::exp(-(ratio-1)*4.8)*plume)*(.13f+.07f*pulse);}
     if(hotStar&&!compactStar)halo+=float(std::exp(-(ratio-1)*6))*(.035f+.065f*stream*stream);
     if(compactStar)halo*=.3f;}
    if(halo>.0001f){g.light[i]=g.light[i]+(planet?(planet->kind==5?V{.30f,.73f,.69f}:planet->atmosphere):body.color)*halo;
     if(planet&&planet->kind==5&&halo>.035f)g.surface[i]=body.index;}}
  }
 }
}
void draw_rings(const Body& body){
 const Planet* planet=body.planet;if(!planet||!planet->ring)return;
 int x0,y0,x1,y1;bounds(body,planet->ringOuter/planet->maxScale,x0,y0,x1,y1);
 D sun=unit(planet->host-planet->position);float illumination=.24f+.76f*float(std::abs(dot(planet->axis,sun)));
 for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){size_t i=size_t(y)*g.cols+x;D ray=ray_at(x,y);double t,r;
  if(!ring_hit(body,ray,t,r)||t>=g.depth[i])continue;
  float alpha;V color=ring_sample(*planet,r,alpha);if(alpha<.005f)continue;
  D offset=ray*t-body.relative;double shadowDistance;float shade=illumination;
  if(planet_hit(offset*-1,*planet,sun,shadowDistance))shade*=.055f;
  // A thin sheet grows more opaque when viewed edge-on, with a finite cap.
  float view=float(std::abs(dot(ray,planet->axis)));alpha=1-std::pow(1-alpha,1/std::max(view,.13f));
  g.light[i]=color*(shade*alpha*1.2f)+g.light[i]*(1-alpha);
  if(alpha>.12f)g.surface[i]=body.index;
  g.stats[12]+=1;
 }
}
float transmission(const Projection& p){
 float result=1;
 int tx=clamp(int(p.x)/16,0,g.tileCols-1),ty=clamp(int(p.y)/16,0,g.tileRows-1);
 for(uint32_t index:g.occluderTiles[ty*g.tileCols+tx]){const auto& b=g.bodies[index];double extent=b.radius*(b.planet?std::max(b.planet->ringOuter/b.planet->maxScale,1.):1.);
  // Hundreds of distant solar bodies share a tile during this flight. Their
  // conservative cell bounds cheaply reject rays outside each tiny silhouette.
  if(p.x<b.x0-.5f||p.x>b.x1+.5f||p.y<b.y0-.5f||p.y>b.y1+.5f)continue;
  if(b.index==p.index||b.distance-extent>=p.distance)continue;double t;
  if(body_hit(b,p.direction,t)&&t<p.distance)return 0;
  double r;if(ring_hit(b,p.direction,t,r)&&t<p.distance){float alpha;ring_sample(*b.planet,r,alpha);
   result*=std::pow(1-alpha,1/std::max(float(std::abs(dot(p.direction,b.planet->axis))),.13f));}}
 return result;
}
void add_cell(int x,int y,V color,double distance){
 if(x<0||y<0||x>=g.cols||y>=g.rows)return;size_t i=size_t(y)*g.cols+x;if(distance>g.depth[i])return;g.light[i]=g.light[i]+color;
}
void emissive_point(D relative,V color,int index=-1){
 float x,y;if(!project(relative,x,y))return;double distance=norm(relative);int ix=int(std::floor(x)),iy=int(std::floor(y));float fx=x-ix,fy=y-iy;
 add_cell(ix,iy,color*((1-fx)*(1-fy)),distance);add_cell(ix+1,iy,color*(fx*(1-fy)),distance);
 add_cell(ix,iy+1,color*((1-fx)*fy),distance);add_cell(ix+1,iy+1,color*(fx*fy),distance);
 if(index<=-2&&ix>=0&&ix<g.cols&&iy>=0&&iy<g.rows){size_t i=size_t(iy)*g.cols+ix;if(distance<g.depth[i]&&g.surface[i]==-1&&maxv(color)>.04f){g.surface[i]=index;g.stats[20]+=1;}}
}
void survey_node(uint32_t id,float weight){
 const Node& node=g.nodes[id];const SurveyNode& summary=g.survey[id];
 if(!summary.gaiaCount||weight<1e-5f)return;
 D center={node.x-g.position.x,node.y-g.position.y,node.z-g.position.z};
 double bound=std::sqrt(double(node.hx)*node.hx+double(node.hy)*node.hy+double(node.hz)*node.hz);
 float x,y;if(!project(center,x,y,bound))return;
 g.stats[28]+=1;
 D relative={summary.x-g.position.x,summary.y-g.position.y,summary.z-g.position.z};double distance=norm(relative);
 // Bound the full3D extent, including depth, before replacing members with
 // their light centroid. Adjacent levels crossfade while conserving light.
 double cellRadius=bound/std::max(norm(center)-bound,1e-20)/(2*g.tany/g.rows);
 float coarse=clamp(float((1.2-cellRadius)/.6),0.f,1.f);coarse=coarse*coarse*(3-2*coarse);
 if(g.selected>=0&&uint32_t(g.selected)<g.count&&(g.stars[g.selected].flags&32)){
  const Star& selected=g.stars[g.selected];
  if(std::abs(selected.x-node.x)<=node.hx&&std::abs(selected.y-node.y)<=node.hy&&std::abs(selected.z-node.z)<=node.hz)coarse=0;
 }
 if(coarse>0){
  double flux=3516.641*g.surveyGain*summary.light/std::max(distance*distance,1e-24);
  // A fixed G-band presentation exposure; positions and relative luminosity
  // are observational, display response is explicitly artistic.
  emissive_point(relative,V{summary.r,summary.g,summary.b}*float(flux*weight*coarse));
  g.stats[29]+=1;g.stats[31]+=summary.gaiaCount*weight*coarse;
 }
 weight*=1-coarse;if(weight<1e-5f)return;
 if(node.count){for(uint32_t k=0;k<node.count;++k){uint32_t index=g.indices[node.start+k];
   if(!(g.stars[index].flags&32)||int(index)==g.selected)continue;
   visit_star(index,100,true,weight);g.stats[30]+=1;g.stats[31]+=weight;
 }}else{survey_node(node.left,weight);survey_node(node.right,weight);}
}
void survey_gather(){
 g.stats[28]=g.stats[29]=g.stats[30]=g.stats[31]=0;
 if(!g.survey||!g.surveyMode)return;
 survey_node(g.root,1);
 std::sort(g.bodies.begin(),g.bodies.end(),[](const Body& a,const Body& b){return a.distance>b.distance;});
}
void local_activity(){
 g.stats[20]=g.stats[21]=0;
 for(const Body& b:g.bodies){
  if(b.planet){const Planet& p=*b.planet;if(p.kind!=5||b.angular/(2*g.tany/g.rows)<.018)continue;
   D anti=unit(p.position-p.host),side=cross(anti,p.axis);if(norm(side)<1e-8)side=cross(anti,{1,0,0});if(norm(side)<1e-8)side=cross(anti,{0,1,0});side=unit(side);D vertical=cross(anti,side);
   for(int k=0;k<192;++k){double u=(k+.3)/192,along=p.radius*p.tailLength*u;float fade=float(std::pow(1-u,.65));
    double wave=std::sin(u*18-g.time*.33)*p.radius*(.12+.012*p.tailLength*u);
    D ion=b.relative+anti*along+side*wave;
    D dust=b.relative+anti*(along*.85)+side*(p.radius*p.tailLength*.13*u*u+wave*1.5);
    double angle=k*2.39996323,width=p.radius*(.22+.19*p.tailLength*u);
    D spread=(side*std::cos(angle)+vertical*std::sin(angle))*width;
    emissive_point(ion,V{.20f,.49f,1}*(.20f*fade),p.index);
    emissive_point(dust,V{1,.76f,.38f}*(.08f*fade),p.index);
    emissive_point(dust+spread,V{1,.76f,.38f}*(.06f*fade),p.index);
    emissive_point(dust-spread,V{1,.76f,.38f}*(.06f*fade),p.index);
   }
  }else if(b.angular/(2*g.tany/g.rows)>3){
   // Deliberately rare illustrative activity, never a live solar prediction.
   // Stable star/time hashing makes camera changes unable to trigger events.
   const Star& star=g.stars[b.index];bool activeDwarf=star.temperature<4400&&b.radius<.8*2.25461e-8;
   // Activity rates are illustrative family presets, not forecasts for a star.
   if(star.temperature>7500||b.radius>10*2.25461e-8)continue;
   double period=activeDwarf?35+30*hash3(b.index,411,73):180+120*hash3(b.index,411,73),duration=activeDwarf?4:6+2*hash3(b.index,491,51);
   double offset=b.index==0?20:20+period*hash3(b.index,517,18);
   double cycle=std::fmod(g.time-offset,period);if(cycle<0)cycle+=period;if(cycle>=duration)continue;
   double phase=cycle/duration,envelope=std::pow(std::sin(PI*phase),2);if(envelope<.002)continue;g.stats[21]+=1;
   int event=int(std::floor((g.time-offset)/period));
   D anchor=b.index==0?unit(D{.77,.35,.53}):unit(D{hash3(b.index,event,14)*2-1,hash3(b.index,event,15)*2-1,hash3(b.index,event,16)*2-1});
   D tangent=unit(cross(anchor,std::abs(anchor.y)<.9?D{0,1,0}:D{1,0,0}));double height=.13+.95*envelope;
   V hot=mix(b.color,V{1,.78f,.46f},.55f);
   for(int k=0;k<96;++k){double angle=PI*k/95;D p=anchor*(b.radius*(1.003+height*std::sin(angle)))+tangent*(b.radius*.20*std::cos(angle));
    float moving=float(.7+.3*std::sin(angle*8-phase*17));emissive_point(b.relative+p,hot*float(envelope*(.045+.22*std::sin(angle))*moving));
   }
   emissive_point(b.relative+anchor*(b.radius*1.009)+tangent*(b.radius*.20),V{1,.92f,.76f}*float(envelope*.9));
   emissive_point(b.relative+anchor*(b.radius*1.009)-tangent*(b.radius*.20),V{1,.92f,.76f}*float(envelope*.9));
  }
 }
}
void add_label(int index,float x,float y,float mag){
 if(g.labelcount>=32)return;g.labelIndices[g.labelcount]=index;float* p=g.labels+g.labelcount++*4;p[0]=float(index);p[1]=(x+.5f)/g.cols;p[2]=(y+.5f)/g.rows;p[3]=mag;
}
void points(){
 for(auto& p:g.projected){
  float trans=transmission(p);if(trans<.001f)continue;p.visible=true;if(p.index>=0)g.stats[4]+=1;else g.stats[14]+=1;
  float unresolved_weight=1;
  if(p.resolved){
   // Retain a fading point contribution until a disk reliably covers cells.
   // A subcell sphere must never disappear between character-center rays.
   unresolved_weight=clamp((1.1f-p.angularCells)/.72f,0.f,1.f);
   if(unresolved_weight<=0)continue;
  }
  V color=p.color*(p.flux*unresolved_weight*trans);
  int x=int(std::floor(p.x)),y=int(std::floor(p.y));float fx=p.x-x,fy=p.y-y;
  add_cell(x,y,color*((1-fx)*(1-fy)),p.distance);add_cell(x+1,y,color*(fx*(1-fy)),p.distance);
  add_cell(x,y+1,color*((1-fx)*fy),p.distance);add_cell(x+1,y+1,color*(fx*fy),p.distance);
  if(p.flux>1.5f){int cx=int(std::round(p.x)),cy=int(std::round(p.y));int reach=std::min(5,1+int(std::log1p(p.flux)));
   for(int k=1;k<=reach;++k){V flare=color*(.028f/(k*k));add_cell(cx-k,cy,flare,p.distance);add_cell(cx+k,cy,flare,p.distance);
    if(k<=2){add_cell(cx,cy-k,flare*.7f,p.distance);add_cell(cx,cy+k,flare*.7f,p.distance);}}
  }
 }
 g.labelcount=0;
 for(const auto& p:g.projected)if(p.visible&&p.index==g.selected)add_label(p.index,p.x,p.y,p.mag);
 // Labels are a small optional overlay. Partial sort avoids processing every
 // visible source into a JavaScript object on each animation frame.
 std::vector<const Projection*> bright;bright.reserve(std::min<size_t>(g.projected.size(),256));
 for(const auto& p:g.projected)if(p.visible&&p.index!=g.selected&&p.mag<4)bright.push_back(&p);
 size_t keep=std::min<size_t>(bright.size(),12);
 std::partial_sort(bright.begin(),bright.begin()+keep,bright.end(),[](auto a,auto b){return a->mag<b->mag;});
 for(size_t k=0;k<keep;++k)add_label(bright[k]->index,bright[k]->x,bright[k]->y,bright[k]->mag);
}
void belt_points(){
 g.stats[16]=g.stats[17]=0;
 for(const Belt& belt:g.belts){g.stats[16]+=belt.points.size();D center=belt.position-g.position;double centerDistance=norm(center);
  // Belts are finite, explicitly illustrative asteroid populations. Their
  // individual light points disappear outside the local planetary system.
  float fade=float(clamp((8-centerDistance/belt.outer)/3,0.,1.));if(fade<=0)continue;
  fade=fade*fade*(3-2*fade);
  float bx,by;if(!project(center,bx,by,belt.outer*1.02))continue;
  for(const auto& particle:belt.points){D relative=center+particle.offset;float x,y;if(!project(relative,x,y))continue;
   double distance=norm(relative);float flux=std::min(.85f,.17f*particle.brightness*float(std::pow(belt.outer/std::max(distance,belt.outer*.005),.72)))*fade*belt.strength;
   if(flux<.02f)continue;
   Projection p={-1,x,y,9,flux,distance,unit(relative),false,false,belt.color,0};float trans=transmission(p);if(trans<.001f)continue;
   V color=belt.color*(flux*trans);int ix=int(std::floor(x)),iy=int(std::floor(y));float fx=x-ix,fy=y-iy;
   add_cell(ix,iy,color*((1-fx)*(1-fy)),distance);add_cell(ix+1,iy,color*(fx*(1-fy)),distance);
   add_cell(ix,iy+1,color*((1-fx)*fy),distance);add_cell(ix+1,iy+1,color*(fx*fy),distance);g.stats[17]+=1;
  }
 }
}
void blur(){
 // Small character-space bloom. No raster framebuffer or glyph image passes.
 for(int y=0;y<g.rows;++y)for(int x=0;x<g.cols;++x){V sum={};for(int k=-2;k<=2;++k)sum=sum+g.light[y*g.cols+std::clamp(x+k,0,g.cols-1)];g.temp[y*g.cols+x]=sum*.2f;}
 for(int y=0;y<g.rows;++y)for(int x=0;x<g.cols;++x){V sum={};for(int k=-1;k<=1;++k)sum=sum+g.temp[std::clamp(y+k,0,g.rows-1)*g.cols+x];g.glow[y*g.cols+x]=sum*(.10f/3);}
}
}

extern "C" {
const char* atlas_error(){return g.error;}
int atlas_add_destination(int index,int linked,double x,double y,double z,double r,double green,double b,double flux){
 if(index>-2||!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(z)||!std::isfinite(r)||!std::isfinite(green)||!std::isfinite(b)||!std::isfinite(flux)||r<0||green<0||b<0||flux<0||flux>10){g.error="Invalid persistent destination";return -1;}
 Destination entry={index,linked,{x,y,z},{float(r),float(green),float(b)},float(flux)};
 for(auto& existing:g.destinations)if(existing.index==index){existing=entry;return 0;}
 if(g.destinations.size()>=64){g.error="Too many persistent destinations";return -1;}
 g.destinations.push_back(entry);return 0;
}
int atlas_set_local_destination(int index,double blend){
 if(!std::isfinite(blend)||blend<0||blend>1){g.error="Invalid destination transition";return -1;}
 g.localDestination=index;g.localBlend=float(blend);return 0;
}
int atlas_init(const uint8_t* asset,uint32_t bytes){
 g.error="";if(!asset||bytes<64){g.error="Atlas header missing";return -1;}
 const uint32_t* h=reinterpret_cast<const uint32_t*>(asset);
 if(h[0]!=0x54415543||h[1]!=1||h[8]!=bytes||!h[2]||uint64_t(h[4])+uint64_t(h[2])*64>bytes||
    uint64_t(h[5])+uint64_t(h[3])*64>bytes||(h[3]&&(h[7]>=h[3]||uint64_t(h[6])+uint64_t(h[2])*4>bytes))){g.error="Invalid atlas format";return -1;}
 g.stars=reinterpret_cast<const Star*>(asset+h[4]);g.count=h[2];g.nodes=reinterpret_cast<const Node*>(asset+h[5]);g.nodecount=h[3];g.indices=reinterpret_cast<const uint32_t*>(asset+h[6]);g.root=h[7];
 for(uint32_t i=0;i<g.nodecount;++i){const Node& n=g.nodes[i];if((n.count&&uint64_t(n.start)+n.count>g.count)||(!n.count&&(n.left>=g.nodecount||n.right>=g.nodecount))){g.error="Invalid atlas hierarchy";g.stars=nullptr;return -1;}}
 for(uint32_t i=0;i<g.count&&g.nodecount;++i)if(g.indices[i]>=g.count){g.error="Invalid catalog index";g.stars=nullptr;return -1;}
 g.visibility_distance_squared.resize(g.count);
 for(uint32_t i=0;i<g.count;++i)g.visibility_distance_squared[i]=std::pow(10.,.4*(double(7.7f)-g.stars[i].absmag+5))*1.00001;
 // Fixed stellar granulation chart: a reusable illustrative surface, generated
 // once at startup and reused for every resolved star. Not observed surface data.
 for(int y=0;y<64;++y)for(int x=0;x<128;++x){double a=x*2*PI/128-PI,latitude=PI/2-y*PI/63;
  D sphere={std::cos(latitude)*std::cos(a),std::cos(latitude)*std::sin(a),std::sin(latitude)};
  g.granulation[y*128+x]=.08f+.68f*cellular(sphere*19)+.24f*cellular(sphere*7);
  g.giantCells[y*128+x]=.10f+.66f*cellular(sphere*2.6)+.24f*cellular(sphere*4.8);}
 g.projected.reserve(8192);g.bodies.reserve(32);g.stack.reserve(g.nodecount);return 0;
}
int atlas_add_body(int index,const double* p,const uint8_t* rgb,uint32_t width,uint32_t height,const uint8_t* rings,uint32_t ringWidth){
 // F64 descriptor: xyz, radius, hostxyz, axisxyz, prime, rotation, ringInner,
 // ringOuter, reserved, kind, atmosphereStrength, atmosphereRGB, hostStarIndex.
 if(index>-2||!p||!rgb||!width||!height||width>4096||height>2048||ringWidth>16384){g.error="Invalid planetary body descriptor";return -1;}
 for(int i=0;i<21;++i)if(!std::isfinite(p[i])){g.error="Nonfinite planetary body parameter";return -1;}
 if(p[3]<=0||norm({p[7],p[8],p[9]})<1e-10||p[16]<0||p[16]>4||p[15]<0||p[15]>5||
    (rings&&(ringWidth<2||p[12]<1||p[13]<=p[12]||p[13]>100))){g.error="Planet radius, pole, atmosphere or ring bounds invalid";return -1;}
 Planet body;body.index=index;body.position={p[0],p[1],p[2]};body.radius=p[3];body.host={p[4],p[5],p[6]};
 body.axis=unit({p[7],p[8],p[9]});D reference=std::abs(body.axis.x)<.9?D{1,0,0}:D{0,1,0};body.ex=unit(reference-body.axis*dot(reference,body.axis));body.ey=cross(body.axis,body.ex);
 body.prime=p[10];body.rotation=p[11];body.ringInner=p[12];body.ringOuter=p[13];body.kind=int(p[15]);body.hostIndex=int(p[20]);
 body.tailLength=p[14]>0?clamp(p[14],1.,500.):50;
 body.atmosphereStrength=float(p[16]);body.atmosphere={float(p[17]),float(p[18]),float(p[19])};body.texture=rgb;body.w=int(width);body.h=int(height);body.ring=rings;body.ringWidth=int(ringWidth);
 V average={};int samples=0;
 for(uint32_t y=0;y<height;y+=std::max(height/16,1u))for(uint32_t x=0;x<width;x+=std::max(width/32,1u)){
  const uint8_t* pixel=rgb+(size_t(y)*width+x)*3;average=average+V{pixel[0]/255.f,pixel[1]/255.f,pixel[2]/255.f};++samples;}
 body.average=average*(1.f/samples);
 for(auto& existing:g.planets)if(existing.index==index){existing=body;return 0;}
 if(g.planets.size()>=2048){g.error="Planetary registry is full";return -1;}
 g.planets.push_back(body);return 0;
}
int atlas_set_body_relief(int index,const uint8_t* pixels,uint32_t width,uint32_t height,double strength){
 if(!pixels||!width||!height||width>4096||height>2048||!std::isfinite(strength)||strength<0||strength>8){g.error="Invalid relief chart";return -1;}
 for(auto& body:g.planets)if(body.index==index){body.relief=pixels;body.reliefW=width;body.reliefH=height;body.reliefStrength=float(strength);return 0;}
 g.error="Relief body is not registered";return -1;
}
int atlas_set_body_emission(int index,const uint8_t* pixels,uint32_t width,uint32_t height,uint32_t bytes,double strength){
 if(!pixels||!width||!height||width>4096||height>2048||!std::isfinite(strength)||strength<0||strength>32){g.error="Invalid emission chart";return -1;}
 uint32_t required=0,w=width,h=height;while(true){required+=w*h;if(w==1&&h==1)break;w=std::max(1u,w/2);h=std::max(1u,h/2);}
 if(bytes!=required){g.error="Invalid emission mip chain length";return -1;}
 for(auto& body:g.planets)if(body.index==index){body.emission.clear();body.emissionStrength=float(strength);w=width;h=height;uint32_t offset=0;
  while(true){body.emission.push_back({pixels+offset,int(w),int(h)});offset+=w*h;if(w==1&&h==1)break;w=std::max(1u,w/2);h=std::max(1u,h/2);}return 0;}
 g.error="Emission body is not registered";return -1;
}
int atlas_set_body_orientation(int index,double x,double y,double z,double prime){
 if(!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(z)||!std::isfinite(prime)||norm({x,y,z})<1e-10){g.error="Invalid body orientation";return -1;}
 for(auto& body:g.planets)if(body.index==index){
  body.axis=unit({x,y,z});D reference=std::abs(body.axis.x)<.9?D{1,0,0}:D{0,1,0};
  body.ex=unit(reference-body.axis*dot(reference,body.axis));body.ey=cross(body.axis,body.ex);
  body.prime=prime;body.rotation=0;return 0;
 }
 g.error="Orientation body is not registered";return -1;
}
int atlas_set_body_shape(int index,double x,double y,double z){
 if(!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(z)||std::min({x,y,z})<.05||std::max({x,y,z})>20){g.error="Invalid triaxial body shape";return -1;}
 for(auto& body:g.planets)if(body.index==index){body.shape={x,y,z};body.maxScale=std::max({x,y,z});return 0;}
 g.error="Body shape index is not registered";return -1;
}
int atlas_set_body_comet(int index,double tail,double coma){
 if(!std::isfinite(tail)||!std::isfinite(coma)||tail<1||tail>500||coma<1||coma>50){g.error="Invalid comet activity scale";return -1;}
 for(auto& p:g.planets)if(p.index==index){p.tailLength=tail;p.comaRadius=coma;return 0;}
 g.error="Comet index is not registered";return -1;
}
int atlas_clear_generated(){
 g.planets.erase(std::remove_if(g.planets.begin(),g.planets.end(),[](const Planet& body){return body.index<=-100000;}),g.planets.end());
 g.bodies.clear();g.projected.clear();g.labelcount=0;std::fill(g.surface.begin(),g.surface.end(),-1);return 0;
}
int atlas_clear_belts(){g.belts.clear();return 0;}
int atlas_add_belt(const double* p){
 // xyz, axisxyz, innerPc, outerPc, halfThicknessPc, seed, count,
 // host index (reserved), RGB, brightness. All particles are illustrative.
 if(!p){g.error="Missing asteroid belt parameters";return -1;}
 for(int i=0;i<16;++i)if(!std::isfinite(p[i])){g.error="Nonfinite asteroid belt parameter";return -1;}
 size_t count=0;for(const auto& belt:g.belts)count+=belt.points.size();
 if(p[6]<=0||p[7]<=p[6]||p[8]<0||p[8]>p[7]||p[10]<1||p[10]>10000||count+size_t(p[10])>20000||norm({p[3],p[4],p[5]})<1e-10||p[15]<0||p[15]>10){g.error="Asteroid belt bounds or particle budget invalid";return -1;}
 Belt belt;belt.position={p[0],p[1],p[2]};belt.inner=p[6];belt.outer=p[7];belt.color={float(p[12]),float(p[13]),float(p[14])};belt.strength=float(p[15]);
 D axis=unit({p[3],p[4],p[5]}),ref=std::abs(axis.x)<.9?D{1,0,0}:D{0,1,0};D ex=unit(ref-axis*dot(ref,axis)),ey=cross(axis,ex);
 uint32_t seed=uint32_t(std::fmod(std::abs(p[9]),4294967295.));if(!seed)seed=0x9e3779b9u;
 auto random=[&](){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return double(seed)/4294967296.;};
 belt.points.reserve(size_t(p[10]));
 for(int i=0;i<int(p[10]);++i){double angle=random()*2*PI,radius=std::sqrt(belt.inner*belt.inner+random()*(belt.outer*belt.outer-belt.inner*belt.inner));
  double height=(random()+random()+random()-1.5)*p[8]*.667;
  belt.points.push_back({ex*(std::cos(angle)*radius)+ey*(std::sin(angle)*radius)+axis*height,float(.20+.80*std::pow(random(),2))});
 }
 g.belts.push_back(std::move(belt));return 0;
}
int atlas_set_earth(double x,double y,double z,double radius,const uint8_t* rgb,uint32_t width,uint32_t height){
 double parameters[]={x,y,z,radius,0,0,0,0,0,1,0,2*PI*.002,0,0,0,4,1,.08,.4,1,0};
 return atlas_add_body(-2,parameters,rgb,width,height,nullptr,0);
}
int atlas_set_environment(const uint8_t* rgb,int width,int height,const double* parameters){
 if(!rgb){g.environment={};return 0;}
 if(!parameters||width<2||width>4096||height<2||height>2048||!std::isfinite(parameters[0])||!std::isfinite(parameters[1])||!std::isfinite(parameters[2])){g.error="Invalid galactic environment";return -1;}
 g.environment=galaxy::Context{};g.environment.rgb=rgb;g.environment.w=width;g.environment.h=height;
 for(int i=0;i<3;++i)g.environment.eye[i]=parameters[i];galaxy::prepare(g.environment);return 0;
}
int atlas_set_galaxy(const float* points,int count,const double* parameters){
 if(!points){g.environment=galaxy::Context{};return 0;}
 if(!parameters||count<1||count>1000000||!std::isfinite(parameters[0])||!std::isfinite(parameters[1])||!std::isfinite(parameters[2])){g.error="Invalid spatial Milky Way data";return -1;}
 galaxy::set_points(g.environment,points,count,parameters);return 0;
}
int atlas_set_camera_roll(double roll){if(!std::isfinite(roll)){g.error="Invalid camera roll";return -1;}g.cameraRoll=roll;return 0;}
int atlas_set_survey(const void* summaries,uint32_t count,int mode,float gain){
 if(mode<0||mode>2||!std::isfinite(gain)||gain<.1f||gain>64||summaries&&count!=g.nodecount){g.error="Invalid Gaia summaries/settings";return -1;}
 g.survey=static_cast<const SurveyNode*>(summaries);g.surveyMode=mode;g.surveyGain=gain;return 0;
}
void sample_surface_detail(){
 const size_t n=size_t(g.cols)*g.rows;
 for(const auto& body:g.bodies){
  const Planet* p=body.planet;if(!p||!p->relief||p->ring||!p->emission.empty()||p->kind==5)continue;
  int x0,y0,x1,y1;bounds(body,1,x0,y0,x1,y1);
  D sunlight=unit(p->host-p->position);V tint={1,1,1};
  if(p->hostIndex>=0&&uint32_t(p->hostIndex)<g.count){const Star& s=g.stars[p->hostIndex];tint=mix(tint,{s.r,s.g,s.b},.25f);}
  for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x){
   const size_t i=size_t(y)*g.cols+x;if(g.surface[i]!=body.index)continue;
   V samples[4];bool complete=true;
   for(int q=0;q<4;++q){
    double sx=x+((q&1)?.75:.25),sy=y+((q&2)?.75:.25);
    D ray=unit(g.forward+g.right*((2*sx/g.cols-1)*g.tanx)+g.up*((1-2*sy/g.rows)*g.tany));double t;
    if(!body_hit(body,ray,t)){complete=false;break;}
    V c=planet_light(p,ray*t-body.relative,ray,sunlight,tint,0,body.angular*2);
    samples[q]=c;
   }
   if(!complete)continue; // Keep the existing analytic silhouette and sky coverage.
   // Preserve the established letters/punctuation style. Extra analytic
   // samples stabilize small crater rims; the same ASCII encoder handles every
   // surface and retains its dark character-cell background.
   g.light[i]=(samples[0]+samples[1]+samples[2]+samples[3])*.25f;
  }
 }
}
int atlas_frame(int cols,int rows,double px,double py,double pz,double yaw,double pitch,double fov,double time,double exposure,int selected){
 double began=now();g.error="";
 g.stats[22]=g.stats[23]=0;
 if(!g.stars){g.error="Atlas not initialized";return -1;}
 if(cols<16||cols>320||rows<8||rows>160||!std::isfinite(px)||!std::isfinite(py)||!std::isfinite(pz)||!std::isfinite(yaw)||!std::isfinite(pitch)||!std::isfinite(fov)||
    fov<.05||fov>120||!std::isfinite(time)||std::abs(time)>1e12||!std::isfinite(exposure)||exposure<.05||exposure>10){g.error="Invalid atlas camera/display parameters";return -1;}
 g.cols=cols;g.rows=rows;g.position={px,py,pz};g.time=time;g.exposure=exposure;g.selected=selected;
 double sy=std::sin(yaw),cy=std::cos(yaw),sp=std::sin(pitch),cp=std::cos(pitch);
 g.forward={sy*cp,sp,cy*cp};g.right={-cy,0,sy};g.up={-sy*sp,cp,-cy*sp};D baseRight=g.right,baseUp=g.up;g.right=baseRight*std::cos(g.cameraRoll)+baseUp*std::sin(g.cameraRoll);g.up=baseUp*std::cos(g.cameraRoll)-baseRight*std::sin(g.cameraRoll);g.tany=std::tan(fov*PI/360);g.tanx=g.tany*cols/(rows*1.8);
 size_t n=size_t(cols)*rows;g.light.assign(n,V{});g.glow.resize(n);g.temp.resize(n);g.depth.assign(n,std::numeric_limits<double>::infinity());g.surface.assign(n,-1);g.detailed.assign(n,0);g.output.resize(n*7);
 double environmentStart=now();g.stats[25]=0;
 galaxy::set_footprint(g.environment,float(2*g.tany/rows));
 if(galaxy::enabled(g.environment)){for(int y=0;y<rows;++y)for(int x=0;x<cols;++x){D ray=ray_at(x,y);auto c=galaxy::sample(g.environment,float(ray.x),float(ray.y),float(ray.z));g.light[size_t(y)*cols+x]={c.x,c.y,c.z};if(std::max({c.x,c.y,c.z})>.025f)g.stats[25]+=1;}}
 g.stats[24]=float(now()-environmentStart);
 double stage=now();gather();survey_gather();index_occluders();g.stats[1]=float(now()-stage);stage=now();
 for(const auto& b:g.bodies)draw_body(b);
 for(const auto& b:g.bodies)draw_rings(b);
 sample_surface_detail();
 points();local_activity();g.stats[2]=float(now()-stage);stage=now();belt_points();g.stats[18]=float(now()-stage);stage=now();blur();g.stats[8]=float(now()-stage);
 uint8_t* chars=g.output.data();uint8_t* fg=chars+n;uint8_t* bg=fg+n*3;int ramp=int(std::strlen(RAMP))-1;
 for(size_t i=0;i<n;++i){V light=g.light[i]+g.glow[i]*.25f;float peak=maxv(light);float brightness=1-std::exp(-peak*float(exposure));
  uint8_t ch;
  if(g.surface[i]<-1)ch=planet_glyph(brightness,i,g.cols);
  else {int index=int(std::floor(std::pow(std::max(brightness,0.f),.65f)*ramp+.5f));ch=brightness<.011f?' ':RAMP[std::clamp(index,0,ramp)];}
  if(g.surface[i]==-1){
   // Point sources stay points. Faint bloom colors cells without promoting
   // empty sky into the surface alphabet used for continents/photospheres.
   if(brightness<.025f||maxv(g.light[i])<.012f)ch=' ';
   else if(brightness<.075f)ch='.';
   else if(brightness<.15f)ch=':';
   else if(brightness<.30f)ch='*';
   else if(brightness<.55f)ch='+';
   else ch='#';
  }
  chars[i]=ch;
  // Preserve albedo contrast on detailed terrains: dark basins must stay dark,
  // rather than normalizing almost every gray sample to the same white ink.
  float strength=(g.detailed[i]?std::pow(std::max(brightness,0.f),.70f):(.20f+.80f*std::pow(std::max(brightness,0.f),.33f)))/std::max(peak,1e-20f);
  float color[]={light.x,light.y,light.z},glow[]={g.glow[i].x,g.glow[i].y,g.glow[i].z};
  for(int k=0;k<3;++k){fg[i*3+k]=ch==' '?0:uint8_t(clamp(std::round(color[k]*strength*255),0.f,255.f));bg[i*3+k]=uint8_t(clamp(std::round((1-std::exp(-glow[k]*float(exposure)))*38),0.f,38.f));}
 }
 for(int id:g.surface)if(id!=-1)g.stats[7]+=1;
 g.stats[0]=float(now()-began);g.stats[5]=float(g.count);g.stats[6]=float(g.bodies.size());g.stats[9]=float(g.nodecount);g.stats[10]=float(g.projected.size());g.stats[11]=float(g.labelcount);g.stats[13]=float(g.planets.size());return 0;
}
uint8_t* atlas_output(){return g.output.data();}
void atlas_hide_star(int index){g.hiddenStar=index;}
int atlas_overlay_layers(const uint8_t* overlay,const uint8_t* mask,const uint8_t* objectMask,float strength,int objectIndex){
 if(!overlay||!mask||!std::isfinite(strength)||strength<0||strength>1){g.error="Invalid local scene overlay";return -1;}
 size_t n=size_t(g.cols)*g.rows;if(g.output.size()!=n*7){g.error="Atlas frame unavailable for composition";return -1;}
 for(size_t i=0;i<n;++i){float alpha=strength*(mask[i]/255.f);if(alpha<=0)continue;float hitAlpha=strength*((objectMask?objectMask[i]:mask[i])/255.f);if(hitAlpha>0)g.stats[22]+=1;
  uint8_t old=g.output[i],next=overlay[i];size_t colorBase=n+i*3;
  float before=old==' '?0:std::max({g.output[colorBase],g.output[colorBase+1],g.output[colorBase+2]});
  float after=next==' '?0:std::max({overlay[colorBase],overlay[colorBase+1],overlay[colorBase+2]});
  // Fade radiance continuously. A stable glyph follows the brighter contributor;
  // no pseudo-random cell switching during approach or volume transparency.
  bool local=alpha>=.9999f||(next==' '?alpha>=.5f:after*alpha>=before*(1-alpha));
  if(local){g.output[i]=next;g.stats[23]+=1;if(hitAlpha>.55f&&objectIndex<=-2)g.surface[i]=objectIndex;}
  for(int k=0;k<3;++k){size_t f=n+i*3+k,b=n*4+i*3+k;
   g.output[f]=uint8_t(std::round(overlay[f]*alpha+g.output[f]*(1-alpha)));
   g.output[b]=uint8_t(std::round(overlay[b]*alpha+g.output[b]*(1-alpha)));
  }
 }
 return 0;
}
int atlas_overlay(const uint8_t* overlay,const uint8_t* mask,float strength,int objectIndex){return atlas_overlay_layers(overlay,mask,nullptr,strength,objectIndex);}
float* atlas_stats(){return g.stats;}
float* atlas_labels(){return g.labels;}
int32_t* atlas_label_indices(){return g.labelIndices;}
int atlas_label_count(){return g.labelcount;}
int atlas_pick(float nx,float ny){
 if(!g.cols||!g.rows||!std::isfinite(nx)||!std::isfinite(ny)||nx<0||nx>1||ny<0||ny>1)return -1;
 int x=std::min(int(nx*g.cols),g.cols-1),y=std::min(int(ny*g.rows),g.rows-1);int surface=g.surface[y*g.cols+x];if(surface!=-1)return surface;
 float best=6.25f;int index=-1;
 for(const auto& p:g.projected)if(p.visible){float dx=(p.x+.5f)-nx*g.cols,dy=((p.y+.5f)-ny*g.rows)*1.8f;float distance=dx*dx+dy*dy;
  if(distance<best){best=distance;index=p.index;}}
 return index;
}
void atlas_shutdown(){g=Atlas{};}
}
