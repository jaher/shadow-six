/**
 * Gate debris (design-spec §3.7 ramming addendum, bodies-design §A.6 style): the Rapier side of a gate smash.
 *   - Intact: every breakable gate (world/breakables.js layout) is one FIXED compound body (a cuboid per piece) plus
 *     a fixed post body; its NavGrid cells are left out of the STATIC cuboids (world-physics skips its owner).
 *   - `gate:smash` (queued, applied at the next physics step in entity order): the intact body goes; the pieces are
 *     grouped (union-find over nails / seams / hinges, deterministic from the smash seed and the contact geometry)
 *     into DYNAMIC compound bodies. Hinged leaves keep spherical joints to the posts (a leaf hanging on one hinge =
 *     one joint left). Struck pieces get the impulse of the bumper; the vehicle is a KINEMATIC box that shoves the
 *     rest. Pieces collide with the ground, the walls, props, units and each other (group PROP).
 *   - Bodies that stop (or time out) turn FIXED where they lie: static wreckage, never re-stamped on the NavGrid
 *     (the gap stays passable). A moving vehicle hull that runs into a frozen piece taller than its ground clearance
 *     wakes it again and shoves it.
 * Visuals read `gate.bodies[i].pose` (+ the pieces' layout-local offsets); nothing here touches THREE.
 * @module physics/debris
 */

import { CONFIG } from '../config.js';
import { G, groups, GROUPS, groundAt } from './statics.js';
import { qAxis, qMul, qRot, r4 } from './qmath.js';
import { layoutOf, isBreakableGate, rng32 } from '../world/breakables.js';

/** Collider groups: pieces are PROP-class (units / vehicles / props / ragdolls / ground / walls / each other). */
const PIECE = GROUPS.PROP;
/** Vehicle hull boxes only push props and debris. */
const HULL = groups(G.VEHICLE, G.PROP);
const FRICTION = { wood: 0.65, metal: 0.45 };
/** Ground clearance of a vehicle hull box (m): flatter debris is driven over (bump), taller debris is shoved. */
export const HULL_CLEARANCE = 0.32;
const P = () => CONFIG.physics.gates || DEFAULTS;
const DEFAULTS = { settleV: 0.2, settleW: 0.5, settleHold: 0.35, timeout: 9, thudV: 2.2, thudGap: 0.07, maxThuds: 14, linDamp: 0.12, angDamp: 0.35,
  upright: 0.7, toppleGap: 0.4, hingeDamp: 3.2, jamDepth: 0.015, jamTear: 0.15, tearDepth: 0.2, slowHold: 1 };

/** Gate frame (gate interactable → world): origin at the gate centre on the ground, yaw from the structure rot. */
function frameOf(w, gate) {
  const rot = gate.params?.rot ?? gate.params?.structure?.rot ?? 0;
  return { x: gate.x, y: groundAt(w, gate.x, gate.z), z: gate.z, q: qAxis(0, 1, 0, -rot), rot };
}
/** Local pose of a layout piece in its gate frame: [x, y, z, qx, qy, qz, qw]. */
export function pieceLocal(p) {
  const q = qAxis(0, 0, 1, p.rz || 0);
  return [p.c[0], p.c[1], p.c[2], q.x, q.y, q.z, q.w];
}
const poseOf = (b) => { const t = b.translation(), q = b.rotation(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w].map(r4); };
/** Frame point (local) → world. */
function toWorld(F, v) { const r = qRot(F.q, { x: v[0], y: v[1], z: v[2] }); return { x: F.x + r.x, y: F.y + r.y, z: F.z + r.z }; }

export class GateDebris {
  constructor(pw) {
    this.pw = pw;
    const w = pw.world;
    /** @type {object[]} every breakable gate (entity-id order) */
    this.gates = [];
    this.queue = [];
    this.hulls = new Map(); // vehicle → kinematic body
    const list = (w.interactables || []).filter((it) => it.interactKind === 'door' && it.barrier && isBreakableGate({ ...(it.params?.structure || {}), type: it.params?.structure?.type || 'gate' }))
      .sort((a, b) => a.id - b.id);
    for (const gate of list) {
      const layout = layoutOf({ ...gate.params.structure, rot: gate.params.rot ?? gate.params.structure.rot });
      if (!layout) continue;
      const F = frameOf(w, gate);
      const g = { gate, key: String(gate.tag ?? gate.id), owner: gate.owner, layout, F, byId: new Map([...layout.pieces, ...(layout.splinters || [])].map((p) => [p.id, p])),
        broken: false, active: false, frozen: false, t: 0, bodies: [], joints: [], thuds: 0, lastThud: -1, intact: null, posts: null, outcome: null };
      g.posts = this._fixedBody(F, layout.pieces.filter((p) => p.kind === 'post'), layout);
      if (!gate.open && !gate.destroyed) g.intact = this._fixedBody(F, layout.pieces.filter((p) => p.kind !== 'post'), layout);
      this.gates.push(g);
    }
    this.owners = new Set(this.gates.map((g) => g.owner));
    if (this.gates.length) this._warm();
    this._off = w.events.on('gate:smash', (e) => { if (e?.gate) this.queue.push(e); });
    this._offDoor = w.events.on('door', (e) => this._doorChanged(e));
  }

  /**
   * Warm-up at load (like the ragdoll warm-up in world-physics), in a THROW-AWAY Rapier world (the game world is never
   * touched: deterministic whatever happens here): the first gate with a patch of the real terrain and walls around it is
   * smashed through the real code path (queued break → vehicle hull → steps → settle bookkeeping). Chrome compiles
   * Rapier's step for the call targets it has seen when its tier-up triggers; a target first met later deoptimizes it
   * in the middle of a frame (a ≈ 5 ms recompile on the first smash). So in the browser, once per page, the replay
   * repeats for C_WARM_MS (the background compile lands inside that window and the deopt happens here, not in play);
   * if no pass was slow, a few more run at idle time.
   */
  _warm() {
    const t0 = performance.now(), browser = typeof document !== 'undefined';
    let passes = 0, fast = false, slow = false;
    try {
      for (;;) {
        const worst = this._warmPass();
        passes++;
        if (!browser || JIT_WARM) break;
        slow ||= fast && worst > 2.5; // a slow pass after fast ones: the recompile happened here (or the machine hiccuped)
        fast ||= worst < 1.5;
        // a fixed window (a slow pass alone could be noise): the background compile lands inside it
        if (performance.now() - t0 > C_WARM_MS) { JIT_WARM = true; if (!slow) this._warmLater(3); break; }
      }
    } catch (e) { console.warn('[physics] gate warm-up failed', e); }
    this.warmMs = performance.now() - t0; this.warmPasses = passes; // load-time cost (diagnostics)
  }

