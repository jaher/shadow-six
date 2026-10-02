/**
 * MISSIONS13 (design-spec §7.4–§7.6, §10.5 #14 in the running game): BEL M1–M3 load through Game.loadMission
 * without page errors, spawn their rosters and vehicles, register zones/garrisons/ladders, and run 3 s with
 * nobody spotted (no zone event, no commando hurt). Screenshots: m02 camp overview, m03 dam + station.
 */
export default async function missions13(page, t) {
  const expect = {
    m01: { commandos: 3, enemies: 13, vehicles: ['raft', 'truck', 'kubel_decor', 'mg1_gun'], zones: 0 },
    // m02: e17 rides pboat as its crew record (§7.5), not a spawned enemy
    m02: { commandos: 5, enemies: 16, vehicles: ['truck', 'pboat'], zones: 1 },
    m03: { commandos: 4, enemies: 34, vehicles: ['raft'], zones: 2 },
  };
  for (const id of Object.keys(expect)) {
    const r = await page.evaluate(async (mid) => {
      const g = window.__game;
      await g.loadMission(mid);
      g.start();
      const w = g.game.world;
      const hp0 = w.commandos.map((c) => c.hp);
      g.advance(3);
      const s = g.state();
      return {
        commandos: w.commandos.length, enemies: w.enemies.length,
        vehicles: (w.vehicles || w.entities.filter((e) => e.kind === 'vehicle')).map((v) => v.tag ?? v.id),
        zones: (w.alarm?.zones || []).length, fired: s.zonesFired.length,
        hurt: w.commandos.some((c, k) => c.hp < hp0[k] || !c.alive),
        ladders: (w.ladders || []).length, barracks: w.barracks ? w.barracks.size : -1,
        structures: w.structures ? w.structures.size : 0, flow: g.game.missionDef.id, size: g.game.missionDef.size,
      };
    }, id);
    t.log(`${id} ${JSON.stringify(r)}`);
    const e = expect[id];
    t.equal(r.flow, id, `${id} loaded`);
    t.equal(r.commandos, e.commandos, `${id} commandos`);
    t.equal(r.enemies, e.enemies, `${id} enemies`);
    for (const v of e.vehicles) t(r.vehicles.includes(v), `${id} vehicle ${v} spawned (${r.vehicles})`);
    t.equal(r.zones, e.zones, `${id} alarm zones`);
    t.equal(r.fired, 0, `${id}: nobody spotted in the first 3 s`);
    t(!r.hurt, `${id}: no commando hurt at the start`);
    t(r.structures > 10, `${id} structures built`);
    if (id === 'm02') {
      t.equal(r.ladders, 1, 'm02 ladder registered (ladder_sw; the way down inside is plat_sw\'s stair)');
      t.equal(r.barracks, 2, 'm02 garrisons registered');
      await page.evaluate(() => { const g = window.__game; g.setZoom(0.55); g.centerOn(42, 42); });
      await t.shot('missions13-m02-camp');
    }
    if (id === 'm03') {
      t.equal(r.barracks, 4, 'm03 garrisons registered');
      // units on the dam crest stand on the grid's walking height: no relief / low surface under the deck is added
      // (it floated them 0.25 m or sank them 8 cm into the snow before)
      const gy = await page.evaluate(() => {
        const w = window.__game.game.world, out = [];
        for (const [x, z] of [[48.65, 21.62], [44, 21.9], [40, 22.1], [36, 23], [32.3, 26], [51.1, 22.75], [30.6, 28.3]])
          out.push([x, z, w.grid.elevAt(x, z), +w.groundY(x, z).toFixed(3)]);
        return out;
      });
      for (const [x, z, e, y] of gy) { t(e > 7, `m03 crest cell at (${x}, ${z}) raised (${e})`); t.equal(y, 0, `m03 crest (${x}, ${z}): no visual ground offset`); }
      await page.evaluate(() => { const g = window.__game; g.setZoom(0.5); g.centerOn(34, 52); });
      await t.shot('missions13-m03-dam');
    }
  }

  // §4.9 / §7.4 regression: M1 declares `zones: []` ("the entire map is safe"): a body found in front of a guard
  // gives only local reactions (BODY/SEARCH), never a map-wide RINT, siren, ALARM! or stats.alarms.
  const b = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m01');
    g.start();
    const w = g.game.world;
    const viewer = w.enemies.find((e) => e.id === 11) || w.enemies.find((e) => e.vision && e.soldierType !== 'mg');
    const victim = w.enemies.find((e) => e !== viewer && e.soldierType !== 'mg');
    g.advance(0.2);
    const hx = Math.cos(viewer.heading), hz = Math.sin(viewer.heading);
    if (victim.setPosition) victim.setPosition(viewer.x + hx * 8, viewer.z + hz * 8, 0);
    else { victim.x = viewer.x + hx * 8; victim.z = viewer.z + hz * 8; }
    victim.takeDamage(9999, null, 'knife');
    const states = new Set();
    for (let i = 0; i < 100; i++) { g.advance(0.1); states.add(viewer.brainState); }
    const s = g.state();
    return { states: [...states], fired: s.zonesFired.length, alarms: s.stats.alarms, siren: !!w.alarm.siren.active };
  });
  t.log(`m01 body ${JSON.stringify(b)}`);
  t(b.states.includes('BODY'), 'm01: guard still reacts locally to the body');
  t.equal(b.fired, 0, 'm01: no zone/map-wide event from a found body');
  t.equal(b.alarms, 0, 'm01: no alarm counted');
  t(!b.siren, 'm01: siren stays off');
}
