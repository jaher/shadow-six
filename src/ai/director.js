/**
 * AI director — `world.ai` (owned by AI). One per World, created lazily by `ensureAI(world)` (the first
 * EnemyBrain.attach or the Alarm constructor). It fans world events out to the brains and runs the
 * 20 Hz tick-integer rules (§4.5 nervousness) through world.onBelTick:
 *
 *   'noise'          → brain.hear(n) for every enemy within the radius (§4.4) + zone onHeard sensors (§4.9)
 *   'unit:killed'    → brain.notifyKill(victim, killer) (§4.3 kill seen) + squad bookkeeping (§4.9 regen)
 *   'unit:damaged'   → the wounded enemy hunts the shooter (§4.1)
 *   'vehicle:enter'  → witnesses taint the vehicle and fight it (§4.3)
 *   'ability:start'  → suspicious acts: unmask a disguised Spy (§3.4); a held commando attacking (§4.5)
 *   'shot'           → a held commando shooting → every aiming enemy fires (§4.5)
 *   'footprint'      → world.ai.footprints (§4.8)
 * @module ai/director
 */

import { CONFIG } from '../config.js';
import { Footprints } from './footprints.js';
import { canSee, hears } from './perception.js';
import { ABILITIES } from '../abilities/registry.js';

export class AIDirector {
  /** @param {import('../world/world.js').World} world */
  constructor(world) {
    this.world = world;
    this.footprints = new Footprints(world);
    /** Body entities that are not units (kind 'body'), registered by other systems. */
    this.extraBodies = [];
    /** squadId → {id, leader, trail:[{x,z}], members:Set} (§4.1 patrol squads) */
    this.squads = new Map();
    /** commando id → {x, z} at the previous 20 Hz tick (§4.5 displacement d) */
    this._prev = new Map();
    /** commando id → displacement (m) during the last 20 Hz tick */
    this.disp = new Map();
    const L = (t, fn) => world.listen(t, fn);
    L('noise', (n) => this._onNoise(n));
    L('unit:killed', (p) => this._onKilled(p));
    L('unit:damaged', (p) => this._onDamaged(p));
    L('vehicle:enter', (p) => this._onBoard(p));
    L('ability:start', (p) => this._onAbility(p));
    L('shot', (p) => this._onShot(p));
    L('footprint', (p) => this.footprints.add(p));
    this._offTick = world.onBelTick((dt20, n) => this._belTick(dt20, n));
  }

  // ------------------------------------------------------------ 20 Hz rules (§4.5, §10.1)

  _belTick(dt20, n) {
    const w = this.world;
    for (const c of w.commandos) {
      const p = this._prev.get(c.id);
      const d = p ? Math.hypot(c.x - p.x, c.z - p.z) : 0;
      this.disp.set(c.id, d);
      if (p) { p.x = c.x; p.z = c.z; } else this._prev.set(c.id, { x: c.x, z: c.z });
    }
    for (const e of w.enemies) if (e.alive && !e.removed) e.brain?.belTick?.(dt20, n);
  }

  // ------------------------------------------------------------ hearing (§4.4, §4.9)

  _onNoise(n) {
    const w = this.world;
    const zonesHeard = new Set();
    for (const e of w.enemies) {
      if (!e.alive || e.removed || !hears(e, n)) continue;
      e.brain?.hear?.(n);
      if ((n.level ?? 0) >= CONFIG.stealth.zoneHeardLevel && w.alarm) {
        const z = w.alarm.zoneAt(e.x, e.z);
        if (z && z.onHeard && !zonesHeard.has(z.id)) {
          zonesHeard.add(z.id);
          if (!(n.kind === 'explosion' && n.accident)) w.alarm.raise(z.id, 'heard', n.x, n.z, { sensor: 'heard' });
        }
      }
    }
  }

  // ------------------------------------------------------------ kills, wounds, squads

  _onKilled({ unit, killer, cause }) {
    const w = this.world;
    if (unit.faction === 'enemy') {
      if (killer && killer.faction === 'player') {
        killer._deedT = w.time; // §4.5: seen killing → N = 20·T
        for (const e of w.enemies) if (e !== unit && e.alive && !e.removed) e.brain?.notifyKill?.(unit, killer, cause);
      }
      w.alarm?.onEnemyKilled?.(unit);
    }
    if (unit.faction === 'player') {
      unit.held = false;
      for (const e of w.enemies) if (e.target === unit) e.brain?.onTargetGone?.(unit);
    }
  }

