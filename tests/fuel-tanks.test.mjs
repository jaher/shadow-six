/**
 * Fuel tanks (docs/fuel-tanks.md) in the real game: M2's depot pair loads the library models (stand on the outer
 * ends: depot_a = mirror), both render at zoom 1 and 2 inside their unchanged footprints (≤ 0.3 m dressing), the frame
 * budget holds with the depot on screen. The objective is played through the sim, not destroy(): the Sapper's time
 * bomb takes depot_b and a shot drum beside depot_a takes depot_a. Both swap to their snow wrecks (inside the footprint
 * + 0.5 m), a tank-sized licking fire + lingering smoke column runs, the wrecks keep blocking their footprints and no
 * reacting guard ends up standing on them. The sandbox depot gets the temperate vertical tank.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffBaseline } from '../src/debug/clip-rules.js';
import { TESTS_DIR } from './harness.mjs';

export default async function fuelTanks(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const { MISSIONS } = await import('./src/missions/index.js');
    const m02 = MISSIONS.find((m) => m.id === 'm02');
    const A = m02.structures.find((s) => s.id === 'depot_a'), Bd = m02.structures.find((s) => s.id === 'depot_b');
    // a Sapper with a time bomb by depot_b's south face, a fuel drum 1.2 m off depot_a's south face
    const off = (s, k) => ({ x: s.x - Math.sin(s.rot) * k, z: s.z + Math.cos(s.rot) * k });
    const sap = off(Bd, 2.4), drum = off(A, 2.9);
    await g.loadMission({ ...m02, id: 'm02_tanks', commandos: [...m02.commandos.slice(0, 1), { role: 'sapper', x: sap.x, z: sap.z, heading: 0, inventory: { pistol: 1, timeBomb: 1 } }],
      interactables: [...(m02.interactables || []), { kind: 'barrel', id: 'tank_drum', x: drum.x, z: drum.z }] });
    g.start(); g.pause(true);
    const w = G.world;
    for (const e of w.enemies) if (e.brain) e.brain.frozen = true;
    const props = {};
    G.renderer.scene.traverse((o) => { if (/^prop:fueltank:/.test(o.name)) props[o.name.split(':')[2]] = o; });
    const info = (o) => {
      let meshes = 0, vis = 0;
      o.traverse((m) => { if (m.isMesh) { meshes++; if (m.visible) vis++; } });
      return { asset: o.userData.libraryAsset, meshes, vis };
    };
    const contain = (o) => {
      const B = new o.position.constructor();
      o.updateMatrixWorld(true);
      const inv = o.matrixWorld.clone().invert();
      let mx = 0, mz = 0, my = 0;
      o.traverse((m) => {
        if (!m.isMesh || !m.visible || !m.geometry || /decal/.test(m.parent?.name || '') || /decal/.test(m.name)) return;
        m.geometry.computeBoundingBox?.();
        const bb = m.geometry.boundingBox; if (!bb) return;
        for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
          B.set(cx, cy, cz).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
          mx = Math.max(mx, Math.abs(B.x)); mz = Math.max(mz, Math.abs(B.z)); my = Math.max(my, B.y);
        }
      });
      return { hx: +mx.toFixed(2), hz: +mz.toFixed(2), top: +my.toFixed(2) };
    };
    const out = { before: {}, bench: {}, after: {}, contain: {}, wreck: {} };
    for (let i = 0; i < 60 && Object.values(props).some((o) => info(o).meshes < 3); i++) await new Promise((res) => setTimeout(res, 100));
    for (const [id, o] of Object.entries(props)) { out.before[id] = info(o); out.contain[id] = contain(o); }
    const c = { x: (A.x + Bd.x) / 2, z: (A.z + Bd.z) / 2 };
    for (const z of [1, 2]) { g.setZoom(z); g.centerOn(c.x, c.z); out.bench[z] = await g.bench(60); }
    // the objective through the sim: bomb at depot_b, a shot drum at depot_a; then the guards react for 25 s
    g.pause(false);
    const sp = w.commandos.find((u) => u.role === 'sapper');
    out.planted = g.useAbility(sp.id, 'timeBomb', sp.id);
    g.advance(1.0);
    g.order(sp.id, { type: 'move', x: sp.x - Math.sin(Bd.rot) * 14, z: sp.z + Math.cos(Bd.rot) * 14, run: true });
    w.byId('tank_drum')?.takeDamage?.(1, null, 'pistol');
    g.advance(11);
    for (const [id, o] of Object.entries(props)) { out.after[id] = info(o); out.wreck[id] = contain(o); }
    out.fx4 = w.fx?.vfx?.stats?.() || null;
    for (const e of w.enemies) if (e.brain) e.brain.frozen = false;
    g.advance(25);
    const inside = (s, u) => {
      const dx = u.x - s.x, dz = u.z - s.z, lx = dx * Math.cos(s.rot) + dz * Math.sin(s.rot), lz = -dx * Math.sin(s.rot) + dz * Math.cos(s.rot);
      return Math.abs(lx) < s.w / 2 && Math.abs(lz) < s.d / 2;
    };
    out.onWreck = w.enemies.filter((e) => e.alive && (inside(A, e) || inside(Bd, e))).map((e) => e.id);
    const gr = w.grid;
    out.blocked = [A, Bd].map((s) => gr.blockAt(s.x, s.z));
    // wreck clipping (self / neighbours) with the static audit, against the intact baseline
    await g.clipAudit();
    out.clip = g.clip.static().findings;
    g.advance(70);
    out.fx100 = w.fx?.vfx?.stats?.() || null;
    out.objectives = g.state().objectives;
    out.destroyed = ['depot_a', 'depot_b'].map((id) => !!w.interactables.find((i) => i.object3d === props[id])?.destroyed);
    g.pause(true);
    return out;
  });
  t.log('before', JSON.stringify(r.before));
  t.log('contain', JSON.stringify(r.contain), 'wreck', JSON.stringify(r.wreck));
  t.log('bench z1', JSON.stringify({ wall: r.bench[1].wallMedian, gpu: r.bench[1].gpuMedian, calls: r.bench[1].calls, tris: r.bench[1].triangles }));
  t.log('bench z2', JSON.stringify({ wall: r.bench[2].wallMedian, gpu: r.bench[2].gpuMedian, calls: r.bench[2].calls, tris: r.bench[2].triangles }));
  t.log('fx', JSON.stringify(r.fx4), JSON.stringify(r.fx100), 'onWreck', JSON.stringify(r.onWreck), 'blocked', JSON.stringify(r.blocked));
  t.equal(r.before.depot_a?.asset, 'fuel_tank_h_cradle_m_snow', 'depot_a: mirrored snow cradle (stand on the outer end)');
  t.equal(r.before.depot_b?.asset, 'fuel_tank_h_cradle_snow', 'depot_b: snow cradle');
  t.ok(r.planted !== false, 'the Sapper planted his time bomb by depot_b');
  for (const id of ['depot_a', 'depot_b']) {
    t.ok(r.before[id].vis >= 3, `${id} meshes visible (${r.before[id].vis})`);
    const k = r.contain[id];
    t.ok(k.hx <= 9 / 2 + 0.3 && k.hz <= 3.4 / 2 + 0.3 && k.top <= 3.5 + 0.05, `${id} inside its 9 × 3.4 × 3.5 footprint (≤ 0.3 m dressing): ${JSON.stringify(k)}`);
    t.equal(r.after[id].asset, id === 'depot_a' ? 'fuel_tank_h_cradle_m_destroyed_snow' : 'fuel_tank_h_cradle_destroyed_snow', `${id} wreck (via ${id === 'depot_a' ? 'the shot drum' : 'the time bomb'})`);
    t.ok(r.after[id].vis >= 3, `${id} wreck visible`);
    const q = r.wreck[id];
    t.ok(q.hx <= 9 / 2 + 0.5 && q.hz <= 3.4 / 2 + 0.5 && q.top <= 3.5 + 0.05, `${id} wreck inside its footprint + 0.5 m: ${JSON.stringify(q)}`);
  }
  t.ok(r.destroyed.every(Boolean), 'both depots destroyed through the sim');
  const base = JSON.parse(readFileSync(join(TESTS_DIR, 'clip-baseline.json'), 'utf8'));
  const fresh = diffBaseline(r.clip, base, 'm02').fresh.filter((f) => /depot_/.test(`${f.a?.id} ${f.b?.id}`));
  t.log('wreck clip', fresh.length, JSON.stringify(fresh.slice(0, 4).map((f) => [f.a?.id, f.b?.id, f.a?.cat, f.b?.cat])));
  t.equal(fresh.length, 0, 'the depot wrecks clip nothing new (static clip audit after the blast)');
  t.ok(r.blocked.every((b) => b >= 2), `the wrecks keep blocking their footprints (HIGH): ${r.blocked}`);
  t.equal(r.onWreck.length, 0, `no guard stands on a wreck after 25 s of reaction: ${r.onWreck.join(',')}`);
  for (const z of [1, 2]) t.ok(r.bench[z].wallMedian < 40, `frame time with the depot on screen at zoom ${z}: ${r.bench[z].wallMedian} ms`);
  t.ok(r.fx4 && r.fx4.emitters >= 4 && r.fx4.particles > 50, `fire + explosion running: ${JSON.stringify(r.fx4)}`);
  t.ok(r.fx100 && r.fx100.emitters >= 1, `lingering smoke after the fire: ${JSON.stringify(r.fx100)}`);
  t.ok(r.objectives.some((o) => o.id === 'o1' && o.done), 'objective o1 (destroy the fuel depot) done');

  const sb = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00'); g.start(); g.pause(true);
    let a = null;
    G.renderer.scene.traverse((o) => { if (o.name === 'prop:fueltank:fuel_depot') a = o.userData.libraryAsset; });
    return a;
  });
  t.equal(sb, 'fuel_tank_vertical_t', 'sandbox depot: temperate vertical tank');
}
