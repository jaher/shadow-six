/**
 * The main menu's ground fight as data and pure functions (user: "Can we have rhe soldiers fighting and maybe a tank
 * crossing the bridge shooting", 2026-11-08; menu-ground.js draws it). Per theatre a few seeded variants of a small
 * battle on the still's own ground, in the mission's world metres (the theatre's still camera projects them:
 * ground-data/<theatre>.js): the game's commandos working up a bank in bounds — one pair runs while the other kneels
 * and fires — against Germans behind sandbags and an MG in a pillbox, and a Panzer IV crossing the bridge that stops,
 * traverses and fires on them. Every actor's state at a time t is a pure function of the plan (unit-tested; the
 * same seed flies the same fight).
 * @module ui/ground-plan
 */

import { rng } from './dogfight-plan.js';

const DEG = Math.PI / 180;
export const TANK_V = 5.0;       // m/s the tank drives at
export const SEAT_MIN = 0.7;      // the share of a fight's actors that must be in view and clear of the badge for it to be played on a screen

/** A man's gaits between bounds: ground speed (m/s) and the ground one cycle of the clip covers (m, two steps). */
export const GAITS = {
  run: { v: 4.3, stride: 2.7 },        // the run
  sprint: { v: 5.6, stride: 3.5 },     // run_fast: a dash across open ground
  crouch: { v: 2.2, stride: 1.45 },    // crouch_walk: bent low along cover
};
export const RUN = GAITS.run.v;
export const STRIDE = GAITS.run.stride;
/** Fire poses (each a sprite set of aim, shot and a second aim frame): kneeling, standing, prone, prone behind an MG. */
export const FIRE = new Set(['kneel', 'stand', 'prone', 'mg']);
/** Poses a man holds that sway between two frames (crouched in cover, looking about). */
export const SWAY = new Set(['cover', 'watch']);
/** Acts played once through their frames over their time (going down, a hit's fall, a reload, a throw, pointing). */
export const ONCE = new Set(['down', 'die', 'hit', 'reload', 'throw', 'point']);
/** Every act a man can be in, as the sprites name them (tools/ui/ground/cast.mjs bakes each look's own). */
export const ACTS = ['run', 'sprint', 'crouch', ...FIRE, ...SWAY, ...ONCE, 'dead'];
export const MG_BURST = 0.9;   // s an MG gunner's burst lasts (each of his shots is one)
export const THROW = { dur: 1.35, release: 0.47, flight: 1.05 };   // s, the share of the throw at the release, s in the air

const dist = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const lerp3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const headingTo = (a, b) => Math.atan2(b[0] - a[0], b[2] - a[2]); // the game's heading: front = +Z, rotation.y

/**
 * A soldier's part, built in order: each step starts where and when the last ended. He has his own look (one of the
 * theatre's cast: tools/ui/ground/cast.mjs; no two men of a fight share one) and his own phase offset `po` (0..1:
 * where in his run cycle and his aim's sway he is, so no two men move in step). Steps: run to a point (run, sprint or
 * crouch), fire (kneeling, standing, prone, or at an MG) facing a point with shots at given offsets, reload, throw a
 * grenade, point the way (an officer's orders), crouch in cover or peek up out of it to fire, go down, fire prone, be
 * hit, fall and lie still; `hold` waits in a pose.
 */
export class Soldier {
  constructor(side, at, t0 = 0, J = (v) => v, look = null, po = 0) {
    this.side = side; this.segs = []; this.t = t0; this.at = at; this.face = 0; this.J = J; this.shots = []; this.nades = [];
    this.look = look; this.po = po;
  }

  run(to, v = null, gait = 'run') {
    const G = GAITS[gait] || GAITS.run, d = dist(this.at, to), t1 = this.t + d / (v ?? G.v);
    this.segs.push({ act: gait, t0: this.t, t1, from: this.at, to, h: headingTo(this.at, to) });
    this.face = headingTo(this.at, to); this.at = to; this.t = t1;
    return this;
  }

  sprint(to, v = null) { return this.run(to, v, 'sprint'); }

  crouch(to, v = null) { return this.run(to, v, 'crouch'); }

  /** Fire for `dur` s facing `target` ([x, y, z]); shots every `every` s (jittered), the first after `first` s. */
  fire(dur, target, every = 1.4, first = 0.4, pose = 'kneel', exact = false) {
    const h = headingTo(this.at, target), t0 = this.t, t1 = t0 + (exact ? dur : this.J(dur, 0.06));
    const shots = [];
    for (let t = t0 + this.J(first, 0.3); t < t1 - 0.15; t += this.J(every, 0.25)) shots.push(t);
    this.segs.push({ act: pose, t0, t1, at: this.at, h, shots, target });
    for (const t of shots) this.shots.push({ t, from: this.at, to: target, pose, side: this.side });
    this.face = h; this.t = t1;
    return this;
  }

  /** Fire (in `pose`) until the fight's time `t` exactly — at least `min` s — so what happens next is on its cue (a burst by him). */
  fireUntil(t, target, pose = 'kneel', min = 0.5, every = 1.4) { return this.fire(Math.max(min, t - this.t), target, every, 0.35, pose, true); }

  kneel(dur, target, every, first) { return this.fire(dur, target, every, first, 'kneel'); }

  stand(dur, target, every, first) { return this.fire(dur, target, every, first, 'stand'); }

  prone(dur, target, every = 1.6, first = 0.5) { return this.fire(dur, target, every, first, 'prone'); }

  /** Work a reload (standing or kneeling, the clip's own) for dur s, facing his front. */
  reload(dur = 2.0) { return this._once('reload', dur); }

  /**
   * Throw a grenade at `target`: wind up, release (it flies THROW.flight s and bursts there), follow through. (A target's
   * height lifts its burst: one inside a sandbag pit bursts at the wall's top, its smoke rising from behind the wall.)
   */
  throw(target) {
    this.face = headingTo(this.at, target);
    const t0 = this.t;
    this._once('throw', THROW.dur);
    this.nades.push({ t: t0 + THROW.dur * THROW.release, from: this.at, to: target, flight: THROW.flight, h: this.face });
    return this;
  }

  /** Point the way at `target` for dur s (an officer's orders, a commando waving the next pair on). */
  point(dur, target) { this.face = headingTo(this.at, target); return this._once('point', dur); }

  /** Crouch in cover for dur s, facing `target` (his head below the wall: the still's depth hides him there). */
  cover(dur, target = null) { return this.hold(dur, 'cover', target); }

  /** Peek and fire `n` times over his cover: up and fire (standing) for `up` s, down for `down` s. */
  peek(n, target, up = 2.4, down = 1.8, every = 1.2) {
    for (let i = 0; i < n; i++) {
      this.cover(this.J(down, 0.2), target);
      this.fire(this.J(up, 0.1), target, every, 0.35, 'stand');
    }
    return this;
  }

  down(dur = 0.8) { return this._once('down', dur); }

  /** Hit: knocked back off his feet (0.85 s), then lies still (non-graphic: no blood). */
  hit(dur = 0.85) { this._once('hit', dur); return this.dead(); }

