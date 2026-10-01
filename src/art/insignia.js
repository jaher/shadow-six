/**
 * Enemy flag insignia (Options → GAME PREFERENCES → INSIGNIA). Kept apart from art/flags.js so the HUD can set it
 * without pulling three.js. 'historical' (default, user decision 2026-09-30): the 1935–45 German national flag on
 * enemy flagpoles; 'neutral': the field-grey banner with a Balkenkreuz. Vehicle Balkenkreuz markings never change.
 * @module art/insignia
 */

export const INSIGNIA_MODES = Object.freeze(['historical', 'neutral']);

let mode = 'historical';
const listeners = new Set();

/** Current flag insignia mode. */
export function getInsignia() { return mode; }

/** Set the mode (unknown values fall back to 'historical'); listeners run only on a change. */
export function setInsignia(m) {
  const next = INSIGNIA_MODES.includes(m) ? m : 'historical';
  if (next === mode) return mode;
  mode = next;
  for (const fn of listeners) fn(mode);
  return mode;
}

/** Subscribe to changes; returns the unsubscribe function. */
export function onInsignia(fn) { listeners.add(fn); return () => listeners.delete(fn); }
