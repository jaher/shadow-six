/**
 * The soundtrack PLAN of a mission film (tools/solutions/mix-video.mjs renders it): what plays when, worked out from the
 * capture's timeline (tools/solutions/capture-video.mjs: the frames, the events, the cue sheet the game's own audio
 * handlers wrote, the mission's ambience layers) and the game's own audio tables, so every mission gets its own sound:
 *   - music: the mission's start stinger (src/audio/music-cues.js startCueFor), then the tension chain exactly as the
 *     game's MusicDirector chains it (each segment starts at the previous one's body end, from its own loop start; the
 *     alert layer crossfades in on a bar line while the game's ThreatTracker says enemies are in combat / searching or
 *     the alarm runs, and out again after the calm hold), the success cue at the win;
 *   - ambience: the theatre's beds from `ambienceFor(def)` (snow / fjord wind, desert wind, surf, birds, crickets, town,
 *     the M2 / M3 / M19 rivers), positional layers (M3's waterfall) following the camera and ending when their structure
 *     goes;
 *   - effects: every sound the run made, with the game's gains and distance model (`spatialize` from the view centre).
 * Pure: no files, no ffmpeg; the world is handed in as `env` (the game's tables + a file resolver) so it is unit-tested.
 * All times are VIDEO seconds unless a name says `game`.
 */

/** Film levels (relative; the final mix is loudness-limited and normalised). The score as the M3 film had it; effects ≈ 1.2× the game's own gains. */
export const LEVEL = Object.freeze({
  stinger: 0.9, tension: 0.8, alert: 0.6, success: 0.9,
  sfx: 1.2, loop: 1.2, siren: 0.4, tick: 1.2,
  amb: 3.1, // game ambience gain → film (the film's score sits ~10 dB over the game's: 0.0716 wind → 0.22, as the M3 film had it)
  ambCapLufs: -30, // no bed louder than this (the score is ≈ −24): the river's 0.34 would sit 10 dB OVER the score
});
/** Loudness (LUFS) of the ambience beds as shipped (measured with ebur128), by sfx category: the cap turns into a volume. */
export const BED_LUFS = Object.freeze({ wind_cold: -24, wind_air: -24, wind_sand: -24, river: -14.5, surf: -20.5, birds: -23.4, crickets: -20.1, artillery_period: -24.4 });
/** Ids whose recorded take is a better trap / hit than the game's synth placeholder: layered (each plays). */
export const LAYERS = Object.freeze({ trap_snap: ['k_metal_latch', 'k_hit_flesh'], flood_rush: ['river'] });
/** High-rate foley: heard in the real-time stretches only (at 4–16× a footstep per frame is a rattle). */
export const FOLEY = /^(step_|crawl_rustle|body_drag|fish_|eider_|mallard_|duck_|wind_gust|flag_clank)/; // (and the ducks and fish of the ambience: a call every 1.5 s at 16× is not nature)
export const FOLEY_MAX_SPEED = 2.5;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const db = (v) => 10 ** (v / 20);

/** Game time → video time over the frames of a capture (the solution's frames only; the opening and the cards are not game time). */
export function timeMap(T) {
  const frames = T.frames, fps = T.fps, V = frames.length / fps;
  const play = [];
  for (let i = 0; i < frames.length; i++) if (!frames[i].card) play.push(i);
  const firstPlay = play.length ? play[0] : 0, lastPlay = play.length ? play[play.length - 1] : frames.length - 1;
  const ei = frames.findIndex((f) => f.card === 'end');
  /** index of the first play frame at or after game time t */
  const frameIndex = (t) => {
    let lo = 0, hi = play.length - 1;
    if (hi < 0) return 0;
    while (lo < hi) { const m = (lo + hi) >> 1; if (frames[play[m]].t >= t - 1e-3) hi = m; else lo = m + 1; }
    return play[lo];
  };
  return {
    V, fps, firstPlay, lastPlay, endCardAt: ei >= 0 ? ei / fps : null, openEnd: firstPlay / fps,
    frameIndex, vt: (t) => frameIndex(t) / fps, frame: (t) => frames[frameIndex(t)],
  };
}

