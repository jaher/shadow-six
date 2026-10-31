/**
 * M17 "Before Dawn" full solution (tools/solutions/m17.solution.mjs) played in the running game with only player
 * orders: the Spy, in uniform, clears the west strip and, with the Green Beret and the Marine, the prison yard; the
 * Green Beret's decoy keeps the bunker gunner turned away from the road bridge to the end; on the north bank the Spy
 * takes the outlying men, draws e22 off with a shot, then holds e20 (who sees the bank's middle) while the Marine
 * harpoons the shore guards from the river, and injects e20 and the machine-gunner last. The five prisoners are freed
 * from the cage (o1) and everyone — the Green Beret, the Marine, the Spy and the five — boards the lorry in the
 * north-west, which drives off (o2). The game reports a win, no commando or prisoner is ever spotted / challenged, the
 * Spy is never unmasked, nobody finds a body and no siren sounds — and nobody, the prisoners included, is ever inside a
 * live cone where its rule sees him (driver exposure watch; user 2026-10-08: "make sure no commando goes inside the
 * field of view of a solider before being spotted"). Logic only (Game.step, no frames): a long mission, many minutes.
 */
export const timeout = 3_600_000;

export default async function m17Solution(page, t) {
  page.setDefaultTimeout(3_500_000);
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m17');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m17.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const { WALKTHROUGH } = await import('/tools/solutions/m17.walkthrough.mjs');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world, aware = [];
    const offs = [
      w.events.on('alarm:zone', (e) => aware.push(`alarm ${e.zone?.id ?? e.zone} ${e.event} t=${w.time.toFixed(1)}`)),
      w.events.on('enemy:body-found', (e) => aware.push(`${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'} t=${w.time.toFixed(1)}`)),
      w.events.on('enemy:state', (e) => { if (['COMBAT', 'HOLD', 'CHALLENGE', 'ARREST', 'SEARCH', 'BODY', 'ALARM_RUN'].includes(e.to)) aware.push(`${e.enemy?.tag} ${e.from}->${e.to} t=${w.time.toFixed(1)}`); }),
    ];
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    const cps = D.checkpoints;
    const truck = w.vehicles.find((v) => (v.tag ?? v.spawn?.id) === 'truck');
    // (a checkpoint as a line: its id, its game time and where every man stands)
    const mark = (c) => `${c.name.split(' ')[0]}@${c.t.toFixed(3)} ${Object.entries(c.units || {}).map(([k, u]) => `${k}:${u.x?.toFixed(2)},${u.z?.toFixed(2)}`).join(' ')}`;
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive),
      aboard: w.commandos.filter((c) => truck && c.vehicle === truck).length, crew: w.commandos.length,
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]),
      aware, checkpoints: cps.map((c) => c.name.split(' ')[0]), marks: cps.map(mark),
      unreached: WALKTHROUGH.steps.map((s) => s.cp).filter((id) => !cps.some((c) => c.name.split(' ')[0] === id)),
    };
    D.dispose?.();
    // the same page solves again — video mode's 'Again' and a jump back on its timeline reload the mission and run the
    // cached module once more (debug-mode.js startWalkthrough) — and must play the scripted run again: to stage F (the
    // first checkpoint a leftover of run 1 moved was F4: G3 then came 454 s early)
    await G.loadMission('m17');
    G.start();
    const D2 = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error2 = null;
    try { await solve(D2, { boardPoint, until: 'F' }); } catch (e) { error2 = String(e && e.message || e); }
    out.again = { error: error2, marks: D2.checkpoints.map(mark), detections: D2.detections(), exposures: D2.exposureReport().length };
    D2.dispose?.();
    return out;
  });
  t.log(`m17 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills.length} killed (${r.kills.join(',')})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.aware) t.log(`AWARE ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'the five freed, everyone in the lorry');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or unmasked');
  t.equal(r.exposures.length, 0, 'never inside a live cone, the prisoners included (exposure watch)');
  t(r.alive, 'everyone alive, the five prisoners included');
  t.equal(r.aboard, r.crew, 'everyone aboard the lorry');
  t.equal(r.aware.length, 0, 'no siren, no body found, nobody searching or fighting');
  for (const k of ['A2', 'B5', 'C5', 'D5', 'E3', 'F4', 'F8', 'G8', 'H5', 'H6', 'H11', 'H12', 'I2', 'I8']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
  // (video mode's caption is the step after the last checkpoint met within the chapter: every step's checkpoint must be met)
  t.equal(r.unreached.join(','), '', 'every walkthrough step\'s checkpoint is met');
  const a = r.again, ref = r.marks.slice(0, a.marks.length), off = a.marks.findIndex((m, i) => m !== ref[i]);
  t.log(`again in the same page: ${a.marks.length} checkpoints to ${a.marks.at(-1)?.split('@')[0]}, detections ${a.detections}, exposures ${a.exposures}${off >= 0 ? `; first off: ${a.marks[off]} vs ${ref[off]}` : ''}`);
  t.equal(a.error, null, 'a second solve() in the same page runs to stage F');
  t.equal(a.marks.at(-1)?.split('@')[0], 'F8', 'the second run reaches F8');
  t.equal(off, -1, 'the second run in the same page (video mode Again / a jump back) is the scripted run: every checkpoint to F8 at the same time, every man in the same place');
}