  _onDamaged({ unit, source }) {
    // 'unit:damaged' fires after hp is reduced but before die(): a lethal hit (e.g. a silent harpoon/knife
    // KILL, §3.3) must not make the dying man enter COMBAT, bark or flash the 'seen' warning (§6.2).
    if (unit.faction !== 'enemy' || !unit.alive || !(unit.hp > 0) || source?.faction !== 'player') return;
    unit.brain?.onHurt?.(source);
  }

  /** Squad record for a squad id (created on demand). */
  squad(id) {
    let s = this.squads.get(id);
    if (!s) this.squads.set(id, (s = { id, leader: null, trail: [], members: new Set() }));
    return s;
  }

  // ------------------------------------------------------------ witnesses

  /** Enemies that currently see `target` (optionally ignoring disguise), for event-driven checks. */
  witnesses(target, o = {}) {
    const out = [];
    for (const e of this.world.enemies) {
      if (!e.alive || e.removed || !e.vision || o.except === e) continue;
      if (canSee(e, target, this.world, o) !== 'none') out.push(e);
    }
    return out;
  }

  _onBoard({ vehicle, unit }) {
    if (!unit || unit.faction !== 'player' || !vehicle) return;
    unit._deedT = this.world.time;
    // the boarding commando counts as visible (standing) at the moment he climbs in (§4.2 band table)
    const proxy = { x: unit.x, z: unit.z, y: unit.y || 0, isLow: false, isVisibleToEnemies: true, disguised: unit.disguised };
    const seen = this.witnesses(proxy).filter((e) => e.brain?.reacts?.());
    if (!seen.length) return;
    if (!vehicle.tainted) {
      vehicle.tainted = true;
      this.world.events.emit('vehicle:tainted', { vehicle, by: seen[0] });
    }
    for (const e of seen) e.brain.onBoardSeen?.(vehicle, unit);
  }

  _onAbility({ unit, id }) {
    if (!unit || unit.faction !== 'player') return;
    const def = ABILITIES[id] ?? null;
    const suspicious = def ? def.visibleToEnemies !== false : true;
    if (unit.disguised && suspicious) {
      const seen = this.witnesses(unit, { ignoreDisguise: true }).filter((e) => e.brain?.reacts?.());
      if (seen.length) {
        const w = this.world;
        w.events.emit('enemy:unmasked-spy', { enemy: seen[0], spy: unit });
        const N = CONFIG.stealth.noise.spyUnmask;
        w.emitNoise(unit.x, unit.z, N.radius, 'spyUnmask', seen[0]);
        for (const e of seen) e.brain.onSuspiciousAct?.(unit);
      }
    }
    if (unit.held && suspicious) this._heldAttacked(unit);
  }

  _onShot({ shooter }) {
    if (shooter && shooter.faction === 'player' && shooter.held) this._heldAttacked(shooter);
  }

  /** §4.5: a held commando attacks → every enemy aiming at him switches to COMBAT. */
  _heldAttacked(unit) {
    for (const e of this.world.enemies) if (e.alive && e.target === unit) e.brain?.onTargetAttacked?.(unit);
  }

  /**
   * Jail door of structure `jailId` (§4.10): the structure's `door` {x, z} (mission data), else the nearest
   * walkable cell south of its footprint. @returns {{x, z}|null}
   */
  jailDoor(jailId) {
    const w = this.world;
    const s = (w.mission?.structures || []).find((q) => q.id === jailId);
    if (!s) return null;
    const d = s.door ? { x: s.door.x ?? s.door[0], z: s.door.z ?? s.door[1] } : { x: s.x, z: s.z + (s.d ?? 6) / 2 + 0.8 };
    return w.grid.nearestWalkable?.(d.x, d.z, 4) || d;
  }

  serialize() {
    return { footprints: this.footprints.serialize() };
  }

  deserialize(d) {
    if (d?.footprints) this.footprints.deserialize(d.footprints);
  }

  dispose() {
    this._offTick?.();
  }
}

/** The world's AI director, created on first use. */
export function ensureAI(world) {
  if (!world) return null;
  if (!world.ai) world.ai = new AIDirector(world);
  return world.ai;
}
