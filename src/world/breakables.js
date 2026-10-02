/**
 * Breakable gates (design-spec §3.7 ramming addendum): the pure, node-safe half of the gate smash. Gameplay (the gate's
 * grid cells, the ram noise, `structure:destroyed`) stays in `Interactable.ramBreak`; this module adds
 *   - the pre-fractured LAYOUT of every rammable gate kind (plank double gate, barrier boom, wire/frame gate): every
 *     piece as an oriented box in the gate's local frame (x along the gate, y up, z across), with its fracture seams,
 *     the rail it is nailed to and the hinges — shared by the physics (src/physics/debris.js) and the art
 *     (src/art/breakable-gates.js) so a visual piece is exactly one collider;
 *   - the break DECISION from the impact impulse J = vehicle mass × speed at the contact point: `hold` (the vehicle
 *     stops, the gate bows and holds), `burst` (leaves torn open, one off its hinges, planks near the bumper crack off)
 *     or `shatter` (everything flies);
 *   - the vehicle response (speed loss proportional to the gate's strength, a jolt).
 * Everything is a pure function of the mission def + the impact → deterministic under the fixed step.
 * @module world/breakables
 */

/** Gate kinds: strength (N·s impulse thresholds), break work (N·s taken off the vehicle), density, sounds. [rec] */
export const GATE_KINDS = Object.freeze({
  plank: { holdJ: 3000, shatterJ: 24000, work: 6000, density: 520, material: 'wood' },
  boom: { holdJ: 800, shatterJ: 9000, work: 1200, density: 480, material: 'wood' },
  wire: { holdJ: 3500, shatterJ: 30000, work: 7000, density: 7800, material: 'metal' },
});

/** Vehicle mass (kg) by model / type [rec: Opel Blitz 3.3 t loaded, Kübelwagen 0.7 t, Pz II 9.5 t, SdKfz 251 8 t]. */
const MASS = { truck: 3500, car: 1300, jeep: 1100, kubel: 750, motorcycle: 260, tank: 9500, armoredcar: 8000, halftrack: 8000 };
/** Bumper / impact height (m above ground) by model. */
const BUMPER = { truck: 0.7, car: 0.5, jeep: 0.55, kubel: 0.5, motorcycle: 0.6, tank: 0.9, armoredcar: 0.8, halftrack: 0.8 };

/** Mass (kg) of a vehicle entity (def.mass wins). */
export function vehicleMass(v) {
  const d = v?.def || {};
  if (Number.isFinite(d.mass)) return d.mass;
  const k = [d.model, d.type, v?.vehicleType].map((s) => String(s || '')).find((s) => MASS[s]) ?? String(d.model || '');
  if (MASS[k]) return MASS[k];
  return /tank|panzer/.test(k) ? MASS.tank : /moto/.test(k) ? MASS.motorcycle : 2000;
}
export function bumperHeight(v) {
  const m = String(v?.def?.model || '');
  return BUMPER[m] ?? 0.6;
}

/** Which breakable model a gate structure def uses (null = not a breakable model). */
export function gateKindOf(def) {
  if (!def) return null;
  const look = String(def.look || def.variant || '');
  if (/palisade|plank|timber|barn|garage|wood|arched_double/.test(look)) return 'plank';
  if (/boom|barrier/.test(look) || def.type === 'barrier') return 'boom';
  if (/chain|mesh|wire|iron|jail|frame/.test(look)) return 'wire';
  return def.rammable ? 'plank' : null;
}

/** Is this structure def a rammable gate that gets the breakable model? (mirrors Interactable.barrier) */
export function isBreakableGate(def) {
  if (!def || !(def.type === 'gate' || def.type === 'barrier')) return false;
  return !!(def.rammable || def.barrier || def.variant === 'barrier_boom' || def.type === 'barrier') && !!gateKindOf(def);
}

/** FNV-1a string → uint32. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32: deterministic [0, 1) stream. */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Torn-wood splinter profile across a width: [u, dy] points, u ∈ [0, 1], dy along the grain (m). A sawtooth of short
 * fibres (± amp) with one or two long tongues (up to 3 × amp) torn out along the grain — both halves of a fracture
 * share it, so intact they interlock and broken each end shows the jagged, splintered tear. Deterministic.
 */
