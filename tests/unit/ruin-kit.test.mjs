/**
 * The ruin kit (art/ruin-kit.js, art/ruin-walls.js; user 2026-11-10: "Buildings in ruins should look more realistic"):
 *  - deterministic by seed (the same ruin twice is the same triangles; two ruins differ);
 *  - nothing floats: every charred beam / joist rests on something along its length on both sides of its middle (a
 *    wall head, a joist pocket in the masonry, a rubble mound or the ground — the kit's own support model);
 *  - the rubble and loose units stay round the wall: within its gameplay line's width + a 2.6 m margin;
 *  - the broken head is jagged at every scale: no run of equal-height columns longer than a few units, both faces
 *    different, the head within the recipe's bounds (never below its minimum share of the gameplay height bar the
 *    broken free ends);
 *  - visual only: the kit's group and meshes carry `userData.clip = false`, the gameplay measures
 *    (world/placement-visual.js) of a ruin wall are the old look's (the nav proxy), unchanged by the kit; the proxy is
 *    never drawn and keeps its material names (the snow test reads them).
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { RuinKit, breakProfile, navProxy, marchSquares } from '../../src/art/ruin-kit.js';
import { mudRuin, stoneRuin, burntHouse, innerSide } from '../../src/art/ruin-walls.js';
import { buildWall, buildRuins, rng } from '../../src/art/dressing.js';
import { planCells, planHull, lowSurfaces } from '../../src/world/placement-visual.js';
import { MISSIONS } from '../../src/missions/index.js';

const mission = (id) => MISSIONS.find((m) => m.id === id);
/** Every ruin wall / stub the kit draws, with its mission's theatre. */
function ruinDefs() {
  const out = [];
  for (const id of ['m08', 'm09', 'm10', 'm11', 'm15', 'm16', 'm18', 'm19']) {
    const m = mission(id);
    for (const s of m.structures) {
      const v = String(s.variant ?? '');
      if ((s.type === 'wall' && /ruin|mudbrick_broken/.test(v) && v !== 'ruin_wall_stub') || (s.type === 'ruins' && /ruins_mudbrick/.test(v))) out.push({ m, s });
    }
  }
  return out;
}
const kitOf = (g) => { let k = null; g.traverse((o) => { if (!k && /^ruin-kit:/.test(o.name) && o.isGroup) k = o; }); return k; };
const hashGeo = (g) => {
  let h = 2166136261;
  g.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 7) { h ^= Math.round(p[i] * 1000); h = Math.imul(h, 16777619); }
    h ^= p.length; h = Math.imul(h, 16777619);
  });
  return h >>> 0;
};

/** Is beam `b` held: in contact (support within tol, or inside masonry) on both sides of its middle? */
function held(kit, b, tol = 0.09) {
  const n = 24, contacts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, x = b.a[0] + (b.b[0] - b.a[0]) * f, y = b.a[1] + (b.b[1] - b.a[1]) * f, z = b.a[2] + (b.b[2] - b.a[2]) * f;
    const s = kit.supportAt(x, z);
    if (Math.abs(y - s) <= tol || kit.inWall(x, y + 0.02, z) || (y < s + tol && y > s - 0.6)) contacts.push(f);
  }
  return contacts.some((f) => f <= 0.5) && contacts.some((f) => f >= 0.5);
}

test('ruin kit: the same seed draws the same ruin, another seed another', () => {
  const pts = [[0, 0], [8, 0], [8, 5]];
  const a = mudRuin(pts, { h: 2.2, width: 0.8, id: 'x', theater: 'desert' }), b = mudRuin(pts, { h: 2.2, width: 0.8, id: 'x', theater: 'desert' });
  const c = mudRuin(pts, { h: 2.2, width: 0.8, id: 'y', theater: 'desert' });
  assert.equal(hashGeo(a), hashGeo(b));
  assert.notEqual(hashGeo(a), hashGeo(c));
  for (const [f, o] of [[stoneRuin, { kind: 'stone' }], [burntHouse, {}]]) {
    const p = f(pts, { h: 2.6, width: 0.6, id: 'z', theater: 'temperate', ...o }), q = f(pts, { h: 2.6, width: 0.6, id: 'z', theater: 'temperate', ...o });
    assert.equal(hashGeo(p), hashGeo(q), f.name);
  }
});

