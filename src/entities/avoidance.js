/**
 * Unit-vs-unit local avoidance (fixed-step, deterministic) — playtest: soldiers must "walk smoother and without
 * crossing each other".
 *
 * A walker never leaves its path: progress is computed on the path *track*, and a sideways *lane* offset is
 * layered on top (Unit._followPath). Because the lane is lateral, the distance walked along the route — a
 * patrol's timing — is unchanged by a dodge. Per tick, for each other man in reach, the closest approach over
 * a short horizon is predicted from both velocities; when it would be under two body radii the walker moves its
 * lane away from him (head-on: both keep right; a stationary man is walked round; two dodgers share the gap).
 * Lower-priority walkers also *wait* for a higher-priority one crossing ahead (route patrols > other enemies >
 * commandos; equal priority: the lower id goes first). A lane that would leave walkable ground (walls, water,
 * vehicles, ledges) is cut back, and a walker that cannot get past a standing man waits, then, after
 * `ghostAfter` s, walks on through them (no doorway or ring deadlock). Dead and downed men are not obstacles.
 */
import { CONFIG } from '../config.js';

/** Tunables (m, s): see CONFIG.units.avoid. */
export const AV = () => CONFIG.units.avoid;

const OFF_STANCES = new Set(['downed', 'swim', 'dive']);
const OFF_STATES = new Set(['dead', 'inVehicle', 'carried', 'jailed', 'hidden']);

/** Is `n` a body `u` has to keep clear of? */
export function blocks(u, n) {
  if (n === u || !n.alive || n.removed || n.faction == null || n.stance == null) return false;
  if (OFF_STANCES.has(n.stance) || OFF_STATES.has(n.state) || n.buried || n.underwater) return false;
  if (Math.abs((n.y || 0) - (u.y || 0)) > 1) return false;
  // whom he is walking up to on purpose: a melee / hand target, the man he carries, his brain's target
  if (u.pendingAbility?.target === n || u.currentActionTarget === n || u.carrying === n || u.brain?.target === n) return false;
  if (n.pendingAbility?.target === u || n.currentActionTarget === u) return false;
  return true;
}

/**
 * Right of way: 4 a patrol walking its route (a squad's leader or a lone walker: never waits, never gives way to
 * a lower rank on the move — his timing is the mission's), 3 squad followers, 2 other enemies, 1 commandos.
 */
export function priority(u) {
  if (u.faction !== 'enemy') return 1;
  if (u.brain?.state !== 'IDLE') return 2;
  const sq = u.squad?.id && u.world?.ai?.squads?.get(u.squad.id);
  if (sq && sq.leader && sq.leader !== u && sq.leader.alive) return 3;
  return u.route ? 4 : 2;
}

/** Numeric tie-break key (ids are numbers in play, strings in some tests). */
// (one comparable kind: a number against a string compares false both ways — a squad from a barracks ('b#0.0.1')
// meeting a placed man (7) had neither give way)
const idKey = (u) => (typeof u.id === 'number' ? 'n' + String(u.id).padStart(10, '0') : 's' + String(u.id ?? u.tag ?? ''));

/** Does `u` give way to `n` (lower right of way; equal: the higher id)? */
export function givesWay(u, n) {
  const a = priority(u), b = priority(n);
  return a < b || (a === b && idKey(u) > idKey(n));
}

/**
 * Plan this tick's avoidance for walker `u` heading along unit vector (fx, fz) at `speed` m/s.
 * @param {number} [back] lateral step (m, + = left) the lane would take back towards the path
 * @returns {{shift: number, wait: boolean, waitFor: object|null, block: object|null, calm: boolean}} shift: wanted lateral lane change
 *   (m, + = left of travel); wait: hold position this tick; block: a standing man in the way (ghost timer);
 *   calm: the lane may drift back towards the path by `back` without closing in on anybody (within clear + hyst)
 */