export function splinterProfile(rand, n = 7, amp = 0.07) {
  const pts = [[0, (rand() - 0.5) * amp * 0.8]];
  const tongues = new Set([1 + Math.floor(rand() * (n - 1))]);
  if (n > 4 && rand() < 0.6) tongues.add(1 + Math.floor(rand() * (n - 1)));
  for (let i = 1; i < n; i++) {
    const sgn = i % 2 ? 1 : -1, long = tongues.has(i);
    pts.push([i / n + (rand() - 0.5) * 0.35 / n, sgn * amp * (long ? 2 + rand() : 0.3 + rand() * 0.7)]);
  }
  pts.push([1, (rand() - 0.5) * amp * 0.8]);
  return pts;
}

const box = (id, kind, leaf, c, h, extra = {}) => ({ id, kind, leaf, c, h, rz: 0, ...extra });
const vol = (p) => 8 * p.h[0] * p.h[1] * p.h[2];

/**
 * Plank double gate (palisade / plank / barn doors): two leaves of vertical planks nailed to two rails with a Z-brace,
 * iron hinge straps on the rails, two log posts. Every plank is pre-fractured once (a jagged seam between the rails)
 * and every rail once near its middle, so medium hits crack planks off and fast hits split the leaves.
 */
function plankLayout(def, rand) {
  const w = def.w ?? 4, h = def.h ?? 2.2, K = GATE_KINDS.plank;
  const single = /plank_gate$|single|jail|pen/.test(String(def.look || def.variant || '')) || w < 2.2;
  const leaves = single ? [[-w / 2, w / 2, -1]] : [[-w / 2, -0.012, -1], [0.012, w / 2, 1]];
  const y0 = 0.08, y1 = h - 0.04, pT = 0.045, rT = 0.065, zP = 0.0125 + pT / 2, zR = 0.0125 - rT / 2;
  const railY = [y0 + 0.34, y1 - 0.36];
  const pieces = [], hinges = [];
  leaves.forEach(([xa, xb, side], L) => {
    // side = which end the hinges are on (−1: xa, +1: xb)
    const len = xb - xa, n = Math.max(3, Math.round(len / 0.19)), pw = len / n;
    for (let i = 0; i < n; i++) {
      const cx = xa + pw * (i + 0.5), top = y1 - (rand() < 0.3 ? rand() * 0.04 : 0);
      const cut = railY[0] + 0.12 + rand() * (railY[1] - railY[0] - 0.24);
      const seam = splinterProfile(rand, 7, 0.06);
      const hw = pw / 2 - 0.004;
      pieces.push(box(`L${L}p${i}a`, 'plank', L, [cx, (y0 + cut) / 2, zP], [hw, (cut - y0) / 2, pT / 2], { rail: `L${L}r0`, seamTop: seam }));
      pieces.push(box(`L${L}p${i}b`, 'plank', L, [cx, (cut + top) / 2, zP], [hw, (top - cut) / 2, pT / 2], { rail: `L${L}r1`, seamBot: seam }));
    }
    // rails, pre-split near the middle; the hinge half carries the strap
    const xm = xa + len * (0.42 + rand() * 0.16);
    railY.forEach((y, r) => {
      const seam = splinterProfile(rand, 4, 0.05);
      const ends = side < 0 ? [[xa + 0.02, xm, 'a'], [xm, xb - 0.02, 'b']] : [[xm, xb - 0.02, 'a'], [xa + 0.02, xm, 'b']];
      for (const [p, q, s] of ends) {
        pieces.push(box(`L${L}r${r}${s}`, 'rail', L, [(p + q) / 2, y, zR], [(q - p) / 2, 0.07, rT / 2],
          { rail: `L${L}r${r}`, seamX: seam, seamAtMax: p < xm, strap: s === 'a' ? { from: side < 0 ? xa : xb, len: len * 0.62 } : null }));
      }
      hinges.push({ id: `H${L}${r}`, leaf: L, piece: `L${L}r${r}a`, at: [side < 0 ? xa : xb, y, zR] });
    });
    // Z-brace from the bottom hinge-side corner up to the top free-side corner
    const hx = side < 0 ? xa + 0.12 : xb - 0.12, fx = side < 0 ? xb - 0.12 : xa + 0.12;
    const ya = railY[0] + 0.08, yb = railY[1] - 0.08, bl = Math.hypot(fx - hx, yb - ya);
    pieces.push(box(`L${L}br`, 'brace', L, [(hx + fx) / 2, (ya + yb) / 2, zR], [bl / 2 - 0.05, 0.06, rT / 2 - 0.004],
      { rz: Math.atan2(yb - ya, fx - hx), rail: `L${L}r0` }));
  });
  const postR = 0.14, postH = h + 0.35;
  for (const s of [-1, 1]) pieces.push(box(`post${s < 0 ? 0 : 1}`, 'post', -1, [s * (w / 2 + postR + 0.01), postH / 2, zR], [postR, postH / 2, postR], { round: true }));
  for (const p of pieces) p.mass = p.kind === 'post' ? 0 : vol(p) * K.density + (p.strap ? 2.5 : 0);
  // loose splinters torn out of a board's seam when it breaks there (not part of the whole gate: hidden, no collider)
  const splinters = [];
  for (let L = 0; L < leaves.length; L++) {
    const tops = pieces.filter((p) => p.leaf === L && p.kind === 'plank' && p.id.endsWith('b'));
    for (let k = 0; k < 3 && tops.length; k++) {
      const b = tops.splice(Math.floor(rand() * tops.length), 1)[0], y = b.c[1] - b.h[1];
      const sp = box(`L${L}s${k}`, 'splinter', L, [b.c[0] + (rand() - 0.5) * b.h[0], y + (rand() - 0.5) * 0.08, zP + pT / 2 + 0.011],
        [0.014 + rand() * 0.008, 0.08 + rand() * 0.09, 0.009], { rz: (rand() - 0.5) * 0.6, host: b.id.slice(0, -1) });
      sp.mass = Math.max(0.05, vol(sp) * K.density);
      splinters.push(sp);
    }
  }
  return { kind: 'plank', w, h, pieces, hinges, leaves: leaves.length, splinters };
}

