#!/usr/bin/env node
// bake_barrel.mjs - the Green Beret's explosive-drum set on his own skeleton (CC0 project code), and the grip module.
//
//   node --import ./tools/characters/prone/node-three.mjs tools/characters/barrel/bake_barrel.mjs [--out=DIR] [--check] [--verbose]
//     (tuning: --yb=0.58 drum base height in the hold, --tilt=12 its lean back (deg), --kneeout=0.45 the walk's knee pole)
//   GLTF_DEPS=<dir>/node_modules node tools/characters/prone/write_anims.mjs <DIR>/barrel_clips.json \
//     --only=barrel_idle,barrel_walk,barrel_turn,barrel_lift,barrel_put_down assets/characters/anims/ca_anims.glb
//
// Writes <out>/barrel_clips.json (local rotations + pelvis positions in the anim library's UAL space, per-clip meta, the
// drum frame per sample) and src/art/characters/barrel-grip.js (the drum's base frame in each hand bone's space, the
// clips' contact / release times: art/barrel-carry.js reads the drum back off his hands).
//
// The hold (user 2026-10-22, "in the spirit of the original game: he hugs the drum in front of his chest, arms round
// it, and walks it with a heavy, slower gait"): the drum stands against his belly and chest, tilted 12 deg back against
// him, its top rim ~8 cm under his chin; palms flat on its sides a little behind the widest line, fingers round
// it, thumbs up, elbows out; he leans back under it on bent knees and walks it in short, wide, flat-footed steps with a
// waddle over each stance foot (CONFIG.units.carryBarrel, slower than a man on the shoulder). Pick-up: he squats wide
// to it (knees round it), his hands go onto its sides, he sets and stands up with it, pulling it in to his chest
// (CONFIG.abilities.carry.pick; he stopped `reach` short of the solid drum, so he steps in to it first: carry.barrel);
// the set-down lowers it to the ground ahead of his feet (dropSpot: 0.6 m), lets go and steps back off it.
// The bake checks every sample against his skinned meshes (fit.mjs) and fails on a body vertex > 1 cm inside the drum.
import { writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { CONFIG } from '../../../src/config.js';
import {
  loadGB, snapRest, torso, shoulders, leg, ankleFor, drumFrame, gripDrum, gripOf, handTo, curl,
  DRUM, GRIP, D2R, V, sstep, lerp, frac, loadGlb,
} from './barrel_pose.mjs';
import { clearance, fmtClear } from './fit.mjs';

const ROOT = new URL('../../../', import.meta.url);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', new URL('out/', import.meta.url).pathname);
const VERBOSE = process.argv.includes('--verbose');
mkdirSync(OUT, { recursive: true });

const R = await loadGB(ROOT);
snapRest(R);
const base = await loadGlb(new URL('assets/characters/anims/base_anims.glb', ROOT).pathname);
let bud = base.scene.userData.shadowSix; if (!bud) base.scene.traverse((o) => { if (!bud && o.userData?.shadowSix) bud = o.userData.shadowSix; });
const SRC_REST = V(...bud.pelvisRest), TGT_REST = V(...R.info.pelvisRest), RATIO = R.info.pelvisRatio || 1;
/** Pelvis local position on his skeleton → the library's UAL space (charkit.adaptClip maps it back for each body). */
const toSrc = (p) => V(...p).sub(TGT_REST).multiplyScalar(1 / RATIO).add(SRC_REST).toArray();

// ------------------------------------------------------------------ the hold
const SPEED = CONFIG.units.carryBarrel ?? CONFIG.units.carry;   // m/s (sim)
const PICK = CONFIG.abilities.carry.pick, DROP = CONFIG.abilities.carry.drop;
/** Standing hold: hip-joint centre, pelvis pitch, back lean, head pitch, shoulders, the drum's tilt and base height. */
const HOLD = { hipY: 0.99, hipZ: -0.02, pitch: -0.05, back: 0.20, head: 0.12, neck: 0.1, prot: 0.15, elev: 0.04, tilt: +arg('tilt', 12) * D2R, yb: +arg('yb', 0.58), footX: 0.15, footYaw: 0.12 };
const DROP_D = 0.60;    // m: where it is stood down (abilities/common.js dropSpot)

function feet(o = {}) {
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1, f = o[s] || {};
    const yaw = sx * (f.yaw ?? HOLD.footYaw), at = V(sx * (f.x ?? HOLD.footX), 0, f.z ?? sx * 0.03);
    const A = ankleFor(R, s, at, yaw, f.pitch || 0, f.lift || 0);
    leg(R, s, A, V(sx * (f.out ?? 0.25), 0, 1).normalize(), yaw, f.pitch || 0, (f.pitch || 0) > 0 && !f.lift);
  }
}
/** Body (no arms) of the standing hold, with per-frame offsets. */
function holdBody(o = {}) {
  R.reset();
  torso(R, {
    hip: V(o.x || 0, HOLD.hipY + (o.y || 0), HOLD.hipZ + (o.z || 0)), yaw: o.yaw || 0, pitch: HOLD.pitch + (o.pitch || 0), roll: o.roll || 0,
    back: HOLD.back + (o.back || 0), twist: o.twist || 0, side: o.side || 0, head: HOLD.head + (o.head || 0), neck: HOLD.neck,
  });
  shoulders(R, HOLD.prot, HOLD.elev + (o.elev || 0));
  feet(o.feet);
}
const chestM = () => { R.update(); return R.B.spine_03.matrixWorld.clone(); };

