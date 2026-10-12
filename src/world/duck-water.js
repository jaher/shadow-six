/**
 * Ducks on the water (common eiders on the Norway fjords and seas, mallards on ponds, lakes and quiet rivers): their
 * behaviour, stepped by BirdSim (src/world/bird-sim.js) on sim time, pure and deterministic. User request: "make the
 * ducks more realistic (as seen in mission 1)".
 *
 * - **Swimming.** Each duck rides the small waves (heave, pitch and roll from a wind-driven chop travelling across
 *   the water, so neighbours bob out of step) and drifts with the wind (2.5 %) and the current. It picks an activity:
 *   paddle a few metres (eased speed with a surge on each paddle stroke, eased turns), drift and look round, preen
 *   (bill working in the back, flank or breast feathers), rest with the head tucked into the back, rise up and
 *   flap (the wing-flap display, after preening or a dive), dive for mussels (eiders: a forward-arching plunge,
 *   10–22 s under water, surfacing a few metres off) or up-end to feed (mallards, tail in the air), with a tail wag
 *   after settling or surfacing. Occasional quiet calls (env.call): the neck comes up, a drake eider throws its head
 *   back as it coos.
 * - **Flock.** The flock's centre wanders slowly over open water near home; every member paddles to spots round
 *   it and keeps ~1.5 body lengths from the others (closer when alarmed), stragglers swim back.
 * - **Alarm.** Someone moving just outside the wary radius: necks up, heads to the danger, the flock swims off.
 *   Inside it (or a gunshot / explosion, BirdSim.noise): the flock flushes, members a beat apart.
 * - **Take-off.** Eiders run across the surface into the air (1.1–1.6 s, wings beating and slapping the water, feet
 *   pattering, the wake opening out), mallards spring straight up; then low (eiders) or higher (mallards) flight.
 * - **Flight.** Steady fast wingbeats, neck stretched forward; the flock flies as a line / loose V behind the
 *   first bird up (formation slots off its heading).
 * - **Landing.** From downwind: a long shallow glide on set wings (small whiffling beats), braking beats over the
 *   last metres, and a skid along the water on the tail and feet (spray, the wings held up, then folded).
 * @module world/duck-water
 */
import { wrapA, clamp, smooth } from './bird-ground.js';

const TAU = Math.PI * 2;

/**
 * Per-species habits: dive (eiders feed under water) / up-end (mallards dabble), run take-off, spacing (m), paddle
 * cruise (m/s), lift-off speed (m/s), take-off run (s), share of hens, glide slope (rise / run), cruise height (m).
 */
export const DUCK_HABITS = {
  eider: { dive: true, run: true, sep: 0.95, cruise: 0.3, lift: 7, runT: [1.1, 1.6], hen: 0.45, slope: 0.16, alt: [2, 4], callEvery: [25, 70] },
  mallard: { dive: false, run: false, sep: 0.8, cruise: 0.32, lift: 4, runT: [0, 0], hen: 0.5, slope: 0.22, alt: [5, 9], callEvery: [30, 80] },
};

const airborne = (q) => q.st === 'flee' || q.st === 'fly' || q.st === 'takeoff' || q.st === 'approach' || q.st === 'final';
const ease = (b, k, target, rate, h) => { b[k] += (target - b[k]) * Math.min(1, rate * h); };

/** A duck joins its flock (one per plan entry) at spawn: sex, spacing round the spawn point, pose channels. */
export function duckSpawn(sim, b, p, i) {
  const H = DUCK_HABITS[b.sp] || DUCK_HABITS.mallard, r = sim.rnd, e = sim.env;
  let F = sim._flockOf.get(p);
  if (!F) { F = { sp: p.sp, hx: p.x, hz: p.z, cx: p.x, cz: p.z, ct: 5 + r() * 10, members: [], lead: null, nslot: 0, downT: null, alarmT: -1e9, ax: 0, az: 0, fleeA: 0, fleeT: -1e9 }; sim._flockOf.set(p, F); sim.flocks.push(F); }
  b.flock = sim.flocks.indexOf(F); F.members.push(b);
  b.duck = H; b.hen = b.pref < H.hen;
  // a loose raft: the first spot ≥ the spacing from the others, on open water
  for (let k = 0; k < 12; k++) {
    const a = r() * TAU, d = (k < 6 ? 0.6 : 1.2) * Math.sqrt(i + 1) * H.sep * (0.8 + r() * 0.5);
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, s = e.water(x, z);
    if (!s || s.ice || s.depth < 0.3 || !sim._inBounds(x, z)) continue;
    if (F.members.some((o) => o !== b && Math.hypot(o.x - x, o.z - z) < H.sep)) continue;
    b.x = x; b.z = z; break;
  }
  Object.assign(b, { act: '', at: r() * 4, v: 0, yr: 0, sph: r() * TAU, look: 0, lookT: 0, lt: 0, peck: 0, bob: 0, neckF: 0, neckU: 0, wag: 0, cock: 0,
    wset: 0, roll: 0, wp: 0, dab: 0, dv: 0, hidden: false, run: null, callT: H.callEvery[0] * r() + 5, cooT: 0, slot: 0, slotLead: null, sprayT: 0 });
}

