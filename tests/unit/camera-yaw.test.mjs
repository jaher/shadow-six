/** Camera yaw (Options "Camera angle"; CONFIG.camera.yawDeg): panning, clamping, zoom anchor, picking, minimap frustum. */
import { test, assert, near } from './lib.mjs';
import { CameraController, CameraRig } from '../../src/engine/camera.js';
import { CONFIG } from '../../src/config.js';
import { OPTION_ROWS, OPTION_HELP, formatOption } from '../../src/ui/options-panel.js';
import { OPTION_DEFAULTS, loadOptions, saveOptions } from '../../src/ui/ui-config.js';

const YAWS = [0, 15, 45];
const W = 1920, H = 1080, MAP = [200, 150];
const M = CONFIG.camera.boundsMargin, REACH = CONFIG.camera.reachMargin;

function view(yaw, zoom = 1, w = W, h = H) {
  const c = new CameraController({ config: { yawDeg: yaw } });
  c.resize(w, h);
  c.setBounds(...MAP);
  c.setZoom(zoom);
  c.centerOn(100, 75);
  return c;
}

test('default yaw is the tilted camera (+15°): east faces show on screen-right', () => {
  assert.equal(CONFIG.camera.yawDeg, 15);
  const c = view(CONFIG.camera.yawDeg);
  const o = c.viewOffset();
  assert.ok(o.x > 0 && o.z > 0, 'camera sits south-east of its target');
  near(Math.atan2(o.x, o.z) * 180 / Math.PI, 15, 1e-9);
  // a building's east face (x = +1) projects to the right of its west face (x = −1)
  assert.ok(c.worldToView(101, 0, 75).x > c.worldToView(99, 0, 75).x);
  // and the east face is visible: its outward normal (+x) points toward the camera
  assert.ok(o.x > 0);
  near(o.y, Math.sin(40 * Math.PI / 180), 1e-12, 'pitch stays 40°');
});

test('panning: arrow Right moves the view to the screen right, Down to the screen bottom, at every yaw', () => {
  for (const yaw of YAWS) {
    const c = view(yaw);
    const before = c.worldToView(100, 0, 75);
    c.update(0.1, { x: 1, y: 0 }); // 30 m/s × 0.1 s = 3 m along screen-right
    const a = c.worldToView(100, 0, 75);
    near(a.x - before.x, -3 * 40, 1e-6, `yaw ${yaw}: the old centre slides left by 3 m`);
    near(a.y - before.y, 0, 1e-6, `yaw ${yaw}: no vertical drift`);
    c.update(0.1, { x: 0, y: 1 });
    const b = c.worldToView(100, 0, 75);
    near(b.x - a.x, 0, 1e-6, `yaw ${yaw}: no horizontal drift`);
    near(b.y - a.y, -3 * 40 * Math.sin(40 * Math.PI / 180), 1e-6, `yaw ${yaw}: the old centre slides up`);
    // middle-drag: the ground follows the cursor 1:1
    const g = c.worldToView(110, 0, 80);
    c.panScreen(-37, 21);
    const g2 = c.worldToView(110, 0, 80);
    near(g2.x - g.x, 37, 1e-6);
    near(g2.y - g.y, -21, 1e-6);
  }
});

