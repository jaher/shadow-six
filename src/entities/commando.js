/**
 * Commando — a player unit with a role, inventory, abilities and the order/ActionTask flow.
 *
 * Orders (`issue(order)`):
 *   {type:'move', x, z, run}          walk/run there (cancels the current action if interruptible). Refused while
 *                                     the pistol is drawn (§3.2), while hidden in a building or buried.
 *   {type:'stop'}                     stop moving and cancel the action
 *   {type:'stance', stance}           'stand' | 'crawl' (0.5 s down / 0.6 s up, §3.2)
 *   {type:'ability', id, target, run} walk (or run) into the ability's range, re-check canUse(),
 *                                     then run def.start() → ActionTask until 'done'/'failed'
 *                                     (def.autoStand: a crawling commando crawls in and stands up (0.6 s)
 *                                      only when close; a double-click stands him up at once and runs in)
 *   {type:'cancel'}                   right-click (§3.3/§3.4): holster the pistol, drop the carried body/barrel,
 *                                     rise from the sand, hang on a climb, end a distraction
 *   {type:'exit'}                     click his photo in the knapsack: leave the building / vehicle / gun
 *
 * Ability list: the role's abilities (campaign-scoped) whose `item` is in the knapsack (refreshAbilities();
 * items gained later — uniform, SMG, ammo, bombs — add their action). §3.1 speeds: carrying 1.6 m/s (no run),
 * packed raft −0.9 m/s, climb links 0.5 m/s, ladders 0.8 m/s.
 * @module entities/commando
 */

import { Unit } from './unit.js';
import { CONFIG } from '../config.js';
import { ABILITIES, abilitiesForRole } from '../abilities/index.js';
import { spawnInventory, isUnlimited } from '../items.js';
import { installAbilitySystems } from '../abilities/system.js';
import { dropCarried } from '../abilities/common.js';
import { releasePuppet, installBcdSystems } from '../ai/bcd-enemy.js';
import { isDownableHit, enterDowned, tickDowned, serializeDowned } from './downed.js';
import { digFrame } from '../art/shovel-dig.js';
import { pathOnStairs } from './stair-walk.js';
import { cutFrame } from '../art/wire-cut.js';

export { dropCarried };

/** Items whose knapsack icon stays (greyed) at 0. */
const KEEP_AT_ZERO = new Set(['sniperRifle', 'smg']);

/** Resolve an ability target into a world point. */
export function targetPoint(target, from = null) {
  if (!target) return null;
  if (from && typeof target.approachFrom === 'function') return target.approachFrom(from); // solid props: their edge
  if (typeof target.x === 'number' && typeof target.z === 'number') return { x: target.x, z: target.z };
  return null;
}

export class Commando extends Unit {
  /**
   * @param {object} spawn mission commando entry: {role, x, z, heading, inventory?, id?, disguised?, jailed?}
   */
  constructor(spawn) {
    const role = spawn.role;
    super({
      kind: 'commando',
      faction: 'player',
      role,
      x: spawn.x,
      z: spawn.z,
      heading: spawn.heading ?? -Math.PI / 2,
      tag: spawn.id ?? role,
      modelOpts: { role, colors: spawn.colors, guestId: role === 'guest' ? spawn.guestId ?? spawn.id ?? null : null },
    });
    const U = CONFIG.units;
    const R = { name: role, nickname: role, ...U.roster[role], ...(U.nameLocale ? U.names?.[U.nameLocale]?.[role] : null) };
    this.name = spawn.name ?? R.name;
    this.nickname = spawn.nickname ?? R.nickname;
    this.selected = false;
    /** @type {Map<string, number>} */
    // mission inventory = fixed kit + exactly the mission's items (no default-only leaks); sapper
    // gets time OR remote bombs, never both (BEL)
    const inv = spawnInventory(role, spawn.inventory, spawn.campaign || 'BEL');
    this.inventory = new Map(Object.entries(inv));
    /** Campaign ruleset id this commando plays under (set from the mission def by Game). */
    this.campaign = spawn.campaign || 'BEL';
    /** Fixed ability list from the spawn (tests/tools) — otherwise derived from role + knapsack. */
    this._fixedAbilities = spawn.abilities ? [...spawn.abilities] : null;
    /** @type {string[]} ability ids in action-panel order */
    this.abilities = [];
    this.refreshAbilities();
    /** @type {{update:(dt:number)=>string, cancel?:()=>void, interruptible?:boolean} | null} */
    this.currentAction = null;
    this.currentActionId = null;
    /** Ability waiting for the commando to get into range: {def, target, run, t, repathT}. */
    this.pendingAbility = null;
    /** Body (Unit) or Barrel being carried (§3.4). */
    this.carrying = null;
    /** bodies-design §C: how a man is transported — 'shoulder' | 'drag' (null for a barrel / nothing). */
    this.carryMode = null;
    /** Lift / lower in progress {kind: 'toShoulder'|'toDrag', t, dur} (visual pairing, save). */
    this.carryTransition = null;
    /** bodies-design §C.6: DOWNED state {t, cause, sourceId, since, hurried} or null. */
    this.downed = null;
    /** §C.8 mission flag: a guest / prisoner who can't walk (only transport moves him). */
    this.cannotWalk = !!spawn.cannotWalk;
    this.disguised = false;
    this._startDisguised = !!spawn.disguised;
    this.canSwim = role === 'diver';
    this.idleAnim = 'idle';
    /** Weapon cursor armed ('pistol' | 'syringe' | null): the UI sets it while targeting (§3.4 suspicious). */
    this.armed = null;
    /** Building (enterable door) he is hidden in (§3.2). */
    this.hideout = null;
    /** Enemies that saw him dig in / dive (witness rule §3.4, read by perception). */
    this.witnesses = null;
    /** Jail id when captured (§4.10). */
    this.jailId = spawn.jailId ?? null;
    /** Right-click on a climb: hang until the next order (§3.4). */
    this.hanging = false;
    /** Marine wearing the diving gear (§3.4): stance 'dive', water cells only. */
    this.diving = false;
    /** Link traversal in progress ({kind, id}) for unit:climb events. */
    this._linkIdx = -1;
    if (spawn.jailed) this.state = 'jailed';
    /** BCD guests (bcd-plan §1.8): `joinsAt {x, z, r}` — held off-play until a commando comes that close. */
    this._joinsAt = spawn.joinsAt ?? null;
    if (this._joinsAt) this.state = 'jailed';
    /** §3.5 guests: `follow` = tag of the unit ahead in Gilbert's single file; M17 prisoners cannot crawl. */
    this.follow = spawn.follow ?? null;
    this.noCrawl = !!(spawn.noCrawl ?? (role === 'guest' && spawn.follow));
    this.guestId = role === 'guest' ? spawn.guestId ?? spawn.id ?? null : null;
    this._followT = 0;
  }

