/**
 * Straightness metrics of commando trails (a solution run recorded by trail-rec.mjs / trail.mjs, or any polyline).
 * Pure functions, no engine. User 2026-10-15, watching the M3 walkthrough: "Looking at mission 3 the trajectory of
 * commandos is very zig baggy, making it more straight and decisive. Longer trajectories rather than zig zagging in
 * small trajectories".
 *
 *  - a walked trail is resampled every RES m of arc and simplified (Douglas–Peucker, EPS m): its vertices are where
 *    the man changes direction;
 *  - a TURN is a cluster of vertices within CLUSTER m of arc whose summed change of direction is ≥ TURN_DEG (a corner
 *    rounded over a few samples counts once; a slow drift under TURN_DEG is no turn);
 *  - a LEG is the stretch walked between two turns (or a turn and the end of a stretch on foot): its length;
 *  - per ORDER (a move order): the distance he walks until his next order, over the straight line from where he was
 *    to where he got;
 *  - wobble: the mean |change of heading| per metre along the legs (between turns), from 0.25 m chords;
 *  - a PAUSE: a stop on foot of under PAUSE_MAX s between two stretches of walking, no action under way.
 * @module tools/solutions/trail-metrics
 */

export const RES = 0.1;
export const EPS = 0.12;
export const TURN_DEG = 20;
export const CLUSTER = 1.0;
export const PAUSE_MAX = 3;

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Resample a polyline [{x, z, i}] every `res` m of arc (stationary points dropped); keeps the source index `i`. */
export function resample(pts, res = RES) {
  if (pts.length < 2) return pts.slice();
  const out = [{ ...pts[0], s: 0 }];
  let s = 0, carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    let d = res - carry;
    while (d <= L + 1e-9) {
      const t = d / L;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, i: t < 0.5 ? a.i : b.i, s: s + d });
      d += res;
    }
    carry = L - (d - res);
    s += L;
  }
  const last = pts[pts.length - 1], lo = out[out.length - 1];
  if (Math.hypot(last.x - lo.x, last.z - lo.z) > 1e-6) out.push({ ...last, s });
  return out;
}

