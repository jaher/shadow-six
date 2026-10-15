/**
 * Marine: Fins (design-spec §3.4) — owned by ABILITIES. Harpoon: abilities/weapons.js; knife from the water:
 * abilities/knife.js; packing the raft: the hand (abilities/shared.js).
 *   dive  D  diving gear on/off (1.5 s). Only in SHALLOW water or aboard a boat. Submerged (`underwater`) he is
 *            invisible except to witnesses (enemies whose cone held him as he went under keep him, near band).
 *            He moves through WATER/SHALLOW only (1.8 m/s); gear off only in shallow water.
 *   raft  T  inflates the raft (4.0 s: kneeling, the pack spread over the water, the CO2 cord, the chambers filling,
 *            the valve shut — abilities/raft-actions.js) standing on dry ground at the water's edge, puts it in the water
 *            beside him as a `raft` vehicle (VEHICLES API) and boards it; ordered from the water he first makes for the
 *            nearest bank he can launch it from and climbs out (gear on: off in the shallows there first). Only he rows
 *            it (§3.7 operator rules in shared.js `board`).
 * @module abilities/marine
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { timedTask, freeToAct, inShallow } from './common.js';
import { T } from '../world/grid.js';
import { recordWitnesses } from './system.js';
import { RAFT, raftTimes, pushRaftAct } from './raft-actions.js';

const A = CONFIG.abilities;

function inBoat(c) {
  return c.state === 'inVehicle' && c.vehicle?.vehicleKind === 'boat';
}

registerAbility({
  id: 'dive', label: 'Diving gear', icon: '🤿', hotkey: 'd', roles: ['diver'], item: 'divingGear', targeting: 'self',
  order: 50, visibleToEnemies: true,
  canUse(c, t, world) {
    if (c.carrying) return 'Drop it first.';
    if (c.diving) return inShallow(world, c) ? true : 'Only in shallow water.';
    if (inBoat(c)) return true;
    const f = freeToAct(c);
    if (f !== true) return f;
    return inShallow(world, c) ? true : 'Only in shallow water or aboard a boat.';
  },
  start(c, t, world) {
    const on = !c.diving;
    c.playAction('use', A.dive);
    return timedTask({ dur: A.dive, steps: [{ at: A.dive, fn: () => {
      if (on) {
        if (inBoat(c)) { const v = c.vehicle; v.exit(c); c.setPosition(v.x, v.z); }
        recordWitnesses(world, c);
        c.diving = true;
        c.stance = 'dive';
        c.underwater = true;
        world.events.emit('unit:stance', { unit: c, stance: 'dive' });
        world.events.emit('unit:water', { unit: c, what: 'dive' });
      } else {
        c.diving = false;
        c.underwater = false;
        c.witnesses = null;
        c.stance = 'stand';
        world.events.emit('unit:stance', { unit: c, stance: 'stand' });
        world.events.emit('unit:water', { unit: c, what: 'surface' });
      }
      return true;
    } }] });
  },
});

// ---------------------------------------------------------------------------------------------------------- raft
// User 2026-10-11: "the marine seems to stand on water when deploying the boat, he can only the deploy the boat on the
// ground. If it's swimming in the water it should come out first to the ground, then deploy the raft". He inflates it
// standing on dry ground at the water's edge and puts it in the water beside him; ordered from the water he first
// swims / wades to the nearest bank he can launch it from and climbs out (with the gear on: takes it off in the
// shallows there first). Nowhere to launch it from: refused.

/** m: the raft's centre goes in this far from where he stands (its 2.6 × 1.3 m hull in the water by the bank). */
const LAUNCH_MIN = 1.0, LAUNCH_MAX = 3.0;
/** m: the farthest bank he makes for when ordered from the water. */
const SHORE_SEARCH = 30;
/** Hull points (forward, left; m) that must lie in the water for a launch: all of it afloat (art/boat-rest.js: not
 *  perched on the bank by its stern). */
const HULL = [[0, 0], [0.95, 0], [0.5, 0.45], [0.5, -0.45], [0, 0.5], [0, -0.5], [-0.95, 0], [-0.5, 0.45], [-0.5, -0.45]];

/** m: a deck he may launch it from stands at most this high over the water (a pier, a landing stage, M4's wreck). */
const DECK_MAX = 1.5;

