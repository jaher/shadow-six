/**
 * Responsive mission load: a COLD load (a fresh browser: empty HTTP and GPU program caches) keeps the main thread free
 * while the LOADING screen is up — its bar, its tips and the ?debug perf graph keep moving.
 *  1. M3 through the walkthrough link (`?debug&walkthrough=m03`, up to its intro card) and M1 through a normal mission
 *     start (`?debug&mission=m01`): no main-thread task (Long Tasks API) over BOUND ms between the mission load
 *     starting (`mission:loading`, the loading screen up) and the loading screen closing; the screen drew frames all
 *     along. The worst task and the share over the local target (33 ms) are reported, each task over 50 ms with its
 *     load stage. (The page's own boot — the WebGL renderer's construction, ~0.3–0.6 s — comes before the mission
 *     load and is reported apart.)
 *  2. The load time does not grow: M3 cold loads with the responsive load and with `?sliced=0` (the same build, the old
 *     blocking load: engine/slice.js SLICED), interleaved; median ratio ≤ RATIO.
 * Bounds for a loaded CI host (other agents' GPU tests on the same box): LOADRESP_BOUND (ms, default 100) and
 * LOADRESP_RATIO (default 1.25) override them; the local targets are 33 ms and 1.10.
 */
import { findChrome, GPU_ARGS, SWIFTSHADER_ARGS } from './harness.mjs';

export const timeout = 1_200_000;
const BOUND = +(process.env.LOADRESP_BOUND || 100);
const RATIO = +(process.env.LOADRESP_RATIO || 1.25);
const TARGET_MS = 33, TARGET_RATIO = 1.1;

