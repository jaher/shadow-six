/**
 * Ruined walls drawn with the ruin kit (art/ruin-kit.js; user 2026-11-10: "Buildings in ruins should look more
 * realistic"): the recipes the wall builders hand their runs to —
 *  - `mudRuin`    the desert villages' sun-dried mud brick under a mud render (M8 plateau, M9 stub, M10 start ruins):
 *                 soft, rain-rounded heads with gullies and collapse bites, the render spalled off in ragged patches,
 *                 slumped mud-brick talus under every collapse, sand drifted against the lee faces, the palm-log joists
 *                 of the lost roofs lying across the heads or fallen from them to the ground;
 *  - `stoneRuin`  shelled / demolished field-stone walls (M11 limestone, M16 / M18 grey Mosan rubble, M19 farmstead):
 *                 angular heads stepping on the courses, stones on the heads and at the feet, moss and weeds;
 *  - `burntHouse` a burned-out brick house's walls (M15): brick outside, the rooms' lime plaster inside (spalled,
 *                 smoke-black up to the broken head), the first floor's joist pockets with charred joists hanging from
 *                 them to the floor, windows left in the walls, a chimney stack standing above the head, brick talus;
 *  - `ruinedHouse` a ruined kit house's shell (M12's medina house): rendered rubble walls broken over its walkable
 *                 rubble top, heaps on it and at the feet;
 *  - `trenchRuin` a trench dug through ruins (M10): broken footings in its spoil banks;
 *  - `charRubble` the rubble skirt of a blown-up building with no modelled ruin (art/char-ruin.js).
 * Each returns the kit's visual-only group; `ruinLook(root, visual)` keeps the builder's old meshes as the gameplay
 * stamping source (art/ruin-kit.js navProxy) and adds the new look beside them.
 * @module art/ruin-walls
 */
import { RuinKit, navProxy } from './ruin-kit.js';

/** The old look stays the stamping source (not drawn); the kit's visual is added beside it. @returns {THREE.Object3D} */
export function ruinLook(root, visual) {
  navProxy(root);
  if (visual) root.add(visual);
  return root;
}

/** Collapse bites → rubble under them on both faces; a couple of low taluses elsewhere. */
function rubbleUnder(kit, segs, o = {}) {
  const R = kit.R;
  for (const seg of segs) {
    for (const b of seg.prof.bites) {
      // the masonry fell mostly to one side; a little to the other
      const u = b.u - seg.eA, w = b.w * 1.15, hh = Math.min(o.maxH ?? 0.75, 0.2 + b.d * (o.k ?? 0.55)), main = R() < 0.5 ? 1 : -1;
      kit.talus(seg, main, Math.max(-0.2, u - w), Math.min(seg.L + 0.2, u + w), hh * (0.8 + R() * 0.35), o.reach ?? 1.15);
      if (R() < 0.45) kit.talus(seg, -main, Math.max(-0.2, u - w * 0.7), Math.min(seg.L + 0.2, u + w * 0.7), hh * 0.55, (o.reach ?? 1.15) * 0.7);
    }
    const extra = Math.round(seg.L / 9 + R() * 0.6);
    for (let k = 0; k < extra; k++) {
      const u = R() * seg.L, w = 0.8 + R() * 1.4;
      kit.talus(seg, R() < 0.5 ? 1 : -1, Math.max(0, u - w / 2), Math.min(seg.L, u + w / 2), (o.lowH ?? 0.28) * (0.6 + R() * 0.6), o.reach ?? 1.0);
    }
  }
}

/**
 * The foot of every run buried in its own slumped masonry on both faces (mud brick melts down into an apron; stone and
 * brick shed their courses): overlapping low taluses the length of each run, higher here and there.
 */
