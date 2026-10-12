/**
 * M13 "David and Goliath" full solution (tools/solutions/m13.solution.mjs) played in the running game with only player
 * orders: the battleship torpedoed in the bow (o_ship), the fuel tanks blown (o_fuel) and the whole team rowed out to
 * the red buoy (o_buoy); the game reports a win, no commando ever spotted / challenged, no boat tainted, all five
 * alive — and no commando, nor the raft (empty, crewed by its hull, or unused at its spawn: the Marine packs it at
 * once) or the mini-sub, ever inside a live cone (the driver's exposure watch). The
 * only alarm is the one the mission forces: the ship going down (and the fuel blast) wakes the port; the tank is shut
 * in by the truck, the patrol boat is sunk by the pier gun and the civilian supply boat is left alone. Logic only
 * (Game.step, no frames): a few minutes.
 */
export const timeout = 3_600_000;

export default async function m13Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m13');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m13.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    let error = null;
    let alarmAt = null;
    const offAlarm = w.events.on('alarm:zone', () => { if (alarmAt == null) alarmAt = w.time; });
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    offAlarm?.();
    const ship = w.objectives.find((o) => o.id === 'o_ship');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      raft: (() => { const b = D.raft(); return b ? { x: b.x, z: b.z, crew: b.occupants.length } : null; })(),
      kills: D.events.filter((e) => e.name === 'unit:killed').length,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      shipAt: D.checkpoints.find((c) => c.name.startsWith('L7'))?.t ?? null, alarmAt,
      tank: (() => { const v = w.byId('pz2'); return { x: v.x, z: v.z }; })(),
      sunkBoat: !!w.byId('pboat')?.destroyed,
      supplyAfloat: !w.byId('supply')?.destroyed,
    };
    D.dispose();
    return out;
  });
  t.log(`m13 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills} killed`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o_ship: true, o_fuel: true, o_buoy: true }), 'ship, fuel, then out to the buoy');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all five alive');
  t(r.raft && r.raft.crew === 5 && Math.hypot(r.raft.x - 3, r.raft.z - 178) < 5.5, `the raft with all five at the red buoy (${JSON.stringify(r.raft)})`);
  t(r.alarmAt != null && r.shipAt != null && r.alarmAt >= r.shipAt, `the only alarm comes after the torpedo hit (alarm ${r.alarmAt}, hit ${r.shipAt})`);
  // (when the port wakes up it drives for the door and stops there, against the truck parked across it)
  t(Math.abs(r.tank.x - 80) < 3 && r.tank.z > 93 && r.tank.z < 103, `the tank shut in the garage by the truck (${JSON.stringify(r.tank)})`);
  t(r.sunkBoat, 'the patrol boat sunk by the pier gun');
  t(r.supplyAfloat, 'the civilian supply boat still afloat (the gun held its fire near her)');
  for (const k of ['A0', 'A4', 'B1', 'B3', 'C6', 'D3', 'G6', 'H1', 'J2', 'J3', 'K1', 'L7', 'L8', 'L12']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
