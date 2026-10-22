/**
 * Straight, decisive paths (user 2026-10-15, watching the M3 walkthrough: "Looking at mission 3 the trajectory of
 * commandos is very zig baggy, making it more straight and decisive. Longer trajectories rather than zig zagging in
 * small trajectories"): the pathfinder's taut pull (pathfinding tautenPath, a player's paths), the sneak executor's
 * dash compiler (tools/solutions/dash.mjs) and the straightness metrics (tools/solutions/trail-metrics.mjs).
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B } from '../../src/world/grid.js';
import { findPath, tautenPath, pathLength, SMOOTH_CLEARANCE, touchesFlight } from '../../src/world/pathfinding.js';
import { StairField, makeFlight } from '../../src/world/stairs.js';
import { compileDash, dashStops } from '../../tools/solutions/dash.mjs';
import { analyseStretch, measureTrail } from '../../tools/solutions/trail-metrics.mjs';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** bends of ≥ `deg` along a polyline */
function bends(p, deg = 20) {
  let n = 0;
  for (let k = 1; k + 1 < p.length; k++) {
    const d = Math.abs(wrap(Math.atan2(p[k + 1].z - p[k].z, p[k + 1].x - p[k].x) - Math.atan2(p[k].z - p[k - 1].z, p[k].x - p[k - 1].x)));
    if (d >= (deg * Math.PI) / 180) n++;
  }
  return n;
}
const lineOpts = { clearance: SMOOTH_CLEARANCE };
function assertWalkable(g, p) {
  for (let k = 1; k < p.length; k++) assert.ok(g.walkableLine(p[k - 1].x, p[k - 1].z, p[k].x, p[k].z, lineOpts), `leg ${k} keeps a body's clearance off the walls`);
}

test('open ground, any angle: one straight leg, no staircase (taut or not)', () => {
  const g = new NavGrid(60, 60);
  for (const [ax, az, bx, bz] of [[2, 2, 57, 13], [3, 50, 41, 7], [10, 10, 11.3, 52], [55, 3, 4, 31.7]]) {
    for (const taut of [false, true]) {
      const p = findPath(g, ax, az, bx, bz, { taut });
      assert.equal(p.length, 2, `(${ax},${az}) → (${bx},${bz}) taut=${taut}: ${JSON.stringify(p)}`);
    }
  }
});

test('round a wall corner: one bend, at a body\'s clearance off the corner, never shorter than the corner allows', () => {
  const g = new NavGrid(40, 40);
  g.fillRect(10, 10, 12, 1.5, 'block', B.HIGH); // a wall from (10,10) to (22,11.5)
  const p = findPath(g, 26, 3, 13, 16, { taut: true });
  assertWalkable(g, p);
  assert.equal(bends(p, 5), 1, `one corner: ${JSON.stringify(p.map((q) => [+q.x.toFixed(2), +q.z.toFixed(2)]))}`);
  assert.equal(p.length, 3, 'start, the corner, the goal');
  // the corner hugs the wall's east end (22, 11.5) within a cell
  assert.ok(Math.hypot(p[1].x - 22, p[1].z - 11.5) < 0.9, `corner at (${p[1].x.toFixed(2)},${p[1].z.toFixed(2)})`);
  const loose = findPath(g, 26, 3, 13, 16, { taut: false });
  assert.ok(pathLength(p) <= pathLength(loose) + 1e-6, 'taut is never longer');
  assert.ok(bends(p, 5) <= bends(loose, 5), 'no more small kinks than before');
});

test('a slalom between pillars: bends only at pillars, legs between them straight', () => {
  const g = new NavGrid(60, 30);
  for (const [x, z] of [[15, 0], [30, 12], [45, 0]]) g.fillRect(x, z, 2, 18, 'block', B.HIGH);
  const p = findPath(g, 3, 5, 57, 5, { taut: true });
  assertWalkable(g, p);
  // every bend sits within 1.2 m of a pillar end
  const ends = [[15, 18], [17, 18], [30, 12], [32, 12], [45, 18], [47, 18]];
  for (let k = 1; k + 1 < p.length; k++) assert.ok(ends.some(([x, z]) => Math.hypot(p[k].x - x, p[k].z - z) < 1.2), `bend ${k} at (${p[k].x.toFixed(2)},${p[k].z.toFixed(2)}) is at a pillar end`);
  assert.ok(bends(p, 20) <= 6, `${bends(p, 20)} bends for three pillars`);
});