function aprons(kit, segs, h0, reach) {
  const R = kit.R;
  for (const s of segs) for (const side of [1, -1]) {
    const n = Math.max(1, Math.round(s.L / 3.2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * s.L - 0.4 - R() * 0.4, b = ((k + 1) / n) * s.L + 0.4 + R() * 0.4;
      kit.talus(s, side, Math.max(-0.3, a), Math.min(s.L + 0.3, b), h0 * (0.7 + R() * 0.6), reach * (0.8 + R() * 0.4));
    }
  }
}

/**
 * The rest of the house the standing wall belonged to: the other walls' footings in broken stubs a course or three
 * high round a room on one side of it (the inside of a corner, else a seeded side), its beaten-earth / plaster floor in
 * patches, rubble heaped against the stubs, a broken timber or two lying in it. Low (a man steps over it): visual only.
 */
function roomOutline(kit, segs, o = {}) {
  const R = kit.R;
  if (!segs.length || R() < (o.skip ?? 0.12)) return;
  const s = segs.reduce((a, b) => (b.L > a.L ? b : a));
  if (s.L < 2.2) return;
  const side = segs.length > 1 ? innerSide(segs.map((q) => [q.ax, q.az]).concat([[segs[segs.length - 1].bx, segs[segs.length - 1].bz]])) : (R() < 0.5 ? 1 : -1);
  const D = Math.min(3.0, (o.depth ?? 2.8) * (0.85 + R() * 0.3)), u0 = s.L * R() * 0.25, u1 = s.L * (1 - R() * 0.25), off = s.t / 2;
  const P = (u, v) => [s.ax + s.tx * u + s.nx * side * v, s.az + s.tz * u + s.nz * side * v];
  const ring = [P(u0, off + 0.2), P(u0, off + D), P(u1, off + D), P(u1, off + 0.2)];
  // the footings in pieces (a doorway's gap, robbed-out stretches)
  const stubs = [];
  for (let k = 0; k + 1 < ring.length; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[k + 1], L = Math.hypot(bx - ax, bz - az);
    for (let u = 0; u < L - 0.3;) {
      const len = Math.min(L - u, 0.9 + R() * 2.2);
      if (R() < 0.78 && len > 0.4) {
        const a = [ax + (bx - ax) * u / L, az + (bz - az) * u / L], b = [ax + (bx - ax) * (u + len) / L, az + (bz - az) * (u + len) / L];
        stubs.push(...kit.wallRun([a, b], { h: (o.stubH ?? 0.42) * (0.6 + R() * 0.7), width: o.stubW ?? 0.45, min: 0.35, max: 1.0, base: 0.75, base0: -0.12,
          biteEvery: 2, biteDepth: 0.5, crestUnits: 1.6, skin: 0, ends: ['free', 'free'] }).segments);
      }
      u += len + 0.25 + R() * 0.9;
    }
  }
  // the floor, the rubble against the stubs and in the corners, a timber or two lying in it
  const um = (u0 + u1) / 2, vm = off + D / 2, [cx, cz] = P(um, vm), rot = Math.atan2(s.tz, s.tx);
  kit.floorPatch(cx, cz, u1 - u0 - 0.3, D - 0.5, rot, { share: 0.2 });
  for (const st of stubs) if (R() < 0.55) { const u = R() * st.L; kit.talus(st, R() < 0.5 ? 1 : -1, Math.max(0, u - 0.6), Math.min(st.L, u + 0.6), 0.15 + R() * 0.12, 0.6); }
  for (let k = 0; k < 2; k++) {
    if (R() < 0.35) continue;
    const a0 = rot + (R() - 0.5) * 1.6, L = 1.4 + R() * 1.6, px = cx + (R() - 0.5) * (u1 - u0) * 0.4, pz = cz + (R() - 0.5) * D * 0.4;
    const ax = px - Math.cos(a0) * L / 2, az = pz - Math.sin(a0) * L / 2, bx = px + Math.cos(a0) * L / 2, bz = pz + Math.sin(a0) * L / 2;
    kit.beam([ax, kit.supportAt(ax, az), az], [bx, kit.supportAt(bx, bz), bz], 0.16, 0.15, { charred: o.charred ?? false, kind: 'fallen' });
  }
  kit.scatter(stubs, stubs.reduce((a, q) => a + q.L, 0) * 1.2, 0.05, 0.6);
  return { side, D };
}

/** A heap of fallen masonry round each free end of a run (the wall broke down there). */
function endHeaps(kit, segs, hh) {
  const R = kit.R, first = segs[0], last = segs[segs.length - 1];
  if (!first) return;
  for (const [s, u, dir] of [[first, 0, -1], [last, last.L, 1]]) {
    const x = s.ax + s.tx * (u + dir * 0.25), z = s.az + s.tz * (u + dir * 0.25);
    kit.mound({ x, z, w: 1.3 + R() * 0.8, d: s.t + 0.9 + R() * 0.6, h: hh * (0.7 + R() * 0.5), rot: Math.atan2(s.tz, s.tx), density: 10 });
  }
}

/** Points along wall feet / mound toes for weeds. */
function feet(segs, R, n = 3) {
  const out = [];
  for (const s of segs) for (let k = 0; k < Math.max(1, Math.round(s.L / n)); k++) {
    const u = R() * s.L, side = R() < 0.5 ? 1 : -1, off = s.t / 2 + 0.1 + R() * 0.5;
    out.push([s.ax + s.tx * u + s.nx * side * off, s.az + s.tz * u + s.nz * side * off]);
  }
  return out;
}

/**
 * A ruined mud-brick wall run (world or local frame, the gameplay line). @param {number[][]} points
 * @param {{h: number, width: number, id?: string, theater?: string, detail?: number}} o
 */
export function mudRuin(points, o) {
  const kit = new RuinKit({ kind: 'mud', theater: o.theater ?? 'desert', id: o.id ?? points.flat().join(','), soot: 0.07, detail: o.detail ?? (/:edge\d/.test(String(o.id)) ? 0.4 : 1) });
  const R = kit.R, h = o.h, low = h < 1.5;
  const run = kit.wallRun(points, { h, width: o.width, min: low ? 0.72 : 0.66, max: 1.04, base: 0.9, skin: [0.62, 0.58], skinTop: 0.3 + R() * 0.25,
    biteEvery: low ? 6 : 3.6, biteDepth: low ? 0.7 : 1, crestUnits: 0.7, capTop: o.capTop });
  const segs = run.segments;
  rubbleUnder(kit, segs, { k: 0.4, maxH: Math.min(0.55, h * 0.25), lowH: 0.2, reach: 1.1 });
  aprons(kit, segs, Math.min(0.32, h * 0.15), 0.9);
  endHeaps(kit, segs, Math.min(0.5, h * 0.24));
  // the house round it: footings, floor, rubble (not on a short low stub, nor on an edge continuation)
  if (!low && !/:edge\d/.test(String(o.id))) roomOutline(kit, segs, { depth: 2.8, stubH: 0.42, charred: false });
  // sand blown against the windward faces (the prevailing wind from the W / N in both desert maps), a little in the lee
  for (const s of segs) {
    const wind = s.nx * 0.8 + s.nz * 0.6 > 0 ? -1 : 1;
    const n = 1 + Math.round(s.L / 3.5);
    for (let k = 0; k < n; k++) {
      const u = R() * s.L, w = 1.6 + R() * 2.8;
      kit.drift(s, R() < 0.75 ? wind : -wind, Math.max(-0.3, u - w / 2), Math.min(s.L + 0.3, u + w / 2), 0.22 + R() * 0.3, 0.9 + R() * 1.0);
    }
  }
  // the roof's palm-log joists: across a head (resting on it), or fallen with one end on the head and one on the ground
  for (const s of segs) {
    const n = s.L > 2 ? Math.min(3, Math.floor(s.L / 2.6)) : 0;
    for (let k = 0; k < n; k++) {
      if (R() < 0.3) continue;
      const u0 = (k + 0.5) / n * s.L + (R() - 0.5) * 0.5, c = s.cols.find((q) => u0 + s.eA >= q.u0 && u0 + s.eA < q.u1);
      if (!c || c.ym < 1.1 || c.u1 - c.u0 < 0.2) continue;
      const u = (c.u0 + c.u1) / 2 - s.eA; // (in the middle of its column: on the ridge, not on a step's edge)
      const side = R() < 0.5 ? 1 : -1, y = c.ym;
      const at = (uu, v, yy) => [s.ax + s.tx * uu + s.nx * v, yy, s.az + s.tz * uu + s.nz * v];
      if (R() < 0.55) {
        // lying across the head in its old seat, overhanging both faces
        // (balanced on the head's ridge: the overhangs either side within a hand of each other)
        const o1 = 0.1 + R() * 0.25, o2 = o1 + (R() - 0.5) * 0.12;
        kit.beam(at(u, -side * (s.t / 2 + o1), y), at(u, side * (s.t / 2 + o2), y), 0.19, 0.18, { charred: false, kind: 'joist' });
      } else {
        // fallen: its top end still on the head, the foot on the ground (or the talus) a pace out
        const du = (R() - 0.5) * 1.2, off = s.t / 2 + 1.0 + R() * 1.0;
        const fx = s.ax + s.tx * (u + du) + s.nx * side * off, fz = s.az + s.tz * (u + du) + s.nz * side * off;
        kit.beam(at(u, -side * s.t * 0.15, y), [fx, kit.supportAt(fx, fz), fz], 0.17, 0.17, { charred: false, kind: 'joist' });
      }
    }
  }
  kit.scatter(segs, segs.reduce((a, s) => a + s.L, 0) * 2.0, 0.1, 2.2);
  // broken palm-log timbers strewn on the ground round it
  for (const s of segs) for (let k = 0; k < Math.round(s.L / 5); k++) {
    if (R() < 0.4) continue;
    const u = R() * s.L, side = R() < 0.5 ? 1 : -1, off = s.t / 2 + 0.6 + R() * 1.4, a0 = Math.atan2(s.tz, s.tx) + (R() - 0.5) * 2.2, L = 0.8 + R() * 1.2;
    const px = s.ax + s.tx * u + s.nx * side * off, pz = s.az + s.tz * u + s.nz * side * off;
    const ax = px - Math.cos(a0) * L / 2, az = pz - Math.sin(a0) * L / 2, bx = px + Math.cos(a0) * L / 2, bz = pz + Math.sin(a0) * L / 2;
    kit.beam([ax, kit.supportAt(ax, az), az], [bx, kit.supportAt(bx, bz), bz], 0.15, 0.14, { charred: R() < 0.3, kind: 'fallen' });
  }
  for (const s of segs) for (const side of [1, -1]) kit.faceStreaks(s, side, Math.round(s.L / 3));
  return kit.build(`ruin-kit:mud:${o.id ?? ''}`);
}

/**
 * A ruined field-stone wall run. `kind`: 'stone' (fieldstone), 'stoneGrey' (grey rubble), 'limestone' (desert).
 * @param {number[][]} points @param {{h: number, width: number, id?: string, theater?: string, kind?: string,
 *   min?: number, max?: number, capTop?: number, skin?: number, detail?: number}} o
 */
export function stoneRuin(points, o) {
  const kit = new RuinKit({ kind: o.kind ?? 'stone', theater: o.theater ?? 'temperate', id: o.id ?? points.flat().join(','), soot: o.soot ?? 0.12,
    skin: o.skin ? undefined : null, detail: o.detail ?? 1 });
  kit.unitScale = o.unitScale ?? 1;
  const R = kit.R, h = o.h;
  const run = kit.wallRun(points, { h, width: o.width, min: o.min ?? 0.74, max: o.max ?? 1.05, base: o.base ?? 0.95, skin: o.skin ?? 0, skinTop: 0.5,
    biteEvery: o.biteEvery ?? (h > 2.5 ? 4.2 : 6), biteDepth: h > 2.5 ? 1 : 0.8, biteW: o.tall ? 1.8 : 1, crestUnits: 1.3, capTop: o.capTop, moss: true });
  const segs = run.segments;
  rubbleUnder(kit, segs, { k: 0.5, maxH: Math.min(o.tall ? 1.1 : 0.85, h * 0.3), lowH: Math.min(o.tall ? 0.45 : 0.3, h * 0.2), reach: h > 2.5 ? 1.6 : 1.0 });
  if (o.tall) aprons(kit, segs, Math.min(0.5, h * 0.14), 1.2);
  if (o.streaks) for (const s of segs) for (const side of [1, -1]) kit.faceStreaks(s, side, Math.round(s.L * o.streaks));
  if (o.theater === 'desert') for (const s of segs) {
    const u = R() * s.L, w = 1.5 + R() * 2.5;
    kit.drift(s, R() < 0.5 ? 1 : -1, Math.max(-0.3, u - w / 2), Math.min(s.L + 0.3, u + w / 2), 0.2 + R() * 0.25, 0.8 + R() * 0.8);
  }
  kit.scatter(segs, segs.reduce((a, s) => a + s.L, 0) * 1.6, 0.1, 1.5);
  kit.weeds(feet(segs, R, 1.6), segs.reduce((a, s) => a + s.L, 0) * 1.4);
  return kit.build(`ruin-kit:stone:${o.id ?? ''}`);
}

/**
 * A burned-out brick house's wall run (M15): `inner` +1 / -1, the side of the line the rooms were on (default: towards
 * the run's centroid). @param {number[][]} points @param {{h: number, width: number, id?: string, theater?: string,
 *   inner?: number, chimney?: boolean, detail?: number}} o
 */
export function burntHouse(points, o) {
  const kit = new RuinKit({ kind: 'brick', theater: o.theater ?? 'temperate', id: o.id ?? points.flat().join(','), soot: 0.95, detail: o.detail ?? (/:edge\d/.test(String(o.id)) ? 0.3 : 0.5) });
  const R = kit.R, h = o.h;
  kit.smokeH = h * 0.42;
  const inner = o.inner ?? innerSide(points);
  const floorY = Math.min(h - 0.45, 2.55);
  const run = kit.wallRun(points, { h, width: o.width, min: h < 2 ? 0.78 : 0.6, max: 1.06, base: 0.9, skin: inner > 0 ? [0.66, 0.06] : [0.06, 0.66], skinTop: 0.3,
    inner, pockets: h > 2.4 ? floorY : 0, biteEvery: 5, crestUnits: 1.0, ends: o.ends, skinCell: 0.22, cols: [0.23, 0.69] });
  const segs = run.segments;
  rubbleUnder(kit, segs, { k: 0.45, maxH: 0.6, lowH: 0.22, reach: 0.95 });
  // charred joists: hanging from their pockets down to the floor (or the rubble), the rest of the floor long burnt away
  for (const s of segs) for (const p of s.pocketsAt || []) {
    if (R() > 0.38) continue;
    const u = p.u - s.eA, at = (uu, v, y) => [s.ax + s.tx * uu + s.nx * v, y, s.az + s.tz * uu + s.nz * v];
    const top = at(u, inner * (s.t / 2 - 0.12), p.y + 0.02);
    const run2 = 1.2 + R() * 1.0, du = (R() - 0.5) * 0.9;
    const fx = s.ax + s.tx * (u + du) + s.nx * inner * (s.t / 2 + run2), fz = s.az + s.tz * (u + du) + s.nz * inner * (s.t / 2 + run2);
    kit.beam(top, [fx, kit.supportAt(fx, fz), fz], 0.13, 0.19, { kind: 'joist' });
  }
  // a window or two left in the surviving walls (outside faces), their frames charred
  for (const s of segs) {
    if (s.L < 4.5 || h < 2.6) continue;
    for (let k = 0, n = Math.round(s.L / 6); k < n; k++) if (R() < 0.75) kit.windowFrame(s, s.eA + s.L * (k + 0.5) / n + (R() - 0.5) * 0.8, -inner, 0.95, 0.85 + R() * 0.2, 1.05 + R() * 0.15);
  }
  // a chimney stack still standing out of the longest run's inside face
  if (o.chimney !== false && h > 2.4 && segs.length) {
    const s = segs.reduce((a, b) => (b.L > a.L ? b : a));
    kit.chimney(s, s.eA + s.L * (0.3 + R() * 0.4), inner, 0.9 + R() * 0.6);
  }
  kit.scatter(segs, segs.reduce((a, s) => a + s.L, 0) * 1.6, 0.1, 1.5);
  kit.weeds(feet(segs, R, 2.2), segs.reduce((a, s) => a + s.L, 0) * 0.9);
  return kit.build(`ruin-kit:burnt:${o.id ?? ''}`);
}

/**
 * A ruined kit house's shell (art/kit-buildings.js `ruined`, M12's arcade house): its four walls as broken masonry
 * under a spalled render, their heads never below the walkable rubble top (`top`, the roof walkers' level) and up to a
 * man's height over it; the rubble deck at that level (flat where the walkers go), heaps against the walls inside and
 * at their feet, loose units strewn round. @param {{w: number, d: number, h: number, id?: string, roofWalk?: boolean,
 *   roofY?: number}} p @param {string} theater
 */
export function ruinedHouse(p, theater = 'temperate') {
  const w = p.w ?? 8, d = p.d ?? 8, h = Math.max(1.6, p.h ?? 4), top = p.roofWalk ? (p.roofY ?? h) : h, H = top + 0.6, t = 0.4;
  const desert = theater === 'desert';
  const kit = new RuinKit({ kind: desert ? 'limestone' : theater === 'snow' ? 'stoneGrey' : 'brick', theater, id: p.id ?? `${p.x},${p.z}`, soot: 0.3,
    skin: desert ? 'adobe' : 'plaster' });
  const R = kit.R;
  const x0 = -w / 2 + t / 2 + 0.0, x1 = w / 2 - t / 2, z0 = -d / 2 + t / 2, z1 = d / 2 - t / 2;
  const ring = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  const lo = top + 0.06, hi = top + 1.0;
  const inn = innerSide(ring);
  const run = kit.wallRun(ring, { h: H, width: t, min: lo / H, max: hi / H, base: (top + 0.5) / H, ends: ['corner', 'corner'], skin: inn > 0 ? [0.3, 0.72] : [0.72, 0.3], skinTop: 0.45,
    biteEvery: 3.2, biteDepth: 1, crestUnits: 1.4 });
  const segs = run.segments;
  // the rubble deck at the walkers' level (a hair under it), dark core colours, a few units lying flat near the walls
  const ix = w / 2 - t, iz = d / 2 - t, n = 6;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ax = -ix + (2 * ix) * i / n, bx = -ix + (2 * ix) * (i + 1) / n, az = -iz + (2 * iz) * j / n, bz = -iz + (2 * iz) * (j + 1) / n, y = top - 0.03;
    const c = (x, z) => kit.wallColour(x * 1.3 + z, y, y, { core: true });
    const tile = kit.style.tile;
    kit.face.quad([ax, y, az], [ax, y, bz], [bx, y, bz], [bx, y, az], [ax / tile, az / tile], [ax / tile, bz / tile], [bx / tile, bz / tile], [bx / tile, az / tile], c(ax, az), c(ax, bz), c(bx, bz), c(bx, az));
  }
  kit.supports.push((x, z) => (Math.abs(x) <= ix && Math.abs(z) <= iz ? top - 0.03 : 0));
  // the ground floor's windows left in the walls, outside
  for (const s of segs) if (s.L > 4 && top > 2.6) kit.windowFrame(s, s.eA + s.L * (0.3 + R() * 0.4), -inn, Math.min(1.2, top * 0.25), desert ? 0.7 : 0.9, desert ? 0.9 : 1.15);
  // heaps against the walls inside (on the deck) and at their feet outside
  for (const s of segs) {
    const inner = innerSide(ring);
    for (let k = 0; k < Math.max(1, Math.round(s.L / 4)); k++) {
      const u = R() * s.L, ww = 0.9 + R() * 1.4, um = Math.max(ww / 2, Math.min(s.L - ww / 2, u));
      const off = s.t / 2 + 0.35;
      kit.mound({ x: s.ax + s.tx * um + s.nx * inner * off, z: s.az + s.tz * um + s.nz * inner * off, y0: top - 0.04, w: ww, d: 0.9, h: 0.25 + R() * 0.3, rot: Math.atan2(s.tz, s.tx), density: 10 });
      if (R() < 0.6) kit.talus(s, -inner, Math.max(0, u - ww / 2), Math.min(s.L, u + ww / 2), 0.3 + R() * 0.35, 1.0);
    }
  }
  kit.scatter(segs, segs.reduce((a, s) => a + s.L, 0) * 1.2, 0.1, 1.5, -innerSide(ring));
  if (desert) for (const s of segs) { const u = R() * s.L; kit.drift(s, -innerSide(ring), Math.max(0, u - 1.4), Math.min(s.L, u + 1.4), 0.25, 0.9); }
  return kit.build(`ruin-kit:house:${p.id ?? ''}`);
}