// the drum in the reference hold: against his belly / chest (closest torso or head vertex 1.2 cm off), its base at yb
holdBody();
const C0 = chestM();
const drumAt = (z) => drumFrame(V(0, HOLD.yb, z), HOLD.tilt);
let lo = 0.2, hi = 1.2;
for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2, c = clearance(R, drumAt(m)); if (Math.min(c.torso.min, c.head.min, c.leg.min) < 0.012) lo = m; else hi = m; }
const M0 = drumAt(hi);
/** The drum frame relative to his chest bone (constant through the hold clips). */
const D_CHEST = C0.clone().invert().multiply(M0);
const holdDrum = () => chestM().multiply(D_CHEST);

// ------------------------------------------------------------------ clip sampling + checks
const clips = [];
const report = [];
let worst = { body: 1, hand: 1 };
function sample(name, dur, fps, pose, meta = {}) {
  const n = Math.max(2, Math.round(dur * fps) + 1), frames = [], drum = [], hands = [];
  let maxErr = 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur;
    const o = pose(t) || {};
    R.update();
    const s = R.snap();
    frames.push({ q: s.q, p: toSrc(s.p) });
    drum.push(o.M ? [...o.M.elements] : null);
    maxErr = Math.max(maxErr, o.err || 0);
    if (o.M) {
      const c = clearance(R, o.M);
      const body = Math.min(c.torso.min, c.arm.min, c.leg.min, c.head.min), hand = Math.min(c.handL.min, c.handR.min);
      worst.body = Math.min(worst.body, body); worst.hand = Math.min(worst.hand, hand);
      const basePt = V(0, 0, 0).applyMatrix4(o.M), ax = V(0, DRUM.h, 0).applyMatrix4(o.M).sub(basePt).normalize();
      const top = V(0, DRUM.h, 0).applyMatrix4(o.M).add(V(0, DRUM.r * Math.sqrt(Math.max(0, 1 - ax.y * ax.y)), 0));   // highest point of its top rim
      rows.push({ t, c, top: top.y, chin: c.chin, base: basePt.y, grip: !!o.grip });
      if (o.grip) {   // the drum read back from each hand (the run-time path) must be where it was authored
        for (const sd of ['l', 'r']) {
          const H = R.B['hand_' + sd].matrixWorld;
          hands.push({ t, s: sd, m: H.clone().invert().multiply(o.M) });
        }
      }
      if (VERBOSE) console.log(`  ${name} t=${t.toFixed(2)} ${fmtClear(c)}  drum base ${basePt.y.toFixed(2)} top ${top.y.toFixed(2)} chin ${c.chin.toFixed(2)} err ${((o.err || 0) * 100).toFixed(1)}`);
    }
  }
  const c = { name, duration: dur, fps, frames, drum, meta: { source: 'procedural keyframes (tools/characters/barrel)', license: 'CC0 (project-authored)', ...meta } };
  clips.push(c);
  report.push({ name, n, maxErr, rows, hands });
  return c;
}

