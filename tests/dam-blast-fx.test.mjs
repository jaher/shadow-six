/**
 * M3 dam demolition reads on screen: the charge on the dam's toe ledge (wading-depth water, flooded by the very blast
 * that breaks the dam) goes up in a fireball over the water column, while a charge in open river water stays a
 * water column only.
 */
export default async function damBlastFx(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, g = G.game;
    await G.loadMission('m03');
    G.start();
    for (let i = 0; i < 4; i++) { g.step(1 / 60); G.render(1 / 60, 1); } // FX scan (map-build terrain)
    const w = g.world, m = w.mission.markers.find((k) => k.id === 'dam_charge');
    const { applyExplosion } = await import('/src/abilities/explosions.js');
    const sap = w.commandos.find((c) => c.role === 'sapper');
    const fired = (x, z) => { const n0 = w.fx.items.length; applyExplosion(w, x, z, 'bomb', sap); return w.fx.items.slice(n0).map((i) => i.kind + (Math.hypot(i.x - x, i.z - z) < 0.5 ? '' : '@far')); };
    const river = fired(70, 63); // mid-river, open water
    const toe = fired(m.x + 1, m.z - 0.3);
    for (let i = 0; i < 20; i++) { g.step(1 / 60); G.render(1 / 60, 1); }
    return { river, toe, dam: !!w.byId?.('dam')?.destroyed || w.objectives.find((o) => o.id === 'o2')?.done };
  });
  t.log(`river: ${r.river.join(',')} | toe: ${r.toe.join(',')}`);
  t.ok(r.dam, 'the toe charge demolishes the dam');
  t.ok(r.toe.includes('explosion_large'), 'dam charge on the flooded toe ledge: a fireball');
  t.ok(!r.river.includes('explosion_large'), 'charge in open river water: water column only, no fireball');
  await t.shot('dam-blast-m03');
}
