/** M7 art pass 3: the lighthouse kit (art/lighthouse.js): the measured body is the first pass's lathe, everything else
 *  is unmeasured deco; the mole dressing stands on the ground. Built in node: no DOM, flat materials. */
import { test, assert, near } from './lib.mjs';
import * as THREE from 'three';
import { buildLighthouse, buildLighthouseMole, lighthouseMaterials, BODY_PLINTH, BODY_WALL, LENS, TD, TD_UNIFORM, TD_ARC_UNIFORM, CONSOLE } from '../../src/art/lighthouse.js';
import { MISSIONS } from '../../src/missions/index.js';
import { ART } from '../../src/missions/m07_chase_of_the_wolves.js';

const SKIP = /shadow|proxy|collider|collision|occluder|decal|selection|marker|halo|glow|blob|impostor/i; // world/placement-visual.js
const meshes = (o) => { const out = []; o.traverse((n) => { if (n.isMesh) out.push(n); }); return out; };
const bounds = (o) => { o.updateMatrixWorld(true); const b = new THREE.Box3(); for (const m of meshes(o)) b.expandByObject(m); return b; };

test('art lighthouse: body + deco, the body is exactly the old lathe surface (nav-measured)', () => {
  const g = buildLighthouse({ r: 2.5, h: 16 });
  assert.equal(g.name, 'kit:lighthouse');
  assert.equal(g.children.length, 2);
  const [body, deco] = g.children;
  assert.equal(body.name, 'kit:lighthouse'); assert.equal(deco.name, 'kit:lighthouse:deco');
  assert.deepEqual(BODY_PLINTH, [[3.125, 0], [3.125, 1.2], [2.5, 1.4]]);
  assert.deepEqual(BODY_WALL, [[2.5, 1.4], [1.8, 16], [0, 16]]);
  const bm = meshes(body);
  assert.equal(bm.length, 2, 'two merged meshes (plinth stone, wall render)');
  for (const m of bm) { assert.equal(m.name, 'kit:lighthouse'); assert.notEqual(m.userData.clip, false, 'the body is measured'); }
  const b = bounds(body);
  near(b.min.x, -3.125, 1e-6); near(b.max.x, 3.125, 1e-6); near(b.min.z, -3.125, 1e-6); near(b.max.z, 3.125, 1e-6);
  near(b.min.y, 0, 1e-6); near(b.max.y, 16, 1e-6);
  // the same triangles as the first pass's single lathe: 24 segments × 4 profile spans × 2 triangles
  const tris = bm.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
  assert.equal(tris, 24 * 4 * 2);
  const old = new THREE.LatheGeometry([[3.125, 0], [3.125, 1.2], [2.5, 1.4], [1.8, 16], [0, 16]].map(([r, y]) => new THREE.Vector2(r, y)), 24).toNonIndexed();
  const key = (P, i) => `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
  const want = new Set(); for (let i = 0; i < old.attributes.position.count; i++) want.add(key(old.attributes.position, i));
  for (const m of bm) { const P = m.geometry.attributes.position; for (let i = 0; i < P.count; i++) assert.ok(want.has(key(P, i)), `body vertex ${key(P, i)} is on the old lathe`); }
});

test('art lighthouse: every deco mesh (and the group) is clip: false, nothing matches the walkers\' SKIP names', () => {
  const g = buildLighthouse({ r: 2.5, h: 16 });
  const deco = g.children[1];
  assert.equal(deco.userData.clip, false);
  const dm = meshes(deco);
  assert.ok(dm.length >= 12, `consolidated deco meshes (${dm.length})`);
  for (const m of dm) assert.equal(m.userData.clip, false, m.name);
  g.traverse((n) => assert.ok(!SKIP.test(n.name || ''), n.name));
  // the deco stays near the tower: nothing beyond the drifts' reach, nothing below the ground, the vane on top
  const b = bounds(deco);
  assert.ok(b.max.x < 6.2 && b.min.x > -6.2 && b.max.z < 6.2 && b.min.z > -6.2, `deco within r ~6 (the drifts' tongues) (${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}, ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)})`);
  assert.ok(b.min.y > -0.05, `nothing under the ground (${b.min.y})`);
  assert.ok(b.max.y > 22 && b.max.y < 23, `rod tip at ~22.4 (${b.max.y})`);
  // the solid-looking pieces at ground level (not snow) keep within r 3.75 (the drums' rims): visual honesty by the plinth
  for (const m of dm) {
    if (/snow/.test(m.material.name)) continue;
    const P = m.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) if (P.getY(i) < 1.0) assert.ok(Math.hypot(P.getX(i), P.getZ(i)) <= 3.76, `${m.material.name} vertex at r ${Math.hypot(P.getX(i), P.getZ(i)).toFixed(2)} y ${P.getY(i).toFixed(2)}`);
  }
});

