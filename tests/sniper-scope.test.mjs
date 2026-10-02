/**
 * Sniper scope 2× magnifier (design-spec §5.3): with the rifle armed, the glass shows a live 2× view centred on the
 * cursor (second ortho camera → lens target → composite in the canvas). The reticle is always near-black (never
 * red/green, user request 2026-09-30): a valid shot gets a subtle neutral highlight and the range; no shot gets a dark
 * circle-and-slash mark, greyed "NO SHOT" text and a dimmed, desaturated glass. Zoom 0.5 / 1 / 2 and the yaw options,
 * the hover name tag outside the ring, and the frame budget measured in real frames.
 * Saves tests/out/sniper-scope-{valid,invalid,zoom05,zoom1}.png.
 */
/** Lens placement in device pixels: luminance on rings at 0.85 R (inside the vignetted glass) and 1.3 R (outside it),
 *  with the lens and without (targeting off for one frame). */
async function placement(page) {
  return page.evaluate(() => {
    const G = window.__game.game, r = G.renderer.renderer, gl = r.getContext(), inp = G.input, L = G.hud.cursor._lens;
    const pr = r.getPixelRatio(), c = r.domElement.getBoundingClientRect(), px = new Uint8Array(4);
    const ring = (k) => {
      let s = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        gl.readPixels(Math.round((L.x - c.left + Math.cos(a) * L.radius * k) * pr), Math.round((c.height - (L.y - c.top) + Math.sin(a) * L.radius * k) * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        s += (px[0] + px[1] + px[2]) / 3;
      }
      return s / 24;
    };
    G.render(0, 1);
    const on = { inner: ring(0.85), outer: ring(1.3), drawn: G.scopeMagnifier.stats.drawn, size: G.scopeMagnifier.stats.size, pr, radius: L.radius };
    const tg = inp.targeting; inp.targeting = null;
    G.render(0, 1);
    const off = { inner: ring(0.85), outer: ring(1.3) };
    inp.targeting = tg;
    return { on, off };
  });
}

/** Load M2 and put the sniper within reach of an enemy with a clear shot (a test stage, not a sim). */
export async function stage(page, t) {
  const setup = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m02');
    g.start();
    const G = g.game, w = G.world;
    const sn = w.commandos.find((c) => c.role === 'sniper');
    // nearest standing enemy in the open: the sniper is put 20 m from him with a clear line (a test stage, not a sim)
    const en = w.enemies.filter((e) => e.alive && !e.vehicle && !e.covered).sort((a, b) => Math.hypot(a.x - sn.x, a.z - sn.z) - Math.hypot(b.x - sn.x, b.z - sn.z));
    return { sn: sn.id, enemies: en.slice(0, 12).map((e) => ({ id: e.id, x: e.x, z: e.z })), snp: { x: sn.x, z: sn.z } };
  });
  t.log(JSON.stringify(setup).slice(0, 400));

  // stage: put the sniper 12–20 m from an enemy where the rifle has a clear shot
  const aim = await page.evaluate(async ({ sid, cands }) => {
    const g = window.__game, G = g.game, w = G.world, inp = G.input;
    const sn = w.entities.find((e) => e.id === sid);
    g.select([sid]);
    g.setZoom(1);
    for (const c of cands) {
      const en = w.entities.find((e) => e.id === c.id);
      for (const d of [14, 18, 10]) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = en.x + Math.cos(a) * d, z = en.z + Math.sin(a) * d;
          sn.x = x; sn.z = z;
          if (sn.prevX !== undefined) { sn.prevX = x; sn.prevZ = z; }
          g.centerOn((en.x + x) / 2, (en.z + z) / 2);
          g.render();
          if (!inp.targeting && !inp.beginTargeting('sniper')) return { err: 'no targeting' };
          const p = G.cameraController.worldToScreen(en.x, (en.y || 0) + 0.9, en.z);
          inp._updateTargetCursor(p.x, p.y);
          if (inp.cursor !== 'forbidden') return { id: en.id, x: p.x, y: p.y, cursor: inp.cursor, d, sx: x, sz: z };
        }
      }
    }
    return { err: 'no valid target', cursor: inp.cursor };
  }, { sid: setup.sn, cands: setup.enemies });
  t.log('aim ' + JSON.stringify(aim));
  return { setup, aim };
}

