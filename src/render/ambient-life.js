/**
 * Ambient life director (PROGRESS step 4f), one per mission, created by map-builder once the water is built:
 * fish schools under the surface (src/world/fish-sim.js + src/art/fish-model.js) and birds — gulls over harbours,
 * coasts and fjords, crows in the fields, ducks on ponds and quiet rivers (src/world/bird-sim.js +
 * src/art/bird-model.js). Runs per displayed frame on the interpolated SIM time (frozen while paused), no gameplay
 * effect, nothing saved.
 *
 * Wiring: divers / swimmers / waders / boats in the water are continuous fish threats; splashes (WakeTracker),
 * dives, grenades bouncing into the water and missed shots are fright impulses; explosions in the water stun a few
 * fish (belly-up, floating, then recover); gunshots and loud noises flush the birds; people and vehicles walking up
 * make sitting birds nervous; duck take-offs / landings splash and paddling ducks leave faint ripples. Everything
 * reads the mission WindField (flight through the air mass, settling into the wind, surface drift).
 * @module render/ambient-life
 */
import * as THREE from 'three';
import { T } from '../world/grid.js';
import { FishSim, fishPlan } from '../world/fish-sim.js';
import { BirdSim, birdPlan } from '../world/bird-sim.js';
import { createFishMesh, writeFish, createFishShadows, writeFishShadows } from '../art/fish-model.js';
import { createBirdMesh, writeBirds } from '../art/bird-model.js';

/** Water bodies of the map as sim inputs: open-water sample spots (every other cell) + area, per water body. */
export function lifeBodies(grid, water) {
  const bodies = (water?.bodies || []).map((b) => ({ type: b.o?.type, preset: b.o?.preset, frozen: !!b.o?.frozen,
    velocity: Math.hypot(...(b.o?.flow?.dir || [0, 0])) * (b.o?.flow?.speed || 0), spots: [], area: 0, ref: b }));
  if (!grid?.terrain || !bodies.length) return bodies;
  const idx = new Map(bodies.map((b, i) => [b.ref, i])), c = grid.cell;
  for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
    const t = grid.terrain[j * grid.cols + i];
    if (t !== T.WATER && t !== T.SHALLOW) continue;
    const x = (i + 0.5) * c, z = (j + 0.5) * c, s = water.sample(x, z);
    const k = s ? idx.get(s.body) : undefined;
    if (k == null) continue;
    bodies[k].area += c * c;
    if (!(i & 1) && !(j & 1) && s.depth > 0.35 && !s.ice) bodies[k].spots.push([x, z]);
  }
  return bodies;
}

/** Open land for crows: snow / grass / ground / mud cells with no obstacle nearby, away from the water (2 m grid). */
export function lifeFields(grid) {
  const out = [];
  if (!grid?.terrain) return out;
  const st = Math.max(1, Math.round(2 / grid.cell)), ok = (i, j) => {
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return false;
    const k = j * grid.cols + i, t = grid.terrain[k];
    return (t === T.SNOW || t === T.GRASS || t === T.GROUND || t === T.MUD) && !(grid.block?.[k] > 0);
  };
  for (let j = st; j < grid.rows - st; j += st) for (let i = st; i < grid.cols - st; i += st) {
    if (ok(i, j) && ok(i - 3 * st, j) && ok(i + 3 * st, j) && ok(i, j - 3 * st) && ok(i, j + 3 * st)) out.push([(i + 0.5) * grid.cell, (j + 0.5) * grid.cell]);
  }
  return out;
}