test('bounds: all four screen edges and corners keep every map corner reachable, void bounded', () => {
  const inside = (c, x, z) => {
    const p = c.worldToView(x, 0, z), ppm = c.pxPerMeter(), fore = Math.sin(c.elevation);
    const r = c.yawDeg === 0 ? M : REACH; // yaw 0: the old 4 m rule; with yaw at least reachMargin (2 m)
    return p.x >= r * ppm - 1e-6 && p.x <= c.width - r * ppm + 1e-6 && p.y >= r * ppm * fore - 1e-6 && p.y <= c.height - r * ppm * fore + 1e-6;
  };
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const yaw of YAWS) for (const zoom of [0.5, 1, 2]) {
    const c = view(yaw, zoom);
    const hw = W / 2 / c.pxPerMeter(), over = c.clampOvershoot();
    if (yaw === 0) assert.equal(over, 0, 'yaw 0: exactly the old 4 m rule');
    else assert.ok(over > 0 && over < 2 * hw * Math.sin(yaw * Math.PI / 180), `yaw ${yaw} z${zoom}: overshoot ${over} below the slanted-edge wedge`);
    for (const [sx, sy] of dirs) {
      c.centerOn(100, 75);
      for (let i = 0; i < 400; i++) c.update(0.05, { x: sx, y: sy }); // hold the arrows / edge scroll
      const tag = `yaw ${yaw} z${zoom} push (${sx},${sy})`;
      for (const p of c.groundFootprint(0)) {
        assert.ok(p.x >= -M - over - 1e-6 && p.x <= MAP[0] + M + over + 1e-6, `${tag}: x ${p.x}`);
        assert.ok(p.z >= -M - over - 1e-6 && p.z <= MAP[1] + M + over + 1e-6, `${tag}: z ${p.z}`);
      }
    }
    // every map corner can be scrolled into view with a margin (centerOn = recentre / minimap click)
    for (const [x, z] of [[0, 0], [MAP[0], 0], [0, MAP[1]], [MAP[0], MAP[1]]]) {
      c.centerOn(x, z);
      assert.ok(inside(c, x, z), `yaw ${yaw} z${zoom}: corner (${x},${z}) reachable`);
    }
  }
});

test('bounds: a pan that meets a map edge slides along it (Up against the west limit reaches the north edge)', () => {
  for (const [w, h] of [[1280, 720], [1920, 1080]]) for (const yaw of [15, 45]) for (const zoom of [0.5, 1, 2]) {
    const c = view(yaw, zoom, w, h), e = c.clampHalfExtents(), b = c.bounds, tag = `yaw ${yaw} z${zoom} ${w}`;
    const lo = { x: b.minX + e.x, z: b.minZ + e.z }, hi = { x: b.maxX - e.x, z: b.maxZ - e.z };
    // start low on the west limit (as on M1: the commandos start at the south-west), hold Up
    c.target.set(lo.x, 0, hi.z); c._applyTransform();
    for (let i = 0; i < 600; i++) c.update(0.05, { x: 0, y: -1 });
    near(c.target.z, lo.z, 1e-6, `${tag}: Up reaches the north limit`);
    near(c.target.x, lo.x, 1e-6, `${tag}: …sliding down the west limit`);
    // from the NW corner every direction that points into the map moves; the ones into the corner are dead
    const moves = (p) => { c.target.set(lo.x, 0, lo.z); c._applyTransform(); c.update(0.1, p); return Math.hypot(c.target.x - lo.x, c.target.z - lo.z); };
    assert.ok(moves({ x: 1, y: 0 }) > 0.5 && moves({ x: 0, y: 1 }) > 0.5, `${tag}: Right / Down leave the corner`);
    assert.ok(moves({ x: -1, y: 1 }) > 0.5, `${tag}: Down+Left slides south along the west limit`);
    // edge scroll right at the east limit slides along it (screen-right has a north component) until the corner
    c.target.set(hi.x, 0, (lo.z + hi.z) / 2); c._applyTransform();
    const z0 = c.target.z;
    c.update(0.1, { x: 1, y: 0 });
    near(c.target.x, hi.x, 1e-6);
    assert.ok(c.target.z < z0, `${tag}: Right at the east limit slides north`);
  }
});

