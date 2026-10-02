/** Vehicle integration: registry → library mapping, theater paint, door sides, destroy swap, static vehicles, sizes. */
import { readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { loadVehicleLibrary, resolveVehicle } from '../../src/art/vehicle-library.js';
import { libraryTypeFor, missionVehicleTypes, missionVehicleSpawns, seatSide, doorsForSeat, createLibraryVehicleModel, LIB_ASSET, LIB_VEHICLE,
  _setVehicleArt, _resetVehicleArt } from '../../src/art/vehicle-model.js';
import { staticVehicleAsset, staticVehicleAssets, fitOnFootprint, overhangClear } from '../../src/art/static-vehicles.js';
import { Vehicle, VEHICLE_TYPES, canonicalType, vehicleDef } from '../../src/entities/vehicle.js';

const ROOT = new URL('../../assets/models/vehicles/', import.meta.url);
const MAN = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const meta = (model) => JSON.parse(readFileSync(new URL(MAN.models[model].meta, ROOT), 'utf8'));
/** Every vehicleType the BEL missions M1-M20 spawn (M4-M20 from the missions branch, feat/missions). */
const BEL_TYPES = ['atgunM20', 'autogyro', 'cable_car', 'cannon', 'car', 'citroen15', 'halftrack', 'horch', 'ju52', 'ju87',
  'kubelwagen', 'mgNest', 'mine_cart', 'minisub', 'mortar210', 'motorcycle', 'opel_blitz_tanker', 'panzer2', 'panzer3',
  'panzer4', 'patrolboat', 'raft', 'rowboat', 'sdkfz', 'train', 'tram', 'truck', 'van', 'willys'];
const PLACEHOLDER = new Set(['atgunM20', 'cable_car']); // van → the Citroën Traction (placeholder-art pass)

test('vehicles: every mission vehicle type maps to a library model (atgunM20, cable_car → placeholder)', async () => {
  await loadVehicleLibrary(null, { manifest: MAN });
  const used = new Set(BEL_TYPES);
  for (const m of MISSIONS) for (const t of missionVehicleTypes(m)) used.add(t);
  for (const t of used) {
    const lt = libraryTypeFor(t, canonicalType(t), MAN);
    if (PLACEHOLDER.has(t)) { assert.equal(lt, null, `${t} keeps the placeholder`); continue; }
    assert.ok(lt && MAN.types[lt], `${t} → library type (${lt})`);
    assert.ok(resolveVehicle(LIB_ASSET[lt] || lt, { theater: 'temperate' }), `${t} resolves`);
  }
  assert.equal(libraryTypeFor('armoredcar', 'sdkfz', MAN), 'armoredcar', 'alias keeps its own look (8-Rad)');
  assert.equal(resolveVehicle('armoredcar').asset, 'sdkfz231_8rad');
  assert.equal(resolveVehicle('halftrack').asset, 'sdkfz251_c');
  assert.equal(resolveVehicle(LIB_ASSET.mgNest).asset, 'mg34_tripod', 'the MG inside the mission sandbag ring is the tripod gun');
});

test('vehicles: the spawn variant picks the model (M1 kubel_decor → winter Kübelwagen, not the black civilian car)', async () => {
  await loadVehicleLibrary(null, { manifest: MAN });
  assert.equal(libraryTypeFor('car', 'car', MAN, 'kubelwagen'), 'kubelwagen');
  assert.equal(libraryTypeFor('truck', 'truck', MAN, 'opel_canvas'), 'truck');
  assert.equal(libraryTypeFor('car', 'car', MAN, 'no_such_look'), 'car', 'unknown variant → the type');
  assert.equal(libraryTypeFor('van', 'van', MAN, 'kubelwagen'), 'kubelwagen', 'a variant the library has wins over a placeholder type');
  const m1 = MISSIONS.find((m) => /baptism/.test(m.id) || m.id === 'm01' || m.id === 1);
  assert.ok(m1, 'M1 found');
  assert.ok(missionVehicleSpawns(m1).some(([t, va]) => t === 'car' && va === 'kubelwagen'), 'preload sees the variant');
  _setVehicleArt({ theater: 'snow' });
  try {
    const v = new Vehicle({ id: 'kubel_decor', vehicleType: 'car', variant: 'kubelwagen', x: 20, z: 12, driveable: false });
    assert.equal(v.model.root.userData.library, 'kubelwagen');
    assert.ok(/^winter/.test(v.model.root.userData.paint), `winter paint (${v.model.root.userData.paint})`);
    assert.equal(new Vehicle({ vehicleType: 'car', x: 1, z: 1 }).model.root.userData.paint, 'black', 'plain car stays civilian');
  } finally { _resetVehicleArt(); }
});

test('vehicles: paint follows the theater (grey / tan / winter), civilian car black, spawn paint wins', async () => {
  await loadVehicleLibrary(null, { manifest: MAN });
  assert.equal(resolveVehicle('truck', { theater: 'temperate' }).paint, 'grey');
  assert.equal(resolveVehicle('truck', { theater: 'desert' }).paint, 'dak');
  assert.equal(resolveVehicle('truck', { theater: 'snow' }).paint, 'winter');
  assert.equal(resolveVehicle('truck', { theater: 'night' }).paint, 'grey');
  assert.equal(resolveVehicle('car', { theater: 'desert' }).paint, 'black');
  assert.equal(resolveVehicle('truck', { theater: 'desert', paint: 'grey' }).paint, 'grey');
  assert.equal(resolveVehicle('panzer4', { theater: 'desert' }).swap?.[1], '_dak_', 'armour: texture swap to the desert atlas');
});

test('vehicles: door sides — LHD driver left, co-driver right, R75 sidecar right, half-track rear, boats unchanged', () => {
  assert.deepEqual(seatSide('kubelwagen', 'land', 0), { side: -1, row: 0 });
  assert.equal(seatSide('kubelwagen', 'land', 1).side, 1);
  assert.equal(seatSide('horch', 'land', 2).row, 1, 'rear bench');
  assert.equal(seatSide('motorcycle', 'land', 0).side, -1, 'rider steps off left');
  assert.equal(seatSide('motorcycle', 'land', 1).side, 1, 'sidecar passenger right');
  assert.ok(seatSide('truck', 'land', 3).back, 'truck passengers: tailgate');
  assert.ok(seatSide('halftrack', 'land', 0).back, '251: rear doors');
  assert.equal(seatSide('ju52', 'plane', 0).side, -1, 'Ju 52 cabin door on the left');
  assert.equal(seatSide('patrolboat', 'boat', 0), null);
  // the door that opens for a seat, from the real sidecars
  assert.deepEqual(doorsForSeat(meta('kubelwagen_grey'), 'kubelwagen', 'land', 0), ['door_fl']);
  assert.deepEqual(doorsForSeat(meta('kubelwagen_grey'), 'kubelwagen', 'land', 3), ['door_rr']);
  assert.deepEqual(doorsForSeat(meta('horch901_grey'), 'horch', 'land', 1), ['door_fr']);
  assert.deepEqual(doorsForSeat(meta('opel_blitz_cargo_grey'), 'truck', 'land', 0), ['door_l']);
  assert.deepEqual(doorsForSeat(meta('opel_blitz_cargo_grey'), 'truck', 'land', 4), ['tailgate']);
  assert.deepEqual(doorsForSeat(meta('panzer4_g'), 'panzer4', 'land', 0), ['hatch_driver']);
  // handedness of the models themselves: driver seat + door on model +x (= vehicle left), sidecar wheel on -x
  const drv = meta('horch901_grey').sockets.find((s) => s.name === 'seat_driver');
  assert.ok(drv.pos[0] > 0, 'Horch driver seat on the left');
  assert.ok(meta('r75_sidecar_grey').contacts.find((c) => /wheel_s/.test(c.name)).pos[0] < 0, 'R75 sidecar on the right');
});

test('vehicles: Vehicle gets the library model; destroyed → wreck + scorch; van → Citroën Traction', async () => {
  await loadVehicleLibrary(null, { manifest: MAN });
  _setVehicleArt({ theater: 'snow' });
  try {
    const v = new Vehicle({ vehicleType: 'truck', x: 10, z: 10, id: 't1' });
    assert.equal(v.model.library, true);
    assert.equal(v.model.root.userData.library, 'opel_blitz_cargo');
    assert.equal(v.model.root.userData.paint, 'winter');
    await v.model.ready;
    v.destroy();
    assert.equal(v.model.visual.destroyed, true, 'library handle swapped to the wreck');
    assert.equal(v.model.scorch?.visible, true, 'scorch decal under the wreck');
    assert.equal(new Vehicle({ vehicleType: 'van', x: 1, z: 1 }).model.root.userData.library, 'citroen11', 'van: the Citroën Traction (M15 civilian van)');
    const m = new Vehicle({ vehicleType: 'motorcycle', x: 1, z: 1 }).model;
    assert.equal(m.root.userData.library, 'r75_sidecar');
    assert.ok(createLibraryVehicleModel('atgunM20', vehicleDef('atgunM20'), {}) === null);
  } finally { _resetVehicleArt(); }
  assert.equal(new Vehicle({ vehicleType: 'truck', x: 1, z: 1 }).model.library, undefined, 'library off → placeholder');
});

test('vehicles: land registry footprints cover the real models (no hull poking through walls)', () => {
  for (const [t, d] of Object.entries(VEHICLE_TYPES)) {
    if (d.alias || d.kind !== 'land' || PLACEHOLDER.has(t)) continue;
    const A = MAN.assets[MAN.types[LIB_VEHICLE[t] ?? t].assets[0]], dims = A.dims || {}; // registry type → library type (van → citroen15)
    const L = dims.length, W = dims.width;
    if (!L || !W) continue;
    assert.ok(d.size[0] >= L - 0.15 && d.size[1] >= W - 0.15, `${t}: size ${d.size} vs model ${L} × ${W}`);
  }
});

test('vehicles: static structures — wagons, K5, flak, aircraft, windsock; fit keeps true scale when there is room', () => {
  assert.equal(staticVehicleAsset('train_car', 'rail_yard_derelict_boxcar'), 'wagon_covered');
  assert.equal(staticVehicleAsset('train_car', 'rail_yard_derelict_loco'), 'loco_br52');
  assert.equal(staticVehicleAsset('train_car', 'flatcar_logs'), 'wagon_flat');
  assert.equal(staticVehicleAsset('train_car', 'tip_cart'), 'mine_tipper');
  assert.equal(staticVehicleAsset('train_car', 'boat_on_cradle'), 'fishing_boat'); // M13 launch on its cradle
  assert.equal(staticVehicleAsset('railway_gun', 'railway_gun_k5'), 'railgun_k5');
  assert.equal(staticVehicleAsset('aa_gun', 'flak38_quad_towed'), null, 'no quad 2 cm model yet');
  assert.equal(staticVehicleAsset('plane', 'storch'), 'fi156_storch');
  assert.equal(staticVehicleAsset('crates', 'van_parked', { vehicleArt: 'opel_blitz_cargo' }), 'opel_blitz_cargo', 'vehicleArt opt-in');
  assert.deepEqual(staticVehicleAssets({ structures: [{ type: 'crates', variant: 'crate_stack' }, { type: 'crates', vehicleArt: 'opel_blitz_cargo' }] }), ['opel_blitz_cargo']);
  assert.deepEqual(staticVehicleAssets({ structures: [{ type: 'windsock' }, { type: 'barracks' }, { type: 'train_car', variant: 'coach' }] }), ['coach', 'windsock']);
  for (const a of ['wagon_covered', 'loco_br52', 'wagon_flat', 'mine_tipper', 'railgun_k5', 'flak88', 'fi156_storch', 'ju52_3m', 'windsock', 'uboat_viic']) assert.ok(MAN.assets[a], a);
  assert.equal(fitOnFootprint([9.8, 3], [10, 3]), 1);
  assert.ok(Math.abs(fitOnFootprint([20, 3], [10, 3]) - 0.6) < 1e-9, 'never below 0.6');
  const grid = { block: new Uint8Array(100 * 100), cols: 100, inBounds: (i, j) => i >= 0 && j >= 0 && i < 100 && j < 100,
    idx: (i, j) => j * 100 + i, worldToCell: (x, z) => ({ i: Math.floor(x / 0.5), j: Math.floor(z / 0.5) }) };
  assert.ok(overhangClear(grid, { x: 25, z: 25, rot: 0, w: 5, d: 5 }, 7.6, 5.3), 'open ground: true scale');
  for (let j = 40; j < 60; j++) grid.block[j * 100 + 58] = 2; // a wall 4 m east of the centre
  assert.ok(!overhangClear(grid, { x: 25, z: 25, rot: 0, w: 5, d: 5 }, 9, 5.3), 'overhang into the wall → fit');
});
