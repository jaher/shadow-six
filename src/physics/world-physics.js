/**
 * World physics (bodies-design §1, §A): one deterministic Rapier world per mission, stepped at the fixed sim dt inside
 * `Game.step()` after interactables. A presentation layer: `world.explode()` decides every death before physics runs;
 * only a body's resting place is fed back to gameplay (§A.4). `createPhysics()` returns the null object when Rapier
 * is unavailable, so gameplay never depends on it.
 *
 * Events emitted: `body:settled {unit, x, y, z}`, `prop:settled {ent}`, `unit:blast {unit, dv, reaction}`,
 * `blast:front {x, z, Rk, Rb, Q, kind}` (visual responses: doors, glass, grass, water, ground marks).
 * @module physics/world-physics
 */

import { CONFIG } from '../config.js';
import { NULL_PHYSICS } from './null-physics.js';
import { loadRapier } from './rapier-loader.js';
import { buildStatics, groundAt, GROUPS } from './statics.js';
import { spawnRagdoll, readPose, updateSettle, removeRagdoll, poseRecord } from './ragdoll.js';
import { applyBlast, EXPLOSIVE_CAUSES } from './blast-apply.js';
import { settleFeedback, trackInFlight } from './feedback.js';
import { PropSystem, propSpec } from './props.js';
import { GateDebris } from './debris.js';
import { isBreakableGate } from '../world/breakables.js';

/**
 * Create the physics for a freshly built world (after the map + terrain are ready).
 * @param {import('../world/world.js').World} world
 * @param {{tier?: string}} [o]
 * @returns {Promise<PhysicsWorld|object>} PhysicsWorld or NULL_PHYSICS
 */
export async function createPhysics(world, o = {}) {
  if (!CONFIG.physics.enabled) return NULL_PHYSICS;
  const R = await loadRapier();
  if (!R) return NULL_PHYSICS;
  try {
    return new PhysicsWorld(R, world, o);
  } catch (e) {
    console.warn('[physics] world build failed; physics disabled for this mission', e);
    return NULL_PHYSICS;
  }
}

export class PhysicsWorld {
  constructor(R, world, o = {}) {
    const P = CONFIG.physics;
    this.R = R;
    this.world = world;
    this.isNull = false;
    this.enabled = true;
    this.tier = o.tier || world.house?.physicsTier || 'high';
    this.caps = { ...P.gameplayCaps, ...(P.caps[this.tier] || P.caps.high) };
    this.rw = new R.World({ x: 0, y: P.gravity, z: 0 });
    this.rw.timestep = CONFIG.sim.dt;
    this.rw.integrationParameters.numSolverIterations = P.solverIterations;
    // loose props are their own bodies: their footprint cells stay out of the STATIC cuboids
    const loose = new Set([...(world.structures?.values?.() || [])].filter((st) => propSpec(st.def, st.type)).map((st) => st.owner));
    // breakable gates are their own (fixed, then broken) bodies: physics/debris.js
    for (const it of world.interactables || []) if (it.barrier && it.owner && isBreakableGate({ ...(it.params?.structure || {}), type: it.params?.structure?.type || 'gate' })) loose.add(it.owner);
    this.statics = buildStatics(R, this.rw, world, loose);
    /** @type {object[]} active ragdolls (sorted by unit id) */
    this.ragdolls = [];
    /** @type {{unit:object, at:number, prone:boolean}[]} settle ragdolls waiting for their death clip to end */
    this.pendingSettle = [];
    this.blasts = [];
    this.props = new PropSystem(this);
    this.gates = new GateDebris(this);
    // warm-up step: the first step builds the broad phase over every static collider (tens of ms on a big map); do it
    // at load, identically for every run (deterministic), not on the first blast
    this.rw.step();
    // warm the joint / contact paths once with a throw-away ragdoll (same for every run: deterministic), so the first
    // blast of the mission does not pay for it
    try {
      const rd = spawnRagdoll(R, this.rw, world, { x: 1, z: 1, y: 0, heading: 0 }, 'blast');
      for (let i = 0; i < 2; i++) this.rw.step();
      removeRagdoll(this.rw, rd);
      this.rw.step();
    } catch (e) { console.warn('[physics] warm-up failed', e); }
    this._ms = 0; this._msPeak = 0;
    this._offs = [
      world.events.on('explosion', (e) => this.queueBlast(e)),
      world.events.on('unit:killed', (e) => this._onKilled(e)),
    ];
  }

  // ------------------------------------------------------------ events

  queueBlast(ev) { if (ev && Number.isFinite(ev.x) && Number.isFinite(ev.z)) this.blasts.push({ ...ev, tick: this.world.tick }); }

