/**
 * Climbing a ladder, view side (user requests 2026-10-07 — the climber slid up the link playing a frozen wall mantle —
 * and 2026-10-08: "Commando still too close to vertical ladder when climbing"). While Unit._followPath moves a man up
 * or down a ladder link (entities/stair-walk.js ladderTrack: its straight line from end to end, facing it), his body
 * is posed every frame on the ladder actually there (art/ladder-frame.js: the drawn ladder's rung line, rungs and
 * stiles, or the ladder built where none is drawn), over whatever clip plays:
 *  - he hangs off it as a climber does: pelvis LADDER.pelvisOut out of the rung line, chest LADDER.chestOut (the
 *    spine leaning in), head up, knees never closer than LADDER.kneeMin (the pelvis goes further out when a raised knee
 *    would come up into the rungs);
 *  - feet: the ball of each foot on a rung (heel free, a little below it), either side of the middle; they leapfrog —
 *    a foot moves up two rungs past the other, swinging out round the rung it leaves — with the opposite hand (a
 *    diagonal climb); hands grip the rungs about 1.4 m above their foot, knuckles over the rung, thumbs in; past the
 *    top rung they take the stiles;
 *  - getting on: from where he stands at the ladder's foot end (both feet on the ground, hands up on the rungs), the
 *    first foot steps onto the lowest rung; getting off at the top: the feet step from the top rungs onto the deck at
 *    the top end — over a wall's top when it stands above the deck (M2's palisade) — hands on the stiles, then he stands
 *    there facing on; going down replays it backwards (his back to the drop);
 *  - the climb's progress is the sim's progress along the link (deterministic): the schedule spreads the moves evenly
 *    over it;
 *  - the weapon is slung (hands on the rungs); the pose eases in over the first and out over the last LADDER.fade s.
 * Bones are written through the model's BoneGuard after the mixer; nothing accumulates. `m._lc.state` tells what each
 * limb holds (tests read it).
 * @module art/ladder-climb
 */
import { Vector3, Quaternion } from 'three';
import { twoBoneIK } from './characters/pipeline/weapons.js';
import { clipPose, mixPose, capturePose } from './pose-blend.js';
import { ladderFrame, ladderPoint, ladderDir, local, outOf, roomAt } from './ladder-frame.js';
import { steepLadder } from '../entities/stair-walk.js';

const DEG = Math.PI / 180;
/**
 * pelvisOut / chestOut: m out of the rung line on the rungs (the chest: halfway between the top of the spine and the
 * neck; chestMax the furthest it goes when the upper back straightens); headOut: m the head keeps off it; kneeMin: m a
 * knee keeps off the rungs and stiles, centre to centre; kneeOut: m the knee joint stays out of the rung line (the
 * pelvis goes out as far as a foot high on a rung bends the knee in); footW /
 * handW: m either side of the middle; handUp: m a hand grips above its foot; heel: rad the heel hangs below the ball;
 * swingOut: m a moving foot / hand swings out round the rung; fade: s in / out; spring: rad/s of the pelvis follow;
 * leanMax: rad of spine lean; splay: knees pointing out (sideways share of the knee's direction); outMax: m the pelvis
 * goes out at most on the rungs (less where the room in front of them is less: a cage's hoops); on: kill switch.
 */
export const LADDER = { on: true, pelvisOut: 0.5, chestOut: 0.33, chestMax: 0.385, headOut: 0.3, kneeMin: 0.085, kneeOut: 0.068, footW: 0.1, handW: 0.16,
  handUp: 1.25, heel: 20 * DEG, swingOut: 0.12, fade: 0.25, spring: 22, leanMax: 40 * DEG, splay: 0.5, outMax: 0.66 };
const SIDES = ['l', 'r'];
const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _pq = new Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Rung index (from the ladder's foot, fractional while it moves) of the two limb pairs at climb phase q (the old
 * two-beat climb, kept for its unit test): pair A moves up two rungs while q goes 2n → 2n+1, pair B while 2n+1 → 2n+2.
 * @returns {{a:number, b:number}}
 */
export function rungPairs(q) {
  const ra = (x) => 2 * Math.floor(x / 2) + 2 * smooth(x - 2 * Math.floor(x / 2));
  return { a: Math.max(0, ra(q)), b: Math.max(0, ra(q - 1)) };
}

/**
 * Leapfrog schedule of a ladder with `n` foot rungs (levels: 0 the ground, 1..n rungs, n+1 the deck): foot A (the
 * right) holds even levels and moves 2m → 2m+2 while q goes 2m → 2m+1; foot B (the left) steps 0 → 1 while q goes
 * −1 → 0, then 2m+1 → 2m+3 while q goes 2m+1 → 2m+2; both end on the deck. @returns {{q0:number, q1:number, D:number}}
 */
export function ladderSchedule(n) {
  const D = n + 1;
  let ea = 1; while (ea + 1 < D) ea += 2;      // A: its last move ends at q = 2m+1 with 2m+2 ≥ D
  let eb = 0; if (D > 1) { eb = 2; while (eb + 1 < D) eb += 2; } // B: 2m+3 ≥ D at q = 2m+2
  return { q0: -1, q1: Math.max(ea, eb), D };
}

