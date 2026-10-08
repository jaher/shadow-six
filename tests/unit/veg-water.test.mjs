/**
 * Vegetation keeps off the water (user report 2026-10-08: "mission 1 there is  giant tree standing on the water, remove
 * it"). In M1 an 18 m scenery spruce stood on the fjord's waterline just past the map's E edge (its crown over the
 * water), twice the height of the map's own 9 m spruces: the apron forest copied its neighbours' kind but not their
 * size, and only kept off wet CELLS (its trunk 0.13 m from the drawn shore). M4 had a pine authored in the inlet.
 * Checked over every mission, against the drawn shore field (world/shore-field.js, the field the renderer carves the
 * banks and masks the water with — sea, lakes, rivers, reservoirs, frozen water):
 *  - the missions' own trees and bushes (after the placement rules) keep SHORE_MARGIN m of dry land;
 *  - so does everything else planted on the map (art/terrain.js plantingPlan: forest fill, understorey, hedgerows,
 *    orchards);
 *  - the apron's scenery forest keeps APRON_SHORE_MARGIN m, and its trees are the size of the map's own;
 *  - M1's waterline spruce is gone; M4's lake pine is dropped.
 */
import { test, assert } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';
import { buildApronField } from '../../src/world/apron-field.js';
import { buildShoreField } from '../../src/world/shore-field.js';
import { TREE_TYPES, treePlacement } from '../../src/art/terrain.js';
import { SPECIES } from '../../src/art/terrain/treegen.js';
import { apronTrees } from '../../src/art/apron.js';
import { CONFIG } from '../../src/config.js';
import { T } from '../../src/world/grid.js';
import * as TERRAIN from '../../src/art/terrain.js';

// (dynamic: on a build without the rule the file still loads and the checks below fail on the trees themselves)
const VS = await import('../../src/world/veg-shore.js').catch(() => ({}));
const SHORE = VS.SHORE_MARGIN ?? 1.0, APRON = VS.APRON_SHORE_MARGIN ?? 2.5;

/** A mission as the game builds it: grid + resolved placement, the shore field over map + apron (art/terrain.js). */
const built = new Map();
function mission(id) {
  if (built.has(id)) return built.get(id);
  const m = MISSIONS.find((q) => q.id === id);
  const { def, world, grid } = loadGrid(m);
  const theater = def.theater || 'temperate';
  const f = buildApronField(grid, def);
  const shore = buildShoreField(f.grid, def, { ox: f.ox, oz: f.oz, feats: f.feats, W: f.W, D: f.D });
  // as map-builder hands them to buildTerrain: point trees and forest AREAS, placement-dropped ones left out
  const S = world.placement.structures.filter((d) => !d.placementDropped && TREE_TYPES.includes(d.type));
  const trees = S.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.z)), forests = S.filter((d) => Array.isArray(d.points));
  const r = { def, world, grid, theater, f, shore, trees, forests, log: world.placement.log };
  built.set(id, r);
  return r;
}
const at = (p, w) => `${p.species ?? p.type ?? ''} (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) ${w.toFixed(2)} m`;

test('veg-water: every mission tree and bush keeps SHORE_MARGIN m of dry land from the drawn water (placement rules)', () => {
  const bad = [];
  for (const m of MISSIONS) {
    const { trees, shore } = mission(m.id);
    for (const d of trees) { const w = shore.wetAt(d.x, d.z); if (w > -SHORE) bad.push(`${m.id} ${at(d, w)}`); }
  }
  assert.deepEqual(bad, [], `mission trees / bushes at or in the water (signed distance > -${SHORE} m)`);
});

test('veg-water: nothing planted on any map stands in the water (forest fill, understorey, hedgerows, orchards)', () => {
  assert.equal(typeof TERRAIN.plantingPlan, 'function', 'art/terrain.js exports plantingPlan');
  const bad = [];
  let n = 0;
  for (const m of MISSIONS) {
    const { grid, theater, def, trees, forests, shore } = mission(m.id);
    const plan = TERRAIN.plantingPlan(grid, theater, { mission: def, trees, forests, shore });
    for (const p of [...plan.placements, ...plan.scrubHeroes]) { n++; const w = shore.wetAt(p.x, p.z); if (w > -SHORE) bad.push(`${m.id} ${at(p, w)}`); }
  }
  assert.ok(n > 400, `plants checked (${n})`);
  assert.deepEqual(bad, [], 'map plants at or in the water');
});

test('veg-water: the apron forest keeps APRON_SHORE_MARGIN m off the water past every map edge', () => {
  const bad = [];
  let n = 0;
  for (const m of MISSIONS) {
    const { f, def, trees, theater, shore } = mission(m.id);
    // no edge-run filter (createApron's `avoid`): a superset of the drawn forest
    const defs = apronTrees(f, def, trees, theater, CONFIG.apron, null, shore.wetAt);
    n += defs.length;
    for (const d of defs) { const w = shore.wetAt(d.x, d.z); if (w > -APRON) bad.push(`${m.id} ${at(d, w)}`); }
  }
  assert.ok(n > 2000, `apron trees checked (${n})`);
  assert.deepEqual(bad, [], 'apron trees at or in the water');
});