/** Small wind-driven chop at (x, z): heave (m) and the surface slope (∂h/∂x, ∂h/∂z), two wave trains. */
export function chop(sim, x, z, out) {
  const w = sim._cw || (sim._cw = [0, 0]); sim.env.wind(x, z, w);
  const ws = Math.hypot(w[0], w[1]), A = clamp(0.003 + 0.0016 * ws, 0.003, 0.016), d0 = ws > 0.2 ? Math.atan2(w[1], w[0]) : 0.6;
  let hv = 0, gx = 0, gz = 0;
  for (let k = 0; k < 2; k++) {
    const lam = (1.7 + 0.12 * ws) * (k ? 0.62 : 1), kk = TAU / lam, om = Math.sqrt(9.81 * kk), d = d0 + (k ? 0.6 : 0), a = A * (k ? 0.6 : 1);
    const cx = Math.cos(d), cz = Math.sin(d), ph = kk * (x * cx + z * cz) - om * sim.t + k * 1.7;
    hv += a * Math.sin(ph); const g = a * kk * Math.cos(ph); gx += g * cx; gz += g * cz;
  }
  out[0] = hv; out[1] = gx; out[2] = gz; return out;
}
const _c = [0, 0, 0];

/** Ride the chop: heave on the water level, pitch / roll from the slope under the body (softened over its length). */
function ride(sim, b, lvl, h, extraY = 0) {
  chop(sim, b.x, b.z, _c);
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  b.y = lvl + _c[0] * 0.8 + extraY;
  ease(b, 'wp', Math.atan(_c[1] * c + _c[2] * s) * 0.75, 8, h);
  ease(b, 'roll', -Math.atan(-_c[1] * s + _c[2] * c) * 0.75, 8, h);
}

/** Flock centre (members on the water), or null. */
function centroid(F) {
  let n = 0, x = 0, z = 0;
  for (const o of F.members) if (o.st === 'swim' && !o.hidden) { x += o.x; z += o.z; n++; }
  return n ? [x / n, z / n] : null;
}

/** New wander centre for the flock: open water within 8 m of home (eiders keep off the shore). */
function wander(sim, F, eider) {
  const r = sim.rnd, e = sim.env;
  for (let k = 0; k < 10; k++) {
    const a = r() * TAU, d = r() * 8, x = F.hx + Math.cos(a) * d, z = F.hz + Math.sin(a) * d, s = e.water(x, z);
    if (s && !s.ice && s.depth > (eider ? 0.8 : 0.4) && (!eider || s.shore > 2.5) && sim._inBounds(x, z, 3)) { F.cx = x; F.cz = z; return; }
  }
  F.cx = F.hx; F.cz = F.hz;
}

/** A paddling target round the flock centre (open water, no ice). */
function paddleTarget(sim, b, F) {
  const r = sim.rnd, e = sim.env;
  for (let k = 0; k < 8; k++) {
    const a = r() * TAU, d = r() * 2.4, x = F.cx + Math.cos(a) * d, z = F.cz + Math.sin(a) * d, s = e.water(x, z);
    if (s && !s.ice && s.depth > 0.35 && sim._inBounds(x, z)) { b.wx = x; b.wz = z; return true; }
  }
  b.wx = F.cx; b.wz = F.cz; return true;
}

/** Next activity on the water. */
function nextAct(sim, b, F, s) {
  const r = sim.rnd, H = b.duck, p = r();
  const far = Math.hypot(b.x - F.cx, b.z - F.cz) > 4.5;
  b.act = 'drift'; b.at = 3 + r() * 6;
  if (far || p < 0.36) {
    paddleTarget(sim, b, F); b.act = 'paddle'; b.vw = H.cruise * (0.75 + 0.5 * r());
    b.at = 4 + (Math.hypot(b.wx - b.x, b.wz - b.z) / b.vw) * 1.6;
    return;
  }
  if (p < 0.52) { b.act = 'preen'; b.at = 3 + r() * 6; b.pside = r() < 0.5 ? -1 : 1; b.pt = 0; b.pspot = 0; return; }
  if (p < 0.6) { b.act = 'rest'; b.at = 8 + r() * 14; b.pside = r() < 0.5 ? -1 : 1; return; }
  if (p < 0.69) { // feeding: eiders dive (~15 % of the time under water), mallards up-end
    if (H.dive && s.depth > 1.0) { b.act = 'dive'; b.at = 99; b.dv = 0; b.dt = 0; b.dur = 8 + r() * 9; return; }
    if (!H.dive) { b.act = 'upend'; b.at = 2 + r() * 3.5; return; }
  }
  if (p < 0.74) { b.act = 'flap'; b.at = 1.5; b.ft = 0; }
}

