/**
 * LIGHTS OUT e05 "Cold Iron" art pass (browser only; docs/expansion/e05.md §13): Hammerø's star fort, its rooms and
 * its harbour, drawn by art/castle-kit.js and art/e05-dressing.js from the mission's own gameplay data (the rampart
 * bands and bastions, the room footprints, the links, the drawbridge rect), so nothing a unit stands on, hides behind or
 * climbs moves. Read from `world.mission` only (no layout here):
 *  - the rampart bands and the round bastions: battered granite revetments with a turf walk, their placeholder meshes
 *    swapped (the browser measures the masonry again); an outer granite parapet and coping, drawn alone;
 *  - the twin-towered gatehouse over the gate passage, the four corner flights, the moat's granite counterscarp;
 *  - the rooms (structures carrying `room`): walls, windows, a floor and furniture, and a roof that lifts off while a
 *    commando stands inside (Commandos-style interiors: the engine's rooms are walls and doorways);
 *  - the drawbridge span on its chains (tilted as the switch works it), the radio casemate's iron door leaf (shut /
 *    swung open with the gate), the hoist's cages and winding gear at both stops;
 *  - the officers' quarters and the guardroom, the signal mast and shelter on the NE bastion, the harbour's kerbs,
 *    bollards, sheds and pots, the folboats in the cove, the lit wall lamps.
 * @module missions/scripts/e05-art
 */
import * as THREE from 'three';
import { Geo, buildTerrace, buildTwinGatehouse, buildStairFlight } from '../../art/castle-kit.js';
import {
  buildRoomHouse, desk, chair, stove, cabinet, shelf, radioBench, hoistGear, buildDrawbridgeSpan, poseDrawbridge,
  buildSignalStation, buildBlock, lobsterPots, buildBoatShed, buildFolboats, wallLamp, lampGlass, ROOM_WALL,
  regrade, casemateRoof, yardStores, tallStores, woodStack, telegraphLine, fieldCannon, buildTimberHut, buildKennel, bastionSearchlight,
} from '../../art/e05-dressing.js';
import { buildHeath } from '../../art/e05-heath.js';
import { buildRocks } from '../../art/dressing.js';
import { ISLAND } from '../expansion/e05_cold_iron.js';
import { due } from '../../engine/slice.js';

/** The span's raised angle (rad): leaning on the gatehouse face. */
const SPAN_UP = (82 * Math.PI) / 180;

/** Replace structure `id`'s placeholder children by `visual` (world coordinates); the browser re-measures it. */
function swapVisual(w, id, visual) {
  const o = w.structures?.get?.(id)?.object3d;
  if (!o || !visual) return false;
  for (const c of o.children) c.visible = false;
  o.visible = true;
  o.updateMatrixWorld(true);
  visual.applyMatrix4(o.matrixWorld.clone().invert());
  visual.name = `e05art:${id}`;
  o.add(visual);
  o.userData.artSwapped = true;
  return true;
}
const hideStructure = (w, id) => { const o = w.structures?.get?.(id)?.object3d; if (o) for (const c of o.children) c.visible = false; };
const S = (m, id) => (m.structures || []).find((s) => s.id === id);

/** Per-room look and furniture (by the room structure's id). */
const ROOM_LOOK = {
  house_cmd: { wall: 'plaster_yellow', trim: 'dressed', roof: 'roof_tile', h: 5.2, rh: 3.1, storeys: 2, door: 'oak', chimney: true },
  office_g: { wall: 'field_granite', trim: 'e05_dressed', roof: 'slate', h: 4.2, rh: 3.2, slits: false, door: 'oak', t: 0.7 },
  // (a tarred deck with a parapet, cowls and the feeder cable — casemateRoof — not turf: it must not read as more rampart)
  radio_cas: { wall: 'rubble_brick', trim: 'field_granite', roof: 'flat', flatTop: 'felt', h: 4.6, slits: true, door: null, windowSides: ['W'] },
  keeper: { wall: 'rubble_brick', trim: 'field_granite', roof: 'slate', h: 3.6, rh: 1.7, door: 'oak' },
  hoist_top: { wall: 'rubble_brick', trim: 'field_granite', roof: 'slate', h: 4.0, rh: 1.9, door: null },
  magazine: { wall: 'rubble_brick_dk', trim: 'field_granite', roof: 'slate', h: 4.0, rh: 2.0, door: 'oak', slits: true },
};

