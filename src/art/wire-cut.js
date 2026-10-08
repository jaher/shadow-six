/**
 * The Sapper at the wire with his cutters (visual only — the sim never reads any of it). Driven per rendered frame from
 * `unit.cutWire` (abilities/sapper.js: phase 'cut' | 'done' | 'abort' | 'shock', t0, dur, x / z = the hole's centre on
 * the wire, nx / nz = towards him, tx / tz = along the wire) by `cutFrame(unit, dt)` (Commando.renderUpdate).
 *
 * Over the kneeling cut_wire clip (the mixer: legs folded, cutters in the right fist), a procedural overlay after the
 * mixer (UnitModel `overlay` hook, like art/shovel-dig.js): the spine bends down to each strand, the right hand takes
 * the cutters to it (two-bone arm IK, the jaws on the wire) and snips — a squeeze at each CONFIG cutHole.snips time,
 * when the sim plays the snip — while the left hand holds the weave beside the cut; the snips go round the hole's
 * outline (from the top by his left hand over to his right, down and across the bottom), a chord on his left is
 * left joined as the flap's hinge. At `peel` both hands take the flap by its free edge and push it through and round to
 * his left (the wire layer bends the flap on the same clock, wire-obstacles flapOpen), then let go and his arms come
 * back to the clip.
 *
 * Everything is a pure function of the phase time (sim time since `cutWire.t0`), so stepping the game gives the same
 * frames. Cost: two arm IK solves and a few bone turns per frame while he cuts; nothing otherwise.
 * @module art/wire-cut
 */
import * as THREE from 'three';
import { twoBoneIKPole, wpos, rotWorld } from './characters/commandos_a/ca_ik.js';
import { clipPose, mixPose } from './pose-blend.js';
import { HOLE, flapOpen } from './wire-obstacles.js';
import { CONFIG } from '../config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-6, b - a));
const lerp = (a, b, k) => a + (b - a) * k;

/** The kneel, from where he is (m): pelvis height over the ground, its lean forward, the planted left foot and the right knee ahead of it, ankle height. */
const KNEEL = Object.freeze({ pelvis: 0.5, lean: 0.06, front: 0.3, knee: -0.02, ankle: 0.09 });
/** Cutter jaws ahead of the fist (m): the hand stops this short of the strand. */
const JAWS = 0.11;

/**
 * Snip points on the hole's outline as (u along the wire from the hole's centre, y above the ground), one per snip:
 * from the top end of the flap's hinge chord (on his left: u sign `sL`) over the top, down his right side and across
 * the bottom to the chord's bottom end.
 */
