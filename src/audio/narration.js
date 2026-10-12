/**
 * The newsreel narrator: plays the pre-rendered briefing narration (assets/audio/narration/manifest.json, built by
 * tools/audio/narration, docs/narration.md). One clip per briefing line (title card, background, each paragraph) and
 * one per caption of the Colonel's map tour (shared by all missions, found by text). Clips run
 * through their own gain (Options → Sound → NARRATION VOLUME) into the voice bus, so VOICES and MASTER also apply,
 * and while one plays the music director ducks the score (audio.js _musicTick).
 * Memory: a briefing's clips are downloaded compressed; only the clip being read and the next one are decoded (at
 * NARRATION_RATE), and everything goes when the briefing is over (release).
 * @module audio/narration
 */

import { pickAudio, aacTwin, useAacAfterFailure } from './formats.js';

export const NARRATION_MANIFEST = 'narration/manifest.json';
/** Clips decode at this rate (the period-processed voice holds nothing above 11 kHz; 32 kHz keeps images above 20 kHz). */
export const NARRATION_RATE = 32000;
/** Clips decoded past the one being read (the rest of the reading is kept compressed: a few hundred KB). */
export const NARRATION_AHEAD = 1;

/** This browser's file of a clip's [ogg, m4a] (audio/formats.js). */
export function pickNarrationFile(files = []) {
  return pickAudio(files);
}

