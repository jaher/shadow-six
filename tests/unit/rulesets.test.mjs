import { test, assert } from './lib.mjs';
import { CONFIG, rulesFor } from '../../src/config.js';
import { World } from '../../src/world/world.js';
import { registerAbility, abilitiesForRole, ABILITIES } from '../../src/abilities/registry.js';
import { MISSIONS, CAMPAIGNS, campaignOf } from '../../src/missions/index.js';
import { ITEMS, spawnInventory, itemInCampaign } from '../../src/items.js';

test('rulesets: BEL flags off, BCD flags on, world.rules follows mission campaign', () => {
  const flags = ['knockouts', 'handcuffs', 'stones', 'spyChloroform', 'spyUniformFromCaptives', 'driverClub', 'driverRifle', 'sergeantsSeeThroughDisguise'];
  for (const f of flags) { assert.equal(CONFIG.rulesets.BEL[f], false, f); assert.equal(CONFIG.rulesets.BCD[f], true, f); }
  assert.equal(rulesFor(undefined), CONFIG.rulesets.BEL);
  assert.equal(new World({ size: [10, 10] }).rules, CONFIG.rulesets.BEL);
  const w = new World({ size: [10, 10], mission: { campaign: 'BCD' } });
  assert.equal(w.campaign, 'BCD');
  assert.equal(w.rules.knockouts, true);
  assert.equal(w.serialize().campaign, 'BCD');
});

test('missions declare a campaign; CAMPAIGNS lists exist', () => {
  for (const m of MISSIONS) assert.ok(m.campaign === 'BEL' || m.campaign === 'BCD', m.id);
  assert.ok(Array.isArray(CAMPAIGNS.BEL) && Array.isArray(CAMPAIGNS.BCD));
  assert.equal(campaignOf({}), 'BEL');
});

test('abilities and items are campaign-scoped', () => {
  registerAbility({ id: '__bcdPunch', roles: ['greenberet'], campaigns: ['BCD'], order: 1 });
  try {
    assert.ok(!abilitiesForRole('greenberet').includes('__bcdPunch'));
    assert.ok(!abilitiesForRole('greenberet', 'BEL').includes('__bcdPunch'));
    assert.ok(abilitiesForRole('greenberet', 'BCD').includes('__bcdPunch'));
    assert.ok(abilitiesForRole('greenberet', CONFIG.rulesets.BCD).includes('__bcdPunch'));
  } finally { delete ABILITIES.__bcdPunch; }
  ITEMS.__stones = { label: 'Stones', campaigns: ['BCD'] };
  try {
    assert.ok(!itemInCampaign('__stones', 'BEL'));
    assert.ok(!('__stones' in spawnInventory('greenberet', { __stones: 3 }, 'BEL')));
    assert.equal(spawnInventory('greenberet', { __stones: 3 }, 'BCD').__stones, 3);
  } finally { delete ITEMS.__stones; }
});
