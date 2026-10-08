#!/usr/bin/env node
/**
 * SHADOW SIX web build: `npm run build` → dist/ (static site for GitHub Pages, served from a sub-path).
 *
 *   node tools/build/build.mjs [--out dist] [--no-minify] [--skip-assets]
 *
 * 1. JS: esbuild bundles src/main.js (ESM, code-split so lazily imported modules stay lazy, minified) into dist/js/
 *    with content-hashed names; three + addons are bundled (tree-shaken) from vendor/. The tree-generation worker
 *    is a separate pre-built bundle. See esbuild-plugin.mjs for how `import.meta.url` asset URLs keep working.
 * 2. index.html: import map dropped, entry → hashed bundle + modulepreload of its static chunks, CSS ?v=<version>,
 *    JSON fetches get ?v=<version> (asset manifests never outlive a deploy), build info on window.__SS_BUILD__.
 * 3. Runtime assets only (assets.mjs), Draco/Basis decoders, LICENSE, CREDITS.md, .nojekyll, 404.html,
 *    version.json, sw.js (large-asset cache, versioned per file), size report (fails > 950 MB).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { shadowSixPlugin } from './esbuild-plugin.mjs';
import { copyRuntimeAssets } from './assets.mjs';
import { sizeReport, checkRelativeUrls } from './report.mjs';
import { writeServiceWorker } from './sw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const OUT = resolve(ROOT, opt('--out', 'dist'));
const MINIFY = !args.includes('--no-minify');
const SKIP_ASSETS = args.includes('--skip-assets');
const t0 = Date.now();
const log = (...a) => console.log(`[build ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

/** Git sha/date of the tree being built (falls back to CI env, then 'local'). */
function buildInfo() {
  const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const sha = git('rev-parse', 'HEAD') || process.env.GITHUB_SHA || '';
  const subject = git('log', '-1', '--format=%s');
  const devSha = /Sync from dev master ([0-9a-f]{7,40})/.exec(subject)?.[1] || null;   // public repo (tools/publish)
  const date = git('log', '-1', '--format=%cI') || new Date().toISOString();
  return { sha: sha || 'local', short: sha ? sha.slice(0, 10) : 'local', devSha, date, built: new Date().toISOString() };
}

/** Debug solutions + walkthroughs (src/debug/solutions.js): the tools/solutions/ catalog, baked into the bundle. */
async function solutionCatalog() {
  const { catalogFromFiles } = await import('../../src/debug/solutions.js');
  return catalogFromFiles(await readdir(join(ROOT, 'tools/solutions')));
}

async function buildJs(version) {
  const common = {
    absWorkingDir: ROOT, bundle: true, format: 'esm', platform: 'browser', target: ['es2022', 'chrome111', 'firefox115', 'safari16.4'],
    minify: MINIFY, sourcemap: false, legalComments: 'eof', metafile: true, write: true, logLevel: 'warning',
    logOverride: { 'import-is-undefined': 'silent' },   // game.js probes optional export names on purpose
    outdir: join(OUT, 'js'), entryNames: '[name]-[hash]', chunkNames: 'c-[hash]', assetNames: '[name]-[hash]',
    define: { 'globalThis.__SS_BUNDLED__': 'true', 'globalThis.__SS_SOLUTIONS__': JSON.stringify(await solutionCatalog()) },
  };
  const w = await esbuild.build({ ...common, entryPoints: ['src/art/terrain/treegen.worker.js'], splitting: false,
    plugins: [shadowSixPlugin({ root: ROOT, version, worker: true })] });
  const workerFile = basename(Object.keys(w.metafile.outputs).find((f) => f.endsWith('.js')));
  const m = await esbuild.build({ ...common, entryPoints: ['src/main.js'], splitting: true,
    plugins: [shadowSixPlugin({ root: ROOT, version, workerFile })] });
  if (process.env.SS_BUILD_META) await writeFile(process.env.SS_BUILD_META, JSON.stringify(m.metafile));
  const outs = m.metafile.outputs;
  const mainKey = Object.keys(outs).find((k) => outs[k].entryPoint === 'src/main.js');
  // static imports of the entry (transitively) → <link rel=modulepreload> so the browser fetches them in parallel
  const preload = new Set();
  const walk = (k) => { for (const im of outs[k].imports) if (im.kind === 'import-statement' && !preload.has(im.path)) { preload.add(im.path); walk(im.path); } };
  walk(mainKey);
  const rel = (k) => 'js/' + basename(k);
  return { main: rel(mainKey), preload: [...preload].map(rel), worker: workerFile, outputs: Object.keys(outs).length + 1 };
}

