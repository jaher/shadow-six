/**
 * M20 art pass (critic fixes): the flagged walk tops (jointed slabs on the walk height), the fire-water basin (rim,
 * apron, open channel side, frost-free floor), the range berm (stops short of the bullet stop running through it),
 * the lever headstock (signal-red grip, lamp housing), and the chimney plan (modelled stovepipes, few plumes).
 * Run with the unit suite: node tests/unit/run.mjs m20-art
 */
import { test, assert } from './lib.mjs';
import { buildTerrace, buildBasin } from '../../src/art/castle-kit.js';
import { buildRangeBerm, buildLeverBox } from '../../src/art/field-guns.js';
import { getMission } from '../../src/missions/index.js';

/** Every vertex of the meshes of `g` whose material name matches `re`: [[x, y, z], …]. */
function verts(g, re) {
  const out = [];
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh || !re.test(o.material.name)) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  });
  return out;
}

test('m20 art: flagged tops — slabs over the whole top, just proud of the walk height, inside the polygon', () => {
  const poly = [[0, 0], [30, 0], [30, 12], [0, 12]], y = 10;
  const g = buildTerrace(poly, y, { seed: 't' });
  const slabs = verts(g, /castle:(flags|field)$/).filter((v) => v[1] > y);
  assert.ok(slabs.length > 600, `slabs ${slabs.length}`);
  for (const [x, yy, z] of slabs) {
    assert.ok(yy <= y + 0.03, `slab at ${yy}`);
    assert.ok(x >= -0.01 && x <= 30.01 && z >= -0.01 && z <= 12.01, `slab vertex (${x}, ${z}) outside the top`);
  }
  assert.ok(verts(g, /castle:iron$/).length > 0, 'drain grates');
  assert.ok(verts(g, /castle:moss$/).length > 0, 'moss');
});

test('m20 art: the basin — coping and apron round the pool, the channel side open, a dark floor under the water', () => {
  const g = buildBasin({ x: 131, z: 79, w: 4.5, d: 8 }, { gaps: [['E', 81, 83.5]], seed: 'pool' });
  const rim = verts(g, /castle:(dressed|paving|ashlar)$/);
  assert.ok(rim.some(([x]) => x < 130.5) && rim.some(([x]) => x > 136), 'rim on both long sides');
  // nothing of the rim stands in the channel mouth (x 135.5-136.6, z 81.1-83.4)
  assert.ok(!rim.some(([x, , z]) => x > 135.45 && x < 136.7 && z > 81.1 && z < 83.4), 'channel mouth open');
  const floor = g.getObjectByName('basin_floor');
  assert.ok(floor, 'floor');
  floor.traverse((o) => { if (o.isMesh) { const c = o.geometry.attributes.color; for (let i = 0; i < c.count; i++) assert.ok(c.getX(i) < 0.8, 'floor not frosted / dark'); } });
});

test('m20 art: the range berm stops short of the bullet stop that crosses it', () => {
  const a = [116.5, 71.5], b = [122, 75.5], half = 0.56;
  const g = buildRangeBerm({ x: 120, z: 74, w: 14, d: 4, h: 1.2, cuts: [[a, b, half]], seed: 'range' });
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  const body = verts(g, /castle:(rubble|boards|timber|moss|canvas)$/).filter((v) => v[1] < 1.3);
  assert.ok(body.length > 100, 'berm built');
  for (const [x, , z] of body) assert.ok(Math.abs((x - a[0]) * n[0] + (z - a[1]) * n[1]) >= half - 0.25, `berm geometry at (${x.toFixed(2)}, ${z.toFixed(2)}) inside the stop`);
});

test('m20 art: the lever headstock — red grip, lamp housing above the box, the lamp point inside it', () => {
  const { group, lamp } = buildLeverBox({ x: 135.8, z: 75.5, seed: 'lever_box' });
  assert.ok(verts(group, /castle:signal$/).length > 0, 'signal-red grip');
  assert.ok(lamp[1] > 1.8 && lamp[1] < 2.4, `lamp height ${lamp[1]}`);
  assert.ok(Math.hypot(lamp[0] - 135.8, lamp[2] - 75.5) < 1.2, 'lamp beside the lever');
});