function cellOf(g, x, z) {
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? -1 : j * g.cols + i;
}
/** Inside a pier's footprint (a landing stage, M4's sunken tank): its deck, drawn or not (a world built without meshes). */
const PIERS = new WeakMap();   // world → [{x, z, c, s, hw, hd}] (its piers' rect footprints, gathered once)
function pierAt(world, x, z) {
  let L = PIERS.get(world);
  if (!L) {
    L = [];
    for (const st of world.structures?.values?.() || []) {
      if (st?.def?.type !== 'pier') continue;
      for (const f of st.footprints || []) if (f.shape === 'rect') L.push({ x: f.x, z: f.z, c: Math.cos(f.rot || 0), s: Math.sin(f.rot || 0), hw: f.w / 2, hd: f.d / 2 });
    }
    PIERS.set(world, L);
  }
  for (const f of L) {
    const px = x - f.x, pz = z - f.z;
    if (Math.abs(px * f.c + pz * f.s) <= f.hw && Math.abs(-px * f.s + pz * f.c) <= f.hd) return true;
  }
  return false;
}
/** Open water or shallows (no deck over it) at (x, z). */
function wetAt(world, x, z) {
  const g = world.grid, k = cellOf(g, x, z);
  return k >= 0 && (g.terrain[k] === T.WATER || g.terrain[k] === T.SHALLOW) && !g.bridge[k] && !pierAt(world, x, z);
}
/**
 * Ground he can stand on to launch it at (x, z): dry walkable ground at its own level, or a low deck over the water
 * (a pier, a landing stage, the M4 wreck) — not a roof, a raised crest, a bridge high over the river.
 */
function dryAt(world, x, z) {
  const g = world.grid, k = cellOf(g, x, z);
  if (k < 0 || !g.isWalkable(k % g.cols, Math.floor(k / g.cols), {})) return false;
  const wet = g.terrain[k] === T.WATER || g.terrain[k] === T.SHALLOW;
  if (g.bridge[k] || pierAt(world, x, z)) {   // a deck: low over the water only
    const top = typeof world.groundY === 'function' ? world.groundY(x, z) || 0 : 0;
    return top - (world.water?.sample?.(x, z)?.level ?? -0.1) <= DECK_MAX;
  }
  return !wet && !((g.elev?.[k] || 0) > 0.05);
}

/**
 * Where the raft goes in when he launches it standing at (x, z): the nearest point LAUNCH_MIN..LAUNCH_MAX m off whose
 * hull (bow pointing away from him, out into the water) lies in the water — `prefer` (a heading) breaks ties.
 * @returns {{x:number, z:number, heading:number}|null}
 */
export function launchSpot(world, x, z, prefer = null) {
  let best = null, bs = Infinity;
  for (let r = LAUNCH_MIN; r <= LAUNCH_MAX + 1e-6; r += 0.2) {
    for (let a = 0; a < 32; a++) {
      const h = (a / 32) * Math.PI * 2, fx = Math.cos(h), fz = Math.sin(h), px = x + fx * r, pz = z + fz * r;
      const score = r + (prefer == null ? 0 : 0.6 * (1 - Math.cos(h - prefer)));
      if (score >= bs) continue;
      // (left of the heading: (fz, -fx) with x = cos h, z = sin h; either side is checked)
      if (!HULL.every(([f, l]) => wetAt(world, px + fx * f + fz * l, pz + fz * f - fx * l))) continue;
      best = { x: px, z: pz, heading: h }; bs = score;
    }
    if (best) break;
  }
  return best;
}

/**
 * Where he stands to launch the raft: his own spot when he is on dry ground with water to launch into, else (in the
 * water, `fromWater`) the nearest dry point at the water's edge within SHORE_SEARCH m that has a launch spot.
 * @returns {{x:number, z:number, launch:{x:number, z:number, heading:number}}|null}
 */
