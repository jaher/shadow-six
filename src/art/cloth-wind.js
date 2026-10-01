/**
 * Clothing secondary motion in the wind (step 4w). Cheap vertex-shader flutter on the skinned character meshes,
 * applied AFTER skinning so it never fights the skeleton, LODs or the x-ray/shadow passes (those simply draw the
 * unfluttered pose — the offsets are centimetres).
 *
 * Flutter weights are derived procedurally per garment at load from the bind pose (no painted masks needed):
 *  - greatcoat / parka / smock SKIRTS: cloth vertices below the hips that stand off the leg bones (or hang between
 *    the legs) → full weight, growing to the hem; trousers get a faint flap,
 *  - SLEEVES: light, growing to the cuff,
 *  - SCARVES / collars: cloth standing off the neck axis,
 *  - beret / cap RIBBONS and neck flaps: headgear hanging below and behind the head,
 *  - WEBBING straps / loose smock: faint torso ripple, more where the cloth stands off the spine.
 * The shader offsets each vertex along the RELATIVE air velocity (mission wind at that point minus the character's
 * own velocity, so a running man's coat streams back even in calm air), with a flapping phase per vertex.
 * @module art/cloth-wind
 */
import * as THREE from 'three';
import { WIND_GLSL, WIND_UNIFORMS, activeWind } from '../world/wind.js';

/** Per-draw character velocity (world xz, m/s): set in each mesh's onBeforeRender. */
const VEL = { value: new Float32Array([0, 0]) };
const _geo = new WeakMap();

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function segDist(px, py, pz, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / L2));
  const dx = px - a[0] - abx * t, dy = py - a[1] - aby * t, dz = pz - a[2] - abz * t;
  return [Math.sqrt(dx * dx + dy * dy + dz * dz), t];
}

/** Bind-pose bone positions (mesh space) by name. */
function bindBones(mesh) {
  const out = {}, sk = mesh.skeleton;
  if (!sk) return out;
  sk.bones.forEach((b, i) => {
    const inv = sk.boneInverses[i]?.clone().invert();
    if (inv) { const e = inv.elements; out[b.name] = [e[12], e[13], e[14]]; }
  });
  return out;
}

/**
 * Flutter attribute data for a skinned mesh: Float32Array(n·2) = (weight 0..1, phase seed 0..1). Cached per geometry.
 * @param {object} mesh THREE.SkinnedMesh with a `_mask` attribute (x skin, y cloth)
 */
export function computeFlutter(mesh) {
  const g = mesh.geometry;
  if (_geo.has(g)) return _geo.get(g);
  const P = g.attributes.position, M = g.attributes._mask, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const n = P.count, out = new Float32Array(n * 2);
  const B = bindBones(mesh), names = mesh.skeleton?.bones.map((b) => b.name) || [];
  const need = ['pelvis', 'neck_01', 'Head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'];
  if (!P || !SI || need.some((k) => !B[k])) { _geo.set(g, out); return out; }
  const hipY = B.pelvis[1], neck = B.neck_01, head = B.Head;
  const legs = [[B.thigh_l, B.calf_l], [B.calf_l, B.foot_l], [B.thigh_r, B.calf_r], [B.calf_r, B.foot_r]];
  const arms = [[B.upperarm_l, B.lowerarm_l, 0], [B.lowerarm_l, B.hand_l, 1], [B.upperarm_r, B.lowerarm_r, 0], [B.lowerarm_r, B.hand_r, 1]];
  const spine = [B.pelvis, neck];
  const headgear = /headgear|hat|cap|helmet/i.test(mesh.name);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const cloth = M ? M.getY(i) : (headgear ? 1 : 0), skin = M ? M.getX(i) : 0;
    let w = 0;
    // dominant bone
    let bi = SI.getX(i), bw = SW.getX(i);
    if (SW.getY(i) > bw) { bw = SW.getY(i); bi = SI.getY(i); }
    if (SW.getZ(i) > bw) { bw = SW.getZ(i); bi = SI.getZ(i); }
    if (SW.getW(i) > bw) { bi = SI.getW(i); }
    const bone = names[bi] || '';
    if (headgear || bone === 'Head') {
      // cap/beret ribbons, neck flaps: hanging below the skull, behind the head
      if (cloth > 0.5 && skin < 0.5) w = smooth(head[1] + 0.02, head[1] - 0.08, y) * smooth(head[2] - 0.02, head[2] - 0.1, z) * 0.9;
    } else if (cloth > 0.5 && skin < 0.5) {
      if (y < hipY - 0.04) {
        let d = 9;
        for (const s of legs) d = Math.min(d, segDist(x, y, z, s[0], s[1])[0]);
        const drop = Math.min(1, (hipY - y) / (hipY * 0.7));
        const skirt = smooth(0.1, 0.17, d);
        w = skirt * (0.35 + 0.65 * drop) + (1 - skirt) * 0.07 * drop;  // coat skirt vs trouser flap
      } else if (/arm|hand/.test(bone)) {
        let best = 9, tt = 0, lower = 0;
        for (const s of arms) { const [d, t] = segDist(x, y, z, s[0], s[1]); if (d < best) { best = d; tt = t; lower = s[2]; } }
        w = 0.1 + 0.18 * (lower ? 0.5 + 0.5 * tt : 0.5 * tt) + 0.2 * smooth(0.06, 0.12, best); // loose cuffs flap most
      } else {
        const [ds] = segDist(x, y, z, spine[0], spine[1]);
        const nearNeck = smooth(neck[1] - 0.16, neck[1] - 0.04, y);
        const [dn] = segDist(x, y, z, neck, head);
        w = 0.05 + 0.25 * smooth(0.19, 0.27, ds) + nearNeck * 0.4 * smooth(0.08, 0.14, dn); // straps/open fronts, scarf
      }
    }
    out[i * 2] = Math.min(1, w);
    out[i * 2 + 1] = x * 3.1 + z * 4.3 + y * 1.3; // spatially smooth phase (UV-seam duplicates stay welded)
  }
  _geo.set(g, out);
  return out;
}

