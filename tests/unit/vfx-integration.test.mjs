/** VFX integration (docs/vfx-pipeline.md §6.2): game events → library kinds, headless (no WebGL: mapped + logged). */
import assert from 'node:assert/strict';
import { test } from './lib.mjs';
import { FX } from '../../src/render/fx.js';
import { RECIPES } from '../../src/render/vfx/effects.js';
import { VFX_QUALITY } from '../../src/render/vfx/index.js';

function mini(options = { blood: true, censored: false }) {
  const subs = new Map();
  const world = {
    mission: { theater: 'snow' }, game: { options },
    listen(ev, fn) { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(fn); return () => subs.set(ev, subs.get(ev).filter((f) => f !== fn)); },
    emit(ev, e) { for (const f of subs.get(ev) || []) f(e); },
  };
  const fx = new FX(world, null);
  const kinds = (from = 0) => fx.items.slice(from).map((r) => r.kind);
  return { world, fx, kinds, subs };
}

test('vfx: the library ships the 19 effect kinds (+2 wind kinds, step 4w; +2 bodies kinds, 4x/4y; +2 fuel-tank kinds) and per-preset budgets', () => {
  const kinds = Object.keys(RECIPES).filter((k) => !k.startsWith('_'));
  assert.equal(kinds.length, 25, kinds.join(','));
  for (const k of ['snow_puff', 'dust_devil', 'fuel_tank_blast', 'fuel_tank_fire']) assert.ok(kinds.includes(k), k);
  for (const k of ['explosion_large', 'explosion_small', 'grenade', 'barrel_explosion', 'tanker_explosion', 'burning_wreck', 'fuel_pool_fire',
    'fire_small', 'smoke_column', 'chimney_smoke', 'smoke_puff', 'muzzle_flash', 'tracer', 'dust_kick', 'vehicle_dust_trail', 'mud_spray',
    'water_splash', 'blood_puff', 'blood_cloud', 'sparks', 'glass_shards']) assert.ok(kinds.includes(k), k);
  assert.deepEqual(Object.keys(VFX_QUALITY), ['low', 'medium', 'high', 'ultra']);
  assert.ok(VFX_QUALITY.low.haze === false && VFX_QUALITY.high.haze, 'heat haze from medium up');
});

test('vfx: explosion classes map to bombs / shells / grenades / drums (chain look) / structures / fuel tanks', () => {
  const { world, fx, kinds } = mini();
  world.emit('explosion', { x: 10, z: 10, radius: 6.75, kind: 'bomb' });
  world.emit('explosion', { x: 30, z: 10, radius: 4.5, kind: 'shell' });
  world.emit('explosion', { x: 50, z: 10, radius: 6.75, kind: 'grenade' });
  assert.deepEqual(kinds(), ['explosion_large', 'explosion_small', 'grenade']);
  const drumA = { interactKind: 'barrel' }, drumB = { interactKind: 'barrel' };
  world.emit('explosion', { x: 70, z: 10, radius: 6.75, kind: 'barrel', source: drumA });
  fx.update(0.2);
  world.emit('explosion', { x: 73, z: 11, radius: 6.75, kind: 'barrel', source: drumB });
  const drums = fx.items.filter((r) => r.kind === 'barrel_explosion');
  assert.equal(drums.length, 2);
  assert.ok(!drums[0].opts.chainFrom && drums[1].opts.chainFrom, 'the chained drum gets the chainFrom look');
  let n = fx.items.length;
  world.emit('explosion', { x: 90, z: 40, radius: 4, kind: 'structure', source: { structure: { type: 'fueltank', r: 2 } } });
  // fuel-tank structures: fireballs along the shell, then licking tongues from the rupture + pool (docs/fuel-tanks.md)
  assert.deepEqual(kinds(n), ['fuel_tank_blast']);
  n = fx.items.length;
  world.emit('explosion', { x: 90, z: 60, radius: 8, kind: 'structure', source: { structure: { type: 'bunker', w: 5, d: 5, h: 2 } } });
  assert.deepEqual(kinds(n), ['explosion_large', 'burning_wreck']);
  fx.dispose();
});

