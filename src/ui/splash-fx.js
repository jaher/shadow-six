/**
 * S03 title splash light layer: one raw WebGL2 full-screen pass over the burning Panzer IV of the plate (user:
 * "The tank on fire could be more realistic too in the main screen"): turbulent flames rising from where a
 * knocked-out tank really burns (the engine deck, the open turret and driver's hatches, the fuel pool under the
 * hull), white-hot at the root and licking up into orange and deep-red tongues bent by the wind; a black, oily smoke
 * column that billows up and leans downwind, lit orange from below; sparks riding the heat; the fire's flickering
 * light on the hull and the ground; and the volumetric searchlight beam. Premultiplied alpha composited normally:
 * the smoke covers the plate and the light is screened over both. Under the rendered hero. Half resolution, ≤ 30 fps, one still frame
 * under reduced motion.
 * No three.js here: the splash shows while the engine is still loading. Anchored to the plate through splash-plate.js,
 * recomputed every frame from the stage's size (folds, rotations, resizes), so the fire burns on the tank on every
 * form factor.
 * @module ui/splash-fx
 */

import { plateRect, plateToStage, plateUniform, TANK_BOX } from './splash-plate.js';

const VS = `#version 300 es
in vec2 p; out vec2 vuv; void main() { vuv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vuv; out vec4 o;
uniform float t; uniform vec2 res;
uniform vec4 plate;    // the plate's rect in this canvas' uv (splash-plate.js plateUniform): origin, size
uniform vec4 src[4];   // flame sources: x, y (the plate's '106 %' uv), width (in its heights), strength
uniform vec4 smoke;    // smoke column: base x, y, base width, lean
uniform vec4 glow;     // the fire's light on the hull and the ground: centre x, y, radii (screen heights)
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.07 + 17.1; a *= 0.5; } return s; }
// blackbody-ish: deep red tips -> orange -> yellow -> white-hot core
vec3 fireRamp(float k) {
  return clamp(vec3(1.6 * k, 1.45 * k * k * k, 1.3 * pow(k, 6.0)) * vec3(1.0, 0.82, 0.62), 0.0, 1.4);
}
void main() {
  // the stage's uv onto the plate, then into the 16:9 '106 %' uv the anchors below are measured in: the fire stays on
  // the tank whatever the screen's shape (the plate is cover-fitted and its crop slides on narrow screens)
  vec2 uv = (vuv - plate.xy) / plate.zw * 1.06 - 0.03;
  float asp = 16.0 / 9.0;
  vec3 add = vec3(0.0);              // light: added to the plate (alpha 0)
  float flick = 0.8 + 0.2 * n(vec2(t * 9.0, 3.1)) + 0.1 * n(vec2(t * 23.0, 7.7));
  // ---- the black, oily smoke column: rolling up from over the fires, leaning downwind and spreading; only its
  // underside, just over the flames, catches the firelight
  vec4 sm = vec4(0.0);
  {
    vec2 q = vec2((uv.x - smoke.x) * asp, uv.y - smoke.y);
    float hh = max(q.y, 0.0);
    float cx = smoke.w * (0.55 * hh + 0.85 * hh * hh) + 0.02 * sin(hh * 6.0 - t * 0.5);
    float wd = smoke.z + 0.42 * hh;
    float d = abs(q.x - cx) / wd;
    if (d < 1.6 && q.y > -0.05) {
      vec2 sp = vec2(q.x - cx, hh - t * 0.035) * 13.0;                 // round billows rolling up the column
      float bill = fbm(sp + vec2(0.0, 1.2 * fbm(sp * 0.5 + vec2(t * 0.05, 0.0))));
      float edge = d + (0.55 - bill) * 1.6;                            // lumpy, rolling edges
      float dens = smoothstep(1.25, 0.35, edge) * smoothstep(-0.05, 0.03, q.y) * (1.0 - smoothstep(0.6, 1.1, hh));
      float lit = exp(-hh * 22.0) * flick;
      float top = smoothstep(0.5, 0.85, bill) * (1.0 - lit);           // billow tops catch a little sky
      vec3 c = mix(vec3(0.022, 0.019, 0.016) + vec3(0.08, 0.075, 0.07) * top, vec3(0.75, 0.32, 0.09), lit);
      float a = clamp(dens * 1.5, 0.0, 0.97);
      sm = vec4(c * a, a);
    }
  }
  // ---- the flames: one turbulent mass per source (engine deck, turret hatch, driver's hatch, the fuel pool
  // underneath): white-hot at the root, tapering up into licking orange and deep-red tongues bent by the wind
  for (int i = 0; i < 4; i++) {
    vec4 s = src[i];
    if (s.w <= 0.0) continue;
    vec2 q = vec2((uv.x - s.x) * asp, uv.y - s.y) / s.z;               // units of the source's half width
    if (q.y < -0.6 || q.y > 5.0 || abs(q.x) > 3.0) continue;
    q.x -= 0.08 * q.y * q.y + 0.06 * sin(q.y * 1.8 - t * 1.9 + float(i));   // wind lean and sway
    vec2 w = vec2(fbm(q * 1.2 + vec2(float(i) * 7.3, -t * 1.0)), fbm(q * 1.2 + vec2(5.2 + float(i), -t * 1.3)));
    float f = fbm(vec2(q.x * 2.6, q.y * 1.0) + (w - 0.5) * 2.4 + vec2(float(i) * 3.1, -t * 2.6));
    // a broad body at the root that breaks up, higher, into separate licking tongues where the turbulence carries
    float env = (1.0 - smoothstep(0.55, 1.15, abs(q.x) - 0.1 * q.y)) * (1.0 - smoothstep(0.3, 4.4, q.y));
    float root = smoothstep(-0.45, 0.05, q.y + 0.2 * (n(vec2(q.x * 3.0, t * 4.0)) - 0.5));
    float heat = env * root * (f * 2.1 - 0.42 * q.y - 0.12) * s.w * (0.8 + 0.2 * flick);
    float k = smoothstep(0.26, 1.05, heat);
    add += fireRamp(k) * 1.1;
    add += vec3(1.0, 0.36, 0.09) * 0.08 * s.w * env * root * flick;     // glow in and around the flames
  }
  // ---- sparks and embers riding the heat up, flickering out
  {
    vec2 q = vec2((uv.x - smoke.x) * asp, uv.y - smoke.y);
    if (q.y > -0.02 && q.y < 0.45 && abs(q.x - 0.25 * q.y * q.y) < 0.1 + 0.25 * q.y) {
      vec2 g = vec2(q.x * 70.0 - sin(q.y * 9.0 + t) * 3.0, q.y * 70.0 - t * 9.0);
      vec2 cell = floor(g), fr = fract(g) - 0.5;
      float r = h(cell);
      if (r > 0.94) {
        vec2 off = vec2(h(cell + 1.7), h(cell + 3.3)) - 0.5;
        float life = 1.0 - smoothstep(0.05, 0.4, q.y);
        add += vec3(1.0, 0.62, 0.25) * smoothstep(0.09, 0.0, length(fr - off * 0.7)) * life * (0.6 + 0.4 * sin(t * 13.0 + r * 50.0));
      }
    }
  }
  // ---- the fire's flickering light on the hull and the ground round the wreck
  {
    vec2 q = vec2((uv.x - glow.x) * asp / glow.z, (uv.y - glow.y) / glow.w);
    add += vec3(1.0, 0.42, 0.13) * 0.16 * flick * exp(-dot(q, q) * 1.6);
  }
  // ---- volumetric searchlight from the left headland, sweeping slowly
  vec2 src = vec2(0.19 * asp, 0.0);
  vec2 d = vec2(uv.x * asp, uv.y) - src;
  float ang = 1.9 + 0.16 * sin(t * 0.11);
  vec2 dir = vec2(cos(ang), sin(ang));
  float along = dot(d, dir);
  float across = abs(d.x * dir.y - d.y * dir.x);
  if (along > 0.0) {
    float width = 0.02 + along * 0.13;
    float cone = smoothstep(width, width * 0.35, across);
    float dens = 0.55 + 0.9 * fbm(vec2(along * 5.0 - t * 0.12, across * 16.0 + t * 0.05));
    add += vec3(0.78, 0.84, 0.9) * cone * dens * 0.3 * exp(-along * 0.9);
  }
  // the smoke over the plate, then the light screened over both, written as valid premultiplied colour
  // (rgb <= alpha, so no compositor clamps it): out = src.rgb + dst * (1 - src.a)
  add = clamp(add, 0.0, 1.0);
  float L = max(max(add.r, add.g), add.b);
  o = vec4(add + sm.rgb * (1.0 - L), sm.a + L - sm.a * L);
}`;