// ------------------------------------------------------------------ barrel_idle (loop)
const IDLE_T = 3.2;
sample('barrel_idle', IDLE_T, 15, (t) => {
  const b = Math.sin(2 * Math.PI * t / IDLE_T), b2 = Math.sin(4 * Math.PI * t / IDLE_T);
  holdBody({ x: 0.012 * b, y: 0.004 * b2, back: 0.012 * b2, side: -0.01 * b, elev: 0.01 * b2 });
  const M = holdDrum();
  return { M, err: gripDrum(R, M), grip: true };
}, { loop: true, barrel: 'hold' });

// ------------------------------------------------------------------ barrel_walk (loop): short, wide, heavy steps
const STEP = 0.62, CYCLE = 2 * STEP, WALK_T = CYCLE / SPEED, DUTY = 0.64, TRAVEL = CYCLE * DUTY;
const SWING_H = 0.06, HEEL = -6 * D2R, TOE = 16 * D2R, KNEE_OUT = +(arg('kneeout', 0.45));
/** Foot of side s at gait phase psi (0 = its heel strike): ground point, pitch, lift. */
function gaitFoot(psi, travel = TRAVEL, swingH = SWING_H) {
  const zS = travel / 2 - 0.045;
  if (psi < DUTY) {
    const u = psi / DUTY;
    const pitch = u < 0.14 ? HEEL * (1 - sstep(u / 0.14)) : u > 0.68 ? TOE * sstep((u - 0.68) / 0.32) : 0;
    return { z: zS - travel * u, pitch, lift: 0 };
  }
  const w = (psi - DUTY) / (1 - DUTY), e = 0.5 - 0.5 * Math.cos(Math.PI * w);
  const pitch = lerp(TOE, HEEL, sstep(w)) - 6 * D2R * Math.sin(Math.PI * w);
  return { z: lerp(zS - travel, zS, e), pitch, lift: swingH * Math.pow(Math.sin(Math.PI * Math.min(1, w * 1.08)), 1.3) };
}
function walkPose(t, T, travel, swingH, k = 1) {
  const ph = frac(t / T), mid = DUTY / 2;
  const fl = gaitFoot(ph, travel, swingH), fr = gaitFoot(frac(ph - 0.5), travel, swingH);
  const c2 = Math.cos(4 * Math.PI * (ph - mid)), c1 = Math.cos(2 * Math.PI * (ph - mid)), s1 = Math.sin(2 * Math.PI * ph);
  holdBody({
    x: 0.034 * c1, y: -0.012 + 0.013 * c2 * k, z: -0.006 * c2 * k,
    yaw: -4 * D2R * Math.cos(2 * Math.PI * ph) * k, roll: 3 * D2R * s1, twist: 2.4 * D2R * Math.cos(2 * Math.PI * ph) * k,
    side: -3.5 * D2R * s1, back: 0.012 * Math.cos(4 * Math.PI * (ph - 0.4)) * k, head: -0.01 * c2,
    feet: { l: { out: KNEE_OUT, z: fl.z, pitch: fl.pitch, lift: fl.lift, x: HOLD.footX - 0.012 * (fl.lift > 0 ? 1 : 0) * Math.sin(Math.PI * fl.lift / swingH) },
      r: { out: KNEE_OUT, z: fr.z, pitch: fr.pitch, lift: fr.lift, x: HOLD.footX - 0.012 * (fr.lift > 0 ? 1 : 0) * Math.sin(Math.PI * fr.lift / swingH) } },
  });
  const M = holdDrum();
  return { M, err: gripDrum(R, M), grip: true };
}
sample('barrel_walk', WALK_T, 30, (t) => walkPose(t, WALK_T, TRAVEL, SWING_H), {
  // (groundSpeed in the library's UAL metres: charkit plays a clip at speed / (groundSpeed × the body's pelvisRatio), and
  // this one was stepped out on his own legs)
  loop: true, loco: true, barrel: 'hold', groundSpeed: +(SPEED / RATIO).toFixed(4), stride: STEP, spm: Math.round(120 / WALK_T), duty: DUTY,
});

