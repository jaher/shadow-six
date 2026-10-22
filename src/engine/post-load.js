/**
 * After the loading screen (perf/download-speed-2): what a mission does not need before its briefing — the bodies' HD
 * textures (engine/hd-textures.js), the spoken lines and the portraits' talking clips (audio/engine.js,
 * ui/talking-portraits.js) — downloads once the loading screen has closed, while the player reads the briefing,
 * instead of holding the loading screen up.
 *
 *   afterLoadScreen(() => work())   // runs at once when the screen is already down, else when it closes
 *   loadScreenDown()                // ui/loading.js when the card closes; Game when play starts (no card: tests, links)
 *   loadScreenUp()                  // Game.loadMission at its start: work queued from now waits for the next close
 *
 * Callbacks run once each; `isLoadScreenDown()` lets a long job pause when a new load begins. The generation counter
 * (`loadGeneration()`) tells a job whether the load it was queued for is still the current one.
 * @module engine/post-load
 */

let down = true; // no load yet (menus, tests that build no mission): nothing waits
let gen = 0;
let waiting = [];

/** A mission load has started: work queued from now waits until its loading screen closes. */
export function loadScreenUp() {
  down = false;
  gen++;
}

/** The loading screen is down (or play started without one): run what waited. */
export function loadScreenDown() {
  if (down) return;
  down = true;
  const run = waiting;
  waiting = [];
  for (const f of run) {
    try { f(); } catch (e) { console.warn('[post-load]', e); }
  }
}

/** Run `fn` once the loading screen is down (at once when it already is). */
export function afterLoadScreen(fn) {
  if (down) {
    try { fn(); } catch (e) { console.warn('[post-load]', e); }
  } else waiting.push(fn);
}

/** Is the loading screen down (no mission load in progress)? */
export const isLoadScreenDown = () => down;

/** Counter bumped by every load (a job queued for an earlier load sees it changed). */
export const loadGeneration = () => gen;
