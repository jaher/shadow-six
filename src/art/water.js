/**
 * Game integration of the water system (docs/water-pipeline.md; module in src/art/water/).
 *
 *  - `waterBodyDescriptors(grid, mission, theater)`: nav-grid water/shallow cells → `addBody` descriptors, with the
 *    mission's `water {velocity, angleDeg, turbulence, frozen}` (current, foam), the theatre's optical preset
 *    (design-spec §2.4: fjord teal, M2 river cyan), shore ice shelves on the Norway snow maps and surf on coasts.
 *  - `WakeTracker`: per displayed frame, turns units and craft in the water into ripples/foam (swimmers, divers,
 *    rafts and boats: speed-scaled bow wave, broken stern wash, Kelvin V arms of crest particles that bend with
 *    the track and drift with the current, paddle strokes on rowed craft, quiet water at rest), splashes when
 *    something enters the water (a body falling in, a commando wading in) and when a unit dies in it. Pure logic
 *    over a `sink` with `disturb(x,z,s,r,foam)` (+ optional `crest(x,z,s,r,amount)`).
 *  - `buildWater(renderer, world, grid, mission, theater)`: the GPU system (WaterSystem through the engine's
 *    official post hooks), the event wiring (explosions / grenades / missed shots into water), the FX layer and the
 *    dry hulls (no water inside a boat, calm water round it: art/water/hulls.js).
 *
 * Only built with the real terrain (GPU renderer); the placeholder terrain keeps its flat plane.
 * @module art/water
 */
import { T } from '../world/grid.js';
import { dryHullOf } from './water/hulls.js';
import { rowPeriod, catchOffset, ROW } from './oars.js';

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
  // raised water (terrain features with a `level`, e.g. the M3 reservoir held up by its dam): their cells become
  // bodies of their own at that level (still water), cut out of the ordinary bodies
  const raised = raisedWaterMasks(grid, mission);
  let base = grid;
  if (raised.length) {
    const t = grid.terrain.slice();
    for (const r of raised) for (let k = 0; k < t.length; k++) if (r.mask[k]) t[k] = 0;
    base = { cols: grid.cols, rows: grid.rows, cell: grid.cell, terrain: t };
  }
  const bodies = fromGrid(base, { ...mission, theater }, { cell: grid.cell, level: WATER_LEVEL, minCells: 4 });
  for (const r of raised) {
    const t = new Uint8Array(grid.terrain.length);
    for (let k = 0; k < t.length; k++) if (r.mask[k]) t[k] = grid.terrain[k];
    const still = { ...mission, theater, water: W ? { ...W, velocity: 0 } : null };
    for (const b of fromGrid({ cols: grid.cols, rows: grid.rows, cell: grid.cell, terrain: t }, still, { cell: grid.cell, level: r.level, minCells: 4, type: 'lake' })) {
      bodies.push({ ...b, raised: { level: r.level, drainOn: r.drainOn ?? null, id: r.id ?? null }, flow: undefined });
    }
  }
  return bodies.map((b) => {
    const d = { ...b, preset: waterPreset(theater, b.type, mission) };
    if (frozen) d.frozen = true;
    else d.ice = iceShelfWidth(theater, b.raised ? 0 : W?.velocity || 0);
    if (b.type === 'sea' && !frozen && theater !== 'snow') d.surf = { amp: 0.18, length: 7, period: 6.4 };
    if (b.type === 'river') d.sheen = 1.6;
    if (W?.iceFree?.length && !b.raised) d.iceFree = W.iceFree; // open water where a fall lands (M3 dam foot)
    return d;
  });
}

/**
 * Cell masks of the mission's raised water (terrain features `{terrain:'water', level, drainOn?}`): wet cells whose
 * centre lies in the feature's polygon. @returns {{level:number, drainOn?:string, mask:Uint8Array}[]}
 */
