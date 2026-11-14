/** Touch gesture classifier (src/input/gestures.js): tap vs drag vs pinch thresholds, double tap, long press. */
import { test, assert, near } from './lib.mjs';
import { GestureClassifier, TOUCH } from '../../src/input/gestures.js';

const types = (evs) => evs.map((e) => e.type);

test('a still, short touch is a tap at the touch-down point', () => {
  const g = new GestureClassifier();
  g.down(1, 100, 100, 0);
  assert.deepEqual(g.move(1, 104, 103, 50), []); // under the 10 px threshold: still a tap
  const out = g.up(1, 104, 103, 120);
  assert.deepEqual(types(out), ['tap']);
  assert.equal(out[0].x, 100);
  assert.equal(out[0].double, false);
  assert.equal(g.state, 'idle');
});

test('moving past the threshold is a pan, never a tap', () => {
  const g = new GestureClassifier();
  g.down(1, 100, 100, 0);
  const ev = g.move(1, 100 + TOUCH.tapMovePx + 1, 100, 30);
  assert.deepEqual(types(ev), ['panstart', 'pan']);
  near(ev[1].dx, TOUCH.tapMovePx + 1); // measured from the touch-down point
  const ev2 = g.move(1, 130, 110, 40);
  assert.equal(ev2[0].dx, 130 - 111);
  assert.equal(ev2[0].dy, 10);
  // dragging back to the start and lifting still does not tap
  g.move(1, 100, 100, 60);
  assert.deepEqual(types(g.up(1, 100, 100, 80)), ['panend']);
});

test('a touch held longer than tapMaxMs is not a tap', () => {
  const g = new GestureClassifier({ longPressMs: 99999 });
  g.down(1, 50, 50, 0);
  assert.deepEqual(g.up(1, 50, 50, TOUCH.tapMaxMs + 1), []);
});

test('two quick taps close together: the second is a double tap; a third starts over', () => {
  const g = new GestureClassifier();
  g.down(1, 200, 200, 0); g.up(1, 200, 200, 60);
  g.down(2, 215, 210, 200);
  const d = g.up(2, 215, 210, 260);
  assert.equal(d[0].type, 'tap');
  assert.equal(d[0].double, true);
  g.down(3, 215, 210, 400);
  assert.equal(g.up(3, 215, 210, 450)[0].double, false);
});

test('a second tap too late or too far is single', () => {
  const g = new GestureClassifier();
  g.down(1, 200, 200, 0); g.up(1, 200, 200, 60);
  g.down(1, 200, 200, 60 + TOUCH.doubleTapMs + 50);
  assert.equal(g.up(1, 200, 200, 60 + TOUCH.doubleTapMs + 90)[0].double, false);
  const h = new GestureClassifier();
  h.down(1, 200, 200, 0); h.up(1, 200, 200, 60);
  h.down(1, 200 + TOUCH.doubleTapPx + 5, 200, 150);
  assert.equal(h.up(1, 200 + TOUCH.doubleTapPx + 5, 200, 190)[0].double, false);
});

test('a fast flick releases with a velocity; a finger that stopped first does not coast', () => {
  const g = new GestureClassifier();
  g.down(1, 0, 0, 0);
  for (let k = 1; k <= 6; k++) g.move(1, k * 20, 0, k * 16);
  const end = g.up(1, 120, 0, 100);
  assert.equal(end[0].type, 'panend');
  assert.ok(end[0].vx > 800, `vx ${end[0].vx}`);
  const h = new GestureClassifier();
  h.down(1, 0, 0, 0);
  for (let k = 1; k <= 6; k++) h.move(1, k * 20, 0, k * 16);
  const e2 = h.up(1, 120, 0, 400); // held still 300 ms before lifting
  assert.equal(e2[0].vx, 0);
});

test('two fingers pinch: scale from the finger distance, midpoint and its motion', () => {
  const g = new GestureClassifier();
  g.down(1, 100, 100, 0);
  const s = g.down(2, 200, 100, 10);
  assert.deepEqual(types(s), ['pinchstart']);
  assert.equal(s[0].cx, 150);
  const p = g.move(2, 300, 100, 30); // spread: 100 → 200 px
  assert.equal(p[0].type, 'pinch');
  near(p[0].scale, 2);
  assert.equal(p[0].cx, 200);
  assert.equal(p[0].dx, 50);
  const q = g.move(1, 200, 100, 40); // fingers closer again: 100 px
  near(q[0].scale, 1);
  // lifting one finger ends the pinch and never taps, nor does the second lift
  assert.deepEqual(types(g.up(1, 200, 100, 60)), ['pinchend']);
  assert.deepEqual(g.up(2, 300, 100, 70), []);
  assert.equal(g.state, 'idle');
});

test('a pan interrupted by a second finger becomes a pinch with no fling', () => {
  const g = new GestureClassifier();
  g.down(1, 0, 0, 0);
  g.move(1, 40, 0, 20);
  const ev = g.down(2, 100, 100, 30);
  assert.deepEqual(types(ev), ['panend', 'pinchstart']);
  assert.equal(ev[0].vx, 0);
});

