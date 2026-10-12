/**
 * Breakable gates stand on the ground (regression: clipping seed 11, M2 `e15 × gate:gate_se 0.065 m @t=163s`).
 * The gate model's moving parts (a boom's pole with its HALT plate and counterweight, plank / wire leaves) are no
 * walking surface (art/breakable-gates.js sets `userData.surface = false` on its leaves; world/placement-visual.js
 * lowSurfaces leaves them out). Before, the HALT plate's underside under the shut boom (0.66 m) read as ground at the
 * gate centre: the model (render/gate-smash-visuals.js `_seat`) and its physics frame were seated 0.66 m up, the posts
 * stretched down to the terrain (the fork rest reached 1.9 m, the rules' body solid says 1.07 m), and a man passing
 * under an open boom stepped up onto the plate.
 *   - M2 gate_se (shut) and the M4 booms (open): the model root and the physics frame on the terrain at the centre;
 *     the fork rest no taller than its layout; world.groundY under the boom line and along M2's footway is the terrain;
 *   - M2 e15 where seed 11 left him (58.084, 47.706, beside the fork rest outside the gate), aiming at −159° across it
 *     with his step-back allowance spent (as in that run): no part of him in the gate.
 */
export const timeout = 300_000;

/** Page side: load `id`, measure its breakable gates; M2 also stages e15's seed-11 aim. */
async function measure(page, id) {
  return page.evaluate(async (id) => {
    const g = window.__game, G = g.game;
    await g.loadMission(id); g.start(); await G.mapHandle?.ready;
    const THREE = await import('three');
    const { isBreakableGate, layoutOf } = await import('/src/world/breakables.js');
    const { lowSurfaces } = await import('/src/world/placement-visual.js');
    const W = G.world, T = W.terrain, bare = (x, z) => (T?.groundY ? T.groundY(x, z) : 0), r3 = (v) => Math.round(v * 1000) / 1000;
    const out = { gates: [] };
    G.renderer.scene.updateMatrixWorld(true);
    for (const s of W.structures.values()) {
      const d = s.def;
      if (s.type !== 'gate' || !isBreakableGate(d) || !s.object3d) continue;
      const L = layoutOf(d), rot = d.rot ?? 0, tx = Math.cos(rot), tz = Math.sin(rot), at = (u, v) => [d.x + u * tx - v * tz, d.z + u * tz + v * tx];
      const g0 = bare(d.x, d.z), root = s.object3d.getWorldPosition(new THREE.Vector3());
      const box = (pid) => { let m = null; s.object3d.traverse((n) => { if (n.name === `gate-piece:${pid}`) m = n; }); return m ? new THREE.Box3().setFromObject(m) : null; };
      const rest = box('post1'), pivot = box('post0');
      // walking surface under the boom line (clear of the posts' footings) and, beside a wall opening, along the footway
      // (there the fork rest's 0.12 m concrete footing is a real step for a boot beside it)
      const probe = (S, u, v) => { const [x, z] = at(u, v), dy = (W.groundY ? W.groundY(x, z) : 0) - bare(x, z); if (dy > S.dy) { S.dy = r3(dy); S.at = [r3(u), r3(v)]; } };
      const boom = { dy: 0, at: null }, foot = { dy: 0, at: null };
      // (the middle of the road: M4's gatehouse steps stand by gate_outer's ends)
      for (let u = -Math.min(1.0, L.w / 2 - 0.6); u <= Math.min(1.0, L.w / 2 - 0.6) + 1e-6; u += 0.1) for (const v of [-0.3, 0, 0.3]) probe(boom, u, v);
      // the model's own walking surfaces (placement-visual lowSurfaces, as map-builder takes them): its posts' footings only
      const surf = [...lowSurfaces(s.object3d, { maxY: 0.8, cell: 0.2 }).values()].map((y) => y - g0);
      if (L.footway) for (let u = L.footway[0] + 0.35; u <= L.footway[1] - 0.35 + 1e-6; u += 0.1) for (const v of [-0.3, 0, 0.3]) probe(foot, u, v);
      const pg = W.physics?.gates?.byKey?.(String(d.id));
      out.gates.push({ id: d.id, open: !!W.interactables.find((i) => i.tag === d.id)?.open, ground: r3(g0), rootY: r3(root.y - g0),
        frameY: pg?.F ? r3(pg.F.y - g0) : null, restTop: rest ? r3(rest.max.y - g0) : null,
        restLayout: r3(L.pieces.find((p) => p.id === 'post1').c[1] + L.pieces.find((p) => p.id === 'post1').h[1] + 0.17),
        pivotTop: pivot ? r3(pivot.max.y - g0) : null, boom, foot: L.footway ? foot : null, surfTop: r3(Math.max(0, ...surf)) });
    }
    if (id === 'm02') {
      // e15 as the seed-11 dynamic run left him at 163 s: standing in COMBAT beside gate_se's fork rest, outside the gate,
      // aiming at −159° (across the fork rest into the camp); his 0.6 m step-back allowance for this aim was spent
      // (0.56 m) by the turns before, so he stays put
      await g.clipAudit();
      if (W.alarm) W.alarm.fireEvent = () => {};
      const H = await import('/tests/bodies-page.mjs');
      for (const e of W.enemies) H.freeze(e);
      const e = W.enemies.find((q) => q.tag === 'e15');
      for (const c of W.commandos) c.setPosition(Math.min(W.width - 3, 75), 95);
      e.setPosition(58.084, 47.706); e.heading = (-159 * Math.PI) / 180; e.idleAnim = 'aim';
      let worst = null;
      for (let k = 0; k < 24; k++) {
        e._weaponBack = 0.6; e.heading = (-159 * Math.PI) / 180;
        H.run(g, G, 5, 5);
        const f = window.__game.clip.entity('e15', { dt: 0, minDepth: 0.01 }).findings.filter((q) => q.b.id === 'gate_se')[0];
        if (f && (!worst || f.depth > worst.depth)) worst = { depth: f.depth, point: f.point };
      }
      out.e15 = { anim: e._anim, at: [r3(e.x), r3(e.z)], heading: Math.round((e.heading * 180) / Math.PI), worst };
    }
    return out;
  }, id);
}

