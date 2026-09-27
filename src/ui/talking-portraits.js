/**
 * Talking portraits (docs/talking-portraits.md, design-spec §6.3): pre-rendered neural clips (JoyVASA + LivePortrait)
 * of the six commandos, played in the HUD in sync with the audio engine's recorded voice lines.
 *
 *   const tp = new TalkingPortraits({ events, hud, audio, base: 'assets/portraits/' });   // HUD.onMissionLoaded
 *   await tp.load(world.commandos);         // manifest + preload clips as blobs (one idle + ≤ 11 short clips per man)
 *   tp.setTheme(themeFor(missionDef));      // 'desert' | 'night' | 'snow' | 'europe' | null  (grade/tint)
 *   ...  tp.dispose();                      // HUD.onMissionLoaded of the next mission / HUD.dispose
 *
 * Events consumed: 'unit:selected' (idle loop comes alive on the first selected man; the others show a greyscale
 * still, character-bible [HUD] rule), 'bark' (any commando line; the audio system stamps `rec` = recorded take id
 * and `take` = 'primary' | 'alt' in its own synchronous handler, read here in a microtask), 'unit:killed'; and in
 * own-voice mode (no audio system) 'unit:selected'/'unit:order' directly.
 * Clip choice: the exact rendered clip of the take being heard (`rec` + `take`, else a text match) seeked to its
 * `lead` so the mouth matches the voice that is starting now; otherwise the character's generic talk loop for the
 * line's duration (only when a voice is actually audible), then back to idle.
 * Graceful fallback: no manifest / codec / autoplay failure -> no video is attached and the HUD shows the photo
 * still (poster frame) — or the procedural stub when even the stills are missing — with its placeholder mouth.
 * DOM <video> elements (muted playsinline) are composited by the browser, so the clips never pass through the
 * renderer's tone mapping and cost the WebGPU frame nothing; see `videoTexture()` for 3D use.
 * @module ui/talking-portraits
 */

import { registerPortraitPhoto, getPortraitURL } from '../art/portraits.js';

/** game role id -> clip character id */
export const ROLE_TO_CHAR = Object.freeze({ greenberet: 'green_beret', sniper: 'sniper', diver: 'marine', marine: 'marine', sapper: 'sapper', driver: 'driver', spy: 'spy' });
/** game voice key -> rendered generic lines usable for it (own-voice mode, and the fallback when text does not match) */
export const KEY_LINES = Object.freeze({
  select: ['yes_sir', 'ready', 'what_now'], ack_move: ['on_my_way', 'right_away', 'understood'],
  ack_act: ['consider_it_done', 'right_away'], act_kill: ['consider_it_done'], hurt: ['i_m_hit'],
});
/** Own-voice anti-spam (s): the same man re-selected inside `select` stays quiet, other lines 0.6 s apart. */
export const OWN_VOICE_CD = Object.freeze({ select: 3, other: 0.6 });
/**
 * Round-robin through a key's rendered lines, starting at the first ('yes_sir' for a selection): never the same
 * line twice in a row while there is more than one.  @returns {string|null}
 */
export function nextLine(names, prev) {
  if (!names?.length) return null;
  const i = names.indexOf(prev);
  return names[i < 0 ? 0 : (i + 1) % names.length];
}
const WHO = Symbol('last speaker');
/** a seek lands a decode later: aim this far past the audio clock so the first frames after it are on time (s) */
const SEEK_AHEAD = 0.01;
/**
 * Cooldown gate for own-voice lines (`last`: Map unit -> {t, key}): a different man always speaks; re-selecting
 * the man who spoke last waits OWN_VOICE_CD.select, any other line OWN_VOICE_CD.other.  Records the line when it passes.
 */
export function ownVoiceGate(last, unit, key, now) {
  const p = last.get(unit);
  const cd = p?.key === key && last.get(WHO) === unit ? (OWN_VOICE_CD[key] ?? OWN_VOICE_CD.other) : OWN_VOICE_CD.other;
  if (p && now - p.t < cd) return false;
  last.set(unit, { t: now, key }); last.set(WHO, unit);
  return true;
}
/**
 * Pain reactions (docs/talking-portraits.md §9): `retrigger` = a hit inside this many seconds of the last flinch
 * does not restart it; `wounded` = hp fraction below which the idle loop is the wounded loop; `pulse` = red edge (s);
 * `still` = how long the pain still shows in reduced-motion mode (s).
 */
