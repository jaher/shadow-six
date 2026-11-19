/**
 * LIGHTS OUT e01 "Dry Stone" full solution (tools/solutions/e01.solution.mjs) played in the running game with only
 * player orders, on Hard and then on Easy: Steinmetz taken alive and in the lorry (o1), the key tables taken (o2), the
 * coupling hut blown (o3), everyone out by the north road in the detachment's lorry (o4); the game reports a win. The
 * only alarm is the charge going up after the lorry has left the gate; before it no zone fires, nobody ever spots,
 * challenges or finds a man, the lorry is never tainted, and nobody is ever inside a live cone (the driver's exposure
 * watch). Logic only (Game.step, no frames): several minutes per run.
 */
export const timeout = 3_600_000;

async function play(page, difficulty) {
  return page.evaluate(async (diff) => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    G.game.difficulty = diff; G.difficulty = diff;
    await G.loadMission('e01');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/e01.solution.mjs');
    const w = G.game.world;
    const D = makeDriver(w, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null, blast = null, gateLeft = null;
    const lorry = w.vehicles.find((v) => (v.tag ?? v.id) === 'lorry');
    w.events.on('structure:destroyed', (p) => { if ((p?.structure?.id ?? p?.id) === 'coupler' && blast == null) blast = w.time; });
    const watch = w.onBelTick?.(() => { if (gateLeft == null && lorry && lorry.z > 79 && lorry.driver) gateLeft = w.time; });
    try { await solve(D, {}); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    watch?.();
    const alarms = D.events.filter((e) => e.name === 'alarm:zone');
    const hptm = w.enemies.find((e) => e.tag === 'hptm');
    const out = {
      diff: G.game.missionDef?.difficulty ?? diff, error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      blastT: blast, gateLeftT: gateLeft,
      alarmsBefore: alarms.filter((e) => blast == null || e.t < blast - 1e-6).map((e) => `${e.t.toFixed(1)} ${e.line}`),
      alarmsAfter: alarms.filter((e) => blast != null && e.t >= blast - 1e-6).length,
      found: D.events.filter((e) => e.name === 'enemy:body-found' && (blast == null || e.t < blast - 1e-6)).map((e) => e.line),
      taints: D.events.filter((e) => e.name === 'vehicle:tainted').map((e) => e.line),
      alive: w.commandos.every((c) => c.alive && !c.downed),
      hptm: { alive: !!hptm?.alive, ko: hptm?.ko ?? null, inLorry: hptm?.vehicle === lorry },
      // (the charge kills whoever stands at the hut's door when it goes up: m2 on Hard; nobody dies before it)
      kills: D.events.filter((e) => e.name === 'unit:killed' && (blast == null || e.t < blast - 1e-6)).map((e) => e.line),
      checkpoints: D.checkpoints.map((c) => c.name.split(' ')[0]),
      cpTimes: D.checkpoints.map((c) => `${c.name.split(' ')[0]}@${(c.t ?? c.time ?? 0).toFixed?.(1)}`).join(' '),
    };
    D.dispose?.();
    return out;
  }, difficulty);
}

export default async function e01Solution(page, t) {
  for (const diff of ['hard', 'easy']) {
    const r = await play(page, diff);
    t.log(`e01 ${diff}: ${r.state} at t=${r.time.toFixed(1)} s (blast at ${r.blastT?.toFixed?.(1)}, lorry out of the gate at ${r.gateLeftT?.toFixed?.(1)}), detections ${r.detections}, exposures ${r.exposures.length}`);
    for (const l of r.exposures) t.log(`EXPOSED ${l}`);
    t.log(`${diff} checkpoints: ${r.cpTimes}`);
    t.equal(r.error, null, `${diff}: solution ran to the end`);
    t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true, o4: true }), `${diff}: Steinmetz delivered, tables taken, hut blown, everyone out`);
    t.equal(r.state, 'won', `${diff}: the game reports the win`);
    t.equal(r.detections, 0, `${diff}: never spotted, challenged or unmasked; the lorry never tainted`);
    t.equal(r.taints.length, 0, `${diff}: lorry taints: ${r.taints.join(' | ')}`);
    t.equal(r.exposures.length, 0, `${diff}: never inside a live cone (exposure watch)`);
    t.equal(r.alarmsBefore.length, 0, `${diff}: no alarm before the blast (${r.alarmsBefore.join(' | ')})`);
    t(r.blastT != null && r.alarmsAfter > 0, `${diff}: the charge raises the farm's alarm`);
    t(r.gateLeftT != null && r.blastT > r.gateLeftT, `${diff}: the hut blows after the lorry has left the gate`);
    t.equal(r.found.length, 0, `${diff}: no captive found before the blast (${r.found.join(' | ')})`);
    t(r.alive, `${diff}: all three alive`);
    t(r.hptm.alive && r.hptm.ko === 'bound' && r.hptm.inLorry, `${diff}: Steinmetz alive, cuffed, in the lorry (${JSON.stringify(r.hptm)})`);
    t.equal(r.kills.length, 0, `${diff}: nobody killed before the blast (${r.kills.join('; ')})`);
    for (const k of ['B2', 'B3', 'C2', 'C4', 'E2', 'F2', 'G2', 'H2', 'H3', 'S3', 'I1', 'I3', 'I4']) t(r.checkpoints.includes(k), `${diff}: checkpoint ${k}`);
    if (diff === 'hard') t(r.checkpoints.includes('G4'), 'hard: y2 taken (G4)');
  }
}
