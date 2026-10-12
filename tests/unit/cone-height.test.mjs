/**
 * §4.2 occlusion by HEIGHT (user 2026-10-11: "it looks like when there is a small elevation on the ground the cone of
 * visibility excludes that area, even if within the field of vision. If the elevation resides below the eyes that area
 * should be visible"). The sight line runs from the guard's eye (feet + 1.65 m, a platform's height included) to the
 * target's top (a standing man's head 1.7 m, a low man's back 0.3 m); a crossed cell blocks only when its top (raised
 * ground, low cover, a structure by its height, a vehicle) rises above that line. A bump below the eye no longer blanks
 * the ground behind it; low cover still hides a crawler right behind it (the same test with a low target). The drawn
 * cone runs the same test ray by ray (grid.sightRay) and is draped over the drawn ground (grid elev + the terrain's
 * relief), so the relief never hides it. Before: every B.HIGH cell blocked at any height (a 0.4 m rock, M8's 0.5 m
 * drop, crates), a raised cell 1 m over both feet blocked, and the flat cone at y 0.07 sank under every bump.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { World } from '../../src/world/world.js';
import { B } from '../../src/world/grid.js';
import { Rng } from '../../src/core/math.js';
import { makeVision } from '../../src/entities/enemy.js';
import { canSee } from '../../src/ai/perception.js';
import { coneFan, coneRegions, VisionCone, VisionCones } from '../../src/render/vision-cone.js';
import { clearly, check, checkMesh } from './cone-check.mjs';

const man = (x, z, low = false, y = 0) => ({ x, z, y, isLow: low, isVisibleToEnemies: true, kind: 'commando', alive: true });

/** A guard at (10, z) looking east (no sweep) with a 0.4 m rock and a 0.6 m wall ahead in two lanes. */
function lanes() {
  const s = makeSim({
    size: [60, 40],
    structures: [
      { id: 'bump', type: 'rocks', x: 20, z: 10, w: 1.5, d: 3, h: 0.4 },
      { id: 'lowwall', type: 'wall', points: [[20, 25], [20, 29]], h: 0.6 },
    ],
    enemies: [guard('g', 10, 10, 0), guard('g2', 10, 27, 0)],
  }, { brains: false });
  const g = s.get('g'), g2 = s.get('g2');
  g.sweepActive = g2.sweepActive = false;
  return { s, w: s.world, g, g2 };
}

test('height sight: a standing man behind a 0.4 m bump inside the cone is seen (near and far band)', () => {
  const { w, g } = lanes();
  const k = w.grid.idx(40, 20);
  assert.equal(w.grid.block[k], B.HIGH, 'precondition: the rock is a blocking cell');
  assert.equal(canSee(g, man(22, 10), w), 'near', 'just behind the bump');
  assert.equal(canSee(g, man(30, 10), w), 'far', 'far behind it');
  // the ground right behind it is dead ground for a crawler only; a few metres on he is seen again
  assert.equal(canSee(g, man(20.9, 10, true), w), 'none', 'a crawler pressed against its back is hidden');
  assert.equal(canSee(g, man(24, 10, true), w), 'near', 'a crawler 3 m behind it is not');
});

test('height sight: a prone man directly behind a 0.6 m wall is hidden; standing, or prone far behind it, he is seen', () => {
  const { w, g2 } = lanes();
  assert.equal(canSee(g2, man(20.6, 27, true), w), 'none', 'prone, directly behind the low wall');
  assert.equal(canSee(g2, man(20.6, 27, false), w), 'near', 'standing there: his head is above the wall');
  assert.equal(canSee(g2, man(26, 27, true), w), 'near', 'prone 6 m behind it: the sight line clears the wall');
});

test('height sight: raised ground below the eye (a 1.2 m rise) hides nobody standing behind it; a 2.2 m rise does', () => {
  for (const [h, standSeen] of [[1.2, true], [2.2, false]]) {
    const w = new World({ size: [60, 40] });
    w.grid.fillRect(19, 5, 2, 10, 'elev', h);
    const g = { kind: 'enemy', id: 1, x: 10, z: 10, heading: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: false };
    assert.equal(canSee(g, man(26, 10), w) !== 'none', standSeen, `standing behind a ${h} m rise`);
  }
});

