/**
 * Dry hulls: no water is drawn inside a floating hull.
 *
 * The water surface is one sheet drawn after the world and depth-tested against it. An open boat's floor sits at the
 * waterline (the raft's floor 2 cm above it, the rowboat's floorboards 3 cm, its bilge below), so as the hull bobs,
 * pitches and rolls — and wherever a sea wave or a surf crest runs under it — the sheet would come up through the
 * floor and the men sitting on it would look as if they sat in water. Each boat's waterline plan is cut out of the
 * sheet: the water shader takes every fragment into the frame of up to MAX_DRY_HULLS hulls (as drawn this frame:
 * bob, pitch, roll, berth offset) and discards it inside the hull's plan at that height. Inside the hull you see the
 * floor and the crew; outside the waterline, the wake and the paddle strokes are unchanged. The hull does not heave
 * with the sea's swell or the surf, so the vertex stage also lays the wave displacement down round each hull (still
 * water within CALM[0] m of its waterline box, full waves again CALM[1] m out): a crest can neither come up through the
 * floor nor stand over the side tube and hide the men behind it. The surface normals keep the waves' shading.
 *
 * A plan, in the hull's frame (u forward, v to the side, z up from the design waterline, metres):
 *
 *   |u / a|^pu + |v / b|^pv ≤ 1,   a = aF (bow, u ≥ 0) or aA (stern),
 *   a, b grow with z (flared topsides): + z·(z < 0 ? lo : hi), z clamped to [z0, z1]
 *
 * fitted INSIDE the hull's outer skin at every height (a plan wider than the hull would open a dry hole in the water
 * beside it) and wide enough to take in its inner skin. The raft's plan is its buoyancy tube's centreline
 * (tools/blender/vehicles/naval/scripts/raft.py loop_path: x = b·cos^0.8, y = a·sin^0.35, i.e. pv = 2/0.8,
 * pu = 2/0.35; the bow 6 cm short of the raised tip, where the floor ends under the lifted tube: past it you would
 * see the bed through that gap), always under the tube whatever the water does. The rowboat
 * follows its hull lines (rowboat.py stations) from 10 cm below to 25 cm above the waterline, 1–2 cm inside the
 * skin; the decked patrol and fishing boats keep the section 8 cm down. The mini-sub runs awash and stays wet.
 * @module art/water/hulls
 */
import * as THREE from 'three';

/** Most hulls cut out of the water at once (nearest the view centre first). */
export const MAX_DRY_HULLS = 8;

/** Calm water round a hull: wave/surf displacement off within CALM[0] m of its waterline box, full beyond CALM[1] m. */
export const CALM = Object.freeze([0.3, 1.8]);

/** JS twin of the shader's dryCalm() for one hull (unit tests): 1 = still water at the hull, 0 = full waves. */
export function calmAt(d, x, y, z) {
  _p.set(x, y, z).applyMatrix4(d.inv);
  const P = d.plan, qx = Math.abs(_p.x) - P.b, qz = Math.abs(_p.z) - (_p.z >= 0 ? P.aF : P.aA);
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  const t = Math.max(0, Math.min(1, (sd - CALM[0]) / (CALM[1] - CALM[0])));
  return 1 - t * t * (3 - 2 * t);
}

/** Waterline plans by library type (model space, metres). */
export const HULL_PLANS = Object.freeze({
  raft: { aF: 1.1, aA: 1.16, b: 0.46, pu: 5.7, pv: 2.5 },
  rowboat: { aF: 1.74, aA: 1.74, b: 0.475, pu: 2, pv: 1, z0: -0.1, z1: 0.25, aLo: 1, aHi: 0.6, bLo: 1.4, bHi: 0.72 },
  patrolboat: { aF: 5.6, aA: 6.6, b: 1.3, pu: 2.5, pv: 1.5 },
  fishing_boat: { aF: 5.6, aA: 5.6, b: 1.75, pu: 2.2, pv: 1.5 },
});

/** Plan half-length / half-beam at height z (hull frame): [aF, aA, b]. */
export function planAt(P, z = 0) {
  const zc = Math.max(P.z0 ?? 0, Math.min(P.z1 ?? 0, z)), lo = zc < 0;
  const da = zc * ((lo ? P.aLo : P.aHi) ?? 0), db = zc * ((lo ? P.bLo : P.bHi) ?? 0);
  return [P.aF + da, P.aA + da, P.b + db];
}

/** Is (u, v, z) (hull frame) inside `plan`? JS twin of the shader's dryHull() (unit tests). */
export function inPlan(P, u, v, z = 0) {
  const [aF, aA, b] = planAt(P, z);
  return Math.abs(u / (u >= 0 ? aF : aA)) ** P.pu + Math.abs(v / b) ** P.pv <= 1;
}

const _p = new THREE.Vector3();

/**
 * Dry plan of a vehicle as drawn this frame, or null (not a boat, no plan for its model, model not loaded or hidden,
 * wrecked / deflated: a sinking or collapsed hull lets the water in).
 * @returns {{inv: THREE.Matrix4, plan: object, x: number, z: number}|null} world → hull frame, plan, centre (world XZ)
 */
