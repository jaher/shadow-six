/**
 * The circus animals of "Winter Quarters" (LIGHTS OUT mission 3, docs/expansion/e03.md §13): procedural lions (two
 * maned males and a lioness) and ostriches (black-and-white cocks, grey-brown hens), in place of the BCD box
 * placeholders (art/animal-placeholder.js dispatches here). Built from shaded ellipsoids and tapered limbs on pivots,
 * animated procedurally: a four-beat walk and a bounding run (lions), a long-legged stride with the neck bobbing
 * (ostriches), a lunge / kick for the attack, breathing and a tail flick at rest, and a fall onto the side when dead.
 * Same model interface as art/humanoid.js ({root, setAnim, update, setColors, setDisguise, dispose}).
 * @module art/circus-animals
 */
import * as THREE from 'three';

const TAU = Math.PI * 2;

/** A shaded ellipsoid (radii rx, ry, rz) at (x, y, z), belly lighter, `col` / `belly` colours (vertex colours). */
function blob(rx, ry, rz, x, y, z, col, belly = null, { seg = 16, bumps = 0, seed = 1 } = {}) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7)));
  const P = g.attributes.position, c = new THREE.Color(col), b = new THREE.Color(belly ?? col), out = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    let px = P.getX(i), py = P.getY(i), pz = P.getZ(i);
    if (bumps) { // shaggy (a mane): low-frequency lumps
      const n = 1 + bumps * (Math.sin(px * 7.3 + seed) * Math.sin(py * 6.1 + seed * 2) * Math.sin(pz * 5.7 + seed * 3));
      px *= n; py *= n; pz *= n;
    }
    P.setXYZ(i, px * rx + x, py * ry + y, pz * rz + z);
    const t = Math.max(0, Math.min(1, (0.15 - py) * 1.6)); // underside → belly colour
    const k = 0.92 + 0.08 * Math.sin(px * 9 + pz * 7);    // a little mottling
    out[i * 3] = (c.r + (b.r - c.r) * t) * k; out[i * 3 + 1] = (c.g + (b.g - c.g) * t) * k; out[i * 3 + 2] = (c.b + (b.b - c.b) * t) * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}
/** A tapered limb from the pivot down -y: radii r0 (top) → r1, length L, colour. */
function limb(r0, r1, L, col, seg = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1);
  g.translate(0, -L / 2, 0);
  const c = new THREE.Color(col), n = g.attributes.position.count, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}
/** Merge a list of geometries (all with position, normal, color) into one. */
function merge(list) {
  const pos = [], nor = [], col = [], idx = [];
  let base = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i));
      col.push(C ? C.getX(i) : 1, C ? C.getY(i) : 1, C ? C.getZ(i) : 1);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    base += P.count;
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
const fur = (name) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, name });
function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }

/** Shared model driver: locomotion phase, the attack lunge, the fall. */
function driver(root, pivot, step, { idle, attack, fall }) {
  const model = {
    root, anim: 'idle', animTime: 0, phase: 0,
    setAnim(name) { if (name !== this.anim) { this.anim = name; this.animTime = 0; } },
    update(dt) {
      this.animTime += dt;
      const a = this.anim, dead = a === 'dead' || a === 'die';
      if (dead) { fall(Math.min(1, a === 'dead' ? 1 : this.animTime / 0.7)); return; }
      fall(0);
      if (a === 'walk' || a === 'run') { this.phase += dt * (a === 'run' ? step.run : step.walk) * TAU; step.pose(this.phase, a === 'run'); }
      else if (a === 'stab' || a === 'punch' || a === 'attack') attack(Math.min(1, this.animTime / 0.4));
      else idle(this.animTime);
    },
    setColors() {}, setDisguise() {},
    dispose() { root.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); } }); },
  };
  return model;
}

// ------------------------------------------------------------------ the lion

const LION = { coat: 0xb8873e, belly: 0xd8b77a, mane: 0x5a3a1c, dark: 0x2a1c12 };

/**
 * A lion (+x forward). `o.variant`: 'lioness' (no mane, slighter); else a maned male.
 * @param {{variant?: string, seed?: number}} [o]
 */
