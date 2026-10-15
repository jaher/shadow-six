/**
 * M1 "Baptism of Fire" (Sola relay station): a full stealth solution, played only with player orders.
 *   A  the Green Beret knifes the road sentry e6 and crawls past the house to the fjord;
 *   B  the Marine swims under water to e2's beat and harpoons him at its far end, where nobody sees the body;
 *   C  right after a sweep of the MG across the water (e13) he packs the raft where it lies, swims it on the surface
 *      behind the islets to the GB and inflates it below him;
 *   D  the raft waits beyond e4's reach and, in a gap, dashes up the fjord's far west edge (past the end of the MG's
 *      traverse) to the north beach, swinging in side-on so the GB rolls straight out onto the snow (not one step:
 *      no boot print for the beach guards to follow); the Marine packs the raft and dives with it; the GB digs
 *      himself in where he lies and, when e4 and the p3 patrol are away, crawls into the camp;
 *   E  he shoulders fuel drum b4; F  carries it to the station's north wall, waits, and sets it off with his pistol
 *      from 10 m when e4 and the patrol are far away. Two kills (knife, harpoon), no alarm, nobody ever sees a man,
 *      and until the blast no guard follows a print or looks into a noise (tests/m01-solution.test.mjs).
 * Driver API: tools/solutions/driver.mjs. Reference run, in the real game: node tools/solutions/run-browser.mjs m01
 * (also tests/m01-solution.test.mjs). Walkthrough (debug video mode): m01.walkthrough.mjs.
 */

/** will nobody see a man at (x, z) from `from` s from now for `len` s? (clearAhead's `dur` is the window's END) */
const clearFor = (D, x, z, from, len, low, why = null, pad = 0) => D.clearAhead(x, z, from + len, low, why, null, pad, from);

/** wait (up to maxSec) until nobody will see a standing man at any of `pts` for the next `dur` s */
async function clearWindow(D, pts, dur = 4, maxSec = 150, label = 'clear window', pad = 2) {
  await D.until(() => pts.every(([x, z]) => D.clearAhead(x, z, dur, false, null, null, pad)), maxSec, label);
}

/** board the raft from the bank / the shallows when no cone will cover him getting up and climbing in */
async function boardRaft(D, role, boardPoint, margin = 0.8) {
  const u = D.c(role), raft = D.raft();
  let bp = boardPoint(raft, u);
  const d0 = Math.hypot(bp.x - u.x, bp.z - u.z);
  if (d0 > 0.8 && !D.world.groundAt(bp.x, bp.z).shallow) { // creep up to the hull first (prone, unseen)
    await D.go(role, bp.x + ((u.x - bp.x) / d0) * 0.4, bp.z + ((u.z - bp.z) / d0) * 0.4, { tol: 0.3 });
    bp = boardPoint(raft, u);
  }
  const dur = (u.stance === 'crawl' ? 0.6 : 0) + Math.hypot(bp.x - u.x, bp.z - u.z) / 1.5 + 0.55 + margin; // get up, walk to the hull, climb in (+ margin)
  await clearWindow(D, [[u.x, u.z], [bp.x, bp.z]], dur, 300, `${role} boards`);
  D.ability(role, 'enterVehicle', raft);
  await D.until(() => u.vehicle === raft, 15, `${role} aboard`);
}

