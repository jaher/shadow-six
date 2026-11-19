/**
 * LIGHTS OUT e04 "Black Rain" full solution (tools/solutions/e04.solution.mjs) played in the running game with only
 * player orders, on Hard (the default variant) and on Easy: the bearing archive taken (o1), the DF hut (o2) and both
 * DF lorries (o3) blown by remote, and the whole team down the heap's far side (o4); the game reports a win. Nobody
 * ever spots, challenges or finds a body, no zone fires before the detonations (the only alarm is the charges going
 * up, with the team already in the exit pocket), and nobody is ever inside a live cone (the driver's exposure watch).
 * Logic only (Game.step, no frames): several minutes per variant.
 */
export const timeout = 2_400_000;

async function play(page, difficulty) {
  return page.evaluate(async (diff) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = diff;
    await G.loadMission('e04');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e04.solution.mjs');
    const w = G.game.world, enemies0 = w.enemies.length;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, blast = null;
    w.events.on('explosion', () => { if (blast == null) blast = w.time; });
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    const alarms = D.events.filter((e) => e.name === 'alarm:zone');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])), blastT: blast,
      enemies: enemies0, missionOver: w.missionOver ?? null,
      alarmsBefore: alarms.filter((e) => blast == null || e.t < blast - 1e-6).map((e) => `${e.t.toFixed(1)} ${e.line}`),
      found: D.events.filter((e) => e.name === 'enemy:body-found' && (blast == null || e.t < blast - 1e-6)).map((e) => e.line),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line),
      skipUp: w.interactables.find((i) => (i.tag ?? i.id) === 'incline')?.at,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      team: w.commandos.map((c) => `${c.role}@${c.x.toFixed(1)},${c.z.toFixed(1)},y${(c.y || 0).toFixed(1)} ${c.state} ${c.stance}`),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e04Solution(page, t) {
  // (the two DF lorry drivers sleep in their cabs: the lorries' crews, not in world.enemies)
  for (const [difficulty, count] of [['hard', 32], ['easy', 25]]) {
    const r = await play(page, difficulty);
    t.log(`e04 ${difficulty}: ${r.state} (${JSON.stringify(r.objectives)}, over ${JSON.stringify(r.missionOver)}) at t=${r.time.toFixed(1)} s (first charge at ${r.blastT?.toFixed?.(1)}), detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join('; ')}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    if (r.error) t.log(`ERROR ${r.error} | ${r.team.join(' | ')} | cps ${r.checkpoints.join(',')}`);
    t.equal(r.enemies, count, `${difficulty}: ${count} enemies`);
    t.equal(r.error, null, `${difficulty}: solution ran to the end`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true, o4: true }), `${difficulty}: archive, DF hut, both lorries, everyone out`);
    t.equal(r.state, 'won', `${difficulty}: the game reports the win`);
    t.equal(r.detections, 0, `${difficulty}: never spotted, challenged or unmasked`);
    t.equal(r.exposures.length, 0, `${difficulty}: never inside a live cone (exposure watch)`);
    t.equal(r.alarmsBefore.length, 0, `${difficulty}: no alarm before the charges go up (${r.alarmsBefore.join(' | ')})`);
    t.equal(r.found.length, 0, `${difficulty}: no body found (${r.found.join(' | ')})`);
    t(r.alive, `${difficulty}: all four alive`);
    t.equal(r.skipUp, 1, `${difficulty}: the skip went up the heap (the winch worked by the puppet)`);
    for (const k of ['A1', 'B1', 'C1', 'D3', 'E1', 'E2', 'F1', 'G2', 'H1', 'H2', 'I1', 'I2', 'J1', 'J2', 'J3', 'J4', 'K1', 'K2']) t(r.checkpoints.includes(k), `${difficulty}: checkpoint ${k}`);
  }
}
