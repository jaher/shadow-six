/**
 * EventBus.onLate (visual-only handlers: fx, crater marks, blast-front visuals): in subscription order with the others
 * when the bus is not deferring; queued while it defers (Game.step under deferVisuals) and run by flushLate() in emit
 * order, with what capture() returned at emit; dropLate() forgets them.
 */
import { test, assert } from './lib.mjs';
import { EventBus } from '../../src/core/events.js';

test('onLate: in order at once when not deferring; queued with its capture while deferring; flushLate / dropLate', () => {
  const bus = new EventBus(), log = [];
  let clock = 1;
  bus.on('x', (p) => log.push(`a${p}`));
  bus.onLate('x', (p, t, at) => log.push(`L${p}@${at}`), () => clock);
  bus.on('x', (p) => log.push(`b${p}`));
  bus.emit('x', 1);
  assert.deepEqual(log, ['a1', 'L1@undefined', 'b1'], 'subscription order kept when not deferring (no capture: run at its moment)');
  log.length = 0;
  bus.deferring = true;
  bus.emit('x', 2); clock = 2; bus.emit('x', 3);
  bus.deferring = false;
  assert.deepEqual(log, ['a2', 'b2', 'a3', 'b3'], 'the late handler waits');
  clock = 9;
  assert.equal(bus.flushLate(), 2);
  assert.deepEqual(log.slice(4), ['L2@1', 'L3@2'], 'flushed in emit order with the clock at emit');
  assert.equal(bus.flushLate(), 0);
  bus.deferring = true; bus.emit('x', 4); bus.deferring = false;
  bus.dropLate();
  assert.equal(bus.flushLate(), 0, 'dropped');
  // a late handler that throws does not stop the others
  bus.onLate('y', () => { throw new Error('boom'); });
  bus.onLate('y', () => log.push('y2'));
  const err = console.error; console.error = () => {};
  try { bus.deferring = true; bus.emit('y'); bus.deferring = false; bus.flushLate(); } finally { console.error = err; }
  assert.equal(log[log.length - 1], 'y2');
});

test('later: a drawing call made at once when not deferring, queued in order with the late handlers while deferring', () => {
  const bus = new EventBus(), log = [];
  bus.onLate('x', (p) => log.push(`L${p}`));
  bus.later((a, b, c) => log.push(`c${a}${b}${c}`), 1, 2, 3);
  assert.deepEqual(log, ['c123'], 'at once');
  bus.deferring = true;
  bus.emit('x', 1); bus.later((a, b) => log.push(`d${a}${b}`), 'u', 'walk'); bus.emit('x', 2);
  bus.deferring = false;
  assert.deepEqual(log, ['c123'], 'nothing made while deferring');
  assert.equal(bus.flushLate(), 3);
  assert.deepEqual(log, ['c123', 'L1', 'duwalk', 'L2'], 'in emit order with the handlers');
});

test('Unit._setAnim: the model hears the clip switch at the next draw under a deferring bus, in order, the last one standing', async () => {
  const { Unit } = await import('../../src/entities/unit.js');
  const calls = [];
  const model = { root: { userData: {}, position: { set() {} }, rotation: {} }, setAnim: (n, o) => calls.push(`${n}${o?.restart ? '!' : ''}`) };
  const u = new Unit({ kind: 'enemy', faction: 'enemy', role: 'enemy', x: 1, z: 1, model });
  assert.deepEqual(calls, ['idle'], 'made at once outside a world (the constructor)');
  const bus = new EventBus();
  u.world = { events: bus };
  u._setAnim('walk');
  assert.deepEqual(calls, ['idle', 'walk'], 'at once when the bus does not defer');
  bus.deferring = true;
  u._setAnim('run'); u.playAction('shoot', 0.3); u._setAnim('walk');
  assert.equal(u._anim, 'walk', 'the unit itself knows at once');
  assert.deepEqual(calls, ['idle', 'walk'], 'the model waits');
  bus.deferring = false;
  bus.flushLate();
  assert.deepEqual(calls, ['idle', 'walk', 'run', 'shoot!', 'walk'], 'made in order at the flush');
});