// places (m)
const DIVE_IN = [61, 98.2]; // two steps into the shallows below the Marine's start
const HARPOON_SPOT = [34.6, 78.3]; // shallows off the peninsula's west shore, 7.5 m west of e2's west halt (42, 78)
const FOLLOW_SPOT = [50.5, 77.3]; // on e2's beat, 7.5 m short of his east halt (58, 76)
const PACK_SPOT = [36.05, 60.55]; // the shallows at the raft's stern, an arm's length from it, by deep water
const PACK_EXIT = [35.1, 60.45]; // one step back: deep water (he swims)
const PACK_T = 2.4; // s from the order to the raft in his pack (a step to it, 2 s to deflate and pack it)
// on the surface: down the peninsula's shore, behind islet 2, the fjord's south-west corner, the shallows below the GB
const SWIM_ROUTE = [[33.5, 62], [32.6, 68], [32, 75], [25.5, 81], [17, 90], [19.8, 101.3]];
const LANDING_RAFT = [9.1, 44.3]; // north shore shallows, 3 m west of e4's west halt (he walks the beach east of it)
// the raft runs in from the south-east, bow to the north-west, so the Green Beret's side (the right) lies against the
// bank: he rolls out straight onto the snow and gets down on the spot — no step on the snow, no boot print for e4 and
// the p3 patrol to follow (verifier, fix round 2: a single print where he stepped up the bank drew e4 and then the
// whole patrol to within 3 m of his dig)
const LANDING_TURN = [10.8, 46.1]; // just off the landing to its south-east (out of e1's reach): the raft swings in from here
const LANDING_GB = [9.75, 42.75]; // where he gets out: the snow at the raft's right side
const RAFT_HIDE = [8, 80]; // the west fjord behind the islets: nobody looks there either
const RAFT_WAIT = [6, 81]; // the fjord's west side behind the islets, 39 m from e4's west halt: beyond every cone
// the dash to the beach: up the fjord's west edge, round the far side of the MG's traverse (e13 never looks that far
// west), and in to the landing
const DASH = [[1, 64], [1, 53], LANDING_TURN, LANDING_RAFT];
// s the raft lies at the beach: both men out, the Marine packs it (2 s; the fold after it, abilities/raft-actions.js,
// is cut short: the beach gap leaves no time for it, he dives with the pack at once). Measured: packed 2.1 s and the
// Marine under water 3.6 s after the raft stops (both get out on the shallow side; nobody wades)
const LAND_HOLD = 3;
const LAND_UNDER = 4.5; // s from the raft stopping until the Marine is under water (measured 3.6)
const DIG = LANDING_GB; // 2 m west of e4's west halt, in the snow above the beach: the GB digs in where he got out
const SHELTER = [17.5, 38]; // a hollow west of the MG nest, between e4's beach and p3's path
const CAMP_CRAWL = [[19.8, 36.3], [23, 35], [22.8, 30], [21.8, 26.5]]; // across p3's path, round the drums
const HIDEOUT = [21.8, 26.5]; // between the barracks, in the camp's middle: no cone ever reaches a man lying there
const DRUM_APPROACH = [22.2, 31.9]; // prone just north of drum b4
// up the camp's middle, between the station and the parked car, round the mast to the station's north wall
const CARRY_ROUTE = [[21.3, 27], [19.5, 18], [17.4, 10.6], [16.4, 8.4], [13.4, 8.2]];
const ROUND_MAST = [16.6, 8.6]; // between the station's north-east corner and the mast
const BY_CAR = [17.4, 10.6]; // between the station and the parked car
const WAIT_SPOT = [19.3, 17.5]; // just south of the parked car: no cone reaches a man lying there
const SHOT_SPOT = [3, 9.2]; // 9.5 m west of the drum, past the station's north-west corner (the station hides nobody)

const DBG = !!globalThis.process?.env?.M01DBG || !!globalThis.__M3DBG;

