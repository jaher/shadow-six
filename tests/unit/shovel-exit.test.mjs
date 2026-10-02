/**
 * §3.4 shovel — getting the Green Beret out of the hole (user report: "I have trouble taking him out of the hole"):
 * the mound picks him (a click / tap selects him, never toggles him off), a move order digs him out then walks
 * (one rise), the bag's shovel slot is DIG OUT, right-click / CANCEL rise, the portrait shows him buried, and
 * selecting him / panning never rises him. Drives engine/input.js with a stub camera on a real sim world.
 */
import { test, assert, near } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { Input } from '../../src/engine/input.js';
import { knapsackView } from '../../src/ui/knapsack-model.js';
import { portraitGlyph } from '../../src/ui/topbar.js';
import { CONFIG } from '../../src/config.js';
import * as THREE from 'three';
import { digFacing, digFrame, manPose, cycleKey, DIG, RISE, THROW_U, DigSite } from '../../src/art/shovel-dig.js';

const PPM = 40; // stub camera: 40 px per metre, top-down
function rig() {
  const s = makeSim({ terrain: [{ type: 'rect', terrain: 'snow', x: 0, z: 0, w: 30, d: 60 }],
    commandos: [{ role: 'greenberet', x: 10, z: 10, inventory: { shovel: 1, knife: 1, decoy: 1 } }, { role: 'sniper', x: 16, z: 10 }] }, { brains: false });
  const cameraController = {
    worldToScreen: (x, y, z) => ({ x: x * PPM, y: z * PPM - y * PPM * 0.5 }),
    screenToGround: (sx, sy) => ({ x: sx / PPM, z: sy / PPM }),
    pxPerMeter: () => PPM, isOnScreen: () => true, recenterOn() {},
  };
  const game = { world: s.world, state: 'playing', cameraController, enqueue: (fn) => fn(), events: s.world.events, options: {} };
  const inp = new Input(game, null);
  const gb = s.cmd('greenberet'), sn = s.cmd('sniper');
  const bury = () => { inp.select([gb]); inp.beginTargeting('shovel'); s.run(CONFIG.abilities.dig + 0.05); };
  const at = (x, z) => cameraController.worldToScreen(x, 0, z);
  return { s, inp, gb, sn, bury, at };
}

test('shovel exit: the mound picks him — a click / tap on it selects him (never toggles him off), and does not rise him', () => {
  const { s, inp, gb, sn, bury, at } = rig();
  bury();
  assert.ok(gb.buried && gb.selected);
  // a click on the mound (0.6 m off his centre, at ground level) while he is selected: still selected, still buried
  const p = at(gb.x + 0.6, gb.z + 0.2);
  assert.equal(inp.pickEntity(p.x, p.y, (u) => u.kind === 'commando'), gb, 'the mound is his pick proxy');
  assert.equal(inp.click(p.x, p.y, { double: false }), 'select');
  assert.ok(gb.selected && gb.buried, 'a click on the mound keeps him selected, buried');
  // deselected (another man picked): a click on the mound selects him alone
  inp.select([sn]);
  inp.click(p.x, p.y, { double: false });
  assert.deepEqual(inp.selection.map((c) => c.role), ['greenberet']);
  assert.ok(gb.buried, 'selecting him does not rise him');
  // a double click on the mound: still selected, still buried
  inp.click(p.x, p.y, { double: true });
  assert.ok(gb.selected && gb.buried);
  // beyond the mound: no pick
  const far = at(gb.x + CONFIG.abilities.moundPickRadius + 0.6, gb.z);
  assert.equal(inp.pickEntity(far.x, far.y, (u) => u.kind === 'commando'), null);
  s.run(1);
  assert.ok(gb.buried && gb.currentActionId == null, 'nothing rose him');
});

