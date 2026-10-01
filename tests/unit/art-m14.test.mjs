/** M14 art pass: Atlantic Wall add-on manifest, hinted variants on catalogue and §7.7 extra props, gameplay fits. */
import { readFileSync, existsSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { useManifest, pickAsset, assetExtents, VARIANT_HINTS, libraryHinted } from '../../src/art/building-props.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { MISSIONS } from '../../src/missions/index.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const base = () => JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
const addon = JSON.parse(readFileSync(P('assets/models/buildings/manifest-atlantic-wall.json')));
const merged = () => { const m = base(); for (const x of EXTRA_MANIFESTS) mergeManifest(m, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`)))); return m; };
const withLib = async (m, fn) => { await useManifest(m, 'm14'); try { return await fn(); } finally { await useManifest(null); } };
const m14 = MISSIONS.find((m) => m.id === 'm14');

test('art m14: the add-on manifest ships every LOD file, links destroyed variants, and merges without touching the base', () => {
  assert.ok(EXTRA_MANIFESTS.includes('manifest-atlantic-wall'));
  for (const [n, a] of Object.entries(addon.assets)) {
    assert.equal(a.lods.length, 3, n);
    for (const l of a.lods) assert.ok(existsSync(P(`assets/models/${l.url}`)), l.url);
    assert.ok(a.theaters.includes('coast'), n);
  }
  for (const g of ['casemate_h612', 'casemate_h679', 'gun_turret_block', 'gun_pit_open']) {
    assert.equal(addon.assets[g].destroyedVariant, `${g}_destroyed`);
    assert.equal(addon.assets[`${g}_destroyed`].destroyedOf, g);
  }
  const b = base(), m = merged();
  for (const n of Object.keys(b.assets)) assert.ok(m.assets[n], n);
  assert.deepEqual(m.types.casemate_gun.variants, b.types.casemate_gun.variants, 'generic casemate_gun picks unchanged');
  assert.ok(!m.types.crates && !m.types.sign && !m.types.sea_wall, 'no catalogue-wide type takeover (hints only)');
});

test('art m14: every hinted variant resolves to its own asset; unhinted structures and other missions are unchanged', () => withLib(merged(), () => {
  for (const [type, hints] of Object.entries(VARIANT_HINTS)) for (const [v, names] of Object.entries(hints)) {
    if (!names) continue;
    for (const n of names) assert.ok(merged().assets[n], `${type}.${v} → ${n}`);
  }
  const pick = (type, p) => pickAsset(type, p, { theater: 'coast', missionId: 'm14' })?.name;
  assert.equal(pick('casemate_gun', { id: 'g1', variant: 'casemate_embrasure', w: 8, d: 9 }), 'casemate_h612');
  assert.equal(pick('casemate_gun', { id: 'g2', variant: 'casemate_embrasure', w: 12, d: 9 }), 'casemate_h679');
  assert.equal(pick('crates', { id: 'tt', variant: 'beach_tetrahedron', w: 1.4, d: 1.4 }), 'beach_tetrahedron');
  assert.equal(pick('crates', { id: 'cr', variant: 'crate_stack', w: 3, d: 2 }), undefined, 'plain crates keep their dressing');
  assert.equal(pick('sign', { id: 's', w: 0.3, d: 0.3 }), undefined, 'plain signs keep their placeholder');
  assert.ok(libraryHinted('sea_wall', { variant: 'at_wall_segment' }) && !libraryHinted('sea_wall', {}));
  assert.ok(!libraryHinted('casemate_gun', { variant: 'whatever' }));
}));

test('art m14: each M14 structure with a library look fits its gameplay footprint (≤ 12 % per axis, roofs at the walk height)', () => withLib(merged(), () => {
  const seen = new Set();
  for (const s of m14.structures) {
    if (!libraryHinted(s.type, s) || s.points) continue;
    const pk = pickAsset(s.type, s, { theater: 'coast', missionId: 'm14' });
    assert.ok(pk, s.id);
    seen.add(pk.name);
    const e = pk.ext, w = s.w ?? 2 * s.r, d = s.d ?? 2 * s.r, [ew, ed] = pk.turn ? [e.d, e.w] : [e.w, e.d];
    if (w > 1 && d > 1) {
      assert.ok(Math.abs(Math.log(w / ew)) < 0.12 && Math.abs(Math.log(d / ed)) < 0.12, `${s.id}: ${pk.name} ${ew.toFixed(1)}×${ed.toFixed(1)} on ${w}×${d}`);
    }
    if (s.type === 'casemate_gun' && s.roofWalk) {
      const roof = Math.max(...merged().assets[pk.name].walkableRoofs.map((r) => r.elev));
      assert.ok(Math.abs(roof - (s.roofY ?? s.h)) < 0.05, `${s.id}: asset roof ${roof} vs walk ${s.roofY ?? s.h}`);
    }
  }
  for (const n of ['casemate_h612', 'casemate_h679', 'gun_turret_block', 'gun_pit_open', 'barracks_concrete_2st', 'barracks_concrete_1st', 'shed_concrete',
    'blockhouse_small', 'house_coastal_normandy', 'beach_tetrahedron', 'czech_hedgehog', 'dragons_teeth', 'sign_minen', 'buoy_red']) assert.ok(seen.has(n), n);
  assert.equal(m14.libraryNav, false, 'Atlantic Wall assets are visuals only on M14');
}));
