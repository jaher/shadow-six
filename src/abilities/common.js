/**
 * Shared helpers for ability definitions (owned by ABILITIES): timed ActionTasks, role checks,
 * target resolution from a clicked point, ability events.
 * @module abilities/common
 */

import { CONFIG } from '../config.js';

/**
 * A timed ActionTask: runs `steps` (sorted by `at`, seconds from start) once each, then 'done' at `dur`.
 * A step returning false aborts with 'failed'.
 * @param {object} o
 * @param {number} o.dur total seconds
 * @param {{at:number, fn:() => (boolean|void)}[]} [o.steps]
 * @param {(dt:number, t:number) => (string|void)} [o.tick] per-step hook; may return 'failed'/'done'
 * @param {() => void} [o.onCancel]
 * @param {() => void} [o.onEnd] after done/failed (not after cancel)
 * @param {boolean} [o.interruptible=true]
 * @param {number} [o.t0=0] elapsed time to start from (save/load resume: steps already past are not re-run)
 * @param {() => object} [o.save] extra data a save keeps to resume this task (`def.resume`)
 */
export function timedTask({ dur, steps = [], tick = null, onCancel = null, onEnd = null, interruptible = true, t0 = 0, save = null }) {
  let t = t0;
  const list = [...steps].sort((a, b) => a.at - b.at);
  let k = 0;
  while (t0 > 0 && k < list.length && list[k].at <= t0 + 1e-9) k++; // already run before the save
  let finished = false;
  const end = (r) => {
    if (!finished) { finished = true; onEnd?.(r); }
    return r;
  };
  return {
    interruptible,
    get t() { return t; },
    saveData: save,
    update(dt) {
      if (finished) return 'done';
      t += dt;
      while (k < list.length && t >= list[k].at - 1e-9) {
        const r = list[k++].fn();
        if (r === false) return end('failed');
      }
      const tr = tick?.(dt, t);
      if (tr === 'failed' || tr === 'done') return end(tr);
      return t >= dur - 1e-9 && k >= list.length ? end('done') : 'running';
    },
    cancel() {
      if (!finished) { finished = true; onCancel?.(); }
    },
  };
}

/** An instantaneous task: runs fn once and finishes (fn false → failed). */
export function instantTask(fn) {
  return timedTask({ dur: 0, steps: [{ at: 0, fn }] });
}

/** Distance between two points/entities. */
export function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Emit a message from a commando. */
export function say(world, unit, text, kind = 'warn') {
  world?.events.emit('message', { text: `${unit?.nickname || 'Commando'}: ${text}`, kind, unit });
}

/** Emit a bark (voice cue key, §9.4). */
export function bark(world, unit, line) {
  world?.events.emit('bark', { unit, line });
}

/** Emit ability:start. */
export function abilityStart(world, unit, id, target) {
  world?.events.emit('ability:start', { unit, id, target: target ?? null });
}

/** Emit ability:end. */
export function abilityEnd(world, unit, id, result) {
  world?.events.emit('ability:end', { unit, id, result });
}

/** Living enemy (on foot, not in a vehicle) nearest to (x, z) within r, or null. */
export function enemyNear(world, x, z, r = 1.0, filter = null) {
  let best = null, bd = Infinity;
  for (const e of world.enemies) {
    if (!e.alive || e.state === 'inVehicle') continue;
    if (filter && !filter(e)) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d <= r && d < bd) { best = e; bd = d; }
  }
  return best;
}

/** Body (dead unit, not carried/hidden) nearest to (x, z) within r. */
export function bodyNear(world, x, z, r = 1.2) {
  let best = null, bd = Infinity;
  for (const u of [...world.enemies, ...world.commandos]) {
    if (u.alive || u.removed || u.state === 'carried' || u.hiddenUnderBarrel) continue;
    const d = Math.hypot(u.x - x, u.z - z);
    if (d <= r && d < bd) { best = u; bd = d; }
  }
  return best;
}

