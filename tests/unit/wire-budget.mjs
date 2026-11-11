/**
 * The budget of a mission's wire layer (docs/barbed-wire.md §7), shared by wire-placements.test.mjs and
 * barbed-wire.test.mjs. Not a *.test.mjs file.
 *
 * What the build produces is a count, the same on every machine: a hard bound. What it costs to build is a time, and
 * a time is a property of the machine, so it is never bounded in milliseconds: the first build in a process pays the
 * JIT, a shared CI runner is 2-4x slower than a desktop, and one GC pause or loaded second lands in a single reading
 * (M10 read 116 ms and 207 ms in two public CI runs of the same wire code, against a 150 ms bound). The warm build is
 * measured in reference workloads instead (tests/unit/cpu-speed.mjs); the cold build is only logged.
 */
import { buildMissionWire } from '../../src/art/wire-obstacles.js';
import { railBeds } from '../../src/missions/rail-clearance.js';
import { costUnits } from './cpu-speed.mjs';

export const WIRE_BUDGET = {
  ribbonTris: 200000, // triangles built (§7's drawn limit, held for all that is built: M10, the largest, builds 34 k strand triangles before its barbs)
  drawCalls: 40,      // wire draw objects
  buildUnits: 10,     // a whole warm build in reference workloads: M10 ~1.7 (1.3-2.9 from a calm host to load 73), M4 ~2, M3 ~1, the rest under 1.7
};

/** The built layer's counts that are over their limits (empty = within budget). @param {{ ribbonTris: number, drawCalls: number }} stats */
export function wireCountProblems(stats) {
  const p = [];
  if (!(stats.ribbonTris < WIRE_BUDGET.ribbonTris)) p.push(`${stats.ribbonTris} ribbon triangles (limit ${WIRE_BUDGET.ribbonTris})`);
  if (!(stats.drawCalls <= WIRE_BUDGET.drawCalls)) p.push(`${stats.drawCalls} draw calls (limit ${WIRE_BUDGET.drawCalls})`);
  return p;
}

/**
 * What a whole build of the mission's wire layer costs now (every run's parts, then the strands: what the map builder
 * does at load, `buildMissionWire`), warm, in reference workloads. The map is built (its first, cold build is
 * `handle.wire.stats.buildMs`); each build here is thrown away again.
 * @param {*} world @param {{ propsRoot: *, terrain: * }} handle @param {*} def the mission
 */
export function wireBuildCost(world, handle, def) {
  const theater = def.theater || 'temperate'; // as map-builder derives them
  const o = { terrain: handle.terrain, theater, mission: def, world, night: theater === 'night' || !!def.lighting?.night, rails: railBeds(def) };
  const build = () => {
    const L = buildMissionWire(handle.propsRoot, o);
    if (!L) throw new Error(`${def.id}: the wire layer did not build`);
    L.dispose();
  };
  build(); build(); // the JIT settles
  return costUnits(build, { limit: WIRE_BUDGET.buildUnits });
}

/** The message of a build over its limit. @param {{ units: number, ms: number, refMs: number, rounds: number }} c */
export const wireCostMessage = (id, c) => `${id}: a warm build costs ${c.units.toFixed(2)} reference loops (${c.ms.toFixed(1)} ms; a loop ${c.refMs.toFixed(1)} ms; best of ${c.rounds} rounds), limit ${WIRE_BUDGET.buildUnits}`;
