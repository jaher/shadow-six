import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { CONFIG } from '../../src/config.js';

// World.emitNoise builds its event with noiseEvent (one shape per site, taken before play: world.js). The event is the
// one the old literal `{ ...(extra || {}), x, z, radius, kind, level, source }` gave: the same fields, in the same
// order, the same values — an explicit x / z / … over an `extra` field of that name.
const scene = () => ({ add() {}, remove() {} });
const old = (extra, x, z, radius, kind, level, source) => ({ ...(extra || {}), x, z, radius, kind, level, source });

test('noise event: the same fields, order and values as the old literal, with and without extra', () => {
  const w = new World({ size: [40, 40], scene: scene() });
  const got = [];
  w.events.on('noise', (n) => got.push(n));
  const src = { id: 7, faction: 'allied' };
  const cases = [
    [3.25, 4.5, 22.5, 'rifle', src, undefined, null],
    [10, 12, 18, 'pistol', null, 2, null],
    [1.5, 2.5, 30, 'explosion', { id: 9 }, undefined, undefined],
    [5, 6, 8, 'footsteps', src, 1, { surface: 'gravel', y: 0.4 }],
    [7.5, 8.5, 14, 'alarmShout', src, undefined, { about: { x: 1, z: 2 }, x: 99, level: 9 }],
  ];
  for (const [x, z, r, kind, s, level, extra] of cases) w.emitNoise(x, z, r, kind, s ?? undefined, level, extra ?? undefined);
  assert.equal(got.length, cases.length);
  cases.forEach(([x, z, r, kind, s, level, extra], i) => {
    const lv = level ?? CONFIG.stealth.noise[kind]?.level ?? (kind === 'explosion' ? 3 : kind === 'shot' ? 2 : 1);
    const want = old(extra, x, z, r, kind, lv, s ?? null);
    assert.deepEqual(Object.keys(got[i]), Object.keys(want), `case ${i}: field order`);
    assert.deepEqual(got[i], want, `case ${i}: values`);
    assert.equal(got[i].source, s ?? null, `case ${i}: the source itself (not a copy)`);
  });
  assert.equal(got[4].x, 7.5, 'an explicit x over extra.x');
  assert.equal(got[4].level, CONFIG.stealth.noise.alarmShout?.level ?? 1, 'the level over extra.level');
});
