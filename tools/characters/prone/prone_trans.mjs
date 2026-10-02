// prone_trans.mjs - go_prone / get_up (stance_trans.mjs), die_prone -> dead_prone, prone_turn_l/r (CC0 project code).
// Key poses built with the rig kit, blended per bone (slerp of local rotations, eased), no root motion: the pelvis
// ends over the root like every prone clip.
import * as THREE from 'three';
import { V } from './rig.mjs';
import { layTorso, legPose, sstep } from './pose.mjs';
import { crawlPose } from './crawl.mjs';
import { stanceClips } from './stance_trans.mjs';

const D2R = Math.PI / 180;

/** Upright-ish torso: hip centre at `hip`, forward lean (rad) spread over the spine, head pitch (rad, + = down). */
function upright(R, hip, lean, { spineLean = 0, headPitch = 0.1, headYaw = 0 } = {}) {
  const fr = (a) => ({ F: V(0, Math.cos(a), Math.sin(a)), D: V(0, -Math.sin(a), Math.cos(a)) });   // along = up, front = +Z
  let f = fr(lean); R.orient('pelvis', f.F, f.D); R.update();
  const hc = R.wp('thigh_l').lerp(R.wp('thigh_r'), 0.5); R.pelvisAt(R.wp('pelvis').add(hip.clone().sub(hc)));
  [['spine_01', 0.3], ['spine_02', 0.65], ['spine_03', 1]].forEach(([n, k]) => { f = fr(lean + spineLean * k); R.orient(n, f.F, f.D); });
  f = fr(lean + spineLean - 0.35 * (lean + spineLean)); R.orient('neck_01', f.F, f.D);
  const face = V(Math.sin(headYaw) * Math.cos(headPitch), -Math.sin(headPitch), Math.cos(headYaw) * Math.cos(headPitch));
  const side = new THREE.Vector3().crossVectors(V(0, 1, 0), face).normalize();
  R.orient('Head', new THREE.Vector3().crossVectors(face, side).normalize(), face); R.update();
}
/** Blend between key snapshots: keys = [[t, snap], ...] sorted; eased per segment. */
function keyed(R, keys) {
  return (t) => {
    let i = 1; while (i < keys.length - 1 && t > keys[i][0]) i++;
    const [t0, a] = keys[i - 1], [t1, b] = keys[i], u = sstep((t - t0) / Math.max(1e-6, t1 - t0));
    const q = new THREE.Quaternion(), qb = new THREE.Quaternion();
    for (const n in a.q) { q.fromArray(a.q[n]); qb.fromArray(b.q[n]); R.B[n].quaternion.copy(q.slerp(qb, u)); }
    R.B.pelvis.position.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), u); R.update();
    groundContacts(R);
  };
}
// the lowest body contact (palms, elbows, knees, boots, belly, chest) sits on the ground: blended keys neither float
// nor sink between the authored contact poses
const CONTACT = [['hand_l', 0.03], ['hand_r', 0.03], ['lowerarm_l', 0.045], ['lowerarm_r', 0.045], ['calf_l', 0.065], ['calf_r', 0.065],
  ['ball_l', 0.02], ['ball_r', 0.02], ['foot_l', 0.06], ['foot_r', 0.06], ['pelvis', 0.12], ['spine_02', 0.13], ['spine_03', 0.14], ['Head', 0.1]];
function groundContacts(R) {
  let mn = 9; for (const [n, r] of CONTACT) mn = Math.min(mn, R.wp(n).y - r);
  if (Math.abs(mn) > 1e-4) { R.pelvisAt(R.wp('pelvis').add(V(0, -mn, 0))); R.update(); }
}
function standingIdle(R) {
  const clip = R.animations.find((c) => c.name === 'idle');
  R.reset(); const mx = new THREE.AnimationMixer(R.scene); mx.clipAction(clip).play(); mx.setTime(0); R.update();
  const s = R.snap(); mx.stopAllAction(); mx.uncacheRoot(R.scene); return s;
}

export function transitionClips(ctx) {
  const { R, SH, sample } = ctx;
  const IDLE = standingIdle(R);
  crawlPose(R, 0, 'long', SH, {}); const PRONE = R.snap();
  // --- go_prone 0.5 s / get_up 0.6 s: one shared path, legs / hip / planted hands solved per frame (stance_trans.mjs) ---
  stanceClips(ctx, { PRONE, IDLE, upright, crawlHandsIn: (r) => crawlPose(r, 0, 'long', SH, { headPitch: -0.25 }) });
  deathAndTurns(ctx, PRONE, keyed);
}

