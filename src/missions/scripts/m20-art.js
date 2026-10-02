/**
 * M20 "Operation Valhalla" art pass (browser only): Gundelfingen castle's masonry, drawn by art/castle-kit.js from
 * the mission's own gameplay data (wall polylines, level polygons, gate and tower footprints), so nothing a unit
 * stands on, hides behind or climbs moves. Each structure's placeholder mesh is hidden and its detailed visual added
 * to the same Object3D (lifts, destruction and the clip audit keep working on it).
 *  - curtain walls: limestone ashlar on a battered rubble talus, cordon, corbel table, crenellated parapet with
 *    coping, arrow slits, spouts, corbelled bartizans with slate cones on the angles; the crag wall under the HQ;
 *  - terraces / bastions / the range roof: masonry retaining walls with a plinth and coping, flagged tops;
 *  - gatehouses, the turret, towers, the range block, stair towers, bridges, the water gate (castle-kit builders).
 * @module missions/scripts/m20-art
 */
import { buildCurtain, buildTerrace, buildParapet, buildTwinGatehouse, buildRoundTower, buildRange, buildStairTower, buildInnerGate, buildMoatBridge, buildWaterGate, buildStairFlight, buildLadder, buildWing, buildOuthouse, buildOpenShed, buildFieldWagon, buildWell, buildBasin, setCastleFrost, Geo } from '../../art/castle-kit.js';
import { libraryVisual } from '../../art/building-props.js';
import { buildCliff } from '../../art/dressing.js';
import { buildFlakTowed, buildFlakEmplacement, buildFieldGun, buildTargetFrame, buildBulletStop, buildSearchlight, buildRangeBerm, buildLeverBox } from '../../art/field-guns.js';

const PARAPET_H = 1.4; // == m20_operation_valhalla.js PARAPET_H

/** The castle's centre (outward normals of the curtain point away from it). */
export const CASTLE_INSIDE = [88, 72];

/** Replace structure `id`'s placeholder children by `visual` (world coordinates). */
export function swapVisual(w, id, visual) {
  const o = w.structures?.get?.(id)?.object3d;
  if (!o || !visual) return false;
  for (const c of o.children) c.visible = false;
  o.visible = true; // the level prisms' placeholders were hidden whole
  o.updateMatrixWorld(true);
  visual.applyMatrix4(o.matrixWorld.clone().invert());
  visual.name = `m20art:${id}`;
  o.add(visual);
  o.userData.m20Art = true;
  return true;
}

/** Facade spans of the N range (local u, rot 0) buried by what stands against it: T_nw (y 7), the N stair tower. */
function rangeHidden(m, r) {
  const out = [];
  for (const s of m.structures || []) {
    if (s.id === 't_nw') { const xs = s.points.map((p) => p[0]); out.push([Math.min(...xs) - r.x, Math.max(...xs) - r.x, s.h]); }
    if (s.id === 'blk_n') out.push([s.x - s.w / 2 - r.x, s.x + s.w / 2 - r.x, s.h]);
  }
  return out;
}

const inPoly = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/** Gate bodies (local rects) and the levels a curtain runs into: its ends stop at their faces (no buried masonry). */
function bodiesOf(m) {
  const gates = (m.structures || []).filter((s) => s.type === 'castle_gate').map((s) => ({ s, c: Math.cos(s.rot), n: Math.sin(s.rot) }));
  const levels = (m.structures || []).filter((s) => s.type === 'cliff' && /^t_(n|ne)$/.test(s.id || '')).map((s) => s.points);
  return (p) => gates.some(({ s, c, n }) => { const dx = p[0] - s.x, dz = p[1] - s.z, u = dx * c + dz * n, v = -dx * n + dz * c; return Math.abs(u) < s.w / 2 - 0.15 && Math.abs(v) < s.d / 2 + 2.5; })
    || levels.some((poly) => inPoly(p, poly));
}
/** Pull the two ends of a polyline back along their segments until they leave `inside` (0.05 m steps). */
function trimEnds(points, inside) {
  const pts = points.map((q) => q.slice());
  for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]]) {
    const a = pts[i], b = pts[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = 0;
    while (t < L * 0.9 && inside([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L])) t += 0.05;
    pts[i] = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L];
  }
  return pts;
}