/**
 * One duck sitting on the water (st 'swim'): threats, flock contagion, the current activity, paddling, spacing,
 * drift, riding the chop, and the pose channels (head, neck, tail, wings) eased to their targets.
 */
export function duckSwim(sim, b, h) {
  const e = sim.env, r = sim.rnd, H = b.duck, S = b.S, F = sim.flocks[b.flock];
  const s = e.water(b.x, b.z);
  if (!s) { b.st = 'takeoff'; b.tt = 3; b.ty = b.y + 4; b.hidden = false; b.act = ''; b.tx = b.hx; b.tz = b.hz; return; }
  b.gy = s.level; b.at -= h; b.tt = 30;
  if (F.tick !== sim.t) { F.tick = sim.t; F.ct -= h; if (F.ct <= 0) { F.ct = 25 + r() * 25; wander(sim, F, H.dive); } } // once per step
  if (b.act === 'dive' && b.dv >= 1) { underwater(sim, b, h, s); return; }
  // danger: inside the wary radius (or the flock is going) → flush; just outside it → alert
  const T = sim._nervous(b);
  if (T) { sim._flee(b, T.x, T.z); return; }
  if (sim.t - F.alarmT < 3) { sim._flee(b, F.ax, F.az); return; }
  const Wt = sim._wary(b);
  if (Wt && b.act !== 'alert' && b.act !== 'dive') { b.act = 'alert'; b.at = 3 + r() * 2; b.thx = Wt.x; b.thz = Wt.z; }
  else if (Wt && b.act === 'alert') { b.at = Math.max(b.at, 2); b.thx = Wt.x; b.thz = Wt.z; }
  if (b.at <= 0 && b.act !== 'dive') nextAct(sim, b, F, s);
  // calls: a soft coo / quack now and then (quiet, the audio side spaces them out)
  b.callT -= h;
  if (b.callT <= 0) {
    b.callT = H.callEvery[0] + r() * (H.callEvery[1] - H.callEvery[0]);
    if (!b.hidden && b.act !== 'rest' && b.act !== 'dive' && b.act !== 'upend') { e.call?.(b); b.cooT = H.dive && !b.hen ? 0.9 : 0.35; } // a drake eider coos with a head-throw
  }
  const up = sim._upwind(b), W = sim._w, ws = Math.hypot(W[0], W[1]);
  let vt = 0, face = null, look = 0.5, peck = 0, yawLook = null, nU = 0, nF = 0, wag = 0, cock = 0, pitch = 0, yo = 0, sep = H.sep, dab = 0, lookRate = 1;
  switch (b.act) {
    case 'paddle': {
      const dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { b.act = 'drift'; b.at = 2 + r() * 4; break; }
      face = Math.atan2(dz, dx); vt = b.vw * smooth(Math.min(1, d / 0.9)); look = 0.35;
      break;
    }
    case 'alert': { // necks up, heads to the danger, swim off away from it, bunched a little
      face = Math.atan2(b.z - b.thz, b.x - b.thx); vt = 0.42; nU = 0.075; nF = 0.015; sep = H.sep * 0.75; look = 0;
      yawLook = clamp(wrapA(Math.atan2(b.thz - b.z, b.thx - b.x) - b.yaw), -1.3, 1.3); peck = -0.12;
      if (b.at <= 0.2) b.act = '';
      break;
    }
    case 'preen': { // bill in the feathers: back (head turned right round), flank, breast; switching spots
      b.pt += h;
      if (b.pt > 1.2 + (b.pref * 7 % 1)) { b.pt = 0; b.pspot = (b.pspot + 1 + ((r() * 2) | 0)) % 3; if (r() < 0.3) b.pside = -b.pside; }
      const sd = b.pside, nib = Math.sin(sim.t * 9.3 + b.pref * 11) * 0.1;
      if (b.pspot === 0) { yawLook = sd * 2.55 + nib; peck = 0.3 + nib; } else if (b.pspot === 1) { yawLook = sd * 1.95 + nib; peck = 0.75 + nib; } else { yawLook = sd * 0.25 + nib * 0.6; peck = 1.15 + nib; }
      nU = -0.012; lookRate = 0.6; b.rollT = 0.07 * sd;
      if (b.at <= 0 && r() < 0.4) { b.act = 'flap'; b.at = 1.5; b.ft = 0; }
      break;
    }
    case 'rest': { // head laid back on the body, bill tucked in; faces the wind
      yawLook = b.pside * 2.85; peck = 0.42; nU = -0.03; nF = -0.035; lookRate = 0.4;
      if (ws > 1) face = up;
      break;
    }
    case 'flap': { // the wing-flap display: rises up out of the water, a few deep beats, settles back
      b.ft += h; const u = b.ft / 1.5, bump = Math.sin(Math.PI * clamp(u, 0, 1));
      yo = 0.11 * S.len * bump; pitch = 0.6 * bump; nU = 0.05 * bump; peck = -0.25 * bump;
      if (b.ft < h * 1.5) e.disturb?.(b.x, b.z, -0.02, 0.45, 0.3);
      if (u >= 1) { b.act = 'settle'; b.at = 1.1; b.st0 = sim.t; }
      break;
    }
    case 'settle': { // tail wag after a landing / dive / flap: a quick shake that dies away
      const t = sim.t - (b.st0 ?? sim.t); wag = 0.35 * Math.sin(t * 42) * Math.exp(-t * 3.5);
      break;
    }
    case 'upend': { // mallard dabbling: tail up, head under, paddling to hold the pose
      dab = 1; wag = 0.12 * Math.sin(sim.t * 7 + b.pref * 5);
      if (b.at <= 0.4) dab = 0;
      break;
    }
    case 'dive': diveStart(sim, b, h, s); return;
    default: // drift: float, look round, swing into the wind
      if (ws > 0.8) face = up;
  }
  if (b.cooT > 0) { // calling: neck up, the drake eider throws its head back as it coos
    b.cooT -= h; const k = Math.sin(Math.PI * Math.min(1, b.cooT / (H.dive && !b.hen ? 0.9 : 0.35)));
    nU = Math.max(nU, 0.05 * k); yawLook = 0; if (H.dive && !b.hen) peck = -0.6 * k; else peck = -0.15 * k;
  }
  // pose channels
  ease(b, 'dab', dab, dab > b.dab ? 3 : 4, h);
  if (b.act !== 'preen') b.rollT = 0;
  // looks: saccades between glances (look amount), or the held head yaw of the activity
  if (yawLook === null) {
    b.lt -= h; if (b.lt <= 0) { b.lt = 1 + r() * 3.2; b.lookT = r() < 0.75 ? (r() - 0.5) * 2 * look : 0; }
    yawLook = b.lookT;
  }
  b.look += clamp((yawLook - b.look) * Math.min(1, 10 * lookRate * h), -5 * lookRate * h, 5 * lookRate * h);
  ease(b, 'peck', peck, 6, h); ease(b, 'neckU', nU, 4, h); ease(b, 'neckF', nF, 4, h);
  ease(b, 'cock', cock + 0.1 * b.dab, 5, h); b.wag = wag;
  ease(b, 'pitch', pitch, 6, h); ease(b, 'wset', 0, 5, h);
  ease(b, 'amp', b.act === 'flap' && b.ft > 0.2 && b.ft < 1.25 ? 1 : 0, 9, h);
  ease(b, 'fold', b.act === 'flap' && b.ft > 0.12 && b.ft < 1.3 ? 0 : 1, b.act === 'flap' ? 10 : 5, h);
  if (b.amp > 0.02) b.ph = (b.ph + TAU * S.flapHz * 1.35 * h) % TAU;
  b.bank *= 1 - Math.min(1, 4 * h);
  // paddling: eased speed with a surge on each stroke (~1.8 Hz), eased turns (≤ 0.9 rad/s)
  b.sph = (b.sph + TAU * 1.8 * h) % TAU;
  const vv = vt > 0 ? vt * (1 + 0.22 * Math.sin(b.sph)) : 0;
  b.v = Math.max(0, b.v + clamp((vv - b.v) * 1.3, -0.35, 0.3) * h);
  const tmax = b.act === 'alert' ? 1.6 : 0.9, want = face === null ? 0 : clamp(wrapA(face - b.yaw) * 1.6, -tmax, tmax);
  b.yr += clamp(want - b.yr, -3 * h, 3 * h);
  b.yaw = wrapA(b.yaw + b.yr * h);
  // spacing: slide away from flockmates closer than `sep` (ducks scull sideways)
  let sx = 0, sz = 0;
  for (const o of F.members) {
    if (o === b || o.st !== 'swim' || o.hidden) continue;
    const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz);
    if (d < sep && d > 1e-4) { const k = (1 - d / sep) * 0.35; sx += (dx / d) * k; sz += (dz / d) * k; }
  }
  const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
  const nx = b.x + (c * b.v + sx + W[0] * 0.025 + s.flow[0] * 0.9) * h, nz = b.z + (sn * b.v + sz + W[1] * 0.025 + s.flow[1] * 0.9) * h;
  const q = e.water(nx, nz);
  if (q && !q.ice && q.depth > 0.2 && sim._inBounds(nx, nz, 1)) { b.x = nx; b.z = nz; }
  else { b.v *= 0.5; if (b.act === 'paddle') { b.wx = F.cx; b.wz = F.cz; } }
  if (b.v > 0.12 && r() < h * 0.7) e.ripple?.(b.x + c * S.len * 0.3, b.z + sn * S.len * 0.3, 0.008);
  ride(sim, b, (q || s).level, h, yo);
  b.roll += (b.rollT || 0) * Math.min(1, 3 * h);
}