/**
 * Barrier boom: pivot post with a counterweight, a striped pole pre-fractured into four segments (it snaps at the
 * seam nearest the impact), a fork rest post at the free end.
 */
function boomLayout(def, rand) {
  const w = def.w ?? 4, K = GATE_KINDS.boom, y = 1.0, r = 0.065;
  const xp = -w / 2 - 0.25, xe = w / 2 + 0.35, pieces = [], hinges = [];
  const cuts = [xp + 0.35];
  for (const f of [0.3, 0.55, 0.8]) cuts.push(xp + (xe - xp) * (f + (rand() - 0.5) * 0.08));
  cuts.push(xe);
  const seams = cuts.map(() => splinterProfile(rand, 6, 0.05));
  for (let i = 0; i + 1 < cuts.length; i++) {
    pieces.push(box(`pole${i}`, 'pole', 0, [(cuts[i] + cuts[i + 1]) / 2, y, 0], [(cuts[i + 1] - cuts[i]) / 2, r, r],
      { round: true, rail: 'pole', seamMin: i > 0 ? seams[i] : null, seamMax: i + 2 < cuts.length ? seams[i + 1] : null, x0: cuts[0] }));
  }
  pieces.push(box('arm', 'weight', 0, [xp - 0.2, y, 0], [0.55, r * 1.1, r * 1.1], { round: true, rail: 'pole' }));
  pieces.push(box('weight', 'weight', 0, [xp - 0.62, y - 0.05, 0], [0.16, 0.2, 0.15], { rail: 'pole' }));
  // the pivot post stands BESIDE the pole (pin bearing on its face): the counterweight swings down past it when the
  // boom is raised (or after the pole snapped) instead of into it
  pieces.push(box('post0', 'post', -1, [xp, 0.625, -0.3], [0.12, 0.625, 0.12]));
  pieces.push(box('post1', 'post', -1, [xe - 0.2, (y - 0.08) / 2, 0], [0.07, (y - 0.08) / 2, 0.07]));
  // a boom set in a wider wall opening (def.gap [lo, hi], local x): stout log gate posts where the palisade ends, the
  // pivot side between the S post and the road, a pedestrian footway between the fork rest and the far post
  const gap = Array.isArray(def.gap) ? def.gap : null, gh = def.gapPostH ?? 3.3;
  if (gap) for (const [i, gx] of [[0, gap[0] + 0.15], [1, gap[1] - 0.15]]) pieces.push(box(`gpost${i}`, 'post', -1, [gx, gh / 2, 0], [0.15, gh / 2, 0.15], { round: true, gatePost: true }));
  hinges.push({ id: 'H00', leaf: 0, piece: 'pole0', at: [xp, y, 0] });
  for (const p of pieces) p.mass = p.kind === 'post' ? 0 : p.kind === 'weight' && p.id === 'weight' ? 60 : vol(p) * K.density;
  return { kind: 'boom', w, h: y + r, pieces, hinges, leaves: 1, pivot: [xp, y, 0], gap, footway: gap ? [xe - 0.13, gap[1] - 0.3] : null };
}

