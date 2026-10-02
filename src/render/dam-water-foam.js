/**
 * Persistent surface foam below the dam (render/dam-water-pool.js): a foam-thickness field over the pool's bake domain
 * on the GPU (ping-pong half-float render targets), carried by the baked current (uFlow) with second-order
 * MacCormack advection (limited, so it neither blurs the lace away nor overshoots), fed at the roller toe and under
 * each sheet's plunge, gathered where the surface converges (eddies, the roller diving at the face, the banks) and
 * fading over ~10 s. The foam forms where it is born as cellular lace (Worley cells with clear holes, rafts where it is
 * thick) and is then only ever transported: the shear of the current stretches the cells gradually into streaks along
 * the flow, in any direction, and a raft stays the same raft as it drifts downstream.
 *
 * Along with the thickness, the field carries each parcel's material coordinates: its displacement since it was born
 * (gb, m) and its age (a, s). The pool shader draws the lace (a Worley wall network) at the parcel's birth position,
 * shifted by its birth time, so the lace is glued to the foam: it deforms with the current's strain, is never
 * re-seeded or cross-faded, and a raft keeps its holes all the way downstream.
 *
 * The field steps at a fixed 15 Hz (less numerical diffusion than a step per display frame); the pool shader samples
 * it back-traced along the current by the time since the last step (`uStepT`), so the foam glides smoothly.
 *
 *   const ff = createFoamField(gl, flowTex, field, { boilV, sheets:[u..], mid }); ff.frame(dt, time); ff.texture
 * @module render/dam-water-foam
 */
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */`
uniform sampler2D uSrc, uFlow;
uniform vec4 uDomain;      // the foam field: u0, v0, width, height (m)
uniform vec4 uFlowDom;     // the baked flow: u0, v0, 1/width, 1/height
uniform float uDt;
varying vec2 vUv;
vec2 flowUv(vec2 uv) { return (uDomain.xy + uv * uDomain.zw - uFlowDom.xy) * uFlowDom.zw; }
vec4 flow(vec2 uv) { return texture2D(uFlow, flowUv(uv)); }
vec2 vel(vec2 uv) { return flow(uv).rg / uDomain.zw; }   // uv / s
// RK2 back-trace over dt
vec2 back(vec2 uv, float dt) { vec2 m = uv - 0.5 * dt * vel(uv); return uv - dt * vel(m); }
`;

// pass 1: plain semi-Lagrangian advection (the predictor)
const PRED_FRAG = /* glsl */`${COMMON}
void main() { gl_FragColor = texture2D(uSrc, back(vUv, uDt)); }`;

