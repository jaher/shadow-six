/**
 * Ambient birds (PROGRESS step 4f extras): herring gulls wheeling over harbours / coasts / fjords (land on piers or
 * the water, flush at gunshots), crows in open fields (hooded crows in Norway; walk and peck, flush when anyone
 * comes close), ducks on ponds and quiet rivers (mallards; common eiders on northern seas). Pure and deterministic
 * on SIM time (frozen while paused), wind-aware: every bird flies through the air mass (ground velocity = air
 * velocity + wind at its height, so gulls crab and hang into a gale), lands and settles facing into the wind, and
 * sitting ducks drift downwind. No gameplay effect. Rendering: src/art/bird-model.js; director:
 * src/render/ambient-life.js.
 * @module world/bird-sim
 */
import { makeRng, fishHabitat } from './fish-sim.js';

/**
 * span/len (m), cruise airspeed (m/s), flap frequency (Hz), glide share (0 flaps all the time … 1 soars), altitude
 * band (m), wary radius (m: a unit moving closer flushes it), noise flush radius (m).
 */
export const BIRD_SPECIES = {
  gull: { span: 1.42, len: 0.6, air: 8.5, flapHz: 2.9, glide: 0.8, alt: [7, 15], wary: 7, flush: 45 },
  crow: { span: 0.95, len: 0.47, air: 9.5, flapHz: 3.8, glide: 0.25, alt: [3, 6], wary: 11, flush: 55 },
  mallard: { span: 0.9, len: 0.56, air: 13, flapHz: 5.6, glide: 0.05, alt: [4, 8], wary: 10, flush: 50 },
  eider: { span: 1.0, len: 0.62, air: 13, flapHz: 4.9, glide: 0.05, alt: [3, 6], wary: 12, flush: 50 },
};

const TAU = Math.PI * 2;
const wrapA = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Plan the birds of a map.
 * @param {{theater:string, night?:boolean, bodies:{type:string, preset?:string, frozen?:boolean, spots:number[][],
 *   area:number, velocity?:number}[], fields:number[][], perches:{x:number,y:number,z:number}[]}} m
 * @returns {{sp:string, x:number, z:number, n:number, kind:'gull'|'crow'|'duck', body?:number}[]}
 */
export function birdPlan(m, seed = 5, quality = 'high') {
  const rnd = makeRng(seed ^ 0x2545f491), out = [], k = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const th = m.theater, pick = (a) => a[(rnd() * a.length) | 0];
  (m.bodies || []).forEach((b, bi) => {
    if (!b.spots?.length || th === 'desert') return;
    const hab = fishHabitat({ ...b, frozen: false }, th), sea = hab === 'sea' || hab === 'fjord';
    if (sea || (b.type === 'river' && b.area > 900) || (th === 'coast' && b.area > 300)) {
      const n = Math.round(clamp(b.area / (sea ? 450 : 900), 2, sea ? 9 : 3) * k);
      if (n > 0) { const [x, z] = pick(b.spots); out.push({ kind: 'gull', sp: 'gull', x, z, n, body: bi }); }
    }
    if (b.frozen) return;
    const eider = sea && th === 'snow', calm = b.type !== 'river' || (b.velocity ?? 0) < 1.1;
    if ((eider || (!sea && calm)) && b.area > 120) {
      const n = Math.round((eider ? 4 + rnd() * 4 : 2 + rnd() * 3) * Math.max(0.6, k));
      const [x, z] = pick(b.spots);
      out.push({ kind: 'duck', sp: eider ? 'eider' : 'mallard', x, z, n, body: bi });
    }
  });
  if (!m.night && m.fields?.length > 60 && th !== 'desert') {
    const groups = m.fields.length > 1500 ? 2 : 1;
    for (let g = 0; g < groups; g++) { const [x, z] = pick(m.fields); out.push({ kind: 'crow', sp: 'crow', x, z, n: Math.round((3 + rnd() * 3) * Math.max(0.6, k)) }); }
  }
  return out;
}

/** Wind speed factor at height y over the 10 m reference (log profile, z0 = 3 cm). */
export const windAtHeight = (y) => clamp(Math.log(Math.max(0.3, y) / 0.03) / Math.log(10 / 0.03), 0.4, 1.12);

/**
 * The birds of one mission. `env`: {wind(x, z, out2), water(x, z) → sample|null, ground(x, z) → y,
 * fields: [x, z][], perches: {x, y, z}[], splash?(x, z, size), ripple?(x, z, s), flush?(bird)}.
 */
