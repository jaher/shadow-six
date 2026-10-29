/**
 * M6 regression (solution run, 2026-10-22): the armoured car's three-point turn at its west turn-round passes e14,
 * its own sentry, on his post. A hull never asked its own side's men to step aside, every replan was blocked by him,
 * and at ~882 s the car stood there for good (vehicle.js _stepAside: an own-side man the hull has waited on for over
 * 3 s now steps aside). The car keeps driving its beat for 1000 s.
 */
import { test, assert } from './lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';

test('m06: the armoured car never deadlocks on its own sentry at the turn-round (1000 s)', () => {
  const s = headlessMission('m06'), w = s.world, v = w.vehicles.find((x) => x.vehicleType === 'sdkfz' || x.vision);
  let lx = v.x, lz = v.z, last = 0, worst = 0;
  for (let t = 0; t < 1000; t++) {
    for (let i = 0; i < 60; i++) s.step();
    if (Math.hypot(v.x - lx, v.z - lz) > 0.2) { worst = Math.max(worst, t - last); last = t; lx = v.x; lz = v.z; }
  }
  worst = Math.max(worst, 1000 - last);
  assert.ok(worst < 25, `the car stood still for ${worst} s at most (a turn-round halt is 5 s)`);
  assert.ok(w.byId('e14')?.alive, 'e14 alive (stepped aside, not run over)');
});
