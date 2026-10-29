#!/usr/bin/env node
/**
 * Rail clearance report (src/missions/rail-clearance.js): every building / structure / natural footprint inside a rail
 * corridor, per mission (the grid-only build's footprints, as tests/unit/rails-clear.test.mjs checks them).
 * Usage: node tools/layout/rail-report.mjs [--near 3] [--json] [mNN…]
 *   --near m   also list items up to m metres past their corridor (marked "near")
 *   --view     also list the structures that hide rail heads from the default camera (pitch 40, yaw 15; viewHidden, the
 *              library models' drawn walls and roofs: tests/unit/rail-drawn.mjs drawnSolids); --yaw d / --pitch d another view
 *              (as drawn, in the browser: tools/layout/rail-view-probe.mjs)
 * ALLOWED lines: what a per-rail `onRails: { <rail id>: '<reason>' }` tag lets run over its one track (M4's wire over siding_a).
 */
import { register } from 'node:module';

register('../../tests/unit/resolve-hooks.mjs', import.meta.url); // 'three' → vendor/
const { MISSIONS } = await import('../../src/missions/index.js');
const { railClearance, viewHidden } = await import('../../src/missions/rail-clearance.js');
const { loadGrid } = await import('../../tests/unit/mission-check.mjs');
const { drawnPlans, drawnSolids } = await import('../../tests/unit/rail-drawn.mjs');
const { vehicleDef } = await import('../../src/entities/vehicle.js');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? +args[args.indexOf(k) + 1] : d);
const near = opt('--near', 0), yawDeg = opt('--yaw', 15), pitchDeg = opt('--pitch', 40);
const ids = args.filter((a, i) => !a.startsWith('--') && !['--near', '--yaw', '--pitch'].includes(args[i - 1]));
const vehicleSize = (t) => { try { return vehicleDef(t)?.size ?? null; } catch { return null; } };
const all = [];
let bad = 0;
for (const m of MISSIONS) {
  if (ids.length && !ids.includes(m.id)) continue;
  const { def, handle } = loadGrid(m);
  const r = railClearance(def, handle.structures, { vehicleSize, near, drawn: await drawnPlans(def) });
  if (!r.rails.length) continue;
  all.push({ mission: m.id, rails: r.rails.map((q) => ({ id: q.id, kind: q.kind, half: q.half })), hits: r.hits, allowed: r.allowed });
  if (args.includes('--json')) continue;
  console.log(`\n${m.id}: ${r.rails.map((q) => `${q.id}(${q.kind} ±${q.half.toFixed(2)})`).join(' ')}`);
  for (const h of r.hits) {
    const tag = h.overlap > 0 ? (h.natural ? 'NATURAL' : 'OVERLAP') : 'near';
    if (h.overlap > 0 && !h.natural) bad++;
    console.log(`  ${tag.padEnd(8)} ${h.id.padEnd(26)} ${h.type.padEnd(14)} ${h.variant.slice(0, 24).padEnd(24)} ${h.rail.padEnd(12)} ${h.kind.padEnd(8)} dist ${h.dist.toFixed(2)} need ${h.need.toFixed(2)} (${h.overlap > 0 ? '+' : ''}${h.overlap.toFixed(2)})`);
  }
  for (const a of r.allowed) console.log(`  ALLOWED  ${a.id.padEnd(26)} ${a.type.padEnd(14)} ${a.variant.slice(0, 24).padEnd(24)} ${a.rail.padEnd(12)} ${a.kind.padEnd(8)} dist ${a.dist.toFixed(2)} need ${a.need.toFixed(2)} — ${a.why}`);
  if (args.includes('--view')) {
    for (const v of viewHidden(def, handle.structures, { vehicleSize, solids: await drawnSolids(def), yawDeg, pitchDeg })) {
      console.log(`  view     ${v.id.padEnd(26)} ${v.type.padEnd(14)} h ${String(v.h).padEnd(6)} hides ${v.hidden.toFixed(1).padStart(5)} m of ${v.rail} rail heads (${v.track.toFixed(1)} m of line, s ${v.s.join('–')})${v.tag ? `  [${v.tag}]` : ''}`);
    }
  }
}
if (args.includes('--json')) console.log(JSON.stringify(all, null, 1));
else console.log(`\n${bad} structure overlap(s)`);