test('ruin kit: every beam and joist rests on something on both sides of its middle (no floating timber)', () => {
  let beams = 0;
  // capture the kits the recipes build
  const proto = RuinKit.prototype, build = proto.build, kits = [];
  proto.build = function (...a) { kits.push(this); return build.apply(this, a); };
  try {
    for (const { m, s } of ruinDefs()) {
      kits.length = 0;
      if (s.type === 'wall') buildWall(s.points, { ...s, theater: m.theater }); else buildRuins({ ...s, theater: m.theater });
      for (const kit of kits) for (const b of kit.beams) {
        beams++;
        assert.ok(held(kit, b), `${m.id} ${s.id}: ${b.kind} from ${b.a.map((v) => v.toFixed(2))} to ${b.b.map((v) => v.toFixed(2))} is not held`);
      }
    }
    // the seeds of many more walls (each recipe, short and long, low and tall)
    for (let k = 0; k < 24; k++) {
      kits.length = 0;
      const L = 3 + k * 0.7, pts = [[0, 0], [L, 0], [L, 2 + (k % 5)]];
      mudRuin(pts, { h: 1.6 + (k % 4) * 0.35, width: 0.8, id: `m${k}`, theater: 'desert' });
      burntHouse(pts, { h: 2.6 + (k % 3) * 0.4, width: 0.5, id: `b${k}`, theater: 'temperate' });
      for (const kit of kits) for (const b of kit.beams) { beams++; assert.ok(held(kit, b), `seed ${k}: ${b.kind} not held (${b.a.map((v) => v.toFixed(2))} → ${b.b.map((v) => v.toFixed(2))})`); }
    }
  } finally { proto.build = build; }
  assert.ok(beams > 40, `${beams} beams checked`);
});

test('ruin kit: rubble, loose units and drifts stay within the wall line + 2.6 m (a village wall: within its house\'s room + 1 m)', () => {
  for (const { m, s } of ruinDefs()) {
    const g = s.type === 'wall' ? buildWall(s.points, { ...s, theater: m.theater }) : buildRuins({ ...s, theater: m.theater });
    const kit = kitOf(g);
    assert.ok(kit, `${m.id} ${s.id}: the kit look`);
    // the polyline in the group's frame (a `ruins` stub is built in its own frame along x)
    const pts = s.points || [[-(s.w ?? 4) / 2, 0], [(s.w ?? 4) / 2, 0]];
    const half = (s.width ?? s.d ?? 0.8) / 2;
    // (a desert village wall draws the rest of its house: a room up to 3.6 m deep on one side — art/ruin-walls.js roomOutline)
    const margin = /ruins_mudbrick|mudbrick_broken/.test(String(s.variant)) ? 4.6 : 2.6;
    const dist = (x, z) => {
      let d = Infinity;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
      }
      return d;
    };
    kit.traverse((o) => {
      if (!o.isMesh) return;
      const P = o.geometry.attributes.position;
      for (let i = 0; i < P.count; i += 3) assert.ok(dist(P.getX(i), P.getZ(i)) <= half + margin, `${m.id} ${s.id}: ${o.name} vertex ${P.getX(i).toFixed(2)},${P.getZ(i).toFixed(2)} is ${dist(P.getX(i), P.getZ(i)).toFixed(2)} m off the wall`);
    });
  }
});

