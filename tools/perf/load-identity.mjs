#!/usr/bin/env node
/**
 * Is a mission built the same by two checkouts? Loads each mission (?test=1, desktop high) in checkout A and B and
 * compares digests of what the load produced: every typed-array layer of the nav grid (+ nav stamps, links, runs,
 * ramps), the placement result, the entities (id, kind, x / z / heading / y, state), the interactables, and the scene
 * graph (names, visibility, world matrices, geometry vertex / index counts and position hashes, material names / types /
 * defines, texture sizes). Prints per-mission equal / different, with the first differing parts.
 *
 *   node tools/perf/load-identity.mjs --base=<checkout A> [--test=<checkout B>] [--missions=m01,m03] [--preset=high] [--tick] [--dump=<dir>] [--query=&sliced=0]
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const roots = { A: resolve(arg('base')), B: resolve(arg('test', HERE)) };
const missions = arg('missions', 'm01,m03').split(',');
const preset = arg('preset', 'high');
// --tick: 0.1 s of play after the load on both sides (the set pieces' lazy init, the mission script's first run — M11's
// scenery —, the models' first update — M5's cable line) and a render before comparing: what one checkout builds as
// the load ends and the other on the first tick compares equal
const firstTick = process.argv.includes('--tick');

/** In the page: digests of the loaded mission. */
function digest() {
  const G = window.shadowSix, w = G.world, g = w.grid;
  const fnv = (h, x) => Math.imul(h ^ (x & 0xffffffff), 16777619) >>> 0;
  const hashArr = (a) => {
    if (!a) return 'none';
    let h = 2166136261;
    const v = a instanceof Float32Array || a instanceof Float64Array ? new Uint32Array(a.buffer, a.byteOffset, (a.byteLength >> 2)) : a;
    for (let i = 0; i < v.length; i++) h = fnv(h, v[i]);
    return `${a.length}:${h.toString(16)}`;
  };
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = fnv(h, s.charCodeAt(i)); return h.toString(16); };
  const r6 = (x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x);
  const out = {};
  for (const k of Object.keys(g)) {
    const v = g[k];
    if (ArrayBuffer.isView(v)) out[`grid.${k}`] = hashArr(v);
  }
  const safeJson = (x) => { try { return hashStr(JSON.stringify(x, (k, v) => (typeof v === 'number' ? r6(v) : (v && typeof v === 'object' && v.isObject3D ? '[o3d]' : typeof v === 'function' ? '[fn]' : v)))); } catch (e) { return 'err:' + e.message; } };
  out['grid.links'] = safeJson((g.links || []).map((l) => [l.kind, l.a, l.b, l.enabled, l.cost, l.roles]));
  out['grid.navStamps'] = safeJson(g.navStamps ? [...(g.navStamps.entries?.() || Object.entries(g.navStamps))].map(([k, v]) => [k, v?.length ?? v?.size ?? v]) : null);
  out['grid.runs'] = safeJson(g.runs || null);
  out['grid.ramps'] = safeJson(g.ramps || null);
  out['grid.version'] = g.version;
  out['placement'] = safeJson((w.placement?.structures || []).map((s) => [s.type, s.id, s.x, s.z, s.rot, s.w, s.d, s.points, s.placementDropped]));
  out['placement.log'] = safeJson(w.placement?.log || null);
  out['entities'] = safeJson(w.entities.map((e) => [e.id, e.constructor?.name, e.kind, e.role, e.soldierType, r6(e.x), r6(e.z), r6(e.y), r6(e.heading ?? e.h), e.state, e.alive]));
  out['interactables'] = safeJson((w.interactables || []).map((i) => [i.id, i.interactKind, r6(i.x), r6(i.z), i.tag, i.on, i.open]));
  out['ladders'] = safeJson(w.ladders || null);
  out['structureDoors'] = safeJson(w.structureDoors || null);
  out['stairs'] = safeJson((w.stairs || []).map?.((s) => [s.id, s.pts ?? s.points, s.w]) || null);
  out['fencePosts'] = safeJson(w.fencePosts || null);
  // (the body-clearance solids men path round: not in the grid — M14's parked lorry measured on its placeholder or on
  // its library model changed every path past it)
  out['bodySolids'] = safeJson((w.bodySolids?.list || []).map((o) => [o.owner, o.gone, o.R]));
  const gy = [];
  for (let z = 1; z < (w.size?.[1] || 100); z += 7) for (let x = 1; x < (w.size?.[0] || 100); x += 7) gy.push(r6(w.groundY?.(x, z) ?? 0));
  out['groundY'] = hashStr(gy.join(','));
  // scene graph
  const sc = G.renderer.scene, lines = [], geoms = [], mats = [];
  sc.updateMatrixWorld(true);
  const tex = (t) => (t?.isTexture ? `${t.constructor.name}:${t.image?.width ?? t.mipmaps?.[0]?.width ?? '?'}x${t.image?.height ?? t.mipmaps?.[0]?.height ?? '?'}:${t.colorSpace}` : '');
  sc.traverse((o) => {
    lines.push(`${o.type}|${o.name}|${o.visible ? 1 : 0}|${o.matrixWorld.elements.map(r6).join(',')}|${o.layers.mask}|${o.renderOrder}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.isInstancedMesh ? o.count : ''}`);
    if (o.geometry) {
      const p = o.geometry.attributes?.position, ix = o.geometry.index;
      geoms.push(`${o.name}|${p?.count}|${ix?.count ?? -1}|${Object.keys(o.geometry.attributes || {}).sort().join(',')}|${p && p.array ? hashArr(p.isInterleavedBufferAttribute ? p.data.array : p.array) : ''}|${o.isInstancedMesh ? hashArr(o.instanceMatrix.array.subarray(0, o.count * 16)) : ''}`);
    }
    for (const m of o.material ? [].concat(o.material) : []) {
      mats.push(`${o.name}|${m.type}|${m.name}|${m.transparent ? 1 : 0}|${m.side}|${JSON.stringify(m.defines || {})}|${['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap'].map((k) => tex(m[k])).join(',')}`);
    }
  });
  out['scene.nodes'] = `${lines.length}:${hashStr(lines.join('\n'))}`;
  out['scene.geometry'] = `${geoms.length}:${hashStr(geoms.join('\n'))}`;
  out['scene.materials'] = `${mats.length}:${hashStr(mats.join('\n'))}`;
  out._lines = { nodes: lines, geoms, mats };
  out._arrays = {};
  for (const k of Object.keys(g)) if (ArrayBuffer.isView(g[k])) out._arrays[k] = Array.from(g[k].length > 4e6 ? g[k].subarray(0, 4e6) : g[k]);
  return out;
}