function deadPose(R) {
  R.reset();
  layTorso(R, { hip: V(0, 0.115, 0), chest: -0.1, roll: -4 * D2R, neck: 0.25, head: { pitch: 1.25, yaw: 80 * D2R, roll: -1.1 } });
  // left arm forward on the ground bent ~100 deg, right arm along the body palm up
  R.handTo('l', V(0.24, 0.035, 0.78), V(-0.5, -0.05, 0.85).normalize(), V(0, 1, 0), V(0.9, -0.6, 0.1));
  R.handTo('r', V(-0.3, 0.04, -0.12), V(0.05, -0.05, -1).normalize(), V(-1, 0.1, 0), V(-0.4, -0.8, 0.3));
  R.curl('l', 0.35, 0.25, 0.1); R.curl('r', 0.45, 0.3);
  legPose(R, 'l', V(0.24, 0.07, -0.8), V(0.8, -0.55, 0.1), 0.65);
  legPose(R, 'r', V(-0.3, 0.07, -0.74), V(-0.7, -0.4, 0.4), 0.5);
  return R.snap();
}

function deathAndTurns(ctx, PRONE, keyed) {
  const { R, SH, sample } = ctx;
  const DEAD = deadPose(R);
  const k1 = (() => { crawlPose(R, 0, 'long', SH, { headPitch: 0.3 }); R.rotW('clavicle_r', new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -5 * D2R)); return R.snap(); })();
  const k2 = (() => { R.reset(); layTorso(R, { hip: V(0, 0.125, 0), chest: -0.04, neck: 0.5, head: { pitch: 0.9, yaw: 50 * D2R, roll: -0.6 } });
    R.handTo('l', V(0.3, 0.04, 0.75), V(-0.3, -0.05, 1).normalize(), V(-0.2, 1, 0), V(1, -0.6, 0));
    R.handTo('r', V(-0.34, 0.04, 0.62), V(0.3, -0.05, 1).normalize(), V(0.2, 1, 0), V(-1, -0.6, 0));
    legPose(R, 'l', V(0.21, 0.07, -0.8), V(0.75, -0.65, 0), 0.55); legPose(R, 'r', V(-0.21, 0.07, -0.8), V(-0.75, -0.65, 0), 0.55);
    return R.snap(); })();
  sample('die_prone', 0.9, 30, keyed(R, [[0, PRONE], [0.08, k1], [0.3, k2], [0.9, DEAD]]), { loop: false, prone: true, next: 'dead_prone' });
  sample('dead_prone', 0.5, 4, () => R.apply(DEAD), { loop: true, prone: true });
  // turning while prone (in place loop, 0.6 s): elbows walk sideways, hips lift, feet sweep; the runtime yaws the body
  for (const [name, dir] of [['prone_turn_l', 1], ['prone_turn_r', -1]]) {
    sample(name, 0.6, 30, (t) => {
      const u = t / 0.6, hip = 0.015 * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.5) / 0.5)));
      crawlPose(R, 0, 'long', SH, { roll: dir * 0.05 * Math.sin(2 * Math.PI * u), leg: { l: -0.03 * Math.sin(2 * Math.PI * u), r: 0.03 * Math.sin(2 * Math.PI * u) } });
      // elbow stepping: one elbow at a time lifts and steps 0.14 m toward the turn, then is planted as the body turns
      for (const [s, sx, ph] of [['l', 1, 0], ['r', -1, 0.5]]) {   // the elbows step alternately, half a loop apart
        const w = ((u - ph) % 1 + 1) % 1, step = w < 0.3 ? sstep(w / 0.3) : 1 - (w - 0.3) / 0.7;
        const lift = w < 0.3 ? 0.022 * Math.sin(Math.PI * w / 0.3) : 0;
        const el = R.wp('lowerarm_' + s), hd = R.wp('hand_' + s).lerp(R.wp('middle_01_' + s), 0.55);
        const off = V(dir * (0.14 * step - 0.07), lift, 0);
        const ha = R.axes('hand_' + s), th = ha.front.clone();
        R.handTo(s, hd.add(off), ha.along, th, el.add(off).sub(R.wp('upperarm_' + s)).add(V(sx * 0.3, -0.5, 0)));
      }
      R.B.pelvis.position.z += hip; R.update();   // pelvis bone local +Z = world up in the UAL root frame
    }, { loop: true, prone: true, hold: 'crawl' });
  }
}
