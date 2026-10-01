/**
 * Loose props (bodies-design §A.6): catalogue structures (crate stacks, cable drums, anything flagged `phys`) are
 * fixed bodies until a blast's Δv exceeds their wake threshold; then they turn dynamic, tumble, settle, go fixed again
 * and re-stamp their footprint on the NavGrid only where it cannot trap anyone (never on a unit, a door approach, a
 * link end or a bridge deck; nudged up to 1 m, else nav-neutral). The visual transform is `item.pose` (render syncs).
 * @module physics/props
 */

import { CONFIG } from '../config.js';
import { B } from '../world/grid.js';
import { GROUPS, groundAt } from './statics.js';
import { blastImpulse, occlusion } from './blast.js';
import { qAxis, r4 } from './qmath.js';

const DENSITY = 70;  // kg/m³ of a crate stack's bounding box (stacked wooden boxes with air between, mostly empty) [rec]

/** Catalogue: structure def → physics spec {shape, w, d, h, mass, block} or null (static). */
export function propSpec(def, type) {
  if (!def || def.explosive || def.carriable || def.destructible) return null;
  const v = String(def.variant ?? '');
  const phys = def.phys || (type === 'crates' && !/debris|timber|plank/.test(v) ? {} : null);
  if (!phys) return null;
  const w = def.w ?? 2, d = def.d ?? 2, h = def.h ?? 1.1;
  if (w > 3.2 || d > 3.2 || h > 2) return null;
  const drum = /drum/.test(v);
  return { shape: phys.shape || (drum ? 'cyl' : 'box'), w, d, h, mass: phys.mass ?? Math.round(w * d * h * DENSITY * (drum ? 1.6 : 1)) };
}

export class PropSystem {
  constructor(pw) {
    this.pw = pw;
    const w = pw.world, R = pw.R, rw = pw.rw;
    /** @type {object[]} every loose prop (owner order) */
    this.items = [];
    /** @type {object[]} awake (dynamic) props */
    this.active = [];
    const list = [...(w.structures?.values?.() || [])].sort((a, b) => a.owner - b.owner);
    for (const s of list) {
      const sp = propSpec(s.def, s.type);
      if (!sp || s.def.x == null) continue;
      const x = s.def.x, z = s.def.z, rot = s.def.rot ?? 0;
      const y = groundAt(w, x, z) + sp.h / 2;
      const q = qAxis(0, 1, 0, -rot);
      const body = rw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(q).setCanSleep(true));
      const cd = sp.shape === 'cyl'
        ? R.ColliderDesc.roundCylinder(sp.w / 2 - 0.05, Math.min(sp.w, sp.d) / 2 - 0.05, 0.05).setRotation(qAxis(1, 0, 0, Math.PI / 2))
        : R.ColliderDesc.cuboid(sp.w / 2, sp.h / 2, sp.d / 2);
      rw.createCollider(cd.setMass(sp.mass).setFriction(0.7).setRestitution(0.1).setCollisionGroups(GROUPS.PROP), body);
      const block = s.footprints?.find((f) => f.block)?.block ?? B.NONE;
      this.items.push({ key: s.def.id ?? `prop#${s.owner}`, owner: s.owner, type: s.type, spec: sp, body, block, obj: s.object3d,
        pose0: [x, y, z, q.x, q.y, q.z, q.w], pose: [x, y, z, q.x, q.y, q.z, q.w], t: 0, still: 0, moved: false, stamp: null });
    }
    this.owners = new Set(this.items.map((i) => i.owner));
  }

  /** Blast `bp` (blastParams): wake every prop whose Δv reaches its threshold, biggest impulse first, cap-limited. */
  blast(bp) {
    const P = CONFIG.physics, w = this.pw.world, cand = [];
    for (const it of this.items) {
      const p = it.body.translation();
      if (Math.hypot(p.x - bp.x, p.z - bp.z) > bp.Rb) continue;
      const occ = occlusion(this.pw.rw, this.pw.R, w, bp, p.x, p.z);
      const imp = blastImpulse(bp, p.x, p.y, p.z, it.spec.w * it.spec.h, it.spec.mass, P.blast.maxDvProp, occ, it.owner);
      if (imp.dv >= P.props.wake) cand.push({ it, imp });
    }
    cand.sort((a, b) => b.imp.J - a.imp.J || a.it.owner - b.it.owner);
    for (const { it, imp } of cand) {
      if (!this.active.includes(it) && this.active.length >= this.pw.caps.props) continue;
      this.wake(it);
      const b = it.body, v = b.linvel();
      b.setLinvel({ x: v.x + imp.dir.x * imp.dv, y: v.y + imp.dir.y * imp.dv, z: v.z + imp.dir.z * imp.dv }, true);
      // the front hits the upper face harder than the grounded foot: a stack tips over and tumbles (≤ 8 rad/s)
      const wk = Math.min(8, imp.dv * 1.1 * (0.6 + 0.4 * Math.min(1.5, it.spec.h / Math.max(0.3, Math.min(it.spec.w, it.spec.d)))));
      b.setAngvel({ x: imp.dir.z * wk, y: (it.owner % 2 ? 1 : -1) * imp.dv * 0.2, z: -imp.dir.x * wk }, true);
    }
  }

  /** Dormant → dynamic: its footprint leaves the grid (re-stamped at settle). */
  wake(it) {
    if (this.active.includes(it)) return;
    it.body.setBodyType(this.pw.R.RigidBodyType.Dynamic, true);
    it.body.enableCcd?.(true); // thrown at up to 16 m/s: no tunnelling through a thin wall
    // lift off the resting contact first: a fixed body switched to dynamic while touching the heightfield keeps a
    // stale contact that eats the blast velocity (Rapier 0.21)
    const t = it.body.translation();
    it.body.setTranslation({ x: t.x, y: t.y + 0.02, z: t.z }, true);
    it.t = 0; it.still = 0; it.moved = true;
    const g = this.pw.world.grid;
    // 1998 rules (physicsGameplay off): the prop is drawn tumbling, its nav / LOS footprint stays as it was
    if (this.pw.world.house?.physicsGameplay !== false && (it.stamp || it.block)) { g.clearOwner(it.owner); it.stamp = null; }
    this.active.push(it);
    this.active.sort((a, b) => a.owner - b.owner);
  }

  preStep() {}

  postStep(dt) {
    const C = CONFIG.physics.ragdoll;
    for (const it of [...this.active]) {
      const b = it.body, t = b.translation(), q = b.rotation();
      it.pose = [t.x, t.y, t.z, q.x, q.y, q.z, q.w].map(r4);
      it.t += dt;
      const v = b.linvel(), w = b.angvel();
      const still = b.isSleeping() || (Math.hypot(v.x, v.y, v.z) < C.settleV * 2 && Math.hypot(w.x, w.y, w.z) < C.settleW);
      it.still = still ? it.still + dt : 0;
      if (it.still >= C.settleHold || it.t >= C.timeout) this.settle(it);
    }
  }

  /** Dynamic → fixed at its resting transform; re-stamp the nav footprint where allowed. */
  settle(it) {
    const b = it.body;
    b.setLinvel({ x: 0, y: 0, z: 0 }, false); b.setAngvel({ x: 0, y: 0, z: 0 }, false);
    b.setBodyType(this.pw.R.RigidBodyType.Fixed, false);
    const t = b.translation(), q = b.rotation();
    it.pose = [t.x, t.y, t.z, q.x, q.y, q.z, q.w].map(r4);
    this.active.splice(this.active.indexOf(it), 1);
    if (this.pw.world.house?.physicsGameplay !== false) it.stamp = restampProp(this.pw.world, it);
    this.pw.world.events.emit('prop:settled', { ent: it, key: it.key, x: t.x, z: t.z });
  }

  serialize() {
    return this.items.filter((i) => i.moved).map((i) => ({ key: i.key, owner: i.owner, pose: i.pose, stamp: i.stamp, active: this.active.includes(i) }));
  }

  dispose() { this.items = []; this.active = []; }
}

