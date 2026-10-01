/**
 * Persistent explosion ground marks (orchestrator request 2026-09-27, bodies-design §A.8 "snow, dust and sand"):
 *   soft ground (snow, sand, mud, dirt, grass) → a real CRATER carved into the terrain trail field (depression + ejecta
 *     berm, the terrain shader displaces and shades it) + a conforming 'soil' decal: churned dark earth in the bowl,
 *     blackened rim, radial soil streaks and clods;
 *   hard floors (road, rock, bridge decks, roofs, structure floors) → no crater, a ragged radial 'soot' shadow + chips;
 *   water → nothing here (art/water.js draws the column and the ripples).
 * Sizes scale with the explosion class (CONFIG.physics.marks: grenade < shell < barrel < vehicle < bomb < fuel tank).
 * Visual only (never touches nav/gameplay); the mark list is saved with the game and rebuilt on load.
 * @module render/blast-marks
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { T, B } from '../world/grid.js';
import { blastMarkAtlas } from './blast-mark-textures.js';
import { explosionReach } from '../abilities/explosions.js';

const MAX = 96, N = 9;   // marks kept (oldest recycled), grid vertices per side
const BERM = 0.5;        // ejecta rim height factor of the crater stamp
const HARD_LAYERS = new Set(['road', 'rock', 'gravel', 'ice', 'concrete']);

const VERT = /* glsl */`
attribute float aOp; attribute float aCell; attribute float aSnow;
varying vec2 vUv; varying float vOp; varying float vSnow;
void main() { vUv = vec2(uv.x * 0.5 + aCell * 0.5, uv.y); vOp = aOp; vSnow = aSnow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform sampler2D map; uniform float uK;
varying vec2 vUv; varying float vOp; varying float vSnow;
void main() {
  vec4 t = texture2D(map, vUv);
  float cov = t.a * vOp * smoothstep(0.5, 0.46, abs(vUv.x - (vUv.x < 0.5 ? 0.25 : 0.75)) * 2.0 + 0.0);
  float k = vUv.x < 0.5 ? uK : uK * 2.3;   // soot on hard floors: a clear grey-black blast shadow, still not a hole
  vec3 c = clamp(t.rgb * k, 0.0, 1.0);
  // snow: the bowl shows churned snow and a little frozen soil — grey-brown, dirty-snow ejecta, never an ink blot
  if (vSnow > 0.5) { c = mix(vec3(1.0), clamp(t.rgb * uK * 2.8, 0.0, 1.0) * vec3(1.0, 0.94, 0.86), 0.8); cov *= 0.85; }
  gl_FragColor = vec4(mix(vec3(1.0), c, cov), 1.0);
}`;

/** Surface class at (x, z): 'water' | 'hard' | 'soft'. */
export function markSurface(world, x, z) {
  const g = world.grid, i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (!g.inBounds(i, j)) return 'soft';
  const k = g.idx(i, j);
  if (g.isWater(i, j)) return 'water';
  if (g.bridge[k] || g.elev[k] > 0.05 || g.block[k] !== B.NONE || g.terrain[k] === T.ROAD) return 'hard';
  const mat = world.terrain?.materialAt?.(x, z);
  if (mat && HARD_LAYERS.has(mat.name)) return 'hard';
  return 'soft';
}

