/**
 * Car-like kinematics for land vehicles (user request 2026-10-07, M3 video: "the car seems to cross the mountain when
 * turning around", "the car turning around should look more realistic, it may involve going backwards and forwards to
 * do a full turn"): a wheeled hull never pivots on the spot. It moves along arcs no tighter than its turning radius
 * (`def.turnRadius`, hull centre); when it has to face somewhere it cannot reach with one forward arc it makes a
 * multi-point turn — forward with the wheel locked one way, reverse with the opposite lock, forward again — and a
 * route leg that the straight / pursuit line would scrape along a wall is planned around it. Every pose of the
 * hull's real footprint is checked by the caller's `free` (cliffs, rocks, walls, eaves, other hulls). Tracked hulls
 * get a small radius (one track braked), so they too move while they turn.
 *
 * Pure: no world access. Poses are {x, z, h}; heading h points along (cos h, sin h); curvature k (rad/m) turns the
 * heading by k per metre travelled along the heading (a reversing hull with the same k turns the other way). A plan
 * is a list of legs {dir: 1 forward | -1 reverse, k, len}.
 * @module entities/vehicle-maneuver
 */

/** Pose after travelling signed distance `ds` along heading `h` on curvature `k` (exact arc). */
export function arcStep(x, z, h, ds, k) {
  if (Math.abs(k) < 1e-9) return { x: x + Math.cos(h) * ds, z: z + Math.sin(h) * ds, h };
  const h1 = h + k * ds;
  return { x: x + (Math.sin(h1) - Math.sin(h)) / k, z: z - (Math.cos(h1) - Math.cos(h)) / k, h: wrap(h1) };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Signed heading error from pose `p` to point `t` (rad, (-π, π]). */
export const headingError = (p, t) => wrap(Math.atan2(t.z - p.z, t.x - p.x) - p.h);

/**
 * Curvature that carries a hull at pose `p` onto the arc through point `t` (pure pursuit), and whether that arc is
 * within the turning radius `R` (and ahead of the hull).
 */
export function pursuitCurvature(p, t, R) {
  const d = Math.hypot(t.x - p.x, t.z - p.z);
  if (d < 1e-6) return { k: 0, ok: true };
  const e = headingError(p, t);
  const k = (2 * Math.sin(e)) / d;
  return { k, ok: Math.abs(e) < Math.PI / 2 && Math.abs(k) <= 1 / R + 1e-9 };
}

/**
 * Drive the pursuit line from `p0` toward `t` (curvature re-aimed every `step` m, clamped to the turning radius),
 * checking every pose, until within `reach` of it. @returns {{legs, end, len}|null} null when blocked / it can't close
 */
export function pursuitLegs(p0, t, o) {
  const R = o.R, step = o.step ?? 0.5, reach = o.reach ?? 0.75, legs = [];
  let p = p0, len = 0;
  const maxLen = o.maxLen ?? Math.hypot(t.x - p.x, t.z - p.z) * 1.6 + R * 4;
  while (Math.hypot(t.x - p.x, t.z - p.z) > reach) {
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    const { k: k0 } = pursuitCurvature(p, t, R);
    if (Math.abs(headingError(p, t)) >= Math.PI / 2) return null; // behind: not this way
    const k = Math.max(-1 / R, Math.min(1 / R, k0)), ds = Math.max(0.05, Math.min(step, d - reach * 0.5));
    const q = arcStep(p.x, p.z, p.h, ds, k);
    if (!o.free(q.x, q.z, q.h)) return null;
    const l = legs[legs.length - 1];
    if (l && Math.abs(l.k - k) < 1e-6) l.len += ds; else legs.push({ dir: 1, k, len: ds });
    p = q; len += ds;
    if (len > maxLen) return null; // circling a point inside the turning circle
  }
  return { legs, end: p, len };
}

/**
 * Hybrid-A* over short motion primitives — forward / reverse × full left lock / straight / full right lock — on a
 * 0.5 m × 5° lattice, until `o.goal(pose)` holds. `o.finish(pose)` (tried at the start and every `finishEvery` nodes)
 * may close the plan analytically and returns {legs, end, len} or null. Cost: metres driven (reverse metres weigh
 * `revCost`), each change of gear `gearCost` m — the cheapest plan is the one a driver would pick: as few shunts as
 * the space allows. `o.h(pose)` is the heuristic (weighted by `w`).
 * @returns {{legs:{dir:number,k:number,len:number}[], end:{x:number,z:number,h:number}, cost:number}|null}
 */
export function searchPlan(start, o) {
  const R = o.R, gearCost = o.gearCost ?? 3, revCost = o.revCost ?? 1.5, maxNodes = o.maxNodes ?? 5000;
  const maxRev = o.maxRev ?? 8, W = o.w ?? 1.3, every = o.finishEvery ?? 1;
  const P = Math.min(1, Math.max(0.3, R * 0.35)); // primitive length: ≤ 20° of heading per primitive
  const sub = Math.max(1, Math.ceil(P / 0.35));
  const HB = Math.PI / 36, key = (p, dir) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)},${((Math.round(p.h / HB) % 72) + 72) % 72}${dir < 0 ? 'r' : 'f'}`;
  const heap = [];
  const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j].f <= n.f) break; heap[i] = heap[j]; i = j; } heap[i] = n; };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++; if (heap[c].f >= last.f) break; heap[i] = heap[c]; i = c; }
      heap[i] = last;
    }
    return top;
  };
  const build = (node, tail) => {
    const prims = [...(tail?.legs || [])];
    for (let q = node; q.prim; q = q.par) prims.unshift(q.prim);
    const legs = [];
    for (const m of prims) { const l = legs[legs.length - 1]; if (l && l.dir === m.dir && Math.abs(l.k - m.k) < 1e-9) l.len += m.len; else legs.push({ ...m }); }
    return { legs, end: tail ? tail.end : node.p, cost: node.g + (tail ? tail.len + (node.dir < 0 ? gearCost : 0) : 0) };
  };
  const seen = new Map();
  push({ p: { ...start }, g: 0, f: o.h(start) * W, dir: 0, rev: 0, par: null, prim: null });
  let n = 0;
  while (heap.length && n < maxNodes) {
    const node = pop();
    const kk = key(node.p, node.dir);
    if (seen.has(kk) && seen.get(kk) <= node.g + 1e-9) continue;
    seen.set(kk, node.g);
    n++;
    if (node.prim && o.goal(node.p, node.dir)) return build(node, null);
    if (o.finish && (n === 1 || n % every === 0)) { const fin = o.finish(node.p); if (fin) return build(node, fin); }
    for (const dir of [1, -1]) {
      if (dir < 0 && node.rev + P > maxRev + 1e-9) continue;
      for (const st of [-1, 0, 1]) {
        const k = st / R;
        let q = node.p, ok = true;
        for (let i = 1; i <= sub && ok; i++) { q = arcStep(q.x, q.z, q.h, (dir * P) / sub, k); ok = o.free(q.x, q.z, q.h); }
        if (!ok) continue;
        const g = node.g + P * (dir < 0 ? revCost : 1) + (node.dir && node.dir !== dir ? gearCost : 0) + (node.dir === 0 && dir < 0 ? gearCost * 0.5 : 0);
        push({ p: q, g, f: g + o.h(q) * W, dir, rev: dir < 0 ? (node.dir < 0 ? node.rev + P : P) : 0, par: node, prim: { dir, k, len: P } });
      }
    }
  }
  return null;
}

/**
 * Plan a multi-point turn from `start` until `o.goal(pose)` holds (typically: facing `o.target` with a clear straight
 * line to it). Every node tries to finish with one forward arc, the wheel locked toward the target, stopping as soon
 * as the goal holds — so the plan ends exactly aligned.
 * @param {{x:number,z:number,h:number}} start
 * @param {{R:number, free:(x:number,z:number,h:number)=>boolean, goal:(p:object)=>boolean, target:{x:number,z:number},
 *   maxNodes?:number, maxFwd?:number, step?:number, gearCost?:number, revCost?:number, tol?:number, maxRev?:number}} o
 * @returns {{legs:{dir:number,k:number,len:number}[], end:{x:number,z:number,h:number}, cost:number}|null}
 */
export function planManeuver(start, o) {
  const R = o.R, step = o.step ?? 0.25, tol = o.tol ?? 0.05, T = o.target;
  const maxFwd = o.maxFwd ?? Math.PI * R + 2;
  if (o.goal(start)) return { legs: [], end: { ...start }, cost: 0 };
  /** One forward arc, wheel locked toward the target, until the goal holds (or it is blocked / swings past). */
  const finish = (p0) => {
    if (Math.abs(headingError(p0, T)) > Math.PI * 0.75) return null;
    const e0 = headingError(p0, T), s = Math.sign(e0) || 1, k = s / R;
    let p = p0, len = 0, best = Math.abs(e0);
    while (len < maxFwd) {
      const e = Math.abs(headingError(p, T));
      const ds = Math.min(step, Math.max(0.03, e * R * 0.8));
      const q = arcStep(p.x, p.z, p.h, ds, k);
      if (!o.free(q.x, q.z, q.h)) return null;
      p = q; len += ds;
      if (o.goal(p)) return { legs: [{ dir: 1, k, len }], end: p, len };
      const e1 = headingError(p, T), a1 = Math.abs(e1);
      if (Math.sign(e1) !== s && a1 > tol) return null; // swung past without a clear line
      if (a1 > best + 0.03 && len > 0.5) return null; // the target fell inside the turning circle
      best = Math.min(best, a1);
    }
    return null;
  };
  return searchPlan(start, { ...o, goal: () => false, finish, h: (p) => Math.max(0, Math.abs(headingError(p, T)) - tol) * R });
}

/**
 * Plan a route leg from `start` to within `o.reach` of `o.target`: the pursuit line when it is clear, else a lattice
 * search around what is in the way (finishing on the pursuit line as soon as that is clear).
 * @returns {{legs, end, cost}|null}
 */
export function planReach(start, o) {
  const T = o.target, reach = o.reach ?? 0.75;
  const direct = pursuitLegs(start, T, o);
  if (direct) return { legs: direct.legs, end: direct.end, cost: direct.len };
  return searchPlan(start, {
    ...o, finishEvery: o.finishEvery ?? 8,
    goal: (p, dir) => dir > 0 && Math.hypot(T.x - p.x, T.z - p.z) <= reach, // arriving forward
    finish: (p) => pursuitLegs(p, T, o),
    h: (p) => Math.max(0, Math.hypot(T.x - p.x, T.z - p.z) - reach),
    w: o.w ?? 1.6,
  });
}
