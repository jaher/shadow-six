/**
 * Walkthrough of the M2 solution (tools/solutions/m02.solution.mjs) for debug VIDEO MODE (src/debug/walkthrough.js):
 * chapters per stage, one narration step per checkpoint, camera and cone cues. Format: docs/walkthrough-format.md.
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'm02',
  title: 'A Quiet Blow-Up',
  intro: 'Stamsund, Lofoten. Blow the fuel depot in the walled camp across the river and escape in its truck: one sniper shot, two raft trips, five men into the truck unseen, and one time bomb, set just before the truck pulls away, that goes off behind it.',
  chapters: [
    { id: 'A', title: 'Round the settlement', say: 'The team starts behind the settlement, where three guards walk, but the way to the river runs outside its walls.' },
    { id: 'B', title: 'The sentry on the far bank', say: 'e4 walks the far bank right where the team must land, so the Sniper deals with him first.' },
    { id: 'C', title: 'The first trip', say: 'Only the Marine can row the raft, it takes two passengers, and it crosses only behind the patrol boat\'s back.' },
    { id: 'D', title: 'The second trip', say: 'Another pass of the patrol boat, another gap: the Sapper and the Driver follow, and the raft is packed away.' },
    { id: 'E', title: 'Into the truck', say: 'One man at a time crawls in under the boom to the truck by the gate, while e6 walks to the gate and back, e7 circles the depot and a patrol of three goes round the camp.' },
    { id: 'F', title: 'The fuel depot (objective)', say: 'A bomb in the gap between the two fuel tanks takes both, and the truck must be on its way out when it goes off.' },
  ],
  steps: [
    // A · round the settlement
    { cp: 'A1', who: ['greenberet', 'sniper', 'diver', 'sapper', 'driver'], look: ['e1', 'e3'], cones: ['e1', 'e2', 'e3'],
      say: 'The team walks round the settlement\'s south-east corner and up its east wall, ground no guard looks at, and lies down there.' },
    // B · e4
    { cp: 'B1', who: 'sniper', look: ['e4'], cones: ['e4', 'e5'],
      say: 'The Sniper crawls to the river bank. From there e4\'s whole beat on the far bank lies within his rifle\'s reach.' },
    { cp: 'B2', who: 'sniper', look: ['e4'], cones: ['e4', 'e5', 'e6'],
      say: 'He waits until e4 stops at the east end of his beat, where no other guard can see him fall nor see him kneel to fire, and shoots.',
      beats: [{ on: 'kill:e4', look: ['e4'], shot: true, hold: 1.5 }] },
    // C · first trip
    { cp: 'C1', who: ['sapper', 'diver', 'greenberet', 'driver', 'sniper'], look: [[43.6, 97.6]], cones: ['e1', 'e3', 'e17'],
      say: 'One by one they crawl down to the bank south-east of the settlement, too far from its east gap for anyone inside to see a man lying there, or his tracks.' },
    { cp: 'C2', who: ['diver', 'greenberet', 'sniper'], look: ['pboat'], cones: ['e17', 'e5'],
      say: 'The patrol boat looks the way it goes. As soon as it has passed upstream, the Marine inflates the raft, the Green Beret and the Sniper climb in and he rows them across.',
      beats: [{ on: 'diver:raft', look: ['pboat'], hold: 2 }] },
    { cp: 'C3', who: 'diver', look: ['pboat'], cones: ['e17', 'e5'],
      say: 'The two crawl up to the camp\'s south-east wall. An empty raft would give them away, so the Marine packs it and slips under water.' },
    { cp: 'C4', who: 'diver', look: [[43.6, 97.6]], cones: ['e17'],
      say: 'Nobody sees a diver: he swims back to the launch under water and waits there for the boat\'s next pass.' },
    // D · second trip
    { cp: 'D1', who: ['diver', 'sapper', 'driver'], look: ['pboat'], cones: ['e17', 'e5'],
      say: 'In the next gap behind the patrol boat he surfaces, puts the raft in again and takes the Sapper and the Driver across.' },
    { cp: 'D2', who: 'diver', look: [[44.2, 64.4]], cones: ['e17'],
      say: 'Again he packs the raft as soon as they are out.' },
    { cp: 'D3', who: 'diver', look: ['gate_se'], cones: ['e6', 'e10'],
      say: 'He crawls after them. The whole team now lies outside the camp\'s south-east wall, a few metres from the gate.' },
    // E · into the truck
    { cp: 'E1', who: 'driver', look: ['gate_se', 'e6'], cones: ['e6', 'e7', 'e10'],
      say: 'A man on his belly cannot squeeze round the lowered boom. When e6 has turned back from the gate, the Driver crawls up to it, gets up just long enough to raise it, and lies down again.',
      beats: [{ on: 'driver:use', look: ['gate_se'], hold: 1 }] },
    { cp: 'E2', who: 'driver', look: ['truck'], cones: ['e6', 'e7', 'e10'],
      say: 'He crawls on under it, up the truck\'s side to the cab door, and climbs in while nobody looks.' },
    { cp: 'E3', who: 'sniper', look: ['truck', 'e7'], cones: ['e6', 'e7', 'e10'],
      say: 'The others take the tailgate. Each crawls in first to the lee of the cab, which only e7 and the patrol can see, then on round the truck and up into the back.' },
    { cp: 'E4', who: 'greenberet', look: ['truck'], cones: ['e6', 'e7', 'e10'],
      say: 'The Green Beret follows the same way in the next quiet moment. The canvas hides everyone who sits in the truck.' },
    { cp: 'E5', who: 'diver', look: ['truck'], cones: ['e6', 'e7', 'e10'],
      say: 'Then the Marine.' },
    // F · the depot
    { cp: 'F1', who: 'sapper', look: ['truck', 'depot_a'], cones: ['e6', 'e7', 'e10'],
      say: 'The Sapper comes last, the same way. He waits in the truck until e7, e6 and the patrol will all be away from the depot at once.' },
    { cp: 'F2', who: 'sapper', look: ['depot_a', 'depot_b'], cones: ['e7', 'e6'],
      say: 'Then he gets out at the tailgate, walks up to the gap between the two tanks and sets a time bomb: ten seconds.',
      beats: [{ on: 'sapper:timeBomb', look: ['depot_a', 'depot_b'], hold: 1.5 }] },
    { cp: 'F3', who: 'sapper', look: ['truck'], cones: ['e6', 'e7'],
      say: 'He walks straight back to the truck and climbs in. Running would be heard.' },
    { cp: 'F4', who: 'driver', look: ['truck', 'depot_a', 'depot_b'], zoom: 'wide',
      say: 'With the bomb\'s last seconds ticking, the Driver floors it out of the gate. The depot goes up behind them and the alarm sounds, but the truck is already on the road out.',
      beats: [{ on: 'objective:o1', look: ['depot_a', 'depot_b'], shot: true, hold: 1.5 }] },
  ],
  outro: 'Mission complete: the depot is burning and the whole team is away in the truck. One guard shot, and the alarm only as the truck left.',
};
