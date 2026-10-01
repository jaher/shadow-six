/**
 * bodies-design §C / §E browser (part C) on M1 (snow): a Driver drags a body by the armpits (grab 1.0 s, walking
 * backwards at 0.8 m/s, heel furrow + smear, release 0.6 s); the Green Beret lifts one onto his shoulders (1.0 s),
 * carries it, lowers it to a drag (Shift+H, 0.8 s), lifts it again (H, 1.0 s) and puts it down (0.8 s); a carrier who
 * is hit drops the man (a ragdoll off the shoulder). Frame strips → docs/screenshots/bodies-dragcarry-*.jpg.
 * The DOWNED / revive half is bodies-dragcarry-downed.test.mjs.
 */
import { saveJpeg } from './bodies-physics.test.mjs';

export default async function bodiesDragCarry(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    const W = G.world, out = { house: { ...W.house } };
    const cs = W.commandos, gb = cs.find((c) => c.role === 'greenberet'), dr = cs.find((c) => c.role === 'driver'), dv = cs.find((c) => c.role === 'diver');
    const sp = H.openSpot(W, gb.x, gb.z, 9);
    H.clearArea(W, sp.x, sp.z, 24);
    W.enemies.forEach(H.freeze);
    for (const e of W.enemies) e.coneVisible = false;
    const gs = W.enemies.filter((e) => e.alive && e.soldierType !== 'dog').slice(0, 3);
    const view = (x, z, zoom) => { g.setZoom(zoom); g.centerOn(x, z); };
    const tick = (n, every = 1) => H.run(g, G, n, every);
    /** advance until fn() (≤ n ticks): g.advance(1/60) does not always step the sim exactly once */
    const at = (fn, n = 300) => { for (let i = 0; i < n && !fn(); i++) H.run(g, G, 1, 1); return fn(); };
    // --- DRAG: the Driver takes a body by the armpits and drags it 4 m backwards
    gs[0].setPosition(sp.x, sp.z, Math.PI / 2); gs[0].die('knife', gb);
    gs[1].setPosition(sp.x + 5, sp.z - 3, 0); gs[1].die('knife', gb);
    dr.setPosition(sp.x - 1.4, sp.z - 0.4, 0); gb.setPosition(sp.x + 6.3, sp.z - 3.2, Math.PI); dv.setPosition(sp.x - 7, sp.z + 6, 0);
    tick(150, 2);
    const drag = new H.Strip(G, { cols: 3, rows: 2, tileW: 420, tileH: 300, cropW: 700, cropH: 500 });
    view(sp.x - 0.3, sp.z - 0.2, 3);
    out.dragIssued = dr.issue({ type: 'ability', id: 'hand', target: gs[0] });
    at(() => (dr.currentAction?.t ?? 0) >= 0.45); drag.grab('grab: kneels at his head');
    at(() => dr.carrying === gs[0]); out.dragMode = dr.carryMode; drag.grab('1.0 s: hooked under the armpits');
    dr.issue({ type: 'move', x: sp.x - 1.4, z: sp.z - 4.8 });
    tick(90); view(dr.x, dr.z + 0.6, 3); drag.grab('walks backwards at 0.8 m/s');
    tick(150); view(dr.x, dr.z + 0.6, 3); drag.grab('heels furrow the snow');
    out.dragSpeed = +dr.speed.toFixed(2); out.dragGap = +Math.hypot(gs[0].x - dr.x, gs[0].z - dr.z).toFixed(2);
    out.dragAnims = [dr.model.clip, gs[0].model.clip];
    dr.issue({ type: 'cancel' });
    at(() => (dr.currentAction?.t ?? 1) >= 0.3); drag.grab('release (0.6 s)');
    at(() => !dr.carrying); tick(90); view(dr.x, dr.z + 0.8, 3); drag.grab('released: on his back, settles');
    out.released = { state: gs[0].state, walk: W.grid.walkableAt(gs[0].x, gs[0].z) };
    out.dragStrip = drag.jpeg();
    // --- SHOULDER: the Green Beret lifts the second body, lowers it to a drag, lifts it again, puts it down
    const sh = new H.Strip(G, { cols: 4, rows: 2, tileW: 380, tileH: 300, cropW: 620, cropH: 490 });
    view(gb.x - 0.8, gb.z, 3);
    out.liftIssued = gb.issue({ type: 'ability', id: 'hand', target: gs[1] });
    at(() => (gb.currentAction?.t ?? 0) >= 0.5); sh.grab('lift: squats, rolls him on (1.0 s)');
    at(() => gb.carrying === gs[1]); out.liftMode = gb.carryMode; tick(8); sh.grab('fireman\'s carry');
    gb.issue({ type: 'move', x: gb.x - 3, z: gb.z + 2.5 });
    tick(100); view(gb.x, gb.z, 3); sh.grab('carries him at 1.6 m/s');
    out.carrySpeed = +gb.speed.toFixed(2);
    at(() => !gb.path);
    out.lowered = gb.issue({ type: 'ability', id: 'carryToggle', target: gb });
    at(() => (gb.currentAction?.t ?? 0) >= 0.4); sh.grab('Shift+H: lowers him (0.8 s)');
    at(() => gb.carryMode === 'drag'); out.lowerMode = gb.carryMode;
    gb.issue({ type: 'move', x: gb.x + 0.5, z: gb.z + 2.2 });
    tick(120); view(gb.x, gb.z + 0.4, 3); sh.grab('drags him under the roof line');
    at(() => !gb.path);
    out.lifted = gb.issue({ type: 'ability', id: 'carryToggle', target: gb });
    at(() => (gb.currentAction?.t ?? 0) >= 0.5); sh.grab('H: lifts him again (1.0 s)');
    at(() => gb.carryMode === 'shoulder'); out.liftAgain = gb.carryMode;
    gb.issue({ type: 'cancel' });
    at(() => (gb.currentAction?.t ?? 1) >= 0.45); sh.grab('right-click: puts him down (0.8 s)');
    at(() => !gb.carrying); tick(60); sh.grab('down, a small settle');
    out.shoulderStrip = sh.jpeg();
    // --- DROP WHEN SHOT: hit while carrying → the man falls off the shoulder as a ragdoll
    const ds = new H.Strip(G, { cols: 3, rows: 1, tileW: 420, tileH: 300, cropW: 620, cropH: 440 });
    gb.issue({ type: 'ability', id: 'hand', target: gs[1] });
    at(() => gb.carrying === gs[1]); gb.issue({ type: 'move', x: gb.x + 3, z: gb.z }); tick(40);
    view(gb.x + 0.6, gb.z, 3);
    gs[2].setPosition(gb.x - 9, gb.z, 0);
    gb.takeDamage(20, gs[2], 'shot');
    out.dropped = { carrying: !!gb.carrying, state: gs[1].state };
    tick(8); ds.grab('hit: he drops the man'); out.ragdoll = !!gs[1]._rd;
    tick(16); ds.grab('0.4 s: falling off the shoulder');
    tick(70); ds.grab('1.5 s: lies where he fell');
    out.dropStrip = ds.jpeg();
    out.hp = gb.hp;
    return out;
  });
  saveJpeg('bodies-dragcarry-drag-strip.jpg', r.dragStrip);
  saveJpeg('bodies-dragcarry-shoulder-strip.jpg', r.shoulderStrip);
  saveJpeg('bodies-dragcarry-dropshot-strip.jpg', r.dropStrip);
  console.log('    dragcarry', JSON.stringify({ ...r, dragStrip: undefined, shoulderStrip: undefined, dropStrip: undefined }));
  t.ok(r.dragIssued, 'drag order accepted');
  t.equal(r.dragMode, 'drag', 'the Driver drags (not GB/Spy)');
  t.ok(Math.abs(r.dragSpeed - 0.8) < 1e-6, `drag speed ${r.dragSpeed}`);
  t.ok(Math.abs(r.dragGap - 0.95) < 0.1, `body gap ${r.dragGap}`);
  t.equal(r.dragAnims[1], 'being_dragged', 'the body plays being_dragged');
  t.ok(r.released.state === 'dead' && r.released.walk, 'released on walkable ground');
  t.equal(r.liftMode, 'shoulder', 'the GB shoulders');
  t.ok(Math.abs(r.carrySpeed - 1.6) < 1e-6, `carry speed ${r.carrySpeed}`);
  t.equal(r.lowerMode, 'drag', 'Shift+H lowers to a drag');
  t.equal(r.liftAgain, 'shoulder', 'H lifts again');
  t.ok(!r.dropped.carrying && r.dropped.state === 'dead', 'dropped when hit');
}
