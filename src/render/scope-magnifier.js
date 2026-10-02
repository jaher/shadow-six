/**
 * Sniper-scope magnifier (design-spec §5.3 "scope (88 px, 2× magnifier)").
 *
 * While the sniper rifle's 88-ref-px scope cursor is up, the glass of the scope shows a live 2× view of the world
 * under the cursor:
 *  - a second OrthographicCamera copies the game camera (same yaw, pitch, position, near/far, layers), with its
 *    frustum cut down to the square around the cursor's ray (so it is centred on the cursor's ground point at
 *    every zoom level, yaw option and multi-view layout) and half the extent → exactly 2× the main view;
 *  - it renders the world into a small HDR target sized to the glass at HUD scale × canvas pixel ratio (×1.5
 *    supersampling, capped; plus a 50% margin for reuse), then the water (the water system's own WaterPass, re-run
 *    against the lens target), late FX, ground decals, and — when the shot is valid — the target enemy again with an
 *    additive rim matcap;
 *  - a composite quad draws it into the main canvas inside the glass circle, after the frame: tone mapping and
 *    sRGB like the output pass, a slight cool glass tint, chromatic fringe and lens vignette toward the rim, a
 *    soft glint, a dimmed, desaturated glass when there is no shot, and a subtle breathing sway of the image (off with reduced
 *    motion). The ring, reticle and range read-out are DOM on top (ui/cursor.js).
 * Cost (design-spec §5.3 budget: < 0.5 ms CPU a frame, amortised):
 *  - the shadow maps and world matrices are reused from the main frame (no shadow re-render, no scene matrix walk),
 *    and skinned men are not re-skinned (see _hookScene);
 *  - whole top-level subtrees (men, vehicles, buildings) outside the window are hidden for the lens draws, from
 *    bounds cached in each child's own frame, as are unculled skinned men elsewhere and empty instanced pools, so
 *    three walks and draws only the ~20 objects in a ~2 m window; the water pass is skipped with no water in it;
 *  - one lens render still costs ~0.3–1.2 ms CPU (a few dozen draws; the high end on a heavily loaded machine), so
 *    when its smoothed cost is over 80% of the budget the image (rendered with a margin) is reused for up to
 *    `maxReuse` frames, shifted under the cursor in the composite, keeping the amortised cost under the budget.
 *    Zoom, rotation, a new target or a move past the margin always render afresh.
 * Nothing is rendered or allocated until the scope first appears.
 * @module render/scope-magnifier
 */

import * as THREE from 'three';
import { xrayMatcap } from '../engine/post-passes.js';

/** Tunables. Sizes are BEL reference px (the cursor art is 88 × 88, its glass r ≈ 36). */
export const SCOPE = {
  magnification: 2,
  glassRadiusRef: 36, // the ring art covers r > 35.5 ref px; the glass quad runs under the ring's inner edge
  supersample: 1.5,
  maxTarget: 512, // RT side cap (4K at uiScale 3 and DPR 2 would want ~650)
  swayRef: 1.1, // breathing sway amplitude (ref px of the magnified image)
  breathPeriod: 4.2, // s
  highlight: { fill: 0x000000, rim: 0xd6d1c4, opacity: 0.16 }, // additive, neutral: a faint pale rim only (no tint)
  noShot: { dim: 0.72, desat: 0.55 }, // no shot: the glass darkens and greys a little (the reticle stays dark)
  fxLayer: 11,
  margin: 0.5, // the lens target covers the glass window + 50% (25% each side), so a reused image can follow the cursor
  budgetMs: 0.5, // lens CPU a frame, amortised: when a render costs more than 80% of it, the image is reused (shifted
  // under the cursor) for up to `maxReuse` frames in a row, so the glass refreshes at ≥ 1/4 of the frame rate
  maxReuse: 3,
};

/**
 * Lens camera frustum (main-camera view space, metres) for a cursor at view-local CSS px (vx, vy) in a view of
 * size w × h at `ppm` CSS px per metre: a square of half side (glass radius / magnification) around the
 * cursor's ray. `sway` = {x, y} CSS px offset of the magnified image.
 * @returns {{left:number, right:number, top:number, bottom:number, half:number}}
 */
