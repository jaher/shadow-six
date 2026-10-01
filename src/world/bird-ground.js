/**
 * Ground locomotion of the birds that stand on their feet (crows in the fields, gulls on pier decks). Pure and
 * deterministic, stepped by BirdSim on sim time. The feet live in WORLD space: a planted foot never moves (no foot
 * sliding by construction), a swinging foot travels on a low arc from where it lifted to where the hip will be when
 * it lands, and only one foot swings at a time (alternating walking gait; the steps also shuffle the bird round when
 * it turns on the spot). The head holds still in space while a foot is planted and thrusts forward with each step
 * (the head-bob of walking crows and pigeons). In the air the feet follow the body and tuck back under the belly.
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
  b.tuck = 0; b.bob = 0; b.bobT = 0; b.bobA = 0; b.look = 0; b.lookT = 0; b.sway = 0; b.lastFoot = 1; b.stepAge = 1; b.stepDt = 0.3;
}

/** Touch down: every foot (in the air or mid-swing) is planted where it is, on the ground. */
export function feetPlant(b, ground) {
  for (const f of b.feet) { f.air = false; f.s = -1; f.y = ground(f.x, f.z); }
}

/**
 * In the air: the feet hang off the body (world-oriented offset eased to the body-attached target, so leaving the
 * ground is continuous), reaching forward for a landing at tuck 0 and folded back under the belly at tuck 1.
 */
export function feetAir(b, h, tuckTarget) {
  const G = b.G, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  b.tuck += (tuckTarget - b.tuck) * Math.min(1, 5 * h);
  const e = 1 - Math.min(1, 6 * h); b.look *= e; b.bob *= e; b.sway *= e; b.peck *= e; // head and body settle in flight
  const t = b.tuck, k = Math.min(1, 12 * h);
  b.feet.forEach((f, i) => {
    if (!f.air) { f.air = true; f.s = -1; f.rx = f.x - b.x; f.ry = f.y - b.y; f.rz = f.z - b.z; }
    const sd = i ? -1 : 1, lx = G.hipX + G.leg * (0.3 - t), lz = sd * G.zr * (1 - 0.4 * t), ly = -G.stand + G.leg * 0.85 * t;
    f.rx += (c * lx - s * lz - f.rx) * k; f.rz += (s * lx + c * lz - f.rz) * k; f.ry += (ly - f.ry) * k;
    f.x = b.x + f.rx; f.y = b.y + f.ry; f.z = b.z + f.rz;
  });
}

/**
 * Walking gait at ground speed b.v (m/s along the heading). A gait clock runs one cycle per stride (cycle C 0.36 s
 * slow … 0.22 s brisk); the left foot steps at phase 0, the right at 0.5, each swinging for 0.42 C (duty factor
 * ~0.58, so one foot is always down) and landing v(C − T)/2 ahead of where its hip will be, which centres the stance
 * under the hip. Standing or turning on the spot, a foot that is >1.5 cm off its rest point shuffles back under the
 * hip. The head holds in space during a stance and thrusts forward with each step.
 */
export function feetGait(b, h, ground) {
  const G = b.G, v = b.v, moving = v > 0.03, F = b.feet;
  const C = clamp(0.36 - 0.2 * v, 0.22, 0.36), T = 0.42 * C, d = moving ? (v * (C - T)) / 2 : 0;
  b.stepAge += h;
  let swing = -1;
  F.forEach((f, i) => {
    if (f.s < 0) return;
    f.s = Math.min(1, f.s + h / f.T);
    restFoot(b, i, f.ah + v * (1 - f.s) * f.T, _r);
    const u = smooth(f.s), gy = ground(_r.x, _r.z);
    f.x = f.ox + (_r.x - f.ox) * u; f.z = f.oz + (_r.z - f.oz) * u;
    f.y = f.oy + (gy - f.oy) * u + G.lift * 4 * f.s * (1 - f.s) * (moving ? 1 : 0.5);
    if (f.s >= 1) { f.s = -1; f.x = _r.x; f.z = _r.z; f.y = gy; } else swing = i;
  });
  let due = -1;
  if (moving) {
    const p0 = b.gph ?? 0.9, p1 = (b.wasMoving ? p0 : 0.9) + h / C;
    if (p1 >= 1) due = 0; else if (p1 >= 0.5 && (b.wasMoving ? p0 : 0.9) < 0.5) due = 1;
    b.gph = p1 % 1;
  }
  b.wasMoving = moving;
  if (due >= 0 && swing >= 0) b.pend = due; // the other foot is still in the air: step as soon as it is down
  if (swing < 0 && due < 0 && b.pend >= 0 && moving) due = b.pend;
  if (swing < 0) {
    const err = F.map((f, i) => { restFoot(b, i, 0, _r); return Math.hypot(f.x - _r.x, f.z - _r.z); });
    let go = due;
    if (go < 0) { // off-clock: shuffle back under the hip (standing / turning), or catch up a foot left far behind
      const i = err[0] + (b.lastFoot === 0 ? -0.004 : 0) > err[1] + (b.lastFoot === 1 ? -0.004 : 0) ? 0 : 1;
      if (moving ? err[i] > d + G.leg * 0.35 : err[i] > 0.015 && b.stepAge > 0.16) go = i;
    } else if (err[go] < 0.004 && !moving) go = -1;
    if (go >= 0) {
      const f = F[go];
      b.pend = -1;
      if (moving && go !== due) b.gph = go ? 0.5 : 0; // an off-clock step re-syncs the clock to this foot
      f.s = 0; f.T = moving ? T : 0.13; f.ah = d; f.ox = f.x; f.oy = f.y; f.oz = f.z; swing = go;
      b.lastFoot = go; b.stepDt = Math.min(0.6, b.stepAge); b.stepAge = 0;
      if (moving) { b.bobT = T * 0.8; b.bobA = Math.min(G.leg * 0.35, 0.5 * v * Math.max(0, C / 2 - b.bobT)); }
    }
  }
  // head-bob: hold (the head stays put in the world while the body walks under it), then thrust with the step
  if (b.bobT > 0) { b.bob += (b.bobA - b.bob) * Math.min(1, h / b.bobT); b.bobT -= h; }
  else if (moving) b.bob = Math.max(b.bob - v * h, -G.leg * 0.45);
  else b.bob *= 1 - Math.min(1, 6 * h);
  // a slight waddle: the body rolls over the planted foot and lifts a little while the other one swings
  const f = swing >= 0 ? F[swing] : null, w = f ? Math.sin(Math.PI * f.s) : 0;
  b.sway = w * (swing === 0 ? -1 : 1) * 0.06 * Math.min(1, v / 0.3 + 0.3);
  return w;
}

/** Turn towards `target` at most `max` rad/s, with the turn rate itself eased (no snaps, no instant reversals). */
export function turnTo(b, h, target, max) {
  const err = wrapA(target - b.yaw), want = clamp(err * 5, -max, max);
  b.yr = (b.yr || 0) + (want - (b.yr || 0)) * Math.min(1, 10 * h);
  if (Math.abs(b.yr * h) > Math.abs(err) && Math.sign(b.yr) === Math.sign(err)) { b.yaw = wrapA(target); b.yr *= 0.5; }
  else b.yaw = wrapA(b.yaw + b.yr * h);
  return err;
}

/** Head-down curve of one peck (u 0..1): a quick strike, a short hold at the ground, a slower lift. */
export const peckCurve = (u) => (u < 0.3 ? smooth(u / 0.3) : u < 0.45 ? 1 : 1 - smooth((u - 0.45) / 0.55));
