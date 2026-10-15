/**
 * M7 "Chase of the Wolves" art pass (visual only; docs/missions/m07.md §5): the pieces the building library has no
 * model for — the slipway's heavy timber gantry over the rails, the burnt-out timber houses of the ruins field (charred
 * frames on their stone footings, a chimney stack still standing), the fish-drying racks along the E edge — and the two
 * big village houses drawn as compounds of Norwegian timber houses (an L-shaped tarred house, a red double house)
 * instead of one stretched model.
 * Nothing here touches the nav grid: every footprint stays the mission's structure.
 * @module missions/scripts/m07-art
 */
import * as THREE from 'three';
import { dressingMaterial, rng, seedOf, boulderGeometry, consolidate } from '../../art/dressing.js';
import { coverPropsWithSnow, propSnowAmount } from '../../art/terrain.js';
import { libraryVisual } from '../../art/building-props.js';

const deg = (d) => (d * Math.PI) / 180;

/** Box mesh (centre x, y, z; rotation about y) in material `m`. */
function bx(w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.rotation.y = ry;
  o.castShadow = true; o.receiveShadow = true;
  return o;
}

/** A timber member from a to b ([x, y, z] local), square section s. */
function beam(a, b, s, m) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
  const o = new THREE.Mesh(new THREE.BoxGeometry(s, L, s), m);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  o.castShadow = true; o.receiveShadow = true;
  return o;
}

const MATS = new Map();
/** Charred timber (the creosote set darkened and dulled) and the other finishes, cached per name. */
export function artMaterial(name) {
  if (MATS.has(name)) return MATS.get(name);
  let m;
  if (name === 'char') { m = dressingMaterial('creosote').clone(); m.color.setHex(0x4a4440); m.name = 'm07art:char'; }
  else if (name === 'ash') { m = dressingMaterial('mud').clone(); m.color.setHex(0x55504a); m.name = 'm07art:ash'; }
  else if (name === 'iron') m = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.55, metalness: 0.7, name: 'm07art:iron' });
  else if (name === 'pierPlanks') { m = dressingMaterial('planks').clone(); m.color.setHex(0xb4ab9e); m.name = 'm07art:pierPlanks'; delete m.userData.snowCover; } // the T pier's weathered deck (a clone keeps the flag, not the snow shader)
  else if (name === 'rope') m = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.95, name: 'm07art:rope' });
  else m = dressingMaterial(name);
  MATS.set(name, m);
  return m;
}

/**
 * The slipway gantry (dossier §5.1 `gantry`): two heavy timber portals 6 m apart over the rails, each a pair of
 * 0.45 m posts on stone pads with knee braces and a doubled cap beam, tied by two longitudinal beams that carry the
 * hoist's runway; a chain block hangs over the rails. Local frame: x along the portals' span (posts at ±span/2),
 * z between the portals (±gap/2); the posts stand on the gameplay posts.
 * @param {{span?: number, gap?: number, h?: number}} [o]
 */
