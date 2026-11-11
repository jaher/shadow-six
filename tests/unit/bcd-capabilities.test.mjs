/**
 * BCD capabilities a mission builder may use (docs/expansion/MECHANICS.md): jail start, the puppet on machines, the
 * pen gate, zone-linked alarm-fail, lifts between heights, drawbridges against boats and patrols, the `deliver`
 * objective, escort / flee, and the remaining pins (Commando Warnings option, lieutenant, Gestapo Luger).
 */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { CONFIG } from '../../src/config.js';
import { multiSelectable } from '../../src/engine/input.js';
import { canSee } from '../../src/ai/perception.js';
import { createInteractable } from '../../src/entities/interactables.js';
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';
import { knockOut, cuff } from '../../src/ai/bcd-enemy.js';
import { OPTION_ROWS } from '../../src/ui/options-panel.js';
import { OPTION_DEFAULTS } from '../../src/ui/ui-config.js';

/** GB at (x, z + 1) with sentry `a` (x, z) cuffed and on puppet strings. (Entities are compared with ===: an
 *  assert.equal diff of two units would print the whole world.) */
function puppetSetup(def = {}, enemies = [], [x, z] = [20, 20]) {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x, z: z + 1 }], ...def, enemies: [post('a', x, z, Math.PI), ...enemies] });
  const gb = s.cmd('greenberet'), a = s.get('a');
  gb.useAbility('knockoutFist', a); s.run(1.2);
  gb.useAbility('handcuff', a); s.run(2);
  gb.useAbility('puppet', a); s.run(0.1);
  assert.ok(a.puppetOf === gb, `on his strings (${gb.state})`);
  return { s, gb, a };
}

// ---------------------------------------------------------------- a) jail start

test('BCD jail start: `jailed: <jail id>` keeps a guest (or any commando) out of play until a commando opens the cell', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'grethe', x: 20, z: 12, jailed: 'cell' }, { role: 'spy', x: 30, z: 30, jailed: 'cell2' }],
    enemies: [post('g', 20, 16, Math.PI / 2)], // looks south, away from the cell (z 12)
    interactables: [{ kind: 'jail', id: 'cell', x: 12, z: 10 }, { kind: 'jail', id: 'cell2', x: 60, z: 60 }] });
  const gb = s.cmd('greenberet'), g = s.cmd('grethe'), spy = s.cmd('spy');
  assert.equal(g.state, 'jailed');
  assert.equal(g.jailId, 'cell', 'the shorthand names the cell');
  assert.equal(multiSelectable(g), false, 'not selectable while jailed');
  assert.equal(canSee(s.get('g'), g, s.world), 'none', 'not seen in the cell');
  assert.equal(gb.useAbility('use', s.get('cell')), true);
  s.run(3);
  assert.equal(g.state, 'active', 'freed: playable');
  assert.equal(g.disguised, true, 'Grethe keeps her civilian cover');
  assert.equal(spy.state, 'jailed', 'another cell stays shut');
  assert.equal(s.count('unit:freed', (p) => p.unit === g && p.jailId === 'cell'), 1);
});

// ---------------------------------------------------------------- b) the puppet on machines

test('BCD puppet works machines: a switch (door), a lever, the drawbridge switch, a lift; seen working them raises nothing', () => {
  // a wall hides the controller (34, 31) from the watcher; the bridge switch (42, 40) and the span are in his view
  const { s, gb, a } = puppetSetup({
    terrain: [{ type: 'rect', terrain: 'water', x: 46, z: 0, w: 8, d: 80 }],
    structures: [{ type: 'wall', points: [[38, 24], [38, 34]] }],
    interactables: [{ kind: 'switch', id: 'sw', x: 30, z: 36, targets: ['d1'] }, { kind: 'door', id: 'd1', x: 10, z: 70 },
      { kind: 'lever', id: 'lv', x: 28, z: 28 },
      { kind: 'drawbridge', id: 'br', x: 50, z: 40, rect: { x: 50, z: 40, w: 12, d: 3, rot: 0 } },
      { kind: 'drawbridgeSwitch', id: 'bsw', x: 42, z: 40, targets: ['br'] },
      { kind: 'lift', id: 'L', x: 30, z: 24, a: [30, 24], b: [26, 34] }] },
  [post('watch', 64, 40, Math.PI)], [34, 30]); // across the canal, facing the switch and the span
  const order = (id) => gb.useAbility('puppet', s.get(id));
  assert.equal(order('sw'), true);
  s.run(20, () => s.get('sw').on);
  assert.equal(s.get('d1').open, true, 'switch → its door');
  order('lv'); s.run(20, () => s.get('lv').on);
  assert.equal(s.get('lv').on, true, 'lever');
  order('bsw'); s.run(25, () => s.get('br').raised);
  assert.equal(s.get('br').raised, true, 'drawbridge switch');
  assert.ok(a.puppetOf === gb, 'still on his strings');
  assert.ok(!s.alarmed() && s.get('watch').brain.state === 'IDLE', 'the guard who saw the bridge go up (and the puppet) raised nothing');
  order('L'); s.run(30, () => s.get('L').at === 1);
  assert.ok(Math.hypot(a.x - 26, a.z - 34) < 1.5, 'the puppet rode the lift');
});

