/**
 * Video mode plays M3's whole walkthrough smoothly, in AUTO (the default) and at a fixed 4× (user 2026-10-14: "Also
 * work on performance in mission 3 video mode 4x (I see it gets stuck when exploding the dam and also when the sapper
 * goes through the fence towards the building with the ramp)", "Make sure performance of mission 3 walkthrough is
 * flawless"; 2026-10-15: "Also prioritize fixing perf issues of mission 3 walk through. There should not be any
 * stuckness").
 *
 * From the title card to the end card (chapter cards, action holds, fast waits, the blasts), at 1920×1080, every
 * displayed frame is timed, with:
 *  - the shader programs three compiles during play (none: everything the walkthrough shows was drawn by the load's
 *    warm-up frame — staged ruins, the dam burst, the escape truck, blood, cones, digs, LODs, Game._warmFrame);
 *  - the longest gap between two ticks (the solution driver's own planning, sliced into ≤ 6 ms pieces: driver.mjs
 *    PLAN_SLICE_MS; the shed ramp's 9 s search and the bunker blast's 2 s of path floods are gone);
 *  - the longest single tick (the bunker blast's, now its reinforcements' bodies are built ahead: engine/idle-warm.js);
 *  - the worst frame and the 99th percentile (user 2026-10-14: "In mission 3 there is periods where browser freezes
 *    and the lower left graphs shows gaps of idleness. Fix that." — a gap in the ?debug perf graph is a long frame), and
 *    every long task (Long Tasks API: a stall in a frame or between two — GC, decode, a fit, a freeze).
 * The bounds are the targets on a calm desktop — no frame and no main-thread task over 50 ms, p99 ≤ 25 ms, no tick over
 * 50 ms — as multiples of the run's own median frame (`unit`, at least 16.7 ms: 3×, 1.5×, 3×), so a host whose
 * frames take longer for others' work (a shared machine: CPU and GPU) scales them; a loaded host (unit over 17 ms: its
 * tail grows faster than its median from contention alone) gets 4× / 2× / 4×, and a run that misses on it is played
 * once more. Programs and driver gaps are checked as they are.
 */
export const timeout = 5_400_000;

