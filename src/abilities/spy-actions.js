/**
 * The Spy's hands-on actions, sim side (user 2026-10-07: "The animation of the spy grabbing clothes or injecting poison
 * should be as realistic as possible"). Deterministic plans and timelines; the poses, the props and the laundry are
 * drawn by art/spy-actions.js from the records this module leaves on the world (`world.spyActs`, transient: never
 * saved); nothing visual feeds back.
 *
 * LETHAL INJECTION (abilities/spy.js 'syringe'): a contact kill like the knife (abilities/knife-contact.js: the attacker
 * within ±70° of the victim's back is "behind"; at the usual reach she steps in, 0.1–0.3 s, and the victim is held
 * where he stands). The syringe comes out of her breast pocket during the step.
 *   from behind  chest on his back (0.41 m root to root): her left palm clamps over his mouth and nose and pulls his head
 *                back, her right fist brings the needle round to the right side of his neck (the carotid) and her thumb
 *                presses the plunger; he stiffens, grabs her forearm, struggles, goes limp; she lowers him onto his
 *                back, stepping back 0.7 m as his hips go down where he stood, kneels behind his head, lets go,
 *                stands and puts the syringe back
 *   from the front (he turns to her as the knife victim does): a hand on his collar, the needle into the left side of
 *                his neck at 0.42 m; he clutches her wrist, crumples while she holds his collar, and is let go to fall
 *                back (his body lies 0.3 m further back than he stood, clear of her feet)
 *   timing: the kill at 0.5 s as the classic jab (gameplay unchanged: the step, the grab and the needle fit in it —
 *   the needle in 0.12 s after the step, 0.12–0.2 s before the kill, the plunger pressed home by it); ends at hit + 1.25 s
 *   (behind) / hit + 0.95 s (front), 1.75 / 1.45 s in all (0.9 s before); it can be interrupted from hit + 0.15 s (a
 *   move order: she lets go and he slumps down), so the Spy is held no longer than before (0.65 s vs 0.9 s). No room for contact or for laying him down (a wall, a prop, water, another level, a dog): the
 *   classic jab at arm's length, 0.9 s, as before. Silent to the AI as before; his cry is muffled (audio/event-map.js).
 *
 * UNIFORM FROM A CLOTHESLINE (abilities/shared.js 'use' on a clothesline): she walks to the line in front of the uniform
 * (the officer's cap hangs between the tunic and the trousers, art/clothesline.js LAUNDRY), pulls the tunic and the
 * trousers off the pegs with both hands, rolls them under her left arm, lifts the cap off its peg (the line is left
 * with the shirt and the towel), steps behind the remaining laundry (on the side away from the nearest enemy, ducking
 * under the line if that is the other side), and dresses: the officer's cap hung on the line in front of her, her own
 * cap off and into the bundle, the tunic out of the bundle and swung on (the outfit changes as her arms go into the
 * sleeves), the buttons, the cap off the line onto her head, a tug at the hem. Watched when she has taken it: the
 * uniform goes in her kit and she does not dress (as before).
 *   timing: take 1.05 s (the uniform in her kit at the end of it), the step ≤ 0.55 s, dressed (the disguise on) 0.8 s
 *   into the dressing, the action ends 1.48 s into it; interruptible throughout, as before.
 * UNIFORM FROM THE KIT (U): the bundle out of her kit (0.32 s), her cap swapped first, then the tunic; dressed at
 * 1.06 s, ends 1.58 s.
 * @module abilities/spy-actions
 */
import { CONFIG } from '../config.js';
import { contactPlan, fallClear } from './knife-contact.js';
import { bodyGap, hasObstacles } from '../world/body-clearance.js';
import { LAUNDRY } from '../art/clothesline.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// ------------------------------------------------------------------ lethal injection

