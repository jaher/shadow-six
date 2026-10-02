/**
 * A body left next to a rock or a crate stack lies still (the user, 2026-10-01: "When you leave a body close to a
 * rock it starts moving/jerking. It should not do that").
 *
 * M1 (the driveway rocks, `rocks_drv`): the Green Beret puts a body down at the rock's SW side, where its collider
 * (the 7 × 4 m nav footprint) reaches past the visible rock; a guard standing with his back to the rock is knifed.
 * M2 (the crate stack `crates1`, whose physics box is wider than the stack): the Green Beret puts a body down
 * against it, and the Driver drags one along it and lets go. For each body, from the moment it is let go (a kill:
 * once the end of his fall has eased into the settle ragdoll, 0.4 s after it starts): the settle ends within 3 s,
 * the body does not slide (≤ 5 cm), no drawn bone jumps more than 5 cm in a frame up to 0.5 s after the bake, and
 * then nothing moves at all for 3 s; it lies on the ground (its hips touch it) and not in the solid (posed mesh
 * ≤ 5 cm into it).
 * Old code: the settle ragdoll spawned inside the rock's / the crates' collider and was shoved out (a 0.25 m slide; a
 * 6 s thrash by the crates), and on the frame it settled the drawn pose popped 0.4–0.8 m (stale base pose).
 */
export const timeout = 180_000;

