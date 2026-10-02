/**
 * The HUD top bar (§6.1, 45 + 2 ref px × UI scale) covers the top of the view. Verifier 2026-09-30: "the M3 start
 * camera hides the squad under the HUD" and "walkable points within ~1.5 m of the north edge can never be scrolled
 * below the bar". The camera treats the view as the part below the bar (CameraController.hudTop / usableHalf):
 * every map point can be scrolled clear of it at every yaw / zoom / aspect, a recentre lands below it, and the
 * true footprint still stays inside the scenery apron.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { CameraController, CameraRig } from '../../src/engine/camera.js';
import { CONFIG } from '../../src/config.js';

const A = CONFIG.apron.width, M = CONFIG.camera.boundsMargin, REACH = CONFIG.camera.reachMargin;
const MAPS = { m00: [60, 60], b00: [120, 95], m01: [65, 171], m02: [82, 120], m03: [148, 133] };
// [w, h, HUD bar px] — the bar is 47 ref px × UI scale (1.5 at 720p, 2 at 1080p, phone width-limited)
const VIEWS = { '16:9 720p': [1280, 720, 70.5], '21:9': [2560, 1080, 94], '32:9': [3840, 1080, 94],
  'phone portrait': [390, 844, 47 * 0.65], 'phone landscape': [844, 390, 47 * 0.8] };
const RANGE = [-1.6, 1.2];
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v = new THREE.Vector3();

function footprint(c) {
  const out = [];
  for (const y of RANGE) for (const [nx, ny] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
    ndc.set(nx, ny); ray.setFromCamera(ndc, c.camera); pl.constant = -y;
    if (ray.ray.intersectPlane(pl, v)) out.push({ x: v.x, z: v.z });
  }
  return out;
}

function cam(yaw, [w, h, top], [W, D]) {
  const c = new CameraController({ config: { yawDeg: yaw } });
  c.resize(w, h); c.setBounds(W, D); c.setApron(A, RANGE); c.setHudTop(top);
  return c;
}

/** Points along the map border every 2 m (the hardest to reach) plus the corners. */
function border([W, D]) {
  const out = [];
  for (let x = 0; x <= W; x += 2) out.push([x, 0], [x, D]);
  for (let z = 0; z <= D; z += 2) out.push([0, z], [W, z]);
  return out;
}

test('HUD bar: scrolling brings every map border point clear of the bar (feet ≥ reach margin below it), any yaw / zoom / view', () => {
  const _info = console.info; console.info = () => {};
  try {
    for (const [mid, map] of Object.entries(MAPS)) for (const [vn, wh] of Object.entries(VIEWS)) for (const yaw of [0, 15, 45]) {
      const c = cam(yaw, wh, map);
      for (const z of [0.5, 1, 2]) {
        c.setZoom(z);
        const ppm = c.pxPerMeter(), fore = Math.sin(c.elevation), r = (yaw === 0 ? M : REACH) - 0.05;
        let bad = 0, ex = '';
        for (const [x, zz] of border(map)) {
          // scroll toward it (manual clamp): aim the play view's centre (below the bar) at the point
          const s = c.usableShift();
          c.panBy(x - s.x - c.target.x, zz - s.z - c.target.z);
          const p = c.worldToView(x, 0, zz);
          // (a phone at 2× is narrower than two margins: then as close to the middle as the view allows)
          const rx = Math.min(r * ppm, c.width / 2 - 1), ry = Math.min(r * ppm * fore, (c.height - c.hudTop) / 2 - 1);
          const ok = p.y >= c.hudTop + ry && p.y <= c.height - ry && p.x >= rx && p.x <= c.width - rx;
          if (!ok) { bad++; ex ||= `(${x},${zz}) at ${p.x.toFixed(0)},${p.y.toFixed(0)} bar ${c.hudTop}`; }
        }
        assert.equal(bad, 0, `${mid} ${vn} yaw ${yaw} zoom ${c.zoom.toFixed(2)}: ${bad} border points stay under the bar / off-screen, e.g. ${ex}`);
      }
    }
  } finally { console.info = _info; }
});

