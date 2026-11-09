/**
 * world/pathfinding.js warmSearchCode (Game's idle warm, once a page): the search's rarely run parts run before its
 * optimized code is made — and nothing a search answers changes: the grid as it was (version, layers), no cells left
 * counted on searchStats (the investigate budget's measure), and every path and count a twin world without the warm-up
 * gives.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { avoidMask, inflationTiers } from '../../src/world/body-clearance.js';
import { searchStats, warmSearchCode } from '../../src/world/pathfinding.js';

function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }
const sig = (g) => { let h = 0; for (const L of [g.block, g.navBlock, g.terrain, g.bridge, g.elev]) if (L) for (let k = 0; k < L.length; k += 7) h = (h * 31 + (L[k] * 1000 | 0)) | 0; return h; };

test('m14: the search-code warm-up leaves the grid, the counts and every answer as they were', () => {
  const A = headlessMission('m14').world, B = headlessMission('m14').world;
  const v0 = A.grid.version, s0 = sig(A.grid), e0 = searchStats.expanded;
  warmSearchCode(A.grid);
  assert(A.grid.version === v0, `grid version unchanged (${v0} -> ${A.grid.version})`);
  assert(sig(A.grid) === s0, 'grid layers unchanged');
  assert(searchStats.expanded === e0, `no cells left counted (${searchStats.expanded - e0})`);
  const g = A.grid, r = rng(1408);
  const cells = [];
  for (let k = 0; k < g.size; k += 13) { const i = k % g.cols, j = (k - i) / g.cols; if (g.isWalkable(i, j)) cells.push([(i + 0.5) * g.cell, (j + 0.5) * g.cell]); }
  const tiers = inflationTiers('stand');
  const mA = [null, ...tiers.map((inf) => avoidMask(A, inf, null, false))], mB = [null, ...tiers.map((inf) => avoidMask(B, inf, null, false))];
  let same = 0, found = 0;
  const N = 60;
  for (let n = 0; n < N; n++) {
    const a = cells[Math.floor(r() * cells.length)], b = cells[Math.floor(r() * cells.length)], t = n % mA.length;
    const ask = (W, m) => { const c0 = searchStats.expanded; const p = W.findPath(a[0], a[1], b[0], b[1], { role: 'enemy', avoid: m || undefined }); return [JSON.stringify(p), searchStats.expanded - c0, !!p]; };
    const x = ask(A, mA[t]), y = ask(B, mB[t]);
    if (x[0] === y[0] && x[1] === y[1]) same++;
    if (x[2]) found++;
  }
  assert(same === N, `${same}/${N} answers and counts the same as the twin's (${found} paths found)`);
  assert(found > N / 3, `enough paths found to compare (${found})`);
});