/** The plunge (eider): nose down, a little forward leap with the tail flicked up, gone with a ring. */
function diveStart(sim, b, h, s) {
  const e = sim.env, L = b.S.len;
  b.dt += h; const u = Math.min(1, b.dt / 0.5);
  b.v = 0.5 * Math.sin(Math.PI * u);
  b.x += Math.cos(b.yaw) * b.v * h; b.z += Math.sin(b.yaw) * b.v * h;
  b.pitch = -1.15 * smooth(u); b.cock = 0.45 * Math.sin(Math.PI * u); b.peck = 0.3 * u; b.neckF = 0.04 * u;
  b.fold = 1 - 0.3 * Math.sin(Math.PI * u); b.look *= 1 - Math.min(1, 8 * h);
  b.y = s.level + L * (0.06 * Math.sin(Math.PI * Math.min(1, u * 1.6)) - 0.3 * Math.max(0, u - 0.55) / 0.45);
  if (u >= 1) {
    b.dv = 1; b.dt = 0; e.disturb?.(b.x, b.z, -0.04, 0.35, 0.35);
    // where it will come up: 2–6 m on, in water deep enough to dive
    for (let k = 0; k < 8; k++) {
      const a = b.yaw + (sim.rnd() - 0.5) * 2, d = 2 + sim.rnd() * 4, x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d, q = e.water(x, z);
      if (q && !q.ice && q.depth > 0.8 && sim._inBounds(x, z)) { b.wx = x; b.wz = z; break; }
      if (k === 7) { b.wx = b.x; b.wz = b.z; }
    }
  }
}