export function dryHullOf(v, out = null) {
  if (!v || v.def?.kind !== 'boat' || v.destroyed || v.alive === false) return null;
  const m = v.model, plan = m?.library ? HULL_PLANS[m.libType] : null;
  const o = plan && m.isReady ? m.visual?.object3d : null;
  if (!o || !m.root?.visible) return null;
  o.updateWorldMatrix(true, false); // posed by renderUpdate this frame; the scene's world matrices update later
  const d = out || { inv: null, plan: null, x: 0, z: 0 };
  (d.inv ||= new THREE.Matrix4()).copy(o.matrixWorld).invert();
  d.plan = plan;
  _p.setFromMatrixPosition(o.matrixWorld); d.x = _p.x; d.z = _p.z;
  return d;
}

/** World point (x, y, z) inside a dryHullOf() result? (model space: +x left, +y up, +z bow) */
export function inDryHull(d, x, y, z) {
  _p.set(x, y, z).applyMatrix4(d.inv);
  return inPlan(d.plan, _p.z, _p.x, _p.y);
}

/** Bounding radius of a plan over its height range (m, hull frame). */
const reach = (P) => Math.max(...[P.z0 ?? 0, P.z1 ?? 0].map((z) => { const [aF, aA, b] = planAt(P, z); return Math.max(aF, aA, b); }));

/**
 * Pack up to MAX_DRY_HULLS plans (nearest (cx, cz) first) into the water's shared uniforms: dryM (world → hull frame),
 * dryA (aF, aA, b, bounding radius), dryB (pu, pv, z0, z1), dryC (aLo, aHi, bLo, bHi), dryN.
 */
export function packDryHulls(list, U, cx = 0, cz = 0) {
  const L = list.length > MAX_DRY_HULLS ? list.slice().sort((p, q) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(q.x - cx, q.z - cz)) : list;
  const n = Math.min(MAX_DRY_HULLS, L.length);
  for (let k = 0; k < n; k++) {
    const d = L[k], P = d.plan;
    U.dryM.value[k].copy(d.inv);
    U.dryA.value[k].set(P.aF, P.aA, P.b, P.reach ?? reach(P));
    U.dryB.value[k].set(P.pu, P.pv, P.z0 ?? 0, P.z1 ?? 0);
    U.dryC.value[k].set(P.aLo ?? 0, P.aHi ?? 0, P.bLo ?? 0, P.bHi ?? 0);
  }
  U.dryN.value = n;
  return n;
}

/** Shader uniforms (shared by every body's material). */
export function dryHullUniforms() {
  const arr = (f) => Array.from({ length: MAX_DRY_HULLS }, f);
  return { dryM: { value: arr(() => new THREE.Matrix4()) }, dryA: { value: arr(() => new THREE.Vector4()) },
    dryB: { value: arr(() => new THREE.Vector4()) }, dryC: { value: arr(() => new THREE.Vector4()) }, dryN: { value: 0 } };
}

/** GLSL: dryHull(world position) — true inside a cut-out hull plan (layout: packDryHulls). */
export const DRY_HULL_GLSL = /* glsl */`
uniform mat4 dryM[${MAX_DRY_HULLS}];
uniform vec4 dryA[${MAX_DRY_HULLS}], dryB[${MAX_DRY_HULLS}], dryC[${MAX_DRY_HULLS}];
uniform int dryN;
bool dryHull(vec3 wp){
  for (int i = 0; i < ${MAX_DRY_HULLS}; i++) {
    if (i >= dryN) break;
    vec3 p = (dryM[i]*vec4(wp, 1.0)).xyz;                 // hull frame: x side, y up, z bow
    if (dot(p.xz, p.xz) > dryA[i].w*dryA[i].w) continue;
    float z = clamp(p.y, dryB[i].z, dryB[i].w);
    vec2 g = z < 0.0 ? dryC[i].xz : dryC[i].yw;            // flare: (da/dz, db/dz) below / above the waterline
    float a = (p.z >= 0.0 ? dryA[i].x : dryA[i].y) + z*g.x, b = dryA[i].z + z*g.y;
    if (pow(abs(p.z)/a, dryB[i].x) + pow(abs(p.x)/b, dryB[i].y) <= 1.0) return true;
  }
  return false;
}
// calm water round a hull (vertex stage): 1 within ${CALM[0]} m of its waterline box, 0 beyond ${CALM[1]} m
float dryCalm(vec3 wp){
  float c = 0.0;
  for (int i = 0; i < ${MAX_DRY_HULLS}; i++) {
    if (i >= dryN) break;
    vec3 p = (dryM[i]*vec4(wp, 1.0)).xyz;
    vec2 q = abs(p.xz) - vec2(dryA[i].z, p.z >= 0.0 ? dryA[i].x : dryA[i].y);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    c = max(c, 1.0 - smoothstep(${CALM[0].toFixed(2)}, ${CALM[1].toFixed(2)}, sd));
  }
  return c;
}`;