/** Intervals of GAME time in which the game's ThreatTracker says the alert layer plays, from the capture's threat log. */
export function threatIntervals(threat, ThreatTracker, calmHold, tEnd) {
  const tr = new ThreatTracker(), out = [];
  let on = null;
  const sync = (t) => { if (tr.active && on == null) on = t; else if (!tr.active && on != null) { out.push([on, t]); on = null; } };
  const settle = (until) => { // the calm hold runs out before `until`
    if (tr.active && tr.calmSince != null && tr.calmSince + calmHold <= until) { const t = tr.calmSince + calmHold; tr.update(t); sync(t); }
  };
  for (const e of [...(threat || [])].sort((a, b) => a.t - b.t)) {
    settle(e.t);
    if (e.alarm != null) tr.setAlarm(!!e.alarm, e.t);
    else if (e.drop) tr.drop(e.k, e.t);
    else tr.setEnemy(e.k, e.to, e.t);
    sync(e.t);
  }
  settle(Infinity);
  if (on != null) out.push([on, tEnd]);
  return out;
}

/** Music: stinger, chain, alert layer, success cue; `tension` is the automation of the chain's gain (the alert takes over). */
export function planMusic(T, env, tm) {
  const m = T.mission || {}, ev = T.pass2?.events || [];
  const has = (c) => !!env.music(c);
  const startCue = has(m.startCue) ? m.startCue : 'start_6';
  const st = env.music(startCue);
  const end = ev.find((e) => e.kind === 'end');
  const won = !end || end.state === 'won';
  const musicEnd = clamp(end ? tm.vt(end.t) : (tm.endCardAt ?? tm.V - 6), 5, tm.V);
  const out = { startCue, stinger: null, chain: [], alert: [], success: null, musicEnd, tension: [[0, 1]], bar: 240 / 84 };
  const at0 = 0.25;
  if (st) out.stinger = { cue: startCue, at: at0, vol: LEVEL.stinger };
  // the chain (music-director startMission / update): the first segment from its start once the stinger's endSec is reached,
  // every next one at the previous body end from its own loop start, never repeating the one before
  let at = at0 + (st ? (st.endSec ?? Math.max(0, st.lengthSec - (st.tailSec ?? 0))) : 0), offset = 0;
  let cur = env.nextSegment(null, has);
  while (cur && at < musicEnd) {
    const mt = env.music(cur), bodyStart = mt.loopStart ?? 0, bodyEnd = mt.loopEnd ?? Math.max(bodyStart + 1, mt.lengthSec - (mt.tailSec ?? 0));
    out.chain.push({ cue: cur, at, offset, vol: LEVEL.tension });
    if (out.chain.length === 1) { out.bar = mt.barSec || 240 / (mt.bpm || 84); out.grid = at + Math.max(0, bodyStart - offset); }
    at += (bodyEnd - Math.max(offset, bodyStart)) + Math.max(0, bodyStart - offset);
    cur = env.nextSegment(cur, has);
    offset = cur ? env.music(cur).loopStart ?? 0 : 0;
  }
  // the alert layer: the game's own threat rule over game time, in video time, with a minimum so a two-second brawl at 8× is not a flicker
  const nextBar = (t) => (out.grid == null || t <= out.grid ? t : out.grid + Math.ceil((t - out.grid) / out.bar - 1e-6) * out.bar);
  const gEnd = ev.find((e) => e.kind === 'end')?.t ?? Infinity;
  let iv = threatIntervals(T.audio?.threat, env.ThreatTracker, env.CALM_HOLD, gEnd).map(([a, b]) => [tm.vt(a), tm.vt(b)]);
  iv = iv.map(([a, b]) => [a, Math.max(b, a + 9)]).filter(([a]) => a < musicEnd - 3);
  const merged = [];
  for (const [a, b] of iv) { if (merged.length && a - merged[merged.length - 1][1] < 6) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b); else merged.push([a, b]); }
  for (const [a, b] of merged) {
    const on = nextBar(Math.max(a, out.chain[0]?.at ?? 0)), off = nextBar(Math.min(b, musicEnd));
    if (off - on < out.bar * 2) continue;
    out.alert.push({ on, off, vol: LEVEL.alert });
    // alertBus 0 → 1 at the bar line; tensionBus 1 → 0 over a bar, back over two bars when it calms (music-director _setAlert)
    out.tension.push([on, 1], [on + out.bar, 0], [off, 0], [off + 2 * out.bar, 1]);
  }
  // the end (music-director endMission): everything fades over a second under the success / fail cue, a quarter second later
  const n = m.n || 1, cue = `${won ? 'success' : 'fail'}_${1 + (n % 3)}`;
  if (has(cue)) out.success = { cue, at: musicEnd + 0.25, vol: LEVEL.success };
  return out;
}

