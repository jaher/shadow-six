/**
 * Pavement builder (PROGRESS step 3p): turns a normalized road network (world/roads.js) into meshes on top of the
 * finished terrain — hard carriageways, sidewalks behind granite kerbs with gutters and drain grates, manholes,
 * embedded tram rails, paved areas, raised platforms with skirts, quays (coping, masonry wall, bollards, rings).
 * Soft surfaces (gravel, dirt, mud, sand, snow) are drawn by the terrain splat and are skipped here.
 * @module art/pavement
 */
import * as THREE from 'three';
import { SURFACES, sampleCenterline } from '../../world/roads.js';
import { pavementMaterial, setPavementQuality, tierOf } from './pavement-material.js';
import { ribbonGeometries, areaGeometry, extrudeProfile, kerbProfile, skirtProfile, copingProfile, quayWallProfile, polygonEdgePath, groundFn, LIFT } from './road-mesh.js';
import { detailMaterial, drainGeometries, manholeGeometries, bollardGeometry, ringGeometry, instanced } from './details.js';
import { wireGeometry } from '../furniture/street-props.js';
import { applySway } from '../cloth-wind.js';

const MARK = { centre_dashed: 1, dashed: 1, centre: 2, solid: 2, edges: 3, dashed_edges: 4 };
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/**
 * @param {object} net normalized network (roads.normalizeRoadNetwork)
 * @param {{heightAt?:Function, theater?:string, quality?:string, trail?:{texture, width, depth}, weather?:object}} ctx
 * @returns {{group: THREE.Group, stats: object, setQuality(q:string):void, dispose():void, details:object}}
 */
