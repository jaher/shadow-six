/**
 * M1 "Baptism of Fire" full stealth solution (tools/solutions/m01.solution.mjs) played in the running game with only
 * player orders: the relay station (o1) destroyed with a fuel drum the Green Beret carries to it and sets off with
 * his pistol, the game reports a win, no commando ever spotted / challenged / unmasked, no raft tainted or shot, all
 * three alive — and no commando (nor the raft's crew, nor the used raft lying empty) ever inside a live cone where its
 * rule sees him (driver exposure watch, user 2026-10-08: "make sure no commando goes inside the field of view of a
 * solider before being spotted. Even the raft boat in the light shaded field of view of a soldier makes the soldier
 * see it"). Logic only (Game.step, no frames; the driver plans each sneak): a few minutes.
 */
export const timeout = 900_000;

export default async function m01Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m01');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m01.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const drum = G.game.world.interactables.find((i) => i.tag === 'b4' || i.spawn?.id === 'b4' || i.def?.id === 'b4');
    // as M3 (tests/m03-solution.test.mjs): until the drum goes up no guard may know anything happened — none fights,
    // searches, finds a body or raises an alarm — nor follows a boot print or looks into a noise (verifier, M1 fix
    // round 2: the Green Beret's print where he stepped up the beach drew e4 and the whole p3 patrol to his dig)
    const W = G.game.world, aware = [], curious = [];
    let blastT = null;
    const offs = [
      W.events.on('explosion', (e) => { if (blastT == null && !e.cosmetic) blastT = W.time; }),
      W.events.on('enemy:state', (e) => {
        if (['COMBAT', 'HOLD', 'CHALLENGE', 'ARREST', 'SEARCH', 'BODY', 'ALARM_RUN'].includes(e.to)) aware.push({ t: W.time, line: `${e.enemy?.tag} ${e.from}->${e.to}` });
        else if (['TRACKS', 'INVESTIGATE'].includes(e.to)) curious.push({ t: W.time, line: `${e.enemy?.tag} ${e.from}->${e.to} @${e.enemy.x.toFixed(0)},${e.enemy.z.toFixed(0)}` });
      }),
      W.events.on('enemy:body-found', (e) => aware.push({ t: W.time, line: `${e.enemy?.tag} found a body` })),
      W.events.on('alarm:zone', (e) => aware.push({ t: W.time, line: `alarm ${e.zone?.id ?? e.zone}` })),
    ];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const w = G.game.world;
    for (const off of offs) off?.();
    D.dispose();
    const before = (a) => blastT == null || a.t < blastT - 1e-6; // (the blast raises its zones in the same tick)
    return {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]).sort(),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      drumExploded: !!drum && !!(drum.exploded || drum.destroyed || drum.removed),
      drumAt: drum ? [+drum.x.toFixed(1), +drum.z.toFixed(1)] : null,
      bodiesFound: D.events.filter((e) => e.name === 'enemy:body-found').length,
      raftShots: D.events.filter((e) => e.name === 'shot' && /raft/.test(e.line)).length,
      blastT, aware: aware.filter(before).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
      curious: curious.filter(before).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
    };
  });
  t.log(`m01 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, kills ${r.kills.join(',')}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true }), 'relay station destroyed');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, `never inside a live cone where it sees him${r.exposures.length ? ': ' + r.exposures.slice(0, 6).join(' | ') : ''}`);
  t(r.alive, 'all three alive');
  t.equal(r.raftShots, 0, 'nobody shoots at the raft');
  t.equal(r.bodiesFound, 0, 'nobody finds a body');
  t(r.blastT != null, 'the drum went up');
  t.equal(r.aware.length, 0, `before the blast no guard fights, searches, finds a body or raises an alarm${r.aware.length ? ': ' + r.aware.slice(0, 6).join(' | ') : ''}`);
  t.equal(r.curious.length, 0, `nor follows a print or looks into a noise${r.curious.length ? ': ' + r.curious.slice(0, 6).join(' | ') : ''}`);
  t.equal(JSON.stringify(r.kills), JSON.stringify(['e2', 'e6']), 'only the road sentry e6 and the peninsula walker e2 die (knife, harpoon)');
  t(r.drumExploded, `the relay station went up with fuel drum b4 (${JSON.stringify(r.drumAt)})`);
  for (const k of ['A1', 'B3', 'C2', 'D3', 'D4', 'E1', 'F1', 'F3', 'F4']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
