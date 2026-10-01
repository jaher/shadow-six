/**
 * Applies one queued explosion to the physics layer (bodies-design §A.3–§A.8): ragdolls for the bodies it threw,
 * visual stagger/fall reactions for survivors, loose props, vehicle rock, and the `blast:front` event the visual
 * systems (doors, glass, grass, water, ground marks) listen to. Targets are processed in entity-id order.
 * @module physics/blast-apply
 */

import { CONFIG } from '../config.js';
import { blastParams, occlusion, blastImpulse, hash01 } from './blast.js';
import { groundAt } from './statics.js';

/** Death causes that come from world.explode() (the class name, or 'explosion' for barrels/vehicles). */
export const EXPLOSIVE_CAUSES = new Set(['explosion', 'grenade', 'bomb', 'barrel', 'vehicle', 'shell', 'fuelTank']);

/** Survivor reaction for a speed dv (m/s) the blast would give a 75 kg man (§A.5). */
export function survivorReaction(dv, stance = 'stand') {
  const S = CONFIG.physics.survivor;
  if (dv < 0.05) return null;
  if (stance !== 'stand' && stance !== 'crouch') return 'flinch';
  return dv < S.flinch ? 'flinch' : dv < S.fall ? 'stagger' : 'fall';
}

/** Give ragdoll `rd` the blast velocity dv·dir plus a tumble about (up × dir) (§A.3 angular kick). */
export function kickRagdoll(rd, imp, id) {
  const C = CONFIG.physics.blast;
  const d = imp.dir, dv = imp.dv;
  const hx = d.x, hz = d.z, hl = Math.hypot(hx, hz) || 1;
  // k = up × dir: rotating +Y about k by a positive angle moves the head away from the blast
  const kx = hz / hl, kz = -hx / hl;
  const j = 0.7 + 0.6 * hash01(id, 3);
  const wMag = Math.min(10, C.angular * 1.9 * dv * j);
  const twist = (hash01(id, 5) - 0.5) * 0.25 * dv;
  const w = { x: kx * wMag, y: twist, z: kz * wMag };
  const p0 = rd.bodies[0].translation();
  const com = { x: p0.x, y: p0.y + 0.1, z: p0.z };
  for (const b of rd.bodies) {
    const p = b.translation();
    const r = { x: p.x - com.x, y: p.y - com.y, z: p.z - com.z };
    b.setLinvel({ x: d.x * dv + (w.y * r.z - w.z * r.y), y: d.y * dv + (w.z * r.x - w.x * r.z), z: d.z * dv + (w.x * r.y - w.y * r.x) }, true);
    b.setAngvel(w, true);
  }
}

/**
 * Knock-loose items (§A.4, visual only): an enemy's helmet flies off with the blast when the impulse exceeds 60 % of
 * the fall threshold. `unit.helmetOff` is read by render/physics-visuals.js; BCD dropped weapons keep their gameplay
 * position (the body's) and never follow it.
 */
export function knockLoose(w, u, imp) {
  if (u.kind !== 'enemy' || u.soldierType === 'dog' || u.helmetOff) return;
  if (imp.dv < CONFIG.physics.looseItemFrac * CONFIG.physics.survivor.fall) return;
  const j = hash01(u.id, 11);
  u.helmetOff = { vx: imp.dir.x * imp.dv * (1.1 + 0.3 * j), vy: 2.5 + imp.dv * 0.35, vz: imp.dir.z * imp.dv * (1.1 + 0.3 * j), spin: 6 + 8 * j, t0: w.time };
}

