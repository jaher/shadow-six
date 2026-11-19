/**
 * LIGHTS OUT e02 "Curfew" art pass (browser only): the Quartiere Scirocco drawn on the mission's own gameplay boxes
 * (art/naples-kit.js), so nothing a man stands on, hides behind or climbs moves. Read from `world.mission` only:
 *  - the levels: basalt-paved slabs at y 4 and y 8 with tufa retaining walls, the piazza's balustrade over the lower
 *    quarter; the Scalinata, both salite and the vehicle ramp as stone steps / a setts ramp; the low house's stair;
 *  - the houses: every `tufa_townhouse` box as a row of tufa houses (windows, shutters, balconies, shop shutters, flat
 *    terraces or tiled hips), the palazzo's wings (rusticated piperno, piano nobile, the courtyard gate and the androne
 *    to the rear carriage gate), the baroque church with its majolica dome, the campanile and its belfry deck;
 *  - the town past the map edges (backdrop rows on the same levels), the port wall and the sea beyond it;
 *  - the dressing (art/e02-dressing.js): the burning tram and the barricade, the fountain, the generator, the motor
 *    pool's tent and kennel, a handcart, a stall, the insurgents' rifles; washing across the alleys, wayside shrines
 *    with candles; the roof searchlight and its beam (it follows c4's eyes and dies with him), the DF van's loop aerial.
 * The placeholders of everything drawn here are hidden; their nav was stamped from the data boxes.
 * @module art/e02-art
 */
import * as THREE from 'three';
import { Geo, buildBlock, buildPalazzoWing, buildChurch, buildCampanile, buildSlab, buildSteps, buildWall, buildStairhead,
  balustrade, glowMesh, faces, at, fbox, slab3, buildHouse, windowAt, doorAt, groundWear } from './naples-kit.js';
import { buildSearchlight } from './field-guns.js';
import { buildTram, buildBarricade, buildFountain, buildGenerator, buildTent, buildKennel, buildHandcart, buildStall, buildRifles,
  E02_VARIANTS } from './e02-dressing.js';
import { coneAt } from '../ai/perception.js';
import { due } from '../engine/slice.js';

const Y = { A: 0, B: 4, C: 8 };
const B_EDGE = 92, C_EDGE = 24.5; // (== the mission's LB / LC)
const rectOf = (s) => ({ x0: s.x - s.w / 2, z0: s.z - s.d / 2, x1: s.x + s.w / 2, z1: s.z + s.d / 2 });
const levelY = (s) => (s.level === 'C' ? Y.C : s.level === 'B' ? Y.B : Y.A);

/** The town beyond the map edges, on the same three levels (backdrop houses: no gameplay). */
const BACKDROP = [
  // west: the lower quarter and the slopes above it
  [-34, 92, 0, 104, 'A'], [-34, 107, 0, 118, 'A'], [-34, 24.5, -14, 58, 'B'], [-14, 24.5, 0, 92, 'B'], [-34, 61, -14, 92, 'B'],
  [-34, -30, -14, 16, 'C'], [-11, -30, 0, 16, 'C'],
  // north: the upper town over Via Alta's blocks
  [0, -30, 9.5, 0, 'C'], [15.5, -30, 43.5, 0, 'C'], [43.5, -30, 78, 0, 'C'], [78, -30, 100, -2, 'C'], [100, -30, 134, 16, 'C'],
  // east
  [100, 92, 134, 104, 'A'], [100, 107, 134, 118, 'A'], [100, 24.5, 112, 92, 'B'], [115, 24.5, 134, 92, 'B'],
].map(([x0, z0, x1, z1, level], k) => ({ id: `bd_${k}`, x0, z0, x1, z1, level }));

