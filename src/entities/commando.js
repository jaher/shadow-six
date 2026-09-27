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
 *                                     (def.autoStand: a crawling commando stands up first, 0.6 s)
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
    this.abilities = abilitiesForRole(this.role, this.campaign).filter((id) => {
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
    if (wp?.link) return wp.link.kind === 'climb' ? CONFIG.abilities.climbSpeed : CONFIG.abilities.ladderSpeed;
    if (this.carrying && this.stance === 'stand') return U.carry * this.speedMul;
    let s = super.speed;
    if (this.role === 'diver' && this.has('inflatableBoat') && this.stance === 'stand') s = Math.max(0.1, s - U.raftCarryPenalty);
    return s;
  }

  /** §3.4: no climbing (walls or ladders) while carrying — plan a walking route around the links. */
  pathQuery() {
    const q = super.pathQuery();
    if (this.carrying) q.noLinks = true;
    return q;
  }

  moveTo(x, z, opts = {}) {
    if (this.hidden || this.state === 'hidden' || this.state === 'jailed') return false;
    const run = !!opts.run && !this.carrying;
    const ok = super.moveTo(x, z, { ...opts, run });
    // §3.4: no climbing (walls or ladders) while carrying a body or barrel — pathQuery() already
    // plans link-free, so this only guards a path that somehow still holds a link.
    if (ok && this.carrying && this.path.some((p) => p.link)) { this.stop(); return false; }
    // §3.4 diving gear: he stays in WATER/SHALLOW cells — the path ends at the last water waypoint
    if (ok && this.diving) {
      const w = this.world;
      const wet = (p) => { const g = w.groundAt(p.x, p.z); return (g.water || g.shallow) && !g.bridge; };
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
    if (stance === 'crawl' && (this.carrying || this.buried || this.hidden || this.noCrawl)) return;
    if (this.diving && stance !== 'dive') return; // gear on: only the dive ability changes stance
    const prev = this.stance;
    super.setStance(stance);
    if (this.stance !== stance) return;
    const U = CONFIG.units;
    if (prev === 'stand' && stance === 'crawl') this._stanceT = U.stanceDown;
    else if (prev === 'crawl' && stance === 'stand') this._stanceT = U.stanceUp;
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
        if (this.armed === 'pistol') break; // §3.2 pistol drawn: left-click fires, moves refused
        if (this.puppet?.puppetOf === this) { ok = this.puppet.moveTo(order.x, order.z, { run: !!order.run }); break; } // BCD §1.3
        if (this.buried || this.hidden || this.state === 'inVehicle') break;
        if (!this.cancelAction()) break;
        ok = this.moveTo(order.x, order.z, { run: !!order.run });
        if (!ok) w.events.emit('message', { text: `${this.nickname}: can't get there.`, kind: 'warn', unit: this });
        break;
      case 'stop':
        if (this.vehicle?.handleOrder) { ok = this.vehicle.handleOrder(this, order); break; }
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
    if (this.buried) return this.useAbility('shovel', this);
    if (this.currentAction || this.pendingAbility) return this.cancelAction();
    return false;
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
    if (!this.abilities.includes(id) && !def.always) return fail(`can't do that (${def.label}).`);
    if (def.item && !this.has(def.item)) return fail(`no ${def.item} left.`);
    const ok = def.canUse ? def.canUse(this, target, w) : true;
    if (ok !== true) return fail(typeof ok === 'string' ? ok : `can't do that.`);
    if (!this.cancelAction()) return false;
    if (def.autoStand && this.stance === 'crawl') this.setStance('stand'); // stand (0.6 s), then approach/act
    const tp = targetPoint(target);
    this.pendingAbility = { def, target, run: run && !this.carrying, t: 0, repathT: 0, click: tp ? { ...tp } : null };
    this._updatePending(0);
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
    const tp = self ? { x: this.x, z: this.z } : (p.def.approachPoint?.(this, p.target, w) ?? targetPoint(p.target, this));
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
    const d = Math.hypot(tp.x - this.x, tp.z - this.z);
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
      const task = p.def.start(this, p.target, w);
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
    if (p.t > CONFIG.abilities.approachTimeout) {
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
      if (!this.moveTo(tp.x, tp.z, { run: p.run })) {
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
    super.update(dt);
    if (this.diving && this.alive) this.stance = 'dive';
    this._updateLinks();
    this._updateCarried();
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
    super.moveTo(lead.x + ux * gap, lead.z + uz * gap, { run: lead.moveMode === 'run' && !!lead.path });
  }

  /** Emit unit:climb when a path segment through a climb/ladder link starts (§3.4 climb, §3.2 ladders). */
  _updateLinks() {
    const wp = this.path?.[this.pathIndex];
    if (wp?.link && this._linkIdx !== this.pathIndex) {
      this._linkIdx = this.pathIndex;
      this.world?.events.emit('unit:climb', { unit: this, kind: wp.link.kind, link: wp.link });
      this.playAction?.('climb', 0.2);
    } else if (!wp?.link) this._linkIdx = -1;
    if (wp?.link) this._animOverride = { name: 'climb', t: 0.1 };
  }

  /** Carried body follows on the shoulder (§3.4); carry animations. */
  _updateCarried() {
    const c = this.carrying;
    if (!c) return;
    if (c.kind !== 'interactable') {
      c.x = this.x; c.z = this.z; c.y = (this.y || 0) + 1.2; c.heading = this.heading;
    }
    if (this.alive && !this._animOverride) this._setAnim(this._moving ? 'carry_walk' : 'carry_idle');
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
    if (this.carrying) dropCarried(this);
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
      jailId: this.jailId,
      y: this.y,
      diving: this.diving,
      // a running ability that can be picked up again after a load (def.resume, e.g. the Spy's distract)
      action: this.currentAction && ABILITIES[this.currentActionId]?.resume
        ? { id: this.currentActionId, target: this.currentActionTarget?.id ?? null } : null,
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
    const def = a && ABILITIES[a.id];
    if (!def?.resume || !this.alive || !this.world) return false;
    const target = a.target != null ? this.world.byId(a.target) : null;
    const task = def.resume(this, target, this.world);
    if (!task) return false;
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
    this.refreshAbilities();
  }
}
