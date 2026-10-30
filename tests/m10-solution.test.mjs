/**
 * M10 "Operation Icarus" full solution (tools/solutions/m10.solution.mjs) played in the running game with only player
 * orders, on foot (boarding the camp's spare Panzer IV would sound the siren by trigger T1): the Green Beret knifes the
 * ruins clear (Patrol 4 man by man from the back of its file), then e5 outside the west wall; his decoy draws e7 and
 * then e6 out through the west arch into the lee of the wall, where he knifes them unseen, and holds e8 while he
 * knifes e9 and e8 in the compound and carries both out; McRae is freed
 * (o1); the Sapper's time bomb destroys the store (o2) and the camp's investigators find nothing; the team crawls up the
 * wire field, the Sniper shoots both MG gunners at the ramp's foot, and the Sapper's grenades, lobbed up from below the
 * escarpment where nobody on the shelf can see him, kill the dugout's three squads; everyone boards the Junkers and
 * McRae flies them out (o4). The game reports a win, no commando (McRae included) is ever spotted / challenged, no
 * vehicle tainted, nobody ever inside a live cone (the driver's exposure watch; user 2026-10-08: "make sure no commando
 * goes inside the field of view of a solider before being spotted"), the camp's siren never sounds, and the only alarm
 * is the airfield's own: every explosion trips it (the store must be blown up), so the first one is the store's blast.
 * Logic only (Game.step, no frames): a long mission, many minutes.
 */
export const timeout = 3_600_000;

export default async function m10Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m10');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m10.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const { WALKTHROUGH } = await import('/tools/solutions/m10.walkthrough.mjs');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    const found = [];
    let storeAt = null; // (the store's blast: the tick objective 2 is done, whatever the solution does meanwhile)
    const offs = [w.events.on('enemy:body-found', (e) => found.push({ t: w.time, line: `${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'}` })),
      w.events.on('objective:update', (e) => { if (storeAt == null && e.objective?.id === 'o2' && e.objective.done) storeAt = w.time; })];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const cps = D.checkpoints, at = (id) => cps.find((c) => c.name.startsWith(id))?.t ?? null;
    const ju = w.byId('ju52');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive), aboard: w.commandos.filter((c) => c.vehicle === ju).length, crew: w.commandos.length,
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      found: found.map((f) => `${f.t.toFixed(1)} ${f.line}`), dugoutAt: at('G1'), blastAt: at('E4'), storeAt,
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]),
      rounds: w.commandos.find((c) => c.role === 'sniper')?.inventory.get('sniperRifle') ?? 0,
      checkpoints: cps.map((c) => c.name.split(' ')[0]),
      unreached: WALKTHROUGH.steps.map((s) => s.cp).filter((id) => !cps.some((c) => c.name.split(' ')[0] === id)),
    };
    D.dispose();
    return out;
  });
  const first = r.alarms[0];
  t.log(`m10 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills.length} killed, ${r.rounds} sniper round(s) left, first alarm ${first ? `${first.t.toFixed(1)} ${first.line}` : 'none'} (the store blew up at ${r.storeAt?.toFixed(2)}, checkpoint E4 ${r.blastAt})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.found) t.log(`FOUND ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: false, o4: true }), 'McRae free, the store destroyed, away in the Junkers (the Stukas are optional)');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all four alive, McRae too');
  t.equal(r.aboard, r.crew, 'everyone aboard the Junkers');
  t(!r.alarms.some((a) => /z_camp|RINT \(/.test(a.line)), `the camp's siren never sounds (${r.alarms.map((a) => a.line).join(' | ')})`);
  t(first && r.storeAt != null && Math.abs(first.t - r.storeAt) <= 1 && /z_air RINT_AIR \(explosion\)/.test(first.line), `the first alarm is the airfield's, tripped by the store's blast (${first?.line})`);
  t(r.blastAt != null && r.storeAt != null && Math.abs(r.blastAt - r.storeAt) <= 0.5, `checkpoint E4 marks the blast itself (${r.blastAt} vs ${r.storeAt?.toFixed(2)})`);
  t(r.dugoutAt != null && !r.found.some((f) => +f.split(' ')[0] < r.dugoutAt), `nobody finds a body before the dugout fight (${r.found.join(' | ')})`);
  t.equal(r.kills.filter((k) => /^dugout#/.test(k)).length, 9, 'the dugout\'s nine men all killed');
  t(['e1', 'e2', 'e3', 'e4', 'p4a', 'p4b', 'p4c', 'e5', 'e6', 'e7', 'e8', 'e9', 'g1', 'g2'].every((k) => r.kills.includes(k)), 'the ruins, the compound and both MG nests at the ramp cleared');
  t.equal(r.rounds, 1, 'two sniper rounds spent');
  for (const k of ['A2', 'A7', 'A8', 'C1', 'D1', 'D3', 'D6', 'D9', 'D10', 'D11', 'E1', 'E3', 'E4', 'F2', 'G2', 'G3', 'H1', 'H3']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
  // (video mode's caption is the step after the last checkpoint met within the chapter: a step whose checkpoint never
  // comes holds the one before it on screen through the next chapter, so every step's checkpoint must be met)
  t.equal(r.unreached.join(','), '', 'every walkthrough step\'s checkpoint is met');
}
