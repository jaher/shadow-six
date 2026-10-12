/**
 * M3 "Reverse Engineering" full stealth solution (tools/solutions/m03.solution.mjs) played in the running game with
 * only player orders: bunker (o1), dam (o2) and the truck (o3) done, the game reports a win, no commando ever spotted
 * / challenged / unmasked, no raft tainted or shot, all four alive — and no commando (nor the raft's crew, nor the
 * used raft lying empty, whoever hides beside it) ever inside a live cone where its rule sees him (driver exposure
 * watch, user 2026-10-08: "make sure no commando goes inside the field of view of a solider before being spotted. Even
 * the raft boat in the light shaded field of view of a soldier makes the soldier see it"). Logic only (Game.step, no
 * frames; the driver plans each sneak): a few minutes.
 */
export const timeout = 900_000;

export default async function m03Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m03');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m03.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    // review 2026-10-07: charge one is set INSIDE the bunker (the Sapper goes in through its doorway)
    const armed = [];
    const offArmed = G.game.world.events.on('bomb:armed', (e) => armed.push({ inside: e.unit?.insideStructure?.tag ?? null, x: e.bomb.x, z: e.bomb.z }));
    // M3 film review: the bear trap that took p1's sergeant put his two troopers into combat (they had seen him fall),
    // they searched and found his body. Until the first charge goes off no guard may know anything happened: none
    // fights, searches, holds, finds a body or raises an alarm
    const W = G.game.world, aware = [], curious = []; // (curious: lesser reactions — a print followed, a noise looked into)
    let blastT = null;
    const offAware = [
      W.events.on('bomb:exploded', () => { if (blastT == null) blastT = W.time; }),
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
    offArmed?.();
    for (const off of offAware) off?.();
    D.dispose();
    const mk = w.markers.get('bunker_charge');
    return {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]).sort(),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      armed, bunkerCharge: mk ? [mk.x, mk.z] : null,
      raftShots: D.events.filter((e) => e.name === 'shot' && /raft/.test(e.line)).length,
      // (the blast raises its zones in the same tick, before 'bomb:exploded')
      aware: aware.filter((a) => blastT == null || a.t < blastT - 1e-6).map((a) => `${a.line} t=${a.t.toFixed(1)}`), blastT,
      curious: curious.filter((a) => blastT == null || a.t < blastT - 1e-6).map((a) => `${a.line} t=${a.t.toFixed(1)}`),
      checkpointTimes: D.checkpoints.map((c) => `${c.name.split(' ')[0]}@${c.t}`).join(' '),
    };
  });
  t.log(`m03 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, kills ${r.kills.join(',')}`);
  t.log(`checkpoints: ${r.checkpointTimes}`);
  t.log(`before the blasts, followed prints / looked into noises: ${r.curious.join(' | ') || 'none'}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'bunker, dam and truck');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t.equal(r.exposures.length, 0, `never inside a live cone where it sees him${r.exposures.length ? ': ' + r.exposures.slice(0, 6).join(' | ') : ''}`);
  t(r.alive, 'all four alive');
  t.equal(r.raftShots, 0, 'nobody shoots at the raft (never left in view empty, §4.3)');
  t(r.blastT != null, 'the charges go off');
  t.equal(r.aware.length, 0, `before the blasts no guard fights, searches, finds a body or raises an alarm (the plateau trap kill seen by p1's troopers)${r.aware.length ? ': ' + r.aware.slice(0, 6).join(' | ') : ''}`);
  // (lures — the decoy, the Spy's chat — are the plan; a print left behind or a shout heard is not: the GB rising from
  // the snow with a move order left a boot print p5 followed, which put p5's round out of step for the rest of the run)
  t.equal(r.curious.length, 0, `nor follows a print or looks into a noise${r.curious.length ? ': ' + r.curious.slice(0, 6).join(' | ') : ''}`);
  t.equal(JSON.stringify(r.kills), JSON.stringify(['e1', 'e14', 'e2', 'e3', 'e34', 'e4', 'e5', 'e6', 'e8']), 'only the plateau patrol, the gully pair, e8 on the camp\'s N strip, the river posts e6 / e14 and the bunker gunner die');
  const one = r.armed[0];
  t(one && one.inside === 'dam_bunker', `charge one set by the Sapper from inside the bunker (${JSON.stringify(one)})`);
  t(one && r.bunkerCharge && Math.hypot(one.x - r.bunkerCharge[0], one.z - r.bunkerCharge[1]) < 0.3, 'on the bunker_charge spot inside');
  for (const k of ['A2', 'A4', 'B3', 'C2', 'D1', 'E3', 'F3', 'G5', 'I2', 'I4', 'J2']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
