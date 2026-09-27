import { test, assert, near } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { findPath, pathLength } from '../../src/world/pathfinding.js';

test('start == goal returns a trivial path', () => {
  const g = new NavGrid(10, 10);
  const p = findPath(g, 3.2, 4.1, 3.2, 4.1);
  assert.ok(p && p.length >= 1 && p.length <= 2);
  near(p[p.length - 1].x, 3.2); near(p[p.length - 1].z, 4.1);
});

test('start and goal in the same cell', () => {
  const g = new NavGrid(10, 10);
  const p = findPath(g, 3.1, 3.1, 3.4, 3.4);
  assert.ok(p);
  near(p[p.length - 1].x, 3.4); near(p[p.length - 1].z, 3.4);
});

test('paths along and to map borders stay in bounds', () => {
  const g = new NavGrid(10, 6);
  const p = findPath(g, 0.1, 0.1, 9.9, 5.9);
  assert.ok(p);
  for (const q of p) assert.ok(q.x >= 0 && q.x < 10 && q.z >= 0 && q.z < 6, `in bounds ${q.x},${q.z}`);
});

test('goal outside the map clamps to nearest walkable or null, never throws', () => {
  const g = new NavGrid(10, 10);
  const p = findPath(g, 5, 5, 10.2, 5);
  if (p) { const e = p[p.length - 1]; assert.ok(e.x < 10 && e.x >= 0); }
  assert.equal(findPath(g, 5, 5, 50, 50), null);
});

test('goal fully enclosed by walls is unreachable → null', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(8, 8, 6, 0.5, 'block', B.HIGH);
  g.fillRect(8, 13.5, 6, 0.5, 'block', B.HIGH);
  g.fillRect(8, 8, 0.5, 6, 'block', B.HIGH);
  g.fillRect(13.5, 8, 0.5, 6, 'block', B.HIGH);
  assert.equal(findPath(g, 2, 2, 11, 11), null);
});

test('diagonal step between two diagonally touching blocks is refused', () => {
  const g = new NavGrid(4, 4);
  // Wall of alternating diagonal cells; no orthogonal gap → blocked
  for (let k = 0; k < 8; k++) g.block[g.idx(k, 7 - k)] = B.HIGH;
  assert.equal(findPath(g, 0.2, 0.2, 3.8, 3.8), null);
});

test('diagonal path is octile-optimal in open ground', () => {
  const g = new NavGrid(20, 20);
  const p = findPath(g, 1.25, 1.25, 11.25, 11.25);
  near(pathLength(p), Math.hypot(10, 10), 0.05);
});

test('shallow water walkable, deep water not, bridge over deep water walkable', () => {
  const g = new NavGrid(10, 10);
  g.fillRect(0, 4, 10, 2, 'terrain', T.WATER);
  const { i, j } = g.worldToCell(4.6, 4.2);
  assert.equal(g.isWalkable(i, j), false);
  assert.equal(g.isWalkable(i, j, { swim: true }), true);
  g.fillRect(4, 4, 1, 2, 'bridge', 1);
  assert.equal(g.isWalkable(i, j), true);
  g.fillRect(0, 4, 3, 2, 'terrain', T.SHALLOW);
  const { i: a, j: b } = g.worldToCell(1, 5);
  assert.equal(g.isWalkable(a, b), true);
});

test('LOS: out-of-bounds endpoints do not throw; diagonal across map is clear', () => {
  const g = new NavGrid(10, 10);
  assert.equal(g.lineOfSight(0.1, 0.1, 9.9, 9.9), true);
  assert.doesNotThrow(() => g.lineOfSight(-5, -5, 15, 15));
});

test('LOS: symmetric around HIGH blocks', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(9, 5, 1, 1, 'block', B.HIGH);
  for (const [ax, az, bx, bz] of [[2, 5.5, 18, 5.5], [2, 2, 18, 9], [9.5, 1, 9.5, 19]]) {
    assert.equal(g.lineOfSight(ax, az, bx, bz), g.lineOfSight(bx, bz, ax, az));
  }
  assert.equal(g.lineOfSight(2, 5.5, 18, 5.5), false);
});

test('LOS: LOW cover — elevated viewer sees crawler, standing target visible', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(9, 0, 1, 20, 'block', B.LOW);
  assert.equal(g.lineOfSight(2, 5, 18, 5, { targetLow: true }), false);
  assert.equal(g.lineOfSight(2, 5, 18, 5, { targetLow: true, viewerElevated: true }), true);
  assert.equal(g.lineOfSight(2, 5, 18, 5), true);
});

test('castRay clamps to maxDist in open ground and stops at walls', () => {
  const g = new NavGrid(40, 40);
  near(g.castRay(20, 20, 0, 5), 5, 1e-6);
  g.fillRect(25, 0, 1, 40, 'block', B.HIGH);
  const d = g.castRay(20, 20, 0, 15);
  assert.ok(d >= 4.5 && d <= 5.01, `wall at ~5 m, got ${d}`);
  assert.ok(g.castRay(20, 20, Math.PI, 15) <= 15);
});

test('clearOwner reopens cells (destroyed structure / cut fence)', () => {
  const g = new NavGrid(10, 10);
  g.fillRect(4, 0, 1, 10, 'block', B.FENCE, 7);
  assert.equal(findPath(g, 1, 5, 8, 5), null);
  g.clearOwner(7);
  assert.ok(findPath(g, 1, 5, 8, 5));
});