/**
 * Where the wreck burns, in the plate's 16:9 '106 %' uv (x from the left, y from the bottom; uv = plate * 1.06 - 0.03,
 * as the stage shows a 16:9 plate: tools/ui/keyart/herohd/backdrop.py writes the sources' projections). The shader
 * maps the stage onto the plate first (splash-plate.js), so these hold on every form factor:
 * src: [x, y, width in screen heights, strength] for the engine deck, the turret hatch, the driver's hatch and the
 * fuel burning under the hull; smoke: [x, y, base width, lean]; glow: [x, y, radius x, radius y].
 */
export const FIRE = {
  src: [[0.6426, 0.254, 0.046, 1.0], [0.7071, 0.312, 0.016, 0.8], [0.7754, 0.255, 0.012, 0.5], [0.6772, 0.145, 0.05, 0.45]],
  smoke: [0.652, 0.295, 0.045, 0.6],
  glow: [0.70, 0.21, 0.22, 0.1],
};

export class SplashFx {
  /** @param {HTMLCanvasElement} canvas @param {{still?:boolean, fire?:Partial<typeof FIRE>, focus?:() => number[]}} o (focus: the plate's crop, boot.js) */
  constructor(canvas, o = {}) {
    this.canvas = canvas;
    this.o = o;
    this.t = 7.3;
    this.alive = false;
    // premultiplied alpha, composited normally: the smoke column covers the plate, the light is screened over it
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      gl.useProgram(p);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = Object.fromEntries(['t', 'res', 'src', 'smoke', 'glow', 'plate'].map((k) => [k, gl.getUniformLocation(p, k)]));
      this.gl = gl;
      this.alive = true;
    } catch (err) {
      console.warn('[splash-fx]', err);
    }
  }

  start() {
    if (!this.alive) return;
    let last = performance.now(), acc = 1;
    const tick = (now) => {
      if (!this.alive) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 1 / 30) {
        this.t += acc;
        acc = 0;
        this.draw();
      }
      if (!this.o.still) this._raf = requestAnimationFrame(tick);
    };
    this.draw();
    if (!this.o.still) this._raf = requestAnimationFrame(tick);
    else if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => { cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => this.alive && this.draw()); });
      this._ro.observe(this.canvas);
    }
  }

  /** Where the fire and the tank are on the stage right now (stage px; the probe and the tests read it). */
  fit() {
    const c = this.canvas, W = c.clientWidth, H = c.clientHeight, r = plateRect(W, H, this.o.focus?.()), [x, y] = FIRE.src[0];
    const [u0, v0, u1, v1] = TANK_BOX;
    return { W, H, plate: r, fire: plateToStage((x + 0.03) / 1.06, 1 - (y + 0.03) / 1.06, W, H, r),
      tank: [...plateToStage(u0, v0, W, H, r), ...plateToStage(u1, v1, W, H, r)] };
  }

  draw() {
    const { gl, canvas: c } = this;
    const w = Math.max(2, Math.round(c.clientWidth * 0.5)), h = Math.max(2, Math.round(c.clientHeight * 0.5));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform1f(this.u.t, this.t);
    gl.uniform2f(this.u.res, w, h);
    gl.uniform4fv(this.u.plate, plateUniform(c.clientWidth, c.clientHeight, plateRect(c.clientWidth, c.clientHeight, this.o.focus?.())));
    const f = { ...FIRE, ...this.o.fire };
    gl.uniform4fv(this.u.src, f.src.flat());
    gl.uniform4fv(this.u.smoke, f.smoke);
    gl.uniform4fv(this.u.glow, f.glow);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
