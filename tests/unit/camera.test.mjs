/** CORE2 camera maths without a DOM (design-spec §2.1–§2.3). */
import { test, assert, near } from './lib.mjs';
import { CameraController, CameraRig, VIEW_LAYOUTS } from '../../src/engine/camera.js';

function view(w = 1920, h = 1080, map = [200, 200]) {
  const c = new CameraController({});
  c.resize(w, h);
  c.setBounds(...map);
  c.centerOn(100, 100);
  return c;
}

test('§2.2 ground width shown per zoom level on a 1920-px canvas', () => {
  const c = view();
  for (const [z, width] of [[0.5, 96], [1, 48], [2, 24]]) {
    c.setZoom(z);
    near(c.viewHalfExtents().x * 2, width, 1e-9, `zoom ${z}`);
    near(c.pxPerMeter(), 40 * z, 1e-9);
  }
});

test('§2.2 zoom tween takes 0.25 s and steps discrete levels', () => {
  const c = view();
  c.zoomStep(1);
  c.update(0.125);
  assert.ok(c.zoom > 1 && c.zoom < 2);
  c.update(0.125);
  assert.equal(c.zoom, 2);
  c.zoomStep(1); // already at the top level
  c.update(0.3);
  assert.equal(c.zoom, 2);
  c.zoomReset();
  c.update(0.3);
  assert.equal(c.zoom, 1);
});

test('§2.3 bounds clamp the view to 4 m past the map edge; recentre tween 0.35 s', () => {
  const c = view();
  c.centerOn(-50, 300);
  const e = c.viewHalfExtents();
  near(c.target.x - e.x, -4, 1e-9);
  near(c.target.z + e.z, 204, 1e-9);
  c.centerOn(100, 100);
  c.recenterOn(120, 90);
  c.update(0.2);
  assert.ok(c.target.x > 100 && c.target.x < 120);
  c.update(0.15);
  near(c.target.x, 120, 1e-9);
  near(c.target.z, 90, 1e-9);
});

test('§2.3 tracking follows the entity; pan input is ignored while tracking', () => {
  const c = view();
  const u = { x: 80, z: 120 };
  c.track(u);
  u.x = 85;
  c.update(0.1, { x: 1, y: 0 });
  near(c.target.x, 85, 1e-9);
  c.untrack();
  c.update(0.1, { x: 1, y: 0 });
  near(c.target.x, 85 + 30 * 0.1, 1e-9);
});

test('§2.3 multi-view layouts tile the canvas; F-key repeat cycles; shrinking keeps the active view', () => {
  for (const [n, layouts] of Object.entries(VIEW_LAYOUTS)) {
    for (const L of layouts) {
      assert.equal(L.length, Number(n));
      const area = L.reduce((a, [, , w, h]) => a + w * h, 0);
      near(area, 1, 1e-9, `layout ${n} covers the canvas`);
    }
  }
  const rig = new CameraRig({});
  rig.resize(1200, 800);
  rig.setBounds(200, 200);
  rig.active.centerOn(50, 60);
  rig.setViews(3);
  assert.equal(rig.count, 3);
  assert.equal(rig.views[2].target.x, rig.views[0].target.x, 'new views copy the active view');
  rig.setViews(3);
  assert.equal(rig.layout, 1);
  rig.views[2].centerOn(150, 150);
  rig.activate(2);
  rig.setViews(1);
  assert.equal(rig.count, 1);
  near(rig.active.target.x, 150, 1e-9, 'the active view survives');
  const st = rig.getState();
  const rig2 = new CameraRig({});
  rig2.resize(1200, 800);
  rig2.setBounds(200, 200);
  rig2.setState({ ...st, count: 2, layout: 1, views: [st.views[0], { x: 20, z: 30, zoom: 2, track: null }] });
  assert.equal(rig2.count, 2);
  assert.equal(rig2.layout, 1);
  assert.equal(rig2.views[1].zoom, 2);
});
