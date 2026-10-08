/**
 * A dead man lies on the ground as it is drawn (the user, 2026-10-08: "bodies of dead soldiers are still floating on
 * the ground"). View side only: runs on the drawn skeleton after the ragdoll pose (art/ragdoll-pose.js) or the death
 * clip, never feeds the sim.
 *
 * The pose a corpse is drawn in comes from the death clip's last frame (grounded on its root plane) turned by the
 * physics ragdoll's segments, which rest on the physics heightfield (1 m samples of world.groundY, physics/statics.js).
 * Three things left bodies in the air: the clip was grounded on its belt kit (bread bag, canteen: 15–20 cm under the
 * back of a man on his back, art/body-kit.js), the clip's head is propped 13–22 cm off the ground (neck bent forward),
 * and the heightfield is not the drawn ground (snow drifts, ripples, steps and plinths between its 1 m samples: up to
 * 10–45 cm off). Here the drawn body is laid on the drawn ground:
 *
 *  1. the trunk (pelvis, spine, collar bones; the kit left out) is moved up or down so its lowest point touches
 *     (a body in the air — thrown by a blast, on a crate — is left alone: the move fades out over 0.3–0.6 m), and
 *     tipped about that point onto a slope (a corpse drawn without a ragdoll; the ragdoll's body already lies on it);
 *  2. the back (about the waist), the head (about the neck, then about its own joint) and each arm and leg (about the
 *     shoulder / hip, then the elbow / knee) turn so their lowest point touches: down when it hangs in the air, up when
 *     it is in the ground; within limits, and a limb lying on the body is not pushed through it.
 *
 * The ground is the drawn surface right under each point: the grid's raised level + world.lyingY (the terrain relief,
 * decks, steps, snow skirts; world.groundY without the walkers' feet ring). The samples are the skinned vertices of the lightest body LOD that are the extremes of
 * each bone's vertices along 40 directions (its lowest point in any pose is one of them), the kit left out.
 * @module art/corpse-ground
 */
import { Vector3, Quaternion, Matrix4 } from 'three';
import { bodyKit } from './body-kit.js';

const DEG = Math.PI / 180;
/** m: a part this close to the ground is left as it is; solver steps per joint. */
const TOL = 0.006, STEPS = 5;
/** m: the trunk is moved fully up to AIR0 off the ground, not at all from AIR1 (thrown / lying on a crate). */
const AIR0 = 0.3, AIR1 = 0.6;
/** m: samples this close to the joint a part turns about are left to the trunk. */
const NEAR = 0.12;
/** m: largest trunk move (down / up). */
const DOWN_MAX = 0.6, UP_MAX = 0.6;
/** Directions the samples of each bone are the extremes along (a Fibonacci sphere). */
const DIRS = (() => {
  const n = 40, out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
})();
const DX = Float64Array.from(DIRS, (d) => d[0]), DY = Float64Array.from(DIRS, (d) => d[1]), DZ = Float64Array.from(DIRS, (d) => d[2]);
/** Sample groups by bone name. */
const GROUPS = {
  hips: /^(pelvis|spine_01)$/i, chest: /^(spine_0[2-9]|clavicle_[lr])$/i, neck: /^neck_\d+$/i, head: /^head$/i,
  armL: /^upperarm_l$/i, handL: /^(lowerarm_l|hand_l|(thumb|index|middle|ring|pinky)_\d+(_leaf)?_l)$/i,
  armR: /^upperarm_r$/i, handR: /^(lowerarm_r|hand_r|(thumb|index|middle|ring|pinky)_\d+(_leaf)?_r)$/i,
  thighL: /^thigh_l$/i, footL: /^(calf_l|foot_l|ball_l|ball_leaf_l)$/i,
  thighR: /^thigh_r$/i, footR: /^(calf_r|foot_r|ball_r|ball_leaf_r)$/i,
};
/**
 * The stages: the samples (body parts) a joint carries and its largest turn down onto the ground (`max`: a limb hanging
 * in the air) and up out of it (`up`: a limb of a body thrown by a blast lies in the ground where its ragdoll capsule
 * lies on it). Order: the whole body tipped, the back, the head, arms, legs; each chain from its root joint out.
 */
