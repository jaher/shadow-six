/**
 * The software mixer of the mission films (tools/solutions/mix-video.mjs): renders a soundtrack plan
 * (tools/solutions/film-audio.mjs) to stereo float PCM. A film has thousands of effects, far too many inputs for one
 * ffmpeg graph, so the sound is summed here, sample by sample: ffmpeg only decodes the game's files (and normalises and
 * encodes the result).
 *   SoundBank   decodes a file (ffmpeg → f32 stereo 48 kHz, cached), renders one of the game's own synth recipes
 *               (src/audio/synth.js) for an effect the game has no recording of, and stitches a music cue back together
 *               from its chunks the way the game's streamer plays them (assets/audio/music/manifest.json: chunk k holds
 *               cue time [t, t+d) plus the next `o` s, neighbours crossfaded linearly over the overlap).
 *   Mix         the master buffer: add(pcm, at, {vol, pan, rate, from, len, fadeIn, fadeOut, env, loop…}).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RATE = 48000;

/** Decode a media file to stereo float PCM at RATE. */
export function decodeFile(ff, file) {
  const r = spawnSync(ff, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout?.length) throw new Error(`cannot decode ${file}: ${String(r.stderr || '').slice(0, 200)}`);
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const n = f.length >> 1, l = new Float32Array(n), rr = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = f[2 * i]; rr[i] = f[2 * i + 1]; }
  return { l, r: rr, len: n };
}

/** A loop-seamless copy of a bed: the last `xf` s are crossfaded into the first (looping it has no click or dip). */
export function seamless(p, xf = 0.5) {
  const x = Math.min(Math.round(xf * RATE), p.len >> 2), L = p.len - x;
  const l = new Float32Array(L), r = new Float32Array(L);
  for (let i = 0; i < L; i++) { l[i] = p.l[i]; r[i] = p.r[i]; }
  for (let i = 0; i < x; i++) { const a = i / x; l[i] = p.l[i] * a + p.l[L + i] * (1 - a); r[i] = p.r[i] * a + p.r[L + i] * (1 - a); }
  return { l, r, len: L };
}

export class SoundBank {
  /** @param {{ff:string, root:string, synth?:Function, musicManifest:object}} o */
  constructor(o) { Object.assign(this, o); this.files = new Map(); this.cues = new Map(); this.beds = new Map(); }

  /** 'file:<path>' (decoded) or 'synth:<recipe>' (the game's own placeholder, mono → both channels) */
  pcm(src) {
    let p = this.files.get(src);
    if (p) return p;
    if (src.startsWith('synth:')) {
      const m = this.synth(src.slice(6), RATE, 1);
      p = { l: m, r: m, len: m.length };
    } else p = decodeFile(this.ff, src.slice(5));
    this.files.set(src, p);
    return p;
  }
  /** the loop-seamless version of a bed */
  bed(src) { let p = this.beds.get(src); if (!p) this.beds.set(src, p = seamless(this.pcm(src))); return p; }

  /** A music cue from its chunks (the streamer's rule: linear crossfade over each chunk's `o`). */
  cue(id) {
    let c = this.cues.get(id);
    if (c) { this.cues.delete(id); this.cues.set(id, c); return c; } // (most recently used last)
    const def = this.musicManifest.cues[id], meta = this.musicManifest.meta?.[id] || {};
    if (!def) throw new Error(`no music cue ${id}`);
    const last = def.chunks[def.chunks.length - 1];
    const total = Math.round((meta.lengthSec ?? last.t + last.d) * RATE);
    const l = new Float32Array(total + RATE), r = new Float32Array(total + RATE);
    def.chunks.forEach((ch, k) => {
      const p = decodeFile(this.ff, join(this.root, 'assets/audio/music', ch.f + '.ogg'));
      const at = Math.round(ch.t * RATE), n = Math.min(p.len, Math.round((ch.d + ch.o) * RATE));
      const fin = k > 0 ? Math.round(def.chunks[k - 1].o * RATE) : 0, fout = ch.o > 0 && k < def.chunks.length - 1 ? Math.round(ch.o * RATE) : 0;
      for (let i = 0; i < n && at + i < l.length; i++) {
        let g = 1;
        if (i < fin) g = i / fin;
        if (fout && i >= n - fout) g = Math.min(g, (n - i) / fout);
        l[at + i] += p.l[i] * g; r[at + i] += p.r[i] * g;
      }
    });
    c = { l, r, len: total, meta };
    this.cues.set(id, c);
    while (this.cues.size > 3) this.cues.delete(this.cues.keys().next().value); // (a 150 s cue is 60 MB)
    return c;
  }
}

