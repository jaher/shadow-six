/**
 * "Shout of the soldier when getting stabbed" (user request 2026-10-01), heard in the real game: the Green Beret knifes
 * the M0 fuel guard; an AudioWorklet tap on the engine's voice bus records what the player hears. Fails unless a
 * voice-band burst (250 Hz–4 kHz carrying most of the energy) starts within 0.3 s of the hit frame, it is the guard's own
 * recorded stab cry (german_<n>/pain/cry_stab_*), short and cut off (20 dB down within 0.35 s of its peak), and the kill stays
 * silent to the AI
 * (no noise event, no alarm). Screenshot stab-cry (the moment after the stab).
 */
export const timeout = 120000;

export default async function stabCry(page, t) {
  await page.keyboard.press('Shift'); // first gesture → AudioContext
  const setup = await page.evaluate(async () => {
    const g = window.__game, G = g.game, a = G.audio;
    a.unlock();
    await g.loadMission('m00');
    const w = G.world;
    for (const e of [...w.enemies]) if (e.tag !== 'guard_fuel') w.remove(e);
    const guard = w.enemies[0];
    guard.setPosition(16, 46, Math.PI); // faces west (-X), as tests/knife.test.mjs
    Object.assign(guard.post, { x: 16, z: 46, heading: Math.PI, scan: null });
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    gb.setPosition(22, 46, Math.PI);
    g.start();
    await G.mapHandle?.ready;
    await a.engine.ready;
    await a.preloading;
    a.options.laconic = true; a.director.laconic = true; // no "Leave him to me." on the voice bus while he walks up
    g.centerOn(guard.x, guard.z);
    g.setZoom(0.3);
    const S = (window.__sc = { guard, gb, noise: [], kill: null, cries: [] });
    w.events.on('noise', (n) => S.noise.push(n.kind));
    w.events.on('unit:killed', (e) => { if (e.unit === guard) S.kill = { ctx: a.engine.ctx.currentTime, sim: w.time }; });
    w.events.on('bark', (b) => { if (b.unit === guard) S.cries.push({ line: b.line, rec: b.rec, sub: b.subtitle, text: b.text }); });
    let stab = null;
    w.events.on('ability:start', (e) => { if (e.id === 'knife') stab = w.time; });
    const ok = g.useAbility(gb.id, 'knife', guard.id);
    for (let i = 0; i < 400 && stab == null; i++) g.step(); // walk up until the stab starts (the kill is 0.3 s later)
    return { ok, stab, decoded: a.engine.voiceRec.get('ger|cry_stab_1')?.map((tk) => a.engine.decoded.get(tk.url)?.duration ?? null) };
  });
  t.log(JSON.stringify(setup));
  t.ok(setup.ok !== false && setup.stab != null, 'knife order accepted, stab started');
  t.ok(setup.decoded?.every((d) => d > 0.2), `stab cries decoded for the mission (${setup.decoded})`);
  await page.waitForTimeout(1200); // let anything still sounding on the voice bus die away
  const r = await page.evaluate(async () => {
    const g = window.__game, a = g.game.audio, S = window.__sc, ctx = a.engine.ctx;
    const code = `class Tap extends AudioWorkletProcessor {
      constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; }; }
      process(inputs) { const c = inputs[0] && inputs[0][0]; if (this.on) this.port.postMessage({ t: currentTime, d: c ? c.slice(0) : new Float32Array(128) }); return this.on; }
    }
    registerProcessor('stabcry-tap', Tap);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const node = new AudioWorkletNode(ctx, 'stabcry-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const chunks = [];
    node.port.onmessage = (e) => chunks.push(e.data);
    const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
    a.engine.bus.voice.connect(node); node.connect(sink);
    g.setZoom(2); // zoomed in, the view (= the listener) can centre on him (zoomed out, M0's map edge clamps it 20 m off)
    g.centerOn(S.guard.x, S.guard.z); // the listener is the view centre: hear him up close
    for (let i = 0; i < 30; i++) g.game.render(1 / 60, 1); // let the camera settle (render → audio.update → listener)
    await new Promise((res) => setTimeout(res, 400)); // noise floor before the hit
    // the killer's quip ("Sleep tight.", deferred after the cry; tests/unit/stab-cry) would share the voice bus: muted here
    const bark0 = a._bark.bind(a);
    a._bark = (e) => (e?.line === 'act_kill' ? Object.assign(e, { suppressed: true }) && undefined : bark0(e));
    for (let i = 0; i < 120 && !S.kill; i++) g.step(); // to the hit frame (the kill tick)
    S.listener = { ...a.listener, guard: { x: S.guard.x, z: S.guard.z } };
    // which take plays: the guard's live voice handle → its decoded buffer → url
    const v = [...a.engine.active].find((h) => h.bus === 'voice' && h.id === 'voice:ger_cry_stab') || null;
    let url = null;
    for (const [u, b] of a.engine.decoded) if (v && b === v.src?.buffer) url = u;
    g.game.render(1 / 60, 1);
    await new Promise((res) => setTimeout(res, 1400));
    node.port.postMessage('stop');
    a.engine.bus.voice.disconnect(node);
    // analysis: 1024-pt frames, hop 10 ms; level (dBFS RMS) and the 250 Hz–4 kHz share of the energy
    const sr = ctx.sampleRate, t0 = chunks[0].t;
    const x = new Float32Array(chunks.length * 128);
    chunks.forEach((c, i) => x.set(c.d, i * 128));
    const N = 1024, hop = Math.round(sr * 0.01), frames = [];
    const re = new Float64Array(N), im = new Float64Array(N);
    const fft = () => {
      for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= N; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < N; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
            re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
            const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
          }
        }
      }
    };
    for (let s = 0; s + N <= x.length; s += hop) {
      let e = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re[i] = x[s + i] * w; im[i] = 0; e += x[s + i] * x[s + i]; }
      fft();
      let band = 0, all = 1e-30;
      for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k], f = k * sr / N; all += p; if (f >= 250 && f <= 4000) band += p; }
      const db = 10 * Math.log10(e / N + 1e-30);
      frames.push({ t: t0 + (s + N / 2) / sr, db, band: band / all, bandDb: db + 10 * Math.log10(band / all + 1e-30), bandE: band, allE: all });
    }
    const hit = S.kill.ctx;
    const before = frames.filter((f) => f.t < hit - 0.02);
    const floor = before.length ? Math.max(...before.map((f) => f.db)) : -200;
    // onset: the first frame whose 250 Hz–4 kHz energy alone is above -40 dBFS (a scream is bright: the share of a
    // single frame can dip under one half, so the voice-band share is asserted over the first 0.3 s of the burst)
    const onset = frames.find((f) => f.t >= hit - 0.02 && f.bandDb > -40);
    const head = onset ? frames.filter((f) => f.t >= onset.t && f.t <= onset.t + 0.3) : [];
    const share = head.reduce((a, f) => a + f.bandE, 0) / (head.reduce((a, f) => a + f.allE, 0) || 1);
    const win = frames.filter((f) => f.t >= hit && f.t <= hit + 0.8);
    const peak = Math.max(...win.map((f) => f.db));
    const pk = win.find((f) => f.db === peak);
    const gone = win.find((f) => f.t > pk.t && f.db < peak - 20); // the blade cuts him off: 20 dB down soon after the peak
    return {
      hit, tapStart: t0, floor: +floor.toFixed(1), onset: onset ? +(onset.t - hit).toFixed(3) : null, onsetBand: +share.toFixed(2),
      peak: +peak.toFixed(1), cutoff: gone ? +(gone.t - pk.t).toFixed(3) : null, len: v ? +v.duration.toFixed(3) : null,
      cries: S.cries, noise: S.noise, alarm: !!g.game.world.alarm?.active, alive: S.guard.alive, cause: S.guard.deathCause, url,
      voiceVol: a.volumes.voice, voiceBus: +a.engine.bus.voice.gain.value.toFixed(3), listener: S.listener,
      gain: v ? +(v.applied?.gain ?? 0).toFixed(3) : null,
    };
  });
  t.log(JSON.stringify(r));
  t.ok(!r.alive && r.cause === 'knife', 'guard knifed');
  const cry = r.cries.find((c) => c.line === 'ger_cry_stab');
  t.ok(cry && /^cry_stab_[1-4]$/.test(cry.rec), `stab cry requested in the guard's voice (${JSON.stringify(r.cries)})`);
  t.ok(cry && cry.sub === false && cry.text === '', 'no subtitle for the cry');
  t.ok(/voice\/german_[123]\/pain\/cry_stab_[1-4]\.(ogg|mp3)$/.test(r.url || ''), `recorded take played (${r.url})`);
  t.ok(r.floor < -60, `voice bus silent before the hit (${r.floor} dBFS)`);
  t.ok(r.onset != null && r.onset >= -0.02 && r.onset <= 0.3, `voice-band burst ${r.onset} s after the hit (≤ 0.3 s)`);
  t.ok(r.onsetBand > 0.45, `the burst is a voice: ${r.onsetBand} of its first 0.3 s in 250 Hz–4 kHz`);
  t.ok(r.gain > 0.8 && r.peak > -26, `cry loud on the voice bus next to the view centre (${r.peak} dBFS peak frame, spatial gain ${r.gain})`);
  t.ok(r.cutoff != null && r.cutoff <= 0.35, `cut off: 20 dB down ${r.cutoff} s after its loudest frame`);
  t.ok(r.len > 0.25 && r.len < 1, `a short cry (${r.len} s take)`);
  t.equal(r.noise.length, 0, 'no noise event: silent to the AI');
  t.ok(!r.alarm, 'no alarm');
  await t.shot('stab-cry');
}
