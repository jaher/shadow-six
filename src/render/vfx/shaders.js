// Particle shaders. Translucent pool: lit smoke / blackbody fire puffs / procedural flame tongues,
// premultiplied into the offscreen FX target, soft against the engine depth texture.
// Hot pool: sparks, flashes, muzzle petals, tracers — additive HDR at full resolution after the
// composite, manually depth-tested, with a minimum on-screen size so they read at game zoom.
import { NOISE, BLACKBODY, DEPTH, FOG } from './glsl.js';
import { WIND_GLSL } from '../../world/wind.js';

const FETCH = /* glsl */ `
attribute float pidx;
uniform sampler2D uData; uniform float uTime; uniform vec3 uWind;
${WIND_GLSL}
// Review P3: uWind is the MEAN ground wind; gust fronts of the shared WindField roll through each plume locally
// (the part of a plume inside a travelling gust band is pushed further downwind, then relaxes) so smoke reads the
// same field as grass, trees, flags and water. Pure function of the particle's analytic position → no state.
vec3 gustPush(vec3 p, float age, float wk){
  if (wk <= 0.0 || uWindA.z <= 0.0) return vec3(0.0);
  vec4 w = windSample(p.xz);
  float ex = min(uWindA.z * uWindC.z * 1.5 * w.z * 0.75, 12.0);   // gust excess over the mean (m/s, ground level)
  return vec3(uWindA.x, 0.0, uWindA.y) * ex * wk * 0.6 * (1.0 - exp(-age * 0.8));
}
vec4 fetchD(int i,int k){ return texelFetch(uData, ivec2((i-(i/256)*256)*7+k, i/256), 0); }
vec3 R_, U_, F_;
void camAxes(){
  R_=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
  U_=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  F_=vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);
}`;