async function buildCss(version) {
  await mkdir(join(OUT, 'styles'), { recursive: true });
  for (const f of await readdir(join(ROOT, 'styles'))) {
    if (!f.endsWith('.css')) continue;
    const src = await readFile(join(ROOT, 'styles', f), 'utf8');
    // url()s stay relative (same styles/ depth); only minify
    const out = MINIFY ? (await esbuild.transform(src, { loader: 'css', minify: true, legalComments: 'none' })).code : src;
    await writeFile(join(OUT, 'styles', f), out);
  }
}

/** Build-only inline script: build info + ?v= on same-origin JSON fetches (asset manifests). */
function inlineBoot(info) {
  const b = JSON.stringify({ v: info.short, sha: info.sha, devSha: info.devSha, date: info.date });
  return `<script>window.__SS_BUILD__=${b};(function(){var v=window.__SS_BUILD__.v,f=window.fetch.bind(window);` +
    `window.fetch=function(i,o){try{if(typeof i==='string'||i instanceof URL){var u=new URL(String(i),location.href);` +
    `if(u.origin===location.origin&&/\\.json$/.test(u.pathname)&&!u.searchParams.has('v')){u.searchParams.set('v',v);i=u.href;}}}catch(e){}` +
    `return f(i,o);};` +
    // a game script that fails to load (flaky network, or a cached page from before a deploy) says so instead of
    // leaving the bar sweeping forever
    `addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='SCRIPT'||t&&t.rel==='modulepreload'){` +
    `var x=document.getElementById('loading-text');if(x)x.textContent='Could not load the game \u2014 please reload the page.';}},true);` +
    // secure origins only (https, or localhost for the dist tests); test pages opt in with &sw=1
    `if('serviceWorker'in navigator&&isSecureContext&&(!/[?&]test=1/.test(location.search)||/[?&]sw=1/.test(location.search)))` +
    `addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});})();</script>`;
}

async function buildHtml(info, js) {
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const before = html;
  html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
  html = html.replace(/<link rel="stylesheet" href="(styles\/[\w.-]+\.css)"/g, (_, h) => `<link rel="stylesheet" href="${h}?v=${info.short}"`);
  const pre = js.preload.map((p) => `  <link rel="modulepreload" href="${p}">`).join('\n');
  html = html.replace('</head>', `${pre ? pre + '\n' : ''}  ${inlineBoot(info)}\n</head>`);
  html = html.replace('<script type="module" src="src/main.js"></script>', `<script type="module" src="${js.main}"></script>`);
  if (html === before || !html.includes(js.main) || html.includes('importmap')) throw new Error('index.html: rewrite failed (markup changed?)');
  if (!/not affiliated/i.test(html)) throw new Error('index.html: fan-tribute disclaimer missing');
  await writeFile(join(OUT, 'index.html'), html);
  return html;
}

/** GitHub Pages serves 404.html for unknown paths: send the player to the game at the site root. */
function notFoundHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SHADOW SIX</title>
<script>(function(){var p=location.pathname.split('/').filter(Boolean);var base=location.hostname.endsWith('github.io')&&p.length?'/'+p[0]+'/':'/';location.replace(base);})();</script>
</head><body style="background:#111;color:#ddd;font:16px sans-serif;padding:2em">Page not found. <a href="./" style="color:#fc6">Go to SHADOW SIX</a>.</body></html>\n`;
}

async function main() {
  const info = buildInfo();
  log(`version ${info.short}${info.devSha ? ` (dev ${info.devSha})` : ''} → ${OUT}`);
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const js = await buildJs(info.short);
  log(`js: ${js.outputs} files, entry ${js.main}, ${js.preload.length} preloaded chunks, worker ${js.worker}`);
  await buildCss(info.short);
  await buildHtml(info, js);
  await mkdir(join(OUT, 'vendor/addons/libs'), { recursive: true });
  for (const d of ['draco', 'basis']) await cp(join(ROOT, 'vendor/addons/libs', d), join(OUT, 'vendor/addons/libs', d), { recursive: true });
  for (const f of ['LICENSE', 'CREDITS.md']) await cp(join(ROOT, f), join(OUT, f));
  if (!SKIP_ASSETS) {
    const a = await copyRuntimeAssets(ROOT, OUT);
    log(`assets: ${a.copied} files copied, ${a.skipped} skipped (${(a.skippedBytes / 1e6).toFixed(1)} MB not shipped)`);
  }
  await writeFile(join(OUT, '.nojekyll'), '');
  await writeFile(join(OUT, '404.html'), notFoundHtml());
  await writeFile(join(OUT, 'version.json'), JSON.stringify(info, null, 1) + '\n');
  const sw = await writeServiceWorker(OUT, info);
  log(`sw.js: ${sw.cached} cacheable assets`);
  checkRelativeUrls(OUT);
  const ok = sizeReport(OUT, { failBytes: 950e6, warnFileBytes: 50e6 });
  log(ok ? 'done' : 'FAILED (size budget)');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('[build] FAILED:', e.stack || e); process.exit(1); });
