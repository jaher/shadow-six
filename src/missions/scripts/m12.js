/**
 * BEL M12 "Up on the Roof" mission glue (docs/missions/m12.md §10, §13). Owned by MISSIONS.
 *  - D1 fallback: the Green Beret and the Sniper start hidden inside their hideouts (the same `admit` a door
 *    click uses), on the director's first tick;
 *  - roof props (the Sniper's shack, the green-domed kiosk, crates and barrels on the terraces) are lifted to
 *    their roof height, and the shack and the kiosk get their block back on the raised cells (the elevation
 *    pass clears every raised cell);
 *  - the mosque platform (a `cliff` area prop raised by walkway strips) gets a stone prism mesh; its
 *    placeholder cliff mesh is hidden.
 * @module missions/scripts/m12
 */

import * as THREE from 'three';
import { B, MAX_STEP } from '../../world/grid.js';
import { CONFIG } from '../../config.js';
import { hears } from '../../ai/perception.js';

/**
 * Put each [role, structureId, spawn?] commando inside the structure's hideout door ("<id>:door").
 * Only at the very start (world.time < 1) and only for a man still standing at his spawn point: a `start`
 * trigger that ran again after a quick load must never pull a man back into his hideout (fix round #3).
 */
export function startHidden(world, pairs) {
  if ((world.time ?? 0) >= 1) return 0;
  let n = 0;
  for (const [role, sid, spawn] of pairs) {
    const c = (world.commandos || []).find((u) => u.role === role && u.alive !== false);
    if (!c || c.hidden) continue;
    if (spawn && Math.hypot(c.x - spawn.x, c.z - spawn.z) > 1.5) continue;
    const door = (world.interactables || []).find((i) => i.interactKind === 'door' && i.enterable && (i.tag === `${sid}:door` || i.id === `${sid}:door`));
    if (door && door.admit(c)) n++;
  }
  return n;
}

/** Block the cells of axis-aligned rects [{x, z, w, d}] (roof props standing on raised cells). */
export function blockRoofRects(world, rects) {
  const g = world.grid;
  if (!g) return 0;
  let n = 0;
  for (const r of rects) {
    const i0 = Math.floor((r.x - r.w / 2) / g.cell), i1 = Math.floor((r.x + r.w / 2 - 1e-6) / g.cell);
    const j0 = Math.floor((r.z - r.d / 2) / g.cell), j1 = Math.floor((r.z + r.d / 2 - 1e-6) / g.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!g.inBounds(i, j)) continue;
      g.block[g.idx(i, j)] = B.HIGH; n++;
    }
  }
  if (n) g.version++;
  return n;
}

/** Distance from (px, pz) to segment a–b. */
function segDist(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * Stamp sight blockers AFTER the elevation pass (which clears the block of every raised cell): each
 * `{points, width, block}` polyline marks the cells whose centre lies within width/2 of it (B.HIGH walls:
 * the mosque arcades and court walls, the rooftop sheds and dividers; B.LOW: crates, low walls).
 */
export function stampLines(world, lines) {
  const g = world.grid;
  if (!g || !lines?.length) return 0;
  let n = 0;
  for (const l of lines) {
    const pts = l.points, r = (l.width ?? 1) / 2, blk = l.block ?? B.HIGH;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const i0 = Math.floor((Math.min(...xs) - r) / g.cell), i1 = Math.floor((Math.max(...xs) + r) / g.cell);
    const j0 = Math.floor((Math.min(...zs) - r) / g.cell), j1 = Math.floor((Math.max(...zs) + r) / g.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!g.inBounds(i, j)) continue;
      const cx = (i + 0.5) * g.cell, cz = (j + 0.5) * g.cell;
      let d = Infinity;
      for (let k = 0; k + 1 < pts.length; k++) d = Math.min(d, segDist(cx, cz, pts[k], pts[k + 1]));
      if (d > r) continue;
      const q = g.idx(i, j);
      if (g.block[q] !== B.HIGH) { g.block[q] = blk; n++; }
    }
  }
  if (n) g.version++;
  return n;
}

/**
 * Roof parapets and terrace dividing walls (dossier §5.2 [rec] "0.8 m parapet on every walkable roof"). Every
 * free roof cell (elev ≥ minY) becomes B.LOW when
 *  - a 4-neighbour is more than MAX_STEP lower (the roof's outer edge), or
 *  - a 4-neighbour at the same level lies on ANOTHER roof of `roofs` ([{poly}], first match wins; the lower
 *    index keeps the wall): the low wall between two terraces that touch.
 * LOW cover hides bodies and prone men lying beyond it (the M12 roof guards are not `elevated`, so it counts for
 * them) and is not walkable. Gaps: every ladder/stair end, the plank bridges (`keep`: [{points, r}]) and the
 * doorways (`doors`: [[x, z]]) within `gapR`.
 */
