/**
 * Dash compiler for the sneak executors (driver.mjs D.sneak, sneak.mjs sneak). User 2026-10-15, watching the M3
 * walkthrough: "Looking at mission 3 the trajectory of commandos is very zig baggy, making it more straight and
 * decisive. Longer trajectories rather than zig zagging in small trajectories".
 *
 * A planSneak plan is a chain of 1 m cells in eight directions, timed at a pace below the man's own (0.71 m/s for a
 * crawler who crawls 0.9): clicked a few cells at a time at its planned moments, the man zigzagged along the cells and
 * halted a second before every click (M3: 423 sneak orders, a median leg of 1.4 m, 290 halts). compileDash turns it
 * into the fewest straight legs he walks one after the other without a halt, at his real pace, and keeps a halt only
 * where he really has to wait for a gap in the cones:
 *  - a leg runs from where he is to the farthest later cell of the plan (up to the plan's next wait) whose straight way
 *    the game itself walks straight (the path a move order there would get: Unit.planFrom, so it never cuts a corner
 *    or goes over a body the game's own planner would not), whose every point lies on a cell the plan may use (pass:
 *    walkable, out of the keep / avoid / forbid areas, off his mates), and whose every point is unseen at the moment he
 *    is there at his real pace — the plan's own memoised test (`seen`, the same cones at the same predicted moments),
 *    with the plan's margins before and after;
 *  - where the plan waits, he waits (arriving sooner, he waits longer: the cell must stay unseen all that while);
 *  - where even the next cell is not yet clear at his pace (he would be early for a gap), he waits where he is until
 *    the plan's own moment for it — a real wait, and checked like one;
 *  - at the goal: unseen for the plan's hold from when he gets there.
 * Anything it cannot prove unseen returns null: the executor then clicks the plan as before.
 * @module tools/solutions/dash
 */

/** Sample spacing (m) of a leg's safety check. */
export const SAMPLE = 0.25;
/** Plan cells looked past a failing one when stretching a leg (a shortcut that reappears round a stone). */
export const LOOK = 6;
/** Cells per click where the plan is clicked as planned (the executor's old run length). */
export const RUN = 4;

/**
 * @param {Array<[number, number, number]>} plan planSneak's plan ([x, z, absolute time] per cell; repeats = waits),
 *   carrying `plan.ctx` (planSneakGen: seen, pass, cellOf, DT, now, ma, mb, holdK, KS)
 * @param {{speed: number, route: (ax: number, az: number, bx: number, bz: number) => ({x:number,z:number}[]|null),
 *   maxDetour?: number, pad?: number}} o speed: his real pace (m/s); route: the polyline the game walks from a to b (null:
 *   none); pad: also the cells this far (m) round every point of a leg must be unseen (stricter than the plan's own cells)
 * @returns {Generator<void, Array<{x:number, z:number, start:number, end:number, wait?:boolean, until?:number}>|null>}
 *   legs (moves start the moment the one before ends; `wait` legs hold him until `until`), or null
 */
