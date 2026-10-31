/**
 * A diver's searches on the static-layer fast path (pathfinding searchPath, staticLayers' dive layer): the same
 * paths and the same cells expanded as grid.isWalkable's dive rules cell by cell — open water and shallows off a
 * bridge, no structure, no nav stamp, the vehicles when `dynamic`, never the body-clearance mask — and the
 * `underpass` cells read off the grid itself (the deck_underpass set-piece flags them with no new grid version), the
 * dive layer patched on a row-confined change like the others. M18's Marine up the river: 21 -> 12 ms a search.
 *   node tests/unit/run.mjs dive-search
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { findPath, searchStats, staticLayersOf } from '../../src/world/pathfinding.js';

/** A river E-W across the map, a bridge deck over it (girders: B.LOW over the water), a pier, a barge (vehicle). */
function river() {
  const g = new NavGrid(60, 40);
  g.fillRect(0, 16, 60, 9, 'terrain', T.WATER);
  g.fillRect(0, 15, 60, 1, 'terrain', T.SHALLOW);
  g.fillRect(0, 25, 60, 1, 'terrain', T.SHALLOW);
  g.fillRect(28, 15, 4, 11, 'bridge', 1);        // the deck
  g.fillRect(27, 16, 1, 9, 'block', B.LOW);        // its girders, over the water
  g.fillRect(32, 16, 1, 9, 'block', B.LOW);
  g.fillRect(44, 18, 2, 2, 'block', B.HIGH);       // a pier
  return g;
}
/** Every cell of `p` (segment samples) walkable under the dive rules, the way grid.isWalkable answers. */
function diveOk(g, p, opts) {
  for (let s = 1; s < p.length; s++) {
    const a = p[s - 1], b = p[s], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let q = 0; q <= n; q++) { const x = a.x + ((b.x - a.x) * q) / n, z = a.z + ((b.z - a.z) * q) / n; if (!g.isWalkable(Math.floor(x / g.cell), Math.floor(z / g.cell), opts)) return false; }
  }
  return true;
}

test('dive search: the girders shut the river until the set-piece flags them underpass (no new grid version)', () => {
  const g = river(), opts = { swim: true, dive: true, role: 'diver' };
  const p0 = findPath(g, 10, 20, 50, 20, opts);
  assert.equal(p0, null, 'no way past the girders under water');
  // the deck's cells over the water flagged as M16's DeckUnderpass does: no version++
  const v = g.version;
  for (let j = 32; j <= 49; j++) for (let i = 54; i <= 65; i++) g.underpass[j * g.cols + i] = 1;
  assert.equal(g.version, v);
  const e0 = searchStats.expanded, p1 = findPath(g, 10, 20, 50, 20, opts);
  assert.ok(p1 && p1.length >= 2, 'under the deck now');
  assert.ok(searchStats.expanded > e0);
  assert.ok(diveOk(g, p1, { dive: true }), 'every step on a cell the dive rules open');
});

test('dive search: the vehicles count when dynamic, the clearance mask never, a row patch keeps the dive layer whole', () => {
  const g = river(), opts = { swim: true, dive: true, role: 'diver' };
  for (let j = 32; j <= 49; j++) for (let i = 54; i <= 65; i++) g.underpass[j * g.cols + i] = 1;
  // a barge across the whole river E of the bridge: shuts it for a dynamic search only
  for (let j = 15 * 2; j <= 26 * 2; j++) for (let i = 40 * 2; i <= 41 * 2; i++) g.dynamicBlock[j * g.cols + i] = B.HIGH;
  assert.equal(findPath(g, 10, 20, 50, 20, { ...opts, dynamic: true }), null, 'the barge blocks a dynamic dive');
  assert.ok(findPath(g, 10, 20, 50, 20, opts), 'not a static one');
  const avoid = new Uint8Array(g.size).fill(1);
  assert.ok(findPath(g, 10, 20, 50, 20, { ...opts, avoid }), 'a clearance mask is no diver\'s');
  // a row-confined change (the bridge falls: deck cells back to water) patched equals the whole rebuild
  staticLayersOf(g, true);
  for (let j = 30; j <= 51; j++) for (let i = 56; i <= 63; i++) g.bridge[j * g.cols + i] = 0;
  g._bumpRows(30, 51);
  const patched = findPath(g, 10, 20, 50, 20, opts);
  g._dirtyLog = null; g.version++;
  const whole = findPath(g, 10, 20, 50, 20, opts);
  assert.deepEqual(patched, whole);
});
