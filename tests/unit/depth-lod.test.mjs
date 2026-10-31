/**
 * Depth LOD (art/depth-lod.js, art/humanoid-real.js): the sun shadow map and the GTAO prepass draw a man one LOD coarser
 * than his colour pass. The colour pass must never see it: the hooks run only around the outermost depth pass and undo
 * even when it throws; the parts come from the runtime's own setLOD (its headgear / outfit rules), a swap is refused
 * once anything changed them, and the shown-only-in-depth parts get the shadow scan's depth variant.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { inDepthPass, onDepthPass } from '../../src/engine/depth-merge.js';
import { depthLodParts, depthSwapOn, depthSwapOff } from '../../src/art/depth-lod.js';
import { assignShadowVariants, assignShadowVariant, isShadowVariant } from '../../src/engine/program-variants.js';

/** A body runtime like the charkits': LOD bodies (+ an alpha card on LOD0, a cap only LOD0 draws apart) and setLOD. */
function man({ disguise = false } = {}) {
  const object = new THREE.Group(), parts = {};
  const mat = new THREE.MeshStandardMaterial();
  for (const n of ['LOD0', 'LOD0_alpha', 'LOD1', 'LOD2', 'headgear', ...(disguise ? ['disguise:LOD0', 'disguise:LOD1', 'disguise:LOD2'] : [])]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    m.name = n; m.castShadow = n !== 'LOD0_alpha';
    object.add(m); parts[n] = m;
  }
  const h = { object, _lod: 'LOD1', _disg: false, calls: 0,
    setLOD(name) {
      h.calls++; h._lod = name;
      for (const [n, m] of Object.entries(parts)) {
        const d = n.startsWith('disguise:'), base = d ? n.slice(9) : n;
        if (/^LOD\d/.test(base)) m.visible = d === h._disg && base.startsWith(name);
        else if (base === 'headgear') m.visible = name === 'LOD0'; // (the coarser bodies hold the cap merged)
      }
    } };
  h.setLOD('LOD1');
  return { h, parts };
}

test('depth pass hooks: enter / leave around the outermost pass only, undone when the pass throws', () => {
  const log = [];
  onDepthPass((k) => log.push(`enter ${k}`), (k) => log.push(`leave ${k}`));
  inDepthPass('shadow', () => { log.push('draw'); inDepthPass('ao', () => log.push('nested')); });
  assert.deepEqual(log, ['enter shadow', 'draw', 'nested', 'leave shadow']);
  log.length = 0;
  let threw = false;
  try { inDepthPass('ao', () => { throw new Error('boom'); }); } catch { threw = true; }
  assert.ok(threw);
  assert.deepEqual(log, ['enter ao', 'leave ao']);
});

test('depthLodParts: LOD1 colour -> LOD2 in depth; LOD0 -> LOD1 hides the alpha card and the separate cap', () => {
  const { h, parts } = man();
  const hide = [], show = [];
  assert.ok(depthLodParts(h, hide, show));
  assert.deepEqual(hide.map((o) => o.name), ['LOD1']);
  assert.deepEqual(show.map((o) => o.name), ['LOD2']);
  assert.equal(h._lod, 'LOD1', 'the runtime is left on its colour LOD');
  assert.ok(parts.LOD1.visible && !parts.LOD2.visible);
  h.setLOD('LOD0');
  assert.ok(depthLodParts(h, hide, show));
  assert.deepEqual(hide.map((o) => o.name).sort(), ['LOD0', 'LOD0_alpha', 'headgear']);
  assert.deepEqual(show.map((o) => o.name), ['LOD1']);
  h.setLOD('LOD2');
  assert.ok(!depthLodParts(h, hide, show), 'nothing coarser than LOD2');
  assert.equal(hide.length + show.length, 0);
});

test('depthLodParts: the disguised outfit swaps its own bodies', () => {
  const { h } = man({ disguise: true });
  h._disg = true; h.setLOD('LOD1');
  const hide = [], show = [];
  assert.ok(depthLodParts(h, hide, show));
  assert.deepEqual(hide.map((o) => o.name), ['disguise:LOD1']);
  assert.deepEqual(show.map((o) => o.name), ['disguise:LOD2']);
});

test('depthLodParts: a runtime whose setLOD does not restore is left as it was, no swap', () => {
  const { h, parts } = man();
  const set = h.setLOD;
  h.setLOD = (name) => { set(name); if (name === 'LOD1') parts.headgear.visible = true; }; // (a stray side effect)
  const hide = [], show = [];
  assert.ok(!depthLodParts(h, hide, show));
  assert.ok(parts.LOD1.visible && !parts.LOD2.visible && !parts.headgear.visible);
  assert.ok(!depthLodParts({ object: new THREE.Group() }, hide, show), 'no setLOD: nothing');
});

test('depthSwapOn / Off: flips and restores exactly; refused once the parts changed', () => {
  const { h, parts } = man();
  const hide = [], show = [];
  depthLodParts(h, hide, show);
  assert.ok(depthSwapOn(hide, show));
  assert.ok(!parts.LOD1.visible && parts.LOD2.visible);
  depthSwapOff(hide, show);
  assert.ok(parts.LOD1.visible && !parts.LOD2.visible);
  h.setLOD('LOD0'); // zoomed in since: the lists are stale
  assert.ok(!depthSwapOn(hide, show));
  assert.ok(parts.LOD0.visible && !parts.LOD1.visible && !parts.LOD2.visible, 'a refused swap changes nothing');
});

test('assignShadowVariant: a part hidden from the scan gets the same depth variant as its visible twin', () => {
  const scene = new THREE.Scene();
  const { h, parts } = man();
  scene.add(h.object);
  assignShadowVariants(scene);
  const v1 = parts.LOD1.customDepthMaterial;
  assert.ok(isShadowVariant(v1), 'the visible body has its variant');
  assert.equal(parts.LOD2.customDepthMaterial, undefined, 'the scan never meets the hidden LOD2');
  assert.ok(assignShadowVariant(parts.LOD2));
  assert.equal(parts.LOD2.customDepthMaterial, v1, 'same kind, same depth state: the same variant');
  const cut = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5 }));
  cut.castShadow = true;
  assert.ok(!assignShadowVariant(cut) && cut.customDepthMaterial === undefined, 'a cut-out keeps three\'s own depth material');
});
