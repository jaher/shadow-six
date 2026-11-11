/**
 * Campaign flow — owned by CORE2 (design-spec §8, §6.6–§6.8). The menu/campaign layer above the
 * Game's sim state machine:
 *
 *   title → select → briefing → playing ⇄ paused → debrief → (next mission's briefing | epilogue)
 *
 *   game.flow.state          'title' | 'select' | 'briefing' | 'playing' | 'paused' | 'debrief' | 'epilogue'
 *   game.flow.campaign       'BEL' | 'BCD' (LIGHTS OUT, our own expansion campaign)
 *   game.flow.missions       ordered mission defs of the campaign (missions/index.js CAMPAIGNS; live for LIGHTS OUT)
 *   game.flows               {BEL, BCD}: one flow (career) per campaign; game.flow is the active one, the campaign of
 *                            the mission started last (Game.useFlow). Only the active flow follows the game's state.
 *   game.flow.unlocked(id)   → boolean
 *   game.flow.startMission(id) → Promise<World>        (→ 'briefing')
 *   game.flow.begin()        briefing → playing (Esc / "start" on the briefing)
 *   game.flow.next()         debrief → next mission's briefing, or 'epilogue' (M20 gate, end of campaign)
 *   game.flow.retry()        debrief/failure → same mission again
 *   game.flow.enterPassword(code) → missionId | null   (restores mission + career)
 *   game.flow.results        [{missionId, stats, stars, merit, rank, password, won}] (this session)
 *   game.flow.gold / rank / rankName                    career gold stars (§8.2)
 *   events: 'flow:state' {from, to}; 'mission:won' / 'mission:lost' payload (emitted by the Game)
 *           {reason, stats, stars:{time, damage}, merit, rank, password}
 * The scoring helpers (§8.2) live in core/scoring.js and the codec (§8.3) in core/passwords.js; both
 * are re-exported here (Stage-0 import paths).
 * @module core/flow
 */

import { CONFIG } from '../config.js';
import { scoreMission, rankIndex, rankName, partialStars, goldFrom, meetsM20Gate } from './scoring.js';
import { encodePassword, decodePassword } from './passwords.js';

export { timeStars, damageLoss, damageStars, merit, rankIndex, rankName, scoreMission, partialStars, goldFrom, meetsM20Gate, isGuest } from './scoring.js';
export { encodePassword, decodePassword, normalizeCode } from './passwords.js';

export const FLOW_STATES = Object.freeze(['title', 'select', 'briefing', 'playing', 'paused', 'debrief', 'epilogue']);
export const CAREER_KEY = 'shadowsix.career.v1';
/** Minimum rank index for M20 (§8.2 gate). */
export const M20_MIN_RANK = CONFIG.mission.m20MinRank;

/** Campaign number of `missions[i]`: its def's `number` when it has one (LIGHTS OUT), else i + 1. */
function numberAt(missions, i) {
  const n = missions[i]?.number;
  return Number.isInteger(n) && n > 0 ? n : i + 1;
}

/** Game flow controller. The Game creates one per campaign (`game.flows`); `game.flow` is the active one. */
export class Flow {
  /**
   * @param {import('../game.js').Game} game
   * @param {object[]} missions ordered campaign mission defs
   * @param {string} [campaign='BEL']
   * @param {{persist?: boolean}} [opts] persist the career (unlocks, gold) in localStorage
   */
  constructor(game, missions, campaign = 'BEL', opts = {}) {
    this.game = game;
    this.campaign = campaign;
    this.missions = missions;
    this.state = 'title';
    this.results = [];
    this.gold = CONFIG.rulesets[campaign]?.careerStartGold ?? 0; // career gold stars (§8.2); BCD starts at Major (36, bcd-plan §1.13)
    /** BCD Skill (bcd-plan §1.12): 'easy' | 'hard' (null under BEL). Read by Game.loadMission via game.difficulty. */
    this.difficulty = CONFIG.rulesets[campaign]?.difficulty ? 'hard' : null;
    this.persist = !!opts.persist;
    this.current = null; // id of the mission being played
    this.last = null; // last mission-end payload
    const first = this.byNumber(1);
    this._unlocked = new Set(first ? [first.id] : []);
    if (this.persist) this.loadCareer();
    this._offs = [];
    const ev = game?.events;
    if (ev) this._offs.push(ev.on('game:state', ({ to }) => this._onGameState(to)));
  }

