/**
 * M2 wide river (user request 2026-09-30: "Make the river in mission 2 wider"): the river is ~24 m wide (was
 * 12) with natural banks; the camp (NE) bank keeps its old edge, the SW bank and the settlement moved out
 * (DZ 16, map 82×120). The patrol-boat lane stays in deep water with room for a true-scale 13.6 m HS 114,
 * both islets keep a channel on each side, and the settlement stays dry and walkable to the shore.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { T } from '../../src/world/grid.js';

const ctx = loadGrid(getMission('m02'));
const { grid, world, def } = ctx;
const code = (x, z) => {
  const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
  return i < 0 || j < 0 || i >= grid.cols || j >= grid.rows ? null : grid.terrain[j * grid.cols + i];
};
const wet = (c) => c === T.WATER || c === T.SHALLOW;
/** Distance (m) from (x,z) to the nearest cell matching `pred` (brute force; the grid is small). */
const nearest = (x, z, pred) => {
  let best = Infinity;
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
    if (pred(grid.terrain[j * grid.cols + i])) best = Math.min(best, Math.hypot((i + 0.5) * grid.cell - x, (j + 0.5) * grid.cell - z));
  }
  return best;
};
const lane = def.vehicles.find((v) => v.id === 'pboat').route.points.map((p) => [p.x, p.z]);

test('m02 river: ~24 m wide (20–28) across every leg of the boat lane, map grown to 82×120', () => {
  assert.deepEqual(def.size, [82, 120]);
  const widths = [];
  for (let k = 0; k + 1 < lane.length; k++) {
    for (const t of [0.2, 0.5, 0.8]) {
      const [ax, az] = lane[k], [bx, bz] = lane[k + 1], L = Math.hypot(bx - ax, bz - az);
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t, nx = -(bz - az) / L, nz = (bx - ax) / L;
      // bank to bank: the last wet sample before 7 m of solid land (an islet is narrower); null = ray leaves the map
      const span = (sgn) => {
        let last = 0, land = 0;
        for (let d = 0; d < 45; d += 0.1) {
          const c = code(x + nx * d * sgn, z + nz * d * sgn);
          if (c === null) return null;
          if (wet(c)) { last = d; land = 0; } else if ((land += 0.1) > 7) break;
        }
        return last;
      };
      const a = span(-1), b = span(1);
      if (a === null || b === null) continue;
      widths.push(+(a + b).toFixed(1));
    }
  }
  const mean = widths.reduce((s, w) => s + w, 0) / widths.length;
  assert.ok(Math.min(...widths) >= 19.5 && Math.max(...widths) <= 30, `widths ${widths}`);
  assert.ok(mean > 22 && mean < 26, `mean width ${mean.toFixed(1)} (${widths})`);
});

test('m02 river: the camp bank did not move — NE-bank cover and the GB climb base keep their distance to the water', () => {
  // measured on the 12 m river (git 268b96a); the widened river may only leave them farther from the water
  const old = { rocks_n1: [21.83, 40.75, 3.84], rocks_n2: [34, 51, 3.18], rocks_n3: [40.31, 55.81, 3.19],
    climb_base: [23.73, 41, 4.76], e4_west: [20, 42.5, 1.46], e4_east: [40, 57.5, 1.77], camp_S: [46, 58, 5.3] };
  for (const [id, [x, z, d0]] of Object.entries(old)) {
    const d = nearest(x, z, wet);
    assert.ok(d >= d0 - 0.05 && d <= d0 + 1.5, `${id}: ${d.toFixed(2)} m from the water (was ${d0})`);
  }
});

test('m02 river: a true-scale 13.6 m × 3.6 m HS 114 on its lane sits in deep water, with metres to spare off the islets', () => {
  const HL = 13.6 / 2, HB = 3.6 / 2;
  let worst = Infinity;
  for (let k = 0; k + 1 < lane.length; k++) {
    const [ax, az] = lane[k], [bx, bz] = lane[k + 1], L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = 0; s <= L; s += 0.5) {
      const cx = ax + ux * s, cz = az + uz * s;
      for (let u = -HL; u <= HL; u += 0.4) for (const v of [-HB, 0, HB]) {
        const c = code(cx + ux * u - uz * v, cz + uz * u + ux * v);
        if (c === null) continue; // the NW turning point lies just off the W edge, like the original
        assert.equal(c, T.WATER, `hull at (${cx.toFixed(1)},${cz.toFixed(1)}) touches ${c} (leg ${k})`);
      }
      worst = Math.min(worst, nearest(cx, cz, (t) => t !== T.WATER));
    }
  }
  assert.ok(worst >= HB + 1.2, `lane centre ${worst.toFixed(2)} m from shallows/land (half beam ${HB})`);
  for (const id of ['islet1', 'islet2']) {
    const r = def.structures.find((s) => s.id === id);
    assert.ok(code(r.x, r.z) === T.SNOW, `${id} stands on its islet`);
  }
});

