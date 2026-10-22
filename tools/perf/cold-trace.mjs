#!/usr/bin/env node
/**
 * Cold-link determinism trace (tests/debug-walkthrough-cold.test.mjs is the guard; this is the tool to find WHERE two runs
 * part): a mission's solution played either
 *   logic — a fresh browser, ?test=1, the solution logic-only (as tests/<id>-solution.test.mjs), or
 *   walk  — a fresh browser opening the cold link ?debug&walkthrough=<id> (the LOADING screen, the title card, then the
 *           walkthrough live with its frames and pacing),
 * every tick hashed (src/debug/sim-trace.js) and, with --dump=a:b, every line kept for ticks a..b; the tick-0 gameplay
 * fingerprint (src/debug/gameplay-fingerprint.js) too. --diff names the first tick that differs and the lines there.
 *
 *   node tools/perf/cold-trace.mjs m02 logic|walk [--root=<checkout>] [--preset=low] [--speed=auto|4|1] [--size=1280x720]
 *        [--sdelay=<regex>@<ms>[,…]] [--smbit=4] [--dump=a:b] [--out=run.json]
 *   node tools/perf/cold-trace.mjs --diff a.json b.json
 * --sdelay holds the matching responses that long (a proxy in front of the server: workers' fetches too) — e.g.
 * `--sdelay=/assets/models/buildings/@70000`; --smbit: one shared link of that many Mbit/s (+40 ms per response);
 * --cpu=N: the load on an N× slower CPU (CDP throttling, lifted at tick 0: a weak machine's load past every bound).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

if (argv[0] === '--diff') {
  const [a, b] = [argv[1], argv[2]].map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const { compareRecordings } = await import(pathToFileURL(join(HERE, 'src/debug/sim-trace.js')).href);
  const { diffFingerprints } = await import(pathToFileURL(join(HERE, 'src/debug/gameplay-fingerprint.js')).href);
  const c = compareRecordings(a.rec, b.rec);
  console.log(`${a.mission} ${a.mode} ${a.res.state} end ${a.res.end} vs ${b.mission} ${b.mode} ${b.res.state} end ${b.res.end}; ticks ${c.n.join(' / ')}`);
  console.log(c.same ? 'IDENTICAL every tick' : c.first == null ? 'the same ticks, one run longer' : `first tick that differs: ${c.first + 1} (t=${((c.first + 1) / 60).toFixed(2)}); lines: ${c.units.join(', ')}`);
  console.log(`checkpoints ${a.res.marks === b.res.marks ? 'the same' : `DIFFER:\n  ${a.res.marks}\n  ${b.res.marks}`}`);
  const fd = diffFingerprints(a.fp, b.fp);
  console.log(`tick-0 gameplay fingerprint: ${fd.length ? `${fd.length} fields differ: ${fd.map((x) => x.field).join(', ')}` : 'identical'}`);
  for (const k of Object.keys(a.dumps || {})) {
    const A = a.dumps[k], B = b.dumps?.[k];
    if (!B) continue;
    const d = A.map((x, i) => (x !== B[i] ? `  [${k}] ${x}\n  [${k}] ${B[i]}` : null)).filter(Boolean);
    if (d.length) { console.log(d.slice(0, 16).join('\n')); break; }
  }
  process.exit(c.same ? 0 : 1);
}

const [mission = 'm02', mode = 'logic'] = argv.filter((x) => !x.startsWith('--'));
const ROOT = resolve(arg('root', HERE)), preset = arg('preset', ''), speed = arg('speed', 'auto');
const [VW, VH] = arg('size', '1280x720').split('x').map(Number);
const [dumpA, dumpB] = arg('dump', '') ? arg('dump').split(':').map(Number) : [-1, -2];
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const server = await startServer({ port: 0, root: ROOT });
let base = server.url.replace(/\/$/, ''), proxy = null, held = 0;
const sdelay = arg('sdelay', ''), smbit = +arg('smbit', 0);
if (sdelay || smbit) {
  const rules = sdelay ? sdelay.split(',').map((r) => { const i = r.lastIndexOf('@'); return [new RegExp(r.slice(0, i)), +r.slice(i + 1)]; }) : [];
  const target = new URL(base);
  let linkFree = 0;
  proxy = http.createServer(async (req, res) => {
    const ms = rules.find(([re]) => re.test(req.url))?.[1] || 0;
    if (ms) { held++; await new Promise((r) => setTimeout(r, ms)); }
    if (smbit) await new Promise((r) => setTimeout(r, 40));
    const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      if (!smbit) { ur.pipe(res); return; }
      ur.on('data', (chunk) => {
        const now = Date.now();
        linkFree = Math.max(linkFree, now) + ((chunk.length * 8) / (smbit * 1e6)) * 1000;
        ur.pause();
        setTimeout(() => { res.write(chunk); ur.resume(); }, linkFree - now);
      });
      ur.on('end', () => setTimeout(() => res.end(), Math.max(0, linkFree - Date.now()) + 1));
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* gone */ } });
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${proxy.address().port}`;
}
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.setDefaultTimeout(0);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
// the recorder, installed by every page of this run (a module import, in the page)
const install = async (dump) => {
  const { simRecorder, simStateLines } = await import('/src/debug/sim-trace.js');
  const { gameplayFingerprint } = await import('/src/debug/gameplay-fingerprint.js');
  const rec = simRecorder(), dumps = {};
  window.__ct = { rec, dumps, snap: (w) => { rec.snap(w); if (w.tick >= dump[0] && w.tick <= dump[1]) dumps[w.tick] = simStateLines(w); }, fp: (w, g) => gameplayFingerprint(w, { game: g }) };
};
const cpu = +arg('cpu', 0);
const cdp = cpu > 1 ? await page.context().newCDPSession(page) : null;
if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const unthrottle = async () => { if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); };
const t0 = Date.now();
let res, fp, loadS = 0;
try {
  if (mode === 'logic') {
    await page.goto(`${base}/index.html?test=1${preset ? `&preset=${preset}` : ''}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 0 });
    await page.evaluate(install, [dumpA, dumpB]);
    await page.evaluate(async (mid) => { await window.__game.loadMission(mid); }, mission);
    loadS = (Date.now() - t0) / 1000;
    await unthrottle();
    ({ res, fp } = await page.evaluate(async (mid) => {
      const G = window.__game, g = G.game, dt = G.CONFIG.sim.dt, C = window.__ct;
      G.start();
      const w = g.world, fp = C.fp(w, g);
      const { makeDriver } = await import('/tools/solutions/driver.mjs');
      const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
      const { boardPoint } = await import('/src/abilities/drive.js');
      let end = null;
      g.events.on('mission:won', () => { end ??= w.time; });
      g.events.on('mission:lost', () => { end ??= w.time; });
      const D = makeDriver(w, { dt, quiet: true, log: () => {}, step: () => { g.step(dt); C.snap(w); } });
      let error = null;
      try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
      const solved = w.time;
      for (let i = 0; i < 600 && g.state === 'playing'; i++) { g.step(dt); C.snap(w); }
      return { fp, res: { preset: g.renderer?.presetName, error, state: g.state, end: end?.toFixed(2), solved: solved.toFixed(2), det: D.detections(), exp: D.exposures().length,
        marks: D.checkpoints.map((c) => `${c.name.split(' ')[0]}@${c.t.toFixed(2)}`).join(' ') } };
    }, mission));
  } else {
    await page.goto(`${base}/index.html?debug${preset ? `&preset=${preset}` : ''}&walkthrough=${mission}&speed=${speed}`);
    await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay?.isWalkthrough, null, { timeout: 0, polling: 500 });
    loadS = (Date.now() - t0) / 1000;
    await unthrottle();
    await page.evaluate(install, [dumpA, dumpB]);
    fp = await page.evaluate(() => {
      const g = window.shadowSix, w = g.world, C = window.__ct;
      window.__end = null;
      g.events.on('debug:walkthrough-end', (r) => { if (r.outcome !== 'stopped') window.__end = r; });
      const step = g.step;
      g.step = function (dt) { const r = step.call(this, dt); if (this.world === w) C.snap(w); return r; };
      return C.fp(w, g);
    });
    await page.locator('#wt-card [data-act=start]').click();
    await page.waitForFunction(() => !!window.__end, null, { timeout: 0, polling: 2000 });
    res = await page.evaluate(() => { const x = window.__end, g = window.shadowSix; return { preset: g.renderer?.presetName, error: x.error, state: x.state, end: x.time.toFixed(2), det: x.detections, exp: x.exposures,
      marks: (x.marks || []).map((m) => `${m.name.split(' ')[0]}@${m.t.toFixed(2)}`).join(' ') }; });
  }
  const tr = await page.evaluate(() => ({ rec: window.__ct.rec.data(), dumps: window.__ct.dumps }));
  console.log(`${mission} ${mode} preset=${res.preset} speed=${mode === 'walk' ? speed : '-'}${sdelay ? ` sdelay=${sdelay} (${held} held)` : ''}${smbit ? ` ${smbit} Mbit/s` : ''}${cpu > 1 ? ` cpu ${cpu}x` : ''} load ${loadS.toFixed(0)} s, wall ${((Date.now() - t0) / 1000).toFixed(0)} s: ${res.state} end ${res.end}${res.solved ? ` (solution done ${res.solved})` : ''} det=${res.det} exp=${res.exp} err=${res.error}`);
  console.log(`checkpoints: ${res.marks}`);
  console.log(`ticks: ${tr.rec.hashes.length}; page errors: ${JSON.stringify(errors.slice(0, 4))}`);
  if (arg('out', '')) writeFileSync(arg('out'), JSON.stringify({ mission, mode, preset: res.preset, speed, res, fp, ...tr }));
} finally {
  await browser.close();
  await server.close();
  proxy?.close();
}
