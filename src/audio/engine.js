/**
 * WebAudio graph (design-spec §9 engine; realism-pipeline v2 §1.5.0):
 *   master → glue compressor → limiter → destination; busses sfx, voice, ambience, music, ui → master.
 *   Every voice is  source → gain → [air-absorption low-pass] → stereoPanner → bus.
 * Positional sounds are heard from the active view centre (ortho camera): per-category reference and
 * max distance (manifest.js DISTANCE: footsteps ~30 m, voices 60 m, small arms 400 m, MG/explosions
 * 1.5 km) with the inverse law, a short taper before `max`, an air-absorption low-pass (20 kHz at 0 m →
 * 3.5 kHz at 120 m), and pan = lateral offset / the LIVE frustum half-width (zoom-aware). The law is
 * computed here rather than by a PannerNode so it is deterministic and unit-testable with a mock context.
 * Recorded assets (assets/audio, tools/audio/build_assets.py + web_formats.py: Opus .ogg or AAC .m4a per browser,
 * audio/formats.js) replace the synth placeholders. Decoded PCM is the memory cost, so (audio footprint pass):
 *   - one-shots that must fire on the frame (shots, impacts, steps, UI…) are decoded when the mission loads;
 *   - loops and long non-weapon takes (engines, swimming, crawling, sirens) and every spoken voice line decode on first
 *     use and start when decoded (a few ms; `play` returns a deferred handle), kept in an LRU within `lazyBudget`;
 *     voices decode at 32 kHz (the recordings hold nothing above 12 kHz); the pain / death grunts and cries are kept
 *     decoded (they are synced to a hit); a near-mono stereo take keeps one channel, up-mixed to two at playback;
 *   - ambience beds are streamed through a media element (never decoded);
 *   - music is streamed chunk by chunk (audio/music-stream.js, loadMusic);
 *   - voices come from voice/lines.json (rec lines; German voices 1–3; urgent "alt" takes).
 * @module audio/engine
 */

import { CONFIG } from '../config.js';
import { BUSSES, SFX, MUSIC, DISTANCE, classOf } from './manifest.js';
import { synth, synthVoice } from './synth.js';
import { PITCH } from './voice-lines.js';
import { pickAudio, audioExt, aacTwin, useAacAfterFailure } from './formats.js';
import { ChunkCue } from './music-stream.js';

/** Decoded-PCM budget (bytes) of the lazily decoded loops / long takes / voice lines: phones keep less. */
export function defaultLazyBudget(nav = globalThis.navigator) {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent || '') || ((nav?.maxTouchPoints || 0) > 1 && /Macintosh/.test(nav?.userAgent || ''));
  return (mobile ? 16 : 32) * 1048576;
}
/** Sample rate the voice lines decode at (TTS speech: nothing above 12 kHz; 32 kHz keeps resampling images above 20 kHz). */
export const VOICE_RATE = 32000;
/**
 * The mission preload's few hundred requests go at low fetch priority: a sound wanted now (the narrator's next clip,
 * a music chunk, a deferred take) is not queued behind them.
 */
const LOW = Object.freeze({ priority: 'low' });
/** A deferred one-shot that could not start within this many seconds is dropped (no late gunshots / barks). */
export const LATE_DROP = { sfx: 0.25, voice: 0.6 };
/** SFX that decode on first use: loops (engines, swim, crawl), bed takes played as buffers, long non-weapon takes (sirens).
 * Everything else is instant. */
export function lazySfx(meta) {
  if (!meta) return false;
  if (meta.mode === 'loop' || meta.mode === 'bed') return true;
  return meta.mode === 'long' && !/^(mg|explosion|artillery|rifle|pistol|smg|sniper|flak|cannon)/.test(meta.category || '');
}

const A = () => CONFIG.audio || {};

/** Air-absorption low-pass cutoff (Hz) for a source d m away. */
export function airCutoff(d) {
  const k = Math.min(1, Math.max(0, d) / (A().airDistance ?? 120));
  return 20000 * Math.pow((A().airMinHz ?? 3500) / 20000, k);
}

/**
 * Distance attenuation, pan and air absorption for a world position heard from (cx, cz).
 * @param {{x:number,z:number}} pos
 * @param {number} viewWidth live frustum width (m) — pan only
 * @param {number} [range] per-sound audible radius (m) replacing the class max (e.g. M2 pboat 60 m, §7.5)
 * @param {string} [cls] distance class (manifest.js DISTANCE), default 'mech'
 * @param {number} [yaw] camera yaw (rad): pan follows the screen-right axis, not world x
 * @returns {{gain:number, pan:number, d:number, far:boolean, cull:boolean, lp:number}}
 */
export function spatialize(pos, cx, cz, viewWidth, range, cls, yaw = 0) {
  const c = DISTANCE[cls] || DISTANCE.mech;
  const max = range > 0 ? range : c.max;
  const ref = Math.min(c.ref, max);
  const dx = pos.x - cx, dz = pos.z - cz;
  const d = Math.hypot(dx, dz);
  const lat = yaw ? dx * Math.cos(yaw) - dz * Math.sin(yaw) : dx; // offset along screen-right (camera yaw, rad)
  const pan = Math.max(-1, Math.min(1, lat / Math.max(1, viewWidth / 2))) * 0.8;
  const lp = airCutoff(d);
  if (d > max) return { gain: 0, pan, d, far: true, cull: true, lp };
  const inv = ref / (ref + (A().rolloff ?? 1) * (Math.max(d, ref) - ref));
  const taper = Math.min(1, (max - d) / (0.15 * max));
  return { gain: inv * taper, pan, d, far: d > 0.5 * max, cull: false, lp };
}

