// crawl.mjs - the military low crawl (docs/crawl-animation.md §3), elbow-first (CC0 project code).
// Cycle T = 0.9 s = two 0.405 m strokes -> 0.90 m/s. The elbows ALTERNATE (contralateral, docs §10): the left elbow
// pulls with the right leg's push in the first half while the right forearm skims forward, then they swap. Each half:
// 60 % leg push (boot planted, body surges) and 40 % glide (the other knee draws up sideways along the ground).
import * as THREE from 'three';
import { V } from './rig.mjs';
import { layTorso, armPose, legPose, sstep, easeOut, lerp, frac } from './pose.mjs';

// T 0.9 s: two 0.405 m strokes. A shorter stroke than the first build (0.45 m / 1.0 s) keeps the chest flat: the
// shoulder only travels ~0.26 m past each planted elbow, so the upper arm never stands vertical (review: "sphinx").
export const CRAWL = { T: 0.9, stroke: 0.405, v: 0.9, duty: 0.6, hipY: 0.13, elbowY: 0.04, glide: 0.4 };
const D2R = Math.PI / 180;
const K = CRAWL, HALF = K.T / 2, ROOT_PER_U = K.v * HALF;   // root travel per unit of half-phase (one stroke)
const SURGE = K.glide * K.v * HALF / (2 * Math.PI);          // pelvis surge amplitude (m)

/**
 * Pelvis surge (m, along the body relative to the root) at half-phase u. The body speed is v * (1 + glide * cos):
 * 1.4 v mid-pull, 0.6 v mid-reach (no stop-and-go), and it changes smoothly (no jump at the catch).
 */
export function surge(u) { return SURGE * Math.sin(2 * Math.PI * (u - K.duty / 2)); }
/**
 * Per-arm timing, in half-cycle units. Arm phase w in [-pre, 2 - pre): the elbow lands at w = -pre (just before its
 * own half: the left arm owns the first half, the right arm the second), stays planted to w = lift, then reaches
 * forward over the other arm's pull. The two arms are exactly half a cycle apart, never pull together, and the short
 * gap between one lift and the next landing falls in the slow glide of the surge.
 */
export const ARM = { pre: 0.08, lift: 0.84, prot: 0.06 };
/** Arm phase of side s1 at cycle time tt (half-cycle units, -pre .. 2 - pre). */
export const armW = (s1, tt) => frac((tt / HALF - (s1 === 'l' ? 0 : 1) + ARM.pre) / 2) * 2 - ARM.pre;
/** Scapular slide (m) of one arm: protracted at its catch, retracted at its finish, protracting again in its reach. */
export const armProt = (w) => w <= ARM.lift ? lerp(ARM.prot, -ARM.prot, sstep((w + ARM.pre) / (ARM.lift + ARM.pre)))
  : lerp(-ARM.prot, ARM.prot, sstep((w - ARM.lift) / (2 - ARM.pre - ARM.lift)));
/** Shoulder travel past one planted elbow over its pull (m): root + surge - scapular retraction. */
export const PULL_A = K.v * HALF * (ARM.lift + ARM.pre) + surge(ARM.lift) - surge(1 - ARM.pre) + armProt(ARM.lift) - armProt(-ARM.pre);

