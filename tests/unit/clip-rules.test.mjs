import { test, assert } from './lib.mjs';
import { categoryOf, classify, isJoint, overlapKey, diffBaseline, naturalPair, explicitAllow, runEnds } from '../../src/debug/clip-rules.js';

test('clip-rules: categories are data-driven with overrides and size fallback', () => {
  assert.equal(categoryOf('watchtower'), 'tower');
  assert.equal(categoryOf('fence'), 'fence');
  assert.equal(categoryOf('road'), 'ground');
  assert.equal(categoryOf('pine'), 'tree');
  assert.equal(categoryOf('rail_bridge'), 'bridge');
  assert.equal(categoryOf('mystery_kiosk', { w: 2, d: 2 }), 'prop');
  assert.equal(categoryOf('mystery_hall', { w: 10, d: 8 }), 'building');
  assert.equal(categoryOf('fence', { clipCategory: 'wire' }), 'wire');
});

test('clip-rules: natural pairs, explicit joins and joints are allowed', () => {
  assert.ok(naturalPair('rocks', 'cliff') && naturalPair('cliff', 'rocks'));
  assert.ok(!naturalPair('tower', 'fence'));
  const fence = { id: 'f1', cat: 'fence', type: 'fence', def: { points: [[0, 0], [10, 0]], clipAllow: ['gate1'] } };
  const gate = { id: 'gate1', cat: 'gate', type: 'gate', def: {} };
  const tower = { id: 't1', cat: 'tower', type: 'watchtower', def: {} };
  assert.ok(explicitAllow(fence, gate) && explicitAllow(gate, fence));
  assert.ok(!explicitAllow(fence, tower));
  assert.deepEqual(runEnds(fence.def), [[0, 0], [10, 0]]);
  const box = (x0, x1) => ({ min: [x0, 0, -0.3], max: [x1, 2, 0.3] });
  assert.ok(isJoint(fence, tower, { x: 9.6, z: 0 }, 1.25, box(9, 10.5)), 'fence end against a tower = joint');
  assert.ok(!isJoint(fence, tower, { x: 5, z: 0 }, 1.25, box(4, 6)), 'tower standing in the middle of the run');
  assert.ok(!isJoint(fence, tower, { x: 9.6, z: 0 }, 1.25, box(2, 10)), 'long contact through the run is no joint');
  const m = (depth, contact, x = 5) => ({ point: { x, y: 1, z: 0 }, box: box(x - 0.5, x + 0.5), depth, contact });
  assert.equal(classify(fence, tower, m(0.4, 3)).allowed, false, 'turret/tower through a fence is reported');
  assert.equal(classify(fence, tower, m(0.4, 3, 9.8)).reason, 'joint');
  assert.equal(classify(fence, tower, m(0.01, 0.2)).reason, 'resting contact');
});

test('clip-rules: baseline keys are order-free and diff finds new / fixed overlaps', () => {
  const a = { id: 'b' }, b = { id: 'a' };
  assert.equal(overlapKey('m01', a, b), 'm01:a|b');
  assert.equal(overlapKey('m01', b, a), 'm01:a|b');
  const f = [{ key: 'm01:a|b', allowed: false }, { key: 'm01:c|d', allowed: false }, { key: 'm01:x|y', allowed: true }];
  const d = diffBaseline(f, { keys: ['m01:a|b', 'm01:gone|z', 'm02:q|r'] }, 'm01');
  assert.deepEqual(d.fresh.map((x) => x.key), ['m01:c|d']);
  assert.deepEqual(d.accepted.map((x) => x.key), ['m01:a|b']);
  assert.deepEqual(d.gone, ['m01:gone|z']);
});
