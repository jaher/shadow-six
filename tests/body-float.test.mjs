/**
 * Dead soldiers lie on the ground as it is drawn (the user, 2026-10-08: "bodies of dead soldiers are still floating on
 * the ground"; before, 2026-10-01: "When doing the tutorial I see bodies kind of floating above the ground when
 * killed"). Guards of the maps themselves are killed the ways the game kills them — the Green Beret's knife from the
 * front and from behind (the contact kill: he falls on his face), a pistol, the sniper rifle, a bear trap and a grenade
 * — in the tutorial (m00: road, compound, bridge end) and on M1's snow (slopes up to 24°, a plinth's edge, flat
 * snow), on a mission's first load, after an instant restart (the same mission loaded again) and after another mission
 * was played in between (m01 → m00 → m01). Once each body has settled, every part of the drawn body — hips, chest,
 * head, hands and feet: the lowest skinned vertex of each, his belt kit left out — is on the RENDERED ground under it
 * (the terrain mesh drawn from above into a depth target, its trail / melt / crater displacement included; a deck or a
 * step where one stands over it): within 3.5 cm above it, and no more than 7 cm into it.
 * Old code: a rifleman on his back lay rigid in the air on his bread bag and canteen (kit 15–20 cm under his back:
 * chest 15–39 cm, head 12–27 cm, hands 8–26 cm over the ground), his head propped up by the death clip's bent neck,
 * and by a plinth or a step on the snow his legs fell through the physics heightfield (0.6–1.1 m into the ground).
 * Saves tests/out/body-float.png (side view of the last body on M1's slope: the terrain and the body only).
 */
export const timeout = 420_000;

