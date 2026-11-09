/**
 * The blown-up Leopold (user: "The Leopold train should look more realistic when burning. It looks like a flat black
 * rectangle") and every destructible without a modelled wreck: art/railgun-wreck.js builds the K5's wreck from the gun's
 * own model — its bounds kept (no 0.35 slump), drawn in charred copies of its own textured materials, the barrel off its
 * elevation, debris on the ground; entities/interactables.js burns any other model in place (art/wreck-char.js) with
 * charred materials cached per source material, never a flat black one, never squashed.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { buildRailgunWreck, BARREL_DROP } from '../../src/art/railgun-wreck.js';
import { charMaterial, charObject, isCharred, charKind, addCharSpots, resetCharSpots, charSpots, CHAR_SPOTS, structureSpots, charWarmClone } from '../../src/art/wreck-char.js';
import { Interactable } from '../../src/entities/interactables.js';
import { staticVehicleAsset, WRECK_BUILDERS } from '../../src/art/static-vehicles.js';
import { MISSIONS } from '../../src/missions/index.js';

/** A K5-shaped library instance (vehicle-library buildInstance shape): carriage, barrel on its trunnions, hoist, bogie. */
function fakeK5() {
  const paint = new THREE.MeshPhysicalMaterial({ name: 'rail:rivet', vertexColors: true, roughness: 0.9 });
  paint.map = new THREE.Texture(); paint.normalMap = new THREE.Texture();
  const grating = new THREE.MeshStandardMaterial({ name: 'kit:steel_grating~666666', metalness: 0.6, vertexColors: true });
  const mesh = (geo, mat, x, y, z) => {
    const g = geo.toNonIndexed();
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.04), 3));
    g.setAttribute('uv1', g.attributes.uv.clone());
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return m;
  };
  const lod = (seg) => {
    const l = new THREE.Group();
    const main = new THREE.Group(); main.name = 'main';
    main.add(mesh(new THREE.BoxGeometry(2.9, 1.8, 27, seg, seg, seg * 4), paint, 0, 1.7, 0));           // the carriage
    main.add(mesh(new THREE.BoxGeometry(3.8, 0.12, 25.2, seg, 1, seg * 4), grating, 0, 2.57, 0));        // the walkway deck
    const gun = new THREE.Group(); gun.name = 'gun'; gun.position.set(0, 4.1, -1);
    gun.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 22, 12, 4).rotateX(Math.PI / 2), paint, 0, 0, 8.2));
    const hoist = new THREE.Group(); hoist.name = 'hoist'; hoist.position.set(-0.9, 2.62, -7.2);
    hoist.add(mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), paint, 0, 1.3, 0));
    const bogie = new THREE.Group(); bogie.name = 'bogie_r'; bogie.position.set(0, 0.6, -8.6);
    bogie.add(mesh(new THREE.BoxGeometry(2.3, 0.8, 8), paint, 0, 0, 0));
    l.add(main, gun, hoist, bogie);
    return l;
  };
  const root = new THREE.Group(); root.name = 'railgun_k5_grey';
  const lods = new Map([[0, lod(4)], [2, lod(1)]]);
  for (const [i, l] of lods) { l.name = `railgun_k5_grey_lod${i}`; root.add(l); }
  return { model: 'railgun_k5_grey', root, lods, meta: { group: 'rail', parts: [], toggles: {} }, paint, grating };
}

const boxOf = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