test('after a pinch the remaining finger can pan but not tap', () => {
  const g = new GestureClassifier();
  g.down(1, 0, 0, 0); g.down(2, 100, 0, 5);
  g.up(2, 100, 0, 50);
  assert.equal(g.state, 'held');
  assert.deepEqual(types(g.move(1, 30, 0, 70)), ['panstart', 'pan']);
  assert.deepEqual(types(g.up(1, 30, 0, 90)), ['panend']);
  const h = new GestureClassifier();
  h.down(1, 0, 0, 0); h.down(2, 100, 0, 5); h.up(2, 100, 0, 50);
  assert.deepEqual(h.up(1, 0, 0, 80), []);
});

test('a still finger held past longPressMs fires one long press and no tap', () => {
  const g = new GestureClassifier();
  g.down(1, 70, 80, 0);
  assert.deepEqual(g.tick(TOUCH.longPressMs - 1), []);
  const lp = g.tick(TOUCH.longPressMs + 1);
  assert.deepEqual(types(lp), ['longpress']);
  assert.equal(lp[0].x, 70);
  assert.deepEqual(g.tick(TOUCH.longPressMs + 100), []);
  assert.deepEqual(g.up(1, 70, 80, TOUCH.longPressMs + 120), []);
});

test('pointercancel ends a gesture without a tap', () => {
  const g = new GestureClassifier();
  g.down(1, 0, 0, 0);
  assert.deepEqual(g.cancel(1), []);
  assert.equal(g.state, 'idle');
  assert.deepEqual(g.up(1, 0, 0, 10), []);
});

/** Two-finger twist: rotating the fingers turns the map with them, never an order. */
function twistPair(g, cx, cy, r, a0, a1, t) {
  // both fingers around (cx, cy) at distance r, from angle a0 to a1 (deg, clockwise-positive on screen)
  const pt = (a, s) => [cx + s * r * Math.cos((a * Math.PI) / 180), cy + s * r * Math.sin((a * Math.PI) / 180)];
  const out = [];
  out.push(...g.move(1, ...pt(a1, -1), t));
  out.push(...g.move(2, ...pt(a1, 1), t));
  return out;
}

test('two fingers twisting: pinch events carry dAngle (clockwise-positive), scale stays ~1, no tap', () => {
  const g = new GestureClassifier();
  g.down(1, 100, 100, 0);
  const s = g.down(2, 200, 100, 10);
  assert.deepEqual(types(s), ['pinchstart']);
  // rotate both fingers +30° about their midpoint (150, 100), distance held at 100 px
  const evs = twistPair(g, 150, 100, 50, 0, 30, 30);
  assert.equal(evs.length, 2, 'one pinch event per moved finger');
  for (const e of evs) assert.equal(e.type, 'pinch');
  near(evs[0].dAngle + evs[1].dAngle, 30, 0.6, 'the two samples sum to the +30° twist');
  assert.ok(evs[0].dAngle > 0 && evs[1].dAngle > 0, 'both samples turn the same (clockwise) way');
  near(evs[1].scale, 1, 1e-9, 'once both fingers moved, a pure twist does not zoom');
  // and the other way: −30° back
  const back = twistPair(g, 150, 100, 50, 30, 0, 50);
  near(back[0].dAngle + back[1].dAngle, -30, 0.6);
  // lifting both fingers ends the pinch and never taps
  assert.deepEqual(types(g.up(1, 100, 100, 60)), ['pinchend']);
  assert.deepEqual(g.up(2, 200, 100, 70), []);
  assert.equal(g.state, 'idle');
});

test('twist and pinch compose: one gesture reports both scale and dAngle', () => {
  const g = new GestureClassifier();
  g.down(1, 100, 100, 0);
  g.down(2, 200, 100, 10);
  // spread 100 → 140 px while rotating +20° (both fingers move; the twist is split across the two samples)
  const evs = [];
  evs.push(...g.move(1, 150 - 70 * Math.cos((20 * Math.PI) / 180), 100 - 70 * Math.sin((20 * Math.PI) / 180), 30));
  evs.push(...g.move(2, 150 + 70 * Math.cos((20 * Math.PI) / 180), 100 + 70 * Math.sin((20 * Math.PI) / 180), 30));
  const last = evs.at(-1);
  assert.equal(last.type, 'pinch');
  near(last.scale, 1.4, 0.02, 'spreading zooms in');
  near(evs[0].dAngle + evs[1].dAngle, 20, 0.6, 'and the twist turns with it');
});

test('a tap is never fired on touch-down; a second finger cancels the pending tap', () => {
  const g = new GestureClassifier();
  assert.deepEqual(g.down(1, 100, 100, 0), [], 'touch-down fires nothing');
  // the first finger is still inside the tap window when the second lands: still no tap
  assert.deepEqual(types(g.down(2, 200, 100, 10)), ['pinchstart']);
  assert.deepEqual(types(g.up(1, 100, 100, 50)), ['pinchend']);
  assert.deepEqual(g.up(2, 200, 100, 60), [], 'the second lift is not a tap either');
  // a quick single tap still fires (deferred to touch-up)
  const h = new GestureClassifier();
  assert.deepEqual(h.down(1, 100, 100, 0), []);
  assert.deepEqual(types(h.up(1, 100, 100, 120)), ['tap']);
});
