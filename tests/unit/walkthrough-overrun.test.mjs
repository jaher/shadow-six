// AUTO's overrun measure (debug/walkthrough.js nextOverrun): the look-ahead past the last frame's tick budget, a decaying
// maximum — only a tick window the last frame opened counts. A window left from before a pause or a fast-forward (the
// pacer leaves tickFrom as it was then) against a later look's hand-back measured minutes (M8 after a chapter jump: 131 s;
// AUTO's ticks cut to ~1 ms a frame, its time-lapse to ~1x for ~400 frames).
import { test, assert, near } from './lib.mjs';
import { nextOverrun } from '../../src/debug/walkthrough.js';

test('nextOverrun: the last frame\'s window past its budget counts; it decays by 0.97 a frame', () => {
  // the last frame began at 1000; its ticks from 1002 with a 10 ms budget, the look ran on to 1020: 8 ms past
  near(nextOverrun(0, 1002, 1020, 10, 1000), 8);
  near(nextOverrun(5, 1002, 1009, 10, 1000), 5 * 0.97, 1e-9, 'within budget: the old one decays');
  near(nextOverrun(20, 1002, 1020, 10, 1000), 20 * 0.97, 1e-9, 'the larger of the two');
  assert.equal(nextOverrun(undefined, -1, 0, 10, 1000), undefined, 'nothing yet: nothing');
  near(nextOverrun(4, -1, 1020, 10, 1000), 4 * 0.97, 1e-9, 'no window this frame: decays');
  near(nextOverrun(4, 1002, 1001, 10, 1000), 4 * 0.97, 1e-9, 'work ended before the window: decays');
});

test('nextOverrun: a stale window (opened before the last frame) never counts — the jump-to-S case', () => {
  // the pacer's window from before a fast-forward (t 5 000 ms), a look's hand-back during it at 136 652 ms
  near(nextOverrun(0.5, 5000, 136652.7, 12, 136600), 0.5 * 0.97, 1e-9, 'decays, no 131 s overrun');
  assert.equal(nextOverrun(0, 5000, 136652.7, 12, 136600), 0);
  // (negative control: without the frame gate — frameAt -Infinity, the old measure — it is the 131 s)
  assert.ok(nextOverrun(0, 5000, 136652.7, 12, -Infinity) > 131000);
});
