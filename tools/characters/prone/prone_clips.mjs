// prone_clips.mjs - prone aim / shoot / pistol, stance transitions, prone death and turning (CC0 project code).
// docs/crawl-animation.md §4. Poses are built with the same world-direction kit as the crawl (rig.mjs / pose.mjs).
import * as THREE from 'three';
import { V } from './rig.mjs';
import { layTorso, legPose, sstep, lerp, clamp01 } from './pose.mjs';
import { fistPoint, frameM, gripFrom, packM } from './grips.mjs';
import { SOCK } from './grip_build.mjs';
import { transitionClips } from './prone_trans.mjs';

const D2R = Math.PI / 180;
const decay = (t, t0, tau) => (t < t0 ? 0 : Math.exp(-(t - t0) / tau));

/**
 * Prone aim with a long gun or SMG (FM 3-22.9 prone unsupported): body ~20 deg right of the line of fire, butt in the
 * right shoulder pocket, both elbows planted, cheek on the stock. o: {kick (rad muzzle up), back (m), yawJit, bolt:
 * {p: palm offset in weapon space} | null, smg}. Returns the weapon world frame (grip_r origin) and hand errors.
 */
export function aimPose(R, SH, o = {}) {
  const yaw = -20 * D2R, sock = o.smg ? SOCK.thompson : SOCK.no4_sniper;
  let res = null;
  const pose = (h) => {
    R.reset();
    layTorso(R, { hip: V(0.16, 0.13, -0.28), yaw, roll: 0.07, twist: 14 * D2R, chest: h + (o.rock || 0), neck: 0.8,
      prot: { l: 0.03, r: -0.01 }, head: { pitch: 0.42, yaw: 16 * D2R, roll: 0.17 } });
    const B = R.B, F = V(0, 0, 1);
    const pocket = R.wp('upperarm_r').lerp(R.wp('clavicle_r'), 0.45).addScaledVector(F, 0.03 - (o.back || 0)).add(V(0.0, -0.01, 0));
    const dir = V(Math.sin(o.yawJit || 0), 0, Math.cos(o.yawJit || 0)).applyAxisAngle(V(1, 0, 0), -(o.kick || 0));
    const W = frameM(V(), dir, V(0, 1, 0));
    const rot = new THREE.Quaternion().setFromRotationMatrix(W);
    W.setPosition(pocket.clone().sub(sock.butt.clone().applyQuaternion(rot)));
    const at = (p) => p.clone().applyMatrix4(W);
    // right hand: wrist of the stock (fingers wrap under, thumb along the top) or on the bolt
    const pr = o.bolt ? at(o.bolt) : at(V(0, -0.005, 0));
    const eR = R.handTo('r', pr, V(0.45, -0.8, 0.3).normalize(), V(-0.05, 0.35, 1), V(-0.6, -1, -0.3));
    // left hand under the fore-end as far forward as the planted elbow allows (FM: close to the magazine)
    let zl = sock.grip_l.z, eL = 1;
    for (; zl > 0.1; zl -= 0.02) {
      eL = R.handTo('l', at(V(0, sock.grip_l.y - 0.035, zl)), V(-0.8, 0.25, 0.5).normalize(), V(0.1, 0.1, 1), V(0.25, -1, -0.1));
      if (eL < 0.01 && R.wp('lowerarm_l').y < 0.07) break;
    }
    R.curl('r', o.bolt ? 0.55 : 0.85, 0.6); R.curl('l', 0.7, 0.5);
    res = { W, eR, eL, zl, elR: R.wp('lowerarm_r').y, elL: R.wp('lowerarm_l').y };
    return res;
  };
  // chest height: lower the shoulders until the right elbow (pole down) reaches the ground
  let lo = -0.25, hi = 0.25;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; pose(m); if (res.elR > 0.045) hi = m; else lo = m; }
  pose((lo + hi) / 2);
  legPose(R, 'l', V(0.47, 0.07, -1.02), V(0.8, -0.6, 0), 0.6);
  legPose(R, 'r', V(0.02, 0.07, -1.07), V(-0.75, -0.65, 0.1), 0.6);
  return res;
}

