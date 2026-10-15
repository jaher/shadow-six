/**
 * Walkthrough of the M16 solution (tools/solutions/m16.solution.mjs) for debug VIDEO MODE (src/debug/walkthrough.js):
 * chapters per stage, one narration step per checkpoint, camera and cone cues. Format: docs/walkthrough-format.md.
 */
export const WALKTHROUGH = {
  version: 1,
  mission: 'm16',
  title: 'Stop Wildfire',
  intro: 'The Maas, 1944. Four German sappers stand ready to blow the bridge the moment anything is amiss. Kill all four before one of them reaches his plunger, then get everyone into the lorry and out by the south road.',
  chapters: [
    { id: 'A', title: 'The uniform on the clothesline', say: 'The whole map is one alarm zone. Before anything else the Spy needs the German uniform drying on a line at the east edge of the village.' },
    { id: 'B', title: 'The lorry', say: 'In uniform the Spy may drive the lorry parked by the south road. It will carry the Sniper and the Marine to the bridge.' },
    { id: 'C', title: 'Onto the bridge', say: 'The sapper e15 walks the bridge approach between two sentries. The lorry must get past him without anyone stepping out of its way.' },
    { id: 'D', title: 'Into position', say: 'From the middle of the main span all four sappers are within the Sniper\'s 45 metres, at one moment or another.' },
    { id: 'E', title: 'The strike (objective 1)', say: 'Every sapper watches another. While the Spy holds one of them, the Sniper kills the others before anyone sees a body.' },
  ],
  steps: [
    // A · the uniform
    { cp: 'A0', who: ['spy', 'sniper', 'diver'], look: [[176, 30]], cones: [],
      say: 'The Spy, the Sniper and the Marine start prone in the wood north-east of the station. The morning train is due.' },
    { cp: 'A1', who: 'spy', look: [[160, 64]], cones: [],
      say: 'The train runs down the line and kills anyone on the rails, so the team waits in the wood until it has gone by.' },
    { cp: 'A2', who: ['spy', 'sniper', 'diver'], look: [[141, 52]], zoom: 'wide',
      say: 'All three crawl west along the north edge of the map, where nobody looks, then south down the river bank inside the belt of tank obstacles.' },
    { cp: 'A3', who: 'spy', look: [[170, 124]], zoom: 'wide',
      say: 'The Sniper and the Marine wait on the bank. The Spy crawls on alone, out through a gap in the belt, over the railway when the train is away, and into the empty south-east field.' },
    { cp: 'A4', who: 'spy', look: ['uniform_line'],
      say: 'Up the east edge of the map to the clothesline. When the patrol and the walker by the houses are both away, he crawls up, stands, takes the uniform and drops flat again.' },
    { cp: 'A5', who: 'spy',
      say: 'Back down the edge to a corner nobody watches, he puts the uniform on. From now on the guards take him for one of their own.' },
    // B · the lorry
    { cp: 'B1', who: 'spy', look: ['truck'],
      say: 'In uniform he walks openly across the fields to the lorry by the south road and climbs into the cab.' },
    { cp: 'B2', who: 'spy', look: ['truck', [131.5, 74.5]], zoom: 'wide',
      say: 'He drives east, up the road and over the railway, and stops by the gap in the belt. Nobody has to step out of his way, so nobody looks twice.' },
    { cp: 'B3', who: ['sniper', 'diver'], look: ['truck', 'e23', 'e7'], cones: ['e23', 'e7'],
      say: 'The Sniper and the Marine crawl through the gap. Two walkers turn within sight of the doors, so each man climbs in only as e23 heads off south-west and e7 walks away up the road.' },
    // C · the bridge
    { cp: 'C1', who: 'spy', look: ['truck'], zoom: 'wide',
      say: 'Back down to the bridgehead, the lorry turning round south of the belt and crossing the railway when the train is away.' },
    { cp: 'C2', who: 'spy', look: ['truck', 'e15', 'e22'], cones: ['e15', 'e21', 'e22'],
      say: 'e15 walks the wide lane into the bridge mouth. The Spy follows him over the crossing as he sets off west, pulls over north of his road while he stands at the mouth, then drives past him through the narrow north lane.' },
    { cp: 'C3', who: 'spy', look: ['truck', 'e14', 'e16'],
      say: 'He drives on to the main span and stops a few metres short of the Sniper\'s firing spot, out of his lines of fire. The lorry stays there.' },
    // D · into position
    { cp: 'D1', who: 'sniper', look: ['truck'],
      say: 'The Sniper slips out of the cab. Up on the deck, behind the girders, nobody below sees a man lying down.' },
    { cp: 'D2', who: 'sniper', look: ['e14', 'e16', 'e17'], cones: ['e14', 'e16', 'e17', 'e18'],
      say: 'He crawls round the lorry and lies on the south walkway. All four sappers pass within his 45 metres from here, at one moment or another.' },
    // E · the strike
    { cp: 'E1', who: 'spy', look: ['e14', 'truck'], cones: ['e14', 'e18'],
      say: 'The Spy gets out and walks back over the bridge in his uniform: nobody looks twice at an officer. He goes down the west bank and waits under the deck, by the turn of e14\'s beat.' },
    { cp: 'E2', who: 'spy', look: ['e14'], cones: ['e14', 'e16', 'e18'],
      say: 'As e14 reaches his turn the Spy talks to him. The sapper turns to face him, with his back to the river, the island and the bridge, and stands there as long as the Spy holds him.' },
    { cp: 'E3', who: 'sniper', look: ['e18', 'e16', 'e17'], cones: ['e18', 'e16', 'e17', 'e26'], zoom: 'wide',
      say: 'The Sniper waits for a moment when nobody will see him kneel, see a man fall or find a body. The first round goes to the man whose eyes matter most, usually the sentry e18. The rifle is silent.' },
    { cp: 'E4', who: 'sniper', look: ['e16', 'e17', 'e14'], cones: ['e16', 'e17', 'e15', 'e26'], zoom: 'wide',
      say: 'Then the others, a round each, the watcher before the watched: the island pair e16 and e17, and e14 while the Spy still holds his gaze. Three charges are safe in a few seconds.' },
    { cp: 'E5', who: 'sniper', look: ['e15'], cones: ['e15', 'e21', 'e23', 'e24'],
      say: 'The fifth round goes to e15 at the far end of the bridge, the moment he walks into the Sniper\'s line, before anyone finds the bodies on the island.',
      beats: [{ on: 'kill:e15', look: ['e15'], shot: true, hold: 1.5 }, { on: 'alarm', look: ['truck'], say: 'His fall is seen and the siren sounds, but all four sappers are dead and the bridge is safe. Nobody has seen any of the team.' }] },
    { cp: 'E6', who: 'sniper', look: ['truck'],
      say: 'The Sniper crawls the few metres to the lorry\'s tailboard and climbs in beside the Marine.' },
    { cp: 'E7', who: 'spy', look: ['truck'],
      say: 'The Spy walks back up onto the bridge to the cab. All three are aboard: the mission is won, and the lorry leaves by the south road.' },
  ],
  outro: 'Mission complete: the four sappers dead, the bridge standing, the team away in the lorry. Nobody ever saw a commando; if a siren sounds at all, it is only after the last sapper has fallen.',
};
