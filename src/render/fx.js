/**
 * Game VFX — the final VFX library (`render/vfx/`, docs/vfx-pipeline.md) wired to the game events. Owned by VEHICLES/FX
 * (docs/ARCHITECTURE.md). Same API as the old stub: `new FX(world, scene)`, `spawn(kind, x, z, opts)`, `update(dt)`
 * (sim tick: fixed-step effect simulation, frozen while paused), `frame()` (per displayed frame: sort/upload),
 * `dispose()`; plus `shakeOffset()` for the camera rig and `vfx` (the library instance, null without WebGL).
 *
 * Event wiring (all 19 library kinds):
 *  - 'explosion'      bomb → explosion_large · shell → explosion_small · grenade → grenade · barrel → barrel_explosion
 *                     (chained drums get the lighter chainFrom look) · structure → explosion_large + burning_wreck
 *                     (fuel tank: fuel_tank_blast → licking fuel_tank_fire) · vehicle → handled by 'vehicle:destroyed'
 *                     · in water → water_splash (the water system spawns it when present)
 *  - 'vehicle:destroyed' explosion_small / tanker_explosion + a burning_wreck until the game's 'fire' off, then a
 *                     smouldering smoke_column for the rest of the mission
 *  - 'shot'           muzzle_flash (weapon-sized, every weapon incl. MG nests / tank MGs) + tracer; at arrival:
 *                     blood_puff (flesh; unless blood off / censored) · sparks (vehicles) · dust_kick · water_splash
 *  - 'vehicle:fire'   cannon muzzle_flash · 'hit' knife/harpoon → blood_puff · wall/metal → sparks · smoke_puff
 *  - 'unit:killed'    blood_puff + pool decal (unless blood off / censored; not for bloodless causes)
 *  - vehicles         vehicle_dust_trail on sand/snow/dirt, mud_spray on mud cells
 *  - structures       chimney_smoke from the models' chimney anchors (ambient smoke: capped + masked for readability,
 *                     vfx/ambient.js) (+ fire_small campfires / smoke_column from mission `fx`)
 * Explosive drums are registered with `vfx.addExplosive` (gameplay stays authoritative: the drum's own `ignite`
 * chain detonates it; the registry hides the prop and gives the chained look).
 * Without a WebGL renderer (node tests) nothing is drawn but every event is still mapped and logged in `items`.
 * @module render/fx
 */