export class Narrator {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.manifest = null;
    this.loading = null;
    this.buffers = new Map(); // url → AudioBuffer | 'pending' | 'failed' (only the clip being read and the next one)
    this.packed = new Map(); // url → Promise<ArrayBuffer|null>: this briefing's clips, compressed
    this.decoding = new Map(); // url → Promise<boolean>
    this.volume = 1;
    this.cur = null; // the playing clip handle
    this.session = false; // a briefing reading is under way (set by the briefing): the music stays ducked between lines
    this._mission = []; // the current briefing's lines
    this._tour = []; // the current briefing's tour captions
    const ctx = engine.ctx;
    this.gain = ctx.createGain();
    this.gain.connect(engine.bus.voice);
  }

  /** Fetch the manifest once. @returns {Promise<object|null>} */
  load() {
    if (this.loading) return this.loading;
    const e = this.engine;
    this.loading = (async () => {
      try {
        const r = await e.fetch(e.base + NARRATION_MANIFEST);
        this.manifest = r.ok ? await r.json() : null;
      } catch { this.manifest = null; }
      return this.manifest;
    })();
    return this.loading;
  }

  /** The narrated lines of a mission ({id, text, files, duration, words}[]), or null. */
  lines(missionId) {
    return this.manifest?.missions?.[missionId]?.lines || null;
  }

  /** The recorded clip of a Colonel's tour caption (manifest.tour, shared by every mission), found by its exact text. */
  tourLine(text) {
    return this.manifest?.tour?.lines?.find((l) => l.text === text) || null;
  }

  /**
   * Get a mission's reading ready: every clip downloaded (compressed), the first ones decoded; the others decode one
   * line ahead of the voice. @returns {Promise<boolean>} true when the first clip is ready
   */
  async prefetch(missionId) {
    await this.load();
    const ls = this.lines(missionId);
    if (!ls?.length) return false;
    this._mission = ls;
    this._retain();
    await Promise.all(ls.map((l) => this._pack(pickNarrationFile(l.files))));
    return this._ahead(ls, 0);
  }

  /**
   * The same for a briefing's tour captions (those that were recorded). The mission's own clips stay.
   * @param {string[]} texts @returns {Promise<number>} how many of the captions have a clip
   */
  async prefetchTour(texts) {
    await this.load();
    const ls = texts.map((t) => this.tourLine(t)).filter(Boolean);
    this._tour = ls;
    this._retain();
    const got = await Promise.all(ls.map((l) => this._pack(pickNarrationFile(l.files))));
    if (ls.length) await this._ahead(ls, 0);
    return got.filter(Boolean).length;
  }

  /** Keep only this briefing's clips (one briefing at a time). */
  _retain() {
    const keep = new Set([...this._mission, ...this._tour].map((l) => pickNarrationFile(l.files)));
    for (const m of [this.buffers, this.packed]) for (const k of [...m.keys()]) if (!keep.has(k)) m.delete(k);
  }

  /** The briefing is over (the mission plays, or back to the menus): every clip goes. */
  release() {
    this.stop(0.05);
    this._mission = []; this._tour = [];
    this.buffers.clear(); this.packed.clear();
  }

  /** Line i of `list` is being read: decode it and the next NARRATION_AHEAD, free the others. @returns {Promise<boolean>} */
  _ahead(list, i) {
    const keep = new Set();
    for (let k = i; k <= i + NARRATION_AHEAD && k < list.length; k++) keep.add(pickNarrationFile(list[k].files));
    for (const l of list) {
      const f = pickNarrationFile(l.files);
      if (!keep.has(f) && typeof this.buffers.get(f) === 'object') this.buffers.delete(f);
    }
    const first = list[i] ? this._decode(pickNarrationFile(list[i].files)) : Promise.resolve(false);
    for (const f of keep) this._decode(f);
    return first;
  }

  /** Compressed bytes of a clip (cached). */
  _pack(file) {
    if (!file) return Promise.resolve(null);
    let p = this.packed.get(file);
    if (!p) {
      const e = this.engine;
      p = (async () => {
        try {
          const r = await e.fetch(e.base + file);
          return r.ok ? await r.arrayBuffer() : null;
        } catch { return null; }
      })();
      this.packed.set(file, p);
    }
    return p;
  }

  async _decode(file) {
    if (!file) return false;
    const got = this.buffers.get(file);
    if (got && got !== 'pending') return got !== 'failed';
    if (this.decoding.has(file)) return this.decoding.get(file);
    const e = this.engine;
    this.buffers.set(file, 'pending');
    const p = (async () => {
      let buf = null;
      try { buf = await this._decodeBytes(await this._pack(file)); } catch { buf = null; }
      const bytes = this.packed.get(file) ? await this.packed.get(file) : null;
      if (!buf && bytes) { // an Ogg that downloaded but did not decode: its AAC twin (when that decodes, the page switches to AAC)
        const twin = aacTwin(e.base + file);
        if (twin) { try { const r = await e.fetch(twin); if (r.ok) { buf = await this._decodeBytes(await r.arrayBuffer()); useAacAfterFailure(); } } catch { buf = null; } }
      }
      this.decoding.delete(file);
      if (this.buffers.get(file) !== 'pending') return !!buf; // released meanwhile
      this.buffers.set(file, buf || 'failed');
      return !!buf;
    })();
    this.decoding.set(file, p);
    return p;
  }

  async _decodeBytes(ab) {
    if (!ab) throw new Error('no clip');
    const ctx = this.engine.ctx;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (OAC && NARRATION_RATE < (ctx.sampleRate || 48000)) {
      try { return await new OAC(1, 1, NARRATION_RATE).decodeAudioData(ab.slice(0)); } catch { /* the context's rate */ }
    }
    return ctx.decodeAudioData(ab.slice(0));
  }

  /** True when clip i of a mission is decoded and can start now. */
  ready(missionId, i) {
    return this.lineState(this.lines(missionId)?.[i]) === 'ready';
  }

  /**
   * A line's clip: 'ready' (decoded), 'pending' (decoding), 'failed', or 'none' (not part of this briefing). Asking
   * about a clip of this briefing that is not decoded starts its decode.
   */
  lineState(line) {
    const f = line && pickNarrationFile(line.files);
    const b = f && this.buffers.get(f);
    if (!b) {
      if (f && this.packed.has(f)) { this._decode(f); return 'pending'; }
      return 'none';
    }
    return typeof b === 'object' ? 'ready' : b;
  }

  /**
   * Start clip i of a mission (stopping any other). @returns {{t0:number, duration:number, ended:boolean,
   * elapsed:()=>number, stop:(fade?:number)=>void}|null} null when the clip has no recording
   */
  play(missionId, i) {
    const ls = this.lines(missionId);
    if (ls && ls === this._mission) this._ahead(ls, i);
    return this.playLine(ls?.[i]);
  }

  /**
   * Start a manifest line's clip (a mission line or a tour caption), stopping any other. A clip still decoding (the
   * reader skipped ahead) starts as soon as it has decoded: the handle's `elapsed()` stays 0 until then.
   * null when the clip has no recording or failed to decode.
   */
  playLine(l) {
    this.cur?.stop(0.05); // the reading (session) goes on: the music stays ducked from one line to the next
    this.cur = null;
    if (!l) return null;
    const ti = this._tour.indexOf(l);
    if (ti >= 0) this._ahead(this._tour, ti);
    const file = pickNarrationFile(l.files);
    const buf = this.buffers.get(file);
    if (!file || buf === 'failed') return null;
    const ctx = this.engine.ctx;
    const g = ctx.createGain();
    g.connect(this.gain);
    const h = {
      t0: null, duration: l.duration, ended: false, src: null, g,
      elapsed: () => (h.t0 == null ? 0 : (ctx.currentTime ?? 0) - h.t0),
      stop: (fade = 0.15) => {
        if (h.ended) return;
        h.ended = true;
        if (!h.src) return;
        const now = ctx.currentTime ?? 0;
        try {
          g.gain.setValueAtTime?.(g.gain.value, now);
          g.gain.linearRampToValueAtTime?.(0, now + fade);
          h.src.stop(now + fade + 0.02);
        } catch { /* already stopped */ }
      },
    };
    const start = (b) => {
      if (h.ended) return;
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(g);
      h.src = src;
      h.t0 = ctx.currentTime ?? 0;
      h.duration = b.duration ?? l.duration;
      src.onended = () => { h.ended = true; if (this.cur === h) this.cur = null; };
      src.start?.(h.t0);
    };
    if (buf && typeof buf === 'object') start(buf);
    else this._decode(file).then((ok) => { const b = this.buffers.get(file); if (ok && typeof b === 'object') start(b); else h.ended = true; });
    this.cur = h;
    return h;
  }

  /** True while a clip is sounding (or about to: decoding). */
  get speaking() {
    const h = this.cur;
    return !!h && !h.ended && h.elapsed() < h.duration;
  }

  /** The music ducks while a clip sounds and through the pauses between the lines of a reading, so it does not pump. */
  get ducking() {
    return this.session || this.speaking;
  }

  stop(fade = 0.15) {
    this.cur?.stop(fade);
    this.cur = null;
    this.session = false;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    this.gain.gain.value = this.volume;
  }
}
