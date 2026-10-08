/**
 * Stair gait, view side (user requests 2026-10-07: "animate the commandos climbing and going down stairs properly",
 * "All commandos in all clothing and all situations walk/run climb and go down stairs well", "Both commandos and enemy
 * soldiers"). A post-mixer layer for every standing man (commandos in any kit, Germans of every look, guests) on or
 * near a flight of stairs (world/stairs.js), whatever locomotion clip plays under it (walk, run, carry_walk,
 * drag_walk, tied_walk, a shot on the move …) and when he stands on the stairs:
 *  - footholds: each foot is planted on ONE tread — its sole between the riser behind and the riser ahead (a toe
 *    neither hangs in the air nor goes into the next riser), locked there while it bears weight (the ball of the foot
 *    is the pivot, so the clip's heel-off roll stays), and swung from its tread to the next foothold, which is
 *    predicted from the body's motion and the clip's own landing spot, then moved onto the nearest safe spot of a tread;
 *  - swing: going up the foot rises to its new tread early in the swing and the knee lifts higher (extra clearance);
 *    going down it first clears the nosing it leaves, then reaches down;
 *  - pelvis: the body stands on the LOWER of the two footholds (a foot in the air counts at the height it is passing),
 *    eased by a critically damped spring: it rises tread by tread as the trailing leg pushes up (no gliding up a ramp)
 *    — or as it goes over the upper foot when the trailing one is held down for its clip — and sinks on the bending
 *    stance knee going down; capped so a planted foot always reaches its tread;
 *  - lean: the upper body leans a little forward going up, back going down;
 *  - cadence: on the run of the flight the clip's playback (the character's mixer timeScale — the runtimes pick their
 *    gait variant from moveSpeed, so that stays untouched) is locked to the stairs: timed so that the clip puts the foot
 *    in the air down just as the body gets to where it lands it on its foothold (where in its cycle the clip puts each
 *    foot down is sampled once from the clip); one step covers a whole number of treads (one or two), from the step
 *    length measured from his own steps (before that, from the clip's cycle);
 *  - a foot flat on its tread stands on it (the clip's stance floating over its own ground is not carried over), and
 *    toes, balls and heels are never below the tread under them (a last guard on every foot: the boot's own vertices).
 * Pure view side: the sim (Unit._followPath) walks the flight's smooth nosing line at the stair pace
 * (entities/stair-walk.js). Bones are written after the mixer through the model's BoneGuard; nothing accumulates.
 * The weight fades in / out over GAIT.fade s at GAIT.pad m before the foot and past the top of a flight, where the
 * feet stand on the floor anyway.
 * @module art/stair-gait
 */
import { Vector3, Quaternion, LoopOnce } from 'three';
import { twoBoneIK } from './characters/pipeline/weapons.js';
import { flightLocal, flightWorld, levelIndex, levelSpan, lineAt } from '../world/stairs.js';
import { unitFlight } from '../entities/stair-walk.js';

const DEG = Math.PI / 180;
/**
 * Tuning. pad: m before the foot / past the top where the layer is on; side: m beside it (a man stepping on from the
 * side of its foot); warm: m off it where his steps are measured already; fade: s; nosing: m a sole may overhang its
 * tread's front edge; riser: m kept from the next riser; clearUp / clearDown: m extra lift at mid-swing; leadUp: part
 * of an upward swing by which the foot is at its new tread's height; holdDown: part of a downward swing spent clearing
 * the nosing before it reaches down; spring: rad/s of the pelvis follow; lean / leanDown: upper-body lean (rad);
 * kMin / kMax: cadence scale clamp; down / up: a foot comes down within `down` m of its lowest in the clip and
 * leaves the ground past `up` m; knee: how far (m) the upper foothold may be above the one the body stands on; crouch:
 * how much lower (m) the body goes to keep a planted foot in reach (past that the foot comes up; crouchEarly for a foot
 * down before its clip, which is not lifted; reach: m of it kept for the sole to come down onto its tread); edge: m past
 * a nosing a sole still rests on its edge; below: m under the tread beneath him the body never stands lower than;
 * settle: s a foot that came down short of its foothold takes to settle onto
 * it; retarget: m/s a swinging foot's goal may move when the foothold predicted for it changes; cadence: steps/s a man
 * takes one tread at a time up to; phase (while the cadence lock is not on: its contact phases unknown): how much
 * faster (per s of lag) the clip is played while it is behind the feet (a foot lifted before its clip lifts it, the
 * clip's foot coming down past its foothold — by more than phaseLag s; slower while ahead), phaseMax its cap
 * (1 / phaseMax the least), phaseEase /s its easing back; on: kill switch.
 */
export const GAIT = {
  on: true, pad: 1.2, side: 0.7, warm: 5, fade: 0.25, nosing: 0.04, riser: 0.015, clearUp: 0.06, clearDown: 0.025, leadUp: 0.55, holdDown: 0.15,
  spring: 22, lean: 7 * DEG, leanDown: 4 * DEG, kMin: 0.7, kMax: 2.2, down: 0.03, up: 0.05, knee: 0.5, crouch: 0.3,
  crouchEarly: 0.1, below: 0.6, reach: 0.03, edge: 0.025, settle: 0.1, retarget: 3, cadence: 3.2, phase: 1.5, phaseLag: 0.06,
  phaseMax: 1.6, phaseEase: 1.2,
};
const SIDES = ['l', 'r'];
const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _pq = new Quaternion();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ pure helpers (unit-tested in node)

/**
 * Safe foothold for a sole on a flight: the ball of the foot at flight coordinate `sBall`, the sole reaching `toe` m
 * ahead of the ball and `heel` m behind it along the foot, whose direction projects `dir` (−1..1) onto the flight's
 * axis. The sole is moved (Δs, smallest) so that it lies on one level: within its span, overhanging the nosing by at
 * most GAIT.nosing and keeping GAIT.riser from the riser ahead; a tread shorter than the sole takes it toes / heel to
 * its riser, the rest over its nosing. `kWant`: on that level (a step of so many treads), wherever the prediction was.
 * @returns {{ds:number, k:number}} shift along the flight axis, level index
 */
export function footholdOnFlight(f, sBall, dir, toe = 0.08, heel = 0.21, kWant = null) {
  const a0 = dir >= 0 ? -heel * dir : toe * dir, b0 = dir >= 0 ? toe * dir : -heel * dir; // sole relative to the ball
  const lo = Math.min(a0, b0), hi = Math.max(a0, b0), len = hi - lo;
  const kc = levelIndex(f, sBall + (lo + hi) / 2);
  let best = null;
  for (const k of kWant != null ? [kWant] : [kc, kc - 1, kc + 1]) {
    if (k < 0 || k > f.risers.length) continue;
    const [s0, s1] = levelSpan(f, k);
    const minS = s0 - GAIT.nosing, maxS = s1 - GAIT.riser; // where the sole may lie
    let ds;
    if (maxS - minS >= len) ds = clamp(sBall + lo, minS, maxS - len) - (sBall + lo);
    else ds = maxS - (sBall + hi); // a short tread: against its riser, over its nosing
    const cost = Math.abs(ds) + (k === kc ? 0 : 0.01);
    if (!best || cost < best.cost) best = { ds, k, cost };
  }
  return best ? { ds: best.ds, k: best.k } : { ds: 0, k: kc };
}

/**
 * Height of a swinging foot's support (m) at swing progress u: from level y0 to y1, rising early on the way up
 * (by GAIT.leadUp of the swing), holding its tread's height for GAIT.holdDown on the way down.
 */
