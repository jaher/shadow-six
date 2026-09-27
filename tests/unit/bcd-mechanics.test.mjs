/** BCD world mechanics (docs/bcd-plan.md §1.10; plan step N11). */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { ABILITIES } from '../../src/abilities/index.js';

test('BCD sea mine: a boat hull within 1.5 m sets it off (boat and crew lost); a swimmer passes; a bullet detonates it', () => {
  const s = bcdSim({ commandos: [{ role: 'diver', x: 30, z: 30 }], vehicles: [{ vehicleType: 'rowboat', id: 'boat', x: 10, z: 10 }],
    interactables: [{ kind: 'seaMine', id: 'm1', x: 30, z: 30 }, { kind: 'seaMine', id: 'm2', x: 60, z: 60 }, { kind: 'seaMine', id: 'm3', x: 60, z: 20 }] });
  const m1 = s.get('m1'), boat = s.world.vehicles[0];
  s.run(0.5);
  assert.equal(m1.exploded, false, 'the Marine swims over it');
  boat.x = 58; boat.z = 58.5;
  s.run(0.1);
  assert.equal(s.get('m2').exploded, true);
  assert.equal(boat.destroyed, true);
  assert.equal(s.count('bcd:mine'), 1);
  s.get('m3').takeDamage(80, null, 'pistol');
  assert.equal(s.get('m3').exploded, true, 'shot from a distance');
});

test('BCD pushable wagon: GB pushes it along its rail at 0.8 m/s (level-1 noise); it is moving cover', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 17, z: 22 }, { role: 'sniper', x: 5, z: 5 }],
    interactables: [{ kind: 'pushable', id: 'w', x: 20, z: 20, rail: [[10, 20], [40, 20]] }] });
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper'), w = s.get('w');
  assert.notEqual(w.canUse(sn), true, 'the Sniper is not strong enough');
  assert.equal(gb.useAbility('use', w), true);
  s.run(5, () => !!w.goal);
  assert.ok(w.goal, 'pushing');
  const x0 = w.x;
  s.run(5);
  assert.ok(Math.abs(w.x - x0 - 4) < 0.6, `≈ 0.8 m/s along the rail (${(w.x - x0).toFixed(2)} m in 5 s)`);
  assert.equal(w.z, 20, 'stays on the rail');
  assert.ok(s.log.some((l) => l.name === 'noise' && l.p.kind === 'push' && l.p.radius === 6));
  s.world.refreshDynamicOccluders();
  assert.equal(s.world.grid.lineOfSight(w.x, 15, w.x, 25), false, 'the wagon blocks sight');
});

test('BCD fuel tank: blows up (1.5× barrel) on an explosion or 3 bullets', () => {
  const s = bcdSim({ enemies: [post('e', 26, 20, 0)], interactables: [{ kind: 'pushable', variant: 'tank', id: 't', x: 20, z: 20 }, { kind: 'pushable', variant: 'tank', id: 't2', x: 60, z: 60 }] });
  const t = s.get('t');
  t.takeDamage(80, null, 'pistol'); t.takeDamage(80, null, 'pistol');
  assert.equal(t.destroyed, false);
  t.takeDamage(80, null, 'pistol');
  assert.equal(t.destroyed, true);
  assert.equal(s.get('e').alive, false, '6 m: inside the 7.5 m lethal radius');
  s.get('t2').takeDamage(500, null, 'explosion');
  assert.equal(s.get('t2').destroyed, true);
});

test('BCD lift: use at a stop carries the men there to the other stop in 6 s', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'spy', x: 10.5, z: 10.5 }],
    interactables: [{ kind: 'lift', id: 'L', x: 11, z: 10, a: [10, 10], b: [40, 40, 0] }] });
  const gb = s.cmd('greenberet'), spy = s.cmd('spy');
  assert.equal(gb.useAbility('use', s.get('L')), true);
  s.run(3);
  assert.ok(Math.hypot(gb.x - 40, gb.z - 40) > 5, 'still riding');
  s.run(5);
  assert.ok(Math.hypot(gb.x - 40, gb.z - 40) < 1.5 && Math.hypot(spy.x - 40, spy.z - 40) < 1.5);
});

test('BCD drawbridge: the switch raises the span (walkers cannot cross) and lowers it again (5 s)', () => {
  const s = bcdSim({ size: [60, 60], commandos: [{ role: 'sapper', x: 9, z: 20 }],
    terrain: [{ type: 'rect', terrain: 'water', x: 20, z: 0, w: 10, d: 60 }],
    interactables: [{ kind: 'drawbridge', id: 'br', x: 25, z: 20, rect: { x: 25, z: 20, w: 3, d: 12, rot: 0 } },
      { kind: 'drawbridgeSwitch', id: 'sw', x: 10, z: 20, targets: ['br'] }] });
  const g = s.world.grid;
  const walk = () => g.walkableAt(25, 20);
  assert.equal(walk(), true, 'lowered: a walkable deck');
  assert.equal(s.cmd('sapper').useAbility('use', s.get('sw')), true);
  s.run(2);
  assert.equal(walk(), false, 'raised: no deck over the water');
  assert.equal(s.get('br').raised, true);
  s.run(4); // the span finishes rising (5 s) before it can be lowered
  s.cmd('sapper').useAbility('use', s.get('sw'));
  s.run(7);
  assert.equal(s.get('br').raised, false);
  assert.equal(walk(), true);
});

test('BCD knapsack restores its owner’s kit; guests join when a commando reaches them', () => {
  const s = bcdSim({ commandos: [{ role: 'driver', x: 10, z: 10, inventory: { pistol: 0 } }, { role: 'skopje', x: 30, z: 30, joinsAt: { x: 30, z: 30, r: 3 } }],
    interactables: [{ kind: 'knapsack', id: 'k', x: 11, z: 10, ownerRole: 'driver' }] });
  const d = s.cmd('driver'), k = s.cmd('skopje');
  assert.equal(k.state, 'jailed');
  assert.equal(d.useAbility('use', s.get('k')), true);
  s.run(2);
  assert.ok(d.has('leeEnfield') && d.has('pistol'));
  d.x = 29; d.z = 30; d.stop();
  s.run(0.5);
  assert.equal(k.state, 'active', 'Skopje joined');
});

test('BCD mechanics are inert under BEL (flags off)', () => {
  const s = bcdSim({ campaign: 'BEL', commandos: [{ role: 'greenberet', x: 17, z: 22 }], vehicles: [{ vehicleType: 'rowboat', x: 50, z: 50 }],
    interactables: [{ kind: 'seaMine', id: 'm', x: 50, z: 50 }, { kind: 'pushable', id: 'w', x: 20, z: 20, rail: [[10, 20], [40, 20]] }] });
  s.run(0.5);
  assert.equal(s.get('m').exploded, false);
  assert.notEqual(ABILITIES.use.canUse(s.cmd('greenberet'), s.get('w'), s.world), true);
});

test('BCD footprints: mud paths leave AI-visible tracks (BEL: mud is visual only)', () => {
  for (const [campaign, want] of [['BCD', true], ['BEL', false]]) {
    const s = bcdSim({ campaign, terrain: [{ type: 'rect', terrain: 'mud', x: 0, z: 0, w: 40, d: 40 }], commandos: [{ role: 'greenberet', x: 10, z: 10 }] });
    s.cmd('greenberet').moveTo(20, 10);
    s.run(3);
    const fp = s.log.filter((l) => l.name === 'footprint');
    assert.ok(fp.length > 0, campaign);
    assert.equal(fp.every((l) => l.p.aiVisible === want), true, campaign);
  }
});
