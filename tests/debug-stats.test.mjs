/**
 * Debug info HUD numbers (`?debug`, src/debug/debug-mode.js + debug-stats.js + gpu-mem-counter.js) in a real mission:
 *  - after M1 loads, the bottom-left HUD shows the latency table (frame / main cpu / render cpu / input → frame), the
 *    whole-frame draws and triangles with their offscreen part (water mirror etc.), GPU MB, three's object counts —
 *    with plausible values; it sits above the DEBUG / ▶ SOL / ▶ VIDEO buttons without covering them;
 *  - the GPU counter agrees with tools/perf/mem-probe.js (the memory test's meter) on the same session;
 *  - a lost + restored context: the counter drops the lost objects and counts the re-uploads (no double count), the
 *    triangles still update (three's new renderer.info is hooked again);
 *  - video mode hides the HUD (clean recordings) until F11.
 * README "Debug mode", design-spec §10.7.
 */
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

export const timeout = 240_000;
const MB = 1048576;

export default async function debugStats(page, t) {
  const url = t.harness.url;
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options')); // info HUD on (default)
  await page.addInitScript({ path: join(ROOT, 'tools/perf/mem-probe.js') }); // the reference meter, beside the counter
  await page.goto(`${url}/index.html?debug&mission=m01`);
  await page.waitForFunction(() => window.shadowSix?.state === 'playing' && !window.shadowSix.debug?.mode?._launching && window.shadowSix.missionDef?.id === 'm01', null, { timeout: 120000 });
  await page.waitForTimeout(2500); // the 2 s window fills
  for (let i = 0; i < 3; i++) { await page.mouse.click(700, 330); await page.waitForTimeout(250); }
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const m = window.shadowSix.debug.mode, box = document.getElementById('dbg-info');
    const rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    return {
      text: box.textContent, hidden: box.hidden, box: rect(box), vw: innerWidth, vh: innerHeight,
      btns: ['dbg-btn', 'dbg-sol-btn', 'dbg-wt-btn'].map((id) => document.getElementById(id)).filter((e) => e && !e.hidden).map(rect),
      s: m.sampleStats(), probe: window.__memProbe.report({ top: 1 }).gpu, main: window.shadowSix.renderer.stats(),
      native: /\[native code\]/.test(WebGL2RenderingContext.prototype.texStorage2D.toString()),
    };
  });
  t.log(r.text.split('\n').join(' | '));
  const { s } = r;
  t(!r.hidden, 'info HUD shown in a mission');
  t(!r.native, 'the WebGL2 allocation calls are counted under ?debug');
  // latency
  t(/frame\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+ms\s+FPS \d+/.test(r.text), 'frame time row: avg p95 max + FPS');
  t(s.frame && s.frame.n >= 20 && s.frame.avg > 2 && s.frame.avg < 500 && s.frame.max >= s.frame.p95 && s.frame.p95 >= s.frame.min, `frame interval plausible (${JSON.stringify(s.frame)})`);
  t(s.cpu && s.render && s.render.avg > 0 && s.render.avg <= s.cpu.avg + 0.5, `render cpu ≤ main cpu per frame (${s.render?.avg.toFixed(2)} / ${s.cpu?.avg.toFixed(2)} ms)`);
  t(/input→frame\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+ms\s+last [\d.]+ \(\d+\)/.test(r.text), 'input → frame row');
  t(s.input && s.input.n >= 3 && s.input.last > 0 && s.input.max < 1000, `input → frame latency plausible (${JSON.stringify(s.input)})`);
  // triangles: the whole frame, the offscreen part (M1's water mirror, FFT, trails) included
  t(/draws\s+\d+/.test(r.text) && /tris\s+[\d.]+[kM]?/.test(r.text), 'draws + tris rows');
  t(s.tris && s.tris.avg > 10000 && s.calls.avg > 10, `tris / draws plausible (${s.tris?.avg | 0} / ${s.calls?.avg | 0})`);
  t(s.pre && s.pre.tris > 0 && s.pre.calls > 0 && /offscreen/.test(r.text), `offscreen passes counted (${JSON.stringify(s.pre)})`);
  t(s.tris.max >= r.main.triangles && s.calls.max >= r.main.calls, `whole frame ≥ Renderer.stats() (${s.tris.max} ≥ ${r.main.triangles})`);
  // memory
  const gpu = /GPU (\d+) MB\s+tex ([\d.]+)\s+buf ([\d.]+)/.exec(r.text);
  t(gpu && +gpu[1] > 100 && +gpu[1] < 3000 && +gpu[2] > 50 && +gpu[3] > 1, `GPU MB line plausible (${gpu?.[0]})`);
  t(Math.abs(s.gpu.total - r.probe.total) <= Math.max(2 * MB, r.probe.total * 0.01), `counter = mem-probe (${(s.gpu.total / MB).toFixed(1)} vs ${(r.probe.total / MB).toFixed(1)} MB)`);
  t.equal(s.gpu.ntex, r.probe.ntex, 'same live textures as mem-probe');
  t(s.three && s.three.textures > 50 && s.three.geometries > 50 && /three\.js \d+ tex\s+\d+ geo/.test(r.text), 'three.js object counts');
  if (s.heap) t(/JS heap \d+ MB/.test(r.text), 'JS heap (Chromium)');
  // layout: bottom-left, inside the window, above the corner buttons
  t(r.box.l >= 8 && r.box.l <= 40 && r.box.b > r.vh - 120 && r.box.r <= r.vw && r.box.t >= 0, `bottom-left (${JSON.stringify(r.box)})`);
  for (const b of r.btns) t(r.box.b <= b.t || r.box.r <= b.l, `no overlap with a corner button (${JSON.stringify(b)})`);

  // a lost and restored context: no double count, the HUD keeps counting
  const lost = await page.evaluate(async () => {
    const m = window.shadowSix.debug.mode, G = window.shadowSix, R = G.renderer.renderer;
    const ext = R.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return null;
    const before = m.gpuMem.totals(), info0 = R.info;
    ext.loseContext();
    await new Promise((ok) => setTimeout(ok, 400));
    const during = m.gpuMem.totals();
    ext.restoreContext();
    await new Promise((ok) => setTimeout(ok, 4000)); // frames re-upload what they draw (and the released arrays refill)
    const TM = await import('/src/engine/texture-memory.js');
    const GC = await import('/src/engine/gpu-compress.js');
    for (let i = 0; i < 20; i++) { await new Promise((ok) => setTimeout(ok, 100)); await TM.compressedRefillsIdle(); await GC.gpuCompressor()?.idle(); }
    await new Promise((ok) => setTimeout(ok, 2200)); // a fresh 2 s window
    const s = m.sampleStats();
    return { before: before.total, during: during.total, after: m.gpuMem.totals().total, losses: m.gpuMem.totals().losses, newInfo: R.info !== info0, hooked: m.draws.info === R.info, tris: s.tris?.avg ?? 0 };
  });
  if (lost) {
    t.log(`lost context: GPU ${(lost.before / MB).toFixed(0)} → ${(lost.during / MB).toFixed(0)} → ${(lost.after / MB).toFixed(0)} MB, tris ${lost.tris | 0}`);
    t(lost.during < 1 * MB && lost.losses >= 1, `a lost context drops its objects (${(lost.during / MB).toFixed(1)} MB)`);
    t(lost.after > lost.before * 0.3 && lost.after <= lost.before * 1.15, `re-uploads counted once (${(lost.before / MB).toFixed(0)} → ${(lost.after / MB).toFixed(0)} MB)`);
    t(lost.newInfo && lost.hooked && lost.tris > 10000, `triangles still counted on three's new renderer.info (${lost.tris | 0})`);
  }

  // video mode: hidden by default (clean recordings), F11 shows it for that walkthrough, the option is untouched
  const vid = async () => page.evaluate(() => ({ hidden: document.getElementById('dbg-info').hidden, shown: getComputedStyle(document.getElementById('dbg-info')).display !== 'none', video: document.body.classList.contains('dbg-video') }));
  await page.evaluate(() => {
    const m = window.shadowSix.debug.mode;
    m.replay = { isWalkthrough: true, sol: { id: 'm01' }, stage: null, speed: 1, stop() {}, key() { return false; } }; // stand-in walkthrough
    m._videoInfo = false;
    m._frameApply();
  });
  let v = await vid();
  t(v.video && v.hidden && !v.shown, `hidden in video mode (${JSON.stringify(v)})`);
  await page.keyboard.press('F11');
  v = await vid();
  t(!v.hidden && v.shown, `F11 shows it in video mode (${JSON.stringify(v)})`);
  await page.keyboard.press('F11');
  t((await vid()).hidden, 'F11 again hides it');
  await page.evaluate(() => { const m = window.shadowSix.debug.mode; m.replay = null; m._frameApply(); });
  v = await vid();
  t(!v.video && !v.hidden && v.shown, `back from video mode: the option (on) applies (${JSON.stringify(v)})`);
  t(await page.evaluate(() => window.shadowSix.debug.mode.options.infoHud === true), 'video-mode F11 left the remembered option alone');
}