/** The quarter's visuals as a sliced job (engine/slice.js). Idempotent per world. */
export function* buildE02ArtG(w) {
  if (!w.scene || w._e02Art) return;
  w._e02Art = true;
  const m = w.mission || {};
  const structs = m.structures || [];
  const byId = new Map(structs.map((s) => [s.id, s]));
  const root = new THREE.Group();
  root.name = 'e02:quarter';
  w.scene.add(root);
  // what this pass draws: the catalogue placeholders are hidden
  const mine = (s) => E02_VARIANTS[s.type]?.includes(s.variant) || s.type === 'cliff'
    || /^(scalinata_tufa|salita_steps|ramp_setts|sea_wall_tufa|tufa_yard_wall)$/.test(s.variant || '');
  for (const s of structs) if (mine(s)) { const o = w.structures?.get?.(s.id)?.object3d; if (o) o.visible = false; }
  // …and so are the engine's own drawings of what this pass draws in their place, which lay in the same planes as the
  // art (z-fighting): the stairs' concrete treads under the piperno steps (their rails stay), the port wall's carry-on
  // past the map edges (this pass runs the wall on 40 m past each edge itself)
  const artStairs = new Set(structs.filter((s) => mine(s) || s.id === 'lowh').flatMap((s) => (s.ramps || []).filter((r) => r.id !== 'ramp').map((r) => `dam-stair:${r.id}`)));
  w.scene.traverse((o) => { if (artStairs.has(o.name)) o.visible = false; });
  for (const o of w.scene.getObjectByName('props:edgeRuns')?.children || []) if (o.userData.edgeRunOf === 'port_wall') o.visible = false;
  // the lower quarter's basoli under Via Marina: the road's setts are drawn over them (pavement/index.js gives both the
  // same depth offset; the area's is dropped so the road always wins where they overlap, 3.5 cm over the terrain)
  w.scene.getObjectByName('pavement')?.traverse((o) => {
    if (!o.isMesh || !o.material?.polygonOffset) return;
    o.geometry.computeBoundingBox?.();
    const bb = o.geometry.boundingBox;
    if (bb && bb.max.z - bb.min.z > 20) { o.material.polygonOffset = false; o.material.needsUpdate = true; }
  });

  // ---------------------------------------------------------------- the open / ground model
  const solids = [];
  for (const s of structs) if (/^(house|flat_roof_house|watchtower|ruins)$/.test(s.type) && s.w && s.variant !== 'roof_platform') solids.push(rectOf(s));
  for (const b of BACKDROP) solids.push(b);
  const W = m.size?.[0] ?? 100, D = m.size?.[1] ?? 140;
  const open = (x, z) => {
    if (x < -24 || x > W + 24 || z < -24 || z > 137.3) return false; // far side of the backdrop rows, the port wall
    for (const r of solids) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return false;
    return true;
  };
  const groundY = (x, z) => (z >= B_EDGE ? Y.A : z >= C_EDGE ? Y.B : Y.C);
  const lit = [];
  const ctx = { open, groundY, lit };
  const build = (G, name, ground) => { const g = G.build(name, { ground, damp: 1.4, streaks: 0.3, moss: 0.15 }); root.add(g); return g; };

  // ---------------------------------------------------------------- the levels
  {
    const G = new Geo('e02:levels');
    // the piazza level (y 4), the Scalinata's notch cut out of it; past the map edges the town goes on
    const LB = [[-40, C_EDGE], [W + 40, C_EDGE], [W + 40, B_EDGE], [54, B_EDGE], [54, 88.2], [46, 88.2], [46, B_EDGE], [-40, B_EDGE]];
    buildSlab(G, LB, Y.B, { drop: Y.B, walls: [[[-40, B_EDGE], [46, B_EDGE]], [[54, B_EDGE], [W + 40, B_EDGE]]], outSign: -1 });
    // the notch's side walls (the stair's cheeks rise past them)
    // (15 mm proud of the paving, 15 mm under the coping, 1 cm into the notch: not in the retaining walls' end planes)
    for (const x of [46, 54]) G.box('np_tufaB', x + (x < 50 ? -0.19 : 0.19), (Y.B + 0.015) / 2, 90.1, 0.4, Y.B + 0.015, 3.8, 0, 0.9);
    // Via Alta's level (y 8) and its retaining wall over the piazza level
    const LC = [[-40, -40], [W + 40, -40], [W + 40, C_EDGE], [-40, C_EDGE]];
    buildSlab(G, LC, Y.C, { drop: Y.C - Y.B, walls: [[[-40, C_EDGE], [W + 40, C_EDGE]]], outSign: 1 });
    // the balustrade over the lower quarter (the gameplay parapets bal_w / bal_e)
    for (const id of ['bal_w', 'bal_e']) {
      const s = byId.get(id);
      if (!s) continue;
      const xs = s.points.map((p) => p[0]), zs = s.points.map((p) => p[1]), z = (Math.min(...zs) + Math.max(...zs)) / 2;
      balustrade(G, [Math.min(...xs), z], [Math.max(...xs), z], Y.B, { h: 1.05, t: 0.4 });
    }
    // the Scalinata: 8 m of piperno steps with tufa cheeks, a handrail down its middle, a shrine at its head
    const sc = byId.get('scalinata')?.ramps?.[0];
    if (sc) {
      const [a, b] = sc.points;
      buildSteps(G, a, b, sc.y0, sc.y1, sc.width - 0.2, { riser: 0.17, cheeks: 0.9 });
      slab3(G, 'np_iron', [a[0], sc.y0 + 1.0, a[1]], [b[0], sc.y1 + 1.0, b[1]], 0.06, 0.06, 0.8);
      for (let k = 0; k <= 4; k++) { const t = k / 4; G.box('np_iron', a[0], sc.y0 + (sc.y1 - sc.y0) * t + 0.5, a[1] + (b[1] - a[1]) * t, 0.05, 1.0, 0.05, 0, 0.8); }
    }
    // the salite: wide shallow steps (gradoni) of piperno edges and basalt between
    for (const id of ['salita_w', 'salita_e']) {
      const r = byId.get(id)?.ramps?.[0];
      if (r) buildSteps(G, r.points[0], r.points[1], r.y0, r.y1, r.width, { riser: 0.17, body: 'np_basalt' });
    }
    // the vehicle ramp up from the palazzo's rear gate: one setts slope with kerbs
    const rp = byId.get('ramp_n')?.ramps?.[0];
    if (rp) {
      const [a, b] = rp.points;
      slab3(G, 'np_basalt', [a[0], rp.y0 - 0.1, a[1]], [b[0], rp.y1 - 0.1, b[1]], rp.width, 0.2, 0.95);
      for (const s of [-1, 1]) slab3(G, 'np_piperno', [a[0] + s * (rp.width / 2 - 0.15), rp.y0 + 0.02, a[1]], [b[0] + s * (rp.width / 2 - 0.15), rp.y1 + 0.02, b[1]], 0.3, 0.2, 0.9);
    }
    // wear on the paving of all three levels: patches, puddles, paper, grit (render only: nowhere on a stair, a prop,
    // the tram's rails or a level's edge)
    const ramps = structs.flatMap((s) => (s.ramps || []).map((r) => ({ a: r.points[0], b: r.points[1], hw: r.width / 2 + 0.6 })));
    const props = structs.filter((s) => s.w && s.d && !/^(house|flat_roof_house|watchtower|ruins)$/.test(s.type)).map((s) => rectOf(s));
    const keep = (x, z) => {
      for (const { a, b, hw } of ramps) {
        const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
        if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < hw) return false;
      }
      for (const r of props) if (x > r.x0 - 0.5 && x < r.x1 + 0.5 && z > r.z0 - 0.5 && z < r.z1 + 0.5) return false;
      if (Math.hypot(x - 50, z - 77) < 3.4) return false; // the fountain
      if (x > 20 && x < 84.5 && Math.abs(z - 128.6) < 1.1) return false; // the tram's rails
      return true;
    };
    let seed = 0x5eed02;
    const R = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    groundWear(G, ctx, R, { x0: 0, z0: B_EDGE + 0.9, x1: W, z1: 136.4, y: Y.A, n: 170, keep });
    groundWear(G, ctx, R, { x0: 0, z0: C_EDGE + 0.9, x1: W, z1: B_EDGE - 0.9, y: Y.B, n: 190, keep });
    groundWear(G, ctx, R, { x0: 0, z0: 0.5, x1: W, z1: C_EDGE - 0.9, y: Y.C, n: 100, keep });
    build(G, 'e02:levels', 0);
  }
  if (due()) yield;

  // ---------------------------------------------------------------- houses, by level (one merged mesh per material each)
  for (const lv of ['A', 'B', 'C']) {
    const G = new Geo(`e02:houses:${lv}`);
    for (const s of structs) {
      if (s.variant !== 'tufa_townhouse' || (s.level || 'A') !== lv) continue;
      buildBlock(G, rectOf(s), levelY(s) + s.h, ctx, { seed: s.id, shops: lv === 'A' && s.z > 100, drop: 1.6, balconies: lv === 'A' ? 0.45 : 0.35 });
    }
    for (const b of BACKDROP) if (b.level === lv) buildBlock(G, b, Y[lv] + 11 + ((b.x0 * 7 + b.z0 * 3) % 4), ctx, { seed: b.id, balconies: 0.2, drop: 2 });
    build(G, `e02:houses:${lv}`, Y[lv]);
    if (due()) yield;
  }

  // ---------------------------------------------------------------- the palazzo
  {
    const G = new Geo('e02:palazzo');
    const top = Y.B + 12;
    for (const id of ['pal_nw', 'pal_ne', 'pal_w', 'pal_s']) {
      const s = byId.get(id);
      if (s) buildPalazzoWing(G, rectOf(s), Y.B, top, ctx, { seed: id });
    }
    // the north wing over the androne (x 22–26): its upper floors bridge the carriage way, the vault below
    const nw = byId.get('pal_nw'), ne = byId.get('pal_ne');
    if (nw && ne) {
      const x0 = nw.x + nw.w / 2, x1 = ne.x - ne.w / 2, z0 = nw.z - nw.d / 2, z1 = nw.z + nw.d / 2;
      // (2 cm proud of the wings' faces each side: the wings' quoins and cornices that end on its faces end inside it)
      // (and its top 6 mm under the wings' cornice tops that run on over it, as the wings' own tops are)
      G.box('np_tufaO', (x0 + x1) / 2, (Y.B + 4.6 + top - 0.006) / 2, (z0 + z1) / 2, x1 - x0, top - 0.006 - Y.B - 4.6, z1 - z0 + 0.04, 0, 0.95);
      for (const z of [z0, z1]) {
        const s = z === z0 ? -1 : 1;
        G.box('np_piperno', (x0 + x1) / 2, Y.B + 4.85, z + s * 0.08, x1 - x0 + 0.6, 0.5, 0.25, 0, 0.95); // the arch's head
        for (const x of [x0, x1]) G.box('np_piperno', x, Y.B + 2.3, z + s * 0.1, 0.5, 4.6, 0.3, 0, 0.92);
        windowAt(G, { a: [x0, z + s * 0.02], t: [1, 0], n: [0, s], L: x1 - x0 }, (x1 - x0) / 2, Y.B + 5.6, { w: 1.2, h: 2.6, frame: 'np_marble' });
      }
      G.box('np_piperno', (x0 + x1) / 2, Y.B + 4.55, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, 0, 0.6); // the androne's ceiling
      G.box('np_screed', (x0 + x1) / 2, top + 0.04, (z0 + z1) / 2, x1 - x0, 0.08, z1 - z0, 0, 0.9);
      // its lamp bracket (unlit) over the courtyard mouth
      G.box('np_iron', (x0 + x1) / 2, Y.B + 4.2, z1 + 0.35, 0.08, 0.08, 0.7, 0, 0.7);
    }
    // the courtyard's screen walls on the lane, the gate arch between them with its leaves folded back
    const en = byId.get('pal_ewall_n'), es = byId.get('pal_ewall_s');
    if (en && es) {
      for (const s of [en, es]) {
        const r = rectOf(s);
        G.box('np_tufaO', s.x, Y.B + s.h / 2, s.z, s.w, s.h, s.d, 0, 0.95);
        for (let y = Y.B, k = 0; y < Y.B + s.h - 0.6; y += 0.58, k++) G.box('np_piperno', r.x1 + 0.06, y + 0.3, s.z, 0.12, 0.54, s.d, 0, 0.86 + (k % 2) * 0.1);
        G.box('np_marble', s.x, Y.B + s.h + 0.1, s.z, s.w + 0.26, 0.2, s.d + 0.1, 0, 0.95); // (2 cm inside the portal arch's sides)
      }
      const gz0 = en.z + en.d / 2, gz1 = es.z - es.d / 2, gx = en.x;
      // the portal: piperno piers and a round arch over the 4 m opening, a cartouche with the arms chiselled off
      // (1.34 wide: 2 cm proud of the screen walls' copings and the arch each side, not in their end planes)
      for (const z of [gz0, gz1]) G.box('np_piperno', gx, Y.B + 2.6, z + (z === gz0 ? 0.35 : -0.35), 1.34, 5.2, 0.7, 0, 0.92);
      const R = (gz1 - gz0) / 2, cy = Y.B + 4.0, cz = (gz0 + gz1) / 2;
      for (let k = 0; k < 9; k++) {
        const a0 = (k / 9) * Math.PI, a1 = ((k + 1) / 9) * Math.PI;
        // (every other voussoir 2 cm wider: consecutive ones overlap at their ends, their sides in one plane)
        slab3(G, 'np_piperno', [gx, cy + Math.sin(a0) * (R + 0.3), cz - Math.cos(a0) * (R + 0.3)], [gx, cy + Math.sin(a1) * (R + 0.3), cz - Math.cos(a1) * (R + 0.3)], 1.3 + (k % 2) * 0.02, 0.6, 0.92);
      }
      G.box('np_tufaO', gx, cy + R + 1.4, cz, 1.0, 1.6, gz1 - gz0 + 0.6, 0, 0.95);
      G.box('np_marble', gx + 0.55, cy + R + 1.2, cz, 0.12, 1.0, 1.4, 0, 0.9);
      for (const [z, s] of [[gz0, 1], [gz1, -1]]) G.box('np_door', gx - 0.2 - 0.95, Y.B + 2.0, z + s * 0.25, 1.9, 4.0, 0.12, 0, 0.75); // leaves folded inward
    }
    // the rear carriage gate (shut), studded oak leaves in a piperno frame
    const rg = byId.get('pal_gate_n');
    if (rg) {
      const r = rectOf(rg);
      G.box('np_door', rg.x, Y.B + 2.1, rg.z, r.x1 - r.x0, 4.2, 0.18, 0, 0.7);
      for (let k = 1; k < 8; k++) G.box('np_iron', rg.x, Y.B + (4.2 * k) / 8, rg.z - 0.1, r.x1 - r.x0 - 0.2, 0.04, 0.03, 0, 0.6);
    }
    build(G, 'e02:palazzo', Y.B);
  }
  if (due()) yield;

  // ---------------------------------------------------------------- the church, its campanile, the searchlight's platform
  {
    const G = new Geo('e02:church');
    const ch = byId.get('church');
    if (ch) buildChurch(G, rectOf(ch), Y.B, ch.h);
    const bt = byId.get('bell_tower'), lad = (m.ladders || []).find((l) => l.id === 'L_bell');
    if (bt) buildCampanile(G, rectOf(bt), Y.B, bt.deckY ?? 16, { ladder: lad ? [lad.x, lad.z] : null, face: lad?.face ?? 'N' });
    const sl = byId.get('sl_deck');
    if (sl) {
      // a steel platform on the roof terrace: plates on a frame, a rail round it, sandbags against the parapet
      const r = rectOf(sl), y = sl.deckY ?? 16;
      G.box('np_paint', sl.x, y - 0.08, sl.z, r.x1 - r.x0, 0.16, r.z1 - r.z0, 0, 0.7);
      // (the W / E rails between the N / S ones, the posts up to the rail's underside: corners and post tops were in the
      // rails' planes)
      for (const f of faces(r)) {
        const ew = f.side === 'W' || f.side === 'E' ? 0.05 : 0;
        fbox(G, 'np_iron', f, ew, f.L - ew, -0.05, 0, y + 0.95, y + 1.0, 0.8);
        for (let u = 0; u <= f.L + 1e-6; u += f.L / 3) {
          if (ew && (u < 1e-3 || u > f.L - 1e-3)) continue; // (the corner posts are the N / S rails')
          fbox(G, 'np_iron', f, Math.max(0, u - 0.02), Math.min(f.L, u + 0.02), -0.05, 0, y, y + 0.95, 0.8);
        }
      }
      for (let k = 0; k < 6; k++) G.box('np_sack', r.x0 + 0.4 + (k % 3) * 0.9, y + 0.15 + Math.floor(k / 3) * 0.28, r.z1 + 0.25, 0.85, 0.3, 0.45, 0.05 * k, 0.85);
    }
    build(G, 'e02:church', Y.B);
  }
  if (due()) yield;

  // ---------------------------------------------------------------- the stair-head, the low house, the walls
  {
    const G = new Geo('e02:fabric');
    const ci = byId.get('cistern');
    if (ci) buildStairhead(G, rectOf(ci), Y.C, { h: ci.h });
    const lh = byId.get('lowh');
    if (lh) {
      const r = rectOf(lh), y = lh.h;
      buildHouse(G, r, y, ctx, { seed: 'lowh', roof: 'flat', balconies: 0, mat: 'np_tufaW', noHut: true });
      // the outside stair up its east face to the terrace, a rail along it
      const st = lh.ramps?.[0];
      if (st) {
        const [a, b] = st.points;
        buildSteps(G, a, b, st.y0, st.y1, st.width, { riser: 0.19, body: 'np_tufaW' });
        slab3(G, 'np_iron', [a[0] + 0.62, st.y0 + 1.0, a[1]], [b[0] + 0.62, st.y1 + 1.0, b[1]], 0.05, 0.05, 0.8);
      }
    }
    for (const id of ['court_wall_e', 'court_wall_s']) {
      const s = byId.get(id);
      if (s) buildWall(G, s.points[0], s.points[1], 0, s.h, s.width, { copingDy: id === 'court_wall_s' ? -0.012 : 0 }); // (copings meet on the corner)
    }
    // the port wall: tufa blocks, a piperno parapet, the iron bollards of the old quay behind it
    const pw = byId.get('port_wall');
    if (pw) {
      const [a, b] = pw.points;
      G.box('np_tufaB', (a[0] + b[0]) / 2, (pw.h - 0.6) / 2, a[1], Math.abs(b[0] - a[0]) + 80, pw.h - 0.6, pw.width, 0, 0.9);
      G.box('np_piperno', (a[0] + b[0]) / 2, pw.h - 0.3, a[1] - 0.2, Math.abs(b[0] - a[0]) + 80, 0.6, pw.width - 0.4, 0, 0.92);
      // the quay beyond, 6 cm over the terrain under it (flush, the two flickered)
      G.box('np_basalt', (a[0] + b[0]) / 2, -0.24, a[1] + 8, Math.abs(b[0] - a[0]) + 80, 0.6, 12, 0, 0.8);
      for (let x = a[0] - 30; x < b[0] + 30; x += 9) G.cyl('np_iron', x, 0.06, a[1] + 4, 0.22, 0.18, 0.7, 8, 0.7);
    }
    build(G, 'e02:fabric', 0);
  }
  if (due()) yield;

  // ---------------------------------------------------------------- props
  {
    const G = new Geo('e02:props');
    for (const s of structs) {
      const y = levelY(s);
      switch (s.variant) {
        case 'tram_burning': buildTram(G, s); break;
        case 'barricade_junk': buildBarricade(G, s); break;
        case 'fountain_statue': buildFountain(G, s, y); break;
        case 'genset_wehrmacht': buildGenerator(G, s, y); break;
        case 'motor_pool_tent': buildTent(G, s, y); break;
        case 'kennel_plank': buildKennel(G, s, y); break;
        case 'handcart_naples': buildHandcart(G, s); break;
        case 'fish_stall': buildStall(G, s); break;
        case 'rifles_leaning': buildRifles(G, s); break;
        default: break;
      }
    }
    // washing across the alleys (cosmetic): lines between facing facades with sheets and shirts pegged on them
    for (const [x0, z0, x1, z1, y] of WASHING) washingLine(G, [x0, z0], [x1, z1], y);
    // wayside shrines in the walls: a painted Madonna under a little roof, candles in jars below (glow)
    for (const [x, z, y, rot] of SHRINES) shrine(G, x, z, y, rot, lit);
    build(G, 'e02:props', 0);
  }
  if (due()) yield;

  // ---------------------------------------------------------------- light: shutters glowing, candles; the searchlight's beam
  const glow = glowMesh(lit, 0xffa04a, 1.6, 'e02:glow');
  if (glow) root.add(glow);
  searchlight(w, root, byId.get('sl_deck'));
  vanAerial(w);
  sea(root, W, D);
}

