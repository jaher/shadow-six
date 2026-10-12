/**
 * M14 "D-Day Kick Off" full solution (tools/solutions/m14.solution.mjs) played in the running game with only player
 * orders: the four coastal guns destroyed (o1) and the whole team rowed out to the red buoy (o2), the game reports a
 * win, no commando ever spotted / challenged, the boat never tainted, all five alive — and no commando, nor the boat,
 * ever inside a live cone (the driver's exposure watch). One alarm is part of the plan (stage F: the bodies of the
 * posts by gun 4's barrels are found); it never sees anyone. Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 2_400_000;

export default async function m14Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m14');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m14.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    const armed = [];
    const offArmed = w.events.on('bomb:armed', (e) => armed.push({ x: e.bomb.x, z: e.bomb.z }));
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    offArmed?.();
    const guns = Object.fromEntries(['g1', 'g2', 'g3', 'g4'].map((id) => [id, !!w.interactables.find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id))?.destroyed]));
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])), guns,
      alive: w.commandos.every((c) => c.alive), boat: (() => { const b = w.byId('boat'); return b ? { x: b.x, z: b.z, destroyed: !!b.destroyed, crew: b.occupants.length } : null; })(),
      kills: D.events.filter((e) => e.name === 'unit:killed').length,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]), armed,
    };
    D.dispose();
    return out;
  });
  t.log(`m14 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills} killed`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'four guns, then out to the buoy');
  t.equal(JSON.stringify(r.guns), JSON.stringify({ g1: true, g2: true, g3: true, g4: true }), 'all four guns destroyed');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all five alive');
  t(r.boat && !r.boat.destroyed && r.boat.crew === 5 && Math.hypot(r.boat.x - 122, r.boat.z - 191) < 6.5, `the boat with all five at the red buoy (${JSON.stringify(r.boat)})`);
  t.equal(r.armed.length, 3, 'three remote charges set');
  for (const k of ['B7', 'C7', 'F2', 'F5', 'G1', 'G4', 'G5']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