export function snipPoints(n, sL = 1) {
  const hw = HOLE.w / 2, hh = HOLE.h / 2, yc = HOLE.y0 + hh, ah = Math.acos(clamp(HOLE.hinge, -1, 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n, a = sL > 0 ? ah + f * (2 * Math.PI - 2 * ah) : Math.PI - ah - f * (2 * Math.PI - 2 * ah);
    out.push({ u: Math.cos(a) * hw * 0.97, y: yc + Math.sin(a) * hh * 0.8 });   // (the bottom strand cut a little up)
  }
  return out;
}

/**
 * Overlay state for a phase time: {w (weight over the clip), R / L (hand targets: {u, y, out} — along the wire, height,
 * towards him off the wire plane), squeeze (0..1 the jaws closing), bend (rad), look ({u, y})}. null = nothing to draw.
 */
export function cutPose(phase, t, dur = CONFIG.abilities.cutters, sL = 1) {
  const H = CONFIG.abilities.cutHole, S = H.snips, pts = snipPoints(S.length, sL);
  if (phase === 'abort' || phase === 'shock') {
    // cancelled (or thrown back by the current): the arms come back over 0.3 s
    const w = 1 - ramp(t, 0, phase === 'shock' ? 0.2 : 0.3);
    if (w <= 0.001) return null;
    const p = pts[0];
    return { w, R: { u: p.u, y: p.y, out: 0.08 + (phase === 'shock' ? 0.25 * ramp(t, 0, 0.12) : 0) }, L: { u: p.u * 0.5, y: p.y + 0.1, out: 0.1 }, squeeze: 0, bend: 0.35, look: p };
  }
  const done = phase === 'done';
  const tt = done ? dur + t : t;
  const w = ramp(tt, 0.1, 0.62) * (1 - ramp(tt, dur - 0.1, dur + 0.5));
  if (w <= 0.001 && tt > 1) return null;
  // the right hand: to each snip point by its time (arriving 0.12 s early), an arc 6 cm off the wire between them
  let R, squeeze = 0, k = 0;
  while (k < S.length && tt > S[k]) k++;
  const at = (i) => pts[clamp(i, 0, pts.length - 1)];
  if (tt < H.peel) {
    if (k === 0) { const p = at(0); R = { u: p.u, y: p.y, out: lerp(0.25, 0.015, ramp(tt, 0.35, S[0] - 0.12)) }; }
    else {
      const a = at(k - 1), b = at(k), t0 = S[k - 1], t1 = k < S.length ? S[k] - 0.12 : t0 + 0.3, f = k < S.length ? ramp(tt, t0 + 0.06, t1) : 0;
      R = { u: lerp(a.u, b.u, f), y: lerp(a.y, b.y, f), out: 0.015 + 0.06 * Math.sin(Math.PI * f) };
    }
    for (const s of S) squeeze = Math.max(squeeze, 1 - Math.abs(tt - s) / 0.09);
    squeeze = clamp(squeeze, 0, 1);
  }
  // the left hand holds the weave beside the cut, a little in from it and pulled back towards him
  const ref = R || at(S.length - 1);
  let L = { u: ref.u * 0.55 + (ref.u >= 0 ? -0.12 : 0.12), y: ref.y + 0.12, out: 0.03 };
  // the peel: both hands on the flap near its free edge, pushing it through and round its hinge on his left as it
  // swings (flapOpen on the sim clock) — as far as he reaches through the wire, then he lets go
  if (tt >= H.peel - 0.25) {
    const reach = ramp(tt, H.peel - 0.25, H.peel), hw = HOLE.w / 2, yc = HOLE.y0 + HOLE.h / 2, r = hw * (1 + HOLE.hinge) * 0.62;
    const ph = flapOpen(Math.max(0, tt - H.peel)) * (HOLE.flapAngle + HOLE.flapCurl * 0.38), uh = sL * HOLE.hinge * hw;
    const edge = (dy) => ({ u: uh - sL * r * Math.cos(ph), y: yc + dy, out: Math.max(-0.28, -r * Math.sin(ph)) });   // away from him (out < 0)
    const lift = 1 - ramp(tt, H.peel + 0.32, H.peel + 0.5);   // let go once it is past his reach
    const eR = edge(-0.1), eL = edge(0.12);
    const blend = (a, b, f) => ({ u: lerp(a.u, b.u, f), y: lerp(a.y, b.y, f), out: lerp(a.out, b.out, f) });
    const back = { u: 0, y: yc + 0.3, out: 0.12 };
    R = blend(R || back, lift > 0 ? eR : back, tt < H.peel ? reach : 1);
    L = blend(L, lift > 0 ? eL : back, tt < H.peel ? reach : 1);
    if (lift < 1) { R = blend(back, R, lift); L = blend(back, L, lift); }
  }
  const tgt = R || L;
  const bend = clamp(0.25 + (0.8 - tgt.y) * 0.75, 0.2, 0.75);
  return { w, R, L, squeeze, bend, look: tgt };
}

// ------------------------------------------------------------------ skeleton overlay

const _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _u = new THREE.Vector3(0, 1, 0);
const SPINE = [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]];

function turnWorld(b, axis, angle) {
  if (!b || Math.abs(angle) < 1e-5) return;
  b.parent.getWorldQuaternion(_q2);
  const local = _a.copy(axis).applyQuaternion(_q2.invert()).normalize();
  _q.setFromAxisAngle(local, angle);
  b.quaternion.premultiply(_q);
  b.updateMatrixWorld(true);
}

/**
 * Write the cutting pose on the model's bones. W = {x, z, tx, tz, nx, nz, gy (ground y at the hole)}. @returns {boolean}
 */
