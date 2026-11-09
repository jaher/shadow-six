/**
 * Page-side half of tools/ui/bake_mission_stills.mjs (runs inside the game page, `?test=1`): load a mission, let it
 * settle, then frame it through a cinematic PERSPECTIVE camera instead of the game's orthographic 40° view and return
 * the rendered canvas as a PNG data URL. Nothing here ships: the game never imports this file.
 *
 * The engine assumes an orthographic camera in a few places (grass density, building / vehicle LOD by zoom, the
 * shadow fit): the perspective camera carries ortho-style extents (`top/bottom/left/right`, `zoom`) so those keep
 * working, and the rig's ground footprint is replaced by this frustum's (clamped near the subject) for the sun's
 * shadow fit. Decals (selection rings, cones, paths), x-ray ghosts and the overlay scene are hidden: no UI in a still.
 * @module tools/ui/still-camera
 */

const D2R = Math.PI / 180;

/**
 * Load `id` once (ultra preset), start and stop the loop, wait for the apron and the HD textures, advance `advance` s.
 * @param {string} id @param {{advance?: number}} [o]
 */
export async function loadForStill(id, o = {}) {
  const api = window.__game, G = api.game;
  if (G.missionDef?.id === id && G.world) return;
  if (G.renderer.presetName !== 'ultra') api.setPreset('ultra');
  await api.loadMission(id);
  api.start();
  G.stop();
  await G.mapHandle?.terrain?.apronReady;
  try {
    const hd = await import('../../src/engine/hd-textures.js');
    await Promise.race([hd.hdTexturesIdle(), new Promise((r) => setTimeout(r, 25000))]);
  } catch { /* no HD stream: the base textures are fine */ }
  if (o.advance > 0) api.advance(o.advance);
}

/** Ground height (the drawn surface) at x, z. */
function groundY(G, x, z) {
  const t = G.world?.terrain;
  const y = t?.surfaceAt?.(x, z) ?? t?.heightAt?.(x, z) ?? 0;
  return Number.isFinite(y) ? y : 0;
}

/**
 * Pose the still camera for one shot and keep it (tools/ui/ground/ bakes depth and sprites through it):
 * { cam, THREE, warm() (renders the settling frames), png() (the frame as a PNG data URL), restore() }.
 * `shot` as renderStill.
 */
