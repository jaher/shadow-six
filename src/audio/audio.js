/**
 * AUDIO (design-spec §9; ARCHITECTURE "Audio"). Event-driven: createAudio(events) subscribes to the
 * canonical events listed in sfx-events.js and turns them into SFX (§9.3), voice lines (§9.4), the
 * siren (§4.9), theater ambience (§9.2) and music (§9.1 menu/briefing beds + stingers; in missions the adaptive
 * suspense score of music-director.js, option `missionMusic` — false = "Classic 1998", no in-mission music).
 *
 * Contract: createAudio(events, opts?) → { unlock(), setMuted(b), setVolume(ch, v), setOption(k, v),
 *   playSfx(id, pos?, o?), music(track|null), say(unit, key), update(cx, cz, viewWidth?), debug(), dispose(),
 *   log, muted, volumes, options, track, unlocked }
 * opts (tests): { createContext(), now(), rand(), fetch, storage, autoUnlock, base }.
 * Before unlock() (first user gesture) nothing is audible; requests are still logged.
 * @module audio/audio
 */

import { CONFIG } from '../config.js';
import { AudioEngine, spatialize } from './engine.js';
import { SFX, MUSIC, ambienceFor } from './manifest.js';
import { VoiceDirector, lineKey, speakerOf } from './voice-lines.js';
import { installHandlers, missionAudio } from './event-map.js';
import { MusicDirector } from './music-director.js';

const hashStr = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

const LOG_MAX = 200;
const STORE_KEY = 'shadowsix.audio.v1';
const MISSION_STATES = new Set(['playing', 'paused']);
/** Default user options (§6.8 menu): "Nature sounds" ON, Verbose, cinematic drone OFF. */
export const DEFAULT_OPTIONS = Object.freeze({ natureSounds: true, laconic: false, cinematicAmbience: false, subtitles: true, missionMusic: true });

function defaultContext() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  return AC ? new AC() : null;
}
function wallNow() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }
function posOf(o) {
  if (!o) return null;
  if (Number.isFinite(o.x) && Number.isFinite(o.z)) return { x: o.x, z: o.z };
  return null;
}
const idOf = (o) => (o && (o.id ?? o.tag)) ?? o;

/**
 * @param {import('../core/events.js').EventBus} events
 * @param {object} [opts]
 */
