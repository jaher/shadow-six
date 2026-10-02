#!/usr/bin/env node
/**
 * Boat-wake screenshots (GPU headless, the browser test harness): a raft rowed by the Marine across the M2 river
 * (and a rowboat / the patrol boat) at default zoom and zoom 2, straight and turning, plus a parked raft (quiet water).
 *   node tools/water/raft-wake-shots.mjs [outDir=docs/screenshots] [prefix=raft-wake]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, process.argv[2] || 'docs/screenshots');
const PREFIX = process.argv[3] || 'raft-wake';
const ONLY = process.argv[4] || '';
mkdirSync(OUT, { recursive: true });
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const VIEW = { width: 1280, height: 720 };

// M2 river lane coordinates: s along the first reach from (0, 36), o across it (+ = NE bank side, clear of islet 1)
const U = [0.789, 0.614], N = [0.614, -0.789];
const P = (s, o) => [s * U[0] + o * N[0], 36 + s * U[1] + o * N[1]];
const ARC = [...Array(5)].map((_, k) => { const a = (k + 1) * 10 * Math.PI / 180; return P(16 + 7 * Math.sin(a), -4 + 7 * Math.cos(a)); });
const TURN = [P(16, 3), ...ARC, P(24, -2.6)];
// [name, mission, vehicle type, start, waypoints, zoom, seconds, stopAfter?] (stopAfter: halt at t s, then sit still)
const SHOTS = [
  ['m02-straight', 'm02', 'raft', P(4, 1), [P(30, 1)], 1, 4.8],
  ['m02-straight-z2', 'm02', 'raft', P(4, 1), [P(30, 1)], 2, 4.8],
  ['m02-turn', 'm02', 'raft', P(4, 3), TURN, 1, 5.3],
  ['m02-turn-z2', 'm02', 'raft', P(4, 3), TURN, 2, 5.3],
  ['m02-stationary-z2', 'm02', 'raft', P(8, 3), [P(24, 3)], 2, 8, 4.6],
  ['m02-patrolboat', 'm02', 'patrolboat', P(2, 0), [P(26, 0)], 1, 5.6],
  // other theatres: M17 Rhine-side river (temperate, muddy), M13 St-Nazaire harbour (coast)
  ['m17-temperate', 'm17', 'raft', [50, 72], [[64, 71.5], [72, 69], [80, 65]], 1, 6],
  ['m17-temperate-z2', 'm17', 'raft', [50, 72], [[64, 71.5], [72, 69], [80, 65]], 2, 6],
  ['m13-coast', 'm13', 'raft', [70, 166], [[54, 166], [46, 164], [38, 159]], 1, 6],
  ['m13-coast-z2', 'm13', 'raft', [70, 166], [[54, 166], [46, 164], [38, 159]], 2, 6],
  ['m13-coast-rowboat', 'm13', 'rowboat', [70, 162], [[40, 162]], 1, 6],
];

const h = await startHarness({ viewport: VIEW });
try {
  for (const [name, mission, type, start, wps, zoom, secs, stopAfter] of SHOTS) {
    if (ONLY && !name.includes(ONLY)) continue;
    const page = await h.newPage(VIEW);
    await h.openGame(page);
    if (process.env.PROBE) await page.evaluate(() => { globalThis.__probe = 1; });
    const info = await page.evaluate(async ({ mission, type, start, wps, zoom, secs, stopAfter }) => {
      const g = window.__game, G = g.game;
      await g.loadMission(mission);
      g.start();
      const W = G.world;
      // clear the stage: no enemies to interrupt, park existing boats out of frame
      for (const e of W.enemies || []) { e.alive = false; e.hp = 0; e.setPosition?.(-500, -500); }
      for (const o of [...(W.vehicles || [])]) if (o.isBoat || o.def?.kind === 'boat') W.remove(o); // the mission's own craft
      if (start === 'auto') { // the longest straight open-water run (all cells WATER within ±2.5 m) on a 45° direction
        const gr = W.grid, wet = (x, z) => { const i = Math.floor(x / gr.cell), j = Math.floor(z / gr.cell);
          return i >= 0 && j >= 0 && i < gr.cols && j < gr.rows && gr.terrain[j * gr.cols + i] === 5; };
        let best = null;
        for (let z = 4; z < gr.rows * gr.cell - 4; z += 3) for (let x = 4; x < gr.cols * gr.cell - 4; x += 3) {
          if (!wet(x, z)) continue;
          for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4, ux = Math.cos(a), uz = Math.sin(a);
            let L = 0;
            while (L < 40 && [-2.5, 0, 2.5].every((o) => wet(x + ux * L - uz * o, z + uz * L + ux * o)) && (L < 16 || [-6, 6].every((o) => wet(x + ux * L - uz * o, z + uz * L + ux * o)))) L += 0.5;
            if (!best || L > best.L) best = { x, z, ux, uz, L };
          }
        }
        const { x, z, ux, uz, L } = best, n = Math.min(L - 2, 30);
        start = [x, z];
        wps = wps === 'turn' ? [[x + ux * n * 0.55, z + uz * n * 0.55], [x + ux * n * 0.8 - uz * 3, z + uz * n * 0.8 + ux * 3], [x + ux * n - uz * 6, z + uz * n + ux * 6]]
          : [[x + ux * n, z + uz * n]];
      }
      const [x0, z0] = start;
      const v = W.spawnVehicle(type, { x: x0, z: z0, heading: wps.length ? Math.atan2(wps[0][1] - z0, wps[0][0] - x0) : 0.7 });
      v.crew = []; v.ai = null;
      const c = W.commandos.find((k) => k.role === 'diver');
      c.setPosition(x0, z0); v.enter?.(c);
      g.setZoom(zoom);
      g.centerOn(x0, z0);
      for (let k = 0; k < 40 && !v.visual?.ready && !v.mesh?.children?.length; k++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1500)); // the craft's model streams in (async) before the run
      const dt = 1 / 30;
      if (wps.length) v.followPath(wps.map(([x, z]) => ({ x, z })), { fast: true });
      for (let f = 0; f < secs * 30; f++) {
        if (stopAfter && Math.abs(f / 30 - stopAfter) < 1e-6) v.stop?.();
        g.advance(dt);
        g.centerOn(v.x, v.z);
        G.render(dt, 1);
      }
      let probe = null;
      if (globalThis.__probe) { // debug: ripple texels behind the craft (height, vel, foam, crest) and env depth
        const R = W.water.system.ripples, r = G.renderer.renderer, buf = new Uint16Array(4), h = v.heading;
        const half = (u) => { const e = (u >> 10) & 31, m = u & 1023, sg = u >> 15 ? -1 : 1; return e ? sg * 2 ** (e - 15) * (1 + m / 1024) : sg * m / 16777216; };
        probe = [0, 3, 6, 7.5, 9, 12, 16].map((d) => {
          const x = v.x - Math.cos(h) * d, z = v.z - Math.sin(h) * d, i = Math.floor((x - R.origin.x) / R.size * R.res), j = Math.floor((z - R.origin.y) / R.size * R.res);
          r.readRenderTargetPixels(R.a, i, j, 1, 1, buf); const out = [d, ...[...buf].map((q) => +half(q).toFixed(3))];
          if (R.envRT) { r.readRenderTargetPixels(R.envRT, i >> 1, j >> 1, 1, 1, buf); out.push(+half(buf[0]).toFixed(2)); }
          return out;
        });
      }
      const st = W.water?.wakes?.state.get(v);
      return { x: +v.x.toFixed(2), z: +v.z.toFixed(2), emitted: W.water?.wakes?.emitted, arms: st?.arms?.map((q) => q.length), v: st?.v?.toFixed(2),
        pending: W.water?.system?.ripples?.pending.length, probe, dims: v.model?.dims && [v.model.dims.l, v.model.dims.w] };
    }, { mission, type, start, wps, zoom, secs, stopAfter });
    const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
    writeFileSync(join(OUT, `${PREFIX}-${name}.jpg`), buf);
    console.log(name, JSON.stringify(info));
    await page.close();
  }
} finally { await h.close(); }
