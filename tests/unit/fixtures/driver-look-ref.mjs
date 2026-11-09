/**
 * The solution driver's walkerSees and rowClear as they were before the M1 perf pass (master 58ffc0200,
 * tools/solutions/driver.mjs): a ghost and its cone built for every head, a fresh dummy, spread copy, cone and options
 * object for every test. Kept verbatim (save for the parameters the closure gave them) as the reference
 * tests/unit/driver-look-exact.test.mjs holds the live code to.
 */
import { mirrorOf, ghostOn } from '../../../tools/solutions/ghost.mjs';
import { predictEnemy } from '../../../tools/solutions/driver.mjs';
import { canSee, coneAt, pointInCone, newCone } from '../../../src/ai/perception.js';
import { CONFIG } from '../../../src/config.js';

const _seeOpt = { cone: null }, _seeCone = newCone();
export function refWalkerSees(e, q, dummy, w, tAbs) {
  const amp = e.sweepAmp ?? e.vision?.sweep ?? 0; // radians (normalised vision data)
  const v = e.vision, a0 = v?.far ?? v?.range, dx = dummy.x - q.x, dz = dummy.z - q.z;
  const reach = v?.elliptical ? a0 * Math.max(1, v.ellipseRatio ?? CONFIG.stealth.ellipseRatio) : a0;
  if (Number.isFinite(reach) && dx * dx + dz * dz > reach * reach * (1 + 1e-9) + 1e-9) return false;
  const nh = q.alt != null ? 2 : 1, no = amp ? 5 : 1;
  const m = mirrorOf(e);
  for (let ih = 0; ih < nh; ih++) {
    const hd = ih ? q.alt : q.heading;
    for (let io = 0; io < no; io++) {
      const off = io === 0 ? 0 : io === 1 ? amp / 2 : io === 2 ? -amp / 2 : io === 3 ? amp : -amp;
      const g = ghostOn(m);
      g.x = q.x; g.z = q.z; g.heading = hd; g.sweepActive = false; g.headOffset = off;
      const cone = coneAt(g, tAbs, _seeCone);
      _seeOpt.cone = cone;
      const seen = pointInCone(cone, dummy.x, dummy.z) && canSee(g, dummy, w, _seeOpt) !== 'none';
      _seeOpt.cone = null;
      if (seen) return true;
    }
  }
  return false;
}

/** rowClear of a driver on world `w` (its raft `raft`, tick `dt`). */
export function refRowClear(w, raft, dt, pts, { delay = 0, slack = [-0.1, 0.25], step = 0.5, minDist = 6, why = null, fast = false, from = null, hold = 0, pad = 0, except = null } = {}) {
  const walkerSees = refWalkerSees;
  const sp = (fast ? raft.def?.fast : raft.def?.slow) || 2.5, rate = raft.def?.turn || Math.PI / 2;
  const samples = [];
  let [x, z, h] = from ?? [raft.x, raft.z, raft.heading], t = delay + 2 * dt;
  for (const [px, pz] of pts) {
    const want = Math.atan2(pz - z, px - x);
    let dh = Math.abs(((want - h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    t += Math.max(0, dh - 0.05) / rate + 0.25;
    h = want;
    const L = Math.hypot(px - x, pz - z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= n; k++) for (let o = slack[0]; o <= slack[1] + 1e-6; o += 0.1) samples.push([x + ((px - x) * k) / n, z + ((pz - z) * k) / n, Math.max(0, t + o + (L * k) / n / sp)]);
    t += L / sp; x = px; z = pz;
  }
  for (let o = 0; o <= hold + 1e-6; o += 0.25) samples.push([x, z, t + o]);
  const boat = { isOpenBoat: true, def: { seated: true, occludes: false } };
  for (const e of w.enemies) {
    if (!e.alive || e.removed || !e.vision || except?.includes?.(e)) continue;
    const moving = e.isMoving || e.path || (e.route && e.route.length > 1), far = (e.vision.far ?? 36) + 1;
    for (const [sx, sz, st] of samples) {
      const q = moving ? predictEnemy(e, st) : { x: e.x, z: e.z, heading: e.heading };
      const dd = Math.hypot(q.x - sx, q.z - sz);
      if (dd > far) continue;
      if (dd < minDist && moving) { if (why) why.push(`${e.tag} close@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
      const dummy = { x: sx, z: sz, y: 0, state: 'inVehicle', vehicle: boat, isVisibleToEnemies: true, alive: true };
      const still = moving && e.squad?.id != null && Math.hypot(q.x - e.x, q.z - e.z) < 1;
      const sees1 = (d) => moving ? walkerSees(e, q, d, w, w.time + st) || (still && walkerSees(e, { x: q.x, z: q.z, heading: e.heading }, d, w, w.time + st))
        : canSee(e, d, w, { cone: coneAt(e, w.time + st) }) !== 'none';
      const ux = (q.x - sx) / (dd || 1), uz = (q.z - sz) / (dd || 1);
      const sees = sees1(dummy) || (pad > 0 && dd > pad && [[ux, uz], [-uz, ux], [uz, -ux]].some(([ox, oz]) => sees1({ ...dummy, x: sx + ox * pad, z: sz + oz * pad })));
      if (sees) { if (why) why.push(`${e.tag}@(${sx.toFixed(1)},${sz.toFixed(1)})+${st.toFixed(1)}`); return false; }
    }
  }
  return true;
}