// ------------------------------------------------------------------ barrel_turn (loop): stepping round on the spot
const TURN_T = 0.8;
sample('barrel_turn', TURN_T, 30, (t) => walkPose(t, TURN_T, 0.0, 0.04, 0.5), { loop: true, barrel: 'hold', turn: true });

// ------------------------------------------------------------------ barrel_lift / barrel_put_down
/** A crouched pose over the drum on the ground: wide squat, knees round it, back hinged forward. */
const SQUAT = { hip: V(0, 0.66, -0.20), pitch: 0.62, back: -0.30, head: 0.62, neck: 0.25, footX: 0.19, out: 0.75, prot: 0.22 };
const STAND = { hip: V(0, 1.02, 0), pitch: 0, back: 0.0, head: 0.08, neck: 0.1, footX: 0.12, out: 0.25, prot: 0.0 };
const HOLDK = { hip: V(0, HOLD.hipY, HOLD.hipZ), pitch: HOLD.pitch, back: HOLD.back, head: HOLD.head, neck: HOLD.neck, footX: HOLD.footX, out: 0.25, prot: HOLD.prot };
const mixK = (a, b, u) => ({ hip: a.hip.clone().lerp(b.hip, u), pitch: lerp(a.pitch, b.pitch, u), back: lerp(a.back, b.back, u), head: lerp(a.head, b.head, u),
  neck: lerp(a.neck, b.neck, u), footX: lerp(a.footX, b.footX, u), out: lerp(a.out, b.out, u), prot: lerp(a.prot, b.prot, u) });