/** Interactable nearest to (x, z) within r matching filter. */
export function interactableNear(world, x, z, r = 1.2, filter = null) {
  let best = null, bd = Infinity;
  for (const it of world.interactables) {
    if (it.removed || it.carriedBy) continue;
    if (filter && !filter(it)) continue;
    const d = Math.hypot(it.x - x, it.z - z);
    if (d <= r && d < bd) { best = it; bd = d; }
  }
  return best;
}

/** True when the unit stands on shallow water (not on a bridge). */
export function inShallow(world, u) {
  const g = world.groundAt(u.x, u.z);
  return g.shallow && !g.bridge;
}

/** True when the unit stands in deep water. */
export function inDeep(world, u) {
  const g = world.groundAt(u.x, u.z);
  return g.water && !g.bridge;
}

/**
 * grid.lineOfSight options for a shot from `c` at `to`: heights, plus — when `to` is a vehicle — its own
 * hull as `targetHull`, so an occluding vehicle (truck, tanker) does not hide its own centre.
 */
export function shotLosOpts(c, to, world = null, rifle = false) {
  const o = { viewerY: c.y || 0, targetY: to.y || 0 };
  const sz = to.kind === 'vehicle' && to.def?.size;
  if (sz) o.targetHull = { x: to.x, z: to.z, w: sz[0], d: sz[1], heading: to.heading || 0 };
  // `shotThrough` planks (M19's palisade) hide what is behind them from the guards, but a sniper's rifle round
  // goes through them, and so does any bullet at an explosive barrel or tanker (M19: the Sniper shoots the caged
  // dog and the barrels by the rockets through the fence [P][ooc][fd])
  if (world && (rifle || to.interactKind === 'barrel' || (to.kind === 'vehicle' && to.def?.tanker))) {
    const pass = shotThroughOwners(world);
    if (pass.size) o.passOwners = pass;
  }
  return o;
}

/** Grid owner ids of the structures flagged `shotThrough` (cached per world, rebuilt when the map changes). */
export function shotThroughOwners(world) {
  const S = world?.structures;
  if (!S?.values) return new Set();
  if (world._shotThrough?.src === S && world._shotThrough.n === S.size) return world._shotThrough.set;
  const set = new Set();
  for (const s of S.values()) if (s?.def?.shotThrough && s.owner) set.add(s.owner);
  world._shotThrough = { src: S, n: S.size, set };
  return set;
}

/** Common "can act" gate: alive, not hidden/buried/in vehicle/carried. */
/**
 * §3.3 out-of-range feedback for ranged abilities (they never auto-walk): true when `to` is within
 * `range` metres of c (and in line of sight when `los`), else the reason — so the targeting cursor
 * shows the forbidden overlay and issue() refuses the order.
 * @returns {true|string}
 */
export function inReach(world, c, to, range, los = false, rifle = false) {
  if (!to) return 'Pick a target.';
  if (Math.hypot(to.x - c.x, to.z - c.z) > range) return 'Out of range.';
  if (los && !world.grid.lineOfSight(c.x, c.z, to.x, to.z, shotLosOpts(c, to, world, rifle))) return 'No line of sight.';
  return true;
}

export function freeToAct(c) {
  if (!c.alive) return 'Dead.';
  if (c.downed) return "He's down."; // bodies-design §C.6
  if (c.state === 'hidden' || c.hidden) return 'Leave the building first.';
  if (c.state === 'inVehicle') return 'Get out first.';
  if (c.buried) return 'Rise first.';
  if (c.state === 'jailed' || c.state === 'captured') return 'Captured.';
  return true;
}

/** Straight line from `c` to (x, z) over walkable cells at his level (≥ 0.3 m from him). */
export function clearFrom(w, c, x, z) {
  if (Math.hypot(x - c.x, z - c.z) < 0.3) return false;
  return w.grid.walkableLine(c.x, c.z, x, z, { elevRef: w.grid.elevAt(c.x, c.z) });
}

