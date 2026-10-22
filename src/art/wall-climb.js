/**
 * The Green Beret's wall climbs (rule (e) climb links), view side (user 2026-10-22: "Make sure the ladder climbing
 * looks natural, commando not crossing the ladder / wall"). The sim moves him along placement.climbTrack — up from the
 * link's end in the air in front of the wall (its blocked cells reach out a cell's width past the drawn face), across
 * at the top of the cells (through the points of M2's palisade stakes), down on the far side — while the 'climb' clip
 * (a one-metre mantle) played once and froze. Here each climb link is measured on the built map, both ways, as the
 * faces a man really climbs (rays across the scene's static meshes, art/ladder-frame.js), and every frame the climb's
 * progress is turned into a climb on them, posed by art/ladder-climb.js as a ladder without a ladder: hands and the
 * balls of the feet on holds on the face itself (each hold where the surface really is), the body hanging off it.
 *  - up onto a deck (a wall walk, a ship's deck, the top of a cliff): one face, from the link's end at its foot — he
 *    walks to the face, climbs it, steps onto the deck (over the wall's top and down onto the walk when a palisade
 *    stands over it: the vault) and walks to the link's other end; down from a deck: the same backwards;
 *  - over a wall with a drop on both sides deeper than a vault: up one face onto its top, across, down the other face
 *    (his back to the drop) — two climbs;
 *  - nothing steep to climb (a gully, a slope): no pose (the clip under him walks).
 * The sim is never read back: the time of the climb is the sim's, shared out between its parts by what each takes.
 * @module art/wall-climb
 */
import * as THREE from 'three';
import { finishFrame, castEntry, ladderPoint, ladderDir, local, surfaceNear } from './ladder-frame.js';

/**
 * holdOff: m the hold line (the balls of his feet) stands off the face; sp: m between holds; halfW: m either side of the
 * middle a hand takes the top edge; minRise: m of rise that is a climb; vaultMax: m a deck may lie under the wall's top
 * for a single climb over it (deeper: down the far face).
 */
export const FACE = { holdOff: 0.06, sp: 0.3, halfW: 0.24, minRise: 0.45, vaultMax: 1.7 };
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Which way a climb link is climbed to end `to` ('ab': towards its b end). */
const dirTo = (link, to) => (Math.hypot(to.x - link.b.x, to.z - link.b.z) <= Math.hypot(to.x - link.a.x, to.z - link.a.z) ? 'ab' : 'ba');

/**
 * The drawn face in front of P along u (horizontal unit) from height y0 up to yTop: rays at rows 0.3 m apart, the
 * frontmost of three across each row; a straight line s(v) = b + k·v through them (plumb or leaning). Null: none.
 */
function faceOf(parts, P, y0, ux, uz, yTop, far) {
  const rows = [], d = new THREE.Vector3(ux, 0, uz), o = new THREE.Vector3();
  for (let v = 0.35; v <= Math.max(0.35, yTop - y0 - 0.12) + 1e-6; v += 0.3) {
    let m = null;
    for (const w of [-0.22, 0, 0.22]) {
      const t = castEntry(parts, o.set(P.x + uz * w, y0 + v, P.z - ux * w), d, far);
      if (t != null && (m == null || t < m)) m = t;
    }
    if (m != null) rows.push([v, m]);
  }
  if (rows.length < 2) return rows.length === 1 ? { b: rows[0][1], k: 0, rows } : null;
  const sl = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (rows[j][0] - rows[i][0] > 0.5) sl.push((rows[j][1] - rows[i][1]) / (rows[j][0] - rows[i][0]));
  const k = clamp(median(sl) ?? 0, -0.15, 0.8), b = median(rows.map(([v, s]) => s - k * v));
  return { b, k: Math.abs(k) < 0.04 ? 0 : k, rows };
}

/**
 * How high the face ahead of P along u goes (world y): rows of rays 0.1 m apart up from y0 + 0.25, the frontmost of
 * three across each; the face ends where two rows running find nothing within `far` (null: no face at all). Wires,
 * poles and eaves well over the wall are never reached.
 */
function faceTop(parts, P, y0, ux, uz, far) {
  const d = new THREE.Vector3(ux, 0, uz), o = new THREE.Vector3();
  let last = null, miss = 0;
  for (let v = 0.25; v <= 14; v += 0.1) {
    let hit = false;
    for (const w of [-0.22, 0, 0.22]) if (castEntry(parts, o.set(P.x + uz * w, y0 + v, P.z - ux * w), d, far) != null) { hit = true; break; }
    if (hit) { last = v; miss = 0; } else if (last != null && ++miss >= 2) break;
    else if (last == null && v > 0.8) return null;
  }
  return last == null ? null : y0 + last + 0.05;
}