  /** Browser, idle time: a few more warm-up passes, one per idle second, until the deopt shows (scratch world only). */
  _warmLater(n) {
    const idle = globalThis.requestIdleCallback || ((f) => setTimeout(f, 1));
    setTimeout(() => idle(() => {
      if (!this.gates.length || !this.pw.rw) return;
      let worst = 0;
      try { for (let i = 0; i < 4 && worst <= 2.5; i++) worst = this._warmPass(); } catch { return; }
      if (worst <= 2.5 && n > 1) this._warmLater(n - 1);
    }), 1000);
  }

  /** One warm-up smash in a fresh scratch world. @returns {number} its slowest step (ms) */
  _warmPass() {
    const src = this.pw, R = src.R, w = src.world, g0 = this.gates[0], F = g0.F, dt = 1 / 60;
    const rw = new R.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    rw.timestep = src.rw.timestep;
    rw.integrationParameters.numSolverIterations = src.rw.integrationParameters.numSolverIterations;
    const me = Object.create(this);
    Object.assign(me, { pw: { R, rw, world: w, caps: src.caps }, gates: [], queue: [], hulls: new Map(), _quiet: true, _groups: null });
    let worst = 0;
    try {
      // ground: a heightfield patch of the real terrain (24 m, 1 m step) + the real wall / fence boxes within 8 m
      const n = 24, hs = new Float32Array((n + 1) * (n + 1)), x0 = F.x - n / 2, z0 = F.z - n / 2;
      for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) hs[c * (n + 1) + r] = groundAt(w, x0 + c, z0 + r);
      const tb = rw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(F.x, 0, F.z));
      rw.createCollider(R.ColliderDesc.heightfield(n, n, hs, { x: n, y: 1, z: n }).setCollisionGroups(GROUPS.TERRAIN).setFriction(0.9), tb);
      const sb = rw.createRigidBody(R.RigidBodyDesc.fixed());
      src.rw.forEachCollider((c) => {
        if (c.collisionGroups() !== GROUPS.STATIC || c.shapeType() !== R.ShapeType.Cuboid) return;
        const t = c.translation(), he = c.halfExtents();
        if (Math.abs(t.x - F.x) > 8 + he.x || Math.abs(t.z - F.z) > 8 + he.z) return;
        rw.createCollider(R.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(t.x, t.y, t.z).setCollisionGroups(GROUPS.STATIC).setFriction(0.7), sb);
      });
      const L = g0.layout, g = { ...g0, broken: false, active: false, frozen: false, bodies: [], joints: [], thuds: 0, lastThud: -1, t: 0 };
      g.posts = me._fixedBody(F, L.pieces.filter((p) => p.kind === 'post'), L);
      g.intact = me._fixedBody(F, L.pieces.filter((p) => p.kind !== 'post'), L);
      me.gates = [g];
      rw.step();
      me.queue.push({ id: g.key, gate: g.gate, outcome: 'shatter', speed: 9, seed: 0x5eed, info: { u: -0.4, y: 0.7, halfWidth: 1.2, heading: F.rot + Math.PI / 2, dir: [0, 1] } });
      me.postStep(dt); // the break, after a tick's step as in play
      const at = (z) => { const p = toWorld(F, [0, 0, z]); return { x: p.x, y: F.y + 1.5, z: p.z }; };
      let hull = null;
      for (let i = 0; i < C_WARM_STEPS; i++) {
        if (!hull) { // the vehicle hull appears the tick after the break, nose already through the gate line
          hull = rw.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(at(-1.6).x, at(-1.6).y, at(-1.6).z).setRotation(F.q));
          rw.createCollider(R.ColliderDesc.cuboid(1.1, 1.2, 2.2).setCollisionGroups(HULL).setFriction(0.5), hull);
        } else hull.setNextKinematicTranslation(at(-1.6 + i * 0.15));
        const t = performance.now();
        rw.step();
        worst = Math.max(worst, performance.now() - t);
        me.postStep(dt);
      }
    } finally { rw.free(); }
    return worst;
  }

  /** A fixed compound body in frame F with one cuboid per piece. */
  _fixedBody(F, pieces, layout) {
    const R = this.pw.R, rw = this.pw.rw;
    const b = rw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(F.x, F.y, F.z).setRotation(F.q));
    for (const p of pieces) this._collider(b, p, layout, false);
    return b;
  }

  _collider(b, p, layout, dyn) {
    const R = this.pw.R, l = pieceLocal(p);
    const d = R.ColliderDesc.cuboid(Math.max(0.01, p.h[0]), Math.max(0.01, p.h[1]), Math.max(0.006, p.h[2]))
      .setTranslation(l[0], l[1], l[2]).setRotation({ x: l[3], y: l[4], z: l[5], w: l[6] })
      .setFriction(FRICTION[layout.kind === 'wire' ? 'metal' : 'wood']).setRestitution(0.12).setCollisionGroups(this._groups || PIECE);
    if (dyn) d.setMass(Math.max(p.kind === 'splinter' ? 0.05 : 0.3, p.mass));
    return this.pw.rw.createCollider(d, b);
  }

  /** Opening / closing an intact gate: its collider goes / comes back (the leaves swing aside). */
  _doorChanged(e) {
    const g = this.gates.find((q) => q.key === String(e?.id));
    if (!g || g.broken) return;
    if (g.gate.open && g.intact) { this.pw.rw.removeRigidBody(g.intact); g.intact = null; }
    else if (!g.gate.open && !g.intact) g.intact = this._fixedBody(g.F, g.layout.pieces.filter((p) => p.kind !== 'post'), g.layout);
  }

  get active() { return this.gates.filter((g) => g.active); }
  moving() { return this.gates.some((g) => g.active) || this.queue.length > 0; }
  count() { return this.gates.reduce((s, g) => s + (g.active ? g.bodies.filter((b) => !b.fixed).length : 0), 0); }
  byKey(key) { return this.gates.find((g) => g.key === String(key)) || null; }
}

