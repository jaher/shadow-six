/**
 * Fish schools (PROGRESS step 4f, "make sure the sea has some fish"): pure, deterministic boids simulation on SIM
 * time (frozen while paused, no gameplay effect, never saved). Rendering lives in src/art/fish-model.js and the
 * per-mission director in src/render/ambient-life.js.
 *
 *  - Species per theatre and body (`fishPlan`): Norway fjords herring / saithe (pollock) schools + cod near the bed;
 *    temperate / Channel harbours and coasts thick-lipped grey mullet under piers + European sea bass; rivers brown
 *    trout and grayling shoals holding station head-upstream (rheotaxis); lakes and ponds perch shoals + a few trout.
 *  - Behaviour: each school has a goal that wanders through its habitat (depth preference, shore / pier seeking via
 *    the water bake's shore distance, which counts piers and rocks), members steer with cohesion / alignment /
 *    separation, keep to their depth band, never leave the wet mask or go under shore ice.
 *  - Fright: threats (diver, swimmer, boat: continuous) and impulses (splash, shot into water, explosion) make fish
 *    burst away (C-start, schools flash-expand, then regroup); underwater blasts stun a few that roll belly-up and
 *    float at the surface for a few seconds before they recover and dive.
 * @module world/fish-sim
 */

/**
 * Species: body length range (m), group size, cruise / burst speed (m/s), depth band as a fraction of the water
 * column [top, bottom] with a minimum clearance, shore preference (0 open water … 1 hugs banks / piers, `shoreD`
 * = preferred distance m), rheotaxis (hold station against the current), cohesion, colours (sRGB hex:
 * back, flank, belly), pattern (0 plain, 1 perch bars, 2 trout spots, 3 cod mottle, 4 saithe lateral line,
 * 5 bass/mullet stripes), body depth / width ratios, tail fork, flank mirror metalness; `flash` = feeding flank
 * flashes per fish per minute (a roll that turns the silver flank to the sky), `rise` = surface rises per fish per
 * minute (trout / grayling taking flies, mullet and herring dimpling the surface: "nervous water").
 */