test('BCD winch: `use` sends its lift to the other stop with whoever stands in the cage; inert under BEL', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'spy', x: 30, z: 30 }],
    interactables: [{ kind: 'lift', id: 'cage', x: 10, z: 10, a: [10, 10], b: [10, 30] }, { kind: 'winch', id: 'w', x: 30, z: 32, targets: ['cage'] }] });
  const gb = s.cmd('greenberet'), spy = s.cmd('spy'), cage = s.get('cage');
  assert.equal(s.get('w').interactKind, 'winch');
  assert.equal(spy.useAbility('use', s.get('w')), true);
  s.run(3);
  assert.ok(cage.ride, 'the cage moves');
  s.run(6);
  assert.equal(cage.at, 1);
  assert.ok(Math.hypot(gb.x - 10, gb.z - 30) < 1, 'the man in the cage arrived');
  const bel = bcdSim({ campaign: 'BEL', commandos: [{ role: 'spy', x: 30, z: 30 }], interactables: [{ kind: 'winch', id: 'w', x: 30, z: 32, targets: [] }] });
  assert.notEqual(bel.get('w').canUse(bel.cmd('spy')), true, 'inert under BEL');
});

test('BCD winch worked by a puppet: the cage carries the commando standing in it', () => {
  const { s, gb } = puppetSetup({ commandos: [{ role: 'greenberet', x: 20, z: 21 }, { role: 'sapper', x: 14, z: 20 }],
    interactables: [{ kind: 'lift', id: 'cage', x: 14, z: 20, a: [14, 20], b: [14, 30] }, { kind: 'winch', id: 'w', x: 24, z: 24, targets: ['cage'] }] });
  const sap = s.cmd('sapper');
  assert.equal(gb.useAbility('puppet', s.get('w')), true);
  s.run(25, () => s.get('cage').at === 1);
  assert.equal(s.get('cage').at, 1, 'the puppet worked the winch');
  assert.ok(Math.hypot(sap.x - 14, sap.z - 30) < 1, 'the Sapper rode up');
});

// ---------------------------------------------------------------- c) pen gate

test('BCD pen gate: shut, the ostrich keeps to its pen; open, it roams, kicks a soldier, who runs clear (no alarm)', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 75, z: 75 }],
    structures: [{ type: 'fence', points: [[40, 45], [50, 45], [50, 55], [40, 55], [40, 45]] }],
    enemies: [{ id: 'o', soldierType: 'ostrich', x: 45, z: 50, heading: 0, pen: { x: 45, z: 50, r: 4 }, penGate: 'g' }, post('sol', 57, 50, Math.PI)],
    interactables: [{ kind: 'penGate', id: 'g', x: 50, z: 50 }] });
  const o = s.get('o'), sol = s.get('sol'), g = s.get('g');
  assert.equal(s.world.grid.walkableAt(50, 50), false, 'the shut gate blocks the gap');
  s.run(15);
  assert.ok(Math.hypot(o.x - 45, o.z - 50) <= 4.5, 'gate shut: in the pen');
  assert.equal(sol.hp, sol.maxHp);
  g.setOpen(true);
  assert.equal(s.world.grid.walkableAt(50, 50), true, 'the open gate clears its gap in the fence');
  s.run(60, () => s.count('enemy:flee', (p) => p.enemy === sol && p.from === o) > 0);
  assert.ok(sol.hp < sol.maxHp, 'kicked');
  assert.equal(sol.brain.state, 'FLEE', 'he runs clear of the bird');
  assert.ok(Math.hypot(o.x - 45, o.z - 50) > 4, 'the ostrich left its pen');
  s.run(20);
  assert.ok(!s.alarmed(), 'animals are no alarm');
  assert.ok(sol.alive && sol.brain.state !== 'COMBAT');
});

// ---------------------------------------------------------------- d) zone-linked alarm-fail (firing squad)

