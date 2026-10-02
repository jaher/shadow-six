/**
 * Desert scrub (docs/vegetation.md §3.2): instanced 3D shrub archetypes (scrub-geo.js) on nebkha sand mounds.
 *  - placeScrub: ecological placement (pure) — Poisson-like jittered grid 2.6 m thinned by clumped patches, denser on
 *    run-off ground (dirt / dry grass / mud / road verges), never on paving, structures or the flattened pads.
 *  - nebkhaField: each plant's sand mound + downwind tail, added to the terrain heightfield before the mesh is built
 *    (terrain.js), so plants sit IN the ground rather than on it like stickers.
 *  - createScrub: one InstancedMesh per archetype variant (≤ 8 draws), wind bend from world/wind.js.
 * @module terrain-b/scrub
 */
import * as THREE from 'three';
import { rng, fbm } from './noise.js';
import { scrubArchetype } from './scrub-geo.js';
import { WIND_GLSL } from '../../world/wind.js';

const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export const SCRUB_KINDS = ['camelthorn', 'saltbush', 'retama', 'deadtwig'];
const KIND_W = { camelthorn: 0.38, saltbush: 0.22, retama: 0.12, deadtwig: 0.28 };
const KIND_S = { camelthorn: [0.8, 1.5], saltbush: [0.8, 1.5], retama: [0.8, 1.35], deadtwig: [0.6, 1.2] };

/**
 * @param {object} env {W, D, runoff(x,z)→0..1 (dirt / dry grass / mud / verge weight), open(x,z)→bool (no paving,
 *   structure, deck, flattened pad)}
 * @param {{density?:number, seed?:number, max?:number}} o
 * @returns {{x:number,z:number,kind:string,s:number,rot:number,variant:number,mound:number}[]}
 */
export function placeScrub(env, o = {}) {
  const { W, D } = env, r = rng(o.seed || 977), out = [], cell = 2.6, dens = o.density ?? 1;
  for (let z = 0; z < D; z += cell) for (let x = 0; x < W; x += cell) {
    const px = x + r() * cell, pz = z + r() * cell;
    if (px >= W || pz >= D) continue;
    const patch = ss(0.42, 0.72, fbm(px / 18, pz / 18, 3, 811)), ro = env.runoff(px, pz);
    const p = (0.05 + 0.32 * patch + 0.6 * ro) * dens;
    if (r() > p) continue;
    if (!env.open(px, pz)) continue;
    let t = r() * (KIND_W.camelthorn + KIND_W.saltbush + KIND_W.retama + KIND_W.deadtwig), kind = 'deadtwig';
    for (const k of SCRUB_KINDS) { t -= KIND_W[k] * (k === 'retama' ? 0.5 + ro : 1); if (t <= 0) { kind = k; break; } }
    const [s0, s1] = KIND_S[kind], s = s0 + (s1 - s0) * r() * (0.7 + 0.3 * patch);
    out.push({ x: px, z: pz, kind, s, rot: r() * Math.PI * 2, variant: r() < 0.5 ? 0 : 1, mound: kind === 'deadtwig' ? 0.35 + 0.4 * r() : 0.7 + 0.5 * r() });
    if (out.length >= (o.max || 2000)) return out;
  }
  return out;
}

/**
 * Nebkha heights: a dome under each plant (radius ∝ size) plus a tapering tail downwind. Returns (x, z) → metres.
 * @param {ReturnType<typeof placeScrub>} list @param {{x:number,y:number}} wind (unit vector, x/z)
 */