  onAdded(world) {
    installAbilitySystems(world);
    this.refreshAbilities(); // house-rule abilities (world.house) now that the world is known
    const sd = world.mission?.startDisguised || [];
    if (this._startDisguised || sd.includes(this.role) || sd.includes(this.tag)) this.setDisguise(true);
    if (this.state === 'jailed' && this.object3d) this.object3d.visible = false;
    // BCD §1.8: Natasha passes as a civilian (a "disguise" only the Gestapo see through) until she acts
    if (world.rules?.guests && this.role === 'natasha') { this.disguised = true; this.uniformType = 'civilian'; }
    if (world.rules?.id === 'BCD') installBcdSystems(world);
  }

  // ------------------------------------------------------------ inventory

  /** Inventory count helper. */
  has(itemId, n = 1) {
    return (this.inventory.get(itemId) ?? 0) >= n;
  }

  /** Consume `n` of an item. @returns {boolean} */
  consume(itemId, n = 1) {
    const have = this.inventory.get(itemId) ?? 0;
    if (have < n) return false;
    if (!isUnlimited(itemId)) {
      // limited ammo keeps its (greyed) icon at 0 (§3.4 sniper R, SMG bursts); other items leave the knapsack
      if (have - n > 0 || KEEP_AT_ZERO.has(itemId)) this.inventory.set(itemId, have - n);
      else this.inventory.delete(itemId);
      if (have - n <= 0) this.refreshAbilities();
    }
    return true;
  }

  /** Add `n` of an item (pickups, air-drops, uniform); refreshes the action list. */
  gainItem(itemId, n = 1) {
    this.inventory.set(itemId, (this.inventory.get(itemId) ?? 0) + n);
    if (itemId === 'remoteBomb') this.inventory.set('detonator', 1);
    this.refreshAbilities();
  }

  /** Remove an item entirely. */
  loseItem(itemId) {
    this.inventory.delete(itemId);
    this.refreshAbilities();
  }

  /**
   * Recompute the action list: role abilities (campaign-scoped) whose required item is in the knapsack,
   * or whose def.available(commando) says so. Keeps the panel honest (§6.4: an item's icon = its action).
   */
  refreshAbilities() {
    if (this._fixedAbilities) { this.abilities = [...this._fixedAbilities]; return this.abilities; }
    this.abilities = abilitiesForRole(this.role, this.campaign, this.world?.house ?? null).filter((id) => {
      const d = ABILITIES[id];
      if (d.available) return d.available(this);
      return !d.item || this.has(d.item);
    });
    return this.abilities;
  }

  /** Spy uniform on/off (§3.4): model swap. */
  setDisguise(on) {
    this.disguised = !!on;
    this.model?.setDisguise?.(this.disguised);
  }

  // ------------------------------------------------------------ movement overrides (§3.1, §3.2)

  /** True while carrying a body or barrel. */
  get isCarrying() {
    return !!this.carrying;
  }

  get speed() {
    const U = CONFIG.units;
    const wp = this.path?.[this.pathIndex];
    // (a walked link — a flight of stairs, a plank — at his own pace: Unit._followPath slows it on the stairs)
    if (wp?.link && !wp.link.walk) return wp.link.kind === 'climb' ? CONFIG.abilities.climbSpeed : CONFIG.abilities.ladderSpeed;
    if (this.carrying && this.carryMode === 'drag' && this.stance === 'stand') return CONFIG.bodies.drag.speed * this.speedMul; // §C.2
    if (this.carrying && this.stance === 'stand') return U.carry * this.speedMul;
    let s = super.speed;
    if (this.role === 'diver' && this.has('inflatableBoat') && this.stance === 'stand') s = Math.max(0.1, s - U.raftCarryPenalty);
    return s;
  }

  /** §3.4: no climbing (walls or ladders) while carrying — plan a walking route around the links. */
  pathQuery() {
    const q = super.pathQuery();
    if (this.carrying) q.noLinks = true;
    if (this.carrying && this.carrying.kind !== 'interactable') q.swim = false; // §C.1: no swimming with a man
    if (this.downed) { q.noLinks = true; q.noWalkLinks = true; q.swim = false; } // §C.6: he crawls on the flat
    if (this.carrying && this.carrying.kind !== 'interactable' && this.carryMode === 'drag') q.noWalkLinks = true; // §C.2 not dragged up / down stairs
    // §3.4 diving gear: plan through open water and under decks (grid.underpass, M16/M18 bridge spans); a target
    // beyond the water falls back to the plain swim path, cut at the last wet waypoint below (moveTo)
    if (this.diving && !this._diveFallback && !q.noLinks && q.swim !== false) q.dive = true;
    return q;
  }