export class AudioEngine {
  /**
   * @param {AudioContext|object} ctx a real or mock AudioContext
   * @param {{fetch?:Function, base?:string, sampleRate?:number, rand?:Function, jitter?:boolean, media?:Function}} [opts]
   *   `jitter`: round-robin detune ±3 % and gain ±1.5 dB on sfx one-shots; `media`: () => HTMLAudioElement (streamed beds)
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.fetch = opts.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.base = opts.base ?? 'assets/audio/';
    this.sr = opts.sampleRate ?? 22050;
    this.rand = opts.rand ?? Math.random;
    this.jitter = opts.jitter ?? false;
    this.media = opts.media !== undefined ? opts.media
      : (typeof Audio === 'function' && ctx.createMediaElementSource ? () => new Audio() : null);
    this.master = ctx.createGain();
    this.out = this.master;
    if (ctx.createDynamicsCompressor) { // glue compressor → brick-wall-ish limiter (§1.5.0)
      const glue = comp(ctx, -18, 12, 3, 0.01, 0.25), lim = comp(ctx, -2, 0, 20, 0.002, 0.08);
      this.master.connect(glue); glue.connect(lim); lim.connect(ctx.destination);
    } else this.master.connect(ctx.destination);
    this.bus = {};
    for (const b of BUSSES) { this.bus[b] = ctx.createGain(); this.bus[b].connect(this.master); }
    this.cache = new Map(); // key → AudioBuffer (synth renders)
    this.files = new Map(); // sfx/music id → [url]
    this.meta = new Map(); // url → {category, mode, duration}
    this.decoded = new Map(); // url → AudioBuffer | 'pending' | 'failed'
    this.voiceFiles = new Map(); // `${speaker}|${key}|${n}` → url (legacy key/n rows)
    this.voiceRec = new Map(); // `${speaker}|${rec}` → [{voice, url, alt, timing}]
    this.voiceSpeakers = new Set(); // speakers with a recorded pack (their unrecorded lines stay silent)
    this.pinned = new Map(); // id → url[] restricted for this mission (one siren take …)
    this.rr = new Map(); // id → round-robin counter
    this.active = new Set();
    this.musicMeta = new Map(); // music cue → {loopStart, loopEnd, endSec, bpm, barSec, decodeRate, …} (music/manifest.json meta)
    this.musicStreams = new Map(); // music cue → {chunks, wrap} (streamed: audio/music-stream.js)
    this.listener = { x: 0, z: 0, viewWidth: 40, yaw: 0 };
    this.ready = Promise.resolve();
    this.loading = new Map(); // url → Promise<AudioBuffer|null> (decodes in flight)
    this.lazy = new Map(); // url → last use (s): decoded on demand, evicted least recently used beyond lazyBudget
    this.lazyBudget = opts.lazyBudget ?? defaultLazyBudget();
    this.voiceRate = opts.voiceRate ?? VOICE_RATE;
    this.upmix = new WeakSet(); // mono buffers of near-mono stereo takes: played as two equal channels
    this.packed = new Map(); // url → ArrayBuffer: the compressed bytes of this mission's lazy takes (decode needs no fetch)
    this.pending = new Set(); // deferred handles whose take is still decoding (stopAll reaches them too)
  }

  get now() { return this.ctx.currentTime || 0; }

  /** Set a bus (or 'master') volume, with a short ramp. */
  setBusGain(name, v) {
    const node = name === 'master' ? this.master : this.bus[name];
    if (!node) return;
    ramp(node.gain, v, this.now, 0.05);
  }

  _buffer(key, make) {
    let b = this.cache.get(key);
    if (b) return b;
    const pcm = make();
    if (!pcm) return null;
    b = this.ctx.createBuffer(1, pcm.length, this.sr);
    if (b.copyToChannel) b.copyToChannel(pcm, 0); else b.getChannelData(0).set(pcm);
    this.cache.set(key, b);
    return b;
  }

  /**
   * Decoded recorded buffer for an id (round-robin over its decoded takes), else null. Instant takes that are missing
   * (played before the mission preload, e.g. the menus' UI sounds) start decoding; lazy ones decode when deferred.
   */
  _recorded(id) {
    const urls = this.pinned.get(id) || this.files.get(id);
    if (!urls?.length) return null;
    const start = this.rr.get(id) || 0;
    for (let k = 0; k < urls.length; k++) {
      const u = urls[(start + k) % urls.length];
      const got = this.decoded.get(u);
      if (got && got !== 'pending' && got !== 'failed') { this.rr.set(id, start + k + 1); if (this.lazy.has(u)) this.lazy.set(u, this.now); return got; }
      if (!got && !this._isLazy(u)) this._decode(u);
    }
    this.rr.set(id, start + 1);
    return null;
  }

  /** A recorded take of `id` that may still decode (not failed), round-robin; null when there is none. */
  _decodable(id) {
    const urls = this.pinned.get(id) || this.files.get(id);
    if (!urls?.length || !this.fetch || !this.ctx.decodeAudioData) return null;
    const start = this.rr.get(id) || 0;
    for (let k = 0; k < urls.length; k++) {
      const u = urls[(start + k) % urls.length];
      if (this.decoded.get(u) !== 'failed') return u;
    }
    return null;
  }

