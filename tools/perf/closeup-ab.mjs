#!/usr/bin/env node
/**
 * Character close-up A/B: the same mission in two checkouts (base = A, test = B; `--noise` loads A again for the
 * run-to-run floor), then for each commando and the first enemies the game camera is pulled down to a close-up
 * (`--zooms`, ×40 CSS px/m: 8 → 320 px/m, 4–8× past the game's zoom-2 limit) centred on the body, a fixed frame
 * sequence rendered, and the canvases diffed (mean abs, % of pixels off by > 2 / 8 / 32 levels, max).
 * For asset changes that must not show on characters (meshes, textures, compression).
 *
 *   node tools/perf/closeup-ab.mjs --base=<checkout A> [--test=<checkout B>] [--missions=m01,m03] [--zooms=8,16]
 *        [--enemies=3] [--preset=high] [--noise] [--out=dir] [--label=name] [--q=gputier=2]
 *
 * Writes <out>/<label>-<mission>-<who>-z<zoom>-{A,B,A2}.png, -diff.png / -noise.png (×8), <out>/<label>.json; prints one
 * line a shot. `python3 tools/perf/abdiff.py <out> --a=A --b=B --n=A2` adds the A/B diff over the pixels that hold still in A vs A2.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const OUT = arg('out', '<projects>/commandos-shots/perf/closeup');
const LABEL = arg('label', 'close');
const ZOOMS = arg('zooms', '8,16').split(',').map(Number);
const MISSIONS = arg('missions', 'm01').split(',');
const NE = +arg('enemies', 3);
const PRESET = arg('preset', 'high');
const NOISE = process.argv.includes('--noise');
const QS = arg('q', 'gputier=2'); // extra URL parameters for both sides (a fixed GPU-compression tier by default)
mkdirSync(OUT, { recursive: true });
const roots = { A: resolve(arg('base')), B: resolve(arg('test', HERE)) };
const servers = { A: await startServer({ port: 0, root: roots.A }), B: await startServer({ port: 0, root: roots.B }) };

async function open(browser, side, id) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(`${servers[side].url.replace(/\/$/, '')}/index.html?test=1&preset=${PRESET}${QS ? '&' + QS : ''}`, { timeout: 180000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  const who = await page.evaluate(async ({ m, ne }) => {
    const g = window.__game, G = g.game;
    G.stop();
    await g.loadMission(m);
    G.stop(); g.start();
    for (let i = 0; i < 30; i++) g.advance(1 / 30);
    for (let i = 0; i < 600 && G.textureWarmer?.queue.length; i++) G.textureWarmer.step(50);
    if (G.selection) G.selection.pulseT = 0.3;
    const s = g.state();
    const list = s.commandos.map((c) => ({ id: c.id, kind: c.role || 'commando', x: c.x, y: c.y ?? 0, z: c.z }));
    for (const e of s.enemies.slice(0, ne)) list.push({ id: e.id, kind: 'enemy', x: e.x, y: e.y ?? 0, z: e.z });
    return list;
  }, { m: id, ne: NE });
  return { ctx, page, errs, who };
}

async function shot(p, c, zoom) {
  return p.page.evaluate(({ c, zoom }) => {
    const G = window.__game.game, cc = G.cameraController;
    cc.tracking = null; cc._zoomTween = null;
    cc.zoom = cc.zoomTarget = zoom; // past setZoom's clamp (game max 2): a close-up
    cc.target.set(c.x, (c.y || 0) + 0.9, c.z);
    cc._applyTransform();
    for (let i = 0; i < 12; i++) G.render(1 / 60, 1);
    G.render(0, 1);
    return G.renderer.renderer.domElement.toDataURL('image/png').split(',')[1];
  }, { c, zoom });
}

function diff(pngA, pngB, outPng) {
  const py = `
import sys, base64, io, json
import numpy as np
from PIL import Image
a = np.asarray(Image.open(io.BytesIO(base64.b64decode(open(sys.argv[1]).read()))).convert('RGB')).astype(np.int16)
b = np.asarray(Image.open(io.BytesIO(base64.b64decode(open(sys.argv[2]).read()))).convert('RGB')).astype(np.int16)
d = np.abs(a - b).max(axis=2)
Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8)).save(sys.argv[3])
print(json.dumps({'mean': round(float(np.abs(a - b).mean()), 4), 'gt2': round(float((d > 2).mean() * 100), 4), 'gt8': round(float((d > 8).mean() * 100), 4), 'gt32': round(float((d > 32).mean() * 100), 4), 'max': int(d.max())}))
`;
  const tA = join(OUT, '.a.b64'), tB = join(OUT, '.b.b64');
  writeFileSync(tA, pngA); writeFileSync(tB, pngB);
  return JSON.parse(execFileSync('python3', ['-I', '-c', py, tA, tB, outPng], { encoding: 'utf8' }));
}

const launch = () => PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const bA = await launch(), bB = await launch();
const results = [];
for (const id of MISSIONS) {
  let A, B, A2;
  try {
    A = await open(bA, 'A', id); B = await open(bB, 'B', id);
    if (NOISE) A2 = await open(bA, 'A', id);
    for (const c of A.who) {
      for (const z of ZOOMS) {
        const tag = `${LABEL}-${id}-${c.id}-z${z}`;
        const sa = await shot(A, c, z), sb = await shot(B, c, z);
        writeFileSync(join(OUT, `${tag}-A.png`), Buffer.from(sa, 'base64'));
        writeFileSync(join(OUT, `${tag}-B.png`), Buffer.from(sb, 'base64'));
        const d = diff(sa, sb, join(OUT, `${tag}-diff.png`));
        let n = null;
        if (A2) { const s2 = await shot(A2, c, z); writeFileSync(join(OUT, `${tag}-A2.png`), Buffer.from(s2, 'base64')); n = diff(sa, s2, join(OUT, `${tag}-noise.png`)); }
        results.push({ mission: id, who: c.id, kind: c.kind, zoom: z, diff: d, noise: n });
        console.log(`${id} ${c.id} (${c.kind}) z${z}: diff ${JSON.stringify(d)}${n ? ' noise ' + JSON.stringify(n) : ''}`);
      }
    }
    for (const p of [A, B, A2]) if (p?.errs.length) console.log(`  errors:`, p.errs.slice(0, 4));
  } catch (e) {
    console.log(`${id} failed: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`);
  }
  for (const p of [A, B, A2]) await p?.ctx.close().catch(() => {});
  writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 1));
}
await bA.close(); await bB.close();
for (const s of Object.values(servers)) await s.close();