export async function poseStill(shot, W, H) {
  const THREE = await import('three');
  const api = window.__game, G = api.game, R = G.renderer, rig = G.cameraRig, cc = rig.active;
  R.setDynamicScale?.(1);
  const [tx, tz] = shot.at;
  const ty = Number.isFinite(shot.ya) ? shot.ya : groundY(G, tx, tz) + (shot.y ?? 1); // ya: absolute (a summit mesh, a deck)
  const yaw = (shot.yaw ?? 0) * D2R, pitch = (shot.pitch ?? 26) * D2R, d = shot.dist ?? 70, fov = shot.fov ?? 30;
  const Z = 3; // ortho-style zoom the LOD code reads (full-detail buildings / vehicles); the fov compensates
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(Z * Math.tan((fov * D2R) / 2)) / D2R, W / H, 0.5, 4000);
  cam.name = 'stillCamera';
  const vh = 2 * d * Math.tan((fov * D2R) / 2);
  const [sx, sy] = shot.frame || [0, 0];
  /** The pose and projection (re-applied before every frame: nothing else may move this camera). */
  const pose = () => {
    cam.zoom = Z;
    cam.near = 0.5; cam.far = 4000; cam.aspect = W / H;
    cam.position.set(tx + d * Math.sin(yaw) * Math.cos(pitch), ty + d * Math.sin(pitch), tz + d * Math.cos(yaw) * Math.cos(pitch));
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, ty, tz);
    if (sx || sy) cam.setViewOffset(W, H, (-sx * W) / 2, (sy * H) / 2, W, H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // ortho-style extents: grass reads (top-bottom)/zoom as the view height (blade width, density) and
    // (right-left)/zoom as the radius it keeps dense: the subject's view height, and a radius past everything in frame
    cam.top = (vh / 2) * Z; cam.bottom = (-vh / 2) * Z;
    cam.left = -400 * Z; cam.right = 400 * Z;
  };
  pose();
  // the sun's shadow covers this frustum's ground, clamped to shadowR around the subject (an 8k map stays sharp)
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const maxR = shot.shadowR ?? Math.max(90, d * 1.6);
  const footprint = (y = 0) => {
    const out = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1]]) {
      ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
      plane.constant = -y;
      let px, pz;
      if (ray.ray.intersectPlane(plane, hit)) { px = hit.x; pz = hit.z; } else {
        const dir = ray.ray.direction, l = Math.hypot(dir.x, dir.z) || 1;
        px = cam.position.x + (dir.x / l) * 1e4; pz = cam.position.z + (dir.z / l) * 1e4;
      }
      const dx = px - tx, dz = pz - tz, L = Math.hypot(dx, dz);
      if (L > maxR) { px = tx + (dx / L) * maxR; pz = tz + (dz / L) * maxR; }
      out.push({ x: px, y, z: pz });
    }
    return out;
  };
  // own-property patches, undone by restore() (a prototype method is restored by deleting the shadowing property)
  const undo = [];
  const patch = (o, k, v) => {
    const own = Object.prototype.hasOwnProperty.call(o, k), old = o[k];
    undo.push(() => { if (own) o[k] = old; else delete o[k]; });
    o[k] = v;
  };
  const saved = { fog: R.scene.fog, bg: R.scene.background };
  // people: false — the mission's soldiers, prisoners and dogs left out of the frame (the menu's ground fight brings its
  // own: tools/ui/ground/)
  const hidden = [];
  if (shot.people === false) {
    R.scene.traverse((o) => { if (/^real:/.test(o.name) && o.visible) hidden.push(o); });
    for (const o of hidden) patch(o, 'visible', false);
  }
  patch(rig, 'update', () => {});
  patch(rig, 'render', (Rr, dt) => Rr.render(dt));
  patch(rig, 'groundFootprint', footprint);
  patch(cc, '_applyTransform', () => {}); // a resize would put the game's pose back on the camera
  patch(cc, 'camera', cam); // the characters' / vehicles' view culling and LOD read the active view's camera
  patch(cc, 'pxPerMeter', () => 200);
  R.setCamera(cam);
  pose();
  if (R.passes?.xray) R.passes.xray.enabled = false;
  R.decalScene.visible = false;
  R.overlayScene.visible = false;
  // aerial perspective: the mission's fog colour from just past the subject to a few times its distance. Past the
  // far skirt the scene clears to a dark slate (the game never looks that far): the fog colour instead, so a low
  // camera's horizon melts into the haze as the fog would
  const f = R.scene.fog;
  if (f && shot.fog !== false) {
    R.scene.fog = new THREE.Fog(f.color.clone(), shot.fog?.near ?? d * 0.9, shot.fog?.far ?? d * 6);
    if (!R.scene.background || R.scene.background.isColor) R.scene.background = f.color.clone();
  } else if (shot.fog === false) R.scene.fog = null;
  return {
    cam, THREE, pose,
    async warm() {
      for (let i = 0; i < 5; i++) {
        pose();
        api.render();
        if (G.textureWarmer?.queue.length) G.textureWarmer.step(50);
        await new Promise((r) => setTimeout(r, 150));
      }
      pose();
      api.render();
    },
    png: () => R.renderer.domElement.toDataURL('image/png'),
    restore() {
      R.scene.fog = saved.fog;
      R.scene.background = saved.bg;
      R.decalScene.visible = true;
      R.overlayScene.visible = true;
      while (undo.length) undo.pop()();
      R.setCamera(rig.mainCamera);
    },
  };
}

/**
 * Render one shot. `shot`: { at:[x,z], y (m above the ground at `at`, default 1) or ya (absolute height), yaw (deg, the game's convention:
 * 0 = camera south of the subject looking north, 90 = east looking west), pitch (deg below horizontal), dist (m),
 * fov (vertical, deg), frame:[sx,sy] (lens shift, the subject's screen offset in half-frames: +x right, +y up),
 * fog:{near,far} (m from the camera; default: the mission's fog colour from 0.9 to 6 × dist) or false, people
 * (false: the mission's soldiers, prisoners and dogs left out),
 * shadowR (m around the subject the sun's shadow map covers) }.
 * @returns {Promise<string>} PNG data URL of the canvas (W × H device px)
 */
export async function renderStill(shot, W, H) {
  const st = await poseStill(shot, W, H);
  try {
    await st.warm();
    return st.png();
  } finally {
    st.restore();
  }
}