  _onKilled({ unit, cause }) {
    if (!unit || unit.kind === 'vehicle') return;
    if (EXPLOSIVE_CAUSES.has(cause)) { unit._blastKill = this.world.tick; return; }
    this._scheduleSettle(unit);
  }

  _scheduleSettle(unit, delay = CONFIG.physics.ragdoll.settleAt) {
    if (!this.world.house?.ragdollAllDeaths) return;
    // drowned / shot swimmers keep today's water behaviour (no settle on the lake bed)
    const g = this.world.grid;
    if (unit.stance === 'swim' || unit.stance === 'dive' || g.isWater(Math.floor(unit.x / g.cell), Math.floor(unit.z / g.cell))) return;
    if (this.pendingSettle.some((p) => p.unit === unit) || this.ragdollOf(unit)) return;
    this.pendingSettle.push({ unit, at: this.world.time + delay, prone: unit.stance === 'crawl' || unit.stance === 'prone' });
  }

  // ------------------------------------------------------------ queries

  ragdollOf(unit) { return this.ragdolls.find((r) => r.unit === unit) || null; }
  activeCounts() { return { ragdolls: this.ragdolls.length, props: this.props.active.length, debris: this.gates.count() }; }
  /** True while anything simulates (a save then carries a snapshot, §A.10). */
  moving() { return this.ragdolls.length > 0 || this.props.active.length > 0 || this.gates.moving(); }
  stats() { return { ms: this._ms, rapier: this._msRapier ?? 0, peak: this._msPeak, ragdolls: this.ragdolls.length, props: this.props.active.length, bodies: this.rw.bodies.len() }; }

  /** Physics tier from the save (§A.9: the tier is part of the deterministic state). */
  setTier(tier) {
    if (!CONFIG.physics.caps[tier]) return;
    this.tier = tier; this.caps = { ...CONFIG.physics.gameplayCaps, ...CONFIG.physics.caps[tier] };
  }

  /** Can one more ragdoll start? (deterministic cap, §A.9) */
  canRagdoll() { return this.ragdolls.length < this.caps.ragdolls; }

  /** A body is eligible for a ragdoll: dead, lying free in the world (not carried, hidden, removed or sunk). */
  eligible(u) {
    return !!u && !u.removed && u.alive === false && u.state === 'dead' && !u.hiddenBody && !u.hiddenUnderBarrel
      && !u.carriedBy && !u.sunk && !u.vehicle && u.soldierType !== 'dog' && !u.animal;
  }

  /**
   * Start a ragdoll for `unit`. mode 'blast' (standing template + impulse) or 'settle' (lying); a unit that already
   * has a settled pose restarts from it (a corpse thrown again).
   * @returns {object|null}
   */
  startRagdoll(unit, mode, o = {}) {
    if (!this.eligible(unit) || this.ragdollOf(unit)) return null;
    const from = unit.bodyPose && (unit.bodyPose.b?.length === 77) ? unit.bodyPose : null;
    const rd = spawnRagdoll(this.R, this.rw, this.world, unit, from ? 'reuse' : mode, { prone: o.prone, from, lift: o.lift, vel: o.vel, fast: mode === 'blast', shoulder: o.shoulder });
    this.ragdolls.push(rd);
    this.ragdolls.sort((a, b) => a.unit.id - b.unit.id);
    rd.t0 = this.world.time;
    unit.settled = false;
    unit.bodyPose = null;
    unit._rd = rd;
    readPose(rd);
    return rd;
  }

  _endRagdoll(rd) {
    removeRagdoll(this.rw, rd);
    const i = this.ragdolls.indexOf(rd);
    if (i >= 0) this.ragdolls.splice(i, 1);
    if (rd.unit._rd === rd) rd.unit._rd = null;
  }

  // ------------------------------------------------------------ step

