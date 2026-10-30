/**
 * The step captions of a film (capture-video.mjs): which text is on screen when.
 *
 * Two conventions meet here.
 *  - A cut's `CAPTIONS` (m03.cut.mjs) are keyed by the checkpoint and worded for what has just happened: they go up at the
 *    checkpoint and stay for a while (`lead` false: the film's original behaviour, kept for hand-made cuts).
 *  - The walkthrough's steps (m05.walkthrough.mjs) and the solution's checkpoint names describe the stretch that ENDS at the
 *    checkpoint: docs/walkthrough-format.md — "step A2 is shown from the moment checkpoint A1 is reached … so write each step
 *    as what is about to happen". Without a cut they used to go up at the checkpoint they describe, one step late (the knife
 *    was already in when "he comes up behind e4 and knifes him" appeared) and went blank in a long step. `lead` captions
 *    go up when the step BEGINS (a stage starts, the checkpoint before is reached) and stay until the next one. A cut that
 *    words most of the checkpoints keeps the first convention; a cut that words only a few (M1's D4) mends those steps
 *    and leaves the others to the walkthrough.
 *
 * A caption is read, not glanced at: it gets `readingTime(text)` film seconds before the next one may replace it. A step that
 * ends before the previous caption has been read waits for it (a lag of a few seconds at most, and only in quick sequences);
 * a caption that is overtaken by a later one while it waits is dropped, and a step of no length (two checkpoints in the same
 * tick) has none.
 */

/** Characters a viewer reads per film second, and the shortest / longest time a caption is given. */
export const READ_CPS = 24;
export const READ_MIN = 2.2;
export const READ_MAX = 6.5;
/** Longest caption (two lines in the film's caption box). */
export const CAPTION_MAX = 160;

/** The film seconds a caption needs on screen to be read. */
export const readingTime = (text) => Math.min(READ_MAX, Math.max(READ_MIN, String(text || '').length / READ_CPS));

const sentences = (t) => String(t || '').trim().replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);

/** The first sentence of a text, at most `max` characters (a longer one is cut at a word and ends in an ellipsis): the cut-based films' step text. */
export function firstSentence(t, max = 150) {
  const one = sentences(t)[0] || '';
  return one.length <= max ? one : one.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/**
 * A walkthrough step as a caption: its first sentence, and the following ones while the whole stays within `max` characters
 * (the situation alone — "The patrol halts by b1 looking south." — would say nothing of the shot that follows it).
 */
export function captionText(say, max = CAPTION_MAX) {
  const s = sentences(say);
  if (!s.length) return '';
  let out = s[0];
  for (const x of s.slice(1)) { if ((out + ' ' + x).length > max) break; out += ' ' + x; }
  return out.length <= max ? out : out.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/** `A2 greenberet knifes e4` → `A2` */
export const checkpointKey = (name) => String(name).split(' ')[0];

/**
 * @param {{names: string[], cutCaptions?: Record<string,string>, steps?: {cp: string, say?: string}[]}} o
 *   names: the checkpoint names in play order (pass 1's); cutCaptions: the cut's CAPTIONS, if it has any; steps: the walkthrough's.
 * @returns {{lead: boolean, textOf: (name: string) => string, at: (done: number) => string}}
 *   lead: the text goes up when its step begins (the cut words fewer than half the checkpoints); textOf(name): the text of a checkpoint's step;
 *   at(done): the text of the step that begins when `done` checkpoints have been reached ('' after the last).
 */
export function captionPlan({ names, cutCaptions, steps }) {
  const wt = new Map((steps || []).map((s) => [String(s.cp), s]));
  // (a cut that words most of the checkpoints — M3's — owns the convention; one that mends a single step — M1's D4 — leaves the rest to the walkthrough, which leads)
  const cutOwn = cutCaptions ? names.filter((n) => cutCaptions[checkpointKey(n)] != null).length : 0;
  const lead = !cutCaptions || cutOwn < names.length / 2;
  const textOf = (name) => {
    const k = checkpointKey(name), s = wt.get(k);
    return cutCaptions?.[k] ?? (s?.say ? (lead ? captionText(s.say) : firstSentence(s.say)) : String(name).replace(/^\S+\s/, ''));
  };
  return { lead, textOf, at: (done) => (lead ? (names[done] != null ? textOf(names[done]) : '') : done > 0 ? textOf(names[done - 1]) : '') };
}

/**
 * The caption queue (lead captions): `due(text, now)` when a step begins, `tick(now)` every frame, `text` is what is on screen.
 */
export function captionQueue() {
  const q = { text: '', since: -Infinity, need: 0, pending: null };
  const show = (text, now) => { q.text = text; q.since = now; q.need = text ? readingTime(text) : 0; q.pending = null; };
  q.due = (text, now) => {
    if (text === q.text || text === q.pending) return;
    if (!text) { show('', now); return; }
    if (!q.text || now - q.since >= q.need) show(text, now); else q.pending = text;
  };
  q.tick = (now) => { if (q.pending && now - q.since >= q.need) show(q.pending, now); };
  return q;
}
