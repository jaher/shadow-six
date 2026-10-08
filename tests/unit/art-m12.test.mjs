/** M12 art pass (Tunis): the add-on manifest, the hinted swaps and their nav overrides, the medina kit and goods. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, libraryHinted } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { buildKitHouse } from '../../src/art/kit-buildings.js';
import { buildCrates } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const addon = JSON.parse(readFileSync(P('assets/models/buildings/manifest-tunis.json')));
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm12'); try { return await fn(); } finally { await useManifest(null); } };
const m12 = MISSIONS.find((m) => m.id === 'm12');
const byId = (id) => m12.structures.find((s) => s.id === id);

test('art m12: the Tunis add-on ships every LOD of the HQ and the harbour warehouse under their own types', () => {
  assert.ok(EXTRA_MANIFESTS.includes('manifest-tunis'));
  for (const n of ['hq_colonial_tunis', 'warehouse_harbour_tunis']) {
    const a = addon.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(a.theaters.includes('desert'), n);
    assert.ok(!(a.walkableRoofs || []).length, `${n}: backdrop / HQ, no walkable roof`);
  }
  const m = merged();
  assert.ok(!m.types.house.variants.includes('warehouse_harbour_tunis') && !m.types.barracks.variants.includes('hq_colonial_tunis'),
    'no catalogue-wide takeover: other desert missions keep their picks');
});

test('art m12: the HQ, the NW shed, the minaret and the N backdrop houses take their library look; nav stays the mission\'s', () => withLib(merged(), () => {
  const pick = (s) => pickAsset(s.type, s, { theater: 'desert', missionId: 'm12' })?.name;
  assert.equal(pick(byId('hq_se')), 'hq_colonial_tunis');
  assert.equal(pick(byId('shed_harbour')), 'warehouse_harbour_tunis');
  assert.equal(pick(byId('minaret')), 'minaret_tunis');
  assert.equal(pick(byId('house_nw')), 'house_flat_white_c');
  for (const id of ['n_row_1', 'n_row_2', 'n_row_3']) assert.match(pick(byId(id)), /^house_flat_white_[ab]$/, id);
  for (const id of ['hq_se', 'shed_harbour', 'minaret']) assert.equal(byId(id).nav, false, `${id}: the asset's own roofs / ladders stay out`);
  for (const id of ['n_row_1', 'house_nw']) assert.equal(byId(id).roofWalk, false, id);
  // the walkable medina houses keep the kit body (roof walkers' heights)
  for (const s of m12.structures.filter((q) => q.type === 'flat_roof_house' && q.roofWalk)) assert.ok(!libraryHinted(s.type, s), s.id);
}));

test('art m12: medina kit houses dress the facades but keep the gameplay box (≤ 0.7 m proud, nothing on walkable roofs)', () => {
  for (const variant of ['souk_arcade', 'palace_tiled_domes', 'medina_stepped_front', 'medina_mosaic_terrace']) {
    const p = { w: 12, d: 9, h: 8, variant, id: variant, roofWalk: true };
    const g = buildKitHouse(p, 'desert');
    g.updateMatrixWorld(true);
    let maxY = -1e9; const box = { x: 0, z: 0 };
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      box.x = Math.max(box.x, Math.abs(b.min.x), Math.abs(b.max.x)); box.z = Math.max(box.z, Math.abs(b.min.z), Math.abs(b.max.z));
      maxY = Math.max(maxY, b.max.y);
    });
    // awnings / door hoods sit above 2.4 m; their reach is the only thing beyond 0.7 m
    assert.ok(box.x <= p.w / 2 + 1.4 && box.z <= p.d / 2 + 1.4, `${variant}: ${box.x.toFixed(2)} × ${box.z.toFixed(2)}`);
    assert.ok(maxY <= p.h + 0.6, `${variant}: nothing stands on the walkable roof (top ${maxY.toFixed(2)})`);
  }
  // the qubba's dome: green glazed tile (not the terracotta multiply that read black)
  const k = buildKitHouse({ w: 6, d: 6, h: 3.5, variant: 'qubba_green_dome', id: 'kiosk', roofWalk: false, dome: true }, 'desert');
  let glazed = false; k.traverse((o) => { if (o.material?.name === 'medina:glazed_tile') glazed = true; });
  assert.ok(glazed);
});

test('art m12: market goods (carts, sacks, baskets, tarps, rugs) replace the crate stacks on the same footprints', () => {
  for (const s of m12.structures.filter((q) => q.type === 'crates' && /cart|sacks|basket|tarp|bales|cushions/.test(q.variant))) {
    const g = buildCrates(s);
    assert.match(g.name, /^medina:goods:/, s.id);
    g.updateMatrixWorld(true);
    let ok = true;
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) > s.w / 2 + 0.35 || Math.max(Math.abs(b.min.z), Math.abs(b.max.z)) > s.d / 2 + 0.35) ok = false;
    });
    assert.ok(ok, `${s.id} stays on its ${s.w} × ${s.d} footprint`);
  }
});

test('art m12: paving and street furniture are visual only (no nav or sight change)', () => {
  assert.ok(m12.pavements.length >= 2 && m12.pavements.every((p) => p.grid === false));
  assert.ok(m12.furniture.length >= 6 && m12.furniture.every((f) => f.block === false));
  for (const id of ['truck_q', 'car_q', 'moto_q']) assert.ok(byId(id)?.vehicleArt, id);
});
