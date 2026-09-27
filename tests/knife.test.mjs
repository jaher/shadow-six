/**
 * Knife (Green Beret, hotkey X): sneak up behind an unaware soldier and knife him → dead, silently,
 * without raising the alarm. The fuel guard is moved to open ground facing west; the Green Beret
 * starts 6 m behind him (east).
 */
export default async function knife(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const w = g.game.world;
    for (const e of [...w.enemies]) if (e.tag !== 'guard_fuel') w.remove(e);
    const guard = w.enemies[0];
    guard.setPosition(16, 46, Math.PI); // faces west (-X)
    Object.assign(guard.post, { x: 16, z: 46, heading: Math.PI, scan: null }); // new post, so he stays
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    gb.setPosition(22, 46, Math.PI);
    g.start();
    g.setCone(guard.id, true);
    const hasKnife = (gb.inventory.get('knife') ?? 0) > 0;
    const ok = g.useAbility(gb.id, 'knife', guard.id);
    let t0 = w.time;
    let killedAt = null;
    let maxAlert = 0;
    for (let i = 0; i < 150 && killedAt == null; i++) {
      g.advance(0.1);
      if (guard.alive) maxAlert = Math.max(maxAlert, guard.alertLevel || 0);
      if (!guard.alive) killedAt = w.time - t0;
    }
    g.advance(1);
    g.centerOn(guard.x, guard.z);
    g.setZoom(0.3);
    return {
      hasKnife, ok, killedAt, maxAlert, guardHp: guard.hp, guardState: guard.state, alarm: !!w.alarm?.active,
      gbHp: gb.hp, gbHp0: gb.maxHp, dist: Math.hypot(gb.x - guard.x, gb.z - guard.z), stats: { ...w.stats },
    };
  });
  t.log(JSON.stringify(r));
  t(r.hasKnife, 'Green Beret carries a knife');
  t(r.ok !== false, 'knife order accepted');
  t(r.killedAt != null, 'guard killed');
  t(r.guardHp <= 0, 'guard hp 0');
  t.equal(r.maxAlert, 0, 'guard never became aware');
  t(!r.alarm, 'no alarm');
  t.equal(r.gbHp, r.gbHp0, 'Green Beret unharmed');
  t(r.dist < 2.5, `Green Beret closed to melee range (${r.dist.toFixed(2)} m)`);
  await t.shot('knife');
}