/**
 * A trench dug through a ruined village (M10 `trench_ruins`): the old houses' broken footings left in its spoil banks
 * — low runs of mud brick (or stone) in pieces along both parapets, fallen courses and loose bricks round them, sand
 * blown over them. Visual only (the trench's own look and gameplay stay). @param {number[][]} points the trench line
 * @param {{width?: number, id?: string, theater?: string}} o
 */
export function trenchRuin(points, o = {}) {
  const desert = (o.theater ?? 'desert') === 'desert';
  const kit = new RuinKit({ kind: desert ? 'mud' : 'stone', theater: o.theater ?? 'desert', id: `trench:${o.id ?? points.flat().join(',')}`, soot: 0.05, skin: null, detail: 0.8 });
  const R = kit.R, width = o.width ?? 1.4, segs = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.8) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
    for (const sd of [-1, 1]) {
      const off = sd * (width / 2 + 0.5);
      // the footing in pieces, gaps between them
      for (let u = R() * 0.8; u < L - 0.6;) {
        const len = Math.min(L - u, 1.2 + R() * 2.6);
        if (R() < 0.72 && len > 0.6) {
          const a = [ax + tx * u + nx * off, az + tz * u + nz * off], b = [ax + tx * (u + len) + nx * off, az + tz * (u + len) + nz * off];
          const run = kit.wallRun([a, b], { h: 0.38 + R() * 0.3, width: 0.42, min: 0.45, max: 1.0, base: 0.75, biteEvery: 2.5, biteDepth: 0.6, crestUnits: 1.2 });
          segs.push(...run.segments);
        }
        u += len + 0.4 + R() * 1.4;
      }
    }
  }
  for (const s of segs) if (R() < 0.6) { const u = R() * s.L; kit.talus(s, R() < 0.5 ? 1 : -1, Math.max(0, u - 0.6), Math.min(s.L, u + 0.6), 0.16 + R() * 0.12, 0.7); }
  kit.scatter(segs, segs.reduce((a, s) => a + s.L, 0) * 1.5, 0.05, 1.0);
  if (desert) for (const s of segs) if (R() < 0.7) kit.drift(s, R() < 0.5 ? 1 : -1, 0, s.L, 0.16 + R() * 0.12, 0.6);
  const g = kit.build(`ruin-kit:trench:${o.id ?? ''}`);
  return g;
}

