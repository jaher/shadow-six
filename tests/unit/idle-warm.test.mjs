/**
 * engine/idle-warm.js: the cache fills a still screen runs (the walkthrough's cards, normal play's briefing behind its
 * opaque first page: Game._frame) — runFor takes one task at least, more while they take under the budget together,
 * and a cleared queue (a mission unload) drops what the old mission queued.
 */
import { test, assert } from './lib.mjs';
import { idleWarm } from '../../src/engine/idle-warm.js';

const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* busy */ } };

test('idle warm: runFor runs one task at least, then more while under the budget', () => {
  idleWarm.clear();
  const ran = [];
  for (let i = 0; i < 5; i++) idleWarm.add(`t${i}`, () => { ran.push(i); spin(4); });
  assert.equal(idleWarm.runFor(0), 1, 'a zero budget still runs one');
  assert.deepEqual(ran, [0]);
  const n = idleWarm.runFor(6); // (4 ms each: the second one ends past 6 ms)
  assert.ok(n >= 1 && n <= 2, `ran ${n} under a 6 ms budget`);
  idleWarm.runFor(1e6);
  assert.deepEqual(ran, [0, 1, 2, 3, 4], 'every task once, in order');
  assert.equal(idleWarm.pending, 0);
  assert.equal(idleWarm.runFor(5), 0, 'nothing left: nothing run');
});

test('idle warm: clear drops the queued tasks; a throwing task does not stop the queue', () => {
  idleWarm.clear();
  let a = 0;
  idleWarm.add('old', () => { a++; });
  idleWarm.clear();
  assert.equal(idleWarm.pending, 0);
  const warn = console.warn; console.warn = () => {};
  try {
    idleWarm.add('bad', () => { throw new Error('x'); });
    idleWarm.add('good', () => { a += 10; });
    assert.equal(idleWarm.runFor(1e6), 2);
  } finally { console.warn = warn; }
  assert.equal(a, 10);
});
