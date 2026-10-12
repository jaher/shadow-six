#!/usr/bin/env node
/**
 * Interleaved A/B render benchmark + pixel diff between two checkouts (base = A, test = B), same browser, same GPU.
 * Both pages load the same mission with the same deterministic frame sequence; the game's own rAF loop is stopped so
 * only the measured page renders. Timing alternates A, B, A, B … (`--reps`), medians reported. Screenshots of the
 * canvas at each view are diffed (mean abs diff, share of pixels off by > 2 / 8 levels, max); `--noise` also loads A
 * a second time to show the run-to-run noise floor (particles, wind, snowfall seeds).
 *
 *   node tools/perf/ab-render.mjs --base=<checkout A> [--test=<checkout B>] [--missions=m01,m03] [--configs=desktop-high,phone-medium]
 *        [--views=default,z05] [--reps=3] [--frames=40] [--noise] [--out=dir] [--label=name]
 *
 * Writes <out>/<label>.json, diff images <out>/<label>-<cfg>-<mission>-<view>-diff.png (×8 amplified), prints a table.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const OUT = arg('out', '<projects>/commandos-shots/perf/ab');
const LABEL = arg('label', 'ab');
const REPS = +arg('reps', 3), FRAMES = +arg('frames', 40);
const VIEWS = arg('views', 'default').split(',');
const CONFIGS = arg('configs', 'desktop-high').split(',');
const MISSIONS = arg('missions', 'm01,m03').split(',');
mkdirSync(OUT, { recursive: true });
const roots = { A: resolve(arg('base')), B: resolve(arg('test', HERE)) };
const servers = { A: await startServer({ port: 0, root: roots.A }), B: await startServer({ port: 0, root: roots.B }) };
const probeSrc = readFileSync(join(HERE, 'tools/perf/render-probe.js'), 'utf8');

const PIXEL7_LAND = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.33 Mobile Safari/537.36',
  viewport: { width: 839, height: 412 }, screen: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
};

// ------------------------------------------------------------------ process CPU time (/proc schedstat, ns)
function procTree(rootPid) {
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const s = readFileSync(`/proc/${d}/stat`, 'utf8'); const ppid = +s.slice(s.lastIndexOf(')') + 2).split(' ')[1]; (kids.get(ppid) || kids.set(ppid, []).get(ppid)).push(+d); } catch { /* gone */ }
  }
  const out = [];
  const walk = (p) => { for (const c of kids.get(p) || []) { out.push(c); walk(c); } };
  walk(rootPid);
  return out;
}
function findPid(marker) {
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const c = readFileSync(`/proc/${d}/cmdline`, 'utf8'); if (c.includes(marker) && !c.includes('--type=')) return +d; } catch { /* gone */ }
  }
  return null;
}
function cpuNs(pid) {
  let t = 0;
  try { for (const tid of readdirSync(`/proc/${pid}/task`)) { try { t += +readFileSync(`/proc/${pid}/task/${tid}/schedstat`, 'utf8').split(' ')[0]; } catch { /* gone */ } } } catch { /* gone */ }
  return t;
}
/** CPU ns of the renderer processes and the GPU process of a browser. */
function procCpu(bpid) {
  let renderer = 0, gpu = 0;
  for (const p of procTree(bpid)) {
    let c = '';
    try { c = readFileSync(`/proc/${p}/cmdline`, 'utf8'); } catch { continue; }
    if (c.includes('--type=renderer')) renderer += cpuNs(p);
    else if (c.includes('--type=gpu-process')) gpu += cpuNs(p);
  }
  return { renderer, gpu };
}

