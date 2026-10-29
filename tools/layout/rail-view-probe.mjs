#!/usr/bin/env node
/**
 * Rails in view, as drawn (GPU headless, the browser test harness): which structures hide the rail heads from the
 * default camera (orthographic, pitch 40, yaw 15). Rays from both rail heads (centre ± 0.72 m, y 0.2, every 0.5 m)
 * towards the camera against every drawn structure mesh in view — a structure's own meshes and the instanced batches
 * repeated library assets are drawn in (map-builder batchLibraryRepeats; an instance is credited to the meshless
 * structure nearest it) — not the rails themselves or ground layers. Every structure a ray passes through counts.
 * The ground truth for the static check (src/missions/rail-clearance.js viewHidden, tools/layout/rail-report.mjs --view).
 *
 *   node tools/layout/rail-view-probe.mjs m16[,m18…] [--yaw 15] [--pitch 40] [--what-if '{"m16":[{"house_road":{"dx":2,"dz":2}}]}']
 *
 * --what-if: variants per mission, each moving structures' drawn models (dx, dz) and scaling their fit (sx, sy, sz);
 * each is measured after the plain map ("base") and undone. Output: JSON, per mission and variant, per rail line,
 * per structure: m of rail head hidden (railHeadM), the stretch along the line (s), the highest point hit.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const list = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) || 'm16';
const mods = JSON.parse(arg('what-if', '{}'));
const yawDeg = +arg('yaw', 15), pitchDeg = +arg('pitch', 40);
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const h = await startHarness({ viewport: { width: 640, height: 360 } });
const all = {};
try {
  for (const mission of list.split(',')) {
    const page = await h.newPage({ width: 640, height: 360 });
    page.setDefaultTimeout(0);
    await h.openGame(page, '?test=1');
    all[mission] = await page.evaluate(probe, { mission, yawDeg, pitchDeg, variants: mods[mission] || [] });
    await page.close();
  }
} finally { await h.close(); }
console.log(JSON.stringify(all, null, 1));

/** In the page: load the mission, collect the drawn meshes, cast the rays (per variant). */
async function probe({ mission, yawDeg, pitchDeg, variants }) {
  const G = window.__game; await G.loadMission(mission);
  const THREE = await import('three');
  const RC = await import('/src/missions/rail-clearance.js');
  const w = G.game.world, def = G.game.missionDef;
  const rails = RC.railLines(def, {}).filter((r) => r.kind !== 'run');
  const yaw = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p)).normalize();
  const skip = /^(rail_track|tram_track|rail_line|road|river|path|pavement|sea|lake|current|crater|minefield|shore)$/;
  const natural = /^(tree|pine|palm|bush|shrub|rocks|rock|boulder|cliff|hedge)$/;
  const shown = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  const tagOf = (s) => { const d = s.def || {}; return RC.onRailsReason({ ...d, type: s.type ?? d.type }) ?? (natural.test(s.type) ? 'natural' : d.railView ? `railView: ${d.railView}` : ''); };
  const targets = [], meshless = [];
  for (const [id, s] of w.structures) {
    if (!s.object3d || skip.test(s.type ?? s.def?.type ?? '')) continue;
    s.object3d.updateMatrixWorld(true);
    const tag = tagOf(s);
    let n = 0;
    s.object3d.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || m.isDepthProxy || !m.geometry?.attributes?.position || !shown(m)) return;
      m.userData.__probe = [id, tag]; targets.push(m); n++;
    });
    if (!n && Number.isFinite(s.def?.x)) meshless.push([id, s]);
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3();
  w.scene?.traverse?.((o) => {
    if (!o.isInstancedMesh || o.isDepthProxy || !shown(o)) return;
    let batch = false;
    for (let q = o; q; q = q.parent) if (/^buildings:/.test(q.name ?? '')) { batch = true; break; }
    if (!batch) return;
    o.updateMatrixWorld(true);
    o.userData.__probeIds = [];
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, _m); _p.setFromMatrixPosition(_m.premultiply(o.matrixWorld));
      let best = null, bd = 12;
      for (const [id, s] of meshless) { const d = Math.hypot(s.def.x - _p.x, s.def.z - _p.z); if (d < bd) { bd = d; best = [id, tagOf(s)]; } }
      o.userData.__probeIds.push(best);
    }
    targets.push(o);
  });
  const rc = new THREE.Raycaster(); rc.near = 0.02; rc.far = 400;
  const measure = () => rails.map((r) => {
    const L = r.line, P = [];
    for (let k = 0; k + 1 < L.length; k++) {
      const [ax, az] = L[k], [bx, bz] = L[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let q = 0; q < n; q++) P.push([ax + (bx - ax) * q / n, az + (bz - az) * q / n, k]);
    }
    P.push([...L[L.length - 1], L.length - 2]);
    let s = 0;
    const by = new Map();
    for (let i = 0; i < P.length; i++) {
      const [x, z, k] = P[i];
      if (i) s += Math.hypot(x - P[i - 1][0], z - P[i - 1][1]);
      const [ax, az] = L[k], [bx, bz] = L[k + 1] ?? L[k];
      const ll = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / ll, nz = (bx - ax) / ll;
      for (const side of [-1, 1]) {
        rc.set(new THREE.Vector3(x + nx * 0.72 * side, 0.2, z + nz * 0.72 * side), dir);
        const seen = new Set();
        for (const hh of rc.intersectObjects(targets, false)) {
          const who = hh.object.isInstancedMesh ? hh.object.userData.__probeIds?.[hh.instanceId] : hh.object.userData.__probe;
          if (!who || seen.has(who[0])) continue;
          seen.add(who[0]);
          if (!by.has(who[0])) by.set(who[0], { id: who[0], tag: who[1], n: 0, s0: s, s1: s, ymax: 0 });
          const b = by.get(who[0]); b.n++; b.s1 = s; b.ymax = Math.max(b.ymax, hh.point.y);
        }
      }
    }
    return { rail: r.id, kind: r.kind, len: +s.toFixed(1),
      by: [...by.values()].map((b) => ({ id: b.id, tag: b.tag, railHeadM: b.n * 0.5, s: [+b.s0.toFixed(1), +b.s1.toFixed(1)], hitYmax: +b.ymax.toFixed(1) }))
        .sort((a, b) => b.railHeadM - a.railHeadM) };
  });
  const res = [{ variant: 'base', lines: measure() }];
  for (const v of variants) {
    const undo = [];
    for (const [id, m] of Object.entries(v)) {
      const o = w.structures.get(id)?.object3d; if (!o) continue;
      const fit = o.getObjectByName('fit');
      undo.push([o, o.position.clone(), fit, fit?.scale.clone()]);
      o.position.x += m.dx ?? 0; o.position.z += m.dz ?? 0;
      if (fit) { fit.scale.x *= m.sx ?? 1; fit.scale.y *= m.sy ?? 1; fit.scale.z *= m.sz ?? 1; }
      o.updateMatrixWorld(true);
    }
    res.push({ variant: JSON.stringify(v), lines: measure() });
    for (const [o, pos, fit, sc] of undo) { o.position.copy(pos); if (fit) fit.scale.copy(sc); o.updateMatrixWorld(true); }
  }
  return res;
}