export function createAudio(events, opts = {}) {
  const subs = [];
  const storage = opts.storage !== undefined ? opts.storage : (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  const saved = (() => { try { return JSON.parse(storage?.getItem(STORE_KEY) || 'null') || {}; } catch { return {}; } })();
  const rand = opts.rand || Math.random;

  const audio = {
    unlocked: false,
    muted: !!saved.muted,
    volumes: { master: CONFIG.audio?.masterVolume ?? 0.8, sfx: 1, voice: 1, ambience: 1, music: 0.6, ui: 0.8, ...(saved.volumes || {}) },
    options: { ...DEFAULT_OPTIONS, ...(saved.options || {}) },
    track: 'menu', // requested music cue (plays only outside missions; the game boots on the title screen)
    gameState: 'title',
    listener: { x: 0, z: 0, viewWidth: 40, yaw: 0 },
    log: [],
    engine: null,
    world: null,
    mission: null,
    director: new VoiceDirector({ rand, laconic: !!saved.options?.laconic }),
    siren: { active: false, gain: 0, start: 0, handles: [] },
    loops: new Map(), // key → {handle, follow?, id}
    bursts: new Map(), // shooter key → {handle, until} (recorded MG bursts)
    memory: null, // decoded PCM after the last per-mission preload {buffers, bytes}
    timers: [], // [{at, fn}]
    ambience: [], // [{id, gain, sparse?, handle?, next?}]
    musicHandle: null,
    lastStepEvent: -1e9,
    recent: new Map(), // dedupe key → time
    bombs: new Map(), // bomb key → {bomb, start, fuse, next}

    now() { return opts.now ? opts.now() : this.engine ? this.engine.now : wallNow(); },
    /** Mission-time clock (pauses with the sim) for siren envelopes and bomb ticks. */
    simNow() { return this.world?.clock ?? this.world?.time ?? this.now(); },
    inMission() { return MISSION_STATES.has(this.gameState); },

    _push(entry) {
      entry.t = +this.now().toFixed(3);
      this.log.push(entry);
      if (this.log.length > LOG_MAX) this.log.shift();
      return entry;
    },
    _save() {
      try { storage?.setItem(STORE_KEY, JSON.stringify({ muted: this.muted, volumes: this.volumes, options: this.options })); } catch { /* private mode */ }
    },

    /** Create/resume the AudioContext (call from a user gesture). Idempotent. */
    unlock() {
      if (!this.engine) {
        let ctx = null;
        try { ctx = (opts.createContext || defaultContext)(); } catch { ctx = null; }
        if (!ctx) return false;
        this.engine = new AudioEngine(ctx, { fetch: opts.fetch, base: opts.base, rand, jitter: opts.jitter ?? !opts.createContext });
        this.engine.setListener(this.listener.x, this.listener.z, this.listener.viewWidth, this.listener.yaw);
        this._applyVolumes();
        const eng = this.engine;
        this.musicDir = new MusicDirector({ ctx: eng.ctx, out: eng.bus.music,
          load: opts.musicLoad || ((id) => eng.loadMusic(id)), has: opts.musicHas || ((id) => eng.files.has(id)),
          log: (e) => this._push(e) });
        // the score must keep chaining while the game loop is paused/throttled: tick it from a timer too
        if (typeof window !== 'undefined' && typeof setInterval === 'function') this._musicTimer = setInterval(() => this._musicTick(), 250);
        if (opts.loadAssets !== false) {
          eng.loadManifests().then(() => { this._refreshMusic(); if (this.mission) this.musicDir.prefetchMission(this._startCue()); }).catch(() => {});
          if (this.mission) this._preload();
        }
      }
      try { const p = this.engine.ctx.resume?.(); p?.catch?.(() => {}); } catch { /* ignore */ }
      if (!this.unlocked) {
        this.unlocked = true;
        this._refreshMusic();
        this._refreshAmbience();
      }
      return true;
    },

    _applyVolumes() {
      if (!this.engine) return;
      this.engine.setBusGain('master', this.muted ? 0 : this.volumes.master);
      for (const b of ['sfx', 'voice', 'ambience', 'music', 'ui']) this.engine.setBusGain(b, this.volumes[b]);
    },
    /** Per-mission loading: decode this mission's SFX and voice packs, evict the rest (§1.5.0). */
    _preload() {
      if (!this.engine || !this.mission) return null;
      const { ids, speakers } = missionAudio(this.mission);
      const p = this.engine.preload(ids, { speakers }).then((m) => { this.memory = m; return m; }).catch(() => null);
      this.preloading = p;
      return p;
    },
    setMuted(b) { this.muted = !!b; this._applyVolumes(); this._save(); },
    setVolume(ch, v) {
      if (!(ch in this.volumes)) return;
      this.volumes[ch] = Math.max(0, Math.min(1, Number(v) || 0));
      this._applyVolumes();
      this._save();
    },
    /** Options: natureSounds (§9.2), laconic (§9.4), cinematicAmbience (§9.1), subtitles. */
    setOption(k, v) {
      if (!(k in this.options)) return;
      this.options[k] = !!v;
      this.director.laconic = this.options.laconic;
      this._refreshAmbience();
      this._refreshMusic();
      this._save();
    },
  };
  return wire(audio, events, subs, rand, opts);
}

export default createAudio;

/** Playback methods (split from createAudio for readability). */
function addMethods(audio, events, rand) {
  const A = () => CONFIG.audio || {};
  Object.assign(audio, {
    /**
     * Play a §9.3 SFX id at an optional world position (attenuated by distance to the view centre).
     * Duplicate requests for the same id at the same spot within `dedupe` s collapse into one.
     * @returns {object|null} engine handle (null when locked/culled/deduped)
     */
    playSfx(id, pos = null, o = {}) {
      const p = posOf(pos);
      const now = this.now();
      const dk = `${id}|${p ? `${Math.round(p.x)},${Math.round(p.z)}` : '-'}`;
      if (!o.loop && now - (this.recent.get(dk) ?? -1e9) < (o.dedupe ?? A().dedupe ?? 0.08)) return null;
      this.recent.set(dk, now);
      if (this.recent.size > 256) this.recent.clear();
      const sp = p ? spatialize(p, this.listener.x, this.listener.z, this.listener.viewWidth, o.range, o.cls || SFX[id]?.cls, this.listener.yaw) : { gain: 1, cull: false };
      const entry = this._push({ type: SFX[id]?.bus === 'ambience' ? 'ambience' : 'sfx', name: id, event: o.event, x: p?.x, z: p?.z,
        gain: +sp.gain.toFixed(3), loop: !!o.loop || undefined, culled: (sp.cull && !o.loop) || undefined, known: !!SFX[id] });
      if (!this.unlocked || !this.engine || !SFX[id]) return null;
      const h = this.engine.play(id, { pos: p, gain: o.gain, loop: o.loop, rate: o.rate, bus: o.bus, fadeIn: o.fadeIn, range: o.range, offset: o.offset, cls: o.cls });
      entry.played = !!h;
      return h;
    },
    /** Start (or keep) a keyed loop, optionally following an entity's x/z every frame. */
    startLoop(key, id, pos, o = {}) {
      const cur = this.loops.get(key);
      if (cur && cur.id === id) { if (o.rate && cur.handle?.src.playbackRate) cur.handle.src.playbackRate.value = o.rate; return cur; }
      if (cur) this.stopLoop(key, 0.15);
      const rec = { id, follow: o.follow || null, handle: this.playSfx(id, pos, { ...o, loop: true, fadeIn: o.fadeIn ?? 0.1 }) };
      this.loops.set(key, rec);
      return rec;
    },
    stopLoop(key, fade = 0.3) {
      const rec = this.loops.get(key);
      if (!rec) return;
      rec.handle?.stop(fade);
      this.loops.delete(key);
    },
    /**
     * Recorded automatic fire: the first round of a shooter starts one sustained burst take (random offset);
     * later rounds keep it alive; it fades CONFIG.audio.burstTail s after the last round (see update()).
     */
    burst(key, id, pos, o = {}) {
      const now = this.now();
      let rec = this.bursts.get(key);
      if (!rec || rec.handle?.ended) {
        rec = { handle: this.playSfx(id, pos, { ...o, loop: true, offset: 'random' }), until: 0 };
        this.bursts.set(key, rec);
      } else if (pos) rec.handle?.setPos(posOf(pos));
      rec.until = now + (A().burstTail ?? 0.3);
      return rec;
    },
    after(sec, fn) { this.timers.push({ at: this.now() + sec, fn }); },

    // ---- music (§9.1 + suspense score): every music-bus sound goes through the MusicDirector ------------------
    /** Request a music cue: a bed outside missions; in missions loops are refused (the director owns the score). */
    music(track) {
      if (track == null) { this.track = null; this._refreshMusic(); return; }
      const cue = MUSIC[track];
      if (cue && !cue.loop && !cue.mission) { this._stinger(track); return; }
      if (this.inMission()) {
        this._push({ type: 'music', name: track, refused: true });
        this._missionMusicStart(); // a theater name at mission start (Game.start) — idempotent
        return;
      }
      // an unknown name ('theme' from the briefing) means "this screen's music": keep the state's cue (briefing_N)
      // instead of falling back to the menu bed (that dropped and re-decoded the menu, and the briefing never played)
      this.track = cue && !cue.mission ? track : (cueForState(this.gameState, this) || this.track || 'menu');
      this._refreshMusic();
    },
    _startCue() { return this._startCueId || (this._startCueId = `start_${1 + Math.floor(rand() * 6)}`); },
    _stinger(cue) {
      if (this.unlocked && this.musicDir) this.musicDir.stinger(cue);
      else this._push({ type: 'music', name: cue, stinger: true });
    },
    /** Once per mission: start stinger → suspense score (option missionMusic), or the stinger only (Classic 1998). */
    _missionMusicStart() {
      if (this._startStingerDone) return;
      this._startStingerDone = true;
      const st = this._startCue();
      this._startCueId = null;
      if (!this.unlocked || !this.musicDir) { this._push({ type: 'music', name: st, stinger: true }); return; }
      if (this.options.missionMusic) this.musicDir.startMission({ stinger: st });
      else this.musicDir.stinger(st);
      this._refreshMusic();
    },
    /** Desired music: menu/briefing bed outside missions; in missions the suspense score (or silence, Classic). */
    _refreshMusic() {
      const d = this.musicDir;
      if (this.inMission()) {
        this.musicId = this.options.missionMusic ? 'mission' : (this.options.cinematicAmbience ? 'drone' : null);
        if (!d || !this.unlocked) return;
        if (this.options.missionMusic) {
          d.playBed(null);
          if (this._startStingerDone && d.state !== 'mission') d.startMission({ stinger: null }); // toggled on / late unlock
        } else {
          if (d.state === 'mission') d.stopMission(1.5);
          d.playBed(this.options.cinematicAmbience ? 'drone' : null);
        }
        d.setPaused(this.gameState === 'paused');
        return;
      }
      const want = this.track;
      if (this.musicId !== want && want) this._push({ type: 'music', name: want });
      this.musicId = want;
      if (!d || !this.unlocked) return;
      if (d.state === 'mission') d.stopMission(1.5);
      d.setPaused(false);
      d.playBed(want);
    },
    /** Alarm / combat / search → the director's alert layer; voices and briefing speech duck the music. */
    _musicTick() {
      const d = this.musicDir;
      if (!d) return;
      d.setAlarm(!!(this.siren.active || this.world?.alarm?.active));
      const voice = this.engine ? [...this.engine.active].some((h) => h.bus === 'voice' && !h.ended) : false;
      d.setDuck(voice || !!globalThis.speechSynthesis?.speaking);
      d.update();
    },

    // ---- ambience (§9.2) ---------------------------------------------------------------------------
    _refreshAmbience() {
      const want = this.options.natureSounds && this.inMission() && !!this.mission;
      if (!want) { for (const l of this.ambience) l.handle?.stop(1.0); this.ambience = []; return; }
      if (!this.ambience.length) {
        const def = this.mission;
        const night = !!def.night || (def.lighting?.sunElevDeg ?? 30) < 0;
        for (const [id, gain, o = {}] of ambienceFor(def)) {
          if ((o.day && night) || (o.night && !night)) continue;
          this.ambience.push({ id, gain, sparse: o.sparse || 0, far: o.far || null, next: this.now() + (o.sparse ? o.sparse * rand() : 0), handle: null });
        }
      }
      if (this.unlocked) {
        for (const l of this.ambience) {
          if (!l.sparse && !l.handle) l.handle = this.playSfx(l.id, null, { loop: true, gain: l.gain, bus: 'ambience', fadeIn: A().bedFade ?? 4 });
        }
      }
    },
  });
}

/** Siren (§4.9), voice lines (§9.4), per-frame update and debug snapshot. */
function addVoiceSiren(audio, events, rand) {
  const AL = () => CONFIG.alarm || {};
  Object.assign(audio, {
    // ---- siren: SIRENA01 at 0.75, −0.0015 per 50 ms → silent after 25 s; a new RINT restarts it ----
    _sirenStart(e = {}) {
      const s = this.siren;
      s.start = this.simNow();
      s.pos = posOf(e);
      if (!s.active) this._push({ type: 'siren', name: 'siren', x: s.pos?.x, z: s.pos?.z });
      s.active = true;
      s.gain = this._sirenGain();
      this._sirenSync();
    },
    /** Current envelope: the AI alarm's own siren gain when a world is attached, else our copy of the §4.9 law. */
    _sirenGain() {
      const ws = this.world?.alarm?.siren;
      if (ws && typeof ws.gain === 'number') return ws.active ? ws.gain : 0;
      const s = this.siren;
      return Math.max(0, (AL().sirenGain ?? 0.75) - (AL().sirenFadePerSec ?? 0.03) * (this.simNow() - s.start));
    },
    /** Positional wail at the event origin plus a non-positional 30 % bed (§9.3 Alarm). */
    _sirenSync() {
      const s = this.siren;
      if (!s.active || !this.unlocked || !this.engine) return;
      if (!s.handles.length) {
        const bedMul = s.pos ? 0.3 : 1;
        const a = s.pos ? this.engine.play('siren', { pos: s.pos, gain: s.gain, loop: true }) : null;
        const b = this.engine.play('siren', { gain: s.gain * bedMul, loop: true });
        if (a) a.bedMul = 1;
        if (b) b.bedMul = bedMul;
        s.handles = [a, b].filter(Boolean);
      }
      for (const h of s.handles) h.setGain(s.gain * h.bedMul);
    },
    _sirenStop(fade = 1) {
      const s = this.siren;
      if (s.active) this._push({ type: 'siren', name: 'siren', stop: true });
      s.active = false; s.gain = 0;
      for (const h of s.handles) h.stop(fade);
      s.handles = [];
    },

    // ---- voices (§9.4) -----------------------------------------------------------------------------
    /**
     * Ask a unit to say a line (commando key like 'select', or a German bark key). Applies the
     * director's cooldown/priority/chance rules; if the line passes it is broadcast as a 'bark' event
     * (payload stamped with text/gloss/subtitle) so the UI can show the subtitle / talking portrait.
     * @returns {object|null} the bark payload, or null when suppressed
     */
    say(unit, key, extra = {}) {
      const req = this._voiceReq(unit, key, extra);
      const res = this.director.request(req);
      if (!res.ok) { this._push({ type: 'voice', name: req.key, speaker: req.speaker, dropped: res.reason }); return null; }
      const e = { unit, line: req.key, source: 'audio', ...extra };
      this._stamp(e, req, res);
      e._resolved = { req, res };
      if (events) events.emit('bark', e); else this._voice(e);
      return e;
    },
    _voiceReq(unit, key, extra = {}) {
      const k = lineKey(key);
      const speaker = extra.speaker || speakerOf(unit);
      const commando = speaker !== 'ger' && speaker !== 'dog' && unit?.kind !== 'enemy';
      const eng = this.engine;
      // a speaker with a recorded pack only picks lines it has a take for (subtitle = what is heard)
      const prefer = eng?.voiceSpeakers?.has(speaker) ? (line) => eng.hasVoice(speaker, line.rec) : null;
      return { speaker, speakerId: idOf(unit) ?? speaker, key: k, now: this.now(), commando, force: !!extra.force, prefer };
    },
    /** Urgent context → the more expressive "alt" take (pain, or while the alarm is up). */
    _urgent(key) { return key === 'hurt' || this.siren.active || !!this.world?.alarm?.active; },
    _stamp(e, req, res) {
      e.line = req.key;
      e.speaker = req.speaker;
      e.text = res.line.text;
      e.gloss = res.line.gloss || null;
      e.variant = res.n;
      e.subtitle = !!(this.options.subtitles && res.rule.sub);
      e.rec = res.line.rec || null; // recorded take id (talking portraits: voice/<char>/<take>/<rec>.json timing)
    },
    /** 'bark' handler: voices lines from any emitter (AI barks arrive here unresolved). */
    _bark(e) {
      if (!e || e.suppressed) return;
      let r = e._resolved;
      if (!r) {
        const req = this._voiceReq(e.unit, e.line || '', e);
        const res = this.director.request(req);
        if (!res.ok) { e.suppressed = true; e.reason = res.reason; this._push({ type: 'voice', name: req.key, speaker: req.speaker, dropped: res.reason }); return; }
        this._stamp(e, req, res);
        r = { req, res };
      }
      delete e._resolved;
      this._voice(e, r);
    },
    _voice(e, { req, res }) {
      let dur = 0.25 + 0.06 * e.text.length;
      let h = null;
      if (this.unlocked && this.engine) {
        if (res.replaces?.handle) res.replaces.handle.stop(0.08);
        if (req.speaker === 'dog') {
          h = this.playSfx('dog_bark', posOf(e.unit), { event: 'bark' });
        } else {
          // German guards: one of the recorded voices (1–3) per soldier, stable for that soldier
          const voice = req.speaker === 'ger' ? hashStr(req.speakerId) : 0;
          const urgent = this._urgent(req.key);
          const buffer = this.engine.voiceBuffer(req.speaker, req.key, res.n, e.text, { rec: res.line.rec, voice, urgent });
          e.take = res.line.rec && this.engine.hasVoice(req.speaker, res.line.rec) ? (urgent ? 'alt' : 'primary') : null;
          h = buffer ? this.engine.play(`voice:${req.key}`, { buffer, bus: 'voice', pos: req.commando ? null : posOf(e.unit), cls: 'voice' }) : null;
        }
        if (h) dur = Math.max(0.4, h.duration);
      }
      this.director.started(req, dur, res.replaces, h);
      e.duration = dur;
      this._push({ type: 'voice', name: req.key, speaker: req.speaker, text: e.text, gloss: e.gloss || undefined, replaced: res.replaces ? res.replaces.key : undefined });
    },

    // ---- frame update ------------------------------------------------------------------------------
    /** Per frame: listener over the view centre, follow loops, timers, bomb ticks, siren, sparse ambience. */
    update(cx, cz, viewWidth, yaw) {
      const L = this.listener;
      if (Number.isFinite(cx) && Number.isFinite(cz)) { L.x = cx; L.z = cz; }
      if (viewWidth > 0) L.viewWidth = viewWidth;
      if (Number.isFinite(yaw)) L.yaw = yaw;
      this.engine?.setListener(L.x, L.z, L.viewWidth, L.yaw);
      const now = this.now();
      for (const [key, rec] of this.loops) {
        const f = rec.follow;
        if (!f) continue;
        if (f.destroyed || f.alive === false || f.removed) this.stopLoop(key);
        else rec.handle?.setPos(f);
      }
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= now);
        this.timers = this.timers.filter((t) => t.at > now);
        for (const t of due) t.fn();
      }
      for (const [k, b] of this.bursts) if (now > b.until || b.handle?.ended) { b.handle?.stop(0.12); this.bursts.delete(k); }
      this._tickBombs();
      this._musicTick();
      if (this.siren.active) {
        this.siren.gain = this._sirenGain();
        if (this.siren.gain <= 0) this._sirenStop(0.5); else this._sirenSync();
      }
      // step 4w: the wind beds follow the mission WindField at the listener (lulls, gust swells), same field as the visuals
      const W = this.world?.wind;
      if (W?.sample && this.ambience.length) {
        const s = W.sample(L.x, L.z, W.t, (this._wS ||= {}));
        const k = Math.min(1.9, 0.3 + s.speed / 9 + s.gust * 0.5);
        for (const l of this.ambience) if (/^wind/.test(l.id) && l.handle?.setGain && Math.abs((l._wk ?? 1) - k) > 0.02) { l._wk = k; l.handle.setGain(l.gain * k); }
      }
      if (this.unlocked && this.gameState === 'playing') {
        for (const l of this.ambience) {
          if (!l.sparse || now < l.next) continue;
          l.next = now + l.sparse * (0.5 + rand());
          let at = null; // positional sweetener somewhere off-screen (distant dog, far shelling)
          if (l.far) { const r = l.far[0] + (l.far[1] - l.far[0]) * rand(), th = rand() * 2 * Math.PI; at = { x: this.listener.x + r * Math.cos(th), z: this.listener.z + r * Math.sin(th) }; }
          this.playSfx(l.id, at, { gain: l.gain, bus: 'ambience', dedupe: 0 });
        }
      }
    },
    /** Time-bomb tick: 2 Hz speeding to 4 Hz over the fuse (§9.3 TICTAC), mission time. */
    _tickBombs() {
      const t = this.simNow();
      for (const [k, b] of this.bombs) {
        if (b.bomb?.exploded || b.bomb?.removed || t > b.start + b.fuse + 1) { this.bombs.delete(k); continue; }
        if (t < b.next) continue;
        const f = Math.min(1, (t - b.start) / Math.max(0.1, b.fuse));
        b.next = t + 1 / (2 + 2 * f);
        this.playSfx('bomb_tick', b.bomb, { event: 'bomb:armed', dedupe: 0 });
      }
    },

    /** Snapshot for tests / the debug panel. */
    debug() {
      const d = this.director;
      return {
        unlocked: this.unlocked, muted: this.muted, volumes: { ...this.volumes }, options: { ...this.options },
        gameState: this.gameState, track: this.track, music: this.musicId || null, score: this.musicDir?.debug() || null,
        siren: { active: this.siren.active, gain: +this.siren.gain.toFixed(3), handles: this.siren.handles.length },
        loops: [...this.loops.entries()].map(([k, r]) => `${k}:${r.id}`), ambience: this.ambience.map((l) => l.id),
        voices: { commando: d.commando?.key || null, enemy: d.enemy.map((v) => v.key) },
        active: this.engine ? this.engine.active.size : 0, listener: { ...this.listener },
        streams: this.engine ? [...this.engine.active].filter((h) => h.stream).map((h) => ({ id: h.id, file: String(h.url).split('/').pop(),
          playing: !h.stream.paused, ready: h.stream.readyState ?? 0 })) : [],
        assets: this.engine?.files.size ? { ...this.engine.memory(), files: this.engine.meta.size,
          voices: [...this.engine.voiceRec.values()].reduce((n, t) => n + t.length, 0) } : null,
        buses: this.engine ? Object.fromEntries(Object.entries(this.engine.bus).map(([k, n]) => [k, n.gain.value])) : null,
      };
    },
    dispose() {
      if (this._musicTimer) clearInterval(this._musicTimer);
      this.musicDir?.dispose();
      for (const off of this._subs) off?.();
      this._subs.length = 0;
      this._offGesture?.();
      this.engine?.stopAll(() => true, 0);
      try { this.engine?.ctx.close?.(); } catch { /* ignore */ }
    },
  });
}

