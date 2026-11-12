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
import { segFrame, buildCurtain, buildTerrace, buildParapet, buildTwinGatehouse, buildRoundTower, buildRange, buildStairTower, buildInnerGate, buildMoatBridge, buildWaterGate, buildStairFlight, buildWing, buildOuthouse, buildOpenShed, buildFieldWagon, buildWell, buildBasin, setCastleFrost, setCastleTone, Geo } from '../../art/castle-kit.js';
import { libraryVisual } from '../../art/building-props.js';
import { buildCliff } from '../../art/dressing.js';
import { due, runSync } from '../../engine/slice.js';
import { buildFlakTowed, buildFlakEmplacement, buildFieldGun, buildTargetFrame, buildBulletStop, buildSearchlight, buildRangeBerm, buildLeverBox } from '../../art/field-guns.js';
import { M20_DRESSING_BUILDERS } from '../../art/m20-dressing.js';
import { buildMoatWorks, buildTowers, gateCrown, drawbridge, bridgeEnds, buildKeep, buildKeepRuin, buildBailey, buildGuardRuin, BAILEY_PLAN, buildRingTarget, rampartParapet, towerPlan } from '../../art/m20-castle.js';
import * as THREE from 'three';
import { setGameplayGeometry } from '../../engine/gameplay-geometry.js';
import { buildChurch, churchFrame, planOf } from '../../art/m20-church.js';
import { buildOccupation, buildSentryBox, KEEP_FLAG } from '../../art/m20-occupation.js';
import { makeFlag, makeBanner } from '../../art/flags.js';
import { buildAge } from '../../art/m20-age.js';

const PARAPET_H = 1.4; // == m20_operation_valhalla.js PARAPET_H
const BALUSTRADE_H = 1.7; // == m20_operation_valhalla.js BALUSTRADE_H (the forecourt screen hides a standing man)

/** The castle's centre (outward normals of the curtain point away from it). */
export const CASTLE_INSIDE = [88, 72];

/**
 * Replace structure `id`'s placeholder children by `visual` (world coordinates). `ready`: a library model's load (it may
 * still be loading: Game.loadMission waits for it before it measures the art — a slow link left M20's V2s unstamped).
 */
