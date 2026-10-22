/**
 * Debug VIDEO MODE / SOLUTION replay: an action is watched until it has visibly finished (user, M3: "When the spy grabs
 * the clothes there is no time to see how he grabs them and we transition straight to another commando"). A hold opens
 * when a commando's key action starts (ability:start: the clothesline take and the uniform, a knife, an injection, a
 * charge, the wire cutters, a switch, a decoy, a pick-up, the raft inflated or folded…) and lasts while the action runs
 * (the unit's own current action, however long it takes: nothing here assumes a length), while its animation clip is
 * still playing after it (Unit._animOverride), while the man he killed is still falling, plus a short beat (HOLD_BEAT).
 * The director frames the man and his target for as long as the hold lasts (a step that moves on to another commando
 * waits, its chapter card too), and AUTO plays the hold at 1×. Long actions (a chat-up, a carry) are held for their
 * first seconds only. Pure: reads the units, writes nothing (tests/unit/action-hold.test.mjs).
 * @module debug/action-hold
 */

/** Seconds of game time after an action has visibly finished before the director may cut away. */
export const HOLD_BEAT = 0.7;
/** A victim's fall (Unit._updateAnim: 'die' → 'dead' after 1.2 s). */
export const FALL_S = 1.2;
/** The longest any hold lasts (s of game time: a safety net, actions end long before); open-ended actions less (HOLD_MAX_BY). */
export const HOLD_MAX = 30;
export const HOLD_MAX_BY = Object.freeze({ distract: 3, puppetDistract: 3, carryToggle: 2.5, drag: 2.5 });
/** The actions held (the moments of the solution films, debug/auto-pace.js ACTION_RATE). */
export const HELD = Object.freeze(new Set([
  'knife', 'harpoon', 'pistol', 'rifle', 'sniper', 'smg', 'grenade', 'syringe', 'hanger', 'lipstick', 'handcuff',
  'timeBomb', 'remoteBomb', 'detonate', 'uniform', 'vehicleFire', 'use', 'cutters', 'trap', 'decoyToggle', 'distract',
  'puppet', 'puppetDistract', 'stone', 'cigarettes', 'takeCharge', 'firstAid', 'enterVehicle', 'hand', 'carryToggle',
  'drag', 'decoyDrop', 'raft',
]));

export class ActionHolds {
  constructor() {
    /** @type {{unit: object, id: string, target: object|null, t0: number, end: number|null, fallEnd: number|null, meta: object}[]} */
    this.list = [];
  }

  /** A commando's action started at game time t (ability:start). `meta`: the host's context (the step on screen). */
  start(unit, id, target, t, meta = {}) {
    if (!unit || unit.kind !== 'commando' || !HELD.has(id)) return null;
    this.list = this.list.filter((h) => h.unit !== unit);
    const h = { unit, id, target: target && target !== unit ? target : null, t0: t, end: null, fallEnd: null, meta };
    this.list.push(h);
    return h;
  }

  /** The action ended (ability:end): visibly finished once its clip has played out too. */
  end(unit, id, t) {
    const h = this.list.find((x) => x.unit === unit && x.id === id && x.end == null);
    if (h) h.end = t + clipLeft(unit);
  }

  /** A man died: the hold of his killer (or of the action aimed at him) lasts while he falls. */
  killed(victim, killer, t) {
    for (const h of this.list) if (h.unit === killer || (h.target && h.target === victim)) h.fallEnd = t + FALL_S;
  }

  /** Is hold `h` still on at game time t? */
  active(h, t) {
    if (!h || t - h.t0 > (HOLD_MAX_BY[h.id] ?? HOLD_MAX)) return false;
    // an action that stopped without ability:end (cancelled, the man died): finished when first seen so
    if (h.end == null && (h.unit.currentActionId !== h.id || h.unit.alive === false) && t > h.t0) h.end = t + clipLeft(h.unit);
    if (h.end == null) return true;
    return t < Math.max(h.end, h.fallEnd ?? -Infinity) + HOLD_BEAT;
  }

  /** The hold to watch at game time t: the latest one still on (null: none). Spent holds are dropped. */
  current(t) {
    this.list = this.list.filter((h) => this.active(h, t));
    return this.list.length ? this.list[this.list.length - 1] : null;
  }

  clear() { this.list = []; }
}

/** Seconds left of a unit's one-shot action clip (Unit.playAction), 0 when none plays. */
function clipLeft(u) {
  const o = u?._animOverride;
  return o && o.t > 0 ? o.t : 0;
}