test('HUD bar: a recentre lands the point inside the play view below the bar (focus inset), not just on screen', () => {
  const _info = console.info; console.info = () => {};
  try {
    for (const yaw of [0, 15, 45]) for (const wh of [VIEWS['16:9 720p'], VIEWS['21:9']]) {
      const c = cam(yaw, wh, MAPS.m03);
      c.setZoom(1);
      // M3 squad start (verifier: id 7 at x 103, z 3.5 had its feet 3 px below the bar)
      const usable = c.height - c.hudTop, tag = `yaw ${yaw} ${wh[0]}x${wh[1]}`;
      c.centerOn(103, 3.5); // a recentre: at least focusInset of the half play view from its top
      let p = c.worldToView(103, 0, 3.5);
      assert.ok(p.y >= c.hudTop + 0.24 * usable / 2 - 1 && c.isVisible(103, 3.5, 20), `${tag}: recentre feet ${p.y.toFixed(0)} px, bar ${c.hudTop}`);
      c.centerOn(103, 3.5, 0.5); // Game.focusSquad: the middle half where the clamp allows
      p = c.worldToView(103, 0, 3.5);
      const head = c.worldToView(103, 1.8, 3.5);
      // (yaw 0: the classic clamp — the view edge stops boundsMargin past the map edge, so the edge row sits that far below the bar)
      const want = yaw === 0 ? Math.min(usable / 4, (M + 3.5) * c.pxPerMeter() * Math.sin(c.elevation)) : usable / 4;
      assert.ok(p.y >= c.hudTop + want - 1, `${tag}: squad focus feet ${p.y.toFixed(0)} px in the middle half below the ${c.hudTop} px bar`);
      assert.ok(head.y > c.hudTop + 60 && p.y < c.height - 60, `${tag}: head ${head.y.toFixed(0)} px well clear of the bar`);
    }
  } finally { console.info = _info; }
});

test('HUD bar: the true footprint stays inside the apron when scrolled into every edge and corner', () => {
  const _info = console.info; console.info = () => {};
  try {
    for (const [mid, map] of Object.entries(MAPS)) for (const [vn, wh] of Object.entries(VIEWS)) for (const yaw of [0, 15, 45]) {
      const c = cam(yaw, wh, map);
      for (const z of [0.25, 0.5, 1, 2]) {
        c.setZoom(z);
        if (z >= 0.5) assert.ok(c.apronMinZoom() <= Math.max(z, c.minZoomForMap()) + 1e-9, `${mid} ${vn} yaw ${yaw}: the bar raises the zoom floor above ${z}× (${c.zoom.toFixed(2)})`);
        for (const [sx, sy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          c.centerOn(map[0] / 2, map[1] / 2);
          for (let i = 0; i < 300; i++) c.update(0.05, { x: sx, y: sy });
          for (const p of footprint(c)) {
            assert.ok(p.x >= -A - 1e-6 && p.x <= map[0] + A + 1e-6 && p.z >= -A - 1e-6 && p.z <= map[1] + A + 1e-6,
              `${mid} ${vn} yaw ${yaw} zoom ${c.zoom.toFixed(2)} push (${sx},${sy}): footprint (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) past the apron`);
          }
        }
      }
    }
  } finally { console.info = _info; }
});

test('HUD bar: without one the clamp is unchanged; the rig gives the bar only to views at the canvas top', () => {
  const a = new CameraController({ config: { yawDeg: 15 } }), b = new CameraController({ config: { yawDeg: 15 } });
  for (const c of [a, b]) { c.resize(1280, 720); c.setBounds(148, 133); }
  b.setHudTop(0);
  assert.deepEqual(a.clampHalfExtents(), b.clampHalfExtents());
  a.centerOn(0, 0); b.centerOn(0, 0);
  assert.deepEqual([a.target.x, a.target.z], [b.target.x, b.target.z]);
  // yaw 0, bar 70.5 px at zoom 1: the north limit moves the bar's depth further out, the south one is unchanged
  const c0 = new CameraController({ config: { yawDeg: 0 } }), c1 = new CameraController({ config: { yawDeg: 0 } });
  for (const c of [c0, c1]) { c.resize(1280, 720); c.setBounds(148, 133); }
  c1.setHudTop(70.5);
  const bar = 70.5 / 40 / Math.sin(c1.elevation);
  c0.centerOn(74, 0); c1.centerOn(74, 0);
  assert.ok(Math.abs(c0.target.z - c1.target.z - bar) < 1e-6, `north limit ${c0.target.z} → ${c1.target.z}`);
  c0.centerOn(74, 133); c1.centerOn(74, 133);
  assert.ok(Math.abs(c0.target.z - c1.target.z) < 1e-6, 'south limit unchanged');
  const rig = new CameraRig({ hudTop: () => 94 });
  rig.resize(1920, 1080);
  assert.equal(rig.views[0].hudTop, 94);
  rig.setViews(2); rig.setViews(2); // stacked layout
  assert.deepEqual(rig.views.map((x) => x.hudTop), [94, 0]);
});
