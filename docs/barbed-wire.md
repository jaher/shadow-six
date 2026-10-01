# Barbed wire — look spec, usage inventory, LOD / AA / perf plan

Owner: ART (branch `feat/barbed-wire`). User brief: *"Make barbed wire look awesome wherever you add it."*
Also in scope, because the user cares about them: extreme realism, wind on everything (`world.wind`,
`src/world/wind.js`), snow in winter theaters, no object crossing another, and readability from the default
orthographic camera (pitch 40°, yaw 15°, zoom steps 0.5 / 1 / 2).

This document comes before any code. It covers:

- what real WWII wire looked like (§1);
- what wire did in BEL (§2);
- every place wire appears in the game today or will appear (§3);
- the look spec for each wire type (§4) and each theater (§5);
- how it renders without shimmer, the LOD and perf plan (§6–§7);
- the module layout and merge hooks (§8);
- the tests (§9).

---

## 1. Reference: WWII barbed wire

Reference images are in the session scratchpad at `wire/ref/` (11 images, ≤ 900 px, list in `SOURCES.txt`). All
come from Wikimedia Commons and are used for reference only; nothing is shipped.

| # | Commons file | What it shows |
|---|---|---|
| 01 | `Normandy beach obstacles 1944-06-09 1.jpg` | Czech hedgehogs with tangled wire debris, Normandy, 9 June 1944 |
| 02 | `Double apron.png` | Double-apron fence diagram: line pickets, apron wires, diagonal guys |
| 03 | `Barbed Wire Screw Picket, Strete Gate.jpg` | A WWII corkscrew picket with its eyes, still standing in a Devon hedge |
| 04 | `Barbed wire in Monaco.jpg` | Concertina on a wall top, back-lit; shows silhouette readability |
| 05 | `An old barbed wire.jpg` | Rusted strand close-up: orange rust on the barbs, grey zinc left on the line wire |
| 06 | `2005-02-21 Barbed wire with snow and ice.jpg` | Snow clumps on top of a two-strand twist, bigger clumps at the barbs |
| 07 | `Tytärsaari, Espanjalaisia ratsastajia … SAKuva-108797.jpg` | WWII knife rests (*espanjalainen ratsastaja*, "Spanish rider") along a beach |
| 08 | `Ruuskeri, Ruuskerin piikkilankaesteitä, SAKuva-162015.jpg` | WWII coastal wire obstacle on crossed-stake frames |
| 09 | `Auschwitz II - electric fence 01.jpg` | Concrete post with a porcelain insulator carrying one barbed strand (construction reference) |
| 10 | `I09 713 Stacheldrahthindernis.jpg` | Corkscrew pickets with low wire in a forest (a remnant) |
| 11 | `The British Army in North Africa and the Middle East 1942 E11645.jpg` | Concertina coils on desert sand (IWM) |

### 1.1 The wire

The values below are typical, gathered from Wikipedia (*Barbed wire*, *Concertina wire*, *Wire obstacle*, *Screw
picket*, *Cheval de frise*, *Barbed tape*), period field manuals as summarised there, and the reference photos.

- **Line wire.** Two strands of about 2.5 mm (12½ gauge) steel twisted together. The twist lay is about 6–10 cm,
  and the strand is about 5 mm across. German *Stacheldraht* was the same in principle; much of it was
  black-annealed (not galvanised) and rusted quickly.
- **Barbs.** Two kinds:
  - **2-point:** one short wire wrapped round the strand, with two points.
  - **4-point:** two wires, four points in a cross.

  Barbs sit every **10–15 cm** (military wire was denser than farm wire, which is spaced 10–12 cm). The barb wire
  is 1.6–2.0 mm, a point sticks out **12–18 mm**, and a barb is **25–35 mm** tip to tip. The wrap makes a visible
  knot about 1 cm long that is thicker than the strand.
- **High-tensile / "reinforced" wire.** Oil-tempered wire from WW1 on, and Dannert concertina steel. Harder to
  cut; this is BEL's "reinforced" wire (§2). It is springier: when cut it curls hard.
- **Tension and sag.**
  - Fence strands are stretched taut: sag is 1–3 cm over a 3 m span.
  - Entanglement and apron wire is looser: 5–15 cm.
  - Concertina keeps its shape on its own and needs no posts.

### 1.2 Colour and weathering (linear-ish sRGB references for the material pass)

| State | Look | Albedo (sRGB) | Rough / metal |
|---|---|---|---|
| Fresh galvanised | Matte light grey with faint zinc spangle; little specular | `#8c8f90` | 0.55 / 0.9 |
| Weathered zinc | Darker grey, white-grey zinc oxide bloom | `#62666a` | 0.7 / 0.7 |
| Black annealed (German) | Blue-black, already rusting at the barbs | `#2f2d2b` → rust | 0.6 / 0.8 |
| Rusted (≥ 1 winter outdoors) | Orange-brown, darkest in the barb wraps and twist grooves; barbs rust first | `#7a3f20` / `#9a5a2e` | 0.85 / 0.3 |
| Sun-bleached desert | Dust-coated light rust with pale ochre dust in the grooves | `#9a7d5e` | 0.9 / 0.25 |
| Coastal / wet | Wet dark brown-black with salt-white crust at the barbs; a sharp specular line when wet | `#3a2a20` + `#d8d4c8` | 0.35 wet / 0.6 |

Rust is not uniform:
- **Along a strand:** it varies on a ~0.5–2 m scale, so a value-noise mask along the arc length.
- **Within a strand:** it is concentrated at barbs and twist grooves, so a per-barb mask.

**Posts.**
- Timber: grey weathered softwood `#7a7268`, bark-on dark `#4a3f35`, or tarred `#2a2622`.
- Angle-iron: rust `#6a3a22` or field-grey paint `#5d6152` worn to rust at the edges.
- Concrete: `#9a978e`.

### 1.3 Pickets and posts

| Post | Look | Size | Use |
|---|---|---|---|
| Wooden stake | Round 8–12 cm, sharpened top or sawn flat, bark on or peeled, often crooked by ±3–5° | 1.2–1.8 m tall | Field fences, aprons, knife rests |
| Angle-iron picket | L-section 40–50 mm, punched eyes or welded loops every ~15–20 cm, spade foot | Long 1.5–1.8 m; short anchor 0.6 m | Standard Allied/German issue |
| Corkscrew / screw picket ("pigtail", *queue de cochon*) | Round 16–20 mm bar, 3–5 closed eyes up the shaft, corkscrew bottom; screwed in silently | Long 1.2–1.5 m; anchor 0.6 m | Night wiring parties; WW1–WW2 |
| Camp / perimeter post | Square timber 12–15 cm, or concrete, often with an outward overhang arm (30–45°) carrying 3–5 strands; electric fences use concrete "gooseneck" posts | 2.4–3.2 m | Camps, depots, prison pens |

- **Spans:** 2.5–3.0 m for military fences; 2.5 m for the field placeholder; 3 m for camp fences.
- **Strands:** 3–5 for a field fence; 8–12 for a camp fence, spaced 15–25 cm, closer near the ground.

### 1.4 Obstacle types

- **Simple fence.** 3–5 strands at about 0.3 / 0.6 / 0.9 / 1.2 (/ 1.5) m. Strands are stapled or tied to the post
  face on the enemy side.