test('height sight: from a 4 m tower top a wall of unknown height still hides; over a low wall only its foot is dead ground', () => {
  const w = new World({ size: [60, 40], mission: { rules: { roofRule: false } } });
  w.grid.fillRect(10, 10, 0.5, 0.5, 'elev', 4); // the tower top under him (his own cell)
  w.grid.fillRect(14, 5, 0.5, 10, 'block', B.HIGH); // a wall with no known height: blocks at any height
  const g = { kind: 'enemy', id: 1, x: 10, z: 10, y: 4, heading: 0, alive: true, world: w, vision: makeVision('soldier', { elevated: true }), sweepActive: false };
  assert.equal(canSee(g, man(12.5, 10, true), w), 'near', 'in front of the wall');
  assert.equal(canSee(g, man(15, 10, true), w), 'none', 'behind it');
  // a low wall of known height: the tower guard looks over it (dead ground only right behind it)
  // (and the 4 m platform edge itself hides its own foot: see the bumpy-ground agreement test)
  const s = makeSim({ size: [60, 40], rules: { roofRule: false }, structures: [{ id: 'lw', type: 'wall', points: [[14, 5], [14, 15]], h: 1.2 }] }, { brains: false });
  s.world.grid.fillRect(10, 10, 0.5, 0.5, 'elev', 4);
  const g2 = { ...g, world: s.world };
  assert.equal(canSee(g2, man(14.6, 10, true), s.world), 'none', 'pressed against the low wall');
  assert.equal(canSee(g2, man(20, 10, true), s.world), 'near', 'six metres on');
});

/** Arena on bumpy ground: rises, a plateau, low cover of every kind, tall walls, a truck. */
function bumpy() {
  const s = makeSim({
    size: [90, 90],
    structures: [
      { id: 'rock', type: 'rocks', x: 50, z: 40, w: 2, d: 4, h: 0.4 },
      { id: 'lowwall', type: 'wall', points: [[48, 50], [56, 54]], h: 0.6 },
      { id: 'crates', type: 'crates', x: 57, z: 33, w: 2, d: 2, h: 1.2 },
      { id: 'sand', type: 'sandbags', points: [[45, 28], [52, 26]], h: 1.0 },
      { id: 'wall', type: 'wall', points: [[62, 44], [62, 52]], h: 2.4 },
    ],
  }, { brains: false });
  const g = s.world.grid;
  g.fillRect(43, 35, 3, 6, 'elev', 0.4); // a hump
  g.fillRect(66, 36, 4, 8, 'elev', 1.2); // a rise below the eye
  g.fillRect(70, 30, 10, 20, 'elev', 2.6); // a plateau above the eye (a crawler on it is out of sight)
  g.clearDynamic();
  g.stampDynamic(52, 58, 6, 2.2, 0.3, B.HIGH); // a truck (OCLU)
  return s.world;
}

test('height sight: drawn cone == detection on bumpy ground with low cover (standing and crawling, sweep, elevated)', () => {
  const w = bumpy();
  const rng = new Rng(4242);
  const total = { standIn: 0, standOut: 0, crawlIn: 0, crawlOut: 0 };
  const ground = { kind: 'enemy', id: 1, x: 38, z: 40, heading: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: true };
  ground.vision.phase = 0.21;
  w.grid.fillRect(29, 59, 2, 2, 'elev', 3.5);
  const tower = { kind: 'enemy', id: 2, x: 30, z: 60, y: 3.5, heading: -0.35, alive: true, world: w, vision: makeVision('soldier', { elevated: true, overlooks: true }), sweepActive: true };
  for (const [v, ts] of [[ground, [0, 1.3, 2.6, 3.9]], [tower, [0.4, 2.2]]]) {
    for (const t of ts) {
      const st = check(w, v, t, rng, 1500);
      assert.equal(st.bad.length, 0, `${v.id} t=${t}: ${JSON.stringify(st.bad.slice(0, 4))}`);
      for (const k of Object.keys(total)) total[k] += st[k];
    }
  }
  for (const k of Object.keys(total)) assert.ok(total[k] > 150, `enough ${k} samples (${total[k]})`);
});

test('height sight: the DRAWN cone (sector mesh under the shader window, VisionCone.drawnAt) == detection, sweeping, without rebuilding every frame', () => {
  const w = bumpy();
  const rng = new Rng(777);
  const total = { standIn: 0, standOut: 0, crawlIn: 0, crawlOut: 0 };
  const g = { kind: 'enemy', id: 1, x: 38, z: 40, heading: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: true };
  g.vision.phase = 0.33;
  const vc = new VisionCone(g, w);
  for (const t of [0, 0.7, 1.4, 2.1, 2.9, 3.6, 4.4]) {
    const st = checkMesh(w, g, vc, t, rng, 1200);
    assert.equal(st.bad.length, 0, `t=${t}: ${JSON.stringify(st.bad.slice(0, 4))}`);
    for (const k of Object.keys(total)) total[k] += st[k];
  }
  assert.equal(vc.rebuilds, 1, 'one sector for the whole sweep: the head only moves the uniforms');
  for (const k of Object.keys(total)) assert.ok(total[k] > 60, `enough ${k} samples (${total[k]})`);
  // a walker: rebuilt once he has walked MOVE_EPS (0.3 m), the mesh rides along in between
  const n0 = vc.rebuilds;
  g.sweepActive = false;
  g.x += 0.1; vc.update(g); g.x += 0.1; vc.update(g);
  assert.ok(vc.rebuilds <= n0 + 1, 'small steps: no rebuild each frame');
  g.x += 0.4; vc.update(g);
  assert.ok(vc.rebuilds > n0, 'past 0.3 m: rebuilt');
  vc.dispose();
});

