/**
 * Game VFX — the final VFX library (`render/vfx/`, docs/vfx-pipeline.md) wired to the game events. Owned by VEHICLES/FX
 * (docs/ARCHITECTURE.md). Same API as the old stub: `new FX(world, scene)`, `spawn(kind, x, z, opts)`, `update(dt)`
 * (sim tick: fixed-step effect simulation, frozen while paused), `frame()` (per displayed frame: sort/upload),
 * `dispose()`; plus `shakeOffset()` for the camera rig and `vfx` (the library instance, null without WebGL).
 *
 * Event wiring (all 19 library kinds):
 *  - 'explosion'      bomb → explosion_large · shell → explosion_small · grenade → grenade · barrel → barrel_explosion
 *                     (chained drums get the lighter chainFrom look) · structure → explosion_large + burning_wreck
 *                     (fuel tank: tanker_explosion + long fuel_pool_fire) · vehicle → handled by 'vehicle:destroyed'
 *                     · in water → water_splash (the water system spawns it when present)
 *  - 'vehicle:destroyed' explosion_small / tanker_explosion + a burning_wreck until the game's 'fire' off, then a
 *                     smouldering smoke_column for the rest of the mission
 *  - 'shot'           muzzle_flash (weapon-sized, every weapon incl. MG nests / tank MGs) + tracer; at arrival:
 *                     blood_puff (flesh; unless blood off / censored) · sparks (vehicles) · dust_kick · water_splash
 *  - 'vehicle:fire'   cannon muzzle_flash · 'hit' knife/harpoon → blood_puff · wall/metal → sparks · smoke_puff
 *  - 'unit:killed'    blood_puff + pool decal (unless blood off / censored; not for bloodless causes)
 *  - vehicles         vehicle_dust_trail on sand/snow/dirt, mud_spray on mud cells
 *  - structures       chimney_smoke on houses with chimneys (+ fire_small campfires / smoke_column from mission `fx`)
 * Explosive drums are registered with `vfx.addExplosive` (gameplay stays authoritative: the drum's own `ignite`
 * chain detonates it; the registry hides the prop and gives the chained look).
 * Without a WebGL renderer (node tests) nothing is drawn but every event is still mapped and logged in `items`.
 * @module render/fx
 */

import * as THREE from 'three';
import { createVfx } from './vfx/index.js';
import { T } from '../world/grid.js';

/** Theater → default ground surface (dust / clod colours). */
const THEATER_SURF = { desert: 'sand', snow: 'snow', temperate: 'grass', coast: 'dirt', night: 'grass', winter: 'snow' };
const TERRAIN_SURF = { [T.SAND]: 'sand', [T.SNOW]: 'snow', [T.GRASS]: 'grass', [T.MUD]: 'mud', [T.ROAD]: 'dirt', [T.SHALLOW]: 'mud' };
/** Old stub kinds → library kinds. */
const LEGACY = { muzzle: 'muzzle_flash', explosion: 'explosion_small', smoke: 'smoke_column', fire: 'fire_small', blood: 'blood_puff',
  splash: 'water_splash', dust: 'dust_kick', debris: 'explosion_small', tracer: 'tracer', mud: 'mud_spray' };
/** Game weapon id → muzzle size class of the library. */
const MUZZLE = { pistol: 'pistol', luger: 'pistol', sniper: 'sniper', rifle: 'rifle', smg: 'smg', mp40: 'smg', mg: 'mg', tankMg: 'mg', cannon: 'cannon' };
const NO_FLASH = new Set(['knife', 'injection', 'syringe', 'harpoon', 'dogBite', 'electric', 'fire', 'punch']);
const NO_BLOOD_CAUSE = new Set(['syringe', 'injection', 'drown', 'fire', 'electric', 'explosion', 'grenade', 'bomb', 'barrel', 'vehicle', 'shell', 'train', 'poison', 'punch', 'chloroform']);
/** Seconds of the shooter→target flight used to delay impacts (the library's tracer speed). */
const ROUND_SPEED = 260;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * The reduced-motion option (ui-config: 'system' | 'on' | 'off'; booleans accepted): 'system' follows the
 * OS prefers-reduced-motion setting, like the menu kit (src/ui/menu-kit.js applyPrefs).
 */
