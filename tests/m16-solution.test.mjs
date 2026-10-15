/**
 * M16 "Stop Wildfire" full solution (tools/solutions/m16.solution.mjs) played in the running game with only player
 * orders: the four sappers dead before any of them reaches a plunger (o1) and all three men in the lorry (o2), the
 * game reports a win, no commando ever spotted / challenged / unmasked, the lorry never tainted, all three alive,
 * nobody ever inside a live cone (the driver's exposure watch), and no siren and no body found until the last sapper
 * is dead (the one alarm comes after o1, when e15's body at the bridgehead is seen: dossier §9 / §12 Phase 5).
 * Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 2_400_000;

export default async function m16Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m16');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m16.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let o1At = null;
    const off = w.events.on?.('objective', (p) => { if (p?.id === 'o1' && p.status === 'done' && o1At === null) o1At = w.time; });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    if (typeof off === 'function') off();
    const truck = w.byId('truck');
    const cp = (id) => D.checkpoints.find((c) => c.name.split(' ')[0] === id)?.t ?? null;
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      o1At: o1At ?? cp('E5'),
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      found: D.events.filter((e) => e.name === 'enemy:body-found').map((e) => ({ t: e.t, line: e.line })),
      alive: w.commandos.every((c) => c.alive), aboard: w.commandos.filter((c) => c.vehicle === truck).length,
      truck: truck ? { destroyed: !!truck.destroyed, tainted: !!truck.tainted } : null,
      sappers: ['e14', 'e15', 'e16', 'e17'].map((tag) => w.enemies.find((e) => e.tag === tag)?.alive),
      rounds: w.commandos.find((c) => c.role === 'sniper')?.inventory.get('sniperRifle') ?? 0,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
    };
    D.dispose();
    return out;
  });
  t.log(`m16 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, o1 at ${r.o1At?.toFixed?.(1)}, ${r.rounds} rounds left, alarms ${r.alarms.map((a) => `${a.t.toFixed(1)} ${a.line}`).join(' | ')}`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'the four sappers dead, then everyone in the lorry');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.o1At !== null, 'o1 done');
  // (the last sapper's fall raises its siren in the tick he dies, a tick before the objective is marked done)
  const early = r.alarms.filter((a) => a.t < r.o1At - 0.25);
  t.equal(early.length, 0, `no alarm before the last sapper is dead (${early.map((a) => a.line).join(' | ')})`);
  const foundEarly = r.found.filter((f) => f.t < r.o1At - 0.25);
  t.equal(foundEarly.length, 0, `no body found before the last sapper is dead (${foundEarly.map((f) => f.line).join(' | ')})`);
  t(r.sappers.every((a) => a === false), 'e14, e15, e16, e17 dead');
  t(r.alive, 'all three alive');
  t.equal(r.aboard, 3, 'all three in the lorry');
  t(r.truck && !r.truck.destroyed, 'the lorry intact');
  for (const k of ['A5', 'B3', 'C3', 'D2', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