export function swingLevel(y0, y1, u) {
  if (y1 >= y0) return y0 + (y1 - y0) * smooth(u / GAIT.leadUp);
  return y0 + (y1 - y0) * smooth((u - GAIT.holdDown) / (1 - GAIT.holdDown));
}

/** Extra lift (m) of a swinging foot at progress u over a height change dy (up: the knee comes up higher). */
export function swingClear(dy, u) {
  const c = dy > 0.02 ? GAIT.clearUp : dy < -0.02 ? GAIT.clearDown : 0;
  return c * Math.sin(Math.PI * clamp(u, 0, 1));
}

/**
 * Treads per step and the cadence scale for a clip whose natural step is `L` m, at `v` m/s on a flight of `tread` m
 * treads: one tread a step while that keeps the cadence ≤ GAIT.cadence steps/s (a patrol's pace), two beyond (a
 * commando's walk, a jog: two at a time); without `v`, whichever needs the smaller change (shortened rather than
 * stretched). The scale is clamped to GAIT.kMin..kMax.
 * @returns {{n:number, k:number}}
 */
export function cadenceFor(L, tread, v = null) {
  if (!(L > 0.05) || !(tread > 0.05)) return { n: 1, k: 1 };
  const n = v > 0 ? clamp(Math.ceil(v / (tread * GAIT.cadence)), 1, 2) : clamp(Math.floor(L / tread + 0.3), 1, 2);
  return { n, k: clamp(L / (n * tread), GAIT.kMin, GAIT.kMax) };
}

// ------------------------------------------------------------------ the layer

/** Is this a standing man the layer may pose (not lying, swimming, in a vehicle, carried, on a ladder, posed elsewhere)? */
function eligible(m) {
  const u = m.unit;
  if (!u || m.dog || u.alive === false || !m.real?.inner) return false;
  if ((u.stance ?? 'stand') !== 'stand' || u.state === 'carried' || u.state === 'inVehicle' || u.vehicle || u._mgManned) return false;
  if (u._ladder || u._climb || u.state === 'downed' || u.blastReact || m._br || m.overlay || m._rdLast || m._blend || m._carryOn) return false;
  if (/^(die|dead|climb|ladder)/.test(m.anim || '')) return false;
  return true;
}

/** Top bone of the skeleton (for a matrix refresh of the whole subtree). */
function topBone(h) {
  if (!h._boneTop) { let b = h.bones.pelvis || h.bones.thigh_l; while (b.parent && b.parent !== h.object) b = b.parent; h._boneTop = b; }
  return h._boneTop;
}

function newFoot() {
  return { contact: null, rest: 0.03, plant: null, sw: null, tsw: null, land: null, last: null, c0: null, early: false, swDone: null };
}

/** Half-width margin (m) past a flight's treads where a foot still counts as on its line (a man stepping on at its foot). */
const ON = 0.05;
/**
 * Walking surface under a world point near the flight: its tread, or the floor / top beyond its ends. (Beside the
 * treads is the stair's side face or rail — no foot stands there — or, by its foot, the floor it starts from; the
 * grid's graded cells along its sides are a tread off.)
 */
function levelOf(S, x, z) {
  const f = S.f, { s } = flightLocal(f, x, z), k = levelIndex(f, s);
  return { y: f.levels[k], k, s };
}

/**
 * What a sole point at height y rests on: its tread, or — at or above the height of the tread next to it, within
 * GAIT.edge m of that tread's nosing — that nosing's edge (a foot rolling over it).
 */
function supportOf(S, x, y, z) {
  const f = S.f, { s } = flightLocal(f, x, z), e = GAIT.edge;
  let lv = f.levels[levelIndex(f, s)];
  for (const d of [-e, e]) { const l2 = f.levels[levelIndex(f, s + d)]; if (l2 > lv && y >= l2 - 0.01) lv = l2; }
  return lv;
}

/**
 * Snap a ball-of-foot point onto a safe foothold of flight f (footholdOnFlight), the foot pointing along world
 * (fx, fz). @returns {{x:number, z:number, y:number}} the ball's spot (x, z) and its tread's height y
 */
function snapBall(S, x, z, fx, fz, geo, kWant = null) {
  const f = S.f, { s } = flightLocal(f, x, z), dir = fx * f.ux + fz * f.uz;
  const { ds, k } = footholdOnFlight(f, s, dir, geo.toeD ?? geo.toe, geo.heelD ?? geo.heel, kWant);
  return { x: x + f.ux * ds, z: z + f.uz * ds, y: f.levels[k], k };
}

/** Foot geometry of a character (ankle → ball, ball → toe tip), measured once per body from its skeleton. */
function footGeo(h) {
  if (h._sgGeo) return h._sgGeo;
  const B = h.bones;
  const ab = B.ball_l ? B.ball_l.position.length() * worldScale(B.ball_l) : 0.15;
  const tl = B.ball_leaf_l ? B.ball_leaf_l.position.length() * worldScale(B.ball_leaf_l) : 0.08;
  const g = { ab: clamp(ab, 0.08, 0.22), toe: clamp(tl, 0.04, 0.12) + 0.01 };
  g.heel = g.ab + 0.06;
  return (h._sgGeo = g);
}
function worldScale(b) { b.getWorldScale(_w); return (Math.abs(_w.x) + Math.abs(_w.y) + Math.abs(_w.z)) / 3; }

/**
 * Per-frame stair gait for one UnitModel (after the mixer and the other view-side passes, before the root's matrices
 * are refreshed). @param {import('./unit-model.js').UnitModel} m @param {number} dt rendered frame time (0 while
 * paused: the pose holds) @param {import('./pose-blend.js').BoneGuard} guard @returns {boolean} bones written
 */
