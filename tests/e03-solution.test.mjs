/**
 * LIGHTS OUT e03 "Winter Quarters" full solution (tools/solutions/e03.solution.mjs) played in the running game with
 * only player orders, on Hard (the default variant) and on Easy: the key-table binder taken from the chief's table
 * (o1), the main mast's remote charge fired from the far bank (o2) and the whole team over the Elbe on the rope ferry
 * (o3); the game reports a win. Nobody ever spots, challenges or finds a body, no zone fires before the mast comes
 * down (the only alarm is the charge, with the punt at the far bank), and nobody is ever inside a live cone (the
 * driver's exposure watch). The first puppet of the campaign is used (the cuffed sergeant on strings talks to the door
 * sentry) and the Spy wears both uniforms (a private's tunic, the trainer's coat).
 * Logic only (Game.step, no frames): several minutes per variant.
 */
export const timeout = 2_400_000;

async function play(page, difficulty) {
  return page.evaluate(async (diff) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = diff;
    await G.loadMission('e03');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e03.solution.mjs');
    const w = G.game.world, enemies0 = w.enemies.length;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, blast = null, puppet = null;
    w.events.on('explosion', () => { if (blast == null) blast = w.time; });
    w.events.on('bcd:puppet', (p) => { if (p.on && !puppet) puppet = { unit: p.unit?.role, puppet: p.puppet?.tag }; });
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    const alarms = D.events.filter((e) => e.name === 'alarm:zone');
    const spy = w.commandos.find((c) => c.role === 'spy');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])), blastT: blast,
      enemies: enemies0, missionOver: w.missionOver ?? null, puppet,
      wardrobe: [...(spy?.wardrobe || [])],
      alarmsBefore: alarms.filter((e) => blast == null || e.t < blast - 1e-6).map((e) => `${e.t.toFixed(1)} ${e.line}`),
      found: D.events.filter((e) => e.name === 'enemy:body-found' && (blast == null || e.t < blast - 1e-6)).map((e) => e.line),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => ({ t: e.t, line: e.line })),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      team: w.commandos.map((c) => `${c.role}@${c.x.toFixed(1)},${c.z.toFixed(1)} ${c.state} ${c.stance}`),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e03Solution(page, t) {
  // (the counts include the animals: 3 lions, 4 ostriches, 5 hens)
  for (const [difficulty, count] of [['hard', 45], ['easy', 40]]) {
    const r = await play(page, difficulty);
    const killed = r.kills.map((k) => `${k.t.toFixed(1)} ${k.line}`).join('; ');
    t.log(`e03 ${difficulty}: ${r.state} (${JSON.stringify(r.objectives)}, over ${JSON.stringify(r.missionOver)}) at t=${r.time.toFixed(1)} s (charge at ${r.blastT?.toFixed?.(1)}), detections ${r.detections}, exposures ${r.exposures.length}, kills: ${killed}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    if (r.error) t.log(`ERROR ${r.error} | ${r.team.join(' | ')} | cps ${r.checkpoints.join(',')}`);
    t.equal(r.enemies, count, `${difficulty}: ${count} enemies and animals`);
    t.equal(r.error, null, `${difficulty}: solution ran to the end`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), `${difficulty}: binder, main mast, everyone over the Elbe`);
    t.equal(r.state, 'won', `${difficulty}: the game reports the win`);
    t.equal(r.detections, 0, `${difficulty}: never spotted, challenged or unmasked`);
    t.equal(r.exposures.length, 0, `${difficulty}: never inside a live cone (exposure watch)`);
    t.equal(r.alarmsBefore.length, 0, `${difficulty}: no alarm before the mast comes down (${r.alarmsBefore.join(' | ')})`);
    t.equal(r.found.length, 0, `${difficulty}: no body found (${r.found.join(' | ')})`);
    // (each death timed against the charge: none before it, none after its blast and the mast's fall — a man shot or
    // knifed on the way would show here even though a blast happened later)
    t(r.blastT != null && r.kills.every((k) => k.t >= r.blastT - 1e-6 && k.t <= r.blastT + 10), `${difficulty}: the only deaths are the charge's, at or after it (charge at ${r.blastT?.toFixed?.(1)}; ${killed || 'none'})`);
    t(r.alive, `${difficulty}: all four alive`);
    t.equal(JSON.stringify(r.puppet), JSON.stringify({ unit: 'greenberet', puppet: 't1' }), `${difficulty}: the sergeant on strings (the campaign's first puppet)`);
    t(r.wardrobe.includes('soldier') && r.wardrobe.includes('zookeeper'), `${difficulty}: the Spy holds the private's tunic and the trainer's coat (${r.wardrobe.join(',')})`);
    // (E3 only when the chief is already walking home after the door: the binder then waits for him to be down)
    for (const k of ['A2', 'A3', 'B2', 'B5', 'B7', 'B8', 'B9', 'B10', 'B11', 'C1', 'C2', 'D1', 'D2', 'D4', 'D5', 'D6', 'D7', 'D8', 'E1', 'E2', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'G2', 'G3', 'G4']) t(r.checkpoints.includes(k), `${difficulty}: checkpoint ${k}`);
  }
}