export function swapVisual(w, id, visual, ready = null) {
  const o = w.structures?.get?.(id)?.object3d;
  if (!o || !visual) return false;
  for (const c of o.children) c.visible = false;
  o.visible = true; // the level prisms' placeholders were hidden whole
  o.updateMatrixWorld(true);
  visual.applyMatrix4(o.matrixWorld.clone().invert());
  visual.name = `m20art:${id}`;
  o.add(visual);
  o.userData.m20Art = true;
  o.userData.artSwapped = true; // (Game.loadMission measures its standing visuals again on this art)
  if (ready) o.userData.artReady = ready;
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
/**
 * The drawn curtain without its parapet and merlons where a flanking D tower stands astride the wall's line (the tower's
 * body would cut them: art intersection audit) and without its walk's top over the water gate (two coplanar floors):
 * those triangles are collapsed in a drawn copy; gameplay keeps measuring the built geometry (engine/gameplay-geometry.js),
 * so nothing a walker stands on, hides behind or sees past moves.
 */
/** The landing at a moat bridge's outer end: from this far past the bridge's length (the deck's planks end 0.58 m past
 *  it) to this far (art/m20-castle.js bridgeEnds; the approach roads' drawn centre lines start at its outer edge). */
export const BRIDGE_LANDING = [0.6, 1.5];
/**
 * The gatehouse a moat bridge's gate (−u) end runs into: the bridge's axis along the gate's passage. uFace: the bridge u
 * of the gate's outer face; uApron: of the passage floor's outer edge (castle-kit buildTwinGatehouse: 0.3 m out).
 */
export function bridgeGate(m, b) {
  const c = Math.cos(b.rot ?? 0), sn = Math.sin(b.rot ?? 0);
  for (const g of m.structures || []) {
    if (g.type !== 'castle_gate' || /inner/.test(g.variant || '')) continue;
    const nx = -Math.sin(g.rot ?? 0), nz = Math.cos(g.rot ?? 0);
    if (c * nx + sn * nz < 0.99) continue;
    const bw = (b.x - g.x) * nx + (b.z - g.z) * nz, bu = (b.x - g.x) * Math.cos(g.rot ?? 0) + (b.z - g.z) * Math.sin(g.rot ?? 0);
    if (Math.abs(bu) > 0.5 || bw - b.w / 2 > g.d / 2 + 0.5) continue;
    return { gate: g, uFace: g.d / 2 - bw, uApron: g.d / 2 + 0.3 - bw, passage: 4.5 };
  }
  return null;
}
/** Draw `drawn` in place of the built group `g` mesh for mesh (same materials), gameplay measuring `g`'s geometry
 *  (engine/gameplay-geometry.js): a visual refinement that moves nothing a unit stands on, sees past or bumps into. */
function drawAs(g, drawn) {
  const by = new Map();
  drawn.traverse((d) => { if (d.isMesh) by.set(d.name, d); });
  g.traverse((mesh) => {
    const d = mesh.isMesh && by.get(mesh.name);
    if (!d) return;
    setGameplayGeometry(d.geometry, mesh.geometry);
    mesh.geometry = d.geometry;
  });
}
const inPolyXZ = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
function dropInside(g, cuts, h, tops, outerSide = () => true) {
  g.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const orig = mesh.geometry, pos = orig.attributes.position, idx = orig.index;
    if (idx) return; // (castle-kit meshes are triangle soups)
    let hit = false;
    const out = pos.array.slice();
    // a small box (castle-kit segBox / box: 10 triangles on 8 corners — a merlon, a coping stone, a corbel) is kept or
    // dropped whole: decided triangle by triangle, a merlon astride a tower's edge was left as an open wedge (review
    // 2026-11-11)
    const boxAt = (t) => {
      if (t + 30 > pos.count) return null;
      const keys = new Set();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let v = t; v < t + 30; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        keys.add(`${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`);
        if (keys.size > 8) return null;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      return keys.size === 8 && Math.max(x1 - x0, z1 - z0) < 2.5 ? { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, ymin: y0, ymax: y1 } : null;
    };
    for (let t = 0; t < pos.count; t += 3) {
      const b = boxAt(t);
      if (b) {
        const drop = b.ymin > h - 1.5 && b.ymax > h - 1.3 && cuts.some((c) => Math.hypot(b.cx - c.x, b.cz - c.z) < c.r) && outerSide(b.cx, b.cz);
        if (drop) { for (let v = t; v < t + 30; v++) { out[v * 3] = b.cx; out[v * 3 + 1] = -60; out[v * 3 + 2] = b.cz; } hit = true; }
        t += 27; // (the loop adds the last 3)
        continue;
      }
      let cx = 0, cz = 0, ymin = Infinity, ymax = -Infinity;
      for (let k = 0; k < 3; k++) { const y = pos.getY(t + k); cx += pos.getX(t + k) / 3; cz += pos.getZ(t + k) / 3; ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
      // (the parapet, its merlons and coping, and the corbel table and string course under it: everything the tower's
      // body would cut, from 1.5 m under the walk up; the walk's own top and the inner kerb stay)
      const parapet = ymin > h - 1.5 && ymax > h - 1.3 && !(Math.abs(ymin - h) < 0.01 && Math.abs(ymax - h) < 0.01) && cuts.some((c) => Math.hypot(cx - c.x, cz - c.z) < c.r) && outerSide(cx, cz);
      const inTop = (q) => (q.poly ? inPolyXZ(cx, cz, q.poly) : cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1);
      const top = Math.abs(ymin - h) < 0.01 && Math.abs(ymax - h) < 0.01 && tops.some(inTop);
      if (!parapet && !top) continue;
      for (let k = 0; k < 3; k++) { out[(t + k) * 3] = cx; out[(t + k) * 3 + 1] = -60; out[(t + k) * 3 + 2] = cz; }
      hit = true;
    }
    if (!hit) return;
    const drawn = orig.clone();
    drawn.setAttribute('position', new THREE.BufferAttribute(out, 3));
    drawn.computeBoundingSphere();
    setGameplayGeometry(drawn, orig);
    mesh.geometry = drawn;
  });
}

