/**
 * Dynamic resolution (engine/dynamic-res.js, Renderer.setDynamicScale, Game.setDynamicResolution): off on desktop and
 * in test mode by default; when the controller lowers the scale the canvas and every post target follow, frames still
 * draw cleanly, and full scale restores the original size. Driven by the controller's own sampling in Game.frame, whose
 * step is taken before the next frame draws (a canvas resized after its frame presented it black).
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, R = G.renderer;
    await g.loadMission('m01');
    g.start();
    const off = { dynres: !!G.dynres, scale: R.dynamicScale ?? 1 };
    const gl = R.renderer.getContext();
    const full = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    G.mobileDevice = true;
    const on = G.setDynamicResolution('auto'); // test mode: 'auto' stays off
    const forced = G.setDynamicResolution(true);
    // GPU-bound frames missing 60 fps: interval 33 ms, main thread 6 ms
    const d = G.dynres;
    let scale = null;
    for (let i = 0; i < d.windowFrames * 6 && d.scale > 0.7; i++) { const s = d.sample(33.3, 6); if (s != null) { R.setDynamicScale(s); scale = s; } }
    G.render(1 / 60, 1);
    const low = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    const rt = { width: R.composer.renderTarget1.width, height: R.composer.renderTarget1.height };
    const stats = R.frameStats();
    G.setDynamicResolution(false);
    G.render(1 / 60, 1);
    const back = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    return { off, on, forced, scale, full, low, rt: [rt.width, rt.height], stats, back };
  });
  t.log(JSON.stringify(r));
  t.equal(r.off.dynres, false, 'off on desktop / in test mode');
  t.equal(r.on, false, "'auto' stays off in test mode");
  t.equal(r.forced, true);
  t.equal(r.scale, 0.7, 'stepped down to the floor');
  t.near(r.low[0] / r.full[0], 0.7, 0.01, 'canvas width follows');
  t.equal(r.rt[0], r.low[0], 'post targets follow');
  t.ok(!r.stats.contextLost && r.stats.black < 0.5 && r.stats.luma > 10, 'the low-resolution frame draws');
  t.equal(r.back[0], r.full[0], 'full size restored');

  // the controller's steps as Game.frame takes them: the canvas is resized before a frame draws, never after it (a resize
  // clears the drawing buffer: the frame just drawn was presented black — a black flash at every step on phones, M2's
  // opening 1048 -> 891 -> 734 px wide; user 2026-11-08 "I see some flickering when opening mission 02")
  const st = await page.evaluate(() => {
    const G = window.__game.game, R = G.renderer, gl = R.renderer.getContext();
    G.setDynamicResolution(true);
    const d = G.dynres, steps = [0.85, 0.7, 1];
    let k = 0, calls = 0;
    d.sample = () => (++calls % 3 === 0 ? steps[k++ % steps.length] : null);
    const out = [];
    for (let i = 0; i < 12; i++) { G.frame(1 / 60); const f = R.frameStats(5); out.push([gl.drawingBufferWidth, f.luma, f.black]); }
    G.setDynamicResolution(false);
    return out;
  });
  t.log(`frames through the steps (width, luma, black share): ${JSON.stringify(st)}`);
  t.ok(new Set(st.map((x) => x[0])).size >= 3, 'the steps were taken');
  t.equal(st.filter((x) => x[2] > 0.9 || x[1] < 2).length, 0, 'no frame left black by a resolution step');
}