  die(dur = 1.3) { return this._once('die', dur); }

  /** Lie still to the end (the plan's end fades him with the rest). */
  dead() {
    this.segs.push({ act: 'dead', t0: this.t, t1: Infinity, at: this.at, h: this.face });
    this.t = Infinity;
    return this;
  }

  /** Wait in a pose for dur s, facing `target` if given (a defender watching his front). */
  hold(dur, pose = 'kneel', target = null) {
    if (target) this.face = headingTo(this.at, target);
    this.segs.push({ act: pose, t0: this.t, t1: this.t + dur, at: this.at, h: this.face, shots: [], target: null });
    this.t += dur;
    return this;
  }

  _once(act, dur) {
    this.segs.push({ act, t0: this.t, t1: this.t + dur, at: this.at, h: this.face });
    this.t += dur;
    return this;
  }
}

/**
 * A soldier's state at time t: where (world), which way (heading, rad), what (act: one of ACTS, or null before his
 * first step / after his last), which frame of it (`frame`: a run's cycle 0..1 from the ground covered and his own
 * offset; a fire pose's 'shot' at each round (the recoil) else 'aim' or 'aim2' as he sways; a held pose's 'a' / 'b';
 * a once-through act's progress 0..1), his look, and how much of him shows (alpha: the start's and the end's fades).
 */
export function soldierAt(s, t, end = Infinity) {
  const segs = s.segs;
  if (!segs.length || t < segs[0].t0) return null;
  let g = segs[segs.length - 1];
  for (const x of segs) if (t < x.t1) { g = x; break; }
  if (t >= g.t1) return null;                             // gone off after his last step
  // (never faded: a man comes in from off the screen or is at his post from the first frame, and stays to the end —
  // the dead down, the living at their posts: groundPlan, the unit tests)
  const alpha = 1, look = s.look, po = s.po || 0;
  if (GAITS[g.act]) {
    const f = (t - g.t0) / (g.t1 - g.t0), p = lerp3(g.from, g.to, f), d = dist(g.from, g.to) * f;
    return { act: g.act, p, h: g.h, phase: (d / GAITS[g.act].stride + po) % 1, alpha, look };
  }
  // a held pose sways (aim and aim2, a crouch's two frames) on his own slow beat: ~2.6 s a sway, offset by po
  const sway = Math.floor((t - g.t0) / 1.3 + po * 2) % 2;
  if (FIRE.has(g.act)) {
    // a round's recoil shows for 0.12 s; an MG's burst for MG_BURST s, the gun shaking (recoil and aim by turns)
    const mg = g.act === 'mg', ts = (g.shots || []).find((x) => t >= x && t < x + (mg ? MG_BURST : 0.12));
    const shot = ts != null && (!mg || Math.floor((t - ts) * 22) % 2 === 0);
    return { act: g.act, p: g.at, h: g.h, phase: shot ? 0.5 : 0, frame: shot ? 'shot' : sway ? 'aim2' : 'aim', shot, alpha, look };
  }
  if (SWAY.has(g.act)) return { act: g.act, p: g.at, h: g.h, phase: 0, frame: sway ? 'b' : 'a', alpha, look };
  const f = Math.min(1, (t - g.t0) / (g.t1 - g.t0));
  return { act: g.act, p: g.at, h: g.h, phase: g.act === 'dead' ? 0 : f, alpha, look };
}

/**
 * The tank's part: a route of world points, and steps — drive (to a distance along the route), stop, traverse the
 * turret (deg, + = left), fire at a world point (the shell lands `flight` s later), drive on.
 */
export class Tank {
  constructor(route, t0 = 0, s0 = 0) {
    this.route = route; this.len = [0];
    for (let i = 1; i < route.length; i++) this.len.push(this.len[i - 1] + dist(route[i - 1], route[i]));
    this.segs = []; this.t = t0; this.s = s0; this.yaw = 0; this.shots = [];
  }

  drive(s1, v = TANK_V) {
    const t1 = this.t + Math.abs(s1 - this.s) / v;
    this.segs.push({ act: 'drive', t0: this.t, t1, s0: this.s, s1, y0: this.yaw, y1: this.yaw });
    this.s = s1; this.t = t1;
    return this;
  }

  turn(yaw1, dur) {
    this.segs.push({ act: 'turn', t0: this.t, t1: this.t + dur, s0: this.s, s1: this.s, y0: this.yaw, y1: yaw1 });
    this.yaw = yaw1; this.t += dur;
    return this;
  }

  fire(target, wait = 1.2, flight = 0.25) {
    this.shots.push({ t: this.t + 0.3, target, flight });
    return this.turn(this.yaw, wait);
  }

  /**
   * The route's point and direction at distance s: before its start (s < 0) and past its end the road runs on straight
   * (the tank comes in from, and goes off to, beyond the frame).
   */
  pointAt(s) {
    const L = this.len, R = this.route, n = L.length;
    let i = 1;
    while (i < n - 1 && L[i] < s) i++;
    let f = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
    if (i > 1) f = Math.max(0, f);
    if (i < n - 1) f = Math.min(1, f);
    const p = lerp3(R[i - 1], R[i], f);
    if (f < 0) p[1] = R[0][1]; else if (f > 1) p[1] = R[n - 1][1];   // (on at the end's own height)
    return { p, h: headingTo(R[i - 1], R[i]) };
  }

  /** The route's length (its end; past it the last leg runs on). */
  get length() { return this.len[this.len.length - 1]; }
}

/** The tank at time t: where, its hull heading, turret yaw (rad), the gun's recoil (0..1) and its odometer (m). */
export function tankAt(k, t) {
  if (!k.segs.length || t < k.segs[0].t0) return null;
  let g = k.segs[k.segs.length - 1];
  for (const x of k.segs) if (t < x.t1) { g = x; break; }
  if (t >= g.t1 && g === k.segs[k.segs.length - 1] && g.act !== 'turn') return null;
  const f = Math.max(0, Math.min(1, (t - g.t0) / ((g.t1 - g.t0) || 1)));
  const s = g.s0 + (g.s1 - g.s0) * f, { p, h } = k.pointAt(s);
  const shot = k.shots.find((x) => t >= x.t && t < x.t + 0.5);
  return { p, h, yaw: (g.y0 + (g.y1 - g.y0) * (f * f * (3 - 2 * f))) * DEG, recoil: shot ? 1 - (t - shot.t) / 0.5 : 0, odo: s, alpha: 1 };
}

