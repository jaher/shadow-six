/**
 * World.findPath's per-tick answers to repeated queries change nothing: every path is the one a fresh search finds
 * (sol/m20 performance: an alarm sends a score of guards across the castle in one tick).
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { avoidMask, inflationTiers } from '../../src/world/body-clearance.js';

function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }

for (const id of ['m03', 'm11', 'm20']) {
  test(`${id}: paths answered from the tick's memo are the paths fresh searches find`, () => {
    const { world: w } = headlessMission(id);
    const g = w.grid, r = rng(id.length * 7919 + 17);
    const cells = [];
    for (let k = 0; k < g.size; k += 7) { const i = k % g.cols, j = (k - i) / g.cols; if (g.isWalkable(i, j)) cells.push([(i + 0.5) * g.cell, (j + 0.5) * g.cell]); }
    const masks = [null, ...inflationTiers('stand').map((inf) => avoidMask(w, inf, null, false))];
    const queries = [];
    for (let n = 0; n < 60; n++) {
      const a = cells[Math.floor(r() * cells.length)], b = cells[Math.floor(r() * cells.length)];
      queries.push([a[0] + r() * 0.4 - 0.2, a[1] + r() * 0.4 - 0.2, b[0] + r() * 0.4 - 0.2, b[1] + r() * 0.4 - 0.2, { role: 'enemy', lying: n % 5 === 0, avoid: masks[n % masks.length] }]);
    }
    // (each fresh search in a tick of its own: nothing remembered; then all of them twice in one tick)
    const fresh = queries.map(([a, b, c, d, o]) => { w.tick++; return JSON.stringify(w.findPath(a, b, c, d, o)); });
    w.tick++;
    const first = queries.map(([a, b, c, d, o]) => JSON.stringify(w.findPath(a, b, c, d, o)));
    const warm = queries.map(([a, b, c, d, o]) => JSON.stringify(w.findPath(a, b, c, d, o)));
    let same = 0;
    for (let n = 0; n < fresh.length; n++) if (fresh[n] === first[n] && fresh[n] === warm[n]) same++;
    assert.equal(same, fresh.length, `${fresh.length - same} of ${fresh.length} paths differ`);
    assert.ok(fresh.filter((p) => p !== 'null').length > 20, 'most queries found a path');
  });
}

test('World.findPath: a query repeated in the same tick gets the same path, its own copy', () => {
  const { world: w } = headlessMission('m20');
  const a = w.findPath(20, 75, 60, 77, { role: 'enemy' }), b = w.findPath(20, 75, 60, 77, { role: 'enemy' });
  assert.ok(a && b, 'a path');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a !== b && a[1] !== b[1], 'not shared');
  b[1].x = -1;
  assert.notEqual(w.findPath(20, 75, 60, 77, { role: 'enemy' })[1].x, -1, 'a caller changing his copy changes nothing for the next');
});
