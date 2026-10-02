/** Trees, shrubs, hedges and palms (docs/vegetation.md pass 2): species architecture, seasons, forests, interaction. */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { generateTree, GeoAcc, TREE_QUALITY, SPECIES, LEAF_LAYERS, useThree } from '../../src/art/terrain/treegen.js';
import { treePlacement, VARIANT_SPECIES, TREE_TYPES } from '../../src/art/terrain.js';
import { vegetationProfile, treeSeason } from '../../src/art/terrain/veg-profile.js';
import { fillForest, inPoly, hedgerowPlacements } from '../../src/art/terrain/forest-fill.js';
import { MISSIONS } from '../../src/missions/index.js';
import { readFileSync } from 'node:fs';
useThree(THREE);

const gen = (species, seed = 7, at = {}, q = TREE_QUALITY.high) => {
  const bark = new GeoAcc(), leaf = new GeoAcc();
  const info = generateTree(species, seed, q, bark, leaf, { x: 0, y: 0, z: 0, ...at });
  return { bark, leaf, info };
};
const box = (acc) => new THREE.Box3().setFromArray(acc.p);
const BROAD = ['oak', 'beech', 'plane', 'poplar', 'birch', 'olive', 'willow', 'ash', 'alder', 'apple', 'hawthorn', 'horse_chestnut', 'acacia'];

test('trees: the foliage atlas names every leaf layer (2 variants each) and its normal/coverage strip matches', () => {
  const meta = JSON.parse(readFileSync(new URL('../../assets/terrain/foliage.json', import.meta.url)));
  assert.equal(meta.layers.length, LEAF_LAYERS.length * 2);
  LEAF_LAYERS.forEach((n, i) => { assert.equal(meta.layers[2 * i], `${n}_0`); assert.equal(meta.layers[2 * i + 1], `${n}_1`); });
  assert.equal(meta.size, 512); assert.equal(meta.normalSize, 256);
});

test('trees: every species is seeded, unique and within its triangle budget; crown AO is in 0.25..1', () => {
  for (const sp of Object.keys(SPECIES)) {
    if (SPECIES[sp].kind === 'conifer') continue;   // pines branch
    const a = gen(sp, 11), b = gen(sp, 11), c = gen(sp, 12);
    assert.deepEqual(a.bark.p.slice(0, 60), b.bark.p.slice(0, 60), `${sp}: same seed, same tree`);
    assert.notDeepEqual(a.bark.p.slice(0, 300), c.bark.p.slice(0, 300), `${sp}: other seed, other tree`);
    const tris = (a.bark.idx.length + a.leaf.idx.length) / 3;
    const cap = SPECIES[sp].kind === 'bush' ? 4000 : SPECIES[sp].kind === 'palm' ? 12000 : 16000;
    assert.ok(tris > 50 && tris < cap, `${sp}: ${tris} tris (cap ${cap})`);
    for (let i = 0; i < a.leaf.count; i++) assert.ok(a.leaf.ext[i * 2] >= 0.25 && a.leaf.ext[i * 2] <= 1, `${sp}: AO ${a.leaf.ext[i * 2]}`);
  }
});

test('trees: species keep their architecture (poplar column, oak wide dome, acacia flat table, birch narrow)', () => {
  const shape = (sp) => { let w = 0, h = 0; for (let s = 1; s <= 6; s++) { const t = gen(sp, s * 37); const b = box(t.leaf), sz = b.getSize(new THREE.Vector3()); w += Math.max(sz.x, sz.z); h += t.info.height; } return w / h; };
  const poplar = shape('poplar'), oak = shape('oak'), acacia = shape('acacia'), birch = shape('birch');
  assert.ok(poplar < 0.45, `poplar is columnar (w/H ${poplar.toFixed(2)})`);
  assert.ok(oak > 0.8, `oak spreads (w/H ${oak.toFixed(2)})`);
  assert.ok(acacia > 1.2, `acacia is a flat table (w/H ${acacia.toFixed(2)})`);
  assert.ok(birch < oak && poplar < birch, 'birch between poplar and oak');
});

