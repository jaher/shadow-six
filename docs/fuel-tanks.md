# Fuel tanks: research and design spec

Request (user, 2026-09-30, while playing M2 on the live site): *"Can you design better more detailed fuel tanks
like in the original"*.

Today every `fueltank` is a procedural placeholder: `src/art/props.js` `ROUND.fueltank` builds an olive cylinder with
two hemispherical caps, three concrete blocks, two bands and a hatch. `src/art/building-props.js` maps
`fueltank: { horizontal_cradle: null }`, so no library model is used. The only fuel model in the library is
`desert/fuel_depot` (`tools/blender/desert/scripts/fuel_depot.py`). It is a drum *shed*, not a tank. It stays for
the sandbox and the drum stores.

This document records what the original game shows, the real WWII hardware behind it, and a buildable spec for each
type. It covers dimensions inside the current gameplay footprints, a parts list, materials per theater, damage
states, LODs and budgets, and which mission uses which type.

Hard rules (unchanged):
- We match the original's **design** and author our own models. No original sprites or textures go into the repo.
- No swastikas or SS runes. Plain stencils and Wehrmacht-style lettering only.
- No interpenetration.
- Everything must read from the default orthographic camera (pitch 40°, yaw 15°) and at zoom 2.

## 1. Sources

- **Original map renders** (our own study copies of the full-mission map images already in the scratchpad,
  `refs/missions/*_map_full.jpg`). The crops are in the session scratchpad under `tanks/ref/` (`m02_tanks_crop`,
  `m08_tanks_crop`, `m08_blockB`, `m13_tanks`, `m17_elev`, `m11_vert_w`, `b6_push`, `b6_roof`). Nothing is copied
  into the repo.