import * as THREE from 'three';
import { createVfx } from './vfx/index.js';
import { T } from '../world/grid.js';
import { mgMuzzle } from './mg-mount.js';
import { fuelBlastScale, isFuelStructure } from '../art/fuel-tanks.js';
import { buildingMeta } from '../art/building-library.js';
import { dressingMaterial, boxUV } from '../art/dressing.js';
import { assetExtents } from '../art/building-props.js';
import { coneAt } from '../ai/perception.js';

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
const _ray = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0);
// the scene now carries THREE.Sprites (vehicle headlight halos): Sprite.raycast needs raycaster.camera or it throws, so
// the down-rays get a fixed dummy camera (sprite hits are filtered out by the callers anyway)
_ray.camera = new THREE.PerspectiveCamera(); _ray.camera.updateMatrixWorld();

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
    const def = src?.structure || src?.params?.structure || src?.def || {};   // (Interactables keep the mission def in params)
    const type = def.type || src?.type || '';
    if (isFuelStructure({ ...def, type }) || def.explosive === 'fuel') {
      // scaled to the tank (art/fuel-tanks.js): ruptures run along the long axis (local +X = (cos rot, sin rot))
      const k = fuelBlastScale(def), w = def.w ?? (def.r ?? 2) * 2, d = def.d ?? (def.r ?? 2) * 2;
      const long = w >= d, yaw = Math.PI / 2 - (def.rot ?? 0) - (long ? 0 : Math.PI / 2);
      // fireballs bursting along the shell, then licking flame tongues from the rupture and the pool (no spark comets)
      this.spawn('fuel_tank_blast', x, z, { yaw, dur: 90, scale: k.scale, size: [Math.min(w, d) * 0.8, Math.max(w, d) * 0.85],
        h: Math.min(4.2, (def.h ?? 3) * 0.6), poolR: k.fire, smokeK: k.smoke });
      this._afterFire(x, z, 90, Math.min(1.4, 1.2 * k.smoke));
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

  /** Night lighting (moonlit rig): muzzle flashes light the scene; by day they are small and barely light anything. */
  _night() {
    const L = this.world.game?.renderer?.theater;
    return L ? !!L.night : this.theater === 'night';
  }

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
    // vehicle guns: the model's muzzle (art/vehicle-model.js muzzleWorld); a gunner at a platform MG: its muzzle
    const mu = e.muzzle || (e.shooter?.soldierType === 'mg' ? mgMuzzle(e.shooter, t, (x, z) => this._y(x, z)) : null);
    // a man standing on a raised deck / wall walk (unit y: his floor above the ground) fires from, or is hit, up there
    const up = (u) => ((u?.kind === 'enemy' || u?.kind === 'commando') && u.y > 0.05 ? u.y : 0);
    const fy = mu ? mu.y : this._y(f.x, f.z) + up(e.shooter) + this._muzzleY(e);
    const tgt = e.target;
    const ty = this._y(t.x, t.z) + (e.hit && tgt ? up(tgt) + (tgt.kind === 'vehicle' ? 1.2 : tgt.stance === 'prone' ? 0.3 : 1.1) : 0.05);
    const mx = mu ? mu.x : f.x + (dx / d) * 0.7, mz = mu ? mu.z : f.z + (dz / d) * 0.7;
    this.spawn('muzzle_flash', mx, mz, { y: fy, dir: V3(dx / d, (ty - fy) / d, dz / d), weapon: MUZZLE[e.weapon] || 'rifle', to: { x: t.x, y: ty, z: t.z }, day: !this._night() });
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
    this._lightChimneys();
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
   * Chimney smoke (E4, ambient): emission points are the chimney tops of the ACTUAL model — the building library's
   * `chimney` anchors (and a hut's stovepipe `smoke` anchor; manifest sidecar, transformed by the placed instance, also
   * for instanced repeats), a model child named /chimney/, or the mission's `chimney: {x, z, y}` (`chimney: {activity}`
   * without x/z keeps the model's own anchors and only sets how busy the fire is). Library models without a chimney anchor never smoke (no smoke
   * from bare roofs); ruins / destroyed variants are cold. Only procedural placeholder houses/huts (no library model)
   * get a seeded brick stack, seated on the roof surface under it (raycast) so it never floats.
   * Per-chimney variety (seeded by id): cold / faint / normal / busy, theater-weighted, plus a slow draught variation.
   */
  _maybeChimney(id, s, k) {
    const def = s.def || {}, obj = s.object3d;
    if (def.chimney === false || s.destroyed) return;
    obj.updateMatrixWorld(true);
    let pts = def.chimney && typeof def.chimney === 'object' && def.chimney.x != null
      ? [V3(def.chimney.x, def.chimney.y ?? this._y(def.chimney.x, def.chimney.z) + 6, def.chimney.z)] : FX.chimneyPoints(obj);
    if (pts === null) return; // library model without a chimney (or a ruin): no smoke
    pts = pts.map((q) => this._seatOnStack(q));
    let mesh = null;
    if (!pts.length) {
      if (!['house', 'hut'].includes(s.type) && def.chimney !== true) return;
      const share = this.theater === 'snow' ? 0.75 : 0.45;
      const r = (Math.imul((k + 1) * 2654435761, 97) >>> 0) / 4294967296 + (typeof id === 'string' ? id.length * 0.013 : 0);
      if (def.chimney !== true && (r % 1) > share) return;
      const st = this._placeholderStack(obj, def, k);
      if (!st) return;
      mesh = st.mesh; pts = [st.pos];
    }
    pts.forEach((pos, j) => {
      const act = def.chimney === true || def.chimney?.activity != null ? (def.chimney?.activity ?? 1) : FX.chimneyActivity(`${id}#${j}`, this.theater);
      const rec = { id, owner: s.owner, handle: null, mesh: j === 0 ? mesh : null, pos, activity: act };
      this._chimneys.push(rec);
    });
  }

  /**
   * The sidecar's chimney anchor floats a few decimetres above the stack (capped stacks): snap the emission point down
   * onto the drawn stack top (+5 cm) with a short ray (instanced repeats are drawn by a batch → ray the whole scene).
   */
  _seatOnStack(q) {
    const root = this.scene;
    if (!root?.isObject3D) return q;
    _ray.set(V3(q.x, q.y + 0.3, q.z), _down); _ray.far = 1.0;
    const hit = _ray.intersectObject(root, true).find((h) => h.object.visible !== false && !h.object.isPoints && !h.object.isSprite && h.object.name !== 'fx-chimney');
    return hit && hit.point.y > q.y - 0.7 ? V3(q.x, hit.point.y + 0.05, q.z) : q;
  }

  /** After the scan: make sure a map with chimneys has at least one lit, then start the emitters. */
  _lightChimneys() {
    const C = this._chimneys;
    if (C.length && !C.some((c) => c.activity > 0)) C[0].activity = 1;
    const snow = this.theater === 'snow' || this.theater === 'winter';
    for (const c of C) {
      if (c.handle || !(c.activity > 0) || c.dead) continue;
      // wood smoke is bluish-grey: over snow a little darker than the snow so it still reads at low opacity
      c.handle = this.spawn('chimney_smoke', c.pos.x, c.pos.z, { y: c.pos.y, activity: c.activity,
        col: snow ? [0.27, 0.3, 0.38] : [0.33, 0.34, 0.38], seed: FX._hash(`${c.id}:${c.pos.x.toFixed(1)}`) * 1e6 | 0 });
    }
  }

  /**
   * World chimney tops of a structure's library model(s): [] when the object carries no library model (procedural),
   * null when it does but the model has no chimney anchor (or is a ruin / destroyed variant).
   */
  static chimneyPoints(obj) {
    const pts = [];
    let lib = false;
    obj.traverse((o) => {
      const name = o.userData?.building;
      if (name) {
        lib = true;
        if (/ruin|destroyed/.test(name)) return;
        for (const an of buildingMeta(name)?.anchors || []) if (an.kind === 'chimney' || an.kind === 'smoke') pts.push(V3(an.pos[0], an.pos[1], an.pos[2]).applyMatrix4(o.matrixWorld));
      } else if (!lib && /chimney/i.test(o.name || '') && o.name !== 'fx-chimney') {
        const b = new THREE.Box3().setFromObject(o);
        if (!b.isEmpty()) pts.push(V3((b.min.x + b.max.x) / 2, b.max.y + 0.05, (b.min.z + b.max.z) / 2));
      }
    });
    const asset = obj.userData?.libraryAsset;
    if (!lib && asset) { // instanced repeat: the batch draws it and the library node was disposed → rebuild its matrix
      lib = true;
      const fit = obj.children.find((c) => c.name === 'fit'), turn = fit?.children[0], ext = assetExtents(asset);
      if (turn && ext && !/ruin|destroyed/.test(asset)) {
        const M = new THREE.Matrix4().makeTranslation(-ext.cx, 0, -ext.cz).premultiply(turn.matrixWorld);
        for (const an of buildingMeta(asset)?.anchors || []) if (an.kind === 'chimney' || an.kind === 'smoke') pts.push(V3(an.pos[0], an.pos[1], an.pos[2]).applyMatrix4(M));
      }
    }
    return lib && !pts.length ? null : pts;
  }

  /** Seeded chimney state: 0 (cold) · ~0.45 (faint) · 1 (normal) · 1.5 (busy); more fires lit in cold theaters. */
  static chimneyActivity(key, theater) {
    const u = FX._hash(key), cold = theater === 'snow' || theater === 'winter' || theater === 'night';
    const [off, faint, normal] = cold ? [0.15, 0.5, 0.9] : [0.4, 0.7, 0.95];
    return u < off ? 0 : u < faint ? 0.45 : u < normal ? 1 : 1.5;
  }

  static _hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h ^ (h >>> 13)) >>> 0) / 4294967296; }

  /** Brick stack for a procedural house/hut, seated on the roof surface under it and topping the ridge. */
  _placeholderStack(obj, def, k) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return null;
    const w = def.w ?? (box.max.x - box.min.x), d = def.d ?? (box.max.z - box.min.z);
    const local = V3(w * 0.28 * (k % 2 ? 1 : -1), 0, d * 0.18);
    local.applyAxisAngle(V3(0, 1, 0), obj.rotation?.y ?? 0);
    const cx = (box.min.x + box.max.x) / 2 + local.x, cz = (box.min.z + box.max.z) / 2 + local.z;
    _ray.set(V3(cx, box.max.y + 5, cz), _down); _ray.far = Infinity;
    const hit = _ray.intersectObject(obj, true).find((h) => !h.object.isSprite && !h.object.isPoints);
    const roofY = hit ? hit.point.y : box.max.y, top = Math.max(roofY + 0.9, box.max.y + 0.35), base = roofY - 0.3;
    // placeholder-art pass: a textured stack (brick; rendered mud brick in the desert) with a cap slab (was a flat-colour
    // box); unit-height geometry scaled to the stack height as before, its UVs laid out at the real height
    const H = top - base, desert = this.theater === 'desert';
    const geo = boxUV(new THREE.BoxGeometry(0.6, H, 0.6).toNonIndexed(), 1.2).scale(1, 1 / H, 1);
    const capM = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.76, 0.1, 0.76).toNonIndexed(), 1.2), dressingMaterial(desert ? 'adobe' : 'concrete'));
    capM.position.y = 0.5 - 0.06 / H; capM.scale.y = 1 / H; capM.name = 'fx-chimney'; capM.castShadow = true; // cap just under the stack top (smoke leaves at top + 0.02)
    const mesh = new THREE.Mesh(geo, dressingMaterial(desert ? 'mudRender' : 'brick'));
    mesh.add(capM);
    mesh.scale.y = H; mesh.position.set(cx, (top + base) / 2, cz);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'fx-chimney';
    this.root.add(mesh);
    return { mesh, pos: V3(cx, top + 0.02, cz) };
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
    this._ambientMask();
  }

  /**
   * Readability mask sources for the AMBIENT smoke layer (vfx.ambient, used by the FxPass composite): every unit,
   * enemy (and body), door, pickup and the probe ring as a world cylinder, plus the vision cones on show. Only those
   * near the live ambient smoke are sent (its AABB grown by the ground it can cover on screen at the 40° pitch).
   */
  _ambientMask() {
    const v = this.vfx, A = v.ambient, P = v.amb, w = this.world;
    A.entities.length = 0; A.cones.length = 0;
    if (!P?.liveCount) return;
    const b = P.box, reach = Math.max(0, b.max.y - b.min.y) * 1.3 + P.maxSize + 6;
    const x0 = b.min.x - reach, x1 = b.max.x + reach, z0 = b.min.z - reach, z1 = b.max.z + reach, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const near = (x, z, r = 0) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r;
    // units not drawn (garrisoned inside a building, hidden in a vehicle…) leave no hole in the plume
    // screen-space capsule per entity: its upright axis (base → top) in the camera plane, radius r (m)
    const add = (e, r, h) => {
      if (!e || e.removed || e.object3d?.visible === false || !Number.isFinite(e.x) || !near(e.x, e.z, r)) return;
      const y0 = Math.max(e.y || 0, this._y(e.x, e.z));
      A.entities.push({ x: e.x, z: e.z, r, y0, top: y0 + h });
    };
    for (const u of w.commandos || []) add(u, 0.9, 1.9);   // + selection ring around the feet
    for (const e of w.enemies || []) add(e, 0.85, 1.9);    // standing / prone / bodies
    for (const it of w.interactables || []) {
      const k = it.interactKind;
      if (k === 'door') add(it, 0.9, it.h ?? 2);
      else if (k === 'pickup' || k === 'knapsack' || k === 'extraction' || k === 'switch' || k === 'drawbridgeSwitch') add(it, 0.7, 0.8);
    }
    const cones = w.game?.cones;
    if (cones?.probe) add(cones.probe, 0.8, 0.2);
    if (A.entities.length > A.maxEntities) {
      A.entities.sort((p, q) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(q.x - cx, q.z - cz));
      A.entities.length = A.maxEntities;
    }
    for (const e of w.enemies || []) {
      if (A.cones.length >= A.maxCones) break;
      if (!(e.coneVisible || cones?.showAll) || e.alive === false) continue;
      const c = coneAt(e);
      if (c && near(c.x, c.z, c.far)) A.cones.push({ x: c.x, z: c.z, heading: c.heading, halfFov: c.halfFov, far: c.far, top: this._y(c.x, c.z) + 2.5 });
    }
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
    for (const c of this._chimneys) { c.mesh?.removeFromParent(); c.mesh?.traverse((o) => o.geometry?.dispose?.()); }
    this._chimneys = []; this._trails.clear(); this._wrecks.clear(); this._explosives.clear();
    this.vfx?.dispose();
    this.vfx = null;
    this.root.removeFromParent();
    this.items.length = 0;
  }

}

export default FX;