// ------------------------------------------------------------------ fracture graph

/** The rail half (piece) of leaf L, rail r, that covers local x. */
function railAt(layout, L, r, x) {
  const rs = layout.pieces.filter((p) => p.kind === 'rail' && p.id.startsWith(`L${L}r${r}`));
  return rs.find((p) => Math.abs(x - p.c[0]) <= p.h[0] + 1e-6) || rs.sort((a, b) => Math.abs(x - a.c[0]) - Math.abs(x - b.c[0]))[0];
}

const BONDS = new WeakMap(), BYID = new WeakMap();
/** Piece id → piece of a layout (cached; layouts are immutable). */
function byIdOf(layout) {
  if (!BYID.has(layout)) BYID.set(layout, new Map(layout.pieces.map((p) => [p.id, p])));
  return BYID.get(layout);
}
/** Bond graph of a layout: [{a, b, type:'seam'|'nail'}] between piece ids (posts excluded). Cached per layout. */
export function bondsOf(layout) {
  if (!BONDS.has(layout)) BONDS.set(layout, Object.freeze(buildBonds(layout)));
  return BONDS.get(layout);
}
function buildBonds(layout) {
  const E = [], add = (a, b, type) => { if (a && b && a !== b) E.push({ a, b, type }); };
  const ps = layout.pieces;
  if (layout.kind === 'plank') {
    for (const p of ps) {
      if (p.kind === 'plank') {
        const L = p.leaf, seg = p.id.slice(-1);
        if (seg === 'a') add(p.id, p.id.slice(0, -1) + 'b', 'seam');
        add(p.id, railAt(layout, L, seg === 'a' ? 0 : 1, p.c[0])?.id, 'nail');
      } else if (p.kind === 'rail' && p.id.endsWith('a')) add(p.id, p.id.slice(0, -1) + 'b', 'seam');
      else if (p.kind === 'brace') {
        const c = Math.cos(p.rz), dx = c * p.h[0];
        add(p.id, railAt(layout, p.leaf, 0, p.c[0] - dx)?.id, 'nail');
        add(p.id, railAt(layout, p.leaf, 1, p.c[0] + dx)?.id, 'nail');
      }
    }
  } else if (layout.kind === 'boom') {
    const poles = ps.filter((p) => p.kind === 'pole');
    for (let i = 0; i + 1 < poles.length; i++) add(poles[i].id, poles[i + 1].id, 'seam');
    add('pole0', 'arm', 'nail'); add('arm', 'weight', 'nail');
  } else {
    for (let L = 0; L < layout.leaves; L++) {
      for (const s of ['top', 'bot']) { add(`L${L}${s}`, `L${L}sh`, 'nail'); add(`L${L}${s}`, `L${L}sf`, 'nail'); }
      add(`L${L}mesh`, `L${L}top`, 'nail'); add(`L${L}mesh`, `L${L}bot`, 'nail');
    }
  }
  return E;
}

/** Is piece p in the vehicle's strike zone (local gate frame)? Returns the overlap width (m), 0 = not struck. */
export function struckBy(p, info) {
  const hw = info.halfWidth ?? 1, u = info.u ?? 0, yb = info.y ?? 0.6;
  const ext = Math.abs(Math.cos(p.rz || 0)) * p.h[0] + Math.abs(Math.sin(p.rz || 0)) * p.h[1];
  const ov = Math.min(p.c[0] + ext, u + hw) - Math.max(p.c[0] - ext, u - hw);
  const yext = Math.abs(Math.sin(p.rz || 0)) * p.h[0] + Math.abs(Math.cos(p.rz || 0)) * p.h[1];
  const yOk = p.c[1] + yext >= 0.12 && p.c[1] - yext <= yb + 0.75;
  return ov > 0.02 && yOk ? ov : 0;
}

/**
 * Decide the fracture (pure, deterministic): which bonds break and which hinges hold.
 * @param {object} layout @param {{outcome:string, info:object, seed:number}} smash @param {number} cap max groups
 * @returns {{cut:Set<number>, hinges:object[], struck:Map<string, number>, torn:number}}
 */