/** World points of the river still (m16's map: the W bank field, the sandbag pit, the pillbox, the bridge deck). */
const W = {
  pit: [[22.0, 0, 78.4], [23.8, 0, 78.5]],                // behind the S wall of the sandbag pit (D_W)
  mg: [19.9, 1.45, 64.7],                                  // pb_w's SW embrasure
  // the E bridgehead road, the deck (E end to W end, 1 m up), the NW road off the frame
  route: [[99.8, 0.1, 114.9], [91.5, 1.0, 108.5], [25.7, 1.0, 54.0], [18.5, 0.1, 44.3], [0, 0, 25]],
  // the tank comes in from, and backs off to, this far before the route's start along the E road (its box beyond the
  // frame's right edge: u 2150), and drives this far past its end up the W road (beyond the left edge: u -230); every
  // screen shows a part of the still, so off the still is off every screen (the unit tests check each). inLead: the
  // seconds the way in from there adds before the tank reaches the route's start (its parts keep their times)
  inFrom: -14, outTo: 5, inLead: 2.8,
};

/**
 * Where a theatre's actors may go (the unit tests hold the plans to it): `water` the river (world x, z polygon: no
 * soldier in it), `deck` / `roads` the tank's ground (a polyline and its half width).
 */
export const GROUND_OF = {
  snow: {   // m07: the harbour basin beyond the quay face
    water: [[0, 102], [49.5, 146.7], [57, 148], [60, 160], [64, 176], [70, 184.5], [78, 185.5], [84, 180], [84, 160], [82, 150],
      [89.4, 135.2], [108.7, 127.3], [131.4, 111.6], [144, 107.7], [144, 195], [0, 195]],
  },
  desert: { water: [] },
  coast: {  // m13: only the quays are dry (the NW jetty, the main dock)
    land: [[[0, 41], [6, 41], [10, 39], [15, 40.5], [17.5, 43], [17.5, 51], [12, 52], [6, 50], [0, 50.5]],
      [[28.5, 31], [87, 31], [87, 112], [78, 113], [40, 113], [30, 112], [29.5, 103], [33, 98.5], [49, 99.5], [58, 98], [63, 96],
        [64, 83], [60, 75], [60, 51], [57, 49.5], [36, 49.5], [28.5, 48]]],
  },
  temperate: {
    water: [[0, 104], [24, 88], [40, 73], [59, 50], [76.5, 28], [100, 0], [166, 0], [148.5, 22.4], [111, 70], [97.7, 79],
      [89, 95], [78.3, 110.6], [67.5, 119.6], [58, 150], [0, 150]],
    // (the road runs on straight past both ends of the route, off the frame)
    tank: { line: [[110.9, 0.1, 123.4], ...W.route, [-3.5, 0, 21.4]], half: 2.2 },
  },
};

/**
 * A man of a fight: side, his look (tools/ui/ground/cast.mjs; one man per look), where and when he starts — and his
 * own phase offset: the fight's men take them in turn along the golden ratio (no two closer than 1/18 of a cycle for
 * up to 11 men), the whole set turned by the seed and each nudged a little.
 */
const man = (J) => {
  let n = 0;
  const base = J(1, 0.5);
  return (side, look, at, t0) => new Soldier(side, at, t0, J, look, (base + n++ * 0.381966 + J(1, 0.01) - 1) % 1);
};

/** A variant fitted to the screens the others do not sit on (variantOrder tries it after them). */
const fallback = (fn) => Object.assign(fn, { fallback: true });