/** Furniture of the rooms (drawn into one Geo with the room's body). */
function furnish(G, id, r, m) {
  const sp = m.e05Spots || {};
  if (id === 'house_cmd') {
    desk(G, 42.7, 58.4, Math.PI, { w: 1.6, d: 0.8 }); // the commandant's desk; he faces the west window
    chair(G, 43.7, 58.4, Math.PI);
    shelf(G, 44.5, 53.75, 0, 2.6); shelf(G, 41.2, 61, Math.PI / 2, 1.8);
    stove(G, 52.6, 54.3);
    desk(G, 49.5, 58.8, 0, { w: 2.2, d: 1.0 }); chair(G, 48.6, 58.8, 0); chair(G, 50.4, 58.8, Math.PI);
    G.box('canvas', 51.8, 0.03, 61.2, 3.0, 0.02, 1.6, 0, 0.55); // a runner
  } else if (id === 'office_g') {
    desk(G, 42.9, 79, Math.PI, { w: 1.5, d: 0.8 }); // the Kriminalrat's desk, facing Grethe's chair
    G.box('paint', 42.85, 0.85, 79.35, 0.42, 0.18, 0.36, 0, 0.35); // the typewriter
    G.cyl('iron', 42.8, 0.76, 78.55, 0.07, 0.03, 0.4, 8, 0.4); // the lamp
    G.box('rubber', 43.1, 0.82, 78.7, 0.3, 0.12, 0.12, 0, 0.5); // her handbag
    chair(G, 41.3, 79, 0); // Grethe's chair (she sits facing him)
    stove(G, 40.5, 76.2); cabinet(G, 40.5, 81.6, Math.PI / 2, 1.6); cabinet(G, 41.6, 82.2, 0, 1.4);
  } else if (id === 'radio_cas') {
    radioBench(G, 75.05, 64.5, Math.PI / 2, 2.4); radioBench(G, 75.05, 77, Math.PI / 2, 2.4); radioBench(G, 75.05, 70.6, Math.PI / 2, 1.6);
    desk(G, 72.9, 71, -Math.PI / 2, { w: 1.4, d: 0.8 }); chair(G, 72.9, 71.8, -Math.PI / 2);
    for (const z of [62, 66.5, 69, 73.5, 79]) G.box('rubber', 75.6, 2.6, z, 0.08, 0.08, 1.8, 0, 0.35); // cable runs
    cabinet(G, 67, 62, Math.PI / 2, 1.8); cabinet(G, 67, 63.2, Math.PI / 2, 1.8);
    G.box('canvas', 68.4, 0.03, 71, 1.6, 0.02, 18, 0, 0.5); // the corridor's matting
  } else if (id === 'keeper') {
    const sw = (m.interactables || []).find((i) => i.id === 'bridge_switch');
    if (sw) { G.box('paint', sw.x + 0.35, 1.2, sw.z, 0.25, 1.4, 0.9, 0, 0.5); G.box('signal', sw.x + 0.2, 1.65, sw.z - 0.2, 0.06, 0.35, 0.06, 0, 0.9); }
    chair(G, 60.1, 88.9, 0);
    G.box('rubber', 61.9, 2.4, 88.2, 0.08, 0.08, 3.0, 0, 0.35);
  } else if (id === 'hoist_top' && sp.hoist) {
    hoistGear(G, sp.hoist.top[0], sp.hoist.top[1], 3.4);
  } else if (id === 'magazine') {
    if (sp.hoist) hoistGear(G, sp.hoist.bottom[0], sp.hoist.bottom[1], 3.4);
    for (const [x, z] of [[81.2, 125.6], [81.2, 126.6], [86.8, 125.6], [86.8, 126.6], [81.2, 129.2]]) G.box('canvas', x, 0.35, z, 1.1, 0.7, 0.8, 0, 0.55 + ((x * 7 + z) % 3) * 0.06);
  }
}

/**
 * The pieces of an axis-aligned parapet run a→b left outside every bastion's circle (r): the run stops at each drum.
 * @returns {Array<[number[], number[]]>}
 */
