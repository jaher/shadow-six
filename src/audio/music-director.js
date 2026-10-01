/**
 * MUSIC DIRECTOR — owns every sound on the music bus (design-spec §9.1, extended: in-mission suspense score).
 *
 * Outside missions: one looping bed (menu / briefing) with the loop points from assets/audio/music/manifest.json
 * `meta`, crossfaded on change; one-shot stingers. In missions (option `missionMusic`, default ON = "Suspense"):
 * start stinger → tension chain (MISSION_CHAIN, segments of 2–3 min on one 84 BPM D-minor bar grid, chained back to
 * back with no gap and never repeating a segment back-to-back) + an ALERT layer that crossfades in/out on a bar
 * line when the threat (alarm / combat / search) rises or calms. Pause keeps the score at PAUSE_GAIN; voice lines
 * and briefing speech duck it. Only the mission-end stinger stops it. The music bus never plays a synth
 * placeholder: a cue without a recorded file is silence.
 *
 * Pure helpers (nextSegment, ThreatTracker) are exported for unit tests; the class needs an AudioContext-like
 * `ctx`, the music bus node and `load(id) → Promise<{buffer, meta}|null>`.
 * @module audio/music-director
 */

/** Tension segments and bridges, in chain order (one cycle ≈ 8.1 min before any exact repeat). */
export const MISSION_CHAIN = Object.freeze(['mission_tension_a', 'mission_bridge_1', 'mission_tension_b',
  'mission_bridge_2', 'mission_tension_c', 'mission_bridge_3']);
export const ALERT_CUE = 'mission_alert';
/** Enemy brain states that count as "threat" for the alert layer. Not REINFORCE: released barracks squads stay in
 * it for the rest of the mission (enemy-brain idleState); while the alarm runs, the alarm itself already counts. */
export const HOT_STATES = Object.freeze(new Set(['COMBAT', 'SEARCH', 'ALARM_RUN', 'ARREST', 'combat', 'search']));
export const PAUSE_GAIN = 0.35;
export const DUCK_GAIN = 0.55;
/** Level of the tension chain under gameplay (≈ -7.5 dB: the cues are mastered at -22 LUFS; footsteps must sit
 * above the score). The alert layer and the stingers play at full level. */
export const TENSION_TRIM = 0.42;
export const CALM_HOLD = 8; // s of no threat before the alert layer leaves
const LOOKAHEAD = 2.0; // s: schedule the next segment this far ahead
const DEFAULT_BAR = 240 / 84;

/**
 * Next cue after `cur` in the chain, skipping cues that are not available; never `cur` itself unless it is the
 * only one available (then it loops). null when nothing is available.
 */
export function nextSegment(cur, available = () => true, chain = MISSION_CHAIN) {
  const i = chain.indexOf(cur);
  for (let k = 1; k <= chain.length; k++) {
    const id = chain[(Math.max(i, -1) + k + chain.length) % chain.length];
    if (id !== cur && available(id)) return id;
  }
  return cur && available(cur) ? cur : null;
}

/** Threat level from the alarm + per-enemy hot states, with a calm hold so the alert layer does not flap. */
export class ThreatTracker {
  constructor() { this.alarm = false; this.hot = new Set(); this.calmSince = null; this.active = false; }
  setAlarm(on, now) { this.alarm = !!on; return this.update(now); }
  setEnemy(key, state, now) { if (HOT_STATES.has(state)) this.hot.add(key); else this.hot.delete(key); return this.update(now); }
  drop(key, now) { this.hot.delete(key); return this.update(now); }
  reset() { this.alarm = false; this.hot.clear(); this.calmSince = null; this.active = false; }
  /** @returns {boolean} whether the alert layer should be playing */
  update(now) {
    const raw = this.alarm || this.hot.size > 0;
    if (raw) { this.active = true; this.calmSince = null; } else if (this.active) {
      if (this.calmSince == null) this.calmSince = now;
      if (now - this.calmSince >= CALM_HOLD) { this.active = false; this.calmSince = null; }
    }
    return this.active;
  }
}

function setG(param, v, t, dur) {
  if (param.cancelScheduledValues && param.linearRampToValueAtTime) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(v, t + Math.max(0.01, dur));
  } else param.value = v;
}
/** Ramp that starts at a future time `t` (bar line) and holds the current value until then. */
function rampAt(param, v, t, dur, now) {
  if (param.cancelScheduledValues && param.linearRampToValueAtTime) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setValueAtTime(param.value, Math.max(now, t));
    param.linearRampToValueAtTime(v, Math.max(now, t) + Math.max(0.01, dur));
  } else param.value = v;
}