export function raisedWaterMasks(grid, mission = {}) {
  const out = [];
  for (const f of mission.terrain || []) {
    if (!(f.level > WATER_LEVEL) || f.type !== 'poly' || !Array.isArray(f.points)) continue;
    const P = f.points.map((q) => (Array.isArray(q) ? q : [q.x, q.z])), mask = new Uint8Array(grid.cols * grid.rows);
    let n = 0;
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
      const k = j * grid.cols + i;
      if (!isWetCode(grid.terrain[k])) continue;
      const x = (i + 0.5) * grid.cell, z = (j + 0.5) * grid.cell;
      let inside = false;
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
        if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) inside = !inside;
      }
      if (inside) { mask[k] = 1; n++; }
    }
    if (n) out.push({ level: f.level, drainOn: f.drainOn, id: f.id, mask });
  }
  return out;
}

/** Wake parameters per mover class: disturb strength (m), radius (m), foam, emit period (s). Boats: `_boat`. */
const WAKE = {
  swim: { s: 0.05, r: 0.4, foam: 0.3, dt: 0 },
  dive: { s: 0.015, r: 0.35, foam: 0.05, dt: 0.4 },
  wade: { s: 0.04, r: 0.4, foam: 0.3, dt: 0 },
};

/** Kelvin half-angle 19.47°: a displacement hull's V arms spread sideways at tan(θ) × boat speed. */
export const KELVIN_TAN = Math.tan(19.47 * Math.PI / 180);

/**
 * Wake profile of a craft: rowed (the Marine's inflatable raft: paddle strokes; the rowboat: OARS, both blades at
 * once; a light wash, a soft bow) vs powered (patrol boat, mini-sub: churning prop wash, a full bow wave).
 * stroke = paddle period (s; oars: art/oars.js rowPeriod of the speed).
 */
export function boatProfile(def = {}) {
  const rowed = !!def.raft || (def.model === 'raft' && !(def.weapons || []).includes('torpedo'));
  if (!rowed) return { rowed: false, wash: 0.65, bow: 1, crest: 0.6, stroke: 0 };
  return { rowed: true, oars: !def.raft, wash: 0.3, bow: 0.8, crest: 0.45, stroke: 0.9 };
}
/** Where the rowboat's blades catch, relative to the boat (art/oars.js). */
const OAR_CATCH = catchOffset();

/**
 * Per-frame ripple/foam emitter for everything in the water.
 * `sink.disturb(x, z, strength, radius, foam)`; `onSplash(x, z, size)` spawns the splash sprite (FX).
 */
