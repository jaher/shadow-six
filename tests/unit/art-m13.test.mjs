/** M13 art pass (Le Havre docks): add-on manifest, hinted variants, footprint fits, granite quays and dock furniture. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, libraryHinted } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { normalizeRoadNetwork, FURNITURE_BLOCK, sampleCenterline, pointInPolygon } from '../../src/world/roads.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const addon = JSON.parse(readFileSync(P('assets/models/buildings/manifest-le-havre.json')));
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm13'); try { return await fn(); } finally { await useManifest(null); } };
const m13 = MISSIONS.find((m) => m.id === 'm13');
const OWN = ['nissen_hut', 'nissen_hut_b', 'garage_brick', 'lock_control_shack', 'lock_control_shack_b', 'crane_pillar', 'sea_lock_gate',
  'dock_cargo_a', 'dock_cargo_b', 'dock_cargo_c', 'dock_cargo_d', 'dock_cargo_e', 'dock_cargo_f', 'dock_cargo_row', 'boat_on_cradle'];

test('art m13: the Le Havre add-on ships every LOD and sidecar, registers its own types only', () => {
  assert.ok(EXTRA_MANIFESTS.includes('manifest-le-havre'));
  for (const n of OWN) {
    const a = addon.assets[n];
    assert.ok(a, n);
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(existsSync(P(`assets/models/${a.sidecar}`)), a.sidecar);
    assert.ok(a.theaters.includes('coast'), n);
  }
  const b = base(), m = merged();
  for (const t of ['crates', 'barracks', 'control_shack', 'lock_gate', 'bunker', 'garage']) {
    assert.deepEqual(m.types[t]?.variants, b.types[t]?.variants, `generic ${t} picks unchanged`);
  }
  // the sea-lock gate's two leaves swing with the lock set-piece (map-library leaf doors)
  const gate = JSON.parse(readFileSync(P('assets/models/buildings/military/sea_lock_gate.kit.json')));
  assert.deepEqual(gate.doors.map((d) => d.kind), ['leaf', 'leaf']);
});

test('art m13: each hinted M13 structure fits its gameplay footprint (≤ 15 % per axis); other missions keep their picks', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m13.structures) {
    if (!libraryHinted(s.type, s) || s.points) continue;
    const pk = pickAsset(s.type, s, { theater: 'coast', missionId: 'm13' });
    if (!pk) continue; // fuel tanks resolve through their own family
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    if (OWN.includes(pk.name) && w > 1.5 && d > 1.5) assert.ok(Math.abs(Math.log(w / ew)) < 0.15 && Math.abs(Math.log(d / ed)) < 0.15, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
  }
  for (const n of OWN) assert.ok(seen.has(n), n);
  // M3's dam shack and lock keep the placeholder-art picks
  assert.equal(pickAsset('control_shack', { id: 'x', variant: 'guard_hut_a', w: 3, d: 3 }, { theater: 'snow', missionId: 'm03' })?.name.startsWith('guard_hut_a'), true);
  assert.equal(pickAsset('crates', { id: 'cr', variant: 'crate_stack', w: 3, d: 2 }, { theater: 'coast', missionId: 'm14' })?.name, undefined, 'plain crates keep their dressing');
}));

test('art m13: granite quays are visual only, carry walls on water faces and none across a slipway; furniture never blocks', () => {
  const net = normalizeRoadNetwork(m13);
  assert.equal(net.areas.length, 5);
  for (const a of net.areas) {
    assert.equal(a.grid, false, a.id);
    assert.ok(a.quay && a.quay.edges.length >= 5, a.id);
  }
  const ramps = [[38.5, 49.5], [70, 113], [7.75, 78], [13.2, 132], [52.5, 139.5]]; // slipway mouths on the quay line
  for (const a of net.areas) for (const i of a.quay.edges) {
    const [x0, z0] = a.points[i], [x1, z1] = a.points[(i + 1) % a.points.length];
    for (const [rx, rz] of ramps) {
      const t = Math.max(0, Math.min(1, ((rx - x0) * (x1 - x0) + (rz - z0) * (z1 - z0)) / ((x1 - x0) ** 2 + (z1 - z0) ** 2 || 1)));
      assert.ok(Math.hypot(x0 + (x1 - x0) * t - rx, z0 + (z1 - z0) * t - rz) > 1.2, `${a.id} edge ${i} crosses the slipway at ${rx},${rz}`);
    }
  }
  // paving past the map border only squares off a border vertex (x 0 / 87 → -10 / 97 at the same z): snapping the
  // vertex itself skewed the SW mole's diagonal faces by 5-6 m (dirt wedge on one face, slabs out in the water on the other)
  for (const a of net.areas) for (const [x, z] of a.points) {
    if (x > -0.01 && x < 87.01) continue;
    const bx = x < 0 ? 0 : 87;
    assert.ok(a.points.some(([x2, z2]) => Math.abs(x2 - bx) < 1e-6 && Math.abs(z2 - z) < 1e-6), `${a.id}: (${x},${z}) has no border twin`);
  }
  assert.ok(net.furniture.length >= 8);
  // art pass 2: the harbour capstans and lifebuoy posts block their own post cell for movement only (B.FENCE: what is
  // drawn is what stops a man); everything else is visual only
  for (const f of net.furniture) {
    if (f.type === 'capstan' || f.type === 'lifebuoy') { assert.equal(f.block, undefined, f.id); assert.ok(FURNITURE_BLOCK[f.type] > 0 && FURNITURE_BLOCK[f.type] <= 0.45, f.type); }
    else assert.equal(f.block, false, f.id);
  }
});

test('art m13 pass 2: dock railway let into the quays, wagon on its spur, open-backed gun pit, harbour furniture on land', () => {
  const net = normalizeRoadNetwork(m13), rail = net.roads.find((r) => r.id === 'quay_rail');
  assert.ok(rail && rail.rails && rail.surface === 'setts', 'the rail road carries embedded rails in a lane of coursed setts');
  const T1 = m13.terrain[0].points, onMap = (x) => x >= 0 && x <= 87;
  for (const q of sampleCenterline(rail.points, 1, rail.spline)) if (onMap(q.x)) assert.ok(pointInPolygon(q.x, q.z, T1), `rail off the main dock at ${q.x.toFixed(1)},${q.z.toFixed(1)}`);
  const wagon = m13.structures.find((s) => s.id === 'wagon_e');
  assert.ok(wagon && wagon.type === 'train_car' && Math.abs(wagon.z - 82) < 1e-6 && wagon.rot === 0 && wagon.x + wagon.w / 2 < 86.3 - 1.5, 'the covered wagon stands on the straight E spur');
  const pit = m13.structures.find((s) => s.id === 'gun_pit'), gun = m13.vehicles.find((v) => v.id === 'pier_gun');
  assert.ok(pit && pit.ring && Math.hypot(pit.x - gun.x, pit.z - gun.z) < 1e-6, 'the parapet rings the pier gun');
  // open to the N: the Driver walks in from bearing 247-277° and the Marine passes at 304-352° and on to the E (trace of
  // the solution; the parapet's end stays ≥ 2 m off that walk)
  const a0 = ((pit.rot * 180) / Math.PI - pit.ring.arc / 2 + 360) % 360, a1 = ((pit.rot * 180) / Math.PI + pit.ring.arc / 2) % 360;
  const inWall = (b) => (a0 <= a1 ? b >= a0 && b <= a1 : b >= a0 || b <= a1);
  for (let b = 236; b <= 396; b += 4) assert.ok(!inWall(b % 360), `parapet across bearing ${b % 360}`);
  const land = m13.terrain.filter((t) => t.terrain === 'road').map((t) => t.points);
  for (const f of net.furniture.filter((x) => x.type === 'capstan' || x.type === 'lifebuoy')) assert.ok(land.some((P) => pointInPolygon(f.x, f.z, P)), `${f.type} at ${f.x},${f.z} on a quay`);
});
