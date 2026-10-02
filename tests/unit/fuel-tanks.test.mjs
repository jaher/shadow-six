/** Fuel-tank family (docs/fuel-tanks.md): variant resolution, M2 mirror choice, unchanged gameplay footprints,
 * manifest entries (LODs, budgets, snow/destroyed links), procedural fallback, blast scale. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { fuelTankAsset, partnerOnPlusX, fuelBlastScale, isFuelStructure } from '../../src/art/fuel-tanks.js';
import { useManifest, pickAsset, assetExtents } from '../../src/art/building-props.js';
import { buildProp } from '../../src/art/props.js';
import m02 from '../../src/missions/m02_a_quiet_blow_up.js';
import m00 from '../../src/missions/m00_sandbox.js';

const P = (p) => new URL(`../../${p}`, import.meta.url);
const manifest = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const withLib = async (fn, structures = []) => { await useManifest(manifest, 'm99', structures); try { return await fn(); } finally { await useManifest(null); } };
const FAMILY = ['fuel_tank_h_cradle', 'fuel_tank_h_cradle_m', 'fuel_tank_farm_9x7', 'fuel_tank_farm_85x63', 'fuel_tank_quay_12',
  'fuel_tank_quay_11', 'fuel_tank_elevated', 'oil_tank_column', 'oil_tank_column_b', 'fuel_tank_vertical_t'];
const depots = (m02.structures || []).filter((s) => s.type === 'fueltank');

test('fuel tanks: variants map → family assets (§9 rule), by footprint and theater', () => {
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'horizontal_cradle', w: 9, d: 3.4 }), 'fuel_tank_h_cradle');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 9, d: 7 }, { theater: 'desert' }), 'fuel_tank_farm_9x7');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 8.5, d: 6.3 }, { theater: 'desert' }), 'fuel_tank_farm_85x63');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 12, d: 4.5 }, { theater: 'coast' }), 'fuel_tank_quay_12');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 11, d: 4.5 }, { theater: 'coast' }), 'fuel_tank_quay_11');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 9, d: 3.4 }, { theater: 'desert' }), 'fuel_tank_h_cradle');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_elevated', w: 5, d: 3 }), 'fuel_tank_elevated');
  const cols = ['tank_w1', 'tank_w2', 'tank_w3', 'tank_q1', 'tank_q2'].map((id) => fuelTankAsset({ id, type: id.includes('q') ? 'barrels' : 'fueltank', variant: 'oil_tanks_vertical', r: 1.75 }));
  assert.ok(cols.every((n) => n === 'oil_tank_column' || n === 'oil_tank_column_b') && new Set(cols).size === 2, cols.join());
  assert.equal(fuelTankAsset({ type: 'fueltank', r: 2 }, { theater: 'temperate' }), 'fuel_tank_vertical_t');   // sandbox depot
  assert.equal(fuelTankAsset({ type: 'fueltank', r: 2 }, { theater: 'desert' }), 'oil_tank_column');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'something_else' }), null);                        // unknown hint → generic
  assert.equal(fuelTankAsset({ type: 'barrels', variant: 'fuel_explosive' }), null);                         // plain drums are not tanks
  assert.ok(isFuelStructure({ type: 'barrels', variant: 'oil_tanks_vertical' }) && !isFuelStructure({ type: 'house' }));
  // a missing asset falls back along the family, never to an unrelated model
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 8.5, d: 6.3 }, { theater: 'desert', has: (n) => n === 'fuel_tank_farm_9x7' }), 'fuel_tank_farm_9x7');
  assert.equal(fuelTankAsset({ type: 'fueltank', variant: 'fuel_tank_elevated' }, { has: () => false }), null);
});

test('fuel tanks: M2 depot pair keeps feat/align footprints; stands on the OUTER ends (mirror on depot_a)', () => {
  assert.equal(depots.length, 2);
  for (const s of depots) {
    assert.equal(s.variant, 'horizontal_cradle'); assert.equal(s.w, 9); assert.equal(s.d, 3.4); assert.equal(s.h, 3.5);
    near(s.rot, 40.8 * Math.PI / 180, 1e-6);
  }
  const [a, b] = [depots.find((s) => s.id === 'depot_a'), depots.find((s) => s.id === 'depot_b')];
  assert.ok(partnerOnPlusX(a, depots) && !partnerOnPlusX(b, depots));
  assert.equal(fuelTankAsset(a, { structures: depots }), 'fuel_tank_h_cradle_m');
  assert.equal(fuelTankAsset(b, { structures: depots }), 'fuel_tank_h_cradle');
});

test('fuel tanks: building-props picks the family with a 1:1 fit on the gameplay footprint', () => withLib(() => {
  for (const s of depots) {
    const pk = pickAsset('fueltank', s, { theater: 'snow', missionId: 'm02', structures: depots });
    assert.equal(pk.name, s.id === 'depot_a' ? 'fuel_tank_h_cradle_m' : 'fuel_tank_h_cradle');
    near(pk.ext.w, 9, 0.01); near(pk.ext.d, 3.4, 0.01); near(pk.ext.cx, 0, 0.01); near(pk.ext.cz, 0, 0.01);
    assert.equal(pk.turn, 0);
  }
  const sb = (m00.structures || []).find((s) => s.type === 'fueltank');
  assert.equal(pickAsset('fueltank', { ...sb, r: 2 }, { theater: m00.theater || 'temperate' }).name, 'fuel_tank_vertical_t');
  for (const [n, w, d] of [['fuel_tank_farm_9x7', 9, 7], ['fuel_tank_farm_85x63', 8.5, 6.3], ['fuel_tank_quay_12', 12, 4.5], ['fuel_tank_quay_11', 11, 4.5], ['fuel_tank_elevated', 5, 3]]) {
    const e = assetExtents(n);
    near(e.w, w, 0.05); near(e.d, d, 0.05);
  }
}, depots));

test('fuel tanks: manifest entries — 3 LODs under 1 MB, budgets, snow + destroyed variants linked, files shipped', () => {
  const A = manifest.assets;
  for (const n of FAMILY) {
    const e = A[n];
    assert.ok(e, `${n} in manifest`);
    assert.ok(manifest.types.fueltank.variants.includes(n), `${n} is a fueltank variant`);
    assert.equal(e.lods.length, 3);
    for (const l of e.lods) { assert.ok(l.bytes < 1 << 20, `${l.file} ${l.bytes}`); assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url); }
    assert.ok(e.lods[0].tris <= 18000 && e.lods[2].tris < e.lods[1].tris && e.lods[1].tris < e.lods[0].tris, `${n} tris ${e.lods.map((l) => l.tris)}`);
    const dv = e.destroyedVariant;
    assert.ok(dv && A[dv]?.destroyed && A[dv].types.includes('ruins'), `${n} → ${dv}`);
    assert.ok(A[dv].lods[0].tris <= e.lods[0].tris * 1.25, `${dv} within intact + 25 %`);
    assert.ok(e.anchors.some((a) => a.name === 'blast_origin'), `${n} blast_origin`);
  }
  for (const n of ['fuel_tank_h_cradle', 'fuel_tank_h_cradle_m']) {
    const s = A[A[n].snowVariant];
    assert.ok(s?.snow && A[s.destroyedVariant]?.destroyed && s.destroyedVariant.endsWith('_destroyed_snow'), n);
  }
  // walkable decks where guards stand (M8 deck block 4.5 m, M17 platform 2.6 m); the M2 catwalk is not a walkway
  near(A.fuel_tank_farm_9x7.walkableRoofs[0].elev, 4.5, 0.01);
  near(A.fuel_tank_elevated.walkableRoofs[0].elev, 2.6, 0.01);
  assert.equal(A.fuel_tank_h_cradle.walkableRoofs.length, 0);
  assert.equal(A[A.fuel_tank_farm_9x7.destroyedVariant].walkableRoofs.length, 0, 'the collapsed deck is no walkway');
  // M17: the spinnable valve node + spout anchor
  const el = A.fuel_tank_elevated;
  assert.ok(el.nodes.includes('valve') && el.anchors.some((a) => a.name === 'valve' && a.node === 'valve'));
  const sp = el.anchors.find((a) => a.name === 'spout');
  assert.ok(sp && sp.pos[0] < -2.5 && sp.pos[1] < 1, JSON.stringify(sp));
  assert.ok(existsSync(P('assets/textures/lib/1k/fuel_stencils_rgba.png')) && existsSync(P('assets/textures/lib/1k/fuel_grating_rgba.png')));
});

test('fuel tanks: procedural fallback (no library) — dished horizontal tank + vertical branch, light, footprints unchanged', () => {
  const tris = (o) => { let t = 0; o.traverse((m) => { if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return t; };
  for (const s of depots) {
    const r = buildProp('fueltank', s, { theater: 'snow', library: false });
    assert.ok(tris(r.object3d) < 1500, `tris ${tris(r.object3d)}`);
    assert.equal(r.interactables[0].interactKind, 'explosiveTarget');
    near(r.interactables[0].radius, 4.5, 1e-6);
  }
  const v = buildProp('fueltank', { id: 'fd', x: 52, z: 38, destructible: true, hp: 100 }, { theater: 'temperate', library: false });
  assert.ok(tris(v.object3d) < 1500 && v.footprints[0].shape === 'circle' && v.footprints[0].r === 2);
  const e = buildProp('fueltank', { id: 'ft', variant: 'fuel_tank_elevated', x: 0, z: 0, w: 5, d: 3, h: 6 }, { library: false });
  assert.ok(tris(e.object3d) > 50 && tris(e.object3d) < 1500);
});

test('fuel tanks: blast scale grows with the tank (M2 tank ≈ 1, M8 block bigger, drums floor)', () => {
  const m2 = fuelBlastScale({ w: 9, d: 3.4, h: 3.5 }), m8 = fuelBlastScale({ w: 9, d: 7, h: 4.5 }), sb = fuelBlastScale({ r: 2, h: 4 });
  near(m2.scale, 1, 0.06);
  assert.ok(m8.scale > m2.scale && m8.fire >= m2.fire && sb.fire >= 2.5 && sb.scale < m2.scale);
  for (const k of [m2, m8, sb]) assert.ok(k.fire <= 7.5 && k.scale <= 1.6 && k.smoke <= 1.6);
});

test('fuel tanks: M8 drum dumps (barrels oil_tanks_vertical, w × d, h 2.2) stay generic; M11 columns stay columns', () => {
  const drums = { id: 'drums_w1', type: 'barrels', variant: 'oil_tanks_vertical', x: 4.75, z: 63.75, rot: 0, w: 6.5, d: 7.5, h: 2.2, block: 2 };
  assert.equal(isFuelStructure(drums), false);
  assert.equal(fuelTankAsset(drums, { theater: 'desert' }), null);
  assert.equal(fuelTankAsset({ ...drums, id: 'drums_w2', w: 3.5, d: 7 }, { theater: 'desert' }), null);
  const q = { id: 'tank_q1', type: 'barrels', variant: 'oil_tanks_vertical', r: 1.75, h: 7 };
  assert.ok(isFuelStructure(q) && /^oil_tank_column/.test(fuelTankAsset(q, { theater: 'desert' })));
  return withLib(() => { assert.notEqual(pickAsset('barrels', drums, { theater: 'desert' })?.name?.startsWith('oil_tank_column'), true); });
});

test('fuel tanks: a wreck keeps its footprint (§7); an M8 deck block drops its walkway, ladder and the men on it', async () => {
  const THREE = await import('three');
  const { World } = await import('../../src/world/world.js');
  const { B } = await import('../../src/world/grid.js');
  const { buildMap } = await import('../../src/world/map-builder.js');
  const base = JSON.parse(JSON.stringify(m00));
  const tank = { id: 'tank_b', type: 'fueltank', variant: 'fuel_tank_horizontal', x: 20, z: 20, rot: 0, w: 9, d: 7, h: 4.5,
    destructible: true, destroyedBy: ['explosion'], hp: 100, walkways: [{ id: 'tank_b_deck', points: [[15.75, 20], [24.25, 20]], width: 7, y: 4.5 }] };
  const def = { ...base, structures: [tank, { id: 'cradle', type: 'fueltank', variant: 'horizontal_cradle', x: 40, z: 20, rot: 0, w: 9, d: 3.4, h: 3.5, destructible: true, hp: 100 }],
    enemies: [], interactables: [], ladders: [{ id: 'ladder_b', x: 22, z: 24.5, y: 0, top: [22, 22.8, 4.5], raised: false, heading: -Math.PI / 2 }], climbLinks: [] };
  const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def });
  buildMap(world, def);
  const g = world.grid;
  assert.ok(g.elevAt(20, 20) > 4.3, 'deck raised before');
  const lad = world.ladders.find((l) => l.id === 'ladder_b');
  assert.ok(lad && g.links.find((l) => l.id === lad.linkId)?.enabled, 'ladder usable before');
  const onDeck = { alive: true, x: 21, z: 19, takeDamage() { this.alive = false; } };
  const below = { alive: true, x: 30, z: 20, takeDamage() { this.alive = false; } };
  world.enemies.push(onDeck, below);
  const it = world.byId('tank_b'), cr = world.byId('cradle');
  it.destroy(null, 'explosion'); cr.destroy(null, 'explosion');
  assert.ok(g.elevAt(20, 20) < 0.5, `deck fell (elev ${g.elevAt(20, 20)})`);
  assert.equal(g.blockAt(22, 18), B.HIGH, 'wreck blocks (HIGH) where the deck stood');
  assert.equal(g.blockAt(16.5, 22.5), B.LOW, 'collapsed corner (local −X/+Z) is LOW');
  assert.equal(g.links.find((l) => l.id === lad.linkId)?.enabled, false, 'ladder to the fallen deck disabled');
  assert.equal(onDeck.alive, false, 'the man on the deck went down with it');
  assert.equal(below.alive, true);
  assert.equal(g.blockAt(40, 20), B.HIGH, 'M2-style cradle wreck still blocks its footprint');
});

test('fuel tanks: M11 pipe runs join neighbouring columns (≤ 9 m, clear lines), once per pair; drum dumps excluded', async () => {
  const { pipeRunPairs } = await import('../../src/art/fuel-pipes.js');
  const { tankYard } = await import('../../src/missions/dev/tank-yard.js');
  const runs = pipeRunPairs(tankYard('desert').structures);
  const ids = runs.map((r) => `${r.owner.id}-${r.other.id}`).sort();
  assert.deepEqual(ids, ['tank_q1-tank_q2', 'tank_w1-tank_w2', 'tank_w2-tank_w3']);
  for (const r of runs) assert.ok(r.len > 3 && r.len < 6.5, `${ids}: run length ${r.len.toFixed(2)}`);
  // a structure on the line drops the run
  const blocked = pipeRunPairs([...tankYard('desert').structures, { id: 'hut', type: 'house', x: 75, z: 60.5, w: 1.5, d: 1.5, rot: 0 }]);
  assert.ok(!blocked.some((r) => r.owner.id === 'tank_w1'), 'w1-w2 run dropped when a hut stands on its line');
});

test('fuel tanks: the dev tank yard builds (M8 decks raised, columns + quarry columns block, drum dumps generic)', async () => {
  const THREE = await import('three');
  const { World } = await import('../../src/world/world.js');
  const { B } = await import('../../src/world/grid.js');
  const { buildMap } = await import('../../src/world/map-builder.js');
  const { normalizeMission } = await import('../../src/missions/schema.js');
  const { tankYard } = await import('../../src/missions/dev/tank-yard.js');
  const def = normalizeMission(tankYard('desert'));
  const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def });
  buildMap(world, def);
  const g = world.grid;
  assert.ok(g.elevAt(24, 22) > 4.3 && g.elevAt(33.2, 15) > 4.3, 'M8 decks walkable at 4.5');
  assert.equal(g.blockAt(92, 75), B.HIGH, 'quarry column (explosive barrels) blocks its r 1.75 circle');
  assert.equal(g.blockAt(78, 58), B.HIGH, 'yard column blocks');
  const q = world.byId('tank_q1');
  assert.ok(q && q.interactKind === 'barrel' && q.params.carriable === false && q.canUse({ role: 'sapper' }) !== true, 'quarry column is a non-carriable barrel entity');
});