export function buildGantry(o = {}) {
  const span = o.span ?? 10, gap = o.gap ?? 6, h = o.h ?? 6;
  const g = new THREE.Group(); g.name = 'm07art:gantry';
  const wood = artMaterial('creosote'), stone = artMaterial('stone'), iron = artMaterial('iron');
  for (const pz of [-gap / 2, gap / 2]) {
    for (const px of [-span / 2, span / 2]) {
      g.add(bx(0.8, 0.35, 0.8, stone, px, 0.12, pz));                  // stone pad
      g.add(bx(0.45, h, 0.45, wood, px, h / 2 + 0.25, pz));             // post
      const k = Math.sign(-px);                                         // knee brace towards the span's middle
      g.add(beam([px + k * 0.2, h - 1.4, pz], [px + k * 1.5, h + 0.05, pz], 0.2, wood));
      for (const dz of [-0.24, 0.24]) g.add(beam([px, 0.35, pz + dz], [px, 0.35, pz + dz * 4], 0.12, iron)); // foot straps
    }
    // doubled cap beam with iron bolts
    for (const dz of [-0.13, 0.13]) g.add(bx(span + 1.2, 0.5, 0.24, wood, 0, h + 0.5, pz + dz));
    for (const px of [-span / 2, span / 2]) g.add(bx(0.06, 0.06, 0.62, iron, px, h + 0.5, pz));
  }
  // two longitudinal ties on the caps + the hoist runway between them
  for (const px of [-span / 2 + 0.3, span / 2 - 0.3]) g.add(bx(0.3, 0.35, gap + 1.2, wood, px, h + 0.92, 0));
  g.add(bx(0.25, 0.3, gap + 1.6, wood, 0, h + 0.92, 0));
  // diagonal wind braces between the portals (top only: the rails and the walk stay open)
  for (const px of [-span / 2, span / 2]) g.add(beam([px, h - 0.6, -gap / 2 + 0.25], [px, h + 0.25, -gap / 2 + 2.2], 0.16, wood));
  // chain block over the rails: trolley, chain, block, hook
  g.add(bx(0.5, 0.25, 0.35, iron, 0, h + 0.62, 0.6));
  g.add(beam([0, h + 0.5, 0.6], [0, 3.1, 0.6], 0.05, iron));
  g.add(bx(0.32, 0.45, 0.22, iron, 0, 2.85, 0.6));
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 12, Math.PI * 1.4), iron);
  hook.position.set(0, 2.5, 0.6); hook.castShadow = true; g.add(hook);
  return g;
}

/**
 * The finger pier's root deck (the library T pier's head is cut back to the deck's width, `hideParts`, so it no longer
 * lies over the U-boats' sterns; its head boards spanned the whole head and went with it): cross boards on three
 * stringers, a kerb along each edge and two rows of tarred piles, from `from` to `to` m along the pier's axis (its
 * centre = 0), `width` m across, the boards' top at `top` m. Local frame: x along the pier, z across.
 * @param {{from: number, to: number, width: number, top?: number}} o
 */
export function pierRootDeck(o) {
  const g = new THREE.Group(); g.name = 'm07art:pierRoot';
  const planks = artMaterial('pierPlanks'), wood = artMaterial('creosote'), R = rng(seedOf('m07pierRoot'));
  const top = o.top ?? 0.34, W = o.width, L = o.to - o.from;
  for (let x = o.from + 0.22; x < o.to; x += 0.44) {
    const b = bx(0.41, 0.08, W - 0.1 + R() * 0.06, planks, x, top - 0.04 - R() * 0.012, (R() - 0.5) * 0.04);
    b.rotation.z = (R() - 0.5) * 0.01;
    g.add(b);
  }
  for (const z of [-W / 2 + 0.35, 0, W / 2 - 0.35]) g.add(bx(L, 0.3, 0.25, wood, o.from + L / 2, top - 0.22, z));
  for (const z of [-W / 2 + 0.12, W / 2 - 0.12]) {
    g.add(bx(L, 0.14, 0.24, wood, o.from + L / 2, top + 0.03, z)); // kerb
    for (let x = o.from + 0.6; x < o.to - 0.3; x += 2.4) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 3.2, 10), wood);
      p.position.set(x, top - 1.65, z); p.castShadow = true; p.receiveShadow = true;
      g.add(p);
    }
  }
  return g;
}

/**
 * A burnt-out Norwegian timber house (dossier §5.1 `ruin_*`, `B.LOW`, see-through): the fieldstone footing, broken in
 * places; the stone chimney stack still standing at one gable; charred corner posts and studs snapped at uneven
 * heights; a fallen sill and roof rafters leaning in; an ash bed and charred planks inside. Local frame centred,
 * w along x, d along z; seeded by the structure id so every ruin differs.
 * @param {{w?: number, d?: number, h?: number, id?: string}} p
 */
