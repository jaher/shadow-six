/**
 * M3 dam front (user request 2026-10-02: "Fuel tank in the dam mission is too close to the stairs, people should not
 * be able to walk right in front of the dam"):
 *  - the foot of the face (toe ledge, its rim, the snow under the face's ends) is a `noWalk` area: no walker, wader,
 *    swimmer, diver or boat goes there, no order or path ends there, no spawn / route / item lies there, a body
 *    coming to rest there is moved out; the crest and both stairs above and beside it stay open;
 *  - the dam's control shack (the box that read as a tank by the E stair) stands on the ground by the truck road,
 *    clear of both stairs and their landings, parallel to the road; nothing else stands beside the stairs either.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { normalizeMission, validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { pointInPolygon } from '../../src/core/math.js';
import { noWalkCells, stampNoWalk } from '../../src/world/map-builder.js';
import { NavGrid, T } from '../../src/world/grid.js';
import { analyzeMission } from '../../src/missions/alignment.js';
import { settleFeedback } from '../../src/physics/feedback.js';

const def = getMission('m03');
const zone = def.noWalk.find((n) => n.id === 'dam_front');
const dam = def.structures.find((s) => s.id === 'dam');
const STAIRS = dam.ramps.map((r) => ({ id: r.id, foot: r.points[0], top: r.points[r.points.length - 1], w: r.width }));
const cellOf = (g, x, z) => g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell));
/** Distance from (x, z) to segment a–b. */
const segDist = (x, z, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
};
/** Points that stood in front of the dam before: the old ledge walk and charge spot, the toe under the spillway, the snow under both ends. */
const FRONT = [[38.0, 28.6], [35.82, 29.59], [44, 27], [40, 30.5], [48.5, 29], [31, 29], [30.2, 32], [52.6, 25.2], [53.6, 27.4]];

test('m03 dam front: validates; the toe ledge, its rim and the snow under the face are no-walk for walkers, swimmers and divers', () => {
  assert.deepEqual(validateMission(def).errors, []);
  assert.ok(zone && zone.points.length >= 3, 'dam_front noWalk area');
  const { grid } = loadGrid(def);
  assert.ok(grid.noWalk, 'grid.noWalk published');
  for (const [x, z] of FRONT) {
    assert.ok(pointInPolygon(x, z, zone.points), `(${x},${z}) inside dam_front`);
    assert.equal(grid.noWalk[cellOf(grid, x, z)], 1, `(${x},${z}) marked no-walk`);
    for (const o of [undefined, { swim: true }, { dive: true }]) assert.equal(grid.walkableAt(x, z, o), false, `(${x},${z}) ${JSON.stringify(o ?? {})}`);
  }
  // every ground cell of the T3 toe ledge is out of bounds
  const toe = def.terrain.find((t) => t.terrain === 'shallow' && t.type === 'poly').points;
  let n = 0;
  for (let k = 0; k < grid.size; k++) {
    const x = (k % grid.cols + 0.5) * grid.cell, z = (Math.floor(k / grid.cols) + 0.5) * grid.cell;
    if (!pointInPolygon(x, z, toe) || grid.bridge[k]) continue;
    n++;
    assert.ok(!grid.isWalkable(k % grid.cols, Math.floor(k / grid.cols), { swim: true }), `toe ledge cell (${x},${z}) walkable`);
  }
  assert.ok(n > 100, `toe ledge cells checked (${n})`);
});

test('m03 dam front: the crest and both stairs stay open, the banks still join over the crest', () => {
  const { grid } = loadGrid(def);
  for (const s of STAIRS) {
    const L = Math.hypot(s.top[0] - s.foot[0], s.top[1] - s.foot[1]);
    for (let d = 0.25; d < L; d += 0.5) {
      const x = s.foot[0] + ((s.top[0] - s.foot[0]) * d) / L, z = s.foot[1] + ((s.top[1] - s.foot[1]) * d) / L;
      assert.ok(grid.walkableAt(x, z), `${s.id} tread at ${d.toFixed(2)} m (${x.toFixed(2)},${z.toFixed(2)})`);
      assert.ok(!grid.noWalk[cellOf(grid, x, z)], `${s.id} not stamped at (${x.toFixed(2)},${z.toFixed(2)})`);
    }
  }
  const mid = def.markers.find((m) => m.id === 'dam_charge');
  assert.ok(grid.walkableAt(mid.x, mid.z) && grid.elevAt(mid.x, mid.z) > 7, 'the crest centre (the charge spot) is walkable at the deck');
  const p = findPath(grid, 22, 41.5, 60, 35, { maxNodes: 400000 });
  assert.ok(p, 'W stair foot → crest → E stair foot');
  for (const q of p) assert.ok(!grid.noWalk[cellOf(grid, q.x, q.z)], `waypoint (${q.x.toFixed(1)},${q.z.toFixed(1)}) in front of the dam`);
});

