/**
 * Rock massifs on a map edge carry on over the apron (world/edge-extend.js; user request 2026-10-01 "When i slide to
 * the side I still can see the boundary of then the terrain ends, extend it so I don't see the boundary at all"):
 * the M10 shelf, the M8 plateau and the M11 rim used to end in a straight wall ON the map edge.
 */
import { test, assert } from './lib.mjs';
import { extendPolygonPastEdges, edgeCliffOutlines, inPolygon, isSimple, edgeCrossings, crossingSource, edgeLineExtensions, edgeStructureRuns, edgeBuildingRows } from '../../src/world/edge-extend.js';
import { extendPath } from '../../src/world/apron-field.js';
import { roadPolylines } from '../../src/art/terrain.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { getMission } from '../../src/missions/index.js';
import { CONFIG } from '../../src/config.js';

test('a polygon away from the edges is returned unchanged', () => {
  const P = [[10, 10], [20, 10], [15, 20]];
  assert.equal(extendPolygonPastEdges(P, 100, 100, 50), P);
});

test('an edge run moves out; faces meeting the edge carry on; the in-map outline is unchanged', () => {
  // a block standing on the north edge (z = 0), faces square to it
  const P = [[20, 0], [40, 0], [40, 15], [20, 15]];
  const E = extendPolygonPastEdges(P, 100, 100, 50);
  assert.ok(isSimple(E), 'simple polygon');
  assert.ok(E.some(([x, z]) => x === 20 && z === -50) && E.some(([x, z]) => x === 40 && z === -50), JSON.stringify(E));
  for (const [x, z] of [[30, 5], [30, -30], [21, -49]]) assert.ok(inPolygon(x, z, E), `inside at ${x},${z}`);
  for (const [x, z] of [[30, 16], [19, 5], [41, -10]]) assert.ok(!inPolygon(x, z, E), `outside at ${x},${z}`);
  // a slanted face keeps its own direction past the edge (no kink on the map edge)
  const S = extendPolygonPastEdges([[20, 0], [40, 0], [30, 15]], 100, 100, 30);
  const k = S.findIndex(([, z]) => z === -30);
  assert.ok(k >= 0 && S.some(([x, z]) => z === -30 && x > 40), `face from (30,15) through (40,0) goes on to x > 40: ${JSON.stringify(S)}`);
});

test('a corner massif fills the corner square past both edges', () => {
  const E = extendPolygonPastEdges([[0, 0], [30, 0], [30, 20], [0, 20]], 100, 100, 40);
  assert.ok(isSimple(E));
  for (const [x, z] of [[-20, -20], [-39, 10], [15, -39], [10, 10]]) assert.ok(inPolygon(x, z, E), `inside at ${x},${z}`);
  assert.ok(!inPolygon(31, 10, E) && !inPolygon(10, 21, E));
});

test('the edge cliffs of M8 / M10 / M11 reach past the apron; every in-map point keeps its inside / outside state', () => {
  const out = CONFIG.apron.width + 12;
  for (const [id, want] of [['m08', 'plateau'], ['m10', 'shelf'], ['m11', 'plateau_n']]) {
    const m = getMission(id), [W, D] = m.size;
    const o = edgeCliffOutlines(m.structures, W, D, out);
    const c = o.find((x) => x.id === want);
    assert.ok(c, `${id}: ${want} is extended (${o.map((x) => x.id).join(', ')})`);
    assert.ok(isSimple(c.points), `${id}: ${want} outline is simple`);
    const own = m.structures.find((s) => s.id === want).points.map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
    let diff = 0;
    for (let x = 2; x < W - 2; x += 1.7) for (let z = 2; z < D - 2; z += 1.7) if (inPolygon(x, z, own) !== inPolygon(x, z, c.points)) diff++;
    assert.equal(diff, 0, `${id}: ${want} outline unchanged inside the map (2 m in from the edges)`);
    const xs = c.points.map((p) => p[0]), zs = c.points.map((p) => p[1]);
    assert.ok(Math.min(...xs) <= -out + 1e-6 || Math.max(...xs) >= W + out - 1e-6 || Math.min(...zs) <= -out + 1e-6 || Math.max(...zs) >= D + out - 1e-6,
      `${id}: ${want} reaches ${out} m past an edge`);
  }
});

