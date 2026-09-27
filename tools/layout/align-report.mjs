#!/usr/bin/env node
/**
 * Building ↔ fence/wall/road alignment report (src/missions/alignment.js).
 * Usage: node tools/layout/align-report.mjs [--all] [--json] [--strict] [missionFile...]
 *   no files → every src/missions/m*.js of this checkout. Files may live in another checkout (read-only import).
 *   --all     also list skipped (exempt) and unreferenced items
 *   --json    machine-readable output
 *   --strict  exit 1 when any STRICT item (tanks, `align: 'fence'`) is off; advisory items (everything else) and
 *             near-miss warnings (tolDeg < dev ≤ nearMissDeg) are listed for review by eye and never fail
 * Table columns: id, type, rule (STRICT|advisory), rot°, reference segment (kind:id a→b angle), distance, deviation° (mod 90), suggested rot°
 * (the reference angle + k·90° nearest to the current rot, so fronts keep their side).
 */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

register('../../tests/unit/resolve-hooks.mjs', import.meta.url); // 'three' → vendor/ (mission scripts may import it)
const { analyzeMission, formatReport } = await import('../../src/missions/alignment.js');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../src/missions');
  files = readdirSync(dir).filter((f) => /^m\d\d_.*\.js$/.test(f)).sort().map((f) => join(dir, f));
}

const results = [];
for (const f of files) {
  let def;
  try {
    def = (await import(pathToFileURL(resolve(f)).href)).default;
  } catch (err) {
    console.error(`# ${basename(f)}: import failed — ${String(err?.message || err).split('\n')[0]}`);
    continue;
  }
  if (!def || !Array.isArray(def.structures)) { console.error(`# ${basename(f)}: no mission def`); continue; }
  results.push({ file: basename(f), ...analyzeMission(def) });
}

if (flag('--json')) {
  console.log(JSON.stringify(results.map(({ file, id, entries, violations, ...r }) => ({ file, id, violations: violations.length, nearMisses: r.nearMisses.length, entries })), null, 1));
} else {
  for (const r of results) console.log(formatReport(r, { all: flag('--all') }) + '\n');
  console.log('## Summary\n');
  for (const r of results) {
    const list = (a) => (a.length ? ' — ' + a.map((v) => v.id).join(', ') : '');
    console.log(`- ${r.id} (${r.file}): ${r.violations.length} strict violation(s)${list(r.violations)}; ${r.nearMisses.length} near-miss warning(s)${list(r.nearMisses)}`);
  }
}
if (flag('--strict') && results.some((r) => r.violations.length)) process.exitCode = 1;