test('Leopold wreck: the K5 keeps its bounds (no 0.35 slump), every mesh draws a charred copy of its own textured material', () => {
  const inst = fakeK5();
  const before = boxOf(inst.lods.get(0));
  const w = buildRailgunWreck(inst, { id: 'leopold' });
  assert.equal(w.lods.size, 2, 'every level of detail');
  for (const [i, l] of w.lods) {
    assert.equal(l.scale.y, 1, `lod ${i}: no squash`);
    const b = boxOf(l), b0 = boxOf(inst.lods.get(i));
    const h0 = b0.max.y - b0.min.y, h = b.max.y - b.min.y;
    assert.ok(h >= 0.85 * h0, `lod ${i}: ${h.toFixed(2)} m tall of ${h0.toFixed(2)}`);
    assert.ok(Math.abs((b.max.z - b.min.z) - (b0.max.z - b0.min.z)) < 0.12 * (b0.max.z - b0.min.z), `lod ${i}: its length`);
    assert.ok(Math.abs((b.max.x - b.min.x) - (b0.max.x - b0.min.x)) < 0.6, `lod ${i}: its width`);
  }
  assert.ok(boxOf(inst.lods.get(0)).equals(before), 'the intact model is untouched');
  // materials: the charred copy of each source (cached: the same copy for every mesh drawing that source), its maps kept
  const seen = new Map();
  w.lods.get(0).traverse((o) => {
    if (!o.isMesh) return;
    assert.ok(isCharred(o.material), `${o.name || o.parent?.name}: charred`);
    assert.ok(o.material.color.getHex() !== 0x1d1a17, 'not the flat burnt colour');
    assert.match(o.material.customProgramCacheKey(), /char1:/);
    const src = o.material.name.replace(/#char$/, '');
    if (seen.has(src)) assert.equal(seen.get(src), o.material, `${src}: one charred copy`);
    seen.set(src, o.material);
  });
  assert.equal(seen.get('rail:rivet').map, inst.paint.map, 'the paint keeps its texture (rivets, seams read through the soot)');
  assert.equal(seen.get('rail:rivet').normalMap, inst.paint.normalMap);
  assert.equal(seen.get('rail:rivet'), charMaterial(inst.paint), 'cached per source material');
  assert.ok(seen.size >= 2, 'one per source material');
});

test('Leopold wreck: barrel off its elevation, hoist knocked over, the plating torn and blown out at the charge, debris on the ground', () => {
  const inst = fakeK5();
  const w = buildRailgunWreck(inst, { id: 'leopold', charge: null });
  const muzzle = (l) => { l.updateMatrixWorld(true); const g = l.getObjectByName('gun'); return new THREE.Vector3(0, 0, 19.2).applyMatrix4(g.matrixWorld); };
  const m0 = muzzle(inst.lods.get(0)), m1 = muzzle(w.lods.get(0));
  assert.ok(m0.y - m1.y > 19.2 * Math.sin((BARREL_DROP.pitchDeg - 1) * Math.PI / 180), `the muzzle drops (${m0.y.toFixed(2)} → ${m1.y.toFixed(2)} m)`);
  const h0 = inst.lods.get(0).getObjectByName('hoist').quaternion, h1 = w.lods.get(0).getObjectByName('hoist').quaternion;
  assert.ok(h0.angleTo(h1) > 0.4, 'the hoist is knocked over');
  const kept = buildRailgunWreck(fakeK5(), { id: 'leopold', barrelDrop: false });
  assert.ok(Math.abs(muzzle(kept.lods.get(0)).y - m0.y) < 1e-6, 'no barrelDrop in its destroyFx: the barrel stays');
  // the carriage near the charge (default: beside the rear end, SW side) is torn: corners moved, triangles blown out
  let moved = 0, lost = 0;
  const body = (l) => { l.updateMatrixWorld(true); const a = []; l.traverse((o) => { if (o.isMesh && o.parent?.name === 'main' && o.material.name.startsWith('rail')) a.push(o); }); return a[0]; };
  const b1 = body(w.lods.get(0)), g0 = body(inst.lods.get(0)).geometry, g1 = b1.geometry;
  assert.notEqual(g0, g1, 'the torn carriage has its own geometry (the library\'s is shared)');
  const tri = (g) => g.attributes.position.count / 3;
  lost = tri(g0) - tri(g1);
  const p = g1.attributes.position;
  const v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k).applyMatrix4(b1.matrixWorld); if (v.y > 2.75 && v.z < -8 && v.x < 0) moved++; }
  assert.ok(moved > 0, 'the deck by the charge is curled up');
  assert.ok(tri(g1) > 0 && (lost !== 0), 'tessellated round the blast, holes blown');
  // debris: on the ground (y ≈ 0), round the charge, beside the carriage
  assert.ok(w.debris?.isMesh, 'debris');
  const db = boxOf(w.debris);
  assert.ok(db.min.y > -0.15 && db.max.y < 1.6, `on the ground (y ${db.min.y.toFixed(2)}..${db.max.y.toFixed(2)})`);
  assert.ok(db.min.x < -2 && db.min.z > -20 && db.max.z < 0, 'round the charge, the blast side');
  assert.ok(isCharred(w.debris.material), 'charred too');
  // hot spots: the fire along the carriage and the charge
  assert.ok(w.spots.length >= 5 && w.spots.every((s) => Number.isFinite(s.x + s.y + s.z + s.r)), 'hot spots');
  w.dispose();
});

