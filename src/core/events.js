/**
 * EventBus — the single publish/subscribe channel of the game (`world.events` === `game.events`).
 * Pure module (no three.js), usable from Node unit tests.
 * Canonical event names and payloads are listed in docs/ARCHITECTURE.md.
 * @module core/events
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
    /** When true, every emit is also passed to `this.tap` (used by the test API / debug log). */
    this.tap = null;
  }

  /**
   * Subscribe to an event type. Use `'*'` to receive every event as `fn(payload, type)`.
   * @param {string} type
   * @param {(payload: any, type: string) => void} fn
   * @returns {() => void} unsubscribe function
   */
  on(type, fn) {
    let set = this._handlers.get(type);
    if (!set) this._handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  /**
   * Unsubscribe a handler previously registered with on()/once().
   * @param {string} type
   * @param {Function} fn
   */
  off(type, fn) {
    const set = this._handlers.get(type);
    if (!set) return;
    set.delete(fn);
    if (fn._onceWrapper) set.delete(fn._onceWrapper);
    if (set.size === 0) this._handlers.delete(type);
  }

  /**
   * Subscribe for a single delivery.
   * @param {string} type
   * @param {(payload: any, type: string) => void} fn
   * @returns {() => void} unsubscribe function
   */
  once(type, fn) {
    const wrapper = (payload, t) => {
      this.off(type, wrapper);
      fn(payload, t);
    };
    fn._onceWrapper = wrapper;
    return this.on(type, wrapper);
  }

  /**
   * Emit an event synchronously. Handlers run in subscription order; an exception in one handler is
   * reported (console.error) but does not stop delivery to the others.
   * @param {string} type
   * @param {any} [payload]
   */
  emit(type, payload) {
    if (this.tap) this.tap(type, payload);
    const set = this._handlers.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload, type);
        } catch (err) {
          console.error(`[events] handler for "${type}" threw`, err);
        }
      }
    }
    const any = this._handlers.get('*');
    if (any) for (const fn of [...any]) fn(payload, type);
  }

  /** Number of handlers for a type (diagnostics/tests). */
  listenerCount(type) {
    return this._handlers.get(type)?.size ?? 0;
  }

  /** Remove every handler. */
  clear() {
    this._handlers.clear();
  }
}

/**
 * Canonical world.events names (docs/ARCHITECTURE.md event table + "Cross-team interfaces").
 * tests/unit/interfaces.test.mjs fails when src/ emits a name missing here — add new events to BOTH
 * this list and the ARCHITECTURE table (with payload) in the same commit.
 */
export const EVENT_NAMES = Object.freeze([
  // units
  'unit:selected', 'unit:order', 'unit:damaged', 'unit:killed', 'unit:stance', 'unit:captured', 'unit:jailed',
  'unit:freed', 'unit:held', 'unit:step', 'unit:climb', 'unit:water', 'footprint',
  // abilities / items
  'ability:start', 'ability:end', 'ability:refused', 'bomb:armed', 'bomb:detonate', 'bomb:exploded', 'trap:sprung', 'projectile:bounce', 'hit',
  // enemies / AI
  'enemy:state', 'enemy:spotted', 'enemy:challenge', 'enemy:held', 'enemy:body-found', 'enemy:distracted', 'enemy:unmasked-spy',
  'enemy:noise-turn',
  'alarm:start', 'alarm:end', 'alarm:zone', 'reinforcements', 'noise',
  // world
  'shot', 'explosion', 'fire', 'structure:destroyed', 'door', 'device',
  'vehicle:enter', 'vehicle:exit', 'vehicle:move', 'vehicle:stop', 'vehicle:fire', 'vehicle:runover', 'vehicle:destroyed',
  'vehicle:tainted', 'train:pass', 'wind:gust', 'wind:flag',
  // mission / flow
  'objective:update', 'mission:loading', 'mission:progress', 'mission:loaded', 'mission:won', 'mission:lost', 'mission:refused', 'game:state', 'flow:state',
  'mission:countdown', 'mission:escaped', 'camera:views',
  // ui
  'message', 'bark', 'ui:cursor', 'ui:warning', 'ui:move-marker', 'ui:click', 'ui:command', 'ui:tooltip', 'ui:probe',
  // engine
  'assets:progress',
  // BCD (docs/bcd-plan.md)
  'bcd:mine',
  'bcd:puppet',
  'enemy:ko-missed',
  'bcd:pack-taken',
  'bcd:pack-lured',
  'bcd:stone',
  'enemy:snitched',
  'enemy:flee',
  'enemy:freed',
  'enemy:revived',
  'enemy:ko-found',
  'enemy:woke',
  'enemy:roused',
  'enemy:rearmed',
  'enemy:cuffed',
  'enemy:ko',
]);
