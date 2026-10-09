# Reference screenshots — web build (source of truth)

Captured on the DGX Spark (spark-dgx-1) with Playwright headless Chromium
(`~/pwenv`, `--use-angle=vulkan` on the GB10 GPU) against the JS original
served at `http://127.0.0.1:8124/` from `~/shadow-six`. All at 1280×720.

| File | What it shows |
|---|---|
| `title.png` | Title splash: olive backdrop, winged-bird emblem over a "VI" roundel, "SHADOW SIX" plaque and large weathered SHADOW SIX logotype. This is the deterministic first screen after the boot ident (the mission menu sits behind a first-run profile prompt, so the splash is the stable title reference). |
| `gameplay-m00.png` | Real in-mission gameplay, mission `m00` ("Sandbox" training ground): top-down terrain with grass tufts and a large tree shadow, three commandos (selected one ringed in green), top HUD bar with portraits 1/2/4 + red health bars, right-edge notebook, bottom-right backpack panel (pistol/knife/radio/shovel), hand cursor. Reached via `?mission=m00`, then Enter to leave the briefing (state `briefing` → `playing`). |
| `briefing-m00.png` | Mission briefing slide 1 for `m00`: sepia photo of a wrecked propeller aircraft, "Sandbox / Training ground — test map", orders text, SLIDE / NEXT PART controls. |
| `new-user-prompt.png` | First-run profile prompt ("NEW USER — CREATE NEW USER? (Y)ES (N)O") shown when a key is pressed at the splash with no profile. Not a diff target; kept for reference. |

Capture scripts are kept on the DGX at `/tmp/capture_ref.py` and
`/tmp/capture_ref2.py` (title + briefing, and title-menu probe + Escape/Enter
gameplay respectively). The comparison harness that consumes these references
lives with the C++ port, not in this repository; re-capture the references
after any web-build art/UI change.

## Per-mission gameplay references (2026-10-09)

One in-game frame per BEL campaign mission, captured the same way (Playwright
headless Chromium on spark-dgx-1, `--use-angle=vulkan`, 1280×720, JS build at
`http://127.0.0.1:8124/`). Driven through the game's own test API
(`?test=1`, `window.__game`): missions were loaded directly, and for ACTION
shots the Sapper was staged at the objective with a planted charge (time or
remote bomb) and the frame taken mid-detonation; other frames are settled
gameplay after the sim had run for a few seconds. `gameplay-m00.png` above is
unchanged — the original sandbox frame remains the best m00 reference.