test('Leopold wreck: deterministic (seeded by the structure id)', () => {
  const a = buildRailgunWreck(fakeK5(), { id: 'leopold' }), b = buildRailgunWreck(fakeK5(), { id: 'leopold' });
  const arr = (w) => { const out = []; w.root.traverse((o) => { if (o.isMesh) out.push(...o.geometry.attributes.position.array.slice(0, 600)); }); return out; };
  assert.deepEqual(arr(a), arr(b));
  const c = buildRailgunWreck(fakeK5(), { id: 'other' });
  assert.notDeepEqual(Array.from(c.debris.geometry.attributes.position.array.slice(0, 60)), Array.from(a.debris.geometry.attributes.position.array.slice(0, 60)), 'another id, other debris');
});

test('Leopold: M6\'s railway gun is the library K5 with a built wreck, the destroy fx asks for the barrel drop', () => {
  const m6 = MISSIONS.find((m) => m.id === 'm06');
  const s = m6.structures.find((q) => q.id === 'leopold');
  assert.equal(staticVehicleAsset(s.type, s.variant, s), 'railgun_k5');
  assert.equal(WRECK_BUILDERS.railgun_k5, buildRailgunWreck);
  assert.ok(s.destroyFx.includes('barrelDrop') && s.marker === 'leopold_charge');
});

test('destroyed without a modelled wreck: the model burns in place — no squash, charred copies cached per source material', () => {
  const stone = new THREE.MeshStandardMaterial({ name: 'kit:stone', color: 0x8a8378 });
  const timber = new THREE.MeshStandardMaterial({ name: 'kit:timber_dark', color: 0x5a4a3a });
  const house = () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), stone), new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.2, 4.4), timber), new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stone));
    return g;
  };
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshStandardMaterial({ name: 'flag_cloth' })); flag.name = 'flag_cloth';
  const h1 = house(); h1.add(flag);
  const a = new Interactable({ interactKind: 'explosiveTarget', x: 10, z: 10, object3d: h1, structure: { id: 'barr', type: 'barracks', x: 10, z: 10, w: 6, d: 4, h: 3 } });
  const b = new Interactable({ interactKind: 'explosiveTarget', x: 30, z: 10, object3d: house(), structure: { id: 'barr2', type: 'barracks', x: 30, z: 10, w: 6, d: 4, h: 3 } });
  assert.equal(a.wreckLook(), 'char');
  a._applyDestroyedState(); b._applyDestroyedState();
  // (its own meshes: the ruin's extras — rafters, the soot skirt decal — are art/char-ruin.js's)
  const own = (it, fn) => it.object3d.traverse((o) => { let ex = false; for (let q = o; q; q = q.parent) if (q.name === 'char-ruin') ex = true; if (o.isMesh && o.visible && !ex) fn(o); });
  for (const it of [a, b]) {
    assert.equal(it.object3d.scale.y, 1, 'no slump');
    own(it, (o) => { assert.ok(isCharred(o.material)); assert.notEqual(o.material.color.getHex(), 0x1d1a17); });
  }
  assert.equal(flag.visible, false, 'its flag burnt away');
  const mats = new Set();
  for (const it of [a, b]) own(it, (o) => mats.add(o.material));
  assert.equal(mats.size, 2, 'two source materials → two charred copies, shared by both wrecks and all their meshes');
  assert.equal(charMaterial(stone).name, 'kit:stone#char');
  const before = []; a.object3d.traverse((o) => { if (o.isMesh) before.push(o.material); });
  charObject(a.object3d, { double: true });
  const after = []; a.object3d.traverse((o) => { if (o.isMesh) after.push(o.material); });
  assert.deepEqual(after, before, 'idempotent: a charred copy is never charred again');
  assert.equal(new Set([...mats].map((m) => m.uuid)).size, 2);
});