export function burntRuin(p = {}) {
  const w = p.w ?? 5, d = p.d ?? 4, h = p.h ?? 3, R = rng(seedOf(`m07ruin:${p.id ?? ''}`));
  const g = new THREE.Group(); g.name = 'm07art:ruin';
  const char = artMaterial('char'), stone = artMaterial('stone'), ash = artMaterial('ash');
  const hw = w / 2 - 0.2, hd = d / 2 - 0.2;
  // footing: four runs of 0.35 m fieldstone, each with a gap knocked out of it
  const runs = [[[-hw, -hd], [hw, -hd]], [[hw, -hd], [hw, hd]], [[hw, hd], [-hw, hd]], [[-hw, hd], [-hw, -hd]]];
  for (const [[ax, az], [bx2, bz]] of runs) {
    const L = Math.hypot(bx2 - ax, bz - az), ux = (bx2 - ax) / L, uz = (bz - az) / L;
    const g0 = 0.25 + R() * (L - 1.4), g1 = g0 + 0.5 + R() * 0.6;   // the gap
    for (const [s0, s1] of [[0, g0], [g1, L]]) {
      if (s1 - s0 < 0.2) continue;
      const m = (s0 + s1) / 2, hgt = 0.3 + R() * 0.25;
      g.add(bx(Math.abs(ux) > 0.5 ? s1 - s0 : 0.4, hgt, Math.abs(uz) > 0.5 ? s1 - s0 : 0.4, stone, ax + ux * m, hgt / 2, az + uz * m));
    }
  }
  // the chimney stack at one gable (the tallest thing left), its top ragged
  const cx = (R() < 0.5 ? -1 : 1) * (hw - 0.45), cz = (R() - 0.5) * d * 0.4, ch = h + 0.4 + R() * 0.8;
  g.add(bx(0.85, ch, 0.85, stone, cx, ch / 2, cz));
  g.add(bx(0.55, 0.35, 0.6, stone, cx + (R() - 0.5) * 0.2, ch + 0.15, cz));
  // charred posts at the corners and studs along the long walls, snapped at uneven heights; one leans
  const posts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (let x = -hw + 1.2; x < hw - 0.6; x += 1.1 + R() * 0.4) posts.push([x, R() < 0.5 ? -hd : hd]);
  for (const [px, pz] of posts) {
    if (Math.hypot(px - cx, pz - cz) < 0.9 || R() < 0.18) continue;
    const ph = 0.6 + R() * (h - 0.6), lean = R() < 0.2 ? (R() - 0.5) * 0.5 : (R() - 0.5) * 0.08;
    const post = bx(0.17, ph, 0.17, char, px, ph / 2 + 0.3, pz);
    post.rotation.z = lean; post.rotation.x = (R() - 0.5) * 0.08;
    g.add(post);
  }
  // the lower courses of two walls survive: charred horizontal boards, burnt back to ragged lengths
  for (const side of [R() < 0.5 ? -1 : 1, 2]) {
    const along = side !== 2, L = along ? w - 0.6 : d - 0.6, off = along ? side * hd : (cx > 0 ? -hw : hw);
    for (let k = 0, y = 0.55; k < 3 + Math.floor(R() * 3); k++, y += 0.2) {
      const len = L * (0.25 + R() * 0.6), c0 = (R() - 0.5) * (L - len);
      g.add(along ? bx(len, 0.17, 0.07, char, c0, y, off) : bx(0.07, 0.17, len, char, off, y, c0));
    }
  }
  // a surviving wall plate on one side, a fallen sill, two rafters leaning in from the gable
  g.add(beam([-hw, h * 0.72, -hd], [-hw + w * (0.45 + R() * 0.2), h * (0.55 + R() * 0.15), -hd], 0.16, char));
  g.add(beam([-hw * 0.8, 0.35, hd * (R() - 0.5)], [hw * 0.6, 0.12, hd * (R() - 0.5) * 1.6], 0.18, char));
  for (const dz of [-hd * 0.5, hd * 0.35]) g.add(beam([-cx * 0.9, 0.2, dz], [-cx * 0.15, h * 0.65, dz + (R() - 0.5) * 0.4], 0.14, char));
  // ash bed (a thin dark slab inside the footing) with charred planks and stones fallen on it
  const bed = bx(w - 0.9, 0.06, d - 0.9, ash, 0, 0.03, 0); bed.castShadow = false; g.add(bed);
  for (let k = 0; k < 5; k++) {
    const pl = bx(0.9 + R() * 0.9, 0.05, 0.18, char, (R() - 0.5) * (w - 1.6), 0.09 + k * 0.012, (R() - 0.5) * (d - 1.6), R() * Math.PI);
    pl.castShadow = false; g.add(pl);
  }
  for (let k = 0; k < 4; k++) {
    const s = 0.15 + R() * 0.15;
    const b = new THREE.Mesh(boulderGeometry(s, s * 0.6, s * 0.8, Math.floor(R() * 1e9), 1), stone);
    b.position.set((R() - 0.5) * (w - 1.2), 0.05, (R() - 0.5) * (d - 1.2)); b.castShadow = true; g.add(b);
  }
  return g;
}