| File | Mission | What it shows |
|---|---|---|
| `gameplay-m01.png` | m01 "Baptism of Fire" (Sola, near Stavanger, Norway · 20 February 1941) | Gameplay: patrol crossing the snowy airfield village below the relay mast, staff car parked by the houses. |
| `gameplay-m02.png` | m02 "A Quiet Blow-Up" (Stamsund, Lofoten Islands · 1 March 1941) | ACTION: the fuel depot detonating — fireball hurling guards into the snow mid-blast. |
| `gameplay-m03.png` | m03 "Reverse Engineering" (Sysendam dam, Eidfjord, Norway · 4 March 1941) | ACTION: the crest charge going off on the Sysendam dam — fireball on the crest, spillway bursting, "OBJECTIVE COMPLETED: DEMOLISH THE DAM". |
| `gameplay-m04.png` | m04 "Restore Pride" (Stokkan, near Trondheim · 10 March 1941) | ACTION: the German headquarters villa exploding in the village square. |
| `gameplay-m05.png` | m05 "Blind Justice" (Radar station above Herdla, Askøy, Norway · 2 May 1941) | Gameplay: summit building with the escape autogyro at the frame edge. |
| `gameplay-m06.png` | m06 "Menace of the Leopold" (Masi, Finnmark, Norway · 10 May 1941) | ACTION: the Leopold railway gun ablaze along its train after the planted charge. |
| `gameplay-m07.png` | m07 "Chase of the Wolves" (Arendal, southern Norway · 7 February 1942) | ACTION: the first U-boat blowing up at the pier as the after-deck charge detonates. |
| `gameplay-m08.png` | m08 "Pyrotechnics" (Tell el Eisa, Egypt · 19 October 1942) | Gameplay: desert gun pit and mortar position, commando on the move, anti-tank obstacles. |
| `gameplay-m09.png` | m09 "A Courtesy Call" (Bab el Qattara, Egypt · 20 October 1942) | ACTION: the radio hut exploding inside the walled compound. |
| `gameplay-m10.png` | m10 "Operation Icarus" (El Agheila, Libya · 14 November 1942) | ACTION: the airfield bomb store going up in a fireball. |
| `gameplay-m11.png` | m11 "In the Soup" (Maradah oil field, Libya · 3 December 1942) | ACTION: a drilling rig ablaze ("DRILLING RIG DESTROYED") among the storage tanks. |
| `gameplay-m12.png` | m12 "Up on the Roof" (Tunis, Tunisia · 15 March 1943) | Gameplay: commandos crossing the Tunis rooftops. |
| `gameplay-m13.png` | m13 "David and Goliath" (Le Havre, France · 15 May 1944) | Gameplay: the battleship at berth under the harbour crane — the Goliath at rest (deck charges did not damage it, so no blast frame). |
| `gameplay-m14.png` | m14 "D-Day Kick Off" (La Rivière, sector Juno, Normandy · 25 May 1944) | Gameplay: the beach casemate, wire and obstacles with troops ashore on Juno. |
| `gameplay-m15.png` | m15 "The End of the Butcher" (Compiègne, France · 26 August 1944) | Gameplay: commandos on the riverside street with the tram. |
| `gameplay-m16.png` | m16 "Stop Wildfire" (The Maas bridge near Liège, Belgium · 4 September 1944) | Gameplay: the locomotive waiting at the station by the Maas bridge line. |
| `gameplay-m17.png` | m17 "Before Dawn" (Riveauvillé, north of Colmar, Alsace · 28 November 1944) | Gameplay: the squad moving up the snowy forest road, point man ringed. |
| `gameplay-m18.png` | m18 "The Force of Circumstance" (The Maas bridge near Liège, Belgium · 16 December 1944) | ACTION: the Maas bridge mid-collapse into the river, charges fired at the three marked points ("THE BRIDGE IS DOWN"). |
| `gameplay-m19.png` | m19 "Frustrate Retaliation" (A coal-mining works at Oldenburg, Germany · 12 January 1945) | ACTION: a V2 rocket destroyed on its launch pad, second rocket still standing alongside. |
| `gameplay-m20.png` | m20 "Operation Valhalla" (Gundelfingen castle, north of Freiburg, Germany · 11 February 1945) | ACTION (aftermath): the castle HQ roof blown in and still smoking after the charge. |

## Per-mission scene references — non-explosion (2026-10-09)

A second pass over the same missions, same rig and resolution, deliberately
avoiding detonations: signature set-pieces intact, stealth/infiltration
framings, vehicles and distinctive environments. Commandos were occasionally
staged near patrols through the test API (`?test=1`, `window.__game`) to set
up infiltration frames. These complement the `gameplay-mXX.png` set above and
are not diff targets.