test('trees: leafless crowns carry twig sprays, young oaks/beeches some marcescent leaves; dead trees none', () => {
  const twig = LEAF_LAYERS.indexOf('twig') * 2, brown = LEAF_LAYERS.indexOf('brown') * 2;
  const layers = (acc) => new Set(Array.from({ length: acc.count }, (_, i) => Math.floor(acc.info[i * 4] / 2) * 2));
  for (const sp of BROAD.filter((s) => !SPECIES[s].evergreen)) {
    const t = gen(sp, 5, { leafless: true });
    // birch (critic round 2): no twig-spray cards — on a February birch they read as black dead-leaf balls
    if (SPECIES[sp].twigSpray === 0) assert.ok(!layers(t.leaf).has(twig) && !layers(t.leaf).has(brown), `${sp}: bare crown carries no spray cards`);
    else assert.ok(layers(t.leaf).has(twig), `${sp}: bare crown has twig sprays`);
  }
  // critic round 1: bare crowns are airy (twig tubes carry the structure, sparse small twig cards), marcescent leaves
  // are 10-30 % of a summer crown, low / inner, on a minority of trees
  const area = (acc) => { let a = 0; for (let i = 0; i < acc.idx.length; i += 3) { const [p, q, r] = [0, 1, 2].map((k) => new THREE.Vector3().fromArray(acc.p, acc.idx[i + k] * 3)); a += q.sub(p).cross(r.sub(p)).length() / 2; } return a; };
  let marc = 0, few = 0, share = [], low = 0, nLow = 0;
  for (let s = 0; s < 30; s++) {
    const bare = gen('oak', s, { leafless: true, marc: 0.5, marcTrees: 0.3 }), summer = gen('oak', s);
    if (s < 6) {
      assert.ok(area(bare.leaf) < 0.35 * area(summer.leaf), `oak ${s}: bare crown cards ${area(bare.leaf).toFixed(0)} m² vs summer ${area(summer.leaf).toFixed(0)} m² (see-through)`);
      assert.ok(bare.bark.idx.length > 1.3 * summer.bark.idx.length, `oak ${s}: bare crown has an extra order of twig tubes`);
    }
    few += layers(gen('oak', s, { leafless: true, marc: 0.5, marcTrees: 0.12 }).leaf).has(brown) ? 1 : 0;
    if (!layers(bare.leaf).has(brown)) continue;
    marc++;
    let nb = 0, yb = 0, ys = 0;
    for (let i = 0; i < bare.leaf.count; i++) if (Math.floor(bare.leaf.info[i * 4] / 2) * 2 === brown) { nb++; yb += bare.leaf.p[i * 3 + 1]; }
    for (let i = 0; i < summer.leaf.count; i++) ys += summer.leaf.p[i * 3 + 1];
    share.push(nb / summer.leaf.count);
    nLow++; if (yb / nb < ys / summer.leaf.count) low++;
  }
  assert.ok(marc >= 3 && marc <= 15, `a minority of oaks keep brown leaves (${marc}/30)`);
  assert.ok(few < marc, `the snow theatre keeps fewer (${few} vs ${marc})`);
  const mShare = share.reduce((a, b) => a + b, 0) / share.length;
  assert.ok(mShare >= 0.08 && mShare <= 0.3, `marcescent density ${(mShare * 100).toFixed(0)} % of a summer crown`);
  assert.ok(low >= nLow * 0.8, `brown leaves sit low in the crown (${low}/${nLow})`);
  assert.equal(gen('dead_tree', 3).leaf.count, 0, 'a dead snag has no foliage');
  const ivy = LEAF_LAYERS.indexOf('ivy') * 2;
  assert.ok(layers(gen('oak', 9, { ivy: true }).leaf).has(ivy), 'ivy on the trunk');
});

test('trees: palms have pinnate fronds of separate leaflets, a dead skirt sometimes, dates only when ripe', () => {
  const pl = LEAF_LAYERS.indexOf('palmleaf') * 2;
  let skirts = 0, quads = 0;
  for (let s = 0; s < 8; s++) {
    const t = gen('date_palm', s, { dates: true });
    let dry = 0;
    for (let i = 0; i < t.leaf.count; i++) { const l = t.leaf.info[i * 4]; assert.ok(l === pl || l === pl + 1, 'palm leaflets use the leaflet tile'); if (l === pl + 1) dry++; }
    if (dry > 0) skirts++;
    quads += t.leaf.idx.length / 6;
  }
  assert.ok(quads / 8 > 900, `≥ 900 leaflets per palm (${(quads / 8) | 0})`);
  assert.ok(skirts >= 3 && skirts <= 8, `dead-frond skirts on most oasis palms (${skirts}/8)`);
  const town = gen('date_palm_town', 3);
  for (let i = 0; i < town.leaf.count; i++) assert.equal(town.leaf.info[i * 4], pl, 'town palms are pruned (no dead skirt)');
  const ripe = gen('date_palm', 4, { dates: true }).bark.count, unripe = gen('date_palm', 4, { dates: false }).bark.count;
  assert.ok(ripe >= unripe, 'date bunches add geometry when ripe');
});