test('m03 dam front: no path, swim or boat route ends there; the nearest valid spot is outside it', () => {
  const { grid } = loadGrid(def);
  for (const [x, z] of FRONT) {
    for (const [from, o] of [[[60, 35], {}], [[22, 41.5], {}], [[45, 36], { swim: true }]]) {
      const p = findPath(grid, from[0], from[1], x, z, { maxNodes: 400000, ...o });
      if (!p) continue; // refused
      for (const q of p) assert.ok(!grid.noWalk[cellOf(grid, q.x, q.z)], `path ${JSON.stringify(from)} → (${x},${z}) ${JSON.stringify(o)} passes (${q.x.toFixed(2)},${q.z.toFixed(2)})`);
    }
  }
});

test('m03 dam front: no spawn, post, route, squad loop, item, vehicle, marker or extraction point lies in it', () => {
  const n = normalizeMission(def, { quiet: true });
  const pts = [];
  const add = (what, p) => { if (p && Number.isFinite(p.x ?? p[0])) pts.push([what, p.x ?? p[0], p.z ?? p[1]]); };
  for (const c of n.commandos) add(`commando ${c.role}`, c);
  for (const e of n.enemies) {
    add(`enemy ${e.id}`, e);
    for (const q of e.route?.points || []) add(`route ${e.id}`, q);
    if (e.alarmRoute?.run) add(`alarm route ${e.id}`, e.alarmRoute.run);
  }
  for (const [id, b] of Object.entries(n.barracks)) for (const s of b.squads) for (const q of [...s.loop, ...s.exitRoute]) add(`squad ${id}`, q);
  for (const it of [...n.items, ...n.interactables, ...n.vehicles, ...n.markers]) add(`${it.id}`, it);
  const ex = n.extraction;
  for (const k of ['spawnAt', 'arrive', 'exit']) add(`extraction ${k}`, ex[k]);
  for (const s of n.structures) if (s.x != null && s.id !== 'dam') add(`structure ${s.id}`, s);
  assert.ok(pts.length > 100, `points checked (${pts.length})`);
  for (const [what, x, z] of pts) assert.ok(!pointInPolygon(x, z, zone.points), `${what} at (${x},${z}) in front of the dam`);
});

test('m03 dam front: a commando ordered onto the toe ledge never sets foot in front of the dam', () => {
  const s = makeSim(def, { brains: false });
  const w = s.world, g = w.grid, sap = s.cmd('sapper');
  for (const [x, z] of [[44, 27], [38.0, 28.6], [31, 29], [53.6, 27.4]]) {
    Object.assign(sap, { x: 60.5, z: 36.5, y: 0, path: null });
    sap.issue({ type: 'move', x, z, run: true });
    for (let i = 0; i < 60 * 25; i++) {
      s.step(1 / 60);
      assert.ok(!g.noWalk[cellOf(g, sap.x, sap.z)], `ordered to (${x},${z}): stepped into (${sap.x.toFixed(2)},${sap.z.toFixed(2)})`);
    }
  }
});