/** Gull perches along the piers / jetties of the mission (deck edges and the pier head), y from the deck. */
export function lifePerches(mission, groundY) {
  const out = [];
  for (const s of mission?.structures || []) {
    if (s.type !== 'pier' && s.type !== 'jetty') continue;
    const L = s.w ?? 7, D = s.d ?? 2.5, ca = Math.cos(s.rot || 0), sa = Math.sin(s.rot || 0);
    for (const a of [-0.35, -0.1, 0.15, 0.42]) for (const sd of [-1, 1]) {
      const along = a * L, side = sd * D * 0.38;
      const x = s.x + ca * along - sa * side, z = s.z + sa * along + ca * side;
      let y = typeof groundY === 'function' ? groundY(x, z) : 0;
      if (!(y > 0.15)) y = 0.55;
      out.push({ x, y, z, bird: null });
    }
  }
  return out;
}

const QUALITY = { low: 'low', medium: 'medium', high: 'high', ultra: 'ultra' };
/** Fish threat radii (m) by what is in the water. */
export const FISH_THREAT = { dive: 4.5, swim: 3.5, wade: 2.5, boat: 6 };

/**
 * @param {import('../world/world.js').World} world (world.water = the water handle, world.wind, world.grid)
 * @param {object} [renderer] engine Renderer (presetName, scene) — null → sims only (tests)
 * @param {{scene?:THREE.Object3D, seed?:number, quality?:string}} [o]
 */