export class MusicDirector {
  /**
   * @param {{ctx: AudioContext, out: AudioNode, load: (id:string)=>Promise<{buffer:AudioBuffer, meta:object}|null>,
   *   has: (id:string)=>boolean, log?: (e:object)=>void}} o
   */
  constructor(o) {
    this.ctx = o.ctx; this.load = o.load; this.has = o.has || (() => true); this.log = o.log || (() => {});
    const g = () => { const n = this.ctx.createGain(); n.gain.value = 1; return n; };
    this.master = g(); this.master.connect(o.out);
    this.duckNode = g(); this.duckNode.connect(this.master);
    this.bedBus = g(); this.bedBus.connect(this.duckNode);
    this.tensionTrim = g(); this.tensionTrim.gain.value = TENSION_TRIM; this.tensionTrim.connect(this.duckNode);
    this.tensionBus = g(); this.tensionBus.connect(this.tensionTrim);
    this.alertBus = g(); this.alertBus.gain.value = 0; this.alertBus.connect(this.duckNode);
    this.state = 'idle'; // idle | bed | mission | ended
    this.bed = null; // {id, h}
    this.seg = null; // {id, h, bodyAt, endAt}
    this.next = null; // {id, h, at} scheduled
    this.alert = null; // {h, on}
    this.grid = null; // {origin, bar}
    this.threat = new ThreatTracker();
    this.paused = false; this.ducked = false;
    this.history = []; // segment ids in play order (tests/debug)
    this.handles = new Set();
    this.gen = 0; // bumps on every mission start/stop (drops stale async loads)
  }

  get now() { return this.ctx.currentTime || 0; }

