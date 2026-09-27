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
 */
export function timedTask({ dur, steps = [], tick = null, onCancel = null, onEnd = null, interruptible = true }) {
  let t = 0;
  let k = 0;
  const list = [...steps].sort((a, b) => a.at - b.at);
  let finished = false;
  const end = (r) => {
    if (!finished) { finished = true; onEnd?.(r); }
    return r;
  };
  return {
    interruptible,
    get t() { return t; },
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

/** Common "can act" gate: alive, not hidden/buried/in vehicle/carried. */
/**
 * §3.3 out-of-range feedback for ranged abilities (they never auto-walk): true when `to` is within
 * `range` metres of c (and in line of sight when `los`), else the reason — so the targeting cursor
 * shows the forbidden overlay and issue() refuses the order.
 * @returns {true|string}
 */
export function inReach(world, c, to, range, los = false) {
  if (!to) return 'Pick a target.';
  if (Math.hypot(to.x - c.x, to.z - c.z) > range) return 'Out of range.';
  if (los && !world.grid.lineOfSight(c.x, c.z, to.x, to.z, { viewerY: c.y || 0, targetY: to.y || 0 })) return 'No line of sight.';
  return true;
}

export function freeToAct(c) {
  if (!c.alive) return 'Dead.';
  if (c.state === 'hidden' || c.hidden) return 'Leave the building first.';
  if (c.state === 'inVehicle') return 'Get out first.';
  if (c.buried) return 'Rise first.';
  if (c.state === 'jailed' || c.state === 'captured') return 'Captured.';
  return true;
}

/**
 * Put down whatever `c` carries at his feet (bodies lie down, barrels stand upright). No animation — the
 * `drop` ability wraps this in its 0.8 s task.
 */
export function dropCarried(c) {
  const it = c.carrying;
  if (!it) return null;
  c.carrying = null;
  const fx = c.x + Math.cos(c.heading) * 0.6, fz = c.z + Math.sin(c.heading) * 0.6;
  const p = c.world?.grid.walkableAt(fx, fz) ? { x: fx, z: fz } : { x: c.x, z: c.z };
  it.carriedBy = null;
  it.x = p.x; it.z = p.z; it.y = c.y || 0;
  if (it.kind !== 'interactable') {
    it.state = it.alive ? it._bcdState || 'active' : 'dead'; // BCD: a knocked-out man stays down (bcd-plan §1.2)
    it._anim = null;
    it._setAnim?.('dead');
  }
  return it;
}

/** Abilities config shortcut. */
export const A = CONFIG.abilities;
export const W = CONFIG.weapons;
