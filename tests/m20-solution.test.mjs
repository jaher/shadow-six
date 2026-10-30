/**
 * M20 "Operation Valhalla" full solution (tools/solutions/m20.solution.mjs) played in the running game with only player
 * orders: the Green Beret climbs the west wall and clears a way down through the terraces and the south court, the
 * Sniper comes round outside and takes the walker on the SW wall, the gate's rear pair go, three men slip in over the
 * bridge, the N range roof is cleared (knife and rifle), the Sapper's charge goes against the headquarters, Patrol 57 is
 * parked staring at the decoy, the AT gunner is shot, four men climb into the Panzer III by their hatches unseen; the
 * charge brings the headquarters down (o1), the tank's gun the two V2s (o2), and the tank leaves by the SW gate with the
 * Spy and the Marine picked up on the way (o3). The game reports a win, no commando is ever spotted / challenged, no
 * vehicle tainted, all six alive — and no commando ever inside a live cone (the exposure watch; user 2026-10-08: "make
 * sure no commando goes inside the field of view of a solider before being spotted"). The only alarm is the charge
 * itself (no charge goes off unheard): nothing raises it, and nobody finds a body, before it goes up. Logic only
 * (Game.step, no frames): a very long mission.
 */
export const timeout = 5_400_000;

export default async function m20Solution(page, t) {
  page.setDefaultTimeout(5_000_000);
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m20');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m20.solution.mjs');
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
    const blastAt = cps.find((c) => c.name.startsWith('M7'))?.t ?? null;
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
  t.log(`m20 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills.length} down (${r.kills.join(' ')}), first alarm ${JSON.stringify(r.firstAlarm)} (charge at ${r.blastAt})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.awareBeforeBlast) t.log(`AWARE ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'the headquarters, both rockets, then away in the tank');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all six alive');
  t(r.blastAt != null && r.firstAlarm && r.firstAlarm.t >= r.blastAt - 1, `no alarm before the charge goes up (${JSON.stringify(r.firstAlarm)})`);
  t.equal(r.awareBeforeBlast.length, 0, 'nobody finds a body, searches or fights before the charge');
  for (const k of ['A3', 'B3', 'C3', 'D3', 'E4', 'E6', 'F5', 'G3', 'I1', 'J3', 'K2', 'L4', 'M1', 'M6', 'M7', 'M8', 'M9']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