/** Under water: hidden once deep, swims to the surfacing spot; pops up (nose up), a ring, a shake. */
function underwater(sim, b, h, s) {
  const e = sim.env, L = b.S.len;
  b.dt += h;
  const T = b.dur, dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz);
  if (b.dt < T) {
    if (d > 0.1) { b.yaw = Math.atan2(dz, dx); const v = Math.min(0.6, d); b.x += (dx / d) * v * h; b.z += (dz / d) * v * h; }
    b.y = s.level - Math.min(0.9, 0.18 * L + 0.8 * b.dt); b.hidden = b.y < s.level - 0.3; b.v = 0;
    b.pitch = -0.4;
    return;
  }
  // back up: buoyant, from the depth it swam at (unseen below 0.3 m), breaking the surface nose-up with a ring
  if (b.y0 == null) b.y0 = b.y;
  const u = Math.min(1, (b.dt - T) / 0.7), y = s.level + (b.y0 - s.level) * (1 - smooth(u));
  if (b.hidden && y > s.level - 0.3) { b.hidden = false; e.disturb?.(b.x, b.z, 0.05, 0.4, 0.25); }
  b.y = y; b.pitch = 0.4 * (1 - u); b.cock = 0; b.peck = -0.1 * (1 - u); b.fold = 1;
  if (u >= 1) { b.dv = 0; b.y0 = null; b.act = 'settle'; b.at = 1.1; b.st0 = sim.t; if (sim.rnd() < 0.3) { b.act = 'flap'; b.at = 1.5; b.ft = 0; } }
}

/**
 * Startled on the water (BirdSim._flee): the flock picks one way out (away from the danger, turned into a strong
 * wind) and each member goes a beat apart; under water a diver hears nothing. Returns true when it flushed.
 */
export function duckFlee(sim, b, x, z) {
  const r = sim.rnd, H = b.duck, F = sim.flocks[b.flock];
  if (b.st === 'swim' && b.act === 'dive' && b.dv >= 1) return false;
  if (b.st !== 'swim' && b.st !== 'skid') { // already in the air: climb away
    const a = Math.atan2(b.z - z, b.x - x) + (r() - 0.5) * 0.8, d = 25 + r() * 25;
    b.tx = b.x + Math.cos(a) * d; b.tz = b.z + Math.sin(a) * d; b.ty = H.alt[1] + 1; b.st = 'flee'; b.tt = 4 + r() * 3;
    return false;
  }
  if (sim.t - F.fleeT > 4) {
    const c = centroid(F) || [b.x, b.z];
    let a = Math.atan2(c[1] - z, c[0] - x);
    const up = sim._upwind(b), ws = Math.hypot(sim._w[0], sim._w[1]), da = wrapA(up - a);
    if (ws > 1.5 && Math.cos(da) > -0.2) a += da * clamp((ws - 1.5) / 6, 0, 0.6);
    // over the map, not off its edge: turn the way out until 35 m along it is inside
    for (const d of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.1, -2.1, 2.7, -2.7]) if (sim._inBounds(c[0] + Math.cos(a + d) * 35, c[1] + Math.sin(a + d) * 35, 6)) { a += d; break; }
    F.fleeA = a; F.fleeT = sim.t;
  }
  if (sim.t - F.alarmT > 3) { F.alarmT = sim.t; F.ax = x; F.az = z; } // the rest of the flock follows on its next step
  const a = F.fleeA + (r() - 0.5) * 0.35, d = 30 + r() * 20;
  b.st = 'flee'; b.tt = 4 + r() * 3; b.act = ''; b.dab = 0; b.dv = 0; b.hidden = false; b.slotLead = null;
  b.tx = b.x + Math.cos(a) * d; b.tz = b.z + Math.sin(a) * d; b.ty = (b.gy ?? 0) + H.alt[0] + r() * (H.alt[1] - H.alt[0]);
  b.run = { t: -(0.04 + r() * 0.4), dur: H.run ? H.runT[0] + r() * (H.runT[1] - H.runT[0]) : 0, a, pat: 0, side: 1, started: false, lvl: b.y };
  b.vx = b.vz = 0; b.vy = 0;
  sim.stats.flushes++; sim.env.flush?.(b);
  return true;
}

