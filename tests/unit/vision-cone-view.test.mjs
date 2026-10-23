/**
 * VisionCones.update(camera): the cones a view cannot show wait (M11 perf: no sector rebuilt for a guard off the
 * screen), the ones it can show are refreshed in the same call, before the frame draws them — judged against the view
 * as the camera stands now, the guard's cone as he stands now, its whole reach, the ground it is drawn over, and with
 * a margin so a sector is built before its cone scrolls into view.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { VisionCones } from '../../src/render/vision-cone.js';
import { coneAt } from '../../src/ai/perception.js';
import { World } from '../../src/world/world.js';
import { makeVision } from '../../src/entities/enemy.js';

/** The game's view: orthographic, 40° down, 32 × 18 m of screen (ground z ± 14 m). */
function camera() {
  const c = new THREE.OrthographicCamera(-16, 16, 9, -9, 1, 900);
  c.updateProjectionMatrix();
  return look(c, 0, 0);
}
/**
 * Put the view over (x, z) like CameraController (position and pitch), minus its updateMatrixWorld: the matrices stay as
 * the last update left them until something refreshes them (lookAt would).
 */
function look(c, x, z) {
  const el = 40 * Math.PI / 180;
  c.position.set(x, Math.sin(el) * 200, z + Math.cos(el) * 200);
  c.rotation.set(-el, 0, 0);
  return c;
}

function setup(guards = [{ x: 100, z: 100, heading: 0 }], { groundY = null } = {}) {
  const w = new World({ size: [300, 300] });
  if (groundY) w.groundY = groundY;
  const es = guards.map((g, i) => {
    const e = { kind: 'enemy', id: i + 1, x: g.x, z: g.z, y: g.y ?? 0, heading: g.heading, alertLevel: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: false, coneVisible: true };
    w.enemies.push(e);
    return e;
  });
  const vcs = new VisionCones(w, { add() {} }, { multiCone: 8 });
  return { w, es, vcs, e: es[0] };
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const current = (vc, e) => {
  const k = coneAt(e), d = vc.drawnWindow();
  return Math.abs(wrap(d.heading - k.heading)) < 1e-9 && d.x === k.x && d.z === k.z;
};

test('cones in view: a guard on the screen has his cone drawn as he stands; off the screen it waits, and is refreshed the call the view returns', () => {
  const { es: [e], vcs } = setup();
  const cam = look(camera(), 100, 100);
  vcs.update(cam);
  const vc = vcs.cones.get(e);
  assert.equal(vc.rebuilds, 1, 'built on first sight');
  assert.ok(vc.group.visible && current(vc, e), 'drawn as he stands');
  // the camera goes elsewhere: the guard turns and steps — nothing is rebuilt for a cone nobody sees
  look(cam, 250, 250);
  e.heading = 1; e.x += 0.5;
  for (let i = 0; i < 5; i++) vcs.update(cam);
  assert.equal(vc.rebuilds, 1, 'no sector rebuilt while off the screen');
  assert.equal(vc.drawnWindow().heading, 0, 'and left as it was');
  // back: the very call that sees him refreshes the cone (the frame draws it right after)
  look(cam, 100, 100);
  vcs.update(cam);
  assert.ok(current(vc, e), 'refreshed in the call that finds it on the screen');
  assert.ok(vc.rebuilds >= 2, 'its sector follows him');
});

test('cones in view: the camera pose is read as it stands (a draw-time copy a frame behind would miss a cone coming into view)', () => {
  const { es: [e], vcs } = setup([{ x: 100, z: 100, heading: 0 }]);
  const cam = look(camera(), 250, 250);
  cam.updateMatrixWorld(); // (the pose the last draw saw: nowhere near him)
  look(cam, 100, 100); // the rig's pose this frame, matrices not yet refreshed
  vcs.update(cam);
  const vc = vcs.cones.get(e);
  assert.equal(vc.rebuilds, 1, 'built the frame the camera arrives');
  assert.ok(current(vc, e));
});

test('cones in view: a guard off the screen whose cone swings onto it is drawn (the cone as he stands now, not as last refreshed)', () => {
  const { es: [e], vcs } = setup([{ x: 55, z: 100, heading: Math.PI }]);
  const cam = look(camera(), 55, 100);
  vcs.update(cam); // on screen, looking west
  const vc = vcs.cones.get(e);
  assert.equal(vc.rebuilds, 1);
  look(cam, 100, 100); // the view moves east: x 84..116, he is 29 m from its edge
  vcs.update(cam);
  assert.equal(vc.rebuilds, 1, 'looking away from the screen: waits');
  e.heading = 0; // he turns east: his 36 m cone reaches x 91
  vcs.update(cam);
  assert.ok(current(vc, e), 'his cone is on the screen: drawn as he stands');
  for (let i = 0; i < 400 && vc.rebuilds < 2; i++) vcs.update(cam); // (the sector is rebuilt a slice a frame)
  assert.ok(vc.rebuilds >= 2, 'a sector for the way he faces');
  assert.ok(vc.drawnAt(90, 100) === 'far' || vc.drawnAt(90, 100) === 'near', 'the cone covers the ground on the screen');
});

test('cones in view: a sector is built before its cone scrolls into view (a margin past the screen edge), not before that', () => {
  const { es: [e], vcs } = setup([{ x: 140, z: 100, heading: 0 }]);
  const cam = look(camera(), 100, 100); // x 84..116: he is 24 m past the edge
  vcs.update(cam);
  const vc = vcs.cones.get(e);
  assert.equal(vc.rebuilds, 0, 'far from the screen: nothing built');
  look(cam, 120, 100); // x 104..136: 4 m from his apex
  vcs.update(cam);
  assert.equal(vc.rebuilds, 1, 'built as the screen nears');
  assert.ok(vc._bounds.x0 > 136, 'before any of it can show');
  assert.ok(current(vc, e));
});

test('cones in view: the ground a cone is drawn over counts (a plateau ahead of a guard in the lowland puts it up the screen)', () => {
  const plateau = (x) => (x > 110 ? 30 : 0);
  const { es: [e], vcs } = setup([{ x: 100, z: 100, heading: 0 }], { groundY: plateau });
  // a point 30 m up appears 30 / tan 40° = 35.8 m further up the screen: this view (ground z 36..64, x 118..150) holds
  // only the plateau's part of his cone, drawn at height 30 — a flat box about his own height would never reach it
  const cam = look(camera(), 134, 50);
  vcs.update(cam);
  const vc = vcs.cones.get(e);
  assert.equal(vc.rebuilds, 1, 'the cone on the plateau is on the screen');
  assert.ok(vc._bounds.y1 > 29, `and drawn up there (${vc._bounds.y1.toFixed(1)})`);
  assert.ok(current(vc, e));
});

test('cones in view: several views (no camera) refresh every cone', () => {
  const { es: [e], vcs } = setup([{ x: 100, z: 100, heading: 0 }]);
  vcs.update();
  assert.equal(vcs.cones.get(e).rebuilds, 1);
  e.heading = 2;
  vcs.update();
  assert.ok(current(vcs.cones.get(e), e));
});
