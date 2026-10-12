/**
 * Streamed music cues. A cue ships as consecutive chunks (assets/audio/music/manifest.json `cues[id].chunks`, written by
 * tools/audio/web_formats.py): chunk k holds cue time [t, t + d) plus the next `o` seconds, so two neighbours overlap by
 * `o` and are crossfaded over it (the overlap also hides any codec edge at a chunk start). A looped cue also ships a
 * short seam file (`wrap`): the last `s` seconds of the loop body followed by the first `o` seconds of the body, so the
 * loop goes round through the same kind of crossfade, sample for sample the music of the master.
 *
 * A StreamVoice plays a cue on the AudioContext clock exactly like an AudioBufferSourceNode would (start time, offset,
 * loopStart/loopEnd looping after a play-once intro, stop(t), onended), scheduling chunks STREAM_AHEAD seconds ahead and
 * decoding the next one meanwhile: three or four chunks (≈ 2 MB each at 32 kHz stereo) are decoded at a time instead of
 * the whole cue (20–40 MB). Sample-accurate: chunk starts are context times, never timers.
 * @module audio/music-stream
 */

/**
 * Seconds of playback scheduled ahead of the clock. The pump runs from the frame loop and a 250 ms timer; this much
 * scheduled audio rides out a main-thread stall (a mission loading, a shader compile) without a gap.
 */
export const STREAM_AHEAD = 7;

/** One cue's chunk table + a decode cache. `load(f)` → Promise<AudioBuffer> (fetch + decode of chunk file stem `f`). */
export class ChunkCue {
  /** @param {{id:string, chunks:{f:string,t:number,d:number,o:number}[], wrap?:{k:number,f:string,o:number}, meta?:object,
   *   load:(f:string)=>Promise<AudioBuffer>}} o */
  constructor(o) {
    this.id = o.id;
    this.chunks = o.chunks;
    this.wrap = o.wrap || null;
    this.meta = o.meta || {};
    this.load = o.load;
    this.cache = new Map(); // f → Promise<AudioBuffer|null>
    this.decoded = new Map(); // f → AudioBuffer (resolved)
    this.pins = new Set(); // chunk stems kept while the cue is cached (instant starts)
    this.users = new Map(); // f → number of scheduled sources still holding it
    const m = this.meta;
    this.loopStart = m.loopEnd > m.loopStart ? m.loopStart : null;
    this.loopEnd = this.loopStart != null ? m.loopEnd : null;
    const last = this.chunks[this.chunks.length - 1];
    this.duration = Number.isFinite(m.lengthSec) ? m.lengthSec : last ? last.t + last.d : 0;
    this.bodyFirst = this.loopStart != null ? Math.max(0, this.indexAt(this.loopStart)) : 0;
  }

  /** Index of the chunk holding cue time t. */
  indexAt(t) {
    const c = this.chunks;
    for (let k = c.length - 1; k >= 0; k--) if (t >= c[k].t - 1e-6) return k;
    return 0;
  }

  /** Decoded buffer of a chunk stem (cached promise). */
  get(f) {
    let p = this.cache.get(f);
    if (!p) {
      p = Promise.resolve().then(() => this.load(f)).then((b) => { if (this.cache.get(f) === p && b) this.decoded.set(f, b); return b || null; })
        .catch(() => null);
      this.cache.set(f, p);
    }
    return p;
  }

  isDecoded(f) { return this.decoded.has(f); }

  /** Decode (and keep while the cue is cached) the chunk a start at `offset` plays first. @returns {Promise<boolean>} */
  prefetch(offset = 0) {
    const f = this.chunks[this.indexAt(offset)]?.f;
    if (!f) return Promise.resolve(false);
    this.pins.add(f);
    return this.get(f).then(Boolean);
  }

  /** A start at `offset` has happened: its chunk need not stay decoded for the next one (the playing source holds it). */
  unpin(offset = 0) {
    const f = this.chunks[this.indexAt(offset)]?.f;
    if (!f || !this.pins.delete(f)) return;
    if (!this.users.has(f)) { this.cache.delete(f); this.decoded.delete(f); }
  }

  /** Is the chunk a start at `offset` plays first decoded? */
  readyAt(offset = 0) { return this.decoded.has(this.chunks[this.indexAt(offset)]?.f); }

  /** A source holds / lets go of a chunk; unpinned chunks nobody holds are dropped (their PCM is freed). */
  hold(f) { this.users.set(f, (this.users.get(f) || 0) + 1); }
  letGo(f) {
    const n = (this.users.get(f) || 1) - 1;
    if (n > 0) { this.users.set(f, n); return; }
    this.users.delete(f);
    if (!this.pins.has(f)) { this.cache.delete(f); this.decoded.delete(f); }
  }

  /** Decoded PCM held now (bytes). */
  bytes() {
    let n = 0;
    for (const b of this.decoded.values()) n += (b.length || 0) * (b.numberOfChannels || 1) * 4;
    return n;
  }

  /** Drop everything (the director let go of the cue). */
  release() { this.pins.clear(); for (const f of [...this.decoded.keys()]) if (!this.users.has(f)) { this.decoded.delete(f); this.cache.delete(f); } }
}

/**
 * One playing instance of a ChunkCue → `out` (a GainNode the caller connects). Mirrors AudioBufferSourceNode:
 * start time `at`, `offset` into the cue, `loop` (loopStart/loopEnd from the meta), stop(t), onended.
 * Steps: a chunk (k) or, when looping, the seam after the last body chunk (k, seam) — that chunk then plays `s` shorter.
 */
