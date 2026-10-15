/**
 * The Marine's raft, drawn (abilities/raft-actions.js; user 2026-10-14: "animate better how [...] the marine very
 * quickly deflated and folds the raft. Also when the raft is inflated it should be very clear it gets inflated").
 * Visual only: a post pass after every model's own update (Game.render → raftActionsFrame, after the Spy's pass), its
 * bone writes through the model's BoneGuard like the other contact poses, everything a function of the sim record and
 * the interpolated sim time.
 *
 *  INFLATE (T, 4.0 s)  he kneels facing the launch spot and swings the strapped pack off his back onto the ground in
 *    front of his knees, undoes the straps and pushes the pleated hull out over the water — the pleats open out, the
 *    sheet slides out to where the raft will float — flips the two folded-in sides out (his left hand the left one, his
 *    right the right): a flat, crumpled sheet lies on the water, the paddles on it. His left hand finds the CO2 valve
 *    on the stern tube and jerks its cord (the hiss); the chambers fill one after the other from their inlets (art/
 *    raft-hull.js: the sections growing from the flat double layer to round tubes, the bow rising, the creases
 *    smoothing out and the crease shading fading), his left hand on the valve and his right on the stern tube riding up
 *    with them; full, it bounces once and settles; he screws the valve shut, pats the tube, the paddles go into their
 *    rowlocks and he gets up. The hull drawn is the raft's own library model, built here when the action starts and
 *    handed to the raft the sim spawns at the end (rec.handoff): the same object, no swap, no pop.
 *  PACK (H, 3.6 s)  he kneels facing the raft and unscrews the valve nearest him (the hiss): the chambers sag (the
 *    middle of each first) and collapse flat in turn while both his hands press the air out of the near tube; he drags
 *    the flat sheet to his knees (it swings round to lie straight out in front of him), folds the sides in over the
 *    middle, gathers the strip hand over hand into a stack of pleats at his knees, presses it and buckles the straps —
 *    the strapped pack — and swings it up onto his back. The raft leaves the sim at 2.0 s as before; its model stays in
 *    the scene, posed here, until the pack is made.
 *  THE PACK ON HIS BACK  whenever the Marine carries the raft (inflatableBoat in his kit) the strapped pack rides across
 *    the small of his back (attached to spine_01: it follows his walk, crawl and swim).
 *
 * Measurements for tests / tools: raftMetrics(marine) (hull volume fraction drawn, pack attached, hand distances).
 * @module art/raft-actions
 */
import * as THREE from 'three';
import { RAFT, chamberLevel, bounceAt, hullVolume } from '../abilities/raft-actions.js';
import { RaftHull, hullState, tubeLoop, SHEET, HULL } from './raft-hull.js';
import { realBody, contactMarks, turn, limbIK, frameOf, handQ, wp, wq, finish } from './knife-kill.js';
import { clipPose, capturePose, mixPose } from './pose-blend.js';
import { createLibraryVehicleModel } from './vehicle-model.js';
import { vehicleDef } from '../entities/vehicle.js';
import { headingToRotY } from '../core/math.js';
import { groundOf, waterOf } from './boat-rest.js';
import { HULL_PLANS } from './water/hulls.js';

const { Vector3, Quaternion, Matrix4, Object3D } = THREE;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-6, b - a));
const bump = (t, a, b) => { const x = clamp((t - a) / Math.max(1e-6, b - a), 0, 1); return Math.sin(Math.PI * x); };
const BASE_UMW = Object3D.prototype.updateMatrixWorld;
const upd = (o) => BASE_UMW.call(o, true);
const bonesOf = (m) => m?.real?.inner?.bones || null;

/** Visual marks (s from the action start) beyond the sim's phases. */
export const RV = Object.freeze({
  aIn: 0.15, aOut: 0.3,
  // deploy: the pack off his back to the ground, swapped for the hull's own pleat stack once the straps are off
  packDown: [0.05, 0.42], swapIn: 0.6, press: [0.42, 0.62], unfoldL: [1.0, 1.17], unfoldR: [1.12, 1.29],
  slide: [0.6, 1.1], paddlesIn: 1.1, rowlocks: [3.62, 3.92], valveTwist: [3.62, 3.74], pat: [3.66, 3.8], riseD: [3.7, 4.0],
  // pack
  foldL: [2.05, 2.27], foldR: [2.3, 2.52], gather: [2.5, 3.15], pressP: [3.1, 3.28], swapOut: 3.28, packUp: [3.28, 3.56], riseP: [3.3, 3.6],
  kneelFrac: 0.45,     // the 'plant' clip's frame used as the kneel
});

// ------------------------------------------------------------------ the pack prop

/** Pack size (m): width across his back, thickness, height (on the ground: x across, y up, z along). */
export const PACK = Object.freeze({ w: 0.52, h: 0.15, d: 0.34 });
let PACK_MATS = null;
function packMats() {
  return (PACK_MATS ||= {
    rubber: Object.assign(new THREE.MeshStandardMaterial({ color: 0x262624, roughness: 0.72, metalness: 0.0 }), { name: 'raft_pack_rubber' }),
    strap: Object.assign(new THREE.MeshStandardMaterial({ color: 0x6b6450, roughness: 0.92 }), { name: 'raft_pack_strap' }),
    metal: Object.assign(new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.35, metalness: 0.8 }), { name: 'raft_pack_buckle' }),
  });
}
let PACK_GEO = null;
/** The strapped pack: the pleated rubber stack (its layers showing round the sides), two webbing straps, buckles. */
export function makePack() {
  const M = packMats();
  if (!PACK_GEO) {
    const g = new THREE.BoxGeometry(PACK.w, PACK.h, PACK.d, 10, 6, 6);
    const pa = g.attributes.position, hw = PACK.w / 2, hh = PACK.h / 2, hd = PACK.d / 2;
    for (let k = 0; k < pa.count; k++) {
      let x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
      // rounded edges, the folds bulging at the ends, the pleat layers as grooves round the sides
      const ex = Math.abs(x) / hw, ey = Math.abs(y) / hh, ez = Math.abs(z) / hd;
      const round = 1 - 0.18 * Math.pow(Math.max(ey, 0), 3) * (Math.pow(ex, 4) + Math.pow(ez, 4));
      x *= round; z *= round;
      const groove = 0.012 * Math.abs(Math.sin(((y + hh) / PACK.h) * Math.PI * 5));
      if (ez > 0.95) z -= Math.sign(z) * groove; if (ex > 0.95) x -= Math.sign(x) * groove * 0.6;
      y += 0.008 * Math.sin(x * 23 + z * 17) * (1 - ey * 0.5);
      pa.setXYZ(k, x, y + hh, z);
    }
    g.computeVertexNormals();
    const strap = new THREE.BoxGeometry(0.04, PACK.h + 0.012, PACK.d + 0.012); strap.translate(0, PACK.h / 2, 0);
    const buckle = new THREE.BoxGeometry(0.05, 0.012, 0.035); buckle.translate(0, PACK.h + 0.008, -0.04);
    const handle = new THREE.TorusGeometry(0.05, 0.007, 4, 10, Math.PI); handle.rotateY(Math.PI / 2); handle.translate(0, PACK.h, 0);
    PACK_GEO = { body: g, strap, buckle, handle };
  }
  const grp = new THREE.Group(); grp.name = 'raft_pack';
  const body = new THREE.Mesh(PACK_GEO.body, M.rubber); body.castShadow = body.receiveShadow = true;
  grp.add(body);
  for (const sx of [-0.15, 0.15]) {
    const s = new THREE.Mesh(PACK_GEO.strap, M.strap); s.position.x = sx; s.castShadow = true; grp.add(s);
    const b = new THREE.Mesh(PACK_GEO.buckle, M.metal); b.position.x = sx; grp.add(b);
  }
  const h = new THREE.Mesh(PACK_GEO.handle, M.strap); grp.add(h);
  grp.traverse((o) => { if (o.isMesh) { o.geometry.userData.shared = true; o.material.userData.shared = true; } });
  return grp;
}