/** The theatres' stages: each variant(J) returns { dur, soldiers: Soldier[], tank: Tank|null, mg: {at, bursts}|null }. */
export const STAGES = {
  /** m07's quay in the snow: commandos come along it from the W end against Germans at the crates by the crane. */
  snow: [
    (J) => {
      const S = man(J);
      const crates = [37.6, 0.9, 116.4], tgt = [J(22.5, 0.03), 0, J(111.5, 0.01)];
      // the Sapper bounds up the quay's S side and throws a Mills bomb at the crates; a German there is caught by it
      const sp = S('ally', 'sp', [17.0, 0, 102.0], J(3.6, 0.2)).run([22.0, 0, 107.2]).kneel(J(4.0, 0.1), crates).crouch([28.4, 0, 111.4]);
      sp.throw([J(36.4, 0.01), 0, J(115.2, 0.005)]).kneel(J(3.4, 0.1), crates).die().dead();
      const nb = sp.nades[0].t + sp.nades[0].flight;
      const gb = S('ally', 'gb', [17.4, 0, 104.0], J(0.6, 0.3)).run([19.6, 0, 109.0]).kneel(J(3.4, 0.1), crates).sprint([23.7, 0, 110.6])
        .kneel(J(4.2, 0.1), crates).down().prone(J(9, 0.1), crates);
      const dr = S('ally', 'dr', [16.8, 0, 107.5], J(2.2, 0.3)).run([21.0, 0, 113.6]).stand(J(3.6, 0.1), crates).run([23.2, 0, 118.4])
        .stand(J(3.0, 0.1), crates).cover(J(1.6, 0.1), crates).stand(J(8, 0.1), crates);
      // the Sniper keeps back by the W end, low along the quay's edge, then prone
      const sn = S('ally', 'sn', [14.6, 0, 108.6], J(1.2, 0.2)).crouch([19.0, 0, 113.4]).down().prone(J(20, 0.05), crates, J(2.8, 0.05), 1.0);
      const d1 = S('axis', 'w_hel', [36.8, 0, 115.6], 0).hold(J(1.8, 0.2), 'watch', tgt).stand(J(5.5, 0.06), tgt, 1.5).cover(J(1.4, 0.1), tgt);
      d1.fireUntil(nb + 0.06, tgt, 'stand').hit();
      const d2 = S('axis', 'w_cap', [39.2, 0, 117.9], 0).hold(J(2.8, 0.2), 'watch', tgt).stand(J(8, 0.05), tgt, 1.7).reload(2.0).stand(J(12, 0.05), tgt, 1.6);
      const d3 = S('axis', 'gc_nco', [44.0, 0, 123.0], J(7.5, 0.1)).run([41.5, 0, 119.2], 3.6).stand(J(12, 0.05), tgt, 1.3);
      const d4 = S('axis', 'w_cap2', [38.2, 0, 113.4], J(0.4, 0.2)).hold(J(1.2, 0.2), 'watch', tgt).kneel(J(20, 0.05), tgt, 1.9);
      const d5 = S('axis', 'gc_rf', [42.4, 0, 114.6], J(1.0, 0.2)).hold(J(3.4, 0.2), 'watch', tgt).stand(J(18, 0.05), tgt, 2.0);
      return { dur: 24, soldiers: [sp, gb, dr, sn, d1, d2, d3, d4, d5], tank: null, mg: null };
    },
    /** The commandos already down at the quay's W end, covering, as two more Germans run up from the crane. */
    (J) => {
      const S = man(J);
      const crates = [37.6, 0.9, 116.4], tgt = [J(22.0, 0.03), 0, J(111.0, 0.01)];
      const gb = S('ally', 'gb', [19.6, 0, 109.0], J(0.4, 0.2)).prone(J(7, 0.1), crates).hold(0.5, 'prone');
      const dr = S('ally', 'dr', [21.0, 0, 113.6], J(0.9, 0.2)).stand(J(5.6, 0.1), crates).run([23.4, 0, 115.2]).kneel(J(10, 0.1), crates);
      const sp = S('ally', 'sp', [17.0, 0, 102.0], J(4.2, 0.3)).run([22.0, 0, 107.2]).kneel(J(4.6, 0.1), crates).crouch([26.2, 0, 109.6])
        .kneel(J(9, 0.1), crates);
      const sn = S('ally', 'sn', [18.4, 0, 112.6], J(0.2, 0.2)).prone(J(22, 0.05), crates, J(3.0, 0.05), 1.6);
      const d1 = S('axis', 'w_hel', [36.8, 0, 115.6], 0).hold(J(1.4, 0.2), 'watch', tgt).stand(J(15.5, 0.05), tgt, 1.5).die().dead();
      const d2 = S('axis', 'w_cap', [44.0, 0, 123.0], J(1.8, 0.2)).run([39.2, 0, 117.9], 3.6).stand(J(6.0, 0.08), tgt, 1.6).die().dead();
      const d3 = S('axis', 'gc_nco', [46.5, 0, 125.5], J(3.4, 0.2)).run([41.5, 0, 119.2], 3.6).stand(J(16, 0.05), tgt, 1.3);
      const d4 = S('axis', 'w_cap2', [38.2, 0, 113.4], J(0.6, 0.2)).kneel(J(9, 0.06), tgt, 1.8).reload(1.9).kneel(J(10, 0.05), tgt, 1.8);
      const d5 = S('axis', 'gc_rf', [42.4, 0, 114.6], J(0.2, 0.2)).hold(J(2.0, 0.2), 'watch', tgt).stand(J(18, 0.05), tgt, 2.1);
      return { dur: 25, soldiers: [gb, dr, sp, sn, d1, d2, d3, d4, d5], tank: null, mg: null };
    },
  ],
  /** m11's oil field: commandos come over the open sand at the house and palms against Afrika Korps men behind the wire. */
  desert: [
    (J) => {
      const S = man(J);
      const wire = [21.5, 0.9, 91.6], tgt = [J(-1.5, 0.3), 0, J(95.5, 0.01)];
      const gb = S('ally', 'gb', [-9.0, 0, 99.0], J(0.5, 0.3)).run([-3.0, 0, 97.5]).kneel(J(3.2, 0.1), wire).sprint([2.7, 0, 94.0])
        .kneel(J(4.6, 0.1), wire).down().prone(J(9, 0.1), wire);
      const mr = S('ally', 'mr', [-9.5, 0, 93.0], J(2.0, 0.3)).run([-4.5, 0, 92.5]).kneel(J(3.8, 0.1), wire).run([1.5, 0, 90.0])
        .kneel(J(3.0, 0.1), wire).die().dead();
      const sp = S('ally', 'sp', [-11.0, 0, 102.5], J(3.4, 0.2)).run([-2.9, 0, 102.3]).kneel(J(4.4, 0.1), wire).crouch([3.0, 0, 99.5])
        .cover(J(1.6, 0.1), wire).kneel(J(3.6, 0.1), wire).down().prone(J(8, 0.1), wire);
      const sn = S('ally', 'sn', [-8.6, 0, 96.2], J(1.0, 0.2)).crouch([-5.6, 0, 96.0]).down().prone(J(22, 0.05), wire, J(2.9, 0.05), 1.2);
      const d1 = S('axis', 'ak_cap', [20.0, 0, 90.1], 0).hold(J(1.6, 0.2), 'watch', tgt).stand(J(9, 0.05), tgt, 1.5).reload(2.0).stand(J(10, 0.05), tgt, 1.5);
      const d2 = S('axis', 'ak_hel', [26.0, 0, 92.8], 0).hold(J(2.6, 0.2), 'watch', tgt).stand(J(11, 0.06), tgt, 1.7).die().dead();
      const d3 = S('axis', 'ak_nco', [33.4, 0, 91.0], J(6.5, 0.1)).run([28.6, 0, 96.0], 3.8).stand(J(13, 0.05), tgt, 1.3);
      const d4 = S('axis', 'ak_pith', [23.4, 0, 94.6], J(0.8, 0.2)).hold(J(1.4, 0.2), 'watch', tgt).kneel(J(20, 0.05), tgt, 1.9);
      const d5 = S('axis', 'off', [29.5, 0, 88.0], J(0.3, 0.2)).point(J(2.4, 0.1), tgt).stand(J(5.2, 0.1), tgt, 1.6).hold(J(1.6, 0.2), 'watch', tgt)
        .point(J(2.2, 0.1), tgt).stand(J(10, 0.05), tgt, 1.7);
      return { dur: 24, soldiers: [gb, mr, sp, sn, d1, d2, d3, d4, d5], tank: null, mg: null };
    },
    /** The Afrika Korps come forward past the tanker to the derrick; the commandos, already down in the sand, open up. */
    (J) => {
      const S = man(J);
      const wire = [21.5, 0.9, 91.6], tgt = [J(-2.5, 0.3), 0, J(97.0, 0.01)];
      const gb = S('ally', 'gb', [-3.0, 0, 97.5], J(0.3, 0.2)).prone(J(20, 0.05), wire);
      const mr = S('ally', 'mr', [-4.5, 0, 92.5], J(0.6, 0.2)).kneel(J(6.5, 0.1), wire).die().dead();
      const sp = S('ally', 'sp', [-11.0, 0, 102.5], J(2.6, 0.2)).run([-2.9, 0, 102.3]).kneel(J(5.2, 0.1), wire).crouch([3.0, 0, 99.5])
        .kneel(J(9, 0.1), wire);
      const sn = S('ally', 'sn', [-5.6, 0, 96.0], J(0.1, 0.2)).prone(J(22, 0.05), wire, J(3.0, 0.05), 1.4);
      const d1 = S('axis', 'ak_cap', [23.4, 0, 85.2], J(0.8, 0.2)).run([20.0, 0, 90.1], 3.8).stand(J(4.4, 0.1), tgt, 1.4).die().dead();
      const d2 = S('axis', 'ak_hel', [29.4, 0, 87.9], J(1.6, 0.2)).sprint([26.0, 0, 92.8]).stand(J(18, 0.05), tgt, 1.6);
      const d3 = S('axis', 'ak_nco', [32.0, 0, 91.1], J(3.0, 0.2)).run([28.6, 0, 96.0], 3.8).stand(J(9.0, 0.08), tgt, 1.3).die().dead();
      const d5 = S('axis', 'off', [31.6, 0, 86.4], J(0.2, 0.2)).point(J(2.6, 0.1), tgt).hold(J(1.4, 0.2), 'watch', tgt).stand(J(6, 0.1), tgt, 1.7)
        .point(J(2.0, 0.1), tgt).stand(J(10, 0.05), tgt, 1.8);
      return { dur: 25, soldiers: [gb, mr, sp, sn, d1, d2, d3, d5], tank: null, mg: null };
    },
    /**
     * For the tall screens (the badge covers the middle of the still): the open sand under it, between the tanker and
     * the tents — the Afrika Korps behind the long wire, the commandos bounding up the sand below it from below the frame.
     * A fallback: played only where neither of the others sits (on a wide screen it would play in the badge's shade).
     */
    fallback((J) => {
      const S = man(J);
      const wireT = [J(24.4, 0.02), 0.9, J(107.4, 0.01)], tgtA = [J(19.5, 0.03), 0, J(110.5, 0.01)];
      const gb = S('ally', 'gb', [13.4, 0, 126.8], J(0.5, 0.3)).run([20.0, 0, 108.5]).kneel(J(3.4, 0.1), wireT).sprint([21.4, 0, 107.0])
        .kneel(J(4.4, 0.1), wireT).down().prone(J(9, 0.1), wireT);
      const mr = S('ally', 'mr', [15.6, 0, 127.6], J(1.8, 0.3)).run([22.2, 0, 111.1]).kneel(J(3.6, 0.1), wireT).run([23.5, 0, 109.6])
        .kneel(J(3.0, 0.1), wireT).die().dead();
      const sp = S('ally', 'sp', [18.0, 0, 128.6], J(3.2, 0.2)).run([24.1, 0, 113.4]).kneel(J(4.2, 0.1), wireT).crouch([25.2, 0, 112.0])
        .cover(J(1.6, 0.1), wireT).kneel(J(3.6, 0.1), wireT).down().prone(J(8, 0.1), wireT);
      const d1 = S('axis', 'ak_cap', [22.6, 0, 101.0], 0).hold(J(1.6, 0.2), 'watch', tgtA).stand(J(19, 0.05), tgtA, 1.5);
      const d2 = S('axis', 'ak_hel', [25.3, 0, 104.1], 0).hold(J(2.6, 0.2), 'watch', tgtA).stand(J(11, 0.06), tgtA, 1.7).die().dead();
      const d3 = S('axis', 'ak_nco', [31.0, 0, 103.0], J(6.5, 0.1)).run([28.0, 0, 107.2], 3.8).stand(J(13, 0.05), tgtA, 1.3);
      return { dur: 24, soldiers: [gb, mr, sp, d1, d2, d3], tank: null, mg: null };
    }),
  ],
  /**
   * m13's harbour: commandos on the NW jetty trade fire across the channel with Germans on the main dock — on its open
   * corner by the quay face (past it the hut and the cruiser's hull hide a man: the still's depth), coming out from behind the hut.
   */
  coast: [
    (J) => {
      const S = man(J);
      const dock = [31.0, 0.9, 42.0], tgt = [J(12.0, 0.04), 0, J(47.5, 0.01)];
      const gb = S('ally', 'gb', [4.8, 0, 50.0], J(0.5, 0.3)).run([9.6, 0, 47.5]).kneel(J(4.0, 0.1), dock).sprint([12.6, 0, 46.2])
        .kneel(J(5.0, 0.1), dock).down().prone(J(9, 0.1), dock);
      const dr = S('ally', 'dr', [4.2, 0, 48.0], J(2.0, 0.3)).run([11.4, 0, 48.9]).stand(J(4.4, 0.1), dock).run([16.4, 0, 49.6]);
      dr.stand(J(3.2, 0.1), dock).die().dead();
      const mr = S('ally', 'mr', [4.5, 0, 46.0], J(3.4, 0.2)).run([9.8, 0, 43.6]).kneel(J(4.6, 0.1), dock).cover(J(1.6, 0.1), dock).down().prone(J(11, 0.1), dock);
      const spy = S('ally', 'spy', [2.4, 0, 44.4], J(1.2, 0.2)).crouch([6.4, 0, 45.4]).stand(J(3.0, 0.1), dock, 1.3).crouch([8.2, 0, 41.8])
        .stand(J(12, 0.05), dock, 1.5);
      const d1 = S('axis', 'rf1', [30.2, 0, 44.0], 0).hold(J(1.8, 0.2), 'watch', tgt).stand(J(8, 0.05), tgt, 1.6).reload(2.0).stand(J(10, 0.05), tgt, 1.6);
      const d2 = S('axis', 'rf2', [29.6, 0, 40.6], 0).hold(J(2.6, 0.2), 'watch', tgt).stand(J(10, 0.06), tgt, 1.6).die().dead();
      const d3 = S('axis', 'tr', [36.0, 0, 40.0], J(6.0, 0.1)).run([30.9, 0, 41.9], 3.6).stand(J(12, 0.05), tgt, 1.3);
      const d4 = S('axis', 'sg', [30.6, 0, 46.4], J(0.5, 0.2)).point(J(2.4, 0.1), tgt).stand(J(5, 0.1), tgt, 1.7).hold(J(1.5, 0.2), 'watch', tgt)
        .point(J(2.0, 0.1), tgt).stand(J(10, 0.05), tgt, 1.8);
      return { dur: 24, soldiers: [gb, dr, mr, spy, d1, d2, d3, d4], tank: null, mg: null };
    },
    /** The commandos hold the jetty's end, down by the bollards, as the dock's men come up from its far end. */
    (J) => {
      const S = man(J);
      const dock = [31.0, 0.9, 42.0], tgt = [J(12.0, 0.04), 0, J(47.0, 0.01)];
      const gb = S('ally', 'gb', [12.6, 0, 46.2], J(0.3, 0.2)).prone(J(20, 0.05), dock);
      const dr = S('ally', 'dr', [10.0, 0, 48.8], J(0.8, 0.2)).stand(J(7.4, 0.1), dock).die().dead();
      const mr = S('ally', 'mr', [4.5, 0, 46.0], J(2.0, 0.2)).run([9.8, 0, 43.6]).kneel(J(5, 0.1), dock).down().prone(J(12, 0.1), dock);
      const spy = S('ally', 'spy', [6.4, 0, 45.4], J(0.6, 0.2)).stand(J(4.4, 0.1), dock, 1.4).crouch([8.2, 0, 41.8]).stand(J(14, 0.05), dock, 1.5);
      const d1 = S('axis', 'rf2', [29.6, 0, 40.6], 0).hold(J(1.4, 0.2), 'watch', tgt).stand(J(17, 0.05), tgt, 1.6);
      const d2 = S('axis', 'tr', [36.0, 0, 40.0], J(1.2, 0.2)).run([29.4, 0, 45.6], 3.6).stand(J(5.5, 0.08), tgt, 1.3).die().dead();
      const d3 = S('axis', 'rf1', [35.6, 0, 42.4], J(4.5, 0.2)).run([30.9, 0, 41.9], 3.6).stand(J(8, 0.06), tgt, 1.6).die().dead();
      const d4 = S('axis', 'sg', [30.6, 0, 46.4], J(0.2, 0.2)).hold(J(1.6, 0.2), 'watch', tgt).point(J(2.4, 0.1), tgt).stand(J(16, 0.05), tgt, 1.8);
      return { dur: 25, soldiers: [gb, dr, mr, spy, d1, d2, d3, d4], tank: null, mg: null };
    },
  ],
  temperate: [
    /**
     * Commandos work up the W bank past the big tree toward the sandbag pit in bounds, one man running while his mate
     * kneels and fires; the Sniper prone at the tree line; the pit's Germans peek and fire over its wall, an officer
     * behind it points the commandos out, and an MG34 team fires prone by the pit's W end; a Panzer IV comes down the E
     * road, stops at the bridge's E ramp, traverses and fires twice across the river on the commandos — the first shell
     * knocks one down, the rest go to ground — and the Sapper, crouched along the S edge, throws a Mills bomb into the
     * pit; then the tank crosses the bridge and is gone up the W road.
     */
    (J) => {
      const S = man(J);
      const tgtA = [J(15.5, 0.03), 0, J(85.5, 0.01)], tgtB = [J(11.5, 0.05), 0, J(92, 0.02)], pit = [22.6, 0.9, 78.0];
      const mgT = [J(12.5, 0.04), 0, J(89, 0.01)];
      // it stops in the sun on the deck's E end, fires across the river on the W bank, then crosses and is gone
      const tank = new Tank(W.route, J(1.5, 0.2) - W.inLead, W.inFrom).drive(10.5).drive(14.5, 1.8).turn(J(23.9, 0.03), J(1.8, 0.1)).fire(tgtA)
        .turn(J(29.3, 0.02), 1.2).fire(tgtB).turn(0, 1.4);
      tank.drive(tank.length + W.outTo, 7.2);
      const hit = tank.shots[0].t + tank.shots[0].flight;                   // the first shell's burst
      const gb = S('ally', 'gb', [3.9, 0, 83.7], J(0.6, 0.3)).run([10.2, 0, 82.9]).kneel(J(3.4, 0.1), pit).sprint([14.75, 0, 81.3])
        .kneel(J(4.0, 0.1), pit).down().prone(J(6, 0.1), pit).hold(3, 'prone');
      const dr = S('ally', 'dr', [3.0, 0, 91.7], J(0.9, 0.3)).run([9.85, 0, 93.4]).stand(J(3.2, 0.1), pit).run([14.4, 0, 89.8]);
      dr.kneel(Math.max(0.6, hit + 0.12 - dr.t), pit).die().dead();          // the shell's blast knocks him down
      const sp = S('ally', 'sp', [3.6, 0, 76.4], J(3.0, 0.2)).run([9.3, 0, 76.8]).kneel(J(3.0, 0.1), pit).crouch([14.3, 0, 76.6]);
      sp.kneel(Math.max(0.5, hit + 0.3 - sp.t), pit).throw([J(22.3, 0.01), 0.75, J(78.9, 0.005)]).down().prone(J(9, 0.1), pit);
      const nb = sp.nades[0].t + sp.nades[0].flight;                        // the Mills bomb's burst in the pit
      const mr = S('ally', 'mr', [3.4, 0, 96.7], J(3.3, 0.2)).run([8.0, 0, 95.6]).kneel(J(2.6, 0.1), pit).cover(J(1.6, 0.1), pit).run([12.0, 0, 93.4]);
      mr.kneel(Math.max(0.5, hit + 0.45 - mr.t), pit).down().prone(J(9, 0.1), pit);
      const sn = S('ally', 'sn', [2.4, 0, 89.4], J(1.4, 0.2)).crouch([6.2, 0, 88.4]).down().prone(J(24, 0.05), pit, J(2.9, 0.05), 1.2);
      // the pit's W man peeks and fires over the wall until the bomb bursts by him; the E man fires on, reloads, fires
      const d1 = S('axis', 'rf1', W.pit[0], 0).hold(J(2.2, 0.2), 'watch', tgtA).stand(J(3.4, 0.1), tgtA, 1.5).cover(J(1.5, 0.2), tgtA);
      d1.fireUntil(nb + 0.06, tgtA, 'stand').hit();
      const d2 = S('axis', 'rf2', W.pit[1], 0).hold(J(3.0, 0.2), 'watch', tgtA).stand(J(7.5, 0.08), tgtA, 1.7).reload(2.0).stand(J(12, 0.05), tgtA, 1.6);
      const d3 = S('axis', 'tr', [24.5, 0, 66.5], J(12.6, 0.1)).run([22.9, 0, 77.6], 3.8).stand(J(12, 0.05), tgtA, 1.3);
      const off = S('axis', 'off', [26.2, 0, 74.6], J(0.8, 0.2)).point(J(2.4, 0.1), tgtA).stand(J(4.5, 0.1), tgtA, 1.6).hold(J(1.8, 0.2), 'watch', tgtA)
        .point(J(2.2, 0.1), tgtB).stand(J(14, 0.05), tgtA, 1.7);
      const mg = S('axis', 'mg', [19.0, 0, 72.2], 0).hold(J(2.6, 0.2), 'mg', mgT).fire(J(24, 0.05), mgT, J(3.6, 0.05), 0.4, 'mg');
      const mg2 = S('axis', 'mg2', [19.6, 0, 71.0], 0).hold(J(4.0, 0.2), 'prone', mgT).prone(J(22, 0.05), mgT, J(3.3, 0.1), 1.0);
      return { dur: 29, soldiers: [gb, dr, sp, mr, sn, d1, d2, d3, off, mg, mg2], tank, mg: null };
    },
    /**
     * The same bank, the other way round: the commandos come on harder — both pairs bound twice and the Sapper closes on
     * the pit and bombs it — while the tank, stopped at the bridge's E end, fires twice and then backs off up the E road
     * (for the screens where the bridge's middle shows under the card's column: it never crosses there); the pillbox's
     * MG fires from its embrasure.
     */
    (J) => {
      const S = man(J);
      const tgtA = [J(16.5, 0.03), 0, J(83.5, 0.01)], tgtB = [J(12.5, 0.05), 0, J(89, 0.02)], pit = [22.6, 0.9, 78.0];
      const tank = new Tank(W.route, J(4.0, 0.15) - W.inLead, W.inFrom).drive(10.5).drive(14.5, 1.8).turn(J(23.0, 0.03), J(1.6, 0.1)).fire(tgtA)
        .turn(J(27.5, 0.02), 1.3).fire(tgtB).turn(0, 1.6).drive(W.inFrom, 4.2);
      const hit = tank.shots[1].t + tank.shots[1].flight;                   // the second shell's burst
      const sp = S('ally', 'sp', [3.6, 0, 76.4], J(0.5, 0.3)).run([9.3, 0, 76.8]).kneel(J(2.6, 0.1), pit).crouch([14.3, 0, 76.6])
        .kneel(J(2.4, 0.1), pit).crouch([17.6, 0, 79.9]).throw([J(23.7, 0.01), 0.75, J(78.9, 0.005)]).kneel(J(2.6, 0.1), pit).down().prone(J(9, 0.1), pit);
      const nb = sp.nades[0].t + sp.nades[0].flight;
      const mr = S('ally', 'mr', [3.9, 0, 83.7], J(0.8, 0.3)).run([10.2, 0, 82.9]).kneel(J(2.8, 0.1), pit).run([14.75, 0, 81.3])
        .cover(J(1.6, 0.1), pit).kneel(J(3.4, 0.1), pit).down().prone(J(10, 0.1), pit);
      const dr = S('ally', 'dr', [3.0, 0, 91.7], J(2.6, 0.2)).run([9.85, 0, 93.4]).stand(J(3.4, 0.1), pit).run([13.2, 0, 87.6]);
      dr.stand(Math.max(0.6, hit + 0.12 - dr.t), pit).die().dead();
      const gb = S('ally', 'gb', [3.4, 0, 96.7], J(3.0, 0.2)).run([8.0, 0, 95.6]).kneel(J(4.4, 0.1), pit).sprint([11.6, 0, 91.0])
        .kneel(J(4.0, 0.1), pit).down().prone(J(9, 0.1), pit);
      const sn = S('ally', 'sn', [2.6, 0, 86.6], J(0.4, 0.2)).crouch([6.8, 0, 86.2]).down().prone(J(24, 0.05), pit, J(3.0, 0.05), 1.0);
      const d1 = S('axis', 'rf1', W.pit[0], 0).hold(J(1.6, 0.2), 'watch', tgtA).stand(J(7, 0.06), tgtA, 1.4).reload(1.9).stand(J(14, 0.05), tgtA, 1.4);
      const d2 = S('axis', 'rf2', W.pit[1], 0).hold(J(2.4, 0.2), 'watch', tgtA).peek(2, tgtA, 2.6, 1.6, 1.3);
      d2.fireUntil(nb + 0.06, tgtA, 'stand').hit();                         // the Mills bomb bursts by him
      const d3 = S('axis', 'tr', [24.5, 0, 66.5], J(9, 0.1)).run([21.3, 0, 77.6], 3.8).stand(J(14, 0.05), tgtA, 1.3);
      const off = S('axis', 'off', [25.6, 0, 72.6], J(0.4, 0.2)).hold(J(1.8, 0.2), 'watch', tgtA).point(J(2.4, 0.1), tgtA).stand(J(5, 0.1), tgtA, 1.6)
        .point(J(2.2, 0.1), tgtB).stand(J(14, 0.05), tgtA, 1.7);
      const mg = { at: W.mg, bursts: [2.8, 6.9, 11.4, 15.8, 20.2, 24.0].map((t) => ({ t: J(t, 0.06), dur: J(1.0, 0.2), target: tgtA })) };
      return { dur: 28, soldiers: [sp, mr, dr, gb, sn, d1, d2, d3, off], tank, mg };
    },
    /**
     * For a tablet held landscape (the still's W bank is a strip at the screen's left edge there): a close assault on the
     * pit — the commandos come low along the bank's edge from off the screen's left, go to ground eight metres short of it; the
     * Sapper crawls up and bombs it from five; the MG34 team fires from the pillbox side; the tank, stopped at the
     * bridge's E end, fires twice on them and backs off. A fallback: played only where neither of the others sits.
     */
    fallback((J) => {
      const S = man(J);
      const tgtA = [J(17.6, 0.02), 0, J(85.4, 0.01)], tgtB = [J(16.8, 0.03), 0, J(88.6, 0.01)], pit = [22.6, 0.9, 78.0];
      const mgT = [J(17.4, 0.02), 0, J(87.0, 0.01)];
      const tank = new Tank(W.route, J(4.0, 0.15) - W.inLead, W.inFrom).drive(10.5).drive(14.5, 1.8).turn(J(23.4, 0.03), J(1.6, 0.1)).fire(tgtB)
        .turn(J(26.5, 0.02), 1.3).fire(tgtA).turn(0, 1.6).drive(W.inFrom, 4.2);
      const hit = tank.shots[0].t + tank.shots[0].flight;                   // the first shell's burst
      const gb = S('ally', 'gb', [12.6, 0, 90.6], J(0.4, 0.3)).crouch([17.1, 0, 86.2]).kneel(J(5.0, 0.1), pit).down().prone(J(14, 0.05), pit);
      const sp = S('ally', 'sp', [12.2, 0, 91.4], J(1.6, 0.3)).crouch([16.6, 0, 87.6]).kneel(J(2.6, 0.1), pit).crouch([19.0, 0, 82.6]);
      sp.throw([J(22.3, 0.01), 0.75, J(78.9, 0.005)]).kneel(J(3.0, 0.1), pit).down().prone(J(10, 0.1), pit);
      const nb = sp.nades[0].t + sp.nades[0].flight;
      const dr = S('ally', 'dr', [12.8, 0, 92.0], J(2.8, 0.3)).crouch([18.4, 0, 88.2]);
      dr.stand(Math.max(0.6, hit + 0.12 - dr.t), pit).die().dead();          // the shell's blast knocks him down
      const mr = S('ally', 'mr', [13.0, 0, 92.8], J(4.2, 0.2)).crouch([16.4, 0, 89.4]).down().prone(J(18, 0.05), pit, 1.8, 0.6);
      const d1 = S('axis', 'rf1', W.pit[0], 0).hold(J(1.6, 0.2), 'watch', tgtA).stand(J(4.0, 0.1), tgtA, 1.4).cover(J(1.4, 0.2), tgtA);
      d1.fireUntil(nb + 0.06, tgtA, 'stand').hit();
      const d2 = S('axis', 'rf2', W.pit[1], 0).hold(J(2.4, 0.2), 'watch', tgtA).stand(J(7, 0.06), tgtA, 1.6).reload(1.9).stand(J(14, 0.05), tgtA, 1.5);
      const d3 = S('axis', 'tr', [24.5, 0, 66.5], J(9, 0.1)).run([21.3, 0, 77.6], 3.8).stand(J(14, 0.05), tgtA, 1.3);
      const off = S('axis', 'off', [25.6, 0, 72.6], J(0.4, 0.2)).point(J(2.4, 0.1), tgtA).stand(J(5, 0.1), tgtA, 1.6).hold(J(1.6, 0.2), 'watch', tgtA)
        .point(J(2.2, 0.1), tgtB).stand(J(14, 0.05), tgtA, 1.7);
      const mg = S('axis', 'mg', [20.6, 0, 69.0], 0).hold(J(2.2, 0.2), 'mg', mgT).fire(J(24, 0.05), mgT, J(3.4, 0.05), 0.4, 'mg');
      const mg2 = S('axis', 'mg2', [21.6, 0, 68.3], 0).hold(J(3.6, 0.2), 'prone', mgT).prone(J(22, 0.05), mgT, J(3.1, 0.1), 1.0);
      return { dur: 27, soldiers: [gb, sp, dr, mr, d1, d2, d3, off, mg, mg2], tank, mg: null };
    }),
  ],
};

