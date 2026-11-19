/**
 * LIGHTS OUT e01 art kit (src/art/e01-kit.js): the dry-stone field wall (`drystone_field`, the field walls and the
 * jazzo) is drawn inside its gameplay line — what blocks is drawn and what is drawn blocks — and reads as laid stone:
 * the crest wanders but stays near the gameplay height (the cover a crawling man trusts), stones break both faces,
 * and the same wall is the same every load. The look is drawn only: what gameplay measures of a wall (the visual nav
 * stamp's bands, world/map-builder.js stampVisualNav) is the walls' first geometry, kept undrawn under it — the cells
 * the mission's nav, its nav cache (tools/solutions/navcache/e01.json) and its reference solution were made on.
 * Run with the unit suite: node tests/unit/run.mjs e01-kit
 */
import { test, assert } from './lib.mjs';
import { drystoneFieldWall } from '../../src/art/e01-kit.js';
import { buildWall } from '../../src/art/dressing.js';
import { planCells } from '../../src/world/placement-visual.js';
import { JAZZO } from '../../src/missions/expansion/e01_dry_stone.js';

const rng = (seed) => { let x = seed >>> 0 || 1; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; };

/** Every vertex of the wall's meshes, in world space. */
function verts(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const P = o.geometry.attributes.position, e = o.matrixWorld.elements;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      out.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
    }
  });
  return out;
}

test('e01 drystone_field: inside its gameplay line (foot stones a hand\'s breadth out, ankle-high), crest near the gameplay height', () => {
  for (const [h, width] of [[1.0, 0.6], [2.3, 0.8]]) {
    const L = 8, root = drystoneFieldWall([[0, 0], [L, 0]], { h, width }, rng(7));
    const V = verts(root);
    assert.ok(V.length > 500, `${h} m: a wall of stones (${V.length} vertices)`);
    let maxY = 0, outLow = 0, outHigh = 0, past = 0;
    for (const [x, y, z] of V) {
      maxY = Math.max(maxY, y);
      if (Math.abs(z) > width / 2 + 0.035) { if (y > 0.2) outHigh++; else if (Math.abs(z) > width / 2 + 0.2) outLow++; }
      if (x < -0.12 || x > L + 0.12) past++;
    }
    assert.equal(outHigh, 0, `${h} m: nothing above the foot outside the line`);
    assert.equal(outLow, 0, `${h} m: the fallen stones lie at the foot`);
    assert.equal(past, 0, `${h} m: nothing past the wall's ends`);
    assert.ok(maxY <= h + 0.12 && maxY >= h - 0.12, `${h} m: the cap stones make up the gameplay height (top ${maxY.toFixed(2)})`);
    // the crest wanders: sample the highest stone in 0.5 m bins along the middle of the wall
    const bins = new Map();
    for (const [x, y] of V) if (x > 1 && x < L - 1) { const b = Math.floor(x / 0.5); bins.set(b, Math.max(bins.get(b) ?? 0, y)); }
    const tops = [...bins.values()], spread = Math.max(...tops) - Math.min(...tops);
    assert.ok(spread > 0.03, `${h} m: an irregular crest, not a ruler line (spread ${spread.toFixed(3)} m)`);
    assert.ok(Math.min(...tops) > h - 0.25, `${h} m: no gap in the cover along the wall (lowest top ${Math.min(...tops).toFixed(2)})`);
  }
});

