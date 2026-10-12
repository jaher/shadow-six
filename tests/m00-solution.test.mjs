/**
 * M00 "Sandbox" full solution (tools/solutions/m00.solution.mjs) played in the running game with only player orders:
 * the fuel depot destroyed and all three commandos at the extraction point, the game reports a win, no commando ever
 * spotted / challenged, and — the cone rule (user 2026-10-08: "no commando goes inside the field of view of a soldier
 * before being spotted") — after every tick no living guard's cone holds a commando it can see by the §4.2 rule
 * (driver exposure watch: perception.canSee, either band, stance, LOS) — and no guard ever sees a body (body watch).
 * Kneel watch (spec §3.4: "A kneeling Sniper counts as standing: he is visible in the far band"): through the 0.6 s aim
 * before each rifle kill no living man — the target included — would see the Sniper were he standing where he lies.
 * Logic only (Game.step, no frames): ~10 s.
 */
export const timeout = 240_000;

export default async function m00Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m00');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m00.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    const { canSee, coneAt } = await import('/src/ai/perception.js');
    // every patrol corner stands on the real game's grid (the visuals' footprints: hut1's porch posts once stood on
    // patrol_east's corner (55, 46) and he stuck there for good)
    const badCorners = w.enemies.flatMap((e) => (e.route || []).filter((p) => !w.grid.walkableAt(p.x, p.z)).map((p) => `${e.tag} (${p.x}, ${p.z})`));
    // the body watch: no guard ever sees a body (perception hands it to his brain: e.sawBody — even a man shot on his
    // way over to it), let alone walks to it (BODY), finds it or raises the alarm over it
    const bodyWatch = new Set();
    const watchBodies = () => { for (const e of w.enemies) if (e.alive && (e.sawBody || e.brain?.state === 'BODY')) bodyWatch.add(e.tag); };
    // the kneel watch: every tick, who would see the Sniper standing where he is (checked against each rifle kill's aim)
    const sn = w.commandos.find((c) => c.role === 'sniper'), standSeen = [];
    const watchKneel = () => {
      for (const e of w.enemies) {
        if (!e.alive || e.removed || !e.vision) continue;
        const cone = coneAt(e, w.time);
        if (cone && canSee(e, { x: sn.x, z: sn.z, y: sn.y ?? 0, isLow: false, isVisibleToEnemies: true }, w, { cone }) !== 'none') standSeen.push([w.time, e.tag]);
      }
    };
    const rifleKills = [];
    const offKill = w.events.on('unit:killed', (p) => { if ((p.killer ?? p.by)?.role === 'sniper') rifleKills.push([w.time, p.unit?.tag]); });
    const D = makeDriver(w, { step: () => { G.game.step(dt); watchBodies(); watchKneel(); }, dt, quiet: true, log: () => {} });
    const found = [];
    const offFound = w.events.on('enemy:body-found', (e) => found.push(e.enemy?.tag));
    const trap = [];
    const offTrap = w.events.on('trap:sprung', (e) => trap.push(e.victim?.tag));
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    offTrap?.();
    offFound?.();
    offKill?.();
    const aim = 0.6 + 2 * dt; // the aim, and a tick either side
    const kneelSeen = rifleKills.flatMap(([tk, tag]) => standSeen.filter(([ts]) => ts >= tk - aim && ts <= tk).map(([ts, by]) => `${tag} aim: ${by} at ${ts.toFixed(2)}`));
    D.dispose();
    return {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line).sort(),
      alarms: D.events.filter((e) => e.name === 'alarm:zone').length,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      rounds: w.commandos.find((c) => c.role === 'sniper').inventory.get('sniperRifle') ?? 0,
      trap, badCorners, rifleKills: rifleKills.map(([, tag]) => tag), kneelSeen, bodyWatch: [...bodyWatch, ...w.enemies.filter((e) => e.sawBody).map((e) => e.tag)], found,
    };
  });
  t.log(`m00 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, kills ${r.kills.join(', ')}`);
  t.equal(r.badCorners.length, 0, `every patrol corner walkable in the real game (${r.badCorners.join(', ')})`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ destroy_fuel: true, escape: true }), 'depot destroyed, everyone extracted');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted or challenged');
  t.equal(r.exposures.length, 0, `no commando ever inside a live cone that sees him (${r.exposures.slice(0, 5).join(' | ')})`);
  t.equal(r.bodyWatch.length, 0, `no guard ever sees a body (${[...new Set(r.bodyWatch)].join(', ')})`);
  t.equal(r.found.length, 0, 'no body found');
  t.equal(r.rifleKills.length, 3, `three rifle kills watched (${r.rifleKills.join(', ')})`);
  t.equal(r.kneelSeen.length, 0, `nobody could see the Sniper kneel to aim (${r.kneelSeen.slice(0, 5).join(' | ')})`);
  t.equal(r.alarms, 0, 'no alarm (every guard is down before the depot blows)');
  t(r.alive, 'all three alive');
  t.equal(JSON.stringify(r.kills), JSON.stringify([
    'guard_fuel by greenberet', 'officer by sniper', 'patrol_east by sniper', 'patrol_west by sapper', 'sentry_bridge by sniper',
  ]), 'Sniper: officer, patrol, sentry; Sapper\'s trap: the road patrol; Green Beret\'s knife: the depot guard');
  t.equal(r.rounds, 2, 'three rifle rounds of five');
  t.equal(JSON.stringify(r.trap), JSON.stringify(['patrol_west']), 'the road patrol walked into the bear trap');
  for (const k of ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'D1', 'E1', 'E2', 'E3']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