export default async function bodyRest(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/body-rest-page.mjs');
    const out = [];
    const tick = (n) => { for (let i = 0; i < n; i++) { g.step(); G.render(1 / 60, 1); } };
    const load = async (id) => {
      await g.loadMission(id); g.start(); await G.mapHandle?.ready; await g.clipAudit?.();
      const w = G.world;
      for (const e of w.enemies) { if (e.brain) { e.brain.update = () => {}; e.brain.frozen = true; } e.coneVisible = false; }
      for (const c of w.commandos) { c.takeDamage = () => 0; c.die = () => false; }
      return w;
    };
    /** Park everyone else away from (x, z); a soldier of the map as the victim (his model is built). */
    const stage = (w, x, z, keep) => {
      for (const e of w.enemies) if (!keep.includes(e) && Math.hypot(e.x - x, e.z - z) < 16) e.setPosition(e.x + (e.x + 30 < w.width ? 30 : -30), e.z);
      for (const c of w.commandos) if (!keep.includes(c) && Math.hypot(c.x - x, c.z - z) < 16) c.setPosition(c.x, c.z + (c.z + 25 < w.depth ? 25 : -25));
    };
    const victim = (w) => w.enemies.find((e) => e.alive && e.soldierType === 'soldier' && !e._used);
    /** Take body `b` with `c` (shoulder or drag), walk the waypoints, face `face`, let go. */
    const transport = (w, c, b, way, face) => {
      c.issue({ type: 'ability', id: 'hand', target: b });
      for (let i = 0; i < 400 && c.carrying !== b; i++) tick(1);
      for (const [x, z] of way) { c.issue({ type: 'move', x, z }); for (let i = 0; i < 900 && c.path; i++) tick(1); }
      tick(10);
      if (face != null) { c.heading = face; c.prevHeading = face; tick(5); }
      c.issue({ type: 'cancel' });
      for (let i = 0; i < 300 && b.carriedBy; i++) tick(1);
    };
    /** From now: per-frame bone moves (zoomed in: the models animate every frame), the settle ragdoll's start and
     *  bake, then 3 s at rest. */
    const watch = (w, u, name, fromRagdoll = false) => {
      let prev = H.bones(u), rdAt = null, bakeAt = null, maxStep = 0, maxAt = '', rest = 0, p0 = [u.x, u.z], p1 = null;
      for (let i = 0; i < 60 * 12; i++) {
        tick(1);
        const b = H.bones(u), s = H.step(prev, b);
        prev = b;
        if (rdAt == null && u._rd) { rdAt = i; p0 = [u.x, u.z]; }
        if (rdAt != null && bakeAt == null && !u._rd && u.settled) { bakeAt = i; p1 = [u.x, u.z]; }
        // a kill: once the end of the fall has eased into the ragdoll's pose (0.35 s, as the clips cross-fade die → dead)
        if ((!fromRagdoll || (rdAt != null && i > rdAt + 24)) && (bakeAt == null || i <= bakeAt + 30) && s > maxStep) { maxStep = s; maxAt = `${i}${rdAt == null ? '' : `/rd+${i - rdAt}`}${bakeAt == null ? '' : `/bake+${i - bakeAt}`}`; }
        if (bakeAt != null && i > bakeAt + 30) rest = Math.max(rest, s);
        if (bakeAt != null && i >= bakeAt + 210) break;
      }
      const tag = String(u.tag ?? u.id), f = (g.clip.entity(tag, { minDepth: 0.02 }).findings || []).filter((q) => q.b?.cat === 'prop' || q.b?.cat === 'rocks' || /rock|crate/.test(q.b?.id || ''));
      out.push({ name, settled: bakeAt != null, settle: bakeAt != null && rdAt != null ? +((bakeAt - rdAt) / 60).toFixed(2) : null,
        slide: p1 ? +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(3) : null, maxStep: +maxStep.toFixed(4), maxAt, rest: +rest.toFixed(5),
        contact: H.contact(w, u), inSolid: f.length ? +f[0].depth.toFixed(3) : 0, solid: f[0]?.b?.id || '', at: [+u.x.toFixed(2), +u.z.toFixed(2)] });
    };

    // ---- M1: the driveway rocks
    let w = await load('m01');
    let gb = w.commandos.find((c) => c.role === 'greenberet');
    {
      const e = victim(w); e._used = true;
      stage(w, 53, 147, [gb, e]);
      e.setPosition(50.2, 145.6, 0); await e.model?.ready; gb.setPosition(48.9, 145.6, 0); tick(10);
      e.die('knife', gb); tick(150);
      transport(w, gb, e, [[52.8, 147.0]], Math.PI / 4);
      g.setZoom(3); g.centerOn(e.x, e.z);
      watch(w, e, 'M1 rock, put down at its SW side');
    }
    {
      const e = victim(w); e._used = true;
      stage(w, 55, 152.2, [gb, e]);
      gb.setPosition(55, 154.6, -Math.PI / 2);
      e.setPosition(55, 152.2, Math.PI / 2); await e.model?.ready; tick(20);
      g.setZoom(3); g.centerOn(55, 152.5);
      e.die('knife', gb);
      watch(w, e, 'M1 rock, guard knifed with his back to it', true);
    }
    // ---- M2: the crate stack
    w = await load('m02');
    gb = w.commandos.find((c) => c.role === 'greenberet');
    const dr = w.commandos.find((c) => c.role === 'driver');
    {
      const e = victim(w); e._used = true;
      stage(w, 46.3, 50, [gb, e]);
      e.setPosition(45.6, 52.6, Math.PI / 2); await e.model?.ready; gb.setPosition(44.4, 52.6, 0); tick(10);
      e.die('knife', gb); tick(150);
      transport(w, gb, e, [[46.25, 49.75]], -Math.PI / 2);
      g.setZoom(3); g.centerOn(e.x, e.z);
      watch(w, e, 'M2 crates, put down against them');
    }
    {
      const e = victim(w); e._used = true;
      stage(w, 46, 50, [dr, e]);
      gb.setPosition(30, 60, 0);
      e.setPosition(42.4, 49.6, 0); await e.model?.ready; dr.setPosition(43.6, 49.6, Math.PI); tick(10);
      e.die('knife', dr); tick(150);
      transport(w, dr, e, [[48.6, 49.35]], null);
      g.setZoom(3); g.centerOn(e.x, e.z);
      watch(w, e, 'M2 crates, dragged along them and let go');
    }
    return out;
  });
  for (const c of r) console.log('    ' + JSON.stringify(c));
  t.ok(r.length === 4, `four bodies (${r.length})`);
  for (const c of r) {
    t.ok(c.settled && c.settle <= 3, `${c.name}: the settle ends within 3 s (${c.settle} s)`);
    t.ok(c.slide <= 0.05, `${c.name}: the body does not slide while it settles (${c.slide} m)`);
    t.ok(c.maxStep <= 0.05, `${c.name}: no drawn bone jumps more than 5 cm in a frame (${c.maxStep} m)`);
    t.ok(c.rest <= 1e-4, `${c.name}: settled, nothing moves at all (${c.rest} m per frame)`);
    t.ok(Math.abs(c.contact.hips) <= 0.06, `${c.name}: it lies on the ground (hips ${c.contact.hips} m)`);
    t.ok(c.inSolid <= 0.05, `${c.name}: not in the ${c.solid || 'solid'} (${c.inSolid} m)`);
  }
}