export function stampParapets(world, o = {}) {
  const g = world.grid;
  if (!g) return 0;
  const minY = o.minY ?? CONFIG.stealth.roofY, gapR = o.gapR ?? 1.6;
  const ends = [];
  for (const l of g.links || []) ends.push([l.a.x, l.a.z], [l.b.x, l.b.z]);
  for (const d of o.doors || []) ends.push(d);
  const keep = o.keep || [], roofs = o.roofs || [];
  const roofOf = (i, j) => {
    const cx = (i + 0.5) * g.cell, cz = (j + 0.5) * g.cell;
    for (let r = 0; r < roofs.length; r++) if (inPoly(roofs[r].poly, cx, cz)) return r;
    return -1;
  };
  const cells = [];
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const k = g.idx(i, j), y = g.elev[k];
    if (y < minY || g.block[k] !== B.NONE) continue;
    let edge = false;
    const mine = roofs.length ? roofOf(i, j) : -1;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (!g.inBounds(ni, nj)) { edge = true; break; }
      const ny = g.elev[g.idx(ni, nj)];
      if (ny < y - MAX_STEP) { edge = true; break; }
      if (mine >= 0 && Math.abs(ny - y) <= MAX_STEP) {
        const other = roofOf(ni, nj);
        if (other >= 0 && other > mine) { edge = true; break; }
      }
    }
    if (!edge) continue;
    const cx = (i + 0.5) * g.cell, cz = (j + 0.5) * g.cell;
    if (ends.some((p) => Math.hypot(p[0] - cx, p[1] - cz) < gapR)) continue;
    if (keep.some((l) => { for (let q = 0; q + 1 < l.points.length; q++) if (segDist(cx, cz, l.points[q], l.points[q + 1]) <= l.r) return true; return false; })) continue;
    cells.push(k);
  }
  for (const k of cells) g.block[k] = B.LOW;
  if (cells.length) g.version++;
  return cells.length;
}

/** Point-in-polygon (even-odd). */
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Guard voices: a shout carries the alarm only inside its own zone. */
const VOICES = new Set(['mandown', 'alarmShout', 'bark']);
/**
 * The harbour HQ's ears (z_sehq's heard sensor, run by the script instead of the zone's onHeard): a level ≥ 2
 * noise heard by a living guard standing in the zone trips RSEHQ, EXCEPT
 *  - a guard's shout ("man down", "Alarm!", a bark) that starts outside the zone: the north's own alarm
 *    only rings RINT (Prima "a shout here only rings RINT"; ooc "at most three additional guards");
 *  - "Halt!": a challenge is not an alarm (§4.9); the guard walks over to look.
 * Gunfire keeps its reach: a pistol shot within 18 m of a south guard (e.g. S of the kiosk) is fatal (dossier §9).
 */
export function southHears(w, n, poly) {
  if ((n.level ?? 0) < CONFIG.stealth.zoneHeardLevel || n.kind === 'halt') return false;
  if (VOICES.has(n.kind) && !inPoly(poly, n.x, n.z)) return false;
  return (w.enemies || []).some((e) => e.alive && !e.removed && e !== n.source && inPoly(poly, e.x, e.z) && hears(e, n));
}

/** Extruded polygon (top at y, vertical sides down to 0). */
function prism(poly, y, top, side) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // shape (x, z) plane → XZ; extrusion goes down −y
  geo.translate(0, y, 0);
  const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ color: top, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: side, roughness: 1 })]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

const ART = { stone: 0xd9cfbb, shade: 0x5a4a3a, trim: 0xb8986a, tile: 0x3f7a5a };
const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });

/** A horseshoe-arch outline (width w, height h to the crown) as a THREE.Shape, base at (0, 0). */
function archShape(w, h) {
  const s = new THREE.Shape(), r = w / 2, spring = h - r;
  s.moveTo(-r, 0); s.lineTo(-r, spring);
  s.absarc(0, spring, r, Math.PI, 0, true);
  s.lineTo(r, 0); s.lineTo(-r, 0);
  return s;
}

/**
 * Blind arcades (fix round 2, the fan map's arcaded courts): along each wall line, on both faces, recessed
 * horseshoe arches between engaged columns, and a band of merlons on top. Cosmetic only (the wall is the
 * sight blocker); nothing overhangs the walkable courts, so the top-down camera always sees the men.
 * @param {THREE.Group} root
 * @param {{lines: Array<{points: number[][], y: number, h: number, width?: number}>}} spec
 */