/** Curtain stretches (castle_wall with a crenellated variant) and the crag wall under the HQ terrace. */
function curtains(w, m) {
  let n = 0;
  const inside = bodiesOf(m);
  for (const s of m.structures || []) {
    if (s.type !== 'castle_wall' || !s.points) continue;
    const crag = /crag/.test(s.variant || '');
    const v = buildCurtain(crag ? s.points : trimEnds(s.points, inside), {
      seed: s.id, width: s.width ?? 5, h: s.h ?? 7, inside: crag ? [s.points[0][0], 60] : CASTLE_INSIDE,
      base: crag ? 0 : -1.6, talus: crag ? 0.6 : 1.1, bartizans: !crag,
      gaps: crag ? [[15, 79, 2.2]] : [], name: `curtain:${s.id}`,
    });
    if (swapVisual(w, s.id, v)) n++;
  }
  return n;
}

/** Plan rects of the solid bodies the terraces abut (the château, its wing, the N range): no doubled faces. */
function bodyRects(m) {
  return (m.structures || []).filter((s) => ['hq', 'hq_wing', 'n_range'].includes(s.id)).map((s) => [s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
}

/** The raised levels (`cliff` ids t_*): masonry terraces; the 1-cell parapet strips: balustrades / crenels. */
function levels(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (s.type !== 'cliff' || !/^t_/.test(s.id || '')) continue;
    let v;
    // parapet strips stand PARAPET_H (1.4 m) above their level; the forecourt balustrade (t_par_hq_b*) is open work
    if (/^t_par/.test(s.id)) v = buildParapet(s.points, s.h - PARAPET_H, s.h, { seed: s.id, style: /_hq_b/.test(s.id) ? 'balustrade' : 'crenel' });
    else v = buildTerrace(s.points, s.h, { seed: s.id, top: s.id === 't_hq' ? 'setts' : 'flags', skip: bodyRects(m) });
    if (swapVisual(w, s.id, v)) n++;
  }
  return n;
}

/** The SW and SE gatehouses (twin towers, tops on the wall walk). */
function gates(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (s.type !== 'castle_gate') continue;
    if (/inner/.test(s.variant || '')) {
      // the tunnel between the gameplay towers (±w/3, w/3 wide); the W tower is T_wb's masonry (y 4)
      const t = s.w / 2 - s.w / 3;
      n += swapVisual(w, s.id, buildInnerGate({ x: s.x, z: s.z, rot: s.rot, d: s.d, tunnel: [-t, t], tower: [t + 0.1, s.w / 2], towerTop: s.h + 1.5, hallTop: s.h - 0.8, seed: s.id })) ? 1 : 0;
    } else if (/twin_tower/.test(s.variant || '')) n += swapVisual(w, s.id, buildTwinGatehouse({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, walkY: 7, seed: s.id, name: `gate:${s.id}` })) ? 1 : 0;
  }
  return n;
}

/** The HQ turret (round, crenellated deck), the N range, the stair towers. */
function towers(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    let v = null;
    const y0 = s.baseY ?? 0;
    if (s.id === 'turret') v = buildRoundTower({ x: s.x, z: s.z, r: s.w / 2, y0: 13, deckY: s.deckY ?? s.h, door: Math.PI / 2, seed: s.id });
    else if (/castle_range/.test(s.variant || '')) v = buildRange({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, h: s.h, roofed: false, hidden: rangeHidden(m, s), seed: s.id }); // T_n is its roof
    else if (/stair_(tower|block)/.test(s.variant || '')) v = buildStairTower({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, h: s.h, y0, seed: s.id });
    else if (s.variant === 'bartizan_round_decor') v = new Geo(s.id).build('bartizan'); // the curtain draws the S-corner bartizan
    else if (s.variant === 'chateau_wing') v = buildWing({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, h: s.h, y0, faces: ['S', 'E'], seed: s.id });
    else if (s.variant === 'outhouse') v = buildOuthouse({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, seed: s.id });
    else if (/open_shed/.test(s.variant || '')) v = buildOpenShed({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, h: s.h, seed: s.id });
    else if (s.variant === 'house_turret_small') v = buildRoundTower({ x: s.x, z: s.z, r: s.w / 2, y0: 0, deckY: s.h - 1.5, door: Math.PI / 2, roof: 'cone', seed: s.id });
    else if (s.type === 'train_car') v = buildFieldWagon({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, h: s.h, covered: /covered/.test(s.variant || ''), shells: /shells/.test(s.variant || ''), seed: s.id });
    else if (s.variant === 'flak38_quad_towed') v = buildFlakTowed({ x: s.x, z: s.z, rot: s.rot ?? 0, seed: s.id });
    else if (s.variant === 'flak38_quad_round_emplacement') v = buildFlakEmplacement({ x: s.x, z: s.z, r: s.r, h: s.h, y0, seed: s.id });
    else if (s.variant === 'towed_field_gun') v = buildFieldGun({ x: s.x, z: s.z, rot: s.rot ?? 0, y0, seed: s.id });
    else if (s.variant === 'target_frame_silhouette') v = buildTargetFrame({ x: s.x, z: s.z, rot: Math.atan2(89 - s.z, 104.5 - s.x) + Math.PI, w: s.w, h: s.h, seed: s.id }); // faces the bench
    else if (s.variant === 'bullet_stop_timber_sandbag') v = buildBulletStop(s.points, { h: s.h, width: s.width, seed: s.id });
    else if (s.type === 'searchlight') v = buildSearchlight({ x: s.x, z: s.z, rot: Math.atan2(s.z - 72, s.x - 88), elev: 0.3, y0, seed: s.id }); // aimed out over the walls
    else if (s.type === 'firing_range') v = buildRangeBerm({ x: s.x, z: s.z, rot: s.rot ?? 0, w: s.w, d: s.d, h: s.h, cuts: crossingStops(m, s), seed: s.id });
    else if (s.type === 'lever') { const lb = buildLeverBox({ x: s.x, z: s.z, rot: s.rot ?? 0, seed: s.id }); v = lb.group; leverLamp(w, s, lb.lamp); }
    else if (s.type === 'well') v = buildWell({ x: s.x, z: s.z, r: s.r ?? 0.9, rot: s.rot ?? 0, seed: s.id });
    else if (s.type === 'bridge') v = buildMoatBridge({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, lanterns: /lantern/.test(s.variant || ''), seed: s.id });
    else if (s.type === 'water_gate') v = buildWaterGate({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, top: 7, grateW: -s.d / 2 + 0.5, seed: s.id }); // outer face = −w (east)
    if (v && swapVisual(w, s.id, v)) n++;
  }
  return n;
}