test('trees: seasons follow the date (M17–M20 bare, M15/M16 green with late-summer fading, desert evergreen)', () => {
  const by = Object.fromEntries(MISSIONS.map((m) => [m.id, vegetationProfile(m, m.theater || 'temperate').trees]));
  for (const id of ['m17', 'm18', 'm19', 'm20', 'm01']) assert.ok(by[id].leafless, `${id}: deciduous crowns bare`);
  for (const id of ['m13', 'm14', 'm15', 'm16']) assert.ok(!by[id].leafless, `${id}: in leaf`);
  assert.ok(by.m16.dull > by.m14.dull && by.m16.autumn > 0, 'late summer fades and turns a few leaves');
  for (const id of ['m08', 'm09', 'm10', 'm11', 'm12']) assert.ok(!by[id].leafless, `${id}: desert trees evergreen`);
  assert.ok(by.m08.dates && !by.m12.dates, 'dates ripe in Oct–Dec (M08), not in March (M12)');
  assert.ok(!treeSeason('autumn', '1944-10-10', 'temperate').leafless, 'October: still in (turning) leaf');
});

test('trees: mission variants pick fitting species; forest areas are filled inside their footprint', () => {
  const pick = (d, th) => treePlacement(d, th).species;
  for (const [v, list] of Object.entries(VARIANT_SPECIES)) for (const sp of list) assert.ok(SPECIES[sp], `${v}: ${sp} exists`);
  const norm = new Set(Array.from({ length: 40 }, (_, k) => pick({ type: 'tree', variant: 'broadleaf_normandy', x: k * 3.1, z: 7, seed: 100 + k }, 'coast')));
  assert.ok(norm.size >= 4 && [...norm].every((s) => VARIANT_SPECIES.broadleaf_normandy.includes(s)), `Normandy mix ${[...norm]}`);
  assert.equal(pick({ type: 'bush', variant: 'box_parterre', x: 1, z: 1 }, 'temperate'), 'box');
  const m20 = MISSIONS.find((m) => m.id === 'm20');
  const frost = m20.structures.filter((s) => s.variant === 'pine_frost').map((d, k) => pick(d, 'temperate'));
  assert.ok(frost.some((s) => s === 'beech' || s === 'oak') && frost.some((s) => SPECIES[s].kind === 'conifer'), 'M20: mixed wood');
  for (const id of ['m04', 'm20']) {
    const m = MISSIONS.find((x) => x.id === id);
    const areas = m.structures.filter((s) => TREE_TYPES.includes(s.type) && Array.isArray(s.points));
    assert.ok(areas.length, `${id}: has a forest area`);
    for (const a of areas) {
      const out = fillForest(a, (d, k) => treePlacement(d, m.theater || 'temperate', k));
      const poly = a.points.map((p) => (Array.isArray(p) ? p : [p.x, p.z]));
      let area = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
      area = Math.abs(area / 2);
      assert.ok(out.length >= area / 40, `${id}: forest filled (${out.length} trees on ${area.toFixed(0)} m²)`);
      for (const t of out) assert.ok(inPoly(t.x, t.z, poly), 'trunk inside the footprint');
      assert.deepEqual(fillForest(a, (d, k) => treePlacement(d, m.theater || 'temperate', k)).map((t) => t.seed), out.map((t) => t.seed), 'deterministic');
    }
  }
});

