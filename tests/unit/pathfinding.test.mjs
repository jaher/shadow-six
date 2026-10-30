import { test, assert } from './lib.mjs';
import { NavGrid, B, T, LINK } from '../../src/world/grid.js';
import { findPath, pathLength, warmAreas, rewarmAreas, REWARM_AFTER, AREAS_AT, searchStats } from '../../src/world/pathfinding.js';

/** Every consecutive segment must be walkable. */
function assertWalkable(g, path, opts) {
  for (let k = 1; k < path.length; k++) {
    assert.ok(g.walkableLine(path[k - 1].x, path[k - 1].z, path[k].x, path[k].z, opts), `segment ${k} crosses blocked cells`);
  }
}

test('straight path in open ground is 2 points', () => {
  const g = new NavGrid(20, 20);
  const p = findPath(g, 1, 1, 18, 12);
  assert.equal(p.length, 2);
  assert.deepEqual(p[1], { x: 18, z: 12 });
});

test('path goes around a wall through the gap', () => {
  const g = new NavGrid(30, 30);
  g.fillRect(14, 0, 1, 25, 'block', B.HIGH); // wall with a gap at z ∈ [25, 30)
  const p = findPath(g, 5, 5, 25, 5);
  assert.ok(p, 'path exists');
  assert.ok(p.some((q) => q.z >= 24.5), 'passes through the gap');
  assertWalkable(g, p);
  assert.ok(pathLength(p) < 60);
});

test('no corner cutting between diagonal blocks', () => {
  const g = new NavGrid(4, 4);
  // Block everything except a diagonal pinch at (3,3)-(4,4) cells; start (3,4) target (4,3) share only a corner.
  g.fillRect(0, 0, 4, 4, 'block', B.HIGH);
  g.fillRect(1.5, 2.0, 0.5, 0.5, 'block', B.NONE); // cell (3,4)
  g.fillRect(2.0, 1.5, 0.5, 0.5, 'block', B.NONE); // cell (4,3)
  const p = findPath(g, 1.75, 2.25, 2.25, 1.75);
  assert.equal(p, null, 'diagonal squeeze between two blocked cells is not allowed');
});

test('unreachable target returns null', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(9, 0, 1, 20, 'block', B.HIGH);
  assert.equal(findPath(g, 2, 2, 15, 15), null);
});

test('blocked target → nearest walkable within 3 m', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(10, 10, 2, 2, 'block', B.HIGH);
  const p = findPath(g, 2, 2, 11, 11);
  assert.ok(p);
  const end = p[p.length - 1];
  assert.equal(g.blockAt(end.x, end.z), B.NONE);
  assert.ok(Math.hypot(end.x - 11, end.z - 11) <= 1.6);
  // Deep inside a large block (> 3 m from any walkable cell) → null.
  g.fillRect(0, 14, 20, 6, 'block', B.HIGH);
  assert.equal(findPath(g, 2, 2, 10, 19.5), null);
});

