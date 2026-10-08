/**
 * Ragdoll builder and settle logic (bodies-design §A.4). Sim side only: it knows nothing about the skinned model.
 * A ragdoll is spawned either STANDING (blast: the template is the idle pose at the unit) or LYING ('settle' after a
 * death clip: supine for the standing 'die' clip, prone for 'die_prone'). The pose a model draws is always
 * `bodyRot · spawnRot⁻¹ · (base pose)`, so the published pose record carries both (see `poseRecord`).
 * @module physics/ragdoll
 */

import { CONFIG } from '../config.js';
import { PARTS, NPARTS, TEMPLATE_MASS } from './ragdoll-template.js';
import { G, GROUPS, groundAt, fieldAt } from './statics.js';
import { qAxis, qHeading, qMul, qRot, v3, vAdd, vSub, r4 } from './qmath.js';

/** Where a lying spawn puts the pelvis relative to the unit (m along its forward axis) and its rotation. */
const LIE = { supine: { fwd: -0.55, rx: -Math.PI / 2 }, prone: { fwd: 0.1, rx: Math.PI / 2 } };   // measured on the UAL 'die' clip end

/**
 * The surface a lying body rests on at (x, z): world.lyingY (the drawn ground right under the point, world/map-builder.js)
 * when the map has one, else world.groundY (whose feet ring reaches up onto a kerb or a crate top 0.36 m away). The
 * heightfield is built from it (physics/statics.js) and the drawn pose is the base pose at the anchor moved as the
 * pelvis body moved since the spawn, so anchor, spawn and heightfield must all use it: a spawn lifted off a surface
 * the body then fell from was drawn that much into the ground.
 */
export function lyingAt(world, x, z) {
  return typeof world.lyingY === 'function' ? world.lyingY(x, z) || 0 : groundAt(world, x, z);
}

/** Lowest world y of collider spec `c` on a body at p with rotation q. */
function lowestY(p, q, c) {
  if (c.shape === 'ball') return qRot(q, v3(...(c.off || [0, 0, 0]))).y + p.y - c.r;
  if (c.shape === 'cap') {
    const a = qRot(q, v3(0, -c.r, 0)).y, b = qRot(q, v3(0, c.r - c.len, 0)).y;   // segment ends (the caps add r)
    return p.y + Math.min(a, b) - c.r;
  }
  const o = qRot(q, v3(...(c.off || [0, 0, 0])));
  const ex = Math.abs(qRot(q, v3(c.h[0], 0, 0)).y) + Math.abs(qRot(q, v3(0, c.h[1], 0)).y) + Math.abs(qRot(q, v3(0, 0, c.h[2])).y);
  return p.y + o.y - ex;
}

/**
 * Part origins of the lying template (a settle spawn) for a man at (x, z) on ground level `y` (m over the terrain)
 * with heading h: the template turned about the pelvis joint and laid down supine (or prone), lifted so that every
 * collider clears the ground under it (slopes: one end starts higher and the body slides).
 * @returns {{pos: {x:number,y:number,z:number}[], rot: {x:number,y:number,z:number,w:number}}}
 */
export function lyingParts(world, x, z, y, h, prone = false, lifted = true) {
  const lie = prone ? LIE.prone : LIE.supine, qs = qMul(qHeading(h), qAxis(1, 0, 0, lie.rx));
  const gy = lyingAt(world, x, z) + y, pelvisAt = v3(...PARTS[0].at);
  const origin = v3(x + Math.cos(h) * lie.fwd, gy, z + Math.sin(h) * lie.fwd);
  const pos = PARTS.map((p) => vAdd(origin, qRot(qs, vSub(v3(...p.at), pelvisAt))));
  if (lifted) {
    // clear of the drawn ground under the part (world.lyingY: no walkers' feet ring) and of the TERRAIN heightfield as
    // built (by a step or a plinth the heightfield ramps over the ground beside it: a part started under it fell
    // through, the legs hanging 0.6 m into the ground), under every collider's ends (a part's origin is at its joint,
    // its collider runs ~0.45 m from it)
    const field = world.physics?.statics?.field;
    const under = (px, pz) => Math.max(lyingAt(world, px, pz), field ? fieldAt(field, px, pz) : -Infinity);
    let lift = -Infinity;
    PARTS.forEach((p, i) => {
      for (const c of p.col) {
        let g = under(pos[i].x, pos[i].z);
        if (field) {
          const o = qRot(qs, c.shape === 'cap' ? v3(0, -c.len, 0) : v3(...(c.off || [0, 0, 0])));
          g = Math.max(g, under(pos[i].x + o.x, pos[i].z + o.z), under(pos[i].x + o.x / 2, pos[i].z + o.z / 2));
        }
        lift = Math.max(lift, g + y - lowestY(pos[i], qs, c) + 0.01);
      }
    });
    for (const q of pos) q.y += lift;
  }
  return { pos, rot: qs };
}