export function lensFrustum(vx, vy, w, h, ppm, glassRadiusPx, mag = SCOPE.magnification, sway = null) {
  const u = (vx - w / 2 + (sway?.x || 0)) / ppm;
  const v = -(vy - h / 2 + (sway?.y || 0)) / ppm;
  const half = glassRadiusPx / mag / ppm;
  return { left: u - half, right: u + half, top: v + half, bottom: v - half, half };
}

/** Breathing sway at time t (s): a slow figure-eight, CSS px of amplitude `amp`. */
export function breathSway(t, amp) {
  const w = (Math.PI * 2) / SCOPE.breathPeriod;
  return { x: amp * 0.55 * Math.sin(w * t * 0.5 + 0.7), y: amp * Math.sin(w * t) };
}

/** Render-target side (device px) for a glass of radius `glassRadiusPx` CSS px at canvas pixel ratio `pr`. */
export function lensTargetSize(glassRadiusPx, pr = 1, ss = SCOPE.supersample, max = SCOPE.maxTarget, margin = SCOPE.margin) {
  return Math.max(16, Math.ceil(Math.min(max, Math.ceil(glassRadiusPx * 2 * pr * ss)) * (1 + margin)));
}

/**
 * How many frames in a row may reuse the lens image (shifted under the cursor) after a render that costs `renderMs`,
 * when a reusing frame costs `reuseMs` (the composite), so the amortised CPU a frame, (render + n·reuse) / (n + 1),
 * stays within `aim` = 80% of the budget. 0 = render every frame (a lens that is already cheap enough).
 */
export function lensReuseFrames(renderMs, reuseMs = 0, budget = SCOPE.budgetMs, max = SCOPE.maxReuse) {
  const aim = budget * 0.8;
  if (!(renderMs > aim)) return 0;
  if (!(reuseMs < aim)) return max;
  return Math.min(max, Math.ceil((renderMs - aim) / (aim - reuseMs) - 1e-9));
}

/** Glass radius in CSS px of the scope cursor at HUD scale `scale` (the 88-px art is drawn at 88 × scale). */
export function glassRadius(scale = 1) {
  return SCOPE.glassRadiusRef * (scale || 1);
}

/**
 * Point `cam` (an OrthographicCamera) at the lens window: the main camera's pose, layers and depth range, the
 * frustum cut to the magnified square around client px (x, y) of `view` (a CameraController).
 * @returns {THREE.OrthographicCamera} cam
 */