/** Injection geometry (m) and timeline (s). */
export const INJ = Object.freeze({
  behind: 0.41,     // root to root, chest on his back (as the knife)
  front: 0.42,      // root to root face to face: a forearm's length (the needle goes into the side of his neck)
  needle: 0.12,     // s after the step at the earliest: the needle in (the plunger pressed until the hit)
  free: 0.15,       // s after the hit: interruptible (a move order: she lets go)
  endBehind: 1.25,  // s after the hit: the action ends (he lies on his back, she has stood up, the syringe away)
  endFront: 0.95,
  lieAhead: 0.5,    // m: from behind, his corpse's root lies this far ahead of where he stood (hips where his feet were)
  stepBack: 0.7,    // m: from behind, she steps back this far as she lowers him (down on one knee behind his head)
  backFrom: 0.3,    // s after the hit: the step back starts (as his knees give)
  backDur: 0.5,     // s: the step back
  lieBack: 0.3,     // m: from the front, his corpse lies this far back from where he stood
});

/**
 * Plan a contact injection of `victim` by the Spy `c`, or null (no room: the classic jab). Behind: the ground for laying
 * him on his back (his hips where his feet were, his head where she stood) and her step back must be clear and level.
 * @returns {null|object} the knife-contact plan plus {lie:{x,z,h}, back:{x,z,h}|null, lieBack:number}
 */
export function injectionPlan(world, c, victim) {
  if (CONFIG.abilities.syringeContact === false) return null;
  const P = contactPlan(world, c, victim, { behind: INJ.behind, front: INJ.front, falls: false, off: false });
  if (!P) return null;
  const g = world?.grid, v = P.v;
  const fx = Math.cos(v.h), fz = Math.sin(v.h);
  if (P.side === 'behind') {
    P.lie = { x: v.x + fx * INJ.lieAhead, z: v.z + fz * INJ.lieAhead, h: v.h };
    const d = INJ.behind + INJ.stepBack;
    P.back = { x: v.x - fx * d, z: v.z - fz * d, h: v.h };
    if (g) {
      const e0 = g.elevAt ? g.elevAt(v.x, v.z) : 0;
      // his legs ahead (0.9 m), his back and head behind where he stood, and her kneel behind his head (1.6 m)
      if (!fallClear(g, v.x, v.z, v.h, 0.9) || !fallClear(g, v.x, v.z, v.h + Math.PI, 1.6)) return null;
      if (!g.walkableAt(P.back.x, P.back.z) || (g.elevAt && Math.abs(g.elevAt(P.back.x, P.back.z) - e0) > 0.2)) return null;
      if (hasObstacles(world) && bodyGap(world, P.back.x, P.back.z, P.back.h, 'stand') < 0) return null;
    }
  } else {
    P.lieBack = g && !fallClear(g, v.x, v.z, P.vh + Math.PI, 1.8) ? 0 : INJ.lieBack;
    P.lie = { x: v.x - Math.cos(P.vh) * P.lieBack, z: v.z - Math.sin(P.vh) * P.lieBack, h: P.vh };
    P.back = null;
  }
  return P;
}

/** Sim seconds of an injection plan: step, needle, hit (the kill), free (interruptible), end. */
export function injectTimes(plan) {
  const S = CONFIG.weapons.syringe, c = plan ? plan.close : 0;
  if (!plan) return { close: 0, needle: S.hit, hit: S.hit, free: S.dur, dur: S.dur };
  // the kill at 0.5 s from the start, as the classic jab (gameplay unchanged): the step, the grab and the needle all fit
  // in it — the needle in 0.12 s after the step (0.2 – 0.12 s before the kill: the plunger's press)
  const hit = S.hit;
  return { close: c, needle: Math.min(hit - 0.12, Math.max(c + INJ.needle, hit - 0.2)), hit, free: hit + INJ.free, dur: hit + (plan.side === 'behind' ? INJ.endBehind : INJ.endFront) };
}