/** Level of a foot ('A' right, 'B' left) at phase q: {a, b, t} (from level a to b, t ∈ [0, 1]; a === b holding). */
export function footLevel(q, foot, D) {
  let a, b, t;
  if (foot === 'A') {
    if (q < 0) { a = b = 0; t = 0; } else {
      const m = Math.floor(q / 2), r = q - 2 * m;
      if (r < 1) { a = 2 * m; b = 2 * m + 2; t = smooth(r); } else { a = b = 2 * m + 2; t = 1; }
    }
  } else if (q < -1) { a = b = 0; t = 0; } else if (q < 0) { a = 0; b = 1; t = smooth(q + 1); } else {
    const m = Math.floor((q - 1) / 2), r = q - 1 - 2 * m;
    if (r < 1) { a = 2 * m + 1; b = 2 * m + 3; t = smooth(r); } else { a = b = 2 * m + 3; t = 1; }
  }
  a = Math.min(a, D); b = Math.min(b, D);
  if (a === b) t = 1;
  return { a, b, t };
}

/** Per body, once: standing pelvis height, ball height over the sole, ankle over / behind the ball, leg length. */
function bodyGeo(h, B, root) {
  if (h._ladGeo) return h._ladGeo;
  const g = {};
  const P = B.pelvis.getWorldPosition(new Vector3()), base = root.position.y;
  const A = B.foot_l.getWorldPosition(new Vector3()), Bl = B.ball_l.getWorldPosition(new Vector3());
  g.hipStand = clamp(P.y - base, 0.7, 1.2);
  g.ballH = clamp(Bl.y - base, 0.01, 0.08);
  g.ankleRise = clamp(A.y - Bl.y, 0.03, 0.15);
  g.ankleOut = clamp(Math.hypot(A.x - Bl.x, A.z - Bl.z), 0.06, 0.2);
  const sc = scaleOf(B.calf_l);
  g.leg = (B.calf_l.position.length() + B.foot_l.position.length()) * sc;
  // (thigh and shin; the hip joint under / in front of the pelvis, in the body's own frame)
  const T = B.thigh_l.getWorldPosition(new Vector3()), K = B.calf_l.getWorldPosition(new Vector3());
  g.thigh = T.distanceTo(K); g.shin = K.distanceTo(A);
  if (g.thigh + g.shin > 0.5) g.leg = Math.min(g.leg, g.thigh + g.shin); // (the joints' own distances: a rig's twist bones aside)
  const pl = root.worldToLocal(P.clone()), tl = root.worldToLocal(T.clone()), rs = scaleOf(root);
  g.hipDrop = clamp((pl.y - tl.y) * rs, -0.05, 0.2); g.hipFwd = clamp((tl.z - pl.z) * rs, -0.1, 0.1);
  const hd = (B.Head || B.head)?.getWorldPosition(new Vector3());
  g.headUp = hd ? clamp(hd.y - P.y + 0.12, 0.5, 1.0) : 0.8; // (the top of the head over the pelvis)
  return (h._ladGeo = g);
}
/**
 * The knee of a two-bone leg in the ladder's side plane (l along it, o out of it): hip (hl, ho), ankle (al, ao),
 * thigh a, shin b, bent towards the ladder and up. @returns {number} the knee's o
 */
function kneeO(a, b, hl, ho, al, ao) {
  const dl = al - hl, dO = ao - ho, d = Math.hypot(dl, dO);
  if (d < 1e-4) return ho;
  const ul = dl / d, uo = dO / d;
  if (d >= a + b - 1e-4) return ho + uo * a;
  const x = (a * a - b * b + d * d) / (2 * d), hg = Math.sqrt(Math.max(0, a * a - x * x));
  let nl = -uo, no = ul;
  if (nl * 0.25 - no < 0) { nl = -nl; no = -no; }
  return ho + uo * x + no * hg * 0.93; // (the knees point a little apart: a little less of the bend is towards it)
}

/** Share of an approach to a ladder's foot spent walking (the rest: turning to it, hands going up). */
const LEAD_WALK = 0.7;
/** Metres per cycle of the walk clip (an approach's steps). */
const LEAD_STRIDE = 1.4;

/**
 * The walk between the link's end and the ladder's own foot of one leg: {a: share of the leg's progress it takes (0
 * none), segs (its way, world xz), d (its length), stand (the pelvis spot at the ladder's foot), up}.
 */
function leadOf(F, T) {
  const end = T.up ? T.from : T.to, oS = clamp(F.footO, 0.45, 0.55) + 0.08;
  const E = local(F, { x: end.x, y: F.foot.y, z: end.z });
  const at = (o, w) => { const p = atHeight(F, F.foot.y, o, w, new Vector3()); return { x: p.x, z: p.z }; };
  // (the way from the link's end to the ladder's foot: straight when the end is in front of the ladder, else out
  // round its side — the end can lie between the ladder and the wall)
  const pts = [{ x: end.x, z: end.z }];
  if (E.o < 0.15) {
    const side = E.w >= 0 ? 1 : -1, wS = side * Math.max(Math.abs(E.w), F.halfW + 0.35);
    if (Math.abs(wS - E.w) > 0.05) pts.push(at(Math.min(E.o, 0), wS));
    pts.push(at(oS, wS));
  }
  pts.push(at(oS, 0));
  const segs = [];
  let d = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); if (l > 1e-3) { segs.push({ a: pts[i - 1], b: pts[i], l, d0: d }); d += l; } }
  if (d < 0.25 || !(T.len > 0.1)) return { a: 0 };
  const a = Math.min(0.55, (d + 0.5) / (d + 0.5 + T.len));
  return { a, segs, d, stand: pts.at(-1), up: T.up };
}

