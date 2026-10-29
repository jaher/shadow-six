#!/usr/bin/env node
/**
 * Rail clearance report (src/missions/rail-clearance.js): every building / structure / natural footprint inside a rail
 * corridor, per mission (the grid-only build's footprints, as tests/unit/rails-clear.test.mjs checks them).
 * Usage: node tools/layout/rail-report.mjs [--near 3] [--json] [mNN…]
 *   --near m   also list items up to m metres past their corridor (marked "near")
 *   --view     also list (advisory) structures whose height hides the rails from the default camera (pitch 40, yaw 15)
 * ALLOWED lines: what a per-rail `onRails: { <rail id>: '<reason>' }` tag lets run over its one track (M4's wire over siding_a).
 */
import { register } from 'node:module';

register('../../tests/unit/resolve-hooks.mjs', import.meta.url); // 'three' → vendor/
const { MISSIONS } = await import('../../src/missions/index.js');
const { railClearance, viewCover } = await import('../../src/missions/rail-clearance.js');
const { loadGrid } = await import('../../tests/unit/mission-check.mjs');
const { drawnPlans } = await import('../../tests/unit/rail-drawn.mjs');
const { vehicleDef } = await import('../../src/entities/vehicle.js');

const args = process.argv.slice(2);
const near = args.includes('--near') ? +args[args.indexOf('--near') + 1] : 0;
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--near');
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
  if (args.includes('--view')) for (const v of viewCover(def, handle.structures, { vehicleSize })) console.log(`  view     ${v.id.padEnd(26)} ${v.type.padEnd(14)} h ${v.h} hides ${v.rail} rails by ${v.cover.toFixed(2)} m`);
}
if (args.includes('--json')) console.log(JSON.stringify(all, null, 1));
else console.log(`\n${bad} structure overlap(s)`);
