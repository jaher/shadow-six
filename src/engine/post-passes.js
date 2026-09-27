/**
 * Engine post passes (realism-pipeline §3.3, design-spec §2.4):
 *  - SanitizePass: rgb = isnan||isinf ? 0 : clamp(rgb, -0.3·max(rgb), 64) (bounded wide-gamut negatives kept). Guard against NaN/Inf black frames spreading
 *    through bloom (~0.05 ms). Runs on the linear HDR buffer before bloom and tone mapping.
 *  - XRayPass: commandos hidden behind roofs/trees/walls drawn as a flat muted team-colour silhouette at 35 %
 *    (a second draw of their meshes with depthFunc GreaterDepth against the world depth). Enemies are never
 *    x-rayed. Runs in the world buffer right after the world/decal render (depth still bound). It first draws
 *    the XRAY_LAYER objects of the decal scene with their own materials (the muted selection-ring/path ghosts
 *    of render/selection.js, GreaterDepth + margin), so a hidden selected commando keeps a visible ring. Each
 *    unit's silhouette draw is wrapped in a GPU occlusion query → isHidden(root) (is he x-rayed right now?), which
 *    arms his ring ghost only while he is actually hidden.
 *  - makeLUTTexture: RGBA8 Data3DTexture for three's LUTPass (display-referred grade after OutputPass).
 * @module engine/post-passes
 */
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: { tDiffuse: { value: null }, uMax: { value: 64.0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bvec3 bad = bvec3(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b));
      if (any(bad)) c.rgb = vec3(0.0);
      float a = (isnan(c.a) || isinf(c.a)) ? 1.0 : c.a;
      // keep a bounded negative component (<= 30 % of the brightest one): wide-gamut emission (the VFX fire
      // ramp) is authored slightly outside sRGB so AgX, which works in Rec.2020, keeps it saturated
      float hi = max(max(c.r, c.g), c.b);
      gl_FragColor = vec4(clamp(c.rgb, -0.3 * max(hi, 0.0), uMax), a);
    }`,
};

/** NaN/Inf guard + HDR clamp (realism §3.3 step 5). */
export class SanitizePass extends ShaderPass {
  constructor(max = 64) {
    super(SanitizeShader);
    this.material.uniforms.uMax.value = max;
  }
}

/** Camera layer reserved for the x-ray draw (meshes of x-rayed units get it enabled). */
export const XRAY_LAYER = 7;

function chainVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Silhouettes for occluded friendly units. getTargets() → Object3D roots (the commandos' render proxies).
 * `margin` (m): parts less than this far behind the visible surface are not drawn (the unit's own limbs,
 * feet in uneven ground), implemented as a depth polygon offset toward the camera.
 * Look (art review): a dark team-green fill with a bright rim (matcap on the view-space normal), so the
 * silhouette reads on white snow roofs *and* on dark roofs / brick; a flat pale tint vanished on snow.
 */
export class XRayPass extends Pass {
  constructor(scene, camera, getTargets, { color = 0x1d3d12, rim = 0xc8ff90, opacity = 0.95, margin = 0.6 } = {}, decalScene = null) {
    super();
    this.scene = scene;
    /** Ground-decal scene whose XRAY_LAYER objects (selection ring/path ghosts) are drawn first, with their own materials. */
    this.decalScene = decalScene;
    this.camera = camera;
    this.getTargets = getTargets;
    this.margin = margin;
    this.needsSwap = false;
    this.material = new THREE.MeshMatcapMaterial({
      matcap: xrayMatcap(color, rim), transparent: true, opacity, depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
      fog: false, toneMapped: true, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -8000,
    });
    this.material.name = 'xray-silhouette';
    this.drawn = 0;
    /** root → true when some of it was drawn as a silhouette in the last resolved frame (see isHidden). */
    this.hidden = new WeakMap();
    this._pending = [];
    this._pool = [];
    this._probe = null;
    this._noQueries = false;
    this._roots = new WeakMap(); // mesh → target root
    this._hooked = new WeakSet();
  }

  render(renderer, writeBuffer, readBuffer) {
    this.drawn = 0;
    const roots = this.getTargets?.() || [];
    let n = 0;
    for (const r of roots) {
      if (!r || !chainVisible(r)) continue;
      // `userData.noXray`: rigid props on characters (weapons, kit) — a shouldered rifle held in front of the chest
      // shows as a green silhouette through its own owner in some poses
      r.traverse((o) => {
        if (!o.isMesh || o.userData.noXray) return;
        o.layers.enable(XRAY_LAYER);
        this._roots.set(o, r); // not userData: clones (character LOD/instancing) would copy / serialise it
        if (!this._hooked.has(o)) this._hookProbe(o);
      });
      n++;
    }
    const gl = (this._gl = renderer.getContext());
    this._resolveProbes(gl);
    if (!n) return;
    if (!this._noQueries) this._probe = { gl, list: [], active: null };
    // the scene lights join the x-ray layer: a light set that differs from the main pass bumps three's lights-state
    // version, and every lit material then recomputes its program parameters in the next pass (per frame, per material)
    if (!this._lightScan || ++this._lightScan > 30) {
      this._lightScan = 1;
      this.scene.traverse((o) => { if (o.isLight) o.layers.enable(XRAY_LAYER); });
    }
    const cam = this.camera;
    // margin in depth-buffer units (24-bit, linear depth for the orthographic game camera)
    const range = Math.max(1, (cam.far ?? 1000) - (cam.near ?? 0.1));
    this.material.polygonOffsetUnits = -Math.min(1e6, (this.margin / range) * 16777216 * (cam.isOrthographicCamera ? 1 : 0.02));
    const s = this.scene;
    const prevMask = cam.layers.mask, prevOverride = s.overrideMaterial, prevBg = s.background;
    const prevAuto = renderer.autoClear, prevShadow = renderer.shadowMap.autoUpdate;
    cam.layers.set(XRAY_LAYER);
    s.overrideMaterial = this.material;
    s.background = null;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    // decal ghosts first (the selection ring under a hidden commando), so his silhouette draws over them
    if (this.decalScene?.children.length) renderer.render(this.decalScene, cam);
    try {
      renderer.render(s, cam);
    } finally {
      const p = this._probe;
      if (p) {
        if (p.active) gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE); // a draw threw between the hooks
        if (p.list.length) this._pending.push(p.list);
        this._probe = null;
        while (this._pending.length > 6) for (const e of this._pending.shift()) gl.deleteQuery(e.q);
      }
    }
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.autoClear = prevAuto;
    s.background = prevBg;
    s.overrideMaterial = prevOverride;
    cam.layers.mask = prevMask;
    this.drawn = n;
  }

  /**
   * Is (part of) this unit currently drawn as an x-ray silhouette, i.e. hidden behind something by more than the
   * margin? From GPU occlusion queries on the silhouette draws (results lag a frame or two; WebGL 1: always true).
   * The selection ring's x-ray ghost is shown only then (render/selection.js), so a ring whose commando stands in
   * plain view is covered by a truck/roof in front of it like any ground decal.
   * @param {THREE.Object3D} root
   */
  isHidden(root) {
    return this._noQueries ? true : this.hidden.get(root) === true;
  }

  /** Wrap a mesh's render hooks: while the pass draws it, its silhouette draw is bracketed by an occlusion query. */
  _hookProbe(o) {
    const pass = this, before = o.onBeforeRender, after = o.onAfterRender;
    this._hooked.add(o);
    o.onBeforeRender = function (...a) {
      before.apply(this, a);
      const p = pass._probe, root = p && pass._roots.get(this);
      if (!root || p.active) return;
      const q = pass._pool.pop() || p.gl.createQuery();
      p.gl.beginQuery(p.gl.ANY_SAMPLES_PASSED_CONSERVATIVE, q);
      p.active = q;
      p.list.push({ q, root });
    };
    o.onAfterRender = function (...a) {
      const p = pass._probe;
      if (p?.active) { p.gl.endQuery(p.gl.ANY_SAMPLES_PASSED_CONSERVATIVE); p.active = null; }
      after.apply(this, a);
    };
  }

  /** Read back finished query batches (oldest first; each batch is one pass render) into `hidden`. */
  _resolveProbes(gl) {
    if (typeof gl.createQuery !== 'function') { this._noQueries = true; return; }
    const seen = new Map();
    while (this._pending.length) {
      const batch = this._pending[0];
      if (!gl.getQueryParameter(batch[batch.length - 1].q, gl.QUERY_RESULT_AVAILABLE)) break;
      this._pending.shift();
      for (const e of batch) {
        const any = !!gl.getQueryParameter(e.q, gl.QUERY_RESULT);
        seen.set(e.root, (seen.get(e.root) || false) || any);
        this._pool.push(e.q);
      }
    }
    for (const [root, v] of seen) this.hidden.set(root, v);
  }

  dispose() {
    const gl = this._gl;
    if (gl) for (const q of [...this._pending.flat().map((e) => e.q), ...this._pool]) gl.deleteQuery(q);
    this._pending = []; this._pool = [];
    this.material.matcap?.dispose();
    this.material.dispose();
  }
}

/**
 * Rim matcap for the x-ray silhouette: `fill` inside, blending to `rim` (and to full alpha) toward the
 * silhouette edge (matcap radius = view-space normal xy). Colours are sRGB hex like the config. @returns {THREE.DataTexture}
 */
export function xrayMatcap(fill, rim, { size = 64, a0 = 0.75, edge = 0.55 } = {}) {
  const d = new Uint8Array(size * size * 4);
  const f = new THREE.Color(fill), r = new THREE.Color(rim), c = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const t = Math.min(1, Math.hypot(((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1));
      const k = Math.pow(Math.max(0, (t - edge) / (1 - edge)), 1.5);
      c.copy(f).lerp(r, k).getRGB(rgb, THREE.SRGBColorSpace);
      const o = (j * size + i) * 4;
      d[o] = Math.round(rgb.r * 255); d[o + 1] = Math.round(rgb.g * 255); d[o + 2] = Math.round(rgb.b * 255);
      d[o + 3] = Math.round(255 * (a0 + (1 - a0) * k));
    }
  }
  const tex = new THREE.DataTexture(d, size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** RGBA8 lattice (red fastest) → Data3DTexture for LUTPass. */
export function makeLUTTexture(data, size) {
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
