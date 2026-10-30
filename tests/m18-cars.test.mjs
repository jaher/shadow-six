/**
 * M18's two armoured cars drive their beats in the real game (found by the M18 solution, 2026-10-29): every route point
 * is reached, round after round, and neither car stands still longer than its orders say. The route points are laid
 * for the hull centre, and the game's nav keeps a hull out of its drawn models' clearance (which the headless grid has
 * not). Before, sd_e stopped for good under house blk_n's S corner at (186.3,66), 5 minutes in, because its turn
 * point (187.5,66.5) lay inside the house's clearance. sd_w stopped for good at (12,42), a minute in, because its
 * bridgehead halt (24,60) lay inside the clearance of the pillbox pb_w and the bridge's W ramp, and the way to it
 * squeezed between the pillbox and the rock rock_w1. Both cars' eyes stood fixed while the solution waited for their
 * rounds. The commandos are kept out of it (hidden): this is about the cars' own orders.
 */
export const timeout = 300_000;

export default async function m18Cars(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m18');
    G.start();
    const w = G.game.world;
    for (const c of w.commandos) c.hidden = true;
    const route = (id) => G.game.missionDef.vehicles.find((d) => d.id === id).route.points;
    const st = ['sd_w', 'sd_e'].map((id) => { const v = w.byId(id); return { id, v, pts: route(id), best: null, still: 0, maxStill: 0, stillAt: null, lx: v.x, lz: v.z, visits: 0, wasFar: false }; });
    for (const s of st) s.best = s.pts.map(() => Infinity);
    for (let i = 0; i < 450 / dt; i++) {
      G.game.step(dt);
      for (const s of st) {
        const { v } = s;
        s.pts.forEach((p, k) => { s.best[k] = Math.min(s.best[k], Math.hypot(v.x - p.x, v.z - p.z)); });
        // (rounds: back within 3 m of its first point after being 20 m away)
        const d0 = Math.hypot(v.x - s.pts[0].x, v.z - s.pts[0].z);
        if (d0 > 20) s.wasFar = true; else if (d0 < 3 && s.wasFar) { s.visits++; s.wasFar = false; }
        if (Math.hypot(v.x - s.lx, v.z - s.lz) < 0.02) { s.still += dt; if (s.still > s.maxStill) { s.maxStill = s.still; s.stillAt = [v.x, v.z]; } } else s.still = 0;
        s.lx = v.x; s.lz = v.z;
      }
    }
    return st.map((s) => ({
      id: s.id, n: s.pts.length, rounds: s.visits, maxStill: s.maxStill, stillAt: s.stillAt?.map((q) => +q.toFixed(1)),
      longestWait: Math.max(0, ...s.pts.map((p) => p.wait || 0)),
      missed: s.pts.map((p, k) => ({ p: [p.x, p.z], d: s.best[k] })).filter((q) => q.d > 1.5).map((q) => `(${q.p}) ${q.d.toFixed(1)} m off`),
    }));
  });
  for (const c of r) {
    t.log(`${c.id}: ${c.n} points, ${c.rounds} rounds in 450 s, longest halt ${c.maxStill.toFixed(1)} s at ${JSON.stringify(c.stillAt)} (longest wait in its orders ${c.longestWait} s)`);
    t.equal(c.missed.join('; '), '', `${c.id} reaches every point of its route`);
    t(c.rounds >= 3, `${c.id} drives round after round (${c.rounds} rounds)`);
    t(c.maxStill <= c.longestWait + 8, `${c.id} never stands longer than its orders say (${c.maxStill.toFixed(1)} s)`);
  }
}
