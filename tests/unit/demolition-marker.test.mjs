/**
 * Demolition markers (design-spec §7.6 M3 `dam_charge`): the dam falls only to a bomb within 3 m of (40,22), the
 * spillway gates in the middle of its crest (the foot of the face, where the charge went before, is out of bounds).
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';

function m03() {
  const ctx = loadGrid(getMission('m03'));
  const { world, def } = ctx;
  world.objectives = createObjectives(def.objectives);
  const dam = ctx.handle.interactables.find((i) => i.tag === 'dam');
  return { ...ctx, dam };
}
const o2Done = (world) => world.objectives.find((o) => o.id === 'o2').done === true;

test('m03: the dam explosiveTarget is bound to the dam_charge marker', () => {
  const { dam, world } = m03();
  assert.ok(dam && dam.interactKind === 'explosiveTarget');
  assert.equal(dam.marker, 'dam_charge');
  const mk = world.markers.get('dam_charge');
  assert.deepEqual([mk.x, mk.z, mk.r], [40, 22, 3]);
});

test('m03: a bomb 5 m from dam_charge leaves the dam standing and o2 open', () => {
  const { world, dam } = m03();
  applyExplosion(world, 40 + 4.83, 22 - 1.29, 'bomb', null); // 5 m from the marker, along the crest towards its E end
  checkObjectives(world);
  assert.equal(dam.destroyed, false);
  assert.equal(o2Done(world), false);
});

test('m03: a bomb on the W abutment (the s9 exploit; the W end of the crest, 12.6 m from the marker) no longer blows the dam', () => {
  const { world, dam } = m03();
  applyExplosion(world, 29.2, 29.3, 'bomb', null);
  checkObjectives(world);
  assert.equal(dam.destroyed, false);
  assert.equal(o2Done(world), false);
});

test('m03: the old charge spot on the toe ledge (35.82,29.59) no longer blows the dam', () => {
  const { world, dam } = m03();
  applyExplosion(world, 35.82, 29.59, 'bomb', null);
  checkObjectives(world);
  assert.equal(dam.destroyed, false);
  assert.equal(o2Done(world), false);
});

test('m03: a bomb 2 m from dam_charge (on the crest by the spillway gates) demolishes the dam and completes o2', () => {
  const { world, dam } = m03();
  applyExplosion(world, 41.93, 21.48, 'bomb', null);
  checkObjectives(world);
  assert.equal(dam.destroyed, true);
  assert.equal(o2Done(world), true);
});

test('m03: grenades and shells at the marker still cannot touch the bombOnly dam', () => {
  for (const cls of ['grenade', 'shell', 'barrel']) {
    const { world, dam } = m03();
    applyExplosion(world, 40, 22, cls, null);
    assert.equal(dam.destroyed, false, cls);
  }
});
