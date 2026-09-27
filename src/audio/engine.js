/**
 * WebAudio graph (design-spec §9 engine; realism-pipeline v2 §1.5.0):
 *   master → glue compressor → limiter → destination; busses sfx, voice, ambience, music, ui → master.
 *   Every voice is  source → gain → [air-absorption low-pass] → stereoPanner → bus.
 * Positional sounds are heard from the active view centre (ortho camera): per-category reference and
 * max distance (manifest.js DISTANCE: footsteps ~30 m, voices 60 m, small arms 400 m, MG/explosions
 * 1.5 km) with the inverse law, a short taper before `max`, an air-absorption low-pass (20 kHz at 0 m →
 * 3.5 kHz at 120 m), and pan = lateral offset / the LIVE frustum half-width (zoom-aware). The law is
 * computed here rather than by a PannerNode so it is deterministic and unit-testable with a mock context.
 * Recorded assets (assets/audio, tools/audio/build_assets.py) replace the synth placeholders:
 *   - one-shots / loops are decoded per mission (preload + evict: decoded PCM is the memory limit),
 *   - ambience beds are streamed through a media element (never decoded),
 *   - voices come from voice/lines.json (rec lines; German voices 1–3; urgent "alt" takes).
 * @module audio/engine
 */

import { CONFIG } from '../config.js';
import { BUSSES, SFX, MUSIC, DISTANCE, classOf } from './manifest.js';
import { synth, synthVoice } from './synth.js';
import { PITCH } from './voice-lines.js';

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
 * @returns {{gain:number, pan:number, d:number, far:boolean, cull:boolean, lp:number}}
 */
