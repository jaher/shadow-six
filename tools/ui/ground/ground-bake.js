/**
 * Page side of tools/ui/ground/bake_ground.mjs (runs inside the game page, `?test=1`): pose a theatre's backdrop camera
 * exactly as its menu still was baked (tools/ui/still-camera.js, tools/ui/loading-shots.mjs THEATRES), then hand out
 * what the menu's ground fight needs from that same render: the camera, a depth map, the frame itself (to check the
 * alignment with the shipped still) and sprites of the game's own soldiers and tank rendered through the same camera
 * in the same light. Nothing here ships: the game never imports this file.
 * @module tools/ui/ground/ground-bake
 */

import { loadForStill, poseStill } from '../still-camera.js';
import { THEATRES } from '../loading-shots.mjs';

let S = null;          // the posed shot: { cam, THREE, warm, png, restore, W, H }

/** Load the theatre's mission and pose its still camera at W x H (the page is that size). @returns the camera */
export async function setup(theatre, W, H) {
  const shot = THEATRES[theatre];
  await loadForStill(shot.mission, { advance: shot.advance ?? 4 });
  window.__game.game.renderer.resize();
  S = await poseStill(shot, W, H);
  S.W = W; S.H = H;
  await S.warm();
  const c = S.cam;
  return { theatre, W, H, near: c.near, far: c.far, position: c.position.toArray(),
    matrixWorld: [...c.matrixWorld.elements], projection: [...c.projectionMatrix.elements] };
}

/** The posed frame as rendered (PNG data URL). */
export async function still() {
  await S.warm();
  return S.png();
}

/**
 * The scene's depth through the still camera: rendered into a float depth texture, linearised to metres from the
 * camera plane and stored as 16 bits (R high, G low byte) at 1/32 m; B = 255 where nothing was drawn (the sky).
 * @returns {string} PNG data URL (W x H, top row first)
 */
export function depth() {
  const { THREE, cam, W, H } = S, R = window.__game.game.renderer, r = R.renderer;
  S.pose?.();
  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.depthTexture = new THREE.DepthTexture(W, H);
  rt.depthTexture.type = THREE.FloatType;
  const out = new THREE.WebGLRenderTarget(W, H);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: rt.depthTexture }, near: { value: cam.near }, far: { value: cam.far } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDepth; uniform float near, far; varying vec2 vUv;
      void main() {
        float d = texture2D(tDepth, vUv).x;
        float z = (near * far) / (far - d * (far - near));
        float q = clamp(floor(z * 32.0 + 0.5), 0.0, 65535.0), hi = floor(q / 256.0), lo = q - hi * 256.0;
        gl_FragColor = vec4(hi / 255.0, lo / 255.0, d >= 0.99999 ? 1.0 : 0.0, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat), oc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = r.getRenderTarget(), auto = r.autoClear;
  r.autoClear = true;
  r.setRenderTarget(rt); r.render(R.scene, cam);
  r.setRenderTarget(out); r.render(quad, oc);
  const px = new Uint8Array(W * H * 4);
  r.readRenderTargetPixels(out, 0, 0, W, H, px);
  r.setRenderTarget(prev); r.autoClear = auto;
  rt.dispose(); out.dispose(); mat.dispose(); quad.geometry.dispose();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), im = g.createImageData(W, H);
  for (let y = 0; y < H; y++) im.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  g.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}

/** The clips a soldier made with `make` can play (createRealHumanoid opts). */
export async function clips(make) {
  const H = await import('/src/art/humanoid-real.js');
  await H.loadCharacterLibrary();
  const a = H.createRealHumanoid(make);
  await a.ready;
  const out = {};
  for (const n of ['kneel_shoot', 'rifle_aim', 'aim', 'shoot', 'rifle_shoot', 'prone_shoot', 'prone_aim', 'go_prone', 'crawl', 'crawl_idle',
    'die', 'dead', 'die_prone', 'dead_prone', 'hit', 'run', 'run_fast', 'sprint', 'crouch_idle', 'crouch_walk']) {
    a.setAnim(n, { restart: true, fade: 0, transition: false });
    for (let k = 0; k < 6; k++) a.update(1 / 30);
    const inner = a.inner || {};
    out[n] = inner._anim || inner._animName || inner._clipName || inner.clip?.name || (inner.mixer?._actions || []).filter((x) => x.isRunning()).map((x) => x.getClip().name).join('+');
  }
  a.dispose?.();
  return out;
}

/** Let the camera go back to the game. */
export function done() { S?.restore(); S = null; }

/** Re-arm a German (enemykit's own equip and long-gun clip aliases): `name` from weapons.glb. */
async function arm(actor, name) {
  const H = await import('/src/art/humanoid-real.js'), W = await import('/src/art/characters/enemies/enemy_weapons.js');
  const E = H.characterLibrary().rt.enemies?.E, h = actor.inner;
  if (!E || !h || !W.equipEnemy(h, E.weapons, name)) return;
  if (W.LONG.has(name)) h.clipAlias = { ...(h.clipAlias || {}), aim: 'rifle_aim', aim_up: 'rifle_aim', aim_down: 'rifle_aim', kneel_shoot: 'rifle_aim', shoot: 'rifle_fire', rifle_shoot: 'rifle_fire', reload: 'rifle_reload' };
}