export function stairGait(m, dt, guard) {
  const h = m.real?.inner, B = h?.bones, u = m.unit;
  if (!B || !B.pelvis || !B.thigh_l || !B.calf_l || !B.foot_l || !B.ball_l || !B.thigh_r || !B.calf_r || !B.foot_r || !B.ball_r) return false;
  let S = m._sg;
  const field = u?.world?.stairs;
  const ok = GAIT.on && eligible(m) && !!field?.size;
  // (from GAIT.warm m off it his steps are measured — step length, swing time, where the clip lands a foot — with
  // nothing written; within GAIT.pad / GAIT.side of its run the layer poses him)
  const near = ok ? unitFlight(u, GAIT.warm, GAIT.warm) : null;
  const at = near && near.s >= near.f.sFoot - GAIT.pad && near.s <= near.f.sTop + GAIT.pad && Math.abs(near.v) <= near.f.w / 2 + GAIT.side ? near : null;
  if (!S) {
    if (!near) return false;
    S = m._sg = { w: 0, f: near.f, t: 0, acc: 0, mt: null, feet: { l: newFoot(), r: newFoot() }, dy: null, dyV: 0, lean: 0, k: 1, kOn: 1, L: null, td: null, px: null, pz: null, vx: 0, vz: 0, vb: 0, inner: h };
  }
  if (S.inner !== h) { resetCadence(S); S.inner = h; S.feet = { l: newFoot(), r: newFoot() }; S.dy = null; } // body swapped (the Marine's wetsuit)
  if (near) S.f = near.f;
  if (dt > 0) S.w = clamp(S.w + (at ? dt : -dt) / GAIT.fade, 0, 1);
  if (!near && (S.w <= 0 || !ok)) { resetCadence(S); resetBody(m, S); m._sg = null; return false; }
  const f = S.f, root = m.root;
  // (the gait state moves on with the clip: a mixer stepped only every 2nd / 4th frame — zoomed out, off screen —
  // takes the whole time since its last step at once; a frame it did not step keeps the state, like a paused one)
  const mt = h.mixer ? h.mixer.time : S.t + dt;
  S.acc += dt;
  if (mt !== S.mt) { S.mt = mt; dt = S.acc; S.acc = 0; } else dt = 0;
  if (dt > 0) S.t += dt;

  // the clip's pose this frame (world): ankle, ball, toe tip of each foot, the body's motion — measured with the body
  // group back on the root (last frame's shift taken off; prone-ground, when it eases a pitch out, sets it itself)
  const body0 = m._body?.();
  if (body0 && S.bodyY && !m._pg?.active) body0.position.y = 0;
  m._rootMatrix?.();
  h.object.updateWorldMatrix(true, false);
  topBone(h).updateMatrixWorld(true);
  const base = root.position.y, yaw = root.rotation.y, fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  if (dt > 0 && S.px != null) {
    const k = Math.min(1, dt * 8), vx = (root.position.x - S.px) / dt, vz = (root.position.z - S.pz) / dt;
    if (Math.hypot(vx, vz) < 12) { S.vx += (vx - S.vx) * k; S.vz += (vz - S.vz) * k; }
  }
  if (dt > 0 || S.px == null) { S.px = root.position.x; S.pz = root.position.z; }
  S.vb = Math.hypot(S.vx, S.vz);
  // (what is learned of the gait — swing time and travel, landing spot, step length — belongs to the clip that plays:
  // a run shown as a walk on the stairs starts afresh, its step length kept per clip)
  if (S.clip !== m.clip) {
    if (S.clip != null) {
      (S.Lc ||= {})[S.clip] = S.L; S.L = S.Lc[m.clip] ?? null;
      for (const s of SIDES) {
        const F = S.feet[s];
        Object.assign(F, { dsw: null, tsw: null, land: null });
        if (F.sw) Object.assign(F.sw, { u0: F.sw.u ?? 0, t1: S.t, c0: null }); // (a swing under way runs on by the clock from where it is)
        // (by the clock: eased time from where it is — the jump of an eased curve's restart is less than a frame's swing)
      }
    }
    S.clip = m.clip;
  }
  const geo = footGeo(h), clip = {};
  for (const s of SIDES) {
    const A = B['foot_' + s].getWorldPosition(new Vector3()), Bl = B['ball_' + s].getWorldPosition(new Vector3());
    const T = B['ball_leaf_' + s] ? B['ball_leaf_' + s].getWorldPosition(new Vector3()) : Bl.clone().sub(A).multiplyScalar(0.5).add(Bl);
    let dx = Bl.x - A.x, dz = Bl.z - A.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    clip[s] = { A, Bl, T, fx: dx, fz: dz, hB: Bl.y - base };
  }

  // the stepping clip and where it is in its cycle (0..1)
  const act = stepAction(h), D = act?.getClip().duration;
  S.u = act && D > 0.2 ? (((act.time / D) % 1) + 1) % 1 : null;

  // gait phases from the clip: a foot bears weight while its ball is low and still (hysteresis)
  const standing = S.vb < 0.3;
  for (const s of SIDES) {
    const F = S.feet[s], c = clip[s];
    // (by the ball's height in the clip, with hysteresis: down within GAIT.down of its lowest, up past GAIT.up; a man
    // standing whose clip foot moves off its spot — a step round on the spot, a shuffle — lifts it too)
    if (dt > 0) F.rest = Math.min(F.rest + dt * 0.02, Math.max(-0.02, c.hB));
    // (the heel point, once, from a flat-footed stance in the clip: ball at its lowest, ankle at its usual height)
    if (!geo['heel_' + s] && F.contact && c.hB < F.rest + 0.004 && c.A.y - c.Bl.y > 0.03) {
      const d = _v.copy(c.Bl).sub(c.A).setY(0).normalize();
      geo['heel_' + s] = B['foot_' + s].worldToLocal(new Vector3(c.A.x - d.x * (geo.heel - geo.ab), base, c.A.z - d.z * (geo.heel - geo.ab)));
      geo['ball_' + s] = Math.max(0, c.Bl.y - base); geo['toe_' + s] = Math.max(0, c.T.y - base); // (their heights over the sole)
      const V = geo['sole_' + s] = soleVertices(h, B, s, c);
      // (the footholds keep the whole boot on its tread: its own length behind and ahead of the ball, once measured)
      if (V && V.heelD > 0.04 && V.heelD < 0.35 && V.toeD > 0.01 && V.toeD < 0.2) {
        geo.heelD = Math.max(geo.heelD ?? 0, V.heelD + 0.01); geo.toeD = Math.max(geo.toeD ?? 0, V.toeD + 0.005);
      }
    }
    let contact = F.contact;
    if (contact == null) contact = c.hB < F.rest + GAIT.down;
    else if (dt > 0) {
      const drift = standing && F.c0 ? Math.hypot(c.Bl.x - F.c0.x, c.Bl.z - F.c0.z) : 0;
      // (a planted foot the body has left out of the leg's reach comes up: a stance longer than the stairs allow)
      // (not a foot down ahead of its clip — F.early: the clip is still bringing the leg there)
      if (contact && F.plant && !F.early && (F.force || overReach(h, B, s, F.plant, c, Math.min(S.dy ?? 0, S.dyT ?? 0)))) { contact = false; F.force = true; }
      // (a foot pulled up while the clip still has it down comes down again after a swing's time when he stands)
      else contact = contact ? !(c.hB > F.rest + GAIT.up || drift > 0.08) : c.hB < F.rest + GAIT.down && (!F.force || (standing && !!F.sw && S.t - F.sw.t0 > (F.tsw ?? 0.35)));
      if (F.force && !F.plant && c.hB > F.rest + GAIT.up) { // (the clip's own swing has begun: the swing follows it on)
        F.force = false;
        if (F.sw && !standing) lag(S, S.t - F.sw.t0); // (the clip lifted it this late after the stairs did)
        if (F.sw) { F.sw.force = false; F.sw.c0 = { x: c.Bl.x, z: c.Bl.z }; F.sw.u0 = F.sw.u ?? 0; F.sw.e0 = smooth(F.sw.u0); F.sw.t1 = S.t; }
      }
    }
    if (F.early && contact) { F.early = false; clipTouch(S, F, s, c, root, F.swDone); F.swDone = null; } // (the clip comes down where the foot already is)
    if (contact && !F.plant) touchDown(S, F, s, c, f, geo, root);
    else if (!contact && F.plant && (!F.early || F.force)) liftOff(S, F, c);
    else if (!contact && !F.sw && !F.plant) { const p = snapBall(S, c.Bl.x, c.Bl.z, c.fx, c.fz, geo); F.sw = { t0: S.t, from: p, to: { ...p } }; } // (in the air when the layer starts)
    F.contact = contact;
  }

  // cadence: on the flight's run one step covers one or two whole treads (the clip timed by the mixer)
  const onRun = (() => { const { s } = flightLocal(f, root.position.x, root.position.z); return s > f.sFoot - 0.2 && s < f.sTop + 0.2; })();
  const Lc = S.L ?? (onRun && !standing ? clipStep(h, S.vb) : null);
  const cad = onRun && !standing && Lc ? cadenceFor(Lc, f.tread, S.vb) : null;
  S.n = cad ? cad.n : null;
  // (in step: the clip timed to put the foot in the air down when the body is where the clip lands it on its
  // foothold — its cadence and its phase both follow the stairs; before that is known, the cadence from the step length)
  const lock = onRun && !standing ? stepLock(S, f, root, act, D, fwdX, fwdZ, contactPhases(m, h, act), cad?.k) : null;
  const want = lock ?? (cad ? cad.k : 1);
  if (dt > 0) S.k += (want - S.k) * Math.min(1, dt * (lock != null ? 10 : 6));
  // (phase, while the lock is not on: a clip behind the feet — they leave and land before it does — plays faster for a
  // while until its steps fall in with theirs; eased back)
  if (!onRun || standing || lock != null) S.pkT = 1;
  if (dt > 0) {
    S.pkT = 1 + ((S.pkT ?? 1) - 1) * Math.exp(-GAIT.phaseEase * dt);
    S.pk = (S.pk ?? 1) + (S.pkT - (S.pk ?? 1)) * Math.min(1, dt * 8); // (no sudden change of pace)
  }
  const kNow = 1 + (clamp(S.k * (S.pk ?? 1), GAIT.kMin, GAIT.kMax) - 1) * S.w;
  if (h.mixer && Math.abs(h.mixer.timeScale - kNow) > 1e-4) h.mixer.timeScale = kNow;
  S.kOn = kNow;

  // targets: the ball of each foot (planted, or on its swing), its support level
  const tgt = {};
  for (const s of SIDES) {
    const F = S.feet[s], c = clip[s];
    if (F.plant) {
      // (a foot that came down short of its foothold — its clip landed early — settles onto it over GAIT.settle s)
      const P = F.plant, St = F.settle;
      let bx = P.x, bz = P.z, by = P.y + c.hB;
      if (St) {
        if (dt > 0) St.t += dt;
        const k = smooth(St.t / GAIT.settle);
        bx = St.x + (P.x - St.x) * k; bz = St.z + (P.z - St.z) * k; by += St.dy * (1 - k);
        if (k >= 1) F.settle = null;
      }
      if (F.early) by = P.y + Math.min(c.hB, F.rest + 0.01); // (down before the clip: on its tread, not at the clip's height)
      tgt[s] = { bx, bz, by, lvl: P.y, swing: false };
      F.lastB = tgt[s];
      continue;
    }
    const W = F.sw;
    const Tsw = F.tsw ?? (S.vb > 2.5 ? 0.28 : 0.38);
    // swing progress: how far the clip's own foot has gone of its usual swing (its timing, whatever the cadence), or
    // by the clock while that is not known (or he stands, or the foot was pulled up early)
    // (a foot pulled up while the clip still has it down swings by the clock, lifted here, until the clip lifts it)
    const byClip = !standing && !W.force && F.dsw && W.c0, u0 = W.u0 ?? 0;
    let uu = W.force ? (S.t - W.t0) / Tsw : byClip ? u0 + (1 - u0) * Math.hypot(c.Bl.x - W.c0.x, c.Bl.z - W.c0.z) / F.dsw
      : u0 + (S.t - (W.t1 ?? W.t0)) / Tsw;
    uu = W.u = Math.max(W.u ?? 0, clamp(uu, 0, 1));
    if (dt > 0 && (uu < 0.6 || standing)) W.to = predictLanding(S, F, s, c, f, geo, root, Tsw, uu, standing, fwdX, fwdZ);
    // (the foot heads for the foothold as it is predicted, at most GAIT.retarget m/s off course when the prediction
    // moves on — another tread chosen, the body turning — so it never jumps)
    if (!W.tv) W.tv = { ...W.to };
    else if (dt > 0) {
      const dx = W.to.x - W.tv.x, dz = W.to.z - W.tv.z, dyv = W.to.y - W.tv.y, d = Math.hypot(dx, dz, dyv), mx = GAIT.retarget * dt;
      const k = d > mx ? mx / d : 1;
      W.tv.x += dx * k; W.tv.z += dz * k; W.tv.y += dyv * k;
    }
    // (horizontal progress: the clip foot's own (already eased) travel, or eased clock time — continuous when a swing
    // pulled up by the clock goes on with the clip's)
    const e0 = W.e0 ?? 0, e = byClip ? e0 + (1 - e0) * clamp((uu - u0) / Math.max(1e-6, 1 - u0), 0, 1) : smooth(uu), to = W.tv;
    const lvl = swingLevel(W.from.y, to.y, uu);
    // (a foot pulled up before the clip lifts it is lifted here: the clip has it still on the ground)
    const lift = W.force ? 0.1 * Math.sin(Math.PI * uu) : 0;
    tgt[s] = { bx: W.from.x + (to.x - W.from.x) * e, bz: W.from.z + (to.z - W.from.z) * e, by: lvl + Math.max(c.hB, lift) + swingClear(to.y - W.from.y, uu), lvl, swing: true };
    F.lastB = tgt[s];
    // (a swing done before the clip's foot comes down — a run's flight, a cadence still catching up — lands now
    // instead of hovering over its tread: the clip's touchdown, when it comes, only does its measuring)
    if (dt > 0 && uu >= 1 && !standing && !W.force && !F.early) {
      F.plant = { x: W.to.x, z: W.to.z, y: W.to.y, k: W.to.k ?? null }; F.early = true; F.swDone = W; F.sw = null;
      const B = F.lastB, off = B.by - (W.to.y + Math.min(c.hB, F.rest + 0.01));
      F.settle = Math.hypot(B.bx - W.to.x, B.bz - W.to.z) > 0.01 || Math.abs(off) > 0.01 ? { x: B.bx, z: B.bz, dy: Math.max(0, off), t: 0 } : null;
      F.c0 = { x: c.Bl.x, z: c.Bl.z };
    }
  }

  // pelvis: on the lower foothold, eased; never so high a planted foot cannot reach its tread
  // (the lower foothold — going up not so far below the upper one that its knee comes up past the hip, and rising onto
  // the upper one as the body goes over it when the lower foot is one down before its clip — a trailing foot held for
  // the clip does not hold him back; going down the upper foot is the trailing one, pushing off bent)
  const loL = Math.min(tgt.l.lvl, tgt.r.lvl), hiL = Math.max(tgt.l.lvl, tgt.r.lvl);
  const up = Math.sign(f.slope || 1), climbing = (S.vx * f.ux + S.vz * f.uz) * up > 0.2;
  let support = loL;
  if (climbing) {
    const lf = tgt.l.lvl <= tgt.r.lvl ? 'l' : 'r', lo = tgt[lf], hi = tgt[lf === 'l' ? 'r' : 'l'];
    const sLo = flightLocal(f, lo.bx, lo.bz).s, span = (flightLocal(f, hi.bx, hi.bz).s - sLo) * up;
    const over = span > 0.05 ? clamp(((flightLocal(f, root.position.x, root.position.z).s - sLo) * up) / span, 0, 1) : 0;
    support = Math.max(loL, hiL - GAIT.knee, S.feet[lf].early && !lo.swing ? loL + (hiL - loL) * smooth(over) : -Infinity);
  }
  // (never far below the tread under him: a foot left that far behind is to come up, not to pull the body down to it)
  support = Math.max(support, f.levels[levelIndex(f, flightLocal(f, root.position.x, root.position.z).s)] - GAIT.below);
  let dyT = support - base;
  S.dyT = dyT;
  if (S.dy == null) { S.dy = dyT; S.dyV = 0; }
  if (dt > 0) {
    const om = GAIT.spring, n = Math.max(1, Math.ceil(dt * 240)), hh = dt / n;
    for (let i = 0; i < n; i++) { S.dyV += (om * om * (dyT - S.dy) - 2 * om * S.dyV) * hh; S.dy += S.dyV * hh; }
  }
  // (a planted foot it cannot reach without crouching more than GAIT.crouch below that comes up next frame instead)
  let dy = S.dy;
  for (const s of SIDES) {
    if (tgt[s].swing) continue;
    const hip = B['thigh_' + s].getWorldPosition(_v), L = legLength(h, s) * 0.995;
    const ank = ankleTarget(tgt[s], clip[s], _w);
    if (!S.feet[s].early) ank.y -= GAIT.reach; // (room for the sole to be brought down onto its tread)
    const dh = Math.hypot(ank.x - hip.x, ank.z - hip.z);
    const cap = dh < L ? ank.y - hip.y + Math.sqrt(L * L - dh * dh) : -Infinity;
    // (a foot down ahead of its clip — the clip still bringing it there — has the body crouch no more than
    // GAIT.crouchEarly for it; left out of reach even by a full crouch, it goes on with the clip's swing to its next tread)
    if (S.feet[s].early) { if (cap < dyT - GAIT.crouch) S.feet[s].force = true; dy = Math.min(dy, Math.max(cap, dyT - GAIT.crouchEarly)); }
    else if (cap < dyT - GAIT.crouch) { S.feet[s].force = true; dy = Math.min(dy, Math.max(cap, dyT - GAIT.crouch)); } else dy = Math.min(dy, cap);
  }
  if (dy < S.dy - 1e-4) { S.dy = dy; S.dyV = Math.min(0, S.dyV); }
  const W8 = S.w;

  // lean: forward going up, back going down (scaled by the flight's slope and how fast he climbs)
  // (toward the uphill side: forward going up, back going down; a man dragging a body up backwards leans back)
  const upX = f.ux * Math.sign(f.slope || 1), upZ = f.uz * Math.sign(f.slope || 1), along = S.vx * upX + S.vz * upZ;
  const facing = Math.sign(fwdX * upX + fwdZ * upZ) || 1;
  const leanT = onRun && !standing ? facing * Math.min(1, Math.abs(along) / 1.2) * (along > 0 ? GAIT.lean : GAIT.leanDown) : 0;
  if (dt > 0) S.lean += (leanT - S.lean) * Math.min(1, dt * 5);

  if (W8 <= 0) { if (S.bodyY) resetBody(m, S); return false; } // (measuring only)
  // write: the whole body up / down (its group: a gun the runtime placed in the body's space this frame moves with it),
  // the lean (a gun not held by a hand bone turned with the chest), both legs onto their targets, the sole guard
  const body = m._body?.();
  if (body) {
    body.position.y = (m._pg?.active ? body.position.y : 0) + dy * W8;
    S.bodyY = true;
    body.updateMatrixWorld(true);
  }
  const sp = B.spine_01;
  if (sp && Math.abs(S.lean * W8) > 1e-4) {
    guard?.touch(sp);
    const pivot = sp.getWorldPosition(new Vector3()), axW = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // his left
    const qW = new Quaternion().setFromAxisAngle(axW, S.lean * W8); // + : the chest forward
    sp.parent.getWorldQuaternion(_pq);
    const ax = _v.copy(axW).applyQuaternion(_pq.invert()).normalize();
    sp.quaternion.premultiply(_q.setFromAxisAngle(ax, S.lean * W8));
    sp.updateMatrixWorld(true);
    turnLooseGun(h, pivot, qW);
  }
  for (const s of SIDES) {
    const c = clip[s], T = tgt[s];
    const thigh = B['thigh_' + s], calf = B['calf_' + s], foot = B['foot_' + s];
    guard?.touch(thigh); guard?.touch(calf); guard?.touch(foot);
    const ank = ankleTarget(T, c, new Vector3());
    // blended with the clip's own ankle (lifted with the body) while the layer fades
    const clipA = _w.copy(c.A).setY(c.A.y + dy * W8);
    if (W8 < 1) ank.lerp(clipA, 1 - W8);
    // (a target out of the leg's reach — the body gone on ahead of a foot — is pulled in along the leg: a straight
    // leg reaching past it would swing the foot through the stairs)
    inReach(ank, thigh.getWorldPosition(new Vector3()), legLength(h, s) * 0.995);
    twoBoneIK(thigh, calf, foot, ank);
    const F = S.feet[s];
    // (a foot flat on its tread stands on it: a clip whose stance floats a little over its own ground does not carry
    // that onto the stairs — the sole's lowest point is brought down onto the tread)
    if (!T.swing && !F.early && !F.settle && c.hB < F.rest + 0.01 && W8 >= 1) {
      const over = -soleDeficit(S, B, s, 0, geo, true);
      if (over > 0.003 && over < 0.08) { ank.y -= over; inReach(ank, thigh.getWorldPosition(new Vector3()), legLength(h, s) * 0.995); twoBoneIK(thigh, calf, foot, ank); }
    }
    // (a planted foot whose heel or toe has gone into a riser — the clip's foot turning on its spot — comes out of it
    // the short way, along the flight, this frame: not lifted a whole step into the air)
    if (!T.swing && F.plant) {
      const ds = riserExit(S, B, s, geo);
      if (ds) {
        ank.x += f.ux * ds; ank.z += f.uz * ds;
        inReach(ank, thigh.getWorldPosition(new Vector3()), legLength(h, s) * 0.995); twoBoneIK(thigh, calf, foot, ank);
      }
    }
    // the sole guard: heel, ball and toe tip above the tread under each (a swinging foot by 1.5 cm)
    // (raised, and pulled in along the leg when that takes it out of reach, a few times: a foot reaching down past a
    // nosing comes up over it)
    for (let i = 0; i < 3; i++) {
      const lift = soleDeficit(S, B, s, T.swing ? 0.015 : 0, geo);
      if (!(lift > 0.002)) break;
      ank.y += lift; inReach(ank, thigh.getWorldPosition(new Vector3()), legLength(h, s) * 0.995);
      twoBoneIK(thigh, calf, foot, ank);
    }
    F.last = ank;
    // (what the sole shows: its lowest point over what it rests on — its tread, a nosing it rolls over — tests read it)
    let gap = Infinity; for (const p of solePoints(B, s, geo)) gap = Math.min(gap, p.y - supportOf(S, p.x, p.y, p.z));
    F.gap = gap; F.planted = !T.swing; F.flat = F.planted && !F.early && !F.settle && clip[s].hB < F.rest + 0.01; // (flat on its tread: the moment a test measures)
  }
  return true;
}

