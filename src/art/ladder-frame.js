/**
 * Ladder frames, view side (user feedback 2026-10-08: "Commando still too close to vertical ladder when climbing"). A
 * climbed ladder link (world/grid LINK.LADDER, not walked) only knows its two ends — where a man stands at its foot
 * and where he stands on top — not where the ladder is drawn: the line between them runs anywhere between the rungs
 * and the wall. The frame is measured once per ladder on the built map (rays across the scene's static meshes,
 * three-mesh-bvh): the drawn ladder's rung line (its plane, its lean), its rungs (heights, thickness), its rails
 * (lateral positions, how high they go), the wall behind it, and the deck where the climber gets off (what stands
 * between the ladder and the top end: a parapet, a palisade's stakes). Where nothing is drawn — a link climbing a
 * bare wall, a balcony, a tank's side, a raised camp ladder — or a drawn ladder stops short of the ground, a ladder
 * is built (timber stiles and rungs every 0.3 m, rung line 0.16 m off the wall face) so the climber's hands and feet
 * always hold something real; a raised ladder (link disabled) is drawn only once lowered.
 *
 * Frame coordinates (ladderPoint): `l` along the ladder from its foot level (the climb direction: up for a plumb
 * ladder, up the lean otherwise), `o` out of the rung line towards the climber (perpendicular to the ladder), `w`
 * lateral (his left +). Distances are from the rung centres' line.
 * The sim never reads this (it climbs the link's straight line: entities/stair-walk.js ladderTrack); art/ladder-climb
 * poses the body on the frame.
 * @module art/ladder-frame
 */
import * as THREE from 'three';
import { MeshBVH } from '../../vendor/three-mesh-bvh/index.module.js';
import { Geo } from './castle-kit.js';
import { steepLadder } from '../entities/stair-walk.js';
import { due, runSync } from '../engine/slice.js';

/**
 * Tuning. lat / latMax: lateral ray spacing and reach (m); dv: ray row spacing (m); fine: rung scan step (m); behind:
 * how far behind the foot end the rays start (m); standoff: built ladder's rung line off the wall face (m); halfW:
 * built ladder's half width between stile centres (m); rungSp: built rung spacing (m); rungR: built rung radius (m);
 * stile: built stile section (m); above: how far a built ladder's stiles run past the top (m); minRungs: rungs a
 * drawn ladder needs to count as one.
 */
export const FRAME = { lat: 0.04, latMax: 0.6, dv: 0.05, fine: 0.012, behind: 1.2, standoff: 0.16, halfW: 0.23, rungSp: 0.3, rungR: 0.022,
  stile: 0.055, above: 0.9, minRungs: 4 };

const UP = new THREE.Vector3(0, 1, 0);
const SKIP = /^(terrain|grass|scrub|veg|clutter|vfx|water|apron|sky|shadow|snowfall|rain|__)/i;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

// ------------------------------------------------------------------ geometry access (rays against static meshes)

/**
 * The static geometry around a ladder as one world-space BVH: every triangle of the scene's static meshes (units,
 * vegetation, terrain and effects left out; the finest level of detail) that meets `box`, copied (the game's geometry
 * is never touched; quantized / interleaved attributes decoded). Null when there is none.
 */
function collectParts(scene, box, skipRoots) {
  const pos = [], m = new THREE.Matrix4(), M = new THREE.Matrix4(), b = new THREE.Box3(), inv = new THREE.Matrix4(), lb = new THREE.Box3();
  const a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), tb = new THREE.Box3();
  const take = (o, W) => {
    const geo = o.geometry, P = geo.attributes.position, I = geo.index;
    b.copy(geo.boundingBox).applyMatrix4(W);
    if (!b.intersectsBox(box)) return;
    lb.copy(box).applyMatrix4(inv.copy(W).invert()); // (the box in the mesh's space: a cheap pre-test per triangle)
    const n = I ? I.count : P.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = I ? I.getX(t) : t, i1 = I ? I.getX(t + 1) : t + 1, i2 = I ? I.getX(t + 2) : t + 2;
      a.fromBufferAttribute(P, i0); c.fromBufferAttribute(P, i1); d.fromBufferAttribute(P, i2);
      tb.makeEmpty(); tb.expandByPoint(a); tb.expandByPoint(c); tb.expandByPoint(d);
      if (!tb.intersectsBox(lb)) continue;
      a.applyMatrix4(W); c.applyMatrix4(W); d.applyMatrix4(W);
      pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
  };
  const visit = (o) => {
    if (skipRoots.has(o) || SKIP.test(o.name || '')) return;
    if (/^lod[12]$/.test(o.name)) return; // (the finest level of detail only, whichever the camera shows now)
    if (o.visible === false && o.name !== 'lod0') return;
    if ((o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh && !o.isBatchedMesh && o.geometry?.attributes?.position) {
      const mats = [].concat(o.material || []);
      if (mats.some((x) => x && x.visible !== false && !(x.transparent && x.opacity < 0.2))) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); take(o, M.multiplyMatrices(o.matrixWorld, m)); }
        else take(o, o.matrixWorld);
      }
    }
    for (const ch of o.children) visit(ch);
  };
  visit(scene);
  if (pos.length < 9) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return new MeshBVH(g, { maxLeafSize: 8 });
}

const _ray = new THREE.Ray();
/** Distance to the first surface (either face) along a world ray, or null. */
function castFirst(bvh, o, d, far) {
  if (!bvh) return null;
  _ray.set(o, d);
  const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
  return hit ? hit.distance : null;
}

// ------------------------------------------------------------------ the frame

/** The ends of a ladder link: foot (lower), top, the climber's facing and lateral axis, height, run. */
export function linkAxes(link) {
  const [foot, top] = link.a.y <= link.b.y ? [link.a, link.b] : [link.b, link.a];
  const H = top.y - foot.y, hd = Math.hypot(top.x - foot.x, top.z - foot.z);
  let fx, fz;
  if (hd >= 0.05) { fx = (top.x - foot.x) / hd; fz = (top.z - foot.z) / hd; } else { const a = link.heading ?? 0; fx = Math.cos(a); fz = Math.sin(a); }
  return { foot, top, H, hd, fx, fz, lx: fz, lz: -fx };
}