test('m03 dam front: a body coming to rest in it (even in its water) is moved out', () => {
  const s = makeSim(def, { brains: false });
  const w = s.world, g = w.grid;
  for (const [x, z] of [[40, 30.5], [44, 27]]) {
    const u = { x, z, y: 0 }, rd = { unit: u, anchor: { x: 60.5, z: 36.5 }, spawnPelvis: { x: 60.5, y: 0.3, z: 36.5 }, pose: [x, 0.2, z, 0, 0, 0, 1] };
    settleFeedback({ world: w }, rd, {});
    assert.ok(!g.noWalk[cellOf(g, u.x, u.z)] && !u.sunk, `body from (${x},${z}) rests at (${u.x.toFixed(2)},${u.z.toFixed(2)}) sunk=${!!u.sunk}`);
  }
});

test('noWalkCells: ground cells only — a deck over the area and a ramp beside it stay open', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(0, 0, 20, 20, 'terrain', T.SHALLOW);
  g.fillRect(5, 5, 2, 10, 'bridge', 1);
  for (let k = 0; k < g.size; k++) if (g.bridge[k]) g.elev[k] = 7;
  g.fillRect(12, 2, 1, 1, 'elev', 2.5);
  g.addRamp({ ax: 15, az: 2, bx: 15, bz: 18, w: 1.6, ya: 7, yb: 0.25 });
  const area = { id: 'a', points: [[2, 2], [18, 2], [18, 18], [2, 18]] };
  const cells = new Set(noWalkCells(g, area));
  const at = (x, z) => cells.has(cellOf(g, x, z));
  assert.ok(at(3, 3) && at(10, 10), 'shallow ground inside');
  assert.ok(!at(6, 10), 'deck cell');
  assert.ok(!at(12.2, 2.2), 'raised cell');
  assert.ok(!at(15, 10) && !at(15.9, 10), 'ramp and its edge');
  assert.ok(!at(1, 1) && !at(19, 19), 'outside');
  stampNoWalk(g, [area]);
  assert.equal(g.walkableAt(10, 10, { swim: true }), false);
  assert.equal(g.walkableAt(6, 10), true, 'deck still walkable');
  assert.equal(g.noWalk[cellOf(g, 10, 10)], 1);
  stampNoWalk(g, []);
  assert.equal(g.noWalk, null, 'cleared when a mission has none');
});

test('m03: the dam control shack (the "fuel tank" by the E stair) stands on the ground by the truck road, clear of the stairs', () => {
  assert.ok(!def.structures.some((s) => s.id === 'dam_crag'), 'the crag that carried it beside the E stair is gone');
  const shack = def.structures.find((s) => s.id === 'dam_shack');
  assert.ok(shack?.assetPart?.box && dam.hideParts?.some((p) => p.box.join() === shack.assetPart.box.join()), 'dam hides its own shack; dam_shack rebuilds that part');
  // footprint corners vs every stair (its run, landing and foot): ≥ 20 m — nowhere near
  const c = Math.cos(shack.rot), s = Math.sin(shack.rot), hw = shack.w / 2, hd = shack.d / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [shack.x + u * c - v * s, shack.z + u * s + v * c]);
  for (const st of STAIRS) for (const [x, z] of corners) assert.ok(segDist(x, z, st.foot, st.top) > 20, `${st.id} ${segDist(x, z, st.foot, st.top).toFixed(1)} m from the shack`);
  // parallel to the road it stands by, off the road and the truck's lane
  const a = analyzeMission(def).entries.find((e) => e.id === 'dam_shack');
  assert.ok(a && a.ref?.kind === 'road' && Math.abs(a.devDeg) <= 2, `aligned with the road (${JSON.stringify(a?.ref)} dev ${a?.devDeg})`);
  const { grid } = loadGrid(def);
  for (let z = -1; z <= 12; z += 0.5) assert.ok(grid.walkableAt(60, Math.max(0.25, z)) && grid.walkableAt(58.9, Math.max(0.25, z)) && grid.walkableAt(61.1, Math.max(0.25, z)), `truck lane at z ${z}`);
  // nothing else (structures with a footprint) within 3 m of a stair's run, landing or foot
  for (const st of def.structures) {
    if (st.id === 'dam' || st.x == null) continue;
    const r = Math.max(st.w ?? 0, st.d ?? 0, (st.r ?? 0) * 2) / 2;
    for (const s2 of STAIRS) assert.ok(segDist(st.x, st.z, s2.foot, s2.top) - r > 3, `${st.id ?? st.type} beside ${s2.id}`);
  }
});
