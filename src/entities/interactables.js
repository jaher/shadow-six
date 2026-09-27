/**
 * Interactable world objects — owned by ABILITIES (docs/ARCHITECTURE.md, design-spec §3.2, §3.4, §3.6).
 *
 * interactKind:
 *   door            gate/door: open/close toggles its grid cells; `enterable:true` = hideout (§3.2 hiding)
 *   pickup          item on the ground (`itemId`, `count`); who may take it is role-gated (items.js PICKUP_ROLES)
 *   explosiveTarget demolition objective marker (destroyed by explosions only, §3.6)
 *   climbable       watchtower ladder (legacy art marker)
 *   switch          toggles `on`; `targets` = fence structure ids (electric power) / door ids / ladder ids
 *   lever / valve   same as switch (device)
 *   phone           rings for CONFIG.abilities.phoneRing s: phone noise pulses lure guards (§4.4)
 *   ladder          raised ladder (grid link disabled); lowered from the top (§3.2)
 *   clothesline     German uniform for the Spy (§3.4, 1.5 s)
 *   ammo            sniper ammo box (+3 rounds, §3.4) — a pickup with itemId 'sniperRifle'
 *   crate           air-drop crate: `contents` {itemId: count}, each role takes what it may carry
 *   barrel          explosive fuel drum (Barrel subclass): carried by the Green Beret, chain reactions (§3.6)
 *   jail            jail door: frees jailed guests/commandos (§4.10)
 *   extraction      extraction zone
 * Static interactables keep their object3d where the prop builder placed it (syncTransform is a no-op
 * unless `dynamic`).
 * @module entities/interactables
 */

import * as THREE from 'three';
import { Entity } from './entity.js';
import { B, T } from '../world/grid.js';
import { CONFIG } from '../config.js';
import { canPickUp } from '../items.js';
import { canSee } from '../ai/perception.js';
import { wardrobeOf, addToWardrobe } from './wardrobe.js';
import { makeClothesline } from '../art/clothesline.js';

/** Causes that can damage an explosive target (BEL: only explosives destroy structures). */
const NON_EXPLOSIVE = new Set(['pistol', 'rifle', 'sniperRifle', 'sniper', 'smg', 'knife', 'harpoon', 'injection', 'syringe', 'bullet', 'punch', 'mg', 'shot', 'electric']);

/** §3.2 activation durations (s) by interactKind [rec]. */
export const ACTIVATION = Object.freeze({
  door: 0.5, switch: 1.0, lever: 1.0, valve: 1.0, phone: 1.0, gate: 1.0, ladder: 1.0, clothesline: 1.5,
  jail: CONFIG.abilities.jailOpen, pickup: 0.6, ammo: 0.6, crate: 0.6, barrel: 1.0,
});

/** Extra interactable kinds registered by other modules: kind → (spec, opts) => Interactable (BCD §1.10). */
export const INTERACTABLE_KINDS = {};

/** Kinds operated with the activation (lever) cursor. */
export const ACTIVATABLE = new Set(['door', 'switch', 'lever', 'valve', 'phone', 'ladder', 'clothesline', 'jail']);
/** BCD devices operated with Use (filled by bcd-interactables.js; only honoured in a BCD world). */
export const BCD_ACTIVATABLE = new Set();

/** §4.10: does any enemy currently see `unit` (disguise respected, like AIDirector.witnesses)? */
function seenByEnemy(world, unit) {
  if (!world || !unit) return false;
  if (world.ai?.witnesses) return world.ai.witnesses(unit).length > 0;
  return (world.enemies || []).some((e) => e.alive && !e.removed && e.vision && canSee(e, unit, world) !== 'none');
}

