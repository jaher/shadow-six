/**
 * Step-driven secondary motion of a transported man's limbs (docs/bodies-design.md §C.10; the carry-legs fix). Pure
 * spring maths, no three.js: art/transport-contact.js loadGait turns the angles into bone rotations.
 *
 * The transporter's travelled distance sets a gait phase (one cycle = two steps). Every foot strike kicks the limb
 * springs (left leg on the left strike, right leg on the right one, the arms on the opposite side) and a continuous
 * anti-phase forcing swings the legs against each other at the step rate, scaled by the speed; damped springs give
 * the loose, lagging swing of limp limbs. Standing still: no strikes, no forcing, the springs settle (legs still).
 *
 *   const S = gaitState();
 *   stepGait(S, metresMovedThisFrame, dt, GAIT.shoulder);   // → S.l.a, S.r.a (legs), S.al.a, S.ar.a (arms), radians
 * @module art/carry-gait
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;

/**
 * Tuning per hold. cycle: metres per gait cycle (carry_walk 1.55 m/s × 1.03 s; the backwards drag 0.8 m/s × 1.33 s);
 * vRef: the nominal speed (gain 1); kick: rad/s per strike; swing: forcing amplitude (rad); om / ze: spring natural
 * frequency (rad/s) and damping ratio; max: angle clamp (rad); arms: arm gain.
 */
export const GAIT = {
  shoulder: { cycle: 1.6, vRef: 1.6, kick: 1.6, swing: 0.2, om: 9, ze: 0.3, max: 0.5, arms: 0.8 },
  drag: { cycle: 1.07, vRef: 0.8, kick: 1.6, swing: 0.16, om: 12, ze: 0.3, max: 0.35, arms: 0.5 },
};

const spring = () => ({ a: 0, w: 0 });
/** Fresh gait state. */
export function gaitState() { return { dist: 0, phase: 0, half: 0, v: 0, l: spring(), r: spring(), al: spring(), ar: spring() }; }

/** Damped spring towards `target`, sub-stepped at ≤ 1/120 s (stable at any frame dt). */
function integrate(s, target, dt, P) {
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.w += (P.om * P.om * (target - s.a) - 2 * P.ze * P.om * s.w) * h;
    s.a += s.w * h;
  }
  if (Math.abs(s.a) > P.max) { s.a = Math.sign(s.a) * P.max; s.w *= -0.3; }
}

/**
 * Advance the gait by one frame.
 * @param {ReturnType<typeof gaitState>} S state (mutated)
 * @param {number} d metres the transporter moved this frame (≥ 0; > 1 m = a teleport, ignored)
 * @param {number} dt seconds
 * @param {typeof GAIT.shoulder} P tuning
 * @returns {typeof S}
 */
export function stepGait(S, d, dt, P) {
  if (!(dt > 0)) return S;
  if (!(d >= 0) || d > 1) d = 0;
  S.v += (d / dt - S.v) * Math.min(1, dt * 8);
  S.dist += d;
  S.phase = (S.dist / P.cycle) % 1;
  const g = clamp(S.v / P.vRef, 0, 1.5);
  const half = Math.floor(S.dist / (P.cycle / 2));
  if (half !== S.half) { // a foot strike: that side's leg is jolted, the opposite arm swings
    const right = (half & 1) === 1;
    S.half = half;
    const k = P.kick * Math.min(1, g);
    (right ? S.r : S.l).w += k;
    (right ? S.al : S.ar).w += k * P.arms;
  }
  const f = P.swing * g * Math.sin(S.phase * TAU);
  integrate(S.l, f, dt, P);
  integrate(S.r, -f, dt, P);
  integrate(S.al, -f * P.arms, dt, P);
  integrate(S.ar, f * P.arms, dt, P);
  return S;
}

/** Largest limb angle (rad): ~0 once settled. */
export const gaitEnergy = (S) => Math.max(Math.abs(S.l.a), Math.abs(S.r.a), Math.abs(S.al.a), Math.abs(S.ar.a));
