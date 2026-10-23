/**
 * Video mode reads smooth (user 2026-10-22, M2: "Why there are pauses when enemy steps on a trap in mission02 and why
 * the boat doesnt flow smoothly"), pure parts:
 *  - the replay draws the entities between their last two ticks (TickPacer.alpha): the picture advances by exactly
 *    each frame's grant, whatever the whole ticks per frame (2, 3, 2, 3… at 2.5×);
 *  - AUTO never pays ticks a frame could not run back in a burst (TickPacer.lagFrames: M2's raft, 31 ticks in one
 *    frame), and its speed stays within what a frame can run (PerfCeiling.rateFor);
 *  - a skipped wait is a time-lapse at a speed every ease still caps (paceTarget skip): a guard walking onto a set trap
 *    brings it down smoothly to 1× at the snap, seen from 25 m off when he heads straight for it (trapEta);
 *  - a rowed raft is under way the whole crossing, turning on the spot at a waypoint too (underWay): not a wait;
 *  - the snap of a trap is watched while the guard falls (ActionHolds.watch): 1×, framed, the chapter card after it.
 */
import { test, assert, near } from './lib.mjs';
import { TickPacer } from '../../src/debug/solution-replay.js';
import { AutoPace, PerfCeiling, paceTarget, trapEta, underWay, AUTO_PACE, TRAP_LOOK } from '../../src/debug/auto-pace.js';
import { ActionHolds, FALL_S, HOLD_BEAT } from '../../src/debug/action-hold.js';

/** Frames of the replay loop: grant, the picture's alpha (drawn before the frame's ticks), then the ticks. */
function play(pacer, rate, frames, dt = 1 / 60) {
  pacer.boost = rate;
  const shown = [], ticks = [];
  let T = 0; // ticks run so far
  for (let i = 0; i < frames; i++) {
    pacer.frame(dt, i * 16.7);
    shown.push(T - 1 + pacer.alpha()); // the picture: between tick T-1 and tick T
    let n = 0;
    while (pacer.canTick(i * 16.7)) { pacer.take(i * 16.7); n++; T++; }
    ticks.push(n);
  }
  return { shown, ticks };
}

test('replay interpolation: at 2.5× the ticks per frame alternate but the picture advances 2.5 ticks every frame', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: [0.5, 1, 2, 4] });
  const { shown, ticks } = play(p, 2.5, 120);
  assert.ok(new Set(ticks.slice(10)).size > 1, `whole ticks per frame vary (${ticks.slice(10, 20).join(',')})`);
  for (let i = 11; i < shown.length; i++) near(shown[i] - shown[i - 1], 2.5, 1e-6, `even step at frame ${i}`);
  const q = new TickPacer({ simDt: 1 / 60 });
  const r = play(q, 0.5, 60);
  for (let i = 11; i < r.shown.length; i++) near(r.shown[i] - r.shown[i - 1], 0.5, 1e-6, `½×: half a tick a frame (${i})`);
  q.paused = true;
  const a0 = q.alpha();
  q.frame(1 / 60, 0);
  assert.equal(q.alpha(), 1, 'paused: drawn at the last tick');
  assert.ok(q.budget < 1 && q.budget >= 0 && a0 >= 0, 'paused: no backlog');
});

