/**
 * Item catalogue and default knapsack per role — BEL (1998) loadouts, docs/research-raw/characters.md §2–4.
 * Owned by ABILITIES; weapon kinds/counts audited for accuracy against the original game.
 * A mission's `commandos[].inventory` = its exact extras on top of FIXED_KIT (rifle rounds, sapper bombs, SMG…);
 * without one the spawn gets DEFAULT_INVENTORY (typical kit). See spawnInventory().
 *
 * Weapons per character in BEL (keys = original hotkeys):
 *   Green Beret: knife X, pistol G              (+ decoy Q, shovel F — tools, not weapons)
 *   Sniper:      sniper rifle R (limited rounds per mission, 3–8), pistol G
 *   Marine:      knife X, harpoon gun J (unlimited), pistol G   (+ inflatable boat T, diving gear D)
 *   Sapper:      pistol G, bear trap J (reusable), time bombs OR remote bombs B (never both; remote needs
 *                detonator A), grenades E (mission-specific count), wire cutters W (mission-specific)
 *   Driver:      pistol G, SMG M (NOT standard: only M1, M2, M4 on site, M10; 20 bursts) + vehicle/MG weapons
 *   Spy:         pistol G, lethal injection L (unlimited)   (+ uniform found on site, first aid if no Driver)
 * Pistol: all six, unlimited ammo. No throwing stones/knives, club, binoculars, mine detector (later games).
 * First aid kit (K, 6 doses): one per mission, carried by the first deployed of Driver → Spy → Sniper.
 * @module items
 */

/**
 * Item catalogue: id → { label, key (BEL hotkey), stack (count = consumable uses/ammo),
 * unlimited (never consumed), weapon (CONFIG.weapons key), campaigns? (default all) }.
 */
export const ITEMS = {
  pistol: { label: 'Pistol (S&W 9 mm)', key: 'G', stack: false, unlimited: true, weapon: 'pistol' },
  knife: { label: 'Knife', key: 'X', stack: false, unlimited: true, weapon: 'knife' },
  decoy: { label: 'Decoy', key: 'Q', stack: false },
  shovel: { label: 'Shovel', key: 'F', stack: false, unlimited: true },
  sniperRifle: { label: 'Sniper rifle', key: 'R', stack: true, weapon: 'sniperRifle' }, // count = rounds
  harpoon: { label: 'Harpoon gun', key: 'J', stack: false, unlimited: true, weapon: 'harpoon' },
  inflatableBoat: { label: 'Inflatable boat', key: 'T', stack: false },
  divingGear: { label: 'Diving gear', key: 'D', stack: false, unlimited: true },
  bearTrap: { label: 'Trap', key: 'J', stack: false }, // one trap, picked up and re-set
  timeBomb: { label: 'Time bomb', key: 'B', stack: true, weapon: 'timeBomb' },
  remoteBomb: { label: 'Remote bomb', key: 'B', stack: true, weapon: 'remoteBomb' },
  detonator: { label: 'Detonator', key: 'A', stack: false, unlimited: true },
  decoyActivator: { label: 'Decoy activator', key: 'I', stack: false, unlimited: true }, // replaces the decoy once planted
  grenade: { label: 'Grenade', key: 'E', stack: true, weapon: 'grenade' },
  wireCutters: { label: 'Wire cutters', key: 'W', stack: false, unlimited: true },
  smg: { label: 'Submachine gun', key: 'M', stack: true, weapon: 'smg' }, // count = bursts
  lethalInjection: { label: 'Lethal injection', key: 'L', stack: false, unlimited: true, weapon: 'injection' },
  uniform: { label: 'Uniform', key: 'U', stack: false },
  firstAid: { label: 'First aid kit', key: 'K', stack: true }, // count = doses
};

/**
 * Beyond the Call of Duty items (docs/bcd-plan.md §1.1–§1.8), kept OUT of the BEL `ITEMS` table so BEL item
 * lookups are untouched; `itemDef(id)` reads both. Every entry is `campaigns: ['BCD']` (never spawned under BEL).
 */
export const BCD_ITEMS = {
  stones: { label: 'Stones', key: 'Y', stack: true, hiddenCount: true, campaigns: ['BCD'] }, // hidden count 50
  cigarettes: { label: 'Cigarettes', key: 'V', stack: true, campaigns: ['BCD'] }, // count = packs
  handcuffs: { label: 'Handcuffs', key: 'J', stack: false, unlimited: true, campaigns: ['BCD'] },
  hanger: { label: 'Hanger', key: 'T', stack: false, unlimited: true, campaigns: ['BCD'] },
  leeEnfield: { label: 'Lee-Enfield rifle', key: 'E', stack: true, hiddenCount: true, weapon: 'leeEnfield', campaigns: ['BCD'] },
  lipstick: { label: 'Lipstick', key: 'D', stack: false, unlimited: true, campaigns: ['BCD'] },
  beretta: { label: 'Pistol (Beretta 1935)', key: 'Q', stack: false, unlimited: true, weapon: 'pistol', campaigns: ['BCD'] },
};