/**
 * The direction square to a face found ahead along u (faceOf): rays across it at a few heights, the face's line through
 * their hits; null when it is square already (within ~6°) or no line fits.
 */
function squareTo(parts, P, ux, uz, face, yTop) {
  const d = new THREE.Vector3(ux, 0, uz), o = new THREE.Vector3(), sl = [];
  const vs = [0.5, 0.9, 1.3, 1.7].filter((v) => P.y + v < yTop - 0.15);
  for (const v of vs.length ? vs : [0.4]) {
    const pts = [];
    for (let w = -0.45; w <= 0.45 + 1e-6; w += 0.15) {
      const t = castEntry(parts, o.set(P.x + uz * w, P.y + v, P.z - ux * w), d, face.b + 1.5);
      if (t != null && Math.abs(t - (face.b + face.k * v)) < 0.6) pts.push([w, t]);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  }
  const b = median(sl);
  if (b == null || Math.abs(b) < 0.1 || Math.abs(b) > 3) return null;
  const n = Math.hypot(1, b), nw = -b / n, ns = 1 / n, x = ns * ux + nw * uz, z = ns * uz - nw * ux, m = Math.hypot(x, z);
  return { x: x / m, z: z / m };
}

/**
 * A face as a ladder frame (art/ladder-frame.js coordinates) with nothing drawn: the hold line FACE.holdOff in front
 * of it, holds every FACE.sp up to its top (`over`), the deck at the top end's height; per hold, how far the surface
 * there stands in front of (+) or behind (−) the line's face (F.holds, see holdO).
 */
function faceFrame(link, parts, foot, top, ux, uz, face, overY) {
  const H = top.y - foot.y, over = Math.max(H, overY - foot.y);
  const F = { foot: { x: foot.x, y: foot.y, z: foot.z }, top: { x: top.x, y: top.y, z: top.z }, fx: ux, fz: uz, lx: uz, lz: -ux,
    H, hd: Math.hypot(top.x - foot.x, top.z - foot.z), linkId: link.id, s0: face.b - FACE.holdOff, k: face.k, c: 0, rr: 0,
    halfW: FACE.halfW, wall: face.b, over: over > H + 0.25 ? over : H, source: 'face', face: true, build: null,
    topRoom: Infinity, room: Infinity, rooms: null, stileFront: 0 };
  const top1 = Math.max(0.3, F.over - 0.12), rungs = [];
  for (let v = 0.3; v <= top1 + 1e-6; v += FACE.sp) rungs.push(+v.toFixed(4));
  F.rungs = rungs;
  F.railTop = F.over + 0.05; F.railTops = [F.railTop, F.railTop];
  finishFrame(F);
  // a wall over the deck (the palisade over M2's walk): its inner face, where he comes down past it
  F.inner = null;
  if (F.over > F.H + 0.25) {
    const sTop = (top.x - foot.x) * ux + (top.z - foot.z) * uz, sWall = F.s0 + F.k * F.over, back = new THREE.Vector3(-ux, 0, -uz), o = new THREE.Vector3();
    let sIn = null;
    for (const v of [0.35, 0.65, 0.95]) {
      if (F.H + v > F.over - 0.05) continue;
      for (const w of [-0.2, 0, 0.2]) {
        const s1 = Math.max(sTop, sWall) + 1.2;
        const t = castEntry(parts, o.set(foot.x + ux * s1 + uz * w, foot.y + F.H + v, foot.z + uz * s1 - ux * w), back, s1 - sWall + 0.4);
        if (t != null) sIn = Math.max(sIn ?? -Infinity, s1 - t);
      }
    }
    if (sIn != null) { const n = Math.hypot(1, F.k); F.inner = ((F.s0 + F.k * F.H) - sIn) / n; }
  }
  // (the drawn ground at the face's foot and the deck at the top: a ledge, the walk's planks)
  F.footSurf = surfaceNear(parts, F, foot.y, [0.2, 0.55]);
  F.deckSurf = surfaceNear(parts, F, top.y, [Math.max(-0.95, F.topO - 0.2), Math.min(-0.15, F.topO + 0.2)]);
  // the holds: where the face really is at each (a palisade's round stakes, a rock's bulges)
  const n = Math.hypot(1, F.k), dirF = new THREE.Vector3(ux, 0, uz), p = new THREE.Vector3();
  F.holds = new Map();
  const at = (v, w) => {
    const q = ladderPoint(F, v * n, 0.45, w, p), t = castEntry(parts, q, dirF, 0.8);
    if (t == null) return 0;
    const hit = q.clone().addScaledVector(dirF, t), o = local(F, hit).o;
    return clamp(o + FACE.holdOff, -0.1, 0.04);
  };
  for (const v of [...rungs, F.railTop - 0.1]) for (const w of HOLD_W) F.holds.set(holdKey(v, w), at(v, w));
  return F;
}
const HOLD_W = [-0.24, -0.2, -0.12, 0.12, 0.2, 0.24];
const holdKey = (v, w) => `${Math.round(v * 100)}|${Math.round(w * 100)}`;

/**
 * How far (m, along o: + out of the face) a hold at height v (m above the frame's foot), lateral w, stands from the
 * hold line's face — 0 off a face frame or where nothing was measured.
 */
export function holdO(F, v, w) {
  if (!F?.holds) return 0;
  let best = 0, bd = Infinity;
  const vs = Math.round(v * 100);
  for (const hw of HOLD_W) {
    const d = Math.abs(hw - w);
    if (d < bd) { const x = F.holds.get(`${vs}|${Math.round(hw * 100)}`); if (x != null) { bd = d; best = x; } }
  }
  if (bd === Infinity) {
    // (between measured rows: the nearest row)
    let dv = Infinity;
    for (const [k, x] of F.holds) { const [kv, kw] = k.split('|').map(Number); const d = Math.abs(kv - vs) + Math.abs(kw - w * 100) * 0.5; if (d < dv) { dv = d; best = x; } }
  }
  return best;
}

/** Top surface height along the line from P (unit u), d m out: the highest drawn surface across it, or the walk grid's. */
function topAt(parts, grid, P, ux, uz, d, yHi) {
  let t = -Infinity;
  const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
  for (const w of [-0.18, 0, 0.18]) {
    const x = P.x + ux * d + uz * w, z = P.z + uz * d - ux * w;
    const h = castEntry(parts, o.set(x, yHi, z), down, yHi + 2);
    if (h != null) t = Math.max(t, yHi - h);
    if (grid?.walkableAt?.(x, z)) t = Math.max(t, grid.elevAt(x, z));
  }
  return t;
}

/**
 * The plan of one climb link climbed one way: {kind: 'up' | 'down' | 'over' | 'flat', segs: [{F, T, tw}]} — each seg a
 * ladder leg on a face (T: {up, from, to, s, len}), tw its share of the climb's time.
 */
export function planClimb(link, dir, parts, grid) {
  const A = dir === 'ab' ? link.a : link.b, Bq = dir === 'ab' ? link.b : link.a;
  const a = { x: A.x, y: A.y ?? 0, z: A.z }, b = { x: Bq.x, y: Bq.y ?? 0, z: Bq.z };
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.2 || !parts) return { kind: 'flat', segs: [] };
  const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
  // the obstacle's top between the ends (the ends' own ground aside): no higher than its faces go (horizontal rays from
  // either end) — the profile from above saw M1's power line 6.6 m up over a 1.9 m wall
  const tA = faceTop(parts, a, a.y, ux, uz, L + 0.3), tB = faceTop(parts, b, b.y, -ux, -uz, L + 0.3);
  const tFace = Math.max(tA ?? -Infinity, tB ?? -Infinity, a.y, b.y), yHi = tFace + 0.6;
  let H = -Infinity, dH = null;
  for (let d = 0.15; d <= L - 0.15 + 1e-6; d += 0.05) { const t = topAt(parts, grid, a, ux, uz, d, yHi); if (t > H) { H = t; dH = d; } }
  // (the profile from just over the faces' top: a stake's point, a coil of wire on the wall, the walk behind it)
  if (!(H > -Infinity)) H = tFace;
  const rise = H - a.y, drop = H - b.y;
  if (!(rise >= FACE.minRise) && !(drop >= FACE.minRise)) return { kind: 'flat', segs: [] };
  const seg = (foot, top, ux2, uz2, up, overY) => {
    const far = Math.hypot(top.x - foot.x, top.z - foot.z) + 0.6;
    let face = faceOf(parts, foot, foot.y, ux2, uz2, Math.max(top.y, overY), far);
    if (!face || face.b > far - 0.3) return null;
    // square to the face: a link crossing it aslant (M2's, 40° off the palisade) climbs it straight up, not along it
    const sq = squareTo(parts, foot, ux2, uz2, face, Math.max(top.y, overY));
    if (sq) {
      const f2 = faceOf(parts, foot, foot.y, sq.x, sq.z, Math.max(top.y, overY), far + 0.5);
      if (f2 && f2.b <= far + 0.2) { face = f2; ux2 = sq.x; uz2 = sq.z; }
    }
    const F = faceFrame(link, parts, foot, top, ux2, uz2, face, overY);
    const T = { up, from: up ? foot : top, to: up ? top : foot, s: 0, len: 1, face: true };
    // (time: the walks either side, the climb at a rung's move a 0.36 s, a vault)
    const tw = Math.max(0.5, F.footO - 0.5) / 1.25 + Math.max(0.2, F.hd - F.footO) / 1.25 + (F.over / 0.3) * 0.36 + (F.over - F.H > 0.6 ? 1.5 : 0.3);
    return { F, T, tw };
  };
  let segs = [], kind;
  if (rise >= FACE.minRise && drop <= FACE.vaultMax) {
    kind = 'up';
    const s = seg(a, b, ux, uz, true, H);
    if (s) segs = [s];
  } else if (drop >= FACE.minRise && rise <= FACE.vaultMax) {
    kind = 'down';
    const s = seg(b, a, -ux, -uz, false, H);
    if (s) segs = [s];
  } else {
    kind = 'over';
    // (the top: halfway across it, on its surface)
    const fa = faceOf(parts, a, a.y, ux, uz, H, L + 0.3), fb = faceOf(parts, b, b.y, -ux, -uz, H, L + 0.3);
    const d0 = fa ? fa.b : dH, d1 = fb ? L - fb.b : dH, dm = clamp((d0 + d1) / 2, 0.1, L - 0.1);
    const M = { x: a.x + ux * dm, y: Math.max(H, topAt(parts, grid, a, ux, uz, dm, yHi)), z: a.z + uz * dm };
    const s1 = seg(a, M, ux, uz, true, M.y), s2 = seg(b, M, -ux, -uz, false, M.y);
    if (s1 && s2) { s1.F.midTop = s2.F.midTop = true; segs = [s1, s2]; }
  }
  if (!segs.length) return { kind: 'flat', segs: [] };
  return { kind, segs, H };
}

