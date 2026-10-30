/**
 * M18 "The Force of Circumstance" full solution (tools/solutions/m18.solution.mjs) played in the running game with only
 * player orders: the three German charges on the bridge's marked points A, B and C (the lorry takes the Sapper up to the
 * bridge's E end and back: nobody on foot near its way), set off from the lorry's door by the S road (o1: the span
 * falls), and all four in the lorry (o2). The game reports a win, no commando is ever spotted / challenged, the
 * lorry never tainted, all four alive, and no commando, nor the boat, ever inside a live cone (the driver's exposure
 * watch; user 2026-10-08: "make sure no commando goes inside the field of view of a solider before being spotted. Even
 * the raft boat in the light shaded field of view of a soldier makes the soldier see it"). The one alarm is the bridge
 * going up (every blast sounds M18's siren: alarm.js): no siren before the detonator. The three kills (e20 on the N
 * island, the island MG gunner e54 and walker e57) lie on the islands, whose cries reach no one: a body found there
 * is no alarm (dossier §6.2; the W-bank gunner's "man down" about e54 too: tests/missions/m18.test.mjs).
 * Logic only (Game.step, no frames): a long mission, several minutes.
 */
export const timeout = 3_600_000;

export default async function m18Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m18');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m18.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const inIsland = (x, z) => ['z_isl_n', 'z_isl_s'].includes(w.alarm?.zoneAt?.(x, z)?.id);
    const found = [];
    const off = w.events.on('enemy:body-found', (e) => found.push({ t: w.time, finder: e.enemy?.tag, body: e.body?.unit?.tag ?? e.body?.tag, island: inIsland(e.body?.x, e.body?.z) }));
    // (the first blast of the mission: the first charge on the deck, set off from the lorry's door)
    let firstBlast = null;
    const offB = w.events.on('explosion', (e) => { if (!firstBlast) firstBlast = { t: w.time, x: e.x, z: e.z, kind: e.kind }; });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    off?.(); offB?.();
    const truck = w.byId('truck');
    const cp = (id) => D.checkpoints.find((c) => c.name.split(' ')[0] === id)?.t ?? null;
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      blastAt: cp('G2'), firstBlast,
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => ({ t: e.t, line: e.line })),
      found, alive: w.commandos.every((c) => c.alive), aboard: w.commandos.filter((c) => c.vehicle === truck).length,
      truck: truck ? { destroyed: !!truck.destroyed, tainted: !!truck.tainted } : null,
      bridge: !!w.byId?.('bridge')?.destroyed || !!w.structures?.get?.('bridge')?.destroyed,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
    };
    D.dispose?.();
    return out;
  });
  t.log(`m18 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, blast at ${r.blastAt?.toFixed?.(1)}, first alarm ${r.alarms[0] ? `${r.alarms[0].t.toFixed(1)} ${r.alarms[0].line}` : 'none'}`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'the span down, then everyone in the lorry');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone, nor the boat (exposure watch)');
  t(r.alive, 'all four alive');
  t.equal(r.aboard, 4, 'all four in the lorry');
  t(r.truck && !r.truck.destroyed && !r.truck.tainted, 'the lorry intact, never known for ours (nobody stepped out of its way)');
  t(r.blastAt !== null, 'the charges set off');
  // (the first blast is the first charge on the deck: nothing else blows up, nothing sounds the siren before it)
  const fb = r.firstBlast, onDeck = fb && [[51.5, 78.5], [63.5, 88.5], [77.3, 99.3]].some(([x, z]) => Math.hypot(fb.x - x, fb.z - z) < 2);
  t(onDeck && fb.t <= r.blastAt, `the first blast is a charge on the deck (${fb ? `${fb.kind} at ${fb.x.toFixed(1)},${fb.z.toFixed(1)} t=${fb.t.toFixed(2)}` : 'none'})`);
  const early = r.alarms.filter((a) => a.t < (fb?.t ?? r.blastAt) - 0.01);
  t.equal(early.length, 0, `no alarm before the detonator (${early.map((a) => `${a.t.toFixed(1)} ${a.line}`).join(' | ')})`);
  const before = r.kills.filter((k) => k.t < (fb?.t ?? r.blastAt)).map((k) => k.line.split(' ')[0]).sort();
  t.equal(JSON.stringify(before), JSON.stringify(['e20', 'e54', 'e57']), `three kills before the blast, all on the islands (${before})`);
  const bank = r.found.filter((f) => f.t < (fb?.t ?? r.blastAt) && !f.island);
  t.equal(bank.length, 0, `no body found anywhere but on the islands (${bank.map((f) => `${f.finder}>${f.body}`).join(' ')})`);
  for (const k of ['A1', 'B0', 'B0b', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'D2', 'D3', 'E0', 'E0b', 'E3', 'E4', 'E6', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'G1', 'G2', 'G3']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