test('a taut leg never comes on to a flight of stairs over its side (the rails would turn him back)', () => {
  const g = new NavGrid(30, 30);
  g.fillRect(14, 6, 1.5, 12, 'block', B.HIGH); // a wall the path rounds at its south end (14..15.5, 18)
  // a link flight's band just past that end, west of the wall: open ground to the grid, rails to a walker
  const f = makeFlight({ id: 'f', kind: 'link', ox: 13, oz: 19.2, ux: 0, uz: -1, w: 1, railS: [0, 4], risers: [0, 1, 2, 3], levels: [0, 0.5, 1, 1.5, 2], link: { id: 99 } });
  g.flights = new StairField([f]);
  const p = findPath(g, 25, 12, 8, 19.5, { taut: true });
  for (let k = 1; k < p.length; k++) {
    // (the greedy pull's own legs may touch it; a slid or merged one never newly does)
    const loose = findPath(g, 25, 12, 8, 19.5, { taut: false });
    const looseTouch = loose.some((q, i) => i > 0 && touchesFlight(g.flights.flights, loose[i - 1], q));
    if (!looseTouch) assert.ok(!touchesFlight(g.flights.flights, p[k - 1], p[k]), `leg ${k} touches the flight: ${JSON.stringify(p)}`);
  }
  assert.ok(touchesFlight([f], { x: 11, z: 18 }, { x: 15, z: 18 }), 'a line across its band touches it');
  assert.ok(!touchesFlight([f], { x: 11, z: 21 }, { x: 15, z: 21 }), 'a line a metre and more past its foot does not');
});

test('tautenPath: a zigzag in the open becomes one leg; a two-step rounding becomes one corner', () => {
  const zig = [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 0 }, { x: 3, z: 1 }, { x: 4, z: 0 }, { x: 5, z: 1 }];
  assert.equal(tautenPath(zig, () => true).length, 2);
  // a square block at [2,4]×[2,4]: a path rounding its corner (4,2) by two vertices (cell centres of an A* chain)
  const inBlock = (x, z) => x > 2 && x < 4 && z > 2 && z < 4;
  const lineOk = (a, b) => { for (let s = 0; s <= 50; s++) { const x = a.x + (b.x - a.x) * s / 50, z = a.z + (b.z - a.z) * s / 50; if (inBlock(x, z)) return false; } return true; };
  const p = tautenPath([{ x: 0, z: 3 }, { x: 1.8, z: 1.6 }, { x: 4.4, z: 1.8 }, { x: 4.6, z: 3.5 }, { x: 4.4, z: 6 }], lineOk);
  for (let k = 1; k < p.length; k++) assert.ok(lineOk(p[k - 1], p[k]));
  assert.ok(p.length <= 4, `rounded in at most two corners: ${JSON.stringify(p)}`);
  assert.equal(tautenPath([{ x: 0, z: 0 }, { x: 1, z: 0 }], () => false).length, 2, 'two points stay');
});

