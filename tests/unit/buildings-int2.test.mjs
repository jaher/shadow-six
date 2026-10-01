import * as THREE from 'three';
/** Art integration 2: building library behind the prop catalogue (variant choice, fitting, nav sidecars, flags). */
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { useManifest, pickAsset, assetExtents, VARIANT_HINTS, hash01 } from '../../src/art/building-props.js';
import { buildProp } from '../../src/art/props.js';
import { makeFlag, flagMaterial } from '../../src/art/flags.js';
import { applyLibraryNav, libraryDoorPoints, libraryDecks, calibrateDeck, libraryWaterObstacles } from '../../src/world/map-library.js';
import { NavGrid, LINK, B } from '../../src/world/grid.js';
import { snapToSurface } from '../../src/world/map-builder.js';
import { DROP_LODS } from '../../src/art/building-fixups.js';

const manifest = JSON.parse(readFileSync(new URL('../../assets/models/buildings/manifest.json', import.meta.url)));
const withLib = async (fn) => { await useManifest(manifest, 'm99'); try { return await fn(); } finally { await useManifest(null); } };

test('variant choice: mission hints → assets, theater-aware, deterministic per mission + structure id', () => withLib(() => {
  const s = { id: 'barr_2', variant: 'timber_long', x: 14, z: 32, w: 12, d: 6 };
  const a = pickAsset('barracks', s, { theater: 'snow', missionId: 'm01' });
  assert.ok(VARIANT_HINTS.barracks.timber_long.includes(a.name), a.name);
  for (let k = 0; k < 5; k++) assert.equal(pickAsset('barracks', s, { theater: 'snow', missionId: 'm01' }).name, a.name);
  // best fit wins: a 16 × 7 barracks gets the 16 × 7 asset
  assert.equal(pickAsset('barracks', { id: 'L', variant: 'timber_long', w: 16, d: 7 }, { theater: 'snow' }).name, 'barracks_a');
  // desert missions never get Norwegian timber
  const d = pickAsset('barracks', { id: 'x', w: 16, d: 7 }, { theater: 'desert' });
  assert.ok(manifest.assets[d.name].theaters.includes('desert'), d.name);
  // hints the library does not model yet keep the placeholder
  assert.equal(pickAsset('gate', { id: 'g', variant: 'barrier_boom' }, { theater: 'snow' }), null);
  assert.equal(pickAsset('generator', { id: 'tr' }, { theater: 'snow' }), null);
  assert.ok(hash01('a') >= 0 && hash01('a') < 1 && hash01('a') !== hash01('b'));
}));

test('fitting: watchtowers fit their deck, dams/bridges their walkable deck', () => withLib(() => {
  const w = assetExtents('watchtower', true);
  assert.ok(w.w > 2.8 && w.w < 3.6 && w.deckY === 5, JSON.stringify(w));
  const dam = assetExtents('dam_arch', 'bridge');
  near(dam.w, 27, 0.01); near(dam.d, 3, 0.01);
  assert.equal(pickAsset('dam', { id: 'dam', variant: 'concrete_arch', w: 27, d: 4 }, { theater: 'snow' }).name, 'dam_arch');
  assert.deepEqual(DROP_LODS.dam_arch, [2]);
}));

test('unknown prop types never throw: placeholder box with a blocking footprint', () => {
  const r = buildProp('bakery_oven_xyz', { id: 'o', x: 10, z: 12, w: 3, d: 2, destructible: true });
  assert.ok(r.object3d && r.footprints.length === 1 && r.footprints[0].block === 2);
  assert.equal(r.interactables[0].interactKind, 'explosiveTarget');
});

test('flags: spec flag mesh (insignia texture in the browser, tests/unit/flags-insignia), pinned cloth, pole', () => {
  const f = makeFlag({ pole: true, h: 6 });
  const cloth = f.getObjectByName('flag_cloth');
  assert.ok(cloth && cloth.userData.cloth.pinned === 'hoist');
  // step 4w: Verlet cloth on the pinned plane (the shader-wave material stays for cloth:false)
  assert.equal(cloth.geometry.parameters.widthSegments, cloth.userData.cloth.segments[0]);
  assert.ok(cloth.userData.cloth.sim, 'simulated cloth');
  assert.equal(makeFlag({ cloth: false }).getObjectByName('flag_cloth').geometry.parameters.widthSegments, 24);
  assert.ok(flagMaterial().side === 2 && flagMaterial().customProgramCacheKey() === 'flag_cloth_v1');
  // the placeholder barracks of a garrison carries a flag too
  const b = buildProp('barracks', { id: 'b', x: 0, z: 0, flag: true });
  assert.ok(b.object3d.getObjectByName('flag_cloth'));
});

/** A built structure record with a synthetic library visual (world coords), as map-builder sees it. */
function fakeBuilt(def, lib) {
  return { def, type: def.type, owner: 100001, footprints: [{ shape: 'rect', x: def.x, z: def.z, w: def.w, d: def.d, rot: 0, block: B.HIGH }],
    library: { ladders: [], roofs: [], climbEdges: [], doors: [], piers: [], bridge: null, scale: [1, 1, 1], setDoorOpen() {}, ...lib } };
}