const CW_PARS = WIND_GLSL + /* glsl */ `
attribute vec2 aFlutter;
uniform vec2 uClothVel;
`;
const CW_MAIN = /* glsl */ `
if (aFlutter.x > 0.001) {
  vec3 cwP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec4 cwW = windSample(cwP.xz);
  vec2 cwR = cwW.xy - uClothVel;
  float cwS = min(length(cwR), 20.0);
  vec2 cwD = cwS > 1e-3 ? cwR / cwS : vec2(0.0);
  float cwA = aFlutter.x * min(0.007 * cwS + 0.035 * cwW.z, 0.12);
  // fixed rate: (rate + k·speed)·t chirps as the speed changes late in a mission (t·dS/dt → tens of Hz)
  float cwPh = uWindA.w * 7.5 + aFlutter.y + cwP.y * 4.0;
  vec3 cwO = vec3(cwD.x, 0.0, cwD.y) * cwA * (0.6 + 0.4 * sin(cwPh))
    + vec3(-cwD.y, 0.0, cwD.x) * cwA * 0.35 * sin(cwPh * 1.7 + 1.0) + vec3(0.0, cwA * 0.3 * sin(cwPh * 1.3 + 2.0), 0.0);
  mat3 cwM = mat3(modelMatrix);
  transformed += (cwO * cwM) / max(dot(cwM[0], cwM[0]), 1e-6); // world → mesh space (rotation + uniform scale)
}
`;

/** Wrap a (possibly already patched) character material once: chains its onBeforeCompile, adds the flutter. */
function wrapMaterial(mat) {
  if (mat.userData.clothWind) return;
  mat.userData.clothWind = true;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    Object.assign(sh.uniforms, WIND_UNIFORMS, { uClothVel: VEL });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + CW_PARS)
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + CW_MAIN);
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|cwind2'; };
  mat.needsUpdate = true;
}

/**
 * Enable clothing wind on one skinned character mesh (idempotent). Adds the `aFlutter` attribute and an
 * onBeforeRender that feeds the character's own velocity (from its world position over SIM time: frozen while paused).
 * @param {object} mesh THREE.SkinnedMesh @param {(n:number)=>object} makeAttr (array) => BufferAttribute(array, 2)
 * @returns {boolean} whether the mesh got any flutter
 */
export function applyClothWind(mesh, makeAttr) {
  if (!mesh?.isSkinnedMesh || mesh.userData.clothWind) return !!mesh?.userData.clothWind;
  const data = computeFlutter(mesh);
  let any = false;
  for (let i = 0; i < data.length; i += 2) if (data[i] > 0.02) { any = true; break; }
  mesh.userData.clothWind = true;
  if (!any) return false;
  mesh.geometry.setAttribute('aFlutter', makeAttr(data));
  for (const m of [].concat(mesh.material)) wrapMaterial(m);
  const st = { x: 0, z: 0, t: -1, vx: 0, vz: 0 };
  const prevOBR = mesh.onBeforeRender;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    prevOBR?.call(this, renderer, scene, camera, geometry, material, group);
    const e = this.matrixWorld.elements, t = WIND_UNIFORMS.uWindA.value[3];
    if (t !== st.t) {
      const dt = t - st.t;
      if (st.t >= 0 && dt > 0 && dt < 0.5) {
        const k = Math.min(1, dt * 6); // ~0.17 s smoothing of the measured velocity
        st.vx += ((e[12] - st.x) / dt - st.vx) * k; st.vz += ((e[14] - st.z) / dt - st.vz) * k;
      } else { st.vx = 0; st.vz = 0; } // first draw / LOD swap / teleport
      st.x = e[12]; st.z = e[14]; st.t = t;
    }
    VEL.value[0] = st.vx; VEL.value[1] = st.vz;
    material.uniformsNeedUpdate = true;
  };
  return true;
}

// ------------------------------------------------------------------ canvas: tents, tarps, truck covers, car tops
/*
 * Canvas covers (step 4w, reworked for "the cloth on the car is vibrating too fast" / "the back surface detaches").
 *  - ONE continuous displacement field: every vertex moves along a SMOOTH outward direction (`aFlapDir`, averaged
 *    in space over every part of the mesh, σ 0.15 m) by a scalar evaluated from its POSITION (`aFlapP`, metres) and
 *    a pin weight that is itself a function of position (`aFlap`: 0 on hoops / bed rail / tent poles, 1 mid-panel, up
 *    to ~1.8 on a loose rear end panel). Coincident vertices get the same offset and nearby UNWELDED parts nearly the
 *    same: the separate back panel stays on the cover rim, its rolled-up hem moves as one piece.
 *  - SLOW motion: no per-vertex wind sampling and no `time × speed` phases. Per drawn object the CPU low-passes the
 *    relative air (wind at the object − its own velocity, over SIM time) and integrates 4 phases at 0.3–1.45 Hz, so
 *    gusts swell and decay smoothly, driving bulges the front/top and flaps the loose rear hem, frame-rate free.
 *  - Normals follow the displacement (analytic gradient incl. the pin-weight gradient `aFlapG`).
 * `canvasEval` is the CPU twin of the GLSL (tests); both are generated from the constants below.
 */