test('bridges: walkers cross water only on the bridge', () => {
  const g = new NavGrid(30, 30);
  g.fillRect(0, 12, 30, 6, 'terrain', T.WATER);
  g.fillRect(20, 11, 3, 8, 'bridge', 1);
  const p = findPath(g, 5, 5, 5, 25);
  assert.ok(p, 'path via bridge');
  assert.ok(p.some((q) => q.x >= 19.9 && q.x <= 23.1 && q.z >= 10.5 && q.z <= 19.5), 'uses the bridge');
  assertWalkable(g, p);
  for (let k = 1; k < p.length; k++) {
    // sample the segments: no sample may be in deep water off-bridge
    for (let s = 0; s <= 20; s++) {
      const x = p[k - 1].x + (p[k].x - p[k - 1].x) * s / 20, z = p[k - 1].z + (p[k].z - p[k - 1].z) * s / 20;
      const { i, j } = g.worldToCell(x, z);
      assert.ok(!g.isWater(i, j), `in water at ${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
});

test('swim option allows crossing deep water directly', () => {
  const g = new NavGrid(30, 30);
  g.fillRect(0, 12, 30, 6, 'terrain', T.WATER);
  g.fillRect(20, 11, 3, 8, 'bridge', 1);
  const walk = findPath(g, 5, 5, 5, 25);
  const swim = findPath(g, 5, 5, 5, 25, { swim: true });
  assert.ok(swim);
  assert.ok(pathLength(swim) < pathLength(walk) - 10, 'swimmer takes the short route');
  // Without a bridge a walker can't cross.
  const g2 = new NavGrid(30, 30);
  g2.fillRect(0, 12, 30, 6, 'terrain', T.WATER);
  assert.equal(findPath(g2, 5, 5, 5, 25), null);
  assert.ok(findPath(g2, 5, 5, 5, 25, { swim: true }));
});

test('fences block movement', () => {
  const g = new NavGrid(20, 20);
  g.fillLine([[10, 0], [10, 20]], 0.5, 'block', B.FENCE);
  assert.equal(findPath(g, 2, 10, 18, 10), null);
});

test('start inside a blocked cell escapes to nearest walkable', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(5, 5, 1, 1, 'block', B.HIGH);
  const p = findPath(g, 5.4, 5.4, 15, 15);
  assert.ok(p);
  assert.equal(g.blockAt(p[0].x, p[0].z), B.NONE);
});

test('large map search is fast', () => {
  const g = new NavGrid(120, 120);
  for (let k = 0; k < 10; k++) g.fillRect(10 + k * 10, k % 2 ? 0 : 10, 1, 110, 'block', B.HIGH);
  const t0 = performance.now();
  const p = findPath(g, 2, 2, 118, 118, { maxNodes: g.size });
  const ms = performance.now() - t0;
  assert.ok(p, 'serpentine path found');
  assertWalkable(g, p);
  assert.ok(ms < 250, `took ${ms.toFixed(1)} ms`);
});

test('a ladder foot a clearance mask shuts is the way up, never a way past', () => {
  // a 1-cell corridor (z 10-10.5) between two walls (x 2-18) with a ladder's foot in it, the foot's cell masked (a tank
  // shell's clearance); the ladder goes up to a raised deck at z 12-14 behind the S wall
  const g = new NavGrid(20, 20);
  g.fillRect(2, 9.5, 16, 0.5, 'block', B.HIGH);
  g.fillRect(2, 10.5, 16, 0.5, 'block', B.HIGH);
  for (let j = 24; j < 28; j++) for (let i = 4; i < 36; i++) g.elev[g.idx(i, j)] = 3;
  g.version++;
  const L = g.addLink(LINK.LADDER, { x: 7.75, z: 10.25, y: 0 }, { x: 7.75, z: 12.25, y: 3 });
  const avoid = new Uint8Array(g.size);
  avoid[g.idx(15, 20)] = 1; // the foot's cell
  // up: through the corridor onto the foot, up the ladder
  const up = findPath(g, 3, 10.25, 10, 13, { avoid });
  assert.ok(up && up.some((q) => q.link?.id === L.id), 'the ladder is the way up');
  // past: the corridor is shut at the foot for a walker going by: round the walls, never through the foot's cell
  const past = findPath(g, 3, 10.25, 12, 10.25, { avoid, maxNodes: g.size });
  assert.ok(past, 'a way round');
  assert.ok(!past.some((q) => q.link), 'no ladder on the way past');
  assertWalkable(g, past, { avoid });
  // down: off the ladder's foot and on along the corridor
  const down = findPath(g, 10, 13, 12, 10.25, { avoid, maxNodes: g.size });
  assert.ok(down && down.some((q) => q.link?.id === L.id), 'down the ladder and off its foot');
});

test('warmAreas only fills the area cache: searches answer the same with it or without, and after the grid changes', () => {
  const build = () => {
    const g = new NavGrid(40, 30);
    g.fillRect(20, 0, 1, 30, 'block', B.HIGH); // a wall the whole height: two areas
    g.fillRect(30, 10, 6, 6, 'terrain', T.WATER); // a pond (swimmers only)
    return g;
  };
  const queries = [[2, 2, 35, 20, {}], [2, 2, 10, 25, {}], [25, 2, 33, 13, {}], [25, 2, 33, 13, { swim: true }], [2, 2, 35, 20, { swim: true }]];
  const run = (g) => queries.map(([a, b, c, d, o]) => JSON.stringify(findPath(g, a, b, c, d, o)));
  const cold = build(), warm = build();
  warmAreas(warm, {}); warmAreas(warm, { swim: true }); warmAreas(warm, { role: 'diver', swim: true, noLinks: true });
  assert.deepEqual(run(warm), run(cold));
  assert.equal(run(cold)[0], 'null', 'the wall shuts the east half off');
  // a gap opened after the warm-up (the grid's version moves on): the stale areas are not used
  for (const g of [cold, warm]) { g.fillRect(20, 12, 1, 3, 'block', B.NONE); g.version++; }
  assert.deepEqual(run(warm), run(cold));
  assert.notEqual(run(warm)[0], 'null', 'through the gap');
});

test('rewarmAreas rebuilds the used labellings once the grid holds still, one a call, and searches answer the same', () => {
  const build = () => {
    const g = new NavGrid(40, 30);
    g.fillRect(20, 0, 1, 30, 'block', B.HIGH);
    g.fillRect(30, 10, 6, 6, 'terrain', T.WATER);
    return g;
  };
  const queries = [[2, 2, 35, 20, {}], [25, 2, 33, 13, { swim: true }], [2, 2, 10, 25, { role: 'enemy' }]];
  const run = (g) => queries.map(([a, b, c, d, o]) => JSON.stringify(findPath(g, a, b, c, d, o)));
  const plain = build(), warm = build();
  assert.deepEqual(run(warm), run(plain));
  assert.equal(rewarmAreas(warm), false, 'nothing to build: the labellings are for this grid');
  for (const g of [plain, warm]) { g.fillRect(20, 12, 1, 3, 'block', B.NONE); g.version++; }
  let built = 0;
  for (let n = 0; n < REWARM_AFTER - 1; n++) built += rewarmAreas(warm) ? 1 : 0;
  assert.equal(built, 0, 'not before the grid held still REWARM_AFTER calls');
  for (let n = 0; n < 10; n++) built += rewarmAreas(warm) ? 1 : 0;
  assert.equal(built, 2, 'the two rule sets used (walk, swim), one a call');
  assert.deepEqual(run(warm), run(plain));
  assert.notEqual(run(warm)[0], 'null', 'through the gap');
});

test('a search without the area labelling at hand answers as with it, and counts the same cells searched', () => {
  // west: a big field (more than AREAS_AT cells) and a small pen (fewer); east: the goals, behind a wall none can pass
  const build = () => {
    const g = new NavGrid(80, 40);
    g.fillRect(50, 0, 1, 40, 'block', B.HIGH);
    g.fillRect(0, 30, 6, 1, 'block', B.HIGH); g.fillRect(6, 30, 1, 10, 'block', B.HIGH); // the pen: x < 6, z > 30.5
    return g;
  };
  const queries = [
    [2, 2, 70, 20, {}], // field -> east: past AREAS_AT cells, then the labelling
    [2, 35, 70, 20, {}], // pen -> east: the pen runs dry first
    [2, 2, 45, 38, {}], // field -> field: found
    [2, 35, 3, 31, {}], // pen -> pen: found
    [2, 2, 70, 20, { maxNodes: 500 }], // capped before AREAS_AT
    [2, 2, 70, 20, { memo: 7 }], [2, 2, 70, 20, { memo: 7 }], [30, 20, 70, 5, { memo: 7 }], // remembered failures
  ];
  const one = (g, [a, b, c, d, o]) => { const e0 = searchStats.expanded; const p = findPath(g, a, b, c, d, o); return [JSON.stringify(p), searchStats.expanded - e0]; };
  const run = (g) => queries.map((q) => one(g, q));
  const cold = build(), warm = build();
  assert.ok(cold.size / 2 > AREAS_AT, 'the field outgrows AREAS_AT');
  warmAreas(warm, {});
  // (each query on a grid of its own, no labelling built yet — the remembered failures together, in order)
  let fresh = null;
  const a = queries.map((q, n) => one(n < 5 || n === 5 ? (fresh = build()) : fresh, q)), b = run(warm);
  assert.deepEqual(a, b, 'the same paths, the same cells searched');
  assert.equal(a[0][0], 'null'); assert.equal(a[0][1], 0, 'an unreachable goal costs no search');
  assert.notEqual(a[2][0], 'null'); assert.ok(a[2][1] > 0);
  // and after a change (the stale labelling never used): a gap in the wall
  for (const g of [cold, warm]) { g.fillRect(50, 12, 1, 3, 'block', B.NONE); g.version++; }
  warmAreas(warm, {});
  assert.deepEqual(run(cold), run(warm));
  assert.notEqual(run(cold)[0][0], 'null', 'through the gap');
});
