// crawl.mjs - the military low crawl (docs/crawl-animation.md §3), elbow-first (CC0 project code).
// Cycle T = 1.0 s = two 0.45 m strokes -> 0.90 m/s. Each half: 60 % power (elbows + pushing boot planted, body surges)
// and 40 % reach (forearms skim forward 1.5 cm up, the other knee draws up sideways along the ground).
import * as THREE from 'three';
import { V } from './rig.mjs';
import { layTorso, armPose, legPose, sstep, easeOut, lerp, frac } from './pose.mjs';

// T 0.9 s: two 0.405 m strokes. A shorter stroke than the first build (0.45 m / 1.0 s) keeps the chest flat: the
// shoulder only travels ~0.21 m past each planted elbow, so the upper arm never stands vertical (review: "sphinx").
export const CRAWL = { T: 0.9, stroke: 0.405, v: 0.9, duty: 0.6, hipY: 0.13, elbowY: 0.04, glide: 0.4, prot: 0.04 };
const D2R = Math.PI / 180;
const K = CRAWL, HALF = K.T / 2, ROOT_PER_U = K.v * HALF;   // root travel per unit of half-phase (one stroke)
const SURGE = K.glide * K.v * HALF / (2 * Math.PI);          // pelvis surge amplitude (m)

/**
 * Pelvis surge (m, along the body relative to the root) at half-phase u. The body speed is v * (1 + glide * cos):
 * 1.4 v mid-pull, 0.6 v mid-reach (no stop-and-go), and it changes smoothly (no jump at the catch).
 */
export function surge(u) { return SURGE * Math.sin(2 * Math.PI * (u - K.duty / 2)); }
/** Scapular slide (m): protracted at the catch, retracted at the finish. */
const prot = (u) => u < K.duty ? lerp(K.prot, -K.prot, sstep(u / K.duty)) : lerp(-K.prot, K.prot, sstep((u - K.duty) / (1 - K.duty)));
/** Shoulder travel past a planted elbow during one pull (m): root + surge - scapular retraction. */
export const PULL = ROOT_PER_U * K.duty + surge(K.duty) - surge(0) + prot(K.duty) - prot(0);

// per carry style: forearm inward angle at catch / finish (deg) and hand shape
export const STYLES = {
  long: { inR: [12, 30], inL: [22, 58] },      // rifle / sniper / harpoon / SMG: the right forearm carries the gun
  unarmed: { inR: [22, 58], inL: [22, 58] },
  knife: { inR: [16, 42], inL: [22, 58] },
};

/**
 * Pose the rig at cycle time t (s, 0..T) for carry style `style`. R is reset first.
 * @returns {{elbow:{l:THREE.Vector3,r:THREE.Vector3}, planted:{l:boolean,r:boolean}, foot:{l,r}, footPlanted:{l,r}, lift:number}}
 */