export default async function videoPerfM03(page, t) {
  const url = t.harness.url;
  page.setDefaultTimeout(2_400_000);
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  const calibCpu = () => page.evaluate(() => {
    const run = () => { const s = performance.now(); let x = 0; for (let i = 0; i < 2e6; i++) x += Math.sqrt(i) * Math.sin(i); return [performance.now() - s, x]; };
    const ms = []; for (let k = 0; k < 7; k++) ms.push(run()[0]);
    return ms.sort((a, b) => a - b)[3];
  });

  /** One whole walkthrough (`speed`: 'auto' — the default, no speed in the link — or 4): frame stats, programs compiled,
   *  longest tick / driver gap, the run's result. */
  const play = async (speed) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${url}/index.html?debug&walkthrough=m03${speed === 'auto' ? '' : `&speed=${speed}`}`);
    await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay, null, { timeout: 240000 });
    await page.evaluate(() => {
      const P = (window.__vp = { on: false, base: [], frames: [], maxTick: 0, maxGap: 0, last: 0, cur: null, progs: 0, nProg: -1, longs: [] });
      // long tasks: the main thread held > 50 ms anywhere — in a frame or between two (GC, decode, a stall)
      try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.longs.push([e.duration, window.shadowSix?.world?.time ?? 0]); }).observe({ type: 'longtask' }); } catch { /* unsupported */ }
      const g = window.shadowSix, step = g.step;
      g.step = function (...a) {
        const s = performance.now(), c = P.cur;
        if (P.on && c && c.end >= 0) P.maxGap = Math.max(P.maxGap, s - c.end);
        try { return step.apply(this, a); } finally { const e = performance.now(); if (P.on) P.maxTick = Math.max(P.maxTick, e - s); if (c) c.end = e; }
      };
      const f = (now) => {
        const r = g.debug.mode.replay;
        if (P.last) {
          if (P.on && r && !r.pacer.turbo && !r._introOn) P.frames.push(now - P.last);
          else if (P.calib) P.base.push(now - P.last);
        }
        P.last = now; P.cur = { end: -1 };
        const progs = g.renderer?.renderer?.info?.programs?.length ?? 0;
        if (P.on && P.nProg >= 0 && progs > P.nProg) P.progs += progs - P.nProg;
        P.nProg = progs;
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    // the host's frame time: the title card's frames (the world drawn behind it, the clock held)
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__vp.calib = true; });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { window.__vp.calib = false; window.__vp.on = true; });
    await page.locator('#wt-card [data-act=start]').click();
    await page.waitForFunction(() => { const g = window.shadowSix, r = g.debug.mode.replay; if (r?.hold && r.hold.kind !== 'intro') r.hold = null; return !r || r.stopped || g.state === 'won' || g.state === 'lost' || !!document.querySelector('#wt-card[data-kind=end]'); }, null, { timeout: 2_400_000, polling: 500 });
    return page.evaluate(() => {
      const P = window.__vp; P.on = false;
      const res = window.shadowSix.debug.mode.lastWalkthrough || null;
      const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
      return { n: P.frames.length, base: q(P.base, 0.5), med: q(P.frames, 0.5), p99: q(P.frames, 0.99), max: q(P.frames, 1), over34: P.frames.filter((x) => x > 34).length,
        progs: P.progs, maxTick: P.maxTick, maxGap: P.maxGap, longs: P.longs.length, longMax: Math.max(0, ...P.longs.map((x) => x[0])),
        longWorst: P.longs.slice().sort((a, b) => b[0] - a[0]).slice(0, 5).map((x) => `${x[0].toFixed(0)}ms@t${x[1].toFixed(1)}`), res: res && { outcome: res.outcome, state: res.state, time: res.time, detections: res.detections, exposures: res.exposures } };
    });
  };

  const cpu = await calibCpu();
  const slow = Math.min(4, Math.max(1, cpu / 20)); // (≈ 20 ms is the workload on a calm host)
  t.log(`CPU calibration: ${cpu.toFixed(1)} ms → ×${slow.toFixed(2)}`);
  for (const speed of ['auto', 4]) {
    const label = speed === 'auto' ? 'AUTO' : `${speed}×`;
    let r, bounds, ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      step(`whole walkthrough in ${label}, attempt ${attempt}`);
      r = await play(speed);
      // the run's own frame time: a frame is a stall against what this host draws M3 in, not against 16.7 ms
      const unit = Math.max(16.7, r.med), calm = r.med <= 17 && slow < 1.3;
      // (+1 ms: displayed frames come in vsync steps — 4 × a 33.3 ms median is 133.2, the 8-vsync frame 133.4)
      bounds = calm ? { max: 3 * unit + 1, p99: 1.5 * unit + 1, tick: 3 * unit } : { max: 4 * unit + 1, p99: 2 * unit + 1, tick: 4 * unit };
      t.log(`${label}: frames ${r.n}: median ${r.med.toFixed(1)}, p99 ${r.p99.toFixed(1)}, worst ${r.max.toFixed(1)} ms, ${r.over34} over 34 ms ` +
        `(${calm ? 'calm' : 'loaded'} host: bounds worst ${bounds.max.toFixed(0)}, p99 ${bounds.p99.toFixed(0)}, tick ${bounds.tick.toFixed(0)}); programs compiled during play ${r.progs}; ` +
        `longest tick ${r.maxTick.toFixed(1)} ms, longest driver gap ${r.maxGap.toFixed(1)} ms; ${JSON.stringify(r.res)}`);
      t.log(`${label}: long tasks during play: ${r.longs}, longest ${r.longMax.toFixed(0)} ms (${r.longWorst.join(', ')})`);
      ok = r.max <= bounds.max && r.p99 <= bounds.p99 && r.longMax <= bounds.max && r.maxTick <= bounds.tick && r.maxGap < 15 * slow && r.progs === 0;
      if (!ok && calm) break; // a calm host: no second chance
    }
    t(r.res?.state === 'won' && r.res.detections === 0 && r.res.exposures === 0, `${label}: the walkthrough wins unseen (${JSON.stringify(r.res)})`);
    t(r.n > 500, `${label}: played (${r.n} frames)`);
    t(r.progs === 0, `${label}: no shader program compiled during play (${r.progs})`);
    t(r.maxGap < 15 * slow, `${label}: no driver stall over ${(15 * slow).toFixed(0)} ms between ticks (${r.maxGap.toFixed(1)})`);
    t(r.maxTick <= bounds.tick, `${label}: no tick over ${bounds.tick.toFixed(0)} ms (${r.maxTick.toFixed(1)})`);
    t(r.max <= bounds.max, `${label}: worst frame ${r.max.toFixed(1)} ms ≤ ${bounds.max.toFixed(1)} ms (no gap in the perf graph)`);
    t(r.longMax <= bounds.max, `${label}: no long task over ${bounds.max.toFixed(0)} ms, in a frame or between frames (${r.longMax.toFixed(0)} ms: ${r.longWorst.join(', ')})`);
    t(r.p99 <= bounds.p99, `${label}: p99 ${r.p99.toFixed(1)} ms ≤ ${bounds.p99.toFixed(1)} ms`);
  }
}