const rgb = (c) => (String(c).match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
const lum = (c) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const chroma = (c) => { const v = rgb(c); return Math.max(...v) - Math.min(...v); };
const dark = (c) => lum(c) < 40 && chroma(c) < 24; // near-black, untinted

export default async function sniperScope(page, t) {
  const { setup, aim } = await stage(page, t);
  t(!aim.err, 'staged a valid sniper shot: ' + JSON.stringify(aim));
  const frames = (n = 3) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const lens = () => page.evaluate(() => {
    const G = window.__game.game, cur = G.hud.cursor, M = G.scopeMagnifier;
    const L = cur.lens;
    return {
      drawn: !!M?.stats.drawn, target: M?.stats.target ?? null, size: M?.stats.size || 0, ms: M?.stats.ms || 0,
      lensClass: cur.root.classList.contains('lens'), bad: cur.root.classList.contains('bad'), cursor: cur.root.dataset.cursor,
      text: L?.rng.textContent || '', ringShown: !!L && !L.root.hidden && getComputedStyle(L.root).display !== 'none',
      sprHidden: getComputedStyle(cur.sprite).display === 'none',
      // every painted colour of the reticle (computed), the no-shot mark, the range text colour
      ink: L ? [...new Set([...L.root.querySelectorAll('.ret path, .ret circle')].filter((n) => !n.closest('.ns') || getComputedStyle(n.closest('.ns')).display !== 'none')
        .flatMap((n) => { const cs = getComputedStyle(n); return [cs.stroke, cs.fill]; }).filter((c) => c && c !== 'none'))] : [],
      noShotMark: !!L && getComputedStyle(L.root.querySelector('.ret .ns')).display !== 'none',
      rngColor: L ? getComputedStyle(L.rng).color : '',
    };
  });

  // --- valid target: dark reticle, the enemy subtly highlighted, range read-out
  await page.mouse.move(aim.x - 30, aim.y - 30);
  await page.mouse.move(aim.x, aim.y, { steps: 3 });
  await frames(4);
  const v = await lens();
  t.log('valid ' + JSON.stringify(v));
  t(v.drawn, 'magnifier drawn while the scope is up');
  t.equal(v.cursor, 'scope', 'scope cursor');
  t(v.lensClass && v.ringShown && v.sprHidden, 'clear ring + reticle replace the opaque scope sprite');
  t(!v.bad, 'valid shot: not the no-shot state');
  t(v.ink.length > 0 && v.ink.every(dark), `reticle near-black on a valid shot (${v.ink.join(' ')})`);
  t(!v.noShotMark, 'no "no shot" mark on a valid shot');
  t(chroma(v.rngColor) < 24, `range text neutral, not tinted (${v.rngColor})`);
  t.equal(v.target, aim.id, 'the enemy under the cursor is highlighted');
  t(/^\d+ m$/.test(v.text), `range read-out "${v.text}"`);

  // lens pixels straight from the canvas, right after a frame: mean RGB on a ring at half the glass radius
  // hover name tag (tooltip) sits outside the 88-px scope ring while the lens is up
  const tagShown = await page.waitForFunction(() => !!window.__game.game.hud.tooltips?.visibleText, null, { timeout: 4000 }).then(() => true, () => false);
  const tag = await page.evaluate(() => {
    const H = window.__game.game.hud, L = H.cursor._lens, bx = H.tooltips?.box, r = bx?.getBoundingClientRect();
    if (!r || bx.hidden) return null;
    const nx = Math.max(r.left, Math.min(L.x, r.right)), ny = Math.max(r.top, Math.min(L.y, r.bottom));
    return { text: bx.textContent, gap: Math.hypot(nx - L.x, ny - L.y), ring: 44 * (H.scale || 1) };
  });
  t.log('tag ' + JSON.stringify({ tagShown, tag }));
  await t.shot('sniper-scope-valid');
  t(tagShown && tag, 'enemy hover name tag shown under the scope');
  if (tag) t(tag.gap > tag.ring, `name tag "${tag.text}" outside the scope ring (${tag.gap.toFixed(1)} px > ${tag.ring.toFixed(1)} px)`);

  const lensPixels = () => page.evaluate(() => {
    const G = window.__game.game, r = G.renderer.renderer, gl = r.getContext(), L = G.hud.cursor._lens;
    G.render(0, 1);
    const pr = r.getPixelRatio(), c = r.domElement.getBoundingClientRect();
    const px = new Uint8Array(4);
    let R = 0, Gs = 0, B = 0, n = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = Math.round((L.x - c.left + Math.cos(a) * L.radius * 0.55) * pr), y = Math.round((c.height - (L.y - c.top) + Math.sin(a) * L.radius * 0.55) * pr);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      R += px[0]; Gs += px[1]; B += px[2]; n++;
    }
    return { r: R / n, g: Gs / n, b: B / n };
  });
  const pv = await lensPixels();

  // --- no shot (the enemy beyond the rifle's reach): dark reticle, no-shot mark, greyed NO SHOT, dimmed glass, no highlight
  await page.evaluate(({ sid, id }) => {
    const w = window.__game.game.world, sn = w.entities.find((e) => e.id === sid), en = w.entities.find((e) => e.id === id);
    const d = Math.hypot(sn.x - en.x, sn.z - en.z) || 1;
    sn.x = en.x + ((sn.x - en.x) / d) * 60; sn.z = en.z + ((sn.z - en.z) / d) * 60;
  }, { sid: setup.sn, id: aim.id });
  await page.mouse.move(aim.x + 1, aim.y);
  await page.mouse.move(aim.x, aim.y);
  await frames(4);
  const b = await lens();
  t.log('invalid ' + JSON.stringify(b));
  await t.shot('sniper-scope-invalid');
  t(b.drawn && b.lensClass, 'magnifier still drawn on an invalid target');
  t(b.bad, 'invalid: no-shot state');
  t(b.ink.length > 0 && b.ink.every(dark), `reticle still near-black with no shot (${b.ink.join(' ')})`);
  t(b.noShotMark, 'dark "no shot" mark shown in the glass');
  t(chroma(b.rngColor) < 24 && lum(b.rngColor) < lum(v.rngColor) - 40, `NO SHOT text greyed (${v.rngColor} → ${b.rngColor})`);
  t.equal(b.target, null, 'no highlight without a shot');
  t(/^NO SHOT · \d+ m$/.test(b.text), `NO SHOT read-out "${b.text}"`);
  const pb = await lensPixels();
  const Y = (p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b, red = (p) => p.r / Math.max(1, (p.g + p.b) / 2);
  t.log('pixels ' + JSON.stringify({ pv, pb }));
  t(Y(pb) < Y(pv) * 0.9, `glass dims with no shot (${Y(pv).toFixed(1)} → ${Y(pb).toFixed(1)})`);
  t(red(pb) < red(pv) * 1.1, `no red cast on the glass (${red(pv).toFixed(2)} → ${red(pb).toFixed(2)})`);
  t(pv.r + pv.g + pv.b > 30, 'the glass shows the world (not black)');

  // back in reach for the zoom / yaw passes
  await page.evaluate(({ sid, x, z }) => { const sn = window.__game.game.world.entities.find((e) => e.id === sid); sn.x = x; sn.z = z; }, { sid: setup.sn, x: aim.sx, z: aim.sz });
  const view = async (zoom, yaw, shot) => {
    const p = await page.evaluate(({ id, sx, sz, zoom, yaw }) => {
      const g = window.__game, G = g.game, en = G.world.entities.find((e) => e.id === id);
      G.cameraRig.setYaw(yaw);
      g.setZoom(zoom);
      g.centerOn((en.x + sx) / 2, (en.z + sz) / 2);
      g.render();
      return G.cameraController.worldToScreen(en.x, (en.y || 0) + 0.9, en.z);
    }, { id: aim.id, sx: aim.sx, sz: aim.sz, zoom, yaw });
    await page.mouse.move(p.x + 2, p.y + 2);
    await page.mouse.move(p.x, p.y);
    await frames(4);
    const st = await lens();
    // the lens camera is centred on the cursor's ground point (± the breathing sway) and spans exactly 2×
    const geo = await page.evaluate(({ x, y }) => {
      const G = window.__game.game, M = G.scopeMagnifier, cc = G.cameraController, L = G.hud.cursor._lens;
      const g0 = cc.screenToGround(x, y), g1 = cc.screenToGround(x + L.radius / 2, y);
      const THREE = M.camera.position.constructor;
      const a = new THREE(g0.x, 0, g0.z).project(M.camera), b = new THREE(g1.x, 0, g1.z).project(M.camera);
      return { cx: a.x, cy: a.y, span: b.x - a.x };
    }, p);
    if (shot) await t.shot(shot);
    t.log(`zoom ${zoom} yaw ${yaw} ` + JSON.stringify({ st, geo, at: [Math.round(p.x), Math.round(p.y)] }));
    t(st.drawn && !st.bad && st.target === aim.id, `zoom ${zoom} yaw ${yaw}: valid, target highlighted`);
    t(Math.abs(geo.cx) < 0.08 && Math.abs(geo.cy) < 0.08, `zoom ${zoom} yaw ${yaw}: centred on the cursor (${geo.cx.toFixed(3)}, ${geo.cy.toFixed(3)})`);
    t(Math.abs(geo.span - 1) < 0.01, `zoom ${zoom} yaw ${yaw}: 2× (rim at ${geo.span.toFixed(3)})`);
  };
  await view(0.5, 15, 'sniper-scope-zoom05');
  await view(1, 0, 'sniper-scope-zoom1');
  await view(2, 45, null);
  await view(1, 15, null);

  // --- the glass shows what the frame shows (water included): lens centre vs the plain frame at the cursor
  const match = async (gx, gz, label) => {
    const p = await page.evaluate(({ gx, gz }) => {
      const g = window.__game, G = g.game;
      g.centerOn(gx, gz);
      g.render();
      return G.cameraController.worldToScreen(gx, 0, gz);
    }, { gx, gz });
    await page.mouse.move(p.x + 1, p.y);
    await page.mouse.move(p.x, p.y);
    await frames(3);
    const m = await page.evaluate(({ x, y }) => {
      const G = window.__game.game, r = G.renderer.renderer, gl = r.getContext(), inp = G.input, cur = G.hud.cursor;
      const pr = r.getPixelRatio(), c = r.domElement.getBoundingClientRect();
      const read = () => {
        const px = new Uint8Array(4 * 25);
        gl.readPixels(Math.round((x - c.left) * pr) - 2, Math.round((c.height - (y - c.top)) * pr) - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const s = [0, 0, 0];
        for (let i = 0; i < 25; i++) for (let k = 0; k < 3; k++) s[k] += px[i * 4 + k] / 25;
        return s;
      };
      G.render(0, 1);
      // redraw the glass without the no-shot dimming or the sway, for a like-for-like pixel compare
      const st = { ...cur.lensState(), bad: false, sway: false, target: null };
      G.scopeMagnifier.frame(st, { view: G.cameraController, camera: G.renderer.camera, water: G.world.water?.system });
      const lens = read();
      const drawn = G.scopeMagnifier.stats.drawn;
      const tg = inp.targeting; inp.targeting = null;
      G.render(0, 1);
      const frame = read();
      inp.targeting = tg;
      return { lens, frame, drawn };
    }, p);
    const d = Math.hypot(m.lens[0] - m.frame[0], m.lens[1] - m.frame[1], m.lens[2] - m.frame[2]);
    t.log(`${label} ` + JSON.stringify(m) + ` d=${d.toFixed(1)}`);
    t(m.drawn, `${label}: lens drawn`);
    return d;
  };
  const wet = await page.evaluate(({ x, z }) => {
    const W = window.__game.game.world.water;
    let best = null;
    for (let r = 2; r < 60 && !best; r += 2) for (let k = 0; k < 24 && !best; k++) {
      const a = (k / 24) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if ((W?.depthAt?.(px, pz) || 0) > 0.8) best = { x: px, z: pz };
    }
    return best;
  }, { x: aim.sx, z: aim.sz });
  t(!!wet, 'found river water near the stage');
  if (wet) {
    const dw = await match(wet.x, wet.z, 'water');
    t(dw < 60, `water: lens matches the frame (Δ ${dw.toFixed(1)})`);
  }

  // --- the glass sits on the cursor in device pixels (vignette inside, untouched frame outside)
  const pl = await placement(page);
  t.log('placement ' + JSON.stringify(pl));
  t(pl.on.inner < pl.off.inner - 3, 'lens drawn inside the glass circle (vignette)');
  t(Math.abs(pl.on.outer - pl.off.outer) < 2, 'frame untouched outside the glass');

  // --- a reused lens image (render over budget: the last image shifted under the cursor) shows what a fresh render
  // shows: same pixels in the glass after a 6 × 4 px cursor move, and a fresh render once the move leaves the margin
  const reuse = await page.evaluate(() => {
    const G = window.__game.game, M = G.scopeMagnifier, cur = G.hud.cursor, r = G.renderer.renderer, gl = r.getContext();
    const ctx = { view: G.cameraController, camera: G.renderer.camera, water: G.world.water?.system };
    const pr = r.getPixelRatio(), c = r.domElement.getBoundingClientRect();
    G.render(0, 1);
    const a = { ...cur.lensState(), sway: false };
    const grid = (s) => { // 7 × 7 samples over the inner glass (r < 0.55 R)
      const out = [], px = new Uint8Array(4);
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const x = s.x + (i / 3) * s.radius * 0.38, y = s.y + (j / 3) * s.radius * 0.38;
        gl.readPixels(Math.round((x - c.left) * pr), Math.round((c.height - (y - c.top)) * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push(px[0], px[1], px[2]);
      }
      return out;
    };
    M._img.ok = false;
    M.frame(a, ctx); // fresh image at a
    const pA = grid({ ...a, x: a.x + 6, y: a.y + 4 }); // control: the glass at a, read where b's will be
    const ema = M._ema, emaR = M._emaReuse;
    M._ema = 5; M._emaReuse = 0; M._age = 0; // a render "costs 5 ms": reuse
    const b = { ...a, x: a.x + 6, y: a.y + 4 };
    M.frame(b, ctx);
    const reused = M.stats.reusedNow, pReuse = grid(b);
    M._img.ok = false;
    M.frame(b, ctx);
    const fresh = !M.stats.reusedNow, pFresh = grid(b);
    M._age = 0;
    const far = { ...a, x: a.x + 30, y: a.y };
    M.frame(far, ctx); // past the margin: rendered, even over budget
    const farFresh = !M.stats.reusedNow;
    M._ema = ema; M._emaReuse = emaR;
    const diff = (p, q) => { let d = 0; for (let i = 0; i < p.length; i++) d += Math.abs(p[i] - q[i]); return d / p.length; };
    return { reused, fresh, farFresh, diff: diff(pReuse, pFresh), control: diff(pA, pFresh) };
  });
  t.log('reuse ' + JSON.stringify(reuse));
  t(reuse.reused && reuse.fresh, 'over budget the lens image is reused for a small cursor move');
  t(reuse.diff < 4, `the reused, shifted image matches a fresh render (mean |Δ| ${reuse.diff.toFixed(2)} / 255)`);
  t(reuse.control > reuse.diff + 2, `… and the move is visible in the glass (unshifted: mean |Δ| ${reuse.control.toFixed(2)})`);
  t(reuse.farFresh, 'a move past the image margin renders afresh');

  // --- budget, measured in 60 real frames (rAF-driven game frames with the scope up, not a tight loop): the lens's own
  // CPU time per frame (stats.ms, MEAN over every frame: a frame that reuses the last lens image costs only the
  // composite, one that renders costs the full pass, so the mean is the amortised cost) must stay under the 0.5 ms
  // budget (design-spec §5.3). Its GPU time (timer queries, median) is checked against the main frame render's.
  const perf = await page.evaluate(async () => {
    const G = window.__game.game, M = G.scopeMagnifier, rig = G.cameraRig, gl = G.renderer.renderer.getContext();
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const T = { lens: [], full: [], main: [], gLens: [], gMain: [] }, pend = [];
    let renders = 0, reused = 0;
    const timed = (fn, key, cpuKey) => (...a) => {
      const q = ext ? gl.createQuery() : null;
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t0 = performance.now();
      try { return fn(...a); } finally {
        if (cpuKey) T[cpuKey].push(performance.now() - t0);
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push([q, key]); }
      }
    };
    const oRig = rig.render, oScope = G._scopeFrame;
    rig.render = timed(oRig.bind(rig), 'gMain', 'main');
    G._scopeFrame = timed(oScope.bind(G), 'gLens', null);
    const poll = () => {
      for (let i = pend.length - 1; i >= 0; i--) {
        const [q, k] = pend[i];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) T[k].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
        pend.splice(i, 1);
      }
    };
    try {
      for (let i = 0; i < 5; i++) await raf();
      const r0 = M.stats.renders, u0 = M.stats.reused;
      for (let i = 0; i < 60; i++) {
        await raf();
        if (M.stats.drawn) { T.lens.push(M.stats.ms); if (!M.stats.reusedNow) T.full.push(M.stats.renderMs); }
        if (ext) poll();
      }
      renders = M.stats.renders - r0; reused = M.stats.reused - u0;
      for (let k = 0; ext && pend.length && k < 20; k++) { await raf(); poll(); }
    } finally { rig.render = oRig; G._scopeFrame = oScope; }
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const r = { frames: T.lens.length, lens: mean(T.lens), lensMedian: med(T.lens), render: med(T.full), renders, reused, ema: M._ema, main: med(T.main), gLens: med(T.gLens), gMain: med(T.gMain), gN: Math.min(T.gLens.length, T.gMain.length), calls: M.stats.calls, size: M.stats.size };
    r.cpuRatio = r.lens / r.main;
    r.gpuRatio = r.gN >= 8 ? r.gLens / r.gMain : null;
    return r;
  });
  t.log('perf (real frames, ms; lens = mean, others medians) ' + JSON.stringify(perf));
  t(perf.frames >= 50, `lens drawn in ${perf.frames}/60 real frames`);
  t(perf.renders >= perf.frames / 4 - 1, `the glass is re-rendered at least every fourth frame (${perf.renders} renders, ${perf.reused} reuses)`);
  t(perf.lens < 0.5, `lens CPU ${perf.lens.toFixed(2)} ms a frame, amortised (one render ${perf.render?.toFixed(2)} ms, ${perf.renders}/${perf.frames} frames) < 0.5 ms budget`);
  t(perf.cpuRatio < 0.35, `lens CPU ${perf.lens.toFixed(2)} ms = ${(perf.cpuRatio * 100).toFixed(0)}% of the main render's ${perf.main.toFixed(2)} ms (< 35%)`);
  if (perf.gpuRatio != null) t(perf.gpuRatio < 0.5, `lens GPU ${perf.gLens.toFixed(2)} ms = ${(perf.gpuRatio * 100).toFixed(0)}% of the main render's ${perf.gMain.toFixed(2)} ms (< 50%)`);

  // --- scope away: no lens, nothing rendered, the plain cursor back
  const off = await page.evaluate(() => {
    const G = window.__game.game;
    G.input.cancelTargeting();
    const f0 = G.scopeMagnifier.stats.frames;
    G.render(0, 1);
    G.hud.update(0);
    return { drawn: G.scopeMagnifier.stats.drawn, frames: G.scopeMagnifier.stats.frames - f0, lens: G.hud.cursor.root.classList.contains('lens') };
  });
  t(!off.drawn && off.frames === 0 && !off.lens, 'no magnifier once the rifle is put away');

  // --- HiDPI / big screen: 1920×1080 CSS at DPR 2 (HUD scale 2): target sized to glass × canvas pixel ratio, placed right
  await page.evaluate(() => window.__game.game.stop()); // the first page is done: stop its loop so it does not compete with the second
  const h = t.harness, p2 = await h.newPage({ width: 1920, height: 1080 }, { deviceScaleFactor: 2 });
  try {
    await h.openGame(p2);
    const s2 = await stage(p2, t);
    t(!s2.aim.err, 'HiDPI: staged a valid shot');
    await p2.mouse.move(s2.aim.x - 20, s2.aim.y);
    await p2.mouse.move(s2.aim.x, s2.aim.y, { steps: 2 });
    await p2.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const q = await placement(p2);
    const want = await p2.evaluate(async ({ radius, pr }) => (await import('/src/render/scope-magnifier.js')).lensTargetSize(radius, pr), { radius: q.on.radius, pr: q.on.pr });
    t.log('hidpi ' + JSON.stringify({ q, want }));
    t(q.on.drawn, 'HiDPI: lens drawn');
    t.equal(q.on.size, want, `HiDPI: lens target ${q.on.size} px for glass r ${q.on.radius} CSS px at pixel ratio ${q.on.pr}`);
    t(q.on.inner < q.off.inner - 3 && Math.abs(q.on.outer - q.off.outer) < 2, 'HiDPI: glass placed on the cursor in device pixels');
    const errs = h.errors(p2);
    t.equal(errs.length, 0, 'HiDPI page: no errors ' + errs.join(' | '));
  } finally {
    await p2.close().catch(() => {});
  }
}
