/**
 * Oars of the wooden rowboat — pure geometry and the row cycle (art/boat-crew.js draws them and the oarsman's arms,
 * art/water.js rings the catches). Hull model space: +x the boat's LEFT (port), y up from the design waterline, +z the
 * bow. The oarsman sits on the midship thwart facing aft; each oar turns between a pair of thole pins on the gunwale a
 * little aft of him (in front of him: rowing geometry — the handles cross the pins' line mid-drive), the blade outboard,
 * the loom across the gunwale to the handle in his hand.
 *
 * Angles: sweep θ (+ = blade toward the bow, handle toward the stern), pitch φ (+ = blade down), feather ψ (0 square
 * to the water, π/2 flat). A row stroke at phase u: catch (blades dip in, arms out, leaning toward the stern) → drive
 * (blades in, lean back, handles pulled to the chest) → release (blades out, feathered) → recovery (swing forward).
 * @module art/oars
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * The rowboat's oars (2.6 m, rowboat.py `dims.oar_length`): the port thole pivot (starboard: x mirrored) on the
 * gunwale 0.35 m aft of the midship thwart, the inboard length to the handle end, the hand's spot on the grip, the
 * blade (from `length − blade` to the tip).
 */
export const OAR = Object.freeze({
  length: 2.6, inboard: 0.6, grip: 0.14, hand: 0.53, blade: 0.55, bladeW: 0.13,
  pivot: Object.freeze([0.665, 0.575, -0.5]),
  /** gunwale top at the pivot (the thole pins stand on it) */
  gunwale: 0.505,
});
/** Pivot → blade centre (m). */
export const BLADE_C = OAR.length - OAR.inboard - OAR.blade / 2;

/** Pitch (rad) that puts the blade centre at height y (hull space, waterline 0). */
export const pitchFor = (y) => Math.asin(clamp((OAR.pivot[1] - y) / BLADE_C, -1, 1));

/**
 * Row cycle constants: sweep at the catch / finish, pitch with the blade buried (centre 12 cm down: the 13 cm blade
 * wholly under) / clear of the water on the recovery, the drive's share of the cycle, the oarsman's lean.
 */
export const ROW = Object.freeze({
  catch: 0.7, finish: -0.6, pitchIn: pitchFor(-0.12), pitchOut: pitchFor(0.14),
  drive: 0.45, dip: 0.06, release: 0.52, bendCatch: 0.42, bendFinish: -0.25,
});
/** At rest with the oarsman holding them: square-ish to the boat, blades flat on the water. */
export const EASY = Object.freeze({ sweep: -0.2, pitch: pitchFor(0.02), feather: Math.PI / 2, bend: 0.05 });
/** Nobody at the oars (men aboard): swung aft alongside the hull over the gunwale, blades flat, lifted clear of the water. */
export const TRAIL = Object.freeze({ sweep: -1.15, pitch: pitchFor(0.2), feather: Math.PI / 2, bend: 0.05 });

/**
 * One forward stroke at phase u (0 = the catch). @returns {{sweep:number, pitch:number, feather:number, bend:number,
 * wet:boolean}} wet = the blade is in the water (drive).
 */
export function rowKey(u) {
  u = ((u % 1) + 1) % 1;
  const R = ROW;
  let sweep, pitch, feather = 0, bend;
  if (u < R.drive) {
    const k = smooth(u / R.drive);
    sweep = lerp(R.catch, R.finish, k);
    pitch = lerp(R.pitchOut, R.pitchIn, smooth(u / R.dip));
    bend = lerp(R.bendCatch, R.bendFinish, k);
  } else {
    const r = (u - R.drive) / (1 - R.drive);                  // 0 … 1 over release + recovery
    sweep = lerp(R.finish, R.catch, smooth((u - R.release) / (0.95 - R.release)));
    pitch = lerp(R.pitchIn, R.pitchOut, smooth((u - R.drive) / (R.release - R.drive)));
    feather = (Math.PI / 2) * smooth((u - R.drive) / 0.1) * (1 - smooth((u - 0.86) / 0.1));
    bend = lerp(R.bendFinish, R.bendCatch, smooth((r - 0.1) / 0.8));
  }
  return { sweep, pitch, feather, bend, wet: u > 0.03 && u < R.drive + 0.02 };
}

/** Backing water (the inside oar when pivoting): the stroke run backwards, blade in while it pushes toward the bow. */
export function backKey(u) {
  return rowKey(ROW.drive - (((u % 1) + 1) % 1));
}

/** Mix two oar keys (k = 0 → a, 1 → b). */
export function mixOar(a, b, k) {
  return { sweep: lerp(a.sweep, b.sweep, k), pitch: lerp(a.pitch, b.pitch, k), feather: lerp(a.feather, b.feather, k),
    bend: lerp(a.bend ?? 0, b.bend ?? 0, k), wet: k > 0.5 ? !!b.wet : !!a.wet };
}

/** Oar direction pivot → blade (unit, hull space) for side s (+1 port, −1 starboard). */
export function oarDir(s, sweep, pitch) {
  const c = Math.cos(pitch);
  return [s * c * Math.cos(sweep), -Math.sin(pitch), c * Math.sin(sweep)];
}
/** Pivot of side s (+1 port, −1 starboard). */
export const pivotOf = (s) => [s * OAR.pivot[0], OAR.pivot[1], OAR.pivot[2]];

/**
 * The oar of side s at sweep / pitch: pivot, the hand's spot on the grip, the handle end, the blade centre and tip.
 * @returns {{pivot:number[], dir:number[], hand:number[], end:number[], blade:number[], tip:number[]}}
 */
export function oarPoints(s, sweep, pitch) {
  const p = pivotOf(s), d = oarDir(s, sweep, pitch);
  const at = (k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
  return { pivot: p, dir: d, hand: at(-OAR.hand), end: at(-OAR.inboard), blade: at(BLADE_C), tip: at(OAR.length - OAR.inboard) };
}

/** Sweep and pitch of the oar of side s whose loom runs through hull point q (the hand on the grip). */
export function oarAnglesThrough(s, q) {
  const p = pivotOf(s);
  const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];   // grip → pivot = pivot → blade direction
  const h = Math.hypot(dx, dz);
  return { sweep: Math.atan2(dz, dx * s), pitch: Math.atan2(-dy, h), reach: Math.hypot(dx, dy, dz) };
}

/**
 * Stroke period (s) at boat speed v (m/s): the blade grips the water through the drive (the boat runs past it), so a
 * faster boat takes quicker strokes; clamped to a sane rate (23 … 48 strokes a minute).
 */
export function rowPeriod(v) {
  const travel = BLADE_C * Math.cos(ROW.pitchIn) * (Math.sin(ROW.catch) - Math.sin(ROW.finish)); // blade sweep along the hull
  return clamp(travel / (ROW.drive * Math.max(0.1, v)), 1.25, 2.6);
}

/**
 * Where the blades catch, relative to the boat: forward of midships (+) and out from the centreline (m), at the
 * catch sweep with the blade buried — the wake's catch rings (art/water.js).
 */
export function catchOffset() {
  const b = oarPoints(1, ROW.catch, ROW.pitchIn).blade;
  return { fwd: b[2], side: b[0] };
}
