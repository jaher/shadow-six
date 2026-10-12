/**
 * M12 "Up on the Roof" full solution (tools/solutions/m12.solution.mjs) played in the running game with only player
 * orders: the Informer freed (o1) and all four men driven off in the car on the south-east quay (o2), the game reports
 * a win, no alarm anywhere (neither the courtyard siren nor the harbour HQ), no commando ever spotted / challenged /
 * unmasked, the car never tainted, all four alive — and nobody ever inside a live cone (the driver's exposure watch).
 * Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 2_400_000;

export default async function m12Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m12');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m12.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    // the GB and the Sniper start hidden in their hideouts (from the first tick: §7.3 `hideout`)
    const hiddenAtStart = ['greenberet', 'sniper'].every((r) => w.commandos.find((c) => c.role === r)?.hidden);
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const car = w.byId('kubel');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(), hiddenAtStart,
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => e.line),
      found: D.events.filter((e) => e.name === 'enemy:body-found').map((e) => e.line),
      alive: w.commandos.every((c) => c.alive), aboard: w.commandos.filter((c) => c.vehicle === car).length,
      car: car ? { x: car.x, destroyed: !!car.destroyed } : null,
      kills: D.events.filter((e) => e.name === 'unit:killed').length,
      rounds: w.commandos.find((c) => c.role === 'sniper')?.inventory.get('sniperRifle') ?? 0,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
    };
    D.dispose();
    return out;
  });
  t.log(`m12 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills} killed, ${r.rounds} rounds left`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t(r.hiddenAtStart, 'the Green Beret and the Sniper start hidden');
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'the Informer freed, then everyone away in the car');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t.equal(r.alarms.length, 0, `no alarm, north or south (${r.alarms.join(' | ')})`);
  t.equal(r.found.length, 0, `no body found (${r.found.join(' | ')})`);
  t(r.alive, 'all four alive, the Informer too');
  t.equal(r.aboard, 4, 'all four in the car');
  t(r.car && !r.car.destroyed && r.car.x > 70, `the car drove off east (${JSON.stringify(r.car)})`);
  t.equal(r.rounds, 2, 'five sniper rounds spent');
  for (const k of ['A6', 'B6', 'C1', 'D13', 'E3', 'F6', 'G3', 'H6', 'H7']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
