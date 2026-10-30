/**
 * The cut for the M1 solution film (tools/solutions/capture-video.mjs). The generic director does the rest — the walkthrough's
 * chapter titles and step captions, real time round the two kills and the blast, the cards — and this file mends the one
 * stretch it leaves quiet: stage D's wait. The raft lies off the fjord's west edge for 6½ minutes of game time (from D2 until
 * its dash, a few seconds before D3), out of every cone, until the north beach has a gap: e4 off east on his beat, e5
 * looking away, the MG swung round. Filmed from the raft that is 19 s of a parked boat and some ducks. Here the camera goes
 * to the beach, where the waiting is done (the guards pacing, the gun sweeping), at 40×; it slows as the gap opens and rides
 * the dash, the landing and e4's walk back to his halt at 1.5–4×, so the film never sits on a picture where nothing moves.
 * Times (game seconds) come from the logic-only pass of the same run: cp(k) = the time of checkpoint k.
 */

const DASH = 18; // the raft leaves its waiting spot this long before D3: the dash up the west edge (≈ 13 s), then the landing
const LAND = 5;  // the raft is alongside the bank this long before D3: the Green Beret out and flat, the Marine packing, the dig-in
const GAP = 12;  // the stretch before the dash in which the gap opens (e4 turns east, the MG swings away)
const BURIED = 27; // from the dig-in until the Green Beret rises again: e4 walks back to his halt, two metres from him

export const CAPTIONS = {
  // (a step caption is shown for a while after its checkpoint; D3's is replaced by the notes below)
  D4: 'With e4 away east and the patrol round the far side of the camp, he rises and crawls into the camp.',
};

/** timed captions: what the camera is looking at between the checkpoints, whose step captions run out */
export function notes(cp) {
  const d2 = cp('D2'), d3 = cp('D3');
  if (!d2 || !d3) return [];
  return [
    { t0: d2 + 10, t1: d3 - DASH - GAP, text: 'Waiting for a gap: e4 walks the beach, e5 watches from the east, the MG gunner e13 sweeps the water.' },
    { t0: d3 - DASH - GAP, t1: d3 - LAND, text: 'e4 walks off east, the MG swings away: the raft dashes in up the far west edge.' },
    { t0: d3 - LAND, t1: d3 + 3, text: 'The Green Beret rolls out and goes flat; the Marine packs the raft and dives.' },
    { t0: d3 + 3, t1: d3 + BURIED, text: 'Buried and without a print, two metres from e4’s halt: e4 finds nothing.' },
  ];
}

/** fixed shots (game time): the beach the raft is waiting for, then the landing closer */
export function shots(cp) {
  const d2 = cp('D2'), d3 = cp('D3');
  if (!d2 || !d3) return [];
  return [
    { t0: d2 + 10, t1: d3 - LAND - 3, x: 15, z: 43, zoom: 0.75, prio: 1 }, // e4's beat, the MG nest and the patrol's path; the raft comes in from the south-west corner
    { t0: d3 - LAND - 3, t1: d3 + BURIED, x: 10.5, z: 45, zoom: 1, prio: 1 }, // the raft alongside, the Green Beret out and digging in, e4's halt two metres off
  ];
}

/** real-time (or slow fast-forward) windows: a time-lapse of the wait, then the gap, the dash, the landing and e4's return */
export function windows(cp) {
  const d2 = cp('D2'), d3 = cp('D3');
  if (!d2 || !d3) return [];
  return [
    { t0: d2 + 10, t1: d3 - DASH - GAP, speed: 40 }, // the wait, from the beach
    { t0: d3 - DASH - GAP, t1: d3 - DASH, speed: 3 }, // the gap opens: e4 walks off east, the MG swings away
    { t0: d3 - DASH, t1: d3 - LAND, speed: 2.5 },     // the dash
    { t0: d3 - LAND, t1: d3 + 3, speed: 1.5 },        // the landing, the roll out, the dig-in
    { t0: d3 + 3, t1: d3 + BURIED, speed: 4 },        // e4 walks back to his halt and finds nothing
  ];
}
