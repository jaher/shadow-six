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
import { WIND_GLSL, WIND_UNIFORMS } from '../world/wind.js';

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
  float cwPh = uWindA.w * (7.0 + 0.3 * cwS) + aFlutter.y + cwP.y * 4.0;
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
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|cwind1'; };
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

// ------------------------------------------------------------------ canvas: tents, tarps, truck covers
const FLAP_PARS = WIND_GLSL + /* glsl */ `
attribute float aFlap;
`;
const FLAP_MAIN = /* glsl */ `
if (aFlap > 0.001) {
  vec3 fpW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec4 fW = windSample(fpW.xz);
  mat3 fM = mat3(modelMatrix);
  vec3 fN = normalize(fM * objectNormal);
  float fS = length(fW.xy), fP = dot(vec3(fW.x, 0.0, fW.y), fN);
  float fPh = uWindA.w * (4.5 + 0.35 * fS) + dot(fpW.xz, vec2(1.3, 1.1)) * 1.6;
  // windward panels pushed in, leeward ones billow out (suction), plus a travelling ripple that snaps with gusts
  float fD = aFlap * (-0.009 * fP + (0.003 * fS + 0.035 * fW.z) * sin(fPh) + 0.012 * fW.z * sin(fPh * 2.3 + 1.0));
  transformed += objectNormal * fD / max(length(fM[0]), 1e-4);
}
`;

/**
 * Canvas flapping (tents, tarps, truck covers): chains `material.onBeforeCompile` once; vertices with an `aFlap`
 * attribute (0 = seam/frame, 1 = free panel middle) billow and ripple with the mission wind.
 */
export function applyFlap(mat) {
  if (!mat || mat.userData.windFlap) return mat;
  mat.userData.windFlap = true;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    Object.assign(sh.uniforms, WIND_UNIFORMS);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FLAP_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FLAP_MAIN);
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|wflap1'; };
  mat.needsUpdate = true;
  return mat;
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
  float swPh = uWindA.w * (2.2 + 0.15 * swV) + dot(swW.xz, vec2(0.37, 0.29));
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
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|wsway1'; };
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