  /** §C.2: a dragger walks backwards, facing the body (Unit._followPath adds this to the path heading). */
  get moveHeadingOffset() {
    return this.carrying && this.carryMode === 'drag' ? Math.PI : 0;
  }

  /** §C.2: turning with a dragged man is capped (180°/s). */
  get moveTurnRate() {
    return this.carrying && this.carryMode === 'drag' ? Math.min(this.turnRate, CONFIG.bodies.drag.turnRate) : this.turnRate;
  }

  moveTo(x, z, opts = {}) {
    if (this.hidden || this.state === 'hidden' || this.state === 'jailed') return false;
    if (this.cannotWalk && !this.downed) return false; // §C.8: only transport moves him
    const run = !!opts.run && !this.carrying;
    let ok = super.moveTo(x, z, { ...opts, run });
    if (!ok && this.diving) { this._diveFallback = true; try { ok = super.moveTo(x, z, { ...opts, run }); } finally { this._diveFallback = false; } }
    // §3.4: no climbing (walls or ladders) while carrying a body or barrel — pathQuery() already
    // plans link-free, so this only guards a path that somehow still holds a link.
    if (ok && this.carrying && this.path.some((p) => p.link && !p.link.walk)) { this.stop(); return false; }
    // §C.2 a man is not dragged up or down a flight of stairs (his body would bump down every tread): the move is
    // refused (the Green Beret and the Spy can shoulder him and carry him up; entities/stair-walk.js)
    if (ok && this.carrying && this.carrying.kind !== 'interactable' && this.carryMode === 'drag' && pathOnStairs(this, this.path)) {
      this.stop(); this._moveRefusal = "can't drag a man on the stairs."; return false;
    }
    // §3.4 diving gear: he stays in WATER/SHALLOW cells — the path ends at the last water waypoint
    if (ok && this.diving) {
      const w = this.world;
      const wet = (p) => { const g = w.groundAt(p.x, p.z); return ((g.water || g.shallow) && !g.bridge) || !!w.grid.underpassAt?.(p.x, p.z); };
      let n = 1;
      while (n < this.path.length && wet(this.path[n])) n++;
      if (n <= 1) { this.stop(); return false; }
      this.path.length = n;
      this.moveTarget = this.path[n - 1];
    }
    if (ok) { this.hanging = false; this._linkIdx = -1; }
    return ok;
  }

  setStance(stance) {
    if (!this.alive || stance === this.stance) return;
    if (this.downed) return; // §C.6: he stays down until revived
    if (stance === 'crawl' && (this.carrying || this.buried || this.hidden || this.noCrawl)) return;
    if (this.diving && stance !== 'dive') return; // gear on: only the dive ability changes stance
    super.setStance(stance); // stanceDown 0.5 s / stanceUp 0.6 s (Unit.setStance)
  }

  // ------------------------------------------------------------ orders

  /**
   * Issue an order (from input, UI, tests).
   * @param {{type:string, x?:number, z?:number, run?:boolean, id?:string, target?:any, stance?:string}} order
   * @returns {boolean} accepted
   */
  issue(order) {
    if (!this.alive || !this.world) return false;
    const w = this.world;
    let ok = false;
    switch (order.type) {
      case 'move':
        if (this.vehicle?.handleOrder) { ok = this.vehicle.handleOrder(this, order); break; } // VEHICLES §3.7: drive / halt
        if (this.armed === 'pistol') { // §3.2 pistol drawn: left-click fires, moves refused — never silently
          w.events.emit('message', { text: `${this.nickname}: holster the pistol first (right-click).`, kind: 'warn', unit: this });
          break;
        }
        if (this.puppet?.puppetOf === this) { ok = this.puppet.moveTo(order.x, order.z, { run: !!order.run }); break; } // BCD §1.3
        if (this.buried) { ok = this._riseThenMove(order); break; } // §3.4: a move order digs him out first
        if (this.hidden || this.state === 'inVehicle') break;
        if (!this.cancelAction()) break;
        this._moveRefusal = null;
        ok = this.moveTo(order.x, order.z, { run: !!order.run });
        if (!ok) w.events.emit('message', { text: `${this.nickname}: ${this._moveRefusal || "can't get there."}`, kind: 'warn', unit: this });
        break;
      case 'stop':
        if (this.vehicle?.handleOrder) { ok = this.vehicle.handleOrder(this, order); break; }
        this._afterRise = null; // also drops a walk queued behind the rise (_riseThenMove)
        ok = this.cancelAction();
        if (ok) this.stop();
        break;
      case 'stance':
        if (this.currentAction && this.currentAction.interruptible === false) break;
        if (this.buried || this.hidden || this.state === 'inVehicle') break;
        this.setStance(order.stance);
        ok = this.stance === order.stance;
        break;
      case 'ability':
        ok = this.useAbility(order.id, order.target, { run: !!order.run });
        break;
      case 'cancel':
        ok = this.rightClick();
        break;
      case 'exit':
        ok = this.exitShelter();
        break;
      default:
        console.warn(`[commando] unknown order type "${order.type}"`);
    }
    if (ok) w.events.emit('unit:order', { unit: this, order });
    return ok;
  }

  /**
   * Right-click semantics (§3.2–§3.4), first match wins: holster the pistol; hang on a climb; drop the carried
   * body/barrel; rise from the sand; cancel the current action (ends a distraction).
   * @returns {boolean} something happened
   */
  rightClick() {
    if (this.armed) { this.armed = null; return true; }
    if (this._lipstickTarget) { this._lipstickTarget = null; return true; } // BCD §1.8: end Natasha's lipstick
    if (this.puppet) return releasePuppet(this); // BCD §1.3: the puppet sits down again
    const wp = this.path?.[this.pathIndex];
    if (wp?.link && wp.link.kind === 'climb') { this.hanging = true; return true; }
    if (this.carrying) return this.useAbility('drop', this);
    if (this.buried) return this.currentActionId === 'shovel' ? false : this.useAbility('shovel', this); // already rising: nothing more
    if (this.currentAction || this.pendingAbility) return this.cancelAction();
    return false;
  }