const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
let allSame = true;
for (const id of missions) {
  const res = {};
  for (const side of ['A', 'B']) {
    const server = await startServer({ port: 0, root: roots[side] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${server.url.replace(/\/$/, '')}/index.html?test=1&preset=${preset}${arg("query", "")}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    const ms = await page.evaluate(async (m) => { const t = performance.now(); await window.__game.loadMission(m); return Math.round(performance.now() - t); }, id);
    if (firstTick) await page.evaluate(() => { const api = window.__game; api.start(); api.advance(0.1); api.render(); });
    res[side] = await page.evaluate(digest);
    res[side]._ms = ms;
    await page.close();
    await server.close();
  }
  const diffs = Object.keys({ ...res.A, ...res.B }).filter((k) => k !== '_lines' && k !== '_ms' && k !== '_arrays' && res.A[k] !== res.B[k]);
  // --dump=<dir>: both sides' scene lines (nodes / geometry / materials) as text files, for a diff tool
  const dump = arg('dump', '');
  if (dump) {
    mkdirSync(dump, { recursive: true });
    for (const side of ['A', 'B']) for (const k of ['nodes', 'geoms', 'mats']) writeFileSync(join(dump, `${id}-${k}-${side}.txt`), res[side]._lines[k].join('\n') + '\n');
  }
  for (const k of diffs.filter((d) => d.startsWith('grid.'))) {
    const a = res.A._arrays[k.slice(5)], b = res.B._arrays[k.slice(5)];
    if (!a || !b) continue;
    const idx = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) idx.push(i);
    console.log(`   ${k}: ${idx.length} cells differ, e.g. ${idx.slice(0, 8).map((i) => `${i}:${a[i]}→${b[i]}`).join(' ')}`);
  }
  if (diffs.length) allSame = false;
  console.log(`${id}: ${diffs.length ? 'DIFFERENT ' + diffs.join(', ') : 'identical'} (${Object.keys(res.A).length - 2} digests; load A ${res.A._ms} ms, B ${res.B._ms} ms)`);
  for (const k of ['nodes', 'geoms', 'mats']) {
    const a = res.A._lines[k], b = res.B._lines[k];
    if (a.join('\n') === b.join('\n')) continue;
    const n = Math.max(a.length, b.length);
    let shown = 0;
    for (let i = 0; i < n && shown < 4; i++) if (a[i] !== b[i]) { console.log(`   ${k}[${i}] A: ${(a[i] || '').slice(0, 220)}\n   ${k}[${i}] B: ${(b[i] || '').slice(0, 220)}`); shown++; }
  }
}
await browser.close();
process.exit(allSame ? 0 : 1);
