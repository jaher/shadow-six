/**
 * Contact knife kill (user 2026-10-02: "When killing someone from behind it should look like you are stabbing the front
 * neck from behind. When stabbing from the front it should look as if there is no distance"). Sim side, deterministic:
 * the attacker's last step in to body contact, which man faces which way, where the victim is held, where his corpse
 * lies. The paired poses (hands on his mouth / shoulder, the blade at the throat / in the belly, the sag and the fall)
 * are drawn by art/knife-kill.js from the record this module leaves on the world; nothing visual feeds back.
 *
 *   knifeSide(attacker, victim)          'behind' when the attacker stands within ±70° of the victim's back, else 'front'
 *   contactPlan(world, attacker, victim) the step in: {side, from, to, close, vh, fall?} — or null (no room for contact:
 *                                        a wall / prop / vehicle at the contact spot or in the step, water, another
 *                                        level, a dog, a man not on his feet): the classic stab at arm's length
 *   stepAt(plan, t)                      the attacker's position / heading t s into the step (eased arc round the
 *                                        victim: he never walks through him)
 *
 * Gameplay timing: the action starts at the usual reach (CONFIG.abilities.knife.reach); the step takes `close` s
 * (0.1–0.3 s at a lunging 3.6 m/s), the kill comes K.hit (0.3 s) after it, the action ends K.dur (0.6 s) after it. The
 * victim is held where he stands from the start (no slide; his brain still runs but cannot move or turn him), turned to
 * face the attacker for a frontal kill only at the hit (visually during the step). Silent as before.
 * @module abilities/knife-contact
 */
import { CONFIG } from '../config.js';
import { bodyGap, hasObstacles } from '../world/body-clearance.js';

/** Contact geometry (m, s). Root-to-root distances: the torsos (spine_03) touch at about these on the UAL bodies. */
export const CONTACT = Object.freeze({
  behindCone: (70 * Math.PI) / 180, // attacker within ±70° of the victim's back = from behind
  behind: 0.41,  // his chest (0.19 m ahead of his feet) to the victim's back (0.22 m behind his): torsos touching
  front: 0.31,   // chest to chest (0.19 + 0.17 m, pressed in), both leaning in
  speed: 3.6,    // m/s of the last step in (a lunge)
  close: [0.1, 0.3], // s: bounds of the step
  rise: 0.2,     // m: both men on one level (sim elevation / y)
  fall: 0.85,    // m: a man pitched forward onto his face lies this far ahead of where he stood (prone corpse spot)
  fallLine: 1.7, // m of clear ground the forward fall needs
  back: 0.7,     // m: a man pushed off the blade (frontal kill) staggers this far back before he falls on his back
  backLine: 2.1, // m of clear ground behind him for that (his heels end clear of the attacker's boots)
});

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** 'behind' when the attacker stands within ±70° of the victim's back, else 'front'. */
export function knifeSide(a, v) {
  const dx = a.x - v.x, dz = a.z - v.z, d = Math.hypot(dx, dz);
  if (d < 1e-6) return 'behind';
  const back = -(Math.cos(v.heading) * dx + Math.sin(v.heading) * dz) / d; // cos of the angle off his back
  return back >= Math.cos(CONTACT.behindCone) - 1e-9 ? 'behind' : 'front';
}

/** Is the forward fall line from (x, z) along h clear (no wall / building / standing visual / ledge)? */
export function fallClear(grid, x, z, h, len) {
  const c = grid.cell, y0 = grid.elevAt ? grid.elevAt(x, z) : 0, ca = Math.cos(h), sa = Math.sin(h), px = -sa * 0.25, pz = ca * 0.25;
  for (let d = 0.3; d <= len + 1e-9; d += 0.2) {
    for (const s of [-1, 0, 1]) {
      const qx = x + ca * d + px * s, qz = z + sa * d + pz * s, i = Math.floor(qx / c), j = Math.floor(qz / c);
      if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return false;
      const k = j * grid.cols + i;
      if (grid.block[k] !== 0 || grid.navBlock?.[k] || grid.solidAt?.(qx, qz) || grid.isWater?.(i, j)) return false;
      if (grid.elev && Math.abs(grid.elev[k] - y0) > 0.3) return false;
    }
  }
  return true;
}

/** Attacker position / heading `t` s into the step of `plan`: an eased arc round the victim (radius and bearing). */
export function stepAt(plan, t) {
  const k = plan.close > 0 ? smooth(t / plan.close) : 1;
  const { v, from, to } = plan;
  const r0 = Math.hypot(from.x - v.x, from.z - v.z), r1 = Math.hypot(to.x - v.x, to.z - v.z);
  const b0 = Math.atan2(from.z - v.z, from.x - v.x), b1 = Math.atan2(to.z - v.z, to.x - v.x);
  const b = b0 + wrap(b1 - b0) * k, r = r0 + (r1 - r0) * k;
  return { x: v.x + Math.cos(b) * r, z: v.z + Math.sin(b) * r, h: from.h + wrap(to.h - from.h) * k };
}