/**
 * Where the pack rides on a character's back: spine_01-local transform (measured once per character in its idle pose
 * from its LOD0 mesh: the small of the back, the pack's thickness out from it, its width across, its height up).
 */
const BACKS = new Map();
function backFrame(m) {
  const id = m.characterId;
  if (BACKS.has(id)) return BACKS.get(id);
  const B = bonesOf(m), root = m.root;
  let mesh = null;
  m.real.inner.object?.traverse((o) => { if (!mesh && o.isSkinnedMesh && /^LOD0$/.test(o.name)) mesh = o; });
  const keep = capturePose(m), idle = clipPose(m, 'idle', 0);
  if (idle) { for (const [k, q] of idle.q) if (B[k]) B[k].quaternion.copy(q); if (idle.pelvis) B.pelvis.position.copy(idle.pelvis); }
  upd(root);
  const s1 = root.worldToLocal(wp(B.spine_01)), s2 = root.worldToLocal(wp(B.spine_02));
  const y0 = s1.y + 0.02, y1 = s2.y + 0.06;
  let back = -0.12;
  if (mesh) {
    const pos = mesh.geometry.attributes.position, v = new Vector3();
    back = 1;
    for (let i = 0; i < pos.count; i += 1) {
      mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); root.worldToLocal(v);
      if (Math.abs(v.x - s1.x) < 0.12 && v.y > y0 && v.y < y1 && v.z < back) back = v.z;
    }
    if (back > 0.5) back = -0.12;
  }
  // root-local pack frame: standing on end on the left half of his back (the harpoon gun is slung down the right half):
  // its length (x) up his spine, its thickness (y) out of his back (-z), its depth (z) across toward his left
  const c = new Vector3(s1.x + PACK.d / 2 + 0.01, (y0 + y1) / 2 + 0.06, back - PACK.h / 2 - 0.006);
  const basis = new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, -1), new Vector3(-1, 0, 0));
  const Wpack = root.matrixWorld.clone().multiply(new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(basis))
    .multiply(new Matrix4().makeTranslation(0, -PACK.h / 2, 0));
  const local = B.spine_01.matrixWorld.clone().invert().multiply(Wpack);
  for (const [k, q] of keep.q) if (B[k]) B[k].quaternion.copy(q);
  if (keep.pelvis) B.pelvis.position.copy(keep.pelvis);
  upd(root);
  const out = { local };
  BACKS.set(id, out);
  return out;
}

