/** Sniper-scope 2× magnifier maths (design-spec §5.3): lens camera aim, magnification, sway, target size. */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { CameraController } from '../../src/engine/camera.js';
import { SCOPE, ScopeMagnifier, aimLensCamera, breathSway, glassRadius, lensFrustum, lensReuseFrames, lensTargetSize } from '../../src/render/scope-magnifier.js';
import { registerKit, kitBegin, kitEnd, disposeKit } from '../../src/art/kit-batch.js';

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

// --- the Germans' batched kit (art/kit-batch.js) in the lens: men 70 m apart, each a body + a rifle drawn by a batch
function platoonKit() {
  const scene = new THREE.Scene(), men = [], mat = new THREE.MeshStandardMaterial();
  const rifleGeo = new THREE.BoxGeometry(0.05, 0.05, 1), rifleMat = new THREE.MeshStandardMaterial({ color: 0x332211 });
  for (const [x, z] of [[0, 0], [70, 0], [0, 40]]) {
    const man = new THREE.Group(); man.position.set(x, 0, z); scene.add(man);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), mat); body.position.y = 0.9; man.add(body);
    const rifle = new THREE.Mesh(rifleGeo, rifleMat); rifle.position.set(0.2, 1.2, 0); man.add(rifle);
    men.push({ man, body, rifle });
  }
  scene.updateMatrixWorld(true);
  registerKit(men.map((m) => m.rifle));
  return { scene, men, kitRoot: () => scene.children.find((o) => o.name === 'kit-batch') };
}
/** The lens camera straight down on (x, z), a 4 m window (as aimLensCamera leaves it: matrices current). */
function aimDown(M, x, z) {
  const c = M.camera;
  c.left = c.bottom = -2; c.right = c.top = 2; c.near = 1; c.far = 100; c.updateProjectionMatrix();
  c.up.set(0, 0, -1); c.position.set(x, 50, z); c.lookAt(x, 0, z); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
}

test('scope lens: the kit batches\' root is never culled whole — a second target far from the first keeps his rifle in the glass', () => {
  disposeKit();
  const { scene, men, kitRoot } = platoonKit(), M = new ScopeMagnifier({});
  men[1].man.visible = false;                         // off screen while the first target is in the glass
  kitBegin(scene);
  aimDown(M, 0, 0);
  M._hideOutside(scene);
  assert.equal(kitRoot().visible, true, 'first target: his kit is drawn');
  assert.equal(men[2].man.visible, false, 'a man outside the window is still culled whole');
  M._unhide(); kitEnd();
  men[0].man.visible = false; men[1].man.visible = true;   // the view moves 70 m to the second target
  kitBegin(scene);
  aimDown(M, 70, 0);
  M._hideOutside(scene);
  assert.equal(kitRoot().visible, true, 'second target: the batches are not culled by bounds cached at the first');
  const live = kitRoot().children.filter((p) => p.visible && p.count && !M._hid.includes(p));
  assert.equal(live.length, 1, 'his rifle batch is drawn');
  const im = new THREE.Matrix4();
  const at = [...Array(live[0].count).keys()].map((i) => (live[0].getMatrixAt(i, im), im.elements[12]));
  assert.ok(at.some((x) => Math.abs(x - 70.2) < 1e-4), 'with his rifle at his hands');
  M._unhide(); kitEnd();
  disposeKit();
});

test('scope lens: the valid target is drawn by his own kit meshes in the world and highlight passes (depth-equal glow on his rifle)', () => {
  disposeKit();
  const { scene, men, kitRoot } = platoonKit(), M = new ScopeMagnifier({ scene });
  M.hlMat = new THREE.MeshBasicMaterial();
  kitBegin(scene);
  aimDown(M, 0, 0);
  assert.equal(men[0].rifle.layers.mask, 0, 'the batch draws his rifle in the main view');
  const passes = [];   // per r.render: what three would draw (visible chain, on the camera's layers)
  const r = {
    info: { render: { frame: 1, calls: 0 } }, autoClear: true, shadowMap: { autoUpdate: true },
    getRenderTarget: () => null, setRenderTarget() {},
    render(s, cam) { const d = []; s.traverseVisible((o) => { if ((o.isMesh) && o.layers.test(cam.layers)) d.push([o, o.material]); }); passes.push(d); },
  };
  M._renderWorld(r, null, { id: 7, object3d: men[0].man });
  assert.equal(passes.length, 2, 'world + highlight');
  const [world, hl] = passes;
  assert.ok(world.some(([o]) => o === men[0].rifle), 'world pass: his rifle by its own mesh (as without batches)');
  const rifles = world.filter(([o]) => o.isInstancedMesh && o.geometry === men[0].rifle.geometry).map(([o]) => o);
  assert.equal(rifles.length, 1, 'one batch of rifles in the world pass');
  const im = new THREE.Matrix4(), xs = [];
  for (let i = 0; i < rifles[0].count; i++) { rifles[0].getMatrixAt(i, im); xs.push(`${im.elements[12].toFixed(1)},${im.elements[14].toFixed(1)}`); }
  assert.deepEqual(xs.sort(), ['0.2,40.0', '70.2,0.0'], 'the others\' rifles batched, not his (no double draw)');
  const batch = rifles[0];
  assert.deepEqual(hl.map(([o]) => o), [men[0].body, men[0].rifle], 'highlight: body and rifle');
  assert.ok(hl.every(([, m]) => m === M.hlMat), 'both in the highlight material');
  assert.equal(men[0].rifle.material, batch.material, 'material restored');
  kitEnd();
  assert.equal(men[0].rifle.layers.mask, 1);
  disposeKit();
});