/** In the page from its first line: long tasks, frame times, loading-screen and load milestones. */
function probe() {
  const L = (window.__lr = { tasks: [], frames: [], marks: [], stages: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) L.tasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
  let on = false, hooked = false;
  const hook = (g) => {
    if (hooked || !g?.events?.on) return;
    hooked = true;
    g.events.on('mission:loading', () => L.marks.push(['loading', performance.now()]));
    g.events.on('mission:loaded', () => L.marks.push(['loaded', performance.now()]));
    g.events.on('mission:progress', (e) => { const s = L.stages[L.stages.length - 1]; if (!s || s[1] !== e.stage) L.stages.push([performance.now(), e.stage]); });
  };
  // (hooked the moment the game publishes itself: a normal start begins its load in the same task)
  let game;
  try { Object.defineProperty(window, 'shadowSix', { configurable: true, get: () => game, set: (v) => { game = v; hook(v); } }); } catch { /* polled below */ }
  const f = (now) => {
    L.frames.push(now);
    hook(window.shadowSix);
    const ld = !!document.querySelector('.mk-loading');
    if (ld !== on) { on = ld; L.marks.push([ld ? 'screen-on' : 'screen-off', now]); }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

/** One cold load in a fresh browser. @returns {Promise<object>} */
async function coldLoad(t, query, done) {
  const h = t.harness;
  const browser = await h.browser.browserType().launch({ executablePath: findChrome(), headless: true, args: h.mode === 'swiftshader' ? SWIFTSHADER_ARGS : GPU_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
    await page.addInitScript(probe);
    const t0 = Date.now();
    await page.goto(`${h.url}/index.html${query}`);
    await page.waitForFunction(done, null, { timeout: 400_000, polling: 250 });
    const wall = Date.now() - t0;
    await page.waitForTimeout(300);
    const r = await page.evaluate((TARGET) => {
      const L = window.__lr, m = (k) => L.marks.find((x) => x[0] === k)?.[1];
      const a = m('loading') ?? m('screen-on'), b = m('screen-off') ?? m('loaded') ?? performance.now();
      const stageAt = (t) => { let s = 'start'; for (const [ts, n] of L.stages) if (ts <= t) s = n; if (m('loaded') != null && t >= m('loaded')) s = 'after load'; return s; };
      const inWin = L.tasks.filter(([s, d]) => s + d > a && s < b);
      const tasks = inWin.map(([, d]) => Math.round(d));
      const worst = inWin.filter(([, d]) => d > 50).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([s, d]) => `${Math.round(d)} ms @${((s - a) / 1000).toFixed(1)} s ${stageAt(s)}`);
      const fr = []; for (let i = 1; i < L.frames.length; i++) if (L.frames[i] > a && L.frames[i] <= b) fr.push(L.frames[i] - L.frames[i - 1]);
      fr.sort((x, y) => x - y);
      const boot = L.tasks.filter(([s, d]) => s + d <= a).map(([, d]) => Math.round(d));
      return { window: Math.round(b - a), maxTask: Math.max(0, ...tasks), over50: tasks.filter((d) => d > 50).length, over33: tasks.filter((d) => d > TARGET).length,
        tasks: tasks.length, frames: fr.length, p50: fr[fr.length >> 1] ?? null, maxFrame: Math.round(fr[fr.length - 1] ?? 0), bootMax: Math.max(0, ...boot), worst,
        loadMs: window.shadowSix?.lastLoad?.ms ?? null };
    }, TARGET_MS).catch((e) => ({ error: String(e) }));
    return { ...r, wall, errs };
  } finally { await browser.close().catch(() => {}); }
}
export default async function (page, t) {
  const loaded = () => !!window.shadowSix?.lastLoad && !window.shadowSix.hud?.loading?.active && ['playing', 'briefing', 'paused'].includes(window.shadowSix.state);
  const card = () => !!document.getElementById('wt-card') && !!window.shadowSix?.lastLoad && !window.shadowSix.hud?.loading?.active;
  // ---- 1. responsiveness while the loading screen is up
  const runs = [
    ['M3 walkthrough link', '?debug&walkthrough=m03', card],
    ['M1 mission start', '?debug&mission=m01', loaded],
  ];
  const res = [];
  for (const [name, q, done] of runs) {
    const r = await coldLoad(t, q, done);
    res.push([name, r]);
    t.log(`${name}: loading screen ${(r.window / 1000).toFixed(1)} s, worst task ${r.maxTask} ms (bound ${BOUND}, target ${TARGET_MS}), ${r.over50} tasks > 50 ms, ${r.over33} > 33 ms; frames ${r.frames}, p50 ${r.p50?.toFixed?.(1)} ms, worst ${r.maxFrame} ms; boot worst task ${r.bootMax} ms; loadMission ${r.loadMs} ms`);
    if (r.worst?.length) t.log(`  tasks > 50 ms: ${r.worst.join(', ')}`);
    t.equal(r.errs.length, 0, `${name}: page errors ${r.errs.join(' | ')}`);
    t(!r.error, `${name}: ${r.error}`);
  }
  // ---- 2. load time: the responsive load vs the blocking one (?sliced=0), interleaved, cold
  const times = { on: [], off: [] };
  for (let k = 0; k < 2; k++) {
    for (const mode of ['off', 'on']) {
      const r = await coldLoad(t, `?debug&mission=m03${mode === 'off' ? '&sliced=0' : ''}`, loaded);
      times[mode].push(r.loadMs);
      t.log(`M3 cold load, ${mode === 'on' ? 'responsive' : 'sliced=0'}: loadMission ${r.loadMs} ms, worst task ${r.maxTask} ms`);
    }
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const ratio = med(times.on) / med(times.off);
  t.log(`load-time ratio responsive / blocking: ${ratio.toFixed(2)} (bound ${RATIO}, target ${TARGET_RATIO})`);
  for (const [name, r] of res) t(r.maxTask <= BOUND, `${name}: a main-thread task of ${r.maxTask} ms while the loading screen was up (bound ${BOUND} ms)`);
  for (const [name, r] of res) t(r.frames > r.window / 1000 * 5, `${name}: the loading screen drew ${r.frames} frames in ${(r.window / 1000).toFixed(1)} s`);
  t(ratio <= RATIO, `load time grew: ${ratio.toFixed(2)} × the blocking load (bound ${RATIO})`);
}