/** Footprint height classes that touch navigation (props under navMinH tall or navMinMass kg never do). */
function navClass(it) {
  const P = CONFIG.physics.props, sp = it.spec;
  if (!it.block || sp.mass < P.navMinMass) return B.NONE;
  // the height it stands now: the vertical extent of the rotated box
  const q = it.pose.slice(3), up = Math.abs(1 - 2 * (q[0] * q[0] + q[2] * q[2]));
  const hNow = Math.max(sp.h * up, Math.min(sp.w, sp.d) * (1 - up));
  return hNow < P.navMinH ? B.NONE : it.block;
}

/** Cells a footprint at (x, z, yaw) would cover; null when any is refused. */
function footprintCells(w, it, x, z, yaw) {
  const g = w.grid, c = g.cell, sp = it.spec, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const hw = sp.w / 2, hd = sp.d / 2, ext = Math.abs(hw * cos) + Math.abs(hd * sin), extZ = Math.abs(hw * sin) + Math.abs(hd * cos);
  const cells = [];
  const doors = w.interactables.filter((e) => e.interactKind === 'door').concat(w.structureDoors || []);
  const units = w.commandos.concat(w.enemies).filter((u) => !u.removed);
  for (let j = Math.floor((z - extZ) / c); j <= Math.floor((z + extZ) / c); j++) {
    for (let i = Math.floor((x - ext) / c); i <= Math.floor((x + ext) / c); i++) {
      const px = (i + 0.5) * c - x, pz = (j + 0.5) * c - z;
      if (Math.abs(px * cos + pz * sin) > hw || Math.abs(-px * sin + pz * cos) > hd) continue;
      if (!g.inBounds(i, j)) return null;
      const k = g.idx(i, j);
      if (g.block[k] !== B.NONE || g.bridge[k] || g.linksAt(k).length) return null;
      const cx = (i + 0.5) * c, cz = (j + 0.5) * c;
      if (units.some((u) => Math.abs(u.x - cx) < c && Math.abs(u.z - cz) < c)) return null;
      if (doors.some((d) => Math.hypot(d.x - cx, d.z - cz) < 1.2)) return null;
      cells.push(k);
    }
  }
  return cells;
}

/** Re-stamp a settled prop's footprint (nudged ≤ props.nudge m) → {x, z, cells} or null (nav-neutral). */
export function restampProp(w, it) {
  const cls = navClass(it);
  if (cls === B.NONE) return null;
  const [x, , z, qx, qy, qz, qw] = it.pose;
  const yaw = Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qz * qz));
  const N = CONFIG.physics.props.nudge;
  const tries = [[0, 0]];
  for (const r of [0.5, N]) for (let a = 0; a < 8; a++) tries.push([Math.cos(a * Math.PI / 4) * r, Math.sin(a * Math.PI / 4) * r]);
  for (const [dx, dz] of tries) {
    const cells = footprintCells(w, it, x + dx, z + dz, -yaw);
    if (!cells || !cells.length) continue;
    for (const k of cells) { w.grid.block[k] = cls; w.grid.owner[k] = it.owner; }
    w.grid.version++;
    return { x: r4(x + dx), z: r4(z + dz), cells };
  }
  return null;
}
