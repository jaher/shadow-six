/**
 * RippleSim — interactive GPU heightfield (linear wave equation, (h, v) form, fixed 60 Hz steps)
 * in a square world window that follows the camera (texel-snapped scrolling, contents shifted).
 *   texture rgba = (height m, vertical velocity, foam/turbulence 0..1, unused)
 * disturb(x,z,strength,radius): strength in metres of displacement (negative = push down, e.g. a
 * body falling in); foam is injected proportionally. Wave speed `speed` (m/s) sets the coupling
 * k = 4 c^2 dt^2 / dx^2 (clamped for stability).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const MAX_DROPS = 24;
const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const STEP_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D src; uniform vec2 shift; uniform float texel, k, damp, foamDecay;
uniform vec4 drops[${MAX_DROPS}]; uniform int nDrops; uniform vec4 area; // area: minX, minZ, size, _
uniform sampler2D envTex; uniform float envOn, speed, stepDt; // env: r = water depth (m, <=0 dry/solid), gb = current (m/s)
vec4 S(vec2 uv){ return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture2D(src, uv); }
void main(){
  vec4 env = envOn > 0.5 ? texture2D(envTex, vUv) : vec4(10.0, 0.0, 0.0, 0.0);
  // ripples drift with the current (semi-Lagrangian back-trace; W-B graft)
  vec2 uv = vUv + shift - env.gb*stepDt/area.z;
  vec4 c = S(uv);
  // walls: banks, piers, rocks and hulls in the bed capture reflect ripples (h = 0 on dry cells)
  if (env.r <= 0.03) { gl_FragColor = vec4(0.0, 0.0, c.b*0.9, 1.0); return; }
  float avg = 0.25*(S(uv+vec2(texel,0.)).r + S(uv-vec2(texel,0.)).r + S(uv+vec2(0.,texel)).r + S(uv-vec2(0.,texel)).r);
  // shallow water slows the waves: c = min(c_deep, sqrt(g*d))
  float cl = min(speed, sqrt(9.81*env.r));
  c.g += (avg - c.r)*k*(cl*cl)/(speed*speed);
  c.g *= damp;
  c.r += c.g;
  // absorbing border (no reflections from the moving window edge)
  vec2 e = min(vUv, 1.0 - vUv);
  float border = smoothstep(0.0, 0.06, min(e.x, e.y));
  c.rg *= mix(0.85, 1.0, border);
  // foam: decays, spreads a little, is fed by strong velocity (breaking at the wake crest)
  float fAvg = 0.25*(S(uv+vec2(texel,0.)).b + S(uv-vec2(texel,0.)).b + S(uv+vec2(0.,texel)).b + S(uv-vec2(0.,texel)).b);
  c.b = mix(c.b, fAvg, 0.25)*foamDecay + clamp(abs(c.g)*4.0 - 0.02, 0.0, 0.025);
  vec2 world = area.xy + vUv*area.z;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= nDrops) break;
    vec4 d = drops[i];
    float r = length(world - d.xy)/d.w;
    if (r < 1.0) { float b = 0.5 + 0.5*cos(r*3.14159265); float h = sign(d.z)*fract(abs(d.z)); float fo = floor(abs(d.z))/100.0; c.r += h*b; c.b = min(1.0, c.b + (abs(h)*1.5 + fo*0.5)*b); }
  }
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

export class RippleSim {
  /** @param {THREE.WebGLRenderer} renderer @param {{resolution?:number, size?:number, speed?:number, damping?:number}} o */
  constructor(renderer, o = {}) {
    this.renderer = renderer;
    this.res = o.resolution || 512;
    this.size = o.size || 96;
    this.speed = o.speed || 1.1;
    this.damping = o.damping ?? 0.996;
    this.origin = new THREE.Vector2(-this.size / 2, -this.size / 2);
    const mk = () => new THREE.WebGLRenderTarget(this.res, this.res, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.a = mk(); this.b = mk();
    this.drops = []; this.pending = [];
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push(new THREE.Vector4());
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: STEP_FS, depthTest: false, depthWrite: false,
      uniforms: { src: { value: null }, shift: { value: new THREE.Vector2() }, texel: { value: 1 / this.res }, k: { value: 0.05 },
        damp: { value: this.damping }, foamDecay: { value: 0.993 }, drops: { value: this.drops }, nDrops: { value: 0 },
        area: { value: new THREE.Vector4() }, envTex: { value: null }, envOn: { value: 0 }, speed: { value: this.speed }, stepDt: { value: 1 / 60 } } });
    this.quad = new FullScreenQuad(this.mat);
    this.acc = 0;
    this.texture = this.a.texture;
    this.area = new THREE.Vector4(this.origin.x, this.origin.y, this.size, 1 / this.size);
    this._clear();
  }

  /**
   * Environment of the ripple window (W-B graft): each body's bake (depth incl. captured piers/rocks as dry
   * cells, current) is splatted top-down into envRT so ripples bounce off banks/obstacles, slow down in the
   * shallows and drift with the current. bodies: [{ texture, bounds:Vector4(minX,minZ,w,h) }]
   */
  setBodies(bodies) {
    if (!this.envRT) {
      const n = Math.max(128, this.res >> 1);
      this.envRT = new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.envScene = new THREE.Scene();
      this.envCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
      this.envMat = (tex) => new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { t: { value: tex } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec4 b = texture2D(t, vUv); gl_FragColor = vec4(b.a, b.r, b.g, 1.0); }' });
    }
    for (const m of this.envScene.children.slice()) { this.envScene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const b of bodies) {
      // plane in the camera's XY = world XZ (uv.y grows with z)
      const g = new THREE.PlaneGeometry(b.bounds.z, b.bounds.w); g.translate(b.bounds.x + b.bounds.z / 2, b.bounds.y + b.bounds.w / 2, 0);
      this.envScene.add(new THREE.Mesh(g, this.envMat(b.texture)));
    }
    this.mat.uniforms.envOn.value = bodies.length ? 1 : 0;
    this.mat.uniforms.envTex.value = this.envRT.texture;
  }

  _renderEnv() {
    if (!this.envRT) return;
    const r = this.renderer, c = this.envCam;
    c.left = this.origin.x; c.right = this.origin.x + this.size; c.bottom = this.origin.y; c.top = this.origin.y + this.size;
    c.updateProjectionMatrix();
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setRenderTarget(this.envRT); r.setClearColor(new THREE.Color(-1, 0, 0), 1); r.clear(); r.render(this.envScene, c);
    r.setClearColor(cc, ca);
  }

  _clear() { const r = this.renderer, p = r.getRenderTarget(); for (const t of [this.a, this.b]) { r.setRenderTarget(t); r.setClearColor(0, 0); r.clear(); } r.setRenderTarget(p); }

  /** foam 0..1 is packed into the integer part of |strength| (strength itself is clamped to < 1 m). */
  disturb(x, z, strength = 0.1, radius = 0.6, foam = 0) {
    const h = Math.max(-0.99, Math.min(0.99, strength)), f = Math.round(Math.max(0, Math.min(1, foam)) * 100);
    const packed = (h < 0 ? -1 : 1) * (f + Math.abs(h));
    if (this.pending.length < 256) this.pending.push([x, z, packed, Math.max(radius, 1.5 * this.size / this.res)]);
  }

  /** Recentre the window on (cx, cz) world metres; contents are shifted by whole texels. */
  follow(cx, cz) {
    const cell = this.size / this.res;
    const ox = Math.round((cx - this.size / 2) / cell) * cell, oz = Math.round((cz - this.size / 2) / cell) * cell;
    const s0 = this._shift || [0, 0];
    this._shift = [s0[0] + (ox - this.origin.x) / this.size, s0[1] + (oz - this.origin.y) / this.size];
    this.origin.set(ox, oz);
  }

  update(dt) {
    const step = 1 / 60;
    this.acc = Math.min(this.acc + dt, 4 * step);
    const u = this.mat.uniforms;
    const dx = this.size / this.res;
    u.k.value = Math.min(0.9, 4 * this.speed * this.speed * step * step / (dx * dx));
    u.area.value.set(this.origin.x, this.origin.y, this.size, 0);
    const r = this.renderer, prev = r.getRenderTarget();
    u.speed.value = this.speed; u.stepDt.value = step;
    if (this.acc >= step) this._renderEnv();
    let first = true;
    while (this.acc >= step) {
      this.acc -= step;
      const s = first && this._shift ? this._shift : [0, 0];
      u.shift.value.set(s[0], s[1]);
      const n = first ? Math.min(this.pending.length, MAX_DROPS) : 0;
      for (let i = 0; i < n; i++) { const d = this.pending[i]; this.drops[i].set(d[0], d[1], d[2], d[3]); }
      u.nDrops.value = n;
      if (first) { this.pending.splice(0, n); this._shift = null; }
      first = false;
      u.src.value = this.a.texture;
      r.setRenderTarget(this.b);
      this.quad.render(r);
      [this.a, this.b] = [this.b, this.a];
    }
    r.setRenderTarget(prev);
    this.texture = this.a.texture;
    this.area.set(this.origin.x, this.origin.y, this.size, 1 / this.size);
  }

  dispose() { if (this.envRT) { this.setBodies([]); this.envRT.dispose(); } this.a.dispose(); this.b.dispose(); this.mat.dispose(); this.quad.dispose(); }
}
