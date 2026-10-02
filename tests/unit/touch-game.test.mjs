/** TouchGame (src/input/touch-game.js) with a stub game: the tap that stops a coasting map gives no order. */
import { test, assert } from './lib.mjs';
import { TouchGame, TOUCH_PAN } from '../../src/input/touch-game.js';

function rig() {
  const clicks = [];
  const game = {
    input: { active: true, click: (x, y, o) => { clicks.push({ x, y, ...o }); return 'move'; } },
    cameraController: { zoom: 1, tracking: false, panScreen() {}, zoomAt: (z) => z, untrack() {} },
    cameraRig: { count: 1, panLocked: false },
    hud: null,
  };
  const tg = new TouchGame(game, null);
  /** A finger down + up at (x, y) at time t (as the pointer listeners do). */
  const tap = (x, y, t) => {
    tg.touchDown(t);
    tg.handle(tg.gestures.down(1, x, y, t));
    tg.handle(tg.gestures.up(1, x, y, t + 60));
    return tg.log.at(-1);
  };
  /** A fast one-finger flick to the left ending at time t. */
  const fling = (t) => {
    tg.touchDown(t - 100);
    tg.handle(tg.gestures.down(1, 400, 200, t - 100));
    for (let k = 1; k <= 6; k++) tg.handle(tg.gestures.move(1, 400 - 30 * k, 200, t - 100 + 16 * k));
    tg.handle(tg.gestures.up(1, 220, 200, t));
  };
  return { tg, clicks, tap, fling };
}

test('a plain tap is a click', () => {
  const { tap, clicks } = rig();
  assert.equal(tap(300, 200, 1000).result, 'move');
  assert.equal(clicks.length, 1);
});

test('a tap on the coasting map only stops it (no order)', () => {
  const { tg, clicks, tap, fling } = rig();
  fling(1000);
  assert.ok(tg.velocity.x < -500, `flick coasts (${tg.velocity.x})`);
  const r = tap(300, 200, 1080);
  assert.equal(r.type, 'tap');
  assert.equal(r.result, 'stop');
  assert.equal(clicks.length, 0, 'no move order');
  assert.equal(tg.velocity.x, 0);
  // the next tap (not a double tap of the stopping one) is an ordinary walk
  const r2 = tap(302, 200, 1200);
  assert.equal(r2.result, 'move');
  assert.equal(clicks.length, 1);
  assert.ok(!clicks[0].double, 'the stopping tap does not start a double tap');
});

test('a tap just after the coast died out is still used up; later taps order', () => {
  const { tg, clicks, tap, fling } = rig();
  fling(1000);
  tg.velocity.x = tg.velocity.y = 0; // the coast ended (on its own) ...
  tg._coastT = 2000; // ... at t = 2000
  assert.equal(tap(300, 200, 2000 + TOUCH_PAN.stopTapMs - 20).result, 'stop');
  assert.equal(tap(300, 260, 2000 + TOUCH_PAN.stopTapMs + 600).result, 'move');
  assert.equal(clicks.length, 1);
});

test('a slow drag that stops before lifting does not coast, so the next tap orders', () => {
  const { tg, clicks, tap } = rig();
  tg.touchDown(0);
  tg.handle(tg.gestures.down(1, 400, 200, 0));
  for (let k = 1; k <= 6; k++) tg.handle(tg.gestures.move(1, 400 - 20 * k, 200, 16 * k));
  tg.handle(tg.gestures.up(1, 280, 200, 400));
  assert.equal(tg.velocity.x, 0);
  assert.equal(tap(300, 200, 500).result, 'move');
  assert.equal(clicks.length, 1);
});

// ---- finger-sized HUD (src/ui/touch.js touchHudScales, src/ui/knapsack.js nearestSlot)
import { touchHudScales, TOUCH_TARGET } from '../../src/ui/touch.js';
import { nearestSlot } from '../../src/ui/knapsack.js';

test('touch HUD: an upright phone gets a bar fitted to its real content and a finger-sized bag', () => {
  const u = Math.max(0.6, 390 / 600); // the desktop fit (iPhone 14 upright)
  const { ut, ub } = touchHudScales({ u, byH: 1, w: 390, h: 664, men: 3 });
  assert.ok(ut > 0.85 && ut <= 1, `ut ${ut}`);
  assert.ok(ub >= 1.15 && ub <= 1.2, `ub ${ub}`);
  // the bar still fits: 3 portraits + icons in ref px × ut + the two px-floored icons
  assert.ok((152 + 65 * 3) * ut + 2 * TOUCH_TARGET <= 390 + 1e-6);
  // six men: never below the desktop scale
  const six = touchHudScales({ u, byH: 1, w: 390, h: 664, men: 6 });
  assert.ok(six.ut >= u - 1e-3 && six.ub >= six.ut);
});

test('touch HUD: landscape phone keeps the bar at its height scale; a tablet is never shrunk', () => {
  const l = touchHudScales({ u: 1, byH: 1, w: 664, h: 390, men: 6 });
  assert.equal(l.ut, 1);
  assert.ok(l.ub > 1.1 && l.ub < 1.2, `ub ${l.ub}`);
  const tab = touchHudScales({ u: 2, byH: 2, w: 2048, h: 1536, men: 6 });
  assert.equal(tab.ut, 2);
  assert.equal(tab.ub, 2);
});

test('bag: a tap on a slot is that slot; between slots, the nearest one within the slop; far away, none', () => {
  const a = { el: 'knife', left: 100, top: 100, right: 150, bottom: 120 };
  const b = { el: 'decoy', left: 100, top: 140, right: 120, bottom: 170 };
  assert.equal(nearestSlot([a, b], 110, 110), 'knife');
  assert.equal(nearestSlot([a, b], 110, 150), 'decoy');
  assert.equal(nearestSlot([a, b], 110, 126), 'knife'); // 6 px under the knife, 14 px over the decoy
  assert.equal(nearestSlot([a, b], 110, 134), 'decoy');
  assert.equal(nearestSlot([a, b], 125, 160), 'decoy'); // beside the narrow decoy
  assert.equal(nearestSlot([a, b], 300, 300), null);
});
