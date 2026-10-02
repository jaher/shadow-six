/**
 * Wire pass M4–M20 (docs/barbed-wire.md §12): the added wire runs (structure ids `wx_*`) must not change how the
 * mission plays. Builds the mission grid twice, with and without them, and compares
 *  - every enemy route leg (spawn → first point, point → point, LOOP closure), every barracks squad leg, every
 *    vehicle route leg and the escape vehicle's drive to its exit,
 *  - every commando start → every enemy spawn, objective target / marker and vehicle,
 * by walked path length (A*, the game's pathfinder): a leg may not become unwalkable nor longer than `tol` m.
 * Also: no added wire cell within `clear` m of an enemy spawn, route point, commando start or vehicle; every added
 * run blocks a straight walk across it (the GPU enclosure test's nav rule).
 * Not a *.test.mjs file: imported by wire-placements.test.mjs (and usable from scratch scripts).
 */
import { loadGrid } from './mission-check.mjs';
import { findPath } from '../../src/world/pathfinding.js';
import { B } from '../../src/world/grid.js';

export const WIRE_ADD = /^wx_/;

const len = (p) => { let s = 0; for (let k = 1; k < (p?.length ?? 0); k++) s += Math.hypot(p[k].x - p[k - 1].x, p[k].z - p[k - 1].z); return s; };
const P = (p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p);

/** Key legs of a mission: [[a, b, label]]. */
function legsOf(ctx) {
  const n = ctx.def, out = [];
  for (const e of n.enemies) {
    if (e.vehicle || e.structure || !e.route?.points?.length) continue;
    const pts = e.route.points;
    out.push([{ x: e.x, z: e.z }, pts[0], `${e.id} spawn→p0`]);
    for (let k = 0; k + 1 < pts.length; k++) out.push([pts[k], pts[k + 1], `${e.id} p${k}→p${k + 1}`]);
    if (e.route.type === 'LOOP' && pts.length > 2) out.push([pts[pts.length - 1], pts[0], `${e.id} loop`]);
  }
  for (const v of n.vehicles) {
    const pts = (v.route?.points || v.route || []).map(P).filter((p) => p && p.x != null);
    if (pts.length && v.x != null) out.push([{ x: v.x, z: v.z }, pts[0], `vehicle ${v.id} spawn→p0`]);
    for (let k = 0; k + 1 < pts.length; k++) out.push([pts[k], pts[k + 1], `vehicle ${v.id} p${k}→p${k + 1}`]);
  }
  for (const [id, b] of ctx.world.barracks) for (const [q, s] of b.squads.entries()) {
    let prev = b.door;
    for (const p of [...(s.exitRoute || []), ...(s.loop || [])].map(P)) { if (prev) out.push([prev, p, `barracks ${id}#${q}`]); prev = p; }
  }
  const targets = [];
  for (const e of n.enemies) if (!e.vehicle && !e.structure) targets.push([{ x: e.x, z: e.z }, e.id]);
  for (const v of n.vehicles) if (v.x != null) targets.push([{ x: v.x, z: v.z }, v.id ?? v.vehicleType]);
  for (const o of n.objectives || []) {
    for (const t of [...(o.targets || []), o.target, o.marker, o.vehicleId].filter(Boolean)) {
      const m = ctx.world.markers?.get(t), s = ctx.handle.structures.get(t)?.def;
      const pos = m ? { x: m.x, z: m.z } : s?.x != null ? { x: s.x, z: s.z } : null;
      if (pos) targets.push([pos, `obj ${t}`]);
    }
  }
  for (const c of n.commandos) for (const [t, id] of targets) out.push([{ x: c.x, z: c.z }, t, `${c.role}→${id}`]);
  // the escape vehicle's drive to its exit (a land vehicle: blocked by wire like the men)
  const ex = n.extraction, veh = ex?.vehicleId && n.vehicles.find((v) => v.id === ex.vehicleId);
  if (veh && ex.exit && veh.x != null) out.push([{ x: veh.x, z: veh.z }, ex.exit, `escape ${veh.id}→exit`]);
  return out;
}

