/**
 * Loadout (BEL 1998 accuracy, docs/research-raw/characters.md): spawn all six commandos with their
 * DEFAULT kit (no mission overrides) and check the exact weapons each carries, the one 6-dose first-aid
 * kit on the Driver, and that the HUD action panel offers exactly those weapons.
 */
const EXPECTED = {
  // role: weapons (pistol is standard for all six, unlimited)
  greenberet: ['knife', 'pistol'],
  sniper: ['sniperRifle', 'pistol'],
  diver: ['knife', 'harpoon', 'pistol'],
  sapper: ['pistol', 'bearTrap', 'timeBomb'],
  driver: ['pistol'], // SMG is not standard kit (only M1, M2, M4 on site, M10)
  spy: ['pistol', 'lethalInjection'],
};
const NOT_BEL = ['club', 'stones', 'throwingKnife', 'binoculars', 'chloroform', 'handcuffs', 'rifle', 'molotov', 'gasGrenade'];

export default async function loadout(page, t) {
  const r = await page.evaluate(async (roles) => {
    const g = window.__game;
    const { MISSIONS } = await import('./src/missions/index.js');
    const { ITEMS } = await import('./src/items.js');
    const { ABILITIES } = await import('./src/abilities/index.js');
    const base = MISSIONS.find((m) => m.id === 'm00');
    const def = {
      ...base, id: 'm00_loadout',
      enemies: [],
      commandos: roles.map((role, i) => ({ role, x: 6 + i * 2, z: 52 })),
    };
    await g.loadMission(def);
    g.start();
    const w = g.game.world;
    const out = {};
    for (const c of w.commandos) {
      g.select([c.id]);
      g.render();
      const buttons = [...document.querySelectorAll('#hud button')].map((b) => b.textContent.trim().toLowerCase());
      const inv = Object.fromEntries(c.inventory);
      out[c.role] = {
        inv,
        weapons: Object.keys(inv).filter((k) => ITEMS[k]?.weapon || k === 'bearTrap'),
        unlimitedPistol: !!ITEMS.pistol.unlimited,
        buttons,
        abilityItems: (c.abilities || []).map((id) => ABILITIES[id]?.item).filter(Boolean),
      };
    }
    return out;
  }, Object.keys(EXPECTED));

  for (const [role, weapons] of Object.entries(EXPECTED)) {
    const got = r[role];
    t(got, `${role} spawned`);
    t.log(`${role}: ${JSON.stringify(got.inv)} ${JSON.stringify(got.buttons)}`);
    t.equal(JSON.stringify([...got.weapons].sort()), JSON.stringify([...weapons].sort()), `${role} weapons`);
    for (const bad of NOT_BEL) t(!(bad in got.inv), `${role} has no ${bad} (later games)`);
    // abilities are added by their owners over time; any weapon ability offered must use an item the role carries
    for (const item of got.abilityItems) t(item in got.inv, `${role}: ability item ${item} is in the kit`);
  }
  t.equal(r.sniper.inv.sniperRifle, 5, 'sniper default rounds');
  t(!('remoteBomb' in r.sapper.inv) || !('timeBomb' in r.sapper.inv), 'sapper never has both bomb types');
  t.equal(r.driver.inv.firstAid, 6, 'driver carries the 6-dose first-aid kit');
  for (const role of ['greenberet', 'sniper', 'diver', 'sapper', 'spy']) t(!(role in r) || !r[role].inv.firstAid, `${role} has no first-aid kit when the Driver is deployed`);
  t(!('remoteBomb' in r.sapper.inv) && 'timeBomb' in r.sapper.inv, 'default sapper: time bombs only');

  // Mission kits: the mission inventory is added to the fixed kit only (BEL M4 / M6 / M12 setups)
  const m = await page.evaluate(async () => {
    const g = window.__game;
    const { MISSIONS } = await import('./src/missions/index.js');
    const base = MISSIONS.find((x) => x.id === 'm00');
    await g.loadMission({
      ...base, id: 'm00_kits', enemies: [],
      commandos: [
        { role: 'sapper', x: 6, z: 52, inventory: { grenade: 3 } },
        { role: 'greenberet', x: 8, z: 52, inventory: {} },
      ],
    });
    const w = g.game.world;
    const kits = w.commandos.map((c) => Object.fromEntries(c.inventory));
    await g.loadMission({ ...base, id: 'm00_kits2', enemies: [], commandos: [{ role: 'sapper', x: 6, z: 52, inventory: { remoteBomb: 2 } }] });
    kits.push(Object.fromEntries(g.game.world.commandos[0].inventory));
    return kits;
  });
  t.log(JSON.stringify(m));
  t(!('timeBomb' in m[0]) && m[0].grenade === 3 && m[0].bearTrap === 1, 'M4-style sapper {grenade:3}: no time bomb leaks in');
  t(!('shovel' in m[1]) && m[1].knife === 1 && m[1].decoy === 1, 'M12-style GB: no shovel');
  t(!('timeBomb' in m[2]) && m[2].remoteBomb === 2 && m[2].detonator === 1, 'M6-style sapper: remote bombs + detonator, no timeBomb key');
  t(r.greenberet.buttons.some((b) => b.includes('knife')), 'GB action panel has knife');
  t(r.diver.buttons.some((b) => b.includes('knife')), 'Marine action panel has knife (BEL)');
  t(!r.sniper.buttons.some((b) => b.includes('knife')), 'Sniper has no knife action (BEL)');
  await t.shot('loadout');
}