export const PAIN = Object.freeze({ retrigger: 0.4, wounded: 0.5, pulse: 0.45, still: 0.7 });
/** A commando's portrait state: 'dead' | 'downed' (feat/bodies buddy rescue) | 'wounded' (hp < 50 %) | 'ok'. */
export function painState(u) {
  if (!u || u.alive === false) return 'dead';
  if (u.downed || u.state === 'downed') return 'downed';
  const max = u.maxHp > 0 ? u.maxHp : 100;
  return (u.hp ?? max) / max < PAIN.wounded ? 'wounded' : 'ok';
}
/** Flinch gate (`last`: Map unit -> start time): a new flinch only PAIN.retrigger s after the last one. Records it. */
export function flinchGate(last, unit, now) {
  const t = last.get(unit);
  if (t != null && now - t < PAIN.retrigger) return false;
  last.set(unit, now); return true;
}
/**
 * The flinch clip for a hit: the one rendered from the grunt being heard (`rec`), else the next in turn
 * (never the same twice in a row).  @returns {object|null}
 */
export function pickFlinch(list, rec, prev) {
  if (!list?.length) return null;
  const x = rec && list.find((f) => f.rec === rec);
  if (x) return x;
  const i = list.indexOf(prev);
  return list[(i + 1) % list.length];
}
/** mission theater -> portrait grade (design-spec §2.4); night lighting overrides */
export const THEATER_THEME = Object.freeze({ desert: 'desert', africa: 'desert', snow: 'snow', norway: 'snow', temperate: 'europe', europe: 'europe', night: 'night' });
/** Portrait grade for a mission def ({theater, lighting}). */
export function themeFor(def) {
  const L = def?.lighting || {};
  if (L.night || (Number.isFinite(L.sunElevDeg) && L.sunElevDeg < 0)) return 'night';
  return THEATER_THEME[def?.theater] || 'europe';
}
const THEMES = Object.freeze({ // CSS-only grade over the baked studio background
  desert: { tint: '#d9a55a', a: 0.22, f: 'contrast(1.06) saturate(0.9) sepia(0.12)' },
  night: { tint: '#35507d', a: 0.34, f: 'contrast(1.1) saturate(0.7) brightness(0.86)' },
  snow: { tint: '#9fb8cf', a: 0.2, f: 'contrast(1.04) saturate(0.78) brightness(1.02)' },
  europe: { tint: '#7d8a5c', a: 0.14, f: 'contrast(1.05) saturate(0.85)' },
  none: { tint: '#000', a: 0, f: 'contrast(1.04) saturate(0.92)' },
});
const CSS = `
.tp-host{position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#1b1712}
.tp-host video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 28%;filter:var(--tp-f,none);opacity:0;transition:opacity .12s}
.tp-host video.on{opacity:1}
.tp-host .tp-tint{position:absolute;inset:0;background:var(--tp-tint,#000);opacity:var(--tp-a,0);mix-blend-mode:soft-light}
.tp-host .tp-vig{position:absolute;inset:0;background:radial-gradient(ellipse 72% 78% at 50% 42%,transparent 55%,rgba(10,7,4,.55) 100%);box-shadow:inset 0 0 0 1px rgba(236,208,138,.22),inset 0 0 6px rgba(0,0,0,.7)}
.hud-portrait:not(.selected) .tp-host video{filter:var(--tp-f,none) grayscale(1) brightness(.8)}
.tp-host img.tp-still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 28%;filter:var(--tp-f,none);opacity:0;transition:opacity .08s}
.tp-host img.tp-still.on{opacity:1}
.hud-portrait:not(.selected):not(.tp-talking) .tp-host img.tp-still{filter:var(--tp-f,none) grayscale(1) brightness(.8)}
.tp-host .tp-pulse{position:absolute;inset:0;opacity:0;pointer-events:none;box-shadow:inset 0 0 0 2px rgba(214,38,26,.95),inset 0 0 12px 2px rgba(190,20,10,.75)}
.tp-host.tp-hit .tp-pulse{animation:tp-hit .45s ease-out}
@keyframes tp-hit{0%{opacity:1}100%{opacity:0}}
.tp-host.tp-hit.tp-rm .tp-pulse{animation:none;opacity:1}
@media (prefers-reduced-motion:reduce){.tp-host.tp-hit .tp-pulse{animation:none;opacity:1}}
`;
// keep the HUD's skull / state glyph above the video host (the slot is the last child of .face)
const CSS_Z = '.hud-portrait-slot{z-index:0}.hud-portrait .skull,.hud-portrait .glyph{z-index:1}' +
  // the speaker card keeps its name strip above the clip; the placeholder mouths retire while clips are live
  '.hud-speaker-card .tp-host{z-index:0}.hud-speaker-card .name{z-index:1}' +
  '.tp-on .hud-portrait .mouth,.tp-on .hud-speaker-card .mouth{display:none}' +
  // stills while no clip is on screen: the same grade as the video (theme set on the HUD root)
  '.tp-on .hud-portrait.selected .face img,.tp-on .hud-speaker-card img{filter:var(--tp-f,none)}' +
  // a man who is talking is in colour in the top-left strip, selected or not
  '.hud-portrait.tp-talking .tp-host video{filter:var(--tp-f,none)}';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
