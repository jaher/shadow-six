import { test, assert } from './lib.mjs';
import { ITEMS, DEFAULT_INVENTORY, FIXED_KIT, defaultInventory, spawnInventory, firstAidCarrier, normalizeSapperInventory, isUnlimited } from '../../src/items.js';
import { CONFIG } from '../../src/config.js';

// BEL (1998) weapons per character — docs/research-raw/characters.md §2–3.
const WEAPONS = (inv) => Object.keys(inv).filter((k) => inv[k] > 0 && ITEMS[k].weapon).sort();

test('every commando carries the unlimited pistol', () => {
  for (const r of Object.keys(DEFAULT_INVENTORY)) assert.equal(defaultInventory(r).pistol, 1, r);
  assert.ok(isUnlimited('pistol'));
});

test('weapon kinds per role match BEL', () => {
  assert.deepEqual(WEAPONS(defaultInventory('greenberet')), ['knife', 'pistol']);
  assert.deepEqual(WEAPONS(defaultInventory('sniper')), ['pistol', 'sniperRifle']);
  assert.deepEqual(WEAPONS(defaultInventory('diver')), ['harpoon', 'knife', 'pistol']);
  assert.deepEqual(WEAPONS(defaultInventory('sapper')), ['pistol', 'timeBomb']);
  assert.deepEqual(WEAPONS(defaultInventory('driver')), ['pistol'], 'SMG is mission-specific, not standard');
  assert.deepEqual(WEAPONS(defaultInventory('spy')), ['lethalInjection', 'pistol']);
});

test('knife only for Green Beret and Marine; decoy Green Beret only; no later-game items', () => {
  for (const [r, inv] of Object.entries(DEFAULT_INVENTORY)) {
    assert.equal(!!inv.knife, r === 'greenberet' || r === 'diver', r);
    assert.equal(!!inv.decoy, r === 'greenberet', r);
  }
  for (const banned of ['binoculars', 'stones', 'cigarettes', 'handcuffs', 'mineDetector', 'club', 'molotov']) assert.ok(!ITEMS[banned]);
});

test('sniper rounds limited; sapper never has time and remote bombs together', () => {
  assert.equal(defaultInventory('sniper').sniperRifle, 5);
  assert.ok(!isUnlimited('sniperRifle'));
  const inv = normalizeSapperInventory({ ...defaultInventory('sapper'), remoteBomb: 3 });
  assert.ok(!('timeBomb' in inv), 'timeBomb key removed, not zeroed');
  assert.equal(inv.detonator, 1);
});

test('mission inventory = fixed kit + mission items only (no default-only leaks)', () => {
  // BEL M4: Sapper starts with 3 grenades, the time bomb is found on site
  assert.deepEqual(spawnInventory('sapper', { grenade: 3 }), { pistol: 1, bearTrap: 1, grenade: 3 });
  // BEL M6: 2 remote bombs -> detonator, never time bombs
  const m6 = spawnInventory('sapper', { remoteBomb: 2 });
  assert.ok(!('timeBomb' in m6));
  assert.equal(m6.detonator, 1);
  // M12+: Green Beret has no shovel unless the mission gives one
  assert.ok(!('shovel' in spawnInventory('greenberet', {})));
  assert.equal(spawnInventory('greenberet', { shovel: 1 }).shovel, 1);
  // M7: Marine without knife (count 0 removes a fixed item); sniper rounds per mission
  assert.ok(!('knife' in spawnInventory('diver', { knife: 0 })));
  assert.equal(spawnInventory('sniper', { sniperRifle: 7 }).sniperRifle, 7);
  // no mission inventory -> typical kit
  assert.deepEqual(spawnInventory('sapper'), defaultInventory('sapper'));
  for (const r of Object.keys(FIXED_KIT)) assert.equal(FIXED_KIT[r].pistol, 1, r);
});

test('first-aid kit goes to Driver, then Spy, then Sniper', () => {
  assert.equal(firstAidCarrier(['greenberet', 'sniper', 'driver', 'spy']), 'driver');
  assert.equal(firstAidCarrier(['greenberet', 'spy', 'sniper']), 'spy');
  assert.equal(firstAidCarrier(['sniper', 'sapper']), 'sniper');
  assert.equal(firstAidCarrier(['greenberet', 'diver']), null);
});

test('weapon stats: harpoon shorter than pistol, silent one-shot weapons, time bomb 10 s', () => {
  const W = CONFIG.weapons;
  assert.ok(W.harpoon.range < W.pistol.range);
  for (const k of ['harpoon', 'sniperRifle', 'injection']) { assert.equal(W[k].noise, 0, k); assert.ok(W[k].damage >= CONFIG.units.hp.enemy, k); }
  assert.equal(Math.ceil(CONFIG.units.hp.enemy / W.pistol.damage), 3, 'pistol ~3 hits');
  assert.equal(W.timeBomb.delay, 10);
  assert.equal(W.smgBurst.bursts, 20);
  for (const it of Object.values(ITEMS)) if (it.weapon && it.weapon !== 'knife') assert.ok(W[it.weapon], it.weapon);
});
