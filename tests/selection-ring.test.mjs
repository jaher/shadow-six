/**
 * Selection ring = depth-tested ground decal (user bug: "the circle is overlapping the soldier; the soldier
 * should cover the circle"). Four renders of the same frame around a commando's feet (zoom 2):
 *   A selected + visible · B not selected + visible · C selected + hidden · D not selected + hidden
 * Soldier mask S = B≠D, ring mask R = C≠D. Where they overlap (the legs over the back of the ring) the final
 * frame A must show the SOLDIER (A≈B), not the ring; where only the ring is (around the feet) A must show the
 * ring (A≈C, green). Explicit samples at the legs/torso screen position must match B. (The commando casts no
 * shadow and AO is off while sampling, so S is his body, not his shadow on the ground.)
 * X-ray case (M2 barracks, commando hidden by the roof): the normal ring is occluded (x-ray off → no ring
 * pixels), the X-ray pass draws a muted ring ghost (x-ray on → ring pixels, dimmer than the open-ground ring),
 * and the (translucent) silhouette is drawn over the ghost where they overlap.
 */
export default async function selectionRing(page, t) {
  const measure = (opts) => page.evaluate(async (o) => {
    const g = window.__game, G = g.game, R = G.renderer;
    if (o.mission) { await g.loadMission(o.mission); g.start(); }
    if (o.preset) g.setPreset(o.preset);
    const w = G.world, c = w.commandos[0];
    for (const e of w.enemies) { e.brain && (e.brain.frozen = true); }
    if (o.pos) c.setPosition(o.pos[0], o.pos[1]);
    c.path = null;
    G.input.select([c]);
    G.selection.pulseT = 0.6; // the ring pulses in real time (ring-pulse.test): freeze it so the four grabs match
    g.setZoom(2);
    g.centerOn(o.center?.[0] ?? c.x, o.center?.[1] ?? c.z);
    if (R.passes.xray) R.passes.xray.enabled = o.xray !== false;
    // the masks must be the soldier's BODY: his shadow and contact AO (present in B, absent in D) are not "soldier pixels"
    const casts = [];
    c.object3d.traverse((m) => { if (m.castShadow) { casts.push(m); m.castShadow = false; } });
    const ao = R.passes.ao, aoOn = ao?.enabled;
    if (ao) ao.enabled = false;
    // x-ray occlusion-query results land only after the page yields: a few frames with a pause between them
    for (let i = 0; i < 4; i++) { G.render(0, 1); await new Promise((res) => setTimeout(res, 40)); }
    G.render(0, 1);
    const ghostArmed = !!G.selection.rings[0]?.children[0]?.visible;
    const gl = R.renderer.getContext(), rect = R.domElement.getBoundingClientRect();
    const k = gl.drawingBufferWidth / R.domElement.clientWidth;
    const toBuf = (x, y, z) => { const s = G.cameraController.worldToScreen(x, y, z); return [Math.round((s.x - rect.left) * k), Math.round(gl.drawingBufferHeight - (s.y - rect.top) * k)]; };
    const o3 = c.object3d.position;
    const [fx, fy] = toBuf(o3.x, o3.y, o3.z);
    const H = Math.round(70 * k), W = 2 * H, x0 = fx - H, y0 = fy - H;
    const grab = (sel, vis) => {
      c.selected = sel;
      c.object3d.visible = vis;
      G.render(0, 1);
      const px = new Uint8Array(W * W * 4);
      R.renderer.setRenderTarget(null);
      gl.readPixels(x0, y0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const A = grab(true, true), B = grab(false, true), C = grab(true, false), D = grab(false, false);
    c.selected = true; c.object3d.visible = true;
    for (const m of casts) m.castShadow = true;
    if (ao) ao.enabled = aoOn;
    if (R.passes.xray) R.passes.xray.enabled = true;
    G.selection.pulseT = null;
    const d = (P, Q, i) => Math.abs(P[i] - Q[i]) + Math.abs(P[i + 1] - Q[i + 1]) + Math.abs(P[i + 2] - Q[i + 2]);
    let overlap = 0, soldierWins = 0, soldierOnTop = 0, ringOnly = 0, ringShown = 0, sr = 0, sg = 0, sb = 0;
    // soldier mask eroded by 1 px: silhouette-edge pixels are anti-aliased mixes of soldier and background
    const inS = (i) => i >= 0 && i < W * W * 4 && d(B, D, i) > 40;
    const NB = [-4, 4, -W * 4, W * 4, -W * 4 - 4, -W * 4 + 4, W * 4 - 4, W * 4 + 4];
    for (let i = 0; i < W * W * 4; i += 4) {
      const S = inS(i) && NB.every((dd) => inS(i + dd)), Rg = d(C, D, i) > 40;
      if (inS(i) && !S) continue;
      if (S && Rg) { overlap++; if (d(A, B, i) < 30 && d(A, B, i) < d(A, C, i)) soldierWins++; if (d(A, B, i) < d(A, C, i)) soldierOnTop++; }
      else if (Rg) {
        ringOnly++;
        if (d(A, C, i) < 30) { ringShown++; sr += A[i]; sg += A[i + 1]; sb += A[i + 2]; }
      }
    }
    // explicit samples on the legs: 0.1–0.6 m above the feet, ±0.05–0.2 m along the camera's right axis
    const cr = [R.camera.matrixWorld.elements[0], R.camera.matrixWorld.elements[2]];
    const cl = Math.hypot(cr[0], cr[1]) || 1;
    const samples = [];
    for (const h of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.0]) {
      for (const s of [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2]) {
        const [x, y] = toBuf(o3.x + (cr[0] / cl) * s, o3.y + h, o3.z + (cr[1] / cl) * s);
        if (x < x0 + 1 || x >= x0 + W - 1 || y < y0 + 1 || y >= y0 + W - 1) continue;
        const i = ((y - y0) * W + (x - x0)) * 4;
        const soldier = inS(i) && NB.every((dd) => inS(i + dd));
        if (soldier) samples.push({ h, s, ring: d(C, D, i) > 40, aVsB: d(A, B, i), aVsC: d(A, C, i) });
      }
    }
    const n = Math.max(1, ringShown);
    return {
      overlap, soldierWins, soldierOnTop, ringOnly, ringShown, ringMean: [sr / n, sg / n, sb / n].map(Math.round), samples,
      xrayDrawn: R.passes.xray?.drawn ?? null, ghostArmed, footY: +o3.y.toFixed(3),
      decal: G.selection.group.parent === R.decalScene, overlayRings: R.overlayScene.getObjectByName('selection-ring') ? 1 : 0,
    };
  }, opts);

  // --- open ground (M1 snow) --------------------------------------------------------------------------
  const open = await measure({ mission: 'm01' });
  t.log(`open: ${JSON.stringify(open)}`);
  t(open.decal, 'selection group lives in Renderer.decalScene');
  t.equal(open.overlayRings, 0, 'no selection ring in the after-post overlay scene');
  t(open.overlap >= 20, `the legs overlap the ring on screen at zoom 2 (${open.overlap} px)`);
  t(open.soldierWins >= 0.9 * open.overlap, `soldier pixels drawn over the ring where they overlap (${open.soldierWins}/${open.overlap})`);
  t(open.ringShown >= 150 && open.ringShown >= 0.85 * open.ringOnly, `ring visible around the feet (${open.ringShown}/${open.ringOnly} px)`);
  const [r, gr, b] = open.ringMean;
  t(gr > 190 && gr > r + 40 && gr > b + 50, `ring reads bright green after tone mapping + LUT (${open.ringMean})`);
  const onRing = open.samples.filter((s) => s.ring);
  t(onRing.length >= 1, `legs samples that lie on the ring: ${onRing.length}`);
  for (const s of onRing) t(s.aVsB < 30, `legs pixel (${s.h} m up, ${s.s} m right) shows the soldier, not the ring (|A−B| ${s.aVsB}, |A−C| ${s.aVsC})`);
  t(!open.ghostArmed, 'commando in plain view: no x-ray ghost armed under his ring');
  const torso = open.samples.filter((s) => s.h === 1.0);
  t(torso.length >= 1 && torso.every((s) => s.aVsB < 30), 'torso pixels unchanged by the selection');

  // --- M1 pier (catalogue 'pier' = library jetty, no grid bridge cells): feet and ring on the planks -------------
  const pier = await measure({ pos: [42, 39] });
  t.log(`pier: ${JSON.stringify(pier)}`);
  t(pier.footY > 0.27, `commando stands on the pier deck, not ~7 cm under the planks (feet y ${pier.footY})`);
  t(pier.ringShown >= 150 && pier.ringShown >= 0.85 * pier.ringOnly, `ring visible on the pier deck (${pier.ringShown}/${pier.ringOnly} px)`);
  t(pier.overlap === 0 || pier.soldierWins >= 0.9 * pier.overlap, `pier: soldier drawn over the ring (${pier.soldierWins}/${pier.overlap})`);

  // --- X-ray: commando hidden by the M2 barracks roof ----------------------------------------------------
  const base = { mission: 'm02', preset: 'high', pos: [38, 19.6], center: [38, 22] };
  const off = await measure({ ...base, xray: false });
  const on = await measure({ pos: base.pos, center: base.center });
  t.log(`xray off: ${JSON.stringify(off)}`);
  t.log(`xray on: ${JSON.stringify(on)}`);
  t(off.ringShown <= 20, `hidden commando: the depth-tested ring is occluded by the roof (${off.ringShown} px)`);
  t(on.xrayDrawn >= 1, 'x-ray pass drew silhouettes');
  t(on.ghostArmed, 'commando hidden by the roof: his ring ghost is armed (occlusion query)');
  t(on.ringShown >= 150, `hidden commando: the selection stays visible through the x-ray pass (${on.ringShown} px)`);
  const [xr, xg, xb] = on.ringMean;
  t(xg >= xr && xg > xb, `x-ray ring ghost is green (${on.ringMean})`);
  t(xg < gr || xr > r, `x-ray ring ghost is muted vs the open-ground ring (${on.ringMean} vs ${open.ringMean})`);
  // the silhouette is translucent (matcap alpha ≥ 0.75): the ghost shows faintly through it, but the silhouette is on top
t(on.overlap === 0 || on.soldierOnTop >= 0.9 * on.overlap, `silhouette drawn over the ghost ring (${on.soldierOnTop}/${on.overlap})`);
}