  /** Start a buffer on `bus` at time `at` (offset s); loop with the manifest loop points when asked. */
  _src(res, bus, at, { offset = 0, loop = false, gain = 1 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = res.buffer;
    if (loop) {
      src.loop = true;
      const m = res.meta || {};
      if (m.loopEnd > m.loopStart) { src.loopStart = m.loopStart; src.loopEnd = m.loopEnd; }
    }
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(bus);
    const h = { src, g, id: res.id, ended: false, at };
    src.onended = () => { h.ended = true; this.handles.delete(h); try { g.disconnect(); } catch { /* ignore */ } };
    try { src.start(Math.max(this.now, at), Math.max(0, offset)); } catch { /* ignore */ }
    this.handles.add(h);
    return h;
  }
  _stop(h, fade = 0.5, at = this.now) {
    if (!h || h.ended) return;
    h.ended = true;
    rampAt(h.g.gain, 0, at, fade, this.now);
    try { h.src.stop(Math.max(this.now, at) + fade + 0.05); } catch { /* ignore */ }
  }

  // ---- loading (own cache: music buffers are not part of the per-mission SFX eviction) -----------------------
  /** Kick (or reuse) the load of a cue. Resolves {id, buffer, meta} or null (no recorded file → silence). */
  fetch(id) {
    if (!id || !this.has(id)) return Promise.resolve(null);
    if (!this.cache) { this.cache = new Map(); this.ready = new Map(); }
    let p = this.cache.get(id);
    if (!p) {
      p = Promise.resolve(this.load(id)).then((r) => {
        const res = r?.buffer ? { id, buffer: r.buffer, meta: r.meta || {} } : null;
        if (res && this.cache.get(id) === p) this.ready.set(id, res);
        return res;
      }).catch(() => null);
      this.cache.set(id, p);
    }
    return p;
  }
  isReady(id) { return !!this.ready?.get(id); }
  /** Drop cached cues matching `fn` (decoded PCM is the memory cost: beds in missions, the score in menus). */
  _drop(fn) {
    if (!this.cache) return;
    for (const id of [...this.cache.keys()]) if (fn(id)) { this.cache.delete(id); this.ready.delete(id); }
  }
  /** Drop decoded mission cues except `keep` (memory: ≤ current + next segment + alert + stingers). */
  _evict(keep) {
    if (!this.cache) return;
    for (const id of [...this.cache.keys()]) {
      if (keep.has(id) || !MISSION_CHAIN.includes(id)) continue;
      this.cache.delete(id); this.ready.delete(id);
    }
  }

  // ---- beds & stingers ----------------------------------------------------------------------------------------
  /** Looping bed outside missions (menu / briefing); null stops it. */
  playBed(id) {
    if (this.bed?.id === id && (this.bed.h || this.bed.pending)) return;
    if (this.bed?.h) this._stop(this.bed.h, 1.5);
    this.bed = id ? { id, h: null, pending: true } : null;
    if (!id) return;
    this._drop((k) => k !== id && !MISSION_CHAIN.includes(k) && k !== ALERT_CUE && !/^(start|success|fail)_/.test(k)); // other beds
    this.log({ type: 'music', name: id, bed: true });
    const rec = this.bed;
    this.fetch(id).then((res) => {
      if (this.bed !== rec) return;
      rec.pending = false;
      if (!res) return;
      rec.h = this._src(res, this.bedBus, this.now + 0.02, { loop: true, gain: 0 });
      setG(rec.h.g.gain, 1, this.now, 1.0);
    });
  }
  /** One-shot stinger. Resolves its handle (null when the cue has no recorded file). */
  stinger(id, at = null) {
    this.log({ type: 'music', name: id, stinger: true });
    const g = this.gen;
    return this.fetch(id).then((res) => (res && g === this.gen ? this._src(res, this.duckNode, at ?? this.now + 0.02) : null));
  }

  // ---- mission score ------------------------------------------------------------------------------------------
  /** Preload what a mission start needs (call at mission load / briefing). */
  prefetchMission(startCue) {
    for (const id of [startCue, MISSION_CHAIN[0], nextSegment(MISSION_CHAIN[0], this.has), ALERT_CUE]) this.fetch(id);
  }
  /** Start stinger → tension chain (no gap: the chain starts at the stinger's `endSec`). */
  startMission({ stinger = null } = {}) {
    this.stopMission(1.5, false);
    if (this.bed?.h) this._stop(this.bed.h, 1.5);
    this.bed = null;
    const g = ++this.gen;
    this.state = 'mission'; this.history = []; this.threat.reset();
    this._drop((k) => !MISSION_CHAIN.includes(k) && k !== ALERT_CUE && !/^(start|success|fail)_/.test(k)); // beds
    const first = nextSegment(null, this.has);
    const t0 = this.now + 0.05;
    if (stinger) this.log({ type: 'music', name: stinger, stinger: true });
    const st = stinger && this.has(stinger) ? this.fetch(stinger) : Promise.resolve(null);
    this.prefetchMission(stinger);
    st.then((s) => {
      if (g !== this.gen) return;
      let at = this.now + 0.02;
      if (s) {
        this._src(s, this.duckNode, at);
        at += s.meta.endSec ?? Math.max(0, s.buffer.duration - (s.meta.tailSec ?? 0));
      }
      this.pendingStart = { at: Math.max(at, t0), id: first };
      return this.fetch(first).then((res) => {
        if (g !== this.gen || !res) return;
        this._startSeg(res, Math.max(this.pendingStart.at, this.now + 0.02), 0);
        this.pendingStart = null;
      });
    });
  }
  _startSeg(res, at, offset) {
    const m = res.meta;
    const bodyStart = m.loopStart ?? 0;
    const bodyEnd = m.loopEnd ?? Math.max(bodyStart + 1, res.buffer.duration - (m.tailSec ?? 0));
    const h = this._src(res, this.tensionBus, at, { offset });
    const bodyAt = at + Math.max(0, bodyStart - offset);
    if (!this.grid) this.grid = { origin: bodyAt, bar: m.barSec || (m.bpm ? 240 / m.bpm : DEFAULT_BAR) };
    this.seg = { id: res.id, h, at, endAt: at + (bodyEnd - Math.max(offset, bodyStart)) + Math.max(0, bodyStart - offset) };
    this.history.push(res.id);
    if (this.history.length > 64) this.history.shift();
    this.log({ type: 'music', name: res.id, segment: true });
    const nid = nextSegment(res.id, this.has);
    this.fetch(nid);
    this._evict(new Set([res.id, nid]));
  }
  /** Next bar line at or after t on the mission grid. */
  nextBar(t) {
    if (!this.grid) return t;
    const { origin, bar } = this.grid;
    return t <= origin ? origin : origin + Math.ceil((t - origin) / bar - 1e-6) * bar;
  }

  /** Per-frame: chain the next segment ahead of time, follow the threat with the alert layer. */
  update() {
    if (this.state !== 'mission') return;
    const now = this.now;
    const s = this.seg;
    if (s && now >= s.endAt - LOOKAHEAD) {
      let nid = nextSegment(s.id, this.has);
      if (!this.isReady(nid)) {
        this.fetch(nid);
        if (now < s.endAt - 0.25) nid = null; // still time to wait for it
        else nid = this.isReady(s.id) ? s.id : null; // too late: repeat this one rather than leave a gap
      }
      if (nid) {
        const res = this.ready.get(nid);
        // on time: start exactly at the previous body end (gapless). Late (main thread stalled / timers throttled
        // past LOOKAHEAD): re-base on the next bar line from the top of the body, so endAt stays in the future and
        // segments never overlap or fall off the bar grid.
        const at = s.endAt >= now + 0.02 ? s.endAt : this.nextBar(now + 0.05);
        this._startSeg(res, at, res.meta.loopStart ?? 0);
      }
    }
    const want = this.threat.update(now);
    if (want !== !!this.alert?.on) this._setAlert(want);
    if (this.alert && !this.alert.on && this.alert.h && now > this.alert.offEnd) { this._stop(this.alert.h, 0.05); this.alert = null; }
  }
  _setAlert(on) {
    const now = this.now;
    const bar = this.grid?.bar || DEFAULT_BAR;
    const tb = this.nextBar(now + 0.05);
    if (on) {
      if (!this.isReady(ALERT_CUE)) { this.fetch(ALERT_CUE); return; } // retried next frame
      if (!this.alert?.h || this.alert.h.ended) {
        this.alert = { on: true, h: this._src(this.ready.get(ALERT_CUE), this.alertBus, tb, { loop: true }) };
      } else this.alert.on = true; // still fading out: bring it back
      rampAt(this.alertBus.gain, 1, tb, 0.08, now);
      rampAt(this.tensionBus.gain, 0, tb, bar, now);
      this.log({ type: 'music', name: ALERT_CUE, alert: true, at: +tb.toFixed(3) });
    } else if (this.alert) {
      this.alert.on = false;
      this.alert.offEnd = tb + 2 * bar + 0.1;
      rampAt(this.alertBus.gain, 0, tb, 2 * bar, now);
      rampAt(this.tensionBus.gain, 1, tb, 2 * bar, now);
      this.log({ type: 'music', name: ALERT_CUE, alert: false, at: +tb.toFixed(3) });
    }
  }
  setAlarm(on) { this.threat.setAlarm(on, this.now); }
  setEnemyState(key, state) { this.threat.setEnemy(key, state, this.now); }
  dropEnemy(key) { this.threat.drop(key, this.now); }

  setPaused(b) { if (this.paused === !!b) return; this.paused = !!b; setG(this.master.gain, b ? PAUSE_GAIN : 1, this.now, 0.4); }
  setDuck(b) { if (this.ducked === !!b) return; this.ducked = !!b; setG(this.duckNode.gain, b ? DUCK_GAIN : 1, this.now, b ? 0.25 : 0.8); }

  /** Stop the mission score (fade) — `bump` drops pending async starts. */
  stopMission(fade = 1.2, bump = true) {
    if (bump) this.gen++;
    for (const h of [...this.handles]) if (h !== this.bed?.h) this._stop(h, fade);
    this.seg = null; this.alert = null; this.grid = null; this.pendingStart = null;
    this.threat.reset();
    const now = this.now;
    setG(this.alertBus.gain, 0, now + fade, 0.05); setG(this.tensionBus.gain, 1, now + fade + 0.1, 0.05);
    if (this.state === 'mission') this.state = 'idle';
  }
  /** Mission end: the score fades under the success / fail stinger (the only thing that stops it). */
  endMission(stingerId) {
    const was = this.state === 'mission';
    this.stopMission(was ? 1.0 : 0.3);
    this.state = 'ended';
    this._drop((k) => MISSION_CHAIN.includes(k) || k === ALERT_CUE); // the score is over (re-prefetched at the next mission load)
    return stingerId ? this.stinger(stingerId, this.now + (was ? 0.25 : 0.02)) : Promise.resolve(null);
  }

  debug() {
    const now = this.now;
    return {
      state: this.state, bed: this.bed?.id || null, segment: this.currentSegment(), history: [...this.history],
      alert: !!this.alert?.on, threat: { alarm: this.threat.alarm, hot: this.threat.hot.size, active: this.threat.active },
      paused: this.paused, ducked: this.ducked, nextAt: this.seg ? +(this.seg.endAt - now).toFixed(2) : null,
      gains: { master: this.master.gain.value, tension: this.tensionBus.gain.value, alert: this.alertBus.gain.value },
      cached: this.cache ? [...this.ready.keys()] : [], playing: [...this.handles].filter((h) => !h.ended).map((h) => h.id),
    };
  }
  /** Segment audible now (the latest one whose start time has passed). */
  currentSegment() {
    if (!this.seg) return this.pendingStart ? null : null;
    return this.seg.at <= this.now + 1e-3 ? this.seg.id : this.history[this.history.length - 2] ?? this.seg.id;
  }
  dispose() { this.stopMission(0); if (this.bed?.h) this._stop(this.bed.h, 0); this.bed = null; }
}