test('shovel exit: one click / tap on the ground digs him out (one rise) and walks him there; a double click runs', () => {
  const { s, inp, gb, bury, at } = rig();
  bury();
  const rises = () => s.events.filter((e) => e.name === 'ability:start' && e.p.id === 'shovel').length;
  const g = at(20, 14);
  assert.equal(inp.click(g.x, g.y, { double: false }), 'move');
  assert.equal(gb.currentActionId, 'shovel', 'rising');
  assert.equal(inp.click(g.x, g.y, { double: true }), 'run', 'the second click of a double click');
  assert.equal(rises(), 2, 'dig + exactly one rise');
  s.run(CONFIG.abilities.rise + 0.05);
  assert.ok(!gb.buried && gb.path && gb.moveMode === 'run', 'out, running');
  s.run(10, () => !gb.path);
  near(gb.x, 20, 0.3, 'arrived x'); near(gb.z, 14, 0.3, 'arrived z');
  assert.equal(rises(), 2);
});

test('shovel exit: right-click / CANCEL rise him; a second one while rising does nothing; F (the ability) rises', () => {
  const { s, inp, gb, bury } = rig();
  bury();
  assert.equal(inp.rightClick(), 'context');
  assert.equal(gb.currentActionId, 'shovel');
  assert.equal(gb.dig.phase, 'rise');
  inp.rightClick();
  assert.equal(s.events.filter((e) => e.name === 'ability:start' && e.p.id === 'shovel').length, 2, 'one rise');
  s.run(CONFIG.abilities.rise + 0.05);
  assert.ok(!gb.buried && !gb.path, 'out, standing');
  bury();
  assert.ok(inp.beginTargeting('shovel'), 'F / the bag slot');
  s.run(CONFIG.abilities.rise + 0.05);
  assert.ok(!gb.buried);
});

test('shovel exit: the bag shows the shovel as DIG OUT (one click rises), the rest locked; the portrait shows him buried', () => {
  const { s, inp, gb, bury } = rig();
  let v = knapsackView([gb], s.world);
  assert.equal(v.mode, 'items');
  assert.ok(!v.items.find((i) => i.item === 'shovel').rise, 'standing: a plain shovel');
  bury();
  v = knapsackView([gb], s.world);
  assert.equal(v.mode, 'items', 'his kit, not the building occupant photo');
  assert.ok(v.buried);
  const sh = v.items.find((i) => i.item === 'shovel');
  assert.ok(sh.rise && !sh.disabled && sh.ability === 'shovel', 'DIG OUT slot');
  assert.equal(sh.label, 'Dig out');
  for (const it of v.items.filter((i) => i.item !== 'shovel')) assert.ok(it.disabled && /dig out/i.test(it.reason), `${it.id} locked`);
  assert.equal(portraitGlyph(gb), 'shovel', 'portrait: buried (not the house of a building occupant)');
  // the slot's click (Knapsack.activate → Input.beginTargeting) rises him
  assert.ok(inp.beginTargeting(sh.ability));
  v = knapsackView([gb], s.world);
  const sh2 = v.items.find((i) => i.item === 'shovel');
  assert.ok(sh2.rise && sh2.disabled && v.rising, 'rising: the slot says so and does nothing more');
  s.run(CONFIG.abilities.rise + 0.05);
  assert.equal(knapsackView([gb], s.world).buried, undefined, 'out: the normal bag');
  assert.equal(portraitGlyph(gb), '');
});

test('shovel exit: no other order rises him (stance, other items, a stop); a save/load keeps him under his mound', () => {
  const { s, gb, bury } = rig();
  bury();
  assert.equal(gb.issue({ type: 'stance', stance: 'crawl' }), false);
  assert.equal(gb.issue({ type: 'ability', id: 'decoyDrop', target: gb }), false);
  assert.match(gb.lastRefusal.text, /dig out first/i);
  gb.issue({ type: 'stop' });
  s.run(1);
  assert.ok(gb.buried && gb.currentActionId == null);
  const d = gb.serialize();
  gb.dig = null;
  gb.deserialize(d);
  assert.ok(gb.buried && gb.dig?.phase === 'buried', 'the mound comes back after a load');
});

