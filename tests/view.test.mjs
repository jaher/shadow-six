/**
 * View/render contract: the camera view stays inside the map (BEL), the sun's shadow camera covers
 * tall casters at every screen corner, renderStats are whole-frame totals, vision cones are ground
 * decals occluded by world geometry.
 */
export default async function view(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    const G = g.game;
    const cc = G.cameraController;
    const R = G.renderer;
    const W = G.world.width, D = G.world.depth;
    const THREE = await import('three');
    const out = { W, D, margin: cc.cfg.boundsMargin || 0, corners: [], shadow: [] };
    const cases = [[1, 0, 0], [1, W, D], [0.55, 30, 30], [2, 47, 30], [1, 12, 30], [0.55, 5, 55]];
    for (const yaw of [0, 15, 45]) for (const [z, x, y] of cases) {
      G.cameraRig.setYaw(yaw);
      g.setZoom(z);
      g.centerOn(x, y);
      g.render();
      const fp = cc.groundFootprint(0);
      out.corners.push({ z, yaw, over: cc.clampOvershoot(), fp: fp.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]) });
      // shadow camera must contain every screen-corner hit at y=0 and y=H
      const cam = R.sun.shadow.camera;
      cam.updateMatrixWorld();
      const H = R.shadowCasterHeight;
      let inside = true;
      for (const p of [...fp, ...cc.groundFootprint(H), ...cc.groundFootprint(H / 2)]) {
        const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
        if (Math.abs(v.x) > 1.0001 || Math.abs(v.y) > 1.0001) inside = false;
      }
      out.shadow.push(inside);
    }
    G.cameraRig.setYaw(15);
    g.setZoom(1);
    g.centerOn(30, 30);
    const stats = {};
    for (const p of ['low', 'high']) { g.setPreset(p); g.render(); stats[p] = g.renderStats(); }
    const cones = G.renderer.decalScene.children.length;
    for (const e of G.world.enemies) g.setCone(e.id, true);
    g.render();
    const conesAfter = G.renderer.decalScene.children.length;
    const inOverlay = G.renderer.overlayScene.children.filter((o) => o.name === 'vision-cone').length;
    return { ...out, stats, cones, conesAfter, inOverlay, enemies: G.world.enemies.length };
  });
  t.log(JSON.stringify({ stats: r.stats, shadow: r.shadow, cones: r.conesAfter }));
  for (const c of r.corners) {
    // design-spec §2.3: the view may show up to boundsMargin (4 m) beyond the map edge; with yaw the slanted view
    // corners may overshoot by clampOvershoot() so every map point stays reachable (0 at yaw 0)
    if (c.yaw === 0) t.equal(c.over, 0, 'yaw 0: no overshoot');
    const eps = 0.05 + r.margin + c.over;
    for (const [x, z] of c.fp) {
      t(x >= -eps && x <= r.W + eps && z >= -eps && z <= r.D + eps, `yaw ${c.yaw} zoom ${c.z}: corner (${x},${z}) within ${r.margin} m (+${c.over.toFixed(1)}) of the ${r.W}x${r.D} map`);
    }
  }
  r.shadow.forEach((ok, i) => t(ok, `shadow camera covers all corners at y=0..H (case ${i})`));
  t(r.stats.low.calls > 20, `whole-frame draw calls (low: ${r.stats.low.calls})`);
  t(r.stats.high.triangles > 5000, `whole-frame triangles (high: ${r.stats.high.triangles})`);
  t(r.conesAfter === r.cones + 1, 'the vision cone lives in the decal scene (one shown at a time, design-spec §4.2)');
  t.equal(r.inOverlay, 0, 'no vision cones in the always-on-top overlay');
}