/** Hide a structure's own visual (its gameplay footprint, interactables and nav stay). */
function hideStructure(world, id) {
  const o = world.structures?.get?.(id)?.object3d;
  if (o) o.visible = false;
  return !!o;
}

/**
 * Install the art pass (missions/m07 `script`): the gantry over the posts, a burnt frame on every ruin, the drying racks
 * and the village compounds (library parts placed on the parent's footprint). Browser only (no scene in node runs).
 * @param {object} world
 * @param {{gantry?: object, ruins?: string[], parts?: Object<string, object[]>, pierRoot?: object}} art
 */
export function installM07Art(world, art) {
  if (!world?.scene || !art || world._m07Art) return null;
  world._m07Art = true;
  const root = new THREE.Group(); root.name = 'm07art';
  const gy = (x, z) => (typeof world.groundY === 'function' ? world.groundY(x, z) : 0) || 0;
  const G = art.gantry;
  if (G) {
    const v = buildGantry(G);
    v.position.set(G.x, gy(G.x, G.z), G.z); v.rotation.y = -deg(G.rot);
    root.add(v);
    for (const id of G.posts || []) hideStructure(world, id);
  }
  for (const id of art.ruins || []) {
    const d = world.structures?.get?.(id)?.def;
    if (!d || !hideStructure(world, id)) continue;
    const v = burntRuin(d);
    v.position.set(d.x, gy(d.x, d.z), d.z); v.rotation.y = -(d.rot ?? 0);
    root.add(v);
  }
  const PR = art.pierRoot, pier = PR && world.structures?.get?.(PR.id)?.def;
  if (pier) {
    const v = pierRootDeck(PR);
    v.position.set(pier.x, world.structures.get(PR.id).object3d?.position?.y ?? 0, pier.z); v.rotation.y = -(pier.rot ?? 0);
    root.add(v);
  }
  if (art.mole) {
    const G = world.grid, wet = new Set([5, 6]); // T.WATER, T.SHALLOW
    const isLand = (x, z) => { if (!G) return true; const c = G.worldToCell(x, z); return G.inBounds(c.i, c.j) && !wet.has(G.terrain[G.idx(c.i, c.j)]); };
    root.add(moleCoping(art.mole.edge, { isLand, avoid: art.mole.avoid, groundY: gy }));
  }
  consolidate(root); // one mesh per finish for the whole pass (gantry, frames, coping): a handful of draws
  coverPropsWithSnow(root, propSnowAmount().value || 1); // built after the scene's prop snow pass: the same snow
  world.scene.add(root);
  if (art.sink?.length && typeof world.onBelTick === 'function') world.onBelTick((dt) => sinkTick(world, art.sink, dt));
  const parts = placeParts(world, art.parts || {}, gy);
  // the library parts are live LOD entries: released with the world (world.dispose runs its _subs)
  if (parts.length && Array.isArray(world._subs)) world._subs.push(() => { for (const p of parts) p.dispose?.(); });
  return { root, parts };
}

