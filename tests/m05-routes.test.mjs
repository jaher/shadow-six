/**
 * M5's patrols walk their beats in the real game (found by the M5 solution, 2026-10-29): every route point of every
 * walker and patrol stands on ground the game's nav lets a man walk (its drawn models' clearance included, which the
 * headless grid has not), and each leg can be walked from the point before (the path ends on the point, within a nav cell). Before, e3's
 * west end (19,33) lay inside the start house's clearance and the camp patrol's middle and south points (34,56) / (44,69)
 * inside houses h4's and h6's: e3 and the pair stood stuck turning on the spot, their cones swinging every way. The
 * patrols must also really move: over a minute each covers ground and comes back past where it started.
 */
export const timeout = 300_000;

export default async function m05Routes(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m05');
    G.start();
    const w = G.game.world, bad = [], walkers = w.enemies.filter((e) => (e.route || []).length > 1);
    for (const e of walkers) {
      let prev = [e.x, e.z];
      for (const p of e.route) {
        const g = w.groundAt(p.x, p.z), path = w.findPath(prev[0], prev[1], p.x, p.z, {}), end = path?.[path.length - 1];
        const miss = end ? Math.hypot(end.x - p.x, end.z - p.z) : Infinity;
        if (!g.walkable || miss > 0.6) bad.push(`${e.tag} (${p.x},${p.z}) walkable=${g.walkable} path ${Number.isFinite(miss) ? `ends ${miss.toFixed(2)} m off` : 'none'}`);
        prev = [p.x, p.z];
      }
    }
    // a minute of play: every walker gets well away from his start (a stuck one turns on the spot)
    const start = new Map(walkers.map((e) => [e, [e.x, e.z]])), far = new Map(walkers.map((e) => [e, 0]));
    for (let i = 0; i < 60 / dt; i++) {
      G.game.step(dt);
      for (const e of walkers) far.set(e, Math.max(far.get(e), Math.hypot(e.x - start.get(e)[0], e.z - start.get(e)[1])));
    }
    return { bad, n: walkers.length, still: walkers.filter((e) => far.get(e) < 5).map((e) => `${e.tag} ${far.get(e).toFixed(1)} m`), walked: walkers.map((e) => `${e.tag} ${far.get(e).toFixed(0)}`).join(' ') };
  });
  t.log(`${r.n} walkers; farthest from the start in a minute: ${r.walked}`);
  t.equal(r.bad.join('; '), '', 'every route point walkable and reached from the one before');
  t.equal(r.still.join('; '), '', 'every walker walks his beat');
}