export function parapetPieces([a, b], bastions, r) {
  const horiz = a[1] === b[1], lo = Math.min(horiz ? a[0] : a[1], horiz ? b[0] : b[1]), hi = Math.max(horiz ? a[0] : a[1], horiz ? b[0] : b[1]);
  const line = horiz ? a[1] : a[0];
  let pieces = [[lo, hi]];
  for (const [, bx, bz] of bastions) {
    const d = horiz ? bz - line : bx - line;
    if (Math.abs(d) >= r) continue;
    const h = Math.sqrt(r * r - d * d), c = horiz ? bx : bz, cut0 = c - h, cut1 = c + h;
    pieces = pieces.flatMap(([u0, u1]) => {
      if (cut1 <= u0 || cut0 >= u1) return [[u0, u1]];
      return [[u0, Math.max(u0, cut0)], [Math.min(u1, cut1), u1]].filter(([p, q]) => q - p > 0.05);
    });
  }
  return pieces.map(([u0, u1]) => (horiz ? [[u0, line], [u1, line]] : [[line, u0], [line, u1]]));
}

/**
 * The arc of a bastion's circle (x, z, r) that stands outside rectangle `rect` {x0, z0, x1, z1}: [start angle, sweep]
 * in radians (angles as Geo.ring: x + cos a·r, z + sin a·r), the longest contiguous outside run, 0.5° steps.
 */
export function outsideArc(x, z, r, rect) {
  const N = 720, out = (k) => {
    const a = (k / N) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    return px < rect.x0 || px > rect.x1 || pz < rect.z0 || pz > rect.z1;
  };
  const flags = Array.from({ length: N }, (_, k) => out(k));
  if (flags.every(Boolean)) return [0, Math.PI * 2];
  if (!flags.some(Boolean)) return [0, 0];
  const s = flags.findIndex((f, k) => !f && flags[(k + 1) % N]) + 1; // first outside sample after an inside one
  let best = [0, 0];
  for (let k = 0, run = 0, start = s; k < N; k++) {
    const i = (s + k) % N;
    if (flags[i]) { if (!run) start = i; run++; if (run > best[1]) best = [start, run]; } else run = 0;
  }
  return [(best[0] / N) * Math.PI * 2, (best[1] / N) * Math.PI * 2];
}

const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/**
 * Outline `poly` with its edges cut wherever another outline's edge crosses them or one of its corners lies on them
 * (collinear runs): each piece is then wholly against another body or wholly free.
 * @param {number[][]} poly @param {number[][][]} others
 */
export function splitEdges(poly, others) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const ts = [];
    for (const q of others) for (let k = 0; k < q.length; k++) {
      const c = q[k], d = q[(k + 1) % q.length], ex = d[0] - c[0], ez = d[1] - c[1], den = dx * ez - dz * ex;
      if (Math.abs(den) > 1e-9) {
        const t = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / den, u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / den;
        if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
      }
      const t2 = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / L2; // (another outline's corner on this edge)
      if (t2 > 1e-6 && t2 < 1 - 1e-6 && Math.hypot(a[0] + dx * t2 - c[0], a[1] + dz * t2 - c[1]) < 1e-4) ts.push(t2);
    }
    out.push(a);
    for (const t of [...new Set(ts.map((v) => +v.toFixed(6)))].sort((p, q) => p - q)) out.push([a[0] + dx * t, a[1] + dz * t]);
  }
  return out;
}

/**
 * Is edge a→b of outline `self` inside the rampart's mass — another band, a bastion or the gatehouse against its outer
 * side? Such an edge is no outline of the whole: no face, no coping (it drew a pale line across the neighbour's walk).
 */
export function interiorEdge(a, b, self, others) {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
  const p1 = [mx + nx * 0.15, mz + nz * 0.15], p2 = [mx - nx * 0.15, mz - nz * 0.15];
  const out = inPoly(p1[0], p1[1], self) ? p2 : p1; // (the side off `self`)
  return others.some((q) => inPoly(out[0], out[1], q));
}

/**
 * Where a corner flight (a → b, `width` wide) has gone wholly into the rampart it climbs: the run (m along it) at which
 * both its edges lie inside the masonry. Nothing is drawn past it — the cheek walls' stepped copings stood up out of
 * the walk's turf there (the flights cut diagonally into the rampart's inner face). Infinity when it never does.
 */
export function flightStop(a, b, width, polys) {
  const run = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / run, uz = (b.z - a.z) / run, h = width / 2;
  const inside = (x, z) => polys.some((q) => inPoly(x, z, q));
  for (let k = 1; k <= 400; k++) {
    const t = k / 400, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (inside(x - uz * h, z + ux * h) && inside(x + uz * h, z - ux * h)) return Math.min(run, run * t + 0.05);
  }
  return Infinity;
}