/** a planSneak-like plan over 1 m cells (x0 = z0 = 0, W × H), with a ctx whose cones are `seenAt(x, z, t)` */
function fakePlan(cells, { t0 = 0, DT = 0.2, speed = 0.9, seenAt = () => false, W = 40, H = 40, waitsAt = {} } = {}) {
  const plan = [];
  let t = t0;
  for (let i = 0; i < cells.length; i++) {
    const [x, z] = cells[i];
    if (i > 0) { const [px, pz] = cells[i - 1]; t += Math.ceil(Math.hypot(x - px, z - pz) / (speed * 0.85) / DT) * DT; }
    plan.push([x, z, t]);
    for (let k = 0; k < (waitsAt[i] || 0); k++) { t += DT; plan.push([x, z, t]); }
  }
  const cellOf = (x, z) => { const i = Math.floor(x), j = Math.floor(z); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  const ctx = { seen: (c, k) => seenAt((c % W) + 0.5, Math.floor(c / W) + 0.5, t0 + k * DT), pass: () => true, cellOf, DT, now: t0, ma: 2, mb: 3, holdK: 15, KS: 4000 };
  Object.defineProperty(plan, 'ctx', { value: ctx, enumerable: false });
  return plan;
}
const straight = (ax, az, bx, bz) => [{ x: ax, z: az }, { x: bx, z: bz }];

test('dash compiler: an eight-direction staircase of cells in the open is one straight leg, no halt', () => {
  const cells = [[1.5, 1.5]];
  for (let k = 0; k < 12; k++) { const [x, z] = cells.at(-1); cells.push(k % 3 === 2 ? [x + 1, z] : [x + 1, z + 1]); }
  const plan = fakePlan(cells);
  const legs = compileDash(plan, { speed: 0.9, route: straight });
  assert.ok(legs, 'compiled');
  assert.equal(legs.filter((l) => !l.wait).length, 1, `one leg: ${JSON.stringify(legs)}`);
  assert.equal(dashStops(legs), 0);
  const L = legs[0];
  assert.ok(Math.abs(L.end - L.start - Math.hypot(cells.at(-1)[0] - 1.5, cells.at(-1)[1] - 1.5) / 0.9) < 1e-6, 'timed at his own pace');
});

test('dash compiler: the plan\'s wait stays a wait; legs never pass it', () => {
  const cells = [];
  for (let x = 1.5; x <= 15.5; x += 1) cells.push([x, 5.5]);
  const plan = fakePlan(cells, { waitsAt: { 7: 20 } });
  const legs = compileDash(plan, { speed: 0.9, route: straight });
  assert.ok(legs);
  const moves = legs.filter((l) => !l.wait), waits = legs.filter((l) => l.wait);
  assert.equal(moves.length, 2, 'two legs: to the waiting cell and on');
  assert.equal(waits.length, 1);
  assert.equal(moves[0].x, 8.5, 'the first leg ends where the plan waits');
  assert.ok(waits[0].until >= plan.find((p, i) => i > 7 && p[0] === 8.5)[2] - 1e-6, 'held until the plan leaves');
});

test('dash compiler: a cone the quicker pace would run into is waited out, never walked into', () => {
  // a cone over x ∈ [6, 9] until t = 6 s: the plan (slow pace) gets there after it has gone; at his own pace he would be
  // early — the compiler holds him short of it or returns null, never puts him in it
  const seenAt = (x, z, t) => x >= 6 && x <= 9 && t < 6;
  const cells = [];
  for (let x = 1.5; x <= 14.5; x += 1) cells.push([x, 5.5]);
  const plan = fakePlan(cells, { seenAt });
  // (the plan itself must be clear: shift its timing so it reaches x = 6 after t = 6.4)
  const legs = compileDash(plan, { speed: 0.9, route: straight });
  if (!legs) return; // (falling back to the plan's own clicks is allowed)
  let t = 0, x = 1.5;
  for (const l of legs) {
    if (l.wait) { for (let q = t; q <= l.until; q += 0.05) assert.ok(!seenAt(Math.floor(x) + 0.5, 5.5, q), `waiting at x=${x} t=${q.toFixed(2)} he is in the cone`); t = l.until; continue; }
    const n = 40;
    for (let s = 0; s <= n; s++) {
      const px = x + (l.x - x) * s / n, pt = l.start + (l.end - l.start) * s / n;
      assert.ok(!seenAt(Math.floor(px) + 0.5, 5.5, pt), `at x=${px.toFixed(2)} t=${pt.toFixed(2)} he is in the cone`);
    }
    x = l.x; t = l.end;
  }
});

test('dash compiler: a leg the game would not walk straight is not taken', () => {
  const cells = [];
  for (let x = 1.5; x <= 10.5; x += 1) cells.push([x, 5.5]);
  const plan = fakePlan(cells);
  // the game walks a bend round something between x = 4 and 6: no leg may cross it in one
  // (a real detour, not a bend of a few per cent: those he walks, checked along the game's own line)
  const route = (ax, az, bx, bz) => ((ax < 4.5 && bx > 5.5) ? [{ x: ax, z: az }, { x: 5, z: 9 }, { x: bx, z: bz }] : straight(ax, az, bx, bz));
  const legs = compileDash(plan, { speed: 0.9, route });
  assert.ok(legs);
  let x = 1.5;
  for (const l of legs) { if (l.wait) continue; assert.ok(!(x < 4.5 && l.x > 5.5), `leg ${x} → ${l.x} crosses the bend`); x = l.x; }
});

test('trail metrics: a straight walk has no turn; an eight-direction staircase has one per step; an L has one', () => {
  const line = []; for (let k = 0; k <= 200; k++) line.push({ x: k * 0.05, z: k * 0.02, i: k });
  assert.equal(analyseStretch(line).turns.length, 0);
  const stair = []; let x = 0, z = 0;
  for (let s = 0; s < 10; s++) { for (let k = 0; k < 20; k++) stair.push({ x: (x += 0.05), z, i: stair.length }); for (let k = 0; k < 28; k++) stair.push({ x: (x += 0.035), z: (z += 0.035), i: stair.length }); }
  assert.ok(analyseStretch(stair).turns.length >= 15, `staircase: ${analyseStretch(stair).turns.length} turns`);
  const L = []; for (let k = 0; k <= 100; k++) L.push({ x: k * 0.1, z: 0, i: k }); for (let k = 1; k <= 100; k++) L.push({ x: 10, z: k * 0.1, i: 100 + k });
  const A = analyseStretch(L);
  assert.equal(A.turns.length, 1);
  assert.ok(Math.abs(A.legs[0] - 10) < 0.3 && Math.abs(A.legs[1] - 10) < 0.3, `legs ${A.legs}`);
});

test('trail metrics: per-order ratio and orders per minute from a recorded trail', () => {
  // one man, 1 m/s sampled every 0.1 s: east 10 m on one order, then north 10 m on another
  const n = 1, len = 201, t = new Float32Array(len), x = new Float32Array(len), z = new Float32Array(len), h = new Float32Array(len), f = new Uint8Array(len);
  for (let k = 0; k < len; k++) { t[k] = k / 10; x[k] = Math.min(k / 10, 10); z[k] = Math.max(0, k / 10 - 10); f[k] = 1; }
  const tr = { n, len, roles: ['spy'], t, x, z, h, f, orders: [{ t: 0, u: 0, role: 'spy', type: 'move', x: 10, z: 0, at: [0, 0] }, { t: 10, u: 0, role: 'spy', type: 'move', x: 10, z: 10, at: [10, 0] }], paths: [] };
  const m = measureTrail(tr);
  assert.equal(m.turns, 1);
  assert.equal(m.moveOrders, 2);
  assert.ok(Math.abs(m.orderRatioMean - 1) < 0.02, `ratio ${m.orderRatioMean}`);
  assert.ok(Math.abs(m.ordersPerMin - 6) < 0.05, `${m.ordersPerMin} orders / min`);
});