export function planFracture(layout, smash, cap = 64) {
  const rand = rng32(smash.seed >>> 0), shatter = smash.outcome === 'shatter', info = smash.info;
  const E = bondsOf(layout), struck = new Map(), byId = byIdOf(layout);
  for (const p of layout.pieces) if (p.kind !== 'post') { const ov = struckBy(p, info); if (ov) struck.set(p.id, ov); }
  // how hard each leaf was hit: struck board width (rails / frame count a fifth)
  const leafHit = Array.from({ length: layout.leaves }, (_, L) => layout.pieces.filter((p) => p.leaf === L && struck.has(p.id))
    .reduce((s, p) => s + struck.get(p.id) * (p.kind === 'plank' || p.kind === 'mesh' ? 1 : 0.2), 0));
  const torn = leafHit.length > 1 ? (Math.abs(leafHit[0] - leafHit[1]) < 0.05 ? (rand() < 0.5 ? 0 : 1) : leafHit[0] > leafHit[1] ? 0 : 1) : 0;
  const cand = []; // [priority, edge index]
  E.forEach((e, i) => {
    const pa = byId.get(e.a), pb = byId.get(e.b);
    const hit = struck.has(e.a) || struck.has(e.b), r = rand();
    const near = Math.min(Math.abs(pa.c[0] - info.u), Math.abs(pb.c[0] - info.u)) < 0.55;
    let pr = 0;
    if (layout.kind === 'boom') {
      if (e.type === 'seam') {
        const sx = (pa.c[0] + pa.h[0] + pb.c[0] - pb.h[0]) / 2, d = Math.abs(sx - info.u);
        pr = d === minSeamD(layout, info) ? 2 : shatter && sx > info.u && r < 0.7 ? 1 : 0;
      }
    } else if (layout.kind === 'plank') {
      // the torn leaf breaks up (shatter) or goes off its hinges in one piece minus the boards at the bumper (burst);
      // the other leaf of a double gate keeps its rails and Z-brace: only the boards the bumper caught crack off
      const keeper = layout.leaves > 1 && pa.leaf !== torn, planks = pa.kind === 'plank' || pb.kind === 'plank';
      if (planks) pr = hit ? (r < (shatter ? (keeper ? 0.3 : 0.92) : (keeper ? 0.2 : 0.4) + (near ? 0.3 : 0)) ? 2 : 0) : (shatter && !keeper && r < 0.3 ? 1 : 0);
      else if (e.type === 'seam') pr = shatter && !keeper && (hit || r < 0.5) ? 1.5 : 0; // rail halves
      else pr = shatter && !keeper && r < 0.4 ? 1 : 0; // brace nails
    } else {
      pr = shatter ? (e.a.endsWith('mesh') ? (r < 0.6 ? 1 : 0) : (r < 0.4 ? 1 : 0)) : 0;
    }
    if (pr > 0) cand.push([pr + (hit ? 0.5 : 0), i]);
  });
  cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const base = componentsOf(layout, E, new Set()).length, cut = new Set();
  for (const [, i] of cand) {
    if (base + cut.size >= cap) break;
    cut.add(i);
  }
  // hinges: shatter tears everything off (sometimes a rail half stays hanging); burst tears the hit leaf off and
  // leaves the other one swinging (hanging on its upper hinge when the bumper caught it)
  const hinges = [];
  for (const h of layout.hinges) {
    let keep;
    // shatter: the other leaf (a single leaf: its hinge-side half) hangs on its upper hinge; burst: the torn leaf goes,
    // the other one swings on both hinges, or on the upper one when the bumper caught it
    if (layout.kind === 'boom') keep = true;
    else if (layout.kind === 'plank' && layout.leaves === 1) keep = h.id.endsWith('1') && (!shatter || leafHit[0] < 1.6);
    else if (shatter) keep = h.leaf !== torn && h.id.endsWith('1') && (layout.kind === 'plank' || rand() < 0.35);
    else keep = h.leaf !== torn && !(h.id.endsWith('0') && leafHit[h.leaf] > 0.25);
    if (keep) hinges.push(h);
  }
  return { cut, hinges, struck, torn, edges: E, leafHit };
}

function minSeamD(layout, info) {
  const poles = layout.pieces.filter((p) => p.kind === 'pole');
  let best = Infinity;
  for (let i = 0; i + 1 < poles.length; i++) best = Math.min(best, Math.abs((poles[i].c[0] + poles[i].h[0] + poles[i + 1].c[0] - poles[i + 1].h[0]) / 2 - info.u));
  return best;
}

