/**
 * Ground locomotion of the birds that stand on their feet (crows in the fields, gulls on pier decks). Pure and
 * deterministic, stepped by BirdSim on sim time. The feet live in WORLD space: a planted foot never moves (no foot
 * sliding by construction), a swinging foot travels on a low arc from where it lifted to where the hip will be when
 * it lands, and only one foot swings at a time (alternating walking gait; the steps also shuffle the bird round when
 * it turns on the spot). The head nods forward with each step: a smooth, gait-locked head-bob, slower than the body
 * while a foot is planted and faster as it swings, never stopping dead. All of it eases (user report 2026-10-01: "Birds
 * are jerking when walking make their movement smoother"). In the air the feet follow the body and tuck back under the belly.
 * Rendering: src/art/bird-model.js turns the world feet into per-instance leg offsets.
 * @module world/bird-ground
 */
const TAU = Math.PI * 2;
export const wrapA = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/**
 * Leg / stance dimensions (m) from the species body length: body-centre height when standing, hip (local x, y),
 * half the foot spacing, leg length, swing lift, toe length, deepest crouch.
 */
export function legDims(S) {
  const L = S.len, ry = L * 0.12;
  return { stand: L * 0.27, hipX: L * 0.02, hipY: -ry * 0.5, zr: L * 0.12 * 0.45, leg: L * 0.27 - ry * 0.5, lift: L * 0.05, toe: L * 0.09, crouch: L * 0.045 };
}

/** World rest point (x, z) of foot i (0: left, local +z; 1: right) with the hip moved `ahead` m along the heading. */
export function restFoot(b, i, ahead, out) {
  const G = b.G, c = Math.cos(b.yaw), s = Math.sin(b.yaw), sd = i ? -1 : 1, f = G.hipX + ahead;
  out.x = b.x + c * f - s * sd * G.zr; out.z = b.z + s * f + c * sd * G.zr;
  return out;
}

const _r = { x: 0, z: 0 };

/** Both feet planted on the ground at their rest points. */
export function feetInit(b, ground) {
  b.feet = [0, 1].map((i) => { restFoot(b, i, 0, _r); return { x: _r.x, y: ground(_r.x, _r.z), z: _r.z, s: -1, air: false, rx: 0, ry: 0, rz: 0, T: 0.12, ah: 0, ox: 0, oy: 0, oz: 0 }; });
  b.tuck = 0; b.bob = 0; b.bobv = 0; b.bph = null; b.bw = 0; b.bpc = 0; b.look = 0; b.lookT = 0; b.sway = 0; b.lastFoot = 1; b.stepAge = 1; b.stepDt = 0.3;
}

/** Touch down: every foot (in the air or mid-swing) is planted where it is, on the ground. */
export function feetPlant(b, ground) {
  for (const f of b.feet) { f.air = false; f.s = -1; f.y = ground(f.x, f.z); }
  b.wasMoving = false; b.pend = -1; // feet side by side: a landing run-out starts stepping at once (gait clock restarts)
}

/**
 * In the air: the feet hang off the body (world-oriented offset eased to the body-attached target, so leaving the
 * ground is continuous), reaching forward for a landing at tuck 0 and folded back under the belly at tuck 1.
 */
export function feetAir(b, h, tuckTarget) {
  const G = b.G, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  b.tuck += (tuckTarget - b.tuck) * Math.min(1, 5 * h);
  const e = 1 - Math.min(1, 6 * h); b.look *= e; b.bob *= e; b.sway *= e; b.peck *= e; b.bobv = (b.bobv || 0) * e; b.swayv = (b.swayv || 0) * e; // head and body settle in flight
  const t = b.tuck, k = Math.min(1, 12 * h);
  b.feet.forEach((f, i) => {
    if (!f.air) { f.air = true; f.s = -1; f.rx = f.x - b.x; f.ry = f.y - b.y; f.rz = f.z - b.z; }
    const sd = i ? -1 : 1, lx = G.hipX + G.leg * (0.3 - t), lz = sd * G.zr * (1 - 0.4 * t), ly = -G.stand + G.leg * 0.85 * t;
    f.rx += (c * lx - s * lz - f.rx) * k; f.rz += (s * lx + c * lz - f.rz) * k; f.ry += (ly - f.ry) * k;
    f.x = b.x + f.rx; f.y = b.y + f.ry; f.z = b.z + f.rz;
  });
}

