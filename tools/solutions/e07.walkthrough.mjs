/**
 * Walkthrough of the LIGHTS OUT e07 solution (tools/solutions/e07.solution.mjs) for debug VIDEO MODE
 * (src/debug/walkthrough.js): chapters per stage, one narration step per checkpoint, camera and cone cues.
 * Format: docs/walkthrough-format.md. Stage B runs three threads at once; its steps follow the order of its checkpoints
 * in the solution's source (in play the Spy's B8 may come before or after the packs' B7).
 */
const TEAM = ['greenberet', 'driver', 'sapper', 'spy', 'sniper'];
const SKI = ['sk1', 'sk2', 'sk3'];

export const WALKTHROUGH = {
  version: 1,
  mission: 'e07',
  title: 'White Out',
  intro: 'The Hochjoch pass, March 1945, the morning after a storm. Find the drop container, take the press plates and Major Vering, bring the cornice down on the north road and leave by the goods cable car. Nobody sees the team; no alarm is ever raised.',
  chapters: [
    { id: 'A', title: 'The ridge', say: 'Two sentries on the ridge look down on everything the team must cross: one over the cable and the lower station, one walking the path above the cliff foot.' },
    { id: 'B', title: 'Station, packs, plates and cornice', say: 'Three threads at once: the lower station and a private\'s tunic, the two packs from the container, the press lorry\'s plates, and a charge under the cornice.' },
    { id: 'C', title: 'Major Vering', say: 'Vering works at his desk on the sun terrace with his adjutant at his elbow, both facing the hotel. A private walking up the station lane is nobody to them.' },
    { id: 'D', title: 'Up to the ridge', say: 'The Major is aboard the cabin. The team gathers behind the dock, the cornice comes down on the north road, and the cable car climbs to the ridge.' },
  ],
  steps: [
    // A · the ridge
    { cp: 'A0', who: TEAM, look: ['lower_station'], cones: [],
      say: 'The team lies up in the drop-zone rocks south of the tarn, out of every cone. The Sniper goes first, flat on the snow.' },
    { cp: 'A1', who: 'sniper', look: ['rs1'], cones: ['rs1'],
      say: 'Round the tarn on his belly to a nest in its rocks: nobody below looks there, and the ridge dock sentry rs1 is in range.' },
    { cp: 'A2', who: 'sniper', look: ['rs1'], cones: ['rs1'],
      say: 'rs1 watches the cable and the cliff foot behind the dock. One round from the tarn; the upper station hides his body from the ridge path.',
      beats: [{ on: 'kill:rs1', look: ['rs1'], shot: true, hold: 1.5 }] },
    { cp: 'A3', who: 'sniper', look: ['op2'], cones: ['op2', ...SKI],
      say: 'With rs1 gone nobody watches the cliff foot behind the dock. The Sniper crawls up it to a nest under the ridge path.' },
    { cp: 'A4', who: 'sniper', look: ['op2'], cones: ['op2'],
      say: 'op2 paces the path along the lip. He falls walking north, his back to the Sniper, where nobody looks along the path.',
      beats: [{ on: 'kill:op2', look: ['op2'], shot: true, hold: 1.5 }] },
    // B · the station, the packs, the plates, the cornice
    { cp: 'B1', who: 'greenberet', look: ['cs2'], cones: ['cs2', 'cs1'],
      say: 'The Green Beret crawls round the tarn to the cable\'s foot, behind the dock sentry cs2, who watches the lane up from the lorries.' },
    { cp: 'B2', who: 'greenberet', look: ['cs2', 'lower_station'], cones: ['cs2', 'cs1'],
      say: 'From behind: fists, then the cuffs. He carries cs2 through the engine-room door into the lower station, out of every eye.' },
    { cp: 'B3', who: 'spy', look: ['cablecar'], cones: [],
      say: 'The Spy follows round the tarn to the cable\'s foot and waits behind the cabin.' },
    { cp: 'B4', who: ['sapper', 'driver'], look: ['knap_sap'], cones: SKI,
      say: 'The Sapper and the Driver crawl past the dock and up the cliff foot to holds under the ridge path, below the lookouts\' notice and off the ski patrol\'s loop.' },
    { cp: 'B5', who: 'greenberet', look: ['cs1'], cones: ['cs1'],
      say: 'The operator cs1 faces his controls, his back to the dock: fists and cuffs. The Spy takes his tunic, and cs1 is laid behind the dock, where the station hides him.' },
    { cp: 'B6', who: 'spy', look: ['cablecar'], cones: [],
      say: 'Where nobody looks, the Spy puts on the operator\'s tunic. To the privates he is one of them now.' },
    { cp: 'B7', who: ['sapper', 'driver'], look: ['knap_sap', 'knap_drv'], cones: SKI,
      say: 'When the ski patrol has gone round, each man crawls to the container and takes his own pack, the Sapper\'s charges and the Driver\'s rifle, then crawls back to his hold.' },
    { cp: 'B8', who: 'spy', look: ['pf1', 'lorry_press'], cones: ['pf1', 'pr1'],
      say: 'In the tunic the Spy walks round the lorries\' cabs to the back of the Feldwebel pf1, who watches the snowfield. When the carry to the tailboard will go unseen too: chloroform, cuffs, into his own lorry.' },
    { cp: 'B9', who: 'spy', look: ['pr1'], cones: ['pr1'],
      say: 'The mechanic pr1 oils the press with his back to the tailboard: chloroform and cuffs.' },
    { cp: 'B10', who: 'spy', look: [[72.6, 161.9]], cones: [],
      say: 'The Spy takes the type plates. Whatever alarm comes now, the Feldwebel\'s hammer has nothing left to smash.',
      beats: [{ on: 'objective:o2', look: [[72.6, 161.9]], hold: 1.5 }] },
    { cp: 'B11', who: 'spy', look: ['lorry_press'], cones: [],
      say: 'The mechanic goes into the back of the lorry with his Feldwebel.' },
    { cp: 'B12', who: 'sapper', look: ['cornice_bank'], cones: [...SKI, 'op1'],
      say: 'Behind the ski patrol\'s file the Sapper crawls up the snowfield to the cornice above the avalanche gallery and sets a remote charge at its foot.' },
    { cp: 'B13', who: 'sapper', look: ['knap_sap'], cones: SKI,
      say: 'Back down the snowfield to his hold while the patrol is on its far leg. The lookouts on the ridge cannot pick out a man lying so far below them.' },
    // C · the Major
    { cp: 'C1', who: ['spy', 'greenberet'], look: ['vering', 'adj'], cones: ['vering', 'adj', 'rad'],
      say: 'Vering and his adjutant face the hotel\'s gable. The Spy walks up the station lane in his tunic to the terrace\'s side steps; the Green Beret crawls round the station to the lane.' },
    { cp: 'C2', who: 'spy', look: ['vering'], cones: ['adj'],
      say: 'From behind, at his desk: chloroform for Major Vering, then the cuffs.' },
    { cp: 'C3', who: 'spy', look: ['adj'], cones: ['adj'],
      say: 'The adjutant at the Major\'s elbow, still facing the gable: chloroform, cuffs.' },
    { cp: 'C4', who: 'greenberet', look: ['vering', 'cablecar'], cones: [],
      say: 'The adjutant stays where he fell, behind the desk, where nobody looks. When the way down is clear the Green Beret carries the Major down the terrace steps to the cable car and puts him aboard.' },
    // D · up to the ridge
    { cp: 'D1', who: TEAM, look: ['cablecar'], cones: [],
      say: 'Everyone crawls to the cable\'s foot behind the dock. Nobody is left there to see them.' },
    { cp: 'D2', who: 'sapper', look: ['cornice_bank'], shot: true, cones: [],
      say: 'The Sapper presses the detonator: the cornice breaks away and buries the avalanche gallery and the north road. The pass is closed.',
      beats: [{ on: 'objective:o3', look: ['cornice_bank'], shot: true, hold: 3 }] },
    { cp: 'D3', who: TEAM, look: ['cablecar'], cones: [],
      say: 'All five board the cabin beside the Major. It climbs the cable to the ridge station, and from there it is downhill into Italy. Mission complete.' },
  ],
};
