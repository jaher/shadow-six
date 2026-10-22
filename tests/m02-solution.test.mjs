/**
 * M2 "A Quiet Blow-Up" full stealth solution (tools/solutions/m02.solution.mjs) played in the running game with only
 * player orders, the original's way: the settlement's three guards (two lured by the Sapper's footprints into his bear
 * trap, one speared by the Marine), the Sniper's two shots (e4 in front of the rocks, e5 on the wall walk), the raft
 * across, the Green Beret over the SW wall to lower the camp's ladder, e6 and e7 knifed and hidden under fuel drums,
 * the fuel depot (o1) blown with one time bomb and the whole team out through the SE gate in the truck (o2): the game
 * reports a win, seven dead before the blast and no body found, no commando ever spotted / challenged / unmasked, no
 * vehicle tainted, all five alive —
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
    const trackers = [];
    G.game.world.events.on('enemy:state', (p) => { if (p.to === 'TRACKS') trackers.push(p.enemy?.tag ?? p.enemy?.id); });
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
      kills: ev('unit:killed').map((e) => ({ t: e.t, line: e.line })),
      killsBeforeBlast: ev('unit:killed').filter((e) => blast == null || e.t < blast - 1e-6).map((e) => e.line.split(' ')[0]).sort(),
      alarms: ev('alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      blast, checkpoints: cp,
      bodiesFound: ev('enemy:body-found').length,
      trackers: [...new Set(trackers)].sort(),
      deadTrackers: [...new Set(trackers)].every((t) => !w.enemies.find((e) => e.tag === t)?.alive),
      heardSteps: ev('enemy:heard-steps').length,
      tainted: ev('vehicle:tainted').length,
    };
  });
  t.log(`m02 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, kills ${r.kills.map((k) => `${k.line} @${k.t.toFixed(1)}`).join(', ')}; blast at ${r.blast?.toFixed(1)}, first alarm ${r.alarms[0]?.t.toFixed(1)} (${r.alarms[0]?.line})`);
  t.log(`checkpoints: ${Object.entries(r.checkpoints).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'depot destroyed, truck out through the gate');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked; no vehicle tainted');
  t.equal(r.exposures.length, 0, `never inside a live cone where it sees him${r.exposures.length ? ': ' + r.exposures.slice(0, 6).join(' | ') : ''}`);
  t(r.alive, 'all five alive');
  t.equal(r.tainted, 0, 'nobody saw a man get into the truck');
  t.equal(r.bodiesFound, 0, 'nobody finds a body');
  t.equal(JSON.stringify(r.trackers), JSON.stringify(['e1', 'e3']), `only e1 and e3 follow footprints (${r.trackers.join(',')})`);
  t(r.deadTrackers, 'each guard who followed the footprints died in the trap');
  t.equal(r.heardSteps, 0, 'no guard hears a step');
  t.equal(JSON.stringify(r.killsBeforeBlast), JSON.stringify(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']), `seven dead before the blast (${r.killsBeforeBlast.join(',')})`);
  // the one alarm the design forces: the blast itself (z_ne onHeard), with the truck already on its way out
  t(r.blast != null && r.alarms.length > 0 && r.alarms[0].t >= r.blast - 1e-6 && /explosion/.test(r.alarms[0].line), `the first alarm is the blast (${r.alarms[0]?.line})`);
  t(r.checkpoints.L3 != null && r.checkpoints.L3 - r.blast < 2.5, `the truck is out within 2.5 s of the blast`);
  for (const k of ['A4', 'B2', 'B5', 'C1', 'D2', 'D3', 'E3', 'E4', 'E5', 'E7', 'G1', 'H1', 'H2', 'I1', 'I2', 'J3', 'K1', 'L1', 'L3']) t(r.checkpoints[k] != null, `checkpoint ${k}`);
}
