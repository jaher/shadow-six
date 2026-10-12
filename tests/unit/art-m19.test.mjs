/** M19 art pass (Oldenburg coal mine + V-2 base): add-on manifest, hinted mine / base buildings and V-2 pad pieces and their
 * footprint fits (visual only, the mission's nav stays), the stone ruins and the whitewashed block, wrecks and the parked
 * lorry from the vehicle library, the concrete base road and the furniture (visual only). */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, libraryHinted, placeholderHinted } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { normalizeRoadNetwork } from '../../src/world/roads.js';
import { ruinedStoneWall, whitewashedBlock } from '../../src/art/mine-walls.js';
import { rng } from '../../src/art/dressing.js';
import { MISSIONS } from '../../src/missions/index.js';
import * as THREE from 'three';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const addon = JSON.parse(readFileSync(P('assets/models/buildings/manifest-oldenburg.json')));
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm19'); try { return await fn(); } finally { await useManifest(null); } };
const m19 = MISSIONS.find((m) => m.id === 'm19');
const S = (id) => m19.structures.find((s) => s.id === id);
const OWN = ['mine_office_de', 'boiler_house_de', 'barracks_corr_a', 'barracks_corr_b', 'house_tall_brick_de', 'hut_timber_de',
  'coal_hopper_de', 'bunker_obs_de', 'outhouse_de', 'kennel_de', 'v2_rocket_a4', 'v2_table_de', 'v2_gantry_de', 'coal_heap_de',
  'pit_props_de', 'pithead_adit_de', 'crane_jib_de'];

test('art m19: the Oldenburg add-on ships every LOD and sidecar under its own types; generic picks unchanged', () => {
  assert.ok(EXTRA_MANIFESTS.includes('manifest-oldenburg'));
  for (const n of [...OWN, 'drum_stack_de']) {
    const a = addon.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('temperate'), n);
  }
  const b = base(), m = merged();
  for (const t of ['house', 'hut', 'barracks', 'bunker', 'crates', 'launch_pad', 'watchtower', 'ruins']) assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m19: every hinted structure fits its gameplay footprint (≤ 15 % per axis, heaps 30 %) and keeps the mission nav', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m19.structures) {
    if (!libraryHinted(s.type, s) || s.points) continue;
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm19' });
    if (!pk || !OWN.includes(pk.name)) continue;
    seen.add(pk.name);
    assert.ok(placeholderHinted(s.type, s), `${s.id}: visual only (doors, the deck, the pithead roof stay the mission's)`);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    const tol = pk.name === 'coal_heap_de' ? 0.3 : 0.15;   // one heap model scaled onto heaps of r 2–3 m
    assert.ok(Math.abs(Math.log(w / ew)) < tol && Math.abs(Math.log(d / ed)) < tol, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  for (const n of OWN) assert.ok(seen.has(n), n);
  // the oil drums are a fuel-family type: an explicit asset with the mission's nav
  const dr = S('drums_conv');
  assert.equal(dr.asset, 'drum_stack_de'); assert.equal(dr.nav, false);
}));

test('art m19: no other mission draws an Oldenburg asset (shared variant names kept out of the hints)', () => withLib(merged(), () => {
  for (const m of MISSIONS) {
    if (m.id === 'm19') continue;
    for (const s of m.structures || []) {
      if (s.points) continue;
      const pk = pickAsset(s.type, s, { theater: m.theater, missionId: m.id });
      assert.ok(!pk || ![...OWN, 'drum_stack_de'].includes(pk.name), `${m.id} ${s.id} → ${pk?.name}`);
    }
  }
}));

test('art m19: stone ruins stay between 72 % and 110 % of their cover height; the white block stays on its 7 × 5 nav', () => {
  const box = (o) => new THREE.Box3().setFromObject(o);
  for (const id of ['ruins_a', 'ruins_b', 'wall_L']) {
    const s = S(id), g = ruinedStoneWall(s.points, s, rng(7)), b = box(g);
    assert.ok(b.max.y >= s.h * 0.72 && b.max.y <= s.h * 1.1, `${id} top ${b.max.y.toFixed(2)}`);
  }
  const w = S('white_wall'), g = whitewashedBlock(w.points, w, rng(3)), b = box(g);
  assert.ok(Math.abs(b.max.z - b.min.z - 7) < 0.25 && Math.abs(b.max.x - b.min.x - 5) < 0.25, `block ${(b.max.x - b.min.x).toFixed(2)}×${(b.max.z - b.min.z).toFixed(2)}`);
  assert.ok(Math.abs(b.max.y - w.h) < 0.05);
});

test('art m19: wrecks and the parked lorry are library vehicles; the base road and furniture are visual only', () => {
  for (const id of ['wreck_car', 'wreck_ht']) { const s = S(id); assert.ok(s.vehicleArt && s.wreck, id); }
  const lorry = S('lorry_yard');
  assert.equal(lorry.vehicleArt, 'opel_blitz_cargo'); assert.ok(!lorry.wreck); assert.ok(lorry.block <= 1);
  const net = normalizeRoadNetwork(m19);
  assert.ok(net.areas.length >= 1);
  for (const a of net.areas) { assert.equal(a.grid, false, a.id); assert.equal(a.surface, 'concrete', a.id); }
  for (const f of net.furniture) assert.equal(f.block, false, `${f.type} at ${f.x},${f.z} must not block`);
});
