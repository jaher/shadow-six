#!/usr/bin/env node
/**
 * Where does the headless sim first leave the real game's? Plays mission `id`'s solution in both (browser: logic-only
 * Game.step; headless: headless.mjs step), samples every unit each `--every` ticks up to `--ticks`, and prints the
 * first sample/unit/field that differs.   node tools/solutions/headless-diff.mjs m17 [--every=10] [--ticks=6000]
 */
import { startHarness } from '../../tests/harness.mjs';
import { headlessDriver } from './headless.mjs';
import { boardPoint } from '../../src/abilities/drive.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? +a.slice(k.length + 3) : d; };
const id = args.find((x) => !x.startsWith('--')) || 'm17';
const every = arg('every', 10), maxTicks = arg('ticks', 6000);
// (a sample: one record per unit/vehicle, rounded so float noise below 1 mm is not a difference)
const SNAP = `(w) => {
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : String(v)), o = {};
  for (const u of [...w.commandos, ...w.enemies]) o[u.tag ?? u.id] = [r(u.x), r(u.z), r(u.heading), u.state, u.stance, u.hp, u.brain?.state ?? '', u.currentActionId ?? '', u.carryMode ?? '', u.settled ? 'S' : '', u.path ? u.path.length + ':' + u.path.slice(0, 3).map((p) => r(p.x) + ',' + r(p.z)).join('>') : 0].join(' ');
  for (const v of w.vehicles || []) o['v' + (v.tag ?? v.id)] = [r(v.x), r(v.z), r(v.heading), v.destroyed ? 1 : 0].join(' ');
  o.__rng = String(w.rng?.state ?? w.rng?.s ?? w.rng?.seed);
  const P = w.physics; o.__phys = P && !P.isNull ? [P.ragdolls.length, P.pendingSettle.length, P.props.active.length, ...P.ragdolls.flatMap((rd) => { const t = rd.bodies[0].translation(), q = rd.bodies[5].translation(); const f = (v) => Math.round(v * 1e6) / 1e6; return [rd.unit.tag, f(t.x), f(t.y), f(t.z), f(q.x), f(q.y), f(q.z)]; })].join(' ') : 'null';
  if (globalThis.__dump && w.tick >= (globalThis.__from || 0)) { const u = w.enemies.find((e) => e.tag === globalThis.__dump) || w.commandos.find((e) => e.tag === globalThis.__dump); if (u) o.__dump = JSON.stringify(globalThis.__plain({ b: { ...u.brain, enemy: undefined }, s: [u.speed, u._avScale, u._blockT, u._laneV, u._laneX, u._laneZ, u._holdFor, u._yieldAt, u._fv, u.moveMode, u._curveF, u._mdirX, u._mdirZ, u._ghostIds, u._apartHeld] }, 5)); }
  return o; }`;
import { plain } from '../../src/debug/gameplay-fingerprint.js';
globalThis.__plain = plain; globalThis.__dump = process.env.DUMP || null; globalThis.__from = +process.env.FROM || 0;
const snapFn = (0, eval)(SNAP);

async function runHeadless() {
  const out = [], logs = [];
  const D = await headlessDriver(id, { quiet: true, log: () => {} });
  const step = D.sim.step;
  D.sim.step = () => step(); // (the driver already holds `step`; sample through the world tick instead)
  const w = D.world;
  const base = D.step || null;
  const orig = D.sim.step;
  // sample via a wrapper installed before solve: re-make the driver with a sampling step
  const { makeDriver } = await import('./driver.mjs');
  w.events.on('*', (p, t) => { if (t !== 'unit:moved') logs.push(`${w.tick} ev ${t} ${p?.unit?.tag ?? p?.enemy?.tag ?? p?.id ?? ''} ${p?.x?.toFixed?.(2) ?? ''},${p?.z?.toFixed?.(2) ?? ''} ${p?.cause ?? p?.kind ?? ''}`); });
  const D2 = makeDriver(w, { onOrder: (role, u, o) => logs.push(`${w.tick} order ${role} ${String(o?.type || o?.id || o?.kind || o?.name || Object.keys(o || {}).join("+")) + " " + [o?.x, o?.z].join(",")}`), onWait: (l) => logs.push(`${w.tick} wait ${l}`), step: () => { orig(); if (w.tick % every === 0 && out.length < maxTicks / every) out.push(snapFn(w)); if (w.tick >= maxTicks) throw new Error('STOP'); }, dt: D.sim.dt, quiet: true, log: () => {} });
  const { solve } = await import(`./${id}.solution.mjs`);
  try { await solve(D2, { boardPoint }); } catch (e) { if (e.message !== 'STOP') console.log('headless ended:', e.message); }
  return { out, logs };
}