test('destroyed: wreckLook — a gate smashes, a modelled wreck swaps, a library building without a ruin burns, a bunker is wrecked', () => {
  const o = (ud = {}) => { const g = new THREE.Group(); Object.assign(g.userData, ud); return g; };
  const it = (obj, S = {}) => new Interactable({ interactKind: 'explosiveTarget', x: 0, z: 0, object3d: obj, structure: S });
  assert.equal(it(o({ destroy: () => true, hasWreck: () => true })).wreckLook(), 'model');
  assert.equal(it(o({ destroy: () => false, hasWreck: () => false })).wreckLook(), 'char');
  assert.equal(it(o({ destroy: () => true })).wreckLook(), 'model', '(no hasWreck: trusted)');
  assert.equal(it(o(), { type: 'bunker' }).wreckLook(), 'bunker');
  assert.equal(it(null).wreckLook(), null);
});

test('wreck char: hot spot table per world (capped, oldest dropped), material kinds, warm-up copy', () => {
  const w1 = {}, w2 = {};
  resetCharSpots();
  addCharSpots(w1, structureSpots({ x: 5, z: 5, w: 6, d: 4, h: 3 }, 0, 'a'));
  assert.equal(charSpots().length, 2);
  addCharSpots(w2, [{ x: 1, y: 0, z: 1, r: 3 }]);
  assert.equal(charSpots().length, 1, 'a new world starts its own table');
  for (let k = 0; k < CHAR_SPOTS + 5; k++) addCharSpots(w2, [{ x: k, y: 0, z: 0, r: 2 }]);
  assert.equal(charSpots().length, CHAR_SPOTS);
  assert.equal(charSpots().at(-1).x, CHAR_SPOTS + 4, 'the newest kept');
  resetCharSpots();
  assert.equal(charKind({ name: 'rail:rivet' }), 'steel');
  assert.equal(charKind({ name: 'kit:timber_grey~d8ccbc' }), 'wood');
  assert.equal(charKind({ name: 'kit:brick_red' }), 'masonry');
  assert.equal(charKind({ name: 'kit:canvas_tent' }), 'fabric');
  assert.equal(charKind({ name: 'kit:snow' }), 'snow');
  assert.equal(charKind({ name: 'kit:loggia', metalness: 0 }), 'masonry', '(not "log")');
  assert.equal(charKind({ name: 'dressing:screed', metalness: 1, metalnessMap: {} }), 'masonry');
  assert.equal(charKind({ name: 'kit:warship_hull', metalness: 0.15 }), 'steel');
  assert.equal(charKind({ name: 'kit:paint_metal~e5e0d1' }), 'steel');
  assert.equal(charKind({ name: 'kit:wood_paint~3f3f38' }), 'wood');
  assert.equal(charKind({ name: 'flag:pole' }), 'steel');
  assert.equal(charKind({ name: 'flag_cloth' }), 'fabric');
  assert.equal(charKind({ name: 'kit:cast_iron' }), 'steel');
  assert.equal(charKind({ name: 'veh:rubber' }), 'rubber');
  assert.equal(charKind({ name: 'veh:brass' }), 'steel');
  const g = new THREE.Group(); g.position.set(3, 0, 4);
  const m = new THREE.MeshStandardMaterial({ name: 'kit:stone' });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
  g.userData.loop = g; // (a library model's userData holds live references: never JSON-copied)
  const c = charWarmClone(g);
  assert.equal(c.children[0].position.x, 3);
  assert.equal(c.children[0].material, charMaterial(m), 'the warm-up draws the very copy a blast will');
  assert.equal(g.children[0].material, m, 'the model itself untouched');
});