/**
 * A frame from the link alone (no scene: headless runs, a ladder not measured yet): a plumb ladder halfway between its
 * ends, rungs every 0.3 m, the deck at the top end's height.
 */
export function syntheticFrame(link) {
  const A = linkAxes(link);
  const s0 = A.hd >= 0.5 ? clamp(A.hd * 0.5, 0.3, A.hd - 0.25) : 0.3;
  return finish({ ...A, linkId: link.id, s0, k: 0, c: 0, rungs: rungList(0.3, A.H - 0.1), rr: FRAME.rungR, halfW: FRAME.halfW,
    railTop: A.H + FRAME.above, wall: null, over: A.H, source: 'link', build: null });
}

/** Rung heights from v0 up to v1 every FRAME.rungSp (m above the foot). */
function rungList(v0, v1, sp = FRAME.rungSp) { const r = []; for (let v = v0; v <= v1 + 1e-6; v += sp) r.push(+v.toFixed(4)); return r; }

/** Derived values: along-ladder axis, outward axis, the stand points of both ends in frame coordinates. */
function finish(F) {
  const k = F.k, n = Math.hypot(1, k);
  F.ax = { f: k / n, y: 1 / n };            // along the ladder (in the side plane: f component, up component)
  F.ox = { f: -1 / n, y: k / n };           // out of it, towards the climber
  F.len = F.H * n;                          // along-ladder length foot level → top level
  // rung heights → along-ladder positions
  F.rl = F.rungs.map((v) => v * n);
  const foot = local(F, F.foot), top = local(F, F.top);
  F.footO = foot.o; F.topO = top.o; F.topL = top.l;
  return F;
}

/** Frame coordinates (l along, o out, w lateral) of a world point. */
export function local(F, p) {
  const ds = (p.x - F.foot.x) * F.fx + (p.z - F.foot.z) * F.fz - F.s0, dv = (p.y ?? F.foot.y) - F.foot.y;
  const w = (p.x - F.foot.x) * F.lx + (p.z - F.foot.z) * F.lz - F.c;
  return { l: ds * F.ax.f + dv * F.ax.y, o: ds * F.ox.f + dv * F.ox.y, w };
}

/** The least room in front of a ladder's rungs between heights v0 and v1 (m above its foot; Infinity: none measured). */
export function roomAt(F, v0, v1) {
  const R = F.rooms;
  if (!R?.length) return F.room ?? Infinity;
  let m = Infinity;
  for (let i = Math.max(0, Math.floor((v0 - 0.4) / 0.02)); i <= Math.min(R.length - 1, Math.ceil((v1 - 0.4) / 0.02)); i++) m = Math.min(m, R[i]);
  return m;
}

/**
 * How far out of the ladder a point is (m): out of the rung line — above the ladder's top, out of the plumb line up
 * from its top (a leaning ladder's line runs on into the wall over it).
 */
export function outOf(F, p) {
  const L = local(F, p), vTop = Math.max(F.over ?? F.H, F.H), v = p.y - F.foot.y;
  if (v <= vTop) return L.o;
  const sP = (p.x - F.foot.x) * F.fx + (p.z - F.foot.z) * F.fz, sTop = F.s0 + F.k * vTop;
  return Math.min(L.o, sTop - sP);
}

/** World point at frame coordinates (l along, o out, w lateral). */
export function ladderPoint(F, l, o, w = 0, out = new THREE.Vector3()) {
  const s = F.s0 + l * F.ax.f + o * F.ox.f, v = l * F.ax.y + o * F.ox.y;
  return out.set(F.foot.x + F.fx * s + F.lx * (w + F.c), F.foot.y + v, F.foot.z + F.fz * s + F.lz * (w + F.c));
}

/** World direction of a frame axis ('l', 'o', 'w'). */
export function ladderDir(F, axis, out = new THREE.Vector3()) {
  if (axis === 'w') return out.set(F.lx, 0, F.lz);
  const a = axis === 'l' ? F.ax : F.ox;
  return out.set(F.fx * a.f, a.y, F.fz * a.f);
}

/**
 * Measure a ladder link's frame on the built scene. @param {object[]} parts static mesh parts near it (collectParts)
 * @returns {object} frame (finish) with `source`: 'drawn' (a drawn ladder), 'partial' (drawn, stopping short of the
 * ground: its foot is built), 'wall' (a bare wall face: a ladder is built against it), 'open' (nothing to lean on: a
 * ladder is built at the deck's edge)
 */
export function measureFrame(link, parts) {
  const A = linkAxes(link);
  const F = measureOnce(link, A, parts);
  const hint = F.source !== 'drawn' && F.source !== 'partial' ? F.yawHint ?? F.faceYaw : null;
  if (hint) {
    // a drawn ladder turned off the link's line (M2's second MG tower), or a face the link crosses aslant (M2's
    // palisade): measured again square to it
    const { nw, ns } = hint, fx = ns * A.fx + nw * A.lx, fz = ns * A.fz + nw * A.lz, n = Math.hypot(fx, fz) || 1;
    const B = { ...A, fx: fx / n, fz: fz / n, lx: fz / n, lz: -fx / n };
    const G = measureOnce(link, B, parts);
    if (G.source === 'drawn' || G.source === 'partial' || (!F.yawHint && G.source !== 'drawn')) return finish(G);
  }
  return finish(F);
}

/**
 * How crowded the climber's way up a built ladder at {s0, k, c} would be (0: clear): rays through the space he takes
 * (0.05–0.8 m out of the rung line, ±0.26 m, knee height up to under the deck), along the ladder over him, over the
 * top where he rises onto the deck, and down onto the deck behind the top rung.
 */
