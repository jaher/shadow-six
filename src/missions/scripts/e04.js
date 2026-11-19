/**
 * LIGHTS OUT mission 4 "Black Rain" (docs/expansion/e04.md): mission-local helpers and runtime glue.
 *
 * Geometry (pure, node-safe; the mission def builds its terrain structures with them):
 *  - levelStrips(poly, y): a raised level as `walkways` strips, one 0.5 m grid row each (map-builder has no area elev);
 *  - offsetPoly / clipRect: the spoil heap's sight rings (each ring a `cliff` with its own height, so a man on the top
 *    looks down over the flanks the way the drawn slope lets him, not over an 18 m wall);
 *  - rampSteps(a, b, width, steps): a path's stepped strips (≤ 0.5 m a step: grid MAX_STEP).
 * Runtime (`e04Script(opts)` → the def's `script`):
 *  - the archive (o1): done when a commando takes the papers from the chief's office;
 *  - the shaft (§9): on the centre alarm (RC) the station chief walks to his office, takes the archive and carries it
 *    to the shaft collar; once there it goes down after `shaftRing` s and the mission is lost. Out cold, bound, on
 *    strings or dead on the way, he drops it where he falls (it can be taken there). Once o1 is done it does nothing;
 *  - the DF lorries: on RC their drivers wake and drive them out by the west road;
 *  - the incline: on the east alarm (RE) a free winchman stops it (`locked`): a skip on its way finishes the trip.
 * Visuals: `script.visuals` builds the colliery art (art/e04-dressing.js buildE04Art).
 * @module missions/scripts/e04
 */

const CELL = 0.5;

/** Sorted x-intervals where the horizontal line z crosses the inside of `poly` (even-odd rule). */
export function polyRow(poly, z) {
  const xs = [];
  for (let k = 0; k < poly.length; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length];
    if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

/** Point in polygon (even-odd). */
export function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * Walkway strips raising every grid cell whose centre lies inside `poly` to height `y` (one strip per 0.5 m row).
 * @returns {{points: number[][], width: number, y: number}[]}
 */
export function levelStrips(poly, y) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const out = [];
  for (let zc = Math.floor(z0 / CELL) * CELL + CELL / 2; zc < z1; zc += CELL) {
    for (const [a, b] of polyRow(poly, zc)) {
      const x0 = Math.ceil(a / CELL - 0.5) * CELL + CELL / 2, x1 = Math.floor(b / CELL - 0.5) * CELL + CELL / 2;
      if (x1 < x0) continue;
      // (a strip of width 0.5 centred on the row covers exactly that row's cells; its ends at the cell centres ± 0.2)
      out.push({ points: [[+(x0 - 0.2).toFixed(3), +zc.toFixed(3)], [+(x1 + 0.2).toFixed(3), +zc.toFixed(3)]], width: CELL * 0.98, y });
    }
  }
  return out;
}

/** Signed area (x right, z down): > 0 for the vertex order this module writes (counter-clockwise on the map). */
function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; s += ax * bz - bx * az; }
  return s / 2;
}

/** A convex polygon grown by `d` m on every side (mitred corners). */
export function offsetPoly(poly, d) {
  const sgn = area(poly) > 0 ? 1 : -1, n = poly.length, normals = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n], L = Math.hypot(bx - ax, bz - az) || 1;
    normals.push([sgn * (bz - az) / L, -sgn * (bx - ax) / L]);
  }
  return poly.map(([x, z], i) => {
    const a = normals[(i + n - 1) % n], b = normals[i], k = d / (1 + a[0] * b[0] + a[1] * b[1]);
    return [+(x + (a[0] + b[0]) * k).toFixed(2), +(z + (a[1] + b[1]) * k).toFixed(2)];
  });
}

