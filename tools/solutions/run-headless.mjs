#!/usr/bin/env node
/**
 * Play a mission solution headless (no renderer) and report its checkpoints. APPROXIMATE: the headless grid has no
 * library-mesh nav clearance (buildMap meshes:false), so paths and timings drift from the game; the reference run is
 * tools/solutions/run-browser.mjs.
 *   node tools/solutions/run-headless.mjs m03 [--quiet] [--json out.json]
 * Exit code 0 when every objective is done with no commando detected (enemy:spotted / challenge / unmasked / tainted).
 */
import { headlessDriver } from './headless.mjs';
import { boardPoint } from '../../src/abilities/drive.js';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) || 'm03';
const quiet = args.includes('--quiet');
const jsonAt = args.indexOf('--json');
const { solve } = await import(`./${id}.solution.mjs`);
const D = await headlessDriver(id, { quiet });
const t0 = Date.now();
let error = null;
const ji = args.indexOf('--jitter'); // robustness probe: a seeded random hesitation (0–0.6 s) before every move order
if (ji >= 0) {
  let seed = +args[ji + 1] || 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const go = D.go;
  D.go = async (...a) => { await D.wait(Math.round(rnd() * 36) * D.dt); return go(...a); };
}
const di = args.indexOf('--delay'); // robustness probe: start the solution N ticks late
if (di >= 0) await D.wait(+args[di + 1] * D.dt);
try {
  await solve(D, { boardPoint, onStage: (s, title) => console.log(`== stage ${s}: ${title} (t=${D.t.toFixed(1)})`) });
} catch (e) { error = e; console.error(e.stack || e); }
const obj = Object.fromEntries(D.world.objectives.map((o) => [o.id, o.done]));
const exposed = D.exposureReport();
if (exposed.length) console.log(`EXPOSED ${exposed.length}:\n  ${exposed.join('\n  ')}`);
const ok = !error && Object.values(obj).every(Boolean) && D.detections() === 0 && !exposed.length;
const report = { mission: id, ok, error: error ? String(error.message || error) : null, time: +D.t.toFixed(2), objectives: obj,
  detections: D.detections(), exposures: exposed, kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line), alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => `${e.t.toFixed(1)} ${e.line}`),
  checkpoints: D.checkpoints, wallMs: Date.now() - t0 };
console.log(`${ok ? 'WIN' : 'FAIL'} ${id} t=${report.time}s objectives=${JSON.stringify(obj)} detections=${report.detections} exposures=${exposed.length} (${report.wallMs} ms)`);
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(report, null, 1));
process.exit(ok ? 0 : 1);