/**
 * Plan the contact kill of `victim` by `attacker` (both where they stand now), or null when contact is not possible
 * (the classic stab at arm's length then plays, as before).
 * `o` (the Spy's injection, abilities/spy-actions.js): {behind, front} contact distances (m, default CONTACT's),
 * `falls: false` = no forward-fall / stagger-back line checks (the caller checks the ground its own way), `off` = the
 * caller's own kill switch (default CONFIG.abilities.knife.contact).
 * @returns {null | {side:'behind'|'front', v:{x,z,h}, from:{x,z,h}, to:{x,z,h}, close:number, vh:number, fall:number|null,
 *   back?:number, dist:number}} (dist: root-to-root contact distance; fall: heading he pitches forward along (behind);
 *   back: m he staggers back off the blade (front, 0 with no room behind him))
 */
export function contactPlan(world, attacker, victim, o = {}) {
  if (o.off ?? (CONFIG.abilities.knife.contact === false)) return null;
  const dBehind = o.behind ?? CONTACT.behind, dFront = o.front ?? CONTACT.front, falls = o.falls !== false;
  if (!world || !attacker || !victim || victim.kind !== 'enemy' || victim.soldierType === 'dog' || victim.animal) return null;
  if ((victim.stance && victim.stance !== 'stand') || (attacker.stance && attacker.stance !== 'stand')) return null;
  if (attacker.underwater || attacker.diving || victim.vehicle || attacker.vehicle) return null;
  if (Math.abs((victim.y || 0) - (attacker.y || 0)) > CONTACT.rise) return null;
  const g = world.grid;
  const side = knifeSide(attacker, victim);
  const v = { x: victim.x, z: victim.z, h: victim.heading || 0 };
  let to, vh = v.h, fall = null;
  if (side === 'behind') {
    to = { x: v.x - Math.cos(v.h) * dBehind, z: v.z - Math.sin(v.h) * dBehind, h: v.h };
  } else {
    const dx = attacker.x - v.x, dz = attacker.z - v.z, d = Math.hypot(dx, dz);
    const ux = d > 1e-6 ? dx / d : Math.cos(v.h), uz = d > 1e-6 ? dz / d : Math.sin(v.h);
    vh = Math.atan2(uz, ux); // he turns to face the attacker (startled)
    to = { x: v.x + ux * dFront, z: v.z + uz * dFront, h: Math.atan2(-uz, -ux) };
  }
  if (g) {
    const e0 = g.elevAt ? g.elevAt(v.x, v.z) : 0;
    const level = (x, z) => !g.elevAt || Math.abs(g.elevAt(x, z) - e0) <= CONTACT.rise;
    if (!g.walkableAt(to.x, to.z) || !level(to.x, to.z)) return null;
    // his body clear of hulls / props / standing solids at the contact spot (the victim and the attacker excepted)
    if (hasObstacles(world) && bodyGap(world, to.x, to.z, to.h, 'stand') < 0) return null;
  }
  const from = { x: attacker.x, z: attacker.z, h: attacker.heading || 0 };
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const plan = { side, v, from, to, vh, fall, dist: side === 'behind' ? dBehind : dFront,
    close: Math.min(CONTACT.close[1], Math.max(CONTACT.close[0], dist / CONTACT.speed)) };
  if (g) {
    // the step itself (a few points along the arc): on walkable ground on his level, his body clear of solids
    for (let i = 1; i < 6; i++) {
      const p = stepAt(plan, (plan.close * i) / 6);
      if (!g.walkableAt(p.x, p.z)) return null;
      if (hasObstacles(world) && bodyGap(world, p.x, p.z, p.h, 'stand') < 0) return null;
    }
    if (!falls) return plan;
    if (side === 'behind') {
      // he pitches forward onto his face (away from the attacker): straight ahead, else a diagonal that is clear
      for (const off of [0, Math.PI / 4, -Math.PI / 4]) {
        const h = v.h + off;
        if (fallClear(g, v.x, v.z, h, CONTACT.fallLine)) { plan.fall = wrap(h); break; }
      }
      if (plan.fall == null) return null;
    } else plan.back = fallClear(g, v.x, v.z, vh + Math.PI, CONTACT.backLine) ? CONTACT.back : 0;
  } else if (!falls) return plan;
  else if (side === 'behind') plan.fall = v.h;
  else plan.back = CONTACT.back;
  return plan;
}

/** Sim seconds of the step + hit / end of the action for a plan (null: the classic stab). */
export function knifeTimes(plan) {
  const K = CONFIG.abilities.knife, c = plan ? plan.close : 0;
  return { close: c, hit: c + K.hit, dur: c + K.dur };
}