export class BirdSim {
  constructor(plan, env, seed = 17) {
    this.env = env; this.rnd = makeRng(seed);
    this.birds = []; this.threats = []; this.t = 0;
    this.stats = { flushes: 0, landings: 0, splashes: 0 };
    this._w = [0, 0];
    for (const p of plan) for (let i = 0; i < p.n; i++) this._spawn(p, i);
  }

  _spawn(p, i) {
    const S = BIRD_SPECIES[p.sp], r = this.rnd, e = this.env;
    const b = { sp: p.sp, kind: p.kind, S, hx: p.x, hz: p.z, x: p.x + (r() - 0.5) * 4, z: p.z + (r() - 0.5) * 4, y: 0, vx: 0, vy: 0, vz: 0,
      yaw: r() * TAU, pitch: 0, bank: 0, st: '', tt: 0, ph: r() * TAU, amp: 0, fold: 1, dab: 0, peck: 0, bout: 0,
      cx: p.x, cz: p.z, R: 7 + r() * 8, th: r() * TAU, dir: r() < 0.5 ? -1 : 1, alt: S.alt[0] + r() * (S.alt[1] - S.alt[0]),
      tx: 0, ty: 0, tz: 0, perch: null, pref: r(), body: p.body };
    this.birds.push(b);
    if (p.kind === 'gull') { // most on the wing, some sitting on a pier or on the water
      const pc = this._freePerch(b);
      if (i % 3 === 2 && pc) this._settle(b, 'perched', pc);
      else { b.y = b.alt; b.st = 'soar'; b.tt = 20 + r() * 40; b.fold = 0; }
    } else if (p.kind === 'duck') {
      const s = e.water(b.x, b.z);
      if (!s) { b.x = p.x; b.z = p.z; }
      this._settle(b, 'swim', null);
    } else {
      b.x = p.x + (r() - 0.5) * 6; b.z = p.z + (r() - 0.5) * 6;
      this._settle(b, 'ground', null);
    }
  }

  _freePerch(b) {
    const P = (this.env.perches || []).filter((q) => !q.bird && (q.x - b.hx) ** 2 + (q.z - b.hz) ** 2 < 60 * 60);
    return P.length ? P[(this.rnd() * P.length) | 0] : null;
  }

  _settle(b, st, perch) {
    const e = this.env;
    b.st = st; b.tt = st === 'ground' ? 8 + this.rnd() * 20 : 15 + this.rnd() * 35;
    b.vx = b.vy = b.vz = 0; b.fold = 1; b.amp = 0; b.bank = 0; b.pitch = 0;
    if (perch) { perch.bird = b; b.perch = perch; b.x = perch.x; b.z = perch.z; b.y = perch.y; }
    else if (st === 'swim' || st === 'float') b.y = e.water(b.x, b.z)?.level ?? b.y;
    else b.y = e.ground(b.x, b.z);
  }

  /** Units / vehicles that make birds nervous this frame: [{x, z, moving}]. */
  setThreats(list) { this.threats = list || []; }

