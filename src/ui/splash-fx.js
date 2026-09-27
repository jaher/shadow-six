/**
 * S03 title splash light layer (review fix: "the fire is a flat blob, the searchlight a plain gradient"): one raw
 * WebGL2 full-screen pass drawing a domain-warped fbm fire over the emplacement, heat shimmer, drifting embers' glow
 * and a volumetric searchlight beam (noise-modulated density along the cone). Composited with `screen` over the
 * painted sky plate, under the rendered hero. Half resolution, ≤ 30 fps, one still frame under reduced motion.
 * No three.js here: the splash shows while the engine is still loading.
 * @module ui/splash-fx
 */

const VS = `#version 300 es
in vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform float t; uniform vec2 res; uniform vec2 fireAt; uniform float fireW;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
vec3 fireRamp(float k) {
  return clamp(vec3(1.5 * k, 1.5 * k * k * k, k * k * k * k * k * k * 1.2) * vec3(1.0, 0.85, 0.6), 0.0, 1.0);
}
void main() {
  float asp = res.x / res.y;
  vec2 q = vec2((uv.x - fireAt.x) * asp / fireW, (uv.y - fireAt.y) / fireW);   // fire space: base at y 0
  vec3 col = vec3(0.0);
  // ---- fire: a wide, ragged sheet of flame rising from the emplacement
  if (q.y > -0.25 && q.y < 2.4 && abs(q.x) < 1.6) {
    vec2 w = vec2(fbm(q * 2.2 + vec2(0.0, -t * 1.4)), fbm(q * 2.2 + vec2(5.2, -t * 1.7)));
    float f = fbm(q * vec2(3.0, 2.2) + (w - 0.5) * 1.6 + vec2(0.0, -t * 2.3));
    float shape = smoothstep(1.35, 0.0, abs(q.x) + q.y * 0.35) * smoothstep(-0.25, 0.06, q.y);
    float heat = f * shape * (1.35 - q.y * 0.55);
    float k = smoothstep(0.28, 0.95, heat);
    col += fireRamp(k) * 1.15;
    // soft glow around the flames (lights the smoke and the ground)
    col += vec3(1.0, 0.42, 0.12) * 0.22 * smoothstep(1.6, 0.0, length(q * vec2(0.8, 1.1) - vec2(0.0, 0.35)));
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
    col += vec3(0.78, 0.84, 0.9) * cone * dens * 0.34 * exp(-along * 0.9);
  }
  // embers' ambient: faint flicker of the whole plate
  col *= 0.94 + 0.06 * n(vec2(t * 7.0, 0.0));
  o = vec4(col, 1.0);
}`;

export class SplashFx {
  /** @param {HTMLCanvasElement} canvas @param {{still?:boolean, fireAt?:[number,number], fireW?:number}} o */
  constructor(canvas, o = {}) {
    this.canvas = canvas;
    this.o = o;
    this.t = 7.3;
    this.alive = false;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, alpha: false });
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
      this.u = Object.fromEntries(['t', 'res', 'fireAt', 'fireW'].map((k) => [k, gl.getUniformLocation(p, k)]));
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
  }

  draw() {
    const { gl, canvas: c } = this;
    const w = Math.max(2, Math.round(c.clientWidth * 0.5)), h = Math.max(2, Math.round(c.clientHeight * 0.5));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform1f(this.u.t, this.t);
    gl.uniform2f(this.u.res, w, h);
    const [fx, fy] = this.o.fireAt || [0.74, 0.2];
    gl.uniform2f(this.u.fireAt, fx, fy);
    gl.uniform1f(this.u.fireW, this.o.fireW || 0.2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this._raf);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
