/**
 * Spy + truck (user 2026-10-21: "when the spy goes into the truck and it has the nazi clothes, it should
 * jump in with those clothes"): boarding a land vehicle while holding an unworn uniform dresses the Spy
 * as part of boarding — the change happens inside the closed cab, where the U key's unseen rule (it
 * guards changing in the open) does not apply. BEL: the kit `uniform` item is spent (as tryDress spends
 * it). BCD: the first wardrobe uniform goes on (as dressIn puts it on); the wardrobe itself is kept.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { bcdSim } from './bcd-sim.mjs';
import { tryDress } from '../../src/abilities/spy.js';
import { addToWardrobe } from '../../src/entities/wardrobe.js';

const TRUCK = { id: 'truck', vehicleType: 'truck', x: 30, z: 30, heading: 0 };

function board(sim, c, truck) {
  assert.equal(c.useAbility('enterVehicle', truck), true, 'enterVehicle accepted');
  assert.ok(sim.run(15, () => c.state === 'inVehicle'), 'boarded');
}
function getOut(sim, c) {
  c.useAbility('leaveVehicle', c);
  sim.run(1);
  assert.notEqual(c.state, 'inVehicle', 'stepped out');
}

test('BEL: the Spy boards the truck holding the uniform — and is in it when she steps out', () => {
  const s = makeSim({ commandos: [{ role: 'spy', x: 30, z: 26 }], vehicles: [TRUCK] });
  const spy = s.cmd('spy'), truck = s.get('truck');
  spy.gainItem('uniform', 1);
  assert.equal(spy.disguised, false);
  board(s, spy, truck);
  assert.equal(spy.disguised, true, 'dressed as part of boarding');
  getOut(s, spy);
  assert.equal(spy.disguised, true, 'still dressed on foot');
  assert.equal(spy.has('uniform'), false, 'the kit uniform was spent, not duplicated');
});

test('BEL: boarding without the uniform changes nothing; a dressed Spy stays dressed', () => {
  const s = makeSim({ commandos: [{ role: 'spy', x: 30, z: 26 }], vehicles: [TRUCK] });
  const spy = s.cmd('spy'), truck = s.get('truck');
  board(s, spy, truck);
  assert.equal(spy.disguised, false, 'no uniform held: no disguise');
  getOut(s, spy);
  spy.gainItem('uniform', 1);
  assert.equal(tryDress(s.world, spy), true, 'dressed at the kerb (nobody watching)');
  board(s, spy, truck);
  getOut(s, spy);
  assert.equal(spy.disguised, true, 'the disguise survives the ride');
});

test('BEL: a watcher at the truck does not stop the change (it happens inside the cab)', () => {
  const s = makeSim({ commandos: [{ role: 'spy', x: 30, z: 26 }], vehicles: [TRUCK], enemies: [guard('g', 30, 44, Math.PI)] }, { brains: false });
  const spy = s.cmd('spy'), truck = s.get('truck');
  spy.gainItem('uniform', 1);
  board(s, spy, truck);
  assert.equal(spy.disguised, true, 'dressed inside, watched or not');
  getOut(s, spy);
  assert.equal(spy.disguised, true);
});

test('BEL: another commando boarding is untouched', () => {
  const s = makeSim({ commandos: [{ role: 'driver', x: 30, z: 26 }], vehicles: [TRUCK] });
  const dr = s.cmd('driver'), truck = s.get('truck');
  board(s, dr, truck);
  assert.ok(!dr.disguised, 'no disguise machinery on the Driver');
  getOut(s, dr);
});

test('BCD: boarding puts on the first wardrobe uniform; the wardrobe is kept, U still cycles off', () => {
  const s = bcdSim({ commandos: [{ role: 'spy', x: 30, z: 26 }], vehicles: [TRUCK] });
  const spy = s.cmd('spy'), truck = s.world.vehicles[0];
  board(s, spy, truck);
  assert.equal(spy.disguised, false, 'empty wardrobe: nothing to put on');
  getOut(s, spy);
  addToWardrobe(spy, 'soldier');
  assert.deepEqual(spy.wardrobe, ['soldier']);
  board(s, spy, truck);
  assert.equal(spy.disguised, true, 'dressed as part of boarding');
  assert.equal(spy.uniformType, 'soldier');
  getOut(s, spy);
  assert.equal(spy.disguised, true, 'still dressed on foot');
  assert.deepEqual(spy.wardrobe, ['soldier'], 'the wardrobe entry is kept, not consumed or duplicated');
});