const STAGES = [
  // the whole body tipped about the trunk's contact point (a corpse drawn without a ragdoll on a slope)
  { pivot: 'pelvis', parts: ['hips', 'chest'], max: 20 * DEG, up: 20 * DEG, tilt: true },
  { pivot: 'spine_01', parts: ['chest'], max: 15 * DEG, up: 15 * DEG },
  { pivot: 'neck_01', parts: ['neck', 'head'], max: 40 * DEG, up: 40 * DEG },
  { pivot: 'Head', parts: ['head'], max: 25 * DEG, up: 30 * DEG },
  { pivot: 'upperarm_l', parts: ['armL', 'handL'], max: 35 * DEG, up: 75 * DEG, limb: true },
  { pivot: 'lowerarm_l', parts: ['handL'], max: 40 * DEG, up: 80 * DEG, limb: true },
  { pivot: 'upperarm_r', parts: ['armR', 'handR'], max: 35 * DEG, up: 75 * DEG, limb: true },
  { pivot: 'lowerarm_r', parts: ['handR'], max: 40 * DEG, up: 80 * DEG, limb: true },
  { pivot: 'thigh_l', parts: ['thighL', 'footL'], max: 25 * DEG, up: 50 * DEG, limb: true },
  { pivot: 'calf_l', parts: ['footL'], max: 30 * DEG, up: 60 * DEG, limb: true },
  { pivot: 'thigh_r', parts: ['thighR', 'footR'], max: 25 * DEG, up: 50 * DEG, limb: true },
  { pivot: 'calf_r', parts: ['footR'], max: 30 * DEG, up: 60 * DEG, limb: true },
];

const _m = new Matrix4(), _pre = new Matrix4(), _v = new Vector3(), _p = new Vector3(), _j = new Vector3();
const _d0 = new Vector3(), _d1 = new Vector3(), _q = new Quaternion(), _pq = new Quaternion(), _a = new Vector3(), _b = new Vector3();
const _qt = new Quaternion(), _qi = new Quaternion(), _ax = new Vector3(), _up = new Vector3(0, 1, 0), _b2 = new Vector3();

/** Lightest whole-body skinned LOD mesh of a real model (the merged helmet / cap is part of LOD1 / LOD2). */
function bodyMesh(model) {
  if (model._cgMesh !== undefined && model._cgMesh?.parent) return model._cgMesh;
  let mesh = null;
  model.real?.inner?.object?.traverse((o) => { if (o.isSkinnedMesh && /^LOD\d+$/.test(o.name) && (!mesh || o.geometry.attributes.position.count < mesh.geometry.attributes.position.count)) mesh = o; });
  model._cgMesh = mesh;
  return mesh;
}

/**
 * Sample sets of a mesh (cached on the kit record of its geometry): the body's (not the kit's) vertices that are the
 * extremes of each bone's vertices along DIRS — the lowest point of a part lying on the ground is one of them, whatever
 * its pose — as bind-space positions with their skin indices / weights.
 */
function samplesOf(mesh) {
  const kit = bodyKit(mesh);
  if (kit._cg) return kit._cg;
  const g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b?.name || ''), n = P.count;
  // extremes per bone (flat typed arrays: bone b, direction d at b * ND + d)
  const nb = names.length, ND = DIRS.length;
  const best = new Float64Array(nb * ND).fill(-Infinity), at = new Int32Array(nb * ND).fill(-1);
  for (let i = 0; i < n; i++) {
    if (kit.kit[i]) continue;
    const o = kit.dom[i] * ND, x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    for (let d = 0; d < ND; d++) {
      const v = x * DX[d] + y * DY[d] + z * DZ[d];
      if (v > best[o + d]) { best[o + d] = v; at[o + d] = i; }
    }
  }
  const keys = Object.keys(GROUPS), groupOf = names.map((nm) => keys.find((k) => GROUPS[k].test(nm)) || null);
  const lists = {};
  for (const k of keys) lists[k] = new Set();
  for (let b = 0; b < nb; b++) { const k = groupOf[b]; if (k) for (let d = 0; d < ND; d++) { const i = at[b * ND + d]; if (i >= 0) lists[k].add(i); } }
  const bm = mesh.bindMatrix;
  const pack = (idx) => {
    const pos = new Float32Array(idx.length * 3), si = new Uint16Array(idx.length * 4), sw = new Float32Array(idx.length * 4);
    idx.forEach((v, k) => {
      _v.fromBufferAttribute(P, v).applyMatrix4(bm);
      pos[k * 3] = _v.x; pos[k * 3 + 1] = _v.y; pos[k * 3 + 2] = _v.z;
      for (let c = 0; c < 4; c++) { si[k * 4 + c] = SI.getComponent(v, c); sw[k * 4 + c] = SW.getComponent(v, c); }
    });
    return { n: idx.length, pos, si, sw };
  };
  const cat = (ks) => { const a = new Set(); for (const k of ks) for (const i of lists[k]) a.add(i); return [...a].sort((p, q) => p - q); };
  const out = { trunk: pack(cat(['hips', 'chest'])), stages: STAGES.map((s) => pack(cat(s.parts))) };
  return (kit._cg = out);
}

