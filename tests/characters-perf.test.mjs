/**
 * Art integration 2 — character frame cost on 'high': 40 enemies + 6 commandos all on screen at zoom 1 (worst case:
 * nothing culled), half of them walking. Cost = full-frame time (synced, bench median) with the characters minus the
 * same frame with them hidden and not updated. Budget: design target 3 ms; the assertion allows noise headroom.
 * Also checks off-screen culling: characters outside the view are not drawn.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    g.setPreset('high');
    await g.loadMission('m01');
    g.start?.();
    const w = G.world;
    const { Enemy } = await import('/src/entities/enemy.js');
    const { Commando } = await import('/src/entities/commando.js');
    const c0 = w.commandos[0], X = c0.x, Z = c0.z;
    for (const role of ['sniper', 'sapper', 'spy']) w.add(new Commando({ role, x: X, z: Z }));
    for (let k = 0; w.enemies.length < 40; k++) w.add(new Enemy({ id: 'pf' + k, soldierType: ['soldier', 'sentry', 'officer', 'mg'][k % 4], x: X, z: Z }));
    const chars = w.entities.filter((e) => e.kind === 'enemy' || e.kind === 'commando');
    await Promise.all(chars.map((u) => u.model.ready));
    chars.forEach((u, i) => {
      if (u.brain) u.brain.update = () => {};
      u.setPosition(X - 14 + (i % 10) * 3, Z - 6 + Math.floor(i / 10) * 3, i * 0.7);
      u.model.setAnim(i % 2 ? 'walk' : 'idle');
    });
    g.centerOn(X, Z); g.setZoom(1);
    let upd = 0;
    const orig = chars.map((u) => u.renderUpdate);
    chars.forEach((u, i) => { u.renderUpdate = (dt) => { const t0 = performance.now(); orig[i].call(u, dt); upd += performance.now() - t0; }; });
    const on = [], off = [];
    for (let rep = 0; rep < 2; rep++) {
      on.push(await g.bench(90));
      chars.forEach((u) => { u.object3d.visible = false; u.renderUpdate = () => {}; });
      off.push(await g.bench(90));
      chars.forEach((u, i) => { u.object3d.visible = true; u.renderUpdate = (dt) => { const t0 = performance.now(); orig[i].call(u, dt); upd += performance.now() - t0; }; });
    }
    const updPerFrame = upd / (2 * 95);
    const best = (a, k) => Math.min(...a.map((b) => b[k]));
    // off-screen culling: move the view away → bodies hidden
    const [SW, SH] = G.missionDef.size;
    g.centerOn(X > SW / 2 ? 20 : SW - 20, Z > SH / 2 ? 20 : SH - 20); G.render(1 / 60, 1); G.render(1 / 60, 1);
    const tg = G.cameraController.target, far = chars.filter((u) => Math.hypot(u.x - tg.x, u.z - tg.z) > 60);
    const drawn = far.filter((u) => u.model.real?.root.children.find((c) => c.name === 'body')?.visible).length;
    return { n: chars.length, real: chars.filter((u) => u.model.isReal).length, wallOn: best(on, 'wallMedian'), wallOff: best(off, 'wallMedian'),
      gpuOn: best(on, 'gpuMedian'), gpuOff: best(off, 'gpuMedian'), callsOn: on[0].calls, callsOff: off[0].calls, updPerFrame, far: far.length, drawnOffView: drawn };
  });
  const cost = r.wallOn - r.wallOff;
  t.log(JSON.stringify(r), `character cost ${cost.toFixed(2)} ms (update ${r.updPerFrame.toFixed(2)} ms)`);
  t.equal(r.n, 46); t.equal(r.real, 46, 'all real bodies');
  t.ok(cost <= 4.5, `46 characters cost ${cost.toFixed(2)} ms per frame on high (target 3)`);
  t.ok(r.updPerFrame <= 2.5, `animation update ${r.updPerFrame.toFixed(2)} ms`);
  t.ok(r.far > 30 && r.drawnOffView === 0, `off-screen characters culled (${r.drawnOffView} of ${r.far} far ones drawn)`);
}
