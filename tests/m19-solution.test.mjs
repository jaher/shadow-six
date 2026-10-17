/**
 * M19 "Frustrate Retaliation" full solution (tools/solutions/m19.solution.mjs) played in the running game with only
 * player orders: the three V2 rockets (o1) set off by two rifle rounds through the plank palisade into barrels the
 * Green Beret laid (he climbs the palisade on his feet, both ways, timed on the posts' sweeps and the base lorry),
 * then all four out in the rowboat (o2). The game reports a win, no commando is ever spotted /
 * challenged, no vehicle tainted, all four alive — and no commando, nor the rowboat, ever inside a live cone (the
 * exposure watch; user 2026-10-08: "make sure no commando goes inside the field of view of a solider before being
 * spotted. Even the raft boat in the light shaded field of view of a soldier makes the soldier see it"). The only alarm
 * is the blast itself (the base hears explosions within 25 m, and the rockets stand inside it): nothing raises it, and
 * nobody finds a body, before the first barrel goes up. Logic only (Game.step, no frames): a long mission, many minutes.
 */
export const timeout = 3_600_000;

export default async function m19Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m19');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m19.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    let firstAlarm = null;
    const aware = [];
    const offs = [
      w.events.on('alarm:zone', (e) => { if (firstAlarm == null) firstAlarm = { t: w.time, event: e.event ?? null }; }),
      w.events.on('enemy:body-found', (e) => aware.push({ t: w.time, line: `${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'}` })),
      w.events.on('enemy:state', (e) => { if (['COMBAT', 'HOLD', 'CHALLENGE', 'SEARCH', 'BODY', 'ALARM_RUN'].includes(e.to)) aware.push({ t: w.time, line: `${e.enemy?.tag} ${e.from}->${e.to}` }); }),
    ];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const cps = D.checkpoints;
    const blastAt = cps.find((c) => c.name.startsWith('I2'))?.t ?? null;
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
  t.log(`m19 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, killed before the blast ${r.kills.filter((k) => /^(e51|e31|d3|e24|e32)$/.test(k)).join(',')}, first alarm ${JSON.stringify(r.firstAlarm)} (blast at ${r.blastAt})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.awareBeforeBlast) t.log(`AWARE ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'three rockets, then away in the rowboat');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone, nor the boat (exposure watch)');
  t(r.alive, 'all four alive');
  t(r.blastAt != null && r.firstAlarm && r.firstAlarm.t >= r.blastAt - 2, `no alarm before the first barrel goes up (${JSON.stringify(r.firstAlarm)})`);
  t.equal(r.awareBeforeBlast.length, 0, 'nobody finds a body, searches or fights before the blast');
  for (const k of ['A6', 'B4', 'C5', 'D3', 'E2', 'E4', 'F1', 'F2', 'F3', 'G4', 'G6', 'H2', 'I1', 'I3', 'I5']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
