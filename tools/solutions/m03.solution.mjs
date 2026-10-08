/**
 * M3 "Reverse Engineering" (Sysendam dam): a full stealth solution, played only with player orders.
 * Driver API: tools/solutions/driver.mjs. Reference run, in the real game: node tools/solutions/run-browser.mjs m03
 * (also tests/m03-solution.test.mjs). run-headless.mjs is a quick approximation only: the headless grid lacks the
 * library meshes' nav clearance, so timings there drift from the game's.
 *
 * Never seen (user 2026-10-08: "make sure no commando goes inside the field of view of a solider before being spotted.
 * Even the raft boat in the light shaded field of view of a soldier makes the soldier see it"): no commando, and no raft
 * with men in it, is ever where a live cone's rule sees him (the driver's exposure watch: tests/m03-solution). A crewed
 * raft is seen in both bands, so it moves only where and when no cone reaches; every crawl, row and wait is timed on
 * the guards' predicted cones (driver planSneak / sneak), and the Green Beret waits dug into the snow.
 *
 * Outline (design-spec §7.6 "Intended solution", adapted: e17's sweep covers the raft where it lies, so the uniform
 * cannot come by raft first):
 *   A  plateau: the Sapper's bear trap takes the p1 sergeant (e1); the GB's decoy freezes e2/e3 for the Marine's harpoon
 *   B  gully: the GB knifes e5 and e4 from behind and carries both bodies up onto the plateau
 *   C  e8 walks the strip N of the camp end to end: the GB ambushes him at the W end of his beat (dug in by the
 *      palisade), knifes him and carries him into the niche between the rocks under the cliff (seen from nowhere, not
 *      through the N gate either), then digs in W of e9; the Spy crawls round the E camp (behind e9, down its E side,
 *      along the strip outside the palisade, which hides her from e13) to the clothesline and puts the uniform on
 *   D  the Marine dives in the shallows below the E stair, swims down the river under water and harpoons e14 (who
 *      watches the strip, his back to the water) from 6.5 m: nobody sees that water or the body
 *   E  the Spy walks over the dam crest (out of every cone 7 m up), through the N gap, cuts the fence power at the
 *      admin-block switch and chats up e17 from his W side (his back to the river) — for most of the mission
 *   F  the GB's decoy N of the camp (on just after e7's round has taken him off E) turns e12 away from the W gate; the
 *      GB knifes e6 from behind and carries him down the strip to e14; decoy off and fetched back
 *   G  with e6 gone and e17 held the raft crosses unseen (boarding in a quiet moment, p5 on the W of its round): GB and
 *      Sapper land on the S bank; the Marine packs the raft (an empty raft in view is shot at, whoever hides beside it)
 *      and dives; the Sapper cuts the dead fence, crawls up the shed's ramp (the barn's bridge), goes in at its threshing
 *      door for both charges (they lie on the loft inside) and comes back out
 *   H  the Marine deploys the raft again and fetches the Sapper to the E stair (raft packed again): he waits on the
 *      dam crest. The GB digs in on the strip; the Spy
 *      holds e18 at the N gate while the GB drops the decoy by it, then goes back to e17; the raft (deployed below the
 *      E stair) takes the GB to the E stair and is packed. (The bunker stands W of the W stair: the decoy goes down S of
 *      it, by p5's W leg.) Decoy on (by radio): the gunner, e18 and p5 turn to it; the Sapper comes down the W stair,
 *      crawls W along its foot to the bunker's NE entrance, goes in and sets charge one inside, walks back up and along the crest to the spillway
 *      gates (charge two) and off down the E stair: bunker and dam blow (o1, o2)
 *   I  the truck comes for them north of the dam; all four get in (o3)
 * Orders only (move / run / crawl / stance / ability / leave & board vehicles); timing reads what a player sees.
 */

// p5 (the 5-man squad circling the bunker) stays on the W part of its round (x < 22: 38 m+ off the river) for `sec` s
const p5West = (D, sec) => { const e = D.get('e29'); if (!e?.alive) return true; for (let t = 0; t <= sec; t += 1) if (D.predict(e, t).x > 22) return false; return true; };
// p5 has just left its E-end halt at (30,54) and walks west — all five of them, the rear men included
const P5 = ['e29', 'e30', 'e31', 'e32', 'e33'];
const p5Departed = (D) => P5.every((t) => { const e = D.get(t); return !e.alive || (e.x < 29.3 && e.x > 18 && Math.cos(e.heading) < -0.5); });
const objective = (D, id) => D.world.objectives.find((q) => q.id === id).done;
const deg = (h) => ((h * 180) / Math.PI + 360) % 360;

/** walker `tag` (predicted on his route) keeps `dist` m from (x, z) for the next `sec` s (or from `from` s on) */
const staysAway = (D, tag, [x, z], dist, sec, from = 0) => {
  const e = D.get(tag);
  if (!e?.alive) return true;
  for (let t = from; t <= sec; t += 0.5) { const q = D.predict(e, t); if (Math.hypot(q.x - x, q.z - z) < dist) return false; }
  return true;
};

/** the camp's walkers (e7, e10) stay `sec` s and more away from the W gate, where they look out at e6's post */
const campAwayFromGate = (D, sec) => ['e7', 'e10'].every((t) => {
  const e = D.get(t);
  if (!e?.alive) return true;
  for (let k = 0; k <= sec; k += 0.5) { const q = D.predict(e, k); if (Math.hypot(q.x - 98, q.z - 57) < 11) return false; }
  return Math.hypot(e.x - 98, e.z - 57) >= 11;
});

/** wait (up to maxSec) until nobody will see a standing man at any of `pts` for the next `dur` s */
async function clearWindow(D, pts, dur = 4, maxSec = 150, label = 'clear window', extra = null, pad = 0) {
  await D.until(() => (!extra || extra()) && pts.every(([x, z]) => D.clearAhead(x, z, dur, false, null, null, pad)), maxSec, label);
}
// p5 on the far (west) half of its loop: 35 m+ from the river strip below the station's NE fence
const p5FarWest = (D) => D.get('e29').x < 19;
/**
 * Wait for a moment the raft (crewed: seen in both bands) may lie where it is for `hold` s unseen and then has a way to
 * `to` (planSneak from that moment): the time it takes the men to get in and the Marine to take the oars.
 */
async function raftWindow(D, raft, to, hold, label, maxSec = 600, back = null, { alsoClear = null, ...opts } = {}) {
  let k = 0;
  const packed = raft.def ? {} : { from: [raft.x, raft.z] }; // (`raft` a spot {x, z}: the packed raft, deployed there)
  await D.until(() => {
    if (k++ % 30) return false; // (look again every half second)
    const dbg = globalThis.process?.env?.RWDBG && k % 300 === 1 ? [] : null;
    if (!p5West(D, hold + (globalThis.process?.env?.P5W ? +globalThis.process.env.P5W : 25))) { if (dbg) D.log(`   rw ${D.t.toFixed(1)} p5 not W`); return false; } // the 5-man patrol's place in a file is only roughly predictable: wait it out W
    if (!D.clearAhead(raft.x, raft.z, hold, false, dbg, null, 2)) { if (dbg) D.log(`   rw ${D.t.toFixed(1)} raft spot seen [${dbg.join(' ')}]`); return false; }
    // (`alsoClear`: where the Marine walks to it, standing)
    if (alsoClear && !alsoClear.every(([x, z]) => D.clearAhead(x, z, hold, false, dbg, null, 2))) { if (dbg) D.log(`   rw ${D.t.toFixed(1)} way to the raft seen`); return false; }
    const p = D.planSneak(...to, { mode: 'raft', box: 12, startDelay: hold - 1, horizon: 120, maxExpand: 120000, why: dbg ?? undefined, ...packed, ...opts });
    if (dbg && !p) D.log(`   rw ${D.t.toFixed(1)} no way there [${dbg.join(' ')}]`);
    if (!p || !back) return !!p;
    // a round trip (`back`: [x, z, s aboard there]): the way back must be clear too, from where this leg ends
    const p2 = D.planSneak(back[0], back[1], { mode: 'raft', box: 12, from: to, startDelay: p[p.length - 1][2] - D.t + back[2], horizon: 180, maxExpand: 120000, why: dbg ?? undefined, ...opts });
    if (dbg && !p2) D.log(`   rw ${D.t.toFixed(1)} no way back (there at +${(p[p.length - 1][2] - D.t).toFixed(1)}) [${dbg.join(' ')}]`);
    return !!p2;
  }, maxSec, `${label}: a quiet moment`);
}

