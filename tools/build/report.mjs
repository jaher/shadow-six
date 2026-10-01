/** Size report + sub-path safety checks for the web build (tools/build/build.mjs). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

const mb = (n) => (n / 1e6).toFixed(1) + ' MB';

/**
 * Print totals by top-level folder / extension; warn on big files; false when the total exceeds failBytes.
 * GitHub Pages: 1 GB published-site limit, and files > 100 MB are rejected by git anyway.
 */
export function sizeReport(out, { failBytes, warnFileBytes }) {
  const files = walk(out).map((f) => ({ f: relative(out, f).split('\\').join('/'), n: statSync(f).size }));
  const total = files.reduce((s, x) => s + x.n, 0);
  const group = (key) => {
    const m = new Map();
    for (const x of files) { const k = key(x.f); const g = m.get(k) || { n: 0, c: 0 }; g.n += x.n; g.c++; m.set(k, g); }
    return [...m].sort((a, b) => b[1].n - a[1].n);
  };
  console.log('\n== dist size report ==');
  for (const [k, g] of group((f) => (f.startsWith('assets/') ? f.split('/').slice(0, 2).join('/') : f.split('/')[0]))) {
    console.log(`  ${k.padEnd(28)} ${String(g.c).padStart(6)} files ${mb(g.n).padStart(10)}`);
  }
  console.log('  by type:', group((f) => (/\.([^./]+)$/.exec(f)?.[1] || '(none)')).slice(0, 10).map(([k, g]) => `${k} ${mb(g.n)}`).join(', '));
  const js = files.filter((x) => x.f.startsWith('js/'));
  console.log(`  js: ${js.length} files, ${mb(js.reduce((s, x) => s + x.n, 0))}; largest ${js.sort((a, b) => b.n - a.n).slice(0, 3).map((x) => `${x.f} ${mb(x.n)}`).join(', ')}`);
  const gz = js.reduce((s, x) => s + gzipSync(readFileSync(join(out, x.f)), { level: 6 }).length, 0);
  console.log(`  js gzipped (as GitHub Pages sends it): ${mb(gz)}`);
  for (const x of files) if (x.n > warnFileBytes) console.warn(`  WARNING: ${x.f} is ${mb(x.n)} (> ${mb(warnFileBytes)})`);
  console.log(`  TOTAL ${files.length} files, ${mb(total)} (limit ${mb(failBytes)})\n`);
  if (total > failBytes) console.error(`[build] dist is ${mb(total)} > ${mb(failBytes)}: GitHub Pages would reject it`);
  return total <= failBytes;
}

/**
 * The site is served from a sub-path (https://jaher.github.io/shadow-six/): fail on root-absolute or dev-host URLs
 * in the HTML, CSS, JS bundle and JSON manifests.
 */
export function checkRelativeUrls(out) {
  const bad = [];
  const rules = [
    [/\.html$/, /\s(?:src|href)=["']\/(?!\/)/g],
    [/\.css$/, /url\(\s*["']?\/(?!\/)/g],
    [/\.(js|html)$/, /["'`]\/(?:assets|src|styles|vendor|js)\//g],
    [/\.json$/, /"\/(?:assets|src|styles|vendor)\//g],
    [/\.(js|css|html|json)$/, /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1)[:/]/g],
  ];
  for (const f of walk(out)) {
    const rel = relative(out, f);
    if (rel === '404.html' || rel === 'sw.js') continue;
    const r = rules.filter(([ext]) => ext.test(f));
    if (!r.length) continue;
    const s = readFileSync(f, 'utf8').replace(/\?\?\s?(["'`])https?:\/\/localhost\/\1/g, '');   // no-DOM fallback base
    for (const [, re] of r) for (const m of s.matchAll(re)) bad.push(`${rel}: …${s.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ')}…`);
  }
  if (bad.length) {
    console.error('[build] root-absolute / dev-host URLs (break under the /shadow-six/ sub-path):\n  ' + bad.slice(0, 20).join('\n  '));
    throw new Error(`${bad.length} non-relative URL(s) in dist`);
  }
  console.log('[build] URL check: every HTML/CSS/JS/JSON URL is relative (sub-path safe)');
}
