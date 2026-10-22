/**
 * Video-mode performance check for one mission's whole walkthrough (debug VIDEO MODE, ?debug&walkthrough=<id>), in
 * AUTO and at 4×: the body of tests/video-perf-m03.test.mjs (its comment gives the why and the bounds), for any
 * mission with a solution — tests/video-perf-mission.test.mjs runs it for VIDEO_PERF_MISSION. Besides the frame and
 * task bounds it reports the longest stretch of game time with no player order (user 2026-10-21: "Good FPS, no
 * delays, no long pauses").
 */
export async function videoPerf(page, t, mission = 'm03') {
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
    await page.goto(`${url}/index.html?debug&walkthrough=${mission}${speed === 'auto' ? '' : `&speed=${speed}`}`);
    await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay, null, { timeout: 240000 });
    await page.evaluate(() => {
      const P = (window.__vp = { on: false, base: [], frames: [], maxTick: 0, maxGap: 0, last: 0, cur: null, progs: 0, nProg: -1, longs: [], slow: [] });
      // long tasks: the main thread held > 50 ms anywhere — in a frame or between two (GC, decode, a stall)
      try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.longs.push([e.duration, window.shadowSix?.world?.time ?? 0]); }).observe({ type: 'longtask' }); } catch { /* unsupported */ }
      const g = window.shadowSix, step = g.step;
      // the longest stretch of game time with no player order (the play idling: user 2026-10-21 "no long pauses")
      P.orders = []; P.orderHook = setInterval(() => {
        const r = g.debug?.mode?.replay;
        if (!r || r.__vpHooked || typeof r._onOrder !== 'function') return;
        const f0 = r._onOrder.bind(r); r.__vpHooked = true;
        r._onOrder = (...a) => { if (P.on) P.orders.push(g.world?.time ?? 0); return f0(...a); };
      }, 50);
      g.step = function (...a) {
        const s = performance.now(), c = P.cur;
        if (P.on && c && c.end >= 0) P.maxGap = Math.max(P.maxGap, s - c.end);
        try { return step.apply(this, a); } finally { const e = performance.now(); if (P.on) P.maxTick = Math.max(P.maxTick, e - s); if (c) c.end = e; }
      };
      const f = (now) => {
        const r = g.debug.mode.replay;
        if (P.last) {
          if (P.on && r && !r.pacer.turbo && !r._introOn) { const d = now - P.last; P.frames.push(d); if (d > 50) P.slow.push([d, g.world?.time ?? 0]); }
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
      const P = window.__vp; P.on = false; clearInterval(P.orderHook);
      const os = P.orders, endT = window.shadowSix.world?.time ?? 0;
      let idle = 0, idleAt = 0; for (let k = 1; k <= os.length; k++) { const a = os[k - 1], b = k < os.length ? os[k] : endT; if (b - a > idle) { idle = b - a; idleAt = a; } }
      const res = window.shadowSix.debug.mode.lastWalkthrough || null;
      const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
      return { n: P.frames.length, base: q(P.base, 0.5), med: q(P.frames, 0.5), p99: q(P.frames, 0.99), max: q(P.frames, 1), over34: P.frames.filter((x) => x > 34).length,
        progs: P.progs, maxTick: P.maxTick, maxGap: P.maxGap, longs: P.longs.length, longMax: Math.max(0, ...P.longs.map((x) => x[0])),
        longWorst: P.longs.slice().sort((a, b) => b[0] - a[0]).slice(0, 5).map((x) => `${x[0].toFixed(0)}ms@t${x[1].toFixed(1)}`),
        slowWorst: P.slow.slice().sort((a, b) => b[0] - a[0]).slice(0, 5).map((x) => `${x[0].toFixed(0)}ms@t${x[1].toFixed(1)}`), orders: os.length, idle, idleAt, res: res && { outcome: res.outcome, state: res.state, time: res.time, detections: res.detections, exposures: res.exposures } };
    });
  };

  const cpu = await calibCpu();
  const slow = Math.min(4, Math.max(1, cpu / 20)); // (≈ 20 ms is the workload on a calm host)
  t.log(`CPU calibration: ${cpu.toFixed(1)} ms → ×${slow.toFixed(2)}`);
  // (VIDEO_PERF_SPEEDS=4 or =auto plays one of the two runs alone)
  const speeds = (process.env.VIDEO_PERF_SPEEDS || 'auto,4').split(',').map((s) => (s === 'auto' ? 'auto' : +s));
  for (const speed of speeds) {
    const label = speed === 'auto' ? 'AUTO' : `${speed}×`;
    let r, bounds, ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      step(`whole walkthrough in ${label}, attempt ${attempt}`);
      r = await play(speed);
      // the run's own frame time: a frame is a stall against what this host draws the mission in, not against 16.7 ms
      const unit = Math.max(16.7, r.med), calm = r.med <= 17 && slow < 1.3;
      // (+1 ms: displayed frames come in vsync steps — 4 × a 33.3 ms median is 133.2, the 8-vsync frame 133.4)
      bounds = calm ? { max: 3 * unit + 1, p99: 1.5 * unit + 1, tick: 3 * unit } : { max: 4 * unit + 1, p99: 2 * unit + 1, tick: 4 * unit };
      t.log(`${label}: frames ${r.n}: median ${r.med.toFixed(1)}, p99 ${r.p99.toFixed(1)}, worst ${r.max.toFixed(1)} ms, ${r.over34} over 34 ms ` +
        `(${calm ? 'calm' : 'loaded'} host: bounds worst ${bounds.max.toFixed(0)}, p99 ${bounds.p99.toFixed(0)}, tick ${bounds.tick.toFixed(0)}); programs compiled during play ${r.progs}; ` +
        `longest tick ${r.maxTick.toFixed(1)} ms, longest driver gap ${r.maxGap.toFixed(1)} ms; ${JSON.stringify(r.res)}`);
      t.log(`${label}: long tasks during play: ${r.longs}, longest ${r.longMax.toFixed(0)} ms (${r.longWorst.join(', ')}); slowest frames ${r.slowWorst.join(', ')}`);
      t.log(`${label}: ${r.orders} player orders; longest stretch with no order ${r.idle.toFixed(1)} s of game time (from t=${r.idleAt.toFixed(1)})`);
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
