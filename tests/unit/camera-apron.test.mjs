/**
 * "Never see the map boundary" (user request 2026-09-30): with a scenery apron of CONFIG.apron.width past every edge,
 * the view's TRUE ground footprint (the four screen-corner rays met with the lowest and the highest apron ground)
 * stays inside it at every zoom the player can reach, at 0 / 15 / 45°, on 4:3 … 32:9 and phone views; every map
 * corner still scrolls into view; the zoom floor is raised only where a view could not otherwise fit (logged).
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { CameraController, CameraRig } from '../../src/engine/camera.js';
import { CONFIG } from '../../src/config.js';

const A = CONFIG.apron.width;
const MAPS = { m00: [60, 60], b00: [120, 95], m01: [65, 171], m02: [82, 120], m03: [148, 133] };
const VIEWS = { '16:9': [1920, 1080], '4:3': [1440, 1080], '21:9': [2520, 1080], '32:9': [3840, 1080], '32:9 small': [1920, 540],
  'phone portrait': [390, 844], 'phone landscape': [844, 390] };
const RANGE = [-1.6, 1.2];
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v = new THREE.Vector3();

/** Screen corners (and edge mid-points) ray-cast to the planes y = lo and y = hi: the true ground footprint. */
function footprint(c) {
  const out = [];
  for (const y of RANGE) for (const [nx, ny] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
    ndc.set(nx, ny); ray.setFromCamera(ndc, c.camera); pl.constant = -y;
    if (ray.ray.intersectPlane(pl, v)) out.push({ x: v.x, z: v.z });
  }
  return out;
}

function cam(yaw, [w, h], [W, D]) {
  const c = new CameraController({ config: { yawDeg: yaw } });
  c.resize(w, h); c.setBounds(W, D); c.setApron(A, RANGE);
  return c;
}

test('apron: the true footprint never leaves the apron at any reachable zoom / yaw / aspect / scroll position', () => {
  const floors = [];
  const _info = console.info; console.info = () => {};
  try {
    for (const [mid, map] of Object.entries(MAPS)) for (const [vn, wh] of Object.entries(VIEWS)) for (const yaw of [0, 15, 45]) {
      const c = cam(yaw, wh, map);
      for (const z of [0.25, 0.5, 1, 2]) {
        c.setZoom(z);
        if (c.apronMinZoom() > Math.max(z, c.minZoomForMap()) + 1e-9 && z >= 0.5) floors.push(`${mid} ${vn} ${yaw}° → ${c.zoom.toFixed(2)}`);
        for (const [sx, sy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          c.centerOn(map[0] / 2, map[1] / 2);
          for (let i = 0; i < 300 && (sx || sy); i++) c.update(0.05, { x: sx, y: sy });
          const tag = `${mid} ${vn} yaw ${yaw} zoom ${c.zoom.toFixed(2)} push (${sx},${sy})`;
          for (const p of footprint(c)) {
            assert.ok(p.x >= -A - 1e-6 && p.x <= map[0] + A + 1e-6 && p.z >= -A - 1e-6 && p.z <= map[1] + A + 1e-6,
              `${tag}: footprint point (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) past the ${A} m apron`);
          }
        }
        for (const [x, zz] of [[0, 0], [map[0], 0], [0, map[1]], [map[0], map[1]]]) {
          c.centerOn(x, zz);
          assert.ok(c.worldToView(x, 0, zz).visible, `${mid} ${vn} yaw ${yaw}: map corner (${x},${zz}) reachable`);
        }
      }
    }
  } finally { console.info = _info; }
  // the apron never raises the floor above the lowest discrete level (0.5×) on these views (only the 0.25× setZoom
  // floor is lifted on very wide views)
  assert.deepEqual(floors, [], 'apron zoom floors at 0.5× and up');
});

test('apron: zoom floor is logged once per map / view / yaw and lifted when the view shrinks', () => {
  const lines = [], _info = console.info; console.info = (s) => lines.push(String(s));
  try {
    const c = cam(45, [3840, 1080], MAPS.m03);
    c.setZoom(0.25); c.setZoom(0.25);
    assert.ok(c.zoom > 0.25 && c.zoom <= 0.5, `32:9 at 45°: zoom floor raised (${c.zoom})`);
    assert.equal(lines.filter((s) => s.includes('zoom floor')).length, 1, 'logged once');
    c.resize(1280, 720); c.setZoom(0.25);
    assert.ok(Math.abs(c.zoom - 0.25) < 1e-9, `a 1280x720 view: back to 0.25× (${c.zoom})`);
    const r = new CameraRig({ config: { yawDeg: 15 } });
    r.resize(1920, 1080); r.setBounds(...MAPS.m02); r.setApron(A, RANGE); r.setViews(2);
    for (const view of r.views) assert.equal(view.apron, A, 'every view (and new ones) carry the apron');
  } finally { console.info = _info; }
});

test('apron: without one the legacy rules hold (no floor, 4 m margin + slanted overshoot)', () => {
  const c = new CameraController({ config: { yawDeg: 45 } });
  c.resize(3840, 1080); c.setBounds(...MAPS.m03); c.setZoom(0.5);
  assert.ok(Math.abs(c.zoom - 0.5) < 1e-9);
  assert.equal(c.apronMinZoom(), 0);
});