/**
 * World -> screen through a theatre's still camera (ground-data: vp column-major, p11) and the still's cover on this
 * screen (k css px a still px, the still's left edge at ox): (x, y, z) -> [css x, css y, view depth m].
 */
export function projector(data, k, ox) {
  const m = data.vp;
  return (x, y, z) => {
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [ox + (cx / cw + 1) * 960 * k, (1 - cy / cw) * 540 * k, cw];
  };
}

/** Whether a css px box is wholly behind the badge (region.badge's cells: menu-ground does not draw it there). */
export function behindBadge(region, l, t, r, b) {
  const { w, h, cols, rows, badge } = region, cw = w / cols, ch = h / rows;
  const c0 = Math.max(0, Math.floor(l / cw)), c1 = Math.min(cols - 1, Math.floor(r / cw));
  const r0 = Math.max(0, Math.floor(t / ch)), r1 = Math.min(rows - 1, Math.floor(b / ch));
  if (c0 > c1 || r0 > r1) return false;
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (!badge[y * cols + x]) return false;
  return true;
}

/**
 * Seat a plan on a screen (`region` as the dogfight's: {w, h, k, ox, cols, rows, badge, text}): every actor sampled
 * through the fight (a man's box 2.1 m tall, 2 wide; the tank's 2.8 m by 7.2; a shell burst's earth and smoke): out if
 * one would be drawn over the card's text (with 8 px to spare; one wholly behind the badge is not drawn at all), else
 * the share of them that shows (on the screen, not behind the badge) and the box they touch. @returns {{seen:number, box:{x,y,w,h}}|{why:string}}
 */
