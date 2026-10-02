/**
 * Sun glare on water and pale ground (fix/water-glare). The orthographic camera sees every pixel from the same direction,
 * so with the camera facing the sun at its mirror angle (yaw 45 under the 40° NW sun of M13-M15) a specular lobe on the
 * resolved normal lands on the whole screen at once: M15's canals were ~30 % pure white (80 % of the water above 0.8 luma)
 * and its sunlit lawns blew out. Contract: at every Options yaw (0/15/30/45) on M15 (still canal) and M13 (harbour sea)
 *  - at most 2 % of the open-water pixels are near white (luma > 0.92: the sun glint is sparse sparkles, not a sheet),
 *    the water's mean luma rises by at most 0.2 from yaw 0 to the mirror yaw, and its 95th percentile stays < 0.8;
 *  - the glint is still there: at the mirror yaw some sparkles (> 0.8 luma) shine on M15's canal;
 *  - at most 0.5 % of the ground (non-water) pixels are near white.
 * Water pixels: a frame with the water drawn black (dbg 13) against one drawn as its open-water coverage (dbg 14).
 */
export const timeout = 240_000;

export default async function waterGlare(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const cv = G.renderer.renderer.domElement, c2 = document.createElement('canvas');
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    const grab = () => { G.render(0, 1); c2.width = cv.width; c2.height = cv.height; ctx.drawImage(cv, 0, 0); return ctx.getImageData(0, 0, c2.width, c2.height).data; };
    for (const m of ['m15', 'm13']) {
      await g.loadMission(m); g.start(); g.setPreset('high');
      const W = G.world, wt = W.water, sh = wt?.system?.shared;
      if (!sh) { out[m] = null; continue; }
      // the point with the most open water (depth > 0.4 m, no ice) in a 24 m window: the view centre
      const st = 2, nx = Math.ceil(W.grid.cols * W.grid.cell / st), nz = Math.ceil(W.grid.rows * W.grid.cell / st), wet = new Uint8Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const s = wt.sample((i + 0.5) * st, (j + 0.5) * st); wet[j * nx + i] = s && s.depth > 0.4 && !s.ice ? 1 : 0; }
      let best = null, bs = -1;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        if (!wet[j * nx + i]) continue;
        let s = 0; for (let b = -6; b <= 6; b++) for (let a = -6; a <= 6; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) s += wet[jj * nx + ii]; }
        if (s > bs) { bs = s; best = [(i + 0.5) * st, (j + 0.5) * st]; }
      }
      out[m] = { ctr: best, yaws: {} };
      for (const yaw of [0, 15, 30, 45]) {
        G.cameraRig.setYaw(yaw); g.setZoom(1); g.centerOn(best[0], best[1]);
        for (let i = 0; i < 12; i++) { g.step(); G.render(1 / 60, 1); }
        sh.dbg.value = 13; const A = grab().slice();
        sh.dbg.value = 14; const B = grab().slice();
        sh.dbg.value = 0; const C = grab();
        let nW = 0, nB = 0, n8 = 0, sum = 0, nG = 0, nGB = 0; const hist = new Uint32Array(101);
        for (let k = 0; k < C.length; k += 4) {
          const l = (0.2126 * C[k] + 0.7152 * C[k + 1] + 0.0722 * C[k + 2]) / 255;
          const mk = (0.2126 * (B[k] - A[k]) + 0.7152 * (B[k + 1] - A[k + 1]) + 0.0722 * (B[k + 2] - A[k + 2])) / 255;
          if (mk > 0.35) { nW++; sum += l; if (l > 0.92) nB++; if (l > 0.8) n8++; hist[Math.min(100, Math.round(l * 100))]++; } else if (mk < 0.02) { nG++; if (l > 0.92) nGB++; }
        }
        let acc = 0, p95 = 1; for (let i = 0; i <= 100; i++) { acc += hist[i]; if (acc >= nW * 0.95) { p95 = i / 100; break; } }
        out[m].yaws[yaw] = { water: nW / (C.length / 4), blown: nB / Math.max(1, nW), over80: n8 / Math.max(1, nW), mean: sum / Math.max(1, nW), p95, groundBlown: nGB / Math.max(1, nG) };
      }
    }
    return out;
  });
  const f = (x) => +x.toFixed(4);
  for (const [m, v] of Object.entries(r)) {
    t.ok(v, `${m}: water system built`);
    if (!v) continue;
    t.log(`${m} centre ${v.ctr} ` + Object.entries(v.yaws).map(([y, s]) => `y${y} water ${f(s.water)} blown ${f(s.blown)} >0.8 ${f(s.over80)} mean ${f(s.mean)} p95 ${s.p95} ground ${f(s.groundBlown)}`).join(' | '));
    for (const [y, s] of Object.entries(v.yaws)) {
      t.ok(s.water > 0.2, `${m} yaw ${y}: the view is mostly water (${f(s.water)})`);
      t.ok(s.blown <= 0.02, `${m} yaw ${y}: ≤ 2 % of the water near white (${f(s.blown)})`);
      t.ok(s.p95 < 0.8, `${m} yaw ${y}: water 95th percentile luma < 0.8 (${s.p95})`);
      t.ok(s.mean - v.yaws[0].mean <= 0.2, `${m} yaw ${y}: water mean luma within 0.2 of yaw 0 (${f(s.mean)} vs ${f(v.yaws[0].mean)})`);
      t.ok(s.groundBlown <= 0.005, `${m} yaw ${y}: ≤ 0.5 % of the ground near white (${f(s.groundBlown)})`);
    }
  }
  if (r.m15) t.ok(r.m15.yaws[45].over80 > 0.0005, `m15 yaw 45: the sun glint still sparkles on the canal (${f(r.m15.yaws[45].over80)} of the water > 0.8)`);
}