test('BCD alarmFail zones: an alarm in a linked zone fails the mission (hook + event to dress it); elsewhere it does not', () => {
  const calls = [];
  const s = bcdSim({ size: [80, 80], commandos: [{ role: 'greenberet', x: 5, z: 5 }],
    enemies: [post('hostage', 70, 70, 0, { soldierType: 'pow' })],
    zones: [{ id: 'yard', poly: [[40, 40], [80, 40], [80, 80], [40, 80]], onSeen: 'RINT' },
      { id: 'quarry', poly: [[0, 40], [30, 40], [30, 80], [0, 80]], onSeen: 'RQ' }],
    alarmFail: { zones: ['yard'], message: 'THE HOSTAGES HAVE BEEN SHOT.', onFail: (w, p) => calls.push(p.zone) },
    triggers: [{ on: 'mission:alarmFail', do: [{ kill: ['hostage'] }] }] });
  s.run(0.2); // the set-piece director starts on its first tick
  s.world.alarm.raise('quarry', 'seen', 10, 50);
  s.run(0.2);
  assert.equal(s.world.scriptFail ?? null, null, 'an unlinked zone');
  s.world.alarm.raise('yard', 'seen', 60, 60);
  s.run(0.2);
  assert.equal(s.world.scriptFail, 'THE HOSTAGES HAVE BEEN SHOT.');
  assert.deepEqual(calls, ['yard']);
  assert.equal(s.count('mission:alarmFail'), 1);
  assert.equal(s.get('hostage').alive, false, 'a trigger dressed it (the volley)');
});

// ---------------------------------------------------------------- e) lift between two heights

test('BCD lift between levels: each stop has its own height (default: the ground there); riders arrive standing on it', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'sapper', x: 10.5, z: 10.5 }] });
  const g = s.world.grid;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) { const x = (i + 0.5) * g.cell, z = (j + 0.5) * g.cell; if (x >= 30 && x <= 50 && z >= 30 && z <= 50) g.elev[g.idx(i, j)] = 8; }
  const lift = createInteractable({ kind: 'lift', id: 'shaft', x: 11, z: 10, a: [10, 10], b: [40, 40] }, { meshes: false });
  s.world.add(lift);
  assert.equal(lift.stops[0].y, 0);
  assert.equal(lift.stops[1].y, 8, 'the upper stop takes the plateau height');
  const gb = s.cmd('greenberet');
  assert.equal(gb.useAbility('use', lift), true);
  s.run(9);
  assert.ok(Math.hypot(gb.x - 40, gb.z - 40) < 1.5 && Math.abs(gb.y - 8) < 0.01, `up on the plateau (y ${gb.y})`);
  assert.equal(gb.moveTo(45, 45), true, 'he walks on the upper level');
  s.run(4);
  assert.ok(Math.abs(gb.y - 8) < 0.01);
  const auth = createInteractable({ kind: 'lift', id: 'L2', x: 5, z: 5, a: [5, 5, 0], b: [5, 20], bY: 3.5 }, { meshes: false });
  s.world.add(auth);
  assert.equal(auth.stops[1].y, 3.5, '`bY` / `b: [x, z, y]` authors a height');
});

// ---------------------------------------------------------------- f) drawbridge: boats and patrols

