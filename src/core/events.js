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
    /**
     * While true (a host that draws after its ticks has the visual handlers wait for its next draw: Game.step under
     * `deferVisuals`), handlers subscribed with onLate() are queued instead of run, until flushLate().
     */
    this.deferring = false;
    /** Queued late handler calls: [fn, payload, type, captured, …]. */
    this._lateQ = [];
  }

  /**
   * Subscribe a handler that only draws or sounds — effects, crater marks, the blast front's visuals, audio — and
   * never touches the simulation. It runs at once, in subscription order with the others, unless the bus is
   * `deferring`: then the call is queued and made by flushLate() (the next frame, before its draw), in emit order.
   * `capture()`, when given, is called at emit time and its value passed as the handler's third argument (an effect's
   * clock at the event, so what it spawns late is born when the event happened).
   * @param {string} type
   * @param {(payload: any, type: string, captured?: any) => void} fn
   * @param {() => any} [capture]
   * @returns {() => void} unsubscribe function
   */
  onLate(type, fn, capture = null) {
    fn._late = capture || true;
    return this.on(type, fn);
  }

  /** Make the queued late handler calls (see onLate). @returns {number} calls made */
  flushLate() {
    const q = this._lateQ;
    if (!q.length) return 0;
    this._lateQ = [];
    for (let i = 0; i < q.length; i += 4) {
      try { q[i](q[i + 1], q[i + 2], q[i + 3]); } catch (err) { console.error(`[events] late handler for "${q[i + 2]}" threw`, err); }
    }
    return q.length / 4;
  }

  /** Forget the queued late calls (the world they were for is gone). */
  dropLate() { this._lateQ = []; }

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
        if (fn._late && this.deferring) { this._lateQ.push(fn, payload, type, typeof fn._late === 'function' ? fn._late() : undefined); continue; }
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
  'unit:freed', 'unit:held', 'unit:step', 'unit:climb', 'unit:water', 'raft:hiss', 'footprint', 'dragmark',
  // abilities / items
  'ability:start', 'ability:end', 'ability:refused', 'bomb:armed', 'bomb:detonate', 'bomb:exploded', 'bomb:disarmed', 'trap:sprung', 'projectile:bounce', 'hit',
  // enemies / AI
  'enemy:state', 'enemy:spotted', 'enemy:challenge', 'enemy:held', 'enemy:body-found', 'enemy:distracted', 'enemy:unmasked-spy',
  'enemy:noise-turn', 'enemy:heard-steps',
  'alarm:start', 'alarm:end', 'alarm:lamp', 'alarm:zone', 'reinforcements', 'noise',
  // world
  'shot', 'explosion', 'fire', 'structure:destroyed', 'door', 'device',
  'vehicle:enter', 'vehicle:exit', 'vehicle:move', 'vehicle:stop', 'vehicle:gear', 'vehicle:fire', 'vehicle:runover', 'vehicle:destroyed',
  'vehicle:tainted', 'train:pass', 'wind:gust', 'wind:flag', 'ambient:flush', 'ambient:call', 'ambient:fishjump',
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
  // bodies / physics (docs/bodies-design.md §1)
  'blast:front', 'unit:blast', 'body:settled', 'prop:settled',
  // gate smash (design-spec §3.7 ramming addendum; world/breakables.js, physics/debris.js)
  'gate:smash', 'gate:hold', 'gate:thud', 'gate:hinge', 'gate:settled',
  // drag / shoulder carry / buddy rescue (docs/bodies-design.md §C)
  'load:picked', 'load:dropped', 'load:mode', 'unit:downed', 'unit:revived',
]);