test('ruin kit: broken heads are jagged and irregular (no long level runs, faces differ), within their bounds', () => {
  for (const kind of ['brick', 'stone', 'mud']) {
    const kit = new RuinKit({ kind, id: `jag-${kind}`, theater: 'temperate' });
    const h = 2.4, run = kit.wallRun([[0, 0], [12, 0]], { h, width: 0.6, min: 0.62, max: 1.06 });
    const cols = run.segments[0].cols;
    let longest = 0, cur = 0, differ = 0;
    for (let i = 1; i < cols.length; i++) {
      if (Math.abs(cols[i].yA - cols[i - 1].yA) < 1e-6) cur += cols[i].u1 - cols[i].u0; else { longest = Math.max(longest, cur); cur = 0; }
      if (Math.abs(cols[i].yA - cols[i].yB) > 1e-3) differ++;
    }
    longest = Math.max(longest, cur);
    assert.ok(longest < 2.2, `${kind}: a level run of ${longest.toFixed(2)} m`);
    assert.ok(differ > cols.length * 0.3, `${kind}: the two faces break apart (${differ}/${cols.length})`);
    const heights = cols.map((c) => Math.max(c.yA, c.yB));
    assert.ok(Math.max(...heights) <= 1.06 * h + 0.08, `${kind}: top ${Math.max(...heights).toFixed(2)}`);
    // (the free ends may break below the minimum over their last metre)
    for (const c of cols) if (c.u0 > 1 && c.u1 < 11.6) assert.ok(Math.min(c.yA, c.yB) >= 0.62 * h - 0.2, `${kind}: a column down to ${Math.min(c.yA, c.yB).toFixed(2)}`);
  }
  // the profile alone: bites, ends broken down, deterministic
  const p1 = breakProfile(10, 2, rng(5), { endA: 'free', endB: 'corner' }), p2 = breakProfile(10, 2, rng(5), { endA: 'free', endB: 'corner' });
  for (let u = 0; u <= 10; u += 0.37) assert.equal(p1.top(u), p2.top(u));
  let free = 0, corner = 0;
  for (let k = 0; k < 40; k++) { const p = breakProfile(10, 2, rng(100 + k), { endA: 'free', endB: 'corner', seed: k }); free += p.top(0.05); corner += p.top(9.95); }
  assert.ok(free / 40 < corner / 40 - 0.3, `free ends broken down (${(free / 40).toFixed(2)} m) below corners (${(corner / 40).toFixed(2)} m)`);
});

test('ruin kit: visual only — clip = false on the group and every mesh; the gameplay measures are the old look\'s', () => {
  const defs = ruinDefs();
  assert.ok(defs.length >= 40, `${defs.length} ruin walls`);
  for (const { m, s } of defs) {
    const g = s.type === 'wall' ? buildWall(s.points, { ...s, theater: m.theater }) : buildRuins({ ...s, theater: m.theater });
    const kit = kitOf(g);
    assert.equal(kit.userData.clip, false, `${m.id} ${s.id}`);
    kit.traverse((o) => { if (o.isMesh) { assert.equal(o.userData.clip, false); assert.notEqual(o.material.visible, false); } });
    // the proxy (the old look): never drawn, its material names kept, no shadow
    let proxies = 0;
    g.traverse((o) => { if (o.isMesh && o.userData.navProxy) { proxies++; assert.equal(o.material.visible, false); assert.ok(/^dressing:|:burnt|m19|brick-heap|^$/.test(o.material.name) || o.material.name.length > 0, o.material.name); assert.equal(o.castShadow, false); } });
    assert.ok(proxies > 0, `${m.id} ${s.id}: the old look stays as the stamping source`);
    // the measures with and without the kit are the same (it is skipped) — and would not be, were it measured
    const bands = [{ minY: 0.3, maxY: 1.8, cell: 0.25, close: 0 }, { minY: 0.12, maxY: 0.3, cell: 0.25, close: 0 }];
    const withKit = bands.map((o) => JSON.stringify(planCells(g, o))), hull = JSON.stringify(planHull(g)), low = JSON.stringify([...lowSurfaces(g, { maxY: 0.6, cell: 0.25, flat: 0.8 })]);
    const parent = kit.parent; parent.remove(kit);
    assert.deepEqual(bands.map((o) => JSON.stringify(planCells(g, o))), withKit, `${m.id} ${s.id}: body / low cells`);
    assert.equal(JSON.stringify(planHull(g)), hull, `${m.id} ${s.id}: hull`);
    assert.equal(JSON.stringify([...lowSurfaces(g, { maxY: 0.6, cell: 0.25, flat: 0.8 })]), low, `${m.id} ${s.id}: low surfaces`);
    parent.add(kit);
  }
  // control: the same kit, were it measurable, would change the cells (so the test above can fail)
  const { m, s } = defs.find(({ s }) => /ruins_mudbrick$/.test(s.variant));
  const g = buildWall(s.points, { ...s, theater: m.theater }), kit = kitOf(g), before = JSON.stringify(planCells(g, { minY: 0.12, maxY: 0.3, cell: 0.25, close: 0 }));
  kit.userData.clip = true; kit.traverse((o) => { o.userData.clip = true; });
  assert.notEqual(JSON.stringify(planCells(g, { minY: 0.12, maxY: 0.3, cell: 0.25, close: 0 })), before, 'the control: a measured kit would stamp');
});

