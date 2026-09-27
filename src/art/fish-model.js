/**
 * Fish rendering (step 4f): one InstancedMesh per species, a procedural fusiform body (unit length along +X, head
 * at +X) with a forked caudal fin, dorsal fin and pectorals; GPU vertex-animated swimming — a carangiform travelling
 * wave whose amplitude grows towards the tail, plus a C-bend for turns (bursts). Phase / amplitude / bend come per
 * instance from the CPU sim (src/world/fish-sim.js) on sim time, so paused fish freeze.
 *
 * Fish are ordinary world geometry BELOW the water surface: the water's composite pass (src/art/water/passes.js)
 * refracts them from the scene colour and applies Beer–Lambert absorption along the stashed depth, so they read
 * clearly in clear shallow water, fade with depth and vanish in muddy water; caustics play over their backs and
 * they cast faint shadows on the bed (high/ultra). Tagged waterIgnore/dynamic so no bed capture ever sees them.
 * @module art/fish-model
 */
import * as THREE from 'three';
import { FISH_SPECIES } from '../world/fish-sim.js';
import { animDepthMaterial } from './bird-model.js';

// body half-depth profile along u (0 snout … 1 tail tip); the body ends at u = 0.88 (caudal peduncle)
const PROF = [[0, 0.06], [0.04, 0.45], [0.12, 0.78], [0.26, 0.98], [0.4, 1], [0.55, 0.85], [0.7, 0.55], [0.82, 0.28], [0.88, 0.17]];
const prof = (u) => {
  for (let i = 1; i < PROF.length; i++) if (u <= PROF[i][0]) { const [a, pa] = PROF[i - 1], [b, pb] = PROF[i]; return pa + (pb - pa) * (u - a) / (b - a); }
  return PROF[PROF.length - 1][1];
};

/**
 * Unit-length fish geometry. Attributes: position/normal, aFU = (u along body 0 snout → 1 tail, height on the
 * cross-section −1 belly … 1 back, fin flag, side −1/1).
 */
