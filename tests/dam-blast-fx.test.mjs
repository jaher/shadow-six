/**
 * M3 dam demolition reads on screen: the charge at the spillway gates on the crest (dam_charge, the raised deck the
 * very blast brings down into the river) goes up in a fireball at the deck's height, while a charge in open river
 * water stays a water column only.
 *
 * Then the reservoir pours through the breach (render/dam-breach.js), at the game camera (zoom 1, yaw 15) from 3 s to
 * 45 s after the blast. Each moment is drawn twice, with the dam water shown and hidden (same state), and compared:
 * - the TOP BAND of the fall — the gap's opening in the face, 4 m down from the crest, between the side pier stubs —
 *   is covered by water (the pixels the water changes), bright (white water) and full across its width row by row,
 *   with no empty rows from its top (where the reservoir comes in) down;
 * - the column under it runs on without a gap down to the pool;
 * - the reservoir upstream of the gap shows the flow drawn in (the funnel's slick and flow lines);
 * - strongest just after the blast and still a strong steady outflow 45 s on (the lake keeps feeding it);
 * - the reservoir has dropped and holds (art/water.js `drains`), the flow surface sits on it.
 * Mid-burst (12 s) and settled (45 s), two more (user: "The water on the river looks too fast after the dam explodes.
 * Its not going as fast when falling vertically" and "Make the transition of the waterfall seamlessly cross all
 * segments, they should be aligned"):
 * - SPEEDS on screen (px/s at zoom 1: luminance profiles along the flow, two frames 0.1 s apart, best normalised
 *   cross-correlation shift): down the fall > on the river near the pool > on the river 16 m further down;
 * - SEAMS: the flow surfaces alone (spray hidden in both), time-averaged over ~1 s so the moving texture smooths out
 *   and only what stands still remains; per screen row down the flow the water's extent (percentiles of its coverage)
 *   and its mean brightness. At each join (the gap's mouth, the lip, the face's foot,
 *   the impact, the river) the brightness jump over 4 rows is compared with the jumps within the pieces, and the water's
 *   edges (smoothed) must not kink (a lateral step or a width jump) — except at the mouth and the lip, where the cheeks
 *   and pier stubs hide them.
 */
export const timeout = 300_000;

