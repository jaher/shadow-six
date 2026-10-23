/**
 * Climbing a ladder, view side (user requests 2026-10-07 — the climber slid up the link playing a frozen wall mantle —
 * 2026-10-08: "Commando still too close to vertical ladder when climbing" — and 2026-10-22: "Make sure the ladder
 * climbing looks natural, commando not crossing the ladder / wall"). While Unit._followPath moves a man up or down a
 * ladder link (entities/stair-walk.js ladderTrack: its straight line from end to end, facing it), his body is posed
 * every frame on the ladder actually there (art/ladder-frame.js: the drawn ladder's rung line, rungs and stiles, or
 * the ladder built where none is drawn), over whatever clip plays:
 *  - he hangs off it as a climber does: pelvis LADDER.pelvisOut out of the rung line, chest LADDER.chestOut (the
 *    spine leaning in), head up, knees never closer than LADDER.kneeMin (the pelvis goes further out when a raised knee
 *    would come up into the rungs);
 *  - feet: the ball of each foot on a rung (heel free, a little below it), either side of the middle; they leapfrog —
 *    a foot moves up two rungs past the other, swinging out round the rung it leaves — with the opposite hand (a
 *    diagonal climb); hands grip the rungs about 1.4 m above their foot, knuckles over the rung, thumbs in; past the
 *    top rung they take the stiles;
 *  - the link's ends are where the sim stands him, the ladder is where it is drawn: he walks from the foot end to the
 *    ladder's own foot and from its head to the top end (and back the other way going down) — the leg's progress
 *    shared out between the walks and the climb, so the body stands at the link's end at both ends of the leg and the
 *    clip under it takes over where it is; a link end in the ladder's way (its foot end behind the rungs, against the
 *    wall: M2's camp ladder) or against the wall at the top is drawn clear of it (endShift: any man standing there);
 *  - getting on: from the ladder's foot (both feet on the ground, hands up on the rungs), the first foot steps onto
 *    the lowest rung; getting off at the top: the feet step from the top rungs onto the deck; over a wall standing well
 *    above the deck (M2's palisade over its walk: LADDER.vaultH) both feet come up onto the top rung, a leg at a time
 *    swings over its top, he sits on it and comes down onto the walk on its far side (the vault); going down replays
 *    it backwards (his back to the drop);
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
import { climbLeg, holdO } from './wall-climb.js';

const DEG = Math.PI / 180;
/**
 * pelvisOut / chestOut: m out of the rung line on the rungs (the chest: halfway between the top of the spine and the
 * neck; chestMax the furthest it goes when the upper back straightens); headOut: m the head keeps off it; kneeMin: m a
 * knee keeps off the rungs and stiles, centre to centre; kneeOut: m the knee joint stays out of the rung line (the
 * pelvis goes out as far as a foot high on a rung bends the knee in); footW /
 * handW: m either side of the middle; handUp: m a hand grips above its foot; heel: rad the heel hangs below the ball;
 * swingOut: m a moving foot / hand swings out round the rung; fade: s in / out; spring: rad/s of the pelvis follow;
 * leanMax: rad of spine lean; splay: knees pointing out (sideways share of the knee's direction); outMax: m the pelvis
 * goes out at most on the rungs (less where the room in front of them is less: a cage's hoops); vaultH: m a wall's top
 * stands over the deck from which he no longer steps over it but vaults it (sits on it, comes down on the far side);
 * endR: m round a shifted link end where a man is drawn shifted (endShift);
 * clearIn: m the climber keeps off a wall's inner face on the deck; on: kill switch.
 */
export const LADDER = { on: true, pelvisOut: 0.5, chestOut: 0.33, chestMax: 0.385, headOut: 0.3, kneeMin: 0.085, kneeOut: 0.068, footW: 0.1, handW: 0.16,
  handUp: 1.25, heel: 20 * DEG, swingOut: 0.12, fade: 0.25, spring: 22, leanMax: 40 * DEG, splay: 0.5, outMax: 0.66, vaultH: 0.6,
  endR: 1.3, clearIn: 0.34, endIn: 0.52 };
/**
 * The same on a wall's face (art/wall-climb.js: no ladder — the hold line is FACE.holdOff in front of the face): the
 * body closer in, hands flat on it a little wider, knees just off it; standO: m out of the hold line his feet stand
 * at its foot (a ladder: LADDER.standO, within reach of its first rung).
 */
export const WALL = { ...LADDER, pelvisOut: 0.38, chestOut: 0.27, chestMax: 0.31, headOut: 0.22, kneeOut: 0.03, kneeMin: 0.06, footW: 0.12,
  handW: 0.2, handUp: 1.2, swingOut: 0.09, outMax: 0.5 };
