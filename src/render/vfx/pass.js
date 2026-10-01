// FxPass: the single post-processing hook for all VFX. Inserted after GTAO and before bloom
// (or before OutputPass when bloom is off), so fire/flash HDR feeds bloom and tone mapping.
//  1. translucent pool (smoke, fire, flames) -> offscreen premultiplied HDR target at a capped
//     absolute resolution (soft particles against the engine depth texture);
//  2. composite: scene * (1 - a) + fx, with heat haze that is occluded by nearer geometry;
//  3. hot pool (sparks, flashes, muzzle petals, tracers) additively at full resolution,
//     manually depth-tested (drawn after smoke, like the volumetric prototype's ordering).
// When nothing is live the pass is a no-op (needsSwap=false, zero draws).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { DEPTH } from './glsl.js';

export const NHAZE = 8;
export const NENT = 64, NCONE = 24;
const COMP_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tFx; uniform sampler2D tNoise; uniform float uTime; uniform float uHazeOn;
uniform vec4 uHaze[${NHAZE}]; uniform vec4 uHaze2[${NHAZE}]; uniform int uNH; uniform float uAspect;
uniform vec4 uCopy; // copy rect origin (px) and copy target size (px)
// ambient layer (chimneys, smoulder): accumulated separately, opacity soft-capped and masked for readability
uniform sampler2D tAmb; uniform float uAmbOn; uniform vec2 uAmbCap; uniform vec2 uMaskK; uniform float uDebug; uniform float uGroundY;
uniform float uTmMode; uniform float uExposure; uniform vec2 uAmbTone; // tone curve model for the perceived cap (1 = AgX, 0 = gamma)
uniform vec4 uEnt[${NENT}]; uniform float uEntR[${NENT}]; uniform int uNE; uniform vec4 uCone[${NCONE * 2}]; uniform int uNC;
uniform mat4 uProjInv; uniform mat4 uCamWorld;
${DEPTH}
// world position of the visible surface behind this pixel (engine depth)
vec3 worldAt(vec2 uv){
  float vz=sceneViewZ(uv); vec2 ndc=uv*2.0-1.0; vec3 vp;
  if(uOrtho>0.5){ vec4 q=uProjInv*vec4(ndc,0.0,1.0); vp=vec3(q.xy/q.w,vz); }
  else { vec4 q=uProjInv*vec4(ndc,1.0,1.0); vec3 d=q.xyz/q.w; vp=d*(vz/d.z); }
  return (uCamWorld*vec4(vp,1.0)).xyz;
}
// opacity cap at this pixel: uAmbCap.x where the smoke overlaps the ground plane (the playfield), uAmbCap.y over
// roofs / tall geometry; times the readability mask: uMaskK.x over units/items/doors (cylinders), uMaskK.y over the
// shown vision cones
float ambMask(vec2 uv){
  // units / items / doors: SCREEN-space capsules (their upright axis in the camera plane), so the whole silhouette
  // and the ground right around it on screen stay clear whatever lies behind (ortho game camera)
  vec4 q=uProjInv*vec4(uv*2.0-1.0,0.0,1.0); vec2 sv=q.xy/q.w;
  float m=uAmbCap.x;
  for(int i=0;i<${NENT};i++){
    if(i>=uNE) break;
    vec4 e=uEnt[i]; float r=uEntR[i]; // view-space xy of the base and of the top, capsule radius (m)
    vec2 ab=e.zw-e.xy; float h=clamp(dot(sv-e.xy,ab)/max(dot(ab,ab),1e-6),0.0,1.0);
    float k=smoothstep(r,r*1.8+0.3,length(sv-e.xy-ab*h));
    m=min(m,uAmbCap.x*mix(uMaskK.x,1.0,k));
  }
  if(uHasDepth<0.5) return m;
  vec3 p=worldAt(uv);
  if(m>=uAmbCap.x) m=mix(uAmbCap.x,uAmbCap.y,smoothstep(uGroundY+1.2,uGroundY+4.5,p.y));
  for(int i=0;i<${NCONE};i++){
    if(i>=uNC) break;
    vec4 c=uCone[i*2]; vec4 c2=uCone[i*2+1]; // (x, z, heading, halfFov), (far, top y)
    vec2 d=p.xz-c.xy; float r=length(d);
    float a=atan(d.y,d.x)-c.z; a-=6.2831853*floor(a/6.2831853+0.5);
    float k=max(max(smoothstep(c2.x,c2.x+1.2,r), smoothstep(c.w,c.w+0.15,abs(a))*step(0.6,r)), smoothstep(c2.y,c2.y+1.0,p.y));
    m=min(m,uAmbCap.x*mix(uMaskK.y,1.0,k));
  }
  return m;
}
// ambient layer, alpha soft-capped (safety) — returns premultiplied; mk = local PERCEIVED cap (display space)
vec4 ambient(vec2 uv, vec2 auv, out float mk){
  mk=1.0;
  if(uAmbOn<0.5) return vec4(0.0);
  vec4 a=texture2D(tAmb,auv);
  if(a.a<0.002) return vec4(0.0);
  mk=ambMask(uv);
  float aa=a.a<=0.6 ? a.a : 0.6+0.32*(1.0-exp(-(a.a-0.6)/0.32)); // linear, then a soft ceiling at 0.92
  return a*(aa/a.a);
}
// displayed value of a grey of linear luminance L (the engine's tone curve: AgX's log2 encoding + its contrast
// polynomial, or a plain gamma for other curves) — perceived change = |ΔD| / max(D, 0.3)
float dispL(float L){
  if(uTmMode>0.5){
    float x=clamp((log2(max(L*uExposure,1e-10))+12.47393)/16.5,0.0,1.0), x2=x*x, x4=x2*x2;
    return clamp(15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232,0.0,1.0);
  }
  return pow(clamp(L*uExposure,0.0,1.0),1.0/2.2);
}
float perceived(float Lb, float Lo){ float db=dispL(Lb); return abs(dispL(Lo)-db)/max(db,0.3); }
// the smoke's own lit luminance stays within a band around the local background (uAmbTone: min, max ratio): the VFX
// light uniforms can disagree with what lights the ground (night theaters, lamps), and a wisp much darker than the
// ground reads as a stain, much brighter as a white sheet. Hue is kept.
vec4 smokeTone(vec4 a, float Lb){
  // reference: the background, but never below a dimly lit ground (over dark roofs / openings smoke may stay lighter)
  float Lr=max(Lb,0.1/max(uExposure,1e-3)), Ls=dot(a.rgb,vec3(0.2126,0.7152,0.0722))/a.a, r=clamp(Ls/Lr,uAmbTone.x,uAmbTone.y);
  return vec4(a.rgb*(r*Lr/max(Ls,1e-5)),a.a);
}
// soft knee of the cap: changes below 60 % of the cap pass untouched, denser parts approach the cap smoothly
float kneeCap(float p, float d){ float k0=0.6*d, r=max(d-k0,1e-4); return p<=k0 ? p : k0+r*(1.0-exp(-(p-k0)/r)); }
// background luminance seen by the cap / tone band: the darkest of 5 taps (±4 px), so ground texture, footprint
// edges and above all falling snowflakes (small, bright, moving) do not modulate the plume pixel by pixel (that
// speckles and boils as the flakes and the smoke drift)
float bgLum(vec2 cp){
  const vec3 W=vec3(0.2126,0.7152,0.0722); vec2 d=4.0/uCopy.zw;
  float l=dot(texture2D(tScene,cp).rgb,W);
  l=min(l,dot(texture2D(tScene,cp+vec2(d.x,d.y)).rgb,W)); l=min(l,dot(texture2D(tScene,cp+vec2(-d.x,d.y)).rgb,W));
  l=min(l,dot(texture2D(tScene,cp+vec2(d.x,-d.y)).rgb,W)); l=min(l,dot(texture2D(tScene,cp-d).rgb,W));
  return l;
}
// scale the ambient layer so the perceived change of this pixel stays under the cap d (darkening AND brightening)
vec4 capPerceived(vec4 a, float Lb, float d){
  float Ls=dot(a.rgb,vec3(0.2126,0.7152,0.0722));
  float p1=perceived(Lb,Lb*(1.0-a.a)+Ls), t=kneeCap(p1,d);
  if(p1<=t+1e-4) return a;
  float lo=0.0, hi=1.0;
  for(int i=0;i<8;i++){ float k=(lo+hi)*0.5; if(perceived(Lb,Lb*(1.0-k*a.a)+k*Ls)>t) hi=k; else lo=k; }
  return a*lo;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes, off=vec2(0.0);
  vec4 f; float mk;
  if(uHazeOn>0.5 || uAmbOn>0.5){
    if(uHazeOn>0.5){
      float sz=sceneViewZ(uv);
      for(int i=0;i<${NHAZE};i++){
        if(i>=uNH) break;
        vec2 d=(uv-uHaze[i].xy)*vec2(uAspect,1.0);
        float r=length(d)/uHaze[i].z;
        // occlusion: geometry clearly in front of the heat source is not distorted
        float occ=1.0-smoothstep(0.0, uHaze2[i].y*0.5, sz-uHaze2[i].x);
        if(uHaze2[i].z>0.5){ // expanding shock ring
          float ring=exp(-pow((r-uHaze2[i].w)/0.12,2.0));
          off+=normalize(d+1e-5)*ring*uHaze[i].w*occ*0.9;
        } else if(r<1.0){
          float w=(1.0-r)*(1.0-r)*uHaze[i].w*occ;
          vec2 n=texture2D(tNoise, uv*vec2(uAspect,1.0)*5.0+vec2(0.0,-uTime*0.35)).rg-0.5;
          off+=w*n*vec2(1.0,1.6);
        }
      }
    }
    vec2 cp=(gl_FragCoord.xy+off*0.012*uRes-uCopy.xy)/uCopy.zw;
    vec4 s=texture2D(tScene, cp);
    f=texture2D(tFx, uv+off*0.004);
    vec4 a=ambient(uv,uv+off*0.004,mk), a0=a;
    float Lb=a.a>0.0 ? bgLum(cp) : 0.0;
    if(a.a>0.0){ a=smokeTone(a,Lb); a0=a; a=capPerceived(a,Lb,mk); }
    if(uDebug>1.5){ gl_FragColor=vec4(Lb, a0.a>0.0 ? dot(a0.rgb,vec3(0.2126,0.7152,0.0722))/a0.a : 0.0, a0.a, a.a); return; }
    if(uDebug>0.5){
      float Lo=Lb*(1.0-a.a)+dot(a.rgb,vec3(0.2126,0.7152,0.0722));
      gl_FragColor=vec4(a.a>0.0 ? perceived(Lb,Lo) : 0.0, mk, texture2D(tAmb,uv).a, a.a); return;
    }
    f=f+a*(1.0-f.a);
    gl_FragColor=vec4(s.rgb*(1.0-f.a)+f.rgb, 1.0);
  } else {
    if(uDebug>0.5){ gl_FragColor=vec4(0.0,1.0,0.0,0.0); return; }
    gl_FragColor=texture2D(tFx, uv); // premultiplied, blended One / OneMinusSrcAlpha onto the scene
  }
}`;
const COPY_FRAG = /* glsl */`uniform sampler2D tSrc; uniform vec4 uSrc; void main(){ gl_FragColor=texture2D(tSrc,(gl_FragCoord.xy+uSrc.xy)/uSrc.zw); }`;

export class FxPass extends Pass {
  constructor(vfx) {
    super();
    this.vfx = vfx; this.needsSwap = false; this.name = 'FxPass';
    this.fxRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.fxRT.texture.name = 'vfx-accum';
    this.copyRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.ambRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.ambRT.texture.name = 'vfx-ambient-accum';
    /** Test/debug readback (`debugAmbient = true`): perceived change (R), local cap (G), raw accumulated opacity (B), final
     *  opacity (A); with `debugMode = 2`: background luminance (R), smoke luminance per unit alpha after the tone band (G). */
    this.debugAmbient = false; this.debugRT = null; this.debugMode = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.copyRT.texture }, tFx: { value: this.fxRT.texture }, tNoise: { value: vfx.textures.detail.texture }, uTime: { value: 0 }, uHazeOn: { value: 1 },
        uHaze: { value: Array.from({ length: NHAZE }, () => new THREE.Vector4()) }, uHaze2: { value: Array.from({ length: NHAZE }, () => new THREE.Vector4()) },
        uNH: { value: 0 }, uAspect: { value: 1 }, uCopy: { value: new THREE.Vector4() },
        tAmb: { value: this.ambRT.texture }, uAmbOn: { value: 0 }, uTmMode: { value: 1 }, uExposure: { value: 1 }, uAmbCap: { value: new THREE.Vector2(0.35, 0.5) }, uAmbTone: { value: new THREE.Vector2(0.5, 1.8) }, uGroundY: { value: 0 }, uMaskK: { value: new THREE.Vector2(0.2, 0.2) }, uDebug: { value: 0 },
        uEnt: { value: Array.from({ length: NENT }, () => new THREE.Vector4()) }, uEntR: { value: new Float32Array(NENT) }, uNE: { value: 0 },
        uCone: { value: Array.from({ length: NCONE * 2 }, () => new THREE.Vector4()) }, uNC: { value: 0 },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        tDepth: vfx.u.tDepth, uRes: { value: new THREE.Vector2(1, 1) }, uNear: vfx.u.uNear, uFar: vfx.u.uFar, uOrtho: vfx.u.uOrtho, uHasDepth: vfx.u.uHasDepth,
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uSrc: { value: new THREE.Vector4() } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: COPY_FRAG, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.quad = new FullScreenQuad(this.mat); this.copyQuad = new FullScreenQuad(this.copyMat);
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.depthRT.texture.name = 'vfx-depth-snapshot';
    this.depthCopy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform sampler2D tSrc; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).r, 0.0, 0.0, 1.0); }',
      depthTest: false, depthWrite: false, blending: THREE.NoBlending }));
    this.smokeScene = new THREE.Scene(); this.hotScene = new THREE.Scene(); this.ambScene = new THREE.Scene();
    this.drawn = false; this.rect = new THREE.Vector4();
  }

  setSize(w, h) { this._w = w; this._h = h; }

  /** Scissor a render target to rect (x,y,w,h in its own pixels) or disable scissoring. */
  static _sc(rt, r) { if (r) { rt.scissor.set(r.x, r.y, r.z, r.w); rt.scissorTest = true; } else { rt.scissor.set(0, 0, rt.width, rt.height); rt.scissorTest = false; } }

  render(renderer, writeBuffer, readBuffer) {
    const v = this.vfx, w = readBuffer.width, h = readBuffer.height;
    this.needsSwap = false;
    v._prepareFrame(readBuffer, w, h);
    const nAmb = v.amb.geometry.instanceCount;
    const nSmoke = v.smoke.geometry.instanceCount + nAmb, nHot = v.hot.geometry.instanceCount, nHaze = v._fillHaze(this.mat.uniforms, w, h);
    const R = (nSmoke || nHaze) ? v._screenRect(w, h, nHaze, this.rect) : null;
    if (!R && !nHot) { this.drawn = false; return; }
    this.drawn = true;
    const prevT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    const prevC = renderer.getClearColor(_c), prevA = renderer.getClearAlpha();
    renderer.autoClear = false;
    // the pass draws INTO readBuffer: sampling a depth texture attached to it is a WebGL feedback loop
    // (INVALID_OPERATION) → snapshot it into a float target first (one full-screen copy, only while effects are live)
    const U = v.u;
    if (U.tDepth.value && U.tDepth.value === readBuffer.depthTexture) {
      if (this.depthRT.width !== w || this.depthRT.height !== h) this.depthRT.setSize(w, h);
      this.depthCopy.material.uniforms.tSrc.value = readBuffer.depthTexture;
      renderer.setRenderTarget(this.depthRT); this.depthCopy.render(renderer);
      U.tDepth.value = this.depthRT.texture;
    }
    if (R) {
      // 1) translucent pool into the capped-resolution accumulation target (only inside the fx rect)
      const s = Math.min(1, v.quality.fxMaxHeight / h), fw = Math.max(1, Math.round(w * s)), fh = Math.max(1, Math.round(h * s));
      if (this.fxRT.width !== fw || this.fxRT.height !== fh) this.fxRT.setSize(fw, fh);
      v.smoke.material.uniforms.uRes.value.set(fw, fh);
      _r.set(Math.floor(R.x * s) - 1, Math.floor(R.y * s) - 1, Math.ceil(R.z * s) + 2, Math.ceil(R.w * s) + 2);
      FxPass._sc(this.fxRT, _r);
      renderer.setRenderTarget(this.fxRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
      if (nSmoke - nAmb) renderer.render(this.smokeScene, v.camera);
      FxPass._sc(this.fxRT, null);
      const u = this.mat.uniforms, haze = nHaze > 0 && v.quality.haze;
      u.uAmbOn.value = nAmb ? 1 : 0;
      if (nAmb) {
        // 1b) ambient pool into its own target: the composite caps and masks its accumulated opacity
        if (this.ambRT.width !== fw || this.ambRT.height !== fh) this.ambRT.setSize(fw, fh);
        renderer.setRenderTarget(this.ambRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); // whole target
        FxPass._sc(this.ambRT, _r); renderer.setRenderTarget(this.ambRT);
        renderer.render(this.ambScene, v.camera);
        FxPass._sc(this.ambRT, null);
        this._ambUniforms(u, renderer.toneMapping, renderer.toneMappingExposure);
      }
      u.uRes.value.set(w, h); u.uAspect.value = w / h; u.uTime.value = v.time; u.uHazeOn.value = haze ? 1 : 0;
      if (haze || nAmb) {
        // 2a) copy the scene inside the rect (heat haze samples displaced scene colour; the ambient perceived cap
        //     needs the scene luminance under the smoke)
        const cw = Math.max(this.copyRT.width, R.z), ch = Math.max(this.copyRT.height, R.w);
        if (cw !== this.copyRT.width || ch !== this.copyRT.height) this.copyRT.setSize(cw, ch);
        this.copyMat.uniforms.tSrc.value = readBuffer.texture; this.copyMat.uniforms.uSrc.value.set(R.x, R.y, w, h);
        _r.set(0, 0, R.z, R.w); FxPass._sc(this.copyRT, _r);
        renderer.setRenderTarget(this.copyRT); this.copyQuad.render(renderer); FxPass._sc(this.copyRT, null);
        u.uCopy.value.set(R.x, R.y, cw, ch);
        this.mat.blending = THREE.NoBlending;
      } else {
        this.mat.blending = THREE.CustomBlending; this.mat.blendSrc = THREE.OneFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
        this.mat.blendSrcAlpha = THREE.ZeroFactor; this.mat.blendDstAlpha = THREE.OneFactor;
      }
      // 2b) composite in place on the scene buffer, scissored to the fx rect
      FxPass._sc(readBuffer, R);
      renderer.setRenderTarget(readBuffer); this.quad.render(renderer);
      FxPass._sc(readBuffer, null);
      if (this.debugAmbient) this._debugRender(renderer, w, h);
    }
    // 3) hot additive particles at full resolution
    if (nHot) { v.hot.material.uniforms.uRes.value.set(w, h); renderer.setRenderTarget(readBuffer); renderer.render(this.hotScene, v.camera); }
    renderer.setClearColor(prevC, prevA); renderer.autoClear = prevAuto; renderer.setRenderTarget(prevT);
  }

  /** Ambient readability uniforms: cap, mask strengths, entity cylinders and shown cones (vfx.ambient), camera. */
  _ambUniforms(u, tm, exposure) {
    const A = this.vfx.ambient, c = this.vfx.camera;
    // caps are PERCEIVED display changes; the composite converts them with the tone curve model (vfx/ambient.js)
    u.uAmbCap.value.set(A.cap, A.capRoof); u.uMaskK.value.set(A.maskUnit, A.maskCone); u.uAmbTone.value.set(A.toneMin, A.toneMax);
    u.uTmMode.value = tm === THREE.AgXToneMapping ? 1 : 0; u.uExposure.value = exposure ?? 1;
    // ground level under the live ambient smoke (lowest terrain sample of its footprint): above it + ~2 m = roofs
    const b = this.vfx.amb.box, gh = this.vfx.groundHeight;
    u.uGroundY.value = Math.min(gh(b.min.x, b.min.z), gh(b.max.x, b.min.z), gh(b.min.x, b.max.z), gh(b.max.x, b.max.z), gh((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2));
    const E = A.entities, C = A.cones, ne = Math.min(E.length, NENT), nc = Math.min(C.length, NCONE);
    c.updateMatrixWorld(); const V = c.matrixWorldInverse;
    for (let i = 0; i < ne; i++) {
      const e = E[i]; _a.set(e.x, e.y0 ?? 0, e.z).applyMatrix4(V); _b.set(e.x, e.top ?? 2, e.z).applyMatrix4(V);
      u.uEnt.value[i].set(_a.x, _a.y, _b.x, _b.y); u.uEntR.value[i] = e.r ?? 0.9;
    }
    for (let i = 0; i < nc; i++) { const q = C[i]; u.uCone.value[i * 2].set(q.x, q.z, q.heading, q.halfFov); u.uCone.value[i * 2 + 1].set(q.far, q.top ?? 3, 0, 0); }
    u.uNE.value = ne; u.uNC.value = nc;
    u.uProjInv.value.copy(c.projectionMatrixInverse); u.uCamWorld.value.copy(c.matrixWorld);
  }

  /** Debug/test: write (final ambient alpha, mask, raw ambient alpha) for the whole frame into debugRT (full res). */
  _debugRender(renderer, w, h) {
    if (!this.debugRT) this.debugRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
    if (this.debugRT.width !== w || this.debugRT.height !== h) this.debugRT.setSize(w, h);
    const u = this.mat.uniforms, blend = this.mat.blending;
    u.uDebug.value = this.debugMode || 1; this.mat.blending = THREE.NoBlending; this.mat.needsUpdate = true;
    renderer.setRenderTarget(this.debugRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    this.quad.render(renderer);
    u.uDebug.value = 0; this.mat.blending = blend; this.mat.needsUpdate = true;
    this.debugFrame = (this.debugFrame || 0) + 1;
  }

  /** Debug/test: read back the debug target → {alpha: Float32Array(w*h), mask, raw, w, h} (rows bottom-up). */
  readDebug(renderer) {
    const rt = this.debugRT; if (!rt) return null;
    const px = new Float32Array(rt.width * rt.height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
    return { px, w: rt.width, h: rt.height };
  }

  /** The engine disposes every composer pass on a rebuild: a keepAlive pass survives unless `force` (vfx.dispose). */
  dispose(force = false) { if (this.keepAlive && !force) return; this.mat.dispose(); this.copyMat.dispose(); this.quad.dispose(); this.copyQuad.dispose(); this.fxRT.dispose(); this.copyRT.dispose(); this.ambRT.dispose(); this.debugRT?.dispose(); this.depthRT.dispose(); this.depthCopy.material.dispose(); this.depthCopy.dispose(); }
}
const _c = new THREE.Color(), _r = new THREE.Vector4(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