function* curtains(w, m) {
  let n = 0;
  const inside = bodiesOf(m);
  // the D towers' bodies over the curtains' outer edges (towerPlan: the arc centre on the outer face, its gallery r + 0.45)
  const towerCuts = towerPlan(m).filter((t) => t.kind === 'd').map((t) => { const [x, z] = t.F.at(t.u, 2.5); return { x, z, r: t.r + 0.9 }; });
  // the water gate's top (its own floor at the walk's height: the curtains' ends over it are not drawn twice)
  const waterTops = (m.structures || []).filter((s) => s.type === 'water_gate').map((s) => { const c = Math.abs(Math.cos(s.rot ?? 0)) > 0.5; const hw = (c ? s.w : s.d) / 2, hd = (c ? s.d : s.w) / 2; return { x0: s.x - hw, x1: s.x + hw, z0: s.z - hd, z1: s.z + hd }; });
  // (and the gatehouses' tops, where a curtain's walk runs onto the gate's own: the gate's floor is drawn there)
  for (const s of (m.structures || []).filter((q) => q.type === 'castle_gate' && !/inner/.test(q.variant || ''))) {
    const c = Math.cos(s.rot ?? 0), sn = Math.sin(s.rot ?? 0), pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [s.x + (a * s.w / 2) * c - (b * s.d / 2) * sn, s.z + (a * s.w / 2) * sn + (b * s.d / 2) * c]);
    // (an axis-aligned box inside the rotated rect would miss its corners: the rect's own test)
    waterTops.push({ poly: pts, x0: -Infinity, x1: Infinity, z0: -Infinity, z1: Infinity });
  }
  for (const s of m.structures || []) {
    if (due()) yield;
    if (s.type !== 'castle_wall' || !s.points) continue;
    const crag = /crag/.test(s.variant || '');
    const v = buildCurtain(crag ? s.points : trimEnds(s.points, inside), {
      seed: s.id, width: s.width ?? 5, h: s.h ?? 7, inside: crag ? [s.points[0][0], 60] : CASTLE_INSIDE,
      base: crag ? 0 : -1.6, talus: crag ? 0.6 : 1.1, bartizans: !crag,
      gaps: crag ? [[15, 79, 2.2]] : [], name: `curtain:${s.id}`,
    });
    if (!crag) {
      // (the outer half of this wall only: its inner kerb and walk edge stay whole)
      const segs = s.points.slice(0, -1).map((p, k) => segFrame(p, s.points[k + 1], CASTLE_INSIDE));
      const outerSide = (x, z) => { let best = null, bd = Infinity; for (const F of segs) { const dx = x - F.at(0, 0)[0], dz = z - F.at(0, 0)[1], u = dx * F.t[0] + dz * F.t[1], w = dx * F.n[0] + dz * F.n[1]; const d = u < 0 ? -u : u > F.L ? u - F.L : 0; if (d < bd) { bd = d; best = w; } } return best == null || best > 0.6; };
      dropInside(v, towerCuts, s.h ?? 7, waterTops, outerSide);
    }
    if (swapVisual(w, s.id, v)) n++;
  }
  return n;
}

/** Plan rects of the solid bodies the terraces abut (the château, its wing, the N range): no doubled faces. */
function bodyRects(m) {
  return (m.structures || []).filter((s) => ['hq', 'hq_wing', 'n_range'].includes(s.id)).map((s) => [s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]);
}

/** Where the mission's ladders, stairs and climbs cross a parapet strip (their middle inside it): [[x, z], …]. */
function waysOver(m, poly) {
  const ways = [...(m.ladders || []).map((l) => [[l.x, l.z], [l.top[0], l.top[1]]]), ...(m.climbLinks || []).map((c) => [[c.a[0], c.a[1]], [c.b[0], c.b[1]]])];
  const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const out = [];
  for (const [p, q] of ways) {
    let sx = 0, sz = 0, n = 0;
    for (let k = 0; k <= 80; k++) { const t = k / 80, x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t; if (inside(x, z)) { sx += x; sz += z; n++; } }
    if (n) out.push([sx / n, sz / n]);
  }
  return out;
}

/** The raised levels (`cliff` ids t_*): masonry terraces; the 1-cell parapet strips: balustrades / crenels. */
function* levels(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (due()) yield;
    if (s.type !== 'cliff' || !/^t_/.test(s.id || '')) continue;
    let v;
    // parapet strips stand PARAPET_H (1.4 m) above their level; the forecourt screen (t_par_hq_b*) BALUSTRADE_H, a solid
    // wall (it hides a man on his feet: open work would show what the guards cannot see); gaps where a way crosses
    if (/^t_par/.test(s.id)) { const screen = /_hq_b/.test(s.id); v = buildParapet(s.points, s.h - (screen ? BALUSTRADE_H : PARAPET_H), s.h, { seed: s.id, style: 'crenel', gaps: waysOver(m, s.points) }); }
    else v = buildTerrace(s.points, s.h, { seed: s.id, top: s.id === 't_hq' ? 'setts' : 'flags', skip: bodyRects(m) });
    if (swapVisual(w, s.id, v)) n++;
  }
  return n;
}