export function fishGeometry(S, segs = 12, ring = 8) {
  const P = [], N = [], A = [], I = [];
  const hd = S.depthR / 2, hw = S.widthR / 2;
  const x = (u) => 0.5 - u;                               // head at +X
  for (let i = 0; i <= segs; i++) {
    const u = (i / segs) * 0.88, p = prof(u);
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); // a = 0 back, π belly
      const y = c * hd * p - hd * 0.08 * p, z = s * hw * p;
      P.push(x(u), y, z);
      const n = new THREE.Vector3(0.15 * (i < 2 ? 1 : 0), c / Math.max(hd, 1e-3), s / Math.max(hw, 1e-3)).normalize();
      N.push(n.x, n.y, n.z); A.push(u, c, 0, s < 0 ? -1 : 1);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b = i * ring + (j + 1) % ring, c = a + ring, d = b + ring;
    I.push(a, c, b, b, c, d);
  }
  const tri = (pts, u, h, nrm) => { // flat fin, both sides via DoubleSide
    const b = P.length / 3;
    for (const q of pts) { P.push(...q); N.push(...nrm); A.push(u, h, 1, 0); }
    for (let k = 1; k + 1 < pts.length; k++) I.push(b, b + k, b + k + 1);
  };
  // caudal fin: two lobes, fork depth from the species
  const t0 = x(0.86), t1 = x(1.0), th = hd * 1.25, notch = t1 + (t0 - t1) * S.fork * 0.75, bh = hd * 0.15;
  tri([[t0, bh, 0], [t1, th, 0], [notch, 0, 0]], 0.95, 0.5, [0, 0, 1]);
  tri([[t0, -bh, 0], [notch, 0, 0], [t1, -th * 0.92, 0]], 0.95, -0.5, [0, 0, 1]);
  tri([[t0, bh, 0], [notch, 0, 0], [t0, -bh, 0]], 0.9, 0, [0, 0, 1]);
  // dorsal fin (two for cod / pollock read as one at this size), pectorals angled out and down
  tri([[x(0.32), hd * 0.95, 0], [x(0.42), hd * 1.75, 0], [x(0.58), hd * 0.8, 0]], 0.45, 1, [0, 0, 1]);
  for (const sd of [-1, 1]) tri([[x(0.2), -hd * 0.35, sd * hw * 0.8], [x(0.34), -hd * 0.55, sd * hw * 2.6], [x(0.3), -hd * 0.55, sd * hw * 0.8]], 0.27, -0.4, [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aFU', new THREE.Float32BufferAttribute(A, 4));
  g.setIndex(I);
  return g;
}

const VPARS = /* glsl */ `
attribute vec4 aFU; attribute vec4 aAnim;   // aAnim: tail phase, tail amplitude (body lengths), bend (−1..1), pattern seed
varying vec4 vFU; varying float vSeed;
`;
// carangiform wave: lateral offset grows ~u² towards the tail, one body wavelength; the turn bend is a C-arc
const VMAIN = /* glsl */ `
float fu = aFU.x;
float envA = aAnim.y * (0.12 + 0.88 * fu * fu);
float wv = 6.2831853 * fu * 0.95 - aAnim.x;
float bendZ = aAnim.z * 0.32 * (fu - 0.3) * (fu - 0.3);
float latZ = envA * sin(wv) + bendZ;
float slope = envA * cos(wv) * 5.97 + aAnim.y * 1.76 * fu * sin(wv) + aAnim.z * 0.64 * (fu - 0.3);  // d(lat)/du
float phN = atan(slope), cs = cos(phN), sn = sin(phN);
vec3 objectNormal = vec3(normal.x * cs + normal.z * sn, normal.y, -normal.x * sn + normal.z * cs);
vFU = aFU; vSeed = aAnim.w;
`;
// countershading (dark back → silver flank → white belly) + species markings, guanine-mirror flanks
const FPARS = /* glsl */ `
varying vec4 vFU; varying float vSeed;
uniform vec3 uBack, uFlank, uBelly; uniform float uPattern, uMetal;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y); }
`;
const FMAIN = /* glsl */ `
float u = vFU.x, hv = vFU.y;
vec3 fc = mix(uBelly, uFlank, smoothstep(-0.75, -0.1, hv));
fc = mix(fc, uBack, smoothstep(0.2, 0.8, hv));
vec2 pq = vec2(u * 18.0, hv * 4.0 + vFU.w * 3.1) + vSeed * 7.0;
if (uPattern > 0.5 && uPattern < 1.5) fc *= 1.0 - 0.5 * smoothstep(0.3, 0.6, sin(u * 43.0 - 1.2)) * smoothstep(-0.4, 0.2, hv) * step(0.12, u) * step(u, 0.8);
if (uPattern > 1.5 && uPattern < 2.5) { float sp = step(0.8, fHash(floor(pq))) * smoothstep(-0.5, 0.0, hv); fc = mix(fc, fHash(floor(pq) + 3.0) > 0.8 ? vec3(0.55, 0.12, 0.06) : fc * 0.35, sp * step(length(fract(pq) - 0.5), 0.3)); }
if (uPattern > 2.5 && uPattern < 3.5) fc *= 0.72 + 0.5 * fNoise(pq * 1.3) * smoothstep(-0.5, 0.3, hv);
if (uPattern > 2.5 && uPattern < 4.5) fc = mix(fc, uBelly, 0.55 * (1.0 - smoothstep(0.0, 0.08, abs(hv - 0.15))) * step(0.15, u));
if (uPattern > 4.5) fc *= 1.0 - 0.18 * smoothstep(0.6, 1.0, sin(hv * 22.0)) * smoothstep(-0.6, 0.0, hv) * (1.0 - smoothstep(0.6, 0.8, hv));
fc = mix(fc, vec3(0.02), (1.0 - smoothstep(0.018, 0.028, length(vec2(u - 0.07, (abs(hv) - 0.35) * 0.12)))) * step(abs(vFU.w), 1.5) * (1.0 - vFU.z));
fc = mix(fc, uBack * 0.8, vFU.z * 0.85);                                          // fins
diffuseColor.rgb = fc;
`;

// skin / mucus against water: n 1.37 vs 1.33 → F0 ≈ 0.0002, so wet backs have no sheen under water; only the
// guanine-crystal mirrors of the flanks (metalness) reflect — the silver flash of a turning school
const UNDERWATER_F0 = 'material.specularColor = vec3(0.0004); material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor); material.specularF90 = mix(0.03, 1.0, metalnessFactor);';

/** Material of one species (MeshStandard + swim wave in the vertex stage, markings in the fragment stage). */
export function fishMaterial(S) {
  const c = (h) => new THREE.Color(h).convertSRGBToLinear();
  const U = { uBack: { value: c(S.back) }, uFlank: { value: c(S.flank) }, uBelly: { value: c(S.belly) }, uPattern: { value: S.pattern }, uMetal: { value: S.metal } };
  // under water the fish sees only Snell's window of sky: keep the IBL sheen of backs low, mirror flanks flash
  const m = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VPARS + sh.vertexShader.replace('#include <beginnormal_vertex>', VMAIN)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position.x, position.y, position.z + latZ);');
    sh.fragmentShader = FPARS + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FMAIN)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uMetal * (1.0 - smoothstep(0.35, 0.85, vFU.y)) * (1.0 - vFU.z);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + UNDERWATER_F0)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.3, 0.62, smoothstep(0.3, 0.9, vFU.y));');
  };
  m.customProgramCacheKey = () => 'fish1';
  m.userData.fish = true;
  return m;
}

/**
 * Instanced fish of one species with room for `cap` instances.
 * @returns {{mesh:THREE.InstancedMesh, anim:THREE.InstancedBufferAttribute, cap:number, sp:string}}
 */
