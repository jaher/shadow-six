/**
 * The slow-speed bump rule (§3.7, src/entities/vehicle.js _runover / _stepAside): a man a commando-driven vehicle
 * crowds at slow speed steps aside and marks it (tainted). Two men report nothing: one out cold or cuffed (he is lying
 * there), and under LIGHTS OUT (BCD) one who takes no notice of commandos (archetype reacts false: the dozing lorry
 * driver of e01, as the boarding rule already treats him). An ordinary soldier still marks it, and the BEL rule is
 * unchanged: every man stepping out of a commando-driven vehicle's way marks it there.
 */
import { test, assert } from './lib.mjs';
import { bcdSim, post, DT } from './bcd-sim.mjs';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';

const TRUCK = { vehicleType: 'truck', id: 'lorry', x: 10, z: 30, heading: 0 };

/** A commando driver at the wheel of a truck at (10, 30) heading +x, a man (`extra`) standing at (30, 30) facing +z. */
function bump(campaign, extra = {}, setup = null) {
  const s = bcdSim({ campaign, commandos: [{ role: 'driver', x: 6, z: 26 }], vehicles: [TRUCK],
    enemies: [post('m', 30, 30, Math.PI / 2, extra)] });
  const dr = s.cmd('driver'), tr = s.world.vehicles[0], m = s.get('m');
  assert.ok(tr.enter(dr), 'the driver gets in');
  setup?.(s, m, dr);
  assert.ok(tr.driveTo(50, 30, false), 'slow drive along the man\'s line');
  let closest = Infinity;
  for (let k = 0; k < Math.round(10 / DT); k++) {
    s.step();
    closest = Math.min(closest, Math.hypot(tr.x - m.x, tr.z - m.z));
    if (tr.tainted) break;
  }
  return { tainted: tr.tainted, closest, m, tr, s };
}

test('bump taint (BCD): an ordinary soldier stepping out of a commando-driven lorry\'s way marks it', () => {
  const r = bump('BCD');
  assert.ok(r.m.brain.reacts(), 'a soldier takes notice');
  assert.equal(r.tainted, true, `stepped aside and saw who drives it (closest ${r.closest.toFixed(2)} m)`);
});

test('bump taint (BCD): the dozing lorry driver (truckDriver, reacts false) steps aside and reports nothing', () => {
  const r = bump('BCD', { soldierType: 'truckDriver' });
  assert.equal(r.m.brain.reacts(), false, 'he takes no notice of commandos');
  assert.ok(r.closest < 4.5, `the lorry came up to him (${r.closest.toFixed(2)} m)`);
  assert.equal(r.tainted, false, 'he did not mark it');
  assert.equal(r.s.count('vehicle:tainted'), 0);
});

test('bump taint (BCD): a man out cold or cuffed in the lorry\'s way reports nothing', () => {
  for (const state of ['stunned', 'bound']) {
    const r = bump('BCD', {}, (s, m, dr) => {
      knockOut(m, dr, s.world);
      if (state === 'bound') assert.ok(cuff(m, dr, s.world));
      assert.equal(m.ko, state);
    });
    assert.ok(r.closest < 6, `${state}: the lorry came up to him (${r.closest.toFixed(2)} m)`);
    assert.equal(r.tainted, false, `${state}: lying there, he did not mark it`);
  }
});

test('bump taint (BEL): unchanged, a man who takes no notice of commandos still marks the lorry he steps out of the way of', () => {
  const r = bump('BEL', { soldierType: 'truckDriver' });
  assert.equal(r.s.world.rules.id === 'BCD', false, 'BEL rules');
  assert.equal(r.tainted, true, 'the BEL bump rule marks it');
});
