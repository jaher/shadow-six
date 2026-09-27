// Camera views + footprint overlay for review.html. window.view(name, {w, h, zoom}) renders one view.
const K = window.__K;
const { THREE, scene, renderer, S } = K;
const PX_PER_M = 40;                 // game: 40 CSS px per metre at zoom 1
const PITCH = THREE.MathUtils.degToRad(40);
function ortho(w, h, zoom) {
  const vw = w / (PX_PER_M * zoom), vh = h / (PX_PER_M * zoom);
  return new THREE.OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, 0.1, 500);
}
function overlay(show) {
  S.overlay.clear();
  if (!show || !S.box) return;
  const c = S.box.getCenter(new THREE.Vector3()), sz = S.box.getSize(new THREE.Vector3());
  const top = S.box.max.y + 0.05, R = Math.ceil(Math.max(sz.x, sz.z) / 2 + 3);
  const pts = [];
  for (let v = -R; v <= R; v += 0.5) { pts.push(v, top, -R, v, top, R, -R, top, v, R, top, v); }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  S.overlay.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthTest: false })));
  const m = S.meta || {};
  const cellMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.22, depthTest: false });
  for (const [i, j] of (m.auto_cells_0p5 || [])) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), cellMat); q.rotation.x = -Math.PI / 2;
    q.position.set(i * 0.5 + 0.25, top, j * 0.5 + 0.25); S.overlay.add(q);
  }
  const line = (arr, col, y = top + 0.01, closed = true) => {
    const p = arr.map(([x, z]) => new THREE.Vector3(x, y, z)); if (closed) p.push(p[0].clone());
    S.overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: col, depthTest: false })));
  };
  const BC = { HIGH: 0xff2020, LOW: 0xffa020, FENCE: 0x20c0ff, NONE: 0x80ff80 };
  for (const f of m.footprints || []) line(f.points, BC[f.block] || 0xffffff);
  for (const r of m.roofs || []) line(r.points, r.walkable ? 0x3080ff : 0x8060ff, top + 0.02);
  for (const cl of m.climb || []) line([cl.a, cl.b], 0xffff00, top + 0.03, false);
  for (const d of m.doors || []) {
    const [x, , z] = d.pos, h = d.heading, L = 1.2;
    line([[x, z], [x + Math.cos(h) * L, z + Math.sin(h) * L]], 0x00ff60, top + 0.04, false);
    const q = new THREE.Mesh(new THREE.CircleGeometry(0.25, 12), new THREE.MeshBasicMaterial({ color: 0x00ff60, depthTest: false }));
    q.rotation.x = -Math.PI / 2; q.position.set(x, top + 0.04, z); S.overlay.add(q);
  }
  for (const l of m.ladders || []) line([l.a, l.b], 0xff00ff, top + 0.05, false);
}
window.view = async (name, { w = 900, h = 700, zoom = 1, ao = true, dz = 0 } = {}) => {
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  const c = S.box.getCenter(new THREE.Vector3()), sz = S.box.getSize(new THREE.Vector3());
  let cam; overlay(name === 'top');
  S.ground.visible = true;
  if (name === 'game') {
    cam = ortho(w, h, zoom);
    const t = new THREE.Vector3(c.x, S.box.min.y + sz.y * 0.3, c.z + sz.z * dz);
    cam.position.set(t.x, t.y + Math.sin(PITCH) * 100, t.z + Math.cos(PITCH) * 100); cam.lookAt(t);
  } else if (name === 'front') {
    const z = Math.max(sz.x / w, sz.y / h) * 1.15; cam = ortho(w, h, 1 / (PX_PER_M * z));
    cam.position.set(c.x, c.y, c.z + 100); cam.lookAt(c.x, c.y, c.z);
  } else if (name === 'top') {
    const z = Math.max(sz.x / w, sz.z / h) * 1.2 + 0.004; cam = ortho(w, h, 1 / (PX_PER_M * z));
    cam.position.set(c.x, 150, c.z); cam.up.set(0, 0, -1); cam.lookAt(c.x, 0, c.z);
  } else {   // close 3/4 perspective from the south-west / south-east
    cam = new THREE.PerspectiveCamera(32, w / h, 0.1, 1000);
    const dir = name === 'close_se' ? new THREE.Vector3(0.62, 0.42, 0.66) : name === 'side_e' ? new THREE.Vector3(0.95, 0.2, 0.22) : name === 'side_w' ? new THREE.Vector3(-0.95, 0.2, 0.22) : new THREE.Vector3(-0.62, 0.36, 0.7);
    const r = Math.max(sz.x, sz.y * 1.3, sz.z) * 1.55 * (name === 'detail' ? 0.45 : 1);
    const t = name === 'detail' ? new THREE.Vector3(c.x - sz.x * 0.2, S.box.min.y + sz.y * 0.35, S.box.max.z) : c;
    cam.position.copy(t).addScaledVector(dir.normalize(), r); cam.lookAt(t);
  }
  const comp = new K.EffectComposer(renderer);
  comp.setSize(w, h);
  comp.addPass(new K.RenderPass(scene, cam));
  if (ao) { const g = new K.GTAOPass(scene, cam, w, h); g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.0 }); g.blendIntensity = 0.8; comp.addPass(g); }
  comp.addPass(new K.OutputPass());
  for (let i = 0; i < 3; i++) comp.render();
  await new Promise(r => requestAnimationFrame(r));
  comp.dispose();
  return true;
};
window.ready = true;

// Fallback sidecar for GLBs not built with the kit: rasterised footprint cells, convex-hull footprint, roof height.
window.autoMeta = () => {
  const cells = new Set(), pts = [], ys = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], q = new THREE.Vector3();
  S.root.updateMatrixWorld(true);
  S.root.traverse(o => {
    if (!o.isMesh || o.material.transparent) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
      for (const p of v) ys.push(p.y);
      const L = Math.max(v[0].distanceTo(v[1]), v[1].distanceTo(v[2]), v[2].distanceTo(v[0])), s = Math.max(1, Math.ceil(L / 0.2));
      for (let a = 0; a <= s; a++) for (let b = 0; b <= s - a; b++) {
        q.copy(v[0]).addScaledVector(v[1].clone().sub(v[0]), a / s).addScaledVector(v[2].clone().sub(v[0]), b / s);
        if (q.y < 0.05 || q.y > 2.2) continue;
        const key = `${Math.floor(q.x / 0.5)},${Math.floor(q.z / 0.5)}`;
        if (!cells.has(key)) { cells.add(key); const [i, j] = key.split(',').map(Number); pts.push([i * 0.5, j * 0.5], [i * 0.5 + 0.5, j * 0.5], [i * 0.5, j * 0.5 + 0.5], [i * 0.5 + 0.5, j * 0.5 + 0.5]); }
      }
    }
  });
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  ys.sort((a, b) => a - b);
  const eave = ys[Math.floor(ys.length * 0.8)] || 0, top = ys[ys.length - 1] || 0;
  return { auto: true, footprints: [{ shape: 'poly', points: hull, block: 'HIGH', kind: 'auto_hull' }],
    auto_cells_0p5: [...cells].map(k => k.split(',').map(Number)), roofs: [{ points: hull, elev: +eave.toFixed(2), walkable: false, kind: 'auto' }],
    climb: hull.map((p, i) => ({ a: p, b: hull[(i + 1) % hull.length], top: +eave.toFixed(2), kind: 'auto' })), height: +top.toFixed(2), doors: [] };
};