/** Wire / frame gate: steel tube leaves (top/bottom rails, stiles, diagonal) with a mesh panel; steel posts. */
function wireLayout(def, rand) {
  const w = def.w ?? 4, h = def.h ?? 2.2, K = GATE_KINDS.wire, t = 0.025;
  const single = /jail|pen|single/.test(String(def.look || def.variant || '')) || w < 2.2;
  const leaves = single ? [[-w / 2, w / 2, -1]] : [[-w / 2, -0.015, -1], [0.015, w / 2, 1]];
  const y0 = 0.08, y1 = h - 0.05, pieces = [], hinges = [];
  leaves.forEach(([xa, xb, side], L) => {
    const len = xb - xa, cx = (xa + xb) / 2;
    pieces.push(box(`L${L}top`, 'frame', L, [cx, y1 - t, 0], [len / 2, t, t], { rail: `L${L}f` }));
    pieces.push(box(`L${L}bot`, 'frame', L, [cx, y0 + t, 0], [len / 2, t, t], { rail: `L${L}f` }));
    pieces.push(box(`L${L}sh`, 'frame', L, [side < 0 ? xa + t : xb - t, (y0 + y1) / 2, 0], [t, (y1 - y0) / 2 - 2 * t, t], { rail: `L${L}f` }));
    pieces.push(box(`L${L}sf`, 'frame', L, [side < 0 ? xb - t : xa + t, (y0 + y1) / 2, 0], [t, (y1 - y0) / 2 - 2 * t, t], { rail: `L${L}f` }));
    pieces.push(box(`L${L}mesh`, 'mesh', L, [cx, (y0 + y1) / 2, 0], [len / 2 - 2 * t, (y1 - y0) / 2 - 2 * t, 0.006], { rail: `L${L}f` }));
    for (const [r, y] of [[0, y0 + 0.3], [1, y1 - 0.3]]) hinges.push({ id: `H${L}${r}`, leaf: L, piece: `L${L}sh`, at: [side < 0 ? xa : xb, y, 0] });
    rand();
  });
  for (const s of [-1, 1]) pieces.push(box(`post${s < 0 ? 0 : 1}`, 'post', -1, [s * (w / 2 + 0.06), (h + 0.2) / 2, 0], [0.05, (h + 0.2) / 2, 0.05], { round: true }));
  for (const p of pieces) p.mass = p.kind === 'post' ? 0 : p.kind === 'mesh' ? 6 * p.h[0] * p.h[1] : vol(p) * K.density * 0.25; // tubes are hollow
  return { kind: 'wire', w, h, pieces, hinges, leaves: leaves.length };
}

const LAYOUTS = { plank: plankLayout, boom: boomLayout, wire: wireLayout };

/**
 * Pre-fractured layout of a gate structure def (deterministic per mission structure id).
 * @param {object} def mission structure def {id, w, h, variant, look, …}
 * @returns {{kind:string, w:number, h:number, pieces:object[], hinges:object[], leaves:number}|null}
 */
export function gateLayout(def) {
  const kind = gateKindOf(def);
  if (!kind) return null;
  const rand = rng32(hashStr(`gate:${def.id ?? ''}:${def.w ?? 4}:${kind}`));
  return LAYOUTS[kind](def, rand);
}

const LAYOUT_CACHE = new Map();
/** Cached gateLayout by structure id (layouts are immutable). */
export function layoutOf(def) {
  const key = `${def?.id ?? ''}|${def?.w}|${def?.h}|${def?.look ?? ''}|${def?.variant ?? ''}|${def?.gap ?? ''}`;
  if (!LAYOUT_CACHE.has(key)) LAYOUT_CACHE.set(key, gateLayout(def));
  return LAYOUT_CACHE.get(key);
}
export const gateMass = (layout) => layout.pieces.reduce((s, p) => s + p.mass, 0);

/**
 * §3.7 addendum break decision. J = m·v at the contact (N·s) against the gate kind's strength.
 * @returns {{outcome:'hold'|'burst'|'shatter', J:number}}
 */
