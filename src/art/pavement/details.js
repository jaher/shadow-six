/**
 * Pavement details (step 3p): shared materials and small instanced pieces — gutter drain grates, manhole covers,
 * cast-iron quay bollards, mooring rings, embedded tram rails, level-crossing timbers.
 * @module art/pavement/details
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial } from '../dressing.js';
import { scopedMemo, pendingTextureBytes } from '../../engine/scoped-assets.js';

const HAS_DOM = typeof document !== 'undefined';
const BASE = new URL('../../../assets/textures/pavement/', import.meta.url).href;
const M = new Map();
const T = new Map();
function tex(file, srgb, rep = 1) {
  // mission-scoped (engine/scoped-assets.js): freed once no kept mission uses it
  return scopedMemo('pavement:detailtex', T, file + rep, () => {
    const t = new THREE.TextureLoader().load(BASE + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.repeat.set(rep, rep);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, { bytes: pendingTextureBytes, free: (t) => t.dispose() });
}

/**
 * Shared detail materials: kerb (granite), paint (blackout white), wall (quay masonry), iron (cast iron, black
 * paint), steel (rail heads), groove (dark rail groove), grate (drain / manhole cover), timber (creosote).
 */
export function detailMaterial(name, tier = '1k') {
  // the shared dressing materials (wall, timber) belong to dressing.js's own cache
  return scopedMemo('pavement:detail', M, name + tier, () => makeDetailMaterial(name, tier), { free: (m) => { if (!m.userData.dressing) m.dispose(); } });
}

function makeDetailMaterial(name, tier) {
  let m;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  if (!HAS_DOM) m = std({ color: 0x808080 });
  else if (name === 'kerb' || name === 'paint') {
    m = std({
      color: name === 'paint' ? 0xf0eee6 : 0xc9cacd, map: name === 'paint' ? null : tex(`${tier}/flags_diff.jpg`, true),
      normalMap: tex(`${tier}/flags_nor.jpg`, false), roughness: name === 'paint' ? 0.75 : 0.85, side: THREE.DoubleSide,
    });
  } else if (name === 'wall') m = dressingMaterial('stone');
  else if (name === 'iron') m = std({ color: 0x1d1e20, roughness: 0.55, metalness: 0.6 });
  else if (name === 'steel') m = std({ color: 0x9a9da2, roughness: 0.3, metalness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  else if (name === 'groove') m = std({ color: 0x151412, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  else if (name === 'grate') {
    m = std({ color: 0x55504a, map: tex(`${tier}/grate_diff.jpg`, true), normalMap: tex(`${tier}/grate_nor.jpg`, false), roughness: 0.6, metalness: 0.7 });
  } else if (name === 'timber') m = dressingMaterial('creosote');
  else if (name === 'hole') m = std({ color: 0x050505, roughness: 1 });
  else if (name === 'rubble') m = std({ color: 0x6d6a66, map: tex(`${tier}/setts_diff.jpg`, true), roughness: 0.95 });
  else m = std({ color: 0x808080 });
  m.name = `pavement-detail:${name}`;
  return m;
}

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Gutter drain: dark sump + cast-iron frame with longitudinal bars (local X along the kerb). */
export function drainGeometries() {
  const bars = [box(0.56, 0.02, 0.03, 0, 0, -0.17), box(0.56, 0.02, 0.03, 0, 0, 0.17), box(0.03, 0.02, 0.37, -0.265, 0, 0), box(0.03, 0.02, 0.37, 0.265, 0, 0)];
  for (let k = -3; k <= 3; k++) bars.push(box(0.5, 0.018, 0.022, 0, -0.002, k * 0.045));
  return { iron: mergeGeometries(bars), hole: new THREE.PlaneGeometry(0.52, 0.33).rotateX(-Math.PI / 2).translate(0, -0.012, 0) };
}

/** Manhole: cast diamond-pattern cover in a raised iron ring. */
export function manholeGeometries() {
  const cover = new THREE.CylinderGeometry(0.31, 0.31, 0.02, 28);
  const uv = cover.attributes.uv, P = cover.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, P.getX(i) * 1.6 + 0.5, P.getZ(i) * 1.6 + 0.5);   // planar: pattern across the lid
  const ring = new THREE.TorusGeometry(0.34, 0.035, 5, 28).rotateX(Math.PI / 2).scale(1, 0.35, 1);
  return { grate: cover, iron: ring };
}

/** Quay mooring bollard (cast iron, bulbous head, slight lip) and its granite plinth. */
export function bollardGeometry(kind = 'quay') {
  if (kind === 'street') {
    const pts = [[0, 0], [0.11, 0], [0.1, 0.1], [0.085, 0.75], [0.1, 0.8], [0.09, 0.86], [0.05, 0.9], [0, 0.91]].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 14);
  }
  const pts = [[0, 0], [0.2, 0], [0.19, 0.06], [0.14, 0.12], [0.13, 0.42], [0.19, 0.5], [0.2, 0.56], [0.16, 0.62], [0.06, 0.66], [0, 0.66]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 16);
}

/** Iron mooring ring hanging on the quay wall (local +Z = out of the wall). */
export function ringGeometry() {
  return mergeGeometries([new THREE.TorusGeometry(0.12, 0.018, 6, 16).translate(0, -0.14, 0.05), box(0.06, 0.08, 0.05, 0, 0, 0.02)].map((g) => g.toNonIndexed()));
}

/** Instanced mesh from placements [{x, y, z, rot, s?}] (rot about Y). */
export function instanced(geo, mat, list, { shadow = true } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const o = new THREE.Object3D();
  list.forEach((p, i) => {
    o.position.set(p.x, p.y, p.z); o.rotation.set(p.rx ?? 0, p.rot ?? 0, p.rz ?? 0); o.scale.setScalar(p.s ?? 1); o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  });
  m.castShadow = shadow; m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}
