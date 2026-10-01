/**
 * Spatter / drip / boot-print / tyre-smear decals (bodies-design §B.1, §B.5): ONE instanced draw, a lit
 * MeshStandardMaterial reading the procedural atlas (textures.js). Ground decals lie on the terrain normal, wall decals
 * on the wall face. Colour, gloss and snow soaking follow the same age curve as the pools (glsl.js).
 * @module render/blood/decals
 */
import * as THREE from 'three';
import { BLOOD_GLSL, followTrails } from './glsl.js';
import { bloodDecalAtlas, ATLAS_TILES } from './textures.js';

const MAX = 512;

export class DecalLayer {
  constructor(sys, scene, uniforms, follow = null) {
    this.sys = sys; this.scene = scene;
    const g = new THREE.PlaneGeometry(1, 1);
    this.aTile = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage); // tile, t0, op, sf
    g.setAttribute('iBlood', this.aTile);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const atlas = bloodDecalAtlas();
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms, { uDecalAtlas: { value: atlas } });
      followTrails(sh, follow);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 iBlood; uniform float uBloodPx; varying vec2 vDUv; varying vec4 vDB; varying float vDMip;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float tl = iBlood.x, N = ${ATLAS_TILES.toFixed(1)};
          vDUv = (vec2(mod(tl, N), N - 1.0 - floor(tl / N)) + uv) / N; vDB = iBlood;
          // a drop under ~4 px would draw as a hard square pixel: keep a 4 px footprint, soften it (blurrier mip) and
          // fade it with the size it gained (a speck stays a speck, never a solid square)
          float dpx = length(instanceMatrix[0].xyz) * uBloodPx, grow = max(1.0, 4.0 / max(dpx, 1e-3));
          transformed.xy *= grow; vDB.z /= grow; vDMip = log2(grow);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${BLOOD_GLSL}\nuniform sampler2D uDecalAtlas; varying vec2 vDUv; varying vec4 vDB; varying float vDMip; float dWet;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec4 t = texture2D(uDecalAtlas, vDUv, vDMip);
          float age = uBloodTime - vDB.y, sf = vDB.w;
          vec4 tone = bloodTone(age, sf);
          float a = t.a;
          vec3 col = tone.rgb * mix(1.0, 0.55, t.r);
          if (sf > 0.5 && sf < 1.5) {                       // snow: the drop soaks in — a vivid core in a feathered pink halo
            float soft = texture2D(uDecalAtlas, vDUv, 3.0).a;
            float halo = clamp(soft * 1.6 - a, 0.0, 1.0);
            col = mix(uBHalo, uBSnow * 1.1, a);
            a = max(a * 0.95, halo * 0.45);
          }
          a *= vDB.z;
          if (a < 0.01) discard;
          // absorbent ground (soil, gravel, grass) keeps a wet sheen ~30 s; snow soaks it matte; hard floors stay glossy
          float keep = (sf < 0.5 || (sf > 1.5 && sf < 3.5)) ? exp(-age / 30.0) : (sf > 0.5 && sf < 1.5) ? 0.6 * exp(-age / 120.0) : 1.0;
          dWet = tone.a * keep;
          diffuseColor = vec4(col, a * opacity);
        }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.75, 0.08, dWet);`);
    };
    m.customProgramCacheKey = () => 's6blood-decal';
    this.mat = m;
    this.mesh = new THREE.InstancedMesh(g, m, MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.receiveShadow = true;
    this.mesh.name = 'blood-decals'; this.mesh.userData.noXray = true; this.mesh.userData.aoExclude = true;
    scene.add(this.mesh);
    this._on = true; this.mesh.visible = false; // not drawn (nor compiled) until the first decal
    this.list = []; // records in instance order
    this._m = new THREE.Matrix4(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._n = new THREE.Vector3(); this._p = new THREE.Vector3();
  }

  /** Rewrite every instance (after drops from the head of the ring; cheap: ≤ 512 matrices). */
  rebuild(list) {
    this.list = list.slice(-MAX);
    this.list.forEach((d, i) => this._write(i, d));
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true; this.aTile.needsUpdate = true;
    this._sync();
  }

  add(d) {
    if (this.list.length >= MAX) { this.rebuild([...this.list.slice(1), d]); return; }
    this._write(this.list.length, d);
    this.list.push(d);
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true; this.aTile.needsUpdate = true;
    this._sync();
  }

  _write(i, d) {
    const n = this._n, X = this._x, Y = this._y;
    if (d.n) {                                                     // wall: normal = face, x = horizontal
      n.set(d.n[0], d.n[1], d.n[2]).normalize();
      X.set(-n.z, 0, n.x).normalize();
    } else {
      const gy = (x, z) => this.sys._floorY(x, z), e = 0.2;
      n.set(gy(d.x - e, d.z) - gy(d.x + e, d.z), 2 * e, gy(d.x, d.z - e) - gy(d.x, d.z + e)).normalize();
      X.set(Math.cos(d.r), 0, Math.sin(d.r));
      X.addScaledVector(n, -X.dot(n)).normalize();
    }
    Y.crossVectors(n, X).normalize();
    const s = d.s;
    this._p.set(d.x, d.y + (d.n ? 0 : 0.008), d.z).addScaledVector(n, d.n ? 0.01 : 0);
    const e = this._m.elements;
    e[0] = X.x * s; e[1] = X.y * s; e[2] = X.z * s; e[3] = 0;
    e[4] = Y.x * s; e[5] = Y.y * s; e[6] = Y.z * s; e[7] = 0;
    e[8] = n.x; e[9] = n.y; e[10] = n.z; e[11] = 0;
    e[12] = this._p.x; e[13] = this._p.y; e[14] = this._p.z; e[15] = 1;
    this.mesh.setMatrixAt(i, this._m);
    this.aTile.setXYZW(i, d.k, d.t0, d.op, d.sf);
  }

  set visible(v) { this._on = v; this._sync(); }
  _sync() { this.mesh.visible = this._on && this.list.length > 0; }
  clear() { this.list = []; this.mesh.count = 0; this._sync(); }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
