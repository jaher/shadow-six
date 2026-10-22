/**
 * M17 art pass: a dump of 200 l fuel drums on timber dunnage (crates variant `fuel_drums`): two rows standing,
 * a few lying chocked on top, Wehrmacht grey, rust-brown and one red-banded petrol drum per row, rolled hoops
 * and bungs. Local frame as props.js crates (w along x, d along z, standing on y 0). Visual only.
 * @module art/fuel-drums
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial } from './dressing.js';

const R_DRUM = 0.29, H_DRUM = 0.88;
let PAINTS = null;
function paints() {
  if (PAINTS) return PAINTS;
  const tint = (hex, name) => { const m = dressingMaterial('steel').clone(); m.color = new THREE.Color(hex); m.name = `fuel_drums:${name}`; return m; };
  PAINTS = [tint(0x5b5f57, 'grey'), tint(0x6b4a33, 'rust'), tint(0x4a4f3a, 'olive'), tint(0x8a3226, 'red')];
  return PAINTS;
}

/** One drum standing (or lying along x when `lie`) at (x, y, z): shell with two rolled hoops and a bung. */
function drum(x, y, z, lie, rotY) {
  const g = [new THREE.CylinderGeometry(R_DRUM, R_DRUM, H_DRUM, 16)];
  for (const t of [-0.3, 0.3]) g.push(new THREE.TorusGeometry(R_DRUM + 0.005, 0.012, 4, 16).rotateX(Math.PI / 2).translate(0, t * H_DRUM, 0));
  g.push(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8).translate(R_DRUM * 0.55, H_DRUM / 2 + 0.01, 0));
  const m = mergeGeometries(g.map((q) => q.toNonIndexed()), false);
  for (const q of g) q.dispose();
  if (lie) m.rotateX(Math.PI / 2); // lying across the stack (axis along z), bung up-side
  return m.rotateY(rotY).translate(x, y, z);
}

/**
 * @param {{w?: number, d?: number, id?: string, tiers?: number, red?: boolean}} p `tiers` 2 (M8's 2.2 m drum dumps):
 *   a second standing tier on planks over the first (whose hidden inner drums are left out); `red` false: no
 *   red-banded drums (M8's red drums are the explosive ones). Defaults draw the M17 / M3 single-tier stack unchanged.
 */
export function buildFuelDrumStack(p = {}) {
  const w = p.w ?? 4, d = p.d ?? 2, root = new THREE.Group(); root.name = 'kit:fuel_drums';
  const tiers = p.tiers === 2 ? 2 : 1, red = p.red !== false;
  let s = 0; for (const ch of String(p.id ?? 'drums')) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const by = [[], [], [], []], wood = [];
  const nx = Math.max(2, Math.floor((w - 0.2) / (2 * R_DRUM + 0.04))), nz = Math.max(1, Math.floor((d - 0.1) / (2 * R_DRUM + 0.04)));
  // (tiers 2: the drums spread a hair to fill the footprint edge to edge, the dunnage under the outer rows; tiers 1
  //  as M17 / M3 drew it)
  const PITCH = 2 * R_DRUM + 0.04, PX = tiers === 2 ? (w - 0.2) / nx : PITCH, PZ = tiers === 2 ? (d - 0.1) / nz : PITCH, ox = (PX - PITCH) / 2, oz = (PZ - PITCH) / 2;
  const X = (i) => -w / 2 + 0.1 + ox + R_DRUM + i * PX, Z = (j) => -d / 2 + 0.05 + oz + R_DRUM + j * PZ;
  const dunZ = tiers === 2 ? [Z(0) + 0.05, Z(nz - 1) - 0.05] : [-d / 2 + 0.25, d / 2 - 0.25];
  for (const z of dunZ) wood.push(new THREE.BoxGeometry(tiers === 2 ? w - 0.3 : w - 0.1, 0.1, 0.14).translate(0, 0.05, z).toNonIndexed()); // dunnage
  const paint = (i) => (red && i === 1 ? 3 : Math.floor(R() * 3));
  // tier 2 (tiers 2): standing on planks laid over the first tier, a drum missing here and there
  const top = new Set(), y2 = 0.1 + H_DRUM + 0.05;
  if (tiers === 2) {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (R() < 0.1 && i > 0 && j > 0 && i < nx - 1 && j < nz - 1) continue;
      top.add(i * 1000 + j);
      by[paint(i)].push(drum(X(i) + (R() - 0.5) * 0.04, y2 + H_DRUM / 2, Z(j) + (R() - 0.5) * 0.04, false, R() * 6.28));
    }
    for (let j = 0; j < nz; j += 2) wood.push(new THREE.BoxGeometry(w - 0.4, 0.05, 0.22).translate(0, y2 - 0.025, Z(j)).toNonIndexed()); // planks
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const inner = i > 0 && j > 0 && i < nx - 1 && j < nz - 1;
    if (tiers === 2 && inner && top.has(i * 1000 + j)) continue;                    // hidden under the tier above
    if (tiers === 1 && R() < 0.08) continue;                                        // a gap where one was taken
    const k = paint(i);
    by[k].push(drum(X(i) + (R() - 0.5) * 0.04, 0.1 + H_DRUM / 2, Z(j) + (R() - 0.5) * 0.04, false, R() * 6.28));
  }
  const yTop = tiers === 2 ? y2 + H_DRUM : 0.1 + H_DRUM;
  for (let i = 0; i < Math.min(3, nx - 2); i++) {                                     // lying across the top, nested
    const x = -w / 2 + 0.1 + 2 * R_DRUM + 0.02 + i * (2 * R_DRUM + 0.04) + (tiers === 2 ? Math.floor(nx / 3) * PX : 0);
    by[Math.floor(R() * 3)].push(drum(x, yTop + R_DRUM, 0, true, 0));
  }
  const mats = paints();
  by.forEach((list, k) => { if (list.length) { const m = new THREE.Mesh(mergeGeometries(list, false), mats[k]); m.castShadow = m.receiveShadow = true; m.name = 'kit:fuel_drums:drums'; root.add(m); } });
  const wm = new THREE.Mesh(mergeGeometries(wood, false), dressingMaterial('planks')); wm.castShadow = wm.receiveShadow = true; root.add(wm);
  return root;
}