/**
 * Where `c` would put his load `it` down (`how` 'gentle' | 'shot' | 'died'): a dragged man where he lies, else ahead
 * of him (along the hit direction when knocked off). Deterministic; used by dropCarried and the put-down visuals.
 */
export function dropSpot(c, how = 'gentle', it = c.carrying, mode = c.carryMode || null) {
  const w = c.world;
  let p;
  if (mode === 'drag' && it.kind !== 'interactable' && (!w || clearFrom(w, c, it.x, it.z))) p = { x: it.x, z: it.z }; // §C.2: he lies where he was dragged
  else {
    // shouldered: at his feet ahead of him; knocked off by a hit (§C.4): along the hit direction, a little further
    const k = how === 'shot' && c._hitDir ? 0.9 : 0.6;
    // a live man (downed buddy) rolls off the right shoulder and lands beside him on his front (the model's fall)
    const a = how === 'shot' && it.alive && it.kind !== 'interactable' && mode !== 'drag' ? c.heading + Math.PI / 2
      : how === 'shot' && c._hitDir ? Math.atan2(c._hitDir.z, c._hitDir.x) : c.heading;
    // a barrel stands at his feet ahead (as before); a man at the first clear bearing round him (never across a wall / fence, off a raised edge, or on top of him)
    for (const da of it.kind === 'interactable' ? [] : [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      if (p) break;
      const x = c.x + Math.cos(a + da) * k, z = c.z + Math.sin(a + da) * k;
      if (!w || clearFrom(w, c, x, z)) p = { x, z };
    }
    if (!p && w && it.kind !== 'interactable' && mode === 'drag') p = { x: it.x, z: it.z };
    if (!p) p = w?.grid.walkableAt(c.x + Math.cos(a) * k, c.z + Math.sin(a) * k) ? { x: c.x + Math.cos(a) * k, z: c.z + Math.sin(a) * k } : { x: c.x, z: c.z };
  }
  return p;
}

/**
 * Put down whatever `c` carries at his feet (bodies lie down, barrels stand upright). No animation — the
 * `drop` ability wraps this in its 0.8 s task.
 */
export function dropCarried(c, how = 'gentle') {
  const it = c.carrying;
  if (!it) return null;
  const mode = c.carryMode || null;
  c.carrying = null;
  c.carryMode = null;
  c.carryTransition = null;
  const w = c.world;
  const p = dropSpot(c, how, it, mode);
  it.carriedBy = null;
  it.x = p.x; it.z = p.z; it.y = c.y || 0;
  // a man put down off a shoulder lies stretched away from the carrier (visual: the model / settle ragdoll use it)
  if (it.kind !== 'interactable' && mode !== 'drag' && how === 'gentle' && c.world?.house) it.heading = c.heading + Math.PI;
  // a live man knocked off the shoulder lies on his front as he hung: head towards the carrier's back
  else if (it.kind !== 'interactable' && it.alive && mode !== 'drag' && how === 'shot') it.heading = c.heading + Math.PI;
  if (it.kind !== 'interactable') {
    // BCD: a knocked-out man stays down (bcd-plan §1.2); a downed buddy is downed again (bodies-design §C.6)
    it.state = it.alive ? (it.downed ? 'downed' : it._bcdState || 'active') : 'dead';
    it._preCarryState = null;
    it._anim = null;
    it._setAnim?.(it.alive && it.downed ? 'downed_idle' : 'dead');
    // how he left the transport (the physics drop of a body; the fall a downed buddy's model plays)
    const dir = how === 'shot' && c._hitDir ? { x: c._hitDir.x, z: c._hitDir.z } : null;
    it.carryDrop = { how, mode, t: w?.time ?? 0, fromH: mode === 'shoulder' || mode == null ? CONFIG.bodies.dropFallH : 0.3, dir, ch: c.heading };
    w?.events.emit('load:dropped', { carrier: c, load: it, how, mode });
  }
  return it;
}

/** Abilities config shortcut. */
export const A = CONFIG.abilities;
export const W = CONFIG.weapons;
