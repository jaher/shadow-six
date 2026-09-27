/**
 * Street furniture builder (PROGRESS step 3p): lamps (lamps.js), benches, bollards, Morris columns, signs, milestones,
 * level crossings, fences, telegraph lines + the wires of mission `telegraph_pole` structures (`wireTo`).
 * Identical pieces share one merged geometry per material and are drawn instanced; the lamp list doubles as the
 * light-emitter list for render/street-lights.js (night: emissive glass, pooled real lights, ground light pools).
 * @module art/furniture
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lampParts, LAMP_LIGHT } from './lamps.js';
import { propParts, signTexture, wireGeometry, fenceParts } from './street-props.js';
import { dressingMaterial, buildPole } from '../dressing.js';
import { applySway } from '../cloth-wind.js';

const HAS_DOM = typeof document !== 'undefined';
const MAT = new Map();
/** Shared furniture materials. glass: lit lantern glass (emissive driven by street-lights), glassDim: blackout. */
export function furnitureMaterial(name, extra = null) {
  const key = name + (extra ? '|' + extra : '');
  if (MAT.has(key)) return MAT.get(key);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  let m;
  switch (name) {
    case 'iron': m = S({ color: 0x1b221d, roughness: 0.5, metalness: 0.55 }); break;
    case 'glass': m = S({ color: 0x0b0a08, roughness: 0.25, metalness: 0.0, emissive: 0xffa24c, emissiveIntensity: 0 }); break;
    case 'glassDim': m = S({ color: 0x1d2330, roughness: 0.1, metalness: 0.1, emissive: 0x8fa6ff, emissiveIntensity: 0 }); break;
    case 'glassBroken': m = S({ color: 0x141412, roughness: 0.35, metalness: 0.2 }); break;
    case 'enamel': m = S({ color: 0xe8e5da, roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide }); break;
    case 'hood': m = S({ color: 0x101010, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }); break;
    case 'wire': m = applySway(S({ color: 0x1e1e1e, roughness: 0.55, metalness: 0.4 })); break;
    case 'white': m = S({ color: 0xe6e3da, roughness: 0.6 }); break;
    case 'red': m = S({ color: 0xa3261e, roughness: 0.55 }); break;
    case 'wood': case 'timber': m = HAS_DOM ? dressingMaterial('creosote') : S({ color: 0x3f3226 }); break;
    case 'planks': m = HAS_DOM ? dressingMaterial('planks') : S({ color: 0x6d5d4a }); break;
    case 'poster': m = S({ color: 0xffffff, map: signTexture('poster'), roughness: 0.85 }); break;
    case 'sign': m = S({ color: 0xffffff, map: signTexture(extra?.split('|')[0] || 'plate', extra?.split('|')[1] || ''), roughness: 0.5 }); break;
    default: m = S({ color: 0x808080 });
  }
  m.name = `furniture:${key.replace(/[^\w|:.-]/g, "_")}`; // (SHADER_NAME: no newlines)
  MAT.set(key, m);
  return m;
}

const merged = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false) : null);
const _o = new THREE.Object3D();

/**
 * @param {{items: object[], lines: object[]}} F expanded furniture (world/roads.js expandFurniture)
 * @param {{groundAt?:(x:number,z:number)=>number, poles?:{object3d:THREE.Object3D, def:object}[], polesById?:Map}} ctx
 * @returns {{group, emitters: object[], stats: object, dispose(): void}}
 */