/** The diver's pack (one per Marine, kept on the unit). */
function packOf(c) {
  if (!c._raftPack) c._raftPack = { obj: makePack(), bone: null, mode: 'hidden' };
  return c._raftPack;
}
/** Put the pack on his back (attached to spine_01, re-attached when his body changes, e.g. the wetsuit). */
function packOnBack(c, m) {
  const P = packOf(c), B = bonesOf(m);
  if (!B?.spine_01) return P;
  if (P.bone !== B.spine_01 || P.mode !== 'back') {
    const F = backFrame(m);
    B.spine_01.add(P.obj);
    F.local.decompose(P.obj.position, P.obj.quaternion, P.obj.scale);
    P.obj.updateMatrixWorld(true);
    P.bone = B.spine_01; P.mode = 'back';
  }
  P.obj.visible = true;
  return P;
}
/** Take the pack in hand: a scene object posed in world space by the action. */
function packFree(c, scene) {
  const P = packOf(c);
  if (P.mode !== 'free') { scene.attach(P.obj); P.mode = 'free'; P.bone = null; }
  P.obj.visible = true;
  return P;
}
function packHide(c) {
  const P = c._raftPack;
  if (P) P.obj.visible = false;
}
const _m4 = new Matrix4(), _m4b = new Matrix4(), _q0 = new Quaternion(), _q1 = new Quaternion(), _v0 = new Vector3(), _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _s1 = new Vector3(1, 1, 1);
/** Pose the free pack at world position p with world rotation q. */
function placePack(P, p, q) {
  const o = P.obj, par = o.parent;
  _m4.compose(p, q, _s1);
  if (par) { par.updateWorldMatrix(true, false); _m4b.copy(par.matrixWorld).invert(); _m4.premultiply(_m4b); }
  _m4.decompose(o.position, o.quaternion, o.scale);
  o.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ the pass

/** Is the pass needed this frame: a raft action under way, or a Marine in the mission (his pack)? */
export function raftPassWanted(world) {
  if (world?.raftActs?.length) return true;
  const list = world?.commandos;
  if (!list) return false;
  if (world._raftDiverN !== list.length) { world._raftDiverN = list.length; world._raftDiver = list.some((c) => c.role === 'diver'); }
  return world._raftDiver;
}

/**
 * Pose every raft action under way and keep each Marine's pack where it belongs (Game.render, after the Spy's pass).
 * @param {object} world @param {number} [alpha] sim interpolation of this frame @param {number} [simDt]
 */
export function raftActionsFrame(world, alpha = 1, simDt = 1 / 60) {
  const now = world.time - (1 - clamp(alpha, 0, 1)) * simDt;
  const list = world.raftActs;
  const busy = _busy; busy.clear();
  if (list?.length) {
    for (let i = list.length - 1; i >= 0; i--) {
      const rec = list[i];
      let keep = false;
      try { keep = rec.superseded ? false : rec.kind === 'inflate' ? inflateFrame(world, rec, now) : packFrame(world, rec, now); } catch (e) { console.warn('[raft-actions]', e?.stack || e); }
      if (keep) busy.add(rec.a);
      else { try { endRecord(world, rec); } catch { /* best effort */ } list.splice(i, 1); }
    }
  }
  // the pack on the back of every Marine who carries the raft
  for (const c of world.commandos || []) {
    if (c.role !== 'diver' || busy.has(c)) continue;
    const m = c.model;
    const want = c.alive !== false && !c.removed && c.has?.('inflatableBoat') && realBody(m);
    if (want) packOnBack(c, m); else packHide(c);
  }
}
const _busy = new Set();

function endRecord(world, rec) {
  const v = rec.vis;
  if (!v) return;
  if (rec.kind === 'inflate') {
    if (!v.handed && v.model) { v.hull?.dispose(); v.model.root.removeFromParent(); v.model.dispose?.(); }
  } else if (v.hull) {
    const raft = rec.raft;
    if (raft && !raft.removed) { v.hull.dispose(); restoreBody(v); } // cut short before it was in his kit: the raft as it was
    else { v.hull.dispose(); raft?.model?.root?.removeFromParent(); raft?.model?.dispose?.(); }
  }
  v.hull = null;
}

/** Overlay weight of the Marine's pose: in from the start, out after `end` (or quickly once he walks off). */
function overlayW(rec, t, end) {
  const vis = rec.vis, a = rec.a;
  if (vis.walkAt == null && (rec.cancelled != null || (t > end && (a.path || a._moving)))) vis.walkAt = Math.max(t, rec.cancelled != null ? rec.cancelled - rec.t0 : 0);
  return ramp(t, 0, RV.aIn) * (1 - ramp(t, end, end + RV.aOut)) * (vis.walkAt != null ? 1 - ramp(t, vis.walkAt, vis.walkAt + 0.2) : 1);
}

/** Surface height (world y) at x, z: the drawn ground, or the water over it (art/boat-rest.js, as the boats rest). */
function surfaceAt(world, x, z) {
  const g = groundOf(world)(x, z), l = waterOf(world)(x, z);
  const v = Math.max(Number.isFinite(g) ? g : -Infinity, l ?? -Infinity);
  return Number.isFinite(v) ? v : (typeof world.groundY === 'function' ? world.groundY(x, z) || 0 : 0);
}

// ------------------------------------------------------------------ the water kept out

/**
 * The water cut out of the rafts drawn here outside the sim (art/water/hulls.js; user 2026-10-15: "When the inflatable
 * raft is inflated there should not be water or the ground inside it"): the hull inflating before it is handed to the
 * raft the sim spawns, and the flat sheet left after the raft went into his kit (2.0 s) until it is gathered into the
 * pack. Without it the sea's swell washed over the spread sheet and over the floor of the hull filling on it (the sim's
 * raft has its own: art/water.js). The plan is the raft's own (inside the tube's centreline) while the sides lie out,
 * the middle band once they are folded in, over the part of the strip not yet gathered into the stack.
 * @param {object} world
 * @param {(o: THREE.Object3D, plan: object, dz: number) => void} add called with each hull's model space (the visual),
 *   its plan and the plan's centre along +z
 */
export function raftDryHulls(world, add) {
  const list = world?.raftActs;
  if (!list?.length) return;
  const P0 = HULL_PLANS.raft;
  for (const rec of list) {
    const vis = rec.vis, S = vis?.S;
    if (!S || !vis.hull || rec.superseded) continue;
    const model = rec.kind === 'inflate' ? (vis.handed ? null : vis.model) : (rec.raft?.removed || rec.gone != null ? rec.raft?.model : null);
    if (!model?.isReady || !model.root.visible || !model.root.parent || !model.visual?.object3d) continue;
    const P = (vis.dry ||= { ...P0 });
    P.b = Math.max(S.foldL, S.foldR) > 0.02 ? SHEET.hinge - 0.03 : P0.b;
    let dz = 0;
    if (S.gather > 0) {
      // (art/raft-hull.js foldGather: the stack at the near end, the rest of the strip lying flat beyond it)
      const Lt = 2 * SHEET.near, G = S.gather * Lt, a0 = Math.min(G, SHEET.pleat) + 0.1, a1 = Math.min(G, SHEET.pleat) + Lt - G - 0.25;
      if (a1 - a0 < 0.3) continue;
      dz = S.near * SHEET.near - S.near * (a0 + a1) / 2;
      P.aF = P.aA = (a1 - a0) / 2;
    } else { P.aF = P0.aF; P.aA = P0.aA; }
    add(model.visual.object3d, P, dz);
  }
}

// ------------------------------------------------------------------ inflate

function inflateFrame(world, rec, now) {
  const a = rec.a, m = a?.model, T = rec.T;
  const t = now - rec.t0;
  if (t < 0) return true;
  const vis = (rec.vis ||= { now: null });
  const dt = vis.now != null ? Math.max(0, now - vis.now) : 0;
  vis.now = now;
  const cancelled = rec.cancelled != null ? rec.cancelled - rec.t0 : null;
  const end = cancelled ?? T.dur;
  const done = rec.raft || rec.ended != null;
  if (t > end + RV.aOut + 0.3 || a.alive === false || a.removed || (vis.walkAt != null && t > vis.walkAt + 0.45)) return false;
  // the hull: the raft's own library model, built now (handed to the raft the sim spawns at the end)
  if (!vis.model && !vis.noModel && cancelled == null) setupInflateModel(world, rec);
  if (cancelled != null && vis.model && !vis.handed) {
    // cut short: the hull gathered up again (shrinking in to his knees over 0.3 s), the pack back on his back
    const k = ramp(t, cancelled, cancelled + 0.3), root = vis.model.root;
    if (k < 1 && vis.hull) { root.scale.setScalar(Math.max(0.02, 1 - k)); root.updateMatrixWorld(true); }
    else { vis.hull?.dispose(); vis.hull = null; root.removeFromParent(); vis.model.dispose?.(); vis.model = null; }
  }
  const S = vis.S ||= hullState();
  deployState(S, cancelled != null ? Math.min(t, cancelled) : t);
  if (vis.model && !vis.handed) poseInflateHull(world, rec, cancelled != null ? Math.min(t, cancelled) : t, dt, S);
  // the Marine
  if (!realBody(m)) return t < end + RV.aOut;
  const P = packOf(a);
  const B = bonesOf(m), M = contactMarks(m);
  if (!M) return false;
  const packCtl = t < RV.swapIn && cancelled == null && (a.has?.('inflatableBoat') || !done);
  if (packCtl) packFree(a, world.scene || m.root.parent); else if (cancelled != null && a.has?.('inflatableBoat')) packOnBack(a, m); else packHide(a);
  deployPose(world, rec, m, B, M, t, end, S, P, packCtl);
  finish(m);
  return true;
}

function setupInflateModel(world, rec) {
  const vis = rec.vis;
  let model = null;
  try { model = createLibraryVehicleModel('raft', vehicleDef('raft'), {}); } catch { model = null; }
  if (!model || !world.scene) { vis.noModel = true; return; }
  vis.model = model;
  const L = rec.L, root = model.root;
  const gy = typeof world.groundY === 'function' ? world.groundY(L.x, L.z) || 0 : 0;
  root.position.set(L.x, gy, L.z);
  root.rotation.y = headingToRotY(L.heading);
  root.visible = false;
  world.scene.add(root);
  vis.fakeV = { world, x: L.x, z: L.z, heading: L.heading, y: 0, speed: 0, reversing: false, driver: null, crew: [], occupants: [], spawn: {}, def: vehicleDef('raft') };
  // handed to the raft spawned at the end: the library raft again (its own geometry, paddles in the rowlocks)
  rec.handoff = () => {
    if (!vis.model || vis.handed) return null;
    vis.hull?.dispose(); vis.hull = null;
    const body = model.root.children.find((c) => c.name === 'body');
    if (body) body.position.z = 0;
    model.root.visible = true;
    vis.handed = true;
    return model;
  };
}

/** The deploy's hull state at t (abilities/raft-actions.js RAFT.deploy). */
function deployState(S, t) {
  for (let k = 0; k < 4; k++) S.fill[k] = chamberLevel(k, t);
  S.bounce = bounceAt(t);
  S.front = 1;
  S.near = -1;
  S.gather = 1 - ramp(t, RAFT.deploy.spread[0], RAFT.deploy.spread[1]);
  S.press = 1 - ramp(t, RV.press[0], RV.press[1]);
  S.foldL = 1 - ramp(t, RV.unfoldL[0], RV.unfoldL[1]);
  S.foldR = 1 - ramp(t, RV.unfoldR[0], RV.unfoldR[1]);
  S.paddle = ramp(t, RV.rowlocks[0], RV.rowlocks[1]);
  S.paddleShow = t >= RV.paddlesIn ? 1 : 0;
}

/** The body group of a library vehicle model (root → body → visual). */
const bodyOf = (model) => model.root.children.find((c) => c.name === 'body') || null;

function poseInflateHull(world, rec, t, dt, S) {
  const vis = rec.vis, model = vis.model;
  if (!model.isReady) return;
  const root = model.root, body = bodyOf(model);
  if (!vis.hull) {
    vis.hull = new RaftHull(model.visual);
    // where the stack starts: at his knees (raft-local z), and how high the ground is there (the bank)
    const L = rec.L, f = rec.from, d = Math.hypot(L.x - f.x, L.z - f.z);
    vis.zKnee = -d + 0.6;
    vis.dz0 = vis.zKnee + SHEET.near - 0.02;   // the stack's near edge at his knees
    const kx = f.x + Math.cos(f.h) * 0.6, kz = f.z + Math.sin(f.h) * 0.6;
    vis.yKnee = surfaceAt(world, kx, kz);
    // one boat-pose step with the library geometry first: the rest pose samples its underside once (art/boat-rest.js)
    model.update(1 / 60, vis.fakeV);
  }
  if (dt > 0) model.update(dt, vis.fakeV);   // the raft's own boat pose (afloat: the bob) — as it will be once handed over
  root.visible = t >= RV.swapIn;
  vis.hull.apply(S);
  // the stack slides out from his knees to where it floats as the pleats open out; on the bank it lies on the ground
  if (body) {
    const k = ramp(t, RV.slide[0], RV.slide[1]);
    body.position.z = vis.dz0 * (1 - k);
    const land = 1 - ramp(t, RV.slide[0] + 0.1, RV.slide[1] - 0.1);
    if (land > 0) {
      const want = vis.yKnee - root.position.y;
      body.position.y += (Math.max(body.position.y, want) - body.position.y) * land;
      body.rotation.x *= 1 - land; body.rotation.z *= 1 - land;
    }
  }
  root.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ pack

function packFrame(world, rec, now) {
  const a = rec.a, m = a?.model, T = rec.T;
  const t = now - rec.t0;
  if (t < 0) return true;
  const vis = (rec.vis ||= { now: null });
  vis.now = now;
  const cancelled = rec.cancelled != null ? rec.cancelled - rec.t0 : null;
  const end = cancelled ?? T.dur;
  if (t > end + RV.aOut + 0.3 || a.alive === false || a.removed || (vis.walkAt != null && t > vis.walkAt + 0.45)) return false;
  const raft = rec.raft, gone = raft?.removed || rec.gone != null;
  // cut short (a new order): before the raft was in his kit it fills out again where it lies (it never left the sim);
  // after, the fold runs on fast to the pack, which goes onto his back
  const cutBefore = cancelled != null && !gone, cutAfter = cancelled != null && gone;
  const tv = cutAfter && t > cancelled ? Math.min(RV.swapOut + 0.01, cancelled + (t - cancelled) * Math.max(1, (RV.swapOut - cancelled) / 0.3)) : t;
  const S = vis.S ||= hullState();
  packState(S, cutBefore ? Math.min(t, cancelled) : tv, rec);
  if (cutBefore) {
    const k = ramp(t, cancelled, cancelled + 0.3);
    for (let i = 0; i < 4; i++) S.fill[i] += (1 - S.fill[i]) * k;
    vis.undrag = k;
    if (vis.hull && raft?.model?.isReady && k < 1) poseDeflateHull(world, rec, cancelled, S);
    else if (vis.hull) { vis.hull.dispose(); vis.hull = null; restoreBody(vis); }
  } else if (raft?.model?.library && raft.model.isReady && tv < RV.swapOut + 0.02) poseDeflateHull(world, rec, tv, S);
  else if (vis.hull && tv >= RV.swapOut) { raft.model.root.visible = false; }
  if (!realBody(m)) return t < end + RV.aOut;
  const B = bonesOf(m), M = contactMarks(m);
  if (!M) return false;
  // the pack: made at swapOut (in place of the stack), lifted onto his back; cut short after 2.0 s: onto it once made
  let packCtl = false;
  if (gone && tv >= RV.swapOut) {
    if (cancelled == null && t < RV.packUp[1]) { packFree(a, world.scene || m.root.parent); packCtl = true; }
    else if (a.has?.('inflatableBoat')) packOnBack(a, m);
    if (vis.hull && raft?.model?.root) raft.model.root.visible = false;
  } else packHide(a);
  packPose(world, rec, m, B, M, t, end, S, packOf(a), packCtl);
  finish(m);
  return true;
}

/** The pack's hull state at t (abilities/raft-actions.js RAFT.pack). */
function packState(S, t, rec) {
  for (let k = 0; k < 4; k++) S.fill[k] = chamberLevel(k, t, true);
  S.bounce = 0;
  S.front = -1;
  S.near = rec.vis?.near ?? -1;
  S.foldL = ramp(t, RV.foldL[0], RV.foldL[1]);
  S.foldR = ramp(t, RV.foldR[0], RV.foldR[1]);
  S.gather = ramp(t, RV.gather[0], RV.gather[1]);
  S.press = ramp(t, RV.pressP[0], RV.pressP[1]);
  const lo = Math.min(S.fill[0], S.fill[1], S.fill[2]);
  S.paddle = ramp(lo, 0.25, 0.85);
  S.paddleShow = t < RV.gather[0] + 0.04 ? 1 : 0;
}

function restoreBody(vis) {
  const b = vis.body;
  if (!b) return;
  b.position.x = vis.b0?.x ?? 0; b.position.z = vis.b0?.z ?? 0; b.rotation.y = vis.b0?.yaw ?? 0;
}

function poseDeflateHull(world, rec, t, S) {
  const vis = rec.vis, raft = rec.raft, model = raft.model, root = model.root, body = bodyOf(model);
  if (!vis.hull) {
    vis.hull = new RaftHull(model.visual);
    vis.body = body;
    vis.b0 = { x: body?.position.x ?? 0, z: body?.position.z ?? 0, yaw: body?.rotation.y ?? 0 };
    // which end is near him: the drag swings the sheet round so it lies straight out in front of his knees
    root.updateMatrixWorld(true);
    const f = rec.from, lp = root.worldToLocal(new Vector3(f.x, root.position.y, f.z));
    vis.near = lp.z < 0 ? -1 : 1;
    S.near = vis.near;
    const kx = f.x + Math.cos(f.h) * 0.6, kz = f.z + Math.sin(f.h) * 0.6;
    vis.knee = new Vector3(kx, surfaceAt(world, kx, kz), kz);
    vis.far = new Vector3(kx + Math.cos(f.h) * 2.6, 0, kz + Math.sin(f.h) * 2.6);
    vis.far.y = surfaceAt(world, vis.far.x, vis.far.z);
  }
  if (raft.removed && !root.parent && world.scene) { world.scene.add(root); }
  vis.hull.apply(S);
  if (!body) return;
  // settle flat on the surface as it empties; dragged to his knees (2.0 s: the raft gone, the sheet still drawn)
  const lo = Math.min(S.fill[0], S.fill[1], S.fill[2]);
  body.rotation.x *= lo; body.rotation.z *= lo;
  const k = ramp(t, RAFT.pack.drag[0], RAFT.pack.drag[1]) * (1 - (vis.undrag ?? 0));
  if (k > 0 || raft.removed) {
    // target (root-local): the near end at his knees, the strip straight out ahead of him — the hull's +z along
    // -near × his facing — tilted from the knees down to the surface 2.6 m out
    const f = rec.from, near = vis.near;
    if (!vis.drag) {
      root.updateMatrixWorld(true);
      const kl = root.worldToLocal(vis.knee.clone());
      const fl = root.worldToLocal(vis.knee.clone().add(new Vector3(Math.cos(f.h), 0, Math.sin(f.h)))).sub(kl);
      const ry = Math.atan2(-near * fl.x, -near * fl.z);
      const nz = near * SHEET.near;
      let dy = ry - vis.b0.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const pitch = Math.atan2(vis.far.y - vis.knee.y, 2.6);
      vis.drag = { ry: vis.b0.yaw + dy, px: kl.x - Math.sin(ry) * nz, pz: kl.z - Math.cos(ry) * nz, rx: near * pitch,
        py: (vis.knee.y + vis.far.y) / 2 - root.position.y };
    }
    const D = vis.drag;
    body.position.x = vis.b0.x + (D.px - vis.b0.x) * k;
    body.position.z = vis.b0.z + (D.pz - vis.b0.z) * k;
    body.rotation.y = vis.b0.yaw + (D.ry - vis.b0.yaw) * k;
    body.rotation.x += (D.rx - body.rotation.x) * k;
    body.position.y += (D.py + 0.004 - body.position.y) * k;
  }
  root.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ the Marine

/** The pose he was shown in before the action (the action clip's first frame jumps), captured once. */
function pose0Of(m, vis) {
  if (vis.pose0 === undefined) { vis.pose0 = m._preKnife || capturePose(m); m._preKnife = null; }
  return vis.pose0;
}

/** Hand target accumulation (per frame, reused). */
const H = { l: [], r: [] };
const POOL = Array.from({ length: 24 }, () => ({ w: 0, p: new Vector3(), f: new Vector3(), n: new Vector3(), pole: [0, 0, 0] }));
let poolI = 0;
function addH(s, w, p, f, n, pole) {
  if (w <= 1e-3 || poolI >= POOL.length) return;
  const e = POOL[poolI++];
  e.w = w; e.p.copy(p); e.f.copy(f).normalize(); e.n.copy(n).normalize(); e.pole[0] = pole[0]; e.pole[1] = pole[1]; e.pole[2] = pole[2];
  H[s].push(e);
}

/** The kneel base (the 'plant' clip's kneel) mixed over idle by `wk`, the arms solved to H, the head on `look`. */
function solveMarine(m, B, M, F, wk, look, W, src) {
  const root = m.root, fwd = F.l;
  const idle = clipPose(m, 'idle', 0);
  if (idle) mixPose(m, idle, 1, m._guard);
  const kneel = clipPose(m, 'plant', RV.kneelFrac, true);
  if (kneel && wk > 1e-3) mixPose(m, kneel, wk, m._guard);
  upd(root);
  const T_ = {};
  for (const s of ['l', 'r']) {
    const list = H[s];
    if (!list.length) continue;
    let tw = 0; const p = _v0.set(0, 0, 0), f = _v1.set(0, 0, 0), n = _v2.set(0, 0, 0), pole = [0, 0, 0];
    for (const e of list) {
      tw += e.w; const k = e.w / tw;
      p.lerp(e.p, k); f.lerp(e.f, k); n.lerp(e.n, k); for (let i = 0; i < 3; i++) pole[i] += (e.pole[i] - pole[i]) * k;
    }
    const q = handQ(B, s, f.normalize(), n.normalize());
    T_[s] = { wrist: p.clone().sub(q.off.clone().applyQuaternion(q.q)), q: q.q, pole, w: Math.min(1, tw) };
  }
  // reach: lean the spine forward when a target is beyond the arm
  const reachLen = 0.97 * M.arm;
  const short = () => Math.max(T_.l ? wp(B.upperarm_l).distanceTo(T_.l.wrist) - reachLen : 0, T_.r ? wp(B.upperarm_r).distanceTo(T_.r.wrist) - reachLen : 0);
  let more = 0;
  for (let it = 0; it < 3 && (T_.l || T_.r); it++) {
    const over = short();
    if (over <= 0.004) break;
    const dm = clamp(over / 0.5, 0, 0.5 - more);
    if (dm <= 1e-3) break;
    turn(m, B.spine_01, fwd, dm * 0.3); turn(m, B.spine_02, fwd, dm * 0.35); turn(m, B.spine_03, fwd, dm * 0.35); more += dm;
  }
  if (look) lookAt(m, B, F, look, 0.75);
  const poleAt = (s, p) => wp(B['upperarm_' + s]).addScaledVector(F.l, p[0]).addScaledVector(F.u, p[1]).addScaledVector(F.f, p[2]);
  for (const s of ['l', 'r']) if (T_[s]) limbIK(m, B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], T_[s].wrist, poleAt(s, T_[s].pole), T_[s].w, T_[s].q);
  // (tests: how close each fully-weighted hand came to its target, before the overlay's own blend in / out)
  const err = (m._raftHandErr ||= {});
  for (const s of ['l', 'r']) err[s] = T_[s] && T_[s].w > 0.99 && W > 0.99 ? wp(B['hand_' + s]).distanceTo(T_[s].wrist) : null;
  if (W < 0.999 && src) mixPose(m, src, 1 - W, m._guard);
  upd(root);
  return T_;
}

function lookAt(m, B, F, p, w) {
  const h = wp(B.Head), d = _v3.copy(p).sub(h);
  const yaw = Math.atan2(d.dot(F.l), d.dot(F.f)), pitch = Math.atan2(-d.dot(F.u), Math.hypot(d.dot(F.l), d.dot(F.f)));
  const y = clamp(yaw, -1, 1) * w, pt = clamp(pitch, -0.5, 0.9) * w;
  turn(m, B.neck_01, F.u, 0.4 * y); turn(m, B.Head, F.u, 0.6 * y);
  turn(m, B.neck_01, F.l, 0.4 * pt); turn(m, B.Head, F.l, 0.6 * pt);
}

/** World point of a hull handle (model space under state S). */
function handleW(vis, h, S, out) {
  RaftHull.handleAt(h, S, out);
  return out.applyMatrix4(vis.space.matrixWorld);
}
/** Handles: the valve caps (raft.py loop pts 7 / 29: stern-left / bow-right quarter), points on the tube tops. */
function tubeTop(s) {
  const L = tubeLoop(), i = Math.round((((s % 1) + 1) % 1) * L.n) % L.n;
  return [L.P[i * 3], L.P[i * 3 + 1] + HULL.R * 0.98, L.P[i * 3 + 2]];
}
function valveCaps() {
  return [tubeTop(7 / 40 - 0.25), tubeTop(29 / 40 - 0.25)].map((p) => [p[0], p[1] + 0.02, p[2]]);
}

function deployPose(world, rec, m, B, M, t, end, S, P, packCtl) {
  const vis = rec.vis, root = m.root;
  const W = overlayW(rec, t, end);
  const pose0 = pose0Of(m, vis);
  const pre = capturePose(m);
  const F = frameOf(root);
  H.l.length = 0; H.r.length = 0; poolI = 0;
  const knee = _v3.copy(root.position).addScaledVector(F.f, 0.58);
  knee.y = surfaceAt(world, knee.x, knee.z);
  const wk = ramp(t, 0, 0.4) * (1 - ramp(t, RV.riseD[0], RV.riseD[1]));
  const up = F.u;
  let look = null;
  // the pack: off his back, round his right side, down onto the ground at his knees (both hands on its ends)
  if (packCtl) {
    if (!vis.packBack) { const PB = packOnBack(rec.a, m); PB.obj.updateMatrixWorld(true); vis.packBack = { p: wp(PB.obj), q: wq(PB.obj) }; packFree(rec.a, world.scene || root.parent); }
    const k = ramp(t, RV.packDown[0], RV.packDown[1]);
    const b = vis.packBack;
    const p1 = _v0.copy(b.p).addScaledVector(up, 0.3).addScaledVector(F.l, -0.35);
    const p2 = _v1.copy(knee).addScaledVector(up, 0.4).addScaledVector(F.l, -0.15);
    const pe = _v2.copy(knee).addScaledVector(F.f, PACK.d / 2 - 0.05);
    // cubic Bézier back → up/right → over → down
    const u = k, a0 = (1 - u) ** 3, a1 = 3 * u * (1 - u) ** 2, a2 = 3 * u * u * (1 - u), a3 = u ** 3;
    const pp = vis.pp ||= new Vector3();
    pp.set(b.p.x * a0 + p1.x * a1 + p2.x * a2 + pe.x * a3, b.p.y * a0 + p1.y * a1 + p2.y * a2 + pe.y * a3, b.p.z * a0 + p1.z * a1 + p2.z * a2 + pe.z * a3);
    const qg = vis.qg ||= new Quaternion();
    qg.setFromRotationMatrix(_m4.makeBasis(F.l, up, F.f));
    const qq = _q0.copy(b.q).slerp(qg, smooth(k * 1.2));
    placePack(P, pp, qq);
    const ax = _v3.set(1, 0, 0).applyQuaternion(qq);
    const press = bump(t, RV.press[0] - 0.05, RV.press[1]);
    for (const [s, sg] of [['l', 1], ['r', -1]]) {
      const hp = _v1.copy(pp).addScaledVector(ax, sg * (PACK.w / 2 - 0.02)).addScaledVector(_v2.set(0, 1, 0).applyQuaternion(qq), PACK.h * 0.6);
      if (t > RV.press[0]) hp.addScaledVector(up, -0.02 * press).addScaledVector(F.l, sg * -0.08 * ramp(t, RV.press[0], RV.press[1]));
      addH(s, ramp(t, 0, 0.12) * (1 - ramp(t, RV.swapIn - 0.02, RV.swapIn + 0.12)), hp, F.f.clone().addScaledVector(up, -0.6), _v2.copy(ax).multiplyScalar(-sg), s === 'l' ? [0.4, -0.4, -0.2] : [-0.4, -0.4, -0.2]);
    }
    look = pp;
  }
  // the hull: push the pleats out, flip the sides out, the cord, then a hand on the valve and on the tube as they fill
  if (vis.hull && vis.model) {
    vis.space = vis.model.visual.object3d;
    vis.space.updateWorldMatrix(true, false);
    const hs = vis.handles ||= (() => {
      const cap = valveCaps()[0], st = tubeTop(0.06);
      return {
        valve: RaftHull.handle(cap[0], cap[1] - 0.02, cap[2]),
        stern: RaftHull.handle(st[0], st[1], st[2]),
        flapL: RaftHull.handle(0.62, 0.12, -1.0), flapR: RaftHull.handle(-0.62, 0.12, -1.0),
        pleat: RaftHull.handle(0, 0.02, -0.9), centre: RaftHull.handle(0, 0.02, 0),
      };
    })();
    // spreading: both hands shove the stack's top pleat out over the water, letting go as it slides beyond reach
    const sp = RAFT.deploy.spread;
    const wSp = ramp(t, sp[0], sp[0] + 0.1) * (1 - ramp(t, sp[0] + 0.32, sp[0] + 0.45));
    if (wSp > 0) {
      const top = handleW(vis, hs.pleat, S, _v0);
      for (const [s, sg] of [['l', 1], ['r', -1]]) addH(s, wSp, _v1.copy(top).addScaledVector(F.l, sg * 0.18).addScaledVector(up, 0.03), F.f, _v2.copy(up).negate(), s === 'l' ? [0.4, -0.4, 0] : [-0.4, -0.4, 0]);
      look = top;
    }
    // the sides flipped out
    const wL = bump(t, RV.unfoldL[0] - 0.08, RV.unfoldL[1] + 0.02), wR = bump(t, RV.unfoldR[0] - 0.08, RV.unfoldR[1] + 0.02);
    if (wL > 0) addH('l', wL, handleW(vis, hs.flapL, S, _v0).addScaledVector(up, 0.03), F.f, _v2.copy(up).negate(), [0.5, -0.3, 0]);
    if (wR > 0) addH('r', wR, handleW(vis, hs.flapR, S, _v0).addScaledVector(up, 0.03), F.f, _v2.copy(up).negate(), [-0.5, -0.3, 0]);
    if (wL > 0 || wR > 0) look = handleW(vis, hs.centre, S, _v3.set(0, 0, 0)).clone();
    // the cord: the left hand to the valve, a jerk back at `pull`, then holding the valve while the gas goes in
    const D = RAFT.deploy;
    const valve = handleW(vis, hs.valve, S, _v0);
    const jerk = bump(t, D.pull - 0.06, D.pull + 0.1);
    const wV = ramp(t, D.cord[0], D.cord[0] + 0.15) * (1 - ramp(t, RV.riseD[0], RV.riseD[1] - 0.08));
    if (wV > 0) {
      const hp = _v1.copy(valve).addScaledVector(up, 0.03 + 0.12 * jerk).addScaledVector(F.f, -0.22 * jerk);
      const tw = Math.sin((t - RV.valveTwist[0]) * 60) * 0.25 * bump(t, RV.valveTwist[0], RV.valveTwist[1]);
      addH('l', wV, hp, _v2.copy(F.f).addScaledVector(F.l, -0.3 + tw), _v3.copy(up).negate(), [0.45, -0.4, -0.1]);
      look = valve.clone();
    }
    // the right hand on the stern tube, riding up with it (a pat when it is full)
    const wT = ramp(t, D.pull + 0.1, D.pull + 0.35) * (1 - ramp(t, RV.riseD[0], RV.riseD[1] - 0.08));
    if (wT > 0) {
      const st = handleW(vis, hs.stern, S, _v1).addScaledVector(up, 0.02 + 0.07 * bump(t, RV.pat[0], RV.pat[1]));
      addH('r', wT, st, F.f, _v2.copy(up).negate(), [-0.45, -0.4, -0.1]);
    }
    if (t > D.pull + 0.4 && t < D.full) look = handleW(vis, hs.centre, S, _v2).addScaledVector(up, 0.15).clone();
  }
  const src = t < end * 0.5 ? pose0 : pre;
  solveMarine(m, B, M, F, wk, look, W, src);
}

function packPose(world, rec, m, B, M, t, end, S, P, packCtl) {
  const vis = rec.vis, root = m.root;
  const W = overlayW(rec, t, end);
  const pose0 = pose0Of(m, vis);
  const pre = capturePose(m);
  const F = frameOf(root);
  H.l.length = 0; H.r.length = 0; poolI = 0;
  const up = F.u;
  const knee = vis.knee || _v3.copy(root.position).addScaledVector(F.f, 0.58);
  const wk = ramp(t, 0, 0.3) * (1 - ramp(t, RV.riseP[0], RV.riseP[1]));
  let look = null;
  const hull = vis.hull, raft = rec.raft;
  if (hull && raft?.model?.visual && t < RV.swapOut + 0.05) {
    vis.space = raft.model.visual.object3d;
    vis.space.updateWorldMatrix(true, false);
    const hs = vis.handles ||= (() => {
      const caps = valveCaps(), sp = vis.space;
      // the valve and the tube nearest him (model space)
      const me = sp.worldToLocal(_v0.copy(root.position).setY(sp.getWorldPosition(_v1).y));
      const dist = (p) => Math.hypot(p[0] - me.x, p[2] - me.z);
      const cap = dist(caps[0]) < dist(caps[1]) ? caps[0] : caps[1];
      const L = tubeLoop();
      let bi = 0, bd = Infinity;
      for (let i = 0; i < L.n; i++) { const d = Math.hypot(L.P[i * 3] - me.x, L.P[i * 3 + 2] - me.z); if (d < bd) { bd = d; bi = i; } }
      const sN = bi / L.n, tA = tubeTop(sN + 0.035), tB = tubeTop(sN - 0.035);
      const n = vis.near ?? -1;
      return {
        valve: RaftHull.handle(cap[0], cap[1] - 0.02, cap[2]), capLeft: null,
        tubeA: RaftHull.handle(...tA), tubeB: RaftHull.handle(...tB),
        cornerL: RaftHull.handle(0.3, 0.02, n * 1.3), cornerR: RaftHull.handle(-0.3, 0.02, n * 1.3),
        flapL: RaftHull.handle(0.62, 0.12, n * 1.05), flapR: RaftHull.handle(-0.62, 0.12, n * 1.05),
        centre: RaftHull.handle(0, 0.02, 0),
      };
    })();
    const PK = RAFT.pack;
    // the valve unscrewed (the hand on his side of it)
    const valve = handleW(vis, hs.valve, S, _v0);
    const side = valve.clone().sub(root.position).dot(F.l) >= 0 ? 'l' : 'r';
    const wV = ramp(t, PK.valve[0], PK.valve[0] + 0.15) * (1 - ramp(t, PK.open + 0.05, PK.open + 0.25));
    if (wV > 0) {
      const tw = Math.sin((t - PK.valve[0]) * 50) * 0.3 * bump(t, PK.valve[0] + 0.12, PK.open);
      addH(side, wV, _v1.copy(valve).addScaledVector(up, 0.03), _v2.copy(F.f).addScaledVector(F.l, tw), _v3.copy(up).negate(), side === 'l' ? [0.45, -0.4, -0.1] : [-0.45, -0.4, -0.1]);
      look = valve.clone();
    }
    // both hands pressing the air out of the near tube as it collapses
    const wP = ramp(t, PK.open + 0.1, PK.open + 0.3) * (1 - ramp(t, PK.flat - 0.1, PK.flat + 0.02));
    if (wP > 0) {
      const press = 0.03 * Math.abs(Math.sin((t - PK.open) * 7));
      const a = handleW(vis, hs.tubeA, S, _v1).addScaledVector(up, 0.01 - press), b = handleW(vis, hs.tubeB, S, _v2).addScaledVector(up, 0.01 - press);
      const [la, ra] = a.clone().sub(root.position).dot(F.l) >= b.clone().sub(root.position).dot(F.l) ? [a, b] : [b, a];
      addH('l', wP, la, F.f, _v3.copy(up).negate(), [0.45, -0.35, -0.1]);
      addH('r', wP, ra, F.f, _v3.copy(up).negate(), [-0.45, -0.35, -0.1]);
      look = la.clone().lerp(ra, 0.5);
    }
    // the drag: both hands on the near end's corners, pulling it to his knees
    const wD = ramp(t, PK.drag[0] - 0.05, PK.drag[0] + 0.08) * (1 - ramp(t, PK.drag[1] - 0.05, PK.drag[1] + 0.08));
    if (wD > 0) {
      addH('l', wD, handleW(vis, hs.cornerL, S, _v1).addScaledVector(up, 0.03), F.f, _v3.copy(up).negate(), [0.45, -0.35, -0.1]);
      addH('r', wD, handleW(vis, hs.cornerR, S, _v2).addScaledVector(up, 0.03), F.f, _v3.copy(up).negate(), [-0.45, -0.35, -0.1]);
      look = knee;
    }
    // the sides folded in (the left hand over the left flap, then the right)
    const wL = bump(t, RV.foldL[0] - 0.05, RV.foldL[1] + 0.03), wR = bump(t, RV.foldR[0] - 0.05, RV.foldR[1] + 0.03);
    if (wL > 0) addH('l', wL, handleW(vis, hs.flapL, S, _v1).addScaledVector(up, 0.03), F.f, _v3.copy(up).negate(), [0.5, -0.3, 0]);
    if (wR > 0) addH('r', wR, handleW(vis, hs.flapR, S, _v2).addScaledVector(up, 0.03), F.f, _v3.copy(up).negate(), [-0.5, -0.3, 0]);
    // gathered hand over hand: each hand reaches out along the strip, takes it and pulls it back onto the stack
    const G = RV.gather, wG = ramp(t, G[0] - 0.04, G[0] + 0.08) * (1 - ramp(t, G[1] - 0.05, G[1] + 0.05));
    if (wG > 0) {
      const stack = _v0.copy(knee).addScaledVector(F.f, SHEET.pleat * 0.5).addScaledVector(up, 0.05 + 0.18 * S.gather);
      for (const [s, sg, ph] of [['l', 1, 0], ['r', -1, 0.5]]) {
        const u = ((t - G[0]) * 2.6 + ph) % 1, out = u < 0.5 ? smooth(u * 2) : 1 - smooth((u - 0.5) * 2);
        const hp = _v1.copy(stack).addScaledVector(F.f, 0.38 * out).addScaledVector(F.l, sg * 0.14).addScaledVector(up, -0.06 * out);
        addH(s, wG, hp, F.f, _v2.copy(up).negate(), s === 'l' ? [0.45, -0.35, 0] : [-0.45, -0.35, 0]);
      }
      look = stack;
    }
  }
  // pressing and buckling the pack, then up onto his back (both hands on its ends)
  const wS = ramp(t, RV.pressP[0] - 0.05, RV.pressP[0] + 0.05) * (1 - ramp(t, RV.swapOut, RV.swapOut + 0.05));
  if (wS > 0) {
    const top = _v0.copy(knee).addScaledVector(F.f, SHEET.pleat * 0.5).addScaledVector(up, PACK.h + 0.02);
    addH('l', wS, _v1.copy(top).addScaledVector(F.l, 0.15), F.f, _v3.copy(up).negate(), [0.45, -0.35, 0]);
    addH('r', wS, _v2.copy(top).addScaledVector(F.l, -0.15), F.f, _v3.copy(up).negate(), [-0.45, -0.35, 0]);
    look = top.clone();
  }
  if (packCtl) {
    if (!vis.packBack) {
      const PB = packOnBack(rec.a, m); PB.obj.updateMatrixWorld(true);
      vis.packBack = { p: wp(PB.obj), q: wq(PB.obj), bone: PB.bone, local: PB.obj.matrix.clone() };
      packFree(rec.a, world.scene || root.parent);
    }
    const k = ramp(t, RV.packUp[0], RV.packUp[1]);
    // the back pose follows his spine as he rises: from the bone each frame
    const back = _m4.copy(B.spine_01.matrixWorld).multiply(vis.packBack.local);
    const bp = _v0.setFromMatrixPosition(back), bq = _q1.setFromRotationMatrix(back);
    const pe = _v1.copy(knee).addScaledVector(F.f, PACK.d / 2 - 0.05);
    const p1 = _v2.copy(pe).addScaledVector(up, 0.45).addScaledVector(F.l, -0.15);
    const p2 = _v3.copy(bp).addScaledVector(up, 0.3).addScaledVector(F.l, -0.35);
    const u = k, a0 = (1 - u) ** 3, a1 = 3 * u * (1 - u) ** 2, a2 = 3 * u * u * (1 - u), a3 = u ** 3;
    const pp = vis.pp ||= new Vector3();
    pp.set(pe.x * a0 + p1.x * a1 + p2.x * a2 + bp.x * a3, pe.y * a0 + p1.y * a1 + p2.y * a2 + bp.y * a3, pe.z * a0 + p1.z * a1 + p2.z * a2 + bp.z * a3);
    const qg = vis.qg ||= new Quaternion();
    qg.setFromRotationMatrix(_m4b.makeBasis(F.l, up, F.f));
    const qq = _q0.copy(qg).slerp(bq, smooth(k * 1.1));
    placePack(P, pp, qq);
    const ax = new Vector3(1, 0, 0).applyQuaternion(qq);
    for (const [s, sg] of [['l', 1], ['r', -1]]) {
      const hp = new Vector3().copy(pp).addScaledVector(ax, sg * (PACK.w / 2 - 0.02)).addScaledVector(new Vector3(0, 1, 0).applyQuaternion(qq), PACK.h * 0.6);
      addH(s, (1 - ramp(t, RV.packUp[1] - 0.12, RV.packUp[1] + 0.02)), hp, F.f.clone().addScaledVector(up, -0.4), ax.clone().multiplyScalar(-sg), s === 'l' ? [0.4, -0.4, -0.2] : [-0.4, -0.4, -0.2]);
    }
    look = k < 0.5 ? pp.clone() : null;
  }
  const src = t < end * 0.5 ? pose0 : pre;
  solveMarine(m, B, M, F, wk, look, W, src);
}

// ------------------------------------------------------------------ warm-up

/**
 * Program warm-up objects for a mission where the raft can be inflated or packed (Game.loadMission hands them to its
 * whole-map warm-up frame, Game._warmFrame: every pass — shadow depth, AO, mirror, x-ray): a library raft deformed half
 * full (its creasing material clones: art/raft-hull.js keeps them, so their programs stay compiled) and the strapped
 * pack (x-rayed with the Marine who carries it). Without it the first inflation stalled ~1 s on the compile.
 * @param {{x:number, z:number, y?:number}} at where to stand them (by the water: the mirror pass sees them)
 * @returns {Promise<{objects: THREE.Object3D[], xray: THREE.Object3D[], done: () => void}|null>}
 */
export async function raftWarmObjects(at) {
  let model = null;
  try { model = createLibraryVehicleModel('raft', vehicleDef('raft'), {}); } catch { model = null; }
  if (!model) return null;
  await model.ready;
  if (!model.isReady) { model.dispose?.(); return null; }
  const hull = new RaftHull(model.visual), S = hullState();
  S.fill.fill(0.5);
  hull.apply(S);
  model.root.position.set(at.x, at.y ?? 0, at.z);
  const pack = makePack();
  pack.position.set(at.x + 1.5, (at.y ?? 0) + 0.5, at.z);
  for (const r of [model.root, pack]) { r.updateMatrixWorld(true); r.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); }
  return {
    objects: [model.root, pack], xray: [pack],
    done: () => { hull.dispose(); model.root.removeFromParent(); model.dispose?.(); pack.removeFromParent(); },
  };
}

// ------------------------------------------------------------------ measurement (tests / tools)

/**
 * What a raft action draws now, for the Marine `c`: {kind, t, phase, volume (the hull's inflated fraction:
 * abilities/raft-actions.js hullVolume), hullScale (the drawn hull's world bounding-box height, m), pack ('back' |
 * 'free' | 'hidden'), packOnMarine (its bone is one of his), handTo (left / right hand → its target, m)}.
 */
export function raftMetrics(c) {
  const w = c?.world, rec = (w?.raftActs || []).find((r) => r.a === c && !r.superseded) || null;
  const P = c?._raftPack;
  const out = { kind: rec?.kind ?? null, pack: P ? (P.obj.visible ? P.mode : 'hidden') : 'none', packOnMarine: false };
  if (P && P.mode === 'back' && P.obj.visible) {
    const B = bonesOf(c.model);
    out.packOnMarine = !!B && Object.values(B).includes(P.obj.parent);
    out.packAt = wp(P.obj).toArray();
  }
  if (!rec) return out;
  const t = w.time - rec.t0;
  out.t = t;
  out.volume = hullVolume(t, rec.kind === 'pack');
  const vis = rec.vis;
  out.meanY = vis?.hull?.meanY?.() ?? null;
  const he = c.model?._raftHandErr;
  if (he) out.handErr = { l: he.l, r: he.r };
  const model = rec.kind === 'inflate' ? vis?.model : rec.raft?.model;
  if (model?.root && vis?.hull) {
    const box = new THREE.Box3();
    let any = false;
    for (const md of vis.hull.meshes) {
      if (!md.mesh.visible || !md.on) continue;
      let shown = true;
      for (let a = md.mesh; a; a = a.parent) if (a.visible === false) { shown = false; break; }
      if (!shown) continue;
      md.mesh.updateWorldMatrix(true, false);
      md.geo.computeBoundingBox();
      box.union(md.geo.boundingBox.clone().applyMatrix4(md.mesh.matrixWorld)); any = true;
    }
    if (any) { out.hullH = box.max.y - box.min.y; out.hullTop = box.max.y; out.hullMin = box.min.toArray(); out.hullMax = box.max.toArray(); }
  }
  return out;
}
