/**
 * Sapper: Inferno (design-spec §3.3, §3.4) — owned by ABILITIES.
 *   trap       J  bear trap on a walkable cell within 1.5 m (1.0 s); silent kill of the first enemy within 0.5 m
 *   timeBomb   B  at his feet (1.0 s); explodes 10.0 s after release (class `bomb`)
 *   remoteBomb B  at his feet (1.0 s); the knapsack gains the detonator
 *   detonate   A  the OLDEST planted remote bomb goes off after 0.2 s
 *   grenade    E  arc throw to a point within 13.5 m, over walls; flight 1.0 s; class `grenade`, friendly fire on
 *   cutters    W  3.0 s: a 1.5 m gap in `fence` cells; `reinforced` wire is immune; a powered `electric` fence
 *                 shocks him (20 damage) and the cut fails
 * Missions never give both time and remote bombs (items.js normalizeSapperInventory).
 * @module abilities/sapper
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { B } from '../world/grid.js';
import { timedTask, freeToAct, inReach } from './common.js';
import { Bomb, Trap, Grenade } from './charges.js';

const A = CONFIG.abilities;
const W = CONFIG.weapons;

function onFoot(c) {
  const f = freeToAct(c);
  if (f !== true) return f;
  if (c.stance === 'swim' || c.stance === 'dive') return 'Not in the water.';
  return true;
}

registerAbility({
  id: 'trap', label: 'Trap', icon: '⊓', hotkey: 'j', roles: ['sapper'], item: 'bearTrap', targeting: 'point', cursor: 'trap',
  order: 30, visibleToEnemies: true, range: A.trap.range, ranged: true,
  canUse(c, t, world) {
    const f = onFoot(c);
    if (f !== true) return f;
    if (!t || !world.grid.walkableAt(t.x, t.z) || world.groundAt(t.x, t.z).water || world.groundAt(t.x, t.z).shallow) return 'Not there.';
    return inReach(world, c, t, A.trap.range);
  },
  start(c, t, world) {
    c.playAction('plant', A.trap.set);
    return timedTask({ dur: A.trap.set, steps: [{ at: A.trap.set, fn: () => {
      if (!c.consume('bearTrap')) return false;
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      const p = d <= A.trap.range ? t : { x: c.x + ((t.x - c.x) / d) * A.trap.range, z: c.z + ((t.z - c.z) / d) * A.trap.range };
      world.add(new Trap({ x: p.x, z: p.z, owner: c }));
      return true;
    } }] });
  },
});

let bombSeq = 0;

function plantBomb(kind) {
  const item = kind === 'time' ? 'timeBomb' : 'remoteBomb';
  return function start(c, t, world) {
    const plant = (kind === 'time' ? W.timeBomb : W.remoteBomb).plant;
    c.playAction('plant', plant);
    return timedTask({ dur: plant, steps: [{ at: plant, fn: () => {
      if (!c.consume(item)) return false;
      // per-mission time-bomb fuse (M4's retail file: 7.5 s); default CONFIG.weapons.timeBomb.fuse
      const mf = world.mission?.timeBombFuse;
      const bomb = world.add(new Bomb({ x: c.x + Math.cos(c.heading) * 0.4, z: c.z + Math.sin(c.heading) * 0.4, y: c.y || 0, bombKind: kind, owner: c, seq: ++bombSeq,
        ...(kind === 'time' && Number.isFinite(mf) ? { fuse: mf } : {}) }));
      world.events.emit('bomb:armed', { bomb, kind, fuse: Number.isFinite(bomb.fuse) ? bomb.fuse : null, unit: c });
      return true;
    } }] });
  };
}

registerAbility({
  id: 'timeBomb', label: 'Time bomb', icon: '⏲', hotkey: 'b', roles: ['sapper'], item: 'timeBomb', targeting: 'self',
  order: 31, visibleToEnemies: true, noiseRadius: W.timeBomb.noise, noiseKind: 'explosion',
  canUse: (c) => onFoot(c),
  start: plantBomb('time'),
});

registerAbility({
  id: 'remoteBomb', label: 'Remote bomb', icon: '📡', hotkey: 'b', roles: ['sapper'], item: 'remoteBomb', targeting: 'self',
  order: 32, visibleToEnemies: true,
  canUse: (c) => onFoot(c),
  start: plantBomb('remote'),
});

/** Remote bombs planted by `c` still waiting, oldest first. */
export function plantedRemotes(world, c) {
  return world.interactables.filter((b) => b.interactKind === 'bomb' && b.bombKind === 'remote' && !b.exploded && !b.removed && b.planter === c && b.fuse === Infinity)
    .sort((a, b) => a.seq - b.seq);
}