/** The take-off: a startled beat (neck up, turning), then the eider's run across the water or the mallard's jump. */
export function duckRun(sim, b, h) {
  const R = b.run, e = sim.env, H = b.duck, S = b.S, L = S.len;
  R.t += h;
  const s = e.water(b.x, b.z), lvl = s ? s.level : R.lvl;
  const turn = (rate) => { b.yaw = wrapA(b.yaw + clamp(wrapA(R.a - b.yaw), -rate * h, rate * h)); };
  if (R.t < 0) {
    ease(b, 'neckU', 0.075, 10, h); ease(b, 'neckF', 0.02, 10, h); ease(b, 'peck', -0.15, 10, h); b.look *= 1 - Math.min(1, 10 * h);
    b.dab *= 1 - Math.min(1, 12 * h); b.pitch *= 1 - Math.min(1, 10 * h); b.cock *= 1 - Math.min(1, 10 * h); b.wag = 0;
    turn(2.5); b.y = lvl; b.vy = 0;
    return;
  }
  if (!R.started) { R.started = true; e.splash?.(b.x, b.z, H.run ? 0.28 : 0.4); sim.stats.splashes++; }
  const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
  if (!H.run) { // mallard: springs straight up off the water on its first downstroke
    b.run = null; b.vy = 3.4; b.vx = c * 1.2; b.vz = sn * 1.2; b.fold = 0.25; b.amp = 0.95; b.pitch = 0.5;
    e.disturb?.(b.x, b.z, -0.06, 0.7, 0.65);
    return;
  }
  const u = Math.min(1, R.t / R.dur);
  turn(2.2);
  b.v = Math.min(H.lift, b.v + (H.lift / R.dur) * 1.1 * h);
  const nx = b.x + c * b.v * h, nz = b.z + sn * b.v * h, q = e.water(nx, nz);
  b.x = nx; b.z = nz;
  const rise = L * 0.07 / R.dur; b.vy = rise; b.y = lvl + L * 0.07 * u;
  ease(b, 'pitch', 0.2, 8, h); ease(b, 'fold', 0, 14, h); ease(b, 'amp', 1, 10, h); ease(b, 'wset', 0, 8, h);
  ease(b, 'neckF', 0.06, 6, h); ease(b, 'neckU', 0.02, 6, h); ease(b, 'peck', -0.1, 6, h); b.wag = 0;
  b.wp *= 1 - Math.min(1, 6 * h); b.roll *= 1 - Math.min(1, 6 * h);
  const p0 = b.ph; b.ph = (b.ph + TAU * S.flapHz * 1.3 * h) % TAU;
  const BOT = 1.5 * Math.PI, crossed = p0 < BOT ? b.ph >= BOT || b.ph < p0 : false;
  if (u < 0.7 && crossed) for (const sd of [1, -1]) { // wingtips slap the water at the bottom of the downstroke
    const wx = b.x - c * L * 0.1 - sn * sd * S.span * 0.45, wz = b.z - sn * L * 0.1 + c * sd * S.span * 0.45;
    e.disturb?.(wx, wz, -0.015, 0.25, 0.5);
  }
  R.pat -= h;
  if (R.pat <= 0 && u < 0.95) { // feet pattering on the surface, alternate sides
    R.pat = 0.07 + 0.03 * (1 - u); R.side = -R.side;
    e.disturb?.(b.x - c * L * 0.15 - sn * R.side * L * 0.07, b.z - sn * L * 0.15 + c * R.side * L * 0.07, -0.018, 0.22, 0.55);
  }
  if (u >= 1 || !q || q.ice) { b.run = null; b.vx = c * b.v; b.vz = sn * b.v; b.vy = 1.2; b.v = 0; }
}

/** Flight posture: neck stretched forward, head level, tail straight, no wave rocking. */
function flightPose(b, h) {
  ease(b, 'neckF', 0.07, 5, h); ease(b, 'neckU', -0.025, 5, h); ease(b, 'peck', -0.08, 5, h);
  b.look *= 1 - Math.min(1, 6 * h); b.cock *= 1 - Math.min(1, 6 * h); b.dab *= 1 - Math.min(1, 8 * h); b.wag = 0;
  b.wp *= 1 - Math.min(1, 6 * h); b.roll *= 1 - Math.min(1, 6 * h);
}

