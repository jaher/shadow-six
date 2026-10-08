/**
 * M3 "Reverse Engineering" full stealth solution (tools/solutions/m03.solution.mjs) played in the running game with
 * only player orders: bunker (o1), dam (o2) and the truck (o3) done, the game reports a win, no commando ever spotted
 * / challenged / unmasked, no raft tainted, all four alive. Logic only (Game.step, no frames): ~20 s.
 */
export const timeout = 240_000;

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
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const w = G.game.world;
    offArmed?.();
    D.dispose();
    const mk = w.markers.get('bunker_charge');
    return {
      error, state: G.game.state, time: w.time, detections: D.detections(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]).sort(),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      armed, bunkerCharge: mk ? [mk.x, mk.z] : null,
    };
  });
  t.log(`m03 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, kills ${r.kills.join(',')}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'bunker, dam and truck');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged, unmasked or tainted');
  t(r.alive, 'all four alive');
  t.equal(JSON.stringify(r.kills), JSON.stringify(['e1', 'e2', 'e3', 'e34', 'e4', 'e5']), 'only the plateau patrol, the gully pair and the bunker gunner die');
  const one = r.armed[0];
  t(one && one.inside === 'dam_bunker', `charge one set by the Sapper from inside the bunker (${JSON.stringify(one)})`);
  t(one && r.bunkerCharge && Math.hypot(one.x - r.bunkerCharge[0], one.z - r.bunkerCharge[1]) < 0.3, 'on the bunker_charge spot inside');
  for (const k of ['A2', 'B3', 'C3', 'D2', 'E3', 'F2', 'G3', 'H2', 'I3', 'J2']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
