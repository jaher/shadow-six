/**
 * Work that can wait for a still moment. Some caches fill lazily at first use — a body's prone clips fitted to it
 * (art/characters/prone-fit.js, 20–80 ms each), an enemy variant's ground curves (enemies/enemy_runtime.js) — and the
 * first use mid-play is a 20–80 ms frame. A mission queues them here once loaded; hosts with a still screen (the
 * walkthrough's title and chapter cards) run one per frame there (`runOne`); whatever is still queued when play needs
 * it is done lazily at that first use, as before. Every task is idempotent and changes nothing but a cache: the same
 * result whenever it runs, so the simulation and the picture are the same with or without it.
 * @module engine/idle-warm
 */

const Q = [];
let gen = 0;

export const idleWarm = {
  /** Queue `fn` (a cache fill: idempotent, visual only). */
  add(label, fn) { Q.push({ label, fn, gen }); },
  /** Drop everything queued (mission unload: the tasks hold the old mission's units). */
  clear() { Q.length = 0; gen++; },
  get pending() { return Q.length; },
  /** Run the next task; false when none is left. */
  runOne() {
    const t = Q.shift();
    if (!t) return false;
    if (t.gen === gen) try { t.fn(); } catch (e) { console.warn(`[idle-warm] ${t.label}`, e); }
    return true;
  },
};
