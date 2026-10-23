/**
 * The sim side of stairs and ladders (user request 2026-10-07: "animate the commandos climbing and going down stairs
 * properly"), for Unit._followPath:
 *  - pace: a man on a flight of stairs (world/stairs.js) goes a little slower — walking × STAIR_PACE.walk, a run is a
 *    careful jog (× STAIR_PACE.run, ≤ STAIR_PACE.runMax and ≤ STAIR_PACE.jog treads a second: no faster than legs take
 *    the flight's treads two at a time), crawling × STAIR_PACE.crawl — eased in over the first and last half metre of the
 *    flight (a pure function of where he is: replays and loads stay deterministic);
 *  - stair links (`ladders[]` kind 'stairs', walked): his height is the flight's nosing line; planks: the straight
 *    line between the link's ends;
 *  - ladders: up / down the ladder's line from its foot to its top (the link's ends) at CONFIG.abilities.ladderSpeed
 *    along it, always facing the ladder (art/ladder-climb.js shows the hands and feet on its rungs).
 * @module entities/stair-walk
 */
import { CONFIG } from '../config.js';
import { STAIR_PACE, flightLocal, flightWorld, lineAt } from '../world/stairs.js';

const LOW = new Set(['crawl', 'downed']);
const smooth = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

/** The flight a unit walks on now ({f, s, v} of StairField.flightAt; `pad` m past its ends, `side` m beside it), or null. */
export function unitFlight(u, pad = 0, side = 0.15) {
  const F = u.world?.grid?.flights;
  if (!F?.size) return null;
  const wp = u.path?.[u.pathIndex];
  const link = wp?.link?.walk === 'stairs' ? wp.link.id : null;
  return F.flightAtP ? F.flightAtP(u.x, u.z, u.y ?? 0, pad, side, 0.45, link) : F.flightAt(u.x, u.z, u.y ?? 0, { pad, side, link });
}

/**
 * Speed (m/s) of a unit on a flight of stairs for his speed `v` off them (`v` itself off them): walking × STAIR_PACE.walk,
 * running × STAIR_PACE.run but no faster than STAIR_PACE.runMax (a careful jog: two treads a stride), crawling ×
 * STAIR_PACE.crawl, eased over the first / last 0.5 m of the flight. Swimmers and men in a vehicle are never on stairs.
 */
export function stairSpeed(u, v) {
  const st = u.stance;
  if (st === 'swim' || st === 'dive' || u.vehicle) return v;
  const at = unitFlight(u, 0.5);
  if (!at) return v;
  const { f, s } = at;
  const k = smooth(Math.min(s - (f.sFoot - 0.5), f.sTop + 0.5 - s) / 0.5);
  const on = LOW.has(st) ? v * STAIR_PACE.crawl
    : u.moveMode === 'run' ? Math.min(v * STAIR_PACE.run, STAIR_PACE.runMax, STAIR_PACE.jog * f.tread) : v * STAIR_PACE.walk;
  return v + (on - v) * k;
}

/**
 * Half-widths (m) of a man's body that stay inside a flight's rails (user 2026-10-11: "it looks like the man walk on
 * the stairs in a way they can cross the handrails, fix that"): on his feet his shoulders and swinging arms (+ 4 cm),
 * lying his elbows, with a man over his shoulder that man's dangling arms.
 */
export const RAIL_BODY = Object.freeze({ stand: 0.38, crawl: 0.42, carry: 0.44 });

/** How far off a flight's axis (m) a unit's middle may be: its clear half-width less his body's (0: kept on it). */
export function railBand(f, u, still = false) {
  // (standing — where he was sent: he turns there, his arms out of their swing — a hand's breadth more)
  return Math.max(0, (f.clear ?? f.w / 2) - railBody(u) - (still ? 0.1 : 0));
}

/**
 * Room (m) a unit on a flight's run has to step aside from its axis — his band between the rails (railBand) — or
 * null when he is not on one (a stair link's men keep to its line).
 */
