/**
 * Blood system (docs/bodies-design.md §B, PROGRESS 4y) — `world.blood`. Pure presentation driven by events:
 * `unit:damaged` (entry puff handled by fx, spatter + stains here), `unit:killed` (bleeder: pool, knife spurt, blast
 * spatter, run-over smear), `body:settled` (pool re-anchored), `unit:downed` / `unit:revived` (a downed commando
 * bleeds; a revive stops it), plus per-tick body transport (drips on a shoulder, smears behind a drag) and footfalls
 * (bloody prints). It never writes simulation state, and the AI never reads it (§B.0): guards react to bodies only.
 *
 *   world.blood = new BloodSystem(world, scene)   // game.loadMission; headless (node) keeps the records only
 *   blood.update(dt)   // Game.step (sim tick, frozen while paused)   blood.frame()   // Game.render
 *   blood.serialize() / restore(snap)            // save.js (§B.7)
 * BLOOD off or CENSORED on → no blood at all (nothing is recorded, the layers are hidden).
 * @module render/blood
 */
import { CONFIG } from '../../config.js';
import {
  bloodEnabled, woundClass, surfaceAt, surfaceCode, rng32, seedOf, range, budgets, recycleIndex, recycleStain, stepInPool,
  bloodyStep, poolWet, clamp01,
} from './model.js';
import { PoolSim } from './pool-sim.js';

const LIVING = new Set(['commando', 'enemy', 'guest']);
/** Decal kinds (atlas tiles, textures.js). */
/** Litres left in a drained body's clothes and wounds for drips / a faint smear when it is moved later (§B.5). */
const RESID = 0.04;
export const DK = { drop: 0, drop2: 1, drop3: 2, drop4: 3, streak: 4, streak2: 5, crown: 6, soak: 7, bootL: 8, bootR: 9, tyre: 10, spurt: 11, splat: 12, splat2: 13 };

export class BloodSystem {
  /**
   * @param {object} world
   * @param {object} [scene] main scene (null / node → records only)
   * @param {{visual?:boolean, layers?:object}} [o] layers: prebuilt visual layers (tests)
   */
  constructor(world, scene = null, o = {}) {
    this.world = world; this.scene = scene;
    this.visual = o.visual ?? (typeof document !== 'undefined' && !!scene);
    this.time = 0;
    this.nextId = 1;
    /** @type {Map<number, object>} unit id → bleeder */
    this.bleeders = new Map();
    this.pools = [];
    this.decals = [];
    this.smears = [];
    /** @type {Map<number, object[]>} unit id → stain slots */
    this.stains = new Map();
    this.stats = { pools: 0, decals: 0, smears: 0, stains: 0, ms: 0, simMs: 0 };
    this._burst = new Map(); // unit id → recent spatter times (≤ 3 per 0.2 s)
    this._feetT = 0;
    this.layers = o.layers || null;
    if (this.visual && !this.layers) this._makeLayers();
    const on = (ev, fn) => world.events.on(ev, (e) => { try { fn(e || {}); } catch (err) { console.error(`[blood] ${ev}`, err); } });
    this._off = [
      on('unit:damaged', (e) => this.onDamaged(e)),
      on('unit:killed', (e) => this.onKilled(e)),
      on('body:settled', (e) => this.onSettled(e)),
      on('unit:downed', (e) => this.onDowned(e)),
      on('unit:revived', (e) => this.onRevived(e)),
    ];
  }

  /** §B.0 switch (BLOOD option on and CENSORED off). */
  get on() { return bloodEnabled(this.world.game?.options); }
  /** Budgets of the current quality preset. */
  get budget() { return budgets(this.world.game?.renderer?.presetName || this.world.house?.physicsTier || 'high'); }

  async _makeLayers() {
    try {
      const { createBloodLayers } = await import('./layers.js');
      this.layers = createBloodLayers(this, this.scene);
      this.layers.rebuild?.();
    } catch (err) { console.warn('[blood] visual layers unavailable', err); this.layers = null; }
  }

  // ------------------------------------------------------------------ helpers

  _gy(x, z) { const g = this.world.groundY; return typeof g === 'function' ? (g.call(this.world, x, z) || 0) : 0; }
  /** Floor height under (x, z): the ground, plus a roof / platform / deck elevation (units there stand at y = elev). */
  _floorY(x, z) {
    const gr = this.world.grid, gy = this._gy(x, z);
    if (!gr?.inBounds) return gy;
    const i = Math.floor(x / gr.cell), j = Math.floor(z / gr.cell);
    if (!gr.inBounds(i, j)) return gy;
    const e = gr.elev?.[gr.idx(i, j)] || 0;
    return gy + (e > 0.05 ? e : 0);
  }
  _surf(x, z) { return surfaceAt(this.world, x, z); }
  _rng(u, salt) { return rng32(seedOf(u?.id ?? 0, salt + ((this.time * 60) | 0))); }
  _isBody(u) { return !!u && LIVING.has(u.kind) && u.x != null; }
  _units() { return [...(this.world.commandos || []), ...(this.world.enemies || [])]; }