/** Piecewise-linear automation [[t, g], …] as a function of t, for t asked in increasing order. */
export function automation(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  let i = 0;
  return (t) => {
    if (!pts.length) return 1;
    if (t <= pts[0][0]) return pts[0][1];
    while (i < pts.length - 2 && pts[i + 1][0] <= t) i++;
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    const [t0, g0] = pts[i], [t1, g1] = pts[i + 1];
    return t1 > t0 ? g0 + (g1 - g0) * ((t - t0) / (t1 - t0)) : g1;
  };
}

export class Mix {
  constructor(seconds) { this.n = Math.ceil(seconds * RATE); this.l = new Float32Array(this.n); this.r = new Float32Array(this.n); }

  /**
   * Add a sound at `at` (s). vol: linear gain; pan −1…1 (equal power); rate: playback speed (pitch); from: offset into the
   * source (s); len: output length (s; default = what is left of the source, or `until − at`); fadeIn / fadeOut (s, linear);
   * env: automation [[t, g]] in film time; loop: {from, to} (s into the source) — played through, then [from, to) repeated.
   */
  add(p, at, o = {}) {
    const { vol = 1, pan = 0, rate = 1, from = 0, fadeIn = 0, fadeOut = 0, loop = null } = o;
    const src = (from * RATE) | 0, srcEnd = loop ? Infinity : p.len;
    let len = o.len ?? (o.until != null ? o.until - at : (p.len - src) / RATE / rate);
    len = Math.max(0, len);
    const i0 = Math.round(at * RATE), n = Math.min(Math.round(len * RATE), this.n - i0), start = Math.max(0, -i0);
    if (n <= 0) return;
    const th = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4, gl = Math.cos(th) * Math.SQRT2, gr = Math.sin(th) * Math.SQRT2;
    const env = o.env ? automation(o.env) : null;
    const fi = fadeIn * RATE, fo = fadeOut * RATE;
    const lf = loop ? loop.from * RATE : 0, lt = loop ? loop.to * RATE : 0, span = lt - lf;
    for (let i = start; i < n; i++) {
      let pos = src + i * rate;
      if (loop && pos >= lt) pos = lf + ((pos - lf) % span);
      if (pos >= srcEnd - 1) break;
      const k = pos | 0, f = pos - k, k1 = k + 1 < p.len ? k + 1 : k;
      let g = vol;
      if (i < fi) g *= i / fi;
      if (fo && i > n - fo) g *= (n - i) / fo;
      if (env) g *= env((i0 + i) / RATE);
      const j = i0 + i;
      this.l[j] += (p.l[k] + (p.l[k1] - p.l[k]) * f) * g * gl;
      this.r[j] += (p.r[k] + (p.r[k1] - p.r[k]) * f) * g * gr;
    }
  }
}

