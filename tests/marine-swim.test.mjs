/**
 * The Marine in the water (user 2026-10-11: "the marine under water looks strange, it should fully swim inside the
 * water (no legs out) and he should be visible clearly when under water. The swimming should look more natural."):
 *  - diving in deep water (M3 river, swimming and turning; M13 harbour): no bone and no vertex of his drawn body above
 *    the surface, none below the river bed; in the 25 cm shallows no bone above the surface (his back reaches it there;
 *    the water pass draws the surface over him);
 *  - readable under water at game zoom: his submerged body against the water round him (swim-page.mjs diverContrast:
 *    median ΔE and the number of his pixels that stand out), at day and dusk light, river and harbour;
 *  - at the surface without the gear: head out of the water; wading in the shallows: standing in the water, not on it;
 *  - the harpoon shot from under water: he comes up for it (head out), the guard falls, and he is back under after.
 */
export const timeout = 240_000;

export default async function marineSwim(page, t) {
  const r = await page.evaluate(async () => {
    const P = await import('/tests/swim-page.mjs');
    const g = window.__game, G = g.game, out = {};
    const run = (dv, n, each) => { for (let i = 0; i < n; i++) { g.step(); g.centerOn(dv.x, dv.z); G.render(1 / 60, 1); each?.(i); } };
    const diveAt = (dv, x, z, h = 0) => {
      if (dv.vehicle) dv.vehicle.exit(dv, undefined, undefined, { force: true });
      dv.setPosition(x, z, h); dv.diving = true; dv.stance = 'dive'; dv.underwater = true;
    };
    // ---------------------------------------------------------------- M3: river, shallows, surface, wading, harpoon
    await g.loadMission('m03'); g.start();
    let W = G.world; W.debug = { noDetect: true, invulnerable: true };
    let dv = W.commandos.find((c) => c.role === 'diver');
    g.select([]); g.setZoom(1);
    const deep = P.waterSpot(G, 78, 58, { kind: 'deep', room: 3 });
    diveAt(dv, deep[0], deep[1], Math.PI / 4);
    run(dv, 60);
    g.order(dv.id, { type: 'move', x: deep[0] + 7, z: deep[1] + 7 });
    const acc = (o, a) => {
      o.bone = Math.max(o.bone, a.bone); o.vert = Math.max(o.vert, a.vert);
      if (a.bone === o.bone) o.boneName = a.boneName;
      if (a.vert === o.vert) o.vertName = a.vertName;
      const b = W.terrain.surfaceAt ? Math.max(W.terrain.heightAt(a.lowX, a.lowZ), W.terrain.surfaceAt(a.lowX, a.lowZ)) : W.terrain.heightAt(a.lowX, a.lowZ);
      if (a.low - b < o.bed) { o.bed = a.low - b; o.lowName = a.lowName; }
    };
    const rd = { bone: -9, vert: -9, bed: 9, frames: 0 };
    run(dv, 150, () => {
      if (dv.path && dv.pathIndex > 0 && !rd.turned && Math.hypot(dv.x - deep[0], dv.z - deep[1]) > 4) { rd.turned = true; g.order(dv.id, { type: 'move', x: dv.x + 6, z: dv.z - 3 }); }
      acc(rd, P.bodyAbove(dv, P.levelAt(G, dv.x, dv.z))); rd.frames++;
    });
    rd.mode = dv.model._swim?.mode; rd.moving = !!dv.path;
    out.river = rd;
    out.riverSeen = P.diverContrast(G, dv, P.levelAt(G, dv.x, dv.z));
    // dusk light over the same river
    const { assets } = await import('/src/engine/assets.js');
    const def = G.missionDef;
    await G.renderer.applyMissionLighting({ theater: def.theater, lighting: { ...(def.lighting || {}), sunElevDeg: 12, sunAzimuthDeg: 250, kelvin: 3100 } }, { assets });
    run(dv, 2);
    out.duskSeen = P.diverContrast(G, dv, P.levelAt(G, dv.x, dv.z));
    await G.renderer.applyMissionLighting(def, { assets });
    // 25 cm shallows
    const sh = P.waterSpot(G, 58, 39, { kind: 'shallow', room: 0.6 });
    diveAt(dv, sh[0], sh[1], Math.PI / 4);
    g.order(dv.id, { type: 'move', x: sh[0] + 3, z: sh[1] + 3 });
    const rs = { bone: -9, vert: -9, bed: 9 };
    run(dv, 120, (i) => { if (i >= 60) acc(rs, P.bodyAbove(dv, P.levelAt(G, dv.x, dv.z))); });
    out.shallow = rs;
    // at the surface without the gear: breaststroke, head out
    dv.diving = false; dv.underwater = false;
    dv.setPosition(deep[0], deep[1], Math.PI / 4); dv.stance = 'swim';
    g.order(dv.id, { type: 'move', x: deep[0] + 6, z: deep[1] + 6 });
    let headMin = 9, swimMode = null;
    run(dv, 150, (i) => {
      if (i < 50) return;
      const lvl = P.levelAt(G, dv.x, dv.z), hp = dv.model.real.inner.bones.Head.getWorldPosition(new (dv.model.root.position.constructor)());
      headMin = Math.min(headMin, hp.y - lvl); swimMode = dv.model._swim?.mode;
    });
    out.surface = { headMin, mode: swimMode };
    // wading in the shallows (gear off, standing): his soles in the water, on its bed
    dv.stance = 'stand';
    dv.setPosition(sh[0], sh[1]);
    run(dv, 30);
    const sl = P.levelAt(G, dv.x, dv.z);
    out.wade = { sole: P.bodyAbove(dv, sl).low - sl, bed: W.terrain.heightAt(dv.x, dv.z) - sl };
    // the harpoon from under water: e14 from his blind side (M3 solution stage D)
    const e14 = W.byId('e14') || W.enemies.find((e) => e.tag === 'e14');
    diveAt(dv, 99.2, 77.4, 0);
    run(dv, 90);
    const hs = { up: -9, after: null };
    out.harpoonOrder = g.useAbility(dv.id, 'harpoon', e14.id);
    run(dv, 40, () => {
      const lvl = P.levelAt(G, dv.x, dv.z), hp = dv.model.real.inner.bones.Head.getWorldPosition(new (dv.model.root.position.constructor)());
      hs.up = Math.max(hs.up, hp.y - lvl);
    });
    run(dv, 60);
    hs.after = P.bodyAbove(dv, P.levelAt(G, dv.x, dv.z)).bone;
    hs.killed = !e14.alive;
    hs.under = dv.underwater;
    out.harpoon = hs;
    // ---------------------------------------------------------------- M13 harbour
    await g.loadMission('m13'); g.start();
    W = G.world; W.debug = { noDetect: true, invulnerable: true };
    dv = W.commandos.find((c) => c.role === 'diver');
    g.select([]); g.setZoom(1);
    const hb = P.waterSpot(G, 60, 60, { kind: 'deep', room: 4 });
    diveAt(dv, hb[0], hb[1], 0);
    g.order(dv.id, { type: 'move', x: hb[0] + 6, z: hb[1] });
    const rh = { bone: -9, vert: -9, bed: 9 };
    run(dv, 120, (i) => { if (i >= 60) acc(rh, P.bodyAbove(dv, P.levelAt(G, dv.x, dv.z))); });
    out.harbour = rh;
    out.harbourSeen = P.diverContrast(G, dv, P.levelAt(G, dv.x, dv.z));
    return out;
  });
  console.log('    [marine-swim]', JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
  const R = r.river, S = r.shallow, H = r.harbour;
  t.ok(R.mode === 'dive' && R.frames > 100, `M3 river: diving (${R.mode})`);
  t.ok(R.bone < -0.05, `M3 river, swimming and turning: every bone under the surface (highest ${R.boneName} ${R.bone.toFixed(3)} m)`);
  t.ok(R.vert < -0.02, `M3 river: every vertex of his drawn body under the surface (highest ${R.vertName} ${R.vert.toFixed(3)} m)`);
  t.ok(R.bed > 0.02, `M3 river: off the river bed (lowest, ${R.lowName}, ${R.bed.toFixed(3)} m above it)`);
  t.ok(S.bone < 0, `M3 25 cm shallows: no bone above the surface (highest ${S.boneName} ${S.bone.toFixed(3)} m)`);
  t.ok(S.bed > -0.09, `M3 shallows (25 cm: no room for a man and his gear): hardly into the bed (lowest, ${S.lowName}, ${S.bed.toFixed(3)} m)`);
  t.ok(H.bone < -0.05 && H.vert < -0.02, `M13 harbour: all of him under the surface (bone ${H.bone.toFixed(3)}, vertex ${H.vert.toFixed(3)})`);
  // readable at game zoom (zoom 1, ~70 px long): the median colour of his submerged body ≥ 8 ΔE off the water's, and
  // ≥ 120 px of him (most of his body: master showed 13-67) individually ≥ 8 ΔE off it
  for (const [k, c] of [['M3 river', r.riverSeen], ['M3 river at dusk', r.duskSeen], ['M13 harbour', r.harbourSeen]]) {
    t.ok(c.dE >= 8 && c.seen >= 120, `${k}: readable under water at game zoom (ΔE ${c.dE}, ΔL* ${c.dL}; ${c.seen} of ${c.nIn} px of him stand out)`);
  }
  t.ok(r.surface.mode === 'swim' && r.surface.headMin > 0.02, `at the surface: breaststroke with his head out (head ≥ ${r.surface.headMin.toFixed(3)} m over it)`);
  t.ok(r.wade.sole < -0.15 && r.wade.sole > r.wade.bed - 0.06, `wading: standing in the water on its bed (soles ${r.wade.sole.toFixed(3)} m, bed ${r.wade.bed.toFixed(3)} m)`);
  t.ok(r.harpoonOrder && r.harpoon.up > 0.2, `harpoon from under water: he comes up for the shot (head ${r.harpoon.up.toFixed(3)} m out)`);
  t.ok(r.harpoon.killed, 'harpoon: the guard falls');
  t.ok(r.harpoon.under && r.harpoon.after < -0.05, `harpoon: back under the surface after it (highest bone ${r.harpoon.after.toFixed(3)} m)`);
  await t.shot('marine-swim');
}