export function reducedMotion(v) {
  if (v === true || v === 'on') return true;
  if (v !== 'system') return false;
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export class FX {
  /**
   * @param {import('../world/world.js').World} world
   * @param {THREE.Object3D} scene main scene
   */
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    /** Recent spawns {kind, x, z, t} (tests / debugging; capped). */
    this.items = [];
    this.spawned = 0;
    /** Legacy field (the water adapter sets it); effects draw in their own post pass after the water anyway. */
    this.lateLayer = null;
    this.root = new THREE.Group();
    this.root.name = 'fx';
    scene?.add?.(this.root);
    this.time = 0;
    this.theater = world.mission?.theater || 'temperate';
    const eng = world.game?.renderer;
    /** The VFX library instance (null headless). */
    this.vfx = null;
    if (eng?.renderer && scene && eng.camera) {
      this.vfx = createVfx(scene, eng.camera, eng, { groundHeight: (x, z) => this._y(x, z), wind: this._wind() });
    }
    this._blasts = []; // recent {x, z, t, r} (chain look for drums)
    this._suppress = []; // vehicle hull blasts already drawn by 'vehicle:destroyed'
    this._wrecks = new Map(); // vehicle → {handle, x, z}
    this._trails = new Map(); // vehicle → {proxy, handle, mudAcc}
    this._chimneys = []; // {handle, owner, mesh}
    this._explosives = new Map(); // Barrel entity → registry entry
    this._scanned = false;
    this._tick = 0;
    const on = (ev, fn) => world.listen(ev, (e) => { try { fn(e || {}); } catch (err) { console.error(`[fx] ${ev}`, err); } });
    this._unsub = [
      on('explosion', (e) => this.onExplosion(e)),
      on('shot', (e) => this.onShot(e)),
      on('unit:killed', (e) => this.onKilled(e)),
      on('vehicle:destroyed', (e) => this.onVehicleDestroyed(e)),
      on('vehicle:fire', (e) => this.onVehicleFire(e)),
      on('fire', (e) => this.onFire(e)),
      on('hit', (e) => this.onHit(e)),
      on('structure:destroyed', (e) => this.onStructureDestroyed(e)),
    ];
  }

  get count() { return this.items.length; }
  /** Default ground surface of the mission theater. */
  get surface() { return THEATER_SURF[this.theater] || 'dirt'; }
  /** Player option: blood effects (§6.8 blood / censored). */
  get bloodOn() { const o = this.world.game?.options; return !o || (o.blood !== false && !o.censored); }

  _y(x, z) { const g = this.world.groundY; return typeof g === 'function' ? (g.call(this.world, x, z) || 0) : 0; }
  _surfAt(x, z) { const g = this.world.grid; const t = g?.terrainAt ? g.terrainAt(x, z) : null; return TERRAIN_SURF[t] || this.surface; }
  _wet(x, z) {
    const g = this.world.grid; if (!g?.terrainAt) return false;
    const t = g.terrainAt(x, z); if (t !== T.WATER && t !== T.SHALLOW) return false;
    const c = g.worldToCell(x, z); return !g.bridge?.[g.idx(c.i, c.j)];
  }
  _wind() {
    const w = this.world.mission?.wind || this.world.mission?.lighting?.wind;
    if (Array.isArray(w)) return V3(w[0] || 0, 0, w[1] || 0);
    return this.theater === 'snow' ? V3(2.2, 0, 0.8) : V3(1.6, 0, 0.6);
  }

  /**
   * Step 4w: smoke, fire, dust and sparks drift with the mission WindField. uWind carries the MEAN ground wind
   * (0.75× the 10 m reference, with the slow lull envelope, low-passed over ~1.2 s); the travelling gust fronts are
   * applied per particle in the shader (vfx/shaders.js gustPush) so a gust rolls through plumes at the same moment it
   * crosses the grass, trees and flags beside them. A legacy `mission.wind` [x, z] array still pins a constant wind.
   */
  _windTick(dt) {
    const W = this.world.wind;
    if (!W?.sample || Array.isArray(this.world.mission?.wind)) return;
    const m = (W.p?.speed ?? 0) * (W.envelope ? W.envelope(this.world.time) : 1) * 0.75;
    const u = this.vfx.u.uWind.value, k = 1 - Math.exp(-dt / 1.2);
    u.x += (W.dx * m - u.x) * k; u.z += (W.dz * m - u.z) * k; u.y = 0;
  }

  _log(kind, x, z, opts) {
    this.spawned++;
    const rec = { kind, x, z, t: this.time, opts };
    this.items.push(rec);
    if (this.items.length > 256) this.items.splice(0, this.items.length - 256);
    return rec;
  }

  /**
   * Spawn an effect at ground point (x, z). kind: any library kind (or alias) or an old stub kind.
   * opts.y overrides the height (default: ground height). Returns the library handle (persistent effects:
   * {stop()}), or the log record headless.
   */
  spawn(kind, x, z, opts = {}) {
    const k = LEGACY[kind] || kind;
    const o = { surface: this._surfAt(x, z), ...opts };
    if (kind === 'splash' && o.scale == null) o.scale = o.big ? clamp((o.radius ?? 3) / 3.5, 0.5, 1.5) : clamp((o.radius ?? 0.5) * 0.45, 0.15, 0.6);
    if (kind === 'explosion' && o.scale == null) o.scale = clamp((o.radius ?? 5) / 7, 0.6, 1.5);
    const rec = this._log(k, x, z, o);
    if (!this.vfx) return rec;
    const y = o.y ?? this._y(x, z);
    if (k === 'tracer') {
      const f = o.from || { x, z }, t = o.to || { x, z };
      return this.vfx.spawn('tracer', V3(f.x, this._y(f.x, f.z) + 1.35, f.z), { to: { x: t.x, y: this._y(t.x, t.z) + 1.0, z: t.z } });
    }
    try { return this.vfx.spawn(k, V3(x, y, z), o); } catch (err) { console.error('[fx] spawn', k, err); return null; }
  }
  // ------------------------------------------------------------------ explosions

  onExplosion(e) {
    const x = e.x, z = e.z, r = e.radius ?? 5, kind = e.kind;
    if (x == null || z == null) return;
    const now = this.time;
    this._blasts = this._blasts.filter((b) => now - b.t < 2.5);
    const prior = this._blasts.slice();
    this._blasts.push({ x, z, t: now, r });
    // hull blasts already drawn by 'vehicle:destroyed' (the 'vehicle' blast and the tanker's silent 'barrel' blast)
    if (kind === 'vehicle' || (kind === 'barrel' && !(e.source && e.source.interactKind === 'barrel'))) {
      if (this._suppress.some((s) => now - s.t < 0.25 && Math.hypot(s.x - x, s.z - z) < 2)) return;
    }
    if (this._wet(x, z)) { // water column (drawn by the water system when it exists)
      if (!this.world.water) this.spawn('water_splash', x, z, { scale: clamp(r / 5, 0.5, 1.6) });
      return;
    }
    const src = e.source;
    if (kind === 'barrel') {
      const from = prior.find((b) => now - b.t > 0.02 && Math.hypot(b.x - x, b.z - z) < 8);
      const ex = src && this._explosives.get(src);
      if (ex?.obj) ex.obj.visible = false;
      this.spawn('barrel_explosion', x, z, from ? { chainFrom: V3(from.x, 0, from.z) } : {});
      return;
    }
    if (kind === 'grenade') return void this.spawn('grenade', x, z);
    if (kind === 'shell') return void this.spawn('explosion_small', x, z, { scale: clamp(r / 5, 0.8, 1.4) });
    if (kind === 'bomb') return void this.spawn('explosion_large', x, z, { scale: clamp(r / 9, 0.7, 1.3) });
    if (kind === 'structure') return void this._structureBlast(x, z, r, src);
    if (kind === 'vehicle') return void this.spawn('explosion_small', x, z, { scale: 1.2 });
    // unknown class: by radius
    this.spawn(r < 5 ? 'grenade' : r < 9 ? 'explosion_small' : 'explosion_large', x, z, { scale: r < 9 ? clamp(r / 7, 0.6, 1.5) : clamp(r / 14, 0.6, 1.6) });
  }

  _structureBlast(x, z, r, src) {
    const def = src?.structure || src?.def || {};
    const type = def.type || src?.type || '';
    if (type === 'fueltank' || def.explosive === 'fuel') {
      this.spawn('tanker_explosion', x, z, { yaw: def.rot ?? 0, dur: 60 });
      this.spawn('fuel_pool_fire', x, z, { radius: clamp((def.r ?? 2) * 1.6, 2.5, 5), dur: 90 });
      this._afterFire(x, z, 90, 1.2);
      return;
    }
    this.spawn('explosion_large', x, z, { scale: clamp(r / 10, 0.7, 1.4) });
    if (['sandbags', 'fence', 'gate', 'wall', 'bridge', 'crater', 'sign', 'lamp_post', 'telegraph_pole'].includes(type)) return;
    const w = def.w ?? (r * 0.9), d = def.d ?? (r * 0.9), h = Math.max(0.6, (def.h ?? 3) * 0.35);
    this.spawn('burning_wreck', x, z, { size: [Math.min(w, 9) * 0.8, Math.min(d, 9) * 0.8], h, dur: 60, yaw: -(def.rot ?? 0) });
    this._afterFire(x, z + 0.3, 60, 0.9, h + 1.5);
  }

  /** After a fire burns out: a smouldering, thinning column for the rest of the mission. */
  _afterFire(x, z, delay, scale = 1, dy = 1.2) {
    if (!this.vfx) return;
    this.vfx.at(delay, () => {
      if (this.disposed) return;
      this.spawn('smoke_column', x, z, { y: this._y(x, z) + dy, color: 'grey', rate: 1.6, scale, op: 0.55, dur: 1e6 });
    });
  }

  // ------------------------------------------------------------------ vehicles

  onVehicleDestroyed(e) {
    const v = e.vehicle; if (!v) return;
    const def = v.def || {};
    this._suppress = this._suppress.filter((s) => this.time - s.t < 1);
    this._suppress.push({ x: v.x, z: v.z, t: this.time });
    this._stopTrail(v);
    if (def.raft && e.cause === 'deflated') return;
    const [len, wid] = def.size || [4, 2];
    const yaw = Math.PI / 2 - (v.heading ?? 0);
    if (this._wet(v.x, v.z) || def.kind === 'boat') {
      this.spawn('water_splash', v.x, v.z, { scale: clamp(len / 6, 0.6, 1.5) });
      if (!def.raft) this.spawn('explosion_small', v.x, v.z, { scale: clamp(len / 6, 0.7, 1.3) });
      return;
    }
    if (def.kind === 'emplacement') {
      this.spawn('explosion_small', v.x, v.z, { scale: 0.8 });
      this.spawn('smoke_column', v.x, v.z, { color: 'black', rate: 2.5, scale: 0.6, dur: 40 });
      return;
    }
    if (def.tanker) this.spawn('tanker_explosion', v.x, v.z, { yaw, dur: 1e6 });
    else this.spawn('explosion_small', v.x, v.z, { scale: clamp(len / 5, 0.8, 1.5) });
    const h = def.height ?? (v.model?.library ? Math.min(2.4, (v.model.dims?.h ?? 2) * 0.7) : len > 5.5 ? 1.9 : 1.3);
    const src = v.model?.wreckEmitter?.(v); // the library model's engine-bay / fuel-tank fire point
    const fx0 = src ? (v.x + src.x) / 2 : v.x, fz0 = src ? (v.z + src.z) / 2 : v.z;
    const handle = def.tanker ? null : this.spawn('burning_wreck', fx0, fz0, { size: [wid, len], h, yaw, dur: 1e6 });
    this._wrecks.set(v, { handle, x: v.x, z: v.z, sx: src?.x ?? v.x, sz: src?.z ?? v.z, h, tanker: !!def.tanker, len });
    if (def.tanker) this._afterFire(v.x, v.z, 60, 1.1, 2);
  }

  /** Game fire zones: a wreck's fire going out (§3.6 wreck burn) → flames stop, smouldering smoke stays. */
  onFire(e) {
    if (e.on !== false) return;
    for (const [v, w] of this._wrecks) {
      if (Math.hypot(w.x - e.x, w.z - e.z) > 1.5 || w.out) continue;
      w.out = true;
      w.handle?.stop?.();
      if (!w.tanker) this.spawn('smoke_column', w.sx ?? w.x, w.sz ?? w.z, { y: this._y(w.x, w.z) + w.h + 0.6, color: 'black', rate: 1.8, scale: clamp(w.len / 6, 0.5, 1), op: 0.6, dur: 1e6 });
    }
  }

  // ------------------------------------------------------------------ weapons

  /** Muzzle height (m above ground) of a shooter: stance, emplacement / vehicle mounts. */
  _muzzleY(e) {
    const s = e.shooter || {};
    if (e.weapon === 'tankMg') return 2.0;
    if (s.kind === 'vehicle' || s.vehicle) return s.vehicle?.def?.kind === 'emplacement' || s.def?.kind === 'emplacement' ? 1.1 : 1.8;
    if (s.stance === 'prone' || s.stance === 'swim') return 0.3;
    if (s.stance === 'crouch' || s.stance === 'crouched') return 0.9;
    return 1.35;
  }

  onShot(e) {
    const f = e.from || e.shooter, t = e.to;
    if (!f || !t || NO_FLASH.has(e.weapon)) return;
    const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz) || 1;
    const mu = e.muzzle; // vehicle guns: the model's muzzle (art/vehicle-model.js muzzleWorld)
    const fy = mu ? mu.y : this._y(f.x, f.z) + this._muzzleY(e);
    const tgt = e.target;
    const ty = this._y(t.x, t.z) + (e.hit && tgt ? (tgt.kind === 'vehicle' ? 1.2 : tgt.stance === 'prone' ? 0.3 : 1.1) : 0.05);
    const mx = mu ? mu.x : f.x + (dx / d) * 0.7, mz = mu ? mu.z : f.z + (dz / d) * 0.7;
    this.spawn('muzzle_flash', mx, mz, { y: fy, dir: V3(dx / d, (ty - fy) / d, dz / d), weapon: MUZZLE[e.weapon] || 'rifle', to: { x: t.x, y: ty, z: t.z } });
    const impact = () => {
      if (this.disposed) return;
      const dir = V3(dx / d, 0, dz / d);
      if (e.hit && tgt && tgt.kind !== 'vehicle' && tgt.kind !== 'interactable' && tgt.kind !== 'prop') {
        if (this.bloodOn) this.spawn('blood_puff', t.x, t.z, { y: ty, dir: dir.multiplyScalar(0.6), decal: false });
      } else if (e.hit) this.spawn('sparks', t.x, t.z, { y: ty, dir: dir.negate().setY(0.4) });
      else if (this._wet(t.x, t.z)) this.spawn('water_splash', t.x, t.z, { scale: 0.18 });
      else this.spawn('dust_kick', t.x, t.z);
    };
    if (this.vfx) this.vfx.at(d / ROUND_SPEED, impact); else impact();
  }

  /** Tank / AT cannon: big muzzle blast at the barrel end (the shell itself explodes as 'shell'). */
  onVehicleFire(e) {
    const v = e.vehicle, t = e.target;
    if (!v || !t || e.weapon !== 'cannon') return;
    const m = e.muzzle || (typeof v.muzzleToward === 'function' ? v.muzzleToward(t.x, t.z) : { x: v.x, z: v.z });
    const my = e.muzzle ? e.muzzle.y : this._y(m.x, m.z) + 1.9;
    const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz) || 1;
    this.spawn('muzzle_flash', m.x, m.z, { y: my, dir: V3(dx / d, 0, dz / d), weapon: 'cannon', tracer: false });
    this.spawn('smoke_puff', m.x, m.z, { y: my, dir: V3(dx / d, 0.2, dz / d), size: 2.2, col: [0.55, 0.53, 0.5] });
  }

  /** Surface hits not covered by 'shot': knife / harpoon (flesh), projectiles on walls / hulls. */
  onHit(e) {
    if (e.x == null) return;
    const w = e.weapon;
    if (e.surface === 'flesh' && (w === 'knife' || w === 'harpoon')) {
      if (this.bloodOn) this.spawn('blood_puff', e.x, e.z, { y: this._y(e.x, e.z) + 1.0, decal: false });
    } else if (e.surface === 'wall' || (e.surface === 'metal' && !MUZZLE[w])) {
      this.spawn('sparks', e.x, e.z, { y: this._y(e.x, e.z) + 1.0 });
    }
  }

  onKilled(e) {
    const u = e.unit; if (!u || u.kind === 'vehicle') return;
    if (!this.bloodOn || NO_BLOOD_CAUSE.has(e.cause)) return;
    // a restrained blood mist; the pool, spatter and stains belong to render/blood (world.blood, bodies-design §B)
    this.spawn('blood_puff', u.x, u.z, { y: this._y(u.x, u.z) + 0.35, dir: V3(0, -0.2, 0), decal: !this.world.blood });
  }

  onStructureDestroyed(e) {
    for (const c of this._chimneys) {
      if (c.dead || (c.id !== e.id && c.owner !== e.owner)) continue;
      c.dead = true; c.handle?.stop?.();
      if (c.mesh) c.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------------ persistent sources (props, vehicles)

  /** Once the map is built: explosive drums, chimneys, mission-placed fires/smoke. */
  _scan() {
    const w = this.world;
    this._scanned = true;
    this._scanBarrels();
    const houses = [];
    for (const [id, s] of w.structures || []) if (s?.object3d && !s.entity) houses.push([id, s]);
    houses.forEach(([id, s], k) => this._maybeChimney(id, s, k));
    for (const f of w.mission?.fx || []) if (f?.kind && f.x != null) this.spawn(f.kind, f.x, f.z, { ...f });
  }

  _scanBarrels() {
    if (!this.vfx) return;
    for (const b of this.world.interactables || []) {
      if (b.interactKind !== 'barrel' || !b.object3d || this._explosives.has(b) || b.exploded) continue;
      // gameplay is authoritative (Barrel.ignite chain, §3.6): the registry entry is never armed by the VFX blast
      const ex = this.vfx.addExplosive(b.object3d, 'barrel_explosion');
      ex.armed = false; ex.entity = b;
      this._explosives.set(b, ex);
    }
  }

  /**
   * Chimney smoke (E4): structures with a chimney — a child named /chimney/ in the model, `chimney: true|{x,z,y}` in
   * the mission data, or (placeholder houses) a seeded share of houses/huts that get a small brick stack.
   */
  _maybeChimney(id, s, k) {
    const def = s.def || {}, obj = s.object3d;
    if (def.chimney === false || s.destroyed) return;
    let pos = null, mesh = null;
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if (!pos && /chimney/i.test(o.name || '')) { const b = new THREE.Box3().setFromObject(o); pos = V3((b.min.x + b.max.x) / 2, b.max.y + 0.1, (b.min.z + b.max.z) / 2); } });
    if (!pos && def.chimney && typeof def.chimney === 'object') pos = V3(def.chimney.x, def.chimney.y ?? this._y(def.chimney.x, def.chimney.z) + 6, def.chimney.z);
    if (!pos) {
      if (!['house', 'hut'].includes(s.type) && def.chimney !== true) return;
      const share = this.theater === 'snow' ? 0.75 : 0.45;
      const r = (Math.imul((k + 1) * 2654435761, 97) >>> 0) / 4294967296 + (typeof id === 'string' ? id.length * 0.013 : 0);
      if (def.chimney !== true && (r % 1) > share) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const w = def.w ?? (box.max.x - box.min.x), d = def.d ?? (box.max.z - box.min.z);
      const local = V3(w * 0.28 * (k % 2 ? 1 : -1), 0, d * 0.18);
      local.applyAxisAngle(V3(0, 1, 0), obj.rotation?.y ?? 0);
      const cx = (box.min.x + box.max.x) / 2 + local.x, cz = (box.min.z + box.max.z) / 2 + local.z;
      mesh = new THREE.Mesh(FX._stackGeo ||= new THREE.BoxGeometry(0.6, 1.5, 0.6), FX._stackMat ||= new THREE.MeshStandardMaterial({ color: 0x5b3a2e, roughness: 0.92 }));
      mesh.position.set(cx, box.max.y + 0.45, cz); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'fx-chimney';
      this.root.add(mesh);
      pos = V3(cx, box.max.y + 1.25, cz);
    }
    // wood smoke is grey-white: over snow it needs a slightly darker, denser plume to read from the game camera
    const snow = this.theater === 'snow';
    const handle = this.spawn('chimney_smoke', pos.x, pos.z, { y: pos.y, rate: snow ? 26 : 20, op: snow ? 0.6 : 0.45, col: snow ? [0.33, 0.34, 0.36] : undefined });
    this._chimneys.push({ id, owner: s.owner, handle, mesh, pos });
  }

  _stopTrail(v) { const t = this._trails.get(v); if (t) { t.handle?.stop?.(); this._trails.delete(v); } }

  /** Dust / snow-powder trails behind moving land vehicles; mud spray from the wheels on mud cells. */
  _vehicles(dt) {
    for (const v of this.world.vehicles || []) {
      if (v.def?.kind !== 'land' || v.destroyed || v.removed || v.hiddenRail) { if (this._trails.has(v)) this._stopTrail(v); continue; }
      let tr = this._trails.get(v);
      const moved = tr ? Math.hypot(v.x - tr.x, v.z - tr.z) : 0;
      const speed = moved / Math.max(dt, 1e-3);
      const surf = this._surfAt(v.x, v.z);
      const dusty = surf === 'sand' || surf === 'snow' || surf === 'dirt';
      if (!tr) { tr = { x: v.x, z: v.z, proxy: { position: V3(v.x, this._y(v.x, v.z), v.z) }, handle: null, surf: null, mud: 0 }; this._trails.set(v, tr); }
      tr.x = v.x; tr.z = v.z;
      tr.proxy.position.set(v.x - Math.cos(v.heading ?? 0) * (v.def.size?.[0] ?? 4) * 0.45, this._y(v.x, v.z), v.z - Math.sin(v.heading ?? 0) * (v.def.size?.[0] ?? 4) * 0.45);
      if (dusty && speed > 0.3 && tr.surf !== surf) {
        tr.handle?.stop?.();
        tr.handle = this.spawn('vehicle_dust_trail', v.x, v.z, { target: tr.proxy, surface: surf, width: v.def.size?.[1] ?? 2 });
        tr.surf = surf;
      } else if (!dusty && tr.handle) { tr.handle.stop?.(); tr.handle = null; tr.surf = null; }
      if (surf === 'mud' && speed > 1.2) {
        tr.mud += dt * Math.min(speed, 12) * 0.6;
        if (tr.mud >= 1) {
          tr.mud = 0;
          const bx = -Math.cos(v.heading ?? 0), bz = -Math.sin(v.heading ?? 0);
          this.spawn('mud_spray', tr.proxy.position.x, tr.proxy.position.z, { dir: V3(bx, 0.6, bz), scale: 0.45 });
        }
      }
    }
  }

  // ------------------------------------------------------------------ per tick / per frame

  /** Sim tick (fixed 1/60 s, not called while paused): effect simulation + persistent sources. */
  update(dt) {
    this.time += dt;
    this._tick++;
    if (!this._scanned && this.world.structures) this._scan();
    else if (this._scanned && this._tick % 60 === 0) this._scanBarrels();
    if (this.vfx) this._vehicles(dt);
    if (this.vfx) this._windTick(dt);
    this.vfx?.advance(dt);
  }

  /** Per displayed frame (Game.render): camera-dependent work (sort + GPU upload, lights, decals). */
  frame() {
    const v = this.vfx; if (!v) return;
    const cam = this.world.game?.renderer?.camera;
    if (cam && v.camera !== cam) v.camera = cam;
    v.frame();
  }

  /** Camera-shake offset (m, camera plane) for the camera rig; null with the reduced-motion option. */
  shakeOffset() {
    if (!this.vfx || this.vfx.shake < 0.01) return null;
    if (reducedMotion(this.world.game?.options?.reducedMotion)) return null;
    return this.vfx.shakeOffset();
  }

  /** Budget report of the library (null headless). */
  stats() { return this.vfx ? this.vfx.stats() : null; }

  dispose() {
    this.disposed = true;
    for (const u of this._unsub) if (typeof u === 'function') u();
    this._unsub = [];
    for (const c of this._chimneys) c.mesh?.removeFromParent();
    this._chimneys = []; this._trails.clear(); this._wrecks.clear(); this._explosives.clear();
    this.vfx?.dispose();
    this.vfx = null;
    this.root.removeFromParent();
    this.items.length = 0;
  }

}

export default FX;