export function createLion(o = {}) {
  const fem = o.variant === 'lioness', S = fem ? 0.92 : 1, seed = o.seed ?? 3;
  const root = new THREE.Group(); root.name = `animal:lion${fem ? ':lioness' : ''}`;
  const pivot = new THREE.Group(); root.add(pivot);
  const coat = fur('lion:coat');
  // trunk: haunches, barrel, chest
  const body = mesh(merge([
    blob(0.78 * S, 0.33 * S, 0.29 * S, 0, 0.8 * S, 0, LION.coat, LION.belly),
    blob(0.36 * S, 0.37 * S, 0.3 * S, 0.5 * S, 0.83 * S, 0, LION.coat, LION.belly),
    blob(0.36 * S, 0.34 * S, 0.29 * S, -0.52 * S, 0.8 * S, 0, LION.coat, LION.belly),
  ]), coat);
  pivot.add(body);
  // head on a neck pivot (it nods and turns): skull, muzzle, nose, ears, the mane round them (males)
  const neck = new THREE.Group(); neck.position.set(0.74 * S, 0.98 * S, 0); pivot.add(neck);
  const headParts = [
    blob(0.23 * S, 0.21 * S, 0.19 * S, 0.2 * S, 0.02, 0, LION.coat, LION.belly),
    blob(0.14 * S, 0.1 * S, 0.12 * S, 0.37 * S, -0.06 * S, 0, LION.belly, LION.belly),
    blob(0.04 * S, 0.035 * S, 0.05 * S, 0.5 * S, -0.03 * S, 0, LION.dark),
    blob(0.055, 0.06, 0.03, 0.13 * S, 0.19 * S, 0.12 * S, LION.coat, LION.dark),
    blob(0.055, 0.06, 0.03, 0.13 * S, 0.19 * S, -0.12 * S, LION.coat, LION.dark),
    blob(0.02, 0.02, 0.02, 0.3 * S, 0.06 * S, 0.1 * S, LION.dark), blob(0.02, 0.02, 0.02, 0.3 * S, 0.06 * S, -0.1 * S, LION.dark),
  ];
  if (!fem) headParts.push(blob(0.36, 0.42, 0.38, 0.0, -0.02, 0, LION.mane, LION.mane, { seg: 18, bumps: 0.14, seed }));
  neck.add(mesh(merge(headParts), coat));
  // legs: hip / shoulder pivot → thigh, knee pivot → shin and paw
  const legs = [];
  for (const [lx, lz, front] of [[0.52, 0.17, 1], [0.52, -0.17, 1], [-0.55, 0.17, 0], [-0.55, -0.17, 0]]) {
    const hip = new THREE.Group(); hip.position.set(lx * S, 0.74 * S, lz * S); pivot.add(hip);
    hip.add(mesh(limb(0.12 * S, 0.085 * S, 0.38 * S, LION.coat), coat));
    const knee = new THREE.Group(); knee.position.y = -0.38 * S; hip.add(knee);
    knee.add(mesh(merge([limb(0.08 * S, 0.065 * S, 0.3 * S, LION.coat), blob(0.1 * S, 0.05 * S, 0.075 * S, 0.04 * S, -0.31 * S, 0, LION.belly, LION.dark)]), coat));
    legs.push({ hip, knee, front, side: lz > 0 ? 1 : -1 });
  }
  // tail: three segments and the dark tuft
  const tail = new THREE.Group(); tail.position.set(-0.78 * S, 0.9 * S, 0); tail.rotation.z = 2.2; pivot.add(tail);
  const tails = [tail];
  let parent = tail;
  for (let k = 0; k < 3; k++) {
    const seg = new THREE.Group(); if (k) seg.position.y = -0.28 * S; parent.add(seg);
    seg.add(mesh(limb(0.035, 0.03, 0.28 * S, LION.coat, 6), coat));
    if (k === 2) seg.add(mesh(blob(0.06, 0.09, 0.06, 0, -0.32 * S, 0, LION.dark), coat));
    tails.push(seg); parent = seg;
  }
  const step = {
    walk: 1.3, run: 2.4,
    pose(ph, run) {
      const sw = run ? 0.75 : 0.42;
      for (const L of legs) {
        // diagonal pairs (walk), front / rear pairs (bound)
        const off = run ? (L.front ? 0 : Math.PI) + (L.side > 0 ? 0.35 : 0) : (L.front ? 0 : Math.PI) + (L.side > 0 ? Math.PI : 0) * (L.front ? 1 : -1) * 0.5;
        const s = Math.sin(ph + off);
        L.hip.rotation.z = -s * sw;
        L.knee.rotation.z = Math.max(0, Math.cos(ph + off)) * (L.front ? 0.7 : -0.8) * (run ? 1.2 : 1);
      }
      pivot.position.y = Math.abs(Math.sin(ph)) * (run ? 0.08 : 0.025);
      pivot.rotation.z = run ? Math.sin(ph) * 0.08 : 0;
      neck.rotation.z = Math.sin(ph * 2) * 0.04 - (run ? 0.12 : 0);
      tail.rotation.z = 2.2 + (run ? -0.5 : 0) + Math.sin(ph) * 0.15;
      tails[2].rotation.x = Math.sin(ph * 0.5) * 0.3;
    },
  };
  const idle = (t) => {
    for (const L of legs) { L.hip.rotation.z = 0; L.knee.rotation.z = 0; }
    pivot.position.y = 0; pivot.rotation.z = 0;
    body.scale.y = 1 + Math.sin(t * 1.6) * 0.015;
    neck.rotation.y = Math.sin(t * 0.37 + seed) * 0.35; neck.rotation.z = Math.sin(t * 0.21) * 0.06;
    tail.rotation.z = 2.2 + Math.sin(t * 0.9) * 0.12; tail.rotation.x = Math.sin(t * 1.3 + seed) * 0.35;
  };
  const attack = (k) => { // the lunge: rear up on the haunches, forepaws out, head down
    const u = Math.sin(k * Math.PI);
    pivot.rotation.z = u * 0.45; pivot.position.y = u * 0.12;
    for (const L of legs) { L.hip.rotation.z = L.front ? -u * 1.1 : u * 0.25; L.knee.rotation.z = L.front ? u * 0.4 : -u * 0.5; }
    neck.rotation.z = -u * 0.35;
  };
  const fall = (k) => { pivot.rotation.x = k * Math.PI / 2 * 0.96; pivot.position.y = k > 0 ? -k * 0.18 : pivot.position.y; for (const L of legs) if (k > 0) L.hip.rotation.z = (L.front ? -0.3 : 0.3) * k; };
  const model = driver(root, pivot, step, { idle, attack, fall });
  model.update(0);
  return model;
}

