/**
 * Walkthrough of the LIGHTS OUT e06 solution (tools/solutions/e06.solution.mjs) for debug VIDEO MODE
 * (src/debug/walkthrough.js): chapters per stage, one narration step per checkpoint, camera and cone cues.
 * Format: docs/walkthrough-format.md.
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'e06',
  title: 'Thin Ice',
  intro: 'Fährhafen Lütjenbrook, a train-ferry port on the Holstein coast, January 1945, at dusk. Lower the raised link-span, push the sealed wagon over it into the harbour and put out the searchlight tower at the harbour mouth; then everyone leaves over the sea ice. Nobody sees the team and no alarm sounds.',
  chapters: [
    { id: 'A', title: 'Under the ice-breaker\'s channel', say: 'The Marine goes round the fishing village, dives into the channel the ice-breaker has cut and climbs the searchlight tower out of the water. The others crawl the basin ice: a man lying beyond a guard\'s near band is not seen.' },
    { id: 'B', title: 'The span cabin', say: 'The span master works the link-span from his cabin. Its door sentry looks down the berth\'s east edge; the span master looks out of his window at the span.' },
    { id: 'C', title: 'Grethe\'s small talk', say: 'In her signals auxiliary\'s uniform Grethe is one of the staff. A man answering her question does not see who walks up behind him.' },
    { id: 'D', title: 'The escort and the shunting engine', say: 'Two Feldgendarmes stand either side of the sealed wagon, backs to it. Behind it the shunting engine waits with its driver asleep in the cab: on the berth\'s alarm he would pull the wagon inland.' },
    { id: 'E', title: 'The push', say: 'With the span down and nobody left to see, the Driver pushes the wagon north up the berth track, over the span and off its end.' },
    { id: 'F', title: 'Over the sea ice (all objectives)', say: 'Everyone crawls over the east mole beyond its walker\'s beat and out between the mines frozen into the sea ice to the boats at the ice edge.' },
  ],
  steps: [
    // A · the channel, the tower, the basin ice
    { cp: 'A1', who: 'diver', look: [[8, 30]], cones: ['v2', 'wm1'],
      say: 'The Marine crawls west round the village and up the shore past the net sheds, out onto the sea ice behind the west mole.' },
    { cp: 'A2', who: 'diver', look: [[82, 6]], cones: ['wm2', 'wm3'],
      say: 'He crawls east over the sea ice, far beyond the mole walkers\' near band, to the edge of the channel the ice-breaker keeps open.' },
    { cp: 'A3', who: 'diver', look: [[95, 28]], cones: ['wm3'],
      say: 'In the shallows he dives and swims down the black channel to the foot of the searchlight tower.' },
    { cp: 'A4', who: 'diver', look: ['sl_tower'], cones: ['sl1', 'sl2'],
      say: 'The tower stands at the channel\'s edge; its iron ladder comes straight out of the water. Its crew look out to sea.' },
    { cp: 'A5', who: 'diver', look: ['sl1', 'sl2'], cones: ['sl1', 'sl2'],
      say: 'On the deck the Marine knifes the crew one after the other, before either can see the first lying there. The searchlight tower is out.',
      beats: [{ on: 'kill:sl1', look: ['sl1'], hold: 1 }] },
    { cp: 'A6', who: 'diver', look: [[98, 30]], cones: ['em1'],
      say: 'Back down the ladder onto the mole\'s end.' },
    { cp: 'A7', who: 'diver', look: [[164, 6]], cones: ['em1'],
      say: 'He crawls away over the sea ice to lie near the boats at the ice edge, well out of the mole walker\'s sight.' },
    { cp: 'A8', who: 'sapper', look: [[138, 42]], cones: ['tug_mg', 'cr1'],
      say: 'The Sapper follows the others over the basin ice and under the crane, and lies on the basin\'s east half.' },
    { cp: 'A9', who: ['driver', 'spy'], look: [[92, 46]], cones: ['v1', 'q1', 'tw1'],
      say: 'The Driver and the Spy crawl the same way over the basin ice to the ice-breaker\'s lead. Grethe walks openly along the quay: a signals auxiliary going on shift.' },
    { cp: 'A10', who: ['driver', 'spy'], look: [[140, 42]], cones: ['cr1', 'sp1'],
      say: 'Under the crane along the quay\'s foot: its sentry looks down the quay road. Then out over the basin\'s east half, beyond the span sentry\'s near band.' },
    // B · the cabin
    { cp: 'B1', who: ['driver', 'spy'], look: ['b1'], cones: ['b1', 'e3'],
      say: 'Round the end of the slip and down the berth\'s east edge behind the door sentry. When the track\'s walker has turned south, the Driver coshes him; the Spy cuffs him and he is carried inside.' },
    { cp: 'B2', who: 'spy', look: ['k1'], cones: [],
      say: 'In at the door behind the span master, who is looking out of his window at the span: chloroform, then the cuffs. He will not raise it again.' },
    { cp: 'B3', who: 'driver', look: ['span', 'b1'], cones: [],
      say: 'On puppet strings the door sentry stands up, walks to the switch and lowers the link-span. Nobody wonders at a sentry working a switch.' },
    // C · Grethe
    { cp: 'C1', who: ['grethe', 'driver'], look: ['e3'], cones: ['e3', 'sp1'],
      say: 'Grethe waits on the quay. When the berth track\'s walker comes up to the span she asks him the way: he turns to her, and the Driver coshes him from behind. He is carried off the rails.' },
    { cp: 'C2', who: ['grethe', 'driver'], look: ['sp1'], cones: ['sp1'],
      say: 'Then the span sentry: Grethe asks him for a light, he turns his back on the berth, and the Driver comes up behind him.' },
    // D · the escort and the engine
    { cp: 'D1', who: ['driver', 'spy'], look: ['e1'], cones: ['e1', 'e2'],
      say: 'Down the berth track on their bellies to the sealed wagon. The Feldgendarm at its west side looks over the sidings: from behind, between him and the wagon. The Spy cuffs him and takes his sergeant\'s tunic.' },
    { cp: 'D2', who: 'driver', look: ['e2'], cones: ['e2'],
      say: 'Round the wagon\'s north end to the other Feldgendarm, who looks out over the berth\'s east edge.' },
    { cp: 'D3', who: ['driver', 'spy'], look: ['shunter', 'sh1'], cones: ['sh2'],
      say: 'The engine\'s sentry looks south down the track: coshed from behind. The engine driver dozes in his cab; the Spy chloroforms him and cuffs him. The engine cannot pull out now.' },
    // E · the push
    { cp: 'E1', who: 'driver', look: ['wag_n'], cones: ['cr1'],
      say: 'The Driver puts his shoulder to the wagon\'s south end and pushes it north up the berth track. The goods shed hides it from the crane.' },
    { cp: 'E2', who: 'driver', look: ['span'], cones: [],
      say: 'Over the lowered span and off its end: the last of Referat N\'s hardware goes through the ice to the bottom of the harbour.',
      beats: [{ on: 'objective:o1', look: ['span'], shot: true, hold: 2 }] },
    // F · out
    { cp: 'F1', who: ['driver', 'spy', 'grethe', 'sapper'], look: [[178, 26]], cones: ['em1'],
      say: 'Up the berth\'s east edge and over the east mole beyond its walker\'s beat, on their bellies; Grethe walks.' },
    { cp: 'F2', who: ['driver', 'spy', 'grethe', 'sapper', 'diver'], look: [[174, 8]], cones: [],
      say: 'Between the mines frozen into the sea ice to the boats at the ice edge. Mission complete.' },
  ],
};
