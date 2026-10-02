/**
 * "There is some vibrating sound when doing the missions" (user report, 2026-10-01). Records the real WebAudio output
 * in Chromium (AudioWorklet taps on the engine's busses) and fails on the two causes found:
 *  A) the briefing's 16 mm projector bed (a looped UI sound: 96 Hz hum + noise chopped at 24 Hz) was never stopped and
 *     buzzed under the whole mission. Now: it plays under briefing part 1, the UI bus is silent once the mission plays,
 *     and the non-music mix shows no steady amplitude-modulation line between 15 and 80 Hz.
 *  B) per-frame re-spatialization stepped gain / pan / cutoff (zipper sidebands at the frame / render-callback rate on
 *     every moving loop). Now: a 1 kHz probe loop 8 m off the view centre while the camera glides keeps its sidebands
 *     (1 kHz ± 15–250 Hz) far below the carrier.
 */
export const timeout = 120000;

/** In-page helpers: an AudioWorklet tap (channel 0) and the two analyses. */
async function install(page) {
  await page.evaluate(async () => {
    const a = window.__game.game.audio;
    a.unlock();
    await a.engine.ready;
    const ctx = a.engine.ctx;
    const code = `class Tap extends AudioWorkletProcessor {
      constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; }; }
      process(inputs) { const c = inputs[0] && inputs[0][0]; if (this.on) this.port.postMessage(c ? c.slice(0) : new Float32Array(128)); return this.on; }
    }
    registerProcessor('buzz-tap', Tap);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    window.__buzz = {
      sr: ctx.sampleRate,
      /** Record channel 0 of `nodes` (summed) from now on. @returns {{stop: () => Float32Array}} */
      tap(nodes) {
        const node = new AudioWorkletNode(ctx, 'buzz-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const chunks = [];
        node.port.onmessage = (e) => chunks.push(e.data);
        for (const n of nodes) n.connect(node);
        node.connect(sink);
        return {
          stop() {
            node.port.postMessage('stop');
            for (const n of nodes) { try { n.disconnect(node); } catch { /* gone */ } }
            const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
            let o = 0;
            for (const c of chunks) { out.set(c, o); o += c.length; }
            return out;
          },
        };
      },
      rmsDb(x) { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / Math.max(1, x.length) + 1e-30); },
      fft(re, im) { // in-place radix-2
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
              const a = i + k, b = a + len / 2;
              const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
              re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
              const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
            }
          }
        }
      },
      /**
       * Envelope modulation spectrum: |x| averaged to 1 kHz, 1.024 s Hann windows (hop 0.512 s), depth = |FFT| / DC,
       * averaged over windows. Returns the strongest 15–80 Hz line and its prominence over the band median.
       */
      amLine(x) {
        const dec = Math.round(this.sr / 1000), env = new Float64Array(Math.floor(x.length / dec));
        for (let i = 0; i < env.length; i++) { let s = 0; for (let k = 0; k < dec; k++) s += Math.abs(x[i * dec + k]); env[i] = s / dec; }
        const N = 1024, hop = 512, acc = new Float64Array(N / 2);
        let wins = 0;
        for (let s = 0; s + N <= env.length; s += hop) {
          let dc = 0; for (let i = 0; i < N; i++) dc += env[s + i];
          dc /= N;
          if (!(dc > 1e-6)) continue;
          const re = new Float64Array(N), im = new Float64Array(N);
          let wsum = 0;
          for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); wsum += w; re[i] = (env[s + i] - dc) * w; }
          this.fft(re, im);
          for (let k = 0; k < N / 2; k++) acc[k] += Math.hypot(re[k], im[k]) / (wsum / 2) / dc;
          wins++;
        }
        const df = 1000 / N, band = [];
        for (let k = Math.ceil(15 / df); k <= Math.floor(80 / df); k++) band.push([k * df, acc[k] / Math.max(1, wins)]);
        const sorted = band.map((b) => b[1]).sort((p, q) => p - q), med = sorted[sorted.length >> 1] || 1e-9;
        const top = band.reduce((m, b) => (b[1] > m[1] ? b : m), [0, 0]);
        return { hz: +top[0].toFixed(1), depth: +top[1].toFixed(4), prominence: +(top[1] / med).toFixed(2), wins };
      },
      /** Energy within carrier ± (15…250) Hz relative to the carrier (±3 Hz), dB. */
      sidebandsDb(x, carrier = 1000) {
        let n = 1; while (n * 2 <= x.length) n *= 2;
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
        this.fft(re, im);
        const df = this.sr / n;
        let car = 0, side = 0;
        for (let k = 0; k < n / 2; k++) {
          const f = k * df, d = Math.abs(f - carrier), p = re[k] * re[k] + im[k] * im[k];
          if (d <= 3) car += p; else if (d >= 15 && d <= 250) side += p;
        }
        return +(10 * Math.log10(side / car)).toFixed(1);
      },
    };
  });
}

export default async function audioBuzz(page, t) {
  await page.keyboard.press('Shift'); // first gesture → unlock
  await install(page);

  // A) briefing part 1: the projector bed is up (intended) ------------------------------------------------------------
  const brief = await page.evaluate(async () => {
    const g = window.__game, a = g.game.audio;
    await g.loadMission('m01');
    window.__uiTap = window.__buzz.tap([a.engine.bus.ui]);
    return { state: g.game.state, projector: a.loops.has('ui:projector') };
  });
  t.equal(brief.state, 'briefing', 'loadMission opens the briefing');
  t.ok(brief.projector, 'the projector bed runs under briefing part 1 (menus-art-direction §1.8)');
  await page.waitForTimeout(1500);
  const briefUi = await page.evaluate(() => window.__buzz.rmsDb(window.__uiTap.stop()));
  t.ok(briefUi > -60, `projector audible under the briefing (UI bus ${briefUi.toFixed(1)} dBFS)`);

  // mission plays: the UI bus falls silent, the non-music mix carries no steady 15–80 Hz AM line ------------------------
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(1200); // the briefing's stop fade (0.4 s) and the mission-start safety fade (0.5 s)
  await page.evaluate(() => {
    const b = window.__game.game.audio.engine.bus;
    window.__uiTap = window.__buzz.tap([b.ui]);
    window.__mixTap = window.__buzz.tap([b.sfx, b.ambience, b.ui, b.voice]); // everything but the score
  });
  await page.waitForTimeout(4500);
  const mission = await page.evaluate(() => {
    const g = window.__game, a = g.game.audio, B = window.__buzz;
    const ui = B.rmsDb(window.__uiTap.stop()), mix = window.__mixTap.stop();
    const uiLoops = [...a.engine.active].filter((h) => h.bus === 'ui' && h.loop && !h.ended).map((h) => h.id);
    return { state: g.game.state, ui, mix: B.rmsDb(mix), am: B.amLine(mix), uiLoops, loops: [...a.loops.keys()] };
  });
  t.log(JSON.stringify(mission));
  t.equal(mission.state, 'playing');
  t.equal(mission.uiLoops.length, 0, `no looping UI-bus voice in the mission (${mission.uiLoops.join(', ')})`);
  t.ok(mission.ui < -100, `UI bus silent during the mission (${mission.ui.toFixed(1)} dBFS)`);
  t.ok(mission.mix > -70, `the mission's ambience is audible (${mission.mix.toFixed(1)} dBFS): the AM check measures something`);
  t.ok(mission.am.prominence < 2.5, // the projector measured 24.4 Hz, 4.5× the median; wind alone ≈ 1.6×
    `no steady low-frequency AM (vibration) in the non-music mix: strongest 15–80 Hz line ${mission.am.hz} Hz, depth ${(mission.am.depth * 100).toFixed(1)} %, ${mission.am.prominence}× the band median`);

  // B) zipper: a 1 kHz probe 8 m off the view centre while the camera glides --------------------------------------------
  const zip = await page.evaluate(async () => {
    const g = window.__game, a = g.game.audio, e = a.engine, ctx = e.ctx, cc = g.game.cameraController;
    const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr, sr), d = buf.getChannelData(0);
    for (let i = 0; i < sr; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr); // exactly 1000 cycles: seamless loop
    const s = { x: cc.target.x, z: cc.target.z };
    const h = e.play('probe_tone', { buffer: buf, loop: true, bus: 'sfx', pos: { x: s.x + 8, z: s.z }, cls: 'small', range: 400 });
    await new Promise((r) => setTimeout(r, 400));
    const tap = window.__buzz.tap([h.panNode]);
    await new Promise((res) => {
      const t0 = performance.now();
      const f = (now) => {
        const tt = (now - t0) / 1000;
        if (tt > 3.2) return res();
        cc.centerOn(s.x + 8 * Math.sin(tt * 1.3), s.z); // the game's frame loop re-spatializes from the camera target
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    const x = tap.stop();
    h.stop(0.05);
    return { n: x.length, side: window.__buzz.sidebandsDb(x), fps: +g.game.fps.toFixed(0) };
  });
  t.log(JSON.stringify(zip));
  t.ok(zip.n > 48000 * 2.5, `probe recorded (${zip.n} samples)`);
  t.ok(zip.side < -66, `camera glide: no zipper sidebands on a moving source (${zip.side} dB re carrier; the stepped automation measured ≈ −59 dB, glides ≈ −75 dB)`);
}