// per carry style: forearm inward angle at catch / finish (deg) and hand shape
export const STYLES = {
  long: { inR: [12, 30], inL: [14, 58] },      // rifle / sniper / harpoon / SMG: the right forearm carries the gun
  unarmed: { inR: [14, 58], inL: [14, 58] },
  knife: { inR: [14, 42], inL: [14, 58] },
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
  // hips roll / yaw with the legs (right hip up at the right knee's catch; the twist keeps the chest pointing along
  // the crawl, so the planted elbows stay beside their shoulders); the shoulders rock with the ARMS: the pulling
  // side's shoulder rides up (shRoll < 0 = left up) mid-pull, and its scapula leads at the catch (armProt)
  const roll = idle ? (idle.roll || 0) : 8 * D2R * Math.cos(ph), yaw = idle ? 0 : -4 * D2R * Math.cos(ph);
  const twist = idle ? 0 : 5 * D2R * Math.cos(ph), shRoll = idle ? undefined : -6 * D2R * Math.sin(ph + ARM.pre * Math.PI);
  const hip = V(0, K.hipY, s);
  // --- elbow targets (root space): ALTERNATING contralateral elbow crawl ---
  // Each arm pulls once per cycle: the left elbow plants with the right knee drawn up and pulls through the first
  // half (with the right leg's push), while the right forearm skims forward with the rifle on it; then they swap.
  // A planted elbow sits on the ground ~dyN below the flat-torso shoulder, i.e. on a circle of radius Lh around it:
  // the catch is PULL_A/2 ahead of the shoulder and the finish PULL_A/2 behind.
  const L1 = R.len.upperarm_r, dyN = Math.max(0.12, SH.y - K.elbowY - 0.012), Lh = Math.sqrt(L1 * L1 - dyN * dyN);
  const shZ = (s1, tt) => surge(frac(tt / HALF)) + SH.z + armProt(armW(s1, tt));   // nominal shoulder z at time tt
  const catchX = Math.sqrt(Math.max(0, Lh * Lh - (PULL_A / 2) ** 2));
  const elbowAt = (sx, s1) => {
    if (idle) return { p: V(sx * (SH.x + catchX), K.elbowY, SH.z + ARM.prot + PULL_A / 2), planted: true, w: 0 };
    const w = armW(s1, t), tPlant = t - (w + ARM.pre) * HALF;              // time this arm's elbow last landed
    const cz = shZ(s1, tPlant) + PULL_A / 2;                                // root-space z of the catch (same every cycle)
    if (w <= ARM.lift) return { p: V(sx * (SH.x + catchX), K.elbowY, cz - K.v * (t - tPlant)), planted: true, w };
    // recovery: the forearm skims forward 1.5 cm up and the elbow swings out round the shoulder (stays on the Lh
    // circle), so the chest does not rise while the elbow passes it
    // The forward swing eases in and out IN THE WORLD (not against the moving body): the elbow peels off the ground
    // from rest and settles onto its next catch at rest, so it never slides into or out of a plant.
    const Drec = (2 - ARM.pre - ARM.lift) * HALF, tLift = tPlant + (ARM.lift + ARM.pre) * HALF, r = sstep((t - tLift) / Drec);
    const zf = cz - K.v * (ARM.lift + ARM.pre) * HALF;
    const circ = (dz) => sx * (SH.x + Math.sqrt(Math.max(0, Lh * Lh - dz * dz)));
    const z = zf + (cz + K.v * Drec - zf) * r - K.v * (t - tLift), ends = lerp(sx * (SH.x + catchX) - circ(zf - shZ(s1, tLift)), 0, r);
    return { p: V(circ(z - shZ(s1, t)) + ends, K.elbowY + 0.015 * Math.sin(Math.PI * r), z), planted: false, w };
  };
  const E = { l: elbowAt(1, 'l'), r: elbowAt(-1, 'r') };
  // forearm inward angle (deg): catch -> finish during this arm's pull, back during its reach
  const inAng = (rng, w) => (idle ? rng[0] : w <= ARM.lift ? lerp(rng[0], rng[1], easeOut((w + ARM.pre) / (ARM.lift + ARM.pre)))
    : lerp(rng[1], rng[0], sstep((w - ARM.lift) / (2 - ARM.pre - ARM.lift)))) * D2R;
  // --- torso flat; the PULLING shoulder alone slides (scapula) and lifts (clavicle elevation) so its upper arm reaches
  //     its elbow target: the shoulders rock alternately with the strokes instead of the whole chest bobbing ---
  const pr = { l: idle ? ARM.prot : armProt(E.l.w), r: idle ? ARM.prot : armProt(E.r.w) }, el = { l: 0, r: 0 };
  let c1 = idle && idle.breath ? 0.012 * idle.breath : 0;
  const torso = () => layTorso(R, { hip, yaw, roll, twist, shRoll, chest: c1, prot: pr, elev: el, neck: 1.0,
    head: { pitch: idle ? 0.3 + (idle.headPitch || 0) : 0.34, yaw: idle ? idle.headYaw || 0 : -twist * 0.8, roll: roll * 0.15 } });
  const reachErr = (s1) => { torso(); return R.wp('upperarm_' + s1).distanceTo(E[s1].p) - L1; };
  // (solved for the reaching arm too: its target is continuous, so the shoulder does not pop when the elbow lands)
  for (const s1 of idle ? [] : ['l', 'r']) {
    for (let it = 0; it < 8; it++) {
      const e = reachErr(s1); if (Math.abs(e) < 3e-4) break;
      // finite-difference Newton on the pair (slide, elevation), preferring the slide (a lifted shoulder is the last resort)
      const h = 1e-3, p0 = pr[s1], e0 = el[s1];
      pr[s1] = p0 + h; const gp = (reachErr(s1) - e) / h; pr[s1] = p0;
      el[s1] = e0 + h; const ge = (reachErr(s1) - e) / h; el[s1] = e0;
      const wP = 1, wE = 0.35, den = wP * gp * gp + wE * ge * ge || 1e-9, k = -e / den;
      pr[s1] = Math.max(-0.1, Math.min(0.14, p0 + k * wP * gp));
      el[s1] = Math.max(-0.03, Math.min(0.06, e0 + k * wE * ge));
    }
  }
  torso();
  // --- arms ---
  const out = { elbow: {}, planted: {}, foot: {}, footPlanted: {}, lift: c1, elev: el, u, half, w: { l: E.l.w, r: E.r.w } };
  for (const s1 of ['l', 'r']) {
    const sx = s1 === 'l' ? 1 : -1, a = inAng(s1 === 'l' ? st.inL : st.inR, E[s1].w);
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
