/**
 * M7 "Chase of the Wolves" art pass (visual only; docs/missions/m07.md §5): the pieces the building library has no
 * model for — the slipway's heavy timber gantry over the rails, the fish-drying racks along the E edge — and the two
 * big village houses drawn as compounds of Norwegian timber houses (an L-shaped tarred house, a red double house)
 * instead of one stretched model. (The ruins field's bombed brick houses are the library's house_bombed_b again:
 * missions/m07 `ruin`.)
 * Nothing here touches the nav grid: every footprint stays the mission's structure.
 * @module missions/scripts/m07-art
 */
import * as THREE from 'three';
import { dressingMaterial, rng, seedOf, consolidate } from '../../art/dressing.js';
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
/** The pass's finishes (iron, the pier's weathered planks, rope; else the dressing set), cached per name. */
export function artMaterial(name) {
  if (MATS.has(name)) return MATS.get(name);
  let m;
  if (name === 'iron') m = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.55, metalness: 0.7, name: 'm07art:iron' });
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

/** Hide a structure's own visual (its gameplay footprint, interactables and nav stay). */
function hideStructure(world, id) {
  const o = world.structures?.get?.(id)?.object3d;
  if (o) o.visible = false;
  return !!o;
}

/**
 * Install the art pass (missions/m07 `script`): the gantry over the posts, the drying racks and the village compounds
 * (library parts placed on the parent's footprint). Browser only (no scene in node runs).
 * @param {object} world
 * @param {{gantry?: object, parts?: Object<string, object[]>, pierRoot?: object}} art
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
  consolidate(root); // one mesh per finish for the whole pass (gantry, pier deck, coping): a handful of draws
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
      const vis = libraryVisual(q.type ?? 'house', { id: `${id}:art${k}`, asset: q.asset, x: q.x, z: q.z, w: q.w, d: q.d, rot: deg(q.rot ?? 0), ...(q.mirror ? { artMirror: q.mirror } : {}), ...(q.fill ? { artFill: q.fill } : {}) }, { theater: 'snow', missionId: 'm07' });
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