// ---------------------------------------------------------------- art/char-ruin.js: the fallback wreck's shape
import { prepareCharRuin } from '../../src/art/char-ruin.js';

const house = () => {
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), new THREE.MeshStandardMaterial({ name: 'kit:plaster' }));
  walls.position.y = 1.5;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.2, 4.4), new THREE.MeshStandardMaterial({ name: 'dressing:screed' }));
  roof.position.y = 3.1; roof.name = 'roof';
  g.add(walls, roof);
  g.updateMatrixWorld(true);
  return { g, walls, roof };
};
const upTris = (geo, M) => { let n = 0; const p = geo.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); const cnt = geo.index ? geo.index.count : p.count; for (let t = 0; t < cnt; t += 3) { const i = (k) => (geo.index ? geo.index.getX(t + k) : t + k); a.fromBufferAttribute(p, i(0)).applyMatrix4(M); b.fromBufferAttribute(p, i(1)).applyMatrix4(M); c.fromBufferAttribute(p, i(2)).applyMatrix4(M); const nrm = new THREE.Vector3().subVectors(c, b).cross(a.clone().sub(b)); if (nrm.y > 0.5 * nrm.length() && (a.y + b.y + c.y) / 3 > 3.1) n += nrm.length() / 2; } return n; };

test('fallback wreck shape: a building\'s roof sags and is holed, rafters over the gap, a soot skirt; its footprint kept', () => {
  const { g, walls, roof } = house();
  const r0 = roof.geometry, w0 = walls.geometry, area0 = upTris(r0, roof.matrixWorld);
  const ruin = prepareCharRuin(g, { id: 'barr', x: 0, z: 0, w: 6, d: 4, gy: 0 });
  assert.equal(ruin.kind, 'building');
  assert.ok(ruin.double, 'holed: drawn from both sides');
  assert.equal(roof.geometry, r0, 'prepared off the scene: nothing changes before the blast');
  assert.equal(g.children.length, 2);
  ruin.apply();
  assert.notEqual(roof.geometry, r0, 'the roof swapped for its wrecked copy');
  const area1 = upTris(roof.geometry, roof.matrixWorld);
  assert.ok(area1 < area0 * 0.92, `holed (${area1.toFixed(1)} of ${area0.toFixed(1)} m² of roof top left)`);
  let low = Infinity; const p = roof.geometry.attributes.position, v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) low = Math.min(low, v.fromBufferAttribute(p, k).applyMatrix4(roof.matrixWorld).y);
  assert.ok(low < 2.85, `the roof sags (${low.toFixed(2)} m)`);
  const extras = g.children.find((c) => c.name === 'char-ruin');
  assert.ok(extras?.getObjectByName('char-ruin:skirt') && extras.getObjectByName('char-ruin:rafters'), 'a soot skirt and rafters (bars on a flat roof)');
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(walls), b0 = new THREE.Box3().setFromBufferAttribute(w0.attributes.position).applyMatrix4(walls.matrixWorld);
  assert.ok(Math.abs(box.min.x - b0.min.x) < 0.4 && Math.abs(box.max.z - b0.max.z) < 0.4 && Math.abs(box.min.y - b0.min.y) < 1e-3, 'its footprint and foot kept');
  ruin.dispose();
});