/**
 * Measure every climb link of a built map, both ways (sliced: yields between links). Stores world.climbFrames:
 * Map `${linkId}:${'ab'|'ba'}` → plan.
 * @param {(box: THREE.Box3) => object|null} partsIn the static geometry in a box (ladder-frame collectParts)
 */
export function* fitClimbsG(world, partsIn, due) {
  const plans = new Map();
  for (const L of (world?.grid?.links || []).filter((l) => l.kind === 'climb')) {
    if (due?.()) yield;
    const ys = [L.a.y ?? 0, L.b.y ?? 0];
    const box = new THREE.Box3(new THREE.Vector3(Math.min(L.a.x, L.b.x) - 2.5, Math.min(...ys) - 0.5, Math.min(L.a.z, L.b.z) - 2.5),
      new THREE.Vector3(Math.max(L.a.x, L.b.x) + 2.5, Math.max(...ys) + 9, Math.max(L.a.z, L.b.z) + 2.5));
    let parts = null;
    try { parts = partsIn(box); } catch (e) { console.warn('[wall-climb]', e); }
    for (const dir of ['ab', 'ba']) {
      try { plans.set(`${L.id}:${dir}`, planClimb(L, dir, parts, world.grid)); } catch (e) { console.warn('[wall-climb]', e); plans.set(`${L.id}:${dir}`, { kind: 'flat', segs: [] }); }
    }
  }
  world.climbFrames = plans;
  return plans;
}

