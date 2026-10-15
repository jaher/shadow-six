/**
 * The Marine's raft, sim side: the timelines of inflating it (T, abilities/marine.js) and of deflating and folding it
 * (H on the raft, abilities/shared.js) — user 2026-10-14: "animate better how [...] the marine very quickly deflated and
 * folds the raft. Also when the raft is inflated it should be very clear it gets inflated." Pure data and functions:
 * the phases, the chambers' fill levels, the records art/raft-actions.js draws from (`world.raftActs`, transient, never
 * saved). Nothing visual feeds back, except that the inflated hull drawn during the action is handed to the raft the
 * sim spawns at its end (`rec.handoff`, a model object only: no state of the run depends on it).
 *
 * INFLATE (T, CONFIG.abilities.raftDeploy = 4.0 s; was 2.0 s): he kneels at the water's edge facing the launch spot and
 *   swings the folded pack off his back onto the ground in front of his knees (`kneel`), undoes the straps and pushes
 *   the folded hull out over the water — the pleats open out (`spread`) — flips the two folded-in sides out flat
 *   (`unfold`: a flat, wrinkled sheet lies there), takes the CO2 valve on the stern tube and pulls its cord (`cord`; the
 *   hiss at `pull`); the gas fills the hull chamber by chamber (`inflate`, 2.2 s: the stern chamber by the valve, then
 *   one side, the other side round the bow, the thwart last; each from its inlet on, the baffle between two chambers
 *   pinched until both are full), the wrinkles smoothing out as the tubes go taut, a slight bounce when it is full; he
 *   shuts the valve and gets up (`close`). The raft is spawned in the water at the end (as before) and he steps in.
 * PACK (H, CONFIG.abilities.raftPack 2.0 s + raftFold 1.6 s; was 2.0 s, the raft vanishing at its end): he kneels by the
 *   raft's near end and opens the valve (`valve`; the hiss at `open`), the chambers sag and collapse flat in the
 *   reverse order, his hands pressing the air out of the near tube (`deflate`), he drags the flat sheet to his knees
 *   (`drag`) — the raft leaves the sim then (2.0 s, as before: the boat is gone, in his kit) — folds the two sides in
 *   over the middle (`fold`), gathers the strip hand over hand into a stack of pleats at his knees (`gather`), straps the
 *   pack and swings it onto his back (`shoulder`). Interruptible throughout, as before (a move order after the 2.0 s
 *   mark: the pack goes straight onto his back).
 * The director / AUTO read the phases through the task (abilities/common.js actionClock: id, t, dur, left, phase,
 * present) — a raft action is watched to its end.
 * @module abilities/raft-actions
 */
import { CONFIG } from '../config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/**
 * Phase marks (s from the action start). Deploy: the inflation runs from `pull` to `full`, then the bounce until `close`.
 * Pack: the chambers empty from `open` to `flat`; `gone` = CONFIG raftPack (the raft leaves the sim).
 */
export const RAFT = Object.freeze({
  deploy: Object.freeze({
    kneel: [0, 0.45],         // down on his knees, the pack off his back onto the ground in front of them
    straps: [0.4, 0.6],       // the straps undone
    spread: [0.55, 1.05],     // the pleated hull pushed out over the water: the pleats open out
    unfold: [1.0, 1.3],       // the two folded-in sides flipped out: a flat, wrinkled sheet
    cord: [1.25, 1.55],       // his hand to the CO2 valve on the stern tube, the cord pulled
    pull: 1.45,               // the cord pulled: the hiss, the gas in
    inflate: [1.45, 3.65],    // the chambers filling (CHAMBERS)
    full: 3.4,                // every chamber full (then the bounce)
    bounce: [3.3, 3.75],
    close: [3.6, 4.0],        // the valve shut, a pat on the tube, up on his feet
    rise: [3.7, 4.0],
  }),
  pack: Object.freeze({
    kneel: [0, 0.3],          // down on his knees by the near end
    valve: [0.25, 0.6],       // his hand to the valve, unscrewed
    open: 0.55,               // the valve open: the hiss
    deflate: [0.55, 1.75],    // the chambers sagging and collapsing (CHAMBERS, reversed)
    flat: 1.75,
    drag: [1.7, 2.05],        // the flat sheet dragged to his knees (the raft leaves the sim at `gone`)
    fold: [2.05, 2.55],       // the two sides folded in over the middle (left, then right)
    gather: [2.5, 3.15],      // gathered hand over hand into a stack of pleats
    strap: [3.1, 3.3],
    shoulder: [3.25, 3.6],    // the pack up onto his back
  }),
});