  /** World position of a unit's wound bone (the real skeleton when drawn, else a height by stance). */
  woundPos(u, bone = 'spine_03') {
    const b = this.visual ? u.model?.real?.getSocket?.(bone) : null;
    if (b?.getWorldPosition && b.matrixWorld) {
      const e = b.matrixWorld.elements;
      return { x: e[12], y: e[13], z: e[14] };
    }
    const lying = !u.alive || u.stance === 'prone' || u.stance === 'crawl' || u.stance === 'downed';
    const h = lying ? 0.2 : bone === 'neck_01' ? 1.45 : bone === 'pelvis' ? 0.95 : bone.startsWith('calf') ? 0.35 : 1.25;
    return { x: u.x, y: this._gy(u.x, u.z) + h, z: u.z };
  }

  // ------------------------------------------------------------------ events

  onDamaged(e) {
    const u = e.unit;
    if (!this.on || !this._isBody(u)) return;
    const lethal = u.hp <= 0;
    const w = woundClass(e.cause, { lethal });
    if (!w || w.cls === 'explosion' || w.cls === 'runover') return; // those are drawn at the death (radial / smear)
    if (w.spec.perUnit) {                                          // bursts: ≤ 3 cones per unit per 0.2 s
      const t = (this._burst.get(u.id) || []).filter((s) => this.time - s < w.spec.window);
      if (t.length >= w.spec.perUnit) return;
      t.push(this.time); this._burst.set(u.id, t);
    }
    const src = e.source, r = this._rng(u, 1);
    let dx = 0, dz = 1;
    if (src && src.x != null) { const d = Math.hypot(u.x - src.x, u.z - src.z) || 1; dx = (u.x - src.x) / d; dz = (u.z - src.z) / d; }
    else { const a = r() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
    const wp = this.woundPos(u, w.spec.wound);
    if (w.spec.spatter) this._spatter(u, wp, dx, dz, w.spec, r);
    // entry + exit wounds (§B.4): one slot each on the victim
    this.addStain(u, w.spec.wound, { dx: -dx, dz: -dz }, w.spec.stain, 'entry');
    if (w.cls === 'shot' || w.cls === 'burst' || w.cls === 'nonLethal') this.addStain(u, w.spec.wound, { dx, dz }, w.spec.stain * 1.2, 'exit');
  }

  onKilled(e) {
    const u = e.unit;
    if (!this.on || !this._isBody(u)) return;
    const w = woundClass(e.cause);
    if (!w) return;
    const r = this._rng(u, 2), S = w.spec;
    const wp = this.woundPos(u, S.wound);
    if (this._inWater(u.x, u.z)) { this._cloud(u.x, u.z, S.pool); return; }
    if (w.cls === 'knife') {
      this._spurt(u, wp, e.killer, S, r);
      this.addStain(u, 'neck_01', { dx: 0, dz: 0 }, S.stain, 'entry');
      this.addStain(u, 'spine_03', { dx: 0, dz: 0 }, S.stain * 0.9, 'soak');
      if (this._isBody(e.killer)) { this.addStain(e.killer, 'hand_r', null, 0.05, 'spray'); this.addStain(e.killer, 'lowerarm_r', null, 0.06, 'spray'); }
    } else if (w.cls === 'explosion') {
      this._radial(u, S, r);
      this.addStain(u, 'spine_02', null, S.stain, 'entry');
    } else if (w.cls === 'runover') {
      const v = e.killer, h = v?.heading ?? r() * 6.283;
      this._decal(DK.tyre, u.x - Math.cos(h) * 0.4, u.z - Math.sin(h) * 0.4, S.smear, h, 0.9);
      this.addStain(u, 'pelvis', null, S.stain, 'entry');
    }
    if (S.pool > 0) this._bleeder(u, w.cls, S, r);
  }

  onSettled(e) {
    const u = e.unit, b = u && this.bleeders.get(u.id);
    if (!b) return;
    b.settled = true;
    const p = b.pool;
    if (p && !p.stopped && p.age < 10 && Math.hypot(p.x - u.x, p.z - u.z) > 0.2) this._reanchor(b);
  }

  onDowned(e) {
    const u = e.unit;
    if (!this.on || !this._isBody(u)) return;
    const r = this._rng(u, 3), w = woundClass(e.cause) || woundClass('shot');
    this._bleeder(u, 'downed', { ...w.spec, pool: Math.max(0.6, w.spec.pool || 0.6), grow: [50, 60] }, r);
  }

  onRevived(e) {
    const b = e.unit && this.bleeders.get(e.unit.id);
    if (!b) return;
    if (b.pool && !b.pool.stopped) this._stopPool(b.pool);
    b.left = 0; b.done = true;
  }

  // ------------------------------------------------------------------ spawners

  _inWater(x, z) {
    const g = this.world.grid; if (!g?.isWater) return false;
    const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
    return g.inBounds(i, j) && g.isWater(i, j) && !g.bridge?.[g.idx(i, j)] && !this.world.mission?.water?.frozen;
  }

  /** Faint red cloud dispersing in water (§B.3 water): no decal. */
  _cloud(x, z, vol = 0.5) {
    this.world.fx?.spawn?.('blood_cloud', x, z, { y: 0.02, scale: 0.6 + vol * 0.5, dur: CONFIG.blood.water.cloud });
  }

  /** Is a grid cell a wall/blocker at (x, z)? */
  _wall(x, z) {
    const g = this.world.grid; if (!g?.inBounds) return false;
    const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
    if (!g.inBounds(i, j)) return false;
    const k = g.idx(i, j);
    return !!g.block && g.block[k] === 2 && !(g.elev?.[k] > 0.05) && !g.bridge?.[k]; // B.HIGH: walls (not fences, bushes)
  }

  /**
   * Record a decal (spatter drop, streak, drip, boot print, tyre smear). Ground decals follow the terrain; `o.n` sets
   * a wall normal (vertical decal at height o.y). Returns the record or null (water, budget 0).
   */
  _decal(k, x, z, size, rot = 0, op = 1, o = {}) {
    if (!this.on) return null;                                     // BLOOD off / CENSORED: nothing new, ever
    if (!o.n && this._inWater(x, z)) return null;
    const sf = o.sf ?? surfaceCode(this._surf(x, z));
    const d = { id: this.nextId++, k, x: +x.toFixed(3), y: +(o.y ?? this._floorY(x, z)).toFixed(3), z: +z.toFixed(3), n: o.n || null, s: +size.toFixed(3), r: +rot.toFixed(3), op: +op.toFixed(3), t0: this.time - (o.age || 0), sf };
    this.decals.push(d);
    const cap = this.budget.decals;
    if (this.decals.length > cap) this.layers?.dropDecals?.(this.decals.splice(0, this.decals.length - cap)); // redraws all, d included
    else this.layers?.addDecal?.(d);
    return d;
  }

  /** Droplets flung from wound `wp` along (dx, dz) inside the cause's cone: ground, walls, and nearby units. */
  _spatter(u, wp, dx, dz, spec, r) {
    const n = Math.round(range(r, spec.spatter));
    const cone = (spec.cone || 20) * Math.PI / 180, base = Math.atan2(dz, dx);
    for (let i = 0; i < n; i++) {
      const a = base + (r() * 2 - 1) * cone * (spec.cone >= 180 ? 1 : 0.5 + 0.5 * r());
      const d = spec.range[0] + (spec.range[1] - spec.range[0]) * Math.pow(r(), 1.6); // most land close
      const cx = Math.cos(a), cz = Math.sin(a);
      let hit = null;
      for (let s = 0.25; s <= d; s += 0.25) {                     // a wall in the way takes the droplet
        const x = wp.x + cx * s, z = wp.z + cz * s;
        if (this._wall(x, z)) { hit = { x: x - cx * 0.2, z: z - cz * 0.2, y: Math.max(0.15, wp.y - wp.y * 0.18 * s * s) }; break; }
      }
      const far = d > 1.0, sz = far ? 0.12 + r() * 0.12 : 0.06 + r() * 0.08; // tile sizes (the drop fills ~40 % of its tile)
      const kind = far ? (r() < 0.5 ? DK.streak : DK.streak2) : DK.drop + Math.floor(r() * 4);
      if (hit && hit.y < wp.y + 0.3) this._decal(kind, hit.x, hit.z, sz, a, 0.75 + 0.25 * r(), { y: hit.y, n: [-cx, 0, -cz] });
      else this._decal(kind, wp.x + cx * d, wp.z + cz * d, far ? sz * 1.6 : sz, a, 0.7 + 0.3 * r());
    }
    // anyone standing in the cone catches a faint spray on the clothes (§B.4)
    for (const o of this._units()) {
      if (o === u || !o.alive || o.kind === 'vehicle') continue;
      const ox = o.x - wp.x, oz = o.z - wp.z, od = Math.hypot(ox, oz);
      if (od > spec.range[1] || od < 0.2) continue;
      if (Math.acos(Math.max(-1, Math.min(1, (ox * dx + oz * dz) / od))) > cone * 1.2) continue;
      this.addStain(o, 'spine_03', { dx: -ox / od, dz: -oz / od }, CONFIG.blood.stain.spray * 1.4, 'spray');
    }
  }

  /** Knife: a short arterial spurt — 3 pulses over 1 s, arcs of 0.3–0.9 m (§B.1). */
  _spurt(u, wp, killer, spec, r) {
    const P = spec.spurt;
    let a = r() * 6.283;
    if (killer && killer.x != null) a = Math.atan2(u.z - killer.z, u.x - killer.x) + (r() - 0.5) * 1.6; // away from the attacker, to a side
    for (let p = 0; p < P.pulses; p++) {
      const at = (p / P.pulses) * P.time + 0.05, len = range(r, P.arc) * (1 - p * 0.22), ap = a + (r() - 0.5) * 0.5;
      this._after(at, () => {
        const cx = Math.cos(ap), cz = Math.sin(ap);
        this._decal(DK.spurt, wp.x + cx * len * 0.55, wp.z + cz * len * 0.55, len * 1.1, ap, 0.8);
        for (let k = 0; k < P.drops; k++) {
          const t = 0.35 + 0.65 * (k / P.drops) + (r() - 0.5) * 0.1;
          this._decal(DK.drop + (k % 4), wp.x + cx * len * t + (r() - 0.5) * 0.06, wp.z + cz * len * t + (r() - 0.5) * 0.06, 0.03 + r() * 0.04, ap, 0.85);
        }
      });
    }
  }

  /** Blast deaths: sparse radial spatter within 2 m of the body's path (scorch dominates, §B.1). */
  _radial(u, spec, r) {
    const n = Math.round(range(r, spec.radial));
    for (let i = 0; i < n; i++) {
      const a = r() * 6.283, d = range(r, spec.range);
      const big = r() < 0.25;
      this._decal(big ? (r() < 0.5 ? DK.splat : DK.splat2) : DK.drop + Math.floor(r() * 4), u.x + Math.cos(a) * d, u.z + Math.sin(a) * d, big ? 0.12 + r() * 0.12 : 0.03 + r() * 0.05, a, 0.6 + 0.3 * r());
    }
  }

  /** Run fn after `t` s of sim time (knife pulses). */
  _after(t, fn) { (this._timers ||= []).push({ at: this.time + t, fn }); }

  // ------------------------------------------------------------------ clothing stains (§B.4)

  /**
   * Add a stain slot on unit u at `bone` (offset toward (dx, dz) = the side facing the hit), radius `r` m at full
   * spread. Budget per unit (8 high / 4 low); the oldest then smallest slot is recycled. Written on events only.
   */
  addStain(u, bone, dir, r, kind = 'entry') {
    if (!this.on || !this._isBody(u) || !(r > 0)) return null;
    let list = this.stains.get(u.id);
    if (!list) { list = []; this.stains.set(u.id, list); }
    const heading = u.heading || 0, c = Math.cos(-heading), s = Math.sin(-heading);
    // offset in the unit's local frame (x forward, z right) so it rides with the body
    const off = dir ? [(dir.dx * c - dir.dz * s) * 0.12, 0, (dir.dx * s + dir.dz * c) * 0.12] : [0, 0, 0];
    const slot = { bone, off: off.map((v) => +v.toFixed(3)), radius: +r.toFixed(3), t0: this.time, kind };
    const cap = this.budget.stains;
    if (list.length >= cap) list.splice(recycleStain(list), 1);
    list.push(slot);
    this.layers?.stainsChanged?.(u, list);
    return slot;
  }

  // ------------------------------------------------------------------ bleeders & pools (§B.2)

  _bleeder(u, cls, spec, r) {
    let b = this.bleeders.get(u.id);
    if (b) { b.left += spec.pool; b.total += spec.pool; b.done = false; return b; }
    b = {
      id: u.id, unit: u, cls, left: spec.pool, total: spec.pool, grow: range(r, spec.grow),
      delay: cls === 'explosion' ? 1.5 : range(r, CONFIG.blood.pool.delay), t0: this.time, wait: 0,
      pool: null, n: 0, still: 0, lx: u.x, lz: u.z, drip: 0.4, sx: null, sz: null, done: false, resid: RESID,
      settled: !!u.settled, pulses: cls === 'knife' ? 3 : 0, bone: spec.wound || 'spine_03',
    };
    this.bleeders.set(u.id, b);
    return b;
  }

  /** Start a pool for bleeder b at the wound bone projected to the ground under the body now. */
  _startPool(b, o = {}) {
    if (!this.on && !o.restore) return null;
    const u = b.unit, wp = this.woundPos(u, b.bone === 'neck_01' ? 'spine_03' : b.bone);
    // the blood runs out beside the torso, not only under it: a seeded 0.12–0.3 m lateral offset
    const ra = rng32(seedOf(u.id, 55 + b.n)), oa = ra() * 6.283, od = 0.12 + 0.18 * ra();
    const x = o.x ?? wp.x + Math.cos(oa) * od, z = o.z ?? wp.z + Math.sin(oa) * od;
    if (this._inWater(x, z)) { this._cloud(x, z, b.left); b.left = 0; b.done = true; return null; }
    const surface = o.surface ?? this._surf(x, z);
    // tile rotated so +y runs downhill (the tongue has room); flat ground: a seeded angle
    const e = 0.5, gx = this._gy(x + e, z) - this._gy(x - e, z), gz = this._gy(x, z + e) - this._gy(x, z - e);
    const slope = Math.hypot(gx, gz) / (2 * e);
    const rot = o.rot ?? (slope > 0.01 ? Math.atan2(-gx, gz) : (seedOf(u.id, b.n) % 6283) / 1000);
    const p = {
      id: o.id ?? this.nextId++, unitId: u.id, x: +x.toFixed(3), z: +z.toFixed(3), rot: +rot.toFixed(4), slope: +Math.min(0.3, slope).toFixed(4),
      cause: b.cls, surface, volume: +(o.volume ?? b.left).toFixed(4), grow: +(o.grow ?? b.grow).toFixed(2), age: o.age ?? 0,
      seed: o.seed ?? seedOf(u.id, 101 + b.n), stopped: !!o.stopped, pulses: b.pulses, sim: null,
    };
    b.n++;
    b.pool = p; b.left = 0;
    this.pools.push(p);
    const cap = this.budget.pools;
    while (this.pools.length > cap) {
      const i = recycleIndex(this.pools);
      const [old] = this.pools.splice(i, 1);
      this.layers?.removePool?.(old);
    }
    if (surface === 'snow' && p.volume > 0.3) this._melt(p);
    this.layers?.addPool?.(p);
    return p;
  }

  /** Snow: a slight melt depression (−1.5 cm, soft) under the core (§B.3). Visual trail stamp, never recorded. */
  _melt(p) {
    const t = this.world.terrain;
    if (!this.visual || !t?.stampTrail) return;
    const mat = t.materialAt?.(p.x, p.z), soft = Math.max(0.03, mat?.soft ?? 0.15);
    const w = 0.35 + 0.35 * Math.sqrt(p.volume);
    t.stampTrail('melt', p.x, p.z, p.rot, { width: w, depth: Math.min(0.5, CONFIG.blood.surfaces.snow.melt / soft), record: false, id: null });
  }

  /** The body was moved: this pool stops growing; the volume it had not bled yet goes back to the bleeder. */
  _stopPool(p) {
    if (p.stopped) return 0;
    p.stopped = true; p.stopAt = +p.age.toFixed(3);
    const b = this.bleeders.get(p.unitId);
    let back = 0;
    if (p.sim) back = p.sim.stop();
    else back = p.volume * Math.max(0, 1 - p.age / p.grow);   // headless estimate: the unbled share
    p.back = +back.toFixed(4); p.volume = +(p.volume - back).toFixed(4);
    if (b) b.left += back;
    if (p.volume <= 0.002) {                                         // moved before it bled: no pool at all
      const i = this.pools.indexOf(p);
      if (i >= 0) { this.pools.splice(i, 1); this.layers?.removePool?.(p); }
      return back;
    }
    this.layers?.poolChanged?.(p);
    return back;
  }

  /** body:settled moved the body shortly after the pool began: restart it under the settled wound. */
  _reanchor(b) {
    const p = b.pool, i = this.pools.indexOf(p);
    if (i >= 0) { this.pools.splice(i, 1); this.layers?.removePool?.(p); }
    b.left += p.volume; b.pool = null;
    this._startPool(b, { age: 0 });
  }

  // ------------------------------------------------------------------ per tick

  /** Sim tick (Game.step): ages, pool starts, transport (drips / smears), bloody feet. */
  update(dt) {
    this.time += dt;
    if (this._timers?.length) {
      const due = this._timers.filter((t) => t.at <= this.time);
      this._timers = this._timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    for (const p of this.pools) p.age += dt;
    for (const s of this.smears) s.age = this.time - s.t0;
    for (const b of this.bleeders.values()) this._tickBleeder(b, dt);
    this._feetT -= dt;
    if (this._feetT <= 0) { this._feetT = 0.2; this._feet(); }
  }

  _tickBleeder(b, dt) {
    const u = b.unit;
    if (u.removed || u.hiddenBody) { b.done = true; return; }
    const carried = u.state === 'carried' && !!u.carriedBy;
    if (b.done && !(carried && (b.resid ?? RESID) > 0.0005)) return;  // a drained body moved later: its residue
    if (carried) b.done = false;
    if (b.cls === 'explosion' && u._rd && !u.alive) this._flightDrops(b, u._rd.pose);
    const moved = Math.hypot(u.x - b.lx, u.z - b.lz);
    b.lx = u.x; b.lz = u.z;
    b.still = moved > 0.02 ? 0 : b.still + dt;                      // a settling ragdoll's millimetre creep counts as still
    if (carried || (moved > 0.02 && u.alive)) {                      // transported, or a downed man crawling
      if (b.pool && !b.pool.stopped) this._stopPool(b.pool);
      b.pool = null; b.wait = 0;
      this._transport(b, dt, carried ? (u.carriedBy.carryMode || 'shoulder') : 'crawl');
      return;
    }
    if (b.pool) {                                                   // thrown again (a later blast): that pool ends
      if (!b.pool.stopped && Math.hypot(u.x - b.pool.x, u.z - b.pool.z) > 0.8) { this._stopPool(b.pool); b.pool = null; b.wait = 0; }
      return;
    }
    if (b.left <= 0.02) { b.done = !u.alive || u.state === 'dead'; return; }
    b.wait += dt;
    // a blast victim bleeds where he comes to rest as soon as he lies still (no wait for the full settle test)
    const settleOk = b.settled || u.settled || !this.world.physics || this.world.physics.isNull || b.wait > (b.cls === 'explosion' ? 2.5 : 6) || b.n > 0;
    const delay = b.n > 0 ? 0.5 : b.delay;                           // laid down again: bleeds again after 0.5 s
    if (b.wait >= delay && settleOk && (b.still >= 0.3 || b.wait > 8)) this._startPool(b);
  }

  /** §B.1 blast: sparse drops flung along the flight (the ragdoll's pelvis), one every ~0.45 m while low enough. */
  _flightDrops(b, p) {
    const x = p[0], z = p[2], h = p[1] - this._gy(x, z);
    if (b.fx == null) { b.fx = x; b.fz = z; return; }
    if (Math.hypot(x - b.fx, z - b.fz) < 0.45) return;
    b.fx = x; b.fz = z;
    if (h > 1.8 || this._inWater(x, z)) return;
    const r = this._rng(b.unit, 40 + (b.fn = (b.fn || 0) + 1));
    for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) {
      const ox = (r() - 0.5) * 0.35, oz = (r() - 0.5) * 0.35;
      this._decal(r() < 0.35 ? DK.streak : DK.drop + Math.floor(r() * 4), x + ox, z + oz, 0.04 + r() * 0.07, r() * 6.283, 0.9);
    }
  }

  /** Drips while on a shoulder, a smear while dragged or crawling (§B.5). */
  _transport(b, dt, mode) {
    const u = b.unit, T = CONFIG.blood.trail;
    const frac = clamp01(b.left / Math.max(0.1, b.total));
    // a body whose pool has drained still holds blood in the clothes and wounds: lifting or dragging it later leaves
    // sparse drips and a faint smear from that residue (b.resid) instead of nothing
    const res = b.left <= 0.005;
    if (res && !((b.resid ?? RESID) > 0.0005)) return;
    if (mode === 'shoulder') {
      b.drip -= dt;
      if (b.drip > 0) return;
      const r = this._rng(u, 5 + b.n);
      b.drip = T.dripEvery[0] + (T.dripEvery[1] - T.dripEvery[0]) * (1 - frac) * (0.7 + 0.6 * r());
      const wp = this.woundPos(u, b.bone);
      const x = wp.x + (r() - 0.5) * 0.08, z = wp.z + (r() - 0.5) * 0.08, sf = this._surf(x, z);
      if (this._inWater(x, z)) return;
      const hard = sf === 'hard' || sf === 'paved' || sf === 'road' || sf === 'metal' || sf === 'wood' || sf === 'ice';
      // tile = the drop's spread footprint: a crown splashes ~2.5× the drop on hard floors, snow soaks ~2× wider
      const ds = (T.drop[0] + (T.drop[1] - T.drop[0]) * r()) * (sf === 'snow' ? 3.2 : hard ? 2.6 : 2.4);
      this._decal(sf === 'snow' ? DK.soak : hard ? DK.crown : DK.drop + Math.floor(r() * 4), x, z, ds, r() * 6.283, 0.95);
      if (res) { b.resid = Math.max(0, (b.resid ?? RESID) - 0.0015); b.drip += 0.6; } else b.left = Math.max(0, b.left - 0.0006);
      return;
    }
    // drag / crawl: the torso contact point (the body's position, or behind the dragger)
    let x = u.x, z = u.z;
    const c = u.carriedBy;
    if (c && Math.hypot(u.x - c.x, u.z - c.z) < 0.3) { x = c.x - Math.cos(c.heading) * 0.7; z = c.z - Math.sin(c.heading) * 0.7; }
    if (b.sx == null || Math.hypot(x - b.sx, z - b.sz) > 1.5) { b.sx = x; b.sz = z; return; }
    const d = Math.hypot(x - b.sx, z - b.sz);
    if (d < T.smearStep) return;
    if (!this._inWater(x, z)) {
      const r = this._rng(u, 9 + b.n);
      const w = T.smearWidth[0] + (T.smearWidth[1] - T.smearWidth[0]) * (0.5 + 0.5 * frac) * (0.85 + 0.3 * r());
      this._smear(b.sx, b.sz, x, z, mode === 'crawl' ? w * 0.7 : w, res ? 0.3 : Math.min(1, 0.45 + frac * 0.6));
    }
    b.sx = x; b.sz = z;
    if (res) b.resid = Math.max(0, (b.resid ?? RESID) - T.dragLoss * d * 0.5); else b.left = Math.max(0, b.left - T.dragLoss * d);
  }

  _smear(x0, z0, x1, z1, w, int) {
    if (!this.on) return null;
    const sf = surfaceCode(this._surf(x1, z1));
    const s = { id: this.nextId++, x0: +x0.toFixed(3), z0: +z0.toFixed(3), x1: +x1.toFixed(3), z1: +z1.toFixed(3), w: +w.toFixed(3), i: +int.toFixed(3), t0: this.time, age: 0, sf };
    this.smears.push(s);
    // budget in metres of ribbon (oldest segment first)
    let len = 0; for (let k = this.smears.length - 1; k >= 0; k--) { const q = this.smears[k]; len += Math.hypot(q.x1 - q.x0, q.z1 - q.z0); if (len > this.budget.smear) { this.layers?.dropSmears?.(this.smears.splice(0, k + 1)); break; } }
    this.layers?.addSmear?.(s);
    return s;
  }

  /** Units standing in a fresh pool get bloody boots (§B.5). Visual only; the AI's footprint list is untouched. */
  _feet() {
    if (!this.pools.length) return;
    for (const u of this._units()) {
      if (!u.alive || u.state === 'carried' || u.state === 'inVehicle' || (u.y || 0) > 0.4 || !u.path) continue;
      for (const p of this.pools) {
        if (!poolWet(p.age, p.surface)) continue;
        const R = p.sim ? p.sim.extent() : 0.35 * Math.sqrt(p.volume / 0.8);
        const dx = u.x - p.x, dz = u.z - p.z;
        if (dx * dx + dz * dz > R * R) continue;
        if (p.sim) {
          const c = Math.cos(-p.rot), s = Math.sin(-p.rot), L = p.sim.n * p.sim.cell;
          if (!p.sim.wetAt((dx * c - dz * s) / L + 0.5, (dx * s + dz * c) / L + 0.5)) continue;
        }
        stepInPool(u);
        break;
      }
    }
  }

  /** Terrain footfall hook (trails.onStep): a bloody boot print at the print, fading over 6 steps. */
  onStep(e) {
    if (!this.on) return;
    const id = typeof e.id === 'string' && e.id[0] === 'u' ? +e.id.slice(1) : null;
    const u = id != null ? this.world.byId?.(id) : null;
    if (!u) return;
    const op = bloodyStep(u);
    if (op <= 0) return;
    this._decal(e.side > 0 ? DK.bootR : DK.bootL, e.x, e.z, Math.max(0.3, e.length || 0.3), e.yaw ?? u.heading, op * 0.85);
  }

  // ------------------------------------------------------------------ per displayed frame

  /** Build the flow sim of pool p (visual only), replaying a stop that happened before a load. */
  _sim(p) {
    p.sim = new PoolSim({ seed: p.seed, surface: p.surface, volume: p.volume + (p.back || 0), grow: p.grow, slope: p.slope, x: p.x, z: p.z, rot: p.rot, pulses: p.pulses });
    if (p.stopped && p.stopAt != null) { p.sim.advanceTo(Math.min(p.stopAt, p.age)); p.sim.stop(); }
    return p.sim;
  }

  /**
   * Game.render: step the pool sims (10 Hz of pool age, ≤ 4 pools per frame; a loaded game fast-forwards in capped
   * chunks), upload the changed atlas tiles, update decal/smear ages and the stain uniforms.
   */
  frame() {
    const L = this.layers;
    if (!this.visual || !L) return;
    L.setVisible?.(this.on);
    if (!this.on) return;
    const t0 = performance.now(), P = CONFIG.blood.pool;
    let n = 0;
    const N = this.pools.length;
    // ≤ 4 pools and ~0.2 ms per frame (a pool that falls behind catches up later: results depend on its age only)
    for (let k = 0; k < N && n < P.perFrame && (n === 0 || performance.now() - t0 < 0.2); k++) {
      const p = this.pools[(this._rr = ((this._rr || 0) + 1) % N)];
      if (!p) continue;
      const sim = p.sim || this._sim(p);
      const target = Math.round(Math.min(p.age, P.maxAge) * P.hz);
      if (sim.frozen || sim.steps >= target) continue;
      const behind = target - sim.steps;
      sim.advanceTo(p.age, behind > 3 ? (performance.now() - t0 < 2 ? 40 : 2) : 3); // catch-up after a load, capped
      L.poolChanged?.(p);
      n++;
    }
    this.stats.simMs = performance.now() - t0;
    L.frame?.(this.time);
    this.stats.ms = performance.now() - t0;
    this.stats.pools = this.pools.length; this.stats.decals = this.decals.length; this.stats.smears = this.smears.length;
    let st = 0; for (const l of this.stains.values()) st += l.length; this.stats.stains = st;
  }

  // ------------------------------------------------------------------ save / load (§B.7)

  serialize() {
    const t = this.time, f3 = (v) => +(+v).toFixed(3);
    const feet = {};
    for (const u of this._units()) if (u.bloodyFeet > 0) feet[u.id] = u.bloodyFeet;
    const stains = {};
    for (const [id, l] of this.stains) stains[id] = l.map((s) => ({ bone: s.bone, off: s.off, radius: s.radius, age: f3(t - s.t0), kind: s.kind }));
    return {
      v: 1, time: f3(t), nextId: this.nextId,
      pools: this.pools.map((p) => ({ id: p.id, unitId: p.unitId, x: p.x, z: p.z, rot: p.rot, slope: p.slope, cause: p.cause, surface: p.surface,
        volumeLeft: p.volume, back: +(p.back || 0).toFixed(4), grow: p.grow, age: f3(p.age), seed: p.seed, stopped: p.stopped, stopAt: p.stopAt ?? null, pulses: p.pulses })),
      decals: this.decals.map((d) => [d.k, d.x, d.y, d.z, d.n ? d.n[0] : 0, d.n ? d.n[1] : 1, d.n ? d.n[2] : 0, d.s, d.r, d.op, f3(t - d.t0), d.sf, d.n ? 1 : 0]),
      smears: this.smears.map((s) => [s.x0, s.z0, s.x1, s.z1, s.w, s.i, f3(t - s.t0), s.sf]),
      bleeders: [...this.bleeders.values()].filter((b) => !b.done).map((b) => ({ id: b.id, cls: b.cls, left: +b.left.toFixed(4), resid: +(b.resid ?? RESID).toFixed(4), total: b.total, grow: b.grow, n: b.n,
        bone: b.bone, pulses: b.pulses, settled: !!(b.settled || b.unit.settled), wait: f3(b.wait), pool: b.pool?.id ?? null })),
      stains, feet,
    };
  }

  /** Rebuild from a save; everything optional (an old save loads without blood). Pools re-simulate from their seeds. */
  restore(snap) {
    this.clear();
    if (!snap || typeof snap !== 'object') return;
    const W = this.world, t = this.time = +snap.time || 0;
    this.nextId = snap.nextId || 1;
    for (const q of snap.pools || []) {
      // a stopped pool gave its unbled share back to the body: rebuild the sim with the full volume, then stop it
      const p = { id: q.id, unitId: q.unitId, x: q.x, z: q.z, rot: q.rot, slope: q.slope || 0, cause: q.cause, surface: q.surface, volume: q.volumeLeft,
        back: q.back || 0, grow: q.grow || 30, age: q.age || 0, seed: q.seed >>> 0, stopped: !!q.stopped, stopAt: q.stopAt ?? null, pulses: q.pulses || 0, sim: null };
      this.pools.push(p);
      this.layers?.addPool?.(p);
    }
    for (const a of snap.decals || []) {
      const d = { id: -(this.decals.length + 1), k: a[0], x: a[1], y: a[2], z: a[3], n: a[12] ? [a[4], a[5], a[6]] : null, s: a[7], r: a[8], op: a[9], t0: t - a[10], sf: a[11] };
      this.decals.push(d); this.layers?.addDecal?.(d);
    }
    for (const a of snap.smears || []) {
      const s = { id: -(this.smears.length + 1), x0: a[0], z0: a[1], x1: a[2], z1: a[3], w: a[4], i: a[5], t0: t - a[6], age: a[6], sf: a[7] };
      this.smears.push(s); this.layers?.addSmear?.(s);
    }
    for (const q of snap.bleeders || []) {
      const u = W.byId?.(q.id);
      if (!u) continue;
      const b = this._bleeder(u, q.cls, { pool: 0, grow: [q.grow, q.grow], wound: q.bone }, () => 0.5);
      Object.assign(b, { left: q.left, resid: q.resid ?? RESID, total: q.total, grow: q.grow, n: q.n, pulses: q.pulses, settled: q.settled, wait: q.wait, lx: u.x, lz: u.z, still: 1 });
      b.pool = this.pools.find((p) => p.id === q.pool) || null;
    }
    for (const [id, l] of Object.entries(snap.stains || {})) {
      const u = W.byId?.(+id);
      if (!u) continue;
      const list = l.map((s) => ({ bone: s.bone, off: s.off, radius: s.radius, t0: t - s.age, kind: s.kind }));
      this.stains.set(u.id, list);
      this.layers?.stainsChanged?.(u, list);
    }
    for (const [id, n] of Object.entries(snap.feet || {})) { const u = W.byId?.(+id); if (u) u.bloodyFeet = n; }
  }

  /**
   * Compile the blood programs at mission load (stain-patched kit materials, decals, smears) so the first hit does
   * not stall the frame while every character shader re-links (a 150-300 ms hitch under load).
   * @param {{compileAsync?:Function, compile?:Function}} renderer WebGLRenderer @param {object} camera
   */
  async warm(renderer, camera) {
    const L = this.layers;
    if (!L || !this.scene || !camera || !(renderer?.compileAsync || renderer?.compile)) return;
    const units = (this.world.entities || []).filter((e) => e.model?.root && e.alive !== false);
    const undo = L.stains?.preview?.(units) || (() => {});
    const shown = [L.decals?.mesh, L.smears?.mesh].filter((m) => m && !m.visible);
    for (const m of shown) m.visible = true;
    try { await (renderer.compileAsync ? renderer.compileAsync(this.scene, camera) : renderer.compile(this.scene, camera)); }
    finally { for (const m of shown) m.visible = false; undo(); }
  }

  /** Drop every record (and the drawn layers). */
  clear() {
    for (const p of this.pools) this.layers?.removePool?.(p);
    this.layers?.clear?.();
    this.bleeders.clear(); this.pools = []; this.decals = []; this.smears = []; this.stains.clear(); this._timers = [];
  }

  dispose() {
    for (const off of this._off) off?.();
    this._off = [];
    this.layers?.dispose?.();
    this.layers = null;
  }
}
