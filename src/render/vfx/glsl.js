// Shared GLSL chunks for the SHADOW SIX GPU particle VFX (Approach C).
// Simplex noise: Ashima Arts / Stefan Gustavson (MIT). Curl noise built on top.

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 snoise3(vec3 p){ return vec3(snoise(p), snoise(p+vec3(31.416,-47.853,12.679)), snoise(p+vec3(-23.14,71.29,-5.31))); }
// divergence-free curl of a vector noise potential (finite differences)
vec3 curlNoise(vec3 p){
  const float e=0.1;
  vec3 dx=vec3(e,0.0,0.0), dy=vec3(0.0,e,0.0), dz=vec3(0.0,0.0,e);
  vec3 px0=snoise3(p-dx), px1=snoise3(p+dx), py0=snoise3(p-dy), py1=snoise3(p+dy), pz0=snoise3(p-dz), pz1=snoise3(p+dz);
  float x=(py1.z-py0.z)-(pz1.y-pz0.y); float y=(pz1.x-pz0.x)-(px1.z-px0.z); float z=(px1.y-px0.y)-(py1.x-py0.x);
  return vec3(x,y,z)/(2.0*e);
}
float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;

// Physically-motivated blackbody-ish ramp (K -> linear RGB, normalised), plus radiance scale.
export const BLACKBODY = /* glsl */ `
vec3 blackbody(float T){
  // fit of Planck locus to linear sRGB, 800K..6500K
  T=clamp(T,600.0,8000.0);
  float t=T/100.0; vec3 c;
  c.r = t<=66.0 ? 1.0 : clamp(1.292936*pow(t-60.0,-0.1332047),0.0,1.0);
  c.g = t<=66.0 ? clamp(0.3900816*log(t)-0.6318414,0.0,1.0) : clamp(1.129891*pow(t-60.0,-0.0755148),0.0,1.0);
  c.b = t>=66.0 ? 1.0 : (t<=19.0 ? 0.0 : clamp(0.5432068*log(t-10.0)-1.1962541,0.0,1.0));
  return pow(c, vec3(2.2)); // sRGB-ish curve -> linear
}
// radiance grows ~T^4 (Stefan-Boltzmann), normalised at 1500K
float bbRadiance(float T){ float x=max(T-800.0,0.0)/1000.0; return pow(x,2.5); } // 1.0 @1800K, 4.3 @2600K
// Display-targeted fire emission (linear, pre-tonemap) for fireball puffs and flame tongues. AgX's inset matrix
// leaks red into blue and rolls bright warm colours towards peach/cream, and the theatre LUTs (saturation ~0.85,
// negative vibrance) desaturate further, so a plain blackbody read salmon on screen. This ramp was fitted through
// the r186 AgX curve + the norway/desert grades (tools/render/fire-ramp.py) to land on screen at:
// 2500K+ yellow-white (253,239,166) · 2200K orange-yellow (246,211,69) · 1900K hot orange (235,153,43) ·
// 1600K orange (210,110,34) · 1250K deep red (149,45,20) · 900K ember (72,12,9) · then soot.
// Intensity picks the hue along AgX's path to white; a negative blue (-0.14 r) cancels the inset leak (the
// HDR target is half-float and AgX clamps after its inset transform, so the out-of-gamut value is safe).
// uFireGain 3.0 = the fitted scale.
vec3 fireEmit(float T){
  float lI, a;
  if (T < 900.0)       { float k=clamp((T-650.0)/250.0,0.0,1.0); lI=mix(-6.0,-2.6,k); a=0.12; }
  else if (T < 1250.0) { float k=(T-900.0)/350.0;  lI=mix(-2.6,-0.95,k); a=mix(0.12,0.0,k); }
  else if (T < 1600.0) { float k=(T-1250.0)/350.0; lI=mix(-0.95,0.2,k);  a=0.0; }
  else if (T < 1900.0) { float k=(T-1600.0)/300.0; lI=mix(0.2,0.9,k);    a=mix(0.0,0.01,k); }
  else if (T < 2200.0) { float k=(T-1900.0)/300.0; lI=mix(0.9,1.25,k);   a=mix(0.01,0.25,k); }
  else                 { float k=clamp((T-2200.0)/300.0,0.0,1.6); lI=mix(1.25,1.75,k); a=mix(0.25,0.5,min(k,1.0)); }
  return exp(lI)/3.0*vec3(1.0, a, -0.14);
}
`;

// Scene depth (engine-owned depth texture) -> view-space z (negative in front of the camera).
export const DEPTH = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uOrtho; uniform float uHasDepth;
float sceneViewZ(vec2 suv){
  if (uHasDepth < 0.5) return -1e6;
  float d = texture2D(tDepth, suv).x;
  if (uOrtho > 0.5) return d * (uNear - uFar) - uNear;
  return (uNear * uFar) / ((uFar - uNear) * d - uFar);
}`;

// Linear distance fog matching THREE.Fog (applied to premultiplied colour: lit part -> fog colour, emission attenuated).
export const FOG = /* glsl */ `
uniform vec3 uFogColor; uniform vec2 uFogRange; // near, far (far<=near -> off)
float fogF(float viewDist){ return uFogRange.y > uFogRange.x ? clamp((viewDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0) : 0.0; }`;