test('AUTO lets a frame\'s unrun ticks go (lagFrames) — no burst when the cap lifts', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: [1], tickMs: 1 });
  p.lagFrames = 0.5;
  p.boost = 4;
  const per = [];
  let now = 0;
  for (let i = 0; i < 60; i++) {
    p.frame(1 / 60, now);
    let n = 0;
    while (p.canTick(now)) { p.take(now); n++; now += 0.6; } // (0.6 ms a tick against a 1 ms cap: 2 a frame)
    per.push(n);
    now += 16;
  }
  p.tickMs = Infinity; // the cap lifts (a slower frame's slot)
  p.frame(1 / 60, now);
  let burst = 0;
  while (p.canTick(now)) { p.take(now); burst++; }
  assert.ok(Math.max(...per.slice(5)) <= 2, `capped at 2 a frame (${per.slice(0, 10).join(',')})`);
  assert.ok(burst <= 7, `no catch-up burst (${burst} ticks; the plain pacer would run its 32-tick backlog)`);
  const plain = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: [1], tickMs: 1 });
  plain.boost = 4;
  now = 0;
  for (let i = 0; i < 60; i++) { plain.frame(1 / 60, now); while (plain.canTick(now)) { plain.take(now); now += 0.6; } now += 16; }
  plain.tickMs = Infinity;
  plain.frame(1 / 60, now);
  let b2 = 0; while (plain.canTick(now)) { plain.take(now); b2++; }
  assert.ok(b2 >= 30, `(the plain pacer: ${b2})`);
});

test('PerfCeiling.rateFor: the speed whose ticks fit a frame budget', () => {
  const pc = new PerfCeiling();
  assert.equal(pc.rateFor(5), Infinity, 'no tick timed yet');
  for (let i = 0; i < 600; i++) pc.frame(1 / 60, 0.5);
  near(pc.rateFor(5), 10, 0.05, '5 ms / 0.5 ms a tick at 60 fps → 10×');
  near(pc.rateFor(15, 1000 / 30), 15, 0.05, '15 ms at 30 fps → 15×');
});

test('a skipped wait is a time-lapse every ease still caps: a guard walking onto a trap brings it down to 1×', () => {
  const idle = { motion: 'idle', windows: [] };
  assert.equal(paceTarget(idle, { skip: 24 }).rate, 24);
  assert.equal(paceTarget(idle, { skip: 40 }).rate, AUTO_PACE.skipMax);
  assert.equal(paceTarget(idle, { ceiling: 4 }).rate, 4, '(the play: cruise)');
  const at = (eta) => paceTarget({ ...idle, trapEta: eta }, { skip: 24 }).rate;
  assert.ok(at(20) > 19 && at(10) < 11 && at(3) < 3.5 && at(0.6) === 1 && at(0.2) === 1, `${[20, 10, 3, 0.6].map(at).join(' ')}`);
  // the eased speed follows it down: a continuous slow-down, 1× before the snap (sim seconds to go shrink at the speed)
  const ap = new AutoPace(24);
  let eta = 18, wall = 0, last = 24, jump = 0;
  while (eta > 0.05) {
    const r = ap.step(paceTarget({ ...idle, trapEta: eta }, { skip: 24 }).rate, 1 / 60, 24);
    jump = Math.max(jump, Math.abs(Math.log2(r / last))); last = r;
    eta -= r / 60; wall += 1 / 60;
  }
  assert.ok(last < 1.3, `about 1× at the snap (${last.toFixed(2)})`);
  assert.ok(wall < 6, `in a few seconds of wall time (${wall.toFixed(1)} s)`);
  assert.ok(jump < 0.15, `no jump in speed (${jump.toFixed(3)} octaves a frame at most)`);
});