function keyBody(K) {
  R.reset();
  torso(R, { hip: K.hip, pitch: K.pitch, back: K.back, head: K.head, neck: K.neck });
  shoulders(R, K.prot, HOLD.elev);
  feet({ l: { x: K.footX, out: K.out }, r: { x: K.footX, out: K.out } });
}
const groundDrum = (d) => drumFrame(V(0, 0, d), 0);
/** Drum frame between the ground (at d) and the hold (Mh), u = 0..1: in toward him first, up, tilted back last. */
function carryPath(d, Mh, u) {
  const p0 = V(0, 0, d), p1 = new THREE.Vector3().setFromMatrixPosition(Mh);
  const q1 = new THREE.Quaternion().setFromRotationMatrix(Mh);
  const up = sstep(u), inz = sstep(Math.min(1, u * 1.25)), tl = sstep((u - 0.3) / 0.7);
  const p = V(lerp(p0.x, p1.x, inz), lerp(p0.y, p1.y, up), lerp(p0.z, p1.z, inz));
  const q = new THREE.Quaternion().slerp(q1, tl);
  return new THREE.Matrix4().compose(p, q, V(1, 1, 1));
}
// the hold drum (world) of barrel_idle's first frame: where the lift ends and the set-down starts
holdBody(); const M_HOLD = holdDrum();
/** Hands from hanging at his sides onto the grip of drum M (u = 0..1), coming in from outside and above it. */
function reachTo(M, u, relaxed) {
  let err = 0;
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1, g = gripOf(M, s);
    const hang = relaxed[s];
    const out = g.N.clone().negate().multiplyScalar(0.07).add(V(0, 0.05, 0));    // pre-grip: off the side, a little above
    const a = sstep(u / 0.75), b = sstep((u - 0.75) / 0.25);
    const P = hang.p.clone().lerp(g.palm.clone().add(out), a).lerp(g.palm, b);
    const F = hang.F.clone().lerp(g.F, sstep(u)).normalize(), N = hang.N.clone().lerp(g.N, sstep(u)).normalize();
    const e = handTo(R, s, P, F, N, V(sx, -0.6, -0.55));
    if (u >= 1) err = Math.max(err, e);
    curl(R, s, lerp(0.2, GRIP.curl, sstep(u)), lerp(0.2, GRIP.thumb, sstep(u)));
  }
  return err;
}
/** Hanging palms (world) for the current body: beside the thighs. */
function hangTargets() {
  const out = {};
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1, sh = R.wp('upperarm_' + s);
    out[s] = { p: sh.clone().add(V(sx * 0.06, -0.62, 0.04)), F: V(0, -1, 0.15).normalize(), N: V(-sx, 0, 0.1).normalize() };
  }
  return out;
}
// lift: he stops `reach` short of the drum (it is solid: abilities/shared.js), so the pick-up steps him in to `stand`
// (left foot, right foot) as he goes down; the sim moves his root over the same `step` s with the same ease
const BAR = CONFIG.abilities.carry.barrel, STEP_D = +(CONFIG.abilities.carry.reach - 0.01 - BAR.stand).toFixed(3), T_STEP = BAR.step;
const TC = 0.5, TSET = 0.6;         // hands on the drum; the set before the stand-up
const rootAt = (t) => STEP_D * sstep(t / T_STEP);   // his root along the step (abilities/shared.js barrelStep: same curve)
/** A foot stepping from (x0, z0) to (x1, z1) (final-root frame) over [t0, t1]. */
function stepFoot(t, x0, z0, x1, z1, t0, t1, h = 0.07) {
  const w = Math.min(1, Math.max(0, (t - t0) / (t1 - t0))), e = sstep(w);
  return { x: lerp(x0, x1, e), z: lerp(z0, z1, e), lift: h * Math.sin(Math.PI * w), pitch: w > 0 && w < 1 ? lerp(10, -6, w) * D2R : 0 };
}
function liftBody(K, t) {
  const off = STEP_D - rootAt(t);   // final-root frame → model space (the root still has `off` m to go)
  R.reset();
  torso(R, { hip: K.hip.clone().add(V(0, 0, off)), pitch: K.pitch, back: K.back, head: K.head, neck: K.neck });
  shoulders(R, K.prot, HOLD.elev);
  const fl = stepFoot(t, 0.12, -STEP_D, K.footX, 0, 0.02, 0.2), fr = stepFoot(t, 0.12, -STEP_D, K.footX, 0, 0.2, 0.38);
  feet({ l: { x: fl.x, z: fl.z + off, lift: fl.lift, pitch: fl.pitch, out: K.out, yaw: HOLD.footYaw }, r: { x: fr.x, z: fr.z + off, lift: fr.lift, pitch: fr.pitch, out: K.out, yaw: HOLD.footYaw } });
  return off;
}
sample('barrel_lift', PICK, 30, (t) => {
  if (t <= TC) {
    const u = t / TC;
    const off = liftBody(mixK(STAND, SQUAT, sstep(Math.max(0, (t - 0.06) / (TC - 0.06)))), t);
    const M = groundDrum(BAR.stand + off);
    const err = reachTo(M, sstep(Math.max(0, (t - 0.1) / (TC - 0.1))), hangTargets());
    return { M, err, grip: u >= 1 };
  }
  if (t <= TSET) {
    const u = (t - TC) / (TSET - TC);
    const K = mixK(SQUAT, SQUAT, 0); K.hip = SQUAT.hip.clone().add(V(0, -0.02 * Math.sin(Math.PI * u), -0.02 * sstep(u))); K.pitch = SQUAT.pitch - 0.04 * sstep(u);
    liftBody(K, t);
    const M = groundDrum(BAR.stand);
    return { M, err: gripDrum(R, M), grip: true };
  }
  const u = (t - TSET) / (PICK - TSET);
  const K0 = mixK(SQUAT, SQUAT, 0); K0.hip = SQUAT.hip.clone().add(V(0, 0, -0.02)); K0.pitch = SQUAT.pitch - 0.04;
  liftBody(mixK(K0, HOLDK, sstep(u)), t);
  const M = carryPath(BAR.stand, M_HOLD, Math.pow(u, 0.9));
  return { M, err: gripDrum(R, M), grip: true };
}, { loop: false, barrel: 'lift', contact: TC, d: BAR.stand, step: STEP_D, stepT: T_STEP });