export class Interactable extends Entity {
  /**
   * @param {object} o {interactKind, x, z, heading?, tag?, object3d?, destructible?, hp?, owner?, radius?,
   *   structure? (mission structure def: flags bombOnly/grenadeDestructible/indestructible/light/bunker), ...kind fields}
   */
  constructor(o = {}) {
    super({ kind: 'interactable', x: o.x, z: o.z, heading: o.heading ?? 0, tag: o.tag ?? o.id ?? null });
    this.interactKind = o.interactKind || 'switch';
    const S = o.structure || {};
    this.destructible = (!!o.destructible || this.interactKind === 'explosiveTarget') && !S.indestructible && !o.indestructible;
    this.bombOnly = !!(o.bombOnly || S.bombOnly);
    this.grenadeDestructible = !!(o.grenadeDestructible || S.grenadeDestructible);
    this.light = !!(o.light || S.light);
    /** §3.7 ramming: a barrier / light gate breaks under a fast vehicle (mission `rammable:true`, boom barriers). */
    this.barrier = !!(o.barrier || S.barrier || S.rammable || S.variant === 'barrier_boom' || S.type === 'barrier');
    this.bunker = !!(o.bunker || S.bunker || S.type === 'bunker');
    this.indestructible = !!(o.indestructible || S.indestructible);
    this.hp = o.hp ?? 100;
    this.maxHp = this.hp;
    this.destroyed = false;
    this.radius = o.radius ?? (this.barrier && o.w ? o.w / 2 : 1);
    /** Grid owner id whose cells are cleared when destroyed / opened. */
    this.owner = o.owner ?? 0;
    this.object3d = o.object3d || null;
    this.dynamic = !!o.dynamic;
    /** Hook: (interactable, world) → void, called once after destruction. */
    this.onDestroyed = o.onDestroyed || null;
    this.params = o;
    // kind-specific state
    this.open = !!o.open; // door
    this.locked = !!o.locked; // door
    this.enterable = !!o.enterable; // door hideout (§3.2)
    /** Units hidden inside (enterable doors). */
    this.occupants = [];
    this.itemId = o.itemId ?? null; // pickup
    this.count = o.count ?? 1; // pickup
    this.contents = o.contents ? { ...o.contents } : null; // crate
    this.elevation = o.elevation ?? 0; // climbable
    this.top = o.top ?? null; // climbable / ladder: standing point on top {x, z, y}
    this.linkId = o.linkId ?? null; // ladder: grid link id
    this.on = !!o.on; // switch / lever
    this.targets = o.targets ? [...o.targets] : []; // switch: ids it controls
    this.ringing = 0; // phone: seconds of ringing left
    this.r = o.r ?? 0; // extraction radius
    /** Roles allowed to use it (null = anyone the kind allows). */
    this.roles = o.roles ?? null;
    this.carriedBy = null;
    this._savedCells = null;
    this._pulseT = 0;
  }

  syncTransform(alpha) {
    if (this.dynamic) super.syncTransform(alpha);
  }

  /** Player-facing name ("Relay station", "Radio mast"): an explicit label, else the humanized structure variant/type; never a raw id. */
  get displayName() {
    const S = this.params?.structure || {};
    const lbl = this.params?.label ?? S.label ?? S.name;
    if (lbl) return String(lbl);
    const raw = S.variant || S.type || (this.interactKind !== 'explosiveTarget' ? this.interactKind : '') || '';
    const s = String(raw).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
    return s ? s[0].toUpperCase() + s.slice(1) : 'Target';
  }

  /** Activation time (s) for this kind (§3.2). */
  get activationTime() {
    return this.params.activation ?? ACTIVATION[this.interactKind] ?? 1.0;
  }

  /** Explosion damage; ignored for non-explosive causes. */
  takeDamage(amount, source, cause) {
    if (!this.destructible || this.destroyed || NON_EXPLOSIVE.has(cause)) return;
    this.hp -= amount;
    if (this.hp <= 0) this.destroy(source, cause);
  }

  /** Destroy: clear grid cells, darken the mesh, secondary explosion for fuel/ammo, notify objectives. */
  destroy(source = null, cause = 'explosion') {
    if (this.destroyed) return;
    this._applyDestroyedState();
    const w = this.world;
    if (w) {
      for (const u of [...this.occupants]) { this.release(u); u.takeDamage?.(1e5, source, 'explosion'); }
      // anyone standing on a collapsing crest goes down with it
      if (this._crestCells?.length) this._killOnCrest(source);
      w.events.emit('explosion', { x: this.x, z: this.z, radius: Math.max(4, this.radius * 2), kind: 'structure', source: this });
      w.emitNoise?.(this.x, this.z, 40, 'explosion', this);
      w.events.emit('structure:destroyed', { id: this.tag ?? this.id, type: this.interactKind, owner: this.owner });
      w.events.emit('message', { text: `${this.displayName} destroyed.`, kind: 'info' });
    }
    this.onDestroyed?.(this, w, source, cause);
  }