/**
 * The hull's chambers along the buoyancy tube's loop (s ∈ [0, 1): 0 = the stern's centre, increasing toward the boat's
 * left (+x), 0.5 = the bow) and the thwart. Inflating: [t0, t1] s after the cord is pulled; the inlet (where a chamber
 * starts filling: the valve, then each baffle in turn) at s = `inlet`, filling toward `dir`. Deflating reverses it.
 */
export const CHAMBERS = Object.freeze([
  Object.freeze({ name: 'stern', s0: -0.17, s1: 0.17, inlet: -0.08, t: [0, 1.15] }),       // the valve on its left quarter
  Object.freeze({ name: 'right', s0: 0.17, s1: 0.5, inlet: 0.17, t: [0.35, 1.55] }),      // (boat's left, +x side)
  Object.freeze({ name: 'left', s0: 0.5, s1: 0.83, inlet: 0.83, t: [0.65, 1.85] }),       // the other side round the bow
  Object.freeze({ name: 'thwart', thwart: true, t: [1.2, 1.95] }),
]);
/** Pack: the chambers empty over [t0, t1] after the valve opens (all of them through the manifold, the far ones last). */
export const EMPTY = Object.freeze([[0, 0.8], [0.15, 1.0], [0.3, 1.2], [0, 0.6]]);

/** Ease of a chamber's fill: the gas rushes in, then the last of it stretches the fabric taut. */
const fillEase = (x) => { x = clamp(x, 0, 1); return 1 - (1 - x) * (1 - x) * (1 - 0.35 * x); };

/** Fill level 0..1 of chamber `k` at `t` s into a deploy (`pack`: into a pack). */
export function chamberLevel(k, t, pack = false) {
  const D = pack ? RAFT.pack : RAFT.deploy;
  if (!pack) { const c = CHAMBERS[k].t; return fillEase((t - D.pull - c[0]) / (c[1] - c[0])); }
  const e = EMPTY[k];
  return 1 - smooth((t - D.open - e[0]) / (e[1] - e[0]));
}

/** The hull's bounce once full (fraction of the tube's radius, ±): a damped swing, 0 outside RAFT.deploy.bounce. */
export function bounceAt(t) {
  const [a, b] = RAFT.deploy.bounce;
  if (t <= a || t >= b) return 0;
  const x = (t - a) / (b - a);
  return 0.045 * Math.sin(Math.PI * 2.5 * x) * (1 - x) * (1 - x);
}

/**
 * Inflated volume fraction of the whole hull at `t` (0 flat … 1 full; the tubes' cross-section ∝ fill, each chamber by
 * its share of the loop, the thwart 8 %): monotonic from `pull` to `full` while inflating, from `open` to `flat` while
 * deflating (tests / tools).
 */
export function hullVolume(t, pack = false) {
  const share = [0.34, 0.29, 0.29, 0.08];
  let v = 0;
  for (let k = 0; k < CHAMBERS.length; k++) v += share[k] * chamberLevel(k, t, pack);
  return v;
}

/** Deploy / pack timeline: {dur, phases: [[name, t0, t1], …]} (dur from CONFIG). */
export function raftTimes(kind) {
  const A = CONFIG.abilities;
  if (kind === 'deploy') {
    const D = RAFT.deploy;
    return { dur: A.raftDeploy, phases: [['kneel', ...D.kneel], ['spread', D.kneel[1], D.spread[1]], ['unfold', D.spread[1], D.cord[0]],
      ['cord', D.cord[0], D.pull], ['inflate', D.pull, D.full], ['close', D.full, A.raftDeploy]] };
  }
  const P = RAFT.pack, dur = A.raftPack + (A.raftFold ?? 0);
  return { dur, gone: A.raftPack, phases: [['kneel', ...P.kneel], ['valve', P.kneel[1], P.open], ['deflate', P.open, P.flat],
    ['drag', P.flat, P.fold[0]], ['fold', P.fold[0], P.gather[0]], ['gather', P.gather[0], P.strap[0]], ['shoulder', P.strap[0], dur]] };
}

/**
 * Record a raft action for art/raft-actions.js (one per Marine: a new one supersedes his last — the art pass winds a
 * drawn one up and drops it; one never drawn, as in a headless run, is dropped here).
 */
export function pushRaftAct(world, rec) {
  const acts = (world.raftActs ||= []);
  for (const r of acts) if (r.a === rec.a) r.superseded = true;
  const keep = acts.filter((r) => !(r.superseded && !r.vis));
  keep.push(rec);
  world.raftActs = keep;
  return rec;
}