test('m20 art: chimneys — only a few huts smoke (thin stove plumes); the rest and the houses are off', () => {
  const m = getMission('m20');
  const huts = m.structures.filter((s) => s.type === 'hut' || s.type === 'house');
  const smoking = m.structures.filter((s) => s.chimney && typeof s.chimney === 'object');
  assert.ok(smoking.length >= 1 && smoking.length <= 4, `smoking ${smoking.length}`);
  // render/fx.js chimney activity: 0 cold · ~0.45 faint · 1 normal · 1.5 busy — a hut stove is lit but faint
  for (const s of smoking) assert.ok(s.chimney.activity > 0 && s.chimney.activity <= 0.6 && s.chimney.x == null, `${s.id} plume thin, from the model's stovepipe`);
  for (const s of huts) assert.ok(s.chimney === false || typeof s.chimney === 'object' || !/hut_timber|house_half|turret|outhouse|open_shed/.test(s.variant || ''), `${s.id} chimney set`);
});

test('m20 art: the Black Forest fill stops short of the castle (no bough over the N range / crag), the wood stays', async () => {
  const { clearForestFill, treePlacement } = await import('../../src/art/terrain.js');
  const { fillForest, forestUnderstorey } = await import('../../src/art/terrain/forest-fill.js');
  const { SPECIES } = await import('../../src/art/terrain/treegen.js');
  const m = getMission('m20'), f = m.structures.find((s) => s.id === 'forest');
  const all = fillForest({ ...f, forestVariant: 'pine_frost' }, (d, k) => treePlacement(d, 'temperate', k), { spacing: 4.4 });
  const kept = clearForestFill(all, m.structures);
  assert.ok(kept.length >= 30 && kept.length < all.length, `fill thinned at the walls, still a wood (${all.length} -> ${kept.length})`);
  const nr = m.structures.find((s) => s.id === 'n_range'), z0 = nr.z - nr.d / 2;
  for (const p of kept) {
    const sp = SPECIES[p.species], H = sp.H[1] * p.scale, reach = (sp.kind === 'conifer' ? sp.width * 1.15 : 0.5) * H;
    if (p.x > nr.x - nr.w / 2 && p.x < nr.x + nr.w / 2) assert.ok(z0 - p.z >= reach, `${p.species} @${p.x.toFixed(1)},${p.z.toFixed(1)} crown clear of the N range`);
    if (p.x < 40) assert.ok(10 - p.z >= reach, `${p.species} @${p.x.toFixed(1)},${p.z.toFixed(1)} crown clear of the crag`);
  }
  const under = forestUnderstorey(f, 'temperate'), uk = clearForestFill(under, m.structures);
  assert.ok(uk.every((p) => p.x >= 40 || p.z < 10 - SPECIES[p.species].H[1] * p.scale * (SPECIES[p.species].fallen ? 1 : 0) - 0.3 || SPECIES[p.species].kind === 'bush'), 'no fallen bough into the crag');
});

test('m20 art: the HQ roof ledge — no plank deck floating baseY above the roof once the château is lifted', async () => {
  const { buildStructure } = await import('../../src/world/map-builder.js');
  const { NavGrid } = await import('../../src/world/grid.js');
  const { liftOnto } = await import('../../src/missions/scripts/m20.js');
  const { HQ } = await import('../../src/missions/m20_operation_valhalla.js');
  const o = buildStructure(HQ, { grid: new NavGrid(160, 160) }).object3d;
  assert.ok(o.children.some((c) => c.name === 'dressing:walkway'), 'the builder hangs a walk deck on the HQ (precondition)');
  liftOnto(o, HQ.baseY);
  liftOnto(o, HQ.baseY); // a quick load runs the script again
  assert.equal(o.position.y, HQ.baseY, 'lifted once');
  let deck = null;
  o.traverse((n) => { if (n.name === 'dressing:walkway') deck = n; });
  assert.equal(deck, null, 'no deck left on the lifted château');
});
