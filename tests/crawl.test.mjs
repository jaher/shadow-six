/**
 * Low crawl / prone set in the game (docs/crawl-animation.md; user: "elbows on the ground, weapon in the hands"):
 * the Sniper crawls with the rifle in his fist (not on his back), his elbows stay on the real terrain (world.groundY)
 * through a cycle, the gait plays at 0.9 m/s, the Green Beret with the knife cursor up crawls knife in hand, a
 * crawling German dies prone (die_prone -> dead_prone), and the zoomed-out (LOD2) and X-ray renders still draw.
 * Saves tests/out/crawl-sniper.png (zoom 2).
 */
export default async function crawl(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    await g.loadMission('m02'); g.start();
    const w = G.world, v = new THREE.Vector3();
    for (const e of w.enemies) if (e.brain) e.brain.frozen = true;
    const tick = (k) => { for (let i = 0; i < k; i++) { g.step(); G.render(1 / 60, 1); } };
    const out = {};
    const sn = w.commandos.find((c) => c.role === 'sniper');
    sn.setStance('crawl'); tick(60);
    const inner = () => sn.model.real.inner;
    out.idle = [sn.model.clip, sn.model.real.weaponName(), inner().weapon.parent?.name];
    sn.moveTo(sn.x + 9, sn.z + 1); tick(45);
    const B = inner().bones;
    let lo = 9, hi = -9, grip = 0, n = 0;
    for (let i = 0; i < 30; i++) {
      tick(2);
      sn.object3d.updateMatrixWorld(true);
      for (const s of ['l', 'r']) {
        B['lowerarm_' + s].getWorldPosition(v);
        const d = v.y - (w.groundY(v.x, v.z) + (sn.y || 0));   // elbow joint above the terrain under it
        lo = Math.min(lo, d); hi = Math.max(hi, d);
      }
      const W = inner().weapon, sock = W.userData.sockets.sling_f;
      const palm = B.hand_r.getWorldPosition(new THREE.Vector3()).lerp(B.middle_01_r.getWorldPosition(new THREE.Vector3()), 0.55);
      grip = Math.max(grip, sock.getWorldPosition(v).distanceTo(palm)); n++;
    }
    out.crawl = { clip: sn.model.clip, gait: +sn.model.gaitSpeed.toFixed(2), weapon: sn.model.real.weaponName(), parent: inner().weapon.parent?.name,
      elbowLo: +lo.toFixed(3), elbowHi: +hi.toFixed(3), grip: +grip.toFixed(3), n };
    // planted elbows stay put in the world (review: they slid 25-55 cm/s against the ground)
    const prevE = {}; let slide = 0, ns = 0;
    for (let i = 0; i < 40; i++) {
      tick(1); sn.object3d.updateMatrixWorld(true);
      for (const s of ['l', 'r']) {
        const e = B['lowerarm_' + s].getWorldPosition(new THREE.Vector3());
        if (prevE[s]) { const sp = Math.hypot(e.x - prevE[s].x, e.z - prevE[s].z) * 60; if (sp < 0.6) { slide += sp; ns++; } }
        prevE[s] = e;
      }
    }
    out.crawl.plantSlide = +(slide / Math.max(1, ns)).toFixed(3);
    // screenshot at zoom 2 on the crawling sniper
    g.setZoom(2); g.centerOn(sn.x, sn.z); G.render(0, 1);
    // a prone shot plays to its end (bolt cycle) although the sim goes back to idle at once, and the gun is handed from
    // the support hand back to the right fist without a pop (review: prone_shoot cut at 0.3 s, rifle stood vertical)
    sn.stop?.(); sn.path = null; tick(90);
    const dyW = () => { const S = inner().weapon.userData.sockets, a = S.muzzle.getWorldPosition(new THREE.Vector3()), b = S.butt.getWorldPosition(new THREE.Vector3()); return a.y - b.y; };
    sn.model.setAnim('shoot'); tick(1); sn.model.setAnim('crawl_idle');
    let dyMin = 9; const shot = [];
    for (let i = 0; i < 100; i++) { tick(1); sn.model.setAnim('crawl_idle'); dyMin = Math.min(dyMin, dyW()); if (i === 20 || i === 99) shot.push(sn.model.clip); }
    out.shot = { clips: shot, dyMin: +dyMin.toFixed(2) };
    // Green Beret, knife cursor up: crawl_knife with the knife in the fist
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    gb.readyTool = 'knife'; gb.setStance('crawl'); tick(40); gb.moveTo(gb.x - 6, gb.z); tick(40);
    out.knife = [gb.model.clip, gb.model.real.weaponName()];
    gb.readyTool = null;
    // a German lying prone dies prone
    const en = w.enemies.find((e) => e.soldierType !== 'dog' && e.alive);
    en.setStance('crawl'); tick(50);
    out.enemyIdle = en.model.clip;
    en.die('test'); tick(20); out.enemyDie = en.model.clip; tick(120); out.enemyDead = en.model.clip;
    // zoomed out (LOD2) and x-ray passes with prone bodies on screen
    g.setZoom(0.5); g.centerOn(sn.x, sn.z); tick(4);
    if (G.renderer.passes?.xray) G.renderer.passes.xray.enabled = true;
    G.render(0, 1);
    g.setZoom(2); g.centerOn(sn.x, sn.z); G.render(0, 1);
    return out;
  });
  await t.shot('crawl-sniper');
  t.log(JSON.stringify(r));
  t.equal(r.idle[0], 'crawl_idle', 'prone idle on the elbows');
  t.equal(r.idle[1], 'no4_sniper', 'rifle shown while prone');
  t.ok(/^hand_/.test(r.idle[2]), 'rifle held in a hand (not on the back): ' + r.idle[2]);
  t.equal(r.crawl.clip, 'crawl');
  t.near(r.crawl.gait, 0.9, 0.12, 'crawl timed at 0.9 m/s');
  t.ok(/^hand_r/.test(r.crawl.parent), 'rifle in the right fist while crawling');
  t.ok(r.crawl.grip < 0.08, 'front swivel stays in the right fist (' + r.crawl.grip + ' m)');
  t.ok(r.crawl.elbowLo > -0.005, 'elbows never sink into the terrain (' + r.crawl.elbowLo + ')');
  t.ok(r.crawl.elbowHi < 0.11, 'elbows stay on the ground, not propped on the hands (' + r.crawl.elbowHi + ')');
  t.ok(r.crawl.plantSlide < 0.15, 'planted elbows stay put in the world (' + r.crawl.plantSlide + ' m/s)');
  t.equal(r.shot.clips[0], 'prone_shoot', 'prone shot still playing after 0.33 s (bolt cycle)');
  t.equal(r.shot.clips[1], 'crawl_idle', 'then back to the prone idle');
  t.ok(r.shot.dyMin > -0.3, 'no vertical rifle pop on the hand-over (' + r.shot.dyMin + ')');
  t.equal(r.knife[0], 'crawl_knife', 'knife crawl'); t.equal(r.knife[1], 'knife', 'knife in hand');
  t.ok(/^crawl/.test(r.enemyIdle), 'German prone: ' + r.enemyIdle);
  t.equal(r.enemyDie, 'die_prone', 'German dies prone'); t.equal(r.enemyDead, 'dead_prone', 'and stays prone');
}