export default async function damBlastFx(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, g = G.game;
    await G.loadMission('m03');
    G.start();
    for (let i = 0; i < 4; i++) { g.step(1 / 60); G.render(1 / 60, 1); } // FX scan (map-build terrain)
    const w = g.world, m = w.mission.markers.find((k) => k.id === 'dam_charge');
    const { applyExplosion } = await import('/src/abilities/explosions.js');
    const sap = w.commandos.find((c) => c.role === 'sapper');
    const fired = (x, z) => { const n0 = w.fx.items.length; applyExplosion(w, x, z, 'bomb', sap); return w.fx.items.slice(n0).map((i) => ({ kind: i.kind + (Math.hypot(i.x - x, i.z - z) < 0.5 ? '' : '@far'), y: i.opts?.y ?? null })); };
    const river = fired(70, 63); // mid-river, open water
    const crest = fired(m.x + 1, m.z + 0.3); // on the crest by the spillway gates
    for (let i = 0; i < 20; i++) { g.step(1 / 60); G.render(1 / 60, 1); }
    return { river, crest, dam: !!w.byId?.('dam')?.destroyed || w.objectives.find((o) => o.id === 'o2')?.done };
  });
  const kinds = (a) => a.map((i) => i.kind);
  t.log(`river: ${kinds(r.river).join(',')} | crest: ${r.crest.map((i) => `${i.kind}${i.y != null ? '@y' + i.y.toFixed(2) : ''}`).join(',')}`);
  t.ok(r.dam, 'the crest charge demolishes the dam');
  const fire = r.crest.find((i) => i.kind === 'explosion_large');
  t.ok(fire, 'dam charge on the crest: a fireball (not a water column in the river the crest falls into)');
  t.ok(fire && fire.y > 6.5, `the fireball goes up at the deck (y ${fire?.y})`);
  t.ok(!kinds(r.river).includes('explosion_large'), 'charge in open river water: water column only, no fireball');
  await t.shot('dam-blast-m03');

  // the torrent through the breach, over time
  const f = await page.evaluate(async () => {
    const G = window.__game, g = G.game, w = g.world;
    for (const e of w.enemies) e.coneVisible = false;
    const dam = w.mission.structures.find((s) => s.id === 'dam'), c = Math.cos(dam.rot), s = Math.sin(dam.rot);
    const W = (u, v) => [dam.x + u * c - v * s, dam.z + u * s + v * c];
    g.cameraController.setYaw(15); G.setZoom(1); G.centerOn(...W(0, 2));
    const D = g.mapHandle.damWater, cam = g.renderer.camera, canvas = g.renderer.renderer.domElement;
    const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    const grab = (show) => { D.group.visible = show; g.render(0, 1); ctx.drawImage(canvas, 0, 0); D.group.visible = true; return ctx.getImageData(0, 0, c2.width, c2.height); };
    const V3 = cam.position.constructor;
    const px = (u, y, v) => { const [x, z] = W(u, v), p = new V3(x, y, z).project(cam); return [(p.x * 0.5 + 0.5) * c2.width, (0.5 - p.y * 0.5) * c2.height]; };
    const lum = (img, k) => 0.3 * img.data[k] + 0.59 * img.data[k + 1] + 0.11 * img.data[k + 2];
    const diff = (A, B, k) => Math.abs(A.data[k] - B.data[k]) + Math.abs(A.data[k + 1] - B.data[k + 1]) + Math.abs(A.data[k + 2] - B.data[k + 2]);
    // a screen region from four world corners (u, y, v), sampled row by row: per row the share of pixels the water changes
    const region = (A, B, quad, thr = 36) => {
      const P = quad.map((q) => px(...q)), y0 = Math.round(Math.min(...P.map((p) => p[1]))), y1 = Math.round(Math.max(...P.map((p) => p[1])));
      const rows = []; let n = 0, ch = 0, l = 0;
      for (let y = y0; y <= y1; y++) {
        // the region's left / right edge at this row (the quad's sides are near vertical at yaw 15)
        const t = (y - y0) / Math.max(1, y1 - y0), xl = Math.round(P[0][0] + (P[3][0] - P[0][0]) * t), xr = Math.round(P[1][0] + (P[2][0] - P[1][0]) * t);
        let rn = 0, rc = 0;
        for (let x = xl; x <= xr; x++) {
          const k = (y * c2.width + x) * 4;
          rn++; if (diff(A, B, k) > thr) { rc++; l += lum(A, k); }
        }
        rows.push(rc / Math.max(1, rn)); n += rn; ch += rc;
      }
      let gap = 0, run = 0; for (const q of rows) { run = q < 0.3 ? run + 1 : 0; gap = Math.max(gap, run); }
      const sorted = rows.slice().sort((a, b) => a - b);
      return { cover: ch / Math.max(1, n), lum: ch ? l / ch : 0, rowMed: sorted[sorted.length >> 1], rowMin: sorted[0], gap, rows: rows.length };
    };
    const out = { at: [], speed: {}, seams: {} };
    let el = 0; // (seconds of the dam water's own clock since the blast: the renders above ran with dt 0)
    const step = (n) => { for (let i = 0; i < n; i++) { G.step(); g.render(1 / 60, 1); } el += n / 60; }; // (the render's dt drives the dam water + drain)
    const home = () => { g.cameraController.setYaw(15); G.setZoom(1); G.centerOn(...W(0, 2)); g.render(0, 1); };
    const shot = () => { ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, c2.width, c2.height); };
    const lumAt = (img, x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= img.width || y >= img.height) return NaN; return lum(img, (y * img.width + x) * 4); };
    const med = (x) => x.slice().sort((p, q) => p - q)[x.length >> 1];
    // apparent speed along a screen polyline (px/s, + = with the flow): profiles ±half px across it, 0.1 s apart
    const speedAlong = (mkPts, half, maxSh) => {
      const sp = [];
      for (let m = 0; m < 4; m++) {
        step(5 + m);
        const L = [], pts = mkPts();
        for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], l = Math.hypot(bx - ax, by - ay); for (let d = 0; d < l; d++) L.push([ax + (bx - ax) * d / l, ay + (by - ay) * d / l, -(by - ay) / l, (bx - ax) / l]); }
        const prof = (img) => L.map(([x, y, nx, ny]) => { let a = 0, n = 0; for (let k = -half; k <= half; k++) { const v = lumAt(img, x + nx * k, y + ny * k); if (v === v) { a += v; n++; } } return n ? a / n : 0; });
        const p0 = prof(shot()); step(6); const p1 = prof(shot());
        const corr = (sh) => { let m0 = 0, m1 = 0, n = 0; for (let i = maxSh; i < p0.length - maxSh; i++) { m0 += p0[i]; m1 += p1[i + sh]; n++; } m0 /= n; m1 /= n; let a = 0, b = 0, c = 0; for (let i = maxSh; i < p0.length - maxSh; i++) { const x = p0[i] - m0, y = p1[i + sh] - m1; a += x * y; b += x * x; c += y * y; } return a / Math.sqrt(b * c + 1e-9); };
        let bs = 0, bc = -2; for (let sh = -maxSh; sh <= maxSh; sh++) { const k = corr(sh); if (k > bc) { bc = k; bs = sh; } }
        sp.push(bs / 0.1);
      }
      return med(sp);
    };
    // the river's centreline (world) from the burst's own surge line, a point d m along it
    const along = (line, d) => { for (let i = 0; i + 1 < line.length; i++) { const [ax, az] = line[i], [bx, bz] = line[i + 1], l = Math.hypot(bx - ax, bz - az); if (d <= l || i + 2 === line.length) { const t2 = Math.min(1, d / l); return [ax + (bx - ax) * t2, az + (bz - az) * t2]; } d -= l; } return line.at(-1); };
    const pxW = (x, y, z) => { const p = new V3(x, y, z).project(cam); return [(p.x * 0.5 + 0.5) * c2.width, (0.5 - p.y * 0.5) * c2.height]; };
    const speeds = () => {
      const B2 = D.breach, P = B2.profile, line = B2.surgeLine.map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
      home();
      // the fall: down the gap's left channel from the lip to the pool at the face's foot
      const face = speedAlong(() => [[3.1, P.yLip], [3.6, 2.0], [4.0, 0.8], [4.4, -0.1]].map(([v, y]) => px(-1, y, v)), 5, 40);
      // the river: 8 m windows along its centreline, 4 m and 16 m past where the fall lands
      const river = (d) => { const c = along(line, d); G.centerOn(...c); g.render(0, 1); return speedAlong(() => Array.from({ length: 9 }, (_, k) => { const q = along(line, d - 4 + k); return pxW(q[0], -0.1, q[1]); }), 8, 50); };
      const r = { face, near: river(4), far: river(16) };
      home();
      return r;
    };
    // seams: the flow surfaces alone, time-averaged over 16 frames (~1 s), per screen row down the flow
    const seams = () => {
      home();
      const B2 = D.breach, P = B2.profile, L = P.yTop ?? P.L, meshes = [];
      B2.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
      const flows = meshes.filter((o) => !/spray|mist|cloud/.test(o.name || '')), parts = meshes.filter((o) => /spray|mist|cloud/.test(o.name || ''));
      const grabF = (show) => { for (const o of flows) o.visible = show; for (const o of parts) o.visible = false; g.render(0, 1); const im = shot(); for (const o of meshes) o.visible = true; return im; };
      const [cx] = px(0, 2, 3.5), yTop = Math.round(px(0, L, -2.2)[1]), yBot = Math.round(px(0, -0.1, 12)[1]);
      const x0 = Math.max(0, Math.round(cx - 420)), x1 = Math.min(c2.width - 1, Math.round(cx + 420)), Wd = x1 - x0 + 1, Hd = yBot - yTop + 1;
      const cov = new Float32Array(Wd * Hd), lu = new Float32Array(Wd * Hd), N = 16;
      for (let f2 = 0; f2 < N; f2++) {
        step(4);
        const A = grabF(true), Bi = grabF(false);
        for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
          const k = ((y + yTop) * c2.width + x + x0) * 4, q = y * Wd + x;
          cov[q] += (diff(A, Bi, k) > 30 ? 1 : 0) / N; lu[q] += lum(A, k) / N;
        }
      }
      // per row: the water's extent (the 10th / 90th percentiles of its coverage across the row: robust to the frayed
      // edges and the river's patchy foam) and its coverage-weighted mean brightness
      const rows = new Map();
      for (let y = 0; y < Hd; y++) {
        let tot = 0, lw = 0;
        for (let x = 0; x < Wd; x++) { const cv = cov[y * Wd + x]; if (cv > 0.2) { tot += cv; lw += cv * lu[y * Wd + x]; } }
        if (tot < 20) continue;
        let acc = 0, l = null, rr = null;
        for (let x = 0; x < Wd; x++) { const cv = cov[y * Wd + x]; if (cv > 0.2) acc += cv; if (l == null && acc >= 0.1 * tot) l = x; if (rr == null && acc >= 0.9 * tot) rr = x; }
        rows.set(y + yTop, { L: l, R: rr, mean: lw / tot });
      }
      const sm = (y, key) => { const v = []; for (let k = -4; k <= 4; k++) { const q = rows.get(y + k); if (q) v.push(q[key]); } return v.length >= 5 ? med(v) : null; };
      const jump = (y) => { const a = rows.get(y + 2), b = rows.get(y - 2); return a && b ? Math.abs(a.mean - b.mean) : null; };
      const kink = (y) => { let k = 0; for (const key of ['L', 'R']) { const a = sm(y + 6, key), b = sm(y, key), c = sm(y - 6, key); if (a == null || b == null || c == null) return null; k = Math.max(k, Math.abs(a - 2 * b + c)); } return k; };
      const joins = { mouth: px(0, L, -2.2)[1], lip: px(0, P.yLip, 3.1)[1], foot: px(0, -0.1, 4.3)[1], impact: px(0, -0.1, 6.5)[1], river: px(0, -0.1, 9)[1] };
      const nearJ = (y) => Object.values(joins).some((jy) => Math.abs(y - jy) <= 18);
      const within = []; for (let y = yTop; y <= yBot; y++) if (!nearJ(y)) { const j = jump(y); if (j != null) within.push(j); }
      const res = { within: +med(within).toFixed(2) };
      for (const [name, jy0] of Object.entries(joins)) {
        const jy = Math.round(jy0); let J = 0, K = 0, empty = 0;
        for (let y = jy - 18; y <= jy + 18; y++) { const j = jump(y); if (j != null) J = Math.max(J, j); const k = kink(y); if (k != null) K = Math.max(K, k); if (!rows.has(y)) empty++; }
        res[name] = { y: jy, jump: +J.toFixed(1), kink: K, empty };
      }
      return res;
    };
    for (const T of [3, 6, 12, 30, 45]) {
      step(Math.max(0, Math.round((T - el) * 60)));
      const A = grab(true), B = grab(false);
      // top band: the gap's opening in the face (v 3.1), from the crest (y 7) 4 m down, between the side pier stubs
      const top = region(A, B, [[-1.7, 7, 3.1], [1.7, 7, 3.1], [1.7, 3, 3.1], [-1.7, 3, 3.1]]);
      // the column under it, down to the pool where it lands (the middle 2 m)
      const col = region(A, B, [[-1, 3, 3.1], [1, 3, 3.1], [1, -0.1, 6], [-1, -0.1, 6]]);
      // the reservoir drawn towards the gap: its surface in front of the mouth, seen through the gap (a subtle overlay)
      const ly = w.water?.drains?.[0]?.body?.level ?? 5.8;
      const fun = region(A, B, [[-2, ly, -6], [2, ly, -6], [2, ly, -2.4], [-2, ly, -2.4]], 10);
      const B2 = D.breach, dr = w.water?.drains?.[0];
      out.at.push({ T, top, col, fun, amt: B2.active, level: dr?.body?.level, yTop: B2.profile?.yTop, yLip: B2.profile?.yLip });
      if (T === 12 || T === 45) { out.speed[T] = speeds(); out.seams[T] = seams(); }
    }
    out.from = w.water?.drains?.[0]?.from;
    return out;
  });
  const fx = (x) => (x == null ? 'na' : x.toFixed(2));
  for (const a of f.at) {
    t.log(`t ${a.T}s level ${fx(a.level)} lip ${fx(a.yLip)} | top band cover ${fx(a.top.cover)} lum ${a.top.lum.toFixed(0)} rows med ${fx(a.top.rowMed)} min ${fx(a.top.rowMin)} gap ${a.top.gap}/${a.top.rows}`
      + ` | column cover ${fx(a.col.cover)} rows min ${fx(a.col.rowMin)} gap ${a.col.gap} | reservoir ${fx(a.fun.cover)}`);
  }
  const at = (T) => f.at.find((a) => a.T === T);
  for (const a of f.at) {
    t.ok(a.amt, `${a.T} s: the breach is running`);
    t.ok(a.top.cover >= 0.7, `${a.T} s: water across the top band of the fall (cover ${fx(a.top.cover)} ≥ 0.70)`);
    t.ok(a.top.lum >= 120, `${a.T} s: white water in the top band (luminance ${a.top.lum.toFixed(0)} ≥ 120)`);
    // (row by row the central pier stub hides ~15 % of the band in front of the water)
    t.ok(a.top.rowMed >= 0.6 && a.top.gap === 0, `${a.T} s: full width row by row, no empty rows (median row ${fx(a.top.rowMed)}, gap ${a.top.gap})`);
    t.ok(a.col.rowMin >= 0.6 && a.col.gap === 0, `${a.T} s: a continuous column down to the pool (narrowest row ${fx(a.col.rowMin)})`);
    t.ok(a.fun.cover >= 0.12, `${a.T} s: the reservoir drawn towards the gap (${fx(a.fun.cover)} of it changed)`);
  }
  t.ok(at(3).top.lum >= at(45).top.lum - 5 && at(3).yLip > at(45).yLip, `strongest just after the blast (lip ${fx(at(3).yLip)} → ${fx(at(45).yLip)})`);
  t.ok(at(45).top.cover >= 0.85 * at(6).top.cover, `still a strong outflow at 45 s (top band ${fx(at(45).top.cover)} vs ${fx(at(6).top.cover)} at 6 s)`);
  t.ok(f.from - at(45).level > 0.5 && at(45).level > f.from - 1.2 && Math.abs(at(45).level - at(30).level) < 0.05,
    `the reservoir drops and holds (${fx(f.from)} → ${fx(at(30).level)} → ${fx(at(45).level)})`);
  t.ok(Math.abs(at(45).yTop - at(45).level - 0.05) < 0.01, 'the flow surface sits on the reservoir (no step at its top)');
  for (const T of [12, 45]) {
    const sp = f.speed[T], sj = f.seams[T];
    t.log(`${T} s speeds (px/s, zoom 1): fall ${sp.face}, river near the pool ${sp.near}, river 16 m down ${sp.far}`);
    t.log(`${T} s seams (brightness jump over 4 rows; edge kink px): within the pieces ${sj.within} | ` + ['mouth', 'lip', 'foot', 'impact', 'river'].map((k) => `${k} ${sj[k].jump}/${sj[k].kink}px`).join(' | '));
    t.ok(sp.face >= 150 && sp.face >= 1.6 * sp.near, `${T} s: the fall is the fastest water on screen (${sp.face} px/s vs ${sp.near} on the river by the pool)`);
    t.ok(sp.near > sp.far && sp.near <= 120 && sp.far > 0, `${T} s: the river runs slower than the fall and calms with distance (${sp.near} → ${sp.far} px/s)`);
    for (const k of ['mouth', 'lip', 'foot', 'impact', 'river']) {
      t.ok(sj[k].jump <= Math.max(10, 4 * sj.within), `${T} s: no brightness seam at the ${k} (jump ${sj[k].jump} vs ${sj.within} within the pieces)`);
      if (k !== 'mouth' && k !== 'lip') t.ok(sj[k].kink <= 14, `${T} s: the water's edges run on unbroken past the ${k} (kink ${sj[k].kink} px)`);
    }
  }
  await t.shot('dam-breach-flow-m03');
}
