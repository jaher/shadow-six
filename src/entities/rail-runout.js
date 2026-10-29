/**
 * Run-in / run-out of a 'once' train past the map edges (user 2026-10-28: "the train leaves fully the map, not stops at
 * the edge and disappears"). PRESENTATION ONLY: the simulated train (entities/vehicle.js `_updateRail`: schedule,
 * position, kill box, blocking, station stops, events, `hiddenRail`) is untouched — every on-map track point is reached
 * at the same tick as before and the solutions replay identically. Between its passes the DRAWN consist runs on along
 * the track's straight continuations past the edge (the rails drawn there: world/edge-extend.js `railReach`):
 *   - run-in: it starts where nothing of it can be seen at any camera the game allows (hiddenReach) and reaches the
 *     first track point exactly at the tick the sim train appears there, at its speed — when the hidden time before
 *     that tick is shorter than the run-in takes at its speed, it comes in faster and slows to it (no jump);
 *   - run-out: from the last point at its speed, until its rear is that far out; then it is hidden.
 * When the run-out of a pass is still going while the next run-in starts (M4: a train every 34 s), a second drawn
 * consist — the "ghost", a model without an entity — carries the run-out.
 * Pure geometry and timing; the entity glue is Vehicle._runout* (entities/vehicle.js).
 * @module entities/rail-runout
 */
import { CONFIG } from '../config.js';

/** The flattest camera pitch the game allows (the camera dial, 25-60°; CONFIG.camera.pitchDeg 40 without it), m margin. */
export const RUNOUT = Object.freeze({ pitchMinDeg: 25, margin: 3 });

/**
 * The drawn train consist (assets/models/vehicles/manifest.json `train.consist`, built by art/vehicle-library.js
 * createConsist: the locomotive's origin at the entity, the cars behind it along its -z, buffers touching; sidecar
 * bboxes): m ahead of / behind the entity along its heading, its highest top (the locomotive's chimney), half-width.
 * tests/unit/rail-runout.test.mjs re-derives these from the sidecars.
 */
export const TRAIN_CONSIST = Object.freeze({ front: 6.71, rear: 69.86, top: 4.55, half: 1.635 });

/** Extents of a rail vehicle type's drawn body: the train's consist, else its registry hull. */
export function railExtent(def) {
  if (def?.type === 'train') return TRAIN_CONSIST;
  const [l = 10, w = 3] = def?.size || [];
  return { front: l / 2, rear: l / 2, top: 4, half: w / 2 };
}

/**
 * How far (m) past the map rectangle nothing of a body `top` m high can be seen: the camera never shows ground past
 * the scenery apron (engine/camera.js apronMinZoom keeps its true footprint inside CONFIG.apron.width), and a point at
 * height h shows h·cot(pitch) further in than its foot, at the flattest pitch allowed.
 */
export function hiddenReach(top = TRAIN_CONSIST.top, apron = CONFIG.apron.width) {
  return apron + top / Math.tan((RUNOUT.pitchMinDeg * Math.PI) / 180) + RUNOUT.margin;
}

/**
 * How far (m) (x, z) lies past the map rectangle [0, W] × [0, D], as the camera's reach is bounded: its ground footprint
 * stays within the apron's width past the bounds along x and along z (engine/camera.js voidReach, clampOvershoot), so
 * a point is out of every view when it is that far past one side — the larger of its overshoots past x and past z
 * (a corner's apron square is in reach). 0 inside.
 */
export function mapDistance(x, z, W, D) {
  return Math.max(0, -x, x - W, -z, z - D);
}

const P = (p) => (Array.isArray(p) ? { x: +p[0], z: +p[1] } : { x: +p.x, z: +p.z });
/** Smallest u ≥ 0 with ok(u) (ok is false then true along an outward ray: convex distance), to 1 mm. */
function firstTrue(ok, max = 5000) {
  let lo = 0, hi = 0;
  if (ok(0)) return 0;
  for (hi = 1; hi < max && !ok(hi); hi *= 1.5) lo = hi;
  for (let i = 0; i < 40 && hi - lo > 1e-3; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return hi;
}

/**
 * The straight continuations of a track (its first / last segment carried on) and how far along them the drawn body
 * runs: `leadIn` = m before the first point the entity starts its run-in at (its front then `reach` m past the map),
 * `leadOut` = m past the last point it is hidden at (its rear then `reach` m past the map).
 * @param {Array<{x:number,z:number}|number[]>} track @param {number} W @param {number} D
 * @returns {{p0:{x,z}, d0:{x,z}, pn:{x,z}, dn:{x,z}, leadIn:number, leadOut:number, reach:number, extent:object}}
 */
export function runoutGeometry(track, W, D, extent = TRAIN_CONSIST, reach = hiddenReach(extent.top)) {
  const T = track.map(P), n = T.length;
  const unit = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z, m = Math.hypot(dx, dz) || 1; return { x: dx / m, z: dz / m }; };
  const p0 = T[0], d0 = unit(T[0], T[1]), pn = T[n - 1], dn = unit(T[n - 2], T[n - 1]);
  const uIn = firstTrue((u) => mapDistance(p0.x - d0.x * u, p0.z - d0.z * u, W, D) >= reach);
  const uOut = firstTrue((u) => mapDistance(pn.x + dn.x * u, pn.z + dn.z * u, W, D) >= reach);
  return { p0, d0, pn, dn, leadIn: uIn + extent.front, leadOut: uOut + extent.rear, reach, extent };
}

