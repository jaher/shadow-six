#!/usr/bin/env node
/**
 * Markdown table from tools/perf/ab-render.mjs JSON files: per config / mission / view, base → test draw calls,
 * triangles, renderer-process CPU per frame, GPU-process CPU per frame, timer-query GPU ms, synced frame wall time, and
 * the pixel diff against the A-vs-A noise floor.
 *
 *   node tools/perf/ab-table.mjs <ab.json> [more.json …] [--md=out.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mdArg = process.argv.find((a) => a.startsWith('--md='));
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const pct = (a, b) => (a && b != null ? `${b - a >= 0 ? '+' : ''}${Math.round(((b - a) / a) * 100)}%` : '');
const n = (v, d = 1) => (v == null ? '—' : (+v).toFixed(d));
const k = (v) => (v == null ? '—' : `${(v / 1e6).toFixed(2)}M`);
const lines = [
  '| config | mission | view | draws | triangles | renderer CPU ms | GPU-process CPU ms | GPU ms (timer) | frame wall ms | pixel diff (>8 levels) vs noise |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
for (const r of rows) {
  const A = r.A, B = r.B;
  const d = r.diff ? `${n(r.diff.gt8, 3)}%` : '—', z = r.noise ? `${n(r.noise.gt8, 3)}%` : '—';
  lines.push(`| ${r.cfg} | ${r.mission} | ${r.view} | ${A.calls} → ${B.calls} | ${k(A.tris)} → ${k(B.tris)} (${pct(A.tris, B.tris)}) | ${n(A.rendCpu)} → ${n(B.rendCpu)} (${pct(A.rendCpu, B.rendCpu)}) | ${n(A.gpuProcCpu)} → ${n(B.gpuProcCpu)} (${pct(A.gpuProcCpu, B.gpuProcCpu)}) | ${n(A.gpu)} → ${n(B.gpu)} | ${n(A.wall)} → ${n(B.wall)} (${pct(A.wall, B.wall)}) | ${d} vs ${z} |`);
}
const md = lines.join('\n');
console.log(md);
if (mdArg) writeFileSync(mdArg.slice(5), md + '\n');