export function applyCutPose(m, P, W, guard) {
  const B = m.real?.inner?.bones;
  if (!B || !B.hand_r || !B.hand_l || !B.upperarm_r || !B.upperarm_l || !P) return false;
  m.root.updateMatrixWorld(true);
  const pre = [];
  const keep = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
    'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'clavicle_l'];
  for (const n of keep) if (B[n]) { guard?.touch(B[n]); pre.push([B[n], B[n].quaternion.clone()]); }
  const pel0 = B.pelvis ? B.pelvis.position.clone() : null;
  const world = (q) => new THREE.Vector3(W.x + W.tx * q.u + W.nx * q.out, W.gy + q.y, W.z + W.tz * q.u + W.nz * q.out);
  const root = m.root;
  root.getWorldQuaternion(_q);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_q), left = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
  fwd.y = 0; fwd.normalize(); left.y = 0; left.normalize();
  const bendAxis = left.clone().negate();
  // the kneel (whatever the clip does with its legs): pelvis down to KNEEL.pelvis over the ground, the left foot
  // planted ahead, the right knee on the ground with the shin back along it, toes tucked
  if (B.pelvis && B.thigh_l && B.calf_l && B.foot_l && B.thigh_r && B.calf_r && B.foot_r) {
    const g = W.gyMe ?? W.gy, pel = B.pelvis, par = pel.parent;
    const pw = wpos(pel), base = new THREE.Vector3(pw.x, g, pw.z);
    const target = base.clone().addScaledVector(_u, KNEEL.pelvis).addScaledVector(fwd, KNEEL.lean);
    par.updateWorldMatrix(true, false);
    pel.position.copy(par.worldToLocal(target.clone()));
    pel.updateMatrixWorld(true);
    const fq = B.foot_l.getWorldQuaternion(new THREE.Quaternion());
    const footL = base.clone().addScaledVector(fwd, KNEEL.front).addScaledVector(left, 0.13).addScaledVector(_u, KNEEL.ankle);
    twoBoneIKPole(B.thigh_l, B.calf_l, B.foot_l, footL, footL.clone().addScaledVector(fwd, 0.8).addScaledVector(_u, 0.5), fq);
    const knee = base.clone().addScaledVector(fwd, KNEEL.knee).addScaledVector(left, -0.12).addScaledVector(_u, 0.07);
    const footR = knee.clone().addScaledVector(fwd, -0.4).addScaledVector(_u, 0.07);
    twoBoneIKPole(B.thigh_r, B.calf_r, B.foot_r, footR, knee.clone().addScaledVector(_u, -0.3).addScaledVector(fwd, 0.2));
    // toes tucked under: the foot pitched down behind the knee
    if (B.ball_r) { const f = wpos(B.ball_r).sub(wpos(B.foot_r)).normalize(), want = fwd.clone().multiplyScalar(-0.75).addScaledVector(_u, -0.65).normalize(); rotWorld(B.foot_r, new THREE.Quaternion().setFromUnitVectors(f, want)); }
  }
  // spine: bend forward towards the wire (about his right-hand axis)
  for (const [n, k] of SPINE) turnWorld(B[n], bendAxis, -P.bend * k);
  const look = world(P.look);
  // arms: the right fist short of the strand by the jaws (squeezing in a little at the snip), the left on the weave
  const shR = wpos(B.upperarm_r), shL = wpos(B.upperarm_l);
  const tR = world(P.R), dirR = tR.clone().sub(shR).normalize();
  const fistR = tR.clone().addScaledVector(dirR, -JAWS + 0.02 * P.squeeze);
  twoBoneIKPole(B.upperarm_r, B.lowerarm_r, B.hand_r, fistR, shR.clone().addScaledVector(left, -0.45).addScaledVector(_u, -0.5).addScaledVector(fwd, -0.1));
  // the cutters point at the strand: turn the fist so its finger axis follows the line shoulder → strand
  if (B.middle_01_r) {
    const h = wpos(B.hand_r), f = wpos(B.middle_01_r).sub(h).normalize();
    rotWorld(B.hand_r, new THREE.Quaternion().setFromUnitVectors(f, tR.clone().sub(h).normalize()).slerp(new THREE.Quaternion(), 0.25));
  }
  const tL = world(P.L);
  twoBoneIKPole(B.upperarm_l, B.lowerarm_l, B.hand_l, tL, shL.clone().addScaledVector(left, 0.45).addScaledVector(_u, -0.5).addScaledVector(fwd, -0.1));
  if (B.middle_01_l) {
    const h = wpos(B.hand_l), f = wpos(B.middle_01_l).sub(h).normalize(), want = tL.clone().sub(wpos(B.lowerarm_l)).normalize().addScaledVector(fwd, 0.4).normalize();
    rotWorld(B.hand_l, new THREE.Quaternion().setFromUnitVectors(f, want).slerp(new THREE.Quaternion(), 0.3));
  }
  // head: eyes down on the cut
  if (B.neck_01) turnWorld(B.neck_01, bendAxis, -0.25 * P.bend - 0.15);
  void look;
  // weight over the clip
  if (P.w < 0.999) {
    // from / back to where he was: lying (a crawler gets up onto his knee from the prone pose and lies back down
    // into it — not the mixer's cross-fade through the standing clip) or the clip
    const base = W.prone ? clipPose(m, 'crawl_idle_unarmed', 0) || clipPose(m, 'crawl_idle', 0) : null;
    if (base) { for (const k in B) guard?.touch(B[k]); mixPose(m, base, 1 - P.w, guard); }
    else {
      if (pel0) B.pelvis.position.lerpVectors(pel0, B.pelvis.position.clone(), P.w);
      for (const [b, q0] of pre) b.quaternion.copy(q0.slerp(b.quaternion.clone(), P.w));
    }
    m.root.updateMatrixWorld(true);
  }
  return true;
}