/** His gun's muzzle in world space (a socket node, or a weapon-local point as enemykit keeps them), if the gun shows. */
function muzzleOf(actor) {
  const h = actor.inner, w = h?.weapon;
  if (!w || w.visible === false || !actor.weaponName?.()) return null;
  let vis = true;
  for (let o = w; o; o = o.parent) if (o.visible === false) vis = false;
  if (!vis) return null;
  const s = w.userData?.sockets?.muzzle;
  if (!s) return null;
  w.updateMatrixWorld(true);
  return s.isVector3 ? w.localToWorld(s.clone()) : s.getWorldPosition(new s.position.constructor());
}

/**
 * Sprites of one actor through the still camera, standing at a world spot in the scene's own light and fog: the actor
 * alone (every other mesh hidden), rendered over black and over white through the game's post chain; the two give its
 * coverage and colour (a difference matte). The page is the sprite window's size (w x h); `zoom` sets how many render
 * px a still px is. spec: { kind: 'soldier' | 'vehicle', make (createRealHumanoid opts | { type, theater }), at: [x, z],
 * zoom, anchor (where across the window he stands, 0..1), poses: [{ key, heading (rad, the game's: front = +Z), clip, t (s into the clip), turret, gunPitch (rad),
 * recoil (m), travel (m: wheels and tracks rolled) }] }.
 * @returns {Promise<{pxm: number, frames: {key: string, png: string, ax: number, ay: number}[]}>} (ax, ay): the actor's
 *   ground point in the window (px); pxm: still px per metre there
 */
