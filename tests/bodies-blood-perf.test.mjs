/**
 * bodies-design §D.2 blood perf probe, per quality preset (M1): 8 kills at once (8 growing pools on snow, spatter,
 * stains) + a body dragged (smear), then CPU cost of the blood system per frame (sim tick update + frame: pool flow
 * steps, atlas uploads, stain uniforms) p95, and the render-time delta with the blood layers shown vs hidden (GPU
 * proxy, gl.finish). Budgets (high): CPU ≤ 0.3 ms p95, GPU ≤ 0.4 ms.
 */
export default async function bodiesBloodPerf(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const Wp = await import('/src/abilities/weapons.js');
    const out = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
      g.setPreset(q);
      const W = G.world, B = W.blood;
      for (let i = 0; i < 40 && !B.layers; i++) await new Promise((ok) => setTimeout(ok, 50));
      W.enemies.forEach(H.freeze);
      for (const e of W.enemies) e.coneVisible = false;
      const c = W.commandos[0], sp = H.openSpot(W, c.x, c.z, 9);
      H.clearArea(W, sp.x, sp.z, 24);
      const gs = W.enemies.filter((e) => e.alive && e.soldierType !== 'dog').slice(0, 8);
      gs.forEach((e, k) => e.setPosition(sp.x + (k % 4) * 2.2 - 3.3, sp.z + Math.floor(k / 4) * 2.5 - 1.2, k));
      c.setPosition(sp.x - 12, sp.z, 0);
      g.centerOn(sp.x, sp.z); g.setZoom(1);
      // measure the blood system's own CPU time (update in the tick + frame in the render)
      let acc = 0; const up = B.update.bind(B), fr = B.frame.bind(B);
      B.update = (dt) => { const t0 = performance.now(); up(dt); acc += performance.now() - t0; };
      B.frame = () => { const t0 = performance.now(); fr(); acc += performance.now() - t0; };
      const frame = () => { acc = 0; g.advance(1 / 60); const t1 = performance.now(); G.render(1 / 60, 1); G.renderer.renderer.getContext().finish(); return [acc, performance.now() - t1]; };
      for (let i = 0; i < 20; i++) frame();
      for (const e of gs) Wp.fireBullet(W, c, e, 999, 'sniper', 'sniperRifle');
      const cpu = [];
      for (let i = 0; i < 600; i++) cpu.push(frame()[0]);             // 10 s: all 8 pools growing (flow at 10 Hz)
      // GPU proxy: render time with the blood layers visible vs hidden, same view
      const vis = [], hid = [];
      for (let i = 0; i < 150; i++) {
        G.options.blood = true; vis.push(frame()[1]);
        G.options.blood = false; hid.push(frame()[1]);
      }
      G.options.blood = true;
      out[q] = {
        pools: B.pools.length, decals: B.decals.length, stains: B.stats.stains, budget: B.budget,
        cpuMean: +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(3), cpuP95: +H.p95(cpu).toFixed(3), cpuMax: +Math.max(...cpu).toFixed(3),
        renderVis: +H.p95(vis).toFixed(2), renderHid: +H.p95(hid).toFixed(2),
        gpuDelta: +((vis.reduce((a, b) => a + b, 0) - hid.reduce((a, b) => a + b, 0)) / vis.length).toFixed(2), // mean delta
      };
    }
    return out;
  });
  for (const [q, v] of Object.entries(r)) {
    console.log(`    ${q}: ${JSON.stringify(v)}`);
    t.ok(v.pools >= 6, `${q}: pools growing (${v.pools})`);
  }
  t.ok(r.high.cpuP95 < 0.6, `high: blood CPU p95 ${r.high.cpuP95} ms (budget 0.3)`);
}