test('fallback wreck shape: a mast buckles, its top snapped off and lying beside its foot; a vehicle model is left to its own wreck', () => {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 1, 1, 24, 1), new THREE.MeshStandardMaterial({ name: 'kit:steel' }));
  mast.position.y = 6; g.add(mast); g.updateMatrixWorld(true);
  const ruin = prepareCharRuin(g, { id: 'mast', x: 0, z: 0, w: 1, d: 1, gy: 0 });
  assert.equal(ruin.kind, 'mast');
  ruin.apply();
  const b = new THREE.Box3().setFromObject(mast);
  assert.ok(b.max.y < 10, `no longer standing to its full height (top ${b.max.y.toFixed(1)} m)`);
  assert.ok(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) > 3, 'its top lies out beside its foot');
  const veh = new THREE.Group(); const h2 = new THREE.Group(); h2.name = 'static-vehicle:uboat_viic'; veh.add(h2, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  assert.equal(prepareCharRuin(veh, { x: 0, z: 0, w: 1, d: 1, gy: 0 }), null);
  const a1 = prepareCharRuin(house().g, { id: 'x', x: 0, z: 0, w: 6, d: 4, gy: 0 }), a2 = prepareCharRuin(house().g, { id: 'x', x: 0, z: 0, w: 6, d: 4, gy: 0 });
  const geoOf = (r) => r.warm()[0].children.filter((c) => c.isMesh).map((c) => Array.from(c.geometry.attributes.position.array.slice(0, 90)));
  assert.deepEqual(geoOf(a1), geoOf(a2), 'deterministic (seeded by the id)');
});

test('destroyed without a modelled wreck: the Interactable prepares its ruin once and swaps it in at the blast', () => {
  const { g, roof } = house();
  const it = new Interactable({ interactKind: 'explosiveTarget', x: 0, z: 0, object3d: g, structure: { id: 'b1', type: 'barracks', x: 0, z: 0, w: 6, d: 4, h: 3.2 } });
  const ruin = it.prepareCharWreck();
  assert.equal(it.prepareCharWreck(), ruin, 'once');
  const r0 = roof.geometry;
  it._applyDestroyedState();
  assert.notEqual(roof.geometry, r0);
  assert.equal(g.scale.y, 1);
  assert.equal(roof.material.side, THREE.DoubleSide, 'two-sided charred copy: the inside shows through the gap');
  assert.ok(isCharred(roof.material));
});

// ---------------------------------------------------------------- wrecks stay solid (user: "Wrecks stay solid")
import m00def from '../../src/missions/m00_sandbox.js';
import { OPENS_WHEN_DESTROYED } from '../../src/entities/interactables.js';

async function wreckWorld() {
  const { World } = await import('../../src/world/world.js');
  const { buildMap } = await import('../../src/world/map-builder.js');
  const base = JSON.parse(JSON.stringify(m00def));
  const def = { ...base, enemies: [], interactables: [], ladders: [], climbLinks: [], structures: [
    { id: 'gun', type: 'railway_gun', variant: 'railway_gun_k5', x: 30, z: 20, rot: 0, w: 20, d: 4, h: 5, destructible: true, bombOnly: true, hp: 100 },
    { id: 'hq', type: 'flat_roof_house', x: 30, z: 40, rot: 0, w: 10, d: 8, h: 4, roofY: 4, roofWalk: true, destructible: true, hp: 100 },
    { id: 'hut', type: 'hut', x: 50, z: 40, rot: 0, w: 4, d: 4, h: 3, destructible: true, hp: 100 },
    { id: 'gate', type: 'gate', variant: 'barrier_boom', x: 12, z: 40, rot: 0, w: 5, d: 0.6, h: 1.2, rammable: true },
  ] };
  const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def });
  buildMap(world, def);
  return world;
}