export function buildFurniture(F, ctx = {}) {
  const group = new THREE.Group(); group.name = 'furniture';
  const Y = ctx.groundAt || (() => 0), geos = [], emitters = [];
  const stats = { lamps: 0, props: 0, poles: 0, wireSpans: 0, instanced: 0 };
  const buckets = new Map();   // key → {parts, list}
  const bucket = (key, make) => { if (!buckets.has(key)) buckets.set(key, { parts: make(), list: [] }); return buckets.get(key); };
  for (const it of F.items) {
    if (it.kind === 'fence' || it.kind === 'telegraph') continue;
    const y = it.y ?? Y(it.x, it.z);
    if (it.kind === 'lamp') {
      const key = `lamp|${it.variant}|${it.hooded ? 1 : 0}|${it.damaged ? 1 : 0}`;
      const b = bucket(key, () => lampParts(it.variant, { hooded: it.hooded }));
      b.damaged = it.damaged; b.hooded = it.hooded;
      b.list.push({ ...it, y });
      stats.lamps++;
      const ang = -it.rot, lean = ((it.lean || 0) * Math.PI) / 180;
      _o.position.set(it.x, y, it.z); _o.rotation.set(0, ang, lean ? -lean : 0); _o.updateMatrix();
      const L = LAMP_LIGHT[it.variant] || LAMP_LIGHT.paris_single;
      for (const p of [b.parts.light, b.parts.light.extra].filter(Boolean)) {
        const w = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(_o.matrix);
        emitters.push({ x: w.x, y: w.y, z: w.z, ground: y, variant: it.variant, kind: b.parts.light.kind || 'lamp', hooded: !!it.hooded, lit: it.lit !== false && !it.damaged,
          color: L.color, intensity: L.intensity * (it.hooded ? 0.25 : 1), range: L.range * (it.hooded ? 0.6 : 1), pool: L.pool * (it.hooded ? 0.55 : 1), rot: it.rot, id: it.id });
      }
    } else {
      const text = it.text ?? (it.kind === 'milestone' ? 'N 13\n12 km' : it.variant === 'fingerpost' ? '' : 'STAVANGER');
      const key = `${it.kind}|${it.variant ?? ''}|${it.w ?? ''}|${it.gauge ?? ''}|${text}`;
      const b = bucket(key, () => ({ parts: propParts(it.kind, it) }));
      b.signKind = it.kind === 'milestone' ? 'milestone' : it.variant === 'wehrmacht' || it.variant === 'fingerpost' ? 'wehrmacht' : 'plate';
      b.text = it.variant === 'fingerpost' && !it.text ? 'SOLA 4 km' : text;
      b.list.push({ ...it, y });
      stats.props++;
    }
  }
  for (const [key, b] of buckets) {
    const P = b.parts.parts || b.parts;
    for (const [mname, list] of Object.entries(P)) {
      if (!Array.isArray(list) || !list.length) continue;
      const geo = merged(list);
      let mat;
      if (mname === 'glass') mat = furnitureMaterial(b.damaged ? 'glassBroken' : b.hooded ? 'glassDim' : 'glass');
      else if (mname === 'sign') mat = furnitureMaterial('sign', `${b.signKind}|${b.text}`);
      else mat = furnitureMaterial(mname);
      const m = new THREE.InstancedMesh(geo, mat, b.list.length);
      b.list.forEach((p, i) => {
        const lean = ((p.lean || 0) * Math.PI) / 180;
        _o.position.set(p.x, p.y, p.z); _o.rotation.set(0, -p.rot, lean ? -lean : 0); _o.scale.setScalar(1); _o.updateMatrix();
        m.setMatrixAt(i, _o.matrix);
      });
      m.castShadow = mname !== 'glass' && mname !== 'wire'; m.receiveShadow = true;
      m.computeBoundingSphere();
      m.name = `furniture:${key}:${mname}`;
      if (mname === 'glass') m.userData.lampGlass = true;
      geos.push(geo); group.add(m); stats.instanced++;
    }
  }
  const wireSpans = [];
  for (const it of F.items) {
    if (it.kind !== 'fence') continue;
    const P = fenceParts(it.points, it.variant, it.h, Y);
    for (const [mname, list] of Object.entries(P)) {
      if (!list.length) continue;
      if (mname === 'wire') { wireSpans.push(...list); continue; }
      const geo = merged(list), m = new THREE.Mesh(geo, furnitureMaterial(mname));
      m.castShadow = true; m.receiveShadow = true; m.name = `furniture:fence:${it.variant}`;
      geos.push(geo); group.add(m);
    }
    stats.fences = (stats.fences || 0) + 1;
  }
  buildLines(F, ctx, group, geos, stats, Y, wireSpans);
  return {
    group, emitters, stats,
    dispose() { group.removeFromParent(); for (const g of geos) g.dispose(); group.traverse((o) => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); }); },
  };
}

