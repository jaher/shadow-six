/**
 * Stage-0 interfaces in the running game: test API extensions (§10.4 #9), time base, flow payload hooks,
 * portrait slots, dynamic occluders from vehicles, normalized mission data.
 */
export default async function stage0(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    const w = g.game.world;
    let bel = 0;
    const off = w.onBelTick(() => bel++);
    g.advance(1);
    off();
    const s = g.state();
    const sentry = w.enemies.find((e) => e.tag === 'sentry_bridge');
    const { coneAt } = await import('./src/ai/perception.js');
    const hc = coneAt(sentry); // the sentry sweeps (§4.2): probe 10 m along its current head heading
    const probed = g.probe(sentry.x + Math.cos(hc.heading) * 10, sentry.z + Math.sin(hc.heading) * 10);
    const miss = g.probe(1, 1);
    const heard = [];
    const unsub = w.events.on('noise', (n) => heard.push(n));
    const nz = g.noise(20, 20, 'pistol');
    unsub();
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    const slot = g.game.hud?.portraitSlot?.(gb.id);
    const truck = w.spawnVehicle('truck', { x: 30, z: 10, heading: 0 });
    g.advance(0.1);
    const dyn = w.grid.dynamicAt(30, 10);
    return {
      bel, clock: s.clock, belTick: s.belTick, siren: s.siren, zonesFired: s.zonesFired,
      e0: s.enemies[0], c0: s.commandos[0], probed, sentryId: sentry.id, miss, nz, heard: heard.length && heard[0].level,
      slot: !!slot && slot.classList.contains('hud-portrait-slot'), flow: !!g.game.flow && typeof g.game.flow.unlocked,
      dyn, truckKind: truck.vehicleKind, cap: truck.capacity, canEnter: truck.canEnter(gb),
      normalized: Array.isArray(g.game.missionDef.zones) && g.game.missionDef.enemies[1].route?.type,
    };
  });
  t.log(JSON.stringify(r));
  t.equal(r.bel, 20, '20 BEL ticks per second');
  t.near(r.clock, 1, 1e-6, 'mission clock');
  t(r.belTick >= 20, 'belTick exposed');
  t.equal(r.siren.active, false, 'siren state exposed');
  t(Array.isArray(r.zonesFired), 'zonesFired exposed');
  for (const k of ['nervousness', 'sawBody', 'sawKill', 'target']) t(k in r.e0, `enemies[i].${k}`);
  for (const k of ['held', 'buried', 'disguised', 'y']) t(k in r.c0, `commandos[i].${k}`);
  t.equal(r.probed, r.sentryId, 'probe finds the sentry');
  t.equal(r.miss, null, 'probe misses empty ground');
  t.equal(r.nz.radius, 18, 'noise() uses CONFIG radius');
  t.equal(r.heard, 2, 'noise event carries level');
  t(r.slot, 'hud.portraitSlot returns the slot element');
  t.equal(r.flow, 'function', 'game.flow.unlocked');
  t.equal(r.dyn, 2, 'truck stamped into dynamicBlock (B.HIGH)');
  t.equal(r.truckKind, 'land');
  t(r.cap >= 2, 'capacity');
  t.equal(r.canEnter, true);
  t.equal(r.normalized, 'PINGPONG', 'Game uses the normalized mission');
}