export const FISH_SPECIES = {
  herring: { len: [0.29, 0.37], group: [45, 75], cruise: 0.42, burst: 2.4, band: [0.15, 0.6], shore: 0.05, shoreD: 8,
    coh: 1.2, align: 1.1, sepK: 1.1, back: 0x1b2f3a, flank: 0xb9c6cc, belly: 0xeef2f2, pattern: 0, depthR: 0.2, widthR: 0.11, fork: 0.9, metal: 0.75, flash: 10, rise: 0.25 },
  pollock: { len: [0.5, 0.75], group: [10, 16], cruise: 0.5, burst: 2.6, band: [0.2, 0.65], shore: 0.35, shoreD: 4,
    coh: 1, align: 1, sepK: 1.3, back: 0x1c2420, flank: 0x6d7a70, belly: 0xc9cdc4, pattern: 4, depthR: 0.2, widthR: 0.11, fork: 0.55, metal: 0.4, flash: 5, rise: 0 },
  cod: { len: [0.55, 0.9], group: [2, 4], cruise: 0.28, burst: 1.9, band: [0.72, 0.95], shore: 0.25, shoreD: 4,
    coh: 0.5, align: 0.4, sepK: 1.6, back: 0x453d2a, flank: 0x8b8258, belly: 0xd8d6c4, pattern: 3, depthR: 0.19, widthR: 0.13, fork: 0.05, metal: 0.1, flash: 1, rise: 0 },
  mullet: { len: [0.32, 0.46], group: [14, 24], cruise: 0.4, burst: 2.2, band: [0.1, 0.4], shore: 0.8, shoreD: 2,
    coh: 1, align: 1, sepK: 1.3, back: 0x273036, flank: 0x9aa4a6, belly: 0xe2e4e0, pattern: 5, depthR: 0.19, widthR: 0.13, fork: 0.45, metal: 0.5, flash: 8, rise: 0.6 },
  seabass: { len: [0.4, 0.6], group: [4, 7], cruise: 0.45, burst: 2.6, band: [0.3, 0.8], shore: 0.6, shoreD: 3,
    coh: 0.9, align: 0.9, sepK: 1.4, back: 0x28333b, flank: 0xaab4bb, belly: 0xeceeec, pattern: 0, depthR: 0.22, widthR: 0.11, fork: 0.3, metal: 0.6, flash: 6, rise: 0.1 },
  trout: { len: [0.28, 0.42], group: [1, 2], cruise: 0.35, burst: 2.2, band: [0.45, 0.85], shore: 0.55, shoreD: 2.5, rheo: true,
    coh: 0.3, align: 0.2, sepK: 2, back: 0x33321e, flank: 0xa39a6a, belly: 0xe4dcc0, pattern: 2, depthR: 0.21, widthR: 0.11, fork: 0.1, metal: 0.2, flash: 3, rise: 1.6 },
  grayling: { len: [0.28, 0.4], group: [4, 8], cruise: 0.4, burst: 2.3, band: [0.4, 0.8], shore: 0.3, shoreD: 4, rheo: true,
    coh: 0.6, align: 0.5, sepK: 1.8, back: 0x2a3032, flank: 0x9aa2a6, belly: 0xe2e4e0, pattern: 0, depthR: 0.2, widthR: 0.11, fork: 0.5, metal: 0.45, flash: 5, rise: 1 },
  perch: { len: [0.18, 0.28], group: [8, 14], cruise: 0.3, burst: 1.8, band: [0.35, 0.85], shore: 0.7, shoreD: 2,
    coh: 1, align: 0.8, sepK: 1.3, back: 0x27301c, flank: 0x9ea24e, belly: 0xe4e2c8, pattern: 1, depthR: 0.27, widthR: 0.11, fork: 0.25, metal: 0.15, flash: 2, rise: 0.3 },
};

/** Habitat → [species, number of groups per 1000 m² of water, max groups]. */
export const FISH_HABITATS = {
  fjord: [['herring', 0.9, 3], ['pollock', 0.9, 3], ['cod', 1.4, 4]],
  sea: [['mullet', 1.1, 4], ['seabass', 1, 3]],
  river: [['trout', 10, 18], ['grayling', 3, 5]],
  lake: [['perch', 3, 6], ['trout', 1.2, 3]],
};

/** Habitat of a water body: fjord preset / snow seas → fjord; other seas + harbours → sea; rivers; lakes and ponds. */
export function fishHabitat(body, theater) {
  if (body.frozen) return null;
  if (body.habitat && FISH_HABITATS[body.habitat]) return body.habitat;
  if (body.type === 'river') return 'river';
  if (body.preset === 'fjord' || (body.type === 'sea' && theater === 'snow')) return 'fjord'; // Norway: still fjords are sea arms
  if (body.type === 'sea' || body.preset === 'harbor' || body.preset === 'sea') return 'sea';
  return 'lake';
}

/** Deterministic LCG in [0, 1). */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Quality → population scale (low keeps a few so every preset has fish). */
export const FISH_DENSITY = { low: 0.45, medium: 0.7, high: 1, ultra: 1.25 };

/**
 * Plan the schools of a map: one entry per group {sp, habitat, body, n, x, z}.
 * @param {{type:string, preset?:string, frozen?:boolean, spots:number[][], area:number}[]} bodies spots = [x, z] of
 *   open-water cells (enough depth), area in m²
 * @param {string} theater @param {number} [seed] @param {string} [quality] @param {number} [density] mission scale 0..2
 */