// pass 2: MacCormack correction (error estimated by advecting the prediction back), clamped to the source texels
// around the departure point; then convergence, decay and the sources
const CORR_FRAG = /* glsl */`${COMMON}
uniform sampler2D uPred;
uniform float uTime, uBoilV, uMid, uLife;
uniform vec2 uRes;
uniform vec4 uSheets;      // u of the two sheets' centres, half width of the jet at the face, unused
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
// Worley foam: distance to the nearest cell wall (F2 - F1), cells ~1/scale m, their seeds drifting with the churn
float cells(vec2 p, float t) {
  vec2 gi = floor(p), gf = fract(p); float d1 = 9.0, d2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), h = h22(gi + o);
    vec2 c = o + 0.5 + 0.4 * sin(t * (0.6 + h.yx) + 6.2832 * h);
    float d = length(gf - c);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
void main() {
  vec2 b = back(vUv, uDt), px = 1.0 / vec2(uRes);
  vec4 P4 = texture2D(uPred, vUv); float p = P4.r;
  // the foam's material coordinates: displacement since birth (m) and age (s), carried along (smooth: plain advection)
  vec2 D = P4.gb + flow(vUv).rg * uDt; float A = P4.a + uDt;
  float r = texture2D(uPred, vUv + uDt * vel(vUv)).r;            // the prediction carried back
  float s0 = texture2D(uSrc, vUv).r;
  float f = clamp(p + 0.5 * (s0 - r), 0.0, 4.0);
  // limiter: within the 4 source texels around the departure point
  vec2 tb = b * uRes - 0.5, i0 = (floor(tb) + 0.5) * px;
  float a0 = texture2D(uSrc, i0).r, a1 = texture2D(uSrc, i0 + vec2(px.x, 0.0)).r, a2 = texture2D(uSrc, i0 + vec2(0.0, px.y)).r, a3 = texture2D(uSrc, i0 + px).r;
  f = clamp(f, min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3)));
  // turbulent smearing along the current, growing with the foam's travel past the toe: the cells born there keep
  // their shape for the first few metres, then their walls across the flow fade and the ones along it stay, so the
  // lace drifts into streaks along the current gradually (a decelerating jet would otherwise squash it into bands)
  vec2 V0 = flow(vUv).rg; float sp0 = length(V0);
  vec2 qd = uDomain.xy + vUv * uDomain.zw;
  float ks = 0.22 * smoothstep(4.0, 16.0, qd.y - uBoilV) * smoothstep(0.2, 0.8, sp0);
  vec2 dd = V0 / max(sp0, 1e-3) * 0.3 / uDomain.zw;                // 0.3 m along the current, in uv
  f = mix(f, 0.5 * (texture2D(uSrc, b + dd).r + texture2D(uSrc, b - dd).r), ks);
  // surface convergence gathers the foam (eddies, the roller diving back at the face, the banks); divergence thins it
  // (only inside the water: the current is zero past the banks and the face)
  vec2 e = vec2(0.35 / uFlowDom.z / uDomain.z, 0.0), e2 = vec2(0.0, 0.35 / uFlowDom.w / uDomain.w);   // 0.35 m in uv
  vec2 fa = flow(vUv + e).rg, fb = flow(vUv - e).rg, fc = flow(vUv + e2).rg, fd = flow(vUv - e2).rg;
  float div = ((fa.x - fb.x) + (fc.y - fd.y)) / 0.7;
  float wet = step(1e-3, min(min(length(fa), length(fb)), min(length(fc), length(fd))));
  f *= exp(-clamp(div * wet, -0.6, 1.5) * 0.8 * uDt) * exp(-uDt / uLife);
  // nothing near the field's own edges (the pool samples it clamped beyond them)
  f *= smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x) * smoothstep(1.0, 0.97, vUv.y);
  // sources (dam frame): the two plunges, widening and merging downstream, and the jump's toe where the roller lets go
  vec2 q = uDomain.xy + vUv * uDomain.zw;
  vec4 F0 = flow(vUv); float rel = q.y - uBoilV, fl = F0.a;           // fl: baked aeration
  float wd = uSheets.z + 0.45 * max(q.y - uMid, 0.0);
  float pl = max(exp(-pow((q.x - uSheets.x) / wd, 2.0)), exp(-pow((q.x - uSheets.y) / wd, 2.0)));
  float toeV = 1.9 + 1.4 * (vn(vec2(q.x * 0.55, 3.1)) - 0.5);    // the ragged toe line, fixed
  float toe = exp(-pow((rel - toeV) / 0.4, 2.0)) * smoothstep(0.03, 0.25, fl);
  float plunge = exp(-pow((q.y - uMid - 0.6) / 0.4, 2.0)) * pl;
  // the sources are thin lines, so the foam leaves them at once: what it carries off is the time history of the
  // emission along each line, a Worley lace scrolled at ~the current (frozen-pattern), so whole cells (0.5-1.2 m) and
  // rafts drift away together, with clear holes, neither trailing streaks from fixed spots nor leaving in waves
  float src = clamp(max(toe * mix(0.45, 1.0, pl), plunge) * 1.2, 0.0, 1.0);
  if (src > 0.002) {
    vec2 qk = vec2(q.x, q.y - 1.6 * uTime);   // the current 5-15 m down (the toe's 2.5-3.5 m/s slows to ~1.5)
    // big open cells (1.5-2.5 m) with broad walls and rafts: the field carries where the foam is and how thick; the
    // pool shader draws the fine lace inside it
    float c1 = cells(qk * 0.55, uTime * 0.5), c2 = cells(qk * 1.4 + 3.1, uTime * 0.8);
    float raft = vn(qk * 0.3) * 0.6 + vn(qk * 0.9) * 0.4, brk = smoothstep(0.15, 0.55, vn(qk * 1.1 + 7.7));
    float wall = max(1.0 - smoothstep(0.05, 0.25 + 0.3 * raft, c1), (1.0 - smoothstep(0.03, 0.2, c2)) * smoothstep(0.4, 0.75, raft));
    // lanes across the toe that wander slowly: what leaves through a lane forms the long foam lines and rafts downstream,
    // the gaps between them the darker clear lanes
    float lane = smoothstep(0.3, 0.72, vn(vec2(q.x * 0.75 + 0.6 * sin(uTime * 0.11), uTime * 0.22)));
    float lace = clamp((wall * (0.35 + 0.9 * raft) * mix(0.4, 1.0, brk) + smoothstep(0.55, 0.85, raft) * 0.8) * mix(0.2, 1.1, lane), 0.0, 1.4);
    float k = 1.0 - exp(-uDt * 9.0 * src);

    f = mix(min(f, 1.5), lace * 1.1, k); D *= 1.0 - k; A *= 1.0 - k;               // born here, now
  }
  f *= step(1e-3, length(F0.rg));                               // none past the water's edge
  f *= 1.0 - smoothstep(16.0, 40.0, A) * (1.0 - exp(-uDt / 2.0));   // old foam (sheared to threads in the eddies) dies
  gl_FragColor = vec4(f, clamp(D, -100.0, 100.0), min(A, 120.0));
}`;