/**
 * A gun the runtime placed in the body's space from the bones (the Germans' rifles: enemy_weapons.js), not parented
 * to a hand bone, turned about the chest's pivot with the lean so it stays in the hands.
 */
function turnLooseGun(h, pivot, qW) {
  const w = h.weapon;
  if (!w?.parent || !w.visible) return;
  for (let p = w.parent; p && p !== h.object; p = p.parent) if (p.isBone) return; // held by a bone: it follows
  w.updateWorldMatrix(true, false);
  const P = new Vector3(), Q = new Quaternion(), Sc = new Vector3();
  w.matrixWorld.decompose(P, Q, Sc);
  P.sub(pivot).applyQuaternion(qW).add(pivot);
  Q.premultiply(qW);
  const inv = w.parent.matrixWorld.clone().invert();
  const M = w.matrixWorld.clone().compose(P, Q, Sc).premultiply(inv);
  M.decompose(w.position, w.quaternion, w.scale);
  w.updateMatrixWorld(true);
}

/** Move `ank` toward the hip just enough to be within `L` of it. */
function inReach(ank, hip, L) {
  const d = ank.distanceTo(hip);
  return d <= L ? ank : ank.sub(hip).multiplyScalar(L / d).add(hip);
}

/** The ankle target for a ball target: the clip's ankle-from-ball offset (its foot rotation) added. */
function ankleTarget(T, c, out) {
  return out.set(T.bx + (c.A.x - c.Bl.x), T.by + (c.A.y - c.Bl.y), T.bz + (c.A.z - c.Bl.z));
}