// fix round 2 (verifier, 2026-10-01): wheel ruts, rails, power lines, walls and wire stopped in a straight line on
// the map edge with only a flat band beyond
test('a road leaving the map: one crossing on its side, the apron repeats the ruts along the road (no seam at the edge)', () => {
  const X = edgeCrossings([{ points: [[10, 50], [0, 40], [-10, 30]], width: 4, spread: 0.8 }], 100, 100);
  assert.equal(X.length, 1);
  assert.equal(X[0].side, 3);
  assert.ok(Math.abs(X[0].e[0]) < 1e-9 && Math.abs(X[0].e[1] - 40) < 1e-9, JSON.stringify(X[0].e));
  // at the edge the source is the point itself; past it, the mirror image along the road, same lateral offset
  const at = crossingSource(-1e-6, 40, X, 100, 100);
  assert.ok(at && Math.hypot(at.x, at.z - 40) < 1e-3, JSON.stringify(at));
  const q = crossingSource(-3, 37, X, 100, 100);
  assert.ok(Math.abs(q.x - 3) < 1e-9 && Math.abs(q.z - 43) < 1e-9, JSON.stringify(q));
  // far out: always inside the map's last `period` m of road, never past the edge
  for (let u = 0; u < 80; u += 0.7) {
    const p = crossingSource(-u * Math.SQRT1_2, 40 - u * Math.SQRT1_2, X, 100, 100, 14);
    assert.ok(p && p.x >= -1e-9 && p.x <= 14 * Math.SQRT1_2 + 1e-6, `u ${u}: ${JSON.stringify(p)}`);
  }
  // off the road band: nothing; a road running along the edge (grazing): no crossing
  assert.equal(crossingSource(-3, 20, X, 100, 100), null);
  assert.equal(edgeCrossings([{ points: [[0.5, 10], [-0.5, 60]] }], 100, 100).length, 0);
});

test('every mission road that reaches an edge gets a crossing once driven on past it (as art/terrain.js does)', () => {
  for (const id of ['m03', 'm09', 'm20']) {
    const m = getMission(id), [W, D] = m.size;
    const ruts = roadPolylines(m).map((r) => ({ ...r, points: extendPath(r.points, null, W, D, r.near ?? 1.5, 16).points }));
    const X = edgeCrossings(ruts, W, D);
    assert.ok(X.length >= 2, `${id}: ${X.length} crossings`);
    for (const c of X) assert.ok(c.cos >= 0.25 && c.hw >= 3, `${id}: ${JSON.stringify(c)}`);
  }
});

test('walls, fences, wire, rails and telegraph lines that end on an edge carry on over the apron (not along it, not sheds)', () => {
  assert.deepEqual(edgeLineExtensions([[82, 72], [70, 66], [58, 58]], 82, 120, 50)[0][0], [82, 72]);
  const e = edgeLineExtensions([[82, 72], [70, 66], [58, 58]], 82, 120, 50)[0][1];
  assert.ok(e[0] > 120 && e[1] > 72, JSON.stringify(e));
  assert.equal(edgeLineExtensions([[0, 10], [0, 50]], 82, 120, 50).length, 0, 'a run along the edge');
  assert.equal(edgeLineExtensions([[10, 10], [40, 50]], 82, 120, 50).length, 0, 'a run inside the map');
  const len = CONFIG.apron.width + 12;
  const want = { m04: ['wall_inner', 'wire', 'rail_main'], m06: ['w_nn', 'w_yard', 'rail_main'], m15: ['parapet_w1', 'cem_fence_w'], m16: ['rail_main'], m19: ['pal_n'] };
  for (const [id, ids] of Object.entries(want)) {
    const m = normalizeMission(getMission(id)), [W, D] = m.size, R = edgeStructureRuns(m.structures, W, D, len);
    for (const w of ids) {
      const r = R.find((x) => x.def.id === w);
      assert.ok(r, `${id}: ${w} carries on (${R.map((x) => x.id).join(', ')})`);
      const [a, b] = r.points;
      assert.ok(Math.min(a[0], a[1], W - a[0], D - a[1]) <= 1.6, `${id}: ${w} starts on the edge ${a}`);
      assert.ok(Math.min(b[0], b[1], W - b[0], D - b[1]) < -len * 0.25, `${id}: ${w} runs out over the apron ${b}`);
    }
    assert.ok(!R.some((x) => /shed/.test(x.def.variant ?? '')), `${id}: no shed wall carried on`);
  }
});