test('interaction: movers brush low vegetation, moving land vehicles crush desert scrub (visual only)', async () => {
  const { brushWorld } = await import('../../src/art/terrain.js');
  const { createScrub, placeScrub } = await import('../../src/art/terrain/scrub.js');
  const plan = placeScrub({ W: 40, D: 40, runoff: () => 1, open: () => true }, { seed: 5 });
  assert.ok(plan.length > 10, 'scrub planned');
  const group = new THREE.Group();
  const scrub = createScrub({ scrubPlan: plan, heightAt: () => 0 }, { clutter: 1 }, group, {});
  const p0 = plan[0];
  const got = [];
  const veg = { agitate: (m) => got.push(...m) };
  const world = {
    commandos: [{ id: 1, alive: true, path: [1], x: 3, z: 4, moveMode: 'run' }, { id: 2, alive: true, path: null, x: 9, z: 9 }],
    enemies: [{ id: 3, alive: true, path: [1], x: 5, z: 5, stance: 'crawl' }],
    vehicles: [{ id: 7, alive: true, speed: 4, x: p0.x, z: p0.z, def: { kind: 'land' }, model: { dims: { w: 2.2 } } },
      { id: 8, alive: true, speed: 0, x: 30, z: 30, def: { kind: 'land' } }],
  };
  brushWorld(veg, scrub, world, 1 / 60);
  assert.deepEqual(got.map((m) => m.id).sort(), ['u1', 'u3', 'v7'], 'moving walkers and the moving vehicle brush; the idle ones do not');
  assert.ok(got.find((m) => m.id === 'u1').s > got.find((m) => m.id === 'u3').s, 'a runner shakes harder than a crawler');
  // the plant under the moving vehicle is pressed flat; one far away is untouched
  const im = scrub.meshes.find((m) => m.name === 'scrub:' + p0.kind && m.count > 0);
  const m4 = new THREE.Matrix4(), s = new THREE.Vector3(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
  let flat = 0, upright = 0;
  for (const mesh of scrub.meshes) for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m4); m4.decompose(pos, q, s);
    if (s.y < s.x * 0.3) flat++; else upright++;
  }
  assert.ok(im && flat >= 1 && upright > flat, `crushed ${flat}, upright ${upright}`);
  assert.equal(scrub.crush(p0.x, p0.z, 2), 0, 'a crushed plant stays crushed (no double count)');
});

test('trees: a bocage hedgerow is a dense seeded shrub line with gate gaps and oak/ash standards', () => {
  const def = { points: [[0, 0], [60, 0], [60, 30]], gaps: [[20, 24]], seed: 5 };
  const out = hedgerowPlacements(def);
  const shrubs = out.filter((p) => ['hedge', 'hazel', 'shrub'].includes(p.species));
  const std = out.filter((p) => p.species === 'oak' || p.species === 'ash');
  assert.ok(shrubs.length >= 90 / 2.2, `dense line (${shrubs.length} crowns on 90 m)`);
  assert.ok(new Set(shrubs.map((p) => p.species)).size === 3, 'mixed hawthorn / hazel / shrub');
  assert.ok(std.length >= 3 && std.length <= 9, `standards every 10-20 m (${std.length})`);
  assert.ok(!shrubs.some((p) => Math.abs(p.z) < 0.3 && p.x > 20.6 && p.x < 23.4), 'gate gap left open');
  assert.ok(new Set(out.map((p) => p.seed)).size === out.length, 'every crown has its own seed');
  assert.deepEqual(hedgerowPlacements(def), out, 'deterministic');
  assert.deepEqual(hedgerowPlacements({ points: [[0, 0]] }), [], 'needs two points');
  assert.ok(!hedgerowPlacements({ ...def, standards: false }).some((p) => p.species === 'oak' || p.species === 'ash'), 'standards optional');
});