test('vfx: destroyed vehicles burn (wreck until the game fire goes out, then smoke); hull blasts are not drawn twice', () => {
  const { world, fx, kinds } = mini();
  const truck = { x: 20, z: 20, heading: 0.5, def: { kind: 'land', size: [6, 2.4] } };
  world.emit('vehicle:destroyed', { vehicle: truck });
  world.emit('explosion', { x: 20, z: 20, radius: 9, kind: 'vehicle' });
  assert.deepEqual(kinds(), ['explosion_small', 'burning_wreck']);
  const wreck = fx.items[1].opts;
  assert.deepEqual(wreck.size, [2.4, 6]);
  assert.ok(Math.abs(wreck.yaw - (Math.PI / 2 - 0.5)) < 1e-9, 'wreck footprint follows the hull heading');
  let n = fx.items.length;
  world.emit('fire', { x: 20, z: 20, on: false });
  assert.deepEqual(kinds(n), ['smoke_column'], 'smouldering wreck after the fire');
  n = fx.items.length;
  const tanker = { x: 60, z: 20, heading: 0, def: { kind: 'land', size: [6, 2.4], tanker: true } };
  world.emit('vehicle:destroyed', { vehicle: tanker });
  world.emit('explosion', { x: 60, z: 20, radius: 9, kind: 'vehicle' });
  world.emit('explosion', { x: 60, z: 20, radius: 6.75, kind: 'barrel', source: null });
  assert.deepEqual(kinds(n), ['tanker_explosion'], 'tanker: one tanker explosion (the vehicle + silent barrel blasts are folded in)');
  fx.update(0.5);
  n = fx.items.length;
  world.emit('explosion', { x: 60, z: 20, radius: 9, kind: 'vehicle' });
  assert.deepEqual(kinds(n), ['explosion_small'], 'a later blast at the same spot is drawn again');
  fx.dispose();
});

test('vfx: shots → weapon-sized muzzle flash + impact (blood / sparks / dust); blood respects the options', () => {
  const { world, fx, kinds } = mini();
  const soldier = { kind: 'enemy', x: 20, z: 0 };
  world.emit('shot', { from: { x: 0, z: 0 }, to: { x: 20, z: 0 }, shooter: { kind: 'commando' }, target: soldier, hit: true, weapon: 'rifle' });
  assert.deepEqual(kinds(), ['muzzle_flash', 'blood_puff']);
  assert.equal(fx.items[0].opts.weapon, 'rifle');
  assert.ok(Math.abs(fx.items[0].opts.dir.x - 1) < 0.01, 'flash aligned to the target');
  let n = fx.items.length;
  world.emit('shot', { from: { x: 0, z: 0 }, to: { x: 5, z: 5 }, shooter: { kind: 'vehicle' }, target: { kind: 'vehicle' }, hit: true, weapon: 'tankMg' });
  assert.deepEqual(kinds(n), ['muzzle_flash', 'sparks']);
  assert.equal(fx.items[n].opts.weapon, 'mg');
  n = fx.items.length;
  world.emit('shot', { from: { x: 0, z: 0 }, to: { x: 5, z: 5 }, shooter: {}, target: null, hit: false, weapon: 'luger' });
  assert.deepEqual(kinds(n), ['muzzle_flash', 'dust_kick']);
  assert.equal(fx.items[n].opts.weapon, 'pistol');
  n = fx.items.length;
  world.emit('shot', { from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, target: soldier, hit: true, weapon: 'knife' });
  assert.equal(fx.items.length, n, 'no flash for the knife');
  fx.dispose();
  const c = mini({ blood: true, censored: true });
  c.world.emit('shot', { from: { x: 0, z: 0 }, to: { x: 20, z: 0 }, target: soldier, hit: true, weapon: 'rifle' });
  c.world.emit('unit:killed', { unit: soldier, cause: 'knife' });
  c.world.emit('hit', { x: 20, z: 0, surface: 'flesh', target: soldier, weapon: 'knife' });
  assert.deepEqual(c.kinds(), ['muzzle_flash'], 'censored: no blood at all');
  c.fx.dispose();
});

test('vfx: kills bleed unless bloodless (syringe, explosion) or blood is off; camera shake off headless / reduced motion', () => {
  const { world, fx, kinds } = mini();
  world.emit('unit:killed', { unit: { kind: 'enemy', x: 1, z: 1 }, cause: 'knife' });
  world.emit('unit:killed', { unit: { kind: 'enemy', x: 1, z: 1 }, cause: 'syringe' });
  world.emit('unit:killed', { unit: { kind: 'enemy', x: 1, z: 1 }, cause: 'explosion' });
  assert.deepEqual(kinds(), ['blood_puff']);
  assert.equal(fx.shakeOffset(), null);
  fx.dispose();
  const off = mini({ blood: false });
  off.world.emit('unit:killed', { unit: { kind: 'enemy', x: 1, z: 1 }, cause: 'knife' });
  assert.equal(off.fx.items.length, 0);
  off.fx.dispose();
  assert.equal([...off.subs.values()].flat().length, 0, 'dispose unsubscribes every event');
});