// ------------------------------------------------------------------ the ostrich

const OSTRICH = { cock: 0x1f1c1a, hen: 0x6e6252, plume: 0xece8e0, skin: 0xb49890, legs: 0xc4a49a, beak: 0xd8c0a0 };

/** An ostrich (+x forward). `o.variant`: 'hen' (grey-brown); else a black cock with white plumes. */
export function createOstrich(o = {}) {
  const hen = o.variant === 'hen', seed = o.seed ?? 5;
  const root = new THREE.Group(); root.name = `animal:ostrich${hen ? ':hen' : ''}`;
  const pivot = new THREE.Group(); root.add(pivot);
  const mat = fur('ostrich');
  const plume = hen ? 0xb8ad9a : OSTRICH.plume, coat = hen ? OSTRICH.hen : OSTRICH.cock;
  const body = mesh(merge([
    blob(0.5, 0.35, 0.34, 0, 1.2, 0, coat, coat, { bumps: 0.06, seed }),
    blob(0.34, 0.16, 0.05, -0.05, 1.2, 0.33, plume, coat),
    blob(0.34, 0.16, 0.05, -0.05, 1.2, -0.33, plume, coat),
    blob(0.2, 0.17, 0.2, -0.48, 1.3, 0, plume, plume, { bumps: 0.12, seed: seed + 1 }),
    blob(0.11, 0.09, 0.1, 0.0, 0.96, 0.12, OSTRICH.skin), blob(0.11, 0.09, 0.1, 0.0, 0.96, -0.12, OSTRICH.skin), // thighs
  ]), mat);
  pivot.add(body);
  const neck = new THREE.Group(); neck.position.set(0.38, 1.32, 0); neck.rotation.z = -0.22; pivot.add(neck);
  const nk = limb(0.065, 0.035, 0.85, OSTRICH.skin, 8); nk.rotateZ(Math.PI); // up from the pivot
  neck.add(mesh(merge([nk, blob(0.075, 0.065, 0.06, 0.02, 0.88, 0, OSTRICH.skin), blob(0.07, 0.022, 0.035, 0.1, 0.86, 0, OSTRICH.beak),
    blob(0.015, 0.015, 0.015, 0.05, 0.9, 0.05, 0x111111), blob(0.015, 0.015, 0.015, 0.05, 0.9, -0.05, 0x111111)]), mat));
  const legs = [];
  for (const side of [1, -1]) {
    const hip = new THREE.Group(); hip.position.set(0.02, 0.95, side * 0.12); pivot.add(hip);
    hip.add(mesh(limb(0.05, 0.035, 0.45, OSTRICH.legs), mat));
    const knee = new THREE.Group(); knee.position.y = -0.45; knee.rotation.z = 0.25; hip.add(knee);
    knee.add(mesh(merge([limb(0.032, 0.028, 0.48, OSTRICH.legs), blob(0.11, 0.03, 0.05, 0.07, -0.5, 0, OSTRICH.legs)]), mat));
    legs.push({ hip, knee, side });
  }
  const step = {
    walk: 1.4, run: 2.8,
    pose(ph, run) {
      const sw = run ? 0.85 : 0.45;
      for (const L of legs) {
        const s = Math.sin(ph + (L.side > 0 ? 0 : Math.PI));
        L.hip.rotation.z = -s * sw - 0.1;
        L.knee.rotation.z = 0.25 + Math.max(0, Math.cos(ph + (L.side > 0 ? 0 : Math.PI))) * (run ? 1.1 : 0.7);
      }
      pivot.position.y = Math.abs(Math.sin(ph)) * (run ? 0.07 : 0.03);
      neck.rotation.z = -0.22 + Math.sin(ph * 2) * (run ? 0.05 : 0.12) - (run ? 0.25 : 0);
    },
  };
  const idle = (t) => {
    for (const L of legs) { L.hip.rotation.z = 0; L.knee.rotation.z = 0.25; }
    pivot.position.y = 0;
    // pecking now and then, the head turning
    const peck = Math.max(0, Math.sin(t * 0.55 + seed) - 0.8) * 5;
    neck.rotation.z = -0.22 - peck * 0.9; neck.rotation.y = Math.sin(t * 0.43 + seed) * 0.5;
  };
  const attack = (k) => { // the kick: one leg thrown forward and down
    const u = Math.sin(k * Math.PI);
    legs[0].hip.rotation.z = -u * 1.25; legs[0].knee.rotation.z = 0.25 + u * 0.2;
    legs[1].hip.rotation.z = u * 0.15;
    neck.rotation.z = -0.22 + u * 0.3;
  };
  const fall = (k) => { pivot.rotation.x = k * Math.PI / 2 * 0.95; if (k > 0) pivot.position.y = -k * 0.55; };
  const model = driver(root, pivot, step, { idle, attack, fall });
  model.update(0);
  return model;
}