/** Per-bone skinning matrices of the mesh now (world); only the bones in `only` (skeleton indices) when given. */
function skinMatrices(mesh, K, only = null) {
  const bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses, n = bones.length;
  if (!K || K.length !== n) { K = Array.from({ length: n }, () => new Matrix4()); only = null; }
  _pre.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  if (only) { for (const b of only) K[b].multiplyMatrices(_pre, bones[b] ? _m.multiplyMatrices(bones[b].matrixWorld, inv[b]) : _m.identity()); return K; }
  for (let b = 0; b < n; b++) K[b].multiplyMatrices(_pre, bones[b] ? _m.multiplyMatrices(bones[b].matrixWorld, inv[b]) : _m.identity());
  return K;
}

/** Skeleton indices of bone J and every bone under it (cached on the mesh per joint). */
function subtree(mesh, J) {
  const c = (mesh._cgSub ||= new Map());
  let r = c.get(J);
  if (!r) {
    const set = new Set(); J.traverse((o) => set.add(o));
    r = mesh.skeleton.bones.map((b, i) => (set.has(b) ? i : -1)).filter((i) => i >= 0);
    c.set(J, r);
  }
  return r;
}

/** World position of sample k of set S. */
function sampleAt(S, k, K, out) {
  const x = S.pos[k * 3], y = S.pos[k * 3 + 1], z = S.pos[k * 3 + 2];
  out.set(0, 0, 0);
  for (let c = 0; c < 4; c++) {
    const w = S.sw[k * 4 + c];
    if (!w) continue;
    const e = K[S.si[k * 4 + c]].elements;
    out.x += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
    out.y += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
    out.z += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
  }
  return out;
}

/**
 * Lowest sample of S over the ground: {gap, x, y, z} (gap = height over the ground; Infinity when empty). Samples
 * within NEAR m of `near` (a joint the part turns about: turning cannot move them, they are the trunk's) are skipped.
 */
function lowest(S, K, ground, out, near = null) {
  out.gap = Infinity;
  for (let k = 0; k < S.n; k++) {
    sampleAt(S, k, K, _v);
    if (near && _v.distanceToSquared(near) < NEAR * NEAR) continue;
    const gap = _v.y - ground(_v.x, _v.z);
    if (gap < out.gap) { out.gap = gap; out.x = _v.x; out.y = _v.y; out.z = _v.z; }
  }
  return out;
}

/** Mean world position of the samples of S. */
function centroid(S, K, out) {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < S.n; k++) { sampleAt(S, k, K, _v); x += _v.x; y += _v.y; z += _v.z; }
  return out.set(x / S.n, y / S.n, z / S.n);
}

/** Horizontal distance from p to the segment a–b. */
function hDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz;
  const t = L > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/**
 * The surface under a dead unit's body parts: the grid's raised level + world.lyingY (the drawn ground right under the
 * point: terrain relief, decks, steps, snow skirts — world/map-builder.js), else world.groundY (whose feet ring steps a
 * walker up onto a kerb or a crate top up to 0.36 m away).
 * @returns {((x:number, z:number) => number)|null}
 */
