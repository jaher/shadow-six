#!/usr/bin/env node
/**
 * Minimal Node unit-test runner for pure modules (no browser; 'three' resolves to vendor/ via resolve-hooks.mjs).
 * Usage: node tests/unit/run.mjs [filter]
 * Each tests/unit/*.test.mjs imports { test } from './lib.mjs' and registers cases.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { cases } from './lib.mjs';

// map 'three' / 'three/addons/' like the browser import map (works without node_modules/three)
register('./resolve-hooks.mjs', import.meta.url);

const dir = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
// per-mission suites live in tests/missions/*.test.mjs (same lib.mjs registry), listed as 'missions/<file>'
const missionsDir = join(dir, '..', 'missions');
const listTests = (d) => { try { return readdirSync(d).filter((f) => f.endsWith('.test.mjs')).sort(); } catch { return []; } };
const files = [...listTests(dir), ...listTests(missionsDir).map((f) => `../missions/${f}`)];
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
for (const c of cases) {
  const label = `${c.file.replace('.test.mjs', '')} › ${c.name}`;
  if (filter && !label.includes(filter)) continue;
  try {
    await c.fn();
    pass++;
    console.log(`  ok   ${label}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${label}\n       ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
  }
}
const ms = (performance.now() - t0).toFixed(0);
console.log(`\nunit: ${pass} passed, ${fail} failed (${ms} ms)`);
process.exit(fail ? 1 : 0);
