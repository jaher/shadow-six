# SHADOW SIX

A real-time stealth tactics game in your browser: a fan remake of **Commandos: Behind Enemy Lines** (1998) built
with three.js. Six specialists, enemy vision cones, a fixed 3/4 camera and WWII missions behind enemy lines.

**▶ Play now in your browser (nothing to install): <https://jaher.github.io/shadow-six/>**

> **Fan tribute, not an official game.** SHADOW SIX is an unofficial, non-commercial fan tribute to
> *Commandos: Behind Enemy Lines* (Pyro Studios / Eidos Interactive, 1998). It is not affiliated with, endorsed
> by or connected to Pyro Studios, Eidos, Square Enix or Kalypso Media. 'Commandos' is a trademark of its owner.
> No assets from the original game are used; all art, audio and code are original or CC0/redistributable
> (see [CREDITS.md](CREDITS.md)).

| | |
| --- | --- |
| ![Title splash](docs/screenshots/menus-s03-title-splash.jpg) | ![Mission 2: the walled camp](docs/screenshots/yaw-level-m02-walled-camp-z1.jpg) |
| ![Mission 2: a boat on the river](docs/screenshots/int-water-m2-river-boat-wake.jpg) | ![The six commandos: talking portraits and their pain sheet](docs/screenshots/portrait-pain-sheet.jpg) |

## Mission reference screenshots

Reference frames from the web build: the dam breach in mission 3, a U-boat at
the pier in mission 7, the battleship at Le Havre in mission 13, and the V2
rockets on their pads in mission 19.