export function corpseGround(unit) {
  const w = unit?.world;
  const y = typeof w?.lyingY === 'function' ? w.lyingY : typeof w?.groundY === 'function' ? w.groundY : null;
  if (!y) return null;
  const g = w.grid;
  return (x, z) => (g?.elevAt ? g.elevAt(x, z) || 0 : 0) + (y.call(w, x, z) || 0);
}

/** m: node spacing of the ground lattice a body's samples read (bilinear); nodes per side of its window. */
const CELL = 0.04, SIDE = 112;
/**
 * The ground under one body, read through a lattice of `ground` (a 4.5 m window round the body) filled as the samples
 * touch it: a body lying still reads it once, a settling one only where it moves to. Kept on the model while the same
 * ground function is passed; re-centred when the body leaves the window.
 */
function groundLattice(model, ground, cx, cz) {
  let L = model._cgLat;
  const fresh = (x, z) => {
    L = model._cgLat = { fn: ground, i0: Math.floor(x / CELL) - SIDE / 2, j0: Math.floor(z / CELL) - SIDE / 2, h: L?.h || new Float32Array(SIDE * SIDE) };
    L.h.fill(NaN);
  };
  if (!L || L.fn !== ground) fresh(cx, cz);
  const node = (i, j) => {
    let a = i - L.i0, b = j - L.j0;
    if (a < 0 || b < 0 || a >= SIDE || b >= SIDE) { fresh(i * CELL, j * CELL); a = i - L.i0; b = j - L.j0; }
    const k = b * SIDE + a;
    let v = L.h[k];
    if (v !== v) v = L.h[k] = ground(i * CELL, j * CELL);
    return v;
  };
  return (x, z) => {
    const fx = x / CELL, fz = z / CELL, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = node(i, j), b = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

/**
 * Classify the kit and pick the samples of a body's mesh now (cached on its geometry: once per template), so the
 * first death of a template in a mission does not pay for it (5–20 ms). UnitModel warm-up calls it at load.
 */
export function warmCorpse(model) {
  const mesh = bodyMesh(model);
  if (mesh) samplesOf(mesh);
  return !!mesh;
}

/** Bones the pass may write: the pelvis (moved) and the joints it turns. */
export const CORPSE_BONES = ['pelvis', ...new Set(STAGES.map((s) => s.pivot))];

/**
 * Lay the drawn body of a dead man on the ground (see the module doc). Call after the pose is on the skeleton and the
 * root's world matrix is current.
 * @param {object} model UnitModel (real)
 * @param {(x:number, z:number) => number} ground surface height
 * @param {{before?:Function, after?:Function}|null} writer guard around each bone write (StickyGuard / BoneGuard)
 * @param {Array|null} [log] diagnostics: per stage [pivot, gap before, gap after, angle]
 * @returns {{moved:boolean, shift:number, turns:number}|null}
 */
export function restOnGround(model, ground, writer = null, log = null) {
  const B = model?.real?.inner?.bones, mesh = bodyMesh(model);
  if (!B || !mesh || !ground || !B.pelvis) return null;
  const S = samplesOf(mesh), pv = B.pelvis.getWorldPosition(new Vector3()), G = groundLattice(model, ground, pv.x, pv.z);
  const root = model.root;
  root.updateMatrixWorld(true);
  let K = model._cgK = skinMatrices(mesh, model._cgK);
  const lo = { gap: Infinity, x: 0, y: 0, z: 0 };
  // 1. the trunk on the ground
  lowest(S.trunk, K, G, lo);
  let shift = 0, turns = 0, air = 1;
  if (Number.isFinite(lo.gap) && Math.abs(lo.gap) > TOL) {
    const m = lo.gap;
    air = m <= AIR0 ? 1 : Math.max(0, 1 - (m - AIR0) / (AIR1 - AIR0));
    shift = Math.max(-DOWN_MAX, Math.min(UP_MAX, -m)) * air;
    if (Math.abs(shift) > 1e-4) {
      const pel = B.pelvis;
      writer?.before(pel);
      pel.getWorldPosition(_p); _p.y += shift;
      pel.parent.worldToLocal(_p); pel.position.copy(_p);
      writer?.after(pel);
      pel.updateMatrixWorld(true);
      K = skinMatrices(mesh, K);
    }
  }
  log?.push(['trunk', +lo.gap.toFixed(4), +shift.toFixed(4)]);
  if (air <= 0) return { moved: false, shift: 0, turns: 0 }; // up in the air (thrown by a blast, on a crate): as it is
  // the trunk's axis (a limb lying across the body is not pushed down through it)
  const neck = B.neck_01 || B.spine_03;
  B.pelvis.getWorldPosition(_a); (neck || B.pelvis).getWorldPosition(_b);
  // 2. the back, head, arms, legs: each joint turned about a level axis — across the part's line from the joint, so the
  // whole part tips down onto the ground or up out of it — until its lowest point touches (or the joint's limit)
  const stage = (st, i) => {
    const J = B[st.pivot], set = S.stages[i];
    if (!J || !set.n) return;
    // the turn's centre: the joint, or (tilt) the trunk's lowest point
    const jp = st.tilt ? (lowest(set, K, G, lo), new Vector3(lo.x, lo.y, lo.z)) : J.getWorldPosition(new Vector3());
    lowest(set, K, G, lo, jp);
    const m0 = lo.gap;
    if (!Number.isFinite(m0) || Math.abs(m0) <= TOL || (st.tilt && m0 < 0) || (m0 > 0 && air <= 0)) return;
    _p.set(lo.x, lo.y, lo.z);
    // over the trunk (a hand on the chest, an arm under a man on his face): left as it lies
    if (st.limb && hDist(_p, _a, _b) < 0.16 && _p.y > Math.min(_a.y, _b.y) - 0.05) { log?.push([st.pivot, +m0.toFixed(4), 'over the trunk']); return; }
    _j.copy(jp);
    centroid(set, K, _d0).sub(_j);
    if (Math.hypot(_d0.x, _d0.z) < 0.02) _d0.subVectors(_p, _j);
    if (Math.hypot(_d0.x, _d0.z) < 0.02) return;
    _ax.crossVectors(_d0, _up).normalize();
    _d1.crossVectors(_ax, _d0);
    if ((_d1.y < 0) !== (m0 > 0)) _ax.negate();
    writer?.before(J);
    const sub = subtree(mesh, J);
    const q0 = J.quaternion.clone(), p0 = J.getWorldPosition(new Vector3());
    J.parent.getWorldQuaternion(_pq);
    const pqi = _pq.clone().invert();
    const at = (th) => {
      _qt.setFromAxisAngle(_ax, th);
      J.quaternion.copy(pqi).multiply(_qt).multiply(_pq).multiply(q0);
      if (st.tilt) J.position.copy(J.parent.worldToLocal(_b2.copy(p0).sub(jp).applyQuaternion(_qt).add(jp)));
      J.updateMatrixWorld(true);
      K = skinMatrices(mesh, K, sub);
      return lowest(set, K, G, lo, jp).gap;
    };
    // turn to the limit: still short of the ground there, the limit; else the touching angle by false position
    // (Illinois) between no turn (gap m0) and the limit
    const lim = m0 > 0 ? st.max : st.up;
    let a = 0, fa = m0, b = lim, fb = at(lim), th = lim;
    if ((fb > 0) !== (m0 > 0) || Math.abs(fb) <= TOL) {
      let side = 0, c = b, fc = fb;
      for (let k = 0; k < STEPS && Math.abs(fc) > TOL / 2; k++) {
        c = (a * fb - b * fa) / (fb - fa); fc = at(c);
        if ((fc > 0) === (fb > 0)) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1; }
        else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
      }
      th = Math.abs(fc) <= TOL ? c : b; // (else the side where it touches)
    }
    if (m0 > 0) th *= air; // a body up in the air: its parts are not pulled down to the ground below
    const m1 = at(th);
    writer?.after(J);
    turns++;
    log?.push([st.pivot, +m0.toFixed(4), +m1.toFixed(4), +(th / DEG).toFixed(1)]);
  };
  // twice: a limb deep in the ground (a body thrown by a blast) or a joint at its limit goes on from the turned pose (the
  // same work live and baked: the pose does not change at the bake; a converged joint costs one look at its samples)
  STAGES.forEach(stage);
  STAGES.forEach(stage);
  root.updateMatrixWorld(true);
  return { moved: Math.abs(shift) > 1e-4 || turns > 0, shift, turns };
}