/** Where on an approach's way (lead.segs) a distance along it is, and which way it is walked there. */
function leadAt(L, dist) {
  let sg = L.segs[L.segs.length - 1];
  for (const x of L.segs) if (dist <= x.d0 + x.l) { sg = x; break; }
  const t = clamp((dist - sg.d0) / sg.l, 0, 1), dx = sg.b.x - sg.a.x, dz = sg.b.z - sg.a.z;
  // (towards the ladder's foot on the way up, away from it on the way down)
  return { x: sg.a.x + dx * t, z: sg.a.z + dz * t, yaw: L.up ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz) };
}

/** Shoulder → wrist length of an arm (its joints' world distances). */
function armLength(B, s) {
  const ua = B['upperarm_' + s].getWorldPosition(new Vector3()), la = B['lowerarm_' + s].getWorldPosition(new Vector3()), hd = B['hand_' + s].getWorldPosition(new Vector3());
  return ua.distanceTo(la) + la.distanceTo(hd);
}
function scaleOf(b) { b.getWorldScale(_v); return (Math.abs(_v.x) + Math.abs(_v.y) + Math.abs(_v.z)) / 3; }

/** The foot rungs of a frame (indices into F.rungs from the lowest ≥ 0.15 m up to the top a foot steps from). */
function footRungs(F) {
  if (F._feet) return F._feet;
  const top = F.over > F.H + 0.25 ? F.over - 0.2 : F.H - 0.12;
  F._feet = F.rungs.map((v, i) => [v, i]).filter(([v]) => v >= 0.15 && v <= top).map(([, i]) => i);
  return F._feet;
}

/** World point at height y (m, world) and o out of the ladder (frame), lateral w. */
function atHeight(F, y, o, w, out) {
  const l = (y - F.foot.y - o * F.ox.y) / F.ax.y;
  return ladderPoint(F, l, o, w, out);
}

/** The chest: halfway between the top of the spine and the neck (the sternum's height). */
export function chestPoint(B, out = new Vector3()) {
  const a = (B.spine_03 || B.spine_02).getWorldPosition(out);
  return B.neck_01 ? a.lerp(B.neck_01.getWorldPosition(_w), 0.5) : a;
}

function setWorldQuat(b, q) { b.parent.getWorldQuaternion(_pq); b.quaternion.copy(_pq.invert().multiply(q)); b.updateMatrixWorld(true); }

/** Turn a two-bone chain about its root → end axis so the middle joint points towards `pole` (world direction). */
function poleTurn(a, b, c, pole) {
  const pa = a.getWorldPosition(new Vector3()), pc = c.getWorldPosition(new Vector3()), pb = b.getWorldPosition(new Vector3());
  const ax = pc.sub(pa).normalize();
  const kv = pb.sub(pa); kv.addScaledVector(ax, -kv.dot(ax));
  const pv = pole.clone(); pv.addScaledVector(ax, -pv.dot(ax));
  if (kv.lengthSq() < 1e-8 || pv.lengthSq() < 1e-8) return;
  kv.normalize(); pv.normalize();
  const ang = Math.atan2(_w.crossVectors(kv, pv).dot(ax), kv.dot(pv));
  a.getWorldQuaternion(_q2);
  setWorldQuat(a, _q.setFromAxisAngle(ax, ang).multiply(_q2));
}

/**
 * Per-frame ladder pose for one UnitModel. @param {import('./unit-model.js').UnitModel} m @param {number} dt
 * @param {import('./pose-blend.js').BoneGuard} guard @returns {boolean} bones written
 */