/** Apply queued explosion event `ev` through PhysicsWorld `pw`. */
export function applyBlast(pw, ev) {
  const w = pw.world, P = CONFIG.physics, bp = blastParams(w, ev);
  w.events.emit('blast:front', { x: bp.x, z: bp.z, Rk: bp.Rk, Rb: bp.Rb, Q: bp.Q, kind: bp.cls, t: w.time });
  try { w.wind?.addImpulse?.({ x: bp.x, z: bp.z, strength: bp.Q, radius: bp.Rb, speed: P.blast.front }); } catch { /* optional (feat/phase3) */ }
  const units = w.entitiesInRadius(bp.x, bp.z, bp.Rb, (e) => e.kind === 'commando' || e.kind === 'enemy').sort((a, b) => a.id - b.id);
  const bodies = [];
  for (const u of units) {
    if (u.removed || u.state === 'inVehicle' || u.vehicle || u.state === 'carried' || u.carriedBy || u.hiddenBody || u.state === 'jailed') continue;
    const gy = groundAt(w, u.x, u.z) + (u.y || 0);
    const occ = occlusion(pw.rw, pw.R, w, bp, u.x, u.z, gy);
    if (u.alive === false) {
      if (!pw.eligible(u) || u.soldierType === 'dog') { delete u._blastKill; continue; }
      const fresh = u._blastKill != null || w.time - (u.deathTime ?? -1e9) < P.ragdoll.settleAt;
      const area = fresh ? P.blast.area.body : P.blast.area.body * 0.5;
      const imp = blastImpulse(bp, u.x, gy + 1, u.z, area, P.ragdoll.mass, P.blast.maxDvBody, occ, u.id);
      if (fresh || imp.dv > 1.0) bodies.push({ u, imp, fresh });
      continue;
    }
    const imp = blastImpulse(bp, u.x, gy + 1, u.z, P.blast.area.body, P.ragdoll.mass, P.blast.maxDvBody, occ, u.id);
    const kind = survivorReaction(imp.dv, u.stance);
    if (!kind) continue;
    const S = P.survivor;
    u.blastReact = { kind, dx: imp.dir.x, dz: imp.dir.z, off: Math.min(S.maxOffset, imp.dv * 0.2), t0: w.time,
      dur: kind === 'flinch' ? S.times.hit : kind === 'stagger' ? S.times.knockback : S.times.fall, occ };
    w.events.emit('unit:blast', { unit: u, dv: imp.dv, reaction: kind, dir: imp.dir });
    if (kind === 'fall') knockLoose(w, u, imp);
    // a guard blown off his feet is down (blind, silent, not firing) until he is up again (§A.5, physicsGameplay)
    if (kind === 'fall' && u.kind === 'enemy' && w.house?.physicsGameplay !== false) {
      u.knockedDown = { until: Math.round((w.time + S.times.fall) * 1e4) / 1e4 };
      u.stop?.();
    }
  }
  // ragdolls: biggest impulse first, ties by id; over the cap → canned clip (+ settle if a slot frees later)
  bodies.sort((a, b) => b.imp.J - a.imp.J || a.u.id - b.u.id);
  for (const { u, imp, fresh } of bodies) {
    delete u._blastKill;
    const pend = pw.pendingSettle.findIndex((p) => p.unit === u);
    if (pend >= 0) pw.pendingSettle.splice(pend, 1);
    if (!pw.canRagdoll()) { if (fresh) pw._scheduleSettle(u); continue; }
    const rd = pw.startRagdoll(u, fresh && !u.bodyPose ? 'blast' : 'settle', { prone: u.stance === 'crawl' || u.stance === 'prone' });
    // 1998 rules (physicsGameplay off): the body only slumps where he died (his gameplay spot never moves anyway)
    const ki = w.house?.physicsGameplay === false ? { ...imp, dv: imp.dv * P.classicThrow } : imp;
    if (rd) { rd.blast = { dv: ki.dv, cls: bp.cls }; kickRagdoll(rd, ki, u.id); knockLoose(w, u, ki); }
  }
  pw.props.blast(bp);
  for (const v of w.vehicles) {
    if (v.removed || v.hiddenRail) continue;
    const d = Math.hypot(v.x - bp.x, v.z - bp.z);
    if (d > bp.Rb) continue;
    const mass = v.def?.armored ? 12000 : (v.def?.mass ?? 2500);
    const imp = blastImpulse(bp, v.x, groundAt(w, v.x, v.z) + 1, v.z, 6, mass, P.blast.maxDvProp, occlusion(pw.rw, pw.R, w, bp, v.x, v.z), v.id);
    const heavy = !!v.def?.armored || mass > 4000;
    if (imp.dv > 0.02) v.blastRock = { dx: imp.dir.x, dz: imp.dir.z, dv: imp.dv, heavy, t0: w.time, bx: bp.x, bz: bp.z };
    // §A.7: a light vehicle wrecked by a close blast is thrown onto its side (or its roof) and stays there (visual)
    if (!heavy && v.destroyed && !v.blastFlip && imp.dv > P.vehicles.flipDv) {
      v.blastFlip = { dx: imp.dir.x, dz: imp.dir.z, ang: imp.dv > P.vehicles.flipDv * 2 ? Math.PI : Math.PI / 2, t0: w.time };
    }
  }
}