/** The volume cap (linear) of an ambience bed by its file's loudness. */
export function bedCap(category) { return db(LEVEL.ambCapLufs - (BED_LUFS[category] ?? -20)); }

/** Ambience: looped beds, positional layers (envelopes), sparse one-shots; layers sharing a recording share its cap. */
export function planAmbience(T, env, tm) {
  const m = T.mission || {}, cues = T.audio?.cues || [];
  const beds = [], shots = [];
  const yaw = m.yaw ?? 0.26, V = tm.V;
  let seed = 0x2f6e2b1; // (a small deterministic RNG for the sparse layers)
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const groups = new Map(); // category → [bed]
  const STEP = 0.5; // s between samples of a positional layer's envelope
  for (const [id, gain, o = {}] of m.ambience || []) {
    if ((o.day && m.night) || (o.night && !m.night)) continue;
    const def = env.SFX[id];
    const s = env.source(id);
    if (!def || !s) continue;
    const src = Array.isArray(s) ? s[0] : s;
    if (o.sparse) { // a faint positional one-shot somewhere off screen now and then (a distant dog)
      for (let t = tm.openEnd + o.sparse * rnd(); t < V - 4; t += o.sparse * (0.5 + rnd())) {
        const r = o.far ? o.far[0] + (o.far[1] - o.far[0]) * rnd() : 0, th = rnd() * 2 * Math.PI;
        const fr = T.frames[Math.min(T.frames.length - 1, Math.round(t * T.fps))];
        const sp = o.far ? env.spatialize({ x: (fr.cx ?? 0) + r * Math.cos(th), z: (fr.cz ?? 0) + r * Math.sin(th) }, fr.cx ?? 0, fr.cz ?? 0, fr.vw || 40, undefined, def.cls, yaw) : { gain: 1, pan: 0, cull: false };
        if (!sp.cull) shots.push({ id, src: src.src, at: t, vol: clamp(gain * sp.gain * LEVEL.amb, 0, 1), pan: sp.pan });
      }
      continue;
    }
    const cat = src.category || id;
    const cap = bedCap(cat);
    const bed = { id, src: src.src, category: cat, at: 0, until: V, loop: true, rate: o.rate || 1, fadeIn: 3, fadeOut: 3, cap, env: null, vol: Math.min(gain * LEVEL.amb, cap) };
    if (o.at) { // positional: loudness follows the view centre's distance to it; ends with its structure
      const gone = o.until ? cues.find((c) => c.destroyed === o.until) : null;
      if (gone) { bed.until = Math.min(V, tm.vt(gone.t) + 2.5); bed.fadeOut = 2.5; }
      bed.env = [];
      for (let t = 0; t <= bed.until + STEP; t += STEP) {
        const fr = T.frames[Math.min(T.frames.length - 1, Math.round(t * T.fps))];
        const sp = fr.cx == null ? { gain: 0.5, cull: false } : env.spatialize(o.at, fr.cx, fr.cz, fr.vw || 40, undefined, def.cls, yaw);
        bed.env.push([t, sp.cull ? 0 : sp.gain * gain * LEVEL.amb]);
      }
      bed.vol = 1;
    }
    beds.push(bed);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(bed);
  }
  // layers of one recording share its cap: scale each by cap / sqrt(Σ level²) when they add up over it
  for (const [, list] of groups) {
    const cap = list[0].cap;
    for (const b of list) b.env ||= [[0, b.vol], [V, b.vol]];
    for (const b of list) b.vol = 1;
    const times = [...new Set(list.flatMap((b) => [...b.env.map((p) => p[0]), b.until]))].sort((a, b) => a - b);
    const lvl = (b, t) => { const e = b.env; let i = 0; while (i < e.length - 2 && e[i + 1][0] <= t) i++; const [t0, g0] = e[i], [t1, g1] = e[Math.min(i + 1, e.length - 1)]; return t1 > t0 ? g0 + (g1 - g0) * clamp((t - t0) / (t1 - t0), 0, 1) : g0; };
    const f = new Map(times.map((t) => [t, Math.min(1, cap / Math.max(1e-9, Math.sqrt(list.reduce((a, b) => a + (t >= b.at && t <= b.until ? lvl(b, t) ** 2 : 0), 0))))]));
    for (const b of list) b.env = times.filter((t) => t >= b.at && t <= b.until).map((t) => [t, Math.min(lvl(b, t) * f.get(t), cap)]);
  }
  return { beds, shots };
}

