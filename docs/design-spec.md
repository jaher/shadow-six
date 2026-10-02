# SHADOW SIX: game design spec

**SHADOW SIX** is a browser remake of *Commandos: Behind Enemy Lines* (BEL, Pyro Studios / Eidos Interactive, 1998), built with three.js r186. It aims to be faithful to the original.

> **Fan-tribute disclaimer.** The title screen, the credits and `README.md` must all show this text: "SHADOW SIX is an unofficial, non-commercial fan tribute to *Commandos: Behind Enemy Lines* (Pyro Studios / Eidos Interactive, 1998). It is not affiliated with, endorsed by or connected to Pyro Studios, Eidos, Square Enix or Kalypso Media. 'Commandos' is a trademark of its owner. No assets from the original game are used; all art, audio and code are original or CC0/redistributable (see CREDITS.md)."

## 0. How to read this spec

**Precedence.**
- `docs/ARCHITECTURE.md` wins on *structure*.
- This file wins on *gameplay values*.

**Evidence.** Every number comes from `docs/research-raw/*`. The tags show how firm each value is:

| Tag | Meaning |
|---|---|
| **[EXE]** | Taken from the disassembled 1998 demo executable (gap-0/1/2/7/8) |
| **[data]** | Taken from original MIS/MAC files |
| **[manual]** | The 1998 US manual |
| **[guide]** | Prima, Kildread, Ruetli or eggie |
| **[inf]** | Inferred by the researchers |
| **[rec]** | This spec's own tuning choice where the sources are silent. Tune freely. |

**Units and conventions** (from ARCHITECTURE):
- 1 unit = 1 m. Ground is the XZ plane with Y up. Origin is the NW corner; +X is east and +Z is south.
- **Heading** is written in degrees in this document: 0 = E, 90 = S, 180 = W, 270 = N. Code converts to radians. This matches BEL's `.ANGULO` convention [data].
- **BEL conversion constants.** Every original value converts through these (both live in `CONFIG.sim`):
  - `BEL_UNIT = 0.045 m` per map unit (gap-8 decision, from vehicle footprints).
  - `BEL_TICK = 0.05 s`, i.e. 20 ticks/s (gap-2/gap-8 decision; the time bomb's `.Retardo 200` equals the manual's 10 s).
  - Formulas: `v[m/s] = u_per_tick × 0.9`; `d[m] = u × 0.045`; `t[s] = ticks × 0.05`.
- Map images are not in map units. Fan-map fractions convert as `x = fx·W`, `z = fy·D`, where D = image-height / sin 40° × 0.045 m.

**Naming.**
- Mission titles use the official English (Prima/fandom) names.
- Commandos use the US-manual set (§3.0).

---

## 1. Scope

### MUST (first playable = BEL missions 1–3, then 4–20 in order)
1. **Campaign.** The BEL campaign runs linearly: title, then mission select (with passwords), then a two-part briefing, then the mission, then the debrief, then the next mission. The 20 BEL missions are data files; M1–M3 are specified to build level in §7.
2. **The six commandos** with exactly their BEL kit and abilities (§3). Nothing from BCD, C2 or C3 may leak into the BEL ruleset: no binoculars, stones, cigarettes, knock-outs, handcuffs, mine detector or throwing knives.
3. **Enemy AI** (§4):
   - 70° two-band vision cones with a sine sweep and elliptical range;
   - instant sighting, then a nervousness challenge;
   - hearing by noise level;
   - bodies, footprints, zone alarms and barracks reinforcements;
   - capture and jail;
   - the special units each mission needs.
4. **Cone display.** One cone is shown at a time. It uses the BEL colours and has exactly the detection geometry. The spotter's cone shows automatically, and a red probe marker can be placed.
5. **Controls** mirror BEL (§5). This includes right-drag box select, double-click to run, Shift, Alt and Ctrl clicks, and action hotkeys A–X.
6. **HUD** (§6):
   - portrait bar with health bars and skulls;
   - eye tool, camera icon and "?";
   - notebook minimap;
   - hand;
   - knapsack with the item intersection for groups, and Tab to swap sides;
   - context cursors;
   - tooltips;
   - Ctrl+B briefing notes;
   - pause, Esc menu, mission complete/failed and debrief screens.
7. **Rules and scoring.** Win/lose rules, the 5 s grace countdown, time and damage stars, gold merit, 11 ranks, the M20 Captain gate, and passwords (§8).
8. **Saving.** Quicksave and quickload (Ctrl+S/Ctrl+L) plus 10 named slots.
9. **Fixed-step simulation.** BEL tick values are converted exactly (§10).
10. **Realism baseline.** PBR materials, HDRI lighting, soft shadows, AO, rigged animated soldiers, period kit, recorded or neural-TTS voices, and the per-theater lighting in §2.4.

### SHOULD
- Multi-view cameras F2–F7 (1–6 windows) and the tracking camera (Alt+click and the camera icon).
- Talking portraits: the speaking commando's portrait is lip-synced, plus a speaker card. This is a user request and a non-original addition.
- Ambient nature layer: the demo's "noisy mother nature" (wind, surf, birds). It can be toggled off to match retail's silence.
- Warning flashes on portraits (§6.2).
- Game options: Submissive/Indifferent to halt, and Verbose/Laconic.
- Content option "censored": no blood, and gravestones instead of bodies.
- Modern-comfort toggles, all **off** by default:
  - active pause (issue orders while paused);
  - alert tint on cones;
  - edge-scroll off;
  - key rebinding.
- Deformable ground trails: footprints, crawl furrows and tyre tracks. These are the visual side of the footprint mechanic (§4.8).

### COULD
- The *Beyond the Call of Duty* campaign (8 missions, ruleset `BCD`, §7.2). Build it after BEL is complete; the architecture is already ruleset-aware.
- Tick-rate slider from 16 to 25 Hz (BCD added a speed slider; BEL had none).
- Photo mode, and a tilt-shift "diorama" view.
- A "modern detection" mode with a fill toward the target over 0.3–1.0 s (Mimimi-style).
- Replay timeline.

