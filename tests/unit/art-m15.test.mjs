/** M15 art pass (Compiegne): add-on manifest, hinted Second-Empire blocks / chapel / tombs and their footprint fits, the
 * paved streets (visual only), street furniture, the bridges' gameplay-only data and the balcony uniform rack. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, libraryHinted, placeholderHinted } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { normalizeRoadNetwork, pointInPolygon } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';
import { LEVEL, S1, S2 } from '../../src/missions/m15_the_end_of_the_butcher.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const addon = JSON.parse(readFileSync(P('assets/models/buildings/manifest-compiegne.json')));
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm15'); try { return await fn(); } finally { await useManifest(null); } };
const m15 = MISSIONS.find((m) => m.id === 'm15');
const OWN = ['townhouse_corner_w', 'townhouse_corner_flat', 'townhouse_corner_turret', 'townhouse_fr_stucco', 'mausoleum_chapel',
  'tomb_chest_a', 'tomb_chest_b', 'tomb_chest_c'];

test('art m15: the Compiegne add-on ships every LOD and sidecar under its own types; generic picks unchanged', () => {
  assert.ok(EXTRA_MANIFESTS.includes('manifest-compiegne'));
  for (const n of OWN) {
    const a = addon.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('temperate'), n);
  }
  // own types (townhouse_fr, chapel_fr, tomb): the blocks are named picks only, no unhinted house of another mission draws one
  const b = base(), m = merged();
  for (const t of ['house', 'flat_roof_house', 'crates', 'barracks', 'villa', 'ruins']) assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
});

test('art m15: every hinted structure fits its gameplay footprint (≤ 15 % per axis) and keeps the mission nav', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m15.structures) {
    if (!libraryHinted(s.type, s) || s.points) continue;
    const pk = pickAsset(s.type, s, { theater: 'temperate', missionId: 'm15' });
    if (!pk || !OWN.includes(pk.name)) continue;
    seen.add(pk.name);
    assert.ok(placeholderHinted(s.type, s), `${s.id}: visual only (balcony, roof R, ladders, doors stay the mission's)`);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    assert.ok(Math.abs(Math.log(w / ew)) < 0.15 && Math.abs(Math.log(d / ed)) < 0.15, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  for (const n of OWN) assert.ok(seen.has(n), n);
}));

test('art m15: the setts are visual only, never pave a lawn, the fuel lot, a ruin floor or a basin; walks are soft', () => {
  const net = normalizeRoadNetwork(m15);
  assert.ok(net.areas.length >= 5);
  const keep = m15.terrain.filter((t) => t.type === 'poly' && t.terrain !== 'road');
  for (const a of net.areas) {
    assert.equal(a.grid, false, a.id);
    assert.equal(a.surface, 'setts', a.id);
    if (/^slip_/.test(a.id)) continue; // the stair slips: checked below
    for (const t of keep) {                      // the centroid of every lawn / lot / basin lies outside every paved piece
      const cx = t.points.reduce((q, p) => q + p[0], 0) / t.points.length, cz = t.points.reduce((q, p) => q + p[1], 0) / t.points.length;
      assert.ok(!pointInPolygon(cx, cz, a.points), `${a.id} over ${t.terrain} at ${cx.toFixed(1)},${cz.toFixed(1)}`);
    }
  }
  // (art pass 2) the stair flights S1 / S2 are drawn as cobbled slipways laid exactly on their shallow strips (visual
  // only): no other piece of paving goes into a basin
  const slips = net.areas.filter((a) => /^slip_/.test(a.id));
  assert.deepEqual(slips.map((a) => a.id).sort(), ['slip_s1', 'slip_s2']);
  for (const [a, S] of [[slips.find((q) => q.id === 'slip_s1'), S1], [slips.find((q) => q.id === 'slip_s2'), S2]]) {
    assert.deepEqual(a.points.map((p) => [+p[0], +p[1]]), S.map((p) => [+p[0], +p[1]]), `${a.id} on its stair strip`);
  }
  for (const r of net.roads) { assert.equal(r.grid, false, r.id); assert.equal(r.surface, 'gravel', r.id); }
  for (const f of net.furniture) assert.equal(f.block, false, `${f.type} at ${f.x},${f.z} must not block`);
});

test('art m15: bridges are gameplay only (no stretched drawbridge), wrecks are library cars, the rack stands on balcony B', () => {
  for (const id of ['bridge_w', 'bridge_e']) assert.equal(m15.structures.find((s) => s.id === id).visual, false, id);
  for (const id of ['wreck_1', 'wreck_2']) { const s = m15.structures.find((q) => q.id === id); assert.ok(s.vehicleArt && s.wreck, id); }
  const rack = m15.interactables.find((i) => i.interactKind === 'clothesline');
  assert.equal(rack.visualY, LEVEL.B);
  assert.ok(Math.hypot(rack.visualAt[0] - rack.x, rack.visualAt[1] - rack.z) < 1.2, 'the rack stays by its use point');
});

test('art m15 (pass 2): set dressing spread in, off every guard beat and the start; heaps are own geometry inside their footprint', async () => {
  const { M15_DRESSING } = await import('../../src/art/m15-dressing.js');
  const { buildBrickHeap } = await import('../../src/art/brick-rubble.js');
  const THREE = await import('three');
  const pts = [];
  for (const e of m15.enemies) {
    pts.push([e.x, e.z]);
    const r = e.route?.points || [];
    for (let k = 0; k < r.length; k++) {
      const a = r[k], c = r[(k + 1) % r.length];
      for (let t = 0; t <= 1; t += 0.05) pts.push([a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t]);
    }
  }
  assert.ok(M15_DRESSING.length >= 12);
  for (const s of M15_DRESSING) {
    assert.ok(m15.structures.find((q) => q.id === s.id), `${s.id} in the mission`);
    const half = Math.hypot(s.w ?? 1, s.d ?? 1) / 2;
    const d = Math.min(...pts.map(([px, pz]) => Math.hypot(px - s.x, pz - s.z))) - half;
    assert.ok(d > 1.5, `${s.id} ${d.toFixed(1)} m from the nearest guard / beat`);
    for (const c of m15.commandos) assert.ok(Math.hypot(s.x - c.x, s.z - c.z) > 8, `${s.id} off the start`);
    for (const v of m15.vehicles.filter((q) => q.id !== 'tram')) assert.ok(Math.hypot(s.x - v.x, s.z - v.z) > 4.5, `${s.id} off ${v.id}`);
  }
  // a heap draws its own rubble (never a library house) and stays inside its footprint, no higher than its crest
  for (const s of M15_DRESSING.filter((q) => q.variant === 'brick_heap')) {
    assert.equal(libraryHinted('ruins', s), false, s.id);
    assert.equal(s.block, 1, `${s.id} low cover`);
    const g = buildBrickHeap(s); g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    assert.ok(b.max.x <= s.w / 2 + 0.05 && b.min.x >= -s.w / 2 - 0.05 && b.max.z <= s.d / 2 + 0.05 && b.min.z >= -s.d / 2 - 0.05, `${s.id} plan inside ${s.w} × ${s.d}`);
    assert.ok(b.max.y <= s.h + 0.06, `${s.id} crest ${b.max.y.toFixed(2)} ≤ ${s.h}`);
    let meshes = 0; g.traverse((o) => { if (o.isMesh) meshes++; });
    assert.ok(meshes <= 4, `${s.id} merged per material (${meshes})`);
  }
  // the parked despatch vehicles are library models; the dressed-stone basins grow no reeds
  const vm = JSON.parse(readFileSync(P('assets/models/vehicles/manifest.json')));
  for (const s of M15_DRESSING.filter((q) => q.vehicleArt)) assert.ok((vm.assets || vm)[s.vehicleArt], s.vehicleArt);
  assert.equal(m15.vegetation.reeds, false);
});
