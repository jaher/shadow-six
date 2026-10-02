/**
 * Turning on the spot, view side (SHADOW SIX smooth turn, enemy-brain _turnTo): a standing German whose displayed
 * heading turns while he stands steps round instead of spinning on his soles.
 *  - feet: each foot stays planted on the ground (two-bone IK, its world yaw kept) until the turn has twisted it out of
 *    the clip's stance (> STEP.yaw or > STEP.dist), then lifts and steps over STEP.dur s to where the stance will put it
 *    (a little ahead of the turn); the feet take turns. When he stops, a last step squares the feet up, then the clip
 *    has them again.
 *  - head: leads the turn by up to STEP.headMax (neck 40 %, head 60 %), from the turn's angular speed.
 * Pure view-side: the sim heading and the cone are untouched; bones are written after the mixer through the model's
 * BoneGuard (put back before the next mixer update), so nothing accumulates. Real enemy characters only.
 * @module art/turn-step
 */
import { Vector3, Quaternion, MathUtils } from 'three';
import { twoBoneIK } from './characters/pipeline/weapons.js';
import { LOCOMOTION } from './unit-anim-map.js';

const DEG = Math.PI / 180;
/** Step tuning: dur (s), lift (m), yaw / dist = twist / slip that calls a step, settle = what a last step squares up,
 *  lead = how far ahead of the turn a foot lands (s of turn, ≤ leadMax), head lead (s of turn, ≤ headMax), start =
 *  turn speed (rad/s) that plants the feet, still = s without turning before the squaring-up step. on: kill switch. */
export const STEP = { on: true, dur: 0.3, lift: 0.075, yaw: 22 * DEG, dist: 0.09, settleYaw: 4 * DEG, settleDist: 0.025, lead: 0.12,
  leadMax: 20 * DEG, head: 0.12, headMax: 18 * DEG, start: 0.3, still: 0.15 };
const UP = new Vector3(0, 1, 0);
const SIDES = ['l', 'r'];
const _a = new Vector3(), _t = new Vector3(), _q = new Quaternion(), _pq = new Quaternion();

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (u) => u * u * (3 - 2 * u);

/** Rotate bone b by `angle` about the world up axis. */
function yawBone(b, angle) {
  if (!b || Math.abs(angle) < 1e-5) return;
  b.parent.getWorldQuaternion(_pq);
  const ax = _a.copy(UP).applyQuaternion(_pq.invert()).normalize();
  b.quaternion.premultiply(_q.setFromAxisAngle(ax, angle));
  b.updateMatrixWorld(true);
}

/** (x, z) rotated by `a` about the world up axis through (cx, cz) (three.js rotation.y sense). */
function rotAbout(cx, cz, x, z, a) {
  const dx = x - cx, dz = z - cz, c = Math.cos(a), s = Math.sin(a);
  return { x: cx + c * dx + s * dz, z: cz - s * dx + c * dz };
}

/** Is the model a standing man turning on the spot (not walking, lying, dying, carried, posed by an overlay)? */
function eligible(m) {
  const u = m.unit;
  if (!u || m.dog || m.player || m.opts?.faction !== 'enemy' || u.alive === false) return false;
  if ((u.stance ?? 'stand') !== 'stand' || u.state === 'carried' || u.state === 'inVehicle' || u._mgManned) return false;
  if (LOCOMOTION.has(m.anim) || /^(die|dead)/.test(m.anim || '') || m.overlay || m._tr || m._br || u.blastReact) return false;
  return true;
}

/**
 * Per-frame turning step for one UnitModel (call after the mixer, before the root's matrices are refreshed).
 * @param {import('./unit-model.js').UnitModel} m
 * @param {number} dt rendered frame time (0 while paused: the pose holds)
 * @param {import('./pose-blend.js').BoneGuard} guard
 * @returns {boolean} bones written
 */