/** The flock's leader in the air (the first bird up), or a recently landed one the others come down beside. */
function leadOf(sim, F, b) {
  const L = F.lead;
  if (L && L !== b && ((airborne(L) && !L.run) || ((L.st === 'swim' || L.st === 'skid') && F.downT != null && sim.t - F.downT < 25))) return L;
  if (L === b && airborne(b)) return b;
  F.lead = b; F.nslot = 0; F.downT = null;
  return b;
}

/**
 * Ducks in the air (flee / fly): the take-off run first; the leader flies the generic route (away, then a circuit
 * back over home and in to land), the others hold formation slots off its heading (a line / loose V) and come down
 * beside it.
 */
export function duckAir(sim, b, h) {
  const e = sim.env, S = b.S, r = sim.rnd, F = sim.flocks[b.flock];
  b.gy = Math.max(e.ground(b.x, b.z), e.water(b.x, b.z)?.level ?? -9); // heights over the water surface, not its bed
  if (b.run) { duckRun(sim, b, h); return; }
  const L = leadOf(sim, F, b);
  if (L !== b) {
    if (L.st === 'final' || L.st === 'skid' || L.st === 'swim') { landBeside(sim, b, L); flightPose(b, h); return; }
    if (b.slotLead !== L) { b.slotLead = L; b.slot = ++F.nslot; }
    const k = b.slot, side = k % 2 ? 1 : -1, rank = Math.ceil(k / 2), c = Math.cos(L.yaw), s = Math.sin(L.yaw);
    const back = 1.7 * rank + 0.35 * ((k * 7) % 3), lat = side * 1.15 * rank;
    const sx = L.x - c * back - s * lat, sz = L.z - s * back + c * lat, sy = L.y + 0.1 * rank;
    const along = (sx - b.x) * c + (sz - b.z) * s;
    const spd = clamp(Math.hypot(L.vx, L.vz) + clamp(along * 1.2, -3, 5), 3, S.air * 1.35);
    sim._fly(b, h, sx + L.vx * 0.5 + c * 2, sy, sz + L.vz * 0.5 + s * 2, spd, 3); // aim where the slot will be
    sim._wings(b, h, 1, 1.05);
    if (b.st === 'flee' && L.st !== 'flee') b.st = 'fly';
    b.tt = Math.max(b.tt, 1);
  } else {
    const fleeing = b.st === 'flee' || b.st === 'takeoff';
    const d = sim._fly(b, h, b.tx, b.ty, b.tz, S.air * (fleeing ? 1.1 : 1), 3);
    sim._wings(b, h, 1, fleeing ? 1.15 : 1);
    if (fleeing && (b.tt <= 0 || d < 10)) { // clear of the danger: a circuit back round home
      const H = b.duck;
      let a = r() * TAU;
      for (let k = 0; k < 8 && !sim._inBounds(b.hx + Math.cos(a) * 25, b.hz + Math.sin(a) * 25, 6); k++) a = r() * TAU; // circuit over the map
      b.st = 'fly'; b.ty = b.gy + H.alt[0] + r() * (H.alt[1] - H.alt[0]); b.tx = b.hx + Math.cos(a) * 25; b.tz = b.hz + Math.sin(a) * 25; b.tt = 20 + r() * 20;
    } else if (b.st === 'fly' && d < 8) { if (!sim._startLanding(b)) { b.tx = b.hx; b.tz = b.hz; } }
  }
  ease(b, 'wset', 0, 5, h);
  flightPose(b, h);
}

/** Come down beside the leader: a spot off its landing point by this bird's slot, else a spot of its own. */
function landBeside(sim, b, L) {
  const e = sim.env, k = b.slot || 1, side = k % 2 ? 1 : -1, rank = Math.ceil(k / 2), a = L.yaw;
  const bx = L.st === 'swim' ? L.x : L.tx, bz = L.st === 'swim' ? L.z : L.tz;
  const x = bx - Math.cos(a) * 1.2 * rank - Math.sin(a) * side * 1.1 * rank, z = bz - Math.sin(a) * 1.2 * rank + Math.cos(a) * side * 1.1 * rank;
  const s = e.water(x, z);
  if (s && !s.ice && s.depth > 0.3 && sim._inBounds(x, z)) { b.tx = x; b.ty = s.level; b.tz = z; b.land = 'swim'; b.st = 'approach'; b.tt = 0; return; }
  if (!sim._startLanding(b)) { b.st = 'fly'; b.tx = b.hx; b.tz = b.hz; b.tt = 10; }
  b.slotLead = null;
}

