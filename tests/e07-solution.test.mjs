/**
 * LIGHTS OUT e07 "White Out" full solution (tools/solutions/e07.solution.mjs) played in the running game with only
 * player orders, on Hard (the default variant) and on Easy: both packs from the container (o1, o1b), the type plates
 * taken before the hammer could fall (o2), the cornice brought down on the avalanche gallery (o3), Major Vering cuffed
 * at his desk and berthed in the cable car (o4), everyone aboard to the ridge station (o5); the game reports a win.
 * Nobody ever spots, challenges or finds a body, no zone fires before the cornice charge goes up (the team is then at
 * the cable's foot), nobody is ever inside a live cone (the driver's exposure watch). Logic only (Game.step, no frames).
 */
export const timeout = 2_400_000;

async function play(page, difficulty) {
  return page.evaluate(async (diff) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = diff;
    await G.loadMission('e07');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e07.solution.mjs');
    const w = G.game.world, enemies0 = w.enemies.length;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, blast = null;
    w.events.on('explosion', () => { if (blast == null) blast = w.time; });
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    const alarms = D.events.filter((e) => e.name === 'alarm:zone');
    const car = w.byId('cablecar'), ver = w.enemies.find((e) => e.tag === 'vering');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])), blastT: blast,
      enemies: enemies0, missionOver: w.missionOver ?? null, scriptFail: w.scriptFail ?? null,
      alarmsBefore: alarms.filter((e) => blast == null || e.t < blast - 1e-6).map((e) => `${e.t.toFixed(1)} ${e.line}`),
      found: D.events.filter((e) => e.name === 'enemy:body-found' && (blast == null || e.t < blast - 1e-6)).map((e) => e.line),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      aboard: w.commandos.every((c) => c.vehicle === car) && !!ver?.alive && car?.occupants?.includes(ver),
      // (the win fires as the cabin docks: within the extraction's ring at the ridge station's berth, up on the ridge)
      atRidge: !!car && Math.hypot(car.x - w.mission.extraction.exit.x, car.z - w.mission.extraction.exit.z) <= (w.mission.extraction.exit.r ?? 3) + 0.5 && (car.y ?? 0) > 29,
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      team: w.commandos.map((c) => `${c.role}@${c.x.toFixed(1)},${c.z.toFixed(1)},y${(c.y || 0).toFixed(1)} ${c.state} ${c.stance}`),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e07Solution(page, t) {
  // (counts with the hamlet's five hens)
  for (const [difficulty, count] of [['hard', 48], ['easy', 41]]) {
    const r = await play(page, difficulty);
    t.log(`e07 ${difficulty}: ${r.state} (${JSON.stringify(r.objectives)}, over ${JSON.stringify(r.missionOver)}) at t=${r.time.toFixed(1)} s (cornice at ${r.blastT?.toFixed?.(1)}), detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join('; ')}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    if (r.error) t.log(`ERROR ${r.error} | ${r.team.join(' | ')} | cps ${r.checkpoints.join(',')}`);
    t.equal(r.enemies, count, `${difficulty}: ${count} units`);
    t.equal(r.error, null, `${difficulty}: solution ran to the end`);
    t.equal(r.scriptFail, null, `${difficulty}: no scripted loss (plates, Vering, the flak)`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o1b: true, o2: true, o3: true, o4: true, o5: true }), `${difficulty}: packs, plates, pass closed, Vering aboard, everyone up`);
    t.equal(r.state, 'won', `${difficulty}: the game reports the win`);
    t.equal(r.detections, 0, `${difficulty}: never spotted, challenged or unmasked`);
    t.equal(r.exposures.length, 0, `${difficulty}: never inside a live cone (exposure watch)`);
    t.equal(r.alarmsBefore.length, 0, `${difficulty}: no alarm before the cornice charge (${r.alarmsBefore.join(' | ')})`);
    t.equal(r.found.length, 0, `${difficulty}: no body found (${r.found.join(' | ')})`);
    t(r.alive, `${difficulty}: all five alive`);
    t(r.aboard, `${difficulty}: the five and the Major aboard the cabin`);
    t(r.atRidge, `${difficulty}: the cabin at the ridge station`);
    for (const k of ['A2', 'A4', 'B2', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B12', 'B13', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3']) t(r.checkpoints.includes(k), `${difficulty}: checkpoint ${k}`);
  }
}
