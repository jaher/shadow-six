/**
 * UI sounds (docs/menus-art-direction.md §1.8, amendment B10): the `ui.*` registry → audio-engine SFX ids
 * (src/audio/manifest.js 'ui' bus), with the hover throttle (1 per 60 ms), pitch-graded hover ticks, and a 3 dB /
 * 150 ms music duck under every UI sound. Plays through `game.audio.playSfx` (the one audio engine); before the
 * first gesture the engine only logs, so nothing pops.
 * @module ui/ui-sound
 */

/** §1.8 id → [sfx id, gain, rate]. */
export const UI_SOUNDS = Object.freeze({
  hover: ['ui_safety', 1, 1],
  select: ['ui_bolt', 1, 1],
  back: ['ui_latch', 1, 0.84], // lighter latch, −3 semitones
  toggle: ['ui_toggle', 1, 1],
  detent: ['ui_detent', 1, 1],
  type: ['ui_type', 1, 1],
  typeBack: ['ui_type_back', 1, 1],
  bell: ['ui_bell', 1, 1],
  paper: ['ui_paper', 1, 1],
  stamp: ['stamp', 1, 1],
  clink: ['ui_clink', 1, 1],
  clinkGold: ['ui_clink', 1, 0.94],
  deny: ['ui_deny', 1, 1],
  error: ['ui_error', 1, 1],
  projector: ['ui_projector', 1, 1],
  lamp: ['ui_lamp', 1, 1],
});

/** Semitones → playback rate. */
export const semitone = (n) => 2 ** (n / 12);

export class UiSound {
  /** @param {() => object|null} getAudio returns the game's audio system (createAudio) */
  constructor(getAudio) {
    this.getAudio = getAudio;
    this._lastHover = 0;
    this._loops = new Map();
    this.log = []; // last few ids (tests)
  }

  /**
   * Play a §1.8 UI sound. opts: {semi} pitch shift in semitones (hover grading), {gain}.
   * @returns {object|null} engine handle
   */
  play(id, opts = {}) {
    const def = UI_SOUNDS[id];
    if (!def) return null;
    const now = performance.now();
    if (id === 'hover') {
      if (now - this._lastHover < 60) return null;
      this._lastHover = now;
    }
    this.log.push(id);
    if (this.log.length > 32) this.log.shift();
    const a = this.getAudio?.();
    if (!a?.playSfx) return null;
    const rate = def[2] * semitone(opts.semi || 0) * (id === 'type' ? 0.96 + Math.random() * 0.08 : 1);
    const h = a.playSfx(def[0], null, { rate, gain: (opts.gain ?? 1) * def[1], dedupe: 0.015 });
    this._duck(a);
    return h;
  }

  /** Looped bed (`projector`); `stop(id)` fades it. */
  loop(id) {
    const a = this.getAudio?.();
    if (!a?.startLoop || !UI_SOUNDS[id]) return;
    this._loops.set(id, true);
    a.startLoop(`ui:${id}`, UI_SOUNDS[id][0], null, { fadeIn: 0.4 });
  }

  stop(id) {
    const a = this.getAudio?.();
    if (!this._loops.has(id)) return;
    this._loops.delete(id);
    a?.stopLoop?.(`ui:${id}`, 0.4);
  }

  /** UI sounds duck the music by 3 dB for 150 ms. */
  _duck(a) {
    const bus = a.engine?.bus?.music;
    const ctx = a.engine?.ctx;
    if (!bus?.gain || !ctx?.currentTime) return;
    try {
      const g = bus.gain, t = ctx.currentTime, v = a.volumes?.music ?? g.value;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(v * 0.708, t + 0.02);
      g.linearRampToValueAtTime(v, t + 0.17);
    } catch { /* mock contexts */ }
  }
}
