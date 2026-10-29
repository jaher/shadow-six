/**
 * M6 "Menace of the Leopold" full solution (tools/solutions/m06.solution.mjs) played in the running game with only
 * player orders: the Leopold blown (o1) and all three men away in the evacuation truck (o2), the game reports a win.
 * The only alarm is the one the mission itself raises when the gun goes up (trigger T1: the blast wakes the base and
 * the truck drives in hostile); before it no zone fires, nobody ever spots, challenges or finds a body, the truck is
 * tainted only by that script, and nobody is ever inside a live cone (the driver's exposure watch).
 * Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 2_400_000;

export default async function m06Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m06');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m06.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, blast = null;
    // (the blast: the Leopold's destruction, the tick that also kills e21 by the gun and raises the base's alarm)
    w.events.on('structure:destroyed', (p) => { if ((p?.structure?.id ?? p?.id) === 'leopold' && blast == null) blast = w.time; });
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const o1 = blast ?? D.checkpoints.find((c) => c.name.startsWith('H5'))?.t;
    const alarms = D.events.filter((e) => e.name === 'alarm:zone');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      blastT: o1 ?? null,
      alarmsBefore: alarms.filter((e) => o1 == null || e.t < o1 - 1e-6).map((e) => `${e.t.toFixed(1)} ${e.line}`),
      alarmsAfter: alarms.filter((e) => o1 != null && e.t >= o1 - 1e-6).length,
      found: D.events.filter((e) => e.name === 'enemy:body-found' && (o1 == null || e.t < o1 - 1e-6)).map((e) => e.line),
      taints: D.events.filter((e) => e.name === 'vehicle:tainted').map((e) => `${e.line}${e.scripted ? ' (scripted)' : ''}`),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line),
      rounds: w.commandos.find((c) => c.role === 'sniper')?.inventory.get('sniperRifle') ?? 0,
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
    };
    D.dispose?.();
    return out;
  });
  t.log(`m06 solution: ${r.state} at t=${r.time.toFixed(1)} s (blast at ${r.blastT?.toFixed?.(1)}), detections ${r.detections}, exposures ${r.exposures.length}, kills: ${r.kills.join('; ')}`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true }), 'the Leopold destroyed, then everyone away in the truck');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or unmasked; the truck tainted only by the mission script');
  t(r.taints.every((l) => /scripted/.test(l)), `truck taints: ${r.taints.join(' | ')}`);
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t.equal(r.alarmsBefore.length, 0, `no alarm before the blast (${r.alarmsBefore.join(' | ')})`);
  t(r.alarmsAfter > 0, 'the blast raises the mission\'s own alarm (trigger T1)');
  t.equal(r.found.length, 0, `no body found before the blast (${r.found.join(' | ')})`);
  t(r.alive, 'all three alive');
  t.equal(r.rounds, 2, 'three sniper rounds spent (e11, e34, e28)');
  for (const k of ['A1', 'B3', 'B4', 'C2', 'D2', 'E1', 'F3', 'G3', 'G4', 'G5', 'H1', 'H4', 'H5', 'H6', 'H8']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
}