  /**
   * Fetch + decode one file (voice lines at `voiceRate`, a `mono`-flagged stereo take to one channel). An Ogg that does
   * not decode is retried as its AAC twin (and the page switches to AAC). @returns {Promise<AudioBuffer|null>}
   */
  _decode(url, { lazy = false, low = false } = {}) {
    if (!this.fetch || !this.ctx.decodeAudioData) return Promise.resolve(null);
    const cur = this.decoded.get(url);
    if (cur && cur !== 'pending' && cur !== 'failed') return Promise.resolve(cur);
    if (this.loading.has(url)) return this.loading.get(url);
    this.decoded.set(url, 'pending');
    const p = (async () => {
      let buf = null;
      try { buf = await this._fetchDecode(url, low); } catch (e) {
        // an Ogg that downloaded but did not decode: its AAC twin; when that decodes, this page switches to AAC
        const twin = e?.decode && aacTwin(url);
        if (twin) { try { buf = await this._fetchDecode(twin, low); useAacAfterFailure(); } catch { buf = null; } }
      }
      this.loading.delete(url);
      if (this.decoded.get(url) !== 'pending') return buf; // evicted meanwhile → not kept
      if (!buf) { this.decoded.set(url, 'failed'); return null; }
      this.decoded.set(url, buf);
      if (lazy) { this.lazy.set(url, this.now); this._trimLazy(); }
      return buf;
    })();
    this.loading.set(url, p);
    return p;
  }

  async _fetchDecode(url, low = false) {
    let ab = this.packed.get(url);
    if (ab) ab = ab.slice(0); // decodeAudioData detaches its input: the kept bytes stay for a re-decode after eviction
    else {
      const res = await this.fetch(this.base + url, low ? LOW : undefined);
      if (!res.ok) throw new Error(res.status);
      ab = await res.arrayBuffer();
    }
    const voice = /^voice\//.test(url);
    let buf = null;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (voice && OAC && this.voiceRate < (this.ctx.sampleRate || 48000)) {
      try { buf = await new OAC(1, 1, this.voiceRate).decodeAudioData(ab.slice(0)); } catch { buf = null; }
    }
    if (!buf) {
      try { buf = await this.ctx.decodeAudioData(ab); } catch (e) { throw Object.assign(new Error(`decode ${url}`), { decode: true, cause: e }); }
    }
    if (this.meta.get(url)?.mono) { // a stereo take whose channels match: one channel, played as two equal ones
      if (buf.numberOfChannels === 2 && this.ctx.createBuffer) buf = this._toMono(buf);
      else if (buf.numberOfChannels === 1) this.upmix.add(buf);
    }
    return buf;
  }

  /** One channel of a near-mono stereo take (the channels match to < -45 dB): half the PCM, the same two channels at playback. */
  _toMono(buf) {
    const m = this.ctx.createBuffer(1, buf.length, buf.sampleRate);
    const a = buf.getChannelData(0), b = buf.getChannelData(1), o = m.getChannelData(0);
    for (let i = 0; i < a.length; i++) o[i] = 0.5 * (a[i] + b[i]);
    this.upmix.add(m);
    return m;
  }

  /** Evict least recently used lazy buffers beyond the budget (a playing source keeps its own reference). */
  _trimLazy() {
    let bytes = 0;
    for (const u of this.lazy.keys()) bytes += pcmBytes(this.decoded.get(u));
    if (bytes <= this.lazyBudget) return;
    for (const [u] of [...this.lazy].sort((x, y) => x[1] - y[1])) {
      if (bytes <= this.lazyBudget) break;
      bytes -= pcmBytes(this.decoded.get(u));
      this.decoded.delete(u); this.lazy.delete(u);
    }
  }