export default async function bodyFloat(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/body-float-page.mjs');
    const Pj = await import('/src/entities/projectile.js');
    const out = [], shots = [];
    const tick = (n) => { for (let i = 0; i < n; i++) { g.step(); G.render(1 / 60, 1); } };
    const load = async (id) => {
      await g.loadMission(id); g.start(); await G.mapHandle?.ready;
      const w = G.world;
      for (const e of w.enemies) { if (e.brain) { e.brain.update = () => {}; e.brain.frozen = true; } e.coneVisible = false; }
      for (const c of w.commandos) { c.takeDamage = () => 0; c.die = () => false; }
      return w;
    };
    /** Kill guard `e` standing at (x, z) facing `h` by `how`; once he has settled, the gaps of his drawn body. */
    const kill = (w, phase, e, x, z, h, how) => {
      const gb = w.commandos.find((c) => c.role === 'greenberet'), sn = w.commandos.find((c) => c.role === 'sniper') || gb;
      const sp = w.commandos.find((c) => c.role === 'sapper') || gb;
      // everyone else out of the way
      for (const c of w.commandos) if (c !== gb) c.setPosition(Math.min(w.width - 3, x + 12), Math.min(w.depth - 3, z + 3), 0);
      for (const o of w.enemies) if (o !== e && o.alive && Math.hypot(o.x - x, o.z - z) < 6) o.setPosition(o.x + (o.x + 12 < w.width ? 12 : -12), o.z);
      e.setPosition(x, z, h);
      gb.setPosition(x - Math.cos(h) * 7, z - Math.sin(h) * 7 + 2, h);
      g.setZoom(2); g.centerOn(x, z); tick(20);
      let contact = null;
      if (how === 'knife-front' || how === 'knife-behind') {
        const s = how === 'knife-front' ? 1 : -1;
        gb.setPosition(x + s * Math.cos(h) * 2.4, z + s * Math.sin(h) * 2.4, h + (s > 0 ? Math.PI : 0)); tick(3);
        gb.issue({ type: 'ability', id: 'knife', target: e });
        let rec = null;
        for (let i = 0; i < 900 && e.alive; i++) { tick(1); rec ||= (w.knifeKills || []).find((k) => k.v === e) || null; }
        contact = !e.alive && !!rec; // killed by the knife order, the contact kill drawn
        if (e.alive) e.die('knife', gb);
      } else if (how === 'grenade') Pj.explode(w, x + 1, z + 0.6, 'grenade', sp);
      else e.takeDamage(999, how === 'rifle' ? sn : sp, how === 'trap' ? 'trap' : 'shot');
      for (let i = 0; i < 60 * 12 && !(e.settled && !e._rd && w.time - e.deathTime > 2); i++) tick(1);
      tick(20); g.centerOn(e.x, e.z); tick(2);
      const gaps = H.bodyGaps(G, e);
      const rec = { phase, how, char: e.model?.characterId, at: [+e.x.toFixed(2), +e.z.toFixed(2)], mode: e.bodyPose?.mode ?? null, prone: !!e.bodyPose?.prone,
        settled: !!e.settled, contact, gaps: Object.fromEntries(Object.entries(gaps || {}).map(([k, v]) => [k, v.gap])) };
      out.push(rec);
      shots.push(e);
      return rec;
    };
    const victims = (w, n) => w.enemies.filter((e) => e.alive && e.model?.real && e.soldierType !== 'dog' && !e.vehicle && !e.spawn?.tower).slice(0, n);
    // M1 snow: two slopes (14° and 24°), the edge of a mast's plinth (a 0.45 m low surface), flat snow
    const SNOW = [[30.95, 120.55, 'knife-front'], [44.51, 32.01, 'rifle'], [37.43, 12.24, 'knife-behind'], [11.59, 135.41, 'grenade']];
    // 1. M1, first load
    let w = await load('m01');
    victims(w, 4).forEach((e, i) => { const [x, z, how] = SNOW[i]; kill(w, 'm01 first load', e, x, z, i % 2 ? 0.4 : 2.2, how); });
    // 2. M1 again (an instant restart)
    w = await load('m01');
    victims(w, 2).forEach((e, i) => { const [x, z] = SNOW[i]; kill(w, 'm01 restart', e, x + 0.5, z, 1.2, i ? 'pistol' : 'knife-front'); });
    // 3. the tutorial after M1 (a mission switch): its guards on the road, in the compound, at the bridge end
    w = await load('m00');
    const byTag = (t) => w.enemies.find((e) => e.tag === t);
    kill(w, 'm00 tutorial', byTag('patrol_west'), 18, 27.5, 0, 'knife-behind');
    kill(w, 'm00 tutorial', byTag('guard_fuel'), 48.5, 38.6, Math.PI, 'knife-front');
    kill(w, 'm00 tutorial', byTag('officer'), 51, 17, Math.PI / 2, 'rifle');
    kill(w, 'm00 tutorial', byTag('sentry_bridge'), 47, 30, Math.PI, 'pistol');
    kill(w, 'm00 tutorial', byTag('patrol_east'), 49, 22, Math.PI / 2, 'trap');
    // 4. back to M1 after the tutorial
    w = await load('m01');
    victims(w, 2).forEach((e, i) => { const [x, z] = SNOW[i]; kill(w, 'm01 after m00', e, x - 0.5, z + 0.5, 2.8, i ? 'trap' : 'knife-front'); });
    // side views of the last mission's bodies: the terrain and the bodies only, low and broadside to the first
    const THREE = await import('three');
    const R = G.renderer, last = shots.filter((e) => e.world === w).slice(0, 1);
    g.setZoom(2); g.centerOn(last[0].x, last[0].z); G.render(1 / 60, 1); // (bodies off the game camera's view are not drawn)
    const tm = G.mapHandle?.terrain?.terrain?.mesh, mine = new Set();
    for (const o of [tm, ...last.map((e) => e.model.root)]) for (let n = o; n; n = n.parent) mine.add(n);
    const hidden = [];
    const walk = (o) => { for (const ch of o.children) { if (mine.has(ch)) { if (ch !== tm && !last.some((e) => e.model.root === ch)) walk(ch); } else if (ch.visible && !ch.isLight) { ch.visible = false; hidden.push(ch); } } };
    walk(R.scene);
    const e0 = last[0], cam = new THREE.PerspectiveCamera(30, R.renderer.domElement.width / R.renderer.domElement.height, 0.05, 300);
    const gy = w.groundY(e0.x, e0.z);
    cam.position.set(e0.x - Math.sin(e0.heading) * 3.6, gy + 0.3, e0.z + Math.cos(e0.heading) * 3.6); cam.lookAt(e0.x, gy + 0.12, e0.z); cam.updateMatrixWorld(true);
    G._frame0 = G.frame; G.frame = () => {};
    R.renderer.setRenderTarget(null); R.renderer.render(R.scene, cam);
    setTimeout(() => { for (const o of hidden) o.visible = true; G.frame = G._frame0; }, 1500);
    return out;
  });
  await t.shot('body-float');
  for (const c of r) console.log('    ' + JSON.stringify(c));
  t.ok(r.length === 13, `thirteen bodies (${r.length})`);
  t.ok(r.filter((c) => c.phase === 'm00 tutorial' && /^knife/.test(c.how)).every((c) => c.contact), 'the tutorial knife kills are contact kills by the knife order');
  t.ok(r.some((c) => c.prone), 'one knifed from behind lies on his face');
  for (const c of r) {
    const n = `${c.phase}, ${c.how} (${c.char} at ${c.at})`;
    t.ok(c.settled, `${n}: settled`);
    // a body thrown by a blast lies as it landed: its trunk and head on the ground (its hands may lie on it)
    const parts = c.mode === 'blast' ? ['hips', 'chest', 'head'] : ['hips', 'chest', 'head', 'hands', 'feet'];
    for (const p of parts) {
      t.ok(c.gaps[p] != null && c.gaps[p] <= 0.035, `${n}: ${p} on the ground, not in the air (${c.gaps[p]} m over it)`);
      t.ok(c.gaps[p] != null && c.gaps[p] >= -0.07, `${n}: ${p} not sunk into the ground (${c.gaps[p]} m)`);
    }
    t.ok(c.gaps.all >= -0.09, `${n}: no part deep in the ground (lowest point ${c.gaps.all} m)`);
  }
}