  /**
   * A walkable deck that goes with the structure (§7.6 dam: destroyFx 'removeCrest'): remember its bridge cells
   * while the grid still carries them (mission build, and a load rebuilds the mission before restoring the grid).
   */
  onAdded(world) {
    const fx = this.params?.structure?.destroyFx;
    if (!Array.isArray(fx) || !fx.includes('removeCrest') || !this.owner || !world?.grid) return;
    const g = world.grid, cells = [];
    for (let k = 0; k < g.size; k++) if (g.owner[k] === this.owner && g.bridge[k]) cells.push(k);
    this._crestCells = cells;
  }

  /** Destroyed state only (flags, grid, burnt look) with no events/noise/callbacks — used by destroy() and deserialize(). */
  _applyDestroyedState() {
    this.destroyed = true;
    this.alive = false;
    this.hp = 0;
    const w = this.world;
    if (w && this.owner) w.grid.clearOwner(this.owner);
    if (w && this._crestCells?.length) {
      // the crest is gone: its cells become the breach (deep water), so the two banks are split again and
      // every path over the dam is invalidated (replay m03: troops walked over the destroyed dam)
      const g = w.grid;
      for (const k of this._crestCells) { g.terrain[k] = T.WATER; g.bridge[k] = 0; }
      // 'flood': the surge drowns the wadeable toe ledge below the dam (mission `floodPoly`)
      const S = this.params?.structure;
      if (S?.destroyFx?.includes('flood') && Array.isArray(S.floodPoly)) g.fillPoly(S.floodPoly, 'terrain', T.WATER);
      g.version++;
    }
    // library buildings swap to their modelled destroyed variant (art/building-props.js); others burn + slump
    if (this.object3d?.userData?.destroy?.()) { /* swapped */ } else if (this.object3d) {
      const burnt = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 1 });
      burnt.userData.shared = false;
      this.object3d.traverse((o) => { if (o.isMesh) o.material = burnt; });
      this.object3d.scale.y = 0.35;
    }
  }

  _killOnCrest(source) {
    const w = this.world, g = w.grid, set = new Set(this._crestCells);
    for (const u of [...w.commandos, ...w.enemies]) {
      if (!u.alive || u.state === 'inVehicle') continue;
      const i = Math.floor(u.x / g.cell), j = Math.floor(u.z / g.cell);
      if (set.has(j * g.cols + i)) u.takeDamage?.(1e5, source, 'explosion');
    }
  }

  /** Open/close a door or gate: toggles the grid cells it owns between blocked and free. */
  setOpen(open, quiet = false) {
    if (this.interactKind !== 'door' || this.locked) return false;
    if (this.destroyed && !open) return false; // a rammed-through gate stays broken open
    const g = this.world?.grid;
    this.open = !!open;
    if (g && this.owner && !this.enterable) {
      if (this.open) {
        this._savedCells = [];
        for (let k = 0; k < g.size; k++) if (g.owner[k] === this.owner) this._savedCells.push(k, g.block[k]);
        for (let q = 0; q < this._savedCells.length; q += 2) g.block[this._savedCells[q]] = B.NONE;
      } else if (this._savedCells) {
        for (let q = 0; q < this._savedCells.length; q += 2) g.block[this._savedCells[q]] = this._savedCells[q + 1];
      }
      g.version++;
    }
    if (this.object3d && !this.enterable) this.object3d.visible = !this.open;
    if (!quiet) this.world?.events.emit('door', { id: this.tag ?? this.id, open: this.open });
    return true;
  }

  /**
   * §3.7 ramming: a fast vehicle smashes through this barrier / light gate. Gates are forced open (even
   * locked) and stay broken; the grid cells clear. A crash (noise), never an explosion.
   * @returns {boolean} true when it broke now
   */
  ramBreak(source = null) {
    if (this.destroyed) return false;
    const w = this.world;
    if (this.interactKind === 'door') { this.locked = false; this.setOpen(true, true); }
    this._applyDestroyedState();
    if (this.object3d && this.interactKind === 'door') this.object3d.visible = false;
    if (w) {
      w.grid.version++;
      w.emitNoise?.(this.x, this.z, CONFIG.vehicles.ramNoise, 'crash', source);
      w.events.emit('structure:destroyed', { id: this.tag ?? this.id, type: 'barrier', owner: this.owner, cause: 'ram', source });
    }
    this.onDestroyed?.(this, w, source, 'ram');
    return true;
  }

  // ------------------------------------------------------------ hideouts (§3.2)

  /** Hide a unit inside an enterable door: state 'hidden', invisible to all. */
  admit(unit) {
    if (!this.enterable || this.destroyed || this.occupants.includes(unit)) return false;
    this.occupants.push(unit);
    unit.stop?.();
    unit.state = 'hidden';
    unit.hidden = true;
    unit.hideout = this;
    unit.setPosition?.(this.x, this.z);
    if (unit.object3d) unit.object3d.visible = false;
    this.world?.events.emit('door', { id: this.tag ?? this.id, open: true, unit, enter: true });
    return true;
  }

  /** Let a hidden unit out beside the door. */
  release(unit) {
    const k = this.occupants.indexOf(unit);
    if (k < 0) return false;
    this.occupants.splice(k, 1);
    unit.state = unit.alive ? 'active' : 'dead';
    unit.hidden = false;
    unit.hideout = null;
    const out = this.params.exit || null;
    const p = out ? { x: out[0], z: out[1] } : this.world?.grid.nearestWalkable?.(this.x, this.z, 3) || { x: this.x, z: this.z };
    unit.setPosition?.(p.x, p.z);
    if (unit.object3d) unit.object3d.visible = true;
    this.world?.events.emit('door', { id: this.tag ?? this.id, open: true, unit, enter: false });
    return true;
  }

  // ------------------------------------------------------------ activation

  /** Can `commando` operate / pick this up? @returns {true|string} reason when not */
  canUse(commando) {
    if (this.destroyed || this.removed) return 'Nothing there.';
    const role = commando?.role;
    if (this.roles && !this.roles.includes(role)) return "Can't use that.";
    switch (this.interactKind) {
      case 'door':
        if (this.enterable) return commando.carrying ? "Can't take that inside." : true;
        return this.locked ? 'Locked.' : true;
      case 'pickup': case 'ammo':
        if (this.count <= 0) return 'Empty.';
        return canPickUp(role, this.itemId) ? true : "Can't pick that up.";
      case 'crate':
        return Object.entries(this.contents || {}).some(([id, n]) => n > 0 && canPickUp(role, id)) ? true : 'Nothing for me in there.';
      case 'clothesline':
        if (role !== 'spy') return 'Only the Spy can wear it.';
        if (this.count <= 0) return 'No uniform left.';
        if (this.world?.rules?.spyUniformFromCaptives) { // BCD §1.6: adds a typed entry to the wardrobe
          return wardrobeOf(commando).includes(this.params.uniform ?? 'soldier') ? 'Already has that uniform.' : true;
        }
        if (commando.disguised || commando.has?.('uniform')) return 'Already has a uniform.';
        return true;
      case 'ladder':
        if (!this.linkId) return 'No ladder.';
        if (this.lowered) return 'Already down.';
        if (this.top && Math.abs((commando.y || 0) - (this.top.y ?? 0)) > 0.6) return 'Lower it from the top.';
        return true;
      case 'jail':
        if (!this.jailed().length) return 'Nobody inside.';
        // §4.10 rescue only "while no enemy sees him" — checked at the order and again at the 1.5 s completion.
        if (seenByEnemy(this.world, commando)) return 'They can see you.';
        return true;
      case 'switch': case 'lever': case 'valve': case 'phone':
        return true;
      default:
        return "Can't use that.";
    }
  }

  /** Units jailed behind this jail door. */
  jailed() {
    const w = this.world;
    if (!w) return [];
    const id = this.tag ?? this.id;
    return w.commandos.filter((c) => c.alive && c.state === 'jailed' && (c.jailId == null || c.jailId === id || c.jailId === this.params.jailId));
  }

  /** Give `n` of an item to a commando (gainItem refreshes his ability list). */
  static give(commando, id, n) {
    if (commando.gainItem) commando.gainItem(id, n);
    else commando.inventory.set(id, (commando.inventory.get(id) || 0) + n);
  }

  /** A commando uses this interactable (pickup / door / switch …). Returns true on success. */
  interact(commando) {
    const w = this.world;
    const id = this.tag ?? this.id;
    switch (this.interactKind) {
      case 'door':
        if (this.enterable) return this.admit(commando);
        return this.setOpen(!this.open);
      case 'switch': case 'lever': case 'valve':
        this.on = !this.on;
        this._applyTargets();
        w?.events.emit('device', { id, sfx: this.interactKind === 'valve' ? 'valve_turn' : 'switch_throw', x: this.x, z: this.z, on: this.on });
        w?.events.emit('message', { text: `${this.interactKind === 'switch' ? 'Switch' : 'Lever'} ${this.on ? 'on' : 'off'}.`, kind: 'info' });
        return true;
      case 'phone':
        this.ringing = CONFIG.abilities.phoneRing ?? 10;
        this._pulseT = 0;
        w?.events.emit('device', { id, sfx: 'telephone_ring', x: this.x, z: this.z, on: true });
        return true;
      case 'ladder':
        w?.grid.setLinkEnabled(this.linkId, true);
        this.lowered = true;
        w?.events.emit('device', { id, sfx: 'gate_creak', x: this.x, z: this.z, on: true });
        return true;
      case 'clothesline':
        this.count = 0;
        if (w?.rules?.spyUniformFromCaptives) addToWardrobe(commando, this.params.uniform ?? 'soldier'); // BCD §1.6
        else Interactable.give(commando, 'uniform', 1);
        if (this.object3d) { // the uniform leaves the line; posts and the rest of the laundry stay
          const u = this.object3d.getObjectByName?.('clothesline_uniform');
          if (u) u.visible = false; else this.object3d.visible = false;
        }
        return true;
      case 'jail':
        for (const u of this.jailed()) {
          u.state = 'active';
          if (u.object3d) u.object3d.visible = true;
          const p = w?.grid.nearestWalkable?.(this.x, this.z, 3) || { x: this.x, z: this.z };
          u.setPosition?.(p.x, p.z);
          w?.events.emit('unit:freed', { unit: u, jailId: id, by: commando });
        }
        return true;
      case 'pickup': case 'ammo': {
        if (!commando?.inventory || this.count <= 0) return false;
        if (this.itemId === 'uniform' && w?.rules?.spyUniformFromCaptives) addToWardrobe(commando, this.params.uniform ?? 'soldier'); // BCD §1.6 (M5 UNIFORME: officer)
        else Interactable.give(commando, this.itemId, this.count);
        w?.events.emit('message', { text: `${commando.nickname || 'Commando'} picked up ${this.itemId}.`, kind: 'info', unit: commando });
        this.count = 0;
        this.alive = false;
        w?.removeLater?.(this);
        return true;
      }
      case 'crate': {
        let took = false;
        for (const [item, n] of Object.entries(this.contents || {})) {
          if (n > 0 && canPickUp(commando.role, item)) {
            Interactable.give(commando, item, n);
            this.contents[item] = 0;
            took = true;
          }
        }
        if (took && Object.values(this.contents).every((n) => !(n > 0))) { this.alive = false; w?.removeLater?.(this); }
        return took;
      }
      default: return false;
    }
  }

  /** Switch targets: electric fence power (world.fencePower), doors (open), ladders (enable). */
  _applyTargets() {
    const w = this.world;
    if (!w) return;
    for (const id of this.targets) {
      // electric fence: the switch cuts the power when turned (on = power off unless `powers:true`)
      if (w.fencePower?.has(id)) { w.fencePower.set(id, this.params.powers ? this.on : !this.on); continue; }
      const t = w.byId(id);
      if (t?.interactKind === 'door') t.setOpen(this.on);
      else if (t?.interactKind === 'ladder') { w.grid.setLinkEnabled(t.linkId, this.on); t.lowered = this.on; }
    }
  }

  update(dt) {
    if (this.interactKind === 'phone' && this.ringing > 0) {
      this.ringing -= dt;
      this._pulseT -= dt;
      const N = CONFIG.stealth.noise.phone;
      if (this._pulseT <= 0) {
        this._pulseT = N.pulse;
        this.world?.emitNoise(this.x, this.z, N.radius, 'phone', this, N.level);
      }
      if (this.ringing <= 0) this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'telephone_ring', x: this.x, z: this.z, on: false });
    }
  }

  /** True when (x, z) is inside the extraction zone. */
  contains(x, z) {
    return Math.hypot(x - this.x, z - this.z) <= (this.r || this.radius);
  }

  serialize() {
    return {
      ...super.serialize(), interactKind: this.interactKind, hp: this.hp, destroyed: this.destroyed, open: this.open, on: this.on,
      count: this.count, contents: this.contents, lowered: !!this.lowered, ringing: this.ringing,
      occupants: this.occupants.map((u) => u.id),
      ...(this.params?.pack ? { itemId: this.itemId, pack: true } : null), // BCD cigarette pack thrown in play (respawned)
    };
  }

  deserialize(d) {
    super.deserialize(d);
    this.hp = d.hp ?? this.hp;
    if (d.destroyed && !this.destroyed) this._applyDestroyedState(); // no side effects on load
    if (d.open !== this.open) this.setOpen(!!d.open, true); // grid cells + visibility only, quiet on load
    this.on = !!d.on;
    this.count = d.count ?? this.count;
    if (d.contents) this.contents = { ...d.contents };
    this.lowered = !!d.lowered;
    this.ringing = d.ringing ?? 0;
    const w = this.world;
    this.occupants = (d.occupants || []).map((uid) => w?.byId(uid)).filter(Boolean);
    for (const u of this.occupants) u.hideout = this;
  }
}