export function ramOutcome(kind, mass, speed) {
  const K = GATE_KINDS[kind] || GATE_KINDS.plank, J = mass * Math.max(0, speed);
  return { outcome: J < K.holdJ ? 'hold' : J >= K.shatterJ ? 'shatter' : 'burst', J: Math.round(J) };
}

/**
 * Vehicle response to a break: the fraction of its speed lost (the break work plus the momentum given to the pieces,
 * so a weak boom barely slows a truck and a plank gate costs a car half its speed) and the jolt Δv for the pitch rock.
 */
export function vehicleResponse(kind, layout, mass, speed, outcome) {
  if (outcome === 'hold') return { loss: 1, dv: Math.min(2, speed) };
  const K = GATE_KINDS[kind] || GATE_KINDS.plank, J = Math.max(1, mass * speed), mg = gateMass(layout);
  const loss = Math.min(0.7, Math.max(0.04, K.work / J + mg / (mg + mass)));
  return { loss: Math.round(loss * 1e4) / 1e4, dv: Math.round(speed * loss * 1e3) / 1e3 };
}

/**
 * Impact geometry of `vehicle` hitting gate interactable `gate`: the contact point where the nose centre line meets
 * the gate line (clamped to the opening), in world and gate-local coordinates, and the travel direction in the gate
 * frame (local x along the gate, z across). Pure numbers, rounded (they feed the deterministic physics).
 */
export function smashInfo(gate, vehicle, layout) {
  const rot = gate.params?.rot ?? gate.params?.structure?.rot ?? 0, w = layout?.w ?? gate.params?.w ?? 4;
  const tx = Math.cos(rot), tz = Math.sin(rot), nx = -tz, nz = tx;
  const h = vehicle.heading ?? 0, dx = Math.cos(h), dz = Math.sin(h);
  const L = vehicle.def?.size?.[0] ?? 4;
  const ox = vehicle.x + dx * L / 2 - gate.x, oz = vehicle.z + dz * L / 2 - gate.z;
  const dn = dx * nx + dz * nz, on = ox * nx + oz * nz;
  const s = Math.abs(dn) > 1e-3 ? -on / dn : 0;
  const u = Math.max(-w / 2 + 0.1, Math.min(w / 2 - 0.1, (ox + dx * s) * tx + (oz + dz * s) * tz));
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return {
    x: r(gate.x + tx * u), z: r(gate.z + tz * u), u: r(u), y: bumperHeight(vehicle),
    dir: [r(dx * tx + dz * tz), r(dn)], // travel direction in the gate frame (along, across)
    heading: r(h), rot: r(rot), halfWidth: r((vehicle.def?.size?.[1] ?? 2) / 2),
  };
}

/** The gate interactable's structure def with its placement (the layout key). */
const defOf = (gate) => ({ ...(gate.params?.structure || {}), w: gate.params?.structure?.w ?? gate.params?.w, rot: gate.params?.rot ?? gate.params?.structure?.rot ?? 0 });

/**
 * Is the vehicle's nose at the gate plane this tick? (the nose centre line crosses the gate line within the opening,
 * ≤ `reach` m ahead of the bumper). Gates without a rotation fall back to the old radius test.
 */
export function inContact(vehicle, gate, reach = 0.35) {
  const P = gate.params || {};
  const L = vehicle.def?.size?.[0] ?? 4, h = vehicle.heading ?? 0, dx = Math.cos(h), dz = Math.sin(h);
  const nx0 = vehicle.x + dx * L / 2, nz0 = vehicle.z + dz * L / 2;
  if (P.rot == null && P.structure?.rot == null) return Math.hypot(gate.x - nx0, gate.z - nz0) <= (gate.radius || 1.5) + 0.5;
  const rot = P.rot ?? P.structure.rot, w = P.structure?.w ?? P.w ?? 2 * (gate.radius || 1.5);
  const tx = Math.cos(rot), tz = Math.sin(rot), nx = -tz, nz = tx;
  const ox = nx0 - gate.x, oz = nz0 - gate.z, on = ox * nx + oz * nz, dn = dx * nx + dz * nz;
  if (Math.abs(dn) < 0.2) return false; // grazing along the gate
  const ahead = -on / dn; // metres along the heading from the bumper to the gate line
  if (ahead > reach || ahead < -1.5) return false;
  const u = (ox + dx * ahead) * tx + (oz + dz * ahead) * tz;
  return Math.abs(u) <= w / 2 + (vehicle.def?.size?.[1] ?? 2) / 2;
}