/** The SW and SE gatehouses (twin towers, tops on the wall walk). */
function* gates(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (due()) yield;
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
function* towers(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (due()) yield;
    let v = null;
    const y0 = s.baseY ?? 0;
    const dress = M20_DRESSING_BUILDERS[s.variant];
    if (dress) { v = dress({ ...s, y0: 0, seed: s.seed ?? s.id }); v.position.y += y0; } // art pass 2 set dressing (art/m20-dressing.js)
    else if (s.id === 'turret') v = buildRoundTower({ x: s.x, z: s.z, r: s.w / 2, y0: 13, deckY: s.deckY ?? s.h, door: Math.PI / 2, seed: s.id });
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
    else if (s.variant === 'target_board_bullseye') v = buildRingTarget({ x: s.x, z: s.z, face: Math.PI / 2, w: s.w, seed: s.id }); // the firing line's ring target (faces S, the line)
    else if (s.variant === 'target_frame_silhouette') v = buildTargetFrame({ x: s.x, z: s.z, rot: Math.atan2(89 - s.z, 104.5 - s.x) + Math.PI, w: s.w, h: s.h, seed: s.id }); // faces the bench
    else if (s.variant === 'bullet_stop_timber_sandbag') v = buildBulletStop(s.points, { h: s.h, width: s.width, seed: s.id });
    else if (s.type === 'searchlight') v = buildSearchlight({ x: s.x, z: s.z, rot: Math.atan2(s.z - 72, s.x - 88), elev: 0.3, y0, seed: s.id }); // aimed out over the walls
    else if (s.type === 'firing_range') v = buildRangeBerm({ x: s.x, z: s.z, rot: s.rot ?? 0, w: s.w, d: s.d, h: s.h, cuts: crossingStops(m, s), seed: s.id });
    else if (s.type === 'lever') { const lb = buildLeverBox({ x: s.x, z: s.z, rot: s.rot ?? 0, seed: s.id }); v = lb.group; leverLamp(w, s, lb.lamp); }
    else if (s.type === 'well') v = buildWell({ x: s.x, z: s.z, r: s.r ?? 0.9, rot: s.rot ?? 0, seed: s.id });
    else if (s.type === 'bridge') {
      const o = { x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, lanterns: /lantern/.test(s.variant || ''), seed: s.id };
      v = buildMoatBridge(o);
      // (drawn: the deck stops at the gate's threshold, the railings at its face — the gameplay deck, measured as
      // built, runs on under the passage floor: two coplanar floors there before)
      const bg = bridgeGate(m, s);
      if (bg) drawAs(v, buildMoatBridge({ ...o, deckU0: bg.uApron, railU0: bg.uFace }));
    }
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
function* rockets(w, m) {
  let n = 0;
  for (const s of m.structures || []) {
    if (due()) yield;
    if (s.type !== 'v2_rocket') continue;
    const lib = libraryVisual('v2_rocket', { ...s, asset: s.id === 'v2b' ? 'v2_meillerwagen_b' : 'v2_meillerwagen' }, { theater: m.theater, missionId: m.id });
    if (!lib) continue;
    const o = w.structures?.get?.(s.id)?.object3d;
    if (swapVisual(w, s.id, lib.object3d, lib.ready)) {
      n++;
      if (o) {
        o.userData.destroy = () => lib.object3d.userData.destroy?.();
        // (and its ruin staged at load as any library building's — Game.loadMission asks the interactable's own object
        // for prepareDestroy: without it the burnt-out wreck was built, its model fetched, in the blast's tick, 0.6 ms)
        const ud = lib.object3d.userData;
        if (ud.prepareDestroy) o.userData.prepareDestroy = () => ud.prepareDestroy();
        if (ud.stageAlways != null) o.userData.stageAlways = ud.stageAlways;
      }
    }
  }
  return n;
}

/**
 * Every `ladders[]` stone flight (kind 'stairs'; planks stay m20.js's). The climbed timber ladders are built by
 * art/ladder-frame.js against the towers' faces (drawn here from end to end, they ran into the masonry).
 */
function* links(w, m) { // eslint-disable-line require-yield
  const G = new Geo('m20:links');
  let n = 0;
  // (a flight whose top end lies inside the level it climbs to stops at that level's edge: its last steps were drawn
  // inside the terrace with the top tread on its paving and the cheek walls standing out of the floor, review 2026-11-11)
  const levels = (m.structures || []).filter((s) => s.type === 'cliff' && s.points);
  const walls = (m.structures || []).filter((s) => s.type === 'castle_wall' && s.points);
  const segD = (p, q, r) => { const dx = r[0] - q[0], dz = r[1] - q[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dz) / L2)); return Math.hypot(p[0] - q[0] - dx * t, p[1] - q[1] - dz * t); };
  const onLevel = (x, z, y) => levels.some((s) => Math.abs((s.h ?? 0) - y) < 0.3 && inPoly([x, z], s.points))
    || walls.some((s) => Math.abs((s.h ?? 7) - y) < 0.3 && s.points.some((p, k) => k > 0 && segD([x, z], s.points[k - 1], p) < (s.width ?? 5) / 2));
  for (const l of m.ladders || []) {
    if (l.kind !== 'stairs') continue;
    const a = { x: l.x, y: l.y ?? 0, z: l.z }, b = { x: l.top[0], y: l.top[2] ?? 0, z: l.top[1] };
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    let stopAt;
    for (let k = 1; k <= 200; k++) { const t = k / 200; if (onLevel(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, b.y)) { stopAt = run * t; break; } }
    buildStairFlight(a, b, { G, width: 1.8, stopAt });
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
// (castle pass: the crag's W and N faces stand in the moat ring — x 4 and z 10 — not past the map edge any more; along
// the château and its terrace (z 38-82) the keep's plinth and the terrace's retaining wall are the face over the water,
// under the crag wall (cw_w, x 4-22) the wall itself is the face down to the ground)
const CRAG_X0 = 4;
const CRAG_PARTS = [
  [[CRAG_X0, 10], [40, 10], [40, 14], [CRAG_X0, 14]], [[CRAG_X0, 14], [38, 14], [38, 32], [CRAG_X0, 32]], [[CRAG_X0, 32], [27, 32], [27, 38], [CRAG_X0, 38]],
];
function* crag(w, m) { // eslint-disable-line require-yield
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
function* basin(w, m) { // eslint-disable-line require-yield
  const rects = (m.terrain || []).filter((t) => t.type === 'rect' && t.terrain === 'water');
  const pool = rects.find((t) => t.w >= 3 && t.d >= 3);
  if (!pool) return 0;
  const gaps = rects.filter((t) => t !== pool && Math.abs(t.x - (pool.x + pool.w)) < 0.01).map((t) => ['E', t.z, t.z + t.d]);
  const g = buildBasin(pool, { gaps, seed: 'pool', apron: 0.9 }); // (its E apron stops short of the curtain's inner face)
  g.name = 'm20art:pool';
  w.scene.add(g);
  return 1;
}

/**
 * Castle pass (user 2026-11-10: a large, detailed medieval castle with a moat all round): the moat works, the flanking
 * towers, the gatehouses' crowns, the SW gate's drawbridge — scenery added to the scene (art/m20-castle.js:
 * the gameplay never measures it; it stands in the moat, on outer faces and above head height).
 */
function* castle(w, m) { // eslint-disable-line require-yield
  const ground = (x, z) => w.groundY?.(x, z) ?? 0;
  const works = buildMoatWorks(m, { ground });
  works.name = 'm20art:moat';
  w.scene.add(works);
  const G = new Geo('m20:castle');
  buildTowers(m, G);
  const S = (id) => (m.structures || []).find((s) => s.id === id);
  for (const id of ['gh_sw', 'gh_se']) { const s = S(id); if (s) gateCrown(G, { x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, walkY: 7 }); }
  const br = S('br_sw');
  if (br) drawbridge(G, { x: br.x, z: br.z, rot: br.rot, w: br.w, d: br.d, walkY: 7, leaf: 4.0, faceU: bridgeGate(m, br)?.uFace });
  // the bridges' ends: a stone landing at the outer end (between the lantern piers), a threshold at the gate's face
  for (const b of (m.structures || []).filter((q) => q.type === 'bridge')) {
    const bg = bridgeGate(m, b);
    if (!bg) continue;
    const lantern = /lantern/.test(b.variant || ''), L2 = b.w / 2;
    bridgeEnds(G, { x: b.x, z: b.z, rot: b.rot, w: b.w, d: b.d, half: lantern ? b.d / 2 + 0.53 : b.d / 2 + 0.18,
      landing: [L2 + BRIDGE_LANDING[0], L2 + BRIDGE_LANDING[1]], gate: [bg.uFace - 0.1, bg.uApron], gateHalf: bg.passage / 2 });
  }
  // the N range's rampart (T_n): merlons along its open S edge W of its parapet strip (t_par_n draws x 92-104), open
  // where the stairs land on it (S_n3, S_n)
  // (and the open edges of the lower terraces: the NW terrace over the W quarter and the yard, the W bastion terrace
  // over the yard, the quarter and the inner road, the NE terrace over the N and E road courts — a gap wherever a stair
  // crosses an edge; none on the W bastion terrace's N edge, over which the Sniper takes e66)
  const stairGaps = (m.ladders || []).filter((l) => l.kind === 'stairs').flatMap((l) => {
    const a = [l.x, l.z], b = [l.top[0], l.top[1]], out = [];
    for (let k = 0; k <= 40; k++) out.push([a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40, 2.0]);
    return out;
  });
  // (each run with a point of its own level on its inner side: the outward face is the drop)
  const edges = [
    ['t_n', [[38.25, 32], [91.6, 32]], [70, 20]],
    ['t_nw', [[38.3, 72], [56, 72]], [47, 60]], ['t_nw', [[56, 72], [56, 42.4]], [47, 60]],
    ['t_wb', [[56.4, 62], [64, 62]], [60, 55]], ['t_wb', [[64, 62], [64, 70]], [66.5, 66]], // (its S edge E of 64 is the inner gate's own crown)
    ['t_wb', [[69.2, 69.6], [69.2, 42.4]], [62, 55]], // (its S end short of the inner gate's face: no coplanar ends)
    ['t_ne', [[102, 32.4], [102, 51]], [112, 42]], ['t_ne', [[102, 51], [127.6, 51]], [112, 42]],
  ];
  for (const [id, pts, inside] of edges) { const t = S(id); if (t) rampartParapet(G, pts, t.h, { inside, gaps: stairGaps }); }
  const g = G.build('m20art:castle', { ground: 0 });
  w.scene.add(g);
  return 2;
}

/**
 * The castle church (Burgkirche, castle pass: user 2026-11-10 "If the castle can have a church too"): art/m20-church.js
 * swapped into its structure (measured: its walls, buttresses and the portal's steps are the nav).
 */
function* church(w, m) { // eslint-disable-line require-yield
  const s = (m.structures || []).find((q) => q.id === 'church');
  if (!s) return 0;
  return swapVisual(w, 'church', buildChurch({ x: s.x, z: s.z, rot: s.rot ?? 0, w: s.w, church: s.church, y0: s.baseY ?? 0, seed: 'church' })) ? 1 : 0;
}

/**
 * The occupation layer (castle pass: user 2026-11-10 "Just make sure th3 castle is a medieval castle in the nazi era"):
 * the sentry boxes swapped into their structures (measured), the rest scenery (art/m20-occupation.js: MG nests on the
 * walls, knife-rests and wire at the gates, the searchlight, the telephone lines, the keep's radio mast, the camouflage
 * nets, the dumps). The parked vehicles are the library's (art/static-vehicles.js `vehicleArt`).
 */
function* occupation(w, m) { // eslint-disable-line require-yield
  let n = 0;
  for (const s of (m.structures || []).filter((q) => q.variant === 'sentry_box_m20')) {
    if (swapVisual(w, s.id, buildSentryBox({ x: s.x, z: s.z, rot: s.rot ?? 0, seed: s.id }))) n++;
  }
  const g = buildOccupation(m, { ground: (x, z) => w.groundY?.(x, z) ?? 0 });
  w.scene.add(g);
  return n + 1;
}

/**
 * The period flags (user 2026-11-10: "Nazi flags no medieval flags and so on"; the standing decision of 2026-09-30):
 * the flag system's national flag (art/flags.js: HISTORICAL by default, the field-grey banner when Options → INSIGNIA is
 * NEUTRAL; repainted live when it changes) — no heraldry anywhere. Where an occupied HQ flies them: the keep's donjon
 * (flagpole on its pyramid) and its entrance (two banners on the hall's S face either side of the portal), over the two
 * gatehouses (a banner on each outer tower face) and the inner gate (either side of its S arch), the guardhouse (its
 * pole: barracks flags mark reinforcement buildings), the vehicle park, the church tower (a banner down its N face).
 */
export function periodFlags(m) {
  const S = (id) => (m.structures || []).find((s) => s.id === id);
  const out = [];
  out.push({ kind: 'flag', x: KEEP_FLAG.x, y: KEEP_FLAG.y, z: KEEP_FLAG.z, poleH: KEEP_FLAG.h, w: 2.6 });
  const hq = S('hq');
  if (hq) for (const x of [9.6, 14.4]) out.push({ kind: 'banner', x, y: 22.2, z: hq.z + hq.d / 2 + 0.06, face: Math.PI / 2, w: 1.3, h: 4.2 });
  for (const id of ['gh_sw', 'gh_se']) {
    const s = S(id);
    if (!s) continue;
    const c = Math.cos(s.rot), n = Math.sin(s.rot), D2 = s.d / 2, wb = D2 + 0.5;
    // (user 2026-11-11: "Flags in main entrance are covered by parts of the wall": hung from iron brackets in the
    // parapet, just under its coping, a hand clear of the parapet's face — over the corbel table, whole in front of the
    // stone — between the drawbridge beams' slots (u ±1.7-2.3) and the towers' bartizans (|u| > 4.9), over no loop)
    for (const u of [-3.7, 3.7]) out.push({ kind: 'banner', x: s.x + c * u - n * wb, z: s.z + n * u + c * wb, y: 8.0, face: s.rot + Math.PI / 2, w: 1.0, h: 2.3, bracket: wb + 0.06 - (D2 + 0.32) });
  }
  const gi = S('gh_in');
  if (gi) {
    // (on the E tower's S face, either side of its column of loops: the tower stands 0.3 m proud of the hall's face —
    // banners hung a hand off the hall's face were inside its masonry; W of the tunnel is the terrace's wall)
    const a = gi.w / 2 - gi.w / 3 + 0.1, b = gi.w / 2, mid = (a + b) / 2, zf = gi.z + gi.d / 2 + 0.3 + 0.12;
    for (const du of [-1.35, 1.35]) out.push({ kind: 'banner', x: gi.x + mid + du, y: gi.h + 1.0, z: zf, face: Math.PI / 2, w: 0.9, h: 2.4 });
  }
  out.push({ kind: 'flag', x: 84.46, y: 0, z: 96.7, poleH: 6.6, w: 1.8 });
  out.push({ kind: 'flag', x: 121.2, y: 0, z: 55.2, poleH: 7.0, w: 1.8 }); // (1.8 m off the barracks' S face: its fly reached the wall)
  const ch = S('church');
  if (ch) {
    // (between the tower's two round-arch friezes, on brackets a hand clear of them: hung 6 cm off the stone, both
    // friezes cut through it, review 2026-11-11)
    const F = churchFrame(ch), P = planOf(ch), [x, z] = F.at((P.tower[0] + P.tower[1]) / 2, -P.towerH - 0.24);
    const top = P.towerTop - 3.9 - 0.75, bottom = P.naveEave + 0.2 + 0.56 + 0.15;
    out.push({ kind: 'banner', x, y: (ch.baseY ?? 0) + top, z, face: Math.atan2(-F.n[1], -F.n[0]), w: 1.3, h: +(top - bottom).toFixed(2), bracket: 0.3 });
  }
  return out;
}
/**
 * The castle's age (user 2026-11-10: "Castle has signs of age", "Castle very well maintained though"): art/m20-age.js —
 * patina, not decay; one decal mesh over the masonry and the roofs (scenery, never measured).
 */
function* age(w, m) { // eslint-disable-line require-yield
  const g = buildAge(m, { groundAt: (x, z) => w.groundY?.(x, z) ?? 0 });
  w.scene.add(g);
  return g.userData.decals || 0;
}
function* flags(w, m) { // eslint-disable-line require-yield
  const theater = m.theater;
  let n = 0;
  for (const f of periodFlags(m)) {
    const g = f.kind === 'flag' ? makeFlag({ pole: true, poleH: f.poleH, w: f.w, theater }) : makeBanner({ w: f.w, h: f.h, theater, seed: n });
    if (f.bracket) { // two iron arms from the stone out to the banner's rod ends (the group's +z faces out of the wall)
      const mat = g.children.find((c) => c.name !== 'flag_banner')?.material;
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, f.bracket + 0.005), mat); // (its end on the stone)
        arm.position.set(sx * (f.w / 2 + 0.01), 0.02, 0.06 - (f.bracket + 0.005) / 2);
        arm.name = 'banner_bracket'; arm.castShadow = true;
        const stay = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, Math.hypot(f.bracket, 0.3)), mat);
        stay.position.set(sx * (f.w / 2 + 0.01), 0.02 - 0.15, 0.06 - f.bracket / 2);
        stay.rotation.x = -Math.atan2(0.3, f.bracket); stay.name = 'banner_bracket';
        g.add(arm, stay);
      }
    }
    g.position.set(f.x, f.y, f.z);
    if (f.kind === 'banner') g.rotation.y = Math.PI / 2 - f.face;
    g.name = `m20art:${f.kind}:${n}`;
    w.scene.add(g);
    n++;
  }
  return n;
}