test('shovel visuals: the dig site is built in the scene (hole, heap → mound) and the dig pose keys are sane', () => {
  const { s, gb, bury } = rig();
  bury();
  gb.renderUpdate(1 / 60);
  const site = s.world.scene.getObjectByName('dig-site');
  assert.ok(site, 'mound in the scene');
  const heap = site.children.find((o) => o.isMesh && o.geometry.type === 'SphereGeometry');
  assert.ok(heap.visible && heap.scale.y > 0.3, 'a raised mound over him');
  near(site.position.x, gb.x, 1e-6); near(site.position.z, gb.z, 1e-6);
  // he digs side-on to the camera, on the side nearest his heading
  near(digFacing(0, 0), 0.44, 1e-6, 'facing east, camera on the +z side: screen right, turned 25° toward the camera');
  near(Math.abs(digFacing(Math.PI, 0)), Math.PI - 0.44, 1e-6);
  // three dig cycles: the blade goes into the ground (tip below 0) and is thrown up to his left each time
  const dur = CONFIG.abilities.dig, P = (DIG.sink - DIG.draw) / DIG.cycles;
  for (let k = 0; k < DIG.cycles; k++) {
    const thrust = manPose('dig', DIG.draw + (k + 0.22) * P, dur), toss = manPose('dig', DIG.draw + (k + 0.8) * P, dur);
    assert.ok(thrust.T.y < 0, `cycle ${k}: blade in the ground`);
    assert.ok(toss.T.y > 0.4 && toss.T.x > 0.4, `cycle ${k}: spoil thrown up to his left`);
  }
  assert.ok(manPose('dig', dur * 0.99, dur).sink > 1.4, 'sunk out of sight at the end of the dig');
  assert.ok(manPose('rise', 0, CONFIG.abilities.rise).sink > 1, 'rises from below');
  assert.equal(manPose('rise', CONFIG.abilities.rise * 0.6, CONFIG.abilities.rise).sink, 0, 'out of the hole by 60 %');
  assert.ok(cycleKey(0.5).T.y < 0.1);
});

