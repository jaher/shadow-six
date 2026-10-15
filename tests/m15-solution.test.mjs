/**
 * M15 "The End of the Butcher" full solution (tools/solutions/m15.solution.mjs) played in the running game with only
 * player orders: the HQ brought down by the tram hitting the tanker (o2, an accident: no alarm), the general shot at
 * the corner of his garden (o1) and everyone out in the van by the north-west road (o3); the game reports a win, no
 * commando ever spotted / challenged, the Spy never unmasked, no vehicle tainted, all four alive — and no commando ever
 * inside a live cone (the driver's exposure watch). The only alarm is the one the mission forces: the general's body is
 * found (and his death seen) after he is dead. Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 3_600_000;

export default async function m15Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m15');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m15.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    let error = null, alarmAt = null, hqAt = null, generalAt = null;
    const offs = [
      w.events.on('alarm:zone', () => { if (alarmAt == null) alarmAt = w.time; }),
      w.events.on('structure:destroyed', (p) => { if ((p.id ?? p.structure?.id) === 'hq' && hqAt == null) hqAt = w.time; }),
      w.events.on('unit:killed', (p) => { if (p.unit?.tag === 'schleper' && generalAt == null) generalAt = w.time; }),
    ];
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      tainted: w.vehicles.filter((v) => v.tainted).map((v) => v.vehicleType),
      kills: D.events.filter((e) => e.name === 'unit:killed').length,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      alarmAt, hqAt, generalAt,
    };
    D.dispose();
    return out;
  });
  t.log(`m15 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills} killed, HQ down at ${r.hqAt}, general dead at ${r.generalAt}, first alarm ${r.alarmAt}`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'general, HQ, then out in the van');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all four alive');
  t.equal(r.tainted.length, 0, `no vehicle tainted (${r.tainted.join(',')})`);
  t(r.hqAt != null && r.generalAt != null && r.hqAt < r.generalAt, `the HQ goes down (the tram accident) before the general dies (hq ${r.hqAt}, general ${r.generalAt})`);
  t(r.alarmAt == null || (r.generalAt != null && r.alarmAt >= r.generalAt), `no alarm while the general lives (first alarm ${r.alarmAt}, general dead at ${r.generalAt})`);
  for (const k of ['A4', 'B2', 'C2', 'D2', 'E3', 'F1', 'F4', 'G2', 'H4', 'H5', 'I2', 'I5', 'J3', 'J5']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