export function ladderClimb(m, dt, guard) {
  const h = m.real?.inner, B = h?.bones, u = m.unit;
  if (!B?.pelvis || !B.thigh_l || !B.calf_l || !B.foot_l || !B.ball_l || !B.thigh_r || !B.calf_r || !B.foot_r || !B.ball_r
    || !B.upperarm_l || !B.lowerarm_l || !B.hand_l || !B.upperarm_r || !B.lowerarm_r || !B.hand_r) return false;
  const C = LADDER.on && u?.alive !== false && u?._ladder && steepLadder(u._ladder.link) ? u._ladder : null;
  let S = m._lc;
  if (!S) { if (!C) return false; S = m._lc = { w: 0, C: null, F: null, y: null, o: null, vy: 0, vo: 0, boost: 0, gun: null, state: null }; }
  if (C) { S.C = C; S.F = ladderFrame(u.world, C.link); }
  if (dt > 0) S.w = clamp(S.w + (C ? dt : -dt) / LADDER.fade, 0, 1);
  const enemyGun = !m.player ? h.weapon : null;
  if ((!C && S.w <= 0) || !S.F) {
    if (S.gun && enemyGun) enemyGun.visible = S.gun.visible;
    m._lc = null;
    return false;
  }
  if (enemyGun && C) { S.gun ||= { visible: enemyGun.visible }; enemyGun.visible = false; }
  const F = S.F, T = S.C, root = m.root, W8 = smooth(S.w);
  const P = clamp(T.len > 1e-6 ? (T.up ? T.s / T.len : 1 - T.s / T.len) : 1, 0, 1);
  // the ladder's own foot away from the link's end (a ladder built clear of a ruin's beams, beside a canopy): he walks
  // to it first — and from it back to the link's end after climbing down — the climb itself that much quicker
  if (S.legC !== T) { S.legC = T; S.lead = leadOf(F, T); if (S.lead.a > 0 && T.up) S.y = null; }
  const a = S.lead.a, g = a > 0 && P < a ? P / a : null;
  const Pv = a > 0 ? (g != null ? 0 : (P - a) / (1 - a)) : P;
  // he faces the ladder (the sim turns at its own rate at the start of a descent) — walking to / from its foot, the
  // way he walks, turning to it as he gets there
  const yaw = Math.atan2(F.fx, F.fz);
  const turn = g == null ? 1 : smooth(clamp((g - LEAD_WALK) / (1 - LEAD_WALK), 0, 1));
  let yawT = yaw, spot = null;
  if (turn < 1) {
    spot = leadAt(S.lead, smooth(clamp(g / LEAD_WALK, 0, 1)) * S.lead.d);
    let dy = yaw - spot.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yawT = spot.yaw + dy * turn;
  }
  let dyaw = yawT - root.rotation.y; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  root.rotation.y += dyaw * W8;
  root.updateMatrixWorld(true);
  const before = W8 < 1 ? capturePose(m) : null;
  /** The climb pose at progress P (0 the ground stance at the foot, 1 off at the top). */
  const climbPose = (P) => {
    // a still base pose (the idle clip's first frame): nothing of the walk / mantle under it shows
    const idle = clipPose(m, 'idle', 0);
    if (idle) mixPose(m, idle, 1, guard);
    if (!h._boneTop) { let b = B.pelvis; while (b.parent && b.parent !== h.object) b = b.parent; h._boneTop = b; }
    h.object.updateWorldMatrix(true, false); h._boneTop.updateMatrixWorld(true);
    const G = bodyGeo(h, B, root);
    const up = new Vector3(0, 1, 0), fdir = new Vector3(F.fx, 0, F.fz), wdir = ladderDir(F, 'w', new Vector3()), odir = ladderDir(F, 'o', new Vector3());

    // the schedule: phase q from the sim's progress
    const feetR = footRungs(F), n = feetR.length, sch = ladderSchedule(n), q = lerp(sch.q0, sch.q1, P);
    const sp = n > 1 ? (F.rungs[feetR[n - 1]] - F.rungs[feetR[0]]) / (n - 1) : 0.3;
    const reach = Math.sqrt(Math.max(0.05, (0.97 * G.leg) ** 2 - (LADDER.pelvisOut - G.ankleOut) ** 2));
    const hipClimb = G.ballH + G.ankleRise + reach - sp / 2;
    const over = F.over > F.H + 0.25 ? F.over : null;
    /** A foot level's spot: ball target, support height, the pelvis's way out, its hip height. */
    const spot = (L, side) => {
      const w = (side === 'l' ? 1 : -1) * LADDER.footW;
      // (on the ground at the foot end — a step up to the ladder when that end lies well out from it — or on the deck
      // past the top end's way in)
      if (L <= 0) {
        const o = clamp(F.footO, 0.45, 0.55), p = atHeight(F, F.foot.y, o, w, new Vector3());
        p.y = F.foot.y + G.ballH;
        return { p, ys: F.foot.y, zo: o + 0.08, hip: G.hipStand, zone: 'ground' };
      }
      if (L > n) {
        const o = clamp(F.topO, -0.7, -0.25), p = atHeight(F, F.top.y, o, w, new Vector3());
        p.y = F.top.y + G.ballH;
        return { p, ys: F.top.y, zo: o - 0.05, hip: Math.max(0.45, Math.min(G.hipStand, (F.topRoom ?? Infinity) - G.headUp - 0.08)), zone: 'deck' };
      }
      const v = F.rungs[feetR[L - 1]], c = ladderPoint(F, v * Math.hypot(1, F.k), 0.012, w, new Vector3());
      const ys = c.y + F.rr;
      c.y = ys + G.ballH;
      return { p: c, ys, zo: LADDER.pelvisOut, hip: hipClimb, zone: 'rung' };
    };
    const feet = {}, levels = { r: footLevel(q, 'A', sch.D), l: footLevel(q, 'B', sch.D) };
    for (const s of SIDES) {
      const { a, b, t } = levels[s], A = spot(a, s), Bt = spot(b, s);
      const p = A.p.clone().lerp(Bt.p, t);
      const moving = a !== b && t > 0 && t < 1, bell = moving ? Math.sin(Math.PI * t) : 0;
      if (moving) {
        // swung out round the rung it leaves (and up over a wall's top on the way to / from the deck)
        p.addScaledVector(odir, LADDER.swingOut * bell);
        const deckY = over ?? F.top.y;
        if (A.zone === 'deck' || Bt.zone === 'deck') p.y = Math.max(p.y, lerp(p.y, deckY + 0.3, Math.min(1, bell * 1.6)));
        else p.y += 0.05 * bell;
      }
      feet[s] = { p, ys: lerp(A.ys, Bt.ys, t), zo: lerp(A.zo, Bt.zo, t), hip: lerp(A.hip, Bt.hip, t), zone: moving ? 'moving' : Bt.zone, from: A.zone, to: Bt.zone, t };
    }
    // pelvis: over its feet's supports, out as far as they take it (a raised knee pushes it further), eased
    let yT = (feet.l.ys + feet.l.hip + feet.r.ys + feet.r.hip) / 2;
    let oT = (feet.l.zo + feet.r.zo) / 2 + S.boost;
    // (a foot stepping over onto the deck — or back off it — has the body up over the top, easing in and out with it)
    for (const f of [feet.l, feet.r]) {
      if (f.zone !== 'moving' || (f.from !== 'deck' && f.to !== 'deck')) continue;
      // (ducking under a lintel over the way off)
      const up = Math.min((over ?? F.top.y) + (over ? 0.3 : G.hipStand * 0.9), F.top.y + (F.topRoom ?? Infinity) - G.headUp - 0.08);
      yT = Math.max(yT, lerp(yT, up, Math.sin(Math.PI * f.t)));
    }
    // (knees out of the rung line: a foot high on its rung bends the knee in towards the ladder — the pelvis out as far
    // as that takes, up to what the legs reach)
    const nk = Math.hypot(1, F.k);
    const kneeNeed = (o, y) => {
      let need = 0;
      const hl = (y - G.hipDrop - F.foot.y - o * F.ox.y) / F.ax.y, ho = o - G.hipFwd; // (the body faces the ladder: its forward is -o)
      for (const s of SIDES) {
        const f = feet[s];
        // (a foot on a rung or stepping to / from one — and, while the other is still on the rungs, the one on the deck:
        // its knee crosses over the top rungs)
        const other = feet[s === 'l' ? 'r' : 'l'], otherOn = other.zone === 'rung' || (other.zone === 'moving' && (other.from === 'rung' || other.to === 'rung'));
        if (f.zone !== 'rung' && !(f.zone === 'moving' && (f.from === 'rung' || f.to === 'rung')) && !(otherOn && (f.zone === 'deck' || f.from === 'deck' || f.to === 'deck'))) continue;
        const lp = local(F, f.p), ka = kneeO(G.thigh, G.shin, hl, ho, lp.l + G.ankleRise * nk, lp.o + G.ankleOut);
        need = Math.max(need, Math.max(LADDER.kneeOut, (F.stileFront ?? 0) + 0.055) - ka);
      }
      return need;
    };
    for (let i = 0; i < 4; i++) { const k = kneeNeed(oT, yT); if (k <= 0.002) break; oT += k; }
    // (never higher than a planted foot's leg reaches)
    let cap = Infinity;
    for (const s of SIDES) {
      const f = feet[s];
      if (f.zone === 'moving') continue;
      const fo = f.zone === 'rung' ? G.ankleOut : f.zone === 'ground' ? f.zo - 0.08 : f.zo + 0.05;
      const dO = (S.o ?? oT) - fo;
      cap = Math.min(cap, f.ys + G.ballH + G.ankleRise + Math.sqrt(Math.max(0.01, (0.95 * G.leg) ** 2 - dO * dO)));
    }
    yT = Math.min(yT, cap);
    // (no further out than the room in front of the rungs allows: a caged ladder's hoops behind him)
    // (the room about his hips' height: a cage's hoops, a floor's edge — not the rubble by the foot when he is up)
  const vP = (S.y ?? yT) - F.foot.y;
  const oRoom = Math.max(Math.min(LADDER.outMax, roomAt(F, vP - 0.3, vP + 0.4) - 0.08), (feet.l.zo + feet.r.zo) / 2);
    oT = Math.min(oT, oRoom);
    // (nor further out than a planted foot on a rung reaches: a raised knee's room is taken from what the legs allow)
    let oReach = Infinity;
    for (const s of SIDES) {
      const f = feet[s];
      if (f.zone !== 'rung') continue;
      const dy = (S.y ?? yT) - (f.ys + G.ballH + G.ankleRise);
      oReach = Math.min(oReach, Math.max(LADDER.pelvisOut, G.ankleOut + Math.sqrt(Math.max(0, (0.95 * G.leg) ** 2 - dy * dy))));
    }
    oT = Math.min(oT, oReach);
    if (S.y == null) { S.y = yT; S.o = oT; S.vy = 0; S.vo = 0; }
    if (dt > 0) {
      const om = LADDER.spring, k = Math.max(1, Math.ceil(dt * 240)), hh = dt / k;
      for (let i = 0; i < k; i++) {
        S.vy += (om * om * (yT - S.y) - 2 * om * S.vy) * hh; S.y += S.vy * hh;
        S.vo += (om * om * (oT - S.o) - 2 * om * S.vo) * hh; S.o += S.vo * hh;
      }
      S.boost = Math.max(0, S.boost - dt * 0.3);
    }
    if (S.y > cap) { S.y = cap; S.vy = Math.min(0, S.vy); }
    // (and the knees out of the rung line this very frame, the spring notwithstanding)
    for (let i = 0; i < 3; i++) {
      const k = kneeNeed(S.o, S.y);
      const lim = Math.min(oReach, oRoom);
      if (k <= 0.002 || S.o >= lim) break;
      S.o = Math.min(lim, S.o + k); S.vo = Math.max(0, S.vo);
    }
    guard?.touch(B.pelvis);
    const pel = atHeight(F, S.y, S.o, 0, new Vector3());
    B.pelvis.position.copy(B.pelvis.parent.worldToLocal(pel));
    B.pelvis.updateMatrixWorld(true);
    // square to the ladder: the idle stance's turn out of the hips and the shoulders (a hip, a shoulder forward would
    // bring that knee, that arm into the rungs)
    const square = (bone, a, b) => {
      if (!bone || !a || !b) return;
      const d = b.getWorldPosition(new Vector3()).sub(a.getWorldPosition(new Vector3()));
      if (d.x * d.x + d.z * d.z < 1e-6) return;
      const ang = Math.atan2(d.z * wdir.x - d.x * wdir.z, d.x * wdir.x + d.z * wdir.z);
      if (Math.abs(ang) < 1e-3) return;
      guard?.touch(bone);
      bone.getWorldQuaternion(_q2);
      setWorldQuat(bone, _q.setFromAxisAngle(up, ang).multiply(_q2));
    };
    square(B.pelvis, B.thigh_r, B.thigh_l);
    square(B.spine_02 || B.spine_01, B.upperarm_r, B.upperarm_l);
    // how much he hangs on the rungs (both feet on them) — the lean and the head follow it
    const onRungs = SIDES.reduce((a, s) => a + (feet[s].zone === 'rung' || feet[s].zone === 'moving' && feet[s].from !== 'ground' && feet[s].to !== 'ground' && feet[s].from !== 'deck' && feet[s].to !== 'deck' ? 0.5 : feet[s].zone === 'moving' ? 0.25 : 0), 0);
    // chest in to its distance off the rung line (the spine leaning in), the neck back up, the head up the way he goes
    if (B.spine_01 && (B.spine_03 || B.spine_02)) {
      const cp = chestPoint(B), c0 = B.spine_01.getWorldPosition(new Vector3());
      const hC = Math.max(0.2, cp.y - c0.y), dO = outOf(F, cp) - LADDER.chestOut;
      // (leaning in already from the ground: the hands go up to the rungs at arm's length)
      const lean = clamp(Math.atan2(dO, hC), -8 * DEG, LADDER.leanMax + Math.atan(Math.max(0, F.k))) * Math.max(onRungs, 0.6);
      const neck = B.neck_01, head = B.Head || B.head;
      const turn = (b, a) => { if (!b || !a) return; guard?.touch(b); b.getWorldQuaternion(_q2); setWorldQuat(b, _q.setFromAxisAngle(wdir, a).multiply(_q2)); };
      turn(B.spine_01, lean * 0.65); turn(B.spine_02, lean * 0.35);
      if (onRungs > 0) {
        // the upper back straightens: his head stays up over his shoulders, LADDER.headOut off the rungs …
        const up3 = B.spine_03 || B.spine_02, hp = head?.getWorldPosition(new Vector3());
        if (hp) {
          const dh = LADDER.headOut - outOf(F, hp), r = Math.max(0.2, hp.distanceTo(up3.getWorldPosition(new Vector3())));
          if (dh > 0.005) turn(up3, -Math.asin(clamp(dh / r, 0, 0.6)) * onRungs);
        }
        // … the chest no further out than LADDER.chestMax for it (leant again at the base of the spine)
        // (again while it is still out: leant far over, a turn at the base of the spine brings the chest in less)
        let tot = 0;
        for (let i = 0; i < 3; i++) {
          const d2 = outOf(F, chestPoint(B)) - LADDER.chestMax;
          if (d2 <= 0.003) break;
          const a = Math.min(clamp(Math.atan2(d2, hC), 0, 0.45), 0.45 + Math.atan(Math.max(0, F.k)) - tot);
          if (a <= 0) break;
          turn(B.spine_01, a * onRungs); tot += a;
        }
      }
      // (the neck back up: the head over the shoulders, off the rungs — what the upper back left of it)
      const hp2 = head?.getWorldPosition(new Vector3());
      if (neck && hp2) {
        const dn = LADDER.headOut - outOf(F, hp2), rn = Math.max(0.08, hp2.distanceTo(neck.getWorldPosition(new Vector3())));
        turn(neck, -(Math.max(lean * 0.3, dn > 0 ? Math.asin(clamp(dn / rn, 0, 0.75)) : 0)) * onRungs);
      } else turn(neck, -lean * 0.3 * onRungs);
      turn(head, ((T.up ? -20 : 18) * DEG) * onRungs);
    }
    // legs: the ball of each foot on its spot, the heel a little below it, knees forward and a little apart
    const footState = {};
    for (const s of SIDES) {
      const side = s === 'l' ? 1 : -1, f = feet[s];
      const thigh = B['thigh_' + s], calf = B['calf_' + s], foot = B['foot_' + s], ball = B['ball_' + s];
      guard?.touch(thigh); guard?.touch(calf); guard?.touch(foot);
      foot.getWorldQuaternion(_q2);
      const Qd = _q.setFromAxisAngle(wdir, -LADDER.heel * (f.zone === 'ground' || f.zone === 'deck' ? 0 : 1)).multiply(_q2).clone();
      const D0 = ball.getWorldPosition(new Vector3()).sub(foot.getWorldPosition(new Vector3()));
      const D = D0.applyQuaternion(_q2.clone().invert()).applyQuaternion(Qd);
      const ank = f.p.clone().sub(D);
      for (let i = 0; i < 2; i++) {
        twoBoneIK(thigh, calf, foot, ank);
        // (knees in through the gap at the top: a railing either side of the ladder's way onto the deck)
        let splay = f.from === 'deck' || f.to === 'deck' || f.zone === 'deck' ? 0.05 : LADDER.splay;
        poleTurn(thigh, calf, foot, fdir.clone().addScaledVector(up, 0.25).addScaledVector(wdir, side * splay));
        // (knees out — but inside the stiles: a knee splayed past one would go into it)
        for (let j = 0; j < 2; j++) {
          const kw = Math.abs(local(F, calf.getWorldPosition(new Vector3())).w), lim = F.halfW - 0.085;
          if (kw <= lim || splay <= -0.3) break;
          splay -= (kw - lim) * 4;
          poleTurn(thigh, calf, foot, fdir.clone().addScaledVector(up, 0.25).addScaledVector(wdir, side * splay));
        }
      }
      setWorldQuat(foot, Qd);
      // (a knee near a rung or a stile — or behind the rung line — has the body further out a moment)
      const K = local(F, calf.getWorldPosition(new Vector3()));
      let near = K.o + 0.04;
      for (const v of F.rungs) near = Math.min(near, Math.hypot(K.l - v * Math.hypot(1, F.k), K.o));
      if (Math.abs(K.w) > F.halfW - 0.08) near = Math.min(near, Math.hypot(Math.abs(K.w) - F.halfW, K.o));
      if (onRungs > 0 && near < LADDER.kneeMin) S.boost = Math.min(0.2, S.boost + (LADDER.kneeMin - near) * 0.8);
      footState[s] = { zone: f.zone, from: f.from, to: f.to, ball: f.p };
    }
    // arms: the knuckles on a rung over the foot of the other diagonal (or on a stile past the top rung), thumbs in;
    // let go once that foot is on the deck
    const handState = {};
    const rungsAll = F.rungs, nn = Math.hypot(1, F.k);
    const grip = (L, side) => {
      const fy = L <= 0 ? 0 : L > n ? F.H : F.rungs[feetR[L - 1]];
      if (L > n) return null;
      const want = fy + LADDER.handUp;
      let best = -1;
      for (let i = 0; i < rungsAll.length; i++) if (rungsAll[i] <= want + 0.15 && (best < 0 || Math.abs(rungsAll[i] - want) < Math.abs(rungsAll[best] - want))) best = i;
      const lastV = rungsAll.at(-1) ?? 0;
      if (best >= 0 && !(want > lastV + 0.2 && rungsAll[best] === lastV)) {
        const p = ladderPoint(F, rungsAll[best] * nn, 0, side * LADDER.handW, new Vector3());
        p.y += F.rr + 0.012;
        return { p, kind: 'rung' };
      }
      // past the top rung: a stile, as high as it goes
      const rTop = F.railTops?.[side > 0 ? 1 : 0] || F.railTop;
      const v = Math.min(want, rTop - 0.1);
      const p = ladderPoint(F, v * nn, 0.035, side * F.halfW, new Vector3()); // (knuckles round its front)
      return { p, kind: 'stile' };
    };
    for (const s of SIDES) {
      const side = s === 'l' ? 1 : -1, pair = s === 'l' ? levels.r : levels.l; // left hand with the right foot
      const ua = B['upperarm_' + s], la = B['lowerarm_' + s], hd = B['hand_' + s], mid = B['middle_01_' + s];
      const g0 = grip(pair.a, side), g1 = grip(pair.b, side);
      let g = null, wt = 1;
      if (g0 && g1) {
        const p = g0.p.clone().lerp(g1.p, pair.t);
        const mv = pair.a !== pair.b && pair.t > 0 && pair.t < 1;
        if (mv) p.addScaledVector(odir, 0.08 * Math.sin(Math.PI * pair.t));
        g = { p, kind: mv ? 'moving' : g1.kind, to: g1.kind };
      } else if (g0 || g1) { // letting go (stepping onto the deck) / taking hold (stepping off it)
        const gg = g0 || g1; wt = g0 ? 1 - pair.t : pair.t;
        g = { p: gg.p, kind: wt > 0.999 ? gg.kind : 'moving', to: gg.kind };
      }
      if (!g || wt <= 0) { handState[s] = { kind: 'free' }; continue; }
      if ((g.to ?? g.kind) === 'stile') {
        // (a stile is held where the arm reaches it: the hand slides along it as he goes over the top)
        const sh = ua.getWorldPosition(new Vector3()), arm = armLength(B, s) * 0.93; // (the knuckles: a hand's breadth past the wrist)
        const st = ladderPoint(F, 0, 0.035, side * F.halfW, new Vector3()), axis = ladderDir(F, 'l', new Vector3());
        const along = (v) => st.clone().addScaledVector(axis, v);
        let lo = 0, hi = ((F.railTops?.[side > 0 ? 1 : 0] || F.railTop) - 0.1) * Math.hypot(1, F.k);
        const lNow = local(F, g.p).l;
        const ok = (l) => along(l).distanceTo(sh) <= arm;
        if (!ok(lNow)) {
          // the reachable stretch of the stile nearest the wanted grip (a few steps of bisection from the shoulder's level)
          const lS = clamp(local(F, sh).l, lo, hi);
          if (ok(lS)) {
            let a = lS, b = lNow;
            for (let i = 0; i < 12; i++) { const mid = (a + b) / 2; if (ok(mid)) a = mid; else b = mid; }
            g.p.copy(along(a));
          } else g.p.copy(along(lS));
        }
        // (out of reach even so — he is over the top, the stile behind him: that hand lets go)
        const miss = along(local(F, g.p).l).distanceTo(sh) - arm;
        if (miss > 0) { wt *= clamp(1 - miss / 0.12, 0, 1); if (wt < 0.999) g.kind = 'moving'; }
        if (wt <= 0) { handState[s] = { kind: 'free' }; continue; }
      }
      guard?.touch(ua); guard?.touch(la); guard?.touch(hd);
      const q0 = { ua: ua.quaternion.clone(), la: la.quaternion.clone(), hd: hd.quaternion.clone() };
      hd.getWorldQuaternion(_q2);
      const hpos = hd.getWorldPosition(new Vector3()), mpos = mid ? mid.getWorldPosition(new Vector3()) : hpos.clone().addScaledVector(up, -0.08);
      const d0 = mpos.clone().sub(hpos).normalize();
      // fingers over a rung (forward and up over it), round a stile (forward, in); thumbs in (a rung) / up (a stile)
      const stile = (g.to ?? g.kind) === 'stile';
      // (round a stile from the shoulder's side: over the top he holds it behind him)
      let dF;
      if (stile) { dF = g.p.clone().sub(ua.getWorldPosition(new Vector3())).setY(0); if (dF.lengthSq() < 1e-4) dF.copy(fdir); dF.normalize().addScaledVector(wdir, -side * 0.3).normalize(); }
      else dF = fdir.clone().multiplyScalar(0.75).addScaledVector(up, 0.66).normalize();
      const q1 = new Quaternion().setFromUnitVectors(d0, dF);
      const th = B['thumb_01_' + s];
      let Qd = q1.clone().multiply(_q2);
      if (th) {
        const t0 = th.getWorldPosition(new Vector3()).sub(hpos).applyQuaternion(q1);
        t0.addScaledVector(dF, -t0.dot(dF));
        const tD = (stile ? up.clone() : wdir.clone().multiplyScalar(-side).addScaledVector(up, -0.3)); tD.addScaledVector(dF, -tD.dot(dF));
        if (t0.lengthSq() > 1e-8 && tD.lengthSq() > 1e-8) {
          t0.normalize(); tD.normalize();
          const ang = Math.atan2(_w.crossVectors(t0, tD).dot(dF), t0.dot(tD));
          Qd = new Quaternion().setFromAxisAngle(dF, ang).multiply(Qd);
        }
      }
      const off = mpos.clone().sub(hpos).applyQuaternion(_q2.clone().invert()).applyQuaternion(Qd);
      const wrist = g.p.clone().sub(off);
      for (let i = 0; i < 2; i++) {
        twoBoneIK(ua, la, hd, wrist);
        poleTurn(ua, la, hd, up.clone().multiplyScalar(-1).addScaledVector(wdir, side * 0.8).addScaledVector(odir, 0.4));
      }
      setWorldQuat(hd, Qd);
      if (wt < 1) { // easing between the grip and his own arm
        ua.quaternion.slerpQuaternions(q0.ua, ua.quaternion.clone(), wt); la.quaternion.slerpQuaternions(q0.la, la.quaternion.clone(), wt); hd.quaternion.slerpQuaternions(q0.hd, hd.quaternion.clone(), wt);
        ua.updateMatrixWorld(true);
      }
      handState[s] = { kind: g.kind, to: g.to, grip: g.p, w: wt };
    }
    return { q, n, onRungs, footState, handState };
  };
  if (g != null) {
    // walking between the link's end and the ladder's foot (the climb's ground stance blended in as he turns to it)
    const L = S.lead, gw = clamp(g / LEAD_WALK, 0, 1);
    let at = null;
    if (turn > 0) { climbPose(0); at = capturePose(m); }
    const h0 = root.getWorldPosition(new Vector3()).y;
    const walk = gw < 1 ? clipPose(m, 'walk', Math.round(((gw * L.d) / LEAD_STRIDE % 1) * 48) / 48, true) : null;
    const base = walk || clipPose(m, 'idle', 0);
    if (base) mixPose(m, base, 1, guard);
    h.object.updateWorldMatrix(true, false);
    B.pelvis.updateMatrixWorld(true);
    const pw = B.pelvis.getWorldPosition(new Vector3()), sp = spot || L.stand;
    pw.set(sp.x, F.foot.y + (pw.y - h0), sp.z);
    guard?.touch(B.pelvis);
    B.pelvis.position.copy(B.pelvis.parent.worldToLocal(pw));
    B.pelvis.updateMatrixWorld(true);
    if (at) mixPose(m, at, turn, guard);
    if (before) mixPose(m, before, 1 - W8, guard);
    S.state = { P, q: -1, n: 0, onRungs: 0, lead: g, feet: { l: { zone: 'ground' }, r: { zone: 'ground' } }, hands: { l: { kind: 'free' }, r: { kind: 'free' } }, frame: F };
    return true;
  }
  const { q, n, onRungs, footState, handState } = climbPose(Pv);
  if (before) mixPose(m, before, 1 - W8, guard);
  S.state = { P: Pv, q, n, onRungs, feet: footState, hands: handState, frame: F };
  return true;
}