| Mission | Action frame | Scene frames |
|---|---|---|
| m01 — Baptism of Fire | [![Mission 1 action frame: Gameplay: patrol crossing the snowy airfield village below the relay mast, staff car parked by the houses.](verify/reference/gameplay-m01.png)](verify/reference/gameplay-m01.png) | [![Mission 1 scene: The relay mast and snow-roofed hut on the Sola airfield, Kübelwagen parked alongside.](verify/reference/scene-m01-relay-mast.png)](verify/reference/scene-m01-relay-mast.png)<br>[![Mission 1 scene: The Green Beret ashore by the inflatable raft, a sentry standing a few metres away on the icy shore.](verify/reference/scene-m01-raft-stealth.png)](verify/reference/scene-m01-raft-stealth.png) |
| m02 — A Quiet Blow-Up | [![Mission 2 action frame: ACTION: the fuel depot detonating — fireball hurling guards into the snow mid-blast.](verify/reference/gameplay-m02.png)](verify/reference/gameplay-m02.png) | [![Mission 2 scene: The patrol boat moored in the ice-choked harbour channel below the depot pier.](verify/reference/scene-m02-patrol-boat.png)](verify/reference/scene-m02-patrol-boat.png)<br>[![Mission 2 scene: Stealth approach on the fuel depot: a sentry's view cone sweeping the yard, guards reacting ("Achtung!"), commando at the cone's edge.](verify/reference/scene-m02-depot-approach.png)](verify/reference/scene-m02-depot-approach.png) |
| m03 — Reverse Engineering | [![Mission 3 action frame: ACTION: the crest charge going off on the Sysendam dam — fireball on the crest, spillway bursting, "OBJECTIVE COMPLETED: DEMOLISH THE DAM".](verify/reference/gameplay-m03.png)](verify/reference/gameplay-m03.png) | [![Mission 3 scene: The Sysendam dam intact from the lake side, the Sapper standing on the crest.](verify/reference/scene-m03-dam-intact.png)](verify/reference/scene-m03-dam-intact.png)<br>[![Mission 3 scene: The Spy working into the garrison camp below the cliffs and power lines.](verify/reference/scene-m03-camp-infiltration.png)](verify/reference/scene-m03-camp-infiltration.png) |
| m04 — Restore Pride | [![Mission 4 action frame: ACTION: the German headquarters villa exploding in the village square.](verify/reference/gameplay-m04.png)](verify/reference/gameplay-m04.png) | [![Mission 4 scene: The headquarters villa in the village square before the attack.](verify/reference/scene-m04-villa-square.png)](verify/reference/scene-m04-villa-square.png)<br>[![Mission 4 scene: A Panzer II on the shoreline road through the village, sentries nearby.](verify/reference/scene-m04-panzer-village.png)](verify/reference/scene-m04-panzer-village.png) |
| m05 — Blind Justice | [![Mission 5 action frame: Gameplay: summit building with the escape autogyro at the frame edge.](verify/reference/gameplay-m05.png)](verify/reference/gameplay-m05.png) | [![Mission 5 scene: The escape autogyro on the summit pad beside the radar-station building.](verify/reference/scene-m05-autogyro.png)](verify/reference/scene-m05-autogyro.png)<br>[![Mission 5 scene: The cable-car station with the red gondola, mid-mountain.](verify/reference/scene-m05-cable-car.png)](verify/reference/scene-m05-cable-car.png) |
| m06 — Menace of the Leopold | [![Mission 6 action frame: ACTION: the Leopold railway gun ablaze along its train after the planted charge.](verify/reference/gameplay-m06.png)](verify/reference/gameplay-m06.png) | [![Mission 6 scene: The Leopold railway gun intact on its siding by the stone tower.](verify/reference/scene-m06-leopold-intact.png)](verify/reference/scene-m06-leopold-intact.png)<br>[![Mission 6 scene: The chapel and station building under the Finnmark light, train on the siding.](verify/reference/scene-m06-chapel.png)](verify/reference/scene-m06-chapel.png) |
| m07 — Chase of the Wolves | [![Mission 7 action frame: ACTION: the first U-boat blowing up at the pier as the after-deck charge detonates.](verify/reference/gameplay-m07.png)](verify/reference/gameplay-m07.png) | [![Mission 7 scene: A U-boat moored at the snowy pier (bow and deck along the quay), the Marine on the dock, halftrack on the harbour road.](verify/reference/scene-m07-uboat-pier.png)](verify/reference/scene-m07-uboat-pier.png)<br>[![Mission 7 scene: Snowy harbour-side houses with a patrol threading between them.](verify/reference/scene-m07-harbour-village.png)](verify/reference/scene-m07-harbour-village.png) |
| m08 — Pyrotechnics | [![Mission 8 action frame: Gameplay: desert gun pit and mortar position, commando on the move, anti-tank obstacles.](verify/reference/gameplay-m08.png)](verify/reference/gameplay-m08.png) | [![Mission 8 scene: Desert gun pits: the big gun and AA position inside their walled enclosures at Tell el Eisa.](verify/reference/scene-m08-gun-pits.png)](verify/reference/scene-m08-gun-pits.png)<br>[![Mission 8 scene: The Green Beret slipping through the mud-brick village, truck parked by the houses.](verify/reference/scene-m08-desert-village.png)](verify/reference/scene-m08-desert-village.png) |
| m09 — A Courtesy Call | [![Mission 9 action frame: ACTION: the radio hut exploding inside the walled compound.](verify/reference/gameplay-m09.png)](verify/reference/gameplay-m09.png) | [![Mission 9 scene: Three Panzers parked in a row under the vehicle shed, tanker truck alongside.](verify/reference/scene-m09-tank-column.png)](verify/reference/scene-m09-tank-column.png)<br>[![Mission 9 scene: Inside the walled compound: the weapons store and command post.](verify/reference/scene-m09-walled-compound.png)](verify/reference/scene-m09-walled-compound.png) |
| m10 — Operation Icarus | [![Mission 10 action frame: ACTION: the airfield bomb store going up in a fireball.](verify/reference/gameplay-m10.png)](verify/reference/gameplay-m10.png) | [![Mission 10 scene: A Ju-52 transport on the El Agheila strip, close enough to read the fuselage codes.](verify/reference/scene-m10-ju52.png)](verify/reference/scene-m10-ju52.png)<br>[![Mission 10 scene: Two Stukas parked wingtip to wingtip on the desert airfield.](verify/reference/scene-m10-stuka-line.png)](verify/reference/scene-m10-stuka-line.png) |
| m11 — In the Soup | [![Mission 11 action frame: ACTION: a drilling rig ablaze ("DRILLING RIG DESTROYED") among the storage tanks.](verify/reference/gameplay-m11.png)](verify/reference/gameplay-m11.png) | [![Mission 11 scene: A derrick and storage tanks in the Maradah oil field.](verify/reference/scene-m11-oil-rigs.png)](verify/reference/scene-m11-oil-rigs.png)<br>[![Mission 11 scene: The western tank farm: three storage tanks under their derrick, palms at the edge of frame.](verify/reference/scene-m11-tank-farm.png)](verify/reference/scene-m11-tank-farm.png) |
| m12 — Up on the Roof | [![Mission 12 action frame: Gameplay: commandos crossing the Tunis rooftops.](verify/reference/gameplay-m12.png)](verify/reference/gameplay-m12.png) | [![Mission 12 scene: Commandos crossing the white Tunis rooftops.](verify/reference/scene-m12-rooftops.png)](verify/reference/scene-m12-rooftops.png)<br>[![Mission 12 scene: The Spy on a rooftop above a street patrol threading the medina lanes.](verify/reference/scene-m12-street-patrol.png)](verify/reference/scene-m12-street-patrol.png) |
| m13 — David and Goliath | [![Mission 13 action frame: Gameplay: the battleship at berth under the harbour crane — the Goliath at rest (deck charges did not damage it, so no blast frame).](verify/reference/gameplay-m13.png)](verify/reference/gameplay-m13.png) | [![Mission 13 scene: The battleship's bow and forward turrets at berth under the harbour crane.](verify/reference/scene-m13-battleship.png)](verify/reference/scene-m13-battleship.png)<br>[![Mission 13 scene: The submarine tied up at the pier in the harbour basin.](verify/reference/scene-m13-sub-pen.png)](verify/reference/scene-m13-sub-pen.png) |
| m14 — D-Day Kick Off | [![Mission 14 action frame: Gameplay: the beach casemate, wire and obstacles with troops ashore on Juno.](verify/reference/gameplay-m14.png)](verify/reference/gameplay-m14.png) | [![Mission 14 scene: The grass-roofed beach casemate with its garrison on the roof, wire and obstacles below.](verify/reference/scene-m14-juno-beach.png)](verify/reference/scene-m14-juno-beach.png)<br>[![Mission 14 scene: A beach-defence casemate and MG positions above the Juno shore road.](verify/reference/scene-m14-casemate.png)](verify/reference/scene-m14-casemate.png) |
| m15 — The End of the Butcher | [![Mission 15 action frame: Gameplay: commandos on the riverside street with the tram.](verify/reference/gameplay-m15.png)](verify/reference/gameplay-m15.png) | [![Mission 15 scene: The tram on the riverside street in Compiègne, the Spy watching from the pavement.](verify/reference/scene-m15-tram.png)](verify/reference/scene-m15-tram.png)<br>[![Mission 15 scene: An Sd.Kfz. half-track parked on the street as a troop column marches past.](verify/reference/scene-m15-sdkfz-street.png)](verify/reference/scene-m15-sdkfz-street.png) |
| m16 — Stop Wildfire | [![Mission 16 action frame: Gameplay: the locomotive waiting at the station by the Maas bridge line.](verify/reference/gameplay-m16.png)](verify/reference/gameplay-m16.png) | [![Mission 16 scene: The station house and platform by the Maas bridge line, squad prone in the field behind.](verify/reference/scene-m16-station.png)](verify/reference/scene-m16-station.png)<br>[![Mission 16 scene: A truck waiting at the level crossing as a patrol marches across the tracks.](verify/reference/scene-m16-rail-crossing.png)](verify/reference/scene-m16-rail-crossing.png) |
| m17 — Before Dawn | [![Mission 17 action frame: Gameplay: the squad moving up the snowy forest road, point man ringed.](verify/reference/gameplay-m17.png)](verify/reference/gameplay-m17.png) | [![Mission 17 scene: Dawn on the forest road: view cones, dialogue, and the bridge gantry ahead of the squad.](verify/reference/scene-m17-dawn-road.png)](verify/reference/scene-m17-dawn-road.png)<br>[![Mission 17 scene: The fenced prisoner pen with its guard truck, before the breakout.](verify/reference/scene-m17-prison-pen.png)](verify/reference/scene-m17-prison-pen.png) |
| m18 — The Force of Circumstance | [![Mission 18 action frame: ACTION: the Maas bridge mid-collapse into the river, charges fired at the three marked points ("THE BRIDGE IS DOWN").](verify/reference/gameplay-m18.png)](verify/reference/gameplay-m18.png) | [![Mission 18 scene: The Maas bridge intact — steel truss, island hut and the sandbagged MG post.](verify/reference/scene-m18-bridge-intact.png)](verify/reference/scene-m18-bridge-intact.png)<br>[![Mission 18 scene: The little station building with its flag and a wagon on the siding.](verify/reference/scene-m18-station.png)](verify/reference/scene-m18-station.png) |
| m19 — Frustrate Retaliation | [![Mission 19 action frame: ACTION: a V2 rocket destroyed on its launch pad, second rocket still standing alongside.](verify/reference/gameplay-m19.png)](verify/reference/gameplay-m19.png) | [![Mission 19 scene: All three V2 rockets standing on their pads between the site houses, intact.](verify/reference/scene-m19-v2-pads.png)](verify/reference/scene-m19-v2-pads.png)<br>[![Mission 19 scene: The west yard: fuel tanks and a tank hull under the workshop shed.](verify/reference/scene-m19-west-yard.png)](verify/reference/scene-m19-west-yard.png) |
| m20 — Operation Valhalla | [![Mission 20 action frame: ACTION (aftermath): the castle HQ roof blown in and still smoking after the charge.](verify/reference/gameplay-m20.png)](verify/reference/gameplay-m20.png) | [![Mission 20 scene: Gundelfingen castle intact, a commando ringed at the HQ door.](verify/reference/scene-m20-castle.png)](verify/reference/scene-m20-castle.png)<br>[![Mission 20 scene: Two V2 rockets on transport trailers in the castle courtyard, guards patrolling.](verify/reference/scene-m20-v2-site.png)](verify/reference/scene-m20-v2-site.png) |

The complete per-mission set — action frames plus non-explosion scene
references for missions 1–20 — is catalogued in
[verify/reference/README.md](verify/reference/README.md).

## What you get

- **The Behind Enemy Lines campaign**, rebuilt mission by mission from the original's 20 missions: missions 1–3
  are playable now, the rest are on the way (see [Status](#status)).
- **Six commandos with their original abilities and weapons**: the Green Beret (knife, decoy, shovel, climbing),
  Sniper, Marine (harpoon, boat, diving gear), Sapper (time and remote bombs, grenades, traps), Driver and Spy
  (uniform, lethal injection); each carries only what he had in 1998.
- **Talking portraits**: every commando speaks his lines in his own voice, with lip-synced portrait clips.
- **Newsreel briefings**: a 1940s newsreel announcer reads each mission's briefing as its words appear on screen
  (an original synthetic voice; Options → Sound → NARRATION, or N in the briefing).
- **Enemies that see and hear**: vision cones you can inspect, noise, footprints in the snow, bodies that get
  found, alarms and reinforcements.
- **A world that reacts**: snow with trails and footprints, rivers and fjords with swimmers and boat wakes, wind
  in the trees and flags, fire, smoke and explosions, physically based lighting.
- **Briefings, debriefings, quick save / load and a sandbox** to learn the controls; the *Beyond the Call of
  Duty* gadgets and units exist behind their own ruleset (sandbox only for now).

## Status

Work in progress.

- **Playable now:** missions 1 to 3 of the *Behind Enemy Lines* campaign, with realistic art: snow terrain,
  water, buildings, vehicles, animated soldiers and commandos, vision cones, alarms, the knapsack, stealth kills,
  carrying bodies, explosives, briefings, debriefings, and saving and loading.
- **Work in progress:** missions 4 to 20, the *Beyond the Call of Duty* campaign and some systems and polish.
  They are being built on separate branches and will be published as they are finished.

## System requirements

- A desktop browser with **WebGL 2**: Chrome or Edge (recommended) or Firefox; recent Safari should work but is
  less tested.
- A dedicated GPU is recommended for the High and Ultra presets; Low runs on integrated graphics.
- Mouse and keyboard. The first visit downloads the game (about 1 MB of code, then roughly 40–100 MB of models,
  textures and audio per mission, depending on the quality preset, shown by the loading bar); later visits come from the browser cache.

## Running locally

For development there is no build step: the repository root is the web root.

```sh
npm install                   # dev tools only (esbuild for the web build, playwright-core for the tests)
npm run serve                 # http://localhost:8080/  (node tools/serve.mjs [port])
```

The web build that GitHub Pages serves bundles and minifies the code and copies only the runtime assets:

```sh
npm run build                 # → dist/ (size report; fails over 950 MB or on a non-relative URL)
npm run serve:dist            # http://localhost:8080/shadow-six/, served like GitHub Pages
node tools/perf/measure-web-start.mjs   # first-visit start-up on a throttled 20 Mbit/s link
```

Any static file server also works, for example `npx serve .` or `python3 -m http.server 8080`. Use a desktop
browser with WebGL 2 (Chrome, Edge or Firefox; a discrete GPU is recommended for the higher presets).

URL parameters:

| Parameter | Effect |
| --- | --- |
| `?mission=m01` | Skip the title screen and load a mission (`m01`–`m03`; `m00` is the sandbox). |
| `?preset=low\|medium\|high\|ultra` | Rendering quality preset. |
| `?test=1` | Test mode: the simulation only advances through `window.__game.advance(s)`. |
| `?debug` | Debug mode: the DEBUG LEVEL SELECT instead of the title (see [Debug mode](#debug-mode)). `?debug=cones` also shows every vision cone. |

## Debug mode

Add `?debug` to the URL (`?debug=1`, `?debug=cones` and any other value work too; `?debug=0` is off), for example
`http://localhost:8080/?debug` or `https://jaher.github.io/shadow-six/?debug`. The game skips the title splash and
opens **DEBUG LEVEL SELECT**: every mission in the mission list, grouped as *Behind Enemy Lines* (by mission number),
*Beyond the Call of Duty* and *Sandbox / test maps*, each with its number, name, theater colour and icon, and a
thumbnail once you have played it in debug mode (a small capture cached in the browser). New missions appear by
themselves. Click or tap a level, or use the arrow keys and Enter. Esc (or *Main menu*) goes to the normal title.

Options in the overlay, remembered in `localStorage` (those marked * apply on the next launch):

| Option | Effect |
| --- | --- |
| Skip briefing (default on) | The level starts at once. |
| All commandos * | Adds every missing commando of the campaign beside the first one. |
| Invulnerable | Commandos take no damage. |
| Enemies blind & deaf | Inspection mode: enemies see and hear nothing, so they never react. |
| All vision cones | Every enemy cone stays drawn. |
| Free camera | No scroll clamp at the map edge and zoom from 0.125× to 4×. |
| Time ×0.5 / ×1 / ×2 / ×4 | Simulation speed. |
| Time of day * / Wind * | Dawn, noon, dusk or overcast lighting; any wind preset. |
| Info HUD | The corner readout (also F11). |

Keys while `?debug` is on: **F10** level select (also the small DEBUG button, bottom left), **PageDown / PageUp**
next / previous level, **Ctrl+R** instant restart, **F11** info HUD (mission, state, FPS, frame and CPU ms, draw
calls, triangles, cursor world x/z, camera zoom and yaw). The URL follows the level you are in, so
`?debug&mission=m05` reloads or shares that level directly, with the remembered options. Without the parameter none
of this exists, and nothing in the normal menus leads to it.

### Solution replays

Missions with a saved full solution (today Mission 3, *Reverse Engineering*: `tools/solutions/m03.solution.mjs`, the
same script the `m03-solution` regression test plays) can be watched being solved inside the game. In DEBUG LEVEL
SELECT pick **▶ … — play the solution** under *Solution replays*; in a mission press **F9** or the small **▶ SOL**
button beside DEBUG. The mission is loaded fresh, as authored (the select's *All commandos*, *Invulnerable*, *Enemies
blind & deaf*, time of day and wind are ignored while it plays), and the solution's player orders are issued live in
the real game loop, starting at 1× (real time). The bar at the top has:

| Control | Effect |
| --- | --- |
| ■ STOP (or **Esc**, or F9 again) | Stops the replay; you take over the mission where it stands. |
| ❚❚ / ▶ | The game's own pause (P works too). |
| 1× 2× 4× 8× | Replay speed. |
| STEPS ▾ | Skip to a step (stage) of the solution: a later one fast-forwards to it, an earlier one reloads the mission and fast-forwards. |
| CAM | The camera follows the commando the last order went to (on), or is yours to scroll (off). |

A caption shows the current step, each checkpoint as it is reached and the latest order. Your own orders are held
while it plays. Adding a solution for another mission: write `tools/solutions/<id>.solution.mjs` (exports `solve(D,
ctx)` and `STAGES`; driver API in `tools/solutions/driver.mjs`). Nothing to register: the debug menu lists the folder
(the dev server answers `tools/solutions/?ls`; the web build bakes the list in and bundles every solution as a lazy
chunk).

### Video mode: watch a walkthrough

A guided film of a mission's solution, played live in the game. In DEBUG LEVEL SELECT pick **▶ … — watch the
walkthrough** under *Watch walkthrough · video mode*; in a mission press **F8** or the small **▶ VIDEO** button; or
open `?debug&walkthrough=m03` directly. Missions without a solution are listed under *No walkthrough yet* (their
button says so). The mission loads fresh, as authored, on a title card (Start, Chapters, Exit); then:

- **The director** frames the commando who acts with what matters to the step (his target, the guard he slips past,
  the objective, a charge in its last seconds and the blast) in the part of the screen the walkthrough's bar and
  caption and the HUD leave free, with smooth pans and zooms, the mission's camera pitch (M3 looks down steeper over
  the plateau) and your camera angle, swung aside only while a building would hide the shot. The guards' cones that
  matter to the step are drawn.
- **The narration**: a chapter card at each stage, then one caption per step saying who does what and why
  (`tools/solutions/<id>.walkthrough.mjs`, format in [docs/walkthrough-format.md](docs/walkthrough-format.md)).
- **The bar** (finger-sized, under the HUD's top bar on every screen):

| Control | Keys | Effect |
| --- | --- | --- |
| ✕ | Esc | Back to the debug menu. |
| ⏮ / ⏭ | B / N | Previous / next step. Ahead fast-forwards from where you are; back reloads the mission and fast-forwards (the run is deterministic). ⏮ restarts the current step, or goes to the previous one in its first 4 s. |
| ❚❚ / ▶ | Space | Pause / play. |
| ☰ | L | Chapters and steps: jump to any of them. |
| ½× 1× 2× 4× | 1–4 | Speed. |
| ⏩ | W | Skip waits (on by default): while every commando waits, the pace rises up to 4× faster; it drops back the moment anything happens. |
| CC | C | Captions on / off. |
| CAM | F | Director on / off. Off is a free camera: scroll, drag and zoom as in the game; a drag or the wheel over the map also switches to it. CAM gives the camera back to the director. |

The walkthrough never changes the simulation: it wins exactly like the scripted run, checkpoint for checkpoint
(`tests/debug-walkthrough-sim.test.mjs`).

## Controls

The controls follow the original game.

| Mouse / keyboard | Touch (phone, tablet) | Action |
| --- | --- | --- |
| Left click a commando or portrait, `1`–`6` | Tap a commando or his portrait; **long-press** a commando adds / removes him | Select (Shift adds to the selection); `0` deselects, `8` selects all |
| Left drag | — | Box select |
| Left click on the ground | Tap the ground; **double-tap** runs | Walk there; **double-click** runs |
| Right click | **CANCEL** button (shown while something is armed) | Cancel the armed item, else deselect |
| Click (Shift+click) an enemy | **Long-press** an enemy, or the eye button then tap | Show its vision cone |
| `C` / `S` | Posture button | Lie down and crawl / stand up |
| `X` knife, `G` pistol, `R` sniper rifle, `J` harpoon or trap, `B` bomb, `A` detonator, `E` grenade, `L` injection, `W` wire cutters, `K` first aid, `U` uniform, `Q` decoy, `T` boat, `D` diving gear, `F` shovel | Tap the item in the knapsack, then tap the target | Knapsack items (each commando only has his own) |
| `Tab` | — | Move the knapsack panel to the other side |
| Arrow keys, screen edges, middle drag | **One-finger drag** (flick to coast); two fingers also pan | Pan the camera |
| Mouse wheel, numpad `+` / `-` (or `=` / `-`) | **Pinch** with two fingers (spread = zoom in, about the fingers' midpoint) | Zoom; numpad `*` or `Backspace` resets |
| `Home` | — | Centre on the selection |
| `P`, `Esc` | **MENU** button (bottom left) | Pause and objectives, cancel |
| `F1` | ? button | Help |
| `F2`–`F7` | — | Split-screen camera views |
| `F8` / `F9` (`Ctrl+S` / `Ctrl+L`) | MENU → save / load | Quick save / quick load |
| `Ctrl+B` | Notes button | Notes |

On a touch screen a tap never pans and a drag never gives an order: a finger that moves more than 10 px is a drag, and a
second finger turns it into a pinch. Phones and tablets start on the *medium* quality preset (*low* on older mobile GPUs),
which also caps the rendering resolution; a quality picked in OPTIONS is kept.

## Weapons per commando (BEL 1998)

Each commando carries only the equipment he had in the original game; missions add or change counts.

| Commando | Weapons | Tools |
| --- | --- | --- |
| Green Beret | knife, pistol | decoy, shovel |
| Sniper | sniper rifle (limited rounds, 5 by default), pistol | first-aid kit if neither Driver nor Spy is deployed |
| Marine | knife, harpoon gun (unlimited, shorter range than the pistol), pistol | inflatable boat, diving gear |
| Sapper | pistol, bear trap, time bombs **or** remote bombs (never both); grenades per mission | detonator (remote bombs), wire cutters per mission |
| Driver | pistol; submachine gun (20 bursts) only in missions 1, 2, 4 and 10 | first-aid kit (6 doses) |
| Spy | pistol, lethal injection (unlimited) | enemy uniform (found on site); first-aid kit if no Driver |

The data lives in [src/items.js](src/items.js).

## Tests

```sh
node tests/unit/run.mjs      # npm run test:unit: pure simulation (grid, pathfinding, world, objectives, items…)
node tests/run.mjs [pattern] [--swiftshader] [--headed]   # npm test: browser tests in headless Chromium
```

The unit tests run on GitHub Actions for every push and pull request. The browser runner (`npm install` first,
for playwright-core) starts `tools/serve.mjs` on a free port and launches a cached playwright Chromium on the
real GPU (`--use-angle=gl`); `--swiftshader` uses software rendering. It fails on thrown errors, page errors,
`console.error` and HTTP errors. Screenshots go to `tests/out/` (git-ignored).

## Deployment

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the web target on every push to `master`
(`npm ci`, `npm run build`, see [tools/build/build.mjs](tools/build/build.mjs)) and deploys `dist/` to GitHub
Pages. The build bundles `src/` with esbuild (code-split, content-hashed file names), keeps every URL relative so
the site works under the `/shadow-six/` sub-path, adds `version.json`, a `404.html` that returns to the game and a
small service worker (`sw.js`).
`SS_DIST=1 node tests/run.mjs webbuild` checks the build in headless Chromium.

### Caching and offline play

A mission is downloaded once (40–100 MB). Inside a session, RESTART MISSION, quick load and loading a save of a
mission already played reuse what is in memory (textures, models, baked terrain and trees, shader programs): no
download, no loading screen. Between visits the service worker keeps every downloaded asset in the browser's Cache
Storage, keyed by content hash, so a new deploy only re-downloads the files that changed; code, HTML and manifests
always come from the network first (never stale). After a mission loads, the next campaign mission is downloaded in
the background when the connection is not metered or in data-saver mode. Once a mission is cached it also plays
offline. OPTIONS → CLEAR CACHED GAME DATA deletes the cache. Details: `docs/ARCHITECTURE.md` § Asset cache;
`node tools/perf/measure-restart.mjs` measures (re)load times on the build.
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the unit tests and the web build.

## Layout

```
index.html            entry page (dev: import map → vendor/three.module.js; the build bundles it)
styles/               screen, menu and HUD styles
src/main.js           boot: WebGL check → Game → assets → title
src/game.js           Game: states, fixed-step loop, mission loading
src/config.js         gameplay and render numbers
src/items.js          item catalogue and BEL default loadouts
src/core/             events, math, objectives
src/world/            grid (terrain, blocking, line of sight), pathfinding, world, map builder
src/entities/         units, commandos, enemies, vehicles, projectiles, interactables
src/ai/               perception, enemy brain, alarm
src/abilities/        one file per ability
src/engine/           renderer, camera, input, asset loading
src/render/           vision cones, selection markers, effects
src/art/              models, materials, terrain, water, characters
src/ui/, src/audio/   menus, HUD, briefings, credits; audio
src/missions/         mission definitions (m00 sandbox, m01–m03)
assets/               textures, models, HDRIs, audio, portraits, fonts (see CREDITS.md)
vendor/               three.js r186 and addons
tools/                dev server, web build (tools/build), asset build scripts (Blender, audio, portraits)
tests/                browser tests and unit tests
docs/                 architecture, design spec, research notes, screenshots
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing module interfaces.

## Credits

All third-party material is listed with its source, author and licence in [CREDITS.md](CREDITS.md). In short:

- Code: three.js and its addon libraries (MIT / Apache-2.0).
- Textures, HDRIs and models: CC0 sets from Poly Haven and ambientCG, plus the project's own Blender and
  procedural models.
- Sound: CC0 / public-domain recordings and the project's own synthesis. Fonts: SIL OFL and Apache-2.0.
- Briefing photographs: public-domain wartime photographs (Imperial War Museums, via Wikimedia Commons).
- **AI-generated media.** The commando portraits and their talking animations were generated for this project
  (Z-Image-Turbo, JoyVASA and LivePortrait), and the voices were synthesised (Kokoro and Chatterbox). The faces
  come from written descriptions only; no real person's likeness or voice is used.

The original game, *Commandos: Behind Enemy Lines*, was created by Gonzo Suárez and Pyro Studios and published
by Eidos Interactive in 1998. This project exists out of admiration for it.

## License

The original source code is released under the [MIT License](LICENSE). Assets in `assets/` and the libraries in
`vendor/` keep their own licences; see [CREDITS.md](CREDITS.md) and [vendor/LICENSE](vendor/LICENSE).