export class WakeTracker {
  /** @param {{disturb:Function}} sink @param {(x:number,z:number)=>boolean} isWet @param {Function} [onSplash] */
  constructor(sink, isWet, onSplash = null, flowAt = null) {
    this.sink = sink; this.isWet = isWet; this.onSplash = onSplash; this.flowAt = flowAt; // flowAt(x,z) → [vx,vz] current
    this._seed = 0x2f6b;
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
  /** Crisp, short-lived crest foam (Kelvin arms); sinks without a crest channel get plain foam. */
  _crest(x, z, s, r, a, x1 = x, z1 = z) { if (this.sink.crest) this.sink.crest(x, z, s, r, a, x1, z1); else this.sink.disturb(x, z, s, r, a * 0.5); this.emitted++; }
  _rand() { this._seed = (this._seed * 1103515245 + 12345) >>> 0; return (this._seed >>> 8) / 16777216; }

  /**
   * Paddle-stroke clock of a rowed craft, for the paddler's arms (art/boat-crew.js): the stroke now in the water
   * started `t` s ago on `side` (+1 = the craft's right, heading + π/2; −1 its left), one every `period` s while
   * `moving`. Oared craft (`oars`): both blades together, `u` = the phase of the row stroke (0 = the catch, when both
   * catch rings ring out), `period` its length at the boat's speed. Null for craft this tracker has not seen or that
   * are not rowed.
   */
  strokeOf(e) {
    const st = this.state.get(e);
    if (!st?.prof?.rowed) return null;
    if (st.prof.oars) {
      const per = st.rowPer || rowPeriod(st.v || 0), u = st.rowU ?? 0;
      return { oars: true, side: 0, u, t: u * per, period: per, moving: (st.rowStill ?? 9) < 0.3 };
    }
    return { side: st.side || 1, t: st.strokeT || 0, period: st.prof.stroke, moving: st.fx != null };
  }

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
      if (cls === 'boat') this._boat(e, st, wet, alive, dx, dz, v, dt);
      else if (wet && alive && v > 0.15 && v < 40 && st.acc >= W.dt) {
        st.acc = 0;
        st.flip = !st.flip; this._emit(e.x, e.z, (st.flip ? -1 : 0.6) * W.s * Math.min(2, 0.6 + v / 2), W.r, W.foam); // strokes
      }
      st.x = e.x; st.z = e.z; st.wet = wet; st.alive = alive;
    }
    for (const e of [...this.state.keys()]) if (!seen.has(e)) this.state.delete(e);
  }

  /**
   * One boat, every displayed frame. Moving: a bow wave pushing the water down (∝ v², a little spray), a broken,
   * turbulent wash astern (slewed to the outside of a turn), Kelvin crest particles born at the bow shoulders that
   * run out sideways at tan(19.47°)·v and drift with the current — the V arms, bending along a curved track — and,
   * for rowed craft, alternating paddle strokes (a catch ring + a swirl left astern). At rest: quiet water, only a
   * faint lap every few seconds and no foam; the last wake keeps spreading and fades.
   */
  _boat(e, st, wet, alive, dx, dz, v, dt) {
    const P = st.prof || (st.prof = boatProfile(e.def));
    // hull size: the registry footprint, or the true-scale library hull when it is bigger (the patrol boat)
    const md = e.model?.library ? e.model.dims : null;
    const len = Math.max(e.def?.size?.[0] ?? 3, md?.l || 0), beam = Math.max(e.def?.size?.[1] ?? 1.4, md?.w || 0);
    st.v = (st.v ?? 0) + (Math.min(v, 12) - (st.v ?? 0)) * Math.min(1, dt * 6);
    const arms = st.arms || (st.arms = [[], []]), puddles = st.puddles || (st.puddles = []); // arms: crest particles per side, oldest first
    if (wet && alive && v > 0.3 && v < 40) {
      const fx = dx / (v * dt), fz = dz / (v * dt), px = -fz, pz = fx, sv = st.v;
      const turn = st.fx != null ? Math.atan2(st.fx * fz - st.fz * fx, st.fx * fx + st.fz * fz) / dt : 0;
      st.fx = fx; st.fz = fz;
      const k = Math.min(1.6, 0.35 + sv / 3.2), kb = Math.min(1.5, (sv / 3) ** 2);
      // bow wave (∝ v²): the hull pushes the surface down ahead of it, a little spray at speed
      this._emit(e.x + fx * len * 0.5, e.z + fz * len * 0.5, -(0.006 + 0.022 * P.bow * kb), beam * 0.6, 0.15 * P.bow * kb);
      // wash astern: broken, uneven foam (seeded jitter), slewed outward in a turn
      const slew = Math.max(-1, Math.min(1, turn / 1.5)) * beam * 0.35, jit = (this._rand() - 0.5) * beam * 0.3;
      this._emit(e.x - fx * len * 0.55 + px * (jit - slew), e.z - fz * len * 0.55 + pz * (jit - slew), -0.005 * k,
        beam * (0.26 + 0.14 * this._rand()), Math.min(1, P.wash * k * (0.6 + 0.8 * this._rand())));
      // Kelvin arms: a crest pair every 0.2 s at the bow shoulders
      st.crestAcc = (st.crestAcc || 0) + dt;
      if (st.crestAcc >= 0.2) {
        st.crestAcc = 0;
        const life = Math.min(3.4, 1.8 + sv * 0.4), lat = sv * KELVIN_TAN, amt = P.crest * Math.min(1, 0.35 + sv / 3.5);
        for (let a = 0; a < 2; a++) {
          const sg = a ? 1 : -1, arm = arms[a];
          arm.push({ x: e.x + fx * len * 0.3 + px * beam * 0.5 * sg, z: e.z + fz * len * 0.3 + pz * beam * 0.5 * sg,
            vx: px * sg * lat, vz: pz * sg * lat, age: 0, life, amt });
          if (arm.length > 24) arm.splice(0, arm.length - 24);
        }
      }
      if (P.oars) { st.rowStill = 0; st.hx = fx; st.hz = fz; }
      else if (P.rowed) { // paddle strokes (raft): alternating sides; the catch rings out, the blade leaves a swirl astern
        st.strokeT = (st.strokeT || 0) + dt;
        if (st.strokeT >= P.stroke) {
          st.strokeT = 0; st.side = -(st.side || 1);
          const ox = e.x - fx * len * 0.05 + px * beam * 0.62 * st.side, oz = e.z - fz * len * 0.05 + pz * beam * 0.62 * st.side;
          this._emit(ox, oz, 0.02, 0.5, 0.45);
          puddles.push({ x: ox - fx * 0.6, z: oz - fz * 0.6, t: 0.3 });
        }
      }
    } else {
      st.fx = null;
      if (P.oars) st.rowStill = (st.rowStill ?? 9) + dt;
      if (wet && alive) { // quiet: a faint lap round the hull every few seconds, no foam
        st.lap = (st.lap || 0) + dt;
        if (st.lap >= 2.6) { st.lap = 0; this._emit(e.x, e.z, 0.006, beam * 0.8, 0); }
      }
    }
    // oars (rowboat): the row clock runs while the boat makes way (a display frame without a sim tick is not a stop);
    // both blades catch at once, out at the oars' reach forward of midships, and each leaves its swirl where it came
    // out at the end of the drive (the blade grips the water while the boat runs past it)
    if (P.oars && st.rowStill < 0.3 && wet && alive) {
      const per = st.rowPer = rowPeriod(st.v);
      st.rowU = (st.rowU ?? 0.9) + dt / per;
      if (st.rowU >= 1) {
        st.rowU -= 1;
        const fx = st.hx, fz = st.hz, px = -fz, pz = fx;
        for (const sg of [1, -1]) {
          const ox = e.x + fx * OAR_CATCH.fwd + px * OAR_CATCH.side * sg, oz = e.z + fz * OAR_CATCH.fwd + pz * OAR_CATCH.side * sg;
          this._emit(ox, oz, 0.02, 0.5, 0.45);
          puddles.push({ x: ox, z: oz, t: ROW.drive * per });
        }
      }
    }
    for (let i = puddles.length - 1; i >= 0; i--) {
      const q = puddles[i]; q.t -= dt;
      if (q.t <= 0) { this._emit(q.x, q.z, -0.01, 0.4, 0.3); puddles.splice(i, 1); }
    }
    // crest particles: out at tan(θ)·v, drifting with the current. Each arm is drawn as capsules between
    // neighbouring particles (a continuous crest line), a third of them per frame (round robin)
    if (!arms[0].length && !arms[1].length) return;
    const fl = this.flowAt ? this.flowAt(e.x, e.z) : null, cx = fl?.[0] || 0, cz = fl?.[1] || 0;
    st.rr = ((st.rr || 0) + 1) % 3;
    for (const arm of arms) {
      for (let i = arm.length - 1; i >= 0; i--) {
        const c = arm[i];
        c.age += dt; c.x += (c.vx + cx) * dt; c.z += (c.vz + cz) * dt;
        if (c.age >= c.life || !this.isWet(c.x, c.z)) arm.splice(i, 1);
      }
      for (let i = st.rr; i < arm.length; i += 3) {
        const c = arm[i], n = arm[i + 1], f = (1 - c.age / c.life) ** 0.7;
        const joined = n && Math.hypot(n.x - c.x, n.z - c.z) < 2.5; // a gap (stop, restart) breaks the line
        this._crest(c.x, c.z, 0.006 * f, 0.14 + 0.07 * c.age, c.amt * f, joined ? n.x : c.x, joined ? n.z : c.z);
      }
    }
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
 * @param {{module?: object, terrain?: object, apron?: object, shore?: object}} [o] module = the src/art/water/index.js namespace (injected); shore = world/shore-field.js field
 */
/** Step 4w: FFT spectra from the mission wind (mean 10 m speed + heading); a floor keeps some swell alive. */
export function windSpectra(wind) {
  if (!wind?.p) return {};
  const dir = Math.atan2(wind.dz, wind.dx);
  return { sea: { wind: Math.max(2.5, wind.p.speed), windDir: dir }, detail: { wind: Math.max(2, wind.p.speed * 0.9), windDir: dir + 0.3 } };
}

/**
 * Scenery apron (art/apron.js): every water body that reaches a map edge flows on over the apron. It takes the apron
 * code field's connected water components (cells past the map only) that touch its own edge cells (rivers continue
 * along their course, the sea and lakes past the edge), and its bake grows with it at the same texel density
 * (`bakeRes`, capped). A component touched by two bodies goes to the first (no water drawn twice); the second keeps
 * its own water. No body is ever dropped: the in-map part of a body is its own (a raised reservoir joined to the
 * river below its dam in the map stays a body of its own level, M3). Inner bodies are unchanged. Pure (unit-tested).
 * @param {object[]} descs waterBodyDescriptors() output (mutated copies returned)
 * @param {{grid:object, A:number, W:number, D:number}} f world/apron-field.js buildApronField()
 * @param {number} [res] the water quality's bodyRes
 */
export function extendBodiesOverApron(descs, f, res = 256, cap = 768) {
  if (!f) return descs;
  const g = f.grid, { cols, rows, terrain, cell } = g, A = f.A, W = f.W, D = f.D;
  const i0 = Math.round(A / cell), j0 = i0, i1 = i0 + Math.round(W / cell), j1 = j0 + Math.round(D / cell); // the map's cells
  const past = (i, j) => i < i0 || j < j0 || i >= i1 || j >= j1;
  const isW = (k) => (terrain[k] === 5 || terrain[k] === 6) && past(k % cols, (k / cols) | 0);
  let comp = null, boxes = null;
  const label = () => { // 4-connected components of the apron's water past the map (lazy: only when a body touches an edge)
    comp = new Int32Array(cols * rows).fill(-1); boxes = [];
    const st = [];
    for (let k0 = 0; k0 < cols * rows; k0++) {
      if (!isW(k0) || comp[k0] >= 0) continue;
      const id = boxes.length, b = [cols, rows, -1, -1];
      comp[k0] = id; st.push(k0);
      while (st.length) {
        const k = st.pop(), i = k % cols, j = (k / cols) | 0;
        if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i > b[2]) b[2] = i; if (j > b[3]) b[3] = j;
        if (i > 0 && isW(k - 1) && comp[k - 1] < 0) { comp[k - 1] = id; st.push(k - 1); }
        if (i < cols - 1 && isW(k + 1) && comp[k + 1] < 0) { comp[k + 1] = id; st.push(k + 1); }
        if (j > 0 && isW(k - cols) && comp[k - cols] < 0) { comp[k - cols] = id; st.push(k - cols); }
        if (j < rows - 1 && isW(k + cols) && comp[k + cols] < 0) { comp[k + cols] = id; st.push(k + cols); }
      }
      boxes.push(b);
    }
  };
  const at = (x, z) => { const i = Math.floor((x + A) / cell), j = Math.floor((z + A) / cell); return i < 0 || j < 0 || i >= cols || j >= rows ? -1 : comp[j * cols + i]; };
  const taken = new Set(), out = [];
  for (const d of descs) {
    const P = d.polygon || [], xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const edge = x0 <= cell + 1e-6 || z0 <= cell + 1e-6 || x1 >= W - cell - 1e-6 || z1 >= D - cell - 1e-6;
    if (!edge || !d.mask) { out.push(d); continue; }
    if (!comp) label();
    // the apron components just past this body's cells on the map's border rows / columns
    const ids = new Set(), h = cell / 2, e = cell * 0.75;
    const touch = (x, z, ox, oz) => { if (d.mask(x, z)) { const c = at(x + ox, z + oz); if (c >= 0 && !taken.has(c)) ids.add(c); } };
    for (let z = h; z < D; z += cell) { if (x0 <= cell + 1e-6) touch(h, z, -e, 0); if (x1 >= W - cell - 1e-6) touch(W - h, z, e, 0); }
    for (let x = h; x < W; x += cell) { if (z0 <= cell + 1e-6) touch(x, h, 0, -e); if (z1 >= D - cell - 1e-6) touch(x, D - h, 0, e); }
    for (const [x, z, ox, oz] of [[h, h, -e, -e], [W - h, h, e, -e], [h, D - h, -e, e], [W - h, D - h, e, e]]) touch(x, z, ox, oz); // corners
    if (!ids.size) { out.push(d); continue; }
    let nx0 = x0, nz0 = z0, nx1 = x1, nz1 = z1;
    for (const id of ids) {
      taken.add(id);
      const b = boxes[id];
      nx0 = Math.min(nx0, b[0] * cell - A); nz0 = Math.min(nz0, b[1] * cell - A); nx1 = Math.max(nx1, (b[2] + 1) * cell - A); nz1 = Math.max(nz1, (b[3] + 1) * cell - A);
    }
    const grow = Math.max(nx1 - nx0, nz1 - nz0) / Math.max(x1 - x0, z1 - z0, 1);
    const inner = d.mask;
    out.push({ ...d, polygon: [[nx0, nz0], [nx1, nz0], [nx1, nz1], [nx0, nz1]],
      mask: (x, z) => (x >= 0 && z >= 0 && x < W && z < D ? inner(x, z) : ids.has(at(x, z))),
      bakeRes: Math.min(cap, Math.round(res * grow)), apron: true });
  }
  return out;
}