test('setYaw re-clamps: a corner target legal at 0° is pulled in at 45° (no extra void, no snap on the next key)', () => {
  const c = view(0, 1, 1280, 720);
  c.centerOn(0, 0);
  const t0 = c.target.clone();
  c.setYaw(45);
  const e = c.clampHalfExtents(), b = c.bounds;
  assert.ok(c.target.x >= b.minX + e.x - 1e-9 && c.target.z >= b.minZ + e.z - 1e-9, 'inside the 45° clamp');
  assert.ok(c.target.x > t0.x && c.target.z > t0.z, 'pulled in');
  const voidPast = Math.max(...c.groundFootprint(0).flatMap((p) => [-p.x, -p.z]));
  assert.ok(voidPast <= M + 1e-6, `no wedge past the 4 m margin (${voidPast.toFixed(2)} m)`);
  assert.ok(c.worldToView(t0.x, 0, t0.z).visible, 'the old centre stays on screen');
  const t1 = c.target.clone();
  c._applyTransform();
  near(c.target.x, t1.x, 1e-12); near(c.target.z, t1.z, 1e-12);
});

test('focusTarget: recentres / tracking / the briefing tour stay void-free unless the point needs the loose clamp', () => {
  for (const yaw of [15, 45]) for (const zoom of [0.5, 1]) {
    const c = view(yaw, zoom, 1280, 720), tag = `yaw ${yaw} z${zoom}`;
    const voidPast = () => Math.max(...c.groundFootprint(0).flatMap((p) => [-p.x, p.x - MAP[0], -p.z, p.z - MAP[1]]));
    // a point 15 m in from the east edge (M1 tour start): the view stays inside the 4 m margin
    c.centerOn(MAP[0] - 15, 75);
    assert.ok(voidPast() <= M + 1e-6, `${tag}: no wedge past the margin (${voidPast().toFixed(2)} m)`);
    assert.ok(c.worldToView(MAP[0] - 15, 0, 75).visible, `${tag}: the point is on screen`);
    // a map corner still comes into view (the loose clamp is used, only as far as needed)
    for (const [x, z] of [[0, 0], [MAP[0], MAP[1]], [16.5, 8]]) {
      c.centerOn(x, z);
      const p = c.worldToView(x, 0, z);
      assert.ok(p.x >= REACH * c.pxPerMeter() - 1e-6 && p.x <= c.width - REACH * c.pxPerMeter() + 1e-6 && p.visible, `${tag}: (${x},${z}) reachable`);
    }
    // mid-map: exactly centred
    c.centerOn(100, 75);
    near(c.target.x, 100, 1e-9); near(c.target.z, 75, 1e-9);
  }
  const c0 = view(0, 0.5, 1280, 720);
  c0.centerOn(3, 3);
  const e = c0.viewHalfExtents();
  near(c0.target.x, -M + e.x, 1e-9, 'yaw 0: the plain clamp');
});

test('zoom to cursor keeps the ground under the pointer at every yaw', () => {
  for (const yaw of YAWS) {
    const c = view(yaw);
    const px = W * 0.7, py = H * 0.35;
    const g0 = c.screenToGround(px, py);
    c.zoomStep(1, px, py);
    for (let i = 0; i < 6; i++) c.update(0.05);
    assert.equal(c.zoom, 2);
    const g1 = c.screenToGround(px, py);
    assert.ok(Math.hypot(g1.x - g0.x, g1.z - g0.z) < 1e-6, `yaw ${yaw}: anchor drift`);
  }
});

test('picking round-trip: worldToScreen → screenToGround at every yaw and height', () => {
  for (const yaw of [...YAWS, -15, 30]) {
    const c = view(yaw, 1);
    for (const [x, z] of [[100, 75], [90, 70], [112, 83], [85, 66]]) for (const y of [0, 2.5]) {
      const s = c.worldToScreen(x, y, z);
      const g = c.screenToGround(s.x, s.y, y);
      near(g.x, x, 1e-6, `yaw ${yaw}`);
      near(g.z, z, 1e-6, `yaw ${yaw}`);
    }
  }
});

