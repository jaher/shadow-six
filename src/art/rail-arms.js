/**
 * Arms inside a stair's rails (user feedback 2026-10-11: "it looks like the man walk on the stairs in a way they can
 * cross the handrails, fix that"). The sim keeps a man's middle in his band between a flight's rails
 * (entities/stair-walk.js railShift); his arms swing on their own clip — on a narrow stair (M2's 0.9 m plat_sw), a man
 * stepping aside to let another pass, a man turning where he stops on a landing, a hand or an elbow would reach past
 * the rail on its side. Then that upper arm turns in about the stair's axis, at the shoulder, until the hand and the
 * elbow keep GAP inside the rail (and a knee lifted out past one turns in: railKnees). View only; the last pose step of
 * a unit's frame (art/unit-model.js).
 * @module art/rail-arms
 */
import { Vector3, Quaternion } from 'three';
import { unitFlight } from '../entities/stair-walk.js';
import { flightLocal } from '../world/stairs.js';
import { SIDE_STEP } from './ladder-frame.js';

/** m a hand / an elbow keeps inside a rail's inner face (its radius and a little more). */
export const GAP = 0.06;

const _a = new Vector3(), _b = new Vector3(), _ax = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _pq = new Quaternion();

/**
 * The limit (m off the axis) on side sg (±1, + left) at s: the rails' clear half-width, or nearer what the drawn scene
 * has there (ladder-frame.js fitStairSides: a stairwell's wall, a coping), less GAP.
 */
export function sideLimit(f, s, sg) {
  let c = f.clear ?? f.w / 2;
  const S = f.sides;
  if (S) {
    const i = Math.round((s - S.s0) / SIDE_STEP), a = sg < 0 ? S.r : S.l;
    for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < a.length && a[j] < c) c = a[j];
  }
  return c - GAP;
}

/** How far (m) the hand or the elbow of one arm is past the limit on its side (≤ 0: inside). */
function past(f, ua, la, hd) {
  let worst = -Infinity;
  for (const b of [la, hd]) {
    const p = b.getWorldPosition(_b), q = flightLocal(f, p.x, p.z), sg = q.v < 0 ? -1 : 1;
    worst = Math.max(worst, Math.abs(q.v) - sideLimit(f, q.s, sg));
  }
  return worst;
}

/**
 * @param {import('./unit-model.js').UnitModel} m
 * @param {import('./pose-blend.js').BoneGuard} [guard]
 * @returns {boolean} bones written
 */
export function railArms(m, guard) {
  const u = m.unit, B = m.real?.inner?.bones;
  if (!u || u.alive === false || u._ladder || u.vehicle || !B?.upperarm_l || !B.lowerarm_l || !B.hand_l || !B.upperarm_r || !B.lowerarm_r || !B.hand_r) return false;
  if (!u.world?.grid?.flights?.size) return false;
  const at = unitFlight(u, 2, 0.6);
  if (!at) return false;
  const f = at.f;
  if (at.s < (f.railS?.[0] ?? f.sFoot) - 0.4 || at.s > (f.railS?.[1] ?? f.sTop) + 0.4 || Math.abs(at.v) > (f.clear ?? f.w / 2)) return false;
  _ax.set(f.ux, 0, f.uz);
  let did = false;
  for (const sd of ['l', 'r']) {
    const ua = B['upperarm_' + sd], la = B['lowerarm_' + sd], hd = B['hand_' + sd];
    for (let it = 0; it < 3; it++) {
      const ex = past(f, ua, la, hd);
      if (!(ex > 0.002)) break;
      // (the turn that brings it in: a trial step one way, the other way when that took it further out)
      const sh = ua.getWorldPosition(_a), hp = hd.getWorldPosition(_b);
      const r = Math.max(0.15, Math.hypot(flightLocal(f, hp.x, hp.z).v - flightLocal(f, sh.x, sh.z).v, hp.y - sh.y));
      const ang = Math.min(0.6, ex / r + 0.01);
      guard?.touch(ua);
      ua.getWorldQuaternion(_q2);
      const q0 = ua.quaternion.clone();
      ua.parent.getWorldQuaternion(_pq);
      ua.quaternion.copy(_pq.clone().invert().multiply(_q.setFromAxisAngle(_ax, ang).multiply(_q2))); ua.updateMatrixWorld(true);
      if (past(f, ua, la, hd) > ex) {
        ua.quaternion.copy(_pq.clone().invert().multiply(_q.setFromAxisAngle(_ax, -ang).multiply(_q2))); ua.updateMatrixWorld(true);
        if (past(f, ua, la, hd) > ex) { ua.quaternion.copy(q0); ua.updateMatrixWorld(true); break; }
      }
      did = true;
    }
  }
  return railKnees(m, f, B, guard) || did;
}

/**
 * Knees inside the rails: a leg lifted high up a steep stair (M2's plat_sw: a step up two treads) swings its knee out
 * past the rail on its side. Then that thigh turns about the line from its hip to its ankle — the foot where the
 * stairs put it, its sole as it was — until the knee keeps GAP inside the rail.
 */
function railKnees(m, f, B, guard) {
  let did = false;
  for (const sd of ['l', 'r']) {
    const th = B['thigh_' + sd], ca = B['calf_' + sd], ft = B['foot_' + sd];
    if (!th || !ca || !ft) continue;
    const knee = () => { const p = ca.getWorldPosition(_b), q = flightLocal(f, p.x, p.z), sg = q.v < 0 ? -1 : 1; return Math.abs(q.v) - sideLimit(f, q.s, sg); };
    for (let it = 0; it < 3; it++) {
      const ex = knee();
      if (!(ex > 0.002)) break;
      const hip = th.getWorldPosition(_a).clone(), ank = ft.getWorldPosition(_b).clone(), kp = ca.getWorldPosition(new Vector3());
      _ax.copy(ank).sub(hip);
      const L = _ax.length();
      if (L < 0.05) break;
      _ax.multiplyScalar(1 / L);
      // (the knee's distance off that line: the turn for its way in)
      const r = Math.max(0.05, kp.sub(hip).projectOnPlane(_ax).length());
      const ang = Math.min(0.8, ex / r + 0.02);
      guard?.touch(th); guard?.touch(ft);
      const fq = ft.getWorldQuaternion(new Quaternion());
      th.getWorldQuaternion(_q2);
      const q0 = th.quaternion.clone(), f0 = ft.quaternion.clone();
      const turn = (a) => {
        th.parent.getWorldQuaternion(_pq);
        th.quaternion.copy(_pq.clone().invert().multiply(_q.setFromAxisAngle(_ax, a).multiply(_q2))); th.updateMatrixWorld(true);
        ft.parent.getWorldQuaternion(_pq); ft.quaternion.copy(_pq.clone().invert().multiply(fq)); ft.updateMatrixWorld(true);
      };
      turn(ang);
      if (knee() > ex) {
        turn(-ang);
        if (knee() > ex) { th.quaternion.copy(q0); ft.quaternion.copy(f0); th.updateMatrixWorld(true); break; }
      }
      did = true;
    }
  }
  return did;
}