/** Problems (strings) the `wx_*` runs of `def` cause; [] when they change nothing. */
export function wireImpact(def, { tol = 1.0, clear = 1.0, maxNodes = 200000 } = {}) {
  const added = (def.structures || []).filter((s) => WIRE_ADD.test(s.id ?? ''));
  if (!added.length) return [];
  const withW = loadGrid(def), without = loadGrid({ ...def, structures: def.structures.filter((s) => !WIRE_ADD.test(s.id ?? '')) });
  const problems = [];
  // the added runs' own cells
  const g = withW.grid, owners = new Set();
  for (const [id, s] of withW.handle.structures) if (WIRE_ADD.test(id)) owners.add(s.owner);
  const cells = [];
  for (let k = 0; k < g.size; k++) if (g.block[k] === B.FENCE && owners.has(g.owner[k])) cells.push(k);
  if (!cells.length) problems.push('added wire stamps no fence cells');
  // the wire layer stands on the terrain: never on a raised deck / walkway (grid.elev)
  for (const k of cells) if (g.elev[k] > 0.3) { problems.push(`wire cell ${k} on a raised surface (elev ${g.elev[k].toFixed(1)})`); break; }
  const pts = [];
  for (const e of withW.def.enemies) { pts.push([e.x, e.z, e.id]); for (const p of e.route?.points || []) pts.push([p.x, p.z, `${e.id} route`]); }
  for (const c of withW.def.commandos) pts.push([c.x, c.z, c.role]);
  for (const v of withW.def.vehicles) if (v.x != null) pts.push([v.x, v.z, v.id ?? v.vehicleType]);
  // things the men carry, blow up or use: 2 m of room round them
  for (const s of withW.def.structures) if (s.x != null && (s.explosive || s.carriable || s.interact)) for (const d of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push([s.x + d[0], s.z + d[1], s.id]);
  for (const k of cells) {
    const i = k % g.cols, j = (k - i) / g.cols, x = (i + 0.5) * g.cell, z = (j + 0.5) * g.cell;
    for (const [px, pz, who] of pts) if (Math.hypot(px - x, pz - z) < clear) { problems.push(`wire cell (${x}, ${z}) within ${clear} m of ${who}`); break; }
  }
  // closed line (tests/enclosure.test.mjs nav rule): a straight walk across any added run (±0.8 m) never gets through
  for (const s of added) for (let k = 0; k + 1 < s.points.length; k++) {
    const [ax, az] = s.points[k], [bx, bz] = s.points[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 0.25));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n, nx = (-(bz - az) / L) * 0.8, nz = ((bx - ax) / L) * 0.8;
      if (g.walkableLine(x - nx, z - nz, x + nx, z + nz, { elevRef: g.elevAt(x - nx, z - nz) })) { problems.push(`${s.id} can be walked across at (${x.toFixed(1)}, ${z.toFixed(1)})`); break; }
    }
  }
  // trees: no wire through a trunk or tight under a crown (it would clip the trunk and hide under the foliage)
  const trees = withW.def.structures.filter((s) => /^(tree|pine|palm)$/.test(s.type) && s.x != null);
  for (const s of added) for (let k = 1; k < s.points.length; k++) {
    const [ax, az] = s.points[k - 1], [bx, bz] = s.points[k], L = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t <= L; t += 0.5) {
      const x = ax + ((bx - ax) * t) / (L || 1), z = az + ((bz - az) * t) / (L || 1);
      const hit = trees.find((q) => Math.hypot(q.x - x, q.z - z) < (q.r ?? 0.5) + 1.8);
      if (hit) { problems.push(`${s.id} passes ${Math.hypot(hit.x - x, hit.z - z).toFixed(1)} m from tree ${hit.id}`); t = L + 1; k = s.points.length; }
    }
  }
  for (const [a, b, label] of legsOf(without)) {
    const p0 = findPath(without.grid, a.x, a.z, b.x, b.z, { maxNodes });
    const p1 = findPath(withW.grid, a.x, a.z, b.x, b.z, { maxNodes });
    if (!p0) continue;
    if (!p1) { problems.push(`${label}: blocked by the added wire`); continue; }
    const d = len(p1) - len(p0);
    if (d > tol) problems.push(`${label}: ${d.toFixed(1)} m longer with the added wire`);
  }
  return [...new Set(problems)];
}
