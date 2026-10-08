/**
 * Climbing a ladder, view side (user request 2026-10-07, ladders checked with the stairs: the climber used to slide up
 * the link playing the one-shot wall mantle, ClimbUp_1m, frozen on its last frame). While Unit._followPath moves a man
 * up / down a ladder's line (entities/stair-walk.js ladderTrack: from its foot to its top, facing it), his body is
 * posed on it every frame over whatever clip plays:
 *  - rungs every ~0.3 m along the ladder's line (its foot → its top, the line the sim climbs; the rails run on 0.9 m
 *    past the top);
 *  - a diagonal two-beat climb: the right foot and the left hand move up two rungs together while the other pair holds,
 *    then the other pair moves — the phase is the sim's height on the ladder, so going down replays it backwards;
 *  - feet: the ball of each foot on its rung (two-bone IK); hands: on the rungs about 1.5 m above the feet (the rail
 *    tops at the top), fingers over the rung; the hips 0.3 m behind the rungs, on the lower foot (eased: the body rises
 *    as the upper leg pushes); the chest leans in, the head looks the way he climbs;
 *  - the weapon is slung (hands on the rungs); the pose eases in over the first and out over the last GAIT.fade s.
 * Bones are written through the model's BoneGuard after the mixer; nothing accumulates.
 * @module art/ladder-climb
 */
import { Vector3, Quaternion } from 'three';
import { twoBoneIK } from './characters/pipeline/weapons.js';
import { clipPose, mixPose, capturePose } from './pose-blend.js';

const DEG = Math.PI / 180;
/** rung: rung spacing along the ladder (m); hipBack: hips behind the rungs (m); hand: hand rung above the foot rung
 *  (rungs); rail: how far the rails run past the top (m); fade: s; spring: rad/s of the hips. */
export const LADDER = { on: true, rung: 0.3, hipBack: 0.3, hand: 5, rail: 0.9, fade: 0.25, spring: 18, feet: 0.11, hands: 0.2, lean: 9 * DEG };
const SIDES = ['l', 'r'];
const _v = new Vector3(), _a = new Vector3(), _q = new Quaternion(), _pq = new Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/**
 * Rung index (from the ladder's foot, fractional while it moves) of the two limb pairs at climb phase q (rungs
 * climbed by the body): pair A (right foot + left hand) moves up two rungs while q goes 2n → 2n+1 and holds while it
 * goes on to 2n+2; pair B (left foot + right hand) holds, then moves. @returns {{a:number, b:number}}
 */
export function rungPairs(q) {
  const ra = (x) => 2 * Math.floor(x / 2) + 2 * smooth(x - 2 * Math.floor(x / 2));
  return { a: Math.max(0, ra(q)), b: Math.max(0, ra(q - 1)) };
}

/** The ladder state of a unit (Unit._ladder) as the view needs it, or null. */
function ladderOf(u) {
  const L = u?._ladder;
  if (!L || !u.alive) return null;
  const H = L.top.y - L.foot.y, hz = Math.hypot(L.top.x - L.foot.x, L.top.z - L.foot.z), len = Math.hypot(H, hz);
  if (!(H > 0.2)) return null;
  // rungs ~0.3 m apart along the ladder: their vertical spacing
  return { L, H, rs: LADDER.rung * H / Math.max(H, len) };
}

/** Point on the ladder's line at height y (extrapolated past its top: the rails). */
function lineAt(L, H, y, out) {
  const t = (y - L.foot.y) / H;
  return out.set(L.foot.x + (L.top.x - L.foot.x) * t, y, L.foot.z + (L.top.z - L.foot.z) * t);
}

/**
 * Per-frame ladder pose for one UnitModel. @param {import('./unit-model.js').UnitModel} m @param {number} dt
 * @param {import('./pose-blend.js').BoneGuard} guard @returns {boolean} bones written
 */
