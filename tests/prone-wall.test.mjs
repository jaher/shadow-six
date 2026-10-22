/**
 * Lying down and crawling next to a wall never puts the lying body into it, mesh against mesh (regression: clipping
 * seeds 7 / 11 after the game-rules merge, `diver × ruins:start_wall 0.115 m @t=0.5s`, `greenberet × … 0.11 m`: M3's
 * team starts 0.95 m from start_wall facing it; told to crawl, the body fell along the heading into the ruin).
 * M3's start cover is a ruined watchtower, a broken dry-stone wall and boulders since 2026-10-21 (start_tower,
 * start_wall, start_rocks; the team stands 0.8 m off the wall's N face): every M3 commando at his start, facing the
 * wall: getting down from standing (no order, an order west, an order east) and from a crouch, then lying along the
 * wall sent back the other way (no room to turn round: feet first) — his posed body (src/debug/clip-audit.js
 * entityAudit) stays out of every structure (≤ 5 cm, the clipping test's bar). Node side (grid / footprint, and the
 * old straight wall on a synthetic M3 with it back): tests/unit/prone-wall.test.mjs.
 */
export const timeout = 300_000;

export default async function proneWall(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m03'); g.start(); await G.mapHandle?.ready;
    await g.clipAudit();
    const W = G.world, H = await import('/tests/bodies-page.mjs');
    if (W.alarm) W.alarm.fireEvent = () => {};
    for (const e of W.enemies) { H.freeze(e); e.coneVisible = false; }
    const starts = new Map(W.commandos.map((c) => [c, [c.x, c.z]])), DEG = Math.PI / 180, out = [];
    const worstOf = (u) => { const f = window.__game.clip.entity(u.id, { dt: 0, minDepth: 0.02 }).findings[0]; return f ? { b: f.b.id, depth: f.depth } : null; };
    const stage = (u, stance) => {
      for (const c of W.commandos) if (c !== u) c.setPosition(60, 40);
      const [x, z] = starts.get(u);
      u.stop(); u.setPosition(x, z); u.stance = stance; u._stanceT = 0; u._lieDown = null;
      u.heading = u.prevHeading = 90 * DEG;
      H.run(g, G, 6, 3);
    };
    const watch = (u, n) => {
      let worst = null;
      for (let i = 0; i < n; i += 6) {
        H.run(g, G, 6, 6);
        if (u._stanceT > 0) continue;
        const f = worstOf(u);
        if (f && (!worst || f.depth > worst.depth)) worst = { ...f, at: [+u.x.toFixed(2), +u.z.toFixed(2), Math.round(u.heading / DEG)] };
      }
      return worst;
    };
    for (const u of W.commandos) {
      for (const [from, dx] of [['stand', 0], ['stand', -4], ['stand', 4], ['crouch', 0]]) {
        stage(u, from);
        u.setStance('crawl');
        if (dx) u.issue({ type: 'move', x: u.x + dx, z: u.z - 0.6 });
        out.push({ role: u.role, case: `${from}${dx ? ` → ${dx > 0 ? 'east' : 'west'}` : ''}`, worst: watch(u, 90), end: [+u.x.toFixed(2), +u.z.toFixed(2), Math.round(u.heading / DEG)] });
      }
      // lying along the wall, sent back the other way along it
      stage(u, 'stand');
      u.setStance('crawl');
      H.run(g, G, 40, 4);
      const back = Math.cos(u.heading) > 0 ? -4 : 4, ok = u.issue({ type: 'move', x: u.x + back, z: u.z });
      out.push({ role: u.role, case: `along, back ${back > 0 ? 'east' : 'west'}`, ok, worst: watch(u, 60 * 6), end: [+u.x.toFixed(2), +u.z.toFixed(2), Math.round(u.heading / DEG)] });
    }
    return out;
  });
  for (const q of r) t.log(JSON.stringify(q));
  const bad = r.filter((q) => q.worst && q.worst.depth > 0.05);
  t.ok(r.length === 20, `20 cases (${r.length})`);
  t.ok(!bad.length, `no lying body more than 5 cm into a structure${bad.length ? ': ' + bad.map((q) => `${q.role} ${q.case}: ${q.worst.b} ${q.worst.depth} m at ${q.worst.at}`).join(' | ') : ''}`);
}