/** Collision filter of the lying-room query: what a settling body is pushed out of (the terrain is the lift's job). */
const ROOM_GROUPS = (((0xffff) << 16) | (G.STATIC | G.PROP | G.VEHICLE)) >>> 0;
/** Lying-room query raised this much: a deck or floor collider's top (quantised to 0.1 m) is never "in" the body. */
const ROOM_RAISE = 0.06;

/**
 * Would a man lying at (x, z) (heading h, ground level y, supine or prone) start inside a STATIC, PROP or VEHICLE
 * collider? The settle ragdoll spawns in exactly this pose: a part inside a rock's nav-footprint cuboid, a crate
 * stack's box or a hull is shoved out by the solver, so the corpse slides, or thrashes until the 6 s timeout.
 * @returns {boolean}
 */
export function lyingBlocked(R, rw, world, x, z, y, h, prone = false) {
  const { pos, rot } = lyingParts(world, x, z, y, h, prone);
  for (let i = 0; i < PARTS.length; i++) {
    for (const c of PARTS[i].col) {
      const off = c.shape === 'cap' ? v3(0, -c.len / 2, 0) : v3(...(c.off || [0, 0, 0]));
      const at = vAdd(pos[i], qRot(rot, off));
      at.y += ROOM_RAISE;
      const shape = c.shape === 'ball' ? new R.Ball(c.r) : c.shape === 'cap' ? new R.Capsule(Math.max(0.01, c.len / 2 - c.r), c.r) : new R.Cuboid(...c.h);
      if (rw.intersectionWithShape(at, rot, shape, undefined, ROOM_GROUPS)) return true;
    }
  }
  return false;
}

/**
 * Spawn a ragdoll for `unit`.
 * @param {object} R RAPIER namespace @param {object} rw Rapier world @param {object} world game World
 * @param {object} unit @param {'blast'|'settle'} mode @param {{prone?: boolean}} [o]
 */
