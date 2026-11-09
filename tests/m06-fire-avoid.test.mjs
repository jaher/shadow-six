/**
 * M6 "Menace of the Leopold": the guards woken by the gun's blast keep out of its fire (user 2026-11-08: "Enemies should
 * not walk through the fire"; world/fires.js). The full solution is played in the running game (logic only, as
 * m06-solution); from the blast on, the world is stepped on until the burning gun is down to a smoulder, and every
 * living enemy's position is checked against the flames' footprint (the VFX burning_wreck's ellipse) while they burn.
 * Every other fire of the blast too — the charge's burning ground at the gun's ladder foot, where on master three of the
 * guards running to the blast stand in the flames 13 s after it (commandos-shots/fire-avoid/fire-avoid-m06.jpg).
 * Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 2_400_000;

export default async function m06FireAvoid(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m06');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m06.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const { inShape, fireAt } = await import('/src/world/fires.js');
    const w = G.game.world;
    let blast = null, fire = null, samples = 0, ticks = 0;
    const inFlames = [], inCells = [], inOther = [], closest = new Map(), others = new Map();
    w.events.on('structure:destroyed', (p) => { if (p?.id === 'leopold' && blast == null) blast = w.time; });
    const watch = () => {
      if (blast == null) return;
      fire ||= w.fires.list.find((f) => f.kind === 'structure' && Math.hypot(f.shape.x - 110, f.shape.z - 66) < 1) || null;
      for (const f of w.fires.list) if (f !== fire && !others.has(f.id)) others.set(f.id, f);
      for (const f of others.values()) {
        if (!f.stamped || w.time >= f.off) continue;
        const fl = { ...f.shape, m: 0 };
        for (const e of w.enemies) if (e.alive && !e.removed && e.state === 'active' && inShape(fl, e.x, e.z)) inOther.push(`${(w.time - blast).toFixed(2)} ${e.tag ?? e.id} in ${f.kind} (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`);
      }
      if (!fire || w.time < fire.on || w.time >= fire.off) return;
      ticks++;
      const flames = { ...fire.shape, m: 0 };
      for (const e of w.enemies) {
        if (!e.alive || e.removed) continue;
        samples++;
        const id = e.tag ?? e.id;
        if (inShape(flames, e.x, e.z)) inFlames.push(`${(w.time - blast).toFixed(2)} ${id} (${e.x.toFixed(2)}, ${e.z.toFixed(2)}) ${e.brain?.state}`);
        if (fireAt(w.grid, e.x, e.z) && e.state === 'active') inCells.push(id);
        const d = Math.hypot(e.x - 110, e.z - 66);
        if (!closest.has(id) || d < closest.get(id)) closest.set(id, d);
      }
    };
    const D = makeDriver(w, { step: () => { G.game.step(dt); watch(); }, dt, quiet: true, log: () => {} });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
    // (won by now: the world is stepped on — the fire burns ~50 s after the blast)
    for (let i = 0; i < 60 * 70 && fire && w.time < fire.off + 0.5; i++) { G.game.step(dt); watch(); }
    const near = [...closest].sort((a, b) => a[1] - b[1]).slice(0, 6).map(([id, d]) => `${id} ${d.toFixed(1)} m`);
    const out = { error, state: G.game.state, blast, fire: fire && { on: fire.on - blast, off: fire.off - blast, shape: fire.shape }, ticks, samples,
      inFlames: inFlames.slice(0, 20), nFlames: inFlames.length, inOther: inOther.slice(0, 20), nOther: inOther.length, otherKinds: [...others.values()].map((f) => f.kind), cellSecs: Object.entries(inCells.reduce((m, id) => ((m[id] = (m[id] || 0) + dt), m), {})).map(([id, s]) => `${id} ${s.toFixed(2)} s`),
      maxCellSecs: Math.max(0, ...Object.values(inCells.reduce((m, id) => ((m[id] = (m[id] || 0) + dt), m), {}))), near, det: D.detections(), exp: D.exposureReport().length };
    D.dispose?.();
    return out;
  });
  t.log(`m06 fire: ${r.state}, blast at ${r.blast?.toFixed?.(1)}, fire ${JSON.stringify(r.fire)}; ${r.ticks} burning ticks, ${r.samples} enemy samples; nearest to the gun: ${r.near.join(', ')}`);
  for (const l of r.inFlames) t.log(`IN FLAMES ${l}`);
  t.equal(r.error, null, 'the solution ran to the end');
  t.equal(r.state, 'won', 'and won');
  t.equal(r.det, 0, 'never spotted');
  t.equal(r.exp, 0, 'never exposed');
  t(r.fire && r.fire.off > 40, 'the gun burns (a sim fire on its wreck, ~50 s)');
  t(r.ticks > 60 * 40, `watched while it burned (${r.ticks} ticks)`);
  t.equal(r.nFlames, 0, `no enemy inside the burning gun's flames (${r.inFlames.join(' | ')})`);
  t(r.otherKinds.includes('ground'), `the blasts' burning ground is a fire too (${r.otherKinds.join(', ')})`);
  t.equal(r.nOther, 0, `nor inside the flames of the blast's other fires — the charge's burning ground (${r.inOther.join(' | ')})`);
  // (a man the fire caught standing in its margin steps out at once: a moment there, never more)
  t(r.maxCellSecs <= 2.5, `nobody stays on a burning cell (flames + margin): ${r.cellSecs.join(', ') || 'none'}`);
}