const TR = 0.48;                    // set-down: the drum on the ground, hands off after
const SQUAT_D = { ...SQUAT, hip: V(0, 0.68, -0.24), pitch: 0.66, back: -0.30 };
const RISE = { hip: V(0, 0.96, -0.04), pitch: 0.12, back: 0.0, head: 0.15, neck: 0.1, footX: 0.16, out: 0.3, prot: 0.05 };
// then he steps back off it (abilities/shared.js barrelBack: the sim moves his root `back` m over [backAt, drop], eased)
const backAt = (t) => -BAR.back * sstep((t - BAR.backAt) / (DROP - BAR.backAt));
function putBody(K, t) {
  const off = -backAt(t);   // initial-root frame → model space: his root is `off` m behind where it was
  R.reset();
  torso(R, { hip: K.hip.clone().add(V(0, 0, 0)), pitch: K.pitch, back: K.back, head: K.head, neck: K.neck });
  shoulders(R, K.prot, HOLD.elev);
  const fl = stepFoot(t, K.footX, 0, K.footX, -BAR.back, BAR.backAt + 0.02, BAR.backAt + 0.16, 0.05);
  const fr = stepFoot(t, K.footX, 0, K.footX, -BAR.back, BAR.backAt + 0.15, DROP, 0.05);
  feet({ l: { x: fl.x, z: fl.z + off, lift: fl.lift, pitch: -fl.pitch * 0.5, out: K.out, yaw: HOLD.footYaw }, r: { x: fr.x, z: fr.z + off, lift: fr.lift, pitch: -fr.pitch * 0.5, out: K.out, yaw: HOLD.footYaw } });
  return off;
}
sample('barrel_put_down', DROP, 30, (t) => {
  if (t <= TR) {
    const u = t / TR;
    putBody(mixK(HOLDK, SQUAT_D, sstep(u)), t);
    const M = carryPath(DROP_D, M_HOLD, 1 - Math.pow(u, 1.1));
    return { M, err: gripDrum(R, M), grip: true };
  }
  const u = (t - TR) / (DROP - TR);
  const off = putBody(mixK(SQUAT_D, RISE, sstep(u)), t);
  const M = groundDrum(DROP_D + off);
  const hang = hangTargets();
  // hands off the drum: outward and up off its sides, then down to his sides
  let err = 0;
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1, g = gripOf(M, s);
    const offP = g.palm.clone().add(g.N.clone().negate().multiplyScalar(0.08)).add(V(0, 0.06, -0.04));
    const a = sstep(u / 0.4), b = sstep((u - 0.3) / 0.7);
    const P = g.palm.clone().lerp(offP, a).lerp(hang[s].p, b);
    const F = g.F.clone().lerp(hang[s].F, b).normalize(), N = g.N.clone().lerp(hang[s].N, b).normalize();
    handTo(R, s, P, F, N, V(sx, -0.6, -0.55));
    curl(R, s, lerp(GRIP.curl, 0.2, b), lerp(GRIP.thumb, 0.2, b));
  }
  return { M, err };
}, { loop: false, barrel: 'putDown', release: TR, d: DROP_D, back: BAR.back, backAt: BAR.backAt });