export function ladderClimb(m, dt, guard) {
  const h = m.real?.inner, B = h?.bones, u = m.unit;
  if (!B?.pelvis || !B.thigh_l || !B.foot_l || !B.upperarm_l || !B.lowerarm_l || !B.hand_l || !B.upperarm_r || !B.hand_r) return false;
  const lad = LADDER.on ? ladderOf(u) : null;
  let S = m._lc;
  if (!S) { if (!lad) return false; S = m._lc = { w: 0, lad: null, y: null, yv: 0, gun: null }; }
  if (lad) S.lad = lad;
  if (dt > 0) S.w = clamp(S.w + (lad ? dt : -dt) / LADDER.fade, 0, 1);
  const enemyGun = !m.player ? h.weapon : null;
  if (!lad && S.w <= 0) {
    if (S.gun && enemyGun) enemyGun.visible = S.gun.visible;
    m._lc = null;
    return false;
  }
  if (enemyGun && lad) { S.gun ||= { visible: enemyGun.visible }; enemyGun.visible = false; }
  const { L, H, rs } = S.lad, root = m.root, W8 = smooth(S.w);
  const fx = L.fx, fz = L.fz, rx = fz, rz = -fx; // facing; (rx, rz): his left (three.js: +x local is the left)
  const yaw = Math.atan2(fx, fz);
  // the shown body faces the ladder (the sim turns at its own rate at the start of a descent)
  let dyaw = yaw - root.rotation.y; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  root.rotation.y += dyaw * W8;
  root.updateMatrixWorld(true);
  const before = W8 < 1 ? capturePose(m) : null;
  // a still base pose (the idle clip's first frame): nothing of the walk / mantle under it shows
  const idle = clipPose(m, 'idle', 0);
  if (idle) mixPose(m, idle, 1, guard);
  if (!h._boneTop) { let b = B.pelvis; while (b.parent && b.parent !== h.object) b = b.parent; h._boneTop = b; }
  h.object.updateWorldMatrix(true, false); h._boneTop.updateMatrixWorld(true);

  // climb phase from the shown height on the ladder; limb rungs; the hips on the lower foot
  const yb = root.position.y, q = clamp((yb - L.foot.y) / rs, 0, H / rs);
  const P = rungPairs(q), maxR = Math.floor(H / rs + 1e-6);
  const footY = { r: L.foot.y + Math.min(P.a, maxR) * rs, l: L.foot.y + Math.min(P.b, maxR) * rs };
  const handY = { l: L.foot.y + (P.a + LADDER.hand) * rs, r: L.foot.y + (P.b + LADDER.hand) * rs };
  for (const s of SIDES) handY[s] = Math.min(handY[s], L.top.y + LADDER.rail - 0.05);
  const hipH = (B.calf_l.position.length() + B.foot_l.position.length()) * scaleOf(B.calf_l) * 0.93;
  const yT = Math.min(footY.l, footY.r) + hipH + 0.04;
  if (S.y == null) { S.y = yT; S.yv = 0; }
  if (dt > 0) {
    const om = LADDER.spring, n = Math.max(1, Math.ceil(dt * 240)), hh = dt / n;
    for (let i = 0; i < n; i++) { S.yv += (om * om * (yT - S.y) - 2 * om * S.yv) * hh; S.y += S.yv * hh; }
  }
  // pelvis: behind the rungs at its height
  guard?.touch(B.pelvis);
  const pel = lineAt(L, H, S.y, _a).addScaledVector(_v.set(fx, 0, fz), -LADDER.hipBack);
  B.pelvis.position.copy(B.pelvis.parent.worldToLocal(pel.clone()));
  B.pelvis.updateMatrixWorld(true);
  // chest in toward the ladder, head up the way he goes (down: looking down past his feet)
  const goingUp = (L.to?.y ?? 0) >= (L.from?.y ?? 0);
  for (const [b, a] of [[B.spine_01, LADDER.lean * 0.5], [B.spine_02, LADDER.lean * 0.5], [B.Head || B.head, goingUp ? -10 * DEG : 22 * DEG]]) {
    if (!b) continue;
    guard?.touch(b);
    b.parent.getWorldQuaternion(_pq);
    const ax = _v.set(rx, 0, rz).applyQuaternion(_pq.invert()).normalize();
    b.quaternion.premultiply(_q.setFromAxisAngle(ax, a));
    b.updateMatrixWorld(true);
  }
  // feet: the ball on the rung (the ankle behind and above it); hands: on the rung, fingers over it
  const ab = (B.ball_l ? B.ball_l.position.length() * scaleOf(B.ball_l) : 0.15);
  for (const s of SIDES) {
    const side = s === 'l' ? 1 : -1; // (along his left)
    const thigh = B['thigh_' + s], calf = B['calf_' + s], foot = B['foot_' + s];
    if (thigh && calf && foot) {
      guard?.touch(thigh); guard?.touch(calf); guard?.touch(foot);
      const t = lineAt(L, H, footY[s] + 0.035, new Vector3()).addScaledVector(_v.set(rx, 0, rz), side * LADDER.feet)
        .addScaledVector(_v.set(fx, 0, fz), -ab * 0.9);
      t.y += 0.06;
      twoBoneIK(thigh, calf, foot, t);
    }
    const ua = B['upperarm_' + s], la = B['lowerarm_' + s], hd = B['hand_' + s];
    if (ua && la && hd) {
      guard?.touch(ua); guard?.touch(la); guard?.touch(hd);
      const t = lineAt(L, H, handY[s] + 0.02, new Vector3()).addScaledVector(_v.set(rx, 0, rz), side * LADDER.hands)
        .addScaledVector(_v.set(fx, 0, fz), -0.05);
      twoBoneIK(ua, la, hd, t);
      // fingers forward over the rung (minimal turn of the hand's finger axis onto the facing, tipped down)
      const mid = B['middle_01_' + s];
      if (mid) {
        const hp = hd.getWorldPosition(new Vector3()), dir = mid.getWorldPosition(new Vector3()).sub(hp).normalize();
        const want = _a.set(fx, -0.35, fz).normalize();
        hd.getWorldQuaternion(_q);
        const rot = new Quaternion().setFromUnitVectors(dir, want);
        hd.parent.getWorldQuaternion(_pq);
        hd.quaternion.copy(_pq.invert().multiply(rot.multiply(_q)));
        hd.updateMatrixWorld(true);
      }
    }
  }
  if (before) mixPose(m, before, 1 - W8, guard);
  return true;
}

function scaleOf(b) { b.getWorldScale(_v); return (Math.abs(_v.x) + Math.abs(_v.y) + Math.abs(_v.z)) / 3; }
