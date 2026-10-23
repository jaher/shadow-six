/**
 * Video mode AUTO and a sneak that gets nowhere (M11, F2: the Sapper lying by the parked half-track, his sneak's next
 * cell refused by the game, planned again every 0.5 s for half a minute — 10-14 s of nothing on screen): the solution
 * tells it as a wait (D.waitNote; its orders meanwhile `quiet`), a path a man does not move along is no action, and a
 * quiet order inside a skipped wait does not end the skip. Presentation only: the run's ticks and orders are the same.
 *   node tests/unit/run.mjs still-waits
 */
import { test, assert } from './lib.mjs';
import { Walkthrough } from '../../src/debug/walkthrough.js';

test('still waits: a path counts as action only while the man moves along it (a refused order\'s path is none)', () => {
  const self = { world: { tick: 1 } }, c = { path: [{ x: 1, z: 1 }], x: 5, z: 5 };
  const moving = () => Walkthrough.prototype._pathMoving.call(self, c);
  assert.equal(moving(), true, 'first sight of a path: action');
  self.world.tick = 2;
  assert.equal(moving(), false, 'a tick on, he has not moved');
  assert.equal(moving(), false, 'the same tick asked again');
  self.world.tick = 3; c.x += 0.02;
  assert.equal(moving(), true, 'he moves along it');
  c.path = null;
  assert.equal(moving(), false, 'no path');
});

test('still waits: a quiet order (inside a reported wait) keeps a skip; any other order ends it', () => {
  let ended = 0;
  const self = { _skip: { label: 'x' }, _endSkip() { ended++; }, world: { time: 1 }, sensor: { order() {} }, scope: { order() {} }, _event() {} };
  const proto = Object.getPrototypeOf(Walkthrough.prototype);
  const base = proto._onOrder;
  proto._onOrder = () => {}; // (the replay's own bookkeeping: camera, markers)
  try {
    Walkthrough.prototype._onOrder.call(self, 'sapper', {}, { type: 'stop' }, { quiet: true });
    assert.equal(ended, 0);
    Walkthrough.prototype._onOrder.call(self, 'sapper', {}, { type: 'move', x: 1, z: 1 });
    assert.equal(ended, 1);
    self._skip = null;
    Walkthrough.prototype._onOrder.call(self, 'sapper', {}, { type: 'stop' }, { quiet: true });
    assert.equal(ended, 2, 'no skip on: as before');
  } finally { proto._onOrder = base; }
});