export function railRoom(u) {
  // (on it, or lining up in front of an end: no dodge takes him out of line there either)
  const m = RAIL_APPROACH + 0.3, at = unitFlight(u, m + 0.6, 0);
  if (!at || at.f.link || at.s < at.f.railS[0] - m || at.s > at.f.railS[1] + m || Math.abs(at.v) > (at.f.clear ?? at.f.w / 2)) return null;
  return railBand(at.f, u);
}

/** A unit's body half-width kept off rails (RAIL_BODY: on his feet, lying, a man over his shoulder). */
export const railBody = (u) => RAIL_BODY[u?.carrying && u.carryMode !== 'drag' ? 'carry' : LOW.has(u?.stance) ? 'crawl' : 'stand'];

/**
 * Where a unit on a flight's run stands out of its band (railBand) — pushed by a dodge, a crowd, a corner of his path —
 * the shift (world dx, dz) that puts him back inside it; null when he is inside or not on a flight. A man whose middle
 * is past a rail's inner face is beside the flight, not on it (pushed off it, never through the rail).
 */
export function railShift(u) {
  if (u?.vehicle || u?._ladder || u?._climb) return null;
  const at = unitFlight(u, 2, RAIL_BODY.carry + 0.05);
  if (!at) return besideLinkFlight(u);
  const { f, s, v } = at;
  if (s < f.railS[0] - 0.1 || s > f.railS[1] + 0.1) return null; // (between its rails' ends: the stair and its landing)
  const c = f.clear ?? f.w / 2, b = railBand(f, u, !u.path), av = Math.abs(v);
  // (on it: his middle inside his band; beside it, his body off its rail from outside — at the stair's foot, by its
  // landing — walking round to its end)
  // (only where its rails stand: on a first tread before them he may step off it sideways — a way past its foot)
  let to = null;
  const railed = s >= f.railAt[0] && s <= f.railAt[1];
  if (av <= c) { if (railed && av > b + 1e-4) to = b; } else if (railed) { const out = c + railBody(u); if (av < out - 1e-4) to = out; }
  if (to == null) return null;
  const dv = Math.sign(v) * to - v;
  return { x: -f.uz * dv, z: f.ux * dv };
}

/**
 * A point a unit walks to, inside his band on the flight whose stair (and landing) it is on — where its rails stand
 * (railShift's reach): a point he could reach only over a rail would leave him walking on the spot against it.
 * @returns {object} the point (a copy when moved)
 */
export function railPoint(u, p, still = false) {
  const F = u?.world?.grid?.flights;
  if (!F?.size || !p || p.link || p.steer) return p;
  for (const f of F.near(p.x, p.z, 0.3)) {
    if (f.link) continue;
    const q = flightLocal(f, p.x, p.z);
    if (q.s < f.railAt[0] || q.s > f.railAt[1] || Math.abs(q.v) > f.clear) continue; // (where railShift holds him)
    const b = railBand(f, u, still);
    return Math.abs(q.v) > b + 1e-3 ? { ...p, ...flightWorld(f, q.s, Math.sign(q.v) * b) } : p;
  }
  return p;
}

/** How far out (m) a man on his feet lines up on a stair's axis before he steps on at its foot / head (railPath). */
export const RAIL_APPROACH = 0.9;

/**
 * A path up / down a flight of stairs (not a stair link: its ends are the path's) between its rails (user 2026-10-11:
 * "it looks like the man walk on the stairs in a way they can cross the handrails, fix that"): every point on its run
 * moves onto its axis — the last one, where he was sent, into his band (railBand) — and where a leg comes on or goes
 * off at an end, it passes that end on the axis, lined up RAIL_APPROACH m out (when that is walkable ground at the
 * end's height): head-on, never across the stair on the slant. (Getting on only at the ends is the runs' rule:
 * grid.canStep, walkableLine — fix/ramp-crawl; the crawler's longer line-up is pathfinding alignRuns.)
 * @returns {object[]} the path (a new array when points were added)
 */
