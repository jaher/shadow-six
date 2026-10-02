/**
 * Wire pass M4–M20 (docs/barbed-wire.md §12): the wire runs added to the missions (`wx_*`) resolve to a wire type,
 * stand on the ground, and change no enemy route, barracks squad route, vehicle route or commando approach
 * (tests/unit/wire-check.mjs: path lengths with and without them).
 */
import { test, assert } from './lib.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { wireTypeOf } from '../../src/art/wire-obstacles.js';
import { wireImpact, WIRE_ADD } from './wire-check.mjs';
import { loadGrid } from './mission-check.mjs';

const added = (m) => (m.structures || []).filter((s) => WIRE_ADD.test(s.id ?? ''));
const withWire = MISSIONS.filter((m) => added(m).length);

test('wire pass: the added runs are wire, with unique ids, on M4–M20 only', () => {
  assert.ok(withWire.length >= 8, `expected the pass to wire most of M4–M20, got ${withWire.map((m) => m.id)}`);
  for (const m of withWire) {
    assert.ok(/^m(0[4-9]|1\d|20)$/.test(m.id), `${m.id}: wx_ runs belong to the M4–M20 pass`);
    const ids = new Set();
    for (const s of added(m)) {
      assert.equal(s.type, 'fence', `${m.id} ${s.id}: a fence structure`);
      assert.ok(wireTypeOf(s, { missionId: m.id }), `${m.id} ${s.id}: resolves to a wire type (variant ${s.variant})`);
      assert.ok(!ids.has(s.id), `${m.id}: duplicate ${s.id}`);
      ids.add(s.id);
    }
  }
});

for (const m of withWire) {
  test(`wire pass: ${m.id} added wire changes no route or approach`, () => {
    const p = wireImpact(m);
    assert.deepEqual(p, [], `${m.id}:\n  ${p.join('\n  ')}`);
  });
}

test('wire pass: every wired M4–M20 map stays inside the wire budget, and the added wire stays out of solids', async () => {
  const THREE = await import('three');
  const { World } = await import('../../src/world/world.js');
  const { buildMap } = await import('../../src/world/map-builder.js');
  const { B } = await import('../../src/world/grid.js');
  const inSolid = new Map(); // one line per run and solid (the runner prints the first lines of a failure)
  for (const def of withWire) {
    const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def });
    const handle = buildMap(world, def);
    const W = handle.wire;
    assert.ok(W, `${def.id} wire layer`);
    const runs = new Set(added(def).map((s) => s.id));
    assert.equal(new Set(W.runs.filter((r) => runs.has(r.def.id)).map((r) => r.def.id)).size, runs.size, `${def.id}: every added run is drawn`);
    // ground-level wire of the added runs: never inside another structure's solid, tall (B.HIGH) or low (B.LOW:
    // sandbags, hedgehogs, parapets, ravine rims — a coil run into a sandbag pile pokes out of its far side). Checked
    // on the grid built WITHOUT the added runs: their own fence stamp overwrites the cells they cross.
    const bare = loadGrid({ ...def, structures: def.structures.filter((st) => !WIRE_ADD.test(st.id ?? '')) });
    const bg = bare.grid, ownerName = new Map([...bare.handle.structures].map(([id, st]) => [st.owner, id]));
    for (const it of W.parts.items) {
      const run = String(it.runKey ?? it.def?.id ?? '').split('#')[0];
      if (!runs.has(run)) continue;
      for (const p of it.path) {
        if (p[1] > 2.0) continue;
        const c = bg.worldToCell(p[0], p[2]);
        if (!c || c.i < 0 || c.j < 0 || c.i >= bg.cols || c.j >= bg.rows) continue;
        const k = bg.idx(c.i, c.j);
        if (bg.block[k] !== B.HIGH && bg.block[k] !== B.LOW) continue;
        const hit = `${def.id} ${run} in ${ownerName.get(bg.owner[k]) ?? `owner ${bg.owner[k]}`} (block ${bg.block[k]})`;
        if (!inSolid.has(hit)) inSolid.set(hit, `${hit} at (${p[0].toFixed(1)}, ${p[2].toFixed(1)})`);
      }
    }
    const s = W.stats;
    assert.ok(s.ribbonTris < 200000 && s.drawCalls <= 40 && s.buildMs < 150, `${def.id} budget ${JSON.stringify(s)}`);
    console.log(`  wire ${def.id}: runs ${s.runs}, ${s.ribbonTris} tris, ${s.barbs} barbs, ${s.drawCalls} draws, ${s.buildMs} ms`);
    handle.dispose();
  }
  const hits = [...inSolid.values()];
  assert.deepEqual(hits, [], `added wire inside a solid: ${hits.join('; ')}`);
});
