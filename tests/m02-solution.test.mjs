/**
 * M2 "A Quiet Blow-Up" full stealth solution (tools/solutions/m02.solution.mjs) played in the running game with only
 * player orders: the fuel depot (o1) blown with one time bomb and the whole team out through the SE gate in the truck
 * (o2), the game reports a win, no commando ever spotted / challenged / unmasked, no vehicle tainted, all five alive —
 * and no commando (nor the raft's crew, nor the used raft lying empty, nor the patrol boat's gunner watching) ever
 * inside a live cone where its rule sees him (driver exposure watch, user 2026-10-08: "make sure no commando goes
 * inside the field of view of a solider before being spotted. Even the raft boat in the light shaded field of view of a
 * soldier makes the soldier see it"). The only alarm is the depot's blast itself (zone z_ne: any explosion on the camp
 * bank is heard), under two seconds before the truck reaches the exit. Logic only (Game.step, no frames): a few
 * minutes.
 */
export const timeout = 1_500_000;

export default async function m02Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m02');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m02.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const w = G.game.world;
    D.dispose();
    const ev = (n) => D.events.filter((e) => e.name === n);
    const cp = Object.fromEntries(D.checkpoints.map((c) => [c.name.split(' ')[0], c.t]));
    const blast = ev('structure:destroyed').find((e) => /depot_/.test(e.line))?.t ?? null;
    return {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      killsBeforeBlast: ev('unit:killed').filter((e) => blast == null || e.t < blast - 1e-6).map((e) => e.line.split(' ')[0]).sort(),
      alarms: ev('alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      blast, checkpoints: cp,
      bodiesFound: ev('enemy:body-found').length,
      tracked: ev('enemy:state').filter((e) => /->TRACKS/.test(e.line)).length,
      heardSteps: ev('enemy:heard-steps').length,
      tainted: ev('vehicle:tainted').length,
    };
  });
  t.log(`m02 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, blast at ${r.blast?.toFixed(1)}, first alarm ${r.alarms[0]?.t.toFixed(1)} (${r.alarms[0]?.line})`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'depot destroyed, truck out through the gate');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked; no vehicle tainted');
  t.equal(r.exposures.length, 0, `never inside a live cone where it sees him${r.exposures.length ? ': ' + r.exposures.slice(0, 6).join(' | ') : ''}`);
  t(r.alive, 'all five alive');
  t.equal(r.tainted, 0, 'nobody saw a man get into the truck');
  t.equal(r.bodiesFound, 0, 'nobody finds e4\'s body');
  t.equal(r.tracked, 0, 'no guard follows the team\'s tracks');
  t.equal(r.heardSteps, 0, 'no guard hears a step');
  t.equal(JSON.stringify(r.killsBeforeBlast), JSON.stringify(['e4']), 'before the blast only e4 dies (the Sniper)');
  // the one alarm the design forces: the blast itself (z_ne onHeard), with the truck already on its way out
  t(r.blast != null && r.alarms.length > 0 && r.alarms[0].t >= r.blast - 1e-6 && /explosion/.test(r.alarms[0].line), `the first alarm is the blast (${r.alarms[0]?.line})`);
  t(r.checkpoints.F4 != null && r.checkpoints.F4 - r.blast < 2.5, `the truck is out within 2.5 s of the blast (${(r.checkpoints.F4 - r.blast).toFixed(2)} s)`);
  for (const k of ['A1', 'B2', 'C2', 'C3', 'D1', 'D3', 'E1', 'E2', 'E3', 'E4', 'E5', 'F1', 'F2', 'F3', 'F4']) t(r.checkpoints[k] != null, `checkpoint ${k}`);
}