test('art lighthouse: the lens is one mesh in its own material, centred on the axis; the materials are cached per scope', () => {
  const g = buildLighthouse({ r: 2.5, h: 16 });
  const lens = meshes(g).filter((m) => m.material.name === 'kit:lighthouse_lens');
  assert.equal(lens.length, 1);
  const b = new THREE.Box3().setFromBufferAttribute(lens[0].geometry.attributes.position);
  near((b.min.x + b.max.x) / 2, 0, 1e-6); near((b.min.z + b.max.z) / 2, 0, 1e-6);
  assert.ok(b.min.y > 17.5 && b.max.y < 18.6, 'the drum sits in the glazing band');
  assert.ok(b.max.x > 0.39 && b.max.x < 0.41, `the bullseye belt at r 0.40 (${b.max.x.toFixed(3)})`);
  assert.equal(lens[0].castShadow, false);
  assert.equal(lens[0].material.userData.snowCover, true, 'the snow pass leaves the lens alone');
  // dark glass with the lamp's warm emissive (the shader paints the core, the prism rings and the panels' flash on it)
  const lm = lens[0].material, hsl = {};
  lm.color.getHSL(hsl); assert.ok(hsl.l < 0.2, `a dark drum (l ${hsl.l.toFixed(2)})`);
  assert.ok(lm.metalness >= 0.8 && lm.roughness <= 0.25, 'glassy: high metalness, low roughness');
  assert.ok(lm.emissive.r > 0.9 && lm.emissive.r > lm.emissive.b && lm.emissiveIntensity >= 1, 'a warm lamp inside');
  assert.ok(/lhlens/.test(lm.customProgramCacheKey()), 'the lens program is keyed');
  // the flash: four bullseye panels on a drum turning once in 24 s sweep a beam past any bearing every 6 s, each a
  // short blaze (cos^48 of the panel axis to the camera: ~1.5 s), never through the blackout screens
  const period = 360 / LENS.turn / LENS.panels;
  assert.ok(period >= 4 && period <= 8, `a flash every ${period} s`);
  assert.ok(LENS.sharp >= 24, 'a brief blaze, not a steady glow');
  assert.ok(LENS.screens[1] - LENS.screens[0] >= 90 && LENS.screens[1] - LENS.screens[0] <= 180, 'the landward screens');
  const M = lighthouseMaterials();
  assert.equal(M, lighthouseMaterials(), 'cached');
  // the trodden snow: a multiply decal (the snow's own grain shows through), feathered by its shader, out of the snow
  // pass, a light grey-blue: its strength calibrated in the linear frame to ~15-20 % under the snow on screen (0.20
  // read ~5 %, 0.44 ~12-17 %, 0.60 ~18-26 % at zoom 2 on the M7 mole), the gallery arc a little stronger (brighter deck)
  for (const t of [M.trodden, M.troddenArc]) {
    assert.equal(t.userData.snowCover, true);
    assert.equal(t.transparent, true, 'the trodden snow blends over the terrain (feathered by its shader)');
    assert.equal(t.depthWrite, false);
    assert.equal(t.blending, THREE.CustomBlending); assert.equal(t.blendSrc, THREE.ZeroFactor); assert.equal(t.blendDst, THREE.SrcColorFactor);
    assert.ok(/lhtrodden/.test(t.customProgramCacheKey()), 'the trodden program is keyed');
  }
  assert.equal(M.trodden.customProgramCacheKey(), M.troddenArc.customProgramCacheKey(), 'one program for both');
  assert.ok(TD.depth >= 0.4 && TD.depth <= 0.6 && TD.print > 0 && TD.print < TD.depth, `path strength ${TD.depth}`);
  assert.ok(TD.arcDepth >= TD.depth && TD.arcDepth <= 0.7, `arc strength ${TD.arcDepth}`);
  assert.ok(TD_UNIFORM.value.x === TD.depth && TD_ARC_UNIFORM.value.x === TD.arcDepth && TD_UNIFORM !== TD_ARC_UNIFORM);
  assert.equal(M.trodden.userData.tdUniform, TD_UNIFORM); assert.equal(M.troddenArc.userData.tdUniform, TD_ARC_UNIFORM);
  assert.ok(!M.render.userData.snowCover && !M.stone.userData.snowCover, 'the render and the stone take the scene\'s snow');
  assert.equal(M.verdigris.userData.snowCover, true, 'the dome keeps its verdigris under the explicit cap');
  assert.equal(M.red.userData.snowCover, true, 'the ribs and the lantern frame keep their red');
  assert.equal(M.cone.userData.snowCover, true, 'the storm cone stays black');
  assert.equal(M.glass.transparent, true);
  const names = new Set(meshes(g).map((m) => m.material.name));
  for (const n of ['kit:lighthouse_render', 'kit:lighthouse_stone', 'kit:lantern_glass', 'kit:lighthouse_lens', 'kit:lighthouse_flare', 'kit:window_glass', 'kit:lighthouse_trodden_arc', 'dressing:snow', 'dressing:castIron', 'kit:galv:b08a46', 'kit:steel:9a2f22', 'kit:steel:5c9a7e']) assert.ok(names.has(n), n);
  // one merged mesh per finish, 13 at most; every opaque finish casts (the depth proxy draws them all in the shadow
  // map), the lens, the glare, the decal and the lantern glass cast nothing
  const dm = meshes(g.children[1]), byMat = new Map();
  for (const m of dm) byMat.set(m.material.name, (byMat.get(m.material.name) || 0) + 1);
  for (const [n, c] of byMat) assert.equal(c, 1, `${n}: one merged mesh`);
  assert.ok(dm.length <= 13, `deco draws ${dm.length}`);
  for (const m of dm) assert.equal(m.castShadow, !/lighthouse_lens|lighthouse_flare|lighthouse_trodden|lantern_glass/.test(m.material.name), m.material.name);
});

