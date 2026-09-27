import { test, assert, near } from './lib.mjs';
import { EventBus } from '../../src/core/events.js';
import { clamp, lerp, dist, dist2, angleTo, wrapAngle, angleDiff, headingToRotY, rotYToHeading, turnTowardsAngle, pointInPolygon, Rng } from '../../src/core/math.js';

test('events: on/emit/off/once', () => {
  const bus = new EventBus();
  const got = [];
  const off = bus.on('a', (p) => got.push(['a', p]));
  bus.once('a', (p) => got.push(['once', p]));
  bus.emit('a', 1);
  bus.emit('a', 2);
  off();
  bus.emit('a', 3);
  assert.deepEqual(got, [['a', 1], ['once', 1], ['a', 2]]);
  assert.equal(bus.listenerCount('a'), 0);
});

test('events: handler exceptions do not stop delivery', () => {
  const bus = new EventBus();
  let second = false;
  const orig = console.error;
  console.error = () => {};
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', () => { second = true; });
  bus.emit('x');
  console.error = orig;
  assert.ok(second);
});

test('events: off() of a once() handler before it fires', () => {
  const bus = new EventBus();
  let n = 0;
  const fn = () => n++;
  bus.once('y', fn);
  bus.off('y', fn);
  bus.emit('y');
  assert.equal(n, 0);
});

test('events: wildcard receives type', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('*', (p, t) => seen.push(t));
  bus.emit('unit:killed', {});
  assert.deepEqual(seen, ['unit:killed']);
});

test('math: clamp/lerp/dist', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(lerp(2, 4, 0.5), 3);
  near(dist(0, 0, 3, 4), 5);
  assert.equal(dist2(0, 0, 3, 4), 25);
});

test('math: headings (0 = east, π/2 = south)', () => {
  near(angleTo(0, 0, 1, 0), 0);
  near(angleTo(0, 0, 0, 1), Math.PI / 2);
  near(wrapAngle(3 * Math.PI), Math.PI);
  near(wrapAngle(-Math.PI), Math.PI);
  near(angleDiff(Math.PI - 0.1, -Math.PI + 0.1), 0.2, 1e-9);
  // Model authored facing +Z: heading π/2 (south) → rotation.y 0.
  near(headingToRotY(Math.PI / 2), 0);
  near(rotYToHeading(headingToRotY(0.7)), 0.7);
  near(turnTowardsAngle(0, 1, 0.25), 0.25);
  near(turnTowardsAngle(0, 0.1, 0.25), 0.1);
});

test('math: pointInPolygon', () => {
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2]];
  assert.ok(pointInPolygon(1, 1, sq));
  assert.ok(!pointInPolygon(3, 1, sq));
});

test('math: Rng is deterministic and in range', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let k = 0; k < 100; k++) {
    const v = a.next();
    assert.equal(v, b.next());
    assert.ok(v >= 0 && v < 1);
  }
  const r = new Rng(7);
  for (let k = 0; k < 200; k++) {
    const n = r.int(2, 4);
    assert.ok(n >= 2 && n <= 4 && Number.isInteger(n));
  }
  assert.equal(r.pick(['only']), 'only');
});
