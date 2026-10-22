/**
 * Straightness of the commandos' trails through the M3 solution (the walkthrough plays the same orders: debug VIDEO MODE
 * `?debug&walkthrough=m03`). User 2026-10-15, watching it: "Looking at mission 3 the trajectory of commandos is very zig
 * baggy, making it more straight and decisive. Longer trajectories rather than zig zagging in small trajectories".
 * Logic only (Game.step, no frames): every commando each tick, every order (tools/solutions/trail-rec.mjs), measured by
 * tools/solutions/trail-metrics.mjs — turns per 10 m walked, the mean straight leg, move orders per minute, halts on
 * the way. Master before the fix: 1.83 turns / 10 m, mean leg 5.3 m, 11.6 orders / min, 290 halts; with the straight
 * dashes and taut paths: 0.96, 9.8 m, 5.5, 36 (tools/solutions/trail.mjs m03 prints the full report).
 */
export const timeout = 900_000;

export default async function m03Straightness(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m03');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { attachTrail, decodeTrail, tagDriver } = await import('/tools/solutions/trail-rec.mjs');
    const { measureTrail, attributeTurns } = await import('/tools/solutions/trail-metrics.mjs');
    const { solve } = await import('/tools/solutions/m03.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const rec = attachTrail(G.game.world, { grid: false });
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); rec.tick(); }, dt, quiet: true, log: () => {} });
    tagDriver(D);
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    const tr = decodeTrail(rec.result());
    rec.dispose(); D.dispose();
    const m = measureTrail(tr), src = attributeTurns(tr, m.turnList).counts;
    const { per, turnList, ...sum } = m;
    return { error, detections: D.detections(), exposures: D.exposureReport().length, sum, per, src };
  });
  t.log(`m03 trails: ${r.sum.walked} m walked, ${r.sum.turnsPer10m} turns / 10 m, mean straight leg ${r.sum.meanLeg} m (median ${r.sum.medianLeg}), ${r.sum.ordersPerMin} move orders / min, walked / straight per order ${r.sum.orderRatioMean}, ${r.sum.pauses} halts on the way (${r.sum.pauseSec} s), wobble ${r.sum.jitterDegPerM} deg / m`);
  t.log(`turn sources: ${JSON.stringify(r.src)}; per man: ${r.per.map((p) => `${p.role} ${p.turnsPer10m}/10m leg ${p.meanLeg}`).join(', ')}`);
  t.equal(r.error, null, 'the solution ran to the end');
  t.equal(r.detections, 0, 'unseen');
  t.equal(r.exposures, 0, 'never in a cone where it sees him');
  t(r.sum.turnsPer10m <= 1.25, `few turns: ${r.sum.turnsPer10m} per 10 m walked (master 1.83)`);
  t(r.sum.meanLeg >= 8, `long straight legs: mean ${r.sum.meanLeg} m (master 5.3)`);
  t(r.sum.ordersPerMin <= 7, `decisive: ${r.sum.ordersPerMin} move orders per minute (master 11.6)`);
  t(r.sum.pauses <= 80, `no stop-and-go: ${r.sum.pauses} halts on the way (master 290)`);
}
