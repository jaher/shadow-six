/**
 * FFTOcean — Tessendorf spectral ocean on the GPU (WebGL2 float render targets).
 *
 *   h0(k)          : JONSWAP spectrum x directional spreading x gaussian noise (computed once, on GPU)
 *   H(k,t)         : h0(k) e^{iwt} + conj(h0(-k)) e^{-iwt}, deep/finite-depth dispersion
 *   IFFT           : Stockham radix-2, log2(N) horizontal + log2(N) vertical passes, 2 complex/texel
 *                    packed as (h + i*Dx, Dz + i*0) so one pair of ping-pong targets does 3 real fields
 *   maps           : displacement (Dx*chop, h, Dz*chop) and normal+Jacobian foam (foam accumulates
 *                    with exponential decay in a ping-pong target → trailing whitecaps)
 * Outputs are world-space tiling textures of `patch` metres: displacementTexture, normalTexture
 * (rg = slope-normal xz, b = foam 0..1, a = Jacobian).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Loop period of the ocean (s): all wave frequencies are multiples of 2*pi/FFT_PERIOD. */
export const FFT_PERIOD = 256;
const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const H0_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float N, L, U, fetch, windAngle, spread, cutoff, seed, depth, spreadNorm;
const float PI = 3.14159265, G = 9.81;
float hash(vec2 p){ p = fract(p*vec2(443.897,441.423) + seed); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
vec2 gauss(vec2 p){ float u1 = max(hash(p), 1e-6), u2 = hash(p+vec2(17.3, 31.7)); float r = sqrt(-2.0*log(u1)); return r*vec2(cos(2.0*PI*u2), sin(2.0*PI*u2)); }
float omegaOf(float k){ return sqrt(G*k*tanh(min(k*depth, 20.0))); }
// JONSWAP wavenumber spectrum S(kx,kz) [m^4]
float spectrum(vec2 kv){
  float k = length(kv); if (k < 1e-5) return 0.0;
  float w = omegaOf(k);
  float wp = 22.0*pow(G*G/(U*fetch), 1.0/3.0);
  float alpha = 0.076*pow(U*U/(fetch*G), 0.22);
  float sig = w <= wp ? 0.07 : 0.09;
  float r = exp(-(w-wp)*(w-wp)/(2.0*sig*sig*wp*wp));
  float Sw = alpha*G*G/pow(w,5.0)*exp(-1.25*pow(wp/w,4.0))*pow(3.3, r);
  // dw/dk (finite depth approx: deep-water form is accurate enough for the displayed band)
  float dwdk = G/(2.0*w);
  float th = atan(kv.y, kv.x) - windAngle;
  float c = cos(th);
  // cos^2s spreading, s grows toward the peak; opposing waves damped to 3%
  float s = spread;
  float D = (pow(max(c, 0.0), 2.0*s) + 0.03*c*c) * spreadNorm;
  float damp = exp(-k*k*cutoff*cutoff);
  return Sw*dwdk/k*D*damp;
}
void main(){
  vec2 n = floor(vUv*N) - N*0.5;
  float dk = 2.0*PI/L;
  vec2 k = n*dk;
  float a = sqrt(0.5*spectrum(k))*dk;
  float am = sqrt(0.5*spectrum(-k))*dk;
  vec2 ti = floor(vUv*N), tm = mod(N - ti, N);
  vec2 g1 = gauss(ti/N*1.37+0.11), g2 = gauss(tm/N*1.37+0.11);
  vec2 h0 = g1*a*0.70710678;
  vec2 h0m = g2*am*0.70710678; h0m.y = -h0m.y; // conj(h0(-k))
  gl_FragColor = vec4(h0, h0m);
}`;

const SPEC_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D h0Tex; uniform float N, L, time, depth;
const float PI = 3.14159265, G = 9.81;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
void main(){
  vec2 n = floor(vUv*N) - N*0.5;
  vec2 kv = n*2.0*PI/L; float k = length(kv);
  vec4 h0 = texture2D(h0Tex, vUv);
  // dispersion quantised to multiples of 2*pi/T (Tessendorf): the field repeats exactly every T = FFT_PERIOD s,
  // so time can be wrapped on the CPU and long sessions never lose float precision
  float w0 = 2.0*PI/${FFT_PERIOD.toFixed(1)};
  float w = max(w0, floor(sqrt(G*k*tanh(min(k*depth, 20.0)))/w0 + 0.5)*w0);
  vec2 e = vec2(cos(w*time), sin(w*time));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 kn = k > 1e-6 ? kv/k : vec2(0.0);
  vec2 dx = vec2(-h.y*kn.x, h.x*kn.x);   // i*kx/k*h
  vec2 dz = vec2(-h.y*kn.y, h.x*kn.y);   // i*kz/k*h
  // pack: A = h + i*Dx ; B = Dz
  gl_FragColor = vec4(h.x - dx.y, h.y + dx.x, dz);
}`;

const FFT_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D src; uniform float N, S, horizontal;
const float PI = 3.14159265;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
void main(){
  vec2 px = floor(vUv*N);
  float idx = horizontal > 0.5 ? px.x : px.y;
  float half_ = S*0.5;
  float ev = floor(idx/S)*half_ + mod(idx, half_);
  float od = ev + N*0.5;
  float t = 2.0*PI*idx/S;
  vec2 w = vec2(cos(t), sin(t));
  vec2 pe = horizontal > 0.5 ? vec2(ev, px.y) : vec2(px.x, ev);
  vec2 po = horizontal > 0.5 ? vec2(od, px.y) : vec2(px.x, od);
  vec4 a = texture2D(src, (pe+0.5)/N), b = texture2D(src, (po+0.5)/N);
  gl_FragColor = vec4(a.xy + cmul(w, b.xy), a.zw + cmul(w, b.zw));
}`;

const DISP_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D src; uniform float N, chop;
void main(){
  vec2 px = floor(vUv*N);
  float sgn = mod(px.x + px.y, 2.0) < 0.5 ? 1.0 : -1.0;
  vec4 v = texture2D(src, vUv)*sgn;
  gl_FragColor = vec4(v.y*chop, v.x, v.z*chop, 1.0);
}`;

const NRM_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D disp, prev; uniform float N, L, decay, foamBias, foamGain;
void main(){
  float t = 1.0/N, d = L/N;
  vec3 r = texture2D(disp, vUv+vec2(t,0.)).xyz, l = texture2D(disp, vUv-vec2(t,0.)).xyz;
  vec3 u = texture2D(disp, vUv+vec2(0.,t)).xyz, b = texture2D(disp, vUv-vec2(0.,t)).xyz;
  float Jxx = (r.x-l.x)/(2.*d), Jzz = (u.z-b.z)/(2.*d), Jxz = (u.x-b.x)/(2.*d), Jzx = (r.z-l.z)/(2.*d);
  float hx = (r.y-l.y)/(2.*d), hz = (u.y-b.y)/(2.*d);
  vec3 Tx = vec3(1.+Jxx, hx, Jzx), Tz = vec3(Jxz, hz, 1.+Jzz);
  vec3 n = normalize(cross(Tz, Tx));
  float J = (1.+Jxx)*(1.+Jzz) - Jxz*Jzx;
  float f = texture2D(prev, vUv).b*decay;
  f = max(f, clamp((foamBias - J)*foamGain, 0.0, 1.0));
  gl_FragColor = vec4(-n.x/n.y, -n.z/n.y, f, J);
}`;

/** 1 / integral over theta of (cos^2s(theta)+0.03cos^2) on the forward half-plane (numeric). */
function spreadNorm(s) { let a = 0; const n = 256; for (let i = 0; i < n; i++) { const t = -Math.PI / 2 + (i + 0.5) * Math.PI / n; const c = Math.cos(t); a += (Math.pow(c, 2 * s) + 0.03 * c * c) * Math.PI / n; } a += 0.03 * Math.PI / 2; return 1 / a; }

function rt(n, type, linear, mip = false) {
  const t = new THREE.WebGLRenderTarget(n, n, {
    type, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: linear ? (mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter) : THREE.NearestFilter,
    magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: mip,
  });
  if (mip) t.texture.anisotropy = 8;
  return t;
}

export class FFTOcean {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{N?:number, patch?:number, wind?:number, windDir?:number, fetch?:number, chop?:number,
   *          spread?:number, cutoff?:number, depth?:number, seed?:number, foamDecay?:number,
   *          foamBias?:number, foamGain?:number}} o
   */
  constructor(renderer, o = {}) {
    this.renderer = renderer;
    this.N = o.N || 256;
    this.patch = o.patch || 64;
    this.opts = { wind: 8, windDir: 0.4, fetch: 80000, chop: 1.2, spread: 6, cutoff: 0.02, depth: 60, seed: 0.37,
      foamDecay: 2.5, foamBias: 0.6, foamGain: 1.6, ...o };
    const N = this.N;
    const F = THREE.FloatType;
    this.h0 = rt(N, F, false);
    this.ping = rt(N, F, false);
    this.pong = rt(N, F, false);
    this.disp = rt(N, THREE.HalfFloatType, true);
    this.nrmA = rt(N, THREE.HalfFloatType, true, true);
    this.nrmB = rt(N, THREE.HalfFloatType, true, true);
    const mk = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    const P = this.opts;
    this.mH0 = mk(H0_FS, { N: { value: N }, L: { value: this.patch }, U: { value: P.wind }, fetch: { value: P.fetch },
      windAngle: { value: P.windDir }, spread: { value: P.spread }, spreadNorm: { value: spreadNorm(P.spread) }, cutoff: { value: P.cutoff }, seed: { value: P.seed }, depth: { value: P.depth } });
    this.mSpec = mk(SPEC_FS, { h0Tex: { value: this.h0.texture }, N: { value: N }, L: { value: this.patch }, time: { value: 0 }, depth: { value: P.depth } });
    this.mFFT = mk(FFT_FS, { src: { value: null }, N: { value: N }, S: { value: 2 }, horizontal: { value: 1 } });
    this.mDisp = mk(DISP_FS, { src: { value: null }, N: { value: N }, chop: { value: P.chop } });
    this.mNrm = mk(NRM_FS, { disp: { value: this.disp.texture }, prev: { value: null }, N: { value: N }, L: { value: this.patch },
      decay: { value: 0.98 }, foamBias: { value: P.foamBias }, foamGain: { value: P.foamGain } });
    this.quad = new FullScreenQuad(null);
    this.dirty = true;
    this.normalTexture = this.nrmA.texture;
    this.displacementTexture = this.disp.texture;
  }

  _pass(mat, target) {
    const r = this.renderer;
    this.quad.material = mat;
    r.setRenderTarget(target);
    this.quad.render(r);
  }

  /** Change spectrum parameters (regenerates h0 next update). */
  set(o) { Object.assign(this.opts, o); const P = this.opts; const u = this.mH0.uniforms;
    u.U.value = P.wind; u.windAngle.value = P.windDir; u.fetch.value = P.fetch; u.spread.value = P.spread;
    u.cutoff.value = P.cutoff; u.spreadNorm.value = spreadNorm(P.spread); u.depth.value = P.depth; this.mSpec.uniforms.depth.value = P.depth;
    this.mDisp.uniforms.chop.value = P.chop; this.mNrm.uniforms.foamBias.value = P.foamBias;
    this.mNrm.uniforms.foamGain.value = P.foamGain; this.dirty = true; }

  update(time, dt) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevXr = r.xr.enabled; r.xr.enabled = false;
    if (this.dirty) { this._pass(this.mH0, this.h0); this.dirty = false; }
    this.mSpec.uniforms.time.value = time;
    this._pass(this.mSpec, this.ping);
    let src = this.ping, dst = this.pong;
    for (const horizontal of [1, 0]) {
      for (let S = 2; S <= this.N; S *= 2) {
        const u = this.mFFT.uniforms;
        u.src.value = src.texture; u.S.value = S; u.horizontal.value = horizontal;
        this._pass(this.mFFT, dst);
        [src, dst] = [dst, src];
      }
    }
    this.mDisp.uniforms.src.value = src.texture;
    this._pass(this.mDisp, this.disp);
    const nu = this.mNrm.uniforms;
    nu.prev.value = this.nrmA.texture;
    nu.decay.value = Math.exp(-Math.max(dt, 0) / this.opts.foamDecay);
    this._pass(this.mNrm, this.nrmB);
    [this.nrmA, this.nrmB] = [this.nrmB, this.nrmA];
    this.normalTexture = this.nrmA.texture;
    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXr;
  }

  dispose() {
    for (const t of [this.h0, this.ping, this.pong, this.disp, this.nrmA, this.nrmB]) t.dispose();
    for (const m of [this.mH0, this.mSpec, this.mFFT, this.mDisp, this.mNrm]) m.dispose();
    this.quad.dispose();
  }
}