export function spatialize(pos, cx, cz, viewWidth, range, cls) {
  const c = DISTANCE[cls] || DISTANCE.mech;
  const max = range > 0 ? range : c.max;
  const ref = Math.min(c.ref, max);
  const dx = pos.x - cx, dz = pos.z - cz;
  const d = Math.hypot(dx, dz);
  const pan = Math.max(-1, Math.min(1, dx / Math.max(1, viewWidth / 2))) * 0.8;
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
    this.listener = { x: 0, z: 0, viewWidth: 40 };
    this.ready = Promise.resolve();
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

  /** Decoded recorded buffer for an id (round-robin over its decoded takes), else null (kicks lazy decoding). */
  _recorded(id) {
    const urls = this.pinned.get(id) || this.files.get(id);
    if (!urls?.length) return null;
    const start = this.rr.get(id) || 0;
    for (let k = 0; k < urls.length; k++) {
      const u = urls[(start + k) % urls.length];
      const got = this.decoded.get(u);
      if (got && got !== 'pending' && got !== 'failed') { this.rr.set(id, start + k + 1); return got; }
      if (!got) this._decode(u);
    }
    this.rr.set(id, start + 1);
    return null;
  }

  async _decode(url) {
    if (!this.fetch || !this.ctx.decodeAudioData) return;
    this.decoded.set(url, 'pending');
    try {
      const res = await this.fetch(this.base + url);
      if (!res.ok) throw new Error(res.status);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      if (this.decoded.get(url) === 'pending') this.decoded.set(url, buf); // evicted meanwhile → drop
    } catch { if (this.decoded.get(url) === 'pending') this.decoded.set(url, 'failed'); }
  }

  /** Buffer for an SFX id or music cue: recorded file if available, else the synth placeholder. */
  bufferFor(id) {
    const rec = this._recorded(id);
    if (rec) return rec;
    const def = SFX[id];
    if (def) return this._buffer(`sfx:${id}`, () => synth(def.recipe, this.sr, hashId(id)));
    const cue = MUSIC[id];
    if (cue) return this._buffer(`music:${cue.mood}`, () => synth(cue.mood, this.sr));
    return null;
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
      if (got && got !== 'pending' && got !== 'failed') return got;
      if (!got) this._decode(url);
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
      sp = spatialize(pos, this.listener.x, this.listener.z, this.listener.viewWidth, range, cls);
      if (sp.cull && !loop) return null;
      // distance timbre (§1.5.0): far explosions use the distant recordings, not a low-passed close one
      if (def?.far && !loop && !o.buffer && sp.d > (A().farLayerAt ?? 160) && this.files.has(def.far)) return this.play(def.far, o);
    }
    const jit = this.jitter && bus === 'sfx' && !loop && !o.buffer;
    const base = (o.gain ?? 1) * (def?.gain ?? 1) * (jit ? 10 ** ((this.rand() - 0.5) * 0.15) : 1);
    if (def?.bed && !o.buffer && this.media && (this.pinned.get(id) || this.files.get(id))?.length) return this._stream(id, bus, base, o);
    const buffer = o.buffer || this.bufferFor(id);
    if (!buffer) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    const rate = (o.rate || 1) * (jit ? 1 + (this.rand() - 0.5) * 0.06 : 1);
    if (rate !== 1 && src.playbackRate) src.playbackRate.value = rate;
    const g = ctx.createGain();
    const lp = pos && ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(g);
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

  /** Streamed bed: <audio loop> → MediaElementSource → gain → bus (never decoded; §1.5.0 memory rule). */
  _stream(id, bus, base, o) {
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
    const g = this.ctx.createGain();
    node.connect(g);
    g.connect(this.bus[bus]);
    const t0 = this.now;
    g.gain.value = 0;
    ramp(g.gain, base, t0, o.fadeIn ?? A().bedFade ?? 4);
    const h = {
      id, bus, loop: true, pos: null, base, t0, ended: false, stream: el, node, gainNode: g, url, duration: Infinity, src: { streamed: true },
      stop: (fade = 0) => this.stop(h, fade),
      setGain: (v) => { h.base = v; this._apply(h); },
      setPos: () => {},
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

  _apply(h) {
    if (h.ended) return;
    let gain = h.base, pan = 0, lp = 20000;
    if (h.pos) {
      const sp = spatialize(h.pos, this.listener.x, this.listener.z, this.listener.viewWidth, h.range, h.cls);
      gain *= sp.gain; pan = sp.pan; lp = sp.lp;
    }
    ramp(h.gainNode.gain, gain, this.now, 0.05);
    if (h.panNode) h.panNode.pan.value = pan;
    if (h.lpNode) h.lpNode.frequency.value = lp;
  }

  /** Move the listener to the active view centre (width = live frustum width); re-spatialize positional voices. */
  setListener(x, z, viewWidth) {
    this.listener.x = x; this.listener.z = z;
    if (viewWidth > 0) this.listener.viewWidth = viewWidth;
    for (const h of this.active) if (h.pos) this._apply(h);
  }

  stopAll(filter = () => true, fade = 0.2) {
    for (const h of [...this.active]) if (filter(h)) this.stop(h, fade);
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
      const file = pickFile(s.files, 'sfx/');
      if (!file) continue;
      this.meta.set(file, { category: s.category, mode: s.mode, duration: s.duration ?? 0 });
      for (const [id, def] of Object.entries(SFX)) {
        if (s.category === id || def.alias.includes(s.category)) { addTo(this.files, id, file); n.sfx++; }
      }
    }
    for (const [id, files] of Object.entries(music?.cues || {})) {
      const file = pickFile([].concat(files), 'music/');
      if (file) { addTo(this.files, id, file); n.music++; }
    }
    for (const l of voice?.lines || []) {
      if (l.rec && l.files) { // recorded rec line (tools/audio/build_assets.py)
        const takes = this.voiceRec.get(`${l.speaker}|${l.rec}`) || [];
        takes.push({ voice: l.voice ?? 1, url: pickFile(l.files, 'voice/'), alt: l.alt ? pickFile(l.alt, 'voice/') : null,
          timing: l.timing ? `voice/${l.timing}` : null, text: l.text });
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
    const want = new Set();
    for (const id of ids) {
      const def = SFX[id];
      const urls = this.files.get(id);
      if (!urls?.length) continue;
      this.pinned.delete(id);
      if (def?.bed) continue;
      let use = urls;
      const long = urls.filter((u) => (this.meta.get(u)?.duration ?? 0) > 12);
      if (long.length) use = [long[Math.floor(this.rand() * long.length) % long.length]];
      else if (def?.loop && urls.length > 2) use = urls.slice(0, 2);
      if (use !== urls) this.pinned.set(id, use);
      use.forEach((u) => want.add(u));
    }
    const sp = new Set(speakers);
    for (const [k, takes] of this.voiceRec) {
      if (!sp.has(k.split('|')[0])) continue;
      for (const t of takes) { want.add(t.url); if (t.alt) want.add(t.alt); }
    }
    for (const u of [...this.decoded.keys()]) if (!want.has(u)) this.decoded.delete(u);
    await Promise.all([...want].filter((u) => !this.decoded.has(u)).map((u) => this._decode(u)));
    return this.memory();
  }

  /** Decoded PCM held right now. */
  memory() {
    let bytes = 0, buffers = 0;
    for (const b of this.decoded.values()) {
      if (!b || typeof b !== 'object') continue;
      buffers++;
      bytes += (b.length || 0) * (b.numberOfChannels || 1) * 4;
    }
    return { buffers, bytes };
  }
}

function comp(ctx, threshold, knee, ratio, attack, release) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = threshold; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = attack; c.release.value = release;
  return c;
}

/** Opus/OGG first, MP3 fallback (Safari without Opus). Paths are relative to assets/audio/. */
function pickFile(files = [], prefix) {
  const canOgg = typeof Audio === 'undefined' || !!new Audio().canPlayType?.('audio/ogg; codecs=opus');
  const f = files.find((x) => (canOgg ? /\.ogg$/ : /\.mp3$/).test(x)) || files[0];
  return f ? (f.startsWith(prefix) ? f : prefix + f) : null;
}
function addTo(map, id, file) { const a = map.get(id) || []; if (!a.includes(file)) a.push(file); map.set(id, a); }
function hashId(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h || 1; }

/** Glide an AudioParam to v over `dur` s (works on mock params that only have .value). */
export function ramp(param, v, t, dur) {
  if (param.cancelScheduledValues && param.linearRampToValueAtTime) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + Math.max(0.005, dur));
  } else param.value = v;
}