/** Music cue for a game/flow state (§9.1). null = keep the current request. */
function cueForState(s, a) {
  if (s === 'title' || s === 'select' || s === 'menu' || s === 'epilogue') return 'menu';
  if (s === 'briefing') {
    const n = parseInt(String(a.mission?.id || '').replace(/\D/g, ''), 10) || 0;
    return `briefing_${1 + (n % 3)}`;
  }
  return null;
}

/** Attach methods, event handlers and the first-gesture unlock. */
function wire(audio, events, subs, rand, opts) {
  addMethods(audio, events, rand);
  addVoiceSiren(audio, events, rand);
  audio._subs = subs;
  audio._events = events || null;
  if (!events) return audio;
  subs.push(...installHandlers(audio, events));
  const on = (t, fn) => subs.push(events.on(t, (e = {}) => fn(e)));
  const setState = (to) => {
    if (!to || to === audio.gameState) return;
    const was = audio.gameState;
    audio.gameState = to;
    if (to === 'paused' && was === 'playing') audio.playSfx('pause_on', null, { event: 'game:state' });
    if (to === 'playing' && was === 'paused') audio.playSfx('pause_off', null, { event: 'game:state' });
    const cue = cueForState(to, audio);
    if (cue) audio.track = cue;
    if (to === 'debrief') audio.track = null; // the debrief is silent after the end stinger
    if (to === 'won' || to === 'lost') {
      audio.track = null;
      const st = to === 'won' ? `success_${1 + Math.floor(rand() * 3)}` : `fail_${1 + Math.floor(rand() * 3)}`;
      if (audio.unlocked && audio.musicDir) audio.musicDir.endMission(st); // the end stinger is what stops the score
      else audio._push({ type: 'music', name: st, stinger: true });
    }
    if (MISSION_STATES.has(to) && !MISSION_STATES.has(was)) audio._missionMusicStart(); // also a save restored paused
    if (!audio.inMission()) {
      audio._sirenStop(0.5); audio.bombs.clear();
      for (const k of [...audio.loops.keys()]) audio.stopLoop(k, 0.5);
      for (const b of audio.bursts.values()) b.handle?.stop(0.1);
      audio.bursts.clear();
    }
    audio._refreshMusic();
    audio._refreshAmbience();
  };
  on('game:state', (e) => setState(e.to));
  on('flow:state', (e) => { if (e.to !== 'playing' && e.to !== 'paused') setState(e.to); });
  // in-mission score: alert layer on alarm / enemies in combat-search states (music-director.js HOT_STATES)
  const ekey = (u) => u?.id ?? u?.tag ?? u;
  on('alarm:start', () => audio.musicDir?.setAlarm(true));
  on('enemy:state', (e) => audio.musicDir?.setEnemyState(ekey(e.enemy), e.to));
  on('unit:killed', (e) => { if (e.unit?.kind === 'enemy') audio.musicDir?.dropEnemy(ekey(e.unit)); });
  on('mission:loaded', (e) => {
    audio.world = e.world || null;
    audio.mission = e.mission || null;
    audio._startStingerDone = false;
    if (audio.musicDir?.state === 'mission') audio.musicDir.stopMission(1.0);
    audio.musicDir?.prefetchMission(audio._startCue());
    audio.ambience.forEach((l) => l.handle?.stop(0.5));
    audio.ambience = [];
    audio.director.reset();
    audio._sirenStop(0);
    audio._refreshAmbience();
    audio._preload();
  });
  // Unlock on the first user gesture (browsers refuse to start an AudioContext before one).
  if (opts.autoUnlock !== false && typeof window !== 'undefined' && window.addEventListener) {
    const kinds = ['pointerdown', 'keydown', 'touchstart'];
    const fn = () => { if (audio.unlock()) audio._offGesture(); };
    audio._offGesture = () => kinds.forEach((k) => window.removeEventListener(k, fn, true));
    kinds.forEach((k) => window.addEventListener(k, fn, true));
  }
  return audio;
}
