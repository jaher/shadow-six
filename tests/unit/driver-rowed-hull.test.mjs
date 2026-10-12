/**
 * Solution driver exposure watch (tools/solutions/driver.mjs; user, M3 2026-10-08: "make sure no commando goes inside
 * the field of view of a solider before being spotted. Even the raft boat in the light shaded field of view of a soldier
 * makes the soldier see it"): a boat the team rows is seen by its HULL, as perception sees it (ai/director _rowedBoats:
 * the hull edge nearest the guard, in his cone, in sight — vehicle-ai canSeeVehicle). The watch only tried the men
 * aboard, so a rowboat whose near gunwale was in a cone while the rower sat just outside it counted as unseen.
 * Ported from feat/m14-solution (the same three lines). Rafts keep the occupant rule (and the empty-raft rule).
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { makeDriver } from '../../tools/solutions/driver.mjs';
import { canSee } from '../../src/ai/perception.js';
import { canSeeVehicle } from '../../src/ai/vehicle-ai.js';

// a river along x = 40 (deep 37.5–42.5, shallow banks), as tests/unit/boat-occupants-seen
const RIVER = {
  size: [60, 60], shoreShallowWidth: 0,
  terrain: [{ type: 'path', terrain: 'shallow', points: [[40, 0], [40, 60]], width: 7 }],
  structures: [{ type: 'river', points: [[40, 0], [40, 60]], width: 5 }],
};

/** A guard due west of the boat looking straight at it from `d` m (soldier: far 36 m, no sweep). */
function setup(vehicleType, d) {
  const s = makeSim({
    ...RIVER,
    commandos: [{ role: 'diver', x: 36.9, z: 30 }],
    enemies: [guard('g', 40 - d, 30, 0)],
    vehicles: [{ id: 'boat', vehicleType, x: 40, z: 30, heading: Math.PI / 2, inflated: true, suspicious: false, operators: ['diver'] }],
  }, { brains: false });
  const g = s.get('g'), dv = s.cmd('diver'), boat = s.get('boat');
  g.sweepActive = false;
  assert.ok(boat.enter(dv), 'the Marine boards');
  s.step();
  const D = makeDriver(s.world, { step: () => s.step(), quiet: true, log: () => {} });
  return { s, g, dv, boat, D };
}

test('driver watch: a rowboat rowed by the team whose near gunwale is in a cone is an exposure (the rower outside it)', async () => {
  const { s, g, dv, boat, D } = setup('rowboat', 36.6);
  assert.equal(boat.driver, dv, 'the Marine at the oars');
  assert.equal(canSee(g, dv, s.world), 'none', 'precondition: the rower himself is beyond the cone');
  assert.equal(canSeeVehicle(g, boat, s.world), true, 'precondition: the hull edge facing the guard is in his cone, in sight');
  await D.wait(0.1);
  const hull = D.exposures().filter((x) => x.target === 'boat hull');
  assert.equal(hull.length, 1, `hull exposure: ${D.exposureReport().join(' | ')}`);
  assert.equal(hull[0].viewer, 'g');
  assert.equal(hull[0].band, 'boat');
  D.dispose();
});

test('driver watch: the same rowboat well out of the cone is no exposure; a raft keeps the occupant rule only', async () => {
  const far = setup('rowboat', 39);
  assert.equal(canSeeVehicle(far.g, far.boat, far.s.world), false);
  await far.D.wait(0.1);
  assert.equal(far.D.exposures().length, 0, far.D.exposureReport().join(' | '));
  far.D.dispose();
  const raft = setup('raft', 36.6);
  assert.equal(canSee(raft.g, raft.dv, raft.s.world), 'none');
  await raft.D.wait(0.1);
  assert.equal(raft.D.exposures().filter((x) => /hull/.test(x.target)).length, 0, 'no hull rule for a raft (its crew and the empty raft are watched)');
  raft.D.dispose();
});
