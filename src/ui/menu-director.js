/**
 * The front end's scene director (the ground fight's brief: "ground fight → bombers → dogfight → quiet, rotating,
 * with sensible overlaps and quiet gaps"): one calm rotation over the theatre's still instead of three independent
 * timers. A while after the menu comes up the ground fight plays (menu-ground.js; where the theatre has one and the
 * screen shows it); toward its end the bombers' section comes over (menu-bombers.js), and a few seconds after their
 * pass the dogfight (menu-dogfight.js, armed by the pass itself); then a quiet spell, and round again. An act that
 * cannot play (no ground fight in this theatre, a portrait phone's badge over the whole bank, sprites not yet in)
 * is skipped, never waited for. The acts keep their own guards (test sessions, reduced motion, STILL, a hidden tab,
 * leaving the front end); a new card or a mission load ends what is in flight and the next round starts after the
 * usual gap.
 * @module ui/menu-director
 */

const FIRST = [6000, 9000];       // ms from the front end coming up to the first round
const QUIET = [45000, 75000];     // ms of quiet after a round's last act
const OVERLAP = 6;                // s before the ground fight's end the bombers come over
const STALL = 70000;              // ms after the pass by which a round has surely ended (a dogfight that never came)
const PREFETCH = 2500;            // ms after the front end comes up before the ground fight's sprites are fetched

const between = ([a, b]) => a + Math.random() * (b - a);

export class MenuDirector {
  /**
   * @param {{ground: object, bombers: object, dogfight: object}} acts
   * @param {{theater: () => string|null}} o
   */
  constructor(acts, o) {
    this.acts = acts;
    this.o = o;
    this.running = false;
    this._timers = [];
    this.round = 0;
    this.phase = 'idle';          // idle | ground | bombers | dogfight | quiet
  }

  /** The front end's still is up: the first round after a moment. */
  start() {
    if (this.running) return;
    const { ground, bombers, dogfight } = this.acts;
    for (const a of [ground, bombers, dogfight]) a.start();
    if (!bombers.running && !dogfight.running && !ground.running) return;   // a test session, STILL, reduced motion
    this.running = true;
    this._next(between(FIRST));
    this._at(PREFETCH, () => ground.prefetch?.());     // the fight's sprites once the menu has settled (low priority)
  }

  stop() {
    this.running = false;
    this._clear();
    this.phase = 'idle';
    for (const a of Object.values(this.acts)) a.stop();
  }

  /** A new card: whatever is in flight has ended (the backdrop interrupts the acts); the next round after a gap. */
  interrupt() {
    if (!this.running) return;
    this._clear();
    this.phase = 'quiet';
    this._next(between(QUIET) * 0.5);
  }

  dispose() { this.stop(); }

  _clear() { for (const t of this._timers) clearTimeout(t); this._timers = []; }

  _at(ms, fn) { const t = setTimeout(() => { this._timers = this._timers.filter((x) => x !== t); if (this.running) fn(); }, ms); this._timers.push(t); }

  _next(ms) { this._clear(); this._at(ms, () => this._round()); }

  /** One round: the ground fight if it plays, the bombers toward its end, their dogfight after the pass. */
  async _round() {
    const { ground } = this.acts;
    this.round++;
    this.phase = 'ground';
    const th = this.o.theater?.();
    const ok = ground.has?.(th) ? await ground.fight() : false;
    if (!this.running) return;
    // (toward the shooting's end: the tank may still be leaving the frame as they come over)
    const lead = ok ? Math.max(4, (ground._f.p?.dur ?? ground._f.end) - OVERLAP) * 1000 : 1500;
    this._at(lead, () => this._bombers());
  }

  _bombers() {
    const { bombers } = this.acts;
    this.phase = 'bombers';
    bombers.pass();
    if (!bombers._pass) { this._quiet(); return; }   // no pass this time (not ready, hidden): straight to the quiet
    this._at(STALL, () => this._quiet());             // the dogfight's end normally comes first (dogfightDone)
  }

  /** The bombers' pass is over: the dogfight comes next (the backdrop arms it), then the quiet. */
  passed() { if (this.running) this.phase = 'dogfight'; }

  /** The dogfight has run its course (or none came): quiet, then round again. */
  dogfightDone() { if (this.running) this._quiet(); }

  _quiet() {
    this.phase = 'quiet';
    this._next(between(QUIET));
  }
}