/** Connected components of the non-post pieces over the un-cut bonds (piece-id order inside, by first id). */
export function componentsOf(layout, E, cut) {
  const ids = layout.pieces.filter((p) => p.kind !== 'post').map((p) => p.id), parent = new Map(ids.map((i) => [i, i]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  E.forEach((e, i) => { if (!cut.has(i) && parent.has(e.a) && parent.has(e.b)) parent.set(find(e.a), find(e.b)); });
  const groups = new Map();
  for (const id of ids) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  return [...groups.values()];
}

// ------------------------------------------------------------------ break, step, settle

Object.assign(GateDebris.prototype, {
  /** Apply a queued `gate:smash`: fixed intact body → dynamic groups with joints + impulses. */
  _break(g, e) {
    if (g.broken) return;
    const pw = this.pw, R = pw.R, rw = pw.rw, L = g.layout, F = g.F, C = P();
    if (g.intact) { rw.removeRigidBody(g.intact); g.intact = null; }
    g.broken = true; g.active = true; g.frozen = false; g.t = 0; g.outcome = e.outcome; g.thuds = 0; g.speed = e.speed || 0;
    const smash = { outcome: e.outcome, info: e.info, seed: e.seed >>> 0 };
    const plan = planFracture(L, smash, Math.max(4, pw.caps.debris ?? 64));
    const comps = componentsOf(L, plan.edges, plan.cut);
    const rand = rng32((smash.seed ^ 0x9e3779b9) >>> 0);
    const v = Math.max(1, e.speed || 0), shatter = e.outcome === 'shatter';
    const hd = e.info.heading, dirW = { x: Math.cos(hd), y: 0, z: Math.sin(hd) }, side = { x: -dirW.z, y: 0, z: dirW.x };
    const cW = toWorld(F, [e.info.u, e.info.y, 0]);
    for (const ids of comps) {
      const ps = ids.map((id) => g.byId.get(id));
      const mass = ps.reduce((s, p) => s + p.mass, 0);
      const bd = R.RigidBodyDesc.dynamic().setTranslation(F.x, F.y, F.z).setRotation(F.q).setCanSleep(true)
        .setLinearDamping(C.linDamp).setAngularDamping(C.angDamp).setCcdEnabled(true);
      const body = rw.createRigidBody(bd);
      for (const p of ps) this._collider(body, p, L, true);
      const hit = ps.reduce((s, p) => s + (plan.struck.get(p.id) || 0), 0);
      const hinged = plan.hinges.some((h) => ids.includes(h.piece));
      if (hinged) { body.setAngularDamping(C.hingeDamp); body.setLinearDamping(C.hingeDamp * 0.4); } // rusty pintles: the swing dies out
      const com = body.worldCom?.() || cW;
      if (hinged) {
        // the bumper shoves the hinged leaf / boom stub: an impulse at the contact point, the joint does the rest
        body.applyImpulseAtPoint({ x: dirW.x * mass * v * 0.9, y: mass * 0.4, z: dirW.z * mass * v * 0.9 }, cW, true);
      } else if (mass > 25) {
        // a torn-off leaf: struck at the bumper → thrown ahead, spinning about the contact point
        const k = (hit > 0 ? 0.85 + rand() * 0.25 : 0.3) * mass * v;
        body.applyImpulseAtPoint({ x: dirW.x * k + side.x * (rand() - 0.5) * mass * 1.5, y: mass * (shatter ? 2.2 : 1.2) * (0.6 + rand() * 0.6), z: dirW.z * k + side.z * (rand() - 0.5) * mass * 1.5 }, cW, true);
      } else {
        // splinters and boards: flung ahead (struck) or knocked loose (the rest), tumbling
        const lat = (com.x - cW.x) * side.x + (com.z - cW.z) * side.z;
        const f = hit > 0 ? 1.0 + rand() * 0.3 : 0.15 + rand() * 0.45, up = (shatter ? 1.4 : 0.6) + rand() * (shatter ? 2.6 : 1.4);
        const sp = Math.sign(lat || rand() - 0.5) * (0.4 + rand() * 1.6);
        body.setLinvel({ x: dirW.x * v * f + side.x * sp, y: up, z: dirW.z * v * f + side.z * sp }, true);
        const a = 3 + rand() * (shatter ? 9 : 5);
        body.setAngvel({ x: (rand() - 0.5) * 2 * a, y: (rand() - 0.5) * a, z: (rand() - 0.5) * 2 * a }, true);
      }
      g.bodies.push({ body, pieces: ids, fixed: false, still: 0, t: 0, vy: 0, pose: poseOf(body), mass: r4(mass), hinged });
    }
    for (const h of plan.hinges) {
      const b = g.bodies.find((q) => q.pieces.includes(h.piece));
      if (!b) continue;
      const a = { x: h.at[0], y: h.at[1], z: h.at[2] };
      const jd = L.kind === 'boom' ? R.JointData.revolute(a, a, { x: 0, y: 0, z: 1 }) : R.JointData.spherical(a, a);
      g.joints.push({ joint: rw.createImpulseJoint(jd, g.posts, b.body, true), hinge: h.id, body: g.bodies.indexOf(b) });
    }
    // a board that broke at its seam throws a splinter or two out of the tear
    for (const sp of L.splinters || []) {
      const i = plan.edges.findIndex((q) => q.type === 'seam' && q.a === `${sp.host}a` && q.b === `${sp.host}b`);
      if (i < 0 || !plan.cut.has(i)) continue;
      const body = rw.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(F.x, F.y, F.z).setRotation(F.q).setCanSleep(true)
        .setLinearDamping(C.linDamp).setAngularDamping(C.angDamp).setCcdEnabled(true));
      this._collider(body, sp, L, true);
      const f = 0.5 + rand() * 0.6, sd = (rand() - 0.5) * 3;
      body.setLinvel({ x: dirW.x * v * f + side.x * sd, y: 1.5 + rand() * 2.5, z: dirW.z * v * f + side.z * sd }, true);
      body.setAngvel({ x: (rand() - 0.5) * 24, y: (rand() - 0.5) * 12, z: (rand() - 0.5) * 24 }, true);
      g.bodies.push({ body, pieces: [sp.id], fixed: false, still: 0, t: 0, vy: 0, pose: poseOf(body), mass: r4(sp.mass), hinged: false });
    }
    g.hinges = plan.hinges.map((h) => h.id);
    g.torn = plan.torn;
  },
});

/** Ticks of the load-time warm-up smash. */
const C_WARM_STEPS = 14;
/** Wall-clock cap (ms) of the browser warm-up replays at load. */
const C_WARM_MS = 600;
/** The browser warm-up replays ran to completion once in this page (the JIT state is per page). */
let JIT_WARM = false;
/** Hull height (m) by vehicle model (the kinematic box spans clearance → height). */
const HULL_H = { truck: 2.7, car: 1.5, jeep: 1.4, kubel: 1.4, motorcycle: 1.1, tank: 2.3, armoredcar: 2.1, halftrack: 2.1 };
const SQ = (a) => a * a;

Object.assign(GateDebris.prototype, {
  preStep(dt) {
    const w = this.pw.world;
    // a hull driving into frozen wreckage taller than its clearance shoves it again
    for (const g of this.gates) if (g.broken && !g.active) this._rewake(g, w);
    this._hulls(dt);
  },

  _near(v, g, r = 3) {
    if (SQ(v.x - g.F.x) + SQ(v.z - g.F.z) < SQ(14)) return true;
    const L = (v.def?.size?.[0] ?? 4) / 2 + r;
    return g.bodies.some((b) => SQ(b.pose[0] - v.x) + SQ(b.pose[2] - v.z) < SQ(L + 2.5));
  },

  _hulls() {
    const R = this.pw.R, rw = this.pw.rw, w = this.pw.world;
    const act = this.gates.filter((g) => g.active), want = [];
    if (act.length) {
      for (const v of w.vehicles || []) {
        if (v.removed || v.hiddenRail || v.vehicleKind !== 'land' && v.def?.kind !== 'land') continue;
        if (act.some((g) => this._near(v, g))) want.push(v);
      }
    }
    want.sort((a, b) => a.id - b.id);
    for (const [v, b] of [...this.hulls]) if (!want.includes(v)) { rw.removeRigidBody(b); this.hulls.delete(v); }
    for (const v of want) {
      const [l, wd] = v.def?.size || [4, 2], H = HULL_H[v.def?.model] ?? 2, hh = (H - HULL_CLEARANCE) / 2;
      const y = groundAt(w, v.x, v.z) + HULL_CLEARANCE + hh, q = qAxis(0, 1, 0, -(v.heading || 0));
      let b = this.hulls.get(v);
      if (!b) {
        b = rw.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, y, v.z).setRotation(q));
        rw.createCollider(R.ColliderDesc.cuboid(l / 2, hh, wd / 2).setCollisionGroups(HULL).setFriction(0.5), b);
        this.hulls.set(v, b);
      } else { b.setNextKinematicTranslation({ x: v.x, y, z: v.z }); b.setNextKinematicRotation(q); }
    }
  },

  /** World centre + top height of a piece in body pose `pose`. */
  _pieceWorld(pose, p) {
    const q = { x: pose[3], y: pose[4], z: pose[5], w: pose[6] }, c = qRot(q, { x: p.c[0], y: p.c[1], z: p.c[2] });
    const ql = qMul(q, qAxis(0, 0, 1, p.rz || 0));
    let lo = Infinity, hi = -Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const r = qRot(ql, { x: sx * p.h[0], y: sy * p.h[1], z: sz * p.h[2] });
      lo = Math.min(lo, r.y); hi = Math.max(hi, r.y);
    }
    return { x: pose[0] + c.x, y: pose[1] + c.y, z: pose[2] + c.z, lo: pose[1] + c.y + lo, hi: pose[1] + c.y + hi };
  },

  _rewake(g, w) {
    for (const v of w.vehicles || []) {
      if (v.removed || !(v.speed > 0.3) || !this._near(v, g, 1)) continue;
      const [l, wd] = v.def?.size || [4, 2], c = Math.cos(v.heading || 0), s = Math.sin(v.heading || 0);
      for (const b of g.bodies) {
        if (!b.fixed) continue;
        const hit = b.pieces.some((id) => {
          const pw = this._pieceWorld(b.pose, g.byId.get(id)), dx = pw.x - v.x, dz = pw.z - v.z;
          const along = dx * c + dz * s, across = -dx * s + dz * c;
          return Math.abs(along) < l / 2 + 0.45 && Math.abs(across) < wd / 2 + 0.1 && pw.hi - groundAt(w, pw.x, pw.z) > HULL_CLEARANCE + 0.03;
        });
        if (!hit) continue;
        b.body.setBodyType(this.pw.R.RigidBodyType.Dynamic, true);
        b.fixed = false; b.still = 0; b.t = 0;
        g.active = true; g.frozen = false;
      }
    }
  },

  postStep(dt) {
    const w = this.pw.world, C = P();
    for (const g of this.gates) {
      if (!g.active) continue;
      g.t += dt;
      for (const b of g.bodies) {
        if (b.fixed) continue;
        const body = b.body;
        this._clamp(g, body);
        const lv = body.linvel(), av = body.angvel();
        b.pose = poseOf(body); b.t += dt;
        // landing thud: a fast fall stopped short
        if (!this._quiet && b.vy < -C.thudV && lv.y > b.vy + 1.6 && g.thuds < C.maxThuds && w.time - g.lastThud >= C.thudGap) {
          g.thuds++; g.lastThud = w.time;
          w.events.emit('gate:thud', { id: g.key, x: b.pose[0], z: b.pose[2], v: r4(-b.vy), heavy: b.mass > 20, material: g.layout.kind === 'wire' ? 'metal' : 'wood' });
        }
        b.vy = lv.y;
        // a hanging leaf crushed into a wall (the hull drives it deep into the palisade): the pintle gives way
        if (b.hinged) {
          b.jam = this._staticDepth(b) > C.tearDepth ? (b.jam || 0) + dt : 0; // a flank sweeping it flat against the palisade presses it a hand in: it holds
          if (b.jam >= C.jamTear) this._tearHinge(g, b);
        }
        // still: barely moving (a hanging leaf creeps on its pintle; a splinter's spin jitter is judged by its tip speed)
        b.r ??= Math.max(...b.pieces.map((id) => Math.max(...g.byId.get(id).h)));
        const sw = Math.hypot(av.x, av.y, av.z);
        const still = body.isSleeping() || (Math.hypot(lv.x, lv.y, lv.z) < C.settleV * (b.hinged ? 2 : 1) && (sw < C.settleW || sw * b.r < C.settleV));
        b.still = still ? b.still + dt : 0;
        const slow = Math.hypot(lv.x, lv.y, lv.z) < 2 * C.settleV && Math.hypot(av.x, av.y, av.z) < 2 * C.settleW;
        b.slow = slow ? (b.slow || 0) + dt : 0;
        // a loose piece only freezes lying down: one coming to rest on its end is tipped over (away from the gate line)
        // as soon as it slows down; `timeout` is a safety net for a piece wedged upright for good
        if (b.slow >= 0.12 && !b.hinged && b.t < C.timeout && this._upright(g, b)) {
          if (b.t - (b.topple ?? -9) >= C.toppleGap) this._topple(g, b);
          b.still = 0;
        } else if (b.still >= C.settleHold && b.t < C.timeout && this._staticDepth(b) > C.jamDepth) {
          b.still = 0; // still but pressed into a wall: the contacts push it out first
        } else if (b.still >= C.settleHold || b.t >= C.timeout) this._freeze(g, b);
        // creeping in place for a second (a thin board lying in a heightfield crease: a contact limit cycle kicks it a
        // few cm/s every third tick, so it is never `still` for settleHold): it is at rest — freeze it lying there
        else if (!b.hinged && b.slow >= C.slowHold && this._staticDepth(b) <= C.jamDepth) this._freeze(g, b);
      }
      if (g.bodies.every((b) => b.fixed)) {
        g.active = false; g.frozen = true;
        if (!this._quiet) w.events.emit('gate:settled', { id: g.key });
      }
    }
    // a queued smash breaks AFTER this tick's step: the pieces' first step is the next tick's (the break's cost and
    // the first contact solve land in two frames instead of one)
    for (const e of this.queue.splice(0)) { const g = this.gates.find((q) => q.gate === e.gate); if (g) this._break(g, e); }
  },

  /**
   * Speed limits (debris wedged between a hull and a wall / the ground gets huge depenetration pushes): nothing
   * leaves faster than 1.6 × the ramming speed (≥ 10 m/s) or spins faster than 30 rad/s.
   */
  _clamp(g, body) {
    const vmax = Math.max(10, 1.6 * (g.speed || 9)), lv = body.linvel(), s = Math.hypot(lv.x, lv.y, lv.z);
    if (s > vmax) body.setLinvel({ x: lv.x * vmax / s, y: lv.y * vmax / s, z: lv.z * vmax / s }, true);
    const av = body.angvel(), w = Math.hypot(av.x, av.y, av.z);
    if (w > 30) body.setAngvel({ x: av.x * 30 / w, y: av.y * 30 / w, z: av.z * 30 / w }, true);
  },

  /** Deepest penetration (m) of the body's colliders into STATIC colliders (walls, fences, buildings). */
  _staticDepth(b) {
    const rw = this.pw.rw;
    let d = 0;
    for (let i = 0, n = b.body.numColliders(); i < n; i++) {
      const c = b.body.collider(i);
      rw.contactPairsWith(c, (o) => {
        if (o.collisionGroups() !== GROUPS.STATIC) return;
        rw.contactPair(c, o, (m) => { for (let k = 0; k < m.numContacts(); k++) d = Math.max(d, -m.contactDist(k)); });
      });
    }
    return d;
  },

  /** The hinge of a hanging body gives: its joint goes, the leaf falls free (`gate:hinge`). */
  _tearHinge(g, b) {
    const i = g.bodies.indexOf(b), C = P();
    for (const j of g.joints.filter((q) => q.body === i)) { this.pw.rw.removeImpulseJoint(j.joint, true); g.hinges = (g.hinges || []).filter((h) => h !== j.hinge); }
    g.joints = g.joints.filter((q) => q.body !== i);
    b.hinged = false; b.jam = 0;
    b.body.setAngularDamping(C.angDamp); b.body.setLinearDamping(C.linDamp); b.body.wakeUp();
    if (!this._quiet) this.pw.world.events.emit('gate:hinge', { id: g.key, x: b.pose[0], z: b.pose[2] });
  },

  /**
   * Is the body standing up? A slab of several pieces (boards on a rail, a leaf) when it stands on edge (its face normal,
   * gate-local z, within ~30° of horizontal); otherwise its longest piece standing on end (long axis within ~45° of
   * vertical).
   */
  _upright(g, b) {
    const qb = { x: b.pose[3], y: b.pose[4], z: b.pose[5], w: b.pose[6] };
    if (b.pieces.length > 1) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const id of b.pieces) { const p = g.byId.get(id); x0 = Math.min(x0, p.c[0] - p.h[0]); x1 = Math.max(x1, p.c[0] + p.h[0]); y0 = Math.min(y0, p.c[1] - p.h[1]); y1 = Math.max(y1, p.c[1] + p.h[1]); }
      if (x1 - x0 > 0.3 && y1 - y0 > 0.3) return Math.abs(qRot(qb, { x: 0, y: 0, z: 1 }).y) < 0.5;
    }
    let best = null;
    for (const id of b.pieces) { const p = g.byId.get(id); if (!best || Math.max(...p.h) > Math.max(...best.h)) best = p; }
    if (!best || Math.max(...best.h) < 0.12) return false;
    const k = best.h.indexOf(Math.max(...best.h)), ax = [0, 0, 0]; ax[k] = 1;
    const q = qMul(qb, qAxis(0, 0, 1, best.rz || 0));
    return Math.abs(qRot(q, { x: ax[0], y: ax[1], z: ax[2] }).y) > P().upright;
  },

  /**
   * Tip an upright piece / slab over, away from the gate line (what it leans on is the palisade or the post): a spin
   * about the horizontal axis that carries its top away (a slab along its face normal), plus a small shove.
   */
  _topple(g, b) {
    const F = g.F, nG = qRot(F.q, { x: 0, y: 0, z: 1 }), t = b.body.translation(), com = b.body.worldCom?.() || t;
    const s = Math.sign((com.x - F.x) * nG.x + (com.z - F.z) * nG.z) || (g.bodies.indexOf(b) % 2 ? 1 : -1);
    let d = { x: nG.x * s, z: nG.z * s };
    if (b.pieces.length > 1) { // a slab: tip it onto a face
      const ez = qRot({ x: b.pose[3], y: b.pose[4], z: b.pose[5], w: b.pose[6] }, { x: 0, y: 0, z: 1 }), l = Math.hypot(ez.x, ez.z);
      if (l > 0.2) { const k = Math.sign(ez.x * d.x + ez.z * d.z) || 1; d = { x: ez.x / l * k, z: ez.z / l * k }; }
    }
    const m = Math.max(0.3, b.mass), n = (b.topple != null ? 1.4 : 1); // a second try spins harder
    b.topple = b.t;
    b.body.setAngvel({ x: d.z * 2.4 * n, y: 0, z: -d.x * 2.4 * n }, true); // axis up × d: the top moves along d
    b.body.applyImpulse({ x: d.x * m * 0.6, y: 0, z: d.z * m * 0.6 }, true);
  },

  /** Dynamic → fixed where it lies (never below the ground). */
  _freeze(g, b) {
    const w = this.pw.world, body = b.body;
    body.setLinvel({ x: 0, y: 0, z: 0 }, false); body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    body.setBodyType(this.pw.R.RigidBodyType.Fixed, false);
    let lift = 0;
    const pose = poseOf(body);
    for (const id of b.pieces) {
      const pw = this._pieceWorld(pose, g.byId.get(id));
      lift = Math.max(lift, groundAt(w, pw.x, pw.z) - 0.01 - pw.lo);
    }
    if (lift > 0) { const t = body.translation(); body.setTranslation({ x: t.x, y: t.y + lift, z: t.z }, false); }
    b.pose = poseOf(body); b.fixed = true; b.vy = 0;
  },
});