  /** One fixed step (inside Game.step after interactables). */
  step(dt) {
    const t0 = performance.now();
    const w = this.world;
    // queued blasts of this tick, in order (targets sorted by id inside)
    for (const b of this.blasts.splice(0)) applyBlast(this, b);
    // explosion kills that no blast reached (e.g. a unit flagged by an event without an explosion) → settle
    for (const u of w.commandos.concat(w.enemies)) {
      if (u._blastKill != null && u._blastKill <= w.tick) { delete u._blastKill; if (!this.ragdollOf(u)) this._scheduleSettle(u); }
      // a body put down again (carry / drag) settles where it lies
      if (u.alive === false) {
        if (u.state === 'carried') {
          if (u.bodyPose) u.bodyPose = null;
          u._rdCarried = true;
          const rd = this.ragdollOf(u);
          if (rd) this._endRagdoll(rd); // picked up mid-settle: the transport pose takes over (§C.10)
        } else if (u._rdCarried) {
          u._rdCarried = false;
          // bodies-design §C.4: knocked off a shoulder by a hit → a ragdoll falling from about 1.4 m along the hit
          const dr = u.carryDrop;
          if (dr && dr.how === 'shot' && dr.mode !== 'drag' && w.house?.ragdollAllDeaths && this.eligible(u) && this.canRagdoll()) {
            this.startRagdoll(u, 'settle', { shoulder: true, vel: dr.dir ? { x: dr.dir.x * 1.6, y: 0.4, z: dr.dir.z * 1.6 } : null });
          } else this._scheduleSettle(u, 0.2);
        }
      }
    }
    // settle ragdolls whose death clip ended (entity-id order, cap-limited)
    if (this.pendingSettle.length) {
      const due = this.pendingSettle.filter((p) => p.at <= w.time + 1e-9).sort((a, b) => a.unit.id - b.unit.id);
      for (const p of due) {
        // over the cap: the canned clip stays and the body waits for a free slot (≤ 10 s), in id order
        if (this.eligible(p.unit) && !this.canRagdoll() && w.time - p.at < 10) continue;
        this.pendingSettle.splice(this.pendingSettle.indexOf(p), 1);
        if (this.eligible(p.unit) && this.canRagdoll()) this.startRagdoll(p.unit, 'settle', { prone: p.prone });
      }
    }
    this.props.preStep(dt);
    this.gates.preStep(dt);
    this._unitCapsules();
    if (this.ragdolls.length || this.props.active.length || this.gates.moving()) {
      const ts = performance.now();
      this.rw.step();
      this._msRapier = performance.now() - ts;
      for (const rd of [...this.ragdolls]) {
        if (!this.eligible(rd.unit)) { this._endRagdoll(rd); continue; }
        readPose(rd);
        trackInFlight(this, rd);
        if (updateSettle(rd, dt)) {
          settleFeedback(this, rd, poseRecord(rd));
          this._endRagdoll(rd);
        }
      }
      this.props.postStep(dt);
      this.gates.postStep(dt);
    }
    const ms = performance.now() - t0;
    this._ms = ms; if (ms > this._msPeak) this._msPeak = ms;
  }

  /**
   * Live units as kinematic capsules (§A.2: r 0.3, h 1.6) that push ragdolls and props but are never pushed: only
   * while something simulates, only for units within 5 m of it (entity-id order; never camera-dependent).
   */
  _unitCapsules() {
    const R = this.R, w = this.world;
    this.capsules ||= new Map();
    const active = [];
    for (const rd of this.ragdolls) active.push(rd.pose);
    for (const it of this.props.active) active.push(it.pose);
    for (const g of this.gates.active) for (const b of g.bodies) if (!b.fixed) active.push(b.pose);
    const want = new Set();
    if (active.length) {
      for (const u of w.commandos.concat(w.enemies)) {
        if (u.removed || u.alive === false || u.vehicle || u.state === 'inVehicle' || u.state === 'carried' || u.hidden) continue;
        // a man lying on the ground (DOWNED, crawling, a BCD knock-out or cuffed man) is no upright 1.6 m pillar
        if (u.downed || u.state === 'downed' || u.state === 'stunned' || u.state === 'bound' || u.stance === 'crawl' || u.stance === 'prone') continue;
        if (active.some((p) => Math.abs(p[0] - u.x) < 5 && Math.abs(p[2] - u.z) < 5)) want.add(u);
      }
    }
    for (const [u, b] of [...this.capsules]) if (!want.has(u)) { this.rw.removeRigidBody(b); this.capsules.delete(u); }
    for (const u of [...want].sort((a, b) => a.id - b.id)) {
      const y = groundAt(w, u.x, u.z) + (u.y || 0) + 0.8;
      let b = this.capsules.get(u);
      if (!b) {
        b = this.rw.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(u.x, y, u.z));
        this.rw.createCollider(R.ColliderDesc.capsule(0.5, 0.3).setCollisionGroups(GROUPS.UNIT), b);
        this.capsules.set(u, b);
      } else b.setNextKinematicTranslation({ x: u.x, y, z: u.z });
    }
  }

  // ------------------------------------------------------------ persistence (§A.10)

  serialize() { return serializePhysics(this); }
  restore(data) { restorePhysics(this, data); }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs = [];
    this.props.dispose?.();
    this.gates.dispose?.();
    try { this.rw.free(); } catch { /* already freed */ }
    this.ragdolls = []; this.pendingSettle = []; this.blasts = [];
  }
}

// persistence lives in its own module (snapshot + handle maps) to keep this file small
import { serializePhysics, restorePhysics } from './persist.js';