export function spawnRagdoll(R, rw, world, unit, mode, o = {}) {
  const C = CONFIG.physics.ragdoll;
  const h = unit.heading || 0, qa = qHeading(h);
  const gy = lyingAt(world, unit.x, unit.z) + (unit.y || 0);
  const anchor = { x: unit.x, y: gy, z: unit.z, h };
  const lie = mode === 'settle' ? (o.prone ? LIE.prone : LIE.supine) : null;
  let qs = qa, pos;
  if (lie) {
    ({ pos, rot: qs } = lyingParts(world, unit.x, unit.z, unit.y || 0, h, !!o.prone, !o.shoulder));
    if (!o.shoulder && o.lift) for (const q of pos) q.y += o.lift; // o.lift: dropped from a carrier's shoulder (§C.4)
  } else pos = PARTS.map((p) => vAdd(v3(unit.x, gy, unit.z), qRot(qa, v3(...p.at)))); // standing: template at the feet
  // a settled corpse thrown again restarts from its baked pose (and keeps its spawn record for the model)
  const f = o.from, fn = f?.n || [0, 0];
  // bodies-design §C.4: knocked off a carrier's shoulder: he starts DRAPED over it, as the model drew him
  const drape = o.shoulder && !f ? drapeParts(unit.x, gy, unit.z, h) : null;
  if (drape) drape.pos.forEach((q, i) => { pos[i] = q; });
  const rot = PARTS.map((_, i) => (f ? { x: f.b[i * 7 + 3], y: f.b[i * 7 + 4], z: f.b[i * 7 + 5], w: f.b[i * 7 + 6] } : drape ? drape.rot[i] : qs));
  if (f) PARTS.forEach((_, i) => { pos[i] = v3(f.b[i * 7] + fn[0], f.b[i * 7 + 1] + 0.02, f.b[i * 7 + 2] + fn[1]); });
  const massK = C.mass / TEMPLATE_MASS;
  const fast = o.fast ?? mode === 'blast'; // thrown by a blast: CCD + collides with standing men
  const bodies = PARTS.map((p, i) => {
    const b = rw.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos[i].x, pos[i].y, pos[i].z)
      .setRotation(rot[i]).setLinearDamping(C.linDamp).setAngularDamping(C.angDamp).setCanSleep(true)
      .setAdditionalSolverIterations(2)   // 11 limited joints + ground contacts: 4 world iterations chatter
      .setCcdEnabled(fast));              // a blast throw (≤ 11 m/s = 0.18 m per step): no tunnelling through a fence or plank
    const per = (p.mass * massK) / p.col.length;
    for (const c of p.col) {
      let d;
      if (c.shape === 'ball') d = R.ColliderDesc.ball(c.r).setTranslation(...(c.off || [0, 0, 0]));
      else if (c.shape === 'cap') d = R.ColliderDesc.capsule(Math.max(0.01, c.len / 2 - c.r), c.r).setTranslation(0, -c.len / 2, 0);
      else d = R.ColliderDesc.cuboid(...c.h).setTranslation(...(c.off || [0, 0, 0]));
      rw.createCollider(d.setMass(per).setFriction(C.friction).setRestitution(0.05).setCollisionGroups(fast ? GROUPS.RAGDOLL : GROUPS.RAGDOLL_SETTLE), b);
    }
    if (o.vel) b.setLinvel(o.vel, true);
    return b;
  });
  const joints = [];
  PARTS.forEach((p, i) => {
    if (p.parent < 0) return;
    const pa = v3(...PARTS[p.parent].at), me = v3(...p.at);
    const a1 = vSub(me, pa);
    const j = rw.createImpulseJoint(R.JointData.spherical(a1, v3(0, 0, 0)), bodies[p.parent], bodies[i], true);
    const raw = rw.impulseJoints.raw;
    const axes = [R.JointAxis.AngX, R.JointAxis.AngY, R.JointAxis.AngZ];
    axes.forEach((ax, k) => raw.jointSetLimits(j.handle, ax, p.limits[k][0], p.limits[k][1]));
    joints.push(j);
  });
  const spawnQ = new Float64Array(NPARTS * 4);
  if (f) spawnQ.set(f.s);
  else for (let i = 0; i < NPARTS; i++) { const q = drape ? drape.rot[i] : qs; spawnQ.set([q.x, q.y, q.z, q.w], i * 4); }
  const anc = f ? { x: f.a[0] + fn[0], y: f.a[1], z: f.a[2] + fn[1], h: f.a[3] } : anchor;
  const p0 = f ? v3(f.p0[0] + fn[0], f.p0[1], f.p0[2] + fn[1]) : { ...pos[0] };
  return {
    unit, mode: f ? f.mode : mode, bodies, joints, anchor: anc, spawnQ, spawnPelvis: p0,
    pose: new Float64Array(NPARTS * 7), t: 0, still: 0, done: false, prone: f ? !!f.prone : !!o.prone, drape: f ? !!f.d : !!drape,
  };
}

/** Part pitches (degrees about the load's left axis) of a man draped over a right shoulder, within the joint limits. */
const DRAPE = [110, 150, 165, 55, 55, 55, 55, 25, 35, 25, 35];
/** Pelvis height above the carrier's feet on the shoulder (m). */
export const DRAPE_Y = 1.42;

/**
 * Part transforms of a man draped over the shoulder of a carrier standing at (x, gy, z) with heading h: his pelvis on
 * the shoulder, torso and head down the carrier's back, legs hanging in front (he faces backwards, heading h + π).
 */
export function drapeParts(x, gy, z, h) {
  const qb = qHeading(h + Math.PI), D = Math.PI / 180;
  const rot = DRAPE.map((a) => qMul(qb, qAxis(1, 0, 0, a * D)));
  const pos = [v3(x, gy + DRAPE_Y, z)];
  for (let i = 1; i < PARTS.length; i++) {
    const p = PARTS[i], pa = PARTS[p.parent];
    pos[i] = vAdd(pos[p.parent], qRot(rot[p.parent], vSub(v3(...p.at), v3(...pa.at))));
  }
  return { pos, rot };
}

/** Copy the live body transforms into rd.pose ([px,py,pz,qx,qy,qz,qw] × 11). */
export function readPose(rd) {
  for (let i = 0; i < NPARTS; i++) {
    const b = rd.bodies[i], t = b.translation(), q = b.rotation();
    rd.pose.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w], i * 7);
  }
  return rd.pose;
}

