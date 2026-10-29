/**
 * M5 "Blind Justice" full solution (tools/solutions/m05.solution.mjs) played in the running game with only player
 * orders: the Green Beret knifes e4; the Spy takes the uniform off the clothesline behind e8, injects e8 and holds the
 * camp patrol in talk while the Green Beret crawls through the camp to the foot of the massif; the Spy rides the cable
 * car up past the lift guards, injects e14, e15, e16 and e17 on the summit and holds Patrol 18 in talk while the Green
 * Beret climbs the east cliff behind Patrol 19's back and carries drum b2 into the middle of the summit. The Spy's two shots blow drum b1 at the barracks (o2: the barracks goes up,
 * Patrol 18 with it) and then b2 (o1: the radar), and both men fly out in the autogyro (o3). The game reports a win; no
 * commando is ever spotted, challenged or unmasked, and none is ever inside a live cone (the driver's exposure watch;
 * user 2026-10-08: "make sure no commando goes inside the field of view of a solider before being spotted"). The only
 * alarm is the blast's own (on this map every explosion is heard everywhere and the whole map is one zone; only a
 * drum's blast brings down the radar): before it nobody finds a body, follows tracks, investigates, searches or fights.
 * Logic only (Game.step, no frames): a few minutes.
 */
export const timeout = 1_800_000;

export default async function m05Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m05');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m05.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let firstAlarm = null, blast = null;
    const aware = [];
    const offs = [
      w.events.on('alarm:zone', (e) => { if (firstAlarm == null) firstAlarm = { t: w.time, event: e.event ?? null }; }),
      w.events.on('structure:destroyed', () => { if (blast == null) blast = w.time; }),
      w.events.on('enemy:body-found', (e) => aware.push({ t: w.time, line: `${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'}` })),
      w.events.on('enemy:state', (e) => { if (['INVESTIGATE', 'TRACKS', 'BODY', 'SEARCH', 'CHALLENGE', 'HOLD', 'COMBAT', 'ALARM_RUN'].includes(e.to)) aware.push({ t: w.time, line: `${e.enemy?.tag} ${e.from}->${e.to}` }); }),
    ];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]),
      awareBefore: aware.filter((a) => blast == null || a.t < blast - 1e-6).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
      firstAlarm, blast,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
    };
    D.dispose?.();
    return out;
  });
  t.log(`m05 solution: ${r.state} at t=${r.time.toFixed(1)} s (blast at ${r.blast?.toFixed?.(1)}), detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join(', ')}; first alarm ${JSON.stringify(r.firstAlarm)}`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.awareBefore) t.log(`AWARE ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'the radar and the barracks destroyed, then away in the autogyro');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or unmasked');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'both alive');
  t(r.blast != null && r.firstAlarm && r.firstAlarm.t >= r.blast - 1e-6, `no alarm before the barracks blast (${JSON.stringify(r.firstAlarm)}, blast ${r.blast})`);
  t.equal(r.awareBefore.length, 0, 'before the blast nobody finds a body, follows tracks, investigates, searches or fights');
  t.equal([...r.kills].sort().join(','), 'e14,e15,e16,e17,e4,e8,p18a,p18b,p18c', 'e4 knifed, e8 and e14-e17 injected, Patrol 18 in the barracks blast');
  t.equal(r.checkpoints.join(' '), 'A1 A2 B1 B2 B3 C1 C2 C3 C4 D1 D2 D3 E1 E2 E3 E4 F1 F2 F3 G1 G2 G3 H1 H2 H3 H4 H5', 'every checkpoint, in order');
}