function crowding(parts, A, L, H, over, coarse = false, limit = Infinity) {
  const { foot, fx, fz, lx, lz } = A, { s0, k, c } = L;
  const o = new THREE.Vector3(), d = new THREE.Vector3(fx, 0, fz);
  const P = (s, v, w) => o.set(foot.x + fx * s + lx * (w + c), foot.y + v, foot.z + fz * s + lz * (w + c));
  let bad = 0;
  // (up to where his head goes stepping off at the top: over a wall's top, between its merlons)
  const vTop = Math.max(H, over) + 1.5, dv = coarse ? 0.3 : 0.1, ws = coarse ? [-0.22, 0, 0.22] : [-0.26, -0.13, 0, 0.13, 0.26];
  for (let v = 0.3; v <= vTop + 1e-6; v += dv) {
    if (v > H - 0.3 && v < H + 0.2) continue; // (the deck's edge)
    const sl = s0 + k * Math.min(v, over);
    for (const w of ws) if (castFirst(parts, P(sl - 0.8, v, w), d, 0.85) != null) bad += coarse ? 5 : 1; // (a coarse ray stands for five)
    if (bad > limit) return null;
  }
  // (a slab over him: along the ladder from knee height to under the deck)
  const n = Math.hypot(1, k), ax = new THREE.Vector3(fx * k / n, 1 / n, fz * k / n);
  for (const oo of [0.2, 0.45, 0.7]) for (const w of [-0.2, 0, 0.2]) {
    if (castFirst(parts, P(s0 + k * 0.3 - oo, 0.3, w), ax, Math.max(0.1, (H - 0.75) * n)) != null) bad += 4;
  }
  // (a lintel over the top where he rises onto the deck)
  const up = new THREE.Vector3(0, 1, 0), sT = s0 + k * over;
  for (const oo of [0.15, 0.45]) if (castFirst(parts, P(sT - oo, Math.max(H, over) - 0.3, 0), up, 2.2) != null) bad += 4;
  // (a floor behind the top rung)
  let deck = false;
  for (const w of [-0.12, 0.12]) {
    let y = H + 1.5;
    for (let i = 0; i < 4 && !deck; i++) {
      const t = castFirst(parts, P(sT + 0.35, y, w), d.set(0, -1, 0), y - H + 0.5);
      if (t == null) break;
      y -= t;
      if (Math.abs(y - H) < 0.4) deck = true;
      y -= 0.02;
    }
  }
  if (!deck) bad += 6;
  return bad;
}