/** Item definition from the BEL table or the BCD table (null when unknown). */
export function itemDef(id) {
  return ITEMS[id] ?? BCD_ITEMS[id] ?? null;
}

/**
 * BCD fixed kit per role, merged under the mission inventory when the campaign is BCD (bcd-plan §1.1–§1.8):
 * stones (hidden count 50) for all six and Skopje, handcuffs for GB and Spy, the Spy's hanger, the Driver's
 * Lee-Enfield (hidden count 50), Natasha's Beretta and lipstick. Knock-outs and the puppet need no item.
 */
export const BCD_KIT = {
  greenberet: { stones: 50, handcuffs: 1 },
  sniper: { stones: 50 },
  diver: { stones: 50 },
  sapper: { stones: 50 },
  driver: { stones: 50, leeEnfield: 50 },
  spy: { stones: 50, handcuffs: 1, hanger: 1 },
  natasha: { beretta: 1, lipstick: 1 },
  skopje: { stones: 50 },
};

/**
 * Fixed kit per role: items the character carries in EVERY BEL mission he is deployed in
 * (docs/research-raw/characters.md). A mission's `commandos[].inventory` is added ON TOP of this and
 * nothing else — mission-specific items (sapper bombs/grenades/cutters, GB shovel, SMG, uniform) are
 * never implied. A count of 0 in the mission inventory removes an item (e.g. M7 Marine without knife).
 */
export const FIXED_KIT = {
  greenberet: { knife: 1, pistol: 1, decoy: 1 },
  sniper: { sniperRifle: 5, pistol: 1 }, // rounds overridden per mission (3-8)
  diver: { knife: 1, harpoon: 1, pistol: 1, divingGear: 1 }, // raft: carried in M2 only, otherwise on site (§3.8)
  sapper: { pistol: 1, bearTrap: 1 }, // bear trap in every mission; bombs/grenades/cutters vary
  driver: { pistol: 1 },
  spy: { pistol: 1, lethalInjection: 1 },
};

/**
 * Typical knapsack per role, used only when a spawn gives NO inventory (sandbox/tests):
 * fixed kit + the most common BEL mission extras (GB shovel M1-M11, Sapper 2 time bombs as in M2).
 */
export const DEFAULT_INVENTORY = {
  greenberet: { ...FIXED_KIT.greenberet, shovel: 1 },
  sniper: { ...FIXED_KIT.sniper }, // 5 rounds is the most common start (M2, M6, M9, M11, M16)
  diver: { ...FIXED_KIT.diver, inflatableBoat: 1 },
  sapper: { ...FIXED_KIT.sapper, timeBomb: 2 },
  driver: { ...FIXED_KIT.driver },
  spy: { ...FIXED_KIT.spy },
};

/** Doses in the mission's single first-aid kit (Kildread: 6 in every mission). */
export const FIRST_AID_DOSES = 6;

/** Order in which the first deployed role receives the first-aid kit. */
export const FIRST_AID_ORDER = ['driver', 'spy', 'sniper'];

/**
 * Fresh copy of a role's default inventory.
 * @param {string} role
 * @returns {Record<string, number>}
 */
export function defaultInventory(role) {
  return { ...(DEFAULT_INVENTORY[role] || { pistol: 1 }) };
}

/**
 * Starting inventory for a spawn: typical kit when `missionInv` is absent, otherwise the fixed kit
 * plus exactly the mission's items (count 0 removes a fixed item). Sapper bombs are normalized.
 * @param {string} role
 * @param {Record<string, number>|null|undefined} missionInv
 * @param {string} [campaign='BEL'] items scoped to other campaigns are dropped
 * @returns {Record<string, number>}
 */
export function spawnInventory(role, missionInv, campaign = 'BEL') {
  // guests (M10 McRae, M12 Informer, M17 Gilbert…) carry nothing: their only weapon is the hand (§3.8)
  const base = FIXED_KIT[role] || (role === 'guest' ? {} : { pistol: 1 });
  let inv = missionInv ? { ...base, ...missionInv } : defaultInventory(role);
  if (campaign === 'BCD' && BCD_KIT[role]) {
    inv = { ...BCD_KIT[role], ...inv };
    if (role === 'natasha' || role === 'skopje') delete inv.pistol; // guests: Beretta / no weapon (§1.8)
  }
  for (const k of Object.keys(inv)) if (!(inv[k] > 0) || !itemInCampaign(k, campaign)) delete inv[k];
  if (role === 'sapper') normalizeSapperInventory(inv);
  return inv;
}

