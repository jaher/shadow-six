/**
 * M4 "Restore Pride" full solution (tools/solutions/m04.solution.mjs) played in the running game with only player
 * orders: the Marine harpoons e2 and the Green Beret knifes e1 and e3 south of the rail yard; the Green Beret's decoy draws
 * e17 to the wire gap, where he knifes him, and he knifes e12 in the centre grove behind the passing train; the Sniper and
 * the Green Beret clear the bridge's foot (Patrol 19, e19, the gunner e20) and the courier e26 at its far end; the team
 * crosses the deck between two trains; the Driver takes the courier's motorcycle and the Sapper the air-drop's charge
 * (o2); the decoy draws e54 into the corridor between the walls, where the motorcycle runs him down, and then holds the
 * lawn guard e59; the motorcycle carries the Green Beret, the Sniper (three rounds from the air-drop) and the Marine to
 * the strip north of the pier shed, the Driver takes his machine pistol from the air-drop and fetches the Sapper; the
 * Sapper sets the charge on the villa steps (o1) while the lorry driver e49 is at the villa door (he dies in the blast);
 * after it the Sniper drops the pier guard e56, the team runs round the shed and down the pier stair to the landing
 * stage (the Driver and the Sapper by motorcycle to the stair head), and all five board at once while e13 across the
 * water looks away; the boat's drive-off is skipped (ESC, §7.6): o3.
 * The game reports a win; no commando is ever spotted, challenged or tainted, and none is ever inside a live cone (the
 * driver's exposure watch; user 2026-10-08: "make sure no commando goes inside the field of view of a solider before
 * being spotted"); nobody finds a body or raises an alarm before the villa goes up.
 * Logic only (Game.step, no frames): a long mission, a few minutes.
 */
export const timeout = 3_600_000;

export default async function m04Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m04');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m04.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const { WALKTHROUGH } = await import('/tools/solutions/m04.walkthrough.mjs');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {}, skipEscape: () => G.game.skipExtraction() });
    const w = G.game.world;
    const found = [];
    let blastAt = null;
    const offs = [w.events.on('enemy:body-found', (e) => found.push({ t: w.time, line: `${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'}` })),
      w.events.on('objective:update', (e) => { if (blastAt == null && e.objective?.id === 'o1' && e.objective.done) blastAt = w.time; })];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const cps = D.checkpoints;
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      found: found.map((f) => `${f.t.toFixed(1)} ${f.line}`), blastAt,
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]),
      checkpoints: cps.map((c) => c.name.split(' ')[0]),
      unreached: WALKTHROUGH.steps.map((s) => s.cp).filter((id) => !cps.some((c) => c.name.split(' ')[0] === id)),
    };
    D.dispose();
    return out;
  });
  t.log(`m04 solution: ${r.state} at t=${r.time.toFixed(1)} s (the villa went up at ${r.blastAt?.toFixed(1)}), detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills.length} killed: ${r.kills.join(', ')}`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.found) t.log(`FOUND ${l}`);
  for (const a of r.alarms) t.log(`ALARM ${a.t.toFixed(1)} ${a.line}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true }), 'the villa destroyed, the charge taken from the air-drop, everyone away in the patrol boat');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all five alive');
  t(r.blastAt != null && !r.alarms.some((a) => a.t < r.blastAt - 1e-6), `no alarm before the villa goes up (${r.alarms.map((a) => `${a.t.toFixed(1)} ${a.line}`).join(' | ')})`);
  t(r.blastAt != null && !r.found.some((f) => +f.split(' ')[0] < r.blastAt), `nobody finds a body before the villa goes up (${r.found.join(' | ')})`);
  t(['e1', 'e2', 'e3', 'e17', 'e12', 'e19', 'e20', 'e21', 'e22', 'e23', 'e24', 'e25', 'e26', 'e54', 'e49', 'e56'].every((k) => r.kills.includes(k)), `the yard south, the wire gap, the bridge, the corridor, the villa door and the pier cleared (${r.kills.join(', ')})`);
  // (video mode's caption is the step after the last checkpoint met within the chapter: every step's checkpoint is met)
  t.equal(r.unreached.join(','), '', 'every walkthrough step\'s checkpoint is met');
}
