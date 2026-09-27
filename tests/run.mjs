#!/usr/bin/env node
/**
 * Browser test runner.
 *
 *   node tests/run.mjs [pattern] [--swiftshader] [--headed]
 *
 * Runs every tests/*.test.mjs whose file name contains `pattern`. Each exports
 * `default async (page, t) => {}`; the page is already open at index.html?test=1 and ready.
 * A test fails on a thrown error, any page error, console.error or HTTP >= 400.
 * `t.shot(name)` saves tests/out/<name>.png; `t.harness` is the harness object.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startHarness, makeAssert, TESTS_DIR } from './harness.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pattern = argv.find((a) => !a.startsWith('--')) || '';
const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.mjs') && f.includes(pattern)).sort();
if (!files.length) {
  console.log(`no browser tests match "${pattern}"`);
  process.exit(1);
}

const TEST_TIMEOUT = 90_000;
const h = await startHarness({ swiftshader: flags.has('--swiftshader'), headless: !flags.has('--headed') });
console.log(`browser tests (${h.mode}) on ${h.url}`);
let pass = 0;
let fail = 0;
const t0 = Date.now();
for (const f of files) {
  const name = f.replace(/\.test\.mjs$/, '');
  const started = Date.now();
  const page = await h.newPage();
  const t = makeAssert(name);
  t.harness = h;
  t.shot = (n) => page.screenshot({ path: h.shotPath(`${n}.png`) });
  let err = null;
  let timer;
  try {
    const mod = await import(pathToFileURL(join(TESTS_DIR, f)).href);
    await h.openGame(page);
    await Promise.race([
      mod.default(page, t),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${TEST_TIMEOUT} ms`)), TEST_TIMEOUT); }),
    ]);
  } catch (e) {
    err = e;
  } finally {
    clearTimeout(timer);
  }
  const pageErrs = h.errors(page);
  await page.close().catch(() => {});
  const ms = Date.now() - started;
  if (!err && !pageErrs.length) {
    pass++;
    console.log(`  ok   ${name} (${ms} ms)`);
  } else {
    fail++;
    console.log(`  FAIL ${name} (${ms} ms)`);
    if (err) console.log('       ' + String(err.stack || err).split('\n').slice(0, 4).join('\n       '));
    for (const e of pageErrs.slice(0, 8)) console.log('       ' + e);
  }
}
await h.close();
console.log(`\n${pass} passed, ${fail} failed (${files.length} browser tests, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
