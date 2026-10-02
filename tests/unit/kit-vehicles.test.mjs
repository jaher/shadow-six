/**
 * Placeholder-art fix round: the vehicles the library has no model for get kit models (M5 cable car, M20 anti-tank
 * gun), the M13 battleship is a detailed warship on its footprint, M11's switchback is one mitred road, and the
 * interactable markers are kit props — none of them falls back to the flat-colour placeholder boxes.
 * Run with the unit suite: node tests/unit/run.mjs kit-vehicles
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { createKitVehicleModel, KIT_VEHICLES, CABLE_CAR_ROPES } from '../../src/art/kit-vehicles.js';
import { buildWarship, SHIP_REAL } from '../../src/art/warship.js';
import { terrainRampChain } from '../../src/art/kit-terrain.js';
import { buildMarkerProp } from '../../src/art/kit-props.js';
import { Vehicle } from '../../src/entities/vehicle.js';

const meshes = (g) => { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };

test('kit vehicles: cable car and anti-tank gun build with the model contract, no plain placeholder box', () => {
  for (const t of ['cable_car', 'atgunM20', 'atgun']) assert.ok(KIT_VEHICLES[t], t);
  const cab = createKitVehicleModel('cable_car', { size: [3, 2.2] }, { track: [{ x: 0, z: 0, y: 0.5 }, { x: 20, z: -40, y: 16.5 }] });
  const gun = createKitVehicleModel('atgunM20', { size: [3, 2] });
  for (const m of [cab, gun]) {
    assert.ok(m.kit && m.root.isObject3D);
    for (const f of ['update', 'setTurretHeading', 'setGunLift', 'setDestroyed', 'dispose']) assert.equal(typeof m[f], 'function', f);
    assert.ok(meshes(m.root).length > 3, 'more than a box');
  }
  assert.ok(gun.turret, 'the gun traverses');
  assert.ok(CABLE_CAR_ROPES.track > 3.5, 'the track ropes run above the cabin roof');
});

test('kit vehicles: a cable_car / atgunM20 entity uses its kit model', () => {
  const v = new Vehicle({ vehicleType: 'cable_car', x: 0, z: 0, track: [{ x: 0, z: 0, y: 0.5 }, { x: 20, z: -40, y: 16.5 }], schedule: { mode: 'pingpong', speed: 2 } });
  assert.ok(v.model.kit, 'cable car');
  const g = new Vehicle({ vehicleType: 'atgunM20', x: 0, z: 0, driveable: false });
  assert.ok(g.model.kit, 'anti-tank gun');
});

test('warship: Bismarck-class detail scaled onto the M13 footprint (110 × 16 m), bow at +x', () => {
  const g = buildWarship({ w: 110, d: 16, h: 12 });
  const b = new THREE.Box3().setFromObject(g);
  assert.ok(b.max.x <= 55.5 && b.min.x >= -55.5, `length ${b.min.x}..${b.max.x}`);
  assert.ok(b.max.z <= 8.3 && b.min.z >= -8.3, `beam ${b.min.z}..${b.max.z}`);
  assert.ok(b.max.y > 15, 'masts and the foretop stand well above the deck');
  assert.ok(b.min.y <= -1.4, 'the hull goes below the waterline');
  let tris = 0; for (const m of meshes(g)) tris += m.geometry.attributes.position.count / 3;
  assert.ok(tris > 10000, `detailed (${tris} triangles)`);
  assert.ok(meshes(g).length < 40, 'merged per material');
  assert.equal(SHIP_REAL.L, 251);
});

test('ramp chain: one road over the joints, top faces up, walls down to the ground', () => {
  const R = [{ a: [16.5, 57, 0], b: [8, 56.5, 2.4], width: 5 }, { a: [8, 56.5, 2.4], b: [3, 50.5, 4.6], width: 5 }, { a: [3, 50.5, 4.6], b: [4, 44.5, 6], width: 5 }];
  const g = terrainRampChain(R, {});
  const [top, walls] = meshes(g);
  const n = top.geometry.attributes.normal;
  for (let i = 0; i < n.count; i++) assert.ok(n.getY(i) > 0.5, 'the road faces up');
  const p = walls.geometry.attributes.position;
  let low = Infinity; for (let i = 0; i < p.count; i++) low = Math.min(low, p.getY(i));
  assert.ok(Math.abs(low) < 1e-6, 'retaining walls reach the ground');
});

test('interactable markers: a kit prop builds for every marker kind', () => {
  for (const k of ['jail', 'crate', 'ammo', 'phone', 'valve', 'switch']) {
    const g = buildMarkerProp(k);
    assert.ok(meshes(g).length >= 1, k);
  }
});