test('e01 drystone_field: stones break both faces (proud of the core), and the same wall is the same every load', () => {
  const width = 0.6, root = drystoneFieldWall([[0, 0], [6, 0], [9, 3]], { h: 1, width }, rng(11));
  const V = verts(root);
  // stones stand proud on both faces at mid-height (the core's face is at ≤ width·0.45)
  const proud = (sd) => V.filter(([x, y, z]) => x > 0.5 && x < 5.5 && y > 0.3 && y < 0.8 && sd * z > width * 0.45 * 0.9).length;
  assert.ok(proud(1) > 20 && proud(-1) > 20, `face stones on both faces (${proud(1)} / ${proud(-1)} vertices)`);
  const again = verts(drystoneFieldWall([[0, 0], [6, 0], [9, 3]], { h: 1, width }, rng(11)));
  assert.equal(again.length, V.length, 'same vertex count');
  let diff = 0;
  for (let i = 0; i < V.length; i++) diff = Math.max(diff, Math.abs(V[i][0] - again[i][0]) + Math.abs(V[i][1] - again[i][1]) + Math.abs(V[i][2] - again[i][2]));
  assert.ok(diff < 1e-9, `deterministic (max difference ${diff})`);
});

/** FNV-1a of a string (a short fingerprint of a cell list). */
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

test('e01 drystone_field: gameplay measures the walls\' first geometry (undrawn), never the drawn look', () => {
  // the jazzo's north run and the checkpoint's field wall, as the mission builds them (dressing.js buildWall: the
  // wall's own seed); the fingerprints are the measured cells of the first look (bff01506a), which the e01 nav cache
  // and the reference solution were made on: a change here moves the game's nav — rebuild the cache and re-run the
  // solution (tools/solutions/navcache.mjs e01, tests/e01-solution.test.mjs)
  const walls = [
    [JAZZO.slice(0, 6), { variant: 'drystone_field', h: 2.3, width: 0.8, id: 'jazzo' }, 'd2b4c8d', '5fd2005'],
    [[[66.6, 87.7], [68.6, 89.4], [72.0, 92.2]], { variant: 'drystone_field', h: 1.0, width: 0.6, id: 'wl_cp' }, '6a5127d9', 'bf17aa07'],
  ];
  for (const [pts, o, bodyPrint, lowPrint] of walls) {
    const root = buildWall(pts, o);
    const look = root.children.find((c) => c.name === 'dressing:wall:drystone_field:look');
    assert.ok(look, `${o.id}: the drawn look hangs under the wall`);
    let drawn = 0, measured = 0;
    root.traverse((m) => {
      if (!m.isMesh) return;
      let inLook = false;
      for (let n = m; n; n = n.parent) if (n === look) inLook = true;
      if (inLook) {
        drawn++;
        assert.equal(m.userData.clip, false, `${o.id}: every mesh of the look is visual only`);
        assert.notEqual(m.material.visible, false, `${o.id}: the look is drawn`);
      } else {
        measured++;
        assert.equal(m.material.visible, false, `${o.id}: the measured geometry is never drawn`);
        assert.equal(m.castShadow, false, `${o.id}: nor casts a shadow`);
        assert.equal(m.userData.aoExclude, true, `${o.id}: nor is drawn into the ambient occlusion prepass`);
      }
    });
    assert.ok(drawn > 0 && measured > 0, `${o.id}: a drawn look (${drawn} meshes) over a measured source (${measured})`);
    const body = planCells(root, { minY: 0.3, maxY: 1.8, cell: 0.25, close: 0 }), low = planCells(root, { minY: 0.12, maxY: 0.3, cell: 0.25, close: 0 });
    assert.equal(fnv(JSON.stringify(body)), bodyPrint, `${o.id}: the body-height cells (0.3–1.8 m) are the first look's`);
    assert.equal(fnv(JSON.stringify(low)), lowPrint, `${o.id}: the low band's cells (0.12–0.3 m) are the first look's`);
    // the look alone, were it measured, would reach other cells (why it is kept out of the measures)
    const bare = look.clone(true);
    bare.traverse((m) => { m.userData = { ...m.userData, clip: true }; });
    const lookBody = planCells(bare, { minY: 0.3, maxY: 1.8, cell: 0.25, close: 0 });
    assert.notEqual(fnv(JSON.stringify(lookBody)), bodyPrint, `${o.id}: the look's own cells differ (the test can tell them apart)`);
  }
});
