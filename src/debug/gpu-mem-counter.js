/**
 * GPU memory counter for debug mode (`?debug` only: debug/debug-mode.js installs it before the Game creates its WebGL
 * context; without the parameter nothing here runs). The slim, always-on cousin of tools/perf/mem-probe.js (same
 * byte rules): it wraps only the WebGL2 calls that allocate or free GPU memory — texStorage2D/3D, texImage2D/3D,
 * compressedTexImage2D/3D, copyTexImage2D, generateMipmap, bufferData, renderbufferStorage(Multisample) and
 * deleteTexture / deleteBuffer / deleteRenderbuffer — and keeps running byte totals per context: textures (every
 * level, cube face and array layer; compressed formats by block), buffers, renderbuffers (× MSAA samples).
 *
 * Cost: nothing on the per-draw path. bind*, activeTexture and draw calls are not wrapped: the object an allocation
 * applies to is read from the context's own binding (getParameter(TEXTURE_BINDING_2D …), which the browser answers
 * from its JS-side state, no GPU round trip) only when an allocation happens. A frame that uploads nothing does no
 * work here; an upload adds a getParameter and a Map update. Totals are kept incrementally (reading them is O(1) per
 * context).
 *
 * A lost context drops its records (its GL objects are gone; three re-uploads after the restore and those uploads are
 * counted again), and calls on a lost context are ignored. Not counted: driver padding / alignment, shader programs,
 * the browser's own copies of video / canvas sources. The canvas drawing buffer is estimated in totals() as `fb`
 * (colour ×2 + depth, 4 bytes each per pixel, as mem-probe does), so `total` compares with mem-probe's `gpu.total`.
 * @module debug/gpu-mem-counter
 */

// ---------------------------------------------------------------- byte rules (tools/perf/mem-probe.js)

/** Bytes per pixel of sized internal formats (RGB formats padded to 4 bytes, as drivers store them). */
const BPP = {
  0x8058: 4, 0x8C43: 4, 0x8051: 4, 0x8C41: 4, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822F: 4, 0x822E: 4, 0x8230: 8,
  0x881A: 8, 0x8814: 16, 0x881B: 8, 0x8815: 16, 0x8C3A: 4, 0x8059: 4, 0x906F: 4, 0x8C3D: 4,
  0x8232: 1, 0x8234: 2, 0x8236: 4, 0x8231: 1, 0x8233: 2, 0x8235: 4, // R8UI R16UI R32UI R8I R16I R32I
  0x8238: 2, 0x823A: 4, 0x823C: 8, 0x8237: 2, 0x8239: 4, 0x823B: 8, // RG8UI RG16UI RG32UI RG8I RG16I RG32I
  0x8D7C: 4, 0x8D76: 8, 0x8D70: 16, 0x8D8E: 4, 0x8D88: 8, 0x8D82: 16, // RGBA8UI 16UI 32UI, RGBA8I 16I 32I
  0x8F94: 1, 0x8F95: 2, 0x8F96: 4, 0x8F97: 4, 0x8D62: 2, 0x8056: 2, 0x8057: 2,
  0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8D48: 1, 0x84F9: 4,
};
/** Channels of unsized formats (RGB padded to 4); × the type's bytes. */
const UNSIZED = { 0x1908: 4, 0x1907: 4, 0x1909: 1, 0x190A: 2, 0x1906: 1, 0x1903: 1, 0x8227: 2, 0x1902: 1 };
const TYPE_BYTES = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 };
/** Packed pixel types: bytes per pixel in total. */
const PACKED = { 0x84FA: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8368: 4, 0x8C3B: 4, 0x8C3E: 4, 0x8DAD: 8 };
const ASTC = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];

