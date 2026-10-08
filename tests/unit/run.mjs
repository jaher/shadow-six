#!/usr/bin/env node
/**
 * Minimal Node unit-test runner for pure modules (no browser; 'three' resolves to vendor/ via resolve-hooks.mjs).
 * Usage: node tests/unit/run.mjs [filter] [--shard=i/n]
 *   --shard=i/n (or env UNIT_SHARD=i/n, i in 1..n): run only every n-th test file starting at the i-th, so CI can
 *   split the suite across parallel jobs. Files are balanced by their measured run time (tests/unit/durations.json,
 *   largest first onto the lightest shard); files without a timing count as the median. Refresh the timings with
 *   `node tests/unit/run.mjs --write-durations` after adding heavy tests.
 * Each tests/unit/*.test.mjs imports { test } from './lib.mjs' and registers cases.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { cases } from './lib.mjs';

// map 'three' / 'three/addons/' like the browser import map (works without node_modules/three)
register('./resolve-hooks.mjs', import.meta.url);

const dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const shardArg = args.find((a) => a.startsWith('--shard='))?.slice(8) || process.env.UNIT_SHARD || '';
const filter = args.find((a) => !a.startsWith('--')) || '';
const [shardI, shardN] = shardArg ? shardArg.split('/').map(Number) : [1, 1];
if (!(shardN >= 1 && shardI >= 1 && shardI <= shardN)) { console.error(`bad --shard=${shardArg} (want i/n, 1 <= i <= n)`); process.exit(2); }
// per-mission suites live in tests/missions/*.test.mjs (same lib.mjs registry), listed as 'missions/<file>'
const missionsDir = join(dir, '..', 'missions');
const listTests = (d) => { try { return readdirSync(d).filter((f) => f.endsWith('.test.mjs')).sort(); } catch { return []; } };
const allFiles = [...listTests(dir), ...listTests(missionsDir).map((f) => `../missions/${f}`)];
const durPath = join(dir, 'durations.json');
let durations = {};
try { durations = JSON.parse(readFileSync(durPath, 'utf8')); } catch { /* no timings yet: equal weights */ }
const known = Object.values(durations).sort((a, b) => a - b);
const median = known.length ? known[known.length >> 1] : 1;
// a file heavier than HEAVY ms is split case by case (round-robin); lighter files go whole to the lightest shard
const HEAVY = 60000;
const heavy = new Set(shardN > 1 ? allFiles.filter((f) => (durations[f] ?? 0) > HEAVY) : []);
const shardOf = new Map();
{
  const load = new Array(shardN).fill(0);
  for (const f of heavy) for (let j = 0; j < shardN; j++) load[j] += durations[f] / shardN;
  const byWeight = allFiles.filter((f) => !heavy.has(f)).sort((a, b) => (durations[b] ?? median) - (durations[a] ?? median) || a.localeCompare(b));
  for (const f of byWeight) { let k = 0; for (let j = 1; j < shardN; j++) if (load[j] < load[k]) k = j; shardOf.set(f, k); load[k] += durations[f] ?? median; }
}
const files = allFiles.filter((f) => heavy.has(f) || shardOf.get(f) === shardI - 1);
let pass = 0, fail = 0;
for (const f of files) {
  const before = cases.length;
  try {
    await import(pathToFileURL(join(dir, f)).href);
  } catch (err) {
    // one broken file is a failure, not a crash of the whole run
    fail++;
    console.log(`  FAIL ${f} (import)\n       ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
  }
  for (let k = before; k < cases.length; k++) cases[k].file = f;
}

const t0 = performance.now();
const perFile = {};
const caseIdx = {};
for (const c of cases) {
  if (c.file && heavy.has(c.file)) { const n = (caseIdx[c.file] = (caseIdx[c.file] ?? -1) + 1); if (n % shardN !== shardI - 1) continue; }
  const tc = performance.now();
  const label = `${(c.file || '(registered at run time)').replace('.test.mjs', '')} › ${c.name}`; // a file that imports another test file registers its cases late
  if (filter && !label.includes(filter)) continue;
  try {
    await c.fn();
    pass++;
    console.log(`  ok   ${label}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${label}\n       ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
  }
  if (c.file) perFile[c.file] = (perFile[c.file] || 0) + (performance.now() - tc);
}
if (args.includes('--write-durations') && !filter) {
  const out = { ...durations };
  for (const [f, v] of Object.entries(perFile)) out[f] = Math.round(v);
  writeFileSync(durPath, JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 1) + '\n');
  console.log(`wrote ${durPath} (${Object.keys(perFile).length} files timed)`);
}
const ms = (performance.now() - t0).toFixed(0);
console.log(`\nunit${shardN > 1 ? ` [shard ${shardI}/${shardN}]` : ''}: ${pass} passed, ${fail} failed (${ms} ms)`);
process.exit(fail ? 1 : 0);
