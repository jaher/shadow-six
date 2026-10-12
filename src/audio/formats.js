/**
 * Which audio file this browser downloads. Every sound ships twice (tools/audio/web_formats.py): Opus in Ogg (`.ogg`)
 * and AAC-LC in MP4 (`.m4a`). Opus is smaller for the same quality and decodes everywhere except WebKit, whose Opus
 * support has differed between <audio> and decodeAudioData from one Safari version to the next — so Safari (macOS),
 * every iOS / iPadOS browser (all WebKit) and any browser that does not report Ogg Opus get AAC, which WebKit has
 * always decoded on both paths. One format per client: the other set is never requested.
 * If an Ogg file fails to decode anyway, `useAacAfterFailure()` switches this page to AAC for the rest of the session.
 * @module audio/formats
 */

let chosen = null;

/** Is this a WebKit browser (Safari, or any browser on iOS / iPadOS)? */
export function isWebKit(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/iP(hone|ad|od)/.test(ua)) return true; // every iOS browser is WebKit
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1) return true; // iPadOS "desktop" UA
  return /Apple/.test(String(nav.vendor || '')) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
}

/** Can this browser play Ogg Opus (and is it not WebKit)? Node (tests, tools): yes. */
export function prefersOpus(nav = globalThis.navigator, AudioCtor = globalThis.Audio) {
  if (typeof AudioCtor !== 'function') return true;
  if (isWebKit(nav)) return false;
  try { return !!new AudioCtor().canPlayType?.('audio/ogg; codecs=opus'); } catch { return false; }
}

/** '.ogg' or '.m4a' for this page (decided once). */
export function audioExt() {
  if (!chosen) chosen = prefersOpus() ? '.ogg' : '.m4a';
  return chosen;
}

/** An Ogg file did not decode: use AAC from now on. @returns {boolean} true when this switched the format */
export function useAacAfterFailure() {
  if (chosen === '.m4a') return false;
  chosen = '.m4a';
  return true;
}

/** Tests: force a format (null = decide again). */
export function setAudioExt(ext) { chosen = ext; }

/**
 * The file of a [ogg, m4a] (or legacy [ogg, mp3]) list this page plays, prefixed with `prefix` when given.
 * @param {string[]} files @param {string} [prefix] e.g. 'sfx/' (added when missing)
 */
export function pickAudio(files = [], prefix = '') {
  const ext = audioExt();
  const f = files.find((x) => x.endsWith(ext)) || files.find((x) => x.endsWith('.ogg')) || files.find((x) => !x.endsWith('.json')) || null;
  return f ? (prefix && !f.startsWith(prefix) ? prefix + f : f) : null;
}

/** The same file in the other format (an Ogg that failed to decode → its AAC twin), or null. */
export function aacTwin(url) {
  return /\.ogg$/.test(url) ? url.replace(/\.ogg$/, '.m4a') : null;
}