/**
 * Which role carries the mission's first-aid kit (BEL rule: Driver, then Spy, then Sniper).
 * @param {string[]} roles roles deployed in the mission
 * @returns {string|null}
 */
export function firstAidCarrier(roles) {
  return FIRST_AID_ORDER.find((r) => roles.includes(r)) ?? null;
}

/**
 * Validate a sapper loadout: BEL never gives both time and remote bombs; remote bombs need a detonator.
 * Mutates and returns the inventory (removes time bombs and adds the detonator when remote bombs are present).
 * @param {Record<string, number>} inv
 */
export function normalizeSapperInventory(inv) {
  if ((inv.remoteBomb ?? 0) > 0) {
    delete inv.timeBomb;
    inv.detonator = 1;
  }
  return inv;
}

/**
 * Items may be campaign-scoped with `campaigns: ['BCD']` (default: every campaign). BCD-only items
 * (stones, handcuffs, chloroform, club…) get added here later with that field.
 */
export function itemInCampaign(itemId, campaign = 'BEL') {
  const it = itemDef(itemId);
  return !it?.campaigns || it.campaigns.includes(campaign);
}

/** True when using the item never decrements its count. */
export function isUnlimited(itemId) {
  return !!itemDef(itemId)?.unlimited;
}

/**
 * §3.2 pick-up permissions (H) [manual, characters.md]: thing → roles allowed to pick it up.
 * `body` / `barrel` / `raft` are world objects, the rest are item ids.
 */
export const PICKUP_ROLES = Object.freeze({
  body: ['greenberet', 'spy'],
  barrel: ['greenberet'],
  raft: ['diver'], inflatableBoat: ['diver'],
  grenade: ['sapper'], timeBomb: ['sapper'], remoteBomb: ['sapper'], detonator: ['sapper'],
  bearTrap: ['sapper'],
  decoy: ['greenberet'],
  sniperRifle: ['sniper'], // ammo box +3
  smg: ['driver'],
  uniform: ['spy'],
  divingGear: ['diver'],
  firstAid: ['driver', 'spy', 'sniper'],
  knife: ['greenberet', 'diver'], shovel: ['greenberet'], wireCutters: ['sapper'],
  // BCD (bcd-plan §1.5, §1.10): packs are looted by everyone incl. both guests; knapsacks by their owner
  cigarettes: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'natasha', 'skopje'],
  leeEnfield: ['driver'], handcuffs: ['greenberet', 'spy'],
});

/** May `role` pick up `thing` (item id, 'body', 'barrel', 'raft')? Guests never pick anything up (§3.5). */
export function canPickUp(role, thing) {
  if (!role || role === 'guest') return false;
  const r = PICKUP_ROLES[thing];
  return !!r && r.includes(role);
}

/**
 * §3.8 starting loadouts per BEL mission [guide: Kildread]. `team` = deployed roles (+ guests),
 * `inventory` = per-role mission extras added on top of FIXED_KIT (pass as `commandos[].inventory`;
 * count 0 removes a fixed item), `site` = items found on the map (mission `items`/`interactables`),
 * `startDisguised` = the Spy starts in uniform. The first-aid kit (6 doses) follows firstAidCarrier(team).
 * SMG counts are bursts: 100 rounds = 20 bursts.
 */