### WON'T
- Multiplayer (BEL's 6-player LAN co-op).
- A difficulty setting (BEL has none).
- Commandos 2 features: interiors, windows, swimming for everyone.
- Any asset from the original game.
- Swastikas, SS runes or death's heads on uniforms, characters, UI, menus or branding. **Exception — enemy flags (user decision 2026-09-30):** flagpoles fly the historical German national flag of 1935–45 (red field, white disc, black swastika), as BEL's international release did; Options → INSIGNIA → NEUTRAL swaps in a field-grey banner with a Balkenkreuz (as BEL's German release did). Vehicles use the Balkenkreuz in both modes.

---

## 2. Camera and presentation

### 2.1 Projection
- **Camera.** `THREE.OrthographicCamera` with **pitch 40° below horizontal** and **yaw 0°**: map axes align with the screen, and north is up. This is BEL's projection: screen x equals map x, and screen y equals map y × sin 40° [data: open-commandos `g_sin40`, gap-8 §3].
  **Amended:** the default yaw is now **+15°** (`CONFIG.camera.yawDeg`; Options → CAMERA ANGLE: CLASSIC 0° / TILTED 15° / ISOMETRIC 45°, persisted) so axis-aligned buildings show a sliver of their shaded east side instead of a flat front elevation. The sun stays compass-fixed (NW). Panning, edge scroll and middle-drag stay screen-relative. The bounds clamp keeps every map point reachable with the 4 m margin, and the slanted view corners may show ground past it when the player scrolls hard into an edge (at the corner limit up to about (2 m + max(half-view width, half-view depth)·sin 2·yaw)/(cos yaw + sin yaw): 8 m at 1× and 15 m at 0.5× on a 1280×720 window at 15°; `CameraController.clampHalfExtents`). A scroll that meets the limit slides along it. Recentres, unit tracking, the briefing tour and a CAMERA ANGLE change keep the view void-free (4 m margin only) unless the point they aim at needs the loose limit (`focusTarget`). The notebook map stays north-up and draws the view as a rotated rectangle.
  - Position: `cam = target + d·(0, sin 40°, cos 40°)`, then `lookAt(target)`, with d = 200 m.
  - Buildings are rotated in the mission data, not by the camera. Most BEL buildings sit about 45° to the screen, so their walls read at about ±32.5° [measured].
  - **No rotation**: BEL had none.
- **Optional "diorama lens"** (off by default): a PerspectiveCamera with a 10° FOV at the same angles. Cone geometry must not change.

### 2.2 Zoom
- **Discrete levels** [rec: BEL had numpad +/−/\*, zoom-out measured at about 0.45–0.5×]:

  | Level | Scale | Ground width shown |
  |---|---|---|
  | 0.5× "panoramic" | 20 CSS px/m | 96 m on a 1920-px canvas |
  | **1× "normal" (default)** | 40 CSS px/m | 48 m on a 1920-px canvas; a standing soldier is about 55 px tall at 1080p |
  | 2× "detailed" | 80 CSS px/m | 24 m |

- The scale is defined in CSS pixels per metre, so a larger window shows more map. This keeps BEL's "more resolution = more map" behaviour.
- **Keys and wheel.** Numpad `+` / `−` step between levels, and numpad `*` returns to 1×. The mouse wheel steps one level per notch.
- Each change tweens over 0.25 s, keeping the ground point under the cursor fixed (wheel) or the screen centre fixed (keys).
- Shadow-map fit and LOD are chosen per zoom level.

### 2.3 Scrolling and framing
- **Edge scroll.**
  - The zone is 8 reference px (16 CSS px at uiScale 2) from any edge of the game area.
  - Speed is **30 m/s ÷ zoom**.
  - It is active whenever the pointer is inside the window, including over the HUD, as in BEL. The modern option disables it.
- **Arrow keys:** same speed. **Middle-drag:** pans 1:1.
  - **WASD pan is disabled.** A, S, D and W are BEL action keys (§5; architecture delta §10.4).
- **Bounds.** The camera target is clamped so that the view never shows more than 4 m beyond the map edge (yaw 0). With the Options camera angle at 15° or 45°, the slanted view corners may reach a little further, so every map point can still be scrolled 2 m inside the view. A scroll that meets the limit slides along it. The HUD top bar counts as outside the view: the clamp works on the part of the view below the bar, so every map point, the north edge included, can be scrolled clear of the portraits (the ground under the bar is scenery apron).
- **Never see the map boundary** (user request 2026-09-30). Every map is ringed by a non-playable **scenery apron** (`CONFIG.apron.width`, 90 m; per-mission `apron` overrides) — see ARCHITECTURE "Scenery apron".
  - The ground continues with the theatre's own material and height noise. Rivers, roads, rail beds, lakes, fjords and the sea run on off-map along their course, with the same shore rims and ice. The forest thins outward from the map's own edge density. Rock massifs, walls, fences, wire, rails and power lines that end on an edge carry on; harbour and canal water stays between its quay walls; a street of houses ending on an edge carries on as a town (M12). There is no seam at the map edge, and nothing out there is walkable.
  - The camera keeps its **true ground footprint** inside the apron at every zoom, angle (0/15/45°) and aspect (4:3 … 32:9, phone portrait/landscape). The footprint is the four screen-corner rays, met with the lowest and highest apron ground. It includes the clamp margin, the slanted-corner overshoot and the height slack.
  - Only if a view is too wide for that, the zoom floor is raised for that map, view size and angle, and logged once (`[camera] zoom floor …`). The floor is never raised above 0.5× on views up to 3840×1080. A flat far skirt (600 m) covers anything beyond, as a safety net.
- **Selecting a commando** by portrait or key 1–7 recentres the view on him (0.35 s tween) **only if he is off-screen**. Pressing the key of an already-selected man always recentres. A map click never recentres.
- **Mission start:** `cameraStart {x, z, zoom}` from the mission file frames the briefing. When the mission starts (the Colonel's tour finished or skipped, or the briefing skipped), the view goes **on the squad** (`Game.focusSquad`). It centres on the live commandos' centroid (else the centre of their screen bounding box) when they all fit on screen, feet and heads clear of the edges and of the HUD top bar, else on the selected commando. The play zoom is restored; the squad is kept in the middle half of the view below the bar as far as the clamp allows.
- **Tracking camera.** Alt+click a unit, or the camera icon and then a unit, locks that view to the unit. A corner badge (the camera icon) shows in the view's lower-left.
  - Click the badge, or Alt+click the ground, to release.
  - Enemies and vehicles can be tracked.
- **Multi-view (F2–F7).**
  - F2 gives 1 view; F3, F4, F5, F6 and F7 give 2 to 6 views.
  - Repeating a key cycles its layouts: for 2 views, side-by-side then stacked; for 4 views, a 2×2 grid, then 1 big + 3 small, and so on.
  - Each view has its own target, zoom and tracking.
  - The active view has a **2 px red frame**; click a view to activate it. Orders and zoom apply to the active view.
  - Rendering uses a scissor and viewport per view.
  - Views 2–6 render at the "medium" preset.

### 2.4 Look, mood and lighting
**Global rules.**
- One sun (`DirectionalLight`) **from the screen's upper-left, i.e. from the NW**, so shadows fall down and to the right [measured: BEL baked lighting].
- IBL from a CC0 HDRI matched to each theater.
- AgX tone mapping, then a per-theater 3D LUT.
- AO (N8AO/GTAO at a small radius).
- Bloom only for fire, explosions and muzzle flashes.
- Average saturation about 0.15–0.35 and midtones about 0.3–0.5 [measured]. Saturated colour is reserved for flags, fire, blood and UI markers.
- **Faithful time of day is daylight in every mission** [measured: no BEL night maps]. Optional variants are listed per mission and are off by default.

| Missions | Theater (`buildTerrain`) | Sun elevation, colour temperature, sky | Ground and palette | Cone colours |
|---|---|---|---|---|
| 1–4, 7 (Norway, Feb–Mar) | `snow` | 12–20°, 5500–6500 K, overcast diffuse; light fog 150 m | Snow #dfdfde with blue shadows; olive grass #4c4d27–#5c5933; dirt #7d7352; fjord teal #103f3a; M2 river cyan #107083 | green |
| 5 (Herdla, May) | `snow` | 25–30°, 6000 K, broken cloud | Snow village, grey granite massif | green |
| 6 (Masi, May) | `temperate` | 25–30°, 6000 K | Green spring terrain, craters. Follow missions.md; visuals.md's "snowy" is rejected. | green |
| 8, 10, 11 (desert) | `desert` | 55–70°, 5200 K, hard shadows, distant heat haze | Sand #967e5d / #9f8866; concrete #8a7b67 | **orange** |
| 9 (desert, "await dawn") | `desert` | Faithful: 55°, 5200 K. Optional: 8–12°, 3500 K dawn | as above | orange |
| 12 (Tunis) | `desert` (urban props) | 45°, 5500 K, strong contrast | Whitewashed and ochre adobe | green [inf: urban ground, not desert sand] |
| 13–14 (Le Havre, Normandy, May) | `coast` | 35–45°, 6000 K, sea haze | Harbour teal #13403d; concrete #3e5251 | green |
| 15–16 (Aug–Sep) | `temperate` | 40°, 5800 K | Late-summer greens, dark cobbles | green |
| 17 ("Before Dawn") | `temperate` | Faithful: overcast day, 20°. Optional: blue hour, 5–10°, 7500 K | Cold greens, river | green |
| 18–19 (Dec–Jan) | `temperate` (frost variant) | 10–18°, 6500–7000 K, overcast | Frost and mud #4b4428; **no snow cover** [missions.md] | green |
| 20 (Feb, castle) | `temperate` (frost) | 15°, 6800 K, overcast | Dark slate roofs, forest #343b29 | green |

**Other presentation rules.**
- **Water.** Three.js `Water2`-style shader with a flow map driven by each mission's `water {velocity, angleDeg, turbulence}` (BEL `.VELINC/.ANGINC/.SININC`).
  - Deep water is nearly opaque teal, with a dark wet rim and foam at the shores.
- **Hidden units.** Commandos behind roofs or trees are drawn as an X-ray silhouette: a second pass with `GreaterDepth`, muted team colour at 35% alpha. Enemies are **not** X-rayed.
- **Barracks flags** use animated cloth. The flag is the gameplay marker for a reinforcement building, so it must read clearly at 0.5× zoom.

---

## 3. The six commandos

### 3.0 Canonical names (US-manual set) and variants

| Key | Role (`role` id) | Canonical name | Variants | Nationality, age in 1941, build | Voice |
|---|---|---|---|---|---|
| 1 | Green Beret (`greenberet`) | **Jerry McHale "Tiny"** | EU/official site and HD remaster: Jack O'Hara "Butcher" | Irish; born 1909, Dublin; boxer; 2.0 m, heavy | Gruff Irish |
| 2 | Sniper (`sniper`) | **Sir Francis T. Woolridge "Duke"** | none | English; born 1909, Sheffield; 1.85 m, lean | Upper-class RP, ice-cold |
| 3 | Marine (`diver`) | **James Blackwood "Fins"** | Called "Diver" from C2 onward | Australian; born 1911, Melbourne; 1.81 m | Sarcastic Australian |
| 4 | Sapper (`sapper`) | **Thomas Hancock "Inferno"** | EU: "Fireman" | English; born 1911, Liverpool; 1.78 m | Dry northern English |
| 5 | Driver (`driver`) | **Sid Perkins "Tread"** | The manual once says "Sam"; later canon: Samuel Brooklyn | American; born 1910, Brooklyn; 1.83 m | Brooklyn, eager |
| 6 | Spy (`spy`) | **René Duchamp "Spooky"** | EU: "Frenchy" | French; born 1911, Lyon; 1.79 m | French-accented English; fluent German |
| 7 | Guest | McRae (M10 pilot), the Informer (M12), Claude Gilbert + 4 (M17) | McRae's first name: Gregor (in-game text); Prima says "George" | — | — |

- The EU names ship as an optional locale string table (`names.eu`).
- Models are realistic and period-accurate. Silhouettes must still read at 1× zoom:

| Commando | Silhouette cues |
|---|---|
| Green Beret | Green beret, bulky |
| Sniper | Cap comforter and scoped rifle on his back |
| Marine | Wool cap and diving mask on his chest |
| Sapper | Brodie helmet and satchel |
| Driver | Leather cap and goggles |
| Spy | Civilian trench coat and fedora; the German officer's uniform with peaked cap when disguised |

### 3.1 Stats [EXE table `<addr>` unless tagged]

| Role | HP (energy) | Walk m/s | Run m/s | Crawl m/s | Carrying | Can run with load | Notes |
|---|---|---|---|---|---|---|---|
| Green Beret | **200** | 2.25 | **5.4** | 0.9 [inf] | Bodies, barrels: 1.6 m/s [rec] | no | Toughest |
| Sniper | **100** | 2.25 | 4.5 | 0.9 | — | — | Weakest |
| Marine | **160** | 2.25 | 4.5 | 0.9 | Packed raft: walk 1.35, run 3.6 (−1 u/tick) [EXE] | yes, slower | Swims and dives: 1.8 m/s [rec]. Rows: 2.5 m/s [rec] |
| Sapper | **130** | 2.25 | 4.5 | 0.9 | — | — | |
| Driver | **130** | 2.25 | **5.4** | 0.9 | — | — | Fastest runner, tied with the Green Beret |
| Spy | **160** | 2.25 | 4.5 | 0.9 | Bodies: 1.6 m/s | no | |
| Guests | 100 | 2.25 | 4.5 | 0.9 (M17 prisoners cannot crawl) | — | — | |

- **No stamina** [inf]. Health never regenerates. The first aid kit is the only healing.
- **Turn rate:** 540°/s for commandos [rec] (BEL turns are near-instant).
- **Collision:** a cylinder of radius 0.45 m [data: R10 = 0.45 m]. Units do not block each other; they get a soft separation of 0.5 m [rec].

### 3.2 Shared rules (every commando)
- **Stances and moves.**
  - Walk: click.
  - Run: double-click, within 350 ms and 6 px [rec].
  - Crawl: **C**. Stand: **S**.
  - "Commandos cannot fast crawl": a double-click while prone still crawls.
- **Heavy loads.** Carrying a body or barrel converts a run order into a walk.
- **Moving while prone.** A move order given while prone crawls the whole path. Stance changes take 0.5 s (down) or 0.6 s (up) [rec]; the unit cannot move during them.
- **Footprints.** Walking or running on snow or sand terrain leaves AI-visible footprints. Crawling leaves only a player-visible furrow (§4.8) [manual].
- **Hand (H).**
  - H or the hand button gives the pick-up cursor. It shows a "forbidden" overlay until it is over a valid target, then animates as a grab.
  - What can be picked up is gated by role (table below).
  - Pick-up takes 0.6 s (item) or 1.0 s (body or barrel) [rec].
- **Activation pointer (lever cursor)** appears on hover whenever the selected man can operate something. Durations:

  | Action | Duration [rec] |
  |---|---|
  | Doors he may hide behind | 0.5 s |
  | Switches, valves, phones, gates | 1.0 s |
  | Ladders (climb or lower) | 1.0 s |
  | Vehicles he may board | 0.5 s |
  | Manned-gun posts | 0.8 s |
  | Clothesline uniform (Spy) | 1.5 s |

- **Hiding in buildings.**
  - Enterable doors (`enterable:true`) hide the man inside: `state:'hidden'`, invisible to all.
  - A man inside cannot shoot and cannot bring a body in.
  - To exit, click his photo in the knapsack.
  - An enemy who sees him go in walks to the door and looks around for 6 s. He does not enter [rec].
- **Vehicles as passengers.** Capacities:

  | Vehicle | Seats [data] |
  |---|---|
  | Raft | 3 |
  | Motorcycle with sidecar | 2 |
  | Kübelwagen, Willys | 4 |
  | SdKfz, van | 5 |
  | Truck, Horch, drivable tanks | 6 |

  - Only the operator steers (§3.7).
  - Passengers can leave a boat only in shallow water. The Marine in diving gear can also leave in deep water.
- **Pistol (G)**, all six [manual; EXE weapon table]:

  | Property | Value |
  |---|---|
  | Range | **13.5 m** |
  | Damage | **80 per hit**. Enemy soldiers have 200 HP [inf], so **3 hits kill** [guide] |
  | Ammo | Unlimited |
  | Draw time | 0.3 s (Green Beret), 0.2 s (Spy, Driver), 0.25 s (others) |
  | Cadence | 0.15 s per shot minimum, one click = one shot |
  | Noise | **pistol noise, 18 m** (§4.4) |

  - While the pistol is drawn, left-click fires and move orders are refused; right-click holsters.
  - A unit already moving keeps moving and can fire when in range.
  - With several men selected, **G draws for everyone**. Each click then fires one volley from every selected man in range: group fire.
- **First aid kit (K).**
  - Carried by the first of these who is deployed: **Driver, then Spy, then Sniper**.
  - **6 doses** [guide; EXE default 3, retail missions 6].
  - Syringe cursor. Target yourself or any wounded commando or guest; the medic walks to within 1.2 m.
  - The animation lasts 1.5 s; **+34 HP** is applied at 0.5 s, capped at maximum [EXE].
  - Cannot be used while the target is in a vehicle or hidden.
- **Ladders.** Everyone climbs at 0.8 m/s [rec]. A raised ladder must be lowered from the top (activation, 1.0 s) by someone who got up another way.
- **Death.** HP ≤ 0 → `die` animation, the portrait becomes a skull, and the mission is lost (§8).
- **No knock-outs and no incapacitation.** Every neutralisation in BEL is a kill.

**Pick-up permissions (H)** [manual, characters.md]:

| Item | Who |
|---|---|
| Bodies | Green Beret, Spy |
| Explosive barrels | Green Beret |
| Raft | Marine |
| Grenades, time/remote bombs, air-dropped explosives | Sapper |
| Sprung trap | Sapper |
| Decoy | Green Beret |
| Sniper ammo box (+3) | Sniper |
| SMG (air-drop) | Driver |
| Uniform (clothesline) | Spy |
| Diving gear, knapsacks (scripted) | Owner |

### 3.3 Weapon and action table

`noise` refers to §4.4. "Kill" means instant death regardless of HP [EXE impact types].

| Ability (`id`) | Key | Who | Targeting | Range m | Effect | Timing | Noise |
|---|---|---|---|---|---|---|---|
| `knife` | X | GB, Marine (not the Marine in M7) | enemy | 1.2 reach; auto-walks (double-click = run) | Kill, blood spray and pool | Stab 0.6 s; kill at 0.3 s | none |
| `pistol` | G | all | point/enemy | 13.5 | 80 damage per hit | see §3.2 | pistol |
| `sniper` | R | Sniper | enemy/point | **45** | Kill, one shot | Kneel and aim 0.6 s; shot; **0.5 s reload**; limited ammo | none |
| `smg` | M | Driver (M1, M2, M10; M4 from the air-drop) | point/enemy | **18** | Burst of **5 rounds × 200 damage** (a round that hits kills a soldier: "kills in one hit" [guide: Kildread, CommandosHQ]), fan of 5 rays over ±15° [inf] | Burst 0.25 s; next burst after 0.8 s | smg |
| `harpoon` | J | Marine | enemy | **9** (200 u; a patched value may be 4.5) | Kill; works from land or from the water surface | Shot, then **3.0 s reload**; unlimited | none |
| `decoyDrop` | Q | GB | self | at feet | Places the acoustic decoy; an activator replaces it in the knapsack | Plant 0.8 s | — |
| `decoyToggle` | I | GB (holding the activator) | none | anywhere (radio) | Toggles beeping on or off | instant | decoy pulse |
| `shovel` | F | GB (M1–M11 only) | self | — | Buries himself: invisible (§3.4) | Dig 2.0 s; rise on right-click, 1.0 s | none |
| `climb` | (cursor) | GB | climbable edge | adjacent | Climbs a wall or cliff marked `climbable` | 0.5 m/s vertical [rec] | none |
| `carryBody` | H | GB, Spy | body | 1.2 | Picks up / right-click drops | 1.0 s / 0.8 s | none |
| `carryBarrel` | H | GB | barrel | 1.2 | Picks up / drops; click a body while carrying = hide the body under the barrel | 1.0 s / 0.8 s | none |
| `trap` | J | Sapper | point | 1.5 | Bear trap, invisible to enemies. The first enemy within 0.5 m dies silently. Then it is sprung and must be picked up (H) and re-set | Set 1.0 s; pick up 1.0 s | none |
| `timeBomb` | B | Sapper | self | at feet | Explodes **10.0 s** after release [manual/data] | Plant 1.0 s | explosion |
| `remoteBomb` | B | Sapper | self | at feet | Armed; a detonator appears | Plant 1.0 s | — |
| `detonate` | A | Sapper | none | anywhere | Detonates the **next** remote bomb, in placement order | instant | explosion |
| `grenade` | E | Sapper | point | throw **13.5**, lobbed over walls | Explodes on landing (flight about 1.0 s). Class `grenade` (§3.6). Can hurt the thrower and friends | Throw 0.7 s | explosion |
| `cutters` | W | Sapper | fence | 1.0 | Cuts a 1.5 m gap in `fence` cells. Fails on `reinforced` wire. On a live `electric` fence: 20 electric damage and the cut fails | 3.0 s [rec] | none |
| `firstAid` | K | medic | commando | 1.2 | +34 HP, one dose | 1.5 s | none |
| `syringe` | L | Spy | enemy | 1.2 (double-click = run) | Kill, no blood | 0.9 s; kill at 0.5 s [rec: "slightly slower than the knife"] | none |
| `uniform` | U | Spy | self | — | Re-dress. Only when **no enemy currently has him inside a cone** | 1.5 s | none |
| `distract` | D | Spy, in uniform | enemy | walks to within 1.5 m | Talks to the target (§3.4) | Until released | none |
| `dive` | D | Marine | self | — | Diving gear on or off. The icon appears only in shallow water or aboard a boat | 1.5 s | none |
| `raft` | T | Marine | self | — | Deploys the raft; **shallow water only** | 2.0 s | none |
| `crawl` / `stand` | C / S | all | self | — | Stance change | 0.5 s / 0.6 s | none |
| `hand` | H | all | item/body/barrel/raft | 1.2 | Role-gated pick-up | 0.6–1.0 s | none |
| `vehicleFire` | Ctrl+click | the operator of an armed vehicle or manned gun | point | per weapon (§4.1) | Fires a volley; turrets rotate first (90°/s) | per weapon | mg or cannon |

**Out-of-range feedback.** The targeting cursor shows the red **forbidden** overlay whenever the action is impossible at that spot: out of range, no LOS, wrong terrain or wrong target type. Right-click or Esc cancels targeting.

**Auto-walk.** Melee abilities and `hand` make the unit walk into range first, or run on a double-click. They cancel if the target moves more than 3 m from where it was clicked [rec].
- **From a crawl (knife, BCD knock-outs, handcuffs, hanger).** A click crawls him in at crawl speed; he stands up (0.6 s) only within 1.0 m of the ability's reach (`CONFIG.abilities.crawlStandLead`), then steps in and acts. A double-click is urgent: he stands up at once and runs in. The 3 m cancel rule is unchanged: a crawler cannot catch a walking guard anyway. The give-up time is stretched by walk/crawl speed. **Deliberate change from BEL**, which stood him up at the click (user request, 2026-10-01).

### 3.4 Per-commando behaviour details

The animation names are the humanoid names from ARCHITECTURE. Each voice cue is a key into the bark table in §9.4.

**Green Beret: Tiny**
- **Knife (X).**
  - Click an enemy: he walks up and stabs. Double-click: he runs up (the "sprint-kill").
  - Clicked from a crawl: he crawls up and stands up only when close (reach + 1.0 m), then stabs. A double-click from a crawl stands him up at once and runs in (§3.3 Auto-walk; a deliberate change from BEL).
  - Animation `stab`, with the kill on frame 0.3 s. Blood decal, and the body drops with `die` → `dead`.
  - Works on any living enemy on foot at ground level. It cannot reach tower or bunker crews, vehicle crews or mounted gunners behind armour.
  - Voice `act_kill` (50% chance) [rec].
- **Decoy (Q, then I).**
  1. **Q** plants it at his feet (`plant`, 0.8 s). The knapsack icon becomes the activator.
  2. **I** toggles beeping from anywhere.
  3. While on, it emits a **decoy noise pulse every 1.5 s** (`INTERVALOSND 30`) with a 13.5 m radius (§4.4).
  4. **H** on the decoy picks it up again (he must walk to it). This restores the Q item and cancels the activator.
  - Enemies react as in §4.6 `DECOY`. The BEEP technique (toggling it on and off quickly to pull one or two guards) must work: each pulse is a separate stimulus.
  - SFX `decoy_beep`, positional.
- **Shovel (F).**
  - Allowed only when the ground cell is `SNOW` or `SAND`, and only in missions 1–11.
  - `use` animation for 2.0 s, with a snow or sand spray FX. He then becomes `state:'hidden'` with `buried:true` and a slight mound decal.
  - Enemies can walk over him. Right-click (or F) rises in 1.0 s.
  - **Witness rule:** any enemy whose cone contained him during the dig keeps seeing him while he stays in that enemy's cone (near band only). That enemy reacts as if he were a crawling commando.
- **Climb (climbing axe).**
  - Hovering over a `climbable` wall or cliff edge shows the pick cursor. Click and he walks to the base and climbs (`climb`, 0.5 m/s).
  - At the top he stands on the top node. Click the far-side ground to climb down.
  - Right-click mid-climb makes him **hang** (freeze) until the next click.
  - Climbing is visible (he counts as standing).
  - Only walls and cliffs marked `climbable` can be climbed. Mission data defines them as climb links: pairs of nodes, the original's SEC "connections".
- **Carry a body (H).** 1.0 s to pick up. `carry_walk` at 1.6 m/s. Right-click drops the body (0.8 s). He cannot run, cannot enter buildings and cannot climb while carrying.
- **Carry a barrel (H).** Same rules. Right-click drops it upright.
  - Hovering a body while carrying shows the body-in-barrel cursor. Click it: he drops the barrel **onto** the body, and the body is removed from perception (`hiddenUnderBarrel`). One barrel hides one body.
- **Voice cues:** `select`, `ack_move`, `ack_act`, `cant`, `hurt`, `death`, `spotted`.

**Sniper: Duke**
- **Rifle (R).**
  - Scope cursor: an 88-reference-px circular lens with a thick bezel and hair crosshairs. It shows the view under it **magnified 2×** (render-to-texture). A green corner-bracket box with a red dot marks an enemy under the crosshair.
  - The lens turns red with the forbidden slash when the target is beyond 45 m or out of LOS.
  - Click: he **kneels** (`aim`, 0.6 s), fires (`shoot`), and the target dies instantly. Faint tracer and sharp crack SFX; **no noise event**. Then 0.5 s bolt-cycle before he can shoot again.
  - A kneeling Sniper counts as *standing*: he is visible in the far band.
  - He can fire from a boat.
  - He can kill tower and elevated MG gunners and open bunker crews, but **not** covered towers or bunkers, which need explosives [guide].
- **Ammo.** Limited per mission and shown as a row of brass cartridges on the knapsack. At 0 rounds the R icon greys out and he says `cant_noammo`.
  - An ammo box pickup gives **+3** [data: `CAJABALA .BALAS 3`].
- **Pistol (G)** and the medic role when neither the Driver nor the Spy is deployed.

**Marine: Fins**
- **Harpoon (J).** 9 m range, silent instant kill, 3.0 s reload, unlimited.
  - From the water he surfaces (the `swim` stance becomes visible as a low target, near band only), fires, and submerges again automatically if he is still in dive mode.
- **Diving gear (D).**
  - The D icon is shown only while he stands in `SHALLOW` water or sits in a boat.
  - Put on (1.5 s, `use`): stance becomes `dive`. He moves through `WATER`/`SHALLOW` cells at 1.8 m/s and pathfinds with `{swim:true}`.
  - **Submerged he is invisible**, except to witnesses: any enemy that had him in cone when he went under keeps him as a near-band-only target while he stays in that cone.
  - Taking the gear off works only in shallow water (1.5 s); he stands up.
  - Bubble-trail FX, SFX `dive_splash`.
  - No oxygen limit [inf: none mentioned in BEL].
- **Knife from the water.** He can knife an enemy standing within 1.2 m of the shoreline; he surfaces for 0.6 s to do it.
- **Raft (T / H).**
  - **T deploys it only when he stands in `SHALLOW` water** (2.0 s): an inflation animation, then a `raft` vehicle.
  - Only he rows it. Capacity 3 (him plus 2). Rowing speed 2.5 m/s, with the river current added (`water.velocity`, §7.3).
  - He boards first. Others board by clicking the raft while it sits in shallow water.
  - **H on the raft** from shallow water or the bank deflates and packs it (2.0 s). Carrying it slows him (see §3.1).
  - **An unattended deployed raft is suspicious.** Enemies who see it shoot it; it deflates (it is not destroyed) and becomes a pickup on the spot. On-site rafts that nobody has used yet are not suspicious.
- **Other craft.** He is the only operator of water craft: patrol boat (M4, auto), rowboats (M7, M14, M19), and the mini-sub (M13; 2 torpedoes, §7.1).
- He **cannot carry bodies**.

**Sapper: Inferno**
- **Bear trap (J).**
  - Place on a walkable ground cell within 1.5 m (1.0 s, `plant`). It is invisible to enemies.
  - The first **enemy** whose position comes within 0.5 m dies instantly and silently (`CEPO`). Commandos do not trigger it [inf].
  - The trap then shows as sprung (player-visible) and can be reused only after H (1.0 s) and J again.
  - **Lure pattern:** walking on snow leaves footprints that an investigating guard follows into the trap (M2). This must work.
- **Time bomb (B).**
  - Drop it at his feet (1.0 s). Ticking SFX (`bomb_tick`, 2 Hz, speeding to 4 Hz in the last 3 s).
  - Explodes **10.0 s** after release [manual]. Explosion class `bomb` (§3.6).
  - Missions give either time bombs or remote bombs, never both [data].
- **Remote bomb (B then A).**
  - Plant: the knapsack gains the **detonator**, which shows a count of bombs planted.
  - Each **A** press detonates the **oldest** remaining planted bomb, after a 0.2 s radio delay. SFX `detonator_click`.
- **Grenade (E).**
  - Arc throw to a point within 13.5 m, over walls; flight 1.0 s; bursts on landing.
  - Class `grenade`. Friendly fire is on.
  - Loud: noise class `explosion`.
- **Wire cutters (W).**
  - Click a fence segment: he kneels 3.0 s, then the `B.FENCE` cells in a 1.5 m-wide gap become passable. A hole mesh swaps in.
  - Variants: `reinforced` is immune. On `electric` while powered: 20 damage (`ELECTRICO`), sparks and failure.
- He is the **only** one who picks up explosives.

**Driver: Tread**
- **SMG (M).** Only in the missions whose loadout lists it (§3.8).
  - The knapsack shows **bursts remaining = rounds ÷ 5**. A mission gives 100 rounds, which shows as 20 [data].
  - Each click fires one 5-round burst in a ±15° fan out to 18 m; every round that hits deals 100 damage.
  - SFX `smg_burst`; noise class `smg`.
- **Drive** land vehicles, and the truck only (as the Spy) in M16 (§3.7).
- **Man fixed guns.** After the gunner is dead, activate the gun (0.8 s) to mount it. Then Ctrl+click fires. Click his portrait photo to dismount.
  - A manned gun leaves him exposed: he counts as standing.
  - The 210 mm mortar and the M20 anti-tank gun can never be manned [guide].
- **Medic (K)** first in the chain.
- He has **no silent kill**.

**Spy: Spooky**
- **Syringe (L).** Melee, 1.2 m; double-click runs up. 0.9 s, kill at 0.5 s, **no blood decal**, unlimited.
- **Uniform.**
  - Picked from a clothesline (activation, 1.5 s). The model swaps to a German officer's uniform (`setDisguise(true)`).
  - Some missions start disguised (`startDisguised`).
  - While disguised, **every enemy ignores him** (no nervousness, no challenge) unless he is *seen* doing something suspicious:
    - killing or injecting;
    - carrying a body;
    - moving with the syringe or pistol cursor armed;
    - running;
    - opening an enterable door or boarding a vehicle.

    The first three are [manual/guide]; running is [inf]; the door rule is [inf: `DESCUBREESPIA` default 1].
  - **When unmasked:**
    - the uniform returns to the knapsack;
    - the model swaps back;
    - he emits a level-1 noise (9 m);
    - the witness goes straight to CHALLENGE (N = 1000) and shouts `spy_unmask`.
  - **U re-dresses** him only when no enemy's cone currently contains him (1.5 s).
  - He cannot choose a rank. No BEL enemy sees through the disguise; `sergeantsSeeThroughDisguise` is a BCD flag.
- **Distract (D, in uniform).**
  1. He walks to within 1.5 m of the target and says `spy_distract` (German).
  2. The target stops, turns to face him and stays put. Its cone points at the Spy, so where the Spy stands decides where the guard looks.
  - **It lasts indefinitely**, until one of these ends it:
    - a right-click;
    - a new order to the Spy;
    - the Spy moving more than 3 m away;
    - the target hearing a noise of level 2 or more (gunfire, explosion, shout);
    - an alarm reaching the target's zone;
    - the Spy being unmasked.
  - **Distracting a patrol's leader freezes the whole squad** in place, facing the leader.
  - The standard combination is the Spy distracting while the Green Beret knifes the target from behind. It must work.
- **Carry a body (H)**, the same as the Green Beret. Seen carrying a body → unmasked.
- **Medic (K)** when the Driver is absent.
- He can climb ladders but **not** walls.

### 3.5 Guests (key 7)
- **Behaviour.**
  - Guests are unarmed `Commando`s with `role:'guest'`. They cannot use items. Enemies treat them as commandos.
  - They start `state:'jailed'` and are freed by activating the jail door (§4.10).
- **Losing one:** a guest's death fails the mission [inf].
- **The guests:**
  - **McRae** (M10) is the only one who can fly the Ju 52.
  - **The Informer** (M12).
  - **Gilbert + 4** (M17) move as one group: an order to Gilbert makes the other four follow in single file at 1.0 m spacing. They can run but **cannot crawl**.

### 3.6 Explosion classes [EXE/data where given; radii rec where not]

| Class | Lethal radius | Damage radius | Structures | Noise | Chain |
|---|---|---|---|---|---|
| `bomb` (time/remote) | **6.75 m**: instant death (`BOMBA`) [data: `.RADIO 150`] | — | Destroys any `destructible` whose footprint is within 6.75 m. Demolition objectives need the bomb **within 3 m** of their `explosiveTarget` marker | explosion (map-wide) | Ignites barrels within 6.75 m |
| `barrel` (fuel drum) | 5.0 m instant death | 6.75 m: 100 damage | Destroys destructibles within 6.75 m (a barrel next to a barracks razes it) | explosion | Ignites other barrels within 6.75 m after 0.2 s |
| `grenade` | 4.5 m: 200 damage | 6.75 m: 100 damage | Destroys only props flagged `grenadeDestructible` (Panzer II, trucks, cars, light gates, open towers) | explosion | Ignites barrels within 4.5 m |
| `vehicle` (wreck blast) | — | **9 m: 180 damage** (kills everyone except a full-HP Tiny) [data `.DANO 180 .RADIO 200`] | Destroys light props | explosion | Yes |
| `shell` (tank cannon) | 2.25 m instant death | 4.5 m: 150 damage | Destroys anything but bunkers | explosion | Yes |

- **Fuel tanker (Opel Blitz):** any hit explodes it as `vehicle` + `barrel`.
- **Shooting a barrel** with any bullet or vehicle weapon detonates it.
- **Fire:** burning wrecks and oil deal 100 damage per second (`FUEGO`) inside their fire cells [EXE: fire = 100].
- Bunkers and covered towers are `bombOnly`.
- Barracks are destructible unless flagged `indestructible` (M2 and M10 barracks per fandom).

### 3.7 Driving and water craft (the operator's rules) [manual]
- **Who operates what:**

  | Craft | Operator |
  |---|---|
  | Land vehicles | Driver (Spy in M16) |
  | Water craft | Marine |
  | Plane | McRae |

  To move a vehicle, select its operator.
- **No pathfinding.**
  - Click a point: the vehicle turns (tank 45°/s, truck 60°/s, boats 45°/s, the Marine's raft 120°/s [rec]) and drives in a **straight line**. It stops at the first blocking cell.
  - Shift+click is unused. Steer with successive clicks.
  - The forbidden cursor shows on points that cannot be reached in a straight line.
- **Speeds** [rec]:

  | Vehicle | Click (slow) | Double-click (fast) |
  |---|---|---|
  | Truck, car | 3 m/s | 9 m/s |
  | Tank, half-track | 2 m/s | 5 m/s |
  | Motorcycle | — | 10 m/s |
  | Boats | 2.5 m/s | 4 m/s |

- **Run-over (`ATROPELLO`).**
  - At fast speed, any enemy in the front sensor box (1.8–5.4 m ahead, ±1.35 m) dies. The kill is silent.
  - At slow speed, enemies step aside, turn and shoot.
  - Friendly units in the box are also killed.
- **Getting out (door side)** [rec, vehicle integration]. Units step out on the side of their seat's door. Period vehicles
  are left-hand drive: the driver (first seat) gets out on the vehicle's **left**, the co-driver on the right, rear seats
  alternate one row further back. The BMW R75's sidecar is on the **right**: the rider steps off left, the sidecar
  passenger right. Truck passengers (seat 3+) use the tailgate; everyone in the Sd.Kfz. 251 half-track uses its rear
  doors; the Ju 52 cabin door is on the left. Boats keep the bank rule. That seat's door or hatch visibly opens and closes.
  A click on a point still overrides the side (nearest free cell to it).
- **Vehicle footprints** match the real models (m, length × width): Opel Blitz 6.3 × 2.4, Horch 901 4.9 × 1.9,
  Citroën 4.8 × 1.9, BMW R75 with sidecar 2.3 × 1.7, Panzer IV 6.6 × 2.9, Sd.Kfz. 251 / 231 5.9 × 2.2.
- **Ramming barriers.** Barriers and light gates break at fast speed.
  - *Addendum (gate smash).* The fast-speed rule stands: a slow (click) order still stops at the first blocking cell, in
    front of the gate. How a gate breaks is physical. At the moment the bumper reaches the gate plane, the impulse
    J = vehicle mass × speed is compared with the gate's strength [rec]:

    | Gate kind (variants) | Hold below | Shatter from | Break work (speed loss) |
    |---|---|---|---|
    | Plank (palisade / plank double or single gate, barn / garage doors) | 3 000 N·s | 24 000 N·s | 6 000 N·s |
    | Boom (`barrier_boom`) | 800 N·s | 9 000 N·s | 1 200 N·s |
    | Wire / frame (chainlink, mesh, iron, jail door) | 3 500 N·s | 30 000 N·s | 7 000 N·s |

    Masses [rec]: truck 3.5 t, car 1.3 t, Kübelwagen 0.75 t, motorcycle 0.26 t, tank 9.5 t, SdKfz 8 t.
    - **Hold** (J below the hold threshold, e.g. a fast order started with the nose on the gate): the vehicle stops, the
      leaves bow and spring back, a creak. The gate stays shut.
    - **Burst**: the more-struck leaf is torn off its hinges and thrown ahead. The other swings open, hanging on its
      upper hinge if the bumper caught it. Planks near the bumper crack off. A boom pole snaps at the seam nearest the
      impact; the stub stays on the pivot and the counterweight swings it up.
    - **Shatter** (the M2 escape truck at 9 m/s: J 31 500): the more-struck leaf comes apart into boards and rail
      halves and is thrown ahead. The other leaf stays one large chunk (rails, Z-brace, most boards; only boards the
      bumper caught crack off) hanging on its upper hinge. A hanging leaf that the vehicle drives into a wall tears
      that hinge too and drops flat. A boom pole snaps in two or three places, and the pieces spin away.
    - A board that breaks at a seam shows a jagged, torn end of fresh wood, and throws a short splinter or two.
    - The vehicle loses `work / J + m_gate / (m_gate + m)` of its speed (4–70 %). For 0.9 s it re-accelerates at 12 %
      of its normal rate. The body pitches forward a few degrees (truck ≈ 3°, car ≈ 5°). Rolling over flat wreckage
      gives small bumps.
    - The pieces are Rapier bodies (bodies-design §A). They collide with the ground, walls, props, units and each
      other, and the vehicle shoves them. A piece freezes into static wreckage only when it has come to rest lying
      down and clear of the walls. A piece that stops standing on end (or a slab standing on edge) is tipped over away
      from the gate line first. Pieces settle in about 4 s; 9 s is a safety cap.
      The wreckage is never stamped on the NavGrid: only the gate's own cells clear, so the gap is passable for units
      and vehicles. The break is deterministic (seed = hash(gate id, tick)), and it survives save and load (a
      snapshot while pieces move).
    - The noise and alarm are unchanged: a `crash` noise of `ramNoise` 20 m, never an explosion. Sounds: a splintering
      crack, hinge straps snapping, and landing thuds (CC0, `assets/audio/CREDITS.md`). FX: wood splinters and chips,
      a snow / dust / sand puff at the base, and snow clumps off the top rail in winter theaters.
- **Tainted vehicles.** An enemy who sees a commando board a vehicle marks it `tainted`. From then on **every enemy who sees it attacks it until it is destroyed**, even when empty. This is the M15 trick.
- **Vehicle HP** in hits [data `.IMPACTOS`]:

  | Vehicle | Bullets to destroy | Explosions |
  |---|---|---|
  | Truck, Jeep, Horch | 30 | Destroyed by any grenade, bomb or shell |
  | Kübelwagen | 20 | Same |
  | Car, van | 60 | Same |
  | SdKfz | 500 | Same |
  | Panzer II (enemy) | 1000 (drivable Panzer II: immune) | Grenades destroy it |
  | Panzer III / IV | Immune to bullets | Immune to grenades; only bombs and shells destroy them |

- **Armed vehicles** fire on Ctrl+click:

  | Weapon | Damage | Burst | Pause between bursts | Range |
  |---|---|---|---|---|
  | Tank MG | 110 per hit | 10 rounds at 10 rounds/s | 0.25 s | 45 m [data PNZ2] |
  | Tank cannon | `shell` | — | Reload 1.5 s [data `.RECARGA 30`] | Minimum 13.5 m [data] |

- **Wrecks** keep burning for 20 s, then remain as `B.HIGH` obstacles [guide: burnt tanks block paths].
- **Exiting:** click the operator's photo in the knapsack. Passengers step out onto walkable cells within 3 m.
- **Trains** kill anything on the rails in their box (−31.5 to +16 m along the track, ±3.4 m across) [data]. They stop when a vehicle is on the track (the M4 trick). They also block line of sight.

### 3.8 Starting loadouts per BEL mission [guide: Kildread, confirmed by gap reports]

Every commando also carries a pistol. "(site)" marks items found on the map.

| # | Team | Sniper rounds | Sapper | Driver | Medic (6 doses) | Other kit and on-site items |
|---|---|---|---|---|---|---|
| 1 | GB, Ma, Dr | – | – | SMG (100) | Dr | GB: knife, decoy, shovel. Ma: knife, harpoon, diving gear; raft (site). 5 barrels, truck, MG nest (site) |
| 2 | GB, Sn, Ma, Sa, Dr | 5 | trap, 2 time bombs | SMG (100) | Dr | Ma: raft carried. 4 barrels, truck (site) |
| 3 | GB, Ma, Sa, Sp | – | trap, cutters, 2 time bombs (site) | – | Sp | Uniform (site), raft (site), electric-fence switch |
| 4 | GB, Sn, Ma, Sa, Dr | 4 (+3 air-drop) | trap, 3 grenades, 1 time bomb (air-drop) | SMG (air-drop) | Dr | Ma: raft carried (file `IT_BALSA`; Kildread "Pneumatic Boat"). Patrol boat, Panzer II, motorcycle, truck, 3 MG nests |
| 5 | GB, Sp | – | – | – | Sp | 3 barrels, uniform (site), cable car, 2 phones, mines |
| 6 | GB, Sn, Sa | 5 | trap, 2 remote bombs | – | Sn | — |
| 7 | GB, Ma (**no knife**), Sa, Dr, Sp | – | trap, 4 time bombs (air-drop) | – | Dr | Rowboat, half-track, 2 barrels, uniform (site) |
| 8 | GB, Sn | 6 | – | – | Sn | 10 barrels |
| 9 | GB, Sn, Sa, Dr, Sp | 5 | trap, 2 remote bombs | – | Dr | Spy starts disguised. Opel Blitz, 4 barrels |
| 10 | GB, Sn, Sa, Dr + McRae | 3 | trap, 4 grenades, 1 time bomb | SMG (100) | Dr | Vacant Panzer IV, Ju 52, 4 barrels |
| 11 | GB, Sn, Sa, Dr, Sp | 5 | trap, 1 grenade, 3 remote bombs | – | Dr | Spy starts disguised. Half-track, MG nest, 5 barrels |
| 12 | GB (decoy only; **no shovel from here on**), Sn, Sp + Informer | 7 | – | – | Sp | Spy starts disguised |
| 13 | GB, Sn, Ma, Sa, Dr | 4 | trap, 1 remote bomb | – | Dr | Mini-sub (2 torpedoes), truck, 2 barrels, pier gun |
| 14 | GB, Sn, Ma, Sa, Dr | 8 | trap, 3 remote bombs | – | Dr | Panzer II, 5 MG nests, rowboat, 3 barrels |
| 15 | Sn, Ma, Dr, Sp | 4 | – | – | Dr | 2 Citroën 15CV, Opel Blitz, truck, uniform (balcony) |
| 16 | Sn, Ma, Sp | 5 | – | – | Sp | Uniform (site); **the Spy can drive the truck** |
| 17 | GB, Ma, Sp + Gilbert & 4 | – | – | – | Sp | Spy starts disguised. 1 barrel, raft |
| 18 | GB, Ma, Sa, Dr | – | trap, 2 grenades + 3 remote bombs (site) | – | Dr | Panzer III, 2 MG nests, truck, raft (site), 4 barrels |
| 19 | GB, Sn, Ma, Sa | 7 | trap, 2 remote bombs | – | Sn | Rowboat (site), 4 barrels |
| 20 | all six | 5 [inf] | trap [inf], 2 grenades, 2 remote bombs [inf: sources say 1–2] | – | Dr [inf] | Uniform (site, W quarter), Panzer III |

---

## 4. Enemies

### 4.1 Roster (`soldierType`) and archetypes

**Behaviour flags per spawn** [data macros]:
- `holdsPost`: BANPE1/BAP1. Never walks to investigate; only turns toward a stimulus.
- `investigates`: BANPE2/BAP2. Walks to noises, tracks and bodies, then returns.
- `followsTracks`: patrols have it by default (`SIGUEHUELLAS 1`); the investigating types have it too.

| `soldierType` | Look | Weapon | Weapon range | Vision profile (§4.2) | Behaviour |
|---|---|---|---|---|---|
| `sentry` | Helmet, greatcoat (Norway, winter) or desert tunic | Kar98k rifle: 80 damage per hit, one shot every 1.0 s [rec], aim 0.5 s | 36 m | soldier | Static post with a sine sweep. Idles by smoking; its attention does not drop [rec]. If `partner` is set, it glances at the partner every 25 s for 2.5 s [EXE `TIEMPOENTREMIRADAS 500`, `TIEMPOMIRANDOCOMPA 50`]. Holds a challenged commando at gunpoint and waits for a patrol or NCO; it does not fire unless the rules in §4.5 say so |
| `soldier` | same | Rifle | 36 m | soldier | Walks a route (`LOOP` or `PINGPONG`) with waits and look headings. "If they detect you, they abandon their rounds" (manual) |
| `sergeant` | Peaked cap, Luger | Pistol: 80 damage, 0.5 s cadence | 13.5 m | soldier | Patrol leader (NCO). **Decides arrest or fire**. Distracting him freezes the squad |
| `trooper` | Helmet, MP40 | Bursts of 5 × 100 damage every 1.0 s [inf/rec] | 18 m | soldier | Patrol member; follows the leader's breadcrumbs at 1.2 m spacing in `columns` (1–2) |
| `mg` | Helmet, MG34 | 100 damage per round, 5-round bursts, 0.25 s apart [EXE `TIEMPO_RECARGA 5`] | **28.8 m** (the cone's far edge; manual: "very long and lethal") | mg | Nest, tower or bunker gunner. **Fires on sight, with no nervousness** [EXE]. Traverse limited to `giro` 90° or 180° around the post heading. Its bursts are level-3 noise |
| `officer` | Officer's uniform | none | – | soldier (cone drawn, but no reaction) | Drives trucks back and forth. **Ignores commandos completely and never raises the alarm** [guide] |
| `truckDriver` | Cap | none | – | no cone; hull box only | Transport vehicle crew. Runs commandos over. Never alarms (M4: "won't even yell") |
| `courier` | Motorcyclist | none | – | soldier | If he sees anything suspicious he mounts and rides a scripted exit route to the barracks, then fires that zone's event (`REXT`). Killable en route (M4) |
| `crew` (tank/SdKfz) | Black Panzer uniform | Vehicle weapons | per vehicle | tank or sdkfz | Stops and fires (`PARAYDISPARA`). Ignores bodies |
| `gunner` (artillery) | Helmet | 210 mm mortar or cannon | map-wide on vehicles | cannon | Fires on sight at vehicles; the mortar kills any vehicle in one shot. Never manned by a commando |
| `engineer` (M16 sapper) | Pioneer | none | – | soldier | **At the slightest alarm or suspicion he runs to his detonator** (4.5 m/s), and on arrival the bridge blows (fail). Each needs 3 pistol hits (200 HP) |
| `general` (M15 Schleper) | SS general | none | – | soldier (no reaction) | Garden walk loop. Never raises the alarm himself. **On any alarm he runs to the nearest reachable staff car** and leaves; failure happens only when he reaches the car [inf] |
| `dog` (M19 only) | Alsatian | Bite: 25 damage, 1 bite per 1.0 s [EXE 25; rec cadence] | 1.2 m | dog | Follows its handler. **Barks** (level 2) when it sees a commando, which alerts soldiers. Caged dogs only bark |
| `tutorial` | Allied in disguise | Blanks | – | soldier | Training missions only; cannot harm anyone |

- **Enemy HP:** 200 [inf], so 3 pistol hits kill.
  - Knife, harpoon, syringe, trap, sniper, bomb and crush kill instantly.
  - SMG bursts kill.
  - A wounded soldier (1–2 pistol hits) screams `ger_hurt`, turns aggressive and hunts the shooter.
- **Enemy accuracy** is deterministic [rec, following the Mimimi "binary rules" lesson]: every enemy shot at a target in range and in LOS at the moment of firing **hits**. The counterplay is not being seen: "When your men are shot at, they usually die" [guide].
- **Patrol squads:**
  - The leader (`sergeant`) follows the route. Troopers follow in `columns` at a spacing of 1.2 m.
  - Speed = `VEL` × 0.9 m/s; the default VEL is 1.0 [data; VEL treated as absolute u/tick, gap-2 open point].
  - The patrol stops at waypoints with `wait` and sweeps with `VIGILARDEF` amplitude 50° and period 2.5 s [data].
  - **Kill one member in view of the others**, or the others find him, and the squad raises the alarm at once [guide].
  - With no jail on the map, patrols **fire on sight** [guide].
- **Route types** [data]:

  | Type | Order |
  |---|---|
  | `LOOP` | A→B→C→A |
  | `PINGPONG` | A→B→C→B→A |
  | `STOPPED` | stays put |
  | `EXIT` | scripted vehicle route, then despawn |

  - Waypoint fields: `{x, z, wait (s), look (deg), speed? (VEL)}`.
  - Route speed = VEL × 0.9 m/s. Reaction squads use VEL 3 = **2.7 m/s** to exit the barracks, then VEL 2 = **1.8 m/s** on their loop.
- **Other enemy speeds:**
  - Investigating walk: 1.8 m/s [rec].
  - Chase/run: 3.8 m/s [data: German run stride 55 vs commando 75].
  - Body turn: 180°/s [rec]; head turn: instant (`PASO 90` per vision update) [EXE].
  - **SHADOW SIX smooth turn** (a deliberate change from BEL's instant head turn; `CONFIG.ai.turn`, all [rec]). A guard
    turning to something on the spot — any heard noise (running steps, shots, barks, "Halt!", alarm shouts, blasts,
    decoys / phones / horns), a lure he walks to, a body he found, the Spy talking to him, the partner glance, a post's
    turn back to its heading (BCD: a stone's click, a cigarette pack, the lipstick, a revive) — turns at an eased, steady
    rate: accelerate at 1000°/s², cruise at the 180°/s body turn, brake onto the bearing (180° ≈ 1.15 s, 90° ≈ 0.65 s,
    45° ≈ 0.4 s); an investigator / a lured walker turns first, then walks. The cone turns with the body every step, so he sees only what it actually sweeps over (a runner who gets out
    of sight before it comes round is not seen). For the turn the head sweep stops and fades back in over 1 s after it;
    a head turned away when the turn begins comes round with the body (≤ 240°/s), so the cone never jumps. "Halt!"
    (CHALLENGE / HOLD): the cone swings onto the commando at 360°/s and stays on him while the body turns to him at the
    eased rate. **Kept instant:** an MG / gun crew / caged dog / man in a vehicle tracking a target it fights (the gun
    traverses with the target, §4.1), a crew's heading in its vehicle, mission scripts that set headings, a BCD officer
    watching a Spy he recognised, an animal's attack, the player's puppet; COMBAT keeps BEL's linear 180°/s body turn.
    Visual: a turning German steps round on the spot (feet planted, alternate steps, head leading — art/turn-step.js).

### 4.2 Vision cones (logic = display)

**Base profile, `soldier`** [EXE `Vista01` defaults]:
- **Full aperture 70°**: edges at head heading ± 35°.
- **Near band 18.0 m** (MOD 400 u) and **far edge 36.0 m** (2 × MOD).
- Eye height 1.65 m.

**All profiles** (the `CONFIG.stealth.vision[profile]` values):

| Profile | Aperture | Near m | Far m | Sweep amplitude A | Period P | Elliptical |
|---|---|---|---|---|---|---|
| `soldier` | 70° | 18.0 | 36.0 | per spawn 35–50°, default 50° | Sentries 5.0 s (`DEMORA 100`); patrols at waits 2.5 s (`DEMORA 50`) | **yes** |
| `dog` | 90° | 18.0 | 36.0 | 40° | 5.0 s | yes |
| `mg` (nest or tower) | 40° | 14.4 | 28.8 | 35–60°, default 50° | 5.0 s | no |
| `bunker` | 40° | per mission, default 18 | default 36 | 50° | 5.0 s | no |
| `cannon` | 70° | 18.0 | 36.0 | 20° | 5.0 s | no |
| `tank` (Panzer II/III/IV crew) | 70° | 22.5 | 45.0 | 155° | 5.0 s | no |
| `sdkfz` | 40° | 24.75 | 49.5 | 155° | 5.0 s | no |
| `truck` | none: only a run-over sensor box 1.8–5.4 m ahead, ±1.35 m | – | – | – | – | – |
| `train` | polygon: −31.5 to +16 m along the track, ±3.4 m | – | – | – | – | – |

**Sweep.**
- Head yaw offset: `θ(t) = A · sin(2π·t/P + φ)`. The phase φ is a per-enemy random 0–1.0 s from the seeded RNG, so guards do not sweep in sync [EXE].
- Sentries and posts sweep continuously. Walkers look along their path (θ = 0) and sweep only during waypoint waits.
- A `look` heading on a waypoint sets the body heading for the wait.
- Posts may override A and P per spawn: `post:{heading, sweep:A, period:P}`.

**Elliptical range** [EXE `VISTAELIPTICA`, default on]:
- `far(θ) = a·b / √((b·cosθ)² + (a·sinθ)²)`, with a = far and **b = a/3**; `near(θ) = far(θ)/2`.
- So the cone shrinks to 42% of its length at θ = ±50°.
- This makes flanking shots at a sweeping guard viable. It is a key feel parameter.
- `CONFIG.stealth.ellipseMode`:

  | Mode | Effect |
  |---|---|
  | `'classic'` (default) | b = a/3 |
  | `'wide'` | b = a (no shrink) |
  | `'short'` | b = a/3 and all ranges × 0.75 |

  These match the demo's skill-dependent branches; the retail value is unknown.
- Off for `mg`, `bunker`, `cannon`, `tank` and `sdkfz`.

**Occlusion** [EXE, grid API]:
- Line of sight is a grid DDA from the viewer's cell to the target's cell.
  - `B.HIGH` (walls, buildings, rocks, trees marked `occluder`, cliffs) blocks sight **at every height, towers included**.
  - `B.FENCE` never blocks.
  - `B.LOW` blocks only when the target is low (crawling, swimming, or a body) **and** the viewer is not elevated (`elevated:true` for towers, walls and roofs).
  - A 2 m bush blocks only low targets [rec].
- **Vehicles occlude** (`OCLU`): trucks, tanks, trains and boats stamp their footprint into a dynamic `occluder` layer every tick. They hide units behind them even though the drawn cone may pass through them (the manual's own caveat). The drawn cone must also be cut by them (§10.2).
- **Roof levels (M12):** a unit on a roof (`y ≥ 2.5 m`) is invisible to viewers below who are more than 2 m lower, and vice versa. This is the rule that "silent actions on the roofs will not be seen by guards on the lower levels" [guide].

**Detection is instant** [EXE]: the first perception tick on which a valid target lies inside the cone polygon for its band, with LOS, counts as seen. There is no suspicion meter; the reaction delay comes from nervousness (§4.5).

**Band rule** [manual, EXE flags `0x810002`]:

| Target | Near band (≤ near(θ)) | Far band (near–far) |
|---|---|---|
| Commando standing, walking, running, kneeling, climbing, or manning a gun | seen | seen |
| Commando crawling, or swimming at the surface | seen | **not seen** |
| Marine submerged, Green Beret buried | not seen (witness rule, §3.4) | not seen |
| Commando hidden in a building, or in a closed vehicle | not seen | not seen |
| Disguised Spy | ignored (seen only for suspicious-act checks, full cone) | ignored |
| **Body** (German or allied) | seen | **seen** [EXE: bodies are not in the near-only mask] |
| **Footprint** (AI-visible) | seen | not seen [EXE flag PISADA] |
| Deployed unattended raft; commando boarding a vehicle; a wounded comrade | seen | seen |

- Units with `ignoresBodies` never react to bodies: crews, the cannon gunner, officers, the general, tower gunners in M14 [data/guide].
- gap-8 proposed the whole cone for footprints. This spec follows gap-0's code evidence (near band only).

**Display** (`VisionCone`):
- Drawn from exactly this geometry: aperture rays every ≤ 0.75° (≥ 96 rays), cut by the same grid raycast and the dynamic occluder layer. The near fan is capped at near(θ); the far ring runs from near(θ) to the hit or far(θ).
- **Colours** [EXE, hard-coded; 50% alpha, flat, hard edges, no hatching]:

  | Palette | Near | Far |
  |---|---|---|
  | Green | `#02BC6F` | `#07675A` |
  | Orange (desert: `coneColors:'desert'`) | `#D26E02` | `#6B4C01` |

- It is drawn on the ground layer, **under** trees, roofs and tall props.
- **Only one cone is shown at a time.**
- **Spotter highlight.** When any commando is seen and triggers CHALLENGE or COMBAT, that enemy's cone becomes the shown cone and brightens to 75% alpha for 1.0 s. This is "automatically illuminated" [manual].
- **Faithful mode has no colour change by alert level.** The modern option `alertTint` colours alerted cones red (alertLevel 2) or yellow (alertLevel 1).
- **Probe marker (Shift+click on ground):**
  - Leaves a red 0.6 m ring.
  - The **first** enemy whose current cone (standing test) contains it has its cone shown, and the ring pulses.
  - Each marker triggers once. A new marker replaces the old one; right-clicking the eye clears it.
- **Cheat/debug:** the `?debug=cones` URL flag shows all cones (mirrors the Shift+V cheat).

### 4.3 Other perception rules
- **Timing.** Cone membership and LOS are tested **every sim step** (60 Hz), so display and logic always agree. The tick-integer rules (nervousness, decay) run at **20 Hz**, every third step, to reproduce BEL's arithmetic (§10.1).
- **Seen list.** Each enemy tracks at most 16 seen objects per tick [EXE]. Commandos come first, then bodies, then footprints.
- **Witness memory.** Each enemy remembers `lastSeen {target, x, z, t}`. It is used by CHALLENGE, COMBAT and SEARCH, and by the dig and dive witness rules.
- **Boarding a vehicle.** An enemy who sees a commando board a vehicle: the vehicle becomes `tainted` (§3.7), the enemy enters COMBAT against the vehicle, and he shouts `ger_alarm`.
- **Deployed raft seen unattended** (no commando within 3 m): the enemy fires at it until it deflates (3 hits) [guide].
- **Wounded comrade seen** (below 200 HP and alive): the viewer runs (3.8 m/s) to INVESTIGATE the last known shooter position with alertLevel 2, and goes to COMBAT on sight (§4.6).
- **Kill seen** (any commando kill inside the viewer's cone, full cone): the viewer sets `sawKill`, goes to COMBAT against the killer, and raises the alarm (§4.9) [guide: "Killing a man in view of another guard raises the alarm"].

### 4.4 Hearing and noise

- **The model.** `world.emitNoise(x, z, radius, kind, source)`. Every enemy whose position lies within `radius` hears it, with **no occlusion attenuation** (BEL `Oido01` has no parameters) [EXE].
- **Levels** come from the original's emitter levels [EXE]; radii are [rec] where not stated.
- **Movement is silent in BEL.** Footsteps, crawling, knives, syringes, harpoons, traps, sniper shots, body drops and raft rowing make **no noise** [manual; GameSpot; gap-8]. The CLASSIC 1998 house-rule preset keeps this exactly.
- **SHADOW SIX house rule `runningNoise` (on by default; a deliberate change from BEL).** Guards hear a commando **running**
  near them, so running past a guard's back is no longer safe; it is not only his cone that matters. See "Running is
  heard" below. OPTIONS → GAME PREFERENCES → RUNNING IS HEARD; CLASSIC 1998 turns it off; a mission can force it with
  `houseRules: { runningNoise: false }` (docs/bodies-design.md §0.3).

| `kind` | Level | Radius | Emitted by |
|---|---|---|---|
| `pistol` | 2 | **18 m** | Every pistol shot (commando or enemy) |
| `rifle` | 2 | 22.5 m | Enemy Kar98 shot |
| `smg` | 3 | **25 m** | Driver's SMG, trooper MP40 burst |
| `mg` | 3 | 36 m | MG nest, tower, vehicle MG |
| `explosion` | 3 | **map-wide** | bomb, barrel, grenade, vehicle blast, shell: "probably every soldier in the entire mission" [manual] |
| `decoy` | 1 | **13.5 m**, one pulse every 1.5 s | Green Beret decoy while on |
| `halt` | 2 | 18 m | Enemy "Halt!" / "Wer da?" (`ALTO`, `QUIENVA`) |
| `mandown` | 2 | 18 m | Enemy finding a body |
| `alarmShout` | 3 | 36 m, **plus the zone event** | Enemy "Alarm!" (`ALRM`) |
| `bark` | 2 | 18 m | Dog |
| `spyUnmask` | 1 | 9 m | Spy unmasked |
| `phone` | 1 | 13.5 m, repeating every 2 s while ringing | Telephone (M5) |
| `horn` | 1 | 22.5 m | Vehicle or ship horn (M13 supply boat) |
| `footsteps` | 1 | 4.5–12 m by surface (below) | A commando running upright, every 2.7 m (house rule `runningNoise`; none in BEL) |
| `siren` | – | cosmetic | The siren is audio only; the alarm itself travels through zone events |

**Reaction to noise** (hearer in IDLE or SEARCH):

| Hearer | Level 1 (decoy, phone) | Level 2 (gunshot, shout) | Level 3 / explosion |
|---|---|---|---|
| `holdsPost` | Turn to face it; body heading snaps and the sweep re-centres on it for 8 s, then goes back | Turn, and alertLevel becomes 1 | Turn; COMBAT-ready (alertLevel 2) |
| `investigates` | INVESTIGATE (decoy: DECOY) | INVESTIGATE at 1.8 m/s | INVESTIGATE at run speed (3.8 m/s); the zone may already be in alarm |
| patrol (squad) | The leader investigates and the squad follows | Same | Same, running |
| distracted, or at the decoy | Ignores it | **Breaks off** and returns to duty or investigates | Breaks off |

- **Sound sensors of zones** (§4.9) fire when a hearer standing inside the zone hears a noise of **level ≥ 2**.
- **Pistol lures outside zones.** A pistol shot fired outside any sensor zone only pulls the listeners within 18 m. This is Kildread's "pistol lure / corner camping" and must work.

**Running is heard** (SHADOW SIX house rule `runningNoise`, `CONFIG.stealth.runNoise`; all values [rec]; not in BEL)

- **Who.** A player commando, free (`state` active), on foot, standing, in run mode. Walking, crawling, swimming, diving,
  vehicles and a **disguised Spy** (a German soldier running past is no news) make no step noise. Enemies' own running
  never alerts each other.
- **Walking stays silent on purpose.** The knife reaches 1.2 m and a walk covers 2.25 m/s, so any walking radius would
  turn every guard before the walk-up stab. Walking is the stealthy approach; running up to stab is now a gamble.
- **Cadence.** A `footsteps` noise (level 1) every **2.7 m** run (≈ 0.5 s at 5.4 m/s, 0.6 s at 4.5 m/s); the first after
  1.35 m, so even a short dash is heard. Counted in the fixed-step sim (deterministic); the counter is saved with the
  unit, so a game loaded mid-run makes the same steps.
- **Radius by the surface underfoot** (grid data only: `src/ai/running-noise.js` `stepSurface`), × `rules.enemyHearingMul`.
  Distance is 3D (runner's height vs the guard's), so a guard on a roof or plateau hears a runner below only within it.
  Every radius is inside the 18 m near band, so a guard who turns can see the runner. Dogs hear steps as far as men
  (`dogMul` 1: a dog that turns and sees a man goes straight for him with no "Halt!", so a longer reach would be an
  instant alarm at 15–18 m);
  a man inside a vehicle (tank crew, driver) hears none; an emplacement gunner does.

  | Surface | Radius |
  |---|---|
  | Bridge deck (wood or metal) | 12 m |
  | Built raised floor: roof, wall walk, deck, tower (`elev > 0.05`, not `grid.naturalElev`) | 12 m |
  | Road, paving | 10 m |
  | Shallow water (splashing) | 9 m |
  | Ground (soil, gravel) | 7.5 m |
  | Snow (it crunches) | 7.5 m |
  | Grass, sand, mud | 6 m |

  Raised natural ground (the `walkways` of a `cliff` plateau or terrace and of a `road` ramp: M5 summit, M8/M10/M11
  plateaus, M14 ridge, M20 terraces) is marked `grid.naturalElev` and reads its terrain code like the ground below.

- **Reaction** (enemy-brain `_hearSteps`; head turns are instant in BEL, SHADOW SIX turns him smoothly, §4.1). A
  post-holder, gunner or crewman turns round to the sound (≈ 1.15 s for 180°; a gunner within his traverse) and sweeps
  around it for 8 s; an investigator stops, turns round to it, then walks over at 1.8 m/s, re-aimed at each newer step. "Was war das?" at most every 6 s; a "?" over the guard and the cone flash
  (`enemy:noise-turn`, `enemy:heard-steps`). Busy, distracted and lured men ignore steps as they ignore every level-1 noise;
  a patrol member hands it to his leader, who reacts whatever his own distance to the step (a runner behind the tail of a
  file is heard by the squad). A step counts once per man: a leader handed the same step by several squad members
  (or hearing it himself too) adds 1, not one per hearer. The engineer and the general **ignore** steps (no detonator run).
- **Escalation, never an alarm.** Each step heard adds 1 to his step suspicion (decaying 0.5/s): at 3, alertLevel 1; an
  investigator who reached 6 SEARCHes around the last step instead of going home. Steps never give alertLevel 2,
  combat-readiness, a zone `onHeard` sensor (level 1) or an alarm. Being **seen** still goes through the cone and §4.5
  (a running man in view reaches T in one tick: "Halt!"); a commando who freezes outside 2.25 m is not challenged.
- **Cue.** Display option NOISE RINGS (default on, off under reduced motion): a faint ring spreads from the runner's
  feet to the step's hearing radius.

### 4.5 Nervousness, challenge ("Halt!") and when enemies fire [EXE gap-1]

Each non-MG soldier has a **nervousness N** and a **threshold T = 50** (`.NERVIOSISMO`, per spawn, default 50).

**Per 20 Hz perception tick:**
1. `N = max(0, N − 1)`.
2. For each **seen** commando (valid under the band rule):
   - `N += floor(2 · d²)`, where d = the target's displacement since the previous tick, in BEL units (`d = metres / 0.045`).

     | Commando | Approx. increase per tick | Time to reach T |
     |---|---|---|
     | Walking (0.1125 m/tick, d = 2.5) | +12 | about 0.25 s |
     | Running | +50 to +72 | immediate |
     | Crawling (d ≈ 1.0) | +2, net +1 | about 2.5 s |
     | Standing still | 0 | never |

   - `N = 20·T = 1000` at once if the target is **within 2.25 m** (50 u), is already held, or was seen killing, carrying a body or boarding a vehicle.
   - If the enemy has `sawBody`: `N += max(1, T/25)` = +2 per tick while any commando is seen.
3. **If N ≥ T:** enter **CHALLENGE** against that commando.

**Consequences.**
- A commando who **freezes the instant he is seen never triggers a challenge**. Even a challenged, held commando does **not** trip a zone's `onSeen` sensor (§4.9). This is why eggie's "under shot" trick works even in whole-map silent zones (M5, M8, M12).
- After losing sight, N decays from 1000 to below T in about **47.5 s**. That is the guard's lingering alertness (alertLevel stays 1 while N > 0).

**CHALLENGE** [manual, guide, EXE]:
1. On entry, the enemy shouts `ger_halt` ("Halt!" / "Stehen bleiben!" / "Wer da?"). This is `halt` noise, level 2, 18 m.
   - Nearby listeners who can see the same commando **also** aim at him; they join the challenge without needing their own N.
   - The shout repeats whenever the target moves more than 0.3 m, with a 3 s cooldown.
2. The enemy aims (`aim` animation) and the target gets `held:true`.
   - The spotted commando's portrait flashes (§6.2).
   - If the option **Submissive** is on, a moving commando stops automatically. The default **Indifferent** keeps obeying his orders [manual].
3. **Resolution.**

   | Condition | Result |
   |---|---|
   | The held commando **moves more than 0.3 m**, **attacks** (any shot or kill) or **flees out of sight** | Every aiming enemy switches to **COMBAT** and fires [manual] |
   | The enemy has `sawBody` or `sawKill` | COMBAT immediately, no holding [guide] |
   | The enemy is a `sergeant` or trooper (patrol) **and the map has a jail** | **ARREST** (§4.10) |
   | Patrol and **no jail** | COMBAT [guide] |
   | `sentry` or `soldier` (not in a patrol) | **HOLD** indefinitely at gunpoint, awaiting a patrol or NCO. The first patrol whose cone sees the held man comes over (VEL 2) and applies the patrol rule |
   | The zone is in alarm, or the unit is flagged `firesOnSight` | COMBAT |
   | `mg`, tower, bunker, armoured vehicle, dog | Never challenge; **fire on sight** (dogs bark and attack) |
   | Crewed armed vehicle on a route (patrol boat, SdKfz) | The same fire-on-sight rule. The sighting is still flagged (`enemy:spotted`, portrait flash, the crew's zone onSeen) and the gun aims for the COMBAT aim time (0.5 s) before the first burst |

4. **By-the-book units** (`raisesAlarmOnSight: true` per spawn) shout `ger_alarm` on entering CHALLENGE [manual: "Some by the book types will immediately sound the alarm"].
5. Knifing or injecting the aiming guards one by one while the held commando stands still is legal play. Each kill is still subject to §4.3 "kill seen" for the *other* aiming guards: a guard who sees a comrade die goes to COMBAT.

### 4.6 Enemy brain: states and timers

The brain uses priority arbitration in the style of BEL's `CARISMA`. The highest runnable action wins:

```
DEAD(999) > SPECIAL_SCRIPT(600) > COMBAT/CHALLENGE(500) > RAISE_ALARM(450) > WATCH(400)
          > SEARCH/INVESTIGATE(300) > DISTRACTED(250) > ROUTE/POST(200) > TRACKS(100)
```

`brainState` ∈ `IDLE | INVESTIGATE | DECOY | TRACKS | BODY | CHALLENGE | HOLD | ARREST | COMBAT | SEARCH | RETURN | DISTRACTED | ALARM_RUN | REINFORCE | DEAD`.
Drive the cone with `alertLevel`: 0 calm, 1 suspicious or N > 0, 2 combat or alarm.

| State | Entered when | Behaviour | Exit / timers |
|---|---|---|---|
| **IDLE** | Default | Post: sweep. Walker: route at VEL × 0.9 m/s, waits with `look` and sweep (A 50°, P 2.5 s) | Stimuli below |
| **INVESTIGATE** | Level 1–2 noise (`investigates` types), a wounded comrade, a door seen being used | Walk at 1.8 m/s (run at 3.8 m/s for level 3) to within 1.5 m of the source. **Look around for 4.0 s** (θ sweeps ±90° over the 4 s). Mutter `ger_suspicious` on arrival | Nothing found → RETURN. Commando seen → normal N rules |
| **DECOY** | Decoy pulse heard (`investigates`), or the decoy is the nearest active noise | Walk to within 2.0 m of the decoy and stare at it (head fixed; no sweep). Stays while it beeps | Decoy off → wait **5.0 s** → RETURN [rec]. Optional per spawn: `alarmOnDecoyGiveUp` (default false; Prima says guards "usually sound an alarm", Kildread and Ruetli do not) → RAISE_ALARM |
| **TRACKS** | A `followsTracks` enemy sees an AI-visible footprint in its near band | Walk along the trail toward the **newest** print at 1.8 m/s, re-acquiring each print within 4 m. At the trail's end or after 40 m: look around 4.0 s | → RETURN. Commando seen → N rules |
| **BODY** | Sees a body not yet `discovered` (full cone) | Sets `sawBody` (permanent). Walks (1.8 m/s) to within 1.5 m, kneels 1.0 s, shouts `ger_mandown` (`mandown` noise), then after 1.0 s shouts `ger_alarm` (`alarmShout`, which fires the zone's alarm event). Marks the body `discovered` | → SEARCH (20 s). Bodies with `ignoresBodies` viewers skip this. Hidden bodies (under a barrel) are never seen |
| **CHALLENGE / HOLD** | N ≥ T (§4.5) | Aims at the target and shouts; others join | See the §4.5 resolution table |
| **ARREST** | Patrol plus jail (§4.10) | The leader walks to within 1.5 m; the target plays `surrender` | → the escort marches to the jail |
| **COMBAT** | See §4.5, §4.3, or alarm-zone sighting | Faces the target, aims 0.5 s, fires at the weapon cadence while in range and LOS. Out of range: runs toward the last seen position (3.8 m/s). Walkers **abandon their route** [manual] | Target lost for **3.0 s** → SEARCH |
| **SEARCH** | Lost target, or after BODY | Visits 3 random points within 8 m of `lastSeen` (seeded RNG), looking 2 s at each; follows tracks if any. Total **20 s** | → RETURN. alertLevel stays 1 until N decays |
| **RETURN** | After INVESTIGATE, DECOY, TRACKS or SEARCH | Paths back to the post or the nearest route waypoint at 1.8 m/s | → IDLE |
| **DISTRACTED** | The Spy distracts him (or his squad leader) | Faces the Spy (a frozen squad faces its leader). No sweep. Keeps perceiving, but his cone points at the Spy | Ends per §3.4 → RETURN |
| **ALARM_RUN** | `courier` (M4) seeing something suspicious | Mounts the bike, drives the `EXIT` route to the barracks at 9 m/s, fires the zone event on arrival | Killed en route → no event |
| **REINFORCE** | A squad released from a barracks (§4.9) | Runs the exit route at 2.7 m/s, then loops its patrol at 1.8 m/s **for the rest of the mission** (never goes home) | Normal patrol rules, with alertLevel 2 and `firesOnSight` while the siren sounds |
| **DEAD** | HP ≤ 0 or an instant kill | `die` (1.0 s), then `dead`. Becomes a **body** entity. Bodies persist for the whole mission [guide] | — |

**Other brain rules.**
- **Partner glance** (sentries with `partner`): every 25 s the sentry turns to its partner for 2.5 s. A missing, dead or carried-off partner → INVESTIGATE the partner's post; a visible body there → BODY.
- **Panic unstick** [data: BEL pathfinder]: a unit stuck (moved less than 0.2 m) for **5 s** wanders randomly for 2 s, then re-paths.

### 4.7 Bodies
- **Visibility.** A body is an entity (`kind:'body'`) visible in the **full cone**. It is low for LOS purposes: `B.LOW` hides it from ground viewers.
- **Blood.** A pool decal grows over 3 s under knife, pistol and SMG kills. The syringe, trap and harpoon leave none. The content option `censor` replaces the body with a small gravestone and no blood.
- **Moving and hiding.**
  - Carriable by the Green Beret and the Spy (§3.4).
  - Hidden by a barrel (GB).
  - **Cannot be taken into buildings.**
  - Bodies on a roof are unseen from below (M12 roof rule).
  - **Deck-edge rule** [rec]: a body, or a prone (low) unit, lying on a raised surface higher than a viewer's eye (a wall walk, a deck: target y > viewer y + eye height 1.65 m) is hidden from that viewer by the surface edge. A man standing there stays visible, and a guard who watches a man die up there still sees him fall. Viewers on the same surface still see the body. (M2: e5's body on `walk_sw` can't be seen from inside the camp.)
- **Body found:** BODY state (§4.6), which raises the alarm through the zone. A **patrol member** finding a body, or seeing one of its own die, raises the alarm immediately [manual, guide].

### 4.8 Footprints
- **Terrain.** Walking or running on terrain `SNOW` or `SAND` stamps prints. `MUD` stamps prints that are visual only [rec].
  - The trail layer (see realism pipeline) renders prints as a deformation and darkening.
  - The gameplay list stores `{x, z, heading, t, owner}`.
- **Spacing:** one print per 0.75 m walked or 1.6 m run.
- **AI lifetime 90 s** [rec; BEL's `.VIDA` is unknown]. The visual fades over the last 30 s.
- **Crawling** leaves a player-visible furrow only; enemies never see it [manual].
- **Enemies leave prints too.** They are visual only; the AI ignores them. Walking inside an enemy patrol's own tracks is not special-cased [guide].
- **The disguised Spy** walks in German boots: prints stamped while he wears the uniform count as enemy prints (visual only; no TRACKS). Out of uniform his prints are ordinary commando prints [inf; replay m03: trackers followed the uniformed Spy across the dam to the team].
- **Vehicles** leave visual tyre tracks only.
- **Guards who can follow prints:** those with `followsTracks` (patrols; `investigates` types). They see prints in the **near band only** → TRACKS (§4.6).
- **Lure patterns that must work:**
  - leaving tracks around a corner into a trap or knife (M2, M5);
  - burying at the end of a track (M5).

### 4.9 Alarm, zones and reinforcements [data MIS, EXE, guide]

**Silent zones** (`zones[]` per mission):

```js
{id, poly:[[x,z],...], onSeen:'EVT'|null, onHeard:'EVT'|null}
```

- `onSeen` fires when an enemy **standing inside the zone** enters COMBAT against a commando, sees a kill, or completes BODY (`SENSORES_EXP_ZONA`). CHALLENGE and HOLD alone do not fire it: guards shouting "Halt!" at a motionless commando raise no alarm [guide: eggie's under-shot trick].
- `onHeard` fires when an enemy inside the zone hears noise of level ≥ 2 (`SENSORES_SND_ZONA`).
- The `alarmShout` noise also fires the shouter's zone event.
- **Outside every zone** nothing escalates beyond the local reactions.

**Events.**
- **`RINT` starts the siren** (the only event that does) [EXE]:
  - `SIRENA01` starts at gain 0.75 and falls by 0.0015 per 50 ms, so it **fades out over 25 s**;
  - the HUD shows a flashing red alarm lamp for the same 25 s;
  - a new RINT restarts it.
- **Other events** (`REXT`, `RPER`, custom ones) release troops silently.
- **Explosions** (map-wide noise) are heard by everyone, so they trip every zone's `onHeard`.
- **Per-mission accident exception:** `accident:true` on a scripted explosion (M15 tram and tanker) suppresses the events.

**Barracks** (structures with `reinforcementSpawn` and a flag):

```js
barracks: {pool: 5|10, squads:[{event:'RINT', size:2..4, exitRoute:[...], loop:[...]}]}
```

- On its event, every squad tied to it **leaves at once**:
  - `sergeant` plus troopers;
  - the exit route runs at 2.7 m/s;
  - the second-to-last waypoint can emit a follow-up event;
  - the squad then links into its `loop` at 1.8 m/s **forever**.
- **Regeneration.** A destroyed squad is rebuilt from the pool **20 s** after its last member dies [rec; delay unknown], until the pool is empty.
- **A destroyed barracks releases nothing more.** "Shooting a barracks empty" is legal play.
- **Existing patrols** with `reactEvents:['RINT']` switch to their alarm route at 2.7 m/s, then loop.
- **Tank depots** (M9, M10, M13) release their tanks on the event.

**Decay.**
- The siren ends after 25 s. Individual alertness decays with N (about 47.5 s).
- **Permanent:** `sawBody` flags, released squads, switched routes, bodies and tainted vehicles.
- There is **no global "all clear"** [EXE, gap-1].

**Alarm-fail missions:** mission data `alarmFail`:

| Mission | Condition |
|---|---|
| M15 | The general reaches a car |
| M16 | A sapper reaches a detonator |
| M13 | The tank's shell hits the mini-sub |

- The alarm only *starts* the failure chain; the player can still stop it by blocking the car or killing the runner.

### 4.10 Capture and jail [manual, guide, EXE]
- **Jail.** A mission may mark structures `jail:true`: a stockade, or a flagged barracks acting as a prison. Patrols with `jail:<id>` arrest instead of firing.
- **Arrest sequence.**
  1. The target plays `surrender` (hands up) and gets `state:'captured'`.
  2. The leader shouts `ger_arrest`.
  3. The squad escorts him at 1.8 m/s to the jail door. He is removed from the map (`state:'jailed'`) and his portrait is framed with bars.
  4. He keeps his kit. Exception: in M17 the Marine loses his diving gear (mission flag `jailStrips:['divingGear']`).
- **Rescue.** Any free commando activates the jail door (1.5 s) while no enemy sees him. The prisoner appears at the door, `state:'active'`.
- **Selection rules.** A captured or jailed man, or one currently held under fire, **cannot be multi-selected** [manual]; he can be selected alone.
- **End states.** One man captured is not a failure. **All men dead or captured is a loss.** Extraction with a man still jailed is refused ("ALL YOUR MEN MUST ESCAPE") [EXE strings].
- **Scripted exploit (not required):** being arrested on purpose to get inside (M17 briefing) must work naturally through this system.

### 4.11 Damage taken by commandos (summary)

| Source | Damage | Kills (at full HP) |
|---|---|---|
| Rifle | 80 per hit | Sniper in 2 hits; the Green Beret in 3 |
| MP40 | 100 per round, 5-round bursts | Any commando in one burst |
| Pistol (sergeant) | 80 per hit | — |
| MG | 100 per round | Any commando in about 1 s |
| Tank MG | 110 per hit | — |
| Dog bite | 25 | Sniper on the 4th bite; the Green Beret on the 8th [EXE] |
| Electric | 20 per contact | — |
| Fire | 100 per second | — |
| Explosions | per §3.6 | — |
| Run over by a vehicle | instant | — |
| Train | instant | — |
| Mine (M5) | instant | 3 m blast; mines are invisible [guide] |

---

## 5. Controls

Defaults mirror the BEL manual. Browser adaptations are marked ⚑. All keys use `KeyboardEvent.code` for layout independence, except `+ - *`, which use `event.key`.
- `preventDefault()` is called on every bound key while the game canvas has focus.
- Right-click never opens the context menu over the game.

### 5.1 Keyboard

| Key | Action | Who / when | Notes |
|---|---|---|---|
| **1–6** | Select Green Beret, Sniper, Marine, Sapper, Driver, Spy | Only commandos deployed in the mission | Pressing the key of an already-selected man recentres the view on him |
| **7** | Select guest | McRae, the Informer, Gilbert | |
| **8** | Select all active men | | CommandosHQ only; kept as a convenience |
| **0** | Deselect all | | |
| **A** | Detonate the next remote bomb | Sapper | In placement order |
| **B** | Drop a bomb (time or remote) | Sapper | |
| **C** | Lie down / crawl | all | Stance toggle icon equivalent |
| **D** | Diving gear on/off (Marine, shallow water or boat) / Distract (Spy, in uniform) | Marine / Spy | |
| **E** | Grenade | Sapper | |
| **F** | Shovel: bury / rise | GB, snow or sand, M1–M11 | |
| **G** | Pistol. **Group selected: all draw; each click = a volley** | all | |
| **H** | Hand: pick up | all (role-gated) | |
| **I** | Decoy on/off | GB, after Q | |
| **J** | Bear trap / harpoon | Sapper / Marine | |
| **K** | First aid kit | medic | |
| **L** | Lethal injection | Spy | |
| **M** | Submachine gun | Driver | |
| **Q** | Drop the decoy | GB | |
| **R** | Sniper rifle | Sniper | |
| **S** | Stand up | all | |
| **T** | Inflate / launch the raft (shallow water only) | Marine | |
| **U** | Put the uniform back on (only when no enemy sees him) | Spy | The German release used T; not adopted |
| **W** | Wire cutters | Sapper | |
| **X** | Knife | GB, Marine | |
| **P** | Pause (full freeze; §6.8) | | ⚑ "active pause" option allows orders |
| **Esc** | Game menu; skips the briefing; cancels targeting first if a cursor mode is active | | ⚑ Also exits browser fullscreen; we re-request fullscreen from the menu |
| **Tab** | Move the knapsack column to the other side | | ⚑ Tab focus navigation is suppressed in-game |
| **Ctrl+B** | Briefing Notes (objectives notebook page) | | |
| **Ctrl+S / Ctrl+L** | Quicksave / quickload | | ⚑ Browsers may reserve Ctrl+L. Aliases **F8 / F9** are always bound |
| **F1** | Help: key list and commando profiles | | ⚑ Browser help suppressed |
| **F2–F7** | 1–6 camera views; repeat to cycle layouts | | ⚑ **F5 reload is suppressed in-game**. If the browser still reloads, the auto-save on `beforeunload` protects the player |
| **Arrow keys** | Scroll | | |
| **Numpad + / − / \*** | Zoom in / out / normal | | ⚑ Aliases for laptops: `=` or `+`, `-`, and `Backspace` for normal |
| **Mouse wheel** | Zoom step | | ⚑ modern addition |
| **Home** | Centre on the selected man | | ⚑ modern addition |

**Removed BEL keys:**
- Ctrl+Z (multiplayer chat): multiplayer is not in scope.
- Print Screen: handled by the browser.
- Cheats (`GONZO1982` typed in-game): **optional** debug build only, with Shift+X teleport, Ctrl+I invincibility, Ctrl+Shift+N win, Shift+V all cones and F9 info. When cheats are enabled, F9's quickload alias moves to Ctrl+L only.

### 5.2 Mouse

| Input | Effect |
|---|---|
| Left-click a commando (map or portrait) | Select him. Click a selected man to deselect him |
| **Ctrl + left-click a portrait or commando** | Add him to / remove him from the group ⚑ (on macOS, ⌘ is accepted as Ctrl throughout) |
| **Right-button drag on the map** | **Red** selection rectangle (2 px, 25% red fill); replaces the selection on release. Drag threshold 6 px |
| Left-click ground (move cursor) | Walk there with pathfinding. A prone man crawls |
| **Double-click ground** | Run (if able). Window 350 ms, 6 px |
| Double-click with a melee cursor on a target | Run to it, then act |
| Left-click with an item cursor | Use the item there. Weapons fire one shot or burst per click |
| **Right-click** | Cancel the item cursor. A weapon is holstered; a carried body or barrel is dropped; a buried GB rises; a distraction ends; a climbing GB hangs. Otherwise, with nothing to cancel: nothing (BEL did not deselect on right-click) |
| **Shift + click an enemy / vehicle / bunker** | Show its cone (one at a time) |
| **Shift + click ground** | Place the red probe marker |
| **Alt + click a unit / ground** | Track that unit / stop tracking ⚑ (Linux window managers may grab Alt+drag; Alt+*click* still works, and the camera icon is the alternative) |
| **Ctrl + click (as operator of an armed vehicle or manned gun)** | Fire a volley. The cursor is a gunsight while Ctrl is held |
| Mouse at a screen edge | Scroll (§2.3) |
| Middle-drag | Pan ⚑ |
| Hover | Context cursor (§5.3) plus a tooltip after **0.8 s** (BEL's delay was "too long") |
| Click the notebook sketch | Jump the view there |
| Click a man's photo in the knapsack while he is in a vehicle or building | Exit |

**Order rules** [manual]:
- Movement orders apply to every selected man, each pathing independently with formation offsets of 1.2 m around the click point.
- While a weapon cursor is armed, move clicks are refused (right-click first).
- **Orders cannot be given while paused** in faithful mode.

### 5.3 Cursors

A **software cursor** is drawn on a top overlay. CSS cursors cannot do the scope magnifier, the blinking eye or the animated grab. All cursors are 32 reference px unless stated; each has a hotspot and a red **forbidden** overlay (circle and slash) for invalid targets.

| Cursor | When |
|---|---|
| Move pointer (brass double chevron with a small star) | Default with a man selected |
| Destination marker | 27-px twin-star sparkle for 0.6 s at each move target (BEL `ESTRELLA1/2`) |
| Activation (hand on a lever) | Hover over an operable thing for the selected man |
| Pick-up hand (open with a forbidden overlay → animated grab) | H mode |
| Climbing pick | GB over a `climbable` edge |
| Body-in-barrel | GB carrying a barrel over a body |
| Knife / pistol / scope (88 px, 2× magnifier) / crosshair (SMG, vehicle, manned gun) / syringe (K, L) / officer's cap (Distract) / harpoon / grenade / pliers / trap / bomb | Matching action |
| Eye (blinks at 2 Hz when over a valid target) | Eye tool or Shift held |
| Tracking pointer (4 orange arrows) | After clicking the camera icon |
| Plain arrow | Nothing selected, and over the HUD |

**Scope magnifier.** With the sniper rifle up, the 88-px scope's glass (r ≈ 36 ref px) shows a live **2×** view of the world under the cursor, not a drawing: a second orthographic camera with the game camera's yaw and pitch, centred on the cursor's ground point, so it works at every zoom level, yaw option and in multi-view. Over it: the clear brass ring, BEL's three heavy posts with a fine cross, mil-dots and holdover marks, a slight cool glass tint, chromatic fringe and vignette toward the rim, and a subtle breathing sway of the image (off with reduced motion; the shot still goes where the cursor is).
- The reticle is always **dark** (near-black, like an etched optical reticle: thin cross lines with heavier outer posts), never green or red in any state.
- **Valid shot** (an enemy in reach and in sight): the enemy gets a faint neutral rim inside the glass, and a tag above the ring gives the range (`14 m`).
- **No shot**: a small dark circle-and-slash mark appears in the lower right of the glass, the glass dims and loses some colour, and the range tag turns grey. Over an enemy that cannot be hit (beyond 45 m, no line of sight, under cover) the tag reads `NO SHOT · 60 m`.
- The hover name tag of the enemy under the scope sits outside the ring, below and to the right.
- The magnified view includes water, smoke and ground decals. It skips the per-theatre grade, AO and bloom, so the glass reads slightly cooler than the frame around it, like real optics.
- It is only rendered while the scope is up, into a target sized to the glass at HUD scale × pixel ratio (4K/HiDPI included). It costs **under 0.5 ms of CPU a frame**. The lens draws only what is inside its small window. When a single render still costs more than 0.4 ms (a slow or heavily loaded machine), the last image is reused, shifted under the cursor, for up to three frames, so the glass refreshes at least every fourth frame and the cost per frame stays under budget. A zoom, a rotation, a new target or a large cursor move always renders a fresh image. On the M2 test stage at 1280 × 720, on a test machine at load average ~30 on 24 cores, one render took 0.7–1.2 ms and the amortised cost was 0.40–0.45 ms a frame (tests/sniper-scope). Its GPU time stays well under half of the main frame's.
- Screens: `docs/screenshots/sniper-scope-valid.jpg`, `-invalid.jpg`, `-zoom05.jpg`, `-zoom1.jpg`.

### 5.4 Touch (phones, tablets) [remake]

Not in the 1998 game. A finger on the map is classified by `src/input/gestures.js` and acted on by
`src/input/touch-game.js`; mouse and pen input is unchanged (§5.2). **Tapping is for the men, dragging is for the
map.**

| Gesture | Action | Desktop equivalent |
|---|---|---|
| Tap (moves < 10 px, lifts within 500 ms) | Select a commando (tap a selected man to deselect him); walk to the ground; use the armed item on a target; get into a vehicle; with the eye / camera / hand tool armed, use the tool | Left click |
| Double tap (second tap ≤ 350 ms and ≤ 32 px from the first) | Run; with a melee item, run to the target | Double-click |
| Long press (held still 550 ms) | On a commando: add / remove him from the selection. On an enemy: his vision cone. On the ground: the probe marker (§4.2) | Ctrl+click / Shift+click |
| One-finger drag | Pan the map 1:1 under the finger; a flick coasts (velocity decays at e^(−5t)). **Never an order**, keeps the selection and the armed item | Middle drag, edges, arrows |
| Two fingers | Pinch to zoom, continuous between 0.5× and 2×, about the fingers' midpoint (spread = zoom in); moving both fingers pans | Wheel, numpad + / − |
| CANCEL button (bottom left, above MENU; only while an item or tool is armed or a man can cancel a context action) | Put the item / tool away, or cancel the context action | Right click |
| MENU button (bottom left) | The in-mission menu (pauses) | Esc |
| Tap the notebook (top right) | Open the map notebook; it stays open after the finger lifts. Tap it again to close it. On the open notebook a one-finger drag moves the view and a pinch zooms the sketch (§6.4) | Hover / leave, click |

Rules: a gesture that ever became a drag, a pinch or a long press can no longer end as a tap; a second finger turns a
drag into a pinch; after a pinch the finger left on the glass can pan but never taps. Panning follows the same pause rule
as other user scrolling (frozen while paused in faithful mode); zoom always works. Panning untracks the tracking camera.
The camera's clamp (§2.3) applies to every touch pan and zoom (`CameraController.panScreen` / `zoomAt`). Fingers never
edge-scroll. The software cursor is hidden in touch mode (the destination sparkle stays). Knapsack items, portraits, the
posture / eye / camera / hand / help buttons are plain buttons and work by tap.

Device defaults (`src/engine/device.js`): a touch-first device or a mobile GPU boots on the **medium** preset (**low** on
older Adreno / Mali / PowerVR GPUs), which caps the device pixel ratio at 1.25 (1 on low; every preset caps it, ultra at
2). `?preset=` and a quality chosen in OPTIONS win. Desktop defaults are unchanged.

---

## 6. HUD and UI

The HUD is a DOM overlay (`#hud`). It is laid out in **BEL reference pixels** (640×480 layout) × `uiScale`:
- `uiScale = clamp(floor(innerHeight / 480 × 2) / 2, 1, 3)`, so 1080p gives 2.0. A user override is allowed.
- The game view fills the whole canvas **behind** the HUD. The bottom and left edges have no HUD, as in BEL.
- The HUD only captures pointer events over its own panels.

**Art direction.** New photographic CC0 or self-made art that echoes BEL:
- woven dark-brown canvas webbing (about rgb(35–39, 28–32, 23–24)) with brass eyelets;
- an olive rucksack (about rgb(48,47,29));
- a pale khaki notebook (about rgb(169,173,123));
- a photo-real eye and hand.

Every button has a hover state (BEL's `M_` sprites).

### 6.1 Top bar (45 ref px tall, full width, 2 px dark shadow line rgb(17,15,11))
- **Portraits.**
  - One frame per commando in the mission, then guests, packed from the left at a **65 ref px pitch**.
  - Frame 62×44; face 40×40.
  - The face is a realistic painted or rendered head (see talking portraits, §6.3).
- **Health bar.**
  - A vertical bar to the right of each face, in a recessed 9×37 slot. The fill is 6×34, coloured rgb(104,0,0).
  - It **drains from the top** and is anchored at the bottom. Width is proportional to HP / maxHP.
  - At HP 0, a **skull replaces the portrait**.
- **Selection.** **Selected men are in full colour; unselected men are greyscale** (the primary indicator).
  - The world also gets a subtle selection ring: a thin brass ellipse under the feet, 40% alpha. This is ⚑ a readability addition that can be turned off.
- **Portrait clicks.**
  - Click to select; Ctrl+click to add or remove.
  - Selecting a man who is inside a vehicle or building centres on the vehicle or building.
- **Portrait states:**

  | State | Look |
  |---|---|
  | In a vehicle | Small vehicle glyph |
  | Hidden in a building | House glyph |
  | Jailed | Bars |
  | Buried | Shovel glyph |
  | Diving | Bubbles |

- **Right-hand icons**, left to right:

  | Icon | Size (ref px) | Function |
  |---|---|---|
  | "?" | 18×34 | Help, same as F1 |
  | Movie camera | 55×69; hangs below the bar | Tracking tool |
  | **Eye** | 52×45, flush top-right | Photo-real eye with a 2-frame blink. Click = eye cursor. **Right-click = hide the displayed cone** |

- **Stance toggle** (SHADOW SIX: moved from the top bar to the bottom HUD, immediately left of the hand; the 1998
  figurine was too small to recognise). A 64×48 box with just the man, no plaque or frame (the game's own Green Beret model,
  rendered in the pose the running game gives him), showing the posture a click switches TO: a man crawling while the
  selection stands, a man standing while it crawls. Click = C or S for the selection; greyed
  when nobody selected can change stance (vehicle, hidden, carrying a body, in water…).

- **Alarm lamp.** A 29×52 red siren lamp next to the eye flashes at 2 Hz while the siren runs (25 s) (BEL `ALMR`).

### 6.2 Warning flashes (option "Commando warnings", default ON)
- The portrait frame glows **blue while that man is inside any enemy's cone and seen** (the band rule applies).
- It **flashes red (4 Hz) while he is held or being fired at**.
- These are BCD's documented semantics; the BEL option's exact effect is undocumented.

### 6.3 Talking portraits and speaker card (SHOULD; a user request, not in the original)
- When a commando barks (§9.4), his top-bar face plays a lip-synced clip, or a real-time head driven by visemes.
- An optional **speaker card** (96×72 ref px) under the portrait slot shows the same face larger for the line's duration + 0.5 s.
- Laconic mode suppresses acknowledgement barks and therefore the animations.
- **Pain (user request, 2026-09-27):** a hit commando's portrait shows pain at once (<150 ms): a flinch clip (brows down, eyes squeezed, teeth-clenched grimace, small head jerk, partial recovery) with a short grunt in his own voice, in colour, with a brief red edge pulse on the slot. It interrupts select/ack lines; hits inside 0.4 s do not restart it; his "I'm hit!" (itself rendered with a grimace) may follow once the grunt has ended, never over it. Below 50 % hp his idle is a wounded loop (strained, heavier breathing, an occasional wince); a DOWNED man (buddy rescue) shows a half-closed-eyes still; death keeps the skull. Reduced motion shows a pain still; muted voice still flinches. Details: `talking-portraits.md` §9.

### 6.4 Right column (36 ref px strap, top-anchored notebook, bottom-anchored hand and knapsack)

**Notebook minimap.**
- **Closed:** a 33×206 spiral-bound paper strip under the eye.
- **Opening:** hovering it for 0.25 s, or clicking it, **unfolds it leftward** to **183×215** (or the per-mission art size, e.g. 185×229).
- **Closing:** it folds back automatically 0.4 s after the pointer leaves. It cannot be pinned [BEL].
- **With a finger or pen [remake]:** there is no hover (a phone fires enter / leave on finger down / up, which would
  keep it open only while the finger is held), so it is a **tap toggle**: a tap on the closed strip opens it and it
  **stays open after the finger lifts**; a **tap on the open notebook closes it again**. A one-finger drag on the open
  sketch moves the view (the black rectangle follows the finger) and a pinch zooms the sketch (never the page); neither
  closes it. The folded corner still opens Briefing Notes with one tap. Notebook touches never reach the game map (no
  orders). `src/ui/notebook-touch.js`; the mouse keeps the hover rules above.
- **Sketch.** A hand-drawn ink sketch generated from the mission data:
  - buildings as rectangles; rocks as circles; walls as double lines;
  - wire as `XXXX`; water as hatching; roads as double lines.
- **Overlays:**
  - a **black rectangle** for each camera view;
  - **red circles** on primary objectives;
  - **blue dots** for commandos and guests;
  - **red dots** for enemies.
- **Click** the sketch to jump the active view there (with a finger: drag the open sketch; a tap closes it).
- **Folded corner** (23×22, highlighted green on hover): click, or **Ctrl+B**, to open **Briefing Notes**. This is a ruled notebook page with DATE / LOCATION / MISSION in red, then the objectives and hint bullets (§7.4–7.6). Any key or click closes it. The game pauses while it is open.

**Hand button** (50×65, a photo-real open palm): same as **H**.

**Knapsack** (112×149, olive rucksack, anchored bottom-right; Tab mirrors it to the left):
- **Contents.** Item icons are painted *on* the rucksack, overlapping. Only the selected man's items are shown.
  - **For a group, only the items all of them share** (the intersection).
- **Click or hotkey behaviour.** An item either acts at once (inflate the raft, drop the decoy, put on diving gear) or arms a cursor.
- **Counts:**

  | Item | Display |
  |---|---|
  | Sniper ammo | Row of brass cartridges, one per round |
  | SMG | Bursts, drawn as a stencilled number |
  | Grenades and bombs | Individual icons |
  | First aid | Dose ticks |

- **Swapped items.** A dropped remote bomb or decoy is replaced by its **detonator / activator** icon.
- **Occupant view.** A man in a vehicle or building shows only **his photo**; click it to exit. Raft passengers show as small photos above the pack.
- **Disabled items.** Unavailable items are greyed with a tooltip reason, e.g. "Only in shallow water".

**Tooltips** (0.8 s delay): a black box with a thin light border and white bold condensed uppercase text, offset below-right of the object. Examples: "EXPLOSIVE BARREL", "SOLDIER", "SERGEANT", "MACHINE GUNNER", "GARRISON", "PRISON", "BUNKER", "ESCAPE: TRUCK".

### 6.5 Messages and subtitles
- A message line top-centre, under the bar, shows system messages for 4 s. Examples: "ALL YOUR MEN MUST ESCAPE.", "NOW, YOU DO NOT HAVE AN ESCAPE VEHICLE.", "Only the Sapper can handle explosives."
- **Bark subtitles** (option, default ON ⚑) appear as small speech tags above the speaker for the line's duration. German lines show the German text with an English gloss in italics.

### 6.6 Briefing (two parts; Esc skips)
1. **Historical slideshow** (framed 4:3 inside a black page):
   - Left panel: **4 rotating images**, crossfading every 6 s. They are archival-style photos (period-accurate CC0/PD, or our own renders graded as B&W), a grey stylised Europe map with the target circled in red, and a 3D render of the target taken from our own scene.
   - Top: "Mission N" and the date ("Feb 20, 1941").
   - Right: the title in heavy red condensed type (Oswald or Anton; SIL OFL, credited), then 2–3 paragraphs of context in white. Our own text, not copied.
   - A faint embossed **SHADOW SIX** watermark.
   - "Press Escape to skip".
   - The campaign theme plays.
2. **The Colonel's tactical advice.**
   - The briefing officer is shown only as "the Colonel" (original: Col. Montague Smith; never seen, British voice).
   - A voiced walk-through (TTS) with a camera tour over the live mission map at 0.5× zoom. It stops on each point: start, objectives (red circle), dangers, extraction.
   - Subtitles run along the bottom. Esc starts the mission.

### 6.7 Mission end
- **Win.** "MISSION COMPLETED": a dark red-brown painted card with grey stone-embossed capitals, one line of text and "PRESS ANY KEY TO CONTINUE". Success stinger.
- **Debrief (win):**
  - **ENEMY LOSSES:** Soldiers / Vehicles / Buildings, with icons and counts.
  - **MISSION TIME:** 0–3 silver stars.
  - **SUSTAINED DAMAGE:** 0–3 silver stars.
  - **MISSION MERIT:** 0–3 gold stars.
  - **Rank** name top-right, with "PROMOTED!" when a new rank is reached. A commando figure with the rank chevron fills the right side.
  - **MERIT BAR:** 6 star slots toward the next promotion.
  - **PASSWORD** for the next mission (5 characters).
  - **(N)EXT MISSION** and **(P)LAY AGAIN** buttons.
- **Failure card.** The reason (§8.1 strings), then **(R)ESTART MISSION** and **(Q)UICK LOAD**. The failure stinger plays.
- **Escaped before the objectives were done:** a dialog with **(C)ONTINUE** / **(Q)UICK LOAD** (§8.1).

### 6.8 Pause and menus
- **P pauses.** The sim, animations, audio (except the UI) and edge-scroll freeze, and "GAME PAUSED" is shown centred.
  - Faithful mode: **no orders, no scrolling and no cone inspection while paused** [guide].
  - ⚑ Option "active pause": scrolling, cone inspection and queued orders are allowed while paused.
- **Esc menu** (pauses): Resume · Save Game (10 named slots) · Load Game · Quick Load · Restart Mission · Options · Help · Quit to Title.
- **Options:**
  - Volume: master / SFX / voice / music.
  - **Halt behaviour:** Submissive / **Indifferent** (default).
  - **Voice:** **Verbose** (default) / Laconic.
  - **Commando warnings:** ON/OFF.
  - Graphics preset (low / medium / high / ultra).
  - UI scale.
  - Content: blood ON/OFF; censored mode (gravestones).
  - Subtitles.
  - ⚑ Modern: active pause, cone alert tint, edge-scroll, key rebinding, mouse-wheel zoom.
- **Title screen.** SHADOW SIX logo · New Campaign (BEL) · Beyond the Call of Duty (locked, "coming later") · Password · Load · Options · Credits (with the disclaimer) · Tutorials (COULD).

---

## 7. Missions

### 7.1 *Behind Enemy Lines*: all 20 missions (`campaign:'BEL'`)

**Sources.** Titles are Prima/fandom, with Kildread's variant in brackets. Enemy counts are Kildread's [guide]. "Zones" are silent zones (§4.9).

**Map size** is fan-map px × 0.045 m, with the depth divided by sin 40°:

| Map | Size (m) |
|---|---|
| M1 | 65 × 171 |
| M2 | 82 × 104 |
| M3 | 148 × 133 |
| M4 | 199 × 171 |
| M5 | 107 × 131 |
| M6 | 132 × 105 |
| M7 | 144 × 195 |
| M8 | 112 × 105 |
| M9 | 103 × 122 |
| M10 | 119 × 209 |
| M11 | 101 × 153 |
| M12 | 76 × 120 |
| M15 | 81 × 139 |
| M16/M18 | 201 × 150 |
| M20 | 157 × 162 |
| M13, M14, M17, M19 | not measured; size them from the fan maps when those missions are authored |

**Par** is our time par in seconds, anchored on the only two known originals: M1 `PAR_TICKS 3100` = 155 s and M4 `PAR_TICKS 15100` = 755 s [data]. The others are [rec].

| # | Title | Theater, place, date | Team | Objectives | Key features and scripts | Enemy highlights | Extraction | Par s |
|---|---|---|---|---|---|---|---|---|
| 1 | Baptism of Fire | Norway: Sola near Stavanger, 20 Feb 1941 | GB, Ma, Dr | Blow up the relay station (barrels) | Split start, regroup at the jetty; raft on the Marine's peninsula; truck; captured MG; snow footprints | 4 walkers, 3 sentries, patrols of 2 and 3, 1 MG. **No zone** | **None**: ends on the objective [data] | 155 |
| 2 | A Quiet Blow-Up (Discret Explosion) | Norway: Stamsund, Lofoten, 1 Mar 1941 | GB, Sn, Ma, Sa, Dr | Destroy the fuel depot | River with a patrol boat; raised ladder lowered by the GB; walled camp; gate barrier; truck | 6 walkers, 1 sentry, patrols of 4 and 3, 2 MG towers, patrol boat, 2 garrisons. Zone: NE bank | Truck out the SE gate, then the road off the E edge; don't stop (the E patrol) | 480 |
| 3 | Reverse Engineering (Backward Throttling) | Norway: Sysendam dam, Eidfjord, 4 Mar 1941 | GB, Ma, Sa, Sp | Destroy the dam bunker and the dam | Electric fence and switch; charges in the station; uniform on a clothesline; raft; walk across the dam in disguise | 7 walkers, 17 sentries, patrols of 5 and 3, 1 MG, surveillance bunker, 4 garrisons. Zones: E camp outskirts; S bank | Friendly truck arrives N of the dam after the objectives | 720 |
| 4 | Restore Pride (An Eye for an Eye) | Norway: Stokkan near Trondheim, 10 Mar 1941 | GB, Sn, Ma, Sa, Dr | Destroy the HQ villa (charge on its steps) | Fjord inlet; trestle rail bridge with a periodic train (a motorcycle on the crossing stops it); bridge-pillar ladder; empty Panzer II; air-drop crate (1 time bomb, 3 rounds, SMG); supply truck at the crossing; double walls with gates (a burning truck blocks the gate) | 10 walkers, 24 sentries, a 5-man and five 3-man patrols, 3 MG, **motorcycle courier** (alarm), truck driver, 2 garrisons; 50+ | Patrol boat at the HQ pier (auto, not steerable) | 755 |
| 5 | Blind Justice | Norway: Herdla, 2 May 1941 | GB, Sp | Destroy the radar | Cable car (Spy's only way up); GB climbs the E cliff; 2 telephones (the S phone rings the N one); **invisible mines** on the S approaches; 3 barrels chain-blown at the summit | 8 walkers, 9 sentries, patrols of 2, 3 and 4, 3 garrisons. **Whole map** | Autogyro at the summit | 600 |
| 6 | Menace of the Leopold (Leopold's Menace) | Norway: Masi, 10 May 1941 | GB, Sn, Sa | Destroy the Leopold railway gun | Bombed 2-storey house entry (climb, interior ladder); railway; HQ S of the gun (avoid); SdKfz patrolling the road (a remote bomb in the SW = no alarm) | 13 walkers, 18 sentries, patrols of 2 and 3, SdKfz, 1 MG, 3 garrisons. Zone: W ruin → E cannon; SW craters safe | Friendly truck enters NE after the gun is destroyed; board on the move; it can be destroyed | 780 |
| 7 | Chase of the Wolves (Hunting Wolves) | Norway: Arendal, 7 Feb 1942 | GB, Ma, Sa, Dr, Sp | Destroy 2 U-boats (charges at the stern by the torpedoes) | Two start groups; U-boat pens; lighthouse mole; fishing village; air-dropped charges; vacant half-track; uniform | 10 walkers, 5 sentries, 3×2 + 3×3 + 5 patrols, two 210 mm guns, 1 MG, 3 garrisons. Split zones: W dock / E village | Rowboat to the red buoy SE | 840 |
| 8 | Pyrotechnics (Fireworks) | Egypt: Tell el Eisa, 19 Oct 1942 | GB, Sn | Destroy the oil barrels, fuel tanks and reservoir | First desert map, **orange cones**; plateau ruins start; 210 mm gun (barrel beside it); 10 barrels for a chain; hide in houses | 17 walkers, 13 sentries, 210 mm gun, 1 MG, 2 garrisons. **Whole map** | Jeep arrives at the bridge once "everything is burning" | 600 |
| 9 | A Courtesy Call | Egypt: Bab el Qattara, 20 Oct 1942 | GB, Sn, Sa, Dr, Sp (disguised) | Destroy the comms building and antenna, weapons store, command post and bunker | **3 Panzer IVs on standby** fire if you are seen: block or destroy them with the fuel tanker at the shed; minefield start; octagonal adobe wall | 4 walkers, 5 sentries, three 3-man patrols, 3 Panzer IV, 1 garrison. **Whole map** | Friendly truck in the SW corner after the objectives | 540 |
| 10 | Operation Icarus (Icare Operation) | Libya: El Agheila, 14 Nov 1942 | GB, Sn, Sa, Dr + McRae | Rescue McRae; destroy the bomb store (the 2 Stukas are optional and add no merit) | The only drivable Panzer IV (boarding it sounds the alarm); prisoner pen; airfield; 3 MG nests on the winding road | 9 walkers, 9 sentries, two 3-man patrols, 3 MG, **4 Panzer IVs on standby**, 2 garrisons. Separate camp and airfield zones | Ju 52, flown by McRae | 780 |
| 11 | In the Soup | Libya: Maradah, 3 Dec 1942 | GB, Sn, Sa, Dr, Sp (disguised) | Destroy 4 drilling rigs | Opel Blitz tanker shuttling between two rigs (shoot it beside one); tunnel to collapse (a charge) against the N half-track; oil crater | 18 walkers, 10 sentries, four 3-man patrols, 1 MG, SdKfz on standby, 3 garrisons. Whole map (local in practice) | Vacant half-track, W/NW road | 780 |
| 12 | Up on the Roof (On the Roof) | Tunis, 15 Mar 1943 | GB (decoy only), Sn, Sp (disguised) + Informer (jailed) | Free the Informer; everyone to the Kübelwagen | Scattered start, hunted; rooftop routes (the roof rule); mosque and minaret; harbour | 19 walkers, 16 sentries, two 3-man patrols, 2 garrisons. Two zones: courtyard (about 3 reinforcements); **SE HQ must never alarm** | Kübelwagen SE | 600 |
| 13 | David and Goliath | France: Le Havre, 15 May 1944 | GB, Sn, Ma, Sa, Dr | Torpedo the battleship's **bow**; destroy the fuel tanks | Lock gates cycled by a supply boat (horn); control shacks; **mini-sub with 2 torpedoes** (straight runs along its heading); Panzer II garage (block it with the truck); pier gun vs the patrol boat | 10 walkers, 9 sentries, a 3-man patrol, patrol ship, Panzer II, 1 garrison. Zone: right dock. **Fail:** the tank shells the sub | Row to the red buoy SW | 720 |
| 14 | D-Day Kick Off | France: La Rivière (Juno), 25 May 1944 | GB, Sn, Ma, Sa, Dr | Destroy 4 coastal guns | Fortified coast, central ridge (GB climbs), casemates, sea wall; drivable Panzer II; 5 MG nests | 24 walkers, 18 sentries, five 3-man patrols, 5 MG, 2 garrisons; 50+. Seen from the wall = alarm; N of the start is safe | Boat to the SE buoy | 900 |
| 15 | The End of the Butcher | France: Compiègne, 26 Aug 1944 | Sn, Ma, Dr, Sp | Kill SS-Gruppenführer Schleper; destroy his HQ | **Any alarm → he runs for a car → fail on reaching it**; garden walk with a pause at the NE corner; tram (hide inside; tram vs tanker = "accident", no alarm); tainted vehicles get shot by their own side | 17 walkers, 11 sentries, a 3-man and three 5-man patrols, SdKfz patrol. **Whole map** | Truck at the N cemetery | 660 |
| 16 | Stop Wildfire (Fire Halt) | Belgium: Maas bridge, Liège, 4 Sep 1944 | Sn, Ma, Sp | Kill the 4 bridge sappers almost at once | **Any alarm → the sappers run to their detonators → fail**; the Spy can drive the truck (block the bridge); trains kill and give cover; clothesline uniform | 14 walkers, 16 sentries, 2×3 + 3×5 patrols, 2 surveillance bunkers, 4 sappers, 3 garrisons. **Whole map** | Truck S | 720 |
| 17 | Before Dawn | France: Riveauvillé near Colmar, 28 Nov 1944 | GB, Ma, Sp (disguised) + Gilbert & 4 | Free the 5 prisoners; everyone into the truck | Lever-operated mobile bridge (crushes); back-gate control box; fuel valve (click repeatedly) and oil fire; 5 watchtowers; old mill; getting captured on purpose works | 14 walkers, 11 sentries, four 3-man patrols, 1 MG, surveillance bunker, 5 towers, 2 garrisons. **Whole map** | Truck NW | 780 |
| 18 | The Force of Circumstance (Strength of Hazard) | Belgium: the same Maas bridge, 16 Dec 1944 | GB, Ma, Sa, Dr | Blow the bridge: 3 remote charges on markers A/B/C, from the island | Counter-clockwise route: SE fields → station (barracks) → island → German camp → bridge; a grenade on the track stops trains; Panzer III | 20 walkers, 14 sentries, 2×2, 6×3, 1×4 and 1×5 patrols, 2 MG, 2 surveillance bunkers, 2 SdKfz on patrol, 3 garrisons. **Whole map** | Truck S/SE | 900 |
| 19 | Frustrate Retaliation (Frustrated Revenge) | Germany: Oldenburg, 12 Jan 1945 | GB, Sn, Ma, Sa | Destroy 3 V2s and their launch pads | Coal mine **conveyor** (a switch reverses it; it carries crawling men in); mine cart; **fast river** (no rowing upstream); **dogs** (caged plus patrol); watchtower (bomb at its base kills the gunner) | 21 walkers, 13 sentries, several patrols, 3 MG, surveillance bunker and tower, Panzer II on alert, truck driver, dogs. Zones: N bunker; S base | Boat NE, downstream | 840 |
| 20 | Operation Valhalla | Germany: Gundelfingen castle N of Freiburg, 11 Feb 1945 | All six (GB + Sp start W; Sn, Ma, Sa, Dr start E) | Destroy the HQ and 2 V2s | **Unlocked only at Captain (30 gold)** or by its password; octagonal castle, moat, 2 gates with bridges; only one GB climb spot (W wall below the HQ); **firing range** (pistol shots raise no alarm there); lever with a flashing red light opens the E water gate; uniform on a W-quarter clothesline; Panzer III guarded by a fixed AT gun (snipe its gunner); Flak by the HQ | 57+ numbered enemies; 4 at each gate; whole castle alarm; 2 S-corner guards must be left alive | Panzer III out the SW gate | 1080 |

### 7.2 *Beyond the Call of Duty*: 8 missions (`campaign:'BCD'`, built LATER)

**Sources.** The data comes from the retail MIS files (gap-6), the BCD manual and Varkovsky.

**The `BCD` ruleset turns on:**
- knock-outs (X; unaware targets only; about 30 s [rec]);
- handcuffs (GB and Spy only; they cuff KO'd soldiers);
- puppet (R);
- stones (Y) and cigarette packs (V; the pack works only in the near band);
- the Spy's hanger (T) and several uniforms (U cycles);
- sergeants, officers and Gestapo seeing through lower-rank disguises;
- the Driver's Lee-Enfield (E; one-shot kill, 50 rounds, pistol-loud);
- BCD hotkeys;
- Easy/Hard as data variants (Hard adds `DIFICIL` guards and shortens waits; cones and damage are unchanged);
- a start rank of **Major**, with Field Marshal at 24 stars.

**Par.** `PAR_TICKS` Easy/Hard. Gap-6 converted them at 25 ticks/s; at our 20 Hz base they would run 25% longer. Pick one when BCD is built.

| # | Title | Place, date | Team (start) | Objectives | Key features | Enemies (placed E/H + patrols) | Alarm consequence | Extraction | PAR_TICKS E/H (@25 Hz) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Dying Light | Guernsey, 14 Jul 1940 | GB, Sn (6 rds), Ma, Sa (4 remote bombs, trap, no grenades); all in a dinghy, NE corner. First aid: 5 uses | Destroy the radar antenna, the lighthouse and **5 AA guns** | Rocky island, lighthouse, fort; **22 sea mines**; lift down to the beach; 3 barrels | 23/27 + 3 MG; 1 roaming + 4 reaction patrols (2–3) from 3 barracks | Reinforcements only | Dinghy to the SW buoy | 16932 / 17290 (11:17 / 11:32) |
| 2 | The Asphalt Jungle | Belgrade zoo, 23 Apr 1941 | GB, Dr (SMG 100, rifle 50), Sp (syringe 5), + Maj. Dragiša Skopje (held NE) | Rescue Skopje | Pits, cages, villa; **3 lions, 4 ostriches**; zookeeper (flees to the barracks; his uniform passes patrol sergeants); firing squad of 3 | 30/31 + 1 MG; 3×2 roaming + 5 reaction | **Garden, north or pit zone alarm → the squad shoots Skopje = fail** | Van, NW road | 35856 / 30191 (23:54 / 20:08) |
| 3 | Dropped Out of the Sky | Crete, 10 Jun 1942 | GB, Sn (7), Dr; start inside the church (NE) | GB carries the Hs 293 guidance module to the lorry | River gorge, bridge, white-church village, ruins; **1 German shepherd** | 32/37 + 1 MG; 2×2 + 4×2 | Reinforcements; the lorry drive-off sets off a harmless alarm | Lorry, W/NW road | 62250 / 55860 (41:30 / 37:14) |
| 4 | Thor's Hammer | Bonn station, 11 Sep 1943 | GB, Sn (5), Sa (4 bombs, 2 grenades, trap); start SW | Rail gun "Karl" (2 charges); the armoured train (bombs plus barrels) | Rail yard, station hall, roundhouse; **pushable wagons as moving cover**; 3 barrels | 66/69 + 2 MG; 6×2 + 9 reaction from about 5 barracks (the largest garrison) | Reinforcements | Locomotive on track 1, heading E/NE | 87150 / 72884 (58:06 / 48:35) |
| 5 | Guess Who's Coming Tonight | Rastenburg (Wolf's Lair), 15 Jul 1944 | GB, Sn (5, +4 ammo box), Dr (separate start); **Spy jailed N** | Free the Spy; kidnap SS Col. von Below into the Panzer II | Forest château; officer uniform on a roof; ammo box; E-door platform (climb) | 68/69 + 4 MG; 5 roaming + 7 reaction including a 3-man colonel guard | **Interior or roof zone alarm → the colonel drives off = fail** (if his car is blocked, he flees on foot E and can still be caught) | Panzer II, SE road | 62250 / 49875 (41:30 / 33:15) |
| 6 | Eagle's Nest | Neubrandenburg airfield, 12 Nov 1944 | GB, Sn (6), Sa (4 bombs, 4 grenades, trap, cutters); SW corner | Destroy **5 prototypes** (3 other planes optional); kidnap the pilot | **4 pushable fuel tanks**; 5 barrels; footprints on paths give you away; chickens | 37/43 + 1 MG; 2 roaming + 5 reaction | Pilot-zone noise → the pilot hides and a 3-man patrol comes out; any alarm → the pilot flies off = fail | Jet from the centre (the pilot flies) | 73870 / 59185 (49:15 / 39:27) |
| 7 | The Great Escape | Nuremberg POW camp ("Stalag 13"), 20 Nov 1944 | Ma, Sa (1 bomb, 4 grenades, trap, cutters) start SW; **GB and Dr are prisoners** walking the yard | Free GB and Dr; recover their **knapsacks** (NW); blow the officers' barracks (the POWs flee N) | 9 POWs; a **snitch** (position differs by difficulty); towers ignore bodies | 40/43 including 4 escorts + 1 MG; 1×4 + 3 reaction | Interior alarm → the escorts march GB and Dr into punishment cells | Lorry, E/SE road | 57768 / 42826 (38:31 / 28:33) |
| 8 | Dangerous Friendships | Nijmegen, 18 Dec 1944 | GB, Sn (5), Ma (dinghy) start SE; **Natasha** in her house (SE) | Get the scuba gear; meet Natasha; she lures Gen. Rauter to the club (300-tick meeting); steal the documents | Canal city, **drawbridge** plus switch; patrolling tugboat; **5 Gestapo** (recognise Natasha and any disguise); watermill | 50/55 + 1 MG; 2×2 + 4×3 | Gestapo see through everything | Launch from the W dock, heading E | 59760 / 53200 (39:50 / 35:28) |

### 7.3 Mission data rules (extensions to the ARCHITECTURE schema; §10.4)

Every mission file adds the following to the ARCHITECTURE schema. Existing fields keep their meaning; `size` is `[W, D]` in metres.

```js
campaign: 'BEL',
coneColors: 'green' | 'desert',
lighting: { sunElevDeg, kelvin, hdri, fog, lut },
water: { velocity, angleDeg, turbulence } | null,
shoreShallowWidth: 2.0,                         // builder turns deep-water cells within this distance of land into SHALLOW
zones: [ {id, poly, onSeen, onHeard} ],
jails: [structureId],
alarmFail: {...} | null,
climbLinks: [ {a:[x,z,y], b:[x,z,y]} ],         // GB climb edges
ladders: [ {x, z, top:[x,z,y], raised?} ],
triplines: [ {unitId|role, zone, event} ],
barracks: { id: {pool, squads:[{event, size, exitRoute, loop}]} },
enemies[i]: { id, soldierType, flags:{holdsPost|investigates, followsTracks, ignoresBodies, raisesAlarmOnSight},
              squad?:{id, leader, columns}, route?:{type:'LOOP'|'PINGPONG', vel, points:[{x,z,wait,look}]},
              post?:{heading, sweep, period}, partner?, jail?, elevated?, y?, nervousness?:50 },
par: { time },                                  // seconds
startDisguised: ['spy'],
extraction: { vehicleId, exit:{x,z,r}, spawnWhen:[objectiveIds] }
          | { zone:{x,z,r} }
          | null,                               // null only for M1
```

- Mission briefings, TA text and notebook hints are **our own wording**.
- Objective and hint *content* follows the research; the original strings are not copied.
- **Layout rule: structures run parallel to their enclosure** (BEL look; matters with the 15° camera yaw). Fuel /
  storage / water tanks and cisterns (tank pairs and rows) are **strict**: their `rot` is the angle of the fence /
  wall / palisade they stand in or by (within 12 m; otherwise the nearest road / pavement edge within 10 m) modulo
  90°, within 2°, and so is anything tagged `align: 'fence'`. Every other building is an **aesthetic call**: align it
  where that makes the compound read orderly (a long barracks along its wall, a sentry box at the gate, a garrison
  beside the palisade), keep its own angle where that looks better (villages, rural cabins, a grid of huts, a
  building facing the gate or the camera). Avoid near-misses: 3–15° off the neighbouring fence reads as a mistake,
  so make it parallel or clearly different (≥ ~20°). Among the four parallel rotations pick the one whose door /
  facade faces the yard, gate approach or street (the camera when unsure). `src/missions/alignment.js` checks it;
  `node tools/layout/align-report.mjs` lists STRICT violations and advisory near-misses; `tests/unit/alignment.test.mjs`
  enforces the strict set (and no near-misses) for the missions in its `ENFORCED` list. `alignFree: '<reason>'`
  opts a structure out.
  All of M1–M20 are enforced. The M4–M20 pass (2026-09-30) turned M8's tank pair 17.5° to `wire_e`'s wadi leg (decks,
  ladders and e26's walk with it) and settled every near-miss by the smallest change that reads right on screen:
  straightening a wobbling fence/quay/railing to the buildings' grid (M6 `w_s`, M12 `quay_n`, M14 `wr_n5`, M15
  railings and garden wall, M19 `pal_n`, M20 two road vertices), turning a prop/hut/vehicle onto its wall or road
  (M7, M9, M10 camp props and tent row, M11, M15, M17, M19 carts onto their rail, M20), or `alignFree` with the reason
  where the analyzer's reference is not the right one (a bridge plunger, a rail buffer, a corner gate, a dog pen).
  Quay faces count as walls (the `quay_edge` set-piece's rings and lines): after the master merge of 2026-10-01 this
  caught M13's depot, whose two fuel tanks stood at −10° on the 0° N quay (now 0°, `fuel_2` 0.3 m N), and the
  launch, shacks and crates beside the quay faces; M14's `cr_s1` turned 14.6° along the art pass's supply track.

### 7.4 Mission 1: *Baptism of Fire* (buildable layout)

**Header.**

| Field | Value |
|---|---|
| id | `m01` |
| campaign | BEL |
| size | **[65, 171]** |
| theater | `snow`; `coneColors: 'green'` |
| lighting | sun 15° from the NW, 6000 K, overcast HDRI, fog 150 m, LUT `norway` |
| water | velocity 0 (still fjord), turbulence 0.2 |
| baseTerrain | `snow` |
| par | **155 s** [data: `PAR_TICKS 3100`] |
| cameraStart | {x 30, z 150, zoom 1} |
| Date / place | 20 Feb 1941 · Sola, near Stavanger, Norway |

**Briefing (our own wording).**
- *Historical:* "Winter, 1941. Stavanger airfield is the Luftwaffe's northern eye over the North Sea, and its radio traffic runs through a small relay station at Sola. Silence it, and the bombers fly blind."
- *Colonel:* "Your men have landed apart, officer. The Marine is on the eastern peninsula; the Green Beret and the Driver are south of the coast road. Regroup at the wooden jetty, cross the fjord, and destroy the relay station in the north-west corner of the island. There are fuel drums by the barracks, and the Green Beret can handle those. Good luck."
- *Notebook hints:*
  - Regroup at the south jetty.
  - The raft lies on the peninsula's west shore; only the Marine can use it.
  - Guards follow fresh footprints in the snow. Crawling leaves none they can see.
  - Sentries can see a body on the open shore from across the still fjord. Clear the south bank before the peninsula, or hide the bodies.
  - A fuel drum shot next to the station will do the job. Shoot it from well back: the parked car will go up too.

**Terrain** (applied in order after `baseTerrain`):

| # | Terrain | Shape (points in m) |
|---|---|---|
| T1 | `ground` (packed camp ground) | rect x 8–46, z 4–36 |
| T2 | `water` (deep fjord) | poly (0,45) (10,43.5) (22,45) (34,42.5) (46,41) (56,38.5) (65,37) (65,53) (56,54) (46,55.5) (39,57) (36.5,64) (35.5,76) (36,88) (38,96) (46,98.5) (56,98) (65,97.5) (65,104) (54,104.5) (42,103.5) (34,102) (26,103) (14,102.5) (0,103) |
| T3 | `shallow` | automatic 2.0 m rim (`shoreShallowWidth 2`) |
| T4 | `grass` | rect x 20–44, z 105–128 (trampled around the house) |
| T5 | `road` | path (0,154) (14,142) (26,131) (40,135) (52,140) (65,147), width 6 |

- The T2 polygon leaves the **Marine's peninsula** (x 36–65, z 55–98) joined only to the east map edge. It is reachable from the rest of the map only across water.

**Structures** (types from the ARCHITECTURE catalogue; rot is heading in degrees; sizes in metres):

| id | type (variant) | x | z | rot | w × d × h | Flags / notes |
|---|---|---|---|---|---|---|
| `relay_hut` | hut (`relay_station`) | 12 | 12 | 0 | 6 × 5 × 3.5 | **Objective.** `destructible`, `destroyedBy:['explosion']`, with debris and fire |
| `relay_mast` | radio_mast | 16.5 | 8 | 0 | 1 × 1 × 18 | **Objective.** Collapses on destruction |
| `barr_L_a` | barracks (`timber_long`) | 32 | 19 | 0 | 16 × 7 × 4.5 | No garrison (M1 has none) |
| `barr_L_b` | barracks (`timber_long`) | 37 | 26.5 | 90 | 8 × 6 × 4.5 | Wing of the L |
| `barr_2` | barracks (`timber_long`) | 14 | 32 | 0 | 12 × 6 × 4.5 | |
| `pier_n` | pier | 42 | 39 | 90 | 2.5 × 7 | Boat landing on the north shore |
| `mg1` | sandbags (`mg_ring`) | 22 | 39.5 | 90 | r 1.8, h 1.0 | `B.LOW`; mounted MG (manned by e13; the Driver can capture it) |
| `jetty_s` | pier | 32 | 99 | 270 | 2.5 × 7 | **Rendezvous** jetty on the south shore |
| `house_s` | house (`timber_2storey`, snowy roof) | 30.5 | 113 | 0 | 10 × 8 × 7 | Not enterable |
| `wall_s` | wall (`stone_plank_roof`) | points (25.5,117) (21,125) (17.5,132) | | | width 0.6, h 1.8 | **`climbable:true`** (GB) |
| `sbox` | hut (`sentry_box`) | 16.5 | 134 | 26.6 | 1.6 × 1.6 × 2.4 | Square to the end of `wall_s` (its gate post) |
| `debris` | crates (`timber_debris`) | 27 | 127 | 30 | 3 × 2 × 1 | `B.LOW` |
| `rubble` | ruins (`rubble`) | 9.5 | 150.5 | 0 | 3.5 × 2 × 1.0 | `B.LOW` (e6 stands "behind rubble") |
| `rocks_drv` | rocks | 57 | 150 | 0 | 7 × 4 × 2.5 | `B.HIGH`: hides the Driver's start |
| `rocks_s1`, `rocks_s2` | rocks | 10 / 40 | 166 / 164 | 0 | 5×3×2 / 4×3×2 | |
| `islet_1`, `islet_2` | rocks (in water) | 18 / 23 | 72 / 78 | 0 | 5×4×3 / 3×3×2 | Block LOS across the fjord |
| `poles` | telegraph_pole ×5 | (6,141) (20,129) (36,130) (50,135) (62,141) | | | h 7 | With wire spans between them |
| trees | pine (occluder r 0.8) | N: (2,20) (30,9) (54,4) (60,10) (62,22) (58,30) (52,34) · W of house: (14,110) (18,106) · S of road: (32,146) (36,150) (28,152) | | | h 8–12 | Every tree has a unique seed |
| trees | tree (deciduous, bare winter) | (12,118) (20,114) (58,118) (62,124) (54,122) | | | h 7–9 | occluder r 0.7 |
| barrels | barrels (`fuel_explosive`, single) | `b1` (41.8,23.5) · `b2` (42.8,24.3) · `b3` (41.9,25.2) · `b4` (21.5,33) · `b5` (21.5,34.2) | | | Ø 0.6, h 0.9 | Explosive class `barrel`; GB can carry them |

**Vehicles.**

| id | Type | Position | Heading | Notes |
|---|---|---|---|---|
| `raft` | raft | (37.2, 60.5), shallow water (see Appendix A) | 180 | **Starts inflated and unused (not suspicious).** Marine only |
| `truck` | truck (canvas Opel) | (51, 139.5) | 22.6 | Driveable; 6 seats; 30 bullet hits |
| `kubel_decor` | Kübelwagen | (20, 12) | 90 | Parked by the relay; not driveable (decor, but it occludes) |

**Commandos.**

| Role | Position | Heading | Inventory |
|---|---|---|---|
| greenberet | (16, 158) | 270 | knife, pistol, decoy, shovel |
| diver | (61, 96) | 270 | knife, pistol, harpoon, divingGear |
| driver | (60, 158) | 270 | pistol, smg 100, firstAid 6 |

**Enemies** (13; Prima numbers in brackets):

| id | # | soldierType, flags | Position | Behaviour |
|---|---|---|---|---|
| e1 | [1] | soldier, holdsPost | (48,58) | PINGPONG VEL 1.0: (48,58) wait 4 look 270 → (62,57) wait 4 look 270. North shore of the peninsula |
| e2 | [2] | soldier, investigates | (58,76) | PINGPONG: (58,76) wait 3 look 0 → (42,78) wait 3 look 180 |
| e3 | [3] | sentry, holdsPost, partner e1 | (40,60.5) | Post heading 270 (faces away from the Marine, over the water), sweep 35, P 5 s. Stands beside the raft |
| e4 | [4] | soldier, investigates | (12,42.5) | PINGPONG: (12,42.5) wait 3 look 90 → (30,42.5) wait 3 look 90. North shore |
| e5 | [5] | soldier, holdsPost | (36,40) | PINGPONG: (36,40) wait 3 look 90 → (52,37) wait 3 look 90 |
| e6 | [6] | sentry, investigates | (6,146) | Post heading 270, sweep 35. Road sentry W of the GB, "behind rubble" |
| e7 | [7] | sentry, investigates | (27,121) | Post heading 20, sweep 40. At the house; faces away from the wall |
| e8 | [8] | sergeant, squad `p2` leader, followsTracks | (46,112) | PINGPONG: (46,112) wait 4 look 270 → (49,125) → (53,137) wait 4 look 90. Walks N–S to the truck and turns there |
| e9 | [9] | trooper, squad `p2` | behind e8 | columns 1 |
| e10 | [10] | sergeant, squad `p3` leader, followsTracks | (5,36) | LOOP VEL 1.0: (5,36) → (5,6) → (26,3) wait 4 look 270 → (46,8) → (48,18) → (46,33) wait 4 look 90 → (28,37.5) → (5,36). Circles the relay and the barracks |
| e11, e12 | [11–12] | trooper, squad `p3` | behind e10 | columns 1 |
| e13 | [13] | mg (nest `mg1`) | (22,39.5) | Post heading 90 (covers the south approach across the fjord), sweep 35, giro 180 |

**Other data.**
- **Zones:** none. Kildread: "the entire map is safe". Shouts and bodies still trigger local reactions, but there are no barracks.
- **Jails:** none, so patrols fire on sight and sentries hold.
- **Objectives:** `o1` "Destroy the relay station": `destroy`, targets [`relay_hut`, `relay_mast`], required, **`endsMission:true`**.
- **Extraction:** `null`. The win fires 5 s after o1 completes, provided no commando is dead (§8.1).
- **Intended solution paths** (all must be possible):
  1. The Marine dives, surfaces behind e3, e1 and e2 and harpoons them. He packs the raft and harpoons e4 and e5 from the water.
  2. The GB knifes e6 from behind, crawls along the wall, climbs it and knifes e7. He hides the body north of the house.
  3. The GB drops the decoy on the road. p2 walks to it and stares. The Driver takes the truck and **double-clicks past them** (run-over).
  4. The Marine inflates the raft at the jetty and ferries everyone (two trips) to the north shore behind `barr_L_a`.
  5. Two ways to finish p3 and the station:
     - Shoot a barrel as p3 passes, then carry a barrel to `relay_hut` and shoot it;
     - Or knife the MG gunner, man `mg1` with the Driver, and fire at a barrel placed by the relay.
  - Metamud challenge: finishing with only 2 kills is possible.

### 7.5 Mission 2: *A Quiet Blow-Up* (buildable layout)

**Header.**

| Field | Value |
|---|---|
| id | `m02` |
| size | **[82, 120]** (was [82, 104]: the river was widened to ~24 m and the SW bank moved 16 m south, 2026-09-30) |
| theater | `snow`, green cones |
| lighting | sun 16° from the NW, 6200 K, overcast; river colour #107083 |
| water | velocity 0.6 m/s, angle 40° (flowing SE), turbulence 0.4 |
| par | 480 s |
| cameraStart | {x 16, z 108, zoom 1} |
| Date / place | 1 Mar 1941 · Stamsund, Lofoten (Operation Claymore) |

**Briefing (ours).**
- *Historical:* "Operation Claymore strikes the Lofoten Islands. Fuel stored at Stamsund feeds the German armour in the north; burn it and their tanks go nowhere."
- *Colonel:* "You start in the small settlement south of the river. The depot is inside the walled camp on the far bank: two big fuel tanks. A patrol boat works the river, so hide when you hear its engine. The camp's ladder is pulled up; your Green Beret will have to go over the wall. There's a truck inside the camp. Blow the depot and drive out through the south-east gate, and don't stop for anyone."
- *Notebook hints:*
  - Anything suspicious on the far bank raises the alarm.
  - Hide when the patrol boat passes; pack the raft after crossing.
  - The packed raft slows the Marine down. Send him off a little ahead of the others.
  - The ladder can be lowered from the top of the wall.
  - Footprints in the snow can lead a curious guard into a trap.
  - Drive the truck out of the SE gate without stopping.

**Terrain.**

| # | Terrain | Shape |
|---|---|---|
| T1 | `water` (river) | `riverPath()`: Catmull-Rom through (−12,26.6) (0,36) (18,50) (36,64) (52,78) (64,92) (70,104) (73,116) (74,132), sampled every ~4 m, per-point `widths` ~20–28 m (mean 24; wide pools round the islets). The NE bank keeps the old 12 m river's NE edge (only nudged ≤ 0.9 m into the water); the SW bank is NE bank + width. Was: that polyline, width 12 |
| T2 | `shallow` | auto rim 1.5 m |
| T3 | `ground` | poly (16,33) (42,10) (71,35) (46,58): camp interior, packed and trampled |
| T4 | `road` | path (56,49) (62,56) (70,62) (82,68), width 5 |

- The river splits the map into the **SW bank** (start) and the **NE bank** (camp).
- NE bank edge ≈ (0,28) (18,42) (36,56) (52,70) (64,84) (74,104) (78,120) (unchanged). SW bank edge ≈ (0,60) (16,73.5) (22,74.5) (31,85.5) (44,99.5) (54,103.5) (60,120) (shallow rim included).

**Structures.**

| id | type (variant) | x | z | rot | size | Notes |
|---|---|---|---|---|---|---|
| `camp_wall` | wall (`palisade_wire`) | closed poly W (16,33) → N (42,10) → E (71,35) → S (46,58) → W, with the gate gap on the SE edge | | | h 3.0 | `B.HIGH`. The SW edge from (22.5,38.4) to (29.5,44.3) is **`climbable`** (GB) |
| `ladder_sw` | (ladder, `ladders[]`) | 27.4 | 43.0 | 130 | top (27,42.2), y 3.0 | **`raised:true`**; lowered from the top (1.0 s) |
| `walk_sw` | (wall walkway, part of `camp_wall`) | 28.5 | 43.2 | | y 2.2 | Elevated standing spot for e5. Bodies and prone men on it are hidden from the camp interior (§4.7 deck-edge rule) |
| `gate_se` | gate (`barrier_boom`, `gap` [−3.6, 4.05]) | 56 | 48.8 | 317 | boom 4 m; wall opening 7.65 m | **Boom barrier** as in the original (user request): red/white striped pole with a HALT plate, pivot post beside the pole on the sentry-box side (pin bearing, counterweight in an iron cage), fork rest, two log gate posts where the palisade ends. **Walkers go round it** by a 1.5 m footway between the fork rest and the E gate post (the pivot side stays blocked, raised or not). Operable (raise ~1.2 s); a slow vehicle stops at it (`gate:hold`), a fast one snaps the pole at the hit point: the stub stays on the pin with the counterweight, the outer pole flies |
| `plat_sw` | timber_platform | 27.99 | 40.94 | 39.8 | 2.2 × 1.05, deck 2.2; stair 0.9 wide, run 3.2 | The original's timber scaffold inside the river wall: a plank landing off `walk_sw` (posts, joists, knee braces, hand rails) and a stair down along the wall into the camp (graded walkable cells; hand rail on the camp side only, `stair.outerRail: false`: the wall walk is its other side, and an outer rail would catch e5's falling body). The team's way in once the GB has lowered the ladder; replaces the old inner-steps link and the GB's drop link |
| `sbox_se` | hut (`sentry_box`) | 52.87 | 53.67 | 317 | 1.6 × 1.6 | Just outside the gate on the SW verge of T4 beside the S gate post, SW of the boom's pivot (gate-local u −5.6: the pivot post and counterweight stay in view from the default camera; at (54.4, 52.3) the box hid them), clear of the straight truck line start → gate → exit (was (60,53), on the road: blocked the escape) |
| `barr_camp` | barracks (`log_garrison`) + flag | 37.74 | 24.01 | 318.5 | 12 × 6 × 4.5 | **Garrison**, pool 10; **jail**. Runs along the NW edge (−41.5°), clear of p3's N-corner leg |
| `cab1` | hut (`log_cabin`) | 29.26 | 36.77 | 219.8 | 5 × 4 × 3.5 | Parallel to the SW edge, door to the yard |
| `depot_a` / `depot_b` | fueltank (`horizontal_cradle`) | 49.64 / 57.21 | 27.94 / 34.47 | 40.8 | 9 × 3.4 × 3.5 | **Objective**, `bombOnly:false` (bomb or barrel). End to end along the NE edge (strict alignment rule, §7.3) |
| `t1` / `t2` | watchtower (`mg_platform`) | 30 / 56 | 20.6 / 22.1 | 228 / 311 | 3 × 3, deck at 5.5 m | **Open timber MG platforms** as in the original: splayed log legs with plank X-bracing, plank deck, sandbag parapet (open at the ladder), hand rail, ladder at the back, an MG 34 on its Lafette tripod laid over the parapet, ammo boxes at the back. Each with an MG gunner facing **outward**, visible on the open deck, **manning the gun**: he kneels behind the butt with his hands on its grips, the tripod and gun traverse with him (render/mg-mount.js; his own MG 34 stays put away), and his muzzle flash / tracer leave the MG muzzle (by day a small flash with a weak, short light: no bloom over the deck) |
| `crates1` | crates | 46 | 48 | 317.4 | 2 × 2 × 1.2 | `B.LOW`; parallel to the SE edge |
| barrels | barrels (`fuel_explosive`) | (25,33) (26,33) (48.5,36.2) (49.4,36.8) | | | | 4 barrels |
| `barr_out` | barracks (`log_garrison`) + flagpole | 73.26 | 39.18 | 47.4 | 6 × 8 × 4 | **Garrison**, pool 5; parallel to the SE edge. The E-corner charge (within 6.75 m) razes it |
| `rocks_n1..3` | rocks | (22,40.5) · (34,51) · (41,55.5) | | | 4×2.5×2.2 · 4×2.5×2.2 · 3×2×2 | Between the SW wall and the river: cover |
| `islet1` / `islet2` | rocks + pine (island) | disc (16.9,63.7) / (40.6,83.0); rocks (16.0,64.2) / (39.8,83.5); pines (18.0,64.4) / (41.7,83.4) | | | r 3.0 / r 2.8 | In the river's SW half, ~17 m off the NE bank: a channel on both sides, ≥ 3.5 m from the boat lane |
| `sw_wall` | wall (`palisade`) | S side (28,113)–(10,113) and (6,113)–(1,113); W side (1,113)–(1,86); N side (1,86)–(28,86); E side (28,86)–(28,92) and (28,96)–(28,113) | | | h 2.2 | SW settlement. **Openings:** S at x 6–10; E at z 92–96 |
| `cabA` / `cabB` | hut (`log_cabin`, snowy roof) | (6.5,96) / (16,107) | | 0 | 7 × 5 × 4 | |
| trees | pine | SW bank (4,72) (11,76) (33,96) (44,108); NE bank (60,70) (70,20) (78,8) (8,20) (20,6) | | | h 9–13 | occluders |

**Vehicles.**

| id | Type | Position / route | Notes |
|---|---|---|---|
| `truck` | truck | (50, 44), heading 47.4 | Faces the gate, square to the SE edge; **escape vehicle** |
| `pboat` | patrol boat | PINGPONG (1,41.3) wait 15 → (15.9,52.8) → (33.8,66.7) → (49.5,80.5) → (62.9,96.6) wait 15, at **2.5 m/s** (lane 9.5 m off the NE bank, deep water for a true-scale 13.6 m HS 114) | Crew: `mg` gunner (vision `mg`, sweep 60, giro 180, facing travel). Engine audible at 60 m. About 103 s per cycle |

**Commandos** (behind the S palisade of the SW settlement).

| Role | Position | Inventory |
|---|---|---|
| greenberet | (8, 117) | knife, pistol, decoy, shovel |
| sniper | (11, 117) | pistol, rifle 5 |
| diver | (14, 117) | knife, pistol, harpoon, divingGear, **raft (packed)** |
| sapper | (17, 117) | pistol, trap, timeBomb 2 |
| driver | (20, 117) | pistol, smg 100, firstAid 6 |

All start at heading 270.

**Enemies** (Prima numbers in brackets).

| id | # | soldierType, flags | Position | Behaviour |
|---|---|---|---|---|
| e1 | [1] | soldier, investigates, followsTracks | (4,89) | LOOP: (4,89) → (24,89) wait 3 look 0 → (24,101) → (11,101) wait 3 look 180 → (11,91) |
| e2 | [2] | soldier, investigates, followsTracks | (14,94) | PINGPONG: (14,94) wait 4 look 90 ↔ (24,108) wait 4 look 180 |
| e3 | [3] | soldier, investigates, followsTracks | (22,111) | PINGPONG: (22,111) wait 3 look 90 ↔ (22,92) wait 3 look 270 |
| e4 | [4] | soldier, holdsPost | (20,42.5) | PINGPONG: (20,42.5) wait 3 look 135 ↔ (40,57.5) wait 3 look 135. Walks in front of the rocks (snipe him there) |
| e5 | [5] | sentry, holdsPost, **elevated y 2.2** | (28.5,43.2) | Post heading 130 (over the river), sweep 35. On the wall walkway beside the ladder |
| e6 | [6] | soldier, investigates | (30,31) | PINGPONG: (30,31) wait 3 look 180 ↔ (51,49.5) wait 5 look 40. Walks to the gate |
| e7 | [7] | soldier, holdsPost | (47.28,21.41) | LOOP around the depot, parallel to the NE edge: (47.28,21.41) wait 2 look 41 → (63.98,35.81) wait 2 look 315 → (59.01,41.57) → (42.31,27.17) wait 2 look 180 |
| e8 / e9 | – | mg (towers t1 / t2), elevated y 5.5 | on towers | Post 228 / 311, sweep 50, giro 180 |
| e10–e12 | – | sergeant + 2 troopers, squad `p3`, jail `barr_camp` | (20,34) | LOOP VEL 1.0: (20,34) → (38,14.5) wait 3 look 225 → (64,32.5) → (64,40) wait 3 look 45 → (46,53) → (20,34) |
| e13–e16 | – | sergeant + 3 troopers, squad `p4` (columns 2), jail `barr_camp`, reactEvents [RINT] | (80.5,4) | PINGPONG along the E edge: (80.5,4) wait 5 look 180 ↔ (80.5,96) wait 5 look 180. Crosses the escape road at z 68. **Alarm route:** (62,54) at VEL 3, then loop (58,54) (68,44) (78,52) (70,62) |
| e17 | – | mg (boat gunner) | on `pboat` | – |

Kildread's count is 6 walkers, 1 sentry, patrols of 4 and 3, 2 towers, the boat and 2 garrisons. The table gives the walkers e1–e4 and e6–e7, sentry e5, p3 and p4, towers e8–e9, and the boat gunner e17.

**Zones and alarm.**
- `z_ne` = the NE bank: poly (0,0) (82,0) (82,120) (78,120) (74,104) (64,84) (52,70) (36,56) (18,42) (0,28). `onSeen:'RINT'`, `onHeard:'RINT'`.
- The SW bank has no zone, so pistol lures work there.
- **RINT** fires the siren and releases:
  - `barr_camp`: a 4-man squad. Exit (41.04,27.71) → (46,40) → (52,48) at 2.7 m/s, then p3's loop at 1.8 m/s.
  - `barr_out`: a 3-man squad. Exit (70.5,44) → (66,50), then the loop (58,54) (68,44) (78,52) (70,62).
  - p4's alarm route.

**Objectives and extraction.**
- `o1` "Destroy the fuel depot": `destroy` [`depot_a`, `depot_b`].
- `o2` "Escape in the truck through the south-east gate": `escape`. `extraction: {vehicleId:'truck', exit:{x:78, z:66, r:4}}`. The exit sits on the T4 road end inside the drivable area (the truck's nose stops ~3 m short of the E edge, so the old (81,68) r 3 was unreachable) and on the straight line from the truck's start through the gate, so solution step 6 is one double-click.
- **Edge case:** if the truck reaches the exit while o1 is still pending (a time bomb still ticking), show the (C)ONTINUE / (Q)UICK LOAD dialog (§8.1).

**Intended solution** (Prima):
1. Trap and footprint lures for e1 and e2. Knife or harpoon e3.
2. Snipe e4 at the rocks, then e5 on the walkway, from the E opening (about 33 m, outside e5's elliptical cone).
3. After the boat passes, the Marine ferries the team (two per trip) and packs the raft.
4. The GB climbs the SW wall, lowers the ladder, knifes e6 and e7, and raises the barrier. Standing on the walk he can be seen from inside the camp, so he crawls along it: lying flat, he is hidden from the camp below (§4.7 deck-edge rule). He climbs while e6 and e7 are looking away and the boat has gone downstream.
5. Everyone except the Sapper boards the truck. He plants one bomb at the depot and one at the E corner (which razes `barr_out`), then boards.
6. Double-click the exit and don't stop.

### 7.6 Mission 3: *Reverse Engineering* (buildable layout)

**Header.**

| Field | Value |
|---|---|
| id | `m03` |
| size | **[148, 133]** |
| theater | `snow`, green cones |
| lighting | sun 18° from the NW, 6000 K, overcast |
| water | velocity 1.0 m/s, angle 42° (SE), turbulence 0.6 (tailwater below the dam) |
| par | 720 s |
| cameraStart | {x 108, z 14, zoom 1} |
| Date / place | 4 Mar 1941 · Sysendam dam near the Sima hydro plant, Eidfjord |
| Spy | starts **without** the uniform |

**Briefing (ours).**
- *Historical:* "The Sysendam dam powers the valley's plant and carries its only crossing. Bring it down and the Germans lose both power and road for months."
- *Colonel:* "You'll come in from the plateau in the north-east. Our charges are already inside the power station south of the river, but the station fence is electrified. Find the switch before your Sapper touches the wire. There's a German camp on the east bank; with luck your Spy can borrow a uniform there. Destroy the bunker at the dam and then the dam itself. When it goes, a truck will come for you north of the dam. Mind your step, officer."
- *Notebook hints:*
  - The station fence is live; the switch is inside.
  - The explosives are in the station shed.
  - A uniform hangs outside the east camp, by the river.
  - Anything suspicious in the east camp or south of the river raises the alarm.
  - The bunker gunner turns towards any noise. Give him something to look at before you go behind him.
  - The truck will wait north of the dam.

**Terrain.**

| # | Terrain | Shape |
|---|---|---|
| T1 | `water` (reservoir, **raised**: `level` 5.8) | poly (0,0) (55,0) (56,10) (55,18), the dam's upstream arc (r 21.6) to (27.9,28.3), (25,27.4) (14,29) (0,30). Its own still water body 5.8 m up, held by the dam and two rock rims; nobody wades or swims in it; it drains to the river level when the dam falls |
| T2 | `water` (river) | path (41,23) (44,35) (52,46) (60,54) (84,74) (108,94) (132,114) (150,129), width 20: from the foot of the dam towards the camera, bending SE |
| T3 | `shallow` | auto rim 2 m, plus the dam-toe ledge along the foot of the face (arch radius 13.2–16.3, ±27°) |
| T4 | `ground` | station yard poly = the fence polygon below; camp interior poly = the palisade below |
| T5 | `road` | path (0,92) (4,92) (20,92) (26,88), width 5 (W gate). Dirt road (60,0) (60,12), width 4 (truck pickup) |

- **The dam faces the camera** (re-authored 2026-09-30, user request "show the dam from the front not behind"): rot 345° turns its downstream face to the default 15° camera yaw. The player sees the tall concrete face with the reservoir beyond it (top of the screen) and the river pouring towards the bottom of the screen.
- The crest is a curved `bridge` deck **raised 7 m** (grid `elev` 7; the visual stands 7 m up, so 7 m of face show above the river). It runs from the W end (29.2,29.3) to the E end (53,22.9), reached only by two concrete stairs (`ramps`): the W stair from (22.85,40.3) and the E stair from (59.35,33.9).
- Water runs down the face: spillway sheets from the two gate bays, trickles, frozen trickles and icicles, foam and spray at the foot, white water down the river, the sound of falling water (positional) — visual/audio only.
- E bank edge ≈ (51,22) (54,32) (60,40) (67,47) (84,60.5) (108,80.5) (132,100.5) (148,114).
- SW bank edge ≈ (31,26) (35,38) (44,52) (45,53.8) (60,67.5) (84,87.5) (108,107.5) (130,126).

**Structures.**

| id | type (variant) | x | z | rot | size | Notes |
|---|---|---|---|---|---|---|
| `dam` | dam (concrete arch) | 40 | 22 | 345 | 27 long × 3 crest × 14 high, `elev` 7 | **Objective.** `bombOnly`; demolition marker `dam_charge` at (35.82,29.59) on the toe ledge at the foot of the face, W of the spillway (beside a frozen trickle, out of the churning water) (the bomb must be within 3 m). Crest = curved `bridge` cells at elev 7 (walking surface 7.28 on top of its snowy deck), two stairs (`ramps`, cells at the tread heights). `waterFx` (water down the face, white water streaming away downstream, spray mist at the foot). On destruction: collapse FX, flood surge over the whole foot of the face, crest removed, the falling water stops and the reservoir bursts through the breach: a torrent into the pool and a surge of white water down the river while it drains (40 s) |
| `rim_s`, `rim_e` | cliff | S shore (−1,29.5)…(27.2,27.4)…(−1,35); E shore (55,−1)…(56.6,20.2)…(55,12) | | | h 7.6 | Rock rims holding the raised reservoir; `B.HIGH` |
| `dam_crag` | cliff | poly (57,23.2) (61.4,22.8) (62,27.4) (57.4,27.8) | | | h 6.6 | Under the dam's gate-keeper hut (E end) |
| `dam_bunker` | bunker (surveillance) | 19 | 46 | 315 | 5 × 4 × 2.4 | **Objective.** `bombOnly`. Crew `e34`: vision `bunker` (near 18, far 36, 40°, sweep 50) facing NE over the dam |
| `st_fence` | fence (`electric`, chain-link) | closed poly (4,58) (34,58) (70,90) (70,126) (4,126) | | | h 2.5 | `B.FENCE` (see-through). **Powered** until `fence_switch` is used. **Gates:** N gap x 24–28 at z 58 (dam path); W gate (below) |
| `gate_w` | gate (`chainlink`) | 4 | 92 | 270 | opening 4 m | Open; road enters here |
| `st_admin` | house (`admin_brick`) | 14 | 68 | 0 | 10 × 7 × 6 | Carries `fence_switch` on its E wall at (19.5,68): activation 1.0 s, any commando |
| `st_barr1` | barracks + flag | 16 | 82 | 0 | 12 × 6 × 4.5 | **Garrison**, pool 10; **jail** for p5 |
| `st_shed` | hangar (`shed`) | 40 | 80 | 0 | 12 × 8 × 6 | Door S; 2 time bombs at (40,85) |
| `st_barr2` | barracks + flag | 64 | 108 | 90 | 12 × 7 × 4.5 | **Garrison**, pool 10 |
| cages | fence (`square`, 5×5) + generator (`transformer`) | grid x ∈ {20, 32, 44, 56} × z ∈ {100, 110, 120} (12 cages) | | | h 2.2 / 2.0 | Sparking FX, hum SFX |
| `mg_gate` | sandbags (`mg_ring`) | 10 | 99 | 180 | r 1.8 | e28 |
| drums | crates (`cable_drum`) | (30,72) (31.5,73.5) (56,94) | | | Ø 1.5 | `B.LOW` |
| `sign_w` | sign | 2 | 88 | 0 | | "SIMA KRAFTVERK" |
| pylons | telegraph_pole (`lattice_pylon`) | (60,122) (80,100) (96,62) | | | h 18 | Wires cross the river toward the NE |
| `cliff_e` | cliff | poly (84,20) (148,20) (148,34) (124,38) (84,42) | | | h 12 | `B.HIGH`; not climbable |
| `cliff_w` | cliff | poly (63,17) (74,17) (74,34) (65,31) | | | h 10 | The **gully** (x 74–84) between the two cliffs leads from the plateau down to the river; its W end leaves the E bank path to the E stair open |
| `start_wall` | ruins (`wall_ruin`) | 108 | 8 | 0 | 16 × 1.5 × 1.6 | `B.HIGH`; the team hides north of it |
| `camp_wall` | wall (`palisade`) | closed poly (98,48) (142,48) (142,96) (126,90) (98,66) | | | h 2.4 | **Gates:** N at x 116–120 (z 48); W at z 55–59 (x 98) |
| `camp_barr` | hut (`log_cabin`) + flag | 122 | 58 | 0 | 7 × 5 × 3.5 | **Garrison**, pool 10; **jail** for p1 |
| cabins | hut (`log_cabin`) | (108,54) (116,68) (133,63) (132,82) | | 0 | 6 × 5 × 3.5 | |
| `well` | well | 124 | 72 | 0 | Ø 1.6 | |
| `spools` | crates (`cable_drum`) | 114 | 61 | 0 | Ø 1.5 | |
| `camp_tent` | tent + flag | 132 | 43 | 0 | 4 × 4 | **Garrison**, pool 5 |
| `tent2` | tent | 141 | 42 | 0 | 4 × 4 | |
| trees | pine | (66,5) (70.5,9) (90,6) (130,6) (140,10) (6,50) (2,70) (90,48) (146,60) | | | h 9–14 | |

**Items.**
- `timeBomb` ×2 at (40,85). The Sapper picks them up.
- `uniform` (clothesline) at **(114,82.5)**, on the strip between the camp palisade and the river.

**Vehicles.**

| id | Type | Position | Notes |
|---|---|---|---|
| `raft` | raft | (64,45), shallow, heading 90 | On site; unused, not suspicious |
| `evac_truck` | truck, friendly | Spawns at (60,−6) when **o1 and o2** are done; drives to (60,10) at 6 m/s and waits | 6 seats. Once everyone is aboard it drives off north (ESC skips) |

**Commandos** (behind `start_wall`, heading 90).

| Role | Position | Inventory |
|---|---|---|
| greenberet | (103, 3.5) | knife, pistol, decoy, shovel |
| diver | (106, 3.5) | knife, pistol, harpoon, divingGear |
| sapper | (110, 3.5) | pistol, trap, cutters |
| spy | (113, 3.5) | pistol, syringe, firstAid 6 |

**Enemies** (Kildread: 7 walkers, 17 sentries, patrols of 5 and 3, 1 MG, 1 surveillance bunker, 4 garrisons).

| id | # | soldierType, flags | Position | Behaviour |
|---|---|---|---|---|
| e1–e3 | [1–3] | sergeant + 2 troopers, squad `p1`, jail `camp_barr` | (62,13) | PINGPONG along the plateau: (62,13) wait 6 look 180 ↔ (146,13) wait 6 look 0. Passes 4 m in front of the start wall |
| e4 | [4] | sentry, holdsPost | (79,22) | Post 200, sweep 35. Top of the gully, facing downhill |
| e5 | [5] | sentry, investigates | (77,36) | Post 210, sweep 40. Mid-gully |
| e6 | [6] | sentry, holdsPost | (80,56) | Post 150, **sweep 25**. Gully mouth, watching the water |
| e7 | [7] | soldier, investigates, followsTracks | (104,50) | LOOP: (104,50) → (138,50) wait 3 look 90 → (138,89) → (116,78) → (104,64) wait 3 look 180 |
| e8 | [8] | soldier, investigates | (126,46.5) | PINGPONG among the tents: (126,46.5) wait 4 look 270 ↔ (147,46.5) wait 4 look 270 |
| e9 | [9] | sentry, holdsPost | (118,46) | Post 270, sweep 45. N gate |
| e10 | [10] | soldier, investigates | (104,60) | PINGPONG: (104,60) wait 3 look 180 ↔ (126,64) wait 3 look 0 |
| e11 | [11] | sentry, investigates | (130,70) | Post 180, sweep 50 |
| e12 | [12] | sentry, holdsPost | (101,57) | Post 180, sweep 35. W gate, inside |
| e13 | [13] | sentry, investigates | (138,92) | Post 135, sweep 40 |
| e14 | [14] | sentry, holdsPost | (103,72) | Post 225, sweep 40. Outside the palisade, **watches the river** |
| e15 | [15] | soldier, investigates | (1.5,62) | PINGPONG outside the W fence: (1.5,62) wait 4 look 90 ↔ (1.5,124) wait 4 look 270 |
| e16 | [16] | soldier, investigates | (8,129.5) | PINGPONG outside the S fence: (8,129.5) wait 4 look 0 ↔ (68,129.5) wait 4 look 180 |
| e17 | [17] | sentry, holdsPost | (50,74) | Post 315, sweep 45. Inside the fence, **overlooking the river** (the Spy distracts him) |
| e18 | [18] | sentry, investigates | (26,61) | Post 270, sweep 35. N gate, inside, facing the dam path |
| e19 | [19] | soldier, investigates | (24,64) | PINGPONG: (24,64) wait 3 look 0 ↔ (30,92) wait 3 look 90 |
| e20 | [20] | sentry, investigates | (28,80) | Post 45, sweep 50 |
| e21 | [21] | sentry, holdsPost | (64,96) | Post 180, sweep 40 |
| e22 | [22] | sentry, holdsPost | (7,90) | Post 180, sweep 35. Main gate |
| e23 | [23] | soldier, holdsPost | (8,95.5) | PINGPONG (8,95.5) ↔ (15,95.5), waits 3 |
| e24–e27 | [24–27] | sentry (e24, e26 investigate) | (14,87) · (6,104) · (12,108) · (8,116) | Posts 200 · 180 · 180 · 135; sweeps 40 |
| e28 | – | mg (`mg_gate`) | (10,99) | Post 180, sweep 50, giro 180 |
| e29–e33 | – | sergeant + 4 troopers, squad `p5` (columns 2), jail `st_barr1`, reactEvents [RINT] | (2,49) | LOOP: (2,49) → (14,52) → (30,54) wait 4 look 270 → (10,55) → (2,49). Circles the NW by the N gate and sees the gate area. **Alarm:** run to (26,56), then resume |
| e34 | – | mg crew of `dam_bunker` | (19,46) | See Structures |

**Zones and alarm.**

| Zone | Poly | Event | Releases |
|---|---|---|---|
| `z_camp` (E camp outskirts) | (86,40) (148,36) (148,110) (128,102) (90,76) | onSeen and onHeard `RCAMP` (no siren) | `camp_barr`: 3-man squad, exit (122,61), then e7's loop. `camp_tent`: 2-man squad, loop (124,46.5) (147,46.5) (147,70) (144,70) |
| `z_south` (the whole S bank, including the dam-bunker area) | (0,44) (24,42) (30,50) (45,53.8) (60,67.5) (84,87.5) (108,107.5) (120,117.5) (136,133) (0,133) | onSeen and onHeard `RINT` (siren) | `st_barr1`: 3-man squad, loop (24,61) (6,61) (6,76) (28,76). `st_barr2`: 3-man squad, loop (69,96) (69,124.5) (16,124.5) (16,96). Plus p5's alarm route |

- The plateau, the gully and the NE bank west of the camp have **no zone**.

**Objectives.**
- `o1` "Destroy the dam bunker": `destroy` [`dam_bunker`].
- `o2` "Demolish the dam": `destroy` [`dam`], marker `dam_charge`.
- `o3` "Escape in the truck north of the dam": `escape`. `extraction: {vehicleId:'evac_truck', spawnWhen:['o1','o2']}`.

**Intended solution** (Prima):
1. Trap one of p1; freeze the other two with the decoy for the Marine's harpoon.
2. Lure e4 and e5 into the gully with the decoy and kill them; knife e6.
3. The Marine clears the camp's river side and rows the Spy to the clothesline.
4. The disguised Spy **walks across the dam crest** (up the E stair, along the crest 7 m above the river, down the W stair) and past e18 into the station, flips `fence_switch`, and Distracts e17.
5. The Sapper cuts the fence. The GB knifes while the Spy distracts. The Sapper collects both bombs.
6. Row to the bunker. Charge one goes behind it (o1). The alarm sounds; hide the raft and wait out the siren (25 s) and the searches.
   - The crew's `sweep 50` is the §4.2 amplitude A (±50° about heading 315, plus the 40° aperture: about −115° to +25°), like every other profile. It covers the NE side, the crest and the shore, so the gunner must be turned first: he faces any noise (the GB's decoy dug in near the bunker, or a thrown stone), which leaves the rear unwatched for the plant. The notebook hints at this (replay round 2).
7. Row to the dam toe (the foot of the face, under the spillway) and plant charge two (o2).
8. The truck arrives; everyone boards (the Spy crosses by raft or before the blast).

### 7.7 Prop, interactable and vehicle types needed later (not in the ARCHITECTURE catalogue yet)

M1–M3 use only catalogue types, plus `raft`, `truck`, `patrolboat`, `kubelwagen` vehicles and clotheslines rendered by the `uniform` pickup. Missions 4–20 need the following, to be added by ART and VEHICLES as *backwards-compatible* catalogue entries:

| Category | Types | Missions |
|---|---|---|
| Structures | `villa`, `rail_bridge` (trestle), `cable_car` (+ stations), `telephone`, `mine` (hidden), `railway_gun`, `uboat_pen`, `lighthouse`, `drilling_rig`, `mosque`/`minaret`, `flat_roof_house` (roof walkable, ladders), `battleship`, `lock_gate` + `control_shack`, `casemate_gun`, `tram` + `tram_track`, `cemetery`, `truss_bridge` + `detonator`, `mobile_bridge` + `lever`, `fuel_valve` (oil spill/fire), `watermill`, `v2_rocket` + `launch_pad`, `conveyor` + `mine_cart`, `castle_wall`/`castle_gate` + `moat`, `firing_range`, `water_gate` + `lever`, `flak` | M4–M20 |
| Vehicles | `motorcycle` (sidecar), `panzer2`, `panzer3`, `panzer4`, `sdkfz` (half-track / armoured car), `opel_blitz_tanker`, `citroen15`, `horch`, `willys`, `autogyro`, `ju52`, `ju87`, `minisub`, `rowboat`, `train` (locomotive + cars) | M4–M20 |
| Units | `dog`, `courier`, `engineer`, `general`, guest prisoners | M4, M13, M15–M17, M19 |

- **`drilling_rig` (M11).** Oil derrick on a drill-floor skid. The skid is the footprint (`w × d`, B.HIGH), and the bomb goes within 3 m of it. Above the skid stands an open, tapered steel lattice tower (`h` about 22 m): four legs, girts and X-bracing on every face, a monkey board at about 60 % height, and a crown block with a sheave. The travelling block hangs on the drill line, and a doghouse sits on the skid. Never a solid column.

---

## 8. Win, lose, scoring

### 8.1 End conditions [EXE end-state codes, manual, guide]

- **Grace countdown.** End states 4–7 below are re-checked after a **5.0 s** countdown (100 ticks) and fire only if the condition still holds.
- **Win.** Every `required` objective is done **and** every living commando **and** guest has left by the extraction:
  - either aboard the escape vehicle when it passes `exit` or drives off;
  - or inside the exit zone.

  The screen then shows "MISSION COMPLETED". M1 ends on its objective alone (`extraction:null`).
- **Messages and failures:**

| Situation | Result / message |
|---|---|
| Any commando or guest **dies** | **Loss** after 5 s: "ONE OR MORE OF YOUR MEN DIED…". BEL does not let you continue a mission with a dead man [manual]; we end it after the countdown rather than letting play go on |
| All men dead or captured | Loss: "ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED." |
| Extraction attempted while someone is jailed, or not aboard | Refused, with the message "ALL YOUR MEN MUST ESCAPE." (shown once; play continues) |
| Escaped with the objectives not done | Dialog "YOU MANAGED TO ESCAPE, BUT YOU DIDN'T DESTROY THE TARGETS…" with **(C)ONTINUE** / **(Q)UICK LOAD**. Continue lets pending timers resolve (the M2 truck leaving before the bomb): if the objectives then complete within 15 s, it is a win; otherwise a loss |
| Escape vehicle destroyed while still needed | Loss after 5 s: "YOU DESTROYED THE <TRUCK/BOAT/JU-52>, BUT YOU NEEDED IT TO ESCAPE." |
| Alarm-fail script completes (M13 sub shelled, M15 general reaches a car, M16 bridge blown) | Loss: a mission-specific message |
| Main objective made impossible (target escaped or destroyed wrongly) | Loss |
| Escortee dies | Loss (as for a commando) [inf] |

- **Failure screen:** reason text, **Restart Mission**, **Quick Load**, and the failure stinger.

### 8.2 Scoring [manual, guide, data]

- **Kills are irrelevant to the score.** They are shown only as enemy losses.
- **Mission time.**
  - The mission clock counts sim time in `playing` state; it is paused while paused and **saved with the game**.
  - `P` = the mission's `par.time`.

    | Time | Silver stars |
    |---|---|
    | ≤ P | 3 |
    | ≤ 1.5 P | 2 |
    | ≤ 2.5 P | 1 |
    | otherwise | 0 |

    [rec; the original mapping lives in the EXE and is unpublished.]
- **Sustained damage.**
  - `loss = Σ(maxHP − HP at the end) / Σ maxHP` over every commando in the mission, guests excluded.
  - Healing before the end counts; that is Prima's advice.

    | loss | Silver stars |
    |---|---|
    | ≤ 10% | 3 |
    | ≤ 30% | 2 |
    | ≤ 60% | 1 |
    | otherwise | 0 |

    [rec]
- **Mission merit (gold)** = floor((time stars + damage stars) / 2): 6 silver → 3, 4–5 → 2, 2–3 → 1, 0–1 → 0.
- **Replaying.** A replayed mission **re-credits** its gold stars. This is BEL's "Play Again" farming, kept faithful and shown with a note.
- **Ranks.** One rank per 6 gold stars; maximum 60 (BEL).

| Gold stars | Rank |
|---|---|
| 0 | Lance-Corporal |
| 6 | Corporal |
| 12 | Sergeant |
| 18 | Quartermaster |
| 24 | Lieutenant |
| 30 | **Captain** |
| 36 | Major |
| 42 | Colonel |
| 48 | Brigadier |
| 54 | General |
| 60 | Field-Marshal |

- **M20 gate.** Operation Valhalla unlocks only if the rank is **Captain or higher** after M19. Otherwise the campaign ends with an epilogue card after M19. Its password always opens it.
- **BCD** (later): start as Major, Field-Marshal at 24; passwords replay single missions.

### 8.3 Passwords [EXE codec, gap-7]

The scheme copies the demo's structure with our own keys:
- **Bit layout (19 bits):** `v = seq(6) | stars(5) | rank(4) | chk(4)`.
  - `seq = 20·campaign + mission − 1`.
  - `stars` = the gold stars toward the next rank (0–31), and `rank` = 0–10.
  - `chk = ((v>>10) + (v>>15) + (v>>5)) & 15`.
- **Whitening:**
  - `p = parity(v)`;
  - `e = (K1 ^ v) & 0xFFFFF`, inverted when p = 1;
  - `w = (K2 ^ (e<<1 | p)) & 0xFFFFF`;
  - with **our own** `K1` and `K2` constants in `CONFIG.passwords`.
- **Text:**
  - characters 1–4 are w in base 36, least-significant digit first;
  - character 5 = `ALPHABET[((w>>10) + (w>>15) + (w>>5)) & 31]`.
  - Our alphabet is a 36-symbol permutation without `0`/`O`/`1`/`I`, padded with `-`, `+` and so on.
  - Input is case-insensitive and treats O as 0 and I as 1.
- **Behaviour:** a password restores the mission and the career (rank plus partial stars). None is issued for M1. Many codes are valid per mission.
- **Unit test:** encode → decode round-trip for every mission, rank and star value.

### 8.4 Saving
- **Quicksave** (Ctrl+S / F8) writes a single slot; **quickload** (Ctrl+L / F9) reads it.
- **10 named slots** per profile, in the Esc menu.
- A save serialises all world state, including:
  - N values, timers and brain states;
  - footprints, bodies, alarm and zone state, barracks pools, tainted flags;
  - the mission clock, the RNG state and the camera views.
- Stored in `localStorage` inside try/catch, with an export/import JSON fallback.
- Saving is free: it does not affect the score.
- **Save reminder** (option, off by default): a small "last save" timer turning yellow at 2 min and red at 3 min (a Shadow Tactics convention).

---

## 9. Audio

**Engine.**
- Web Audio with channels **master / sfx / voice / music / ui**.
- Positional sounds use a `PannerNode` (inverse-distance rolloff) with the listener over the active view's centre.
- `refDistance` is 8 m and `maxDistance` about 1.2 × the view width. Sounds beyond it play at 0.05 gain, or cull.
  **Superseded** by realism-pipeline v2 §1.5.0: per-category reference/max distances (footsteps 30 m, voices 60 m, small arms
  400 m, MG/explosions 1.5 km) plus air absorption; see `src/audio/manifest.js` `DISTANCE`.
- Assets are recorded CC0 or self-made, plus **Piper/neural TTS** voices; see `realism-pipeline.md`. The ARCHITECTURE line "all sounds synthesized" is superseded (§10.4).

### 9.1 Music [data, guide]
**Cues.** Original orchestral war-film cues (snare-driven march, brass calls, sombre strings), composed for this
project (route A: symbolic scores + VSCO 2 CE CC0 samples; style brief and originality rule in the music STYLE
notes). Never the 1998 recordings, never a quote or paraphrase of the Commandos or film scores. Files:
`assets/audio/music/<cue>.ogg` (Vorbis q5) + `.mp3` (128 kb/s, Safari), listed with loop points, category and gain in
`assets/audio/music/manifest.json`; credits in `assets/audio/music/CREDITS.md`.

| Cue | Length | Where it plays | Mood / key |
|---|---|---|---|
| `menu` | 2:44, intro + loop 10–160 s | title, main menu, options, load/save, help | Heroic, restrained march; D minor → F |
| `campaign_norway` | 2:17, loop | campaign map, focused mission M1–M7 | Cold, lonely; D Dorian |
| `campaign_africa` | 1:18, loop | campaign map, M8–M12 | Restless, dry; E Phrygian |
| `campaign_normandy` | 1:51, loop | campaign map, M13–M15 | Hope with a cost (march); B♭ ↔ G minor |
| `campaign_rhine` | 1:13, loop | campaign map, M16–M18 | Heavy, grinding; C minor |
| `campaign_reich` | 1:35, loop | campaign map, M19–M20 (Final Assault) | Grim grandeur; F minor ♭II |
| `campaign_end` | 1:25, once → `menu` | epilogue (End of WWII) | Elegy; D major |
| `briefing_1`–`briefing_3` | 1:28–1:54, loop | briefing (mission n → `briefing_(1 + n mod 3)`), ducked −8 dB under the Colonel | Tense ostinato; D / A / G minor |
| `tutorial` | 3:35, loop | tutorials screen | Brisk training camp; F major / D minor |
| `start_1`–`start_6` | 14–24 s | mission start, by theater: Norway, Africa, Normandy, Rhine, Final Assault; `start_6` covert (sandbox, unknown maps) | per theater |
| `success_1`–`success_3` | 11–14 s | mission won (random) | D / B♭ / F major |
| `fail_1`–`fail_3` | 16–22 s | mission lost (random) | D / G / D minor |
| `debrief_promotion` | 17 s | debrief after a rank promotion | B♭ fanfare |
| `credits` | 1:14, once → `menu` | credits roll | D minor → D major |
| `exit` | 8 s | QUIT GAME (the menu bed fades under it) | D minor → D |
| `mission_tension_a/b/c`, `mission_bridge_1–3`, `mission_alert` | 2–2.5 min segments, 8-bar bridges, alert loop | in missions, option **Mission music: Suspense** (default) | 84 BPM D-minor grid |

- **In missions.** BEL has no music during missions (only the start/end stingers). The option **Mission music** keeps
  that as **CLASSIC 1998** (start stinger → silence + ambience → end stinger); the default **SUSPENSE** chains the
  quiet tension segments after the start stinger and crossfades the alert layer in on a bar line when the alarm sounds
  or enemies fight/search (calm hold 8 s). The siren and the SFX still carry the tension; the score never masks them.
- **Mixing.** Beds crossfade 2 s out / 1.5 s in; loops use the manifest loop points (intro once, body looped,
  `AudioBufferSourceNode.loopStart/loopEnd`). Voices duck the briefing −8 dB and the mission score −5 dB; pause keeps
  the score at −9 dB. Loudness: front end −18 LUFS, briefings −20, stingers −16, mission score −22; true peak ≤ −1 dBTP.
- **Loading.** Lazy: the manifest loads with the audio manifests, each cue is fetched + decoded on first request (beds at
  32 kHz, mission segments at 24 kHz, to bound decoded PCM); the first menu frame never waits for music. Only the
  current bed and the mission's next segments stay decoded. Safari gets the MP3 (loop points shifted when its decoder
  ignores the LAME gapless header).
- **Option "cinematic ambience"** (off by default; Classic only) adds a low drone bed during missions.

### 9.2 Ambience (SHOULD; toggle "Nature sounds", default ON)
Positional loops, sparse, gain 0.1–0.2 [the demo's "noisy mother nature"]:
- wind (all);
- surf (coast, fjord);
- river rush (M2, M3, M19; louder below the dam);
- birds (daylight, not in desert noon);
- crickets (desert and summer);
- dog barks (M19);
- electric hum near live fences and transformers;
- distant engines, trains and ship horns where present.

### 9.3 SFX list (id → trigger; original sound IDs in brackets)

| Group | SFX |
|---|---|
| Movement | `step_snow`, `step_sand`, `step_grass`, `step_road`, `step_wood`, `step_water` (PASOS, PASOSAGU); `crawl_rustle`; `climb_scrape`; `ladder`; `dig_snow`, `dig_sand`; `body_drag`, `body_drop`; `barrel_lift`, `barrel_set` (ESFUERZO grunt) |
| Water | `splash_in`, `splash_out` (SPLASH); `dive_bubbles`, `underwater_loop` (BUZO); `row_stroke` (REMADA); `raft_inflate`, `raft_deflate`; `raft_hit_hiss` |
| Weapons | `knife_stab` (CUCHI); `pistol_shot`, `pistol_draw`, `pistol_holster` (PISTOLA); `sniper_shot`, `sniper_bolt` (FRANCO, CARGAFUSI); `smg_burst` (METRALL0); `harpoon_fire`, `harpoon_hit`; `syringe`; `trap_set`, `trap_snap` (CEPO); `grenade_pin`, `grenade_throw`, `grenade_bounce`; `cutters_snip`; `rifle_shot` (FUSIL); `mp40_burst`; `mg_burst` (AMETRALL); `tank_mg` (TANQMETR); `boat_mg` (METRLANC); `tank_cannon`; `torpedo_launch`, `torpedo_run` (SUBMISIL); `bullet_impact_{dirt,wood,metal,water,flesh}` |
| Explosives | `bomb_plant`; `bomb_tick` loop, 2 Hz speeding to 4 Hz (TICTAC); `detonator_click`; `explosion_small` (EXPLOSI); `explosion_big` (MEGAEXPL); `barrel_explode` (BARRIL); `collapse` (DERRUMBE); `fire_loop` (LLAMAS); `debris_rain`; `dam_burst` + `flood_rush` |
| Devices | `decoy_beep` (SEGNUELO); `switch_throw` (SWITCH); `electric_hum` (ELECTRO); `electric_zap` (ELECSHOK); `power_down` (APAGELEC); `telephone_ring` (TELEFONO); `gate_creak`, `barrier_lift`; `lock_gate` (ESCLUSA); `water_pressure` (AGUAPRES), `water_jet` (CHORRO); `valve_turn`; `cable_car_motor` |
| Vehicles | `truck_start`, `truck_idle`, `truck_drive` (CAMION); `brakes` (FRENADA); `horn_car`, `horn_train`, `horn_ship` (BOCINA, BOCITREN, BOCIBARC); `train_pass` (TREN); `tank_engine`, `tank_tracks`, `turret_whir`; `motorbike`; `boat_engine`; `plane_engine` (AVION); `autogyro` (AUTOGIRO); `hangar_door` (HANGAR); `runover_thud` |
| Alarm | `siren` (SIRENA01): a hand-cranked air-raid wail rising over about 3 s, looping; gain envelope 0.75 → 0 over 25 s (§4.9); positional at each garrison in the event, plus a non-positional 30% bed |
| Nature | `wind`, `surf` (OLEAJE), `river`, `birds` (PAJARO0/1), `crickets` (GRILLOS), `dog_bark`, `dog_growl` (LADRIDO) |
| UI | `ui_click`, `ui_hover`, `knapsack_open`, `notebook_flip`, `pencil_scratch`, `stamp` (debrief stars), `promotion` fanfare stinger, `pause_on`, `pause_off`, `cursor_forbidden` tick |

### 9.4 Voice lines

**Rules.**
- Each commando has 12–20 lines, **written new for SHADOW SIX**. They follow the original's tone, but no original line is copied.
- Accents are applied consistently: see §3.0.
- **Bark keys and how often they fire:**

  | Key | When |
  |---|---|
  | `select` | On selection, always ("Yes, sir!" first, then rotating); re-selecting the man who answered last stays quiet for 3 s, a different man always answers (the leader only for a group) |
  | `ack_move` | Move order |
  | `ack_act` | Ability order |
  | `act_kill` | 30% after a silent kill |
  | `cant` | Invalid order |
  | `cant_noammo` | Out of ammo |
  | `hurt` | On damage |
  | `death` | On death |
  | `spotted` | When held or challenged |
  | `alarm` | Hearing the siren (one man says it) |
  | `special_*` | Role-specific |

- Verbose/Laconic: **Laconic mutes `select`, `ack_move` and `ack_act`**.
- Only one commando voice plays at a time; newer lines replace older ones if the old line has been playing for more than 0.4 s.

| Commando | Lines |
|---|---|
| **Tiny** (Irish, gruff) | select: "Aye?" · "McHale." · "What'll it be?" — ack_move: "On me way." · "Right so." · "Movin'." · "Grand." — ack_act: "Leave him to me." · "Quiet as a church mouse." — act_kill: "Sleep tight." — special_decoy: "That'll turn a few heads." · special_dig: "Snug as a bug." · special_barrel: "Heavy wee thing." — cant: "Can't do that one, sir." · "Not with these hands." — hurt: "Argh! I'm grand, I'm grand!" · "They've nicked me!" — spotted: "Ah, feck." — death: "Tell me mam…" |
| **Duke** (upper-class RP) | select: "Woolridge." · "At your disposal." · "Yes?" — ack_move: "Very well." · "If I must." · "Quite." — ack_act: "One shot will suffice." · "Hold still, there's a good fellow." — act_kill: "Clean." — cant: "Hardly my department, old boy." — cant_noammo: "I'm afraid I'm out of rounds." — hurt: "Blast. I'm hit." · "Rather inconvenient." — spotted: "Ah. We've been noticed." — death: "Most… unsporting." |
| **Fins** (sarcastic Australian) | select: "Blackwood." · "Yeah, what now?" · "Mm?" — ack_move: "Righto… sir." · "Off I go, then." · "No worries." — ack_act: "Into the drink." · "Nice and quiet." — special_raft: "Hop in, mind the paint." · special_dive: "See you on the other side." — cant: "Not without a boat, mate." · "In this? You're joking." — hurt: "Strewth! That stings!" — spotted: "Oh, bloody marvellous." — death: "Should've… stayed in the water." |
| **Inferno** (dry northern English) | select: "Hancock." · "Sapper here." — ack_move: "On it." · "Right you are." · "Moving." — ack_act: "Charge set — ten seconds, run!" · "This'll make a lovely bang." · "Wire's no bother." — special_detonate: "Fire in the hole." — cant: "Wrong tool for that." · "Wire's live — not touching it." — hurt: "Ahh! I'm hit!" — spotted: "They've clocked me!" — death: "Should've… cut the other one." |
| **Tread** (Brooklyn) | select: "Yeah, boss?" · "Tread here." · "Whaddaya need?" — ack_move: "You got it." · "On my way, boss." · "Easy money." — ack_act: "Time to make some noise." — special_drive: "Hop in, fellas." · "Hold onto your helmets." · special_heal: "Hold still, this'll pinch." — cant: "Not my line of work, boss." — hurt: "Ow! They winged me!" — spotted: "Uh-oh." — death: "Aw, this ain't good…" |
| **Spooky** (French) | select: "Oui?" · "Duchamp." · "Mon capitaine?" — ack_move: "D'accord." · "Bien sûr." · "I go." — ack_act: "A small prick… et voilà." · "Nobody will notice." — special_uniform: "Now I am one of them." — special_distract *(German, to the guard)*: "Guten Tag, Soldat. Alles ruhig?" · "Na, Kamerad — wie läuft der Dienst?" · "Stehen Sie bequem." — cant: "Non. That, I cannot do." — hurt: "Aïe! Merde…" — spotted: "Zut, they know me." — death: "Pour… la France…" |
| **Guests** | McRae (RAF, Scottish): "Get me to that kite and I'll fly her home." · "About time, lads." — Informer: "Thank God you came." — Gilbert (French): "Mes hommes vous suivront." · "Allez, vite!" |
| **The Colonel** (briefings, British) | The Part-2 tactical advice per mission (our text, §7.4–7.6). He calls the player "officer" and, in M20 only, "son" |

**Enemy barks (German, native speakers or German TTS; the English gloss is for subtitles only).**

| Key | Lines |
|---|---|
| `ger_halt` | "Halt!" (Stop!) · "Stehen bleiben!" (Stand still!) · "Wer da?" (Who's there?) · "Hände hoch!" (Hands up!) · "Keine Bewegung!" (Don't move!) |
| `ger_suspicious` | "Was war das?" (What was that?) · "Da war doch was…" (There was something…) · "Hallo? Ist da jemand?" (Hello? Anyone there?) · "Spuren… frische Spuren." (Tracks… fresh tracks.) · "Was piept da?" (What's beeping?) |
| `ger_giveup` | "Nichts. Nur der Wind." (Nothing. Just the wind.) · "Ich seh' schon Gespenster." (I'm seeing ghosts.) · "Zurück auf Posten." (Back to post.) |
| `ger_mandown` | "Mann am Boden!" (Man down!) · "Hier liegt einer!" (Someone's lying here!) · "Sanitäter!" (Medic!) |
| `ger_alarm` | "Alarm! Alarm!" · "Eindringlinge!" (Intruders!) · "Sie sind hier!" (They're here!) |
| `ger_combat` | "Feuer!" (Fire!) · "Da drüben!" (Over there!) · "Schießt doch!" (Shoot!) |
| `ger_arrest` | "Mitkommen!" (Come with us!) · "Abführen!" (Take him away!) |
| `ger_distracted` (to the Spy) | "Jawohl, Herr Offizier!" (Yes, sir!) · "Zu Befehl!" (At your command!) · "Alles ruhig, Herr Hauptmann." (All quiet, Captain.) |
| `spy_unmask` | "Das ist kein Offizier — ein Spion!" (That's no officer — a spy!) |
| `ger_hurt` | "Ich bin getroffen!" (I'm hit!) plus non-verbal cries |
| `ger_death` | Non-verbal death cries (MUERTE), 6 variants |
| `courier` | "Ich hole Verstärkung!" (I'll get reinforcements!) |
| `sergeant_order` | "Ausschwärmen!" (Spread out!) · "Weitergehen!" (Move on!) |
| `dog` | Bark, growl, whimper |

---

## 10. Technical notes

### 10.1 Time base
- The sim steps at `CONFIG.sim.dt = 1/60` (ARCHITECTURE). BEL's logic ran at a nominal **20 ticks/s**, so every original tick value is converted with `BEL_TICK = 0.05 s`.
- **Tick-integer rules** run on every **3rd** step with `dt20 = 0.05`, so the original arithmetic is reproduced exactly. These are the nervousness update (§4.5), the N decay and the decoy pulse cadence.
- **Movement, animation, sweep angle θ(t) and the cone-membership test** run every step (60 Hz). The displayed cone and the detection test therefore always use the same θ (§10.2).
- `CONFIG.sim.belTickHz` (default 20; range 16–25 as a COULD option) scales only the tick-integer rules.
- **All durations in this spec are in seconds.** `CONFIG` stores seconds, and the comments cite the original tick values.

### 10.2 Vision implementation (the drawn cone **is** the detection geometry)
- **Per enemy, per step:**
  - `θ = sweep(t)`; `far = ellipse(θ)`; `near = far/2`.
  - For each candidate commando within `far + 1 m` (spatial hash): an angle test against the aperture, then the band rule, then `grid.lineOfSight(eye → target, {viewerElevated, targetLow})`, then the dynamic-occluder check and the roof-level rule.
- **`VisionCone` mesh** (only for the displayed cone): about 96 rays across the aperture plus 2 per occluder corner (angle ± ε) with `grid.castRay`, including the dynamic occluder layer. The near and far polygons are clipped at near(θ) and far(θ).
- **Acceptance test:** sample 2,000 random points around a guard. A standing dummy at any point strictly outside the drawn far polygon (by more than 0.25 m) is never detected, and one strictly inside (by more than 0.25 m) always is. Repeat with a crawling dummy against the near polygon. This is the Commandos: Origins lesson, made into a test.
- **Grid extensions** (small, backwards-compatible):
  - a `dynamicBlock` layer (Uint8, rewritten each step for vehicles and trains);
  - an `elev` height layer (Float32, metres) for roofs, walls and towers, used by the roof-level rule;
  - `climb` links and `ladder` links fed to the pathfinder as off-grid edges (GB-only or everyone).

### 10.3 `CONFIG` mapping (new keys, grouped per ARCHITECTURE)

```js
CONFIG.sim      = { dt: 1/60, belTick: 0.05, belUnit: 0.045, belTickHz: 20 }
CONFIG.camera   = { pitchDeg: 40, yawDeg: 15, zoomLevels: [0.5, 1, 2], pxPerMeterAt1x: 40, edgePx: 8,
                    scrollSpeed: 30, zoomTween: 0.25, recenterTween: 0.35, boundsMargin: 4 }
CONFIG.units    = { walk: 2.25, run: {greenberet: 5.4, driver: 5.4, default: 4.5}, crawl: 0.9, carry: 1.6,
                    raftCarryPenalty: 0.9, swim: 1.8, row: 2.5,
                    hp: {greenberet: 200, sniper: 100, diver: 160, sapper: 130, driver: 130, spy: 160, guest: 100},
                    stanceDown: 0.5, stanceUp: 0.6, dblClickMs: 350 }
CONFIG.stealth  = { vision: {soldier: {fov: 70, near: 18, far: 36, sweep: 50, period: 5.0, elliptical: true},
                             patrolWatch: {sweep: 50, period: 2.5}, dog: {...}, mg: {...}, bunker: {...},
                             cannon: {...}, tank: {...}, sdkfz: {...}},
                    ellipseMode: 'classic', eyeHeight: 1.65, footprint: {walkStep: 0.75, runStep: 1.6, life: 90, fade: 30},
                    rooftopDelta: 2.0 }
CONFIG.ai       = { nervousness: {T: 50, decayPerTick: 1, closeRange: 2.25, heldValue: 1000, bodyBonusDiv: 25},
                    investigate: {speed: 1.8, look: 4.0}, decoy: {radius: 13.5, pulse: 1.5, giveUp: 5.0, standOff: 2.0},
                    search: {time: 20, points: 3, radius: 8}, lostTarget: 3.0, chaseSpeed: 3.8, halt: {cooldown: 3, moveTol: 0.3},
                    partnerGlance: {every: 25, dur: 2.5}, panic: {stuck: 5, wander: 2}, aim: 0.5, enemyHP: 200 }
CONFIG.alarm    = { sirenGain: 0.75, sirenFadePerSec: 0.03, sirenDur: 25, reinforceExit: 2.7, reinforceLoop: 1.8, regen: 20 }
CONFIG.weapons  = { pistol: {range: 13.5, dmg: 80, cadence: 0.15, noise: 18}, sniper: {range: 45, reload: 0.5, aim: 0.6},
                    smg: {range: 18, rounds: 5, dmg: 100, fanDeg: 15, cadence: 0.8, noise: 25},
                    harpoon: {range: 9, reload: 3.0}, grenade: {range: 13.5, flight: 1.0},
                    rifle: {range: 36, dmg: 80, cadence: 1.0, noise: 22.5}, mp40: {range: 18, rounds: 5, dmg: 100, cadence: 1.0},
                    mg: {range: 28.8, dmg: 100, rounds: 5, cadence: 0.25, noise: 36},
                    explosions: {bomb: {...}, barrel: {...}, grenade: {...}, vehicle: {...}, shell: {...}} }
CONFIG.abilities= { knife: {reach: 1.2, dur: 0.6, hit: 0.3}, syringe: {dur: 0.9, hit: 0.5}, timeBomb: {fuse: 10},
                    firstAid: {heal: 34, doses: 6, dur: 1.5, at: 0.5}, dig: 2.0, rise: 1.0, cutters: 3.0,
                    raftDeploy: 2.0, dive: 1.5, uniform: 1.5, distractRange: 1.5, distractBreak: 3.0, climbSpeed: 0.5 }
CONFIG.vehicles = { truck: {slow: 3, fast: 9, turn: 60}, tank: {slow: 2, fast: 5, turn: 45}, boat: {slow: 2.5, fast: 4},
                    runoverBox: [1.8, 5.4, 1.35], hits: {truck: 30, kubel: 20, car: 60, sdkfz: 500, panzer2: 1000} }
CONFIG.rulesets = { BEL: { knockouts: false, handcuffs: false, stones: false, cigarettes: false, spyChloroform: false,
                           spyUniformFromCaptives: false, driverClub: false, driverRifle: false,
                           sergeantsSeeThroughDisguise: false, difficulty: false }, BCD: {...} }
```

### 10.4 Deltas against `ARCHITECTURE.md` (to be applied by their owners)
1. **Camera:** remove **WASD pan**, which collides with the BEL hotkeys A, S, D and W. Keep arrows, edges, middle-drag and wheel.
2. **Unit states:** add `held` (at gunpoint), `captured` (being escorted) and `jailed` to the `Unit.state` enum, next to the reserved `stunned` and `bound`. Add `buried` and `disguised` as flags.
3. **Art:** the `createHumanoid` "Low-poly" wording is superseded by the realism requirement. Silhouette rules still apply (§3.0).
4. **Audio:** "All sounds synthesized" is superseded by recorded CC0 + TTS (§9).
5. **VisionCone:** colour by `alertLevel` only when the `alertTint` option is on. Faithful mode uses the flat BEL colours plus a 1 s spotter highlight (§4.2).
6. **Mission schema:** add the fields in §7.3. `par` is `{time}` in seconds, and kills are not scored.
7. **Grid:** add `dynamicBlock` and `elev` layers plus climb and ladder links (§10.2).
8. **Enemy.vision:** add `{fov, near, far, sweep, period, elliptical, eyeHeight}`. Add `Enemy.nervousness`, `sawBody` and `sawKill`.
9. **Test API:** `state().enemies[i]` also returns `{nervousness, sawBody, target}`. `state()` also returns `{zonesFired, siren, clock}`. Add `probe(x, z)` (the red marker) and `noise(x, z, kind)`.

### 10.5 Determinism, performance, testing
- **Determinism.** A seeded `Rng` per mission drives sweep phases, search points and decoy tie-breaks. Enemy shots are deterministic hits (§4.1), so a quickload replays identically given the same inputs.
- **Performance budget.**
  - 40–80 enemies, of which about 40 are on screen.
  - Perception at 60 Hz costs under 1.0 ms per frame on the target GPU machine: spatial hash first, then the angle test, then LOS.
  - Only one cone mesh (up to 6 with multi-view).
  - Trees and props are instanced; vegetation density follows the quality preset but **never removes an occluder** (gameplay trees are fixed).
- **Behaviour tests** (headless, `tests/*.test.mjs`):

  | # | Scenario | Expected |
  |---|---|---|
  | 1 | Walking commando in the far band | Challenge in ≤ 0.35 s |
  | 2 | Crawling commando in the far band | Never seen |
  | 3 | Crawling commando in the near band | Challenge in about 2.5 s ± 0.2 |
  | 4 | Commando frozen in view | Never challenged, no fire. A walking commando who stops once challenged is held indefinitely, no fire, and no zone event |
  | 5 | Pistol shot 15 m from a guard outside any zone | INVESTIGATE, no zone event |
  | 6 | Body in the far band | BODY → `RINT` (siren 25 s) |
  | 7 | Decoy on | The nearest `investigates` guard walks to 2 m and stares; decoy off → returns after 5 s |
  | 8 | Time bomb | Explodes at 10.0 s |
  | 9 | First aid | +34 HP per dose, 6 doses |
  | 10 | Three pistol hits | Kill a soldier; two do not |
  | 11 | Knife from behind | Silent; a guard 2 m away with his back turned does not react |
  | 12 | Disguised Spy | Walks past a guard unchallenged; injecting in view unmasks him |
  | 13 | Vision fidelity | The drawn cone equals the detection geometry (§10.2) |
  | 14 | M1–M3 | Each loads, the paths from every commando start to every objective and the extraction exist, and no commando starts inside a cone |

### 10.6 Content and legal
- Enemy flags (user decision 2026-09-30): the **historical German national flag 1935–45** on enemy flagpoles and garrison buildings only — red field, white disc 3/4 of the height with its centre 1/20 of the length toward the hoist, black swastika at 45°, 3:5 (`src/art/flags.js`, `src/art/flag-textures.js`). Options → GAME PREFERENCES → **INSIGNIA: HISTORICAL (default) / NEUTRAL**; NEUTRAL shows the field-grey banner with a Balkenkreuz (saved setting). It is never used as decoration, in the UI, menus, branding or merchandise. **SS runes, death's heads and swastikas on uniforms or characters stay out** unless the user asks. Vehicles keep the Balkenkreuz.
- Censored mode adds gravestones and removes blood.
- The briefing texts, Colonel lines and barks in this document are **original writing**.
- Fonts are SIL OFL (Oswald/Anton) and credited in CREDITS.md, noting that OFL is not CC0 (the policy allows it with attribution).
- The fan-tribute disclaimer (top of this file) appears on the title screen, in the credits, in the README and in the page footer of the published build.

### 10.7 Debug mode (`?debug`, developer tool, not part of the 1998 game)
- **Switch:** the URL parameter `debug` with any value except `0`/`false`/`off`/`no` (`?debug`, `?debug=1`, `?debug=cones`). Without it nothing below is created (no DOM, no key handler, `game.debug === null`) and no menu links to it. Code: `src/debug/debug-mode.js` (DOM, keys, HUD) and `src/debug/debug-options.js` (pure: parsing, options, grouping, def transform).
- **Level select:** boot skips the title splash and opens DEBUG LEVEL SELECT over the title. It lists `missionList()` at run time, grouped BEL (sorted by mission number, whatever the list order), BCD, then sandbox/test maps (`m00`, `dev: true` maps, unnumbered maps); a tile shows number, title, id, theater colour/icon and a 240×135 capture taken 2.5 s into the first debug play of that level (IndexedDB via `ui/thumbs.js`, key `dbg:<id>`). Tap/click or arrows + Enter launch; Esc returns to the title (or resumes a mission). Opened in game it freezes the sim (`timeScale = 0`) until closed.
- **Options** (localStorage `shadowsix.debug.options`): skip briefing (default on), all commandos (missing roles of the ruleset added beside the first commando), invulnerable (`Unit.takeDamage` ignores player damage), enemies blind & deaf (`perception.canSee` → `'none'` for non-player viewers, `hears` → false), all vision cones (`VisionCones.showAll`), free camera (bounds margin = map size, zoom 0.125×–4×), time scale 0.5/1/2/4, time of day (dawn/noon/dusk/overcast → `def.lighting`) and wind (`def.weather.wind.preset`). The def-changing ones apply at the next launch through `Game.debug.transformDef` on a copy of the def; the sim reads the live flags from `world.debug`.
- **Keys** (window capture listener installed before the HUD's, so it wins): F10 level select, PageDown/PageUp next/previous level in the select's order (wrapping), Ctrl+R instant restart (no loading card), F11 corner info HUD (mission, state, time scale, FPS, frame ms, CPU ms of `Game.render`, draw calls and triangles of the whole frame, cursor ground x/z, camera zoom and yaw, active flags).
- **Deep link:** the URL becomes `?debug…&mission=<id>` on every launch; loading such a URL enters the level directly with the remembered options. Works on the web build under `/shadow-six/` (relative URLs only).

---

## Appendix A: source conflicts and the decisions taken

| Topic | Conflict | Decision |
|---|---|---|
| Commando names | US manual vs EU/official site | US-manual set (Tiny, Duke, Fins, Inferno, Tread, Spooky); EU names as a locale |
| Tick rate | 16 fps observed; 25 fps cap; 20 Hz from the bomb | 20 Hz base; optional 16–25 |
| World scale | 4.5 vs 5.7 cm per unit | 0.045 m/unit; people and vehicles at real size |
| Camera yaw | yaw 45° (visuals.md) vs yaw 0 (data) | yaw 0, pitch 40°; buildings rotated in data |
| Cone size | 90° / 10–12 m / 20–24 m (remakes.md) vs EXE | EXE: 70°, 18 m / 36 m, sine sweep, ellipse |
| Cone colours | Sampled blends vs EXE constants | EXE: #02BC6F / #07675A; desert #D26E02 / #6B4C01 |
| Footprints seen in | Whole cone (gap-8) vs near band (gap-0 code) | Near band (code evidence) |
| Bodies seen in | Near band (remakes.md) vs whole cone (EXE) | Whole cone |
| Diver visibility | Near-only (code) vs invisible (manual) | Invisible unless witnessed going under |
| Crawl tracks | Manual: none vs Prima: fading | Manual: not AI-visible |
| Movement noise | remakes.md's footstep radius vs GameSpot/manual | None |
| Body found | Immediate alarm (manual) vs "looked and moved on" (Kildread) | Alarm (manual + EXE base-class code); the per-spawn `ignoresBodies` flag covers exceptions |
| Decoy aftermath | Alarm (Prima) vs free use (Kildread, Ruetli) | No alarm by default; per-spawn flag |
| First aid doses | 6 vs 3 or 6 | 6 |
| SMG ammo | 20 vs 100 | 100 rounds shown as 20 bursts |
| Time bomb fuse | 10 s vs 11 s vs 7.5 s (M4 crate) | 10 s |
| Uniform hotkey | U vs T (German) | U |
| M2 exit | SW road vs SE gate | SE gate and road (Prima, Kildread) |
| M3 exit | N vs E of the dam | Truck north-east of the dam (beyond the reservoir's E rim), at (60,10) |
| M6 terrain | Snowy (visuals.md) vs green spring (missions.md) | Green spring |
| M11 exit | E (TA) vs W/NW | W/NW |
| M12 alarm at start | Already sounded vs off | Off, but hunted |
| M16 sapper count | 3 vs 4 | 4 |
| M20 loadout | Undocumented | Sniper 5 rounds; Sapper 2 grenades + 2 remote bombs; Driver medic [inf] |
| McRae's first name | George (Prima) vs Gregor (in-game) | Gregor |
| M1 raft position | §7.4 listed (37.5, 60.5), but on the 0.5 m nav grid that cell is snow: the T2 shore at z 60.5 runs at x 37.75, so the cell x 37.5–38 is land | (37.2, 60.5): the same spot moved 0.3 m west into the shallow rim, so the raft sits in shallow water as §3.4 requires |
| Warning flashes | Undocumented in BEL | BCD semantics: blue while seen, red while attacked |
| Zoom steps | Unknown | 0.5×, 1×, 2× |
| Zone `onSeen` trigger | The engine fires on "spots a commando" vs eggie's under-shot trick working inside whole-map silent zones | Fires on COMBAT, a seen kill or a found body; not on CHALLENGE or HOLD |
