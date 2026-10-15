/**
 * Video mode / solution replay presentation (user, M3: "When the spy grabs the clothes there is no time to see how he
 * grabs them and we transition straight to another commando. When a commando is chosen the power right bag should
 * reflect the items from the corresponding commando. Every time a commando is manipulated we should see the circle
 * around that commando."):
 *  - an action is held until it has visibly finished (src/debug/action-hold.js): while it runs, while its clip still
 *    plays, while the man it killed falls, plus a beat; long actions for their first seconds only;
 *  - every order selects the man it goes to, as a portrait click (SolutionReplay._selectActor → Input.select, silent),
 *    several men ordered in a row together.
 */
import { test, assert, near } from './lib.mjs';
import { ActionHolds, HOLD_BEAT, FALL_S, HOLD_MAX, HOLD_MAX_BY, HELD } from '../../src/debug/action-hold.js';
import { SolutionReplay, SELECT_GROUP_S } from '../../src/debug/solution-replay.js';

const man = (role, o = {}) => ({ kind: 'commando', role, id: role, alive: true, currentActionId: null, _animOverride: null, ...o });

test('action hold: the clothesline take is watched while it runs, while its clip plays on, and a beat after', () => {
  const H = new ActionHolds();
  const spy = man('spy');
  const line = { tag: 'uniform_line', x: 120, z: 60 };
  spy.currentActionId = 'use';
  const h = H.start(spy, 'use', line, 820, { step: 'C3' });
  assert.ok(h && h.target === line && h.meta.step === 'C3');
  assert.equal(H.current(821), h, 'running: held');
  assert.equal(H.current(822.9), h);
  // the task ends at 823 with 0.4 s of the dressing clip left
  spy._animOverride = { name: 'use', t: 0.4 };
  H.end(spy, 'use', 823);
  spy.currentActionId = null;
  near(h.end, 823.4, 1e-9, 'visibly finished when its clip has played out');
  assert.equal(H.current(823.4 + HOLD_BEAT - 0.01), h, '… then the beat');
  assert.equal(H.current(823.4 + HOLD_BEAT + 0.01), null, 'then the director may cut away');
  assert.equal(H.list.length, 0, 'spent holds are dropped');
});

test('action hold: a knife is held while the victim falls; not every ability is a moment; the newest hold wins', () => {
  const H = new ActionHolds();
  const gb = man('greenberet'), e5 = { tag: 'e5', x: 1, z: 2 };
  gb.currentActionId = 'knife';
  const h = H.start(gb, 'knife', e5, 100);
  H.killed(e5, gb, 100.4);
  H.end(gb, 'knife', 100.5);
  gb.currentActionId = null;
  assert.equal(H.current(100.4 + FALL_S + HOLD_BEAT - 0.01), h, 'the fall, then the beat');
  assert.equal(H.current(100.4 + FALL_S + HOLD_BEAT + 0.01), null);
  for (const id of ['shovel', 'dive', 'climb', 'leaveVehicle']) assert.equal(H.start(gb, id, null, 0), null, `${id}: not held`);
  for (const id of ['knife', 'syringe', 'timeBomb', 'remoteBomb', 'uniform', 'use', 'cutters', 'trap', 'harpoon', 'raft']) assert.ok(HELD.has(id), `${id} (the raft inflated or folded too)`);
  const sp = man('sapper', { currentActionId: 'timeBomb' }), dv = man('diver', { currentActionId: 'harpoon' });
  H.start(sp, 'timeBomb', null, 200);
  const h2 = H.start(dv, 'harpoon', e5, 201);
  assert.equal(H.current(201.5), h2, 'the latest action is the one watched');
  sp.currentActionId = 'cutters';
  const h3 = H.start(sp, 'cutters', null, 202);
  assert.equal(H.list.filter((x) => x.unit === sp).length, 1, "a man's new action replaces his last");
  assert.equal(H.current(202.1), h3);
});

test('action hold: however long an action runs (the unit says when it is over), it is held to its end', () => {
  const H = new ActionHolds();
  const dv = man('diver', { currentActionId: 'raft' });
  const h = H.start(dv, 'raft', null, 10);
  assert.equal(H.current(10 + 25), h, 'a long inflation (25 s) is still watched: no length is assumed');
  dv.currentActionId = null;
  assert.equal(H.current(35.1), h, '… stopped: then the beat');
  assert.equal(H.current(35.1 + HOLD_BEAT + 0.05), null);
});