/**
 * Explosive fuel drum (§3.4 carry, §3.6 `barrel` class). Carried by the Green Beret (`carriedBy`), explodes when
 * shot by any bullet (takeDamage) or ignited by a nearby explosion (`ignite(delay)`, chain 0.2 s).
 * `hidesBody`: the body hidden under it (§3.4 body-in-barrel).
 */
export class Barrel extends Interactable {
  constructor(o = {}) {
    super({ ...o, interactKind: 'barrel', radius: o.radius ?? 0.4, dynamic: true });
    this.exploded = false;
    this.fuse = -1;
    this.igniter = null;
    this.hidesBody = null;
    this.pickRadius = 0.6;
    this.pickHeight = 0.5;
    if (!this.object3d) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x7a2a1a, roughness: 0.6, metalness: 0.3 }));
      m.position.y = 0.45;
      m.castShadow = true;
      const g = new THREE.Group();
      g.add(m);
      g.position.set(this.x, 0, this.z);
      this.object3d = g;
    }
  }

  /** Any bullet or explosion sets it off (§3.6 "Shooting a barrel with any bullet or vehicle weapon detonates it"). */
  takeDamage(amount, source) {
    if (this.exploded || amount <= 0) return;
    this.ignite(0, source);
    // a bullet sets it off at once: the blast resolves before the shot's own noise is heard, so guards
    // killed by it never react to the shot first (replay m01: e11 'spotted' the Driver in the same tick)
    if (this.world) this.explode();
  }

  /** Explode after `delay` s (0 = next update). */
  ignite(delay = 0, by = null) {
    if (this.exploded) return;
    if (this.fuse < 0 || delay < this.fuse) this.fuse = delay;
    this.igniter = this.igniter || by;
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true;
    this.alive = false;
    const w = this.world;
    const carrier = this.carriedBy;
    if (carrier) { carrier.carrying = null; this.carriedBy = null; }
    if (this.hidesBody) { this.hidesBody.hiddenUnderBarrel = false; this.hidesBody = null; }
    if (w) {
      this._navRest();
      explodeHook.fn?.(w, this.x, this.z, 'barrel', this, this.igniter);
      w.removeLater(this);
    }
  }

  /** A standing drum is solid for walkers (grid nav-only block, placement rule e); carried or gone it is not. */
  _navRest() {
    const g = this.world?.grid;
    if (!g?.navStamp) return;
    const rest = !this.exploded && !this.carriedBy && !this.removed;
    g.navStamp(`barrel:${this.id}`, rest ? g.rectCells(this.x, this.z, 0.7, 0.7, 0) : []);
    this._navAt = rest ? { x: this.x, z: this.z } : null;
  }

  update(dt) {
    const rest = !this.exploded && !this.carriedBy;
    if (rest ? (this._navAt?.x !== this.x || this._navAt?.z !== this.z) : this._navAt) this._navRest();
    if (this.exploded) return;
    if (this.carriedBy) {
      const c = this.carriedBy;
      this.x = c.x + Math.cos(c.heading) * 0.35;
      this.z = c.z + Math.sin(c.heading) * 0.35;
      this.y = (c.y || 0) + 0.9;
    } else if (this.hidesBody) {
      this.y = 0;
    }
    if (this.fuse >= 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) this.explode();
    }
  }

  canUse(commando) {
    if (this.exploded) return 'Nothing there.';
    if (this.carriedBy) return 'Already carried.';
    return canPickUp(commando?.role, 'barrel') ? true : "Can't pick that up.";
  }

  serialize() {
    return { ...super.serialize(), exploded: this.exploded, fuse: this.fuse, carriedBy: this.carriedBy?.id ?? null, hidesBody: this.hidesBody?.id ?? null };
  }

  deserialize(d) {
    super.deserialize(d);
    this.exploded = !!d.exploded;
    this.fuse = d.fuse ?? -1;
    const w = this.world;
    this.carriedBy = d.carriedBy != null ? w?.byId(d.carriedBy) || null : null;
    if (this.carriedBy) this.carriedBy.carrying = this;
    this.hidesBody = d.hidesBody != null ? w?.byId(d.hidesBody) || null : null;
  }
}