test('sidecar nav: walkable bunker roof raised + Green Beret climb edge; mission links override', () => {
  const g = new NavGrid(40, 40);
  const def = { id: 'bk', type: 'bunker', x: 20, z: 20, w: 8, d: 6 };
  g.fillOrientedRect(20, 20, 8, 6, 0, 'block', B.HIGH, 100001);
  const lib = { roofs: [{ points: [[16, 17], [24, 17], [24, 23], [16, 23]], elev: 2.85, walkable: true }],
    climbEdges: [{ a: [16, 17], b: [24, 17], top: 2.85 }] };
  const r = applyLibraryNav(g, [fakeBuilt(def, lib)], { ladders: [], climbLinks: [] }, snapToSurface);
  assert.deepEqual([r.roofs, r.climbs, r.ladders], [1, 1, 0]);
  const k = g.idx(Math.floor(20 / g.cell), Math.floor(20 / g.cell));
  near(g.elev[k], 2.85, 1e-3); assert.equal(g.block[k], B.NONE);
  const link = g.links.find((l) => l.kind === LINK.CLIMB);
  assert.ok(link && link.a.z < 17 && link.b.z > 17 && link.b.y > 2.8, JSON.stringify(link));
  // a mission ladder onto the structure = the mission owns its nav → sidecar ignored
  const g2 = new NavGrid(40, 40);
  const r2 = applyLibraryNav(g2, [fakeBuilt(def, lib)], { ladders: [{ x: 19, z: 16, top: [19, 18, 2.85] }], climbLinks: [] }, snapToSurface);
  assert.equal(r2.roofs + r2.climbs, 0);
  assert.equal(applyLibraryNav(new NavGrid(40, 40), [fakeBuilt({ ...def, nav: false }, lib)], {}, snapToSurface).roofs, 0);
});

test('hideout doors follow the asset main door when close; bridge decks + pier obstacles', () => {
  const house = fakeBuilt({ id: 'h', type: 'house', x: 10, z: 10, w: 10, d: 8, enterable: true }, { doors: [{ id: 'main', x: 11, z: 14, approach: { x: 11, z: 14.8 } }] });
  const far = fakeBuilt({ id: 'f', type: 'house', x: 30, z: 10, w: 10, d: 8, enterable: true }, { doors: [{ id: 'main', x: 30, z: 5, approach: { x: 30, z: 4 } }] });
  const log = [];
  const doors = libraryDoorPoints([house, far], log);
  assert.deepEqual(doors.get('h'), [11, 14.8]);
  assert.ok(!doors.has('f') && /layout kept/.test(log[0]));
  const br = fakeBuilt({ id: 'br', type: 'bridge', x: 20, z: 20, w: 30, d: 6, rot: 0 }, {
    bridge: { deck: [[5, 17], [35, 17], [35, 23], [5, 23]], deck_top: 1.9, deck_end: 0.05, approach: { length: 6 } },
    piers: [{ x: 15, z: 20, r: 1.2 }, { x: 25, z: 20, r: 1.2 }] });
  const [deck] = libraryDecks([br]);
  near(deck.heightAt(20, 20), 1.9, 1e-6);
  assert.ok(deck.heightAt(5.2, 20) < 0.2 && deck.heightAt(12, 20) > 1.0 && deck.heightAt(20, 30) === null);
  assert.equal(libraryWaterObstacles([br]).length, 2);
});

test('deck height calibrated to the modelled planks (snow cap), railings/bollards ignored', () => {
  const root = new THREE.Group();
  const planks = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 2.5), new THREE.MeshBasicMaterial());
  planks.position.set(40, 0.33 - 0.04, 40); // snow-capped top 8 cm above the 0.25 m sidecar deck
  const bollard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), new THREE.MeshBasicMaterial());
  bollard.position.set(40, 0.7, 40); // on the centre sample: must not lift the deck
  root.add(planks, bollard);
  const pier = fakeBuilt({ id: 'p', type: 'pier', x: 40, z: 40, w: 8, d: 2.5, rot: 0 }, { object3d: root,
    bridge: { kind: 'jetty', deck: [[36, 38.75], [44, 38.75], [44, 41.25], [36, 41.25]], deck_top: 0.25, deck_end: 0.25 } });
  const [d] = libraryDecks([pier]);
  near(d.heightAt(38, 40), 0.25, 1e-6);
  assert.ok(calibrateDeck(d, THREE));
  near(d.heightAt(38, 40), 0.33, 1e-3);
  assert.ok(calibrateDeck(d, THREE), 'idempotent'); near(d.lift, 0.08, 1e-3);
  const [bare] = libraryDecks([fakeBuilt({ id: 'q', type: 'pier', x: 0, z: 0, w: 1, d: 1 }, { bridge: pier.library.bridge })]);
  assert.equal(calibrateDeck(bare, THREE), false); // no meshes (yet): retry later
  assert.equal(bare.lift, 0);
});
