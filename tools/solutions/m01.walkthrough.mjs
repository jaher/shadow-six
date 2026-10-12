/**
 * Walkthrough of the M1 solution (tools/solutions/m01.solution.mjs) for debug VIDEO MODE (src/debug/walkthrough.js):
 * chapters per stage, one narration step per checkpoint, camera and cone cues. Format: docs/walkthrough-format.md.
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'm01',
  title: 'Baptism of Fire',
  intro: 'Sola, Norway. Destroy the relay station on the north shore with player orders only: two silent kills, one raft crossing, one fuel drum, and nobody ever sees a commando.',
  chapters: [
    { id: 'A', title: 'The road sentry', say: 'The Green Beret starts south of the coast road; sentry e6 watches it. The Marine gets down at once: his start lies in the far reach of e2 and of the patrol across the water.' },
    { id: 'B', title: 'The Marine under water', say: 'The Marine is alone on the eastern peninsula. e2 walks its shore; the raft lies further up the west shore, under e3\'s eyes.' },
    { id: 'C', title: 'The raft', say: 'Only the Marine can use the raft. It lies in the MG gunner\'s sweep across the water, so he packs it and swims it over to the Green Beret, who waits west of the house.' },
    { id: 'D', title: 'Across the fjord', say: 'The north beach is walked by e4, watched by e5 and swept by the MG. The raft can only land in a gap, and must not stay.' },
    { id: 'E', title: 'The fuel drum', say: 'Fuel drums stand at the barracks behind the MG nest. A man carrying one walks upright, so the moment must be right.' },
    { id: 'F', title: 'The relay station (objective)', say: 'One drum beside the station, one pistol shot from well back: the station and its mast go up together.' },
  ],
  steps: [
    // A · the road sentry
    { cp: 'A1', who: 'greenberet', look: ['e6'], cones: ['e6', 'e7'],
      say: 'e6 looks north up the road with his back to the hollow. The Green Beret crawls in behind him and knifes him.' },
    { cp: 'A2', who: 'greenberet', look: ['e7', [19.5, 104]], cones: ['e7', 'e8', 'e9'],
      say: 'He crawls west of the sentry box and up the far side of the stone wall, out of e7\'s sight, down to the shore west of the house. Lying flat leaves no prints the guards can see.' },
    // B · the Marine under water
    { cp: 'B1', who: 'diver', look: ['e2'], cones: ['e1', 'e2'],
      say: 'Still on his belly, the Marine crawls two steps into the shallows and dives when nobody looks his way.' },
    { cp: 'B2', who: 'diver', look: ['e2'], cones: ['e2'],
      say: 'He swims under water round the peninsula\'s tip to its west shore, off the spot where e2 halts and looks out over the water.' },
    { cp: 'B3', who: 'diver', look: ['e2'], cones: ['e1', 'e2'],
      say: 'A body at e2\'s west halt would be seen from across the fjord. So the Marine surfaces behind him as he walks off east, follows on his own beat, and harpoons him at the far end.',
      beats: [{ on: 'kill:e2', look: ['e2'], shot: true, hold: 1.5 }] },
    { cp: 'B4', who: 'diver', cones: ['e1', 'e3'],
      say: 'Back along the same tracks to the west shore, and under water again.' },
    // C · the raft
    { cp: 'C1', who: 'diver', look: ['raft', 'e3'], cones: ['e3', 'e1'],
      say: 'Under water up the west shore to the raft, which lies just below sentry e3. The sentry looks north, away from the raft.' },
    { cp: 'C2', who: 'diver', look: ['raft', 'e13'], cones: ['e13', 'e5', 'e4', 'e1'],
      say: 'The MG gunner e13 sweeps over the raft two seconds in five; paddled off, it would still be in his reach when he swings back. Right after a sweep the Marine surfaces, packs it and slips back into deep water.',
      beats: [{ on: 'diver:hand', look: ['raft', 'e13'], hold: 2.5 }] },
    { cp: 'C3', who: 'diver', look: [[19.8, 101.3]], cones: ['e3', 'e8', 'e9'],
      say: 'A swimmer shows only in the near band of a cone. On the surface he swims behind the islets and across the fjord to the Green Beret, and inflates the raft in the shallows below him.',
      beats: [{ on: 'diver:raft', look: ['greenberet'], hold: 2 }] },
    // D · across the fjord
    { cp: 'D1', who: ['diver', 'greenberet'], look: ['raft'], cones: [],
      say: 'Nobody looks at these shallows: the Green Beret walks down from the bank and climbs aboard.' },
    { cp: 'D2', who: 'diver', cones: ['e4'],
      say: 'Up the fjord\'s west side to a spot just beyond the far reach of e4, who walks the north beach. There they wait for a gap.' },
    { cp: 'D3', who: ['diver', 'greenberet'], look: ['e4', 'e13'], cones: ['e4', 'e5', 'e13'],
      say: 'When e4 walks off east and the MG swings away, they paddle hard up the far west edge, past the end of his traverse, to the beach. The Marine packs the raft and dives with it.',
      beats: [{ on: 'greenberet:leaveVehicle', look: ['e4'], hold: 2 },
        { on: 'greenberet:shovel', say: 'The Green Beret crawls a few metres west and digs himself into the snow. Buried, nobody can see him, however close they walk.', look: ['e4'], hold: 2 }] },
    { cp: 'D4', who: 'greenberet', look: ['e13', 'e10'], cones: ['e4', 'e13', 'e10', 'e11', 'e12'],
      say: 'He waits under the snow until e4 is away east and the p3 patrol round the far side of the camp, then rises and crawls past the MG nest\'s back, across the patrol\'s path, into the camp\'s middle.' },
    // E · the fuel drum
    { cp: 'E1', who: 'greenberet', look: ['b4', 'e5'], cones: ['e5', 'e10', 'e11', 'e12'],
      say: 'With e5 at the far end of his beat and the patrol away, he crawls to a fuel drum, gets up and shoulders it.' },
    // F · the relay station
    { cp: 'F1', who: 'greenberet', look: ['relay_hut', 'relay_mast'], cones: ['e10', 'e11', 'e12'],
      say: 'He carries it up the camp\'s middle, where nobody looks, past the parked car and the mast, and sets it down against the station\'s north wall.' },
    { cp: 'F2', who: 'greenberet', look: ['relay_hut'], cones: ['e10', 'e11', 'e12'],
      say: 'Then he lies down in the gap between the station and the car, where no cone reaches, and waits.' },
    { cp: 'F3', who: 'greenberet', look: ['b4', 'e4'], cones: ['e4', 'e10', 'e11', 'e12'],
      say: 'The blast will bring e4 and the patrol running. When both are far off, he walks round the station and lies down ten metres from the drum: out of its blast and the car\'s, in pistol range.' },
    { cp: 'F4', who: 'greenberet', look: ['relay_hut', 'relay_mast'], shot: true, zoom: 'wide',
      say: 'One pistol shot sets the drum off. The station, its mast and the car go up; the guards come running, but the mission ends before they get near.',
      beats: [{ on: 'objective:o1', look: ['relay_hut', 'relay_mast'], shot: true }] },
  ],
  outro: 'Mission complete: the relay station is gone, two guards dead, and no commando was ever seen.',
};