/** Swing round to come in from downwind, low (a long final follows). */
export function duckApproach(sim, b, h) {
  const e = sim.env, S = b.S;
  b.gy = e.ground(b.x, b.z);
  const u = sim._upwind(b), ax = b.tx - Math.cos(u) * 14, az = b.tz - Math.sin(u) * 14;
  b.gy = Math.max(e.ground(b.x, b.z), e.water(b.x, b.z)?.level ?? -9);
  const d = sim._fly(b, h, ax, b.ty + 2.4, az, S.air * 0.85);
  sim._wings(b, h, 0.85);
  ease(b, 'wset', 0, 5, h);
  flightPose(b, h);
  if (d < 3 || b.tt < -25) { b.st = 'final'; b.tt = 12; b.td = false; }
}

/**
 * The final: a straight shallow glide to the spot on set wings (a shallow V, small quick whiffling beats), braking
 * beats over the last 3 m with the body pitched up; at the surface the bird skids.
 */
export function duckFinal(sim, b, h) {
  const e = sim.env, H = b.duck, S = b.S, F = sim.flocks[b.flock];
  const s = e.water(b.tx, b.tz), lvl = s?.level ?? b.ty; b.ty = lvl;
  const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
  if (d > 0.3) b.yaw = wrapA(b.yaw + clamp(wrapA(Math.atan2(dz, dx) - b.yaw), -1.8 * h, 1.8 * h));
  const vh = Math.hypot(b.vx, b.vz), vt = clamp(2.6 + d * 0.4, 2.6, S.air * 0.75), nv = vh + clamp(vt - vh, -3 * h, 2 * h);
  b.vx = Math.cos(b.yaw) * nv; b.vz = Math.sin(b.yaw) * nv;
  // on the glide path to a touchdown ~1.5 m short of the spot (aimed a touch below the surface: it always arrives)
  const hT = lvl - 0.06 + Math.max(0, d - 1.5) * H.slope, ahead = Math.cos(wrapA(Math.atan2(dz, dx) - b.yaw)) > 0 ? 1 : 0;
  b.vy += (clamp(-H.slope * nv * ahead + (hT - b.y) * 2.5, -2.4, 0.5) - b.vy) * Math.min(1, 8 * h);
  b.x += b.vx * h; b.z += b.vz * h; b.y += b.vy * h;
  const brake = d < 3;
  ease(b, 'fold', 0, 6, h); ease(b, 'amp', brake ? 0.85 : 0.16, 6, h); ease(b, 'wset', brake ? 0.15 : 0.42, 4, h);
  b.ph = (b.ph + TAU * S.flapHz * (brake ? 1.15 : 1.5) * h) % TAU;
  ease(b, 'pitch', brake ? 0.4 : 0.12, 5, h); b.bank *= 1 - Math.min(1, 4 * h);
  flightPose(b, h); ease(b, 'neckF', 0.04, 5, h); ease(b, 'peck', -0.15, 5, h);
  if (b.y <= lvl + 0.01 || b.tt <= 0) { // touchdown at speed: skid
    b.st = 'skid'; b.v = clamp(nv, 0.8, 4); b.vx = b.vz = b.vy = 0; b.y = lvl; b.sprayT = 0;
    sim.stats.landings++; e.splash?.(b.x, b.z, 0.2 + 0.04 * b.v); sim.stats.splashes++;
    if (F.lead === b && F.downT == null) F.downT = sim.t;
  }
}

/** The skid: run out along the water on the tail and feet, spray, wings up then folded; then swimming. */
export function duckSkid(sim, b, h) {
  const e = sim.env, S = b.S, L = S.len, s = e.water(b.x, b.z);
  b.v = Math.max(0, b.v - (1.6 + 1.5 * b.v) * h);
  const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), nx = b.x + c * b.v * h, nz = b.z + sn * b.v * h, q = e.water(nx, nz);
  if (q && !q.ice) { b.x = nx; b.z = nz; } else b.v = 0;
  b.y = (q || s)?.level ?? b.y; b.vy = 0;
  ease(b, 'pitch', b.v > 1 ? 0.22 : 0, 5, h); ease(b, 'wset', b.v > 1.2 ? 0.95 : 0.2, 5, h);
  b.amp *= 1 - Math.min(1, 8 * h); ease(b, 'fold', b.v < 1.3 ? 1 : 0, 4, h);
  ease(b, 'neckF', 0.01, 4, h); ease(b, 'neckU', 0.02, 4, h); ease(b, 'peck', -0.05, 4, h); b.bank *= 1 - Math.min(1, 6 * h);
  b.sprayT -= h;
  if (b.sprayT <= 0 && b.v > 0.4) { b.sprayT = 0.05; const k = Math.min(1, b.v / 3); e.disturb?.(b.x - c * L * 0.1, b.z - sn * L * 0.1, -0.02 * k, 0.2 + 0.05 * b.v, 0.6 * k); }
  if (b.v < 0.12 && b.fold > 0.9) {
    sim._settle(b, 'swim', null);
    b.act = 'settle'; b.at = 1.1; b.st0 = sim.t; b.slotLead = null; b.wset = 0;
  }
}
