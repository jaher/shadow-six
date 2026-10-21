/**
 * Live download figures for the loading screen: MB downloaded / MB to go, a smoothed bandwidth and an ETA,
 * computed from actual transferred bytes.
 *
 * Two feeds, one set of numbers:
 *  - pack loads (engine/mission-pack.js, audio/sprite-source.js) count the bytes they stream into a meter
 *    directly — exact wire bytes, and the total is the pack manifest's exact size (parts + sprites);
 *  - file-by-file loads are counted by the load progress' Resource Timing observer (engine/load-progress.js),
 *    which mirrors its bytes / mission budget into the meter the loading screen reads (ui/loading.js).
 *
 * Bandwidth is the bytes delta over a trailing ~3 s window of samples, never an instantaneous spike; the ETA
 * is remaining / bandwidth. Until the window holds ~1 s of data both stay null and the formatted line omits
 * them — as it omits to-go/ETA when the total is genuinely unknown — rather than inventing numbers.
 * @module engine/download-meter
 */

const WINDOW_MS = 3000;
const MIN_SPAN_MS = 1000;
const SAMPLE_MS = 150;

export class DownloadMeter {
  /** @param {() => number} [now] clock in ms (injectable for tests) */
  constructor(now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this._now = now;
    this.bytes = 0;
    this.total = null; // known total bytes (pack manifest exact, or the mission budget), null while unknown
    this.active = false; // a pack feed owns this meter (load-progress prefers it over the observer's count)
    this._samples = []; // [t, bytes]
    this._lastSampleAt = -Infinity;
  }

  _sample() {
    const t = this._now();
    if (this._samples.length && t - this._lastSampleAt < SAMPLE_MS) return;
    this._lastSampleAt = t;
    this._samples.push([t, this.bytes]);
    const cut = t - WINDOW_MS - 1000;
    while (this._samples.length > 1 && this._samples[0][0] < cut) this._samples.shift();
  }

  /** Count transferred bytes (the pack feeds call this per streamed chunk / loaded sprite group). */
  add(n) { if (n > 0) { this.bytes += n; this._sample(); } }

  /** Add to the known total (each pack part / sprite group announces its size once). */
  addTotal(n) { if (n > 0) this.total = (this.total || 0) + n; }

  /** Mirror an externally counted position (the Resource Timing observer's bytes and the budget total). */
  note(bytes, total) {
    if (bytes > this.bytes) this.bytes = bytes;
    if (total != null) this.total = total;
    this._sample();
  }

  /** Smoothed bandwidth in bytes/s over the trailing window, or null until the estimate is meaningful. */
  rate() {
    const s = this._samples;
    if (s.length < 2) return null;
    const [t1, b1] = s[s.length - 1];
    let first = s[0];
    for (const smp of s) { if (smp[0] >= t1 - WINDOW_MS) { first = smp; break; } }
    const span = t1 - first[0];
    if (span < MIN_SPAN_MS || b1 <= first[1]) return null;
    return (b1 - first[1]) / (span / 1000);
  }

  /** Seconds remaining at the current rate, or null when it cannot be estimated yet. */
  eta() {
    if (this.total == null) return null;
    const r = this.rate();
    if (!r) return null;
    return Math.max(0, (this.total - this.bytes) / r);
  }
}

/** An ETA as an m:ss clock ("0:09", "1:09", "10:00"). */
export function formatEta(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The loading screen's one download line, e.g. "12.4 MB downloaded · 71.3 MB to go · 8.2 MB/s · ~0:09 left".
 * Segments drop out when their input is genuinely unavailable (unknown total, rate not yet meaningful).
 * @param {DownloadMeter} m
 */
export function formatDownload(m) {
  const mb = (n) => (n / 1e6).toFixed(1);
  const down = m.total != null ? Math.min(m.bytes, m.total) : m.bytes;
  let s = `${mb(down)} MB downloaded`;
  if (m.total != null) s += ` · ${mb(Math.max(0, m.total - m.bytes))} MB to go`;
  const rate = m.rate();
  if (rate) s += ` · ${mb(rate)} MB/s`;
  const eta = m.eta();
  if (eta != null) s += ` · ~${formatEta(eta)} left`;
  return s;
}
