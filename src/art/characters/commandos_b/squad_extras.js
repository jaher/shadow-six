// Copied from scratchpad chars/commandos_b/pipeline/web/squad_extras.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// squad_extras.js - seeded kit extras per man (bible §5.2 "equipment variation"), procedural, own work (CC0).
// Every rifleman already carries belt, Y-straps, pouches, bread bag, canteen, gas-mask can and bayonet (baked). On top,
// per seed: M31 mess tin on the Y-strap back, rolled Zeltbahn across the back of the belt, entrenching tool on the left
// hip, helmet band (+ foliage sprigs), gas-cape pouch on the chest strap. Items are placed from the man's own skinned
// surface (back / hip / helmet extents measured at spawn) and parented to spine_03 / pelvis / Head, so they follow
// the animation. Budget: <= ~900 tris for all extras on one man, 1 shared material per item kind.
import * as THREE from 'three';
import { mulberry32 } from '../pipeline/variety.js';

const M = {};
function mat(k) {
  if (M[k]) return M[k];
  const S = (c, ro, me = 0) => new THREE.MeshStandardMaterial({ color: new THREE.Color(...c), roughness: ro, metalness: me });
  if (k === 'zelt') {   // splinter camo (Splittertarn-like, generic): angular patches + rain strokes
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#8a8466'; g.fillRect(0, 0, 64, 64); const r = mulberry32(77);
    for (const col of ['#5f6644', '#6e5a40', '#4d5a3c']) for (let i = 0; i < 5; i++) {
      g.fillStyle = col; g.beginPath(); const x = r() * 64, y = r() * 64; g.moveTo(x, y);
      for (let k = 0; k < 3; k++) g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.fill(); }
    g.strokeStyle = '#3f4a33'; for (let i = 0; i < 40; i++) { const x = r() * 64, y = r() * 64; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 1, y + 5); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    M[k] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 });
  }
  else M[k] = { tin: S([0.075, 0.085, 0.06], 0.55, 0.3), steel: S([0.04, 0.04, 0.038], 0.5, 0.6), leather: S([0.018, 0.015, 0.012], 0.6),
    wood: S([0.12, 0.07, 0.035], 0.7), band: S([0.02, 0.02, 0.018], 0.8), leaf: S([0.03, 0.05, 0.015], 0.85), leaf2: S([0.06, 0.07, 0.02], 0.85),
    cape: S([0.07, 0.075, 0.055], 0.85) }[k];
  if (k === 'leaf' || k === 'leaf2') M[k].side = THREE.DoubleSide;
  return M[k];
}
const mesh = (geo, k) => { const m = new THREE.Mesh(geo, mat(k)); m.castShadow = true; m.receiveShadow = true; return m; };

// skinned surface sample in root-local (unscaled) space at the current pose
function surface(h) {
  const root = h.object, inv = new THREE.Matrix4(); root.updateMatrixWorld(true); inv.copy(root.matrixWorld).invert();
  const pts = [], v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.visible || !o.geometry.attributes._mask || o.name === 'headgear') return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 2) { o.getVertexPosition(i, v); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld).applyMatrix4(inv); pts.push(v.x, v.y, v.z); }
  });
  return pts;
}
const backZ = (P, y, hw = 0.07) => { let z = 0; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - y) < 0.025 && Math.abs(P[i]) < hw) z = Math.min(z, P[i + 2]); return z; };
const sideX = (P, y, s) => { let x = 0; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - y) < 0.025 && P[i + 2] < 0.02) x = s > 0 ? Math.max(x, P[i]) : Math.min(x, P[i]); return x; };

function place(h, bone, obj, pos, rotY = 0, rotX = 0, rotZ = 0) {
  obj.position.copy(pos); obj.rotation.set(rotX, rotY, rotZ); h.object.add(obj); h.object.updateMatrixWorld(true);
  (h.bones[bone] || h.object).attach(obj);
}

