/**
 * A burning wreck (entities/vehicle.js _updateWreck, §3.6 fire) burns the men on foot beside it, not the men inside a
 * vehicle passing it: they are inside its hull, which decides for them as it does for a blast (abilities/explosions.js:
 * "occupants: the hull decides"). M15: the Driver riding the tram past the tanker it has just blown up.
 * Run: node tests/unit/run.mjs wreck-fire
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';

test('wreck fire: a man on foot beside the burning wreck burns, a man in a truck parked against it does not', () => {
  const sim = makeSim({
    commandos: [{ role: 'driver', x: 50, z: 50 }, { role: 'spy', x: 52, z: 50 }],
    vehicles: [{ id: 'wreck', vehicleType: 'opel_blitz_tanker', x: 20, z: 20, heading: 0 }, { id: 'ride', vehicleType: 'truck', x: 50, z: 52.5, heading: 0 }],
  });
  const wreck = sim.get('wreck'), ride = sim.get('ride'), walker = sim.cmd('driver'), rider = sim.cmd('spy');
  assert.ok(ride.enter(rider), 'the Spy gets into the truck');
  // (the tanker goes up with nobody near; then a man walks up beside the fire and the truck pulls up against it)
  wreck.destroy(null, 'test');
  for (let k = 0; k < 30; k++) sim.step();
  walker.x = 20; walker.z = 21.6;
  ride.x = 23.5; ride.z = 20; rider.x = ride.x; rider.z = ride.z;
  assert.equal(rider.vehicle, ride);
  const hp0 = rider.hp;
  for (let k = 0; k < 60 * 2; k++) sim.step();
  assert.ok(wreck.burning, 'the wreck burns');
  assert.ok(!walker.alive || walker.hp < 100, `the man beside it is burnt (hp ${walker.hp})`);
  assert.ok(rider.alive && rider.hp === hp0, `the man in the truck is not (hp ${rider.hp})`);
});
