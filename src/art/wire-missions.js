/**
 * Per-mission wire choices for M4–M20 (docs/barbed-wire.md §3.2): which obstacle type each authored wire structure
 * draws as, keyed by mission id and structure id. Kept out of the mission data so the missions' gameplay defs
 * (footprints, cut cells, ids) stay untouched; wireTypeOf (art/wire-obstacles.js) consults it first.
 *
 * An entry is `{type, ...defOverrides}`; the overrides only steer the look (e.g. `hedgehogEvery`, `footCoil`).
 * `'*'` matches every structure of the mission with that variant key (`'*:<variant>'`).
 * @module art/wire-missions
 */
import * as THREE from 'three';
import { wireTypeOf } from './wire-obstacles.js';

export const MISSION_WIRE = {
  // M4 Restore Pride: "knife-rests with barbed wire" across the pass (spec), timber, snow on the beams
  m04: { wire: { type: 'knife_rest' } },
  // M6 Menace of the Leopold: double-apron belts on angle pickets; the road barricade is a knife rest by its hedgehogs
  m06: { wire_bar: { type: 'knife_rest', variant: 'knife_rest_steel' } },
  // M8 Pyrotechnics: double-apron rim lines; the gun position gets a single concertina on the rim
  m08: { wire_gun: { type: 'concertina' } },
  // M10 Operation Icarus: the field belts are double aprons with a hedgehog tied in every ~4.5 m (the mission's own
  // comment: "a hedgehog on the wire every ~4.5 m is drawn by the belt mesh"); the rim belts plain double aprons
  m10: {
    belt_w1: { type: 'double_apron', hedgehogEvery: 4.5 }, belt_w2: { type: 'double_apron', hedgehogEvery: 4.5 },
    belt_e1: { type: 'double_apron', hedgehogEvery: 4.5 }, belt_e2: { type: 'double_apron', hedgehogEvery: 4.5 },
  },
  // M14 D-Day Kick-off: a real Atlantic-Wall beach. Low-water landing beach (S/SW): concertina on the sand and knife
  // rests on the exits; upper beach under the fortified line (N): double aprons and a triple concertina; the NE
  // shingle keeps the hedgehog-and-wire belts with their sagging, tangled strands
  m14: {
    wr_sw1: { type: 'concertina' }, wr_sw2: { type: 'concertina' }, wr_sw3: { type: 'concertina' },
    wr_s1: { type: 'concertina' }, wr_s2: { type: 'knife_rest', variant: 'knife_rest_steel' },
    wr_e: { type: 'knife_rest', variant: 'knife_rest_steel' },
    wr_ne1: { type: 'hedgehog_belt' }, wr_ne2: { type: 'hedgehog_belt' }, wr_ne3: { type: 'hedgehog_belt' },
    wr_n1: { type: 'double_apron' }, wr_n2: { type: 'triple_concertina' }, wr_n3: { type: 'double_apron' },
    wr_n4: { type: 'concertina' }, wr_n5: { type: 'knife_rest', variant: 'knife_rest_steel' },
  },
  // M15 The End of the Butcher: one row of timber knife rests across the street
  m15: { knife_rests: { type: 'knife_rest' } },
  // M17 Before Dawn: the prisoners' wire cage
  m17: { pen: { type: 'cage' } },
  // M19 Frustrate Retaliation: the dog pen is welded mesh on pipe posts, no barbs (a kennel, not a prison)
  m19: { pen: { type: 'chainlink', kennel: true } },
};

/** Normalised mission key ('m4', 'M04', 'm04_restore_pride' → 'm04'). */
export function missionKey(id) {
  const m = /^m0*(\d+)/i.exec(String(id ?? ''));
  return m ? `m${m[1].padStart(2, '0')}` : null;
}

/** The table entry for a structure def in a mission, or null. */
export function missionWire(def = {}, missionId) {
  const t = MISSION_WIRE[missionKey(missionId)];
  if (!t) return null;
  return t[def.id] ?? t[`*:${def.variant}`] ?? null;
}

const PEN_SIDES = { N: [[-1, -1], [1, -1]], E: [[1, -1], [1, 1]], S: [[1, 1], [-1, 1]], W: [[-1, 1], [-1, -1]] };

/**
 * Wire runs for a `prison_pen` (art/props-extra.js pen kind): the walls as world-space polylines round the pen,
 * the `open` side left out and a 2.4 m gap centred on `gateSide` (the mission's own gate prop fills it). Returns the
 * tagged Object3Ds (one per polyline, `userData.wireRun`) for the map's wire layer, or null when the pen is not wire
 * (another `mat`, dressing off). Pure but for the empty groups.
 * p: {w, d, h, mat, open, gateSide, variant, id}; x, z, rot: the prop's placement (props-extra localToWorld frame).
 */
export function penWireRuns(p, x, z, rot, ctx = {}) {
  if (!ctx || ctx.library === false || ctx.dressing === false) return null;
  const def = { id: p.id, type: 'prison_pen', variant: p.variant, mat: p.mat, h: p.h ?? 2.4, width: 0.1 };
  const type = wireTypeOf(def, ctx);
  if (!type) return null;
  const c = Math.cos(rot), s = Math.sin(rot), W = (p.w ?? 10) / 2, D = (p.d ?? 8) / 2;
  const L = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
  const edges = [];
  for (const side of ['N', 'E', 'S', 'W']) {
    if (side === p.open) continue;
    const [[ax, az], [bx, bz]] = PEN_SIDES[side], a = [ax * W, az * D], b = [bx * W, bz * D];
    if (side !== p.gateSide) { edges.push([a, b]); continue; }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), f0 = Math.max(0, 0.5 - 1.2 / len), f1 = Math.min(1, 0.5 + 1.2 / len);
    const at = (f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    edges.push([a, at(f0)], [at(f1), b]);
  }
  const same = (u, v) => Math.abs(u[0] - v[0]) < 1e-6 && Math.abs(u[1] - v[1]) < 1e-6;
  const lines = [];
  for (const [a, b] of edges) {
    const last = lines[lines.length - 1];
    if (last && same(last[last.length - 1], a)) last.push(b); else lines.push([a, b]);
  }
  if (lines.length > 1 && same(lines[lines.length - 1].at(-1), lines[0][0])) lines[0] = [...lines.pop(), ...lines[0].slice(1)];
  return lines.filter((l) => l.length > 1).map((l, i) => {
    const o = new THREE.Group();
    o.name = `wire-run:${p.id ?? 'pen'}#${i}`;
    o.userData.wireRun = { type, def, points: l.map(([lx, lz]) => L(lx, lz)), coping: null };
    return o;
  });
}
