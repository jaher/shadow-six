/**
 * "Never see the map boundary" (user request 2026-09-30) — shared body of tests/edges-void-<map>.test.mjs.
 * The scene background is set to pure magenta; the camera is scrolled (arrow-key pan, i.e. the real clamp) into the
 * 4 edges and 4 corners of the map at the minimum and maximum zoom, at 0 / 15 / 45°, on a 16:9, a 32:9 and a phone
 * portrait view; every frame is read back and must contain no magenta (void) pixel. Also: the apron meets the map
 * edge with no height step (seam), stays off the nav grid, and costs a bounded number of draw calls / triangles.
 */
export const VIEWS = [['16:9', 1280, 720], ['32:9', 1920, 540], ['phone portrait', 390, 844]];
export const PUSHES = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
export const TIMEOUT = 240_000; // per-map budget (tests/run.mjs): 144 frames read back; the bigger maps take >90 s under shared load

export async function voidCheck(page, t, id) {
  const info = await page.evaluate(async (id) => {
    const g = window.__game; await g.loadMission(id); g.start();
    const G = g.game, ter = G.mapHandle?.terrain;
    await ter?.apronReady;
    const ap = ter?.apron;
    if (!ap) return { apron: false };
    const W = G.world.width, D = G.world.depth, grid = G.world.grid;
    // seam: apron heights on the map edge = the map's own edge heights
    let seam = 0;
    for (let s = 0; s <= 1; s += 0.01) {
      for (const [x, z] of [[s * W, 0], [s * W, D], [0, s * D], [W, s * D]]) seam = Math.max(seam, Math.abs(ap.heightAt(x, z) - ter.heightAt(x, z)));
    }
    // a step just past the edge (5 cm out) stays small: the apron continues the slope
    let step = 0;
    for (let s = 0.005; s < 1; s += 0.01) {
      for (const [x, z, dx, dz] of [[s * W, 0, 0, -1], [s * W, D, 0, 1], [0, s * D, -1, 0], [W, s * D, 1, 0]]) step = Math.max(step, Math.abs(ap.heightAt(x + dx * 0.05, z + dz * 0.05) - ter.heightAt(x, z)));
    }
    return { apron: true, A: ap.field.A, seam, step, gridW: grid.width, gridD: grid.depth, W, D, stats: ap.stats,
      camApron: G.cameraController.apron };
  }, id);
  t(info.apron, `${id}: the map has a scenery apron`);
  if (!info.apron) return;
  t.equal(info.camApron, info.A, `${id}: the camera knows the apron width`);
  t(info.seam < 0.01, `${id}: apron meets the map edge with no height step (max ${info.seam.toFixed(4)} m)`);
  t(info.step < 0.08, `${id}: no ledge just past the edge (max ${info.step.toFixed(3)} m)`);
  t(info.gridW === info.W && info.gridD === info.D, `${id}: nav grid unchanged (${info.gridW}x${info.gridD})`);
  t.log(`${id}: apron ${info.A} m, ${info.stats.verts} verts, ${info.stats.trees} trees, ground ${info.stats.groundMs} ms, total ${info.stats.ms} ms`);

  const fails = [];
  let frames = 0;
  for (const [vn, w, h] of VIEWS) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await page.evaluate(async ({ PUSHES }) => {
      const THREE = await import('three');
      const g = window.__game, G = g.game, cc = G.cameraController, R = G.renderer, scene = R.scene;
      const bg0 = scene.background;
      scene.background = new THREE.Color(1, 0, 1);
      const cv = R.domElement, sw = 256, sh = Math.max(16, Math.round(256 * cv.height / cv.width));
      const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      const out = [];
      const L = cc.cfg.zoomLevels;
      for (const yaw of [0, 15, 45]) {
        G.cameraRig.setYaw(yaw);
        for (const zoom of [L[0], L[L.length - 1]]) {
          g.setZoom(zoom);
          for (const [sx, sy] of PUSHES) {
            cc.centerOn(G.world.width / 2, G.world.depth / 2);
            for (let i = 0; i < 300; i++) cc.update(0.05, { x: sx, y: sy });
            g.render();
            ctx.drawImage(cv, 0, 0, sw, sh);
            const px = ctx.getImageData(0, 0, sw, sh).data;
            let n = 0;
            for (let k = 0; k < px.length; k += 4) if (px[k] - px[k + 1] > 40 && px[k + 2] - px[k + 1] > 40) n++;
            out.push({ yaw, zoom: +cc.zoom.toFixed(3), sx, sy, n, fp: cc.groundFootprint(0).map((p) => [+p.x.toFixed(1), +p.z.toFixed(1)]) });
          }
        }
      }
      scene.background = bg0;
      G.cameraRig.setYaw(15); g.setZoom(1);
      return out;
    }, { PUSHES });
    for (const c of r) {
      frames++;
      if (c.n > 0) fails.push(`${vn} yaw ${c.yaw} zoom ${c.zoom} push (${c.sx},${c.sy}): ${c.n} void pixels, footprint ${JSON.stringify(c.fp)}`);
    }
  }
  t(frames === VIEWS.length * 3 * 2 * PUSHES.length, `${id}: ${frames} frames checked`);
  t(fails.length === 0, `${id}: no void at any edge / corner, zoom, angle, aspect${fails.length ? '\n         ' + fails.slice(0, 6).join('\n         ') : ''}`);
  await page.setViewportSize({ width: 1280, height: 720 });

  // cost: the apron is a handful of draws and a bounded triangle count
  const perf = await page.evaluate(() => {
    const g = window.__game, G = g.game, ap = G.mapHandle.terrain.apron;
    g.centerOn(0, 0); g.render();
    const on = g.renderStats();
    const t0 = performance.now(); for (let i = 0; i < 20; i++) g.render(); const msOn = (performance.now() - t0) / 20;
    ap.mesh.visible = ap.skirt.visible = false; if (ap.vegetation) ap.vegetation.group.visible = false;
    g.render();
    const off = g.renderStats();
    const t1 = performance.now(); for (let i = 0; i < 20; i++) g.render(); const msOff = (performance.now() - t1) / 20;
    ap.mesh.visible = ap.skirt.visible = true; if (ap.vegetation) ap.vegetation.group.visible = true;
    return { on, off, msOn, msOff };
  });
  const dCalls = perf.on.calls - perf.off.calls, dTris = perf.on.triangles - perf.off.triangles;
  t.log(`${id}: apron cost +${dCalls} draw calls, +${dTris} triangles, ${perf.msOff.toFixed(2)} → ${perf.msOn.toFixed(2)} ms/frame (CPU-side)`);
  t(dCalls <= 16, `${id}: apron adds at most 16 draw calls incl. shadow / depth passes (${dCalls})`);
  t(dTris <= 900000, `${id}: apron adds at most 900k triangles over all passes (${dTris})`);
}
