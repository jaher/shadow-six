/**
 * pathfinding's per-version static layers (open cells, step cost factors) redone only on the rows a grid change
 * touched (NavGrid._bumpRows / dirtyRowsSince: clearOwner, navStamp, overStamp, fillPoly — a blast's tick) equal a
 * whole rebuild; a writer's own version++ in between falls back to the whole rebuild.
 *   node tests/unit/run.mjs static-layers
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { staticLayersOf } from '../../src/world/pathfinding.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function world(seed) {
  const g = new NavGrid(40, 30), r = rng(seed);
  g.fillRect(10, 5, 6, 3, 'terrain', T.WATER);
  g.fillRect(12, 5, 1, 3, 'bridge', 1);
  g.fillRect(20, 20, 4, 2, 'terrain', T.SHALLOW);
  for (let n = 0; n < 12; n++) g.fillRect(r() * 36, r() * 26, 0.5 + r() * 3, 0.5 + r() * 3, 'block', 1 + ((r() * 3) | 0), 100 + n);
  g.navStamp('a', [5 * g.cols + 7, 5 * g.cols + 8, 30 * g.cols + 40]);
  return g;
}
/** The layers of a whole rebuild (the log dropped, the version bumped: the next patch starts from these). */
function fresh(g) {
  g._dirtyLog = null; g.version++;
  return { o0: staticLayersOf(g, false).open[0].slice(), o1: staticLayersOf(g, true).open[1].slice(), mul: staticLayersOf(g, false).mul.slice() };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('static layers: a row-confined change patched equals the whole rebuild', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = world(seed), r = rng(seed * 7);
    staticLayersOf(g, false); staticLayersOf(g, true);
    const steps = [
      () => g.clearOwner(100 + ((r() * 12) | 0)),
      () => g.navStamp('b' + ((r() * 3) | 0), Array.from({ length: 6 }, () => (r() * g.size) | 0)),
      () => g.navStamp('a', []),
      () => g.overStamp('o', new Map([[(r() * g.size) | 0, [1, 2]]])),
      () => { const x = r() * 34, z = r() * 24; g.fillPoly([[x, z], [x + 4, z], [x + 2, z + 3]], 'block', B.HIGH, 300); },
      () => { const x = r() * 34, z = r() * 24; g.fillPoly([[x, z], [x + 3, z], [x + 3, z + 3], [x, z + 3]], 'block', B.NONE); },
    ];
    for (let n = 0; n < 30; n++) {
      const v0 = g.version;
      const k = 1 + ((r() * 3) | 0);
      for (let q = 0; q < k; q++) steps[(r() * steps.length) | 0]();
      const known = g.dirtyRowsSince(v0);
      assert.ok(g.version === v0 || known, `seed ${seed} step ${n}: rows known for a writer's own bumps`);
      const P = { o0: staticLayersOf(g, false).open[0], o1: staticLayersOf(g, true).open[1], mul: staticLayersOf(g, false).mul }, F = fresh(g);
      assert.ok(same(P.o0, F.o0) && same(P.o1, F.o1) && same(P.mul, F.mul), `seed ${seed} step ${n}: patched layers = whole rebuild`);
    }
  }
});

test('static layers: an outside version++ (a raw layer write) is not patched over', () => {
  const g = world(9);
  const v0 = g.version;
  staticLayersOf(g, false);
  g.clearOwner(100);
  g.block[3 * g.cols + 3] = B.HIGH; g.version++; // a writer of its own (tests, scripts)
  g.navStamp('c', [10]);
  assert.equal(g.dirtyRowsSince(v0), null, 'the raw write breaks the log');
  assert.equal(staticLayersOf(g, false).open[0][3 * g.cols + 3], 0, 'the raw-written cell is closed');
  assert.ok(g.dirtyRowsSince(g.version - 1), 'the log starts afresh after it');
});

test('static layers: a search running on the old layers keeps them (patched on copies)', () => {
  const g = world(11);
  const L = staticLayersOf(g, false), o = L.open[0], m = L.mul, before = o.slice();
  g.clearOwner(101);
  const L2 = staticLayersOf(g, false);
  assert.ok(L2.open[0] !== o && L2.mul !== m, 'new arrays');
  assert.ok(same(o, before), 'the old open layer untouched');
});
