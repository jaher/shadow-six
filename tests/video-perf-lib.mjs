/**
 * Video-mode performance check for one mission's whole walkthrough (debug VIDEO MODE, ?debug&walkthrough=<id>), in
 * AUTO and at 4×: the body of tests/video-perf-m03.test.mjs (its comment gives the why and the bounds), for any
 * mission with a solution — tests/video-perf-mission.test.mjs runs it for VIDEO_PERF_MISSION. Besides the frame and
 * task bounds it reports the longest stretch of game time with no player order (user 2026-10-21: "Good FPS, no
 * delays, no long pauses").
 *
 * OUR OWN WORK, whatever the host's load (2026-10-22: the wall-clock bounds above failed every run for days on this
 * shared host, master included — a frame slowed by another process's CPU and one slowed by our code look the same on
 * the clock): every Game.step and every displayed frame is bracketed by performance marks recorded in a CDP trace
 * (blink.user_timing), and each mark carries the main thread's own CPU clock (`tts`, thread time: it stops while the
 * thread waits or is descheduled). Per tick: the CPU the tick itself took. Per frame: the CPU from the game's frame start
 * to the end of the ticks it granted (the probe's rAF callback runs right after them): its draw, its ticks, the
 * driver's look-ahead between them. Two corrections make it a measure of the code, not of the host:
 *  - GC apart: a garbage collection that lands in a tick or a frame (trace category v8: MinorGC / MajorGC on this
 *    thread) is taken out of it and reported on its own (count, longest pause, total) — where it lands is chance;
 *  - fast-core ms: thread time still runs ~1.5× slower on this hybrid desktop's efficiency cores and under all-core
 *    clocks (frame CPU median 14.8 ms at load 11, 20.5 at load 20). Every 8th frame the probe times a fixed bit of
 *    arithmetic (thread time again); a tick or a frame is divided by the median of those within ±2 s against the run's
 *    fastest (5th percentile), never by more than CORE_MAX — an odd calibration beside a heavy frame must not hide it.
 * Bounds, in fast-core ms, GC apart, at 4× and in AUTO: no tick over OWN_TICK_MS (16 ms: the bunker blast took 25–55 ms
 * of a tick on master); frames' own work p99 ≤ OWN_FRAME_P99_MS (40 ms) and none over OWN_FRAME_MS (60 ms: no stall of
 * our own beyond ~3.5 frames). (33 ms a frame is not met at 1920×1080 on the high preset: the draw alone takes ~16–19
 * fast-core ms a frame on the median and 30–38 on the p99, master and branch alike.) The log adds the raw CPU, the
 * frame intervals, GC, and how many slow wall-clock frames had little own work (the host's, not ours).
 */
