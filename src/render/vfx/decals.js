// Ground decals (scorch, crater dirt, fuel stain, blood) — ONE instanced draw for all of them.
// Drawn in the engine's decalScene (depth-tested against the world, no depth writes, before AO)
// with MULTIPLY blending, so they darken whatever ground is under them under any theater lighting.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 iTint; // rgb tint, charK
attribute vec2 iFade; // t0, fade (s)
attribute float iOp;
uniform float uTime;
varying vec2 vUv; varying vec4 vTint; varying float vOp;
void main(){
  vUv=uv; vTint=iTint; vOp=iOp*clamp((uTime-iFade.x)/max(iFade.y,1e-3),0.0,1.0);
  gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv; varying vec4 vTint; varying float vOp;
void main(){
  vec4 t=texture2D(map,vUv);
  float cov=t.a*vOp;
  vec3 m=mix(vec3(1.0), vTint.rgb*(0.35+vTint.a*t.rgb*14.0), cov);
  gl_FragColor=vec4(m,1.0);
}`;
const TINT = { scorch: [0.32, 0.3, 0.28, 1], crater: [0.55, 0.45, 0.36, 0.5], fuel: [0.4, 0.38, 0.36, 0.5], blood: [0.55, 0.12, 0.1, 0.5] };

export class Decals {
  constructor(scene, textures, max = 128) {
    this.scene = scene; this.max = max; this.count = 0; this.next = 0;
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aFade = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.aOp = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    g.setAttribute('iTint', this.aTint); g.setAttribute('iFade', this.aFade); g.setAttribute('iOp', this.aOp);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: textures.scorch.texture }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.name = 'vfx-decals';
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }
  get items() { return { length: this.count }; }
  /** kind: 'scorch'|'crater'|'fuel'|'blood'; opts: {rot, fade, tint:[r,g,b], opacity} — ring buffer, oldest overwritten */
  add(t, pos, size, kind = 'scorch', o = {}) {
    const i = this.next; this.next = (this.next + 1) % this.max; this.count = Math.min(this.count + 1, this.max);
    const tt = TINT[kind] || TINT.scorch, c = o.tint || tt;
    this._p.set(pos.x, (pos.y ?? 0) + 0.02 + (i % 8) * 0.002, pos.z);
    this._m.compose(this._p, this._q.setFromAxisAngle(this._up, o.rot ?? 0), this._s.setScalar(size));
    this.mesh.setMatrixAt(i, this._m);
    this.aTint.setXYZW(i, c[0], c[1], c[2], tt[3]); this.aFade.setXY(i, t, o.fade ?? 0.4); this.aOp.setX(i, o.opacity ?? 1);
    for (const a of [this.aTint, this.aFade, this.aOp, this.mesh.instanceMatrix]) a.needsUpdate = true;
    this.mesh.count = this.count;
    return i;
  }
  set scene(s) { if (this.mesh) { this._scene?.remove(this.mesh); s.add(this.mesh); } this._scene = s; }
  get scene() { return this._scene; }
  update(t) { this.mat.uniforms.uTime.value = t; }
  clear() { this.count = 0; this.next = 0; this.mesh.count = 0; }
  dispose() { this._scene?.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