/** Washing lines [x0, z0, x1, z1, y] strung across the alleys and the cross-alley. */
const WASHING = [
  [24, 97, 27, 97.5, 7.2], [24, 112, 27, 111.5, 6.4], [24, 101, 27, 101, 10.6],
  [48.5, 109, 52, 109.5, 7.6], [48.5, 113, 52, 112.6, 10.2], [46, 100.5, 48.5, 100.5, 8.8],
  [74, 96, 77, 96.6, 7.0], [74, 113, 77, 112.4, 8.2], [74, 100, 77, 100, 10.8],
  [12, 104, 12.5, 107, 6.8], [36, 104, 36.5, 107, 7.4], [62, 104, 61.4, 107, 8.0], [88, 104, 88, 107, 6.6],
  [36, 46, 40, 46.4, 12.2], [80, 36, 86, 36.5, 13.6], [80, 46, 86, 45.4, 11.4], [9.5, 8, 15.5, 8.5, 12.4],
];
/** Shrines [x, z, y (base), facing rot] on walls by the alleys. */
const SHRINES = [[26.9, 100.3, 0, Math.PI], [52.1, 110.4, 0, 0], [74.1, 96.4, 0, Math.PI], [46.2, 95.2, 0, 0]];

function washingLine(G, a, b, y) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(L / 0.55));
  const p = (t) => [a[0] + (b[0] - a[0]) * t, y - Math.sin(Math.PI * t) * 0.35, a[1] + (b[1] - a[1]) * t];
  for (let k = 0; k < n; k++) slab3(G, 'np_iron', p(k / n), p((k + 1) / n), 0.015, 0.015, 0.6);
  const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
  let seed = Math.abs(Math.round(a[0] * 17 + a[1] * 31 + y * 7));
  const R = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0.12, k = 0; t < 0.9; t += 0.11 + R() * 0.12) {
    const [x, yy, z] = p(t), wdt = 0.35 + R() * 0.55, hh = 0.45 + R() * 0.6;
    // (neighbours hang either side of the line: two overlapping sheets in one plane flickered)
    const off = ((k++ % 3) - 1) * 0.03, nx = -Math.sin(rot) * off, nz = Math.cos(rot) * off;
    G.box(R() < 0.75 ? 'np_cloth' : 'np_clothB', x + nx, yy - hh / 2 - 0.02, z + nz, wdt, hh, 0.02, rot, 0.7 + R() * 0.3);
  }
}