test('BCD drawbridge: lowered it closes the channel to boats; raised, a patrol whose route crosses waits at its edge', () => {
  const s = bcdSim({ size: [60, 60], commandos: [{ role: 'diver', x: 3, z: 3 }],
    terrain: [{ type: 'rect', terrain: 'water', x: 20, z: 0, w: 10, d: 60 }],
    vehicles: [{ vehicleType: 'rowboat', id: 'boat', x: 25, z: 10, heading: Math.PI / 2 }],
    enemies: [{ id: 'p', soldierType: 'soldier', x: 10, z: 30, heading: 0, route: { type: 'PINGPONG', vel: 1.2, points: [{ x: 10, z: 30 }, { x: 40, z: 30 }] } }],
    interactables: [{ kind: 'drawbridge', id: 'br', x: 25, z: 30, rect: { x: 25, z: 30, w: 12, d: 3, rot: 0 } }] });
  const boat = s.world.vehicles[0], p = s.get('p'), br = s.get('br');
  assert.equal(boat.passableAt(25, 30), false, 'lowered: no boat passes under the span');
  assert.equal(boat.passableAt(25, 20), true);
  br.toggle(); s.run(0.1);
  assert.equal(boat.passableAt(25, 30), true, 'raised: the channel is open');
  s.run(30);
  assert.equal(p.brain.state, 'BRIDGE', 'he waits for the span');
  assert.ok(Math.abs(p.x - 18.2) < 0.6 && Math.abs(p.z - 30) < 0.6, `at its west edge (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  assert.equal(s.count('enemy:bridge-wait', (q) => q.enemy === p), 1);
  br.toggle(); s.run(6); // lowered again (5 s)
  s.run(30, () => p.x > 39);
  assert.ok(p.x > 39, 'down again: he crossed and walked on');
  assert.ok(!s.alarmed());
});

test('BCD drawbridge save / load keeps it raised (state, deck and boat channel)', () => {
  const def = { size: [60, 60], terrain: [{ type: 'rect', terrain: 'water', x: 20, z: 0, w: 10, d: 60 }],
    vehicles: [{ vehicleType: 'rowboat', id: 'boat', x: 25, z: 10, heading: Math.PI / 2 }],
    interactables: [{ kind: 'drawbridge', id: 'br', x: 25, z: 30, rect: { x: 25, z: 30, w: 12, d: 3, rot: 0 } }] };
  const a = bcdSim(def);
  a.get('br').toggle(); a.run(6);
  const saved = a.get('br').serialize();
  const b = bcdSim(def);
  b.get('br').deserialize(saved);
  assert.equal(b.get('br').raised, true);
  assert.equal(b.world.grid.walkableAt(25, 30), false);
  assert.equal(b.world.vehicles[0].passableAt(25, 30), true);
});

// ---------------------------------------------------------------- g) capture alive: the `deliver` objective

test('BCD deliver: a knocked-out, cuffed officer carried to the extraction zone completes it; a free man walking in does not', () => {
  const def = { commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('off', 20, 20, Math.PI, { soldierType: 'officer' })],
    objectives: [{ id: 'take', text: 'Take the officer alive', type: 'deliver', targets: ['off'] }, { id: 'out', text: 'Escape', type: 'escape' }],
    extraction: { x: 40, z: 21, r: 3 } };
  const s = bcdSim(def);
  s.world.objectives = createObjectives(s.mission.objectives);
  const gb = s.cmd('greenberet'), off = s.get('off'), take = s.world.objectives[0];
  off.x = 40; off.z = 21; // standing in the zone, free: not a captive
  checkObjectives(s.world);
  assert.equal(take.done, false, 'a free man is not delivered');
  off.x = 20; off.z = 20;
  knockOut(off, gb, s.world); cuff(off, gb, s.world);
  assert.equal(gb.useAbility('pickUp', off) || gb.useAbility('carry', off) || gb.useAbility('hand', off), true, 'he lifts him');
  s.run(4, () => off.carriedBy === gb);
  assert.ok(off.carriedBy === gb, 'on his shoulder');
  gb.moveTo(40, 21); s.run(20, () => !gb.isMoving);
  checkObjectives(s.world);
  assert.equal(take.done, true, 'delivered on his shoulder');
  // killed on the way: failed
  const k = bcdSim(def);
  k.world.objectives = createObjectives(k.mission.objectives);
  k.get('off').die('knife', k.cmd('greenberet'));
  checkObjectives(k.world);
  assert.equal(k.world.objectives[0].failed, true);
});

test('BCD deliver: a puppet walked into the zone counts', () => {
  const { s, gb, a } = puppetSetup({ objectives: [{ id: 'take', text: 'Take him alive', type: 'deliver', targets: ['a'], zone: { x: 20, z: 30, r: 2 } }] });
  s.world.objectives = createObjectives(s.mission.objectives);
  gb.issue({ type: 'move', x: 20, z: 30 }); // plain orders go to the puppet
  s.run(15, () => Math.hypot(a.x - 20, a.z - 30) < 1.5);
  checkObjectives(s.world);
  assert.equal(s.world.objectives[0].done, true);
});

test('BCD deliver to the extraction vehicle: the captive counts once the vehicle has left with him aboard', () => {
  const { s, gb, a } = puppetSetup({ vehicles: [{ vehicleType: 'truck', id: 'tr', x: 26, z: 26, heading: 0 }],
    objectives: [{ id: 'take', text: 'Take him alive', type: 'deliver', targets: ['a'] }],
    extraction: { vehicleId: 'tr', exit: { x: 70, z: 26, r: 4 } } });
  s.world.objectives = createObjectives(s.mission.objectives);
  const tr = s.world.vehicles[0], take = s.world.objectives[0];
  tr.enter(a); tr.enter(gb);
  checkObjectives(s.world);
  assert.equal(take.done, false, 'aboard, but the vehicle has not left');
  tr.x = 70; tr.z = 26;
  checkObjectives(s.world);
  assert.equal(take.done, true, 'gone through the exit with him aboard');
});

// ---------------------------------------------------------------- h) escort / flee

test('BCD escort: a jailed guest with `follow: \'team\'` follows the nearest commando once freed', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }, { role: 'guest', id: 'clerk', x: 14, z: 12, jailed: 'room', follow: 'team', inventory: {} }],
    interactables: [{ kind: 'jail', id: 'room', x: 12, z: 10 }] });
  const gb = s.cmd('greenberet'), clerk = s.get('clerk');
  gb.useAbility('use', s.get('room')); s.run(3);
  assert.equal(clerk.state, 'active');
  gb.moveTo(30, 30); s.run(20);
  assert.ok(Math.hypot(clerk.x - gb.x, clerk.z - gb.z) < 2.5, `he kept up (${Math.hypot(clerk.x - gb.x, clerk.z - gb.z).toFixed(1)} m)`);
});