/** The Spy's position / heading `t` s into a contact injection: the step in, then (behind) the step back. */
export function injectAt(plan, T, t) {
  const k = plan.close > 0 ? smooth(t / plan.close) : 1;
  const { v, from, to } = plan;
  const r0 = Math.hypot(from.x - v.x, from.z - v.z), r1 = Math.hypot(to.x - v.x, to.z - v.z);
  const b0 = Math.atan2(from.z - v.z, from.x - v.x), b1 = Math.atan2(to.z - v.z, to.x - v.x);
  const b = b0 + wrap(b1 - b0) * k, r = r0 + (r1 - r0) * k;
  const p = { x: v.x + Math.cos(b) * r, z: v.z + Math.sin(b) * r, h: from.h + wrap(to.h - from.h) * k };
  if (plan.back) {
    const s = smooth((t - T.hit - INJ.backFrom) / INJ.backDur);
    if (s > 0) { p.x += (plan.back.x - to.x) * s; p.z += (plan.back.z - to.z) * s; }
  }
  return p;
}

// ------------------------------------------------------------------ uniform

/** Dressing timeline (s). Take: from the action start; dress: from the start of the dressing (D0). */
export const DRESS = Object.freeze({
  settle: 0.15,     // into the take spot, facing the line
  grab: 0.27,       // both hands on the near corners of the tunic and the trousers
  bundle: 0.62,     // the two rolled under her left arm
  capGrab: 0.8, capOff: 0.86, capHand: 1.0,
  take: 1.05,       // the uniform in her kit
  stepSpeed: 2.6,   // m/s to the dressing spot behind the laundry
  step: [0.25, 0.55],
  kitOut: 0.32,     // U: the bundle out of her kit
  // the dressing, from its start (the beats: art/spy-actions.js VDL / VDK). At a clothesline: the officer's cap hung on
  // the line in front of her, her own cap off into the bundle, the tunic out and swung on, arms into the sleeves — the
  // outfit changes, the disguise on — the buttons, the cap off the line onto her head, a tug at the hem. From the kit:
  // her cap swapped first (no line to hang it on), then the tunic (the swap), buttons, hem, a touch to the visor.
  line: Object.freeze({ swap: 0.8, end: 1.48 }),
  kit: Object.freeze({ swap: 0.74, end: 1.26 }),
  abort: 0.25,      // watched: she stops, the bundle goes in her kit
});

/** The clothesline's frame: position, line axis (local X) and normal (local Z) in world x/z. */
export function lineFrame(line) {
  // where the line is drawn: a mission may stand the rack off its use point (`visualAt` [x, z] / `visualRot`, e.g. M15's
  // rack on the balcony, interactables.js) — the Spy reaches for the garments where they hang
  const p = line.params || {};
  const r = p.visualRot ?? p.rot ?? p.heading ?? 0;
  const x = p.visualAt?.[0] ?? line.x, z = p.visualAt?.[1] ?? line.z;
  return { x, z, ax: Math.cos(r), az: Math.sin(r), nx: -Math.sin(r), nz: Math.cos(r) };
}
/** The height the line stands on: its explicit `visualY` (a raised deck), else the ground under it. */
export const lineY = (world, line, F = lineFrame(line)) =>
  line.params?.visualY ?? (world?.grid?.elevAt ? world.grid.elevAt(F.x, F.z) : 0);
/** World point of line-local (lx along the line, lz off it). */
export const linePoint = (F, lx, lz) => ({ x: F.x + F.ax * lx + F.nx * lz, z: F.z + F.az * lx + F.nz * lz });

/** Side of the line (+1 / -1 along its normal) a point is on. */
const sideOf = (F, x, z) => ((x - F.x) * F.nx + (z - F.z) * F.nz >= 0 ? 1 : -1);

function spotFree(world, x, z, h, y0) {
  const g = world?.grid;
  if (!g) return true;
  if (!g.walkableAt(x, z)) return false;
  if (g.elevAt && Math.abs(g.elevAt(x, z) - y0) > 0.25) return false;
  return !(hasObstacles(world) && bodyGap(world, x, z, h, 'stand') < 0);
}

/**
 * Where the Spy stands to take the uniform: in front of the cap, LAUNDRY.standOff off the line, on her side (the other
 * side when hers is blocked); null when neither is free. @returns {{x,z,h,side}|null}
 */