export function createFishMesh(sp, cap, o = {}) {
  const S = FISH_SPECIES[sp];
  const g = fishGeometry(S, o.segs ?? 12, o.ring ?? 8);
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aAnim', anim);
  const mesh = new THREE.InstancedMesh(g, fishMaterial(S), cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.name = `fish_${sp}`;
  // the mirror flanks reflect the water column's downwelling light: the scene IBL is calibrated dim (sun-dominated),
  // so the fish get the environment map explicitly at a mirror-appropriate intensity
  if (o.envMap) { mesh.material.envMap = o.envMap; mesh.material.envMapIntensity = o.envIntensity ?? 0.6; }
  mesh.castShadow = !!o.shadows; mesh.receiveShadow = true;
  if (o.shadows) mesh.customDepthMaterial = animDepthMaterial(VPARS, VMAIN + 'vec3 transformed = vec3(position.x, position.y, position.z + latZ);', {}, 'fishDepth1');
  mesh.userData.waterIgnore = true; mesh.userData.dynamic = true; mesh.userData.ambientLife = 'fish';
  return { mesh, anim, cap, sp };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Write the visible fish (sim objects) into the instance buffers. `inView(x, z)` culls. Returns the count.
 * World heading yaw (atan2(vz, vx)) → rotation about Y by −yaw (the model's head is +X).
 */
export function writeFish(h, fish, inView) {
  let n = 0;
  const A = h.anim.array;
  for (const f of fish) {
    if (n >= h.cap) break;
    if (inView && !inView(f.x, f.z)) continue;
    _e.set(f.roll, -f.yaw, f.pitch);
    _q.setFromEuler(_e);
    _m.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(f.len));
    h.mesh.setMatrixAt(n, _m);
    A[n * 4] = f.phase; A[n * 4 + 1] = f.amp; A[n * 4 + 2] = f.bend; A[n * 4 + 3] = f.pref;
    n++;
  }
  h.mesh.count = n;
  if (n) { h.mesh.instanceMatrix.needsUpdate = true; h.anim.needsUpdate = true; }
  return n;
}

/**
 * Soft fish shadows on the bed (one instanced draw for every species): shadow maps ignore refraction (the sun under
 * water is much steeper: Snell) and underwater light is diffuse, so each fish gets a soft elongated darkening on the
 * bed, offset along the REFRACTED sun ray, wider and fainter the higher the fish swims above the bed; overcast skies
 * leave only a faint occlusion right below. Drawn with the bed (before the water composite), so it is absorbed too.
 */
export function createFishShadows(cap) {
  const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const op = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  op.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aOp', op);
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aOp; varying float vOp; varying vec2 vQ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = aOp; vQ = position.xz * 2.0;');
    sh.fragmentShader = 'varying float vOp; varying vec2 vQ;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a = vOp * exp(-dot(vQ, vQ) * 2.6);');
  };
  m.customProgramCacheKey = () => 'fishShadow1';
  const mesh = new THREE.InstancedMesh(g, m, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; mesh.frustumCulled = false; mesh.name = 'fish_shadows'; mesh.renderOrder = -1;
  mesh.userData.waterIgnore = true; mesh.userData.dynamic = true; mesh.userData.ambientLife = 'fishShadow';
  return { mesh, op, cap };
}

/**
 * @param {{x:number,y:number,z:number}} sun unit vector towards the sun @param {number} direct 0 overcast … 1 clear
 */
export function writeFishShadows(h, fish, inView, sun, direct = 1) {
  const el = Math.max(0.05, sun.y), hz = Math.hypot(sun.x, sun.z) || 1;
  const sinT = Math.sqrt(1 - el * el) / 1.333, tanT = sinT / Math.sqrt(1 - sinT * sinT) * direct; // Snell: steeper in water
  const ox = -sun.x / hz, oz = -sun.z / hz, A = h.op.array;
  let n = 0;
  for (const f of fish) {
    if (n >= h.cap) break;
    if (inView && !inView(f.x, f.z)) continue;
    const bed = f.level - f.depth, ht = Math.max(0, f.y - bed);
    const blur = ht * (0.25 + 0.35 * (1 - direct));
    _e.set(0, -f.yaw, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(f.x + ox * ht * tanT, bed + 0.02, f.z + oz * ht * tanT), _q, _s.set(f.len * 1.05 + blur * 1.6, 1, f.len * f.S.depthR * 0.9 + blur * 1.6));
    h.mesh.setMatrixAt(n, _m);
    A[n] = (0.16 + 0.36 * direct) * Math.min(1, f.len * f.S.depthR * 0.9 / (f.len * f.S.depthR * 0.9 + blur * 1.6) * 2.2) * (f.stun > 0 ? 0.5 : 1);
    n++;
  }
  h.mesh.count = n;
  if (n) { h.mesh.instanceMatrix.needsUpdate = true; h.op.needsUpdate = true; }
  return n;
}
