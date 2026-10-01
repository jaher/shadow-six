/**
 * M15 fix round 2 (§3.3, §3.7): an occluding vehicle (OCLU stamp) never hides its own centre from a shooter.
 * The fuel tanker (hits:1) was unshootable: the pistol said "No line of sight." 6 m away in the open, and the
 * rifle/harpoon only took enemies/barrels. Now: grid.lineOfSight `targetHull`, rifle + harpoon accept a
 * tanker, and a pistol click on a hull aims at that vehicle. Another vehicle's hull in between still blocks.
 */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { createVehicle } from '../../src/entities/vehicle.js';
import { Commando } from '../../src/entities/commando.js';
import { ABILITIES } from '../../src/abilities/index.js';
import { shotTarget, shotClear } from '../../src/abilities/weapons.js';

function setup() {
  const w = new World({ size: [80, 60] });
  w.vehicleFactory = createVehicle;
  const tk = w.add(createVehicle({ vehicleType: 'opel_blitz_tanker', x: 40, z: 30, heading: 0 }));
  const c = (role, x, z) => w.add(new Commando({ role, x, z, heading: 0 }));
  w.rebuildSpatial();
  w.refreshDynamicOccluders();
  return { w, tk, c };
}

test('shoot vehicle: grid LOS to a hull centre ignores that hull (targetHull) but not another vehicle', () => {
  const { w, tk } = setup();
  assert.equal(w.grid.lineOfSight(30, 30, tk.x, tk.z, {}), false, 'precondition: the own stamp blocks without targetHull');
  const hull = { x: tk.x, z: tk.z, w: tk.def.size[0], d: tk.def.size[1], heading: tk.heading };
  assert.equal(w.grid.lineOfSight(30, 30, tk.x, tk.z, { targetHull: hull }), true);
  assert.equal(shotClear(w, { x: 30, z: 30 }, tk), true);
  w.add(createVehicle({ vehicleType: 'truck', x: 33, z: 30, heading: Math.PI / 2 }));
  w.rebuildSpatial(); w.refreshDynamicOccluders();
  assert.equal(shotClear(w, { x: 30, z: 30 }, tk), false, 'a truck across the line still hides the tanker');
});

test('shoot vehicle: pistol 6 m from the tanker is in reach and a click on its hull resolves to it', () => {
  const { w, tk, c } = setup();
  const spy = c('spy', 40, 36);
  assert.equal(ABILITIES.pistol.canUse(spy, tk, w), true);
  assert.equal(shotTarget(w, { x: 41.5, z: 30.5 }), tk, 'a point on the hull aims at the tanker');
  assert.equal(ABILITIES.pistol.canUse(spy, { x: 41.5, z: 30.5 }, w), true);
});

test('shoot vehicle: sniper rifle and harpoon may target a fuel tanker (not a plain truck)', () => {
  const { w, tk, c } = setup();
  const sn = c('sniper', 40, 50), dv = c('diver', 40, 37);
  assert.equal(ABILITIES.sniper.canUse(sn, tk, w), true);
  assert.equal(ABILITIES.harpoon.canUse(dv, tk, w), true);
  const tr = w.add(createVehicle({ vehicleType: 'truck', x: 60, z: 30, heading: 0 }));
  assert.equal(ABILITIES.sniper.canUse(sn, tr, w), 'Pick an enemy.');
});

test('shoot vehicle: one rifle round blows the tanker', () => {
  const { w, tk, c } = setup();
  const sn = c('sniper', 40, 50);
  const task = ABILITIES.sniper.start(sn, tk, w);
  for (let i = 0; i < 120 && !tk.destroyed; i++) { task.update?.(1 / 60); w.time += 1 / 60; }
  assert.equal(tk.destroyed, true);
});
