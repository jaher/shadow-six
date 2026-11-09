/**
 * world/path-warm.js (a chapter card keeps the blast's path code compiled): it runs on a scratch copy of the mission's
 * grid — the mission's grid, its version, its dirty log, its per-version caches and the search count are as they were,
 * and the searches made after it answer as without it.
 *   node tests/unit/run.mjs path-warm
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B } from '../../src/world/grid.js';
import { findPath, searchStats, staticLayersOf } from '../../src/world/pathfinding.js';
import { warmBlastPaths, blastPathTasks } from '../../src/world/path-warm.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function scene(seed) {
  const g = new NavGrid(40, 30), r = rng(seed);
  for (let n = 0; n < 14; n++) g.fillRect(2 + r() * 34, 2 + r() * 24, 0.5 + r() * 4, 0.5 + r() * 3, 'block', B.HIGH, 100 + n);
  g.navStamp('n', [5 * g.cols + 7, 9 * g.cols + 30]);
  const men = Array.from({ length: 8 }, (_, i) => ({ x: 1 + r() * 37, z: 1 + r() * 27, alive: true, removed: false, pathQuery: () => ({ role: i % 2 ? 'enemy' : 'greenberet' }) }));
  return { grid: g, enemies: men.slice(0, 6), commandos: men.slice(6) };
}
const snap = (g) => ({ v: g.version, log: JSON.stringify(g._dirtyLog), arrays: ['block', 'navBlock', 'terrain', 'bridge', 'elev', 'owner'].map((k) => Array.from(g[k]).join(',')).join('|') });

test('path-warm: the mission grid untouched, the search count put back, the same answers after', () => {
  for (const seed of [1, 2, 3]) {
    const w = scene(seed), ref = scene(seed);
    staticLayersOf(w.grid, false); staticLayersOf(ref.grid, false);
    const before = snap(w.grid), e0 = searchStats.expanded;
    assert.equal(warmBlastPaths(w), true);
    assert.equal(searchStats.expanded, e0, 'search count put back');
    assert.deepEqual(snap(w.grid), before, 'grid, version and dirty log as they were');
    const r = rng(seed * 11);
    for (let n = 0; n < 30; n++) {
      const a = [r() * 39, r() * 29], b = [r() * 39, r() * 29], o = { role: n % 2 ? 'enemy' : 'greenberet', memo: n };
      const s0 = searchStats.expanded, p = findPath(w.grid, a[0], a[1], b[0], b[1], o), d = searchStats.expanded - s0;
      const s1 = searchStats.expanded, q = findPath(ref.grid, a[0], a[1], b[0], b[1], o), d2 = searchStats.expanded - s1;
      assert.equal(JSON.stringify(p), JSON.stringify(q), `seed ${seed} search ${n}: the same path`);
      assert.equal(d, d2, `seed ${seed} search ${n}: the same cells counted`);
    }
  }
});

test('path-warm tasks: small steps; a change to the mission grid between them, or cancel(), ends the rest untouched', () => {
  for (const seed of [4, 5]) {
    // all of them, one by one: every task does its work, nothing of the mission changes
    const w = scene(seed), T = blastPathTasks(w), before = snap(w.grid), e0 = searchStats.expanded;
    assert(T.length >= 12, `split in small tasks (${T.length})`);
    for (const t of T) t();
    assert.equal(T.ran(), T.length - 1, 'every task but the last (the copy let go) did its work');
    assert.equal(searchStats.expanded, e0, 'search count put back');
    assert.deepEqual(snap(w.grid), before, 'grid untouched');
    // the mission's grid changes after the copy: the rest do nothing
    const w2 = scene(seed), T2 = blastPathTasks(w2);
    for (let i = 0; i < 3; i++) T2[i]();
    assert.equal(T2.ran(), 3, 'the copy and two layers');
    w2.grid.navStamp('door', [3 * w2.grid.cols + 4]);
    const after = snap(w2.grid);
    for (let i = 3; i < T2.length; i++) T2[i]();
    assert.equal(T2.ran(), 3, 'nothing after the change');
    assert.deepEqual(snap(w2.grid), after, 'the changed grid left as it is');
    // cancel(): a newer card's warm-up supersedes it
    const w3 = scene(seed), T3 = blastPathTasks(w3);
    T3[0](); T3.cancel();
    for (const t of T3) t();
    assert.equal(T3.ran(), 1, 'nothing after cancel()');
  }
});