/** One measurement along the axes A (linkAxes, or turned square to a drawn ladder). */
function measureOnce(link, A, parts) {
  const { foot, H, hd, fx, fz, lx, lz } = A;
  const far = hd + FRAME.behind + 3;
  const o = new THREE.Vector3(), d = new THREE.Vector3(fx, 0, fz);
  const at = (v, w) => o.set(foot.x - fx * FRAME.behind + lx * w, foot.y + v, foot.z - fz * FRAME.behind + lz * w);
  const hitS = (v, w) => { const t = castFirst(parts, at(v, w), d, far); return t == null ? null : t - FRAME.behind; };
  // the profile: s of the first surface in front of each (row, column)
  const cols = [];
  for (let w = -FRAME.latMax; w <= FRAME.latMax + 1e-6; w += FRAME.lat) cols.push(+w.toFixed(3));
  const vTop = H + FRAME.above + 0.4, rows = [];
  for (let v = 0.15; v <= vTop + 1e-6; v += FRAME.dv) rows.push(+v.toFixed(3));
  const prof = rows.map((v) => cols.map((w) => hitS(v, w)));
  const climbRows = rows.map((v, j) => [v, j]).filter(([v]) => v >= 0.35 && v <= H - 0.15);
  // per column: the best straight line through its hits over the climb — plumb, or leaning (the median slope of
  // pairs of hits a good way apart: a ladder laid against a wall)
  const colFit = cols.map((w, i) => {
    const pts = climbRows.map(([v, j]) => [v, prof[j][i]]).filter(([, x]) => x != null);
    if (pts.length < 4) return { w, k: 0, b: null, inl: 0 };
    const sl = [];
    for (let a = 0; a < pts.length; a += 2) for (let b = a + 1; b < pts.length; b += 3) if (pts[b][0] - pts[a][0] > 0.5) sl.push((pts[b][1] - pts[a][1]) / (pts[b][0] - pts[a][0]));
    let best = null;
    for (const k of [0, median(sl) ?? 0]) {
      if (Math.abs(k) > 2.5) continue;
      const r = pts.map(([v, x]) => x - k * v), b = median(r);
      const inl = r.filter((x) => Math.abs(x - b) < 0.035).length / Math.max(1, climbRows.length);
      if (!best || inl > best.inl + 0.02) best = { w, k: Math.abs(k) < 0.03 ? 0 : k, b, inl };
    }
    return best;
  });
  const solid = colFit.filter((c) => c.inl >= 0.7);
  // the frontmost solid surface (at mid height)
  const vMid = H * 0.5, sAt = (c, v) => c.b + c.k * v;
  const front = solid.length ? Math.min(...solid.map((c) => sAt(c, vMid))) : null;
  const frontSet = front == null ? [] : solid.filter((c) => sAt(c, vMid) < front + 0.06);
  // clusters of adjacent front columns
  const clusters = [];
  for (const c of frontSet.sort((a, b) => a.w - b.w)) {
    const last = clusters.at(-1);
    if (last && c.w - last.at(-1).w <= FRAME.lat * 1.6) last.push(c); else clusters.push([c]);
  }
  const width = (cl) => cl.at(-1).w - cl[0].w;
  const centre = (cl) => (cl[0].w + cl.at(-1).w) / 2;
  // drawn ladder: two narrow stiles 0.25–0.8 m apart, rungs between them
  let F = null;
  const narrow = clusters.filter((cl) => width(cl) <= 0.17);
  let pair = null;
  for (let i = 0; i < narrow.length; i++) for (let j = i + 1; j < narrow.length; j++) {
    const a = narrow[i], b = narrow[j], sep = centre(b) - centre(a);
    if (sep < 0.25 || sep > 0.85) continue;
    const mid = (centre(a) + centre(b)) / 2;
    if (!pair || Math.abs(mid) < Math.abs(pair.mid)) pair = { a, b, mid, sep };
  }
  let yawHint = null;
  if (!pair) {
    // stiles off square: narrow solid columns standing in front of their neighbours, 0.2–0.9 m apart at different depths
    const fit = (w) => colFit.find((c) => Math.abs(c.w - w) < 1e-6);
    const lone = solid.filter((c) => [-2, -1.5, 1.5, 2].every((d) => { const n = fit(+(c.w + d * FRAME.lat).toFixed(3)); return !n || n.inl < 0.7 || sAt(n, vMid) > sAt(c, vMid) + 0.04; }));
    let best = null;
    for (let i = 0; i < lone.length; i++) for (let j = i + 1; j < lone.length; j++) {
      const a = lone[i], b = lone[j], dw = b.w - a.w, ds = sAt(b, vMid) - sAt(a, vMid);
      if (dw < 0.2 || dw > 0.9 || Math.abs(ds) > dw * 0.6) continue;
      const mid = (a.w + b.w) / 2;
      if (!best || Math.abs(mid) < Math.abs(best.mid)) best = { mid, dw, ds };
    }
    if (best) { const n = Math.hypot(best.dw, best.ds); yawHint = { nw: -best.ds / n, ns: best.dw / n }; }
  }
  if (pair) {
    const k = median([...pair.a, ...pair.b].map((c) => c.k)), b0 = median([...pair.a, ...pair.b].map((c) => c.b));
    // rungs: a fine scan up the middle, hits on the stiles' line
    const rs = [];
    for (const w of [pair.mid - 0.07, pair.mid, pair.mid + 0.07]) {
      let run = null;
      for (let v = 0.05; v <= H + FRAME.above + 0.3; v += FRAME.fine) {
        const s = hitS(v, w), on = s != null && Math.abs(s - (b0 + k * v)) < 0.07;
        if (on) { if (!run) run = { v0: v, v1: v, s: [s] }; else { run.v1 = v; run.s.push(s); } } else if (run) { rs.push(run); run = null; }
      }
      if (run) rs.push(run);
    }
    // merge the three scans' runs into rungs (centre height, front, thickness)
    const runs = rs.filter((r) => r.v1 - r.v0 <= 0.09).sort((x, y) => x.v0 - y.v0), rungs = [];
    for (const r of runs) {
      const c = (r.v0 + r.v1) / 2, last = rungs.at(-1);
      if (last && Math.abs(c - last.v) < 0.06) { last.n++; last.th = Math.max(last.th, r.v1 - r.v0 + FRAME.fine); last.front = Math.min(last.front, Math.min(...r.s)); }
      else rungs.push({ v: c, n: 1, th: r.v1 - r.v0 + FRAME.fine, front: Math.min(...r.s) });
    }
    const good = rungs.filter((r) => r.n >= 2);
    if (good.length >= FRAME.minRungs) {
      const th = median(good.map((r) => r.th)), rr = clamp(th / 2, 0.012, 0.035);
      const frontS = median(good.map((r) => r.front - k * r.v));
      // stile tops: the highest row whose stile columns still hit the line
      let railTop = 0;
      rows.forEach((v, j) => { if ([...pair.a, ...pair.b].some((c) => { const s = prof[j][cols.indexOf(c.w)]; return s != null && Math.abs(s - (b0 + k * v)) < 0.06; })) railTop = Math.max(railTop, v); });
      // the stiles' lowest row: a ladder hanging short of the ground (M8 tanks) gets its foot built
      let railBot = Infinity;
      rows.forEach((v, j) => { if ([...pair.a, ...pair.b].some((c) => { const s = prof[j][cols.indexOf(c.w)]; return s != null && Math.abs(s - (b0 + k * v)) < 0.06; })) railBot = Math.min(railBot, v); });
      const vs = good.map((r) => r.v);
      // (each stile's own top: one may stop short of the other)
      const topOf = (cs) => { let t = 0; rows.forEach((v, j) => { if (cs.some((c) => { const s = prof[j][cols.indexOf(c.w)]; return s != null && Math.abs(s - (b0 + k * v)) < 0.06; })) t = Math.max(t, v); }); return t; };
      const wA = median(pair.a.map((c) => c.w)), wB = median(pair.b.map((c) => c.w));
      const tA = topOf(pair.a), tB = topOf(pair.b);
      const railTops = wA < wB ? [tA, tB] : [tB, tA]; // [right (-w), left (+w)]
      F = { ...A, linkId: link.id, s0: frontS + rr * Math.hypot(1, k), k, c: pair.mid, rungs: vs, rr, halfW: pair.sep / 2, railTop, railTops, source: 'drawn', build: null };
      // (how far the stiles' fronts stand out of the rungs' line: deep stiles come closer to the knees)
      F.stileFront = Math.max(0, (F.s0 - b0) / Math.hypot(1, k));
      const low = Math.min(...vs), sp = median(vs.slice(1).map((v, i) => v - vs[i])) || FRAME.rungSp;
      if (low > 0.55 && railBot > 0.35) {
        // stops short of the ground: stiles and rungs down to it, the same spacing
        const add = []; for (let v = low - sp; v >= 0.18; v -= sp) add.unshift(+v.toFixed(4));
        F.rungs = [...add, ...vs]; F.source = 'partial';
        F.build = { v0: 0, v1: railBot + 0.05, rungs: add, sp };
      }
    }
  }
  // wall: the frontmost solid surface is a broad face (no stiles in front of it)
  const broad = clusters.find((cl) => width(cl) >= 0.36 && centre(cl) > -0.3 && centre(cl) < 0.3);
  let wallS = null, wallTop = null;
  if (broad) {
    wallS = median(broad.map((c) => sAt(c, 0)));
    const kw = median(broad.map((c) => c.k));
    // its top: the highest row still hitting it near the middle
    rows.forEach((v, j) => { const s = prof[j][cols.indexOf(broad[broad.length >> 1].w)]; if (s != null && Math.abs(s - (wallS + kw * v)) < 0.08) wallTop = v; });
    if (!F) F = { ...A, linkId: link.id, s0: wallS - FRAME.standoff, k: kw, c: 0, rr: FRAME.rungR, halfW: FRAME.halfW, source: 'wall', build: null, face: (v) => wallS + kw * v };
  } else if (F) {
    // a wall behind a drawn ladder (toe room): the middle columns' farther hits
    const back = climbRows.map(([v, j]) => prof[j][cols.indexOf(cols.reduce((a, w) => (Math.abs(w - F.c) < Math.abs(a - F.c) ? w : a), cols[0]))]).filter((s) => s != null && s > F.s0 + 0.03);
    if (back.length > climbRows.length * 0.4) wallS = median(back);
  }
  if (!F) {
    // nothing to lean on over the climb: the deck's front edge (the first hits near the top), else halfway
    const nearTop = rows.map((v, j) => [v, j]).filter(([v]) => v >= H - 0.6 && v <= H + 0.2);
    const hits = nearTop.flatMap(([, j]) => cols.map((w, i) => (Math.abs(w) <= 0.3 ? prof[j][i] : null))).filter((s) => s != null && s > 0.15 && s < hd + 0.5);
    const edge = hits.length ? Math.min(...hits) : null;
    const s0 = edge != null ? edge - FRAME.standoff : hd >= 0.5 ? clamp(hd * 0.5, 0.3, hd - 0.25) : 0.3;
    F = { ...A, linkId: link.id, s0, k: 0, c: 0, rr: FRAME.rungR, halfW: FRAME.halfW, source: 'open', build: null, face: () => s0 + FRAME.standoff };
  }
  F.wall = wallS;
  if (F.source === 'open' && wallTop == null) {
    // what stands at the deck's edge: the highest row still hitting it near the middle (a palisade over its walk)
    const edgeS = F.s0 + FRAME.standoff;
    rows.forEach((v, j) => { if (cols.some((w, i) => Math.abs(w) <= 0.25 && prof[j][i] != null && prof[j][i] < edgeS + 0.3)) wallTop = Math.max(wallTop ?? 0, v); });
  }
  if (F.source === 'wall' || F.source === 'open') {
    // a ladder is built: up to the deck — or over the wall's top when it stands higher than the deck (a palisade)
    const over = wallTop != null && wallTop > H + 0.25 ? wallTop : H;
    F.over = over;
    // its line: plumb against the face — or, the foot end standing well out from it (M20's castle walls), leaning from
    // half a metre in front of the foot end to the face's top edge (≤ 1 in 3)
    const sTop = F.face(over) - FRAME.standoff;
    if (sTop > 0.75 && over > 1) {
      F.s0 = Math.max(0.45, sTop - over / 3); F.k = (sTop - F.s0) / over;
    } else if (F.source === 'open') { F.s0 = sTop; F.k = 0; }
    delete F.face;
    // clear of whatever stands out of the face anywhere up its height (a palisade's rails, a sill, the lower storey's
    // ledge under an upper wall): the ladder's foot goes out — leaning, its top kept on the edge — until it keeps 0.12 m
    // from the frontmost of it across its width; moved out whole when even a 1-in-2 lean would not clear it
    const front = rows.map((v, j) => {
      let m = Infinity;
      cols.forEach((w, i) => { if (Math.abs(w) <= FRAME.halfW + 0.08 && prof[j][i] != null) m = Math.min(m, prof[j][i]); });
      return [v, m];
    }).filter(([v, m]) => v >= 0.15 && v <= over && m < Infinity);
    const base = { s0: F.s0, k: F.k };
    const sTopNow = F.s0 + F.k * over;
    let kNeed = F.k;
    for (const [v, m] of front) if (over - v > 0.3) kNeed = Math.max(kNeed, (sTopNow - m + 0.12) / (over - v));
    if (kNeed > F.k + 1e-3 && kNeed <= 0.5) { F.k = kNeed; F.s0 = sTopNow - kNeed * over; }
    let push = 0;
    for (const [v, m] of front) push = Math.max(push, F.s0 + F.k * v - (m - 0.12));
    F.push = push;
    if (push > 0 && push < 0.6) F.s0 -= push;
    // the climber's room: nothing in the space he takes in front of it, no slab over him, a floor where he steps off —
    // else the ladder goes sideways and / or its foot out (leaning, its top kept on the edge) to the clearest place
    // near the link (the bombed houses' beams and floor edges, a souk's canopy)
    const head = { s0: F.s0, k: F.k, c: 0 };
    head.bad = crowding(parts, A, head, H, over);
    let best = head;
    // (searched when crowded — or when its foot went far out of the way: a cheaper clear place may be near)
    if (head.bad > 0 || Math.abs(head.s0 - base.s0) > 0.8) {
      // (candidates: sideways ±0.8 m, the foot out up to 1.2 m — or well out of a ruin's front wall — the top on the
      // edge ±0.2–0.4 m; cheapest first, a coarse look cut short once it cannot beat the best so far, the best few
      // measured in full)
      const sB0 = base.s0, sT0 = base.s0 + base.k * over;
      const sBs = [0, -0.2, -0.4, -0.6, -0.9, -1.2, 0.2].map((d) => sB0 + d);
      for (const a of [-0.3, -0.6, -0.9]) if (a < sB0 - 0.95) sBs.push(a);
      const cands = [];
      for (const c of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6, -0.8, 0.8]) {
        for (const sB of sBs) {
          for (const dT of [0, -0.2, 0.2, 0.4]) {
            const k = (sT0 + dT - sB) / over;
            if (k >= -0.05 && k <= 0.45) cands.push({ s0: sB, k, c, cost: 1.5 * Math.abs(c) + 1.2 * Math.abs(sB - sB0) + 1.2 * Math.abs(dT) });
          }
        }
      }
      cands.sort((a, b) => a.cost - b.cost);
      const SLACK = 15, kept = [];
      let bound = head.bad * 3 + 1.2 * Math.abs(head.s0 - sB0) + 1.2 * Math.abs(head.s0 + head.k * over - sT0);
      for (const cd of cands) {
        if (cd.cost >= bound + SLACK) break;
        const b = crowding(parts, A, cd, H, over, true, (bound + SLACK - cd.cost) / 3);
        if (b == null) continue;
        cd.score = b * 3 + cd.cost;
        kept.push(cd);
        bound = Math.min(bound, cd.score);
      }
      kept.sort((a, b) => a.score - b.score);
      head.score = head.bad * 3 + 1.2 * Math.abs(head.s0 - sB0) + 1.2 * Math.abs(head.s0 + head.k * over - sT0);
      for (const cd of kept.slice(0, 6)) {
        cd.bad = crowding(parts, A, cd, H, over);
        cd.score = cd.bad * 3 + cd.cost;
        if (cd.score < best.score - 1e-6) best = cd;
      }
    }
    F.s0 = best.s0; F.k = best.k; F.c = best.c; F.crowd = best.bad;
    // (a deck's lip, a cornice, a floor's edge — too thin for the profile's rows: finely, all the way up, kept behind
    // the rung line where the knees pass)
    F.lip = 0;
    for (let pass = 0; pass < 3; pass++) {
      let lip = 0;
      d.set(fx, 0, fz);
      for (let v = 0.3; v <= Math.max(H, over) + 0.4; v += 0.02) {
        const sl = F.s0 + F.k * Math.min(v, over);
        for (let w = -0.27; w <= 0.27 + 1e-6; w += 0.03) {
          const t = castFirst(parts, o.set(foot.x + fx * (sl - 0.6) + lx * (w + F.c), foot.y + v, foot.z + fz * (sl - 0.6) + lz * (w + F.c)), d, 0.65);
          if (t != null && t >= 0.35) lip = Math.max(lip, 0.6 - t + 0.005); // (within 0.25 m of the rung line)
        }
      }
      if (!(lip > 0) || F.lip + lip > 0.35) break;
      F.s0 -= lip; F.lip += lip; // (and again: what stood further out may be near the line now)
    }
    F.rungs = rungList(0.3, Math.max(0.3, over - 0.12));
    F.railTop = over + (over > H + 0.25 ? 0.35 : FRAME.above);
    F.build = { v0: 0, v1: F.railTop, rungs: F.rungs, sp: FRAME.rungSp };
  } else F.over = wallTop != null && wallTop > H + 0.25 && wallTop < F.railTop ? wallTop : H;
  delete F.face;
  F.yawHint = yawHint;
  // the room in front of the rungs (a cage's hoops, an overhang): the nearest thing on the climber's side across the
  // ladder's width over the climb
  // (fresh rays out from just in front of the rungs, finely: a floor's thin edge; where the ladder ended up)
  // (per height: F.rooms[i] at 0.4 + 0.02·i m — what is low by the foot does not matter at the top)
  {
    let room = Infinity;
    const out = new THREE.Vector3(-fx, 0, -fz), c = F.c ?? 0, rooms = [];
    for (let v = 0.4; v <= Math.min(H, F.over ?? H) - 0.2 + 1e-6; v += 0.02) {
      const sl = F.s0 + F.k * v;
      let r = 9;
      for (const w of [-0.16, -0.08, 0, 0.08, 0.16]) {
        const t = castFirst(parts, o.set(foot.x + fx * (sl - 0.08) + lx * (w + c), foot.y + v, foot.z + fz * (sl - 0.08) + lz * (w + c)), out, 1.2);
        if (t != null) r = Math.min(r, t + 0.08);
      }
      rooms.push(+r.toFixed(3));
      if (r < room) { room = r; F.roomV = +v.toFixed(2); }
    }
    F.room = room; F.rooms = rooms;
  }
  // the headroom over the way off at the top (a doorway's lintel: M20's tower)
  {
    let top = Infinity;
    const sT = F.s0 + F.k * Math.min(H, F.over ?? H);
    for (const ds of [0.2, 0.4]) for (const w of [-0.15, 0, 0.15]) {
      const t = castFirst(parts, o.set(foot.x + fx * (sT + ds) + lx * (w + (F.c ?? 0)), foot.y + H + 0.1, foot.z + fz * (sT + ds) + lz * (w + (F.c ?? 0))), d.set(0, 1, 0), 2.5);
      if (t != null) top = Math.min(top, t + 0.1);
    }
    d.set(fx, 0, fz);
    F.topRoom = top;
  }
  // inside a building (the brick ruins' stair to their roof, M4 / M7 / M17 / M19): walls all round halfway up — the
  // climb is out of sight in there; nothing is built (it would stick out through the roof)
  if (F.source !== 'drawn' && F.source !== 'partial') {
    const mid = o.set(foot.x + fx * Math.max(0.2, F.s0 * 0.5), foot.y + H * 0.5, foot.z + fz * Math.max(0.2, F.s0 * 0.5)).clone();
    let n = 0;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; if (castFirst(parts, mid, d.set(Math.cos(a), 0, Math.sin(a)), 4) != null) n++; }
    // (and a roof over the climber's way up, below the top: an outside wall's ladder has the sky over it)
    const lid = n >= 8 ? castFirst(parts, o.set(foot.x + fx * (F.s0 + 0.4 * (F.ox?.f ?? -1)), foot.y + 0.5, foot.z + fz * (F.s0 + 0.4 * (F.ox?.f ?? -1))), d.set(0, 1, 0), H + 3) : null;
    if (n >= 8 && lid != null && lid < H + 1.5) { F.source = 'inside'; F.build = null; F.over = H; F.rungs = rungList(0.3, H - 0.1); F.railTop = H + FRAME.above; return F; }
    d.set(fx, 0, fz);
  }
  if (F.source === 'wall' || F.source === 'open') {
    // the face's own line across the ladder's width (median hit of each column over the climb): a link crossing it
    // aslant gets its ladder square to it
    const pts = cols.map((w, i) => [w, median(rows.map((v, j) => (v >= 0.3 && v <= Math.max(0.6, F.over - 0.1) ? prof[j][i] : null)).filter((x) => x != null && x > -0.5 && x < hd + 1))]).filter(([w, x]) => x != null && Math.abs(w) <= 0.4);
    if (pts.length >= 8) {
      const sl = [];
      for (let a = 0; a < pts.length; a++) for (let b = a + 4; b < pts.length; b++) sl.push((pts[b][1] - pts[a][1]) / (pts[b][0] - pts[a][0]));
      const b = median(sl);
      if (b != null && Math.abs(b) > 0.12 && Math.abs(b) < 3) { const n = Math.hypot(1, b); F.faceYaw = { nw: -b / n, ns: 1 / n }; }
    }
  }
  return F;
}