/** Point and heading (rad, entity convention: atan2(dz, dx)) of the entity at track parameter s off the track's ends. */
export function runoutPose(geo, trackLen, s) {
  if (s <= 0) return { x: geo.p0.x + geo.d0.x * s, z: geo.p0.z + geo.d0.z * s, heading: Math.atan2(geo.d0.z, geo.d0.x) };
  const u = s - trackLen;
  return { x: geo.pn.x + geo.dn.x * u, z: geo.pn.z + geo.dn.z * u, heading: Math.atan2(geo.dn.z, geo.dn.x) };
}

/**
 * The run-in at `tau` s before the sim train appears, whose hidden spell began `tau0` s before it: track parameter s
 * (< 0) and speed, or null while it still waits off-map. At its speed v when there is time (s = −v·τ over the last
 * leadIn / v s); else from −leadIn at the start of the spell, slowing evenly to v: s = −v·τ − a·τ².
 */
export function runInAt(geo, v, tau, tau0) {
  const need = geo.leadIn / v;
  if (tau0 >= need) return tau <= need ? { s: -v * tau, speed: v } : null;
  const a = (geo.leadIn - v * tau0) / (tau0 * tau0), t = Math.min(tau, tau0);
  return { s: -v * t - a * t * t, speed: v + 2 * a * t };
}

/** The run-out `u` s after the sim train was hidden at the track's end: {s, speed} or null once it is gone. */
export function runOutAt(geo, v, trackLen, u) {
  return u >= 0 && v * u <= geo.leadOut ? { s: trackLen + v * u, speed: v } : null;
}

/**
 * Does a run-out still go on when the next run-in begins (then a second drawn consist carries it)? The run-in starts
 * max(0, period − leadIn / v) s after the hide, the run-out lasts leadOut / v s.
 */
export function needsGhost(geo, schedule) {
  const v = schedule.speed, start = Math.max(0, schedule.period - geo.leadIn / v);
  return start < geo.leadOut / v;
}

/**
 * The drawn state of a 'once' rail vehicle at sim time `t` — the END of the tick its state `v` is from (a tick's sim
 * state holds once world.time has stepped) — from its sim state alone, + the remembered time of its last hide while it
 * runs again: `lead` = the next pass's run-in, `out` = the last pass's run-out. `late` (s, render interpolation): the
 * state that long before `t`. Ticks of `dt`: the sim train appears at s = 0 and moves on in the same tick (vehicle.js
 * _updateRail), so the run-in is one tick short of railT·v.
 * @param {{railRunning:boolean, railS:number, railT:number, trackLen:number, schedule:{period:number, speed:number, delay:number}}} v
 * @param {number|null} hideAt sim time (tick end) of the last hide when the entity runs again (null: none / unknown)
 * @returns {{lead:{s:number, speed:number}|null, out:{s:number, speed:number}|null, hideAt:number|null}}
 */
export function runoutState(v, geo, t, hideAt = null, dt = 0, late = 0) {
  const S = v.schedule, sp = S.speed;
  let lead = null;
  if (!v.railRunning) {
    const ran = v.railS >= v.trackLen - 1e-6; // hidden after a run (at the track's end); else before the first one
    lead = runInAt(geo, sp, Math.max(0, v.railT - dt + late), Math.max(dt, (ran ? S.period : S.delay) - dt));
    hideAt = ran ? t - (S.period - v.railT) : null;
  }
  // (a frame drawn between the tick before the hide and the hide's own: at the end of the track)
  const u = hideAt == null ? null : t - late - hideAt;
  const out = u == null || u < -2 * (dt || 1 / 60) ? null : runOutAt(geo, sp, v.trackLen, Math.max(0, u));
  return { lead, out, hideAt };
}
