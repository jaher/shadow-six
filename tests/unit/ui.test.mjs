import { test, assert } from './lib.mjs';
import { kitIntersection, knapsackView, abilityForItem, COUNT_DISPLAY } from '../../src/ui/knapsack-model.js';
import { computeUiScale, loadOptions, saveOptions, OPTION_DEFAULTS, OPTIONS_KEY } from '../../src/ui/ui-config.js';
import { BEL_CATALOGUE, catalogueEntry, CAMPAIGN_TABS } from '../../src/ui/catalogue.js';

const unit = (role, inv, extra = {}) => ({ role, alive: true, state: 'active', x: 5, z: 5, inventory: new Map(Object.entries(inv)), abilities: extra.abilities || [], ...extra });

test('ui: knapsack group intersection keeps only shared items, min counts', () => {
  const gb = unit('greenberet', { knife: 1, pistol: 1, decoy: 1, grenade: 3 });
  const sa = unit('sapper', { pistol: 1, grenade: 2, timeBomb: 2 });
  const sn = unit('sniper', { pistol: 1, sniperRifle: 5 });
  assert.deepEqual(kitIntersection([gb, sa]).map((i) => [i.id, i.count]), [['pistol', 1], ['grenade', 2]]);
  assert.deepEqual(kitIntersection([gb, sa, sn]).map((i) => i.id), ['pistol']);
  assert.deepEqual(kitIntersection([sn]).map((i) => i.id), ['pistol', 'sniperRifle'], 'draw order: pistol before rifle');
  assert.deepEqual(kitIntersection([]), []);
});

test('ui: knapsack view modes, counts display and disabled reasons', () => {
  const world = { campaign: 'BEL', groundAt: () => ({ terrain: 'grass', water: false, shallow: false }) };
  assert.equal(knapsackView([], world).mode, 'empty');
  const ma = unit('diver', { knife: 1, pistol: 1, inflatableBoat: 1, divingGear: 1 });
  const v = knapsackView([ma], world);
  assert.equal(v.mode, 'items');
  const boat = v.items.find((i) => i.id === 'inflatableBoat');
  assert.equal(boat.disabled, true);
  assert.equal(boat.reason, 'Only in shallow water');
  const wet = knapsackView([ma], { ...world, groundAt: () => ({ terrain: 'shallow', shallow: true }) });
  assert.equal(wet.items.find((i) => i.id === 'inflatableBoat').disabled, false);
  const sn = unit('sniper', { pistol: 1, sniperRifle: 4 });
  assert.equal(knapsackView([sn], world).items.find((i) => i.id === 'sniperRifle').display, 'cartridges');
  assert.equal(COUNT_DISPLAY.smg, 'number');
  assert.equal(COUNT_DISPLAY.firstAid, 'ticks');
  const inCar = unit('driver', { pistol: 1 }, { state: 'inVehicle' });
  assert.equal(knapsackView([inCar], world).mode, 'occupant');
  const empty = unit('sniper', { pistol: 1, sniperRifle: 0 });
  assert.ok(!knapsackView([empty], world).items.some((i) => i.id === 'sniperRifle'), 'zero stacks are not drawn');
});

test('ui: knapsack swaps remote bomb for detonator, knife arms the knife ability', () => {
  const sa = unit('sapper', { pistol: 1, remoteBomb: 1 }, { bombsPlaced: [{}] });
  const v = knapsackView([sa], { campaign: 'BEL' });
  const d = v.items.find((i) => i.item === 'remoteBomb');
  assert.equal(d.id, 'detonator');
  assert.equal(d.swapped, true);
  assert.equal(abilityForItem('knife')?.id, 'knife');
});

test('ui: uiScale follows §6 (1080p → 2.0) with override', () => {
  assert.equal(computeUiScale(1080), 2);
  assert.equal(computeUiScale(480), 1);
  assert.equal(computeUiScale(300), 1);
  assert.equal(computeUiScale(800), 1.5);
  assert.equal(computeUiScale(4000), 3);
  assert.equal(computeUiScale(1080, 1.25), 1.25);
});

test('ui: options load defaults, persist and ignore bad types', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadOptions(storage), OPTION_DEFAULTS);
  saveOptions({ ...OPTION_DEFAULTS, voice: 'laconic', warnings: 'nope' }, storage);
  const o = loadOptions(storage);
  assert.equal(o.voice, 'laconic');
  assert.equal(o.warnings, true, 'wrong type falls back to default');
  store.set(OPTIONS_KEY, '{broken');
  assert.deepEqual(loadOptions(storage), OPTION_DEFAULTS);
  assert.equal(OPTION_DEFAULTS.halt, 'indifferent');
  assert.equal(OPTION_DEFAULTS.voice, 'verbose');
});

test('ui: BEL catalogue has the 20 missions, BCD tab locked', () => {
  assert.equal(BEL_CATALOGUE.length, 20);
  assert.equal(BEL_CATALOGUE[0].title, 'Baptism of Fire');
  assert.equal(BEL_CATALOGUE[0].date, 'Feb 20, 1941');
  assert.equal(catalogueEntry('m20').title, 'Operation Valhalla');
  assert.equal(catalogueEntry({ id: 'x', title: 'Blind Justice' }).n, 5);
  assert.equal(CAMPAIGN_TABS.find((t) => t.id === 'BCD').locked, true);
});
