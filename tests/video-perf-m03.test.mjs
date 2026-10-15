/**
 * Video mode plays M3's whole walkthrough smoothly at 4× (user 2026-10-14: "Also work on performance in mission 3 video
 * mode 4x (I see it gets stuck when exploding the dam and also when the sapper goes through the fence towards the
 * building with the ramp)" and "Make sure performance of mission 3 walkthrough is flawless").
 *
 * From the title card to the end card at a fixed 4×, every displayed frame is timed, with:
 *  - the shader programs three compiles during play (none: everything the walkthrough shows was drawn by the load's
 *    warm-up frame — staged ruins, the dam burst, the escape truck, blood, cones, digs, LODs, Game._warmFrame);
 *  - the longest gap between two ticks (the solution driver's own planning, sliced into ≤ 6 ms pieces: driver.mjs
 *    PLAN_SLICE_MS; the shed ramp's 9 s search and the bunker blast's 2 s of path floods are gone);
 *  - the longest single tick (the bunker blast now);
 *  - the worst frame and the 99th percentile against the run's own median frame (user 2026-10-14: "In mission 3 there is
 *    periods where browser freezes and the lower left graphs shows gaps of idleness. Fix that." — a gap in the ?debug
 *    perf graph is a long frame), and every long task (Long Tasks API: GC, decode or a stall between frames too).
 * Calibrated, so a loaded shared host (other processes on the CPU and the GPU) does not fail it while a stall still
 * does: the bounds are multiples of the run's own median frame (`unit`, at least 16.7 ms: a calm desktop draws M3 at
 * 60 fps → worst frame and long task ≤ 133 ms, p99 ≤ 50 ms, tick ≤ 67 ms; master froze for 30-45 s here), the driver
 * gap scales with a fixed JS workload; a run that misses on a slowed host is played once more.
 */
export const timeout = 3_600_000;

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

  /** One whole walkthrough at 4×: frame stats, programs compiled, longest tick / driver gap, the run's result. */
  const play = async () => {
    await page.goto(`${url}/index.html?debug&walkthrough=m03&speed=4`);
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
  let r, bounds, ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    step(`whole walkthrough at 4×, attempt ${attempt}`);
    r = await play();
    // the run's own frame time: a frame is a stall against what this host draws M3 in, not against 16.7 ms
    const unit = Math.max(16.7, r.med);
    // (a busy host's tail grows faster than its median: 4.5x the median at load 33, 6.7x at load 50, from other
    // processes alone — the stalls this guards against were 30-45 s; programs, driver gaps and ticks are checked apart)
    bounds = { max: 8 * unit, p99: 3 * unit, tick: 4 * unit };
    t.log(`frames ${r.n}: median ${r.med.toFixed(1)}, p99 ${r.p99.toFixed(1)}, worst ${r.max.toFixed(1)} ms, ${r.over34} over 34 ms (title card ${r.base.toFixed(1)} ms; ` +
      `bounds worst ${bounds.max.toFixed(0)}, p99 ${bounds.p99.toFixed(0)}, tick ${bounds.tick.toFixed(0)}); programs compiled during play ${r.progs}; ` +
      `longest tick ${r.maxTick.toFixed(1)} ms, longest driver gap ${r.maxGap.toFixed(1)} ms; ${JSON.stringify(r.res)}`);
    t.log(`long tasks during play: ${r.longs}, longest ${r.longMax.toFixed(0)} ms (${r.longWorst.join(', ')})`);
    ok = r.max <= bounds.max && r.p99 <= bounds.p99 && r.longMax <= bounds.max && r.maxTick <= bounds.tick && r.maxGap < 15 * slow;
    if (!ok && r.med <= 17 && slow < 1.3) break; // a calm host: no second chance
  }
  t(r.res?.state === 'won' && r.res.detections === 0 && r.res.exposures === 0, `the walkthrough wins unseen (${JSON.stringify(r.res)})`);
  t(r.n > 500, `played at 4× (${r.n} frames)`);
  t(r.progs === 0, `no shader program compiled during play (${r.progs})`);
  t(r.maxGap < 15 * slow, `no driver stall over ${(15 * slow).toFixed(0)} ms between ticks (${r.maxGap.toFixed(1)})`);
  t(r.maxTick <= bounds.tick, `no tick over ${bounds.tick.toFixed(0)} ms (${r.maxTick.toFixed(1)})`);
  t(r.max <= bounds.max, `worst frame ${r.max.toFixed(1)} ms ≤ ${bounds.max.toFixed(1)} ms (no gap in the perf graph)`);
  t(r.longMax <= bounds.max, `no long task over ${bounds.max.toFixed(0)} ms, in a frame or between frames (${r.longMax.toFixed(0)} ms: ${r.longWorst.join(', ')})`);
  t(r.p99 <= bounds.p99, `p99 ${r.p99.toFixed(1)} ms ≤ ${bounds.p99.toFixed(1)} ms`);
}