export function railPath(u, path, goal = null) {
  const g = u?.world?.grid, F = g?.flights;
  if (!F?.size || !path?.length) return path;
  const fl = F.flights.filter((f) => !f.link);
  // (sent to a spot on a stair's run: that spot, not the planner's cell centre beside it — the straight line up to it
  // otherwise drifts across the stair)
  const last = path[path.length - 1];
  if (goal && path.length > 1 && !last.link && !last.steer && Math.hypot(goal.x - last.x, goal.z - last.z) < 0.75) {
    for (const f of fl) {
      const q = flightLocal(f, goal.x, goal.z), ql = flightLocal(f, last.x, last.z);
      if (q.s < f.railS[0] || q.s > f.railS[1] || Math.abs(q.v) > railBand(f, u, true) || ql.s < f.railS[0] - 0.5 || ql.s > f.railS[1] + 0.5) continue;
      // (on its treads, not under them or on a walk beside: the grid's own height there is the stair's)
      if (!g.walkableAt(goal.x, goal.z) || Math.abs(g.elevAt(goal.x, goal.z) - lineAt(f, q.s)) > 0.5) break;
      path = [...path.slice(0, -1), { ...last, x: goal.x, z: goal.z }];
      break;
    }
  }
  const near = (f, x0, z0, x1, z1, m) => !(Math.max(x0, x1) < f.box[0] - m || Math.min(x0, x1) > f.box[2] + m || Math.max(z0, z1) < f.box[1] - m || Math.min(z0, z1) > f.box[3] + m);
  const out = [path[0]];
  // (the flights the path is on now — from where he stands, then as its legs come on and go off them: a point it
  // passes while on one is on that stair, whatever the planner's cells beside it said)
  const on = new Map(); // (flight → his lane on it, m off its axis)
  for (const f of fl) {
    const q = flightLocal(f, path[0].x, path[0].z);
    if (q.s >= f.railS[0] && q.s <= f.railS[1] && Math.abs(q.v) <= f.clear && Math.abs((u.y ?? 0) - lineAt(f, q.s)) < 0.5) { const b = railBand(f, u); on.set(f, Math.max(-b, Math.min(b, q.v))); }
  }
  for (let i = 1; i < path.length; i++) {
    let p = path[i];
    const a = out[out.length - 1];
    if (!p.link && !a.link && !p.steer) {
      // (the flights this leg comes on to / goes off: at their foot or head end, lined up a little way out — however
      // the planner's cells had him come at it — in his lane: parallel to the axis, as far off it as the planner's line
      // was there, inside his band (men coming the same way keep their own lanes: no two of them on one spot))
      const ins = [];
      const onRun = (f, q) => q.s >= f.railS[0] && q.s <= f.railS[1] && Math.abs(q.v) <= f.clear;
      const railed = (f, q) => q.s >= f.railAt[0] && q.s <= f.railAt[1] && Math.abs(q.v) <= f.clear;
      for (const f of fl) {
        if (!near(f, a.x, a.z, p.x, p.z, 1.0)) continue;
        const qa = flightLocal(f, a.x, a.z), qp = flightLocal(f, p.x, p.z);
        // (from a point it came on at, or one between its rails: a first tread's corner it only cut is none of it)
        const ia = on.has(f) || railed(f, qa), ip = onRun(f, qp);
        if (ia === ip) continue;
        // (a way past its foot / head over its first tread, before its rails, and off it sideways — not up / down it:
        // nothing to line up for — M3's E stair foot, the way north from the raft landing)
        if (!ia && !railed(f, qp) && !path.slice(i + 1).some((q) => !q.link && railed(f, flightLocal(f, q.x, q.z)))) continue;
        const qo = ia ? qp : qa, qi = ia ? qa : qp, mid = (f.railS[0] + f.railS[1]) / 2, b = railBand(f, u);
        const atFoot = qo.s < mid, sE = atFoot ? f.railS[0] : f.railS[1], out1 = atFoot ? -1 : 1, yE = atFoot ? f.levels[0] : f.levels[f.levels.length - 1];
        // (his lane: where the planner's line crosses that end)
        const sE0 = (atFoot ? f.railS[0] : f.railS[1]), tx = (qa.s - qp.s) !== 0 ? Math.min(1, Math.max(0, (qa.s - sE0) / (qa.s - qp.s))) : 0;
        // (on at its middle; off where his line crosses its end, within half his band: men going the same way do not all
        // meet on one spot there)
        const lv = !ia ? 0 : Math.max(-b / 2, Math.min(b / 2, qa.v + (qp.v - qa.v) * tx));
        const E = flightWorld(f, sE, lv), A = flightWorld(f, sE + out1 * RAIL_APPROACH, lv);
        const ground = (q) => g.walkableAt(q.x, q.z) && Math.abs(g.elevAt(q.x, q.z) - yE) < 0.4;
        // (the point outside the end — where he comes from / goes to: lined up already when on his lane's line
        // within ~15°; closer than the line-up point, it moves onto that line instead of a step back out)
        const coming = !ia, d = (qo.s - sE) * out1;
        const lined = d >= 0 && Math.abs(qo.v - lv) <= 0.1 + 0.27 * d;
        const pts = [];
        let onto = null;
        // (lined up coming on only: going off, he turns once past the rails' ends — a run-out along the line made the
        // men behind him queue on its last treads)
        if (coming) {
          if (d >= 0 && d < RAIL_APPROACH) {
            // (that point onto his line — or, where that is no ground, a point on it nearer the end)
            if (Math.abs(qo.v - lv) > 0.05) for (const sq of [qo.s, sE + out1 * Math.min(d, 0.25), sE + out1 * 0.1]) { const P = flightWorld(f, sq, lv); if (ground(P)) { if (sq === qo.s) onto = P; else pts.push(P); break; } }
          } else if (!lined && ground(A)) pts.push(A);
        }
        const t = coming ? 0 : 1;
        ins.push({ t, f, lv, coming, onto, pts: coming ? [...pts, E] : [E, ...pts] });
      }
      ins.sort((x, y) => x.t - y.t);
      for (const x of ins) {
        if (x.coming) on.set(x.f, x.lv); else on.delete(x.f);
        // (coming on from close outside the end: that point onto the axis, when it is one of the path's own)
        if (x.coming && x.onto && out.length > 1 && !out[out.length - 1].link) out[out.length - 1] = { ...out[out.length - 1], x: x.onto.x, z: x.onto.z };
        // (going off to a point close outside it: that point onto the axis — unless he was sent there)
        if (!x.coming && x.onto && i < path.length - 1) p = { ...p, x: x.onto.x, z: x.onto.z };
        for (const q of x.pts) if (Math.hypot(q.x - out[out.length - 1].x, q.z - out[out.length - 1].z) > 0.05) out.push({ x: q.x, z: q.z });
      }
      // (a point on a run: on its axis — the last one inside his band)
      for (const f of fl) {
        if (!near(f, p.x, p.z, p.x, p.z, 1.0)) continue;
        const q = flightLocal(f, p.x, p.z);
        if (q.s < f.railS[0] || q.s > f.railS[1] || Math.abs(q.v) > f.w / 2 + (on.has(f) ? 1 : 0)) continue;
        if (!on.has(f) && (q.s < f.railAt[0] || q.s > f.railAt[1])) continue; // (a way past its first tread: as it was)
        // (within half his band — the planner's own line where it already is: men on one stair keep their spacing — the
        // last point, where he was sent, inside his standing band)
        const b = i === path.length - 1 ? railBand(f, u, true) : railBand(f, u) / 2;
        if (Math.abs(q.v) > b + 1e-3) p = { ...p, ...flightWorld(f, q.s, Math.sign(q.v) * b) };
        break;
      }
    }
    // (a stair link — its men walk its line: on to its start head-on, off its end the same way, lined up out there)
    if (p.link?.walk === 'stairs' && out.length >= 2) {
      const lf = F.ofLink?.(p.link.id);
      const st = out[out.length - 1], prev = out[out.length - 2];
      if (lf && !st.link && !prev.link) {
        const ex = st.x - p.x, ez = st.z - p.z, el = Math.hypot(ex, ez) || 1, ux = ex / el, uz = ez / el;
        // (out along its line from its start: as far as RAIL_APPROACH, nearer when that is no ground there)
        let A = null;
        for (const D of [RAIL_APPROACH, RAIL_APPROACH * 0.7, RAIL_APPROACH * 0.5]) {
          const q = { x: st.x + ux * D, z: st.z + uz * D };
          if (g.walkableAt(q.x, q.z) && Math.abs(g.elevAt(q.x, q.z) - g.elevAt(st.x, st.z)) < 0.4) { A = q; break; }
        }
        const dx = prev.x - st.x, dz = prev.z - st.z, d = Math.hypot(dx, dz);
        const along = (dx * ux + dz * uz), off = Math.abs(dx * uz - dz * ux);
        const lined = along > 0 && off <= 0.1 + 0.27 * along;
        if (!lined && d > 0.3 && A) {
          // (a point already out in front of it moves onto its line — far enough out that his body clears the cheek
          // walls' ends turning in: M12's narrow flights)
          if (along >= railBody(u) + 0.15 && along < RAIL_APPROACH && out.length > 2) out[out.length - 2] = { ...prev, x: st.x + ux * along, z: st.z + uz * along };
          else {
            // (the planner's own corners hugging its foot — in front of the cheek walls' ends — are left out: he goes
            // round to the line-up point instead, M12's narrow flights)
            const B0 = railBody(u), hiO = lf.w / 2 + CHEEK + B0;
            while (out.length > 2) {
              const q = out[out.length - 2];
              if (q.link || q.steer) break;
              const qa = (q.x - st.x) * ux + (q.z - st.z) * uz, qo = Math.abs((q.x - st.x) * uz - (q.z - st.z) * ux);
              if (!(qa < B0 + 0.15 && qa > -0.5 && qo < hiO)) break;
              out.splice(out.length - 2, 1);
            }
            const prev2 = out[out.length - 2];
            out.splice(out.length - 1, 0, A);
            // (from beside its cheek walls: round their end, not across its corner — M20's S_n3 head, its walls' ends
            // standing on the wall walk)
            const C = roundEnd(g, st, ux, uz, lf, u, prev2, A);
            if (C) out.splice(out.length - 2, 0, C);
          }
        }
      }
    }
    if (i > 1 && path[i - 1].link?.walk === 'stairs' && !p.link && !p.steer) {
      // (off a stair link's end: on along its line a little way before he turns)
      const en = out[out.length - 1], st = out[out.length - 2];
      if (en.link && st && !st.link) {
        const ex = en.x - st.x, ez = en.z - st.z, el = Math.hypot(ex, ez) || 1, ux = ex / el, uz = ez / el;
        const dx = p.x - en.x, dz = p.z - en.z, along = dx * ux + dz * uz, off = Math.abs(dx * uz - dz * ux);
        const A = { x: en.x + ux * RAIL_APPROACH, z: en.z + uz * RAIL_APPROACH };
        if (!(along > 0 && off <= 0.1 + 0.27 * along) && g.walkableAt(A.x, A.z) && Math.abs(g.elevAt(A.x, A.z) - (en.y ?? g.elevAt(en.x, en.z))) < 0.4 && i < path.length - 1) {
          out.push(A);
          // (and on to a point beside its cheek walls round their end, not across its corner)
          const C = roundEnd(g, en, ux, uz, F.ofLink?.(path[i - 1].link.id), u, p, A);
          if (C) out.push(C);
        }
      }
    }
    const l = out[out.length - 1];
    if (i < path.length - 1 && !p.link && !l.link && Math.hypot(p.x - l.x, p.z - l.z) <= 0.05) continue;
    out.push(p);
  }
  // (up the stair straight: the planner's cell corners between two points on one flight's run are left out — the line
  // between them is inside its rails, both being inside his band)
  const onF = (q) => { if (q.link || q.steer) return null; for (const f of fl) { const r = flightLocal(f, q.x, q.z); if (r.s >= f.railS[0] && r.s <= f.railS[1] && Math.abs(r.v) <= f.clear) return f; } return null; };
  const fs = out.map(onF), res = [];
  for (let k = 0; k < out.length; k++) {
    if (k > 0 && k < out.length - 1 && fs[k] && fs[k - 1] === fs[k] && fs[k + 1] === fs[k]) continue;
    res.push(k > 0 ? railPoint(u, out[k], k === out.length - 1) : out[k]);
  }
  return res;
}