- **Docs in this repo:**
  - `docs/building-inventory.md` lines 177-180 and the per-mission lists.
  - `docs/research.md`: M2 §, M8 §, M13 §, M17 oil fire, B6 `DEPOSEMP`.
  - `docs/research-raw/gap-3.md` (M8 tanks with a ladder and guards 26-28 on top).
  - `docs/research-raw/gap-4.md` (M13 remote charge; M17 valve: "Click several times, until the fuel pours onto
    the ground in a steady stream").
- **Real-world photos** (Wikimedia Commons, used for study only, not shipped):
  - IWM N396 *Raid on the Lofoten Islands, 4 March 1941*, public domain. Commandos watch the fish-oil tanks burn.
  - Bundesarchiv Bild 101I-782-0033-16A *Nordafrika, Umfüllen von Treibstoff oder Wasser*, 1941, CC BY-SA 3.0 de.
  - Bundesarchiv Bild 101I-022-2923-27A *Russland, Treibstoff-Nachschub*, CC BY-SA 3.0 de.
  - Wikipedia *Jerrycan* (Wehrmacht-Einheitskanister, 1937).
- Web search was exhausted for this session and the fan wiki returned HTTP 402. The original-game evidence is
  therefore our own reading of the map renders plus the walkthrough quotes already collected in `docs/research*`.
  Dimensions come from DIN/UL-style practice for welded and riveted horizontal tanks (head depth about D/4, saddles
  at about 0.2 L from the heads), scaled to fit the footprints.

## 2. What the original shows (per mission)

| Mission | Theater | What the map render shows | Our inventory type |
|---|---|---|---|
| **M2** A Quiet Blow-Up (Stamsund) | snow | **Two big pale cream-beige horizontal tanks lying side by side, touching.** A **low timber-plank bund wall** surrounds the pair. A **catwalk with tube handrails** runs across both crowns. At one end a **timber trestle stand with a ladder and a pump/outlet** rises to catwalk height. Snow lies on the crowns and on the bund. The shells are plain and the ends rounded (dished). | `fuel_tank_horizontal`, variant `horizontal_cradle` |
| **M8** Pyrotechnics (Tell el Eisa) | desert | **Two "blocks".** Each has **three or four short, fat, dark maroon-brown tanks** side by side. Their **dished ends face out** on the long faces. Each tank rests on **dark concrete end blocks**. One **flat steel-grating deck** on a steel frame covers each block, with low rails around it. A **ladder** runs up one long face. **Guards stand on the deck** (26-28). The shells show heavy rust streaks and sun-bleached tops. | `fuel_tank_horizontal` (deck block) |
| **M11** In the Soup (Maradah) | desert | A **W yard cluster of three tall off-white vertical columns** joined by a low pipe run, and a **N pair** next to the rigs. Each column has a **hemispherical dome**, vertical riveted seams and hoop bands, a **side manhole flange**, and a **gooseneck pipe** from the dome down the side to the ground. The base is a round concrete plinth. The pipe run between them is pale, with **red flanges and handwheel valves**, plus ground clutter of small pipes. Grime streaks run down from the dome. | `oil_tanks_vertical` |
| **M12** Up on the Roof (Tunis) | desert | The inventory lists one horizontal tank. It is **not visible** on the map render we hold. | `fuel_tank_horizontal` (unconfirmed) |
| **M13** David and Goliath (Le Havre) | coast | NE quay by the battleship berth. **Three teal/grey-green horizontal tanks** lie side by side, touching, on **low steel trestle legs**. One **transverse catwalk with handrails** crosses all three crowns. Each crown has a **round radial manhole lid**. **Rust streaks and scorch/soot blotches** mark the shells. **Hoses lie on the quay** from the heads. Cargo bales and crates stand nearby. | `fuel_tank_horizontal` (quay) |
| **M17** Before Dawn (Riveauvillé) | temperate | By the inner gateway of the camp. **Two squat vertical cylinders** (green-grey, rust-brown tops, small vent) stand on a **raised steel-grating platform about 3 m up** on steel legs. The platform has a **side ladder** and a railing, and a **pipe drops from the tanks down the frame** (the valve that spills the oil). So "twin tanks on a raised frame" means **vertical** twins, not horizontal. | `fuel_tank_elevated` |
| **B6** Eagle's Nest (Neubrandenburg) | temperate | **Four `DEPOSEMP`**: small **grey two-wheeled tank trailers** (a horizontal tank about 2.2 m long, a drawbar, and a pump or hose reel at the end) parked next to the aircraft. Elsewhere: **three rusty vertical tanks on a raised concrete platform with a stair** beside the workshop, and many **clusters of grey 200 l drums**. | `fuel_tank_pushable`: reuse `vehicles/aircraft/fuel_bowser_*` |
| M19 | temperate | The object at (0.29, 0.17) is an **octagonal concrete pillbox in a sandbag ring**, not a tank. M19 has no fuel tank. | none |

Recurring traits of the original:
1. **The tank is never alone.** Every installation has something to climb: a catwalk, a ladder, a deck or a
   platform. Most also have an enclosure (a bund wall or a frame) and some ground clutter (pump, hoses, drums).
2. **The top matters most.** From the isometric camera you see the crowns: catwalks, manholes, vents and snow.
3. **Strong value contrast with the ground.** The pale tanks in M2 sit on a dark bund over brown and white ground.
   The dark tanks in M8 sit under a light grating on sand. The teal tanks in M13 sit on grey setts. The white
   columns in M11 stand on ochre sand.
4. **Dished ends, not hemispheres.** Flat ends are wrong too. Seams and bands give the shell its scale.
5. **Weathering.** Rust streaks run down from seams and fittings, and the original paints soot blotches even on
   intact tanks (M13).

## 3. Real WWII fuel storage (what the details should be)

**Horizontal tanks.** These are welded or riveted mild steel, 2-3.5 m in diameter and 6-12 m long, holding 20-90 m³.
- *Shell:* 4-6 plate courses about 1.5 m wide. Lap or butt circumferential seams with rivet rows on older tanks.
  The longitudinal seams are staggered on the upper third.
- *Heads:* dished or torispherical, about D/4-D/5 deep, with a knuckle radius at the rim.
- *Supports:* two **saddles** at about 0.2 L from each head. Concrete saddles have a curved cradle and a steel wear
  plate. A **hold-down strap** (flat bar over the crown, bolted to lugs) is common. Field depots used **timber
  cribs** (stacked squared logs with a curved bolster) or steel A-frame **trestles**.
- *Crown fittings:*
  - a **manhole** (600 mm) with a bolted ring and a hinged or bolted cover;
  - a **filler** with a cap;
  - a **vent pipe with a flame arrestor** (a finned or gauze cylinder) and a mushroom or gooseneck cap;
  - a **dip hatch** for the gauging rod.
- *Bottom outlet:* a sump outlet at the low end of one head, then a **gate valve** with a handwheel, then the
  **pump**. Field depots used a semi-rotary hand **wing pump** on a board, a hose on a hook and a drip tray.
- *Access:* a **catwalk** of planks or grating on brackets clamped to the crown, with a tube handrail (top rail and
  knee rail) and a vertical **ladder** at one end. A **cage** of hoops is fitted above about 2.5 m on tall frames.
- *Containment:* an **earth or concrete bund** (a low wall or berm around the tank, with a gravel floor and
  oil-stained). Forward depots used **timber-plank kerbs** or sandbag walls instead.
- *Level gauge:* on bigger tanks a **gauge board**, a vertical board with a float indicator on a cable over a top
  pulley.

**Vertical process tanks (oilfield and refinery).** Riveted or welded columns with domed or cone roofs, hoop
stiffeners, a side manhole, a gooseneck vent, nozzles with flanged valves (handwheels painted red) and pipe racks on
low supports. Petroleum tanks were often painted white or aluminium to cut evaporation in hot climates.

**Fuel drums and cans.**
- The **200 l drum** is about 0.59 m across and 0.88 m tall, with two rolling hoops and two bungs on the lid. It
  stands upright in rows on timber dunnage, or lies in pyramid racks.
- The **Wehrmacht-Einheitskanister** (1937) holds 20 l. It is a stackable box about 0.47 × 0.35 × 0.16 m with three
  handles and a recessed X stiffener. A **white cross means water** (Bundesarchiv 101I-782-0033-16A shows both), so
  fuel cans must **not** get a white cross.
- Field refuelling uses a **hand pump on a drum**, hoses and funnels.

**Paint and markings.**
- German Army: **Dunkelgrau** (RAL 7021) until early 1943, then **Dunkelgelb** (RAL 7028). Africa 1941-42 used
  sand/yellow-brown (RAL 8000/7008). Red-oxide primer shows through on worn crowns and at the rust.
- Civilian depots taken over in Norway and France kept their light (cream/grey) or aluminium paint. That matches the
  pale M2 tanks.
- Kriegsmarine harbour hardware: grey-greens and dark greys, salt-streaked.
- Stencils in plain block letters:
  - `KRAFTSTOFF` (fuel), `BENZIN`, `HEIZÖL` (bunker fuel oil for ships), `DIESEL`;
  - capacity, e.g. `27 000 L`;
  - a tank number, e.g. `Behälter 1`;
  - `FEUERGEFÄHRLICH` (flammable);
  - `RAUCHEN VERBOTEN!` / `Feuer und offenes Licht verboten` signs on boards.

**How they die.** The Lofoten photo (IWM N396) shows how a big tank fails. The shell bursts and its plates **peel
outward in petals** from a ragged hole. The roof rim sags and black smoke rolls from the pool fire. Horizontal tanks
rupture along a seam, the **head blows off** and is thrown a few metres, the shell **sags onto one saddle**, and the
paint **blisters and soots black**. Catwalks twist and hang. Timber burns to charred stumps.

## 4. Shared design rules

- **Footprints are fixed.**
  - Every model fits the gameplay footprint the mission already declares (w × d × h, local +X = the long axis).
  - feat/align keeps the M2 pair end to end, parallel to the NE palisade, with the same rotation.
  - feat/missions owns the M8/M11/M13/M17 entries.
  - Only non-blocking dressing may poke past a footprint edge, and at most 0.3 m: hoses, a sign, a drip tray.
    Debris in the destroyed variants stays within the footprint plus 0.5 m.
- **No interpenetration.**
  - Parts touch; they don't cross. Saddles meet the shell along its arc, catwalk brackets sit on the crown, and
    ladders stand 0.15 m off the shell.
  - Snow caps sit on the surface.
  - The `tools/blender/desert/contact.py` contact check and the clip audit (`src/debug/clip-rules.js`, where `fueltank` is a `prop`) must
    pass.
- **Readability at pitch 40°, yaw 15°, zoom 1 and 2.**
  - The crown carries the detail, and every tank shows at least three crown features (catwalk, manhole, vent).
  - The dished heads must show their curvature. Use 32 radial segments at LOD0 and smooth normals with a hard edge
    at the knuckle.
  - Value contrast: the shell differs from the ground by at least 25 % luminance in every theater (see §6). The
    rails are thin (0.04-0.05 m) but darker than the ground so they draw a line.
  - Stencils are large (0.30-0.45 m caps) and placed on the side facing the camera's default quadrant. A
    mirrored stencil goes on the far side.
- **Scale cues.** Handrails 1.0 m high (0.65 m on M2, see §5.1), ladder rungs 0.30 m apart and 0.45 m wide,
  manholes 0.6 m, drums 0.88 m. With these a 1.8 m soldier reads correctly next to the tank.
- **Kit and materials.**
  - Use the Blender 4.2 kit (`tools/blender/kit`) and the shared texture library: `steel_painted`, `paint_metal`,
    `steel_grating` (alpha cutout), `steel_galv`, `concrete_slab`, `concrete_aggregate`, `timber_beam`,
    `timber_tarred`, `boards_weathered`, `gravel`, `sand`, `snow`, `cast_iron`, `burlap_bag`.
  - Use the decal atlas: `streak_rust`, `stain_rust_blotch`, `streak_long`, `soot`, `stain_blotch`, `dirt_splash`.
  - Paint colour comes from the material tint per theater (§6). No new 2k textures.
- **New signs in the `signs` atlas** (`kit/lib/decals.json`), as plain block lettering, black on cream or white on
  dark:
  - `kraftstoff`, `heizoel`, `rauchen_verboten` ("RAUCHEN VERBOTEN!"), `feuergefaehrlich`;
  - `behaelter_1` … `behaelter_4`, `liter_27000`.
  - Use no eagles, no swastikas and no runes.
- **Gameplay hooks the models must expose** as named nodes, so code can find them:
  - `catwalk`/`deck` (the walkway height, guards' beat);
  - `ladder` (base and head points, written to the sidecar like the M8 `beat`);
  - `valve` (M17: a handwheel pivot that the `fuel_valve` set-piece can spin);
  - `spout` (the oil-spill origin);
  - `blast_origin` (the fx centre).

## 5. Types

### 5.1 `fuel_tank_horizontal` / `horizontal_cradle`: M2 field depot (snow)

Footprint: **9.0 × 3.4 × 3.5 m**, one tank per footprint.

M2 places `depot_a` and `depot_b` end to end, 10 m apart, at rot 40.8°, which leaves a 1 m gap between the
footprints. In the original they lie **side by side**. We keep the feat/align layout and recover the original's
look per tank: each tank gets its own bund, crown catwalk and end stand. The stand goes on the **outer** end, so
the pair reads as one depot with a stand at each end.

Assets: `fuel_tank_h_cradle` and `fuel_tank_h_cradle_m` (mirrored, stand at local −X). Snow variants
`*_snow` and destroyed variants `*_destroyed` (+ `_snow`). `building-props` picks the mirror when the nearest
`fueltank` of the same objective lies on the tank's local +X side. No mission data changes.

| Part | Spec (local metres, +X long axis, y up, origin at footprint centre) |
|---|---|
| Shell | Ø 2.30, cylindrical length 6.20, 2:1 dished heads 0.40 deep, so 7.00 overall. Centre at x −0.55, y 1.60 (bottom 0.45, crown 2.75). 4 plate courses about 1.55 m wide. Raised circumferential seam strips (0.04 wide, 8 mm proud) with rivet rows baked into the normal map. One staggered longitudinal seam on the upper quarter. |
| Saddles (snow) | Two **timber cribs** at x −0.55 ± 1.86. Each is three courses of 0.25 m squared logs (`log_hewn`) 2.0 m long, with a curved bolster plank that fits the shell arc exactly and a flat-bar **hold-down strap** over the crown bolted to the crib. They stand on gravel. |
| Crown | Manhole Ø 0.60 × 0.25 at x +0.6, with a 12-bolt ring and a hinged lid. Filler cap Ø 0.20 at x −1.6. Vent: a 0.08 pipe 0.7 high with a finned flame-arrestor (Ø 0.16) and a mushroom cap, at x −3.0. Dip hatch Ø 0.15 by the manhole. |
| Catwalk | Plank deck 0.55 wide on brackets clamped to the crown, deck at y 2.85, from x −1.9 to the stand. One tube rail on the camera-far side, **0.65 m high** (top 3.50 = the footprint h): low by real standards but needed for h and matching the original's low rails. Stanchions every 1.0 m, with a top rail and a knee rail. |
| End stand | Timber trestle 1.1 × 1.1 at x 3.15…4.25 (gap ≥ 0.1 to the head). Four 0.15 posts, diagonal braces, a platform at 2.85 joined to the catwalk, a 3-step stile over the bund and a **ladder** on the outer face (stringers 0.45 apart, rungs at 0.30). The ladder stops at the platform. |
| Outlet and pump | Sump outlet at the low point of the +X head, then an elbow, a gate valve with a red Ø 0.25 handwheel, and a semi-rotary **wing pump** (`cast_iron`) on a plank at the stand's foot. A hose coils on a hook. A drip tray sits under the pump. |
| Bund | Low timber-plank wall on the footprint edge, 9.0 × 3.4 outside, 0.55 high: 0.2 m boards (`boards_weathered`, tarred lower board) on 0.12 posts at 1.5 m. The floor is gravel with `stain_blotch` oil decals. There is an opening at the stile. |
| Dressing | 3-4 drums (two upright, one lying) inside the bund at the stand end. A `RAUCHEN VERBOTEN!` board on the stand. A fire bucket on a nail. |
| Paint | Pale cream-grey (civilian depot paint, about RAL 9001 dulled to #CFC6AE). Red-oxide primer at worn crown spots. `streak_rust` below the manhole, the seams and the outlet. `KRAFTSTOFF` and `Behälter 1` or `2` on the camera side, `27 000 L` on the +X head. |
| Snow variant | A cap mound (smooth, about 0.12 thick) on the upper 100° of the shell, broken by the catwalk. Snow on the cribs, the bund cap boards, the stand platform and the pump board. Drift wedges at the outside foot of the bund. Icicles under the catwalk (LOD0 only). |
| Collision | `tank` (the shell box), `wall` (the bund strips, LOW), `post` (the stand legs). The catwalk is **not** a walkway in M2. |

### 5.2 `fuel_tank_horizontal`, deck block: M8 tank farm (desert)

Footprints (feat/missions): **tank_b 9.0 × 7.0**, **tank_a 8.5 × 6.3**, with h = `TANK_DECK_Y` (4.5). One walkway
covers the whole deck. The guard's beat ends at the ladder head near the +X end of the +Z face.

Assets: `fuel_tank_farm_9x7` and `fuel_tank_farm_85x63`, plus `_destroyed`. Desert only.

| Part | Spec |
|---|---|
| Tanks | **Twin short, fat tanks** side by side (the original's M8 pair, and `building-inventory`: "twin tanks under a frame"), axes along local **Z**, dished heads facing ±Z. They fill the deck height: the crowns sit 0.28 m under the deck beams, as the original's deck rests on its tanks. 9×7: Ø 3.56 at 4.30 pitch (x ±2.15), cylinder 4.40 + heads 0.45. 8.5×6.3: Ø 3.44 at 4.05 pitch, cylinder 3.90 + heads 0.42. Shell bottom at y 0.42. Seams as §5.1. A low manhole, a short vent on the shoulder and a filler per tank, all under the beams. (Built 2026-10-01; the first build had 3 Ø 2.3 tanks and read as a tall canopy over small tanks.) |
| Saddles | **Dark concrete end blocks** (as in the original): two per tank at z ±1.7, 0.5 × 0.6 × 2.0, with a curved top fitted to the shell, plus a hold-down strap. |
| Frame | Steel I-section columns 0.20 at the four corners and at the mid points of the long faces (6 total, at ±(w/2 − 0.15)). Ring beams at y 4.35. Cross-bracing (flat bar) in the end bays only, so the tanks stay visible from the camera. Paint: sun-faded Dunkelgelb/sand. |
| Deck | `steel_grating` (alpha cutout) over the full footprint at **y 4.50**. A 0.10 toe board and a 1.0 m tube rail around it, with an opening at the ladder head. The tanks show **through** the grating, as in the original. |
| Ladder | Vertical, on the +Z face at the mission ladder's x (`ladder_b` local +2.0 on the 9×7, `ladder_a` +2.8 on the 8.5×6.3), from the ground to 4.5. A **safety cage** of hoops (0.64 m deep) from 2.4 up. Grab rails 1.0 m above the deck. |
| Manifold | A 0.15 header along the −Z face at y 0.6 on small pipe stools. One branch to each tank's −Z head through a gate valve (red handwheel). The header ends at a **dispensing stand** (a valve, a hose on a rack, a drum-filling spout and a drip tray) at the −X end. |
| Base | Concrete slab with a 0.25 bund kerb on the footprint edge and a ramp notch at the dispensing stand. Sand drifts against the kerb. |
| Dressing | 4-6 drums on dunnage by the stand (the M8 racks and barrels stay separate entities), sandbags at two column feet, and a `RAUCHEN VERBOTEN!` sign on the ladder cage. |
| Paint | Tanks are dark **maroon-brown**, low saturation (#3B2B26; the first build's #4A352F rendered salmon in the desert sun), heavily streaked with rust (`streak_rust`, `streak_long`) and sun-chalked on the crowns (a lighter top gradient). `KRAFTSTOFF` and the number on the ±Z heads in off-white. The frame is sand. |
| Collision | `building` (the deck box, h 4.5, walkable top as declared by the mission walkway), `post` (columns), `wall` (kerb, LOW). |

### 5.3 `fuel_tank_horizontal`, quay: M13 harbour (coast)

Footprints (feat/missions): **fuel_1 12 × 4.5 × 5**, **fuel_2 11 × 4.5 × 5**, both rot −10°, 5 m apart side by side.
That matches the original's side-by-side row (3 tanks there, 2 here).

Assets: `fuel_tank_quay_12` and `fuel_tank_quay_11`, plus `_destroyed`. Coast and temperate.

| Part | Spec |
|---|---|
| Shell | Ø 3.40, so the crown is at y 4.30. 12 m: cylinder 10.0 + heads 0.60 each = 11.2. 11 m: 9.2 + 1.2 = 10.4. 6-7 plate courses with rivet rows. |
| Supports | **Steel trestles** (as in the original): three angle-iron A-frame bents per tank (at 0.2 L, 0.5 L, 0.8 L), 0.9 m high to the cradle, with curved cradle plates and diagonal bracing. They stand on concrete pads set into the setts. |
| Crown | Manhole Ø 0.70 with a **radial ribbed lid** (the original's round radial cover), vent with a flame arrestor, filler, and a **gauge board** at one end (vertical board, float cable over a pulley, painted scale). |
| Catwalk | A longitudinal plank or grating catwalk on the crown (0.6 wide, deck at 4.40) with a 0.6 rail on one side (top 5.0 = h). A **transverse stub** 0.25 long on each side at mid-length, so two tanks placed 5 m apart read as one bridged catwalk, as in the original. The stub is dropped when no neighbour is found. |
| Ladder | At the +X head, from the quay to the catwalk. A cage from 2.4 m up. |
| Bunkering | Bottom outlet at each head, then a gate valve, then **two flexible bunkering hoses** (Ø 0.15, black rubber, steel-wire bands) lying on the setts in S-curves toward the berth, on short timber hose rests. They stay inside the footprint plus 0.3 m. |
| Paint | **Teal/grey-green** (#4F6E6A to #5E7B76, Kriegsmarine-style grey-green, salt-bleached) with `streak_rust` from every fitting, `soot` blotches (the original shows them even intact) and white salt rime along the lower third. `HEIZÖL`, `Behälter 1`/`2` and `FEUERGEFÄHRLICH` in black on a pale panel. |
| Collision | `tank` (shell), `post` (trestle legs). |

### 5.4 `oil_tanks_vertical`: M11 oilfield process columns (desert)

Footprints (feat/missions): circle **r 1.75, h 7**.
- The yard trio `tank_w1-3` (type `fueltank`) stands about 7.8 m apart on a diagonal.
- The quarry pair `tank_q1/q2` uses the same variant but type `barrels` (they burst like a barrel).

Assets: `oil_tank_column`, `oil_tank_column_b` (a different nozzle and ladder side) and `_destroyed`, plus a
separate non-blocking dressing piece `oil_pipe_run` (LOW).

| Part | Spec |
|---|---|
| Plinth | A round concrete plinth Ø 3.5 × 0.35, with a chamfered edge and a sand drift on one side. |
| Shell | Ø 3.00, from 0.35 to 5.75 (5.4 m). **Hoop bands** every 1.2 m (raised strips) and staggered vertical riveted seams, as in the original. |
| Roof | A **hemispherical-ish dome** (torispherical, 0.95 high, so the top is at 6.70) with a small crown flange. |
| Fittings | **Gooseneck vent pipe** Ø 0.15 from the crown, arching over the edge and running down the outside to a valve box at the ground (the original's most readable feature; top at 7.0 = h). A **side manhole flange** Ø 0.6 at y 0.9 with 16 bolts and a red-oxide cover. A **nozzle stub** Ø 0.20 at y 1.1 pointing to the cluster neighbour, ending in a flange and a red handwheel gate valve. A **level gauge board** on the camera side. A narrow rung ladder (no cage) up to a small crown platform on `_b` only. |
| Pipe run (`oil_pipe_run`) | A pale Ø 0.20 pipe on low concrete stools (pipe centre 0.6) between neighbouring columns of the same cluster, with **red flanges at every ~2 m joint**, two red handwheel valves and a short ground manifold (tee, valve, elbow to a ground stub) at mid-run. Built procedurally in three.js (`src/art/fuel-pipes.js`): `building-props` adds it to the column with the smaller id of every pair within 9 m, from a nozzle stub out of each shell at 1.45 m along the straight line between them; a pair whose line crosses another footprint gets none. LOW dressing, no nav cells. |
| Paint | **Off-white / ivory** (#D9D3C2), with dust-grey grime rising from the plinth, **oil/grime streaks from the dome down** (`streak_long`, `streak_rain`) and rust at the bands. The flanges and handwheels are signal red (#8E2A22), the pipes pale grey. Stencil `ÖL` with the number on the camera side. |
| Collision | `tank` (circle), `post` (vent foot). The pipe run is LOW and crossable. |

### 5.5 `fuel_tank_elevated`: M17 raised twin tanks with the oil valve (temperate)

Footprint (feat/missions): **5 × 3 × 6** at `C(33.7, 25)`, rot `CAMP_ROT`. The `fuel_valve` set-piece's `VALVE` is at
`C(30.2, 25)`, 3.5 m along −u: the valve sits **just beyond the −X end**, and the spill runs toward `GATEWAY`.

Assets: `fuel_tank_elevated`, `fuel_tank_elevated_destroyed`. A valve-open state is animated in code, with no
separate GLB.

| Part | Spec |
|---|---|
| Frame | Six steel I-section legs 0.18 (at the corners and mid long sides), cross-braced with X flat bars on the ends and one long side. Ring beams at y 2.55. Deck of `steel_grating` 5.0 × 3.0 at **y 2.60** with a 1.0 m tube rail and toe boards. The **ladder** is on the +Z long side near +X, from the ground to the deck, with no cage (2.6 m). |
| Tanks | **Two vertical tanks** Ø 1.90, shells 2.40 high (y 2.60 to 5.00), with shallow cone roofs 0.35 (top 5.35) and a small vent with a mushroom cap to 5.8. Centres at x −1.15 and +1.15 (gap 0.40). Each sits on a steel ring skirt on the deck. Rolled seams and two hoop bands. A filler and a small manhole on each roof. |
| Valve and spout (gameplay) | A bottom outlet on the −X tank. The pipe Ø 0.12 runs through the deck, under it to the −X end and down a pipe post outside that end (on clamps) to a **big gate valve with a Ø 0.40 handwheel** (node `valve`, spinnable) at y 1.0, then a short horizontal **spout** (anchor `spout`) on the centre line, tip at x −3.02 pointing −X: its world position sits 0.48 m from `VALVE` (3.5 m along −u; the tip is 0.52 m past the footprint edge, the one dressing exception, for gameplay). A drip stain sits under the spout. |
| Dressing | Two drums under the deck and a `RAUCHEN VERBOTEN!` board on the ladder side. A hose coils on the leg. |
| Paint | Tanks in **field-grey green** (#5B6152) with **rust-brown roofs** (#6A4632, as the original's rusted tops) and `streak_rust` down from the roof seam. Frame black-grey (#2E2E2C). `KRAFTSTOFF` on the camera-facing tank. |
| Collision | `post` (legs), `tank` (the deck box at h 6 as declared, block 2 = HIGH per mission). |

### 5.6 `fuel_tank_pushable`: B6 `DEPOSEMP`

**Reuse the vehicle library's `vehicles/aircraft/fuel_bowser_{grey,winter,dak,burnt}`** (5.8 × 2.0 × 2.3 m,
5000 l), which already exists. We don't remodel it.

The original's pushable is a smaller **two-wheel** grey tank trailer. If B6 later needs that silhouette, the
vehicles workflow adds a `fuel_trailer_2w` variant (tank Ø 1.1 × 2.2 m, drawbar, end hose reel, about 3.2 × 1.6 ×
1.7 m). It does not belong in this building family. Its destroyed state is the existing `fuel_bowser_burnt`.

### 5.7 Shared dressing kit

These pieces are built once and placed inside the tank models and by the missions:
- `drum_200l`: upright and lying, Ø 0.59 × 0.88, two hoops and two bungs. Colours by theater: field grey, sand,
  rust red, and black with a white band for diesel.
- `jerrycan_stack`: 2 × 3 × 2 cans, no white cross.
- `drum_hand_pump`: a rotary pump on a drum, with a hose.
- `wing_pump_board`.
- `hose_coil`.
- `sign_board_post` (atlas signs from §4).
- `fire_point`: sand buckets and beaters. Already in `fuel_depot.py`; lift it into a shared helper.

## 6. Materials per theater

| Theater | Tanks | Supports and frames | Ground and bund | Weathering |
|---|---|---|---|---|
| Snow (M1-M5, M7) | Pale cream-grey civil paint (#CFC6AE) or Dunkelgrau (#4C4F52) for military sites | Timber cribs (`log_hewn`), tarred posts, galvanised rails | Gravel, `snow`, plank bund | Snow caps, icicles, wet dark streaks (`streak_rain`), light rust |
| Desert (M8-M12) | Red-oxide brown (M8), ivory (M11) | Steel in sun-faded sand (#B49C6E), concrete blocks | `sand`, concrete slab and kerb | Sun-chalked crowns, sand drifts, heavy rust, oil stains |
| Coast (M13-M14) | Teal grey-green (#5E7B76) | Steel trestles, dark grey | Granite setts, concrete pads | Salt rime, rust streaks, soot blotches |
| Temperate (M6, M15-M20) | Field-grey green (#5B6152) or Dunkelgelb (#9C8B5E, late 1944) | Black-grey steel | Mud, grass edges, gravel | Moss at the feet, rust roofs, rain streaks |

Luminance check: the shell against the ground differs by at least 25 % in every theater (cream on brown and snow
in M2, dark brown under light grating on sand in M8, teal on grey setts in M13, ivory on ochre in M11, grey-green on
brown mud in M17).

## 7. Damage states

The original swaps a destroyed structure for a charred ruin (`RUINA`). The game already plays `tanker_explosion`,
`fuel_pool_fire` and a lasting smoke column (`src/render/fx.js` `_structureBlast`). Each model ships an **intact**
and a **destroyed** GLB. `building-props` already swaps to `_destroyed` on `explosiveTarget` destruction.

| Type | Destroyed variant |
|---|---|
| Horizontal (M2, M13) | The shell bursts along the upper seam. Plates **peel outward in petals** around a ragged 2-3 m hole (the Lofoten photo). The far head is **blown off**: it lies dished-side-up 1-2 m beyond the end, inside the footprint plus 0.5 m. The shell **sags onto one saddle** (tilted 4-6°, the other end on the ground). Paint is soot-black over 70 % with blistered edges, and rust shows at the hole. The catwalk twists and hangs off one side, and the stand (M2) leans with charred posts. The bund boards burn to charred stumps with gaps. Ground: a scorch decal and a dark oil-burn pool. Snow: a melted ring (wet dark ground) with snow kept only beyond about 1 m of the bund. |
| Deck block (M8) | One corner column buckles, so the **deck drops onto the tanks** at that corner (grating bent, rails folded). Two tanks are ruptured (petals), one head is off, and the soot is heavy. The ladder is bent but still attached. The walkway is **removed** in code on destruction (guards can't stand on it). The kerb is cracked. |
| Vertical column (M11) | The dome is blown off and lies on the sand. The shell is split vertically and peeled from the top for about half its height. The gooseneck is torn and hanging. The plinth survives, with soot streaks up from the base and pipe-run flanges blown at the nearest joint. |
| Elevated (M17) | The legs on the −X side buckle, the deck tilts about 20° and one tank has toppled against the rail, split. The other is scorched and upright. The valve pipe is torn. |

As built (2026-10-01), where the footprints forced a change: the far head of a horizontal tank cannot lie 1-2 m beyond
the end (the M2 pair stands 1 m apart end to end, the quay tanks 0.4 m inside their ends), so it is torn off and
stands on its rim, propped against the south flank (it flattened the M2 bund there). The column's plinth fills its
whole footprint, so the dome is blown clean away (open, torn rim) instead of lying on the sand. The elevated deck folds
15° at the middle legs (not 20°) so the toppled −X tank stays inside the footprint. M8: two tanks (see §5.2); the west
one burst on its outer side and sags onto its crushed south saddle, the east one lost its south head, and the deck
folds along its NW-SE diagonal so the SW half rests on the west tank (≈ 1 m drop at the corner).

The destroyed variants keep the same footprint kinds, but their heights drop:
- tank: about 60 % of h;
- the M8 deck: LOW over the collapsed corner, HIGH elsewhere.

Debris stays out of neighbouring footprints. A per-mission **burning** look (fire on the wreck) belongs to the fx
layer, not the GLB.

## 8. LOD plan and budgets

These follow the kit rules (`tools/blender/README.md`): LOD1 is about 40 % and LOD2 about 12 % of LOD0. Every
shipped GLB stays under 1 MB after gltfpack, and the AO is baked per LOD.

| Asset | LOD0 tris | LOD1 | LOD2 | Notes |
|---|---|---|---|---|
| `fuel_tank_h_cradle(_m)(_snow)` | 6-8k | 2.8k | 0.9k | 32 shell segments, then 20, then 12. Rivet rows are normal-mapped only. |
| `fuel_tank_farm_*` | 12-15k | 5.5k | 1.6k | Grating is one alpha quad at all LODs. Rails become a single bar at LOD1. LOD2 is the deck box plus 3 cylinders. |
| `fuel_tank_quay_*` | 7-9k | 3.2k | 1k | The bunkering hoses drop at LOD2. |
| `oil_tank_column(_b)` | 3.5-5k | 1.8k | 0.5k | The pipe run is about 1.2k per 6 m. |
| `fuel_tank_elevated` | 6-8k | 2.8k | 0.9k | |
| `*_destroyed` | at most the intact LOD0 + 20 % | | | Petal plates are single-sided with backface on. |

- **Textures.** Only the shared 1k library is used (`steel_painted`/`paint_metal` tinted per theater, `steel_grating`,
  concrete, timber, gravel, snow), plus the decal and sign atlases.
- **Normal maps.** A trim strip for seams and rivets (`tank_seam_trim`, 1k × 128, CC0 procedural via
  `make_procedural.py`) is the only new texture.
- **No unique per-asset textures**, apart from the baked AO (512 for LOD0, 256 for LOD1, 128 for LOD2).
- **Draw calls.** At most 6 materials per LOD0 (paint, steel, grating, timber/concrete, decals, signs), and 3 at LOD2.

## 9. Which mission uses which type

| Mission | Entries (current or feat/missions) | Asset(s) | Theater |
|---|---|---|---|
| M0 sandbox | `fuel_depot` (`fueltank`, no variant) | keep `desert/fuel_depot` (drum shed) or switch to `fuel_tank_h_cradle` | temperate |
| **M2** | `depot_a`, `depot_b` (`horizontal_cradle`, 9 × 3.4 × 3.5, rot 40.8°, objective) | `fuel_tank_h_cradle_snow` and the `_m` mirror, `_destroyed_snow` | snow |
| **M8** | `tank_b` 9 × 7, `tank_a` 8.5 × 6.3 (`fuel_tank_horizontal`, deck 4.5, objective) | `fuel_tank_farm_9x7`, `fuel_tank_farm_85x63` | desert |
| M10 | drum pyramids, airfield drums | `drum_200l` racks (§5.7) | desert |
| **M11** | `tank_w1-3` (`fueltank`), `tank_q1/q2` (`barrels`), all `oil_tanks_vertical` r 1.75 h 7 | `oil_tank_column`/`_b` + `oil_pipe_run` | desert |
| M12 | one `fuel_tank_horizontal` per the inventory (not placed by feat/missions, not seen on the map render) | `fuel_tank_h_cradle` desert tint on concrete saddles, if it is placed | desert |
| **M13** | `fuel_1` 12 × 4.5 × 5, `fuel_2` 11 × 4.5 × 5 (`fuel_tank_horizontal`, rot −10°, objective, chain) | `fuel_tank_quay_12`, `fuel_tank_quay_11` | coast |
| **M17** | `fuel_tank` 5 × 3 × 6 (`fuel_tank_elevated`), `fuel_valve` set-piece | `fuel_tank_elevated` | temperate |
| **B6** | 4 `DEPOSEMP` pushables (not in the repo yet) | `vehicles/aircraft/fuel_bowser_grey` (existing) | temperate |
| M19 | none (the suspected tank is a pillbox) | none | |

Variant resolution needs no mission-data changes:
- `fuel_tank_horizontal` resolves by theater and footprint aspect: a deck block when w/d < 1.6, a quay tank when
  the theater is coast/temperate and d ≥ 4, and the cradle tank otherwise.
- `horizontal_cradle` resolves to the cradle family.

## 10. Implementation plan

1. **Kit family `tools/blender/fuel/`.**
   - `scripts/fuel_tanks.py` builds every asset above: `outdir <asset> [intact|destroyed] [seed] [snow]`.
   - Shared helpers go in `ft.py`: shell with dished heads and seam strips, saddle and crib, trestle, catwalk with
     rail, caged ladder, gate valve, flame-arrestor vent, manhole, drums, petal-burst.
   - Write sidecars (`*.kit.json` footprints with kinds `tank`/`post`/`wall`/`building`, plus the named nodes
     `catwalk`, `ladder`, `valve`, `spout`, `blast_origin`).
   - Add the new signs to `kit/lib/decals.json` and the seam trim to `make_procedural.py`.
2. **Validate.**
   - Run `kit/tools/validate.py --budget 15000` and the contact check (no interpenetration).
   - Run the review renders: `kit/review/render.mjs <glb> --views game1,game2,close --theater snow|desert`, at pitch
     40°, yaw 15°, zoom 1 and 2, side by side with the §2 crops.
3. **Ship.** Run `consolidate/pack.py`, `textures.py`, `sidecars.py` and `build_manifest.py`. Map `fueltank` variants
   in `consolidate/catalogue.py` and `src/art/building-props.js`:
   - `horizontal_cradle` → `fuel_tank_h_cradle` (`_m` by partner side);
   - `fuel_tank_horizontal` → farm or quay by the §9 rule;
   - `fuel_tank_elevated` → `fuel_tank_elevated`;
   - `oil_tanks_vertical` → `oil_tank_column`/`_b` (also for type `barrels` with that variant).
4. **Procedural fallback.** Upgrade `props.js` `ROUND.fueltank` (Node/unit tests, library not loaded):
   - dished heads instead of hemispheres;
   - saddles at 0.2 L;
   - a crown catwalk strip, a vent and an end ladder box;
   - a vertical branch for `oil_tanks_vertical`/`fuel_tank_elevated`.
   It stays a single group under 1.5k tris.
5. **Hooks.**
   - fx `blast_origin` for `_structureBlast`.
   - M8: walkway removal on destruction.
   - M17: the `valve` node spins with each `fuel_valve` click, and the spill grows from `spout`.
   - `oil_pipe_run` is generated per cluster in `building-props`.
6. **Tests.** Every test must stay green: `node tests/unit/run.mjs` and `node tests/run.mjs` in the worktree.
   - Unit tests: variant resolution (§9 rule), mirror choice for the M2 pair, catalogue entries.
   - GPU tests:
     - the M2, M8 (feat/missions), M13 and M17 tanks load as library models;
     - footprint containment, so the model stays inside w × d with ≤ 0.3 m dressing;
     - clip audit clean;
     - destroyed swap.
7. **Review shots** at the default camera and at zoom 2 for each mission, intact and destroyed.

## 11. Open points

- **M2 layout.** The original lays the two tanks **side by side inside one bund, with one catwalk bridging them**.
  We keep feat/align's end-to-end layout. If the user prefers the original arrangement, feat/align would need to
  move `depot_b` to a 3.6 m side-by-side offset, and the cradle model already supports a bridging catwalk stub
  (as on the quay tank).
- **M13 count.** The original has three tanks. feat/missions places two, which read correctly as a row.
- **M12.** The tank is listed but not visible on our render, so confirm before modelling a desert cradle variant.
- **B6 pushable silhouette** (two-wheel trailer versus the existing four-wheel bowser) is the vehicles workflow's
  decision.

## 12. Status (built, feat/fuel-tanks)

Everything below is in the repo and rebuilds with `tools/blender/fueltanks/build_all.sh` (Blender 4.2, CPU AO bake,
about 6 minutes for all 24 assets, 4 jobs at a time). `ship.py` packs each LOD (AO as a 512/256/128 px JPEG,
gltfpack meshopt + quantisation, library textures by URI) into `assets/models/buildings/fuel/` and merges the entries
into the buildings manifest (group `fuel`, type `fueltank`; the snow and destroyed links are derived from the names).
Every build logs `BOUNDS` (a part outside the footprint + 0.3 m or above h) and, for the wrecks, `OVERLAP` lines
(BVH triangle overlaps between named part groups: deck/frame vs tanks, blown head vs bund/cribs/shell, petals vs
pipes...); all 24 builds end with `0 clashing pairs`. Wrecks build with a lower albedo floor (`DZ_AFLOOR` 0.022) and a
matte soot-black shell (`ft.BURNT_MAT`), so they read charred, not taupe.

| Type | Asset(s) | Notes |
|---|---|---|
| `horizontal_cradle` (M2) | `fuel_tank_h_cradle`, `_m`, `+_snow`, `+_destroyed(_snow)` | §5.1. The mirror is picked at runtime: the nearest fueltank on the tank's local +X side → `_m`, so the stands sit on the outer ends of the depot pair (`depot_a` = `_m`, `depot_b` = plain). Inside 9 × 3.4 × 3.5 with ≤ 0.3 m dressing (stile 0.2 m, drifts 0.25 m; top 3.49). Snow caps are a curvature-following drape with a wandering, thinning rim tinted toward the paint. |
| `fuel_tank_horizontal`, deck block (M8) | `fuel_tank_farm_9x7`, `fuel_tank_farm_85x63` (+ `_destroyed`) | §5.2 (twin fat maroon tanks under the deck, ladder at the mission ladder's x). The grating is the alpha-cutout `fuel_grating`. The mission walkway gets no plank deck from `map-builder` (the model has its own grating). On destruction the walkway goes (see below). |
| `fuel_tank_horizontal`, quay (M13) | `fuel_tank_quay_12`, `fuel_tank_quay_11` (+ `_destroyed`) | Coast (also temperate). The ladder has no cage (it would overhang the end by 0.6 m). |
| `oil_tanks_vertical` (M11) | `oil_tank_column`, `oil_tank_column_b` (+ `_destroyed`) + the procedural pipe run | Only for a column footprint (round, or h ≥ 5): M8's `drums_w1/w2` (`barrels`, w × d, h 2.2) stay drum piles and get the barrel blast. M11's quarry pair (explosive `barrels`) is built by `map-builder` as the library column with a HIGH r 1.75 footprint, cannot be carried, and leaves its wreck when it bursts. |
| `fuel_tank_elevated` (M17) | `fuel_tank_elevated` (+ `_destroyed`) | glTF node `valve`; sidecar anchors `valve` and `spout` (tip 0.48 m from the mission's VALVE). |
| round `fueltank`, no variant | `fuel_tank_vertical_t` (+ `_destroyed`) | Temperate squat vertical tank; the sandbox depot (`m00`, r 2). Desert round tanks get `oil_tank_column`. |
| `fuel_tank_pushable` (B6) | — | Reuses the vehicle library's `fuel_bowser_*`, as §5.6 says. |

Resolution lives in `src/art/fuel-tanks.js` (`fuelTankAsset`, `isColumnFootprint`), called by `building-props.js`
before the generic variant choice, so missions need no data changes. Every type also has a procedural fallback in
`props.js` for node tests and `?buildings=0`.

**Destruction (§7, wired).**
- `Interactable._applyDestroyedState` keeps a fuel structure's footprint blocked (`fuelWreckNav`: HIGH when 0.6 h ≥ 1.5 m)
  instead of clearing it, so reacting guards walk around the wreck, never onto it.
- A walkable deck over the footprint (M8's mission walkways, M17's library grating: any cells standing > 1 m above the
  surrounding ground) falls: its cells drop to the ground and join the wreck's footprint (M8: LOW over the collapsed
  −X/+Z quarter, HIGH elsewhere), every ladder link ending on it is disabled, and anyone standing on it dies with it.
- `fx.js` `_structureBlast` now reads the mission def from the interactable (`params.structure`; before, every fuel
  tank fell through to the generic `burning_wreck`, whose wind-bent flame sprites drew the orange comet streaks). It
  spawns `fuel_tank_blast`: the big explosion, three fireballs bursting along the shell, few short sparks, then
  `fuel_tank_fire`: short upright flame tongues (little wind lean) from the rupture and the pool ring, wide hot flame
  sheets low in the fire, embers, the black smoke column and the fire light, all scaled by `fuelBlastScale`; the
  lingering smoke column follows when it burns out.

**Hooks (§10.5).**
- M8 walkway removal: above.
- M17 (`src/art/fuel-hooks.js`): every `device` event within 1.5 m of the spout (the `fuel_valve` set-piece's valve
  device) turns the handwheel a third of a turn; from the third use the spout pours (stream + spreading pool). The
  set-piece's placeholder post at VALVE is hidden; the pour stops when the wreck swaps in.
- M11 pipe runs: `src/art/fuel-pipes.js` (§5.4).

Sizes (triangles LOD0/1/2 · shipped KB LOD0/1/2; 11.2 MB for all 72 files). Loading M2 costs about 2.3 MB (two snow
tanks and their two snow wrecks, all LODs); its two tanks add about 1 ms of GPU time and 62k triangles at zoom 1.

| Asset | Tris | KB |
|---|---|---|
| `fuel_tank_elevated` | 6134/3139/1859 | 231/126/73 |
| `fuel_tank_elevated_destroyed` | 5882/3027/1841 | 217/118/70 |
| `fuel_tank_farm_85x63` | 11430/6727/2530 | 346/239/113 |
| `fuel_tank_farm_85x63_destroyed` | 13936/7528/3071 | 389/261/133 |
| `fuel_tank_farm_9x7` | 11482/6746/2565 | 348/241/116 |
| `fuel_tank_farm_9x7_destroyed` | 14032/7569/3084 | 392/263/134 |
| `fuel_tank_h_cradle` | 7428/3727/1616 | 265/147/71 |
| `fuel_tank_h_cradle_destroyed` | 7446/3607/1640 | 243/139/75 |
| `fuel_tank_h_cradle_destroyed_snow` | 7752/3837/1541 | 254/145/73 |
| `fuel_tank_h_cradle_m` | 7428/3727/1616 | 265/148/72 |
| `fuel_tank_h_cradle_m_destroyed` | 7462/3621/1644 | 245/140/76 |
| `fuel_tank_h_cradle_m_destroyed_snow` | 7768/3851/1545 | 254/146/74 |
| `fuel_tank_h_cradle_m_snow` | 10396/6639/3056 | 340/219/109 |
| `fuel_tank_h_cradle_snow` | 10396/6639/3057 | 341/219/108 |
| `fuel_tank_quay_11` | 7598/4713/2605 | 258/170/103 |
| `fuel_tank_quay_11_destroyed` | 8600/4623/2330 | 263/165/96 |
| `fuel_tank_quay_12` | 7690/4833/2701 | 261/173/105 |
| `fuel_tank_quay_12_destroyed` | 8632/4692/2369 | 263/166/97 |
| `fuel_tank_vertical_t` | 2880/1381/402 | 137/74/32 |
| `fuel_tank_vertical_t_destroyed` | 2298/1127/378 | 106/57/25 |
| `oil_tank_column` | 2954/1422/602 | 132/73/34 |
| `oil_tank_column_b` | 3664/1822/868 | 157/84/40 |
| `oil_tank_column_b_destroyed` | 2758/1344/490 | 118/62/28 |
| `oil_tank_column_destroyed` | 2510/1107/514 | 108/55/29 |

Tests:
- `tests/unit/fuel-tanks.test.mjs`: variant map, M2 footprints and mirror choice, 1:1 fit, manifest entries, budgets,
  fallback, blast scale, M8 drum dumps stay generic, wreck footprint + M8 deck drop (elev, LOW quarter, ladder, the
  man on it), M11 pipe-run pairs, the dev tank yard builds (decks raised, columns and quarry columns block).
- `tests/fuel-tanks.test.mjs` (GPU): M2 loads the mirrored snow tanks inside 9 × 3.4 × 3.5 (+0.3), frame budget;
  depot_b goes to the Sapper's time bomb and depot_a to a shot drum (not `destroy()`), both wrecks inside the
  footprint + 0.5 m, fire + smoke, footprints still HIGH, no guard on a wreck after 25 s of reaction, the static clip
  audit after the blast finds nothing new around the depots, objective done.
- `tests/fuel-tanks-yard-{desert,coast,temperate}.test.mjs` (GPU) load `src/missions/dev/tank-yard.js`, the M8/M11/
  M13/M17 tank defs of feat/missions copied into one dev map: assets per structure, containment, 3 pipe runs, the M8
  deck walkable with a guard on it; then the bomb at tank_b (wreck, deck down, guard dead, ladder off), a shot quarry
  column, the quay pair, and the M17 valve (spout ≤ 0.5 m from VALVE, wheel turns, pour) and its wreck.

Screenshots (default camera, pitch 40°, yaw 15°): `docs/screenshots/tanks-m02-before-after-z1.jpg`, `-z2.jpg`,
`tanks-m02-destroyed.jpg`, `tanks-m08-before-after.jpg`, `tanks-m11-before-after.jpg`, `tanks-m13-before-after.jpg`,
`tanks-m17-before-after.jpg` (zoom 1 above, zoom 2 below), and the studio sheets `tanks-studio-snow.jpg`,
`tanks-studio-desert.jpg`, `tanks-studio-destroyed.jpg` (kit review renderer, zoom 1).
