/**
 * "The wind sound is too intense as if in a terror movie, can you make it more subtle" (user report, 2026-10-02).
 * Records the real WebAudio output of M1 (snow) in Chromium — AudioWorklet taps on the wind bed's gain node and the
 * music bus while the in-mission tension score plays — and fails on what made it a horror soundtrack:
 *  A) level: the recorded wind bed sat ≈ 8 dB OVER the music bed (K-weighted); now ≈ 13 dB under its integrated level
 *     (≥ 6 dB in any 8 s window, which also hears the score's phrasing and the bed's slow breathing),
 *  B) howling: narrow resonances gliding 450–2600 Hz (time-local tone prominence p90 ≈ 13.6 dB, long-term peak 4.8 dB;
 *     a broadband bed reads ≈ 6 / < 2 dB) — now no narrowband tone stands out,
 *  C) swells out of silence: the old take's 100 ms envelope spanned 66 dB (p5–p95) — now a few dB,
 *  D) the gust whoosh (peaked at a footstep's level on the coast) stays ≥ 15 dB under a footstep at the view centre.
 */
export const timeout = 120000;

async function install(page) {
  await page.evaluate(async () => {
    const a = window.__game.game.audio;
    a.unlock();
    await a.engine.ready;
    const ctx = a.engine.ctx;
    const code = `class Tap extends AudioWorkletProcessor {
      constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; }; }
      process(inputs) {
        const i = inputs[0] || [], z = new Float32Array(128);
        if (this.on) this.port.postMessage([(i[0] || z).slice(0), (i[1] || i[0] || z).slice(0)]);
        return this.on;
      }
    }
    registerProcessor('wind-tap', Tap);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    const sr = ctx.sampleRate;
    /** In-place radix-2 FFT. */
    const fft = (re, im) => {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const p = i + k, q = p + len / 2;
            const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
            re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
            const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
          }
        }
      }
    };
    /** BS.1770 K-weighting biquads at the context rate (shelf + RLB high-pass). */
    const kCoefs = () => {
      let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196;
      const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
      let a0 = 1 + K / Q + K * K;
      const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
      K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
      const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
      return [s1, s2];
    };
    const biquad = (x, { b, a }) => {
      const y = new Float64Array(x.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
      }
      return y;
    };
    window.__wind = {
      sr,
      /** Record `nodes` (summed, stereo) from now on. stop() → {L, R, mono} Float32Arrays. */
      tap(nodes) {
        const node = new AudioWorkletNode(ctx, 'wind-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
        const chunks = [];
        node.port.onmessage = (e) => chunks.push(e.data);
        for (const n of nodes) n.connect(node);
        node.connect(sink);
        return {
          stop() {
            node.port.postMessage('stop');
            for (const n of nodes) { try { n.disconnect(node); } catch { /* gone */ } }
            const len = chunks.reduce((s, c) => s + c[0].length, 0);
            const L = new Float32Array(len), R = new Float32Array(len), mono = new Float32Array(len);
            let o = 0;
            for (const [l, r] of chunks) { L.set(l, o); R.set(r, o); o += l.length; }
            for (let i = 0; i < len; i++) mono[i] = 0.5 * (L[i] + R[i]);
            return { L, R, mono };
          },
        };
      },
      /** Ungated BS.1770 loudness of a stereo recording {L, R} (K-weighted channel powers summed), LUFS. */
      lufs({ L, R }) {
        const skip = Math.round(0.05 * sr); // the filters' settling
        let ms = 0;
        for (const x of [L, R]) {
          let y = Float64Array.from(x);
          for (const s of kCoefs()) y = biquad(y, s);
          let e = 0;
          for (let i = skip; i < y.length; i++) e += y[i] * y[i];
          ms += e / Math.max(1, y.length - skip);
        }
        return -0.691 + 10 * Math.log10(ms + 1e-30);
      },
      /** 100 ms (or `win` s) RMS envelope, dB. */
      env(x, win = 0.1) {
        const k = Math.round(win * sr), out = [];
        for (let i = 0; i + k <= x.length; i += k) { let s = 0; for (let j = i; j < i + k; j++) s += x[j] * x[j]; out.push(10 * Math.log10(s / k + 1e-30)); }
        return out;
      },
      /**
       * Narrowband tone prominence 100–4000 Hz: 8192-pt Hann frames (hop 4096), each bin's dB over the mean dB of its
       * ±1/6-octave neighbourhood. `local`: per 5-frame (≈ 0.5 s) average, the strongest bin — p90 over time (a howl
       * that glides still stands out locally); `avg`: the long-term average spectrum's strongest bin.
       */
      tones(x) {
        const N = 8192, hop = 4096, frames = [];
        const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
        for (let s = 0; s + N <= x.length; s += hop) {
          const re = new Float64Array(N), im = new Float64Array(N);
          for (let i = 0; i < N; i++) re[i] = x[s + i] * win[i];
          fft(re, im);
          frames.push(Float64Array.from({ length: N / 2 }, (_, k) => re[k] * re[k] + im[k] * im[k] + 1e-24));
        }
        const df = sr / N, k0 = Math.ceil(100 / df), k1 = Math.floor(4000 / df);
        const prom = (P) => {
          const L = P.map((v) => 10 * Math.log10(v));
          const cs = new Float64Array(L.length + 1);
          for (let k = 0; k < L.length; k++) cs[k + 1] = cs[k] + L[k];
          let best = -99, hz = 0;
          for (let k = k0; k <= k1; k++) {
            const lo = Math.max(1, Math.floor(k / 2 ** (1 / 6))), hi = Math.min(L.length, Math.ceil(k * 2 ** (1 / 6)) + 1);
            const p = L[k] - (cs[hi] - cs[lo]) / (hi - lo);
            if (p > best) { best = p; hz = k * df; }
          }
          return [best, hz];
        };
        const local = [];
        for (let f = 0; f < frames.length; f++) {
          const sum = new Float64Array(N / 2);
          let n = 0;
          for (let g = Math.max(0, f - 2); g <= Math.min(frames.length - 1, f + 2); g++, n++) for (let k = 0; k < N / 2; k++) sum[k] += frames[g][k];
          local.push(prom(sum.map((v) => v / n))[0]);
        }
        local.sort((p, q) => p - q);
        const avg = new Float64Array(N / 2);
        for (const P of frames) for (let k = 0; k < N / 2; k++) avg[k] += P[k] / frames.length;
        const [ap, ahz] = prom(avg);
        return { localP90: +local[Math.floor(0.9 * (local.length - 1))].toFixed(2), avgPeak: +ap.toFixed(2), avgHz: Math.round(ahz), frames: frames.length };
      },
    };
  });
}

export default async function audioWind(page, t) {
  await page.keyboard.press('Shift'); // first gesture → unlock
  await install(page);
  const start = await page.evaluate(async () => {
    const g = window.__game, a = g.game.audio;
    await g.loadMission('m01');
    g.start();
    g.game.manualTick = false; // real time (the live site): the WindField moves the bed
    const c = g.game.world.commandos[0];
    g.game.cameraController.centerOn(c.x, c.z);
    return { state: g.game.state, theater: g.game.missionDef?.theater, ambience: a.ambience.map((l) => l.id) };
  });
  t.equal(start.state, 'playing');
  t.equal(start.theater, 'snow');
  t.ok(start.ambience.includes('wind_snow'), `snow wind bed (${start.ambience.join(', ')})`);

  // the start stinger hands over to the tension chain: measure once the first segment has sounded for a while
  await page.waitForFunction(() => {
    const d = window.__game.game.audio.musicDir;
    return d?.seg && d.now > d.seg.at + 1.5;
  }, null, { timeout: 40000, polling: 250 });
  await page.evaluate(() => {
    const a = window.__game.game.audio, l = a.ambience.find((x) => /^wind/.test(x.id));
    window.__bedInfo = { id: l.id, url: l.handle?.url || null, streamed: !!l.handle?.stream };
    window.__bedTap = window.__wind.tap([l.handle.gainNode]);
    window.__musicTap = window.__wind.tap([a.engine.bus.music]);
    window.__spell = []; // the WindField automation (wind-bed.js) during the window, dB
    window.__spellT = setInterval(() => window.__spell.push(a._wDb ?? 0), 100);
  });
  await page.waitForTimeout(8000);
  const lv = await page.evaluate(() => {
    clearInterval(window.__spellT);
    const W = window.__wind, a = window.__game.game.audio, bed = window.__bedTap.stop(), music = window.__musicTap.stop();
    const l = a.ambience.find((x) => /^wind/.test(x.id)), sp = window.__spell;
    const spell = 20 * Math.log10(sp.reduce((s, v) => s + 10 ** (v / 10), 0) / Math.max(1, sp.length)) / 2; // power mean, dB
    const env = W.env(bed.mono).sort((p, q) => p - q), q = (p) => env[Math.floor(p * (env.length - 1))];
    return { ...window.__bedInfo, n: bed.mono.length, bed: +W.lufs(bed).toFixed(1), music: +W.lufs(music).toFixed(1),
      spell: +spell.toFixed(2), design: +(-24 + 20 * Math.log10(l.gain)).toFixed(1), swing: +(q(0.95) - q(0.05)).toFixed(1), floor: +q(0.05).toFixed(1), tones: W.tones(bed.mono),
      seg: a.musicDir.seg?.id };
  });
  t.log(JSON.stringify(lv));
  t.ok(lv.n > 44100 * 5, `recorded ${lv.n} samples`);
  t.ok(/wind_cold/.test(lv.url || '') && lv.streamed, `the procedural cold-air bed streams (${lv.url})`);
  t.ok(lv.music > -45, `the tension score is playing (${lv.music} LUFS, ${lv.seg})`);
  // A) level
  // the bed renders at its design level (manifest `lufs` −24 + AMBIENCE gain) plus the WindField spell; ±3 dB: an 8 s
  // window of the bed itself drifts ±2 dB (its slow built-in breathing; the stream starts at a random point)
  t.near(lv.bed - lv.spell, lv.design, 3, `wind bed ${lv.bed} LUFS (spell ${lv.spell} dB) vs design ${lv.design} LUFS`);
  // design: 13 dB under the score's integrated level (manifest.js AMBIENCE). An 8 s window hears the score's phrasing
  // (tension_a opens ≈ 2 dB under its average), the bed's drift (±2 dB) and the wind's spell (≤ +2.5 dB): the bars are
  // 6 dB (without the spell) and 4 dB (as heard) — the recorded bed sat ≈ 8 dB OVER the score
  t.ok(lv.bed - lv.spell - lv.music <= -6, `wind bed level ${(lv.music - lv.bed + lv.spell).toFixed(1)} dB under the music bed (${lv.music} LUFS) before its spell`);
  t.ok(lv.bed - lv.music <= -4, `as heard (spell ${lv.spell} dB): ${(lv.music - lv.bed).toFixed(1)} dB under the music bed`);
  t.ok(lv.bed - lv.music >= -24, `…but still there (${(lv.bed - lv.music).toFixed(1)} dB)`);
  // B) no howl / whistle
  t.ok(lv.tones.localP90 < 9, `no narrowband howl: local tone prominence p90 ${lv.tones.localP90} dB (howling take 13.6, desert take 12.6)`);
  t.ok(lv.tones.avgPeak < 3.5, `no steady resonance: long-term peak ${lv.tones.avgPeak} dB at ${lv.tones.avgHz} Hz (howling take 4.8, desert take 7.8)`);
  // C) no swells out of silence
  t.ok(lv.swing < 8, `bed envelope p5–p95 ${lv.swing} dB (howling take 66 dB)`);

  // D) the strongest gust whoosh vs a footstep at the view centre
  const pk = await page.evaluate(async () => {
    const g = window.__game, a = g.game.audio, e = a.engine, W = window.__wind, w = g.game.world;
    const L = a.listener;
    const hs = {};
    const play = e.play.bind(e);
    e.play = (id, o) => { const h = play(id, o); if (h && (id === 'wind_gust' || /^step_/.test(id))) hs[id === 'wind_gust' ? 'gust' : 'step'] = h; return h; };
    a._gustAt = -1e9;
    w.events.emit('wind:gust', { x: L.x, z: L.z, gust: 1.2, speed: 16 });
    const gt = hs.gust && W.tap([hs.gust.panNode || hs.gust.gainNode]); // both measured after their panners
    await new Promise((r) => setTimeout(r, 2700));
    const gust = gt ? W.env(gt.stop().L, 0.05) : [-200];
    let step = [-200];
    for (let k = 0; k < 6 && step[0] === -200; k++) { // the snow footstep take decodes on first use
      a.playSfx('step_snow', { x: L.x, z: L.z }, { dedupe: 0 });
      if (hs.step) {
        const st = W.tap([hs.step.panNode || hs.step.gainNode]);
        await new Promise((r) => setTimeout(r, 600));
        step = W.env(st.stop().L, 0.05);
      } else await new Promise((r) => setTimeout(r, 300));
    }
    e.play = play;
    return { gust: +Math.max(...gust).toFixed(1), step: +Math.max(...step).toFixed(1), gustGain: hs.gust?.base ?? null };
  });
  t.log(JSON.stringify(pk));
  t.ok(pk.gustGain != null, 'a strong gust front plays the whoosh');
  t.ok(pk.step > -45, `footstep at the view recorded (${pk.step} dBFS)`);
  t.ok(pk.gust <= pk.step - 15, `strongest gust whoosh peaks at ${pk.gust} dBFS (50 ms RMS), ${(pk.step - pk.gust).toFixed(1)} dB under a footstep at the view (${pk.step})`);
}
