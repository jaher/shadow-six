#!/usr/bin/env node
// strips.mjs - frame strips of prone clips on the real characters (headless GPU via tests/harness.mjs), composed into
// one JPEG per job (rows = views, columns = frames). CC0 project code.
//   node tools/characters/prone/strips.mjs --job='{"who":{"id":"sniper"},"clip":"crawl","views":["side","top"]}' --out=a.jpg
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const jobs = JSON.parse(arg('jobs', '[' + arg('job', '{}') + ']'));
const outs = arg('out', 'strip.jpg').split(',');
const width = +arg('width', 1000);
const h = await startHarness({});
const page = await h.newPage({ width: 1280, height: 720 });
await page.goto(`${h.url}/index.html?test=1`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const tmp = mkdtempSync(join(tmpdir(), 'strip-'));
for (let j = 0; j < jobs.length; j++) {
  const r = await page.evaluate(async (o) => { const S = await import('/tools/characters/prone/strip_page.js'); return o.mission ? S.gameStrip(o) : S.strips(o); }, jobs[j]);
  const rows = [];
  for (const [v, list] of Object.entries(r.views)) {
    const files = list.map((d, i) => { const f = join(tmp, `${j}_${v}_${i}.png`); writeFileSync(f, Buffer.from(d.split(',')[1], 'base64')); return f; });
    const c = jobs[j].cols || files.length;
    for (let i = 0; i < files.length; i += c) rows.push(files.slice(i, i + c));
  }
  execFileSync('python3', [join(dirname(fileURLToPath(import.meta.url)), 'compose.py'), outs[j] || `strip${j}.jpg`, String(width), jobs[j].title || `${r.clip} (${r.weapon || 'no weapon'})`, JSON.stringify(rows)]);
  console.log(`${outs[j]}: ${r.clip}, weapon ${r.weapon}; errors: ${h.errors(page).slice(0, 3).join(' | ') || 'none'}`);
}
await h.close();
