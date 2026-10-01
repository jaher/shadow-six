/**
 * BEL REGRESSION LOCK (docs/bcd-plan.md §0 hard rule, step N1): none of the Beyond the Call of Duty gadgets is
 * reachable under the BEL ruleset. Pins the BEL hotkey map, the ability ids per role, the loadouts and every
 * BEL ruleset flag; proves X is still the knife and Y / V / J-cuffs / R-puppet / T-hanger do nothing BCD.
 */
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import { ABILITIES, abilitiesForRole, allAbilities } from '../../src/abilities/index.js';
import { hotkeyFor, abilitiesForKey, roleKeyMap } from '../../src/engine/hotkeys.js';
import { spawnInventory, ITEMS, BCD_ITEMS } from '../../src/items.js';
import { World } from '../../src/world/world.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { canSee } from '../../src/ai/perception.js';
import { stoneLanded } from '../../src/ai/bcd-reactions.js';

const BEL = CONFIG.rulesets.BEL;
const BEL_KEYS = { knife: 'x', pistol: 'g', sniper: 'r', smg: 'm', harpoon: 'j', syringe: 'l', uniform: 'u', distract: 'd', hand: 'h',
  firstAid: 'k', decoyDrop: 'q', decoyToggle: 'i', shovel: 'f', trap: 'j', timeBomb: 'b', remoteBomb: 'b', detonate: 'a', grenade: 'e',
  cutters: 'w', dive: 'd', raft: 't' };
const BEL_ROLES = {
  greenberet: ['knife', 'pistol', 'decoyDrop', 'decoyToggle', 'shovel', 'climb', 'hand', 'enterVehicle', 'drop', 'leaveVehicle', 'vehicleFire', 'use'],
  sniper: ['sniper', 'pistol', 'firstAid', 'hand', 'enterVehicle', 'leaveVehicle', 'vehicleFire', 'use'],
  diver: ['knife', 'harpoon', 'pistol', 'dive', 'raft', 'hand', 'enterVehicle', 'leaveVehicle', 'vehicleFire', 'use'],
  sapper: ['pistol', 'trap', 'timeBomb', 'remoteBomb', 'detonate', 'grenade', 'cutters', 'hand', 'enterVehicle', 'leaveVehicle', 'vehicleFire', 'use'],
  driver: ['smg', 'pistol', 'firstAid', 'hand', 'enterVehicle', 'leaveVehicle', 'vehicleFire', 'use'],
  spy: ['syringe', 'uniform', 'distract', 'pistol', 'firstAid', 'hand', 'enterVehicle', 'drop', 'leaveVehicle', 'vehicleFire', 'use'],
};
const BEL_KIT = {
  greenberet: { knife: 1, pistol: 1, decoy: 1, shovel: 1 }, sniper: { sniperRifle: 5, pistol: 1 },
  diver: { knife: 1, harpoon: 1, pistol: 1, divingGear: 1, inflatableBoat: 1 }, sapper: { pistol: 1, bearTrap: 1, timeBomb: 2 },
  driver: { pistol: 1 }, spy: { pistol: 1, lethalInjection: 1 },
};
const BCD_IDS = ['knockoutFist', 'knockoutClub', 'knockoutChloroform', 'handcuff', 'hanger', 'stone', 'cigarettes', 'puppet', 'rifle', 'beretta', 'lipstick', 'handGuest'];

test('BEL lock: every BEL ruleset flag is off, no hotkey map, career unchanged', () => {
  for (const [k, v] of Object.entries(BEL)) if (typeof v === 'boolean') assert.equal(v, false, k);
  assert.equal(BEL.hotkeys, null);
  assert.equal(BEL.careerStartGold, 0);
  assert.equal(BEL.enemyAccuracyMul, 1);
  assert.equal(BEL.enemyHearingMul, 1);
});

