/**
 * Ambient birds (PROGRESS step 4f extras): herring gulls wheeling over harbours / coasts / fjords (land on piers or
 * the water, flush at gunshots), crows in open fields (hooded crows in Norway; walk and peck, flush when anyone
 * comes close; on the ground they walk with alternating steps and a head-bob, hop, peck and look round: see
 * bird-ground.js), ducks on ponds and quiet rivers (mallards; common eiders on northern seas). Pure and deterministic
 * on SIM time (frozen while paused), wind-aware: every bird flies through the air mass (ground velocity = air
 * velocity + wind at its height, so gulls crab and hang into a gale), lands and settles facing into the wind, and
 * sitting ducks drift downwind. No gameplay effect. Rendering: src/art/bird-model.js; director:
 * src/render/ambient-life.js.
 * @module world/bird-sim
 */
import { makeRng, fishHabitat } from './fish-sim.js';
import { legDims, feetInit, feetPlant, feetAir, feetGait, turnTo, peckCurve, smooth, restFoot } from './bird-ground.js';

const _R = { x: 0, z: 0 };
const HOP_RAMP = 0.06; // s over which a hop's forward speed builds (push-off) and dies (landing)

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
const AWAY_TRY = [0, 0.7, -0.7, 1.4, -1.4]; // walk-off headings tried (rad off straight away from the threat)
const FOOTED = { gull: 1, crow: 1 }; // species that stand / walk on their feet (legs modelled, ground gait)
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
 * The birds of one mission. `env`: {wind(x, z, out2), water(x, z) → sample|null, ground(x, z) → y, blocked?(x, z) → bool,
 * fields: [x, z][], perches: {x, y, z}[], splash?(x, z, size), ripple?(x, z, s), flush?(bird)}.
 */
export class BirdSim {
  constructor(plan, env, seed = 17) {
    this.env = env; this.rnd = makeRng(seed);
    this.birds = []; this.threats = []; this.t = 0;
    this.stats = { flushes: 0, landings: 0, splashes: 0 };
    this._w = [0, 0];
    this._fh = new Map(); // fields spatial hash (4 m buckets): crows only walk where the field is open
    for (const q of env.fields || []) { const k = `${Math.floor(q[0] / 4)},${Math.floor(q[1] / 4)}`; (this._fh.get(k) || this._fh.set(k, []).get(k)).push(q); }
    for (const p of plan) for (let i = 0; i < p.n; i++) this._spawn(p, i);
  }

  _spawn(p, i) {
    const S = BIRD_SPECIES[p.sp], r = this.rnd, e = this.env;
    const b = { sp: p.sp, kind: p.kind, S, hx: p.x, hz: p.z, x: p.x + (r() - 0.5) * 4, z: p.z + (r() - 0.5) * 4, y: 0, vx: 0, vy: 0, vz: 0,
      yaw: r() * TAU, pitch: 0, bank: 0, st: '', tt: 0, ph: r() * TAU, amp: 0, fold: 1, dab: 0, peck: 0, bout: 0,
      cx: p.x, cz: p.z, R: 7 + r() * 8, th: r() * TAU, dir: r() < 0.5 ? -1 : 1, alt: S.alt[0] + r() * (S.alt[1] - S.alt[0]),
      tx: 0, ty: 0, tz: 0, perch: null, pref: r(), body: p.body, v: 0, yr: 0, crouch: 0, act: '', at: 0, launch: 0 };
    if (FOOTED[p.sp]) { b.G = legDims(S); b.gf = (x, z) => (b.perch ? b.perch.y : e.ground(x, z)); }
    this.birds.push(b);
    if (p.kind === 'gull') { // most on the wing, some sitting on a pier or on the water
      const pc = this._freePerch(b);
      if (i % 3 === 2 && pc) this._settle(b, 'perched', pc, true);
      else { b.y = b.alt; b.st = 'soar'; b.tt = 20 + r() * 40; b.fold = 0; feetInit(b, e.ground); feetAir(b, 1, 1); }
    } else if (p.kind === 'duck') {
      const s = e.water(b.x, b.z);
      if (!s) { b.x = p.x; b.z = p.z; }
      this._settle(b, 'swim', null, true);
    } else {
      for (let k = 0; k < 8; k++) { b.x = p.x + (r() - 0.5) * 6; b.z = p.z + (r() - 0.5) * 6; if (!this._blocked(b.x, b.z) && !e.water(b.x, b.z)) break; if (k === 7) { b.x = p.x; b.z = p.z; } }
      this._settle(b, 'ground', null, true);
    }
  }

