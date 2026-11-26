/**
 * physics/debris.js gateRammerPossible: the gate-smash warm-up (GateDebris._warm, ~0.6 s of Rapier JIT on a cold load)
 * runs only in a world where a gate can ever be rammed — by a vehicle off the water, on the map at load or brought on
 * later by the mission (a trigger's `spawnVehicle`, the extraction's `spawnAt`). LIGHTS OUT e03 (a rope ferry and a
 * boom gate, nothing on wheels) skips it; m02 (a drivable truck) keeps it.
 */
import { test, assert } from './lib.mjs';
import { gateRammerPossible } from '../../src/physics/debris.js';
import { getMission } from '../../src/missions/index.js';
import { VEHICLE_TYPES, canonicalType } from '../../src/entities/vehicle.js';
import '../../src/missions/scripts/e03.js'; // (registers the rope ferry's vehicle type)

const boat = { isBoat: true }, truck = { isBoat: false };

test('gate rammer: only boats and nothing brought on later → no warm-up', () => {
  assert.equal(gateRammerPossible({ vehicles: [boat], mission: { triggers: [{ id: 't', actions: [{ type: 'say' }] }] } }), false);
  assert.equal(gateRammerPossible({ vehicles: [], mission: {} }), false);
});

test('gate rammer: a vehicle off the water, a later spawn or an extraction vehicle keeps the warm-up', () => {
  assert.equal(gateRammerPossible({ vehicles: [boat, truck], mission: {} }), true);
  assert.equal(gateRammerPossible({ vehicles: [boat], mission: { triggers: [{ id: 't', actions: [{ spawnVehicle: { type: 'truck' } }] }] } }), true);
  assert.equal(gateRammerPossible({ vehicles: [boat], mission: { setpieces: [{ steps: [{ do: { spawnVehicle: 'kubel' } }] }] } }), true);
  assert.equal(gateRammerPossible({ vehicles: [boat], mission: { extraction: { spawnAt: [1, 2] } } }), true);
  // (no mission def to read: as before, warm up)
  assert.equal(gateRammerPossible({ vehicles: [boat] }), true);
});

test('gate rammer: e03 (rope ferry, boom gate) skips the warm-up; its def brings no vehicle on later', () => {
  const m = getMission('e03');
  assert.ok(m, 'e03 registered');
  const types = (m.vehicles || []).map((v) => v.vehicleType ?? v.type);
  assert.ok(types.length >= 1, 'e03 has its ferry');
  for (const t of types) assert.equal(VEHICLE_TYPES[canonicalType(t)]?.kind, 'boat', `${t} is a boat`);
  assert.ok((m.structures || []).some((s) => s.type === 'gate'), 'e03 has a rammable-type gate (the boom)');
  // (the world's vehicles as Vehicle builds them: isBoat from the type's kind)
  const vehicles = types.map((t) => ({ isBoat: VEHICLE_TYPES[canonicalType(t)]?.kind === 'boat' }));
  assert.equal(gateRammerPossible({ vehicles, mission: m }), false);
});

test('gate rammer: m02 (its drivable truck) keeps the warm-up (negative control)', () => {
  const m = getMission('m02');
  const vehicles = (m.vehicles || []).map((v) => ({ isBoat: VEHICLE_TYPES[canonicalType(v.vehicleType ?? v.type)]?.kind === 'boat' }));
  assert.ok(vehicles.some((v) => !v.isBoat), 'm02 has a land vehicle');
  assert.equal(gateRammerPossible({ vehicles, mission: m }), true);
});
