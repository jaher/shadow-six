/**
 * The newsreel narrator: plays the pre-rendered briefing narration (assets/audio/narration/manifest.json, built by
 * tools/audio/narration, docs/narration.md). One clip per briefing line (title card, background, each paragraph) and
 * one per caption of the Colonel's map tour (shared by all missions, found by text). Clips run
 * through their own gain (Options → Sound → NARRATION VOLUME) into the voice bus, so VOICES and MASTER also apply,
 * and while one plays the music director ducks the score (audio.js _musicTick).
 * @module audio/narration
 */

export const NARRATION_MANIFEST = 'narration/manifest.json';

/** Opus/OGG where the browser plays it, else MP3 (Safari). */
export function pickNarrationFile(files = [], canOgg = defaultCanOgg()) {
  return files.find((f) => (canOgg ? /\.ogg$/ : /\.mp3$/).test(f)) || files[0] || null;
}
function defaultCanOgg() {
  try { return typeof Audio === 'undefined' || !!new Audio().canPlayType?.('audio/ogg; codecs=opus'); } catch { return false; }
}

export class Narrator {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.manifest = null;
    this.loading = null;
    this.buffers = new Map(); // url → AudioBuffer | 'pending' | 'failed'
    this.volume = 1;
    this.cur = null; // the playing clip handle
    this.session = false; // a briefing reading is under way (set by the briefing): the music stays ducked between lines
    this._tour = []; // the current briefing's tour captions (their PCM is kept with the mission's)
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

  /** Decode every clip of a mission. @returns {Promise<boolean>} true when all decoded */
  async prefetch(missionId) {
    await this.load();
    const ls = this.lines(missionId);
    if (!ls?.length) return false;
    this._retain(ls, this._tour);
    const ok = await Promise.all(ls.map((l) => this._decode(pickNarrationFile(l.files))));
    return ok.every(Boolean);
  }

  /**
   * Decode the clips of a briefing's tour captions (those that were recorded). The mission's own clips stay.
   * @param {string[]} texts @returns {Promise<number>} how many of the captions have a decoded clip
   */
  async prefetchTour(texts) {
    await this.load();
    const ls = texts.map((t) => this.tourLine(t)).filter(Boolean);
    this._tour = ls;
    const ok = await Promise.all(ls.map((l) => this._decode(pickNarrationFile(l.files))));
    return ok.filter(Boolean).length;
  }

  /** Keep only these lines' decoded PCM (one briefing at a time). */
  _retain(...sets) {
    const keep = new Set(sets.flat().filter(Boolean).map((l) => pickNarrationFile(l.files)));
    for (const k of [...this.buffers.keys()]) if (!keep.has(k)) this.buffers.delete(k);
  }

  async _decode(file) {
    if (!file) return false;
    const got = this.buffers.get(file);
    if (got && got !== 'pending') return got !== 'failed';
    const e = this.engine;
    this.buffers.set(file, 'pending');
    try {
      const r = await e.fetch(e.base + file);
      if (!r.ok) throw new Error(r.status);
      this.buffers.set(file, await e.ctx.decodeAudioData(await r.arrayBuffer()));
      return true;
    } catch {
      this.buffers.set(file, 'failed');
      return false;
    }
  }

  /** True when clip i of a mission is decoded and can start now. */
  ready(missionId, i) {
    return this.lineState(this.lines(missionId)?.[i]) === 'ready';
  }

  /** A line's clip: 'ready' (decoded), 'pending' (decoding), 'failed', or 'none' (not requested / no line). */
  lineState(line) {
    const b = line && this.buffers.get(pickNarrationFile(line.files));
    if (!b) return 'none';
    return typeof b === 'object' ? 'ready' : b;
  }

  /**
   * Start clip i of a mission (stopping any other). @returns {{t0:number, duration:number, ended:boolean,
   * elapsed:()=>number, stop:(fade?:number)=>void}|null} null when the clip is not decoded
   */
  play(missionId, i) {
    return this.playLine(this.lines(missionId)?.[i]);
  }

  /** Start a manifest line's clip (a mission line or a tour caption), stopping any other; null when not decoded. */
  playLine(l) {
    this.cur?.stop(0.05); // the reading (session) goes on: the music stays ducked from one line to the next
    this.cur = null;
    const buf = l && this.buffers.get(pickNarrationFile(l.files));
    if (!buf || typeof buf !== 'object') return null;
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(this.gain);
    const t0 = ctx.currentTime ?? 0;
    const h = {
      t0, duration: buf.duration ?? l.duration, ended: false, src, g,
      elapsed: () => (ctx.currentTime ?? 0) - t0,
      stop: (fade = 0.15) => {
        if (h.ended) return;
        h.ended = true;
        const now = ctx.currentTime ?? 0;
        try {
          g.gain.setValueAtTime?.(g.gain.value, now);
          g.gain.linearRampToValueAtTime?.(0, now + fade);
          src.stop(now + fade + 0.02);
        } catch { /* already stopped */ }
      },
    };
    src.onended = () => { h.ended = true; if (this.cur === h) this.cur = null; };
    src.start?.(t0);
    this.cur = h;
    return h;
  }

  /** True while a clip is sounding. */
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