test('veg-water: M1 — the giant spruce on the fjord waterline E of the map is gone; apron trees match the map trees', () => {
  const { f, def, trees, theater, shore } = mission('m01');
  const defs = apronTrees(f, def, trees, theater, CONFIG.apron, null, shore.wetAt);
  // the reported tree: the lattice cell at (70.98, 36.9), 0.13 m from the water where the fjord leaves the map's E edge
  assert.ok(shore.wetAt(70.98, 36.9) > -APRON, 'that spot is on the waterline');
  assert.ok(!defs.some((d) => Math.hypot(d.x - 70.98, d.z - 36.9) < 1), 'no apron tree on the E waterline spot');
  // the scenery forest is the map's own forest carried on: each tree as tall as the map trees it copies (±15 %),
  // not the species' full natural height (an 18 m spruce beside 9 m map spruces read as a giant)
  const placed = (d, k) => { const p = treePlacement(d, theater, k), H = SPECIES[p.species].H; return { sp: p.species, top: H[1] * p.scale }; };
  const mapTop = Math.max(...trees.map((d, k) => placed(d, k).top));
  const tall = defs.map((d, k) => ({ d, ...placed(d, 100000 + k) })).filter((t) => t.top > mapTop * 1.15 + 0.01);
  assert.ok(defs.length > 100 && defs.every((d) => d.h > 0), `every M1 apron tree carries a size (${defs.filter((d) => d.h > 0).length} / ${defs.length})`);
  assert.deepEqual(tall.map((t) => `${t.sp} (${t.d.x}, ${t.d.z}) up to ${t.top.toFixed(1)} m`), [], `no apron tree taller than the map's tallest (${mapTop.toFixed(1)} m) + 15 %`);
});

test('veg-water: M4 — the pine authored in the inlet is dropped; M2 — the islet-shore pine steps ashore', () => {
  const m4 = mission('m04');
  assert.ok(m4.grid.terrainAt(56, 101) === T.WATER, 'M4 (56, 101) is deep water');
  assert.ok(!m4.trees.some((d) => Math.hypot(d.x - 56, d.z - 101) < 4.5), 'no M4 tree left in or by the inlet at (56, 101)');
  assert.ok(m4.log.some((l) => /no free spot near the water/.test(l)), 'the placement log names the water');
  const m2 = mission('m02');
  const p = m2.trees.find((d) => d.type === 'pine' && Math.hypot(d.x - 41.7, d.z - 83.4) < 1);
  assert.ok(p && m2.shore.wetAt(p.x, p.z) <= -SHORE, `M2 pine by the islet keeps ${SHORE} m ashore (${p && m2.shore.wetAt(p.x, p.z).toFixed(2)})`);
});

test('veg-water: cellWetAt is a signed distance to the wet cells (in > 0, out = minus the gap, clamped at -reach)', () => {
  assert.equal(typeof VS.cellWetAt, 'function', 'world/veg-shore.js cellWetAt');
  const cols = 20, rows = 20, cell = 0.5, terrain = new Uint8Array(cols * rows).fill(T.GRASS);
  for (let j = 0; j < rows; j++) for (let i = 10; i < cols; i++) terrain[j * cols + i] = T.WATER; // water from x = 5
  terrain[5 * cols + 10] = T.SHALLOW;
  const w = VS.cellWetAt({ cols, rows, cell, terrain }, 3);
  assert.ok(w(6, 5) > 0.9 && w(5.2, 5) > 0, 'in the water: positive');
  assert.ok(Math.abs(w(4, 5) + 1) < 1e-9, '1 m ashore: -1');
  assert.ok(Math.abs(w(1, 5) + 3) < 1e-9, 'far ashore: -reach');
  assert.ok(VS.onDryLand(w, 3.9, 5) && !VS.onDryLand(w, 4.2, 5), 'SHORE_MARGIN boundary');
  assert.deepEqual(VS.keepOffWater([{ x: 1, z: 1 }, { x: 4.5, z: 1 }, { x: 7, z: 1 }], w).map((p) => p.x), [1], 'keepOffWater drops the wet / surf plants');
});

test('veg-water: sward and crop tufts keep off the river bed (its mud / dry-grass splat), reeds stay in the shallows', async () => {
  const { placeGround, STRIDE } = await import('../../src/art/terrain/grass-place.js');
  const { vegetationProfile } = await import('../../src/art/terrain/veg-profile.js');
  const GROUND = VS.GROUND_SHORE_MARGIN ?? 0.5;
  // a 64 × 48 m meadow with grass weight everywhere (as the temperate bed splat gives it) and a river along z 30..34
  const sd = (x, z) => 2 - Math.abs(z - 32);
  const env = { W: 64, D: 48, heightAt: () => 0, grassW: () => ({ g: 1, dry: 0.2 }), waterSD: sd, deepSD: (x, z) => 1 - Math.abs(z - 32), sandW: () => 0 };
  const prof = vegetationProfile({ id: 'x', date: '1944-09-04' }, 'temperate');
  let wet = 0, reeds = 0, n = 0;
  for (const c of placeGround(env, prof, { perM2: 9, chunk: 16, seed: 3 })) for (const name in c.lists) {
    const a = c.lists[name];
    for (let i = 0; i < a.length / STRIDE; i++) {
      n++;
      if (name === 'reed') { if (sd(a[i * STRIDE], a[i * STRIDE + 2]) > 0) reeds++; continue; }
      if (sd(a[i * STRIDE], a[i * STRIDE + 2]) > -GROUND) wet++;
    }
  }
  assert.ok(n > 10000, `tufts placed (${n})`);
  assert.equal(wet, 0, 'grass tufts at / in the river');
  assert.ok(reeds > 30, `reeds still stand in the shallows (${reeds})`);
});