/** Stride time C (s, one left + one right step) at ground speed v: 0.58 s strolling … 0.38 s brisk (≈3.5–5 steps/s). */
export const strideTime = (v) => clamp(0.6 - 0.3 * v, 0.38, 0.58);
/**
 * Swing share of the stride per foot: 0.4 C at a stroll (both feet down for 20 % of the stride: planted, unhurried),
 * rising to 0.5 C (no double support) at a brisk walk, so a faster bird lengthens its stride by swinging its feet
 * longer rather than by leaving each foot planted far behind the hip.
 */
export const swingShare = (v) => 0.4 + 0.1 * smooth((v - 0.3) / 0.35);
/** Longest hip-to-foot distance a walking leg is drawn at (× its length; the legs are straight sticks: more reads as a rubber leg). */
export const LEG_REACH = 1.08;
/**
 * Walking stance at speed v: the stance half-length d (m, how far ahead of the hip a foot lands and behind it lifts)
 * and the crouch (m) the body walks at so that a foot that far off still sits within LEG_REACH of the hip: a stroll
 * walks tall, a brisk walk on slightly bent legs (≤ ~2 cm on a crow), smoothly with the speed.
 */
export function stance(v, G, out) {
  const C = strideTime(v), sw = swingShare(v), d = (v * (1 - sw) * C) / 2, x = d / G.leg;
  out.C = C; out.T = sw * C; out.d = d; out.crouch = G.leg * Math.max(0, 1 - Math.sqrt(Math.max(0, LEG_REACH * LEG_REACH - x * x)));
  return out;
}
const _st = { C: 0, T: 0, d: 0, crouch: 0 };

/**
 * Critically damped spring of `o[k]` (velocity in `o[k + 'v']`) towards `target` at ω rad/s over h s, integrated exactly
 * (stable at any step): position AND velocity stay continuous, so whatever drives the target never shows as a pop.
 */
export function spring(o, k, target, w, h) {
  const kv = k + 'v', x = o[k] - target, v = o[kv] || 0, e = Math.exp(-w * h), c = v + w * x;
  o[k] = target + (x + c * h) * e; o[kv] = (v - w * c * h) * e;
}

/**
 * Head-bob (m, the head's offset along the body axis): a smooth oscillation, one cycle per step, phase-locked to the
 * gait clock (the lock only bends the oscillator's rate, it never jumps), amplitude proportional to the speed, hardly
 * pulled back into the body. The head slows to ~0.55 × body speed while the foot is planted and passes it as the foot
 * swings: the crow's nod, but with a continuous velocity (no stop-dead / lurch). A critically damped spring on top
 * absorbs speed changes, landings and stops.
 */
function headBob(b, h, v, C, moving) {
  const rate = moving ? 2 / C : 0; // steps per second
  b.bw = (b.bw || 0) + (rate - (b.bw || 0)) * Math.min(1, 6 * h);
  if (moving && b.gph != null) {
    if (b.bph == null || (b.bw < 0.3 && Math.abs(b.bob) < 1e-3)) b.bph = (2 * b.gph) % 1;
    let e = (2 * b.gph - b.bph) % 1; e = e - Math.round(e); // phase error to the step clock, −0.5 … 0.5
    b.bpc = (b.bpc || 0) + (clamp(1.5 * e, -0.35, 0.35) - (b.bpc || 0)) * Math.min(1, 5 * h);
  } else b.bpc = (b.bpc || 0) * (1 - Math.min(1, 5 * h));
  b.bph = ((b.bph ?? 0) + h * b.bw * (1 + b.bpc)) % 1;
  // amplitude: A·ω = 0.45 v (head speed 0.55 … 1.45 × body speed); fastest forward at mid-swing (step phase 0.4); the
  // head sits a little forward while walking (neck stretched), so it never sinks more than ~3 mm into the body
  const A = Math.min(b.G.leg * 0.09, (0.45 * v * C) / (4 * Math.PI)), tgt = A * (0.7 + Math.sin(TAU * (b.bph - 0.4)));
  spring(b, 'bob', tgt, 40, h);
}

