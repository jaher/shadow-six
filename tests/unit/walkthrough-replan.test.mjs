/**
 * Video mode AUTO and a sneak that tries again (sneak.mjs: a look-ahead that finds no way, a 0.5–2.5 s back-off wait, the
 * look-ahead again — M13's crawl into the crates' shadow, 37 tries in stage J): the wait's end ends the skip, so every
 * try stood the clock still for THINK_SKIP_MS before it was skipped again (~0.27 s still every 0.5–2.5 s of game). A
 * look-ahead started the moment a wait ends (no tick since), within REPLAN_S of game time of the last skipped plan and
 * with no order since, is skipped at once. Presentation only: the run's ticks and orders are the same.
 *   node tests/unit/run.mjs walkthrough-replan
 */
import { test, assert } from './lib.mjs';
import { Walkthrough, THINK_SKIP_MS, REPLAN_S } from '../../src/debug/walkthrough.js';

const W = Walkthrough.prototype;
const grace = (self) => W._thinkGrace.call(self);

test('replan: a look-ahead started as its wait ends, after a skipped one, gets no grace; any other the usual', () => {
  const self = { world: { time: 2139.85 } };
  assert.equal(grace(self), THINK_SKIP_MS, 'nothing skipped yet');
  self._planSkipT = 2139.35;
  assert.equal(grace(self), THINK_SKIP_MS, 'a skipped plan, but no wait ended now');
  self._waitEndT = 2139.85;
  assert.equal(grace(self), 0, 'the wait ended this very tick, 0.5 s after the skipped plan: skipped at once');
  self.world.time = 2139.85 + 1 / 60;
  assert.equal(grace(self), THINK_SKIP_MS, 'a tick later: not the retry of that wait');
  self.world.time = self._waitEndT = 2139.35 + REPLAN_S + 0.01;
  assert.equal(grace(self), THINK_SKIP_MS, 'longer than REPLAN_S after the skipped plan');
  self._planSkipT = null;
  self.world.time = self._waitEndT = 2140;
  assert.equal(grace(self), THINK_SKIP_MS, 'an order since (cleared)');
});

test('replan: the bookkeeping — a plan skip, a wait\'s end, an order', () => {
  const ended = [];
  const self = {
    world: { time: 10 }, auto: true, _skip: null, pacer: { turbo: false, turboMs: 14 }, turboViewMs: 200, waitLabel: null,
    _planTurbo() {}, _skipTag() {}, _syncBar() {}, _endSkip() { ended.push(this.world.time); this._skip = null; },
    sensor: { order() {} }, scope: { order() {} }, _event() {},
  };
  W._startSkip.call(self, 'a way past the guards');
  assert.equal(self._planSkipT, 10, 'a skipped plan: its game time');
  self._skip = null;
  W._startSkip.call(self, 'e16 walking away east');
  assert.equal(self._planSkipT, 10, 'a skipped wait is not a plan');
  self.world.time = 11.5;
  W._onWait.call(self, 'sapper: a gap in the cones');
  assert.equal(self._waitEndT, undefined, 'a wait beginning is not its end');
  W._onWait.call(self, null);
  assert.equal(self._waitEndT, 11.5, 'the wait ended now');
  assert.deepEqual(ended, [11.5], 'and its skip with it, as before');
  assert.equal(grace(self), 0, 'a look-ahead started now: skipped at once');
  const proto = Object.getPrototypeOf(W), base = proto._onOrder;
  proto._onOrder = () => {}; // (the replay's own bookkeeping: camera, markers)
  try {
    W._onOrder.call(self, 'sapper', {}, { type: 'stop' }, { quiet: true });
    assert.equal(self._planSkipT, 10, 'a quiet order (a futile leg inside the wait) keeps it');
    W._onOrder.call(self, 'sapper', {}, { type: 'move', x: 1, z: 1 });
    assert.equal(self._planSkipT, null, 'an order the men carry out: the next plan gets the usual grace');
    assert.equal(grace(self), THINK_SKIP_MS);
  } finally { proto._onOrder = base; }
});