/** Cage of a hoist stop: a galvanised pad, four slim posts, a gate bar (drawn at both stops). */
function hoistCage(G, x, z) {
  G.box('iron', x, 0.02, z, 1.8, 0.04, 1.8, 0, 0.4);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) G.box('iron', x + a * 0.86, 1.2, z + b * 0.86, 0.06, 2.4, 0.06, 0, 0.35);
  G.box('iron', x, 2.4, z, 1.8, 0.06, 1.8, 0, 0.35);
}

/** Build the e05 art (idempotent per world); a generator for engine/slice.js. */
export function* buildE05ArtG(w) {
  if (!w.scene || w._e05Visuals) return;
  w._e05Visuals = true;
  const m = w.mission || {}, root = new THREE.Group();
  root.name = 'e05:art';
  const yWalk = 6;
  // ---- the rampart bands and bastions (swapped: the masonry is what the browser measures). One masonry ring: an edge
  // of a band or a bastion that runs inside the next one (or against the gatehouse) gets no face and no coping — only
  // the ring's own outline carries them (each prism's coping all round drew pale lines and polygons across the walk)
  const rampart = (m.structures || []).filter((s) => s.type === 'cliff' && /^(rampart|bastion)_granite$/.test(s.variant)).map((s) => {
    let poly = s.points;
    // the S bands stop at the gatehouse's towers (x 50 / 62), which carry their own masonry
    if (s.id === 'ramp_sw') poly = poly.map(([x, z]) => [Math.min(x, 50), z]);
    if (s.id === 'ramp_se') poly = poly.map(([x, z]) => [Math.max(x, 62), z]);
    return { s, poly };
  });
  const gateBody = [[50, 90], [62, 90], [62, 96], [50, 96]];
  for (const { s, poly } of rampart) {
    if (due()) yield;
    const others = [...rampart.filter((r) => r.s !== s).map((r) => r.poly), gateBody];
    const bastion = /^b_/.test(s.id);
    // (footY: the faces and the rubble plinth run down to the moat's bed, -1.2 at its deepest: no foot left short where
    // the bank shelves away under the water. mitre: the plinth one ring, mitred at every corner — a box per edge left a
    // dark slit at each of a bastion's sixteen corners, from its top down through the water)
    const v = buildTerrace(splitEdges(poly, others), s.h + (bastion ? 0.01 : 0), { seed: s.id, side: 'field_granite', top: 'turf_top', batter: 0.35, spouts: !bastion, footY: -1.6,
      mitre: true, skipEdge: (a, b) => interiorEdge(a, b, poly, others) });
    swapVisual(w, s.id, v);
  }
  // ---- outer parapet: on every band's and bastion's outer edge (visual: a 1.1 m granite breastwork with coping).
  // The straight runs stop where they enter a bastion; each bastion carries its breastwork on the arc that stands
  // outside the rampart's square only (a full ring would cross the wall walk the sentries pace)
  {
    const G = new Geo('e05:parapet'), R = m.e05Fort;
    if (R) {
      const { x0, z0, x1, z1 } = R.ramp, pw = 0.45, ph = 1.1, BR = R.bastionR;
      const runs = [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [62, z1]], [[50, z1], [x0, z1]], [[x0, z1], [x0, z0]]];
      for (const run of runs) for (const [a, b] of parapetPieces(run, R.bastions, BR)) {
        const horiz = a[1] === b[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        if (L < 0.2) continue;
        const off = horiz ? (a[1] === z0 ? pw / 2 : -pw / 2) : (a[0] === x0 ? pw / 2 : -pw / 2);
        if (horiz) { G.box('field_granite', cx, yWalk + ph / 2, cz + off, L, ph, pw, 0, 0.98); G.box('e05_dressed', cx, yWalk + ph + 0.06, cz + off, L + 0.1, 0.12, pw + 0.12, 0, 1.04); }
        else { G.box('field_granite', cx + off, yWalk + ph / 2, cz, pw, ph, L, 0, 0.98); G.box('e05_dressed', cx + off, yWalk + ph + 0.06, cz, pw + 0.12, 0.12, L + 0.1, 0, 1.04); }
      }
      for (const [, bx, bz] of R.bastions) {
        const [a0, arc] = outsideArc(bx, bz, BR, R.ramp);
        if (arc <= 0) continue;
        const seg = Math.max(6, Math.round((arc / (Math.PI * 2)) * 32));
        G.ring('field_granite', bx, yWalk, bz, BR - pw, BR, ph, seg, 0.97, { a0, arc });
        G.ring('e05_dressed', bx, yWalk + ph, bz, BR - pw - 0.05, BR + 0.06, 0.12, seg, 1.04, { a0, arc });
        // a dressed string course round the drum, a metre under the walk
        G.ring('e05_dressed', bx, yWalk - 1.2, bz, BR - 0.1, BR + 0.08, 0.16, seg, 1.02, { a0, arc });
      }
      // the moat's counterscarp: a granite coping round the outer edge (a gap for the bridge's landing)
      const M = R.moat;
      const cs = [[[M.x0, M.z0], [M.x1, M.z0]], [[M.x1, M.z0], [M.x1, M.z1]], [[M.x1, M.z1], [58.6, M.z1]], [[53.4, M.z1], [M.x0, M.z1]], [[M.x0, M.z1], [M.x0, M.z0]]];
      for (const [a, b] of cs) {
        const horiz = a[1] === b[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        if (horiz) G.box('field_granite_dk', cx, -0.35, cz + (a[1] === M.z0 ? -0.25 : 0.25), L, 0.9, 0.5, 0, 0.9);
        else G.box('field_granite_dk', cx + (a[0] === M.x0 ? -0.25 : 0.25), -0.35, cz, 0.5, 0.9, L, 0, 0.9);
      }
    }
    root.add(G.build('e05:parapets', { ground: yWalk, damp: 0.2, moss: 0.4 }));
  }
  if (due()) yield;
  // ---- the gatehouse over the passage (its tower tops are the wall walk; its arch top carries the plank link)
  // (in Hammerø's grey granite, with plain loops: a fort gate of the 1680s, not a medieval keep's cross slits)
  root.add(regrade(buildTwinGatehouse({ x: 56, z: 93, rot: 0, w: 12, d: 6, walkY: yWalk, passage: 4.5, loops: 'slit', zfix: true, seed: 'e05:gate', name: 'e05:gatehouse' })));
  // ---- the corner flights (castle-kit stone stairs on the mission's own links), each stopped where it has gone wholly
  // into the rampart's masonry (past it the cheeks' copings stood proud of the walk: "stairs to nowhere")
  const ringPolys = rampart.map((r) => r.poly);
  for (const l of m.ladders || []) {
    if (l.kind !== 'stairs') continue;
    if (due()) yield;
    const a = { x: l.x, y: l.y ?? 0, z: l.z }, b = { x: l.top[0], y: l.top[2] ?? 0, z: l.top[1] };
    root.add(buildStairFlight(a, b, { seed: l.id, width: 1.8, body: 'field_granite', tread: 'e05_dressed', name: `e05:${l.id}`, stopAt: flightStop(a, b, 1.8, ringPolys) }));
  }
  // ---- the rooms: body (walls, windows, floor, furniture) and a roof that lifts while a commando is inside
  const roofs = [];
  for (const s of m.structures || []) {
    if (!s.room) continue;
    if (due()) yield;
    const look = ROOM_LOOK[s.id] || {};
    const chim = look.chimney ? [[s.room.x0 + 2.2, (s.room.z0 + s.room.z1) / 2]] : null;
    const { body, roof } = buildRoomHouse(s.room, { ...look, chimney: chim, seed: s.id, name: `e05:${s.id}` });
    if (s.id === 'radio_cas') {
      // the feeder cable: off the deck's NE corner, up the rampart's inner face, along the walk's inner edge to the mast
      const r = s.room, deck = (look.h ?? 4.6) + 0.46, mast = m.e05Fort?.mast || [80.4, 44.4];
      roof.add(casemateRoof(r, look.h ?? 4.6, { cable: [[r.x0 + (r.x1 - r.x0) * 0.66, deck, r.z0 + 1.2], [r.x1 - 0.5, deck, r.z0 + 1.2], [r.x1 + 0.15, deck, r.z0 + 1.2],
        [r.x1 + 0.15, yWalk + 0.04, r.z0 + 1.2], [r.x1 + 0.35, yWalk + 0.04, r.z0 + 1.2], [r.x1 + 0.35, yWalk + 0.04, 49.6], [mast[0] - 0.6, yWalk + 0.04, mast[1] + 1.6], [mast[0], yWalk + 0.3, mast[1]]] }));
    }
    const F = new Geo(`${s.id}:furniture`);
    furnish(F, s.id, s.room, m);
    root.add(body, roof);
    if (F.parts.size) root.add(F.build(`e05:${s.id}:furniture`, { ground: 0, damp: 0, moss: 0 }));
    roofs.push({ id: s.id, roof, r: s.room });
  }
  // ---- the hoist's cages at both stops
  {
    const sp = m.e05Spots?.hoist, G = new Geo('e05:hoist');
    if (sp) { hoistCage(G, sp.top[0], sp.top[1]); hoistCage(G, sp.bottom[0], sp.bottom[1]); }
    root.add(G.build('e05:hoist-cages', { ground: 0, damp: 0, moss: 0 }));
    const lift = (w.interactables || []).find((i) => i.interactKind === 'lift');
    if (lift?.object3d) lift.object3d.visible = false; // (its placeholder cage: drawn here at both stops)
  }
  // ---- the camp on the glacis: three tarred barrack huts (doors on the lane and the camp's yard), the kennel
  for (const [id, door, style] of [['camp', 'W', 'tarred'], ['hut_2', 'S', 'painted'], ['hut_3', 'N', 'grey']]) { const s = S(m, id); if (s) swapVisual(w, id, buildTimberHut(s, { door, style })); }
  { const s = S(m, 'kennel'); if (s) swapVisual(w, 'kennel', buildKennel(s)); }
  if (due()) yield;
  // ---- solid buildings: the officers' quarters, the guardroom (swapped onto their footprints)
  for (const [id, o] of [['quarters', { wall: 'rubble_brick', roof: 'slate', h: 6.2, rh: 2.2, storeys: 2, door: 'S' }],
    ['guardroom', { wall: 'rubble_brick', roof: 'roof_tile', h: 4.0, rh: 2.0, storeys: 1, door: 'N' }]]) {
    const s = S(m, id);
    if (s) swapVisual(w, id, buildBlock(s, o));
  }
  // ---- the signal station on the NE bastion (an open-fronted shelter round the stove, the guyed mast)
  {
    const s = S(m, 'signal_hut');
    const st = (m.e05Spots?.stoveAt) || null;
    if (s) { hideStructure(w, 'signal_hut'); root.add(buildSignalStation(80.4, 44.4, yWalk, { h: 16, hut: { x: s.x, z: s.z, w: s.w, d: s.d }, stove: st })); }
  }
  if (due()) yield;
  // ---- the drawbridge span (the interactable's placeholder plank box hidden)
  const br = (w.interactables || []).find((i) => i.interactKind === 'drawbridge');
  let span = null;
  if (br) {
    const R = br.rect, L = R.w, zHinge = 96.05, zEnd = R.z + L / 2;
    span = buildDrawbridgeSpan({ x: R.x, z: (zHinge + zEnd) / 2, w: zEnd - zHinge, d: R.d - 0.2 }, { chainTo: 4.7 });
    root.add(span.group);
    if (br.object3d) br.object3d.visible = false;
    poseDrawbridge(span, br.raised ? SPAN_UP : 0);
  }
  // ---- the radio casemate's iron door (a riveted steel leaf) and the hoist house's plank door: hinged leaves in their
  // doorways, swung in when open
  const leaves = [];
  for (const [id, kind] of [['iron_door', 'iron'], ['hoist_door', 'plank'], ['hoist_door_w', 'plank']]) {
    const door = (w.interactables || []).find((i) => (i.tag ?? i.id) === id);
    const sd = S(m, id);
    if (!door || !sd) continue;
    hideStructure(w, id);
    const G = new Geo(`e05:${id}`), dw = sd.w ?? 1.8, dh = (sd.leafH ?? sd.h ?? 2.5) - 0.05; // (`h` is the gameplay height: the wall's)
    if (kind === 'iron') {
      G.box('paint', 0, dh / 2, 0, dw - 0.06, dh, 0.12, 0, 0.32);
      for (const y of [0.4, dh / 2, dh - 0.4]) G.box('iron', 0, y, -0.07, dw - 0.16, 0.12, 0.04, 0, 0.25);
      G.box('iron', dw / 2 - 0.25, 1.15, -0.09, 0.08, 0.3, 0.06, 0, 0.6); // the handle
    } else {
      // tarred vertical boards of uneven width, two ledges and a brace, a ring handle
      let x = -dw / 2 + 0.03;
      for (let k = 0; x < dw / 2 - 0.05; k++) {
        const bw = Math.min(0.16 + ((k * 37) % 5) * 0.012, dw / 2 - 0.03 - x);
        G.box('planks', x + bw / 2, dh / 2 - ((k * 13) % 3) * 0.01, 0, bw - 0.008, dh - ((k * 13) % 3) * 0.02, 0.07, 0, 0.42 + ((k * 7) % 4) * 0.05);
        x += bw;
      }
      for (const y of [0.45, dh - 0.45]) G.box('planks', 0, y, -0.06, dw - 0.12, 0.14, 0.05, 0, 0.6);
      G.box('planks', 0, dh / 2, -0.06, 0.12, dh - 0.9, 0.05, 0.62, 0.62);
      G.cyl('iron', dw / 2 - 0.22, 1.1, -0.1, 0.05, 0.05, 0.02, 8, 0.5);
    }
    const g = G.build(`e05:${id}`, { ground: 0, damp: 0, moss: 0 });
    const leaf = new THREE.Group(), rot = sd.rot ?? 0;
    // hinged at one jamb of the doorway (the leaf lies along the wall: x along `rot`)
    leaf.position.set(door.x - Math.cos(rot) * dw / 2, 0, door.z - Math.sin(rot) * dw / 2);
    leaf.rotation.y = -rot;
    g.position.set(dw / 2, 0, 0);
    leaf.add(g);
    root.add(leaf);
    leaves.push({ leaf, door, rot });
  }
  // ---- the harbour: the sheds, pots, a ladder down the west quay; the folboats (the quays' granite decks, coping, quay
  // walls, bollards and rings are the mission's paved area `quay_harbour`, the life rings and the capstan its furniture)
  {
    const G = new Geo('e05:harbour');
    lobsterPots(G, 76.6, 146.4, 5); lobsterPots(G, 98.6, 125.4, 3);
    // (the life rings on their posts and the capstan are the mission's street furniture: art/furniture)
    // an iron ladder down the west quay's face into the basin: two stiles, the rungs, the hoops over the coping
    for (const z of [150.62, 151.18]) G.box('iron', 82.09, -0.75, z, 0.05, 1.5, 0.05, 0, 0.3);
    for (let y = -1.35; y < 0; y += 0.3) G.box('iron', 82.09, y, 150.9, 0.035, 0.035, 0.56, 0, 0.3);
    root.add(G.build('e05:harbour', { ground: 0, damp: 0.6, moss: 0.3 }));
    for (const id of ['shed_1', 'shed_2']) { const s = S(m, id); if (s) swapVisual(w, id, buildBoatShed(s)); }
    root.add(buildFolboats(16.6, 151.2, 0.35));
  }
  // ---- the SW bastion's old iron garrison gun (laid over the cove, its muzzle short of the breastwork, clear of the
  // sentry's post), the SE bastion's idle searchlight
  {
    const G = new Geo('e05:bastion-dressing');
    fieldCannon(G, 30.2, 96.9, yWalk, 2.36);
    // (aimed out over the SE moat, parked a little down; its cable back across the walk towards the gorge)
    const glass = bastionSearchlight(G, 82.2, yWalk, 95.4, Math.atan2(0.8, 1), { cableTo: [[81.2, 94.2], [79.4, 92.8], [78.6, 92.1]] });
    root.add(G.build('e05:bastion-dressing', { ground: yWalk, damp: 0, moss: 0 }));
    root.add(glass);
  }
  // ---- the yard's stores (against walls nobody walks: the casemate's north end, the quarters' east gable, the
  // house's west wall; the tall tarped stacks in the lane, the courtyard and the parade), the field-telephone line
  // from the gate to the camp on the glacis
  {
    const G = new Geo('e05:yard-stores');
    yardStores(G, 73.4, 58.6, 0);
    woodStack(G, 39.6, 57.2, Math.PI / 2, 3.2);
    for (const [x, z] of [[68.75, 54.3], [68.8, 55.15], [69.55, 54.7]]) { G.cyl('paint', x, 0, z, 0.29, 0.29, 0.88, 12, 0.5); G.cyl('iron', x, 0.88, z, 0.3, 0.29, 0.03, 12, 0.4); }
    G.cyl('timber', 39.6, 0, 60.7, 0.38, 0.34, 0.9, 12, 0.6); // a water butt under the house's west eaves
    G.cyl('iron', 39.6, 0.9, 60.7, 0.39, 0.39, 0.04, 12, 0.35);
    // the tall stacks under tarpaulins that hide a man (the mission's `stores_tall` sight blockers, drawn on their boxes)
    for (const s of m.structures || []) if (s.variant === 'stores_tall') tallStores(G, s);
    root.add(G.build('e05:yard-stores', { ground: 0, damp: 0.3, moss: 0.1 }));
    root.add(telegraphLine([[59.6, 104.4], [68, 109.2], [79.6, 106.2], [89.9, 98.8], [96.2, 88.8], [95.6, 80.2]]));
  }
  // ---- caged wall lamps, lit (dusk): their glass glows (one instanced mesh)
  {
    const G = new Geo('e05:lamps'), pts = [];
    const lamp = (x, y, z, rot) => { wallLamp(G, x, y, z, rot); pts.push([x, y - 0.02, z]); };
    lamp(48.6, 2.9, 64.25, Math.PI / 2); lamp(47.75, 2.8, 77.6, 0); lamp(47.75, 2.8, 80.4, 0); lamp(49, 2.8, 84.75, -Math.PI / 2);
    lamp(66.6, 3.0, 58.75, Math.PI / 2); lamp(70.4, 2.9, 81.25, Math.PI / 2); lamp(53.5, 3.4, 89.7, -Math.PI / 2); lamp(58.7, 3.4, 89.7, -Math.PI / 2);
    lamp(68.5, 2.9, 85.3, -Math.PI / 2); lamp(85.8, 2.9, 130.75, Math.PI / 2);
    root.add(G.build('e05:lamp-cages', { ground: 0, damp: 0, moss: 0 }));
    root.add(lampGlass(pts));
  }
  // ---- the east shore under the camp: a strip of low granite boulders along the waterline between the huts' gable
  // ends and the surf (visual only: the shore keeps its ground; review r2 — the huts stood straight in the foam)
  {
    const coastX = (z) => {
      for (let k = 0; k + 1 < ISLAND.length; k++) {
        const [ax, az] = ISLAND[k], [bx, bz] = ISLAND[k + 1];
        if (ax > 100 && bx > 100 && (az - z) * (bz - z) <= 0 && az !== bz) return ax + ((z - az) / (bz - az)) * (bx - ax);
      }
      return 108.5;
    };
    const shore = new THREE.Group(); shore.name = 'e05:shore-rocks';
    let k = 0;
    for (let z = 50.6; z < 91; k++) {
      const h1 = ((k * 2654435761) >>> 0) / 4294967296, h2 = ((k * 40503 + 17) % 97) / 97, h3 = ((k * 7919 + 3) % 61) / 61;
      const w = 0.8 + 0.9 * h1, d = 0.7 + 0.7 * h2, h = 0.32 + 0.45 * h3, x = coastX(z) + (h2 - 0.4) * 0.6;
      const r = buildRocks({ id: `e05_shore_${k}`, w, d, h });
      r.position.set(Math.max(x, 107.3 + w / 2), 0, z);
      shore.add(r);
      z += 1.3 + 2.1 * h3 + (h1 > 0.82 ? 1.6 : 0); // gaps between them, now and then a wider one
    }
    root.add(shore);
  }
  // ---- the heath: winter heather and dead bracken in drifts on the islet's bare ground (visual only), clear of the
  // roads and paths, the camp's yard and the cove where the team lands
  if (due()) yield;
  { const heath = buildHeath(w, { exclude: m.e05HeathExclude || [] }); if (heath) root.add(heath); }
  w.scene.add(root);
  root.updateMatrixWorld(true);
  // ---- per tick (20 Hz, visual only): roofs lift while a commando is inside; the span and the iron door follow their state
  const inside = (r, u) => u.x > r.x0 + 0.2 && u.x < r.x1 - 0.2 && u.z > r.z0 + 0.2 && u.z < r.z1 - 0.2;
  w.onBelTick(() => {
    for (const R of roofs) {
      const show = !(w.commandos || []).some((c) => c.alive !== false && c.state !== 'jailed' && !c.removed && inside(R.r, c));
      if (R.roof.visible !== show) R.roof.visible = show;
    }
    if (span && br) {
      const T = 5;
      let a;
      if (br.moving > 0) { const p = 1 - br.moving / T; a = br._target ? p * SPAN_UP : (1 - p) * SPAN_UP; } else a = br.raised ? SPAN_UP : 0;
      if (span._a !== a) { span._a = a; poseDrawbridge(span, a); }
    }
    for (const L of leaves) {
      const want = -L.rot + (L.door.open ? -1.75 : 0);
      if (L.leaf.rotation.y !== want) { L.leaf.rotation.y = want; L.leaf.updateMatrixWorld(true); }
    }
  });
}

export { ROOM_WALL };