test('farmland: in-map fields and wall hedges keep clear of gameplay; no visual-only field hedge or orchard tree in the map', async () => {
  const { loadGrid } = await import('./mission-check.mjs');
  const { farmland, gameplayGeometry } = await import('../../src/art/terrain/bocage.js');
  const near = (x, z, g, d) => g.pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < d) || g.lines.some((l) => l.some((p, i) => {
    if (!i) return false; const a = l[i - 1], vx = p[0] - a[0], vz = p[1] - a[1], L = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / L)); return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t) < d; }));
  for (const id of ['m13', 'm15', 'm16', 'm20']) {
    const m = MISSIONS.find((q) => q.id === id);
    assert.ok(m.vegetation?.farmland, `${id} asks for farmland`);
    const { def, grid } = loadGrid(m), g = gameplayGeometry(def), f = farmland(def, grid);
    assert.ok(g.lines.length > 5 && g.pts.length > 50, `${id}: routes and points found`);
    // critic round 2: a 2.6 m visual hedge / standard tree on walkable grass reads as cover it does not give
    for (const h of f.hedgerows) {
      assert.equal(h.standards, false, `${id}: in-map hedges are wall-backing (no standard trees)`);
      for (const p of hedgerowPlacements(h)) assert.ok(!near(p.x, p.z, g, 5.9), `${id}: wall hedge ${p.x.toFixed(1)}:${p.z.toFixed(1)} clear of gameplay`);
    }
    assert.equal(f.orchard.length, 0, `${id}: no in-map orchard trees`);
    assert.ok(f.fields.every((fl) => fl.kind !== 'orchard'), `${id}: fields hold crops or pasture`);
    for (const fl of f.fields) for (const [x, z] of fl.poly) assert.ok(!near(x, z, g, 8.5), `${id}: field corner ${x.toFixed(1)}:${z.toFixed(1)} clear`);
    assert.equal(JSON.stringify(farmland(def, grid)), JSON.stringify(f), `${id}: deterministic`);
  }
});

// M13 is ringed by water and M15's apron continues the town's paving: the bocage needs open land past the edge
const BOCAGE_MIN = { m13: 0, m14: 0, m15: 0, m16: 20, m20: 20 };
test('bocage: Liège and M20 (and any Normandy land past the edge) get hedged small fields on earth banks past the map edges', async () => {
  const { loadGrid } = await import('./mission-check.mjs');
  const { apronBocage, bankField } = await import('../../src/art/terrain/bocage.js');
  const { buildApronField } = await import('../../src/world/apron-field.js');
  const { T } = await import('../../src/world/grid.js');
  let total = 0;
  for (const id of ['m13', 'm14', 'm15', 'm16', 'm20']) {
    const m = MISSIONS.find((q) => q.id === id);
    const { def, grid } = loadGrid(m), f = buildApronField(grid, def), b = apronBocage(f, def);
    assert.ok(b.hedgerows.length >= BOCAGE_MIN[id], `${id}: bocage hedges past the edges (${b.hedgerows.length})`);
    if (!b.hedgerows.length) continue;
    assert.equal(b.banks.length, b.hedgerows.length, `${id}: every hedge stands on a bank`);
    const plants = b.hedgerows.flatMap((h) => hedgerowPlacements(h));
    for (const p of plants) {
      const qx = Math.min(f.W, Math.max(0, p.x)), qz = Math.min(f.D, Math.max(0, p.z));
      assert.ok(Math.hypot(p.x - qx, p.z - qz) > 3.5, `${id}: hedge plant ${p.x.toFixed(1)}:${p.z.toFixed(1)} is past the map edge`);
    }
    for (const h of b.hedgerows) for (const [x, z] of h.points) assert.ok([T.GRASS, T.GROUND].includes(f.codeAt(x, z)), `${id}: hedge on soil`);
    const bank = bankField(b.banks), h0 = b.banks[0], [x0, z0] = h0.pts[0], [x1, z1] = h0.pts[1];
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L;
    const inGate = (s) => h0.gaps.some(([a, c]) => s > a - 1.3 && s < c + 1.3);
    if (!inGate(L / 2)) {
      const top = bank(mx, mz);
      assert.ok(top >= 0.95 && top <= 1.55, `${id}: bank 1-1.5 m high on the hedge line (${top.toFixed(2)})`);
      assert.ok(bank(mx + nx * 2.2, mz + nz * 2.2) < 0.05, `${id}: the bank is ~3.4 m wide at its foot`);
    }
    assert.equal(JSON.stringify(apronBocage(f, def)), JSON.stringify(b), `${id}: deterministic`);
    total += plants.length;
  }
  assert.ok(total > 1500, `bocage drawn past the edges (${total} hedge plants over M13-M16 and M20)`);
  const m01 = MISSIONS.find((q) => q.id === 'm01'), g1 = loadGrid(m01);
  assert.equal(apronBocage(buildApronField(g1.grid, g1.def), g1.def).hedgerows.length, 0, 'no bocage where the mission does not ask for it');
});