/**
 * The HQ (objective o1) drawn as the castle's keep in place of the library's Neo-Gothic château: the château stays the
 * gameplay's building (its sidecar footprints, door and porch link; the keep's walls stand on them), its meshes hidden;
 * the keep's ruin is built now beside it, hidden, and the charge's blast swaps them (Interactable 'model' wreck look).
 */
function* keep(w, m) { // eslint-disable-line require-yield
  const s = (m.structures || []).find((q) => q.id === 'hq');
  const o = w.structures?.get?.('hq')?.object3d;
  if (!s || !o) return 0;
  // (its chimneys where the château's model smokes: render/fx.js keeps the library model's smoke anchors)
  const box = { x0: s.x - s.w / 2, x1: s.x + s.w / 2, z0: s.z - s.d / 2, z1: s.z + s.d / 2, y0: s.baseY ?? 0, seed: 'hq',
    chimneys: [[14.07, 44.89, 34.77], [9.84, 54.72, 34.3], [23.98, 40.46, 27.8]] };
  // (gameplay measures the keep as first built — its round tower's loops' arms stood out of the wall; drawn: on the face)
  const v = buildKeep({ ...box, legacyLoops: true }), ruin = buildKeepRuin(box);
  drawAs(v, buildKeep(box));
  if (!swapVisual(w, 'hq', v)) return 0;
  ruin.applyMatrix4(o.matrixWorld.clone().invert());
  ruin.visible = false;
  ruin.name = 'm20art:hq:ruin';
  o.add(ruin);
  o.userData.hasWreck = () => true;
  o.userData.destroy = () => { v.visible = false; ruin.visible = true; return true; };
  // (built above: nothing to stage at the blast; the library's château ruin is not wanted any more)
  o.userData.prepareDestroy = () => null;
  return 1;
}