test('ruin kit: navProxy keeps geometry, place and visibility; a hidden material of the same name', () => {
  const snow = new THREE.MeshStandardMaterial({ name: 'dressing:snow' }), m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), snow);
  m.position.set(3, 0, 2); m.castShadow = true;
  const g = new THREE.Group(); g.add(m);
  const geo = m.geometry;
  navProxy(g);
  assert.equal(m.geometry, geo); assert.equal(m.visible, true); assert.deepEqual(m.position.toArray(), [3, 0, 2]);
  assert.equal(m.material.name, 'dressing:snow'); assert.equal(m.material.visible, false); assert.equal(m.castShadow, false);
});

test('ruin kit: the burnt house finds its rooms\' side; marching squares traces closed, counter-clockwise patches', () => {
  assert.equal(innerSide([[5, 139], [5, 123], [24, 123], [24, 129]]), 1);
  assert.equal(innerSide([[24, 129], [24, 123], [5, 123], [5, 139]]), -1);
  const nu = 6, nv = 4, g = 1, f = new Float32Array((nu + 1) * (nv + 1));
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) f[j * (nu + 1) + i] = 2.2 - Math.hypot(i - 3, j - 2);
  let area = 0;
  marchSquares(f, nu, nv, g, nu * g, (poly) => {
    let a = 0;
    for (let k = 0; k < poly.length; k++) { const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length]; a += x0 * y1 - x1 * y0; }
    assert.ok(a > -1e-9, 'counter-clockwise');
    area += a / 2;
  });
  assert.ok(area > 9 && area < 17, `area ${area.toFixed(2)} ≈ a disc of r 2.2`);
});

test('ruin dress: a bombed shell (stepped heads, windows, a floor) — its rafters and joists rest on heads, floors or rubble; dressing round the shell', async () => {
  const { dressRuin, analyseRuin } = await import('../../src/art/ruin-dress.js');
  const { RuinKit: K } = await import('../../src/art/ruin-kit.js');
  // a 10 × 7 m brick shell, walls 0.5 m thick, heads stepping 0.5 m every metre (the modelled crenel-like breaks), a
  // window of glass in the south wall, a first floor at 3.2 m over half the inside
  const brick = new THREE.MeshStandardMaterial({ name: 'kit:brick_red' }), glass = new THREE.MeshStandardMaterial({ name: 'kit:glass_dirty' });
  const deck = new THREE.MeshStandardMaterial({ name: 'kit:deck_planks' });
  const lod = new THREE.Group(); lod.name = 'lod0';
  const box = (mat, x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); lod.add(m); };
  const W = 10, D = 7, T = 0.5;
  for (let k = 0; k < 10; k++) { const h = 5 + (k % 2 ? -0.5 : 0) + (k % 3 === 0 ? -0.6 : 0); box(brick, -W / 2 + k + 0.5, h / 2, -D / 2 + T / 2, 1, h, T); box(brick, -W / 2 + k + 0.5, h / 2 + 0.2, D / 2 - T / 2, 1, h + 0.4, T); }
  for (let k = 0; k < 7; k++) { const h = 4.6 + (k % 2) * 0.6; box(brick, -W / 2 + T / 2, h / 2, -D / 2 + k + 0.5, T, h, 1); box(brick, W / 2 - T / 2, h / 2, -D / 2 + k + 0.5, T, h, 1); }
  box(glass, 1, 1.5, D / 2 - T / 2, 0.9, 1.2, 0.05);
  box(deck, -2, 3.2, 0, 5, 0.1, D - 2 * T);
  const rect = (x0, z0, x1, z1) => [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
  const meta = { bbox: { min: [-W / 2, 0, -D / 2], max: [W / 2, 5.6, D / 2] }, footprints: [
    { kind: 'wall', block: 'HIGH', points: rect(-W / 2, -D / 2, W / 2, -D / 2 + T) }, { kind: 'wall', block: 'HIGH', points: rect(-W / 2, D / 2 - T, W / 2, D / 2) },
    { kind: 'wall', block: 'HIGH', points: rect(-W / 2, -D / 2, -W / 2 + T, D / 2) }, { kind: 'wall', block: 'HIGH', points: rect(W / 2 - T, -D / 2, W / 2, D / 2) },
    { kind: 'rubble', block: 'LOW', points: rect(2, D / 2 + 0.2, 4, D / 2 + 1.6) }] };
  const kits = [], build = K.prototype.build;
  K.prototype.build = function (...a) { kits.push(this); return build.apply(this, a); };
  let g;
  try { g = dressRuin({ asset: 'house_bombed_b', meta, lods: [lod] }, { id: 'test', theater: 'temperate' }); } finally { K.prototype.build = build; }
  assert.ok(g, 'dressed'); assert.equal(g.userData.clip, false);
  const A = analyseRuin('house_bombed_b', lod, meta, /^kit:brick_red/);
  assert.equal(A.walls.length, 4); assert.equal(A.windows.length, 1);
  const s = A.walls.find((w) => w.cz > 3);
  assert.ok(Math.abs(Math.max(...s.top) - 5.4) < 0.11 && Math.min(...s.top) < 4.9, `south heads ${Math.min(...s.top).toFixed(2)}–${Math.max(...s.top).toFixed(2)}`);
  const kit = kits[0];
  assert.ok(kit.beams.length >= 3, `${kit.beams.length} beams`);
  for (const b of kit.beams) assert.ok(held(kit, b), `${b.kind} (${b.a.map((v) => v.toFixed(2))} → ${b.b.map((v) => v.toFixed(2))}) is not held`);
  // everything within the model's box + 3 m (the spills and the strewn bricks)
  g.traverse((o) => { if (!o.isMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i += 5) assert.ok(Math.abs(P.getX(i)) <= W / 2 + 3 && Math.abs(P.getZ(i)) <= D / 2 + 3, `${o.name} at ${P.getX(i).toFixed(2)},${P.getZ(i).toFixed(2)}`); });
});

