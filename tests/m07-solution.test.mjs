/**
 * M7 "Chase of the Wolves" full stealth solution (tools/solutions/m07.solution.mjs) played in the running game with
 * only player orders — the west party (Spy, Sapper, Driver) and the east one (Green Beret, Marine) at once in stage A,
 * their checkpoints in the walkthrough's order: both U-boats sunk (o1, o2), all five rowed out to the red buoy (o3), the game reports a win, no
 * commando ever spotted / challenged / unmasked, all five alive — and no commando (nor the rowboat by its hull) ever
 * inside a live cone where its rule sees him (driver exposure watch, user 2026-10-08: "make sure no commando goes inside
 * the field of view of a solider before being spotted. Even the raft boat in the light shaded field of view of a soldier
 * makes the soldier see it"). The charges' blasts are the one alarm the plan cannot avoid (any explosion is heard by
 * the village zone, `z_vil` RVIL): until the first one goes off no guard fights, searches, finds a body or raises an
 * alarm. Logic only (Game.step, no frames; the driver plans each sneak): several minutes.
 */
export const timeout = 1_800_000;

export default async function m07Solution(page, t) {
  page.setDefaultTimeout(1_700_000);
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m07');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m07.solution.mjs');
    const { WALKTHROUGH } = await import('/tools/solutions/m07.walkthrough.mjs');
    const W = G.game.world, aware = [], curious = [], orders = [0];
    const D = makeDriver(W, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {}, onOrder: () => { orders.push(W.time); } });
    let blastT = null;
    const offs = [
      W.events.on('bomb:exploded', () => { if (blastT == null) blastT = W.time; }),
      W.events.on('enemy:state', (e) => {
        if (['COMBAT', 'HOLD', 'CHALLENGE', 'ARREST', 'SEARCH', 'BODY', 'ALARM_RUN'].includes(e.to)) aware.push({ t: W.time, line: `${e.enemy?.tag} ${e.from}->${e.to}` });
        else if (['TRACKS', 'INVESTIGATE'].includes(e.to)) curious.push({ t: W.time, tag: e.enemy?.tag, line: `${e.enemy?.tag} ${e.from}->${e.to} @${e.enemy.x.toFixed(0)},${e.enemy.z.toFixed(0)}` });
      }),
      W.events.on('enemy:body-found', (e) => aware.push({ t: W.time, line: `${e.enemy?.tag} found a body` })),
      W.events.on('alarm:zone', (e) => aware.push({ t: W.time, line: `alarm ${e.zone?.id ?? e.zone}` })),
    ];
    let error = null;
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    D.dispose();
    const w = G.game.world;
    return {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]).sort(),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      aware: aware.filter((a) => blastT == null || a.t < blastT - 1e-6).map((a) => `${a.line} t=${a.t.toFixed(1)}`), blastT,
      // (following prints in the snow is not looking into a noise: e5 following the Green Beret's trail up to the decoy is
      // the plan, and a walker may follow the Spy's steps by the clothesline or a patrol the Green Beret's to the decoy —
      // they find nothing and walk back: the 'aware' check above holds them to that)
      curious: curious.filter((a) => (blastT == null || a.t < blastT - 1e-6) && !/->TRACKS/.test(a.line)).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
      tracks: curious.filter((a) => (blastT == null || a.t < blastT - 1e-6) && /->TRACKS/.test(a.line)).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
      checkpointTimes: D.checkpoints.map((c) => `${c.name.split(' ')[0]}@${c.t}`).join(' '),
      unreached: WALKTHROUGH.steps.map((s) => s.cp).filter((id) => !D.checkpoints.some((c) => c.name.split(' ')[0] === id)),
      steps: WALKTHROUGH.steps.map((s) => s.cp),
      // (the longest stretches of game time with no player order: a wait the walkthrough's AUTO time-lapses)
      gaps: (() => { const g = []; for (let i = 1; i < orders.length; i++) g.push([orders[i] - orders[i - 1], orders[i - 1]]); return g.sort((a, b) => b[0] - a[0]).slice(0, 6).map(([d, t]) => `${d.toFixed(0)} s from t=${t.toFixed(0)}`); })(),
      gapMax: orders.slice(1).reduce((m, t, i) => Math.max(m, t - orders[i]), 0),
    };
  });
  t.log(`m07 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, kills ${r.kills.join(',')}`);
  t.log(`checkpoints: ${r.checkpointTimes}`);
  t.log(`longest stretches with no order: ${r.gaps.join(', ')}`);
  // (user: "no long quiet periods, always action in the walkthrough": the west party's waits run beside the east one's
  // actions, and no wait with nobody ordered lasts a minute and a half — AUTO time-lapses what there is)
  t(r.gapMax <= 90, `no stretch over 90 s of game time without an order (longest ${r.gapMax.toFixed(0)} s)`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'both U-boats sunk, all five at the buoy');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, `never inside a live cone where it sees him${r.exposures.length ? ': ' + r.exposures.slice(0, 6).join(' | ') : ''}`);
  t(r.alive, 'all five alive');
  t(r.blastT != null, 'the charges go off');
  t.equal(r.aware.length, 0, `before the blasts no guard fights, searches, finds a body or raises an alarm${r.aware.length ? ': ' + r.aware.slice(0, 6).join(' | ') : ''}`);
  t.log(`prints followed before the blasts: ${r.tracks.join(' | ') || 'none'}`);
  t.equal(r.curious.length, 0, `nor looks into a noise${r.curious.length ? ': ' + r.curious.slice(0, 6).join(' | ') : ''}`);
  t.equal(JSON.stringify(r.kills), JSON.stringify(['e11', 'e15', 'e16', 'e4', 'e6', 'g23', 'p10a', 'p10b']), 'only e4, e6, patrol 10, e11 (group B) and e15, the gunner of gun 23, e16 (the Spy) die');
  for (const k of ['A2', 'A3', 'A6', 'A7', 'A10', 'A12', 'A15', 'A18', 'A20', 'A21', 'A22', 'A24', 'A27', 'A28', 'A32', 'B2', 'C3', 'C5', 'D2']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
  // (stage A's two parties act at once: their checkpoints interleave, and the walkthrough's steps follow the play order)
  t.equal(r.checkpoints.join(','), r.steps.filter((c) => r.checkpoints.includes(c)).join(','), 'the checkpoints come in the walkthrough\'s order');
  // (video mode's caption is the step after the last checkpoint met within the chapter: every step's checkpoint must be met)
  t.equal(r.unreached.join(','), '', 'every walkthrough step\'s checkpoint is met');
}