export function crawlPose(R, t, style = 'long', SH = null, idle = null) {
  const st = STYLES[style];
  R.reset();
  t = idle ? 0 : frac(t / K.T) * K.T;
  const half = t < HALF ? 0 : 1, u = (t - half * HALF) / HALF;
  const s = idle ? 0 : surge(u), ph = 2 * Math.PI * t / K.T;
  const roll = idle ? (idle.roll || 0) : 8 * D2R * Math.cos(ph), yaw = idle ? 0 : -4 * D2R * Math.cos(ph), twist = idle ? 0 : 5 * D2R * Math.cos(ph);
  const hip = V(0, K.hipY, s);
  // --- elbow targets (root space) ---
  // the planted elbow sits on the ground ~dyN below the flat-torso shoulder, i.e. on a circle of radius Lh around it:
  // the catch is PULL/2 ahead of the shoulder and the finish PULL/2 behind, so the chest barely lifts mid-pull
  const L1 = R.len.upperarm_r, dyN = Math.max(0.12, SH.y - K.elbowY - 0.012), Lh = Math.sqrt(L1 * L1 - dyN * dyN);
  const shZ = (uu) => surge(uu) + SH.z + prot(uu);            // nominal shoulder z at half-phase uu
  const catchRel = (lead) => PULL / 2 + (idle ? 0 : lead ? 0.012 : -0.012);
  const elbowAt = (sx, s1) => {                               // s1 = side letter
    const lead = (hh) => (hh === 0 ? 'l' : 'r') === s1;       // the elbow opposite the pushing leg reaches further
    const cz = (hh) => (idle ? SH.z + K.prot : shZ(0)) + catchRel(lead(hh));
    const cx = (hh) => sx * (SH.x + Math.sqrt(Math.max(0, Lh * Lh - catchRel(lead(hh)) ** 2)));
    const ez0 = cz(half), ex0 = cx(half);
    if (idle) return { p: V(ex0, K.elbowY, ez0), planted: true };
    if (u <= K.duty) {
      return { p: V(ex0, K.elbowY, ez0 - ROOT_PER_U * u), planted: true };
    }
    const r = sstep((u - K.duty) / (1 - K.duty));
    const zf = ez0 - ROOT_PER_U * K.duty, zn = cz(1 - half) - ROOT_PER_U * 0;   // next catch is at u = 0 of the next half
    // recovery: the forearm skims forward and the elbow swings out round the shoulder (stays on the Lh circle), so
    // the chest does not rise while the elbow passes it
    const circ = (dz) => sx * (SH.x + Math.sqrt(Math.max(0, Lh * Lh - dz * dz)));
    const z = lerp(zf, zn, r), ends = lerp(ex0 - circ(zf - shZ(K.duty)), cx(1 - half) - circ(zn - shZ(1)), r);
    return { p: V(circ(z - shZ(u)) + ends, K.elbowY + 0.015 * Math.sin(Math.PI * r), z), planted: false };
  };
  const E = { l: elbowAt(1, 'l'), r: elbowAt(-1, 'r') };
  // forearm inward angle (deg): catch -> finish during power, back during reach
  const inAng = (rng) => (u <= K.duty ? lerp(rng[0], rng[1], easeOut(u / K.duty)) : lerp(rng[1], rng[0], sstep((u - K.duty) / (1 - K.duty)))) * D2R;
  // --- torso: solve the chest lift so both upper arms reach their planted elbows (shoulders pass over the elbows) ---
  const pr = { l: idle ? K.prot : prot(u), r: idle ? K.prot : prot(u) };
  const torso = (chest) => layTorso(R, { hip, yaw, roll, twist, chest, prot: { l: pr.l, r: pr.r }, neck: 1.0,
    head: { pitch: idle ? 0.3 + (idle.headPitch || 0) : 0.34, yaw: idle ? idle.headYaw || 0 : -twist * 0.8, roll: roll * 0.15 } });
  const err = (chest) => { torso(chest); let e = 0; for (const s1 of ['l', 'r']) e += R.wp('upperarm_' + s1).distanceTo(E[s1].p) - L1; return e / 2; };
  let c0 = 0, e0 = err(c0), c1 = 0.05, e1 = err(c1);
  for (let i = 0; i < 6 && Math.abs(e1) > 1e-4; i++) { const c2 = c1 - e1 * (c1 - c0) / (e1 - e0 || 1e-6); c0 = c1; e0 = e1; c1 = Math.max(-0.14, Math.min(0.2, c2)); e1 = err(c1); }
  // where the chest alone cannot keep the shoulder at upper-arm length from a planted elbow (catch / finish ends of
  // the pull), the shoulder blade slides along the body (clavicle protraction / retraction) so the elbow stays put
  for (let it = 0; it < 5; it++) {
    torso(c1); let done = true;
    for (const s1 of ['l', 'r']) {
      const d = E[s1].p.clone().sub(R.wp('upperarm_' + s1)), e = d.length() - L1, g = d.z / d.length();
      if (Math.abs(e) < 5e-4 || Math.abs(g) < 0.15) continue;
      pr[s1] = Math.max(-0.09, Math.min(0.11, pr[s1] + Math.max(-0.03, Math.min(0.03, e / (1.1 * g))))); done = false;
    }
    if (done) break;
  }
  if (idle && idle.breath) c1 += 0.012 * idle.breath;
  torso(c1);
  // --- arms ---
  const out = { elbow: {}, planted: {}, foot: {}, footPlanted: {}, lift: c1, u, half };
  for (const s1 of ['l', 'r']) {
    const sx = s1 === 'l' ? 1 : -1, a = inAng(s1 === 'l' ? st.inL : st.inR);
    const D = V(-sx * Math.sin(a), 0.08, Math.cos(a)).normalize();
    const inward = V(-sx, 0, 0);
    let ha = D.clone(), thumb;
    if (style === 'long' && s1 === 'r') {          // fist on its little-finger side around the sling at the swivel
      const comp = -(a - st.inR[0] * D2R) * 0.7;       // wrist keeps the gun's yaw steady while the forearm turns in
      ha = D.clone().applyAxisAngle(V(0, 1, 0), -sx * comp);
      thumb = V(0, 1, 0).addScaledVector(inward, 0.35);
    } else thumb = V(0, 1, 0).addScaledVector(inward, 0.3);   // loose / knife fist on its little-finger side (never a flat palm)
    armPose(R, s1, E[s1].p, D, ha, thumb);
    const fist = style === 'unarmed' || s1 === 'l' ? 0.7 : 1.0;
    R.curl(s1, fist, fist * 0.8);
    out.elbow[s1] = R.wp('lowerarm_' + s1); out.planted[s1] = E[s1].planted;
  }
  // --- legs ---
  for (const s1 of ['l', 'r']) {
    const sx = s1 === 'l' ? 1 : -1;
    const tl = frac((t - (s1 === 'r' ? 0 : HALF)) / K.T) * K.T;           // time since this leg's catch
    const hz0 = surge(0);                                                   // hip z at this leg's catch
    const drawn = V(sx * 0.27, 0.075, -0.44), drag = V(sx * 0.17, 0.07, -0.79);
    let A, planted = false, pole, pf;
    const hipNow = V(0, 0, s);
    if (idle) {                                                            // legs straight and apart, toes out, heels down
      A = V(sx * 0.21, 0.07, -0.80 + (idle.leg && idle.leg[s1] || 0)); pole = V(sx * 0.75, -0.65, 0); pf = 0.55; planted = true;
    } else if (tl <= K.duty * HALF) {                                             // pushing: boot planted (inner edge)
      A = V(drawn.x, drawn.y, hz0 + drawn.z - K.v * tl); planted = true;
      pole = V(sx, -0.1, 0.1); pf = 0.25;
    } else if (tl <= HALF) {                                               // finishing the push -> dragging
      const r = sstep((tl - K.duty * HALF) / ((1 - K.duty) * HALF));
      const zf = hz0 + drawn.z - K.v * K.duty * HALF;
      A = V(lerp(drawn.x, drag.x, r), 0.075, lerp(zf, s + drag.z, r));
      pole = V(sx, lerp(-0.1, -0.6, r), lerp(0.1, 0, r)); pf = lerp(0.25, 0.7, r);
    } else if (tl <= HALF + 0.4 * HALF) {                                  // dragging straight, toe and inner edge sliding
      A = hipNow.clone().add(drag); pole = V(sx * 0.8, -0.6, 0); pf = 0.7;
    } else {                                                               // drawing the knee up sideways along the ground
      const r = sstep((tl - 1.4 * HALF) / (0.6 * HALF));
      const zc = hz0 + drawn.z + K.T * K.v;                                // next catch position relative to this root
      A = V(lerp(drag.x, drawn.x, r), 0.075, lerp(s + drag.z, zc - K.v * K.T, r) );
      pole = V(sx, lerp(-0.6, -0.1, r), lerp(0, 0.1, r)); pf = lerp(0.7, 0.25, r);
    }
    legPose(R, s1, A, pole, pf);
    out.foot[s1] = R.wp('foot_' + s1); out.footPlanted[s1] = planted;
  }
  return out;
}

/** Nominal shoulder offset from the hip centre in the flat prone pose (measured once on the rig). */
export function shoulderRef(R) {
  R.reset(); layTorso(R, { hip: V(0, K.hipY, 0) });
  const S = R.wp('upperarm_l');
  return { x: Math.abs(S.x), z: S.z, y: S.y };
}