// ------------------------------------------------------------------ report + grip module
let fail = false;
for (const r of report) {
  const rr = r.rows;
  const mins = {}; for (const k of ['torso', 'arm', 'leg', 'head', 'handL', 'handR']) mins[k] = Math.min(...rr.map((x) => x.c[k].min));
  const deep = {}; for (const k of ['torso', 'arm', 'leg', 'head', 'handL', 'handR']) deep[k] = Math.max(...rr.map((x) => x.c[k].deep));
  const held = rr.filter((x) => x.grip && x.base > 0.3);
  const topChin = held.length ? Math.min(...held.map((x) => x.chin - x.top)) : null;
  console.log(`${r.name.padEnd(16)} ${r.n} samples  palm err max ${(r.maxErr * 100).toFixed(1)} cm  closest (cm): ${Object.entries(mins).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}${deep[k] ? `(!${deep[k]})` : ''}`).join(' ')}${topChin != null ? `  drum top under chin >= ${(topChin * 100).toFixed(1)} cm` : ''}`);
  if (['torso', 'arm', 'leg', 'head'].some((k) => deep[k] > 0) || r.maxErr > 0.01) fail = true;
}
// the drum in each hand bone's space: one constant for every gripping sample (the run time reads it back)
const all = report.flatMap((r) => r.hands);
const avg = {};
for (const s of ['l', 'r']) {
  const H = all.filter((h) => h.s === s);
  const p = V(), q = new THREE.Quaternion(0, 0, 0, 0), ref = new THREE.Quaternion().setFromRotationMatrix(H[0].m);
  for (const h of H) { p.add(V().setFromMatrixPosition(h.m)); const hq = new THREE.Quaternion().setFromRotationMatrix(h.m); if (hq.dot(ref) < 0) hq.set(-hq.x, -hq.y, -hq.z, -hq.w); q.x += hq.x; q.y += hq.y; q.z += hq.z; q.w += hq.w; }
  p.multiplyScalar(1 / H.length); q.normalize();
  let dev = 0, adev = 0;
  for (const h of H) { dev = Math.max(dev, V().setFromMatrixPosition(h.m).distanceTo(p)); adev = Math.max(adev, new THREE.Quaternion().setFromRotationMatrix(h.m).angleTo(q)); }
  avg[s] = { p: p.toArray().map((v) => +v.toFixed(5)), q: q.toArray().map((v) => +v.toFixed(6)) };
  if (VERBOSE) for (const r of report) { let a = 0; for (const h of r.hands.filter((x) => x.s === s)) a = Math.max(a, new THREE.Quaternion().setFromRotationMatrix(h.m).angleTo(q)); console.log(`  grip ${s} ${r.name}: ${(a / D2R).toFixed(2)} deg`); }
  console.log(`grip ${s}: ${H.length} samples, spread ${(dev * 1000).toFixed(1)} mm / ${(adev / D2R).toFixed(2)} deg`);
}
const clipMeta = Object.fromEntries(clips.map((c) => [c.name, c.meta]));
const mod = `// Generated by tools/characters/barrel/bake_barrel.mjs - do not edit. CC0 project code.
// The Green Beret's drum grip: the drum's base frame (origin = centre of its base, +y = its axis, +z = away from him)
// in the space of each hand bone, the same in every barrel clip; and the clips' timings (s) and drum distances (m).
export const BARREL_GRIP = ${JSON.stringify(avg)};
export const BARREL_CLIPS = ${JSON.stringify(Object.fromEntries(Object.entries(clipMeta).map(([k, m]) => [k, { barrel: m.barrel, ...(m.contact != null ? { contact: m.contact, d: m.d } : null), ...(m.release != null ? { release: m.release, d: m.d } : null) }])))};
export const BARREL_DRUM = ${JSON.stringify({ r: DRUM.r, h: DRUM.h })};
`;
writeFileSync(new URL('src/art/characters/barrel-grip.js', ROOT), mod);
writeFileSync(OUT + 'barrel_clips.json', JSON.stringify({ skeleton: 'UAL', clips: clips.map(({ drum, ...c }) => c) }));
writeFileSync(OUT + 'barrel_drum.json', JSON.stringify(Object.fromEntries(clips.map((c) => [c.name, c.drum]))));
console.log(`baked ${clips.length} clips -> ${OUT}barrel_clips.json (walk ${WALK_T.toFixed(3)} s cycle at ${SPEED} m/s, step ${STEP} m); grip -> src/art/characters/barrel-grip.js`);
console.log(`worst body vertex ${(worst.body * 100).toFixed(1)} cm, worst hand vertex ${(worst.hand * 100).toFixed(1)} cm (negative = inside the drum)`);
if (fail && process.argv.includes('--check')) { console.error('FAIL: a body vertex > 1 cm inside the drum or a hand off its grip'); process.exit(1); }
