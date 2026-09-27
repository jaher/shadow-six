/**
 * Game integration of the water system (docs/water-pipeline.md; module in src/art/water/).
 *
 *  - `waterBodyDescriptors(grid, mission, theater)`: nav-grid water/shallow cells → `addBody` descriptors, with the
 *    mission's `water {velocity, angleDeg, turbulence, frozen}` (current, foam), the theatre's optical preset
 *    (design-spec §2.4: fjord teal, M2 river cyan), shore ice shelves on the Norway snow maps and surf on coasts.
 *  - `WakeTracker`: per displayed frame, turns units and craft in the water into ripples/foam (swimmers, divers,
 *    rafts and boats: bow wave + stern wash), splashes when something enters the water (a body falling in, a
 *    commando wading in) and when a unit dies in it. Pure logic over a `sink` with `disturb(x,z,s,r,foam)`.
 *  - `buildWater(renderer, world, grid, mission, theater)`: the GPU system (WaterSystem through the engine's
 *    official post hooks), the event wiring (explosions / grenades / missed shots into water) and the FX layer.
 *
 * Only built with the real terrain (GPU renderer); the placeholder terrain keeps its flat plane.
 * @module art/water
 */
import { T } from '../world/grid.js';

/** World Y of the water surface. Terrain carves deep cells to -1.2 m and shallows to -0.35 m below it. */
export const WATER_LEVEL = -0.1;

/** Late transparent FX layer (drawn after the water; see src/art/water/passes.js). */
export const FX_LAYER = 11;

const isWetCode = (t) => t === T.WATER || t === T.SHALLOW;

/** Is the nav-grid cell under (x, z) water or shallow water? */
export function wetAt(grid, x, z) {
  const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
  return i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && isWetCode(grid.terrain[j * grid.cols + i]);
}

/**
 * Shore ice shelf width (m) for a snow-theatre body: wide on still fjords and lakes, narrow on fast rivers (the
 * current keeps the middle open). 0 outside the snow theatre.
 */
export function iceShelfWidth(theater, velocity = 0) {
  if (theater !== 'snow') return 0;
  return Math.max(0.6, Math.min(2.6, 2.6 - 1.3 * velocity));
}

/** Optical preset per theatre and body type (design-spec §2.4 colours). */
export function waterPreset(theater, type, mission = {}) {
  if (type === 'sea') return theater === 'snow' ? 'fjord' : 'sea';
  if (type === 'river') return theater === 'desert' ? 'muddy' : theater === 'snow' ? 'clear' : 'river';
  if (theater === 'snow') return 'fjord';
  if (theater === 'coast' || theater === 'night') return 'harbor';
  return mission.water?.turbulence > 0.7 ? 'muddy' : 'lake';
}

/**
 * Nav-grid water → addBody descriptors (see waterBodiesFromGrid in src/art/water/grid.js for the component split).
 * @param {import('./water/grid.js').waterBodiesFromGrid} fromGrid injected (keeps this function GPU-free for tests)
 */
export function waterBodyDescriptors(grid, mission = {}, theater = 'temperate', fromGrid) {
  const W = mission.water || null;
  const frozen = !!W?.frozen;
  const bodies = fromGrid(grid, { ...mission, theater }, { cell: grid.cell, level: WATER_LEVEL, minCells: 4 });
  return bodies.map((b) => {
    const d = { ...b, preset: waterPreset(theater, b.type, mission) };
    if (frozen) d.frozen = true;
    else d.ice = iceShelfWidth(theater, W?.velocity || 0);
    if (b.type === 'sea' && !frozen && theater !== 'snow') d.surf = { amp: 0.18, length: 7, period: 6.4 };
    if (b.type === 'river') d.sheen = 1.6;
    return d;
  });
}

/** Wake parameters per mover class: disturb strength (m), radius (m), foam, emit period (s). */
const WAKE = {
  swim: { s: 0.05, r: 0.4, foam: 0.3, dt: 0 },
  dive: { s: 0.015, r: 0.35, foam: 0.05, dt: 0.4 },
  wade: { s: 0.04, r: 0.4, foam: 0.3, dt: 0 },
  boat: { s: 0.045, r: 0.8, foam: 0.5, dt: 0 },
};

/**
 * Per-frame ripple/foam emitter for everything in the water.
 * `sink.disturb(x, z, strength, radius, foam)`; `onSplash(x, z, size)` spawns the splash sprite (FX).
 */
export class WakeTracker {
  /** @param {{disturb:Function}} sink @param {(x:number,z:number)=>boolean} isWet @param {Function} [onSplash] */
  constructor(sink, isWet, onSplash = null) {
    this.sink = sink; this.isWet = isWet; this.onSplash = onSplash;
    this.state = new Map(); // entity → {x, z, wet, alive, acc}
    this.emitted = 0;
  }