test('BEL lock: the BEL hotkey map, per-role ability ids and loadouts are pinned', () => {
  const keys = Object.fromEntries(Object.values(ABILITIES).filter((d) => d.hotkey).map((d) => [d.id, d.hotkey]));
  assert.deepEqual(keys, BEL_KEYS);
  for (const [r, ids] of Object.entries(BEL_ROLES)) {
    assert.deepEqual(abilitiesForRole(r, 'BEL'), ids, r);
    assert.deepEqual(abilitiesForRole(r), ids, `${r} (default campaign)`);
    assert.deepEqual(spawnInventory(r, undefined, 'BEL'), BEL_KIT[r], `${r} kit`);
    assert.deepEqual(spawnInventory(r, { stones: 50, cigarettes: 2, handcuffs: 1, leeEnfield: 50 }, 'BEL'), { ...spawnInventory(r, {}, 'BEL') }, `${r}: BCD items never spawn under BEL`);
  }
  for (const id of Object.keys(BCD_ITEMS)) assert.ok(!(id in ITEMS), `${id} stays out of the BEL item table`);
  for (const id of BCD_IDS) assert.ok(!Object.keys(ABILITIES).includes(id), `${id} is not enumerable under BEL`);
});

test('BEL lock: X is still the knife; Y, V, T, J-cuffs, R-puppet, E-rifle arm nothing from BCD', () => {
  const ids = (code) => abilitiesForKey(code, BEL).map((d) => d.id);
  assert.deepEqual(ids('KeyX'), ['knife']);
  assert.deepEqual(ids('KeyY'), []);
  assert.deepEqual(ids('KeyV'), []);
  assert.deepEqual(ids('KeyT'), ['raft']);
  assert.deepEqual(ids('KeyJ'), ['harpoon', 'trap']);
  assert.deepEqual(ids('KeyR'), ['sniper']);
  assert.deepEqual(ids('KeyE'), ['grenade']);
  assert.deepEqual(ids('KeyQ'), ['decoyDrop']);
  for (const id of BCD_IDS) assert.equal(hotkeyFor(id, BEL), null, id);
  assert.deepEqual(roleKeyMap('greenberet', BEL), { knife: 'X', pistol: 'G', decoyDrop: 'Q', decoyToggle: 'I', shovel: 'F', hand: 'H' });
});

test('BEL lock: BEL commandos have no BCD ability and useAbility refuses them; BEL rules ignore stones and ranks', () => {
  const w = new World({ size: [40, 40] });
  assert.equal(w.rules, BEL);
  const all = allAbilities().map((d) => d.id);
  for (const id of BCD_IDS) assert.ok(all.includes(id), `${id} registered (BCD)`);
  for (const role of Object.keys(BEL_ROLES)) {
    const c = new Commando({ role, x: 10, z: 10, campaign: 'BEL' });
    w.add(c);
    for (const id of BCD_IDS) assert.ok(!c.abilities.includes(id), `${role} ${id}`);
    for (const id of BCD_IDS) assert.equal(c.useAbility(id, { x: 12, z: 10 }), false, `${role} ${id} refused`);
  }
  const e = w.add(new Enemy({ soldierType: 'sergeant', x: 20, z: 20, heading: Math.PI })) || w.enemies.at(-1);
  const spy = w.commandos.find((c) => c.role === 'spy');
  spy.x = 15; spy.z = 20; spy.setDisguise(true);
  assert.equal(canSee(e, spy, w), 'none', 'BEL: a sergeant never sees through the uniform');
  assert.equal(e.incapacitated, false);
  assert.equal(e.brain.bcd, false);
  assert.equal(e.serialize().bcd, undefined, 'BEL saves carry no BCD block');
  assert.deepEqual(stoneLanded(w, 20, 20), [], 'even a direct call: no stone reactions under BEL');
  assert.equal(e.brain.state, 'IDLE');
});

test('BEL lock (bodies-design §0.3): under the classic1998 house rules every role keeps exactly the pinned BEL list', async () => {
  const { resolveHouseRules } = await import('../../src/core/house-rules.js');
  const classic = resolveHouseRules({ preset: 'classic1998' });
  for (const [r, ids] of Object.entries(BEL_ROLES)) assert.deepEqual(abilitiesForRole(r, 'BEL', classic), ids, r);
  const six = resolveHouseRules({ preset: 'shadowSix' });
  for (const id of ['drag', 'carryToggle']) assert.ok(!Object.keys(ABILITIES).includes(id), `${id} is not enumerable`);
  assert.ok(abilitiesForRole('sniper', 'BEL', six).includes('drag'), 'shadowSix adds drag');
});
