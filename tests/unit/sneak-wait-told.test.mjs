/**
 * sneak.mjs waitTold (a wait told to video mode) lasts its own number of ticks whether the driver tries its condition
 * every tick or, as M20's solution does (its waits throttled to ten tries a second), every sixth: counted by the clock,
 * not by the condition's calls (counting calls, a half-second wait ran three seconds, past its own timeout).
 */
import { test, assert } from './lib.mjs';
import { waitTold } from '../../tools/solutions/sneak.mjs';

/** A driver whose until() tries its condition every `every` ticks (D.until's loop: try, else tick). */
function fakeDriver(every) {
  const D = { t: 0, dt: 1 / 60, ticks: 0 };
  D.until = async (pred, maxSec, label) => {
    const n = Math.round(maxSec / D.dt);
    let next = -Infinity;
    for (let i = 0; i < n; i++) {
      if (D.t + 1e-9 >= next) { next = D.t + every * D.dt; if (pred()) return true; }
      D.t += D.dt; D.ticks++;
    }
    throw new Error(`timeout ${maxSec}s waiting ${label}`);
  };
  return D;
}

test('waitTold: its own ticks, its condition tried every tick or every sixth', async () => {
  for (const sec of [0.5, 0.75, 2.5]) {
    const a = fakeDriver(1);
    await waitTold(a, sec, 'a gap in the cones');
    assert.equal(a.ticks, Math.round(sec * 60), `${sec} s, every tick`);
    const b = fakeDriver(6);
    await waitTold(b, sec, 'a gap in the cones');
    assert.ok(b.ticks >= a.ticks && b.ticks < a.ticks + 6, `${sec} s, every sixth tick: ${b.ticks} ticks`);
  }
});
