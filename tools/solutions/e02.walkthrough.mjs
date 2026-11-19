/**
 * Walkthrough of the e02 solution (tools/solutions/e02.solution.mjs) for debug VIDEO MODE (src/debug/walkthrough.js):
 * chapters per stage, one narration step per checkpoint, camera and cone cues. Format: docs/walkthrough-format.md.
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'e02',
  title: 'Curfew',
  intro: 'A hill town above the port, under curfew, by night. Take the direction-finders\' bearings log from their van, put the palazzo\'s searchlight out, free Captain Hollis from the cellar, and bring everyone, Hollis and the boy Tonino too, into the aqueduct cistern on Via Alta. Nobody sees the team the whole night.',
  chapters: [
    { id: 'A', title: 'Over the avenue', say: 'The team starts behind the burning tram on Via Marina. A guard walks the avenue\'s north pavement and the roadblock\'s gun looks down it.' },
    { id: 'B', title: 'The washing', say: 'On the low house\'s roof terrace hangs a private\'s tunic. Privates take a man in it for one of their own; sergeants and the dog do not.' },
    { id: 'C', title: 'The Spy at the steps', say: 'In the tunic the Spy walks up Vico 2, past its two privates, to the head of the Scalinata.' },
    { id: 'D', title: 'Vico 2', say: 'l1 walks the alley up and down; l2 stands at the foot of the steps. Both have to go, and nobody may see them lie.' },
    { id: 'E', title: 'The sergeant\'s tunic', say: 'p5, the sergeant of the square, stands by the head of the steps; p3 laps the square. A sergeant\'s tunic opens the palazzo gate.' },
    { id: 'F', title: 'The belfry', say: 'The bell tower beside the church looks across at the palazzo roof, 38 m away: the Sniper\'s perch for the searchlight.' },
    { id: 'G', title: 'The gate', say: 'Two posts stand at the palazzo gate, a sergeant and a private, staring out east across the square.' },
    { id: 'H', title: 'The searchlight (objective 2)', say: 'Nobody at the gate now looks at the bell tower: one shot.' },
    { id: 'I', title: 'The courtyard (objectives 1 and 3)', say: 'The lieutenant reads the log at the van and walks back to the main door; c1 watches the van, c2 guards the cellar door.' },
    { id: 'J', title: 'Out over Via Alta (objective 4)', say: 'Up Salita W, a stair in a canyon, to Via Alta, and west along it to the cistern: u1 walks the road from end to end, u2 stands at the cistern lane.' },
  ],
  steps: [
    // A · over the avenue
    { cp: 'A0', who: 'greenberet', look: ['a4'], cones: ['a4', 'a1'],
      say: 'All four lie down behind the burning tram. a4 walks the avenue\'s north pavement; at its west end he looks up Vico 1.' },
    { cp: 'A1', who: ['greenberet', 'spy', 'tonino', 'sniper'], look: ['a4'], cones: ['a4', 'dog1'],
      say: 'Behind a4\'s back they crawl over the avenue and along the house fronts to the low house\'s outside stair, and up onto its terrace. Nobody ever sees a man lying behind its parapet.' },
    // B · the washing
    { cp: 'B1', who: 'spy', look: ['l1', 'dog1'], cones: ['l1', 'dog1'],
      say: 'When l1 is down at the avenue end of Vico 2 and the dog pair far along the cross-alley, the Spy stands up at the washing line, takes the private\'s tunic and puts it on. Then he lies down again: the dog sees through any tunic.' },
    // C · the Spy at the steps
    { cp: 'C1', who: 'spy', look: ['l1', 'l2'], cones: ['l1', 'l2', 'dog1'],
      say: 'Down the stair, up Vico 2 behind l1 and past l2 to the steps, and up them to the square\'s south-west corner, behind the balustrade.' },
    // D · Vico 2
    { cp: 'D1', who: 'greenberet', look: ['l1'], cones: ['l1', 'l3'],
      say: 'The corner house on Vico 2 is unlocked. While l1 is up at the north end of his beat, the Green Beret crawls down the stair and slips in.' },
    { cp: 'D2', who: ['spy', 'greenberet'], look: ['l2', 'l1'], cones: ['l1', 'l2'],
      say: 'As l1 walks back down to the avenue, the Spy talks to l2 from the steps: l2 turns his back on the alley. The Green Beret steps out of the house behind l1.' },
    { cp: 'D3', who: 'greenberet', look: ['l1'], cones: ['a4'],
      say: 'At the avenue end of his beat l1 stops to look out over Via Marina. A blow from behind, and the cuffs.',
      beats: [{ on: 'greenberet:knockoutFist>l1', look: ['l1'], shot: true, hold: 1.2 }] },
    { cp: 'D4', who: 'greenberet', look: ['l2'], cones: ['l3'],
      say: 'He crawls up the alley into the far side of the recess at the foot of the steps, walks round behind l2, still talking to the Spy, and knocks him out. Cuffed, carried onto the lowest steps: nobody ever looks down there.',
      beats: [{ on: 'greenberet:knockoutFist>l2', look: ['l2'], shot: true, hold: 1.2 }] },
    // E · the sergeant's tunic
    { cp: 'E1', who: 'spy', look: ['p3', 'p5'], cones: ['p3', 'p5'],
      say: 'Behind p5\'s back the Spy walks along the square\'s south edge to its south-east corner, beyond the searchlight\'s reach. When p3 stops there, the Spy, a private to him, talks to him: p3 turns his back on p5.' },
    { cp: 'E2', who: 'greenberet', look: ['p5'], cones: ['p3', 'p4'],
      say: 'The Green Beret crawls up the steps and in behind p5, knocks him out, carries him along the balustrade and cuffs him.',
      beats: [{ on: 'greenberet:knockoutFist>p5', look: ['p5'], shot: true, hold: 1.2 }] },
    { cp: 'E3', who: 'greenberet', look: ['p3'], cones: ['p4'],
      say: 'Then p3, still talking to the Spy: out from behind, cuffed where he falls. Nobody left on the square looks at this corner.',
      beats: [{ on: 'greenberet:knockoutFist>p3', look: ['p3'], shot: true, hold: 1.2 }] },
    { cp: 'E4', who: 'spy', look: ['p5'], cones: [],
      say: 'The Spy takes the sergeant\'s tunic off p5 with the hanger and changes into it. Only the lieutenant in the palazzo, and the dogs, see through a sergeant now.' },
    // F · the belfry
    { cp: 'F1', who: 'sniper', look: ['bell_tower'], cones: ['p4', 'p1', 'p2'],
      say: 'The Sniper crawls up the steps\' middle, along the strip under the balustrade and round the back of the church, and climbs the rungs on the tower\'s east face, out of the searchlight\'s sight. He lies flat in the belfry.' },
    // G · the gate
    { cp: 'G1', who: 'spy', look: ['p1', 'c3'], cones: ['p1', 'p2', 'c3'],
      say: 'The Green Beret crawls under the palazzo\'s front to the gate. As the lieutenant walks back to the main door, the Spy, a sergeant to the sergeant on the gate, talks to p1: p1 turns his back on the south jamb.' },
    { cp: 'G2', who: 'greenberet', look: ['p2', 'p1'], cones: ['c2', 'c3'],
      say: 'p2 knocked out from behind and cuffed, then p1, still talking. Both are laid along the palazzo\'s front, out of every sight line through the gate.',
      beats: [{ on: 'greenberet:knockoutFist>p2', look: ['p2'], shot: true, hold: 1 }, { on: 'greenberet:knockoutFist>p1', look: ['p1'], shot: true, hold: 1 }] },
    // H · the searchlight
    { cp: 'H1', who: 'sniper', look: ['c4'], cones: ['c4'],
      say: 'Nobody looks at the bell tower now. The Sniper kneels up in the belfry and fires once: the searchlight crew falls and the beam goes out.',
      beats: [{ on: 'kill:c4', look: ['c4'], shot: true, hold: 1.5 }] },
    // I · the courtyard
    { cp: 'I1', who: 'spy', look: ['c2', 'c3'], cones: ['c1', 'c2', 'c3'],
      say: 'As the lieutenant sets off from the van for the main door, the Spy walks into the courtyard and talks to c2 from the cellar door: c2 turns his back on the yard.' },
    { cp: 'I2', who: 'greenberet', look: ['c1', 'c3', 'c2'], cones: ['c1', 'c3'],
      say: 'The Green Beret slips in through the gate behind c1 and knocks him out; then the lieutenant, standing at the main door with his back to the yard; then c2. All cuffed.',
      beats: [{ on: 'greenberet:knockoutFist>c1', look: ['c1'], shot: true, hold: 1 }, { on: 'greenberet:knockoutFist>c3', look: ['c3'], shot: true, hold: 1 }, { on: 'greenberet:knockoutFist>c2', look: ['c2'], shot: true, hold: 1 }] },
    { cp: 'I3', who: 'greenberet', look: ['van_df'], cones: [],
      say: 'The bearings log off the van\'s tailboard. Whatever happens now, the van cannot take it away.' },
    { cp: 'I4', who: 'greenberet', look: ['cellar'], cones: [],
      say: 'The cellar door: Captain Hollis is free. He keeps at the heels of the nearest of the team, on his feet: he cannot crawl.' },
    // J · out over Via Alta
    { cp: 'J1', who: ['greenberet', 'sniper', 'tonino', 'spy'], look: [[41.75, 30]], cones: ['u1'],
      say: 'One after the other into the canyon of Salita W: the Green Beret, the Sniper from the belfry, Tonino from the lower town, the Spy with Hollis at his heels. From Via Alta nobody sees into it but from its head.' },
    { cp: 'J2', who: 'spy', look: ['u2'], cones: ['u1', 'u2'],
      say: 'Tonino stands by Hollis. The Spy, a sergeant on the road, walks along Via Alta to u2 at the mouth of the cistern lane and talks to him from the road: u2 turns his back on the lane.' },
    { cp: 'J3', who: 'greenberet', look: ['u2', 'u1'], cones: ['u1'],
      say: 'As u1 walks off east past the stair\'s head, the Green Beret crawls along Via Alta\'s north side and round u2 into the lane: a blow from behind, and u2 carried up the lane out of sight.',
      beats: [{ on: 'greenberet:knockoutFist>u2', look: ['u2'], shot: true, hold: 1 }] },
    { cp: 'J4', who: ['spy', 'sniper', 'tonino', 'greenberet'], look: [[12.5, 6.8]], cones: ['u1'],
      say: 'u1 walks off east again, his back to the stair: everyone up it and along Via Alta into the cistern lane, Hollis at the Spy\'s heels. The whole night, nobody saw them.' },
  ],
};
