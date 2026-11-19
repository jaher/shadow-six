/**
 * LIGHTS OUT e02 "Curfew" full solution (tools/solutions/e02.solution.mjs) played in the running game with only
 * player orders, on Hard (the full garrison of 30) and then on Easy (21): the bearings log taken (o1), the searchlight
 * out (o2), Captain Hollis free (o3), everyone — Hollis and Tonino too — in the aqueduct cistern (o4); the game reports
 * a win. No alarm ever sounds, nobody ever spots, challenges or finds a man down, the van never starts, and nobody is
 * ever inside a live cone (the driver's exposure watch).
 * Logic only (Game.step, no frames): several minutes per difficulty.
 */
export const timeout = 3_600_000;

const STAGES = ['A1', 'B1', 'C1', 'D3', 'D4', 'E2', 'E3', 'E4', 'F1', 'G2', 'H1', 'I2', 'I3', 'I4', 'J1', 'J2', 'J3', 'J4'];

async function play(page, difficulty) {
  return page.evaluate(async (difficulty) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = difficulty;
    await G.loadMission('e02');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e02.solution.mjs');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, vanArmed = false;
    w.events.on('message', (m) => { if (/engine coughs|leaving with the bearings log/.test(m?.text || '')) vanArmed = true; });
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      // (the garrison: the men on the map and the second van's crew [H], folded into it: schema.foldVehicleCrews)
      enemies: w.enemies.filter((e) => e.soldierType !== 'pow').length + w.vehicles.reduce((n, v) => n + (v.crew?.length || v.def?.crew?.length || 0), 0),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alarms: D.events.filter((e) => e.name === 'alarm:zone' || e.name === 'alarm:start').map((e) => `${e.t.toFixed(1)} ${e.line}`),
      found: D.events.filter((e) => e.name === 'enemy:ko-found' || e.name === 'enemy:body-found').map((e) => e.line),
      vanArmed,
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e02Solution(page, t) {
  for (const [difficulty, n] of [['hard', 30], ['easy', 21]]) {
    const r = await play(page, difficulty);
    t.log(`e02 solution (${difficulty}): ${r.state} at t=${r.time.toFixed(1)} s, ${r.enemies} enemies, detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join('; ')}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    if (r.error) t.log(`ERROR ${r.error}`);
    t.equal(r.error, null, `${difficulty}: solution ran to the end`);
    t(r.enemies === n || r.enemies === n - 2, `${difficulty}: the garrison of ${n} (${r.enemies} counted on the map and in the vans)`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true, o4: true }), `${difficulty}: log, searchlight, Hollis, everyone in the cistern`);
    t.equal(r.state, 'won', `${difficulty}: the game reports the win`);
    t.equal(r.detections, 0, `${difficulty}: never spotted, challenged or unmasked`);
    t.equal(r.exposures.length, 0, `${difficulty}: never inside a live cone (exposure watch)`);
    t.equal(r.alarms.length, 0, `${difficulty}: no alarm (${r.alarms.join(' | ')})`);
    t.equal(r.found.length, 0, `${difficulty}: nobody finds a man down (${r.found.join(' | ')})`);
    t(!r.vanArmed, `${difficulty}: the van never starts`);
    t(r.alive, `${difficulty}: everyone alive`);
    t.equal(r.kills.length, 1, `${difficulty}: one shot fired, the searchlight crew (${r.kills.join('; ')})`);
    for (const k of STAGES) t(r.checkpoints.includes(k), `${difficulty}: checkpoint ${k}`);
  }
}
