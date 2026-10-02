/**
 * The town past the map edge (world/edge-extend.js edgeBuildingRows): plain plaster houses and yard walls, the same
 * placeholder boxes as the map's flat-roofed houses (art/props-extra.js), merged into ONE mesh (one draw call + its
 * shadow pass). Visual only: no footprints, nav or roofs to walk. Their bases sink 1 m into the apron ground (which
 * is levelled under them: art/apron.js flatLines) so no gap shows on its undulation.
 * @module art/edge-buildings
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from './materials.js';

const SINK = 1;

/**
 * @param {{x:number, z:number, w:number, d:number, h:number, kind:string}[]} boxes
 * @param {string} [mat] the street's material
 * @returns {THREE.Mesh|null}
 */
export function buildEdgeBuildings(boxes, mat = 'plaster') {
  if (!boxes?.length) return null;
  const geos = boxes.map((b) => {
    const g = new THREE.BoxGeometry(b.w, b.h + SINK, b.d);
    g.translate(b.x, (b.h - SINK) / 2, b.z);
    return g;
  });
  const geo = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const m = new THREE.Mesh(geo, getMaterial(mat));
  m.name = 'props:edgeBuildings';
  m.castShadow = m.receiveShadow = true;
  m.userData.apron = true;
  return m;
}

/** Ground-levelling lines under the boxes (art/apron.js flatLines: {points, hw}), one along each box's long axis. */
export function edgeBuildingFlatLines(boxes) {
  return (boxes || []).map((b) => (b.w >= b.d
    ? { points: [[b.x - b.w / 2, b.z], [b.x + b.w / 2, b.z]], hw: b.d / 2 + 1.5 }
    : { points: [[b.x, b.z - b.d / 2], [b.x, b.z + b.d / 2]], hw: b.w / 2 + 1.5 }));
}
