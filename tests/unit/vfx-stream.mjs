/**
 * Headless VFX stream recorder (art/realistic-flames): runs library recipes on a mock that schedules events and
 * emitters exactly like vfx/index.js (fixed 1/60 s steps, events before emitters, density 1, no budget pressure) and
 * hashes every particle, light sample, heat-source sample, decal, debris piece, blast and shake they produce. The
 * sustained fires a blast leaves (`fires`: fuel_pool_fire, fuel_tank_fire, burning_wreck, _residual_fire, _blast_plume) are tagged through their
 * RECIPES entry and hashed apart, so `blast` = the explosion's own output only (tests/unit/flames.test.mjs,
 * tools/perf/vfx-stream-hash.mjs).
 */
import * as THREE from 'three';

/** FNV-1a over a value stream (numbers rounded to 1e-6). */
function hasher() {
  let h = 0x811c9dc5;
  return {
    add(v) { const s = typeof v === 'number' ? (Math.round(v * 1e6) / 1e6).toString() : String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } h ^= 59; },
    get hex() { return (h >>> 0).toString(16).padStart(8, '0'); },
  };
}
const KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 's0', 's1', 'drag', 'buoy', 'r', 'g', 'b', 'op', 'temp', 'cool', 'noise', 'rot', 'mode', 'seed', 'stretch', 'wind', 'shape', 'erode', 'fin', 'aux', 'dtOff', 'hot', 'ambient'];
const mulberry = (s) => { let a = (s ?? 1) * 9301 + 49297; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** The explosions checked (kind, opts): every blast kind, chained and scaled variants. */
export const STREAM_CASES = [['explosion_large', {}], ['explosion_large', { scale: 1.3 }], ['explosion_small', {}], ['grenade', {}], ['barrel_explosion', {}],
  ['barrel_explosion', { chainFrom: { x: 13, y: 0, z: 23 } }], ['tanker_explosion', { yaw: 0.4, dur: 1e6 }],
  ['fuel_tank_blast', { yaw: 0.3, dur: 90, scale: 1.1, size: [5, 7], h: 2.7, poolR: 3.5, smokeK: 1.2 }]];
export const caseKey = (k, o) => `${k}${Object.keys(o).length ? ' ' + JSON.stringify(o) : ''}`;

/**
 * @param {object} RECIPES the library's recipe table (effects.js) @param {number} [seed]
 * @returns mock library with run(kind, opts, sec, fires) -> {blast, fire, n: {blast, fire}, emitted}
 */
export function makeMock(RECIPES, seed = 12345) {
  const dt = 1 / 60, out = { blast: hasher(), fire: hasher(), flame: hasher(), counts: { blast: 0, fire: 0, flame: 0 } }, emitted = [];
  let tag = 'blast';
  const rec = (kind, vals) => { const H = out[tag]; H.add(kind); for (const v of vals) H.add(v); out.counts[tag]++; };
  const v = {
    time: 0, events: [], emitters: [], lights: [], haze: [], pressure: 1, quality: { density: 1, name: 'high' }, emitted,
    u: { uWind: { value: new THREE.Vector3(1.6, 0, 0.6) } },
    debris: { add(d) { rec('debris', [d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z, d.size, d.trail, d.burnTime]); }, addHero(m, o) { rec('hero', [o.pos.x, o.pos.y, o.pos.z, o.vel.x, o.vel.y, o.vel.z, o.burnTime]); } },
    n(c) { return Math.max(1, Math.round(c * this.quality.density * this.pressure)); },
    at(delay, fn) { const t = tag; this.events.push({ t: this.time + delay, fn: () => { const p = tag; tag = t; try { fn(); } finally { tag = p; } } }); },
    addEmitter(e) { e.acc = 0; e.t0 = this.time; e.tag = tag; this.emitters.push(e); return e; },
    emit(p) { rec('p', [this.time, ...KEYS.map((k) => p[k] ?? 0)]); emitted.push({ ...p, t: this.time, tag }); return 0; },
    light(req) { req.t0 = this.time + (req.delay || 0); req.tag = tag; this.lights.push(req); rec('light', [req.pos.x, req.pos.y, req.pos.z, req.radius, req.dur, req.color.r, req.color.g, req.color.b]); return req; },
    heatSource(h) { h.t0 = this.time; h.tag = tag; this.haze.push(h); rec('haze', [h.pos.x, h.pos.y, h.pos.z, h.radius, h.dur, h.strength ?? 1, h.ring ? 1 : 0]); return h; },
    decal(pos, size, kind, o = {}) { rec('decal', [pos.x, pos.z, size, kind, o.rot ?? 0, o.fade ?? 0, o.opacity ?? 1]); },
    addShake(a) { rec('shake', [a]); }, blast(pos, r) { rec('blastR', [pos.x, pos.z, r]); },
    groundHeight: () => 0, rand: mulberry,
    step() {
      this.time += dt; const t = this.time;
      const due = this.events.filter((e) => e.t <= t + 1e-9);
      if (due.length) { this.events = this.events.filter((e) => e.t > t + 1e-9); for (const e of due) e.fn(); }
      for (const e of this.emitters) {
        const age = t - e.t0; if (age > e.dur || e.stopped) { e.dead = true; continue; }
        // a blast's lingering emitters — explosion_large's residual ground fire (18 s) and its aftermath column (26 s; 20 s
        // inside a fuel-tank or tanker blast) — hash apart: `flame` (their first 2.5 s are the blast's own)
        const p = tag; tag = e.tag === 'blast' && !e.noScale && (e.dur === 18 || e.dur === 20 || e.dur === 26) ? 'flame' : e.tag;
        try {
          e.acc += dt * (typeof e.rate === 'function' ? e.rate(age) : e.rate) * (e.noScale ? 1 : this.quality.density * this.pressure);
          while (e.acc >= 1) { e.acc -= 1; e.fn(age, e); }
          if (e.tick) e.tick(age, dt, e);
        } finally { tag = p; }
      }
      this.emitters = this.emitters.filter((e) => !e.dead);
      // what the light pool and the haze projection read every frame
      for (const q of this.lights) { const a = t - q.t0; if (a < 0 || a > q.dur || q.stopped) continue; const p = tag; tag = q.tag; rec('L', [t, q.fn(a), q.pos.x, q.pos.y, q.pos.z]); tag = p; }
      for (const q of this.haze) { const a = t - q.t0; if (a > q.dur || q.stopped) continue; const p = tag; tag = q.tag; rec('H', [t, q.fn ? q.fn(a) : 1]); tag = p; }
    },
    /** Run a recipe for `sec` s; the recipes named in `fires` are tagged 'fire'. */
    run(kind, opts = {}, sec = 3, fires = ['fuel_pool_fire', 'fuel_tank_fire', 'burning_wreck', '_residual_fire', '_blast_plume']) {
      const saved = {};
      for (const f of fires) { saved[f] = RECIPES[f]; RECIPES[f] = (...a) => { const p = tag; tag = 'fire'; try { return saved[f](...a); } finally { tag = p; } }; }
      try {
        const o = { surface: 'snow', ...opts };
        if (o.chainFrom) o.chainFrom = new THREE.Vector3(o.chainFrom.x, o.chainFrom.y, o.chainFrom.z);
        this.handle = RECIPES[kind](this, new THREE.Vector3(10, 0, 20), o, mulberry(seed));
        for (let s = 0; s < Math.round(sec * 60); s++) this.step();
      } finally { for (const f of fires) RECIPES[f] = saved[f]; }
      return { blast: out.blast.hex, flame: out.flame.hex, fire: out.fire.hex, n: { ...out.counts }, emitted };
    },
  };
  return v;
}
