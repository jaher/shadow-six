/**
 * An Alsatian vineyard at the end of November (M17 second art pass, Riveauvillé — Ribeauvillé's Riesling slopes): rows
 * of vines trained high on the Vosges trellis — weathered acacia stakes every 5 m, the end posts heavier and raked back
 * on an anchor wire, a fruiting wire at 0.6 m and two above it; each vine a gnarled knee-high trunk with last year's
 * cane tied along the fruiting wire and this year's canes standing bare to the top wire (they are pruned in January),
 * a few yellow leaves still on them. A `crates` structure with `variant: 'vineyard'` (art/props.js): local +X along
 * the rows (`w` their length), the rows spaced along Z, origin on the ground at the block's centre.
 * The layout (VINE, vineRowZ, vineNavParts) is pure data shared with the mission data: each row is one B.FENCE part —
 * the trellis stops feet, not eyes. Plain colours and no cane cards in node.
 * @module art/vineyard
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

const HAS_DOM = typeof document !== 'undefined';

/** Row spacing, vine spacing, stake spacing, stake height and wire heights (m). */
export const VINE = Object.freeze({ gap: 2.1, step: 1.15, post: 5.0, h: 1.8, wires: [0.6, 1.15, 1.7] });

/** Local z of row k of n (centred on the block). */
export const vineRowZ = (k, n) => (k - (n - 1) / 2) * VINE.gap;

/** Gameplay parts (structure frame): one B.FENCE strip per row, the length of its trellis. */
export function vineNavParts(p) {
  return Array.from({ length: p.rows }, (_, k) => ({ x: 0, z: vineRowZ(k, p.rows), w: p.w, d: 0.4, block: 3 }));
}

function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** A round piece from a to b (THREE.Vector3), radius r0 → r1, `sides` facets. */
function limb(a, b, r0, r1, sides = 5) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, sides, 1, true).translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z);
  return g.toNonIndexed();
}

let CANE_MAT = null;
/** The bare canes and the last leaves: one alpha-tested card texture (4 vines' worth side by side, drawn once). */
function caneMaterial() {
  if (CANE_MAT) return CANE_MAT;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d'), R = rng(1945);
  for (let q = 0; q < 4; q++) {
    const x0 = q * 128;
    for (let k = 0; k < 11; k++) {               // canes: from the cordon (bottom) up, a little bowed, knotted
      let x = x0 + 8 + R() * 112, y = 128;
      const lean = (R() - 0.5) * 0.5, top = 6 + R() * 40;
      g.strokeStyle = ['#4a3020', '#5a3a24', '#664630', '#3e2a1c'][k % 4]; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { const ny = 128 - ((128 - top) * (s + 1)) / 6; x += lean * 4 + (R() - 0.5) * 3; g.lineTo(x, ny); y = ny; }
      g.lineWidth = 2.6 - k * 0.08; g.stroke();
      if (R() < 0.5) { g.lineWidth = 1; g.beginPath(); g.arc(x + 3, y + 10, 3, 0, 5); g.stroke(); } // a tendril
    }
    for (let k = 0; k < 6; k++) {                // the last leaves: small, shrivelled, lobed, ochre to brown (fix round 1:
      const x = x0 + 10 + R() * 108, y = 34 + R() * 74, r = 1.8 + R() * 2.2, rot = R() * 6.28; // 7-cm pale pentagons read
      g.fillStyle = ['#a07c34', '#86602a', '#6e4c24', '#b08c40', '#7c5a2a'][k % 5];             // as flat cards at zoom 4)
      g.beginPath();
      for (let a = 0; a <= 20; a++) { const t = (a / 20) * Math.PI * 2, rr = r * (0.72 + 0.28 * Math.abs(Math.cos(2.5 * t)) + (R() - 0.5) * 0.2); g.lineTo(x + Math.cos(t + rot) * rr, y + Math.sin(t + rot) * rr * 0.8); }
      g.fill();
      g.strokeStyle = 'rgba(52, 36, 18, 0.8)'; g.lineWidth = 0.7;                                // the stalk and the curled edge
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(rot + 1.6) * r * 1.5, y + Math.sin(rot + 1.6) * r * 1.5); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  CANE_MAT = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  CANE_MAT.name = 'vineyard:canes';
  return CANE_MAT;
}

/** The card for one vine: a quad in the row plane (x across `x0..x1`, y `y0..y1`) showing quarter q of the texture. */
function card(x0, x1, y0, y1, z, q, flip, yaw) {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setX(i, (q + (flip ? 1 - u : u)) / 4); }
  if (yaw) { const cx = (x0 + x1) / 2; g.translate(-cx, 0, 0).rotateY(yaw).translate(cx, 0, 0); }
  return g.translate(0, 0, z).toNonIndexed();
}