test('m02 river: settlement dry and clear of the shore; team walks from the start to the SW shallows; the Marine swims across', () => {
  const wall = def.structures.find((s) => s.id === 'sw_wall');
  for (const seg of wall.segments) for (const [x, z] of seg) assert.ok(nearest(x, z, wet) >= 3, `sw_wall corner (${x},${z}) ${nearest(x, z, wet).toFixed(2)} m from water`);
  for (const id of ['cabA', 'cabB']) { const s = def.structures.find((q) => q.id === id); assert.ok(nearest(s.x, s.z, wet) > 10, id); }
  for (const c of def.commandos) assert.equal(code(c.x, c.z), T.SNOW, `${c.role} starts on snow`);
  for (const id of ['e1', 'e2', 'e3']) {
    for (const p of def.enemies.find((e) => e.id === id).route.points) assert.ok(!wet(code(p.x, p.z)), `${id} waypoint (${p.x},${p.z}) dry`);
  }
  const sn = def.commandos.find((c) => c.role === 'sniper');
  const toShore = world.findPath(sn.x, sn.z, 19.5, 74.2, { role: 'sniper' });
  assert.ok(toShore && toShore.length, 'start → SW shore on foot');
  const swim = world.findPath(19.5, 74.2, 27.2, 50.3, { role: 'diver', swim: true });
  const deepRun = (pts) => { let n = 0; for (let k = 0; k + 1 < pts.length; k++) for (let t = 0; t < 1; t += 0.02) n += code(pts[k].x + (pts[k + 1].x - pts[k].x) * t, pts[k].z + (pts[k + 1].z - pts[k].z) * t) === T.WATER; return n; };
  assert.ok(swim && deepRun(swim) > 0, 'Marine swims SW shore → NE bank');
  assert.equal(world.findPath(19.5, 74.2, 27.2, 50.3, { role: 'sniper' }), null, 'no dry way across for a non-swimmer');
});

test('grid.fillLine: per-point widths taper each segment (path terrain `widths`)', async () => {
  const { NavGrid } = await import('../../src/world/grid.js');
  const g = new NavGrid(40, 20, 0.5);
  g.fillLine([[2, 10], [38, 10]], [4, 12], 'terrain', T.WATER);
  const span = (x) => { let n = 0; for (let z = 0.25; z < 20; z += 0.5) n += g.terrain[g.idx(Math.floor(x / 0.5), Math.floor(z / 0.5))] === T.WATER; return n * 0.5; };
  assert.ok(Math.abs(span(3) - 4.25) < 0.8, `narrow end ${span(3)}`);
  assert.ok(Math.abs(span(20) - 8) < 0.8, `middle ${span(20)}`);
  assert.ok(Math.abs(span(37) - 11.75) < 0.8, `wide end ${span(37)}`);
});

test('m02 §7.5 step 2 on the wide river: from the SW shore the Sniper has e5 (walk_sw) and e4 in his 45 m, beyond their 36 m cones', async () => {
  const { makeSim } = await import('./abilsim.mjs');
  const { Alarm } = await import('../../src/ai/alarm.js');
  const { canSee } = await import('../../src/ai/perception.js');
  const s = makeSim(getMission('m02'));
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  // steps 1 (settlement) done; the camp-interior watchers of e5's body are a timing matter the widening did not
  // touch (replay notes: safe windows) — taken out so this pins the geometry: range, shot lines, concealment
  for (const id of ['e1', 'e2', 'e3', 'e6', 'e7', 'e10', 'e11', 'e12']) w.remove(s.get(id));
  w.flushRemovals();
  const alarms = []; w.events.on('alarm:zone', (p) => alarms.push(p));
  const sn = s.cmd('sniper'), e4 = s.get('e4'), e5 = s.get('e5');
  for (const c of w.commandos) if (c !== sn) Object.assign(c, { x: 5, z: 116, path: null });
  Object.assign(sn, { x: 26, z: 80, y: 0, path: null }); // dry SW shore below the settlement's N wall, ~4 m from the water
  assert.ok(!wet(code(sn.x, sn.z)) && nearest(sn.x, sn.z, wet) < 6, 'on the shore');
  const d5 = Math.hypot(e5.x - sn.x, e5.z - sn.z);
  assert.ok(d5 > 36 && d5 < 45, `e5 at ${d5.toFixed(1)} m: past a soldier's far band, inside the rifle`);
  let seen = 0;
  for (let k = 0; k < 60 * 8; k++) { s.step(1 / 60); for (const e of [e4, e5]) if (e.alive && canSee(e, sn, w) !== 'none') seen++; }
  assert.equal(seen, 0, 'neither e4 nor e5 sees him standing on the shore');
  const { ABILITIES } = await import('../../src/abilities/index.js');
  assert.equal(ABILITIES.sniper.canUse(sn, e5, w), true, 'e5 in range with a clear line over the river');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: e5 }), 'Sniper: e5');
  s.run(2, () => !e5.alive);
  assert.ok(!e5.alive, 'e5 down on walk_sw');
  // e4 walks his beat in front of the rocks; shoot him once he is in range and clear of the rocks
  let shot = false;
  s.run(60, () => {
    if (!shot && ABILITIES.sniper.canUse(sn, e4, w) === true) shot = sn.issue({ type: 'ability', id: 'sniper', target: e4 });
    return !e4.alive;
  });
  assert.ok(!e4.alive, `e4 down (sniper rounds left ${sn.inventory.count?.('sniperRifle') ?? '?'})`);
  s.run(5);
  assert.equal(alarms.length, 0, 'no alarm');
});
