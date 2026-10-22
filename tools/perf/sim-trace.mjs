#!/usr/bin/env node
/**
 * Determinism trace: play a mission's scripted solution logic-only (?test=1, no frames drawn) and hash the whole sim
 * state every `--every` ticks (every unit's place, heading, state, brain state, hp; vehicles; alarm; objectives; the
 * seeded RNG). Two checkouts that play the same run print the same hashes — compare a branch with master:
 *
 *   node tools/perf/sim-trace.mjs m03 [--root=<checkout>] [--every=60] [--out=trace.json] [--pause]
 * (--pause: the driver's sliced plans hand control back between slices — a macrotask, no tick — as in the live replay)
 * (--defer: Game.deferVisuals as under the replay: the visual-only event handlers run after each tick, not inside it)
 *   node tools/perf/sim-trace.mjs --diff a.json b.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
if (args[0] === '--diff') {
  const [a, b] = [args[1], args[2]].map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const n = Math.min(a.hashes.length, b.hashes.length);
  let first = -1;
  for (let i = 0; i < n; i++) if (a.hashes[i] !== b.hashes[i]) { first = i; break; }
  console.log(`${a.hashes.length} vs ${b.hashes.length} samples; result ${JSON.stringify(a.result)} vs ${JSON.stringify(b.result)}`);
  console.log(first < 0 && a.hashes.length === b.hashes.length ? 'IDENTICAL' : `DIFFER at sample ${first} (tick ${first * a.every})`);
  process.exit(first < 0 && a.hashes.length === b.hashes.length ? 0 : 1);
}
const id = args.find((x) => !x.startsWith('--')) || 'm03';
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(0);
await page.goto(`${server.url.replace(/\/$/, '')}/index.html?test=1`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async (mid) => { await window.__game.loadMission(mid); window.__game.start(); }, id);
const out = await page.evaluate(async ([mid, every, slice, defer]) => {
  const G = window.__game, w = G.game.world;
  // (--defer: the replay's deferVisuals — the visual-only handlers of a tick run after it, as at the next draw)
  if (defer) G.game.deferVisuals = true;
  const flush = () => { if (defer) G.game.events.flushLate(); };
  const { makeDriver } = await import('/tools/solutions/driver.mjs');
  const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
  const { boardPoint } = await import('/src/abilities/drive.js');
  const dt = G.CONFIG.sim.dt, hashes = [];
  const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) : String(v));
  const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const snap = () => {
    const parts = [w.tick, r6(w.time), w.rng?.state ?? w.rng?.s ?? '', w.alarm?.active ? 1 : 0, w.grid?.version];
    for (const u of [...w.commandos, ...w.enemies]) parts.push(u.tag ?? u.id, r6(u.x), r6(u.z), r6(u.y), r6(u.heading), u.state, u.stance, u.hp, u.brain?.state ?? '', u.path ? u.path.length : 0);
    for (const v of w.vehicles || []) parts.push(v.tag ?? v.id, r6(v.x), r6(v.z), r6(v.heading), v.destroyed ? 1 : 0, (v.occupants || []).length);
    for (const o of w.objectives || []) parts.push(o.id, o.done ? 1 : 0);
    return fnv(parts.join('|'));
  };
  let pauses = 0;
  const D = makeDriver(w, { dt, quiet: true, log: () => {}, step: () => { flush(); G.game.step(dt); if (w.tick % every === 0) hashes.push(snap()); },
    pause: slice ? () => new Promise((res) => { pauses++; setTimeout(res, 0); }) : null });
  let error = null;
  try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
  for (let i = 0; i < 600 && G.game.state === 'playing'; i++) { flush(); G.game.step(dt); if (w.tick % every === 0) hashes.push(snap()); }
  return { hashes, every, pauses, result: { error, time: +D.t.toFixed(2), state: G.game.state, det: D.detections(), exp: D.exposures().length, cps: D.checkpoints.map((c) => `${c.name.split(' ')[0]}@${c.t}`).join(' ') } };
}, [id, +arg('every', 60), args.includes('--pause'), args.includes('--defer')]);
await browser.close(); await server.close();
console.log(`${id} ${ROOT}: ${out.hashes.length} samples, ${out.pauses} plan pauses, ${JSON.stringify(out.result)}`);
if (arg('out', '')) writeFileSync(arg('out'), JSON.stringify(out));