/** Douglas–Peucker: indices of the kept points of `pts` (iterative). */
export function simplify(pts, eps = EPS) {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b], dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
    let best = -1, bd = eps;
    for (let k = a + 1; k < b; k++) {
      const P = pts[k];
      const d = L > 1e-9 ? Math.abs((P.x - A.x) * dz - (P.z - A.z) * dx) / L : Math.hypot(P.x - A.x, P.z - A.z);
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * Turns and legs of one continuous stretch on foot.
 * @param {{x:number, z:number, i?:number}[]} pts the raw positions (ticks)
 * @returns {{length:number, turns:{s:number, x:number, z:number, deg:number, i:number}[], legs:number[], jitter:number, straightLen:number}}
 */
export function analyseStretch(pts, { res = RES, eps = EPS, turnDeg = TURN_DEG, cluster = CLUSTER } = {}) {
  const r = resample(pts, res);
  const length = r.length ? r[r.length - 1].s : 0;
  if (r.length < 3) return { length, turns: [], legs: length > 0 ? [length] : [], jitter: 0, straightLen: length };
  const keep = simplify(r, eps), V = keep.map((k) => r[k]);
  // change of direction at each inner vertex
  const ang = [];
  for (let k = 1; k + 1 < V.length; k++) {
    const h0 = Math.atan2(V[k].z - V[k - 1].z, V[k].x - V[k - 1].x), h1 = Math.atan2(V[k + 1].z - V[k].z, V[k + 1].x - V[k].x);
    ang.push({ v: V[k], a: wrap(h1 - h0) });
  }
  // clusters within `cluster` m of arc: one turn each when their summed change is ≥ turnDeg
  const turns = [];
  for (let k = 0; k < ang.length;) {
    let j = k, sum = ang[k].a, absSum = Math.abs(ang[k].a);
    while (j + 1 < ang.length && ang[j + 1].v.s - ang[j].v.s <= cluster) { j++; sum += ang[j].a; absSum += Math.abs(ang[j].a); }
    // a zig and its zag inside one cluster (sum ~0, |sum| large) is two turns, not none
    const deg = (Math.abs(sum) * 180) / Math.PI, zz = (absSum * 180) / Math.PI;
    const mid = ang[(k + j) >> 1].v;
    if (deg >= turnDeg) turns.push({ s: mid.s, x: mid.x, z: mid.z, deg, i: mid.i });
    else if (zz >= 2 * turnDeg) { turns.push({ s: ang[k].v.s, x: ang[k].v.x, z: ang[k].v.z, deg: zz / 2, i: ang[k].v.i }); turns.push({ s: ang[j].v.s, x: ang[j].v.x, z: ang[j].v.z, deg: zz / 2, i: ang[j].v.i }); }
    k = j + 1;
  }
  const legs = [];
  let s0 = 0;
  for (const t of turns) { legs.push(t.s - s0); s0 = t.s; }
  legs.push(length - s0);
  // wobble: |Δheading| per metre over 0.25 m chords, away from the turns (±cluster/2)
  const step = Math.max(1, Math.round(0.25 / res));
  let jit = 0, jl = 0;
  const nearTurn = (s) => turns.some((t) => Math.abs(t.s - s) <= cluster / 2 + 0.25);
  let hPrev = null;
  for (let k = step; k < r.length; k += step) {
    const h = Math.atan2(r[k].z - r[k - step].z, r[k].x - r[k - step].x);
    if (hPrev != null && !nearTurn(r[k].s)) { jit += Math.abs(wrap(h - hPrev)); jl += r[k].s - r[k - step].s; }
    hPrev = h;
  }
  return { length, turns, legs: legs.filter((l) => l > 1e-6), jitter: jl > 0 ? (jit * 180) / Math.PI / jl : 0, straightLen: jl };
}

const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; };
const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);

/**
 * Metrics of a decoded trail (trail-rec decodeTrail). Units on foot only (in a vehicle, dead: left out).
 * @param {object} tr decoded trail
 * @param {{from?: number, to?: number, roles?: string[]}} [o] a time window (s) and the commandos to count
 */
