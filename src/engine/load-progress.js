/**
 * Real mission-load progress (art integration 2, step 4). Game.loadMission walks fixed stages; while a stage runs,
 * the bytes actually received (Resource Timing: encodedBodySize, 0 for cache hits) move the bar inside it, measured
 * against the mission's expected transfer (assets/load-budget.json, written by tools/perf/measure-load.mjs --budget;
 * missions not in the file use `default`). A cold load follows the bytes, a warm (cached) one the stages. Monotonic.
 *
 *   const prog = createLoadProgress({ events, id: 'm01', preset: 'high', budget });
 *   prog.stage('buildings'); … prog.done();   // → 'mission:progress' {id, p, stage, bytes, expected, files}
 *
 * @module engine/load-progress
 */

/** Stage → share of the bar (sums to 1). The order is the one Game.loadMission runs them in. */
export const LOAD_STAGES = Object.freeze([
  ['lighting', 0.04], ['buildings', 0.26], ['characters', 0.2], ['vehicles', 0.04], ['terrain', 0.3], ['units', 0.12], ['finish', 0.04],
]);
const BOUNDS = (() => {
  const out = {};
  let a = 0;
  for (const [n, w] of LOAD_STAGES) { out[n] = [a, a + w]; a += w; }
  return out;
})();

/** Mission transfer budget (bytes) for a preset: exact entry, the mission's other preset, or the default. */
export function expectedBytes(budget, id, preset) {
  const m = budget?.missions?.[id];
  const alt = preset === 'ultra' ? 'high' : preset === 'medium' ? 'high' : preset;
  return m?.[preset] ?? m?.[alt] ?? m?.high ?? budget?.default ?? 90e6;
}

let budgetP = null;
/** Fetch assets/load-budget.json once (null when missing: every mission uses the built-in default). */
export function loadBudget(url = new URL('../../assets/load-budget.json', import.meta.url).href) {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  budgetP ||= fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return budgetP;
}

/**
 * @param {{events?: {emit: Function}, id?: string, preset?: string, budget?: object|null, now?: () => number}} o
 */
export function createLoadProgress(o = {}) {
  const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const expected = expectedBytes(o.budget, o.id, o.preset);
  const t0 = now();
  let bytes = 0, files = 0, p = 0, stage = 'lighting', closed = false;
  let obs = null;
  const count = (list) => {
    for (const e of list.getEntries()) { bytes += e.encodedBodySize || 0; files++; }
    emit();
  };
  if (typeof PerformanceObserver === 'function') {
    try {
      performance.setResourceTimingBufferSize?.(4000);
      obs = new PerformanceObserver(count);
      obs.observe({ type: 'resource', buffered: false });
    } catch { obs = null; }
  }
  function emit(sub = 0) {
    if (closed) return;
    const [lo, hi] = BOUNDS[stage] || [0, 1];
    const byStage = lo + (hi - lo) * Math.max(0, Math.min(1, sub));
    const byBytes = Math.min(hi, bytes / expected);
    p = Math.max(p, byStage, byBytes);
    o.events?.emit?.('mission:progress', { id: o.id, p, stage, bytes, expected, files });
  }
  return {
    get p() { return p; },
    get bytes() { return bytes; },
    get files() { return files; },
    expected,
    /** Enter a stage (the bar jumps to its start at least); `sub` 0..1 inside it. */
    stage(name, sub = 0) {
      if (BOUNDS[name]) stage = name;
      emit(sub);
    },
    /** Abandon (the load was replaced): stop observing, emit nothing more. */
    cancel() {
      obs?.disconnect();
      closed = true;
    },
    /** Finish: p = 1, stop observing. @returns {{bytes:number, files:number, ms:number, expected:number}} */
    done() {
      if (obs) { try { count({ getEntries: () => obs.takeRecords?.() || [] }); } catch { /* ignore */ } obs.disconnect(); }
      stage = 'finish';
      emit(1);
      p = 1;
      o.events?.emit?.('mission:progress', { id: o.id, p: 1, stage: 'done', bytes, expected, files });
      closed = true;
      return { bytes, files, ms: Math.round(now() - t0), expected };
    },
  };
}