const TYPES = { webm: 'video/webm; codecs="vp9"', mp4: 'video/mp4; codecs="avc1.4D401E"' };

export class TalkingPortraits {
  /** base URL -> Promise<manifest|null> */
  static _man = new Map();

  /**
   * @param {object} o
   * @param {{on:Function}} o.events game event bus (on(type, fn) -> unsubscribe)
   * @param {object} [o.hud] HUD with portraitSlot(unitId) and topbar.card (speaker card)
   * @param {string} [o.base] URL of the clip folder holding manifest.json
   * @param {object} [o.audio] the game's audio system; when given it voices the lines (external-voice mode)
   * @param {number} [o.size] clip size: 256 (HUD) or 512 (character select / big cards)
   * @param {boolean} [o.ownVoice] play the rendered OGG lines ourselves (default: !audio)
   */
  constructor({ events, hud = null, base = 'assets/portraits/', audio = null, size = 256, ownVoice, fetch: f } = {}) {
    Object.assign(this, { events, hud, base: base.endsWith('/') ? base : base + '/', audio, size });
    this.ownVoice = ownVoice ?? !audio;
    this.fetch = f || ((u) => globalThis.fetch(u));
    this.ok = false; this.theme = 'none';
    this.blobs = new Map();     // clip/voice path -> object URL (preloaded)
    this.voices = new Map();    // voice path -> AudioBuffer (own-voice mode)
    this.slots = new Map();     // unit -> {char, host, idle}
    this.card = null;           // {host, line} in the speaker card
    this.cur = null;            // current line playback
    this._subs = []; this._lastSay = new Map(); this._lastLine = new Map();
    this._flinchAt = new Map(); this._painRec = new Map(); this._lastFlinch = new Map();   // pain (§9)
  }

  /** Fetch the manifest and preload the clips of `units` (the mission's commandos). Resolves false on any failure. */
  async load(units = []) {
    try {
      if (typeof document === 'undefined') return false;
      this.man = await TalkingPortraits.probe({ base: this.base, fetch: this.fetch, size: this.size });
      if (!this.man || this._disposed) return false;
      const v = document.createElement('video');
      this.fmt = ['webm', 'mp4'].find((k) => v.canPlayType(TYPES[k])) || null;
      if (!this.fmt) return false;
      if (!document.getElementById('tp-css')) {
        const s = document.createElement('style'); s.id = 'tp-css'; s.textContent = CSS + CSS_Z; document.head.appendChild(s);
      }
      const chars = new Set();
      for (const u of units) { const c = ROLE_TO_CHAR[u?.role]; if (c && this.man.characters[c]) { chars.add(c); this._attach(u, c); } }
      this._attachCard();
      await Promise.all([...chars].map((c) => this._preload(c)));
      if (this._disposed) return false;
      this.ok = true;
      this._listen();
      this.setTheme(this.theme);
      this.hud?.root?.classList?.add('tp-on');
      // the mission's first selection happened before the HUD was built: bring its idle loop up now
      this._selected({ units: units.filter((u) => u?.selected && u.alive !== false) });
      return true;
    } catch (err) {
      console.warn('[talking-portraits] disabled:', err?.message || err);
      this.ok = false; return false;
    }
  }