export async function sprites(spec) {
  const { THREE, cam } = S, api = window.__game, G = api.game, R = G.renderer, r = R.renderer;
  const w = r.domElement.width, h = r.domElement.height, Z = spec.zoom || 4;
  const [x, z] = spec.at, t = G.world?.terrain;
  const y = spec.y ?? (t?.surfaceAt?.(x, z) ?? t?.heightAt?.(x, z) ?? 0);
  let actor, root;
  if (spec.kind === 'soldier') {
    const H = await import('/src/art/humanoid-real.js');
    await H.loadCharacterLibrary();
    actor = H.createRealHumanoid(spec.make);
    await actor.ready;
    actor.setLOD?.(400);
    root = actor.root;
    if (spec.arm) await arm(actor, spec.arm);                        // a German given another gun (an NCO's MP40)
    for (const n of spec.unalias || []) if (actor.inner?.clipAlias) delete actor.inner.clipAlias[n];   // his own kneel, not the standing aim
    if (spec.prop) actor.equipProp?.(spec.prop);                     // a clip-bound hand prop (the sapper's Mills bomb)
    if (spec.headgear === false) actor.show?.('headgear', false);
    // every clip asked for once, then a moment for the clip libraries that load on demand
    for (const n of new Set(spec.poses.map((ps) => ps.clip).filter(Boolean))) { actor.setAnim(n, { restart: true }); actor.update(1 / 30); }
    for (let i = 0; i < 30 && actor.inner?._pending; i++) await new Promise((res) => setTimeout(res, 100));
    await new Promise((res) => setTimeout(res, 800));
  } else {
    const VL = await import('/src/art/vehicle-library.js');
    if (!VL.vehicleLibraryReady()) await VL.loadVehicleLibrary(null, {});
    await VL.preloadVehicles([spec.make.type], { theater: spec.make.theater, destroyed: false });
    actor = VL.createVehicleVisual(spec.make.type, { theater: spec.make.theater, destroyed: false, wreck: false, seed: 3 });
    await actor.ready;
    actor.setZoom?.(99);
    root = actor.object3d;
  }
  R.scene.add(root);
  root.position.set(x, y, z);
  // his own sun shadow on the ground (spec.shadow: its darkness, as the still's shadows on that ground): a shadow
  // catcher under him, part of the sprite (the window over black and white is taken without it)
  let catcher = null;
  if (spec.shadow) {
    catcher = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ color: 0x000000, opacity: spec.shadow, depthWrite: false }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.015; catcher.receiveShadow = true; catcher.castShadow = false;
    catcher.name = 'ground-bake-shadow';
    root.add(catcher);
  }
  // everything else out of the frame (meshes only: the lights stay, wherever they hang)
  const mine = new Set(); root.traverse((o) => mine.add(o));
  const hid = [];
  R.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && !mine.has(o) && o.visible) { o.visible = false; hid.push(o); } });
  const bg0 = R.scene.background;
  // the composer's own scenes off too (water, VFX, decals, x-ray): the world pass, AO, tone mapping, LUT and AA stay
  const keep = /^(RenderPass|AlphaAwareGTAOPass|GTAOPass|SanitizePass|UnrealBloomPass|OutputPass|LUTPass|SMAAPass|FXAAPass)$/;
  const off = (R.composer?.passes || []).filter((ps, i) => ps.enabled && (!keep.test(ps.constructor.name) || (i > 0 && ps.constructor.name === 'RenderPass')));
  for (const ps of off) ps.enabled = false;
  // the window: the actor's ground point at its lower middle, in a frame Z times the still's (3840 x 2160 / 2). A
  // view offset only crops the image plane, so the window is placed in the unshifted frame: the still's own lens
  // shift (THEATRES' frame) moves where the actor sits in the still, not how he looks
  const fw = 1920 * Z, fh = 1080 * Z;
  cam.aspect = 16 / 9;                                               // the still's frame (a resize sets the window's)
  cam.clearViewOffset(); cam.updateProjectionMatrix();
  const q = new THREE.Vector3(x, y, z).project(cam);
  const u = (q.x + 1) / 2 * fw, v = (1 - q.y) / 2 * fh;
  const ox = u - w * (spec.kind === 'soldier' ? spec.anchor ?? 0.5 : 0.5), oy = v - h * (spec.kind === 'soldier' ? 0.78 : 0.68);
  cam.setViewOffset(fw, fh, ox, oy, w, h);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  const ax = u - ox, ay = v - oy;
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  const grab = (col) => { R.scene.background = new THREE.Color(col, col, col); api.render(); g2.clearRect(0, 0, w, h); g2.drawImage(r.domElement, 0, 0); return g2.getImageData(0, 0, w, h); };
  const frames = [];
  try {
    root.visible = false;                                            // the empty window over black and white: per px
    const A0 = grab(0), B0 = grab(1);
    root.visible = true;
    for (const ps of spec.poses) {
      root.rotation.set(0, ps.heading, 0);
      root.updateMatrixWorld(true);
      if (spec.kind === 'soldier') {
        actor.setAnim(ps.clip, { restart: true, loop: ps.loop !== false, fade: 0, transition: false });
        actor.update(0);
        let tt = ps.t || 0;
        if (ps.phase != null) {
          const act = (actor.inner?.mixer?._actions || []).find((x) => x.isRunning() && x.getClip().name !== 'idle') || null;
          tt = ps.phase * (act?.getClip().duration || 1);
        }
        for (let k = 0, n = Math.round(tt * 60); k < n; k++) actor.update(1 / 60);
        actor.update(0);
      } else {
        actor.update(0.0001, { speed: 0, turretYaw: ps.turret || 0, gunPitch: ps.gunPitch || 0 });
        if (ps.travel) actor.update(1, { speed: ps.travel, turretYaw: ps.turret || 0, gunPitch: ps.gunPitch || 0 });
        actor.update(0.0001, { speed: 0, turretYaw: ps.turret || 0, gunPitch: ps.gunPitch || 0 });
        if (ps.recoil) actor.posePart('gun', null, new THREE.Vector3(0, 0, -ps.recoil));
      }
      root.updateMatrixWorld(true);
      // where his gun's muzzle and his right hand are in the window (the menu's flashes, a grenade's release)
      const at = {};
      if (spec.kind === 'soldier') {
        for (const [n, o] of Object.entries({ muzzle: muzzleOf(actor), hand: actor.getSocket('hand_r') })) {
          if (!o) continue;
          const p = (o.isVector3 ? o.clone() : o.getWorldPosition(new THREE.Vector3())).project(cam);
          at[n] = [+((p.x + 1) / 2 * w).toFixed(1), +((1 - p.y) / 2 * h).toFixed(1)];
        }
      }
      const A = grab(0), B = grab(1), out = g2.createImageData(w, h);
      for (let i = 0; i < w * h * 4; i += 4) {
        let al = 0;
        for (let c = 0; c < 3; c++) al += 1 - (B.data[i + c] - A.data[i + c]) / Math.max(1, B0.data[i + c] - A0.data[i + c]);
        al = Math.max(0, Math.min(1, al / 3));
        out.data[i + 3] = Math.round(al * 255);
        for (let c = 0; c < 3; c++) out.data[i + c] = al > 0.004 ? Math.max(0, Math.min(255, (A.data[i + c] - (1 - al) * A0.data[i + c]) / al)) : 0;
      }
      g2.putImageData(out, 0, 0);
      frames.push({ key: ps.key, png: c2.toDataURL('image/png'), ax, ay, ...at });
      if (spec.kind !== 'soldier' && ps.recoil) actor.posePart('gun', null, null);
    }
  } finally {
    for (const o of hid) o.visible = true;
    for (const ps of off) ps.enabled = true;
    R.scene.background = bg0;
    root.removeFromParent();
    if (catcher) { catcher.removeFromParent(); catcher.geometry.dispose(); catcher.material.dispose(); }
    actor.dispose?.();
    S.pose?.();
  }
  const pt = new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse);
  return { pxm: 1080 / (2 * -pt.z * Math.tan((15 * Math.PI) / 180)), frames };
}