export function createAmbientLife(world, renderer = null, o = {}) {
  const water = world.water || null, mission = world.mission || {};
  const theater = mission.theater || 'temperate', quality = o.quality || QUALITY[renderer?.presetName] || 'high';
  const seed = ((mission.seed ?? 4242) >>> 0) % 100003 + 3;
  const gY = (x, z) => (typeof world.groundY === 'function' ? world.groundY(x, z) : 0) ?? 0;
  // optional mission override `ambient: {fish?: false, birds?: false, habitat?, density?}` (e.g. M13 harbour → 'sea')
  const A = mission.ambient || {};
  const bodies = water ? lifeBodies(world.grid, water).map((b) => (A.habitat ? { ...b, habitat: A.habitat } : b)) : [];
  const plan = A.fish === false ? [] : fishPlan(bodies, theater, seed, quality, A.density);
  const fish = water && plan.length ? new FishSim(plan, water, seed + 1) : null;
  const night = (mission.lighting?.sunElevDeg ?? 30) < 0 || theater === 'night';
  const W = world.wind, wv = { x: 0, z: 0, speed: 0, gust: 0, turb: 0 };
  const env = {
    wind: (x, z, out) => { if (W?.sample) { W.sample(x, z, W.t, wv); out[0] = wv.x; out[1] = wv.z; } else { out[0] = out[1] = 0; } },
    water: (x, z) => (water ? water.sample(x, z) : null),
    ground: gY,
    // obstacles a crow must not walk into: blocked cells (walls, palisades, rocks) and standing visuals
    blocked: (x, z) => { const G = world.grid; return !!G?.block && (G.blockAt(x, z) > 0 || !!G.solidAt?.(x, z)); },
    fields: lifeFields(world.grid),
    perches: lifePerches(mission, gY),
    splash: (x, z, s) => water?.wakes?.splash?.(x, z, s),
    ripple: (x, z, s) => water?.disturb?.(x, z, s, 0.35, 0.02),
    flush: (b) => world.events?.emit?.('ambient:flush', { x: b.x, z: b.z, species: b.sp }),
  };
  const birds = new BirdSim(A.birds === false ? [] : birdPlan({ theater, night, bodies, fields: env.fields, perches: env.perches }, seed + 2, quality), env, seed + 3);
  const stats = { fish: fish?.fish.length || 0, birds: birds.birds.length, drawnFish: 0, drawnBirds: 0, rings: 0, ms: 0, schools: fish?.schools.length || 0 };
  // meshes: one InstancedMesh per species present
  const scene = o.scene || renderer?.scene || world.scene || null, meshes = [], fishH = [], birdH = [];
  let shadowH = null;
  // clear-sky share of the bed light (soft, centred fish shadows under an overcast sky)
  const direct = /overcast|fog|storm/.test(String(mission.lighting?.hdri || '')) ? 0.15 : Math.min(1, Math.max(0.2, ((mission.lighting?.sunElevDeg ?? 35) - 2) / 25));
  if (scene && renderer) {
    const root = new THREE.Group(); root.name = 'ambientLife'; root.userData.waterIgnore = true; root.userData.dynamic = true;
    const count = (arr) => arr.reduce((m, a) => m.set(a.sp, (m.get(a.sp) || 0) + 1), new Map());
    const shadows = false; // fish: no shadow-map casting (the map ignores refraction: underwater sun is far steeper, shadows soft)
    for (const [sp, n] of count(fish?.fish || [])) { const h = createFishMesh(sp, n, { shadows, envMap: scene.environment || null, envIntensity: o.fishEnv ?? 0.3 }); h.list = fish.fish.filter((f) => f.sp === sp); fishH.push(h); root.add(h.mesh); }
    if (fish?.fish.length) { shadowH = createFishShadows(fish.fish.length); root.add(shadowH.mesh); }
    for (const [sp, n] of count(birds.birds)) { const h = createBirdMesh(sp, n, { shadows: quality !== 'low' }); h.list = birds.birds.filter((b) => b.sp === sp); birdH.push(h); root.add(h.mesh); }
    scene.add(root); meshes.push(root);
  }
  // ---- events → fright / stun / flush
  const wet = (x, z) => !!(water && water.sample(x, z));
  const offs = [], on = (ev, fn) => { const off = world.listen?.(ev, fn); if (typeof off === 'function') offs.push(off); };
  on('explosion', (e) => {
    if (fish && wet(e.x, e.z)) fish.impulse(e.x, e.z, Math.max(6, (e.radius || 3) * 2), 1, { blast: true, stun: 2 + ((e.x * 7 + e.z * 13) & 1) + ((e.radius || 3) > 4 ? 1 : 0) });
    else if (fish) fish.impulse(e.x, e.z, Math.max(5, (e.radius || 3) * 1.5), 0.8);
    birds.noise(e.x, e.z, 90);
  });
  on('shot', (e) => {
    if (e.weapon === 'knife' || e.weapon === 'injection') return;
    const f = e.from || e.shooter; if (f) birds.noise(f.x, f.z, 55);
    const t = e.to; if (fish && t && !e.hit && wet(t.x, t.z)) fish.impulse(t.x, t.z, 2.5, 0.9);
  });
  on('noise', (n) => { if ((n.radius || 0) >= 10) birds.noise(n.x, n.z, Math.min(70, n.radius * 1.3)); });
  on('projectile:bounce', (e) => { if (fish && wet(e.x, e.z)) fish.impulse(e.x, e.z, 3.5, 1); });
  on('unit:water', (e) => { const u = e.unit; if (fish && u && (e.what === 'dive' || e.what === 'surface')) fish.impulse(u.x, u.z, 4, 1); });
  const wk = water?.wakes, prevSplash = wk?.onSplash;
  if (wk) wk.onSplash = (x, z, s) => { prevSplash?.(x, z, s); fish?.impulse(x, z, 2 + 2.5 * s, 1); };
  const last = new WeakMap(), drift = (x, z) => { const w = [0, 0]; env.wind(x, z, w); return [w[0] * 0.03, w[1] * 0.03]; };
  let lastT = null;
  return { fish, birds, stats, meshes, fishH, birdH, env, frame: (dt, camera) => frame(camera), dispose };

  function dispose() {
    offs.forEach((f) => f()); offs.length = 0;
    if (wk && prevSplash !== undefined) wk.onSplash = prevSplash;
    for (const r of meshes) { r.parent?.remove(r); r.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); m.customDepthMaterial?.dispose(); } }); }
    meshes.length = 0;
  }

  function threats(step) {
    const ft = [], bt = [], G = world.grid;
    for (const e of world.entities || []) {
      if (e == null || e.x == null || e.kind === 'projectile' || e.kind === 'item' || e.alive === false || e.removed) continue;
      const p = last.get(e), moving = p ? Math.hypot(e.x - p[0], e.z - p[1]) / step > 0.3 : false;
      if (p) { p[0] = e.x; p[1] = e.z; } else last.set(e, [e.x, e.z]);
      const boat = e.kind === 'vehicle' && e.def?.kind === 'boat';
      if (e.kind !== 'vehicle' && (e.state === 'inVehicle' || e.state === 'carried')) continue;
      bt.push({ x: e.x, z: e.z, moving });
      if (!fish || !(boat || (e.kind !== 'vehicle' && G && wetAtGrid(G, e.x, e.z)))) continue;
      const cls = boat ? 'boat' : e.stance === 'dive' || e.underwater ? 'dive' : e.stance === 'swim' ? 'swim' : 'wade';
      ft.push({ x: e.x, z: e.z, r: FISH_THREAT[cls] * (moving || cls === 'dive' ? 1 : 0.6), s: moving || cls === 'dive' ? 1 : 0.6 });
    }
    return [ft, bt];
  }

  function viewRect(camera) {
    if (!camera?.isOrthographicCamera || (world.game?.cameraRig?.count ?? 1) > 1) return null;
    camera.updateMatrixWorld();
    camera.getWorldDirection(dir);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      tmp.set(a, b, -1).unproject(camera);
      const t = (Y0 - tmp.y) / (Math.abs(dir.y) > 1e-3 ? dir.y : -1e-3);
      const x = tmp.x + dir.x * t, z = tmp.z + dir.z * t;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const m = 2;
    rect.x0 = x0 - m; rect.x1 = x1 + m; rect.z0 = z0 - m; rect.z1 = z1 + m; rect.dx = dir.x / dir.y; rect.dz = dir.z / dir.y;
    return rect;
  }

  function frame(camera) {
    const t0 = performance.now();
    const t = W?.t ?? world.time ?? 0, step = lastT == null ? 0 : t - lastT;
    lastT = t;
    if (step > 0 && step <= 5) { // long gaps (tools advancing seconds between renders) are caught up in ≤0.5 s chunks
      const [ft, bt] = threats(step);
      if (fish) {
        fish.setThreats(ft);
        for (let r = step; r > 1e-6; r -= 0.5) fish.step(Math.min(r, 0.5), drift);
        // rises / dimples → faint rings in the ripple sim (normals only), capped per frame
        for (let k = 0; k < fish.rings.length && k < 6; k++) { const q = fish.rings[k]; water?.disturb?.(q.x, q.z, -0.035 * q.s, 0.22 + 0.2 * q.s, 0.04); stats.rings++; }
        fish.rings.length = 0;
      }
      birds.setThreats(bt);
      for (let r = step; r > 1e-6; r -= 0.5) birds.step(Math.min(r, 0.5));
    }
    const R = viewRect(camera);
    const inView = R ? (x, z, y = Y0) => { const k = Y0 - y, px = x + R.dx * k, pz = z + R.dz * k; return px > R.x0 && px < R.x1 && pz > R.z0 && pz < R.z1; } : null;
    let nf = 0, nb = 0;
    for (const h of fishH) nf += writeFish(h, h.list, inView);
    for (const h of birdH) nb += writeBirds(h, h.list, inView);
    if (shadowH) writeFishShadows(shadowH, fish.fish, inView, renderer?.sunDir || SUN, direct);
    stats.drawnFish = nf; stats.drawnBirds = nb;
    stats.ms = performance.now() - t0;
  }
}

const SUN = { x: 0.3, y: 0.7, z: 0.6 }, Y0 = -0.5, dir = new THREE.Vector3(), tmp = new THREE.Vector3(), rect = { x0: 0, x1: 0, z0: 0, z1: 0, dx: 0, dz: 0 };
const wetAtGrid = (g, x, z) => {
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return false;
  const t = g.terrain[j * g.cols + i];
  return t === T.WATER || t === T.SHALLOW;
};
