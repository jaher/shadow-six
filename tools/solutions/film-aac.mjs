/**
 * The film's AAC bitrate, checked before the film is encoded. ffmpeg's native AAC encoder now and then puts a burst of full-scale
 * samples on one channel at a sharp transient (M16's film: the Sniper's bolt click, 12 samples up to +0.6 dBFS in a soundtrack that
 * peaks at -5.5 dBFS before the encoder), and it does so at one bitrate and not at the next (192k and 256k, not 160k or 224k). The
 * soundtrack is encoded alone first, decoded and measured; a bitrate whose decode peaks over the limit is passed over for the next one.
 * Used by mix-video.mjs; the unit tests (tests/unit/mission-film.test.mjs) cover the parsing and the choice.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Peak level of an ffmpeg `astats` log in dBFS (the overall line, the last one printed); NaN when there is none. */
export function parsePeakDb(log) {
  const tail = String(log).split('Overall').pop();
  const m = /Peak level dB:\s*(-?inf|-?[\d.]+)/.exec(tail);
  return m ? (/inf/.test(m[1]) ? -Infinity : +m[1]) : NaN;
}

/** Sample peak (dBFS) of an audio file's decode: the encoder's overshoot is in the decoded samples (float, so it is not clipped). */
export function decodedPeakDb(ff, file) {
  const r = spawnSync(ff, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return parsePeakDb(r.stderr);
}

/** The bitrates to try for a wanted one ('192k'): the wanted, then 32k up, 32k down and 64k up (never under 96k). */
export function bitrateCandidates(wanted) {
  const k = parseInt(wanted);
  if (!Number.isFinite(k) || k <= 0) return [String(wanted)];
  return [k, k + 32, k - 32, k + 64].filter((x) => x >= 96).map((x) => `${x}k`);
}

/** From the trials `{ bitrate, peak }` in order: the first whose decode stays at or under `limit`, else the quietest one (NaN counts as the worst). */
export function pickBitrate(trials, limit = -1) {
  const good = trials.find((t) => t.peak <= limit);
  if (good) return good;
  const key = (t) => (Number.isFinite(t.peak) || t.peak === -Infinity ? t.peak : Infinity);
  return trials.reduce((best, t) => (key(t) < key(best) ? t : best), trials[0]);
}

/**
 * Encode `input` through `chain` (the film's audio filters) to AAC at each candidate bitrate in turn, decode it and measure; returns the
 * bitrate to use (the wanted one when its decode is clean). `tmp` is a path prefix for the trial files, which are removed.
 */
export function chooseAudioBitrate({ ff, input, chain, bitrate, tmp, limit = -1, log = () => {} }) {
  const trials = [];
  for (const br of bitrateCandidates(bitrate)) {
    const out = `${tmp}-${br}.m4a`;
    const r = spawnSync(ff, ['-y', '-loglevel', 'error', '-i', input, '-af', chain, '-c:a', 'aac', '-b:a', br, out], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const peak = r.status === 0 ? decodedPeakDb(ff, out) : NaN;
    rmSync(out, { force: true });
    trials.push({ bitrate: br, peak });
    log(`audio ${br}: decoded peak ${Number.isFinite(peak) ? peak.toFixed(1) : peak} dBFS${peak <= limit ? '' : ' — over the limit, trying another bitrate'}`);
    if (peak <= limit) break;
  }
  const pick = pickBitrate(trials, limit);
  if (!(pick.peak <= limit)) log(`audio: no bitrate stayed under ${limit} dBFS; the quietest, ${pick.bitrate}, is used`);
  return pick.bitrate;
}
