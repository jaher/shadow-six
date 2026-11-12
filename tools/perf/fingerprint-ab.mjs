#!/usr/bin/env node
/**
 * Gameplay-world identity between two checkouts (debug/gameplay-fingerprint.js): loads each mission in the real game
 * (?test=1, GPU) from checkout A and from checkout B and compares every field of the fingerprint — every NavGrid layer
 * (nav / visual / low / hull / overhead / standing / body stamps …), links, stairs, body solids, the ground and lying
 * heights, structures, interactables, entities, ladders, registries, house rules, the RNG. An art change that is
 * visual only leaves all of them byte-identical.
 *
 *   node tools/perf/fingerprint-ab.mjs --a=<master checkout> --b=<branch checkout> [--missions=m01,m04] [--preset=high]
 *
 * Prints IDENTICAL or the fields (and grid rows / items) that differ, per mission; exit 1 on any difference.
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const A = resolve(arg('a', HERE)), B = resolve(arg('b', HERE)), preset = arg('preset', 'high');
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const { diffFingerprints } = await import(pathToFileURL(join(HERE, 'src/debug/gameplay-fingerprint.js')).href);
const all = ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20'];
const missions = arg('missions', '') ? arg('missions').split(',') : all;
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });

async function fingerprint(root, mid) {
  const server = await startServer({ port: 0, root });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(0);
  try {
    await page.goto(`${server.url.replace(/\/$/, '')}/index.html?test=1&preset=${preset}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
    return await page.evaluate(async (m) => { const g = window.__game; await g.loadMission(m); g.start(); return g.gameplayFingerprint(); }, mid);
  } finally { await page.close(); await server.close(); }
}

let bad = 0;
for (const mid of missions) {
  const [fa, fb] = await Promise.all([fingerprint(A, mid), fingerprint(B, mid)]);
  const d = diffFingerprints(fa, fb);
  if (!d.length) { console.log(`${mid}: IDENTICAL (${Object.keys(fa.fields).length} fields)`); continue; }
  bad++;
  console.log(`${mid}: DIFFER in ${d.length} field(s)`);
  for (const x of d.slice(0, 12)) console.log(`   ${x.field}${x.rows ? ` rows ${x.rows.slice(0, 12).join(',')}${x.rows.length > 12 ? '…' : ''}` : ''}${x.items ? ` items ${x.items.slice(0, 3).map((i) => `#${i.i}: ${String(i.a).slice(0, 160)} | ${String(i.b).slice(0, 160)}`).join(' ; ')}` : ''}`);
}
await browser.close();
console.log(bad ? `${bad} mission(s) differ` : 'ALL IDENTICAL');
process.exit(bad ? 1 : 0);