  /** Is `url` decoded on first use (not part of the instant set)? */
  _isLazy(url) {
    if (/^voice\//.test(url)) return !this.meta.get(url)?.nonverbal;
    return lazySfx(this.meta.get(url));
  }

  /** Buffer for an SFX id or music cue: recorded file if available, else the synth placeholder (only for ids without a
   * recorded take that can decode: a take still decoding is not replaced by the placeholder). */
  bufferFor(id) {
    const rec = this._recorded(id);
    if (rec) return rec;
    if (this._decodable(id)) return null;
    const def = SFX[id];
    if (def) return this._buffer(`sfx:${id}`, () => synth(def.recipe, this.sr, hashId(id)));
    // music cues: recorded file only — the music bus never plays a synth placeholder (silence instead)
    return null;
  }

  /**
   * A music cue for the music director (own cache there; not part of the per-mission SFX eviction): streamed chunks
   * (the shipped manifest), or a whole decoded file (legacy manifests). Decoded at `meta.decodeRate`
   * (OfflineAudioContext resamples) to keep the PCM small.
   * @returns {Promise<{buffer: AudioBuffer, meta: object}|{stream: ChunkCue, meta: object}|null>} null: no recorded file
   */
  async loadMusic(id) {
    const st = this.musicStreams.get(id);
    if (st) return this._musicStream(id, st);
    const url = this.files.get(id)?.[0];
    if (!url || !this.fetch || !this.ctx.decodeAudioData) return null;
    try {
      const res = await this.fetch(this.base + url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const meta = this.musicMeta.get(id) || {};
      const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      let buffer = null;
      if (OAC && meta.decodeRate && meta.decodeRate < (this.ctx.sampleRate || 48000)) {
        try { buffer = await new OAC(2, 1, meta.decodeRate).decodeAudioData(ab.slice(0)); } catch { buffer = null; }
      }
      if (!buffer) buffer = await this.ctx.decodeAudioData(ab);
      return { buffer, meta };
    } catch { return null; }
  }

  /**
   * A streamed cue (music/manifest.json chunks): a ChunkCue (nothing decoded yet: the director asks for the chunk it
   * starts at). Chunks decode at the cue's `decodeRate` like the whole cues did. @returns {Promise<{stream, meta}|null>}
   */
  async _musicStream(id, st) {
    if (!this.fetch || !this.ctx.decodeAudioData) return null;
    const meta = this.musicMeta.get(id) || {};
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const rate = OAC && meta.decodeRate && meta.decodeRate < (this.ctx.sampleRate || 48000) ? meta.decodeRate : 0;
    const decode = async (ab) => {
      if (rate) { try { return await new OAC(2, 1, rate).decodeAudioData(ab.slice(0)); } catch { /* full rate */ } }
      return this.ctx.decodeAudioData(ab);
    };
    const load = async (f) => {
      const url = `${this.base}music/${f}${audioExt()}`;
      const r = await this.fetch(url);
      if (!r.ok) throw new Error(r.status);
      const ab = await r.arrayBuffer();
      try { return await decode(ab); } catch (e) {
        if (audioExt() !== '.ogg') throw e;
        // an Ogg chunk that downloaded but did not decode: this browser does not decode Opus after all → AAC
        const t = await this.fetch(`${this.base}music/${f}.m4a`);
        if (!t.ok) throw e;
        const b = await decode(await t.arrayBuffer());
        useAacAfterFailure();
        return b;
      }
    };
    return { stream: new ChunkCue({ id, chunks: st.chunks, wrap: st.wrap, meta, load }), meta };
  }

  /**
   * Decode (if needed) and return a voice line's buffer: the deferred start of a line that was not decoded yet.
   * @returns {Promise<AudioBuffer|null>}
   */
  voiceLater(speaker, key, n, o = {}) {
    const url = (o.rec && this.voiceUrl(speaker, o.rec, o)) || this.voiceFiles.get(`${speaker}|${key}|${n}`);
    if (!url) return Promise.resolve(null);
    const got = this.decoded.get(url);
    if (got && typeof got === 'object') return Promise.resolve(got);
    return this._decode(url, { lazy: this._isLazy(url) });
  }

  /** Duration (s) of a voice line's recorded take, from voice/lines.json (null when unknown). */
  voiceDuration(speaker, rec, o = {}) {
    const url = rec && this.voiceUrl(speaker, rec, o);
    return (url && this.meta.get(url)?.duration) || null;
  }

  /**
   * Play a voice line: now when its take is decoded, else a deferred handle that starts as soon as it decodes (a few
   * ms; dropped when more than LATE_DROP.voice late). The duration is known before (voice/lines.json).
   * @returns {object|null} play handle (null: no recorded take → the caller's fallback / subtitle only)
   */
  playVoice(id, speaker, key, n, text, vo = {}, po = {}) {
    const buffer = this.voiceBuffer(speaker, key, n, text, vo);
    if (buffer) return this.play(id, { ...po, buffer });
    const url = (vo.rec && this.voiceUrl(speaker, vo.rec, vo)) || this.voiceFiles.get(`${speaker}|${key}|${n}`);
    if (!url || this.decoded.get(url) === 'failed' || !this.fetch || !this.ctx.decodeAudioData) return null;
    const t0 = this.now;
    const h = new DeferredHandle(this, id, { ...po, duration: this.meta.get(url)?.duration ?? 0.25 + 0.06 * String(text || '').length }, false);
    this.pending.add(h);
    this._decode(url, { lazy: this._isLazy(url) }).then((buf) => {
      this.pending.delete(h);
      if (!buf || h.ended) { h.ended = true; return; }
      if (this.now - t0 > LATE_DROP.voice) { h.ended = true; h.dropped = true; return; }
      h.bind(this.play(id, { ...po, pos: h.pos, buffer: buf }));
    });
    return h;
  }

  /** True when `speaker` has a recorded take of rec line `rec`. */
  hasVoice(speaker, rec) { return !!rec && this.voiceRec.has(`${speaker}|${rec}`); }

  /** Recorded take for a rec line: voice n (German guards 1–3, by unit), the urgent "alt" take when asked. */
  voiceUrl(speaker, rec, { voice = 0, urgent = false } = {}) {
    const takes = this.voiceRec.get(`${speaker}|${rec}`);
    if (!takes?.length) return null;
    const t = takes[Math.abs(voice) % takes.length];
    return (urgent && t.alt) || t.url;
  }

  /**
   * Buffer for a voice line. Recorded rec line / legacy key-n file when decoded; a speaker WITH a recorded
   * pack stays silent on lines it has no take for (subtitle only); the babble placeholder is only used
   * when no voice assets are loaded at all.
   * @param {{rec?:string, voice?:number, urgent?:boolean}} [o]
   */
  voiceBuffer(speaker, key, n, text, o = {}) {
    const url = (o.rec && this.voiceUrl(speaker, o.rec, o)) || this.voiceFiles.get(`${speaker}|${key}|${n}`);
    if (url) {
      const got = this.decoded.get(url);
      if (got && got !== 'pending' && got !== 'failed') { if (this.lazy.has(url)) this.lazy.set(url, this.now); return got; }
      if (!got) this._decode(url, { lazy: this._isLazy(url) });
      if (got !== 'failed') return null;
    }
    if (this.voiceSpeakers.has(speaker)) return null;
    return this._buffer(`voice:${speaker}:${text}`, () => synthVoice(this.sr, text, PITCH[speaker] ?? 120));
  }

  /**
   * Start a sound. Returns a handle {id, bus, loop, pos, base, stop(fade?), setGain(g), setPos(p), ended}
   * or null when culled / no buffer. Beds (SFX def `bed`) with a recorded file are streamed.
   * @param {string} id SFX id / music cue (or any id when opts.buffer is given)
   * @param {{pos?:{x:number,z:number}|null, gain?:number, loop?:boolean, bus?:string, buffer?:AudioBuffer, rate?:number,
   *   fadeIn?:number, range?:number, cls?:string, offset?:number}} [o]
   *   `range`: per-sound audible radius in m (see spatialize); `offset` (s, or 'random') into the buffer
   */
  play(id, o = {}) {
    const def = SFX[id];
    const bus = o.bus || def?.bus || (MUSIC[id] ? 'music' : 'sfx');
    const loop = o.loop ?? (def?.loop || !!MUSIC[id]?.loop);
    const pos = o.pos && Number.isFinite(o.pos.x) && Number.isFinite(o.pos.z) ? { x: o.pos.x, z: o.pos.z } : null;
    const cls = o.cls || def?.cls || classOf(id);
    const range = o.range > 0 ? o.range : undefined;
    let sp = { gain: 1, pan: 0, cull: false, d: 0, lp: 20000 };
    if (pos) {
      sp = spatialize(pos, this.listener.x, this.listener.z, this.listener.viewWidth, range, cls, this.listener.yaw);
      if (sp.cull && !loop) return null;
      // distance timbre (§1.5.0): far explosions use the distant recordings, not a low-passed close one
      if (def?.far && !loop && !o.buffer && sp.d > (A().farLayerAt ?? 160) && this.files.has(def.far)) return this.play(def.far, o);
    }
    const jit = this.jitter && bus === 'sfx' && !loop && !o.buffer;
    const base = (o.gain ?? 1) * (def?.gain ?? 1) * (jit ? 10 ** ((this.rand() - 0.5) * 0.15) : 1) * (o.muffle ? 0.6 : 1);
    if (!o.buffer && this.media && (def?.bed || (loop && this._bedFiles(id)))) {
      if ((this.pinned.get(id) || this.files.get(id))?.length) return this._stream(id, bus, base, o, def?.bed ? null : { pos, sp, range, cls });
    }
    const buffer = o.buffer || this.bufferFor(id);
    if (!buffer) return o.buffer || MUSIC[id] ? null : this._deferred(id, o, loop);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    const rate = (o.rate || 1) * (jit ? 1 + (this.rand() - 0.5) * 0.06 : 1);
    if (rate !== 1 && src.playbackRate) src.playbackRate.value = rate;
    const g = ctx.createGain();
    if (this.upmix.has(buffer)) { g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; } // mono → L = R
    const lp = pos && ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    // `muffle`: a voice through a hand / a closed throat — a fixed 650 Hz low-pass in front of the distance filter
    const mu = o.muffle && ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
    src.connect(mu || g);
    if (mu) { mu.type = 'lowpass'; mu.Q.value = 0.9; mu.frequency.value = 650; mu.connect(g); }
    let tail = g;
    if (lp) { lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = sp.lp; tail.connect(lp); tail = lp; }
    if (p) { tail.connect(p); p.pan.value = sp.pan; tail = p; }
    tail.connect(this.bus[bus]);
    const t0 = this.now;
    const target = base * sp.gain;
    if (o.fadeIn) { g.gain.value = 0; ramp(g.gain, target, t0, o.fadeIn); } else g.gain.value = target;
    const dur = buffer.duration ?? buffer.length / (buffer.sampleRate || this.sr);
    const h = {
      id, bus, loop, pos, base, range, cls, t0, ended: false, src, gainNode: g, panNode: p, lpNode: lp, duration: dur,
      fadeEnd: t0 + (o.fadeIn || 0), applied: { gain: target, pan: sp.pan, lp: sp.lp },
      stop: (fade = 0) => this.stop(h, fade),
      setGain: (v) => { h.base = v; this._apply(h); },
      setPos: (q) => { h.pos = q ? { x: q.x, z: q.z } : null; this._apply(h); },
    };
    src.onended = () => { h.ended = true; this.active.delete(h); };
    const off = o.offset === 'random' ? this.rand() * dur * 0.5 : o.offset || 0;
    if (off > 0 && off < dur) src.start(t0, off); else src.start(t0);
    this.active.add(h);
    return h;
  }

  /**
   * A recorded take that is not decoded yet (decoded on first use): a handle now, the sound as soon as it decodes
   * (a few ms). A one-shot that would start more than LATE_DROP.sfx late is dropped; loops always start.
   * null when the id has no recorded take that can decode (→ caller's fallback).
   */
  _deferred(id, o, loop) {
    const u = this._decodable(id);
    if (!u) return null;
    this.rr.set(id, (this.rr.get(id) || 0) + 1);
    const t0 = this.now;
    const h = new DeferredHandle(this, id, o, loop);
    this.pending.add(h);
    this._decode(u, { lazy: this._isLazy(u) }).then((buf) => {
      this.pending.delete(h);
      if (!buf || h.ended) { h.ended = true; return; }
      if (!loop && this.now - t0 > LATE_DROP.sfx) { h.ended = true; h.dropped = true; return; }
      h.bind(this.play(id, { ...o, pos: h.pos, buffer: buf }));
    });
    return h;
  }

  /** Are all of an id's takes ambience beds (sfx manifest mode 'bed')? A loop of them streams, even positional. */
  _bedFiles(id) {
    const urls = this.pinned.get(id) || this.files.get(id);
    return !!urls?.length && urls.every((u) => this.meta.get(u)?.mode === 'bed');
  }

  /**
   * Streamed bed: <audio loop> → MediaElementSource → gain → [air low-pass → panner] → bus (never decoded; §1.5.0 memory
   * rule). `P` {pos, sp, range, cls}: a positional loop of bed takes (the M3 dam's falling water) — panned and
   * attenuated like any positional voice.
   */
  _stream(id, bus, base, o, P = null) {
    const urls = this.pinned.get(id) || this.files.get(id);
    const url = urls[Math.floor(this.rand() * urls.length) % urls.length];
    let el, node;
    try {
      el = this.media();
      el.crossOrigin = 'anonymous';
      el.loop = true;
      el.preload = 'auto';
      el.addEventListener?.('loadedmetadata', () => { try { el.currentTime = this.rand() * (el.duration || 0); } catch { /* ignore */ } }, { once: true });
      el.src = this.base + url;
      node = this.ctx.createMediaElementSource(el);
    } catch { return null; }
    const ctx = this.ctx;
    const g = ctx.createGain();
    node.connect(g);
    let tail = g, lp = null, p = null;
    const sp = P?.sp || { gain: 1, pan: 0, lp: 20000 };
    if (P?.pos) {
      if (ctx.createBiquadFilter) { lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = sp.lp; tail.connect(lp); tail = lp; }
      if (ctx.createStereoPanner) { p = ctx.createStereoPanner(); p.pan.value = sp.pan; tail.connect(p); tail = p; }
    }
    tail.connect(this.bus[bus]);
    const t0 = this.now;
    g.gain.value = 0;
    const fade = o.fadeIn ?? A().bedFade ?? 4;
    ramp(g.gain, base * sp.gain, t0, fade);
    const h = {
      id, bus, loop: true, pos: P?.pos || null, range: P?.range, cls: P?.cls, base, t0, ended: false, stream: el, node, gainNode: g,
      panNode: p, lpNode: lp, url, duration: Infinity, src: { streamed: true },
      fadeEnd: t0 + fade, applied: { gain: base * sp.gain, pan: sp.pan, lp: sp.lp },
      stop: (fade = 0) => this.stop(h, fade),
      setGain: (v) => { h.base = v; this._apply(h); },
      setPos: (q) => { if (!P) return; h.pos = q ? { x: q.x, z: q.z } : null; this._apply(h); },
    };
    try { el.play()?.catch?.(() => {}); } catch { /* autoplay refused: retried by unlock */ }
    this.active.add(h);
    return h;
  }

  /** Stop a handle, optionally with a fade (s). */
  stop(h, fade = 0) {
    if (!h || h.ended) return;
    h.ended = true;
    this.active.delete(h);
    const t = this.now;
    if (h.stream) {
      ramp(h.gainNode.gain, 0, t, Math.max(0.02, fade));
      const kill = () => { try { h.stream.pause(); h.stream.removeAttribute?.('src'); h.stream.load?.(); h.node.disconnect(); } catch { /* ignore */ } };
      if (typeof setTimeout === 'function') setTimeout(kill, Math.max(0.02, fade) * 1000 + 60); else kill();
      return;
    }
    try {
      if (fade > 0) { ramp(h.gainNode.gain, 0, t, fade); h.src.stop(t + fade + 0.02); } else h.src.stop(t);
    } catch { /* already stopped */ }
  }

  /**
   * Re-spatialize a live voice (listener moved, the source moved, or its base gain changed) — called every frame for
   * every positional voice. Gain, pan and air-absorption cutoff GLIDE to their new values (glide(): a first-order
   * setTargetAtTime chain, continuous on the audio thread). Stepping them per frame (pan/cutoff `.value =`, or a 50 ms
   * ramp restarted every frame from the main thread's lagging `param.value`) modulated every moving loop at the frame /
   * render-callback rate: audible zipper sidebands (±94 Hz on a test tone) while the camera or a vehicle moves.
   * Unchanged targets schedule nothing; a fade-in still in progress (play `fadeIn`, beds) keeps its length.
   */
  _apply(h) {
    if (h.ended) return;
    let gain = h.base, pan = 0, lp = 20000;
    if (h.pos) {
      const sp = spatialize(h.pos, this.listener.x, this.listener.z, this.listener.viewWidth, h.range, h.cls, this.listener.yaw);
      gain *= sp.gain; pan = sp.pan; lp = sp.lp;
    }
    const a = h.applied || (h.applied = { gain: NaN, pan: NaN, lp: NaN });
    const now = this.now;
    const left = (h.fadeEnd ?? 0) - now;
    if (!(Math.abs(gain - a.gain) <= 1e-5) || left > 0) {
      glide(h.gainNode.gain, gain, now, left > 0 ? Math.max(GLIDE_TAU, left / 3) : GLIDE_TAU, left > -0.1);
      a.gain = gain;
    }
    if (h.panNode && !(Math.abs(pan - a.pan) <= 1e-4)) { glide(h.panNode.pan, pan, now, GLIDE_TAU); a.pan = pan; }
    if (h.lpNode && !(Math.abs(lp - a.lp) <= 0.5)) { glide(h.lpNode.frequency, lp, now, GLIDE_TAU); a.lp = lp; }
  }

  /** Move the listener to the active view centre (width = live frustum width); re-spatialize positional voices. */
  setListener(x, z, viewWidth, yaw) {
    this.listener.x = x; this.listener.z = z;
    if (Number.isFinite(yaw)) this.listener.yaw = yaw;
    if (viewWidth > 0) this.listener.viewWidth = viewWidth;
    for (const h of this.active) if (h.pos) this._apply(h);
  }

  stopAll(filter = () => true, fade = 0.2) {
    for (const h of [...this.active]) if (filter(h)) this.stop(h, fade);
    for (const h of [...this.pending]) if (filter(h)) { h.stop(fade); this.pending.delete(h); }
  }

  /**
   * Load the asset manifests (all optional; 404 → synth placeholders stay): sfx/manifest.json
   * (tools/audio/build_assets.py), music/manifest.json {cues:{id:[file]}}, voice/lines.json.
   */
  loadManifests() {
    if (!this.fetch) return (this.ready = Promise.resolve({ sfx: 0, music: 0, voice: 0 }));
    const get = async (p) => { try { const r = await this.fetch(this.base + p); return r.ok ? await r.json() : null; } catch { return null; } };
    this.ready = Promise.all([get('sfx/manifest.json'), get('music/manifest.json'), get('voice/lines.json')])
      .then(([sfx, music, voice]) => this.applyManifests({ sfx, music, voice }));
    return this.ready;
  }

  /** Index already-parsed manifests (split out for tests). */
  applyManifests({ sfx, music, voice } = {}) {
    const n = { sfx: 0, music: 0, voice: 0 };
    for (const s of sfx?.sounds || []) {
      const file = pickAudio(s.files, 'sfx/');
      if (!file) continue;
      this.meta.set(file, { category: s.category, mode: s.mode, duration: s.duration ?? 0, mono: !!s.mono });
      for (const [id, def] of Object.entries(SFX)) {
        if (s.category === id || def.alias.includes(s.category)) { addTo(this.files, id, file); n.sfx++; }
      }
    }
    for (const [id, cue] of Object.entries(music?.cues || {})) {
      if (cue && !Array.isArray(cue) && cue.chunks?.length) { // streamed (tools/audio/web_formats.py)
        this.musicStreams.set(id, { chunks: cue.chunks, wrap: cue.wrap || null });
        addTo(this.files, id, `music/${id}/`); n.music++;
      } else {
        const file = pickMusic([].concat(cue));
        if (file) { addTo(this.files, id, file); n.music++; }
      }
      if (music.meta?.[id]) this.musicMeta.set(id, { ...music.meta[id] });
    }
    for (const l of voice?.lines || []) {
      if (l.rec && l.files) { // recorded rec line (tools/audio/build_assets.py)
        const takes = this.voiceRec.get(`${l.speaker}|${l.rec}`) || [];
        const url = pickAudio(l.files, 'voice/'), alt = l.alt ? pickAudio(l.alt, 'voice/') : null;
        for (const u of [url, alt]) if (u) this.meta.set(u, { duration: l.duration ?? null, nonverbal: !!l.nonverbal });
        takes.push({ voice: l.voice ?? 1, url, alt, timing: l.timing ? `voice/${l.timing}` : null, text: l.text });
        takes.sort((a, b) => a.voice - b.voice);
        this.voiceRec.set(`${l.speaker}|${l.rec}`, takes);
        this.voiceSpeakers.add(l.speaker);
        n.voice++;
      } else if (l.file) {
        this.voiceFiles.set(`${l.speaker}|${l.key}|${l.n ?? 0}`, l.file.startsWith('voice/') ? l.file : `voice/${l.file}`);
        n.voice++;
      }
    }
    return n;
  }

  /**
   * Per-mission loading (§1.5.0 memory rule): decode the takes for `ids` plus the voice packs of `speakers`,
   * evict every other decoded buffer. Long takes (> 12 s, e.g. the siren) are pinned to ONE per mission and
   * loops to two; beds are streamed and skipped. Resolves with {buffers, bytes} of decoded PCM.
   */
  async preload(ids, { speakers = [] } = {}) {
    await this.ready;
    const want = new Set(), later = new Set();
    for (const id of ids) {
      const def = SFX[id];
      const urls = this.files.get(id);
      if (!urls?.length) continue;
      this.pinned.delete(id);
      if (def?.bed || this._bedFiles(id)) continue; // streamed through a media element
      let use = urls;
      const long = urls.filter((u) => (this.meta.get(u)?.duration ?? 0) > 12);
      if (long.length) use = [long[Math.floor(this.rand() * long.length) % long.length]];
      else if (def?.loop && urls.length > 2) use = urls.slice(0, 2);
      if (use !== urls) this.pinned.set(id, use);
      use.forEach((u) => (this._isLazy(u) ? later : want).add(u));
    }
    const sp = new Set(speakers);
    for (const [k, takes] of this.voiceRec) {
      if (!sp.has(k.split('|')[0])) continue;
      for (const t of takes) for (const u of [t.url, t.alt]) if (u) (this._isLazy(u) ? later : want).add(u);
    }
    // this mission's instant set decodes now; the rest is downloaded now (compressed bytes, a few % of the PCM) and
    // decodes on first use; everything else goes
    for (const u of [...this.decoded.keys()]) {
      if (want.has(u) || (later.has(u) && this.lazy.has(u)) || this.decoded.get(u) === 'pending') continue;
      this.decoded.delete(u); this.lazy.delete(u);
    }
    for (const u of [...this.lazy.keys()]) if (!this.decoded.has(u)) this.lazy.delete(u);
    for (const u of [...this.packed.keys()]) if (!later.has(u)) this.packed.delete(u);
    await Promise.all([
      ...[...want].filter((u) => !this.decoded.has(u) || this.decoded.get(u) === 'pending').map((u) => this._decode(u, { low: true })),
      ...[...later].filter((u) => !this.packed.has(u)).map((u) => this._pack(u)),
    ]);
    return this.memory();
  }

  /** Download a lazy take's compressed bytes (kept; decoded on first use). */
  async _pack(url) {
    try {
      const r = await this.fetch(this.base + url, LOW);
      if (r.ok) this.packed.set(url, await r.arrayBuffer());
    } catch { /* decoded from the network on first use instead */ }
  }

  /**
   * Mission left (back to the menus): everything decoded on demand goes (voice lines, loops, sirens). The instant set
   * stays, like the mission's other assets in the session cache (engine/asset-cache.js): a restart from the menus is
   * instant; the next mission's preload replaces it.
   */
  dropMission() {
    for (const u of [...this.lazy.keys()]) if (this.decoded.get(u) !== 'pending') this.decoded.delete(u);
    this.lazy.clear();
  }

  /** Decoded PCM held right now. */
  memory() {
    let bytes = 0, buffers = 0, lazyBytes = 0;
    for (const [u, b] of this.decoded) {
      if (!b || typeof b !== 'object') continue;
      buffers++;
      bytes += pcmBytes(b);
      if (this.lazy.has(u)) lazyBytes += pcmBytes(b);
    }
    let packedBytes = 0;
    for (const b of this.packed.values()) packedBytes += b.byteLength || 0;
    return { buffers, bytes, lazyBytes, lazyBuffers: this.lazy.size, packedBytes };
  }
}

const pcmBytes = (b) => (b && typeof b === 'object' ? (b.length || 0) * (b.numberOfChannels || 1) * 4 : 0);

/**
 * Handle of a sound that starts when its take has decoded (engine._deferred): the play() handle API (stop, setGain,
 * setPos, ended, duration, src.playbackRate) — calls before the start are remembered and applied to the real handle.
 */
class DeferredHandle {
  constructor(engine, id, o, loop) {
    this.engine = engine; this.id = id; this.loop = loop; this.bus = o.bus; this.deferred = true;
    this.pos = o.pos && Number.isFinite(o.pos.x) ? { x: o.pos.x, z: o.pos.z } : null;
    this.baseGain = o.gain; this.gainSet = false; this.real = null; this._ended = false;
    this.duration = o.duration ?? engine.meta.get((engine.pinned.get(id) || engine.files.get(id))?.[0])?.duration ?? 0;
    this._rate0 = o.rate || 1;
    this.src = { playbackRate: { value: this._rate0 }, deferred: true };
  }
  get ended() { return this._ended || !!this.real?.ended; }
  set ended(v) { this._ended = !!v; }
  get base() { return this.real ? this.real.base : this.baseGain; }
  bind(real) {
    if (!real) { this._ended = true; return; }
    if (this._ended) { real.stop(0); return; }
    this.real = real;
    const r = this.src.playbackRate.value; // changed before the start (startLoop with a new rate)
    if (r !== this._rate0 && real.src?.playbackRate) real.src.playbackRate.value *= r / this._rate0;
    this.src = real.src;
    this.duration = real.duration;
    if (this.gainSet) real.setGain(this.baseGain); // setGain before the start: as on a live handle
  }
  stop(fade = 0) { this._ended = true; this.real?.stop(fade); }
  setGain(v) { this.baseGain = v; this.gainSet = true; this.real?.setGain(v); }
  setPos(p) { this.pos = p ? { x: p.x, z: p.z } : null; this.real?.setPos(p); }
}

function comp(ctx, threshold, knee, ratio, attack, release) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = threshold; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = attack; c.release.value = release;
  return c;
}

/** Whole-file music cues (legacy manifests / tests): this browser's file of the list. */
function pickMusic(files = []) { return pickAudio(files, 'music/'); }
function addTo(map, id, file) { const a = map.get(id) || []; if (!a.includes(file)) a.push(file); map.set(id, a); }
function hashId(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h || 1; }

/** Time constant (s) of the per-frame spatial glides (≈ 95 % of a change within 3 τ = 90 ms). */
export const GLIDE_TAU = 0.03;

/**
 * Steer an AudioParam towards v with a first-order glide (setTargetAtTime, time constant `tau` s). A setTarget chain
 * continues from the value the audio thread holds at `t` — never from the main thread's `param.value`, which lags by
 * up to a render buffer. `hold`: a ramp may still be in flight (a fade-in): it is cut where it is (cancelAndHoldAtTime;
 * browsers without it: cancel + the timeline's current value) before the glide takes over. Mock params jump to v.
 */
export function glide(param, v, t, tau = GLIDE_TAU, hold = false) {
  if (!param.setTargetAtTime) { param.value = v; return; }
  if (hold) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else if (param.cancelScheduledValues) { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
  }
  param.setTargetAtTime(v, t, Math.max(0.005, tau));
}

/** Glide an AudioParam to v over `dur` s (works on mock params that only have .value). */
export function ramp(param, v, t, dur) {
  if (param.cancelScheduledValues && param.linearRampToValueAtTime) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + Math.max(0.005, dur));
  } else param.value = v;
}