const TAU = Math.PI * 2;
/** Tunables shared by the CPU twin and the GLSL. */
export const CANVAS_K = {
  tauAir: 0.9, tauVel: 0.25, tauGustUp: 0.6, tauGustDown: 1.6,   // low-pass time constants (s)
  f0: [0.3, 0.48, 0.72, 0.55], f1: [0.32, 0.5, 0.62, 0.85],         // phase rates (Hz) = f0 + f1 · min(S/16, 1) ≤ 1.4
  push: 0.085, suck: 0.035,                                         // pressure billow per unit q (m): windward in, rest out
  wave: 2.4,                                                        // downwind travelling billow (rad/m)
  v: [[0.9, 0.7, 1.3], [-1.7, 1.1, 2.3], [2.6, -1.9, 0.8], [1.2, 2.5, 0.4]], // fixed spatial phase gradients (rad/m)
  b: [0.55, 0.3, 0.15],                                             // billow mode mix
  amp: [0.004, 0.012, 0.02], flap: [0.015, 0.035],                  // billow m: a0 + a1·s12 + a2·gust ; hem flap m: f0 + f1·s12
};

/**
 * Advance one object's canvas state by `dt` s of sim time. `st` {x,z,vx,vz,ax,az,g,ph[4]} (world xz of the object,
 * its smoothed velocity, low-passed relative air, low-passed gust, phases); `x,z` new object position; `w` wind
 * sample {x, z, gust} there. Exponential filters + integrated phases: frame-rate independent, never jumps.
 */
export function canvasStep(st, dt, x, z, w) {
  const K = CANVAS_K;
  if (dt > 0) {
    const kv = 1 - Math.exp(-dt / K.tauVel);
    st.vx += ((x - st.x) / dt - st.vx) * kv; st.vz += ((z - st.z) / dt - st.vz) * kv;
  }
  const ka = 1 - Math.exp(-dt / K.tauAir);
  st.ax += (w.x - st.vx - st.ax) * ka; st.az += (w.z - st.vz - st.az) * ka;
  const g = w.gust || 0, kg = 1 - Math.exp(-dt / (g > st.g ? K.tauGustUp : K.tauGustDown));
  st.g += (g - st.g) * kg;
  const s01 = Math.min(Math.hypot(st.ax, st.az) / 16, 1);
  for (let i = 0; i < 4; i++) st.ph[i] = (st.ph[i] + TAU * (K.f0[i] + K.f1[i] * s01) * dt) % TAU;
  st.x = x; st.z = z;
  return st;
}

/** Fresh state at an object (seeded phases so neighbouring trucks don't move in lockstep). */
export function canvasState(x, z, w) {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  return { x, z, vx: 0, vz: 0, ax: w.x, az: w.z, g: w.gust || 0, ph: [h * TAU, h * 17.1 % TAU, h * 31.7 % TAU, h * 7.3 % TAU] };
}

/**
 * Per-draw uniform values from a state: air (object-frame unit dir xyz, speed), k (q, billow m, hem flap m, 0),
 * phases. `m` = object matrixWorld elements (column-major): the air vector is rotated into the object frame.
 */