/** Bullet-stop segments running through a rect structure (the range berm stops short of them on both sides). */
function crossingStops(m, r) {
  const c = Math.cos(r.rot ?? 0), sn = Math.sin(r.rot ?? 0);
  const inside = ([x, z]) => { const dx = x - r.x, dz = z - r.z; return Math.abs(dx * c + dz * sn) < r.w / 2 && Math.abs(-dx * sn + dz * c) < r.d / 2; };
  const out = [];
  for (const s of m.structures || []) {
    if (!/bullet_stop/.test(s.variant || '') || !s.points) continue;
    for (let k = 0; k + 1 < s.points.length; k++) {
      const [a, b] = [s.points[k], s.points[k + 1]];
      let hit = false;
      for (let t = 0; t <= 1.0001 && !hit; t += 0.05) hit = inside([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (hit) out.push([a, b, (s.width ?? 0.8) / 2 + 0.16]);
    }
  }
  return out;
}

/** The set-piece lever's flashing red glass (setpiece-device lamp) moved into the lever art's lamp housing; its
 *  placeholder post and box hidden (the blink keeps running on the same mesh). */
function leverLamp(w, s, at) {
  for (const it of w.interactables || []) {
    const g = it.object3d, lamp = g?.userData?.lamp;
    if (it.interactKind !== 'device' || !lamp || Math.hypot(it.x - s.x, it.z - s.z) > 1.5) continue;
    for (const ch of g.children) if (ch !== lamp) ch.visible = false;
    lamp.position.set(at[0] - g.position.x, at[1] - g.position.y, at[2] - g.position.z);
    lamp.scale.setScalar(0.85);
  }
}

/** The water gate's grating rides up (2.6 m) once the range lever opens it (set-piece `wg_ctl`). */
function animateWaterGate(w) {
  const o = w.structures?.get?.('water_gate')?.object3d, grate = o?.getObjectByName?.('grate');
  if (!grate) return;
  w.onBelTick((dt) => {
    const open = !!w.setpieces?.get?.('wg_ctl')?.open, to = open ? 2.6 : 0;
    if (grate.position.y !== to) grate.position.y = Math.abs(to - grate.position.y) < 0.02 ? to : grate.position.y + Math.sign(to - grate.position.y) * Math.min(Math.abs(to - grate.position.y), 0.9 * dt);
  });
}

/**
 * The two V2s (o2): the library's V2 on its Meillerwagen (tools/blender/military/scripts/v2_meillerwagen.py), fitted on
 * the trailer footprint; a hit swaps in the burnt-out wreck (building-props destroy hook).
 */
function rockets(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (s.type !== 'v2_rocket') continue;
    const lib = libraryVisual('v2_rocket', { ...s, asset: s.id === 'v2b' ? 'v2_meillerwagen_b' : 'v2_meillerwagen' }, { theater: m.theater, missionId: m.id });
    if (!lib) continue;
    const o = w.structures?.get?.(s.id)?.object3d;
    if (swapVisual(w, s.id, lib.object3d)) {
      n++;
      if (o) o.userData.destroy = () => lib.object3d.userData.destroy?.();
    }
  }
  return n;
}

/** Every `ladders[]` link: stone flights (kind 'stairs') and timber ladders (planks stay m20.js's). */
function links(w, m) {
  const G = new Geo('m20:links');
  let n = 0;
  for (const l of m.ladders || []) {
    if (l.kind === 'plank') continue;
    const a = { x: l.x, y: l.y ?? 0, z: l.z }, b = { x: l.top[0], y: l.top[2] ?? 0, z: l.top[1] };
    if (l.kind === 'stairs') buildStairFlight(a, b, { G, width: 1.8 });
    else buildLadder(a, b, { G, heading: l.heading });
    n++;
  }
  // the GB's climbs: the cast-iron downpipe of `cl_in` ("down the drainpipe" [fd]) with its hopper and brackets
  for (const c of m.climbLinks || []) {
    if (c.id !== 'cl_in') continue;
    const [x, z] = [c.a[0], c.a[1] + 1.12], y0 = c.b[2], y1 = c.a[2]; // T_hq's S face (z 78), on the bastion side
    G.cyl('iron', x, y0, z, 0.08, 0.08, y1 - y0 + 0.2, 8, 0.45);
    G.cyl('iron', x, y1 + 0.1, z, 0.1, 0.22, 0.3, 8, 0.45);
    for (let y = y0 + 0.6; y < y1; y += 1.1) G.box('iron', x, y, z - 0.1, 0.24, 0.05, 0.2, 0, 0.4);
    G.box('iron', x, y0 + 0.08, z + 0.15, 0.16, 0.08, 0.35, 0, 0.45);
  }
  const g = G.build('m20art:links', { ground: 0 });
  w.scene.add(g);
  return n;
}

/**
 * The crag under the HQ and the W wall: the cliff dressing fans its broken top over the polygon, and the crag's
 * L-shape (x 0-4.5 along the W wall) then roofed the HQ terrace in rock. Drawn here as convex parts (visual only;
 * the grid keeps the authored polygon).
 */
const CRAG_X0 = -12; // the rock mass runs on past the W map edge (x 0) into the scenery: no sheer cut face at the edge
const CRAG_PARTS = [
  [[CRAG_X0, 10], [40, 10], [40, 14], [CRAG_X0, 14]], [[CRAG_X0, 14], [38, 14], [38, 32], [CRAG_X0, 32]], [[CRAG_X0, 32], [27, 32], [27, 38], [CRAG_X0, 38]],
  [[CRAG_X0, 38], [4.5, 38], [4.5, 79], [CRAG_X0, 79]],
  // under the crag wall (cw_w, x 4-22) the wall itself is the face down to the ground: a crag strip there only poked
  // loose rock wedges through the wall foot — the rock stops at the wall's W end
  [[CRAG_X0, 79], [4.5, 79], [4.5, 82], [CRAG_X0, 82]],
];
function crag(w, m) {
  const s = (m.structures || []).find((q) => q.id === 'crag');
  if (!s) return 0;
  const g = new Geo('crag').build('crag');
  CRAG_PARTS.forEach((points, k) => g.add(buildCliff({ id: `crag${k}`, points, h: s.h, x: 0, z: 0, rot: 0 })));
  return swapVisual(w, 'crag', g) ? 1 : 0;
}

/**
 * The range's fire-water basin (terrain water T4, a plain rect in the grid): masonry walls, coping, apron, silted
 * floor; its E side stays open where the channel runs to the water gate.
 */
function basin(w, m) {
  const rects = (m.terrain || []).filter((t) => t.type === 'rect' && t.terrain === 'water');
  const pool = rects.find((t) => t.w >= 3 && t.d >= 3);
  if (!pool) return 0;
  const gaps = rects.filter((t) => t !== pool && Math.abs(t.x - (pool.x + pool.w)) < 0.01).map((t) => ['E', t.z, t.z + t.d]);
  const g = buildBasin(pool, { gaps, seed: 'pool' });
  g.name = 'm20art:pool';
  w.scene.add(g);
  return 1;
}

/** Build every M20 art visual once per world. */
export function buildM20Art(w) {
  if (!w.scene || w._m20Art) return;
  w._m20Art = true;
  const m = w.mission || {};
  setCastleFrost(m.variant === 'frost' ? 0.28 : 0); // 11 Feb 1945: hoar frost on the tops, no snow (dossier §2)
  const stats = { curtains: curtains(w, m), levels: levels(w, m), gates: gates(w, m), towers: towers(w, m), links: links(w, m), rockets: rockets(w, m), crag: crag(w, m), basin: basin(w, m) };
  setCastleFrost(0);
  animateWaterGate(w);
  w._m20ArtStats = stats;
}