export function seatGround(plan, data, region) {
  const { w, h, k, ox, cols, rows, badge, text } = region, cw = w / cols, ch = h / rows, P = projector(data, k, ox);
  const pxm = (z) => data.p11 * 540 / z * k;
  let seen = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, why = null;
  const add = (x, y, z, hm, wm) => {
    const s = pxm(z), l = x - wm * s, r = x + wm * s, t = y - hm * s, b = y + 0.4 * s;
    n++;
    if (r < 0 || l > w || b < 0 || t > h) return true;
    if (behindBadge(region, l, t, r, b)) return true;        // wholly behind the badge: not drawn (menu-ground)
    if (text && r > text[0] - 8 && l < text[2] + 8 && b > text[1] - 8 && t < text[3] + 8) { why = `over the text at ${x.toFixed(0)},${y.toFixed(0)}`; return false; }
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x / cw))) + Math.min(rows - 1, Math.max(0, Math.floor((y - 0.9 * s) / ch))) * cols;
    if (!badge[c]) seen++;
    x0 = Math.min(x0, l); x1 = Math.max(x1, r); y0 = Math.min(y0, t); y1 = Math.max(y1, b);
    return true;
  };
  for (let t = 0; t <= (plan.end ?? plan.dur); t += 0.5) {
    for (const s of plan.soldiers) {
      const a = soldierAt(s, t, plan.end ?? plan.dur);
      if (a && !add(...P(a.p[0], a.p[1], a.p[2]), 2.1, 1.0)) return { why };
    }
    const tk = plan.tank && tankAt(plan.tank, t);
    if (tk && !add(...P(tk.p[0], tk.p[1], tk.p[2]), 2.8, 3.6)) return { why };   // hull and turret (the aerial is a hair)
  }
  for (const sh of plan.shells) if (!add(...P(...sh.target), 9, 5)) return { why };
  for (const g of plan.nades || []) if (!add(...P(...g.to), 5, 3)) return { why };   // a grenade's burst, smaller
  const box = { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)) };
  box.w = Math.max(2, Math.min(w, Math.ceil(x1)) - box.x); box.h = Math.max(2, Math.min(h, Math.ceil(y1)) - box.y);
  return { seen: n ? seen / n : 0, box };
}

