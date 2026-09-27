/**
 * §7.6 scripted escape vehicle + §8.1 win (M3 evac_truck): nothing on the map until o1 and o2 are
 * done; then the friendly truck spawns off-map at (52,−6), drives to (52,12) and waits; once every
 * living commando is aboard it drives off north through the exit and the mission is won. The spawn
 * is latched (quick save/load keeps it; no second truck).
 */
export default async function extraction(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const out = {};
    await g.loadMission('m03');
    g.start();
    const w = G.world;
    // keep the run deterministic: no enemies to spot the men standing by the road
    // (world.remove, not a bare `removed` flag: that left all 34 guards in play and the test only
    // passed while the old snow speed penalty kept them from reaching the road in time)
    for (const e of [...w.enemies]) w.remove(e);
    out.enemiesLeft = w.enemies.length;
    const ob = (id) => (G.world.objectives || []).find((o) => o.id === id);
    g.advance(1);
    out.before = !!w.byId('evac_truck');
    ob('o1').done = true;
    g.advance(2);
    out.afterO1 = !!w.byId('evac_truck');
    ob('o2').done = true;
    g.advance(0.1);
    const v0 = w.byId('evac_truck');
    out.spawn = v0 ? { x: +v0.x.toFixed(1), z: +v0.z.toFixed(1), type: v0.vehicleType, cap: v0.capacity } : null;
    g.advance(1);
    // quick save mid-drive → load: the spawn stays latched (one truck), it keeps driving in
    G.quickSave();
    await G.quickLoad();
    g.start();
    const w2 = G.world;
    out.enemiesAfterLoad = w2.enemies.length;
    out.reload = { flag: !!G._endFlags?.evacSpawned, n: w2.vehicles.filter((q) => q.tag === 'evac_truck').length };
    g.advance(4);
    const v = w2.byId('evac_truck');
    out.arrived = v ? { x: +v.x.toFixed(2), z: +v.z.toFixed(2), moving: !!v.goal } : null;
    out.nTrucks = w2.vehicles.filter((q) => q.tag === 'evac_truck' || q.id === 'evac_truck').length;
    // board everyone (teleport beside the truck, then enter)
    const men = w2.commandos.filter((c) => c.alive !== false && !c.removed);
    out.board = men.map((c, i) => {
      c.x = v.x + 2.5; c.z = v.z + (i - 1.5) * 0.8; c.snap?.();
      return v.enter(c);
    });
    g.advance(0.5);
    out.leaving = G._endFlags?.evacPhase;
    out.o3early = ob('o3').done;
    for (let k = 0; k < 40 && G.state === 'playing'; k++) g.advance(0.5);
    out.o3 = ob('o3').done;
    out.state = G.state;
    out.final = { x: +v.x.toFixed(1), z: +v.z.toFixed(1) };
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.enemiesLeft, 0, 'guards removed for a deterministic run');
  t.equal(r.enemiesAfterLoad, 0, 'and they stay removed across quick save/load');
  t.equal(r.before, false, 'no evac truck at mission start');
  t.equal(r.afterO1, false, 'o1 alone does not spawn the truck');
  t(r.spawn && r.spawn.type === 'truck', 'o1+o2 done → the evac truck spawns');
  t(r.spawn && r.spawn.z < 0, 'it spawns off the north edge (52,−6)');
  t.equal(r.spawn?.cap, 6, 'the evac truck seats 6');
  t(r.arrived && Math.hypot(r.arrived.x - 52, r.arrived.z - 12) < 1, `arrives at (52,12) within 5 s (${JSON.stringify(r.arrived)})`);
  t.equal(r.arrived?.moving, false, 'and waits there');
  t(r.reload.flag && r.reload.n === 1, `quick save/load keeps the latched spawn and one truck (${JSON.stringify(r.reload)})`);
  t.equal(r.nTrucks, 1, 'exactly one evac truck');
  t(r.board.every(Boolean), 'every commando can board');
  t.equal(r.leaving, 'leave', 'all aboard → it drives off');
  t.equal(r.o3early, false, 'o3 not done while still parked');
  t.equal(r.o3, true, 'o3 completes once it passes the exit');
  t.equal(r.state, 'won', 'mission won');
}