/**
 * Late-bound explosion function (abilities/explosions.js registers applyExplosion here, so this module has
 * no import cycle with the abilities package). Signature (world, x, z, cls, sourceEntity, killer).
 */
export const explodeHook = { fn: null };

/** Pickup marker mesh (small crate). */
export function createPickup(itemId, x, z, count = 1, extra = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.8 }));
  m.position.set(x, 0.18, z);
  m.castShadow = true;
  return new Interactable({ interactKind: 'pickup', x, z, itemId, count, object3d: m, tag: extra.id ?? null, ...extra });
}

/** Extraction zone (flat translucent ring on the ground). */
export function createExtraction(x, z, r) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 48), new THREE.MeshBasicMaterial({ color: 0x7fd07f, transparent: true, opacity: 0.45, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.04, z);
  return new Interactable({ interactKind: 'extraction', x, z, r, object3d: ring, tag: 'extraction' });
}

const MARKER_COLORS = { switch: 0xb0a040, lever: 0xb0a040, valve: 0x4080b0, phone: 0x202020, clothesline: 0x6a7050, ammo: 0x5a6a3a, crate: 0x8a7a50, jail: 0x505050, ladder: 0x7a5a30, door: 0x5a3a20 };

/** Clothesline with the uniform on it (art/clothesline.js; Verlet laundry in the wind). */
function clotheslineMesh(spec) {
  const g = makeClothesline({ uniform: true });
  g.position.set(spec.x, 0, spec.z);
  g.rotation.y = -(spec.rot ?? spec.heading ?? 0);
  return g;
}