test('a street of flat-roofed houses ending flush on an edge carries on as a town past it (M12 house_e1..e3 on x = W)', () => {
  const m = normalizeMission(getMission('m12')), [W, D] = m.size;
  const B = edgeBuildingRows(m.structures, W, D), houses = B.filter((b) => b.kind === 'house');
  assert.ok(houses.length >= 12, `M12: ${houses.length} houses past the E edge`);
  for (const b of B) {
    assert.ok(b.x - b.w / 2 >= W - 1e-6, `M12: box at (${b.x}, ${b.z}) stays past the E edge`);
    assert.ok(b.z - b.d / 2 > 10 && b.z + b.d / 2 < 100, `M12: box at z ${b.z} stays beside the street (z 22..86)`);
    assert.ok(b.h >= 2 && b.h <= 12, `M12: height ${b.h}`);
  }
  // the first row closes the street front: the face z 22..86 is backed by houses with no gap wider than a passage
  const row1 = houses.filter((b) => b.x - b.w / 2 < W + 0.01).sort((a, b) => a.z - b.z);
  assert.ok(row1[0].z - row1[0].d / 2 <= 22.5 && row1[row1.length - 1].z + row1[row1.length - 1].d / 2 >= 85.5, 'M12: the first row spans the street');
  for (let k = 1; k < row1.length; k++) assert.ok(row1[k].z - row1[k].d / 2 - (row1[k - 1].z + row1[k - 1].d / 2) <= 2.6, `M12: gap in the first row at z ${row1[k].z}`);
  // the roofline steps (not one flat slab) and the town thins outward (fewer / lower houses in the outer rows)
  assert.ok(new Set(row1.map((b) => b.h.toFixed(1))).size >= 3, 'M12: the first row has several heights');
  const far = houses.filter((b) => b.x > W + 30), near = houses.filter((b) => b.x < W + 12);
  assert.ok(far.length > 0 && Math.max(...far.map((b) => b.h)) < Math.max(...near.map((b) => b.h)), 'M12: lower outer rows');
  // houses never overlap each other
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) {
    const a = houses[i], b = houses[j];
    const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2), oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
    assert.ok(!(ox > 0.01 && oz > 0.01), `M12: houses ${i} and ${j} overlap`);
  }
});

test('edge towns: only M12 has a flush street (no other mission grows houses past its edges)', () => {
  for (const id of ['b00', 'm00', ...Array.from({ length: 20 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`)]) {
    if (id === 'm12') continue;
    const m = normalizeMission(getMission(id));
    assert.equal(edgeBuildingRows(m.structures, m.size[0], m.size[1]).length, 0, `${id}: no edge town`);
  }
});

test('edge walls / fences that cross over the apron: the later one stops at the other (M15 railing at the canal parapet)', () => {
  const m = normalizeMission(getMission('m15')), [W, D] = m.size;
  const runs = edgeStructureRuns(m.structures, W, D, CONFIG.apron.width + 12);
  const rail = runs.find((r) => r.id === 'ruins_nw_rail:edge1'), par = runs.find((r) => r.id === 'parapet_w1:edge0');
  assert.ok(rail && par, 'M15 runs present');
  // the railing heads SW from (0, 28) and used to cross the W1 canal (z 87.8 .. 107.2); now it ends at the N parapet
  assert.ok(rail.points[1][1] < 87.8 && rail.points[1][1] > 86, `railing ends at the parapet: ${rail.points[1]}`);
  assert.ok(Math.abs(par.points[1][0]) > 90, 'the parapet itself runs on');
  // rails are never cut (M4 main line / siding run on whatever they meet)
  const m4 = normalizeMission(getMission('m04'));
  for (const r of edgeStructureRuns(m4.structures, m4.size[0], m4.size[1], 100).filter((q) => q.def.type === 'rail_track')) {
    assert.ok(Math.abs(Math.hypot(r.points[1][0] - r.points[0][0], r.points[1][1] - r.points[0][1]) - 100) < 1e-6, `${r.id} runs its full length`);
  }
});
