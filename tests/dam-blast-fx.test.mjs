/**
 * M3 dam demolition reads on screen: the charge at the spillway gates on the crest (dam_charge, the raised deck the
 * very blast brings down into the river) goes up in a fireball at the deck's height, while a charge in open river
 * water stays a water column only.
 *
 * Then the reservoir pours through the breach (render/dam-breach.js), at the game camera (zoom 1, yaw 15) from 3 s to
 * 45 s after the blast. Each moment is drawn twice, with the dam water shown and hidden (same state), and compared:
 * - the TOP BAND of the fall — the gap's opening in the face, 4 m down from the crest, between the side pier stubs —
 *   is covered by water (the pixels the water changes), bright (white water) and full across its width row by row,
 *   with no empty rows from its top (where the reservoir comes in) down;
 * - the column under it runs on without a gap down to the pool;
 * - the reservoir upstream of the gap shows the flow drawn in (the funnel's slick and flow lines);
 * - strongest just after the blast and still a strong steady outflow 45 s on (the lake keeps feeding it);
 * - the reservoir has dropped and holds (art/water.js `drains`), the flow surface sits on it.
 */
export const timeout = 180_000;

export default async function damBlastFx(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, g = G.game;
    await G.loadMission('m03');
    G.start();
    for (let i = 0; i < 4; i++) { g.step(1 / 60); G.render(1 / 60, 1); } // FX scan (map-build terrain)
    const w = g.world, m = w.mission.markers.find((k) => k.id === 'dam_charge');
    const { applyExplosion } = await import('/src/abilities/explosions.js');
    const sap = w.commandos.find((c) => c.role === 'sapper');
    const fired = (x, z) => { const n0 = w.fx.items.length; applyExplosion(w, x, z, 'bomb', sap); return w.fx.items.slice(n0).map((i) => ({ kind: i.kind + (Math.hypot(i.x - x, i.z - z) < 0.5 ? '' : '@far'), y: i.opts?.y ?? null })); };
    const river = fired(70, 63); // mid-river, open water
    const crest = fired(m.x + 1, m.z + 0.3); // on the crest by the spillway gates
    for (let i = 0; i < 20; i++) { g.step(1 / 60); G.render(1 / 60, 1); }
    return { river, crest, dam: !!w.byId?.('dam')?.destroyed || w.objectives.find((o) => o.id === 'o2')?.done };
  });
  const kinds = (a) => a.map((i) => i.kind);
  t.log(`river: ${kinds(r.river).join(',')} | crest: ${r.crest.map((i) => `${i.kind}${i.y != null ? '@y' + i.y.toFixed(2) : ''}`).join(',')}`);
  t.ok(r.dam, 'the crest charge demolishes the dam');
  const fire = r.crest.find((i) => i.kind === 'explosion_large');
  t.ok(fire, 'dam charge on the crest: a fireball (not a water column in the river the crest falls into)');
  t.ok(fire && fire.y > 6.5, `the fireball goes up at the deck (y ${fire?.y})`);
  t.ok(!kinds(r.river).includes('explosion_large'), 'charge in open river water: water column only, no fireball');
  await t.shot('dam-blast-m03');

  // the torrent through the breach, over time
  const f = await page.evaluate(async () => {
    const G = window.__game, g = G.game, w = g.world;
    for (const e of w.enemies) e.coneVisible = false;
    const dam = w.mission.structures.find((s) => s.id === 'dam'), c = Math.cos(dam.rot), s = Math.sin(dam.rot);
    const W = (u, v) => [dam.x + u * c - v * s, dam.z + u * s + v * c];
    g.cameraController.setYaw(15); G.setZoom(1); G.centerOn(...W(0, 2));
    const D = g.mapHandle.damWater, cam = g.renderer.camera, canvas = g.renderer.renderer.domElement;
    const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    const grab = (show) => { D.group.visible = show; g.render(0, 1); ctx.drawImage(canvas, 0, 0); D.group.visible = true; return ctx.getImageData(0, 0, c2.width, c2.height); };
    const V3 = cam.position.constructor;
    const px = (u, y, v) => { const [x, z] = W(u, v), p = new V3(x, y, z).project(cam); return [(p.x * 0.5 + 0.5) * c2.width, (0.5 - p.y * 0.5) * c2.height]; };
    const lum = (img, k) => 0.3 * img.data[k] + 0.59 * img.data[k + 1] + 0.11 * img.data[k + 2];
    const diff = (A, B, k) => Math.abs(A.data[k] - B.data[k]) + Math.abs(A.data[k + 1] - B.data[k + 1]) + Math.abs(A.data[k + 2] - B.data[k + 2]);
    // a screen region from four world corners (u, y, v), sampled row by row: per row the share of pixels the water changes
    const region = (A, B, quad, thr = 36) => {
      const P = quad.map((q) => px(...q)), y0 = Math.round(Math.min(...P.map((p) => p[1]))), y1 = Math.round(Math.max(...P.map((p) => p[1])));
      const rows = []; let n = 0, ch = 0, l = 0;
      for (let y = y0; y <= y1; y++) {
        // the region's left / right edge at this row (the quad's sides are near vertical at yaw 15)
        const t = (y - y0) / Math.max(1, y1 - y0), xl = Math.round(P[0][0] + (P[3][0] - P[0][0]) * t), xr = Math.round(P[1][0] + (P[2][0] - P[1][0]) * t);
        let rn = 0, rc = 0;
        for (let x = xl; x <= xr; x++) {
          const k = (y * c2.width + x) * 4;
          rn++; if (diff(A, B, k) > thr) { rc++; l += lum(A, k); }
        }
        rows.push(rc / Math.max(1, rn)); n += rn; ch += rc;
      }
      let gap = 0, run = 0; for (const q of rows) { run = q < 0.3 ? run + 1 : 0; gap = Math.max(gap, run); }
      const sorted = rows.slice().sort((a, b) => a - b);
      return { cover: ch / Math.max(1, n), lum: ch ? l / ch : 0, rowMed: sorted[sorted.length >> 1], rowMin: sorted[0], gap, rows: rows.length };
    };
    const out = { at: [] };
    let el = 0; // (seconds of the dam water's own clock since the blast: the renders above ran with dt 0)
    for (const T of [3, 6, 12, 30, 45]) {
      while (el < T - 1e-6) { G.step(); g.render(1 / 60, 1); el += 1 / 60; } // (the render's dt drives the dam water + drain)
      const A = grab(true), B = grab(false);
      // top band: the gap's opening in the face (v 3.1), from the crest (y 7) 4 m down, between the side pier stubs
      const top = region(A, B, [[-1.7, 7, 3.1], [1.7, 7, 3.1], [1.7, 3, 3.1], [-1.7, 3, 3.1]]);
      // the column under it, down to the pool where it lands (the middle 2 m)
      const col = region(A, B, [[-1, 3, 3.1], [1, 3, 3.1], [1, -0.1, 6], [-1, -0.1, 6]]);
      // the reservoir drawn towards the gap: its surface in front of the mouth, seen through the gap (a subtle overlay)
      const ly = w.water?.drains?.[0]?.body?.level ?? 5.8;
      const fun = region(A, B, [[-2, ly, -6], [2, ly, -6], [2, ly, -2.4], [-2, ly, -2.4]], 10);
      const B2 = D.breach, dr = w.water?.drains?.[0];
      out.at.push({ T, top, col, fun, amt: B2.active, level: dr?.body?.level, yTop: B2.profile?.yTop, yLip: B2.profile?.yLip });
    }
    out.from = w.water?.drains?.[0]?.from;
    return out;
  });
  const fx = (x) => (x == null ? 'na' : x.toFixed(2));
  for (const a of f.at) {
    t.log(`t ${a.T}s level ${fx(a.level)} lip ${fx(a.yLip)} | top band cover ${fx(a.top.cover)} lum ${a.top.lum.toFixed(0)} rows med ${fx(a.top.rowMed)} min ${fx(a.top.rowMin)} gap ${a.top.gap}/${a.top.rows}`
      + ` | column cover ${fx(a.col.cover)} rows min ${fx(a.col.rowMin)} gap ${a.col.gap} | reservoir ${fx(a.fun.cover)}`);
  }
  const at = (T) => f.at.find((a) => a.T === T);
  for (const a of f.at) {
    t.ok(a.amt, `${a.T} s: the breach is running`);
    t.ok(a.top.cover >= 0.7, `${a.T} s: water across the top band of the fall (cover ${fx(a.top.cover)} ≥ 0.70)`);
    t.ok(a.top.lum >= 120, `${a.T} s: white water in the top band (luminance ${a.top.lum.toFixed(0)} ≥ 120)`);
    // (row by row the central pier stub hides ~15 % of the band in front of the water)
    t.ok(a.top.rowMed >= 0.6 && a.top.gap === 0, `${a.T} s: full width row by row, no empty rows (median row ${fx(a.top.rowMed)}, gap ${a.top.gap})`);
    t.ok(a.col.rowMin >= 0.6 && a.col.gap === 0, `${a.T} s: a continuous column down to the pool (narrowest row ${fx(a.col.rowMin)})`);
    t.ok(a.fun.cover >= 0.12, `${a.T} s: the reservoir drawn towards the gap (${fx(a.fun.cover)} of it changed)`);
  }
  t.ok(at(3).top.lum >= at(45).top.lum - 5 && at(3).yLip > at(45).yLip, `strongest just after the blast (lip ${fx(at(3).yLip)} → ${fx(at(45).yLip)})`);
  t.ok(at(45).top.cover >= 0.85 * at(6).top.cover, `still a strong outflow at 45 s (top band ${fx(at(45).top.cover)} vs ${fx(at(6).top.cover)} at 6 s)`);
  t.ok(f.from - at(45).level > 0.5 && at(45).level > f.from - 1.2 && Math.abs(at(45).level - at(30).level) < 0.05,
    `the reservoir drops and holds (${fx(f.from)} → ${fx(at(30).level)} → ${fx(at(45).level)})`);
  t.ok(Math.abs(at(45).yTop - at(45).level - 0.05) < 0.01, 'the flow surface sits on the reservoir (no step at its top)');
  await t.shot('dam-breach-flow-m03');
}
