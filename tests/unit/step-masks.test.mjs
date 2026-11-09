/**
 * pathfinding's step masks (staticLayers' nb: a byte a cell — which of its eight neighbours the static walk layer
 * opens and a step reaches, a diagonal's two edge cells included) equal the grid's own tests cell by cell, on grids
 * with height (plateaus, graded ramps, a stair run's head-on rule), water and walls; patched over the rows a change
 * touched they equal a whole rebuild. And findPath's cell chains carried over a grid change that lies away from what
 * a search read answer as a fresh search does (a twin grid, no cache), and are dropped when the change is beside it.
 *   node tests/unit/run.mjs step-masks
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B, T } from '../../src/world/grid.js';
import { stepMasksFor, findPath, searchStats, reuseStats } from '../../src/world/pathfinding.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/** A grid with walls, water, plateaus (a step up, a wall up), graded ramps and a stair run over one. */
function hilly(seed) {
  const g = new NavGrid(36, 28), r = rng(seed), c = g.cell;
  for (let n = 0; n < 8; n++) g.fillRect(r() * 32, r() * 24, 0.5 + r() * 3, 0.5 + r() * 3, 'block', B.HIGH, 100 + n);
  g.fillRect(4 + r() * 8, 4 + r() * 8, 4, 3, 'terrain', T.WATER);
  for (const h of [0.3, 0.5, 1.4, 2.5]) g.fillRect(r() * 30, r() * 22, 2 + r() * 5, 2 + r() * 5, 'elev', h);
  const i0 = 20, j0 = 6;
  for (let s = 0; s < 10; s++) for (let w = 0; w < 3; w++) g.elev[(j0 + w) * g.cols + i0 + s] = (s + 1) * 0.3;
  g.version++;
  g.addRun({ pts: [[i0 * c, (j0 + 1.5) * c], [(i0 + 10) * c, (j0 + 1.5) * c]], w: 3 * c, lane: 2 * c });
  return g;
}
/** The masks by the grid's own tests: the neighbour on the map, walkable (static: no vehicles, no mask), a step there
 * (grid.canStep: height, a run's sides); a diagonal's two edge neighbours too. */
function brute(g, swim) {
  const out = new Uint8Array(g.size);
  const ok = (k, i, j) => g.inBounds(i, j) && g.isWalkable(i, j, { swim }) && g.canStep(k, j * g.cols + i);
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const k = j * g.cols + i;
    let m = 0;
    for (let d = 0; d < 8; d++) {
      if (!ok(k, i + DI[d], j + DJ[d])) continue;
      if (d >= 4 && (!ok(k, i + DI[d], j) || !ok(k, i, j + DJ[d]))) continue;
      m |= 1 << d;
    }
    out[k] = m;
  }
  return out;
}
const diff = (a, b) => { let n = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) n++; return n; };

test('step masks: the grid\'s own walk and step tests, cell by cell (height, ramps, a stair run, water)', () => {
  for (const seed of [1, 2, 3, 4]) {
    const g = hilly(seed);
    for (const swim of [false, true]) assert.equal(diff(stepMasksFor(g, swim), brute(g, swim)), 0, `seed ${seed} swim ${swim}`);
  }
});

test('step masks: patched over the rows a change touched equal a whole rebuild', () => {
  for (const seed of [5, 6, 7]) {
    const g = hilly(seed), r = rng(seed * 13);
    stepMasksFor(g, false); stepMasksFor(g, true);
    for (let n = 0; n < 25; n++) {
      const x = r() * 32, z = r() * 24;
      if (r() < 0.5) g.fillPoly([[x, z], [x + 3, z], [x + 1.5, z + 2.5]], 'block', r() < 0.6 ? B.HIGH : B.NONE);
      else g.navStamp(`s${n % 4}`, Array.from({ length: 5 }, () => (r() * g.size) | 0));
      const p0 = stepMasksFor(g, false).slice(), p1 = stepMasksFor(g, true).slice();
      g._dirtyLog = null; g.version++; // (a whole rebuild next)
      assert.equal(diff(p0, stepMasksFor(g, false)), 0, `seed ${seed} step ${n}: on foot`);
      assert.equal(diff(p1, stepMasksFor(g, true)), 0, `seed ${seed} step ${n}: swimming`);
      assert.equal(diff(p0, brute(g, false)), 0, `seed ${seed} step ${n}: the grid's own tests`);
    }
  }
});

/** The same grid twice: one searched with findPath's caches across its changes, one rebuilt for each search (none). */
function twins() {
  const make = () => {
    const g = new NavGrid(60, 40);
    g.fillRect(20, 0, 1, 30, 'block', B.HIGH); g.fillRect(40, 10, 1, 30, 'block', B.HIGH);
    for (let n = 0; n < 6; n++) g.fillRect(4 + n * 9, 34, 2, 2, 'block', B.HIGH);
    return g;
  };
  return make;
}
function search(g, from, to) {
  const e0 = searchStats.expanded, p = findPath(g, from[0], from[1], to[0], to[1], { role: 'enemy', memo: 1 });
  return `${JSON.stringify(p)} +${searchStats.expanded - e0}`;
}

test('chain reuse across grid versions: carried when the change lies away from the search, dropped beside it', () => {
  const make = twins(), g = make(), writes = [];
  const fresh = (from, to) => { const t = make(); for (const w of writes) w(t); return search(t, from, to); };
  const A = [5.2, 5.2], A2 = [5.4, 5.3], G = [55.2, 12.3]; // (A2: another point in A's cell)
  assert.equal(search(g, A, G), fresh(A, G), 'first search');
  // a change far from what the search read (the map's bottom right corner, below the second wall's foot): row-confined
  const far = (t) => { for (let i = 100; i < 120; i++) t._write(78 * t.cols + i, t.block, B.HIGH); t._bumpRows(78, 78); };
  far(g); writes.push(far);
  const c0 = reuseStats.chain;
  assert.equal(search(g, A2, G), fresh(A2, G), 'after a far change: the same answer as a fresh search');
  assert.equal(reuseStats.chain, c0 + 1, 'the chain was carried over the far change');
  // a change on the route: the chain is dropped, the search runs again
  const near = (t) => { const j = Math.floor(5.2 / t.cell); for (let i = 30; i < 34; i++) t._write(j * t.cols + i, t.block, B.HIGH); t._bumpRows(j, j); };
  near(g); writes.push(near);
  const c1 = reuseStats.chain;
  assert.equal(search(g, A, G), fresh(A, G), 'after a change beside the route: the same answer as a fresh search');
  assert.equal(reuseStats.chain, c1, 'no chain carried over a change beside the route');
  // a plain bump (a writer's own version++): nothing carried
  g.version++; writes.push((t) => { t.version++; });
  const c2 = reuseStats.chain;
  assert.equal(search(g, A2, G), fresh(A2, G), 'after a plain bump');
  assert.equal(reuseStats.chain, c2, 'nothing carried over a plain bump');
});