/** Hip → ankle length of a leg (bind lengths, world scale). */
function legLength(h, s) {
  const key = '_sgLeg' + s;
  if (h[key]) return h[key];
  const B = h.bones, sc = worldScale(B['calf_' + s]);
  return (h[key] = (B['calf_' + s].position.length() + B['foot_' + s].position.length()) * sc);
}

/**
 * How far (m) the foot's sole — the back of the heel, under the ball, the toe tip: the boot mesh's own vertices
 * (soleVertices), or points estimated from the bones before they are known — is below the tread under it
 * (+ clearance); 0 when clear (`signed`: how far its lowest point is above what it rests on — a nosing edge it
 * rolls over counts — negative).
 */
function soleDeficit(S, B, s, clear, geo, signed = false) {
  let need = signed ? -Infinity : 0;
  for (const p of solePoints(B, s, geo)) need = Math.max(need, (signed ? supportOf(S, p.x, p.y, p.z) : levelOf(S, p.x, p.z).y) + clear - p.y);
  return need;
}

/**
 * A planted sole point inside a riser (below the tread it is over by more than 5 cm): how far (m, along the flight's
 * axis, at most 8 cm) the foot moves to bring it out over the tread below; 0 when none is.
 */
function riserExit(S, B, s, geo) {
  const f = S.f;
  let best = 0;
  for (const p of solePoints(B, s, geo)) {
    const q = flightLocal(f, p.x, p.z).s, k = levelIndex(f, q);
    if (f.levels[k] - p.y < 0.05) continue;
    const [s0, s1] = levelSpan(f, k);
    let d = null;
    for (const [sx, kk] of [[s0 - 0.01, k - 1], [s1 + 0.01, k + 1]]) {
      if (kk < 0 || kk > f.risers.length || f.levels[kk] > p.y + 0.01 || !Number.isFinite(sx)) continue;
      if (d == null || Math.abs(sx - q) < Math.abs(d)) d = sx - q;
    }
    if (d != null && Math.abs(d) <= 0.08 && Math.abs(d) > Math.abs(best)) best = d;
  }
  return best;
}