  /**
   * Fetch (once per base URL) the clip manifest and register every character's photo still with art/portraits.js,
   * so the briefing / knapsack / top bar show the photo even before (or without) the clips.  Resolves null on failure.
   */
  static probe({ base = 'assets/portraits/', fetch: f, size = 256 } = {}) {
    const b = base.endsWith('/') ? base : base + '/';
    if (!TalkingPortraits._man.has(b)) {
      const get = f || ((u) => globalThis.fetch(u));
      TalkingPortraits._man.set(b, (async () => {
        try {
          const r = await get(b + 'manifest.json');
          if (!r.ok) return null;
          const man = await r.json();
          for (const e of Object.values(man.characters || {})) if (e.game_id && e.poster) registerPortraitPhoto(e.game_id, b + e.poster.replace('{size}', String(size)));
          return man;
        } catch { return null; }
      })());
    }
    return TalkingPortraits._man.get(b);
  }

  url(path) { const p = path.replace('{size}', String(this.size)); return this.base + p; }
  stillURL(path) { const u = this.url(path); return this.blobs.get(u) || u; }
  clipURL(entry) { const u = this.url(entry.clip) + '.' + this.fmt; return this.blobs.get(u) || u; }

  async _blob(u) {
    if (this.blobs.has(u)) return;
    const r = await this.fetch(u); if (!r.ok) throw new Error('missing ' + u);
    this.blobs.set(u, URL.createObjectURL(await r.blob()));
  }

  async _preload(c) {
    const e = this.man.characters[c], jobs = [];
    const clips = [e.idle, e.talk_loop, ...Object.values(e.lines).flatMap((l) => [l, l.alt]), ...(e.pain?.flinch || []), e.pain?.wounded];
    for (const x of clips) if (x) jobs.push(this._blob(this.url(x.clip) + '.' + this.fmt).catch(() => { /* streams instead */ }));
    for (const k of ['still', 'downed']) if (e.pain?.[k]) jobs.push(this._blob(this.url(e.pain[k])).catch(() => {}));
    if (this.ownVoice) for (const x of [...Object.values(e.lines), ...(e.pain?.flinch || [])]) jobs.push(this._voice(x));
    await Promise.all(jobs);
  }

  _ctx() {
    if (!this.ctx) { const AC = globalThis.AudioContext || globalThis.webkitAudioContext; this.ctx = AC ? new AC() : null; }
    return this.ctx;
  }

  async _voice(x) {
    const ctx = this._ctx(); if (!ctx) return;
    const ogg = document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"') || document.createElement('audio').canPlayType('audio/ogg; codecs="opus"');
    const u = this.base + (ogg ? x.voice : x.voice_mp3);
    try { const r = await this.fetch(u); this.voices.set(x.voice, await ctx.decodeAudioData(await r.arrayBuffer())); } catch { /* silent line */ }
  }

  _host(parent) {
    const host = document.createElement('div'); host.className = 'tp-host';
    const mk = () => { const v = document.createElement('video'); v.muted = true; v.defaultMuted = true; v.playsInline = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.preload = 'auto'; v.disablePictureInPicture = true; host.appendChild(v); return v; };
    const idle = mk(), line = mk();
    const still = document.createElement('img'); still.className = 'tp-still'; still.alt = ''; host.appendChild(still);   // pain / downed stills
    let pulse = null;
    for (const k of ['tp-tint', 'tp-vig', 'tp-pulse']) { const d = document.createElement('div'); d.className = k; host.appendChild(d); if (k === 'tp-pulse') pulse = d; }
    parent.appendChild(host);
    return { host, idle, line, still, pulse };   // pulse: the red edge shown on a hit (.tp-hit)
  }