  _freePerch(b) {
    const R = b.S.wary * 1.5, P = (this.env.perches || []).filter((q) => !q.bird && (q.x - b.hx) ** 2 + (q.z - b.hz) ** 2 < 60 * 60 && !this.threats.some((T) => Math.hypot(T.x - q.x, T.z - q.z) < R));
    return P.length ? P[(this.rnd() * P.length) | 0] : null;
  }

  /**
   * Sit down (spawn, or the end of a touchdown). Wings fold, amplitude and pitch ease out in _idle (only a spawn sets
   * them outright); footed birds plant their feet where they are, standing G.stand above the ground / deck.
   */
  _settle(b, st, perch, spawn = false) {
    const e = this.env, G = b.G;
    b.st = st; b.tt = st === 'ground' ? 8 + this.rnd() * 20 : 15 + this.rnd() * 35;
    const vyIn = b.vy; b.pvx = spawn ? 0 : b.vx; b.pvz = spawn ? 0 : b.vz; // a perch landing carries its last drift into the shuffle
    b.v = st === 'ground' && !spawn ? Math.min(0.6, Math.max(0, b.vx * Math.cos(b.yaw) + b.vz * Math.sin(b.yaw))) : 0;
    b.vx = b.vy = b.vz = 0; b.va = 0; b.act = ''; b.at = spawn ? this.rnd() * 2 : 0.3; b.hop = null; b.launch = 0;
    if (spawn) { b.fold = 1; b.amp = 0; b.bank = 0; b.pitch = 0; }
    const up = G && st !== 'swim' && st !== 'float' ? G.stand : 0;
    if (perch) { // a landing keeps its last few cm off the post and shuffles onto it (_idle), no snap
      perch.bird = b; b.perch = perch; if (spawn) { b.x = perch.x; b.z = perch.z; } b.pox = b.x - perch.x; b.poz = b.z - perch.z; b.y = perch.y + up;
    }
    else if (st === 'swim' || st === 'float') b.y = e.water(b.x, b.z)?.level ?? b.y;
    else b.y = e.ground(b.x, b.z) + up;
    if (!G) return;
    if (spawn) feetInit(b, b.gf);
    if (up) { feetPlant(b, b.gf); b.tuck = 0; b.crouch = 0; b.cv = spawn ? 0 : Math.max(0, -vyIn); } // the legs absorb the landing
    else if (spawn) feetAir(b, 1, 1);
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
    b.st = 'flee'; b.tt = 4 + this.rnd() * 3; b.act = ''; b.hop = null;
    if (grounded) {
      this.stats.flushes++; this.env.flush?.(b);
      if (b.kind === 'duck' || was === 'float') { this.env.splash?.(b.x, b.z, 0.35); this.stats.splashes++; }
      b.vy = b.kind === 'duck' && b.sp === 'mallard' ? 3.2 : 1.8; // mallards spring straight up, eiders patter off
      if (b.G && (was === 'ground' || was === 'perched')) this._beginLaunch(b, 0.09); // crouch, then spring
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
    const g = this.env.ground(b.x, b.z) + (b.G ? b.G.stand * 0.8 : 0.25);
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
      if (pc) { pc.bird = b; b.perch = pc; return [pc.x, pc.y + (b.G?.stand || 0), pc.z, 'perched']; }
    }
    if (b.kind === 'crow') {
      const F = e.fields || [];
      for (let k = 0; k < 8 && F.length; k++) {
        const [x, z] = F[(r() * F.length) | 0];
        if (Math.hypot(x - b.x, z - b.z) < 40 && !this.threats.some((T) => Math.hypot(T.x - x, T.z - z) < b.S.wary * 1.5)) return [x, e.ground(x, z) + (b.G?.stand || 0), z, 'ground'];
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

  /** Take-off from the feet: a quick crouch on the spot (wings opening, turning into the jump), then the spring. */
  _launch(b, h) {
    const G = b.G, k = Math.min(1, 25 * h);
    b.launch -= h; b.tt += h;
    b.crouch += (G.crouch - b.crouch) * k;
    turnTo(b, h, Math.atan2(b.tz - b.z, b.tx - b.x), b.st === 'flee' ? 6 : 4);
    b.v = Math.max(0, b.v - 4 * h); b.x += Math.cos(b.yaw) * b.v * h; b.z += Math.sin(b.yaw) * b.v * h; // a walker brakes into the jump
    b.amp += (1 - b.amp) * Math.min(1, 10 * h); b.fold += (0 - b.fold) * Math.min(1, 12 * h);
    b.ph = (b.ph + TAU * b.S.flapHz * 1.3 * h) % TAU;
    b.pitch += (0.25 - b.pitch) * Math.min(1, 8 * h); b.peck += (0 - b.peck) * k; b.look *= 1 - k; b.bob *= 1 - k; b.sway *= 1 - k;
    b.y = b.lgy + G.stand - b.crouch;
    if (b.launch <= 0) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), v0 = 1.6 + b.v; b.vy = 2.6; b.vx = c * v0; b.vz = s * v0; b.v = 0; b.yr = 0; }
  }

  /** Begin a take-off from the feet (ground or deck): remember the foot level for the crouch. */
  _beginLaunch(b, dur) {
    b.launch = b.launch0 = dur; b.vy = 0; b.hop = null; b.act = '';
    b.lgy = b.feet ? (b.feet[0].y + b.feet[1].y) / 2 : b.y - b.G.stand;
  }

  /**
   * The last metre of a landing: sink onto the spot under deep flaring beats; a perch is homed onto exactly, a field
   * or the water just runs out the remaining speed. Settles once down — no snap in position, height or pose.
   */
  _touchdown(b, h) {
    const e = this.env, perch = b.land === 'perched', ex = b.tx - b.x, ez = b.tz - b.z, kh = Math.min(1, (perch ? 8 : b.land === 'ground' ? 2.2 : 3.5) * h);
    b.vx += ((perch ? ex * 4 : 0) - b.vx) * kh; b.vz += ((perch ? ez * 4 : 0) - b.vz) * kh;
    b.vy += (clamp((b.ty - b.y) * 5, -1.6, b.G ? -0.3 : 0.4) - b.vy) * Math.min(1, 10 * h);
    if (b.land === 'ground' && b.G) { // coming down close to a wall / the water's edge: the flare kills the run-out sooner (≤ 5 m/s²)
      const sp = Math.hypot(b.vx, b.vz), free = sp > 0.05 ? this._freeAhead(b, b.vx / sp, b.vz / sp, 1.2) : Infinity;
      const vmax = Math.sqrt(2 * 1.6 * Math.max(0, free - 0.3));
      if (sp > vmax) { const k = Math.max(vmax, sp - 5 * h) / sp; b.vx *= k; b.vz *= k; }
    }
    b.x += b.vx * h; b.z += b.vz * h; b.y += b.vy * h;
    if (b.land === 'ground') b.ty = e.ground(b.x, b.z) + (b.G ? b.G.stand : 0);
    else if (b.land === 'swim' || b.land === 'float') b.ty = e.water(b.x, b.z)?.level ?? b.ty;
    b.amp += (0.9 - b.amp) * Math.min(1, 5 * h); b.ph = (b.ph + TAU * b.S.flapHz * 1.2 * h) % TAU;
    b.fold += (0 - b.fold) * Math.min(1, 6 * h);
    b.pitch += (0.45 - b.pitch) * Math.min(1, 6 * h); b.bank *= 1 - Math.min(1, 4 * h);
    if (b.y < b.ty) b.y = b.ty;
    if (b.y - b.ty < 0.006 && (!perch || Math.hypot(ex, ez) < 0.04) || b.tt < -6) {
      this.stats.landings++;
      if (b.land === 'swim' || b.land === 'float') { e.ripple?.(b.x, b.z, 0.05); if (b.kind === 'duck') { e.splash?.(b.x, b.z, 0.25); this.stats.splashes++; } }
      if (b.tt < -6 && !perch) b.y = b.ty;
      this._settle(b, b.land, perch ? b.perch : null);
    }
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
        if (b.G) feetAir(b, h, 1);
        if (b.tt <= 0) { if (!this._startLanding(b)) b.tt = 15 + r() * 20; }
        break;
      }
      case 'fly': { // crows / ducks commuting: steady flapping (crows with short glides), low
        b.gy = e.ground(b.x, b.z);
        const d = this._fly(b, h, b.tx, b.ty, b.tz, S.air);
        this._wings(b, h, S.glide > 0.2 && Math.sin(this.t * 1.3 + b.pref * 6) > 0.6 ? 0 : 0.9);
        if (b.G) feetAir(b, h, 1);
        if (d < 8) { if (!this._startLanding(b)) { b.tx = b.hx; b.tz = b.hz; } }
        break;
      }
      case 'flee': case 'takeoff': { // explosive take-off, climb away (flee) or into the wind (takeoff)
        b.gy = e.ground(b.x, b.z);
        if (b.st === 'takeoff') { const u = this._upwind(b); b.tx = b.x + Math.cos(u) * 20; b.tz = b.z + Math.sin(u) * 20; }
        if (b.launch > 0) { this._launch(b, h); break; }
        this._fly(b, h, b.tx, b.ty, b.tz, S.air * 1.15, 3.5);
        this._wings(b, h, 1, 1.25);
        if (b.G) feetAir(b, h, 1);
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
        if (b.G) feetAir(b, h, 1);
        if (d < 2.5 || b.tt < -25) { b.st = 'final'; b.tt = 6; b.td = false; }
        break;
      }
      case 'final': { // braking final with a flare, then a touchdown that converges smoothly onto the spot
        if (b.land === 'ground') b.ty = e.ground(b.x, b.z) + (b.G ? b.G.stand : 0);
        const d3 = Math.hypot(b.tx - b.x, b.ty - b.y, b.tz - b.z);
        if (!b.td) {
          this._fly(b, h, b.tx, b.ty, b.tz, Math.min(S.air, 0.4 + d3 * 1.1));
          this._wings(b, h, d3 < 3 ? 1 : 0.3, d3 < 3 ? 1.2 : 1); // flare
          if (d3 < 3) b.pitch += (0.5 - b.pitch) * Math.min(1, 6 * h);
          if (d3 < 1.2 || b.tt <= 0) b.td = true;
        } else this._touchdown(b, h);
        if (b.G && b.st === 'final') feetAir(b, h, d3 < 4 ? 0 : 1); // legs come down and reach forward for the ground
        break;
      }
      default: this._idle(b, h);
    }
  }

  /** Sitting birds: face into the wind, preen / peck / dabble, drift on the water, flush when approached. */
  _idle(b, h) {
    const S = b.S, r = this.rnd, e = this.env;
    b.amp += (0 - b.amp) * Math.min(1, 5 * h); b.fold += (1 - b.fold) * Math.min(1, 4 * h);
    b.bank *= 1 - Math.min(1, 4 * h); if (b.st !== 'ground') b.pitch *= 1 - Math.min(1, 3 * h);
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
    } else if (b.st === 'ground') { // crows: walk, hop, peck, look round
      if (b.tt <= 0 && !b.hop && b.act !== 'peck' && b.peck < 0.05 && b.feet.every((f) => f.s < 0)) { b.st = 'takeoff'; b.tt = 2; b.ty = b.y + 3; b.hx = b.x; b.hz = b.z; this._beginLaunch(b, 0.16); return; }
      this._ground(b, h, up, ws);
      return;
    } else if (b.st === 'perched') {
      b.gy = b.y;
      if (b.tt <= 0) { if (b.perch) { b.perch.bird = null; b.perch = null; } b.st = 'takeoff'; b.tt = 3; b.ty = b.y + 5; if (b.G) this._beginLaunch(b, 0.16); return; }
    }
    const mt = 1.5 * h, jitter = Math.sin(this.t * 0.5 + b.pref * 13) * 0.25 * (ws < 3 ? 2 : 1);
    if (b.G && b.st === 'perched') { // footed birds on a deck: turn with small steps, look about
      turnTo(b, h, face + jitter, 1.5);
      b.v = 0; feetGait(b, h, b.gf); this._looks(b, h, 1);
      this._crouch(b, h, 0); b.peck *= 1 - Math.min(1, 10 * h); b.y = b.perch ? b.perch.y + b.G.stand - b.crouch : b.y;
      if (b.perch && (b.pox || b.poz)) { // critically damped (ω 9 rad/s) onto the post, from the touchdown's own drift: no snap, no stop-start
        b.pvx += (-81 * b.pox - 18 * b.pvx) * h; b.pvz += (-81 * b.poz - 18 * b.pvz) * h; b.pox += b.pvx * h; b.poz += b.pvz * h;
        if (Math.abs(b.pox) + Math.abs(b.poz) < 1e-4 && Math.abs(b.pvx) + Math.abs(b.pvz) < 1e-3) b.pox = b.poz = 0;
        b.x = b.perch.x + b.pox; b.z = b.perch.z + b.poz;
      }
    } else {
      b.yaw = wrapA(b.yaw + clamp(wrapA(face + jitter - b.yaw), -mt, mt));
      if (b.G) feetAir(b, h, 1); // a gull sitting on the water: feet paddling out of sight
    }
  }

  /** Crouch as a damped spring (ω 20 rad/s, ζ 0.75): landings sink into the legs and come back up, no pops. */
  _crouch(b, h, target) {
    b.cv = (b.cv || 0) + ((target - b.crouch) * 400 - b.cv * 30) * h;
    b.crouch = clamp(b.crouch + b.cv * h, 0, b.G.crouch * 1.5);
  }

  /** Head turns: quick saccades (~0.2 s) to a new look direction every 0.35–1.5 s; amount 0 = face ahead. */
  _looks(b, h, amount) {
    b.lt = (b.lt ?? 0) - h;
    if (b.lt <= 0) { b.lt = 0.35 + this.rnd() * 1.1; b.lookT = amount > 0 && this.rnd() < 0.8 ? (this.rnd() - 0.5) * 2 * amount : 0; }
    if (!(amount > 0)) b.lookT = 0;
    b.look += clamp((b.lookT - b.look) * Math.min(1, 12 * h), -7 * h, 7 * h); // quick, but not a pop
  }

  /** Is (x, z) open field (within 2.6 m of a field sample)? Without field data everything is. */
  _inField(x, z) {
    if (!this._fh.size) return true;
    const i = Math.floor(x / 4), j = Math.floor(z / 4);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const q of this._fh.get(`${i + a},${j + c}`) || []) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < 6.8) return true;
    return false;
  }

  /** Is (x, z) inside an obstacle, or within `r` of one (a crow's body is ~0.25 m from the feet to the bill / tail)? */
  _blocked(x, z, r = 0.25) {
    const B = this.env.blocked;
    if (!B) return false;
    if (B(x, z)) return true;
    for (let k = 0; k < 8 && r > 0; k++) { const a = (k * TAU) / 8; if (B(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true; }
    return false;
  }

  /** May a crow walk / hop to (x, z)? Dry, clear of obstacles, open field (or nearer home), within 9 m of home, not onto another crow. */
  _okSpot(b, x, z, gap = 0.5) {
    if (this.env.water(x, z) || this._blocked(x, z)) return false;
    const dh = Math.hypot(x - b.hx, z - b.hz);
    if (dh > 9 || (!this._inField(x, z) && dh > Math.hypot(b.x - b.hx, b.z - b.hz))) return false;
    for (const o of this.birds) if (o !== b && o.st === 'ground' && (o.x - x) ** 2 + (o.z - z) ** 2 < gap * gap) return false;
    return true;
  }

  /** Distance (m, to ~2 mm; Infinity past `max`) of the first wet or blocked point straight ahead of the bird. */
  _freeAhead(b, cy, sy, max) {
    const bad = (s) => this.env.water(b.x + cy * s, b.z + sy * s) || this._blocked(b.x + cy * s, b.z + sy * s, 0);
    for (let s = 0.025; s < max + 0.025; s += 0.025) {
      if (!bad(s)) continue;
      let lo = s - 0.025, hi = s;
      for (let k = 0; k < 4; k++) { const m = (lo + hi) / 2; if (bad(m)) hi = m; else lo = m; }
      return lo;
    }
    return Infinity;
  }

  /** Is the straight walk (x0, z0) → (x1, z1) dry and clear of obstacles (sampled every ~0.6 m)? */
  _clearPath(x0, z0, x1, z1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.6));
    for (let k = 1; k <= n; k++) { const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n; if (this.env.water(x, z) || this._blocked(x, z)) return false; }
    return true;
  }

  /** Someone moving at the edge of the wary radius (closer in, _nervous flushes the bird). */
  _wary(b) {
    const R = b.S.wary * 1.6;
    for (const T of this.threats) if (T.moving && Math.abs(T.x - b.x) < R && Math.abs(T.z - b.z) < R && Math.hypot(T.x - b.x, T.z - b.z) < R) return T;
    return null;
  }

  /** Next ground activity: walk a metre or two (mostly into a strong wind), a bout of pecks, 1–2 hops, or a look round. */
  _nextAct(b, up, ws) {
    const r = this.rnd, p = r();
    b.act = 'stand'; b.at = 0.8 + r() * 2;
    if (p < 0.42) {
      for (let k = 0; k < 6; k++) {
        const a = (ws > 3 && r() < 0.7 ? up : b.yaw) + (r() - 0.5) * (k < 3 ? 2.2 : TAU), d = 0.5 + r() * 1.8;
        const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
        if (this._okSpot(b, x, z) && this._okSpot(b, (b.x + x) / 2, (b.z + z) / 2, 0) && this._clearPath(b.x, b.z, x, z)) { b.act = 'walk'; b.at = 8; b.mx = x; b.mz = z; b.vw = 0.3 + r() * 0.3; return; }
      }
    } else if (p < 0.72) { b.act = 'peck'; b.npk = 2 + ((r() * 4) | 0); b.pu = 0; b.pp = 0.1 + r() * 0.4; b.at = 30; }
    else if (p < 0.84) { b.act = 'hop'; b.at = 3; b.nh = r() < 0.4 ? 2 : 1; b.ha = b.yaw + (r() - 0.5); }
  }

  /**
   * A crow on the ground: walks to a spot a metre or two off (alternating steps, head-bob), pecks in bouts, pauses
   * looking round, makes 1–2 two-footed hops. Speed and turn rate are limited and eased, the feet do the turning.
   * Someone moving at the edge of its wary radius makes it walk off briskly; closer in, _nervous flushes it.
   */
  _ground(b, h, up, ws) {
    const r = this.rnd, e = this.env, G = b.G;
    b.gy = e.ground(b.x, b.z);
    b.at -= h;
    if (b.hop) { this._hop(b, h); return; }
    const T = this._wary(b);
    if (T && b.act !== 'away') { // walk off from the threat, veering round obstacles / water; boxed in → stand alert
      const a0 = Math.atan2(b.z - T.z, b.x - T.x) + (r() - 0.5) * 0.6;
      b.act = 'away'; b.at = 2.5 + r(); b.mx = b.x; b.mz = b.z; b.vw = 0.75;
      for (const da of AWAY_TRY) {
        const x = b.x + Math.cos(a0 + da) * 3, z = b.z + Math.sin(a0 + da) * 3;
        if (this._clearPath(b.x, b.z, x, z)) { b.mx = x; b.mz = z; break; }
      }
    }
    if (b.at <= 0 || !b.act) this._nextAct(b, up, ws);
    let look = 0, peck = 0, vd = 0, face = null, maxTurn = 3.2;
    switch (b.act) {
      case 'walk': case 'away': {
        const dx = b.mx - b.x, dz = b.mz - b.z, d = Math.hypot(dx, dz);
        const fa = Math.atan2(dz, dx), ca = Math.cos(wrapA(fa - b.yaw));
        // arrived (slowed right down on the spot, or just past it): stop easing out from the creep, never turn back for it
        if (d < 0.015 || (d < 0.06 && b.v < 0.12) || (d < 0.2 && ca < 0)) { if (b.act === 'away') { look = 1; break; } b.act = 'stand'; b.at = 0.4 + r() * 1.2; break; }
        face = d > 0.12 ? fa : b.yaw; // the last few cm: hold the heading (the bearing swings round as the spot comes up)
        const c = Math.max(0, ca);
        vd = Math.min(b.vw * c * c * c, Math.sqrt(2 * 1.0 * Math.max(0, d - 0.01 - 0.18 * b.v))); // turn (on the spot) first, brake into the spot (leading the eased speed's lag)
        maxTurn = b.v > 0.05 ? 2.6 : 3.2; look = 0.3;
        break;
      }
      case 'peck': {
        if (b.v < 0.05) b.pu += h; // stop first, then peck
        if (b.pu < 0.32) peck = peckCurve(b.pu / 0.32);
        else if (b.pu > 0.32 + b.pp) { b.pu = 0; b.pp = 0.15 + r() * 0.6; if (--b.npk <= 0) { b.act = 'stand'; b.at = 0.3 + r() * 0.8; } }
        break;
      }
      case 'hop':
        if (b.v < 0.04 && b.feet.every((f) => f.s < 0)) { this._startHop(b); if (b.hop) { this._hop(b, h); return; } }
        break;
      default: look = 1;
    }
    if (face === null && ws > 3) { face = up; maxTurn = 1.2; } // stand into a strong wind
    if (face !== null) turnTo(b, h, face, maxTurn); else b.yr *= 1 - Math.min(1, 10 * h);
    const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
    const look2 = 0.22 + 0.3 * b.v + (b.v * b.v) / 4.4; // body length + the eased braking distance
    const free = b.v > 1e-3 || vd > 0 ? this._freeAhead(b, cy, sy, look2) : Infinity; // dry, clear ground straight ahead
    if (free < look2) {
      vd = 0; // an obstacle / water within braking distance + body length ahead: brake; heading straight at it → give the walk up
      if ((b.act === 'walk' || b.act === 'away') && face !== null && Math.cos(wrapA(face - b.yaw)) > 0.9) { b.act = 'stand'; b.at = 0.5; b.mx = b.x; b.mz = b.z; }
    }
    // speed: the acceleration itself is eased (jerk ≤ 18 m/s³, |a| ≤ 2.4 m/s²), so steps off, speed-ups and stops
    // blend in instead of switching on at full thrust / full brake
    let aw = clamp((vd - b.v) * 6, -2.4, 1.8), jerk = 18;
    // too close for that (a landing run-out coming in near a wall or the water's edge): brake as hard as the room left
    // demands, so the bird still stops short of it with a continuous speed instead of stopping dead
    const room = free - 0.015;
    if (b.v > 1e-3 && (b.v * b.v) / 4.8 + 0.07 * b.v > room) { aw = Math.min(aw, (-1.15 * b.v * b.v) / (2 * Math.max(0.005, room))); jerk = 240; }
    b.va = (b.va || 0) + clamp(aw - (b.va || 0), -jerk * h, jerk * h);
    b.v = Math.max(0, b.v + b.va * h); if (b.v === 0 && b.va < 0) b.va = 0;
    if (b.v > 1e-4) {
      const nx = b.x + cy * b.v * h, nz = b.z + sy * b.v * h;
      if (e.water(nx, nz) || this._blocked(nx, nz, 0)) { b.act = 'stand'; b.at = 0.5; b.mx = b.x; b.mz = b.z; b.v = 0; b.va = 0; } // last resort: the feet stop with the body
      else { b.x = nx; b.z = nz; }
    }
    b.peck += (peck - b.peck) * Math.min(1, 18 * h);
    const w = feetGait(b, h, e.ground);
    this._looks(b, h, b.act === 'peck' ? 0 : look);
    this._crouch(b, h, G.crouch * 0.35 * b.peck + (b.wcr || 0)); // a brisk walk goes on slightly bent legs (stance)
    b.gy = e.ground(b.x, b.z);
    b.y = b.gy + G.stand - b.crouch + w * G.lift * 0.12;
    b.pitch += (-0.35 * b.peck - b.pitch) * Math.min(1, 6 * h);
  }

  /** A two-footed hop: 0.22–0.42 m along a ballistic arc 5–9 cm high (flight time from the height). */
  _startHop(b) {
    const r = this.rnd, sc = b.S.len / 0.47, H = (0.05 + r() * 0.04) * sc, len = (0.22 + r() * 0.2) * sc, a = b.ha;
    const x1 = b.x + Math.cos(a) * len, z1 = b.z + Math.sin(a) * len, T = 2 * Math.sqrt((2 * H) / 9.81);
    if (!this._okSpot(b, x1, z1, 0.35)) { b.act = 'stand'; b.at = 0.5; return; }
    b.hop = { t: -0.1, T, H, a, x0: b.x, z0: b.z, x1, z1, len, V: len / (T + HOP_RAMP), o: b.feet.map((f) => [f.x - b.x, f.z - b.z]), landed: false };
    b.va = 0;
  }

  /**
   * Hop phases: crouch (0.1 s) → arc (feet drawn up under the body) → land, sink into the legs (0.14 s). The forward
   * speed builds over the last HOP_RAMP s of the push-off and dies away over the first HOP_RAMP s of the landing (the
   * legs push and absorb), so the body never goes 0 → 1.5 m/s in one frame; the heading keeps easing throughout.
   */
  _hop(b, h) {
    const p = b.hop, G = b.G, e = this.env, k = Math.min(1, 20 * h), R = HOP_RAMP;
    p.t += h; b.v = 0; b.va = 0; b.cv = 0;
    b.peck *= 1 - k; b.look *= 1 - Math.min(1, 8 * h); b.bob *= 1 - k; b.sway *= 1 - k; b.bobv = 0; b.swayv = 0;
    turnTo(b, h, p.a, 5);
    // distance along the hop: velocity ramps 0 → V over [−R, 0], V through the flight, V → 0 over [T, T + R]
    const t = p.t, s = t < -R ? 0 : t < 0 ? (p.V * (t + R) ** 2) / (2 * R) : t < p.T ? p.V * (R / 2 + t) : t < p.T + R ? p.len - (p.V * (p.T + R - t) ** 2) / (2 * R) : p.len;
    const fx = p.x0 + Math.cos(p.a) * s, fz = p.z0 + Math.sin(p.a) * s;
    if (t < 0) {
      b.x = fx; b.z = fz; // leaning into the push-off over planted feet
      b.crouch = G.crouch * Math.sin((Math.PI * (t + 0.1)) / 0.1);
      b.y = b.gy + G.stand - b.crouch;
    } else if (t < p.T) {
      const u = t / p.T, q = smooth(Math.min(1, u * 3)), ahead = p.len - s; // feet reach for where the body will stop
      b.x = fx; b.z = fz; b.gy = e.ground(b.x, b.z);
      b.crouch = 0; b.y = b.gy + G.stand + 4 * p.H * u * (1 - u);
      const ax = Math.min(ahead, p.V * R / 2) * Math.cos(p.a), az = Math.min(ahead, p.V * R / 2) * Math.sin(p.a);
      b.feet.forEach((f, i) => {
        restFoot(b, i, 0, _R);
        f.x = b.x + p.o[i][0] + (_R.x + ax - b.x - p.o[i][0]) * q; f.z = b.z + p.o[i][1] + (_R.z + az - b.z - p.o[i][1]) * q;
        f.y = b.y - G.stand + G.leg * 0.3 * Math.sin(Math.PI * u); f.s = -1; f.air = true; // carried
        f.rx = f.x - b.x; f.ry = f.y - b.y; f.rz = f.z - b.z;
      });
    } else {
      if (!p.landed) { p.landed = true; feetPlant(b, e.ground); }
      b.x = fx; b.z = fz; b.gy = e.ground(b.x, b.z); // the last few cm slide in over the planted feet as the legs give
      const s2 = (t - p.T) / 0.14;
      b.crouch = s2 < 1 ? G.crouch * 0.7 * Math.sin(Math.PI * s2) : 0;
      b.y = b.gy + G.stand - b.crouch;
      if (s2 >= 1 && t >= p.T + R) { b.hop = null; if (--b.nh > 0) b.ha = b.yaw + (this.rnd() - 0.5) * 0.6; else { b.act = 'stand'; b.at = 0.4 + this.rnd() * 0.8; } }
    }
    b.pitch += ((t > 0 && t < p.T ? 0.12 * Math.cos((Math.PI * t) / p.T) : 0) - b.pitch) * Math.min(1, 10 * h);
  }

  /** Counts per state (tests / debug). */
  census() { const c = {}; for (const b of this.birds) c[b.st] = (c[b.st] || 0) + 1; return c; }
}