/** Small placeholder marker mesh for a device (art replaces it through the prop interfaces). */
function markerMesh(kind, x, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.3), new THREE.MeshStandardMaterial({ color: MARKER_COLORS[kind] ?? 0x888888, roughness: 0.8 }));
  m.position.set(x, 0.4, z);
  m.castShadow = true;
  return m;
}

/**
 * Create an interactable from a mission `interactables[]` spec:
 * {interactKind|kind, x, z, id?, ...} — barrel | switch | lever | valve | phone | clothesline | ammo | crate |
 * jail | ladder | door (enterable hideout) | pickup.
 * @param {object} spec
 * @param {{meshes?: boolean}} [opts]
 */
export function createInteractable(spec, opts = {}) {
  const kind = spec.interactKind || spec.kind;
  const meshes = opts.meshes !== false;
  const base = { ...spec, interactKind: kind, tag: spec.id ?? null };
  if (INTERACTABLE_KINDS[kind]) return INTERACTABLE_KINDS[kind](base, opts); // registered kinds (BCD mechanics)
  switch (kind) {
    case 'barrel': return new Barrel(base);
    case 'ammo': return new Interactable({ ...base, itemId: 'sniperRifle', count: spec.count ?? CONFIG.abilities.ammoBox ?? 3, object3d: meshes ? markerMesh(kind, spec.x, spec.z) : null });
    case 'pickup': return createPickup(spec.itemId, spec.x, spec.z, spec.count ?? 1, { id: spec.id, ...(spec.uniform ? { uniform: spec.uniform } : null) });
    case 'clothesline': return new Interactable({ ...base, count: 1, object3d: meshes ? clotheslineMesh(spec) : null });
    default: return new Interactable({ ...base, object3d: meshes ? markerMesh(kind, spec.x, spec.z) : null });
  }
}