// ------------------------------------------------------------------ persistence (bodies-design §A.10)

Object.assign(GateDebris.prototype, {
  /** Broken gates (poses; body/joint handles while a snapshot is taken) + every gate's fixed body handles. */
  serialize() {
    return {
      gates: this.gates.map((g) => ({
        key: g.key, broken: g.broken, outcome: g.outcome, speed: g.speed ?? 0, active: g.active, frozen: g.frozen, t: g.t, thuds: g.thuds, lastThud: g.lastThud,
        torn: g.torn ?? null, hinges: g.hinges ?? [], posts: g.posts?.handle ?? null, intact: g.intact?.handle ?? null,
        bodies: g.bodies.map((b) => ({ pieces: b.pieces, pose: b.pose, fixed: b.fixed, still: b.still, t: b.t, vy: b.vy, mass: b.mass, hinged: !!b.hinged, topple: b.topple ?? null, jam: b.jam ?? 0, slow: b.slow ?? 0, h: b.body.handle })),
        joints: g.joints.map((j) => ({ hinge: j.hinge, body: j.body, h: j.joint.handle })),
      })),
      hulls: [...this.hulls].map(([v, b]) => [v.id, b.handle]),
      queue: this.queue.map((e) => ({ id: e.id, outcome: e.outcome, info: e.info, seed: e.seed, speed: e.speed })),
    };
  },

  /**
   * Restore into a freshly built PhysicsWorld. `snapshot`: pw.rw is the restored Rapier world (handles are valid);
   * otherwise every broken gate is at rest: rebuild its pieces as fixed bodies at the saved poses.
   */
  restore(data, snapshot) {
    if (!data) return;
    const pw = this.pw, R = pw.R, rw = pw.rw, w = pw.world;
    for (const s of data.gates || []) {
      const g = this.byKey(s.key);
      if (!g) continue;
      if (snapshot) {
        g.posts = s.posts != null ? rw.getRigidBody(s.posts) : g.posts;
        g.intact = s.intact != null ? rw.getRigidBody(s.intact) : null;
      }
      if (!s.broken) { if (!snapshot && g.gate.open && g.intact) { rw.removeRigidBody(g.intact); g.intact = null; } continue; }
      if (!snapshot && g.intact) { rw.removeRigidBody(g.intact); g.intact = null; }
      Object.assign(g, { broken: true, outcome: s.outcome, speed: s.speed ?? 0, active: !!s.active && snapshot, frozen: !!s.frozen || !snapshot, t: s.t, thuds: s.thuds, lastThud: s.lastThud, torn: s.torn, hinges: s.hinges });
      g.bodies = s.bodies.map((sb) => {
        let body;
        if (snapshot) body = rw.getRigidBody(sb.h);
        else {
          body = rw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(sb.pose[0], sb.pose[1], sb.pose[2]).setRotation({ x: sb.pose[3], y: sb.pose[4], z: sb.pose[5], w: sb.pose[6] }));
          for (const id of sb.pieces) this._collider(body, g.byId.get(id), g.layout, true);
        }
        return { body, pieces: sb.pieces, pose: sb.pose, fixed: snapshot ? sb.fixed : true, still: sb.still, t: sb.t, vy: sb.vy, mass: sb.mass, hinged: !!sb.hinged, topple: sb.topple ?? undefined, jam: sb.jam ?? 0, slow: sb.slow ?? 0 };
      });
      g.joints = snapshot ? (s.joints || []).map((j) => ({ hinge: j.hinge, body: j.body, joint: rw.getImpulseJoint(j.h) })).filter((j) => j.joint) : [];
    }
    this.hulls = new Map(snapshot ? (data.hulls || []).map(([id, h]) => [w.byId(id), rw.getRigidBody(h)]).filter(([v, b]) => v && b) : []);
    this.queue = (data.queue || []).map((e) => { const gate = w.interactables.find((it) => String(it.tag ?? it.id) === String(e.id)); return gate ? { ...e, gate } : null; }).filter(Boolean);
  },

  dispose() {
    this._off?.(); this._offDoor?.();
    this.gates = []; this.queue = []; this.hulls = new Map();
  },
});