  /**
   * A move order while buried (§3.4 shovel): he rises (1.0 s, one shovel action), then walks to the point. An order
   * given while he is already rising only replaces the destination. @returns {boolean} accepted
   */
  _riseThenMove(order) {
    const rising = this.currentActionId === 'shovel';
    if (!rising && !this.useAbility('shovel', this)) return false;
    this._afterRise = { x: order.x, z: order.z, run: !!order.run };
    return true;
  }

  /** Leave the building he hides in, or the vehicle / gun he mans (photo click). */
  exitShelter() {
    if (this.hideout) return this.hideout.release(this);
    if (this.state === 'inVehicle' && this.vehicle) return this.vehicle.exit(this);
    return false;
  }

  /**
   * Start using an ability on a target: validates, then walks into range (see update()).
   * @returns {boolean}
   */
  useAbility(id, target, { run = false } = {}) {
    const w = this.world;
    const def = ABILITIES[id];
    const fail = (text) => {
      this.lastRefusal = { id, text, t: w.time }; // read by the test API (replay logs) — the HUD shows the message
      w.events.emit('ability:refused', { unit: this, id, target, reason: text });
      w.events.emit('message', { text: `${this.nickname}: ${text}`, kind: 'warn', unit: this });
      w.events.emit('bark', { unit: this, line: 'cant' });
      return false;
    };
    if (!def) return fail(`unknown action "${id}".`);
    // an order handed on to another ability (def.forward → {id, target}): H on a placed charge → the Sapper's takeCharge
    const fwd = def.forward?.(this, target, w);
    if (fwd && fwd.id !== id && ABILITIES[fwd.id] && this.abilities.includes(fwd.id)) return this.useAbility(fwd.id, fwd.target ?? target, { run });
    if (!this.abilities.includes(id) && !def.always) return fail(`can't do that (${def.label}).`);
    if (def.item && !this.has(def.item)) return fail(`no ${def.item} left.`);
    const ok = def.canUse ? def.canUse(this, target, w) : true;
    if (ok !== true) return fail(typeof ok === 'string' ? ok : `can't do that.`);
    if (!this.cancelAction()) return false;
    // autoStand from a crawl: a single click crawls him in and he stands up (0.6 s) only within
    // CONFIG.abilities.crawlStandLead of reach (_updatePending); a double-click (run order) is urgent: he stands
    // up at once and runs in, as in BEL.
    const crawlIn = !!def.autoStand && this.stance === 'crawl' && !run;
    if (def.autoStand && this.stance === 'crawl' && !crawlIn) this.setStance('stand'); // stand (0.6 s), then approach/act
    const tp = targetPoint(target);
    const pend = { def, target, run: run && !this.carrying, t: 0, repathT: 0, click: tp ? { ...tp } : null, crawlIn, crawled: crawlIn };
    this.pendingAbility = pend;
    this._updatePending(0);
    if (pend.refused) return fail(pend.refused);
    return true;
  }

  /**
   * Cancel the pending/current action if it is interruptible.
   * @returns {boolean} false if a non-interruptible action is running
   */
  cancelAction() {
    if (this.currentAction) {
      if (this.currentAction.interruptible === false) return false;
      this.currentAction.cancel?.();
      this.currentAction = null;
      this.currentActionId = null;
      if (this.state === 'busy') this.state = 'active';
    }
    if (this.pendingAbility) {
      this.pendingAbility = null;
      this.stop();
    }
    return true;
  }

