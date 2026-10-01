/**
 * bodies-design §B.3 browser: the same kill on different grounds — M2 snow and a hard / wooden floor (the M2 bridge
 * deck or rock), the temperate sandbox (grass: blades soak red), and the sandbox dressed as desert (sand: a dark matte
 * patch). Each at 45 s (wet: glossy, reflective) and after 12 min (dried: dark crust / brown, snow still vivid ×4).
 * Screenshot → docs/screenshots/bodies-blood-surfaces.jpg (1:1 crops at zoom 4, body hidden to show the pool).
 */
import { saveJpeg } from './bodies-physics.test.mjs';

export default async function bodiesBloodSurfaces(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const Wp = await import('/src/abilities/weapons.js');
    const MI = await import('/src/missions/index.js');
    const strip = new H.Strip(G, { cols: 4, rows: 2, tileW: 315, tileH: 250, cropW: 420, cropH: 333 });
    const out = { scenes: [] };
    /** Find a spot whose blood surface is in `want` (grid scan, open cells only). */
    const findSpot = (W, want, near, R = 1.8) => {
      const gr = W.grid; let best = null, bd = 1e9;
      for (let j = 4; j < gr.rows - 4; j += 2) {
        for (let i = 4; i < gr.cols - 4; i += 2) {
          const x = (i + 0.5) * gr.cell, z = (j + 0.5) * gr.cell;
          if (!want.includes(W.blood._surf(x, z)) || (want[0] !== 'ice' && !gr.walkableAt(x, z))) continue;
          let ok = true;
          for (let dj = -3; dj <= 3 && ok; dj++) for (let di = -3; di <= 3 && ok; di++) if (gr.block[gr.idx(i + di, j + dj)]) ok = false; // no trees / walls over it
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [R, 0], [-R, 0], [0, R], [0, -R], [R * 0.7, R * 0.7], [-R * 0.7, -R * 0.7], [R * 0.7, -R * 0.7], [-R * 0.7, R * 0.7]]) if (!want.includes(W.blood._surf(x + dx, z + dz))) ok = false;
          const d = Math.hypot(x - near.x, z - near.z);
          if (ok && d < bd) { best = { x, z }; bd = d; }
        }
      }
      return best;
    };
    const scene = async (def, want, label, R) => {
      await G.loadMission(def); G.render(0, 1); g.start(); await G.mapHandle?.ready;
      g.setPreset('high');
      const W = G.world;
      for (let i = 0; i < 40 && !W.blood?.layers; i++) await new Promise((ok) => setTimeout(ok, 50));
      W.enemies.forEach(H.freeze);
      for (const e of W.enemies) e.coneVisible = false;
      const c = W.commandos[0], sp = findSpot(W, want, c, R) || findSpot(W, want, c, 1.0);
      if (!sp) return { label, found: false };
      H.clearArea(W, sp.x, sp.z, 16);
      const v = W.enemies.find((e) => e.alive && e.soldierType !== 'dog');
      v.setPosition(sp.x, sp.z, 0.4); c.setPosition(sp.x - 10, sp.z - 0.5, 0);
      H.run(g, G, 10, 1);
      Wp.fireBullet(W, c, v, 999, 'sniper', 'sniperRifle');
      H.run(g, G, 240, 1);
      H.run(g, G, 2400, 12);
      const p = W.blood.pools.find((q) => q.unitId === v.id);
      v.object3d.visible = false;
      const veg = G.renderer.scene.getObjectByName('vegetationB'); if (veg) veg.visible = false; // tree canopies off: the ground is the subject
      g.setZoom(4); g.centerOn(p ? p.x : sp.x, p ? p.z : sp.z); H.run(g, G, 2, 1);
      strip.grab(`${label}: 45 s`);
      W.blood.update(12 * 60); H.run(g, G, 2, 1);                       // 12 min later (blood time only)
      strip.grab(`${label}: 12 min`);
      return { label, found: true, at: [+sp.x.toFixed(1), +sp.z.toFixed(1), W.blood._surf(sp.x, sp.z)], body: [+v.x.toFixed(1), +v.z.toFixed(1), v.alive], pools: W.blood.pools.map((q) => [q.unitId, q.surface, +q.x.toFixed(1), +q.z.toFixed(1)]), vid: v.id, vy: v.y, bl: [...W.blood.bleeders.values()].map((b) => [b.id, b.left, b.n, b.done]), surface: p?.surface, volume: p?.volume, steps: p?.sim?.steps ?? 0, ms: W.blood.stats.ms };
    };
    out.scenes.push(await scene(MI.getMission('m02'), ['snow'], 'M2 snow'));
    out.scenes.push(await scene({ ...MI.getMission('m00'), theater: 'desert' }, ['road', 'hard'], 'desert road (packed)', 1.0));
    out.scenes.push(await scene(MI.getMission('m00'), ['grass'], 'temperate grass'));
    out.scenes.push(await scene({ ...MI.getMission('m00'), theater: 'desert' }, ['soil', 'gravel'], 'desert sand'));
    out.strip = strip.jpeg();
    return out;
  });
  saveJpeg('bodies-blood-surfaces.jpg', r.strip);
  console.log(`    bodies-blood-surfaces: ${JSON.stringify(r.scenes)}`);
  for (const s of r.scenes) {
    t.ok(s.found, `${s.label}: a spot of that surface`);
    if (s.found) t.ok(s.surface && s.steps > 100, `${s.label}: pool on ${s.surface}, ${s.steps} flow steps`);
  }
}