/** Cheek walls' thickness (m) on a stair link's flight (art/castle-kit.js buildStairFlight: 0.3). */
const CHEEK = 0.3;

/**
 * A man's line between P (beside a stair link's flight, near its end E) and A (out along its line from E): when it
 * cuts the corner of its cheek walls' end — his body over their ends, which stand to E (M20's S_n3 head on the wall
 * walk) — the point to go by first: out past their end as far as his body, level with P. null when the line is clear,
 * or no such point is ground at E's level. (ux, uz): the link's line out of E.
 */
function roundEnd(g, E, ux, uz, f, u, P, A) {
  if (!f || !P || !A) return null;
  const body = railBody(u), lo = f.w / 2 - 0.05 - body, hi = f.w / 2 + CHEEK + body;
  const loc = (q) => { const dx = q.x - E.x, dz = q.z - E.z; return { a: dx * ux + dz * uz, o: dx * uz - dz * ux }; };
  const p = loc(P), q = loc(A);
  if (Math.abs(p.o) < hi && p.a < body) return null; // (already by them: nothing to go round)
  let cut = false;
  for (let t = 0; t <= 1 + 1e-9 && !cut; t += 0.05) {
    const a = p.a + (q.a - p.a) * t, o = Math.abs(p.o + (q.o - p.o) * t);
    cut = a < body && o > lo && o < hi;
  }
  if (!cut) return null;
  const y0 = E.y ?? g.elevAt(E.x, E.z);
  for (const ac of [body + 0.15, RAIL_APPROACH, RAIL_APPROACH + 0.4]) {
    const C = { x: E.x + ux * ac + uz * p.o, z: E.z + uz * ac - ux * p.o };
    if (g.walkableAt(C.x, C.z) && Math.abs(g.elevAt(C.x, C.z) - y0) < 0.4) return C;
  }
  return null;
}