// ------------------------------------------------------------------ audit helpers (tests, tools/audit)

/** World oriented boxes of a gate's pieces: [{id, c:{x,y,z}, ax:[{x,y,z}×3], h:[hx,hy,hz]}]. */
export function pieceBoxes(g) {
  const out = [];
  for (const b of g.bodies) {
    const q = { x: b.pose[3], y: b.pose[4], z: b.pose[5], w: b.pose[6] };
    for (const id of b.pieces) {
      const p = g.byId.get(id), ql = qMul(q, qAxis(0, 0, 1, p.rz || 0)), c = qRot(q, { x: p.c[0], y: p.c[1], z: p.c[2] });
      out.push({ id, body: b, c: { x: b.pose[0] + c.x, y: b.pose[1] + c.y, z: b.pose[2] + c.z },
        ax: [qRot(ql, { x: 1, y: 0, z: 0 }), qRot(ql, { x: 0, y: 1, z: 0 }), qRot(ql, { x: 0, y: 0, z: 1 })], h: p.h });
    }
  }
  return out;
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
/** Penetration depth of two oriented boxes (separating axis test; 0 = apart or touching). */
export function obbOverlap(A, B) {
  const d = { x: B.c.x - A.c.x, y: B.c.y - A.c.y, z: B.c.z - A.c.z };
  const axes = [...A.ax, ...B.ax];
  for (const a of A.ax) for (const b of B.ax) { const c = cross(a, b), l = Math.hypot(c.x, c.y, c.z); if (l > 1e-6) axes.push({ x: c.x / l, y: c.y / l, z: c.z / l }); }
  let depth = Infinity;
  for (const n of axes) {
    const ra = A.h.reduce((s, h, i) => s + h * Math.abs(dot(A.ax[i], n)), 0), rb = B.h.reduce((s, h, i) => s + h * Math.abs(dot(B.ax[i], n)), 0);
    const o = ra + rb - Math.abs(dot(d, n));
    if (o <= 0) return 0;
    depth = Math.min(depth, o);
  }
  return depth;
}
