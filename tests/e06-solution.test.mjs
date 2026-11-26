/**
 * LIGHTS OUT e06 "Thin Ice" full solution (tools/solutions/e06.solution.mjs) played in the running game with only
 * player orders, on Hard (the garrison of 41) and then on Easy (33): the searchlight crew out (o2), the link-span lowered
 * by its own door sentry on puppet strings, the sealed wagon pushed over it into the harbour (o1), everyone — Grethe
 * too — over the sea ice to the boats (o3); the game reports a win. No alarm ever sounds, nobody ever spots, challenges
 * or finds a man down, the span master never raises the span again, the shunting engine never pulls out, no fishing
 * family is touched, and nobody is ever inside a live cone (the driver's exposure watch).
 * Logic only (Game.step, no frames): several minutes per difficulty.
 */
export const timeout = 3_600_000;

const STAGES = ['A1', 'A3', 'A4', 'A5', 'A7', 'A8', 'A9', 'A10', 'B1', 'B2', 'B3', 'C1', 'C2', 'D1', 'D2', 'D3', 'E1', 'E2', 'F1', 'F2'];

async function play(page, difficulty) {
  return page.evaluate(async (difficulty) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = difficulty;
    await G.loadMission('e06');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e06.solution.mjs');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, reraised = false, shunted = false, spanDownAt = null;
    w.events.on('message', (m) => {
      if (/raising the link-span/.test(m?.text || '')) reraised = true;
      if (/shunting engine is pulling out/.test(m?.text || '')) shunted = true;
    });
    w.events.on('device', (d) => { if (d.id === 'span' && d.on === false && spanDownAt == null) spanDownAt = w.time; });
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      enemies: w.enemies.filter((e) => e.soldierType !== 'pow').length,
      families: w.enemies.filter((e) => e.soldierType === 'pow').map((e) => e.alive),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alarms: D.events.filter((e) => e.name === 'alarm:zone' || e.name === 'alarm:start').map((e) => `${e.t.toFixed(1)} ${e.line}`),
      found: D.events.filter((e) => e.name === 'enemy:ko-found' || e.name === 'enemy:body-found').map((e) => e.line),
      reraised, shunted, spanDownAt,
      wagonDropped: !!w.interactables.find((i) => (i.tag ?? i.id) === 'wag_n')?.dropped,
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      team: w.commandos.map((c) => `${c.role}@${c.x.toFixed(1)},${c.z.toFixed(1)} ${c.state} ${c.stance}`),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e06Solution(page, t) {
  for (const [difficulty, n, crew] of [['hard', 41, 3], ['easy', 33, 2]]) {
    const r = await play(page, difficulty);
    t.log(`e06 solution (${difficulty}): ${r.state} at t=${r.time.toFixed(1)} s, ${r.enemies} enemies, detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join('; ')}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    if (r.error) t.log(`ERROR ${r.error} | ${r.team.join(' | ')} | cps ${r.checkpoints.join(',')}`);
    t.equal(r.error, null, `${difficulty}: solution ran to the end`);
    t.equal(r.enemies, n, `${difficulty}: the garrison of ${n}`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), `${difficulty}: the wagon in the harbour, the searchlight out, everyone at the boats`);
    t.equal(r.state, 'won', `${difficulty}: the game reports the win`);
    t.equal(r.detections, 0, `${difficulty}: never spotted, challenged or unmasked`);
    t.equal(r.exposures.length, 0, `${difficulty}: never inside a live cone (exposure watch)`);
    t.equal(r.alarms.length, 0, `${difficulty}: no alarm (${r.alarms.join(' | ')})`);
    t.equal(r.found.length, 0, `${difficulty}: nobody finds a man down (${r.found.join(' | ')})`);
    t(r.wagonDropped, `${difficulty}: the sealed wagon went off the span's end`);
    t(!r.reraised, `${difficulty}: the span master never raises the span again`);
    t(!r.shunted, `${difficulty}: the shunting engine never pulls out`);
    t(r.families.length === 8 && r.families.every(Boolean), `${difficulty}: every one of the 8 fishing-family civilians unharmed`);
    t(r.alive, `${difficulty}: everyone alive`);
    t.equal(r.kills.length, crew, `${difficulty}: the searchlight crew the only dead (${r.kills.join('; ')})`);
    for (const k of STAGES) t(r.checkpoints.includes(k), `${difficulty}: checkpoint ${k}`);
  }
}
