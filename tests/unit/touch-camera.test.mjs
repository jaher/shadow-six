/** Camera.zoomAt (touch pinch): continuous zoom anchored on the fingers' midpoint, clamped like the other zooms. */
import { test, assert, near } from './lib.mjs';
import { CameraController } from '../../src/engine/camera.js';

function view(yaw = 15) {
  const c = new CameraController({ config: { yawDeg: yaw } });
  c.resize(1280, 720);
  c.setBounds(300, 300);
  c.centerOn(150, 150);
  return c;
}

for (const yaw of [0, 15]) {
  test(`zoomAt keeps the ground under the midpoint fixed (yaw ${yaw})`, () => {
    const c = view(yaw);
    const g0 = c.screenToGround(900, 250);
    c.zoomAt(1.6, 900, 250);
    near(c.zoom, 1.6, 1e-9);
    const g1 = c.screenToGround(900, 250);
    near(g1.x, g0.x, 1e-6);
    near(g1.z, g0.z, 1e-6);
    c.zoomAt(0.7, 900, 250);
    const g2 = c.screenToGround(900, 250);
    near(g2.x, g0.x, 1e-6);
    near(g2.z, g0.z, 1e-6);
  });
}

test('zoomAt stays within the 0.5×–2× levels and cancels a running zoom tween', () => {
  const c = view();
  c.zoomStep(1);
  assert.ok(c.tweening);
  assert.equal(c.zoomAt(9, 640, 360), 2);
  assert.equal(c.tweening, false);
  assert.equal(c.zoomAt(0.01, 640, 360), Math.max(0.5, c.minZoomForMap()));
  c.update(0.5); // nothing left to tween
  assert.equal(c.zoom, Math.max(0.5, c.minZoomForMap()));
});

test('zoomAt near the map edge re-clamps the target', () => {
  const c = view(0);
  c.zoomAt(2, 640, 360);
  c.centerOn(0, 0);
  const t0 = { x: c.target.x, z: c.target.z };
  c.zoomAt(0.5, 5, 5); // zooming out at the corner would show the void: the clamp pushes the target in
  const e = c.clampHalfExtents();
  assert.ok(c.target.x >= c.bounds.minX + e.x - 1e-6 && c.target.z >= c.bounds.minZ + e.z - 1e-6);
  assert.ok(c.target.x > t0.x);
});
