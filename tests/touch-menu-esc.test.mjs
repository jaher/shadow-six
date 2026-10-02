/**
 * The phone's MENU button is the Esc of a finger (src/ui/touch.js, hud.js Esc): during the escape truck's drive-off
 * (§7.6) the first press skips the drive (the mission is won at once, no menu); in play an armed ability is put away
 * and the in-mission menu opens (no ability left armed under the menu).
 */
export default async function touchMenuEsc(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const hud = G.hud;
    const menu = hud.touch?.menu;
    const out = { menu: !!menu };
    if (!menu) return out;
    // 1) the drive-off (as extraction-handspawn): MENU skips it
    await g.loadMission('m03');
    g.start();
    const w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    const ob = (id) => (w.objectives || []).find((o) => o.id === id);
    const v = w.spawnVehicle('truck', { id: 'evac_truck', x: 60, z: 10, heading: Math.PI / 2, friendly: true, seats: 6 });
    ob('o1').done = true; ob('o2').done = true;
    g.advance(0.5);
    const men = w.commandos.filter((c) => c.alive !== false && !c.removed);
    men.forEach((c, i) => { c.x = v.x + 2.5; c.z = v.z + (i - 1.5) * 0.8; c.snap?.(); v.enter(c); });
    g.advance(0.2);
    out.phase = G._endFlags?.evacPhase;
    menu.click();
    out.menuAfterSkip = !!hud.kit.active;
    g.advance(0.2);
    out.state = G.state;
    // 2) in play with an armed ability: MENU puts it away and opens the in-mission menu
    hud.kit.close?.();
    await g.loadMission('m01');
    g.start();
    g.advance(0.2);
    G.input.targeting = { abilityId: 'knife', commandos: [] };
    menu.click();
    out.targeting = G.input.targeting;
    out.card = hud.kit.top?.spec?.id || null;
    out.paused = G.state !== 'playing';
    hud.menus.close?.(true);
    return out;
  });
  t.log(JSON.stringify(r));
  t(r.menu, 'the HUD has the touch MENU button');
  t.equal(r.phase, 'leave', 'the truck is driving off');
  t.equal(r.menuAfterSkip, false, 'MENU during the drive-off opens no menu');
  t.equal(r.state, 'won', 'MENU skips the drive-off: won at once');
  t.equal(r.targeting, null, 'MENU puts an armed ability away');
  t.equal(r.card, 'main', 'MENU opens the in-mission menu');
  t(r.paused, 'the in-mission menu pauses the game');
}
