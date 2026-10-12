/**
 * Frames with nothing drawn (an opaque menu covers the view: Game.render(dt, alpha, false)) skip the water's offscreen
 * passes — FFT ocean, caustics, ripples, the mirror reflection — and the view drawn afterwards is the one it would have
 * been: those passes run again before it renders, so no stale reflection or frozen surface shows (perf/gpu-memory).
 */
export default async function waterCovered(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m13');
    g.start();
    const wt = G.world.water;
    if (!wt) return { built: false };
    const gl = G.renderer.renderer.getContext();
    let draws = 0;
    const count = (name) => { const o = gl[name].bind(gl); gl[name] = (...a) => { draws++; return o(...a); }; return () => { gl[name] = o; }; };
    const undo = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'].filter((n) => gl[n]).map(count);
    // a quay with the sea in view, the game paused: the water's clock stands still between frames
    const b = wt.system.bodies.find((x) => x.o.type === 'sea') || wt.system.bodies[0];
    const bx = b?.o?.poly ? b.o.poly.reduce((s, p) => s + p[0], 0) / b.o.poly.length : 60, bz = b?.o?.poly ? b.o.poly.reduce((s, p) => s + p[1], 0) / b.o.poly.length : 60;
    g.centerOn?.(bx, bz);
    G.pause(true);
    for (let i = 0; i < 6; i++) G.render(0, 1, true);
    const grab = () => { const c = G.renderer.renderer.domElement, w = c.width, h = c.height, px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    G.render(0, 1, true);
    const A = grab();
    draws = 0;
    G.render(0, 1, true);
    const drawnFrame = draws;
    const s0 = wt.system.skipped || 0, u0 = wt.system.frames || 0;
    draws = 0;
    for (let i = 0; i < 10; i++) G.render(0, 1, false);
    const coveredDraws = draws / 10;
    const skipped = (wt.system.skipped || 0) - s0, full = (wt.system.frames || 0) - u0;
    G.render(0, 1, true);
    const B = grab();
    undo.forEach((f) => f());
    let sum = 0, n = 0, over = 0;
    for (let i = 0; i < A.length; i += 4) { for (let c = 0; c < 3; c++) { const d = Math.abs(A[i + c] - B[i + c]); sum += d; if (d > 8) over++; } n += 3; }
    return { built: true, drawnFrame, coveredDraws, skipped, full, meanDiff: sum / n, over: over / n };
  });
  t.ok(r.built, 'M13 builds its water');
  if (!r.built) return;
  t.log(`draw calls: ${r.drawnFrame} for a drawn frame, ${r.coveredDraws.toFixed(1)} per covered frame; water passes skipped ${r.skipped} of 10; after: mean |Δ| ${r.meanDiff.toFixed(3)}, ${(r.over * 100).toFixed(3)} % of channels > 8`);
  t.equal(r.skipped, 10, 'every covered frame skips the water passes');
  t.equal(r.full, 0, 'no full water update while covered');
  t.ok(r.coveredDraws < r.drawnFrame * 0.05, `a covered frame draws next to nothing (${r.coveredDraws} vs ${r.drawnFrame})`);
  t.ok(r.meanDiff < 0.25 && r.over < 0.001, `the view after the menu is the view before it: no stale reflection (mean |Δ| ${r.meanDiff.toFixed(3)})`);
}