// ------------------------------------------------------------------ built ladders

/**
 * A raised ladder's swing as it is lowered: about its top rung's line (the pivot at the top of its stiles), from
 * straight up to its lean, the way over the outside of the wall. `a0`: the angle (rad) from its lean to straight up.
 */
function swingOf(F) {
  const n = Math.hypot(1, F.k), top = ladderPoint(F, F.build.v1 * n, 0, 0), foot = ladderPoint(F, F.build.v0 * n, 0, 0);
  const out = new THREE.Vector3(foot.x - top.x, 0, foot.z - top.z);
  if (out.lengthSq() < 1e-8) out.set(F.fx, 0, F.fz).negate();
  out.normalize();
  // (rotating by +a about out × up turns `out` towards up: the ladder's foot swings out from the wall and up)
  const axis = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
  const v = foot.clone().sub(top).normalize();
  return { pivot: top, axis, a0: Math.PI / 2 - Math.atan2(v.y, v.dot(out)) };
}
const _swq = new THREE.Quaternion(), _swv = new THREE.Vector3();
/** Pose a built ladder `ang` rad up from its lean about its swing's pivot (0: at rest, as built). */
function swingTo(mesh, S, ang) {
  if (ang === 0) { mesh.position.set(0, 0, 0); mesh.quaternion.identity(); }
  else {
    _swq.setFromAxisAngle(S.axis, ang);
    mesh.quaternion.copy(_swq);
    mesh.position.copy(S.pivot).sub(_swv.copy(S.pivot).applyQuaternion(_swq));
  }
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
}