LADDER.standO = [0.45, 0.55]; WALL.standO = [0.3, 0.36];
/** m the knuckles of a hand flat on a face stand off the hold line (the face is FACE.holdOff behind it). */
const FACE_KNUCKLE = 0.035;
/** m the ball of a foot on a face stands off the hold line (the toes, ~8 cm past it, just touch the face). */
const FACE_BALL = 0.035;
/** The pose constants of a frame: a ladder's or a face's. */
const kOf = (F) => (F.face ? WALL : LADDER);
const SIDES = ['l', 'r'];
const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _pq = new Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
/** The point a share t (0..1) of the way along a polyline of world points (by length). */
const along = (way, t) => {
  const len = [0]; for (let i = 1; i < way.length; i++) len.push(len[i - 1] + way[i].distanceTo(way[i - 1]));
  const at = clamp(t, 0, 1) * len.at(-1);
  let i = 1; while (i < way.length - 1 && len[i] < at) i++;
  return way[i - 1].clone().lerp(way[i], clamp((at - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]), 0, 1));
};
/** Position of a key-framed track [[u, value], …] at u (smoothstep between keys). */
const keyed = (K, u) => {
  if (u <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (u <= K[i][0]) return lerp(K[i - 1][1], K[i][1], smooth((u - K[i - 1][0]) / (K[i][0] - K[i - 1][0])));
  return K[K.length - 1][1];
};

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
 * −1 → 0, then 2m+1 → 2m+3 while q goes 2m+1 → 2m+2; both end on level D (the deck; the top rung `n` before a vault).
 * @returns {{q0:number, q1:number, D:number}}
 */
export function ladderSchedule(n, D = n + 1) {
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

/** Does this frame's top have a wall over the deck he vaults rather than steps over? */
// (only over a clear top — ladder-frame.js F.topClear: a crenel's merlons, an eave over it are stepped through)
export const vaults = (F) => F.topClear !== false && (F.over ?? F.H) - F.H > LADDER.vaultH;

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

/** Share of a walk between a link's end and the ladder spent walking (the rest: turning to / from it, hands going up). */
const LEAD_WALK = 0.7;
/** Metres per cycle of the walk clip (an approach's steps). */
const LEAD_STRIDE = 1.4;
/** Natural paces the leg's time is shared out by: walking (m/s), a foot's move up the rungs (s), a vault, a step off (s). */
const LEAD_PACE = 1.25, CLIMB_MOVE = 0.36, VAULT_S = 1.5, STEP_S = 0.9;
/** Fastest the drawn body turns in the pose (rad/s, the sim's own turn rate CONFIG.units.turnRate is 9.4). */
const YAW_RATE = 9;

/** The ladder's stand spots: o (out of the rung line) of the pelvis at its foot; o of the feet on the deck. */
function footStandO(F) { const K = kOf(F); return clamp(F.footO, K.standO[0], K.standO[1]) + 0.08; }
function deckFeetO(F) {
  let o = clamp(F.topO, -0.7, -0.25);
  // (clear of a wall's inner face behind the top: a palisade over its walk — he comes down on the walk, not into it)
  if (F.inner != null) o = Math.min(o, F.inner - LADDER.clearIn + 0.05);
  // (the link's end a short way on: there, not a step short of it — a walk of a few cm started with the trailing boot
  // back in the parapet behind him, M20's L_in)
  if (F.topO < o && o - F.topO < 0.45) o = F.topO;
  return o;
}

/**
 * Where a man standing at a ladder link's end is drawn instead (world dx, dz from it), or null: the foot end in the
 * ladder's way (behind or between its rungs, against the wall it leans on: M2's camp ladder) — out in front of it;
 * the top end against the inner face of a wall over the deck — off it. Cached on the frame.
 * @param {object} F ladder frame @param {'foot'|'top'} end @returns {{x:number, z:number}|null}
 */
export function endShift(F, end) {
  const key = end === 'top' ? '_shiftT' : '_shiftF';
  if (F[key] !== undefined) return F[key];
  let out = null;
  if (end === 'foot') {
    const E = local(F, { x: F.foot.x, y: F.foot.y, z: F.foot.z }), oS = footStandO(F) - 0.04;
    if (E.o < oS - 0.05 && Math.abs(E.w) < F.halfW + 0.35) {
      const p = atHeight(F, F.foot.y, oS, E.w, new Vector3()), q = atHeight(F, F.foot.y, E.o, E.w, new Vector3());
      out = { x: p.x - q.x, z: p.z - q.z };
    }
  } else if (F.inner != null && !F.midTop) {
    // (LADDER.endIn: a stride's length off it — standing there he turns and walks off; at clearIn alone a boot of his
    // first stride went back into M2's palisade)
    const E = local(F, { x: F.top.x, y: F.top.y, z: F.top.z }), oT = F.inner - LADDER.endIn;
    if (E.o > oT + 0.03) {
      const p = atHeight(F, F.top.y, oT, E.w, new Vector3()), q = atHeight(F, F.top.y, E.o, E.w, new Vector3());
      out = { x: p.x - q.x, z: p.z - q.z };
    }
  }
  return (F[key] = out);
}

/**
 * The shift (world dx, dz) a man at (x, y, z) on his feet near a shifted ladder link end is drawn with (endShift,
 * eased out over LADDER.endR m from the end), or null. `world.ladderFrames` holds the measured frames.
 */
export function ladderEndShift(world, x, y, z) {
  const frames = shiftFrames(world);
  if (!frames.length) return null;
  let dx = 0, dz = 0, any = false;
  for (const F of frames) {
    for (const end of ['foot', 'top']) {
      if (end === 'top' && F.midTop) continue; // (a climb over a wall: the top of its first face is no link's end)
      const e = end === 'foot' ? F.foot : F.top, d = Math.hypot(x - e.x, z - e.z);
      if (d >= LADDER.endR || Math.abs((y ?? 0) - e.y) > 0.6) continue;
      const s = endShift(F, end);
      if (!s) continue;
      const k = smooth(1 - d / LADDER.endR);
      dx += s.x * k; dz += s.z * k; any = true;
    }
  }
  return any ? { x: dx, z: dz } : null;
}

/** The frames whose link ends may be shifted: every measured ladder, every wall climb's face (one way round). */
function shiftFrames(world) {
  const L = world?.ladderFrames, C = world?.climbFrames;
  if (world?._shiftFr && world._shiftFr.L === L && world._shiftFr.C === C) return world._shiftFr.list;
  const list = [...(L?.values?.() || [])];
  if (C) for (const [k, P] of C) if (k.endsWith(':ab')) for (const sg of P.segs || []) list.push(sg.F);
  if (world) world._shiftFr = { L, C, list };
  return list;
}

/**
 * The walk between a link's end and the ladder of one leg, at its foot (the ladder's own foot) or its top (the deck
 * spot past its head): {a: share of the leg's progress it takes (0 none), segs (its way, world xz, from the link's
 * end), d (its length), stand (the spot at the ladder), toward (walked from the end towards the ladder)}.
 */
function leadOf(F, T, end) {
  const top = end === 'top';
  const link = top ? (T.up ? T.to : T.from) : (T.up ? T.from : T.to);
  const sh = endShift(F, end), y = top ? F.top.y : F.foot.y;
  const start = { x: link.x + (sh?.x ?? 0), z: link.z + (sh?.z ?? 0) };
  const at = (o, w) => { const p = atHeight(F, y, o, w, new Vector3()); return { x: p.x, z: p.z }; };
  const pts = [start];
  if (!top) {
    // (the way from the link's end to the ladder's foot: straight when the end is in front of the ladder, else out
    // round its side — the end can lie between the ladder and the wall)
    const oS = footStandO(F), E = local(F, { x: start.x, y, z: start.z });
    if (E.o < 0.15) {
      const side = E.w >= 0 ? 1 : -1, wS = side * Math.max(Math.abs(E.w), F.halfW + 0.35);
      if (Math.abs(wS - E.w) > 0.05) pts.push(at(Math.min(E.o, 0), wS));
      pts.push(at(oS, wS));
    }
    pts.push(at(oS, 0));
  } else pts.push(at(deckFeetO(F) - 0.05, 0)); // (the deck spot: the pelvis over the feet standing there)
  const segs = [];
  let d = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); if (l > 1e-3) { segs.push({ a: pts[i - 1], b: pts[i], l, d0: d }); d += l; } }
  // (between two climbs over a wall — up one face, down the other — always: the two meet walking on its top)
  if ((d < (top ? 0.15 : 0.25) && !(top && F.midTop && d > 1e-3)) || !(T.len > 0.1)) return { a: 0 };
  const a = Math.min(top ? 0.4 : 0.55, (d + 0.5) / (d + 0.5 + T.len));
  return { a, segs, d, stand: pts.at(-1), toward: top ? !T.up : T.up, top };
}

/**
 * A ladder link's climb up at the posed pace (tools / tests): the walks at its ends, the rungs, the move onto the deck
 * (s, natural) against the sim's leg at the ladder pace (s). @returns {{nat:number, sim:number, n:number, vault:boolean, walk:number}|null}
 */
export function ladderPace(world, link, speed = 0.8) {
  const F = ladderFrame(world, link);
  if (!F) return null;
  const [foot, top] = (link.a.y ?? 0) <= (link.b.y ?? 0) ? [link.a, link.b] : [link.b, link.a];
  const len = Math.hypot(top.x - foot.x, (top.y ?? 0) - (foot.y ?? 0), top.z - foot.z);
  const T = { up: true, from: { x: foot.x, z: foot.z, y: foot.y ?? 0 }, to: { x: top.x, z: top.z, y: top.y ?? 0 }, len };
  const lead = leadOf(F, T, 'foot'), topL = leadOf(F, T, 'top');
  const n = footRungs(F).length, sch = ladderSchedule(n, n);
  const tW = (L) => (L.a > 0 ? L.d / LEAD_PACE + 0.35 : 0), tq = (sch.q1 - sch.q0) * CLIMB_MOVE, tv = vaults(F) ? VAULT_S : STEP_S;
  return { nat: tW(lead) + tW(topL) + tq + tv, sim: len / speed, n, vault: vaults(F), walk: tW(lead) + tW(topL), climb: tq, top: tv, dFoot: lead.d ?? 0, dTop: topL.d ?? 0 };
}

/** Where on an approach's way (lead.segs) a distance along it is, and which way it is walked there. */
function leadAt(L, dist) {
  let sg = L.segs[L.segs.length - 1];
  for (const x of L.segs) if (dist <= x.d0 + x.l) { sg = x; break; }
  const t = clamp((dist - sg.d0) / sg.l, 0, 1), dx = sg.b.x - sg.a.x, dz = sg.b.z - sg.a.z;
  // (towards the ladder walking to it, away from it walking off)
  return { x: sg.a.x + dx * t, z: sg.a.z + dz * t, yaw: L.toward ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz) };
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

/** The way a two-bone chain's middle joint points, off its root → end axis (world, unit; null: straight). */
function bendDir(a, b, c) {
  const pa = a.getWorldPosition(new Vector3()), pc = c.getWorldPosition(new Vector3()), pb = b.getWorldPosition(new Vector3());
  const ax = pc.sub(pa).normalize(), kv = pb.sub(pa);
  kv.addScaledVector(ax, -kv.dot(ax));
  return { ax, kv: kv.lengthSq() > 1e-8 ? kv.normalize() : null };
}

/**
 * Turn a two-bone chain about its root → end axis back to within `max` rad of the way its middle joint pointed last
 * frame (`prev`); returns the way it points now. A knee whose pole swung past the leg's line turned over in a frame.
 */
function bendLimit(a, b, c, prev, max) {
  const { ax, kv } = bendDir(a, b, c);
  if (!kv || !prev) return kv;
  const pv = prev.clone().addScaledVector(ax, -prev.dot(ax));
  if (pv.lengthSq() < 1e-8) return kv;
  pv.normalize();
  const ang = Math.atan2(_w.crossVectors(pv, kv).dot(ax), pv.dot(kv));
  if (Math.abs(ang) <= max) return kv;
  a.getWorldQuaternion(_q2);
  setWorldQuat(a, _q.setFromAxisAngle(ax, Math.sign(ang) * max - ang).multiply(_q2));
  return bendDir(a, b, c).kv;
}

