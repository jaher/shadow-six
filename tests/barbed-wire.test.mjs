/**
 * Barbed wire in the running game (GPU, docs/barbed-wire.md §9): M2 camp coping renders at zoom 2 and the default
 * zoom; a slow sub-pixel pan does not make the wire shimmer (integrated wire coverage stays steady frame to frame,
 * against the old 3 cm box placeholder); the layer's frame-time and draw-call cost on M3; the M3 sparks stop when
 * the switch cuts the power; a Sapper's cutters open a crawl-only hole with frayed ends in m00, and the hole he cuts in
 * M3's chain-link fence reads at the default zoom from both sides (a clear opening, its cut edge and folded-back flap
 * standing out from the mesh); per theater (temperate, coast, desert, snow) the barbs read as ~12 cm ticks at zoom 2
 * and every belt type stands out at zoom 1.
 */
export const timeout = 240_000;   // six mission loads (and the cut in M3) under shared GPU load

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

  // ---- M3: perf (wire shown vs hidden, zoom 0.5 high), sparks while powered, none after the switch.
  // The cost is measured in 4 ABBA rounds (shown, hidden, hidden, shown: a linear drift of a shared GPU cancels), each
  // round's delta = mean(shown) − mean(hidden), and the median of the 4 is the cost. One shown / hidden pair swung by
  // ±2 ms on this shared machine (2026-10-08: the same build measured −0.3 and +1.6 ms; interleaved over 4 loads × 5
  // rounds, e3ad728d and the fence-hole master gave pooled medians of 1.16 / 0.86 ms with identical draws and
  // triangles). When the hidden frames alone spread by more than 1 ms the GPU is shared: the 0.3 ms budget is not
  // measurable, the check reports inconclusive and only guards against a gross regression (as anti-tiling does).
  const m3 = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m03'); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const W = G.mapHandle.wire;
    G.cameraController.setZoom(0.5); G.cameraController.centerOn(37, 95); g.advance(0.2);
    const ms = (b) => b.gpuMedian ?? b.wallMedian, show = (v) => { W.group.visible = v; };
    const rounds = [], offs = [];
    let on = null, off = null;
    for (let k = 0; k < 4; k++) {
      show(true); const a = await g.bench(60); show(false); const b = await g.bench(60), b2 = await g.bench(60); show(true); const a2 = await g.bench(60);
      if (!k) { on = a; off = b; }
      rounds.push(+((ms(a) + ms(a2) - ms(b) - ms(b2)) / 2).toFixed(3)); offs.push(ms(b), ms(b2));
    }
    const med = (v) => { const q = [...v].sort((x, y) => x - y), n = q.length; return n % 2 ? q[n >> 1] : (q[n / 2 - 1] + q[n / 2]) / 2; };
    const cost = { ms: +med(rounds).toFixed(3), rounds, offMed: +med(offs).toFixed(3), offSpread: +(Math.max(...offs) - Math.min(...offs)).toFixed(3), timer: on.gpuMedian != null };
    const frames = (n) => { for (let i = 0; i < n; i++) { g.advance(1 / 30); G.render(1 / 30, 1); } };
    const s0 = W.sparksSpawned; frames(240); const s1 = W.sparksSpawned;
    G.world.fencePower.set('st_fence', false);
    frames(240); const s2 = W.sparksSpawned;
    return { on, off, cost, stats: W.stats, sparks: [s0, s1, s2] };
  });
  t.log('M3 perf', JSON.stringify({ on: m3.on, off: m3.off }), 'cost', JSON.stringify(m3.cost), 'stats', JSON.stringify(m3.stats));
  const c = m3.cost;
  if (!c.timer) t.log(`M3 wire cost: no GPU timer query, not checked (wall ${c.ms} ms)`);
  else if (c.offSpread > 1.0) {
    t.log(`M3 wire cost: GPU busy (the hidden frames alone spread ${c.offSpread} ms), 0.3 ms budget check inconclusive: ${c.ms} ms ${JSON.stringify(c.rounds)}`);
    t(c.ms <= Math.max(3, 0.25 * c.offMed), `M3 wire cost ${c.ms} ms on a busy GPU: no gross regression (≤ ${Math.max(3, 0.25 * c.offMed).toFixed(2)})`);
  } else t(c.ms <= 0.3, `M3 wire GPU cost ${c.ms} ms (≤ 0.3) ${JSON.stringify(c)}`);
  t(m3.stats.drawCalls <= 40, `M3 wire draw calls ${m3.stats.drawCalls}`);
  t(m3.sparks[1] - m3.sparks[0] >= 3, `sparks while powered ${m3.sparks}`);
  t(m3.sparks[2] === m3.sparks[1], `no sparks after the switch ${m3.sparks}`);

  // ---- m00: the Sapper cuts the sandbox fence → a walk-through hole with chaotic ends; paths go through on foot
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
    const upright = G.world.findPath(26, 38.5, 26, 41.5), enemy = G.world.findPath(26, 38.5, 26, 41.5, { role: 'enemy' });
    const len = (p) => (p ? p.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - p[i].x, q.z - p[i].z), 0) : Infinity);
    return { ok, cuts: W.stats.cuts, gaps: [...W.gaps], holes: [...W.holes].map(([k, v]) => [k, v.map((H) => ({ d: H.d, side: H.side }))]), uprightLen: +len(upright).toFixed(1), enemyLen: +len(enemy).toFixed(1) };
  });
  t.log('cut', JSON.stringify(cut));
  // a man-sized hole (the strands through it cut up to ~1.95 m, their ends sprung back), not a full-height gap
  t(cut.ok !== false && cut.cuts >= 6 && cut.holes.length === 1 && cut.gaps.length === 0, `cutters open a hole with cut ends ${JSON.stringify(cut)}`);
  t(cut.uprightLen < 4 && cut.enemyLen < 4, `a man on his feet (an enemy too) goes through the hole (${cut.uprightLen} / ${cut.enemyLen} m)`);
  await t.shot('wire-m00-cut');

  // ---- M3: the Sapper's hole in the station's chain-link fence reads at the default view (zoom 1, pitch 40°) from
  // both sides (user: "make them stand out more"). On the fence plane round the hole (u along the wire from its
  // centre, y over the ground): the opening (|u| < 0.35, 0.15–1.75 m) must be clear — the snow behind shows through:
  // brighter than the same pixels with the fence whole (no haze of mesh left in it) — and must stand out from the mesh
  // beside it at the same heights (the crumpled cut edge, the cut ends, the flaps folded back there): mean luminance
  // contrast ≥ 36 (the crawl hole before 2026-10-07: 22 / 31).
  const vis = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    const { HOLE } = await import('/src/art/wire-obstacles.js');
    await g.loadMission('m03'); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    await G.mapHandle.ready;
    const W = G.world, Wl = G.mapHandle.wire;
    W.debug = { ...(W.debug || {}), noDetect: true, invulnerable: true };
    W.fencePower?.set('st_fence', false);
    const sap = W.commandos.find((c) => c.role === 'sapper');
    sap.stop?.(); sap.x = 59.3; sap.z = 77.6;
    const ok = g.useAbility(sap.id, 'cutters', { x: 57.6, z: 79.0 });
    for (let i = 0; i < 12 * 30 && !Wl.holes.size; i++) { g.advance(1 / 30); if (i % 15 === 0) G.render(1 / 30, 1); }
    g.advance(1.5); sap.x = 60.5; sap.z = 76.2; g.advance(0.5);   // the flap open; he steps out of the picture
    Wl.finishBarbs();
    if (!Wl.holes.size) return { ok, holes: 0 };
    const [[key, [H]]] = [...Wl.holes], p = Wl.parts.panels.find((q) => q.runKey === key && H.d >= q.da && H.d <= q.db);
    const f = (H.d - p.da) / (p.db - p.da), L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
    const x0 = p.a[0] + (p.b[0] - p.a[0]) * f, z0 = p.a[1] + (p.b[1] - p.a[1]) * f, gy = p.ga + (p.gb - p.ga) * f, tx = (p.b[0] - p.a[0]) / L, tz = (p.b[1] - p.a[1]) / L;
    const hw = HOLE.w / 2;
    const cam = G.cameraController.camera, cnv = G.renderer.renderer.domElement;
    const c2 = document.createElement('canvas'); c2.width = cnv.width; c2.height = cnv.height;
    const ctx = c2.getContext('2d', { willReadFrequently: true }), Wd = c2.width, Hd = c2.height;
    const grab = () => { g.render(); ctx.drawImage(cnv, 0, 0); const d = ctx.getImageData(0, 0, Wd, Hd).data, Lm = new Float32Array(d.length / 4);
      for (let i = 0; i < Lm.length; i++) Lm[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]; return Lm; };
    const v = new THREE.Vector3(), scr = (u, y) => { v.set(x0 + tx * u, gy + y, z0 + tz * u).project(cam); return [Math.round((v.x * 0.5 + 0.5) * Wd), Math.round((0.5 - v.y * 0.5) * Hd)]; };
    const mean = (A, S) => { let s = 0; for (const k of S) s += A[k]; return s / Math.max(1, S.size); };
    const out = { ok, holes: Wl.holes.size, flaps: Wl.flaps.length, drawCalls: Wl.group.children.filter((o) => o.visible && o.layers.mask & 1).length };
    for (const yaw of [0, 180]) {
      G.cameraController.setYaw?.(yaw); G.cameraController.setZoom(1); G.cameraController.centerOn(H.x, H.z); g.advance(0.1); g.render(); g.render();
      // fence-plane samples every 1 cm → screen pixels: the opening, and the mesh beside the hole (1.35 hw … + 0.45 m)
      const inner = new Set(), side = new Set();
      for (let u = -1.4; u <= 1.4; u += 0.01) for (let y = 0.04; y <= 1.8; y += 0.01) {
        const [sx, sy] = scr(u, y);
        if (sx < 0 || sy < 0 || sx >= Wd || sy >= Hd) continue;
        const k = sy * Wd + sx;
        if (Math.abs(u) < 0.35 && y > 0.15 && y < 1.75) inner.add(k);
        else if (Math.abs(u) > hw * 1.35 && Math.abs(u) < hw * 1.35 + 0.45 && y > 0.15 && y < 1.75) side.add(k);
      }
      for (const k of inner) side.delete(k);
      const on = grab();
      // the same pixels with the fence whole: the holes taken out of the layer, then put back
      const saved = [...Wl.holes];
      Wl.holes.clear(); Wl.rebuild(); Wl.finishBarbs();
      const off = grab();
      for (const [k2, v2] of saved) Wl.holes.set(k2, v2);
      Wl.rebuild(); Wl.finishBarbs(); Wl.setFlaps(Infinity);
      const [ca, cb] = [scr(-hw, 1.0), scr(hw, 1.0)];
      out[yaw] = { Lin: +mean(on, inner).toFixed(1), Lside: +mean(on, side).toFixed(1), LinWhole: +mean(off, inner).toFixed(1), px: inner.size, widthPx: +Math.hypot(cb[0] - ca[0], cb[1] - ca[1]).toFixed(1) };
      out[yaw].contrast = +(out[yaw].Lin - out[yaw].Lside).toFixed(1);
    }
    G.cameraController.setYaw?.(0); G.cameraController.setZoom(2); G.cameraController.centerOn(H.x, H.z); g.advance(0.1); g.render();
    return out;
  });
  t.log('M3 hole', JSON.stringify(vis));
  t(vis.holes === 1 && vis.flaps === 1, `the cutters open one hole with its flap in the chain-link ${JSON.stringify(vis)}`);
  t(vis.drawCalls <= 40, `M3 wire draw calls with the hole ${vis.drawCalls}`);
  for (const yaw of [0, 180]) {
    const r = vis[yaw];
    t(r && r.px > 150 && r.widthPx >= 31, `yaw ${yaw}: the hole ~1 m wide on screen at zoom 1 ${JSON.stringify(r)}`);
    t(r && r.Lin - r.LinWhole >= 15, `yaw ${yaw}: the opening is clear, the snow behind shows through (${r?.Lin} vs ${r?.LinWhole} with the fence whole)`);
    t(r && r.contrast >= 36, `yaw ${yaw}: the hole stands out from the mesh round it at zoom 1: contrast ${r?.contrast} (≥ 36)`);
  }
  await t.shot('wire-m03-hole');
}
