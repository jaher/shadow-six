/**
 * Bodies lie on the ground (the user, 2026-10-01: "When doing the tutorial I see bodies kind of floating above the
 * ground when killed"). The tutorial map (m00): guards killed by knife, pistol and rifle on grass, the road, a slope,
 * the compound's earth, the bridge deck, by the crates and by the rocks, and one by a grenade. Once each body has
 * settled, the lowest point of its drawn (skinned) body is within 4.5 cm of the ground under it, its hips touch the
 * ground and neither its heels nor its head are held up in the air.
 * Old code: the settle ragdoll took the death clip's pose as it stood when the ragdoll began (the die → dead cross-fade
 * mid-way: the man still half up) and the bake re-captured it from the drawn skeleton: corpses lay jack-knifed in the
 * air (hips 17 cm, heels 49 cm, head 38 cm up on the road) or half sunk (hips 21–24 cm under the slope and the crates'
 * grass). Saves tests/out/body-ground.png (the road and the slope bodies, side view).
 */
export const timeout = 150_000;

export default async function bodyGround(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/body-rest-page.mjs');
    const P = await import('/src/entities/projectile.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    await g.loadMission('m00'); g.start(); await G.mapHandle?.ready;
    const w = G.world;
    for (const e of w.enemies) { if (e.brain) { e.brain.update = () => {}; e.brain.frozen = true; } e.coneVisible = false; }
    for (const c of w.commandos) { c.takeDamage = () => 0; c.die = () => false; }
    const tick = (n) => { for (let i = 0; i < n; i++) { g.step(); G.render(1 / 60, 1); } };
    const gb = w.commandos.find((c) => c.role === 'greenberet'), sn = w.commandos.find((c) => c.role === 'sniper');
    const sp = w.commandos.find((c) => c.role === 'sapper');
    const out = [];
    const spots = [
      ['grass, knife', 10, 20, 'knife'], ['road, pistol', 20, 30, 'pistol'], ['slope, rifle', 34, 44, 'rifle'],
      ['by the crates, knife', 28.5, 22.4, 'knife'], ['compound earth, pistol', 50, 26, 'pistol'], ['bridge deck, knife', 40, 30.3, 'knife'],
      ['by the rocks, rifle', 33.65, 51.6, 'rifle'], ['grass, grenade', 18, 36, 'grenade'],
    ];
    for (const [name, x, z, how] of spots) {
      const e = w.add(new Enemy({ soldierType: 'soldier', x: 2, z: 2, heading: 0 }));
      if (e.brain) { e.brain.update = () => {}; e.brain.frozen = true; }
      e.coneVisible = false;
      for (const c of [gb, sn, sp]) c.setPosition(Math.max(2, x - 9), z + (c === gb ? 0 : c === sn ? 2 : -2), 0);
      e.setPosition(x, z, 1.1); await e.model.ready;
      g.setZoom(3); g.centerOn(x, z); tick(20);
      if (how === 'grenade') P.explode(w, x + 1, z + 0.6, 'grenade', sp);
      else if (how === 'knife') e.die('knife', gb);
      else e.takeDamage(999, how === 'rifle' ? sn : sp, 'shot');
      for (let i = 0; i < 60 * 10 && !(e.settled && !e._rd && w.time - e.deathTime > 2); i++) tick(1);
      tick(20); g.centerOn(e.x, e.z); tick(2);
      out.push({ name, how, mode: e.bodyPose?.mode ?? null, settled: !!e.settled, ...H.contact(w, e), at: [+e.x.toFixed(2), +e.z.toFixed(2)] });
      if (name.startsWith('road') || name.startsWith('slope')) e._keep = true; else { e.setPosition(2, 2); e.removed = true; }
    }
    // side view of the road and the slope bodies (the ground and the two bodies only)
    const keep = w.enemies.filter((e) => e._keep);
    const cc = G.cameraController, el0 = cc.elevation, az0 = cc.azimuth;
    cc.elevation = 6 * Math.PI / 180; cc.azimuth = -keep[0].heading; g.setZoom(4); g.centerOn(keep[0].x, keep[0].z);
    const tm = G.mapHandle?.terrain?.terrain?.mesh, mine = new Set();
    for (const o of [tm, ...keep.map((e) => e.model.root)]) for (let n = o; n; n = n.parent) mine.add(n);
    const hidden = [];
    const walk = (o) => { for (const ch of o.children) { if (mine.has(ch)) { if (ch !== tm && !keep.some((e) => e.model.root === ch)) walk(ch); } else if (ch.visible && !ch.isLight) { ch.visible = false; hidden.push(ch); } } };
    walk(G.renderer.scene);
    G.render(0, 1);
    return { out, hidden: hidden.length };
  });
  await t.shot('body-ground');
  for (const c of r.out) console.log('    ' + JSON.stringify(c));
  t.ok(r.out.length === 8, `eight bodies (${r.out.length})`);
  for (const c of r.out) {
    t.ok(c.settled, `${c.name}: settled`);
    t.ok(c.all <= 0.03, `${c.name}: not floating (lowest point ${c.all} m over the ground)`);
    t.ok(c.hips <= 0.045, `${c.name}: hips on the ground (${c.hips} m)`);
    if (c.mode === 'blast') continue; // thrown by the blast: the ragdoll's own pose (not the settled death clip)
    t.ok(c.all >= -0.045, `${c.name}: not sunk into the ground (lowest point ${c.all} m)`);
    t.ok(c.hips >= -0.045, `${c.name}: hips not under the ground (${c.hips} m)`);
    t.ok(c.feet <= 0.15, `${c.name}: heels not held up in the air (${c.feet} m)`);
    t.ok(c.head <= 0.32, `${c.name}: head not held up in the air (${c.head} m)`);
  }
}