export function fishPlan(bodies, theater, seed = 7, quality = 'high', density = 1) {
  const rnd = makeRng(seed ^ 0x5f3759df), out = [], dens = (FISH_DENSITY[quality] ?? 1) * Math.max(0, Math.min(2, density ?? 1));
  bodies.forEach((b, bi) => {
    const hab = fishHabitat(b, theater);
    if (!hab || !b.spots?.length) return;
    for (const [sp, per1k, max] of FISH_HABITATS[hab]) {
      const S = FISH_SPECIES[sp];
      const want = Math.max(b.area > 150 ? 1 : 0, Math.min(max, Math.round((b.area / 1000) * per1k * dens)));
      for (let k = 0; k < want; k++) {
        const [x, z] = b.spots[(rnd() * b.spots.length) | 0];
        const n = Math.max(1, Math.round((S.group[0] + rnd() * (S.group[1] - S.group[0])) * (S.group[1] > 8 ? Math.max(0.6, dens) : 1)));
        out.push({ sp, habitat: hab, body: bi, n, x, z });
      }
    }
  });
  return out;
}

const TAU = Math.PI * 2;
const wrapA = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * The schools of one mission. `water.sample(x, z)` → {depth, shore, flow:[vx,vz], level, ice} | null (the water
 * system's gameplay query). All motion runs on the time passed to `step` (sim time deltas).
 */
export class FishSim {
  /** @param {object[]} plan fishPlan() output @param {{sample:Function}} water @param {number} [seed] */
  constructor(plan, water, seed = 11) {
    this.water = water;
    this.rnd = makeRng(seed);
    this.schools = []; this.fish = [];
    this.threats = []; this.impulses = [];
    /** Surface rings to hand to the water ripples (rises, dimples): [{x, z, s}] — drained by the director. */
    this.rings = [];
    this.stats = { stunned: 0, scared: 0, blasts: 0 };
    this.t = 0;
    for (const p of plan) this._spawn(p);
  }

  _spawn(p) {
    const S = FISH_SPECIES[p.sp], r = this.rnd;
    const s0 = this.water.sample(p.x, p.z);
    if (!s0 || s0.ice) return;
    const sch = { sp: p.sp, S, gx: p.x, gz: p.z, gh: r() * TAU, eval: r() * 0.5, alarm: 0, members: [], relie: 4 + r() * 10,
      lx: p.x, lz: p.z, cx: p.x, cz: p.z, mvx: 0, mvz: 0 };
    this.schools.push(sch);
    const spread = Math.sqrt(p.n) * S.len[1] * 0.9;
    for (let i = 0; i < p.n; i++) {
      const len = S.len[0] + r() * (S.len[1] - S.len[0]);
      const a = r() * TAU, d = spread * Math.sqrt(r());
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const f = { sp: p.sp, S, sch, len, x, z, y: s0.level - this._bandY(S, s0.depth, len, r()), vx: Math.cos(sch.gh) * S.cruise * 0.5,
        vy: 0, vz: Math.sin(sch.gh) * S.cruise * 0.5, yaw: sch.gh, pitch: 0, roll: 0, bend: 0, phase: r() * TAU, amp: 0.1, beat: 1,
        fright: 0, stun: 0, rec: 0, pref: r(), chk: r() * 0.2, depth: s0.depth, shore: s0.shore, level: s0.level, fx: 0, fz: 0, bad: 0,
        ox: (r() - 0.5) * spread, oz: (r() - 0.5) * spread, flashT: r() * 8, fl: 0, flA: 0, riseT: 5 + r() * 60 / Math.max(0.05, S.rise || 0.05), rise: 0 };
      sch.members.push(f); this.fish.push(f);
    }
  }

  /** Target depth below the surface (m) for a fraction `u` inside the species band. */
  _bandY(S, depth, len, u) {
    const lo = Math.min(0.1 + len * 0.25, depth * 0.5), hi = Math.max(lo, depth - 0.08 - len * S.depthR * 0.6);
    return clamp(depth * (S.band[0] + (S.band[1] - S.band[0]) * u), lo, hi);
  }

  /** Habitat score of a point for a species (−1 = unusable). */
  _score(S, x, z) {
    const s = this.water.sample(x, z);
    if (!s || s.ice || s.depth < 0.22) return -1;
    const dz = Math.min(1, s.depth / (S.band[1] > 0.7 ? 0.9 : 0.5));
    const sh = S.shore * Math.exp(-((s.shore - S.shoreD) ** 2) / (2 * (S.shoreD * 0.8 + 1) ** 2)) + (1 - S.shore) * Math.min(1, s.shore / S.shoreD);
    return 0.5 * dz + sh;
  }

  /** Continuous threats this frame: [{x, z, r, s}] (divers, swimmers, boats). */
  setThreats(list) { this.threats = list || []; }

  /**
   * A one-off disturbance: splash, bullet, grenade. `blast` = underwater explosion → up to `stun` fish inside
   * 0.6 r roll belly-up and float for a few seconds.
   */
  impulse(x, z, r, s = 1, o = {}) {
    this.impulses.push({ x, z, r, s, life: 1.2 });
    if (!o.blast) return 0;
    this.stats.blasts++;
    let left = o.stun ?? 3;
    const near = this.fish.filter((f) => !f.stun && (f.x - x) ** 2 + (f.z - z) ** 2 < (r * 0.6) ** 2)
      .sort((a, b) => ((a.x - x) ** 2 + (a.z - z) ** 2) - ((b.x - x) ** 2 + (b.z - z) ** 2));
    for (const f of near) {
      if (left-- <= 0) break;
      f.stun = 4 + this.rnd() * 5; f.rec = 0; this.stats.stunned++;
    }
    return Math.min(near.length, o.stun ?? 3);
  }

  /** Advance by dt seconds of sim time (sub-stepped). `drift(x, z)` → [vx, vz] surface wind drift for floaters. */
  step(dt, drift = null) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.5);
    const n = Math.ceil(dt / 0.05), h = dt / n;
    for (let k = 0; k < n; k++) this._step(h, drift);
  }

  _schoolStep(sch, h) {
    const S = sch.S, r = this.rnd;
    // centroid + mean velocity of the members that swim
    let cx = 0, cz = 0, vx = 0, vz = 0, m = 0;
    for (const f of sch.members) if (!f.stun) { cx += f.x; cz += f.z; vx += f.vx; vz += f.vz; m++; }
    if (m) { sch.cx = cx / m; sch.cz = cz / m; sch.mvx = vx / m; sch.mvz = vz / m; }
    sch.alarm = Math.max(0, sch.alarm - h * 0.35);
    if (S.rheo) { // trout: hold a lie; now and then drift to another one nearby (feeding position)
      sch.relie -= h;
      if (sch.relie <= 0) {
        sch.relie = 8 + r() * 16;
        let best = -1, bx = sch.lx, bz = sch.lz;
        for (let k = 0; k < 6; k++) {
          const a = r() * TAU, d = 1 + r() * 4, x = sch.lx + Math.cos(a) * d, z = sch.lz + Math.sin(a) * d, sc = this._score(S, x, z);
          if (sc > best) { best = sc; bx = x; bz = z; }
        }
        if (best > 0) { sch.lx = bx; sch.lz = bz; }
      }
      sch.gx = sch.lx; sch.gz = sch.lz;
      return;
    }
    // everyone else: the school goal wanders through the habitat, turning away from poor water
    const sp = S.cruise * (0.75 + 0.6 * sch.alarm);
    sch.gh = wrapA(sch.gh + (r() - 0.5) * 1.4 * h);
    sch.eval -= h;
    if (sch.eval <= 0) {
      sch.eval = 0.6 + r() * 0.4;
      const look = 2.5 + S.len[1] * 4;
      const here = this._score(S, sch.gx + Math.cos(sch.gh) * look, sch.gz + Math.sin(sch.gh) * look);
      if (here < 0.55) {
        let best = here, bh = sch.gh;
        for (let k = 1; k <= 8; k++) {
          const a = sch.gh + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
          const sc = this._score(S, sch.gx + Math.cos(a) * look, sch.gz + Math.sin(a) * look);
          if (sc > best + 0.02) { best = sc; bh = a; }
        }
        sch.gh = best < 0 ? wrapA(sch.gh + Math.PI * (0.6 + 0.4 * r())) : bh;
      }
    }
    // the goal never runs away from the school
    const lag = Math.hypot(sch.gx - sch.cx, sch.gz - sch.cz), slow = lag > 3 ? 0.2 : 1;
    const ng = this.water.sample(sch.gx + Math.cos(sch.gh) * sp * h * slow, sch.gz + Math.sin(sch.gh) * sp * h * slow);
    if (ng && !ng.ice && ng.depth > 0.22) { sch.gx += Math.cos(sch.gh) * sp * h * slow; sch.gz += Math.sin(sch.gh) * sp * h * slow; }
    else sch.gh = wrapA(sch.gh + Math.PI * 0.5 + r());
  }

  _step(h, drift) {
    this.t += h;
    for (const sch of this.schools) this._schoolStep(sch, h);
    for (const im of this.impulses) im.life -= h;
    if (this.impulses.length) this.impulses = this.impulses.filter((im) => im.life > 0);
    let scared = 0;
    for (const f of this.fish) {
      if (f.stun > 0 || f.rec > 0) { this._stunStep(f, h, drift); continue; }
      scared += this._fishStep(f, h) ? 1 : 0;
    }
    this.stats.scared = scared;
  }

  /** Fright vector from threats + impulses: [ax, az, strength]. */
  _fright(f) {
    let ax = 0, az = 0, fr = 0;
    const add = (T, k) => {
      const ex = f.x - T.x, ez = f.z - T.z, d2 = ex * ex + ez * ez;
      if (d2 >= T.r * T.r) return;
      const d = Math.sqrt(d2) + 0.01, w = (1 - d / T.r) * T.s * k;
      ax += (ex / d) * w; az += (ez / d) * w; fr = Math.max(fr, w);
    };
    for (const T of this.threats) add(T, 1);
    for (const T of this.impulses) add(T, Math.min(1, T.life * 2));
    return [ax, az, fr];
  }

  _fishStep(f, h) {
    const S = f.S, sch = f.sch, W = this.water;
    f.chk -= h;
    if (f.chk <= 0) { // 5 Hz water query: current, depth band, and a look-ahead for banks / ice / shallows
      f.chk = 0.2;
      const here = W.sample(f.x, f.z);
      if (here) { f.depth = here.depth; f.shore = here.shore; f.level = here.level; f.fx = here.flow[0]; f.fz = here.flow[1]; }
      const la = 0.5 + f.len, sp = Math.hypot(f.vx, f.vz) + 1e-3;
      const s = W.sample(f.x + (f.vx / sp) * la, f.z + (f.vz / sp) * la);
      f.bad = !s || s.ice || s.depth < 0.2 + S.depthR * f.len ? 1 : 0;
      if (f.bad || !here) {
        const e = 0.7, sh = (x, z) => { const q = W.sample(x, z); return q && !q.ice ? q.shore + q.depth : -1; };
        const gx = sh(f.x + e, f.z) - sh(f.x - e, f.z), gz = sh(f.x, f.z + e) - sh(f.x, f.z - e), g = Math.hypot(gx, gz);
        if (g > 1e-4) { f.ax = gx / g; f.az = gz / g; } else { f.ax = -f.vx / sp; f.az = -f.vz / sp; }
        f.bad = 1;
      }
    }
    let dx, dz;
    const cr = S.cruise * (0.8 + 0.4 * f.pref);
    if (S.rheo) { // hold the lie head-upstream: ground velocity towards the lie (the current is stemmed by swimming)
      const t = this.t * 0.4 + f.pref * 9;
      dx = (sch.gx + f.ox * 0.8 + Math.sin(t) * 0.25 - f.x) * 0.5; dz = (sch.gz + f.oz * 0.8 + Math.cos(t * 1.3) * 0.25 - f.z) * 0.5;
    } else {
      dx = (sch.gx + f.ox * 0.45 - f.x) * 0.35 + (sch.cx - f.x) * 0.25 * S.coh + sch.mvx * 0.8 * S.align;
      dz = (sch.gz + f.oz * 0.45 - f.z) * 0.35 + (sch.cz - f.z) * 0.25 * S.coh + sch.mvz * 0.8 * S.align;
      const sep = f.len * S.sepK;
      for (const o of sch.members) {
        if (o === f || o.stun) continue;
        const ex = f.x - o.x, ez = f.z - o.z, d2 = ex * ex + ez * ez;
        if (d2 > sep * sep || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), w = ((sep - d) / sep) * 2 * cr;
        dx += (ex / d) * w; dz += (ez / d) * w;
      }
      const L = Math.hypot(dx, dz);
      if (L > 1e-4) { const k = Math.min(1.5, Math.max(0.35, L / cr)) * cr / L; dx *= k; dz *= k; }
    }
    const [ax, az, fr] = this._fright(f);
    if (fr > 0.02) {
      f.fright = Math.max(f.fright, Math.min(1, fr * 1.6));
      sch.alarm = Math.max(sch.alarm, f.fright * 0.8);
      if (fr > 0.3 && !S.rheo) sch.gh = Math.atan2(az, ax);
    }
    f.fright = Math.max(0, f.fright - h * 0.55);
    if (f.fright > 0.05) {
      const L = Math.hypot(ax, az);
      if (L > 1e-4) { const k = f.fright; dx = dx * (1 - k) + (ax / L) * S.burst * k; dz = dz * (1 - k) + (az / L) * S.burst * k; }
      else { dx *= 1 + f.fright; dz *= 1 + f.fright; }
    }
    if (f.bad) { dx = dx * 0.25 + f.ax * cr * 1.6; dz = dz * 0.25 + f.az * cr * 1.6; }
    // ground velocity = swimming + current (trout already aim at a ground target)
    const tgx = S.rheo ? dx : dx + f.fx * 0.85, tgz = S.rheo ? dz : dz + f.fz * 0.85;
    const acc = Math.min(1, (f.fright > 0.3 ? 7 : 1.6) * h);
    f.vx += (tgx - f.vx) * acc; f.vz += (tgz - f.vz) * acc;
    const nx = f.x + f.vx * h, nz = f.z + f.vz * h;
    if (!f.bad || W.sample(nx, nz)) { f.x = nx; f.z = nz; }
    // depth band (scared fish sound a little deeper), never through the bed or the surface
    const bedY = f.level - f.depth;
    let ty = f.level - this._bandY(S, f.depth, f.len, f.pref) - (f.fright > 0.3 ? 0.12 : 0);
    if (S.rise && f.fright < 0.1) { // surface rise: up to the film, a ring, back down
      f.riseT -= h;
      if (f.riseT <= 0) { f.riseT = (40 + this.rnd() * 80) / S.rise; f.rise = 0.9; }
      if (f.rise > 0) {
        const was = f.rise; f.rise -= h;
        if (was > 0.35) ty = f.level - 0.05;
        if (was > 0.35 && f.rise <= 0.35) this.rings.push({ x: f.x + Math.cos(f.yaw) * f.len * 0.4, z: f.z + Math.sin(f.yaw) * f.len * 0.4, s: 0.5 + f.len });
      }
    }
    ty = clamp(ty, bedY + 0.04 + f.len * S.depthR * 0.5, f.level - 0.07);
    f.vy += ((ty - f.y) * (f.rise > 0.35 ? 4 : 0.9) - f.vy) * Math.min(1, (f.rise > 0 ? 8 : 2.5) * h);
    f.y = clamp(f.y + f.vy * h, bedY + 0.03, f.level - 0.05);
    this._orient(f, h, f.vx - f.fx, f.vz - f.fz);
    return f.fright > 0.2;
  }

  /** Heading from the WATER-relative velocity (trout in a current face upstream), body bend, tail beat. */
  _orient(f, h, rx, rz) {
    const rs = Math.hypot(rx, rz), S = f.S;
    const ty = rs > 0.04 ? Math.atan2(rz, rx) : f.yaw;
    const mt = (f.fright > 0.3 ? 14 : 3.2) * h, turn = clamp(wrapA(ty - f.yaw), -mt, mt);
    f.yaw = wrapA(f.yaw + turn);
    f.bend += (clamp(turn / h / 10, -1, 1) - f.bend) * Math.min(1, 5 * h);
    f.pitch = clamp(Math.atan2(f.vy, Math.max(rs, 0.1)) * 0.8, -0.5, 0.5);
    // feeding flashes: a quick roll turns the guanine-mirror flank up to the sky (the glint that gives a school away)
    f.flashT -= h;
    if (f.flashT <= 0) { f.flashT = (30 + this.rnd() * 60) / Math.max(0.2, S.flash); f.fl = 0.35; f.flA = (this.rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * this.rnd()); }
    let flr = 0;
    if (f.fl > 0) { f.fl -= h; flr = f.flA * Math.sin(Math.PI * Math.max(0, f.fl) / 0.35); }
    f.roll += (-f.bend * 0.3 + flr - f.roll) * Math.min(1, 14 * h);
    f.beat = clamp(rs / (0.62 * f.len), 0.7, 14);
    f.phase = (f.phase + TAU * f.beat * h) % TAU;
    f.amp = clamp(0.035 + 0.05 * rs / S.cruise, 0.035, 0.12) * (1 + 0.4 * f.fright); // tail tip ≈ 0.1–0.2 L peak to peak
  }

  /** Stunned: roll belly-up, float to just under the surface, drift with current + wind, twitch; then recover. */
  _stunStep(f, h, drift) {
    if (f.stun > 0) {
      f.stun -= h;
      f.roll += (Math.PI - f.roll) * Math.min(1, 2.5 * h);
      f.y += (f.level - 0.035 - f.y) * Math.min(1, 0.9 * h);
      const d = drift ? drift(f.x, f.z) : null;
      f.vx += (f.fx + (d ? d[0] : 0) - f.vx) * Math.min(1, h); f.vz += (f.fz + (d ? d[1] : 0) - f.vz) * Math.min(1, h);
      if (this.water.sample(f.x + f.vx * h, f.z + f.vz * h)) { f.x += f.vx * h; f.z += f.vz * h; }
      f.bend *= 1 - Math.min(1, 3 * h); f.pitch *= 1 - Math.min(1, 2 * h);
      const tw = Math.sin(this.t * 1.7 + f.pref * 20) > 0.93; // weak twitches
      f.beat = tw ? 7 : 0.3; f.amp = tw ? 0.2 : 0.04;
      f.phase = (f.phase + TAU * f.beat * h) % TAU;
      if (f.stun <= 0) f.rec = 1.2;
      return;
    }
    f.rec -= h;
    f.roll += (0 - f.roll) * Math.min(1, 5 * h);
    f.vy = -0.35; f.y = Math.max(f.level - f.depth + 0.05, f.y + f.vy * h);
    f.beat = 10; f.amp = 0.2; f.phase = (f.phase + TAU * f.beat * h) % TAU;
    if (f.rec <= 0) { f.rec = 0; f.fright = 0.9; f.chk = 0; }
  }

  /** Number of fish currently floating stunned. */
  get stunned() { let n = 0; for (const f of this.fish) if (f.stun > 0) n++; return n; }
}