/** World points of a foot's sole (heel, ball, toe tip). */
export function solePoints(B, s, geo) {
  const V = geo?.['sole_' + s];
  if (V) return V.map(({ m, i }) => m.getVertexPosition(i, new Vector3()).applyMatrix4(m.matrixWorld));
  const A = B['foot_' + s].getWorldPosition(new Vector3()), Bl = B['ball_' + s].getWorldPosition(new Vector3());
  const T = B['ball_leaf_' + s] ? B['ball_leaf_' + s].getWorldPosition(new Vector3()) : Bl.clone().sub(A).multiplyScalar(0.5).add(Bl);
  const heel = heelOf(B, s, geo, A, Bl);
  Bl.y -= geo?.['ball_' + s] ?? 0.02; T.y -= geo?.['toe_' + s] ?? 0.02;
  return [heel, Bl, T];
}

/**
 * The sole of a boot as three of its mesh vertices (skinned to the foot / ball / toe bones; the outfit and level of
 * detail shown), picked once in a flat-footed stance of the clip: the back of the heel and the tip of the toe (in the
 * lowest 3.5 cm of the boot), the lowest under the ball; with how far the sole reaches behind / ahead of the ball.
 * @returns {{m:object, i:number}[] & {heelD:number, toeD:number}|null}
 */
function soleVertices(h, B, s, c) {
  const want = new Set(['foot_' + s, 'ball_' + s, 'ball_leaf_' + s]), P = [];
  h.object.updateMatrixWorld(true);
  h.object.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry?.attributes?.skinIndex) return;
    // (the body as shown — its outfit, its level of detail — whatever is above the humanoid: a body culled off screen
    // is still measured)
    for (let p = o; p && p !== h.object; p = p.parent) if (p.visible === false) return;
    const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = g.attributes.position.count, bones = o.skeleton.bones;
    for (let i = 0; i < n; i++) {
      let bi = -1, bw = -1;
      for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > bw) { bw = wk; bi = si.getComponent(i, k); } }
      if (bones[bi] && want.has(bones[bi].name)) P.push({ m: o, i, p: o.getVertexPosition(i, new Vector3()).applyMatrix4(o.matrixWorld) });
    }
  });
  if (P.length < 8) return null;
  const d = new Vector3(c.Bl.x - c.A.x, 0, c.Bl.z - c.A.z).normalize(), at = (q) => (q.x - c.A.x) * d.x + (q.z - c.A.z) * d.z;
  let minY = Infinity; for (const q of P) minY = Math.min(minY, q.p.y);
  // (the lowest few cm of the boot: a stance a little off flat — the heel just up, the toes — still has its heel's and
  // its toe's edge in it)
  const low = P.filter((q) => q.p.y < minY + 0.035);
  if (!low.length) return null;
  const heel = low.reduce((a, b) => (at(b.p) < at(a.p) ? b : a));
  const toe = low.reduce((a, b) => (at(b.p) > at(a.p) ? b : a));
  const sb = at(c.Bl), nearBall = P.filter((q) => Math.abs(at(q.p) - sb) < 0.03);
  const ball = (nearBall.length ? nearBall : low).reduce((a, b) => (b.p.y < a.p.y ? b : a));
  const V = [heel, ball, toe].map(({ m, i }) => ({ m, i }));
  V.heelD = sb - at(heel.p); V.toeD = at(toe.p) - sb; // (how far the sole reaches behind / ahead of the ball, m)
  return V;
}

/**
 * World position of the back of the heel's sole: a point fixed in the foot bone's frame, measured once per body from
 * a flat-footed stance (geo.heel − geo.ab behind the ankle, at the ball's sole height); before that, estimated level.
 */
function heelOf(B, s, geo, A, Bl) {
  const loc = geo['heel_' + s];
  if (loc) return B['foot_' + s].localToWorld(loc.clone());
  const d = _v.copy(Bl).sub(A).setY(0); const dl = d.length() || 1; d.multiplyScalar(1 / dl);
  return new Vector3(A.x - d.x * (geo.heel - geo.ab), Bl.y - 0.025, A.z - d.z * (geo.heel - geo.ab));
}

/** A foot comes down: plant its ball where its swing was heading (or, the first time, snapped where the clip has it). */
function touchDown(S, F, s, c, f, geo, root) {
  const W = F.sw;
  if (W && (W.u ?? 0) < 0.5 && F.lastB) {
    // (down long before its swing was over — a clip foot that came back down: it lands where it shows, on the tread under it)
    const B = F.lastB, p = snapBall(S, B.bx, B.bz, c.fx, c.fz, geo);
    F.plant = p;
    F.settle = Math.hypot(B.bx - p.x, B.bz - p.z) > 0.01 || B.by - (p.y + c.hB) > 0.01 ? { x: B.bx, z: B.bz, dy: Math.max(0, B.by - (p.y + c.hB)), t: 0 } : null;
  } else if (W) {
    const T = W.to;
    F.plant = { x: T.x, z: T.z, y: T.y, k: T.k ?? null };
    const B = F.lastB;
    const off = B ? B.by - (T.y + c.hB) : 0;
    F.settle = B && (Math.hypot(B.bx - T.x, B.bz - T.z) > 0.01 || Math.abs(off) > 0.01) ? { x: B.bx, z: B.bz, dy: Math.max(0, off), t: 0 } : null;
  } else F.plant = snapBall(S, c.Bl.x, c.Bl.z, c.fx, c.fz, geo);
  F.c0 = { x: c.Bl.x, z: c.Bl.z };
  clipTouch(S, F, s, c, root, W);
  F.sw = null;
}