test('minimap frustum: the ground footprint is the view rectangle rotated by the yaw, centred on the target', () => {
  for (const yaw of YAWS) {
    const c = view(yaw);
    const fp = c.groundFootprint(0); // NDC (−1,−1) (1,−1) (1,1) (−1,1): bottom-left, bottom-right, top-right, top-left
    assert.equal(fp.length, 4);
    near(fp.reduce((a, p) => a + p.x, 0) / 4, c.target.x, 1e-6);
    near(fp.reduce((a, p) => a + p.z, 0) / 4, c.target.z, 1e-6);
    const top = { x: fp[2].x - fp[3].x, z: fp[2].z - fp[3].z }, side = { x: fp[3].x - fp[0].x, z: fp[3].z - fp[0].z };
    near(Math.atan2(-top.z, top.x) * 180 / Math.PI, yaw, 1e-6, 'top edge slants by the yaw');
    near(Math.hypot(top.x, top.z), W / 40, 1e-6, 'width 48 m at 1×');
    near(Math.hypot(side.x, side.z), H / 40 / Math.sin(40 * Math.PI / 180), 1e-6, 'depth foreshortened by sin 40°');
    near(top.x * side.x + top.z * side.z, 0, 1e-6, 'a rectangle');
  }
});

test('setYaw keeps the target; the rig applies it to every view, new views and copies', () => {
  const c = view(0);
  c.centerOn(90, 70);
  c.setYaw(15);
  near(c.target.x, 90, 1e-9);
  near(c.target.z, 70, 1e-9);
  near(c.yawDeg, 15, 1e-9);
  const rig = new CameraRig({});
  rig.resize(1200, 800);
  rig.setBounds(...MAP);
  rig.setYaw(45);
  rig.setViews(3);
  for (const v of rig.views) near(v.yawDeg, 45, 1e-9);
  rig.setYaw(0);
  for (const v of rig.views) near(v.yawDeg, 0, 1e-9);
  rig.setViews(4);
  near(rig.views[3].yawDeg, 0, 1e-9, 'a new view starts at the rig yaw');
});

test('tiny maps: at the minimum zoom a rotated view still shows every map corner', () => {
  for (const yaw of YAWS) {
    const c = new CameraController({ config: { yawDeg: yaw } });
    c.resize(W, H);
    c.setBounds(30, 20);
    c.setZoom(0.1);
    assert.ok(c.zoom >= c.minZoomForMap() - 1e-9);
    for (const [x, z] of [[0, 0], [30, 0], [0, 20], [30, 20]]) {
      c.centerOn(x, z);
      assert.ok(c.worldToView(x, 0, z).visible, `yaw ${yaw}: (${x},${z})`);
    }
  }
});

test('Options → CAMERA ANGLE: Classic 0° / Tilted 15° (default) / Isometric 45°, persisted', () => {
  const row = OPTION_ROWS.find((r) => r[0] === 'cameraAngle');
  assert.deepEqual(row?.[2], [0, 15, 45]);
  assert.ok(OPTION_HELP.cameraAngle);
  assert.equal(OPTION_DEFAULTS.cameraAngle, CONFIG.camera.yawDeg);
  assert.deepEqual([0, 15, 45].map((v) => formatOption('cameraAngle', v)), ['CLASSIC 0°', 'TILTED 15°', 'ISOMETRIC 45°']);
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadOptions(storage).cameraAngle, 15);
  saveOptions({ ...loadOptions(storage), cameraAngle: 0 }, storage);
  assert.equal(loadOptions(storage).cameraAngle, 0);
});

test('audio pans along the screen-right axis of a yawed camera', async () => {
  const { spatialize } = await import('../../src/audio/engine.js');
  const yaw = 15 * Math.PI / 180;
  // a source on screen-right (world direction (cos, −sin)) pans right; one straight "up the screen" stays centred
  near(spatialize({ x: 10 * Math.cos(yaw), z: -10 * Math.sin(yaw) }, 0, 0, 40, 0, 'mech', yaw).pan, 0.4, 1e-9);
  near(spatialize({ x: -10 * Math.sin(yaw), z: -10 * Math.cos(yaw) }, 0, 0, 40, 0, 'mech', yaw).pan, 0, 1e-9);
  near(spatialize({ x: 10, z: 0 }, 0, 0, 40).pan, 0.4, 1e-9, 'yaw 0 unchanged');
});