async function launchBrowser() {
  const marker = `--ss-ab-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required', marker] });
  browser.__pid = findPid(marker);
  return browser;
}

async function openPage(browser, side, cfg) {
  const [dev, preset] = cfg.split('-');
  const ctx = await browser.newContext(dev === 'phone' ? { ...PIXEL7_LAND } : { viewport: { width: +arg('w', 1920), height: +arg('h', 1080) }, deviceScaleFactor: 1 });
  await ctx.addInitScript((src) => { window.__probeUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); }, probeSrc);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(`${servers[side].url.replace(/\/$/, '')}/index.html?test=1&preset=${preset}`, { timeout: 180000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  await page.evaluate(async () => {
    window.__game.game.stop(); // only explicit renders from here on
    const { installRenderProbe } = await import(window.__probeUrl);
    window.__probe = installRenderProbe(window.__game.game, {});
  });
  return { ctx, page, errs, side, browser };
}

/** Process CPU per frame: renderer (main thread JS + compositor) and GPU process (command decoding, GL driver). */
async function cpuBench(p, view, frames) {
  await p.page.evaluate(async (view) => {
    const g = window.__game, G = g.game, cc = G.cameraController, rig = G.cameraRig;
    rig.setYaw(view.yaw ?? g.CONFIG.camera.yawDeg);
    cc.setZoom(1, true);
    G.focusSquad?.();
    if (view.zoom != null) cc.setZoom(view.zoom, true);
    for (let i = 0; i < 6; i++) G.render(1 / 60, 1);
    const gl = G.renderer.renderer.getContext(), px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }, view);
  const c0 = procCpu(p.browser.__pid), t0 = Date.now();
  const wall = await p.page.evaluate((n) => {
    const G = window.__game.game, gl = G.renderer.renderer.getContext(), px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) G.render(1 / 60, 1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return (performance.now() - t0) / n;
  }, frames);
  const c1 = procCpu(p.browser.__pid);
  return { rendCpu: +((c1.renderer - c0.renderer) / 1e6 / frames).toFixed(3), gpuProcCpu: +((c1.gpu - c0.gpu) / 1e6 / frames).toFixed(3), loopWall: +wall.toFixed(3), ms: Date.now() - t0 };
}

async function load(p, id) {
  return p.page.evaluate(async (m) => {
    const g = window.__game, G = g.game;
    G.stop();
    const t0 = performance.now();
    await g.loadMission(m);
    const loadMs = performance.now() - t0;
    G.stop();
    g.start();
    G.focusSquad?.();
    for (let i = 0; i < 30; i++) g.advance(1 / 30);
    for (let i = 0; i < 600 && G.textureWarmer?.queue.length; i++) { G.textureWarmer.step(50); }
    G.focusSquad?.();
    if (G.selection) G.selection.pulseT = 0.3; // selection rings pulse on real time: freeze for pixel diffs
    return { loadMs, chunks: G.chunkStats || null };
  }, id);
}

function viewSpec(name) {
  if (name === 'default') return { name };
  if (name === 'z05') return { name, zoom: 0.5 };
  if (name === 'z2') return { name, zoom: 2 };
  if (/^yaw\d+$/.test(name)) return { name, yaw: +name.slice(3) };
  throw new Error('unknown view ' + name);
}

/** Set the view, render a fixed frame sequence, return the canvas as PNG base64. */
async function shot(p, view) {
  return p.page.evaluate(async (view) => {
    const g = window.__game, G = g.game, cc = G.cameraController, rig = G.cameraRig;
    rig.setYaw(view.yaw ?? g.CONFIG.camera.yawDeg);
    cc.setZoom(view.zoom ?? 1, true);
    G.focusSquad?.();
    if (view.zoom != null) cc.setZoom(view.zoom, true);
    for (let i = 0; i < 12; i++) G.render(1 / 60, 1);
    G.render(0, 1);
    return G.renderer.renderer.domElement.toDataURL('image/png').split(',')[1];
  }, view);
}

async function bench(p, view, frames) {
  return p.page.evaluate(async ({ view, frames }) => {
    const g = window.__game, G = g.game, cc = G.cameraController, rig = G.cameraRig;
    rig.setYaw(view.yaw ?? g.CONFIG.camera.yawDeg);
    cc.setZoom(1, true);
    G.focusSquad?.();
    if (view.zoom != null) cc.setZoom(view.zoom, true);
    for (let i = 0; i < 6; i++) G.render(1 / 60, 1);
    const gl = G.renderer.renderer.getContext(), px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const cpu = [];
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); G.render(1 / 60, 1); cpu.push(performance.now() - t0); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const b = await g.bench(frames);
    const pr = window.__probe;
    pr.begin();
    for (let i = 0; i < 20; i++) G.render(1 / 60, 1);
    const prob = await pr.end();
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };
    const st = G.renderer.stats();
    let avgCalls = 0, avgTris = 0;
    for (const v of Object.values(prob.draws)) { avgCalls += v.calls; avgTris += v.tris; }
    // calls / tris: frames averaged (the mirror refreshes every other frame with a still camera)
    return { cpu: med(cpu), wall: b.wallMedian, gpu: b.gpuMedian, calls: Math.round(avgCalls), tris: Math.round(avgTris), lastCalls: st.calls, lastTris: st.triangles, passes: prob.gpu, passesCpu: prob.cpu, draws: prob.draws, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  }, { view, frames });
}

function diff(pngA, pngB, outPng) {
  const py = `
import sys, base64, io, json
import numpy as np
from PIL import Image
a = np.asarray(Image.open(io.BytesIO(base64.b64decode(open(sys.argv[1]).read()))).convert('RGB')).astype(np.int16)
b = np.asarray(Image.open(io.BytesIO(base64.b64decode(open(sys.argv[2]).read()))).convert('RGB')).astype(np.int16)
if a.shape != b.shape:
    print(json.dumps({'error': 'size', 'a': a.shape, 'b': b.shape})); sys.exit(0)
d = np.abs(a - b).max(axis=2)
Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8)).save(sys.argv[3])
print(json.dumps({'mean': round(float(np.abs(a - b).mean()), 4), 'gt2': round(float((d > 2).mean() * 100), 4), 'gt8': round(float((d > 8).mean() * 100), 4), 'gt32': round(float((d > 32).mean() * 100), 4), 'max': int(d.max())}))
`;
  const tA = join(OUT, '.a.b64'), tB = join(OUT, '.b.b64');
  writeFileSync(tA, pngA); writeFileSync(tB, pngB);
  return JSON.parse(execFileSync('python3', ['-I', '-c', py, tA, tB, outPng], { encoding: 'utf8' }));
}

const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : null; };
const results = [];
const browserA = await launchBrowser(), browserB = await launchBrowser();
for (const cfg of CONFIGS) {
  for (const id of MISSIONS) {
    let A, B, A2;
    try {
      A = await openPage(browserA, 'A', cfg); B = await openPage(browserB, 'B', cfg);
      const la = await load(A, id), lb = await load(B, id);
      let la2 = null;
      if (flag('noise')) { A2 = await openPage(browserA, 'A', cfg); la2 = await load(A2, id); }
      for (const vn of VIEWS) {
        const view = viewSpec(vn);
        const sa = await shot(A, view), sb = await shot(B, view);
        const tag = `${LABEL}-${cfg}-${id}-${vn}`;
        writeFileSync(join(OUT, `${tag}-A.png`), Buffer.from(sa, 'base64'));
        writeFileSync(join(OUT, `${tag}-B.png`), Buffer.from(sb, 'base64'));
        const dAB = diff(sa, sb, join(OUT, `${tag}-diff.png`));
        let dAA = null;
        if (A2) dAA = diff(sa, await shot(A2, view), join(OUT, `${tag}-noise.png`));
        const ra = [], rb = [], ca = [], cb = [];
        for (let k = 0; k < REPS; k++) { ra.push(await bench(A, view, FRAMES)); rb.push(await bench(B, view, FRAMES)); }
        for (let k = 0; k < +arg('cpureps', 8); k++) { ca.push(await cpuBench(A, view, FRAMES)); cb.push(await cpuBench(B, view, FRAMES)); }
        const agg = (rs) => ({ cpu: med(rs.map((r) => r.cpu)), wall: med(rs.map((r) => r.wall)), gpu: med(rs.map((r) => r.gpu)), calls: rs[0].calls, tris: rs[0].tris, buffer: rs[0].buffer,
          passes: Object.fromEntries(Object.keys(rs[0].passes).map((k) => [k, med(rs.map((r) => r.passes[k]))])),
          passesCpu: Object.fromEntries(Object.keys(rs[0].passesCpu).map((k) => [k, med(rs.map((r) => r.passesCpu[k]))])), draws: rs[0].draws });
        const cagg = (cs) => ({ rendCpu: med(cs.map((c) => c.rendCpu)), gpuProcCpu: med(cs.map((c) => c.gpuProcCpu)), loopWall: med(cs.map((c) => c.loopWall)) });
        const r = { cfg, mission: id, view: vn, A: { ...agg(ra), ...cagg(ca) }, B: { ...agg(rb), ...cagg(cb) }, rawCpu: { A: ca, B: cb }, raw: { A: ra.map((r) => [r.cpu, r.wall, r.gpu]), B: rb.map((r) => [r.cpu, r.wall, r.gpu]) }, diff: dAB, noise: dAA, load: { A: la, B: lb, A2: la2 } };
        results.push(r);
        const pct = (a, b) => (a && b ? `${(((b - a) / a) * 100).toFixed(0)}%` : '—');
        console.log(`${cfg} ${id} ${vn}: rendCPU ${r.A.rendCpu}→${r.B.rendCpu} (${pct(r.A.rendCpu, r.B.rendCpu)}) gpuProcCPU ${r.A.gpuProcCpu}→${r.B.gpuProcCpu} (${pct(r.A.gpuProcCpu, r.B.gpuProcCpu)}) loop ${r.A.loopWall}→${r.B.loopWall} (${pct(r.A.loopWall, r.B.loopWall)}) cpu ${r.A.cpu}→${r.B.cpu} (${pct(r.A.cpu, r.B.cpu)}) wall ${r.A.wall}→${r.B.wall} (${pct(r.A.wall, r.B.wall)}) gpu ${r.A.gpu}→${r.B.gpu} (${pct(r.A.gpu, r.B.gpu)}) calls ${r.A.calls}→${r.B.calls} tris ${Math.round(r.A.tris / 1e3)}k→${Math.round(r.B.tris / 1e3)}k | diff ${JSON.stringify(dAB)}${dAA ? ' noise ' + JSON.stringify(dAA) : ''}`);
      }
      for (const p of [A, B, A2]) if (p?.errs.length) console.log(`  ${p.side} errors:`, p.errs.slice(0, 4));
    } catch (e) {
      console.log(`${cfg} ${id} failed: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`);
    }
    for (const p of [A, B, A2]) await p?.ctx.close().catch(() => {});
    writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 1));
  }
}
await browserA.close(); await browserB.close();
for (const s of Object.values(servers)) await s.close();