  get rank() {
    return rankIndex(this.gold);
  }

  get rankName() {
    return rankName(this.gold);
  }

  /** Change flow state and emit 'flow:state'. */
  setState(to) {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    this.game?.events?.emit('flow:state', { from, to });
  }

  /** Mirror the Game's sim state (playing/paused/won/lost/title) into the flow layer (the active campaign's flow only). */
  _onGameState(to) {
    if (this.game?.flow && this.game.flow !== this) return;
    if (to === 'playing' || to === 'paused') this.setState(to);
    else if (to === 'won' || to === 'lost') this.setState('debrief');
    else if (to === 'title') this.setState('title');
  }

  /** Mission 1 is always open (also one that joined the campaign after this career loaded: a LIGHTS OUT slot). */
  unlocked(id) {
    return this._unlocked.has(id) || (id != null && this.byNumber(1)?.id === id);
  }

  /**
   * 1-based campaign number of a mission id (0 when not in the campaign, e.g. the sandbox): the def's own `number`
   * (LIGHTS OUT slots, which may have gaps while missions are in preparation), else its place in the list.
   */
  numberOf(id) {
    const i = this.missions.findIndex((m) => m.id === id);
    return i < 0 ? 0 : numberAt(this.missions, i);
  }

  /** The campaign mission numbered `n`, or null (a LIGHTS OUT slot still in preparation). */
  byNumber(n) {
    const i = this.missions.findIndex((m, k) => numberAt(this.missions, k) === n);
    return i < 0 ? null : this.missions[i];
  }

  /** title → mission select. */
  openSelect() {
    this.setState('select');
  }

  /** Back to the title screen (unloads the mission). */
  toTitle() {
    if (this.game?.world) this.game.quitToTitle?.();
    this.setState('title');
  }

  /**
   * Load + brief a mission (unlocking is the caller's concern for debug/tests). A mission of the other campaign is
   * started by that campaign's flow, which becomes game.flow; the career's Skill (BCD) goes to the load.
   */
  async startMission(id) {
    const own = this.game?.flowForMission?.(id);
    if (own && own !== this) return own.startMission(id);
    this.game?.useFlow?.(this.campaign);
    if (this.game) this.game.difficulty = this.difficulty; // BCD Easy / Hard data variant (null under BEL)
    const w = await this.game.loadMission(id);
    this.current = this.game.missionDef?.id ?? id;
    this.setState('briefing');
    return w;
  }

  /** briefing → playing. */
  begin() {
    this.game.start?.();
    if (this.game.state === 'playing') this.setState('playing');
  }

  /** Replay the current mission. */
  retry() {
    return this.current ? this.startMission(this.current) : Promise.resolve(null);
  }

  /** Id of the mission that follows `id` (null at the campaign end, or while the next slot is in preparation). */
  nextMissionId(id = this.current) {
    const n = this.numberOf(id);
    return (n && this.byNumber(n + 1)?.id) || null;
  }

  /**
   * debrief → the next mission's briefing, or 'epilogue' when the campaign ends. §8.2 M20 gate: after
   * M19 the campaign continues only at Captain or higher (a password always opens M20).
   * @returns {Promise<object|null>} the new World, or null (epilogue)
   */
  async next() {
    const nid = this.nextMissionId();
    if (!nid || !this.unlocked(nid)) {
      if (this.game?.world) this.game.quitToTitle?.();
      this.setState('epilogue');
      return null;
    }
    return this.startMission(nid);
  }