export function buildPavement(net, ctx = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const group = new THREE.Group();
  group.name = 'pavement';
  const Y = groundFn(ctx.heightAt), YL = (x, z) => Y(x, z) + LIFT;
  const mats = [], geos = [], quality = ctx.quality || 'medium', tier = tierOf(quality);
  const stats = { roads: 0, areas: 0, meshes: 0, tris: 0, kerbM: 0, drains: 0, manholes: 0, bollards: 0, rails: 0 };
  const details = { drains: [], manholes: [], bollards: [], rings: [], stanchions: [], chains: [], rubble: [] };
  const rubble = (craters, seed, raise = 0) => { // broken setts / tar chunks thrown around each shell crater
    const R = rnd(seed * 31 + 7);
    for (const [cx, cz, cr] of craters) for (let k = 0; k < 16 + cr * 8; k++) {
      const a = R() * 6.283, d = cr * (0.25 + 1.2 * Math.sqrt(R())), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      details.rubble.push({ x, y: YL(x, z) + raise + 0.02, z, rot: R() * 6.28, rx: R() * 3, rz: R() * 3, s: 0.06 + 0.16 * R() * R() });
    }
  };
  const add = (geo, mat, { shadow = false, order = 0 } = {}) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.castShadow = shadow; m.renderOrder = order;
    m.userData.pavement = true;
    geos.push(geo); group.add(m); stats.meshes++; stats.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    return m;
  };
  const mat = (surface, r, extra = {}) => {
    const m = pavementMaterial(surface, { theater: ctx.theater, quality, trail: ctx.trail, weather: ctx.weather,
      wear: r.wear, cracks: r.cracks, patches: r.patches, weeds: r.weeds, puddles: r.puddles, ragged: r.edge === 'ragged', ...extra });
    mats.push(m);
    return m;
  };
  const kerbMat = detailMaterial('kerb', tier), paintMat = detailMaterial('paint', tier);

  for (const r of net.roads) {
    const S = SURFACES[r.surface];
    if (!S?.hard) continue;
    stats.roads++;
    const line = sampleCenterline(r.points, 0.5, r.spline), hw = r.width / 2;
    const gutter = r.kerb?.gutter ? 0.35 : 0;
    const m = mat(r.surface, r);
    for (const g of ribbonGeometries(line, { t0: -hw, t1: hw, hw, y: Y, gutter, marking: MARK[r.markings] || 0, craters: r.craters, road: 1 })) add(g, m);
    const R = rnd(r.seed);
    for (const side of [1, -1]) {
      const sideOk = (o) => o && (o.side === 'both' || (o.side === 'left') === (side > 0));
      if (sideOk(r.kerb)) {
        const band = r.kerb.paint === 'blackout' ? (s) => Math.floor(s / 1.0) % 2 : null;
        const [a, b] = extrudeProfile(line, kerbProfile(r.kerb.h, r.kerb.w), { side, t: side * hw, y: YL, uvScale: 2.24, group: band });
        add(a, kerbMat, { shadow: true }); add(b, paintMat, { shadow: true });
        stats.kerbM += line[line.length - 1].s;
        if (r.kerb.drains > 0) {
          for (let s = r.kerb.drains * (0.3 + 0.4 * R()); s < line[line.length - 1].s - 1; s += r.kerb.drains * (0.8 + 0.4 * R())) {
            const p = line.find((q) => q.s >= s) || line[line.length - 1], t = side * (hw - 0.2);
            const x = p.x - p.tz * t, z = p.z + p.tx * t;
            details.drains.push({ x, y: YL(x, z) - 0.02, z, rot: -Math.atan2(p.tz, p.tx) });
          }
        }
      }
      if (sideOk(r.sidewalk) && r.kerb) {
        const i0 = hw + r.kerb.w, i1 = i0 + r.sidewalk.w;
        const t0s = side > 0 ? i0 : -i1, t1s = side > 0 ? i1 : -i0;
        const sw = mat(r.sidewalk.surface, { ...r, wear: 0.2, patches: 0, edge: 'hard' });
        for (const g of ribbonGeometries(line, { t0: t0s, t1: t1s, hw: i1, y: Y, raise: r.kerb.h, edge: (t) => i1 - Math.abs(t) + 1, road: 0 })) add(g, sw);
        const [sk] = extrudeProfile(line, skirtProfile(r.kerb.h), { side, t: side * i1, y: YL, uvScale: 2.24 });
        add(sk, kerbMat);
      }
    }
    if (r.manholes > 0) {
      for (let s = r.manholes * R(); s < line[line.length - 1].s - 2; s += r.manholes * (0.7 + 0.6 * R())) {
        const p = line.find((q) => q.s >= s), t = (R() - 0.5) * hw;
        const x = p.x - p.tz * t, z = p.z + p.tx * t;
        details.manholes.push({ x, y: YL(x, z) + 0.004, z, rot: R() * 6.28 });
      }
    }
    if (r.rails) buildRails(r, line, YL, add, stats);
    if (r.craters.length) rubble(r.craters, r.seed);
  }

  for (const a of net.areas) {
    const S = SURFACES[a.surface];
    if (!S?.hard) continue;
    stats.areas++;
    add(areaGeometry(a, Y), mat(a.surface, a, { ragged: a.edge === 'ragged' && !a.kerb && !(a.raise > 0.05) }));
    const top = a.raise + (a.kerb ? a.kerb.h : 0);
    if (a.craters.length) rubble(a.craters, a.seed, top);
    const quayEdges = new Set(a.quay ? a.quay.edges : []);
    a.points.forEach((_, i) => {
      const { line, side, length } = polygonEdgePath(a.points, i);
      if (quayEdges.has(i)) {
        const [c] = extrudeProfile(line, copingProfile(top + LIFT), { side, y: Y, uvScale: 2.24 });
        add(c, kerbMat, { shadow: true });
        const [w] = extrudeProfile(line, quayWallProfile(top + LIFT), { side, y: () => 0, uvScale: 3 });
        add(w, detailMaterial('wall', tier));
        const R = rnd(a.seed + i);
        const nx = -line[0].tz * side, nz = line[0].tx * side;
        if (a.quay.bollards > 0) for (let s = a.quay.bollards * 0.5; s < length - 0.5; s += a.quay.bollards) {
          const x = line[0].x + line[0].tx * s - nx * 0.75, z = line[0].z + line[0].tz * s - nz * 0.75;
          details.bollards.push({ x, y: Y(x, z) + LIFT + top, z, rot: R() * 6.28, kind: 'quay' });
        }
        if (a.quay.railing) { // chain railing: iron stanchions along the coping, two swinging chains
          const posts = [];
          for (let s = 0.3; s < length; s += a.quay.railing === true ? 2.4 : a.quay.railing) {
            const x = line[0].x + line[0].tx * s - nx * 0.3, z = line[0].z + line[0].tz * s - nz * 0.3;
            posts.push([x, Y(x, z) + LIFT + top, z]);
          }
          details.stanchions.push(...posts.map(([x, y, z]) => ({ x, y, z, rot: 0 })));
          for (let k = 0; k < posts.length - 1; k++) for (const h of [0.55, 0.95]) details.chains.push({ a: [posts[k][0], posts[k][1] + h, posts[k][2]], b: [posts[k + 1][0], posts[k + 1][1] + h, posts[k + 1][2]] });
        }
        if (a.quay.rings) for (let s = 4 + R() * 2; s < length - 1; s += 7 + R() * 3) {
          const x = line[0].x + line[0].tx * s + nx * 0.05, z = line[0].z + line[0].tz * s + nz * 0.05;
          details.rings.push({ x, y: top - 0.5, z, rot: Math.atan2(nx, nz) });
        }
      } else if (a.kerb) {
        const [k] = extrudeProfile(line, kerbProfile(top + 0.025, a.kerb.w).map(([u, v]) => [-u, v]), { side, y: YL, uvScale: 2.24 });
        add(k, kerbMat, { shadow: true });
      } else if (top > 0.05) {
        const [k] = extrudeProfile(line, skirtProfile(top), { side, y: YL, uvScale: 2.24 });
        add(k, kerbMat, { shadow: true });
      }
    });
  }
  buildDetails(details, group, geos, tier, stats);
  stats.ms = typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0;
  return {
    group, stats, details, materials: mats,
    setQuality(q) { for (const m of mats) setPavementQuality(m, q); },
    dispose() { group.removeFromParent(); for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}

/** Embedded grooved tram rails (flush with the setts): polished head + dark groove per rail, per track. */
function buildRails(r, line, YL, add, stats) {
  const R = r.rails, steel = detailMaterial('steel'), groove = detailMaterial('groove');
  const offsets = R.tracks > 1 ? [-R.spacing / 2, R.spacing / 2] : [0];
  for (const o of offsets) for (const rs of [-1, 1]) {
    const t = R.offset + o + rs * R.gauge / 2;
    const [head] = extrudeProfile(line, [[-0.03, 0.008], [0.03, 0.008]], { side: 1, t, y: YL, uvScale: 1 });
    const [gr] = extrudeProfile(line, [[-rs * 0.03, 0.006], [-rs * 0.065, 0.006]], { side: 1, t, y: YL, uvScale: 1 });
    add(head, steel, { order: 1 }); add(gr, groove, { order: 1 });
    stats.rails += line[line.length - 1].s;
  }
}

let CHAIN = null;
/** Instanced drains, manholes, bollards, rings, stanchions (one draw call per part) + quay chains. */
function buildDetails(d, group, geos, tier, stats) {
  const put = (geo, mat, list, o) => {
    if (!list.length) return;
    geos.push(geo);
    const m = instanced(geo, mat, list, o);
    m.userData.pavement = true;
    group.add(m);
  };
  if (d.drains.length) {
    const g = drainGeometries();
    put(g.hole, detailMaterial('hole'), d.drains, { shadow: false });
    put(g.iron, detailMaterial('iron'), d.drains);
  }
  if (d.manholes.length) {
    const g = manholeGeometries();
    put(g.grate, detailMaterial('grate', tier), d.manholes, { shadow: false });
    put(g.iron, detailMaterial('iron'), d.manholes, { shadow: false });
  }
  put(bollardGeometry('quay'), detailMaterial('iron'), d.bollards.filter((b) => b.kind === 'quay'));
  put(ringGeometry(), detailMaterial('iron'), d.rings);
  put(new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.6, 1), detailMaterial('rubble', tier), d.rubble);
  put(bollardGeometry('street').scale(0.35, 1.15, 0.35), detailMaterial('iron'), d.stanchions);
  if (d.chains.length) {
    const g = wireGeometry(d.chains, { sag: 0.14, r: 0.012, seg: 8 });
    const m = new THREE.Mesh(g, CHAIN ||= applySway(new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.7 })));
    m.castShadow = true; m.userData.pavement = true; geos.push(g); group.add(m);
  }
  stats.drains = d.drains.length; stats.manholes = d.manholes.length; stats.bollards = d.bollards.length;
}