/**
 * Add a normalized mission's interactables to the world: `mission.interactables[]`, a hideout door for every
 * structure with `enterable:true` (§3.2), a ladder device for every raised ladder (§3.2: lowered from the top),
 * and the electric-fence power table (`world.fencePower`: fence structure id → powered).
 * Called by map-builder after the grid links exist. Link ids follow map-builder addMissionLinks
 * (climbLinks first, then ladders).
 * @returns {Interactable[]}
 */
export function spawnMissionInteractables(world, mission, opts = {}) {
  const out = [];
  const add = (it) => { world.add(it); out.push(it); return it; };
  world.fencePower = world.fencePower || new Map();
  for (const s of mission.structures || []) {
    if ((s.electric || s.variant === 'electric') && s.id != null) world.fencePower.set(s.id, s.powered !== false);
    if (s.enterable) {
      const rot = s.rot ?? 0, d = s.d ?? 6;
      // explicit mission door → the building-library asset's main door (map-builder, when close) → south face
      const door = s.door || world.structureDoors?.get?.(s.id) || [s.x + Math.cos(rot + Math.PI / 2) * (d / 2 + 0.6), s.z + Math.sin(rot + Math.PI / 2) * (d / 2 + 0.6)];
      add(new Interactable({ interactKind: 'door', enterable: true, x: door[0], z: door[1], id: s.id != null ? `${s.id}:door` : null, structure: s }));
    }
  }
  // raised ladders: prefer the map-builder's snapped registry (world.ladders: linkId + snapped top)
  if (Array.isArray(world.ladders)) {
    for (const l of world.ladders) {
      if (!l.raised) continue;
      const top = { x: l.top.x, z: l.top.z, y: l.top.y ?? 0 };
      add(new Interactable({ interactKind: 'ladder', x: top.x, z: top.z, top, linkId: l.linkId, id: l.id, tag: l.id, lowerTime: l.def?.lowerTime ?? 1.0 }));
    }
  }
  for (const l of Array.isArray(world.ladders) ? [] : mission.ladders || []) {
    if (!l.raised) continue;
    const top = { x: l.top[0], z: l.top[1], y: l.top[2] ?? 0 };
    const link = world.grid.links.find((g) => g.kind === 'ladder' && Math.hypot(g.b.x - top.x, g.b.z - top.z) < 0.01 && Math.hypot(g.a.x - l.x, g.a.z - l.z) < 0.01);
    add(new Interactable({ interactKind: 'ladder', x: top.x, z: top.z, top, linkId: l.linkId ?? link?.id ?? null, id: l.id ?? null }));
  }
  for (const spec of mission.interactables || []) add(createInteractable(spec, opts));
  return out;
}

export default Interactable;
