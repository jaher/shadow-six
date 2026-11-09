/**
 * Area labels brought up to date incrementally (world/pathfinding.js relabelOpened: after row-confined changes that only
 * open cells) give the same areas a full flood gives: a twin world, its grid bumped with a plain version++ (no rows
 * known: a full flood) before each read, compared as partitions of the open cells (labels are compared for equality
 * only). Changes: structures cleared (clearOwner), nav stamps added and taken away, cells opened and shut by fillPoly.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { areaLabelsOf } from '../../src/world/pathfinding.js';
import { B } from '../../src/world/grid.js';

function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }
/** Same partition: a one-to-one map between the two labellings' labels over every cell (0 with 0). */
function samePartition(a, b) {
  const ab = new Map(), ba = new Map();
  for (let k = 0; k < a.length; k++) {
    const x = a[k], y = b[k];
    if ((x === 0) !== (y === 0)) return `cell ${k}: ${x} vs ${y}`;
    if (!x) continue;
    if (ab.has(x) ? ab.get(x) !== y : ba.has(y) && ba.get(y) !== x) return `cell ${k}: label ${x} -> ${ab.get(x)} / ${y}`;
    ab.set(x, y); ba.set(y, x);
  }
  return '';
}

for (const id of ['m03', 'm11', 'm14']) {
  test(`${id}: incremental area labels = a full flood's, after blasts' clears, nav stamps on and off, and shut cells`, () => {
    const A = headlessMission(id).world.grid, Bg = headlessMission(id).world.grid, r = rng(id.charCodeAt(2) * 7717 + 3);
    const rules = [{ role: 'enemy' }, { role: 'greenberet' }, { role: 'diver', swim: true }];
    for (const o of rules) areaLabelsOf(A, o); // (the labellings the changes are joined onto)
    const owners = [...new Set(Array.from(A.owner).filter((x) => x > 0))];
    let steps = 0, incremental = 0;
    for (let n = 0; n < 24; n++) {
      const kind = n % 4, G = [A, Bg];
      if (kind === 0 && owners.length) { const ow = owners.splice(Math.floor(r() * owners.length), 1)[0]; for (const g of G) g.clearOwner(ow); }
      else if (kind === 1) { const k0 = Math.floor(r() * A.size), cells = []; for (let q = 0; q < 40; q++) cells.push(Math.min(A.size - 1, k0 + q)); for (const g of G) g.navStamp(`t${n}`, cells); }
      else if (kind === 2) { for (const g of G) g.navStamp(`t${n - 1}`, []); }
      else { const x = 4 + r() * (A.cols * A.cell - 8), z = 4 + r() * (A.rows * A.cell - 8), poly = [[x, z], [x + 2, z], [x + 2, z + 2], [x, z + 2]]; const v = r() < 0.5 ? B.HIGH : B.NONE; for (const g of G) g.fillPoly(poly, 'block', v, 0); }
      for (const o of rules) {
        const v0 = A.version, la = areaLabelsOf(A, o);
        Bg.version++; // (B: no rows known — a full flood)
        const lb = areaLabelsOf(Bg, o);
        const why = samePartition(la, lb);
        assert.equal(why, '', `${id} step ${n} (${['clear', 'stamp', 'unstamp', 'poly'][kind]}) rules ${JSON.stringify(o)}: ${why}`);
        steps++;
        if (A.dirtyRowsSince(v0 - 1) && la !== lb) incremental++;
      }
    }
    assert.ok(steps >= 60, `${steps} comparisons`);
  });
}