/** Invisible stand-ins of the drawn materials (one per material): the proxy's meshes keep their place in the scene graph
 *  (everything the gameplay measured on them stays as it was) but draw nothing — no colour, depth or shadow pass. */
const INVISIBLE = new WeakMap();
const invisibleOf = (mat) => {
  if (!mat) return mat;
  let c = INVISIBLE.get(mat);
  if (!c) { c = mat.clone(); c.visible = false; c.name = `${mat.name || 'mat'}#proxy`; INVISIBLE.set(mat, c); }
  return c;
};
/**
 * Make a library building a measured-only proxy: its meshes (every LOD, its flags, its ruin) draw nothing — and so do
 * the LODs and dressings attached to it later (a LOD loaded on demand, the flag hooks): `childadded` anywhere in it.
 */
export function hideProxy(o) {
  const hide = (n) => {
    if (!(n.isMesh || n.isLine || n.isPoints) || n.userData?.m20Keep) return;
    n.material = Array.isArray(n.material) ? n.material.map(invisibleOf) : invisibleOf(n.material);
    n.castShadow = false;
  };
  const watch = (n) => {
    if (n.userData?.m20Proxy) return;
    n.userData.m20Proxy = true;
    n.addEventListener('childadded', (e) => e.child?.traverse?.((c) => { hide(c); watch(c); }));
  };
  o?.traverse?.((n) => { hide(n); watch(n); });
}