  _attach(unit, char) {
    const slot = this.hud?.portraitSlot?.(unit.id);
    if (!slot || this.slots.has(unit)) return;
    const h = this._host(slot); const e = this.man.characters[char];
    h.idle.loop = true; h.idle.poster = this.url(e.idle.clip) + '.jpg';
    h.idle.addEventListener('loadeddata', () => h.idle.classList.add('on'), { once: true });
    h.idle.addEventListener('error', () => h.host.remove(), { once: true });   // fallback: the photo still below
    // the static face becomes the photo still (poster frame): what shows under a failed / not-yet-decoded clip
    const img = slot.parentElement?.querySelector(':scope > img');
    if (img) {
      const stub = getPortraitURL(unit.role, { size: 80, procedural: true });
      img.addEventListener('error', () => { if (img.src !== stub) img.src = stub; }, { once: true });
      img.src = h.idle.poster;
    }
    this.slots.set(unit, { char, img, ...h, state: painState(unit) });
  }

  _attachCard() {
    const card = this.hud?.topbar?.card;
    if (card && !this.card) { this.card = this._host(card); this.card.idle.remove(); }
  }

  /** 'desert' | 'night' | 'snow' | 'europe' | null: grade the baked studio background into the mission's light. */
  setTheme(name) {
    this.theme = THEMES[name] ? name : 'none';
    const t = THEMES[this.theme];
    const root = this.ok ? this.hud?.root : null;   // the stills under the clips get the same grade
    for (const h of [...this.slots.values(), this.card, root && { host: root }].filter(Boolean)) {
      h.host.style.setProperty('--tp-tint', t.tint); h.host.style.setProperty('--tp-a', String(t.a)); h.host.style.setProperty('--tp-f', t.f);
    }
  }

  /** The voice clock: the AudioContext the voice plays on when it is running, else wall time (fixed per line). */
  _clockFn() {
    const c = this.ownVoice ? this.ctx : (this.audio?.engine?.ctx || this.audio?.ctx);
    return c && c.state === 'running' ? () => c.currentTime : () => performance.now() / 1000;
  }

  _clock() { return this._clockFn()(); }

  _listen() {
    const on = (t, fn) => { const u = this.events?.on?.(t, fn); if (typeof u === 'function') this._subs.push(u); };
    on('unit:selected', (e) => this._selected(e));
    on('unit:killed', (e) => {
      const s = this.slots.get(e.unit); if (!s) return;
      s.idle.pause(); s.host.hidden = true; s.state = 'dead';
      if (this.cur?.unit === e.unit && this.cur.entry?.rec !== 'i_m_hit') this._stop(true);
    });
    // read the bark after every synchronous handler ran (the audio system stamps text/duration in its own handler)
    on('bark', (e) => { if (e?.line === 'pain' && e.unit) this._painRec.set(e.unit, e.rec || null); queueMicrotask(() => this._bark(e)); });
    // pain (§9): the hit man's portrait flinches at once (after the audio system picked his grunt, same tick)
    on('unit:damaged', (e) => queueMicrotask(() => this._hit(e)));
    on('unit:downed', (e) => this._refresh(e?.unit));      // feat/bodies buddy rescue (no-op without it)
    on('unit:revived', (e) => this._refresh(e?.unit));
    on('ability:end', () => this._refreshAll());           // first aid / revive healed someone
    if (this.ownVoice) {
      on('unit:selected', (e) => { const u = e.units?.[0]; if (u && e.units.length === 1 && !e.silent) this._sayOwn(u, 'select'); });
      on('unit:order', (e) => { const o = e.order || {}; this._sayOwn(e.unit, o.type === 'move' ? 'ack_move' : 'ack_act'); });
    }
  }

  _selected(e) {
    const first = (e?.units || [])[0];
    this._sel = first;
    for (const [u, s] of this.slots) { if (s.state !== 'dead') s.state = painState(u); this._applyIdle(u, s); }
  }

  /** The man's idle clip: the wounded loop below PAIN.wounded hp (when rendered), else the normal idle. */
  _idleEntry(s) { const e = this.man.characters[s.char]; return (s.state === 'wounded' && e.pain?.wounded) || e.idle; }

