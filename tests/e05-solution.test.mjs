/**
 * LIGHTS OUT e05 "Cold Iron" full solution (tools/solutions/e05.solution.mjs) played in the running game with only
 * player orders, on Hard (the default variant) and on Easy: the call-sign book (o3), the drawbridge up with its keeper
 * bound (o4), Grethe reached (o2), the card index (o1) and everyone with Grethe back at the folboats (o5); the game
 * reports a win. Nobody ever spots, challenges or finds a body, no alarm zone ever fires, nobody is killed, and nobody
 * is ever inside a live cone (the driver's exposure watch). Logic only (Game.step, no frames): several minutes per
 * variant.
 */
export const timeout = 2_400_000;

async function play(page, difficulty) {
  return page.evaluate(async (diff) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = diff;
    await G.loadMission('e05');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e05.solution.mjs');
    const w = G.game.world, enemies0 = w.enemies.length;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null;
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    const item = (id) => w.interactables.find((i) => (i.tag ?? i.id) === id);
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      enemies: enemies0, missionOver: w.missionOver ?? null,
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => `${e.t.toFixed(1)} ${e.line}`),
      found: D.events.filter((e) => e.name === 'enemy:body-found').map((e) => e.line),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line),
      bridgeUp: !!item('drawbridge')?.raised,
      keeper: w.enemies.find((e) => e.tag === 'k1')?.ko ?? null,
      spy: `${w.commandos.find((c) => c.role === 'spy')?.uniformType ?? '-'}`,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      team: w.commandos.map((c) => `${c.role}@${c.x.toFixed(1)},${c.z.toFixed(1)},y${(c.y || 0).toFixed(1)} ${c.state} ${c.stance}`),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e05Solution(page, t) {
  for (const [difficulty, count] of [['hard', 37], ['easy', 30]]) {
    const r = await play(page, difficulty);
    t.log(`e05 ${difficulty}: ${r.state} (${JSON.stringify(r.objectives)}, over ${JSON.stringify(r.missionOver)}) at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join('; ')}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    if (r.error) t.log(`ERROR ${r.error} | ${r.team.join(' | ')} | cps ${r.checkpoints.join(',')}`);
    t.equal(r.enemies, count, `${difficulty}: ${count} enemies`);
    t.equal(r.error, null, `${difficulty}: solution ran to the end`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true, o4: true, o5: true }), `${difficulty}: index, Grethe, call-sign book, bridge up, everyone out`);
    t.equal(r.state, 'won', `${difficulty}: the game reports the win`);
    t.equal(r.detections, 0, `${difficulty}: never spotted, challenged or unmasked`);
    t.equal(r.exposures.length, 0, `${difficulty}: never inside a live cone (exposure watch)`);
    t.equal(r.alarms.length, 0, `${difficulty}: no alarm (${r.alarms.join(' | ')})`);
    t.equal(r.found.length, 0, `${difficulty}: no body found (${r.found.join(' | ')})`);
    t.equal(r.kills.length, 0, `${difficulty}: nobody killed (${r.kills.join(' | ')})`);
    t(r.alive, `${difficulty}: the whole team alive`);
    t(r.bridgeUp, `${difficulty}: the drawbridge stays up`);
    t.equal(r.keeper, 'bound', `${difficulty}: its keeper bound`);
    t.equal(r.spy, 'officer', `${difficulty}: the Spy leaves in the adjutant's tunic`);
    for (const k of ['A1', 'A2', 'A4', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'D1', 'D2', 'D5', 'D6', 'E1', 'E2', 'E3', 'F1', 'F2', 'F3', 'G1', 'G2', 'G3', 'G4', 'G5']) t(r.checkpoints.includes(k), `${difficulty}: checkpoint ${k}`);
    // the Kriminalrat and Grethe: at once when he sits at his desk as the Green Beret comes in (D3, D4); when he is out on
    // his round, after one or both door guards, as soon as he sits down again (D7, D8)
    const cp = (k) => r.checkpoints.includes(k);
    t((cp('D3') && cp('D4') && !cp('D7')) || (cp('D7') && cp('D8') && !cp('D3')), `${difficulty}: the Kriminalrat and Grethe, before or after the door guards (${r.checkpoints.filter((k) => k[0] === 'D').join(',')})`);
  }
}
