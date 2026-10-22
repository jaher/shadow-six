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