  /**
   * Idle / still for one slot: only the first selected man's idle loop plays (at most one idle decode); the others
   * show its first frame.  A downed man shows his downed still (eyes half-closed) over it; the static face below
   * (what shows before a clip decodes, or when clips fail) follows the same state.
   */
  _applyIdle(u, s) {
    const x = this._idleEntry(s), src = this.clipURL(x);
    if (s.idleSrc !== src) { s.idleSrc = src; s.idle.poster = this.url(x.clip) + '.jpg'; s.idle.src = src; }
    if (u === this._sel && u.alive !== false && s.state !== 'downed' && !this._still()) s.idle.play().catch(() => {});
    else if (!s.idle.paused) s.idle.pause();
    const pn = this.man.characters[s.char].pain;
    const down = s.state === 'downed' && pn?.downed ? this.stillURL(pn.downed) : null;
    if (down) { s.still.src = down; s.still.classList.add('on'); } else if (!s.painUntil) s.still.classList.remove('on');
    if (s.img) { const want = down || s.idle.poster; if (s.img.getAttribute('src') !== want) s.img.src = want; }
  }

  /** Re-read one man's state (hit, healed, downed, revived) and swap his idle / still when it changed. */
  _refresh(u) {
    const s = u && this.slots.get(u);
    if (!s || !this.ok || s.state === 'dead') return;
    const st = painState(u);
    if (st === s.state) return;
    s.state = st;
    if (st !== 'dead') this._applyIdle(u, s);
  }

  _refreshAll() { for (const u of this.slots.keys()) this._refresh(u); }

  /**
   * 'unit:damaged' on a commando: his top-left portrait flinches at once (the flinch clip rendered from the grunt
   * the audio system is playing, else the next variant), in colour, with a red edge pulse.  A hit inside
   * PAIN.retrigger s of the last flinch does not restart it.  Reduced motion: the pain still instead of video.
   */
  _hit(e) {
    const u = e?.unit, s = u && this.slots.get(u);
    if (!this.ok || !s) return;
    const rec = this._painRec.get(u); this._painRec.delete(u);
    this._refresh(u);
    if (u.alive === false || (u.hp ?? 1) <= 0 || s.state === 'downed' || s.host.hidden) return;   // skull / downed still
    if (!flinchGate(this._flinchAt, u, this._now())) return;
    this._pulse(s);
    const f = pickFlinch(this.man.characters[s.char].pain?.flinch, rec, this._lastFlinch.get(u));
    if (!f) return;
    this._lastFlinch.set(u, f);
    if (this._still()) return this._painStill(s);
    this._play(u, s.char, { ...f, lead: 0, pain: true }, { dur: f.voice_seconds });
    this._voiceOnly(f, this.ownVoice);                    // own-voice mode: the grunt too (the game's audio does it otherwise)
  }

  /** Wall clock (s) for the flinch gate (the game can hit a man while the audio clock is suspended). */
  _now() { return performance.now() / 1000; }

  /** Red edge pulse on the slot (restarts on every hit that flinches). */
  _pulse(s) {
    const h = s.host; h.classList.remove('tp-hit'); void h.offsetWidth; h.classList.add('tp-hit');
    if (this._still()) h.classList.add('tp-rm'); else h.classList.remove('tp-rm');   // reduced motion: a static red edge
    clearTimeout(s.pulseT); s.pulseT = setTimeout(() => h.classList.remove('tp-hit'), PAIN.pulse * 1000);
  }

  /** Reduced motion: the flinch-peak still, in colour, for PAIN.still s. */
  _painStill(s) {
    const pn = this.man.characters[s.char].pain; if (!pn?.still) return;
    const face = s.host.closest?.('.hud-portrait');
    s.still.src = this.stillURL(pn.still); s.still.classList.add('on'); face?.classList.add('tp-talking');
    s.painUntil = true; clearTimeout(s.stillT);
    s.stillT = setTimeout(() => {
      s.painUntil = false; face?.classList.remove('tp-talking');
      if (s.state !== 'downed') s.still.classList.remove('on');
    }, PAIN.still * 1000);
  }

  _charOf(e) { return ROLE_TO_CHAR[e?.speaker] || ROLE_TO_CHAR[e?.unit?.role] || null; }

  /**
   * The rendered clip for a bark: the recorded take being heard (`rec`, and the urgent `alt` take when the audio
   * system picked it), else a line whose text matches; null when nothing was rendered for it.
   */
  entryFor(char, e) {
    const lines = this.man?.characters?.[char]?.lines || {};
    let x = e?.rec && lines[e.rec];
    if (!x) { const t = norm(e?.text); x = t ? Object.values(lines).find((l) => norm(l.text) === t) : null; }
    if (!x) return null;
    return e?.take === 'alt' && x.alt ? { ...x.alt, text: x.text, rec: e.rec } : x;
  }

