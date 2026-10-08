/**
 * Sapper: Inferno (design-spec §3.3, §3.4) — owned by ABILITIES.
 *   trap       J  bear trap on a walkable cell within 1.5 m (1.0 s); silent kill of the first enemy within 0.5 m
 *   timeBomb   B  at his feet (1.0 s); explodes 10.0 s after release (class `bomb`)
 *   remoteBomb B  at his feet (1.0 s); the knapsack gains the detonator
 *   detonate   A  the OLDEST planted remote bomb goes off after 0.2 s
 *   grenade    E  arc throw to a point within 13.5 m, over walls; flight 1.0 s; class `grenade`, friendly fire on
 *   cutters    W  3.0 s: a round hole (~0.96 × 0.86 m) low in the wire, crawl only (grid crawlway; the rest of the
 *                 fence stands); `reinforced` wire is immune; a powered `electric` fence shocks him at the first
 *                 snip (20 damage) and the cut fails
 * Missions never give both time and remote bombs (items.js normalizeSapperInventory).
 * @module abilities/sapper
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { B } from '../world/grid.js';
import { timedTask, freeToAct, inReach } from './common.js';
import { pathLength } from '../world/pathfinding.js';
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

/** Sign of a horizontal normal, the same whichever code computes it: by x, else by z (grid crawlway side 1 / 2). */
export const normalSign = (nx, nz) => (nx > 1e-3 ? 1 : nx < -1e-3 ? -1 : nz >= 0 ? 1 : -1);

/**
 * Where the cutters go in: the wire's line through the fence cells within 1.5 m of `cell` (principal axis), the
 * clicked point projected on it (the hole's centre), and the normal pointing to `from` (his side).
 * @returns {{x, z, tx, tz, nx, nz}}
 */