/**
 * The rubble a burnt-out building throws round its foot (art/char-ruin.js, a blown-up structure with no modelled ruin):
 * spilled masonry and roof debris heaped against its walls outside, charred timbers leaning on them or lying in the
 * heaps, loose pieces strewn round. World frame (the char ruin's extras), the ground at `gy`.
 * @param {{x: number, z: number, w: number, d: number, rot?: number, gy?: number, id?: string, theater?: string}} o
 */
export function charRubble(o) {
  const kit = new RuinKit({ kind: o.theater === 'desert' ? 'limestone' : 'rubbleStone', theater: o.theater, id: `char:${o.id ?? `${o.x},${o.z}`}`, soot: 0.9, skin: null, detail: 0.8 });
  const R = kit.R, w = Math.max(1, o.w), d = Math.max(1, o.d), rot = o.rot ?? 0, c = Math.cos(rot), sn = Math.sin(rot);
  const wor = (lx, lz) => [o.x + lx * c - lz * sn, o.z + lx * sn + lz * c];
  const sides = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]];
  const segs = sides.map(([ax, az, bx, bz]) => {
    const [x0, z0] = wor(ax, az), [x1, z1] = wor(bx, bz), L = Math.hypot(x1 - x0, z1 - z0), tx = (x1 - x0) / L, tz = (z1 - z0) / L;
    return { ax: x0, az: z0, bx: x1, bz: z1, L, Lw: L, eA: 0, tx, tz, nx: -tz, nz: tx, t: 0.02, cols: [], s0: 0 };
  });
  // (the sides run round counter-clockwise in the footprint's frame: their right side, -1, is outside)
  const out = -1;
  for (const s of segs) {
    const n = 1 + Math.floor(s.L / 3.5);
    for (let k = 0; k < n; k++) {
      if (R() < 0.3) continue;
      const u = R() * s.L, ww = 1.0 + R() * 2.0;
      kit.talus(s, out, Math.max(0, u - ww / 2), Math.min(s.L, u + ww / 2), 0.28 + R() * 0.3, 1.0);
    }
    // a charred timber or two leaning on the wall, foot in the rubble
    if (R() < 0.5) {
      const u = 0.5 + R() * (s.L - 1), top = 1.2 + R() * 1.0, reach = 0.9 + R() * 0.9;
      const ax = s.ax + s.tx * u + s.nx * out * 0.08, az = s.az + s.tz * u + s.nz * out * 0.08;
      const fx = ax + s.nx * out * reach + s.tx * (R() - 0.5), fz = az + s.nz * out * reach + s.tz * (R() - 0.5);
      kit.beam([ax, top, az], [fx, kit.supportAt(fx, fz), fz], 0.13, 0.17, { kind: 'leaning' });
    }
  }
  kit.scatter(segs, (w + d) * 2 * 0.9, 0.2, 2.0, out);
  const g = kit.build(`ruin-kit:char:${o.id ?? ''}`);
  g.position.y = o.gy ?? 0;
  return g;
}

/** The side (+1 / -1 of the first run's left normal) facing the polyline's centroid (+1 when it lies on the line). */
export function innerSide(points) {
  const n = points.length, cx = points.reduce((a, p) => a + p[0], 0) / n, cz = points.reduce((a, p) => a + p[1], 0) / n;
  let best = 0;
  for (let k = 0; k + 1 < n; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az) || 1;
    const d = (-(bz - az) / L) * (cx - (ax + bx) / 2) + ((bx - ax) / L) * (cz - (az + bz) / 2);
    if (Math.abs(d) > Math.abs(best)) best = d;
  }
  return best < 0 ? -1 : 1;
}
