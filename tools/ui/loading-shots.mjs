/**
 * The loading-card stills' framings (tools/ui/bake_mission_stills.mjs, camera in tools/ui/still-camera.js): one shot
 * per mission on its signature spot, and one wide shot per theatre for the B1s menu backdrop.
 *
 * at [x, z] the subject (world m), y its height above the ground there; yaw: where the camera stands, the game's
 * convention (0 = south of the subject looking north, 90 = east looking west, -90 = west looking east); pitch: degrees
 * below horizontal (the game is 40°); dist: metres to the subject; fov: vertical degrees; frame [sx, sy]: lens shift
 * (the subject's screen offset in half-frames, +x right, +y up); fog {near, far} m from the camera (or false);
 * advance: sim seconds before the shot (smoke, water, settled props); grade: per-shot grade tweaks (grade_stills.py).
 * @module tools/ui/loading-shots
 */

/** Loading card print: 378 × 300 r (styles/menus-screens.css .mk-brphoto), so 1.26:1. */
export const MISSION_SIZE = [1260, 1000];
/** B1s backdrop: the menu's 16:9 stage. */
export const BACKDROP_SIZE = [1920, 1080];

export const SHOTS = {
  // Sandbox: the bascule bridge over the canal, the walled yard with its fuel tank, the barracks and its flag
  m00: { at: [50, 25], y: 2, yaw: -40, pitch: 18, dist: 60, fov: 30 },
  // Baptism of Fire: the relay mast and its hut on the fjord shore, the camp's cabins, the frozen fjord behind
  m01: { at: [14, 10], y: 5, yaw: -150, pitch: 16, dist: 56, fov: 32, frame: [0, -0.08] },
  // A Quiet Blow-Up: the fuel tank wagons in the stockade, the MG tower and the flag
  m02: { at: [53.4, 30], y: 2, yaw: -50, pitch: 16, dist: 52, fov: 30, frame: [0, 0.08] },
  // the Sysendam arch dam from downstream, three-quarter from the south-west: spillway, the west stair, the reservoir
  m03: { at: [40, 24], y: 5, yaw: -18, pitch: 18, dist: 72, fov: 30, frame: [0, 0.15] },
  // Restore Pride: the Stokkan villa through the gate arch, the statue, the fjord and the pier behind
  m04: { at: [78, 30], y: 5, yaw: 20, pitch: 18, dist: 58, fov: 30, frame: [-0.05, 0.05] },
  // Blind Justice: the Wurzburg radar, its generator hut and the autogyro on the summit (ya: the summit is a mesh
  // above the terrain), the windsock and the top station
  m05: { at: [86, 30], ya: 19, yaw: 120, pitch: 14, dist: 46, fov: 32, frame: [0.05, -0.08] },
  // the Leopold railway gun on its spur, barrel across the frame; the water tower and the depot behind
  m06: { at: [110, 66], y: 3, yaw: 70, pitch: 18, dist: 55, fov: 30 },
  // Chase of the Wolves: the two U-boats at the Arendal pen, the lighthouse, the fishing fleet and the town
  m07: { at: [32, 148], y: 2, yaw: -78, pitch: 15, dist: 66, fov: 30, frame: [-0.12, -0.1] },
  // Pyrotechnics: the fuel depot (tanks with their sentries, the reservoir, the tanker), palms, the domed HQ
  m08: { at: [60, 62], y: 2, yaw: 45, pitch: 18, dist: 65, fov: 30 },
  // A Courtesy Call: the Wurzburg dish of the listening post, the camp behind its wall, the Panzer shed beyond
  m09: { at: [75, 72], y: 4, yaw: 30, pitch: 19, dist: 46, fov: 30, frame: [0, -0.2] },
  // Operation Icarus: the Ju 52 and the Stukas on the airstrip, the windsock, the camp behind the wire
  m10: { at: [96, 30], y: 3, yaw: 140, pitch: 16, dist: 60, fov: 30 },
  // In the Soup: the oil derrick, its tanks and tanker, the far derricks and the escarpment
  m11: { at: [28, 86], y: 7, yaw: -35, pitch: 14, dist: 60, fov: 32 },
  // Up on the Roof: the minaret and the domed mosque over the harbour, the medina beyond
  m12: { at: [28, 80], y: 12, yaw: 45, pitch: 14, dist: 60, fov: 32 },
  // David and Goliath: the battleship's bow three-quarter, her turrets, the dock crane, the harbour
  m13: { at: [40, 22], y: 5, yaw: -125, pitch: 14, dist: 68, fov: 30, frame: [-0.08, 0.05] },
  // D-Day Kick Off: the casemate gun over the beach, hedgehogs and tetrahedra, the farmhouse behind
  m14: { at: [90, 99.5], y: 2, yaw: 65, pitch: 13, dist: 48, fov: 30 },
  // The End of the Butcher: the mansion HQ's facade, the staff car, the yard patrol, the domed townhouse
  m15: { at: [61, 64], y: 6, yaw: 90, pitch: 14, dist: 55, fov: 30 },
  // Stop Wildfire: the truss bridge across the river in summer, the island and its jetty, the town
  m16: { at: [58.6, 81.25], y: 4, yaw: 20, pitch: 14, dist: 90, fov: 30 },
  // Before Dawn: the wire pen and its prisoners, the pillbox, the watchtowers
  m17: { at: [63.7, 97], y: 1.5, yaw: 150, pitch: 20, dist: 50, fov: 30 },
  // The Force of Circumstance: the same bridge in frost, low on its centre span: the island's sandbagged MG nests,
  // the river into the mist
  m18: { at: [58.6, 81.25], y: 6, yaw: -30, pitch: 10, dist: 55, fov: 32 },
  // Frustrate Retaliation: the three V-2s on their pads and gantries, the river behind
  m19: { at: [130, 40], y: 8, yaw: 0, pitch: 12, dist: 55, fov: 32, frame: [0, -0.1] },
  // Operation Valhalla: the chateau HQ on its rock terrace
  m20: { at: [20, 52], ya: 18, yaw: 28, pitch: 11, dist: 100, fov: 30, frame: [0, -0.05] },
};

/**
 * B1s backdrops: a wide establishing shot of one map per theatre (the menu's filmic grade goes on top). No people: the
 * menu's ground fight (src/ui/menu-ground.js) brings its own soldiers into these scenes.
 */
export const THEATRES = {
  snow: { mission: 'm07', at: [35, 150], y: 2, yaw: -70, pitch: 14, dist: 95, fov: 30, frame: [0, -0.15], people: false },
  temperate: { mission: 'm16', at: [58.6, 81.25], y: 4, yaw: -30, pitch: 12, dist: 120, fov: 30, people: false },
  desert: { mission: 'm11', at: [40, 80], y: 5, yaw: -35, pitch: 12, dist: 100, fov: 30, people: false },
  coast: { mission: 'm13', at: [50, 25], y: 5, yaw: -130, pitch: 12, dist: 110, fov: 30, people: false },
};