test('ruin kit: rubble mounds face up (their top faces are front faces from the camera above)', () => {
  const kit = new RuinKit({ kind: 'brick', id: 'mound-up', theater: 'temperate' });
  kit.mound({ x: 2, z: 3, w: 3, d: 2, h: 0.8, rot: 0.7, density: 0 });
  kit.mound({ x: -2, z: 1, y0: 2.5, w: 1.5, d: 1, h: 0.4, rot: 2.1, density: 0 });
  const g = kit.build(), m = g.children[0], N = m.geometry.attributes.normal;
  let up = 0, down = 0;
  for (let i = 0; i < N.count; i += 3) { if (N.getY(i) > 0.2) up++; else if (N.getY(i) < -0.2) down++; }
  assert.ok(up > 0 && down === 0, `${up} faces up, ${down} down`);
});

test('ruin dress: a rubble heap with no wall strips (M1) is dressed round its own box — no NaN anywhere', async () => {
  const { dressRuin } = await import('../../src/art/ruin-dress.js');
  const lod = new THREE.Group(); lod.name = 'lod0';
  const stone = new THREE.MeshStandardMaterial({ name: 'kit:fieldstone_grey' });
  const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 2), stone); m.position.y = 0.4; lod.add(m);
  const meta = { bbox: { min: [-1.7, -0.16, -1.06], max: [1.55, 1.06, 1.33] }, footprints: [{ kind: 'rubble', block: 'LOW', points: [[-1.75, 1], [1.75, 1], [1.75, -1], [-1.75, -1]] }] };
  for (const theater of ['snow', 'temperate']) {
    const g = dressRuin({ asset: 'rubble_fieldstone_low_no_snow', meta, lods: [lod] }, { id: 'rubble', theater });
    assert.ok(g, theater);
    let n = 0;
    g.traverse((o) => { if (!o.isMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { n++; assert.ok(Number.isFinite(P.getX(i)) && Number.isFinite(P.getY(i)) && Number.isFinite(P.getZ(i)), `${theater}: ${o.name} vertex ${i}`); } });
    assert.ok(n > 100, `${theater}: ${n} vertices`);
  }
});