/** Effects: one-shots, loops, bomb ticks and the siren, from the cue sheet with the game's gains and distance model. */
export function planEffects(T, env, tm) {
  const cues = T.audio?.cues || [], yaw = T.mission?.yaw ?? 0.26;
  const shots = [], loopPairs = [], sirenPairs = [];
  const seen = new Map(), dens = new Map(), twins = new Map();
  const open = new Map();
  const pos = (c) => (Number.isFinite(c.x) && Number.isFinite(c.z) ? { x: c.x, z: c.z } : null);
  const spat = (c, def, fr, id = c.id) => {
    const p = pos(c);
    if (!p || fr.cx == null) return { gain: 1, pan: 0, cull: false, d: 0 };
    return env.spatialize(p, fr.cx, fr.cz, fr.vw || 40, undefined, def.cls, yaw);
  };
  const layers = (id) => { const s = env.source(id); return !s ? [] : Array.isArray(s) ? s : [s]; };
  for (const c of cues) {
    if (c.destroyed != null) continue;
    if (c.siren != null) { // the alarm's siren: 0.75 fading to nothing over 25 s of game time (the game's own envelope)
      if (c.siren) open.set('siren', c); else if (open.has('siren')) { sirenPairs.push([open.get('siren'), c.t]); open.delete('siren'); }
      continue;
    }
    if (c.loop != null) {
      if (c.on === 1) open.set(c.loop, c);
      else if (c.on === 0 && open.has(c.loop)) { loopPairs.push([open.get(c.loop), c.t]); open.delete(c.loop); }
      continue;
    }
    const def = env.SFX[c.id];
    const fi = tm.frameIndex(c.t), fr = T.frames[fi], at = fi / tm.fps;
    if (!def || fr.card) continue;
    if (FOLEY.test(c.id) && fr.speed > FOLEY_MAX_SPEED) continue; // (a rattle at 16×)
    const p = pos(c), dk = `${c.id}|${p ? `${Math.round(p.x)},${Math.round(p.z)}` : '-'}`;
    if (at - (seen.get(dk) ?? -1e9) < 0.08) continue; // (audio.js: the same sound at the same spot within 80 ms is one)
    seen.set(dk, at);
    const dl = (dens.get(c.id) || []).filter((t) => at - t < 0.5);
    if (dl.length >= 3) continue; // (at most three of a kind per half second of film)
    dl.push(at); dens.set(c.id, dl);
    let sp = spat(c, def, fr), id = c.id;
    if (sp.cull) continue;
    if (def.far && sp.d > 160 && env.source(def.far)) id = def.far; // (a far blast is the distant recording)
    for (const s of layers(id)) {
      const vol = clamp((env.SFX[id]?.gain ?? def.gain) * (c.g ?? 1) * sp.gain * LEVEL.sfx, 0, 1);
      // the same recording twice within 120 ms (a blast that is an explosion, a collapse and a bomb at once) would add up to a
      // coherent +6 dB: one sound, the louder of them
      const twin = twins.get(s.src);
      if (twin && at - twin.at < 0.12) { twin.vol = Math.max(twin.vol, vol); continue; }
      const shot = { id, src: s.src, at, vol, pan: sp.pan, rate: c.rate || 1 };
      twins.set(s.src, shot);
      shots.push(shot);
    }
  }
  const endV = tm.V - 3;
  for (const c of open.values()) (c.siren != null ? sirenPairs : loopPairs).push([c, Infinity]); // (loops still open at the end run to it)
  const out = { shots, loops: [], sirens: [], ticks: [] };
  for (const [c, t1] of loopPairs) {
    const def = env.SFX[c.id], a = tm.vt(c.t), b = Number.isFinite(t1) ? tm.vt(t1) : endV;
    if (!def || b - a < 0.2) continue;
    if (c.id === 'bomb_tick') { // 2 Hz speeding to 4 Hz over the fuse (audio.js _tickBombs), in film time
      const fuse = Math.max(0.1, Math.min(c.fuse ?? 10, b - a)), fr = T.frames[tm.frameIndex(c.t)];
      const sp = spat(c, def, fr);
      const s = layers('bomb_tick')[0];
      if (!s || sp.cull) continue;
      for (let t = a; t < b; t += 1 / (2 + 2 * Math.min(1, (t - a) / fuse))) out.ticks.push({ id: 'bomb_tick', src: s.src, at: t, vol: clamp(def.gain * sp.gain * LEVEL.tick, 0, 1), pan: sp.pan });
      continue;
    }
    const id = c.id, s = layers(id)[0];
    if (!s) continue;
    const burst = String(c.loop).startsWith('burst:');
    out.loops.push({ id, src: s.src, at: a, until: burst ? b + 0.1 : b, vol: clamp(def.gain * (c.g ?? 1) * (burst ? LEVEL.sfx : LEVEL.loop), 0, 1), rate: c.rate || 1, fadeIn: burst ? 0.05 : 0.6, fadeOut: burst ? 0.12 : 0.8, randomOffset: burst });
  }
  for (const [c, t1] of sirenPairs) {
    const s = layers('siren')[0];
    if (!s) continue;
    const a = tm.vt(c.t), b = tm.vt(Math.min(Number.isFinite(t1) ? t1 : Infinity, c.t + 25));
    if (b - a >= 1) out.sirens.push({ id: 'siren', src: s.src, at: a, until: b, vol: LEVEL.siren, fadeOut: 1.5, decay: true });
  }
  return out;
}

/** The whole plan. `env`: SFX, spatialize, music(cue), nextSegment, ThreatTracker, CALM_HOLD, source(id). */
export function planSoundtrack(T, env) {
  const tm = timeMap(T);
  const music = planMusic(T, env, tm), amb = planAmbience(T, env, tm), fx = planEffects(T, env, tm);
  return { V: tm.V, fps: tm.fps, openEnd: tm.openEnd, music, beds: amb.beds, shots: [...fx.shots, ...amb.shots], loops: fx.loops, ticks: fx.ticks, sirens: fx.sirens };
}