/** [block w, block h, bytes] of a compressed internal format, or null. */
export function compressedBlock(f) {
  if ((f >= 0x83F0 && f <= 0x83F1) || (f >= 0x8C4C && f <= 0x8C4D) || f === 0x8D64 || f === 0x8DBB || f === 0x8DBC) return [4, 4, 8]; // DXT1, ETC1, RGTC1
  if ((f >= 0x83F2 && f <= 0x83F3) || (f >= 0x8C4E && f <= 0x8C4F) || (f >= 0x8E8C && f <= 0x8E8F) || f === 0x8DBD || f === 0x8DBE) return [4, 4, 16]; // DXT3/5, BC7/6H, RGTC2
  if (f >= 0x9270 && f <= 0x9279) return [4, 4, [8, 8, 16, 16, 8, 8, 8, 8, 16, 16][f - 0x9270]]; // ETC2 / EAC
  if (f >= 0x93B0 && f <= 0x93BD) return [...ASTC[f - 0x93B0], 16];
  if (f >= 0x93D0 && f <= 0x93DD) return [...ASTC[f - 0x93D0], 16];
  if (f === 0x8C00 || f === 0x8C02) return [4, 4, 8]; // PVRTC 4 bpp
  if (f === 0x8C01 || f === 0x8C03) return [8, 4, 8]; // PVRTC 2 bpp
  return null;
}

/**
 * Bytes of one image of `w × h × d` texels. `format` / `type` matter only for unsized internal formats.
 * @param {number} fmt internal format @param {number} w @param {number} h @param {number} [d] depth or layers
 * @param {number} [format] @param {number} [type]
 */
export function levelBytes(fmt, w, h, d = 1, format, type) {
  w = Math.max(0, w | 0); h = Math.max(0, h | 0); d = Math.max(1, d | 0);
  const b = compressedBlock(fmt);
  if (b) return Math.ceil(w / b[0]) * Math.ceil(h / b[1]) * b[2] * d;
  let bpp = BPP[fmt];
  if (bpp == null) bpp = PACKED[type] ?? (UNSIZED[fmt] ?? UNSIZED[format] ?? 4) * (TYPE_BYTES[type] ?? 1);
  return w * h * d * bpp;
}

/** Bytes of a texStorage2D / 3D allocation (`levels` mips; cube maps ×6; 3D depth halves per level, array layers do not). */
export function storageBytes(target, levels, fmt, w, h, d = 1) {
  const faces = target === CUBE ? 6 : 1, is3D = target === TEX_3D;
  let s = 0;
  for (let l = 0; l < levels; l++) s += levelBytes(fmt, Math.max(1, w >> l), Math.max(1, h >> l), is3D ? Math.max(1, d >> l) : d);
  return s * faces;
}

/** Bytes a bufferData call allocates: (target, size | srcData, usage[, srcOffset[, length]]) — offsets in elements. */
export function bufferBytes(src, srcOffset = 0, length = 0) {
  if (typeof src === 'number') return Math.max(0, src);
  if (!src) return 0;
  const bpe = src.BYTES_PER_ELEMENT || 1;
  if (length > 0) return length * bpe;
  return Math.max(0, (src.byteLength || 0) - (srcOffset || 0) * bpe);
}

// ---------------------------------------------------------------- GL enums

const TEX_2D = 0x0DE1, CUBE = 0x8513, CUBE_X = 0x8515, TEX_3D = 0x806F, TEX_ARRAY = 0x8C1A;
const TEX_BINDING = { [TEX_2D]: 0x8069, [CUBE]: 0x8514, [TEX_3D]: 0x806A, [TEX_ARRAY]: 0x8C1D };
const BUF_BINDING = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8C8E: 0x8C8F };
const RB_BINDING = 0x8CA7;
const isFace = (t) => t >= CUBE_X && t <= CUBE_X + 5;
const texBinding = (t) => (isFace(t) ? 0x8514 : TEX_BINDING[t]);

const KEY = Symbol.for('shadowsix.gpuMemCounter');

/**
 * Wrap the allocation calls of a WebGL2 context prototype (once; a second call returns the same counter).
 * @param {object} [proto] WebGL2RenderingContext.prototype (a stand-in in unit tests)
 * @returns {{totals: () => {tex: number, buf: number, rb: number, fb: number, total: number, ntex: number, nbuf: number,
 *   nrb: number, contexts: number, calls: number, losses: number}, uninstall: () => void}|null}
 */