/**
 * Decide a ram (pure): impact geometry, outcome and the vehicle response.
 * @returns {{kind:string, layout:object|null, info:object, outcome:string, J:number, mass:number, speed:number, loss:number, dv:number}}
 */
export function ramGate(vehicle, gate) {
  const def = defOf(gate), layout = isBreakableGate({ ...def, type: def.type || 'gate' }) ? layoutOf(def) : null;
  const kind = layout?.kind || gateKindOf(def) || 'plank';
  const mass = vehicleMass(vehicle), speed = Math.round(Math.max(0, vehicle.speed || 0) * 1e4) / 1e4;
  const { outcome, J } = ramOutcome(kind, mass, speed);
  const resp = vehicleResponse(kind, layout || { pieces: [] }, mass, speed, outcome);
  return { kind, layout, info: smashInfo(gate, vehicle, layout), outcome, J, mass, speed, loss: resp.loss, dv: resp.dv };
}

/**
 * The smash record stored on the gate (serialized with it) and announced as `gate:smash` {id, gate, vehicle, ...}.
 * Called by Interactable.ramBreak when a vehicle broke it.
 */
export function smashGate(gate, vehicle) {
  const r = ramGate(vehicle, gate), w = gate.world;
  const rec = { outcome: r.outcome === 'hold' ? 'burst' : r.outcome, kind: r.kind, J: r.J, mass: r.mass, speed: r.speed, info: r.info,
    tick: w?.tick ?? 0, vehicle: vehicle.id ?? null, seed: hashStr(`${gate.tag ?? gate.id}:${w?.tick ?? 0}`) };
  w?.events.emit('gate:smash', { id: gate.tag ?? gate.id, gate, vehicle, ...rec, x: r.info.x, z: r.info.z });
  return rec;
}

/** Seconds the vehicle accelerates at a fraction of its normal rate after a smash (Vehicle._updateDrive). */
export const RAM_DRAG_TIME = 0.9;

/**
 * Apply a ram to the vehicle (gameplay, deterministic, no physics needed): `hold` halts it at the gate (the gate bows,
 * `gate:hold`); a break takes `loss` of its speed, slows its re-acceleration for RAM_DRAG_TIME and pitches the body
 * (the physics-visuals blast rock, tilted forward along the travel direction).
 */
export function applyRamResponse(vehicle, gate, r) {
  const w = vehicle.world;
  if (r.outcome === 'hold') {
    vehicle._halt?.();
    vehicle.speed = 0;
    w?.events.emit('gate:hold', { id: gate.tag ?? gate.id, gate, vehicle, x: r.info.x, z: r.info.z, J: r.J, dir: r.info.dir });
  } else {
    vehicle.speed = Math.round(vehicle.speed * (1 - r.loss) * 1e4) / 1e4;
    vehicle.ramDrag = RAM_DRAG_TIME;
  }
  const h = vehicle.heading ?? 0;
  // physics-visuals `_vehicles` rock: the top tilts away from (bx, bz) → a source behind the vehicle pitches it forward
  vehicle.blastRock = { t0: w?.time ?? 0, dv: Math.min(0.6, 0.12 + r.dv * 0.1), // ≈ 3° pitch for a truck, 5° for a car
    heavy: r.mass > 6000, dx: Math.cos(h), dz: Math.sin(h), bx: vehicle.x, bz: vehicle.z, ram: true };
}

/**
 * A driven vehicle halted by a closed rammable gate right in front of its nose (a slow order, §3.7 "stops at the first
 * blocking cell"): the gate holds and bows (`gate:hold`, visual + sound only; no noise, no gameplay change).
 */
export function bumpGate(vehicle) {
  const w = vehicle.world;
  for (const o of w?.interactables || []) {
    if (o.destroyed || o.open || !o.barrier || o.interactKind !== 'door' || !inContact(vehicle, o, 1.2)) continue;
    const info = smashInfo(o, vehicle, layoutOf(defOf(o)));
    w.events.emit('gate:hold', { id: o.tag ?? o.id, gate: o, vehicle, x: info.x, z: info.z, J: Math.round(vehicleMass(vehicle) * vehicle.speed * 0.2), dir: info.dir });
    return true;
  }
  return false;
}