/** Sutherland–Hodgman clip of `poly` to the rectangle [x0, x1] × [z0, z1]. */
export function clipRect(poly, x0, z0, x1, z1) {
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((x0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((x1 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[1] >= z0, (a, b) => [a[0] + ((z0 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z0]],
    [(p) => p[1] <= z1, (a, b) => [a[0] + ((z1 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z1]]];
  let out = poly;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
  }
  return out.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]);
}

/**
 * A stepped path from a [x, z, y] to b [x, z, y]: `steps` strips `width` wide, each a level step (rise ≤ MAX_STEP).
 * @returns {{points: number[][], width: number, y: number}[]}
 */
export function rampSteps(a, b, width, steps) {
  const [ax, az, ay] = a, [bx, bz, by] = b;
  const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
  const out = [];
  for (let k = 0; k < steps; k++) {
    const s0 = Math.max(0, (k / steps) * len - 0.15), s1 = Math.min(len, ((k + 1) / steps) * len + 0.15);
    const y = +(ay + (by - ay) * ((k + 0.5) / steps)).toFixed(3);
    out.push({ points: [[+(ax + ux * s0).toFixed(2), +(az + uz * s0).toFixed(2)], [+(ax + ux * s1).toFixed(2), +(az + uz * s1).toFixed(2)]], width, y });
  }
  return out;
}

// ------------------------------------------------------------------ runtime

const near = (u, p, r) => !!u && Math.hypot(u.x - p[0], u.z - p[1]) <= r;
/** He can carry nothing on: dead, out cold, bound, on puppet strings, carried. */
const disabled = (e) => !e || !e.alive || e.removed || !!e.incapacitated || e.state === 'carried';

/**
 * The mission script. `o`: { office: [x, z] (where the chief takes the papers), shaft: [x, z] (the collar he drops them
 * in), chief: enemy id, archive: interactable id, objective: 'o1', ring: s at the collar, failText, lorries: [{id, to:
 * [[x, z], …]}], incline: lift id, winchman: enemy id, art: visuals fn }.
 * @returns {Function & {visuals?: Function}}
 */
export function e04Script(o) {
  const run = (world, dir) => {
    const w = world, ev = w.events;
    const objective = () => (w.objectives || []).find((q) => q.id === o.objective);
    const done = () => !!objective()?.done;
    const archive = () => w.interactables.find((i) => (i.tag ?? i.id) === o.archive || i.spawn?.id === o.archive);
    const complete = () => {
      const q = objective();
      if (!q || q.done) return;
      q.done = true; q.hidden = false;
      ev.emit('objective:update', { objective: q });
      ev.emit('message', { text: 'The bearing archive is ours. The shaft cannot have it now.', kind: 'objective' });
    };
    // o1: a commando has the papers
    w.listen('documents:taken', (p) => { if (p.by?.kind === 'commando' && (p.item?.tag ?? p.item?.id) === o.archive) complete(); });
    // a save taken after the papers changed hands: o1 follows whoever holds them
    if (w.commandos.some((c) => c.documents?.includes(o.archive))) complete();

    // the shaft (§9): the chief's errand on the centre alarm
    const S = (w._e04 ||= { stage: null, t: 0, carried: false });
    const chief = () => w.byId(o.chief) || w.enemies.find((e) => e.tag === o.chief);
    const send = (pts) => { const e = chief(); if (e?.brain?.reinforce) e.brain.reinforce(pts.map(([x, z]) => ({ x, z })), [{ x: pts.at(-1)[0], z: pts.at(-1)[1] }]); };
    const start = () => {
      if (S.stage || done() || disabled(chief())) return;
      const a = archive();
      if (!a || a.takenBy) return; // (already in a commando's hands, or gone)
      S.stage = 'office';
      send([o.office]);
      ev.emit('e04:shaft', { stage: 'office' });
    };
    w.listen('alarm:zone', (p) => {
      if (p.event === o.alarm) start();
      if (p.event === o.alarm) for (const L of o.lorries || []) driveOff(w, L);
      if (p.event === o.lockOn) lockIncline(w, o);
    });
    w.onBelTick((dt) => {
      if (!S.stage || S.stage === 'down' || S.stage === 'off') return;
      const e = chief(), a = archive();
      if (done()) { S.stage = 'off'; return; }
      if (disabled(e)) { // he fell on the way: the papers lie where he fell
        if (S.carried && a) { a.dropAt(e?.x ?? o.shaft[0], e?.z ?? o.shaft[1]); S.carried = false; }
        S.stage = 'off';
        return;
      }
      if (S.stage === 'office' && near(e, o.office, 1.6)) {
        if (!a || a.takenBy) { S.stage = 'off'; return; }
        a.takeBy(e); S.carried = true; S.stage = 'shaft';
        send([o.office, o.shaft]);
        ev.emit('e04:shaft', { stage: 'shaft' });
      } else if (S.stage === 'shaft' && near(e, o.shaft, 1.8)) {
        S.stage = 'ring'; S.t = o.ring;
        ev.emit('e04:shaft', { stage: 'ring' });
        ev.emit('message', { text: 'The station chief is at the shaft with the archive!', kind: 'warn' });
      } else if (S.stage === 'ring' && (S.t -= dt) <= 0) {
        S.stage = 'down';
        ev.emit('e04:shaft', { stage: 'down' });
        dir.fail(o.failText);
      }
    });
  };
  if (o.art) run.visuals = o.art;
  return run;
}

/** RC: a DF lorry's driver wakes and drives it out by the west road (cosmetic once the charges are on it). */
function driveOff(w, L) {
  const v = w.byId(L.id);
  if (!v || v.destroyed || v.removed || v._e04Away || v.driver?.kind === 'commando') return;
  v._e04Away = true;
  if (v.brain) v.brain.state = 'done';
  v.followPath?.(L.to.map(([x, z]) => ({ x, z })), { speed: L.speed ?? 6 });
}

/** RE: a free winchman stops the incline (a skip on its way still finishes the trip). */
function lockIncline(w, o) {
  const lift = w.interactables.find((i) => (i.tag ?? i.id) === o.incline);
  const man = w.byId(o.winchman) || w.enemies.find((e) => e.tag === o.winchman);
  if (lift && !disabled(man)) lift.locked = 'The winchman has stopped the incline.';
}