/** @param {{w: number, rows: number, id?: string}} p */
export function buildVineyard(p) {
  const R = rng(String(p.id ?? 'vineyard').split('').reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261));
  const posts = [], wires = [], wood = [], cards = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const x0 = -p.w / 2 + 0.3, x1 = p.w / 2 - 0.3, nPost = Math.max(1, Math.round((x1 - x0) / VINE.post));
  for (let k = 0; k < p.rows; k++) {
    const z = vineRowZ(k, p.rows);
    for (let j = 0; j <= nPost; j++) {           // stakes; the end posts raked back, anchored to a peg 1 m out
      const x = x0 + ((x1 - x0) * j) / nPost, end = j === 0 || j === nPost, s = j === 0 ? -1 : 1;
      const top = end ? V(x + s * 0.32, VINE.h + 0.05, z) : V(x + (R() - 0.5) * 0.06, VINE.h - R() * 0.08, z + (R() - 0.5) * 0.05);
      posts.push(limb(V(x, -0.15, z), top, end ? 0.065 : 0.042, end ? 0.055 : 0.036));
      if (end) { wires.push(limb(V(x + s * 0.3, VINE.h - 0.05, z), V(x + s * 1.1, 0.02, z), 0.007, 0.007, 3)); posts.push(limb(V(x + s * 1.1, -0.1, z), V(x + s * 1.15, 0.18, z), 0.04, 0.035, 5)); }
    }
    for (const y of VINE.wires) wires.push(limb(V(x0, y, z), V(x1, y - 0.01, z), 0.006, 0.006, 3));
    for (let x = x0 + 0.6, i = 0; x < x1 - 0.4; x += VINE.step * (0.92 + R() * 0.16), i++) {
      const s = 1, b = V(x + (R() - 0.5) * 0.08, 0.5 + R() * 0.08, z + (R() - 0.5) * 0.06); // (Guyot: every cane laid the same way)
      wood.push(limb(V(x, -0.05, z), V(x + (R() - 0.5) * 0.1, 0.25, z + (R() - 0.5) * 0.05), 0.045, 0.038), limb(V(x, 0.24, z), b, 0.038, 0.03));
      wood.push(limb(b, V(x + s * 0.55, VINE.wires[0] + 0.02, z), 0.026, 0.018), limb(V(x + s * 0.55, VINE.wires[0] + 0.02, z), V(x + s * 0.95, VINE.wires[0] - 0.01, z), 0.018, 0.012));
      if (HAS_DOM) { const q = Math.floor(R() * 4); cards.push(card(x - 0.75, x + 0.75, VINE.wires[0] - 0.02, VINE.h + 0.25 + R() * 0.2, z, q, R() < 0.5, (R() - 0.5) * 0.5)); }
    }
  }
  const grp = new THREE.Group(); grp.name = 'dressing:vineyard';
  const add = (list, mat, name, shadow = true) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeGeometries(list, false), mat); for (const q of list) q.dispose();
    m.name = `vineyard:${name}`; m.castShadow = shadow; m.receiveShadow = true; grp.add(m);
  };
  add(posts, paintedMaterial('beam', 0x8a8478), 'stakes');
  add(wires, dressingMaterial('galv'), 'wires', false);
  add(wood, paintedMaterial('logHewn', 0xb4a490), 'vines'); // (old vine wood: grey-brown, shaggy)
  if (cards.length) add(cards, caneMaterial(), 'canes');
  return grp;
}
