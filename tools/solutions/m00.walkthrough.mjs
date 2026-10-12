/**
 * Walkthrough of the M00 sandbox solution (tools/solutions/m00.solution.mjs) for debug VIDEO MODE: one chapter per
 * stage, one narration step per checkpoint, camera and cone cues. Format: docs/walkthrough-format.md (v1).
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'm00',
  title: 'Sandbox',
  intro: 'Training ground. Cross the river, blow the fuel depot inside the walled compound and bring all three commandos to the extraction point in the north-west, without ever being seen.',
  chapters: [
    { id: 'A', title: 'Through the wall gap', say: 'The compound has one way in, the gap at the end of the bridge. Through it the Sniper can reach the officer and the patrol inside.' },
    { id: 'B', title: 'A trap on the road', say: 'A patrol walks the road on this bank up to the bridge. He must go without a sound, and where the bridge sentry cannot see him fall.' },
    { id: 'C', title: 'The bridge sentry', say: 'The bridge sentry sweeps the whole bridge every two seconds: nobody crosses while he stands.' },
    { id: 'D', title: 'The depot guard', say: 'One guard is left, by the fuel depot, staring at the west wall.' },
    { id: 'E', title: 'The depot (objective)', say: 'Nobody is left to see or hear: the Sapper blows the depot and the team heads for the extraction point.' },
  ],
  steps: [
    // A · through the wall gap
    { cp: 'A1', who: 'sniper', look: ['sentry_bridge'], cones: ['sentry_bridge', 'patrol_west'],
      say: 'All three drop prone. The Sniper crawls to the river bank south of the bridge, unseen in the sentry\'s far band. He stays 42 m from the officer: kneeling to fire counts as standing, and from there nobody inside can see him.' },
    { cp: 'A2', who: 'sniper', look: ['officer'], cones: ['officer', 'patrol_east', 'sentry_bridge'],
      say: 'He has the officer in his sights but waits: the compound patrol, walking north, would see the body. He fires as the patrol turns south into the line of fire through the gap, his back to the officer, with nobody looking at the bank.',
      beats: [{ on: 'kill:officer', look: ['officer'], shot: true, hold: 2 }] },
    { cp: 'A3', who: 'sniper', look: ['patrol_east'], cones: ['patrol_east', 'guard_fuel'],
      say: 'A second later, with the bolt worked, he drops the patrol too, before he could ever turn round. Nobody sees either man fall or either body. Then the Sniper crawls nine metres up the bank, to a spot that sees the bridge sentry.',
      beats: [{ on: 'kill:patrol_east', look: ['patrol_east'], shot: true, hold: 2 }] },
    // B · a trap on the road
    { cp: 'B1', who: 'sapper', look: ['patrol_west'], cones: ['patrol_west'],
      say: 'The Sapper crawls north, out of the road patrol\'s sight, to a nook behind the roadside bush where the patrol never looks.' },
    { cp: 'B2', who: 'sapper', look: ['patrol_west'], cones: ['patrol_west'],
      say: 'As the patrol walks away east, the Sapper crawls out to the road, sets his bear trap just short of the patrol\'s turning point and crawls back.',
      beats: [{ on: 'sapper:trap', look: ['sapper', 'patrol_west'] }] },
    // C · the bridge sentry
    { cp: 'C1', who: 'sniper', look: ['sentry_bridge', 'patrol_west'], cones: ['sentry_bridge', 'guard_fuel', 'patrol_west'],
      say: 'The Sniper fires once the road patrol has turned west, his back to the bridge, at a moment when neither the sentry nor the depot guard looks his way: kneeling to aim, he would be seen.',
      beats: [{ on: 'kill:sentry_bridge', look: ['sentry_bridge'], shot: true, hold: 2 }] },
    { cp: 'C2', look: ['patrol_west'], cones: ['patrol_west'],
      say: 'The road patrol walks back west, never turning round, and steps into the bear trap. Nobody is left to see the bridge.' },
    // D · the depot guard
    { cp: 'D1', who: 'greenberet', look: ['guard_fuel'], cones: ['guard_fuel'],
      say: 'The Green Beret crawls over the bridge and through the gap, round the far side of the depot and into the strip between it and the guard, where the guard\'s sweeping gaze never reaches. Lying at his back, he stands up and knifes him.' },
    // E · the depot
    { cp: 'E1', who: 'sapper', look: ['fuel_depot'], cones: [],
      say: 'The Sapper walks in and sets a time bomb against the depot: ten seconds. The Sniper and the Green Beret are already on their way to the extraction point.',
      beats: [{ on: 'sapper:timeBomb', look: ['fuel_depot', 'sapper'] }] },
    { cp: 'E2', who: 'sapper', look: ['fuel_depot'], cones: [],
      say: 'He runs back over the bridge. The depot goes up behind him: with every guard down, nobody raises the alarm.',
      beats: [{ on: 'objective:destroy_fuel', look: ['fuel_depot'], shot: true, hold: 3 }] },
    { cp: 'E3', who: ['sapper', 'sniper', 'greenberet'], look: [[6, 7]], cones: [],
      say: 'All three reach the extraction point in the north-west: mission complete.' },
  ],
  outro: 'Mission complete: the fuel depot destroyed, all three commandos home, never seen.',
};
