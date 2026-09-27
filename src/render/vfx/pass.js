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
const COMP_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tFx; uniform sampler2D tNoise; uniform float uTime; uniform float uHazeOn;
uniform vec4 uHaze[${NHAZE}]; uniform vec4 uHaze2[${NHAZE}]; uniform int uNH; uniform float uAspect;
uniform vec4 uCopy; // copy rect origin (px) and copy target size (px)
${DEPTH}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes, off=vec2(0.0);
  vec4 f;
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
    vec2 cp=(gl_FragCoord.xy+off*0.012*uRes-uCopy.xy)/uCopy.zw;
    vec4 s=texture2D(tScene, cp);
    f=texture2D(tFx, uv+off*0.004);
    gl_FragColor=vec4(s.rgb*(1.0-f.a)+f.rgb, 1.0);
  } else {
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
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.copyRT.texture }, tFx: { value: this.fxRT.texture }, tNoise: { value: vfx.textures.detail.texture }, uTime: { value: 0 }, uHazeOn: { value: 1 },
        uHaze: { value: Array.from({ length: NHAZE }, () => new THREE.Vector4()) }, uHaze2: { value: Array.from({ length: NHAZE }, () => new THREE.Vector4()) },
        uNH: { value: 0 }, uAspect: { value: 1 }, uCopy: { value: new THREE.Vector4() },
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
    this.smokeScene = new THREE.Scene(); this.hotScene = new THREE.Scene();
    this.drawn = false; this.rect = new THREE.Vector4();
  }

  setSize(w, h) { this._w = w; this._h = h; }

  /** Scissor a render target to rect (x,y,w,h in its own pixels) or disable scissoring. */
  static _sc(rt, r) { if (r) { rt.scissor.set(r.x, r.y, r.z, r.w); rt.scissorTest = true; } else { rt.scissor.set(0, 0, rt.width, rt.height); rt.scissorTest = false; } }

  render(renderer, writeBuffer, readBuffer) {
    const v = this.vfx, w = readBuffer.width, h = readBuffer.height;
    this.needsSwap = false;
    v._prepareFrame(readBuffer, w, h);
    const nSmoke = v.smoke.geometry.instanceCount, nHot = v.hot.geometry.instanceCount, nHaze = v._fillHaze(this.mat.uniforms, w, h);
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
      if (nSmoke) renderer.render(this.smokeScene, v.camera);
      FxPass._sc(this.fxRT, null);
      const u = this.mat.uniforms, haze = nHaze > 0 && v.quality.haze;
      u.uRes.value.set(w, h); u.uAspect.value = w / h; u.uTime.value = v.time; u.uHazeOn.value = haze ? 1 : 0;
      if (haze) {
        // 2a) copy the scene inside the rect (heat haze needs to sample displaced scene colour)
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
    }
    // 3) hot additive particles at full resolution
    if (nHot) { v.hot.material.uniforms.uRes.value.set(w, h); renderer.setRenderTarget(readBuffer); renderer.render(this.hotScene, v.camera); }
    renderer.setClearColor(prevC, prevA); renderer.autoClear = prevAuto; renderer.setRenderTarget(prevT);
  }

  /** The engine disposes every composer pass on a rebuild: a keepAlive pass survives unless `force` (vfx.dispose). */
  dispose(force = false) { if (this.keepAlive && !force) return; this.mat.dispose(); this.copyMat.dispose(); this.quad.dispose(); this.copyQuad.dispose(); this.fxRT.dispose(); this.copyRT.dispose(); this.depthRT.dispose(); this.depthCopy.material.dispose(); this.depthCopy.dispose(); }
}
const _c = new THREE.Color(), _r = new THREE.Vector4();