export function canvasUniforms(st, m, air, k, ph) {
  const K = CANVAS_K, S = Math.hypot(st.ax, st.az);
  let ox = 0, oy = 0, oz = 0;
  if (S > 1e-4) {
    const c = (i) => (m[i] * st.ax + m[i + 2] * st.az) / (m[i] * m[i] + m[i + 1] * m[i + 1] + m[i + 2] * m[i + 2] || 1);
    ox = c(0); oy = c(4); oz = c(8);
    const l = Math.hypot(ox, oy, oz) || 1; ox /= l; oy /= l; oz /= l;
  }
  air[0] = ox; air[1] = oy; air[2] = oz; air[3] = S;
  const s12 = Math.min(S / 12, 1);
  k[0] = s12 * s12; k[1] = K.amp[0] + K.amp[1] * s12 + K.amp[2] * Math.min(st.g, 1.2); k[2] = K.flap[0] + K.flap[1] * s12; k[3] = 0;
  for (let i = 0; i < 4; i++) ph[i] = st.ph[i];
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/**
 * CPU twin of the vertex shader: offset (metres, along `n`) and its gradient for one vertex.
 * @param {number[]} P metric position @param {number[]} n welded outward dir @param {number} w pin weight
 * @param {number[]} G ∇w (1/m) @param {{air:number[],k:number[],ph:number[]}} U uniforms → {D, grad:number[3]}
 */
export function canvasEval(P, n, w, G, U) {
  const K = CANVAS_K, A = U.air, V = K.v;
  const pr = U.k[0] * (K.suck - K.push * Math.max(-dot3(n, A), 0));
  const a1 = U.ph[0] - dot3(P, A) * K.wave + dot3(P, V[0]), a2 = U.ph[1] + dot3(P, V[1]), a3 = U.ph[2] + dot3(P, V[2]);
  const a4 = U.ph[3] + dot3(P, V[3]);
  const B = K.b[0] * Math.sin(a1) + K.b[1] * Math.sin(a2) + K.b[2] * Math.sin(a3);
  const L = Math.max(w - 1, 0), F = Math.sin(a4), base = pr + U.k[1] * B;
  const D = w * base + L * U.k[2] * F;
  const c1 = w * U.k[1] * K.b[0] * Math.cos(a1), c2 = w * U.k[1] * K.b[1] * Math.cos(a2), c3 = w * U.k[1] * K.b[2] * Math.cos(a3);
  const c4 = L * U.k[2] * Math.cos(a4), gw = base + (w > 1 ? U.k[2] * F : 0);
  const grad = [0, 1, 2].map((i) => G[i] * gw + c1 * (V[0][i] - A[i] * K.wave) + c2 * V[1][i] + c3 * V[2][i] + c4 * V[3][i]);
  return { D, grad };
}

const CV_U = { uCanvasAir: { value: new Float32Array(4) }, uCanvasK: { value: new Float32Array(4) }, uCanvasPh: { value: new Float32Array(4) } };
const v3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;
const f = (x) => x.toFixed(4);
const FLAP_PARS = /* glsl */ `
attribute float aFlap; attribute vec3 aFlapDir; attribute vec4 aFlapP; attribute vec3 aFlapG;
uniform vec4 uCanvasAir; uniform vec4 uCanvasK; uniform vec4 uCanvasPh;
// canvas cover (CPU twin: cloth-wind.js canvasEval): offset (m along aFlapDir) + gradient
float cvEval(out vec3 grad) {
  vec3 P = aFlapP.xyz, n = aFlapDir, A = uCanvasAir.xyz;
  float pr = uCanvasK.x * (${f(CANVAS_K.suck)} - ${f(CANVAS_K.push)} * max(-dot(n, A), 0.0));
  float a1 = uCanvasPh.x - dot(P, A) * ${f(CANVAS_K.wave)} + dot(P, ${v3(CANVAS_K.v[0])});
  float a2 = uCanvasPh.y + dot(P, ${v3(CANVAS_K.v[1])}), a3 = uCanvasPh.z + dot(P, ${v3(CANVAS_K.v[2])});
  float a4 = uCanvasPh.w + dot(P, ${v3(CANVAS_K.v[3])});
  float B = ${f(CANVAS_K.b[0])} * sin(a1) + ${f(CANVAS_K.b[1])} * sin(a2) + ${f(CANVAS_K.b[2])} * sin(a3);
  float L = max(aFlap - 1.0, 0.0), F = sin(a4), base = pr + uCanvasK.y * B;
  float c1 = aFlap * uCanvasK.y * ${f(CANVAS_K.b[0])} * cos(a1), c2 = aFlap * uCanvasK.y * ${f(CANVAS_K.b[1])} * cos(a2);
  float c3 = aFlap * uCanvasK.y * ${f(CANVAS_K.b[2])} * cos(a3), c4 = L * uCanvasK.z * cos(a4);
  grad = aFlapG * (base + (aFlap > 1.0 ? uCanvasK.z * F : 0.0)) + c1 * (${v3(CANVAS_K.v[0])} - A * ${f(CANVAS_K.wave)})
    + c2 * ${v3(CANVAS_K.v[1])} + c3 * ${v3(CANVAS_K.v[2])} + c4 * ${v3(CANVAS_K.v[3])};
  return aFlap * base + L * uCanvasK.z * F;
}
vec3 cvOffset() {
  if (aFlap <= 0.001) return vec3(0.0);
  vec3 g; return aFlapDir * (cvEval(g) * aFlapP.w);
}
vec3 cvNormal(vec3 nrm) {
  if (aFlap <= 0.001 && dot(aFlapG, aFlapG) < 1e-8) return nrm;
  // surface moved by D·d (d = aFlapDir, smooth but not always the surface normal: a roll's side faces):
  // n' = n − (n·d) ∇ₛD, with ∇ₛD the gradient's tangential part
  vec3 g; cvEval(g);
  vec3 no = normalize(nrm);
  return normalize(no - dot(no, aFlapDir) * (g - dot(g, no) * no));
}
`;

const _cvState = new WeakMap(), _cvW = { x: 0, z: 0, gust: 0 };
/** Canvas state of a drawn object (tests / debug): {vx, vz, ax, az, g, ph, t}. */
export const canvasStateOf = (o) => _cvState.get(o) || null;
/** Wind at (x, z): the active WindField, else the published mean wind (sandbox / tests). */
function cvWind(x, z, t) {
  const W = activeWind();
  if (W) { const s = W.sample(x, z, t); _cvW.x = s.x; _cvW.z = s.z; _cvW.gust = s.gust; return _cvW; }
  const a = WIND_UNIFORMS.uWindA.value;
  _cvW.x = a[0] * a[2]; _cvW.z = a[1] * a[2]; _cvW.gust = 0;
  return _cvW;
}
/*
 * PER-OBJECT UNIFORMS. The uCanvas* values are written per draw, but three.js re-uploads a non-ShaderMaterial's
 * uniforms only when the material (or program) changes between draws (`uniformsNeedUpdate` is ShaderMaterial-only):
 * two objects drawn back to back with ONE material would both show the first one's state. So every canvas object
 * draws with its own material instance (same program: the copies share the shader). `ownCanvasMaterial` does it up
 * front; a canvas material found shared at draw time is copied for the newcomer (from its next frame on).
 */
const _cvOwner = new WeakMap();
/** Material copy keeping the chained shader hooks (Material.copy drops instance onBeforeCompile & co). */
function cloneHooked(m) {
  const c = m.clone();
  for (const k of ['onBeforeCompile', 'customProgramCacheKey', 'onBeforeRender']) if (Object.prototype.hasOwnProperty.call(m, k)) c[k] = m[k];
  return c;
}
/** Give `mesh` its own canvas material instance(s) (cloned unless already its own), with the canvas shader. */
export function ownCanvasMaterial(mesh) {
  const own = (m) => {
    if (!m || _cvOwner.get(m) === mesh) return m;
    const c = cloneHooked(m);
    _cvOwner.set(c, mesh);
    return applyFlap(c);
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  return mesh;
}

/** Per draw: advance the drawn object's state once per sim-time value, publish its uniforms. */
function cvBeforeRender(renderer, scene, camera, geometry, object) {
  if (!geometry?.attributes?.aFlap) return; // a non-canvas mesh sharing the material: nothing to drive
  const owner = _cvOwner.get(this);
  if (owner === undefined) _cvOwner.set(this, object);
  else if (owner !== object) { // shared by two canvas objects (e.g. a legacy path): own copy from the next frame
    const c = cloneHooked(this);
    _cvOwner.set(c, object);
    object.material = Array.isArray(object.material) ? object.material.map((m) => (m === this ? c : m)) : (object.material === this ? c : object.material);
  }
  if (!geometry.attributes.aFlapDir) canvasAutoAttrs(object, geometry);
  const t = WIND_UNIFORMS.uWindA.value[3], e = object.matrixWorld.elements, x = e[12], z = e[14];
  let st = _cvState.get(object);
  if (!st) { st = canvasState(x, z, cvWind(x, z, t)); st.t = t; _cvState.set(object, st); }
  else if (t !== st.t) {
    const dt = t - st.t;
    if (dt > 0 && dt < 0.5 && Math.hypot(x - st.x, z - st.z) < 10) canvasStep(st, dt, x, z, cvWind(x, z, t));
    else { const ph = st.ph; st = canvasState(x, z, cvWind(x, z, t)); st.ph = ph; _cvState.set(object, st); } // load / teleport
    st.t = t;
  }
  canvasUniforms(st, e, CV_U.uCanvasAir.value, CV_U.uCanvasK.value, CV_U.uCanvasPh.value);
}

/**
 * Canvas covers (tents, tarps, truck covers, car tops): chains `material.onBeforeCompile` once and drives the
 * per-object state from `material.onBeforeRender`. Geometry needs the attributes from `canvasAttributes`
 * (`applyCanvasCover` / tents); a legacy geometry with only `aFlap` gets them computed on first draw.
 */
export function applyFlap(mat) {
  if (!mat || mat.userData.windFlap) return mat;
  mat.userData.windFlap = true;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey, prevOBR = mat.onBeforeRender;
  mat.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    Object.assign(sh.uniforms, WIND_UNIFORMS, CV_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FLAP_PARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = cvNormal(objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += cvOffset();');
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|wflap2'; };
  mat.onBeforeRender = function (...a) { prevOBR?.apply(this, a); cvBeforeRender.apply(this, a); };
  mat.needsUpdate = true;
  return mat;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Write the canvas attributes of a geometry: `aFlap` = weightFn(x, y, z) (metres, object frame), `aFlapG` its
 * gradient, `aFlapDir` a SMOOTH outward direction field (Gaussian average of the area-weighted face normals, oriented
 * away from the bbox centre, around each position: identical for coincident vertices, nearly so for nearby unwelded
 * ones), `aFlapP` = (metric position, units/metre).
 * @param {object} geo THREE.BufferGeometry @param {(x:number,y:number,z:number)=>number} weightFn
 * @param {number} [mPerUnit=1] metres per object unit (quantized GLBs) @param {number} [sigma=0.15] smoothing radius (m)
 */
export function canvasAttributes(geo, weightFn, mPerUnit = 1, sigma = 0.15) {
  const P = geo.attributes.position, n = P.count;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox, s = mPerUnit;
  const cx = (bb.min.x + bb.max.x) / 2 * s, cy = (bb.min.y + bb.max.y) / 2 * s, cz = (bb.min.z + bb.max.z) / 2 * s;
  const X = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { X[i * 3] = P.getX(i) * s; X[i * 3 + 1] = P.getY(i) * s; X[i * 3 + 2] = P.getZ(i) * s; }
  // weld by position (0.5 mm)
  const key = new Map(), gid = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(X[i * 3] * 2000)},${Math.round(X[i * 3 + 1] * 2000)},${Math.round(X[i * 3 + 2] * 2000)}`;
    let g = key.get(k); if (g === undefined) { g = key.size; key.set(k, g); }
    gid[i] = g;
  }
  // oriented, area-weighted normals sampled OVER each triangle (two-sided sheets: every face turned away from the
  // centre, so front/back skins never cancel); big faces (a tent wall) get several samples
  const N = geo.attributes.normal, idx = geo.index, G = key.size, sg = sigma, R = 2.5 * sg;
  const tri = idx ? idx.count / 3 : n / 3, v = (t, c) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
  const SC = [], SN = [], cell = new Map(), ci = (x) => Math.floor(x / R) + 1024, ck = (i, j, k) => (i * 2048 + j) * 2048 + k;
  const put = (x, y, z, nx, ny, nz) => { const k = ck(ci(x), ci(y), ci(z)); let l = cell.get(k); if (!l) cell.set(k, (l = [])); l.push(SC.length / 3); SC.push(x, y, z); SN.push(nx, ny, nz); };
  for (let t = 0; t < tri; t++) {
    const a = v(t, 0) * 3, b = v(t, 1) * 3, c = v(t, 2) * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
    const wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2];
    let fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * ((X[a] + X[b] + X[c]) / 3 - cx) + fy * ((X[a + 1] + X[b + 1] + X[c + 1]) / 3 - cy) + fz * ((X[a + 2] + X[b + 2] + X[c + 2]) / 3 - cz) < 0) { fx = -fx; fy = -fy; fz = -fz; }
    const L = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz));
    const k = Math.min(24, Math.max(1, Math.ceil(L / sg))), q = 1 / (k * k);
    for (let i = 0; i < k; i++) for (let j = 0; i + j < k; j++) for (const o of i + j < k - 1 ? [1 / 3, 2 / 3] : [1 / 3]) {
      const s1 = (i + o) / k, s2 = (j + o) / k; // sub-triangle centroids (up and down), each 1/k² of the area
      put(X[a] + ux * s1 + wx * s2, X[a + 1] + uy * s1 + wy * s2, X[a + 2] + uz * s1 + wz * s2, fx * q, fy * q, fz * q);
    }
  }
  // SMOOTH direction field: Gaussian (`sigma` m) average of those normals around each welded position, over
  // ALL parts of the mesh. Vertices close in space get close directions whatever the topology: a separate back panel
  // a few mm off the cover rim, a rolled-up hem (a thin cylinder whose faces point every way: it moves as one piece,
  // along the panel's normal), the inner/outer skins of a thick sheet. Coincident vertices share one value exactly.
  const acc = new Float64Array(G * 3), seen = new Uint8Array(G), i2 = 1 / (2 * sg * sg);
  for (let i = 0; i < n; i++) {
    const g = gid[i]; if (seen[g]) continue; seen[g] = 1;
    const px = X[i * 3], py = X[i * 3 + 1], pz = X[i * 3 + 2], bx = ci(px), by = ci(py), bz = ci(pz);
    let sx = 0, sy = 0, sz = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = cell.get(ck(bx + a, by + b, bz + c)); if (!l) continue;
      for (const t of l) {
        const dx = SC[t * 3] - px, dy = SC[t * 3 + 1] - py, dz = SC[t * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        const k = Math.exp(-d2 * i2); sx += SN[t * 3] * k; sy += SN[t * 3 + 1] * k; sz += SN[t * 3 + 2] * k;
      }
    }
    acc[g * 3] = sx; acc[g * 3 + 1] = sy; acc[g * 3 + 2] = sz;
  }
  const W = new Float32Array(n), WG = new Float32Array(n * 3), D = new Float32Array(n * 3), PP = new Float32Array(n * 4), h = 0.01;
  for (let i = 0; i < n; i++) {
    const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2], g = gid[i] * 3;
    let dx = acc[g], dy = acc[g + 1], dz = acc[g + 2], l = Math.hypot(dx, dy, dz);
    if (l < 1e-12 && N) { dx = N.getX(i); dy = N.getY(i); dz = N.getZ(i); l = Math.hypot(dx, dy, dz) || 1; } // isolated vertex
    D[i * 3] = dx / l; D[i * 3 + 1] = dy / l; D[i * 3 + 2] = dz / l;
    W[i] = weightFn(x, y, z);
    WG[i * 3] = (weightFn(x + h, y, z) - weightFn(x - h, y, z)) / (2 * h);
    WG[i * 3 + 1] = (weightFn(x, y + h, z) - weightFn(x, y - h, z)) / (2 * h);
    WG[i * 3 + 2] = (weightFn(x, y, z + h) - weightFn(x, y, z - h)) / (2 * h);
    PP[i * 4] = x - cx; PP[i * 4 + 1] = y - cy; PP[i * 4 + 2] = z - cz; PP[i * 4 + 3] = 1 / s;
  }
  const attr = (arr, k) => new THREE.BufferAttribute(arr, k);
  geo.setAttribute('aFlap', attr(W, 1)); geo.setAttribute('aFlapG', attr(WG, 3));
  geo.setAttribute('aFlapDir', attr(D, 3)); geo.setAttribute('aFlapP', attr(PP, 4));
  return geo;
}

/** Linear-interpolated lookup in a binned profile (empty bins filled from the nearest non-empty one). */
function profile(n, lo, step) {
  const a = new Float64Array(n).fill(NaN), has = new Uint8Array(n);
  return {
    put(x, v) { const i = Math.round((x - lo) / step); if (i >= 0 && i < n && !(a[i] >= v)) { a[i] = v; has[i] = 1; } },
    seal() {
      for (let i = 0; i < n; i++) if (Number.isNaN(a[i])) { let j = 1; while (j < n && Number.isNaN(a[i - j] ?? NaN) && Number.isNaN(a[i + j] ?? NaN)) j++; a[i] = Number.isNaN(a[i - j] ?? NaN) ? a[i + j] : a[i - j]; }
      return this;
    },
    at(x) { const f = Math.min(n - 1, Math.max(0, (x - lo) / step)), i = Math.floor(f), j = Math.min(n - 1, i + 1); return a[i] + (a[j] - a[i]) * (f - i); },
    a, has,
  };
}

/**
 * Pin-weight function of a vehicle canvas cover (long axis = object Z, rear = −Z unless `rear: 1`): 0 on the hoops
 * (found as the crests of the sagging roof line, else ~1 m apart) and along the bed-rail plane (y0), 1 in the middle of each
 * bay, ×(1 + `loose`) toward the free hem of the rear end panel. Pure function of the metric position.
 * @param {object} geo @param {number} [s=1] metres per unit @param {{rear?:number, loose?:number, taut?:number}} [o]
 */
export function coverWeightFn(geo, s = 1, o = {}) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const P = geo.attributes.position, bb = geo.boundingBox, n = P.count;
  const x0 = bb.min.x * s, x1 = bb.max.x * s, y0 = bb.min.y * s, y1 = bb.max.y * s, z0 = bb.min.z * s, z1 = bb.max.z * s;
  const xc = (x0 + x1) / 2, hwMax = (x1 - x0) / 2, st = 0.04;
  const halfW = profile(Math.ceil((y1 - y0) / st) + 1, y0, st), top = profile(Math.ceil(hwMax / st) + 1, 0, st);
  const ridge = profile(Math.ceil((z1 - z0) / st) + 1, z0, st);
  for (let i = 0; i < n; i++) {
    const x = Math.abs(P.getX(i) * s - xc), y = P.getY(i) * s, z = P.getZ(i) * s;
    halfW.put(y, x); top.put(x, y);
    if (x < hwMax * 0.35) ridge.put(z, y);
  }
  // the cross-section outline is also sampled ALONG the triangle edges: a side wall with vertices every 10 cm would
  // otherwise leave bins measured only by an end panel's interior vertices, and the weight would ripple in y
  const idx = geo.index, ne = idx ? idx.count : n;
  for (let t = 0; t < ne; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx ? idx.getX(t + e) : t + e, b = idx ? idx.getX(t + (e + 1) % 3) : t + (e + 1) % 3;
    const ax = P.getX(a) * s - xc, ay = P.getY(a) * s, bx = P.getX(b) * s - xc, by = P.getY(b) * s;
    const k = Math.ceil(Math.hypot(bx - ax, by - ay) / (st * 0.5));
    for (let j = 1; j < k; j++) { const x = Math.abs(ax + ((bx - ax) * j) / k), y = ay + ((by - ay) * j) / k; halfW.put(y, x); top.put(x, y); }
  }
  halfW.seal(); top.seal(); ridge.seal();
  // hoops: crests of the roof line between sagging bays
  const R = ridge.a, hoops = [];
  for (let i = 0; i < R.length; i++) {
    let crest = ridge.has[i] && (i === 0 || !ridge.has[i - 1] || R[i] > R[i - 1]), lo = R[i]; // measured bins only; a plateau counts once
    for (let j = Math.max(0, i - 12); j <= Math.min(R.length - 1, i + 12); j++) { if (R[j] > R[i]) crest = false; lo = Math.min(lo, R[j]); }
    if (crest && R[i] - lo > 0.012) hoops.push(z0 + i * st);
  }
  if (hoops.length < 2) { const k = Math.max(1, Math.round((z1 - z0) / 1.0)); hoops.length = 0; for (let i = 0; i <= k; i++) hoops.push(z0 + ((z1 - z0) * i) / k); }
  if (hoops[0] - z0 > 0.15) hoops.unshift(z0);
  if (z1 - hoops.at(-1) > 0.15) hoops.push(z1);
  hoops.sort((a, b) => a - b);
  let bay = 0; for (let i = 1; i < hoops.length; i++) bay = Math.max(bay, hoops[i] - hoops[i - 1]);
  const Rp = Math.min(0.5, Math.max(0.22, bay * 0.46)), rearSign = o.rear ?? -1, loose = o.loose ?? 0.8, taut = o.taut ?? 1;
  const zEnd = rearSign < 0 ? z0 : z1; // the rearmost geometry (a rolled-up hem hangs behind the end hoop)
  const fn = (x, y, z) => {
    const ax = Math.abs(x - xc);
    const dPer = Math.max(0, Math.min(halfW.at(y) - ax, top.at(ax) - y));
    let dh = 1e9; for (const h of hoops) dh = Math.min(dh, Math.hypot(z - h, dPer));
    // bed rails AND the whole bed-rail plane: the lower edge of every panel (sides, the rear panel's foot at the
    // tailgate) and a closed cover's bottom face (the library Blitz cover is a closed box) are held at y0
    const dr = Math.max(0, y - y0);
    const w = sstep(0, Rp, Math.min(dh, dr));
    // loose rear end panel: FLAT over the last 0.25 m in depth, so the panel, its hem and a rolled-up flap behind it
    // get one weight and move as one piece (a weight ramp across a 15 cm roll squashes and stretches it)
    const end = sstep(0.55, 0.25, (z - zEnd) * -rearSign) * sstep(0.2, 0.55, dPer);
    return taut * w * (1 + loose * end);
  };
  fn.hoops = hoops;
  return fn;
}

/**
 * Split canvas triangles whose edges exceed `maxEdge` metres (red-green: every triangle sharing a long edge splits
 * it at the same midpoint, so no T-junction cracks). Flat end caps modelled as one triangle fan (the truck's rear
 * valance) get interior vertices and can billow. All attributes are linearly interpolated (rebuilt as Float32).
 * @param {object} geo THREE.BufferGeometry @param {number} [maxEdge=0.3] @param {number} [s=1] metres per unit
 * @returns {object} the same geometry (or a new one when something was split)
 */
export function subdivideCanvas(geo, maxEdge = 0.3, s = 1) {
  if (geo.groups.length > 1 || Object.keys(geo.morphAttributes).length) return geo;
  const P = geo.attributes.position, names = Object.keys(geo.attributes);
  let idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: P.count }, (_, i) => i);
  const data = {}; for (const k of names) { const A = geo.attributes[k]; data[k] = { k: A.itemSize, v: [] }; for (let i = 0; i < A.count; i++) for (let c = 0; c < A.itemSize; c++) data[k].v.push(A.getComponent(i, c)); }
  const pos = data.position.v, L2 = (maxEdge / s) ** 2;
  const len2 = (a, b) => (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
  const pk = (a) => `${Math.round(pos[a * 3] * 1e4)},${Math.round(pos[a * 3 + 1] * 1e4)},${Math.round(pos[a * 3 + 2] * 1e4)}`;
  let changed = false;
  for (let pass = 0; pass < 6; pass++) {
    const marked = new Set(), ek = (a, b) => { const x = pk(a), y = pk(b); return x < y ? x + '|' + y : y + '|' + x; };
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; if (len2(a, b) > L2) marked.add(ek(a, b)); }
    if (!marked.size) break;
    changed = true;
    const mids = new Map(), mid = (a, b) => {
      const key = a < b ? a + ':' + b : b + ':' + a;
      let m = mids.get(key);
      if (m === undefined) {
        m = pos.length / 3; mids.set(key, m);
        for (const k of names) { const d = data[k]; for (let c = 0; c < d.k; c++) d.v.push((d.v[a * d.k + c] + d.v[b * d.k + c]) / 2); }
        if (data.normal) { const v = data.normal.v, l = Math.hypot(v[m * 3], v[m * 3 + 1], v[m * 3 + 2]) || 1; for (let c = 0; c < 3; c++) v[m * 3 + c] /= l; }
      }
      return m;
    };
    const out = [];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]], mk = [0, 1, 2].map((e) => marked.has(ek(v[e], v[(e + 1) % 3])));
      const n = mk.filter(Boolean).length;
      if (!n) { out.push(...v); continue; }
      if (n === 3) {
        const a = mid(v[0], v[1]), b = mid(v[1], v[2]), c = mid(v[2], v[0]);
        out.push(v[0], a, c, a, v[1], b, c, b, v[2], a, b, c);
        continue;
      }
      // rotate so edge 0 (v0-v1) is marked; for two marked edges, edge 1 (v1-v2) is the other one
      let r = mk.indexOf(true);
      if (n === 2 && !mk[(r + 1) % 3]) r = (r + 2) % 3;
      const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3], m0 = mid(a, b);
      if (n === 1) { out.push(a, m0, c, m0, b, c); continue; }
      const m1 = mid(b, c);
      out.push(m0, b, m1, a, m0, m1, a, m1, c);
    }
    idx = out;
  }
  if (!changed) return geo;
  for (const k of names) geo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(data[k].v), data[k].k));
  geo.setIndex(idx);
  geo.boundingBox = null; geo.boundingSphere = null;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** Metres per object unit of a mesh (quantized GLBs carry a node scale). */
const metresPerUnit = (o) => { o.updateWorldMatrix?.(true, false); const e = o.matrixWorld.elements; return Math.hypot(e[0], e[1], e[2]) || 1; };

/**
 * One call per vehicle canvas mesh (current truck GLBs and the vehicle library): weld-safe attributes from the cover
 * pin model + the canvas shader. @param {object} mesh THREE.Mesh @param {{rear?:number, loose?:number, taut?:number}} [o]
 * (`taut` < 1 for a car's folding top: barely ripples)
 */
export function applyCanvasCover(mesh, o = {}) {
  const g = mesh.geometry;
  if (!g.attributes.aFlapDir) {
    const s = metresPerUnit(mesh);
    subdivideCanvas(g, 0.3, s);
    canvasAttributes(g, coverWeightFn(g, s, o), s);
    g.userData.canvasCover = true;
  }
  return ownCanvasMaterial(mesh);
}

/** Legacy geometry (only `aFlap`, e.g. an older vehicle path): build the cover attributes on first draw. */
function canvasAutoAttrs(object, geo) {
  const s = metresPerUnit(object);
  canvasAttributes(geo, coverWeightFn(geo, s), s);
}

/**
 * Keep canvas attributes consistent when a geometry is transformed (dressing `consolidate`): directions rotate,
 * the metric field coordinate moves with the vertices. @param {object} geo @param {object} m THREE.Matrix4
 */
export function transformCanvasAttrs(geo, m) {
  const D = geo.attributes.aFlapDir, G = geo.attributes.aFlapG, P = geo.attributes.aFlapP;
  if (D) D.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(m));
  if (G) G.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(m));
  if (P) {
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(m); P.setXYZ(i, v.x, v.y, v.z); }
  }
  return geo;
}

// ------------------------------------------------------------------ ropes, wires, whip antennas
const SWAY_PARS = WIND_GLSL + /* glsl */ `
attribute float aSway;
`;
const SWAY_MAIN = /* glsl */ `
if (aSway > 0.001) {
  vec3 swW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec4 swS = windSample(swW.xz);
  float swV = length(swS.xy);
  vec2 swD = swV > 1e-3 ? swS.xy / swV : uWindA.xy;
  float swPh = uWindA.w * 2.6 + dot(swW.xz, vec2(0.37, 0.29)); // fixed rate (no t·speed chirp)
  vec3 swO = (vec3(swD.x, 0.0, swD.y) * (0.0009 * swV * swV + 0.012 * swS.z)
    + vec3(-swD.y, 0.25, swD.x) * sin(swPh) * (0.004 * swV + 0.02 * swS.z)) * aSway;
  mat3 swM = mat3(modelMatrix);
  transformed += (swO * swM) / max(dot(swM[0], swM[0]), 1e-6);
}
`;

/** Rope / wire / antenna sway: chains `material.onBeforeCompile` once; vertices with `aSway` (0 fixed .. 1 free). */
export function applySway(mat) {
  if (!mat || mat.userData.windSway) return mat;
  mat.userData.windSway = true;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    Object.assign(sh.uniforms, WIND_UNIFORMS);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SWAY_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_MAIN);
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|wsway2'; };
  mat.needsUpdate = true;
  return mat;
}

/**
 * aSway for a span along the geometry's local Y (a CylinderGeometry rope/wire): sin(π·t) between the two fixings,
 * or t² for a whip antenna fixed at its base (`whip`). `k` scales it (taut guy rope ≈ 0.3, slack wire 1).
 */
export function swayWeights(geo, k = 1, whip = false) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const P = geo.attributes.position, y0 = geo.boundingBox.min.y, L = Math.max(geo.boundingBox.max.y - y0, 1e-3);
  const F = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) { const t = (P.getY(i) - y0) / L; F[i] = k * (whip ? t * t : Math.sin(Math.PI * t)); }
  geo.setAttribute('aSway', new geo.attributes.position.constructor(F, 1));
  return geo;
}
