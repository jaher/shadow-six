/**
 * M8 "Pyrotechnics" full solution (tools/solutions/m08.solution.mjs) played in the running game with only player
 * orders: the oil-barrel store (o1), both fuel tanks (o2) and the reservoir (o3) set off by one rifle shot into a
 * barrel chain the Green Beret laid, then both men aboard the jeep at the bridge (o4). The game reports a win, no
 * commando is ever spotted / challenged, no vehicle tainted, both alive — and no commando ever inside a live cone (the
 * exposure watch). The only alarm is the blast itself (the whole map is one zone that hears explosions): nothing raises
 * it before the depot goes up. Logic only (Game.step, no frames): a long mission, several minutes.
 */
export const timeout = 3_600_000;

export default async function m08Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m08');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m08.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    let firstAlarm = null;
    const offAlarm = w.events.on('alarm:zone', (e) => { if (firstAlarm == null) firstAlarm = { t: w.time, cause: e.cause ?? e.reason ?? null }; });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    offAlarm?.();
    const cps = D.checkpoints;
    const blastAt = cps.find((c) => c.name.startsWith('X2'))?.t ?? null;
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').length,
      bodiesFoundBeforeBlast: D.events.filter((e) => e.name === 'enemy:body-found' && (blastAt == null || e.t < blastAt - 1)).map((e) => e.line),
      firstAlarm, blastAt,
      checkpoints: cps.map((c) => c.name.split(' ')[0]),
    };
    D.dispose?.();
    return out;
  });
  t.log(`m08 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills} killed, first alarm ${JSON.stringify(r.firstAlarm)} (blast at ${r.blastAt})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true, o_burn: true, o4: true }), 'store, both tanks, reservoir, then away in the jeep');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'both alive');
  t(r.blastAt != null && r.firstAlarm && r.firstAlarm.t >= r.blastAt - 2, `no alarm before the depot goes up (${JSON.stringify(r.firstAlarm)})`);
  t.equal(r.bodiesFoundBeforeBlast.length, 0, `no body found before the blast ${r.bodiesFoundBeforeBlast.join('; ')}`);
  for (const k of ['A1', 'D2', 'F2', 'M7', 'Mc2', 'Q3', 'R1', 'T3', 'U1', 'V5', 'W2', 'X2', 'X4']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