async function runBrowser() {
  const h = await startHarness();
  try {
    const page = await h.newPage({ width: 640, height: 360 });
    page.setDefaultTimeout(0);
    await h.openGame(page, '?test=1');
    await page.evaluate(async (mid) => { await window.__game.loadMission(mid); window.__game.start(); }, id);
    return await page.evaluate(async ([mid, every, maxTicks, SNAP, DUMP, FROM]) => {
      const G = window.__game, w = G.game.world, snap = (0, eval)(SNAP);
      globalThis.__plain = (await import('/src/debug/gameplay-fingerprint.js')).plain; globalThis.__dump = DUMP; globalThis.__from = FROM;
      const { makeDriver } = await import('/tools/solutions/driver.mjs');
      const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
      const { boardPoint } = await import('/src/abilities/drive.js');
      const dt = G.CONFIG.sim.dt, out = [], logs = [];
      w.events.on('*', (p, t) => { if (t !== 'unit:moved') logs.push(`${w.tick} ev ${t} ${p?.unit?.tag ?? p?.enemy?.tag ?? p?.id ?? ''} ${p?.x?.toFixed?.(2) ?? ''},${p?.z?.toFixed?.(2) ?? ''} ${p?.cause ?? p?.kind ?? ''}`); });

      const D = makeDriver(w, { dt, quiet: true, onOrder: (role, u, o) => logs.push(`${w.tick} order ${role} ${String(o?.type || o?.id || o?.kind || o?.name || Object.keys(o || {}).join("+")) + " " + [o?.x, o?.z].join(",")}`), onWait: (l) => logs.push(`${w.tick} wait ${l}`), log: () => {}, skipEscape: () => G.game.skipExtraction(),
        step: () => { G.game.step(dt); if (w.tick % every === 0 && out.length < maxTicks / every) out.push(snap(w)); if (w.tick >= maxTicks) throw new Error('STOP'); } });
      try { await solve(D, { boardPoint }); } catch (e) { if (e.message !== 'STOP') out.error = String(e.message); }
      return { out, logs };
    }, [id, every, maxTicks, SNAP, process.env.DUMP || null, +process.env.FROM || 0]);
  } finally { await h.close(); }
}

// (a unit's sample agrees when its words are equal and its numbers within --tol metres: float noise is not a divergence)
const tol = arg('tol', 0.02);
const same = (a, b) => {
  if (a === b) return true;
  const A = String(a).split(/[ ,:>]/), B = String(b).split(/[ ,:>]/);
  return A.length === B.length && A.every((t, i) => t === B[i] || (Number.isFinite(+t) && Number.isFinite(+B[i]) && t !== '' && Math.abs(t - B[i]) <= tol));
};
const sameSample = (x, y) => Object.keys({ ...x, ...y }).every((k) => k === '__dump' || same(x[k], y[k]));

const [H, B] = [await runHeadless(), await runBrowser()];
const [hl, br] = [H.out, B.out];
const n = Math.min(hl.length, br.length);
let bad = -1;
for (let i = 0; i < n && bad < 0; i++) if (!sameSample(hl[i], br[i])) bad = i;
console.log(`${id}: ${hl.length} headless vs ${br.length} browser samples (every ${every} ticks)`);
if (bad < 0) { console.log('IDENTICAL over the compared span'); process.exit(0); }
const dt = 1 / 60;
console.log(`first difference at sample ${bad} (tick ${bad * every})`);
const leaves = (a, b, p, out) => { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) leaves(a[k], b[k], p + '.' + k, out); } else out.push(`${p}: ${JSON.stringify(a)} | ${JSON.stringify(b)}`); };
for (const k of Object.keys(hl[bad])) if (k === '__dump' || !same(hl[bad][k], br[bad][k])) {
  if (k === '__dump') { const o = []; leaves(JSON.parse(hl[bad][k]), JSON.parse(br[bad][k]), '', o); console.log('  __dump differs:\n    ' + o.filter((l) => !/prev/.test(l)).slice(0, 60).join('\n    ')); const o2 = []; if (bad) leaves(JSON.parse(hl[bad - 1][k]), JSON.parse(br[bad - 1][k]), '', o2); console.log('  (previous sample dump differs:\n    ' + o2.filter((l) => !/prev/.test(l)).slice(0, 30).join('\n    ') + ')'); } else
  console.log(`  ${k}: headless [${hl[bad][k]}]  browser [${br[bad][k]}]`); }
if (bad) for (const k of Object.keys(hl[bad]).filter((k) => !same(hl[bad][k], br[bad][k])).slice(0, 2)) console.log(`  (prev ${k}: ${hl[bad - 1][k]})`);
const near = (L) => L.filter((l) => Math.abs(parseInt(l) - bad * every) < 1400 && (!/ ev /.test(l) || Math.abs(parseInt(l) - bad * every) < 6));
console.log('--- headless orders/waits near it:\n' + near(H.logs).join('\n'));
console.log('--- browser:\n' + near(B.logs).join('\n'));
process.exit(1);
