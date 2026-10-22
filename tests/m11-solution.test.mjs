/**
 * M11 "In the Soup" full solution (tools/solutions/m11.solution.mjs) played in the running game with only player orders:
 * the Spy clears gate 1 and the east valley, then holds the yard patrol in talk while the Driver
 * crawls to the half-track (the Sapper mining the yard rig on foot meanwhile); inside it the team is never seen; the
 * Sapper's three charges (the yard rig, the tunnel mouth, the valley rig) and the hull gun's burst into the fuel truck between the quarry rigs fell all four rigs (o_rigs),
 * and the half-track leaves by the west road with all five aboard (o_escape). The game reports a win, no commando is
 * ever spotted / challenged / unmasked, no vehicle tainted, all five alive — and no commando ever inside a live cone
 * (the exposure watch; user 2026-10-08: "make sure no commando goes inside the field of view of a solider before being
 * spotted"). The only alarms are the blasts themselves (every explosion trips its zone: the rigs must be blown up), so
 * nothing raises one, and nobody finds a body or searches, before the hull gun fires. Logic only (Game.step, no
 * frames): a long mission, many minutes.
 */
export const timeout = 3_600_000;

export default async function m11Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m11');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m11.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    let firstAlarm = null;
    const aware = [];
    const offs = [
      w.events.on('alarm:zone', (e) => { if (firstAlarm == null) firstAlarm = { t: w.time, event: e.event ?? null }; }),
      w.events.on('enemy:body-found', (e) => aware.push({ t: w.time, line: `${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'}` })),
      w.events.on('enemy:state', (e) => { if (['COMBAT', 'HOLD', 'CHALLENGE', 'SEARCH', 'BODY', 'ALARM_RUN', 'TRACKS'].includes(e.to)) aware.push({ t: w.time, line: `${e.enemy?.tag} ${e.from}->${e.to}` }); }),
    ];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const cps = D.checkpoints;
    const blastAt = cps.find((c) => c.name.startsWith('G2'))?.t ?? null;
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]),
      awareBeforeBlast: aware.filter((a) => blastAt == null || a.t < blastAt - 1).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
      firstAlarm, blastAt,
      checkpoints: cps.map((c) => c.name.split(' ')[0]),
    };
    D.dispose?.();
    return out;
  });
  t.log(`m11 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, killed before the blast ${r.kills.filter((k) => /^(e_g1|e21|e22|e23|e24)$/.test(k)).join(',')}, first alarm ${JSON.stringify(r.firstAlarm)} (hull gun at ${r.blastAt})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.awareBeforeBlast) t.log(`AWARE ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o_rigs: true, o_escape: true }), 'four rigs, then away in the half-track');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all five alive');
  t(r.blastAt != null && r.firstAlarm && r.firstAlarm.t >= r.blastAt - 1, `no alarm before the hull gun fires (${JSON.stringify(r.firstAlarm)})`);
  t.equal(r.awareBeforeBlast.length, 0, 'nobody finds a body, follows tracks, searches or fights before the blasts');
  for (const k of ['A2', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C4', 'D2', 'E2', 'F2', 'F4', 'G2', 'G3', 'H1']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