/** Insulator fixing points (world) of a buildPole() pole at (x, y, z) with arm angle `rot`. */
function insulators(x, y, z, rot, H, n) {
  const c = Math.cos(rot), s = Math.sin(rot), out = [];
  for (const lx of [-0.62, 0.62, -0.25, 0.25].slice(0, n)) out.push([x + lx * c - 0.13 * s, y + H - 0.28, z + lx * s + 0.13 * c]);
  return out;
}

/** Telegraph lines (poles + wires) and the wires of mission telegraph_pole structures. */
function buildLines(F, ctx, group, geos, stats, Y, extra = []) {
  const spans = [];
  const fenceWire = extra.length ? wireGeometry(extra, { sag: 0.05, r: 0.004, seg: 4 }) : null;
  if (fenceWire) { const m = new THREE.Mesh(fenceWire, furnitureMaterial('wire')); m.name = 'furniture:fence-wire'; geos.push(fenceWire); group.add(m); }
  for (const line of F.lines) {
    line.poles.forEach((p) => {
      const g = buildPole({ h: line.h }), y = Y(p.x, p.z);
      g.position.set(p.x, y, p.z); g.rotation.y = -p.rot;
      g.traverse((o) => { if (o.isMesh) o.userData.ownGeo = true; });
      group.add(g); stats.poles++;
      p.fix = insulators(p.x, y, p.z, p.rot, line.h, line.wires);
    });
    for (let k = 0; k < line.poles.length - 1; k++) for (let w = 0; w < line.wires; w++) spans.push({ a: line.poles[k].fix[w], b: line.poles[k + 1].fix[w] });
  }
  // mission structures: telegraph_pole {wireTo} (M1 coast road) — orient unrotated poles across their line
  const poles = ctx.poles || [], byId = new Map(poles.filter((p) => p.def.id).map((p) => [p.def.id, p]));
  for (const p of poles) {
    const to = p.def.wireTo && byId.get(p.def.wireTo);
    const from = poles.find((q) => q.def.wireTo === p.def.id);
    const dx = (to ? to.def.x : p.def.x) - (from ? from.def.x : p.def.x), dz = (to ? to.def.z : p.def.z) - (from ? from.def.z : p.def.z);
    p.rot = p.def.rot ?? (dx || dz ? Math.atan2(dz, dx) + Math.PI / 2 : 0);
    if (p.def.rot == null && p.object3d) p.object3d.rotation.y = -p.rot;
  }
  for (const p of poles) {
    const to = p.def.wireTo && byId.get(p.def.wireTo);
    if (!to) continue;
    const H = p.def.h ?? 7, H2 = to.def.h ?? 7;
    const a = insulators(p.def.x, p.object3d?.position.y ?? 0, p.def.z, p.rot, H, 4), b = insulators(to.def.x, to.object3d?.position.y ?? 0, to.def.z, to.rot, H2, 4);
    // keep wires on the same side: pair each insulator with the nearest one on the next pole
    for (const q of a) { let best = b[0], bd = 1e9; for (const r of b) { const d = Math.hypot(r[0] - q[0], r[2] - q[2]); if (d < bd) { bd = d; best = r; } } spans.push({ a: q, b: best }); }
  }
  if (!spans.length) return;
  const geo = wireGeometry(spans);
  const m = new THREE.Mesh(geo, furnitureMaterial('wire'));
  m.castShadow = true; m.name = 'furniture:wires';
  geos.push(geo); group.add(m);
  stats.wireSpans = spans.length;
}
