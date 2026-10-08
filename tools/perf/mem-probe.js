/**
 * Memory probe (page side, measurement only — never shipped): injected with Playwright `addInitScript` before the game
 * boots by tools/perf/measure-memory.mjs and tests/memory.test.mjs.
 *
 * - GPU: wraps the WebGL2 allocation calls (texStorage*, texImage*, compressedTexImage*, generateMipmap, bufferData,
 *   renderbufferStorage*, delete*) and keeps the bytes of every live GL object (mip chains, cube faces, array layers,
 *   MSAA samples, compressed block sizes). `owner`: the three.js object being uploaded when the allocation happened
 *   (the last texture / render target / geometry that registered its 'dispose' listener or went through
 *   renderer.properties.get — set by `__memProbe.hookThree(THREE, renderer)`).
 * - Audio: every AudioBuffer from decodeAudioData / createBuffer (WeakRef + bytes + source URL).
 * - URLs: Response.arrayBuffer / blob results are tagged with their URL so decoded audio and parsed GLBs can be named.
 *
 * `__memProbe.report(opts)` (after a forced GC) returns totals and the attributed GL objects.
 */
(() => {
  if (window.__memProbe) return;
  const P = (window.__memProbe = {
    tex: new Map(), // WebGLTexture → rec
    buf: new Map(), // WebGLBuffer → rec
    rb: new Map(), // WebGLRenderbuffer → rec
    audio: [], // {ref: WeakRef<AudioBuffer>, bytes, url, kind}
    abUrl: new WeakMap(), // ArrayBuffer | Blob → url
    tags: new WeakMap(), // three object | image → url / label
    cur: null, // WeakRef of the three object being uploaded
    canvases: new Set(),
    bitmaps: [], // {ref: WeakRef<ImageBitmap>, url}: decoded images held in the renderer process
  });
  const WR = (o) => (o && typeof o === 'object' ? new WeakRef(o) : null);

  // ---------------------------------------------------------------- URL tags on fetched bodies
  const RP = Response.prototype;
  const oAB = RP.arrayBuffer, oBlob = RP.blob;
  RP.arrayBuffer = function () { const u = this.url; return oAB.call(this).then((ab) => { if (u) P.abUrl.set(ab, u); return ab; }); };
  RP.blob = function () { const u = this.url; return oBlob.call(this).then((b) => { if (u) P.abUrl.set(b, u); return b; }); };
  const oSlice = ArrayBuffer.prototype.slice;
  ArrayBuffer.prototype.slice = function (...a) { const r = oSlice.apply(this, a); const u = P.abUrl.get(this); if (u) P.abUrl.set(r, u); return r; };
  if (typeof createImageBitmap === 'function') {
    const oCIB = window.createImageBitmap;
    window.createImageBitmap = function (src, ...rest) {
      const u = (src && typeof src === 'object' && (P.abUrl.get(src) || src.src)) || null;
      return oCIB.call(this, src, ...rest).then((bmp) => { if (u) P.tags.set(bmp, u); P.bitmaps.push({ ref: new WeakRef(bmp), url: u }); return bmp; });
    };
  }

  // ---------------------------------------------------------------- audio
  const BAC = window.BaseAudioContext?.prototype;
  if (BAC) {
    const oDec = BAC.decodeAudioData;
    BAC.decodeAudioData = function (ab, ...rest) {
      const url = (ab && P.abUrl.get(ab)) || '(unknown)';
      const offline = typeof OfflineAudioContext !== 'undefined' && this instanceof OfflineAudioContext;
      const p = oDec.call(this, ab, ...rest);
      if (p && p.then) p.then((b) => { if (b) P.audio.push({ ref: new WeakRef(b), bytes: b.length * b.numberOfChannels * 4, url, kind: offline ? 'decode@' + b.sampleRate : 'decode', sr: b.sampleRate, ch: b.numberOfChannels, sec: b.duration }); }, () => {});
      return p;
    };
    const oCB = BAC.createBuffer;
    BAC.createBuffer = function (ch, len, sr) {
      const b = oCB.call(this, ch, len, sr);
      P.audio.push({ ref: new WeakRef(b), bytes: ch * len * 4, url: '(createBuffer)', kind: 'synth', sr, ch, sec: len / sr });
      return b;
    };
  }

  // ---------------------------------------------------------------- GL accounting
  const GLP = window.WebGL2RenderingContext?.prototype;
  if (!GLP) return;
  const BPP = {
    0x8058: 4, 0x8C43: 4, 0x8051: 4, 0x8C41: 4, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822F: 4, 0x822E: 4, 0x8230: 8, 0x881A: 8,
    0x8814: 16, 0x881B: 8, 0x8815: 16, 0x8C3A: 4, 0x8059: 4, 0x8232: 1, 0x8234: 2, 0x8236: 4, 0x8238: 2, 0x8D7C: 4,
    0x8231: 1, 0x8233: 2, 0x8235: 4, 0x8237: 2, 0x823A: 4, 0x823C: 8, 0x823B: 4, 0x8239: 2, 0x8D70: 16, 0x8D76: 8, 0x8D82: 16, 0x8D88: 8,
    0x8F94: 1, 0x8F95: 2, 0x8F97: 4, 0x8D62: 2, 0x8056: 2, 0x8057: 2, 0x8C3D: 4,
    0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8D48: 1, 0x84F9: 4,
  };
  const UNSIZED = { 0x1908: 4, 0x1907: 4, 0x1909: 1, 0x190A: 2, 0x1906: 1, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84F9: 1 }; // channels (RGB padded)
  const TYPE_MUL = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140B: 2 };
  const PACKED = { 0x84FA: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8368: 4, 0x8C3B: 4, 0x8C3E: 4 }; // bytes per pixel in total
  /** [block w, block h, bytes] of a compressed format, or null. */
  function block(f) {
    if ((f >= 0x83F0 && f <= 0x83F1) || (f >= 0x8C4C && f <= 0x8C4D) || f === 0x8D64 || f === 0x8DBB || f === 0x8DBC) return [4, 4, 8];
    if ((f >= 0x83F2 && f <= 0x83F3) || (f >= 0x8C4E && f <= 0x8C4F) || (f >= 0x8E8C && f <= 0x8E8F) || f === 0x8DBD || f === 0x8DBE) return [4, 4, 16];
    if (f >= 0x9270 && f <= 0x9279) return [4, 4, [8, 8, 16, 16, 8, 8, 8, 8, 16, 16][f - 0x9270]];
    const astc = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];
    if (f >= 0x93B0 && f <= 0x93BD) return [...astc[f - 0x93B0], 16];
    if (f >= 0x93D0 && f <= 0x93DD) return [...astc[f - 0x93D0], 16];
    if (f >= 0x8C00 && f <= 0x8C03) return [4, 4, 8];
    return null;
  }
  function levelBytes(fmt, w, h, d = 1, format, type) {
    const b = block(fmt);
    if (b) return Math.ceil(w / b[0]) * Math.ceil(h / b[1]) * b[2] * d;
    let bpp = BPP[fmt];
    if (bpp == null) bpp = PACKED[type] ?? (UNSIZED[fmt] ?? 4) * (TYPE_MUL[type] ?? 1);
    return w * h * d * bpp;
  }
  const st = new WeakMap();
  const S = (gl) => { let s = st.get(gl); if (!s) st.set(gl, (s = { unit: 0, tex: new Map(), buf: new Map(), rb: null })); return s; };
  const CUBE0 = 0x8515;
  const texTarget = (t) => (t >= CUBE0 && t < CUBE0 + 6 ? 0x8513 : t);
  const bound = (gl, target) => S(gl).tex.get(S(gl).unit + ':' + texTarget(target));
  function trec(gl, target, fresh) {
    const t = bound(gl, target);
    if (!t) return null;
    let r = P.tex.get(t);
    if (!r || fresh) {
      const owner = P.cur?.deref?.() || null;
      r = { levels: new Map(), bytes: 0, owner: WR(owner), w: 0, h: 0, d: 1, fmt: 0, nlev: 0, target: texTarget(target), born: performance.now(), mipGen: false };
      P.tex.set(t, r);
    }
    return r;
  }
  const sumLevels = (r) => { let s = 0; for (const v of r.levels.values()) s += v; r.bytes = s; };
  const wrap = (name, fn) => { const o = GLP[name]; if (o) GLP[name] = function (...a) { fn.call(this, a); return o.apply(this, a); }; };
  wrap('activeTexture', function ([u]) { S(this).unit = u - 0x84C0; });
  wrap('bindTexture', function ([target, t]) { S(this).tex.set(S(this).unit + ':' + target, t); });
  wrap('deleteTexture', function ([t]) { P.tex.delete(t); });
  wrap('texStorage2D', function ([target, levels, fmt, w, h]) {
    const r = trec(this, target, true); if (!r) return;
    const faces = target === 0x8513 ? 6 : 1;
    for (let l = 0; l < levels; l++) r.levels.set('s' + l, levelBytes(fmt, Math.max(1, w >> l), Math.max(1, h >> l)) * faces);
    Object.assign(r, { w, h, fmt, nlev: levels, d: faces }); sumLevels(r);
  });
  wrap('texStorage3D', function ([target, levels, fmt, w, h, d]) {
    const r = trec(this, target, true); if (!r) return;
    const is3D = target === 0x806F;
    for (let l = 0; l < levels; l++) r.levels.set('s' + l, levelBytes(fmt, Math.max(1, w >> l), Math.max(1, h >> l), is3D ? Math.max(1, d >> l) : d));
    Object.assign(r, { w, h, d, fmt, nlev: levels }); sumLevels(r);
  });
  wrap('texImage2D', function (a) {
    const [target, level, fmt] = a;
    let w, h, format, type;
    if (a.length >= 8) { w = a[3]; h = a[4]; format = a[6]; type = a[7]; } else {
      format = a[3]; type = a[4]; const src = a[5];
      w = src?.videoWidth || src?.naturalWidth || src?.displayWidth || src?.width || 0; h = src?.videoHeight || src?.naturalHeight || src?.displayHeight || src?.height || 0;
    }
    const r = trec(this, target, false); if (!r) return;
    r.levels.set(target + ':' + level, levelBytes(fmt, w, h, 1, format, type));
    if (level === 0) Object.assign(r, { w, h, fmt, type, nlev: Math.max(r.nlev, 1) });
    sumLevels(r);
  });
  wrap('texImage3D', function (a) {
    const [target, level, fmt, w, h, d, , format, type] = a;
    const r = trec(this, target, false); if (!r) return;
    r.levels.set(target + ':' + level, levelBytes(fmt, w, h, d, format, type));
    if (level === 0) Object.assign(r, { w, h, d, fmt, nlev: Math.max(r.nlev, 1) });
    sumLevels(r);
  });
  wrap('compressedTexImage2D', function (a) {
    const [target, level, fmt, w, h] = a;
    const r = trec(this, target, false); if (!r) return;
    r.levels.set(target + ':' + level, levelBytes(fmt, w, h));
    if (level === 0) Object.assign(r, { w, h, fmt, nlev: Math.max(r.nlev, 1) });
    sumLevels(r);
  });
  wrap('generateMipmap', function ([target]) {
    const t = bound(this, target), r = t && P.tex.get(t);
    if (!r || r.mipGen || [...r.levels.keys()].some((k) => k[0] === 's')) return; // texStorage: already counted
    r.mipGen = true;
    const faces = target === 0x8513 ? 6 : 1;
    const n = Math.floor(Math.log2(Math.max(r.w, r.h, 1)));
    for (let l = 1; l <= n; l++) r.levels.set('g' + l, levelBytes(r.fmt, Math.max(1, r.w >> l), Math.max(1, r.h >> l), r.d || 1, undefined, r.type) * faces);
    sumLevels(r);
  });
  wrap('bindBuffer', function ([target, b]) { S(this).buf.set(target, b); });
  wrap('deleteBuffer', function ([b]) { P.buf.delete(b); });
  wrap('bufferData', function (a) {
    const [target, src] = a;
    const b = S(this).buf.get(target); if (!b) return;
    let bytes = typeof src === 'number' ? src : src?.byteLength || 0;
    if (a.length >= 5 && a[4]) bytes = a[4] * (src?.BYTES_PER_ELEMENT || 1);
    else if (a.length >= 4 && a[3] && src?.byteLength) bytes = src.byteLength - a[3] * (src.BYTES_PER_ELEMENT || 1);
    const owner = P.cur?.deref?.() || null;
    P.buf.set(b, { bytes, owner: WR(owner), target, born: performance.now() });
  });
  wrap('bindRenderbuffer', function ([, rb]) { S(this).rb = rb; });
  wrap('deleteRenderbuffer', function ([rb]) { P.rb.delete(rb); });
  wrap('renderbufferStorage', function ([, fmt, w, h]) { const rb = S(this).rb; if (rb) P.rb.set(rb, { bytes: levelBytes(fmt, w, h), w, h, fmt, samples: 1, owner: WR(P.cur?.deref?.()) }); });
  wrap('renderbufferStorageMultisample', function ([, samples, fmt, w, h]) { const rb = S(this).rb; if (rb) P.rb.set(rb, { bytes: levelBytes(fmt, w, h) * Math.max(1, samples), w, h, fmt, samples, owner: WR(P.cur?.deref?.()) }); });
  const oGC = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { const c = oGC.call(this, type, ...rest); if (c && /webgl/.test(type)) P.canvases.add(new WeakRef(this)); return c; };

  // ---------------------------------------------------------------- three.js hooks (called once the game module graph is loaded)
  /** Attribute GL allocations to the three object being uploaded; tag loader results with their URL. */
  P.hookThree = function (THREE, addons = {}) {
    if (P._hooked) return; P._hooked = true;
    const ED = THREE.EventDispatcher.prototype, oAdd = ED.addEventListener;
    ED.addEventListener = function (type, fn) {
      if (type === 'dispose' && (this.isTexture || this.isBufferGeometry || this.isRenderTarget || this.isWebGLRenderTarget || this.isInstancedMesh)) P.cur = new WeakRef(this);
      return oAdd.call(this, type, fn);
    };
    const tagTree = (root, url) => {
      if (!root || !url) return;
      const tagMat = (m) => { if (!m) return; for (const k in m) { const v = m[k]; if (v && v.isTexture && !P.tags.has(v)) P.tags.set(v, url); } };
      root.traverse?.((o) => {
        if (o.geometry && !P.tags.has(o.geometry)) P.tags.set(o.geometry, url);
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(tagMat);
      });
    };
    if (addons.GLTFLoader) {
      const GP = addons.GLTFLoader.prototype, oLoad = GP.load, oParse = GP.parse;
      GP.load = function (url, onLoad, ...rest) { return oLoad.call(this, url, (g) => { tagTree(g?.scene, url); onLoad?.(g); }, ...rest); };
      GP.parse = function (data, path, onLoad, ...rest) { const u = (data && P.abUrl.get(data)) || null; return oParse.call(this, data, path, (g) => { if (u) tagTree(g?.scene, u); onLoad?.(g); }, ...rest); };
    }
    const TLP = THREE.TextureLoader.prototype, oTL = TLP.load;
    TLP.load = function (url, onLoad, ...rest) { const t = oTL.call(this, url, (tx) => { onLoad?.(tx); }, ...rest); if (t) P.tags.set(t, (this.path || '') + url); return t; };
  };

  /** Tag what the session cache holds with its key (textures, geometries, objects inside entry values). */
  P.tagCache = function (cache) {
    if (!cache?.entries) return 0;
    let n = 0;
    const seen = new WeakSet();
    const visit = (v, key, depth) => {
      if (!v || typeof v !== 'object' || seen.has(v) || depth > 5) return;
      seen.add(v);
      if (v.isTexture || v.isBufferGeometry || v.isRenderTarget || v.isWebGLRenderTarget) { if (!P.tags.has(v)) { P.tags.set(v, 'cache:' + key); n++; } if (v.texture) visit(v.texture, key, depth + 1); return; }
      if (v.isObject3D) { v.traverse((o) => { if (o.geometry) visit(o.geometry, key, depth + 1); const ms = o.material ? [].concat(o.material) : []; for (const m of ms) for (const k in m) if (m[k]?.isTexture) visit(m[k], key, depth + 1); }); return; }
      if (v.isMaterial) { for (const k in v) if (v[k]?.isTexture) visit(v[k], key, depth + 1); return; }
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return;
      if (v instanceof Map) { for (const x of v.values()) visit(x, key, depth + 1); return; }
      if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 2000); i++) visit(v[i], key, depth + 1); return; }
      for (const k of Object.keys(v)) visit(v[k], key, depth + 1);
    };
    for (const [key, e] of cache.entries) visit(e.value, key, 0);
    return n;
  };

  /** Tag scene objects without a URL by their top-level scene branch (name chain). */
  P.tagScene = function (scene) {
    if (!scene) return;
    for (const top of scene.children) {
      const label = 'scene:' + (top.name || top.type) ;
      top.traverse((o) => {
        const lab = label + (o !== top && o.parent === top && o.name ? '/' + o.name : '');
        if (o.geometry && !P.tags.has(o.geometry)) P.tags.set(o.geometry, lab);
        if (o.isInstancedMesh && !P.tags.has(o)) P.tags.set(o, lab);
        for (const m of o.material ? [].concat(o.material) : []) for (const k in m) { const v = m[k]; if (v?.isTexture && !P.tags.has(v)) P.tags.set(v, lab); }
      });
    }
  };

  const fmtName = (f) => ({ 0x8058: 'RGBA8', 0x8C43: 'SRGB8_A8', 0x8051: 'RGB8', 0x1908: 'RGBA', 0x1907: 'RGB', 0x881A: 'RGBA16F', 0x8814: 'RGBA32F', 0x8229: 'R8', 0x822B: 'RG8', 0x822D: 'R16F', 0x822F: 'RG16F', 0x822E: 'R32F', 0x8230: 'RG32F', 0x81A6: 'D24', 0x88F0: 'D24S8', 0x8CAC: 'D32F', 0x81A5: 'D16', 0x1902: 'DEPTH', 0x8C3A: 'R11G11B10F' }[f] || (block(f) ? 'compressed:0x' + f.toString(16) : '0x' + (f || 0).toString(16)));
  function describe(owner, fallback) {
    if (!owner) return { label: fallback || '(unattributed)', kind: 'none' };
    const tex = owner.isTexture ? owner : null;
    // the image's own file first (shared library textures are referenced by many GLBs), else the owner's tag
    const img = tex && (P.tags.get(tex.image) || P.tags.get(tex.source?.data) || tex.image?.src || tex.source?.data?.src);
    let tag = (img && !/^(blob|data):/.test(img) ? img : null) || P.tags.get(owner) || img || null;
    if (owner.isRenderTarget || owner.isWebGLRenderTarget || tex?.isRenderTargetTexture || tex?.isDepthTexture) tag = 'rt ' + (owner.name || owner.texture?.name || '') + (tag && tag !== 'rt' ? ' ' + tag : '');
    const kind = owner.isRenderTarget || owner.isWebGLRenderTarget ? 'rt' : tex ? (tex.isRenderTargetTexture || tex.isDepthTexture ? 'rt' : 'tex') : owner.isBufferGeometry ? 'geo' : owner.isInstancedMesh ? 'inst' : 'other';
    return { label: tag || `(${owner.constructor?.name || '?'}${owner.name ? ' ' + owner.name : ''})`, kind, name: owner.name || '', type: owner.constructor?.name };
  }
  /** Group a URL/label into a bucket: folder for asset URLs, key prefix for cache entries, branch for the scene. */
  function bucket(label) {
    let s = String(label);
    try { if (/^https?:|^blob:/.test(s)) s = new URL(s).pathname.replace(/^\/(shadow-six\/)?/, ''); } catch { /* keep */ }
    if (/^assets\//.test(s)) { const p = s.split('/'); return p.slice(0, p[1] === 'textures' || p[1] === 'models' || p[1] === 'characters' || p[1] === 'audio' ? 3 : 2).join('/'); }
    if (/^cache:/.test(s)) return 'cache:' + s.slice(6).split(/[:|@]/)[0];
    if (/^scene:/.test(s)) return s.split('/')[0];
    return s.replace(/\d+/g, '#').slice(0, 60);
  }

  /**
   * Totals + attribution. Call after a forced GC (CDP HeapProfiler.collectGarbage) for meaningful audio/WeakRef counts.
   * @param {{top?: number}} [o]
   */
  P.report = function (o = {}) {
    const items = [];
    let tex = 0, buf = 0, rb = 0;
    for (const r of P.tex.values()) {
      tex += r.bytes;
      const d = describe(r.owner?.deref?.());
      items.push({ gl: 'tex', bytes: r.bytes, w: r.w, h: r.h, d: r.d, fmt: fmtName(r.fmt), levels: r.nlev || r.levels.size, ...d });
    }
    for (const r of P.buf.values()) { buf += r.bytes; const d = describe(r.owner?.deref?.()); items.push({ gl: 'buf', bytes: r.bytes, ...d }); }
    for (const r of P.rb.values()) { rb += r.bytes; items.push({ gl: 'rb', bytes: r.bytes, w: r.w, h: r.h, fmt: fmtName(r.fmt), samples: r.samples, label: 'renderbuffer', kind: 'rt' }); }
    let canvas = 0;
    for (const ref of P.canvases) { const c = ref.deref(); if (!c) { P.canvases.delete(ref); continue; } canvas += c.width * c.height * 4 * 3; } // colour (×2 swap) + depth
    const buckets = {};
    for (const it of items) {
      const b = it.gl + ' ' + (it.kind === 'rt' ? 'rt' : bucket(it.label));
      const e = (buckets[b] ||= { bytes: 0, n: 0 });
      e.bytes += it.bytes; e.n++;
    }
    // duplicates: one URL uploaded as several GL textures
    const byUrl = {};
    for (const it of items) if (it.gl === 'tex' && /\.(png|jpe?g|webp|ktx2|glb)/i.test(it.label)) (byUrl[it.label] ||= []).push(it.bytes);
    const dups = Object.entries(byUrl).filter(([, v]) => v.length > 1).map(([u, v]) => ({ url: u, n: v.length, bytes: v.reduce((a, b) => a + b, 0) })).sort((a, b) => b.bytes - a.bytes);
    // audio
    let audio = 0;
    const aBuckets = {};
    const live = [];
    for (const a of P.audio) {
      const b = a.ref.deref();
      if (!b) continue;
      live.push(a);
      audio += a.bytes;
      const k = a.kind === 'synth' ? 'synth' : bucket(a.url);
      const e = (aBuckets[k] ||= { bytes: 0, n: 0 });
      e.bytes += a.bytes; e.n++;
    }
    P.audio = live;
    let bmp = 0, nbmp = 0;
    const liveB = [];
    const bmpBy = {};
    for (const x of P.bitmaps) {
      const b = x.ref.deref(); if (!b) continue; liveB.push(x);
      if (b.width) { bmp += b.width * b.height * 4; nbmp++; const k = bucket(x.url || '?'); bmpBy[k] = (bmpBy[k] || 0) + b.width * b.height * 4; }
    }
    P.bitmaps = liveB;
    const top = o.top ?? 40;
    return {
      gpu: { tex, buf, rb, canvas, total: tex + buf + rb + canvas, ntex: P.tex.size, nbuf: P.buf.size, nrb: P.rb.size },
      bitmaps: { bytes: bmp, n: nbmp, by: Object.entries(bmpBy).sort((a, b) => b[1] - a[1]).slice(0, 12) },
      buckets: Object.entries(buckets).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => ({ k, ...v })),
      topTex: items.filter((x) => x.gl === 'tex').sort((a, b) => b.bytes - a.bytes).slice(0, top),
      topBuf: items.filter((x) => x.gl === 'buf').sort((a, b) => b.bytes - a.bytes).slice(0, Math.ceil(top / 2)),
      dups: dups.slice(0, 20),
      audio: { total: audio, n: live.length, buckets: Object.entries(aBuckets).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => ({ k, ...v })),
        top: live.sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((a) => ({ url: bucket(a.url) === a.url ? a.url : String(a.url).replace(/^.*\/assets\//, 'assets/'), bytes: a.bytes, kind: a.kind, sec: +a.sec.toFixed(1), sr: a.sr, ch: a.ch })) },
    };
  };
})();