export function plan(u, fx, fz, speed, back = 0) {
  const A = AV(), w = u.world;
  const out = { shift: 0, wait: false, slow: false, waitFor: null, block: null, calm: true, blockers: [], claim: null, blockAhead: Infinity, queue: null, queueAhead: Infinity, meetN: null, meetT: Infinity };
  if (!w?.entitiesInRadius) return out;
  const lx = -fz, lz = fx; // left of travel
  const vux = fx * speed, vuz = fz * speed;
  const ghosts = u._ghostIds || [];
  const near = w.entitiesInRadius(u.x, u.z, A.look, (n) => blocks(u, n) && !ghosts.includes(n.id));
  let lo = -Infinity, hi = Infinity; // admissible shift interval
  const pu = priority(u);
  // a man about to stop on his goal is also an obstacle standing there (a group forming up: the near-side man
  // must not be walked into as he arrives) — the lane opens before he is there
  // (sent to the same spot as me: whoever is nearer takes it, the other stops beside it — `claim`, Unit._avoidPlan)
  const obs = [], mine = u.path && !u.path[u.path.length - 1].steer ? u.path[u.path.length - 1] : null;
  const myD = mine ? Math.hypot(mine.x - u.x, mine.z - u.z) : Infinity;
  for (const n of near) {
    obs.push({ n, x: n.x, z: n.z, vx: n.vx || 0, vz: n.vz || 0 });
    const g = n.path && n.pathIndex === n.path.length - 1 ? n.path[n.path.length - 1] : null;
    const gd = g ? Math.hypot(g.x - n.x, g.z - n.z) : Infinity;
    if (mine) { // his spot (where he stands, or the goal he is nearer to than I am to mine) on top of my goal
      const s = !n.path ? n : g && !g.steer && (gd < myD - 1e-6 || (Math.abs(gd - myD) <= 1e-6 && idKey(n) < idKey(u))) ? g : null;
      if (s && Math.hypot(s.x - mine.x, s.z - mine.z) < A.clear && (!out.claim || Math.hypot(s.x - u.x, s.z - u.z) < Math.hypot(out.claim.x - u.x, out.claim.z - u.z))) out.claim = { x: s.x, z: s.z, n };
    }
    if (g && !g.steer && priority(n) < 3 && gd < A.arriveLook && !(mine && Math.hypot(g.x - mine.x, g.z - mine.z) < A.clear)) obs.push({ n, x: g.x, z: g.z, vx: 0, vz: 0 });
  }
  for (const o of obs) {
    const n = o.n, px = o.x - u.x, pz = o.z - u.z;
    const nvx = o.vx, nvz = o.vz, nMoving = nvx * nvx + nvz * nvz > A.moving * A.moving;
    const pn = priority(n);
    if (pu === 4 && nMoving && pn < 4) continue; // a patrol on its route leaves it to the other man
    const rvx = nvx - vux, rvz = nvz - vuz, rv2 = rvx * rvx + rvz * rvz;
    // walking the same way (a group move): left alone while clear; inside each other, the man behind (or, abreast,
    // the higher id) drops back and both ease apart sideways, so a huddle strings out instead of jostling
    const sn = nMoving ? Math.hypot(nvx, nvz) : 0, d0 = Math.hypot(px, pz), ahead = px * fx + pz * fz;
    const close = px * rvx + pz * rvz; // < 0: closing in
    const same = nMoving && (rv2 < A.together * A.together || (nvx * fx + nvz * fz) > A.sameWay * sn);
    // overtaking a slower man ahead (or being overtaken): predicted like any other approach, passed on the left
    const overtake = same && rv2 >= A.together * A.together && close < 0 && d0 >= A.clear * 0.75;
    // walking the same way or merging (a file into a doorway): who leads, measured along both men's mean heading
    // (antisymmetric: never both "behind"; abreast, the lower id leads); the man behind closing on him queues —
    // Unit._avoidPlan holds him back when there is no room to walk beside the leader
    let behind = false;
    if (nMoving && (nvx * fx + nvz * fz) > A.crossCos * sn) {
      const mx = fx + nvx / sn, mz = fz + nvz / sn, ml = Math.hypot(mx, mz) || 1, lead = (px * mx + pz * mz) / ml;
      behind = lead > 0.05 || (lead > -0.05 && idKey(n) < idKey(u));
      if (behind && d0 < A.clear + 0.8 && d0 < out.queueAhead) { out.queue = n; out.queueAhead = d0; }
    }
    if (same && !overtake) { // same way, like pace (a group move)
      if (d0 >= A.clear) { // clear of each other: leave them be — but my lane does not drift back into him (a weave)
        if (back && Math.hypot(px - back * lx, pz - back * lz) < A.clear + A.hyst) out.calm = false;
        continue;
      }
      if (ahead > 0.05 || (ahead > -0.05 && idKey(n) < idKey(u))) out.slow = true;
      // shoulder to shoulder inside each other: also ease apart sideways (below, as a current overlap)
    }
    const t = rv2 > 1e-9 ? Math.min(A.horizon, Math.max(0, -close / rv2)) : 0;
    const cx = px + rvx * t, cz = pz + rvz * t;
    const dmin = Math.hypot(cx, cz);
    if (back) { const d2 = Math.hypot(cx - back * lx, cz - back * lz); if (d2 < A.clear + A.hyst && d2 < dmin) out.calm = false; }
    if (dmin >= A.clear) continue;
    // behind me / drawing apart: never fight an overlap backwards — unless we are inside each other and not
    // drawing apart (two men stacked on one spot walk the same way: they would stay stacked)
    if (t === 0 && ahead <= 0 && !(d0 < A.clear && close < 0.3 * Math.max(d0, 1e-3))) continue;
    // he crosses ahead with the right of way → wait for him to pass (crossing, not head-on / same way)
    if (nMoving && ahead > 0 && (pn > pu || (pn === pu && idKey(n) < idKey(u)))) {
      const cos = (nvx * fx + nvz * fz) / sn;
      // where his line crosses mine (s m ahead of me): wait only short of it — if he comes at me where I
      // stand, waiting is walking into him: dodge instead
      const den = fx * nvz - fz * nvx, sAhead = Math.abs(den) > 1e-6 ? (px * nvz - pz * nvx) / den : -1;
      if (Math.abs(cos) < A.crossCos && sAhead > A.clear * 0.5) { out.wait = true; out.waitFor = n; out.blockers.push(n); continue; }
    }
    // a man coming at me (not walking my way): when we would meet in a gap too narrow to pass, Unit._avoidPlan
    // has the man giving way wait where there is room
    if (nMoving && !same && t < out.meetT) { out.meetT = t; out.meetN = n; }
    let side = cx * lx + cz * lz; // his lateral place at closest approach (+ = on my left)
    // a standing man nearly dead ahead: go round him on the side with more room from the other men about (a man
    // stopped on his slot in a formation is not passed on the side where a mate is walking up)
    if (!nMoving && Math.abs(side) < 0.3 * A.clear && obs.length > 1) {
      const room = (sg) => {
        const qx = u.x + fx * ahead + lx * sg * A.clear, qz = u.z + fz * ahead + lz * sg * A.clear, tq = Math.max(0, ahead) / Math.max(0.3, speed);
        let m = Infinity;
        for (const q of obs) if (q.n !== n) m = Math.min(m, Math.hypot(q.x + q.vx * tq - qx, q.z + q.vz * tq - qz));
        return m;
      };
      const rl = room(1), rr = room(-1);
      if (Math.min(rl, rr) < 2 * A.clear && Math.abs(rl - rr) > 0.2) side = (rl > rr ? -1 : 1) * Math.max(Math.abs(side), 2e-3);
    }
    const share = nMoving && blocks(n, u) && !(pn === 4 && pu < 4) ? 0.5 : 1;
    // dead in line: head-on both keep right; walking the same way the overtaker passes on the left and the man
    // overtaken keeps right; stacked on one spot, the lower id steps right, the other left
    let left = false;
    if (Math.abs(side) <= 1e-3 && same) left = d0 < 1e-3 || Math.abs(ahead) < 1e-3 ? idKey(u) > idKey(n) : ahead > 0;
    if (side > 1e-3) hi = Math.min(hi, (side - A.clear) * share);
    else if (side < -1e-3) lo = Math.max(lo, (side + A.clear) * share);
    else if (left) lo = Math.max(lo, A.clear * share);
    else hi = Math.min(hi, -A.clear * share); // dead ahead: keep right
    if (!nMoving) {
      out.block = n;
      out.blockAhead = Math.min(out.blockAhead, ahead);
      if (t < A.brakeT) out.slow = true; // a man stopped just ahead: ease off while the lane opens
    }
    out.blockers.push(n);
  }
  if (lo > hi) { // boxed in on both sides: wait — a patrol on its route takes the smaller dodge instead
    if (pu === 4) { out.shift = Math.abs(lo) < Math.abs(hi) ? lo : hi; out.slow = false; return out; }
    out.wait = true; return out;
  }
  // a patrol's pace is the mission's timing: it dodges only — except round a man standing right in its way (one by
  // its waypoint as it sets off), where it eases off while the lane opens instead of walking into him
  if (pu === 4) { out.wait = false; out.slow = !!out.block && out.blockAhead < A.clear + 0.6; }
  out.shift = lo > 0 ? lo : hi < 0 ? hi : 0;
  if (out.shift === 0) out.block = null;
  return out;
}