/**
 * A man walking past a stair link's flight (not on it: its men keep to the link's line) at its foot's level: kept off
 * its solid masonry and cheek walls (M20's stone flights) — out to their outer face and his body's width.
 */
function besideLinkFlight(u) {
  const F = u.world?.grid?.flights, y = u.y ?? 0;
  if (!F?.size) return null;
  const wp = u.path?.[u.pathIndex], onLink = wp?.link?.walk === 'stairs' ? wp.link.id : null;
  for (const f of F.near(u.x, u.z, 1.2)) {
    if (!f.link || f.link.id === onLink) continue;
    const q = flightLocal(f, u.x, u.z);
    if (q.s < 0.1 || q.s > f.sTop - 0.1 || y < f.levels[0] - 0.3 || y > lineAt(f, q.s) + 0.3) continue;
    const out = f.w / 2 + CHEEK + railBody(u), av = Math.abs(q.v);
    if (av >= out - 1e-4) continue;
    const dv = (q.v < 0 ? -1 : 1) * out - q.v;
    return { x: -f.uz * dv, z: f.ux * dv };
  }
  return null;
}

/** Is the unit on the run of a flight of stairs (its treads, ± 0.3 m)? */
export function onStairRun(u) {
  const at = unitFlight(u, 0.3);
  return !!at && at.s > at.f.sFoot - 0.3 && at.s < at.f.sTop + 0.3;
}