// ------------------------------------------------------------------ the hen

const HEN = { brown: 0x8a5a32, speckle: 0x5e3a1e, white: 0xe9e2d2, comb: 0xb23a2a, legs: 0xd0a040, beak: 0xd8b060 };

/** A farmyard hen (+x forward): brown or white (`o.variant`), a red comb and wattles, a scratching, pecking idle. */
export function createHen(o = {}) {
  const seed = o.seed ?? 7, white = o.variant === 'white';
  const root = new THREE.Group(); root.name = `animal:chicken${white ? ':white' : ''}`;
  const pivot = new THREE.Group(); root.add(pivot);
  const mat = fur('hen');
  const coat = white ? HEN.white : HEN.brown, dark = white ? 0xcfc6b2 : HEN.speckle;
  const body = mesh(merge([
    blob(0.17, 0.13, 0.12, 0, 0.25, 0, coat, dark, { seg: 8, bumps: 0.08, seed }),
    blob(0.07, 0.1, 0.09, -0.15, 0.32, 0, dark, coat, { seg: 8, bumps: 0.12, seed: seed + 3 }), // the tail fan
    blob(0.06, 0.04, 0.035, 0.0, 0.26, 0.11, dark, null, { seg: 8 }), blob(0.06, 0.04, 0.035, 0.0, 0.26, -0.11, dark, null, { seg: 8 }), // wings
  ]), mat);
  pivot.add(body);
  const neck = new THREE.Group(); neck.position.set(0.12, 0.32, 0); pivot.add(neck);
  neck.add(mesh(merge([
    blob(0.06, 0.07, 0.055, 0.03, 0.06, 0, coat, coat, { seg: 8 }),
    blob(0.025, 0.012, 0.012, 0.1, 0.07, 0, HEN.beak, null, { seg: 8 }),
    blob(0.035, 0.02, 0.008, 0.04, 0.13, 0, HEN.comb, null, { seg: 8 }), blob(0.012, 0.022, 0.008, 0.08, 0.035, 0, HEN.comb, null, { seg: 8 }),
    blob(0.01, 0.01, 0.01, 0.07, 0.085, 0.035, 0x111111, null, { seg: 8 }), blob(0.01, 0.01, 0.01, 0.07, 0.085, -0.035, 0x111111, null, { seg: 8 }),
  ]), mat));
  const legs = [];
  for (const side of [1, -1]) {
    const hip = new THREE.Group(); hip.position.set(0.0, 0.16, side * 0.05); pivot.add(hip);
    hip.add(mesh(merge([limb(0.012, 0.01, 0.16, HEN.legs, 5), blob(0.04, 0.008, 0.025, 0.02, -0.165, 0, HEN.legs, null, { seg: 8 })]), mat));
    legs.push({ hip, side });
  }
  const step = {
    walk: 2.6, run: 4.2,
    pose(ph, run) {
      for (const L of legs) L.hip.rotation.z = Math.sin(ph + (L.side > 0 ? 0 : Math.PI)) * (run ? 0.7 : 0.45);
      pivot.position.y = Math.abs(Math.sin(ph)) * 0.02;
      neck.position.x = 0.12 + Math.sin(ph * 2) * 0.02; // the head bobs as it walks
      body.rotation.z = run ? -0.25 : 0;
    },
  };
  const idle = (t) => {
    for (const L of legs) L.hip.rotation.z = 0;
    pivot.position.y = 0; body.rotation.z = 0;
    const peck = Math.max(0, Math.sin(t * 1.3 + seed) - 0.6) * 2.5; // pecks at the ground now and then
    neck.rotation.z = -peck * 0.8; neck.rotation.y = Math.sin(t * 0.9 + seed) * 0.5;
    legs[0].hip.rotation.z = Math.max(0, Math.sin(t * 0.7 + seed * 2) - 0.8) * 2.0; // a scratch
  };
  const attack = (k) => { neck.rotation.z = -Math.sin(k * Math.PI) * 0.9; };
  const fall = (k) => { pivot.rotation.x = k * Math.PI / 2 * 0.9; if (k > 0) pivot.position.y = -k * 0.1; };
  const model = driver(root, pivot, step, { idle, attack, fall });
  model.update(0);
  return model;
}