/** Prone pistol, one-handed in the period style: right elbow planted, wrist resting on the left forearm. */
export function pistolPose(R, SH, o = {}) {
  R.reset();
  layTorso(R, { hip: V(0, 0.13, -0.3), chest: 0.2 + (o.rock || 0), neck: 0.75, prot: { l: 0.02, r: 0.04 },
    head: { pitch: 0.2, yaw: 0.05, roll: 0.03 } });
  const S = R.wp('upperarm_r');
  const eye = R.wp('Head').add(V(0, 0.08, 0.1));
  const palm = V(eye.x - 0.02, 0.19, eye.z + 0.36);
  const flip = o.flip || 0;
  const ha = V(0.25, -0.55, 0.35).normalize(), thumb = V(0.05, 0.4, 1).applyAxisAngle(V(1, 0, 0), -flip).normalize();
  R.handTo('r', palm, ha, thumb, V(-0.4, -1, -0.2));
  // left forearm flat across in front as the rest, the hand under the right wrist
  const wr = R.wp('hand_r');
  R.handTo('l', V(wr.x + 0.06, 0.06, wr.z - 0.02), V(-0.95, -0.05, 0.25).normalize(), V(0, 1, 0.2), V(0.4, -1, -0.4));
  R.curl('r', 0.85, 0.5); R.curl('l', 0.45, 0.3);
  legPose(R, 'l', V(0.25, 0.07, -1.08), V(0.8, -0.6, 0), 0.6);
  legPose(R, 'r', V(-0.2, 0.07, -1.08), V(-0.8, -0.6, 0), 0.6);
  const W = frameM(fistPoint(R, 'r'), V(0, 0, 1).applyAxisAngle(V(1, 0, 0), -flip), V(0, 1, 0));
  return { W };
}

export function extraClips(ctx) {
  const { R, SH, sample } = ctx;
  ctx.grips = ctx.grips || {};
  // grips: the rifle / SMG ride in the LEFT hand while prone-aiming (the right hand works the bolt)
  let r = aimPose(R, SH, {});
  ctx.grips.aim_long = { hand: 'l', socket: 'grip_r', m: packM(gripFrom(R, 'l', r.W)) };
  console.log(`prone aim: left grip z ${r.zl.toFixed(2)}, elbows ${r.elL.toFixed(3)}/${r.elR.toFixed(3)}, hand err ${r.eL.toFixed(3)}/${r.eR.toFixed(3)}`);
  r = aimPose(R, SH, { smg: true });
  ctx.grips.aim_smg = { hand: 'l', socket: 'grip_r', m: packM(gripFrom(R, 'l', r.W)) };
  const pr = pistolPose(R, SH, {});
  ctx.grips.pistol = { hand: 'r', socket: 'grip_r', m: packM(gripFrom(R, 'r', pr.W)) };
  const breathe = (t) => 0.004 * Math.sin(2 * Math.PI * t / 4);
  sample('prone_aim', 4, 10, (t) => aimPose(R, SH, { rock: breathe(t), kick: 0.004 * Math.sin(2 * Math.PI * t / 4) }), { loop: true, prone: true, hold: 'prone' });
  // bolt action: recoil (muzzle +5 deg, shoulder back 2.5 cm, settles in 0.15 s), then the right hand works the bolt
  const BOLT = [[0.3, V(0, -0.005, 0)], [0.45, V(-0.05, 0.03, 0.06)], [0.55, V(-0.06, 0.07, 0.06)], [0.7, V(-0.06, 0.07, -0.03)],
    [0.85, V(-0.06, 0.07, 0.06)], [0.95, V(-0.05, 0.03, 0.06)], [1.1, V(0, -0.005, 0)]];
  const boltAt = (t) => { if (t <= BOLT[0][0] || t >= BOLT[BOLT.length - 1][0]) return null;
    for (let i = 1; i < BOLT.length; i++) if (t <= BOLT[i][0]) { const [t0, a] = BOLT[i - 1], [t1, b] = BOLT[i]; return a.clone().lerp(b, sstep((t - t0) / (t1 - t0))); } return null; };
  sample('prone_shoot', 1.2, 30, (t) => { const k = decay(t, 0, 0.06) * (t < 0.03 ? t / 0.03 : 1);
    return aimPose(R, SH, { kick: 5 * D2R * k, back: 0.025 * k, rock: 0.02 * k, bolt: boltAt(t) }); }, { loop: false, prone: true, hold: 'prone' });
  sample('prone_shoot_smg', 0.6, 30, (t) => { let k = 0, j = 0;
    for (let i = 0; i < 5; i++) { const d = decay(t, i * 0.09, 0.035); k += d; j += d * (i % 2 ? 1 : -1); }
    const climb = 4 * D2R * clamp01(t / 0.45) * (1 - sstep((t - 0.45) / 0.15));
    return aimPose(R, SH, { smg: true, kick: 1.5 * D2R * Math.min(1, k) + climb, yawJit: 0.8 * D2R * j, back: 0.008 * Math.min(1, k) }); }, { loop: false, prone: true, hold: 'prone' });
  sample('prone_pistol_aim', 2, 10, (t) => pistolPose(R, SH, { rock: 0.003 * Math.sin(2 * Math.PI * t / 2), flip: 0.3 * D2R * Math.sin(2 * Math.PI * t) }), { loop: true, prone: true, hold: 'prone' });
  sample('prone_pistol_shoot', 0.5, 30, (t) => pistolPose(R, SH, { flip: 9 * D2R * decay(t, 0.0, 0.05) * Math.min(1, t / 0.02) }), { loop: false, prone: true, hold: 'prone' });
  transitionClips(ctx);
}
