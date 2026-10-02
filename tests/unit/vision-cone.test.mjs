import { test, assert } from './lib.mjs';
import { VisionCone, VisionCones, coneFan, paletteColors } from '../../src/render/vision-cone.js';
import { CONFIG } from '../../src/config.js';
import { World } from '../../src/world/world.js';
import { makeVision } from '../../src/entities/enemy.js';

const viewer = (extra = {}) => ({ kind: 'enemy', x: 10, z: 10, heading: 0, alertLevel: 0, alive: true, vision: makeVision('soldier'), ...extra });

test('vision cone: depth-tested ground decal, flat BEL colours, cached fan', () => {
  let casts = 0;
  const grid = { version: 1, dynamicVersion: 0, castRay: (x, z, a, r) => { casts++; return r; } };
  const enemy = viewer({ world: { grid, time: 0 } });
  const c = new VisionCone(enemy, enemy.world);
  assert.equal(c.nearMesh.material.depthTest, true, 'occluded by world geometry');
  assert.equal(c.nearMesh.material.depthWrite, false);
  assert.equal(c.update(enemy), true);
  const n = casts;
  assert.ok(n >= 96, `≥ 96 rays (${n})`);
  assert.equal(c.nearMesh.material.color.getHex(), 0x02bc6f, 'BEL green near');
  assert.equal(c.farMesh.material.color.getHex(), 0x07675a, 'BEL green far');
  assert.equal(c.nearMesh.material.opacity, 0.5);
  assert.equal(c.update(enemy), false, 'unchanged enemy → cached');
  assert.equal(casts, n);
  enemy.alertLevel = 2;
  c.update(enemy);
  assert.equal(c.nearMesh.material.color.getHex(), 0x02bc6f, 'faithful mode: no colour change by alert level');
  const t = new VisionCone(enemy, enemy.world, { alertTint: true });
  t.update(enemy);
  assert.equal(t.nearMesh.material.color.getHex(), 0xe04030, 'alertTint: red at alertLevel 2');
  enemy.heading = 0.5; assert.equal(c.update(enemy), true, 'turn → rebuild');
  enemy.x += 1; assert.equal(c.update(enemy), true, 'move → rebuild');
  grid.version++; assert.equal(c.update(enemy), true, 'grid change (door) → rebuild');
  grid.dynamicVersion++; assert.equal(c.update(enemy), true, 'dynamic occluder change → rebuild');
  c.dispose(); t.dispose();
});

test('vision cone: desert palette, spotter highlight 75%', () => {
  assert.deepEqual(paletteColors('desert'), { near: 0xd26e02, far: 0x6b4c01 });
  const enemy = viewer({ world: { grid: null, time: 0 } });
  const c = new VisionCone(enemy, { mission: { coneColors: 'desert' } });
  c.update(enemy);
  assert.equal(c.nearMesh.material.color.getHex(), 0xd26e02);
  c.highlight = true; c.update(enemy);
  assert.equal(c.nearMesh.material.opacity, CONFIG.stealth.spotterHighlight.alpha);
});

test('vision cone: rays refine at occluder corners (angle ± ε)', () => {
  const w = new World({ size: [60, 60] });
  w.grid.fillRect(20, 5, 2, 4, 'block', 2); // pillar in front of the viewer
  const e = viewer({ world: w });
  const fan = coneFan(e, w.grid);
  let minGap = Infinity;
  for (let k = 1; k < fan.angles.length; k++) {
    if (Math.abs(fan.dists[k] - fan.dists[k - 1]) > 5) minGap = Math.min(minGap, fan.angles[k] - fan.angles[k - 1]);
  }
  assert.ok(minGap < 0.001, `shadow edge resolved to < 0.001 rad (${minGap})`);
  assert.ok(fan.angles.length < CONFIG.stealth.coneMaxRays);
});

test('VisionCones: one cone at a time, spotter promotes, probe ring triggers once', () => {
  const w = new World({ size: [60, 60] });
  const added = [];
  const scene = { add: (o) => added.push(o) };
  const a = viewer({ id: 1, world: w }), b = viewer({ id: 2, x: 40, z: 40, heading: Math.PI, world: w });
  w.enemies.push(a, b);
  const vc = new VisionCones(w, scene);
  a.coneVisible = true; vc.update();
  assert.equal(vc.cones.size, 1);
  b.coneVisible = true; vc.update();
  assert.equal(a.coneVisible, false, 'showing b hides a');
  assert.deepEqual([...vc.cones.keys()], [b]);
  w.events.emit('enemy:spotted', { enemy: a, target: null });
  vc.update();
  assert.deepEqual([...vc.cones.keys()], [a], 'spotter cone becomes the shown one');
  assert.equal(vc.cones.get(a).highlight, true);
  w.time = 1.1; vc.update();
  assert.equal(vc.cones.get(a).highlight, false, 'highlight lasts 1 s');
  const p = vc.setProbe(25, 38); // inside b's cone (b at 40,40 looking west)
  vc.update();
  assert.equal(p.triggered, true);
  assert.equal(p.enemy, b);
  assert.deepEqual([...vc.cones.keys()], [b]);
  vc.dispose();
});

test('VisionCones: a probe the caller already resolved is triggered at once and never re-shows a hidden cone', () => {
  const w = new World({ size: [60, 60] });
  const scene = { add: () => {} };
  const b = viewer({ id: 2, x: 40, z: 40, heading: Math.PI, world: w });
  w.enemies.push(b);
  const vc = new VisionCones(w, scene);
  b.coneVisible = true; // Game.probe → showOnlyCone(b)
  const p = vc.setProbe(25, 38, b);
  assert.equal(p.triggered, true);
  assert.equal(p.enemy, b);
  b.coneVisible = false; // the player hides it (eye tool / click) before the next frame
  vc.update();
  assert.equal(b.coneVisible, false, 'no late trigger re-shows the hidden cone');
  vc.dispose();
});