export default async function gateSeat(page, t) {
  for (const id of ['m02', 'm04']) {
    const r = await measure(page, id);
    t.log(id, JSON.stringify(r));
    t.ok(r.gates.length >= (id === 'm02' ? 1 : 3), `${id}: breakable gates found (${r.gates.map((q) => q.id)})`);
    for (const q of r.gates) {
      t.ok(Math.abs(q.rootY) < 0.03, `${id} ${q.id}: the model stands on the ground at its centre (${q.rootY} m off)`);
      if (q.frameY != null) t.ok(Math.abs(q.frameY) < 0.03, `${id} ${q.id}: its physics frame too (${q.frameY} m)`);
      t.ok(q.restTop != null && q.restTop < q.restLayout + 0.05, `${id} ${q.id}: the fork rest is as tall as its layout (${q.restTop} m, layout ${q.restLayout} m)`);
      t.ok(q.surfTop < 0.15, `${id} ${q.id}: its moving parts and post bands are no ground (highest surface of the model ${q.surfTop} m: the footings)`);
      t.ok(q.boom.dy < 0.03, `${id} ${q.id}: no step up under the boom (${q.boom.dy} m at ${JSON.stringify(q.boom.at)})`);
      if (q.foot) t.ok(q.foot.dy < 0.15, `${id} ${q.id}: none in the footway higher than the fork rest's footing (${q.foot.dy} m at ${JSON.stringify(q.foot.at)})`);
    }
    if (r.e15) {
      t.ok(r.e15.anim === 'aim' && Math.hypot(r.e15.at[0] - 58.084, r.e15.at[1] - 47.706) < 0.01, `e15 aims where seed 11 left him (${JSON.stringify(r.e15)})`);
      t.ok(!r.e15.worst || r.e15.worst.depth <= 0.02, `e15 aiming across the fork rest stays out of gate_se (${r.e15.worst ? `${r.e15.worst.depth} m at ${JSON.stringify(r.e15.worst.point)}` : 'no contact'})`);
    }
  }
}