test('art lighthouse: one depth-merge proxy draws every caster of the deco in the shadow map and the AO prepass', () => {
  const g = buildLighthouse({ r: 2.5, h: 16 });
  const [body, deco] = g.children;
  assert.equal(body.children.filter((c) => c.isDepthProxy).length, 0, 'the measured body is left as it was');
  const proxies = deco.children.filter((c) => c.isDepthProxy);
  assert.equal(proxies.length, 1);
  const p = proxies[0];
  assert.equal(p.isMesh, false, 'a mesh only inside a depth pass: scene walks, raycasts and the colour pass never see it');
  assert.equal(p.userData.clip, false);
  const casters = meshes(deco).filter((m) => m.castShadow);
  assert.ok(casters.length >= 9, `casters ${casters.length}`);
  assert.equal(p.userData.depthCount, casters.length);
  for (const m of casters) assert.equal(m.userData.depthGroup, p.userData.depthGroup, m.material.name);
  const verts = casters.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  assert.equal(p.geometry.attributes.position.count, verts, 'the casters\' triangles, all of them');
});

test('art lighthouse: the cupola ribs ride the copper and run up under the snow cap, which buries them (never pierced)', () => {
  const g = buildLighthouse({ r: 2.5, h: 16 });
  const dm = meshes(g.children[1]);
  const red = dm.find((m) => m.material.name === 'kit:steel:9a2f22'), snow = dm.find((m) => m.material.name === 'dressing:snow');
  // the cap: the snow above the cornice's lip (y > 19.45, r < 1.45); its rim (max r per 15° bin) wanders round the dome
  const S = snow.geometry.attributes.position, rim = new Array(24).fill(0); let capTop = 0;
  const bin = (x, z) => ((Math.round(Math.atan2(z, x) / (Math.PI / 12)) % 24) + 24) % 24;
  for (let i = 0; i < S.count; i++) {
    const x = S.getX(i), y = S.getY(i), z = S.getZ(i), r = Math.hypot(x, z);
    if (y < 19.45 || r > 1.45) continue;
    capTop = Math.max(capTop, y); const k = bin(x, z); rim[k] = Math.max(rim[k], r);
  }
  assert.ok(capTop > 20.65 && capTop < 20.8, `cap apex ${capTop.toFixed(2)}`);
  const rMin = Math.min(...rim), rMax = Math.max(...rim);
  assert.ok(rMin > 0.95 && rMax < 1.3 && rMax - rMin > 0.15, `an irregular rim on the dome (r ${rMin.toFixed(2)}..${rMax.toFixed(2)})`);
  // the cap's snow grain is continuous all round: wherever the cap meets itself (its seam's two columns, the crown) a
  // point has one uv (an angular u jumped there by 2πr / tile and drew a crease down the cap)
  const SU = snow.geometry.attributes.uv, uvAt = new Map(); let seamPts = 0;
  for (let i = 0; i < S.count; i++) {
    const x = S.getX(i), y = S.getY(i), z = S.getZ(i);
    if (y < 19.45 || Math.hypot(x, z) > 1.45) continue;
    const k = [x, y, z].map((q) => Math.round(q * 1e4)).join(','), u = [SU.getX(i), SU.getY(i)], o = uvAt.get(k);   // (round: sin 2π is −2e-16)
    if (!o) { uvAt.set(k, u); continue; }
    seamPts++;
    assert.ok(Math.abs(o[0] - u[0]) < 1e-4 && Math.abs(o[1] - u[1]) < 1e-4, `the cap's uv jumps at ${k}: (${o.map((q) => q.toFixed(3))}) vs (${u.map((q) => q.toFixed(3))})`);
  }
  assert.ok(seamPts >= 12, `points the cap shares (${seamPts})`);
  // the ribs: every red vertex on the dome lies 1.5 cm in to 6 cm out of the copper along its normal (no splinter
  // standing off, nothing coplanar with it)
  const D = [[1.40, 19.47], [1.31, 19.68], [1.14, 19.92], [0.90, 20.13], [0.62, 20.30], [0.34, 20.42], [0.12, 20.49], [0, 20.50]];
  const seg = (r) => { for (let i = 1; i < D.length; i++) if (r <= D[i - 1][0] && r >= D[i][0]) return i; return r > 1.4 ? 1 : D.length - 1; };
  const nrm = (r) => { const i = seg(r), dr = D[i][0] - D[i - 1][0], dy = D[i][1] - D[i - 1][1], L = Math.hypot(dr, dy); return [dy / L, -dr / L]; };
  const offDome = (r, y) => { const i = seg(r), [r0, y0] = D[i - 1], [nr, ny] = nrm(r); return (r - r0) * nr + (y - y0) * ny; };
  const I = red.geometry.attributes.position, ribs = new Map();
  for (let i = 0; i < I.count; i++) {
    const x = I.getX(i), y = I.getY(i), z = I.getZ(i), r = Math.hypot(x, z);
    if (y < 19.45 || y > 20.6 || r > 1.45 || r < 0.3) continue;
    const d = offDome(Math.min(1.4, r), y);
    assert.ok(d > -0.015 && d < 0.06, `rib vertex ${d.toFixed(3)} m off the dome at r ${r.toFixed(2)}, y ${y.toFixed(2)}`);
    const k = ((Math.round(Math.atan2(z, x) / (Math.PI / 6)) % 12) + 12) % 12;
    (ribs.get(k) || ribs.set(k, []).get(k)).push([x, y, z, r]);
  }
  assert.equal(ribs.size, 12, 'twelve ribs');
  // each rib shows below the cap and ends under its full body (inside 0.92 of the rim at its azimuth), where a ray cast
  // out along the dome's normal from every vertex of its buried end meets the snow's skin 2.5 cm or more beyond it
  const cap = new THREE.Mesh(snow.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster(); let buried = 0;
  for (const [k, vs] of ribs) {
    const rimK = rim[(k * 2) % 24], rEnd = Math.min(...vs.map((v) => v[3]));
    assert.ok(rEnd >= 0.75 && rEnd <= 0.92 * rimK, `rib ${k} ends at r ${rEnd.toFixed(2)} (rim ${rimK.toFixed(2)})`);
    assert.ok(vs.some((v) => v[3] > rimK), `rib ${k} shows below the cap`);
    for (const [x, y, z, r] of vs) {
      if (r > 0.9 * rimK) continue;
      const [nr, ny] = nrm(Math.min(1.4, r)), a = Math.atan2(z, x);
      ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(nr * Math.cos(a), ny, nr * Math.sin(a)).normalize());
      const hit = ray.intersectObject(cap)[0];
      assert.ok(hit && hit.distance >= 0.025, `rib ${k} vertex at r ${r.toFixed(2)} under ${hit ? hit.distance.toFixed(3) : 'no'} m of snow`);
      buried++;
    }
  }
  assert.ok(buried >= 12 * 4, `buried rib vertices (${buried})`);
});

