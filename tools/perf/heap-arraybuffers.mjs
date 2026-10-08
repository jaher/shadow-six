#!/usr/bin/env node
/**
 * Who holds the ArrayBuffer memory? Loads a mission, takes a V8 heap snapshot and groups every ArrayBuffer backing
 * store (≥ --min KB) by its retainer path (the first named owners above it).
 *
 *   node tools/perf/heap-arraybuffers.mjs --mission=m01 [--preset=high] [--min=256] [--seq=m01,m02,m03,m01]
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const mission = arg('mission', 'm01'), preset = arg('preset', 'high'), minKB = +arg('min', 256);
const h = await startHarness({});
const page = await h.newPage({ width: 1920, height: 1080 });
await h.openGame(page, `?test=1&preset=${preset}`);
const seq = arg('seq', mission).split(',');
await page.evaluate(async (s) => { window.__game.game.audio?.unlock?.(); window.__game.setPreset?.(s.preset); const { sessionCache } = await import('/src/engine/asset-cache.js'); sessionCache.spare = 0; for (const m of s.seq) { await window.__game.loadMission(m); for (let i = 0; i < 3; i++) window.__game.render(); } }, { seq, preset });
await page.waitForTimeout(4000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.collectGarbage');
const chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
const snap = JSON.parse(chunks.join(''));
const m = snap.snapshot.meta;
const NF = m.node_fields.length, EF = m.edge_fields.length;
const nTypes = m.node_fields.indexOf('type'), nName = m.node_fields.indexOf('name'), nSelf = m.node_fields.indexOf('self_size'), nEdges = m.node_fields.indexOf('edge_count');
const eType = m.edge_fields.indexOf('type'), eName = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node');
const typeNames = m.node_types[0], edgeTypes = m.edge_types[0];
const N = snap.nodes, E = snap.edges, S = snap.strings;
const count = N.length / NF;
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += N[i * NF + nEdges] * EF; }
firstEdge[count] = E.length;
// reverse edges (retainers), skipping weak edges
const retainers = Array.from({ length: count }, () => []);
for (let i = 0; i < count; i++) {
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
    const t = edgeTypes[E[e + eType]];
    if (t === 'weak') continue;
    const to = E[e + eTo] / NF;
    retainers[to].push([i, t === 'element' || t === 'hidden' ? '[' + E[e + eName] + ']' : S[E[e + eName]]]);
  }
}
const name = (i) => S[N[i * NF + nName]];
const type = (i) => typeNames[N[i * NF + nTypes]];
const groups = new Map();
let total = 0;
for (let i = 0; i < count; i++) {
  if (type(i) !== 'native' && type(i) !== 'hidden') continue;
  const nm = name(i);
  if (!/JSArrayBufferData|system \/ JSArrayBufferData|ArrayBuffer/i.test(nm)) continue;
  const sz = N[i * NF + nSelf];
  if (sz < minKB * 1024) continue;
  total += sz;
  // walk up: first few named owners (skip the ArrayBuffer / typed array wrappers)
  const path = [];
  let cur = i, guard = 0;
  const seen = new Set();
  while (path.length < 6 && guard++ < 40) {
    const r = retainers[cur].filter(([p]) => !seen.has(p) && type(p) !== 'synthetic').sort((a, b) => (type(a[0]) === 'object' ? -1 : 1))[0];
    if (!r) break;
    seen.add(r[0]);
    const [p, edge] = r;
    const pn = name(p);
    if (type(p) === 'object' && !/^(ArrayBuffer|Uint8Array|Float32Array|Uint16Array|Uint32Array|Int16Array|Int32Array|Int8Array|Float64Array|Uint8ClampedArray|DataView|Array|Object|system \/ Context)$/.test(pn)) path.push(`${pn}.${edge}`);
    else if (type(p) === 'object' && /^(Object|Array)$/.test(pn)) path.push(`{}.${edge}`);
    cur = p;
  }
  const key = path.slice(0, 4).join(' < ') || '(root)';
  const g = groups.get(key) || { bytes: 0, n: 0, max: 0 };
  g.bytes += sz; g.n++; g.max = Math.max(g.max, sz);
  groups.set(key, g);
}
console.log(`ArrayBuffers ≥ ${minKB} KB: ${(total / 1048576).toFixed(0)} MB`);
// --count=Name1,Name2: live instances of these constructors (leak check: one World after a mission cycle)
for (const cn of arg('count', '').split(',').filter(Boolean)) {
  let n = 0;
  for (let i = 0; i < count; i++) if (type(i) === 'object' && name(i) === cn) n++;
  console.log(`count ${cn}: ${n}`);
}
// --path=Name: the shortest retaining path from the GC roots to every live instance of Name (who keeps it alive)
const pathOf = arg('path', '');
if (pathOf) {
  const parent = new Int32Array(count).fill(-1), pedge = new Array(count);
  parent[0] = 0;
  const q = [0];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
      const t = edgeTypes[E[e + eType]];
      if (t === 'weak' || t === 'shortcut') continue;
      const to = E[e + eTo] / NF;
      if (parent[to] !== -1) continue;
      parent[to] = i; pedge[to] = t === 'element' || t === 'hidden' ? '[' + E[e + eName] + ']' : S[E[e + eName]];
      q.push(to);
    }
  }
  for (let i = 0; i < count; i++) {
    if (type(i) !== 'object' || name(i) !== pathOf) continue;
    const chain = [];
    for (let c = i; c > 0 && chain.length < 40; c = parent[c]) chain.push(`${type(c)}:${name(c).slice(0, 60)} .${pedge[c]}`);
    console.log(`\nPATH ${pathOf} #${i} (${chain.length}):\n  ` + chain.reverse().join('\n  '));
  }
}
// --trace=<substring>: the full retainer chain (up to 30 owners) of the arrays whose short path contains it
const trace = arg('trace', '');
if (trace) {
  let shown = 0;
  for (let i = 0; i < count && shown < 8; i++) {
    if (!/JSArrayBufferData|ArrayBuffer/i.test(name(i)) || N[i * NF + nSelf] < minKB * 1024) continue;
    const chain = [];
    let cur = i, guard = 0;
    const seen = new Set([i]);
    while (guard++ < 60) {
      const rs = retainers[cur].filter(([p]) => !seen.has(p) && type(p) !== 'synthetic');
      const r = rs.sort((a, b) => (type(a[0]) === 'object' ? -1 : 1))[0];
      if (!r) break;
      seen.add(r[0]);
      chain.push(`${type(r[0])}:${name(r[0]).slice(0, 50)}.${r[1]}`);
      cur = r[0];
    }
    if (!chain.join(' < ').includes(trace)) continue;
    shown++;
    console.log(`\nTRACE ${(N[i * NF + nSelf] / 1048576).toFixed(1)} MB:\n  ` + chain.join('\n  < '));
  }
}
for (const [k, g] of [...groups].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 40)) console.log(`${(g.bytes / 1048576).toFixed(1).padStart(7)} MB ${String(g.n).padStart(4)} × (max ${(g.max / 1048576).toFixed(1)})  ${k.slice(0, 220)}`);
await h.close();