// ------------------------------------------------------------------ per-frame driver

/** Per rendered frame (Commando.renderUpdate, before the model update). Visual state in `unit._cutVis`. */
export function cutFrame(u, dt) {
  const c = u.cutWire, w = u.world, m = u.model;
  let V = u._cutVis;
  const unhook = () => { if (m?.overlay && V?.hooked) { m.overlay = null; V.hooked = false; m._weaponFor?.(m._ctx()); } };
  if (!c) { if (V) { unhook(); u._cutVis = null; } return; }
  const stamp = `${c.phase}@${c.t0}`;
  if (V?.idle === stamp) return;
  if (!V) V = u._cutVis = { hooked: false, idle: null, pose: null, W: null };
  const now = w?.time ?? 0;
  let phase = c.phase, t = Math.max(0, now - c.t0);
  // a cut whose action ended without its last step (killed, knocked down, the order taken back): drawn as cancelled
  if (phase === 'cut' && (u.currentActionId !== 'cutters' || !u.alive)) { V.cut ??= now; phase = 'abort'; t = now - V.cut; } else V.cut = null;
  // the flap's hinge on his left (wire-obstacles holeHingeSide): its sign along (tx, tz)
  const sL = -c.nz * (c.tx ?? -c.nz) + c.nx * (c.tz ?? c.nx) >= 0 ? 1 : -1;
  const P = u.alive && !u.downed ? cutPose(phase, t, c.dur, sL) : null;
  // kneeling square to the hole, his hips `standoff` from the wire: the sim stops him on the first walkable spot, up
  // to a cell further back — the body is drawn the rest of the way in (view only), and back out as he finishes
  const o3 = u.object3d, kIn = P ? clamp(P.w * 1.6, 0, 1) : 0;
  if (o3 && kIn > 0) {
    const d = (u.x - c.x) * c.nx + (u.z - c.z) * c.nz, l = (u.x - c.x) * (c.tx ?? -c.nz) + (u.z - c.z) * (c.tz ?? c.nx);
    const back = clamp(d - CONFIG.abilities.cutHole.standoff, 0, 0.5) * kIn, side = clamp(l, -0.4, 0.4) * kIn;
    o3.position.x -= c.nx * back + (c.tx ?? -c.nz) * side;
    o3.position.z -= c.nz * back + (c.tz ?? c.nx) * side;
  }
  if (P && m?.real?.inner) {
    const gy = w?.groundY ? w.groundY(c.x, c.z) || 0 : 0, gyMe = w?.groundY && o3 ? w.groundY(o3.position.x, o3.position.z) || 0 : gy;
    V.W = { x: c.x, z: c.z, tx: c.tx ?? -c.nz, tz: c.tz ?? c.nx, nx: c.nx, nz: c.nz, gy, gyMe, prone: !!c.prone && u.stance === 'crawl' };
    V.pose = P;
    if (!m.overlay) { m.overlay = (mm, _dt, guard) => applyCutPose(mm, V.pose, V.W, guard); V.hooked = true; }
  } else {
    unhook();
    if (phase !== 'cut') V.idle = stamp;
  }
}
