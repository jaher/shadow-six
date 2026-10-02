/**
 * Mission start camera (open since 2026-09-27: "after the briefing tour ends or is skipped it stays where the tour
 * stopped — M1 framed on trees, M3 commandos off-screen"): when the mission starts, the view is on the squad —
 * the selected commando is on screen, clear of the HUD top bar (and the squad centroid when everyone fits), whether
 * the Colonel's tour is skipped at once, skipped mid-way, played to the end, or the briefing is skipped before the
 * tour. Used by tour-camera.test.mjs (M1) and tour-camera-m03.test.mjs (the three ways, 16:9 at 15°), and by
 * tour-camera-wide.test.mjs (M3 at 21:9) and tour-camera-yaw.test.mjs (M3 at 45° and 0°); split to stay well inside
 * the runner's 90 s per file.
 */
/**
 * Start each mission of `runs` ({id, how, yaw, vw:[w, h]}) and check the mission-start view.
 * Verifier 2026-09-30: at yaw 15 the M3 Green Beret stood with his feet 3 px below the HUD top bar (hidden behind the
 * portraits) at 1280x720 and 2560x1080, and at 45° commando 10 was off the right edge. "On screen" here means the
 * whole body (feet and head) clear of the screen edges AND of the top bar as the DOM lays it out.
 */
export async function tourCameraRuns(page, t, runs) {
  let size = '';
  try {
    for (const { id, how, yaw, vw } of runs) {
      if (size !== vw.join('x')) { size = vw.join('x'); await page.setViewportSize({ width: vw[0], height: vw[1] }); }
      const r = await page.evaluate(async ({ id, how, yaw }) => {
        const g = window.__game, G = g.game, hud = G.hud, b = hud.briefing;
        await g.loadMission(id);
        G.cameraRig.setYaw(yaw);
        if (!b.part) b.open(G.missionDef); // the test page may load without the briefing UI up
        const cc = G.cameraController;
        if (how !== 'skip-part1') {
          b.next(); // part 1 → the Colonel's tour
          const stops = b.stops.length;
          if (how === 'skip-mid-tour') { for (let i = 0; i < 90; i++) b.update(1 / 30); b.gotoStop(Math.min(2, stops - 1)); for (let i = 0; i < 60; i++) b.update(1 / 30); }
          if (how === 'tour-to-end') { for (let s = 0; s <= stops && b.part === 2; s++) { b.gotoStop(s); for (let i = 0; i < 45; i++) b.update(1 / 30); } }
        }
        const tourAt = { x: cc.target.x, z: cc.target.z };
        b.next(); // part 1: opens the tour, so skip again; part 2: start the mission
        if (b.part) b.next();
        g.render();
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); // the in-mission top bar laid out
        const bar = document.querySelector('.hud-topbar')?.getBoundingClientRect();
        const barBottom = bar && bar.height > 0 ? bar.bottom : 0;
        const alive = G.world.commandos.filter((c) => c.alive), sel = alive.filter((c) => c.selected);
        const clear = (c, y) => { const p = cc.worldToView(c.x, y, c.z); return p.x >= 24 && p.x <= cc.width - 24 && p.y >= barBottom + 8 && p.y <= cc.height - 24; };
        const on = (c) => clear(c, 0) && clear(c, 1.8);
        // does the whole squad fit in one view? (screen-space extent of the live commandos)
        const vs = alive.map((c) => cc.worldToView(c.x, 0, c.z));
        const fits = Math.max(...vs.map((p) => p.x)) - Math.min(...vs.map((p) => p.x)) <= cc.width - 2 * 64
          && Math.max(...vs.map((p) => p.y)) - Math.min(...vs.map((p) => p.y)) <= cc.height - barBottom - 2 * 64;
        const feet = sel.map((c) => Math.round(cc.worldToView(c.x, 0, c.z).y));
        return { barBottom, camBar: cc.hudTop, feet, state: G.state, part: b.part, sel: sel.map((c) => c.id), selOn: sel.every(on), allOn: alive.every(on), n: alive.length,
          onCount: alive.filter(on).length, fits, zoom: cc.zoomTarget, tourAt, at: { x: cc.target.x, z: cc.target.z } };
      }, { id, how, yaw });
      const tag = `${id} ${how} yaw ${yaw} ${size}`;
      t(r.barBottom > 0, `${tag}: the HUD top bar is up (bottom ${r.barBottom} px)`);
      t(Math.abs(r.camBar - r.barBottom) <= 3, `${tag}: the camera clears the bar the DOM draws (${r.camBar} vs ${r.barBottom} px)`);
      t.equal(r.state, 'playing', `${tag}: mission started`);
      t(r.sel.length >= 1, `${tag}: a commando is selected`);
      t(r.selOn, `${tag}: the selected commando is on screen, clear of the top bar (feet y ${r.feet}, bar ${r.barBottom}; camera ${r.at.x.toFixed(1)},${r.at.z.toFixed(1)})`);
      if (r.fits) t(r.allOn, `${tag}: the whole squad fits, so it is all in view (${r.onCount}/${r.n})`);
      else t.log(`${tag}: squad spread wider than the view — framed on the selected commando (${r.onCount}/${r.n} in view)`);
      t(Math.abs(r.zoom - 1) < 1e-6, `${tag}: back to the play zoom after the tour (${r.zoom})`);
    }
  } finally {
    await page.evaluate(() => window.__game.game.cameraRig.setYaw(15));
    await page.setViewportSize({ width: 1280, height: 720 });
  }
}