export function installGpuMemCounter(proto = globalThis.WebGL2RenderingContext?.prototype) {
  if (!proto || typeof proto.texImage2D !== 'function') return null;
  if (proto[KEY]) return proto[KEY];
  const ctxs = new WeakMap();
  const list = []; // contexts seen (a page has one or two)
  let calls = 0, losses = 0;

  /** Per-context records; a lost context (event) drops them. */
  function C(gl) {
    let c = ctxs.get(gl);
    if (c) return c;
    c = { gl: typeof WeakRef === 'function' ? new WeakRef(gl) : { deref: () => gl }, tex: new Map(), buf: new Map(), rb: new Map(), texB: 0, bufB: 0, rbB: 0 };
    ctxs.set(gl, c);
    list.push(c);
    try {
      gl.canvas?.addEventListener?.('webglcontextlost', () => {
        losses++;
        c.tex.clear(); c.buf.clear(); c.rb.clear();
        c.texB = 0; c.bufB = 0; c.rbB = 0;
      });
    } catch { /* no canvas events: records stay until deleted */ }
    return c;
  }
  const live = (gl) => !(gl.isContextLost?.());

  // textures: rec = {bytes, lv: Map(face*64+level → bytes)|null, immutable, w, h, d, fmt, format, type, gen: keys of generated mips}
  function texRec(gl, target) {
    const b = texBinding(target);
    const t = b && gl.getParameter(b);
    if (!t) return null;
    const c = C(gl);
    let r = c.tex.get(t);
    if (!r) { r = { bytes: 0, lv: null, immutable: false, w: 0, h: 0, d: 1, fmt: 0, format: 0, type: 0, gen: null }; c.tex.set(t, r); }
    return [c, r];
  }
  const setTex = (c, r, bytes) => { c.texB += bytes - r.bytes; r.bytes = bytes; };
  function setLevel(gl, target, level, fmt, w, h, d, format, type) {
    const cr = texRec(gl, target);
    if (!cr) return;
    const [c, r] = cr;
    if (r.immutable) return; // texImage on texStorage: a GL error, nothing allocated
    const lv = (r.lv ||= new Map());
    const face = isFace(target) ? target - CUBE_X : 0;
    if (level === 0) {
      if (r.gen) { for (const k of r.gen) lv.delete(k); r.gen = null; } // a new base: generated mips are stale
      Object.assign(r, { w, h, d, fmt, format, type });
    }
    lv.set(face * 64 + level, levelBytes(fmt, w, h, d, format, type));
    let s = 0;
    for (const v of lv.values()) s += v;
    setTex(c, r, s);
  }

  const orig = {};
  const wrap = (name, count) => {
    const o = proto[name];
    if (typeof o !== 'function') return;
    orig[name] = o;
    proto[name] = function (...a) {
      const out = o.apply(this, a);
      try { if (live(this)) { calls++; count(this, a); } } catch { /* accounting never breaks rendering */ }
      return out;
    };
  };

  wrap('texStorage2D', (gl, [target, levels, fmt, w, h]) => {
    const cr = texRec(gl, target);
    if (!cr) return;
    const [c, r] = cr;
    r.lv = null; r.gen = null; r.immutable = true;
    setTex(c, r, storageBytes(target, levels, fmt, w, h));
  });
  wrap('texStorage3D', (gl, [target, levels, fmt, w, h, d]) => {
    const cr = texRec(gl, target);
    if (!cr) return;
    const [c, r] = cr;
    r.lv = null; r.gen = null; r.immutable = true;
    setTex(c, r, storageBytes(target, levels, fmt, w, h, d));
  });
  wrap('texImage2D', (gl, a) => {
    const [target, level, fmt] = a;
    let w, h, format, type;
    if (a.length >= 8) { w = a[3]; h = a[4]; format = a[6]; type = a[7]; } else {
      format = a[3]; type = a[4];
      const s = a[5];
      w = s?.videoWidth || s?.naturalWidth || s?.displayWidth || s?.width || 0;
      h = s?.videoHeight || s?.naturalHeight || s?.displayHeight || s?.height || 0;
    }
    setLevel(gl, target, level, fmt, w, h, 1, format, type);
  });
  wrap('texImage3D', (gl, [target, level, fmt, w, h, d, , format, type]) => setLevel(gl, target, level, fmt, w, h, d, format, type));
  wrap('compressedTexImage2D', (gl, [target, level, fmt, w, h]) => setLevel(gl, target, level, fmt, w, h, 1));
  wrap('compressedTexImage3D', (gl, [target, level, fmt, w, h, d]) => setLevel(gl, target, level, fmt, w, h, d));
  wrap('copyTexImage2D', (gl, [target, level, fmt, , , w, h]) => setLevel(gl, target, level, fmt, w, h, 1, fmt, 0x1401));
  wrap('generateMipmap', (gl, [target]) => {
    const cr = texRec(gl, target);
    if (!cr) return;
    const [c, r] = cr;
    if (r.immutable || r.gen || !r.lv || !r.w) return; // texStorage: the chain is allocated already
    const faces = target === CUBE ? 6 : 1, is3D = target === TEX_3D;
    r.gen = [];
    const n = Math.floor(Math.log2(Math.max(r.w, r.h, is3D ? r.d : 1, 1)));
    for (let f = 0; f < faces; f++) {
      for (let l = 1; l <= n; l++) {
        const k = f * 64 + l;
        if (r.lv.has(k)) continue;
        r.lv.set(k, levelBytes(r.fmt, Math.max(1, r.w >> l), Math.max(1, r.h >> l), is3D ? Math.max(1, r.d >> l) : r.d, r.format, r.type));
        r.gen.push(k);
      }
    }
    let s = 0;
    for (const v of r.lv.values()) s += v;
    setTex(c, r, s);
  });
  wrap('deleteTexture', (gl, [t]) => {
    const c = t && C(gl), r = c && c.tex.get(t);
    if (!r) return;
    c.texB -= r.bytes;
    c.tex.delete(t);
  });

  wrap('bufferData', (gl, [target, src, , srcOffset, length]) => {
    const b = BUF_BINDING[target] && gl.getParameter(BUF_BINDING[target]);
    if (!b) return;
    const c = C(gl), bytes = bufferBytes(src, srcOffset, length);
    c.bufB += bytes - (c.buf.get(b) || 0);
    c.buf.set(b, bytes);
  });
  wrap('deleteBuffer', (gl, [b]) => {
    const c = b && C(gl);
    if (!c || !c.buf.has(b)) return;
    c.bufB -= c.buf.get(b);
    c.buf.delete(b);
  });

  const setRb = (gl, bytes) => {
    const rb = gl.getParameter(RB_BINDING);
    if (!rb) return;
    const c = C(gl);
    c.rbB += bytes - (c.rb.get(rb) || 0);
    c.rb.set(rb, bytes);
  };
  wrap('renderbufferStorage', (gl, [, fmt, w, h]) => setRb(gl, levelBytes(fmt, w, h)));
  wrap('renderbufferStorageMultisample', (gl, [, samples, fmt, w, h]) => setRb(gl, levelBytes(fmt, w, h) * Math.max(1, samples)));
  wrap('deleteRenderbuffer', (gl, [rb]) => {
    const c = rb && C(gl);
    if (!c || !c.rb.has(rb)) return;
    c.rbB -= c.rb.get(rb);
    c.rb.delete(rb);
  });

  const counter = {
    /** Current totals in bytes over every live context (+ object counts, wrapped calls, context losses seen). */
    totals() {
      let tex = 0, buf = 0, rb = 0, fb = 0, ntex = 0, nbuf = 0, nrb = 0, contexts = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i], gl = c.gl.deref();
        if (!gl) { list.splice(i, 1); continue; }
        if (gl.isContextLost?.()) continue;
        contexts++;
        tex += c.texB; buf += c.bufB; rb += c.rbB;
        ntex += c.tex.size; nbuf += c.buf.size; nrb += c.rb.size;
        fb += (gl.drawingBufferWidth || 0) * (gl.drawingBufferHeight || 0) * 12; // colour ×2 (swap) + depth, 4 B each
      }
      return { tex, buf, rb, fb, total: tex + buf + rb + fb, ntex, nbuf, nrb, contexts, calls, losses };
    },
    /** Restore the original methods (unit tests). */
    uninstall() {
      for (const [k, f] of Object.entries(orig)) proto[k] = f;
      delete proto[KEY];
    },
  };
  Object.defineProperty(proto, KEY, { value: counter, configurable: true });
  return counter;
}
