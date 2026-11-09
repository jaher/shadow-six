/**
 * M8 "Pyrotechnics": the garrison woken by the depot going up keeps out of the burning oil-rack store (user 2026-11-08:
 * "Enemies should not walk through the fire"; world/fires.js). The full solution is played in the running game (logic
 * only, as m08-solution); from the store's blast on, the world is stepped on until the racks' fires are down to a
 * smoulder, and every living enemy's position is checked against each burning rack's flames (the VFX fuel_pool_fire
 * the store burns on with, FIRE.rack) while they burn — and against every other fire's, reported.
 * Logic only (Game.step, no frames): several minutes.
 */
export const timeout = 3_000_000;

export default async function m08FireAvoid(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m08');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m08.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const { inShape, fireAt } = await import('/src/world/fires.js');
    const w = G.game.world;
    const racks = new Set(), seenFires = new Map(), inRack = [], inOther = [], cellT = {};
    let blast = null, watched = 0;
    const watch = () => {
      for (const f of w.fires.list) {
        if (!seenFires.has(f.id)) seenFires.set(f.id, f);
        if (f.kind === 'rack') { racks.add(f); blast ??= f.t0; }
      }
      if (blast == null) return;
      let any = false;
      for (const f of seenFires.values()) {
        if (w.time < f.on || w.time >= f.off || !f.stamped) continue;
        any = true;
        const flames = { ...f.shape, m: 0 };
        for (const e of w.enemies) {
          if (!e.alive || e.removed || e.state !== 'active') continue;
          if (!inShape(flames, e.x, e.z)) continue;
          (f.kind === 'rack' ? inRack : inOther).push(`${(w.time - blast).toFixed(2)} ${e.tag ?? e.id} in ${f.kind}#${f.id} (${e.x.toFixed(2)}, ${e.z.toFixed(2)}) ${e.brain?.state}`);
        }
      }
      if (any) watched++;
      if (g().fireCells) for (const e of w.enemies) if (e.alive && e.state === 'active' && fireAt(g(), e.x, e.z)) cellT[e.tag ?? e.id] = (cellT[e.tag ?? e.id] || 0) + dt;
    };
    const g = () => w.grid;
    const D = makeDriver(w, { step: () => { G.game.step(dt); watch(); }, dt, quiet: true, log: () => {}, skipEscape: () => G.game.skipExtraction() });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
    // (won by now: the world is stepped on until the racks are down to a smoulder, ~40 s after the blast)
    const end = Math.max(0, ...[...racks].map((f) => f.off));
    for (let i = 0; i < 60 * 70 && racks.size && w.time < end + 0.5; i++) { G.game.step(dt); watch(); }
    const out = { error, state: G.game.state, blast, racks: racks.size, rackOff: racks.size ? Math.max(...[...racks].map((f) => f.off - f.t0)) : 0, watched,
      inRack: inRack.slice(0, 20), nRack: inRack.length, inOther: inOther.slice(0, 20), nOther: inOther.length,
      cellSecs: Object.entries(cellT).map(([id, s]) => `${id} ${s.toFixed(2)} s`), maxCellSecs: Math.max(0, ...Object.values(cellT)),
      kinds: [...seenFires.values()].reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {}), det: D.detections(), exp: D.exposureReport().length };
    D.dispose?.();
    return out;
  });
  t.log(`m08 fire: ${r.state}, store blast at ${r.blast?.toFixed?.(1)}, ${r.racks} rack fires (out after ${r.rackOff.toFixed(1)} s), fires ${JSON.stringify(r.kinds)}; ${r.watched} burning ticks watched`);
  for (const l of [...r.inRack, ...r.inOther]) t.log(`IN FLAMES ${l}`);
  t.equal(r.error, null, 'the solution ran to the end');
  t.equal(r.state, 'won', 'and won');
  t.equal(r.det, 0, 'never spotted');
  t.equal(r.exp, 0, 'never exposed');
  t.equal(r.racks, 6, 'the six racks of the store burn on');
  t(r.watched > 60 * 30, `watched while they burned (${r.watched} ticks)`);
  t.equal(r.nRack, 0, `no enemy inside a burning rack's flames (${r.inRack.join(' | ')})`);
  t.equal(r.nOther, 0, `nor inside any other fire's (${r.inOther.join(' | ')})`);
  t(r.maxCellSecs <= 2.5, `nobody stays on a burning cell (flames + margin): ${r.cellSecs.join(', ') || 'none'}`);
}