export const SMOKE_VERT = /* glsl */ `
precision highp float;
${FETCH}
varying vec2 vUv; varying vec4 vA; varying vec4 vB; varying vec3 vWorld; varying vec3 vR; varying vec3 vU; varying vec3 vF;
varying vec2 vRot; varying float vSize; varying float vViewZ; varying vec4 vC;
${NOISE}
vec2 bzLean; // VOLUME: the fire's lean (per metre of height, world x / z)
float bzLv; // VOLUME: its burn level
void main(){
  camAxes();
  int i=int(pidx+0.5);
  vec4 d0=fetchD(i,0), d1=fetchD(i,1), d2=fetchD(i,2), d3=fetchD(i,3), d4=fetchD(i,4), d5=fetchD(i,5), d6=fetchD(i,6);
  float age=max(uTime-d0.w,0.0), life=d1.w, x=clamp(age/life,0.0,1.0);
  int mode=int(d5.x+0.5); float seed=d5.y;
  float k=max(d2.z,1e-3), e=exp(-k*age), f1=(1.0-e)/k, f2=(age-f1)/k;
  vec3 acc=vec3(k*uWind.x*d5.w, d2.w, k*uWind.z*d5.w);
  vec3 pos=d0.xyz+d1.xyz*f1+acc*f2;
  vec3 vel=d1.xyz*e+acc*f1;
  pos+=gustPush(pos,age,d5.w);
  // ambient wisps (aux flag) share ONE coherent turbulence field (no per-particle offset, ~3 m eddies) so neighbours
  // meander together and the plume reads as a sinuous ribbon that tears, instead of averaging into a uniform veil;
  // the meander grows slowly with age, so the plume leaves the stack as a narrow column and only then wanders
  bool ambW = mode==0 && d6.w>0.5;
  if(d4.z>0.0) pos+=d4.z*(ambW ? curlNoise(pos*0.32+vec3(seed*0.6,-uTime*0.2,seed*0.4))*(1.0-exp(-age*0.35))
                               : curlNoise(pos*0.16+vec3(seed*17.0,-uTime*0.12,seed*5.0))*(1.0-exp(-age*0.7)));
  float grow = mode==1 ? 1.0-pow(1.0-x,4.0) : (mode==0 ? 1.0-pow(1.0-x,2.2) : sqrt(x));
  float size=mix(d2.x,d2.y,grow);
  float fin=clamp(age/max(min(d6.z,life*0.3),1e-3),0.0,1.0);
  float fout = mode==0 ? pow(1.0-x, ambW ? 1.4 : 1.3) : (mode==1 ? (1.0-smoothstep(0.45,1.0,x)) : (1.0-smoothstep(0.55,1.0,x)));
  float T = 300.0+(d4.x-300.0)*exp(-age/max(d4.y,1e-3));
  vec2 c=position.xy; vec3 wp;
  if(mode==2){
    // flame tongue: anchored at its base, tall, leaning with the wind (quadratic bend)
    float h01=c.y+0.5, H=size*max(d6.w,1.0);
    vec3 lean=(vec3(uWind.x,0.0,uWind.z)+gustPush(pos,9.0,1.0)*1.2)*0.16*d5.w; float ll=length(lean); if(ll>0.9) lean*=0.9/ll;
    wp=pos+R_*c.x*size*(1.0-0.35*h01)+vec3(0.0,1.0,0.0)*h01*H+U_*0.0+lean*h01*h01*H;
    wp+=R_*c.x*0.0;
  } else if(mode==4){
    // VOLUME (sustained fire): the screen rectangle of the fire's box — base on the fuel, half-size rx × rz turned by its
    // yaw (d4.w), height Ht, sheared downwind by the fire-level lean (gusts at its foot); the fragment raymarches it
    pos=d0.xyz;
    // the burn level over the fire's age (blaze.js blazeLevel: catches over d1.x s, holds to d1.y, dies down to a smoulder
    // by 0.86·burn (d1.z), smoulders on) — one long-lived particle per bed, so its level is computed, not re-emitted
    float fa=age+d4.y, lv=min(1.0,0.25+0.75*fa/max(d1.x,1e-3)), bn=d1.z; // (d4.y: the fire's age at this particle's birth)
    if(bn>0.0){ float e1=bn*0.86, e0=min(d1.y,e1-1e-3);
      if(fa>=e1) lv*=max(0.08,0.12-0.04*(fa-e1)/max(bn-e1,1e-3)); else if(fa>e0) lv*=1.0-0.88*pow((fa-e0)/max(e1-e0,1e-3),0.85); }
    bzLv=lv;
    float rx=size, rz=size*d5.z, Ht=size*d6.w*(0.5+0.5*lv), yaw=d4.w; // (a dying fire's box is lower: fewer pixels to march)
    vec3 ex=vec3(cos(yaw),0.0,-sin(yaw)), ez=vec3(sin(yaw),0.0,cos(yaw));
    vec3 lean=(vec3(uWind.x,0.0,uWind.z)+gustPush(pos,9.0,1.0))*0.08*d6.y; float ll=length(lean); if(ll>0.45) lean*=0.45/ll;
    float r0=1e9, r1=-1e9, u0=1e9, u1=-1e9;
    for(int k=0;k<8;k++){
      vec3 q=pos+ex*(rx*((k&1)==1?1.0:-1.0))+ez*(rz*((k&2)==2?1.0:-1.0))+((k&4)==4?(vec3(0.0,Ht,0.0)+lean*Ht):vec3(0.0));
      float a1=dot(q,R_), b1=dot(q,U_); r0=min(r0,a1); r1=max(r1,a1); u0=min(u0,b1); u1=max(u1,b1);
    }
    wp=R_*mix(r0,r1,c.x+0.5)+U_*mix(u0,u1,c.y+0.5)+F_*dot(pos,F_);
    bzLean=lean.xz;
  } else {
    // puffs: billboard, optionally stretched along screen-space velocity (dirt jets, fast smoke)
    vec2 sv=vec2(dot(vel,R_),dot(vel,U_)); float sl=length(sv);
    vec2 ax= sl>1e-3 ? sv/sl : vec2(0.0,1.0);
    float len=size*(1.0+d5.z*sl);
    pos.y=max(pos.y,size*0.12);
    vec2 off=ax*c.y*len+vec2(ax.y,-ax.x)*c.x*size;
    wp=pos+R_*off.x+U_*off.y;
  }
  float ang=seed*6.2831+d4.w*age;
  vRot=vec2(cos(ang),sin(ang));
  vUv=c; vA=vec4(d3.rgb, d3.a*fin*fout); vB=vec4(T,x,float(mode),seed);
  vC=vec4(d6.x, d6.y, age, d6.w);
  if(mode==4){
    // per volume, not per pixel: the fire's breathing (puffing ~1.5/sqrt(D) Hz, fire-level: the same curve drives its light,
    // blaze.js blazePuff) → vB.w, and the uneven fuel bed (slow, large-scale: taller flames over some parts) → vC.y
    float fz=d3.r, ph=d3.g, Sa=dot(pos,R_);
    vB.w=0.5*sin(6.2832*fz*uTime+ph)+0.3*sin(10.9*fz*uTime+2.3*ph)+0.2*sin(3.1*fz*uTime+0.6*ph);
    vC.y=clamp(0.5+0.28*sin(Sa*0.5+ph)+0.16*sin(Sa*1.25-uTime*0.31+2.0*ph)+0.1*sin(uTime*0.17+Sa*0.21),0.0,1.0);
  }
  vWorld=wp; vR=R_; vU=U_; vF=F_; vSize=size;
  if(mode==4){
    vB.x=d4.x; // (core temperature: no cooling)
    vR=pos; vU=vec3(bzLean,d4.w); vF=vec3(bzLv,vB.w,size*d6.w/1.6); vRot=vec2(size,size*d5.z); vSize=size*d6.w*(0.5+0.5*bzLv);
    vA.a=d3.a*fin*(1.0-step(0.75,seed)*smoothstep(life-1.5,life,age)); // (only the fire's last volume fades out)
  }
  vec4 mv=viewMatrix*vec4(wp,1.0); vViewZ=mv.z;
  gl_Position=projectionMatrix*mv;
}`;