export function launchStand(world, c, fromWater = !dryAt(world, c.x, c.z)) {
  if (!fromWater) {
    const L = launchSpot(world, c.x, c.z, c.heading);
    return L ? { x: c.x, z: c.z, launch: L } : null;
  }
  const g = world.grid, cs = g.cell, cand = [];
  const i0 = Math.floor((c.x - SHORE_SEARCH) / cs), i1 = Math.floor((c.x + SHORE_SEARCH) / cs);
  const j0 = Math.floor((c.z - SHORE_SEARCH) / cs), j1 = Math.floor((c.z + SHORE_SEARCH) / cs);
  for (let j = Math.max(0, j0); j <= Math.min(g.rows - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(g.cols - 1, i1); i++) {
      const x = (i + 0.5) * cs, z = (j + 0.5) * cs, d = Math.hypot(x - c.x, z - c.z);
      if (d > SHORE_SEARCH || !dryAt(world, x, z)) continue;
      // at the water's edge: a wet cell within a metre, and dry ground all round his feet (not on the very lip)
      if (![[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].some(([a, b]) => wetAt(world, x + a, z + b))) continue;
      if (![[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([a, b]) => dryAt(world, x + a, z + b))) continue;
      cand.push([d, x, z]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  let tries = 0;
  for (const [, x, z] of cand.slice(0, 60)) {
    const L = launchSpot(world, x, z, Math.atan2(z - c.z, x - c.x) + Math.PI);   // the raft back out the way he came
    if (!L) continue;
    // a bank he can get to (swimming, wading, walking): not a ledge above the water he cannot climb onto
    if (typeof world.findPath === 'function') {
      if (tries++ >= 8) break;
      const p = world.findPath(c.x, c.z, x, z, { swim: true, role: c.role, maxNodes: 60000 });
      const e = p?.[p.length - 1];
      if (!e || Math.hypot(e.x - x, e.z - z) > 0.5) continue;
    }
    return { x, z, launch: L };
  }
  return null;
}

/** The shallows by the bank `st` where a diver takes his gear off on his way out (gear off: shallow water only). */
function gearOffSpot(world, st) {
  let best = null, bd = Infinity;
  for (let r = 0.5; r <= 3 + 1e-6; r += 0.25) {
    for (let a = 0; a < 24; a++) {
      const h = (a / 24) * Math.PI * 2, x = st.x + Math.cos(h) * r, z = st.z + Math.sin(h) * r;
      const g = world.grid, k = cellOf(g, x, z);
      if (k < 0 || g.terrain[k] !== T.SHALLOW || g.bridge[k] || r >= bd) continue;
      best = { x, z }; bd = r;
    }
    if (best) break;
  }
  return best;
}

registerAbility({
  id: 'raft', label: 'Inflatable raft', icon: '🛶', hotkey: 't', roles: ['diver'], item: 'inflatableBoat', targeting: 'self',
  order: 51, visibleToEnemies: true, autoStand: true,
  // (a precise walk-up: he must be standing on the bank, not a metre short of it in the shallows)
  range: 0.3,
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (!world.vehicleFactory) return "Can't deploy here.";
    if (!world.grid) return true;
    const fromWater = !dryAt(world, c.x, c.z);
    // on his way to the bank (the walk-up re-checks here): fine while the bank he makes for is still there
    const st = c.pendingAbility?.def?.id === 'raft' && c.pendingAbility.selfTp?.launch ? c.pendingAbility.selfTp : launchStand(world, c, fromWater);
    if (!st) return fromWater ? 'No bank to launch it from.' : "Only at the water's edge.";
    if (c.diving && !gearOffSpot(world, st)) return 'Take the gear off first.';
    return true;
  },
  // the bank he launches it from (or, with the gear on, the shallows by it where he takes the gear off)
  selfApproach(c, world) {
    if (!world.grid) return null;
    const st = launchStand(world, c);
    if (!st) return null;
    if (c.diving) { const g = gearOffSpot(world, st); return g ? { ...g, launch: st.launch, stand: st } : null; }
    return st;
  },
  start(c, t, world) {
    if (c.diving) {
      // in the shallows by the bank: the gear off (as the dive ability), then on out of the water and launch it
      c.playAction('use', A.dive);
      const task = timedTask({ dur: A.dive, steps: [{ at: A.dive, fn: () => {
        c.diving = false; c.underwater = false; c.witnesses = null; c.stance = 'stand';
        world.events.emit('unit:stance', { unit: c, stance: 'stand' });
        world.events.emit('unit:water', { unit: c, what: 'surface' });
        return true;
      } }] });
      task.after = () => { if (!c.diving && c.alive) c.useAbility('raft', c); };
      return task;
    }
    const st = world.grid ? launchStand(world, c, !dryAt(world, c.x, c.z)) : null;
    if (world.grid && (!st || Math.hypot(st.x - c.x, st.z - c.z) > 0.5)) return null;   // (not on the bank: canUse refused)
    const L = st?.launch || { x: c.x, z: c.z, heading: c.heading };
    c.faceTowards?.(L.x, L.z);
    // user 2026-10-14 "when the raft is inflated it should be very clear it gets inflated" (abilities/raft-actions.js):
    // the pack spread out over the water, the CO2 cord, the chambers filling (drawn by art/raft-actions.js)
    const T = raftTimes('deploy');
    const rec = pushRaftAct(world, { kind: 'inflate', a: c, L: { x: L.x, z: L.z, heading: L.heading }, from: { x: c.x, z: c.z, h: Math.atan2(L.z - c.z, L.x - c.x) },
      T, t0: world.time + CONFIG.sim.dt });
    c.playAction('use', T.dur);
    return timedTask({
      dur: T.dur, phases: T.phases, present: true,
      onCancel: () => { rec.cancelled = world.time; },
      onEnd: (r) => { rec.ended = world.time; rec.result = r; },
      steps: [
        { at: RAFT.deploy.pull, fn: () => { // the CO2 cord: the hiss as the gas goes in
          world.events.emit('raft:hiss', { unit: c, x: L.x, z: L.z, kind: 'inflate', dur: RAFT.deploy.full - RAFT.deploy.pull });
          return true;
        } },
        { at: T.dur, fn: () => {
          if (!c.has('inflatableBoat')) return false;
          c.loseItem('inflatableBoat');
          // the hull drawn inflating (if any: visual only) becomes the raft's model — no swap, no pop
          const model = typeof rec.handoff === 'function' ? rec.handoff() : null;
          const raft = world.spawnVehicle('raft', { x: L.x, z: L.z, heading: L.heading, ...(model ? { model } : null) });
          rec.raft = raft;
          raft.deployedBy = c;
          raft.used = true; // §3.4: an unattended raft that has been used is suspicious to enemies
          raft.enter(c);   // he steps in from the bank (boardFrom: art/boat-crew.js)
          world.events.emit('unit:water', { unit: c, what: 'row' });
          return true;
        } },
      ],
    });
  },
});
