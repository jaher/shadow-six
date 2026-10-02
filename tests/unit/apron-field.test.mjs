/**
 * Apron code field (world/apron-field.js; user request 2026-09-30 "never see the boundaries of the map … make it
 * wider on all levels"): the scenery past the edges continues the map — the M2 river flows on beyond both edges along
 * its own direction, the M1 fjord and coast road leave the map, M3's reservoir fills its corner and the river goes on
 * past the SE corner; the map's own codes are copied verbatim and the nav grid is untouched.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { T } from '../../src/world/grid.js';
import { buildApronField, extendPath } from '../../src/world/apron-field.js';
import { CONFIG } from '../../src/config.js';

const wet = (c) => c === T.WATER || c === T.SHALLOW;
const A = CONFIG.apron.width;
const cache = new Map();
const field = (id) => {
  if (!cache.has(id)) {
    const ctx = loadGrid(getMission(id));
    const before = ctx.grid.terrain.slice(), blockBefore = ctx.grid.block.slice();
    const f = buildApronField(ctx.grid, ctx.def);
    cache.set(id, { ...ctx, f, before, blockBefore });
  }
  return cache.get(id);
};

test('extendPath: ends at / past an edge continue along the end direction, inner ends stay', () => {
  const e = extendPath([[0, 10], [10, 20], [20, 20]], [4, 5, 6], 50, 50, 3, 30);
  assert.equal(e.points.length, 4);
  assert.ok(e.points[0][0] < -20 && e.points[0][1] < -10, `west end extended NW: ${e.points[0]}`);
  assert.deepEqual(e.widths, [4, 4, 5, 6]);
  const f = extendPath([[10, 10], [20, 20]], null, 50, 50, 3, 30);
  assert.equal(f.points.length, 2, 'an inner path is unchanged');
});

test('apron field: the map is copied verbatim and the nav grid is untouched (M1–M3, sandboxes)', () => {
  for (const id of ['m00', 'b00', 'm01', 'm02', 'm03']) {
    let ctx;
    try { ctx = field(id); } catch (e) { if (/unknown|not found/i.test(String(e))) continue; throw e; }
    const { grid, f, before, blockBefore } = ctx, ic = Math.round(f.A / grid.cell);
    assert.deepEqual(grid.terrain, before, `${id}: grid terrain unchanged`);
    assert.deepEqual(grid.block, blockBefore, `${id}: grid block unchanged`);
    for (let j = 0; j < grid.rows; j += 7) for (let i = 0; i < grid.cols; i += 5) {
      assert.equal(f.grid.terrain[(j + ic) * f.grid.cols + i + ic], grid.terrain[j * grid.cols + i], `${id}: cell ${i},${j}`);
    }
    assert.equal(f.grid.width, grid.width + 2 * A);
  }
});

test('apron field: the M2 river flows on beyond both edges along its own course', () => {
  const { f } = field('m02');
  // west edge: the river enters heading SE, so past the edge it continues to the NW
  const westRows = [];
  for (let z = 0; z <= 120; z += 1) if (wet(f.codeAt(-1, z))) westRows.push(z);
  assert.ok(westRows.length >= 18, `river crosses the west edge (${westRows.length} m wet)`);
  const zMid = westRows[(westRows.length / 2) | 0];
  let far = 0;
  for (let z = -A; z <= 120; z += 1) if (wet(f.codeAt(-40, z))) far++;
  assert.ok(far >= 18, `40 m west of the map it is still a ~20 m river (${far} m)`);
  let zFar = 0, n = 0;
  for (let z = -A; z <= 120; z += 1) if (wet(f.codeAt(-40, z))) { zFar += z; n++; }
  assert.ok(zFar / n < zMid - 10, `…and it bends north-west with its course (${(zFar / n).toFixed(1)} < ${zMid})`);
  // south edge: water continues south past z = D
  let south = 0;
  for (let x = -A; x <= 82 + A; x += 1) if (wet(f.codeAt(x, 120 + 40))) south++;
  assert.ok(south >= 18, `40 m south of the map the river goes on (${south} m)`);
  // no straight perpendicular stub: due west of the edge crossing but outside the extended river it is snow
  assert.equal(f.codeAt(-40, westRows.at(-1) + 4), T.SNOW, 'no perpendicular extrusion beside the bent river');
  // the escape road leaves the east edge
  let road = 0;
  for (let z = 50; z <= 90; z += 0.5) if (f.codeAt(82 + 20, z) === T.ROAD) road++;
  assert.ok(road >= 4, `the escape road continues east (${road} cells)`);
});

test('apron field: M1 fjord leaves both sides; M3 reservoir corner and river past the SE corner', () => {
  const { f: f1 } = field('m01');
  for (const x of [-30, 65 + 30]) {
    let n = 0;
    for (let z = 30; z <= 110; z++) if (wet(f1.codeAt(x, z))) n++;
    assert.ok(n >= 6, `M1: fjord water ${x < 0 ? 'west' : 'east'} of the map (${n} m)`);
  }
  const { f: f3 } = field('m03');
  assert.ok(wet(f3.codeAt(-20, -20)) && wet(f3.codeAt(20, -20)) && wet(f3.codeAt(-20, 20)), 'M3: reservoir fills the NW corner');
  assert.ok(wet(f3.codeAt(165, 145)), 'M3: the river runs on past the SE corner');
  assert.equal(f3.codeAt(-40, 200 - 133 + 133), T.SNOW, 'M3: snow elsewhere');
});
