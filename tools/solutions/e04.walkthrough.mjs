/**
 * Walkthrough of the LIGHTS OUT e04 solution (tools/solutions/e04.solution.mjs) for debug VIDEO MODE
 * (src/debug/walkthrough.js): chapters per stage, one narration step per checkpoint, camera and cone cues.
 * Format: docs/walkthrough-format.md.
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'e04',
  title: 'Black Rain',
  intro: 'Puits Sainte-Barbe colliery, Lorraine, August 1944, in the rain. Take the bearing archive from the station chief\'s office, blow the two DF lorries and the DF hut on the spoil heap, and leave down the heap\'s far side. Nobody sees the team: the only alarm is the last charge going up.',
  chapters: [
    { id: 'A', title: 'The railway verge', say: 'North of the main line the grass verge runs the whole width of the colliery. From the yard, a man lying in it is too far off to be seen.' },
    { id: 'B', title: 'Behind the coal train', say: 'The coal train comes through every couple of minutes and kills whatever stands on its track. Right behind one, the team crosses and the Sapper cuts the fence.' },
    { id: 'C', title: 'The Driver\'s rifle', say: 'A walker paces the lamp room\'s north side. The Lee-Enfield kills at thirty paces with one round, but it is as loud as a pistol.' },
    { id: 'D', title: 'The office and the archive', say: 'The chief walks between his office and the pithead baths. While he is at the baths, the door sentry is taken from his blind side and the archive is ours.' },
    { id: 'E', title: 'The chief and the lorries\' sentry', say: 'Back at his door, the chief looks at his office for a minute. Then the sentry between the DF lorries, who looks west along the baths.' },
    { id: 'F', title: 'Remote charges on the lorries', say: 'The Sapper comes down the office\'s east side and sets a remote charge at each lorry\'s nose.' },
    { id: 'G', title: 'The spoil wagon', say: 'A spoil wagon pushed along the tub tramway is a wall that walks with you. Two walkers pace the slurry to the south.' },
    { id: 'H', title: 'The winding house', say: 'The rim sentry 18 m up looks down on the winch and the incline\'s foot; the house throws a shadow he cannot see into.' },
    { id: 'I', title: 'The incline', say: 'The skip moves only when the winch is worked. A handcuffed winchman on strings works it like any winchman.' },
    { id: 'J', title: 'The top of the heap', say: 'Out of the skip behind the rim sentry, up the gully, and the DF hut with its loop aerial.' },
    { id: 'K', title: 'Down the far side (all objectives)', say: 'Everyone down the heap\'s far side into the woods; then the Sapper fires the three charges.' },
  ],
  steps: [
    // A · the verge
    { cp: 'A1', who: ['greenberet', 'driver', 'sapper', 'sniper'], look: [[156, 6]], cones: ['sb1', 'hf2'],
      say: 'The four crawl east along the verge behind the hedges. The gantry sentry and the headframe sentry look north over the line, but a man lying 25 m off is beyond their near band.' },
    // B · the coal train
    { cp: 'B1', who: 'sapper', look: [[156.6, 14.6], 'coal_train'], cones: [],
      say: 'The moment the train\'s tail is past, all four cross the rails; the Sapper cuts the chain-link fence and they slip through behind the last coal wagon.' },
    // C · the rifle
    { cp: 'C1', who: 'driver', look: ['lr2'], cones: ['lr2'],
      say: 'lr2 halts at the lamp room\'s corner and looks east. Twelve metres away, with nobody within twenty paces, the Driver kneels and fires once. The office hides the body from the chief\'s door.',
      beats: [{ on: 'kill:lr2', look: ['lr2'], shot: true, hold: 1.5 }] },
    // D · the office
    { cp: 'D1', who: 'greenberet', look: ['of1'], cones: ['of1', 'lt'],
      say: 'With the chief away at the baths, the Green Beret crawls down the office\'s east side and comes at the door sentry from the side he never looks: one blow, then the cuffs.' },
    { cp: 'D2', who: 'greenberet', look: ['of1'], cones: [],
      say: 'He carries him behind the office, where no cone reaches.' },
    { cp: 'D3', who: 'greenberet', look: ['archive'], cones: ['lt'],
      say: 'Into the office: the bearing archive. The chief can no longer throw it down the shaft.' },
    // E · the chief and tl1
    { cp: 'E1', who: 'greenberet', look: ['lt'], cones: ['lt', 'tl1'],
      say: 'The Green Beret lies in the yard south-east of the door, out of the chief\'s near band as he comes back. At the door the chief looks north at the office for a minute: the blow comes from behind, and he joins his sentry behind the office.' },
    { cp: 'E2', who: 'greenberet', look: ['tl1'], cones: ['tl1'],
      say: 'tl1 looks west along the baths. From his back, between the lorries: one blow, the cuffs.' },
    // F · the charges
    { cp: 'F1', who: 'sapper', look: ['lorry_a', 'lorry_b'], cones: ['hf1'],
      say: 'The Sapper sets a remote charge at the nose of each DF lorry, timed between the headframe sentry\'s sweeps.' },
    // G · the wagon
    { cp: 'G1', who: ['driver', 'sniper'], look: [[144, 54]], cones: ['y1', 'y2'],
      say: 'The Driver and the Sniper come down from the fence; the team gathers by the lorries.' },
    { cp: 'G2', who: 'greenberet', look: ['wag_p2'], cones: ['y1', 'y2'],
      say: 'While the slurry walkers pace west, backs turned, the Green Beret pushes the spoil wagon east along the tramway; the others crawl in its lee.' },
    // H · the winding house
    { cp: 'H1', who: 'greenberet', look: ['w1'], cones: ['w1', 'hp1'],
      say: 'Behind the house\'s west end, hidden from the winchman\'s whole walk. He steps from his drum into the south door, in the house\'s shadow: one blow from behind, the cuffs.' },
    { cp: 'H2', who: 'greenberet', look: ['wh1'], cones: ['hp1'],
      say: 'The corner sentry looks east over the incline\'s foot. From behind, along the wall.' },
    // I · the incline
    { cp: 'I1', who: ['driver', 'sapper', 'sniper'], look: ['incline'], cones: ['hp1'],
      say: 'Three men crawl into the skip at the foot and lie low: its sides hide them. The Green Beret lies south of the winch, in sight of the door and of the drum.' },
    { cp: 'I2', who: 'greenberet', look: ['w1', 'incline'], cones: ['hp1'],
      say: 'On strings, the winchman stands up, walks to his drum and works it. The rim sentry sees a winchman sending up a skip, which happens all day. The skip climbs the heap with three men in it.' },
    // J · the top
    { cp: 'J1', who: 'driver', look: ['hp1'], cones: ['hp1'],
      say: 'The skip stops behind the rim sentry. The Driver steps out and coshes him.' },
    { cp: 'J2', who: 'greenberet', look: [[186.5, 54]], cones: [],
      say: 'With the rim sentry down, the Green Beret climbs the rain gully on the heap\'s south flank and cuffs him.' },
    { cp: 'J3', who: 'driver', look: ['df1'], cones: ['df1'],
      say: 'The DF operator at his set by the hut door: from behind, the blackjack; the Green Beret cuffs him.' },
    { cp: 'J4', who: 'sapper', look: ['df_hut'], cones: [],
      say: 'The third remote charge goes against the DF hut, under its loop aerial.' },
    // K · out
    { cp: 'K1', who: ['greenberet', 'driver', 'sapper', 'sniper'], look: [[196, 40]], cones: [],
      say: 'Down the path on the heap\'s far side, into the pocket by the woods.' },
    { cp: 'K2', who: 'sapper', look: ['lorry_b', 'df_hut'], cones: [],
      say: 'One press for each charge: both DF lorries, then the DF hut. Mission complete.',
      beats: [{ on: 'objective:o3', look: ['lorry_a', 'lorry_b'], shot: true, hold: 2 }, { on: 'objective:o2', look: ['df_hut'], shot: true, hold: 2 }] },
  ],
};