/**
 * Height of a man walking a walked link (`wp.link.walk`: a stair link's nosing line, a plank's straight line between
 * its ends) at (x, z), or null when the current waypoint is not one.
 */
export function linkWalkY(u, wp) {
  const lk = wp?.link;
  if (!lk?.walk) return null;
  const g = u.world?.grid;
  if (lk.walk === 'stairs') {
    const f = g?.flights?.ofLink(lk.id);
    if (f) return lineAt(f, flightLocal(f, u.x, u.z).s);
  }
  const L = g?.links?.find((l) => l.id === lk.id);
  if (!L) return null;
  const dx = L.b.x - L.a.x, dz = L.b.z - L.a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.min(1, Math.max(0, ((u.x - L.a.x) * dx + (u.z - L.a.z) * dz) / l2)) : 0;
  return L.a.y + (L.b.y - L.a.y) * t;
}

/** Is this waypoint a ladder to climb (a ladder link, not a walked one)? */
export const isLadderLeg = (wp) => wp?.link?.kind === 'ladder' && !wp.link.walk;

/**
 * Is a ladder link climbed as a ladder — steeper than 42° from its foot to its top? A shallower one (a library
 * building's ramp or inside stair the sidecar lists as a "ladder": M3's loading ramp, the brick ruins' stairs) is
 * walked up at the ladder pace, shown walking (art/ladder-climb.js poses only steep ones).
 */