test('shovel visuals: no pop — no spoil before the first load lands, no hole before the blade goes in, the rise ends smoothly', () => {
  const dur = CONFIG.abilities.dig, P = (DIG.sink - DIG.draw) / DIG.cycles;
  const site = new DigSite({ x: 0, z: 0, surface: 'sand', heading: 0 }, 0);
  const heap = site.heap, hole = site.hole;
  // the first frames after F: nothing on the ground yet (the shovel is still coming off his pack)
  for (let t = 0; t <= DIG.draw + 0.05 * P; t += 1 / 60) {
    site.update('dig', t, dur);
    assert.ok(!heap.visible, `no heap at ${t.toFixed(3)} s (h ${heap.scale.y.toFixed(3)})`);
    assert.ok(!hole.visible, `no hole at ${t.toFixed(3)} s`);
  }
  const firstLand = DIG.draw + THROW_U * P + 0.3;
  site.update('dig', firstLand - 0.08, dur);
  assert.ok(!heap.visible, 'the heap starts when the first load comes down');
  site.update('dig', DIG.draw + 0.35 * P, dur);
  assert.ok(hole.visible, 'the hole opens with the first thrust');
  let prev = 0;
  for (let t = firstLand - 0.1; t < dur; t += 1 / 60) { // the heap only grows, a little per frame
    site.update('dig', t, dur);
    assert.ok(heap.scale.y >= prev - 1e-6 && heap.scale.y - prev < 0.05, `heap grows smoothly at ${t.toFixed(3)} s (${prev.toFixed(3)} → ${heap.scale.y.toFixed(3)})`);
    prev = heap.scale.y;
  }
  site.dispose();
  // the dig starts from his idle pose (not the action clip), the shovel fades in on his pack before his hand takes it
  const d0 = manPose('dig', 0, dur);
  assert.ok(d0.base === 1 && d0.w < 0.01 && d0.alpha < 0.01 && d0.slung === 1, 'dig frame 0: idle base, shovel not yet shown, on the pack');
  assert.ok(manPose('dig', 0.1 * DIG.draw, dur).slung === 1, 'still on the pack while he reaches for it');
  assert.ok(manPose('dig', DIG.draw, dur).slung === 0, 'in his hands for the first dig');
  // the swing down from the pack passes out in front of him (never through his legs: tip low ⇒ tip forward)
  for (let t = 0; t <= DIG.draw; t += 1 / 120) {
    const k = manPose('dig', t, dur), d = k.T.clone().sub(k.G).normalize(), tip = k.G.clone().addScaledVector(d, 1.02);
    assert.ok(tip.y > 1.0 || tip.z > 0.5, `blade clear of his legs at ${t.toFixed(3)} s (tip ${tip.y.toFixed(2)} m up, ${tip.z.toFixed(2)} m ahead)`);
  }
  // the end of the rise and its 'out' tail at 60 fps: no channel jumps, the shovel reaches the pack before his arms
  // come down, fades only once on the pack, and the overlay ends after the arms and the shovel are done
  const rise = CONFIG.abilities.rise, frames = [];
  for (let i = 0; i < 120; i++) { const t = i / 60; const k = t <= rise ? manPose('rise', t, rise) : manPose('out', t - rise, rise); if (!k) break; frames.push(k); }
  assert.ok(frames.length > 60 * rise + 0.15 * 60, `the rise is drawn on into the 'out' phase (${frames.length} frames)`);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    for (const ch of ['w', 'alpha', 'base']) assert.ok(Math.abs(b[ch] - a[ch]) < 0.15, `rise frame ${i}: ${ch} ${a[ch].toFixed(3)} → ${b[ch].toFixed(3)}`);
    if (b.w < 0.999) assert.ok(b.slung > 0.5, `rise frame ${i}: the shovel is on his pack before his arms leave it`);
    if (b.alpha < 0.999) assert.ok(b.slung === 1 && b.show === b.alpha > 0.01, `rise frame ${i}: the shovel fades on his pack`);
  }
  const wDown = frames.findIndex((k) => k.w < 0.999), wGone = frames.findIndex((k) => k.w < 0.01);
  assert.ok((wGone - wDown) / 60 >= 0.15, `the arms come down over ≥ 0.15 s (${((wGone - wDown) / 60).toFixed(2)} s)`);
  const last = frames[frames.length - 1];
  assert.ok(last.w < 0.01 && last.alpha < 0.01 && last.base < 0.05, 'the overlay ends invisibly');
  assert.equal(manPose('out', (RISE.gone - 1) * rise + 0.01, rise), null, 'then the overlay is off');
});

test('shovel visuals: the last load\'s clods ride on the heap as it covers him and are gone before he is buried; the flat patch lets the ring show', () => {
  const dur = CONFIG.abilities.dig, site = new DigSite({ x: 0, z: 0, surface: 'snow', heading: 0 }, 0);
  const Mx = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let t = DIG.sink * dur / 2; t < dur; t += 1 / 60) {
    site.update('dig', t, dur);
    const h = site.heap;
    for (let i = 0; i < site.clods.count; i++) {
      site.clods.getMatrixAt(i, Mx); p.setFromMatrixPosition(Mx);
      const rr = Math.hypot(p.x - h.position.x, p.z - h.position.z) / h.scale.x;
      if (p.y < 0.45) assert.ok(rr < 0.8, `clod ${i} at ${t.toFixed(3)} s lies on the heap (r ${rr.toFixed(2)} heap radii, y ${p.y.toFixed(2)} m)`);
    }
    if (t > dur - 0.1) assert.equal(site.clods.count, 0, `no clod left to pop at the end of the dig (${t.toFixed(3)} s)`);
  }
  site.update('buried', 0, 0);
  assert.equal(site.clods.count, 0);
  assert.ok(site.heapMat.depthWrite, 'the mound over him writes depth');
  site.update('out', 0.2, CONFIG.abilities.rise);
  assert.ok(site.heap.visible && !site.heapMat.depthWrite, 'the flat patch after the rise writes no depth (the selection ring draws over it)');
  site.dispose();
});