export function addExtras(h, j, info) {
  const r = mulberry32(j.seed ^ 0xe7a5), B = h.bones, got = [];
  const P = surface(h); if (!P.length) return got;
  const belt = info.beltZ || (info.sockets || {}).beltZ || 1.05;
  // mess tin (kidney shape ~ 17 x 11 x 8 cm) high on the back, lid strap
  if (r() < 0.55) {
    const y = belt + 0.2 + r() * 0.04, z = backZ(P, y) - 0.045;
    const g = new THREE.Group();
    const body = mesh(new THREE.CapsuleGeometry(0.04, 0.1, 3, 10), 'tin'); body.scale.set(1, 1, 0.95); g.add(body);
    const strap = mesh(new THREE.BoxGeometry(0.1, 0.012, 0.085), 'leather'); strap.position.y = 0.02; g.add(strap);
    place(h, 'spine_03', g, new THREE.Vector3((r() - 0.5) * 0.04, y, z), 0, 0, Math.PI / 2 + (r() - 0.5) * 0.2); got.push('mess_tin');
  }
  // rolled Zeltbahn across the back above the belt
  if (r() < 0.4) {
    const y = belt + 0.07, z = backZ(P, y, 0.1) - 0.05;
    const roll = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.36, 10), 'zelt');
    place(h, 'spine_01', roll, new THREE.Vector3(0, y, z), 0, 0, Math.PI / 2); got.push('zeltbahn');
  }
  // entrenching tool (blade in leather carrier + handle) behind the left hip
  if (r() < 0.5) {
    const s = 1, y = belt - 0.13, x = sideX(P, y, s) * 0.85, z = backZ(P, y, 0.2) * 0.4 - 0.02;
    const g = new THREE.Group();
    const bl = mesh(new THREE.BoxGeometry(0.15, 0.17, 0.02), 'leather'); g.add(bl);
    const hd = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6), 'wood'); hd.position.y = 0.2; g.add(hd);
    place(h, 'pelvis', g, new THREE.Vector3(x + 0.02, y, z), -0.9 * s, 0.1, 0.15); got.push('shovel');
  }
  // gas-cape pouch on the chest (gas-mask can strap)
  if (r() < 0.3) {
    const y = belt + 0.28, z = -backZ(P, y) * 0 + 0.0; const zf = (() => { let m = 0; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - y) < 0.025 && Math.abs(P[i] + 0.06) < 0.04) m = Math.max(m, P[i + 2]); return m; })();
    const p = mesh(new THREE.BoxGeometry(0.1, 0.075, 0.03), 'cape');
    place(h, 'spine_03', p, new THREE.Vector3(-0.06, y, zf + 0.015 + z), 0, 0.1, 0.25); got.push('gas_cape');
  }
  // helmet band (+ foliage) - measured from the helmet mesh itself
  const hg = h.parts.headgear || Object.values(h.parts).find(m => m.name.includes('headgear'));
  if (hg && B.Head && r() < 0.45 && false) {   // disabled: a dark band reads as a torn helmet rim at close zoom (review)
    const inv = new THREE.Matrix4().copy(h.object.matrixWorld).invert(), v = new THREE.Vector3(), Q = [];
    const n = hg.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) { hg.getVertexPosition(i, v); if (hg.isSkinnedMesh) hg.applyBoneTransform(i, v); v.applyMatrix4(hg.matrixWorld).applyMatrix4(inv); Q.push(v.clone()); }
    const ymax = Math.max(...Q.map(q => q.y)), ymin = Math.min(...Q.map(q => q.y));
    const yb = ymin + (ymax - ymin) * 0.52, ring = Q.filter(q => Math.abs(q.y - yb) < 0.012);
    if (ring.length > 8) {
      const cx = ring.reduce((a, q) => a + q.x, 0) / ring.length, cz = ring.reduce((a, q) => a + q.z, 0) / ring.length;
      const rx = Math.max(...ring.map(q => Math.abs(q.x - cx))), rz = Math.max(...ring.map(q => Math.abs(q.z - cz)));
      const g = new THREE.Group();
      const band = mesh(new THREE.CylinderGeometry(1, 1, 0.018, 24, 1, true), 'band'); band.scale.set(rx + 0.004, 1, rz + 0.004); g.add(band);
      if (r() < 0.7) for (let k = 0, nk = 3 + Math.floor(r() * 4); k < nk; k++) {
        const a = (r() - 0.5) * Math.PI * 1.6 + (r() < 0.5 ? 0 : Math.PI), len = 0.07 + r() * 0.06;
        const leaf = mesh(new THREE.ConeGeometry(0.018 + r() * 0.012, len, 4, 1, true), r() < 0.5 ? 'leaf' : 'leaf2');
        leaf.position.set(Math.sin(a) * (rx + 0.006), len * 0.35, Math.cos(a) * (rz + 0.006));
        leaf.rotation.set(Math.cos(a) * -0.5, 0, Math.sin(a) * 0.5); g.add(leaf);
      }
      place(h, 'Head', g, new THREE.Vector3(cx, yb, cz)); got.push('helmet_band');
    }
  }
  h.extras = got;
  return got;
}