/**
 * The bailey's buildings (castle pass): the library huts and houses of the W quarter and the S row — WWII plank huts —
 * drawn as the castle's medieval outbuildings (stables, smithy, store, workshops, the brewhouse and bakehouse, the
 * steward's house, the gate warden's lodge, the guardhouse, the chapel: art/m20-castle.js BAILEY_PLAN). Each library
 * model stays where it was as the gameplay's measured proxy, drawing nothing; the guardhouse (bk_s, destructible) burns
 * out with its own ruin.
 */
function* bailey(w, m) { // eslint-disable-line require-yield
  const G = new Geo('m20:bailey');
  const ids = buildBailey(m, G);
  for (const id of ids) hideProxy(w.structures?.get?.(id)?.object3d);
  const g = G.build('m20art:bailey', { ground: 0 });
  w.scene.add(g);
  const o = w.structures?.get?.('bk_s')?.object3d;
  if (o) {
    const ruin = buildGuardRuin(m);
    ruin.visible = false;
    ruin.userData.m20Keep = true;
    ruin.traverse((n) => { n.userData.m20Keep = true; });
    w.scene.add(ruin);
    const lib = o.userData.destroy;
    // (the library swaps its own ruin in, a proxy like the rest: hidden again; the guardhouse's ruin shown instead)
    o.userData.destroy = () => {
      const r = lib ? lib() : true;
      hideProxy(o);
      ruin.visible = true;
      g.userData.hidden = (g.userData.hidden || 0) + 1;
      hideGuard(g, m);
      return r;
    };
  }
  return ids.length;
}
/** The intact guardhouse's triangles hidden once it burns: its building is a range of the merged bailey (by area). */
function hideGuard(g, m) {
  const s = (m.structures || []).find((q) => q.id === 'bk_s'), p = BAILEY_PLAN.bk_s;
  if (!s) return;
  const c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0);
  g.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    let changed = false;
    for (let i = 0; i < pos.count; i += 3) {
      let inside = true;
      for (let k = 0; k < 3 && inside; k++) {
        const dx = pos.getX(i + k) - s.x, dz = pos.getZ(i + k) - s.z, u = dx * c + dz * n, ww = -dx * n + dz * c;
        inside = u > p.u0 - 0.9 && u < p.u1 + 0.9 && ww > p.w0 - 0.9 && ww < p.w1 + 0.9;
      }
      if (inside) { for (let k = 0; k < 3; k++) pos.setXYZ(i + k, 0, -50, 0); changed = true; }
    }
    if (changed) { pos.needsUpdate = true; mesh.geometry.computeBoundingSphere(); }
  });
}