/**
 * Walking gait at ground speed b.v (m/s along the heading). A gait clock runs one cycle per stride (strideTime: 0.58 s
 * slow … 0.38 s brisk, so 3.5–5 steps/s of 7–14 cm); the feet strictly alternate, the left due at phase 0, the right
 * at 0.5, each swinging for T = swingShare·C and landing v(C − T)/2 ahead of where its hip will be, which centres the
 * stance under the hip; the body walks at the stance's crouch so no leg is drawn past LEG_REACH. A step whose other
 * foot would be left trailing (feet side by side at a landing run-out) swings quicker. A swinging foot eases off the ground and back down (zero vertical speed at lift-off
 * and touchdown). Standing or turning on the spot, a foot that is >1.5 cm off its rest point shuffles back under the
 * hip. Head-bob: headBob. Returns the body's lift / waddle weight (0 … 1, zero slope at each lift-off and touchdown).
 */
export function feetGait(b, h, ground) {
  const G = b.G, v = b.v, moving = v > 0.03, F = b.feet;
  // cadence and foot placement for the speed the body will have mid-stance (speeding up: longer, earlier steps, so a
  // foot is never left trailing far behind the hip)
  const ve = Math.max(v, v + (b.va || 0) * 0.2), { C, T } = stance(ve, G, _st), d = moving ? _st.d : 0;
  b.wcr = (b.wcr || 0) + ((moving ? _st.crouch : 0) - (b.wcr || 0)) * Math.min(1, 6 * h); // walking crouch for that stance, eased (BirdSim springs the body to it)
  b.stepAge += h;
  // a planted foot trailing the hip by more than a normal stance (a landing run-out, a quick start, a turn): quicken the
  // steps (the swing under way and the gait clock) until it is caught up, rather than letting the leg overstretch
  let lag = 0, swing = -1;
  if (moving) F.forEach((f, i) => { if (f.s < 0) { restFoot(b, i, 0, _r); lag = Math.max(lag, Math.hypot(f.x - _r.x, f.z - _r.z) - d - G.leg * 0.05); } });
  b.gr = (b.gr || 1) + (1 + clamp((6 * lag) / G.leg, 0, 2) - (b.gr || 1)) * Math.min(1, 15 * h); // eased: no lurch
  const rate = b.gr;
  F.forEach((f, i) => {
    if (f.s < 0) return;
    f.s = Math.min(1, f.s + (h * rate) / f.T);
    restFoot(b, i, f.ah + (v * (1 - f.s) * f.T) / rate, _r);
    const u = smooth(f.s), gy = ground(_r.x, _r.z), q = 4 * f.s * (1 - f.s);
    f.x = f.ox + (_r.x - f.ox) * u; f.z = f.oz + (_r.z - f.oz) * u;
    f.y = f.oy + (gy - f.oy) * u + G.lift * q * q * (moving ? 1 : 0.5);
    if (f.s >= 1) { f.s = -1; f.x = _r.x; f.z = _r.z; f.y = gy; } else swing = i;
  });
  let due = -1;
  if (moving) {
    const p0 = b.gph ?? 0.9, p1 = (b.wasMoving ? p0 : 0.9) + (h * rate) / C;
    if (p1 >= 1) due = 0; else if (p1 >= 0.5 && (b.wasMoving ? p0 : 0.9) < 0.5) due = 1;
    b.gph = p1 % 1;
  }
  b.wasMoving = moving;
  if (due >= 0 && swing >= 0) b.pend = due; // the other foot is still in the air: step as soon as it is down
  if (swing < 0 && due < 0 && b.pend >= 0 && moving) due = b.pend;
  if (due >= 0 && moving) due = 1 - b.lastFoot; // strictly alternate: a delayed step never lets the clock step the same foot twice
  if (swing < 0) {
    const err = F.map((f, i) => { restFoot(b, i, 0, _r); return Math.hypot(f.x - _r.x, f.z - _r.z); });
    let go = due;
    if (go < 0 && moving) { // off-clock: catch up a foot left trailing far behind the hip (never the one that just landed ahead)
      const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw), tr = F.map((f, i) => { restFoot(b, i, 0, _r); return -((f.x - _r.x) * cy + (f.z - _r.z) * sy); });
      const i = tr[0] > tr[1] ? 0 : 1;
      if (tr[i] > d + G.leg * 0.08) go = i;
    } else if (go < 0) { // standing / turning on the spot: shuffle back under the hip
      const i = err[0] + (b.lastFoot === 0 ? -0.004 : 0) > err[1] + (b.lastFoot === 1 ? -0.004 : 0) ? 0 : 1;
      if (err[i] > 0.015 && b.stepAge > 0.2) go = i;
    } else if (err[go] < 0.004 && !moving) go = -1;
    if (go >= 0) {
      const f = F[go];
      b.pend = -1;
      // an off-clock or delayed step re-syncs the clock to this foot (the head-bob's phase lock eases over the jump)
      if (moving && (go !== due || Math.abs(wrapA(TAU * (b.gph - (go ? 0.5 : 0)))) > TAU * 0.1)) b.gph = go ? 0.5 : 0;
      // a quicker step when the other foot would otherwise be left trailing beyond the stance before this one is down
      // (feet side by side at a landing run-out or a brisk start): its swing ends by the time the other foot is d behind
      let Ts = moving ? T : 0.18;
      if (moving) { const o = F[1 - go]; restFoot(b, 1 - go, 0, _r); Ts = clamp(((o.x - _r.x) * Math.cos(b.yaw) + (o.z - _r.z) * Math.sin(b.yaw) + d + G.leg * 0.05) / v, 0.45 * T, T); }
      f.s = 0; f.T = Ts; f.ah = d; f.ox = f.x; f.oy = f.y; f.oz = f.z; swing = go;
      b.lastFoot = go; b.stepDt = Math.min(0.6, b.stepAge); b.stepAge = 0;
    }
  }
  headBob(b, h, v, C, moving);
  // a slight waddle: the body rolls over the planted foot and lifts a little while the other one swings (sin², so the
  // roll and the lift start and end with zero rate: no corner at each lift-off)
  const f = swing >= 0 ? F[swing] : null, w = f ? Math.sin(Math.PI * f.s) ** 2 * Math.min(1, (f.T / rate / 0.18) ** 2) : 0; // quick steps lift it less
  spring(b, 'sway', w * (swing === 0 ? -1 : 1) * 0.05 * Math.min(1, v / 0.3 + 0.3), 30, h);
  return w;
}

/**
 * Turn towards `target` at most `max` rad/s. The turn rate follows a critically damped law (ω 6 rad/s, the rate itself changing ≤ 24 rad/s²) so the heading
 * eases in and settles without overshoot: no snap onto the target, no instant reversals, no cut in the turn rate.
 */
export function turnTo(b, h, target, max) {
  const err = wrapA(target - b.yaw), want = clamp(err * 3, -max, max), y0 = b.yr || 0;
  b.yr = y0 + clamp((want - y0) * Math.min(1, 12 * h), -24 * h, 24 * h); // turn-rate changes ≤ 24 rad/s²
  b.yaw = wrapA(b.yaw + b.yr * h);
  return err;
}

/** Head-down curve of one peck (u 0..1): a quick strike, a short hold at the ground, a slower lift. */
export const peckCurve = (u) => (u < 0.3 ? smooth(u / 0.3) : u < 0.45 ? 1 : 1 - smooth((u - 0.45) / 0.55));