test('height sight: shown cones rebuild within a frame budget (VisionCones) — a walker\'s sector lands a step at a time, coarse while he walks; the settled cone == detection', () => {
  const w = bumpy();
  const rng = new Rng(4242);
  const g = { kind: 'enemy', id: 1, x: 30, z: 40, heading: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: false, coneVisible: true };
  w.enemies.push(g);
  // (a budget far below one step's cost: each frame runs a single step of the rebuild)
  const vcs = new VisionCones(w, { add() {} }, { budgetMs: 0.001 });
  vcs.update();
  const vc = vcs.cones.get(g);
  assert.equal(vc.rebuilds, 1, "the cone's first build is whole, at once");
  let frames = 0, landed = -1, ride = true;
  for (; frames < 400 && landed < 0; frames++) {
    g.x += 0.02; // 1.2 m/s at 60 fps
    vcs.update();
    const S = vc._sector;
    if (Math.abs(vc.group.position.x - (g.x - S.x)) > 1e-9) ride = false;
    if (vc.rebuilds > 1) landed = frames;
  }
  assert.ok(ride, 'meanwhile the shown sector rides along with him');
  assert.ok(landed > 15 + 3, `the walking rebuild is spread over frames (landed ${landed} frames after he set off)`);
  assert.equal(vc._sector.coarse, true, 'built coarse while he walks');
  // he stops: the exact sector follows, a step a frame
  let k = 0;
  for (; k < 4000 && (vc._sector.coarse || vc._job); k++) vcs.update();
  assert.equal(vc._sector.coarse, false, `settled: the exact sector (${k} frames)`);
  const n = vc.rebuilds;
  const st = checkMesh(w, g, vc, 0, rng, 2500);
  assert.equal(vc.rebuilds, n, 'the settled sector is the one checked');
  assert.equal(st.bad.length, 0, `settled drawn cone == detection: ${JSON.stringify(st.bad.slice(0, 4))}`);
  for (const q of ['standIn', 'standOut', 'crawlIn']) assert.ok(st[q] > 40, `enough ${q} samples (${st[q]})`);
  vcs.dispose();
});

test('height sight: the cone runs on past a bump and a low wall; the light shade marks where only a crawler is hidden', () => {
  const { w, g, g2 } = lanes();
  for (const [v, x, z] of [[g, 30, 10], [g2, 26, 27]]) {
    const reg = coneRegions(coneFan(v, w.grid, { t: 0 }));
    assert.equal(clearly(reg.stand, x, z), true, `drawn behind the low obstacle at (${x}, ${z})`);
  }
  // right behind the low wall: drawn for a standing man (light shade), not for a crawler
  const reg = coneRegions(coneFan(g2, w.grid, { t: 0 }));
  assert.equal(clearly(reg.stand, 21, 27, 0.2), true);
  assert.equal(clearly(reg.low, 21, 27, 0.2), false, 'prone-hidden hint: no dark near shade behind the wall');
  assert.equal(clearly(reg.low, 17, 27, 0.2), true, 'dark near shade in front of it');
});

test('height sight: the drawn cone is draped over the ground relief (a 0.4 m swell no longer hides it)', () => {
  const w = new World({ size: [60, 40] });
  w.groundY = (x, z) => 0.4 * Math.exp(-((x - 22) ** 2 + (z - 10) ** 2) / 8); // a swell of the drawn terrain
  w.grid.fillRect(30, 6, 4, 8, 'elev', 0.5); // and a raised cell patch
  const e = { kind: 'enemy', id: 1, x: 10, z: 10, heading: 0, alertLevel: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: false };
  const c = new VisionCone(e, w);
  assert.equal(c.update(e), true);
  let n = 0, under = 0, top = 0;
  for (const geo of [c.nearGeo, c.farGeo]) {
    const p = geo.attributes.position.array, m = geo.drawRange.count;
    for (let i = 0; i < m; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      const ground = w.groundY(x, z) + w.grid.elevAt(x, z);
      n++;
      if (y < ground + 0.03) under++;
      if (Math.abs(x - 22) < 0.5 && Math.abs(z - 10) < 0.5) top = Math.max(top, y);
    }
  }
  assert.ok(n > 1000, `${n} vertices`);
  assert.equal(under, 0, 'no vertex below the drawn ground');
  assert.ok(top > 0.4, `over the swell's crest (${top.toFixed(2)} m)`);
  c.dispose();
});