/**
 * The variants a screen tries for a seed, in order (menu-ground plays the first that sits on it): the regular ones from
 * the seed's own on, then the fallbacks (fitted to the screens the others do not sit on).
 * @returns {number[]}
 */
export function variantOrder(theater, seed) {
  const reg = [], fb = [];
  (STAGES[theater] || []).forEach((v, i) => (v.fallback ? fb : reg).push(i));
  return [...reg.map((_, j) => reg[((seed >>> 0) + j) % reg.length]), ...fb];
}

/**
 * A fight for a theatre and seed: the variant the seed picks (or the one asked for), jittered by it; the end where
 * everyone fades.
 * @returns {{theater, seed, dur, soldiers, tank, mg, shells}|null}
 */
export function groundPlan(theater, seed, variant = null) {
  const vs = STAGES[theater];
  if (!vs?.length) return null;
  const r = rng(seed * 4099 + 7), J = (v, f = 0.05) => v * (1 + (r() * 2 - 1) * f);
  const vi = variant ?? variantOrder(theater, seed)[0], v = vs[vi](J);
  // nobody appears in the open: a man whose part starts later is at his post from the first frame — a German who moves
  // up later watches from where he starts, one already in place (and a commando already in place) is there from t = 0;
  // a commando bounding in comes from off the screen (the unit tests hold every screen's plans to it)
  for (const s of v.soldiers) {
    const g = s.segs[0];
    if (!g || g.t0 <= 0) continue;
    if (!GAITS[g.act]) g.t0 = 0;
    else if (s.side === 'axis') s.segs.unshift({ act: 'watch', t0: 0, t1: g.t0, at: g.from, h: g.h, shots: [], target: null });
  }
  // the end: the shooting stops at dur; the fight runs on until the tank has left the frame (end), and then the field
  // stays as it is — the dead down, the living at their posts — until the scene changes (menu-ground)
  let end = v.dur;
  if (v.tank) { const last = v.tank.segs[v.tank.segs.length - 1]; end = Math.max(end, last.t1); }
  v.end = end;
  for (const s of v.soldiers) holdOn(s, v.dur, end);
  const shells = v.tank ? v.tank.shots : [], nades = v.soldiers.flatMap((s) => s.nades);
  return { theater, seed, variant: vi, mg: null, ...v, shells, nades };
}