  _classOf(e) {
    if (e.kind === 'vehicle' || e.def?.kind) return e.def?.kind === 'boat' ? 'boat' : null;
    if (e.state === 'inVehicle' || e.state === 'carried') return null;
    if (e.stance === 'dive' || e.underwater) return 'dive';
    if (e.stance === 'swim') return 'swim';
    return 'wade';
  }

  _emit(x, z, s, r, foam) { this.sink.disturb(x, z, s, r, foam); this.emitted++; }

  splash(x, z, size = 1) {
    this._emit(x, z, -0.22 * size, 0.6 + 0.5 * size, Math.min(1, 0.5 + 0.4 * size));
    this.onSplash?.(x, z, size);
  }

  /** @param {Iterable<object>} entities world.entities @param {number} dt displayed-frame delta (s) */
  update(entities, dt) {
    if (!(dt > 0)) return;
    const seen = new Set();
    for (const e of entities) {
      if (e == null || e.x == null || e.kind === 'projectile') continue;
      const cls = this._classOf(e);
      if (!cls) { this.state.delete(e); continue; }
      seen.add(e);
      const wet = this.isWet(e.x, e.z);
      let st = this.state.get(e);
      if (!st) { this.state.set(e, st = { x: e.x, z: e.z, wet, alive: e.alive !== false, acc: 0 }); continue; }
      const alive = e.alive !== false;
      if (wet && !st.wet) this.splash(e.x, e.z, cls === 'boat' ? 1.4 : alive ? 0.6 : 1);   // wades / falls in
      else if (!wet && st.wet && cls !== 'boat') this._emit(st.x, st.z, 0.03, 0.5, 0.2);   // climbs out
      if (wet && st.alive && !alive) this.splash(e.x, e.z, 0.9);                          // dies in the water
      const dx = e.x - st.x, dz = e.z - st.z, v = Math.hypot(dx, dz) / dt;
      st.acc += dt;
      const W = WAKE[cls];
      if (wet && alive && v > 0.15 && v < 40 && st.acc >= W.dt) {
        st.acc = 0;
        if (cls === 'boat') this._boatWake(e, dx / (v * dt), dz / (v * dt), v, st);
        else { st.flip = !st.flip; this._emit(e.x, e.z, (st.flip ? -1 : 0.6) * W.s * Math.min(2, 0.6 + v / 2), W.r, W.foam); } // strokes
      }
      st.x = e.x; st.z = e.z; st.wet = wet; st.alive = alive;
    }
    for (const e of [...this.state.keys()]) if (!seen.has(e)) this.state.delete(e);
  }

  _boatWake(e, fx, fz, v, st = {}) {
    // every frame (demo values): bow wave pushing down ahead, churning prop wash / paddle foam astern, and two
    // shoulders at the Kelvin half-angle (19.5°) that the ripple sim spreads into the V wake
    const len = e.def?.size?.[0] ?? 3, beam = e.def?.size?.[1] ?? 1.4, k = Math.min(1.6, 0.4 + v / 4);
    const flip = (st.flip = !st.flip) ? 1 : -1;
    this._emit(e.x + fx * len * 0.5, e.z + fz * len * 0.5, -WAKE.boat.s * k, beam * 0.35, 0.05 * k);
    this._emit(e.x - fx * len * 0.55, e.z - fz * len * 0.55, 0.04 * k * flip, beam * 0.3, Math.min(1, WAKE.boat.foam * k));
    const px = -fz, pz = fx, back = len * 0.15, off = beam * 0.55;
    for (const sgn of [-1, 1]) this._emit(e.x - fx * back + px * off * sgn, e.z - fz * back + pz * off * sgn, -0.02 * k, beam * 0.25, 0.25 * k);
  }
}

/** Map engine render presets to water quality presets. */
const QUALITY_OF = { low: 'low', medium: 'medium', high: 'high', ultra: 'ultra' };

/**
 * Build the water for a finished map (call after the terrain is ready, before units spawn: the bed capture renders
 * the static scene from above). Returns null when the grid has no water.
 * @param {object} R engine Renderer (src/engine/renderer.js)
 * @param {import('../world/world.js').World} world
 * @param {object} grid nav grid
 * @param {object} mission normalized mission def
 * @param {string} theater
 * @param {{module?: object, terrain?: object}} [o] module = the src/art/water/index.js namespace (injected)
 */
/** Step 4w: FFT spectra from the mission wind (mean 10 m speed + heading); a floor keeps some swell alive. */
export function windSpectra(wind) {
  if (!wind?.p) return {};
  const dir = Math.atan2(wind.dz, wind.dx);
  return { sea: { wind: Math.max(2.5, wind.p.speed), windDir: dir }, detail: { wind: Math.max(2, wind.p.speed * 0.9), windDir: dir + 0.3 } };
}