/** Advance the settle test by dt; true once every body stayed still for settleHold s (or the timeout hit). */
export function updateSettle(rd, dt) {
  const C = CONFIG.physics.ragdoll;
  rd.t += dt;
  // measured motion (pose change over the step), not the solver velocities: a body jammed against a wall or draped
  // over a fence can keep a velocity the contacts cancel every step while it does not move at all
  const P = rd.pose, Q = (rd.prevPose ||= Float64Array.from(P));
  const speed = (i) => Math.hypot(P[i * 7] - Q[i * 7], P[i * 7 + 1] - Q[i * 7 + 1], P[i * 7 + 2] - Q[i * 7 + 2]) / dt;
  const spin = (i) => {
    const o = i * 7 + 3, d = Math.abs(P[o] * Q[o] + P[o + 1] * Q[o + 1] + P[o + 2] * Q[o + 2] + P[o + 3] * Q[o + 3]);
    return (2 * Math.acos(Math.min(1, d))) / dt;
  };
  let still = true;
  for (let i = 0; i < rd.bodies.length && still; i++) {
    // thin limbs (arms, shins) may roll a little about their long axis on contact: 3× the spin allowance
    if (speed(i) >= C.settleV || spin(i) >= (i >= 3 ? C.settleW * 3 : C.settleW)) still = false;
  }
  // torso at rest and limbs calmed for a second: a limb still chattering against a joint limit is baked as it lies
  if (!still && rd.calm && rd.t - (rd.calmAt ?? rd.t) > 1.0) still = [0, 1, 2, 7, 9].every((i) => speed(i) < C.settleV);
  rd.still = still ? rd.still + dt : 0;
  // the torso has come to rest: damp the limbs hard so contact/limit chatter on the heightfield dies out
  if (!rd.calm && rd.t > 0.6) {
    const core = [0, 1].every((i) => speed(i) < C.settleV * 2);
    rd.calmT = core ? (rd.calmT || 0) + dt : 0;
    if (rd.calmT >= 0.25) { rd.calm = true; rd.calmAt = rd.t; for (const b of rd.bodies) { b.setAngularDamping(8); b.setLinearDamping(2); } }
  }
  Q.set(P);
  return rd.still >= C.settleHold || rd.t >= C.timeout;
}

/** Remove the ragdoll's joints and bodies from the Rapier world. */
export function removeRagdoll(rw, rd) {
  for (const j of rd.joints) rw.removeImpulseJoint(j, true);
  for (const b of rd.bodies) rw.removeRigidBody(b);
  rd.bodies = []; rd.joints = [];
}

/**
 * The pose record a model draws and the save stores (rounded: deterministic and compact).
 * @returns {{mode:string, prone:boolean, a:number[], s:number[], b:number[]}}
 */
export function poseRecord(rd, pose = rd.pose) {
  const a = rd.anchor;
  return { mode: rd.mode, prone: rd.prone, a: [a.x, a.y, a.z, a.h].map(r4), s: Array.from(rd.spawnQ, r4),
    p0: [rd.spawnPelvis.x, rd.spawnPelvis.y, rd.spawnPelvis.z].map(r4), b: Array.from(pose, r4), t0: r4(rd.t0 ?? 0), ...(rd.drape ? { d: 1 } : null) };
}

/** The live pose record a model draws while the ragdoll simulates (same shape as poseRecord, arrays by reference). */
export function liveView(rd) {
  if (!rd.view) {
    const a = rd.anchor, p = rd.spawnPelvis;
    // a, s, p0 rounded exactly as poseRecord rounds them: the model keys its base pose on them, and a key that changed
    // at the bake re-captured the base from the skeleton as last drawn (the settle rotation applied twice: the body
    // popped 0.2–0.8 m on the frame it settled, and the baked pose hovered or sank)
    rd.view = { mode: rd.mode, prone: rd.prone, a: [a.x, a.y, a.z, a.h].map(r4), s: Array.from(rd.spawnQ, r4), p0: [p.x, p.y, p.z].map(r4),
      b: rd.pose, t0: rd.t0 ?? null, live: true, g: rd.glide ? [rd.glide.x, rd.glide.z] : null, tg: rd.glide?.t ?? null, ...(rd.drape ? { d: 1 } : null) };
  }
  return rd.view;
}
