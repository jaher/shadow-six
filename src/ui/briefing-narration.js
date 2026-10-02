/**
 * Timing of the briefing narration (pure, no DOM / audio): which line is being read at time t, how much of its text
 * is out, and when the next line starts. Lines come from assets/audio/narration/manifest.json:
 * {id, text, duration, words:[{w, s, e}]} with word times in seconds from the clip start.
 * The on-screen words are revealed in step with the voice by character share: a word is out once the voice has
 * read that share of the line's letters (the TTS words and the screen words need not split the same way:
 * "1941", "north-west").
 * @module ui/briefing-narration
 */

export const NARRATION_TIMING = Object.freeze({
  lead: 1.6, // s of briefing music and projector before the voice (the music intro)
  gap: 0.45, // s between lines
  ahead: 0.08, // s the text runs ahead of the voice so the eye never waits
  wait: 4, // s to wait for the clips to decode before giving up on the voice (text then shows at once)
});

/** The Colonel's tour read by the narrator (ui/briefing.js part 2): the camera holds on each stop for his line. */
export const TOUR_TIMING = Object.freeze({
  lead: 0.3, // s after a stop is chosen before he speaks (the camera sets off first)
  gap: 0.6, // s after his line before the camera moves on
  minStop: 2.5, // s a stop is held at least, however short the line
  wait: 2.5, // s to wait for a caption's clip to decode before the tour goes on with the text alone
});

const letters = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, '').length;

export class NarrationTrack {
  /** @param {{id:string, text:string, duration:number, words?:{w:string, s:number, e:number}[]}[]} lines */
  constructor(lines, timing = NARRATION_TIMING) {
    this.timing = { ...NARRATION_TIMING, ...timing };
    this.lines = lines.map((l) => {
      const words = l.words || [];
      const total = words.reduce((a, w) => a + letters(w.w), 0) || 1;
      let acc = 0;
      // spoken letter share at the END of each TTS word
      const marks = words.map((w) => ({ s: w.s, e: w.e, share: (acc += letters(w.w)) / total }));
      return { ...l, marks };
    });
  }

  get count() {
    return this.lines.length;
  }

  /** Share (0..1) of line i's text the voice has read `local` s into its clip. */
  share(i, local) {
    const l = this.lines[i];
    if (!l) return 1;
    const t = local + this.timing.ahead;
    if (!l.marks.length) return Math.max(0, Math.min(1, t / Math.max(0.1, l.duration)));
    let prev = 0;
    for (const m of l.marks) {
      if (t < m.s) return prev;
      if (t < m.e) return prev + (m.share - prev) * ((t - m.s) / Math.max(1e-3, m.e - m.s));
      prev = m.share;
    }
    return 1;
  }

  /**
   * Split a line's on-screen text into words with the letter share at which each one appears.
   * @returns {{text:string, at:number}[]} `text` keeps its trailing whitespace so join('') === line text
   */
  static screenWords(text) {
    const parts = String(text).match(/\S+\s*/g) || [];
    const total = letters(text) || 1;
    let acc = 0;
    return parts.map((p) => {
      const at = acc / total;
      acc += letters(p);
      return { text: p, at };
    });
  }
}

/**
 * Can anyone hear the narrator? Not when the game is muted or the MASTER, VOICES or NARRATION volume is at 0: then the
 * briefing shows its text at once instead of revealing it at the pace of a silent voice.
 * @param {{muted?:boolean, volumes?:{master?:number, voice?:number, narration?:number}}} audio
 */
export function narrationAudible(audio) {
  const v = audio?.volumes || {};
  return !!audio && !audio.muted && ['master', 'voice', 'narration'].every((k) => !(v[k] <= 0));
}