export class StreamVoice {
  /** @param {AudioContext} ctx @param {ChunkCue} cue @param {{at:number, offset?:number, loop?:boolean}} o */
  constructor(ctx, cue, { at, offset = 0, loop = false } = {}) {
    this.ctx = ctx;
    this.cue = cue;
    this.loop = !!loop && cue.loopStart != null && !!cue.wrap;
    this.out = ctx.createGain();
    this.onended = null;
    this.stopAt = Infinity;
    this.done = false;
    this.waiting = null; // chunk stem whose decode the pump waits for
    this.live = new Set(); // scheduled {src, g, f}
    this.lead = (cue.meta.aacDelay || 0) / 48000; // AAC priming, skipped only when a decoder kept it (see _schedule)
    const k = cue.indexAt(offset);
    let into = Math.max(0, offset - cue.chunks[k].t), seam = false;
    const st = this._step(k, false);
    if (this.loop && cue.wrap.k === k && into >= st.d) { into -= st.d; seam = true; } // starts inside the seam
    this.next = { k, seam, into, when: at, fadeIn: 0 };
    this.pump();
  }

  /** What step (k, seam) plays: file stem f, cue time t, length d, overlap carried o, material in the file `mat`. */
  _step(k, seam) {
    const c = this.cue.chunks[k], w = this.cue.wrap;
    if (seam) return { f: w.f, t: c.t + c.d - w.s, d: w.s, o: w.o, mat: w.s + w.o };
    if (this.loop && w && w.k === k) return { f: c.f, t: c.t, d: c.d - w.s, o: w.o, mat: c.d + c.o };
    return { f: c.f, t: c.t, d: c.d, o: c.o, mat: c.d + c.o };
  }

  /** Schedule steps up to STREAM_AHEAD past the clock; decode the next one meanwhile. Call often (frame / 250 ms). */
  pump(now = this.ctx.currentTime || 0) {
    if (this.done) return;
    for (let guard = 0; guard < 8 && this.next && this.next.when < now + STREAM_AHEAD && this.next.when < this.stopAt; guard++) {
      const n = this.next, st = this._step(n.k, n.seam);
      const buf = this.cue.decoded.get(st.f);
      if (!buf) { this._wait(st.f); break; } // decoding (normally decoded seconds ago): scheduled when it lands
      this._schedule(n, st, buf, now);
      this.next = this._after(n, st);
      if (this.next) { const nf = this._step(this.next.k, this.next.seam).f; if (!this.cue.isDecoded(nf)) this.cue.get(nf); }
    }
    if (!this.next && !this.live.size) this._end();
  }

  _wait(f) {
    if (this.waiting === f) return;
    this.waiting = f;
    this.cue.get(f).then(() => { if (this.waiting === f) { this.waiting = null; this.pump(); } });
  }

  _schedule(n, st, buf, now) {
    const ctx = this.ctx;
    let into = n.into, t0 = n.when, fadeIn = n.fadeIn;
    const late = (typeof ctx.currentTime === 'number' ? ctx.currentTime : now) + 0.005 - t0;
    if (late > 0.005) { into += late; t0 += late; fadeIn = Math.max(fadeIn - late, 0.01); } // a stall made it late: keep the timeline
    const len = st.d + st.o - into; // what is left of the step from `into`
    if (len <= 0.005) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    src.connect(g); g.connect(this.out);
    // AAC priming still in the decoded data (a decoder that ignored the m4a edit list): skip it
    const lead = this.lead > 0 && buf.duration - st.mat > this.lead * 0.5 ? this.lead : 0;
    const t1 = t0 + len;
    const ga = g.gain;
    if (ga.setValueAtTime) {
      if (fadeIn > 0) { ga.setValueAtTime(0, t0); ga.linearRampToValueAtTime(1, t0 + Math.min(fadeIn, len)); }
      if (st.o > 0 && len > st.o) { ga.setValueAtTime(1, t1 - st.o); ga.linearRampToValueAtTime(0, t1); }
    }
    const rec = { src, g, f: st.f };
    this.cue.hold(st.f);
    this.live.add(rec);
    src.onended = () => {
      this.live.delete(rec);
      try { g.disconnect(); } catch { /* ignore */ }
      this.cue.letGo(st.f);
      if (!this.next || this.done) { if (!this.live.size) this._end(); } else this.pump();
    };
    try {
      src.start(t0, lead + into, len); // `into` counts from the step's file start (a seam file starts at its own t)
      if (this.stopAt < Infinity) src.stop(Math.max(this.stopAt, t0));
    } catch { /* ignore */ }
  }

  /** The step after n (null at the end of a non-looping cue). */
  _after(n, st) {
    const end = n.when + (st.d - n.into); // the step's cue time t + d is reached at this context time
    const cue = this.cue, w = cue.wrap;
    if (this.loop && w && n.k === w.k) {
      if (!n.seam) return { k: n.k, seam: true, into: 0, when: end, fadeIn: st.o };
      return { k: cue.bodyFirst, seam: false, into: 0, when: end, fadeIn: st.o };
    }
    const k = n.k + 1;
    if (k >= cue.chunks.length) return null;
    return { k, seam: false, into: 0, when: end, fadeIn: st.o };
  }

  /** Stop at context time t (sources already started end there; later ones never start). */
  stop(t = this.ctx.currentTime || 0) {
    this.stopAt = Math.min(this.stopAt, t);
    this.next = null;
    this.waiting = null;
    for (const r of this.live) { try { r.src.stop(Math.max(this.ctx.currentTime || 0, t)); } catch { /* ignore */ } }
    if (!this.live.size) this._end();
  }

  _end() {
    if (this.done) return;
    this.done = true;
    const cb = this.onended;
    this.onended = null;
    cb?.();
  }

  /** Decoded PCM this cue holds now (bytes). */
  bytes() { return this.cue.bytes(); }
}