test('BCD flee: prisoners run to their point when their gate opens and leave the map; a `deliver` objective counts them', () => {
  const s = bcdSim({ commandos: [{ role: 'spy', x: 5, z: 5 }],
    enemies: [{ id: 'p1', soldierType: 'pow', x: 30, z: 30, heading: 0, flee: { to: [70, 30], when: 'gate' } },
      { id: 'p2', soldierType: 'pow', x: 31, z: 31, heading: 0, flee: { to: [70, 30], when: 'gate' } },
      { id: 'p3', soldierType: 'pow', x: 50, z: 60, heading: 0 }],
    interactables: [{ kind: 'door', id: 'gate', x: 36, z: 30 }],
    objectives: [{ id: 'free', text: 'Free the prisoners', type: 'deliver', targets: ['p1', 'p2'], zone: { x: 70, z: 30, r: 3 } }],
    triggers: [{ on: 'unit:fled', match: { unit: 'p1' }, do: [{ flee: 'p3', to: [5, 60] }] }] });
  s.world.objectives = createObjectives(s.mission.objectives);
  s.run(3);
  assert.equal(s.get('p1').brain.state, 'IDLE', 'they wait while the gate is shut');
  s.get('gate').setOpen(true);
  s.run(40, () => { checkObjectives(s.world); return s.world.objectives[0].done; });
  assert.equal(s.world.objectives[0].done, true, 'both left at their point');
  assert.equal(s.count('unit:fled'), 2);
  assert.ok(s.world.ai.fled.has('p1') && s.world.ai.fled.has('p2'));
  assert.equal(s.world.byId('p1'), null, 'gone from the map');
  s.run(1);
  assert.equal(s.get('p3').brain.state, 'FLEE', 'the `flee` trigger action');
  assert.ok(!s.alarmed());
});

// ---------------------------------------------------------------- i) pins

test('BCD pins: Commando Warnings rides the Options → Game toggle; a lieutenant fights; the Gestapo Luger hits 1.25× harder', () => {
  const row = OPTION_ROWS.find((r) => r[0] === 'warnings');
  const gameAt = OPTION_ROWS.findIndex((r) => r[0] === 'h' && r[1] === 'GAME PREFERENCES');
  assert.ok(row && OPTION_ROWS.indexOf(row) > gameAt, 'COMMANDOS WARNING under GAME PREFERENCES');
  assert.equal(OPTION_DEFAULTS.warnings, true, 'on by default');
  const W = CONFIG.weapons;
  assert.equal(W.gestapoLuger.dmg, W.luger.dmg * CONFIG.bcd.gestapoAccuracy, 'BEL fire never misses: the 1.25× is per hit');
  for (const [type, weapon, dmg] of [['lieutenant', 'luger', W.luger.dmg], ['gestapo', 'gestapoLuger', W.gestapoLuger.dmg]]) {
    const s = bcdSim({ commandos: [{ role: 'sniper', x: 28, z: 20 }], enemies: [post('o', 20, 20, 0, { soldierType: type })] });
    const o = s.get('o'), sn = s.cmd('sniper');
    assert.equal(o.weapon, weapon, type);
    s.run(3);
    assert.ok(['HOLD', 'CHALLENGE', 'COMBAT'].includes(o.brain.state), `${type} holds him at gunpoint (${o.brain.state})`);
    sn.moveTo(30, 28); // he does not surrender: he is shot
    s.run(6, () => sn.hp < sn.maxHp);
    assert.equal(sn.maxHp - sn.hp, dmg, `${type} hit for ${dmg}`);
  }
});