export function turnStep(m, dt, guard) {
  const h = m.real?.inner, B = h?.bones;
  if (!B || !B.thigh_l || !B.calf_l || !B.foot_l || !B.thigh_r || !B.calf_r || !B.foot_r) return false;
  const st = m._turnStep || (m._turnStep = { yaw: null, x: 0, z: 0, wv: 0, feet: null, step: null, last: 'r', still: 0, lead: 0 });
  const root = m.root, yaw = root.rotation.y, px = root.position.x, pz = root.position.z;
  const dyaw = st.yaw == null ? 0 : wrap(yaw - st.yaw);
  const moved = st.yaw == null ? 0 : Math.hypot(px - st.x, pz - st.z);
  // (a dt = 0 frame — paused, or Game.advance's own render after a tick — keeps the turn it saw for the next real frame)
  if (dt > 0 || st.yaw == null) { st.yaw = yaw; st.x = px; st.z = pz; }
  if (dt > 0) st.wv += (dyaw / dt - st.wv) * Math.min(1, dt * 12);
  if (!STEP.on || !eligible(m) || moved > 0.1) { st.feet = null; st.step = null; st.wv = 0; st.lead = 0; return false; }
  if (dt > 0) st.still = Math.abs(st.wv) < 0.15 ? st.still + dt : 0;
  if (!st.feet && dt > 0 && (Math.abs(st.wv) > STEP.start || Math.abs(dyaw) > 0.05)) st.feet = {}; // starts turning
  if (!st.feet) return false;

  // clip foot positions this frame (after the mixer): where the stance puts each foot under the turned body
  if (!h._boneTop) { let b = B.pelvis || B.thigh_l; while (b.parent && b.parent !== h.object) b = b.parent; h._boneTop = b; }
  h.object.updateWorldMatrix(true, false);
  h._boneTop.updateMatrixWorld(true);
  const F = {};
  for (const s of SIDES) { const p = B['foot_' + s].getWorldPosition(new Vector3()); F[s] = p; }
  for (const s of SIDES) {
    if (!st.feet[s]) { // planted where it stood last frame (before this frame's turn)
      const p = rotAbout(px, pz, F[s].x, F[s].z, -dyaw);
      st.feet[s] = { x: p.x, z: p.z, yaw: yaw - dyaw };
    }
  }
  const err = (s) => {
    const f = st.feet[s];
    return { d: Math.hypot(f.x - F[s].x, f.z - F[s].z), a: Math.abs(wrap(yaw - f.yaw)) };
  };
  // lead of a landing foot: the turn goes on while it swings
  const lead = MathUtils.clamp(st.wv * STEP.lead, -STEP.leadMax, STEP.leadMax);
  if (dt > 0 && st.step) {
    const S = st.step;
    S.u = Math.min(1, S.u + dt / STEP.dur);
    if (S.u >= 1) {
      const g = rotAbout(px, pz, F[S.s].x, F[S.s].z, S.settle ? 0 : lead);
      st.feet[S.s] = { x: g.x, z: g.z, yaw: yaw + (S.settle ? 0 : lead) };
      st.last = S.s;
      st.step = null;
    }
  }
  if (dt > 0 && !st.step) {
    const e = { l: err('l'), r: err('r') };
    const need = (s, yawT, distT) => Math.max(e[s].a / yawT, e[s].d / distT);
    const turning = st.still < STEP.still;
    const yT = turning ? STEP.yaw : STEP.settleYaw, dT = turning ? STEP.dist : STEP.settleDist;
    const nl = need('l', yT, dT), nr = need('r', yT, dT);
    let s = null;
    if (nl >= 1 || nr >= 1) s = nl >= 1 && nr >= 1 ? (st.last === 'l' ? 'r' : 'l') : nl >= nr ? 'l' : 'r';
    if (s) {
      const f = st.feet[s];
      st.step = { s, u: 0, x0: f.x, z0: f.z, yaw0: f.yaw, settle: !turning };
    } else if (!turning && st.still > STEP.still + 0.1 && e.l.d < 0.01 && e.r.d < 0.01 && e.l.a < 2 * DEG && e.r.a < 2 * DEG) {
      st.feet = null; // squared up: the clip has his feet again
      return false;
    }
  }

  // feet: yaw kept in the world, then two-bone IK onto the planted (or swinging) spot at the clip's own foot height
  for (const s of SIDES) {
    const thigh = B['thigh_' + s], calf = B['calf_' + s], foot = B['foot_' + s];
    guard?.touch(thigh); guard?.touch(calf); guard?.touch(foot);
    let x, z, fy, lift = 0;
    const f = st.feet[s];
    if (st.step && st.step.s === s) {
      const S = st.step, k = smooth(S.u), a = S.settle ? 0 : lead;
      const g = rotAbout(px, pz, F[s].x, F[s].z, a);
      x = S.x0 + (g.x - S.x0) * k; z = S.z0 + (g.z - S.z0) * k;
      fy = S.yaw0 + wrap(yaw + a - S.yaw0) * k;
      lift = STEP.lift * Math.sin(Math.PI * S.u) * Math.min(1, Math.hypot(g.x - S.x0, g.z - S.z0) / 0.04 + Math.abs(wrap(yaw + a - S.yaw0)) / (10 * DEG));
    } else { x = f.x; z = f.z; fy = f.yaw; }
    yawBone(foot, wrap(fy - yaw));
    _t.set(x, F[s].y + lift, z);
    twoBoneIK(thigh, calf, foot, _t);
  }

  // head leads the turn a little (smoothed angular speed)
  const want = MathUtils.clamp(st.wv * STEP.head, -STEP.headMax, STEP.headMax);
  if (dt > 0) st.lead += (want - st.lead) * Math.min(1, dt * 8);
  if (Math.abs(st.lead) > 1e-3) {
    if (B.neck_01) { guard?.touch(B.neck_01); yawBone(B.neck_01, 0.4 * st.lead); }
    if (B.Head) { guard?.touch(B.Head); yawBone(B.Head, (B.neck_01 ? 0.6 : 1) * st.lead); }
  }
  return true;
}