  _updatePending(dt) {
    const p = this.pendingAbility;
    if (!p) return;
    if (p.def.autoStand && this._stanceT > 0) return; // still getting up: approach/act once he is on his feet
    const w = this.world;
    const self = p.def.targeting === 'self' || p.def.targeting === 'none';
    // a self-targeted ability may still name a walk-up point, fixed when ordered (a bomb planted next to a bunker:
    // round to its entrance, abilities/bunker-entry.js); none → at his feet
    if (self && p.selfTp === undefined) p.selfTp = p.def.selfApproach?.(this, w) ?? null;
    const tp = self ? (p.selfTp ?? { x: this.x, z: this.z }) : (p.def.approachPoint?.(this, p.target, w) ?? targetPoint(p.target, this));
    if (!tp) {
      this.pendingAbility = null;
      return;
    }
    // §3.3 auto-walk cancels when a moving target gets more than 3 m from where it was clicked
    if (p.click && p.target?.kind === 'enemy' && Math.hypot(p.target.x - p.click.x, p.target.z - p.click.z) > CONFIG.units.autoWalkCancel) {
      this.pendingAbility = null;
      this.stop();
      return;
    }
    const range = typeof p.def.range === 'function' ? p.def.range(this, p.target, w) : p.def.range ?? 1;
    let d = Math.hypot(tp.x - this.x, tp.z - this.z);
    if (p.crawlIn) {
      // crawling in (useAbility): he stays prone until close, then halts and stands up; once on his feet he
      // walks the last step and acts. Anything that stood him up meanwhile (water → swim → stand) ends the crawl-in.
      if (this.stance !== 'crawl') p.crawlIn = false;
      else if (d <= range + CONFIG.abilities.crawlStandLead) {
        p.crawlIn = false;
        this.stop();
        p.lastTp = null;
        this.setStance('stand');
        if (this.stance !== 'crawl') return; // getting up (0.6 s): the guard at the top of this method waits for it
      }
    }
    // a crawler reaches with his hands, 0.8 m ahead of his hips: lying head-on against a drum or a wagon (his body
    // keeps clear of solids, world/body-clearance.js) he is at it (the crawl-in above keeps the hip distance)
    if (this.stance === 'crawl' && !self && !p.def.ranged && !p.def.hipsReach) {
      d = Math.min(d, Math.hypot(tp.x - this.x - Math.cos(this.heading) * 0.8, tp.z - this.z - Math.sin(this.heading) * 0.8));
    }
    const inRange = d <= range && (!p.def.needsLOS || p.def.needsLOS(this, p.target, w));
    if (inRange) {
      // §3.2 "A unit already moving keeps moving and can fire when in range": a gun that fires on the move
      // (pistol, SMG) leaves the current path alone; everything else halts to act.
      const onTheMove = !!(p.def.firesOnTheMove && this.path && !self);
      if (!onTheMove) this.stop();
      const ok = p.def.canUse ? p.def.canUse(this, p.target, w) : true;
      this.pendingAbility = null;
      if (ok !== true) {
        w.events.emit('message', { text: `${this.nickname}: ${typeof ok === 'string' ? ok : "can't do that."}`, kind: 'warn', unit: this });
        return;
      }
      if (d > 1e-3 && !self) this.faceTowards(tp.x, tp.z);
      w.events.emit('ability:start', { unit: this, id: p.def.id, target: p.target ?? null });
      // the id is set before start(): the model picks the action's clip and hand prop as soon as start() plays it
      // (unit-anim-map: shovel → dig, uniform → change_clothes, cutters → cut_wire …)
      this.currentActionId = p.def.id;
      const task = p.def.start(this, p.target, w);
      if (!task && !this.currentAction) this.currentActionId = null;
      if (task) {
        this.currentAction = task;
        this.currentActionId = p.def.id;
        this.currentActionTarget = p.target ?? null;
        if (!task.keepsState && !onTheMove) this.state = this.state === 'active' ? 'busy' : this.state;
      } else {
        w.events.emit('ability:end', { unit: this, id: p.def.id, result: 'done' });
      }
      return;
    }
    // §3.3 "Auto-walk" is for melee abilities and `hand` only: a ranged ability (firearm, grenade, trap,
    // vehicleFire) never walks into range — its canUse refuses such orders, and one whose target slipped
    // out of range / LOS while pending (e.g. while standing up) is dropped, not chased.
    if (p.def.ranged) {
      this.pendingAbility = null;
      this.stop();
      w.events.emit('message', { text: `${this.nickname}: ${d > range ? 'out of range.' : 'no line of sight.'}`, kind: 'warn', unit: this });
      return;
    }
    p.t += dt;
    p.repathT -= dt;
    // a crawl-in covers ground at crawl speed: the give-up time stretches by walk/crawl for the whole order
    const timeout = CONFIG.abilities.approachTimeout * (p.crawled ? CONFIG.units.walk / CONFIG.units.crawl : 1);
    if (p.t > timeout) {
      this.pendingAbility = null;
      this.stop();
      return;
    }
    // Re-path only for a target that has moved (a static truck/door needs one path), and never while the
    // unit is on a climb/ladder link: a new path from mid-link restarts the traversal (replay m02: a sniper
    // ordered into the truck from the wall walk oscillated at the top of the inner steps for 30 s).
    const onLink = !!this.path?.[this.pathIndex]?.link;
    const moved = !p.lastTp || Math.hypot(tp.x - p.lastTp.x, tp.z - p.lastTp.z) > CONFIG.abilities.approachRepathMove;
    if (!this.path || (p.repathT <= 0 && moved && !onLink)) {
      p.repathT = CONFIG.abilities.approachRepath;
      p.lastTp = { x: tp.x, z: tp.z };
      const went = this.moveTo(tp.x, tp.z, { run: p.run });
      if (this.diving && (!went || (this.moveTarget && Math.hypot(tp.x - this.moveTarget.x, tp.z - this.moveTarget.z) > range + 0.1))) {
        // §3.4 diving gear: the walk-up ends at the water's edge, short of the target — refuse the order
        // instead of swimming there and doing nothing (M16 review: knife on the island pair from the water)
        this.pendingAbility = null;
        this.stop();
        p.refused = "Can't reach that from the water.";
        if (dt > 0) w.events.emit('message', { text: `${this.nickname}: ${p.refused}`, kind: 'warn', unit: this });
      } else if (!went) {
        this.pendingAbility = null;
        w.events.emit('message', { text: `${this.nickname}: can't reach the target.`, kind: 'warn', unit: this });
      }
    }
  }

  update(dt) {
    if (this.alive) {
      if (this.currentAction) {
        let r;
        try {
          r = this.currentAction.update(dt);
        } catch (err) {
          console.error(`[commando] action ${this.currentActionId} threw`, err);
          r = 'failed';
        }
        if (r !== 'running') {
          const id = this.currentActionId;
          this.currentAction = null;
          this.currentActionId = null;
          if (this.state === 'busy') this.state = 'active';
          this.world?.events.emit('ability:end', { unit: this, id, result: r });
          const next = this._afterRise;
          if (id === 'shovel' && next) { // risen out of the snow / sand: walk on (Commando._riseThenMove)
            this._afterRise = null;
            if (r === 'done' && !this.buried) this.issue({ type: 'move', ...next });
          }
        }
      } else if (this.pendingAbility) {
        this._updatePending(dt);
      }
    }
    if (this.follow && this.alive) this._updateFollow(dt);
    if (this.hanging) {
      this._updateAnim(dt);
      return;
    }
    if (this.downed) tickDowned(this, dt);
    super.update(dt);
    if (this.diving && this.alive) this.stance = 'dive';
    this._updateLinks();
    this._updateCarried(dt);
  }

  /** Per-frame visuals: the shovel dig / rise (art/shovel-dig.js), the wire cut (art/wire-cut.js) before the model update. */
  renderUpdate(dt) {
    if (this.dig || this._digVis) digFrame(this, dt);
    if (this.cutWire || this._cutVis) cutFrame(this, dt);
    super.renderUpdate(dt);
  }

