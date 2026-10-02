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
import { waterBodyDescriptors, extendBodiesOverApron } from '../../src/art/water.js';
import { waterBodiesFromGrid } from '../../src/art/water/grid.js';

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

test('apron geometry: the sunken seam strip never tilts the edge normals (no lit / dark line along the map edge)', async () => {
  const { apronGeometry, INNER_DROP } = await import('../../src/art/apron.js');
  const f = { A: 30, W: 40, D: 30 };
  const slope = (x, z) => 0.05 * x + 0.02 * z; // gentle plane: every normal must be the plane's
  const geo = apronGeometry(f, slope, slope, 2);
  const p = geo.attributes.position, n = geo.attributes.normal, L = Math.hypot(0.05, 1, 0.02);
  let worst = 0, sunk = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (x > 0 && x < f.W && z > 0 && z < f.D) { assert.ok(Math.abs(p.getY(i) - (slope(x, z) - INNER_DROP)) < 1e-4, 'inner strip sunk'); sunk++; }
    const dot = (-0.05 * n.getX(i) + n.getY(i) - 0.02 * n.getZ(i)) / L;
    if (Math.abs(x) <= 0.3 || Math.abs(x - f.W) <= 0.3 || Math.abs(z) <= 0.3 || Math.abs(z - f.D) <= 0.3) worst = Math.max(worst, Math.acos(Math.min(1, dot)) * 180 / Math.PI);
  }
  assert.ok(sunk > 0, 'has an inner strip');
  assert.ok(worst < 0.5, `edge normals follow the ground (worst tilt ${worst.toFixed(2)} deg)`);
});

test('apron field: M15 canal basins stop at their parapets past the W and E edges (no water on the land side)', () => {
  const { f } = field('m15');
  // W1 (z 88..107 on x = 0) runs straight out between parapets at z 87.8 / 107.2: every apron cell outside them is dry
  for (let x = -40; x <= -0.5; x += 0.5) {
    for (const z of [80, 84, 86.5, 87.4, 107.6, 108.5, 110, 114]) assert.ok(!wet(f.codeAt(x, z)), `M15 W edge: water at (${x}, ${z}) outside the W1 parapets`);
    for (const z of [90, 97, 105]) assert.ok(wet(f.codeAt(x, z)), `M15 W edge: W1 carries on at (${x}, ${z})`);
  }
  // W3 on x = 81 opens between parapets (62.8, 115.8)→(81, 118.8) and (61, 129.3)→(81, 134.2), carried on straight
  const Wm = f.W;
  for (let d = 1; d <= 40; d += 1) {
    const x = Wm + d, zn = 118.8 + d * 3 / 18.2, zs = 134.2 + d * 4.9 / 20;
    if (zs + 1.2 < f.D + 40) assert.ok(!wet(f.codeAt(x, zs + 1.2)), `M15 E edge: water S of the W3 parapet ${d} m past the edge`);
    assert.ok(!wet(f.codeAt(x, zn - 1.2)), `M15 E edge: water N of the W3 parapet ${d} m past the edge`);
  }
});

test('apron field: M12 harbour water follows the S quay past the W edge (no sand between water and quay)', () => {
  const { f } = field('m12');
  // the S quay runs from (20, 90.5) to (0.5, 114) and carries on SW over the apron: water on its NW side, quay road SE
  for (const d of [5, 15, 30]) {
    const qx = 0.5 - d * 19.5 / 30.5, qz = 114 + d * 23.5 / 30.5; // on the extended quay line
    assert.ok(wet(f.codeAt(qx - 2.5, qz - 2)), `water just NW of the quay ${d} m past the edge`);
    assert.ok(!wet(f.codeAt(qx + 2.5, qz + 2)), `land just SE of the quay ${d} m past the edge`);
  }
});

test('apron water: M3 raised reservoir keeps its own body at its level and carries on past the N / W edges (not merged into the river)', () => {
  const { grid, def, f } = field('m03');
  const descs = waterBodyDescriptors(grid, def, def.theater, waterBodiesFromGrid);
  const out = extendBodiesOverApron(descs, f, 256);
  assert.equal(out.length, descs.length, 'no body dropped');
  const lake = out.find((d) => d.raised), river = out.find((d) => !d.raised);
  assert.ok(lake && lake.apron && river && river.apron, 'both bodies carry on over the apron');
  for (const [x, z] of [[20, 10], [40, 5], [-20, -20], [20, -20], [-20, 15]]) {
    assert.ok(lake.mask(x, z), `reservoir water at (${x}, ${z})`);
    assert.ok(!river.mask(x, z), `no river water at (${x}, ${z})`);
  }
  assert.ok(river.mask(160, 140) && !lake.mask(160, 140), 'the river past the SE corner');
});

test('apron field: M3 reservoir past the edge runs along its rock rims (no low ground between raised water and rock)', () => {
  const { f } = field('m03');
  // rim_s leaves the W edge (-1, 29.5) heading W (−15, 1); rim_e leaves the N edge (55, −1) heading N
  for (const d of [2, 10, 25, 45]) {
    const zr = 29.5 + (d - 1) / 15; // rim_s's N face d m past the W edge
    assert.ok(wet(f.codeAt(-d, zr - 1.2)), `water against rim_s ${d} m past the W edge`);
    assert.ok(!wet(f.codeAt(-d, zr + 6.5)), `dry S of rim_s ${d} m past the W edge`);
    assert.ok(wet(f.codeAt(53.6, -d)), `water against rim_e ${d} m past the N edge`);
    assert.ok(!wet(f.codeAt(60, -d)), `dry E of rim_e ${d} m past the N edge`);
  }
});