test('art lighthouse: the gallery consoles are ogee brackets dying into the wall', () => {
  const xs = CONSOLE.map(([x]) => x), ys = CONSOLE.map(([, y]) => y);
  near(Math.max(...xs), 0.72, 1e-9, 'the head 0.72 out under the bed course');
  assert.ok(Math.min(...ys) < -1.1 && Math.min(...ys) > -1.25, 'about 1.15 m deep');
  // after the head, the face sweeps back to the wall monotonically, convex then concave (an ogee, not steps)
  const face = CONSOLE.slice(2);
  for (let i = 1; i < face.length; i++) { assert.ok(face[i][0] <= face[i - 1][0] + 1e-9, 'never steps out'); assert.ok(face[i][1] < face[i - 1][1], 'always down'); }
  const mid = face[Math.floor(face.length / 2)];
  assert.ok(mid[0] > 0.25 && mid[0] < 0.5, `the ogee's waist (${mid[0].toFixed(2)})`);
  assert.ok(face.every(([x], i) => i < 2 || x < face[i - 1][0] - 1e-9 || x < 0.06), 'no vertical risers on the face');
});

test('art lighthouse: another size scales the kit (not M7)', () => {
  const g = buildLighthouse({ r: 2.0, h: 12 });
  near(g.scale.x, 0.8); near(g.scale.y, 0.75);
  g.updateMatrixWorld(true);
  const b = bounds(g.children[0]);
  near(b.max.x, 2.5, 1e-6); near(b.max.y, 12, 1e-6);
});