  /** §3.5 single file: keep 1.0 m behind the unit ahead, running when it runs. */
  _updateFollow(dt) {
    const lead = this.world?.byId(this.follow);
    if (!lead || !lead.alive || this.state !== 'active' || this.currentAction || this.pendingAbility) return;
    this._followT -= dt;
    const gap = CONFIG.abilities.guestSpacing;
    const d = Math.hypot(lead.x - this.x, lead.z - this.z);
    if (d <= gap + 0.35) { if (this.path) this.stop(); return; }
    if (this._followT > 0 && this.path) return;
    this._followT = 0.25;
    const ux = (this.x - lead.x) / d, uz = (this.z - lead.z) / d;
    // an unreachable leader (in a raft on the river …): hold here, don't march on along a stale path
    if (!super.moveTo(lead.x + ux * gap, lead.z + uz * gap, { run: lead.moveMode === 'run' && !!lead.path }) && this.path) this.stop();
  }

  /**
   * Emit unit:climb when a path segment through a climb/ladder link starts (§3.4 climb, §3.2 ladders). A walked link
   * (a flight of stairs, a plank) is walked: no climb (art/stair-gait.js shows the stairs); a ladder shows the
   * procedural climb (art/ladder-climb.js) over the 'ladder' pose.
   */
  _updateLinks() {
    const wp0 = this.path?.[this.pathIndex], wp = wp0?.link?.walk ? null : wp0;
    const anim = wp?.link?.kind === 'ladder' ? 'ladder' : 'climb';
    if (wp?.link && this._linkIdx !== this.pathIndex) {
      this._linkIdx = this.pathIndex;
      this.world?.events.emit('unit:climb', { unit: this, kind: wp.link.kind, link: wp.link });
      this.playAction?.(anim, 0.2);
    } else if (!wp?.link) this._linkIdx = -1;
    if (wp?.link) this._animOverride = { name: anim, t: 0.1 };
  }

  /** Carried body follows on the shoulder (§3.4); carry animations. */
  _updateCarried(dt = 0) {
    const c = this.carrying;
    if (!c) { this._dragTrail = null; this._heelAt = null; return; }
    if (c.kind !== 'interactable' && this.carryMode === 'drag') {
      this._placeDragged(c, dt);
      if (this.alive && !this._animOverride) this._setAnim(this._holdAnim(this._moving));
      return;
    }
    this._dragTrail = null;
    if (c.kind !== 'interactable') {
      c.x = this.x; c.z = this.z; c.y = (this.y || 0) + 1.2; c.heading = this.heading;
    }
    if (this.alive && !this._animOverride) this._setAnim(this._holdAnim(this._moving));
  }

  /**
   * Locomotion / idle clip while holding a load (Unit._updateAnim asks first): carry_walk / carry_idle on the shoulder,
   * drag_walk / drag_idle when dragging. Unit picked plain walk / idle before _updateCarried picked these, so the clip
   * flipped twice per tick and the mixer restarted every frame: the legs froze mid-stride (carry-legs fix).
   */
  _holdAnim(moving) {
    const c = this.carrying;
    if (!c) return null;
    if (c.kind !== 'interactable' && this.carryMode === 'drag') return moving ? 'drag_walk' : 'drag_idle';
    return moving ? 'carry_walk' : 'carry_idle';
  }

  /** Where the dragger's hands hold the man (collar / armpits): `drag.reach` m ahead of him. */
  dragHands() {
    const r = CONFIG.bodies.drag.reach;
    return { x: this.x + Math.cos(this.heading) * r, z: this.z + Math.sin(this.heading) * r };
  }

  /**
   * Can a dragged man lie at (x, z)? The straight line from the dragger to him crosses only walkable cells at the
   * dragger's own level (no fence / wall / building corner between them, no drop off a roof, deck or platform edge).
   */
  _dragSpotOk(x, z) {
    const w = this.world;
    if (!w) return true;
    const g = w.grid, ref = g.elevAt(this.x, this.z);
    if (Math.hypot(x - this.x, z - this.z) < 0.3) return false; // never on top of the dragger
    return g.walkableLine(this.x, this.z, x, z, { elevRef: ref });
  }

  /** Record the dragger's travelled path (newest last, ≤ 3 m of it): the fallback line the body trails along. */
  _pushDragTrail() {
    const T = this._dragTrail || (this._dragTrail = []);
    const last = T[T.length - 1];
    if (!last || Math.hypot(this.x - last.x, this.z - last.z) >= 0.1) T.push({ x: this.x, z: this.z });
    let len = 0;
    for (let i = T.length - 1; i > 0; i--) {
      len += Math.hypot(T[i].x - T[i - 1].x, T[i].z - T[i - 1].z);
      if (len > 3) { T.splice(0, i - 1); break; }
    }
  }

  /** Point `dist` m back along the travelled path from the dragger (the oldest point when the path is shorter). */
  _trailPoint(dist) {
    const T = this._dragTrail;
    let px = this.x, pz = this.z, left = dist;
    for (let i = T ? T.length - 1 : -1; i >= 0; i--) {
      const q = T[i], d = Math.hypot(q.x - px, q.z - pz);
      if (d >= left && d > 1e-6) return { x: px + ((q.x - px) * left) / d, z: pz + ((q.z - pz) * left) / d };
      left -= d; px = q.x; pz = q.z;
    }
    return { x: px, z: pz };
  }