export function holeSite(world, cell, click, from) {
  const near = fenceCells(world.grid, cell.x, cell.z, 1.5);
  let cx = 0, cz = 0;
  for (const f of near) { cx += f.x; cz += f.z; }
  cx /= near.length || 1; cz /= near.length || 1;
  let sxx = 0, sxz = 0, szz = 0;
  for (const f of near) { const dx = f.x - cx, dz = f.z - cz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
  let tx, tz;
  if (near.length >= 3 && sxx + szz > 1e-6) {
    const a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    tx = Math.cos(a); tz = Math.sin(a);
  } else { // a lone cell: across his line to it
    const dx = cell.x - from.x, dz = cell.z - from.z, d = Math.hypot(dx, dz) || 1;
    tx = -dz / d; tz = dx / d;
  }
  const p = click || cell, u = (p.x - cx) * tx + (p.z - cz) * tz;
  const x = cx + tx * u, z = cz + tz * u;
  let nx = -tz, nz = tx;
  if ((from.x - x) * nx + (from.z - z) * nz < 0) { nx = -nx; nz = -nz; }
  return { x, z, tx, tz, nx, nz };
}

/**
 * Open the hole in the nav grid: the fence cells round the site become crawlway (crawlers only), widening a little
 * (0.5 → 1.0 m) until a man on his belly gets from one side to the other. Side 1 / 2 = which way the flap was peeled
 * (normalSign of the normal away from him: he pushes it through; art/wire-obstacles.js). @returns {number[]} the cells opened
 */
export function cutHoleCells(world, site) {
  const g = world.grid, side = normalSign(-site.nx, -site.nz) > 0 ? 1 : 2, opened = [];   // (peeled away from him)
  for (let r = 0.5; r <= 1.0 + 1e-9; r += 0.1) {
    for (const f of fenceCells(g, site.x, site.z, r)) { g.setCrawlway(f.k, side); opened.push(f.k); }
    g.version++;
    const a = { x: site.x + site.nx * 1.1, z: site.z + site.nz * 1.1 }, b = { x: site.x - site.nx * 1.1, z: site.z - site.nz * 1.1 };
    const p = world.findPath(a.x, a.z, b.x, b.z, { crawl: true, maxNodes: 4000, nearRadius: 0.8 });
    if (p && pathLength(p) < 4 && opened.length) break;
  }
  return opened;
}

/** The cut seen by the visuals (art/wire-cut.js): plain data, the sim never reads it back. */
function cutState(c, world, phase, site, extra = {}) {
  c.cutWire = { phase, t0: world.time ?? 0, dur: A.cutters, x: site.x, z: site.z, nx: site.nx, nz: site.nz, tx: site.tx, tz: site.tz,
    prone: c.stance === 'crawl', ...extra };
  return c.cutWire;
}

registerAbility({
  id: 'cutters', label: 'Wire cutters', icon: '✂', hotkey: 'w', roles: ['sapper'], item: 'wireCutters', targeting: 'point', cursor: 'cutters',
  order: 35, visibleToEnemies: true,
  // walks (crawls) up to the wire on his own side, where he kneels to it (CONFIG cutHole.standoff), never round to the
  // far side
  approachPoint(c, t, world) {
    const f = t && fenceAt(world, t);
    if (!f) return t;
    const s = holeSite(world, f, t, c);
    for (let o = A.cutHole.standoff; o <= 2; o += 0.25) {
      const p = { x: s.x + s.nx * o, z: s.z + s.nz * o };
      if (world.grid.walkableAt(p.x, p.z, { crawl: true })) return p;
    }
    return { x: f.x, z: f.z };
  },
  range: 0.45,
  hipsReach: true,   // a crawler too comes up with his hips to the spot (no 0.8 m hand reach, Commando._updatePending)
  canUse(c, t, world) {
    const f = onFoot(c);
    if (f !== true) return f;
    const cell = t && fenceAt(world, t);
    if (!cell) return 'Pick a wire fence.';
    const s = structureAtCell(world, cell.k);
    if (s?.def?.reinforced) return 'Reinforced wire: the cutters are useless.';
    return true;
  },
  // He settles at the wire (kneeling, or lying if he crawled up), snips the strands one by one — the first snip
  // finds out whether it is live — and peels the cut flap back: the hole opens then, a round hole low in the wire
  // that only a man on his belly gets through (grid crawlway). The rest of the fence stands.
  start(c, t, world) {
    const dur = A.cutters, H = A.cutHole;
    const cell = fenceAt(world, t);
    const site = holeSite(world, cell, t, c);
    const prone = c.stance === 'crawl';
    const off = H.standoff;
    const from = { x: c.x, z: c.z, h: c.heading };
    // (the nearest walkable spot square to the hole: the wire's grid cells can be a cell thick each side of it; the
    // kneeling body is drawn the last bit in, art/wire-cut.js)
    let to = { x: c.x, z: c.z };
    for (let o = off; o <= off + 0.8; o += 0.05) {
      const p = { x: site.x + site.nx * o, z: site.z + site.nz * o };
      if (world.grid.walkableAt(p.x, p.z) && Math.hypot(p.x - c.x, p.z - c.z) <= 1.2) { to = p; break; }
    }
    const face = Math.atan2(-site.nz, -site.nx);
    cutState(c, world, 'cut', site, { prone });
    c.playAction('use', dur);
    let shocked = false;
    const snip = (i) => () => {
      world.events.emit('device', { id: 'cutters', sfx: 'cutters_snip', x: site.x, z: site.z, on: true });
      if (i > 0) return true;
      const s = structureAtCell(world, cell.k);
      const fenceId = s?.id;
      const live = (s?.def?.electric || s?.def?.variant === 'electric') && (world.fencePower?.get(fenceId) ?? s.def.powered !== false);
      if (!live) return true;
      shocked = true;
      c.takeDamage(A.electricDmg, null, 'electric');
      world.events.emit('device', { id: fenceId, sfx: 'electric_zap', x: cell.x, z: cell.z, on: true });
      world.events.emit('bark', { unit: c, line: 'hurt' });
      return false;
    };
    return timedTask({
      dur,
      // settling in (0.35 s): a short shuffle to the wire, square to it
      tick: (dt, tt) => {
        const k = Math.min(1, tt / 0.35), e = k * k * (3 - 2 * k);
        if (tt <= 0.4 && (from.x !== to.x || from.z !== to.z)) { c.x = from.x + (to.x - from.x) * e; c.z = from.z + (to.z - from.z) * e; }
        if (tt <= 0.4) { const dh = Math.atan2(Math.sin(face - from.h), Math.cos(face - from.h)); c.heading = from.h + dh * e; }
      },
      onCancel: () => { if (c.cutWire?.phase === 'cut') cutState(c, world, 'abort', c.cutWire); },
      onEnd: (r) => { if (r === 'failed' && c.cutWire?.phase === 'cut') cutState(c, world, shocked ? 'shock' : 'abort', c.cutWire); },
      steps: [
        ...H.snips.map((at, i) => ({ at, fn: snip(i) })),
        { at: H.peel, fn: () => {
          const s = structureAtCell(world, cell.k);
          cutHoleCells(world, site);
          world.events.emit('structure:destroyed', { id: s?.id ?? 'fence', type: 'fence-gap', hole: true, owner: world.grid.owner[cell.k], x: site.x, z: site.z });
          return true;
        } },
        { at: dur, fn: () => { cutState(c, world, 'done', c.cutWire); return true; } },
      ],
    });
  },
});