function shrine(G, x, z, y, rot, lit) {
  const c = Math.cos(rot), s = Math.sin(rot), out = (d) => [x + c * d, z + s * d];
  const [px, pz] = out(0.12);
  G.box('np_marble', px, y + 2.1, pz, 0.22, 1.1, 0.8, rot, 0.95); // frame
  const [qx, qz] = out(0.215); // (15 mm proud of the frame's face: it was in its plane)
  G.box('np_tufaR', qx, y + 2.15, qz, 0.06, 0.8, 0.6, rot, 0.9); // the painted panel
  const [rx, rz] = out(0.32);
  G.box('np_tile', rx, y + 2.75, rz, 0.5, 0.08, 1.0, rot, 0.8); // its little roof
  G.box('np_marble', rx, y + 1.5, rz, 0.4, 0.1, 0.7, rot, 0.95); // the shelf
  for (const k of [-0.2, 0, 0.2]) {
    const ox = -s * k, oz = c * k;
    lit.push({ x: rx + ox, y: y + 1.62, z: rz + oz, sx: 0.06, sy: 0.12, sz: 0.06 });
  }
}

/** The roof searchlight: its lamp turns with c4's eyes; a faint beam and a cold spot light sweep the piazza until he is out. */
function searchlight(w, root, deck) {
  if (!deck) return;
  const x = deck.x + 0.6, z = deck.z - 0.6, y = deck.deckY ?? 16;
  const base = buildSearchlight({ x, z, y0: y, rot: 0, elev: -0.3, seed: 'e02-sl' });
  root.add(base);
  const beamGeo = new THREE.CylinderGeometry(0.35, 7.5, 44, 24, 1, true);
  beamGeo.translate(0, -22, 0);
  beamGeo.rotateZ(Math.PI / 2); // along +x, starting at the lamp
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xbfd2ff, transparent: true, opacity: 0.07, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.name = 'e02:beam';
  beam.renderOrder = 5;
  const pivot = new THREE.Group();
  pivot.position.set(x, y + 1.25, z);
  pivot.add(beam);
  root.add(pivot);
  const spot = new THREE.SpotLight(0xc8d8ff, 0, 60, (11 * Math.PI) / 180, 0.6, 1.2);
  spot.position.set(x, y + 1.25, z);
  spot.castShadow = false;
  root.add(spot);
  root.add(spot.target);
  const tilt = -0.36; // the beam dips to the piazza
  beam.onBeforeRender = () => {
    const e = w.byId?.('c4');
    const on = !w._e02BeamOff && e && e.alive !== false && !e.ko;
    beam.material.opacity = on ? 0.07 : 0;
    spot.intensity = on ? 70 : 0;
    if (!on) return;
    const h = coneAt(e, w.time)?.heading ?? e.heading;
    pivot.rotation.set(0, -h, tilt);
    spot.target.position.set(x + Math.cos(h) * 30, y - 10, z + Math.sin(h) * 30);
    spot.target.updateMatrixWorld();
  };
}

/** The DF van's loop aerial on its roof (follows the van). */
function vanAerial(w) {
  const v = w.byId?.('van_df');
  const o = v?.object3d;
  if (!o) return;
  const g = new THREE.Group();
  g.name = 'e02:loop';
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.6, metalness: 0.5 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 6), iron);
  mast.position.set(-0.4, 2.55, 0);
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 20), iron);
  loop.position.set(-0.4, 3.3, 0);
  loop.rotation.y = Math.PI / 2;
  g.add(mast, loop);
  g.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; } });
  o.add(g);
}

/** The bay beyond the port wall: a dark sheet of water out to the fog. */
function sea(root, W, D) {
  const geo = new THREE.PlaneGeometry(W + 400, 260);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.18, metalness: 0.2 }));
  m.position.set(W / 2, -1.2, D + 2 + 130);
  m.name = 'e02:sea';
  m.receiveShadow = true;
  root.add(m);
}