registerAbility({
  id: 'detonate', label: 'Detonator', icon: '⚡', hotkey: 'a', roles: ['sapper'], item: 'detonator', targeting: 'none',
  order: 33, visibleToEnemies: false, noiseRadius: W.remoteBomb.noise, noiseKind: 'explosion',
  canUse: (c, t, world) => (plantedRemotes(world, c).length ? true : 'No bombs planted.'),
  start(c, t, world) {
    const [bomb] = plantedRemotes(world, c);
    if (!bomb) return null;
    bomb.detonate(A.remoteDelay);
    world.events.emit('bomb:detonate', { unit: c });
    return null; // instant (the charge keeps its own 0.2 s radio delay)
  },
});

registerAbility({
  id: 'grenade', label: 'Grenade', icon: '💣', hotkey: 'e', roles: ['sapper'], item: 'grenade', targeting: 'point', cursor: 'grenade',
  order: 34, visibleToEnemies: true, noiseRadius: W.grenade.noise, noiseKind: 'explosion', range: W.grenade.range, ranged: true,
  canUse(c, t, world) {
    const f = onFoot(c);
    if (f !== true) return f;
    if (!t) return 'Pick a spot.';
    return inReach(world, c, t, W.grenade.range); // lobbed over walls: range only, no LOS
  },
  start(c, t, world) {
    const T = W.grenade.throwTime;
    c.playAction('throw', T);
    return timedTask({ dur: T, steps: [{ at: T, fn: () => {
      if (!c.consume('grenade')) return false;
      world.add(new Grenade({ from: { x: c.x, z: c.z }, to: { x: t.x, z: t.z }, thrower: c }));
      return true;
    } }] });
  },
});

/** Fence cells (B.FENCE) within `r` of (x, z): [{k, i, j}]. */
function fenceCells(grid, x, z, r) {
  const out = [];
  const c0 = grid.worldToCell(x - r, z - r), c1 = grid.worldToCell(x + r, z + r);
  for (let j = c0.j; j <= c1.j; j++) for (let i = c0.i; i <= c1.i; i++) {
    if (!grid.inBounds(i, j)) continue;
    const k = grid.idx(i, j);
    if (grid.block[k] !== B.FENCE) continue;
    const p = grid.cellCenter(i, j);
    if (Math.hypot(p.x - x, p.z - z) <= r) out.push({ k, i, j, x: p.x, z: p.z });
  }
  return out;
}

/** The mission structure (def) owning grid cell k, via world.structures (map-builder). */
export function structureAtCell(world, k) {
  const owner = world.grid.owner[k];
  if (!owner || !world.structures) return null;
  for (const [id, s] of world.structures) if (s.owner === owner) return { id, ...s };
  return null;
}

/** The fence cell nearest the clicked point (within 0.9 m). */
function fenceAt(world, t) {
  const cells = fenceCells(world.grid, t.x, t.z, 0.9);
  cells.sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z));
  return cells[0] || null;
}

registerAbility({
  id: 'cutters', label: 'Wire cutters', icon: '✂', hotkey: 'w', roles: ['sapper'], item: 'wireCutters', targeting: 'point', cursor: 'cutters',
  order: 35, visibleToEnemies: true,
  // walks towards the fence cell and stops on his own side within reach (1.0 m + half a cell)
  approachPoint(c, t, world) {
    const f = t && fenceAt(world, t);
    return f ? { x: f.x, z: f.z } : t;
  },
  range: 1.3,
  canUse(c, t, world) {
    const f = onFoot(c);
    if (f !== true) return f;
    const cell = t && fenceAt(world, t);
    if (!cell) return 'Pick a wire fence.';
    const s = structureAtCell(world, cell.k);
    if (s?.def?.reinforced) return 'Reinforced wire: the cutters are useless.';
    return true;
  },
  start(c, t, world) {
    const dur = A.cutters;
    const cell = fenceAt(world, t);
    c.playAction('use', dur);
    return timedTask({ dur, steps: [{ at: dur, fn: () => {
      const s = structureAtCell(world, cell.k);
      const fenceId = s?.id;
      const live = (s?.def?.electric || s?.def?.variant === 'electric') && (world.fencePower?.get(fenceId) ?? s.def.powered !== false);
      if (live) {
        c.takeDamage(A.electricDmg, null, 'electric');
        world.events.emit('device', { id: fenceId, sfx: 'electric_zap', x: cell.x, z: cell.z, on: true });
        world.events.emit('bark', { unit: c, line: 'hurt' });
        return false;
      }
      for (const f of fenceCells(world.grid, cell.x, cell.z, A.cutGap / 2 + 0.01)) world.grid.block[f.k] = B.NONE;
      world.grid.version++;
      world.events.emit('structure:destroyed', { id: fenceId ?? 'fence', type: 'fence-gap', owner: world.grid.owner[cell.k], x: cell.x, z: cell.z });
      return true;
    } }] });
  },
});