export class BlastMarks {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    /** @type {{x:number, z:number, cls:string, s:string, rot:number}[]} */
    this.marks = [];
    this.mesh = null;
    this.visual = typeof document !== 'undefined' && !!scene;
    this._off = world.events.on('explosion', (e) => this.add(e));
  }

  /** Record + draw the mark of explosion event e ({x, z, kind}). */
  add(e, o = {}) {
    if (!Number.isFinite(e?.x) || !Number.isFinite(e?.z)) return null;
    const cls = e.kind || e.cls || 'grenade';
    const s = e.s || markSurface(this.world, e.x, e.z);
    if (s === 'water') return null;
    const rot = e.rot ?? (((Math.imul(Math.round(e.x * 100), 73856093) ^ Math.imul(Math.round(e.z * 100), 19349663)) >>> 0) % 6283) / 1000;
    const m = { x: +e.x.toFixed(3), z: +e.z.toFixed(3), cls, s, rot: +rot.toFixed(3) };
    this.marks.push(m);
    if (this.marks.length > MAX) this.marks.shift();
    if (this.visual) { this._stamp(m); this._rebuild(); }
    return m;
  }

  /** Crater depression in the terrain trail field (soft ground only). */
  _stamp(m) {
    const t = this.world.terrain;
    if (m.s !== 'soft' || !t?.stampTrail) return;
    const d = CONFIG.physics.marks[m.cls] ?? 1.2;
    t.stampTrail('crater', m.x, m.z, m.rot, { width: d, depth: Math.min(1.2, 0.35 + 0.2 * d), berm: BERM, record: false, id: null });
  }

  _rebuild() {
    const w = this.world, marks = this.marks, nv = N * N;
    const pos = new Float32Array(marks.length * nv * 3), uv = new Float32Array(marks.length * nv * 2);
    const op = new Float32Array(marks.length * nv), cell = new Float32Array(marks.length * nv), snw = new Float32Array(marks.length * nv);
    const idx = [];
    const gy = (x, z) => (typeof w.groundY === 'function' ? w.groundY(x, z) || 0 : 0);
    marks.forEach((m, k) => {
      const d = CONFIG.physics.marks[m.cls] ?? 1.2, soft = m.s === 'soft';
      const half = (soft ? 2.4 : 2.8) * d / 2, c = Math.cos(m.rot), sn = Math.sin(m.rot);
      const mat = soft ? w.terrain?.materialAt?.(m.x, m.z) : null, sft = mat?.soft ?? 0, isSnow = soft && ((mat?.snow ?? 0) > 0.5 || /snow/.test(mat?.name || ''));
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const u = (i / (N - 1)) * 2 - 1, v = (j / (N - 1)) * 2 - 1, lx = u * half, lz = v * half;
          const x = m.x + lx * c - lz * sn, z = m.z + lx * sn + lz * c;
          // flat over the bowl, lifted above the ejecta berm (a conforming grid showed the coarse terrain facets)
          const prof = soft ? sft * 0.45 * BERM : 0;
          const q = k * nv + j * N + i;
          pos.set([x, gy(x, z) + prof + 0.03, z], q * 3);
          uv.set([(u + 1) / 2, (v + 1) / 2], q * 2);
          op[q] = 1; cell[q] = soft ? 0 : 1; snw[q] = isSnow ? 1 : 0;
        }
      }
      for (let j = 0; j < N - 1; j++) {
        for (let i = 0; i < N - 1; i++) {
          const a = k * nv + j * N + i;
          idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aOp', new THREE.BufferAttribute(op, 1));
    geo.setAttribute('aCell', new THREE.BufferAttribute(cell, 1));
    geo.setAttribute('aSnow', new THREE.BufferAttribute(snw, 1));
    geo.setIndex(idx);
    if (!this.mesh) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { map: { value: blastMarkAtlas() }, uK: { value: 9 } },
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.name = 'blast-marks'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
      this.mesh.userData.noXray = true; this.mesh.userData.aoExclude = true;
      this.scene.add(this.mesh);
    } else {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    }
  }

  serialize() { return this.marks.map((m) => ({ ...m })); }

  /** Rebuild from a save (craters re-stamped, decals redrawn). */
  restore(list) {
    if (!Array.isArray(list)) return;
    this.marks = [];
    for (const m of list.slice(-MAX)) { this.marks.push({ ...m }); if (this.visual) this._stamp(m); }
    if (this.visual && this.marks.length) this._rebuild();
    // the lasting visual state of each blast (doors left ajar, broken panes) comes back at once
    for (const m of this.marks) this.world.events.emit('blast:front', { x: m.x, z: m.z, Rk: explosionReach(m.cls) || 4.5, Rb: 0, Q: 0, kind: m.cls, restore: true });
  }

  dispose() {
    this._off?.();
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
  }
}
