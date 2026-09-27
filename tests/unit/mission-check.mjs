/**
 * design-spec §10.5 test #14 helpers (MISSIONS): load a mission into a grid-only world and check
 *  (a) it validates and builds without errors,
 *  (b) every commando start reaches every objective target and the extraction given the intended
 *      abilities (raft ferry = swim for the whole team when a Marine/raft is present, GB climb links,
 *      gates opened, raised ladders lowered),
 *  (c) no commando starts inside an enemy cone (posts sampled over their whole sweep, with LOS),
 *  (d) every enemy spawn stands on a walkable cell at its height, and every route leg is walkable.
 * Not a *.test.mjs file: imported by missions13.test.mjs (and usable from scratch scripts).
 */
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { normalizeMission, validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { Enemy, makeVision } from '../../src/entities/enemy.js';
import { coneAt, pointInCone } from '../../src/ai/perception.js';

/** Build a normalized mission grid-only (no meshes). */
export function loadGrid(def) {
  const n = normalizeMission(def, { quiet: true });
  const world = new World({ size: n.size, mission: n });
  const handle = buildMap(world, n, { meshes: false });
  return { def: n, world, grid: world.grid, handle };
}

/** Apply the "intended abilities" world changes: open every gate, lower every ladder, cut `cutFences`. */
export function applyIntendedAbilities(ctx, { cutFences = [] } = {}) {
  const { grid, handle, world } = ctx;
  for (const [id, s] of handle.structures) {
    if (s.type === 'gate' || cutFences.includes(id)) grid.clearOwner(s.owner);
  }
  for (const l of world.ladders || []) grid.setLinkEnabled(l.linkId, true);
}

/** Walkable goal cells around a structure (or a marker), nearest first. */
function goalsFor(ctx, targetId) {
  const { grid, handle, world, def } = ctx;
  const m = world.markers?.get(targetId);
  if (m) return [{ x: m.x, z: m.z }];
  const s = handle.structures.get(targetId)?.def;
  if (!s) return [];
  let cx = s.x, cz = s.z;
  if (cx == null && s.points) { cx = s.points.reduce((a, p) => a + p[0], 0) / s.points.length; cz = s.points.reduce((a, p) => a + p[1], 0) / s.points.length; }
  const R = Math.max(s.w ?? 0, s.d ?? 0, (s.r ?? 1) * 2) / 2 + 2.5;
  const out = [];
  const c = grid.cell;
  for (let z = cz - R; z <= cz + R; z += c) for (let x = cx - R; x <= cx + R; x += c) {
    const i = Math.floor(x / c), j = Math.floor(z / c);
    if (!grid.isWalkable(i, j) || grid.elev[grid.idx(i, j)] > 0.6) continue;
    out.push({ x: (i + 0.5) * c, z: (j + 0.5) * c, d: Math.hypot(x - cx, z - cz) });
  }
  void def;
  return out.sort((a, b) => a.d - b.d).filter((p, k) => k % 7 === 0).slice(0, 12);
}

/** Can `role` get from (sx, sz) to any of the goals? */
function reachAny(grid, sx, sz, goals, opts) {
  for (const g of goals) if (findPath(grid, sx, sz, g.x, g.z, { ...opts, maxNodes: 400000 })) return true;
  return false;
}

/**
 * Run the #14 checks. `opts.ferry` (default: a diver or a raft is present) lets every commando cross
 * deep water; `opts.cutFences` lists fence ids the Sapper cuts; `opts.skipReach` [{role, target}] pairs
 * not expected (documented deviations). Returns a list of human-readable problems (empty = pass).
 */
export function checkMission(def, opts = {}) {
  const problems = [];
  const v = validateMission(def);
  problems.push(...v.errors, ...v.warnings.map((w) => `warning: ${w}`));
  if (v.errors.length) return problems;
  const ctx = loadGrid(def);
  const { grid, world } = ctx;
  const n = ctx.def;
  const hasRaft = n.commandos.some((c) => c.role === 'diver') || n.vehicles.some((x) => x.vehicleType === 'raft');
  const ferry = opts.ferry ?? hasRaft;

  // (d) enemy spawns + routes (before the ability changes: enemies walk the map as built)
  for (const e of n.enemies) {
    if (e.vehicle || e.structure) continue; // crew aboard a vehicle / inside a bunker
    const i = Math.floor(e.x / grid.cell), j = Math.floor(e.z / grid.cell);
    const y = e.y || 0;
    if (!grid.isWalkable(i, j, { swim: false }) || Math.abs(grid.elev[grid.idx(i, j)] - y) > 0.6) problems.push(`enemy ${e.id} spawns on a blocked cell (${e.x}, ${e.z}) y ${y}`);
    if (!e.route) continue;
    const pts = e.route.points;
    const legs = [[{ x: e.x, z: e.z }, pts[0]]];
    for (let k = 0; k + 1 < pts.length; k++) legs.push([pts[k], pts[k + 1]]);
    if (e.route.type === 'LOOP' && pts.length > 2) legs.push([pts[pts.length - 1], pts[0]]);
    for (const p of pts) if (!grid.walkableAt(p.x, p.z)) problems.push(`enemy ${e.id} route point (${p.x}, ${p.z}) is blocked`);
    for (const [a, b] of legs) if (!findPath(grid, a.x, a.z, b.x, b.z, { maxNodes: 400000 })) problems.push(`enemy ${e.id} route leg (${a.x},${a.z})→(${b.x},${b.z}) not walkable`);
  }
  for (const [id, b] of world.barracks) {
    for (const s of b.squads) {
      const pts = [...(s.exitRoute || []), ...(s.loop || [])].map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p));
      let prev = b.door;
      for (const p of pts) {
        if (prev && !findPath(grid, prev.x, prev.z, p.x, p.z, { maxNodes: 400000 })) problems.push(`barracks ${id} squad route leg (${prev.x.toFixed(1)},${prev.z.toFixed(1)})→(${p.x},${p.z}) not walkable`);
        prev = p;
      }
    }
  }

  // (c) commandos outside every cone at the start (posts: whole sweep sampled)
  for (const c of n.commandos) {
    const ci = Math.floor(c.x / grid.cell), cj = Math.floor(c.z / grid.cell);
    if (!grid.isWalkable(ci, cj)) problems.push(`commando ${c.role} starts on a blocked cell`);
    for (const e of n.enemies) {
      const en = new Enemy({ ...e });
      en.vision = makeVision(e.soldierType, e);
      en.sweepActive = !e.route;
      const period = en.vision.period || 4;
      const samples = en.sweepActive ? 24 : 1;
      for (let s = 0; s < samples; s++) {
        const cone = coneAt(en, (s * period) / samples);
        if (!cone || !pointInCone(cone, c.x, c.z)) continue;
        if (grid.lineOfSight(en.x, en.z, c.x, c.z, { viewerElevated: cone.elevated, viewerY: cone.y, targetY: 1.7 })) {
          problems.push(`commando ${c.role} starts inside ${e.id}'s cone`);
          break;
        }
      }
    }
  }

  // (b) reachability with the intended abilities
  applyIntendedAbilities(ctx, { cutFences: opts.cutFences || [] });
  const skip = new Set((opts.skipReach || []).map((p) => `${p.role}>${p.target}`));
  const targets = [];
  for (const o of n.objectives) {
    if (o.type === 'escape') continue;
    for (const t of o.targets || []) targets.push({ id: t, goals: goalsFor(ctx, t) });
    if (o.marker) targets.push({ id: o.marker, goals: goalsFor(ctx, o.marker) });
  }
  const ex = n.extraction;
  if (ex?.zone) targets.push({ id: 'extraction', goals: [ex.zone] });
  if (ex?.vehicleId) {
    const veh = n.vehicles.find((x) => x.id === ex.vehicleId);
    const at = veh ? { x: veh.x, z: veh.z } : ex.arrive || ex.spawnAt;
    if (at) targets.push({ id: `extraction:${ex.vehicleId}`, goals: [at] });
    if (veh && ex.exit && !findPath(grid, veh.x, veh.z, ex.exit.x, ex.exit.z, { maxNodes: 400000 })) problems.push(`escape vehicle ${veh.id} cannot reach its exit`);
  }
  for (const t of targets) if (!t.goals.length) problems.push(`objective target ${t.id} has no walkable approach`);
  for (const c of n.commandos) {
    const swim = c.role === 'diver' || ferry;
    for (const t of targets) {
      if (!t.goals.length || skip.has(`${c.role}>${t.id}`)) continue;
      if (!reachAny(grid, c.x, c.z, t.goals, { role: c.role, swim })) problems.push(`${c.role} cannot reach ${t.id}`);
    }
  }
  return problems;
}