test('wrecks stay solid: a destroyed railway gun, house or hut keeps its footprint exactly as it stood', async () => {
  const { B } = await import('../../src/world/grid.js');
  const world = await wreckWorld(), g = world.grid;
  const gun = world.byId('gun'), hq = world.byId('hq'), hut = world.byId('hut');
  assert.ok(gun.wreckStands() && hq.wreckStands() && hut.wreckStands());
  const before = { gun: g.blockAt(30, 20), hut: g.blockAt(50, 40) };
  assert.ok(before.gun >= B.LOW && before.hut >= B.LOW, 'blocked intact');
  const layers = () => [g.block, g.elev, g.owner, g.bridge].map((a) => Array.from(a).join(',')).join('|');
  const before0 = layers();
  const events = [];
  world.events.on('structure:destroyed', (e) => events.push(e));
  for (const it of [gun, hq, hut]) it.destroy(null, 'explosion');
  assert.equal(g.blockAt(30, 20), before.gun, "the gun's wreck still blocks");
  assert.equal(g.blockAt(50, 40), before.hut, "the hut's wreck still blocks");
  assert.ok(g.owner[g.idx(...Object.values(g.worldToCell(30, 20)))] === gun.owner, 'its cells still its own');
  assert.equal(layers(), before0, 'the grid (blocks, heights, owners, decks) exactly as the intact structures left it');
  assert.ok(events.filter((e) => ['gun', 'hq', 'hut'].includes(e.id)).every((e) => e.standing === true), 'announced standing (its stamps kept)');
});

test('wrecks stay solid: a breached gate, a drum, a crest, a sinking boat and a fuel tank still do what they did', async () => {
  const { B } = await import('../../src/world/grid.js');
  const world = await wreckWorld(), g = world.grid;
  const gate = world.interactables.find((i) => i.barrier);
  assert.ok(gate && !gate.wreckStands(), 'a gate opens the way');
  const k = g.idx(...Object.values(g.worldToCell(12, 40)));
  const blocked = g.block[k];
  gate.ramBreak(null);
  assert.ok(blocked > B.NONE && g.block[k] === B.NONE, 'the breached gate no longer blocks');
  const it = (S, kind = 'explosiveTarget') => new Interactable({ interactKind: kind, x: 0, z: 0, structure: S, destructible: true });
  assert.equal(it({ type: 'barrels', variant: 'fuel_explosive' }).wreckStands(), false);
  assert.equal(it({ type: 'dam', destroyFx: ['collapse', 'flood', 'removeCrest'] }).wreckStands(), false);
  assert.equal(it({ type: 'battleship', variant: 'uboat_docked', destroyFx: ['explode', 'removeCrest', 'sinkStern'] }).wreckStands(), false);
  assert.equal(it({ type: 'battleship', variant: 'battleship_replica', destroyFx: ['explode', 'sinkBow'] }).wreckStands(), false);
  assert.equal(it({ type: 'fueltank', variant: 'fuel_tank_horizontal', w: 9, d: 7 }).wreckStands(), false, '(its own wreck nav)');
  assert.equal(it({ type: 'barracks', wreckOpen: true }).wreckStands(), false, 'a mission may say its destruction opens a way');
  assert.equal(it({ type: 'bunker', variant: 'pillbox_round' }).wreckStands(), true, 'a caved-in bunker stands');
  assert.equal(it({ type: 'radio_mast' }).wreckStands(), true);
  for (const t of ['gate', 'fence', 'wall', 'barrels', 'bridge']) assert.ok(OPENS_WHEN_DESTROYED.has(t), t);
});

test('wrecks stay solid: deterministic — the same grid after the same blasts', async () => {
  const run = async () => {
    const world = await wreckWorld();
    for (const id of ['gun', 'hq', 'hut']) world.byId(id).destroy(null, 'explosion');
    const g = world.grid;
    return [Array.from(g.block), Array.from(g.elev), Array.from(g.owner), Array.from(g.bridge)].map((a) => a.join(',')).join('|');
  };
  assert.equal(await run(), await run());
});
