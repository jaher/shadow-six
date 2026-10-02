/**
 * M3 dam demolition reads on screen: the charge at the spillway gates on the crest (dam_charge, the raised deck the
 * very blast brings down into the river) goes up in a fireball at the deck's height, while a charge in open river
 * water stays a water column only.
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
    const fired = (x, z) => { const n0 = w.fx.items.length; applyExplosion(w, x, z, 'bomb', sap); return w.fx.items.slice(n0).map((i) => ({ kind: i.kind + (Math.hypot(i.x - x, i.z - z) < 0.5 ? '' : '@far'), y: i.opts?.y ?? null })); };
    const river = fired(70, 63); // mid-river, open water
    const crest = fired(m.x + 1, m.z + 0.3); // on the crest by the spillway gates
    for (let i = 0; i < 20; i++) { g.step(1 / 60); G.render(1 / 60, 1); }
    return { river, crest, dam: !!w.byId?.('dam')?.destroyed || w.objectives.find((o) => o.id === 'o2')?.done };
  });
  const kinds = (a) => a.map((i) => i.kind);
  t.log(`river: ${kinds(r.river).join(',')} | crest: ${r.crest.map((i) => `${i.kind}${i.y != null ? '@y' + i.y.toFixed(2) : ''}`).join(',')}`);
  t.ok(r.dam, 'the crest charge demolishes the dam');
  const fire = r.crest.find((i) => i.kind === 'explosion_large');
  t.ok(fire, 'dam charge on the crest: a fireball (not a water column in the river the crest falls into)');
  t.ok(fire && fire.y > 6.5, `the fireball goes up at the deck (y ${fire?.y})`);
  t.ok(!kinds(r.river).includes('explosion_large'), 'charge in open river water: water column only, no fireball');
  await t.shot('dam-blast-m03');
}