  /** A gunshot / explosion / loud noise at (x, z): everything inside radius r (× species flush) takes off. */
  noise(x, z, r = 40) {
    let n = 0;
    for (const b of this.birds) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > Math.min(r, b.S.flush * 1.5)) continue;
      if (this._flee(b, x, z)) n++;
    }
    return n;
  }

  _flee(b, x, z) {
    const was = b.st, grounded = was === 'perched' || was === 'float' || was === 'swim' || was === 'ground' || was === 'final';
    if (was === 'flee' || was === 'takeoff') return false;
    if (b.perch) { b.perch.bird = null; b.perch = null; }
    const a = Math.atan2(b.z - z, b.x - x) + (this.rnd() - 0.5) * 0.8, d = 25 + this.rnd() * 25;
    b.tx = b.x + Math.cos(a) * d; b.tz = b.z + Math.sin(a) * d; b.ty = b.S.alt[1] + 3;
    b.st = 'flee'; b.tt = 4 + this.rnd() * 3; b.fold = Math.min(b.fold, 0.6);
    if (grounded) {
      this.stats.flushes++; this.env.flush?.(b);
      if (b.kind === 'duck' || was === 'float') { this.env.splash?.(b.x, b.z, 0.35); this.stats.splashes++; }
      b.vy = b.kind === 'duck' && b.sp === 'mallard' ? 3.2 : 1.8; // mallards spring straight up, eiders patter off
    }
    return grounded;
  }

  step(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.5);
    const n = Math.ceil(dt / 0.05), h = dt / n;
    for (let k = 0; k < n; k++) { this.t += h; for (const b of this.birds) this._bird(b, h); }
  }

  /** Wind at the bird's height → this._w. */
  _wind(b) {
    const w = this._w; this.env.wind(b.x, b.z, w);
    // birds keep low / in the lee when it blows harder than they can fly: cap at ~1.05 × cruise airspeed
    const k = windAtHeight(b.y - (b.gy ?? 0) + 0.3), sp = Math.hypot(w[0], w[1]) * k, cap = b.S.air * 1.05;
    const m = sp > cap ? (k * cap) / sp : k;
    w[0] *= m; w[1] *= m; return w;
  }

  /** Fly towards (tx, ty, tz) at ground speed `spd` THROUGH the air mass; returns the horizontal distance. */
  _fly(b, h, tx, ty, tz, spd, climb = 2.5) {
    const W = this._wind(b), S = b.S;
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz) + 1e-6;
    let ax = (dx / d) * spd - W[0], az = (dz / d) * spd - W[1];
    const A = Math.hypot(ax, az) + 1e-6, hi = S.air * 1.35, lo = S.air * 0.5;
    if (A > hi) { ax *= hi / A; az *= hi / A; } else if (A < lo && b.st !== 'final') { ax *= lo / A; az *= lo / A; }
    const k = Math.min(1, 2 * h);
    b.vx += (ax + W[0] - b.vx) * k; b.vz += (az + W[1] - b.vz) * k;
    b.vy += (clamp((ty - b.y) * 0.8, -2.5, climb) - b.vy) * k;
    b.x += b.vx * h; b.z += b.vz * h; b.y += b.vy * h;
    const g = this.env.ground(b.x, b.z) + 0.25;
    if (b.y < g && b.st !== 'final') { b.y = g; b.vy = Math.max(0, b.vy); }
    // heading = air velocity (crabbing into the wind), coordinated bank, climb pitch
    const ty0 = Math.atan2(az, ax), mt = 2.6 * h, turn = clamp(wrapA(ty0 - b.yaw), -mt, mt);
    b.yaw = wrapA(b.yaw + turn);
    b.bank += (clamp(Math.atan((turn / h) * Math.hypot(ax, az) / 9.81), -0.75, 0.75) - b.bank) * Math.min(1, 4 * h);
    b.pitch += (clamp(Math.atan2(b.vy, Math.hypot(ax, az)) * 0.6, -0.35, 0.5) - b.pitch) * Math.min(1, 4 * h);
    return d;
  }

  /** Wing beat: amplitude eases to `target`, the phase runs at the species rate (× hz). */
  _wings(b, h, target, hz = 1) {
    b.amp += (target - b.amp) * Math.min(1, 5 * h);
    b.fold += (0 - b.fold) * Math.min(1, 6 * h);
    b.ph = (b.ph + TAU * b.S.flapHz * hz * h * (b.amp > 0.02 ? 1 : 0)) % TAU;
  }

  /** Upwind heading (birds settle and take off facing into the wind). */
  _upwind(b) { const w = this._w; this.env.wind(b.x, b.z, w); return Math.hypot(w[0], w[1]) > 0.3 ? Math.atan2(-w[1], -w[0]) : b.yaw; }

  _nervous(b) {
    const R = b.S.wary;
    for (const T of this.threats) if (Math.abs(T.x - b.x) < R && Math.abs(T.z - b.z) < R && Math.hypot(T.x - b.x, T.z - b.z) < R * (T.moving ? 1 : 0.6)) return T;
    return null;
  }

  /** Choose where to land: a free pier post / deck (gulls), open water (gulls, ducks), a field spot (crows). */
  _pickLanding(b) {
    const r = this.rnd, e = this.env;
    if (b.kind === 'gull') {
      const pc = r() < 0.6 ? this._freePerch(b) : null;
      if (pc) { pc.bird = b; b.perch = pc; return [pc.x, pc.y, pc.z, 'perched']; }
    }
    if (b.kind === 'crow') {
      const F = e.fields || [];
      for (let k = 0; k < 8 && F.length; k++) {
        const [x, z] = F[(r() * F.length) | 0];
        if (Math.hypot(x - b.x, z - b.z) < 40 && !this.threats.some((T) => Math.hypot(T.x - x, T.z - z) < b.S.wary * 1.5)) return [x, e.ground(x, z), z, 'ground'];
      }
      return null;
    }
    for (let k = 0; k < 10; k++) {
      const a = r() * TAU, d = 2 + r() * (b.kind === 'duck' ? 10 : 20), x = b.hx + Math.cos(a) * d, z = b.hz + Math.sin(a) * d, s = e.water(x, z);
      if (s && !s.ice && s.depth > 0.3 && (b.kind !== 'duck' || s.shore < 9)) return [x, s.level, z, b.kind === 'duck' ? 'swim' : 'float'];
    }
    return null;
  }

  _startLanding(b) {
    const L = this._pickLanding(b);
    if (!L) { b.tt = 10; return false; }
    [b.tx, b.ty, b.tz, b.land] = L;
    b.st = 'approach'; return true;
  }

  _bird(b, h) {
    const S = b.S, r = this.rnd, e = this.env;
    b.tt -= h;
    switch (b.st) {
      case 'soar': { // gulls wheel over their patch: circle through the moving air, flap in short bouts
        b.gy = e.ground(b.x, b.z);
        b.th += (b.dir * S.air / b.R) * h;
        b.cx = b.hx + 7 * Math.sin(this.t * 0.043 + b.pref * 9); b.cz = b.hz + 7 * Math.cos(this.t * 0.037 + b.pref * 5);
        const a = b.th + b.dir * 0.6;
        this._fly(b, h, b.cx + Math.cos(a) * b.R, b.alt + 1.5 * Math.sin(this.t * 0.2 + b.pref * 7), b.cz + Math.sin(a) * b.R, S.air);
        b.bout -= h;
        if (b.bout <= 0 && r() < (1 - S.glide) * h * 1.5) b.bout = 0.8 + r() * 1.4;
        this._wings(b, h, b.bout > 0 || b.vy > 0.8 ? 0.85 : 0);
        if (b.tt <= 0) { if (!this._startLanding(b)) b.tt = 15 + r() * 20; }
        break;
      }
      case 'fly': { // crows / ducks commuting: steady flapping (crows with short glides), low
        b.gy = e.ground(b.x, b.z);
        const d = this._fly(b, h, b.tx, b.ty, b.tz, S.air);
        this._wings(b, h, S.glide > 0.2 && Math.sin(this.t * 1.3 + b.pref * 6) > 0.6 ? 0 : 0.9);
        if (d < 8) { if (!this._startLanding(b)) { b.tx = b.hx; b.tz = b.hz; } }
        break;
      }
      case 'flee': case 'takeoff': { // explosive take-off, climb away (flee) or into the wind (takeoff)
        b.gy = e.ground(b.x, b.z);
        if (b.st === 'takeoff') { const u = this._upwind(b); b.tx = b.x + Math.cos(u) * 20; b.tz = b.z + Math.sin(u) * 20; }
        this._fly(b, h, b.tx, b.ty, b.tz, S.air * 1.15, 3.5);
        this._wings(b, h, 1, 1.25);
        if (b.tt <= 0 || (b.st === 'takeoff' && b.y > b.gy + 3)) {
          if (b.kind === 'gull') { b.st = 'soar'; b.tt = 25 + r() * 40; b.alt = S.alt[0] + r() * (S.alt[1] - S.alt[0]); }
          else {
            b.st = 'fly'; b.ty = S.alt[0] + r() * (S.alt[1] - S.alt[0]);
            const a = r() * TAU, d = b.kind === 'duck' ? 25 : 15 + r() * 15; // ducks circuit and come back home
            b.tx = (b.kind === 'duck' ? b.hx : b.x) + Math.cos(a) * d; b.tz = (b.kind === 'duck' ? b.hz : b.z) + Math.sin(a) * d;
            const F = e.fields || [];
            if (b.kind === 'crow' && F.length) { // crows commute to another bit of the same fields
              for (let k = 0; k < 6; k++) { const q = F[(r() * F.length) | 0]; if (Math.hypot(q[0] - b.x, q[1] - b.z) < 45) { b.tx = q[0]; b.tz = q[1]; break; } }
            }
            if (b.kind === 'duck') b.tt = 20 + r() * 20;
          }
        }
        break;
      }
      case 'approach': { // swing round to come in from downwind, then a braking final into the wind
        b.gy = e.ground(b.x, b.z);
        const u = this._upwind(b), ax = b.tx - Math.cos(u) * 7, az = b.tz - Math.sin(u) * 7;
        const d = this._fly(b, h, ax, b.ty + 2.5, az, S.air * 0.9);
        this._wings(b, h, S.glide > 0.5 ? (b.vy > 0.5 ? 0.7 : 0) : 0.8);
        if (d < 2.5 || b.tt < -25) { b.st = 'final'; b.tt = 6; }
        break;
      }
      case 'final': {
        const d3 = Math.hypot(b.tx - b.x, b.ty - b.y, b.tz - b.z);
        this._fly(b, h, b.tx, b.ty, b.tz, Math.min(S.air, 0.4 + d3 * 1.1));
        this._wings(b, h, d3 < 3 ? 1 : 0.3, d3 < 3 ? 1.2 : 1); // flare
        b.pitch = Math.max(b.pitch, d3 < 3 ? 0.5 : 0);
        if (d3 < 0.35 || b.tt <= 0) {
          this.stats.landings++;
          if (b.land === 'swim' || b.land === 'float') { e.ripple?.(b.tx, b.tz, 0.05); if (b.kind === 'duck') { e.splash?.(b.tx, b.tz, 0.25); this.stats.splashes++; } }
          b.x = b.tx; b.z = b.tz;
          this._settle(b, b.land, b.land === 'perched' ? b.perch : null);
        }
        break;
      }
      default: this._idle(b, h);
    }
  }

  /** Sitting birds: face into the wind, preen / peck / dabble, drift on the water, flush when approached. */
  _idle(b, h) {
    const S = b.S, r = this.rnd, e = this.env;
    b.amp += (0 - b.amp) * Math.min(1, 5 * h); b.fold += (1 - b.fold) * Math.min(1, 4 * h);
    b.bank *= 1 - Math.min(1, 4 * h); b.pitch *= 1 - Math.min(1, 3 * h);
    const T = this._nervous(b);
    if (T) { this._flee(b, T.x, T.z); return; }
    const up = this._upwind(b), W = this._w, ws = Math.hypot(W[0], W[1]);
    let face = up;
    if (b.st === 'swim' || b.st === 'float') {
      const s = e.water(b.x, b.z);
      if (!s) { b.st = 'takeoff'; b.tt = 3; b.ty = b.y + 4; return; }
      b.gy = s.level;
      // wind drift (~2.5 % of the wind) + current; ducks paddle back towards home water and wander
      let px = 0, pz = 0;
      if (b.kind === 'duck') {
        if (b.tt <= 0 || !b.wx) { b.tt = 6 + r() * 10; const a = r() * TAU, d = r() * 7; b.wx = b.hx + Math.cos(a) * d; b.wz = b.hz + Math.sin(a) * d; }
        const dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz);
        if (d > 0.6) { px = (dx / d) * 0.28; pz = (dz / d) * 0.28; face = Math.atan2(pz, px); }
        b.dab = Math.max(0, Math.sin(this.t * 0.31 + b.pref * 17) * 3 - 2.2); // tail-up dabbling now and then
        if (d > 0.6 && r() < h * 1.2) e.ripple?.(b.x, b.z, 0.012);
      } else if (b.tt <= 0) { b.st = 'takeoff'; b.tt = 3; b.ty = b.y + 4; return; }
      const nx = b.x + (W[0] * 0.025 + s.flow[0] * 0.9 + px) * h, nz = b.z + (W[1] * 0.025 + s.flow[1] * 0.9 + pz) * h;
      const q = e.water(nx, nz);
      if (q && !q.ice) { b.x = nx; b.z = nz; b.y = q.level; }
      else { b.wx = b.hx; b.wz = b.hz; }
      if (ws < 0.5 && !px) face = b.yaw;
    } else if (b.st === 'ground') { // crows: walk / hop and peck
      b.gy = b.y;
      b.peck = Math.max(0, Math.sin(this.t * 2.3 + b.pref * 11) * 2 - 1);
      if (r() < h * 0.7) { // a few steps / a hop
        const a = up + (r() - 0.5) * 2.4, d = 0.15 + r() * 0.35;
        const nx = b.x + Math.cos(a) * d, nz = b.z + Math.sin(a) * d;
        if (Math.hypot(nx - b.hx, nz - b.hz) < 9 && !e.water(nx, nz)) { b.x = nx; b.z = nz; b.y = e.ground(nx, nz); face = a; b.yaw = a; }
      }
      if (b.tt <= 0) { b.st = 'takeoff'; b.tt = 2; b.ty = b.y + 3; b.hx = b.x; b.hz = b.z; return; }
    } else if (b.st === 'perched') {
      b.gy = b.y;
      if (b.tt <= 0) { if (b.perch) { b.perch.bird = null; b.perch = null; } b.st = 'takeoff'; b.tt = 3; b.ty = b.y + 5; return; }
    }
    if (b.st !== 'ground' || ws > 3) {
      const mt = 1.5 * h, jitter = Math.sin(this.t * 0.5 + b.pref * 13) * 0.25 * (ws < 3 ? 2 : 1);
      b.yaw = wrapA(b.yaw + clamp(wrapA(face + jitter - b.yaw), -mt, mt));
    }
  }

  /** Counts per state (tests / debug). */
  census() { const c = {}; for (const b of this.birds) c[b.st] = (c[b.st] || 0) + 1; return c; }
}