/** The wall top a vault goes over: its front face (o), inner face (o), height (world y); the deck spot (feet o). */
function vaultGeo(F) {
  if (F._vault) return F._vault;
  const n = Math.hypot(1, F.k), ov = F.foot.y + F.over;
  // (the front face: the wall F.wall when it stands just behind the rungs, else a built ladder's standoff)
  const oW = F.wall != null ? -(F.wall - F.s0) / n : null;
  const oF = oW != null && oW > -0.5 ? Math.min(-0.03, oW) : -0.14;
  const oIn = F.inner != null ? Math.min(F.inner, oF - 0.1) : oF - 0.3;
  return (F._vault = { oF, oIn, oMid: (oF + oIn) / 2, ov, oDeck: deckFeetO(F) });
}

/**
 * Per-frame ladder pose for one UnitModel. @param {import('./unit-model.js').UnitModel} m @param {number} dt
 * @param {import('./pose-blend.js').BoneGuard} guard @returns {boolean} bones written
 */
export function ladderClimb(m, dt, guard) {
  const h = m.real?.inner, B = h?.bones, u = m.unit;
  if (!B?.pelvis || !B.thigh_l || !B.calf_l || !B.foot_l || !B.ball_l || !B.thigh_r || !B.calf_r || !B.foot_r || !B.ball_r
    || !B.upperarm_l || !B.lowerarm_l || !B.hand_l || !B.upperarm_r || !B.lowerarm_r || !B.hand_r) return false;
  // a ladder leg — or a wall climb, posed as a ladder leg on the face he climbs (art/wall-climb.js)
  let C = null, F0 = null;
  if (LADDER.on && u?.alive !== false) {
    if (u?._ladder && steepLadder(u._ladder.link)) { C = u._ladder; F0 = ladderFrame(u.world, C.link); }
    else if (u?._climb) { const W = climbLeg(u); if (W) { C = W.T; F0 = W.F; } }
  }
  let S = m._lc;
  // (getting up off his belly into the climb — M8's Green Beret crawls to the cliff's edge — takes longer to ease in)
  if (!S) { if (!C) return false; S = m._lc = { w: 0, C: null, F: null, y: null, o: null, vy: 0, vo: 0, boost: 0, gun: null, state: null, fadeIn: u.stance === 'crawl' || u.stance === 'downed' ? 0.6 : LADDER.fade }; }
  if (C) { if (S.F && S.F !== F0 && S.C !== C) S.vo0 = null; S.C = C; S.F = F0; }
  if (dt > 0) S.w = clamp(S.w + (C ? dt / (S.fadeIn ?? LADDER.fade) : -dt / LADDER.fade), 0, 1);
  const enemyGun = !m.player ? h.weapon : null;
  if ((!C && S.w <= 0) || !S.F) {
    if (S.gun && enemyGun) enemyGun.visible = S.gun.visible;
    m._lc = null;
    return false;
  }
  if (enemyGun && C) { S.gun ||= { visible: enemyGun.visible }; enemyGun.visible = false; }
  const F = S.F, T = S.C, root = m.root, W8 = smooth(S.w);
  const TL = T.Leff ?? T.len, P = clamp(TL > 1e-6 ? (T.up ? T.s / TL : 1 - T.s / TL) : 1, 0, 1);
  // the ladder's own foot away from the link's end (a ladder built clear of a ruin's beams, beside a canopy), the deck
  // spot past its head away from the top end: he walks between them — the climb itself that much quicker
  if (S.legC !== T) {
    S.legC = T; S.lead = leadOf(F, T, 'foot'); S.top = leadOf(F, T, 'top');
    // (the leg's time shared out by what each part takes at a natural pace — the walks at LEAD_PACE m/s and a turn,
    // the climb at CLIMB_MOVE s a foot's move, the vault VAULT_S — all of it quicker when the leg is quicker)
    const n = footRungs(F).length, sch = ladderSchedule(n, n);
    const tW = (L) => (L.a > 0 ? L.d / LEAD_PACE + 0.35 : 0), tq = (sch.q1 - sch.q0) * CLIMB_MOVE, tv = vaults(F) ? VAULT_S : STEP_S;
    const tot = tW(S.lead) + tW(S.top) + tq + tv;
    if (S.lead.a > 0) S.lead.a = Math.min(0.55, tW(S.lead) / tot);
    if (S.top.a > 0) S.top.a = Math.min(0.45, tW(S.top) / tot);
    S.cv = tq / (tq + tv);
    if ((S.lead.a > 0 && T.up) || (S.top.a > 0 && !T.up)) S.y = null;
  }
  const a = S.lead.a, b = S.top.a;
  // (walking: g from the link's end (0) to the ladder (1))
  const g = a > 0 && P < a ? P / a : b > 0 && P > 1 - b ? (1 - P) / b : null, L = g == null ? null : P < a ? S.lead : S.top;
  const Pv = g != null ? (L.top ? 1 : 0) : clamp((P - a) / Math.max(1e-6, 1 - a - b), 0, 1);
  // he faces the ladder (the sim turns at its own rate at the start of a descent) — walking to / from it, the way he
  // walks, turning to it as he gets there
  const yaw = Math.atan2(F.fx, F.fz);
  const turn = g == null ? 1 : smooth(clamp((g - LEAD_WALK) / (1 - LEAD_WALK), 0, 1));
  let yawT = yaw, spot = null;
  if (turn < 1) {
    spot = leadAt(L, smooth(clamp(g / LEAD_WALK, 0, 1)) * L.d);
    let dy = yaw - spot.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yawT = spot.yaw + dy * turn;
  }
  // the clip under him eases in / out where he was drawn as the pose took over / let go — not following the sim along
  // its line meanwhile (M8's cliff: a ramp down into the rock) nor the stride's lift (M11's tank plinth) as it went
  if (C && !S.r0) S.r0 = (m._rootPrev ?? root.position).clone();
  if (!C && !S.r1) S.r1 = (m._rootPrev ?? root.position).clone();
  if (C && S.r1) S.r1 = null;
  const rH = C ? S.r0 : S.r1, rW = C ? 1 - W8 : W8;
  if (rH && rW > 1e-4 && rH.distanceTo(root.position) < 1.5) root.position.lerp(rH, rW);
  // (easing out: from where he was drawn facing as the climb ended to the sim's heading — what the climb faced had
  // turned on as the clip under him came back)
  if (!C && S.yawOut == null) S.yawOut = S.yawD ?? yawT;
  if (C) S.yawOut = null;
  // (easing in: from where he was drawn facing as it took over — not from the sim's heading turning on meanwhile:
  // going down M2's camp ladder it turned him to face the palisade while the climb walked him along the wall walk,
  // a boot of the stride under him going into the stakes)
  if (C && S.yaw0 == null) S.yaw0 = m._rootYawPrev ?? root.rotation.y;
  if (!C) S.yaw0 = null;
  const yBase = C ? S.yaw0 : root.rotation.y;
  let dyaw = (C ? yawT : S.yawOut) - yBase; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  root.rotation.y = yBase + dyaw * W8;
  // (turning no quicker than a man turns, YAW_RATE: from one of a wall climb's faces to the next, off the walk onto
  // the climb, the drawn body went round 40-65° in a frame — M2's palisade, M1's wall)
  if (C && S.yawD != null && dt > 0) {
    let dd = root.rotation.y - S.yawD; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    const mx = YAW_RATE * dt;
    if (Math.abs(dd) > mx) root.rotation.y = S.yawD + Math.sign(dd) * mx;
  }
  S.yawD = root.rotation.y;
  root.updateMatrixWorld(true);
  // (getting up off his belly into it: the get-up played under the ease-in, not a lying body blended upright)
  // (standing still when the climb began — the walk clip it set going a frame before: the stand under the ease-in, not
  // the walk's first stride; at the top of M2's camp ladder, his back to the palisade, its boot went into the stakes)
  if (C && S.fromStand == null) S.fromStand = m.clip === 'walk' && /idle/.test(m._clipPrev || '') && (u.world?.time ?? 0) - (m._clipAt ?? -1) < 0.1;
  const before = W8 < 1 ? (C && S.fadeIn > LADDER.fade ? clipPose(m, 'get_up', clamp(S.w, 0, 1), true) || capturePose(m)
    : C && S.fromStand ? clipPose(m, m._clipPrev, 0) || capturePose(m) : capturePose(m)) : null;
  const vault = vaults(F);
  /** The climb pose at progress Pv (0 the ground stance at the foot, 1 standing on the deck past the top). */
  const climbPose = (Pv) => {
    const K = kOf(F);
    // a still base pose (the idle clip's first frame): nothing of the walk / mantle under it shows
    const idle = clipPose(m, 'idle', 0);
    if (idle) mixPose(m, idle, 1, guard);
    if (!h._boneTop) { let b = B.pelvis; while (b.parent && b.parent !== h.object) b = b.parent; h._boneTop = b; }
    h.object.updateWorldMatrix(true, false); h._boneTop.updateMatrixWorld(true);
    const G = bodyGeo(h, B, root);
    const up = new Vector3(0, 1, 0), fdir = new Vector3(F.fx, 0, F.fz), wdir = ladderDir(F, 'w', new Vector3()), odir = ladderDir(F, 'o', new Vector3());

    // the schedule: phase q from the sim's progress — the leapfrog up to the top rung (both feet on it), then the move
    // onto the deck: a step off (the vault over a wall well above it)
    const feetR = footRungs(F), n = feetR.length, sch = ladderSchedule(n, n);
    const cv = S.cv ?? 0.75;
    const vu = Pv > cv ? (Pv - cv) / (1 - cv) : null;
    const q = lerp(sch.q0, sch.q1, Math.min(1, Pv / cv));
    const sp = n > 1 ? (F.rungs[feetR[n - 1]] - F.rungs[feetR[0]]) / (n - 1) : 0.3;
    // (the hip's height over the support it climbs from — within what the leg-reach cap below allows, a knee's boost
    // out included: going down the pelvis was capped 7 cm lower the frame each foot landed)
    const reach = Math.sqrt(Math.max(0.05, (0.95 * G.leg) ** 2 - (K.pelvisOut + 0.04 - G.ankleOut) ** 2));
    const hipClimb = G.ballH + G.ankleRise + reach - sp / 2;
    const over = F.over > F.H + 0.25 ? F.over : null;
    const V = vaultGeo(F);
    // (what he stands on at the foot and on the deck: the drawn surface — a tank's plinth, the walk's planks)
    const groundY = F.footSurf ?? F.foot.y, deckY = F.deckSurf ?? F.top.y;
    /** A foot level's spot: ball target, support height, the pelvis's way out, its hip height. */
    const spot = (L, side) => {
      const w = (side === 'l' ? 1 : -1) * K.footW;
      // (on the ground at the foot end — a step up to the ladder when that end lies well out from it — or on the deck
      // past the top end's way in)
      if (L <= 0) {
        const o = clamp(F.footO, K.standO[0], K.standO[1]), p = atHeight(F, groundY, o, w, new Vector3());
        p.y = groundY + G.ballH;
        return { p, ys: groundY, zo: o + 0.08, hip: G.hipStand, zone: 'ground' };
      }
      if (L > n) {
        const o = deckFeetO(F), p = atHeight(F, deckY, o, w, new Vector3());
        p.y = deckY + G.ballH;
        return { p, ys: deckY, zo: o - 0.05, hip: Math.max(0.45, Math.min(G.hipStand, (F.topRoom ?? Infinity) - G.headUp - 0.08)), zone: 'deck' };
      }
      // (on a face: the ball where the face really is there — a stake further back, a bulge of rock)
      const v = F.rungs[feetR[L - 1]], c = ladderPoint(F, v * Math.hypot(1, F.k), (F.face ? FACE_BALL : 0.012) + holdO(F, v, w), w, new Vector3());
      const ys = c.y + F.rr;
      c.y = ys + G.ballH;
      return { p: c, ys, zo: K.pelvisOut, hip: hipClimb, zone: 'rung' };
    };
    const feet = {}, levels = { r: footLevel(q, 'A', sch.D), l: footLevel(q, 'B', sch.D) };
    for (const s of SIDES) {
      const { a, b, t } = levels[s], A = spot(a, s), Bt = spot(b, s);
      const p = A.p.clone().lerp(Bt.p, t);
      const moving = a !== b && t > 0 && t < 1, bell = moving ? Math.sin(Math.PI * t) : 0;
      if (moving) {
        // swung out round the rung it leaves (and up over a wall's top on the way to / from the deck)
        p.addScaledVector(odir, K.swingOut * bell);
        const deckY = over ?? F.top.y;
        if (A.zone === 'deck' || Bt.zone === 'deck') p.y = Math.max(p.y, lerp(p.y, deckY + 0.3, Math.min(1, bell * 1.6)));
        else p.y += 0.05 * bell;
      }
      // (still on its level before the move: t 0 is A's — the left foot on the ground at q −1 counted as on a rung, and
      // its leg-reach cap dropped the pelvis 13 cm the frame he stepped off the ladder)
      feet[s] = { p, ys: lerp(A.ys, Bt.ys, t), ysA: A.ys, ysB: Bt.ys, zo: lerp(A.zo, Bt.zo, t), hip: lerp(A.hip, Bt.hip, t), zone: moving ? 'moving' : t <= 0 ? A.zone : Bt.zone, from: A.zone, to: Bt.zone, t };
    }
    // ------------------------------------------------------------ onto the deck (feet, pelvis, hands key-framed)
    // u 0 → 1 from both feet on the top rung, hands high on the stiles (a face: on its top):
    //  - a step off: the pelvis up and forward over the deck's edge as the lead foot (the right) steps over it onto the
    //    deck, the hands let go as the body goes over, the trailing foot follows; he stands;
    //  - the vault (a wall well above the deck): the lead leg swings up over the wall's top and down its far side; he
    //    sits on it as the trailing leg follows; hands back onto the top, he slides off it onto the deck; stands.
    // Going down: the same, backwards (from the deck, his back to the drop).
    let VT = null;
    if (vu != null) {
      const top = spot(n, 'r'), topL = spot(n, 'l'), deckR = spot(n + 1, 'r'), deckL = spot(n + 1, 'l');
      const yTop = top.ys, ov = V.ov, dk = deckY;
      // (the keys at u 0 are what the climb itself wants there — both feet on the top rung — filled in below: the move
      // starts from it and, going down, hands over to it without a jump)
      const o0 = K.pelvisOut;
      const hipDeck = deckR.hip, duck = dk + (F.topRoom ?? Infinity) - G.headUp - 0.08;
      let pelO, pelY, fr, fl;
      if (vault) {
        // (the pelvis: up and in over the top, sitting on it, its seat just inside the inner edge, down off it clear of
        // the wall's inner face — the body's back is a good 0.2 m behind the hip joints)
        // (standing tall on the top rung while the lead leg goes over — a leg swung over the top under a hip just over
        // it folds right up, its knee turning over from one frame to the next — then down onto the top as the trailing
        // leg comes over)
        const yHi = Math.min(ov + 0.45, yTop + G.ballH + G.ankleRise + 0.93 * G.leg);
        // (on a thick wall — M20's parapets, 0.9 m — only just over its front as the trailing foot leaves the top rung,
        // then on to the seat: at its middle the hip was out of that leg's reach and pulled the foot off the rung)
        const o38 = Math.max(V.oMid + 0.05, V.oF - 0.15);
        pelO = keyed([[0, o0], [0.22, 0.32], [0.38, o38], [0.5, V.oMid - 0.05], [0.62, V.oIn - 0.1], [0.8, V.oIn - 0.24], [1, V.oDeck - 0.05]], vu);
        // (the hip over the wall's front as the trailing foot leaves the top rung: no further than that leg reaches
        // from there — M20's embrasures, the foot pulled off its rung 3-14 cm a moment early)
        const y38r = topL.ys + G.ballH + G.ankleRise + Math.sqrt(Math.max(0.01, (0.95 * G.leg) ** 2 - (o38 - G.ankleOut) ** 2));
        pelY = keyed([[0, yTop + hipClimb], [0.22, Math.max(yTop + hipClimb, yHi)], [0.38, Math.max(yTop + hipClimb, Math.min(Math.max(ov + 0.28, yHi - 0.12), y38r))], [0.5, ov + 0.16], [0.62, ov + 0.07], [0.8, dk + hipDeck * 0.78], [1, dk + hipDeck]], vu);
        const swing = (u0, u1, from, side, out = 0) => {
          // (up from the rung, over the wall top — in front of its face, over its inner edge — down its far side to hang
          // there under the seat; then down onto the deck; the trailing leg comes over out to the side, a hurdler's
          // way: he sits on the top, its foot cannot pass over it under his hip)
          const sd = side === 'l' ? 1 : -1, w = sd * K.footW, wo = sd * (K.footW + out);
          const t = clamp((vu - u0) / (u1 - u0), 0, 1);
          if (t <= 0) return { p: from.p.clone(), zone: 'rung', ys: from.ys };
          // (the ball a foot's length off the inner face: the heel behind it went into the parapet, M20's embrasures)
          const hang = atHeight(F, Math.max(dk + G.ballH + 0.05, pelY - G.leg * 0.85), V.oIn - 0.26, w, new Vector3());
          if (t >= 1) return { p: hang, zone: 'moving', ys: dk };
          // (the trailing leg wide of the hip, its knee raised: up in front of the face out to the side, over the top
          // beside the seat — brought over close by the hip, its ankle passed through the hip joint and the knee
          // turned over in a frame)
          // (up inside the stiles first: a built ladder's stand 0.35 m over the wall top — the foot and knee out to the
          // side in front of them went into them, M15's, M20's turret — out wide only behind them, over the top)
          const way = out > 0.05 ? [from.p, atHeight(F, ov + 0.2, V.oF + 0.15, w, new Vector3()), atHeight(F, ov + 0.22, V.oF - 0.1, sd * (K.footW + out * 0.6), new Vector3()), atHeight(F, ov + 0.14, V.oIn - 0.05, wo, new Vector3()), hang]
            : [from.p, atHeight(F, ov + 0.15, V.oF + 0.05, wo, new Vector3()), atHeight(F, ov + 0.12, V.oIn - 0.1, wo, new Vector3()), hang];
          return { p: along(way, smooth(t)), zone: 'moving', ys: from.ys };
        };
        const land = (u0, u1, sw, to) => {
          const t = clamp((vu - u0) / (u1 - u0), 0, 1);
          if (t <= 0) return sw;
          return { p: sw.p.clone().lerp(to.p, smooth(t)), zone: t >= 1 ? 'deck' : 'moving', ys: dk };
        };
        // (the trailing leg out as wide as the way over the top lets it: F.topHalf, an embrasure's)
        const wide = clamp((F.topHalf ?? Infinity) - K.footW - 0.12, 0.06, 0.33);
        fr = land(0.6, 0.8, swing(0.12, 0.38, top, 'r'), deckR); fl = land(0.64, 0.84, swing(0.38, 0.62, topL, 'l', wide), deckL);
      } else {
        // (the pelvis: up as the lead foot comes up, forward over the deck's edge, standing; under a lintel no higher
        // than it lets him)
        const yS = Math.min(duck, dk + hipDeck), y0 = yTop + hipClimb;
        const oKeys = [[0, o0], [0.3, Math.min(o0, 0.32)], [0.55, 0.04], [0.8, V.oDeck + 0.1], [1, V.oDeck - 0.05]];
        pelO = keyed(oKeys, vu);
        // (no higher, while the trailing foot is still on the top rung, than its leg reaches from there: the top foot
        // rung can be well under the deck — M11's tanks, 0.4 m — and that foot was pulled up off it; then up as it
        // lifts off. A deck by the top rung: up as the lead foot comes up)
        const yUp = Math.max(y0, yS - 0.12);
        const reachL = topL.ys + G.ballH + G.ankleRise + Math.sqrt(Math.max(0.01, (0.95 * G.leg) ** 2 - (keyed(oKeys, 0.46) - G.ankleOut) ** 2));
        pelY = Math.min(duck, keyed(reachL < yUp ? [[0, y0], [0.46, Math.max(y0, reachL)], [0.66, yS], [1, yS]] : [[0, y0], [0.4, yUp], [0.62, yS], [1, yS]], vu));
        // (each foot up off its rung, over the deck's edge — and a low wall standing on it — down onto the deck)
        const edgeY = Math.max(dk, over ?? dk) + 0.2;
        const stepTo = (u0, u1, from, to, side) => {
          const t = clamp((vu - u0) / (u1 - u0), 0, 1), w = (side === 'l' ? 1 : -1) * K.footW;
          if (t <= 0) return { p: from.p.clone(), zone: 'rung', ys: from.ys };
          if (t >= 1) return { p: to.p.clone(), zone: 'deck', ys: dk };
          return { p: along([from.p, atHeight(F, edgeY, 0.03, w, new Vector3()), atHeight(F, edgeY, Math.min(-0.05, local(F, to.p).o + 0.15), w, new Vector3()), to.p], smooth(t)), zone: 'moving', ys: from.ys };
        };
        fr = stepTo(0.1, 0.5, top, deckR, 'r'); fl = stepTo(0.48, 0.86, topL, deckL, 'l');
      }
      VT = { pelO, pelY, feet: { r: fr, l: fl }, mode: vault ? 'vault' : 'step' };
    }
    // pelvis: over its feet's supports, out as far as they take it (a raised knee pushes it further), eased
    let yT = (feet.l.ys + feet.l.hip + feet.r.ys + feet.r.hip) / 2;
    // (on the rungs the body goes up / down evenly with the climb — the feet's mean level is q + ½ at every whole q —
    // not in a lurch with each foot's move: going down a quick ladder that was 10 cm a frame)
    const yLin = (qq) => { const lv = clamp(qq + 0.5, 0.5, n), l0 = Math.floor(lv), l1 = Math.min(n, l0 + 1); return lerp(spot(l0, 'r').ys, spot(l1, 'r').ys, lv - l0) + hipClimb; };
    if (!VT && q >= 0) yT = yLin(q);
    // (getting on / off at the foot: from the standing pelvis to the climb's line, evenly — the mean of a standing and
    // a climbing hip dropped him 7–14 cm the frame the last foot touched the ground)
    else if (!VT && q < 0 && n >= 1) yT = lerp(groundY + G.hipStand, yLin(0), smooth(q + 1));
    let oT = (feet.l.zo + feet.r.zo) / 2 + S.boost;
    // (a foot stepping over onto the deck — or back off it — has the body up over the top, easing in and out with it)
    for (const f of [feet.l, feet.r]) {
      if (VT || f.zone !== 'moving' || (f.from !== 'deck' && f.to !== 'deck')) continue;
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
        // (a foot on the move: its knee's need grows and fades with the move — the pelvis eases out and back, no lurch
        // the frame it lifts off the rung)
        const ramp = f.zone === 'moving' && f.t != null ? smooth(Math.min(f.t, 1 - f.t) * 4) : 1;
        need = Math.max(need, (Math.max(K.kneeOut, (F.stileFront ?? 0) + 0.055) - ka) * ramp);
      }
      return need;
    };
    for (let i = 0; i < 4; i++) { const k = kneeNeed(oT, yT); if (k <= 0.002) break; oT += k; }
    // (never higher than a planted foot's leg reaches)
    let cap = Infinity;
    const reachAt = (ys, fo) => { const dO = (S.o ?? oT) - fo; return ys + G.ballH + G.ankleRise + Math.sqrt(Math.max(0.01, (0.95 * G.leg) ** 2 - dO * dO)); };
    for (const s of SIDES) {
      const f = feet[s];
      if (f.zone === 'moving') {
        // (a foot on its way down to a lower rung: the body comes down with it to where that leg will reach as it
        // lands — not all at once when it lands: going down, the pelvis dropped 12 cm in a frame at every rung)
        // (the schedule's levels run up the ladder: going down a foot travels from its upper level B to A, t 1 → 0)
        if (!T.up && f.from !== 'ground' && f.ysB > f.ysA + 0.05) cap = Math.min(cap, reachAt(f.ysA, G.ankleOut) + f.t * (f.ysB - f.ysA));
        continue;
      }
      const fo = f.zone === 'rung' ? G.ankleOut : f.zone === 'ground' ? f.zo - 0.08 : f.zo + 0.05;
      cap = Math.min(cap, reachAt(f.ys, fo));
    }
    yT = Math.min(yT, cap);
    // (no further out than the room in front of the rungs allows: a caged ladder's hoops behind him)
    // (the room about his hips' height: a cage's hoops, a floor's edge — not the rubble by the foot when he is up)
    const vP = (S.y ?? yT) - F.foot.y;
    const oRoom = Math.max(Math.min(K.outMax, roomAt(F, vP - 0.3, vP + 0.4) - 0.08), (feet.l.zo + feet.r.zo) / 2);
    oT = Math.min(oT, oRoom);
    // (nor further out than a planted foot on a rung reaches: a raised knee's room is taken from what the legs allow)
    let oReach = Infinity;
    for (const s of SIDES) {
      const f = feet[s];
      if (f.zone !== 'rung') continue;
      const dy = (S.y ?? yT) - (f.ys + G.ballH + G.ankleRise);
      oReach = Math.min(oReach, Math.max(K.pelvisOut, G.ankleOut + Math.sqrt(Math.max(0, (0.95 * G.leg) ** 2 - dy * dy))));
    }
    oT = Math.min(oT, oReach);
    // the move onto the deck: its keys from what the climb wants on the top rung, eased in over its first 15 %
    let kv = 0;
    if (VT) {
      kv = smooth(vu / 0.15);
      // (the keys' first one is K.pelvisOut / the top rung + hipClimb: what the climb wants there replaces it)
      const oK = VT.pelO + (oT - K.pelvisOut) * (1 - smooth(vu / 0.16));
      const yK = VT.pelY + (yT - (spot(n, 'r').ys + hipClimb)) * (1 - smooth(vu / 0.16));
      oT = lerp(oT, oK, kv); yT = lerp(yT, yK, kv);
      // (key-framed within the legs' reach — the step's keys no higher than the trailing foot on the top rung reaches:
      // a bound on the pelvis itself here dropped it 30 cm the frame that foot landed going down, and held it low as
      // it went in over the deck's edge: knees into the top rungs, the chest into a roof's edge — M12)
      cap = Infinity;
      for (const s of SIDES) { const f = VT.feet[s]; feet[s] = { p: f.p, ys: f.ys, zo: oT, hip: 0, zone: f.zone, from: f.zone === 'deck' ? 'deck' : 'rung', to: vu > 0.5 ? 'deck' : 'rung', t: 0.5 }; }
      // (both feet still on the top rung: the knees kept off its rungs by the target itself, the spring easing out)
      if (vu < 0.12) for (let i = 0; i < 4; i++) { const k = kneeNeed(oT, yT); if (k <= 0.002) break; oT += k; }
    }
    if (S.y == null) { S.y = yT; S.o = oT; S.vy = 0; S.vo = 0; S.yTp = yT; S.oTp = oT; }
    if (dt > 0) {
      // (the target's own speed fed forward: a quick ladder's pelvis lagged 10–13 cm behind it going down, and the
      // leg-reach cap then pulled it down in one frame as a foot landed)
      const vyT = clamp((yT - (S.yTp ?? yT)) / dt, -3, 3), voT = clamp((oT - (S.oTp ?? oT)) / dt, -3, 3);
      S.yTp = yT; S.oTp = oT;
      const om = K.spring, k = Math.max(1, Math.ceil(dt * 240)), hh = dt / k;
      for (let i = 0; i < k; i++) {
        S.vy += (om * om * (yT - S.y) + 2 * om * (vyT - S.vy)) * hh; S.y += S.vy * hh;
        S.vo += (om * om * (oT - S.o) + 2 * om * (voT - S.vo)) * hh; S.o += S.vo * hh;
      }
      S.boost = Math.max(0, S.boost - dt * 0.3);
    }
    if (S.y > cap) { S.y = cap; S.vy = Math.min(0, S.vy); }
    // (and the knees out of the rung line this very frame, the spring notwithstanding — not in the key-framed move)
    // (a few cm a frame at most: handing over from the key-framed move the pelvis jumped 12 cm out in one frame)
    for (let i = 0; i < (VT ? 0 : 3); i++) {
      const k = kneeNeed(S.o, S.y);
      const lim = Math.min(oReach, oRoom);
      if (k <= 0.002 || S.o >= lim) break;
      S.o = Math.min(lim, S.o + Math.min(k, 0.025)); S.vo = Math.max(0, S.vo);
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
    // how much he hangs on the rungs (both feet on them) — the lean and the head follow it (the vault: as it starts)
    let onRungs = SIDES.reduce((a, s) => a + (feet[s].zone === 'rung' || feet[s].zone === 'moving' && feet[s].from !== 'ground' && feet[s].to !== 'ground' && feet[s].from !== 'deck' && feet[s].to !== 'deck' ? 0.5 : feet[s].zone === 'moving' ? 0.25 : 0), 0);
    if (VT) onRungs = 1 - smooth(vu / 0.3);
    // chest in to its distance off the rung line (the spine leaning in), the neck back up, the head up the way he goes
    if (B.spine_01 && (B.spine_03 || B.spine_02)) {
      const cp = chestPoint(B), c0 = B.spine_01.getWorldPosition(new Vector3());
      const hC = Math.max(0.2, cp.y - c0.y), dO = outOf(F, cp) - K.chestOut;
      // (leaning in already from the ground: the hands go up to the rungs at arm's length)
      const lean = clamp(Math.atan2(dO, hC), -8 * DEG, K.leanMax + Math.atan(Math.max(0, F.k))) * (VT ? onRungs : Math.max(onRungs, 0.6));
      const neck = B.neck_01, head = B.Head || B.head;
      const turn = (b, a) => { if (!b || !a) return; guard?.touch(b); b.getWorldQuaternion(_q2); setWorldQuat(b, _q.setFromAxisAngle(wdir, a).multiply(_q2)); };
      turn(B.spine_01, lean * 0.65); turn(B.spine_02, lean * 0.35);
      if (onRungs > 0) {
        // the upper back straightens: his head stays up over his shoulders, K.headOut off the rungs …
        const up3 = B.spine_03 || B.spine_02, hp = head?.getWorldPosition(new Vector3());
        if (hp) {
          const dh = K.headOut - outOf(F, hp), r = Math.max(0.2, hp.distanceTo(up3.getWorldPosition(new Vector3())));
          if (dh > 0.005) turn(up3, -Math.asin(clamp(dh / r, 0, 0.6)) * onRungs);
        }
        // … the chest no further out than K.chestMax for it (leant again at the base of the spine)
        // (again while it is still out: leant far over, a turn at the base of the spine brings the chest in less)
        let tot = 0;
        for (let i = 0; i < 3; i++) {
          const d2 = outOf(F, chestPoint(B)) - K.chestMax;
          if (d2 <= 0.003) break;
          const a = Math.min(clamp(Math.atan2(d2, hC), 0, 0.45), 0.45 + Math.atan(Math.max(0, F.k)) - tot);
          if (a <= 0) break;
          turn(B.spine_01, a * onRungs); tot += a;
        }
      }
      // (the neck back up: the head over the shoulders, off the rungs — what the upper back left of it)
      const hp2 = head?.getWorldPosition(new Vector3());
      if (neck && hp2) {
        const dn = K.headOut - outOf(F, hp2), rn = Math.max(0.08, hp2.distanceTo(neck.getWorldPosition(new Vector3())));
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
      const Qd = _q.setFromAxisAngle(wdir, -K.heel * (f.zone === 'ground' || f.zone === 'deck' ? 0 : 1)).multiply(_q2).clone();
      const D0 = ball.getWorldPosition(new Vector3()).sub(foot.getWorldPosition(new Vector3()));
      const D = D0.applyQuaternion(_q2.clone().invert()).applyQuaternion(Qd);
      const ank = f.p.clone().sub(D);
      for (let i = 0; i < 2; i++) {
        twoBoneIK(thigh, calf, foot, ank);
        // (knees in through the gap at the top: a railing either side of the ladder's way onto the deck; over a wall's
        // top in a vault the knee leads forward over it)
        // (stepping onto the deck: knees a touch in — out, the lead knee caught the end of a roof's parapet beside the way, M12)
        let splay = f.from === 'deck' || f.to === 'deck' || f.zone === 'deck' || VT ? -0.05 : K.splay;
        // (onto the deck: the lead knee forward and up over the edge; in a vault the trailing leg comes over a hurdler's
        // way, its knee out to the side — a knee pointed along the leg would flip from one frame to the next)
        const trail = VT?.mode === 'vault' && s === 'l';
        // (a foot still on its rung in the move: the climb's own knee, inside the stiles — the trailing knee out to the
        // side went past a built ladder's stile standing over the wall top and into it, M2's camp ladder, M15's,
        // M20's turret — turning to the move's as it lifts off)
        const lift = !VT ? 0 : VT.mode === 'vault' ? (s === 'l' ? 0.38 : 0.12) : (s === 'l' ? 0.48 : 0.1);
        const onRung = !!VT && vu < lift + 0.06;
        if (onRung) splay = K.splay;
        // (the vault's trailing leg, its foot still on the top rung as the body goes in over the wall: the knee up and
        // over the edge in front of the wall — pointed on at the ladder, the hip over the top, it went into the wall's
        // top: M2's stakes, M15's; then, as it lifts, the move's own knee: forward, up and a little out — whichever way
        // the leg points, down to the rung, out to the side, down past the wall, a clear way to point (out only, it
        // turned over with the foot out to the side; well out, into a built ladder's stile over the top)
        const bUp = VT && trail ? smooth((vu - 0.15) / 0.15) : 0, bl = VT ? smooth((vu - lift + 0.02) / 0.08) : 0;
        const mv = !VT ? null : trail ? wdir.clone().multiplyScalar(side * 0.2).addScaledVector(up, 0.7).addScaledVector(fdir, 0.5)
          : fdir.clone().addScaledVector(up, 0.5).addScaledVector(wdir, side * 0.05);
        const poleAt = (spl) => {
          const P = fdir.clone().addScaledVector(up, 0.25).addScaledVector(wdir, side * spl);
          // (up, with forward and out enough that a leg still plumb under the hip keeps a way to point: up alone ran
          // along it and the knee wandered across to the other stile)
          if (bUp > 0) P.lerp(up.clone().addScaledVector(fdir, 0.2).addScaledVector(wdir, side * Math.max(0.15, spl * 0.3)), bUp);
          if (bl > 0) P.lerp(mv, bl);
          return P;
        };
        poleTurn(thigh, calf, foot, poleAt(splay));
        // (knees out — but inside the stiles: a knee splayed past one would go into it)
        for (let j = 0; j < 3; j++) {
          const kw = Math.abs(local(F, calf.getWorldPosition(new Vector3())).w), lim = F.halfW - 0.085;
          if (kw <= lim || splay <= -0.6 || (VT && !onRung)) break;
          splay -= (kw - lim) * 4;
          poleTurn(thigh, calf, foot, poleAt(splay));
        }
      }
      // (the knee no more than ~20° a frame round the leg's line from where it pointed: a pole swung across the line —
      // a quick vault's trailing leg, M2's camp ladder — turned it over in a frame, 30-60 cm with the foot still)
      S.bend ||= {};
      const bd = bendLimit(thigh, calf, foot, S.bend[s], dt > 0 ? Math.max(0.35, dt * 21) : 0.35);
      if (bd) S.bend[s] = bd.clone();
      setWorldQuat(foot, Qd);
      // (a knee near a rung or a stile — or behind the rung line — has the body further out a moment)
      const Kn = local(F, calf.getWorldPosition(new Vector3()));
      let near = Kn.o + 0.04;
      for (const v of F.rungs) near = Math.min(near, Math.hypot(Kn.l - v * Math.hypot(1, F.k), Kn.o));
      if (!F.face && Math.abs(Kn.w) > F.halfW - 0.08) near = Math.min(near, Math.hypot(Math.abs(Kn.w) - F.halfW, Kn.o));
      if (onRungs > 0 && !VT && near < K.kneeMin) S.boost = Math.min(0.2, S.boost + (K.kneeMin - near) * 0.8);
      footState[s] = { zone: f.zone, from: f.from, to: f.to, ball: f.p };
    }
    // arms: the knuckles on a rung over the foot of the other diagonal (or on a stile past the top rung), thumbs in;
    // let go once that foot is on the deck
    const handState = {};
    const rungsAll = F.rungs, nn = Math.hypot(1, F.k);
    const grip = (L, side) => {
      const fy = L <= 0 ? 0 : L > n ? F.H : F.rungs[feetR[L - 1]];
      if (L > n) return null;
      const want = fy + K.handUp;
      let best = -1;
      for (let i = 0; i < rungsAll.length; i++) if (rungsAll[i] <= want + 0.15 && (best < 0 || Math.abs(rungsAll[i] - want) < Math.abs(rungsAll[best] - want))) best = i;
      const lastV = rungsAll.at(-1) ?? 0;
      if (best >= 0 && !(want > lastV + 0.2 && rungsAll[best] === lastV)) {
        if (F.face) return { p: ladderPoint(F, rungsAll[best] * nn, holdO(F, rungsAll[best], side * K.handW) - FACE_KNUCKLE, side * K.handW, new Vector3()), kind: 'rung' };
        const p = ladderPoint(F, rungsAll[best] * nn, 0, side * K.handW, new Vector3());
        p.y += F.rr + 0.012;
        return { p, kind: 'rung' };
      }
      // past the top rung: a stile, as high as it goes
      const rTop = F.railTops?.[side > 0 ? 1 : 0] || F.railTop;
      const v = Math.min(want, rTop - 0.1);
      const p = ladderPoint(F, v * nn, F.face ? holdO(F, rTop - 0.1, side * F.halfW) - FACE_KNUCKLE : 0.035, side * F.halfW, new Vector3()); // (knuckles round its front)
      return { p, kind: 'stile' };
    };
    for (const s of SIDES) {
      const side = s === 'l' ? 1 : -1, pair = s === 'l' ? levels.r : levels.l; // left hand with the right foot
      const ua = B['upperarm_' + s], la = B['lowerarm_' + s], hd = B['hand_' + s], mid = B['middle_01_' + s];
      let g = null, wt = 1;
      if (VT) {
        // high on the stiles (a face: its top); the vault: then back onto the wall's top as he sits on it, let go as
        // he comes down off it; the step: let go as the body goes over the deck's edge
        const st = grip(n, side), rTop = F.railTops?.[side > 0 ? 1 : 0] || F.railTop;
        const hi = ladderPoint(F, Math.min(rTop - 0.1, F.over + 0.25) * nn, F.face ? holdO(F, rTop - 0.1, side * F.halfW) - FACE_KNUCKLE : 0.035, side * F.halfW, new Vector3());
        // (a face with the deck at its top: palms on the deck behind its edge)
        const onDeck = F.face && !vault ? atHeight(F, F.top.y + 0.03, V.oF - 0.14, side * 0.24, new Vector3()) : null;
        const from = st?.kind === 'stile' ? st.p : hi;
        if (VT.mode === 'vault') {
          const onTop = atHeight(F, V.ov + 0.03, V.oMid, side * 0.24, new Vector3());
          const k = smooth((vu - 0.4) / 0.22);
          if (vu < 0.4) g = { p: from.clone().lerp(hi, smooth(vu / 0.2)), kind: 'stile', to: 'stile' };
          else if (vu < 0.62) g = { p: hi.clone().lerp(onTop, k).addScaledVector(up, 0.12 * Math.sin(Math.PI * k)), kind: 'moving', to: 'top' };
          else { g = { p: onTop, kind: 'top', to: 'top' }; wt = 1 - smooth((vu - 0.74) / 0.18); }
        } else if (onDeck) {
          const k = smooth(vu / 0.25);
          g = k < 1 ? { p: from.clone().lerp(onDeck, k).addScaledVector(up, 0.1 * Math.sin(Math.PI * k)), kind: 'moving', to: 'top' } : { p: onDeck, kind: 'top', to: 'top' };
          wt = 1 - smooth((vu - 0.55) / 0.25);
        } else {
          g = { p: from.clone().lerp(hi, smooth(vu / 0.3)), kind: 'stile', to: 'stile' };
          wt = 1 - smooth((vu - 0.55) / 0.3);
        }
        if (wt <= 0) { handState[s] = { kind: 'free' }; continue; }
      } else {
        const g0 = grip(pair.a, side), g1 = grip(pair.b, side);
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
      }
      if ((g.to ?? g.kind) === 'stile') {
        // (a stile is held where the arm reaches it: the hand slides along it as he goes over the top)
        // (on a face a little short of full reach: at it the hand fell 2-5 cm short of its hold and slid with him, M1)
        const sh = ua.getWorldPosition(new Vector3()), arm = armLength(B, s) * (F.face ? 0.95 : 0.985);
        const st = ladderPoint(F, 0, F.face ? -FACE_KNUCKLE : 0.035, side * F.halfW, new Vector3()), axis = ladderDir(F, 'l', new Vector3());
        const along = (v) => st.clone().addScaledVector(axis, v);
        let lo = 0, hi = ((F.railTops?.[side > 0 ? 1 : 0] || F.railTop) - 0.1) * Math.hypot(1, F.k);
        const lNow = local(F, g.p).l;
        // (the wrist's reach, not the knuckles': a hand's breadth back from them the way its fingers will point — on a
        // face up it, so with the shoulder over the hold the wrist is further off: M1's wall top, the hand short of it
        // by up to 10 cm and dragged along with him)
        const hb = mid ? mid.getWorldPosition(new Vector3()).distanceTo(hd.getWorldPosition(new Vector3())) : 0.09;
        const fingers = (K) => {
          if (F.face) return up.clone().multiplyScalar(0.97).addScaledVector(fdir, 0.2).normalize();
          const d = K.clone().sub(sh).setY(0); if (d.lengthSq() < 1e-4) d.copy(fdir);
          return d.normalize().addScaledVector(wdir, -side * 0.3).normalize();
        };
        const ok = (l) => { const K = along(l); return K.addScaledVector(fingers(K), -hb).distanceTo(sh) <= arm; };
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
        const Kg = along(local(F, g.p).l), miss = Kg.clone().addScaledVector(fingers(Kg), -hb).distanceTo(sh) - arm;
        if (miss > 0) { wt *= clamp(1 - miss / 0.12, 0, 1); if (wt < 0.999) g.kind = 'moving'; }
        if (wt <= 0) { handState[s] = { kind: 'free' }; continue; }
      } else if (g.to === 'top') {
        // (a hand on the wall's top behind him: as far as the arm reaches — then it lets go)
        const sh = ua.getWorldPosition(new Vector3()), arm = armLength(B, s) * 0.95, d = g.p.distanceTo(sh);
        if (d > arm) { wt *= clamp(1 - (d - arm) / 0.15, 0, 1); g.kind = 'moving'; g.p = sh.clone().lerp(g.p, arm / d); }
        if (wt <= 0) { handState[s] = { kind: 'free' }; continue; }
      }
      guard?.touch(ua); guard?.touch(la); guard?.touch(hd);
      const q0 = { ua: ua.quaternion.clone(), la: la.quaternion.clone(), hd: hd.quaternion.clone() };
      hd.getWorldQuaternion(_q2);
      const hpos = hd.getWorldPosition(new Vector3()), mpos = mid ? mid.getWorldPosition(new Vector3()) : hpos.clone().addScaledVector(up, -0.08);
      const d0 = mpos.clone().sub(hpos).normalize();
      // fingers over a rung (forward and up over it), round a stile (forward, in); thumbs in (a rung) / up (a stile);
      // flat on a wall's top behind him (fingers back over its edge)
      const stile = (g.to ?? g.kind) === 'stile', onTop = g.to === 'top';
      // (round a stile from the shoulder's side: over the top he holds it behind him)
      let dF;
      // (on a face: the palm flat on it, fingers up, the fingertips leaning in onto it)
      if (F.face && !onTop) dF = up.clone().multiplyScalar(0.97).addScaledVector(fdir, 0.2).normalize();
      else if (stile) { dF = g.p.clone().sub(ua.getWorldPosition(new Vector3())).setY(0); if (dF.lengthSq() < 1e-4) dF.copy(fdir); dF.normalize().addScaledVector(wdir, -side * 0.3).normalize(); }
      else if (onTop) dF = fdir.clone().multiplyScalar(0.8).addScaledVector(up, -0.45).normalize(); // (over its inner edge)
      else dF = fdir.clone().multiplyScalar(0.75).addScaledVector(up, 0.66).normalize();
      const q1 = new Quaternion().setFromUnitVectors(d0, dF);
      const th = B['thumb_01_' + s];
      let Qd = q1.clone().multiply(_q2);
      if (th) {
        const t0 = th.getWorldPosition(new Vector3()).sub(hpos).applyQuaternion(q1);
        t0.addScaledVector(dF, -t0.dot(dF));
        const tD = (F.face || onTop ? wdir.clone().multiplyScalar(-side) : stile ? up.clone() : wdir.clone().multiplyScalar(-side).addScaledVector(up, -0.3)); tD.addScaledVector(dF, -tD.dot(dF));
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
        poleTurn(ua, la, hd, onTop ? up.clone().multiplyScalar(-0.3).addScaledVector(wdir, side * 0.6).addScaledVector(fdir, -0.6)
          : up.clone().multiplyScalar(-1).addScaledVector(wdir, side * 0.8).addScaledVector(odir, 0.4));
      }
      setWorldQuat(hd, Qd);
      if (wt < 1) { // easing between the grip and his own arm
        ua.quaternion.slerpQuaternions(q0.ua, ua.quaternion.clone(), wt); la.quaternion.slerpQuaternions(q0.la, la.quaternion.clone(), wt); hd.quaternion.slerpQuaternions(q0.hd, hd.quaternion.clone(), wt);
        ua.updateMatrixWorld(true);
      }
      handState[s] = { kind: g.kind, to: g.to, grip: g.p, w: wt };
    }
    return { q, n, onRungs, footState, handState, vault: vu, dbg: { yT, oT, cap, y: S.y, o: S.o } };
  };
  if (g != null) {
    // walking between the link's end and the ladder (its foot, the deck spot past its head; the climb's stance there
    // blended in as he turns to / from it)
    const gw = clamp(g / LEAD_WALK, 0, 1);
    let at = null;
    if (turn > 0) { climbPose(L.top ? 1 : 0); at = capturePose(m); }
    const h0 = root.getWorldPosition(new Vector3()).y;
    // (the walk's steps faded into the standing pose as he gets there — a step cut off mid-stride jumped the feet)
    // (and faded in with the pose: easing in he is still turning from where he stood to the way he walks — striding
    // meanwhile, at the top of M2's camp ladder a boot went into the palisade behind him)
    const ww = (1 - smooth((gw - 0.8) / 0.2)) * W8;
    const walk = ww > 0 ? clipPose(m, 'walk', Math.round(((gw * L.d) / LEAD_STRIDE % 1) * 48) / 48, true) : null;
    const idle = clipPose(m, 'idle', 0);
    if (idle) mixPose(m, idle, 1, guard);
    if (walk) mixPose(m, walk, ww, guard);
    h.object.updateWorldMatrix(true, false);
    B.pelvis.updateMatrixWorld(true);
    const pw = B.pelvis.getWorldPosition(new Vector3()), sp = spot || L.stand;
    // (from the link's end's height to what he stands on at the ladder: a tank's plinth, the walk's planks)
    const yEnd = L.top ? F.top.y : F.foot.y, yAt = (L.top ? F.deckSurf : F.footSurf) ?? yEnd;
    pw.set(sp.x, lerp(yEnd, yAt, smooth(gw)) + (pw.y - h0), sp.z);
    guard?.touch(B.pelvis);
    B.pelvis.position.copy(B.pelvis.parent.worldToLocal(pw));
    B.pelvis.updateMatrixWorld(true);
    if (at) mixPose(m, at, turn, guard);
    if (before) mixPose(m, before, 1 - W8, guard);
    S.state = { P, q: L.top ? Infinity : -1, n: 0, onRungs: 0, lead: g, end: L.top ? 'top' : 'foot', feet: { l: { zone: L.top ? 'deck' : 'ground' }, r: { zone: L.top ? 'deck' : 'ground' } }, hands: { l: { kind: 'free' }, r: { kind: 'free' } }, frame: F };
    return true;
  }
  const { q, n, onRungs, footState, handState, vault: vu, dbg } = climbPose(Pv);
  if (before) mixPose(m, before, 1 - W8, guard);
  // (Pc: the way up the rungs alone, 0 → 1 — the move onto the deck past it — as P was before the leads and that move)
  S.state = { P: Pv, Pc: Math.min(1, Pv / (S.cv ?? 0.75)), q, n, onRungs, vault: vu, feet: footState, hands: handState, frame: F, dbg };
  return true;
}
