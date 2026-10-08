/**
 * Page-side helpers for the body-vs-vehicle browser tests (prone-vehicle, vehicle-block; imported inside
 * page.evaluate as '/tests/vehicle-clear-page.mjs').
 */
import * as BC from '/src/world/body-clearance.js';

export { BC };

/** Stop a soldier's brain (test staging: he only does what he is ordered). */
export function freeze(e) { if (e.brain) { e.brain.update = () => {}; e.brain.frozen = true; } return e; }

/**
 * Load `mission`, freeze the enemies, make the commandos unkillable (staging only) and find `n` open spots (every
 * cell within `R` m walkable, ≥ `gap` m apart, no unit or vehicle within R).
 */
export async function setup(mission = 'm01', { n = 3, R = 8, gap = 18 } = {}) {
  const g = window.__game, G = g.game;
  // the map's model libraries stamp the static body solids (crates, barrels, rocks…) when they load: wait for them
  await g.loadMission(mission); g.start(); await G.mapHandle?.ready; await g.clipAudit();
  const w = G.world, grid = w.grid, cs = grid.cell || 0.5;
  for (const e of w.enemies) freeze(e);
  for (const c of w.commandos) { c.takeDamage = () => 0; c.die = () => false; }
  const free = (x0, z0) => {
    for (let x = x0 - R; x <= x0 + R; x += 0.5) for (let z = z0 - R; z <= z0 + R; z += 0.5) if (!grid.walkableAt(x, z)) return false;
    return true;
  };
  const spots = [];
  for (let x = 14; x < grid.cols * cs - 14 && spots.length < n; x += 2) {
    for (let z = 14; z < grid.rows * cs - 14 && spots.length < n; z += 2) {
      if (!free(x, z) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < gap)) continue;
      if (w.entities.some((e) => e.alive !== false && Math.hypot(e.x - x, e.z - z) < R + 1.5)) continue;
      spots.push({ x, z });
    }
  }
  const tick = (k) => { for (let i = 0; i < k; i++) g.step(); };
  const tagOf = (u) => String(u.tag ?? u.id);
  /** Deepest posed-mesh overlap (m) of unit `u` with any vehicle hull now (clip audit, mesh vs mesh). */
  const mesh = (u) => Math.max(0, ...g.clip.vehicleBodies({ minDepth: 0 }).filter((f) => f.unit === tagOf(u)).map((f) => f.depth));
  return { g, G, w, spots, tick, mesh };
}

/**
 * Order unit `u` (in `stance`) from `dist` m out at `T` (or straight across it, `through`) from each angle in `ks`
 * (k × 45°, the first walkable start on that line): per run the smallest body gap on the way (body-clearance) and
 * the deepest posed-mesh overlap of `u` with anything static (clip audit `entity`, sampled every 5 steps and at the
 * stop), with what it hit. Each run gets the time its path takes (`steps` at least: a start whose straight way is
 * closed walks the way round), and `arrived` means the order finished — not that he gave up on a blocked way
 * (Unit._guardBody stops him after three re-plans: on M1 the drums from 180° once "arrived" that way, 5 m short).
 */
export function approachRuns(g, w, u, T, { ks = [0, 2, 4, 6], stance = 'crawl', dist = 3, through = false, steps = 900 } = {}) {
  const tick = (k) => { for (let i = 0; i < k; i++) g.step(); };
  const tag = String(u.tag ?? u.id), out = [];
  const depth = () => { const f = g.clip.entity(tag, { minDepth: 0.02 }).findings || []; return f[0] ? { d: f[0].depth, b: `${f[0].b?.cat}:${f[0].b?.id}` } : { d: 0, b: '' }; };
  for (const k of ks) {
    const a = k * Math.PI / 4;
    let sx, sz, ok = false;
    for (let d = T.r + dist; d < T.r + dist + 6 && !ok; d += 0.5) {
      sx = T.x + Math.cos(a) * d; sz = T.z + Math.sin(a) * d;
      ok = w.grid.walkableAt(sx, sz) && w.grid.walkableAt(sx + 0.5, sz) && w.grid.walkableAt(sx, sz + 0.5);
    }
    if (!ok) { out.push({ k, skip: true }); continue; }
    u.stop?.(); u.setPosition(sx, sz, a + Math.PI); u.setStance(stance); tick(10);
    let gaveUp = 0;
    const own = Object.prototype.hasOwnProperty.call(u, 'stop'), stop = u.stop;
    u.stop = function () { if (this.path) gaveUp++; return stop.call(this); }; // (a stop with an order on: given up)
    const took = through ? u.moveTo(2 * T.x - sx, 2 * T.z - sz) : u.moveTo(T.x, T.z);
    const P = u.path || [];
    let len = 0;
    for (let i = Math.max(1, u.pathIndex); i < P.length; i++) len += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    const budget = Math.max(steps, Math.ceil((len / Math.max(0.3, u.speed || 1)) * 60 * 1.3) + 120);
    let minGap = Infinity, worst = { d: 0, b: '' };
    for (let s = 0; s < budget && u.path; s += 5) {
      tick(5);
      minGap = Math.min(minGap, BC.unitGap(u));
      const f = depth();
      if (f.d > worst.d) worst = f;
    }
    tick(20);
    if (own) u.stop = stop; else delete u.stop;
    const end = depth();
    if (end.d > worst.d) worst = end;
    out.push({ k, took, arrived: !u.path && !gaveUp, len: +len.toFixed(1), minGap: +minGap.toFixed(3), worst: +worst.d.toFixed(3), hit: worst.b, at: `${u.x.toFixed(1)},${u.z.toFixed(1)}` });
  }
  return out;
}