export function measureTrail(tr, o = {}) {
  const { n, len, t, x, z, f } = tr;
  const from = o.from ?? -Infinity, to = o.to ?? Infinity;
  const VEH = 2, DEAD = 128, ACTION = 16, PATH = 1;
  const per = [];
  const allTurns = [];
  const allLegs = [];
  let walked = 0, jitW = 0, jitL = 0, pauses = 0, pauseT = 0;
  for (let u = 0; u < n; u++) {
    if (o.roles && !o.roles.includes(tr.roles[u])) continue;
    const stretches = [];
    let cur = null;
    for (let k = 0; k < len; k++) {
      const q = k * n + u, fl = f[q], tt = t[k];
      const ok = tt >= from && tt <= to && !(fl & (VEH | DEAD));
      const jump = cur && cur.length && Math.hypot(x[q] - cur[cur.length - 1].x, z[q] - cur[cur.length - 1].z) > 0.75;
      if (!ok || jump) { if (cur && cur.length > 1) stretches.push(cur); cur = null; if (!ok) continue; }
      (cur ||= []).push({ x: x[q], z: z[q], i: k });
    }
    if (cur && cur.length > 1) stretches.push(cur);
    let uw = 0;
    const uTurns = [], uLegs = [];
    for (const S of stretches) {
      const A = analyseStretch(S);
      uw += A.length;
      for (const tn of A.turns) uTurns.push({ ...tn, u, t: t[tn.i] });
      uLegs.push(...A.legs);
      jitW += A.jitter * A.straightLen; jitL += A.straightLen;
    }
    // pauses: on foot, stopped (no path, or crawling on the spot) < PAUSE_MAX s between two stretches of walking
    let moving = false, stopT = null, act = false;
    for (let k = 1; k < len; k++) {
      const q = k * n + u, fl = f[q], tt = t[k];
      if (tt < from || tt > to || (fl & (VEH | DEAD))) { moving = false; stopT = null; continue; }
      const v = Math.hypot(x[q] - x[q - n], z[q] - z[q - n]) / Math.max(1e-6, t[k] - t[k - 1]);
      const mv = v > 0.05;
      if (fl & ACTION) act = true;
      if (moving && !mv) { stopT = tt; act = !!(fl & ACTION); }
      else if (!moving && mv && stopT != null) {
        const d = tt - stopT;
        if (d <= PAUSE_MAX && !act && (fl & PATH)) { pauses++; pauseT += d; }
        stopT = null;
      }
      moving = mv;
    }
    per.push({ role: tr.roles[u], walked: +uw.toFixed(1), turns: uTurns.length, turnsPer10m: uw > 0 ? +(uTurns.length / uw * 10).toFixed(2) : 0, meanLeg: +mean(uLegs).toFixed(2), medianLeg: +median(uLegs).toFixed(2) });
    walked += uw; allTurns.push(...uTurns); allLegs.push(...uLegs);
  }
  // per order: walked / straight from the order to his next order
  const ratios = [], ordLegs = [];
  const moves = (tr.orders || []).filter((q) => q.type === 'move' && q.t >= from && q.t <= to && (!o.roles || o.roles.includes(q.role)));
  const idxAt = (tt) => { let lo = 0, hi = len - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < tt) lo = m + 1; else hi = m; } return lo; };
  for (const q of moves) {
    const next = (tr.orders || []).find((r) => r.u === q.u && r.t > q.t + 1e-6);
    const k0 = idxAt(q.t), k1 = idxAt(next ? next.t : Math.min(to, t[len - 1]));
    let L = 0, veh = false;
    for (let k = k0 + 1; k <= k1; k++) { const a = (k - 1) * n + q.u, b = k * n + q.u; if (f[b] & VEH) veh = true; L += Math.hypot(x[b] - x[a], z[b] - z[a]); }
    if (veh) continue;
    const a = k0 * n + q.u, b = k1 * n + q.u, S = Math.hypot(x[b] - x[a], z[b] - z[a]);
    ordLegs.push(L);
    if (S > 0.5) ratios.push(L / S);
  }
  const span = Math.max(1e-6, Math.min(to, t[len - 1]) - Math.max(from, t[0]));
  return {
    walked: +walked.toFixed(1), turns: allTurns.length, turnsPer10m: walked > 0 ? +(allTurns.length / walked * 10).toFixed(2) : 0,
    meanLeg: +mean(allLegs).toFixed(2), medianLeg: +median(allLegs).toFixed(2), legs: allLegs.length,
    jitterDegPerM: jitL > 0 ? +(jitW / jitL).toFixed(2) : 0,
    moveOrders: moves.length, ordersPerMin: +(moves.length / (span / 60)).toFixed(2), metresPerOrder: moves.length ? +(walked / moves.length).toFixed(2) : 0,
    orderRatioMean: +mean(ratios).toFixed(3), orderRatioMedian: +median(ratios).toFixed(3), orderRatioOver1_1: ratios.filter((r) => r > 1.1).length, orderRatioN: ratios.length,
    pauses, pausesPer100m: walked > 0 ? +(pauses / walked * 100).toFixed(2) : 0, pauseSec: +pauseT.toFixed(1),
    span: +span.toFixed(1), per, turnList: allTurns,
  };
}

/**
 * Where each turn comes from: an ORDER boundary (a new move order given within `near` m of arc / 0.5 s of it), a
 * CORNER of the path the game planned (a waypoint of the active path within `near` m where it bends ≥ TURN_DEG), a
 * game RE-PATH (a path the game itself replaced within 0.5 s), else STEERING (avoidance, curves, wobble).
 */