  /**
   * Start a drag (grab or shoulder → drag): the man lies `drag.offset` m in front of the dragger (he walks backwards
   * facing him), or at the first clear bearing around him when something is in the way.
   */
  _startDrag(b) {
    const D = CONFIG.bodies.drag;
    this._dragTrail = [{ x: this.x, z: this.z }];
    if (b.carriedBy === this && Number.isFinite(b.x) && Math.hypot(b.x - this.x, b.z - this.z) >= 0.3 && this._dragSpotOk(b.x, b.z)) return;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI]) {
      const a = this.heading + da, x = this.x + Math.cos(a) * D.offset, z = this.z + Math.sin(a) * D.offset;
      if (this._dragSpotOk(x, z)) { b.x = x; b.z = z; b.heading = a; return; }
    }
  }

  /**
   * §C.2 kinematic, deterministic gameplay position of a dragged man — a trailing tow: his pelvis is pulled towards
   * the dragger's hands on a rigid `offset − reach` m link (so he trails along the travelled path and does not swing
   * around when the dragger turns in place), and his yaw eases towards the hands → pelvis line. Every spot is checked
   * by `_dragSpotOk`; when the link would cross a wall, fence or edge he follows the dragger's own travelled path.
   */
  _placeDragged(b, dt = 0) {
    const w = this.world, D = CONFIG.bodies.drag;
    if (!this._dragTrail) this._startDrag(b);
    this._pushDragTrail();
    const h = this.dragHands(), L = D.offset - D.reach;
    let dx = b.x - h.x, dz = b.z - h.z, d = Math.hypot(dx, dz);
    if (!(d > 1e-4)) { dx = Math.cos(this.heading); dz = Math.sin(this.heading); d = 1; }
    let x = h.x + (dx / d) * L, z = h.z + (dz / d) * L;
    if (!this._dragSpotOk(x, z)) {
      const p = this._trailPoint(D.offset);
      if (this._dragSpotOk(p.x, p.z)) { x = p.x; z = p.z; } else if (this._dragSpotOk(b.x, b.z)) { x = b.x; z = b.z; } else {
        // every candidate is blocked (a fresh grab on a cramped spot): the nearest trail point that is clear
        let best = null;
        for (let s = 0.4; s <= 3 && !best; s += 0.2) { const q = this._trailPoint(s); if (this._dragSpotOk(q.x, q.z)) best = q; }
        if (best) { x = best.x; z = best.z; } else { x = b.x; z = b.z; }
      }
    }
    b.x = x; b.z = z;
    b.y = w ? w.grid.elevAt(x, z) : this.y || 0;
    // facing away from the dragger (lying on his back, the head is at the dragger's feet): yaw eased to the link
    const want = Math.atan2(z - h.z, x - h.x);
    const cur = Number.isFinite(b.heading) ? b.heading : want;
    const k = dt > 0 ? 1 - Math.exp(-dt * D.yawRate) : 1;
    b.heading = cur + Math.atan2(Math.sin(want - cur), Math.cos(want - cur)) * k;
    // the heels furrow the ground (bodies-design §B.5): a gameplay-rate record every 0.5 m of heel travel
    if (w) {
      const hx = x + Math.cos(b.heading) * D.heel, hz = z + Math.sin(b.heading) * D.heel, H = this._heelAt;
      if (!H) this._heelAt = { x: hx, z: hz };
      else if (Math.hypot(hx - H.x, hz - H.z) >= 0.5) {
        w.events.emit('dragmark', { x: hx, z: hz, heading: Math.atan2(hz - H.z, hx - H.x), t: w.time, owner: this, load: b });
        H.x = hx; H.z = hz;
      }
    }
  }

  /** Put the load down at once (hit, downed, died): no animation. */
  dropLoad(how = 'gentle') {
    if (!this.carrying) return null;
    const it = dropCarried(this, how);
    this.refreshAbilities();
    return it;
  }

  /**
   * bodies-design §C.4 / §C.6: a carrier who is hit drops his load (`dropWhenShot`); a lethal downable hit leaves him
   * DOWNED instead of dead (`buddyRescue`); any hit on a downed man kills him.
   */
  takeDamage(amount, source = null, cause = 'damage') {
    if (!this.alive || amount <= 0) return;
    const w = this.world;
    // §C.6: a medic hit during a revive stops (the dose is kept)
    if (this.currentActionId === 'firstAid' && this.currentActionTarget?.reviving?.by === this) this.cancelAction();
    if (this.carrying && this.carrying.kind !== 'interactable' && w?.house?.dropWhenShot) {
      const sx = source?.x, sz = source?.z;
      const d = sx != null ? Math.hypot(this.x - sx, this.z - sz) : 0;
      this._hitDir = d > 1e-3 ? { x: (this.x - sx) / d, z: (this.z - sz) / d } : null;
      if (this.currentAction && ['carryToggle', 'drop'].includes(this.currentActionId)) this.cancelAction();
      this.dropLoad('shot');
      this._hitDir = null;
      if (this.hp - amount > 0) this.playAction('hit', 0.35);
    }
    if (this.downed) { // §C.6 finishing hit
      if (w) { w.stats.damageTaken += amount; w.events.emit('unit:damaged', { unit: this, amount, source, cause }); }
      this.downed = null;
      this.die(cause, source);
      return;
    }
    if (isDownableHit(this, amount, cause, w)) {
      if (w) { w.stats.damageTaken += amount; w.events.emit('unit:damaged', { unit: this, amount, source, cause }); }
      enterDowned(this, cause, source);
      return;
    }
    super.takeDamage(amount, source, cause);
  }

  die(cause, killer) {
    if (this.currentAction) {
      this.currentAction.cancel?.();
      this.currentAction = null;
    }
    this.pendingAbility = null;
    this.selected = false;
    this.armed = null;
    this.hanging = false;
    this.downed = null;
    this.carryTransition = null;
    if (this.carrying) dropCarried(this, 'died');
    super.die(cause, killer);
  }

  /** BCD §1.3: release the puppet this man controls (Esc / selecting another man). */
  releaseBcdPuppet() {
    return this.puppet ? releasePuppet(this) : false;
  }

  serialize() {
    return {
      ...super.serialize(),
      role: this.role,
      inventory: Object.fromEntries(this.inventory),
      selected: this.selected,
      disguised: this.disguised,
      carrying: this.carrying ? this.carrying.id : null,
      // bodies-design §D.1 (optional fields: saves without them load as before)
      ...(this.carrying && this.carryMode ? { carryMode: this.carryMode } : null),
      ...(this.carryTransition ? { carryTransition: { ...this.carryTransition } } : null),
      ...(this.downed ? { downed: serializeDowned(this) } : null),
      ...(this.cannotWalk ? { cannotWalk: true } : null),
      ...(this.reviving ? { revivingT: this.reviving.t } : null),
      jailId: this.jailId,
      y: this.y,
      diving: this.diving,
      // a running ability that can be picked up again after a load (def.resume, e.g. the Spy's distract)
      action: this.currentAction && ABILITIES[this.currentActionId]?.resume
        ? { id: this.currentActionId, target: this.currentActionTarget?.id ?? null,
          ...(this.currentAction.saveData || this.currentAction.t > 0 ? { t: this.currentAction.t ?? 0 } : null),
          ...(this.currentAction.saveData ? { data: this.currentAction.saveData() } : null) } : null,
      ...(this._dragTrail && this.carryMode === 'drag' ? { dragTrail: this._dragTrail.map((p) => [p.x, p.z]) } : null),
      ...(this.world?.rules?.id === 'BCD' ? { bcd: {
        wardrobe: this.wardrobe ? [...this.wardrobe] : null, uniformType: this.uniformType ?? null,
        puppet: this.puppet?.id ?? null, lipstickTarget: this._lipstickTarget?.id ?? null,
        joinsAt: this._joinsAt ?? null, attackedT: this._bcdAttackedT ?? null,
      } } : null), // BCD only: BEL saves stay byte-identical
    };
  }

  /** Save/load: restart the saved resumable action (after every entity is restored). */
  resumeSavedAction() {
    const a = this._savedAction;
    this._savedAction = null;
    const tr = this._savedTransition;
    this._savedTransition = null;
    const def = a && ABILITIES[a.id];
    const task = def?.resume && this.alive && this.world
      ? def.resume(this, a.target != null ? this.world.byId(a.target) : null, this.world, a) : null;
    if (!task) {
      // §D.1: a lift / lower that can't be resumed (an old save) resolves to its end state
      if (tr && this.carrying && this.carrying.kind !== 'interactable') {
        if (tr.kind === 'toShoulder') this.carryMode = 'shoulder';
        else if (tr.kind === 'toDrag') { this.carryMode = 'drag'; this._dragTrail = null; }
        this.refreshAbilities();
      }
      return false;
    }
    const target = a.target != null ? this.world.byId(a.target) : null;
    this.currentAction = task;
    this.currentActionId = a.id;
    this.currentActionTarget = target;
    if (!task.keepsState && this.state === 'active') this.state = 'busy';
    return true;
  }

  deserialize(d) {
    super.deserialize(d);
    this.inventory = new Map(Object.entries(d.inventory || {}));
    this.selected = !!d.selected && this.alive;
    this.setDisguise(!!d.disguised);
    this.currentAction = null;
    this.currentActionTarget = null;
    this._savedAction = d.action ?? null; // resumed by save.restoreWorld once every entity is back
    this.pendingAbility = null;
    this.jailId = d.jailId ?? null;
    this.y = d.y ?? this.y;
    this.armed = null;
    this.hanging = false;
    this.diving = !!d.diving;
    if (this.state === 'busy') this.state = 'active';
    const w = this.world;
    const c = d.carrying != null ? w?.byId(d.carrying) : null;
    this.carrying = c || null;
    // §D.1: a transition in progress is resumed from the mode it started in (resumeSavedAction; an old save's
    // transition resolves to its end state there); an old save's man carried by a non-GB/Spy is a drag
    this.carryMode = c && c.kind !== 'interactable'
      ? d.carryMode || (['greenberet', 'spy'].includes(this.role) ? 'shoulder' : 'drag') : null;
    this.carryTransition = null;
    this._savedTransition = d.carryTransition ? { ...d.carryTransition } : null;
    this._dragTrail = this.carryMode === 'drag' && Array.isArray(d.dragTrail) ? d.dragTrail.map(([x, z]) => ({ x, z })) : null;
    this.downed = d.downed ? { ...d.downed } : null;
    this.reviving = null;
    this._savedReviveT = d.revivingT ?? 0;
    this.cannotWalk = !!d.cannotWalk || this.cannotWalk;
    if (c) {
      if (c.kind === 'interactable') c.carriedBy = this;
      else { c.state = 'carried'; c.carriedBy = this; }
    }
    if (d.bcd) { // BCD §1.3/§1.6/§1.8 (the puppet / lipstick links are re-linked in bcdPostRestore)
      this.wardrobe = d.bcd.wardrobe ? [...d.bcd.wardrobe] : undefined;
      this.uniformType = d.bcd.uniformType ?? null;
      this._joinsAt = d.bcd.joinsAt ?? null;
      this._bcdAttackedT = d.bcd.attackedT ?? undefined;
      this._bcdRefs = { puppet: d.bcd.puppet ?? null, lipstickTarget: d.bcd.lipstickTarget ?? null };
    }
    // §3.4 shovel: a man saved buried is under his mound again (the dig state is derived, saves are unchanged)
    this._afterRise = null;
    this.dig = this.buried ? { phase: 'buried', t0: w?.time ?? 0, dur: 0, x: this.x, z: this.z, heading: this.heading,
      surface: w?.groundAt?.(this.x, this.z)?.terrain === 'sand' ? 'sand' : 'snow' } : null;
    if (this.buried && this.object3d) this.object3d.visible = false;
    this.refreshAbilities();
  }
}