/** the Spy (in uniform: nobody looks twice) walks over to `e` and chats him up from `at` (he turns to her) */
async function spyHolds(D, e, at) {
  D.order('spy', { type: 'stop' });
  await D.go('spy', ...at, { tol: 0.3 });
  D.ability('spy', 'distract', e);
  await D.until(() => e.brain.state === 'DISTRACTED', 10, `${e.tag} distracted`);
}
const spot = (u) => ({ x: u.x, z: u.z });
/** the nearest point within `r` m of (x, z) standing well inside shallow water (0.3 m of shallows all round) */
function shallowNear(D, x, z, r = 1.8) {
  const ok = (a, b) => { const g = D.world.groundAt(a, b); return g.shallow && !g.bridge; };
  let best = null, bd = Infinity;
  for (let dx = -r; dx <= r; dx += 0.1) for (let dz = -r; dz <= r; dz += 0.1) {
    const d = Math.hypot(dx, dz), px = x + dx, pz = z + dz;
    if (d > r || d >= bd || !ok(px, pz) || ![[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([a, b]) => ok(px + a, pz + b))) continue;
    best = [px, pz]; bd = d;
  }
  if (!best) throw new Error(`no shallows within ${r} m of (${x.toFixed(1)},${z.toFixed(1)})`);
  return best;
}
/**
 * The Marine (out of the raft, gear off) packs it (hand, 2 s) standing in the shallows beside it: the click goes where
 * he stands (the raft lies within 2 m of it), so he does not wade out to its middle first
 */
async function packRaft(D, raft) {
  const dv = D.c('diver'), at = shallowNear(D, raft.x, raft.z);
  await D.go('diver', ...at, { tol: 0.12 });
  D.ability('diver', 'hand', { x: dv.x, z: dv.z });
  await D.until(() => !D.raft(), 6, 'raft packed');
}
/** the Marine (gear off, in the shallows) deploys the packed raft where he stands and sits in it (2 s, §3.4) */
async function deployRaft(D) {
  const dv = D.c('diver');
  D.ability('diver', 'raft');
  await D.until(() => D.raft() && dv.vehicle === D.raft() && !dv.currentAction, 8, 'raft deployed, Marine aboard');
}
/** step off the raft when no cone will cover the bank point, then drop prone at once */
async function landProne(D, role, x, z) {
  const u = D.c(role), raft = D.raft();
  await clearWindow(D, [[x, z], [raft.x, raft.z]], 3, 150, `${role} lands`, null, 2); // (a walker 2 m off his pace: still clear)
  D.ability(role, 'leaveVehicle');
  await D.wait(0.05);
  if (D.world.groundAt(u.x, u.z).shallow) await D.go(role, x, z, { tol: 0.4 });
  await D.stance(role, 'crawl');
}
/** board the raft from the bank when no cone will cover him getting up and climbing in */
async function boardRaft(D, role, boardPoint, extra = null, margin = 0.8) {
  const u = D.c(role), raft = D.raft();
  let bp = boardPoint(raft, u);
  const d0 = Math.hypot(bp.x - u.x, bp.z - u.z);
  if (d0 > 0.8 && !D.world.groundAt(bp.x, bp.z).shallow) { // creep up to the hull first (prone, unseen)
    await D.go(role, bp.x + ((u.x - bp.x) / d0) * 0.4, bp.z + ((u.z - bp.z) / d0) * 0.4, { tol: 0.3 });
    bp = boardPoint(raft, u);
  }
  const dur = (u.stance === 'crawl' ? 0.6 : 0) + Math.hypot(bp.x - u.x, bp.z - u.z) / 1.5 + 0.55 + margin; // get up, walk to the hull, climb in (+ margin)
  await clearWindow(D, [[u.x, u.z], [bp.x, bp.z]], dur, 150, `${role} boards`, extra, 2);
  D.ability(role, 'enterVehicle', raft);
  await D.until(() => u.vehicle === raft, 15, `${role} aboard`);
}

/**
 * The cautious crawl: before each leg the GB checks that nobody will see it; if someone would, he digs in where he
 * is (snow) and waits under it until the leg is clear, then digs out and goes on. `finalPause` = time spent at the end.
 */
async function crawlCautiously(D, pts, { finalPause = 0, maxWait = 900, lastWhen = null } = {}) {
  const gb = D.c('greenberet');
  for (let k = 0; k < pts.length; k++) {
    const leg = [[pts[k][0], pts[k][1], k === pts.length - 1 ? finalPause : 0.5]];
    const when = k === pts.length - 1 && lastWhen ? lastWhen : () => true; // (the last leg: an extra condition)
    if (!when() || !D.routeClear('greenberet', leg, { delay: gb.buried ? 1.5 : 0.3 })) {
      if (!gb.buried) { D.ability('greenberet', 'shovel'); await D.until(() => gb.buried, 5, 'GB digs in to wait'); }
      const why = []; // (who keeps the leg covered, for the timeout message)
      await D.until(() => { why.length = 0; return when() && D.routeClear('greenberet', leg, { delay: 1.5, why }); }, maxWait, `clear leg to (${pts[k]})`)
        .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    }
    if (gb.buried) await gbRise(D); // (up out of the snow only when nobody looks there either)
    await D.go('greenberet', pts[k][0], pts[k][1], { tol: 0.35 });
  }
}

// the Spy's way to the uniform (round the E camp, out of every near band): gully, then the camp's N, E and SW sides
const CAMP = [[98, 48], [142, 48], [142, 96], [126, 90], [98, 66]]; // inside the E camp's palisade
const SPY_GULLY = [[86, 16], [83, 22], [82.5, 30], [83, 44]];
const MARINE_TO_SHALLOWS = [[86, 16], [83, 22], [82.5, 30], [75, 34], [64, 36], [57.5, 35.5]];
const E6_BACK = [81.1, 55.3]; // e6's back (he faces the river, 150°)
const S_BANK = [59.6, 63.6]; // the raft's landing on the S bank, below the station's NE fence
const FENCE_IN = [55.5, 80.6]; // inside the cut fence, out of e17's and e20's sight
const E17_TALK = [48.5, 74.0]; // e17's W side: he turns his back on the river and the shed
const E19_TALK = [22.6, 63.4]; // W of the N end of e19's beat: he turns his back on the strip
const E20_TALK = [26.9, 78.9]; // e20's NW side: he turns his back on the shed
const SHED_RAMP_FOOT = [39.6, 92.9]; // the foot of the station shed's ramp (the barn's bridge up to its threshing door)
const E_STAIR_RAFT = [56.3, 37.6]; // where the raft lies afterwards (the shallows below the E stair)
const GB_PICKUP = [63.5, 69.6]; // where the GB waits for the raft on the S bank, across from RAFT_HIDE
const RAFT_HIDE = [66.5, 69.5]; // a lie off the S bank just beyond e12's and p5's reach (while the Spy holds e17)
const GB_WAIT = [41, 56.5]; // the GB's place in the snow on the strip, 20 m from e17
// the dam bunker stands W of the W stair (10, 44; 2026-10-08 "The bunker in mission 3 is too close to the stairs"), its
// front (slit, entrance trench) NE: the decoy goes down S of it, by p5's W leg, where the gunner (12.7 m), e18 (12.4 m)
// and e19 at the N end of his beat (12.4 m) all hear it — each turns to it with the stair, its foot and the trench's
// mouth N of him, out of his eyes
const N_DECOY_WAIT = [34, 56.2]; // the GB's place in the snow E of p5's halt (30, 54): he goes on from here behind p5
const N_DECOY_FENCE = [15.4, 57.3]; // his place in the snow by the fence S of the decoy spot (2.5 m off p5's W leg)
const N_DECOY = [15.1, 56.1]; // where he drops the decoy (facing NW, it lands 0.4 m ahead of him)
const FENCE_W = [[29.5, 56.9], [25.5, 57.1], [21.5, 57.2], [18.5, 57.3]]; // his crawl along the fence behind p5's beat
// the truck road N of the dam, out of every cone: where the four wait for the truck
const E_STAIR_FOOT = [59.35, 34.3];
const TRUCK_WAIT = { diver: [63.5, 5.5], spy: [64.5, 7.5], greenberet: [66, 5], sapper: [63, 9.5] }; // beside the truck road's end (it stops at (60, 9.2))
const MARINE_WAIT = [58.2, 37.0]; // prone by the E stair foot (the raft packed: an empty raft in view is shot at, §4.3)
const E12_DECOY = [101, 45]; // 12 m N of e12, outside the palisade: he turns his back on the W gate
const E12_DECOY_WAY = [[92, 44.5], [101, 44.6]];
const E6_CARRY = [[83, 58], [90, 64], [96.5, 69.5], [101.6, 73.3]]; // down the strip, out of e12's cone while he faces N
const E8_AMBUSH = [126.4, 47.6]; // between the palisade and the W end of e8's beat (he halts there looking N)
const E8_LANE = [[110, 47.2], [117.5, 47.5], [124.5, 47.5], E8_AMBUSH];
const E8_WAIT = [105, 46]; // the GB's place in the snow W of e9, out of e8's near band
const E8_NICHE = [[134.5, 45], [136, 41.5]]; // the gap between the two rocks under the cliff E of the N gate
const SPY_ROUND = [[100, 44], [116, 47.5], [130, 46], [145, 50], [146, 75], [146, 100], [138, 99], [128, 95], [120, 89], [114.5, 83.5]];

/** the GB digs himself into the snow (2 s; nobody may see him go under) */
async function digIn(D) {
  const gb = D.c('greenberet');
  D.ability('greenberet', 'shovel');
  await D.until(() => gb.buried, 6, 'GB dug in');
}
/** the GB digs himself out, prone */
async function gbRise(D) {
  const gb = D.c('greenberet');
  if (!gb.buried) return;
  // (upright a moment; the 5-man patrol's file is only roughly predictable: none of them within 11 m either)
  const why = [];
  let dbg = 0;
  await D.until(() => {
    why.length = 0;
    const a = D.clearAhead(gb.x, gb.z, 2.5, false, why), b = gb.x > 38 || P5.every((t) => staysAway(D, t, [gb.x, gb.z], 7, 3) || !why.push(t));
    if ((globalThis.process?.env?.RISEDBG || globalThis.__M3DBG) && dbg++ % 300 === 0) D.log(`DBG rise? ${D.t.toFixed(1)} clear=${a} p5=${b} [${why.join(' ')}] e19 ${D.get('e19').x.toFixed(1)},${D.get('e19').z.toFixed(1)} h${deg(D.get('e19').heading)}`);
    return a && b;
  }, 300, 'nobody looking where the GB comes up')
    .catch((e) => { throw new Error(`${e.message} at (${gb.x.toFixed(1)},${gb.z.toFixed(1)}) [${why.join(' ')}]`); });
  D.order('greenberet', { type: 'move', x: gb.x, z: gb.z });
  await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB out of the snow');
  await D.stance('greenberet', 'crawl');
}
/**
 * The GB's sneak: each leg on a planSneak plan; where no way is clear he digs into the snow and waits under it
 * (buried men are seen by nobody), then digs out and goes on.
 */
async function gbSneak(D, x, z, o = {}) {
  const gb = D.c('greenberet');
  const opts = { mode: 'crawl', role: 'greenberet', box: 10, keep: 1.5, forbid: [CAMP], label: `GB to (${x},${z})`, ...o };
  const why = [];
  for (let i = 0; i < 600; i++) {
    if (Math.hypot(gb.x - x, gb.z - z) < 0.9) return;
    why.length = 0;
    const p = D.planSneak(x, z, { ...opts, startDelay: gb.buried ? 1.5 : 0, horizon: 90, maxExpand: 80000, why });
    if (globalThis.__M3DBG && !p && i % 40 === 0) D.log(`DBG ${D.t.toFixed(1)} gbSneak → (${x},${z}) at (${gb.x.toFixed(1)},${gb.z.toFixed(1)})${gb.buried ? ' buried' : ''}: none [${why.join(' ')}]`);
    if (p) {
      await gbRise(D);
      if (await D.sneak(x, z, { ...opts, noWait: true })) return;
      continue;
    }
    if (!gb.buried) await digIn(D);
    await D.wait(1);
  }
  // (who keeps him there: each viewer alone, on the cell one step towards the goal)
  const L = Math.hypot(x - gb.x, z - gb.z) || 1, nx = gb.x + (x - gb.x) / L, nz = gb.z + (z - gb.z) / L;
  const tags = D.world.enemies.filter((e) => e.alive && e.vision && Math.hypot(e.x - nx, e.z - nz) < 45).map((e) => e.tag);
  const blk = tags.filter((t) => !D.planSneak(nx, nz, { ...opts, from: [nx, nz], box: 2, hold: 10, horizon: 15, maxExpand: 50, ignore: tags.filter((q) => q !== t) }));
  const e19 = D.get('e19'), tl = [];
  for (let t = 0; t <= 60; t += 4) { const q = D.predict(e19, t); tl.push(`+${t}:${q.x.toFixed(0)},${q.z.toFixed(0)}h${Math.round(deg(q.heading))}`); }
  const cw = []; D.clearAhead(nx, nz, 60, true, cw); tl.push(`clearAhead60:[${cw.join(' ')}]`);
  throw new Error(`GB: no way to (${x},${z}) from (${gb.x.toFixed(1)},${gb.z.toFixed(1)}) e19 pred ${tl.join(' ')} [${why.join(' ')}] next cell held by: ${blk.map((t) => { const e = D.get(t); return `${t} ${e.brain?.state}@${e.x.toFixed(1)},${e.z.toFixed(1)} h${Math.round(deg(e.heading))} path${e.path ? 1 : 0} route${e.route?.length ?? 0}`; }).join(' ')}`);
}

export const CREST_PATH = [[29.8, 29.7], [40, 22.4], [52.5, 23.6], [59.35, 34.3]]; // W end → middle → E end → E stair foot

export const STAGES = [
  ['A', 'Plateau: trap the sergeant, decoy + harpoon the troopers', async (D) => {
    const e1 = D.get('e1'), e2 = D.get('e2'), e3 = D.get('e3'), gb = D.c('greenberet'), dv = D.c('diver');
    for (const r of ['sapper', 'greenberet', 'diver', 'spy']) await D.stance(r, 'crawl'); // down at once: p1 sees the start at 36 m
    D.order('greenberet', { type: 'move', x: 108, z: 2.5 });
    D.order('diver', { type: 'move', x: 110, z: 2.5 });
    D.order('spy', { type: 'move', x: 113, z: 2.4 }); // (at 112, 3.5 p1's near band grazes her as it comes back)
    await D.until(() => e1.x > 124, 120, 'p1 walks off east');
    // Sapper sets the bear trap on the patrol path west of the wall; the GB drops the decoy (off) beside the path
    await D.stance('sapper', 'crawl');
    D.order('sapper', { type: 'move', x: 97, z: 12.2 });
    await D.go('greenberet', 102, 15.1, { tol: 0.3 });
    await D.face('greenberet', 102, 17);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => Math.hypot(D.c('sapper').x - 97, D.c('sapper').z - 12.2) < 0.3, 60, 'Sapper at the trap spot');
    D.ability('sapper', 'trap', { x: 97, z: 13 });
    await D.wait(1.5);
    D.order('greenberet', { type: 'move', x: 107, z: 3 });
    await D.go('sapper', 109, 4.2);
    D.checkpoint('A1 trap and decoy set');
    await D.until(() => !e1.alive, 150, 'e1 steps in the trap');
    D.checkpoint('A2 sergeant e1 trapped');
    await D.until(() => e2.brain.state === 'IDLE' && e3.brain.state === 'IDLE' && e2.x < 70, 120, 'p1 calm again');
    await D.until(() => e2.x > 89, 200, 'p1 back near the decoy');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => e2.brain.state === 'DECOY' && !e2.isMoving && !e3.isMoving, 30, 'p1 staring at the decoy');
    D.checkpoint('A3 e2/e3 frozen by the decoy');
    await D.go('diver', 99.3, 6.4, { tol: 0.3 });
    D.ability('diver', 'harpoon', e3);
    await D.until(() => !e3.alive, 10, 'e3 harpooned');
    await D.until(() => D.world.time >= (dv._harpoonT ?? 0) + 0.05, 5, 'reload');
    D.ability('diver', 'harpoon', e2);
    await D.until(() => !e2.alive, 10, 'e2 harpooned');
    D.ability('greenberet', 'decoyToggle');
    D.checkpoint('A4 patrol p1 gone');
    D.order('diver', { type: 'move', x: 104, z: 2.5 }); // out of the gap at the wall's end
    await D.wait(2);
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', gb.decoy);
    await D.until(() => gb.has('decoy'), 30, 'decoy picked up');
  }],
  ['B', 'Gully: knife e5 and e4, hide the bodies', async (D) => {
    const e4 = D.get('e4'), e5 = D.get('e5'), gb = D.c('greenberet');
    await D.go('greenberet', 89, 16);
    await D.go('greenberet', 83, 19, { stance: 'crawl', tol: 0.4 });
    await D.path('greenberet', [[82.5, 30], [80, 34]], { tol: 0.4 });
    D.ability('greenberet', 'knife', e5);
    await D.until(() => !e5.alive, 15, 'e5 knifed');
    D.checkpoint('B1 e5 knifed');
    await D.stance('greenberet', 'crawl');
    await D.go('greenberet', 80.5, 24.5, { tol: 0.4 });
    D.ability('greenberet', 'knife', e4);
    await D.until(() => !e4.alive, 15, 'e4 knifed');
    D.checkpoint('B2 e4 knifed');
    for (const [e, x, z] of [[e5, 84, 16], [e4, 82, 15]]) { // up on the plateau, out of e6's sight
      await D.idle('greenberet');
      await D.stance('greenberet', 'stand');
      D.ability('greenberet', 'hand', e);
      await D.until(() => gb.carrying === e || e.carriedBy === gb, 30, `lift ${e.tag}`);
      await D.go('greenberet', x, z, { tol: 0.5 });
      D.ability('greenberet', 'drop');
      await D.until(() => !gb.carrying, 5, 'drop');
      await D.wait(0.5);
    }
    D.checkpoint('B3 bodies hidden on the plateau');
  }],
  ['C', 'Spy: round the camp to the uniform', async (D) => {
    const spy = D.c('spy'), gb = D.c('greenberet'), e8 = D.get('e8');
    // e8 walks the strip between the camp's N palisade and the cliff end to end, looking along it: nobody gets past
    // him. The GB goes first: down the gully (crawling: no prints) and into the snow W of e9, then, while e8 walks off
    // E, along the palisade to the W end of his beat, where he digs in again; e8 comes back, halts looking N, and the
    // GB knifes him from behind and carries him into the niche between the two rocks under the cliff, where nobody
    // looks (not through the N gate either), then crawls back W and digs in where he will drop the decoy later
    for (const [x, z] of [[86, 16], [83, 22], [82.5, 30], [83, 44], [100, 44], E8_WAIT]) await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 10, forbid: [CAMP], label: 'GB down the gully' });
    await digIn(D);
    await D.until(() => e8.brain.state === 'IDLE' && Math.cos(e8.heading) > 0.7 && e8.x > 127 && e8.x < 130, 300, 'e8 setting off E');
    await gbRise(D);
    await D.path('greenberet', E8_LANE, { tol: 0.5 });
    await digIn(D);
    await D.until(() => !e8.isMoving && e8.x < 127.5 && Math.abs(deg(e8.heading) - 270) < 20, 120, 'e8 halted at the W end, looking N');
    await gbRise(D);
    D.ability('greenberet', 'knife', e8);
    await D.until(() => !e8.alive, 15, 'e8 knifed');
    D.checkpoint('C0 e8 knifed at the W end of his beat');
    await D.idle('greenberet');
    await D.stance('greenberet', 'stand');
    D.ability('greenberet', 'hand', e8);
    await D.until(() => gb.carrying === e8 || e8.carriedBy === gb, 30, 'lift e8');
    for (const [x, z] of E8_NICHE) await D.sneak(x, z, { mode: 'walk', role: 'greenberet', box: 6, keep: 1.5, horizon: 60, speed: 1.3, forbid: [CAMP], label: 'GB carries e8 into the niche' });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 5, 'drop');
    await D.wait(0.5);
    await D.stance('greenberet', 'crawl');
    // back W the way he came, behind e9 (he looks N at the cliff) and past the N gate when nobody inside looks out
    const back = [[128, 44.5], ...E8_LANE.slice(0, 3).reverse(), E8_WAIT];
    const why = [];
    await D.until(() => { why.length = 0; return D.routeClear('greenberet', back, { speed: 0.75, low: true, why }); }, 600, 'the lane W behind e9 unwatched')
      .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    await D.path('greenberet', back, { tol: 0.5 });
    await D.sneak(...E12_DECOY_WAY[1], { mode: 'crawl', role: 'greenberet', box: 8, keep: 1.5, horizon: 240, hold: 6, forbid: [CAMP], label: 'GB back W' });
    await digIn(D);
    D.checkpoint('C1 e8 hidden; the GB in the snow W of e9');
    // the Spy down the gully to its mouth (crawling: no prints), then E along the camp's N palisade (behind e9), S down
    // its E side and back NW along the strip outside it, where the palisade hides her from e13 — every leg timed
    // between sweeps (driver sneak: she waits only where no cone reaches)
    for (const [x, z] of SPY_GULLY) await D.sneak(x, z, { mode: 'crawl', role: 'spy', box: 10, label: 'Spy down the gully' });
    const spyOpts = { mode: 'crawl', role: 'spy', box: 8, keep: 1, horizon: 240, maxWait: 900, hold: 6, walkerSlack: [0, -3, 3], shelterBox: 14, shelterHorizon: 45, shelterHold: 12, forbid: [CAMP], label: 'Spy round the camp' };
    for (const [x, z] of SPY_ROUND.slice(0, 2)) await D.sneak(x, z, spyOpts);
    // past the N gate behind e9 (he looks N at the cliff) when nobody inside looks out through it: the lane the GB took
    const lane = [[117.5, 47.5], [124.5, 47.5], SPY_ROUND[2]];
    const whyLane = [];
    await D.until(() => { whyLane.length = 0; return D.routeClear('spy', lane, { speed: 0.75, low: true, why: whyLane }); }, 600, 'the gate lane unwatched')
      .catch((e) => { throw new Error(`${e.message} [${whyLane.join(' ')}]`); });
    await D.path('spy', lane, { tol: 0.5 });
    for (const [x, z] of SPY_ROUND.slice(3)) await D.sneak(x, z, spyOpts);
    D.checkpoint('C2 Spy at the clothesline');
    await D.until(() => D.clearAhead(spy.x, spy.z, 3, false), 120, 'nobody looking at the clothesline');
    D.ability('spy', 'use', D.item('uniform_line'));
    await D.until(() => spy.disguised, 20, 'uniform on');
    D.checkpoint('C3 Spy in uniform');
  }],
  ['D', 'Marine: harpoon e14 from the river', async (D) => {
    const dv = D.c('diver'), e14 = D.get('e14');
    // down the gully and along the shore to the shallows below the E stair (nobody sees a man lying there), gear on,
    // then under water down the river to e14's blind side, 6.5 m off him (he watches the strip, his back to the water)
    for (const [x, z] of MARINE_TO_SHALLOWS) await D.sneak(x, z, { mode: 'crawl', role: 'diver', box: 10, label: 'Marine to the shallows' });
    await D.go('diver', 55.6, 35.2, { tol: 0.4 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater, 5, 'Marine under water');
    D.order('diver', { type: 'move', x: 99.2, z: 77.4 });
    await D.until(() => !dv.path && !dv.isMoving, 120, 'Marine below e14');
    D.ability('diver', 'harpoon', e14); // he surfaces for the shot: nobody looks at that water
    await D.until(() => !e14.alive, 10, 'e14 harpooned');
    D.checkpoint('D1 e14 harpooned from the water');
    D.order('diver', { type: 'move', x: 60, z: 47 }); // back up under water, by the raft
    await D.until(() => !dv.path && !dv.isMoving, 120, 'Marine by the raft');
  }],
  ['E', 'Spy over the dam crest: fence power off, chat up e17', async (D) => {
    const spy = D.c('spy'), e17 = D.get('e17');
    // from the clothesline back up the strip past the posts (in uniform nobody looks twice), to the E stair and up
    await D.stance('spy', 'stand');
    await D.path('spy', [[104, 77], [90, 65], [84, 47], [66, 42], [59.35, 34.3], [52.5, 23.6]], { tol: 0.6 });
    D.checkpoint('E1 Spy on the dam crest');
    await D.path('spy', [[40, 22.4], [29.8, 29.7], [22.85, 40.3], [26, 56.5]], { tol: 0.5 });
    D.ability('spy', 'use', D.item('fence_switch'));
    await D.until(() => D.world.fencePower?.get?.('st_fence') === false, 40, 'fence power off');
    D.checkpoint('E2 fence switched off');
    // e19's beat and p5's round take the same ~70 s: where they stand to each other decides when the raft may land on
    // the S bank (from the N end of his beat e19 looks along it, at the far edge of his cone). She holds e19 at the N
    // end of his beat until p5 leaves its E halt: from then on he walks off S as p5 walks off W (as in H)
    const e19 = D.get('e19');
    await D.go('spy', ...E19_TALK, { tol: 0.3 });
    await D.until(() => Math.hypot(e19.x - 24, e19.z - 64) < 0.6 && !e19.isMoving, 120, 'e19 at the N end of his beat');
    D.ability('spy', 'distract', e19);
    await D.until(() => e19.brain.state === 'DISTRACTED', 10, 'e19 distracted');
    await D.until(() => p5Departed(D), 120, 'p5 off W from its halt');
    D.order('spy', { type: 'stop' });
    await D.go('spy', 48.5, 74.0, { tol: 0.4 }); // e17's W side: he turns his back on the river and the shed
    D.ability('spy', 'distract', e17);
    await D.until(() => e17.brain.state === 'DISTRACTED', 10, 'e17 distracted');
    D.checkpoint('E3 Spy holds e17');
  }],
  ['F', 'GB: decoy N of the camp turns e12; e6 knifed and hidden by e14', async (D) => {
    const gb = D.c('greenberet'), e6 = D.get('e6'), e7 = D.get('e7'), e12 = D.get('e12');
    // up from the snow by the camp's N palisade to drop the decoy 12 m N of e12
    await gbRise(D); // (in the snow at the decoy spot since C)
    await D.face('greenberet', E12_DECOY[0], E12_DECOY[1] - 2);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    for (const [x, z] of [...E12_DECOY_WAY].reverse().concat([[83, 44], [82.5, 38]])) await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 10, forbid: [CAMP], label: 'GB back to the gully' });
    // on as soon as e7's round has taken him off along the N palisade (he would come out to it: it must be off again
    // before he is back by the W gate, ~100 s): e12 turns N to it, his back to the W gate and e6's post
    await D.until(() => !e7.alive || (e7.x > 118 && e7.z < 55 && Math.cos(e7.heading) > 0.7), 240, 'e7 off east along his round');
    D.ability('greenberet', 'decoyToggle');
    await D.until(() => Math.abs(deg(e12.heading) - 270) < 15, 10, 'e12 faces the decoy');
    D.checkpoint('F1 decoy on: e12 faces it');
    // e6's back (he watches the river); the stab when nobody can see it, then he is carried down the strip to e14
    await D.sneak(...E6_BACK, { mode: 'crawl', role: 'greenberet', box: 10, keep: 0.5, label: 'GB behind e6' });
    const why = [];
    await D.until(() => { why.length = 0; return D.clearAhead(e6.x, e6.z, 6, false, why, [e6]) && D.clearAhead(gb.x, gb.z, 6, false, why, [e6]) && campAwayFromGate(D, 8); }, 600, 'nobody watching e6')
      .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    D.ability('greenberet', 'knife', e6);
    await D.until(() => !e6.alive, 15, 'e6 knifed');
    D.checkpoint('F2 e6 knifed');
    await D.until(() => { try { D.ability('greenberet', 'hand', e6); return true; } catch { return false; } }, 3, 'GB reaches for e6');
    await D.until(() => gb.carrying === e6 || e6.carriedBy === gb, 30, 'lift e6');
    await D.path('greenberet', E6_CARRY, { tol: 0.6 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 5, 'drop e6');
    await D.stance('greenberet', 'crawl');
    D.checkpoint('F3 e6 hidden by e14');
    // back up the strip while e12 still faces N, then the decoy off (e12 back to his post) before e7 comes round, and
    // the GB fetches it
    for (const [x, z] of [[90, 63], [83, 44], [82.5, 38]]) await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 10, label: 'GB back up the strip' });
    if (e7.alive && e7.brain.state === 'DECOY') throw new Error('e7 came out to the decoy');
    D.ability('greenberet', 'decoyToggle');
    for (const [x, z] of [[83, 44], ...E12_DECOY_WAY]) await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 10, forbid: [CAMP], label: 'GB to the decoy' });
    D.ability('greenberet', 'hand', gb.decoy);
    await D.until(() => gb.has('decoy'), 20, 'decoy picked up');
    await D.stance('greenberet', 'crawl');
    for (const [x, z] of [...E12_DECOY_WAY].reverse().concat([[83, 44]])) await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 10, forbid: [CAMP], label: 'GB back with the decoy' });
    D.checkpoint('F4 GB has the decoy back');
  }],
  ['G', 'Raft: GB and Sapper to the S bank; fence cut, charges taken', async (D, { boardPoint }) => {
    const gb = D.c('greenberet'), sap = D.c('sapper'), dv = D.c('diver'), raft = D.raft(), e17 = D.get('e17'), e20 = D.get('e20');
    // the Sapper crawls down from the plateau to the raft; the GB is by the gully mouth; the Marine surfaces by it
    for (const [x, z] of [[86, 16], [83, 22], [82.5, 30], [75, 38], [67, 42.6]]) await D.sneak(x, z, { mode: 'crawl', role: 'sapper', box: 10, label: 'Sapper to the raft' });
    await D.sneak(66.4, 43.0, { mode: 'crawl', role: 'greenberet', box: 10, keep: 0.5, label: 'GB to the raft' });
    D.order('diver', { type: 'move', x: 63.4, z: 44.8 });
    await D.until(() => !dv.path && !dv.isMoving, 60, 'Marine below the raft');
    D.checkpoint('G1 GB, Sapper and Marine by the raft');
    // all aboard and off only when nobody will see the raft for the boarding and a way across is clear after it (p5's
    // halt at the E end of its round looks up the river at the raft from the edge of its reach)
    // (lying off the S bank while the two land and the Marine dives: 14 s; e19's beat ends 36 m off — a wider margin)
    const LANDING = globalThis.process?.env?.LANDING ? JSON.parse(globalThis.process.env.LANDING) : { hold: 6 }; // (LANDING env: scratch only)
    await raftWindow(D, raft, S_BANK, 14, 'crossing to the S bank', 600, null, LANDING);
    D.ability('diver', 'dive'); // gear off in the shallows by the raft (e17 faces the Spy, e6 is gone)
    await D.until(() => !dv.diving && !dv.currentAction, 6, 'Marine out of his gear');
    await boardRaft(D, 'diver', boardPoint, null, 0);
    await boardRaft(D, 'sapper', boardPoint, null, 0);
    await boardRaft(D, 'greenberet', boardPoint, null, 0);
    // across while the Spy holds e17 (he faces her, his back to the river; e6 is gone)
    await D.sneak(...S_BANK, { mode: 'raft', box: 12, ...LANDING, label: 'raft to the S bank' });
    await landProne(D, 'sapper', 54.8, 64.2);
    await landProne(D, 'greenberet', 54.2, 62.6);
    D.checkpoint('G2 GB and Sapper on the S bank');
    // the raft must not stay where it lies: e17 (once the Spy leaves him for e20), e19 and the camp's squads look over
    // it, and a man hiding beside it (under water) attends nothing in their eyes (§4.3: they shoot it). The Marine steps
    // into the shallows, packs it and dives there — nothing left lying about, nobody to see
    await clearWindow(D, [[raft.x, raft.z], shallowNear(D, raft.x, raft.z)], 6, 150, 'Marine packs the raft', null, 2);
    D.ability('diver', 'leaveVehicle');
    await D.until(() => !dv.vehicle && !dv.currentAction, 3, 'Marine off the raft');
    await packRaft(D, raft);
    D.ability('diver', 'dive');
    await D.until(() => dv.diving && !dv.currentAction, 6, 'Marine under water');
    // the GB digs into the snow where he landed (e17 looks there when the Spy is not holding him)
    await digIn(D);
    // the Sapper cuts in (power off) and crawls in by the fence
    await D.sneak(59.3, 78.0, { mode: 'crawl', role: 'sapper', box: 10, label: 'Sapper to the fence' });
    D.ability('sapper', 'cutters', { x: 57.6, z: 79.0 });
    await D.until(() => !sap.currentAction && !sap.pendingAbility, 10, 'fence cut');
    D.checkpoint('G3 fence cut');
    await D.sneak(...FENCE_IN, { mode: 'crawl', role: 'sapper', box: 10, keep: 1.5, edgePad: 1, crawlPad: 2, label: 'Sapper in by the fence' });
    // the shed's ramp lies where e20 looks all the time: the Spy leaves e17 (nobody of ours is in his sight now) and
    // holds e20 from his NW side — his back to the shed
    await spyHolds(D, e20, E20_TALK);
    D.checkpoint('G4 Spy holds e20');
    // the charges lie inside the shed, on its loft floor behind the threshing door at the top of the ramp (the barn's
    // bridge; user 2026-10-08: "Does it need to inside through the ramp?"): on his belly up the ramp to the door; when
    // nobody would see a man stand there, in through it, kneel, take both and back out (abilities/bunker-entry.js walk
    // in), down on his belly again and back down the ramp
    const SHED = D.world.structures.get('st_shed').def.entry, TOP = SHED.path[0];
    await D.sneak(...SHED_RAMP_FOOT, { mode: 'crawl', role: 'sapper', box: 12, keep: 1, edgePad: 0.5, crawlPad: 1, maxWait: 600, label: 'Sapper to the shed ramp' });
    await D.sneak(...TOP, { mode: 'crawl', role: 'sapper', box: 6, keep: 1, edgePad: 0.5, crawlPad: 1, maxWait: 600, label: 'Sapper up the shed ramp' });
    // (on his feet there twice: getting up and through the doorway, ~1 s, and 4 s later back out until he is down on
    // his belly again, ~1 s; in between the barn's walls hide him. e21, across the yard, sweeps over the door)
    const whyTop = [], atTop = (t0, t1) => D.clearAhead(TOP[0], TOP[1], t1, false, whyTop, null, 1, t0);
    // (and e23, pacing the W gate's road 30 m off, set off W: facing E, at the E end of his beat above all, he looks
    // straight up at the door — and turning there his glance is no sure prediction)
    const e23 = D.get('e23'), e23W = () => !e23?.alive || (Math.cos(e23.heading) < -0.5 && e23.x > 12.5 && e23.isMoving);
    await D.until(() => { whyTop.length = 0; return e23W() && atTop(0, 1.1) && atTop(4.7, 6.1); }, 300, 'nobody to see him at the threshing door')
      .catch((e) => { throw new Error(`${e.message} [${whyTop.join(' ')}]`); });
    D.ability('sapper', 'hand', D.world.interactables.find((i) => i.spawn?.id === 'bombs_shed' || i.tag === 'bombs_shed'));
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) >= 2 && !sap.currentAction && !sap.pendingAbility && !sap.scripted, 30, 'charges taken');
    await D.stance('sapper', 'crawl');
    D.checkpoint('G5 Sapper has both charges');
    await D.sneak(...SHED_RAMP_FOOT, { mode: 'crawl', role: 'sapper', box: 6, keep: 1, edgePad: 0.5, crawlPad: 1, maxWait: 600, label: 'Sapper down the shed ramp' });
    await D.sneak(...FENCE_IN, { mode: 'crawl', role: 'sapper', box: 12, keep: 1, edgePad: 0.5, crawlPad: 1, maxWait: 600, label: 'Sapper back to the fence' });
    // the Spy back to e17 (his W side), then the Sapper out through the hole and down to the strip
    await spyHolds(D, e17, E17_TALK);
    // out through the man-sized hole upright (user 2026-10-08: the cut is walked through standing), the moment no cone
    // would take in a standing man on his way through it; down on his belly again outside. If the hole stays watched,
    // he crawls out as before.
    const HOLE_OUT = [[57.6, 79.0], [59.3, 77.6, 0.4]];
    // (standing up where he lies, ~1.5 s, then through: every moment of it unseen)
    const upright = await D.until(() => D.clearAhead(sap.x, sap.z, 0.9, false)
      && D.routeClear('sapper', HOLE_OUT, { speed: 1.9, low: false, delay: 0.7, step: 0.2 }), 90, 'the hole unwatched').then(() => true, () => false);
    if (upright) {
      await D.stance('sapper', 'stand');
      D.checkpoint('G5b Sapper walks out through the hole upright');
      await D.path('sapper', HOLE_OUT.map(([x, z]) => [x, z]), { tol: 0.4 });
      await D.stance('sapper', 'crawl');
    }
    for (const [x, z] of [[59.3, 77.6], [54.6, 64.5]]) await D.sneak(x, z, { mode: 'crawl', role: 'sapper', box: 10, keep: 1.5, edgePad: 1, crawlPad: 2, label: 'Sapper back out' });
    D.checkpoint('G6 Sapper back on the strip');
  }],
  ['H', 'Sapper on the crest, decoy behind the bunker, everyone else to the truck road', async (D, { boardPoint }) => {
    const gb = D.c('greenberet'), sap = D.c('sapper'), dv = D.c('diver');
    const e17 = D.get('e17'), e18 = D.get('e18'), e19 = D.get('e19'), e34 = D.get('e34');
    // the Marine (gear off, aboard) takes the Sapper back across (the Spy still holds e17) and drops him at the foot of
    // the E stair: up it, along the dam crest, he waits up there (7 m up, nobody below can see him: §4.2 roof rule). The
    // Marine lies down beside the raft (a raft left alone is shot at, §4.3)
    // (under water: in the shallows where he packed the raft)
    await raftWindow(D, spot(dv), E_STAIR_RAFT, 12, 'over to the E stair');
    D.ability('diver', 'dive'); // gear off
    await D.until(() => !dv.diving && !dv.currentAction, 6, 'Marine out of his gear');
    await deployRaft(D);
    let raft = D.raft();
    await boardRaft(D, 'sapper', boardPoint, null, 0);
    await D.sneak(...E_STAIR_RAFT, { mode: 'raft', box: 12, label: 'raft to the E stair' });
    // both off; the Marine packs the raft at once (left lying at the stair foot, the camp's squads see it from their
    // round) and crawls up beside the stair
    await clearWindow(D, [[raft.x, raft.z], [58, 34], [59.35, 30], [58.2, 37]], 9, 300, 'landing by the E stair');
    for (const r of ['sapper', 'diver']) { D.ability(r, 'leaveVehicle'); await D.wait(0.3); }
    D.order('sapper', { type: 'move', x: CREST_PATH[3][0], z: CREST_PATH[3][1] });
    await packRaft(D, raft);
    await D.go('diver', ...MARINE_WAIT, { tol: 0.4 }); // (out of the water: two steps)
    await D.stance('diver', 'crawl'); // down at once (p5's reach ends at the stair foot)
    await D.path('sapper', [CREST_PATH[3], CREST_PATH[2], CREST_PATH[1], CREST_PATH[0]], { tol: 0.6 });
    D.checkpoint('H1 Sapper on the dam crest');
    // the GB crawls up the strip out of e17's near band and digs in; the Spy leaves e17 for e18, whom she talks to from
    // his S side (he looks into the yard, his back to the N gap and the fence strip)
    await gbRise(D); // (in the snow since G)
    await D.sneak(...GB_WAIT, { mode: 'crawl', role: 'greenberet', box: 10, keep: 1, label: 'GB up the strip' });
    await digIn(D);
    // e19's beat (N end by the N gate) and p5's round look over the strip by the N gate one after the other, ~65 s
    // each: the Spy first holds e19 at the N end of his beat until p5 leaves its E halt — from then on e19 walks off S
    // while p5 walks back W, and both come back over the strip together, leaving the rest of the round to the GB
    D.order('spy', { type: 'stop' });
    await D.go('spy', ...E19_TALK, { tol: 0.3 });
    await D.until(() => Math.hypot(e19.x - 24, e19.z - 64) < 0.6 && !e19.isMoving, 120, 'e19 at the N end of his beat');
    D.ability('spy', 'distract', e19);
    await D.until(() => e19.brain.state === 'DISTRACTED', 10, 'e19 distracted');
    await D.until(() => p5Departed(D), 120, 'p5 off W from its halt');
    await spyHolds(D, e18, [26.2, 62.5]);
    D.checkpoint('H2 Spy holds e18 at the N gate');
    // along the fence to 13 m S of the bunker, the decoy down (off), and back (the spot is by p5's W leg: he waits in
    // the snow E of p5's halt and follows p5 W along the fence the moment it has left the halt, its backs to him)
    await gbSneak(D, ...N_DECOY_WAIT, { box: 12 });
    if (!gb.buried) await digIn(D);
    // (e19, in step with p5 since H2, stands at the N end of his beat looking E as p5 leaves its halt: he goes once
    // e19 walks off S)
    await D.until(() => p5Departed(D), 300, 'p5 off W from its halt');
    await D.until(() => Math.sin(e19.heading) > 0.5 && e19.z > 66, 30, 'e19 off S');
    // behind p5 along the fence to the snow S of the spot (dug in whenever a cone would come over him) and under it
    await crawlCautiously(D, [...FENCE_W, N_DECOY_FENCE], { finalPause: 3 });
    if (!gb.buried) await digIn(D);
    // out the moment p5 has walked past him off W (its backs to him till it turns at the W end of its round): 1.2 m
    // out, the decoy down facing NW, back and under the snow again
    await D.until(() => P5.every((t) => { const e = D.get(t); return !e.alive || (e.x < 12.5 && Math.cos(e.heading) < -0.3); }), 300, 'p5 past the decoy spot, off W');
    await gbRise(D);
    await D.go('greenberet', ...N_DECOY, { tol: 0.25 });
    await D.face('greenberet', N_DECOY[0] - 1, N_DECOY[1] - 1);
    D.ability('greenberet', 'decoyDrop');
    await D.until(() => !gb.has('decoy'), 5, 'decoy down');
    await D.go('greenberet', ...N_DECOY_FENCE, { tol: 0.3 });
    await digIn(D);
    // back along the fence (dug in whenever a cone would come over him) and on to the strip
    await crawlCautiously(D, [...FENCE_W].reverse().concat([N_DECOY_WAIT]), { finalPause: 1 });
    await gbSneak(D, ...GB_WAIT, { box: 12 }); // (back E before the Spy leaves e18: he looks over this stretch)
    if (!gb.buried) await digIn(D);
    D.checkpoint('H3 decoy S of the bunker; the GB back on the strip');
    // the Spy back to e17 (his W side: his back to the river); the raft comes for the GB and takes him to the E stair
    await D.go('spy', 48.5, 74.0, { tol: 0.4 });
    D.ability('spy', 'distract', e17);
    await D.until(() => e17.brain.state === 'DISTRACTED', 10, 'e17 distracted');
    await D.until(() => p5West(D, 25), 300, 'p5 off on the W of its round');
    // the GB crawls SE along the S bank behind e17 (held) to the water's edge across from a lie no cone reaches (the
    // raft cannot lie off the landing or the E stair long: p5's halt and the camp look there)
    await gbSneak(D, ...GB_PICKUP);
    await gbRise(D);
    // (tight margins: the pickup lies a metre or two beyond e12's and p5's reach)
    const TIGHT = { walkerPad: 0.5, edgePad: 0.5 };
    await raftWindow(D, { x: E_STAIR_RAFT[0], z: E_STAIR_RAFT[1] }, RAFT_HIDE, 9, 'over for the GB', 600, null, { ...TIGHT, alsoClear: [[dv.x, dv.z]] });
    await D.stance('diver', 'stand');
    await D.go('diver', ...shallowNear(D, ...E_STAIR_RAFT, 1.5), { tol: 0.15 }); // (into the shallows below the stair)
    await deployRaft(D);
    raft = D.raft();
    await D.sneak(...RAFT_HIDE, { mode: 'raft', box: 12, hold: 10, ...TIGHT, label: 'raft over for the GB' });
    await boardRaft(D, 'greenberet', boardPoint, null, 0);
    await D.sneak(...E_STAIR_RAFT, { mode: 'raft', box: 12, ...TIGHT, edgePad: 1.2, label: 'raft to the E stair' }); // (on the move: a wider margin)
    await clearWindow(D, [[raft.x, raft.z], [58, 34], [59.35, 30], [58.2, 37]], 6, 300, 'landing by the E stair');
    for (const r of ['greenberet', 'diver']) { D.ability(r, 'leaveVehicle'); await D.wait(0.3); }
    D.ability('diver', 'hand', raft); // packed: nothing left lying about
    await D.until(() => !D.raft(), 20, 'raft packed');
    D.order('diver', { type: 'move', x: TRUCK_WAIT.diver[0], z: TRUCK_WAIT.diver[1] });
    await D.path('greenberet', [[59.2, 22], TRUCK_WAIT.greenberet], { tol: 0.6 });
    for (const r of ['greenberet', 'diver']) { await D.until(() => !D.c(r).path && !D.c(r).isMoving, 60, `${r} at the truck road`); await D.stance(r, 'crawl'); }
    D.checkpoint('H4 GB and Marine at the truck road');
    // the Spy leaves e17 and walks round by the N gap and over the crest to the truck road (in uniform nobody looks twice)
    D.order('spy', { type: 'stop' });
    await D.path('spy', [[34, 64], [26.2, 57.5], [25.2, 50], [23.4, 41.0], [25.9, 35.6], ...CREST_PATH, [59.2, 22], TRUCK_WAIT.spy], { tol: 0.6 });
    D.checkpoint('H5 Spy at the truck road');
  }],
  ['I', 'Bunker and dam: charge one inside the bunker, charge two at the spillway gates', async (D) => {
    const sap = D.c('sapper'), e34 = D.get('e34');
    // the Sapper to the top of the W stair; the decoy on (by radio, from the truck road) once e19 is off down his beat,
    // p5 is within its call (not on its E halt, from where it looks up the stair) and the camp's walkers e7 / e10 will
    // be off at the far E end of their rounds when the bunker goes (the blast sends them running over to the ruin by the
    // E stair, which he must be off by then): the gunner, e18 and p5 turn to it, S of the bunker
    // charge one goes INSIDE the bunker (abilities/bunker-entry.js): from the outer end of its entrance path (the gap in
    // the wire on its NE front, 9 m W of the W stair's foot) he walks in through the trench, sets it on the floor and
    // walks back out; past the gap he is behind concrete (only the gunner, staring at the decoy, could see him in there)
    const entry = D.world.interactables.find((i) => i.tag === 'dam_bunker').params.structure.entry;
    const P0 = entry.path[0], PLANT2 = [41.0, 22.4];
    await D.go('sapper', 27.4, 32.4, { tol: 0.5 });
    await D.stance('sapper', 'crawl');
    const dec = D.c('greenberet').decoy, decHear = (e) => !e?.alive || Math.hypot(e.x - dec.x, e.z - dec.z) < 12;
    await D.until(() => P5.every((t) => { const e = D.get(t); return !e?.alive || (e.brain.state !== 'DECOY' && decHear(e) && e.x < 24); })
      && staysAway(D, 'e19', [dec.x, dec.z], 14, 45) && staysAway(D, 'e7', E_STAIR_FOOT, 64, 42, 20) && staysAway(D, 'e10', E_STAIR_FOOT, 60, 42, 20),
    1200, 'e19 down his beat, p5 by the decoy, e7 / e10 off E');
    D.ability('greenberet', 'decoyToggle'); // on
    const toDecoy = (e) => { const a = Math.atan2(dec.z - e.z, dec.x - e.x) - e.heading; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); };
    await D.until(() => toDecoy(e34) < 0.4, 10, 'gunner turns to the decoy');
    await D.wait(1);
    D.checkpoint('I1 decoy on: the gunner turns to it');
    // down the W stair to the gap in the bunker's wire (crawling, on the planner's cone gaps), charge one inside; back up
    // the stair: from 2.5 m up nobody below sees him: on his feet, he runs to the spillway gates (charge two) and off
    // the crest down the E stair to the truck road; the dam goes ten seconds after the bunker and the truck comes for them
    // He crawls down the stair (too narrow for the sneak planner's 1 m cells: a straight crawl, timed whole), stands
    // up at the gap and walks in (about a second in the open), is in there ~IN s, then comes back out on his feet and
    // walks straight up the stair (the fuse burns: no time to lie down). He sets off only when nobody will see any of it.
    // (the entrance is 9 m W of the stair's foot: back to it he walks out of the gunner's earshot, 8.5 m, and runs)
    // (the entrance is 9 m W of the stair's foot. Back to it he runs — the men at the decoy are deaf to steps — and his
    // boot prints on the snow end at the foot: up its first 5 m he crawls (no prints, nobody near enough to see a man
    // lying there), so whoever follows them on the siren loses the trail there; from 2.5 m up nobody below sees him)
    const DOWN = [[25.1, 36.4], [22.85, 40.3], P0], UP = [[22.85, 40.3], [25.3, 36.0]], IN = 6.5, CRAWL = 0.75;
    let len = 0;
    for (let k = 0, q = [sap.x, sap.z]; k < DOWN.length; q = DOWN[k++]) len += Math.hypot(DOWN[k][0] - q[0], DOWN[k][1] - q[1]);
    const tDown = len / CRAWL, why = [];
    const inOut = (delay) => D.routeClear('sapper', [[...P0, 1.5]], { from: P0, speed: 2.0, low: false, delay, why })
      && D.routeClear('sapper', [[...P0, 1.0], UP[0]], { from: P0, speed: 3.5, low: false, delay: delay + IN, why })
      && D.routeClear('sapper', [UP[1]], { from: UP[0], speed: CRAWL, low: true, delay: delay + IN + 4, why });
    await D.until(() => { why.length = 0; return D.routeClear('sapper', DOWN, { speed: CRAWL, low: true, why }) && inOut(tDown + 0.5); },
      600, 'nobody to see him crawl down, go in and come back out').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    await D.path('sapper', DOWN, { tol: 0.4 });
    await D.until(() => { why.length = 0; return D.clearAhead(sap.x, sap.z, 1, true, why) && inOut(0); }, 60, 'the gap and the stair unwatched')
      .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    const tIn = D.t;
    D.ability('sapper', 'timeBomb');
    await D.until(() => sap.insideStructure, 6, 'Sapper inside the bunker');
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) === 1, 10, 'charge one planted');
    await D.until(() => !sap.insideStructure && !sap.currentAction && !sap.pendingAbility && !sap.scripted, 10, 'Sapper back out');
    D.log(`  (bunker: in and out in ${(D.t - tIn).toFixed(1)} s)`);
    D.checkpoint('I2 charge one set inside the bunker behind the gunner');
    await D.stance('sapper', 'stand');
    await D.go('sapper', ...UP[0], { tol: 0.5, run: true });
    await D.stance('sapper', 'crawl');
    await D.go('sapper', ...UP[1], { tol: 0.4 });
    await D.stance('sapper', 'stand');
    await D.path('sapper', [[27.4, 32.4], CREST_PATH[0], CREST_PATH[1], PLANT2], { tol: 0.4, run: true });
    // (the bunker 9 m W of the stair's foot makes his round trip longer: p5, running back E on the siren, reaches its E
    // halt (30, 54) and looks up at the E stair for 4 s while he would run down it — he waits up here, out of sight,
    // until it walks off W again and the way off the crest is unwatched; the camp's walkers are on their way over: not long)
    const p5Off = () => { const e = D.get('e29'); return !e?.alive || e.x < 20 || (e.x < 28.5 && Math.cos(e.heading) < -0.3 && !e.brain?.wait); };
    await D.until(() => p5Off() && D.routeClear('sapper', [[...PLANT2, 1.2], CREST_PATH[2], CREST_PATH[3], [59.2, 22], TRUCK_WAIT.sapper], { speed: 4.5, low: false }), 14, 'p5 off W, the way off the crest unwatched')
      .catch(() => {});
    D.ability('sapper', 'timeBomb');
    await D.until(() => (sap.inventory.get('timeBomb') ?? 0) === 0, 5, 'charge two planted');
    D.checkpoint('I3 charge two planted at the spillway gates');
    D.ability('greenberet', 'decoyToggle'); // off, by radio
    // along the crest to its E end (7 m up: nobody below sees him), then down the E stair and N to the truck road the
    // moment nobody will see a man running there (p5 runs E on the siren: its reach ends at the stair) — before the dam
    // blows under the crest
    const tI3 = D.t, OFF = [CREST_PATH[3], [59.2, 22], TRUCK_WAIT.sapper];
    await D.path('sapper', [CREST_PATH[2]], { run: true });
    await D.until(() => D.routeClear('sapper', OFF, { speed: 4.5, low: false }) || D.t > tI3 + 8, 10, 'the E stair unwatched');
    await D.path('sapper', OFF, { run: true });
    await D.stance('sapper', 'crawl');
    await D.until(() => objective(D, 'o1') && objective(D, 'o2'), 30, 'o1 and o2');
    D.checkpoint('I4 bunker and dam destroyed (o1, o2)');
  }],
  ['J', 'The truck north of the dam', async (D) => {
    const truck = () => D.world.vehicles.find((v) => v.tag === 'evac_truck' || v.spawn?.id === 'evac_truck' || v.id === 'evac_truck');
    await D.until(() => truck() && Math.hypot(truck().x - 60, truck().z - 10) < 1.5 && (truck().speed || 0) < 0.2, 60, 'truck waiting');
    D.checkpoint('J1 truck at the pickup');
    for (const r of ['spy', 'greenberet', 'diver', 'sapper']) D.ability(r, 'enterVehicle', truck());
    await D.until(() => objective(D, 'o3'), 60, 'o3');
    D.checkpoint('J2 everyone aboard: mission complete');
  }],
];

/**
 * Play the whole mission. `ctx.boardPoint` = src/abilities/drive.js boardPoint (passed in so the module loads both in
 * node and in the page). `ctx.only` / `ctx.until`: run a slice of the stages (debugging).
 */
export async function solve(D, ctx) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
