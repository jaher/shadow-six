/**
 * What is drawn matches what is walkable beside a boom's footway and at the BCD lift (clipping seed 11: M2 `e6 × gate_se`
 * 6.3 cm at t = 34 s, b00 `diver × lift1` 5.7 cm at t = 156 s; GPU side: tests/clipping.test.mjs).
 *
 * M2's footway keeps a man's centre 0.3 m off the fork rest's face (world/map-builder.js stampBarrierGaps: the lane
 * starts at the layout's `footway[0]`), but his boot reaches 0.5-0.6 m ahead of that centre. The nav, the physics and the
 * body solids stay as laid out (world/breakables.js boomLayout); only the DRAWN fork rest changed (art/breakable-gates.js):
 * a slim post set back from the lane, a footing flush with the ground (it was a 12 cm step that lifted a boot beside the
 * rest) and a pole tip that stops at the rest instead of 13 cm past its face. The lift cage (a placeholder with no nav
 * block: any man may cross it) has a pad flush with the ground and slim corner posts.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { buildBreakableGate, FORK_HALF, FORK_SETBACK, POLE_TIP_TRIM } from '../../src/art/breakable-gates.js';
import { layoutOf } from '../../src/world/breakables.js';
import { getMission } from '../../src/missions/index.js';
import { INTERACTABLE_KINDS } from '../../src/entities/interactables.js';
import '../../src/entities/bcd-interactables.js';

/** The gate model in its own frame (local +x along the gate line, as props.js places it): every mesh with its vertices [u, y, v]. */
function meshes(def) {
  const g = buildBreakableGate(def);
  g.updateMatrixWorld(true);
  const out = [], p = new THREE.Vector3();
  g.traverse((n) => {
    if (!n.isMesh || !n.visible) return;
    const pos = n.geometry.attributes.position, vs = [];
    for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld); vs.push([p.x, p.y, p.z]); }
    out.push({ n, vs, minY: Math.min(...vs.map((q) => q[1])), maxY: Math.max(...vs.map((q) => q[1])) });
  });
  return out;
}

const booms = () => [...getMission('m02').structures, ...getMission('m04').structures].filter((s) => s.type === 'gate' && /boom/.test(s.variant || ''));

test('boom fork rest: the drawn rest, its footing and the pole tip stay inside what the layout and the footway assume', () => {
  const defs = booms();
  assert.equal(defs.length, 4, 'gate_se, gate_outer, boom_x1, boom_x2');
  for (const d of defs) {
    const L = layoutOf(d), post = L.pieces.find((p) => p.id === 'post1'), xe = d.w / 2 + 0.35;
    const M = meshes(d);
    // the rest's own meshes: everything beside the fork rest's layout post (not the gate post logs, not the pole's far part)
    const near = M.flatMap((m) => m.vs).filter(([u, , v]) => u > post.c[0] - 0.3 && u < xe + 0.2 && Math.abs(v) < 0.3);
    assert.ok(near.length > 50, `${d.id}: found the fork rest's meshes`);
    // (1) the pole tip is the rest's lane-side reach, 0.19 m short of the layout's end and 5+ cm behind the footway's start
    // (xe - 0.13: the 0.3 m clearance is measured from there)
    const lane = Math.max(...near.filter(([, y]) => y > 0.02).map(([u]) => u));
    assert.ok(Math.abs(lane - (xe - POLE_TIP_TRIM)) < 0.02, `${d.id}: drawn rest + pole tip end at u = ${lane.toFixed(3)} (expected ${(xe - POLE_TIP_TRIM).toFixed(3)}; layout end ${xe})`);
    assert.ok(lane <= xe - 0.13 - 0.05, `${d.id}: ... 5 cm behind the footway's start ${(xe - 0.13).toFixed(2)}`);
    // (2) at boot height (0.02-0.3 m) only the slim post stands: 2 × FORK_HALF square, its face set back
    const foot = M.filter((m) => m.minY < 0.3 && m.maxY > 0.02 && m.vs.every(([u, , v]) => u > post.c[0] - 0.3 && u < xe + 0.2 && Math.abs(v) < 0.3)).flatMap((m) => m.vs);
    assert.ok(foot.length >= 8, `${d.id}: the rest's post`);
    const span = (k) => Math.max(...foot.map((q) => q[k])) - Math.min(...foot.map((q) => q[k]));
    assert.ok(span(0) <= 2 * FORK_HALF + 1e-6 && span(2) <= 2 * FORK_HALF + 1e-6, `${d.id}: the rest is ${(span(0) * 100).toFixed(0)} × ${(span(2) * 100).toFixed(0)} cm at boot height (a vertex in it is never 5 cm deep)`);
    const face = Math.max(...foot.map(([u]) => u));
    assert.ok(Math.abs(face - (post.c[0] - FORK_SETBACK + FORK_HALF)) < 1e-6, `${d.id}: its lane-side face is set back ${FORK_SETBACK} m (${face.toFixed(3)}; the layout post's face ${(post.c[0] + post.h[0]).toFixed(2)})`);
    // (3) every footing (the pivot post's, the rest's) is a flush pad: nothing at ground level stands more than 2 cm over it
    // (a 12 cm slab was a step: placement-visual lowSurfaces lifted a boot beside the rest onto it)
    const pads = M.filter((m) => m.maxY < 0.2);
    assert.ok(pads.length >= 2, `${d.id}: the two footings`);
    for (const m of pads) assert.ok(m.maxY <= 0.02, `${d.id}: a footing's top is ${m.maxY.toFixed(3)} m over the ground`);
  }
});

test('boom: the layout (physics, nav, body solids) is untouched: the pole still ends at the footway start + 0.13 and the rest is the 14 cm post', () => {
  for (const d of booms()) {
    const L = layoutOf(d), post = L.pieces.find((p) => p.id === 'post1'), pole = L.pieces.filter((p) => p.kind === 'pole'), xe = d.w / 2 + 0.35;
    assert.equal(post.h[0], 0.07);
    assert.ok(Math.abs(Math.max(...pole.map((p) => p.c[0] + p.h[0])) - xe) < 1e-9, `${d.id}: the pole piece ends at ${xe}`);
    if (L.footway) assert.ok(Math.abs(L.footway[0] - (xe - 0.13)) < 1e-9, `${d.id}: footway starts at ${xe - 0.13}`);
  }
});

test('BCD lift cage: a pad flush with the ground and slim corner posts (b00 clipping: the diver crawling over its corner)', () => {
  const spec = getMission('b00').interactables.find((i) => i.kind === 'lift');
  assert.ok(spec, 'b00 has the lift');
  const lift = INTERACTABLE_KINDS.lift(spec);
  lift.object3d.updateMatrixWorld(true);
  const meshes = [];
  lift.object3d.traverse((n) => { if (n.isMesh) meshes.push(new THREE.Box3().setFromObject(n)); });
  assert.equal(meshes.length, 5, 'a pad and four posts');
  const pad = meshes.find((b) => b.max.y < 0.1), posts = meshes.filter((b) => b.max.y > 2);
  assert.ok(pad && posts.length === 4);
  assert.ok(pad.max.y <= 0.02, `the pad's top is ${pad.max.y.toFixed(3)} m over the ground`);
  assert.ok(pad.max.y - pad.min.y <= 0.07, 'and no thick block: a body vertex in it is never 5 cm deep');
  for (const b of posts) assert.ok(b.max.x - b.min.x <= 0.07 && b.max.z - b.min.z <= 0.07, `post ${(b.max.x - b.min.x) * 100} cm square`);
});
