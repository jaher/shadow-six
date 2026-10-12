/**
 * Visible fish (GPU). User: "You can add some fish in the water too" (the fish were there, too deep / dark / few
 * to be seen). At game zoom 1 the fish of M1 must change a noticeable number of pixels (frame with the fish meshes
 * and their bed shadows vs without); species per theatre (M1 fjord sprat shoals, M2 Norway river salmon + minnows,
 * M15 lowland lake carp / pike / roach, M12 Tunis harbour mullet + bream); a river shows leaps over a minute; a
 * swimmer scatters a shoal; the director stays cheap.
 */
export const timeout = 300000;

export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const load = async (id) => { await g.loadMission(id); g.start(); g.advance(1); G.render(1 / 60, 1); return G.mapHandle.life; };
    const species = (L) => [...new Set((L?.fish?.fish || []).map((f) => f.sp))].sort();
    // M1: visibility at zoom 1 on the biggest shoal, median of 5 samples 2 s apart
    let L = await load('m01');
    out.m01 = species(L);
    const el = document.getElementById('hud'); if (el) el.style.visibility = 'hidden';
    for (let k = 0; k < 120; k++) { g.advance(1 / 30); G.render(1 / 30, 1); }
    const S = [...L.fish.schools].sort((a, b) => b.members.length - a.members.length)[0];
    G.cameraController.setZoom(1); G.cameraController.centerOn(S.cx, S.cz);
    const R = G.renderer, gl = R.renderer.getContext(), W = R.renderer.domElement.width, H = R.renderer.domElement.height;
    const grab = () => { G.render(0, 1); const a = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
    const ms = []; L.meshes[0]?.traverse((o) => { if (/^fish/.test(o.userData?.ambientLife || '')) ms.push(o); });
    const px = [];
    for (let s = 0; s < 5; s++) {
      for (let k = 0; k < 120; k++) { g.advance(1 / 60); G.render(1 / 60, 1); }
      const a = grab(); for (const m of ms) m.visible = false; const b = grab(); for (const m of ms) m.visible = true;
      // pixels the fish change plainly (sum of |ΔR| + |ΔG| + |ΔB| over 45 of 765): master had ~410 at zoom 1 here
      let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 45) n++;
      px.push(n);
    }
    px.sort((x, y) => x - y); out.px = px[2]; out.shoal = `${S.sp}:${S.members.length}`;
    // a swimmer through the shoal scatters it
    const M = G.world.commandos.find((u) => u.role === 'diver') || G.world.commandos[0];
    const S2 = [...L.fish.schools].sort((a, b) => b.members.length - a.members.length)[0];
    let scared = 0;
    for (let k = 0; k < 120; k++) { M.x = S2.cx - 3 + k * 0.05; M.z = S2.cz; M.stance = 'swim'; g.advance(1 / 60); G.render(1 / 60, 1); scared = Math.max(scared, L.fish.stats.scared); }
    out.scared = scared;
    let ms0 = 0; for (let k = 0; k < 60; k++) { g.advance(1 / 60); const t0 = performance.now(); L.frame(1 / 60, R.camera); ms0 += performance.now() - t0; }
    out.ms = ms0 / 60; out.fish = L.fish.fish.length;
    // M2 (Norway river): salmon and minnows; leaps over a minute of sim time
    L = await load('m02');
    out.m02 = species(L);
    for (let k = 0; k < 60 * 20; k++) g.advance(1 / 20), L.frame(1 / 20, R.camera);
    out.jumps = L.fish.stats.jumps;
    L = await load('m15'); out.m15 = species(L);
    L = await load('m12'); out.m12 = species(L);
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.m01?.includes('sprat') && r.m01.includes('herring') && r.m01.includes('cod'), `M1 fjord ${r.m01}`);
  t.ok(r.px > 700, `M1 fish plainly visible at zoom 1: ${r.px} px changed (${r.shoal}; master ~410)`);
  t.ok(r.scared > 10, `a swimmer scatters the shoal (${r.scared} scared)`);
  t.ok(r.ms < 1.5, `director ${r.ms?.toFixed(3)} ms for ${r.fish} fish`);
  t.ok(r.m02?.includes('salmon') && r.m02.includes('minnow') && r.m02.includes('trout'), `M2 river ${r.m02}`);
  t.ok(r.jumps >= 1, `leaps in a minute on M2 (${r.jumps})`);
  t.ok(['carp', 'pike', 'roach', 'perch'].every((s) => r.m15?.includes(s)), `M15 lowland lakes ${r.m15}`);
  t.ok(r.m12?.includes('mullet') && r.m12.includes('bream'), `M12 Tunis harbour ${r.m12}`);
}