/** The castle's well-kept limestone and its slate a little lighter than the kit's (review 2026-11-11: the overview read
 *  dark and flat against the winter ground): vertex-colour brightness per castle-kit material, visual only. */
export const CASTLE_TONE = { ashlar: 1.18, dressed: 1.14, rubble: 1.1, flags: 1.06, setts: 1.04, slate: 1.15 };
/** Build every M20 art visual once per world. */
export function buildM20Art(w) { runSync(buildM20ArtG(w)); }

/**
 * buildM20Art as a sliced job (engine/slice.js): the same pieces in the same order, pausing between structures. The
 * castle frost is on only while a piece is being built (off whenever the job pauses: nothing else gets it).
 */
export function* buildM20ArtG(w) {
  if (!w.scene || w._m20Art) return;
  w._m20Art = true;
  const m = w.mission || {};
  const f = m.variant === 'frost' ? 0.28 : 0; // 11 Feb 1945: hoar frost on the tops, no snow (dossier §2)
  const frosted = function* frosted(gen) {
    for (;;) {
      setCastleFrost(f); setCastleTone(CASTLE_TONE);
      let r;
      try { r = gen.next(); } finally { setCastleFrost(0); setCastleTone(null); }
      if (r.done) return r.value;
      yield r.value;
    }
  };
  const stats = {};
  for (const [k, step] of [['curtains', curtains], ['levels', levels], ['gates', gates], ['towers', towers], ['links', links], ['rockets', rockets], ['crag', crag], ['basin', basin], ['keep', keep], ['bailey', bailey], ['church', church], ['castle', castle], ['occupation', occupation], ['flags', flags], ['age', age]]) {
    stats[k] = yield* frosted(step(w, m));
  }
  animateWaterGate(w);
  w._m20ArtStats = stats;
}

