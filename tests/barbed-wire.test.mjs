/**
 * Barbed wire in the running game (GPU, docs/barbed-wire.md §9): M2 camp coping renders at zoom 2 and the default
 * zoom; a slow sub-pixel pan does not make the wire shimmer (integrated wire coverage stays steady frame to frame,
 * against the old 3 cm box placeholder); the layer's frame-time and draw-call cost on M3; the M3 sparks stop when
 * the switch cuts the power; a Sapper's cutters open a crawl-only hole with frayed ends in m00; per theater (temperate, coast,
 * desert, snow) the barbs read as ~12 cm ticks at zoom 2 and every belt type stands out at zoom 1.
 */
export default async function (page, t) {
  // ---- M2: the camp palisade coping at zoom 2 and the default zoom
  const m2 = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m02'); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const W = G.mapHandle.wire, out = { stats: W?.stats ?? null, parent: !!W?.group.parent };
    for (const [z, x, y] of [[2, 29, 21], [1, 44, 34]]) {
      G.cameraController.setZoom(z); G.cameraController.centerOn(x, y); g.advance(0.2); g.render(); g.render();
      out[`z${z}`] = G.renderer.frameStats?.() ?? null;
    }
    return out;
  });
  t.log('M2 wire', JSON.stringify(m2.stats));
  t(m2.parent && m2.stats?.brackets > 40 && m2.stats.ribbonTris > 10000, `M2 coping built ${JSON.stringify(m2.stats)}`);
  for (const k of ['z2', 'z1']) t(m2[k] && !m2[k].contextLost && m2[k].black < 0.5, `M2 ${k} frame ${JSON.stringify(m2[k])}`);
  await t.shot('wire-m2-zoom1');

  // ---- no shimmer: integrated wire coverage over a slow sub-pixel pan, wire layer vs the old box placeholder
  const sh = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    const gal = (await import('/src/missions/dev/wire-gallery.js')).default;
    await G.loadMission({ ...gal, size: [128, 112], theater: 'temperate', weather: { wind: { speed: 0 } } }); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const W = G.mapHandle.wire, cam = G.cameraController.camera, cnv = G.renderer.renderer.domElement;
    const c2 = document.createElement('canvas'); c2.width = cnv.width; c2.height = cnv.height;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    // the field fence (x 4, z 6–20) with old-style 3 cm box wires beside it for the comparison
    const boxes = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x5b5b55, roughness: 0.4, metalness: 0.8 });
    for (const y of [0.5, 1.2, 1.9]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 12), mat); b.position.set(15.5, y, 13); boxes.add(b); }
    G.world.scene.add(boxes);
    // view centre well inside the map (no clamping): the double apron (x 11) and the boxes (x 15.5) on screen
    let X0 = 20, Z0 = 20;
    G.cameraController.setZoom(1); G.cameraController.centerOn(X0, Z0); g.render(); g.render();
    const pxOf = () => (cam.top - cam.bottom) / cam.zoom / cnv.height;
    const rectOf = (x, z0, z1, hw) => {
      const pts = [[x - hw, 0, z0], [x + hw, 2.4, z1], [x - hw, 2.4, z0], [x + hw, 0, z1], [x - hw, 0, z1], [x + hw, 2.4, z0]].map(([a, b, c]) => new THREE.Vector3(a, b, c).project(cam));
      const xs = pts.map((p) => (p.x * 0.5 + 0.5) * cnv.width), ys = pts.map((p) => (0.5 - p.y * 0.5) * cnv.height);
      return [Math.max(0, Math.floor(Math.min(...xs)) - 4), Math.max(0, Math.floor(Math.min(...ys)) - 4), Math.ceil(Math.max(...xs) - Math.min(...xs)) + 8, Math.ceil(Math.max(...ys) - Math.min(...ys)) + 8];
    };
    const lum = (r) => { const d = ctx.getImageData(...r).data, L = new Float32Array(d.length / 4); for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return L; };
    const grab = () => { g.render(); ctx.drawImage(cnv, 0, 0); };
    // crawl metric: per screen ROW, the wire's integrated darkness (|frame − frame without it|) must stay constant
    // while the view slides by sub-pixel steps (an anti-aliased line moves smoothly; an aliased one pops pixels on
    // and off along its length) → mean over rows of the temporal σ, relative to the mean row value
    const series = (show, rect) => {
      const rows = [], pxW = pxOf();
      for (let k = 0; k < 16; k++) {
        // slide across the lines (screen-right), a quarter pixel a frame
        G.cameraController.centerOn(X0, Z0); G.cameraController._panScreenMetres(k * 0.25 * pxW, 0);
        show(true); grab(); const a = lum(rect);
        show(false); grab(); const b = lum(rect);
        const R = new Float32Array(rect[3]);
        for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) R[y] += Math.abs(a[y * rect[2] + x] - b[y * rect[2] + x]);
        rows.push(R);
      }
      const nR = rect[3], use = [];
      for (let y = Math.floor(nR * 0.2); y < Math.floor(nR * 0.8); y++) use.push(y);   // away from the run ends
      let sd = 0, mean = 0;
      for (const y of use) {
        const v = rows.map((R) => R[y]), m = v.reduce((p, q) => p + q, 0) / v.length;
        sd += Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length); mean += m;
      }
      return { mean: +(mean / use.length).toFixed(1), crawl: +(sd / mean).toFixed(4) };
    };
    const zooms = {};
    for (const z of [0.5, 1]) {
      [X0, Z0] = z < 1 ? [40, 32] : [20, 20];   // clear of the map-edge clamp at both zooms
      G.cameraController.setZoom(z); G.cameraController.centerOn(X0, Z0); g.render();
      boxes.visible = false;
      // the wire itself (ribbons, barbs, shadows): the solid pickets are ordinary meshes, AA'd by the post chain
      for (const o of W.group.children) if (o.isInstancedMesh) o.visible = false;
      const wire = series((v) => { W.group.visible = v; }, rectOf(11, 9, 17, 2.4));
      for (const o of W.group.children) o.visible = true;
      W.group.visible = false;
      const box = series((v) => { boxes.visible = v; }, rectOf(15.5, 9, 17, 0.3));
      W.group.visible = true;
      zooms[z] = { wire, box, moved: +(G.cameraController.target.x - X0).toFixed(4) };
    }
    G.world.scene.remove(boxes);
    return { zooms, pxW: +pxOf().toFixed(4) };
  });
  t.log('shimmer', JSON.stringify(sh));
  for (const [z, r] of Object.entries(sh.zooms)) {
    t(r.wire.mean > 50, `zoom ${z}: the wire reads against the ground (${r.wire.mean} per row)`);
    t(r.wire.crawl < 0.12 && r.wire.crawl <= r.box.crawl / 3, `zoom ${z}: no crawl on a sub-pixel pan: wire ${r.wire.crawl} vs box placeholder ${r.box.crawl}`);
  }

  // ---- per theater: zoom 2 → the barbs read as regular dark ticks every ~12 cm along a strand (the along-strand
  // darkness spectrum peaks at 10–14.5 cm, with real amplitude) and the strand is darker than its ground; zoom 1 →
  // every belt type stands out from the ground (mean |wire on − off| over its footprint), coils as dark silhouettes
  const looks = {};
  for (const theater of ['temperate', 'coast', 'desert', 'snow']) {
    looks[theater] = await page.evaluate(async (theater) => {
      const g = window.__game, G = g.game, THREE = await import('three');
      const gal = (await import('/src/missions/dev/wire-gallery.js')).default;
      await G.loadMission({ ...gal, theater, weather: { wind: { speed: 0 } } }); g.start(); g.advance(0.5); G.render(1 / 60, 1);
      await G.mapHandle.ready;
      const W = G.mapHandle.wire, cam = G.cameraController.camera, cnv = G.renderer.renderer.domElement;
      W.finishBarbs();
      const c2 = document.createElement('canvas'); c2.width = cnv.width; c2.height = cnv.height;
      const ctx = c2.getContext('2d', { willReadFrequently: true }), Wd = c2.width, Hd = c2.height;
      const grab = () => { g.render(); ctx.drawImage(cnv, 0, 0); const d = ctx.getImageData(0, 0, Wd, Hd).data, L = new Float32Array(d.length / 4);
        for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return L; };
      const v = new THREE.Vector3(), scr = (p) => { v.set(p[0], p[1], p[2]).project(cam); return [(v.x * 0.5 + 0.5) * Wd, (0.5 - v.y * 0.5) * Hd]; };
      const pair = (insts) => { for (const o of W.group.children) if (o.isInstancedMesh) o.visible = insts; const on = grab(); W.group.visible = false; const off = grab(); W.group.visible = true; for (const o of W.group.children) o.visible = true; return { on, off }; };
      // zoom 2 over the double apron: the along-strand darkness of every long barbed strand on screen
      G.cameraController.setZoom(2); G.cameraController.centerOn(11, 13); g.render(); g.render();
      const { on, off } = pair(false), at = (A, x, y) => A[Math.round(y) * Wd + Math.round(x)], ds = 0.005, cands = [];
      for (const it of W.parts.items) {
        if (it.tie || !it.barbs || it.coil) continue;
        const P = it.path, prof = [];
        const S = [0]; for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
        if (S[S.length - 1] < 2.5) continue;
        for (let d = 0.1, k = 1; d < S[S.length - 1] - 0.1; d += ds) {
          while (k < P.length - 1 && S[k] < d) k++;
          const a = P[k - 1], b = P[k], t = (d - S[k - 1]) / Math.max(1e-9, S[k] - S[k - 1]);
          const p = [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t), s0 = scr(p), s1 = scr(b);
          if (s0[0] < 60 || s0[0] > Wd - 160 || s0[1] < 80 || s0[1] > Hd - 120) { prof.push(null); continue; }
          let tx = s1[0] - s0[0], ty = s1[1] - s0[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          let mn = 1e9; for (let o = -2; o <= 2; o += 0.5) mn = Math.min(mn, at(on, s0[0] - ty * o, s0[1] + tx * o) - at(off, s0[0] - ty * o, s0[1] + tx * o));
          prof.push(-mn);
        }
        let run = [], cur = [];
        for (const q of prof) { if (q == null) { if (cur.length > run.length) run = cur; cur = []; } else cur.push(q); }
        if (cur.length > run.length) run = cur;
        if (run.length * ds < 1.2) continue;
        const n = run.length, mean = run.reduce((p, q) => p + q, 0) / n, x = run.map((q) => q - mean), pw = [];
        for (let per = 0.05; per <= 0.4; per += 0.0025) { let re = 0, im = 0; for (let i = 0; i < n; i++) { const ph = 6.2832 * i * ds / per; re += x[i] * Math.cos(ph); im += x[i] * Math.sin(ph); } pw.push([per, (re * re + im * im) / n]); }
        const med = pw.map((q) => q[1]).sort((p, q) => p - q)[pw.length >> 1];
        const band = pw.filter((q) => q[0] >= 0.1 && q[0] <= 0.145).reduce((p, q) => (q[1] > p[1] ? q : p));
        cands.push({ mean: +mean.toFixed(1), per: +band[0].toFixed(3), ratio: +(band[1] / med).toFixed(1), sd: +Math.sqrt(x.reduce((p, q) => p + q * q, 0) / n).toFixed(1) });
      }
      const ticks = cands.filter((c) => c.ratio >= 8 && c.sd >= 5);
      // zoom 1: each belt's footprint (z 9–17), wire on vs off
      G.cameraController.setZoom(1); G.cameraController.centerOn(30, 14); g.render(); g.render();
      const z1 = pair(true), belts = {};
      for (const [name, x, hw] of [['apron', 11, 1.6], ['knife', 19, 1], ['coil', 26, 0.6], ['triple', 33, 1.4], ['belt', 42, 1.6]]) {
        const pts = [[x - hw, 0, 9], [x + hw, 0, 17], [x - hw, 0, 17], [x + hw, 0, 9]].map(scr);
        const x0 = Math.max(0, Math.min(...pts.map((p) => p[0]))), x1 = Math.min(Wd - 1, Math.max(...pts.map((p) => p[0])));
        const y0 = Math.max(0, Math.min(...pts.map((p) => p[1])) - 30), y1 = Math.min(Hd - 1, Math.max(...pts.map((p) => p[1])));
        let sum = 0, n = 0, dark = 0;
        for (let y = Math.floor(y0); y < y1; y++) for (let xx = Math.floor(x0); xx < x1; xx++) { const k = y * Wd + xx, d = z1.off[k] - z1.on[k]; sum += Math.abs(d); n++; if (d > 20) dark++; }
        belts[name] = { contrast: +(sum / Math.max(1, n)).toFixed(1), dark: +(dark / Math.max(1, n)).toFixed(3) };
      }
      return { cands: cands.length, ticks: ticks.length, best: ticks.sort((a, b) => b.ratio - a.ratio).slice(0, 3), belts };
    }, theater);
  }
  t.log('looks', JSON.stringify(looks));
  for (const [th, r] of Object.entries(looks)) {
    t(r.ticks >= r.cands / 2 && r.best.every((c) => c.mean >= 10), `${th} zoom 2: barbs read as ~12 cm ticks on strands darker than the ground ${JSON.stringify(r.best)} (${r.ticks}/${r.cands})`);
    t(r.belts.apron.dark >= 0.012 && r.belts.coil.contrast >= 3.5 && r.belts.triple.contrast >= 7 && r.belts.knife.contrast >= 10 && r.belts.belt.contrast >= 5.5, `${th} zoom 1: every belt stands out ${JSON.stringify(r.belts)}`);
  }
  t(looks.desert.belts.coil.dark >= 0.1 && looks.desert.belts.triple.dark >= 0.25, `desert zoom 1: coils are dark silhouettes on the sand ${JSON.stringify(looks.desert.belts)}`);

  // ---- M3: perf (wire shown vs hidden, zoom 0.5 high), sparks while powered, none after the switch
  const m3 = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m03'); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const W = G.mapHandle.wire;
    G.cameraController.setZoom(0.5); G.cameraController.centerOn(37, 95); g.advance(0.2);
    const on = await g.bench(60); W.group.visible = false; const off = await g.bench(60); W.group.visible = true;
    const on2 = await g.bench(60);
    const best = (a, b) => ((a.gpuMedian ?? a.wallMedian) <= (b.gpuMedian ?? b.wallMedian) ? a : b);
    const frames = (n) => { for (let i = 0; i < n; i++) { g.advance(1 / 30); G.render(1 / 30, 1); } };
    const s0 = W.sparksSpawned; frames(240); const s1 = W.sparksSpawned;
    G.world.fencePower.set('st_fence', false);
    frames(240); const s2 = W.sparksSpawned;
    return { on: best(on, on2), off, stats: W.stats, sparks: [s0, s1, s2] };
  });
  t.log('M3 perf', JSON.stringify({ on: m3.on, off: m3.off }), 'stats', JSON.stringify(m3.stats));
  const gpu = (b) => b.gpuMedian ?? null;
  const dGpu = gpu(m3.on) != null && gpu(m3.off) != null ? gpu(m3.on) - gpu(m3.off) : null;
  t(dGpu == null || dGpu <= 0.3, `M3 wire GPU cost ${dGpu} ms (≤ 0.3)`);
  t(m3.stats.drawCalls <= 40, `M3 wire draw calls ${m3.stats.drawCalls}`);
  t(m3.sparks[1] - m3.sparks[0] >= 3, `sparks while powered ${m3.sparks}`);
  t(m3.sparks[2] === m3.sparks[1], `no sparks after the switch ${m3.sparks}`);

  // ---- m00: the Sapper cuts the sandbox fence → a crawl-only hole with frayed ends, a crawler's path goes through
  const cut = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00'); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const W = G.mapHandle.wire, sap = G.world.commandos.find((c) => c.role === 'sapper');
    for (const e of G.world.enemies || []) e.takeDamage?.(999, null, 'test');   // the sandbox patrols would shoot him
    sap.x = 26; sap.z = 38.9;
    const ok = g.useAbility(sap.id, 'cutters', { x: 26, z: 40 });
    for (let i = 0; i < 40 * 30 && !W.stats.cuts; i++) { g.advance(1 / 30); if (i % 10 === 0) G.render(1 / 30, 1); }
    G.cameraController.setZoom(2); G.cameraController.centerOn(26, 40); g.advance(0.1); g.render(); g.render();
    const path = G.world.findPath(26, 38.5, 26, 41.5, { crawl: true });
    const upright = G.world.findPath(26, 38.5, 26, 41.5);
    const len = (p) => (p ? p.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - p[i].x, q.z - p[i].z), 0) : Infinity);
    return { ok, cuts: W.stats.cuts, gaps: [...W.gaps], holes: [...W.holes], path: path?.length ?? 0, crawlLen: +len(path).toFixed(1), uprightLen: +len(upright).toFixed(1) };
  });
  t.log('cut', JSON.stringify(cut));
  // a round hole low in the wire (the strands through it cut, their ends bent back), not a full-height gap
  t(cut.ok !== false && cut.cuts >= 2 && cut.holes.length === 1 && cut.gaps.length === 0, `cutters open a hole with frayed ends ${JSON.stringify(cut)}`);
  t(cut.path > 0 && cut.crawlLen < 5, `a crawler's path goes through the hole (${cut.crawlLen} m)`);
  t(cut.uprightLen > cut.crawlLen + 3, `nobody upright goes through it (${cut.uprightLen} m round)`);
  await t.shot('wire-m00-cut');
}
