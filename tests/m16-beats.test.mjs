/**
 * M16 in the real game (library-mesh nav): every walker's beat is walkable the short way. A leg of a beat whose path
 * runs far longer than the straight line means a mesh's nav clearance shut the way (M16 bug: the plank platform's low
 * edge and the churns / lamp on its forecourt boxed e1 in by the station, and he walked 60 m round its E end, past the
 * team's starting wood, and saw them with no order given; fixed by the mission's navKeep). Logic only.
 */
export const timeout = 300_000;

export default async function m16Beats(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game;
    await G.loadMission('m16');
    G.start();
    const w = G.game.world, out = [];
    const len = (p, a) => { let L = 0, x = a.x, z = a.z; for (const q of p || []) { L += Math.hypot(q.x - x, q.z - z); x = q.x; z = q.z; } return L; };
    for (const e of w.enemies) {
      const pts = e.route?.points || (Array.isArray(e.route) ? e.route : null);
      if (!pts || pts.length < 2 || e.squad) continue;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        if (k === pts.length - 1 && pts.length === 2) break; // (a ping-pong's way back is the same leg)
        const p = w.findPath(a.x, a.z, b.x, b.z, { maxNodes: 60000, nearRadius: 0.8 });
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        out.push({ tag: e.tag, k, d, L: p ? len(p, a) : null });
      }
    }
    // and e1 in person: from his post he sets off SW and reaches his far turn on time, never coming near the wood
    const e1 = w.enemies.find((e) => e.tag === 'e1'), dt = G.CONFIG.sim.dt;
    let north = Infinity, reached = null;
    while (w.time < 60 && reached === null) { G.game.step(dt); north = Math.min(north, e1.z); if (Math.hypot(e1.x - 168, e1.z - 50) < 1.5) reached = w.time; }
    return { legs: out, north, reached, state: e1.brain?.state };
  });
  for (const l of r.legs) {
    t(l.L !== null, `${l.tag} leg ${l.k}: a path`);
    if (l.L !== null) t(l.L <= l.d * 1.3 + 4, `${l.tag} leg ${l.k}: walked ${l.L.toFixed(1)} m for ${l.d.toFixed(1)} m straight`);
  }
  t(r.reached !== null && r.reached < 45, `e1 reaches his far turn (168,50) the short way (at ${r.reached?.toFixed?.(1)} s)`);
  t(r.north > 30, `e1 never walks up toward the team's wood (northmost z ${r.north.toFixed(1)})`);
  t.equal(r.state, 'IDLE', 'e1 on his beat, nothing seen');
}
