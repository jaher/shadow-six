/** Sniper-scope 2× magnifier maths (design-spec §5.3): lens camera aim, magnification, sway, target size. */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { CameraController } from '../../src/engine/camera.js';
import { SCOPE, aimLensCamera, breathSway, glassRadius, lensFrustum, lensReuseFrames, lensTargetSize } from '../../src/render/scope-magnifier.js';

function view(yawDeg, zoom, w = 1920, h = 1080) {
  const c = new CameraController({ config: { yawDeg } });
  c.resize(w, h);
  c.setBounds(200, 200);
  c.setZoom(zoom);
  c.centerOn(100, 100);
  return c;
}

const ndc = (cam, g) => new THREE.Vector3(g.x, 0, g.z).project(cam);

for (const yaw of [0, 15, 45]) {
  for (const zoom of [0.5, 1, 2]) {
    test(`lens centred on the cursor's ground point and exactly 2× (yaw ${yaw}, zoom ${zoom})`, () => {
      const v = view(yaw, zoom);
      const cam = new THREE.OrthographicCamera();
      const R = glassRadius(2); // 1080p HUD scale
      for (const [x, y] of [[960, 540], [300, 200], [1700, 900]]) {
        aimLensCamera(cam, v.camera, v, x, y, R);
        const c = ndc(cam, v.screenToGround(x, y));
        near(c.x, 0, 1e-6, 'centre x');
        near(c.y, 0, 1e-6, 'centre y');
        // a ground point R/2 px right of the cursor in the main view sits at the lens rim (R px from its centre): 2×
        const e = ndc(cam, v.screenToGround(x + R / 2, y));
        near(e.x, 1, 1e-6, 'rim x');
        near(e.y, 0, 1e-6, 'rim y');
        const n = ndc(cam, v.screenToGround(x, y - R / 4));
        near(n.y, 0.5, 1e-6, 'screen-up stays up');
        assert.equal(cam.layers.mask, v.camera.layers.mask);
      }
    });
  }
}

test('lens frustum half side = glass radius / magnification / px-per-metre', () => {
  const f = lensFrustum(960, 540, 1920, 1080, 40, 72);
  near(f.half, 72 / SCOPE.magnification / 40);
  near(f.left, -f.half);
  near(f.top, f.half);
  const s = lensFrustum(960, 540, 1920, 1080, 40, 72, 2, { x: 4, y: 0 });
  near(s.left - f.left, 4 / 40, 1e-9, 'sway shifts the window by its px in metres');
});

test('breathing sway is subtle, bounded and slow', () => {
  let mx = 0, my = 0;
  for (let t = 0; t < 20; t += 0.05) {
    const s = breathSway(t, 2);
    mx = Math.max(mx, Math.abs(s.x));
    my = Math.max(my, Math.abs(s.y));
  }
  assert.ok(my <= 2 + 1e-9 && my > 1.9, `vertical amplitude ${my}`);
  assert.ok(mx <= 1.1 + 1e-9 && mx > 0.5, `horizontal amplitude ${mx}`);
  const a = breathSway(1, 2), b = breathSway(1 + 1 / 60, 2);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.06, 'under 0.06 px per 60-Hz frame');
});

test('lens target sized to the glass at HUD scale × DPR, supersampled and capped, plus the reuse margin (1080p … 4K HiDPI)', () => {
  const m = 1 + SCOPE.margin;
  assert.equal(lensTargetSize(glassRadius(1), 1), Math.ceil(Math.ceil(72 * 1.5) * m));
  assert.equal(lensTargetSize(glassRadius(2), 1), Math.ceil(Math.ceil(144 * 1.5) * m));
  assert.equal(lensTargetSize(glassRadius(2), 2), Math.ceil(Math.ceil(288 * 1.5) * m));
  assert.equal(lensTargetSize(glassRadius(3), 2), Math.ceil(SCOPE.maxTarget * m), '4K uiScale 3 at DPR 2 is capped');
  assert.equal(lensTargetSize(glassRadius(1), 1, 1.5, 512, 0), Math.ceil(72 * 1.5), 'no margin: the glass alone');
  assert.ok(lensTargetSize(1, 0.5) >= 16);
});

test('lens reuse keeps the amortised CPU a frame within 80% of the 0.5 ms budget (render every frame when cheap)', () => {
  assert.equal(SCOPE.budgetMs, 0.5);
  assert.equal(lensReuseFrames(0), 0, 'nothing measured yet: render');
  assert.equal(lensReuseFrames(0.3, 0.05), 0, 'under budget: every frame');
  assert.equal(lensReuseFrames(0.4, 0.05), 0);
  assert.equal(lensReuseFrames(0.8, 0), 1, '0.8 ms, free reuse: every other frame (0.4 ms a frame)');
  assert.equal(lensReuseFrames(0.8, 0.15), 2, '0.8 ms + 0.15 ms composites: every third frame (0.37 ms a frame)');
  assert.equal(SCOPE.maxReuse, 3);
  assert.equal(lensReuseFrames(9, 0.1), SCOPE.maxReuse, 'capped: the glass never drops below a quarter of the frame rate');
  assert.equal(lensReuseFrames(1, 0.6), SCOPE.maxReuse, 'reuse itself over budget: as few renders as allowed');
  for (const [ms, re] of [[0.2, 0.05], [0.45, 0.05], [0.6, 0.1], [0.75, 0.12], [0.9, 0.08], [0.6, 0.25]]) {
    const n = lensReuseFrames(ms, re);
    assert.ok(n < SCOPE.maxReuse || n === SCOPE.maxReuse, 'bounded');
    if (n < SCOPE.maxReuse) assert.ok((ms + n * re) / (n + 1) <= 0.4 + 1e-9, `${ms} ms render, ${re} ms reuse → ${n} reuses within 0.4 ms`);
  }
});