/**
 * @param {THREE.WebGLRenderer} gl
 * @param {THREE.Texture} flowTex  baked current (rg m/s) + foam/aeration (b/a), over the domain
 * @param {{u0:number, v0:number, nu:number, nv:number, h:number}} dom
 * @param {{boilV:number, mid:number, sheets?:number[], res?:number, life?:number}} o
 */
export function createFoamField(gl, flowTex, dom, o) {
  const fd = o.foamDomain || { u0: -14, v0: dom.v0, w: 32, h: 42 }, NX = o.res ?? 512, NY = Math.round(NX * fd.h / fd.w), STEP = 1 / 15;
  const mk = () => new THREE.WebGLRenderTarget(NX, NY, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false });
  let src = mk(), dst = mk();
  const pred = mk();
  const domain = new THREE.Vector4(fd.u0, fd.v0, fd.w, fd.h), flowDom = new THREE.Vector4(dom.u0, dom.v0, 1 / (dom.nu * dom.h), 1 / (dom.nv * dom.h));
  const sh = o.sheets || [-1, 1];
  const U = {
    uSrc: { value: null }, uFlow: { value: flowTex }, uPred: { value: pred.texture }, uDomain: { value: domain }, uFlowDom: { value: flowDom }, uDt: { value: STEP },
    uTime: { value: 0 }, uBoilV: { value: o.boilV }, uMid: { value: o.mid }, uLife: { value: o.life ?? 15 }, uRes: { value: new THREE.Vector2(NX, NY) },
    uSheets: { value: new THREE.Vector4(sh[0], sh[1] ?? sh[0], 0.75, 0) },
  };
  const matP = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: PRED_FRAG, uniforms: U, depthTest: false, depthWrite: false });
  const matC = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: CORR_FRAG, uniforms: U, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matP), scene = new THREE.Scene(), cam = new THREE.Camera();
  quad.frustumCulled = false; scene.add(quad);
  let acc = 0, time = 0;
  const stepT = { value: 0 }, tex = { value: src.texture };
  function step() {
    U.uTime.value = time;
    U.uSrc.value = src.texture;
    quad.material = matP; gl.setRenderTarget(pred); gl.render(scene, cam);
    quad.material = matC; gl.setRenderTarget(dst); gl.render(scene, cam);
    [src, dst] = [dst, src];
    tex.value = src.texture;
  }
  function run(n) {
    const prev = gl.getRenderTarget(), auto = gl.autoClear, xr = gl.xr.enabled;
    gl.autoClear = false; gl.xr.enabled = false;
    for (let k = 0; k < n; k++) { time = (time + STEP) % 3600; step(); }
    gl.setRenderTarget(prev); gl.autoClear = auto; gl.xr.enabled = xr;
  }
  // start empty, then let the pool fill (~20 s of foam) before the first frame
  {
    const prev = gl.getRenderTarget(), cc = gl.getClearColor(new THREE.Color()), ca = gl.getClearAlpha();
    gl.setClearColor(0x000000, 0);
    for (const rt of [src, dst, pred]) { gl.setRenderTarget(rt); gl.clear(true, false, false); }
    gl.setRenderTarget(prev); gl.setClearColor(cc, ca);
  }
  let warm = false;
  return {
    texture: tex, stepT, domain, res: [NX, NY], step: STEP, _rt: () => src,
    /** Advance the field by dt (s); `t` = the pool's clock (uTime) after this frame. */
    frame(dt, t) {
      if (!warm) { warm = true; run(300); }
      acc += dt;
      const n = Math.min(4, Math.floor(acc / STEP));
      if (n > 0) { run(n); acc -= n * STEP; if (acc > STEP) acc = 0; }
      stepT.value = t - acc;                       // the clock at the last step: the shader back-traces the rest
    },
    dispose() { for (const rt of [src, dst, pred]) rt.dispose(); matP.dispose(); matC.dispose(); quad.geometry.dispose(); },
  };
}