  /**
   * §8.3: a valid password opens its mission (and every earlier one) and restores the career.
   * @returns {string|null} mission id opened by the password, or null
   */
  enterPassword(code) {
    const d = decodePassword(code);
    if (!d || d.campaign !== this.campaign) return null;
    const m = this.byNumber(d.mission);
    if (!m) return null;
    if (d.difficulty) this.setDifficulty(d.difficulty); // BCD: a password replays one mission at its skill (§1.13)
    this.gold = goldFrom(d.rank, d.stars);
    for (const x of this.missions) if (this.numberOf(x.id) <= d.mission) this._unlocked.add(x.id);
    this.saveCareer();
    return m.id;
  }

  /** Password for opening mission number `n` (1-based) with the current career. */
  passwordFor(n) {
    return encodePassword(this.campaign, n, partialStars(this.gold), rankIndex(this.gold), this.difficulty);
  }

  /**
   * BCD Skill screen choice ('easy' | 'hard'): stored in the career and used for the next mission load (at once when
   * this is the active flow; else when it starts its next mission).
   */
  setDifficulty(d) {
    if (!CONFIG.rulesets[this.campaign]?.difficulty) return false;
    this.difficulty = d === 'easy' ? 'easy' : 'hard';
    if (this.game && (!this.game.flow || this.game.flow === this)) this.game.difficulty = this.difficulty;
    return true;
  }

  /**
   * Build the mission-end payload (called by Game._endMission); records results, credits gold (replays
   * re-credit, §8.2), unlocks the next mission (M20 gate) and issues its password.
   * @returns {{stars, merit, rank, password, loss, time, epilogue?}}
   */
  onMissionEnd(won, world, def) {
    const sc = scoreMission(world, def?.par);
    const out = { stars: sc.stars, merit: won ? sc.merit : 0, rank: rankName(this.gold), password: null, loss: sc.loss, time: sc.time };
    if (won) {
      const n = this.numberOf(def?.id);
      if (n) this.gold += sc.merit; // only campaign missions build the career (not the sandbox)
      const R = CONFIG.rulesets[this.campaign];
      if (n && R?.difficulty && Number.isFinite(R.maxGold)) this.gold = Math.min(this.gold, (R.careerStartGold ?? 0) + R.maxGold); // BCD: Field Marshal (60) cap
      out.rank = rankName(this.gold);
      const next = n ? this.byNumber(n + 1) : null;
      const gateOk = !next || n + 1 !== 20 || meetsM20Gate(this.gold);
      if (next && gateOk) this._unlocked.add(next.id);
      out.password = next && gateOk ? this.passwordFor(n + 1) : null;
      out.epilogue = !!next && !gateOk;
    }
    this.last = { won, ...out };
    this.results.push({ missionId: def?.id, stats: { ...(world.stats || {}) }, won, ...out });
    this.saveCareer();
    return out;
  }

  // ------------------------------------------------------------ persistence

  /** Career state (for save games and localStorage). */
  serialize() {
    return { campaign: this.campaign, gold: this.gold, unlocked: [...this._unlocked], current: this.current, ...(this.difficulty ? { difficulty: this.difficulty } : null) };
  }

  deserialize(d) {
    if (!d || (d.campaign && d.campaign !== this.campaign)) return;
    if (Number.isFinite(d.gold)) this.gold = d.gold;
    if (d.difficulty) this.setDifficulty(d.difficulty);
    if (Array.isArray(d.unlocked)) for (const id of d.unlocked) this._unlocked.add(id);
    if (d.current) this.current = d.current;
  }

  saveCareer() {
    if (!this.persist) return;
    try {
      localStorage.setItem(`${CAREER_KEY}.${this.campaign}`, JSON.stringify(this.serialize()));
    } catch { /* storage unavailable */ }
  }

  loadCareer() {
    try {
      const s = localStorage.getItem(`${CAREER_KEY}.${this.campaign}`);
      if (s) this.deserialize(JSON.parse(s));
    } catch { /* ignore corrupt/unavailable storage */ }
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }
}