export const STAGES = [
  ['A', 'Green Beret: knife the road sentry, crawl past the house to the fjord', async (D) => {
    const e6 = D.get('e6');
    // first of all the Marine gets down: his start on the peninsula's tip lies in the far reach of e2 and of the p2
    // patrol across the water (a man lying down is seen in the near band only)
    D.order('diver', { type: 'stance', stance: 'crawl' });
    await D.stance('greenberet', 'crawl');
    // e6 watches the road north, his back to the GB's hollow: in behind him on the belly, and the knife
    for (const [x, z] of [[11, 153], [6.4, 150.8], [6.1, 147.6]]) await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 8, keep: 1, label: `GB behind e6 (${x},${z})` });
    D.ability('greenberet', 'knife', e6);
    await D.until(() => !e6.alive, 15, 'e6 knifed');
    await D.idle('greenberet');
    D.checkpoint('A1 road sentry e6 knifed');
    // west of the sentry box and up the far side of the wall, out of e7's sight (he watches the yard and the road east)
    for (const [x, z] of [[13, 138], [16, 127], [19, 116], [19.5, 104]]) {
      await D.sneak(x, z, { mode: 'crawl', role: 'greenberet', box: 10, label: `GB to (${x},${z})` });
    }
    D.checkpoint('A2 GB on the south shore');
  }],
  ['B', 'Marine: under water to e2\'s beat, harpoon him from behind', async (D) => {
    const dv = D.c('diver'), e2 = D.get('e2');
    // two steps on the belly into the shallows, and under, when nobody looks his way
    await D.stance('diver', 'crawl');
    await D.until(() => D.clearAhead(...DIVE_IN, 4, true, null, null, 2) && D.clearAhead(...DIVE_IN, 3.5, false, null, null, 2), 120, 'dive window');
    await D.go('diver', ...DIVE_IN, { tol: 0.3 });
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater && !dv.currentAction, 5, 'Marine under water');
    D.checkpoint('B1 Marine under water');
    for (const [x, z] of [[50, 100.5], [35, 89], HARPOON_SPOT]) {
      D.order('diver', { type: 'move', x, z });
      await D.until(() => !dv.path && !dv.isMoving, 120, `Marine swims to (${x},${z})`);
    }
    D.checkpoint('B2 Marine off e2\'s west halt');
    // e2 looks out over the water at his west halt, then walks off east to his east halt and looks east there. Shot
    // here his body would lie in sight of the p2 patrol's halt across the water; at the east halt nobody ever sees it.
    // So the Marine follows him: when e2 is well on his way east (his back to the shore), the Marine surfaces, walks
    // out after him (silent, and faster than e2) and harpoons him from behind at the far end of his beat.
    await D.until(() => e2.isMoving && Math.cos(e2.heading) > 0.9 && e2.x > 47 && e2.x < 49
      && D.routeClear('diver', [FOLLOW_SPOT], { speed: 2.25, low: false, delay: 1.6, pause: 1 }), 300, 'e2 well on his way east');
    D.ability('diver', 'dive'); // gear off (under water till he is done)
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'Marine surfaced');
    D.order('diver', { type: 'move', x: FOLLOW_SPOT[0], z: FOLLOW_SPOT[1] });
    // (footprints in the snow: he keeps to e2's own beat, out of the near band of e1 on the north shore)
    await D.until(() => !dv.path && !dv.isMoving && (e2.brain.atWait || e2.x > 57.3) && Math.cos(e2.heading) > 0.7
      && Math.hypot(e2.x - dv.x, e2.z - dv.z) < 8.8, 30, 'e2 at his east halt, back turned, in reach');
    D.ability('diver', 'harpoon', e2);
    await D.until(() => !e2.alive, 5, 'e2 harpooned');
    await D.idle('diver');
    D.checkpoint('B3 e2 harpooned');
    // back the way he came (his own prints) to the west shore, and under again
    await D.go('diver', ...HARPOON_SPOT, { tol: 0.4 });
    await D.until(() => D.clearAhead(dv.x, dv.z, 2, false), 120, 'dive window (west shore)');
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater && !dv.currentAction, 5, 'Marine under again');
    D.checkpoint('B4 Marine under water again');
  }],
  ['C', 'Marine: up the west shore to the raft, packs it, and swims it over to the Green Beret', async (D) => {
    const dv = D.c('diver'), raft = D.raft();
    D.order('diver', { type: 'move', x: PACK_SPOT[0], z: PACK_SPOT[1] });
    await D.until(() => !dv.path && !dv.isMoving, 120, 'Marine swims to the raft');
    D.checkpoint('C1 Marine under water beside the raft');
    // A crewed raft is seen in both bands of every cone, and the MG across the water (e13) sweeps over this spot two
    // seconds in every five: a raft paddled off from here is still in his reach when he sweeps back. So the Marine
    // packs it where it lies. He surfaces (1.5 s, still under water), packs it (2 s, standing in the shallows at its
    // stern), steps back into deep water and swims off on the surface — a swimmer is seen in the near band only. He
    // starts when the MG has just swept past and nobody else (e3 beside him, e1 on the shore, e4 / e5 across the
    // water) will look at the spot until he is swimming.
    const why = [];
    let k = 0;
    const swimFrom = 1.5 + PACK_T + 1;
    await D.until(() => {
      if (k++ % 3) return false;
      why.length = 0;
      return clearFor(D, ...PACK_SPOT, 1.4, PACK_T + 0.7, false, why, 1) // (from his surfacing until he swims)
        && D.routeClear('diver', SWIM_ROUTE, { from: PACK_EXIT, delay: swimFrom, speed: 1.8, low: true, why });
    }, 900, 'raft: the MG past and nobody looking').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    D.ability('diver', 'dive'); // gear off
    await D.until(() => !dv.diving && !dv.currentAction, 5, 'Marine surfaced');
    D.ability('diver', 'hand', raft);
    // (in his kit at 2 s: no time to fold it here before the MG sweeps back — he swims off at once, the pack going
    // straight onto his back: the fold cut short, art/raft-actions.js)
    await D.until(() => dv.has('inflatableBoat'), 8, 'raft packed');
    D.order('diver', { type: 'move', x: PACK_EXIT[0], z: PACK_EXIT[1] });
    await D.until(() => dv.stance === 'swim', 5, 'Marine swimming');
    D.checkpoint('C2 raft packed, Marine swimming');
    // on the surface down the peninsula's shore, round behind the islets and across the fjord's south-west corner to
    // the Green Beret: no near band reaches that water
    for (const [x, z] of SWIM_ROUTE) await D.go('diver', x, z, { tol: 0.5 });
    // he puts the raft in the water in the shallows below the GB (nobody looks there) and climbs in
    D.ability('diver', 'raft');
    await D.until(() => dv.vehicle && dv.vehicle.vehicleType === 'raft', 8, 'raft deployed');
    D.checkpoint('C3 raft below the GB');
  }],
  ['D', 'Green Beret aboard; across the fjord to the north shore', async (D, { boardPoint }) => {
    const gb = D.c('greenberet'), raft = D.raft();
    await boardRaft(D, 'greenberet', boardPoint);
    await D.wait(1.5); // (he climbs over the side and sits down)
    D.checkpoint('D1 GB aboard');
    // the whole south-west of the fjord, behind the islets, lies outside every cone: straight up its west side
    for (const [x, z] of [RAFT_HIDE, RAFT_WAIT]) await D.row(x, z);
    D.checkpoint('D2 raft waiting at the fjord\'s west edge');
    // the north beach is watched by e4 walking it, by e5 from further east and by the MG (e13) sweeping the water: the
    // raft waits until it can dash in hard up the fjord's far west edge (past the end of the MG's traverse) and drop
    // the GB before anyone looks — then the Marine, his job done, packs the raft on the spot and slips under water with
    // it (gear on 1.5 s), so nothing is left on the beach to see. The GB rolls out onto the bank and, flat on his belly
    // (a crawling man leaves no boot prints), crawls a few metres west and digs himself into the snow: buried, nobody sees him, and he waits there for the way into the camp to open.
    const dv = D.c('diver'), rate = raft.def?.turn || Math.PI / 2, fast = raft.def?.fast || 4;
    const legT = (ax, az, ah, bx, bz) => {
      const want = Math.atan2(bz - az, bx - ax), dh = Math.abs(((want - ah + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      return { t: Math.max(0, dh - 0.05) / rate + 0.25 + Math.hypot(bx - ax, bz - az) / fast, h: want };
    };
    const e13 = D.get('e13'), others = D.world.enemies.filter((e) => e !== e13);
    const digT = Math.hypot(DIG[0] - LANDING_GB[0], DIG[1] - LANDING_GB[1]) / 0.7;
    let k = 0, tPlan = 0;
    const why = [];
    await D.until(() => {
      if (k++ % 15) return false;
      why.length = 0;
      let tin = 0;
      for (let i = 0, x = raft.x, z = raft.z, h = raft.heading; i < DASH.length; [x, z] = DASH[i++]) { const l = legT(x, z, h, ...DASH[i]); tin += l.t; h = l.h; }
      // (the MG's sweep is a clock: checked apart, with the raft's own timing margin only; the walkers with more)
      tPlan = tin;
      const ok = D.rowClear(DASH, { fast: true, hold: LAND_HOLD, slack: [-1, 1.5], pad: 1, why, except: [e13] })
        && D.rowClear(DASH, { fast: true, hold: LAND_HOLD, slack: [-0.6, 0.9], pad: 0.4, why, except: others })
        && clearFor(D, ...LANDING_RAFT, tin, LAND_UNDER, false, why, 2) // the Marine packing the raft and diving
        && clearFor(D, ...LANDING_GB, tin, 2.5, false, why, 2) // the GB out on the bank and down
        && D.routeClear('greenberet', [DIG], { from: LANDING_GB, delay: tin + 2, speed: 0.7, low: true, why })
        && clearFor(D, ...DIG, tin + 2 + digT, 3, true, why, 1.5); // he digs in, lying flat
      if (!ok && DBG && k % 1200 === 1) D.log(`DBG ${D.t.toFixed(1)} beach gap: no [${why.join(' ')}]`);
      return ok;
    }, 1500, 'a gap on the north beach').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    const tGo = D.t;
    for (const p of DASH) await D.row(...p, 30, { fast: true });
    const tArr = D.t;
    D.ability('greenberet', 'leaveVehicle');
    await D.until(() => !gb.vehicle, 3, 'GB out');
    const shallow = (u) => D.world.groundAt(u.x, u.z).shallow;
    // (the raft lies with his side against the bank: he is out on the snow and goes flat where he is — a step up the
    // bank from the shallows would leave a boot print the beach guards follow)
    if (shallow(gb) || Math.hypot(gb.x - LANDING_GB[0], gb.z - LANDING_GB[1]) > 1.2) throw new Error(`GB got out at (${gb.x.toFixed(2)},${gb.z.toFixed(2)}), not on the bank (raft heading ${raft.heading.toFixed(2)})`);
    D.ability('diver', 'leaveVehicle');
    await D.until(() => !dv.vehicle, 3, 'Marine out');
    // (a swimmer gets out on the water side: back to the hull in the shallows, where he can stand and pack it)
    if (!shallow(dv)) await D.go('diver', raft.x + (LANDING_GB[0] - raft.x) * 0.35, raft.z + (LANDING_GB[1] - raft.z) * 0.35, { tol: 0.4, max: 6 });
    D.ability('diver', 'hand', raft);
    await D.stance('greenberet', 'crawl');
    D.order('greenberet', { type: 'move', x: DIG[0], z: DIG[1] });
    await D.until(() => dv.has('inflatableBoat'), 8, 'raft packed');
    D.ability('diver', 'dive');
    await D.until(() => dv.underwater && !dv.currentAction, 5, 'Marine under water');
    if (DBG) D.log(`DBG landing: dash ${(tArr - tGo).toFixed(2)} s (planned ${tPlan.toFixed(2)}), Marine under ${(D.t - tArr).toFixed(2)} s after landing`);
    await D.until(() => !gb.path && !gb.isMoving, 15, 'GB at his dig');
    D.ability('greenberet', 'shovel');
    await D.until(() => gb.buried && !gb.currentAction, 5, 'GB buried');
    D.checkpoint('D3 GB dug in on the beach, raft packed, Marine under water');
    // he rises (a second up on his feet) and crawls past the MG nest's west side, across p3's path, east of the drums,
    // into the camp's middle between the barracks — when e4 is away east and the patrol is round the far side of the
    // camp, and nobody looks at the hollow he passes
    const route = [SHELTER, ...CAMP_CRAWL];
    let campT = 0;
    for (let i = 0, [px, pz] = DIG; i < route.length; [px, pz] = route[i++]) campT += Math.hypot(route[i][0] - px, route[i][1] - pz) / 0.7;
    await D.until(() => { why.length = 0; return clearFor(D, ...DIG, 0, 2.2, false, why, 1.5)
      && D.routeClear('greenberet', route, { delay: 1.8, speed: 0.7, low: true, why })
      && clearFor(D, ...HIDEOUT, 1.8 + campT, 6, true, why, 1.5); }, 900, 'the way into the camp').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    D.ability('greenberet', 'shovel'); // rise
    await D.until(() => !gb.buried && !gb.currentAction, 5, 'GB up');
    await D.stance('greenberet', 'crawl');
    for (const [x, z] of route) await D.go('greenberet', x, z, { tol: 0.5 });
    D.checkpoint('D4 GB in the camp');
  }],
  ['E', 'Green Beret: a fuel drum on his shoulder', async (D) => {
    const gb = D.c('greenberet'), drum = D.item('b4');
    // he crawls to drum b4, gets up and shoulders it (a man carrying a drum walks, upright) when e5 (on the pier road)
    // and the p3 patrol are both away: nobody may see him there, nor on the walk up the camp's middle
    const why = [];
    const dA = Math.hypot(DRUM_APPROACH[0] - gb.x, DRUM_APPROACH[1] - gb.z) / 0.7;
    await D.until(() => { why.length = 0; return D.routeClear('greenberet', [DRUM_APPROACH], { speed: 0.7, low: true, why })
      && clearFor(D, ...DRUM_APPROACH, dA, 4, false, why, 1.5)
      && D.routeClear('greenberet', [...CARRY_ROUTE, ROUND_MAST, BY_CAR, WAIT_SPOT], { from: DRUM_APPROACH, speed: 1.4, low: false, delay: dA + 3, why }); }, 600, 'drum: a quiet moment')
      .catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    await D.go('greenberet', ...DRUM_APPROACH, { tol: 0.4 });
    D.ability('greenberet', 'hand', drum);
    await D.until(() => gb.carrying === drum, 10, 'drum shouldered');
    D.checkpoint('E1 GB carries a fuel drum');
  }],
  ['F', 'Green Beret: the drum beside the relay station, and a pistol shot from well back', async (D) => {
    const gb = D.c('greenberet'), drum = D.item('b4');
    for (const [x, z] of CARRY_ROUTE) await D.go('greenberet', x, z, { tol: 0.4 });
    D.ability('greenberet', 'drop');
    await D.until(() => !gb.carrying, 10, 'drum down');
    await D.idle('greenberet');
    D.checkpoint('F1 drum set down between the station and its mast');
    // round the mast, past the parked car, and down on his belly just south of it, where nobody looks, to wait
    for (const p of [ROUND_MAST, BY_CAR, WAIT_SPOT]) await D.go('greenberet', ...p, { tol: 0.4 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('F2 GB waits beside the station');
    // the blast is heard all over the map and the north-shore guards come running (e4 straight up from the beach,
    // the p3 patrol from wherever it is): he waits until both are far off for the next half minute, then walks west
    // along the station's north wall, lies down 10 m from the drum (out of its blast and the car's, inside pistol
    // range) and shoots — nobody gets near before the mission ends, five seconds later
    const far = (e, r, t0, t1) => !e.alive || [...Array(Math.ceil((t1 - t0) / 2) + 1).keys()].every((i) => { const q = D.predict(e, t0 + i * 2); return Math.hypot(q.x - SHOT_SPOT[0], q.z - SHOT_SPOT[1]) >= r; });
    const SHOT_WALK = [BY_CAR, ROUND_MAST, SHOT_SPOT];
    let walkT = 0.6;
    for (let i = 0, [px, pz] = WAIT_SPOT; i < SHOT_WALK.length; [px, pz] = SHOT_WALK[i++]) walkT += Math.hypot(SHOT_WALK[i][0] - px, SHOT_WALK[i][1] - pz) / 1.8;
    const why = [];
    await D.until(() => { why.length = 0; return ['e10', 'e11', 'e12'].every((t) => far(D.get(t), 30, 0, walkT + 8) && far(D.get(t), 40, walkT, walkT + 2)) && far(D.get('e4'), 38, walkT, walkT + 2)
      && D.routeClear('greenberet', SHOT_WALK, { speed: 1.8, low: false, delay: 0.6, why })
      && clearFor(D, ...SHOT_SPOT, walkT, 8, true, why, 1.5); }, 600, 'the patrol and e4 away').catch((e) => { throw new Error(`${e.message} [${why.join(' ')}]`); });
    await D.stance('greenberet', 'stand');
    for (const p of SHOT_WALK) await D.go('greenberet', ...p, { tol: 0.4 });
    await D.stance('greenberet', 'crawl');
    D.checkpoint('F3 GB lies 10 m off the drum');
    D.ability('greenberet', 'pistol', drum);
    await D.until(() => D.world.objectives.every((o) => o.done), 15, 'relay station destroyed');
    D.checkpoint('F4 relay station destroyed');
    // the mission is won five seconds later (no extraction in M1): he lies still where nobody comes
    await D.wait(5.3);
  }],
];

export async function solve(D, ctx = {}) {
  for (const [id, title, fn] of STAGES) {
    if (ctx.from && id < ctx.from) continue;
    ctx.onStage?.(id, title, D.t);
    await fn(D, ctx);
    if (ctx.until && id >= ctx.until) break;
  }
  return D.checkpoints;
}
