/**
 * Terrain & vegetation integration (docs/terrain-pipeline.md, design-spec §4.8 TRACKS): the real splat ground
 * builds per theater, footsteps/crawls stamp deformable trails, the AI tracks query reads their visibility,
 * and every quality preset renders the terrain without errors.
 */
export default async function terrain(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m01');
    g.start();
    const W = G.world, T = W.terrain;
    await T.ready;
    const out = { real: !!T.real, trees: T.stats?.trees || 0, veg: !!T.stats?.vegetation };
    const c = W.commandos.find((k) => k.alive);
    const x0 = c.x, z0 = c.z;
    out.before = T.queryTrails(x0, z0, 12).length;
    c.issue({ type: 'move', x: c.x + 7, z: c.z + 3 });
    for (let i = 0; i < 120; i++) { g.advance(1 / 30); G.render(1 / 30, 1); }
    out.moved = Math.hypot(c.x - x0, c.z - z0);
    out.after = T.queryTrails(x0, z0, 12).length;
    const prints = W.ai.footprints.tracksNear(c.x, c.z, 12);
    out.prints = prints.length;
    out.visOk = prints.every((p) => p.visibility > 0 && p.visibility <= 1);
    out.gy = Number.isFinite(T.groundY(c.x, c.z));
    out.presets = {};
    for (const p of ['low', 'medium', 'high', 'ultra']) {
      g.setPreset(p); g.render(); g.render();
      out.presets[p] = g.renderStats().calls;
    }
    return out;
  });
  console.log('    [terrain]', JSON.stringify(r));
  t.ok(r.real, 'real splat terrain built on the GPU harness');
  t.ok(r.trees > 0, 'seeded mission trees placed');
  t.ok(r.moved > 3, 'commando walked');
  t.ok(r.after > r.before, `footsteps stamped trail records (${r.before} → ${r.after})`);
  t.ok(r.prints > 0 && r.visOk, 'tracksNear returns prints with 0..1 ground visibility');
  t.ok(r.gy, 'groundY finite');
  for (const [p, calls] of Object.entries(r.presets)) t.ok(calls > 0, `${p} renders`);
  await t.shot('terrain-m01-trails');
}