/** Library parts standing in for a structure's visual (`parts[id]`: [{asset, type, x, z, w, d, rot (deg), mirror?: 'x'|'z' (artMirror)}]). */
function placeParts(world, spec, gy) {
  const out = [];
  for (const [id, list] of Object.entries(spec)) {
    if (!hideStructure(world, id)) continue;
    for (const [k, q] of list.entries()) {
      const vis = libraryVisual(q.type ?? 'house', { id: `${id}:art${k}`, asset: q.asset, x: q.x, z: q.z, w: q.w, d: q.d, rot: deg(q.rot ?? 0), ...(q.mirror ? { artMirror: q.mirror } : {}) }, { theater: 'snow', missionId: 'm07' });
      if (!vis) continue;
      vis.object3d.position.y = gy(q.x, q.z);
      vis.object3d.name = `m07art:${id}:${q.asset}`;
      world.scene.add(vis.object3d);
      out.push(vis);
    }
  }
  return out;
}

/** How a sunk U-boat settles (dossier §11 'sinkStern'): stern first, bow awash, over SINK.t seconds. */
export const SINK = { t: 7, drop: 2.2, pitch: 0.06 };

/**
 * Visual only: a U-boat whose torpedo stack went up settles by the stern (the library model's holder drops and pitches
 * about the beam axis; the blown stack is gone). Driven from the destroyed flag, so a quickload of a sunk boat shows
 * it sunk too.
 */
function sinkTick(world, ids, dt) {
  for (const id of ids) {
    const t = world.interactables?.find?.((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id));
    const o = world.structures?.get?.(id)?.object3d;
    if (!t?.destroyed || !o) continue;
    const ud = o.userData;
    if ((ud.m07Sink ?? 0) >= 1) continue;
    let holder = null, stack = null;
    o.traverse((n) => { if (/^static-vehicle:/.test(n.name)) holder = n; if (n.name === 'torpedoStack') stack = n; });
    if (stack) stack.visible = false;
    if (!holder) continue;
    if (ud.m07SinkY0 == null) { ud.m07SinkY0 = holder.position.y; holder.rotation.order = 'ZYX'; }
    ud.m07Sink = Math.min(1, (ud.m07Sink ?? 0) + dt / SINK.t);
    const k = 1 - (1 - ud.m07Sink) ** 2; // eases out
    holder.position.y = ud.m07SinkY0 - SINK.drop * k;
    holder.rotation.z = SINK.pitch * k;   // about the beam: bow (+x) up, stern down
  }
}

/**
 * The lighthouse mole's granite coping (dossier §4: "snowy granite at the tip"): dressed blocks laid along its water edge
 * on the land side, iron bollards every few blocks; skipped on water cells and round the rim rocks. Visual only.
 * @param {number[][]} edge the mole's water edge, land on the left of the run's direction (x+, z+ map frame: inward = (dz, -dx))
 * @param {{isLand?: (x:number, z:number) => boolean, avoid?: number[][], groundY?: (x:number, z:number) => number}} [o]
 */
export function moleCoping(edge, o = {}) {
  const g = new THREE.Group(); g.name = 'm07art:mole';
  const granite = artMaterial('ashlar'), iron = artMaterial('iron'), R = rng(seedOf('m07mole'));
  const land = o.isLand ?? (() => true), Y = o.groundY ?? (() => 0);
  let n = 0;
  for (let i = 0; i + 1 < edge.length; i++) {
    const [ax, az] = edge[i], [bx2, bz] = edge[i + 1], L = Math.hypot(bx2 - ax, bz - az), dx = (bx2 - ax) / L, dz = (bz - az) / L;
    for (let s = 0.6; s < L - 0.3; s += 1.2) {
      const x = ax + dx * s + dz * 0.5, z = az + dz * s - dx * 0.5;
      if (!land(x, z) || (o.avoid || []).some(([rx, rz, r]) => Math.hypot(rx - x, rz - z) < r)) continue;
      const hgt = 0.32 + R() * 0.06;
      g.add(bx(1.14, hgt, 0.7, granite, x, Y(x, z) + hgt / 2 - 0.05, z, -Math.atan2(dz, dx)));
      if (++n % 7 === 0) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 10), iron);
        b.position.set(x + dz * 0.9, Y(x, z) + 0.25, z - dx * 0.9); b.castShadow = true; g.add(b);
      }
    }
  }
  return g;
}