/** Timber ladder geometry for a frame's `build` section (stiles + rungs), world space. */
function buildLadderMesh(F, seed) {
  const B = F.build, G = new Geo(seed);
  const h = Math.atan2(F.lz, F.lx); // the box helper's heading: its x along the lateral axis
  const n = Math.hypot(1, F.k);
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (const side of [-1, 1]) {
    const w = side * F.halfW;
    // a stile: from v0 to v1 along the ladder, its square section
    const l0 = B.v0 * n, l1 = B.v1 * n;
    ladderPoint(F, l0, 0, w, p); ladderPoint(F, l1, 0, w, q);
    const c = FRAME.stile / 2, ax = q.clone().sub(p), L = ax.length(); ax.normalize();
    const ox = ladderDir(F, 'o', new THREE.Vector3()), wx = ladderDir(F, 'w', new THREE.Vector3());
    const P = (a, b, t) => p.clone().addScaledVector(ax, t * L).addScaledVector(ox, a).addScaledVector(wx, b).toArray();
    G.hexa('timber', [P(-c, -c, 0), P(-c, c, 0), P(c, c, 0), P(c, -c, 0), P(-c, -c, 1), P(-c, c, 1), P(c, c, 1), P(c, -c, 1)], 0.8, { bottom: true });
  }
  for (const v of B.rungs) {
    ladderPoint(F, v * n, 0, 0, p);
    G.box('timber', p.x, p.y, p.z, F.halfW * 2 + FRAME.stile * 0.6, F.rr * 2, F.rr * 2, h, 0.72);
  }
  const g = G.build('ladder:built', { ground: F.foot.y, moss: 0, streaks: 0 });
  g.userData.ladderLink = F.linkId;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------ the sides of a map's flights of stairs

/** Step (m) along a flight between its measured sides (fitStairSides). */
export const SIDE_STEP = 0.1;

/**
 * What stands beside every flight of stairs (world.stairs) as drawn — its railings, cheek walls, a stairwell's walls,
 * whatever closes in on it (user 2026-10-11: "it looks like the man walk on the stairs in a way they can cross the
 * handrails, fix that"): every SIDE_STEP m along it, on each side, the nearest surface off its axis between 0.3 and
 * 1.5 m over its tread (a man's arms and body), within 1.5 m. f.sides = {s0, r: Float32Array, l: Float32Array}
 * (Infinity: open). Measured with the ladders (fitLadders), on the built scene.
 */
export function fitStairSides(world, scene, skip = new Set()) { runSync(fitStairSidesG(world, scene, skip)); }

/** fitStairSides as a sliced job (engine/slice.js): a flight at a time. */
export function* fitStairSidesG(world, scene, skip = new Set()) {
  const F = world?.stairs?.flights;
  if (!F?.length) return;
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  for (const f of F) {
    if (due()) yield;
    const s0 = (f.railS?.[0] ?? f.sFoot) - 0.3, s1 = (f.railS?.[1] ?? f.sTop) + 0.3, n = Math.max(1, Math.round((s1 - s0) / SIDE_STEP) + 1);
    const P = (s, v) => ({ x: f.ox + f.ux * s - f.uz * v, z: f.oz + f.uz * s + f.ux * v });
    const c = [P(s0, -1.6), P(s0, 1.6), P(s1, -1.6), P(s1, 1.6)];
    const box = new THREE.Box3(new THREE.Vector3(Math.min(...c.map((q) => q.x)), f.yMin - 0.2, Math.min(...c.map((q) => q.z))), new THREE.Vector3(Math.max(...c.map((q) => q.x)), f.yMax + 1.8, Math.max(...c.map((q) => q.z))));
    const parts = collectParts(scene, box, skip);
    const r = new Float32Array(n).fill(Infinity), l = new Float32Array(n).fill(Infinity);
    if (parts) {
      for (let i = 0; i < n; i++) {
        const s = s0 + i * SIDE_STEP, p = P(s, 0);
        // (the tread under it: the walking surface's level there)
        let k = 0; while (k < f.risers.length && f.risers[k] <= s) k++;
        const tr = f.levels[k];
        for (const [arr, sg] of [[r, -1], [l, 1]]) {
          d.set(-f.uz * sg, 0, f.ux * sg);
          for (let h = 0.3; h <= 1.5 + 1e-6; h += 0.2) {
            const t = castFirst(parts, o.set(p.x, tr + h, p.z), d, 1.5);
            if (t != null && t < arr[i]) arr[i] = t;
          }
        }
      }
    }
    f.sides = { s0, r, l };
  }
}

// ------------------------------------------------------------------ fitting a map's ladders

/** Whether something is drawn under the top end of a ladder at its height (down rays round the spot, ±0.4 m). */
function deckAt(parts, top) {
  if (!parts) return null;
  const o = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0);
  let hit = 0, n = 0;
  for (const [dx, dz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
    n++;
    // (past a rail or an eave over it: the surfaces down to 0.5 m under the spot)
    let y = top.y + 1.5;
    for (let k = 0; k < 4; k++) {
      const t = castFirst(parts, o.set(top.x + dx, y, top.z + dz), d, y - top.y + 0.5);
      if (t == null) break;
      y -= t;
      if (Math.abs(y - top.y) < 0.4) { hit++; break; }
      y -= 0.02;
    }
  }
  return hit > 0;
}

const FRAMES = new WeakMap();

/** The frame of a ladder link: measured (fitLadders) or, until then / headless, from the link alone. */
export function ladderFrame(world, link) {
  if (!link) return null;
  const m = world?.ladderFrames?.get(link.id);
  if (m) return m;
  let s = FRAMES.get(link);
  if (!s) FRAMES.set(link, (s = syntheticFrame(link)));
  return s;
}

/**
 * Measure every climbed ladder of a built map (steep ladder links; walked links and shallow ramps are not ladders)
 * and build the missing ladders. @returns {{frames: Map<number, object>, group: THREE.Group, frame: () => void,
 * dispose: () => void, ms: number}}
 */
export function fitLadders(world, scene) { return runSync(fitLaddersG(world, scene)); }

/** fitLadders as a sliced job (engine/slice.js): the same links in the same order, a ladder at a time. */
export function* fitLaddersG(world, scene) {
  const t0 = performance.now();
  const frames = new Map(), group = new THREE.Group();
  group.name = 'ladders:built';
  const links = (world?.grid?.links || []).filter((l) => l.kind === 'ladder' && !l.walk && steepLadder(l));
  const skip = new Set();
  // (men and machines move: their bodies are no part of a ladder; a destructible building is an entity too and stays)
  for (const e of world?.entities || []) if (e.object3d && /^(commando|enemy|vehicle|dog|animal|projectile|corpse|body)$/.test(e.kind || '')) skip.add(e.object3d);
  if (world?.scene) for (const c of world.scene.children) if (/^(units|characters|vfx)/i.test(c.name)) skip.add(c);
  const built = [];
  scene.updateMatrixWorld(true);
  for (const L of links) {
    if (due()) yield;
    const A = linkAxes(L);
    const box = new THREE.Box3(
      new THREE.Vector3(Math.min(A.foot.x, A.top.x) - 2.2, A.foot.y - 0.3, Math.min(A.foot.z, A.top.z) - 2.2),
      new THREE.Vector3(Math.max(A.foot.x, A.top.x) + 2.2, A.top.y + FRAME.above + 1, Math.max(A.foot.z, A.top.z) + 2.2));
    let F;
    try {
      const parts = collectParts(scene, box, skip);
      F = measureFrame(L, parts);
      F.deck = deckAt(parts, A.top);
    } catch (e) { console.warn('[ladder-frame]', e); F = syntheticFrame(L); }
    frames.set(L.id, F);
    // (the walk grid has a floor at the top but the art has none there — M4 / M6 / M7 / M17 / M19's bombed houses
    // lost theirs: a built ladder would only run up through what is left of the storey below into the air)
    if (F.deck === false && F.build) { F.build = null; F.source = 'nodeck'; }
    // (built only where the ladder leads somewhere: a link whose top is no walkable ground — a library tank's or a
    // tower's ladder nobody can climb — keeps what is drawn)
    const g = world.grid, topOk = g.walkableAt(A.top.x, A.top.z) && Math.abs(g.elevAt(A.top.x, A.top.z) - A.top.y) < 0.35;
    if (F.build && !topOk) F.build = null;
    if (F.build) {
      const mesh = buildLadderMesh(F, `${L.id}:${A.foot.x.toFixed(1)}`);
      mesh.visible = L.enabled !== false;
      // a raised ladder (drawn once lowered: M2's camp ladder) is drawn in the load's warm-up frame too, so its programs
      // — the river's mirror pass included — exist before it first shows (it hitched ~110 ms there, M2 walkthrough)
      if (!mesh.visible) mesh.userData.warmShow = true;
      group.add(mesh);
      built.push({ mesh, link: L, swing: mesh.visible ? null : swingOf(F), ang: 0, it: undefined });
    }
  }
  if (group.children.length) scene.add(group);
  world.ladderFrames = frames;
  // (and the sides of every flight of stairs: art/rail-arms.js keeps a man's arms inside them)
  try { yield* fitStairSidesG(world, scene, skip); } catch (e) { console.warn('[ladder-frame] stair sides', e); }
  const ms = Math.round(performance.now() - t0);
  return {
    frames, group, ms, counts: [...frames.values()].reduce((a, F) => { a[F.source] = (a[F.source] || 0) + 1; return a; }, {}),
    /**
     * A raised ladder is drawn once lowered (its link enabled), hidden again when pulled up. While a man lowers it (the
     * ladder interactable's `lowerStart`, set by the 'use' ability for its duration) it swings down over the outside
     * of the wall about its top: from straight up to its lean, falling faster as it goes.
     */
    frame() {
      for (const b of built) {
        let on = b.link.enabled !== false, ang = 0;
        if (!on && b.swing) {
          if (b.it === undefined) b.it = world.interactables?.find((i) => i.interactKind === 'ladder' && i.linkId === b.link.id) ?? null;
          const it = b.it;
          if (it?.lowerStart != null) {
            const u = Math.min(1, Math.max(0, (world.time - it.lowerStart) / (it.lowerDur || 1)));
            on = true;
            ang = b.swing.a0 * (1 - u * u);
          }
        }
        if (b.mesh.visible !== on) b.mesh.visible = on;
        if (b.swing && ang !== b.ang) { b.ang = ang; swingTo(b.mesh, b.swing, ang); }
      }
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
      if (world.ladderFrames === frames) world.ladderFrames = null;
    },
  };
}

/** (debugging aids: the raw ray profile of a link — tools/tests) */
export const _debug = { collectParts, castFirst, crowding, linkAxes };