  /** Is a voice audible for this bark?  (a speaker with a recorded pack says nothing for unrecorded lines) */
  _audible(e) {
    if (e?.take) return true;
    const pack = this.audio?.engine?.voiceSpeakers;
    return !(pack && pack.has(e?.speaker));
  }

  _bark(e) {
    if (!this.ok || !e || e.suppressed || e.unit?.kind === 'enemy' || e.unit?.faction === 'enemy') return;
    if (e.line === 'pain') return;                                             // the grunt: the flinch (unit:damaged) shows it
    const char = this._charOf(e); if (!char || !this.man.characters[char]) return;
    if (e.unit && e.unit.alive === false && e.line !== 'death') return;
    const exact = this.entryFor(char, e);
    if (this.ownVoice) {                                                       // no audio system: voice it ourselves
      if (exact) return this._play(e.unit, char, exact, { voice: true });
      const key = KEY_LINES[e.line]; if (key) return this._sayOwn(e.unit, e.line);
      return this._play(e.unit, char, null, { dur: 0.25 + 0.06 * String(e.text || '').length });
    }
    if (!exact && !this._audible(e)) return;                                   // silent subtitle: the still speaks
    const dur = e.duration || (0.25 + 0.06 * String(e.text || '').length);
    this._play(e.unit, char, exact, { dur });                                  // voice already started by the game
  }

  _sayOwn(unit, key) {
    const char = ROLE_TO_CHAR[unit?.role]; if (!this.ok || !char || unit.alive === false) return;
    const now = this._clock();
    if (!ownVoiceGate(this._lastSay, unit, key, now)) return;
    const lines = this.man.characters[char].lines;
    const names = (KEY_LINES[key] || []).filter((n) => lines[n]);
    const rk = `${char}|${key}`, n = nextLine(names, this._lastLine.get(rk));
    if (!n) return;
    this._lastLine.set(rk, n);
    this._play(unit, char, lines[n], { voice: true });
  }

  /**
   * Play `entry` (a rendered line) or, when null, the generic talk loop for `dur` s, in the speaker's own top-left
   * portrait slot (mirrored on the speaker card while the HUD shows it; card only for a man without a slot). The
   * portrait turns to colour while he talks, then fades back to his idle loop / still. The clip follows the audio clock: it is seeked so that
   * clip time `lead` coincides with the voice onset, and requestVideoFrameCallback corrects drift.
   */
  _play(unit, char, entry, { voice = false, dur = 1 } = {}) {
    // the man's own top-left portrait talks; the speaker card (when the HUD shows it) mirrors the same clip
    const slot = this.slots.get(unit);
    const card = this.card && !this.hud?.topbar?.card?.hidden ? this.card : null;   // hidden card: laconic HUD
    const h = slot && !slot.host.hidden ? slot : card; if (!h) return;
    const e = this.man.characters[char];
    this._stop(true);
    const clip = entry || e.talk_loop; if (!clip) return;
    if (this._still()) return this._voiceOnly(entry, voice);                     // reduced motion: the still stays
    const vs = [h.line, ...(card && card !== h ? [card.line] : [])], v = vs[0];
    const PRE = voice ? 0.12 : 0;                         // own voice: keep 120 ms of lip anticipation before onset
    const lead = entry ? (entry.lead ?? this.man.lead ?? 0.35) : 0;
    const seek = Math.max(0, lead - PRE);
    const len = entry ? (entry.voice_seconds || dur) : dur;
    const src = this.clipURL(clip);
    for (const x of vs) { x.loop = !entry; if (x.src !== src) x.src = src; }
    const clk = this._clockFn();
    const t0 = clk() + PRE;                              // voice onset on the audio clock
    this._voiceOnly(entry, voice);
    const face = h === slot ? slot.host.closest?.('.hud-portrait') : null;
    face?.classList.add('tp-talking');                   // in colour while he speaks, even when not selected
    const cur = this.cur = { h, v, vs, face, t0, lead, end: t0 + len + 0.3, loop: !entry, clk, unit, entry };
    // safety net: end the line on wall time too (a stalled / throttled video never calls back)
    cur.timer = setTimeout(() => { if (this.cur === cur) this._stop(); }, (len + 0.3 + PRE) * 1000 + 400);
    const go = (x) => {
      if (this.cur !== cur) return;
      x.currentTime = seek; x.playbackRate = 1;
      x.play().then(() => { if (this.cur !== cur) return; x.classList.add('on'); if (x === v) this._track(cur); })
        .catch(() => { if (x === v) this._stop(); });
    };
    for (const x of vs) { if (x.readyState >= 1) go(x); else x.addEventListener('loadedmetadata', () => go(x), { once: true }); }
  }

