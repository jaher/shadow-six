import { test, assert, near } from './lib.mjs';
import { NavGrid, B, T, CELL, terrainCode } from '../../src/world/grid.js';

function wallGrid() {
  const g = new NavGrid(20, 20);
  g.fillRect(10, 0, 1, 20, 'block', B.HIGH, 7); // vertical wall x ∈ [10, 11)
  return g;
}

test('grid: dimensions & coordinates', () => {
  const g = new NavGrid(10, 6);
  assert.equal(g.cols, 10 / CELL);
  assert.equal(g.rows, 6 / CELL);
  assert.deepEqual(g.worldToCell(1.2, 0.7), { i: 2, j: 1 });
  assert.deepEqual(g.cellCenter(2, 1), { x: 1.25, z: 0.75 });
  assert.ok(!g.inBounds(-1, 0) && !g.inBounds(0, g.rows));
  assert.equal(terrainCode('water'), T.WATER);
});

test('grid: fillRect / fillOrientedRect / fillCircle / fillLine / clearOwner', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(2, 2, 2, 1, 'block', B.LOW, 3);
  assert.equal(g.blockAt(2.1, 2.1), B.LOW);
  assert.equal(g.blockAt(3.9, 2.9), B.LOW);
  assert.equal(g.blockAt(4.1, 2.1), B.NONE);
  g.fillOrientedRect(10, 10, 4, 1, Math.PI / 2, 'block', B.HIGH, 4); // long side along Z
  assert.equal(g.blockAt(10.1, 11.7), B.HIGH);
  assert.equal(g.blockAt(11.7, 10.1), B.NONE);
  g.fillCircle(15, 5, 1, 'block', B.HIGH, 5);
  assert.equal(g.blockAt(15, 5), B.HIGH);
  assert.equal(g.blockAt(16.5, 5), B.NONE);
  g.fillLine([[1, 15], [8, 15]], 0.5, 'block', B.FENCE, 6);
  assert.equal(g.blockAt(4, 15.1), B.FENCE);
  assert.ok(g.clearOwner(4) > 0);
  assert.equal(g.blockAt(10.1, 11.7), B.NONE);
  assert.equal(g.blockAt(15, 5), B.HIGH);
});

test('grid: walkability — water, shallow, bridge, swim', () => {
  const g = new NavGrid(10, 10);
  g.fillRect(0, 4, 10, 2, 'terrain', T.WATER);
  g.fillRect(0, 3, 10, 1, 'terrain', T.SHALLOW);
  g.fillRect(4, 4, 2, 2, 'bridge', 1);
  const c = (x, z) => g.worldToCell(x, z);
  let p = c(1, 5);
  assert.ok(!g.isWalkable(p.i, p.j));
  assert.ok(g.isWalkable(p.i, p.j, { swim: true }));
  assert.ok(g.isWater(p.i, p.j));
  p = c(5, 5);
  assert.ok(g.isWalkable(p.i, p.j), 'bridge deck walkable');
  assert.ok(!g.isWater(p.i, p.j));
  p = c(1, 3.5);
  assert.ok(g.isWalkable(p.i, p.j), 'shallow walkable');
});

test('LOS: HIGH blocks everyone, even elevated viewers', () => {
  const g = wallGrid();
  assert.equal(g.lineOfSight(5, 5, 15, 5), false);
  assert.equal(g.lineOfSight(5, 5, 15, 5, { viewerElevated: true }), false);
  assert.equal(g.lineOfSight(5, 5, 8, 12), true);
});

test('LOS: LOW hides crawling targets from ground viewers only', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(10, 0, 0.5, 20, 'block', B.LOW);
  assert.equal(g.lineOfSight(5, 5, 15, 5), true, 'standing target seen over sandbags');
  assert.equal(g.lineOfSight(5, 5, 15, 5, { targetLow: true }), false, 'crawling target hidden');
  assert.equal(g.lineOfSight(5, 5, 15, 5, { targetLow: true, viewerElevated: true }), true, 'elevated viewer sees crawler');
});

test('LOS: FENCE never blocks sight', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(10, 0, 0.5, 20, 'block', B.FENCE);
  assert.equal(g.lineOfSight(5, 5, 15, 5, { targetLow: true }), true);
});

test('LOS: endpoint cells are excluded', () => {
  const g = new NavGrid(20, 20);
  g.fillRect(5, 5, 0.5, 0.5, 'block', B.HIGH);
  g.fillRect(15, 5, 0.5, 0.5, 'block', B.HIGH);
  assert.equal(g.lineOfSight(5.2, 5.2, 15.2, 5.2), true);
});

test('LOS: exact diagonal through a wall corner is blocked', () => {
  const g = new NavGrid(10, 10);
  // Two blocks touching at a corner: cell (4,5) and (5,4). The diagonal line passes through the corner (2.5, 2.5)*…
  g.fillRect(2.0, 2.5, 0.5, 0.5, 'block', B.HIGH); // cell (4,5)
  g.fillRect(2.5, 2.0, 0.5, 0.5, 'block', B.HIGH); // cell (5,4)
  assert.equal(g.lineOfSight(1.25, 3.75, 3.75, 1.25), false);
});

test('castRay: distance to first HIGH cell and map edge', () => {
  const g = wallGrid();
  near(g.castRay(5, 5, 0, 20), 5, 1e-6); // wall face at x = 10
  near(g.castRay(5, 5, Math.PI, 20), 5, 1e-6); // map edge at x = 0
  near(g.castRay(5, 5, Math.PI / 2, 4), 4, 1e-6); // capped
  const g2 = new NavGrid(20, 20);
  g2.fillRect(8, 0, 0.5, 20, 'block', B.LOW);
  near(g2.castRay(5, 5, 0, 10), 10, 1e-6, 'LOW does not stop cone rays');
  const d = g.castRay(5, 5, Math.PI / 4, 30);
  near(d, 5 * Math.SQRT2, 1e-6);
});

test('nearestWalkable', () => {
  const g = wallGrid();
  const n = g.nearestWalkable(10.4, 5.1, 3);
  assert.ok(n);
  assert.ok(Math.abs(n.x - 10.4) <= 0.8);
  assert.equal(g.blockAt(n.x, n.z), B.NONE);
  const g2 = new NavGrid(10, 10);
  g2.fillRect(0, 0, 10, 10, 'block', B.HIGH);
  assert.equal(g2.nearestWalkable(5, 5, 3), null);
});

test('walkableLine respects blocks and water', () => {
  const g = wallGrid();
  assert.equal(g.walkableLine(5, 5, 15, 5), false);
  assert.equal(g.walkableLine(5, 5, 8, 15), true);
  g.fillRect(0, 17, 10, 2, 'terrain', T.WATER);
  assert.equal(g.walkableLine(2, 16, 2, 19.5), false);
  assert.equal(g.walkableLine(2, 16, 2, 19.5, { swim: true }), true);
});