/** The plan of the climb a unit is on (u._climb), or null (none measured, nothing steep: the clip plays). */
export function climbPlanOf(u) {
  const C = u?._climb, plans = u?.world?.climbFrames;
  if (!C || !plans?.size) return null;
  const id = C.wp?.link?.id, link = u.world.grid?.links?.find((l) => l.id === id);
  if (!link) return null;
  const P = plans.get(`${id}:${dirTo(link, C.wp)}`);
  return P && P.segs.length ? P : null;
}

/**
 * The ladder leg (on a face) a unit climbing a wall is on now: {F, T} for art/ladder-climb.js — T.s the progress
 * along it from the sim's progress over the climb (C.s of its horizontal length, linear in time) — or null.
 */
export function climbLeg(u) {
  const P = climbPlanOf(u);
  if (!P) return null;
  const C = u._climb, Le = C.Leff ?? C.T?.L, f = Le > 1e-6 ? clamp(C.s / Le, 0, 1) : 1;
  const tot = P.segs.reduce((x, s) => x + s.tw, 0);
  let acc = 0;
  for (let i = 0; i < P.segs.length; i++) {
    const s = P.segs[i], f0 = acc / tot, f1 = (acc + s.tw) / tot;
    acc += s.tw;
    if (f > f1 + 1e-9 && i < P.segs.length - 1) continue;
    const g = clamp((f - f0) / Math.max(1e-6, f1 - f0), 0, 1);
    s.T.s = g * s.T.len;
    return { F: s.F, T: s.T, plan: P };
  }
  return null;
}

export { ladderDir };