export function nebkhaField(list, wind) {
  const B = 4, buckets = new Map(), wx = wind.x, wz = wind.y;
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const p of list) {
    if (!(p.mound > 0)) continue;
    const R = 0.75 * p.s + 0.35, H = 0.1 + 0.16 * p.s * p.mound, L = R * 2.6;
    const e = { x: p.x, z: p.z, R, H, L };
    const ext = R + L + 0.5; // conservative: the tail can point anywhere
    const i0 = Math.floor((p.x - ext) / B), i1 = Math.floor((p.x + ext) / B), j0 = Math.floor((p.z - ext) / B), j1 = Math.floor((p.z + ext) / B);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = key(i, j); (buckets.get(k) || buckets.set(k, []).get(k)).push(e); }
  }
  return (x, z) => {
    const b = buckets.get(key(Math.floor(x / B), Math.floor(z / B)));
    if (!b) return 0;
    let h = 0;
    for (const e of b) {
      const dx = x - e.x, dz = z - e.z, u = dx * wx + dz * wz, v = -dx * wz + dz * wx;
      const d = Math.hypot(dx, dz) / e.R;
      let m = d < 1 ? (1 - d * d) * (1 - d * d) : 0;
      if (u > 0 && u < e.L) { // wind-shadow tail: narrows and lowers downwind
        const k = u / e.L, wv = e.R * (1 - 0.65 * k), q = Math.abs(v) / wv;
        if (q < 1) m = Math.max(m, (1 - k) * 0.8 * (1 - q * q) * (1 - q * q));
      }
      h = Math.max(h, m * e.H);
    }
    return h;
  };
}

/** Wind bend for the scrub instances (world-space offset after the instance transform). */
const SCRUB_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  // twigs / thorns thinner than ~1.6 px at this zoom are widened to it along their own cross-section (uMinW: world m
  // per px × 1.1, set by grass.update): a 3 cm pan no longer flickers whole sprig silhouettes on and off
  float iS = max(length(instanceMatrix[0].xyz), 1e-3);
  mvPosition.xyz += aWid.xyz * max(uMinW * 0.75 / iS - aWid.w, 0.0); // ≥ ~1.6 px wide: below that the twig crawls
  mvPosition = instanceMatrix * mvPosition;
  vec3 ip = instanceMatrix[3].xyz;
#else
  vec3 ip = vec3(0.0);
