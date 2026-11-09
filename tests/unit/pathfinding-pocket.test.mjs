/**
 * searchPath's goal-pocket answer (world/pathfinding.js POCKET_AT, goalPocketExcludes / its static-layer copy
 * goalPocketExcludesOpen): a goal walled in by the body-clearance mask — one walk area by the labels, which know no
 * mask — fails at POCKET_AT cells with its few cells enumerated, the same with the mask's ring copied cell for cell, and
 * the vehicles' layer too (a dynamic search); a goal in open ground is no pocket ("wide") and is found.
 */
import { test, assert } from './lib.mjs';
import { NavGrid, B } from '../../src/world/grid.js';
import { findPath, searchStats, POCKET_AT, AREAS_AT } from '../../src/world/pathfinding.js';

function world() {
  const g = new NavGrid(90, 90);
  // a maze of walls between start (SW) and goal (NE): the search runs past AREAS_AT and POCKET_AT before it gets there
  for (let x = 10; x < 80; x += 12) g.fillRect(x, (x / 12) % 2 ? 0 : 10, 1, 80, 'block', B.HIGH);
  return g;
}
const ring = (g, cx, cz, r) => { const m = new Uint8Array(g.size), c = g.cell; for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) { const x = (i + 0.5) * c, z = (j + 0.5) * c, d = Math.max(Math.abs(x - cx), Math.abs(z - cz)); if (d >= r && d < r + 1) m[j * g.cols + i] = 1; } return m; };

test('a goal the mask walls in fails at POCKET_AT, cells counted; open, the same goal is found', () => {
  assert(POCKET_AT > AREAS_AT, 'the pocket check comes after the area check');
  const g = world(), m = ring(g, 84, 84, 3);
  const e0 = searchStats.expanded;
  const p = findPath(g, 3, 3, 84, 84, { avoid: m, memo: 1 });
  const n = searchStats.expanded - e0;
  assert(p === null, 'walled in by the mask: no path');
  assert(n === POCKET_AT, `failed at the pocket check: ${n} cells counted (POCKET_AT ${POCKET_AT})`);
  // the same answer with a copy of the mask (another object, the same cells), and with the vehicles' layer read too
  const e1 = searchStats.expanded;
  const p2 = findPath(g, 3, 3, 84, 84, { avoid: m.slice(), memo: 2, dynamic: true });
  assert(p2 === null && searchStats.expanded - e1 === POCKET_AT, `dynamic, mask copy: the same (${searchStats.expanded - e1})`);
  // negative control: no mask -> no pocket (the goal's pocket is the whole field: "wide"), the path is found
  const p3 = findPath(g, 3, 3, 84, 84, { memo: 3 });
  assert(Array.isArray(p3) && p3.length >= 2, 'open: the path is found');
});