export function buildWater(R, world, grid, mission, theater, o = {}) {
  const mod = o.module;
  if (!mod || !R?.renderer) return null;
  const descs = waterBodyDescriptors(grid, mission, theater, mod.waterBodiesFromGrid);
  if (!descs.length) return null;
  const t0 = performance.now();
  const system = mod.createWater(R, R.scene, R.camera, {
    quality: QUALITY_OF[R.presetName] || 'high', terrain: o.terrain ? [o.terrain] : undefined, lateDecals: true,
    ...windSpectra(world.wind),
  });
  // bridge piers / trestle bents of the library buildings (map-builder → world.waterObstacles) shape the flow
  const obst = o.obstacles || world.waterObstacles || [];
  if (obst.length) {
    for (const d of descs) {
      const P = d.polygon || [];
      if (!P.length) continue;
      const xs = P.map((q) => q[0]), zs = P.map((q) => q[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const mine = obst.filter((b) => b.x + b.r >= x0 && b.x - b.r <= x1 && b.z + b.r >= z0 && b.z - b.r <= z1 && (!d.mask || d.mask(b.x, b.z)));
      if (mine.length) d.obstacles = [...(d.obstacles || []), ...mine.map(({ x, z, r }) => ({ x, z, r }))];
    }
  }
  const bodies = descs.map((d) => system.addBody(d));
  const isWet = (x, z) => wetAt(grid, x, z);
  const splashFx = (x, z, size) => world.fx?.spawn?.('splash', x, z, { radius: size, water: true });
  const wakes = new WakeTracker(system, isWet, splashFx);
  const stats = { bodies: bodies.map((b) => ({ type: b.o.type, preset: b.o.preset || null, ice: b.o.ice || 0, frozen: !!b.o.frozen })),
    buildMs: 0, hookMode: system.hookMode, updateMs: 0 };
  stats.buildMs = Math.round(performance.now() - t0);

  // FX drawn after the water (smoke, splashes, flashes over rivers are not painted over by the surface)
  if (world.fx) { world.fx.lateLayer = FX_LAYER; if (world.fx.root) system.addLateRoot(world.fx.root); }
  const offs = [];
  const on = (ev, fn) => { const off = world.listen?.(ev, fn); if (typeof off === 'function') offs.push(off); };
  on('explosion', (e) => { // grenades / charges / barrels going off in (or at the edge of) the water: water column
    if (!isWet(e.x, e.z)) return;
    const r = Math.max(1.5, Math.min(6, (e.radius || 3) * 0.6));
    system.disturb(e.x, e.z, -0.6, r, 1);
    for (let k = 0; k < 4; k++) system.disturb(e.x + (k - 1.5) * r * 0.35, e.z + ((k * 7) % 3 - 1) * r * 0.3, 0.25, r * 0.4, 0.8);
    world.fx?.spawn?.('splash', e.x, e.z, { radius: r, water: true, big: true });
  });
  on('projectile:bounce', (e) => { if (isWet(e.x, e.z)) wakes.splash(e.x, e.z, 0.5); });
  on('shot', (e) => { // missed bullets kick up spouts where they hit the water
    const t = e.to; if (!t || e.hit || e.weapon === 'knife' || e.weapon === 'injection' || !isWet(t.x, t.z)) return;
    system.disturb(t.x, t.z, -0.06, 0.3, 0.4);
  });
  on('unit:water', (e) => { // dive / surface / row strokes from the marine's abilities
    const u = e.unit; if (!u) return;
    if (e.what === 'dive') wakes.splash(u.x, u.z, 0.45);
    else if (e.what === 'surface') system.disturb(u.x, u.z, 0.08, 0.6, 0.3);
    else if (e.what === 'row') system.disturb(u.x, u.z, 0.05, 0.9, 0.35);
  });

  const handle = {
    system, bodies, stats, level: WATER_LEVEL, real: true,
    sample: (x, z) => system.sample(x, z),
    depthAt: (x, z) => system.depthAt(x, z),
    disturb: (...a) => system.disturb(...a),
    /** Late-FX roots (particles/VFX on FX_LAYER) scanned every frame so new effects draw over the water at once. */
    addLateRoot: (root) => system.addLateRoot(root),
    wakes,
    /** Per displayed frame, BEFORE engine.render(): quality follows the preset, wakes, simulation, reflections. */
    frame(dt, camera) {
      const q = QUALITY_OF[R.presetName];
      if (q && q !== system.qualityName) system.setQuality(q);
      if (camera && system.camera !== camera) system.camera = camera;
      wakes.update(world.entities || [], dt);
      const t = performance.now();
      system.update(dt);
      stats.updateMs = performance.now() - t;
    },
    dispose() {
      offs.forEach((f) => f()); offs.length = 0;
      if (world.fx && world.fx.lateLayer === FX_LAYER) world.fx.lateLayer = null;
      system.dispose();
    },
  };
  return handle;
}