#endif
{
  vec4 wS = windSample(ip.xz);
  float ws = windStr(wS) * uWindStr;
  vec2 wd = length(wS.xy) > 1e-3 ? wS.xy / length(wS.xy) : uWindA.xy;
  float ph = uWindA.w * 1.9 + dot(ip.xz, vec2(0.37, 0.21));
  float osc = sin(ph + aSway * 2.2) * 0.55 + sin(ph * 2.7 + 1.1) * 0.25 + wS.w * 0.2;
  float lean = ws * ws * 0.55 + wS.z * uWindStr * 0.35;
  float k = aSway * aSway * uScrubAmp;
  mvPosition.xz += (wd * (lean + osc * (0.06 + 0.35 * ws)) + vec2(-wd.y, wd.x) * osc * 0.04) * k;
  mvPosition.y -= lean * lean * k * 0.15;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * @param {object} ctx terrain context (scrubPlan from terrain.js, heightAt, W, D, gl) @param {{clutter:number}} q
 * @param {THREE.Group} group @param {object} U grass uniforms (shared wind)
 */
export function createScrub(ctx, q, group, U) {
  const lod = Math.max(0.4, q.clutter ?? 1);
  const plan = ctx.scrubPlan || [];
  const meshes = [];
  const SU = { uScrubAmp: { value: 0.22 } };
  const patch = (sh) => {
    Object.assign(sh.uniforms, U, SU);
    sh.vertexShader = WIND_GLSL + 'attribute float aSway;\nattribute vec4 aWid;\nuniform float uWindStr;\nuniform float uScrubAmp;\nuniform float uMinW;\n' +
      sh.vertexShader.replace('#include <project_vertex>', SCRUB_PROJECT);
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = patch; mat.customProgramCacheKey = () => 'scrubB';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = patch; depth.customProgramCacheKey = () => 'scrubBdepth';
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const r = rng(4243);
  // crush (vehicles): instances in a 4 m hash; a crushed plant is pressed flat, splayed and browned for the rest of
  // the mission (ctx.scrubCrushed survives quality rebuilds)
  const hash = new Map(), crushed = (ctx.scrubCrushed ??= new Set());
  const key = (x, z) => Math.floor(x / 4) + ',' + Math.floor(z / 4);
  const flatten = (im, i, p) => {
    const rr = rng(Math.floor(p.x * 131 + p.z * 977));
    e.set((rr() - 0.5) * 0.5, p.rot + rr(), (rr() - 0.5) * 0.5); qt.setFromEuler(e);
    im.setMatrixAt(i, m4.compose(ps.set(p.x, ctx.heightAt(p.x, p.z) - 0.02, p.z), qt, sc.set(p.s * 1.35, p.s * 0.2, p.s * 1.35)));
    im.getColorAt(i, col); im.setColorAt(i, col.multiplyScalar(0.62).offsetHSL(-0.02, -0.15, 0));
  };
  for (const kind of SCRUB_KINDS) for (const variant of [0, 1]) {
    const list = plan.filter((p) => p.kind === kind && p.variant === variant);
    if (!list.length) continue;
    const A = scrubArchetype(kind, 1 + variant, lod);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(A.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(A.col, 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(A.sway, 1));
    g.setAttribute('aWid', new THREE.BufferAttribute(A.wid, 4));
    g.setIndex(A.idx);
    const im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((p, i) => {
      // planted into its mound; a slight random tilt (dead twigs lie over further)
      const tilt = kind === 'deadtwig' ? 0.35 : 0.08;
      e.set((r() - 0.5) * tilt, p.rot, (r() - 0.5) * tilt); qt.setFromEuler(e);
      im.setMatrixAt(i, m4.compose(ps.set(p.x, ctx.heightAt(p.x, p.z) - 0.04 * p.s, p.z), qt, sc.set(p.s, p.s * (0.85 + 0.3 * r()), p.s)));
      const v = 0.82 + 0.36 * r();
      im.setColorAt(i, col.setRGB(v * (0.95 + 0.1 * r()), v, v * (0.9 + 0.12 * r())));
      const k = key(p.x, p.z);
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push([im, i, p]);
      if (crushed.has(p.x + ',' + p.z)) flatten(im, i, p);
    });
    im.name = 'scrub:' + kind; im.castShadow = true; im.receiveShadow = true;
    im.customDepthMaterial = depth;
    im.userData.archetype = kind; im.userData.tris = A.idx.length / 3; im.userData.height = A.height;
    im.computeBoundingSphere();
    group.add(im); meshes.push(im);
  }
  return {
    meshes,
    get count() { return meshes.reduce((s, m) => s + m.count, 0); },
    get triangles() { return meshes.reduce((s, m) => s + m.count * m.userData.tris, 0); },
    update() {},
    /** Vehicles crush the plants under them (x, z, radius m). @returns {number} plants crushed now */
    crush(x, z, rad) {
      let n = 0;
      for (let a = Math.floor((x - rad) / 4); a <= Math.floor((x + rad) / 4); a++) for (let b = Math.floor((z - rad) / 4); b <= Math.floor((z + rad) / 4); b++) {
        for (const [im, i, p] of hash.get(a + ',' + b) || []) {
          const k = p.x + ',' + p.z;
          if (p.hero || crushed.has(k) || Math.hypot(p.x - x, p.z - z) > rad + 0.3 * p.s) continue; // hero: a mission bush
          crushed.add(k); flatten(im, i, p); n++;
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
      }
      return n;
    },
    dispose() { for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.dispose?.(); } mat.dispose(); depth.dispose(); },
  };
}

/**
 * Keep shrubs off the spots where people stand at mission start (enemy posts, commandos, items, interactables) and
 * off patrol waypoints: a guard planted in a camel-thorn bush reads as a bug. Returns (x, z) → true when clear.
 * @param {object|null} mission @param {number} [r] clearance (m)
 */
export function spawnClearance(mission, r = 1.6) {
  const B = 4, buckets = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const add = (x, z) => { if (Number.isFinite(x) && Number.isFinite(z)) { const k = key(Math.floor(x / B), Math.floor(z / B)); (buckets.get(k) || buckets.set(k, []).get(k)).push(x, z); } };
  const pt = (p) => (Array.isArray(p) ? add(p[0], p[1]) : p && add(p.x, p.z));
  for (const list of [mission?.enemies, mission?.commandos, mission?.items, mission?.interactables]) {
    for (const e of Array.isArray(list) ? list : []) { pt(e); for (const q of e?.route?.points || []) pt(q); }
  }
  return (x, z) => {
    const i0 = Math.floor(x / B), j0 = Math.floor(z / B);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      const b = buckets.get(key(i, j)); if (!b) continue;
      for (let k = 0; k < b.length; k += 2) if (Math.hypot(b[k] - x, b[k + 1] - z) < r) return false;
    }
    return true;
  };
}