/**
 * The clip's foot comes down: what it tells of the gait — the swing's time and the clip foot's travel (a swing of the
 * clip's own: not one pulled up early), where the clip lands a foot relative to the body (his frame), the step length
 * (for the cadence).
 */
function clipTouch(S, F, s, c, root, W) {
  // (where in its cycle the clip puts this foot down)
  if (S.u != null && S.vb > 0.3 && S.clip != null) {
    const U = ((S.uc ||= {})[S.clip] ||= {})[s] ||= { x: 0, y: 0, n: 0 }, a = 2 * Math.PI * S.u;
    U.x += (Math.cos(a) - U.x) * (U.n ? 0.4 : 1); U.y += (Math.sin(a) - U.y) * (U.n ? 0.4 : 1); U.n++;
  }
  if (W) {
    const dur = S.t - W.t0, dd = W.c0 ? Math.hypot(c.Bl.x - W.c0.x, c.Bl.z - W.c0.z) : 0;
    if (!W.forced && dur > 0.08 && dur < 1.2) F.tsw = F.tsw == null ? dur : F.tsw + (dur - F.tsw) * 0.4;
    if (!W.forced && S.vb > 0.3 && dd > 0.1 && dd < 2.5) F.dsw = F.dsw == null ? dd : F.dsw + (dd - F.dsw) * 0.4;
  }
  // where the clip lands a foot relative to the body (his frame), and the step length (for the cadence)
  const yaw = root.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const ox = c.Bl.x - root.position.x, oz = c.Bl.z - root.position.z;
  const land = { f: ox * fx + oz * fz, r: ox * rx + oz * rz };
  if (S.vb > 0.3) F.land = F.land ? { f: F.land.f + (land.f - F.land.f) * 0.5, r: F.land.r + (land.r - F.land.r) * 0.5 } : land;
  if (S.td && S.td.s !== s && S.vb > 0.3) {
    const d = Math.hypot(root.position.x - S.td.x, root.position.z - S.td.z) * (S.kOn || 1);
    if (d > 0.15 && d < 2.2) S.L = S.L == null ? d : S.L + (d - S.L) * 0.35;
  }
  S.td = { s, x: root.position.x, z: root.position.z };
  // phase: the clip put the foot down past its foothold (it is late: the body had gone on) or short of it (early) —
  // by so many seconds of the body's way along the flight
  const f = S.f, P = F.plant, along = S.vx * f.ux + S.vz * f.uz;
  if (P && Math.abs(along) > 0.3) lag(S, (((c.Bl.x - P.x) * f.ux + (c.Bl.z - P.z) * f.uz) * Math.sign(along)) / Math.abs(along));
}

/**
 * The clip is `t` s behind the feet (a foot left / came down that long after the stairs had it: play it faster for a
 * while) or ahead of them (t < 0: slower). (Within ±GAIT.phaseLag: the clip's own timing.)
 */
function lag(S, t) {
  const a = Math.min(Math.abs(t), 0.5) - GAIT.phaseLag;
  if (a > 0) S.pkT = clamp((S.pkT ?? 1) + GAIT.phase * a * Math.sign(t), 1 / GAIT.phaseMax, GAIT.phaseMax);
}

/** Contact phases per stepping clip and character (contactPhases): freed with the clip (a mission's scoped assets). */
const PHASES = new WeakMap();

/**
 * Where in its cycle (0..1) the stepping clip puts each foot down — the ball of the foot coming down to within a few cm
 * of its lowest — sampled once per character and clip from the clip itself (the mixer evaluated at 40 times of the
 * cycle, then put back where it was). Null while the clip is not playing alone (a cross-fade) or has no clear step.
 * @returns {{l:number, r:number}|null}
 */
function contactPhases(m, h, act) {
  const clip = act?.getClip?.();
  if (!clip || !h.mixer) return null;
  let byChar = PHASES.get(clip);
  if (!byChar) PHASES.set(clip, (byChar = new Map()));
  const key = m.characterId ?? '';
  if (byChar.has(key)) return byChar.get(key);
  if (act.getEffectiveWeight() < 0.95) return null;
  const B = h.bones, D = clip.duration, t0 = act.time, N = 40, hs = { l: [], r: [] }, top = topBone(h);
  for (let i = 0; i < N; i++) {
    act.time = (i / N) * D; h.mixer.update(0);
    h.object.updateWorldMatrix(true, false); top.updateMatrixWorld(true);
    for (const s of SIDES) hs[s].push(B['ball_' + s].getWorldPosition(_v).y);
  }
  act.time = t0; h.mixer.update(0); top.updateMatrixWorld(true);
  let out = {};
  for (const s of SIDES) {
    const a = hs[s], lo = Math.min(...a), hi = Math.max(...a);
    if (hi - lo < 0.04) { out = null; break; }
    const th = lo + Math.min(GAIT.down, (hi - lo) * 0.25);
    for (let i = 0; i < N && out[s] == null; i++) {
      const p = a[(i + N - 1) % N];
      if (a[i] < th && p >= th) out[s] = ((i - 1 + (p - th) / Math.max(1e-6, p - a[i])) / N + 1) % 1;
    }
    if (out[s] == null) { out = null; break; }
  }
  byChar.set(key, out);
  return out;
}

/** The stepping clip's action: the looping one with the most weight (not a one-shot layered over it). */
function stepAction(h) {
  const acts = h.mixer?._actions;
  if (!acts) return null;
  let best = null, bw = 0.2;
  for (const a of acts) {
    if (!a.isRunning?.() || a.loop === LoopOnce) continue;
    const w = a.getEffectiveWeight();
    if (w > bw) { bw = w; best = a; }
  }
  return best;
}

/**
 * The cadence (mixer time scale) that has the clip put the foot now in the air down just as the body gets to where the
 * clip lands it on its foothold: the clip's time to that contact (at its own pace, from where it is in its cycle and
 * where it has been seen to put that foot down) over the body's (its way to the spot over its speed along the flight).
 * Null while not known (no foot on its way, the clip's contact phase not known). A foot pulled up before its clip lifted
 * it counts: the clip, behind, catches up. Kept within −25 % / +60 % of the cadence `kc` the step length asks for.
 */
