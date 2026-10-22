/**
 * Per-tick simulation state (tests/debug-walkthrough-cold.test.mjs, tools/perf/cold-trace.mjs): what a run IS, tick by
 * tick — the seeded RNG, the alarm, every unit (place, height, heading, state, stance, hp, brain state, path, order,
 * target), every vehicle, every objective. Two runs of a solution that print the same hash at every tick played the
 * same game: the logic-only regression run (?test=1, no frame drawn) and the walkthrough a cold link plays live, with
 * its frames, its pacing and its art loading as fast or as slow as the link allows.
 *
 * Pure reads (never a getter with a side effect, never a lazily built cache); numbers rounded to 1e-6.
 * @module debug/sim-trace
 */

const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) : String(v));

/** One line per thing that plays: [world, ...units, ...vehicles, ...objectives]. @returns {string[]} */
export function simStateLines(w) {
  const out = [`tick ${w.tick} time ${r6(w.time)} rng ${w.rng?.state} alarm ${w.alarm?.active ? 1 : 0}`];
  for (const u of [...w.commandos, ...w.enemies]) {
    out.push(`${u.tag ?? u.id} x${r6(u.x)} z${r6(u.z)} y${r6(u.y)} h${r6(u.heading)} ${u.state} ${u.stance} hp${u.hp} b:${u.brain?.state ?? ''}`
      + ` path${u.path ? u.path.length : 0} pi${u.pathIndex ?? ''} ord:${u.order?.type ?? ''} tgt:${u.target?.tag ?? u.target?.id ?? ''}`);
  }
  for (const v of w.vehicles || []) out.push(`${v.tag ?? v.id} x${r6(v.x)} z${r6(v.z)} h${r6(v.heading)} d${v.destroyed ? 1 : 0} occ${(v.occupants || []).length}`);
  for (const o of w.objectives || []) out.push(`${o.id} ${o.done ? 1 : 0}${o.failed ? 'F' : ''}`);
  return out;
}

/** FNV-1a of a string, as 8 hex digits. */
export function fnv(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0).toString(16).padStart(8, '0');
}

/**
 * A recorder: `rec.snap(world)` after every tick keeps the tick's hash, and every `every` ticks the line hashes (so a
 * divergence names the unit). `rec.data()` → {hashes, lines: {tick: [hash…]}, tags: {tick: [first word…]}}.
 */
export function simRecorder({ every = 60 } = {}) {
  const hashes = [], lines = {}, tags = {};
  return {
    snap(w) {
      const L = simStateLines(w);
      hashes.push(fnv(L.join('|')));
      if (w.tick % every === 0) { lines[w.tick] = L.map(fnv); tags[w.tick] = L.map((s) => s.split(' ')[0]); }
    },
    data: () => ({ hashes, lines, tags, every }),
  };
}

/**
 * Compare two recordings (index 0 = the first tick after the start). @returns {{same: boolean, first: number|null,
 * n: [number, number], units: string[]}} first: the index of the first tick that differs (null: none, though the
 * lengths may); units: the lines that differ at the first per-line sample at or after it.
 */
export function compareRecordings(a, b) {
  const n = Math.min(a.hashes.length, b.hashes.length);
  let first = null;
  for (let i = 0; i < n; i++) if (a.hashes[i] !== b.hashes[i]) { first = i; break; }
  let units = [];
  if (first != null) {
    const ks = Object.keys(a.lines).map(Number).filter((k) => b.lines[k] && k >= first).sort((p, q) => p - q);
    const k = ks[0];
    if (k != null) units = a.lines[k].map((h, i) => (h !== b.lines[k][i] ? `${a.tags[k][i]}${a.tags[k][i] !== b.tags[k]?.[i] ? `/${b.tags[k]?.[i]}` : ''}` : null)).filter(Boolean);
  }
  return { same: first == null && a.hashes.length === b.hashes.length, first, n: [a.hashes.length, b.hashes.length], units };
}