| File | Mission | What it shows |
|---|---|---|
| `scene-m01-relay-mast.png` | m01 "Baptism of Fire" | The relay mast and snow-roofed hut on the Sola airfield, Kübelwagen parked alongside. |
| `scene-m01-raft-stealth.png` | m01 "Baptism of Fire" | The Green Beret ashore by the inflatable raft, a sentry standing a few metres away on the icy shore. |
| `scene-m02-patrol-boat.png` | m02 "A Quiet Blow-Up" | The patrol boat moored in the ice-choked harbour channel below the depot pier. |
| `scene-m02-depot-approach.png` | m02 "A Quiet Blow-Up" | Stealth approach on the fuel depot: a sentry's view cone sweeping the yard, guards reacting ("Achtung!"), commando at the cone's edge. |
| `scene-m03-dam-intact.png` | m03 "Reverse Engineering" | The Sysendam dam intact from the lake side, the Sapper standing on the crest. |
| `scene-m03-camp-infiltration.png` | m03 "Reverse Engineering" | The Spy working into the garrison camp below the cliffs and power lines. |
| `scene-m04-villa-square.png` | m04 "Restore Pride" | The headquarters villa in the village square before the attack. |
| `scene-m04-panzer-village.png` | m04 "Restore Pride" | A Panzer II on the shoreline road through the village, sentries nearby. |
| `scene-m05-autogyro.png` | m05 "Blind Justice" | The escape autogyro on the summit pad beside the radar-station building. |
| `scene-m05-cable-car.png` | m05 "Blind Justice" | The cable-car station with the red gondola, mid-mountain. |
| `scene-m06-leopold-intact.png` | m06 "Menace of the Leopold" | The Leopold railway gun intact on its siding by the stone tower. |
| `scene-m06-chapel.png` | m06 "Menace of the Leopold" | The chapel and station building under the Finnmark light, train on the siding. |
| `scene-m07-uboat-pier.png` | m07 "Chase of the Wolves" | A U-boat moored at the snowy pier (bow and deck along the quay), the Marine on the dock, halftrack on the harbour road. |
| `scene-m07-harbour-village.png` | m07 "Chase of the Wolves" | Snowy harbour-side houses with a patrol threading between them. |
| `scene-m08-gun-pits.png` | m08 "Pyrotechnics" | Desert gun pits: the big gun and AA position inside their walled enclosures at Tell el Eisa. |
| `scene-m08-desert-village.png` | m08 "Pyrotechnics" | The Green Beret slipping through the mud-brick village, truck parked by the houses. |
| `scene-m09-tank-column.png` | m09 "A Courtesy Call" | Three Panzers parked in a row under the vehicle shed, tanker truck alongside. |
| `scene-m09-walled-compound.png` | m09 "A Courtesy Call" | Inside the walled compound: the weapons store and command post. |
| `scene-m10-ju52.png` | m10 "Operation Icarus" | A Ju-52 transport on the El Agheila strip, close enough to read the fuselage codes. |
| `scene-m10-stuka-line.png` | m10 "Operation Icarus" | Two Stukas parked wingtip to wingtip on the desert airfield. |
| `scene-m11-oil-rigs.png` | m11 "In the Soup" | A derrick and storage tanks in the Maradah oil field. |
| `scene-m11-tank-farm.png` | m11 "In the Soup" | The western tank farm: three storage tanks under their derrick, palms at the edge of frame. |
| `scene-m12-rooftops.png` | m12 "Up on the Roof" | Commandos crossing the white Tunis rooftops. |
| `scene-m12-street-patrol.png` | m12 "Up on the Roof" | The Spy on a rooftop above a street patrol threading the medina lanes. |
| `scene-m13-battleship.png` | m13 "David and Goliath" | The battleship's bow and forward turrets at berth under the harbour crane. |
| `scene-m13-sub-pen.png` | m13 "David and Goliath" | The submarine tied up at the pier in the harbour basin. |
| `scene-m14-juno-beach.png` | m14 "D-Day Kick Off" | The grass-roofed beach casemate with its garrison on the roof, wire and obstacles below. |
| `scene-m14-casemate.png` | m14 "D-Day Kick Off" | A beach-defence casemate and MG positions above the Juno shore road. |
| `scene-m15-tram.png` | m15 "The End of the Butcher" | The tram on the riverside street in Compiègne, the Spy watching from the pavement. |
| `scene-m15-sdkfz-street.png` | m15 "The End of the Butcher" | An Sd.Kfz. half-track parked on the street as a troop column marches past. |
| `scene-m16-station.png` | m16 "Stop Wildfire" | The station house and platform by the Maas bridge line, squad prone in the field behind. |
| `scene-m16-rail-crossing.png` | m16 "Stop Wildfire" | A truck waiting at the level crossing as a patrol marches across the tracks. |
| `scene-m17-dawn-road.png` | m17 "Before Dawn" | Dawn on the forest road: view cones, dialogue, and the bridge gantry ahead of the squad. |
| `scene-m17-prison-pen.png` | m17 "Before Dawn" | The fenced prisoner pen with its guard truck, before the breakout. |
| `scene-m18-bridge-intact.png` | m18 "The Force of Circumstance" | The Maas bridge intact — steel truss, island hut and the sandbagged MG post. |
| `scene-m18-station.png` | m18 "The Force of Circumstance" | The little station building with its flag and a wagon on the siding. |
| `scene-m19-v2-pads.png` | m19 "Frustrate Retaliation" | All three V2 rockets standing on their pads between the site houses, intact. |
| `scene-m19-west-yard.png` | m19 "Frustrate Retaliation" | The west yard: fuel tanks and a tank hull under the workshop shed. |
| `scene-m20-castle.png` | m20 "Operation Valhalla" | Gundelfingen castle intact, a commando ringed at the HQ door. |
| `scene-m20-v2-site.png` | m20 "Operation Valhalla" | Two V2 rockets on transport trailers in the castle courtyard, guards patrolling. |