/** A small stable hash of an id (string): picks an animal's look and gait phase. */
export function lookSeed(id) {
  let h = 2166136261;
  for (const ch of String(id ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 997;
}

/**
 * The look of one circus animal, picked steadily by its spawn id: the variant these procedural models draw and the
 * modelled body of the character library that stands for it in the game (assets/characters/animals, manifest group
 * 'animals': two maned lions and a lioness, an ostrich cock and hen, a brown and a white hen; built by
 * tools/characters/animals/build_animal.py). art/unit-model.js shows the library body when the library is loaded and
 * these procedural ones otherwise (node tests, `?chars=0`, a body that failed to build).
 * @param {'lion'|'ostrich'|'chicken'} kind @param {string|number} [id] the spawn id
 * @returns {{variant: string, character: string}|null}
 */
export function animalLook(kind, id) {
  const seed = lookSeed(id ?? kind);
  if (kind === 'lion') return seed % 3 === 1 ? { variant: 'lioness', character: 'lioness_a' } : { variant: 'male', character: (seed >> 1) & 1 ? 'lion_b' : 'lion_a' };
  if (kind === 'ostrich') return seed % 2 ? { variant: 'hen', character: 'ostrich_hen_a' } : { variant: 'cock', character: 'ostrich_cock_a' };
  if (kind === 'chicken') return seed % 3 === 0 ? { variant: 'white', character: 'hen_white_a' } : { variant: 'brown', character: 'hen_brown_a' };
  return null;
}