  /** Reduced-motion option (HUD menu kit: 'on' or the OS setting): portraits keep their still. */
  _still() { return !!this.hud?.kit?.reducedMotion; }

  /** Own-voice mode: start the rendered voice take `PRE` s from now on our AudioContext. */
  _voiceOnly(entry, voice) {
    if (!(voice && entry && this.ctx)) return;
    const buf = this.voices.get(entry.voice); if (!buf) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.ctx.destination);
    src.start(this.ctx.currentTime + 0.12); this._src = src;
  }

  /** drift correction against the audio clock + end of line */
  _track(cur) {
    const step = () => {
      if (this.cur !== cur) return;
      const now = cur.clk();
      if (now >= cur.end) return this._stop();
      if (!cur.loop) {
        for (const v of cur.vs) {
          if (v.paused) continue;
          const drift = v.currentTime - this._expected(cur, now);
          // > 30 ms off (typically the start-up lag of play()): seek, at most every 250 ms so a seek can land;
          // smaller drift is nudged with the playback rate
          const sk = cur.seekAt || (cur.seekAt = new Map());
          if (Math.abs(drift) > 0.03 && now - (sk.get(v) ?? -1e9) >= 0.25) {
            v.currentTime = this._expected(cur, now) + SEEK_AHEAD; v.playbackRate = 1; sk.set(v, now);
          } else v.playbackRate = Math.abs(drift) > 0.015 ? Math.min(1.08, Math.max(0.92, 1 - drift * 2)) : 1;
        }
      }
      if (cur.v.requestVideoFrameCallback) cur.v.requestVideoFrameCallback(step); else requestAnimationFrame(step);
    };
    step();
  }

  /** clip time that belongs on screen at audio-clock time `now` (clip time `lead` == voice onset t0) */
  _expected(cur, now) { return cur.lead + (now - cur.t0); }

  /** End the current line: fade the line clip out over the idle loop / static face. */
  _stop(immediate = false) {
    const cur = this.cur; this.cur = null;
    if (cur?.timer) clearTimeout(cur.timer);
    if (this._src && immediate) { try { this._src.stop(); } catch { /* already ended */ } this._src = null; }
    if (!cur) return;
    cur.face?.classList.remove('tp-talking');
    for (const v of cur.vs || [cur.v]) {
      v.classList.remove('on');
      setTimeout(() => { if (!this.cur?.vs?.includes(v)) v.pause(); }, immediate ? 0 : 160);
    }
  }

  /** Is a line clip on screen? (tests / HUD placeholder suppression) */
  get talking() { return !!this.cur; }

  dispose() {
    this._disposed = true;
    this._stop(true);
    this.hud?.root?.classList?.remove('tp-on');
    for (const u of this._subs) u(); this._subs = [];
    for (const s of [...this.slots.values(), this.card].filter(Boolean)) { for (const v of s.host.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); } s.host.remove(); }
    this.slots.clear(); this.card = null;
    for (const u of this.blobs.values()) URL.revokeObjectURL(u); this.blobs.clear();
    this.ctx?.close?.(); this.ctx = null; this.ok = false;
  }
}

/**
 * 3D use (character select, briefing table): a looping muted clip as an sRGB THREE.VideoTexture. Put the mesh in
 * `renderer.overlayScene` (drawn after the ACES OutputPass, so the clip is not tone-mapped twice).
 * @param {typeof import('three')} THREE
 * @param {string} src clip URL (e.g. base + 'spy/idle_512.webm')
 */
export function videoTexture(THREE, src) {
  const v = document.createElement('video');
  Object.assign(v, { src, loop: true, muted: true, playsInline: true, crossOrigin: 'anonymous' });
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  v.play().catch(() => {});
  const tex = new THREE.VideoTexture(v);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { video: v, texture: tex };
}
