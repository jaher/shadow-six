/**
 * Loading-screen field tips (docs/menus-art-direction.md S14): typed index cards, tagged by theatre and mission so
 * the tip is relevant (snow footprints on snow missions…). All text is our own, written from the design spec's
 * rules (§3–§5), never copied from the original manual.
 * @module ui/tips
 */

const T = (id, text, tags = {}) => ({ id, text, ...tags });
const SNOW = { theaters: ['snow'] }, SAND = { theaters: ['desert'] }, NIGHT = { theaters: ['night'] };

export const TIPS = [
  T('cone-bands', 'A sentry\'s vision cone has two bands. In the near band he sees you crawling; in the far band only a standing man gets noticed.'),
  T('crawl', 'Lie down (C) to slip through the far band of a cone. Crawling is slow, but it is quiet.'),
  T('eye', 'Click the eye, then an enemy, to see his vision cone. Shift shows the cone of whoever watches the spot under the cursor.'),
  T('bodies', 'A body left in the open will be found. Carry it behind a wall, into a building or out of every patrol\'s path.'),
  T('alarm', 'When the siren sounds, reinforcements leave the barracks. Stay hidden until the patrols go back to their posts.'),
  T('quicksave', 'Save often. Ctrl+S or F8 quick-saves; Ctrl+L or F9 brings you back.'),
  T('knife', 'The Green Beret\'s knife is silent. Approach from behind and outside the cone.'),
  T('decoy', 'The Green Beret\'s decoy beeps. A guard who hears it turns to look, and his back is yours.'),
  T('dig', 'On sand or snow the Green Beret can dig in and wait under the surface while a patrol walks over him.'),
  T('sniper', 'The Sniper carries few rounds. Save them for the man nobody else can reach: a tower sentry or an officer.'),
  T('diver', 'The Marine swims under the surface and paddles the inflatable raft. Water is his road.'),
  T('sapper-bomb', 'The Sapper\'s time bomb gives you a count to get clear. The remote charge waits for your word.'),
  T('sapper-cutters', 'Wire cutters open a fence silently. Guards notice a cut fence only if they walk past it.'),
  T('driver', 'The Driver can use any vehicle and man a machine-gun nest. A truck at speed is a weapon too.'),
  T('spy', 'In uniform the Spy walks past soldiers. Officers and anyone who sees him act suspiciously will see through it.'),
  T('spy-distract', 'The Spy can distract a soldier face to face. While they talk, the guard looks only at him.'),
  T('first-aid', 'Wounded men recover with a first-aid kit. Keep one where the fighting is.'),
  T('noise', 'Shots are heard. A pistol draws the nearby guards; a rifle carries much further.'),
  T('pistol-last', 'Gunfire is the last resort. Every shot is a noise the whole area can hear.'),
  T('pause', 'Press P to pause and think. Faithful rules: no orders while paused (Options can change that).'),
  T('notes', 'Ctrl+B opens the Briefing Notes: date, place and your orders, ticked off as you complete them.'),
  T('extraction', 'The mission ends only when every surviving man reaches the extraction point.'),
  T('groups', 'Drag a box to select several men, or Ctrl-click their portraits. A group moves in formation.'),
  T('double-click', 'Double-click to run. Running is fast and noisy on hard ground.'),
  T('portraits', 'A blue glow on a portrait means that man has been seen. Red means he is under fire or held at gunpoint.'),
  T('views', 'Split the screen with the camera keys to watch two places at once.'),
  T('barrels', 'An explosive drum can be carried and set down. One shot and it takes everything around it, and any drum nearby.'),
  T('dogs', 'Dogs smell you through walls of grass and bark at what they find.'),
  T('officers', 'Officers wander, and they notice the details soldiers miss.'),
  T('vehicles-seen', 'A vehicle crew sees you too. Engines are loud: you will hear a patrol truck before you see it.'),
  T('bushes', 'Thick trees and walls block sight completely; low walls and crates only hide a man lying down.'),
  T('roofs', 'A guard on a tower sees over low walls and crates. Stay out of his cone, even when you crawl.'),
  T('water-cold', 'Bodies dropped into deep water are gone for good. No patrol will find them there.'),
  T('rank', 'Faster missions with less damage earn stars. Stars earn rank; rank opens the last operation.'),
  T('password', 'Every mission you finish gives a five-character password. Write it down: it reopens the campaign from there.'),
  T('replay', 'Play a finished mission again to earn the stars you missed. Gold stars are re-credited on replay.'),
  T('hold', 'A guard holding a man at gunpoint is distracted too. The others can reach him while he talks.'),
  T('captured', 'A captured man is walked to the cells. Free him before the door closes behind him.'),
  T('lure', 'Guards investigate what they hear, then walk back to their post. Time your move to the walk back.'),
  T('routes', 'Watch a patrol for one full round before you move. Every route repeats.'),
  // theatre / mission specific
  T('snow-steps', 'On snow your men leave footprints. A guard who finds a trail will follow it.', SNOW),
  T('snow-trail', 'Walk where the snow is already trodden, on roads and paths, and your trail disappears among theirs.', SNOW),
  T('snow-cold', 'Snow muffles steps but shows everything. Plan the route before the first man moves.', SNOW),
  T('snow-dig', 'The Green Beret can dig into snow as well as sand. A dug-in man leaves no silhouette.', SNOW),
  T('sand-steps', 'Sand keeps footprints too. The desert wind is slow to cover them.', SAND),
  T('sand-heat', 'In the desert, the long sight lines favour the guards. Use dunes and tents as walls.', SAND),
  T('sand-vehicles', 'Desert patrols move by truck and armoured car. Their engines give them away early.', SAND),
  T('night-cones', 'At night the cones are shorter. Searchlights are not.', NIGHT),
  T('night-lights', 'A searchlight sees you in both bands. Cross its path only when it has swept past.', NIGHT),
  T('m01-relay', 'Sola: the Green Beret and the Driver begin apart. Bring them together before you strike the relay station.', { missions: ['m01'] }),
  T('m01-truck', 'Sola: the truck is your ride home. Keep it intact.', { missions: ['m01'] }),
  T('m02-boat', 'Lofoten: the patrol boat is heard long before it is seen. Let it pass.', { missions: ['m02'] }),
  T('m02-fuel', 'Lofoten: one charge in the right place is worth three in the wrong one.', { missions: ['m02'] }),
  T('m03-dam', 'Sysen: the dam and the bunker must fall together. Place every charge before you set any off.', { missions: ['m03'] }),
  T('m00-sandbox', 'Sandbox: try every tool here. Nothing you do on this ground counts against your career.', { missions: ['m00'] }),
];

/** Tip ids already shown this session and before (localStorage), so unseen tips come first. */
export const SEEN_KEY = 'shadowsix.tips.seen.v1';

export function loadSeen(storage = globalThis.localStorage) {
  try {
    return new Set(JSON.parse(storage?.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function markSeen(seen, id, storage = globalThis.localStorage) {
  seen.add(id);
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch { /* ignore */ }
}