test('action hold: an action stopped without its end event, long actions, a dead man', () => {
  const H = new ActionHolds();
  const spy = man('spy', { currentActionId: 'distract' });
  const h = H.start(spy, 'distract', { tag: 'e17' }, 50);
  assert.equal(H.current(52), h);
  assert.equal(H.current(50 + HOLD_MAX_BY.distract + 0.1), null, 'a chat-up is held for its first seconds only');
  const gb = man('greenberet', { currentActionId: 'decoyToggle' });
  const h2 = H.start(gb, 'decoyToggle', null, 60);
  gb.currentActionId = null; // (cancelled: no ability:end)
  assert.equal(H.current(60.2), h2, 'seen stopped: it ends now, then the beat');
  assert.equal(H.current(60.2 + HOLD_BEAT + 0.01), null);
  const sp = man('sapper', { currentActionId: 'timeBomb' });
  H.start(sp, 'timeBomb', null, 70);
  assert.equal(H.current(70 + HOLD_MAX + 0.1), null, `held ${HOLD_MAX} s at most`);
  assert.equal(new ActionHolds().start({ kind: 'enemy' }, 'knife', null, 0), null, 'commandos only');
});

test('the man an order goes to is selected as by a portrait click (silent); men ordered in a row together', () => {
  const calls = [];
  const cs = ['greenberet', 'sapper', 'spy'].map((r) => man(r, { selected: false }));
  const world = { time: 10, commandos: cs, rules: {}, events: null, enemies: [], interactables: [], vehicles: [] };
  const input = { select(units, o) { calls.push([units.map((u) => u.role).join('+'), !!o?.silent]); for (const c of cs) c.selected = units.includes(c); } };
  const rp = new SolutionReplay({ world, input, state: 'playing' }, { id: 'm03', stages: [] });
  const [gb, sp, spy] = cs;
  rp._onOrder('sapper', sp, { type: 'move', x: 1, z: 1 });
  assert.deepEqual(calls.pop(), ['sapper', true], 'the sapper selected, without the "Yes?" voice');
  rp._onOrder('sapper', sp, { type: 'move', x: 2, z: 1 });
  assert.equal(calls.length, 0, 'already selected: nothing to do');
  world.time += 0.2;
  rp._onOrder('greenberet', gb, { type: 'ability', id: 'decoyDrop' });
  assert.deepEqual(calls.pop(), ['sapper+greenberet', true], `two men ordered within ${SELECT_GROUP_S} s: both selected (two rings)`);
  world.time += 0.3; // (0.5 s after the group's first order: a new order to one of them is his alone)
  rp._onOrder('greenberet', gb, { type: 'move', x: 5, z: 5 });
  assert.deepEqual(calls.pop(), ['greenberet', true], 'a later order: that man alone (orders in a row do not pile up)');
  world.time += 5;
  rp._onOrder('spy', spy, { type: 'move', x: 3, z: 3 });
  assert.deepEqual(calls.pop(), ['spy', true], 'later: the Spy alone');
  assert.ok(spy.selected && !gb.selected && !sp.selected);
  // while the Spy's clothesline take is watched to its end, an order to the Marine waits to move the HUD to him
  spy.currentActionId = 'use';
  rp.holds.start(spy, 'use', null, world.time);
  world.time += 0.4;
  rp._onOrder('diver', cs[0], { type: 'move', x: 9, z: 9 }); // (cs[0] stands in for the Marine)
  assert.equal(calls.length, 0, 'the HUD stays on the Spy while her take is watched');
  spy.currentActionId = null;
  world.time += 0.2;
  assert.ok(rp.holdNow(), 'the beat');
  world.time += HOLD_BEAT;
  if (rp._selPending && !rp.holdNow()) { rp._selPending = false; rp._applySelection(); } // (SolutionReplay._frame)
  assert.deepEqual(calls.pop(), ['greenberet', true], 'then it follows the order');
  world.rules.puppet = true;
  world.time += 5;
  rp._onOrder('greenberet', gb, { type: 'move', x: 0, z: 0 });
  assert.equal(calls.length, 0, 'BCD puppets: never (selecting another man releases a puppet)');
});