export function steepLadder(link) {
  if (!link?.a || !link.b || link.kind !== 'ladder' || link.walk) return false;
  const H = Math.abs(link.b.y - link.a.y), hd = Math.hypot(link.b.x - link.a.x, link.b.z - link.a.z);
  return H > 0.4 && H >= hd * 0.9;
}

/**
 * Track of a ladder leg from where the unit stands to the waypoint (the link's other end): its foot and top, the
 * facing (horizontal, foot → top; the link's heading when the ladder is plumb), the 3-D length, going up or down.
 * @returns {{wp:object, from:{x,z,y}, to:{x,z,y}, foot:{x,z,y}, top:{x,z,y}, fx:number, fz:number, len:number, up:boolean, s:number, link:object|null}}
 */
export function ladderTrack(u, wp) {
  const g = u.world?.grid, L = g?.links?.find((l) => l.id === wp.link.id) || null;
  const to = { x: wp.x, z: wp.z, y: wp.y ?? 0 };
  // (from the link's other end when the unit stands at it — the path's previous waypoint — else from where he is)
  let from = { x: u.x, z: u.z, y: u.y ?? 0 };
  if (L) {
    const other = Math.hypot(L.a.x - to.x, L.a.z - to.z) < Math.hypot(L.b.x - to.x, L.b.z - to.z) ? L.b : L.a;
    if (Math.hypot(other.x - u.x, other.z - u.z) < 0.6) from = { x: other.x, z: other.z, y: other.y ?? 0 };
  }
  const up = to.y >= from.y, foot = up ? from : to, top = up ? to : from;
  let fx = top.x - foot.x, fz = top.z - foot.z, h = Math.hypot(fx, fz);
  if (h < 0.05) { const a = L?.heading ?? u.heading ?? 0; fx = Math.cos(a); fz = Math.sin(a); h = 1; }
  fx /= h; fz /= h;
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  // (a ladder whose leg takes longer than its length at the ladder pace — mission `ladders[].climbTime`, s: M2's camp
  // ladder over the palisade — that much slower all the way, from wherever on it he starts)
  const full = L ? Math.hypot(L.a.x - L.b.x, (L.a.y ?? 0) - (L.b.y ?? 0), L.a.z - L.b.z) : len;
  const Leff = len * Math.max(1, L?.climbTime > 0 && full > 1e-6 ? (L.climbTime * ladderSpeed(u)) / full : 1);
  return { wp, from, to, foot, top, fx, fz, len, Leff, up, s: 0, link: L };
}

/** Climbing speed on a ladder (m/s along it): §3.2 everyone climbs ladders at CONFIG.abilities.ladderSpeed. */
export const ladderSpeed = (u) => CONFIG.abilities.ladderSpeed * (u.speedMul ?? 1);

/**
 * Does a path (from where the unit stands) run onto a flight of stairs' run (within its width, past its first / before
 * its last half-metre)? A flight he already stands on does not count (he may leave it).
 */
export function pathOnStairs(u, path) {
  const F = u.world?.grid?.flights;
  if (!F?.size || !path?.length) return false;
  const on = (x, z) => {
    for (const f of F.near(x, z, 0)) {
      if (f.link) continue;
      const { s, v } = flightLocal(f, x, z);
      if (Math.abs(v) <= f.w / 2 && s > f.sFoot + 0.3 && s < f.sTop - 0.3) return f;
    }
    return null;
  };
  const here = on(u.x, u.z);
  let ax = u.x, az = u.z;
  for (const p of path) {
    if (p.link) { ax = p.x; az = p.z; continue; }
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - ax, p.z - az) / 0.25));
    for (let q = 1; q <= n; q++) { const f = on(ax + ((p.x - ax) * q) / n, az + ((p.z - az) * q) / n); if (f && f !== here) return true; }
    ax = p.x; az = p.z;
  }
  return false;
}