export function* compileDashGen(plan, o) {
  const C = plan?.ctx;
  if (!C || plan.length < 2) return null;
  const { seen, pass, cellOf, DT, now, ma, mb, holdK, KS } = C;
  const v = o.speed, maxDetour = o.maxDetour ?? 1.06, why = o.why || null, pad = o.pad ?? 0;
  const fail = (msg) => { why?.push(msg); return null; };
  if (!(v > 0)) return null;
  const kOf = (t) => Math.round((t - now) / DT);
  const clearCell = (c, k0, k1) => {
    if (c < 0) return false;
    for (let k = Math.max(0, k0); k <= k1; k++) { if (k >= KS) return false; if (seen(c, k)) return false; }
    return true;
  };
  // nodes: the plan's cells in order, each with when the plan gets there (ta) and leaves (td), and its plan index
  const nodes = [];
  for (let q = 0; q < plan.length; q++) {
    const [x, z, t] = plan[q], l = nodes[nodes.length - 1];
    if (l && Math.hypot(l.x - x, l.z - z) < 1e-6) { l.td = t; l.qd = q; } else nodes.push({ x, z, ta: t, td: t, q, qd: q });
  }
  /**
   * The rest of the plan from node i clicked as planned (the executor's old way: runs of up to RUN cells in one
   * direction at their planned moments, the plan's waits), once he is there no later than the plan: he waits there,
   * unseen, until the plan goes on. The legs walked so far stay straight.
   */
  const tail = (i, msg) => {
    const N = nodes[i];
    // (he is there no later than the plan leaves it: he waits there, unseen, until it does, and goes on as planned)
    if (T > N.td + 1e-6) { why?.push(`${msg}; late at node ${i}: plan again from there`); if (!legs.some((l) => !l.wait)) return null; legs.partial = true; return legs; }
    if (!clearCell(cellOf(P.x, P.z), kOf(T) - ma, kOf(N.td))) return fail(`${msg}; seen waiting for the plan at node ${i}`);
    why?.push(`${msg}; the rest as planned from node ${i}/${nodes.length}`);
    if (N.td > T + 1e-6) { const l = legs[legs.length - 1]; if (l?.wait) l.until = N.td; else legs.push({ wait: true, until: N.td, x: P.x, z: P.z }); }
    let a = N.qd;
    while (a < plan.length - 1) {
      const [ax, az, at] = plan[a];
      if (Math.hypot(plan[a + 1][0] - ax, plan[a + 1][1] - az) < 1e-6) {
        let b = a + 1; while (b < plan.length - 1 && Math.hypot(plan[b + 1][0] - ax, plan[b + 1][1] - az) < 1e-6) b++;
        legs.push({ wait: true, until: plan[b][2], x: ax, z: az }); a = b; continue;
      }
      const dx = Math.sign(plan[a + 1][0] - ax), dz = Math.sign(plan[a + 1][1] - az);
      let b = a + 1;
      while (b < plan.length - 1 && b - a < RUN) {
        const [bx, bz] = plan[b], [nx, nz] = plan[b + 1];
        if (Math.hypot(nx - bx, nz - bz) < 1e-6 || Math.sign(nx - bx) !== dx || Math.sign(nz - bz) !== dz) break;
        b++;
      }
      legs.push({ x: plan[b][0], z: plan[b][1], start: at, end: plan[b][2], strict: true });
      a = b;
    }
    return legs;
  };
  // eslint-disable-next-line require-yield
  function* tailGen(i, msg) { return tail(i, msg); }
  const waits = (i) => i > 0 && i < nodes.length - 1 && nodes[i].td - nodes[i].ta > 1e-6;
  /**
   * he walks polyline `pts` from time T: every SAMPLE m on a passable cell, unseen [k - ma, k + mb] (a generator: a
   * long leg's cone tests may hand the frame back every few samples)
   */
  const walkOk = function* (pts, T) {
    let t = T, n0 = 0;
    for (let q = 1; q < pts.length; q++) {
      const a = pts[q - 1], b = pts[q], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / SAMPLE));
      for (let s = q === 1 ? 0 : 1; s <= n; s++) {
        const x = a.x + ((b.x - a.x) * s) / n, z = a.z + ((b.z - a.z) * s) / n, c = cellOf(x, z), k = kOf(t + (L * s) / n / v);
        if (c < 0 || !pass(c) || !clearCell(c, k - ma, k + mb)) return false;
        // (`pad` m: the cells that far round him unseen too — a stricter proof than the plan's own cells, opt-in)
        if (pad > 0) for (const [dx, dz] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad]]) { const c2 = cellOf(x + dx, z + dz); if (c2 >= 0 && c2 !== c && !clearCell(c2, k - ma, k + mb)) return false; }
        if ((++n0 & 7) === 0) yield;
      }
      t += L / v;
    }
    return true;
  };
  const polyLen = (pts) => { let L = 0; for (let q = 1; q < pts.length; q++) L += Math.hypot(pts[q].x - pts[q - 1].x, pts[q].z - pts[q - 1].z); return L; };
  const legs = [];
  let P = { x: nodes[0].x, z: nodes[0].z }, T = nodes[0].ta, i = 0, guard = 0;
  // (legs.partial: the legs end short of the goal — he plans again from where they end)
  legs.partial = false;
  /** hold where he is from T until `until` (unseen all that while), then go on from there */
  const holdTo = (until) => {
    const c = cellOf(P.x, P.z);
    if (!clearCell(c, kOf(T) - ma, kOf(until) + 1)) return false;
    const l = legs[legs.length - 1];
    if (l?.wait) l.until = until; else legs.push({ wait: true, until, x: P.x, z: P.z });
    T = until;
    return true;
  };
  while (i < nodes.length - 1) {
    if (++guard > 4 * nodes.length + 16) return fail('guard');
    if ((i === 0 && nodes[0].td > T + 1e-6) || waits(i)) { if (!holdTo(Math.max(T, nodes[i].td))) return fail(`wait at node ${i}/${nodes.length} (${P.x},${P.z}) seen before ${nodes[i].td.toFixed(2)}`); }
    // the farthest later cell (not past the plan's next wait) he gets to straight and unseen at his pace
    let best = null, miss = 0;
    for (let j = i + 1; j < nodes.length; j++) {
      const N = nodes[j];
      const r = o.route(P.x, P.z, N.x, N.z);
      const direct = Math.hypot(N.x - P.x, N.z - P.z);
      const ok = r && r.length >= 2 && Math.hypot(r[r.length - 1].x - N.x, r[r.length - 1].z - N.z) < 0.35 && polyLen(r) <= direct * maxDetour + 0.05 && (yield* walkOk(r, T));
      if (ok) { best = { j, r }; miss = 0; } else if (++miss > LOOK) break;
      if (waits(j)) break;
      // (each candidate asks the game's planner for its path: the live replay may hand the frame back after any of them,
      // driver PLAN_SLICE_MS — no planning stall)
      yield;
    }
    if (!best) {
      // early for the next gap: wait here until the plan's own moment to go on (or its moment to reach the next cell)
      const d = Math.hypot(nodes[i + 1].x - P.x, nodes[i + 1].z - P.z);
      const at = [nodes[i].td, nodes[i + 1].ta - d / v].filter((t) => t > T + 1e-6).sort((a, b) => a - b)[0];
      if (at == null || !holdTo(at)) return yield* tailGen(i, `no straight way on from node ${i}/${nodes.length} (${P.x},${P.z}) at ${T.toFixed(2)}`);
      continue;
    }
    const end = T + polyLen(best.r) / v, N = nodes[best.j];
    legs.push({ x: N.x, z: N.z, start: T, end, pts: best.r });
    P = { x: N.x, z: N.z }; T = end; i = best.j;
  }
  // at the goal he stays: unseen for the plan's hold from when he gets there
  if (!clearCell(cellOf(P.x, P.z), kOf(T) - ma, kOf(T) + holdK) || (C.goalOk && !C.goalOk(P.x, P.z, T))) return fail(`goal seen within the hold from ${T.toFixed(2)}`);
  return legs;
}

/** compileDashGen run straight through. */
export function compileDash(plan, o) {
  const it = compileDashGen(plan, o);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** The polyline a move order from a to b gives `u` (Unit.planFrom), memoised per (a, b) for one compile. */
export function routeFor(u) {
  const memo = new Map();
  return (ax, az, bx, bz) => {
    const key = `${ax.toFixed(3)},${az.toFixed(3)},${bx.toFixed(3)},${bz.toFixed(3)}`;
    if (memo.has(key)) return memo.get(key);
    let r = null;
    try {
      const p = u.planFrom?.(ax, az, bx, bz);
      if (p && !p.some((q) => q.link)) r = [{ x: ax, z: az }, ...p.slice(1).map((q) => ({ x: q.x, z: q.z }))];
    } catch { r = null; }
    memo.set(key, r);
    return r;
  };
}

/** Legs that walk without a halt: how many stops (waits that are not at the start) a compiled dash has. */
export function dashStops(legs) {
  let n = 0;
  for (let k = 1; k < legs.length; k++) if (legs[k].wait) n++;
  return n;
}