export function aimLensCamera(cam, main, view, x, y, radius, sway = null) {
  const o = view._origin ? view._origin() : { left: 0, top: 0 };
  const f = lensFrustum(x - o.left, y - o.top, view.width, view.height, view.pxPerMeter(), radius, SCOPE.magnification, sway);
  cam.position.copy(main.position);
  cam.quaternion.copy(main.quaternion);
  cam.left = f.left; cam.right = f.right; cam.top = f.top; cam.bottom = f.bottom;
  cam.near = main.near; cam.far = main.far; cam.zoom = 1;
  cam.layers.mask = main.layers.mask;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

const COMPOSITE_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMPOSITE_FS = /* glsl */ `
#define NS_DIM ${SCOPE.noShot.dim.toFixed(3)}
#define NS_DESAT ${SCOPE.noShot.desat.toFixed(3)}
uniform sampler2D tLens; uniform float uBad, uPx, uK; uniform vec2 uC; // uC/uK: the glass window inside the (wider) lens image
varying vec2 vUv;
void main(){
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float aa = 2.0 / max(uPx, 8.0);
  float a = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (a <= 0.0) discard;
  // radial chromatic fringe toward the rim (glass dispersion)
  vec2 ca = d * 0.012 * r * r * uK, uv = uC + d * uK;
  vec3 col = vec3(texture2D(tLens, uv + ca).r, texture2D(tLens, uv).g, texture2D(tLens, uv - ca).b);
  col *= vec3(0.93, 0.99, 1.03);                             // cool glass tint
  col *= mix(1.0, 0.38, smoothstep(0.52, 1.0, r));           // lens vignette
  // no shot: a slightly dimmed, desaturated glass (neutral, no colour cast)
  col = mix(col, mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), NS_DESAT) * NS_DIM, uBad);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // glint after tone mapping (display space): a soft highlight at the upper left of the glass
  float g = smoothstep(0.34, 0.0, length(vUv - vec2(0.3, 0.74)));
  gl_FragColor.rgb += vec3(0.05, 0.06, 0.07) * g;
}`;

const _vp = new THREE.Vector4();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sph = new THREE.Sphere();
const _hipsOf = new WeakMap();
const _c = new THREE.Vector3();
const _uv = new THREE.Vector2();

/** Grow an orthographic camera's frustum by `k` about its centre. */
function widen(cam, k) {
  const cx = (cam.left + cam.right) / 2, cy = (cam.top + cam.bottom) / 2;
  const hx = ((cam.right - cam.left) / 2) * k, hy = ((cam.top - cam.bottom) / 2) * k;
  cam.left = cx - hx; cam.right = cx + hx; cam.top = cy + hy; cam.bottom = cy - hy;
  cam.updateProjectionMatrix();
  return cam;
}

/** A skinned mesh's hips/pelvis bone (else its first bone): where the body is, even when the rig is ragdolled. */
function hipsBone(o) {
  let b = _hipsOf.get(o);
  if (b === undefined) {
    const bones = o.skeleton?.bones || [];
    b = bones.find((x) => /hip|pelvis/i.test(x.name)) || bones[0] || null;
    _hipsOf.set(o, b);
  }
  return b;
}

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _bx = new THREE.Box3();

/**
 * A top-level scene child's bounds in its own frame, so a lens frame can skip the whole subtree (a man is ~100
 * nodes, mostly bones, that three would walk and frustum-test one by one): {c: local centre, r, pad}, or null when
 * the subtree cannot be bounded that way (lights: hiding one would change the light set and recompile programs;
 * points / sprites / lines: shader-placed particles).
 */
function rootBounds(o) {
  let ok = true, skinned = false;
  const box = new THREE.Box3();
  _inv.copy(o.matrixWorld).invert();
  o.traverse((m) => {
    if (!ok) return;
    if (m.isLight || m.isPoints || m.isSprite || m.isLine) { ok = false; return; }
    if (!m.isMesh || !m.geometry) return;
    if (m.isSkinnedMesh) skinned = true;
    let bb;
    if (m.isInstancedMesh) { if (!m.count) return; if (!m.boundingBox) m.computeBoundingBox(); bb = m.boundingBox; } // (static dressing: cached)
    else { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb = m.geometry.boundingBox; }
    if (!bb || bb.isEmpty()) return;
    box.union(_bx.copy(bb).applyMatrix4(_rel.multiplyMatrices(_inv, m.matrixWorld)));
  });
  if (!ok || box.isEmpty()) return null;
  // posed / ragdolled men reach past their bind-pose box; doors and hatches swing a little
  return { c: box.getCenter(new THREE.Vector3()), r: box.getSize(_c).length() / 2, pad: skinned ? 1.5 : 0.5 };
}

/** Any visible water body's (padded: waves, shore foam) bounds in `frustum`? */
function waterInView(waterScene, frustum) {
  for (const m of waterScene?.children || []) {
    if (!m.visible || !m.geometry) continue;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    _sph.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
    _sph.radius += 1;
    if (frustum.intersectsSphere(_sph)) return true;
  }
  return false;
}

/**
 * Can this frustumCulled = false object be skipped by the lens? Skinned men (their posed bounds are unknown, so the
 * main frame never culls them): a padded bind-pose sphere around both the mesh origin and the hips misses the lens
 * frustum. Instanced meshes with no live instance (birds, fish, debris pools). Anything else is drawn.
 */
function lensSkips(o, frustum) {
  if (o.isInstancedMesh) return o.count === 0;
  if (!o.isSkinnedMesh || o.children.length) return false;
  const g = o.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _sph.radius = g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() + 1;
  _sph.center.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
  if (frustum.intersectsSphere(_sph)) return false;
  const h = hipsBone(o);
  if (!h) return true;
  _sph.center.setFromMatrixPosition(h.matrixWorld);
  return !frustum.intersectsSphere(_sph);
}

/** Anything on the late-FX layer this frame? The main frame's LateFxPass scan (its 30-frame `_has` + its live
 *  roots), so the lens skips a whole extra scene walk when there is no smoke / splash / flash on the map. */
function lateFxVisible(fx, layer) {
  if (!fx || fx._has) return true;
  let has = false;
  for (const root of fx.roots || []) {
    root.traverseVisible((o) => { if (!has && o.layers.isEnabled(layer) && (o.isMesh || o.isPoints || o.isSprite || o.isLine)) has = true; });
    if (has) break;
  }
  return has;
}

export class ScopeMagnifier {
  /** @param {import('../engine/renderer.js').Renderer} R engine renderer */
  constructor(R) {
    this.R = R;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
    this.camera.name = 'scopeCamera';
    this.rtA = null; // world colour + depth texture (the water samples them)
    this.rtB = null; // world + water (+ FX, decals, highlight) when the map has water
    this.size = 0;
    this.quad = null;
    this.hlMat = null;
    this.waterPass = null;
    this._waterSys = null;
    /** Last frame: {ms, size, drawn, target, reusedNow, renderMs (last full render)}, counters (tests / debug overlay). */
    this.stats = { ms: 0, size: 0, drawn: false, target: null, frames: 0, calls: 0, renders: 0, reused: 0, reusedNow: false, renderMs: 0 };
    /** The image in the lens target: what it was rendered for (reuse check, see _reusable). */
    this._img = { ok: false, scene: null, target: null, span: 0, q: new THREE.Quaternion(), vp: new THREE.Matrix4() };
    this._age = 0;
    this._ema = 0; // smoothed CPU ms of a lens render
    this._emaReuse = 0; // … and of a frame that reuses the image
    this._hooked = null; // scene whose onBeforeRender records the main frame number (_hookScene)
    this._prevOBR = null;
    this._sceneFrame = null;
    this._pin = null;
    this._fMax = 0;
    this._nfc = []; // the scene's frustumCulled = false skinned / instanced meshes (rescanned every 120 lens renders)
    this._nfcScene = null;
    this._nfcTick = 0; // lens renders
    this._hid = [];
    this._roots = new WeakMap(); // top-level child → {t, s: rootBounds}
  }

  /**
   * Can this frame reuse the lens image (shifted under the cursor) instead of rendering? Only while a render costs
   * more than the budget (lensReuseFrames of the smoothed render time), for the same scene, target, zoom and camera
   * rotation, and while the glass window (the camera as aimed now) still lies inside the image's margin.
   * @returns {THREE.Vector2|null} the window centre in the image's uv
   */
  _reusable(target, scene) {
    const img = this._img, cam = this.camera;
    if (!img.ok || img.scene !== scene || this._age >= lensReuseFrames(this._ema, this._emaReuse)) return null;
    if ((target?.id ?? null) !== img.target) return null;
    if (Math.abs(cam.right - cam.left - img.span) > img.span * 1e-4) return null; // zoomed
    if (Math.abs(cam.quaternion.dot(img.q)) < 1 - 1e-7) return null; // rotated
    // ortho camera, same rotation and scale: the new window is the old image shifted
    _c.set((cam.left + cam.right) / 2, (cam.top + cam.bottom) / 2, -cam.near).applyMatrix4(cam.matrixWorld).applyMatrix4(img.vp);
    const x = _c.x * 0.5 + 0.5, y = _c.y * 0.5 + 0.5, lim = (0.5 * SCOPE.margin) / (1 + SCOPE.margin) - 0.01;
    if (!(Math.abs(x - 0.5) <= lim && Math.abs(y - 0.5) <= lim)) return null;
    return _uv.set(x, y);
  }

  /** Hide, for the lens draws only, the unculled objects that cannot be in its window (see lensSkips). */
  _hideOutside(scene) {
    const now = ++this._nfcTick;
    if (this._nfcScene !== scene || now % 120 === 1) {
      this._nfc.length = 0;
      scene.traverse((o) => { if (!o.frustumCulled && (o.isSkinnedMesh || o.isInstancedMesh)) this._nfc.push(o); });
      this._nfcScene = scene;
    }
    const cam = this.camera;
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    // whole top-level subtrees (men, vehicles, buildings) outside the window: bounds cached in the child's own frame
    // (so they follow it as it moves), one stale entry refreshed per lens render
    const B = this._roots;
    let refreshed = false;
    for (const o of scene.children) {
      if (!o.visible || !o.children.length || o.isLight) continue;
      let b = B.get(o);
      // a child added or removed (effects spawned under a root): now; men re-pose: often; static dressing: rarely
      if (b === undefined || b.n !== o.children.length || (!refreshed && now - b.t > (b.s?.pad > 1 ? 60 : 600))) {
        b = { t: now, n: o.children.length, s: rootBounds(o) };
        B.set(o, b);
        refreshed = true;
      }
      if (!b.s) continue;
      _sph.center.copy(b.s.c).applyMatrix4(o.matrixWorld);
      _sph.radius = b.s.r * o.matrixWorld.getMaxScaleOnAxis() + b.s.pad;
      if (!_frustum.intersectsSphere(_sph)) { o.visible = false; this._hid.push(o); }
    }
    for (const o of this._nfc) if (o.visible && lensSkips(o, _frustum)) { o.visible = false; this._hid.push(o); }
  }

  _unhide() {
    for (const o of this._hid) o.visible = true;
    this._hid.length = 0;
  }

  _ensure(size) {
    if (!this.quad) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: COMPOSITE_VS, fragmentShader: COMPOSITE_FS, transparent: true, depthTest: false, depthWrite: false,
        toneMapped: true, uniforms: { tLens: { value: null }, uBad: { value: 0 }, uPx: { value: 100 }, uK: { value: 1 / (1 + SCOPE.margin) }, uC: { value: new THREE.Vector2(0.5, 0.5) } },
      });
      mat.name = 'scope-lens';
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      this.quad.frustumCulled = false;
      this.quadScene = new THREE.Scene();
      this.quadScene.add(this.quad);
      this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const H = SCOPE.highlight;
      this.hlMat = new THREE.MeshMatcapMaterial({
        matcap: xrayMatcap(H.fill, H.rim, { a0: 1, edge: 0.72 }), transparent: true, opacity: H.opacity, blending: THREE.AdditiveBlending,
        depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, fog: false,
      });
      this.hlMat.name = 'scope-highlight';
    }
    if (size === this.size) return;
    this._img.ok = false; // a new target: nothing to reuse
    this.size = size;
    const mk = (depthTexture) => {
      const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true });
      if (depthTexture) { rt.depthTexture = new THREE.DepthTexture(size, size); rt.depthTexture.type = THREE.UnsignedIntType; }
      rt.texture.name = 'scope-lens';
      return rt;
    };
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.rtA = mk(true);
    this.rtB = mk(false);
  }

  /** The water system's WaterPass re-run against the lens targets (same shaders, uniforms re-pointed). */
  _water(sys) {
    if (!sys || !sys.pass || !sys.waterScene?.children.length) return null;
    if (this._waterSys !== sys) {
      this.waterPass?.dispose?.();
      this.waterPass = null;
      this._waterSys = sys;
      try { this.waterPass = new sys.pass.constructor(sys, null); } catch { this.waterPass = null; }
    }
    return this.waterPass;
  }

  /**
   * Draw the lens for this frame (call right after the main frame, before the canvas is presented).
   * @param {{x:number, y:number, radius:number, bad?:boolean, target?:any, time?:number, sway?:boolean}|null} s
   *   client-px cursor, glass radius (CSS px), no-shot state, entity to highlight (valid shots only)
   * @param {{view:any, camera?:THREE.Camera, water?:any}} ctx view = the CameraController under the cursor,
   *   camera = the camera the frame was drawn with (shake included; default view.camera), water = water system
   * @returns {boolean} drawn
   */
  frame(s, ctx) {
    const st = this.stats;
    st.drawn = false;
    st.target = null;
    const R = this.R, r = R?.renderer, view = ctx?.view;
    if (!s || !r || !view || !R.scene) return false;
    if (typeof view.contains === 'function' && !view.contains(s.x, s.y)) return false;
    const t0 = performance.now();
    const pr = r.getPixelRatio();
    const radius = Math.max(4, s.radius);
    this._ensure(lensTargetSize(radius, pr));
    this._hookScene(R.scene);
    const sway = s.sway ? breathSway(s.time || 0, SCOPE.swayRef * (radius / SCOPE.glassRadiusRef)) : null;
    const cam = aimLensCamera(this.camera, ctx.camera || view.camera, view, s.x, s.y, radius, sway);
    const target = !s.bad ? s.target : null;
    const u = this.quad.material.uniforms;
    const uv = this._reusable(target, R.scene);
    st.reusedNow = !!uv;
    if (uv) {
      u.uC.value.copy(uv);
      this._age++;
      st.reused++;
      st.target = this._img.target;
    } else {
      widen(cam, 1 + SCOPE.margin); // the image covers the glass window and a margin around it
      const t1 = performance.now();
      st.calls = this._renderWorld(r, ctx.water, target);
      const ms = performance.now() - t1;
      this._ema = this._ema ? this._ema * 0.75 + ms * 0.25 : ms;
      const img = this._img;
      img.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      widen(cam, 1 / (1 + SCOPE.margin)); // back to the glass window (what `camera` reports)
      img.ok = true; img.scene = R.scene; img.target = st.target; img.span = cam.right - cam.left;
      img.q.copy(cam.quaternion);
      u.uC.value.set(0.5, 0.5);
      this._age = 0;
      st.renders++;
      st.renderMs = ms;
    }
    this._composite(r, s, radius);
    st.ms = performance.now() - t0;
    if (uv) this._emaReuse = this._emaReuse ? this._emaReuse * 0.75 + st.ms * 0.25 : st.ms;
    st.size = this.size;
    st.drawn = true;
    st.frames++;
    return true;
  }

  /**
   * three.js runs its "once per frame" work (skeleton.update + bone-texture upload, instance attribute checks) once
   * per render() call, keyed on `info.render.frame`. The lens draws the same posed men right after the main frame,
   * so its renders reuse the frame number of the last main render of the scene (recorded by a scene.onBeforeRender
   * hook) and nothing is re-skinned or re-uploaded. The counter is put back past every value used, so it only grows.
   */
  _hookScene(scene) {
    if (this._hooked === scene) return;
    this._unhook();
    const self = this, prev = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, sc, camera, rt) {
      if (camera !== self.camera && (camera.layers.mask & 1)) self._sceneFrame = renderer.info.render.frame + 1; // frame++ follows
      return prev.call(this, renderer, sc, camera, rt);
    };
    this._hooked = scene;
    this._prevOBR = prev;
  }

  _unhook() {
    if (this._hooked) this._hooked.onBeforeRender = this._prevOBR;
    this._hooked = null;
  }

  /** r.render at the pinned frame number (see _hookScene). */
  _draw(r, scene, cam) {
    const info = r.info.render;
    this._fMax = Math.max(this._fMax, info.frame);
    if (this._pin != null) info.frame = this._pin - 1;
    r.render(scene, cam);
    this._fMax = Math.max(this._fMax, info.frame);
  }

  /** World (+ water, late FX, decals, target highlight) into the lens target. @returns {number} draw calls */
  _renderWorld(r, water, target) {
    const R = this.R, scene = R.scene, cam = this.camera;
    const calls0 = r.info.render.calls;
    const prev = {
      rt: r.getRenderTarget(), auto: r.autoClear, shadow: r.shadowMap.autoUpdate,
      mw: scene.matrixWorldAutoUpdate, dmw: R.decalScene?.matrixWorldAutoUpdate, mask: cam.layers.mask,
    };
    // the main frame already drew the shadow maps and walked the world matrices this frame: reuse both
    r.shadowMap.autoUpdate = false;
    scene.matrixWorldAutoUpdate = false;
    if (R.decalScene) R.decalScene.matrixWorldAutoUpdate = false;
    const info = r.info.render, f0 = info.frame;
    this._pin = this._sceneFrame != null && this._sceneFrame <= f0 ? this._sceneFrame : null;
    this._fMax = f0;
    try {
      r.autoClear = true;
      r.setRenderTarget(this.rtA);
      this._hideOutside(scene);
      this._draw(r, scene, cam);
      let out = this.rtA;
      const wp = this._water(water);
      if (wp && water.frames > 0 && waterInView(water.waterScene, _frustum)) { // no water in the window: no water pass
        const sc = water.camera;
        water.camera = cam; // _frameUniforms reads the lens camera's matrices (restored by the next main frame's pass)
        try { wp.render(r, this.rtB, this.rtA); out = this.rtB; } finally { water.camera = sc; this._fMax = Math.max(this._fMax, info.frame); }
      }
      r.autoClear = false;
      r.setRenderTarget(out);
      const fxLayer = water?.opts?.fxLayer ?? water?.fxPass?.layer ?? SCOPE.fxLayer;
      if (wp && lateFxVisible(water.fxPass, fxLayer)) { // late FX (smoke, splashes, flashes) live on their own layer when the map has water
        cam.layers.set(fxLayer);
        const bg = scene.background;
        scene.background = null;
        this._draw(r, scene, cam);
        scene.background = bg;
        cam.layers.mask = prev.mask;
      }
      if (R.decalScene?.children.length) {
        let any = false; // empty decal pools (instanced, no live decal) cost a full program setup each
        for (const o of R.decalScene.children) {
          if (o.visible && o.isInstancedMesh && o.count === 0) { o.visible = false; this._hid.push(o); } else if (o.visible) any = true;
        }
        if (any) this._draw(r, R.decalScene, cam);
      }
      if (target?.object3d) this._highlight(r, target.object3d);
      this.out = out;
      this.stats.target = target?.id ?? null;
    } finally {
      this._unhide();
      info.frame = Math.max(this._fMax, info.frame); // monotonic: past every frame number the lens used
      this._pin = null;
      cam.layers.mask = prev.mask;
      r.setRenderTarget(prev.rt);
      r.autoClear = prev.auto;
      r.shadowMap.autoUpdate = prev.shadow;
      scene.matrixWorldAutoUpdate = prev.mw;
      if (R.decalScene) R.decalScene.matrixWorldAutoUpdate = prev.dmw;
    }
    return r.info.render.calls - calls0;
  }

  /**
   * The valid target again over itself (depth-equal), additive rim matcap: he glows in the glass. Only his own
   * subtree is drawn (materials swapped for the pass), not the whole scene with a layer filter.
   */
  _highlight(r, root) {
    const meshes = this._hl || (this._hl = []);
    meshes.length = 0;
    root.traverseVisible((o) => { if (o.isMesh && o.material) { meshes.push(o, o.material); o.material = this.hlMat; } });
    if (!meshes.length) return;
    const mw = root.matrixWorldAutoUpdate;
    root.matrixWorldAutoUpdate = false; // world matrices are this frame's already
    try { this._draw(r, root, this.camera); } finally {
      root.matrixWorldAutoUpdate = mw;
      for (let i = 0; i < meshes.length; i += 2) meshes[i].material = meshes[i + 1];
      meshes.length = 0;
    }
  }

  /** The lens quad into the canvas at the cursor (viewport = the glass square, circle mask in the shader). */
  _composite(r, s, radius) {
    const u = this.quad.material.uniforms;
    u.tLens.value = this.out.texture;
    u.uBad.value = s.bad ? 1 : 0;
    u.uPx.value = radius * 2 * r.getPixelRatio();
    const c = r.domElement.getBoundingClientRect();
    const canvasH = c.height || r.domElement.clientHeight;
    const x = s.x - c.left - radius, y = canvasH - (s.y - c.top) - radius; // GL viewport origin: bottom-left
    r.getViewport(_vp);
    const auto = r.autoClear, scissor = r.getScissorTest();
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.autoClear = false;
    r.setViewport(x, y, radius * 2, radius * 2);
    try { r.render(this.quadScene, this.quadCam); } finally {
      r.setViewport(_vp);
      r.autoClear = auto;
      r.setScissorTest(scissor);
    }
  }

  dispose() {
    this._unhook();
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.waterPass?.dispose?.();
    if (this.quad) { this.quad.geometry.dispose(); this.quad.material.dispose(); }
    this.hlMat?.matcap?.dispose();
    this.hlMat?.dispose();
    this.rtA = this.rtB = this.quad = this.hlMat = this.waterPass = null;
    this.size = 0;
  }
}
