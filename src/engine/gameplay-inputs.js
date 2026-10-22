/**
 * Waiting for what the gameplay world measures on loaded art (user 2026-10-22: a walkthrough opened from a cold link
 * must play exactly the tested run — "the live run must be identical to the logic run checkpoint for checkpoint").
 *
 * The load used to race these against a clock (the library buildings' preload 25 s, the tree branches 60 s, the
 * static vehicles' models 60 s) and play on with whatever had arrived: on a slow link the map was stamped on library
 * buildings still loading (no visual nav, eaves, levelled bases, body solids or doors from their meshes), the gun-arc
 * branches or a parked lorry's solid landed seconds into play — or never — and the run drifted off the tested one
 * (M2 with the building GLBs 30 s late: 10 gameplay fields differ at tick 0, D1 at 293.17 instead of 293.37).
 *
 * The rule now: a gameplay input is awaited however long it takes (the loading bar keeps moving; a failed download
 * resolves to its fallback, as before), never raced. A slow one is logged every `everyMs` so a stall is visible.
 * Only what the drawing needs (textures, LODs other than the finest, warm-ups) keeps its bounded waits.
 * @module engine/gameplay-inputs
 */

/**
 * Await `p` with no time limit, logging every `everyMs` while it is pending.
 * @template T @param {Promise<T>|T} p @param {string} label @param {{everyMs?: number}} [o] @returns {Promise<T>}
 */
export async function awaitGameplayInput(p, label, { everyMs = 15000 } = {}) {
  if (!p || typeof p.then !== 'function') return p;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let timer = null, done = false;
  const tick = () => {
    if (done) return;
    const s = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / 1000;
    console.warn(`[load] still waiting for ${label} (${s.toFixed(0)} s): play starts once it is in — the gameplay world never depends on how fast it loads`);
    timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, everyMs);
  try { return await p; } finally { done = true; clearTimeout(timer); }
}