export function attributeTurns(tr, turns, { near = 0.6 } = {}) {
  const byU = new Map();
  for (const p of tr.paths || []) { if (!byU.has(p.u)) byU.set(p.u, []); byU.get(p.u).push(p); }
  const ordersU = new Map();
  for (const q of tr.orders || []) if (q.type === 'move') { if (!ordersU.has(q.u)) ordersU.set(q.u, []); ordersU.get(q.u).push(q); }
  const out = { order: 0, corner: 0, repath: 0, steer: 0 };
  const tagged = [];
  // (did he stay within 0.3 m of the turn from it until time t?)
  const idxAt = (tt) => { let lo = 0, hi = tr.len - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m] < tt) lo = m + 1; else hi = m; } return lo; };
  const stillUntil = (tn, t1) => {
    const k0 = idxAt(tn.t), k1 = idxAt(t1);
    for (let k = k0; k <= k1; k += 6) { const q = k * tr.n + tn.u; if (Math.hypot(tr.x[q] - tn.x, tr.z[q] - tn.z) > 0.3 + 0.6) return false; }
    return true;
  };
  for (const tn of turns) {
    const P = byU.get(tn.u) || [], Q = ordersU.get(tn.u) || [];
    let cls = null;
    // the order boundary: he turns where a new order sets him off (driver)
    // (also an order that set him off again later from where he had stopped on the turn)
    for (const q of Q) if ((Math.abs(q.t - tn.t) < 1.5 || q.t > tn.t) && Math.hypot(q.at[0] - tn.x, q.at[1] - tn.z) <= near + 0.3 && (q.t - tn.t < 1.5 || stillUntil(tn, q.t))) { cls = 'order'; break; }
    if (!cls) {
      // active path at the turn: the last path given before it
      let act = null;
      for (const p of P) { if (p.t <= tn.t + 1e-6) act = p; else break; }
      if (act && act.cause === 'game' && tn.t - act.t < 0.75) cls = 'repath';
      else if (act) {
        const pts = [act.from, ...act.pts.map((q) => [q[0], q[1]])];
        for (let k = 1; k + 1 < pts.length && !cls; k++) {
          const [ax, az] = pts[k - 1], [bx, bz] = pts[k], [cx, cz] = pts[k + 1];
          if (Math.hypot(bx - tn.x, bz - tn.z) > near + 0.4) continue;
          const d = Math.abs(wrap(Math.atan2(cz - bz, cx - bx) - Math.atan2(bz - az, bx - ax))) * 180 / Math.PI;
          if (d >= TURN_DEG * 0.75) cls = 'corner';
        }
      }
    }
    cls ||= 'steer';
    out[cls]++;
    tagged.push({ ...tn, cls });
  }
  return { counts: out, tagged };
}

/** Corners per 10 m of the paths the game planned (all, or `cause` 'order' / 'game'), and their mean leg. */
export function plannedPathStats(tr, { cause = null, from = -Infinity, to = Infinity } = {}) {
  let L = 0, corners = 0, legs = 0, nPaths = 0;
  for (const p of tr.paths || []) {
    if ((cause && p.cause !== cause) || p.t < from || p.t > to || p.steer) continue;
    const pts = [p.from, ...p.pts.map((q) => [q[0], q[1]])];
    nPaths++;
    let pl = 0;
    for (let k = 1; k < pts.length; k++) {
      const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      pl += l;
      if (l > 1e-6) legs++;
    }
    for (let k = 1; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k], [cx, cz] = pts[k + 1];
      if (Math.hypot(bx - ax, bz - az) < 1e-6 || Math.hypot(cx - bx, cz - bz) < 1e-6) continue;
      const d = Math.abs(wrap(Math.atan2(cz - bz, cx - bx) - Math.atan2(bz - az, bx - ax))) * 180 / Math.PI;
      if (d >= TURN_DEG) corners++;
    }
    L += pl;
  }
  return { paths: nPaths, length: +L.toFixed(1), corners, cornersPer10m: L > 0 ? +(corners / L * 10).toFixed(2) : 0, meanLeg: legs ? +(L / legs).toFixed(2) : 0 };
}
