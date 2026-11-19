/**
 * BCD captive cargo (docs/expansion/MECHANICS.md "Captive cargo"; src/abilities/drive.js isCaptiveCargo): a cuffed
 * captive carried to a land vehicle is put aboard with Get in — like a downed buddy (§C.8: the carrier stays outside)
 * — and rides in the back, still cuffed, out of every cone. A stunned man (not cuffed) is not cargo, a boat never takes
 * one, and under BEL a carried body never goes aboard. LIGHTS OUT e01 delivers its Hauptmann this way.
 */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { isCaptiveCargo } from '../../src/abilities/drive.js';
import { canSee } from '../../src/ai/perception.js';

const TRUCK = { vehicleType: 'truck', id: 'lorry', x: 24, z: 30, heading: 0 };

/** GB fists guard `a` (facing away), cuffs him and shoulders him. */
function takeCaptive(s, a) {
  const gb = s.cmd('greenberet');
  assert.equal(gb.useAbility('knockoutFist', a), true);
  s.run(1.2);
  assert.equal(a.ko, 'stunned');
  assert.equal(gb.useAbility('handcuff', a), true);
  s.run(2);
  assert.equal(a.ko, 'bound');
  assert.equal(gb.useAbility('hand', a), true);
  s.run(3, () => gb.carrying === a);
  assert.equal(gb.carrying, a, 'shouldered');
  return gb;
}

test('BCD cargo: a cuffed captive carried to a lorry goes aboard with Get in (in the back, still cuffed); the carrier stays out', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], vehicles: [TRUCK], enemies: [post('a', 20, 20, Math.PI)] });
  const a = s.get('a'), lorry = s.world.vehicles[0];
  const gb = takeCaptive(s, a);
  assert.equal(isCaptiveCargo(a, s.world), true);
  assert.equal(gb.issue({ type: 'ability', id: 'enterVehicle', target: lorry }), true, gb.lastRefusal?.text);
  s.run(20, () => a.vehicle === lorry);
  assert.equal(a.vehicle, lorry, 'aboard');
  assert.equal(a.state, 'inVehicle');
  assert.equal(a.ko, 'bound', 'still cuffed');
  assert.notEqual(lorry.driver, a, 'never at the wheel');
  assert.equal(gb.carrying, null, 'his hands are free');
  assert.equal(gb.vehicle ?? null, null, 'the Green Beret stays outside');
  assert.equal(s.count('load:dropped', (p) => p.how === 'vehicle' && p.load === a), 1);
  // a man in the back of a land vehicle is out of every cone
  const eye = { x: lorry.x + 6, z: lorry.z, heading: Math.PI, vision: s.get('a').vision, faction: 'enemy' };
  assert.equal(canSee(eye, a, s.world), 'none', 'not seen aboard');
});

test('BCD cargo: a stunned (uncuffed) man is not cargo, the BEL rules never load one, and a boat refuses a carried captive', () => {
  // stunned only: not cargo
  {
    const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], vehicles: [TRUCK], enemies: [post('a', 20, 20, Math.PI)] });
    const a = s.get('a'), gb = s.cmd('greenberet');
    assert.equal(gb.useAbility('knockoutFist', a), true);
    s.run(1.2);
    assert.equal(a.ko, 'stunned');
    assert.equal(isCaptiveCargo(a, s.world), false, 'stunned is not cargo');
  }
  // BEL: the ruleset has no cuffs, a carried enemy is never cargo
  {
    const s = bcdSim({ campaign: 'BEL', commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
    const a = s.get('a');
    a.ko = 'bound';
    assert.equal(isCaptiveCargo(a, s.world), false, 'BEL: never');
  }
  // a boat never takes one (land vehicles only): he is still on the Green Beret's shoulder
  {
    const s = bcdSim({ size: [60, 60], commandos: [{ role: 'greenberet', x: 14, z: 21 }], enemies: [post('a', 14, 20, Math.PI)],
      terrain: [{ type: 'rect', terrain: 'water', x: 20, z: 0, w: 10, d: 60 }],
      vehicles: [{ vehicleType: 'rowboat', id: 'boat', x: 22, z: 21, heading: Math.PI / 2 }] });
    const a = s.get('a'), boat = s.world.vehicles[0];
    const gb = takeCaptive(s, a);
    gb.issue({ type: 'ability', id: 'enterVehicle', target: boat });
    s.run(8);
    assert.notEqual(a.vehicle, boat, 'not into a boat');
    assert.equal(a.ko, 'bound');
  }
});
