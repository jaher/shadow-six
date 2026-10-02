/**
 * "Never see the map boundary" (user request 2026-09-30) — shared body of tests/edges-void-<map>.test.mjs.
 * The scene background is set to pure magenta; the camera is scrolled (arrow-key pan, i.e. the real clamp) into the
 * 4 edges and 4 corners of the map at the minimum and maximum zoom, at 0 / 15 / 45°, on a 16:9, a 32:9 and a phone
 * portrait view; every frame is read back and must contain no magenta (void) pixel. Also: the apron meets the map
 * edge with no height step (seam), stays off the nav grid, and costs a bounded number of draw calls / triangles.
 */
// [name, width, height, zooms]: 'both' = the minimum and maximum zoom, 'min' = the minimum only (the widest view)
export const VIEWS = [['16:9', 1280, 720, 'both'], ['32:9', 1920, 540, 'both'], ['phone portrait', 390, 844, 'both'],
  ['phone landscape (Pixel 7)', 863, 360, 'min'], ['21:9', 2560, 1080, 'min']];
export const PUSHES = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
export const TIMEOUT = 480_000; // per-map budget (tests/run.mjs): 192 frames read back + a phone page with 24 touch flings; the bigger maps take >90 s under shared load

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
    // shores crossing the edge (tests/shore-seam-metric.mjs): bank contours on the real map + apron meshes, 5 m either
    // side of the seam (the old extruded seam band jogged, notched or turned 90 deg there)
    let seams = [];
    if (ter.shore && !G.missionDef?.water?.frozen) {
      const M = await import('/tests/shore-seam-metric.mjs'), geo = ap.mesh.geometry;
      const near = (x, z) => { const qx = Math.min(W, Math.max(0, x)), qz = Math.min(D, Math.max(0, z)); return Math.hypot(x - qx, z - qz) < 8; };
      const mesh = M.meshSurface(geo.attributes.position.array, geo.index.array, (x, z) => near(x, z) && !(x > 0.5 && x < W - 0.5 && z > 0.5 && z < D - 0.5));
      const Gd = (x, z) => (x >= 0 && x <= W && z >= 0 && z <= D ? ter.heightAt(x, z) : mesh(x, z));
      seams = M.seamTurns(W, D, Gd, ter.shore.wetAt, -0.35).map((c) => ({ at: c.at, turn: +c.turn.toFixed(1), ref: +c.ref.toFixed(1) }));
    }
    return { apron: true, A: ap.field.A, seam, step, gridW: grid.width, gridD: grid.depth, W, D, stats: ap.stats,
      camApron: G.cameraController.apron, seams };
  }, id);
  t(info.apron, `${id}: the map has a scenery apron`);
  if (!info.apron) return;
  t.equal(info.camApron, info.A, `${id}: the camera knows the apron width`);
  t(info.seam < 0.01, `${id}: apron meets the map edge with no height step (max ${info.seam.toFixed(4)} m)`);
  t(info.step < 0.08, `${id}: no ledge just past the edge (max ${info.step.toFixed(3)} m)`);
  t(info.gridW === info.W && info.gridD === info.D, `${id}: nav grid unchanged (${info.gridW}x${info.gridD})`);
  if (info.seams.length) t.log(`${id}: shores crossing the edges ${info.seams.map((c) => `${c.at} ${c.turn}°${c.ref > 25 ? ` (designed ${c.ref}°)` : ''}`).join(', ')}`);
  // a natural bank: <= 25 deg per 0.5 m; where the mission's own shape has a corner within 5 m of the edge (a quay or
  // pool rectangle), the drawn ground may turn as much as that corner plus 10 deg — never a jog the seam adds
  const jog = info.seams.filter((c) => c.turn > Math.max(25, c.ref + 10));
  t(!jog.length, `${id}: every bank crossing a map edge runs smooth through the map / apron seam (max turn <= 25 deg per 0.5 m, or the designed corner + 10; ${JSON.stringify(jog)})`);
  t.log(`${id}: apron ${info.A} m, ${info.stats.verts} verts, ${info.stats.trees} trees, ground ${info.stats.groundMs} ms, total ${info.stats.ms} ms`);

  const fails = [];
  let frames = 0;
  let want = 0;
  for (const [vn, w, h, zs] of VIEWS) {
    want += 3 * (zs === 'min' ? 1 : 2) * PUSHES.length;
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await page.evaluate(async ({ PUSHES, zs }) => {
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
        for (const zoom of zs === 'min' ? [L[0]] : [L[0], L[L.length - 1]]) {
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
    }, { PUSHES, zs });
    for (const c of r) {
      frames++;
      if (c.n > 0) fails.push(`${vn} yaw ${c.yaw} zoom ${c.zoom} push (${c.sx},${c.sy}): ${c.n} void pixels, footprint ${JSON.stringify(c.fp)}`);
    }
  }
  t(frames === want, `${id}: ${frames} frames checked`);
  t(fails.length === 0, `${id}: no void at any edge / corner, zoom, angle, aspect${fails.length ? '\n         ' + fails.slice(0, 6).join('\n         ') : ''}`);
  await page.setViewportSize({ width: 1280, height: 720 });

  // cost: the apron is a handful of draws and a bounded triangle count
  const perf = await page.evaluate(() => {
    const g = window.__game, G = g.game, ap = G.mapHandle.terrain.apron;
    g.centerOn(0, 0);
    for (let i = 0; i < 8; i++) g.render(); // settle after the 21:9 → 16:9 resize (render targets, queued GPU work)
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

  await touchFlings(t, id);
}

/**
 * Phone in landscape (Pixel 7, 863x360 CSS px, a real touch context): at the minimum zoom and 0 / 15 / 45° a
 * one-finger drag then a fast fling (momentum, src/input/touch-game.js) into each edge and corner. Every coasting
 * frame is read back (no void) and the camera target is checked against the manual-scroll clamp (no overshoot,
 * not even for a frame); the fling ends AT the clamp.
 */
export async function touchFlings(t, id) {
  const { openPhone } = await import('./touch-game-flow.mjs');
  const P = await openPhone(t, 'Pixel 7');
  const { page, drag } = P;
  try {
    await page.setViewportSize({ width: 863, height: 360 });
    await page.evaluate(async (id) => {
      const g = window.__game; await g.loadMission(id); g.start();
      await g.game.mapHandle?.terrain?.apronReady;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, id);
    const fails = [];
    let flings = 0, coastFrames = 0, injected = 0;
    for (const yaw of [0, 15, 45]) {
      for (const [sx, sy] of PUSHES) {
        // a fling whose finger events reach the page late (shared machine) carries no velocity: up to 3 tries
        let w = null, worstVoid = 0, worstOver = 0, frames = 0;
        for (let tries = 0; tries < 3 && !w?.moving; tries++) {
          // start 20 m short of the clamp in the push direction, then drag + fling the view on into it
          await page.evaluate(({ yaw, sx, sy }) => {
            const g = window.__game, G = g.game, cc = G.cameraController;
            G.cameraRig.setYaw(yaw); g.setZoom(0.01);
            if (G.input?.touch) G.input.touch.velocity.x = G.input.touch.velocity.y = 0;
            cc.centerOn(G.world.width / 2, G.world.depth / 2);
            for (let i = 0; i < 400; i++) cc._panScreenMetres(sx * 2, sy * 2);
            cc._panScreenMetres(-sx * 20, -sy * 20);
          }, { yaw, sx, sy });
          const c = [431, 200], r = 150;
          // the ground follows the finger: to see further east the finger moves west
          await drag([c[0] + sx * r, c[1] + sy * r * 0.6], [c[0] - sx * r, c[1] - sy * r * 0.6], 6, 16);
          const watch = page.evaluate(async () => { const THREE = await import('three'); return new Promise((res) => {
            const g = window.__game, G = g.game, cc = G.cameraController, R = G.renderer, cv = R.domElement;
            const bg0 = R.scene.background;
            R.scene.background = new THREE.Color(1, 0, 1);
            const sw = 192, sh = Math.max(16, Math.round(192 * cv.height / cv.width));
            const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
            const ctx = c2.getContext('2d', { willReadFrequently: true });
            let frames = 0, voidMax = 0, over = 0, moving = 0;
            const t0 = performance.now();
            const tick = () => {
              g.render();
              ctx.drawImage(cv, 0, 0, sw, sh);
              const px = ctx.getImageData(0, 0, sw, sh).data;
              let n = 0;
              for (let k = 0; k < px.length; k += 4) if (px[k] - px[k + 1] > 40 && px[k + 2] - px[k + 1] > 40) n++;
              voidMax = Math.max(voidMax, n);
              const f = cc._looseFit(cc.target.x, cc.target.z);
              if (f) over = Math.max(over, Math.hypot(f.x - cc.target.x, f.z - cc.target.z));
              const v = G.input?.touch?.velocity;
              if (v && Math.hypot(v.x, v.y) > 0) moving++;
              frames++;
              if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
              else { R.scene.background = bg0; res({ frames, voidMax, over, moving }); }
            };
            requestAnimationFrame(tick);
          }); });
          if (tries < 2) await drag([c[0] + sx * r * 0.5, c[1] + sy * r * 0.3], [c[0] - sx * r * 0.5, c[1] - sy * r * 0.3], 3, 8); // fling
          else {
            // a loaded machine spaces the page's touch events > 90 ms apart (the release-velocity window: no coast);
            // last try: the release a fast fling produces, through the same momentum path (touch-game.js _panend)
            injected++;
            await page.evaluate(({ sx, sy }) => window.__game.game.input.touch._panend({ vx: -sx * 3000, vy: -sy * 1800 }), { sx, sy });
          }
          w = await watch;
          worstVoid = Math.max(worstVoid, w.voidMax); worstOver = Math.max(worstOver, w.over); frames += w.frames;
        }
        const end = await page.evaluate(({ sx, sy }) => {
          const cc = window.__game.game.cameraController, x = cc.target.x, z = cc.target.z;
          const ca = Math.cos(cc.azimuth), sa = Math.sin(cc.azimuth);
          const f = cc._looseFit(x + (sx * ca + sy * sa) * 50, z + (-sx * sa + sy * ca) * 50); // pushing on: the limit
          return { slack: Math.hypot(f.x - x, f.z - z), zoom: cc.zoom };
        }, { sx, sy });
        flings++; coastFrames += frames;
        const tag = `yaw ${yaw} fling (${sx},${sy})`;
        if (worstVoid > 0) fails.push(`${tag}: ${worstVoid} void pixels while coasting`);
        if (worstOver > 1e-3) fails.push(`${tag}: camera ${worstOver.toFixed(3)} m past the clamp while coasting`);
        if (end.slack > 1) fails.push(`${tag}: stopped ${end.slack.toFixed(1)} m short of the edge (no push into the clamp)`);
        if (!w.moving) fails.push(`${tag}: no momentum after the fling`);
      }
    }
    t.log(`${id}: ${flings} touch flings on Pixel 7 landscape (${injected} released by velocity after 2 slow-event tries), ${coastFrames} coasting frames read back`);
    t(flings === 3 * PUSHES.length, `${id}: ${flings} touch flings`);
    t(fails.length === 0, `${id}: touch flings into every edge / corner show no void and never pass the clamp${fails.length ? '\n         ' + fails.slice(0, 8).join('\n         ') : ''}`);
    t(P.errs.length === 0, `${id}: phone page without errors${P.errs.length ? ': ' + P.errs.slice(0, 2).join(' | ') : ''}`);
  } finally {
    await P.ctx.close().catch(() => {});
  }
}
