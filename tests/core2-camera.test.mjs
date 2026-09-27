/**
 * CORE2 camera (design-spec §2.1–§2.3): 40 CSS px/m at 1×, zoom tweens (cursor-anchored wheel,
 * centre-fixed keys), edge scroll (incl. over the HUD) and arrows at 30 m/s ÷ zoom, bounds, recentre
 * rules, tracking camera + badge, multi-view F2–F7 layouts with the red active frame.
 */
export default async function core2Camera(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    const G = g.game;
    const rig = G.cameraRig;
    const out = {};
    const cam = () => G.cameraController;
    // --- §2.1 projection: pitch 40°, yaw 0
    const off = cam().viewOffset();
    out.offset = [off.x, off.y, off.z].map((v) => +v.toFixed(4));
    // --- §2.2 scale in CSS px per metre
    out.scale = {};
    for (const z of [0.5, 1, 2]) {
      g.setZoom(z);
      g.centerOn(30, 30);
      const a = cam().worldToScreen(30, 0, 30), b = cam().worldToScreen(31, 0, 30);
      out.scale[z] = +(b.x - a.x).toFixed(3);
    }
    // --- wheel-style zoom keeps the ground under the cursor; it tweens over 0.25 s
    g.setZoom(1);
    g.centerOn(30, 30);
    const cr = G.renderer.domElement.getBoundingClientRect();
    const px = cr.left + cr.width * 0.7, py = cr.top + cr.height * 0.4;
    const g0 = cam().screenToGround(px, py);
    cam().zoomStep(1, px, py);
    rig.update(0.1);
    out.midZoom = cam().zoom;
    for (let i = 0; i < 5; i++) rig.update(0.05);
    const g1 = cam().screenToGround(px, py);
    out.anchor = { zoom: cam().zoom, drift: Math.hypot(g1.x - g0.x, g1.z - g0.z) };
    // keys: centre fixed
    const c0 = { x: cam().target.x, z: cam().target.z };
    cam().zoomStep(-1);
    for (let i = 0; i < 6; i++) rig.update(0.05);
    out.keyZoom = { zoom: cam().zoom, drift: Math.hypot(cam().target.x - c0.x, cam().target.z - c0.z) };
    cam().zoomStep(1); for (let i = 0; i < 6; i++) rig.update(0.05);
    cam().zoomReset(); for (let i = 0; i < 6; i++) rig.update(0.05);
    out.reset = cam().zoom;
    // --- §2.3 edge scroll: 30 m/s ÷ zoom, also over the HUD; arrows same speed
    g.setZoom(2);
    g.centerOn(30, 30);
    rig.setPointer(2, cr.height / 2, true, false); // left edge, pointer over a HUD panel
    rig.update(0.5);
    out.edgeDx = +(cam().target.x - 30).toFixed(3);
    rig.setPointer(cr.width / 2, cr.height / 2, true, true);
    g.centerOn(30, 30);
    G.input.held.add('ArrowDown');
    rig.update(0.5);
    G.input.held.delete('ArrowDown');
    out.arrowDz = +(cam().target.z - 30).toFixed(3);
    rig.edgeOverHud = false; // the modern option
    g.centerOn(30, 30);
    rig.setPointer(2, cr.height / 2, true, false);
    rig.update(0.5);
    out.modernDx = +(cam().target.x - 30).toFixed(3);
    rig.edgeOverHud = true;
    rig.setPointer(cr.width / 2, cr.height / 2, false, false);
    // bounds: never more than 4 m past the edge
    g.setZoom(1);
    g.centerOn(-100, -100);
    out.fp = cam().groundFootprint(0).map((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]);
    // --- recentre rules
    const w = G.world;
    const [gb, sn] = w.commandos;
    g.setZoom(2);
    g.centerOn(50, 10); // commandos (SW) are off-screen
    G.input.deselectAll();
    G.input.selectUnit(gb);
    for (let i = 0; i < 8; i++) rig.update(0.05);
    out.recentreOff = Math.hypot(cam().target.x - gb.x, cam().target.z - gb.z);
    g.centerOn(sn.x + 3, sn.z - 2); // sniper on-screen, not selected
    const t0 = { x: cam().target.x, z: cam().target.z };
    G.input.selectUnit(sn);
    for (let i = 0; i < 8; i++) rig.update(0.05);
    out.onScreenMoved = Math.hypot(cam().target.x - t0.x, cam().target.z - t0.z);
    G.input.selectUnit(sn); // already selected → always recentres
    for (let i = 0; i < 8; i++) rig.update(0.05);
    out.againDist = Math.hypot(cam().target.x - sn.x, cam().target.z - sn.z);
    // a map click on a commando never recentres
    g.centerOn(gb.x + 3, gb.z - 2);
    const t1 = { x: cam().target.x, z: cam().target.z };
    const sp = cam().worldToScreen(gb.x, 0.9, gb.z);
    G.input.click(sp.x, sp.y);
    G.input._lastClick = null;
    for (let i = 0; i < 8; i++) rig.update(0.05);
    out.mapClickMoved = Math.hypot(cam().target.x - t1.x, cam().target.z - t1.z);
    // --- tracking camera
    const patrol = w.enemies.find((e) => e.route) || w.enemies[0];
    g.setZoom(2);
    cam().track(patrol);
    const p0 = { x: patrol.x, z: patrol.z };
    g.advance(4);
    rig.update(0.016);
    // the tracked target may only differ from the unit where the map bounds clamp it
    const ex = cam().viewHalfExtents(), b = cam().bounds;
    const cx = Math.min(Math.max(patrol.x, b.minX + ex.x), b.maxX - ex.x), cz = Math.min(Math.max(patrol.z, b.minZ + ex.z), b.maxZ - ex.z);
    out.track = { d: Math.hypot(cam().target.x - cx, cam().target.z - cz), moved: Math.hypot(patrol.x - p0.x, patrol.z - p0.z), at: [patrol.x, patrol.z] };
    const badge = document.querySelector('.view-track-badge');
    out.badge = !!badge && badge.style.display === 'block';
    badge?.click();
    rig.update(0.016);
    out.untracked = cam().tracking === null && badge.style.display === 'none';
    return out;
  });
  t.log(JSON.stringify(r));
  t.near(r.offset[1], Math.sin((40 * Math.PI) / 180), 1e-3, 'pitch 40° (y = sin 40°)');
  t.near(r.offset[0], 0, 1e-6, 'yaw 0 (no x component)');
  t.near(r.scale[1], 40, 0.01, '1× = 40 CSS px/m');
  t.near(r.scale[2], 80, 0.01, '2× = 80 CSS px/m');
  t.near(r.scale[0.5], 20, 0.01, '0.5× = 20 CSS px/m');
  t(r.midZoom > 1 && r.midZoom < 2, `zoom tweens (mid ${r.midZoom})`);
  t.equal(r.anchor.zoom, 2, 'wheel step reaches 2×');
  t(r.anchor.drift < 0.05, `ground under the cursor stays fixed (drift ${r.anchor.drift})`);
  t.equal(r.keyZoom.zoom, 1, 'key zoom out');
  t(r.keyZoom.drift < 1e-6, 'key zoom keeps the screen centre');
  t.equal(r.reset, 1, 'numpad * returns to 1×');
  t.near(r.edgeDx, -7.5, 0.01, 'edge scroll 30 m/s ÷ 2 over the HUD (0.5 s → 7.5 m)');
  t.near(r.arrowDz, 7.5, 0.01, 'arrow keys: same speed');
  t.equal(r.modernDx, 0, 'modern option: no edge scroll over the HUD');
  for (const [x, z] of r.fp) t(x >= -4.05 && z >= -4.05, `bounds: corner (${x},${z}) within 4 m of the map`);
  t(r.recentreOff < 0.05, `selecting an off-screen man recentres (${r.recentreOff})`);
  t(r.onScreenMoved < 1e-6, 'selecting an on-screen man does not recentre');
  t(r.againDist < 0.05, 'selecting an already-selected man recentres');
  t(r.mapClickMoved < 1e-6, 'a map click never recentres');
  t(r.track.d < 0.05 && r.track.moved > 0.5, `tracking view follows the unit (${r.track.d}, moved ${r.track.moved})`);
  t(r.badge, 'tracking badge shown in the lower-left');
  t(r.untracked, 'clicking the badge releases tracking');

  // --- multi-view F2–F7 (real key presses) + red active frame + screenshot
  await page.evaluate(() => { const G = window.__game.game; G.world.enemies.forEach((e) => window.__game.setCone(e.id, true)); });
  await page.mouse.click(640, 360);
  await page.keyboard.press('F5');
  const mv = await page.evaluate(() => {
    const G = window.__game.game;
    const rig = G.cameraRig;
    const a = { count: rig.count, layout: rig.layout, rects: rig.rects() };
    const pts = [[12, 46], [47, 30], [30, 15], [45, 45]];
    rig.views.forEach((v, i) => { v.setZoom([1, 2, 0.5, 1][i]); v.centerOn(...pts[i]); });
    rig.activate(1);
    G.render(0.016, 1);
    const f = document.querySelector('.view-active-frame');
    const cs = getComputedStyle(f);
    return { a, frame: { display: cs.display, border: cs.borderTopWidth, color: cs.borderTopColor, left: parseFloat(f.style.left), w: parseFloat(f.style.width) }, zooms: rig.views.map((v) => v.zoom) };
  });
  await t.shot('core2-multiview-4');
  await page.keyboard.press('F5');
  const cyc = await page.evaluate(() => ({ layout: window.__game.game.cameraRig.layout, rects: window.__game.game.cameraRig.rects() }));
  await page.keyboard.press('F3');
  const two = await page.evaluate(() => window.__game.game.cameraRig.count);
  // clicking an inactive view activates it
  await page.mouse.click(100, 360);
  const act = await page.evaluate(() => window.__game.game.cameraRig.activeIndex);
  await page.keyboard.press('F2');
  const one = await page.evaluate(() => ({ count: window.__game.game.cameraRig.count, frame: document.querySelector('.view-active-frame').style.display, url: location.href }));
  t.log(JSON.stringify({ mv, cyc, two, act, one }));
  t.equal(mv.a.count, 4, 'F5 → 4 views');
  t.equal(mv.a.rects[3].x, 640, '2×2 grid');
  t.equal(mv.frame.display, 'block', 'active view has a frame');
  t.equal(mv.frame.border, '2px', '2 px frame');
  t.equal(mv.frame.color, 'rgb(220, 0, 0)', 'red frame');
  t.equal(mv.frame.left, 640, 'frame around the active view');
  t.equal(cyc.layout, 1, 'repeating F5 cycles to 1 big + 3');
  t(cyc.rects[0].w > cyc.rects[1].w, 'big view first');
  t.equal(two, 2, 'F3 → 2 views');
  t.equal(act, 0, 'click activates the view under the pointer');
  t.equal(one.count, 1, 'F2 → 1 view');
  t.equal(one.frame, 'none', 'no frame with a single view');
  t(one.url.includes('test=1'), 'F5 did not reload the page');
}