/** No tick's own main-thread work over this (fast-core ms, GC apart). */
export const OWN_TICK_MS = 16;
/** No displayed frame's own main-thread work (its draw + its ticks) over this (fast-core ms, GC apart). */
export const OWN_FRAME_MS = 60;
/** 99% of the displayed frames' own work under this (fast-core ms, GC apart). */
export const OWN_FRAME_P99_MS = 40;
/** The most a slow core's speed scales a tick or a frame by (this desktop: efficiency cores at 3.3 GHz against 4.6–5.7). */
export const CORE_MAX = 1.6;
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
    // own work: marks round every tick and frame in a trace (each carries the main thread's CPU clock, tts)
    const cdp = await page.context().newCDPSession(page);
    const own = traceOwnWork(cdp);
    await page.evaluate(() => {
      const P = (window.__vp = { on: false, base: [], frames: [], maxTick: 0, maxGap: 0, last: 0, cur: null, progs: 0, nProg: -1, longs: [], slow: [], ticks: 0 });
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
        if (P.on) { P.ticks++; performance.mark('S'); }
        try { return step.apply(this, a); } finally {
          const e = performance.now(); if (P.on) { P.maxTick = Math.max(P.maxTick, e - s); performance.mark(`E${(g.world?.time ?? 0).toFixed(2)}`); }
          if (c) c.end = e;
        }
      };
      // the game's frame starts with a mark (F: a frame of play, counted as `frames` below; f: intro / fast-forward)
      const wrapFrame = () => {
        const fr = g.frame;
        if (typeof fr !== 'function' || fr.__vp) return;
        const w = function (dt) { if (P.on) { const r = g.debug.mode.replay; performance.mark(r && !r.pacer.turbo && !r._introOn ? 'F' : 'f'); } return fr.call(this, dt); };
        w.__vp = 1; g.frame = w;
      };
      const f = (now) => {
        const r = g.debug.mode.replay;
        // (this callback runs after the game's frame and the ticks it granted: the end of the frame's own work)
        if (P.on) {
          performance.mark('D');
          // every 8th frame, a fixed bit of arithmetic between two marks: its CPU time says how fast the core this thread
          // runs on is just now (a hybrid desktop's efficiency cores, a contended one: the same code costs more CPU)
          if ((P.nf = (P.nf || 0) + 1) % 8 === 0) { performance.mark('C'); let x = 0; for (let i = 0; i < 20000; i++) x += Math.sqrt(i) * Math.sin(i); P.sink = x; performance.mark('c'); }
          performance.clearMarks();
        }
        wrapFrame();
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
    await own.start();
    await page.evaluate(() => { window.__vp.calib = false; window.__vp.on = true; });
    await page.locator('#wt-card [data-act=start]').click();
    await page.waitForFunction(() => { const g = window.shadowSix, r = g.debug.mode.replay; if (r?.hold && r.hold.kind !== 'intro') r.hold = null; return !r || r.stopped || g.state === 'won' || g.state === 'lost' || !!document.querySelector('#wt-card[data-kind=end]'); }, null, { timeout: 2_400_000, polling: 500 });
    const ticksRun = await page.evaluate(() => { window.__vp.on = false; return window.__vp.ticks; });
    const ow = await own.stop(ticksRun);
    await cdp.detach().catch(() => {});
    const r = await page.evaluate(() => {
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
    return { ...r, own: ow };
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
      const o = r.own;
      t.log(`${label}: OWN WORK (main-thread CPU in fast-core ms, GC apart; ${o.ticks}/${o.ticksRun} ticks and ${o.frames} frames traced, ${o.cycles} trace restarts; ` +
        `core speed: ${o.calib.n} calibrations, median ×${o.calib.p50.toFixed(2)}, p90 ×${o.calib.p90.toFixed(2)} of the fastest ${o.calib.ref.toFixed(3)} ms): ` +
        `tick max ${o.tickOwn.max.toFixed(1)} ms (p99 ${o.tickOwn.p99.toFixed(2)}, p99.9 ${o.tickOwn.p999.toFixed(2)}; ${o.ticksOver} over ${OWN_TICK_MS}: ${o.worstTicks.join(', ')}); ` +
        `frame median ${o.frameOwn.p50.toFixed(1)}, p99 ${o.frameOwn.p99.toFixed(1)}, p99.9 ${o.frameOwn.p999.toFixed(1)}, max ${o.frameOwn.max.toFixed(1)} ms (${o.frames33} over 33, ${o.framesOver} over ${OWN_FRAME_MS}: ${o.worstFrames.join(', ')}); ` +
        `raw CPU: tick max ${o.tick.max.toFixed(1)} (${o.worstTicksRaw.join(', ')}), frame median ${o.frame.p50.toFixed(1)}, p99 ${o.frame.p99.toFixed(1)}, max ${o.frame.max.toFixed(1)} (${o.worstFramesRaw.join(', ')}), ` +
        `frame interval p99 ${o.ival.p99.toFixed(1)}, max ${o.ival.max.toFixed(1)} ms; GC ${o.gc.total} ms (minor ${o.gc.minor} ≤ ${o.gc.minorMax} ms, major ${o.gc.major} ≤ ${o.gc.majorMax} ms); ` +
        `frames over 50 ms of wall clock: ${o.slowWall}, of which ${o.slowWallHost} with under 16 ms of own CPU (the host's, not ours)`);
      ok = r.max <= bounds.max && r.p99 <= bounds.p99 && r.longMax <= bounds.max && r.maxTick <= bounds.tick && r.maxGap < 15 * slow && r.progs === 0 &&
        o.tickOwn.max <= OWN_TICK_MS && o.frameOwn.max <= OWN_FRAME_MS && o.frameOwn.p99 <= OWN_FRAME_P99_MS;
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
    // our own work, load-independent (main-thread CPU, not wall clock)
    const o = r.own;
    t(o.ticks >= o.ticksRun * 0.99 && o.frames > 500, `${label}: own work traced (${o.ticks} of ${o.ticksRun} ticks, ${o.frames} frames)`);
    t(o.tickOwn.max <= OWN_TICK_MS, `${label}: no tick's own work over ${OWN_TICK_MS} ms of fast-core CPU (${o.tickOwn.max.toFixed(1)} ms: ${o.worstTicks.join(', ')})`);
    t(o.frameOwn.p99 <= OWN_FRAME_P99_MS, `${label}: frames' own work p99 ${o.frameOwn.p99.toFixed(1)} ≤ ${OWN_FRAME_P99_MS} ms of fast-core CPU`);
    t(o.frameOwn.max <= OWN_FRAME_MS, `${label}: no frame's own work over ${OWN_FRAME_MS} ms of fast-core CPU (${o.frameOwn.max.toFixed(1)} ms: ${o.worstFrames.join(', ')})`);
  }
}

/**
 * Own work from a CDP trace: start() before play, stop(ticksRun) after it. The page marks S / E<game time> round every
 * Game.step, F (or f: not a frame of play) at the game's frame start and D when that frame's ticks are done; each mark's
 * `tts` is the main thread's CPU clock (µs). Also the main thread's GC events (category v8). The trace buffer is
 * restarted if it fills (a mark pair across a restart is lost: `ticks` counts the ones measured).
 */
function traceOwnWork(cdp) {
  const marks = [], gcs = [];
  let usage = 0, complete = null, cycles = 0;
  cdp.on('Tracing.dataCollected', (d) => {
    for (const e of d.value) {
      if (e.ph === 'X' && (e.name === 'MinorGC' || e.name === 'MajorGC')) { gcs.push([e.ts, e.dur || 0, e.tdur ?? e.dur ?? 0, e.name, e.tid]); continue; }
      if (e.cat !== 'blink.user_timing' || (e.ph !== 'I' && e.ph !== 'R')) continue;
      const c = e.name[0];
      if (c === 'S' || c === 'E' || c === 'F' || c === 'f' || c === 'D' || c === 'C' || c === 'c') marks.push([c, e.ts, e.tts, c === 'E' ? +e.name.slice(1) : 0, e.tid]);
    }
  });
  cdp.on('Tracing.bufferUsage', (d) => { usage = d.percentFull ?? d.value ?? 0; });
  cdp.on('Tracing.tracingComplete', () => complete?.());
  const begin = () => cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['blink.user_timing', 'v8'], excludedCategories: ['*'] }, transferMode: 'ReportEvents', bufferUsageReportingInterval: 2000 });
  const end = async () => { const p = new Promise((ok) => { complete = ok; }); await cdp.send('Tracing.end'); await p; };
  let timer = null, busy = false;
  return {
    async start() {
      await begin();
      timer = setInterval(async () => { if (busy || usage < 0.8) return; busy = true; try { await end(); cycles++; usage = 0; await begin(); } finally { busy = false; } }, 1000);
    },
    async stop(ticksRun) {
      clearInterval(timer);
      while (busy) await new Promise((ok) => setTimeout(ok, 50));
      await end();
      marks.sort((a, b) => a[1] - b[1]);
      const tid = marks.length ? marks[0][4] : null;
      const gc = gcs.filter((g) => g[4] === tid).sort((a, b) => a[0] - b[0]);
      const gcIn = (a, b) => { let s = 0; for (const g of gc) { if (g[0] >= b) break; const e = g[0] + g[1]; if (e > a) s += g[2] * Math.min(1, (Math.min(b, e) - Math.max(a, g[0])) / Math.max(1, g[1])); } return s / 1000; };
      const ticks = [], frames = [], cal = [];
      let s = null, f = null, cs = null;
      for (const m of marks) {
        if (m[4] !== tid) continue;
        const [c, ts, tts, gt] = m;
        if (c === 'C') { cs = m; continue; }
        if (c === 'c') { if (cs) cal.push([cs[1], tts - cs[2]]); cs = null; continue; }
        if (c === 'S') s = m;
        else if (c === 'E') { if (s) ticks.push({ t: gt, cpu: (tts - s[2]) / 1000, a: s[1], b: ts }); s = null; }
        else if (c === 'F' || c === 'f') {
          if (f) { f.ival = (tts - f.tts) / 1000; f.dt = (ts - f.ts) / 1000; if (f.counted && f.cpu != null) frames.push(f); }
          f = { counted: c === 'F', ts, tts, t: ticks.length ? ticks[ticks.length - 1].t : 0, cpu: null };
        } else if (c === 'D' && f && f.cpu == null) { f.cpu = (tts - f.tts) / 1000; f.b = ts; }
      }
      const q = (a, p) => { const z = a.slice().sort((x, y) => x - y); return z.length ? z[Math.min(z.length - 1, Math.floor(z.length * p))] : 0; };
      const st = (a) => ({ p50: q(a, 0.5), p99: q(a, 0.99), p999: q(a, 0.999), max: q(a, 1) });
      // the core's speed through the run: each calibration's CPU against the run's fastest (5th percentile); a tick or a
      // frame is scaled by the median of the calibrations within ±2 s of it, between 1 (never sped up) and CORE_MAX (a
      // slow core's worth at most: one odd calibration next to a heavy frame must not hide it) — `own` = its CPU in
      // fast-core ms, GC pauses inside it left out (GC is reported on its own)
      const ref = q(cal.map((x) => x[1]), 0.05) || 1;
      const slowAt = (ts) => {
        let lo = 0, hi = cal.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cal[m][0] < ts - 2e6) lo = m + 1; else hi = m; }
        const near = []; for (let i = lo; i < cal.length && cal[i][0] <= ts + 2e6; i++) near.push(cal[i][1]);
        return near.length ? Math.min(CORE_MAX, Math.max(1, q(near, 0.5) / ref)) : 1;
      };
      for (const x of ticks) { x.gc = gcIn(x.a, x.b); x.k = slowAt(x.a); x.own = Math.max(0, x.cpu - x.gc) / x.k; }
      for (const x of frames) { x.gc = gcIn(x.ts, x.b); x.k = slowAt(x.ts); x.own = Math.max(0, x.cpu - x.gc) / x.k; }
      const fmt = (x, v) => `${v.toFixed(1)}${x.gc >= 0.5 ? ` (GC ${x.gc.toFixed(1)})` : ''}${x.k > 1.05 ? ` (core ×${x.k.toFixed(2)})` : ''}@t${x.t.toFixed(2)}`;
      const gcl = gc.map((g) => [g[3], g[2] / 1000]);
      return {
        ticksRun, ticks: ticks.length, frames: frames.length, cycles, calib: { n: cal.length, ref: ref / 1000, p50: q(cal.map((x) => x[1]), 0.5) / ref, p90: q(cal.map((x) => x[1]), 0.9) / ref },
        tick: st(ticks.map((x) => x.cpu)), frame: st(frames.map((x) => x.cpu)), ival: st(frames.filter((x) => x.ival != null).map((x) => x.ival)),
        tickOwn: st(ticks.map((x) => x.own)), frameOwn: st(frames.map((x) => x.own)),
        ticksOver: ticks.filter((x) => x.own > OWN_TICK_MS).length, framesOver: frames.filter((x) => x.own > OWN_FRAME_MS).length, frames33: frames.filter((x) => x.own > 33).length,
        worstTicks: ticks.slice().sort((a, b) => b.own - a.own).slice(0, 5).map((x) => fmt(x, x.own)),
        worstFrames: frames.slice().sort((a, b) => b.own - a.own).slice(0, 5).map((x) => fmt(x, x.own)),
        worstTicksRaw: ticks.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 3).map((x) => fmt(x, x.cpu)),
        worstFramesRaw: frames.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 3).map((x) => fmt(x, x.cpu)),
        gc: { total: +gcl.reduce((a, g) => a + g[1], 0).toFixed(0), minor: gcl.filter((g) => g[0] === 'MinorGC').length, minorMax: +Math.max(0, ...gcl.filter((g) => g[0] === 'MinorGC').map((g) => g[1])).toFixed(1),
          major: gcl.filter((g) => g[0] === 'MajorGC').length, majorMax: +Math.max(0, ...gcl.filter((g) => g[0] === 'MajorGC').map((g) => g[1])).toFixed(1) },
        // frames whose interval was long on the wall clock but short in our own CPU: the host's doing
        slowWall: frames.filter((x) => x.dt > 50).length,
        slowWallHost: frames.filter((x) => x.dt > 50 && x.ival < 16).length,
      };
    },
  };
}