test('shovel visuals: he turns back from his side-on digging facing slowly at the end of the rise (no quick spin)', () => {
  const rise = CONFIG.abilities.rise;
  const u = { dig: { phase: 'rise', t0: 0, dur: rise, x: 0, z: 0, surface: 'snow', heading: -Math.PI / 2 }, world: { time: 0 }, model: null, heading: -Math.PI / 2,
    alive: true, currentActionId: 'shovel', object3d: { rotation: { y: 0 }, position: { y: 0 } } };
  let prev = null, maxRate = 0, turned = 0;
  for (let i = 0; i <= Math.round(60 * (rise + 1.5)); i++) {
    const t = i / 60;
    if (t >= rise && u.dig.phase === 'rise') { u.dig = { ...u.dig, phase: 'out', t0: rise }; u.currentActionId = null; }
    u.world.time = t; u.object3d.rotation.y = Math.PI / 2 - u.heading; u.object3d.position.y = 0;
    digFrame(u, 1 / 60);
    const r = u.object3d.rotation.y;
    if (prev != null) maxRate = Math.max(maxRate, Math.abs(r - prev) * 60);
    if (i === 0) turned = Math.abs(r - (Math.PI / 2 - u.heading));
    prev = r;
  }
  assert.ok(turned > 1, `test setup: he digs well turned from his heading (${turned.toFixed(2)} rad)`);
  assert.ok(Math.abs(prev - (Math.PI / 2 - u.heading)) < 1e-3, 'back on his heading');
  assert.ok(maxRate < 4, `turn back ≤ 4 rad/s (${maxRate.toFixed(2)})`);
});

test('shovel rise: the clods thrown up as he climbs out keep flying until they land, then fade — none hangs in mid-air or pops', () => {
  const s = new DigSite({ x: 0, z: 0, surface: 'sand', heading: 0 }, 0);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion();
  const frame = () => {
    const out = [];
    for (let i = 0; i < s.clods.count; i++) {
      const p = new THREE.Vector3(), sc = new THREE.Vector3();
      s.clods.getMatrixAt(i, M); M.decompose(p, q, sc);
      out.push({ p, sc: sc.x });
    }
    return out;
  };
  const dt = 1 / 120;
  let prev = null, airborne = 0;
  for (let t = 0; t <= 1.0 + 1e-9; t += dt) {
    s.update('rise', t, 1.0);
    const cur = frame();
    if (prev) for (const c of prev) {
      if (c.sc < 0.3 || c.p.y <= 0.08) continue; // faded or on the ground
      airborne++;
      // the same clod one frame later: nearest within its travel distance
      let best = null, bd = 0.12;
      for (const n of cur) { const d = n.p.distanceTo(c.p); if (d < bd) { bd = d; best = n; } }
      assert.ok(best, `a clod in the air at y=${c.p.y.toFixed(2)} m popped out of existence at t=${t.toFixed(3)} s`);
      assert.ok(bd > 1e-4, `a clod hangs frozen in mid-air at y=${c.p.y.toFixed(2)} m (t=${t.toFixed(3)} s)`); // still travelling (outwards, even at the top of its arc)
    }
    prev = cur;
  }
  assert.ok(airborne > 0, 'clods fly as he rises');
  s.update('out', 0.01, 1.0);
  assert.equal(s.clods.count, 0, 'all clods faded before the rise ends');
});
