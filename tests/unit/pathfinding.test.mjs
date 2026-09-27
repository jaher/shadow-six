import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { findPath, pathLength } from '../../src/world/pathfinding.js';

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
