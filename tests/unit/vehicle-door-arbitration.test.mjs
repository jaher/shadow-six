/**
 * Door arbitration (user spec 2026-10-20: "the door gets closed at the end when everybody is in"): two men
 * boarding through ONE cab door (a bench-cab lorry: the first man takes the nearer door, the second is
 * promised the same one) — the first man seated must NOT pull the door shut while the second is still coming
 * through it or still walking to it; the door is held open and the LAST man in performs the single close.
 * Frame-stepped here over the pure pieces the crew figure composes (art/vehicle-crew.js doorHeldOpen +
 * art/door-hand.js closeKey, the timeline handStep runs); the live composition is probed on the real M3
 * solution (door fraction per frame) in the fix's acceptance run.
 * Rear doors (the Sd.Kfz. 251's pair): 'last' is re-evaluated when the close would start (rearIsLast).
 */
import { test, assert } from './lib.mjs';
import { doorHeldOpen, rearIsLast, BAY_STOOP } from '../../src/art/vehicle-crew.js';
import { closeKey } from '../../src/art/door-hand.js';

const NODE = 'door_r';

test('door arbitration: held open by a promise, by a man coming through, or by the man closing it himself', () => {
  assert.equal(doorHeldOpen(NODE, [], []), false, 'nobody else: free to close');
  assert.equal(doorHeldOpen(NODE, [], [NODE]), true, 'a man still walking to the vehicle is promised this door');
  assert.equal(doorHeldOpen(NODE, [], ['door_l']), false, 'promised the OTHER door: free');
  assert.equal(doorHeldOpen(NODE, [{ node: NODE, boarding: true, closing: false }], []), true, 'another figure is mid-climb through it');
  assert.equal(doorHeldOpen(NODE, [{ node: NODE, boarding: false, closing: true }], []), true, 'another figure is already pulling it shut');
  assert.equal(doorHeldOpen(NODE, [{ node: NODE, boarding: false, closing: false }], []), false, 'another figure seated, hands off: free');
  assert.equal(doorHeldOpen(NODE, [{ node: 'door_l', boarding: true, closing: false }], []), false, 'boarding through the other door: free');
  assert.equal(doorHeldOpen(null, [{ node: NODE, boarding: true, closing: false }], [NODE]), false, 'no door: nothing to arbitrate');
});

test('door arbitration, frame-stepped: two men, one door — fraction stays open until the last sit, then exactly one close', () => {
  const dt = 1 / 60, f0 = 0.52; // the door as far as a seated man can reach (the truck's rig frac)
  // man A sits at t = 0 and his hand goes to the door; man B is promised it (walking) until 0.7 s, then is
  // mid-climb through it (his figure boards) until his own sit at 2.15 s; from then on A is the last man in
  const others = (t) => t < 0.7 ? [] : [{ node: NODE, boarding: t < 2.15, closing: false }];
  const promised = (t) => (t < 0.7 ? [NODE] : []);
  let closeT = null, frac = f0, closes = 0, minBeforeLastSit = Infinity, prev = frac, handOn = true;
  for (let t = 0; t <= 6; t += dt) {
    if (handOn && doorHeldOpen(NODE, others(t), promised(t))) {
      closeT = null; frac = f0; // handStep frozen: t reset, key at open, the door held where it stands
    } else if (handOn) {
      closeT = (closeT ?? 0) + dt;
      const key = closeKey(closeT);
      frac = key.door * f0;
      if (key.done) { closes++; handOn = false; } // the hand lets go: the close has run, once
    }
    if (t < 2.15) minBeforeLastSit = Math.min(minBeforeLastSit, frac);
    assert.ok(frac <= prev + 1e-9, `the door never re-opens once the close runs (t ${t.toFixed(2)})`);
    if (t >= 2.15) prev = frac;
  }
  assert.equal(minBeforeLastSit, f0, 'fraction never dipped while the second man was promised / climbing');
  assert.equal(closes, 1, 'exactly one close, performed after the last sit');
  assert.equal(frac, 0, 'and it ends shut');
});

test('rear doors: the last-man verdict is re-evaluated — another man rear-boarding or promised a rear seat defers the close', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  assert.equal(rearIsLast(a, [], []), true, 'alone: he shuts them');
  assert.equal(rearIsLast(a, [a], [a]), true, 'his own entries do not count against him');
  assert.equal(rearIsLast(a, [a, b], []), false, 'another figure is rear-boarding: not last');
  assert.equal(rearIsLast(a, [], [b]), false, 'a man still walking is promised a rear seat: not last');
  assert.equal(rearIsLast(a, [b], [b]), false, 'both: not last');
});

test('bay stoop: the full-body set keeps torso and hips under the rolled flap (crown set included)', () => {
  const bones = new Map(BAY_STOOP.map(([n, r]) => [n, r]));
  for (const n of ['Head', 'neck_01', 'spine_03', 'upperarm_l', 'upperarm_r']) assert.ok(bones.has(n), `crown point ${n} kept`);
  for (const n of ['pelvis', 'spine_01', 'thigh_l', 'thigh_r']) assert.ok(bones.has(n) && bones.get(n) > 0, `body point ${n} with a radius`);
});
