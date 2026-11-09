/**
 * findPath's reuse of the searches it ran to their goal (world/pathfinding.js `_found`: the last FOUND_MAX of a grid
 * version, any tick, a body-clearance mask equal within the first search's box; `_chains`: their cell chains for other
 * points in the same two cells) changes nothing: every path and every
 * count of cells expanded (the investigate budget's measure) is the one a fresh search gives — a twin world whose grid
 * version is bumped (an empty row range: no layer changes) before each query, so nothing is reused there.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { avoidMask, inflationTiers } from '../../src/world/body-clearance.js';
import { searchStats } from '../../src/world/pathfinding.js';

function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }

for (const id of ['m03', 'm14', 'm20']) {
  test(`${id}: paths reused across ticks and masks are the paths fresh searches find, cells counted the same`, () => {
    const A = headlessMission(id).world, B = headlessMission(id).world;
    const g = A.grid, r = rng(id.length * 104729 + 7);
    const cells = [];
    for (let k = 0; k < g.size; k += 11) { const i = k % g.cols, j = (k - i) / g.cols; if (g.isWalkable(i, j)) cells.push([(i + 0.5) * g.cell, (j + 0.5) * g.cell]); }
    const tiers = inflationTiers('stand');
    const masksA = [null, ...tiers.map((inf) => avoidMask(A, inf, null, false))];
    const masksB = [null, ...tiers.map((inf) => avoidMask(B, inf, null, false))];
    // a query asked again later: the same mask, a copy of it (another object, the same cells), or one with a cell set
    // somewhere (inside the first search's box or not: either way the answer must be a fresh search's)
    const variant = (m, kind, at, W) => {
      if (kind === 0) return m;
      const c = m ? m.slice() : new Uint8Array(W.grid.size);
      // (kind 2: a cell set on the way the first answer went — inside its box — when it found one)
      if (kind === 2 && at) { const i = Math.floor(at.x / W.grid.cell), j = Math.floor(at.z / W.grid.cell); c[j * W.grid.cols + i] = 1; }
      return c;
    };
    const base = [];
    for (let n = 0; n < 40; n++) {
      const a = cells[Math.floor(r() * cells.length)], b = cells[Math.floor(r() * cells.length)];
      base.push([a[0] + r() * 0.4 - 0.2, a[1] + r() * 0.4 - 0.2, b[0] + r() * 0.4 - 0.2, b[1] + r() * 0.4 - 0.2, n % masksA.length]);
    }
    let same = 0, total = 0, found = 0, reasked = 0, moved = 0;
    const firstAt = [];
    const ask = (W, q, mask) => { const e0 = searchStats.expanded; const p = W.findPath(q[0], q[1], q[2], q[3], { role: 'enemy', avoid: mask }); return [JSON.stringify(p), searchStats.expanded - e0, p]; };
    // (each query asked, then again in the next ticks — the same mask, a copy, a copy with a cell of its way shut —
    // while the first answer is still among the kept ones; rounds 4-5: from and to other points of the same two cells,
    // the same mask / a copy: the kept cell chain, smoothed from this query's own points)
    const inCell = (v, d) => { const c = A.grid.cell, b = Math.floor(v / c) * c; return Math.min(b + c - 0.01, Math.max(b + 0.01, v + d)); };
    for (let n = 0; n < base.length; n++) {
      for (let round = 0; round < 6; round++) {
        const q0 = base[n], kind = round < 4 ? (round === 0 ? 0 : round - 1) : round - 4, at = firstAt[n];
        const q = round < 4 ? q0 : [inCell(q0[0], 0.11 * (round - 3)), inCell(q0[1], -0.07), inCell(q0[2], -0.13), inCell(q0[3], 0.09 * (round - 3)), q0[4]];
        A.tick++; B.tick++;
        const pa = ask(A, q, variant(masksA[q[4]], kind, at, A));
        B.grid._bumpRows(1, 0); // (a new version, no row touched: B's next search is fresh)
        const pb = ask(B, q, variant(masksB[q[4]], kind, at, B));
        if (round === 0 && pa[2] && pa[2].length > 2) firstAt[n] = pa[2][Math.floor(pa[2].length / 2)];
        total++; if (round > 0) reasked++;
        if (pa[0] === pb[0] && pa[1] === pb[1]) same++;
        if (pa[2]) found++;
        if (kind === 2 && at && pb[0] !== JSON.stringify(null) && pb[1] > 0) moved++;
      }
    }
    assert.ok(moved > 0, 'some queries asked again with a cell of their way shut');
    assert.equal(same, total, `${total - same} of ${total} answers differ from a fresh search's (path or cells counted)`);
    assert.ok(found > total / 2, `most queries found a path (${found}/${total})`);
    assert.ok(reasked >= 5 * base.length, 'queries asked again in later ticks');
  });
}

test('findPath: a path found is reused in a later tick with a fresh mask equal within its box (no search: the same cells counted)', () => {
  const W = headlessMission('m14').world;
  const tiers = inflationTiers('stand');
  const m1 = avoidMask(W, tiers[0], null, false), m2 = m1 ? m1.slice() : null;
  const q = [20.25, 160.25, 52.25, 45.25];
  W.tick++;
  const e0 = searchStats.expanded, t0 = performance.now();
  const p1 = W.findPath(q[0], q[1], q[2], q[3], { role: 'enemy', avoid: m1 });
  const ms1 = performance.now() - t0, n1 = searchStats.expanded - e0;
  assert.ok(p1 && n1 > 500, `a long search (${n1} cells)`);
  W.tick++;
  const e1 = searchStats.expanded;
  const p2 = W.findPath(q[0], q[1], q[2], q[3], { role: 'enemy', avoid: m2 });
  assert.equal(JSON.stringify(p2), JSON.stringify(p1), 'the same path');
  assert.equal(searchStats.expanded - e1, n1, 'the same cells counted');
  assert.ok(p2 !== p1 && p2[1] !== p1[1], 'its own copy');
  assert.ok(ms1 >= 0);
});