export function buildArcades(root, spec) {
  const archGeo = new THREE.ShapeGeometry(archShape(1.3, 2.1));
  const colGeo = new THREE.CylinderGeometry(0.11, 0.13, 2.2, 8);
  const capGeo = new THREE.BoxGeometry(0.34, 0.14, 0.34);
  const merGeo = new THREE.BoxGeometry(0.42, 0.42, 0.3);
  const mArch = new THREE.MeshStandardMaterial({ color: ART.shade, roughness: 1, side: THREE.DoubleSide }), mCol = mat(ART.trim), mMer = mat(ART.stone);
  for (const l of spec.lines || []) {
    const half = (l.width ?? 0.8) / 2 + 0.03;
    for (let k = 0; k + 1 < l.points.length; k++) {
      const [ax, az] = l.points[k], [bx, bz] = l.points[k + 1];
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
      const yaw = Math.atan2(-dz, dx); // local +x along the wall
      const n = Math.max(1, Math.floor(L / 2.1));
      for (const side of [1, -1]) {
        const nx = -dz * side * half, nz = dx * side * half;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) * (L / n);
          const a = new THREE.Mesh(archGeo, mArch);
          a.position.set(ax + dx * t + nx, l.y + 0.05, az + dz * t + nz);
          a.rotation.y = yaw + (side > 0 ? 0 : Math.PI); // face outwards (+z of the shape = the wall normal on this side)
          root.add(a);
        }
        for (let i = 0; i <= n; i++) {
          const t = i * (L / n), cx = ax + dx * t + nx * 1.25, cz = az + dz * t + nz * 1.25;
          const c = new THREE.Mesh(colGeo, mCol); c.position.set(cx, l.y + 1.1, cz); root.add(c);
          const cap = new THREE.Mesh(capGeo, mCol); cap.position.set(cx, l.y + 2.27, cz); root.add(cap);
        }
      }
      for (let t = 0.4; t < L; t += 0.9) {
        const m = new THREE.Mesh(merGeo, mMer);
        m.position.set(ax + dx * t, l.y + l.h + 0.2, az + dz * t); m.rotation.y = yaw;
        m.castShadow = true; root.add(m);
      }
    }
  }
}

/** A ribbed hemispherical dome on an octagonal drum (the prayer hall; the fan map's big white dome). */
export function buildDome(root, d) {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r * 1.05, d.drum ?? 1.2, 8), mat(ART.stone));
  drum.position.y = (d.drum ?? 1.2) / 2; g.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.96, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(d.color ?? ART.stone, 0.8));
  dome.position.y = d.drum ?? 1.2; dome.castShadow = true; g.add(dome);
  const ribM = mat(ART.trim);
  for (let k = 0; k < 12; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.97, 0.06, 4, 16, Math.PI / 2), ribM);
    rib.position.y = d.drum ?? 1.2; rib.rotation.y = (k / 12) * Math.PI * 2; rib.rotation.x = 0;
    rib.rotateOnAxis(new THREE.Vector3(0, 1, 0), 0); g.add(rib);
  }
  const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), mat(ART.trim, 0.4));
  fin.position.y = (d.drum ?? 1.2) + d.r * 0.96 + 0.5; g.add(fin);
  g.position.set(d.x, d.y, d.z);
  root.add(g);
}

/** Platform prism, lifted roof props, hidden placeholder meshes. */
export function buildVisuals(world, spec) {
  if (!world.scene || world._m12Visuals) return;
  world._m12Visuals = true;
  const root = new THREE.Group();
  root.name = 'm12:platform';
  for (const p of spec.prisms || []) root.add(prism(p.poly, p.y, p.top ?? 0xb09a78, p.side ?? 0x9a8464));
  if (spec.arcades) buildArcades(root, spec.arcades);
  if (spec.dome) buildDome(root, spec.dome);
  world.scene.add(root);
  for (const id of spec.hide || []) { const o = world.structures?.get(id)?.object3d; if (o) o.visible = false; }
  for (const [id, y] of spec.lift || []) {
    const o = world.structures?.get(id)?.object3d;
    if (o && !o.userData.m12Lifted) { o.userData.m12Lifted = true; o.position.y += y; }
  }
}

/** mission.script: visuals, roof-prop blocks, post-elevation sight blockers and parapets, the HQ's ears. */
export function m12Script(spec) {
  return (world) => {
    buildVisuals(world, spec);
    blockRoofRects(world, spec.block || []);
    stampLines(world, spec.lines || []);
    if (spec.parapets) stampParapets(world, spec.parapets);
    if (spec.southZone) {
      const { id, poly } = spec.southZone; // the zone's onSeen event (RSEHQ) fires; its onHeard stays null
      world.listen('noise', (n) => { if (southHears(world, n, poly)) world.alarm?.raise(id, 'heard', n.x, n.z, { sensor: 'seen' }); });
    }
  };
}
