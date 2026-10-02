/**
 * Water below the M3 dam on the GPU (render/dam-water*.js): the pool overlay is built from the baked flow field on
 * the late FX layer, the white water is brightest at the plunge, its foam pattern is carried DOWNSTREAM on screen
 * (cross-correlation of a luminance profile along the jet between two moments), it freezes while paused, and the
 * whole dam-water layer (sheets, pool, spray, mist) costs ≤ 1.5 ms of render time (visible vs hidden, gl.finish).
 */
export default async function damWater(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    await g.loadMission('m03'); g.start(); await G.mapHandle?.ready;
    for (const e of G.world.enemies) e.coneVisible = false;
    for (let i = 0; i < 6; i++) { g.advance(1 / 30); G.render(1 / 30, 1); }
    const D = G.mapHandle.damWater, gl = G.renderer.renderer.getContext();
    out.built = !!D; out.pool = !!D?.pool; out.stats = D?.stats;
    if (!D?.pool) return out;
    out.layer = D.pool.mesh.layers.mask; out.bakeMs = D.pool.field.ms;
    const dam = G.world.mission.structures.find((s) => s.id === 'dam'), c = Math.cos(dam.rot), s = Math.sin(dam.rot);
    const W = (u, v) => [dam.x + u * c - v * s, dam.z + u * s + v * c];
    const mid = D.pool.mesh.material.uniforms.uBoilV.value - 1.6;
    const [cx, cz] = W(0, mid + 9);
    g.centerOn(cx, cz); g.setZoom(1);
    const cam = G.renderer.camera, canvas = G.renderer.renderer.domElement;
    const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    const grab = () => { G.render(1 / 60, 1); ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, c2.width, c2.height); };
    const V3 = cam.position.constructor;
    const lum = (img, x, z) => {
      const p = new V3(x, -0.1, z).project(cam), px = Math.round((p.x * 0.5 + 0.5) * img.width), py = Math.round((0.5 - p.y * 0.5) * img.height);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) return NaN;
      const k = (py * img.width + px) * 4; return 0.3 * img.data[k] + 0.59 * img.data[k + 1] + 0.11 * img.data[k + 2];
    };
    const meanAt = (img, u0, v0, r) => { let a = 0, n = 0; for (let u = u0 - r; u <= u0 + r; u += 0.25) for (let v = v0 - r; v <= v0 + r; v += 0.25) { const l = lum(img, ...W(u, v)); if (l === l) { a += l; n++; } } return a / n; };
    g.pause(false);
    for (let i = 0; i < 30; i++) { g.advance(1 / 30); G.render(1 / 30, 1); }
    const a = grab();
    out.boil = meanAt(a, 0, mid + 1.8, 1.2); out.side = meanAt(a, -7.5, mid + 9, 1.0); out.far = meanAt(a, 2, mid + 19, 1.2);
    // the foam lace along the jet's centreline, rendered at a moment and dt later (dam water stepped, game paused):
    // the best-correlated shift / dt is the on-screen speed of the pattern (+ = downstream)
    g.pause(true);
    const U = D.pool.mesh.material.uniforms.uTime, T = U.value;
    const prof = (img) => { const p = []; for (let v = mid + 4; v <= mid + 16; v += 0.05) { let l = 0; for (const u of [-0.6, 0, 0.6]) l += lum(img, ...W(u, v)); p.push(l / 3); } return p; };
    const best = (p0, p1) => {
      const corr = (sh) => { let m0 = 0, m1 = 0, n = 0; for (let i = 40; i < p0.length - 40; i++) { m0 += p0[i]; m1 += p1[i + sh]; n++; } m0 /= n; m1 /= n; let s01 = 0, s0 = 0, s1 = 0; for (let i = 40; i < p0.length - 40; i++) { const x = p0[i] - m0, y = p1[i + sh] - m1; s01 += x * y; s0 += x * x; s1 += y * y; } return s01 / Math.sqrt(s0 * s1 + 1e-9); };
      let bs = 0, bc = -2; for (let sh = -40; sh <= 40; sh++) { const k = corr(sh); if (k > bc) { bc = k; bs = sh; } }
      return [bs * 0.05, bc];
    };
    const speeds = [], corrs = [];
    // the foam rides an advected field (render/dam-water-foam.js), so the dam water's own clock is stepped (field
    // included) rather than set: 4 moments ~1 s apart, each compared after 0.1 / 0.2 / 0.3 s
    for (let m = 0; m < 4; m++) {
      for (let i = 0; i < 24 + 7 * m; i++) D.frame(1 / 30);
      for (const dt of [0.1, 0.2, 0.3]) {
        const p0 = prof(grab()); for (let i = 0; i < Math.round(dt * 30); i++) D.frame(1 / 30);
        const [sh, k] = best(p0, prof(grab())); speeds.push(sh / dt); corrs.push(k);
      }
    }
    out.clock = U.value - T;
    const med = (x) => x.slice().sort((p, q) => p - q)[x.length >> 1];
    out.speed = med(speeds); out.corr = med(corrs); out.current = D.pool.field.sample(0, mid + 10).vv;
    g.pause(false);
    // paused: nothing moves
    g.pause(true);
    const f0 = Array.from(prof(grab())); for (let i = 0; i < 5; i++) G.render(1 / 30, 1);
    out.frozen = JSON.stringify(f0) === JSON.stringify(prof(grab()));
    g.pause(false);
    // GPU proxy: render time with the dam water shown vs hidden (zoom 1 on the pool, interleaved)
    g.setZoom(1); g.centerOn(...W(0, mid + 6));
    const frame = () => { g.advance(1 / 60); const t1 = performance.now(); G.render(1 / 60, 1); gl.finish(); return performance.now() - t1; };
    for (let i = 0; i < 20; i++) frame();
    const vis = [], hid = [];
    for (let i = 0; i < 120; i++) { D.group.visible = true; vis.push(frame()); D.group.visible = false; hid.push(frame()); }
    D.group.visible = true;
    out.renderVis = med(vis); out.renderHid = med(hid); out.gpuDelta = med(vis.map((v, i) => v - hid[i]));
    return out;
  });
  console.log(`    ${JSON.stringify(r)}`);
  t.ok(r.built && r.pool, 'dam water + pool built on M3');
  t.ok((r.layer & (1 << 11)) !== 0, 'pool on the late FX layer (drawn over the water)');
  t.ok(r.bakeMs < 2500, `flow bake ${r.bakeMs?.toFixed(0)} ms at load`);
  t.ok(r.boil > r.side + 25 && r.boil > r.far + 15, `white water brightest at the plunge (boil ${r.boil?.toFixed(0)}, side pool ${r.side?.toFixed(0)}, 20 m down ${r.far?.toFixed(0)})`);
  t.ok(r.speed > 0.4 * r.current && r.speed < 2 * r.current && r.corr > 0.5, `foam carried downstream on screen at ${r.speed?.toFixed(2)} m/s (current ${r.current?.toFixed(2)} m/s, corr ${r.corr?.toFixed(2)})`);
  t.ok(r.frozen, 'frozen while paused');
  t.ok(r.gpuDelta <= 1.5, `dam water render cost ${r.gpuDelta?.toFixed(2)} ms (vis ${r.renderVis?.toFixed(2)} / hid ${r.renderHid?.toFixed(2)}; budget 1.5)`);
}