export function buildWater(R, world, grid, mission, theater, o = {}) {
  const mod = o.module;
  if (!mod || !R?.renderer) return null;
  const Q = QUALITY_OF[R.presetName] || 'high';
  const descs = extendBodiesOverApron(waterBodyDescriptors(grid, mission, theater, mod.waterBodiesFromGrid), o.apron?.field || null,
    mod.WATER_QUALITY?.[Q]?.bodyRes ?? 256);
  if (!descs.length) return null;
  // continuous shorelines (world/shore-field.js, built with the terrain): bank distance for the mask edge, the
  // contact foam and the ice rim — the same smooth line the terrain is carved along
  if (o.shore) for (const d of descs) { d.sdf = o.shore.wetAt; d.sdfFar = o.shore.margin - 0.8; }
  const t0 = performance.now();
  const system = mod.createWater(R, R.scene, R.camera, {
    quality: Q, terrain: o.terrain ? [o.terrain, o.apron?.mesh].filter(Boolean) : undefined, lateDecals: true,
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
  const wakes = new WakeTracker(system, isWet, splashFx, (x, z) => system.sample(x, z)?.flow || null);
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
  // raised water (M3 reservoir): drains down to the river level once its dam is gone (`drainOn` = structure id)
  const drains = [];
  bodies.forEach((b, k) => { const r = descs[k].raised; if (r?.drainOn) drains.push({ body: b, from: r.level, id: r.drainOn, t: -1 }); });
  if (drains.length) on('structure:destroyed', (e) => { for (const d of drains) if (d.t < 0 && e?.id === d.id) d.t = 0; });
  const DRAIN_S = 40;
  const drainStep = (dt) => {
    for (const d of drains) {
      if (d.t < 0 && world.byId?.(d.id)?.destroyed) d.t = DRAIN_S - 1e-3; // loaded with the dam already down
      if (d.t < 0 || d.t >= DRAIN_S) continue;
      d.t = Math.min(DRAIN_S, d.t + dt);
      const u = d.t / DRAIN_S, k = 1 - (1 - u) * (1 - u) * (1 - u); // fast at first, then settling
      const y = d.from + (WATER_LEVEL - d.from) * k;
      d.body.mesh.position.y = y - d.from; d.body.uniforms.level.value = y; d.body.level = y;
    }
  };
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

  const dry = [], dryPool = [];
  const handle = {
    system, bodies, stats, level: WATER_LEVEL, real: true, drains, dry,
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
      // hulls as drawn this frame (bob, pitch, roll, berth): no water inside them (art/water/hulls.js)
      dry.length = 0;
      for (const v of world.vehicles || []) {
        if (v.def?.kind !== 'boat') continue;
        const d = dryHullOf(v, dryPool[dry.length] ||= { inv: null, plan: null, x: 0, z: 0 });
        if (d) dry.push(d);
      }
      system.setDryHulls(dry);
      if (drains.length) drainStep(dt);
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