/** Write the mix as a stereo 32-bit float WAV (ffmpeg reads it as pcm_f32le). */
export function writeWav(file, mix) {
  const n = mix.n, inter = new Float32Array(n * 2), head = Buffer.alloc(58);
  for (let i = 0; i < n; i++) { inter[2 * i] = mix.l[i]; inter[2 * i + 1] = mix.r[i]; }
  const data = Buffer.from(inter.buffer); // (little-endian floats, as the WAV wants them)
  head.write('RIFF', 0); head.writeUInt32LE(50 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(18, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 8, 28); head.writeUInt16LE(8, 32); head.writeUInt16LE(32, 34); head.writeUInt16LE(0, 36);
  head.write('fact', 38); head.writeUInt32LE(4, 42); head.writeUInt32LE(n, 46);
  head.write('data', 50); head.writeUInt32LE(data.length, 54);
  writeFileSync(file, Buffer.concat([head, data]));
}

/** Render a soundtrack plan (film-audio.mjs planSoundtrack) to a Mix of the film's length. */
export function renderPlan(plan, bank, { log = () => {} } = {}) {
  const mix = new Mix(plan.V);
  const M = plan.music;
  const endFade = 1.0;
  const clip = (c, extra) => { // a music cue from `offset` for as long as it lasts
    const q = bank.cue(c.cue);
    mix.add(q, c.at, { vol: c.vol, from: c.offset || 0, ...extra });
  };
  if (M.stinger) clip({ ...M.stinger }, {});
  for (const c of M.chain) {
    const natural = c.at + bank.cue(c.cue).len / RATE - (c.offset || 0); // where the file ends (its tail decays into the next segment)
    clip(c, { env: M.tension, until: Math.min(M.musicEnd + endFade, natural), fadeOut: natural > M.musicEnd ? endFade : 0 }); // (the end of the mission fades the score over a second)
  }
  log(`music: ${M.stinger ? M.stinger.cue + ' + ' : ''}${M.chain.length} chain segments, ${M.alert.length} alert intervals, success ${M.success?.cue ?? '-'}`);
  for (const a of M.alert) { // the alert layer: its intro, then the body round and round; in on the bar line, out over two bars
    const q = bank.cue('mission_alert'), meta = q.meta;
    mix.add(q, a.on, { vol: a.vol, loop: { from: meta.loopStart, to: meta.loopEnd }, until: Math.min(a.off + 2 * M.bar + 0.1, M.musicEnd + endFade), fadeIn: 0.08, fadeOut: Math.min(2 * M.bar, M.musicEnd + endFade - a.off) });
  }
  if (M.success) clip(M.success, {});
  let n = 0;
  for (const b of plan.beds) { // looped beds: the wind, the river… (a bed with `env` follows the view; fades at its ends)
    mix.add(bank.bed(b.src), b.at, { vol: b.vol, rate: b.rate, until: b.until, fadeIn: b.fadeIn, fadeOut: b.fadeOut, loop: { from: 0, to: bank.bed(b.src).len / RATE }, env: b.env });
    n++;
  }
  for (const s of plan.shots) { mix.add(bank.pcm(s.src), s.at, { vol: s.vol, pan: s.pan, rate: s.rate }); n++; }
  for (const s of plan.ticks) { mix.add(bank.pcm(s.src), s.at, { vol: s.vol, pan: s.pan }); n++; }
  for (const l of plan.loops) {
    const p = bank.pcm(l.src);
    mix.add(p, l.at, { vol: l.vol, rate: l.rate, until: l.until, fadeIn: l.fadeIn, fadeOut: l.fadeOut, from: l.randomOffset ? ((l.at * 7.31) % 1) * p.len / RATE * 0.5 : 0, loop: { from: 0, to: p.len / RATE } });
    n++;
  }
  for (const s of plan.sirens) { // the alarm's siren: loud at first, fading to nothing as the game's own does
    const p = bank.pcm(s.src);
    mix.add(p, s.at, { vol: s.vol, until: s.until, fadeOut: s.fadeOut, loop: { from: 0, to: p.len / RATE }, env: [[s.at, 1], [s.until, 0.05]] });
    n++;
  }
  log(`${n} sounds placed (${plan.shots.length} one-shots, ${plan.beds.length} beds, ${plan.loops.length} loops, ${plan.ticks.length} ticks, ${plan.sirens.length} sirens)`);
  return mix;
}

export const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