export function takeSpot(world, c, line) {
  const F = lineFrame(line), y0 = lineY(world, line, F);
  const s0 = sideOf(F, c.x, c.z);
  for (const s of [s0, -s0]) {
    const p = linePoint(F, LAUNDRY.cap, s * LAUNDRY.standOff);
    const h = Math.atan2(-s * F.nz, -s * F.nx); // facing the line
    if (spotFree(world, p.x, p.z, h, y0)) return { ...p, h, side: s };
  }
  return null;
}

/**
 * Where she dresses: behind the shirt (else the towel), on the side of the line away from the nearest living enemy
 * within 40 m (her own side when nobody is near), ducking under the line where the uniform hung if that is the other
 * side. null: she dresses where she took it.
 */
export function coverSpot(world, take, line) {
  const F = lineFrame(line), y0 = lineY(world, line, F);
  let best = null, bd = 40;
  for (const e of world?.enemies || []) {
    if (!e.alive || e.removed) continue;
    const d = Math.hypot(e.x - F.x, e.z - F.z);
    if (d < bd) { bd = d; best = e; }
  }
  const away = best ? -sideOf(F, best.x, best.z) : take.side;
  for (const lx of [LAUNDRY.shirt, LAUNDRY.towel]) {
    const p = linePoint(F, lx, away * LAUNDRY.standOff);
    const h = Math.atan2(-away * F.nz, -away * F.nx);
    if (!spotFree(world, p.x, p.z, h, y0)) continue;
    // the way there: on walkable ground (under the line where the trousers hung when she crosses)
    const mid = away === take.side ? linePoint(F, (LAUNDRY.cap + lx) / 2, away * LAUNDRY.standOff) : linePoint(F, LAUNDRY.trousers, 0);
    if (world?.grid && !world.grid.walkableAt(mid.x, mid.z)) continue;
    return { ...p, h, side: away, duck: away !== take.side };
  }
  return null;
}

/**
 * Dressing timeline for a plan: mode 'line' (take + step + dress) or 'kit' (U: bundle out + dress).
 * @returns {{take:number, step:number, d0:number, swap:number, dur:number}}
 */
export function dressTimes(mode, cover = null, take = null) {
  if (mode === 'kit') {
    const d0 = DRESS.kitOut;
    return { take: 0, step: 0, d0, swap: d0 + DRESS.kit.swap, dur: d0 + DRESS.kit.end };
  }
  const dist = cover && take ? Math.hypot(cover.x - take.x, cover.z - take.z) : 0;
  const step = cover ? clamp(dist / DRESS.stepSpeed, DRESS.step[0], DRESS.step[1]) : 0;
  const d0 = DRESS.take + step;
  return { take: DRESS.take, step, d0, swap: d0 + DRESS.line.swap, dur: d0 + DRESS.line.end };
}

/** The Spy's position / heading `t` s into a clothesline dressing: settle into the take spot, then the step behind the laundry. */
export function dressAt(rec, t) {
  const { from, take, cover } = rec.plan, T = rec.T;
  if (!take) return null;
  const k = smooth(t / DRESS.settle);
  const p = { x: from.x + (take.x - from.x) * k, z: from.z + (take.z - from.z) * k, h: from.h + wrap(take.h - from.h) * k };
  if (cover && T.step > 0) {
    const s = smooth((t - T.take) / T.step);
    if (s > 0) {
      p.x = take.x + (cover.x - take.x) * s; p.z = take.z + (cover.z - take.z) * s;
      p.h = take.h + wrap(cover.h - take.h) * s;
    }
  }
  return p;
}

/** Record a Spy action for art/spy-actions.js (one per Spy; a new one replaces hers / its victim's). */
export function pushSpyAct(world, rec) {
  const acts = (world.spyActs ||= []);
  for (let i = acts.length - 1; i >= 0; i--) if (acts[i].a === rec.a || (rec.v && acts[i].v === rec.v)) acts.splice(i, 1);
  acts.push(rec);
  return rec;
}