function stepLock(S, f, root, act, D, fwdX, fwdZ, P, kc = null) {
  // (where in its cycle the clip puts each foot down: sampled from the clip, else as seen — twice, consistently)
  const L = S.uc?.[S.clip], seen = (s) => (L?.[s]?.n >= 2 && Math.hypot(L[s].x, L[s].y) > 0.6 ? ((Math.atan2(L[s].y, L[s].x) / (2 * Math.PI)) % 1 + 1) % 1 : null);
  const U = { l: P?.l ?? seen('l'), r: P?.r ?? seen('r') };
  if (!act || !(D > 0.2) || S.u == null) return null;
  const along = S.vx * f.ux + S.vz * f.uz, sp = Math.abs(along);
  if (sp < 0.3) return null;
  // (a foot down before its clip has it down: the clip is late — it is to come down now; else the foot in the air the
  // longest, when the body gets to where the clip lands it on its foothold)
  let Y = null, early = false;
  for (const s of SIDES) {
    const F = S.feet[s];
    if (U[s] == null) continue;
    if (F.early && F.plant) { if (!early) { Y = s; early = true; } continue; }
    if (!early && F.sw?.to && F.land && (!Y || F.sw.t0 < S.feet[Y].sw.t0)) Y = s;
  }
  if (!Y) return null;
  const F = S.feet[Y];
  let tBody = 0;
  if (!early) {
    const rx = Math.cos(root.rotation.y), rz = -Math.sin(root.rotation.y);
    const landAlong = F.land.f * (fwdX * f.ux + fwdZ * f.uz) + F.land.r * (rx * f.ux + rz * f.uz);
    const sT = flightLocal(f, F.sw.to.x, F.sw.to.z).s, sR = flightLocal(f, root.position.x, root.position.z).s;
    if (Math.abs(sT - sR) > 1.6) return null; // (a foothold that far is no stride's: the prediction is off)
    tBody = ((sT - landAlong - sR) * Math.sign(along)) / sp;
  }
  const du = (((U[Y] - S.u) % 1) + 1) % 1;
  if (du > 0.97) return null; // (the clip has just put it down: the landing is in hand)
  const tClip = (du * D) / Math.max(0.05, act.getEffectiveTimeScale());
  const k = tClip / Math.max(0.06, tBody);
  // (within reach of the cadence the step length asks for: a phase is caught up, not a new pace taken)
  return clamp(kc ? clamp(k, kc * 0.75, kc * 1.6) : k, GAIT.kMin, GAIT.kMax);
}

/**
 * The clip's own step length (m) before one is measured: the walking speed times the step time of the locomotion clip
 * playing (half its cycle at its own time scale) — the cadence is right from the first step on the flight.
 */
function clipStep(h, v) {
  if (!(v > 0.3)) return null;
  const best = stepAction(h), D = best?.getClip?.().duration, ts = best?.getEffectiveTimeScale?.(); // (its own: the mixer's comes on top)
  if (!(D > 0.2) || !(ts > 0.05)) return null;
  const L = (v * D) / (2 * ts);
  return L > 0.15 && L < 2.2 ? L : null;
}

/** A foot leaves its tread: its swing starts from the planted spot. */
function liftOff(S, F, c) {
  const B = F.lastB, from = B ? { ...F.plant, x: B.bx, z: B.bz } : { ...F.plant }; // (from where it shows: a settle may not be over)
  F.sw = { t0: S.t, from, to: { ...F.plant }, tv: null, force: !!F.force, forced: !!F.force, c0: F.force ? null : { x: c.Bl.x, z: c.Bl.z }, u: 0 };
  F.plant = null; F.settle = null; F.early = false; F.swDone = null;
}

/** Is a planted foot out of its leg's reach from the hip (the clip's, lifted by the body offset dy)? */
function overReach(h, B, s, plant, c, dy) {
  const hip = B['thigh_' + s].getWorldPosition(_v); hip.y += dy;
  const ax = plant.x + (c.A.x - c.Bl.x), ay = plant.y + c.hB + (c.A.y - c.Bl.y), az = plant.z + (c.A.z - c.Bl.z);
  return Math.hypot(ax - hip.x, ay - hip.y, az - hip.z) > legLength(h, s) * 1.02;
}

/**
 * Where a swinging foot will come down (its ball, snapped onto a tread): standing (a turn on the spot, a shuffle)
 * where the clip has it now; walking where the body will be when it lands plus the clip's usual landing offset.
 */
function predictLanding(S, F, s, c, f, geo, root, Tsw, uu, standing, fwdX, fwdZ) {
  let x, z;
  if (standing || !F.land) { x = c.Bl.x; z = c.Bl.z; if (!standing && !F.land) { const lead = S.vb * Tsw * (1 - uu) * 0.5; x += S.vx / (S.vb || 1) * lead; z += S.vz / (S.vb || 1) * lead; } }
  else {
    const left = Math.max(0, Tsw * (1 - uu)), rx = Math.cos(root.rotation.y), rz = -Math.sin(root.rotation.y);
    x = root.position.x + S.vx * left + fwdX * F.land.f + rx * F.land.r;
    z = root.position.z + S.vz * left + fwdZ * F.land.f + rz * F.land.r;
  }
  // walking along the flight: the step covers n treads on from the other foot's foothold, at the same place on its
  // tread (a regular stride, whatever the clip's own step would have been), on the side of the stair the clip has it
  let kWant = null;
  if (!standing) {
    // (the other foot's foothold: where it stands, or — when it is in the air too — where it lands if it left before
    // this one (it lands first), else where it left: never each other's moving targets, which ratcheted both feet down)
    const o = S.feet[s === 'l' ? 'r' : 'l'], n = S.n ?? cadenceFor(S.L ?? 0.8, f.tread, S.vb).n;
    const ref = o.plant ? o.plant : o.sw ? (o.sw.t0 < F.sw.t0 ? o.sw.to : o.sw.from) : null, ok = ref?.k;
    const along = S.vx * f.ux + S.vz * f.uz, { s: sp, v } = flightLocal(f, x, z), N = f.risers.length;
    const onRun = (k) => k > 0 && k < N;
    if (ok != null && Math.abs(along) > 0.2 && Math.abs(v) <= f.w / 2 + ON && (onRun(ok) || onRun(levelIndex(f, sp)))) {
      const dir = Math.sign(along), sRef = flightLocal(f, ref.x, ref.z).s, sWant = sRef + dir * n * f.tread;
      if (Math.abs(sWant - sp) < 1.0) { // (else the stride and the body disagree — he turned, slowed, the clip changed: the prediction stands)
        kWant = clamp(ok + n * dir, 0, N);
        ({ x, z } = flightWorld(f, sWant, v));
      }
    }
  }
  const p = snapBall(S, x, z, fwdX, fwdZ, geo, kWant); // (the body's facing: a swinging foot points anywhere)
  // (sticky: a prediction that wanders by a hair keeps its tread)
  const o = F.sw.to;
  if (o && o !== F.sw.from && Math.abs(o.y - p.y) < 1e-6 && Math.hypot(o.x - p.x, o.z - p.z) < 0.03) return o;
  return p;
}

/** Leaving the stairs: the body group back on the root (unless prone-ground has it). */
function resetBody(m, S) {
  const body = m._body?.();
  if (S.bodyY && body && !m._pg?.active && !m._carryOn && !m._blend) body.position.y = 0;
  S.bodyY = false;
}

/** Leaving the stairs (or a body swap): the mixer plays at its own rate again. */
function resetCadence(S) {
  const h = S.inner;
  if (h?.mixer && h.mixer.timeScale !== 1) h.mixer.timeScale = 1;
}

/**
 * Ground under a man lying on a flight of stairs (prone-ground, UnitModel._proneGround): the flight's nosing line
 * (he lies along the steps' edges), with the pitch allowed up to its slope; null when he is not on one.
 * @returns {((x:number, z:number) => number|null) & {maxTilt?:number} | null}
 */
export function stairGround(u) {
  if (!GAIT.on || !u?.world?.stairs?.size) return null;
  const at = unitFlight(u, 0.9);
  if (!at) return null;
  const f = at.f;
  const fn = (x, z) => { const { s, v } = flightLocal(f, x, z); return Math.abs(v) > f.w / 2 + 0.6 ? null : lineAt(f, s); };
  fn.maxTilt = Math.min(40 * DEG, Math.atan(Math.abs(f.slope)) + 4 * DEG);
  return fn;
}