export const SMOKE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPuff; uniform sampler2D uDetail; uniform float uTime;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform vec3 uGroundColor;
uniform vec4 uLightPos[6]; uniform vec3 uLightCol[6]; uniform float uFireGain; uniform float uSoftK; uniform float uFlameGain;
uniform highp sampler3D uVol; uniform float uVolSteps;
${DEPTH}
${FOG}
varying vec2 vUv; varying vec4 vA; varying vec4 vB; varying vec3 vWorld; varying vec3 vR; varying vec3 vU; varying vec3 vF;
varying vec2 vRot; varying float vSize; varying float vViewZ; varying vec4 vC;
${BLACKBODY}
float softFade(float fadeDist){
  float sz=sceneViewZ(gl_FragCoord.xy/uRes);
  return clamp((vViewZ-sz)/max(fadeDist,0.05),0.0,1.0);
}
// VOLUME fire (mode 4): the box and the field, set by main, read by flameD
vec3 gB, gEx, gEz; float gKz, gFx, gFz, gHs, gTt, gRx, gRz, gHt;
// flame density at pu (box frame: base-relative, lean removed), > 0 inside a flame; hh = height / flame height,
// nf = the tongue noise (brightness), ws = the slow warp field (soot)
float gBs, gWv; // (flameD: the last sample's envelope term — how central and low it is in the fire —, its slow field)
float flameD(vec3 pu, out float hh, out float nf, out float ws){
  float y=pu.y; hh=max(y,0.0)/gHs;
  float lx=dot(pu,gEx), lz=dot(pu,gEz);
  float env=1.0-length(vec2(lx/gFx,lz/gFz));
  float edge=max(max(abs(lx)/gRx,abs(lz)/gRz),y/gHt);
  float base=0.9*env*(1.0-hh)+0.15-1.2*hh-smoothstep(0.82,0.98,edge)*3.0;
  gBs=0.9*max(env,0.0)*(1.0-min(hh,1.0))+0.15-1.2*hh;
  // rise: xi = ∫dY/v with v ≈ 1.2 m/s at the fuel, 3 m/s at 3 m. Tongues about twice as tall as wide at the fuel and at
  // most ~3× at the top (the linear term caps the stretch: more read as vertical streaks over big fires)
  float xi=(0.5*log(1.0+max(y,0.0)*1.25)+0.2*max(y,0.0))*gKz;
  vec3 wq=(gB+pu)*gKz;
  vec3 w=texture(uVol,vec3(wq.x*0.33+0.13,(xi-gTt*0.55)*0.42,wq.z*0.33+0.71)).rgb-0.5; // slow warp, rising at half speed
  ws=w.g*2.0+0.4*env; gWv=w.g;                                       // (soot density; a tongue's own heat, ±0.5)
  nf=0.5;
  if(base<-1.45) return base;                                        // (no noise can lift it — but for a >2.5σ fleck: skip the lookup)
  // flicker: the slow warp field's third channel rises at half the flames' speed, so tongues pass through stronger and
  // weaker patches of it — they flare and fall back independently (no extra lookup)
  float fl=w.b;
  vec4 n=texture(uVol,vec3(wq.x*0.8+w.x*0.7,(xi-gTt)*0.6+w.y*0.35,wq.z*0.8+w.z*0.7));
  nf=n.r;
  // fbm bodies + ridged turbulence (creases, flamelets; weaker over big fires: bigger tongues)
  // (the ridged channel's finest octave crinkles the flame skin at zoom 2: kept light, a little more at the tips)
  return base+(n.r-0.5)*2.4+fl*0.45*(0.3+hh)+(n.g-0.32)*(0.1+0.3*hh)*min(1.0,gKz*1.15);
}
vec3 fxLights(vec3 N, float wrapK){
  vec3 fl=vec3(0.0);
  for(int i=0;i<6;i++){
    vec3 d=uLightPos[i].xyz-vWorld; float r=uLightPos[i].w;
    float att=1.0/(1.0+dot(d,d)/(r*r));
    float wrap=clamp(dot(N,normalize(d))*0.5+wrapK,0.0,1.0);
    fl+=uLightCol[i]*att*wrap;
  }
  return fl;
}
void main(){
  int mode=int(vB.z+0.5); float x=vB.y, seed=vB.w, T=vB.x;
  float fogK=fogF(-vViewZ);
  if(mode==2){
    // procedural flame tongue: tapering body distorted by upward-scrolling noise; the noise also
    // cuts the top into separate licks. Hot core, cooler orange/red rim, thin soot above.
    float u=vUv.x, h=vUv.y+0.5, age=vC.z;
    float spd=1.4+seed*0.9;
    vec2 q=vec2(u*1.1+seed*7.3, h*0.45-age*spd*0.6);
    float n1=texture2D(uDetail,q).r, n2=texture2D(uDetail,q*2.3+vec2(0.37+seed,-age*1.3)).g;
    float n=n1*0.62+n2*0.38;
    float xo=u+(n-0.5)*0.55*h*h+sin(age*6.0+seed*20.0+h*4.0)*0.035*h;
    float w=0.27*pow(max(1.0-h,0.0),0.7)+0.012;
    float prof=1.0-abs(xo)/w;
    float cut=h+(n-0.5)*0.95*h;
    float top=1.0-smoothstep(0.38,0.9,cut);
    float body=smoothstep(0.0,0.35,prof)*top*smoothstep(0.0,0.07,h);
    float a=vA.a*body;
    float soft=softFade(uSoftK*vSize*0.6);
    if(a*soft<0.003) discard;
    float core=smoothstep(0.25,0.9,prof)*(1.0-smoothstep(0.15,0.85,cut));
    float Tl=mix(1500.0,T+150.0,clamp(core*(0.8+0.3*n),0.0,1.0));
    vec3 em=fireEmit(Tl)*uFireGain*uFlameGain*a*soft*(1.0-fogK);
    gl_FragColor=vec4(em, 0.0);
    return;
  }
  if(mode==4){
    // VOLUME — a sustained fire raymarched through its box (art/realistic-flames; the user: "Fire looks like billboards,
    // more volumetric please"). The flames are the inside of a turbulent density field: domain-warped fbm stretched
    // upward (tongue bodies) + ridged turbulence (creases, flamelets), advected upward with buoyant acceleration
    // (xi = ∫dY/v) while its warp rises at half the speed (the tongues deform as they rise, nothing scrolls), against a
    // threshold that rises with height — solid over the fuel, separate tongues with dark gaps between them higher up,
    // breaking off into flamelets at the top. The ray finds each tongue's surface (coarse march + bisection: crisp
    // edges, no sampling noise), then measures how much flame it crosses behind it: thin tips are translucent and deep
    // red, thick flame near the fuel opaque and yellow-white (up to two tongues deep). Above the flames the gas is soot,
    // dark and lit by the fire from below. The opaque scene ends the ray (exact occlusion, soft where it touches).
    vec3 wpos=vWorld; vec2 lean=vU.xy; float yaw=vU.z, lvl=vF.x, puff=vF.y, Hf=vF.z;
    gB=vR; gRx=vRot.x; gRz=vRot.y; gHt=vSize; gKz=vC.x>0.0?vC.x:1.0; gFx=gRx/1.2; gFz=gRz/1.2; gTt=mod(uTime,50.0);
    vec3 Fw=vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]);
    vec3 rd=uOrtho>0.5 ? -Fw : normalize(wpos-cameraPosition);
    gEx=vec3(cos(yaw),0.0,-sin(yaw)); gEz=vec3(sin(yaw),0.0,cos(yaw));
    vec3 o=wpos-gB; o.xz-=lean*o.y; vec3 d=rd; d.xz-=lean*d.y;       // box frame: base-relative, lean removed
    vec3 ol=vec3(dot(o,gEx),o.y,dot(o,gEz)), dl=vec3(dot(d,gEx),d.y,dot(d,gEz));
    dl=(step(0.0,dl)*2.0-1.0)*max(abs(dl),vec3(1e-5));
    vec3 ta=(vec3(-gRx,0.0,-gRz)-ol)/dl, tb=(vec3(gRx,gHt,gRz)-ol)/dl, tmn=min(ta,tb), tmx=max(ta,tb);
    float t0=max(max(tmn.x,tmn.y),tmn.z), t1=min(min(tmx.x,tmx.y),tmx.z);
    float tS=(sceneViewZ(gl_FragCoord.xy/uRes)-vViewZ)/dot(rd,Fw);    // where the opaque scene stops the ray
    float tE=min(t1,tS);
    if(tE<=t0) discard;
    // uneven fuel: taller flames over some parts of the bed (a slow, large-scale field at the ray's entry)
    vec3 pe=(gB+o+d*t0)*gKz;
    float fuel=clamp((texture(uVol,vec3(pe.x*0.09,gTt*0.02,pe.z*0.09)).b-0.5)*2.5+0.5,0.0,1.0);
    gHs=Hf*1.1*(1.0+0.15*puff)*(0.4+0.6*lvl)*(0.75+0.5*fuel);
    float sootK=vA.b, Tc=T, dtc=clamp(0.09+0.022*Hf,0.09,0.2), ds=dtc*0.5; // (the depth samples span ~1.5 steps: smooth)
    int N=int(clamp(ceil((tE-t0)/dtc),4.0,uVolSteps)); dtc=(tE-t0)/float(N);
    float jit=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715)))+fract(uTime*60.0)*0.618034);
    vec3 amb=uSkyColor*0.9+uSunColor*0.25, glow=vec3(1.0,0.36,0.09)*1.6*lvl, col=vec3(0.0);
    float tr=1.0, t=t0+dtc*(0.2+0.6*jit), tp=t0, Dp=-1.0, hh, nf, ws; int layers=0;
    for(int i=0;i<48;i++){
      if(i>=N || tr<0.03 || t>=tE) break;
      vec3 pu=o+d*t;
      float D=flameD(pu,hh,nf,ws);
      // soot: soft, above the flames, thick where the flames feed it, dissolving higher up
      float sm=sootK*smoothstep(0.5,1.05,hh)*smoothstep(-0.25,0.45,ws)*(1.0-smoothstep(1.15,1.5,pu.y/Hf));
      if(sm>0.001){ float as=1.0-exp(-sm*2.4*dtc); col+=tr*as*vec3(0.035,0.031,0.028)*(amb+glow*0.45*(1.0-smoothstep(0.7,1.3,hh))); tr*=1.0-as; }
      if(D>0.0 && Dp<=0.0){
        // into a tongue: its surface (3 bisection steps), then the flame the ray crosses behind it
        float a=tp, b=t;
        for(int k=0;k<3;k++){ float m=(a+b)*0.5; float hm,nm,wm; if(flameD(o+d*m,hm,nm,wm)>0.0) b=m; else a=m; }
        float tau=0.0, hs=hh, bs=0.0, wv=0.0;
        for(int k=0;k<3;k++){ float h2,n2,w2; float Dk=flameD(o+d*(b+(float(k)+0.5)*ds),h2,n2,w2); tau+=max(Dk,0.0); if(k==0){ hs=h2; bs=gBs; wv=gWv; } }
        float soft=smoothstep(0.0,0.25,tS-b);                       // soft where it touches the geometry
        float af=(1.0-exp(-tau*ds*16.0))*soft;
        // temperature: hot deep in the flame near the fuel, falling with height and towards the flame's skin
        // temperature by height in the fire and how central the flame is: yellow-white low over the fuel, orange body, deep
        // red tips; each tongue a little hotter or cooler (the slow field: smooth across a tongue, no specks)
        // (+ how deep the ray goes into this tongue — averaged over its 3 samples, so it follows the tongue's shape without
        // picking out isolated specks: tongue centres hotter and brighter than their translucent edges)
        float dep=smoothstep(0.05,0.8,tau/3.0);
        float hot=(1.0-smoothstep(0.0,0.6,hs))*(0.4+0.6*clamp(bs,0.0,1.0));
        float Tl=mix(1250.0,Tc,pow(clamp(hot*0.85+dep*0.3,0.0,1.0),1.2))+200.0*wv*(0.3+hot);
        col+=tr*af*fireEmit(Tl)*uFireGain*uFlameGain*(0.62+0.55*dep)*(0.88+0.3*wv);
        tr*=1.0-af;
        if(++layers>=2 || af>0.55) break;                              // (a second tongue only through a translucent one)
        t=b+3.0*ds; tp=t; Dp=flameD(o+d*t,hh,nf,ws); t+=dtc; continue;
      }
      Dp=D; tp=t; t+=dtc;
    }
    float k=vA.a*(1.0-fogK);
    gl_FragColor=vec4(mix(col,uFogColor*(1.0-tr),fogK)*k,(1.0-tr)*k);
    return;
  }
  // SMOKE / FIRE puffs
  vec2 ruv=vec2(vRot.x*vUv.x-vRot.y*vUv.y, vRot.y*vUv.x+vRot.x*vUv.y);
  ruv=clamp(ruv,-0.49,0.49);
  float cell=floor(fract(seed*7.13)*8.0)+(vC.x>0.5?8.0:0.0);
  vec2 cxy=vec2(mod(cell,4.0),floor(cell/4.0));
  vec4 tx=texture2D(uPuff,(cxy+ruv+0.5)/4.0);
  float dt=texture2D(uDetail, vUv*0.55+vec2(seed*3.1,seed*7.7)+vec2(0.0,-uTime*0.03)).r;
  float dt2=texture2D(uDetail, vUv*1.3+vec2(seed*5.3,seed*1.7)+vec2(uTime*0.02,0.0)).g;
  float ero = (mode==1 ? mix(0.05,0.5,x) : mix(0.05,0.45,x)) + vC.y*(0.2+0.5*x);
  float cov = tx.a*(vC.x>0.5 ? (vC.w>0.5 && mode==0 ? 1.3 : 1.7) : 1.0); // ambient wisps: softer edges (no hard rims that pop as they drift)
  // ambient wisps: softer, less grainy body (fine detail reads as dirt from the game camera), torn only as they age
  float dens=vC.w>0.5 && mode==0 ? smoothstep(ero,1.0,cov*(0.78+(0.22+0.3*x)*dt+0.1*dt2)) : smoothstep(ero,1.0,cov*(0.62+0.5*dt+0.25*dt2));
  float alpha=dens*vA.a;
  alpha*=softFade(uSoftK*vSize);
  if(alpha<0.002) discard;
  vec2 nxy=tx.rg*2.0-1.0; nxy=vec2(vRot.x*nxy.x+vRot.y*nxy.y, -vRot.y*nxy.x+vRot.x*nxy.y);
  vec3 N=normalize(nxy.x*vR+nxy.y*vU+sqrt(max(1.0-dot(nxy,nxy),0.0))*vF + (dt-0.5)*0.4*vU);
  float ndl=dot(N,uSunDir);
  float diff=pow(clamp(ndl*0.5+0.5,0.0,1.0),2.2);
  float selfSh=mix(1.0,0.35,tx.b*vA.a);
  vec3 amb=mix(uGroundColor,uSkyColor,N.y*0.5+0.5);
  vec3 fl=fxLights(N,0.65);
  float Tl=300.0+(T-300.0)*(0.42+0.58*tx.b)*(0.7+0.6*dt);
  vec3 alb=mix(vA.rgb, vec3(0.13,0.12,0.11), mode==0 ? x*0.3 : x*0.2);
  // burning gas is optically thick soot: suppress the sky/snow-lit grey where it glows so the flame
  // colour is not washed towards salmon; it reappears as the puff cools into smoke
  // (the flash light sitting inside the fireball would otherwise light that soot peach-white too)
  float hot = mode==1 ? smoothstep(800.0,1600.0,Tl) : 0.0;
  alb*=mix(1.0,0.3,hot);
  vec3 col=alb*(uSunColor*diff*selfSh+amb+fl*(1.0-0.9*hot));
  if(mode==0 && vC.w>0.5){
    // AMBIENT wood smoke (chimneys, smoulder): fine particles → strong forward scattering. Thin edges glow warm on the
    // sun side when the view looks towards the sun (Henyey-Greenstein g=0.55), the optically thick core stays darker
    // and the underside takes the darker ground bounce; fresh smoke near the stack is denser/greyer, old smoke bluer.
    // Smooth shading only: a wisp is a few dozen pixels on screen, so the atlas normal / thickness detail turns into
    // per-pixel grain that boils as the wisps drift (reads as dirt, not smoke) → a soft dome normal, density self-shadow.
    vec2 q=vUv*2.0; vec3 Nd=normalize(q.x*vR+q.y*vU+sqrt(max(1.0-dot(q,q),0.0))*vF);
    vec3 Na=normalize(mix(Nd,N,0.15)); float ndA=dot(Na,uSunDir);
    float mu=dot(-uSunDir,normalize(vF));
    float g=0.55, hg=(1.0-g*g)/pow(max(1.0+g*g-2.0*g*mu,1e-3),1.5)*0.25;
    float thin=1.0-smoothstep(0.25,0.9,dens);
    float sh=mix(1.0,0.6,smoothstep(0.2,0.85,dens)*vA.a);         // optically thick core: self-shadowed, darker
    float wrapD=clamp(ndA*0.6+0.4,0.0,1.0);                        // soft wrap: a plume is lit through its body
    col=alb*(uSunColor*(wrapD*sh*0.9+hg*thin*0.8)+mix(uGroundColor,uSkyColor,Na.y*0.5+0.5)*mix(0.6,1.1,Na.y*0.5+0.5)*sh+fxLights(Na,0.65));
    col*=mix(vec3(1.0),vec3(0.94,0.98,1.06),x);
  }
  col=mix(col,uFogColor,fogK);
  // cooling fire only glows in the dense interior of a puff (red pockets inside soot); thin fringes over
  // snow would otherwise tint pink. Hot puffs glow through their whole body.
  float cool1 = 1.0-smoothstep(1300.0,2100.0,T);
  float emA = mode==1 ? pow(dens,mix(0.8,2.6,cool1))*mix(smoothstep(0.0,0.2,vA.a),vA.a,cool1) : dens*vA.a;
  vec3 em=fireEmit(Tl)*uFireGain*emA*(1.0-fogK);
  gl_FragColor=vec4(col*alpha+em, alpha);
}`;

export const HOT_VERT = /* glsl */ `
precision highp float;
${FETCH}
uniform float uPxWorld; // world metres per output pixel (orthographic game camera)
varying vec2 vUv; varying vec4 vA; varying vec4 vB; varying float vViewZ; varying float vLen;
void main(){
  camAxes();
  int i=int(pidx+0.5);
  vec4 d0=fetchD(i,0), d1=fetchD(i,1), d2=fetchD(i,2), d3=fetchD(i,3), d4=fetchD(i,4), d5=fetchD(i,5), d6=fetchD(i,6);
  float age=max(uTime-d0.w,0.0), life=d1.w, x=clamp(age/life,0.0,1.0);
  int mode=int(d5.x+0.5); float seed=d5.y;
  float k=max(d2.z,1e-3), e=exp(-k*age), f1=(1.0-e)/k, f2=(age-f1)/k;
  vec3 acc=vec3(k*uWind.x*d5.w, d2.w, k*uWind.z*d5.w);
  vec3 pos=d0.xyz+d1.xyz*f1+acc*f2;
  vec3 vel=d1.xyz*e+acc*f1;
  if(d4.z>0.0) pos+=d4.z*vec3(sin(uTime*3.1+seed*40.0),0.5*sin(uTime*2.3+seed*17.0),cos(uTime*2.7+seed*29.0))*0.3*(1.0-exp(-age));
  float size=mix(d2.x,d2.y,x);
  float T = 300.0+(d4.x-300.0)*exp(-age/max(d4.y,1e-3));
  vec2 c=position.xy; vec3 wp; float minW=d6.x*uPxWorld; // d6.x = min width in pixels
  if(mode==1){ // flash glow (billboard)
    float s=max(size,minW); wp=pos+(R_*c.x+U_*c.y)*s; vLen=s;
  } else {
    vec3 dir = mode==2 ? d1.xyz : vel;
    if(mode==0) pos.y=max(pos.y,0.03);
    vec2 sv=vec2(dot(dir,R_),dot(dir,U_)); float sl=length(sv); vec2 ax= sl>1e-4 ? sv/sl : vec2(1.0,0.0);
    float w=max(size,minW), len;
    if(mode==2) len=max(size*d5.z, d6.y*uPxWorld);               // muzzle petal, base at muzzle
    else if(mode==3) len=min(d5.z, length(vel)*age+0.01);          // tracer: fixed streak length, grows from muzzle
    else len=max(size+sl*d5.z, w*2.0);                               // spark: motion streak
    float along = mode==0 ? c.y : c.y+0.5;
    if(mode==3) along=c.y-0.5;                                        // tracer trails behind its head
    vec2 off=ax*along*len+vec2(-ax.y,ax.x)*c.x*w;
    wp=pos+R_*off.x+U_*off.y; vLen=len/max(w,1e-4);
  }
  vUv=c; vA=vec4(d3.rgb, d3.a); vB=vec4(T,x,float(mode),seed);
  vec4 mv=viewMatrix*vec4(wp,1.0); vViewZ=mv.z;
  gl_Position=projectionMatrix*mv;
}`;

export const HOT_FRAG = /* glsl */ `
precision highp float;
uniform float uFireGain;
${DEPTH}
${FOG}
varying vec2 vUv; varying vec4 vA; varying vec4 vB; varying float vViewZ; varying float vLen;
${BLACKBODY}
void main(){
  // manual depth test against the opaque scene (the hot pass draws after the composite)
  if(sceneViewZ(gl_FragCoord.xy/uRes) > vViewZ+0.15) discard;
  int mode=int(vB.z+0.5); float x=vB.y, seed=vB.w, T=vB.x;
  float fade=1.0-fogF(-vViewZ);
  vec3 em;
  if(mode==1){ // flash glow: albedo = HDR colour
    float r2=dot(vUv,vUv)*4.0; float g=(exp(-r2*7.0)+0.18*exp(-r2*2.2))*(1.0-smoothstep(0.6,1.0,r2));
    em=vA.rgb*g*pow(1.0-x,1.5)*vA.a;
  } else if(mode==2){ // muzzle petal: hot white core at the muzzle, orange tip, ragged edge
    float u=vUv.y+0.5, v=abs(vUv.x)*2.0;
    float w=pow(max(sin(3.14159*pow(u,0.6)),0.0),0.9)*(1.0-0.45*u);
    float core=(1.0-smoothstep(w*0.3,w,v))*smoothstep(0.0,0.06,u);
    vec3 c0=vec3(10.0,7.2,3.4), c1=vec3(4.2,1.5,0.32);
    em=mix(c0,c1,pow(u,0.7))*core*vA.a*(1.0-0.5*x);
  } else if(mode==3){ // tracer: bright head, fading tail
    float u=vUv.y+0.5, v=abs(vUv.x)*2.0;
    float g=(1.0-smoothstep(0.2,1.0,v))*pow(u,1.6);
    em=blackbody(T)*bbRadiance(T)*uFireGain*g*vA.a;
  } else { // spark / ember: hot capsule
    float v=abs(vUv.x)*2.0, u=abs(vUv.y)*2.0;
    float g=(1.0-smoothstep(0.15,1.0,v))*(1.0-smoothstep(0.6,1.0,u));
    em=blackbody(T)*bbRadiance(T)*uFireGain*1.6*g*vA.a;
  }
  em*=fade;
  if(dot(em,vec3(1.0))<1e-4) discard;
  gl_FragColor=vec4(em,0.0);
}`;