test('art lighthouse: the mole dressing (M7 ART.lighthouse) builds on a flat ground, every piece on or above it', () => {
  assert.ok(ART.lighthouse?.mast && ART.lighthouse.bell && ART.lighthouse.sign && ART.lighthouse.path?.length >= 2);
  const mats = { stone: new THREE.MeshStandardMaterial({ name: 'm07art:stone' }), iron: new THREE.MeshStandardMaterial({ name: 'm07art:iron' }), timber: new THREE.MeshStandardMaterial({ name: 'm07art:timber' }) };
  const g = buildLighthouseMole(ART.lighthouse, { groundY: () => 0, mats });
  assert.equal(g.name, 'm07art:lighthouse');
  const ms = meshes(g);
  assert.ok(ms.length > 10);
  g.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const m of ms) {
    const P = m.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); assert.ok(v.y >= -0.05, `${m.name || m.material.name} at y ${v.y.toFixed(2)}`); }
  }
  const b = bounds(g);
  assert.ok(b.max.y > 9 && b.max.y < 9.2, `the mast's truck at ~9.05 (${b.max.y})`);
  // the pass's finishes are shared (they merge into the coping's draws: the mast, its yard, the halyards, the bell
  // frame and hood and the board's posts are the pass's timber, the cone's hoop, the bell and the fittings its iron);
  // only the trodden decal, the black storm cone and the board's painted face are finishes of their own
  const names = new Set(ms.map((m) => m.material.name));
  for (const n of ['m07art:stone', 'm07art:iron', 'm07art:timber', 'kit:lighthouse_trodden', 'kit:canvas:1e1c1a']) assert.ok(names.has(n), n);
  const own = [...names].filter((n) => !/^m07art:/.test(n));
  assert.deepEqual(own.sort(), ['kit:canvas:1e1c1a', 'kit:lighthouse_trodden', 'kit:sign:wehrmacht:SPERRGEBIET'], `the mole's own finishes (${own})`);
  // the storm cone, apex up, is hoisted to the masthead: above the yard (7.0), under the truck, close beside the mast,
  // black (the scene's snow pass leaves it alone)
  const cone = ms.find((m) => m.material.name === 'kit:canvas:1e1c1a');
  assert.equal(cone.material.userData.snowCover, true);
  const cb = new THREE.Box3().setFromObject(cone);
  assert.ok(cb.min.y > 7.1 && cb.max.y < 9.0, `cone ${cb.min.y.toFixed(2)}..${cb.max.y.toFixed(2)} between the yard and the truck`);
  const cd = Math.hypot((cb.min.x + cb.max.x) / 2 - ART.lighthouse.mast[0], (cb.min.z + cb.max.z) / 2 - ART.lighthouse.mast[1]);
  assert.ok(cd > 0.3 && cd < 0.6, `cone ${cd.toFixed(2)} m from the mast`);
  // the path: no shadow, the shader's uv (s along in metres, 0..1 across), about a metre wide on the mole, narrower
  // where it leaves the patrol's beat and at the stair foot
  const path = ms.find((m) => m.name === 'm07art:lighthouse:path');
  assert.equal(path.castShadow, false);
  const U = path.geometry.attributes.uv; assert.ok(U.getX(U.count - 1) > 15 && U.getX(U.count - 1) < 30, 'uv.x = metres along'); assert.equal(U.getY(0), 0); assert.equal(U.getY(1), 1);
  const PW = path.geometry.attributes.position, wAt = (k) => Math.hypot(PW.getX(2 * k) - PW.getX(2 * k + 1), PW.getZ(2 * k) - PW.getZ(2 * k + 1));
  const nk = PW.count / 2, wMid = wAt(Math.floor(nk / 2));
  assert.ok(wMid > 0.8 && wMid < 1.2, `path ${wMid.toFixed(2)} m wide mid-way`);
  assert.ok(wAt(0) < 0.6 && wAt(nk - 1) < 0.7, `narrow at its ends (${wAt(0).toFixed(2)}, ${wAt(nk - 1).toFixed(2)})`);
  // the path ends 0.3-0.5 m short of step 0's face (r 3.575 at θ 0 from the tower at (76.5, 171))
  const P = path.geometry.attributes.position, n = P.count;
  const ex = (P.getX(n - 1) + P.getX(n - 2)) / 2, ez = (P.getZ(n - 1) + P.getZ(n - 2)) / 2;
  const d = Math.hypot(ex - 76.5, ez - 171) - 3.575;
  assert.ok(d > 0.3 && d < 0.5, `path end ${d.toFixed(2)} m short of the stair`);
  // the board faces the patrol's approach: its local +z points at signFaces
  const sign = g.children.find((c) => /kit:sign/.test(c.name));
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(sign.quaternion);
  const want = new THREE.Vector3(ART.lighthouse.signFaces[0] - ART.lighthouse.sign[0], 0, ART.lighthouse.signFaces[1] - ART.lighthouse.sign[1]).normalize();
  near(dir.dot(want), 1, 1e-6);
});

test('art lighthouse: M7 keeps its lighthouse structure (r 2.5, h 16, B.HIGH) and the mole spec keeps clear of the gear', () => {
  const m07 = MISSIONS.find((m) => m.id === 'm07');
  const lh = m07.structures.find((s) => s.id === 'lighthouse');
  assert.equal(lh.type, 'lighthouse'); near(lh.r, 2.5); near(lh.h, 16); near(lh.x, 76.5); near(lh.z, 171);
  const L = ART.lighthouse;
  for (const [x, z] of [L.mast, L.bell, L.sign, ...L.path]) {
    assert.ok(Math.hypot(x - 79.6, z - 156) > 3.5, 'clear of faering_ml');
    assert.ok(Math.hypot(x - 78.2, z - 163.5) > 2.5, 'clear of gear_ml');
    assert.ok(x > 56 && x < 84 && z > 146 && z < 187, 'on the mole');
  }
  for (const [x, z] of [L.mast, L.bell, L.sign]) assert.ok(Math.hypot(x - 76.5, z - 171) > 4.5, 'off the tower and its stair');
});
