/**
 * BEL M6 in the running game (replay m06 F1): the evacuation truck drives in hostile. After the Leopold blows, with
 * the Gatling gunner (e34) alive and nobody boarding, the enemy guns destroy the truck within about 20 s of its
 * arrival, and the mission is lost with the truck message. T1 taints the truck and lays the Gatling on it.
 */
export default async function missionM06Truck(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m06');
    g.start();
    const w = g.game.world;
    const { applyExplosion } = await import('/src/abilities/explosions.js');
    g.advance(1);
    const mk = w.markers.get('leopold_charge');
    applyExplosion(w, mk.x, mk.z, 'bomb', w.commandos.find((c) => c.role === 'sapper'));
    const t0 = w.time;
    const shots = [], ends = [];
    w.events.on('mission:countdown', (p) => { if (p.reason) ends.push(p.reason); });
    w.events.on('shot', (p) => { if (p.target === w.byId('evac_truck')) shots.push(`${p.shooter?.tag}@${(w.time - t0).toFixed(1)}`); });
    let arrived = null, gone = null;
    for (let k = 0; k < 600 && !gone; k++) {
      g.advance(0.1);
      const v = w.byId('evac_truck');
      if (v && arrived == null && !v.path && !v.goal) arrived = w.time - t0;
      if (v?.destroyed) gone = w.time - t0;
    }
    for (let k = 0; k < 80 && g.game.state === 'playing'; k++) g.advance(0.1);
    const v = w.byId('evac_truck');
    return { shots: shots.slice(0, 12), arrived, gone, tainted: !!v?.tainted, e34: w.byId('e34')?.alive, state: g.game.state, reason: ends[0] || null };
  });
  t.log(JSON.stringify(r));
  t(r.tainted, 'the truck is tainted when it comes in');
  t(r.e34, 'the Gatling gunner is alive');
  t(r.arrived != null && r.arrived < 10, `the truck reaches its stop (${r.arrived})`);
  t(r.gone != null && r.gone - r.arrived <= 25, `destroyed ${r.gone && (r.gone - r.arrived).toFixed(1)} s after arriving`);
  t(r.state === 'lost', `mission lost (${r.state})`);
  t(/DESTROYED THE TRUCK/.test(r.reason || ''), `loss reason: ${r.reason}`);
}
