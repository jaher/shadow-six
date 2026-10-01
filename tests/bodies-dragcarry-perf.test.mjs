/**
 * bodies-design §D.2 perf probe for part C, per quality preset (M1): a Driver dragging a body, the Green Beret
 * carrying one on his shoulders and a DOWNED Diver crawling, all moving at once. Measured per frame: the CPU time of
 * the transported men's model updates (transport placement + the derived clips) p95, the sim step p95, and the whole
 * frame (render + gl.finish) p95 with the transports running vs the same men standing still.
 */
export default async function bodiesDragCarryPerf(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const out = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
      g.setPreset(q);
      const W = G.world;
      W.enemies.forEach(H.freeze);
      for (const e of W.enemies) e.coneVisible = false;
      const cs = W.commandos, gb = cs.find((c) => c.role === 'greenberet'), dr = cs.find((c) => c.role === 'driver'), dv = cs.find((c) => c.role === 'diver');
      const sp = H.openSpot(W, gb.x, gb.z, 9);
      H.clearArea(W, sp.x, sp.z, 24);
      const gs = W.enemies.filter((e) => e.alive && e.soldierType !== 'dog').slice(0, 2);
      gs[0].setPosition(sp.x - 2, sp.z, 0); gs[1].setPosition(sp.x + 2, sp.z, 0);
      gs.forEach((e) => e.die('knife', gb));
      dr.setPosition(sp.x - 3, sp.z, 0); gb.setPosition(sp.x + 3, sp.z, Math.PI); dv.setPosition(sp.x, sp.z + 3, 0);
      g.centerOn(sp.x, sp.z); g.setZoom(1.5);
      const at = (fn, n = 400) => { for (let i = 0; i < n && !fn(); i++) H.run(g, G, 1, 1); return fn(); };
      H.run(g, G, 120, 2);
      // CPU of the transported men's model updates (placement, derived clips) + the frame
      let acc = 0;
      for (const u of [gs[0], gs[1], dv]) { const m = u.model, up = m.update.bind(m); m.update = (dt, uu) => { const t0 = performance.now(); up(dt, uu); acc += performance.now() - t0; }; }
      const frame = () => {
        acc = 0;
        const t0 = performance.now(); g.advance(1 / 60); const sim = performance.now() - t0;
        const t1 = performance.now(); G.render(1 / 60, 1); G.renderer.renderer.getContext().finish();
        return { load: acc, sim, frame: performance.now() - t1 };
      };
      const still = []; for (let i = 0; i < 120; i++) still.push(frame());
      dr.issue({ type: 'ability', id: 'hand', target: gs[0] });
      gb.issue({ type: 'ability', id: 'hand', target: gs[1] });
      dv.takeDamage(dv.hp, null, 'shot');
      at(() => dr.carrying && gb.carrying);
      dr.issue({ type: 'move', x: sp.x - 3, z: sp.z - 8 }); gb.issue({ type: 'move', x: sp.x + 3, z: sp.z - 8 }); dv.issue({ type: 'move', x: sp.x, z: sp.z - 3 });
      const moving = []; for (let i = 0; i < 300; i++) moving.push(frame());
      const P = (a, k) => +H.p95(a.map((x) => x[k])).toFixed(3);
      const M = (a, k) => +(a.reduce((s, x) => s + x[k], 0) / a.length).toFixed(3);
      out[q] = {
        modes: [dr.carryMode, gb.carryMode, dv.state],
        loadCpuMean: M(moving, 'load'), loadCpuP95: P(moving, 'load'),
        simP95Still: P(still, 'sim'), simP95Moving: P(moving, 'sim'),
        frameP95Still: P(still, 'frame'), frameP95Moving: P(moving, 'frame'),
        frameMeanStill: M(still, 'frame'), frameMeanMoving: M(moving, 'frame'),
      };
    }
    return out;
  });
  for (const [q, v] of Object.entries(r)) {
    console.log(`    ${q}: ${JSON.stringify(v)}`);
    t.equal(v.modes.join(), 'drag,shoulder,downed', `${q}: drag + shoulder + downed running`);
  }
  t.ok(r.high.loadCpuP95 < 1.0, `high: transported models CPU p95 ${r.high.loadCpuP95} ms`);
}
