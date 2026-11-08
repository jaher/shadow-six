/**
 * Page side of the flicker detector (tools/perf/flicker.mjs, tests/opening-flicker.test.mjs): every frame the game
 * draws (Game.frame, one per requestAnimationFrame) is box-filtered on the GPU to a small thumbnail (a chain of 2:1
 * LINEAR blits of the canvas: each thumbnail pixel is the mean of a 16×16 or 32×32 block) and read back asynchronously
 * (a pixel-pack buffer and a fence: no stall, the frame pacing stays the game's), with what the frame showed besides
 * the canvas (loading screen, walkthrough cards, caption) and what changed in it (HD upgrades, programs, draws).
 * Also counted: draws and clears into the canvas outside Game.frame (a canvas drawn between two frames is presented
 * on its own: with preserveDrawingBuffer off, a frame with only that in it).
 *
 * Self-contained (it is serialized into addInitScript). Results: window.__flk = {frames: [{i, t, w, h, px (base64
 * RGBA), m: {…}}], outside: [...]}.
 * @param {{maxW?: number}} o maxW: the thumbnail's width at most (default 80)
 */
export function flickerProbe(o = {}) {
  const maxW = o.maxW || 80;
  const P = (window.__flk = { frames: [], outside: [], on: true, n: 0, err: null, drawFb: null, inFrame: false });
  const G2 = window.WebGL2RenderingContext?.prototype;
  if (!G2) return;
  // which framebuffer draws go to (bindFramebuffer tracked: no getParameter per draw)
  const bind = G2.bindFramebuffer;
  G2.bindFramebuffer = function (target, fb) {
    if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) P.drawFb = fb;
    return bind.call(this, target, fb);
  };
  const note = (kind) => {
    if (P.inFrame || P.drawFb !== null || !P.on) return;
    const st = (new Error().stack || '').split('\n').slice(2, 7).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ');
    if (P.outside.length < 400) P.outside.push({ kind, t: +performance.now().toFixed(1), frame: P.n, st });
  };
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements', 'clear']) {
    const f = G2[k];
    if (typeof f !== 'function') continue;
    G2[k] = function (...a) { note(k); return f.apply(this, a); };
  }
  // mechanism check (art/cloth-wind.js): the clothing flutter's velocity uniform as uploaded — a man is never carried
  // faster than ~30 m/s, a larger value flings his coat metres out (the opening's spiky "capes")
  const names = new WeakMap();
  const gul = G2.getUniformLocation;
  G2.getUniformLocation = function (prog, name) { const l = gul.call(this, prog, name); if (l && name === 'uClothVel') names.set(l, name); return l; };
  const u2 = G2.uniform2fv;
  P.cloth = { max: 0, n: 0, at: [] };
  G2.uniform2fv = function (loc, v, ...a) {
    if (loc && names.has(loc) && P.on) {
      const s = Math.hypot(v[0], v[1]);
      if (s > P.cloth.max) P.cloth.max = +s.toFixed(2);
      if (s > 30) { P.cloth.n++; if (P.cloth.at.length < 20) P.cloth.at.push([P.n, +s.toFixed(1), +(window.shadowSix?.world?.time ?? 0).toFixed(3)]); }
    }
    return u2.call(this, loc, v, ...a);
  };
  let gl = null, levels = [], pbos = [], pend = [], cw = 0, ch = 0;
  const free = () => {
    for (const l of levels) { gl.deleteFramebuffer(l.fb); gl.deleteRenderbuffer(l.rb); }
    levels = [];
  };
  const setup = (w, h) => {
    free();
    let lw = w, lh = h;
    while (lw > maxW) {
      lw = Math.max(1, Math.round(lw / 2)); lh = Math.max(1, Math.round(lh / 2));
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, lw, lh);
      const fb = gl.createFramebuffer();
      bind.call(gl, gl.DRAW_FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      levels.push({ fb, rb, w: lw, h: lh });
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    cw = w; ch = h;
  };
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const poll = () => {
    while (pend.length) {
      const p = pend[0];
      const st = gl.getSyncParameter(p.sync, gl.SYNC_STATUS);
      if (st !== gl.SIGNALED) break;
      pend.shift();
      gl.deleteSync(p.sync);
      const u8 = new Uint8Array(p.w * p.h * 4);
      const prev = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, u8);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prev);
      pbos.push(p.pbo);
      p.rec.px = b64(u8);
    }
  };
  const meta = (g) => {
    const q = (s) => document.querySelector(s);
    const card = q('#wt-card'), cap = q('#wt-cap'), r = g.debug?.mode?.replay;
    // the loading card (ui/loading.js: a menu-kit screen .mk-loading) or its warm-load veil: how opaque it shows
    let lo = 0;
    for (const e of document.querySelectorAll('.mk-loading, .mk-veil, #loading')) {
      if (!e.isConnected) continue;
      const cs = getComputedStyle(e);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') lo = Math.max(lo, +(+cs.opacity).toFixed(2));
    }
    const hd = globalThis.__ssHdTextures, info = g.renderer?.renderer?.info;
    return {
      st: g.state, b: g.building ? 1 : 0, wt: +(g.world?.time ?? 0).toFixed(2), ld: lo, card: card ? card.dataset.kind || '?' : '',
      cap: cap ? (cap.textContent || '').slice(0, 24) : '', hd: hd ? hd.upgraded : 0, pr: info?.programs?.length ?? 0,
      tex: info?.memory?.textures ?? 0, geo: info?.memory?.geometries ?? 0, ts: +(g.timeScale ?? 1).toFixed(2),
      sp: r ? (r.auto ? 'A' : '') + (r.speed ?? '') : '', intro: r?._introOn ? 1 : 0, turbo: r?.pacer?.turbo ? 1 : 0,
      cones: g.cones?.forced ? [...g.cones.forced].map((e) => e.id).join(',') : null,
      cam: (() => { const c = g.cameraRig?.active; return c?.target ? [+c.target.x.toFixed(2), +c.target.z.toFixed(2), +(c.zoom ?? 0).toFixed(3)] : null; })(),
    };
  };
  const capture = (g) => {
    const R = g.renderer?.renderer;
    if (!R) return;
    if (!gl) gl = R.getContext();
    if (gl.isContextLost()) return;
    let m;
    try { m = meta(g); } catch (e) { m = { err: String(e).slice(0, 80) }; }
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w !== cw || h !== ch) setup(w, h);
    const rd = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), dr = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const sc = gl.isEnabled(gl.SCISSOR_TEST), rdis = gl.isEnabled(gl.RASTERIZER_DISCARD);
    if (sc) gl.disable(gl.SCISSOR_TEST);
    if (rdis) gl.disable(gl.RASTERIZER_DISCARD);
    let sw = w, sh = h, src = null;
    for (const l of levels) {
      bind.call(gl, gl.READ_FRAMEBUFFER, src);
      bind.call(gl, gl.DRAW_FRAMEBUFFER, l.fb);
      gl.blitFramebuffer(0, 0, sw, sh, 0, 0, l.w, l.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      src = l.fb; sw = l.w; sh = l.h;
    }
    const pbo = pbos.pop() || gl.createBuffer();
    const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, sw * sh * 4, gl.STREAM_READ);
    bind.call(gl, gl.READ_FRAMEBUFFER, src);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    bind.call(gl, gl.READ_FRAMEBUFFER, rd);
    bind.call(gl, gl.DRAW_FRAMEBUFFER, dr);
    if (sc) gl.enable(gl.SCISSOR_TEST);
    if (rdis) gl.enable(gl.RASTERIZER_DISCARD);
    const rec = { i: P.n, t: +performance.now().toFixed(1), w: sw, h: sh, cw: w, ch: h, px: null, m };
    P.frames.push(rec);
    pend.push({ sync, pbo, w: sw, h: sh, rec });
  };
  const hook = setInterval(() => {
    const g = window.shadowSix;
    if (!g || g.__flkHooked || typeof g.frame !== 'function') return;
    g.__flkHooked = true;
    clearInterval(hook);
    const frame = g.frame;
    g.frame = function (...a) {
      P.inFrame = true;
      try { return frame.apply(this, a); } finally {
        P.inFrame = false;
        P.n++;
        if (P.on) {
          try { if (gl) poll(); capture(this); } catch (e) { P.err = String(e?.stack || e).slice(0, 400); }
        }
      }
    };
  }, 2);
}