/**
 * Nobody leaves before the end: a man whose part ends early keeps at it (a firing man fires on at his own pace until
 * the shooting stops at dur, then holds his aim to the end; one who ran, reloaded, threw or pointed holds in the last
 * fire pose he used; one who went down holds prone; a held pose holds on; the dead lie still).
 */
function holdOn(s, dur, end) {
  const g = s.segs[s.segs.length - 1];
  if (!g || g.t1 >= end) return;
  if (FIRE.has(g.act)) {
    const sh = g.shots, every = sh.length > 1 ? (sh[sh.length - 1] - sh[0]) / (sh.length - 1) : 1.6;
    for (let t = (sh.length ? sh[sh.length - 1] : g.t0) + every; g.target && t < dur - 0.15; t += every) {
      sh.push(t); s.shots.push({ t, from: g.at, to: g.target, pose: g.act, side: s.side });
    }
    g.t1 = end; s.t = end;
  } else if (SWAY.has(g.act)) { g.t1 = end; s.t = end; }
  else if (g.act === 'die' || g.act === 'hit') s.dead();
  else if (g.act === 'down') s.hold(end - s.t, 'prone');
  else s.hold(end - s.t, [...s.segs].reverse().find((x) => FIRE.has(x.act))?.act || (s.side === 'ally' ? 'kneel' : 'stand'));
}