export const BEL_LOADOUTS = Object.freeze({
  1: { team: ['greenberet', 'diver', 'driver'], inventory: { greenberet: { shovel: 1 }, diver: {}, driver: { smg: 20 } }, site: { raft: 1, barrels: 5, vehicles: ['truck', 'mgNest'] } },
  2: { team: ['greenberet', 'sniper', 'diver', 'sapper', 'driver'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 5 }, diver: { inflatableBoat: 1 }, sapper: { timeBomb: 2 }, driver: { smg: 20 } }, site: { barrels: 4, vehicles: ['truck'] } },
  3: { team: ['greenberet', 'diver', 'sapper', 'spy'], inventory: { greenberet: { shovel: 1 }, diver: {}, sapper: { wireCutters: 1 }, spy: {} }, site: { timeBomb: 2, uniform: 1, raft: 1, electricSwitch: 1 } },
  4: { team: ['greenberet', 'sniper', 'diver', 'sapper', 'driver'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 4 }, diver: { inflatableBoat: 1 }, sapper: { grenade: 3 }, driver: {} }, site: { airdrop: { sniperRifle: 3, timeBomb: 1, smg: 20 }, vehicles: ['patrolboat', 'tank', 'motorcycle', 'truck', 'mgNest', 'mgNest', 'mgNest'] } },
  5: { team: ['greenberet', 'spy'], inventory: { greenberet: { shovel: 1 }, spy: {} }, site: { barrels: 3, uniform: 1, phones: 2 } },
  6: { team: ['greenberet', 'sniper', 'sapper'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 5 }, sapper: { remoteBomb: 2 } }, site: {} },
  7: { team: ['greenberet', 'diver', 'sapper', 'driver', 'spy'], inventory: { greenberet: { shovel: 1 }, diver: { knife: 0 }, sapper: {}, driver: {}, spy: {} }, site: { airdrop: { timeBomb: 4 }, barrels: 2, uniform: 1, vehicles: ['rowboat', 'halftrack'] } },
  8: { team: ['greenberet', 'sniper'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 6 } }, site: { barrels: 10 } },
  9: { team: ['greenberet', 'sniper', 'sapper', 'driver', 'spy'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 5 }, sapper: { remoteBomb: 2 }, driver: {}, spy: {} }, startDisguised: true, site: { barrels: 4, vehicles: ['fuel_truck'] } },
  10: { team: ['greenberet', 'sniper', 'sapper', 'driver'], guests: ['mcrae'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 3 }, sapper: { grenade: 4, timeBomb: 1 }, driver: { smg: 20 } }, site: { barrels: 4, vehicles: ['tank', 'plane'] } },
  11: { team: ['greenberet', 'sniper', 'sapper', 'driver', 'spy'], inventory: { greenberet: { shovel: 1 }, sniper: { sniperRifle: 5 }, sapper: { grenade: 1, remoteBomb: 3 }, driver: {}, spy: {} }, startDisguised: true, site: { barrels: 5, vehicles: ['halftrack', 'mgNest'] } },
  12: { team: ['greenberet', 'sniper', 'spy'], guests: ['informer'], inventory: { greenberet: {}, sniper: { sniperRifle: 7 }, spy: {} }, startDisguised: true, site: {} },
  13: { team: ['greenberet', 'sniper', 'diver', 'sapper', 'driver'], inventory: { greenberet: {}, sniper: { sniperRifle: 4 }, diver: {}, sapper: { remoteBomb: 1 }, driver: {} }, site: { barrels: 2, vehicles: ['minisub', 'truck', 'cannon'] } },
  14: { team: ['greenberet', 'sniper', 'diver', 'sapper', 'driver'], inventory: { greenberet: {}, sniper: { sniperRifle: 8 }, diver: {}, sapper: { remoteBomb: 3 }, driver: {} }, site: { barrels: 3, vehicles: ['tank', 'rowboat', 'mgNest', 'mgNest', 'mgNest', 'mgNest', 'mgNest'] } },
  15: { team: ['sniper', 'diver', 'driver', 'spy'], inventory: { sniper: { sniperRifle: 4 }, diver: {}, driver: {}, spy: {} }, site: { uniform: 1, vehicles: ['car', 'car', 'fuel_truck', 'truck'] } },
  16: { team: ['sniper', 'diver', 'spy'], inventory: { sniper: { sniperRifle: 5 }, diver: {}, spy: {} }, site: { uniform: 1, spyDrives: true } },
  17: { team: ['greenberet', 'diver', 'spy'], guests: ['gilbert', 'prisoner', 'prisoner', 'prisoner', 'prisoner'], inventory: { greenberet: {}, diver: {}, spy: {} }, startDisguised: true, site: { barrels: 1, raft: 1 } },
  18: { team: ['greenberet', 'diver', 'sapper', 'driver'], inventory: { greenberet: {}, diver: {}, sapper: { grenade: 2 }, driver: {} }, site: { remoteBomb: 3, raft: 1, barrels: 4, vehicles: ['tank', 'mgNest', 'mgNest', 'truck'] } },
  19: { team: ['greenberet', 'sniper', 'diver', 'sapper'], inventory: { greenberet: {}, sniper: { sniperRifle: 7 }, diver: {}, sapper: { remoteBomb: 2 } }, site: { barrels: 4, vehicles: ['rowboat'] } },
  20: { team: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'], inventory: { greenberet: {}, sniper: { sniperRifle: 5 }, diver: {}, sapper: { grenade: 2, remoteBomb: 2 }, driver: {}, spy: {} }, site: { uniform: 1, vehicles: ['tank'] } },
});

/**
 * Mission `commandos[]` inventories for BEL mission `n` (§3.8): {role → inventory} ready for the spawn list.
 * @param {number} n 1..20
 * @returns {{team: string[], inventories: Record<string, Record<string, number>>, medic: string|null, startDisguised: boolean, site: object} | null}
 */
export function belLoadout(n) {
  const L = BEL_LOADOUTS[n];
  if (!L) return null;
  const inventories = {};
  for (const role of L.team) inventories[role] = { ...(L.inventory[role] || {}) };
  return { team: [...L.team], inventories, medic: firstAidCarrier(L.team), startDisguised: !!L.startDisguised, site: L.site, guests: L.guests || [] };
}
