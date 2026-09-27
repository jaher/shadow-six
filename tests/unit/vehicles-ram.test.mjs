/**
 * §3.7 ramming barriers + §7.5 M2 gate_se ('Operable (raise) and rammable at fast speed'): a boom barrier
 * gate (`variant:'barrier_boom'`, `rammable:true`) blocks a slow truck but breaks under a fast one.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import '../../src/abilities/index.js';

function m2() {
  const def = getMission('m02');
  const s = makeSim({ ...def, commandos: def.commandos.filter((c) => c.role === 'driver') }, { brains: false });
  const truck = s.get('truck');
  const gate = s.world.interactables.find((i) => i.tag === 'gate_se');
  const driver = s.cmd('driver');
  driver.setPosition(truck.x - 3, truck.z + 3);
  assert.ok(truck.enter(driver), 'driver boards the truck');
  return { s, truck, gate, driver };
}

const gateBlocked = (s, gate) => {
  const g = s.world.grid;
  let n = 0;
  for (let k = 0; k < g.size; k++) if (g.owner[k] === gate.owner && g.block[k] !== 0) n++;
  return n;
};

test('M2 gate_se: the boom barrier is a rammable barrier (barrier flag, radius covers its width), closed', () => {
  const { s, gate } = m2();
  assert.ok(gate, 'gate_se interactable exists');
  assert.equal(gate.interactKind, 'door');
  assert.equal(gate.barrier, true);
  assert.ok(gate.radius >= 2, `radius ${gate.radius} spans the 4 m boom`);
  assert.equal(gate.open, false);
  assert.ok(gateBlocked(s, gate) > 0, 'closed gate blocks grid cells');
});

test('M2 gate_se: a slow truck stops short of the closed gate; the gate stays intact', () => {
  const { s, truck, gate, driver } = m2();
  const ok = truck.handleOrder(driver, { type: 'move', x: 62, z: 55, run: false });
  s.run(12);
  assert.equal(gate.destroyed, false);
  assert.equal(gate.open, false);
  const past = (truck.x - gate.x) * Math.cos(truck.heading) + (truck.z - gate.z) * Math.sin(truck.heading);
  assert.ok(past < 0, `slow truck (order ok=${ok}) is still before the gate (${past.toFixed(2)})`);
});

test('M2 gate_se: a fast truck (double-click) rams through the closed gate: broken open, grid clear, no explosion', () => {
  const { s, truck, gate, driver } = m2();
  assert.ok(truck.handleOrder(driver, { type: 'move', x: 62, z: 55, run: true }), 'fast order through the gate accepted');
  assert.equal(truck.fast, true);
  s.run(12);
  assert.equal(gate.destroyed, true, 'gate broken');
  assert.equal(gate.open, true);
  assert.equal(gateBlocked(s, gate), 0, 'gate cells cleared');
  const past = (truck.x - gate.x) * Math.cos(truck.heading) + (truck.z - gate.z) * Math.sin(truck.heading);
  assert.ok(past > 2, `truck drove past the gate (${past.toFixed(2)} m)`);
  assert.ok(Math.hypot(truck.x - 62, truck.z - 55) < 1.5, `truck reached the target (${truck.x.toFixed(1)}, ${truck.z.toFixed(1)})`);
  assert.ok(s.events.some((e) => e.name === 'structure:destroyed' && e.p.id === 'gate_se' && e.p.cause === 'ram'));
  assert.ok(!s.events.some((e) => e.name === 'explosion'), 'ramming is not an explosion');
  assert.ok(s.events.some((e) => e.name === 'noise' && e.p.kind === 'crash'), 'the crash makes noise');
  // a broken gate cannot be closed again, and stays broken across save/load
  assert.equal(gate.setOpen(false), false);
  const snap = gate.serialize();
  const { s: s2, gate: g2 } = m2();
  g2.deserialize(snap);
  assert.equal(g2.destroyed, true);
  assert.equal(g2.open, true);
  assert.equal(gateBlocked(s2, g2), 0);
});

test('M2 gate_se: still operable (raise) before any ram; an open gate lets a slow truck through', () => {
  const { s, truck, gate, driver } = m2();
  assert.ok(gate.setOpen(true));
  assert.equal(gateBlocked(s, gate), 0);
  assert.ok(truck.handleOrder(driver, { type: 'move', x: 62, z: 55, run: false }));
  s.run(20);
  assert.equal(gate.destroyed, false, 'an open gate is not rammed');
  assert.ok(Math.hypot(truck.x - 62, truck.z - 55) < 1.5, `truck reached the target (${truck.x.toFixed(1)}, ${truck.z.toFixed(1)})`);
});
