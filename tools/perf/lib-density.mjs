#!/usr/bin/env node
/**
 * Texel-density table of the shared texture library (assets/textures/lib/density.json, read by src/art/lib-tiers.js):
 * per 1k file, the texels per metre on its most stretched surfaces over every mission — the area-weighted 1st
 * percentile of tools/perf/texel-density.mjs (the strictest 1 % of the area is left to one mip level of slack; the
 * same surfaces already magnify the 1k map).
 *
 *   node tools/perf/texel-density.mjs --missions=all --preset=high --out=/tmp/td.json
 *   node tools/perf/lib-density.mjs /tmp/td.json [--pct=p1]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = process.argv[2];
if (!src) { console.error('usage: lib-density.mjs <texel-density.json> [--pct=p1]'); process.exit(1); }
const pct = (process.argv.find((a) => a.startsWith('--pct=')) || '--pct=p1').slice(6);
const T = JSON.parse(readFileSync(src, 'utf8')).textures;
const maps = {};
for (const [k, v] of Object.entries(T)) {
  const m = /textures\/lib\/1k\/([^/?#]+)$/.exec(k);
  if (!m || v.w !== 1024 || !(v[pct] > 0)) continue;
  const d = +v[pct].toFixed(1);
  maps[m[1]] = Math.min(maps[m[1]] ?? Infinity, d);
}
const out = {
  about: `Texels per metre of each 1k library map on its most stretched surfaces (area-weighted ${pct} over every mission, close LODs). src/art/lib-tiers.js picks per map the smallest copy (1k/512/256/128) that keeps at least the preset's screen density (engine/texel-budget.js). Maps not listed stay 1k. Written by tools/perf/lib-density.mjs from tools/perf/texel-density.mjs.`,
  percentile: pct,
  maps: Object.fromEntries(Object.entries(maps).sort((a, b) => a[0].localeCompare(b[0]))),
};
const file = join(ROOT, 'assets/textures/lib/density.json');
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const need = { medium: 100, high: 120 };
for (const [p, n] of Object.entries(need)) {
  const c = { 1024: 0, 512: 0, 256: 0, 128: 0 };
  for (const d of Object.values(maps)) { let s = 1024; while (s / 2 >= 128 && (d * s) / 2 / 1024 >= n) s /= 2; c[s]++; }
  console.log(`${p} (${n} px/m):`, c);
}
console.log(`${Object.keys(maps).length} maps → ${file}`);
