/** Art integration 2: Opel Blitz truck models behind the vehicle model contract (paint, assets, wheels, wreck, lights). */
import { existsSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { truckPaint, truckAsset, missionTruckAssets, createTruckModel, prepareTruckArt, TRUCK_WHEEL_R,
  _registerTruckScene, _resetTrucks } from '../../src/art/truck-model.js';
import { Vehicle } from '../../src/entities/vehicle.js';

/** Minimal stand-in for a loaded truck GLB: body + 4 hub-pivoted wheels (left pair authored rotated π about Y). */
function fakeTruck(tag) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 6), new THREE.MeshStandardMaterial());
  body.name = `${tag}_body`;
  g.add(body);
  for (const [n, x, z] of [['wheel_FL', -0.82, 2.38], ['wheel_FR', 0.82, 2.38], ['wheel_RL', -0.83, -1.22], ['wheel_RR', 0.83, -1.22]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2), body.material);
    w.name = n; w.position.set(x, 0.45, z);
    if (n.endsWith('L')) w.rotation.y = Math.PI;
    g.add(w);
  }
  return g;
}

test('trucks: paint follows the theater, spawn override wins; asset names per type', () => {
  assert.equal(truckPaint('desert'), 'dak');
  assert.equal(truckPaint('snow'), 'grey');
  assert.equal(truckPaint('temperate'), 'grey');
  assert.equal(truckPaint('desert', { paint: 'grey' }), 'grey');
  assert.equal(truckAsset('truck', 'dak'), 'truck_dak');
  assert.equal(truckAsset('opel_blitz_tanker', 'grey'), 'truck_grey_tanker');
  assert.equal(truckAsset('fuel_truck', 'dak', true), 'truck_burnt_tanker');
});

test('trucks: every GLB a shipped mission needs exists (M1-M3 + desert / tanker cases)', () => {
  const need = new Set();
  for (const m of MISSIONS) for (const a of missionTruckAssets(m)) need.add(a);
  // M1/M2 trucks + the M3 scripted evac truck (extraction block) are all snow → grey + burnt
  for (const id of ['m01', 'm02', 'm03']) {
    const m = MISSIONS.find((x) => x.id?.startsWith(id));
    if (m) assert.deepEqual(missionTruckAssets(m), ['truck_burnt', 'truck_grey'], id);
  }
  const desert = missionTruckAssets({ theater: 'desert', vehicles: [{ vehicleType: 'opel_blitz_tanker' }, {}] });
  assert.deepEqual(desert, ['truck_burnt', 'truck_burnt_tanker', 'truck_dak', 'truck_dak_tanker']);
  assert.deepEqual(missionTruckAssets({ theater: 'desert', vehicles: [{ vehicleType: 'panzer3' }] }), []);
  for (const a of [...need, ...desert]) {
    const p = new URL(`../../assets/models/vehicles/${a}.glb`, import.meta.url);
    assert.ok(existsSync(p), `missing ${a}.glb`);
    assert.ok(statSync(p).size < 2.5e6, `${a}.glb too big`);
  }
});

test('trucks: node → no GLB loading, placeholders stay (createTruckModel null, Vehicle keeps the box model)', async () => {
  _resetTrucks();
  assert.equal(await prepareTruckArt({ theater: 'snow', vehicles: [{ vehicleType: 'truck' }] }), false);
  assert.equal(createTruckModel('truck'), null);
  const v = new Vehicle({ vehicleType: 'truck', x: 5, z: 5 });
  assert.equal(v.model.root.userData.truck, undefined);
});

test('trucks: wheels roll with speed, front pair steers into the turn, wreck swap, night headlights', () => {
  _resetTrucks();
  _registerTruckScene('truck_grey', fakeTruck('grey'), { theater: 'snow', night: true });
  _registerTruckScene('truck_burnt', fakeTruck('burnt'));
  assert.equal(createTruckModel('panzer3'), null);
  assert.equal(createTruckModel('opel_blitz_tanker'), null, 'tanker GLB not registered → placeholder');
  const m = createTruckModel('truck', { vehicleType: 'truck' });
  assert.ok(m && m.root.userData.truck === 'truck_grey');
  const wheel = (n) => m.root.getObjectByName(n);
  const v = { speed: 0, heading: 0, driver: null, crew: [] };
  m.update(0.1, v);
  assert.equal(m.root.getObjectByName('headlights').visible, false, 'parked, empty → lights off');
  // drive straight 1 s at 4.5 m/s: rolls 10 rad around the axle; both sides turn the same way in model space
  v.speed = 4.5; v.driver = { id: 1 };
  for (let i = 0; i < 10; i++) m.update(0.1, v);
  const expect = (4.5 * 1.0) / TRUCK_WHEEL_R; // 1 s at 4.5 m/s
  const up = (n) => new THREE.Vector3(0, 1, 0).applyQuaternion(wheel(n).quaternion);
  near(up('wheel_RR').y, Math.cos(expect), 1e-3);
  near(up('wheel_RR').z, up('wheel_RL').z, 1e-6, 'left + right wheels spin together');
  assert.equal(m.root.getObjectByName('headlights').visible, true, 'night + driven → lights on');
  // turn: heading decreasing = rotation.y increasing (turning left in model space) → front wheels yaw to +X
  for (let i = 0; i < 20; i++) { v.heading -= 0.03; m.update(0.1, v); }
  const yawF = new THREE.Euler().setFromQuaternion(wheel('wheel_FR').quaternion, 'YXZ').y;
  const yawR = new THREE.Euler().setFromQuaternion(wheel('wheel_RR').quaternion, 'YXZ').y;
  assert.ok(yawF > 0.1 && Math.abs(yawR) < 1e-6, `front steers (${yawF.toFixed(3)}), rear does not (${yawR})`);
  // destroyed → burnt wreck replaces the intact body, lights off
  m.setDestroyed(true);
  assert.equal(m.root.children[0].visible, false, 'intact body hidden');
  assert.ok(m.root.getObjectByName('burnt_body'), 'wreck added');
  assert.equal(m.root.getObjectByName('headlights').parent.visible, false);
  m.dispose();
  _resetTrucks();
});

test('trucks: Vehicle picks the real model for truck / opel_blitz, not for vans or tanks', () => {
  _resetTrucks();
  _registerTruckScene('truck_dak', fakeTruck('dak'), { theater: 'desert' });
  assert.equal(new Vehicle({ vehicleType: 'opel_blitz', x: 1, z: 1 }).model.root.userData.truck, 'truck_dak');
  assert.equal(new Vehicle({ vehicleType: 'truck', x: 1, z: 1 }).model.root.userData.truck, 'truck_dak');
  assert.equal(new Vehicle({ vehicleType: 'van', x: 1, z: 1 }).model.root.userData.truck, undefined);
  assert.equal(new Vehicle({ vehicleType: 'panzer2', x: 1, z: 1 }).model.root.userData.truck, undefined);
  _resetTrucks();
});