- **Double-apron fence.** The standard field obstacle.
  - A centre line of long pickets every **3 m**, about **1.0–1.2 m** high.
  - On both sides, anchor pickets **4.5 m** out, linked by diagonal guy wires.
  - Apron wires run along each slope, about 4 per side.
  - Seen from above it reads as a low ridge of crossing lines about 9 m wide. The German *Flandernzaun* ("Flanders
    fence") is the heavier variant: two fences 1.5–2 m apart, filled with criss-cross wire.
- **Low wire entanglement.** Irregular stakes, only about **15 cm** showing, with wire wound taut between them. It
  is nearly invisible: a trip obstacle.
- **Concertina (Dannert wire; German *S-Rolle*).** Coils about **0.75–1.0 m** across, clipped together at 3–5
  points per loop.
  - A roll stretches to about **15 m** with 50–60 loops, so loop pitch is about **0.25–0.3 m**.
  - **Triple concertina:** two coils side by side and one on top, about 1.5 m high.
  - The coils sit on the ground; they may be pinned by short pickets and topped by one taut strand.
- **Knife rest (cheval de frise; German *Spanischer Reiter*).**
  - A central beam 3–4 m long on X-trestles about 1.2 m high at each end, sometimes with a middle X.
  - It is wound with barbed wire: strands run end to end on the crossing arms, and a spiral or zig-zag runs
    round the frame.
  - Timber (field-made) or angle-iron. It is portable and closes road gaps.
- **Czech hedgehogs with wire.** Wire wrapped round the arms of each hedgehog and threaded hedgehog to hedgehog in
  belts (M10, M14, M16, M18). Beach belts are tangled and sagging (ref 01).
- **Wall coping.** One of two forms:
  - **Brackets:** angle-iron L or Y brackets bolted to the wall or palisade top, leaning **30–45° outward** (Y
    brackets lean both ways), carrying 3–4 strands.
  - **Concertina** laid along the coping (ref 04).
- **Cages and pens.** Posts every 2.5–3 m, 2.4–3 m high:
  - either dense strands every 15 cm, or wire mesh with 3 barbed strands on top;
  - an inward overhang (prison);
  - a timber-framed gate wrapped in wire.
- **Electric fence.**
  - Concrete or timber posts with **white porcelain insulators** (bobbin or pin type), one per strand per post.
  - Strands every 15–25 cm; often a second fence on the inside.
  - Enamel warning plates: *Vorsicht! Hochspannung — Lebensgefahr*.
  - M3 is electrified chain-link (§3) with strands over it.
- **Chain-link.**
  - Diamond mesh of about 50–60 mm in 2.5–3 mm galvanised wire.
  - Pipe or angle posts every 3 m, with a top rail or tension wire.
  - Usually 3 barbed strands on outward arms above the mesh.

### 1.5 Cut wire

- A cut strand **springs back** from the cut. Each end curls into a loose helix: 2–4 turns of about 0.2–0.5 m
  diameter for high-tensile wire, a lazy S for soft wire.
- The end hangs from the nearest post eye or droops to the ground.
- The cut tip is bright steel for a few mm.
- A cut double-apron or concertina opens a **gap**:
  - the coil ends are pulled aside and pinned back, or left as two springy tangles;
  - remaining loops sag to the ground.
- At the 1.5 m sapper gap (§2) every strand crossing the gap must be cut. The visual is two curled ends per strand,
  and no wire left inside the passable cells.

### 1.6 Wire in wind and weather

| Case | Wind response |
|---|---|
| Taut strands | Barely move: amplitude a few mm with a slow, low phase; a sway weight of about 0.15 |
| Slack aprons, entanglement | Up to 1–2 cm |
| Cut ends | Whip and swing: sway weight 1, pinned at the post |
| Concertina | Rocks very slightly |
| Snow clumps, hanging debris (rags, a scrap of paper on M14) | Move more than the wire |

- **Snow:** rime and clumps sit on the **top** of strands and in the barbs (ref 06). Snow builds up at the post
  tops, in the knots and on the windward side.
- **Ice:** icicle beads under the strands after thaw-freeze (ultra quality only).
- **Rain or coast:** wet darkening with a thin specular highlight line along the top of the wire.

---

## 2. Wire in BEL (gameplay that the look must support)

- **Cutters (W).** Only the **Sapper** carries them (`items.js` ROLE_ITEMS: `wireCutters: ['sapper']`). In the BEL
  campaign they are in the loadout of **M3 only** (research.md loadout table). The sandbox `m00` also has them, and
  BCD B6 has `AuAlicate`.
- **Everywhere else wire is scenery that blocks movement.** `B.FENCE` cells are see-through, and units cannot cross
  them (M8: *"see-through, uncrossable; no cutters in this mission"*). The look has to say two things at a glance:
  you cannot walk through this, and you can see and shoot through it.
- **Cutting.** `src/abilities/sapper.js` and design-spec §3.3:
  - The Sapper kneels for 3.0 s (`cut_wire` clip, the `wire_cutters` hand prop).
  - The `B.FENCE` cells in a **1.5 m** gap become passable.
  - Spec: *"A hole mesh swaps in."* **Not implemented:** no visual changes today.
  - The event `structure:destroyed {type:'fence-gap', id, owner}` carries no position, so the wire module needs
    `x, z` (and ideally the run tangent) added to that emit. This is a one-line hook in `sapper.js`.
- **Reinforced wire** (`def.reinforced`). BEL's German *reinforced barbed wire*; the cutters are useless on it.
  - It must **look different** from cuttable wire: heavier concertina or high-tensile coils, denser barbs, dark
    blued steel.
  - The player should be able to tell it apart before trying. BEL only told you through the "no" cursor.
- **Electric fence** (M3 `st_fence`, `variant:'electric'`). It is powered until `fence_switch` is thrown
  (`world.fencePower`).
  - Cutting it while live: 20 damage (`ELECTRICO`), the `electric_zap` sound, the cut fails.
  - BEL had **electric-fence sparks** (`.CHISPAS` on `CABLES` and the M3 transformer station) and an
    `ELECTRO` hum.
  - The look must change with power: insulator glints and sparks, and a heat shimmer is **not** wanted. When the
    power goes off (`APAGELEC`), the sparks stop and the transformer cage lamps go dark.
- **Vehicles.** Tanks and trucks are stopped or blocked by `B.FENCE` (feat/gate-smash owns ramming). A future hook
  is a tank flattening a wire run: posts lean, strands drop to the ground, concertina gets crushed flat.
- **Map / notebook.** BEL's hand-drawn mission sketch shows wire as **"XXXX"**. Any minimap or sketch layer should
  keep that glyph.

---

## 3. Usage inventory

Every wire instance today renders through one of three code paths. Each is either a placeholder or wrong:

1. **`src/art/props.js` `buildLinear` → `type:'fence'`** (every variant). Posts are 0.1 m `woodDark` boxes every
   ~2.5 m, with **three 3 cm square box "wires"** at y 0.5 / 1.2 / 1.9 m that ignore `h`.
   - These are the "3 thin dark lines" in the vehint shots.
   - There are no barbs, no sag, no wind, no snow, no theater weathering.
   - The boxes are subpixel at zoom 0.5–1, so they shimmer under SMAA/FXAA.
2. **`src/art/dressing.js` `buildWall` palisade, `variant` matching `/wire/`** (M2 `camp_wall` `palisade_wire`).
   Two 12 mm 4-sided cylinders at `h + 0.12` and `h + 0.32`, the full segment length, in the **`logsTarred`
   material**.
   - They have wind sway (`swayWeights`), but **no supports**: they float in the air.
   - Stakes are randomised to `0.93–1.05 h`, so at `h = 3` a stake can reach 3.15 m. The strand at `h + 0.12`
     (3.12 m) **passes through the tallest stakes**, which breaks the no-crossing rule.
3. **`src/art/furniture/street-props.js` `fenceParts` variant `wire`** (only `dev/pavement-gallery`): 3 strands at
   0.35 / 0.7 / 1.05 m, 4 mm catenary tubes with `aSway`. This is the cleanest of the three but has no barbs.

The cutter target stays the grid (`B.FENCE` cells). Footprints are not changed by this work.

### 3.1 master (M0–M3, b00)

| Mission | Theater | Structure | Today | Should be | Length |
|---|---|---|---|---|---|
| m00 sandbox | temperate | `fence` (no variant), h 2.2 | props.js placeholder | `field_fence`, 5 strands, timber stakes; **cuttable demo** | 22 m |
| m00_bcd sandbox (b00) | temperate | `fence` ostrich pen | placeholder | **Not barbed:** zoo paddock rail or mesh fence (keep it out of the wire module; only shares the strand renderer if it uses plain wire) | 40 m |
| M1 Baptism of Fire | snow | none | — | No wire in the BEL M1 layout. Optional dressing only: a low entanglement by the MG nest, *only if the spec's layout allows it* (not a blocker) | — |
| M2 A Quiet Blow-up | snow | `wall` `palisade_wire` `camp_wall`, h 3.0 | floating strands, tarred material, crossing stakes | **Palisade coping:** outward-leaning (35°) iron brackets nailed to every ~3rd stake top, 3 strands, snow-capped, rust under the snow | 142 m |
| M2 | snow | `wall` `palisade` `sw_wall` | — | No wire (BEL: the plain settlement palisade) | — |
| M3 Reverse Engineering | snow | `fence` `electric` `st_fence`, h 2.5, `cuttable`, powered | placeholder (3 strands, no mesh) | **Electrified chain-link:** galvanised mesh on pipe posts, outward arms with 3 barbed strands on porcelain insulators; sparks and hum while powered; enamel warning plates every ~30 m. Spec §7.6: chain-link | 240 m |
| M3 | snow | `gate` `chainlink` `gate_w` | box | Chain-link gate frame with a diagonal brace and a barbed top (matches `st_fence`) | 4 m opening |
| M3 | snow | `fence` `square` ×12 `cage_1..12`, h 2.2, `sparks:true` | placeholder; `sparks` flag **not rendered** | **Transformer cage:** chain-link 5×5 m, barbed top, warning plate, lockable gate, insulators on the transformer bushings; random spark bursts on the cage wire (fx `sparks`, a few per minute per cage while powered) | 12 × 20 m |

### 3.2 feat/missions (read-only here; M4–M20)

None of these variants has a renderer: all fall back to the props.js placeholder (or to `props-extra.js` for
`prison_pen`). Lengths are per mission, measured from the mission defs on `feat/missions` @ `c26b73d`.

| Mission | Theater | Variant(s) and ids | Look target | Length |
|---|---|---|---|---|
| M4 Restore Pride | snow | `fence` `wire_on_stakes` `wire`, h 1.4, w 0.6. The spec calls it *"knife-rests with barbed wire"* | **Knife-rest line**: timber X-trestle knife rests, 3.5 m each, butted end to end and wired together; snow on the beams | 33 m |
| M6 Menace of the Leopold | temperate (Norway in winter) | `fence` `barbed_wire` ×4 (`wire_n`, `wire_ne`, `wire_se`, `wire_bar`), h 1.2, with hedgehogs beside them | **Double-apron fence**, angle-iron pickets. `wire_bar` is a road barricade: knife rest + hedgehogs | 69 m |
| M7 Chase of the Wolves | snow | `wall` `wall_stone_zigzag` ×7, *"fieldstone wall with a barbed-wire coping (not climbable)"* | **Wall coping:** Y brackets on the stone cap, 4 strands, snow | 250 m |
| M8 Pyrotechnics | desert | `fence` `wire_on_stakes` ×6 (`wire_n/e/s/w`, `wire_wadi_w`, `wire_gun` "concertina on the rim"), h 1.2 | **Double-apron** on angle pickets (rim lines); `wire_gun` **single concertina**; sun-bleached and dusty | 213 m |
| M9 A Courtesy Call | desert | `wall` `mudbrick_wire` ×10; `fence` `mesh_iron` ×5; `gate` `mesh_iron(_roofed)` | Adobe wall with **concertina laid on the coping** (one coil, pinned); `mesh_iron` = welded mesh panels on iron posts with a barbed top | 257 m + 75 m |
| M10 Operation Icarus | desert | `fence` `wire_on_stakes` ×6 belts (`belt_rim_w/e`, `belt_w1/w2/e1/e2`). The code comment says *"a hedgehog on the wire every ~4.5 m is drawn by the belt mesh"*: **not implemented**. Also `wall` `wall_mudbrick_wire` ×2, `fence` `prisoner_cage` (McRae's jail), `fence_chainlink` ×6, gate `jail_door_mesh` | **Wire belt:** double-apron with hedgehogs every ~4.5 m tied in; mudbrick coping concertina; **prisoner cage** (§4.8); chain-link with a barbed top | 356 + 91 + 55 + 162 m (**the largest mission**) |
| M11 In the Soup | desert | `fence` `concertina_hedgehog` `wire_sw`, h 1.5 | **Triple concertina** (2 + 1) with hedgehogs every ~6 m | 45 m |
| M14 D-Day Kick-off | coast | `fence` `barbed_wire_hedgehog` ×14 belts, h 1.2, plus tetrahedra and dragon's teeth | **Beach wire:** hedgehog-and-wire belts with sagging, tangled strands (ref 01), wet dark rust with salt crust, sand drifted round the feet, some strands half buried | 170 m |
| M15 The End of the Butcher | temperate | `fence` `knife_rest_wood` `knife_rests`, h 1.2, w 0.8 | **Knife rests** (timber), one row across the street; urban, grey | 4 m |
| M16 Stop Wildfire / M18 The Force of Circumstance | temperate (Belgium) | `fence` `czech_hedgehog_wire` belts ×4, h 1.4, w 1.2 | **Hedgehog belt:** hedgehogs every ~3.5 m, 3 sagging strands threaded through, a low concertina at the foot | 73 m each |
| M17 Before Dawn | temperate (Alsace) | `prison_pen` `wire_cage` `pen` 17 × 17.2 × 2.4 (gate S, open N); `well` `water_tank_caged`; `wall` `stockade_prison_brick_railing` | **Prison wire cage:** square timber posts at 3 m, dense strands every 15 cm, an inward overhang with 3 strands, a wired timber gate; tank cage in mesh | 68 m |
| M19, M20 | temperate | plank palisades, bullet stops | No wire, except optionally a coping on `palisade_plank` (V2 base) if a later spec pass asks for it | — |
| M5, M12, M13 | — | none | — | — |

### 3.3 Planned or other (building-inventory.md and BCD)

| Item | Where | Notes |
|---|---|---|
| `wire_on_stakes`, `czech_hedgehog` | building-inventory §1.3 | Covered above |
| `fence_chainlink` | M3, M8, M9, M10 | Chain-link renderer shared with the electric fence |
| `prisoner_cage` | M10 | Mesh cage |
| `stockade_prison` | M17, B7 | B7: **double barbed-wire fence** with named gates N1/N2, S1/S2, E1/E2 |
| `double_wire_fence` | B7 | Inner and outer camp fences 4–6 m apart, watchtowers (the BCD prison camp) |
| `fence_concrete_post` | B5 | Concrete posts with wire, gatehouse, barrier |
| `transformer_cage`, `electric_fence_switch` | M3 | §3.1 |
| Library asset `stockade_fence(_snow/_desert)` | `assets/models/buildings/military/` | 12 m modular kit (`wire_fence` footprint kind, `steel_galv` material, a floodlight anchor). **Used by no mission.** Keep as an option for the B7 camp; the procedural wire must match its strand look |

---

## 4. Look spec per wire type

All types share one **strand** primitive and one **barb** primitive (§6). A type is a recipe of:

- posts or frames (instanced);
- strand paths (polylines through post eyes, with catenary sag);
- coils (helix paths);
- extras (insulators, plates, clips, hedgehogs).

Variant strings from the missions resolve to a type through one alias table in `src/art/wire-obstacles.js`:

| Type id | Mission variants that map to it |
|---|---|
| `field_fence` | `fence` with no variant, `wire`, `barbed_wire` (when `h ≥ 1.6`) |
| `double_apron` | `barbed_wire` (h < 1.6), `wire_on_stakes` (default) |
| `knife_rest` | `knife_rest_wood`, `wire_on_stakes` with `width ≥ 0.6` and an M4-style def (`knifeRest:true` hint preferred) |
| `concertina` | `concertina`, `wire_gun` |
| `triple_concertina` | `concertina_hedgehog` (+ hedgehogs) |
| `hedgehog_belt` | `barbed_wire_hedgehog`, `czech_hedgehog_wire`, M10 belts (`hedgehogEvery: 4.5`) |
| `coping_bracket` | `palisade_wire`, `wall_stone_zigzag` |
| `coping_concertina` | `mudbrick_wire`, `wall_mudbrick_wire` |
| `chainlink` | `fence_chainlink`, `chainlink`, `electric` (+ `electric:true`), `square` (cage), `mesh_iron` |
| `cage` | `prisoner_cage`, `wire_cage` |
| `low_entanglement` | (dressing only) |

Mission defs stay untouched. Where the mapping is ambiguous (the M4 knife rests), we add an optional hint field
(`wire: 'knife_rest'`). That is a one-word change on `feat/missions`, made by that branch's owner.

### 4.1 Strand (all types)

**Geometry:** two twisted 2.5 mm wires. The twist is not modelled. The shader paints it as a diagonal stripe
pattern with a pitch of 8 cm, which tells the eye "twisted" at zoom 2.

**Barbs:** 4-point every 12 cm (±1.5 cm jitter), 2-point on farm wire (`field_fence` in villages).
- Each barb is a 1 cm knot plus 4 points 15 mm long, angled ±35° off the strand and spread round it at
  ~90° steps with a random roll.
- Reinforced or concertina wire: barbs every 7.5 cm (BEL "reinforced" reads denser and darker).

**Sag:** catenary between fixings.

| Wire | Sag over 3 m |
|---|---|
| Fence | 1.5 cm |
| Apron / guys | 4 cm |
| Belt / entanglement | 8–15 cm, randomised per span |
| Beach belts (M14) | Up to 30 cm, with some spans touching the sand |

**Fixings:**
- On the **enemy-facing** post face (`outside` side of the run; default left of travel, overridable).
- Wrapped once round the post: a small 1.5 cm torus band at each fixing, zoom 2 only.

### 4.2 `field_fence`

- **Posts:** timber stakes 9–12 cm round, 2.5–3 m apart, ±4° lean jitter, sawn tops; spade-foot angle-iron in
  military areas.
- **Strands:** 4 strands for `h ≤ 1.4`, else 5 + `round((h − 1.5)/0.25)`, spaced evenly from 0.15 m to `h − 0.05`.
- **Corners:** a corner post (14 cm) with a diagonal brace.
- **Run ends:** a strainer post with a brace.

### 4.3 `double_apron`

- **Centre pickets:** angle-iron, every 3 m, height `h` (BEL defs: 1.2–1.4).
- **Anchor pickets:** short, 0.6 m, at ±`apron` from the centre line. `apron` = min(2.0, max(0.6, `width`·2)) m:
  narrower than real, to fit the 0.6–1.2 m gameplay widths.
  - The visual may overhang the footprint by ≤ 0.5 m each side.
  - Placement must clear solids (§6.6).
- **Guys:** a diagonal guy from each centre picket top to its anchors.
- **Aprons:** 3 per side, parallel to the run.
- **Fence:** a 3-strand fence on the centre line, plus 1 trip wire 15 cm high on each apron.
- **From the game camera** it reads as a low tent ridge of fine lines, darker at the crest.

### 4.4 `concertina` / `triple_concertina` / reinforced

- **Coil:** 0.8 m across, loop pitch 0.28 m, helix with ±3 cm radial noise and ±5° loop tilt jitter. It sits on
  the terrain at every loop: each loop's lowest point is clamped to the ground height, so coils follow the ground.
- **Clips:** small dark clips where neighbouring loops touch (3 per loop).
- **Pickets:** a short corkscrew picket every 4.5 m, holding a loop down.
- **Triple:** two base coils 0.8 m apart, a third on top, tied with taut strands. Height ≈ 1.45 m.
- **Reinforced (`reinforced:true`):**
  - dark blued-steel tint (`#2b2f36`), with a faint silver at the sharp edges;
  - barb density ×1.6;
  - the coil is drawn tighter (pitch 0.2 m);
  - it always reads as concertina, even when the type says fence: a coil is laid along the foot of the fence.

### 4.5 `knife_rest`

- **Unit:** 3.5 m beam (12 cm timber or 50 mm angle).
- **Trestles:** an X-trestle at each end, legs 1.4 m spread, top 1.2 m. Units butt end to end along the run with
  ±5° yaw jitter.
- **Wire:**
  - 6 strands end to end across the X arms;
  - a loose zig-zag between the arms, 1 wrap per 0.4 m;
  - a few loose loops hanging.
- **Steel versions:** angle-iron frames, rust.
- **Snow:** sits on beams and X crossings.

### 4.6 `hedgehog_belt`

- **Hedgehogs:** 3 crossed I-beams, 1.2–1.4 m, every `hedgehogEvery` (default 3.5 m; M10 4.5 m), ±0.4 m lateral
  and ±20° yaw jitter.
  - Uses the same mesh as the `czech_hedgehog` crate variant when that exists, so loose hedgehogs and belt
    hedgehogs match.
- **Wire:**
  - 3 sagging strands threaded through the arms at 0.3 / 0.7 / 1.1 m;
  - each hedgehog wrapped twice;
  - **M14 beach:** plus random tangles, i.e. 1–2 strand loops per span hanging to the sand.
- **Beach (coast theater):**
  - feet sunk 10–15 cm into the sand, using the terrain height, plus a sand-drift decal (optional);
  - salt crust on the barbs;
  - a wet sheen up to the tide line.

### 4.7 `coping_bracket` and `coping_concertina`

**Brackets:**
- angle-iron L brackets leaning **35° outward** (to the run's `outside`), 0.6 m long, on every 2.5–3 m;
- on a palisade: nailed to the nearest stake;
- on stone or adobe: bolted on top of the coping.

**Strands:**
- 3 strands at 0.2 / 0.4 / 0.6 m along the arm, plus one taut strand along the top of the wall;
- all fixings must be **above the tallest stake or coping in that span plus 4 cm** (this fixes the M2 crossing
  bug; §6.6);
- M7 wants Y brackets (both sides).

**`coping_concertina`:**
- one concertina coil laid along the wall top, pinned by short brackets every 3 m;
- coil diameter 0.6 m, so it does not overhang the wall width by more than 0.25 m each side.

**Snow:** caps sit on the bracket arms and on the coil tops (Norway).

### 4.8 `chainlink` (electric, cages, mesh)

**Mesh:**
- diamond 55 mm, 2.8 mm galvanised wire;
- rendered as **one textured quad per span**, not as wire geometry: a mip-mapped, alpha-coverage texture with a
  wire normal map, two-sided, double-weave edges;
- top tension wire, with the mesh bottom 3 cm above the ground following the terrain.

**Posts and arms:**
- pipe posts 60 mm every 3 m, braced at the corners;
- outward arms at 45° carrying **3 barbed strands**.

**Electric:**
- porcelain insulator bobbins on the arms and on 4 strands along the mesh face;
- enamel warning plate every ~30 m (yellow/black lightning, German text);
- a spark FX budget of about 1 burst / 3 s per 50 m of powered fence (random insulator), plus a faint blue arc
  glint at night;
- all of it off when `world.fencePower.get(id) === false`.

**Cages (`square`, `cage`):**
- 2.2–3 m high, gate on one face (`gateSide`);
- prison cages: a 3-strand **inward** overhang and square timber posts (M17), dense strands every 15 cm on M17
  `wire_cage`;
- M3 transformer cages: chain-link with a barbed top.

### 4.9 Cut state (sapper gap)

**On `fence-gap`:**
- the visual removes every strand and mesh section inside the 1.5 m gap;
- each cut strand end becomes a **curled tail**: a helix of 1.5–3 turns, 0.25–0.45 m across, decaying, ends
  drooping 20–40 cm. It sways (weight 1).

**Mesh:**
- the cut edges peel back as two flaps (a quad with a bend), with bright cut tips;
- concertina: the loops in the gap are pushed apart and sag flat.

**Persistence:** saved through the existing fence-cell save, since the gap is re-derived from the grid cells on
load; no new save fields.

> Load path: `save.js` restores `grid` (`w.grid.deserialize`). After a load, the wire module re-derives cut gaps by
> scanning each wire run's footprint cells for `B.FENCE` → `B.NONE` and applies §4.9 to those runs. The save format
> does not change.

---

## 5. Theater looks

Each structure takes a weathering preset from the mission `theater`. A structure may override it with
`wireLook: 'fresh'|'rusty'|…`.

| Theater (missions) | Wire | Posts | Extra |
|---|---|---|---|
| **snow** (M1–M5, M7; M6 is labelled temperate but is a Norway winter map, so it gets snow when `snowCover > 0`) | Weathered zinc to rusty: about 40 % of strand length rusty, more at the barbs | Grey timber, tarred palisade stakes | **Snow on the wire:** a white rim on the top half of each strand (world-up mask in the shader, ~60 % coverage, broken by noise every 5–20 cm); clumps (instanced tiny lumps, 1–3 cm) at ~30 % of barbs and on every post top, bracket arm, knife-rest beam and coil crest; rime on the windward side (`world.wind` mean direction). **Driven by the same `PROP_SNOW.uSnowAmt` uniform** as `coverPropsWithSnow`, so a snow-amount change updates it. Icicles under strands (ultra) |
| **desert** (M8–M12) | Dark rusted steel `#45403a` / `#56341c` with ochre dust in the twist grooves and on the upper surfaces (the first pale `#9a7d5e` camouflaged coils on the sand; reference 11 shows them as dark silhouettes) | Bleached grey timber, rusted angle-iron | Sand piled 5–10 cm at the posts and concertina feet; low specular; heat makes no change |
| **coast** (M13–M14) | Wet dark brown-black rust with salt-white crust at the barbs and twists; a sharp specular line on top | Dark wet timber, rust-streaked steel | Below the tide line: wetness 1, a little weed (green-brown strands on hedgehog feet); sand burial of belt feet |
| **temperate** (M6, M15–M20, BCD) | Mixed: weathered zinc with 20 % rust patches; fresh galvanised in M17's camp (well kept) | Grey timber, field-grey painted angle-iron | Rain-wet when the mission has rain (wetness uniform shared with the terrain if present) |
| **night** (any theater with the night rig) | No change to the material; readability comes from §6.4 | — | Electric fences: faint insulator glints; sparks are bright additive |

---

## 6. Rendering plan

### 6.1 Screen-space numbers (why ordinary meshes fail)

- The game renders **40 px per metre at zoom 1** at a 1080p reference (`CONFIG.camera.pxPerMeterAt1x`). Zoom
  steps are 0.5 / 1 / 2, so 20 / 40 / 80 px/m. Quality pixel ratio is 1–2.
- What the wire elements measure on screen:

  | Element | Zoom 0.5 | Zoom 1 | Zoom 2 |
  |---|---|---|---|
  | Strand, 5 mm | 0.1 px | 0.2 px | 0.4 px |
  | Barb, 30 mm across | 0.6 px | 1.2 px | 2.4 px |
  | Concertina loop pitch, 0.28 m | 5.6 px | 11 px | 22 px |
  | Post, 10 cm | 2 px | 4 px | 8 px |

- **Every strand is subpixel at every zoom.** Rasterised as real geometry, it breaks into dotted, crawling pixels
  (aliasing). Post-process SMAA/FXAA cannot rebuild a line that was never rasterised (`antialias: false`;
  `engine/renderer.js` does AA in post). That is today's "3 thin dark lines that shimmer".

### 6.2 Strand renderer: coverage-widened ribbons (no shimmer)

Strands use the "wire AA" technique (Emil Persson, *Phone-wire AA*, GPU Pro 5, 2014): each strand is a camera-facing
ribbon.

**Vertex shader:**
- Expand each vertex sideways (perpendicular to the strand and to the view direction) to
  `max(trueRadius, 0.5 · minPx · worldPerPixel)`, with `minPx = 1.0` at DPR 1, scaled by the pixel ratio.
- Pass `coverage = trueRadius / widenedRadius` to the fragment.
- The orthographic `worldPerPixel` is constant per frame (camera zoom), so there is one uniform and no
  per-vertex distance term.

**Fragment shader:**
- Alpha = `coverage × profile(across)`, where the profile is a smooth tent: the strand fades in and out without
  popping.
- The colour is the full lit wire material. The normal is reconstructed as a cylinder from `across`, so a strand
  still has a lit top and a dark underside.

**Blending:**
- Premultiplied alpha, `depthWrite: false`, `depthTest: true`, drawn after opaques.
- Strands are thin and dark, so order errors between strands are invisible. No sort is needed beyond the default
  transparent pass.
- Renders before the post AA, so SMAA does not fight it.

**Twist and barbs at zooms 0.5–1:**
- They are *painted into the ribbon*. A 1D barb-and-twist texture along the arc length (u = metres / 0.12)
  modulates width and alpha: barbs widen the ribbon locally, by up to 3× at the barb.
- The texture has a **hand-built mip chain** in which each level's coverage is the box-filtered average. At zoom
  0.5 the barbs melt into a slightly thicker, slightly darker strand instead of sparkling.

**Shadows:**
- Strands do not cast into the shadow map: they are too thin, and would be noisy.
- They get a **fake ground shadow ribbon** instead: the same strand path projected onto the terrain along the
  sun direction (`lighting.js` NW sun, elevation 40°), drawn as a soft multiply decal of 3–6 cm, alpha
  0.25 × coverage.
- This is the single biggest readability cue on snow and sand (ref 04, ref 11).

**Wind:**
- The `aSway` attribute and the `applySway` hook (`cloth-wind.js`) are reused, so wire uses the same
  `world.wind` field, gusts and phase as cloth and ropes.
- Weights by tension:

  | Wire | `aSway` weight |
  |---|---|
  | Fence | 0.12 |
  | Apron / guys | 0.3 |
  | Belts | 0.5 |
  | Beach tangles | 0.8 |
  | Cut tails (whip) | 1.0 |
  | Concertina | 0.08 (whole loop) |

- The fake shadow ribbon moves with the same sway, which the decal shader evaluates in its own vertex shader.

### 6.3 Barb, clip and knot geometry (zoom 2 detail)

- At **zoom 2**, real barbs are drawn as an `InstancedMesh`: a 4-point star, about 12 tris, with
  coverage-widened point tips (the same min-pixel trick in a tiny vertex shader).
- The 1D texture fades out over the zoom tween so there is no pop. A global uniform `uBarbGeo ∈ [0, 1]` follows
  the camera zoom: 0 at zoom ≤ 1, 1 at zoom 2.
- Snow lumps, clips, knot bands and insulators are instanced the same way.
- **LOD trigger:** a camera *zoom* step, not distance (the camera is orthographic).

### 6.4 Readability from the game camera (pitch 40°, yaw 15°)

The player must read four things:

- **where the wire is** (it blocks),
- **what kind** it is (cuttable / reinforced / electric),
- **where a gap is**,
- that **you can see through it**.

Tools, in order of strength:

1. **Posts and frames.** These are solid and pixel-sized at every zoom, and they mark the run's rhythm. Posts are
   always present, even on `concertina` (corkscrew pickets every 4.5 m).
2. **The ground shadow ribbon** (§6.2) and a **trampled-ground strip**: a darker, slightly flattened ground decal
   about 0.6 m wide under belts. Under snow it is a faint trench where wind scoured round the posts.
3. **Value contrast.** Strands are kept at least 25 % luminance away from the theater's dominant ground:
   - dark rust on snow and sand;
   - on dark mud or a night scene, a subtle sky-lit top edge (the cylinder normal catches the sky/env light);
   - no emissive "outline" glow (it would break the realism brief).
4. **Density at zoom 0.5.** Overlapping coverage-widened strands add up. A double-apron (≈ 12 lines across)
   reads as a fine grey hatching band; a concertina reads as a chain of ellipses. That is the BEL map's "XXXX"
   rendered as photography.
5. **Type cues.**
   - Reinforced: blued dark coil, denser barbs.
   - Electric: white insulators every post, warning plates, sparks.
   - Cut gap: bright cut tips, curled tails, an obvious hole between posts.

Things to avoid:
- Fog or depth fade on the wire (the camera is orthographic and fog is minimal anyway).
- Bloom on the galvanised specular: clamp the specular so wire never crosses the bloom threshold (2.0 HDR).

### 6.5 LOD plan

| Zoom | Strands | Barbs | Snow / clips / insulators | Concertina | Posts |
|---|---|---|---|---|---|
| 0.5 (20 px/m) | Ribbons, min 1 px, coverage alpha; texture barbs at mip ≥ 2 (thicker darker line) | Texture only | Snow rim in the shader only; no lumps; insulators as tiny instanced boxes | Full helix, 8 segments per loop | Full (instanced, low-poly 6-sided) |
| 1 (40 px/m) | Same, barb texture visible as bumps | Texture | Lumps on posts and beams only; insulators full | 12 segments per loop | Full |
| 2 (80 px/m) | Same + twist stripes | **Instanced geometry** (`uBarbGeo` 0 → 1 over the zoom tween) | All lumps, clips and knot bands | 16 segments per loop | Full + eye loops on pickets |

**Quality presets** (`engine/renderer.js`):

| Preset | Change |
|---|---|
| `low` | Barb geometry never (texture only); no snow lumps; shadow ribbon on |
| `medium` / `high` | As the table |
| `ultra` | + icicles and dust grooves |

**Culling and draw calls:**
- Each mission's wire is batched into **spatial chunks of 32 × 32 m**, one `Group` per chunk, with frustum
  culling by chunk bounding sphere.
- Inside a chunk, one mesh per material class: strands, shadow ribbons, posts, barbs, lumps, mesh quads, extras.
- Strand geometry is built once at load. Only uniforms change per frame: zoom, wind, snow amount and power.

### 6.6 Placement and no-crossing rules

- **Strands and coils never pass through solids.** The run is the post-placement visual run: `visualRuns` from
  `world/placement.js`, which cuts linear runs at solids. Rule (a) is shared with walls; **feat/map-edges** is
  extending it.
- The wire module consumes those cut runs and never re-cuts on its own. A cut end gets an end post (fences) or a
  pinned coil end (concertina).
- **Coping fixings are above the tallest obstacle in their span.**
  - For palisades: max(stake top) + 4 cm. `buildWall` must export the stake top heights per segment (a small,
    additive return value) so the coping module can read them.
  - For stone or adobe: the coping height from the wall def.
  - This fixes the M2 bug (§3, item 2).
- **Posts** stand on the terrain (`ctx.heightAt`) and are sunk 25–40 cm; they never stand in water or on roads.
  On a road crossing, the run is cut at the road edge with an end post, unless a gate or barrier is there (M2
  `gate_se`, M3 `gate_w`).
- **Aprons, knife rests and concertina** may overhang the gameplay footprint by up to 0.5 m. The overhang is
  checked against solids and other structures' footprints, and the apron is narrowed per picket where it would
  touch.
- **Belts with hedgehogs:** the belt hedgehogs are placed by the belt recipe. Loose hedgehogs (separate
  `crates/czech_hedgehog` defs) closer than 1 m to a belt hedgehog suppress that belt hedgehog, so two never
  intersect.
- **Ground contact:**
  - concertina loops are clamped to the terrain;
  - strands keep ≥ 3 cm above the terrain at every sample, except deliberate "touching" beach tangles, which get
    clamped to ground + 1 cm;
  - snow lumps never sink below the strand.
- **Clip audit:** `src/debug/clip-rules.js` already maps `barbed_wire|wire|wire_fence|fence` to `fence` and treats
  `wire` and `fence` as THIN. New wire meshes are named `wire:<type>:<id>` so the audit classifies them. A new
  rule entry for `wire:` is a one-line addition.

### 6.7 Effects and sound (electric)

- **Sparks:** `render/fx.js` already has a `sparks` emitter. The wire module emits `world.events` `'device'`-style
  `wire:spark` events at random insulator or cage positions while powered. `fx.js` turns them into `sparks` with
  a short point-light flicker (night only).
- **Hum:** the `electric_hum` loop already exists in the audio manifest. It is attached positionally per powered
  fence chunk and per transformer cage, and stops on power-off.
- **Cut:** the `cutters_snip` sound already exists. The visual swap happens at the end of the 3 s task (the
  `fence-gap` event).

---

## 7. Performance budget

Worst case: **M10** with about 660 m of wire (356 m of belts, 91 m of coping, 55 m of cage, 162 m of chain-link).
Next come M9 (~330 m), M3 (~480 m including cages) and M7 (250 m of coping).

| Item | Rule | M10 estimate |
|---|---|---|
| Strand ribbons | 2 tris per 0.25 m segment per strand | 356 m × ~12 lines + 91 × 4 + 217 × 3 ≈ 5 km of strand → ~40 k tris |
| Shadow ribbons | Same count, ground decal | ~40 k tris |
| Concertina | 12 segments × 2 tris per loop, loop 0.28 m, plus its shadow | 91 m coping ≈ 330 loops → ~16 k tris |
| Barb instances (zoom 2 only) | 12 tris, only in visible chunks | ~1.5 k visible per screen → ~18 k tris |
| Posts, hedgehogs, insulators, lumps (instanced) | 30–200 tris per instance | ~300 instances → ~25 k tris |
| Mesh quads (chain-link) | 2 tris per span + posts | negligible |
| **Total** | | **~140 k tris worst case** in all chunks; **≤ 60 k visible** at zoom 1 |

The estimate above undercounted the belts: the real M10 layout (feat/missions) holds ~4.2 km of barbed double-apron
strand, i.e. ~51 k barbs. The limits are therefore stated per drawn frame (barbs are culled per 32 m chunk and
thinned by the far LOD), and the build is split so the load-time part stays small (revised in fix round 2; see §11
for the measurements).

**Hard limits per mission:**
- ≤ 200 k wire tris drawn per frame (all passes) at the default zoom (≤ 1) at 1080p; ≤ 260 k at the zoom-2 close-up
  over the densest belt (M10: every barb drawn whole, 6 tris each, in ~3 visible chunks). Built totals are reported
  in `stats` (`ribbonTris`), not limited: off-screen chunks cost nothing;
- ≤ 12 draw calls of wire per visible chunk set (material classes × visible chunks; the target is ≤ 40 total);
- synchronous build time ≤ 40 ms on desktop for M10 (`performance.now`, `stats.buildMs`); the barb pass runs after it,
  time-sliced (≤ 4 ms slices on zero-delay timers and ≤ 3 ms per frame, `stats.barbMs`);
- ≤ 6 MB of GPU buffers;
- 1 shared 1D barb texture (256 × 1 with mips) and 1 chain-link texture (256², with mips).

**GPU time:** ≤ 0.25 ms at 1080p `high` on the reference GPU (the bench in `engine/renderer.js` comments). The
transparent strand pass is overdraw-light: each pixel is touched by at most a few strands.

**CPU per frame:** zero geometry work once the barb pass is done; uniform updates only (zoom, wind, snow, power).

---

## 8. Modules and merge hooks

All new code lives in new files. Existing files get **one-line hooks** only, so the merges with feat/map-edges
(placement), feat/missions (props-extra, mission defs), feat/gate-smash, feat/clip2, feat/align, feat/bodies and
feat/vehicle-integration stay trivial.

| File | Contents |
|---|---|
| `src/art/barbed-wire.js` (new) | Strand primitive. Catenary and helix path builders; the ribbon geometry (centre, tangent, `across`, arc length, `aSway`); `wireMaterial(look)`, a MeshStandardMaterial with `onBeforeCompile` for coverage widening, cylinder normal, barb/twist 1D texture, rust/zinc/snow/wet/dust masks, sway chained through `applySway`; the shadow-ribbon decal material; the procedural 1D barb texture with a hand-built mip chain; instanced barb, lump, clip and knot meshes; uniforms `uWirePx` (world per pixel), `uBarbGeo`, `uWireSnow` (bound to `PROP_SNOW.uSnowAmt`), `uWireWet`. Pure geometry helpers are exported for unit tests (Node: no WebGL) |
| `src/art/wire-obstacles.js` (new) | The alias table (§4) and type recipes: `field_fence`, `double_apron`, `concertina`, `triple_concertina`, `knife_rest`, `hedgehog_belt`, `coping_bracket`, `coping_concertina`, `chainlink`, `cage`, `low_entanglement`. Theater presets (§5); chunking and batching; the cut-gap state (§4.9); power state (insulator glints, the spark scheduler). Entry: `buildWireLayer(structures, { groundAt, theater, snow, quality, world })` → `{ group, update(dt, camera), applyGap(id, x, z, dir), setPower(id, on), stats, dispose }` |
| `src/art/wire-textures.js` (new, optional) | Chain-link coverage + normal texture, warning-plate canvas texture |

### 8.1 Hooks (one line each)

1. **`src/art/props.js` `buildLinear` fence branch:** when the variant resolves to a wire type and the wire layer
   is on (browser with meshes), add only a lightweight stand-in (nothing visible) and tag the structure as
   `wireLayer: true`.
   - Footprints and blocking are unchanged.
   - Node and unit tests keep the placeholder (no change in nav).
2. **`src/art/dressing.js` palisade `/wire/` strands:** replace the two floating cylinders with a call that records
   the stake tops (`o.onWireCoping?.(segmentInfo)`), and let the wire layer build the coping.
   - The return value gains `stakeTops`. Additive; it stays compatible with feat/clip2 and feat/align edits nearby.
3. **`src/world/map-builder.js`:** after terrain, next to `buildFurniture(… { groundAt })`, call
   `buildWireLayer(built.filter(isWireStructure), { groundAt, theater, … })` and add it to `propsRoot`.
   - It runs before `coverPropsWithSnow`, so the shared snow uniform is live, but the wire material handles its
     own snow (skipped by `coverPropsWithSnow` via `userData.snowCover = true`).
   - It consumes `visualRuns` (placement cuts) when present.
4. **`src/abilities/sapper.js`:** add `x: cell.x, z: cell.z` to the `fence-gap` `structure:destroyed` emit. The
   wire layer listens on `world.events` and calls `applyGap`.
5. **`src/entities/interactables.js` / power:** the wire layer reads `world.fencePower` each frame (a cheap Map
   lookup per powered fence). No hook is needed.
6. **`src/render/fx.js`:** handle `wire:spark` → `this.spawn('sparks', …)` (one line, next to the existing `device`
   sparks).
7. **`src/debug/clip-rules.js`:** the `wire:` name prefix maps to the `fence` / THIN category (one regex line).
8. **feat/missions** (after merge, by that branch): `prison_pen` (`props-extra.js`) is routed to `cage` the same
   way. The M10 belt comment ("hedgehog every ~4.5 m drawn by the belt mesh") becomes true through
   `hedgehogEvery`. Optional `wire:` hints are added (§4).

---

## 9. Tests (all must stay green; never loosen a test to pass)

**Unit** (`node tests/unit/run.mjs`, new `tests/unit/barbed-wire.test.mjs`):
- Every mission wire variant on master (and, after merge, on feat/missions) resolves to a wire type, so no wire
  falls back to the placeholder.
- Catenary sag is in its type's range; concertina loops touch the ground (|lowest − ground| < 1 cm); no strand
  sample lies below ground + 3 cm (except tagged beach tangles).
- **No crossing:**
  - coping fixings are above every stake top in their span + 4 cm (the M2 regression);
  - strand paths do not enter any other structure's solid footprint;
  - belt hedgehogs are ≥ 1 m from loose hedgehogs.
- Budget: tri and instance counts for each of M2, M3 (and M10 after merge) are under §7's limits; build time
  < 40 ms in Node with geometry only.
- Cut gap: after `applyGap` there are no strand segments inside the gap cells; each cut strand has 2 tails; a
  rebuild from a saved grid gives the same gap.
- Reinforced and electric looks differ from the cuttable default (material or recipe flags).

**GPU** (`node tests/run.mjs wire`, new `tests/barbed-wire.test.mjs`):
- **Shimmer:** render the M3 fence and the M2 coping over 16 frames with a 0.25 px camera sub-pixel pan at each
  zoom. Measure per-pixel temporal luminance σ over a mask of wire pixels. It must be ≤ 1/3 of today's
  placeholder's σ, and below an absolute threshold.
- **Readability:** at zoom 0.5, 1 and 2, the mean contrast of the wire band against the ground band beside it
  is ≥ a threshold, on snow (M2), desert (gallery sample) and temperate ground.
  *As built (fix round 2), per theater (temperate, coast, desert, snow) on the gallery:* at zoom 2 the along-strand
  darkness of every long barbed strand over the double apron must peak at a 10–14.5 cm period (≥ 8× the median of
  the 5–40 cm spectrum, σ ≥ 5 L) on at least half of them, with the strand ≥ 10 L darker than its ground; at zoom 1
  each belt's footprint must stand out (mean |on − off| ≥ 3.5 L coil, 7 triple, 10 knife rest, 5.5 hedgehog belt;
  ≥ 1.2 % of the apron's pixels ≥ 20 L darker), and in the desert the coils must be dark silhouettes (≥ 10 % / 25 % of
  the single / triple coil footprint ≥ 20 L darker than the sand).
- **Snow:** with `PROP_SNOW` = 1, wire top pixels are brighter than its bottom; with 0, they are not.
- **Power:** M3 sparks stop after the switch; the hum source is removed.
- **Cut:** in m00, a Sapper cuts the fence; the screenshot shows the gap; the pathfinder passes through it.
- **Perf:** `__game.bench` at M3 zoom 0.5 `high` changes by ≤ 0.3 ms GPU versus the placeholder.

Screenshots are reviewed visually at zoom 0.5, 1 and 2 on M2 (snow coping), M3 (electric chain-link, cages) and
m00 (field fence, cut gap). After the merge they are also reviewed on M8 (desert apron), M10 (belts and cage),
M11 (triple concertina), M14 (beach belts) and M17 (prison cage).

---

## 10. Order of work and open points

**Order of work:**
1. Strand primitive and material (AA, sway, weathering, snow), proven on the m00 fence.
2. The `field_fence` / `double_apron` recipe plus the cut gap.
3. Palisade coping on M2, with the crossing fix.
4. Chain-link electric fence and transformer cages on M3, with sparks and hum.
5. Concertina, knife rest, hedgehog belt and cage recipes (data-only for feat/missions until it merges).
6. Tests and the perf pass.

**Open points:**
- **M6 theater.** The def says `temperate`, but it is a Norway winter map with snow under the pines. Wire snow
  follows `mission.lighting.snow` / `PROP_SNOW` rather than the theater string, so it stays consistent with the
  other props.
- **M4 `wire_on_stakes` vs knife rests.** The spec text says knife rests. Until feat/missions adds `wire:
  'knife_rest'`, the alias falls back to `double_apron`.
- **Library `stockade_fence` kit.** No mission uses it. If B7 adopts it, its `steel_galv` strands should be
  swapped for the wire layer's strands so the looks match.
- **Tank crushing** (feat/gate-smash / vehicles). An API stub `flattenRun(id, x, z, r)` is reserved in the wire
  layer for later.

---

## 11. Implementation (feat/barbed-wire)

What shipped, and where it departs from the plan above.

**Modules.**
- `src/art/barbed-wire.js`: the strand primitive. It holds the pure helpers (catenary, measured sag, arc lengths,
  barb stations, the concertina helix clamped to the ground, `wireLod`), `WireBuffer` (polyline ribbons + short
  segments + instanced barb / snow-bead data), the lit ribbon material (`wireMaterial(look, {snow, inst})`), the
  projected ground-shadow material and the theater looks (`WIRE_LOOKS`).
- `src/art/wire-obstacles.js`: the alias table, `wireTypeOf` / `wireLookOf`, the eleven recipes, `cutPath` /
  `curlTail`, `assembleRibbons`, `panelGeometry`, the instanced post / frame kinds, the procedural chain-link and
  warning-plate textures, `buildWireLayer` and `buildMissionWire` (the map-builder entry).
- Hooks: `props.js` tags wire fence runs and wire-coped walls (`userData.wireRun`, no placeholder boxes; footprints
  unchanged); `dressing.js` drops the floating palisade strands and records the stake tops; `map-builder.js` builds the
  layer after the terrain, ticks it, disposes it and adds its body guard to `stampStanding`; `sapper.js` adds `x, z`
  to the `fence-gap` event.
- Dev map `src/missions/dev/wire-gallery.js` (every type), tool `tools/perf/wireshot.mjs` (frames, `--cut`, `--perf`,
  `--dump`, `--eval`), tests `tests/unit/barbed-wire.test.mjs` (8 cases) and `tests/barbed-wire.test.mjs` (GPU).

**Anti-aliasing (§6.2, refined).** A sub-pixel ribbon is drawn at a minimum HALF-width of 1 px with a normalised tent
profile (mean 1) instead of a 1-px box. Samples of a 2-px tent at unit spacing sum to the same value at every
sub-pixel phase (partition of unity), so a sliding view cannot make the line crawl. Short segments (barb points,
ties, cut tips, snow beads) get the same tent along their length. As a ribbon grows wider than its minimum, the
profile blends back to a box with an anti-aliased edge. Measured on a quarter-pixel pan (GPU test, per-row integrated
coverage σ / mean): wire 0.042 at zoom 1 and 0.032 at zoom 0.5, against 0.315 and 0.351 for the old 3 cm boxes.

**Shading.** A sub-pixel wire is the whole visible half-cylinder inside one pixel, so it is shaded with the cylinder's
MEAN radiance, not one sample. With φ the angle between the view and the sun (both taken perpendicular to the wire),
the projected-area-weighted mean of max(0, n·l) over the visible half is f(φ) = (sin φ + (π − φ) cos φ) / 4: π/4 when
lit from behind the eye, ¼ side-lit, 0 back-lit. The fragment uses an effective normal at acos f from the sun, on the
viewer's side, so the diffuse term is exact, and widens the glossy lobe (roughness ≥ 0.82, ≥ 0.68 wet) because a
highlight covers only a sliver of the cylinder. Weathered steel keeps metalness 0.22 (zinc) to 0.06 (rust). The first
version used the brightest visible normal (the half-vector), which put every wire pixel on the specular peak: strands
rendered near-white (L ≈ 170 on ground of L 93), the opposite of the dark weathered wire in the references. Now the
strand core is darker than its ground in every theater. Measured on the gallery with only the strand ribbons shown
(mean of the 30 % most-changed pixels, on / under; zoom 1 · zoom 2): temperate 59/100 · 62/101 (ratio 0.59 · 0.61),
coast 54/98 · 54/100 (0.55 · 0.54), desert 60/132 · 66/133 (0.46 · 0.50), snow 125/185 · 102/185 (0.67 · 0.55, the
snow rim lightens the far view); coast is the darkest steel, as in the §1.2 albedos. Each look has a readability gain on coverage at zoom ≤ 1 (`gain` in `WIRE_LOOKS`: desert
1.8, temperate 1.6, coast 1.5, snow 1.4), fading out by zoom 1.5, and the desert look is darker rusted steel with less
dust (reference 11: coils read as dark silhouettes on the sand; the §5 `#9a7d5e` camouflaged them). Snowy strands
keep a dark core: the snow mask stays on the upper rim of a sub-pixel strand, so wire still reads dark against snow.

**Barbs.** A barb instance is the 1 cm wrap knot plus two tip-to-tip lines through it, leaning ±35° along the strand
(a 4-point barb reads as an X; 6 tris). At zoom 2 the knot is drawn as a ≥ 3 px dark dot with a saturated core (the
strand is a 2 px line), so the barbs read as regular dark ticks every ~12 cm in every theater; barb colour is darker
than the strand (×0.7, knot ×0.45: barbs rust first) and barb coverage ×3. The GPU test measures the along-strand
darkness spectrum on the gallery's double apron at zoom 2 per theater (peak at 10–14.5 cm with σ ≥ 5 L on more
than half of the strands; the first version had σ < 2 L in temperate and coast).

**LOD.** The barb fade is driven by the pixel footprint (m/px, which also covers the device pixel ratio), not by the
zoom step: barbs are full at ≤ 3 cm/px and gone at ≥ 4.5 cm/px; the instanced barb draw is skipped when they are gone.
Coarser than 1.4 cm/px (zoom < ~1.8 at 720p, < ~1.2 at 1080p) only every other barb is drawn, as knot + one line
(the instance data is stored even-first; draw range 2 quads, coverage ×2: same mean darkness, a third of the
triangles). Snow beads stay at every zoom.

**Batching.** One merged ribbon mesh per look and its shadow (same geometry), instanced barb and bead meshes per look
per 32 m map chunk (frustum-culled: barbs are ~60 % of the wire's triangles), one InstancedMesh per post / frame kind,
and one chain-link panel mesh. Ribbon and barb materials draw in one pass (`forceSinglePass`: a transparent
DoubleSide mesh is otherwise drawn twice, back then front, which had doubled every wire triangle). M3 is 23 draw
objects (≤ 5 visible chunks' worth on screen), M2 is 21.

**Build.** Ribbon vertices go into one interleaved Float32 store (no per-value JS arrays); a taut span gets
max(4, ⌈√(sag / 1.5 mm)⌉) vertices (chord error ≤ 1.5 mm) instead of one every 0.25 m, falling back to 0.25 m steps
when a coarse chord would pass within 4 cm of the ground (and always on the coping spans, whose clearance over the
stakes is checked per vertex); the ground under each point is sampled once for the clamp and the shadow projection.
The barbs are a second, independent pass (`assembleItem` with own random streams, so they land exactly where a
single pass would put them): in the game it runs time-sliced after the synchronous build and swaps in when complete
(a cut keeps the old barbs for those few frames; never a bare strand). A cut rebuilds ribbons + panels synchronously
(M10: ~7–9 ms) and re-runs the barb pass in slices.

**Cut gaps.** The layer samples each cuttable run every 0.25 m at build time (the FENCE cells), and rescans whenever the
grid version changes or a `fence-gap` arrives. The Sapper's gap and a loaded save (fresh map + restored grid) give
the same gaps. No save fields were added.

**Coping (M2).** Brackets are nailed to the tallest stake within ±0.8 m of each 2.8 m station, on the outside face, and
lean 35° outward. The arm positions are pushed out until every strand clears the tallest stake top of its two spans
by ≥ 4 cm (unit-tested on the real M2 stakes). From the game camera the near-side brackets are almost parallel to the
view ray, so the three strands of a south-facing edge read as one dark line along the stake tops. That is the
correct projection.

**Chain-link at the default zoom.** Once the 55 mm diamonds fall below ~2 px the mips average them into a flat veil
(frosted glass on snow). The mesh is now dark weathered galvanising (texture 0.2, metalness 0.3, roughness 0.7, one
pass) and, as the texel footprint grows (`fwidth` of the tile uv 0.1 → 0.3), its alpha is raised (×2.4) and
modulated by the weave's diagonal ridges (period 2 tiles, 22 cm): the panel reads as a darker, patterned mesh at
zoom 1 and as individual diamonds at zoom 2.

**Map edge.** A chain-link leg whose outside comes within 5 m of the map edge takes its outrigger arms inward (a corner
between an inward and an outward leg gets an upright arm): the M3 west fence (x = 4) no longer runs its top strands
through the edge treeline canopy (`vegLeaves` at x ≈ 3.3–3.8, z ≈ 68). A segment raycast of every strand against the
scene's other meshes finds 0 hits on M3.

**Electric (M3).** Porcelain insulators on the arms and the live strands, enamel plates (every ~30 m, one per cage),
and `sparks` FX at random insulators while `world.fencePower` is on. The transformer cages follow the station
power, so they stop when the switch is thrown. The hum loop is not attached yet.

**Measured cost** (RTX 5090 shared with other jobs, `high`, 1920 × 1080; `tools/perf/wireshot.mjs --iso=1` times the
wire draws alone with GPU timer queries; layer stats from `mapHandle.wire.stats`):

| Map / zoom | Wire GPU | Draw calls added (all passes) | Triangles added (all passes) | Layer |
|---|---|---|---|---|
| M1 | 0 | 0 | 0 | no wire in M1 |
| M2 zoom 1 | 0.007 ms | +22 | +21 k | 21 draw objects, 6.8 k strand tris, 3.2 k barbs, 50 brackets |
| M3 zoom 0.5 | 0.034 ms | +27 | +89 k | far barb LOD (every other barb, knot + 1 line) |
| M3 zoom 1 / 2 | 0.033 / 0.033 ms | +32 / +26 | +107 k / +134 k | 31 draw objects, 30.6 k strand tris, 9.7 k barbs, 857 instances, 174 panels |
| M10 wire (feat/missions layout) zoom 1 / 2 | 0.036 / 0.039 ms | +26 / +21 | +163 k / +235 k | 17 runs, 31.8 k strand tris, 50.8 k barbs (336 k tris built), 563 instances |

The first measurement (before fix round 2) was M3 zoom 1: 0.081 ms, +17 calls, +338 k triangles: the transparent
DoubleSide wire drew every ribbon and barb twice, barbs were 8 tris, the insulators 60 tris, and the barbs were not
culled. Draw calls went up (barb chunks) while each frame draws far fewer triangles.

Synchronous build (`stats.buildMs`, browser, load average 10–14 on the shared machine): M2 8.6 ms, M3 17–19 ms, the
M10 wire layout 26–33 ms (≤ 40); the barb pass after it (`stats.barbMs`): M2 1.7 ms, M3 2.3–2.6 ms, M10 10–18 ms in
≤ 4 ms slices. The M10 numbers come from its 15 wire structures copied from feat/missions into a JSON def
(`wireshot.mjs --def=…`); re-measure on the merged branch. A full-frame A/B on M3 (`--perf=1`, alternated 3×) stays
inside the noise of the shared GPU (±1 ms).

**Not done / follow-ups.** Icicles and dust grooves (`ultra`); a trampled-ground strip under belts; the hum loop;
tank flattening (`flattenRun`); the clip audit does not see the wire layer (fence structures now have empty
visuals); feat/missions hints (`wire: 'knife_rest'` for M4; `hedgehogEvery` for M10) still to add on that branch.