test('trapEta: a guard heading for a set trap from up to 25 m off (passing within 2.5 m), not one passing it wide', () => {
  const trap = { interactKind: 'trap', sprung: false, x: 0, z: 0 };
  const g = (x, z, heading, o = {}) => ({ alive: true, x, z, heading, isMoving: true, speed: 1.2, ...o });
  const w = (e) => ({ interactables: [trap], enemies: [e] });
  near(trapEta(w(g(-20, 0, 0))), 20 / 1.2, 1e-9, 'straight for it from 20 m');
  assert.equal(trapEta(w(g(-20, 6, 0))), Infinity, 'passing 6 m off');
  assert.equal(trapEta(w(g(-(TRAP_LOOK + 1), 0, 0))), Infinity, 'too far');
  near(trapEta(w(g(-6, 3, 0))), Math.hypot(6, 3) / 1.2, 1e-9, 'within 10 m: roughly its way');
  assert.equal(trapEta(w(g(-6, 0, 0, { isMoving: false }))), Infinity, 'standing');
  assert.equal(trapEta(w(g(-6, 0, Math.PI))), Infinity, 'walking away');
  assert.equal(trapEta({ interactables: [{ ...trap, sprung: true }], enemies: [g(-6, 0, 0)] }), Infinity, 'sprung');
  near(trapEta(w(g(-6, 0, 0, { speed: undefined }))), 4, 1e-9, '(no speed: 1.5 m/s)');
  // following footprints near it: wherever he faces (the trail turns onto the trap)
  near(trapEta(w(g(-12, 4, Math.PI / 2, { brain: { state: 'TRACKS' } }))), Math.hypot(12, 4) / 1.2, 1e-9, 'tracking, 12.6 m off');
  assert.equal(trapEta(w(g(-20, 4, Math.PI / 2, { brain: { state: 'TRACKS' } }))), Infinity, 'tracking, but 20 m off and not heading for it');
});

test('a raft rowed across is under way the whole crossing (turning on the spot too), a parked truck is not', () => {
  assert.equal(underWay({ vehicle: { goal: { x: 1, z: 2 }, speed: 0 } }), true);
  assert.equal(underWay({ vehicle: { path: [{ x: 1, z: 2 }] } }), true);
  assert.equal(underWay({ vehicle: { goal: null, path: null, speed: 0 } }), false);
  assert.equal(underWay({ vehicle: { goal: { x: 1, z: 2 }, removed: true } }), false);
  assert.equal(underWay({}), false);
});

test('a trap snapping shut is watched while the guard falls, plus the beat', () => {
  const H = new ActionHolds();
  const e1 = { kind: 'enemy', tag: 'e1', alive: false, currentActionId: null };
  const trap = { interactKind: 'trap' };
  const h = H.watch(e1, 'trap', trap, 105.5, { step: 'A4' });
  assert.ok(h && h.target === trap && h.meta.step === 'A4');
  assert.equal(H.current(105.6), h);
  assert.equal(H.current(105.5 + FALL_S + HOLD_BEAT - 0.01), h, 'while he falls and a beat after');
  assert.equal(H.current(105.5 + FALL_S + HOLD_BEAT + 0.01), null, 'then over');
  assert.equal(H.watch(null, 'trap', trap, 1), null);
});

test('a boat\'s wake follows the hull as drawn: ticks bunched 0/2 a frame (a 60 Hz sim on a faster screen, a replay) do not flicker it', async () => {
  const { WakeTracker } = await import('../../src/art/water.js');
  const RAFT = { kind: 'boat', model: 'raft', size: [2.6, 1.3], raft: true };
  const sink = { d: [], c: [], disturb(...a) { this.d.push(a); }, crest(...a) { this.c.push(a); } };
  const w = new WakeTracker(sink, () => true);
  const pos = { x: 0, z: 0 };
  const b = { kind: 'vehicle', def: RAFT, x: 0, z: 0, alive: true, object3d: { position: pos } };
  w.update([b], 1 / 60);
  const quiet = [];
  for (let f = 1; f <= 240; f++) {
    // the sim ran 0 or 2 ticks this frame (2.5 m/s), the hull drawn in between: steady 2.5 m/s on screen
    if (f % 2 === 0) b.x += 2 * 2.5 / 60;
    pos.x = f * 2.5 / 60;
    const n0 = sink.d.length;
    w.update([b], 1 / 60);
    quiet.push(sink.d.length === n0);
  }
  assert.ok(quiet.slice(30).filter(Boolean).length === 0, `a wash every frame, none read as the boat at rest (${quiet.filter(Boolean).length} quiet frames)`);
  const xs = sink.d.slice(-40).map((d) => d[0]);
  assert.ok(Math.max(...xs) <= pos.x + 1.6, 'emitted at the drawn hull, not a tick ahead of it');
});
