# Commandos: Behind Enemy Lines (1998) and Beyond the Call of Duty (1999): consolidated research reference

This document consolidates every research report and gap follow-up in `docs/research-raw/` into a single reference for the three.js remake. It covers the original game (*Behind Enemy Lines*, "BEL") and its standalone expansion (*Beyond the Call of Duty*, "BCD" or "BCTD"). Where the first-round reports disagreed, the gap follow-ups (which went to the demo executable and the retail mission files) are used to settle the question. Anything still unsettled lists every version.

## How to read this document

**Source-priority rule used to resolve contradictions** (highest first):
1. Engine code and data: disassembly of the May 1998 demo `Comandos.exe`, the demo `.MAC`/`.STR`/`.ANM` files, the two retail BEL mission files that are available (M1 from github.com/mwaf/cbel, M4 = `MAPA0002.MIS` from herbert3000's ModExamples), and the complete BCD retail `.MIS` set.
2. The US manual (Eidos, 1998), and the BCD US manual for the expansion.
3. The Prima Official Strategy Guide (Michael Knight, 1998).
4. The detailed player FAQs: Kildread2 (GameFAQs #2256), Ruetli_1291 (German, #64751; BCD #64857), eggie's max-merit walkthroughs, Varkovsky (BCD, #9115), the Dutch FAQ (#22515), oocities walkthroughs.
5. Fan wikis (commandos.fandom.com, the Commandos Modding Wiki), Wikipedia, CommandosHQ, reviews.

**Caveat on engine findings.** The disassembled executable is the **demo build dated 6 May 1998**. Retail 1.x may differ in detail. Code addresses are kept so the findings can be re-checked.

**Tags**
- **[manual]**, **[Prima]**, **[EXE]** (demo disassembly), **[data]** (mission/macro files), **[measured]** (pixel measurements from screenshots), **[WAD]** (interface sprite sizes read from mod copies of the original WADs).
- **[inferred]**: a deduction by a researcher, not stated in any source.
- **[unknown]**: no reachable source gives the answer.
- **[sequel]**: a feature of BCD or of *Commandos 2/3* that fan sources wrongly attach to BEL.
- **[rec]**: a recommendation for the remake, not a fact about the original.

**Identifier note.** The retail file `MAPA0002.MIS` used by several reports is **Mission 4 (Restore Pride)**, not Mission 2. It contains the train, the motorcycle courier, the drivable Panzer, the HQ target and the patrol-boat escape, and its extents match M4 (gap 7, gap 8). References elsewhere to "the mission 2 script" should be read as M4.

## Contents

0. Key numbers at a glance
1. The game (facts, development, release, reception, franchise)
2. Game structure and meta-loop (campaign, menus, briefing, win/lose, scoring and ranks, passwords, saving, difficulty, multiplayer, cheats)
3. Controls and key bindings (BEL, plus BCD changes)
4. User interface and HUD
5. The commandos (names, stats, per-character kit, voices, guests, features not in BEL)
6. Items, weapons and damage
7. Core mechanics (time base, movement, footprints, water, climbing and devices, bodies, capture, disguise, health)
8. Enemy AI (vision, hearing, roster, nervousness, state machine, alarms, exploits)
9. Vehicles
10. Behind Enemy Lines: the 20 missions
11. Beyond the Call of Duty
12. Visuals and art
13. Audio (music, sound effects, voices)
14. Engine, data formats and modding
15. Remakes, successors and genre lessons
16. Implementation notes for the three.js remake
17. Contradictions register
18. Open questions
19. Sources

---

## 0. Key numbers at a glance

| Quantity | Value | Basis |
|---|---|---|
| Simulation tick | **20 ticks/s (50 ms)** as the design time base. The engine itself is frame-locked: one tick = one rendered frame, capped by a 40 ms sleep (25 fps), running 15-20 fps (about 16) on 1998 PCs. | [EXE] `<addr>`; manual's 10 s bomb = `.Retardo 200`; PCGamingWiki |
| World scale | **1 map unit ≈ 0.045 m** (people and vehicles modelled at real size) | Vehicle collision footprints; soldier 40 units ≈ 1.8 m (gap 8) |
| Camera | Orthographic, fixed, **40° down from horizontal, yaw 0** relative to map data; screen y = map y × sin 40° (0.6428) | open-commandos `g_sin40`, Modding Wiki, M1 coordinate check |
| Soldier vision cone | **70° full aperture; near band 400 units (18 m); far edge 800 units (36 m)** | [EXE] `Vista01` defaults |
| Gaze sweep | θ = ANGBARRIDO · sin(2π·t/DEMORA); default ±50°, period 100 ticks (5 s); patrol squads 50 ticks (2.5 s) | [EXE] `<addr>` |
| Cone colours | Near `#02BC6F`, far `#07675A`; desert near `#D26E02`, far `#6B4C01`; flat 50 % blends, hard edges | [EXE] `<addr>` |
| Detection | Instant on the first tick in the cone; the only delay is the guard's reaction (nervousness threshold 50) | [EXE] `<addr>`, `<addr>` |
| Commando HP ("energy") | Green Beret 200, Marine 160, Spy 160, Driver 130, Sapper 130, Sniper 100 | [EXE] table `<addr>` |
| Walk speed | 2.5 units/tick for everyone (50 u/s ≈ 2.25 m/s) | [EXE] `<addr>` |
| Run speed | Green Beret and Driver 6.0 u/tick (≈5.4 m/s); everyone else 5.0 (≈4.5 m/s) | [EXE] |
| Weapon ranges (units) | Pistol 300, grenade 300, SMG / MG 400, sniper 1000, harpoon 200 (EXE) or 100 (herbert3000), crossbow 800 (unused) | [EXE] `<addr>`; Revora |
| Time bomb | 200 ticks = 10 s (manual); set per instance (M4 crate bomb 150 = 7.5 s) | [manual], [data] |
| First aid | +34 energy per dose; 6 doses per mission in BEL (engine default 3; BCD 5) | [EXE] `<addr>`, Kildread |
| Siren | Only event `RINT` starts it; fades over 500 ticks (≈25 s) | [EXE] |
| Guard alertness after losing sight | ≈950 ticks (45-60 s) before nervousness drops below threshold | [EXE] |
| Scoring | Two 0-3 silver-star ratings (time, damage); gold = floor(sum/2); promotion every 6 gold; max 60 | manual, Ruetli |
| Mission par | `.PAR_TICKS`: M1 3100 (≈2:35), M4 15100 (≈12:35); other 18 unpublished | [data] |

---

## 1. The game

### 1.1 Key facts

| Field | Value |
|---|---|
| Title | *Commandos: Behind Enemy Lines* |
| Developer | Pyro Studios, Madrid (founded 1996) |
| Publisher | Eidos Interactive worldwide. Proein distributed it in Spain at 6,795 pesetas. Later digital releases came through Kalypso Media and others. |
| Designers | Gonzalo "Gonzo" Suárez (project manager, game design, chief developer, software design); Ignacio Pérez Dolset (chief mission design, co-game design) |
| Key crew (manual credits) | Jorge Blanco (graphics design, chief artist, later art director); Jon Beltrán de Heredia (lead programmer); Javier Arévalo (software design); Pablo Toledo (video engine, FX, "German patrols AI"); Fernando Colomer ("BXB programming", missions and German soldier AI); David García Morales (music and audio); César Astudillo ("additional design"); Armando Sobrado (mission design); Unai Landa (3D support and network). Graphic artists: Jorge G. Mourelle, Asier Hernáez Laviña, Guillermo Tostón, Daniel Estival, Jorge Fernández; additional art Mª José Romero. No English voice cast is credited. |
| Platform | Windows 95/98 CD-ROM, DirectX 5. Minimum: Pentium 120 MHz, 16 MB RAM (32 MB recommended), 1 MB SVGA card, 135 MB disk. |
| Release | EU 24 June 1998. North America: 27 Aug 1998 (EN Wikipedia), 28 Aug 1998 (PCGamingWiki), 31 Jul 1998 (fan wiki) or "1 July 1998" (series article); unresolved. |
| Genre | Stealth real-time tactics, pre-rendered 2D maps in a fixed 3/4 view |
| Modes | 20-mission single-player campaign; co-op multiplayer for up to 6 players over LAN (TCP/IP) or Mplayer |
| Expansion | *Beyond the Call of Duty*: 31 March 1999 (NA) / 1 April 1999 (EU), standalone, 8 missions |

### 1.2 Development history

**Studio and people**
- Pyro Studios was founded in Madrid in 1996 by the brothers Ignacio and Javier Pérez Dolset. Their father, José Luis Pérez Dolset, founded the distributor Proein in 1973; Proein brought the Sega Master System to Spain around 1987.
- Gonzo Suárez (born Barcelona 1963, son of filmmaker Gonzalo Suárez) worked at Opera Soft 1985-1989 (*Goody* 1987, *Sol Negro* 1988, *Mot* 1989). In 1996 he co-founded Arvirago Software with Diego Soriano, Javier Arévalo and Jon Beltrán de Heredia; their prototype *Head Hunter* was never finished.
- Gonzo's account: Ignacio Pérez approached him about a **pirate game**; "from the need to tackle another project, Commandos arose". Both ideas were pitched to UK publishers, most of whom declined. At Eidos, Ian Livingstone walked in during the demo and said "this game looks good". Gonzo: "Eidos wanted catalogue filler; they didn't expect a big success." He also says Pyro was created **after** the Eidos contract, with him and Jorge Blanco as partners, which conflicts with the 1996 founding date.
- A design retreat in **Granada** (Ignacio Pérez, Gonzo, Jorge Blanco) produced "almost all the missions, characters and many ideas". Ignacio was "a walking encyclopedia" of WWII.

**Inspiration**
- Ignacio Pérez: *The Dirty Dozen* "was almost the name of the game, because we tried, fortunately without success, to acquire the rights to the film".
- Gonzo cites *The Guns of Navarone*, *The Dirty Dozen* and *The Great Escape*, and describes the goal as "the experience of a child approaching a diorama built by an older man": lead-figure dioramas brought to life.
- Xataka credits Javier Pérez Dolset with proposing the WWII setting. Ignacio's design motto: "easy to play, hard to master".

**Production**
- About **18 months**; Beltrán de Heredia worked full-time for the last 12, "10 hours a day 7 days a week". Some sources say "two years".
- Team of about **18** (Beltrán de Heredia) or 15 (Gonzo, 421.news).
- About **250,000 lines** of C++ and assembly. Budget about **US$1 million** (Ignacio; ~€900,000 per MobyGames), a "record budget" for Spain.
- **Custom engine, deliberately not tile-based** ("we had to stay away from the classic tile system"). Consequence: "it was impossible to build a mission creation tool", so every map's layout and logic was hand-implemented.
- **Pathfinding** grew out of a Beltrán de Heredia demo of units moving "in a freely polygonal 2D environment". It had a **panic mode**: a unit stuck for 5 s or more moves randomly for a few seconds, then retries.
- Missions are text `.MIS` files with Spanish keywords, packed in `WARGAME.DIR` (see §14).
- Blanco and Toledo added **water particles and electric-fence sparks** "outside the planning", behind Gonzo's back.
- **Sales expectations were low:** Gonzo hoped for about 15,000 (Wikipedia) or 100,000 (deusexmachina); Eidos targeted 200,000 (Vandal) or 180,000 (Arcade Attack) and initially planned no US release; Ignacio bet on more than 400,000.

### 1.3 Release, versions and platforms

- The EU retail version had a v1.1 patch; the US release shipped already patched.
- **Resolution:** 640×480 default (16-bit colour), with 800×600 and 1024×768 in the menu; 4:3 only (widescreen needs fan patches). Cheat keys Shift+F1 to F4 give 512×384, 640, 800 and 1024. Multiplayer is fixed at 640×480. Above 1024 px wide drawing artifacts appear; above about 1400 px the small early maps no longer fill the screen.
- **No game-speed control** in BEL (GameSpot: "You cannot slow the game down or speed it up"). BCD added a game-speed slider.
- **Re-releases:** Sold Out Software (budget), Steam (app 6800; BCD is app 6810), GOG "Commandos Ammo Pack" (BEL + BCTD with compatibility fixes), Zoom Platform (bundles DDrawCompat). Modern PCs run the unpatched game far too fast; community fixes include CPU limiters and an "x64 fix". The Steam build fails to save or load without a `Commando.cfg` fix.
- **Demo:** contains missions 1 (*Baptism of Fire*) and 3 (*Reverse Engineering*). The demo's "Noisy mother nature" ambient option works; retail missions have no ambient entries (§13).
- **Budget edition** *Commandos: Behind Enemy Lines - The Early Battles*: 4 missions (A Quiet Blow-Up, Reverse Engineering, Blind Justice, Chase of the Wolves).
- **Unofficial port:** a Russian bootleg Sega Mega Drive port with the first 5 missions and no sound.
- **German release (USK 16)** was censored: all blood removed, dead soldiers replaced with **gravestones**, swastikas on flags and banners replaced with Balkenkreuze, "Nazi" and "Hitler" censored in briefings, and intro footage cut (a stamp turning France into a swastika-marked black country, a Hitler speech, a burning flag, a stone swastika blown off a roof). The cheat string is also reversed (`1982GONZO`).
- **Regional naming:** the commandos' names and nicknames differ between the US manual and European texts (§5.1). Mission titles also have variants (§10.1); the "Discret Explosion / Backward Throttling" set is a re-translation used in Kildread's FAQ, not an official English set.

### 1.4 Reception, sales and awards

| Outlet | Score |
|---|---|
| GameRankings | 81 % |
| PC Zone | 87 % |
| Game Informer | 8.75/10 |
| GameSpot (Greg Kasavin, 10 Sep 1998) | 8.4 (Gameplay 9, Graphics 8, Sound 7, Value 7, Tilt 9; Difficulty: Hard; learning curve about 1 hour) |
| IGN (Trent C. Ward, 1 Sep 1998) | 8.2 |
| PC Gamer UK | 80 % |
| Next Generation | 4/5 ("gorgeous", "tough", "challenging") |
| Edge | 7/10 |
| Computer Gaming World (Tim Carter, #173, Dec 1998, "Not So Special Forces") | 2.5/5 |

**Praise.** GameSpot: "a genuinely original game of tactics, planning, and precision"; maps "all look different, beautiful, and realistic"; "you can scroll all around the map, identify all enemy patrols, and even see each enemy's field of vision"; planning like chess; "you can save whenever you like"; "Guards cannot hear your men moving, nor can they hear their fellows die by your silent weapons". IGN praised the AI ("try to capture or shoot you based on their passivity level and whether or not they have seen you hurt any of their friends"), grouped it with *Rainbow Six* and *Thief* as games bringing "fear" back, and compared it to *Cannon Fodder*.

**Criticism.** Linearity (IGN: a "very definite 'right way'"; GameSpot countered "plenty of room to be especially creative"). Difficulty (IGN: "Commandos is hard. I mean REALLY hard", missions taking "hours (and in more than one case, days)"). Trial and error (CGW: "Try something, fail, reload"; "you can't win a mission if any of your people die, and you often can't win if an alarm is triggered"). Too few missions (IGN), sparse music and speech (GameSpot), no group autonomy or self-defence orders (CGW), crashes on Windows 95 (CGW). CGW called it a "24-scenario campaign" (probably counting training missions) and its difficulty "Intermediate".

**Sales.** Germany: #1 for 16 weeks (taking the spot from *Anno 1602*), 158,000 units in German-speaking countries by end of September 1998, #4 PC game of 1998 there, VUD Gold (100k) Jan 1999 and Platinum (200k) May 1999. UK: #1 for 15 weeks. Global: 600,000 by November 1998, 706,000 by end of 1998, 1.3 million including the expansion by July 1999, more than 1.5 million by May 2000. Developer claims are higher ("two million and change", "second best selling game worldwide in 1998 only behind Tomb Raider", #1 in more than 30 countries) and unverified. Milia 1999 (Cannes) "Gold" prize for more than €16M EU revenue in 1998. GameSpot Spain (2001) called it Spain's biggest game hit ever.

### 1.5 Influence, sequels and franchise

- **Defined stealth real-time tactics:** a fixed squad of irreplaceable, complementary specialists instead of base-building; full map visibility with no fog of war; inspectable enemy view cones; hand-crafted puzzle-like maps. Shipped in the "year of stealth" alongside *Thief*, *Metal Gear Solid* and *Tenchu*.
- **Descendants:** *Desperados: Wanted Dead or Alive* (2001) and series, *Robin Hood: The Legend of Sherwood* (2002), *Star Trek: Away Team* (2001), *Shadow Tactics: Blades of the Shogun* (2016, a "spiritual successor"); Mimimi's *Desperados III* (2020) and *Shadow Gambit* (2023) are generally seen as descendants [inferred].
- **Spanish industry:** the first Spanish game to conquer the global market including the US, often called the revival of Spanish development after the early-1990s collapse.
- ***Commandos 2: Men of Courage*** (PC Oct 2001; PS2/Xbox Sep 2002): 3D interiors, new characters (Lupin the thief, Whiskey the dog, Natasha Nikochevski the sniper), war-film level titles, Normal/Hard/Very Hard. HD Remaster 24 Jan 2020 (Kalypso/Yippee!, Unity, 360° rotation).
- ***Commandos 3: Destination Berlin*** (Oct 2003): true 3D with rotatable view, criticized for short missions. HD Remaster 30 Aug 2022 (Raylight Games).
- ***Commandos: Strike Force*** (2006): first-person shooter with 3 commandos; a critical and commercial failure, followed by the split with Eidos.
- **Rights:** Pyro merged with Play Wireless into Pyro Mobile (2012) and ceased operations in 2017. Kalypso Media bought the IP in July 2018.
- ***Commandos: Origins*** (Claymore Game Studios / Kalypso, Unreal Engine 5; 9 April 2025, Wikipedia infobox says 10 April; PS5, Xbox Series, PC): prequel about the team's formation with the six original classes, 14 missions, 2-player co-op; Metacritic PC 72 (another report gives 71). Details in §15.
- **Series totals** are quoted as 3.3M copies / $41M retail (EN Wikipedia series), more than 3M (fan wiki), more than 5M (EN Pyro article), more than 6M including C2 (Xataka).
- **Book:** *Boinas Verdes: De Commandos a Pyro Studios* by Jaume Esteve (2021).

---

## 2. Game structure and meta-loop

### 2.1 Campaign, theaters and story frame

- **20 missions "of increasing difficulty, divided into four campaigns"** [manual]:
  - "Seven missions inspired by the Commando raids in **Norway**" (M1-M7).
  - "Five missions in **Egypt, Libya and Tunisia** centered on the war in North Africa" (M8-M12).
  - "Three missions in **France**, during the period that begins with the Invasion of Normandy" (M13-M15).
  - "Five missions that take place during the **final assault on the Third Reich**" (Belgium, Alsace, Germany; M16-M20).
- The campaign is **linear**: mission N+1 unlocks only after mission N's main objective is complete.
- **Story frame:** the late-1940 creation of the Commandos by Lt. Col. Dudley Clarke (the manual spells it "Clark"). Briefings are voiced by **Colonel Montague Smith**, heard but never seen, British-accented; he calls the player "officer", and "son" in the last mission. His actor changed from *Commandos 3* onward.
- **Timeline:** 20 Feb 1941 to 11 Feb 1945. Missions are "freely inspired" by history: M2 references Operation Claymore (Lofoten), M13 resembles Operation Source (the 1943 X-craft attack on the *Tirpitz*), M20 is fiction (a Nazi atom-bomb plot).
- The fan wiki calls M8 the "first of four" desert missions, but the manual's grouping makes M8-M12 five; M12 (urban Tunis) apparently lacks desert camouflage [inferred].

### 2.2 Front end and options [manual]

- **Main menu.** NEW GAME (Single Player, Multiplayer, Tutorials, Restart Mission, Load Quick Saved Game, **Password**), SAVE GAME, LOAD GAME, OPTIONS, HELP, CREDITS, QUIT. Esc in-game opens the menu; in menus Esc or right-click goes back, and from the main menu returns to the game. Up/Down move, Enter or click selects, Left/Right change sliders and toggles, the volume slider can be dragged.
- **Options:**
  - **User Profile Name**: each player has their own save slots and options.
  - **Sound Volume** (the only audio setting; no subtitles).
  - **Video**: resolution (stored in `COMANDOS.CFG` as `.SIZE [ .INITSIZE n ]`; menu backgrounds `MENU####.BMP`, one per horizontal resolution).
  - **Game Preferences:**
    - **Submissive / Indifferent to enemy halt** (default **Indifferent**): whether a man moving under orders stops when a German shouts "Halt!". Indifferent usually gets him shot. (`GLOBAL.STR` 3LE0/3LE1.)
    - **Verbose / Laconic** (default Verbose): spoken acknowledgements of orders.
    - **Commandos warning flashes ON/OFF** (default ON). What exactly flashes is undocumented for BEL (§4.7).
- **Restart Mission** is for "after you have lost a Commando or failed an objective".

### 2.3 Tutorials

- **7 "theory sessions"** (video lessons) and **6 training missions**, each with one commando in a training camp with **unlimited damage** ("your soldier can suffer unlimited damage"). Optional but recommended.
- Tutorial guards are Allied soldiers in disguise firing blanks; they cannot hurt you (Ruetli).

### 2.4 Briefing

**Part 1: historical slideshow** (640×480):
- Top-left "Mission N"; the date (e.g. "Feb 20, 1941") at the top right / above the image, in small white type.
- Left panel: about 4 rotating images: B&W archival photos, colourized photos, a stylized grey map of Europe with the target circled in red and aircraft/range icons (or a red radio-mast marker), and a pre-rendered low-poly 3D view of the target (M1 shows the relay station in fog).
- Right side: black/dark green-black with a faint embossed "COMMANDOS" logo watermark; the title in large **heavy red condensed sans**; 2-3 paragraphs of white text on strategic context and objective.
- Bottom: bold "Press Escape to skip".
- The fan-wiki "Historical Background" and "Objectives" text matches the in-game slides, with minor wording differences (M5 "think of" vs "fear"; M7 "On the first of February, 1942"; M10 names "Captain **Gregor** McRae"; M11/M12 spell "Lybian"/"Lybia" and "March1943"; M12 "gather information from the Axis defences").

**Part 2: the Colonel's Tactical Advice.** Smith's voiced walk-through pans over the actual mission map, pointing out objectives, points of interest, dangers and the extraction. Esc skips straight into the mission. The transcribed Tactical Advice text for each mission is in §10.

**In mission:** Ctrl+B, or clicking the green folded corner of the notebook, opens **Briefing Notes**: a ruled notepad page with DATE / LOCATION / MISSION in red and a bulleted list of hints. The only surviving English copy of the per-mission hints is Kildread's "SCRAPBOOK", a re-translation of the French release, not the verbatim English text.

### 2.5 Winning and losing

**Win rule.** Complete every main objective, then get **all** surviving commandos (and any escortees) out by the prescribed extraction: a vehicle, a boat rowed to a buoy, a truck, a plane, an autogyro, or a map-edge exit point. Prima: "To complete a mission, you must achieve all its objectives… and then get all your Commandos to safety. Yes, all."
- **M1 is the only mission with no extraction.** Its file has `OBJETIVO RADIOEXP` and no escape keys, and the demo success text is "YOU DESTROYED THE ENEMY RELAY STATION" (Kildread: "Enjoy the fire and MISSION ACCOMPLISHED!"). M2-M19 end at a vehicle, buoy or map edge; M20 ends with the tank leaving to the SW.
- **Many friendly escape vehicles appear only once the objectives are done** (M3, M6, M8, M9). Some drive off by themselves once everyone is aboard (the M4 patrol boat cannot be steered). The drive-off is a scripted sequence that Esc skips.
- Secondary targets (the M10 Stukas) add no merit (§2.6).

**The mission-end check** (`.INTENDENCIAINFO` block in each `.MIS`):
```
.INTENDENCIA n                 # load mission-specific code from the EXE
.INTENDENCIAINFO [
  .PUNTUACIONES [ .PAR_TICKS 3100 ]      # the only scoring parameter
  .EXITPOINTS [ [x y z] ... ]            # map-edge points
  .OBJETIVOS [ [ .OBJETIVO RADIOEXP ] ]  # required targets
  .VEHICULOHUIDA LANCHA                  # escape vehicle (optional)
  .PUNTOHUIDA [x y]                      # escape point (optional)
]
```
Per-mission rules are hard-coded controllers in the EXE, parameterized by this block. Escape vehicles are ordinary destructible units (the M4 boat has `.ENEGIA 200`) that leave on a scripted `TIPORUTA EXIT` route.

**End states in the demo EXE** (function `<addr>` returns 1-7; codes 4-7 run a **100-tick grace countdown**, about 5 s, then re-check before firing):

| Code | `GLOBAL.STR` text | Effect |
|---|---|---|
| 1 | "YOU HAVE SUCCESSFULLY COMPLETED THE MISSION." + "YOUR PASSWORD FOR THE NEXT MISSION IS %s" | Win |
| 2 | "ALL YOUR MEN MUST ESCAPE." | Warning, shown once; play continues |
| 3 | "YOU MANAGED TO ESCAPE, BUT YOU DIDN'T DESTROY THE TARGETS. YOU WON'T BE ABLE TO GO ON…" | Failure dialog |
| 4 | "ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED." | Loss |
| 5 / 6 | "NOW, YOU DO NOT HAVE AN ESCAPE VEHICLE." | Failure dialog / message |
| 7 | "YOU HAVE FINISHED THE MISSION BUT YOU DON'T HAVE AN ESCAPE VEHICLE." | Message |

Other strings: "YOU DESTROYED THE LORRY / BOAT / JU-52, BUT YOU NEEDED IT TO ESCAPE", "ALL OF YOUR MEN NEED TO ESCAPE…", "ONE OR MORE OF YOUR MEN DIED…", "THE MISSION HAS FAILED — ALL YOUR MEN ARE DEAD OR CAPTURED", buttons (C)ONTINUE, (N)EXT, (P)LAY AGAIN, and "ESCAPE …" tooltips for 14 vehicle types plus "ESCAPE POINT" and "ESCAPE AREA".

**Losing and edge cases**

| Situation | Behaviour | Source |
|---|---|---|
| A commando dies | The mission can no longer be won. Manual: "If during the course of a mission you lose a single member of the team, you will not be allowed to continue." Prima: "you could continue, but when you reach the end, the game won't let you advance." His portrait becomes a skull. Whether retail ends the mission immediately is unclear. | manual, Prima, demo M1 STR "…BUT YOU MUST PRESERVE ALL YOUR MEN ALIVE" |
| Every man dead or captured | Loss | Code 4 |
| One man captured | **Not** a failure; he can be rescued from the stockade | manual |
| A commando still jailed at extraction | Escape refused ("ALL YOUR MEN MUST ESCAPE") | strings [inferred] |
| An escortee dies (McRae, the Tunis informer, Gilbert's men) | Treat as failure [inferred]; their types `PILOTO`/`PRESO` are the same class (`BICHOALIADO`) as the commandos, and objectives say "get him and all the Commandos to the Kübelwagen" (M12), "All your characters and all the prisoners must board" (M17) | modding wiki, Prima, Kildread |
| Main objective becomes impossible | Loss: general escapes (M15), bridge blown (M16), mini-sub destroyed by the tank (M13) | manual, guides |
| Escape vehicle destroyed | Cannot be won; reload (M6 scrapbook: "The enemy can destroy the evacuation truck with their guns and rifles!") | strings, Kildread |
| Extraction before the objective finishes (M2 truck leaves before the time bomb explodes) | Dialog offers **continue** / **quick load**; after continue the bomb goes off "within a few seconds" and the mission completes | eggie M2 (code 3) |
| An alarm in certain missions | Instant or effective failure (M15, M16, M13; several "silent zone" missions). Wikipedia: "In certain missions, the sounding of an alarm will cause instant mission failure." | Wikipedia, Kildread |

The failure screen offers restart or quick reload (CGW: "the quick reload function that comes up with the failure screen").

### 2.6 Debrief, scoring and ranks

**Mission Completed card:** full-screen dark red / red-brown textured card, "MISSION COMPLETED" in large bevelled stone/metal capitals, a line of text, then "PRESS ANY KEY TO CONTINUE".

**Debrief screen** (fan wiki screenshot, German FAQ):
- **ENEMY LOSSES:** Soldiers / Vehicles / Buildings, as counts with small icons.
- **Rank name** top right (e.g. "LANCE-CORPORAL") and whether you were just promoted; a commando in uniform with a "COMMANDO" shoulder title and rank chevron fills the right side.
- **MISSION TIME:** 0-3 silver stars. **SUSTAINED DAMAGE:** 0-3 silver stars. **MISSION MERIT:** 0-3 gold stars.
- **MERIT:** a 6-slot star bar showing progress to the next promotion.
- **PASSWORD:** 5 characters (e.g. "NS2B7").
- Buttons **(N)EXT MISSION** and **(P)LAY AGAIN** (German version: "E" replays).

**What is scored** [manual]: "The points will depend mainly on the amount of time you have needed to complete the mission (the less time, the better), and the wounds you have suffered (the fewer wounds, the better)." Enemy casualties do not count toward the score, though the figure is shown.

**Merit formula:** gold = floor((time stars + damage stars) / 2):

| Silver stars | Gold stars |
|---|---|
| 6 | 3 |
| 4-5 | 2 |
| 2-3 | 1 |
| 0-1 | 0 |

**Time stars.** Each mission has its own `.PAR_TICKS` (the only scoring field): M1 3100 (≈2:35 at 20 Hz), M4 15100 (≈12:35). The other 18 values are unpublished but readable from `MAPA00nn.MIS` in an owned copy. The par-to-stars mapping is inside the retail EXE and published nowhere (the demo cannot parse `PAR_TICKS`). Players report 3 time stars needs "basically never standing still" and doing things with several men at once; 1-2 stars is easy (Ruetli). The mission clock is part of the saved game; reloading a start-of-mission save means planning time "won't accrue" (Prima). **[rec]** 3 stars ≤ P, 2 ≤ 1.5P, 1 ≤ 2.5P, else 0.

**Damage stars.** Scored as "wounds" [manual]; Prima implies end-of-mission health counts ("near the end of a mission, use any remaining treatments on wounded Commandos… This will give you more points"). Ruetli got 3 stars after injuries and never dropped to 1 or 0 by accident. Thresholds are unknown (EXE only). **[rec]** Missing health at the end as a share of team maximum: ≤10 % = 3, ≤30 % = 2, ≤60 % = 1.

**Ranks** (a promotion every **6 gold stars**; maximum 20 × 3 = 60):

| Gold stars | Rank |
|---|---|
| 0-5 | Lance-Corporal (start) |
| 6-11 | Corporal |
| 12-17 | Sergeant |
| 18-23 | Quartermaster |
| 24-29 | Lieutenant |
| 30-35 | **Captain** (unlocks M20 where gated) |
| 36-41 | Major |
| 42-47 | Colonel |
| 48-53 | Brigadier |
| 54-59 | General |
| 60 | Field-Marshal |

- **Mission 20 gate.** Manual: "if you prove your mettle, command may look to you to tackle a crucial 'ultra secret' mission". That is M20, *Operation Valhalla*. It needs **Captain (30 gold) by the end of M19**, otherwise the game ends after M19. The fan wiki and Ruetli both say some releases or languages open it to everyone; its password (US `C7KWW`) opens it directly.
- **Farming exploit:** "Play Again" from the debrief replays the mission and its stars are **added again**, so Field-Marshal can be farmed (Steam, Ruetli).
- **M10 Stukas:** the briefing sounds optional ("If you find time to wreck some of those Stukas…"), but Prima, Ruetli and eggie list them as objectives. Either way they add no merit: either escaping without them gives "…DIDN'T DESTROY ALL THE TARGETS" or they are ignored. There is no file field for bonus targets.

### 2.7 Passwords

- A successful mission gives the password for the **next** mission. There is none for M1 and none after M20. Five characters; the manual says "Write down the password". Players report I/1 and O/0 confusion.
- **Every language version and profile produces different code sets**, and "all of the codes for a specific mission work" (PCGamingWiki). Cheatcc says published passwords "give the maximum score possible up to that point".

**Published codes** (absolutcheats; other lists shown where known):

| Mission | US | German | French | Other published |
|---|---|---|---|---|
| 2 | 4JJXB | 4JJXB | YS2B7 | NS2B7 (cheatbook, debrief screenshot), YJJXB, YS2B7 (Steam) |
| 3 | 4FQBF | ZDD1T | 4MD1T | |
| 4 | 5DNCQ | RFF1J | 4GF1J | |
| 5 | 6S5TL | K4TCG | 24TCG | |
| 6 | AT1WN | MIR4M | QT1WN | |
| 10 | TUGPD | JSGPW | NU6PD | |
| 15 | KEWD3 | 139P0 | 69WDN | 739P0, C39PM |
| 20 | **C7KWW** | GDKWT | Q8U4V | YDKWT |

Other suffix examples that circulate: …S2B7 (M2), …FQBF (M3), …S5TL (M5), …T1WN (M6), …3YWX (M7), …3WJO (M8). The claim that the last four characters are stable per mission does **not** hold in general (gap 8); codes for one mission differ mostly in the first character.

**Demo encoder, decoded** (encoder `<addr>`, decoder `<addr>`; the call passes the next mission plus career globals `G+0x54`, `G+0x58`, `G+0x5c`; `G+0x58` increments on every success):
- **19 bits:** v = seq(6) | f5(5) | f4(4) | chk(4). seq = 20·campaign + mission − 1 (decoder returns mission = seq % 20 + 1); f5 = `G+0x5c` & 31; f4 = `G+0x58` & 15; chk = ((v>>10)+(v>>15)+(v>>5)) & 15.
- **Parity and whitening:** p = parity(v); e = (K1 ^ v) & 0xFFFFF, inverted when p = 1; w = (K2 ^ (e<<1 | p)) & 0xFFFFF; K1 = 0x414C4558, K2 = 0x4C404C40.
- **Text:** characters 1-4 are w in base 36, least-significant digit first; character 5 = alphabet[((w>>10)+(w>>15)+(w>>5)) & 31]. Alphabet `P4JBCN3YV8FGH2IA6KLT1XWDMO7Q9ER5SUZ-` (no zero, hence O/0 confusion). A working codec is in the research scratchpad (`pw/pw.py`).
- **Retail changed the alphabet and/or keys:** only 3 of 90 published codes pass the demo check (chance level), and all 36 of A-Z/0-9 appear in published codes; an annealing search for a permuted alphabet found only noise. The structure still fits (first, least-significant character varies with career bits). **[inferred]** In retail f4 (0-15) holds the rank (11 ranks) and f5 (0-31) the stars; entering a password restores both.
- **[rec]** Copy the scheme with our own keys: 6-bit mission, 4-bit rank, 5-bit stars, checksum, parity, base 36 plus a check character; treat O and 0 (and I and 1) as the same.

### 2.8 Saving, loading and pause

- **Save anywhere**, unlimited, at no score cost. **Save Game** (Esc menu) lists **named slots** (10 slots, German FAQ): pick a slot and type a name. Each profile has its own slots.
- **Quick save Ctrl+S** uses a single unnamed slot; reload with **Ctrl+L** or *New Game → Load Quick Saved Game*; the normal Load list cannot load it. Ruetli keeps two saves a minute apart; Prima saves at the start and after each phase.
- In multiplayer only the host ("Master") can Ctrl+S / Ctrl+L.
- **Pause: P.** Strings "GAME PAUSED" / "THE GAME IS PAUSED". A full freeze: **you cannot give orders while paused** (Metacritic user: "you can't issue orders in pause"; SAG: "I can't pause and move the cursor while paused"). Whether you can scroll or inspect cones while paused is [unknown] (SAG suggests not). Active pause / pause-and-queue is a later-series and modern convenience.

### 2.9 Difficulty

- BEL has **no difficulty setting**. Difficulty comes from mission order and team composition. The demo `GLOBAL.STR` contains unused `SKILL: EASY/MEDIUM/HARD` strings, and the demo vision code has a global that changes cone length (probably that setting; retail value unknown, §8.1).
- Squad size varies on purpose: M1 3 men; M5 and M8 only 2; M15 and M16 no Green Beret; M20 all 6 (the only such mission).
- Enemy counts (Kildread): M1 ≈14, M4 ≈50+, M14 ≈70+, M18 ≈80+ plus armour.
- Consumables are scarce: sniper rounds 3-8 per mission; 6 first-aid doses; limited SMG ammo.
- Easy/Hard first appeared in BCD (§11.4).

### 2.10 Multiplayer

- Up to 6 players co-op against AI Germans over LAN or Mplayer; fixed 640×480.
- A separate `TcpServer` app acts as server. The first player to connect is the "Master", who picks the mission and alone can save or load.
- Players claim commandos, can "abandon" and re-take characters. Ctrl+Z opens chat (Steam hotkey list); chat panel sprites `CHAT0000` (68×164) and `INPUTCHA` (594×22). A **flashing network-cable icon in the upper-left corner** means connection trouble (probably `REDLENTA`, 67×111).

### 2.11 Cheats and debug

- Type **`GONZO1982`** in-game (German version **`1982GONZO`**). The Steam build uses **`PYROFOREVER`** typed while holding Ctrl.
- Then:
  - **Shift+V**: shows the view cones of every unit (PCGamingWiki; EXE help string "Modo vision vistas"). The cheatbook's "invisibility" and systems.md's "trace" readings are superseded; the "TRACE" entries are separate debug views.
  - **Shift+X**: teleport the selected commandos to the cursor.
  - **Ctrl+I**: invincibility only ("Invencibilidad de los comandos"). The global cheat flag at `<addr>` skips both damage and ammo use.
  - **Alt+Y**: infinite ammo (not bombs). **Alt+I**: gives items.
  - **Ctrl+Shift+N**: win the mission. **Ctrl+Shift+X**: "judgement day".
  - **F9**: debug overlay with level info, object tokens (`BICHO TIP pat_cond0_0001`) and the mouse's world coordinates (`MUNDO NIVEL ACTUAL`); modders used it to write down MIS coordinates.
  - **Shift+F1 to F4**: resolutions 512×384, 640×480, 800×600, 1024×768.
  - Password **`JONxx`** skips to level xx.

---

## 3. Controls and key bindings (BEL)

Keys **cannot be remapped** and there is no controller support (PCGamingWiki). Game logic runs at about 16 fps while the mouse cursor stays smooth.

### 3.1 General keys [manual unless noted]

| Key | Function |
|---|---|
| **1-7** (main row) | Select Green Beret, Sniper, Marine, Sapper, Driver, Spy, Guest comrade (pilot, informer, prisoner leader). The manual's vehicle chapter says "1..9". |
| **0** | Deselect all |
| **8** | Select all. *CommandosHQ only; not in the manual.* |
| **F1** | Help: key list and commando profiles ("F1 displays a list of hotkeys", PCGamingWiki) |
| **F2-F7** | Camera windows: F2 = 1 (default), F3 = 2, F4 = 3, F5 = 4, F6 = 5, F7 = 6 (per-key counts from CommandosHQ and Steam; the manual only says "F2 to F7 … multiple camera modes"). Pressing the same key again cycles arrangements. |
| **P** | Pause (no orders while paused) |
| **Numpad + / − / \*** | Zoom in / zoom out / normal view |
| **Arrow keys** | Scroll the view (also mouse at the screen edge) |
| **Tab** | Move the knapsack (and with it the right-hand column) to the other side of the screen |
| **Esc** | Main menu; also skips the briefing |
| **Ctrl+B** | Briefing notes (objectives and hints) |
| **Ctrl+S / Ctrl+L** | Quick save / quick load |
| **Alt+click** | Tracking camera on a unit; Alt+click fixed ground to cancel |
| **Ctrl+click** | Fire an armed vehicle or manned gun (hold Ctrl: cursor becomes a gunsight) |
| **Shift+click** | Show an enemy's field of view, or place the red watch marker on the ground |
| **Ctrl+Z** | Multiplayer chat (Steam community list) |
| **Print Screen** | Screenshot (Prima suggests it "to make a map") |

### 3.2 Action hotkeys (the knapsack items)

Each key "works just like if you clicked on that item", but only when the selected man carries it.

| Key | Action | Who |
|---|---|---|
| **A** | Detonate remote bomb; each press fires the next bomb **in the order placed** (Prima) | Sapper |
| **B** | Drop bomb (time or remote) | Sapper |
| **C** | Lie down / crawl | all |
| **D** | Diving gear on/off (only in shallow water) / Distract (only in uniform) | Marine / Spy |
| **E** | Grenade | Sapper |
| **F** | Shovel: bury himself in snow or sand | Green Beret |
| **G** | Pistol. **With a group selected, everyone draws for mass fire.** | all |
| **H** | Hand: pick up / carry | all |
| **I** | Switch the acoustic decoy on/off | Green Beret |
| **J** | Man-trap / harpoon (speargun) | Sapper / Marine |
| **K** | First aid kit | kit carrier (Driver, else Spy, else Sniper) |
| **L** | Lethal injection | Spy |
| **M** | Submachine gun ("machine gun" on CommandosHQ) | Driver |
| **Q** | Release (drop) the acoustic decoy | Green Beret |
| **R** | Sniper rifle | Sniper |
| **S** | Stand up | all |
| **T** | Release the inflatable boat ("only works in shallow water") | Marine |
| **U** | Put the enemy uniform back on (only when unseen) | Spy |
| **W** | Pliers / wire cutters | Sapper |
| **X** | Knife | Green Beret, Marine |

**Hotkey disagreements (resolved):**
- The German FAQ lists **T** for both the boat and "Uniform anziehen". The manual, CommandosHQ and Prima say **U** for the uniform. Use U (the German release may bind it differently [unverified]).
- Prima's OCR shows the boat as "[b] at the water's edge"; an OCR error for **T**.
- Prima's OCR "(IT)" means [H].
- BCD changed many bindings (§3.6); do not copy them into BEL.

### 3.3 Mouse controls

| Input | Effect | Source |
|---|---|---|
| Left-click a commando (map or portrait) | Select him; clicking a selected man deselects him | manual |
| Ctrl + left-click portraits | Add/remove men from the selection | manual, Prima |
| **Right-button drag** on the map | Draws a **red rectangle**; men inside are selected on release (a right drag, not left) | manual, Prima |
| Left-click ground | Walk there with automatic pathfinding; a crawling man crawls | manual |
| **Double-click** ground | Run, if able (not with a heavy load) | manual, GameSpot |
| Double-click with an action cursor on a target | Run to the target, then act (knife, injection, taking a uniform from a clothesline) | Prima, German FAQ ("X / Doppelklick … für Sprint") |
| Double-click a destination while driving | Drive fast (fast driving runs soldiers over) | Prima |
| Left-click with an item cursor | Use the item there; vehicle guns fire one burst per click | manual, Prima |
| **Right-click** | Cancel the item cursor, back to the move pointer | manual |
| Right-click with a weapon drawn | **Holster.** Movement orders are not accepted while a gun or grenade is drawn. | Prima |
| Right-click while carrying | Put down the body or barrel | Prima, GameFAQs |
| Right-click while buried (Green Beret) | Rise out of the sand/snow | Prima |
| Right-click while distracting (Spy) | End the conversation | German FAQ |
| Right-click mid-climb | Green Beret stays hanging on the wall (lets you time the top) | eggie |
| Right-click the eye icon | Turn off the displayed cone | manual |
| Shift + click enemy / ground | Show that enemy's cone / place the red watch marker | manual |
| Alt + click unit / fixed spot | Track that unit / cancel tracking | manual |
| Ctrl + click (armed vehicle or manned gun) | Fire a volley at the gunsight | manual, Prima |
| Mouse near a screen edge | Scroll | manual |
| Hover over an object | Context cursor plus a delayed tooltip | SAIG blog |

**Weapon-drawn state** [Prima]: a drawn weapon is a mode; left-click fires, it does not move. You can draw while the man is moving (he keeps moving and you fire when in range). The targeting cursor shows the red circle-and-slash while the target is out of range or blocked.

### 3.4 Selection and order rules

1. **Ways to select:** portrait click, map click, number key, Ctrl+portrait (add), right-drag box (replace). Click a selected man to deselect; 0 clears.
2. **Cannot be multi-selected:** men under enemy fire, and any man who is a prisoner [manual].
3. **Selecting a man scrolls the view to him** [inferred]; for a man inside a vehicle "you will see the screen focus on the vehicle" [manual]. The Dutch FAQ complains that switching soldiers scrolls slowly when zoomed out.
4. **Group orders:** movement applies to all; the knapsack shows only the **intersection** of the group's items; **G** gives group pistol fire ("devastating"; three grouped commandos kill one soldier per volley).
5. **Vehicles:** board by hovering until the activation cursor appears; capacity enforced; only the driver moves it; straight-line moves only (§9).
6. **Buildings:** the activation cursor on a door means "hide here"; to leave, select the man and click his photo in the knapsack.

### 3.5 Menu and other input
- Esc or right-click goes back in menus. Up/Down + Enter select; Left/Right change sliders.
- The briefing is skipped with Esc; the escape drive-off sequence is skipped with Esc.

### 3.6 Beyond the Call of Duty key changes [BCD manual p.3, scan-verified; CommandosHQ agrees]

The most-used keys "moved to the left side of the keyboard". Still **no remapping**. GameSpot's Kasavin criticized that the hotkeys "had been changed from the original".

| Key | BCD action | BEL equivalent |
|---|---|---|
| A / B | Detonate / drop bomb | same |
| C / S | Lie down / stand | same |
| D | Diving gear / Distract / Lipstick (Natasha) | D |
| E | Grenade / Harpoon / Sniper rifle / Lee-Enfield | E / J / R / new |
| F | Shovel | F |
| G | Drop decoy | Q |
| H | Hand | H |
| I | Decoy on/off | I |
| J | Handcuffs (GB, Spy) / Wire cutters | new / W |
| K | First aid | K |
| N | Inflatable boat | T |
| Q | Pistol | G |
| R | Puppet | new |
| T | Hanger (Spy) | new |
| U | Reuse / cycle uniform | U |
| V | Cigarettes | new |
| W | SMG / Knife / Trap / Lethal injection | M / X / J / L |
| X | Blackjack / Fist / Chloroform (knock-out) | new (BEL X = knife) |
| Y | Stone | new |

Unchanged: 1-8 select (7 = Skopje, 8 = Natasha "Lips"; CommandosHQ's "7 = Dutch contact, 8 = all" was copied from its BEL page) and 0 deselects; Tab; arrow keys; numpad zoom; F2-F7; Alt/Shift/Ctrl+click; Ctrl+S / Ctrl+L; Esc. P and F1 are assumed unchanged [inferred].

---

## 4. User interface and HUD

### 4.1 Layout and resolution behaviour

- A fixed-camera view (no rotation) framed by interface on the **top and right edges**; the bottom and left have no interface and the map runs to the screen edge. GameSpot: "an unobtrusive and clever interface [that] borders the screen".
- **The interface is drawn at a fixed pixel size.** Higher resolutions show more map, not bigger art ("The greater the resolution is, the wider the game area will be … but … everything will be smaller"). Verified by measurement: health bars at x = 56-60, 121-125, 186-190 and a 45-47 px top bar in both 640×480 and 1280×720 captures. Players consider higher resolution a real advantage (more warning time).
- Each resolution has its own interface WAD (`640X480.WAD`, `1024X768.WAD`).

Reference layout at 640×480 [measured]:
```
x: 0                          389 ~405   ~450   ~485 ~503 ~520   ~575 588   640
y0 +-----------------------------+--o--+-------+----+---+----+------+----+-----+
   | [P1 ][|] [P2 ][|] [P3 ][|]... |  o  | prone |    | ? |    |CAMERA|    | EYE |
   |  portrait+red bar, pitch 65 |  o  | icon  |    |   |    | icon |    |photo|
45 +=============================+==o==+=======+====+===+====+  |   |=+====+-----+  <- 2px shadow line
   |                                                             |   |  |notebook|
   |                                                          (camera grip)|(spiral)|
   |             GAME VIEW (map, units, cones)                       | ~33 px |
   |                                                           ~270  +--------+
   |                                                                 | canvas |
   |                                                                 | strap  |
   |                                                           ~267  |  HAND  |
   |                                                           ~333  +--------+
   |                                                      +-------------------+
   |                                                      |  KNAPSACK 112x149 |
480+------------------------------------------------------+-------------------+
```

### 4.2 Top bar

- A full-width strip about **45 px** tall with a ~2 px darker shadow line; at 640×480 it is `BARRA01` (389×45) + `BARRA02` (199×45) + the eye photo `P_OJOAL0` (52×45) = 640 px. Wider resolutions extend it with more texture [inferred].
- Texture: **woven military canvas webbing**, dark brown, about rgb(35-39, 28-32, 23-24); shadow line about rgb(17,15,11). A column of 4-5 small metal eyelets at x ≈ 390-396 where the two pieces meet.
- **Portraits:** one framed portrait per commando in the mission, packed from the left at a **65 px pitch**; frame `MARC0000` 62×44, face about 40×40. `BARRA01` fits exactly 6 slots; where a 7th (guest) portrait goes is unconfirmed. Portraits are grey-toned painted faces.
- **Selected men are in full colour; unselected men are greyscale.** This is the main selection indicator; no world-space selection ring appears in any screenshot or text [inferred].
- **Health bar:** a vertical red bar to the right of each face in a dark recessed slot (`SANGRE` 9×37). Visible fill about 5-6 px wide × 34 px tall, colour about rgb(100-108, 0, 0). It drains **from the top down**. When empty the commando is dead and **a skull replaces his portrait** ("a series of lovely skulls displayed on the upper part of the screen").
- Clicking a portrait selects; Ctrl+click adds/removes. Selecting a man in a vehicle or building moves the view to it; his knapsack then shows only **his photograph**, and clicking it makes him get out.
- **Icons on the right half** (x at 640×480):

| Icon | x | Sprite [WAD] | Function |
|---|---|---|---|
| Posture toggle: little green soldier prone or standing | ≈405-450 | `AGACHAR` 47×32 (prone), `DEPIE` 24×47 (standing) + hover versions | Click = lie down (C); the standing icon in the same place = stand (S). It shows the posture you can switch to [inferred]. |
| "?" in pale blue metal | ≈485-503 | `INTERROG` 18×34, `M_INTER` | Help (probably = F1) [inferred] |
| Movie camera (vintage film camera) | ≈520-575 | `CAMARA` 55×69, `M_CAMARA` | Tracking camera; its grip hangs below the bar over the map |
| Eye: photographic close-up of a human eye with a blue iris, top-right corner | 588-640, y 0-45 | `P_OJOAL0/1` 52×45 (two frames, probably blink), `M_OJOALE` | Enemy sight tool (§4.6) |

- **Hover states:** most clickable sprites have a plain and an `M_` version (`M_PISTOL`, `M_CAMARA`, `M_DOBLEZ`); the manual's "highlighted green" folded corner implies `M_` = mouse-over highlight.

### 4.3 Right column: notebook, hand, knapsack

A vertical canvas strap (about 32-36 px wide; `BARS0000` 36×442 [inferred]) with eyelets and a steel buckle, about rgb(36,31,22), runs down the right edge. The notebook is top-anchored; the hand and knapsack are bottom-anchored (at 1280×720: notebook y ≈ 55-270, hand ≈ 505-570, knapsack ≈ 570-720).

**Map notebook (minimap)**
- **Closed:** a spiral-bound notepad seen edge-on: a strip of pale paper about 33 px wide (x ≈ 607-640, y ≈ 67-273 at 640×480) with black spiral rings at the top.
- **Open:** clicking unfolds it leftward (about 183×215 px measured, x ≈ 457-640, y ≈ 60-275). **The notebook art is a separate file per mission**: M1 185×229, M2 260×200 (another measurement gave 155×195), so all measurements can be right.
- Page: a **hand-drawn ink sketch** of the mission on pale khaki-green lined paper (about rgb(169,173,123)); rocks are circles, walls double lines, barbed wire "XXXX", buildings rectangles.
- **Symbols:** black rectangle = area on screen; **red circles** = main objective(s); **blue dots** = your men; **red dots** = enemies.
- Click anywhere on it to jump the view. It **closes by itself** when the mouse moves away; it cannot be pinned open.
- **Folded corner** (green, `DOBLEZ`/`M_DOBLEZ` 23×22): opens the Briefing Notes page (typed text on a notebook page), same as Ctrl+B.

**Hand button**
- A realistic open palm in skin tone, about 50×65 px, just above the knapsack. Click it or press **H** for the pick-up cursor.
- The cursor becomes a hand inside a "prohibited" sign; over something the man can take, the sign vanishes and the hand does a **grabbing animation**.
- Picks up bodies, barrels, the decoy, the boat, traps, ammunition and weapon pickups, each limited by who may carry it.

**Knapsack (inventory and action panel)**
- An **olive-drab military rucksack**, about rgb(48,47,29), with leather straps, brass buckles and a steel ring; `MOCHILA` **112×149**, anchored bottom-right.
- **Item icons are painted on top of it**, overlapping it and each other (pistol `PISTOLA` 53×71). Examples: Green Beret: decoy (round brown speaker with a grille), knife, pistol. Sniper: scoped rifle across the top, white first-aid box with a red cross, the pistol, and **a row of brass cartridges along the bottom, one per remaining bullet**. Driver: SMG.
- Clicking an item either acts at once (inflate boat, drop decoy, don diving gear) or turns the cursor into that item's targeting cursor.
- **Remote items:** after dropping a remote bomb or the decoy, a **detonator/activator icon replaces it**; click it or press A/I. The decoy can be toggled as often as you like.
- **Group selection** shows only common items.
- **Vehicle or building occupant:** only the man's photo; click it to get out. Passengers in the Marine's boat show as "a small photo of the commando … above the backpack".
- **Tab** swaps the knapsack side. The default is upper right (the manual puts the eye icon there); the German FAQ ("oben links") and SAIG blog ("map in the top left") describe the flipped layout. Treat the left/right placement as simply the Tab setting (gap 8).

### 4.4 Cursors

A **"forbidden" overlay** (red circle with a diagonal slash) is added whenever the action is impossible at that spot (out of range or blocked). The Dutch FAQ recommends sweeping the cursor over everything to discover interactions.

| Cursor | When | Source |
|---|---|---|
| Movement pointer: gold, brass-looking double-arrow chevron with a small star | Default with a man selected | manual |
| Forbidden overlay | Invalid, out of range, blocked | manual, Prima |
| **Activation pointer**: "a hand that moves a lever" | Something the selected man can operate: switches, taps/valves, gates, phones, ladders (click to climb), doors of enterable buildings, vehicles he may board, manned-gun posts, barrels (Green Beret), clothesline uniforms (Spy). It does *not* appear on a vehicle that is out of commission or enemy-occupied. | manual, Prima |
| Pick-up hand (in a prohibited sign → grabbing hand) | After H / hand button | Prima, GameFAQs |
| Climbing pick ("T-like form") | Green Beret over a climbable wall; click to climb, click the far side to climb down | GameFAQs, Prima |
| Body-in-barrel icon | Green Beret carrying a barrel over a corpse | Prima |
| Knife | X | Prima |
| Pistol (grey-green automatic) | G | manual |
| **Sniper scope** | R | Prima, screenshot |
| Crosshair/reticle | M (SMG); Ctrl over a vehicle weapon or manned gun | Prima |
| Syringe | K (first aid) and L (lethal injection) | Prima |
| Officer's cap | D (Spy distract) | Prima |
| Speargun | J (Marine) | Prima |
| Grenade, pliers | E, W [shapes inferred] | manual |
| Eye, which **blinks over a valid target** | Eye icon or Shift | manual |
| Tracking pointer: four orange arrows around a dark centre | After clicking the movie-camera icon | manual |

- **Sniper scope detail** [measured, Steam 1280×720]: circular, about 88 px across, thick dark metal bezel, thin black full-width crosshairs; **what is under it is magnified about 2×**; a small green corner-bracket box with a red centre dot marks the enemy under the crosshair. The scope turns red when the target is out of range or blocked. Prima: "The cursor will change to a reticle view that magnifies anything it's placed over."
- **Placement marker (unconfirmed):** `GLOBAL.WAD` has `ESTRELLA1/2` (27×27 star frames) and the movement-pointer figure shows a star; blog screenshot 046 shows yellow sparkles at a unit's destination. Probably an animated destination marker [inferred].
- Several cursors are large, animated or magnifying, so a remake needs a software cursor [inferred].

### 4.5 Camera controls

- **Scrolling:** arrow keys, or the mouse near a screen edge. The whole map can be scrolled from the first second; the manual recommends doing so before giving orders. The notebook jumps the view.
- **No camera rotation** in BEL (rotation came with *Commandos 3*).
- **Zoom:** numpad + in, − out, * normal; "from a detailed view to a general panoramic view". Zoom-out measured at roughly **0.45-0.5×** (the same house is 190 px at normal zoom and 85 px zoomed out). Zooming in magnifies the bitmap into blocky pixels (one frame shows about 4×). The EXE stores zoom as a **float per view window**, so the exact steps are unknown. Zooming out made scrolling very slow on 1998 PCs and loses detail. BCD advertised "improved graphics (noticeable when zooming)".
- **Tracking camera:** click the movie-camera icon then a person or vehicle, or **Alt+click** it. The view stays centred on it, and a small **camera icon in the lower-left corner of that window** (`CAMAESQU` 43×47, manual figure "GR41") shows it is following. Stop by clicking that corner icon or Alt+clicking fixed ground. Enemies can be tracked too (GameSpot mentions following patrols).
- **Multiple camera windows:** F2-F7 give 1-6 windows; pressing the same key again cycles arrangements (undocumented). Only **one window is active**, framed by a **red line**; click a window to activate it. Movement, zoom and actions happen in the active window. Windows cannot be resized individually. "The more open camera windows, the slower the gameplay speed" [manual]. Typical use: one window per isolated commando or one on a patrol.

### 4.6 The enemy-sight tool ("eye") and cone display

- Click the eye icon (pointer becomes a blinking eye over valid targets) then an enemy, or **Shift+click** the enemy. Works on soldiers and on **vehicles, bunkers, towers and MG nests**. A dead or empty post has no cone (AGC FAQ, M19).
- The cone "sweeps from left to right across the mission and accompanies the soldier's every move" [manual]. SAG: a guard "always seems to snag me on the very edge of his vision range as it flickers about".
- Drawn as a **translucent flat overlay on the ground layer, under tall sprites**, so trees and roofs cover it; walls, houses and rocks cut the fan (it is a visibility polygon, not a plain sector). Two flat tones with hard straight edges and no gradient: a lighter near band and a darker far band.
- **Colours are hard-coded in the EXE** (`<addr>`, setter `<addr>`; saved as `COLORVISTACERCA` / `COLORVISTALEJOS "%ld %ld %ld"`):

| Set | Near band | Far band |
|---|---|---|
| Default green | RGB(2,188,111) `#02BC6F` | RGB(7,103,90) `#07675A` |
| Desert orange (`.TIPOTERRENO 1`) | RGB(210,110,2) `#D26E02` | RGB(107,76,1) `#6B4C01` |

  Drawn as flat 50 % blends (the engine's translucent `FE` runs are 50 % blends). Earlier reports' values are **blended screenshot samples**, not the source colours: near about (43-64, 129-154, 68-90) and far about (24-52, 78-90, 52-65) over dark grass; rgb(109,202,157) / rgb(33,121,66) over grass or snow; dominant #21864a, darker #187539, lighter #429e63 over snow; a pale cyan (216,252,248) on a Steam snow screenshot that remains unexplained. There is **no hatching**; only two flat colours are stored.
- **Only one cone is shown at a time**, but "ALL your enemies have their fields of view operating simultaneously". Right-click the eye icon to hide it.
- **Watch marker:** Shift+click bare ground (or eye then ground) leaves a **red mark**. "The first time that the enemy sweeps his view past this mark, his field of view will be lit up. This means he can see you if you were there." (SAG: "it'll lock on to the first guard that turns to look there".)
- **When spotted:** "Each time you are seen by an enemy soldier, the spotting soldier's field of view will be automatically illuminated." No BEL source says the cone changes colour. The green/**red** alert cones, the blue-to-red "line of detection", three-level cones and Tab-to-show-cone all come from the fandom page *Enemies and Their Kinds*, which is scoped to *Commandos 2/3* [sequel].

### 4.7 Tooltips, warnings and screens

- **Tooltips:** a hovered object gets a caption such as "EXPLOSIVE BARREL" / "BARREL": a black (or grey bevelled) box with a thin light border and white bold condensed uppercase text, just below and right of the object, after a noticeable delay ("these tooltips take way too long to appear"). Per-mission text lives in the mission `.TIP`/`.POL` file. Tooltip names in the demo `GLOBAL.STR` include SOLDIER, SERGEANT, MACHINE GUNNER, ENGINEER, DOG, GARRISON, PRISON, BUNKER, and "ESCAPE …" for 14 vehicle types.
- **Warning flashes (BEL):** the option exists but what flashes is undocumented. visuals.md's "portrait of a commando in danger flashes" is unsourced; the demo interface files contain no warning sprite (gap 8). `GLOBAL.WAD` holds `ALMR0000` (29×52) and `ALMR0001-0003` (103×103), probably the flashing red **siren icon** `ALARMA01-04` that runs while the siren sounds [inferred link, gap 1].
- **BCD "Commando Warnings"** (documented): a portrait turns **blue while that man is seen** and **flashes red while he is attacked**.
- **Mission Completed** and debrief screens: §2.6. Briefing screens: §2.4.

### 4.8 Interface sprite inventory

From `GLOBAL.WAD` / `640X480.WAD` in herbert3000's ModExamples "InterfaceMod" (entry header: 32-byte name, data size, height, width, bpp 8; sizes given W×H). Palettes are RGB565 `*.PAL`. **Do not ship these assets**; use them only as size references.

| Sprite | W×H | Meaning |
|---|---|---|
| BARRA01 / BARRA02 | 389×45 / 199×45 | Top-bar canvas pieces |
| BARS0000 | 36×442 | Probably the right strap [inferred] |
| MARC0000 | 62×44 | Portrait frame ("marco") |
| SANGRE | 9×37 | Health bar ("blood") |
| AGACHAR / M_AGACHA | 47×32 | Lie-down icon + hover |
| DEPIE / M_DEPIE | 24×47 | Stand-up icon + hover |
| INTERROG / M_INTER | 18×34 | "?" help |
| CAMARA / M_CAMARA | 55×69 | Tracking-camera button |
| CAMAESQU | 43×47 | Tracking badge in a window corner |
| P_OJOAL0 / P_OJOAL1 / M_OJOALE | 52×45 | Eye button (two frames + hover) |
| DOBLEZ / M_DOBLEZ | 23×22 | Notebook folded corner |
| MOCHILA | 112×149 | Knapsack |
| PISTOLA / M_PISTOL | 53×71 | Knapsack pistol item + hover |
| ESTRELLA1 / ESTRELLA2 | 27×27, 27×26 | Stars; possibly destination marker |
| ALMR0000 / ALMR0001-3 | 29×52 / 103×103 | Probably alarm/siren graphics |
| CANT0000 | 49×86 | Unidentified |
| CHAT0000, INPUTCHA | 68×164, 594×22 | Multiplayer chat |
| REDLENTA | 67×111 | Multiplayer slow-network icon [inferred] |
| CUR20000, CURS0000 | 24×14, 5×3 | Probably text-entry cursors |

---

## 5. The commandos

### 5.1 Names and naming variants

"Tiny" is the **Green Beret**, not the Driver. Decision for the remake: use the **US manual names** as the primary locale (Tiny, Duke, Fins, Inferno, Tread/Sid, Spooky) and the European names as an alternative locale (gap 8).

| Role (select key) | Engine token | US manual (1998) | Official-site dossier / European | Later canon (fandom, ES Wikipedia) |
|---|---|---|---|---|
| Green Beret (1) | `COMANDO` | **Jerry McHale "Tiny"** | **Jack O'Hara "Butcher"** | Jack O'Hara; "Butcher"/"Tiny". Most official manuals use Jerry McHale; *Commandos 3* patched the name to Jerry McHale and the HD remaster changed it back to Jack O'Hara. |
| Sniper (2) | `FRANCOT` | Sir Francis T. Woolridge "Duke" | same | same |
| Marine (3) | `LANCHERO` | James Blackwood "Fins" | same | same; called **"Diver"** from *Commandos 2* on (the fan wiki uses Diver for BEL too) |
| Sapper (4) | `ARTIFIC` | Thomas Hancock **"Inferno"** | Thomas Hancock **"Fireman"** | Inferno / Fireman; *Origins* calls the class "Engineer" |
| Driver (5) | `CONDUC` | **Sid Perkins "Tread"** (once "Sam": "Sam can also capture heavy machineguns") | Sid Perkins "Tread" | **Samuel Brooklyn** (Sid Perkins is his alias); ES Wikipedia "Brooklyn"; the Spanish text reads "Dice llamarse Sam" |
| Spy (6) | `ESPIA` | René Duchamp **"Spooky"** | René Duchamp **"Frenchy"** | Spooky / Frenchy |
| Guest (7) | `PILOTO`, `PRESO` | Pilot, informant, prisoners | — | — |

**Biographical data** (CommandosHQ dossiers, fandom, ES Wikipedia; heights ES metric / HQ imperial, weights HQ):

| | Nationality | Born | Height ES / HQ | Weight | Rank |
|---|---|---|---|---|---|
| Green Beret | Irish | 10 Oct 1909, Dublin | 2.10 m / 6'5" | 220 lb | Sergeant |
| Sniper | English | 21 Mar 1909, Sheffield | 1.80 m / 6'2" | 180 lb | Soldier |
| Marine | Australian | 3 Aug 1911, Melbourne | 1.81 m / 6'1" | 181 lb | Soldier (ex-Captain, demoted to Sergeant) |
| Sapper | English | 14 Jan 1911, Liverpool | 1.75 m / 6'0" | 175 lb | Soldier |
| Driver | American | 4 Apr 1910, Brooklyn | 1.83 m / 6'2" | 183 lb | Soldier |
| Spy | French | 20 Nov 1911, Lyon | 1.79 m / 6'4" | 179 lb | Soldier |

The ES Wikipedia *series* page is an outlier (Driver born 1923, Spy 1905); the game page agrees with the table.

### 5.2 Engine stats per commando

From the per-character table at `<addr>` [EXE] (16-byte records {token, energy, run speed, tooltip}); conversions at 20 Hz and 0.045 m/unit:

| Token | Commando | Energy (HP) | Run (u/tick) | Run (u/s) | ≈ m/s | Walk |
|---|---|---|---|---|---|---|
| COMANDO | Green Beret | **200** | **6.0** | 120 | 5.4 | 2.5 u/tick (≈2.25 m/s) for all |
| CONDUC | Driver | **130** | **6.0** | 120 | 5.4 | |
| LANCHERO | Marine | **160** | 5.0 | 100 | 4.5 | |
| ESPIA | Spy | **160** | 5.0 | 100 | 4.5 | |
| ARTIFIC | Sapper | **130** | 5.0 | 100 | 4.5 | |
| FRANCOT | Sniper | **100** | 5.0 | 100 | 4.5 | |
| PILOTO / PRESO | Pilot / prisoner | 100 | 5.0 | 100 | 4.5 | |

- Matches the manual: "Each Commando can 'suffer' a certain number of wounds… **Tiny is your strongest and Duke your weakest**", and ES Wikipedia/fandom: Green Beret and Driver are the fastest runners. The Marine is described as slowest "more so when carrying the inflatable boat": in the data he runs at the common 5.0, and **carrying the raft costs −1.0 u/tick** (`<addr>`).
- Crawl speed was not recovered (`MotorAliado` stores an unexplained 1.0 at `+0x124`); placeholder about 1.0 u/tick (≈0.9 m/s) [inferred].
- Collision: every commando is a `BICHOALIADO` with a cylinder **R 10, H 40** (`.VOLCOLISION [ CILINDRO [ .R 10 .H 40 ] ]`). Enemy soldiers use R 10, H 29 (render volume R 10, H 40).
- Animation strides (`.ANM`, units per 8-frame cycle): walk 33, run 75, crawl 30 (Spy 35); German run 55. Walk and run both cycle about every 13 ticks, suggesting foot-locked animation (2.5 × 13 ≈ 33; 6 × 13 ≈ 78) [inferred].
- Pistol draw time: 6 ticks for the Green Beret, 4 for the Spy and Driver [data].
- Commandos die in "one or two shots" in practice (reviews). Stamina: none [inferred].

### 5.3 What every commando shares [manual unless noted]

- **Selection:** keys 1-7 or portrait/unit click (§3.4).
- **Movement:** click walk, double-click run (not with a heavy load: barrel, body). **Everyone can go prone** (C) and stand (S); "Commandos cannot fast crawl". In the engine every commando can climb ladders (`auEscalar`) and leaves footprints (`acDejarRastro`); only the Green Beret has `.ESCALAMUROS SI` (climb walls).
- **Pistol (G):** the manual's "W9", a Smith & Wesson 9 mm automatic with a 10-round magazine; "can be used at will and has **unlimited ammo**". Noisy: soldiers within a radius hear it. About **3 hits to kill** a soldier (Prima, CommandosHQ, fandom).
- **Hand (H):** picks up items; restricted by role (only the Marine picks up the boat, only the Sapper grenades and explosives, only the Green Beret barrels, only the Green Beret and Spy bodies).
- **Activation pointer:** switches, taps, gates, telephones, ladders, doors, vehicles, gun posts; only units allowed to use a device get it.
- **Buildings:** some doors let units hide inside (invisible). You cannot hide bodies in buildings or shoot from them. Leave by clicking the man's portrait in the knapsack.
- **Vehicles as passengers:** anyone can ride, subject to capacity; only the vehicle's operator steers it (§9).
- **Health:** red bar per portrait; any death fails the mission; skull portrait.
- **Being caught:** see §7.7.
- **First aid kit (K):** one per mission, carried by the first of **Driver → Spy → Sniper** who is deployed.
- **Swimming:** only the Marine enters deep water, and only with diving gear; everyone else is limited to shallow water and boats [inferred from the rules; no source says outright that others cannot swim]. In *Commandos 2* everyone swims; not in BEL.

### 5.4 Green Beret: Jerry McHale "Tiny" / Jack O'Hara "Butcher"

**Backstory:** Irish heavyweight boxer and Army boxing champion four years running (1934-1937). In 1938 a court-martial sentenced him to 14 years' forced labour for striking an officer; commuted when he joined the Commandos. Promoted to sergeant after the Vågsøy raid: shot in the arm, cut off and out of ammunition, he broke into a bunker and killed 16 Germans. "Only his mom can call him 'tiny'." Modelled on Charles Bronson in *The Dirty Dozen* (fandom).

| Item | Key | Behaviour |
|---|---|---|
| Knife (Wilkinson Sword, 177 mm) | X | Silent kill (engine damage 120, `<addr>`). **Double-click the target to sprint up and stab.** |
| Pistol | G | §5.3 |
| Acoustic decoy ("lure") | Q drop, I on/off | Once dropped, an activator appears in the knapsack and toggles the noise repeatedly. The nearest soldiers come to investigate; some rooted sentries only turn to look. He must walk back and pick it up with H. The manual credits "Major Arthur Forester"; fandom calls it the "Phillips L12". Data: `SEGNUELO .INTERVALOSND 30` (a pulse every 1.5 s). |
| Shovel | F | Snow or sand only. Right-click to come up. **Invisible while buried** unless someone watched him dig in; guards can walk over him. Kildread lists it in missions 1-11 only ("no shovel from here on" at M12). |
| Climbing axe | (cursor) | Climbs "the smoothest wall and the steepest rock face"; climbable surfaces (SEC flag 64, "connections") turn the cursor into a T-like pick. Walls, cliffs, a drainpipe (M20). |

- **Carry explosive fuel barrels** (the only one strong enough); right-click drops. Anyone can shoot a barrel.
- **Carry bodies** (H, right-click to drop), shared with the Spy only.
- **Hide a body under a barrel:** click the corpse while carrying a barrel; one barrel hides one body.
- Lowers raised ladders from above for the team (M2).
- Toughest (200 HP); fastest runner (tied with the Driver); vehicles as passenger only.
- **Not in BEL:** poles, wires, jumping from heights, punching unconscious (BCD), handcuffs (BCD), using any enemy weapon (C2).

**Voice:** gruff; his biography is Irish and the SAIG playthrough transcribes his accent as "dat". Lines: "Consider it done!", "Comin' over. Comin'! I'm comin'!", "Coming.", "Just leave it to me.", "That's easy.", "Okay.", "Mhmm."; hurt: "Ah! Dat hurts! Get me outta here!"; can't do it: "Huh. Wish I could do dat.", "Are you crazy?". ("Shit!" when shot is from BCD and later.)

### 5.5 Sniper: Sir Francis T. Woolridge "Duke"

**Backstory:** a Sheffield aristocrat. Military Medal at Narvik for killing the German garrison commander with one shot from more than a mile away. The US manual says he taught Anders Lassen to shoot. Olympic shooting gold in 1936 (CommandosHQ says Munich, which is wrong; fandom says Berlin). India 1937-1939; Commandos 1940.

| Item | Key | Behaviour |
|---|---|---|
| Sniper rifle (`MIRILLA`; fandom: M1903 Springfield) | R | Silent, range 1000, **one-shot kill**, limited ammo shown as brass cartridges. Scope magnifies ×2 and turns red when out of range/blocked. Post-fire delay 10 ticks (0.5 s), about 0.6-0.8 s total per shot [inferred]. **Duke kneels to fire, so he can be seen in the long-range cone** (CommandosHQ). Can fire from inside a boat (Kildread). |
| Pistol | G | "Click several times for rapid fire." |
| First aid kit | K | Only when neither Driver nor Spy is deployed |

- Extra rounds from ammo boxes: `CAJABALA .BALAS 3` (M4's "3 more bullets on site"). Unused ammo field `.MUNFUSIL` exists.
- Guards on lower levels can still see a comrade fall, except on multi-level roofs (M12), where silent kills up high are not seen from below.
- Weakest (100 HP; ES Wikipedia "más débil que sus compañeros"). Pole climbing is C2.
- **Voice:** "upper-class cadence and ice-cold, imperturbable" (the playthrough: "boring British voice"). Line: a casual "Yep…" when ordered to kill.

### 5.6 Marine: James Blackwood "Fins"

**Backstory:** born in Melbourne, educated at Oxford; naval engineer and rower; swam the English Channel for a bet. Navy captain in 1936, demoted to sergeant in 1938 after a club brawl during a Hawaii stopover; given the choice of expulsion or joining the Commandos as a private. Military Cross for rescuing 45 men at Dunkirk. A drinking problem "apparently under control". "Could cross the Atlantic in a shoe box."

| Item | Key | Behaviour |
|---|---|---|
| Knife | X | As the Green Beret's, including double-click rush (Kildread lists no knife for him in M7) |
| Harpoon gun (speargun, `ARPON`) | J | Silent, one-shot kill (instant-death impact type), unlimited, **shorter range than the pistol**: 200 units in the EXE weapon table, 100 per herbert3000 (who notes a patch may have changed it); post-fire delay 60 ticks (3 s). Works on land and from the water. |
| Pistol | G | |
| Inflatable boat ("Zodiac") | T deploy (shallow water only); H pick up and deflate | Carries 3. "Germans often shoot the launch on sight", so pack it up after use. A shot boat deflates rather than being destroyed (fandom). Only he can pick it up. |
| Diving gear | D | The icon appears only when he stands in shallow water; he can also submerge from a boat. |

- **Diving:** invisible while submerged **unless someone saw him go under** (then they know where he is and shoot). No oxygen limit in BEL. To come out, swim to shallow water, click the gear, stand up on shore. He can surface "armed and ready" (GameSpot) to knife or harpoon. Engine detail in §8.1.
- **Only operator of boats:** the inflatable, small boats (M7, M14, M19), the one-man mini-sub with **2 torpedoes** (M13). (The M4 patrol boat drives itself.)
- **Cannot carry bodies**, so he needs the Green Beret or Spy to hide his kills (GameSpot).
- A Marine rescued after arrest in M17 has **lost his diving gear** (fandom).
- **Known bug (do not copy):** if two commandos board the raft just as he deflates it, they ride along hidden "in his backpack" while he dives.
- **Not in BEL:** throwing knives, grappling hook, climbing trees or buildings (C2).
- **Voice:** "really sarky"; gamesof1998 hears "cockney and somewhat annoyed", which conflicts with his Australian biography. Line: "Coming right over! ……… sir."

### 5.7 Sapper: Thomas Hancock "Inferno" / "Fireman"

**Backstory:** Liverpool, chemistry degree; joined the Fire Brigade at 22 (1933) and its high-risk explosives department in 1934. Army 1939; Commandos 1940. Set the demolitions in the St Nazaire raid; captured, he tried to escape four times in eight weeks, then crossed the Pyrenees back to England. An English gentleman "with an explosive temper"; "Fireman" is a deliberate double meaning.

| Item | Key | Behaviour |
|---|---|---|
| Pistol | G | |
| Bear trap (man-trap, `CEPO`) | J | Cyanide-coated blades. Drop it on a path; the first soldier who steps on it dies silently (instant-death impact). Guards don't see the trap, but they see the body. **Works once; pick it up (H) and re-set.** Present in every mission he is deployed in. |
| Time bomb | B | "Explodes 10 seconds after being released… run man, run" [manual]. `BOMBARET` default `.RETARDO 200`; set per instance (M4 crate bomb 150 = 7.5 s). CommandosHQ says 11 s; an unattributed web estimate says 6-7 s; fandom's 20 s is C2. Often found or captured during the mission. |
| Remote bomb | B drop, **A** detonate | A detonator item replaces it in the knapsack; A fires bombs in placement order. |
| Grenades | E | Thrown (range 300); out of range shows the forbidden cursor. Can be thrown over walls. **Can kill the Sapper himself** ("shrapnel cuts both ways"). Loud; usually sets off the alarm. Counts 1-4 (M4 3, M10 4, M11 1, M18 2). Blast radius not recovered (placeholder 100-150 units); fandom's "3 m" is series-wide. |
| Wire cutters ("pliers") | W | Cut a gap in wire fences; **not** German reinforced barbed wire; electrified fences must be switched off first (M3). |

- **Only the Sapper can pick up, carry or activate explosives** and grenades. Explosive barrels are the exception (Green Beret carries, anyone shoots).
- **A mission gives him time bombs or remote bombs, never both** (modding wiki; consistent with Kildread's loadouts).
- **Mine detector: not in BEL** (absent from manual, hotkeys and the full inventory-token list; fandom's article is C2). BEL mines are invisible hazards.
- **Voice:** English (no Liverpool accent in any game). No BEL lines found.

### 5.8 Driver: Sid Perkins "Tread" (later Samuel Brooklyn)

**Backstory:** American career criminal (car theft, armed robbery) who fled a prison sentence to England in 1937 and joined the British Army; in "custodial collaboration" with the Foreign Office he tested captured weapons and vehicles; recruited by Paddy Mayne ("Maine"). In the Tamet airfield raid with the LRDG he destroyed 8 fighters with his jeep's Vickers K, then rammed the jeep into the fuel-laden remaining aircraft, destroying 4 more, and was badly burned. Mistrustful; does not get on with the team.

| Item | Key | Behaviour |
|---|---|---|
| Pistol | G | |
| Submachine gun (`METRALLETA`; fandom: M3 Grease Gun) | M | Range 400; a "deadly fan-shaped volley" that kills in one burst; loud (Kildread: "produces too much sound to be useful"). **Ammo: missions set `.MUNMETRA 100` rounds, and the HUD shows rounds ÷ 5, i.e. 20 bursts** (so CommandosHQ's "20" and the modding "100" are both right). 5 rounds per trigger (weapon table), about one burst per 16 ticks (0.8 s) [inferred]; the parser's default `TAMANO_RAFAGA` is 10 (gap 8). Demo crate `.BALASINICIALES 50`. Spread arc not recovered (placeholder 5 rays over about ±15°). **Not standard kit:** Kildread lists it only in M1, M2, M4 (air-drop) and M10. |
| First aid kit | K | Primary medic |
| Vehicle / fixed weapons | Ctrl+click | |

- **Only the Driver drives land vehicles** (trucks, Opel Blitz tanker, staff cars, Kübelwagen, motorcycle, SdKfz, Panzer II/III/IV) and crews captured **MG nests and gun posts**: kill the gunner, click the post to man it, Ctrl+click to fire, click his portrait to leave. A fixed gun leaves him exposed. The 210 mm mortar/cannon can never be used.
- Fastest runner (tied); 130 HP; "has no way to kill silently on his own" (ES Wikipedia) except running men over. Cannot carry bodies, swim or climb walls.
- **Not in BEL:** the club and Lee-Enfield (BCD), gas grenades and Molotovs (C2).
- **Voice:** "Brooklyn accent", enthusiastic. "Sure thing!", "Okie dokie!", "Consider it done, boss!", "No problem, boss!", "No problem man.", "Right away.", "I'll be right there.", "Finally, some action.", "Why don't you try it, boss?"; when killed: "This looks bad!".

### 5.9 Spy: René Duchamp "Spooky" / "Frenchy"

**Backstory:** born in Lyon; French Secret Service at 25; security chief at the French Embassy in Berlin 1935-1938. Co-founded a Resistance cell credited with at least 3 trains, 14 tanks and more than 30 other vehicles (fandom: 50). Speaks French, German, English, Italian and Russian and can mimic German generals' voices. A part-time member of the Commandos.

| Item | Key | Behaviour |
|---|---|---|
| Pistol | G | He finds firearms "not refined". |
| Poison syringe (lethal injection, `JERINGUILLALETAL`) | L | Potassium cyanide, instant kill; slightly slower than the knife but **leaves no blood** ("a clean kill", Kildread); unlimited. |
| Enemy uniform | U (re-dress) | Usually **found on a clothesline**; the activation cursor takes it. He becomes an officer and "the enemy ignores the Spy". |
| Distract (officer's braid; cursor = officer's cap) | D | **Only in uniform.** Click any soldier; he stops and talks ("Guten Tag") "regardless of his rank or function" until you right-click. **The target turns to face the Spy**, so the Spy's position decides where the guard looks. **Distracting a patrol sergeant freezes the whole patrol.** Lasts indefinitely (Kildread) or until gunfire, an explosion or an alarm (Prima); both hold. |
| First aid kit | K | When the Driver is absent |
| Carry bodies | H | Shared with the Green Beret |

- **Disguise rules** in §7.8. Standard combo: the Spy distracts a guard while the Green Beret stabs him from behind.
- Missions where he **starts in uniform**: M9, M11, M12, M17 (Kildread lists the uniform in his starting kit; engine flag `.EMPIEZADISFRAZADO`). Uniform **on site**: M3, M5, M7, M15, M16, M20.
- Can climb ladders; cannot climb walls. Can drive a vehicle **only in M16** (the truck). One walkthrough "dumps" bodies into a river.
- **Not in BEL:** choosing a rank, chloroform, the hanger, handcuffs (BCD); unlimited uniforms that high officers see through (C2).
- **Voice:** French. No BEL lines found. "Revenge is sweet", "Nazi scum!" and "Time to pay!" are BCD and later.

### 5.10 Guests, escortees and allies

| Unit | Mission | Notes |
|---|---|---|
| Capt. **Gregor** McRae, RAF pilot (`PILOTO`) | M10 | Prisoner in a pen; once freed he is the only one who can fly the Ju 52. The in-game briefing says Gregor; Prima's "George" is wrong. |
| The Informer | M12 | Jailed off the courtyard; must reach the Kübelwagen. ES Wikipedia calls him Claude Gilbert, a conflation with M17. |
| Claude Gilbert + 4 resistance men (`PRESO`) | M17 | Move as one unit: order Claude and "the other four will follow in a line". **Cannot crawl**, can run; anyone looking at them spots them. |
| Tutorial guards | Training | Allied soldiers firing blanks |

Guests are unarmed and use key 7. Whether enemies shoot escorted allies on sight is [unknown]; assume yes [inferred].

### 5.11 Features that are NOT in BEL

- **From BCD (1999):** throwing stones; cigarette packs as lures; handcuffs; knock-outs (fist, club/blackjack, chloroform); "puppet" control of captives; the Spy's hanger; the Driver's Lee-Enfield; uniform ranks and Gestapo; difficulty levels; a game-speed slider.
- **From *Commandos 2*:** binoculars; everyone swimming; doors and windows (entering, shooting from); explorable interiors; pole and wire climbing; the Marine's thrown knives and grappling hook; the Sapper's mine detector and flamethrower; the Driver's gas grenades and Molotovs; unconscious state on Normal; bodies that disappear when examined; red alert cones and detection lines.
- **Unused engine tokens in BEL/BCD files:** crossbow (`BALLESTA`, `.FLECHAS 5`, range 800), a broken flamethrower (`LANZALLA`), the Sniper's `.MUNFUSIL`.

---

## 6. Items, weapons and damage

### 6.1 Ally weapon table [EXE `<addr>`]

168-byte records {id, name, float range, +0x28, post-fire delay, draw anim, fire anim, explosive flag, unlimited flag, rounds per trigger, item id, …}. Each trigger subtracts "rounds per trigger" from ammo (`<addr>`). Config key `RETARDOPISTOLA` in `COMANDO.CFG` overwrites the pistol's delay.

| Weapon | Range (units) | +0x28 (probable damage) | Post-fire delay (ticks) | Rounds/trigger | Unlimited |
|---|---|---|---|---|---|
| PISTOLA (pistol) | 300 | 80 | 1 | 1 | yes |
| MIRILLA (sniper rifle) | 1000 | 100 | 10 | 1 | no |
| METRALLETA (Driver's SMG) | 400 | 100 | 10 | 5 | no |
| GRANADA (grenade) | 300 | 200 | 1 | 1 | no (explosive) |
| ARPON (harpoon) | 200 | 100 | 60 | 1 | yes |
| BALLESTA (crossbow, unused) | 800 | 100 | 10 | 1 | no |

- Pistol rate of fire: 2-tick fire animation + 1-tick delay ≈ 3 ticks per shot, **≈6-7 shots/s** [inferred].
- Ranges in metres at 0.045 m/unit: pistol/grenade 13.5 m, SMG/MG 18 m, sniper 45 m, harpoon 9 m (or 4.5 m).
- Static enemy MG: range 400.

### 6.2 Item master list (BEL)

| Item | Key | Owner | Noise | Notes |
|---|---|---|---|---|
| Pistol | G | all | Heard within a radius | Unlimited; ~3 hits to kill; group fire |
| Knife | X | GB, Marine | Silent | Double-click sprint-kill |
| Decoy | Q / I | GB | Lure pulse every 1.5 s | Must be retrieved with H |
| Shovel | F | GB | — | Snow/sand; M1-M11 |
| Climbing axe | cursor | GB | — | Walls, cliffs |
| Sniper rifle | R | Sniper | Silent | 3-8 rounds per mission |
| Harpoon | J | Marine | Silent | Land and water |
| Inflatable boat | T / H | Marine | — | Capacity 3 |
| Diving gear | D | Marine | — | Shallow water to put on |
| Bear trap | J | Sapper | Silent | Re-set after each kill |
| Time bomb | B | Sapper | Map-wide | 10 s |
| Remote bomb | B / A | Sapper | Map-wide | Detonator item |
| Grenade | E | Sapper | Loud | Self-damage |
| Wire cutters | W | Sapper | — | Not on reinforced wire |
| SMG | M | Driver | Loud | 100 rounds = 20 bursts |
| First aid kit | K | Driver / Spy / Sniper | — | 6 doses, +34 each |
| Lethal injection | L | Spy | Silent | No blood |
| Uniform | U | Spy | — | Clothesline pickup |
| Distract | D | Spy | — | Only in uniform |
| Explosive barrel | (carry: H) | GB carries, anyone shoots | Map-wide | Chain reactions; hides a body |
| Ammo box `CAJABALA` | H | Sniper | — | +3 rounds |

### 6.3 Damage model [EXE `<addr>`, death-action handler for impact message `0x152`]

Impacts carry {type, …, damage at +0x10}; type enum at `<addr>`.
- **Instant death regardless of HP:** `BOMBA` (bomb), `APLASTAMIENTO` (crush), `ARPON` (harpoon), `CEPO` (trap), `JERINGUILLALETAL` (lethal syringe).
- **Subtract damage from energy (dies when damage ≥ remaining energy):** `DISPARO` (bullet), `EXPLOSIONMENOR` (minor explosion), `ATROPELLO` (run over), `MORDISCO` (bite), `FUEGO` (fire), `ELECTRICO`, `CUCHILLADA` (knife), `PEPINAZOTANQUE` (tank shell), `BALLESTA`.
- **`JERINGUILLA`** (non-lethal syringe): knocked out for 100 ticks (5 s), then dies.

**Damage values found** (calls to `Impacto(src, tgt, type, dmg)` at `<addr>`):

| Source | Damage | Note |
|---|---|---|
| Knife | 120 | `<addr>` |
| Dog bite | 25 per bite | Sniper dies on the 4th bite, Tiny on the 8th |
| Electric | 20 | |
| Fire | 100 | |
| Bullets hitting allies inside a container with enemies | 30 | |
| Vehicle explosion | `.DANO 180` within `.RADIO 200` (demo `.MAC`) | Kills everyone except Tiny (200) [inferred]. mechanics.md read `.DANO 80` for vehicle explosions from mission data; the MAC value is preferred. |
| Demolished radio station | `.RADIO 150 .DANO 200` | M1 objective |
| Panzer II machine gun | `.IMPACTO 110` per hit, `.RAFAGA 10` per burst, `.RECARGA 5`, range 1000 | `PNZ2.MAC` |
| Panzer III cannon | `TIPODISPARO CANON`, `.RECARGA 30`, minimum range 300; damage not found (treat as lethal) | `PNZ3.MAC`; eggie: move a few yards away "enables your big gun again" |

- **Enemy rifle, MP40 and MG-nest damage per hit were not recovered.** Enemy `acDisparar` knows only `TIPOARMA PISTOLA` or `METRALLETA`; `BAP2MET` sets `.TIEMPO_RECARGA 5` (0.25 s; engine default 10 = 0.5 s); enemy macros have no `.ENEGIA` (enemies are simply dead or alive [inferred]). Anchors: Prima (3 pistol hits kill a soldier; "When your men are shot at, they usually die"), Ruetli (the Driver survives "only a fraction of a second of MP fire"), an MG nest that spots you "won't take long to kill your Commando". **Placeholder [inferred]:** rifle 80 per hit; MP40 100 per round in 5-round bursts; MG nest 100 per round; tank shell instant kill.
- Structures: vehicles `.ENEGIA` 200-300; MG nest 200.
- Other killers: grenades/explosions (anything nearby), mines, trains (`acEmbiste`), being run over.

### 6.4 First aid [EXE `<addr>`]

- Each dose heals **+34 energy** (capped at max), applied at tick 10 of the 30-tick `JERINGA` animation. Click the syringe cursor on any wounded commando, including the user.
- Doses = `.USOS`, engine default 3. Kildread lists "First Aid Kit (6 doses)" in all 19 missions he details (his changelog says he "fixed the First Aid Kit doses"); ES Wikipedia says "3 or 6"; the M1 and M4 retail files leave it unset; BCD files use 5. **Use 6 for BEL.** A full heal takes 3 doses for Duke and 6 for Tiny.
- Healing before the mission ends improves the damage score (Prima).
- There are no downed/unconscious states and no revive in BEL.

### 6.5 Explosives, barrels and destruction

- **Explosive fuel barrels:** only the Green Beret lifts them (right-click drops). **Any gunshot sets one off**, including from a vehicle or MG nest (M1 can be won by the Driver firing a captured Gatling at a barrel beside the relay station). Barrels **chain-react** (eggie M19: "Test blow to make sure explosion chains"). A barrel dropped on a corpse hides it. A barrel beside a barracks can destroy the whole barracks (M5). A barrel on a rail line is detonated by a passing train.
- **Opel Blitz fuel tanker:** explodes from **one shot from anything**.
- **Bunkers and covered towers need Sapper explosives** ("barrels are not enough"); open towers can be sniped. An explosive at the base of a tower kills the gunner but leaves the tower (and its cone disappears). Grenades destroy a bunker only where the map allows (`.DestruyeGranada`); `CASASFUERTES` lists buildings only a bomb can destroy.
- **Barracks:** "Some can be blown up, others not" (Ruetli); the M2 and M10 barracks cannot be destroyed (fandom).
- **Oil and fire (M17):** open the fuel valve, shoot the puddle; the tank keeps feeding the flames and enemies path through the fire and die (fire = 100 damage).
- **Mines:** invisible, **only in M5** (in M9 the team starts "the other side of the mines field"). Stepping near one sets it off. Patrol footprints are safe to walk in.
- **Destruction rendering:** destructible objects swap to hidden ruin sprites (`-RUINA07.RLE`) and spawn debris types from the VOL `EXTRAINFO`; `.AUTOEXPCASAS` swaps a house's tiles automatically; `.EXTRASPRITES` is used e.g. for the Bismarck replica. A grenade thrown too near a gate can collapse and block it; wrecks block paths "once the fire has stopped burning".
- **Noise:** "if you explode a bomb or a barrel of explosives, probably every soldier in the entire mission will be aware of your presence" [manual].

---

## 7. Core mechanics

### 7.1 Time base

- The engine counts frames, not time: the per-frame routine `<addr>` runs every subsystem once, then `Sleep(40 − e)` where e is the length of the **previous** whole loop (QueryPerformanceCounter at `<addr>`, 40.0 ms constant at `<addr>`). No delta-time reaches the simulation.
- On 1998 machines (frame work > 40 ms) the game never sleeps and runs at 15-20 fps (PCGamingWiki: "intended to run at 15-20 FPS as animations and game speed are tied to framerate"; "approximately 16 FPS"). On fast machines frame lengths alternate between the work time and 40 ms, averaging up to ~50 fps, which is why modern PCs run it too fast.
- **Decision: a fixed 20 Hz tick (50 ms)**, which sits in the observed band and matches the only official duration (10 s bomb = 200 ticks). Offer a 16-25 Hz speed option [rec].

| Parameter (ticks) | 20 Hz (use) | 16 Hz | 25 Hz |
|---|---|---|---|
| `.Retardo 200` (bomb) | **10.0 s** | 12.5 s | 8.0 s |
| M4 crate bomb 150 | 7.5 s | 9.4 s | 6.0 s |
| `.ESPERA n` (5-250 seen) | 0.25-12.5 s | 0.31-15.6 s | 0.2-10 s |
| `.DEMORA 50` (patrol sweep) | 2.5 s | 3.1 s | 2.0 s |
| `.DEMORA 100` (default sweep) | 5.0 s | 6.25 s | 4.0 s |
| `.INTERVALOSND 30` (decoy) | 1.5 s | 1.9 s | 1.2 s |
| `TIEMPO_RECARGA 5` | 0.25 s | | |
| Vehicle `.TIEMPO 200` | 10 s | | |
| `JERINGUILLA` knock-out 100 | 5.0 s | 6.25 s | 4.0 s |

Speed converts as `VEL 1.0` = 20 units/s at 20 Hz.

### 7.2 Movement and stances

- **Walk** (click), **run** (double-click; refused with a heavy load such as a barrel or body; the raft costs −1.0 u/tick), **crawl** (C or the icon; "Commandos cannot fast crawl"), **stand** (S). Some units cannot go prone (`.NOAGACHA`). Vehicles and running men: §9.
- Crawling is how you cross the far band of a cone and approach from behind.
- **Movement is silent** (§8.3).
- **Panic mode** in pathfinding: stuck for 5 s or more, move randomly for a few seconds, retry.

### 7.3 Footprints (snow and sand)

- SEC terrain type 2 (snow/sand) makes characters leave footprints. They are visible to the player and **fade over time** (a lifetime, `.VIDA`; the fade time is [unknown]; Prima keeps the Spy distracting a patrol "until the Green Beret's footprints disappear").
- **Enemies see footprints and follow them** ("German units will investigate every time they see… suspicious tracks"); squads with `.SIGUEHUELLAS 1` follow tracks. A soldier who finds nothing "will give up looking for you and continue" (Prima). Footprints are great lures: "The Green Beret leaves footprints in the snow to lure a soldier around the corner" (Prima); leave tracks, bury yourself with the shovel, knife the guard who investigates (M5).
- **Footprints are noticed only in the near band** of a cone (≤400 units): the footprint flag `PISADA 0x2` is in the near-band-only mask [EXE, gap 0]. Gap 8 instead proposed testing footprints against the whole cone, reasoning only from the manual's silence; the disassembly is the more specific evidence and is preferred here.
- **Crawling:** manual: "If a man crawls on snow or sand, the tracks he leaves will not be visible to the enemy." The engine separates `acPisar` (footprints the player sees) and `acDejarRastro` (a trail the enemy sees), so crawling most likely leaves marks but no AI trail [inferred]. Prima once waits for a crawling Sapper's footprints to fade; follow the manual (gap 8 decision).
- Enemies also leave visible footprints (`AcPisar`); Kildread crawled in a patrol's own tracks to hide his.

### 7.4 Water and diving

- SEC types: 1 shallow water, 3 deep water. **Only the Marine enters deep water**, with diving gear. Others cross only by boat; they are blocked from deep water rather than drowning [inferred]. Passengers can leave a boat only when it is anchored in shallow water (the Marine in diving gear can dive straight from a boat).
- **Diver visibility:** manual and Kildread: invisible unless seen going under. Engine: diving (`0x800000`) is in the near-band-only class, and a diver's height drops to 0.125 × normal while his body sinks (`SEHUNDE`), so the 3D line-of-sight test is probably blocked by the water surface [inferred reconciliation, gap 0].
- Water current per map (`.WATER` `.VELINC`, `.ANGINC`, `.SININC`); M19's river cannot be rowed upstream (Kildread claims he once swam upstream at one spot). In M13 the Marine follows a ship underwater through a harbour gate while it is open.

### 7.5 Climbing, ladders, buildings and devices

- **Only the Green Beret climbs walls and cliffs** (SEC flag 64 "climbable wall", usually sector flags 448; "connections" list the sector pairs he can climb between). Right-click mid-climb leaves him hanging.
- **Everyone uses ladders.** Some ladders are raised and must be **lowered from above** by the Green Beret (M2).
- **Buildings:** hide inside via the door's activation pointer (invisible); **no interiors** in BEL (explorable interiors and shooting from windows are C2). Cannot hide bodies inside or shoot out. The M15 tram and the M8 Horch car can be entered to hide like a house.
- **Switches and devices** (activation cursor "hand on a lever"): electric-fence switch (M3), faucets/fuel valves (M17), gates and harbour/lock gates (M13), road barrier (M2), **mobile bridge lever** (M17; can be toggled repeatedly, and toggling it under enemies kills them), **telephones** (M5: using one rings the other and guards near it go to answer; use it again to stop), prison doors, the outpost door (M3), the conveyor switch (M19), the water-gate lever (M20).
- **Not in BEL:** poles, telegraph wires, windows, breakable doors, container searching (C2).

### 7.6 Bodies

- **Carriers:** Green Beret and Spy only (H; right-click drops). Carrying is a heavy load (no running) [inferred from the heavy-load rule].
- **Hiding:** behind cover out of every cone; under a barrel (Green Beret); on high roofs (M12). Bodies cannot be taken into buildings.
- **Bodies persist** for the whole mission (every walkthrough stacks them); the C2/C3 "examine and the body disappears" is [sequel].
- **Seen across the whole cone:** bodies (`ALEMANMUERTO 0x20`, `ALIADOMUERTO 0x40`) are not in the near-band-only mask, so guards notice them out to the far edge [EXE, gap 0]. (remakes.md's "bodies near band only" is superseded.)
- **Reaction when found** [EXE, base class shared by sentries and patrols]: the soldier turns aggressive, walks to the body, gives the man-down cry, then shouts **ALRM**. Manual: "if an enemy patrol should find the body of one of their soldiers, they will immediately raise the alarm." A unit can ignore bodies with `Vista01 .ALIADOMUERTO 0 .ALEMANMUERTO 0` (vehicle crews, the cannon gunner, one BCD unit; BCD M7 tower guards ignore bodies). Kildread saw patrols look at a body and carry on; per-patrol scripting (`REACT_EVENTS`) may explain this, and it remains partly open (gap 8).
- A guard who has seen a body stays **permanently primed**: he adds max(1, T/25) nervousness per tick while a commando is in view and fires instead of holding (§8.5).
- **Blood:** the knife leaves blood; the lethal injection does not. Blood spurts and pools under corpses (uncut version). Whether guards react to blood stains is [unknown]; treat blood as cosmetic.
- **Kill discreetly:** enemies react to "wounded mates" and "will seek you out" [manual].

### 7.7 Capture, prisoners and the halt

- A guard usually shouts "Halt!" rather than firing at once. A passive soldier halts you at gunpoint. If you **stand still** and the squad has a `.JAIL` (a prison building `CARCEL`, or a flagged barracks acting as one), you are **marched there** and can later be freed by a teammate (the Green Beret opens the prison door with the hand; Kildread M12). The arresting sergeant shouts **"Stehen bleiben!"** and `DETENIDO.WAV` plays. Commandos have `AcDetenido` (arrestable).
- **Arrest is done by patrols; sentries only hold** you at gunpoint and wait for a patrol or NCO (Ruetli); NCOs decide between capture and shooting. With no prison on the map, patrols fire on sight.
- **You are shot** if you move or flee, shoot, or are seen killing; also if the guard has already seen a body; and by any MG nest, tower, armoured vehicle or alarm patrol, which fire at once.
- Mission 2 scrapbook: "If one of your group is captured, he will be transferred in one of the prisons where you can free him." M17's briefing suggests being arrested on purpose to get inside.
- Held or prisoner men cannot be multi-selected.
- **Halt option:** Submissive / Indifferent (default Indifferent) decides whether a man moving under orders obeys the halt.

### 7.8 The Spy's disguise

- In uniform, "the enemy ignores the Spy". The vision layer has **no disguise flag**: he is an ordinary `ALIADO`, seen out to the far edge unless prone, so a suspicious act is visible across the **full cone**; the disguise logic is brain-side [EXE; brain logic not decoded].
- **Unmasking triggers:** a guard's "halt" (message `0x144`; any guard nervous enough to challenge him unmasks him; eight other code sites send it); opening a door in view of an enemy (doors' `.DESCUBREESPIA` defaults to 1 and no BEL file changes it; only BCD padlocked doors set it to 0) [inferred]; being seen killing (manual), carrying a body (Prima), moving with the injection or pistol cursor armed (Kildread); running [inferred].
- **When unmasked:** he counts as Allied again, his sprite switches back, he emits a level-1 noise, and the uniform returns to his knapsack. Press **U** to put it back on once unseen.
- In BEL no guard sees through the disguise and he cannot choose a rank. In BCD, sergeants and above see through a private's uniform (§11.2).

### 7.9 Health and death

- Red bar per portrait, draining from the top; empty = death, skull portrait, mission lost.
- No knock-outs, no incapacitation, no revive in BEL. Every "neutralisation" is a kill. BEL's non-lethal tools are only the Spy's distract, the decoy, being seen as bait, footprints, and pistol-shot lures.

---

## 8. Enemy AI

### 8.1 Vision: cone geometry and detection rules [EXE, gap 0 and gap 8]

**Default soldier view `Vista01 [ ]`** (constructor `<addr>`/`<addr>`, parser `<addr>`; the same five values appear in the mission editor's defaults routine `<addr>` and in the demo `CANYON.MAC`: `Vista01 [ .ALT 150 .MOD 400 .ANG 70 .CABEZA 0 .PASO 90 ]`):

| Key | Default | Meaning |
|---|---|---|
| `.MOD` | **400** | The parser multiplies it by 2 → cone range **800**. The near band is MOD (range × 0.5). |
| `.ANG` | **70** | **Full** aperture: edges = heading + `CABEZA` ± ANG/2 (`<addr>`) |
| `.ALT` | 150 | Vertical band z ± ALT/2; nothing found reading it back |
| `.CABEZA` | 0 | Head yaw offset added to body heading |
| `.PASO` | 90 | Max head turn per vision update (effectively instant turns) |

- **Near band = 400 units (18 m); far edge = 800 units (36 m).** Distances are squared 2D x/y in MIS `.XYZ` units. A guard sees a standing commando at 2.7× pistol range; the sniper (1000) outranges every default cone. This matches screen measurements (near band 40-50 % of visible length; world opening about 60-85°; SAG's patrol "whose vision cone is bigger than the normal-sized screen").
- **Sweep (`AcVigilar`, constructor `<addr>`, tick `<addr>`):** defaults `.ANGBARRIDO 50`, `.DEMORA 100`, `.VISTAELIPTICA 1`. Head offset **θ = ANGBARRIDO · sin(2π · (t mod DEMORA) / DEMORA)**: a smooth sine, not stop-and-go. ANGBARRIDO is the peak offset (gaze swings ±50°, plus ±35° of aperture on each side); **DEMORA is the full period** (100 ticks = 5 s; squads' `.VIGILARDEF [ .ANGBARRIDO 50 .DEMORA 50 ]` = 2.5 s). Each guard's timer starts at DEMORA + 5 × table[hash(token) & 15] (0-20 ticks of phase jitter) so guards don't sweep in sync. Retail maps set `.AngBarrido` 35, 40, 45 or 50 (50 most common). The Modding Wiki's gloss of `.AngBarrido` as "the angle of the field of view" is wrong: it is the sweep amplitude.
- **Elliptical range (`VISTAELIPTICA`, on by default; `<addr>`):** range shrinks as the head turns away from the body's facing: r(θ) = a·b / √((b cos θ)² + (a sin θ)²), a = 2 × MOD, b = a/3; at the ±50° extreme the cone is only **42 %** as long. A global setting `[[`<addr>`]+0x54]` changes it: value 2 → b = a (no ellipse); value 0 → r × 0.75. It is probably the demo's unused SKILL option [inferred]; the **retail value is unknown**. MG nests, towers and the cannon set `.VISTAELIPTICA 0` (constant range).
- **Other Vista messages:** `0x165` returns cone info for display (range and range × 0.5); `0x13b3` is a "focus" mode (range × 2, aperture × 0.5; trigger unknown); `0x13b1`/`0x13b2` set a **watch mask**: soldiers use `0x7fa` (footprints, commandos, objects, both kinds of body). The seen list holds at most 16 objects.

**Detection is instant.** Each AI update (brain `<addr>`) calls the Vista tick (turn head, rescan), fetches the seen list (message `0xe5`) and, in `<addr>`, posts a "commando seen" event (`0x132`, with position) **on the first tick** the commando is inside the cone and unoccluded. There is **no suspicion meter**. Any delay is the brain's reaction (§8.5).

**The two-band rule.** The detection callback (`<addr>`; single-target `<addr>`) applies range² × 0.25 (near band only) when the target's flags include `0x810002`:

| Target / state | Near band (≤400) | Far band (400-800) | Source |
|---|---|---|---|
| Standing, walking, running commando | Seen | Seen | manual, EXE |
| **Prone / crawling** (`0x10000`, `ARRASTRARSE`) | Seen | **Not seen** | manual, Prima, Ruetli, EXE |
| **Footprints** (`PISADA 0x2`) | Noticed | Not noticed | EXE |
| **Diving Marine** (`BUCEAR 0x800000`) | Near-only in code; in practice unseen unless seen submerging | Not seen | EXE vs manual (§7.4) |
| Green Beret buried | Not seen unless seen digging in | Not seen | manual |
| **Bodies** (`ALEMANMUERTO`, `ALIADOMUERTO`) | Seen | **Seen** | EXE |
| Spy in uniform | Ignored unless acting suspiciously; suspicious acts visible across the full cone | same | EXE, manual |
| Inside a building | Not seen | Not seen | manual |
| Behind a large vehicle | Hidden (even though the drawn cone continues through it) | Hidden | manual, EXE |

What guards notice in the cone [manual]: commandos, bodies ("a fallen comrade"), footprints ("suspicious tracks"), wounded mates, the Marine's abandoned inflatable ("German often shoot the launch on sight"), and a commando entering a vehicle ("they will attack the vehicle until it is destroyed").

**Occlusion (`<addr>`):** a **3D segment** from the viewer's eye (z + body height) to the target's centre (z + height), tested two ways:
1. **Sector walk (`<addr>`):** entering a sector flagged **16** (walls, rocks, buildings), or crossing an edge with no neighbour, blocks sight **at any height**. Otherwise a horizon test compares each sector's ground plane (kx, ky, bz) at the crossing with the slope of the sight line. **Towers and elevated guards do not see over sight-blocking walls, rocks or buildings**; height helps only over terrain, slopes and lower ground. Fences (flag 4) are see-through for everyone.
2. **Swept test against collision volumes (`<addr>`):** prisms with heights, so a high sight line may clear low props [inferred; partly read].
After the scan, any seen object with `.OCLU 1` (every truck and tank) removes targets behind it (`<addr>`).

**Players exploit the far band:** a commando stands at the edge of the far band so a guard notices him and walks into an ambush (Ruetli's "gesehen werden" lure); eggie crouches to "the border of his long/short range view", stands up, and the MG gunner "will only say 'halt'".

### 8.2 View organs by unit type (demo MACs)

| Unit | View organ | Near / far (units) | Aperture | Sweep (ANGBARRIDO) |
|---|---|---|---|---|
| Soldier (`BAP*`, `BANPE*`) | `Vista01 [ ]` | 400 / 800 | 70° | map `.AngBarrido` 35-50 |
| Dog (`PERRO`) | `.ANG 90` | 400 / 800 | 90° | 40 |
| MG nest / watchtower (`NIDOMET`, gunner at z ≈ 145-167) | `.MOD 320 .ANG 40`, not elliptical | 320 / 640 | 40° | 35-60 (towers 50); traverse `.Giro` 90/180 |
| Bunker / `TORRE` | `.MOD $Vision .ANG 40` | per mission | 40° | per mission |
| Cannon gunner (`CANYON`) | explicit defaults, not elliptical | 400 / 800 | 70° | 20 |
| Panzer II/III, desert tank (crew) | `.MOD 500 .ANG 70` | 500 / 1000 | 70° | **155** |
| SdKfz 231 (`SDK`/`TANQUETA`, crew) | `.ALT 250 .MOD 550 .ANG 40` | 550 / 1100 | 40° | 155 |
| Trucks, tanker (`CAMION`, `CAMDES`, `CISTERNA`, `*_V`) | **no `Vista01`**; hull `Vista02` box only | box 40-120 ahead × ±30 | — | — |
| Barriers, train | `Vista02` polygons | train −700…+355 × ±75 | — | — |

- **Trucks have no cone** (eggie: an enemy truck "has no field of view at all"); the small box is probably an obstacle or run-over sensor [inferred]. Tank crews also carry `acCTanque .NOVERHASTA` ("don't see until…", meaning unknown).
- Other view keywords: `.RANGOVISION`, `.VISTAELIPTICA`, `.TIEMPOENTREMIRADAS`, `.TIEMPOMIRANDOCOMPA`, `.DESCUBREESPIA`, `.NERVIOSISMO`, `.UMBRAL`, `.SIGUEHUELLAS`, `.Ladrador`.
- *Commandos 2* (not BEL) uses `.VIGILADOR [ .LONG_CORTA 200 .LONG_NORMAL 400 .LONG_LARGA 600 ]`, `.AMPL_NORMAL 70`, `.MAX_ANG_BARRIDO 50`, and `.VISTA_ESPECIAL_DISTANCIA 3000` for snipers.

### 8.3 Hearing and noise

**Manual rule:** hearing depends on distance × loudness. Enemy hearing (`Oido01`) takes no parameters.

| Source | Who hears | Notes |
|---|---|---|
| Walking, running, crawling | **Nobody** | GameSpot: "Guards cannot hear your men moving". The EXE has `PASOS.WAV` and footprint logic but no logical sound for movement (gap 8). |
| Knife, poison syringe, bear trap, harpoon, sniper rifle | Nobody | "A mate… two steps away but with his back turned… would never realize" [manual]. Silent, not invisible: a kill inside someone's cone is still seen. |
| Dropping a body | Nobody | gap 8 decision |
| Pistol | Soldiers within "a certain distance" | Used to lure guards outside alarm zones ("Two guards will hear the shooting and take a look", eggie M2) |
| Driver's SMG | Loud | |
| MG fire (enemy nests) | Level-3 noise | |
| Grenade, bombs, barrels, fuel-truck explosions | "Probably every soldier in the entire mission" | Usually sets off the alarm |
| Decoy | Nearest soldiers come; some sentries only turn | Pulse every 30 ticks; Kildread's "*BEEP*" trick: toggle quickly to pull only 1-2 guards |
| Soldiers' shouts ("Halt!", "¿quién va?", "Alarm!") | Nearby soldiers | They pull in comrades |
| Dog barking (M19) | Nearby soldiers | |

**Noise levels** (emitter `<addr>`):

| Level | Sounds |
|---|---|
| 3 | Alarm shout **ALRM**, explosion, MG fire |
| 2 | ALTO ("Halt!"), "¿quién va?", man-down cry, dog bark |
| 1 | The Spy being unmasked, telephone, horn |

- **Distraction breaks on noise:** a guard held by the Spy or waiting at the decoy "immediately return[s] to duty" on gunfire, explosions or an alarm (Prima).
- **Decoy cost (unverified):** Prima says the decoy "works for only a limited time. After the enemy loses interest in it, they'll usually sound an alarm". No code for this was found and Kildread/Ruetli use it freely; probably per-guard scripting or chance [inferred].

### 8.4 Enemy roster

| Unit (engine name) | Armament | Behaviour |
|---|---|---|
| **Sentry**: `BANPE1` holds post, `BANPE2` investigates | Mauser carbine / rifle | Stands, sweeps, "may even turn in place" (Prima); idles smoking (attention drops while smoking, Dutch FAQ). On seeing a commando he usually aims and waits for reinforcements or an NCO. `BANPE1` glances at a partner (`COMPANERO`, `TIEMPOMIRANDOCOMPA` 50 ticks ≈ 2.5 s watching, `TIEMPOENTREMIRADAS` 500 ticks ≈ 25 s between glances): "enemy soldiers watch over each other". `BANPE1` has no Searcher, so he never leaves his post (turns toward noises only). |
| **Soldier on rounds**: `BAP1` keeps route, `BAP2` investigates | Rifle | Routes `LOOP` or `PINGPONG` with `.ESPERA` waits and `.ANGULO` facings. "If they detect you, they will normally abandon their rounds and track you." Easily lured by the decoy. `BAP2MET` is the MP-armed variant (`.TIEMPO_RECARGA 5`). Editor fields `PERSIGUESONIDO`, `PERSIGUEPISADAS`, `VELDEJARPATRULLA`, `VELVOLVERPATRULLA`. |
| **Patrol squad** (`.PATRULLAS`) | Leader (sergeant) with Luger; troopers with MP40s (sometimes rifles) | Size = `NSOLDIERS` + 1 leader (tutorial: `NSOLDIERS 1` produces two men); guides say 2-5 (Prima), 2-6 + NCO (Ruetli), 2-8 (Kildread); engine allows 1-48. Formation columns `.NCOLUMNS`. Elite, they cross the whole mission. **Kill one and the rest raise the alert at once** (Kildread). Arrest captured commandos; with no prison they fire on sight. Distracting the sergeant freezes the squad. Kill troopers first, leader last (Prima). Fields `SIGUEHUELLAS`, `LOOKBACK`. |
| **NCO / sergeant** (`CABO`) | Luger | Leads patrols; crews guns, MG nests, SdKfz 231, Panzer II/IV; decides capture vs shooting. |
| **Officer** (dressed like the Spy) | — | Drives trucks back and forth; **ignores commandos, never raises the alarm** (Ruetli). |
| **MG nest** (`NIDOMET`) | Heavy MG | Manned by a sergeant; `AcNidoMetralleta` has no nervousness, so it **fires on sight**; kills quickly. Driver can man it after the gunner dies. Elevated posts are reachable only by the sniper or explosives. |
| **Watchtower** (`TORRE`) | MG | Open towers: sniper or explosives; covered towers: explosives only. |
| **Surveillance bunker** (`BUNKER`) | MG | Long view; explosives (`BOMBA`) or tank shells; grenades only where `.DestruyeGranada` allows. |
| **Artillery** (210 mm mortar/cannon, guns, Flak) | Cannon | "Orders to shoot on sight". The 210 mm piece kills any vehicle in one shot and cannot be used by commandos; other guns can be taken by the Driver. |
| **Armoured vehicles** (SdKfz 231, Panzer II/III/IV) | MG (+ cannon on III/IV) | Have cones; `acPilotaje .CHIVABANDO 1` (report sightings to their side), `.DISPARA 1 .PARAYDISPARA 1` (stop and shoot). Some wait in a **tank depot** and deploy on alarm (fandom). |
| **Transport vehicles** (trucks, cars) | None | No cone; cannot raise the alarm (trucks `.NOSIGUECHIVANDO 1`) but **run commandos over**; Prima says enemy vehicles "can spot just like a soldier and have set routes" (true of armour). |
| **Motorcycle courier** (M4, `MOTORISTA`) | — | The one transport that raises the alarm: on a help event he runs `acBuscaAyuda` (event `RAYU`), mounts the bike, drives an `EXIT` route to the barracks and fires the exterior event `REXT`. Speed 3.5-10. |
| **Trains** | — | Polygonal view volume; `acEmbiste` runs over anyone on the track, soldiers included; stop when blocked. |
| **Patrol boats** | Twin MG | Very deadly. |
| **Dogs** (Alsatians, `PERRO`) | Bite (25) | **M19 only** in BEL (one caged, others with a patrol). Follows its handler (`.AMO`), barks (`.LADRADOR`), cone 90°. Fandom's "various missions" reflects BCD maps. |
| **Enemy sappers** (M16) | Unarmed | Run to the detonators "at the slightest alarm". |
| **General Schleper** (M15) | Unarmed | Never raises the alarm; flees by car on any alarm. |
| **Tutorial guards** | Blanks | Harmless. |
| **Mines** | — | M5 only, invisible. |

**Brain architecture** (from `MAPA0002.MIS` and the demo MACs): every enemy is an entity with **organs** (`Vista01` sight, `Oido01` hearing, `MotorAndante` walking) and a prioritized **action list**; each action has a `.CARISMA` and the highest-priority action that can run takes control.
- `BANPE2`: Death 999; own logic `AcBanpe2` 600 (with `.NERVIOSISMO`); optional secondary action 600; Shoot 500; Watch/sweep 400; **Searcher** (`AcBuscador`, pursue and search) 300; Use ability 200; Footprints 100. `BANPE1` has no Searcher. `BAP2` adds the patrol route (200) below Searcher.
- The M4 courier: `AcMuerte` 600 > `acUsaHab` 500 (`.HABILIDAD TIERRA`) > `acBuscaAyuda` 400 > `AcVigilar` 300 > `acPatrulla` 200.
- `ac…` actions look autonomous; `au…` actions appear on player units and are order-driven (`auGoto`, `auDisparar`, `auEscalar`, `auAcuchillar`) [inferred].
- Enemy movement: `MotorAndante` default `STDVEL` 2.5; patrol `.VEL` runs 0.9-3 (default 1.0); whether it is absolute or a multiplier is unresolved. Reaction squads run out at `.VEL 3` and patrol at 2; the courier 3.5-10.
- Sprite/palette: `.ANIMSOLDADO`, `.ANIMCABO` (sets in §12.6), `.ANIMPAL` palette swap (−1 default).

### 8.5 Nervousness, the challenge and holding [EXE, gap 1]

`BANPE1`, `BANPE2`, `BAP1` and `BAP2` share one base class (constructor `<addr>`, parser `<addr>`).
- `UmbralNerviosismo` / `.NERVIOSISMO` is a **threshold T** (default **50**, min 1; no mission file overrides it). The Modding Wiki: lower = "will shoot sooner if he aims at you".
- Each soldier has a **nervousness N** that **drops by 1 per tick** (never below 0, `<addr>`).
- **While a commando is in view** (`<addr>`): N += int(2·d²), where d is how far the target moved since the last tick (standing still adds 0). N jumps straight to **20·T = 1000** if the target is within **50 units**, is already held (state 3), or is a non-standard type. A guard who has seen a body (flag `+0xdc`) also adds max(1, T/25) per tick.

| Commando | Time to reach T [inferred] |
|---|---|
| Walking (d ≈ 2-3) | 3-6 ticks (0.2-0.3 s) |
| Running | Almost at once |
| Crawling | About 50 ticks (2.5 s) |
| Standing still | Never from movement alone (why the "under shot" trick works) |

- **When N ≥ T the guard enters challenge state `0xf`:** shouts **ALTO** (level-2 noise) whenever the target moves and a cooldown allows; sends `0x144` ("halt") to the target and `0x146` to the other things he sees; puts an idle target into **held state 3** (`0x1c2`). While he still sees it, N stays pinned at 1000.
- **After losing sight** N needs about 950 ticks to fall below T: **about 45-60 s of lingering alertness** [inferred].
- **Arrest vs hold vs shoot:** patrols arrest (every M4 patrol has `.JAIL CARCELB`; the squad plays `DETENIDO.WAV` and marches the man off); sentries only hold; they shoot if the held man moves or flees, if the guard has seen a body, or if there is no prison. The fire trigger itself was not traced in code.
- **Reaction per unit:** `BANPE1` turns but never walks over; `BANPE2`/`BAP2` walk to noises, tracks and bodies, then return; `BAP1` keeps its route; patrols arrest and can switch routes on alarm; MG nests/towers/bunkers fire on sight (level-3 noise); armoured vehicles report and stop to fire.
- IGN described the result as soldiers who "capture or shoot you based on their passivity level and whether or not they have seen you hurt any of their friends". Manual: a soldier "in an aggressive mood (for example, because he has seen you kill his friend)" fires; any soldier fires if "you attempt to flee or shoot at him"; "some by the book types will immediately sound the alarm".

### 8.6 Reconstructed state machine

| State | Behaviour | Transitions |
|---|---|---|
| **Idle** (post / patrol / sweep) | Follow route, sine sweep, smoke, glance at partner | Noise, footprints, body → Investigate. Commando in cone → Challenge. Explosion or zone event → Alarm. |
| **Investigate** | Only `BANPE2`/`BAP2` move: walk to the stimulus, look around | Nothing found → Return ("The soldier will give up looking for you and continue"). Body → aggressive, man-down cry, ALRM. |
| **Challenge / Halt** | Shout ALTO, aim; N pinned | Target keeps still → Hold (sentry) or Arrest (patrol with jail). Target moves, flees or shoots, or guard saw a body → Combat. |
| **Combat / Chase** | Fire within range; "may run after you or follow your tracks" | Lose contact → Search |
| **Alarm** | "Seek help": shout, run to raise it; zone event releases barracks squads | Siren (RINT only); squads deploy permanently |
| **Search** | Around the last known position | Eventually → Return |
| **Return** | Walk back to route/post | Idle. Nervousness keeps him edgy for ~45-60 s. |

### 8.7 Alarms, zones, siren and reinforcements

**Alarms are zoned.** Missions map named SEC areas to events:
- `.SENSORES_EXP_ZONA [ [ .ZONA X .MENSAJE EVT ] ]` fires EVT when a guard standing in area X **sees** a commando; `.SENSORES_SND_ZONA` does the same for sounds **heard** there (which noise levels trip them was not decoded; level 3 [inferred]).
- M4 file: `[ .ZONA PELIGRO .MENSAJE RINT ] [ .ZONA DELANTERA .MENSAJE REXT ] [ .ZONA EXTERIOR .MENSAJE RPER ]`. Named areas group sectors so the same soldier "reacts in another way after he spotted you (for example inside or outside a base)" (e.g. `CAMP`, `CAMPAMENTO`, `PELIGRO`, `DELANTERA`, `EXTERIOR`).
- An alarm raised in one area only wakes that area's barracks (Prima: "it will sound only in the courtyard below"). Kildread's **"silent zone"** is the area where anything suspicious or any gunfire sets off the alarm; outside every zone a pistol shot only draws nearby listeners.
- `TRIPLINES` fire an event when a given unit reaches a position (e.g. a raft reaching `[503 1862]` sends `BALS` and a patrol changes route).

**Siren.** The event name **`RINT` is hard-coded** to start `SIRENA01.WAV` at volume 0.75, dropping 0.0015 per tick, so the siren lasts **500 ticks (≈25 s)**, fading out, while a flashing red siren icon (`ALARMA01-04`) runs. Only `RINT` sounds the siren; `REXT` and `RPER` release troops silently. A second `RINT` probably restarts it [inferred]. BCD maps don't use `RINT`. A guard's alarm shout (`VOZALARM` / ALRM) accompanies it.

**Barracks** (buildings with a waving enemy flag, `CUARTEL`): "At the slightest sign of alarm, they will pour out to look for you." Each has a finite pool `NumRegenSoldiers` (5 or 10 in retail files); new squads keep coming "until the barracks is either empty or blown up" (Ruetli; eggie "shoot a barracks empty"). Tank depots release tanks. Squads per barracks are the patrol records naming it `.HOME` with `.STARTATHOME 1`. M4 file:

| Barracks | Pool | Squads |
|---|---|---|
| `GUARNICION` | 10 | 4 men on `RINT` |
| `GUARNICION2` | 10 | 4 men on `RINT`, 2 men on `RPER` |
| `CASA_CARCEL` (jail) | 5 | 2 men on `REXT` |

- **All squads tied to an event leave at once** (no interval setting).
- **Route:** exit route `SALIDA` at `.VEL 3` (run) or 2; the next-to-last waypoint emits an event (`RUNO`, `RDOS`, `RPRR`); `.ENLAZAR 1` on the last waypoint switches the squad into the named loop at `.VEL 2`.
- **Squads never go home**; they patrol the loop for the rest of the mission. If your men stay hidden, "no one will spot them" as the new patrols pass (Prima).
- **Patrols already on the map react too:** `PAT_EVITA_PESADOS` (`.REACT_EVENTS [BUCL RINT]`) runs route `RINT` at VEL 3 then loops `BUCL`.
- **Regeneration:** `.REGENERATEPATROL 1` rebuilds a destroyed squad from its barracks until the pool runs out (delay unknown).

**Does the alarm reset?** Partly: the siren stops after 500 ticks and each guard's nervousness decays below T after ~950 ticks. Never: a guard's "has seen a body" flag [inferred], squads that left, patrols that changed route, the bodies. No explicit "alarm cleared" state exists. Prima: patrols "will go on alert, but not for long"; "After things cool down…".

**Alarm causes:** a guard who finds a body; a patrol that loses a man; a kill seen by another guard (eggie); several bodies (eggie); explosions; the M4 courier; "by the book" guards; zone sensors.

**Alarm-means-failure missions:** M15 (general flees), M16 (bridge blown), M13 (tank sinks the sub). Others turn deadly (M9/M10 Panzers).

### 8.8 Exploits and emergent tricks (worth reproducing)

1. **Pistol lure / corner camping:** fire a few shots from a corner outside the alarm zone; guards arrive one or two at a time. Kildread uses it in almost every mission. Group G fire is "devastating".
2. **"Under shot" trick** (eggie, missions 3, 5, 6, 8, 12, 14): let one commando be spotted and stand still. Each guard who sees him, or hears a comrade's "Halt, wer ist da?", turns and aims, and the other commandos knife them one by one. Works only if the held man doesn't move, the guards haven't seen a body, only ordinary guards are involved (patrols, armed vehicles and towers fire at once), and no alarm is raised. The engine explains it: standing still adds no nervousness.
3. **Decoy chains:** "*BEEP*" toggling pulls 1-2 guards; "decoy + harpoon" kills a distracted patrol one by one.
4. **Spy distraction lasts forever**; on a sergeant it freezes the patrol.
5. **Vehicle kills:** running soldiers over is silent (M16 truck clears whole patrols; M15 van into a distracted patrol "with no alarms"). Train + barrel on the rails. Tram + fuel truck counts as an "accident, so nobody will complain" (no alarm).
6. **Tainted vehicles** (oocities M15): any vehicle a commando has used is shot by enemies who see it, even empty; a car parked by the HQ gets shot up by its own guards and destroys the mansion.
7. **Farming stars** via Play Again.
8. **Marine backpack bug**; **M17 arrest glitch** (Tiny halfway up the cliff lets a patrol try to arrest him, then climbs; the stuck sergeant makes every enemy ignore Tiny even during the alarm; boarding the truck while "being arrested" ends the game); **M16 stuck sapper** behind a parked truck.
9. **Resolution advantage:** a higher resolution shows more map (a remake should fix the visible area).

---

## 9. Vehicles

### 9.1 General rules [manual unless noted]

- **Boarding:** select the man or men and hover the vehicle until the activation pointer appears (it does not appear if the vehicle is out of commission or enemy-occupied). Every vehicle has a **maximum capacity**. Friendly trucks can be boarded while moving (Kildread M6).
- **Who drives:** the **Driver** drives land vehicles; the **Marine** water vehicles; **McRae** the Ju 52; the **Spy** the truck in M16 only. With several men aboard, you move it only by selecting its driver.
- **No pathfinding:** "when you are handling a vehicle you do not have the possibility of avoiding obstacles automatically… you can only set destinations that can be reached in a straight line." They stop at obstacles; steer with waypoints. GameSpot notes "occasional pathing problem trying to operate a large vehicle".
- **Double-click = full speed**; fast driving runs soldiers over, slow driving lets them turn and shoot (M1). Kildread's M2 escape rams the road barrier at full speed and destroys it.
- **Exiting:** select the man (portrait or keys) and click his photo in the knapsack. Boat passengers only in shallow water.
- **Weapons:** hold Ctrl (gunsight), Ctrl+click fires a volley. Turrets turn before they fire. "Vehicle weapons have a very long and lethal range." Tank main guns have a minimum range (300 for the Panzer III cannon).
- **Detection:** "If a German should see you enter a vehicle, they will attack the vehicle until it is destroyed." Large vehicles block sight (`.OCLU 1`) though the drawn cone runs through them. In a Panzer the Driver is immune to small arms.

### 9.2 Perception, durability and seats [data, gap 8]

- **Perception:** trucks, tanks and SdKfz use `Vista02`, a small box ahead of the bumper (truck: x 40-120 × ±30); tank and SdKfz **crews** add real cones (§8.2). `CHIVABANDO` lets vehicles report sightings. So eggie (trucks: no cone), Prima (vehicles can spot) and Ruetli (transports never alarm in practice) are each partly right.
- **Durability** (`.IMPACTOS`: hits of each kind to destroy):

| Vehicle | Bullets | Explosions |
|---|---|---|
| Truck, Jeep, Horch | 30 | Bomb, tank shell, minor explosion all kill |
| Kübelwagen | 20 | same |
| Car, van | 60 | same |
| SdKfz | 500 | same |
| Panzer II | 1000 (the drivable version is immune) | Minor explosion kills it |
| Panzer III / IV | Immune | Immune to minor explosions; only bombs and tank shells |

  If a grenade is a "minor explosion" [inferred], fandom is right that only the Panzer II dies to grenades; eggie's grenaded Panzer IV contradicts the demo data. The Opel Blitz tanker explodes from one shot. Kildread/Ruetli: small-arms fire can eventually destroy the SdKfz (500 hits). The Ju 52 is not destroyed by explosives (fandom).
- **Seats** (`.INFO`):

| Seats | Vehicles |
|---|---|
| 1 | M4 motorcycle courier |
| 2 | Motorcycle with sidecar (manual; "BMW R75" tooltip exists) |
| 3 | Inflatable raft (manual) |
| 4 | Kübelwagen, Willys |
| 5 | SdKfz, van |
| 6 | Truck, Horch, car, drivable tanks |

  Fandom's "the BEL motorbike cannot carry one more passenger" fits the courier's bike; a blog's "raft carries up to two other commandos" fits capacity 3.
- **Identity:** the in-game tooltip for the `SDK`/`TANQUETA` units is **"SDKF2 231"** (an "SDKF2 232" tooltip also exists); tanks are "PANZER II/III/IV"; the staff car "HORCHER KFZ15". Prima and fandom call the M7/M11 vehicle an SdKfz 251 half-track; Kildread calls it a 231. Use the in-game label SdKfz 231 and note the half-track look.
- **Footprints (collision, units):** Opel Blitz 160×60, Panzer II 105×60, Panzer III 126×74, Kübelwagen 80×30, Horch 110×60, Willys 95×50 (§12.2).

### 9.3 Vehicle roster (BEL)

| Vehicle | Missions | Who | Notes |
|---|---|---|---|
| Inflatable launch ("Zodiac") | 1, 2, 3, 17, 18 (and others) | Marine | The only vehicle that is also an item (H picks up/deflates; T releases in shallow water). Capacity 3. Deflates when shot. |
| Rowboat / "light boat" | 7, 13, 14, 19 | Marine | To a buoy; M19 current forbids rowing upstream |
| Biber-style mini-sub | 13 | Marine, 1 seat | 2 torpedoes; must hit the battleship's forward hull; second torpedo optional (patrol boat) |
| Truck (Mercedes/Opel-like; desert variant) | 1, 2, 4, 13, 16, 18 | Driver (Spy in M16) | "A few hits" (30 bullets) |
| Opel Blitz fuel tanker | 9, 11, 15 | Driver | One shot explodes it |
| Motorcycle + sidecar | 4 | Driver | Its enemy rider carries the alarm |
| SdKfz 231 (half-track look) | 6, 15, 18 (enemy); 7, 11 (drivable; M11 escape) | Driver | MG turret; 500 bullets or explosives |
| Panzer II | 4, 14 (drivable); 13, 19 (enemy) | Driver | 2 MGs, no cannon; drivable one immune to small arms |
| Panzer IV | 9 (3 enemy), 10 (4 enemy + 1 vacant, the only drivable IV) | Driver | MG + cannon; kills anything |
| Panzer III | 18 (Kildread), 20 (Ruetli) | Driver | Like the IV; in M20 it flattens buildings, V2s and troops and leaves via the SW gate |
| Friendly truck / jeep (Willys) / van | 3, 6, 8, 9, 15, 17, 18 | Anyone boards | Usually appears after objectives |
| Kübelwagen | 12 | Anyone boards | Escape car; cannot be driven |
| Enemy patrol boat | 2, 13 (enemy); 4 (escape) | Not controllable | Twin MG; M4 escape sails off by itself (`.ENEGIA 200`) |
| Autogyro | 5 | Anyone boards | Escape; the only autogyro in the game |
| Junkers Ju 52 | 10 | McRae only | Escape |
| Cable car | 5 | GB or Spy | Moves by itself; the Spy's only way up |
| Mine cart / light truck on rails + conveyor belt | 19 | Anyone | Moves by itself into the V2 base; SEC type 4 conveyor; a switch reverses it |
| Trains | 4, 6, 16, 18 | Not controllable | Block sight (hide behind); crush anything on the track, commandos included; stop when blocked |
| Tram | 15 | Not controllable | Enter to hide; hits a fuel truck parked on its track |
| Citroën 15 CV (two) and Horch | 15 (Horch also M8) | Enemy | Takes the general away on alarm |
| Fixed guns: MG nests, field gun / pier gun | 1, 4, 13, 14, 18 | Driver | Kill the gunner, activation click, Ctrl+click fire, portrait to leave; cannot move |

### 9.4 Things vehicles can do in the world

- **Run over enemies silently** (M1 truck through a pair of guards, M16 truck, M15 van).
- **Block things:** a truck at the tank-depot door keeps the Panzer inside (M13); a truck on the bridge blocks an enemy sapper (M16); a burning lorry in the inner gate seals it against reinforcements (M4, suggested by the briefing as a "fire barrier"; Kildread destroys the entrance arch instead); a fuel truck in front of the tank shed destroys all 3 Panzers when blown (M9); a truck parked in front of the tanks blocks them (M9).
- **Stop a train:** a motorcycle on the level crossing makes the train brake, stopping the enemy lorry so it can be taken (M4). A grenade on the track stops trains (M18).
- **Wrecks block paths** once the fire burns out (eggie M10).
- **Accidents:** tram + fuel truck destroys the M15 HQ without an alarm.

---

## 10. Behind Enemy Lines: the 20 missions

### 10.1 Mission titles and variants

Official English titles are the Prima / fan-wiki / PCGamingWiki ones. Kildread's FAQ titles are clumsy re-translations (apparently of the French release), not an official English set; overview.md's claim that the second set is "American" is superseded. Spanish titles from ES Wikipedia and the Spanish fan wiki; German from GameFAQs #64751.

| # | English | Spanish | German | Kildread variant |
|---|---|---|---|---|
| 1 | Baptism of Fire | Bautismo de fuego | Feuertaufe | Baptism of Fire |
| 2 | A Quiet Blow-Up (fandom "A Quiet Blowup") | Voladura silenciosa | Still und leise hochgejagt | Discret Explosion |
| 3 | Reverse Engineering | Ingeniería inversa | Stromstörung | Backward Throttling |
| 4 | Restore Pride | Cuestión de orgullo | Eine Frage des Stolzes | An Eye for an Eye |
| 5 | Blind Justice | Justicia ciega | Blinde Justiz | Blind Justice |
| 6 | Menace of the Leopold | La amenaza del Leopoldo | Leopold darf nicht üben | Leopold's Menace |
| 7 | Chase of the Wolves | La caza de los lobos | Wolfsjagd | Hunting Wolves |
| 8 | Pyrotechnics | Ejercicio pirotécnico | Feuerwerk | Fireworks |
| 9 | A Courtesy Call | Una visita de cortesía | Höflichkeitsbesuch | Courtesy Call |
| 10 | Operation Icarus | Operación Ícaro | Operation Ikarus | Icare Operation |
| 11 | In the Soup (Prima: "Into the Soup") | Crudo y sin refinar | Stillgelegte Felder | In the Soup |
| 12 | Up on the Roof | Adiós, Túnez | Hoch auf dem Dach | On the Roof |
| 13 | David and Goliath | David y Goliat | David und Goliath | David and Goliath |
| 14 | D-Day Kick Off | Día D: Saque de honor | Vorspiel für den D-Day | D-Day Kick Off |
| 15 | The End of the Butcher | El fin del carnicero | Das Ende des Schlächters | End of the Butcher |
| 16 | Stop Wildfire | Pólvora mojada | Koordinierte Aktion | Fire Halt |
| 17 | Before Dawn | Antes del amanecer | Vor dem Morgengrauen | Before Dawn |
| 18 | The Force of Circumstance | La fuerza de las circunstancias | Ironie des Schicksals | The Strength of Hazard |
| 19 | Frustrate Retaliation | La hora de la represalia | Frustrierte Vergeltung | Frustated Revenge |
| 20 | Operation Valhalla | Operación Valhalla | Operation Walhalla | (not covered) |

### 10.2 Campaign overview

Team key: GB Green Beret, Sn Sniper, Ma Marine, Sa Sapper, Dr Driver, Sp Spy. Map size: fan-wiki stitched image in pixels (≈ map units in x; y ÷ sin 40° for units) and approximate ground size at 0.045 m/unit.

| # | Title | Location | Date | Team | Main objective | Exit | Map px (≈ m) |
|---|---|---|---|---|---|---|---|
| 1 | Baptism of Fire | Sola, near Stavanger, Norway | 20 Feb 1941 | GB, Ma, Dr | Blow up the radio relay station | None (ends on the explosion) | 1445×2444 (65×171) |
| 2 | A Quiet Blow-Up | Stamsund, Lofoten | 1 Mar 1941 | GB, Sn, Ma, Sa, Dr | Blow up the fuel depot | Truck, SE road | 1829×1484 (82×104) |
| 3 | Reverse Engineering | Sysendam dam, Eidfjord | 4 Mar 1941 | GB, Ma, Sa, Sp | Demolish the dam | Allied truck (north; Prima: east of the dam) | 3293×1895 (148×133) |
| 4 | Restore Pride | Stokkan, near Trondheim | 10 Mar 1941 | GB, Sn, Ma, Sa, Dr | Destroy the HQ villa | Patrol boat (self-driving) | 4423×2444 (199×171) |
| 5 | Blind Justice | Herdla | 2 May 1941 | GB, Sp | Destroy the radar | Autogyro | 2388×1871 (107×131) |
| 6 | Menace of the Leopold | Masi | 10 May 1941 | GB, Sn, Sa | Disable the Leopold railway gun | Friendly truck from the NE | 2940×1495 (132×105) |
| 7 | Chase of the Wolves | Arendal | 7 Feb 1942 | GB, Ma, Sa, Dr, Sp | Sabotage 2 U-boats | Rowboat to SE buoy | 3194×2792 (144×195) |
| 8 | Pyrotechnics | Tell el Eisa, Egypt | 19 Oct 1942 | GB, Sn | Destroy oil barrels, fuel tanks and reservoir | Jeep at the bridge | 2495×1495 (112×105) |
| 9 | A Courtesy Call | Bab el Qattara, Egypt | 20 Oct 1942 | GB, Sn, Sa, Dr, Sp | Destroy detection gear, weapons store, command post, bunker | Friendly truck, SW | 2294×1742 (103×122) |
| 10 | Operation Icarus | El Agheila, Libya | 14 Nov 1942 | GB, Sn, Sa, Dr + McRae | Rescue McRae, destroy the bomb store (Stukas optional) | Ju 52 flown by McRae | 2654×2989 (119×209) |
| 11 | In the Soup | Maradah, Libya | 3 Dec 1942 | GB, Sn, Sa, Dr, Sp | Destroy 4 drilling rigs | SdKfz, W/NW | 2238×2190 (101×153) |
| 12 | Up on the Roof | Tunis | 15 Mar 1943 | GB, Sn, Sp + informer | Free the informer; regroup | Kübelwagen, SE | 1681×1712 (76×120) |
| 13 | David and Goliath | Le Havre | 15 May 1944 | GB, Sn, Ma, Sa, Dr | Torpedo the "Bismarck replica"; destroy fuel tanks | Boat to SW buoy | — |
| 14 | D-Day Kick Off | La Rivière (Juno) | 25 May 1944 | GB, Sn, Ma, Sa, Dr | Destroy 4 coastal guns | Boat to SE buoy | — |
| 15 | The End of the Butcher | Compiègne | 26 Aug 1944 | Sn, Ma, Dr, Sp | Kill SS-Gruppenführer Schleper; destroy HQ | Truck at the cemetery (N) | 1798×1987 (81×139) |
| 16 | Stop Wildfire | Maas bridge, Liège | 4 Sep 1944 | Sn, Ma, Sp | Kill 4 bridge sappers almost at once | Truck, S | 4457×2135 (201×149) |
| 17 | Before Dawn | Riveauvillé, N of Colmar | 28 Nov 1944 | GB, Ma, Sp + Gilbert & 4 | Free Gilbert and his men | Truck, NW | — |
| 18 | The Force of Circumstance | Maas bridge, Liège | 16 Dec 1944 | GB, Ma, Sa, Dr | Blow up the bridge | Truck, S/SE | 4457×2135 (201×149) |
| 19 | Frustrate Retaliation | Oldenburg, W of Bremen | 12 Jan 1945 | GB, Sn, Ma, Sa | Destroy 3 V2 rockets and pads | Boat downstream, NE | — |
| 20 | Operation Valhalla | Gundelfingen castle, N of Freiburg | 11 Feb 1945 | All six | Destroy the castle HQ and 2 V2s | Tank out the SW gate | 3486×2316 (157×162) |

**Roster disagreement:** a coregamers walkthrough says "all six" for M4, M7, M9, M10 and M11; Prima, Kildread and fandom agree on the smaller teams above.

### 10.3 Loadouts per mission (Kildread; first aid = 6 doses everywhere)

| # | Rifle rounds | Sapper | Medic | Notable on-site items |
|---|---|---|---|---|
| 1 | – | – | Driver | 5 barrels; raft; truck; MG nest; Driver has SMG |
| 2 | 5 | 2 time bombs | Driver | 4 barrels; truck; SMG |
| 3 | – | wire cutters, 2 time bombs (on site) | Spy | uniform on site; raft on site; electrified-fence switch |
| 4 | 4 (+3 air-drop) | 3 grenades, 1 time bomb (air-drop) | Driver | patrol boat; Panzer II; 3 MG nests; motorcycle; truck; SMG (air-drop) |
| 5 | – | – | Spy | 3 barrels; uniform; cable car; mines; telephones |
| 6 | 5 | 2 remote bombs | Sniper | — |
| 7 | – | 4 time bombs (air-drop) | Driver | small boat; SdKfz; 2 barrels; uniform; Marine has no knife |
| 8 | 6 | – | Sniper | 10 barrels |
| 9 | 5 | 2 remote bombs | Driver | Opel Blitz tanker; 4 barrels; Spy starts in uniform |
| 10 | 3 | 4 grenades, 1 time bomb | Driver | Panzer IV; Ju 52 (pilot only); SMG; 4 barrels |
| 11 | 5 | 1 grenade, 3 remote bombs | Driver | SdKfz; MG nest; 5 barrels; Spy in uniform |
| 12 | 7 | – | Spy | GB has decoy only (no shovel from here on); Spy in uniform |
| 13 | 4 | 1 remote bomb | Driver | mini-sub (2 torpedoes); truck; 2 barrels |
| 14 | 8 | 3 remote bombs | Driver | Panzer II; 5 MG nests; small boat; 3 barrels |
| 15 | 4 | – | Driver | 2 Citroën 15 CV; Opel Blitz; truck; uniform |
| 16 | 5 | – | Spy | uniform; Spy drives the truck |
| 17 | – | – | Spy | 1 barrel; raft; Spy in uniform |
| 18 | – | 2 grenades, 3 remote bombs (on site) | Driver | Panzer III; 2 MG nests; truck; raft; 4 barrels |
| 19 | 7 | trap, 2 remote bombs | Sniper | boat; 4 barrels |
| 20 | not documented (use 5 [inferred]) | ≥2 grenades; 1 (Prima) or 2 (oocities) remote bombs; trap likely | Driver [inferred] | Panzer III; uniform on clothesline |

The bear trap is in every mission the Sapper is deployed in. The Green Beret's shovel is listed for M1-M11 only.

### 10.4 Mission-design facts that apply everywhere

- **Kildread's enemy taxonomy:** moving guards (fixed routes), isolated guards (stand and sweep), patrol groups, Gatling (MG) operators (nests or elevated towers), garrison "bunkers" (buildings that pour out reinforcements; fandom: M2 has "the first Garrison, a building that contains enemy troops inside"), surveillance bunkers/towers, vehicles.
- **Silent zones:** where noise or suspicious sights trigger the alarm. M1: "the entire map is safe". M2: only anything seen "on the other side of the river". From M5 on most maps: "anything suspect … in the ENTIRE map". Exact zone polygons are published nowhere; in the engine they are named areas in `MAPA00NN.SEC` wired by the MIS sensors, and each barracks has a patrol with `.EXITHOME_EVENTS EVT`.
- **Alarm consequences are mission-specific:** reinforcements; instant failure (M15; BCD 2, 5, 6); tanks activating (M9, M10).
- **Items on site:** explosive barrels, uniforms on clotheslines, air-dropped supply crates under white parachutes, sniper ammo, vehicles.
- **Extraction:** all surviving commandos (and escortees) onto the exit vehicle or point, after the objectives; the exit vehicle only ends the mission once objectives are done and every living commando is aboard (walkthroughs always board last) [inferred general rule, supported by M6, M7, M9-M12].
- **Theater palettes:** Norway (M1-M7) snow, pines, timber; North Africa (M8-M11) sand, desert camo and orange cones; Tunis (M12) urban Arab architecture; France/Belgium/Germany (M13-M20) green fields, stone towns, docks. The December missions (M18, M19) have **no snow**.
- **Coordinates below** are fractions of the fan-wiki stitched map, x 0 = W → 1 = E, y 0 = N → 1 = S, estimated by eye. Soldier numbers are Prima's figure numbers. "TA" = the Colonel's Tactical Advice (fandom transcription of the English voice-over); "NB" = Kildread's scrapbook re-translation of the Ctrl+B hints.
- Reference images: every mission has a full stitched map (`C1_Mis_N_Map.png`) and BEL missions have 4 briefing stills (640×480) and a notebook map on the fan wiki. Local copies (`refs/missions/m1..m4_map_full.jpg`, `bel05..bel20_map_*.jpg`, `bcd01..bcd08_map_*.jpg`, contact sheets) and the Prima PDF (mission overview figures on PDF pages 68, 73, 80, 88 for M1-M4) are in the research scratchpad; about 176 fandom image URLs are listed in `notes/mission_refs.md`.

### 10.5 Mission details

#### M1 Baptism of Fire
**Sola, near Stavanger, Norway, 20 Feb 1941.** Target: a relay station that relays radio traffic for Stavanger airfield. In the demo.
- **Team:** Green Beret (knife, pistol, decoy, shovel); Marine (knife, pistol, speargun, diving gear); Driver (pistol, SMG, first aid). On site: 5 barrels, the inflatable boat, a transport truck, an MG nest.
- **Objective:** blow up the relay station on the NW island. The men start separated and must regroup at a meeting point (the jetty). Briefing: "there are some fuel barrels that can be useful. The green beret can handle them." Footprints in snow are visible to enemies.
- **File (`MAPA0000.MIS`):** `OBJETIVO RADIOEXP`, no escape keys; `.PAR_TICKS 3100` (≈2:35). Radio station blast `.RADIO 150 .DANO 200`. Patrols in the file work out to 2, 3 and 5 men (NSOLDIERS + leader); Kildread counts a 2-man and a 3-man patrol.
- **Enemies (Kildread):** 4 moving, 3 isolated, a 2-man and a 3-man patrol, 1 Gatling (≈14). **No silent zone.**
- **Map:**
  - North landmass (y 0-0.25): relay hut with antenna mast and a parked vehicle in the far NW (0.20, 0.07); two big weathered timber barracks, one L-shaped (0.49, 0.11), the other at (0.22, 0.19); red fuel barrels; a wooden pier on the SE shore (0.64, 0.19); snow patches and pines.
  - River/fjord (y 0.25-0.60): a wide teal channel W to NE with two rocky islets mid-west (0.30, 0.42). The eastern island/peninsula (x 0.55-1, y 0.32-0.60) is the Marine's start; the inflatable lies on its west shore (0.67, 0.35).
  - South bank (y 0.60-1): wooden jetty (0.49, 0.59, the rendezvous); two-storey timber house with a snowy roof (0.47, 0.67); a low stone wall with a plank roof SW to the road with a small sentry box; an asphalt road from the SW corner (0, 0.90) to a bend below the house (0.40, 0.76), then E/SE to (1, 0.87), with timber debris at the bend and telegraph poles; a canvas-covered truck on the east leg (0.80, 0.79); deciduous groves; boulders and snowfields in the far south.
- **Placements:** the Green Beret starts alone S of the road (Soldier 6 W of him behind rubble, Soldier 7 at the house). The Driver starts near the truck (Soldiers 8-9, a pair walking N-S to the truck). Marine island: Soldier 1 patrols the N shore near the E edge, 2 walks W, 3 stands by the boat facing away. Soldiers 4-5 across the water on the north-central shore. North island: 3-man patrol (10-12) circling the relay station and barracks; MG nest (13) covering the S approach.
- **Solution (Prima, metamud, oocities):** the Marine dives, surfaces behind each guard and harpoons 1-3, deflates the boat, kills 4-5 from the water. The Green Beret knifes 6, uses the wall's shadow, climbs the wall (pick cursor), knifes 7 and hides the body N of the house. He drops the decoy on the road; 8-9 walk to it and stare; the Driver double-clicks the truck past them and runs them over (a single click drives slowly and they shoot him). The Marine inflates the boat at the jetty and rows everyone N, landing behind the main building. Kill the patrol with a barrel shot as they pass, or with the decoy plus the Driver on the captured MG after the Marine knifes the gunner. The Green Beret carries a barrel next to the relay station and shoots it. Kildread: "Enjoy the fire and MISSION ACCOMPLISHED!" Metamud challenge: finish killing only 2 soldiers.

#### M2 A Quiet Blow-Up
**Stamsund/Storfjord, Lofoten, 1 Mar 1941.** Part of Operation Claymore; target a fuel depot, to "shorten the range of enemy armored divisions".
- **Team:** Green Beret (decoy, shovel); Sniper (5 rounds); Marine (speargun, diving gear, raft); Sapper (trap, 2 time bombs, 10 s); Driver (SMG, first aid). On site: 4 barrels, transport truck inside the camp.
- **Enemies:** 6 moving, 1 isolated, a 4-man and a 3-man patrol, **2 elevated MG posts**, **1 patrol boat**, 2 garrisons. **Silent zone:** anything suspicious across the river.
- **Map:**
  - River from the W edge (0, 0.35) diagonally to the SE (0.85, 1), rocky banks, two pine islets. The **patrol boat** (twin MG) motors up and down; take cover when you hear the engine and deflate the raft after crossing.
  - SW bank (start): two snowy log cabins (0.07, 0.77) and (0.19, 0.88), palisade fences with W and E openings; team starts behind the fence near the southern cabin; guards 1-3 patrol between the cabins and support each other.
  - NE bank: a walled camp (timber palisade drawn as a diamond: W (0.20, 0.35), N (0.52, 0.12), E (0.87, 0.36), S (0.55, 0.62)) with the flagged **garrison barracks** (0.39, 0.25), small cabins and an arched hut, the **fuel depot** (two big horizontal tanks on cradles, 0.65, 0.34), the Opel-type truck, crates and barrels, and two outward-facing wooden **MG towers** on the N walls (0.37, 0.17), (0.67, 0.18) (leave them: patrols outside would find the bodies).
  - A **ladder** on the river-facing SW wall (0.33, 0.47) is pulled **up**. The **main gate** (sentry box, barrier) is on the SE wall (0.68, 0.50) with a track SE off the map (the escape). A second guard barracks outside the E corner (0.84, 0.33), marked by a flagpole. Big rocks below the wall give hiding places. A 4-man patrol walks N-S along the E edge.
- **Solution (Prima):** the Sapper sets the trap by a cabin corner and leaves **footprints in the snow**; Soldier 1 follows them into it; re-arm for 2; knife 3 or harpoon him as he follows footprints through the fence gap. The Sniper shoots 4 in front of the large rocks and 5 on the wall near the ladder (bodies elsewhere are seen). After the patrol boat passes the Marine rows the team two at a time. The Green Beret climbs the wall and lowers the ladder; knife 6 and 7; raise the gate. Everyone but the Sapper boards the truck; he plants one charge at the depot and one at the E corner of the wall (which takes out the outside barracks) and boards. Double-click the end of the road and **don't stop**, or the E patrol shoots up the truck. If the truck exits before the bomb goes off, the continue/quick-load dialog appears (§2.5).
- **Exit:** SE road (Kildread, Prima; overview.md's "SW road" is wrong). Kildread's truck rams the barrier.
- **Scrapbook:** "If one of your group is captured, he will be transferred in one of the prisons where you can free him." The M2 text mentions "the escape point".

#### M3 Reverse Engineering
**Sysendam dam near the Sima hydro plant, Eidfjord, 4 Mar 1941.** Demolishing the dam also knocks out bridges and the area's power. In the demo.
- **Team:** Green Beret (decoy, shovel); Marine (speargun, diving gear; raft on site); Sapper (trap, wire cutters; 2 time bombs on site inside the power station); Spy (injection, first aid; uniform on site).
- **Enemies:** 7 moving, **17 isolated**, a 5-man and a 3-man patrol, 1 Gatling, 1 surveillance bunker, 4 garrison bunkers (Prima numbers soldiers up to 27 plus a 4-man patrol). **Silent zones:** the outskirts of the E camp and the S bank.
- **Map:** a curved concrete **arch dam** in the NW (0.24, 0.25) spanning a rocky gorge, reservoir in the NW corner; the river (about 0.15 of the map wide) runs from the dam base to the SE corner; power lines on lattice pylons. **SW bank:** the power station inside a chain-link **electric fence** (about half the SW quadrant): ~12 fenced transformer cages (x 0.05-0.45, y 0.70-0.95), snowy admin and barracks buildings, a large shed, red cable drums, the **fence switch**, the explosives, a main gate with a road from the W and a signpost; a **bunker** at the dam's SW abutment. **North/NE:** grey cliffs (y 0.15-0.35, x 0.5-1); a grassy NE plateau with the **start** behind a ruined wall at the top edge (0.73, 0.03); a gully leading W to the river. **E bank:** a log-palisade German camp (x 0.62-0.97, y 0.33-0.75) with 4-5 cabins, a well, cable spools, and the **clothesline with the uniform**; grey tents outside its NE corner.
- **Placements:** 3-man patrol (1-3) passes the start; 4-6 guard the way down to the river (6 looks over the water); the camp holds 7-14 (8 wanders the tents, 14 watches the river); 15-16 walk the power-station bank outside the fence; the station holds 17-27 (17 inside overlooking the river, 18-21 by the buildings, 22-27 near the main gate); a 4-man patrol circles the NW near the gate and can see the gate kills.
- **Solution:** trap one of 1-3; the decoy freezes the other two for the harpoon; decoy-lure 4-5 into the gully and kill them; knife 6. The Marine clears the camp from the river. He rows the Spy to the clothesline; in uniform the Spy **walks across the dam into the station unchallenged**, flips the **switch** to kill the fence (sparks `.CHISPAS`, sounds `APAGELEC`), and Distracts 17. The Sapper cuts the fence; the Green Beret knifes while the Spy distracts; the Sapper takes both charges. Row to the bunker; the first charge behind it triggers the alarm and reinforcements (hide the boat). When things calm down, plant the second at the dam base.
- **Exit:** "Once the dam is destroyed, an allied Truck will help your men escape… Wait until the Truck comes and stops then load everyone in it." Kildread, overview and systems: truck to the **north**; Prima: it appears **east of the dam** and the Spy crosses the dam to board. eggie uses the under-shot trick here.

#### M4 Restore Pride
**Stokkan, near Trondheim, 10 Mar 1941.** Target: the German command's HQ villa. Prima: "more than 50 enemy soldiers, not counting reinforcements".
- **Team:** Green Beret (decoy, shovel); Sniper (4 rounds, +3 in the air-drop); Marine (speargun, diving gear, raft); Sapper (trap, 3 grenades, +1 time bomb in the air-drop); Driver (first aid; SMG in the air-drop). On site: 3 MG nests, a **Panzer II**, a **motorcycle**, a truck, the patrol ship.
- **File (`MAPA0002.MIS`):** `.PAR_TICKS 15100` (≈12:35); escape `VEHICULOHUIDA LANCHA` (boat `.ENEGIA 200`, EXIT route); crate bomb `.Retardo 150` (7.5 s); zones `PELIGRO`→`RINT` (siren), `DELANTERA`→`REXT`, `EXTERIOR`→`RPER`; barracks `GUARNICION` (10), `GUARNICION2` (10), jail `CASA_CARCEL` (5), all patrols `.JAIL CARCELB`; courier `MOTORISTA`; train `Vista02` polygon.
- **Enemies:** 10 moving, **24 isolated**, a 5-man patrol, five 3-man patrols, 3 Gatlings, 1 motorcyclist, 1 truck driver, 2 garrisons. **Silent zones:** the HQ outskirts, and the motorcycle sentry, who "will go to the camp and sound the alarm".
- **Map:** the NW is open fjord; a **narrow fjord inlet with tall grey cliffs** cuts from the W-centre (0.2, 0.42) to the SE corner (0.75, 1), splitting the SW bank (start) from the NE bank (HQ).
  - **Railway:** from the SW rail yard (sidings, derelict wagons and carriages, rubble, one building) NE over a **trestle bridge** across the gorge (0.53, 0.78) to the E edge. A **steam train crosses periodically** and kills anyone on the tracks. A **ladder** on the right-hand bridge pillar is a refuge and gives water access.
  - **SW bank:** team starts by a grove in the SW corner; patrol 7 (3 men) walks a figure-eight around the yard; the **empty Panzer II** sits among the wagons with a guard W and E; barbed wire on the gorge rim; an MG nest covers the bridge's W end; 23 enemies on this side.
  - **NE bank:** a road leaves the HQ gate, winds E (0.78, 0.37) then SE off-map. A **level crossing with a shack** (0.87, 0.43) where a **supply truck periodically stops** (its driver is unarmed and "won't even yell"). A **motorcycle sentry** at the E end of the bridge rides off to raise the alarm or bring an extra patrol. Dark pines NE. The **air-drop** under a white parachute (0.90, 0.14) holds the explosive, 3 rounds and the SMG, guarded by patrol 33. Aircraft wreckage SE [est.].
  - **HQ:** a red-brick 2-3 storey villa (0.38, 0.15) with a **circular drive around a monument** (0.42, 0.23); **double walls** (outer and inner, each with a gate and gatehouse, a patrol between them); inner-court barracks; MG nest 43; a sentry at the top of the stairs; stone steps down to a wooden pier with the **patrol boat** (0.19, 0.44), the escape, which runs by itself.
- **Solution (Prima):** (1) everyone prone; the Green Beret knifes 1-6 and hides the bodies. (2) The Sapper grenades patrol 7; 8-10 investigate and get a second grenade (keep the third); the Green Beret knifes 11-13. (3) The Driver takes the Panzer II (Ctrl+click fires the MG) and runs over or shoots 14-19, then fires across the gorge at 20; patrol 21 and guard 22 come to the body and die, then 23-26. (4) Cross the bridge between trains; the Sniper kills MG nest 27; the Green Beret knifes 28-31, **buries himself in the snow** and pistols 32 who investigates. (5) Follow patrol 33 to the air-drop; the Driver grabs the SMG and kills the patrol; the Sapper takes the explosive and the Sniper the ammo, then snipes 34-36. (6) The Driver steals the truck and stops it **halfway through the inner gate**; the Sapper grenades it and the burning wreck seals the gate. (7) The Driver machine-guns 38-41; the Sniper kills 42 and MG nest 43; the Driver kills 44 by the boat. (8) The Sapper plants the charge on the **HQ steps**; everyone boards the patrol boat, which leaves automatically.
- **Alternatives:** park the tank nose-first on the rock ledge across the inlet and shoot into the courtyard; descend the bridge ladder and row the Sapper and Sniper to the platform by the escape boat (metamud). A grenade too near a gate **collapses it**. A motorcycle left on the level crossing makes the train brake so the lorry can be taken.

#### M5 Blind Justice
**Herdla, 2 May 1941.** Target: the radar station near Herdla airfield. Map 2388×1871.
- **Team:** Green Beret (decoy, shovel; 3 barrels on site); Spy (injection, first aid; uniform on site behind crates near Soldier 8). Both start NW behind a village building.
- **Layout:** the log-house village fills the W half (0.05-0.43, 0.1-0.85) with pine groves, at the foot of a huge grey rock massif (0.5-1.0, 0.1-0.65). The **radar dish** is on the NE summit plateau (0.86, 0.07), with a long barracks (0.62-0.73, 0.10-0.25), a second barracks (0.95, 0.22), a hut (0.93, 0.08), **3 barrels** near (0.84, 0.27) and the **autogyro** (0.74, 0.05), present from the start. The **cable car** runs from the lower station (0.38, 0.68) to the top (0.52, 0.35). Only the Green Beret can climb the **E rock face**. **Mines** on the S approaches: patrol 19 walks E-W along y ≈ 0.9, and there is a mine inside its wide turn at the E end; its footprints are safe to walk in. **2 telephones**: calling on the southern one pulls the guard to the northern one. Guards 9-13 around the lower station; 14-17 and patrol 18 on the summit. A flagged bunker SE (0.87, 0.90), probably the third garrison [inferred].
- **Enemies:** 8 moving, 9 isolated, patrols of 2, 3 and 4, 3 garrisons, mines. **The whole map is a silent zone**; an alarm empties the summit barracks and makes the mission "nearly impossible" (no scripted fail).
- **TA:** (paraphrased) Approach from the south, destroy the radar and escape in the autogyro by the antenna; reach the summit by cable car or by climbing the east rock face; an internal telephone can lure guards; the southern approaches may be mined.
- **NB:** Spy must steal a uniform; southern phone attracts attention to the northern phone; top reachable by aerial ropeway or by climbing the E cliff; mines S of camp, watch the patrols to know where to step; Green Beret can dig into the snow; "It would be wise to destroy the Bunker on top of the mountain"; use the small plane near the antenna to get away.
- **Solution:** the shovel-bury trick (leave tracks, bury, knife the investigator); the Spy takes the uniform; the Spy distracts while the Green Beret kills the two cable-car guards; at the top, barrels beside the barracks and radar dish, one pistol shot as the patrol passes for a chain explosion; both board the autogyro.

#### M6 Menace of the Leopold
**Masi, 10 May 1941.** Map 2940×1495 ("map 6" uses the fake-height `POLYZOOM` polygons, if the Revora numbering is by mission).
- **Team:** Green Beret; Sniper (5 rounds, first aid); Sapper (trap, 2 remote bombs). All start NW.
- **Layout:** green spring terrain with barbed-wire lines and shell craters. The way in is the **bombed two-storey house** (0.12-0.33, 0.15-0.45): round turret (0.13, 0.22), exterior stairs, grandfather clock, interior ladder, white stairs, a ladder at the E entrance; the Green Beret climbs its wall. **Road** from the W edge (0, 0.27) SE to (0.45, 0.85), E along y ≈ 0.9, then NE to (1, 0.5). **Railway** diagonally from (0.38, 0) to (1, 0.85) with a curved spur N. **The Leopold** on the track (0.78-0.90, 0.50-0.60); railway cars (0.62-0.72, 0.35-0.45). Palisaded **compound** (0.28-0.75, 0.3-0.8) with tents and round watchtowers (0.44, 0.70), (0.72, 0.65). **HQ** S/SW of the gun (0.62-0.70, 0.62-0.78), Soldier 16 on its roof; avoid it. NE fortified block (0.82-0.95, 0.28-0.5) with ladder and platform (27-29). **Gatling 30** beside the railway on the pickup route. Craters and rocks in the SW (0-0.3, 0.45-0.85) are the only safe zone.
- **Enemies:** 13 moving, 18 isolated, patrols of 2 and 3, **an armed SdKfz 231 patrolling the road**, 1 Gatling, 3 garrisons. **Alarm:** anything seen "from the destroyed building to the west to the cannon to the east" (Kildread); an alarm near the HQ "ruins the mission" (Prima). The SdKfz can be destroyed in the SW zone without an alarm (Prima: a remote charge on its route far from the HQ; soldiers 14-15 investigate).
- **Exit:** the charge goes at the foot of the ladder onto the cannon. The friendly **truck enters from the NE only after the cannon is destroyed** and drives past the Gatling; board it while it moves. Guards can destroy it, so kill 27-30 first.
- **TA:** (paraphrased) Approach from the north-west, disable the cannon so it can never fire again; a truck picks the team up in the north-east.
- **NB:** the SdKfz 231 can be destroyed in the SW zone without an alarm; once the cannon is destroyed a friendly truck evacuates you from the NE; "The enemy can destroy the evacuation truck with their guns and rifles!"
- **Solution (Prima's 5 phases):** outer defences, inner-compound approach, clear the compound, clear the escape avenue, blow the gun. The Green Beret clears the house floor by floor and uses the decoy at the top of the stairs.

#### M7 Chase of the Wolves
**Arendal, 7 Feb 1942.** New U-boat ciphers; sabotage the U-boats stopping at Arendal. Map 3194×2792.
- **Team (two groups):** Group A (Sapper, Driver, Spy) inside the W base, behind a building W of the northern compound entrance; Group B (Green Beret, Marine) on the NE clifftop behind a rock, blocked by soldiers 1-2 and patrol 3.
- **Items:** uniform on a clothesline by Soldier 15 at the dockyard gate; an **air-dropped crate with 4 time bombs** N of Group A near patrol 14; **2 barrels** N of the village barracks; a vacant SdKfz in the dock (251 per Prima/fandom, 231 per Kildread); the rowboat at the marina jetties (0.8-0.95, 0.55-0.7).
- **Layout:** stone-walled base with an inner yard (0.2-0.6, 0.3-0.75), 2 barracks (0.35, 0.36) and (0.46, 0.40), a flag and a timber gateway (0.23, 0.44); a Quonset hangar NW (0.13, 0.12); **U-boat pens** SW: two piers (0-0.25, 0.62-0.85) with 2 U-boats and a platform with a ladder between them; a mole to the lighthouse (0.53, 0.83); the fishing village E (0.65-1.0, 0.25-0.6) with a barracks; about 20 small boats SE; cliffs N; the **red buoy** at (0.97, 0.92).
- **Enemies:** 10 moving, 5 isolated, three 2-man and three 3-man patrols, a 5-man patrol, **two 210 mm guns** (22, 23; fandom "230mm"; gun 23 covers the water W of the jetty), 1 Gatling, 3 garrisons. **Alarm is split:** seen W of the middle wall → the left (dock) barracks empties; heard in the village houses → the right (village) barracks empties. A barrel at the village barracks' W corner kills it (soldier 9 and patrol 10 respond). Blowing gun 22 empties the dock barracks.
- **Objective rule:** each charge at the **stern next to the torpedoes** ("near the torpedoes in the upper part of the subs"), or the damage is superficial.
- **Exit:** the Marine rows everyone to the buoy in the **SE corner** (TA only says "southwards").
- **TA:** (paraphrased) The team starts in two groups; take the charges, destroy the U-boats and row south to the buoy.
- **NB:** find the charges; place them near the torpedoes in the upper part of the subs; your team must get and use the SdKfz; take the small boat to the beacon SE.
- **Solution:** the Spy sprints for the uniform and distracts the patrol while the Sapper grabs the air-drop; the Sapper deliberately blows the barracks so the garrison runs out (oocities); the Green Beret and Marine clear the village and take the boat; charges on the subs; row to the buoy.

#### M8 Pyrotechnics
**Tell el Eisa, Egypt, 19 Oct 1942.** The first desert map (orange cones). Map 2495×1495.
- **Team:** Green Beret (10 barrels on site); Sniper (6 rounds, first aid). Start in NW mud-brick ruins on the plateau (0-0.6, 0-0.2), with 2 barrels at the top of the slope.
- **Layout:** an escarpment along y ≈ 0.2-0.3; the **210 mm gun (29)** on the plateau edge (0.55, 0.05), killed with the barrel beside it (the Green Beret escapes down the cliff with the pick); a hedgehog/wire line (0.28-0.7, 0.38-0.45); the **water reservoir** (0.62, 0.42); the **bridge** over a N-S wadi (0.7-0.85, 0.30-0.38) guarded by **Gatling 32** and soldier 31; **fuel tanks** (0.5-0.63, 0.6-0.7) with a ladder and guards 26-28 on top; crate and drum stacks (0.4-0.5, 0.45-0.55); a white domed barracks (0.25, 0.55) and a barracks with soldier 19 on its roof next to the truck (0.18, 0.57); tents; a barracks row (0.2-0.45, 0.72-0.8); a flagged bunker SW (0.12, 0.85); wire on the S and E. Houses can be entered to hide (and the Horch car).
- **Enemies:** 17 moving, 13 isolated, a 210 mm gun, 1 Gatling, 2 garrisons. **Whole map silent**; the first explosion empties the barracks (blowing the gun raised the alarm in eggie's play).
- **Exit:** the jeep (Willys) arrives at the bridge **only "when everything is burning"** (Kildread: "the friendly hummer should arrive").
- **TA:** (paraphrased) Start at the north-west ruins, blow up every oil barrel, the fuel depots and the large reservoir, then meet a friendly vehicle at the extraction point.
- **NB:** clean up the zone before the friendly vehicle arrives, because many weapons watch that area; you can hide in the houses.
- **Solution (Prima's 4 phases):** clear the plateau with Sniper-and-knife pairs; infiltrate the depot; barrels between the tanks for a **chain reaction**; one pistol shot from outside the wire at the barrel by the reservoir; run for the jeep.

#### M9 A Courtesy Call
**Bab el Qattara, Egypt, 20 Oct 1942.** The 21st Panzer camp; the team starts "the other side of the mines field". Map 2294×1742. Prima: "a welcome relief", short with few guards.
- **Team:** Green Beret (4 barrels), Sniper (5 rounds), Sapper (2 remote bombs) start S outside the walls; Driver (Opel Blitz on site; first aid) and Spy (already in uniform) start N.
- **Layout:** an octagonal adobe wall (0.05-0.92, 0.04-0.8). Inside: the **tank shed with 3 Panzer IVs** NW (0.13-0.30, 0.07-0.22); the red fuel truck (0.12, 0.32); the sandbag **bunker** (0.17, 0.40); a gantry crane (0.33, 0.40); warehouses (0.54, 0.12), (0.64, 0.21); the domed, flagged **command post** E (0.8-0.9, 0.3-0.5); the **antenna** in sandbags (0.77, 0.53) cabled to the **comms building** (0.69, 0.62); barrels (0.53, 0.41). E gate = the NE gap (0.72, 0.25); W gate = a wire-mesh corridor SW (0.13-0.58, 0.45-0.9) whose road runs to the W edge (0, 0.8). The team can hide inside the weapons store.
- **Enemies:** 4 moving, 5 isolated, three 3-man patrols, 3 Panzer IVs, 1 garrison (blow it to stop reinforcements). Two 3-man patrols outside run in through the gates after explosions (trap the E gate). **Whole map silent.**
- **Fail trigger:** the Panzers are "on standby" and fire when you are seen (Kildread: "If a Panzer IV fires on your team before you escape…"). Counter: park the fuel truck in front of the shed and blow it (destroys all 3), or park a truck in front of the tanks.
- **Exit:** a friendly truck **arrives in the SW corner after the objectives** (eggie, Kildread; TA "from the south"); Prima instead drives the camp truck out the W gate.
- **TA:** (paraphrased) Start near the camp at dawn; the Panzers are on standby; destroy the detection equipment, weapons store, command post and bunker; a vehicle collects the team in the south.
- **NB:** the Panzers can fire on you if you are seen; leave in the friendly vehicle in the SW zone.
- **Solution:** the Spy poisons the gate guard and distracts the inner patrol; the Green Beret climbs the wall; the Sapper charges the HQ; barrels beside the warehouses for the Sniper to shoot through the fence.

#### M10 Operation Icarus
**El Agheila, Libya, 14 Nov 1942.** Map 2654×2989 (portrait).
- **Team:** Green Beret (4 barrels), Sniper (**3 rounds**), Sapper (4 grenades, 1 time bomb), Driver (SMG, first aid; a vacant **Panzer IV**, the only drivable one in the game), plus prisoner **Capt. Gregor McRae**, RAF. Start W-centre in trench ruins (0.1-0.35, 0.35-0.5) behind a wall. (Oocities' mention of a Spy is an error.)
- **Layout:** **airfield** along the N strip (y 0-0.2): the **Ju 52** (0.75, 0.06), **two Ju 87 Stukas** (0.82, 0.15), (0.95, 0.14) with barrels beside them, an airfield bunker NW (0.17, 0.12). Between base and airfield an escarpment and wire (y ≈ 0.22-0.27); the road from the base N gate winds between wire belts past **3 Gatling nests** (0.66, 0.32), (0.62, 0.46), (0.91, 0.30). **Base** (S half): a walled W compound (0.1-0.5, 0.63-0.95) with a W arch gate (0.17, 0.82), the **prisoner pen** (0.25, 0.75), a domed building and radio mast; tents (0.4-0.6, 0.67-0.70); a concrete apron E (0.6-1.0, 0.55-1.0) with a hangar, tank sheds, a tank under repair (0.63, 0.76) and a disassembled tank; the barracks in the NE corner; the **bomb store** near the S edge. Tanks: 21 and 22 parked in sheds, 23 roams the base, 24 heads to the airfield; the vacant tank SE.
- **Enemies:** 9 moving, 9 isolated, two 3-man patrols, 3 Gatlings, **4 Panzer IVs on standby**, 2 garrisons (barracks indestructible; Kildread kills reinforcements "until it's empty"). The camp and the airfield have separate alarm zones; the airfield bunker releases patrols; **boarding the tank itself sounds the alarm** (Prima).
- **Fail trigger:** Prima's summary says an alarm brings "four tanks (and a failed mission)", but Prima and Kildread both carry on after the tank-theft alarm, so failure means the tanks kill you, not a script [inferred].
- **Objectives:** rescue McRae; destroy the bomb store S of the base; optionally the Stukas (see §2.6). **Exit:** the Ju 52, present from the start; McRae must be freed and aboard, and he flies it.
- **TA:** (paraphrased) Rescue McRae, destroy the bomb store south of the base, optionally capture the one unoccupied tank and wreck Stukas; escape in the Ju 52 flown by McRae.
- **NB:** stealing a Panzer IV helps you reach the airfield; free McRae; once free he pilots the transport plane.
- **Solution:** the Green Beret knifes his way W to E; the Driver machine-guns the 3-man patrol from behind; the Green Beret climbs the wall behind the crates by the cage and frees McRae; steal the tank, destroy the store and the Stukas; board the Ju 52. A burnt-out tank blocks the way once the fire stops (eggie).

#### M11 In the Soup
**Maradah oil fields, Libya, 3 Dec 1942.** Map 2238×2190.
- **Team:** Green Beret (5 barrels), Sniper (5), Sapper (1 grenade, 3 remote bombs), Driver (first aid; a vacant SdKfz with MG, guarded by **Gatling 22**), Spy (in uniform). Start on a ridge at the middle of the W edge (0.06, 0.42); the German camp lies S of the start.
- **Layout:** SW camp with tents, the flagged barracks (0.36, 0.75) and water tower (0.37, 0.82); the oil crater (0.3-0.5, 0.63-0.75); **the 4 rigs** at (0.30, 0.52) with its tank farm, (0.79, 0.16), (0.89, 0.21), (0.94, 0.47); the enemy **Opel Blitz tanker shuttles between the two N rigs**; the **tunnel mouth** N (0.52, 0.14); the N HQ with the enemy half-track (0.76-0.84, 0.02-0.05); the central flagged garrison (0.44-0.57, 0.3-0.4) with soldiers 25-26 on its roof; the vacant half-track E; gates (0.25, 0.36) and (0.62, 0.67).
- **Enemies:** 18 moving, 10 isolated, four 3-man patrols, 1 Gatling, an SdKfz on standby, the Blitz, 3 garrisons. **Alarm:** officially the whole map but in practice local: blasts far from the central barracks didn't wake it (Prima); no siren or red light but guards still pour out (oocities); "the only bunker that was alerted was the one you destroyed" (Kildread). An alarm in the N sends the N half-track through the tunnel; **collapse the tunnel** with a charge.
- **Exit:** the SdKfz goes **W/NW** (Prima "follow the road west"; oocities "strip of dirt road to the west"; Kildread and NB "north-west"). The TA says "eastwards", which conflicts; use W/NW.
- **TA:** (paraphrased) Destroy the four drilling rigs, then head east to a waiting vehicle.
- **NB:** collapse the tunnel to block the enemy patrols; once the wells are destroyed, board the SdKfz and escape NW.
- **Solution (Prima's 5 phases):** the Spy distracts while the Green Beret clears the camp; a barrel blows the barracks; take the half-track and use the tunnel to cut off reinforcements "including the other half-track"; **shoot the fuel truck when it is beside a rig** (two rigs at once); charges or barrels finish the rest (oocities: the last two rigs can't be reached and must be blown by shooting the tanker and barrels).

#### M12 Up on the Roof
**Tunis, 15 Mar 1943.** Map 1681×1712.
- **Team (scattered):** the Spy (in uniform, first aid) in the courtyard; the Green Beret (decoy only) hiding at ground level in a building to the W; the Sniper (7 rounds) in a house on the N rooftops near Soldier 13; the **Informer** jailed off the courtyard, with a patrol E of the jail.
- **Layout:** a N band of flat roofs (0-1, 0-0.35) with ladders, stairs and balconies; a plaza (0.3-0.7, 0.2-0.4); the harbour basin (0-0.6, 0.4-0.8); the **mosque** on a S-centre platform (0.27-0.85, 0.45-0.9) with a minaret (0.31, 0.55) and dome (0.44, 0.55); the S quay street with carts and crates; the **Kübelwagen** in the SE corner (0.89, 0.94).
- **Enemies:** 19 moving, 16 isolated, two 3-man patrols, 2 garrisons.
- **Alarm state (resolved):** the TA says "The alarm is off and you are being sought". Oocities read it as the alarm having already sounded (so overview/systems say "starts with the alarm on"); Kildread's brief says "the alert is on" but also calls it "one of the only missions where the alarm is NOT supposed to ring". **Resolution (gap 8): the siren alarm is off at the start; the team is being hunted.** Model two zones [inferred]: a rooftop alarm "will sound only in the courtyard below" and its ~3 reinforcements don't compromise the mission (Prima, oocities); the **E/SE extraction area has a second HQ that must not be alarmed**.
- **Exit:** everyone including the Informer reaches the Kübelwagen in the SE, moving clockwise through the map (oocities says "just a plain old truck"; the vehicle identity is not fully settled).
- **TA:** (paraphrased) The siren is off but the team is being hunted, scattered and hidden among the buildings; guide them across the rooftops, help the informer escape and regroup everyone at the extraction point.
- **NB:** free the prisoner and escape; **silent actions on the roofs will probably not be seen by guards on the lower levels** (eggie: a body fallen on a roof "can not be seen from a lower spot"); use the Kübelwagen in the SE zone.
- **Solution (Prima's 6 phases):** reach the rooftops, clear the northern roofs, free the prisoner (the Green Beret opens the prison door), clear the SE sector, clear the mosque, get away.

#### M13 David and Goliath
**Le Havre, 15 May 1944.** Resembles Operation Source.
- **Team:** Green Beret (2 barrels), Sniper (4), Marine (Biber-style mini-sub with **2 torpedoes**, moored at a pad (0.75, 0.37) reached down 2 ladders), Sapper (1 remote bomb), Driver (truck; the fixed pier gun by the floodgate). Start at the SE rocks/jetty.
- **Objectives:** sink the "**Bismarck replica**" with a torpedo to the **forward section of the hull**, and destroy the NE fuel tanks (the Sapper's one remote charge). **Exit:** row through the S gate to the **red buoy SW**.
- **Map:** long concrete piers, cranes and crates, the battleship moored NW, and **floodgates/locks**.
- **Enemies:** 10 moving, 9 isolated, a 3-man patrol, a **patrol ship**, a **Panzer II** on standby in a garage (0.90, 0.45), 1 garrison. **Silent zone:** the right-hand dock.
- **Lock cycle:** at the southern lock a supply boat arrives and **sounds its horn**; Soldier 5 walks into the **control shack**, opens the gate and shuts it after the boat passes; the Marine can slip through behind the boat. Kill the operator (NL: the Sniper shoots him "through the glass") and work the control; the gate then "stays open for the rest of the mission". The **northern gate** control is at a shack next to Soldier 13 and opens the battleship basin.
- **Torpedo rule:** Prima parks the sub near Soldier 9's ramp "so you can still have a shot at the bow". The torpedo runs straight along the sub's heading and must hit the bow; a miss uses one torpedo, leaving one retry [inferred]. The second torpedo can sink the patrol boat.
- **Fail trigger:** the alarm that follows the attack sends the **Panzer II out of its garage** to machine-gun the sub or boat, and the mission fails. A **truck parked across the garage door** blocks it. A **patrol boat** appears near the SW buoy; the Driver sinks it with the fixed pier gun (oocities: a "big gun").

#### M14 D-Day Kick Off
**La Rivière ("Juno"), 25 May 1944.**
- **Team:** Green Beret (3 barrels), Sniper (**8 rounds**), Marine (small boat), Sapper (3 remote bombs), Driver (**Panzer II** and **5 Gatling nests** on site). Start in the boat, SW.
- **Objective:** destroy **4 coastal guns**, taken W→E; then row to the red buoy **SE**.
- **Map:** a fortified coast drawn as an island: sandy beaches, a central rocky ridge (the Green Beret climbs the central cliff), casemates and a wall.
- **Enemies:** 24 moving, 18 isolated, five 3-man patrols, 5 Gatlings, 2 garrisons: "more than fifty" (≈70+ overall per Kildread). **Alarm:** anything seen from the wall; the only safe zone is N of the start. The alarm must hold until Phase 4.
- **Solution:** Prima clears a landing in the SW, then the first three guns, and takes the tank for gun 4. Oocities rows along the map edge to the NE, lands only the Driver and crawls him to the **empty tank**, which kills almost everyone.

#### M15 The End of the Butcher
**Compiègne, 26 Aug 1944.** Map 1798×1987. **No Green Beret** (the first such mission).
- **Team:** Sniper (**4 rounds**), Marine, Driver (first aid; 2 **Citroën 15 CVs**, the Opel Blitz and a truck on site), Spy (uniform on a ladder-reached balcony/fire escape opposite the mansion, NW). Start at the S edge; cross the river or canal.
- **Objectives:** kill **SS-Gruppenführer Helmut Schleper** and destroy his HQ. **Any alarm anywhere** and he runs for a car: mission failed. Failure is his **reaching a car**, not the alarm itself [inferred]: Prima deliberately parks the fuel truck inside the gate, then sets off the alarm; the truck is shot and explodes, blocking his main exit; he walks to the **black car at the curb** and the Sniper shoots him with his 4th and last round.
- **Map:** a French town: streets, a fountain roundabout, canal parks, a tram line, the mansion HQ with a W courtyard/garden, an SdKfz roadblock; two Citroëns (one in the HQ yard, one at the curb by the roadblock).
- **Enemies:** 17 moving, 11 isolated, a 3-man and three 5-man patrols, an **SdKfz 231 patrolling**, the General. He is **unarmed and never raises the alarm himself**.
- **His schedule:** the briefing points to his "morning walk". Oocities says he **never leaves the mansion's W garden** (a bug) and paces to its **NE corner**, the Sniper's only line of sight from the roof opposite; NL and fandom say the walk does happen. Model a looping garden patrol with a pause at the corner [inferred].
- **Tricks:** park the fuel truck on the **tram track**; the tram hits it, it explodes and destroys the HQ, and it "counts as an accident, so nobody will complain" (eggie). Tainted vehicles: a car parked by the HQ is shot up by its own guards and destroys the mansion (oocities). A van driven into a patrol the Spy is distracting "can wipe them out with no alarms". The tram can be entered to hide.
- **Exit:** the truck at the **cemetery to the north**, leaving by the NW road (Kildread; gap 4 places the cemetery NE).

#### M16 Stop Wildfire
**Maas bridge north of Liège, 4 Sep 1944.** Very wide map, 4457×2135 (shared with M18).
- **Team:** Sniper (5), Marine, Spy (uniform on a clothesline to the S). **The Spy can drive the truck**, the only time; blocking the bridge with it is the intended way to stop a sapper. Start NE.
- **Objective:** kill the **4** German sappers wired to the bridge **almost simultaneously** (majority count; oocities says 3). They are unarmed and **run to their detonators** at any suspicious sign, "at the slightest alarm". No timer: once the first dies your men "have no time to move" (Prima), so the window is each survivor's run time [inferred].
  - Sappers **16 and 17** stand next to the island detonator under the bridge (0.28, 0.67): almost no window; each needs **3 pistol hits**.
  - Sapper **15** is shot "as he walks past the pillbox" at the bridge's E end; the Spy can park the truck on the bridge to block him (and he gets stuck there).
  - Sapper **14** is on the W bank; the Spy injects him.
  - Kill order is flexible (NL takes the island pair first). Prima: save, fire a pistol, and watch the order in which they detonate.
- **Map:** the river runs diagonally with a steel truss bridge, fields, roads, a railway; **trains pass, block sight when stopped (cover) and kill commandos** on the track.
- **Enemies:** 14 moving, 16 isolated, two 3-man and three 5-man patrols, 2 surveillance bunkers, 4 sappers, 3 garrisons. **Whole map silent.**
- **Exit:** escape by truck to the S; the Spy's truck can run over whole patrols. The drive-off can be skipped with Esc.

#### M17 Before Dawn
**Riveauvillé, north of Colmar, 28 Nov 1944.**
- **Team:** Green Beret (1 barrel), Marine (raft), Spy (starts in uniform), plus **Claude Gilbert with 4 followers** (move as one group, can't crawl). Start SW beside a big rock outcrop below a cliff the Green Beret climbs.
- **Objective:** free them all; "All your characters and all the prisoners must board the friendly truck" (**NW**, 0.07, 0.08). The briefing suggests letting a man be captured to get inside.
- **Map:** a river with a **lever-operated mobile bridge** sliding over the SW ravine (0.18, 0.67) (the briefing puts the lever on the N bank; Prima puts the controls in the adjacent truck; it can be slid back to cut off pursuit, and toggling it under enemies kills them); a fenced prison camp with **5 watchtowers**; an old mill; a riverside bunker (0.70, 0.41). The **back gate** opens with the control box on the wall left of the gate; once shut "no one will get in or out".
- **Enemies:** 14 moving, 11 isolated, four 3-man patrols, 1 Gatling, 1 surveillance bunker, 5 towers, 2 garrisons.
- **Oil fire:** the Spy climbs the fuel tank's ladder by the inner entrance; the cursor becomes a hand-and-lever: "Click several times, until the fuel pours onto the ground in a steady stream." A pistol shot at the puddle ignites it; the tank keeps feeding the flames and charging troops burn to death (Kildread).
- **Barrel:** placed behind the riverside bunker and shot, it destroys the bunker and draws patrol 17 and soldiers 18-21 across the river; a burning barrel kills most reinforcements.
- **Freeing:** the cell opens with the hand (Green Beret per Prima, Spy per Kildread).
- **Prima's phases:** mobile bridge, prison yard, old mill, "explosions and gunshots", over the river to the truck.
- **Glitch:** the arrest glitch (§8.8). A Marine rescued after arrest has lost his diving gear.

#### M18 The Force of Circumstance
**The same Maas bridge, 16 Dec 1944** (start of the Battle of the Bulge): now blow up the bridge saved in M16.
- **Team:** Green Beret (4 barrels), Marine (boat; raft on site), Sapper (2 grenades, 3 remote bombs on site), Driver (2 Gatlings, truck, **Panzer III** per Kildread).
- **Objective:** **3 remote charges placed from the island under the bridge**, on markers A/B/C; exit by truck S/SE.
- **Map/route:** the M16 map; the route runs **counter-clockwise**: fields SE (a barracks), the train station (a barracks), the island in the river (beachhead), the German camp, then the bridge. Trains give cover when stopped; **a grenade on the track stops trains**. No snow despite December.
- **Enemies:** 20 moving, 14 isolated, many patrols (2×2, 6×3, 1×4, 1×5), 2 Gatlings, 2 surveillance bunkers, **2 SdKfz armoured cars on patrol** (fandom: SdKfz 251s), 3 garrisons (≈80+ plus armour). Whole map silent.

#### M19 Frustrate Retaliation
**Oldenburg, west of Bremen, 12 Jan 1945.**
- **Team:** Green Beret (4 barrels), Sniper (7 rounds, first aid), Marine (boat on site), Sapper (trap, 2 remote bombs). Start on the N edge / W bank behind a rock.
- **Objective:** destroy **3 V2 rockets and their launch pads**, then row **downstream** to the boat point NE.
- **Map:** a **coal mine with a conveyor belt** (SEC type 4; a **switch reverses the conveyor**, which carries crawling men into the base) and a light truck/mine cart on rails, both ways into the base per the briefing; a **fast river you cannot row upstream** (briefing: "impossible to go back up by swimming"; Kildread claims one spot) with one bridge; the fenced base with the V2s, barracks and a watchtower. No snow despite January.
- **Enemies:** 21 moving, 13 isolated, several patrols, 3 Gatlings, a surveillance bunker and a tower, a **Panzer II on alert**, a truck driver, and **guard dogs** (the only dogs in BEL: one **caged** dog that barks, others with a patrol). **Silent zones:** around the N/left bunker and the S/right base.
- **Solution:** remote charges on the watchtower and between a V2 and the barracks; barrels by the other two rockets, shot by the Sniper through the fence (eggie: "Test blow to make sure explosion chains"). Killing the tower gunner with an explosive under the tower removes its cone (AGC FAQ).

#### M20 Operation Valhalla
**Gundelfingen Castle, north of Freiburg, 11 Feb 1945.** The "ultra secret" bonus mission (Captain rank required in some versions; US password **C7KWW**). Stolen "Fat Man" plans are headed for a German A-bomb project (fiction). Map 3486×2316 ("map 20" uses `POLYZOOM`, if the Revora numbering is by mission). Prima: "COMMANDOS' most difficult mission", "very picky about the order in which you kill".
- **Team:** all 6 in two groups hiding behind rock outcrops: **Green Beret + Spy** start **W** (the Spy **without a uniform**); **Sniper, Marine, Sapper, Driver** start **E**.
- **Loadout (no source lists it; reconstructed):** Sniper rounds undocumented (walkthroughs spend 1 or 3; use 5 [inferred]); Sapper ≥2 grenades and 1 (Prima: "his remote-control explosive" at the HQ door) or 2 (oocities: one on the gun, one on the castle) remote bombs, trap likely; Driver as medic [inferred]; Green Beret decoy; Marine speargun and diving gear; **Panzer III** on site. The uniform is on a **clothesline in the castle's W quarter, just left of the SW gate**.
- **Objectives:** blow up the castle HQ and **2 V2 rockets** (Prima, German FAQ). Fandom's "destroy the nuclear programme" is superseded; its own briefing text says "raze".
- **Map [est.]:** an octagonal walled castle filling the map; château HQ NW (0.10, 0.15); V2s at (0.60, 0.30) and (0.60, 0.40); the tank near the N stairs (0.52, 0.20), covered by a **fixed gun** the Driver cannot use (Prima "anti-tank gun", German FAQ "mortar", NL "heavy cannon"; its gunner can't be knifed, so the Sniper shoots him); **firing range** (0.75, 0.55); barracks (0.35, 0.60) and (0.52, 0.70); a moat along the S and E walls; **two gates with bridges** SW (0.35, 0.77) and SE (0.76, 0.74), **four guards at each gate**; Flakvierling AA guns by the HQ; multiple courtyards. The Green Beret's **only climbable spot** is the W wall below the HQ.
- **Enemies:** no official count; Prima numbers up to **57** (patrol 26 = 4 men) plus un-numbered ones, "more than a hundred eyes". Alarm effectively covers the whole castle [inferred]; kill order matters; the **2 guards at the S corner must be left alive**.
- **Firing range:** pistol shots there don't raise the alarm, but guards investigate, and the alarm sounds if a German fires at you. A **lever in the firing range**, marked by a **flashing red light**, opens the **E-wall water gate**; the Marine swims from the moat into the range's pool.
- **Ending (loud):** the Driver takes the tank, the HQ charge is blown, the V2s are shelled, and the tank flattens buildings and troops and drives **out the SW gate** (Prima, fandom; German FAQ "western gate").
- **Briefing:** "Officer, this is your most important mission ever. Unfortunately, I can't give you any details… gain access to the fortress and raze it to the ground… If you fail. May God protect us." The Colonel calls the player "son" in this mission.

---

## 11. Beyond the Call of Duty (1999)

### 11.1 Overview

- **Release:** 31 March 1999 (NA), 1 April 1999 (EU). Standalone; its demo was called "Commandos Mission Pack". Steam app 6810; part of the GOG Ammo Pack.
- **8 missions**, no bonus mission (`MISIONES.DAT` lists 8). Supports higher resolutions and "improved graphics (noticeable when zooming)". Adds a **game-speed slider**.
- **Reception:** GameRankings 79 %; GameSpot 6.6 (Kasavin criticized clumsy missions and hotkeys changed from the original that could not be rebound). More than 350,000 sold by late 2000.
- **Voices:** different voice actors; a Steam user asks for "the great commandos voices from the previous game".
- Varkovsky's FAQ uses the US nicknames throughout: Tiny, Duke, Fins, Inferno, Tread, Spooky.
- **The official demo** is an early build of M5 (`MAPA0001.MIS` Hard and `MAPF0001.MIS` Easy); its strings add only STONE, RIFLE, HAND-CUFFS and CIGARETTES (no KO, hanger or puppet), so retail values may differ.

### 11.2 New mechanics

**Knock-outs (X)** [BCD manual]
- Green Beret **Fist**, Driver **Blackjack** (the "club"), Spy **Chloroform** (CommandosHQ: "Ether"). Engine token `AuCachiporra` appears on GB, Driver and Spy.
- Only on an **unaware** target; on a soldier who is aware ("in the eyes") it has "no effect whatsoever". Unlimited uses.
- Lasts "a limited amount of time"; left alone, the guard "will eventually wake up and **sound the alarm**". No number is published (pick 20-40 s [inferred]).
- Patrol members (MP40s) **cannot be knocked out** (Ruetli).

**Handcuffs (J)**
- **Only the Green Beret and the Spy** carry them (manual, files, CommandosHQ, GamePro, ES Wikipedia). Varkovsky's "everyone have it" and EN Wikipedia's "all able to handcuff" are wrong. The Driver needs the GB or Spy to cuff a man he has clubbed.
- Unlimited [inferred: `AuEsposas` has no count field; counted items show e.g. "GRENADES: %d"].
- **Only unconscious soldiers** can be cuffed. A cuffed man stays out of the game "until seen by their comrades, who will free them and sound the alarm". Cuffing also takes his cigarette pack automatically.

**Puppet (R)** (`AutomarControlAleman`)
- Any commando: press R then click a **cuffed** soldier. A **blue area/circle** shows your line of sight.
- Control lasts while he is in your line of sight **and you are in no other enemy's line of sight** (GameSpot: "within range of the commando's sidearm"). If he leaves your sight he raises the alarm; if you are shot at he runs off and raises the alarm. He inside a house still counts as in sight; you inside a house alone count as out of sight.
- Uses: open doors and work machines; drive an empty vehicle (the Driver boards too; undetected "unless it acts suspiciously"); distract others (D): a private distracts privates only; a sergeant distracts sergeants, privates and **patrols**; an officer distracts anyone.

**Stones (Y)** and **cigarette packs (V)**
- Stones: every commando and Skopje, not Natasha. Files give 50-100 each (`.PIEDRAS`), effectively unlimited; no count shown. A stone thrown near or at a soldier makes him **look that way**; "If you throw several stones, the soldier may go and investigate" (Varkovsky: "after a few throws, he will come to investigate").
- Cigarette packs: every commando and both allies. Obtained automatically when cuffing, from dead or unconscious bodies (cursor = hand holding a pack; `AuCogeTabacoDeMuerto`), or off the ground with H. Almost every soldier has `TENGOTABACO 1`. A thrown pack works only inside a soldier's **short-range (light-green) cone**: he walks over and picks it up, your chance to knock him out or slip past. Fandom's "soldiers with cigarettes ignore packs" is C2.
- No attention radius is published for either.

**Spy changes**
- **Hanger (T)** (`AuQuitaUniforme`): on a **knocked-out** soldier, takes his uniform (the zookeeper tip works without cuffs). Clotheslines still give uniforms. The Spy can hold several; **U** cycles and re-dresses.
- Anything irregular in sight (killing) strips the disguise.
- **Who recognizes which uniform:**

| Uniform | Recognized by |
|---|---|
| Private | Sergeants (patrol sergeants too), officers, Gestapo |
| Sergeant | Officers, Gestapo |
| Officer | Gestapo only |
| Zookeeper (M2) | passes even patrol sergeants |

- **Gestapo** wear **black**, "always" recognize the Spy and **Natasha**, and are "crack shots" (Gamecenter). **Distract** works on every rank except the Gestapo.
- Files also give the Spy `AuInsignia .USOS 8` (unexplained), `AuQuieto`, `AcSerEspia .DISFRAZ ESPIAA`, `.EMPIEZADISFRAZADO 0`, a lethal syringe with `.DOSIS 5`, and an unexplained `MUNMETRA 50`. ES Wikipedia's "Kar98k with a stolen uniform" is unverified.

**Natasha "Lips" (van de Zand)** and **Maj. Dragiša Skopje**
- Natasha (token `CHICA`, Dutch Resistance courier, the "Seductress"): M8 only; becomes playable when Fins enters her building. **Lipstick (D)** distraction from her handbag works on **any rank**: the soldier stares until you right-click, and **his cone follows her as she moves**. Kit: Beretta 1935 pistol (Q), cigarette pack (V); no stones, KO or cuffs. If the Gestapo see her, her cover is blown. Not the same person as C2's sniper Natasha Nikochevski.
- Skopje (token `FUSILADO`; "Major" in English, "Oberst" in Ruetli): M2; stones and cigarettes; any alarm gets him shot.
- Selection keys: 7 = Skopje, 8 = Lips.

**Wild animals** (M2, Belgrade zoo): three **lions** in the den, dangerous inside the pit (Varkovsky kills them with the Spy's lethal injection before the GB climbs in); four **ostriches**, "killers when provoked" (CGSP), attacking "if they feel in danger" (fandom). No stats published; model them as ignoring disguises, attacking within a short radius, and not raising the German alarm [inferred]. The unarmed **zookeeper** can walk among the lions; if he spots you he alerts the soldiers and flees into the barracks.

**The Driver's Lee-Enfield (E)** (`ESCOPETA`): "kills with a **single shot**, has a **longer range** and **unlimited ammo**, but is **slow to reload** and makes **lots of noise**" (manual; Varkovsky: "as noisy as the regular pistol"). Files set `.MUNESCOPETA 50` (the manual's "unlimited" conflicts). Range unpublished (between pistol and sniper [inferred]). The SMG moves to **W** (`.MUNMETRA 100`).

**Other BCD file abilities:** `AuEmpujar` (push wagons/fuel tanks), `AuCogeMisil` (carry the guidance module), `AuCamuflarse` (bury), `AuAlicate` (wire cutters), `AcEscoltado` (escorted prisoner), `AcPatrulla` on captive commandos (they walk yard routes at VEL 1.7), `AcChicaHolanda` and a dedicated distract ability for Natasha.

**Non-lethal play** is possible (a pacifist run).

### 11.3 Difficulty (Easy / Hard)

- Chosen on the Skill screen after *New Game → Single Player*: "Easy — for Rookies" and "Difficult — for Veterans". The manual does not explain the difference. Scoring is unchanged (time and wounds).
- Claims: fandom says Hard adds soldiers and "more machine-gun guards"; Electric Playground says fewer soldiers on Easy.
- **Demo data diff (M5, `MAPA0001` Hard vs `MAPF0001` Easy, F = *Fácil* [inferred]):** Hard adds one patrolling guard and turns one sentry into a patroller (65 vs 64 soldiers). Easy slows many routes from `.VEL 2.0` to 1.6-1.7 (twelve routes at 1.6 on Easy vs one on Hard) and lengthens pauses (e.g. `ESPERA 40→100`, `20→55`). Some routes switch PINGPONG ↔ LOOP; three sentries get a 40° sweep; a few are re-aimed. Unchanged: the 12 patrols (9×2 + 3×3; MG soldiers with a pistol sergeant), barracks and weapons. **The scripts have no fields for cone length, damage or accuracy.**
- **Retail files:** guards are tagged `NIVEL TODOS` (both), `FACIL` (Easy only) or `DIFICIL` (Hard only); Hard adds `DIFICIL` guards and removes some `FACIL` ones. Par times differ by difficulty.
- **[rec]** Make difficulty a per-mission data variant: more guards, more patrollers, faster walks and shorter pauses on Hard; keep cones and damage identical.

### 11.4 Scoring, ranks and passwords (compared with BEL)

- **Unchanged:** score = time + wounds, kills irrelevant; 0-3 silver per category; the same gold conversion; a promotion every 6 gold; the debrief shows losses, rank, merit and the next-mission password; the 11 rank names in `GLOBAL.STR` are the same.
- **Different:** par times depend on difficulty (BEL has one `PAR_TICKS`); maximum 8 × 3 = **24 gold**. Ruetli says you **start as Major** and climb Colonel → Brigadier → General → **Field Marshal at 24 stars**; the manual says you "begin … Sergeant". Only a Major start reaches Field Marshal with 24 stars [inferred]. A password **replays a single mission and "can't be used to follow a continuous career"** (manual).
- **Losing any commando fails the mission** (string `IAMU`).

### 11.5 Mission files and summary

`MISIONES.DAT` campaign order: M1 = `MAPA0000`, M2 = `MAPA0005`, M3 = `MAPA0006`, M4 = `MAPA0002`, M5 = `MAPA0001`, M6 = `MAPA0003`, M7 = `MAPA0004`, M8 = `MAPA0007`. Source: research-raw/gap-6.md.

In every BCD mission: every commando has a pistol, 50-100 stones and can take cigarettes; only GB and Spy have handcuffs; the GB always has knife, decoy, fist KO, carrying and wall-climbing; the Driver is medic, else the Sniper. "Soldiers" counts individually placed guards (Easy/Hard, including MG crews), not patrol members. Patrol sizes are `NSOLDIERS` probably plus an NCO; all patrols are MP40 troopers with a pistol NCO. Reaction patrols leave flagged barracks on a zone event and regenerate until the barracks is emptied or destroyed.

**Par times.** Converted in gap 6 at 25 ticks/s (1,500 ticks = 1 min) [inferred for BCD]; at BEL's 20 Hz design rate the same ticks are 25 % longer. Both shown.

| # | Name | File | Par ticks E / H | At 25 Hz | At 20 Hz |
|---|---|---|---|---|---|
| 1 | Dying Light | MAPA0000 | 16932 / 17290 | 11:17 / 11:32 | 14:07 / 14:24 |
| 2 | The Asphalt Jungle | MAPA0005 | 35856 / 30191 | 23:54 / 20:08 | 29:53 / 25:10 |
| 3 | Dropped Out of the Sky | MAPA0006 | 62250 / 55860 | 41:30 / 37:14 | 51:52 / 46:33 |
| 4 | Thor's Hammer | MAPA0002 | 87150 / 72884 | 58:06 / 48:35 | 72:38 / 60:44 |
| 5 | Guess Who's Coming Tonight | MAPA0001 | 62250 / 49875 | 41:30 / 33:15 | 51:52 / 41:34 |
| 6 | Eagle's Nest | MAPA0003 | 73870 / 59185 | 49:15 / 39:27 | 61:34 / 49:19 |
| 7 | The Great Escape | MAPA0004 | 57768 / 42826 | 38:31 / 28:33 | 48:08 / 35:41 |
| 8 | Dangerous Friendships | MAPA0007 | 59760 / 53200 | 39:50 / 35:28 | 49:48 / 44:20 |

(M1's Easy par is lower than its Hard par in the file.)

| # | Place, date | Team (file) | Soldiers E/H | Patrols (roaming + reaction) | Objectives | Exit (vehicle token, point) |
|---|---|---|---|---|---|---|
| 1 | Guernsey, Channel Islands, 14 Jul 1940 | GB, Sn, Sa, Ma | 23/27 incl. 3 MG nests | 1 (1 man) + 4 (2-3) from 3 barracks | Radar (`CASA04`), lighthouse (`FARO01`), **5 AA guns** (`ANTI01-05`) | Dinghy `ZODIAC5` to the SW buoy |
| 2 | Belgrade zoo, 23 Apr 1941 | GB, Dr, Sp + Skopje | 30/31, 1 MG | 3×2 + 5 (2-3) | Rescue Maj. Dragiša Skopje | Van `FURGO_HUIDA`, NW road |
| 3 | Crete, 10 Jun 1942 | GB, Sn, Dr | 32/37, 1 MG | 2×2 + 4×2 | GB carries the Hs 293 guidance module (`CABEZABOMBA`) to the lorry | Lorry `CAMION_HUIDA`, NW edge ("road to the west") |
| 4 | Bonn station, 11 Sep 1943 | GB, Sn, Sa | 66/69, 2 MG | 6×2 + 9 (2-3) from ~5 barracks | Rail gun "Karl" (`EXPL_KARL`, 2 charges) and 2 armoured wagons (`EXPL_HUMBERTO01/02`, bombs + barrels) | Locomotive `TREN_HUIDA` on track 1, NE/east |
| 5 | Rastenburg (Wolf's Lair), 15 Jul 1944 | GB, Sn, Dr, Sp (Spy jailed) | 68/69, 4 MG | 5 (2-3) + 7 (2-3) incl. a 3-man guard for the colonel | Free the Spy; kidnap SS Col. Wilhelm von Below into the armoured vehicle | Panzer II `PANZER2`, SE corner |
| 6 | Neubrandenburg airfield, 12 Nov 1944 | GB, Sn, Sa | 37/43, 1 MG | 2 (2-3) + 5 (2-3) from 3 barracks | **5 prototypes** (`AVIO4-8`; 3 other planes optional); kidnap the pilot | Jet `AVION_HUIDA` from the centre, flies off NW |
| 7 | Nuremberg POW camp "Stalag 13", 20 Nov 1944 | Ma, Sa free; GB, Dr prisoners | 40/43 incl. 4 escorts, 1 MG | 1×4 + 3 (3-4) | Free GB and Dr; recover knapsacks; blow the officers' barracks (`CASA_SALE_REVISTA`); prisoners flee N | Lorry `CAMION_HUIDA`, east edge |
| 8 | Nijmegen, 18 Dec 1944 | GB, Sn, Ma + Natasha | 50/55 incl. 5 Gestapo, 1 MG | 2×2 + 4×3 | Scuba gear; meet Natasha; documents from Gen. Rauter | Launch `LANCHA_HUIDA` from the W dock, east |

### 11.6 BCD mission details

Each entry: the historical introduction (summarized), the spoken briefing, scrapbook and objectives (verbatim from Varkovsky's FAQ, same text on fandom), and file/guide data.

#### BCD 1 Dying Light
- **Header:** July 14, 1940; Guernsey, England; personnel "Tiny, Duke, Inferno" (Varkovsky's header omits the Marine; the file and his walkthrough include him).
- **Introduction:** summer 1940, the Allies expelled from the Continent, the Luftwaffe preparing the invasion of England. Destroy the installations on Guernsey that German HQ is counting on to guide the invasion force and "make the Channel an unbreachable barrier".
- **Briefing:** (paraphrased) Destroy the island's radar station, lighthouse and AA batteries, then reach the pickup buoy (the lift to the beach helps); the water is mined.
- **Scrapbook:** destroy the radar antenna, the lighthouse and the anti-aircraft batteries with the bombs and the barrels of explosives; the lift can make it easier to escape; flee to the southwest buoy.
- **Objectives:** destroy the radar antenna; destroy the lighthouse; destroy the anti-aircraft batteries; escape to the southwest buoy.
- **Data:** all start **in the dinghy at the NE corner**. Sniper 6 rounds and first aid **5 uses**; Sapper **4 remote bombs**, bear trap, no grenades; Marine harpoon, knife, dinghy. On map: 3 barrels, the **lift** (`ASCENSOR`) down to the beach, **22 sea mines** (`MINASUB`), 3 barracks, 4 ladders. Zone `CAMPAMENTO` → event `REAC`. Rocky island with a white lighthouse and fort buildings. **Alarm:** no failure; barracks pour out; blowing them up stops it (Varkovsky).

#### BCD 2 The Asphalt Jungle
- **Header:** April 23, 1941; Belgrade, Yugoslavia; Tiny, Tread, Spooky.
- **Introduction:** Belgrade has surrendered after a week of bombing; the Wehrmacht heads for Greece; Dragiša Skopje, a Balkan army commander, is due to be shot within hours; rescue him alive for his information.
- **Briefing:** (paraphrased) Infiltrate the zoo, free Major Skopje alive before the firing squad acts, steal the small lorry and leave by the north-west road; some surviving animals are dangerous.
- **Scrapbook:** make sure the alarm does not go off since otherwise the prisoner will be shot; place the prisoner inside the small lorry and escape down northwest road; be careful with the animals.
- **Objectives:** rescue Major Dragiša Skopje; escape down the northwest road.
- **Data:** GB, Driver, Spy start mid-east; Skopje held **NE**. Driver: SMG 100, Lee-Enfield 50, first aid. Spy: lethal syringe 5, chloroform, cuffs, hanger. Skopje: stones only. Escape van; the zookeeper's uniform (steal with the hanger). Specials: a **firing squad** (2 riflemen and a corporal), the zookeeper, **3 lions**, **4 ostriches** (ostrich gate `PUERTAAVESTRUCES`). Zones: `ZONA_FOSO` (pit) → `ZOFO`, `ZONA_NO` (north) → `ZONO`, `ZONA_INICIO` (start) → `ZOIN`, `ZONA_JARDIN` (garden) → `ZOJA`. **The firing squad reacts to alarms in the garden, north and pit zones and shoots Skopje (mission failed)**; it is not linked to the start zone [inferred]. Zoo with circular pits, cages and a villa.

#### BCD 3 Dropped Out of the Sky
- **Header:** June 10, 1942; Crete, Greece; Tiny, Duke, Tread.
- **Introduction:** the German advance halts at Tobruk; an Hs 293 bomb has fallen on Crete without exploding; recover its navigation system so Allied technology can catch up.
- **Briefing:** (paraphrased) Get past heavy security, recover the HS 293 guidance system, load it on the lorry and escape west.
- **Scrapbook:** use the Green Beret to capture the navigation system of the HS 293 bomb; place it in the lorry and escape down the road to the west.
- **Objectives:** steal the HS 293 bomb's navigation system; escape down the road to the west.
- **Data:** GB, Sniper, Driver start **inside a building, NE** (Ruetli: the church). Sniper 7; Driver SMG 100, rifle 50, first aid. Module south; lorry north; exit the NW map edge. **1 German shepherd** barks an alarm and can kill. Zones `ZONA_ABAJO` (lower) → `ZOAB`, `ZONA_INICIO` → `ZOIN`, `ZONA_ARRIBA` (upper) → `ZOAR`. **Alarm:** no failure; driving off in the lorry sets off a harmless alarm (Ruetli). River gorge with a bridge, a white-church village with a cart, classical ruins, lower and upper camps.

#### BCD 4 Thor's Hammer
- **Header:** September 11, 1943; Bonn, Germany; Tiny, Duke, Inferno.
- **Introduction:** the Allies are stuck in Italy (Kesselring); destroy a large-calibre rail-mounted cannon stopped at Bonn station on its way to Italy.
- **Briefing:** (paraphrased) Destroy the rail gun with two charges and the armoured carriages on the siding (boost the blast with barrels), then escape east on the first-track locomotive; carriages can be pushed for cover.
- **Scrapbook:** you can push the carriages in order to hide behind them; to blow up the armor carriages place several barrels of explosives together with the bombs; place two bundles of explosives to blow up the rail gun; to escape use the locomotive stopped on the first track.
- **Objectives:** destroy the rail gun; destroy the armored train; use the locomotive to escape.
- **Data:** GB, Sniper, Sapper start SW. Sniper 5, first aid 5; Sapper **4 bombs, 2 grenades**, trap (Ruetli uses 3 charges, fandom 4). 3 barrels; **2 pushable wagons** (`VAGEMPUJ`) as moving cover; the escape locomotive (NE); 2 locomotive crew. The biggest garrison: 6 zones (`ZONA_BLINDADO` → `BLBL`, `ZONA_INICIO` → `INIC`, `ZONA_NORTE` → `NORT`, `ZONA_APARCAMIENTO` → `APAR`, `ZONA_ESTACION` → `ESTA`, `ZONA_ANDENES` → `ANDE`), 5 barracks. No failure on alarm. Big rail yard with a station hall and roundhouse. The file calls the gun `KARL`; an earlier report called it the "Thor" mortar.
- A BCD walkthrough detonates three remote bombs one after another.

#### BCD 5 Guess Who's Coming Tonight (the demo mission)
- **Header:** July 15, 1944; Rastenburg, Prussia; Tiny, Duke, Tread, Spooky.
- **Introduction:** the 20 July plot against Hitler is threatened: SS Colonel Wilhelm von Below, security chief of the Wolfsschanze, suspects the conspiracy; kidnap him before he unmasks its leaders.
- **Briefing:** (paraphrased) Enter the walled compound, capture Colonel von Below, put him in an armoured vehicle and escape east; also free a captured teammate; the enemy is on full alert and the colonel flees (mission over) at any sign of danger.
- **Scrapbook:** get into the enclosure by climbing to the platform on the east door; there is an ammunition box in the enclosure; free the Spy that is in prison at the northern part of the complex; capture the Colonel and take him into the tank; escape through the south-east road.
- **Objectives:** free the Spy; kidnap Colonel von Below; escape through the southeast road.
- **Data:** GB and Sniper start SW; the **Driver starts separately** (south-centre); the **Spy is jailed in the north**. Sniper 5 + an ammo box of **+4** (`CAJABALA`, west-centre); Driver SMG 100, rifle 50, first aid; Spy syringe 5. A general's/officer's uniform on the château roof (NE, z = 174); the Panzer II (east); the colonel's Kübelwagen. Zones `ZONA_EXTERIOR` → `REXT`, `ZONA_TANQUE` → `RETA`, `ZONA_INTERIOR` → `REIN`, `ZONA_TEJADOS` (roofs) → `RETE`. **The car reacts to the interior and rooftop zones: the colonel drives off in the Kübelwagen and the mission fails.** If the car is blocked or destroyed he flees **on foot to the east edge** and can still be caught (Ruetli, fandom). The colonel carries a Luger. Forest, château, bunkers.

#### BCD 6 Eagle's Nest
- **Header:** November 12, 1944; "Neubranderburg" (sic), Germany; Tiny, Duke, Inferno.
- **Introduction:** German technicians are finishing a new generation of jet fighters; destroy the prototypes at the airfield.
- **Briefing:** (paraphrased) Destroy the German prototypes (fuel tanks next to them help), optionally the other aircraft, and escape in the plane at the runway centre with a captured pilot.
- **Scrapbook:** if you walk along the path, your footprints may give you away; push the fuel dumps towards the prototypes to enable you to destroy them; you must kidnap the enemy pilot to escape.
- **Objectives:** destroy the prototypes; kidnap the enemy pilot to escape; escape by using the jet plane in the airfield.
- **Data:** GB, Sniper, Sapper start in the SW corner on low ground. Sniper 6, first aid 5; Sapper **4 bombs, 4 grenades**, trap, wire cutters. **4 pushable fuel tanks** (`DEPOSEMP`); 5 barrels; the escape jet in the centre; 4 chickens (`GALLINA`); a pilot (pistol). Zones `ZONA_INICIO` → `ZOIN`, `ZONA_PISTAS` (runways) → `ZOPS`, `ZONA_PILOTO` → `ZOPI`. **Noise in the pilot zone sends the pilot into his quarters and brings out a 3-man patrol**; fandom: any alarm makes the pilot fly off in the escape plane (failure). Farmhouse and village S.
- **Planes (disagreement):** the file has 5 prototypes, 3 ordinary planes and the escape jet, unnamed. Ruetli: 4× Me 262 and an Me 163. Fandom: 2× Me 262, Me 163, Do 17, 2× Bf 109, escape jet He 162. Ruetli mentions a Spy; the file has none.

#### BCD 7 The Great Escape
- **Header:** November 20, 1944; Nuremberg, Germany; Tiny, Fins, Inferno, Tread.
- **Introduction:** several of your men were captured and are held in the Stalag 13 POW camp; bring them home.
- **Briefing:** (paraphrased) Free the captured men from the POW camp, recover their knapsacks, blow up the officers' barrack to trigger a northward prisoner breakout, then steal a lorry and escape east; an informer hides among the prisoners.
- **Scrapbook:** recover the knapsacks with your equipment; get rid of the guards to allow the prisoner to escape; be careful with the snitch; escape with the lorry down the southeast road.
- **Objectives:** free the Green Beret and the Driver; recover their knapsacks; help the prisoners to escape; escape down the southeast road.
- **Data:** Marine and Sapper start SW; the GB (east) and Driver (north) are **prisoners walking yard routes** (VEL 1.7 loops). Sapper **1 bomb, 4 grenades**, trap, cutters; Driver SMG 50, first aid 5, rifle listed without ammo. **Knapsacks** (`MOCHILA_COMANDO`, `MOCHILA_CONDUCTOR`) NW: picking one up restores that man's kit [inferred]. **9 POWs** plus a **snitch** whose position differs between Easy and Hard. Named gates `PUERTA_NORTE1/2`, `PUERTA_SUR1/2`, `PUERTA_ESTE1/2`. Zones `ZONA_SUR` → `ZOSU`, `ZONA_INTERIOR` → `ZOIN`, `ZONA_NORTE` → `ZONO`, `ZONA_INICIO` → `ZOCI`. **An alarm in the interior zone makes the escorts march the GB and Driver into the punishment cells.** The snitch reports anything suspicious. **Tower guards ignore bodies but raise the alarm if they see a commando** (Ruetli). Fenced hut camp with towers; river S. Exit "east" in the briefing, "south-east" in the scrapbook.

#### BCD 8 Dangerous Friendships
- **Header:** December 18, 1944; Nijmegen, Holland; Tiny, Duke, Fins.
- **Introduction:** the Ardennes offensive has surprised the Allies; General "Hanz" Rauter (historically Hanns Rauter), on a stopover in Nijmegen, holds the plans for the offensive's last stage; with the Dutch Resistance, get the documents.
- **Briefing:** (paraphrased) Obtain documents from the German officer with the help of Natasha (Dutch Resistance courier), reachable via the drawbridge; escape east by boat; new diving gear may be nearby; Gestapo guards can recognise the courier.
- **Scrapbook:** get in touch with the contact by entering her building; take her to the club and wait for the general to walk in; the Gestapo officers may be able to identify the contact; steal the documents; to escape, steal the boat located at the western dock and head east.
- **Objectives:** retrieve the scuba gear for the Diver; make contact with Natasha; get the documents from General Hanz Rauter with Natasha's help; steal the boat at the western dock to escape.
- **Data:** GB, Sniper, Marine start SE; Natasha waits inside her house (SE). Sniper 5, first aid 5; Marine dinghy. **Scuba gear** (`SCUBA`) east; drawbridge (`PUENTE`) and its switch (`INTERRUPTOR`) west; a water mill (`MOLINO_AGUA`); a patrolling **tugboat** and its captain; the escape launch at the W dock **drives itself east under fire** (Ruetli). **5 Gestapo** (3 static, 2 walking) recognize Natasha and the Spy. **Rauter follows Natasha into one of two meeting houses and comes out without the papers (300 ticks).** Zones `ZONA_INICIO` → `ZOIN`, `ZONA_PUN` → `ZOPU`. Canal city.

### 11.7 BCD disagreements

- M1 team: header omits the Marine; the file includes him.
- M4 charges: Ruetli 3, fandom 4, file 4 bombs + 2 grenades.
- M6 planes and roster: see above.
- Handcuffs: GB and Spy only (not everyone).
- Lee-Enfield ammo: unlimited (manual) vs 50 (file).
- Exits in M5 and M7: "east" (briefing) vs "south-east" (scrapbook).
- Skopje's rank: Major (English) vs Oberst (Ruetli).
- Starting rank: Major (Ruetli) vs Sergeant (manual).
- Tick rate for par times: 25 Hz (gap 6) vs 20 Hz (BEL design base).

---

## 12. Visuals and art

### 12.1 Rendering technology

- A **2.5D bitmap engine**: each mission is one very large pre-rendered picture cut into tiles and sprites, with invisible logic polygons on top (VOL for drawing and occlusion, SEC for navigation and sight; §14). Buildings, trees and rocks are separate sprites with footprints and heights, so units can be drawn behind them.
- **Colour:** 8-bit indexed bitmaps in WAD archives; each WAD holds several 256-entry palettes of 16-bit (RGB565) colours plus 13 unknown bytes. The screen is 16-bit high colour. RLE sprites have transparent runs (`FF`) and **semi-transparent runs (`FE`, 50 % blends)**, used for shadows, glass, smoke edges [inferred] and the cone overlay. Enemy troops have a palette-swap parameter `.ANIMPAL`.
- **Frame rate:** designed for about 15-20 fps (about 16); animation cadence was authored for that rate.

### 12.2 Projection and world scale

- **Fixed orthographic 3/4 view, no rotation.** Screen x = map x; screen y = map y × sin 40° (0.643); vertical heights shrink by cos 40° (0.766). Reviews call it "isometric", but it is a **40°-elevation oblique view**, not true isometric (35.26°) or 2:1 pixel art.
- **Measurement check:** on the full-resolution M2 map the strongest lines (palisade, railway) run at 32.5° and 147.5°. For a building grid rotated 45° viewed from elevation φ, walls project at atan(sin φ); 32.5° gives φ = 39.6°, matching 40°. General check for perpendicular walls: |tan a₁ · tan a₂| = sin²φ. Buildings are placed freely, not on tiles (the tutorial's long stone wall runs at about 42°).
- **The camera has yaw 0 relative to the map data**; buildings only look rotated because they are drawn that way (Modding Wiki SEC page and the M1 coordinate check). So a remake keeps mission data in BEL units and converts x = X·k, z = Y·k; visuals.md's yaw-45° camera would force rotating every coordinate and is only suitable for new axis-aligned art.
- **Scale (decided: 0.045 m per unit).** Vehicle collision footprints: Opel Blitz 160×60 units (6.0×2.3 m → 3.8 cm/unit), Panzer II 105×60 (4.8 m → 4.6), Panzer III 126×74 (5.6 m → 4.4), Kübelwagen 80×30 (3.74 m → 4.7), Horch 110×60 (4.4 m → 4.0), Willys 95×50 (3.36 m → 3.5). Characters are drawn at roughly **75 % of vehicle scale**: a ~24 px sprite is about 31 units, while the collision cylinder is H 40 (commandos) / H 29 (enemies). visuals.md's 5.7 cm/px (from sprite heights) overstates map size by about 27 %; remakes.md's "80×100 m" map estimate is wrong.
- **Map images:** image x px ≈ map units; image y px ÷ sin 40° = map units (M1's file has x 75-1419 and y up to 3506; image 1445×2444 → 1445×3802 units ≈ 65×171 m; M4 ≈ 199×171 m).
- On screen at normal zoom a soldier sprite is about **22-28 px** tall; a truck 100-130 px long; a 640×480 play area (about 560×435 px) shows roughly 25-39 m of ground depending on the scale used.

### 12.3 Art style and production

- **Pre-rendered 3D plus photo textures, then retouched** [inferred, strong]: the exact consistent 40° projection, VOL polygons with real 3D heights, a low-poly CGI render of the M1 relay station in the briefing, and Blanco's account of photographing real building surfaces ("even walking down the street you'd see textures on buildings and want to photograph them"). The 3D software is unknown.
- **Diorama realism:** Gonzo's lead-soldier diorama; Vandal: maps "almost look like scale models" (*casi parecen maquetas*); GameSpot: "prerendered 2D maps all look different, beautiful, and realistic".
- **Surfaces** [measured]: noisy photo-textured dark green grass with tiny white flowers; photo-textured rocks lit from the upper left; flat near-white snow (#dfdfde) with soft blue-grey shading; dark asphalt roads with muddy, grassy verges.
- **Sprites:** small pre-rendered units and vehicles with the same lighting. German soldiers wear grey (long greatcoats in Norway) or desert uniforms, judged "rather boring" next to the charismatic commandos (GameSpot). Vehicles are richly detailed (canvas tarps, a Balkenkreuz on the truck door), "lovingly created sprites for armoured cars, tanks and even railway artillery guns" (gamesof1998). Commandos are distinguished mainly by uniform colour, silhouette and portrait.
- **Late FX:** water particles and electric-fence sparks added behind the project manager's back.

### 12.4 Theaters, palettes and light

Overall: low saturation (HSV S ≈ 0.10-0.40), mid-dark values (V ≈ 0.2-0.5); saturated colour reserved for effects, flags and the UI red.

| Theater (missions) | Ground and landscape | Water | Buildings and props | Dominant colours [measured] |
|---|---|---|---|---|
| Norway (M1-M7) | Olive-khaki grass (hue 50-80°) with patchy snow; M2 and the heavy-snow maps mostly snow; granite outcrops, conifers and round deciduous trees, asphalt roads, muddy tracks | Deep teal fjord/sea **#103f3a** (M1, M3, M4); brighter cyan river **#107083** (M2); rocky rims | Timber and log cabins with snow-laden roofs, half-timbered huts, Nissen huts, barbed-wire palisades, wooden watchtowers, fuel tanks with ladders, piers, the concrete arch dam and sluices (M3), railway gun (M6), U-boat pens (M7), cable car (M5) | Grass #4c4d27-#5c5933; dirt #7d7352; snow #dfdfde |
| North Africa (M8-M12) | Warm sand and ochre (hue 35-39°), bleached highlights, grey concrete aprons | Rare | Airfields with Ju 52 and Stuka sprites, tents, sandbags, oil drums, drilling rigs (M11), flat-roofed white and ochre adobe town (M12 Tunis) | Sand #967e5d / #9f8866; concrete #8a7b67 |
| France / Normandy (M13-M15) | Spring and summer greens, grey harbour concrete | Grey-teal harbour | Le Havre quays and the battleship replica, coastal casemates, dark cobbled town and cemetery | Harbour #13403d; concrete #3e5251 |
| Belgium / Alsace / Germany (M16-M20) | Frosty late-war ground (no snow in M18/M19), muddy industrial ground (V2 pads), dark forest | River at the Liège bridge | Station and bridge, V2 gantries, the gothic castle with dark slate roofs (M20) | Mud #4b4428; forest #343b29 |

- **Time of day:** every screenshot examined is daylight with neutral-to-overcast light; no night missions and no falling weather. Briefings mention dawn (M9 "By dawn", M17 "Before Dawn") but the maps are painted in daylight.
- **Lighting and shadows:** baked into the bitmap; key light from the **upper left of the screen**; soft short shadows falling down and to the right; darker soft pools under trees; no dynamic lighting except explosion flashes [inferred].

### 12.5 Buildings, water and destruction

- **No interiors** (verified in the manual): hide in certain buildings via the door; cannot hide bodies or shoot from them; leave by clicking the portrait. EN Wikipedia's *Commandos 2* article lists explorable interiors, firing from windows and underwater areas as new in C2.
- **Barracks are marked by a waving enemy flag** (red with a white disc and swastika in the international release; Balkenkreuz in the German one). The flag is the gameplay marker for reinforcements; flagged buildings can also serve as prisons.
- **Water** is painted but animated by a distortion effect: `.WATER [ .BMP MAR01.BMP .BMPSRC MAR0SRC.BMP .BMPDST MAR0DST.BMP .VELINC 5 .ANGINC 220 .SININC 3 ]` (stream velocity, direction in degrees, turbulence). Shorelines have a darker wet rim and rocks; deep water is nearly opaque teal with no visible bottom. Particles (splashes, wakes) were the late addition.
- **Destruction:** ruin sprites (`-RUINA07.RLE`), VOL `EXTRAINFO` debris IDs, `.AUTOEXPCASAS`, `.EXTRASPRITES` (§6.5).

### 12.6 Characters, sprites and animation

**Enemy sprite sets** (`.ANIMSOLDADO`, `.ANIMCABO`):

| Set | What it is |
|---|---|
| `ALEMAN2` | Grey/grey uniform |
| `SOLDADO` | Grey/green uniform |
| `ALEMDES` | Desert uniform |
| `ALEGABAR` | The most common set in the M4 file; matches the long Norway greatcoats [inferred] |
| `CABO` / `CABODES` | NCO / desert NCO |
| `ALGADES` | Not identified |
| Others | `MECANIC` (mechanic), `ARTIFIC` (sapper), `FRANCO` (sniper), `MOTO` (motorbike), `TREN` (train), `LANCHON2` (boat) |

- Sprites live in `DATOS\RECURSOS\ELEM\*.ANM` (`SEQUENCE name,frames,distance,duration`). Orientation 0 = east, angles clockwise.
- **Animations mentioned:** walk, run, crawl; burying in snow/sand; carrying bodies; climbing; swimming and diving; guards smoking; arrested with hands up; death sprawl (bodies persist).
- **Footprints:** visible to the player in snow and sand, fading over time; separate flags for "footprints you can see / enemy can't" and "you can't see / enemy can".
- **Vehicles:** trucks, a staff car, motorbikes with sidecars, a Panzer I (visuals.md lists one), armoured cars, trains, patrol boats, the inflatable, the mini-sub, the Ju 52 and the autogyro, each pre-rendered in several directions.

### 12.7 Effects

- **Explosions:** large saturated yellow-to-white fireballs a few body-heights across with a short flash; `MEGAEXPL` for big blasts; objects then swap to ruins; barrels chain.
- **Fire:** burning wrecks with the `LLAMAS` loop.
- **Gunfire:** small orange muzzle bursts; separate sounds per weapon.
- **Sparks:** `.CHISPAS [ .VOLMAPA CABLES ]` on electrified objects (M16 cables, M3 transformer station) with `ELECTRO`, `ELECSHOK`, `APAGELEC` sounds.
- **Blood (uncut):** spurts when shot or knifed, **pools under corpses**. The German release removes blood and swaps corpses for gravestones (§1.3).

---

## 13. Audio

### 13.1 Music

- **Composer:** David García-Morales Inés ("Music & audio" in the manual; he also directed the Spanish dub). EN Wikipedia credits him with the soundtrack (Retro Gamer ES #25, "Commandos: compases de guerra"). ES Wikipedia also credits César "Gominolas" Astudillo, whom the manual lists under "additional design" (unresolved). Mateo Pascual scored the next four games.
- **Official album** (digital, 2016, 25 tracks): *Commandos Menu* (2:40); campaign themes *Operation in Norway* (2:17), *War in Northen Africa* (1:14), *Disembarkation in Normandy* (1:52), *Cross the Rhin* (1:06), *Final Assault on the Third Reich* (1:34), *End of the Second World War* (1:16); *Briefing 1-3* (1:17-1:51); *Theme Tutorials* (3:37); *Start Mission 1-6* (13-25 s stingers); *Successful Mission 1-3* (10-14 s); *Unsuccessful Mission 1-3* (15-23 s); *Exit Game* (0:08); *Credits* (1:07).
- **Style** [inferred]: orchestral war-film scoring, snare-driven marches, brass calls, sombre strings.
- **In-mission music (disputed):** Revora modders explain "why BEL never played any tempting music" in missions and tried injecting music via ambient sound IDs; GameSpot: "There isn't much music to speak of … the sound, though authentic, is sparse"; gamesof1998: "subtle and minimal during gameplay". Gap 8 found `SONIDO/MUSICA.XMI` in the game data: **one MIDI sequence on 14 channels, about 14 minutes, with 15 branch points**, so in-game cue music exists [inferred]. Best reading: missions are near-silent apart from short stingers/cues; no continuous background score.
- Music format: 16-bit stereo (remakes.md).

### 13.2 Sound effects and ambience

- **Format:** WAV, **8-bit mono, 11.025 kHz**. Each sound ID has a hard-coded re-trigger interval (a 2 s bird call repeats about every 5 s).
- **Sound ID list** (file-types PDF, herbert3000/Revora, EXE):

| Group | Sounds |
|---|---|
| Guards and voices | `ALTO` ("Halt!"), `QUIENVA` ("Who goes there?"), `VOZALARM` / ALRM (alarm shout), `SOLDAT`, `DETENIDO` (arrested), `ESPIA` (spy), `MUERTE` / `MUERTO` / `HERIDO` (death and wounded cries), `ESFUERZO` (effort grunt when carrying) |
| Weapons | `PISTOLA`, `METRALL0` / `AMETRALL` (SMG and MG), `FUSIL` (rifle), `FRANCO` (sniper), `CARGAFUSI` (reload), `CUCHI` (knife), `TANQMETR` (tank MG), `METRLANC` (boat MG), `DISPARO1`, `SUBMISIL` (torpedo) |
| Explosives | `EXPLOSI`, `MEGAEXPL`, `TICTAC` (bomb timer), `SEGNUELO` (decoy), `BARRIL` (barrel), `DERRUMBE` (collapse), `LLAMAS` (flames) |
| Vehicles | `CAMION` (truck), `TREN` (train), `FRENADA` (brakes), `BOCITREN` / `BOCINA` / `BOCIBARC` (train, car and ship horns), `AVION`, `AUTOGIRO`, `REMADA` (rowing), `HANGAR` |
| World | `SIRENA01` (the siren), `TELEFONO`, `SWITCH`, `ELECTRO`, `ELECSHOK`, `APAGELEC`, `ESCLUSA` (sluice), `AGUAPRES` (water under pressure), `CHORRO`, `LADRIDO` (dog), `PASOS` / `PASOSAGU` (footsteps, in water), `SPLASH`, `BUZO` (diver) |
| Nature | `PAJARO0` / `1` (birds), `GRILLOS` (crickets), `VIENTO` (wind), `OLEAJE` (surf) |

- **Ambient nature sounds were cut from retail.** The "Noisy mother nature" preference worked in the demo, but retail `.MIS` files have no ambient entries; modders re-enable them with `[ .SOUNDID WIND .POS [ 467 647 0 ] .VOLUMEN 0.15 ]` inside `.INTENDENCIAINFO`. Retail missions are near-silent between footsteps, gunfire and voices.
- **The alarm:** `SIRENA01` at volume 0.75 fading over 500 ticks (≈25 s), plus the spotter's `VOZALARM` shout; troops pour out of flagged barracks. The siren is probably a WWII air-raid wail [inferred].

### 13.3 Voices

- **Verbose/Laconic** switches commando acknowledgements. GameSpot: the commandos are "immediately distinguishable through their speech" but have "disappointingly few speaking lines. The Germans don't have a lot to say either."
- **Commando lines** (§5.4-5.9 for attributions): Green Beret: "Consider it done!", "Comin' over. Comin'! I'm comin'!", "Coming.", "Just leave it to me.", "That's easy.", "Okay.", "Mhmm.", "Ah! Dat hurts! Get me outta here!", "Huh. Wish I could do dat.", "Are you crazy?". Driver: "Sure thing!", "Okie dokie!", "Consider it done, boss!", "No problem, boss!", "No problem man.", "Right away.", "I'll be right there.", "Finally, some action.", "Why don't you try it, boss?", "This looks bad!" (killed). Marine: "Coming right over! ……… sir." Sniper: "Yep…". Unattributed (All The Tropes): "Yes sir!", "Coming right over, sir!". No BEL lines were found for the Sapper and Spy.
- **Not BEL:** the Spy's "Revenge is sweet", "Nazi scum!", "Time to pay!" and the Green Beret's "Shit!" when shot (BCD and later). The needsomefun.net "quotes" (e.g. "Silent as the night…") appear nowhere else and are treated as fabricated.
- **German lines:** "Halt!" (`ALTO`); the arresting sergeant's **"Stehen bleiben!"** (German players on Steam); "Who goes there?" (`QUIENVA`; probably "Wer da?" / "Wer ist da?"; eggie quotes "Halt, wer ist da?"); an alarm shout, probably "Alarm!"; death and wound cries.
- **Colonel Montague Smith** voices the briefings and map walkthroughs with a British accent.
- **Spanish dub** (studio Contenidos Interactivos, directed by García-Morales): Green Beret and the instructions voice Luis Grandío; Sniper Esteban Massana; Marine Alejandro García "Peyo". Fans remember "Sí señor", "Ya voy señor", "Eso está hecho (jefe)" and "Voy". Clips are packed inside the data files.
- **Full line list:** the 400-second "All sounds" rip on YouTube (PN2A5yaexQY) contains every clip; its captions were not machine-readable, so it must be transcribed by ear.

---

## 14. Engine, data formats and modding

### 14.1 Files

- **`WARGAME.DIR`**: the data archive (extract with DirExtractor, the QuickBMS script `DirExtractor.bms`, WargameLib or nme).
- **WAD**: sprites and palettes (8-bit indexed, RGB565 palettes); **RLE/RLC/ZOM/FNT/ANM**: sprite, font and animation formats (MultiExtractor). Interface WADs per resolution; `FASExxxx.WAD` holds map art.
- **VOL** (`MAPAxxxx.VOL`, render geometry; `CHOQxxxx.VOL` small extra obstacles), **SEC** (logic geometry), **MIS** (mission script), **STR** (strings), **TIP/POL** (tooltips), **MAC** (AI macros), **DAT** (`MISIONES.DAT` campaign order), **CFG** (`COMANDOS.CFG` / `COMANDO.CFG`).

### 14.2 VOL: render geometry

- Text: `MAPDIMXY w,h`, then `MAPTABPOLYS { POLY ... }`. Each `POLY "NAME",cx,cy,cz,height,#points,#tiles` has `POINT x,y` footprint vertices relative to the centre, an `EXTRAINFO` block (8 bytes of debris-type IDs for destruction) and `TILE x,y,w,h,offX,offY,brightness,"SPRITE","XYL"` (flags X mirror, Y flip, L light/explosion; brightness 0 normal, +20 white, −20 black).
- `POLYRAMPA` adds a height offset for stairs and ramps; `POLYZOOM` fakes height.
- Naming: `BASE` (ground), `AGUA` (water), `ARBOL??` (trees) / `ARBOL??S` (tree shadows), `CASA??` (buildings), `*.EXP1` (explosions). A sprite name prefixed with `-` stays hidden until the object is destroyed (`-RUINA07.RLE`).
- **Depth sorting:** draw `BASE` first; then sort naively by centreY then centreX, or properly by overlapping bounding boxes plus Z (`A.z >= B.z + B.height`) with edge tests for ambiguous cases (Revora).

### 14.3 SEC: navigation and sight mesh

- "Contain the navigation mesh of a map. It is used for pathfinding and for calculating the field of view." Layout: a vertex list (float X,Y), **convex sector polygons**, bridge sectors, named **areas**, and **connections** (sector pairs the Green Beret can climb between). BCD's binary variant adds adjacency tables `TW1` (neighbour across each edge, −1 = border), `TW2` (bridge-to-ground links), `TW3` (sectors under each bridge).
- **Per sector:** `#points kx ky bz Type Height Offset Flags`; plane z = kx·x + ky·y + bz.
- **Type:** 0 land, 1 shallow water, **2 snow/sand (footprints)**, 3 deep water, 4 conveyor (M19).
- **Flags:** 1 stair/ramp; 2 bridge; 4 not enterable by any unit (fences; cone drawn on it); 8 not enterable by commandos; **16 blocks sight** (*oclusor*); 64 climbable wall. Normal sectors 384 (128 + 256); blocked 276; walk-blocked but see-through 260 (cone not drawn) or 4 (cone drawn); climbable walls usually 448. The two sources disagree on bits 2 and 8 (the PDF lists 2 as "unknown / used by bridge sectors" and 8 as "?").
- Height: sector planes and bridges that can be walked on and under; sight uses a 3D segment with a horizon test (§8.1).

### 14.4 MIS: mission scripts

- Bracket syntax `.KEYWORD [ ... ]`; `#` comments; whitespace-separated tokens; keyword order doesn't matter. Spanish keywords.
- **Mission record** `.FASExxxx [...]` contains: `DATOSFICHEROSMISION` (points at the SEC, VOL, TIP/POL, STR and WAD files); `PATRULLAS` (squads); `ELEMENTOS` (all dynamic objects); `INTERFACE` (backpacks); `TRIPLINES`; `SENSORES_SND_ZONA` / `SENSORES_EXP_ZONA`; `TIPOTERRENO` (0 green cones, 1 orange/desert); `WATER`; `CASASFUERTES` (bomb-only buildings); `INTENDENCIA` / `INTENDENCIAINFO` (mission-specific EXE code, objectives, escape vehicle, par, exit points); `.BRIEFING` notes.
- **Entity example** (the M4 courier):
```
.CLASS BICHO  .TOKEN MOTORISTA  .BANDO ALEMAN  .XYZ [..] .ANGULO 135
.VOLCOLISION [ CILINDRO [ .R 10 .H 29 ] ]
.LISTAS [ EJEC CHOC SELE ]
.ACCIONES [
  [ AcMuerte     [ .CARISMA 600 ] ]
  [ acUsaHab     [ .CARISMA 500 .HABILIDAD TIERRA ] ]
  [ acBuscaAyuda [ .CARISMA 400 .EVENTO RAYU ] ]
  [ AcVigilar    [ .CARISMA 300 ] ]
  [ acPatrulla   [ .CARISMA 200 .PATRULLA [...] ] ] ]
.ORGANOS [ .VISTA [ Vista01 [ ] ]  .MOTOR [ MotorAndante [ ] ]  .OIDO [ Oido01 [ ] ] ]
```
- **Guard macros** (`.CLASS MACRO`): `BANPE1` (sentry, holds), `BANPE2` (sentry, investigates), `BAP1` (patroller, keeps patrolling), `BAP2` (patroller, investigates). Fields: `.Angulo` (0 = east, 90 = south, 180 = west, 270 = north; clockwise), `.Grafico` (sprite set), `.AngBarrido` (sweep), `.UmbralNerviosismo` (default 50).
- **Routes** (`.TIPORUTA`): `LOOP` (A→B→C→D→A), `PINGPONG` (A→B→C→D→C→B…), `STOPPED`, `JUMP` (teleport; only the leader of a group jumps), `EXIT` (scripted vehicles). Waypoint options `.ESPERA` (ticks), `.ANGULO`, `.VELOCIDADTRAMO`, `.ENLAZAR`, `.CASA`. A patrol's speed is fixed at spawn.
- **Squads** (`.PATRULLAS`): `.NSOLDIERS` (+1 leader), `.NCOLUMNS`, leader/trooper sprites and weapons (`PISTOLA`, `METRALLETA`, `RIFLE`), `.SIGUEHUELLAS`, `.REGENERATE` / `.REGENERATEPATROL`, `.HOME`, `.STARTATHOME`, `.EXITHOME_EVENTS`, `.REACT_EVENTS`, `.JAIL`, `.VIGILARDEF [ .ANGBARRIDO 50 .DEMORA 50 ]`, `LOOKBACK`.
- **Commando definition** (`BICHOALIADO`): abilities `auAcuchillar` (knife), `AuCamuflarse` (bury), `auCogeBarril` (carry barrels), `AuGarfio` (carry bodies; GB and Spy), `AuBotiquin` (first aid; Sniper, Driver, Spy; `.USOS`), `AuBucear` (dive), `auJeringar` (syringe), `auEscalar .ESCALAMUROS SI` (climb walls), `acMuerte`, `acPisar`, `acDejarRastro`, `AcDetenido`, `auManejaSegnuelo`, `AuManejaBomba`, `AuManejacepo`, `auManejaBalsa`, `auUsarVehiculo`, `auDisparar .ARMAS [PISTOLA …]` with ammo fields `.MUNMIRILLA`, `.MUNMETRA`, `.GRANADAS` (and unused `.MUNFUSIL`). `.EMPIEZADISFRAZADO 1` starts the Spy in uniform. `.NOAGACHA` forbids going prone. Commando MIS code can be generated with CaraCreator.
- **Objects:** `CAJABALA .BALAS 3` (ammo), `SEGNUELO .INTERVALOSND 30` (decoy), `BOMBARET .RETARDO 200` (time bomb), `CUARTEL` (barracks, `.NumRegenSoldiers`), `CARCEL` (jail), `UNIFORME`, `ZODIAC`, `BARRIL`, `ESCALA` (ladder), `BANDERA` (flag), `METRBASE` (MG base), `TESTIGO`. Unused: `BALLESTA .FLECHAS 5`, `LANZALLA`.
- **Other keywords:** `.RANGOVISION`, `.VISTAELIPTICA`, `.TIEMPOENTREMIRADAS`, `.TIEMPOMIRANDOCOMPA`, `.DESCUBREESPIA`, `.NERVIOSISMO`, `.UMBRAL`, `.SIGUEHUELLAS`, `.Ladrador`, `.AMO`, `.OCLU`, `.IMPACTOS`, `.ENEGIA`, `.DANO`, `.RADIO`, `.DestruyeGranada`, `.CHISPAS`, `.AUTOEXPCASAS`, `.EXTRASPRITES`, `.ANIMSOLDADO`, `.ANIMCABO`, `.ANIMPAL`, `.PAR_TICKS`, `.OBJETIVO`, `.VEHICULOHUIDA`, `.PUNTOHUIDA`, `.EXITPOINTS`. A Notepad++ language file lists effectively the whole MIS vocabulary.
- **Event wiring:** `SENSORES_EXP_ZONA` (seen in area) and `SENSORES_SND_ZONA` (heard in area) post events; patrols with `.EXITHOME_EVENTS` leave barracks; `TRIPLINES` fire on a unit reaching a point. Walkthroughs describe exactly this ("Anything suspect or heard near the outskirts of the right camp will sound the alarm").

### 14.5 Modding tools and documentation

- **Tools:** DirExtractor, MultiExtractor, WadCreator, WadPngTools, ImageSlicer (large 8-bit BMP → tiles + VOL), MapEditor 1.07 (new BEL maps), SecCreator and SecEditor (the "logical map"), CaraCreator, VOLReader, `SEC5.java`, BEL-to-C2 map converters, Commandos Resolution Hack. Mirrored at herbert3000.github.io, sites.google.com/site/commandosmod and retrogamesvault.com/commandosmod.
- **Docs:** *CommandosFileTypes.pdf* (v.2, 15 pp.), *BCD_SEC_Format.txt*, *MIS_keywords_1.pdf*, *VOL_sprite-offset.pdf*, DanO's *MissionEditingTutorial.pdf* (~1999), the Commandos Modding Wiki (SEC file, Mission, Patrols, BANPE/BAP, BICHOALIADO, UNIFORME, ZODIAC, Vehicles).
- **Debug:** the GONZO1982 cheat + F9 overlay (§2.11).

---

## 15. Remakes, successors and genre lessons

### 15.1 Open-source and fan projects

| Project | What it is | Status |
|---|---|---|
| **martinstarman/open-commandos** (C++17, raylib, raygui) | The most serious engine re-implementation: parses `WARGAME.DIR`, WAD, VOL, SEC, MIS, DAT and renders maps (~2,250 lines); uses `g_sin40 = 0.64278760968` | Active (last commit 2026-09-16); docs mostly "TBD"; only control F1 debug |
| **michi84o/WargameLib** (C#) | Library + WinForms viewer: DIR extraction, WAD→PNG, RLE decoding, VOL level viewer; `VOL.cs` is the clearest map-format spec; comment: divide Y by 1.6 (0.625 ≈ sin 40°) | Abandoned |
| **gokselgoktas/nme** (C) | `.DIR` explorer/extractor with WAD decoding; RGB565 palettes | Small, 2022 |
| ammarrmalik185/Commandos-Remake (Unity) | "Remaking commandos game in unity" | Two commits, empty |
| joscanper/unity_coneofsightfx (Unity) | Cone of sight from a secondary camera's depth texture, rendered as a deferred decal | GPU cone reference |
| d-bucur/godot-vision-cone (Godot 4) | 2D cone from uniform raycasts | CPU cone reference |
| rich-p.itch.io/commandos (Unity, HTML5) | Weekend prototype; guards Patrol/Alert/Attack; crouching in the striped zone hides you | No source |
| mwaf/cbel | Krogell's 1998 mod including the retail M1 `.MIS` | Data source |

**No complete open-source BEL remake exists.**

### 15.2 Official remasters and successors

- **Commandos 2 HD Remaster** (Yippee!, 24 Jan 2020): Unity, the first 3D-engine Commandos, 360° rotation, reworked UI and controls.
- **Commandos 3 HD Remaster** (Raylight, 30 Aug 2022): new models and textures, refined UI, mechanics largely unchanged.
- **Commandos: Origins** (Claymore / Kalypso, Unreal Engine 5, 9 Apr 2025): six commandos (Green Beret, Engineer, Sniper, Driver, Marine, Spy); cones shrink at night and depend on weather; "When you move while prone, enemies won't see you within the **striped** area of their vision cone"; footprints on some surfaces; soldiers stop to chat; **Command Mode** (pause and queue simultaneous actions; praised); three difficulties (Beginner/Normal/Hard) scaling enemy reaction speed and commando health; quicksave F5; 2-player co-op; "Commandos Mode" and "Classic/RTS" control schemes. Reviewers complained of being shot "while clearly outside the viewcone" ("What's the point of viewcones if they're not 100% reliable?"), invisible walls, clumsy one-at-a-time cone toggling and sluggish units.

### 15.3 What Mimimi learned (Shadow Tactics, Desperados III)

- GDC 2018 "Commandos with Ninja" and postmortem: BEL's chess-like character interdependence beats C2's complexity; pillar "creating depth without adding complexity" (no inventory swapping; each character strong alone, stronger combined).
- **Shadow Tactics cones:** shadow-mapped (depth texture from the guard's eyes; mask "full vision / occluded / crouch distance / out of bounds"; full-screen colouring pass with stencil). Near bright (always detected), far dark and **hatched** (safe while crouched); bushes dotted and hide crawlers. **All guards share cone size, turn angles and speed on every difficulty.** One cone at a time.
- **Detection feedback:** not instant (unlike BEL): a unique sound, slow motion, auto-focus on the detecting guard, and **yellow filling the cone from the eyes toward the character**, detection when it arrives (improving on Desperados 1's whole-cone yellow).
- **Desperados III:** binary deterministic rules (guns always hit; randomness only in search patterns) so quicksaves stay meaningful; visible noise circles while aiming (revolver radius 18.0, a throwing-knife victim's death cry 6.0, probably metres); off-screen markers; visible reinforcement spawns; "civil zones"; a Showdown pause (removed on the hardest difficulty); an end-of-level replay timeline.
- **Quicksave as a mechanic:** Shadow Tactics shows a "last save" timer after 1 minute (green), yellow at 2, red at 3. "Failure doesn't matter in our games, because you can just try again."
- **Lesson for the remake: the drawn cone must be exactly the detection geometry.**

---

## 16. Implementation notes for the three.js remake [rec]

Everything in this section is a recommendation drawn from the reports; the facts it rests on are cited in the sections above. "Faithful mode" reproduces BEL; "modern mode" options are clearly optional.

### 16.1 Settled values (use these)

| Topic | Value |
|---|---|
| Simulation | Fixed 20 Hz step, interpolated rendering at display rate; optional 16-25 Hz speed setting |
| Units | Keep mission data in BEL units; 1 three.js unit = 1 m; convert × 0.045; x = X·k, z = Y·k |
| Camera | `OrthographicCamera`, pitch 40° below horizontal, **yaw 0**, fixed orientation; `camera.position = target + d·(0, sin40°, cos40°)`; zoom via `camera.zoom` on numpad + / − / * (≈0.5×, 1×, 2×, optional 4×) |
| Soldier cone | 70° full aperture; near 400 u (18 m); far 800 u (36 m); sine sweep ±ANGBARRIDO (default 50°) with period DEMORA (100 ticks; squads 50) plus 0-20 tick phase jitter; optional elliptical shrink b = a/3 (retail setting unknown) |
| Other cones | Dog 90°; MG nest/tower 40°, 320/640, constant range; Panzer crews 70°, 500/1000, sweep 155; SdKfz 40°, 550/1100; trucks none (run-over box only) |
| Cone colours | Near `#02BC6F`, far `#07675A` (desert `#D26E02` / `#6B4C01`), flat 50 % blend, hard edges, drawn on the ground under tall props |
| Detection | Instant; near band sees all stances; far band misses prone commandos, divers and footprints; bodies, standing commandos and suspicious Spy acts are seen across the full cone; flag-16 occluders block at any height; trucks/tanks hide what is behind them |
| Reaction | Nervousness N (−1/tick; + int(2·d²) per tick of target motion; 1000 within 50 u; + max(1, T/25) after seeing a body) against T = 50; challenge at N ≥ T; hold / arrest / fire as in §8.5; ~950 ticks to calm down |
| Noise | Movement and body drops silent; knife/syringe/trap/harpoon/sniper silent; pistol medium radius; SMG larger; explosions map-wide; decoy pulse every 30 ticks; shouts small radius; levels 1-3 as in §8.3 |
| Alarm | Zone sensors → named events; `RINT`-style event starts a 500-tick fading siren; barracks pools of 5 or 10; squads leave together, run their exit route at VEL 3, then loop at VEL 2 forever; regeneration until the pool is empty or the barracks destroyed; no global reset |
| Commandos | HP GB 200, Ma 160, Sp 160, Dr 130, Sa 130, Sn 100; walk 2.5 u/tick; run GB/Dr 6.0, others 5.0; raft carry −1.0; crawl ≈1.0 (placeholder) |
| Weapons | Ranges pistol 300, grenade 300, SMG 400, sniper 1000, harpoon 200 (or 100); pistol ≈3 hits, ≈6-7 shots/s, unlimited; sniper one shot, 0.5 s delay; SMG 100 rounds shown as 20 bursts of 5; knife 120; first aid +34 × 6 doses; time bomb 10 s |
| Enemy damage (placeholders) | Rifle 80 per hit; MP40 100 per round in 5-round bursts; MG nest 100 per round; tank shell lethal; dog bite 25; fire 100; electric 20 |
| Vehicles | Durability and seats per §9.2; straight-line driving only; double-click fast; Ctrl+click fire |
| Scoring | Time stars from per-mission par (3 ≤ P, 2 ≤ 1.5P, 1 ≤ 2.5P); damage stars from missing team health (≤10 % / ≤30 % / ≤60 %); gold = floor(sum/2); rank every 6 gold; M20 gate at Captain |
| Passwords | Own-key version of the demo scheme (6-bit mission, 4-bit rank, 5-bit stars, checksum, parity, base 36 + check character); O=0, I=1 |
| Keys | BEL bindings by default (§3); Ctrl+S / Ctrl+L quicksave (F5 as optional alias); Tab flips the right column |
| Names | US-manual commando names by default, European names as an alternative locale; official English mission titles |

**Superseded earlier estimates:** remakes.md's cone (90°, 10-12 m near, 20-24 m far), walk 0.9 m/s, run 2.5 m/s, crawl 0.4 m/s and guard turn rate ≈90°/s; remakes.md's footstep (3-4 m) and body-drop (2 m) noise radii; "bodies near band only"; the 80×100 m map size; visuals.md's yaw 45°, 5.7 cm/px scale and sampled cone colours (#21864a / #187539 / #429e63); controls.md's rgba suggestions and mechanics.md's #4BFFA0 / #006955 cone colours; overview.md's "stable last 4 password characters".

### 16.2 Architecture and data

- **Determinism:** seeded RNG (e.g. mulberry32), all game state in plain JS objects, simulation separate from three.js objects (ECS-lite, testable; AI and pathfinding can move to a Web Worker). Quicksave = `structuredClone(state)`, optionally persisted to `localStorage`; a Shadow-Tactics-style "last save" reminder is a modern option. Keep rules binary and deterministic (the Mimimi lesson).
- **Mission JSON mirroring MIS concepts:** `sectors` (convex polygons with height, type and flags: walkable, blocksSight, lowCover, water, snow, climbable, conveyor); `entities` with `vision {fovDeg, nearR, farR, sweepDeg, sweepPeriod, elliptical}`, `hearing`, `motor {speed}`, `actions [{type, priority}]`; `patrols` with `routeType` (LOOP / PINGPONG / STOPPED / JUMP / EXIT), `waypoints [{p, wait, facing, speed, link}]`, `columns`, `home`, `startAtHome`, `exitHomeEvents`, `reactEvents`, `jail`, `followsTracks`, `regenerate`; `barracks {pool}`; `zones` with `onSeen` / `onHeard` events; `triplines`; an event bus. Procedural levels can emit the same schema.
- **Per-mission record:** roster and loadout (ammo, bombs vs remote bombs, first-aid doses, starting disguise), objectives, extraction (vehicle token/point/exit points, appears-after-objectives flag, self-driving flag), silent-zone polygons with an alarm-equals-failure flag and special fail rules (general flees, sappers detonate, tank sinks sub, prisoner shot), par ticks per difficulty, terrain type (green/orange cones), water flow, briefing slides and Tactical Advice text, notebook hints, difficulty variants.
- **End-of-mission controller** modelled on the EXE codes 1-7 with the 100-tick grace countdown and the "continue / quick load" dialog when extraction precedes the objective.

### 16.3 World, rendering and camera

- Build each mission as one bespoke diorama at the sizes in §10.2 (not from tiles); place props freely; keep tree density close to BEL because trees are occluders.
- **Multi-view (F2-F7):** `renderer.setScissorTest(true)` and a `setViewport`/`setScissor` pass per ortho camera; cycle layouts on repeat presses; red 2 px frame on the active view; corner camera badge on tracked views.
- **Units behind buildings:** X-ray silhouette pass (`depthFunc: THREE.GreaterDepth`, `depthWrite: false`, flat muted team colour); fade or hide roofs when a unit is inside.
- **Performance:** `InstancedMesh` for trees, crates and fences; merge static geometry.
- Optional "diorama" perspective mode with an 8-12° FOV at the same angles (never a wide FOV, which breaks the cone read); optional true isometric (yaw 45°, pitch 35.264°) only for new axis-aligned art.

### 16.4 Pathfinding

- **Option A:** 0.5 m grid rasterized from walkable sectors (a BEL map of roughly 65-200 m per side is tens of thousands of cells), A* with 8 neighbours and an octile heuristic, then string-pulling or Theta*; per-class passability masks (commandos blocked by flag 8, everyone by flag 4).
- **Option B (closest to BEL's convex-sector navmesh):** navcat (MIT, pure JS, three.js helpers, off-mesh links for ladders and climbable walls) or recast-navigation-js (WASM Recast/Detour with a crowd module and `@recast-navigation/three`); Detour-style navmesh raycasts also answer line-of-sight queries (BEL most likely walks rays across convex-sector adjacency until it hits a flag-16 sector [inferred]).
- **Squads:** the leader follows the route; followers follow his breadcrumb trail at formation offsets (`NCOLUMNS`, ~1 m spacing). Vehicles: straight-line moves only (faithful). Units stuck for 5 s: BEL-style panic wander.

### 16.5 Vision rendering and logic

- **Logic per guard per tick:** range test (far edge, elliptical if enabled), aperture test (`dot(fwd, dir) ≥ cos(fov/2)`), 2D segment test against blocks-sight edges in a uniform-grid spatial hash (use `three-mesh-bvh` only if true 3D is needed), the band rule, special states (buried, diving, disguised, inside a building). About 60 guards × 6 commandos at 20 Hz is ~7k segment casts per second.
- **Rendering (selected guard only):** build a **visibility polygon**: rays every ~2° across the cone plus both edges, three rays at each occluder vertex (angle ± ε), nearest hit per ray, sort by angle, fan-triangulate; split into a near fan (radius ≤ near) and far ring; write into a preallocated `BufferGeometry` each frame; render `transparent`, `depthWrite: false`, `polygonOffset`, a few cm above the ground, beneath trees and roofs. **Use the same polygon for the detection test** (the Origins failure).
- Auto-show the spotter's cone when a commando is seen; implement the red watch marker (flash the first guard whose polygon contains it). Optionally animate BEL's left-to-right sweep reveal.
- **GPU alternative** for heavy 3D occluders (Shadow Tactics, joscanper): a depth texture from a perspective camera at the guard's eyes, projected in the ground shader; looks great but logic and display can diverge unless logic samples the same map.
- **Modern options:** striped far band (`step(0.5, fract((p.x+p.z)*k))`), a red alert tint, and a "Modern" detection mode with a yellow fill travelling from the eyes over ~0.3-1.0 s with slow motion and a sting. Faithful mode is instant and flat.

### 16.6 Noise, footprints and AI

- Noise events `{pos, radius, kind, level}`; guards inside the radius react (optionally halved through walls [inferred]). Starting radii: pistol 15-20 m (cf. Desperados III revolver 18), SMG ~25 m, decoy 10-15 m pulsing every 1.5 s, shouts a few metres, explosions global. Modern option: show rings while aiming and ear markers at the screen edge for off-screen listeners.
- Snow/sand sectors spawn fading footprint decals (a render-target trail map fading over 60-120 s) and store positions for AI with `followsTracks`.
- **AI layers:** outer priority arbitration like CARISMA (Dead > own logic > Shoot > Watch > Search > UseAbility > Footprints > Patrol), each action with `canRun()` and `tick()`; inside, the state machine of §8.6 with the exact nervousness model; buddy glances (50 ticks every 500) that notice missing or dead comrades; archetypes `holdPost`/`investigates` × `static`/`patrol`, squads with a leader, posts with traverse arcs, vehicles (including polygon view volumes), dogs, and scripted no-alarm units (officer drivers, the general, the sappers). Yuka can supply scaffolding.
- Faithful mode: no knock-outs, no incapacitation, no footstep noise, no orders while paused.

### 16.7 Input and UI

- **Overlay** as a DOM/CSS layer or an orthographic scene drawn after the 3D view, laid out in 640×480 reference pixels and scaled by an integer or user factor, so more resolution = more map. Sizes: top bar 45 px; right strap ~34 px; notebook ~183×215 open (per-mission art); knapsack 112×149; portraits 62×44 at a 65 px pitch; every button with a hover state.
- **Software cursor** on a top overlay for the grab animation, blinking eye, forbidden overlay and the **2× magnifying sniper scope** (render-to-texture sample of the main view in a circular mask).
- **Input state machine:** cursor modes move, item, eye, track, grab, lever; a weapon-drawn state that blocks movement until right-click; double-click means run in every moving mode.
- **Selection:** raycast against enlarged invisible capsule colliders; box select by projecting each commando (`pos.clone().project(camera)`) against the dragged NDC rectangle (more robust with ortho than `SelectionBox`); right-drag as in BEL.
- Rebinding and a "modern" preset are harmless extras; a pause-and-queue "command mode" (Origins/Mimimi) is a modern option.

### 16.8 Art direction

- **Match BEL's look with new CC0/self-made assets:** woven khaki-brown webbing with eyelets and buckles, painted greyscale portraits with red vertical health bars and skull swaps, a photo-real eye, a vintage film-camera icon, a "?" plate, a spiral notebook with a procedurally drawn ink-sketch minimap (circles for rocks, rectangles for buildings, "X" chains for wire), a photo-real hand, an olive rucksack with realistic item art. For the red condensed briefing titles, an open heavy condensed sans (Oswald or Anton, SIL OFL; OFL is not CC0, so check the project's licence policy). **Do not ship original assets.**
- **Lighting:** bake static lighting (Blender Cycles lightmaps and AO on a second UV channel, `aoMap`/`lightMap`); one `DirectionalLight` sun from the screen's upper left (shadows down-right); with an ortho camera fit a single 4096² shadow map to the view (PCF soft or VSM, bias for 5 cm detail); contact shadows or AO blobs under units; CC0 HDRIs from Poly Haven per theatre.
- **Post:** pmndrs `postprocessing` with N8AO or GTAO at low radius; AgX or ACES tone mapping then a per-theatre 3D LUT; mild bloom for fire and explosions only; no heavy DOF (optional tilt-shift toggle, off by default).
- **Suggested light per mission** (originals are all daylight):

| Missions | Sun elevation / colour temperature | Sky and grade |
|---|---|---|
| M1-M4, M7 (Norway, Feb-Mar) | 12-20°, 5500-6500 K, overcast | Cool desaturated olive; teal water #103f3a; white snow with blue shadows |
| M5-M6 (May) | 25-30°, 6000 K | Brighter |
| M8, M10, M11 (desert) | 55-70°, 5200 K, hard shadows | Warm ochre #967e5d, bleached highlights, distant heat haze |
| M9 ("By dawn") | 8-12°, 3500 K (optional golden hour) | Keep readable |
| M12 (Tunis) | 45°, 5500 K | Whitewashed walls, strong contrast |
| M13-M14 (May) | 35-45°, 6000 K, sea haze | Grey-teal, concrete |
| M15-M16 (Aug-Sep) | 40°, 5800 K | Late-summer greens, dark cobbles |
| M17 ("Before Dawn") | 5-10°, 7500 K blue hour (faithful: overcast daylight) | Cold blue |
| M18-M20 (Dec-Feb) | 10-18°, 6500-7000 K, overcast | Frost; dark slate and forest for Valhalla |

  Grading: average saturation ~0.15-0.35, midtones ~0.3-0.5 value; pure saturated colour only for flags, fire, blood and UI markers.
- **Materials:** Poly Haven and ambientCG PBR sets (grass, rock, snow, mud, asphalt, planks, corrugated iron, brick), echoing Blanco's photographed textures; self-made period vehicles (Opel Blitz, Kübelwagen, SdKfz 231, Panzers, BMW R75, Ju 52, Horch, Citroën 15 CV).
- **Water:** three.js `Water2` with a flow map driven by each map's `.VELINC`/`.ANGINC`/`.SININC`; deep teal #103f3a for fjords, cyan #107083 for the M2 river; foam and wet rims, GPU splash/wake particles, a bubble trail for the diver.
- **FX:** blood spray and growing pools under persistent corpses; explosions as flipbook or volumetric fireballs 3-4 body heights across with an 80-150 ms point-light flash, lingering smoke, a debris burst and a swap to a pre-authored ruin mesh; looping fire and heat shimmer; spark bursts on electrified cables and fences; animated cloth flags on barracks (the gameplay marker).
- **Content setting:** a German-release mode (no blood, gravestone markers, Balkenkreuze). Default to Balkenkreuz vehicle markings and generic, symbol-free flags for barracks and prisons (legally safer and region-safe).

### 16.9 Audio

- **Music:** menu, campaign-intro, briefing and tutorial themes plus short stingers at mission start (~15 s), success (~10 s) and failure (~20 s); missions without continuous music (optional "cinematic" low ambient beds). Commission original orchestral war-film cues; never use the 1998 recordings.
- **Ambience:** unlike retail BEL, enable the demo-era "noisy mother nature" layer with positional loops (wind, surf, birds, crickets, dogs, electric hum near fences, trains, horns) through Web Audio `PannerNode`s with the listener over the screen centre and inverse-distance rolloff falling off near the screen edge. Keep the mix sparse: silence is part of the tension.
- **Voices:** cast accents per character (Driver Brooklyn American, Sniper upper-class English RP, Marine sarcastic, Spy French, Sapper English; pick one accent for the Green Beret and keep it). Record 10-20 new acknowledgements per commando (select, move, action, can't-do, hurt, death) in the tone of §13.3; provide Verbose/Laconic. German enemies by native speakers: "Halt!", "Wer da?", "Stehen bleiben!", "Alarm!", "Hände hoch!", investigation mutters, death cries.
- **Siren:** a hand-cranked air-raid wail (rising over ~3 s), placed at the barracks, fading over ~25 s as in the engine, plus the spotter's shout.

---

## 17. Contradictions register

| Topic | Versions found | Resolution | Basis |
|---|---|---|---|
| Green Beret name | Jerry McHale "Tiny" (US manual) / Jack O'Hara "Butcher" (EU, dossiers, C2 HD) | Both valid; US names primary in the remake | gap 8 |
| Sapper / Spy nicknames | Inferno / Fireman; Spooky / Frenchy | Locale variants | manual vs dossiers |
| Driver name | Sid Perkins "Tread"; "Sam" once in the US manual; Samuel Brooklyn (later canon) | Locale/canon variants | manual, fandom |
| Mission title set | Prima/fandom titles vs "Discret Explosion", "Backward Throttling"… | The latter are re-translations (Kildread), not an American set | missions.md, gap 8 |
| M11 title | "In the Soup" (fandom) vs "Into the Soup" (Prima) | Use "In the Soup" | — |
| NA release date | 27 Aug / 28 Aug / 31 Jul / "1 July" 1998 | Unresolved | — |
| Team size, duration, Pyro founding | 18 vs 15 people; 18 months vs two years; 1996 vs after the Eidos deal | Unresolved | interviews |
| Sales | 1.5M verified by May 2000 vs "2 million+" claimed | Verified figure preferred | — |
| Composer | García-Morales alone vs + "Gominolas" Astudillo | Unresolved | manual vs ES Wikipedia |
| Scenario count | 24 (CGW) vs 20 | 20 (24 probably counts training) | — |
| Simulation rate | ~16 fps observed, 25 fps cap, 20 Hz implied by the bomb | 20 Hz fixed step | gap 2, gap 8 |
| Time-bomb fuse | 10 s (manual), 11 s (CommandosHQ), 6-7 s (web), 20 s (fandom, C2) | 10 s; set per instance (M4 7.5 s) | EXE/data |
| World scale | 4.5 cm/unit vs 5.7 cm/px | 4.5 cm/unit; people drawn at ~75 % of vehicle scale | gap 8 |
| Map size | remakes' 80×100 m | Wrong; M1 ≈ 65×171 m, M4 ≈ 199×171 m | gap 8 |
| Camera yaw | 0 (data) vs 45° (visuals) | Yaw 0 | gap 8 |
| Cone size | remakes' 90°, 10-12 m / 20-24 m | 70°, 400 / 800 units (18 / 36 m) | EXE |
| `.AngBarrido` | "cone angle" (Modding Wiki) vs sweep | Sweep amplitude (sine) | EXE |
| Cone colours | Many sampled values | EXE colours #02BC6F / #07675A (desert #D26E02 / #6B4C01); samples are blends; snow cyan unexplained | EXE |
| Cone turns red when alerted | Fan claims | Not in BEL (C2/C3) | fandom scope |
| Bodies seen in which band | Near only (remakes) vs full cone | Full cone | EXE |
| Footprints seen in which band | Near only (EXE flag) vs whole cone (gap 8 decision) | Prefer near only (disassembly); both noted | gap 0 vs gap 8 |
| Diver visibility | Invisible unless seen submerging (manual) vs near-band-only class (code) | Reconciled via reduced height / water surface blocking the 3D line [inferred] | gap 0 |
| Detection delay | Instant (BEL) vs fill meters (Mimimi) | Instant; delay only in the reaction (nervousness) | EXE |
| Footstep / body-drop noise | remakes' suggested radii | None in BEL | gap 8, GameSpot |
| Crawling tracks | Not visible to the enemy (manual) vs Prima waiting for a crawler's tracks to fade | Follow the manual | gap 8 |
| Finding a body | Immediate alarm (manual) vs patrols looking and moving on (Kildread) | Base-class behaviour raises ALRM; some units ignore bodies via flags; per-patrol scripting partly open | EXE, gap 8 |
| Decoy aftermath | Guards usually sound an alarm (Prima) vs used freely | Unverified; no code found | gap 1 |
| Distract duration | Indefinite vs until noise | Both (compatible) | — |
| Patrol size | 2-5 / 2-6 + NCO / 2-8 / 1-48 | NSOLDIERS + 1 leader | tutorial, gap 8 |
| Barracks capacity | 5 or 10 / 3 or 5 / "until empty" | Finite pools of 5 or 10 | data |
| Dogs | M19 only vs "various missions" | M19 only in BEL; BCD maps use dogs | gap 8 |
| First-aid doses | 6 (Kildread), 3 or 6 (ES Wikipedia), 3 (engine default), 5 (BCD) | 6 for BEL | gap 2, gap 8 |
| SMG ammo | 20 (CommandosHQ) vs 100 (data) | Both: 100 rounds shown as 20 bursts | EXE |
| SMG burst size | 5 rounds per trigger (weapon table) vs parser default `TAMANO_RAFAGA` 10 | 5 per trigger for the Driver's SMG; 10 is a parser default | gap 2, gap 8 |
| Harpoon range | 100 (herbert3000, EXE-derived) vs 200 (demo weapon table) | Unresolved (a patch may have changed it) | — |
| Vehicle explosion | `.DANO 80` (mission data) vs `.DANO 180` `.RADIO 200` (MAC) | Prefer MAC 180/200 | gap 2 |
| Panzer IV and grenades | eggie grenaded one vs data immunity | Data: only the Panzer II dies to grenades (if grenade = minor explosion) | gap 8 |
| SdKfz type | 231 (Kildread, tooltip "SDKF2 231") vs 251 half-track (Prima, fandom) | In-game label 231; half-track look noted | gap 8 |
| M7 guns | 210 mm (Kildread) vs "230mm" (fandom) | Unresolved; 210 mm majority | — |
| Motorcycle capacity | 2 (manual) vs "cannot carry one more" (fandom) | Different vehicles: sidecar bike 2, courier bike 1 | data |
| Uniform key | U (manual, HQ, Prima) vs T (German FAQ) | U | — |
| Select all | 8 (CommandosHQ only) | Unconfirmed | — |
| Notebook/eye side | Right (manual, screenshots) vs left (German FAQ, blog) | Default right; Tab flips | gap 8 |
| Notebook size | 183×215 / 155×195 / per mission | Per-mission art (M1 185×229, M2 260×200) | gap 8 |
| Warning flash | Portrait flashes (unsourced) | Unresolved for BEL; BCD: blue while seen, red flash while attacked | gap 5, gap 8 |
| Shift+V cheat | Invisibility (cheatbook) / trace (systems) / all cones (PCGamingWiki) | Shows all units' cones | EXE string |
| Ctrl+I cheat | Invincibility + infinite ammo vs invincibility only | Invincibility only | EXE string |
| Passwords | "Last 4 characters stable" | Not in general; many valid codes per mission | gap 7, gap 8 |
| M1 extraction | Extraction required vs none | None: ends on the relay explosion | data, gap 7 |
| M2 exit | SW road (overview) vs SE road | SE | Kildread, Prima |
| M3 exit | Truck to the north vs east of the dam | Both reported; north in 3 sources | Kildread vs Prima |
| M11 exit | Eastwards (TA) vs west/north-west | W/NW | Prima, oocities, Kildread, NB |
| M12 alarm | Already sounded vs off | Off at the start; the team is being hunted; two zones | gap 8 |
| M12 vehicle | Kübelwagen (Prima) vs "plain old truck" (oocities) | Kübelwagen, not fully settled | — |
| M12 prisoner | Informer vs Claude Gilbert (ES Wikipedia) | Informer (Gilbert is M17) | — |
| M15 general's walk | Happens vs never happens | Unresolved; model a garden loop with a pause at the NE corner | — |
| M15 cemetery | North (Kildread) vs NE (gap 4) | North/north-east cemetery, NW road out | — |
| M16 sappers | 4 vs 3 | 4 | majority |
| M20 objective | "Destroy the nuclear programme" vs HQ + 2 V2s | HQ + 2 V2s | Prima, German FAQ |
| M20 exit | SW gate / western gate / south | SW gate | Prima, fandom |
| M20 remote bombs | 1 (Prima) vs 2 (oocities) | Unresolved | — |
| M20 tank guard | Anti-tank gun / mortar / heavy cannon | Unresolved | — |
| McRae's first name | George (Prima) vs Gregor | Gregor (in-game text) | gap 3 |
| M10 failure | Scripted fail on alarm vs tanks killing you | Tanks killing you [inferred] | gap 3 |
| M10 Stukas | Optional vs required | No merit either way | gap 7 |
| Teams | "All six" (coregamers) for M4, M7, M9-M11 | Smaller teams (Prima, Kildread, fandom) | — |
| Spy starts disguised | Unclear | M9, M11, M12, M17 | gap 8 |
| `MAPA0002.MIS` | "Mission 2 script" | It is Mission 4 | gap 7, gap 8 |
| In-mission music | None / "subtle and minimal" / MIDI cue file | Near-silent missions with short cues; `MUSICA.XMI` exists | gap 8 |
| Marine's accent | Australian bio vs cockney performance | Unresolved | — |
| Green Beret's accent | Irish bio vs "dat" performance | Unresolved; pick one | — |
| Heights | ES Wikipedia vs CommandosHQ (GB 2.10 m vs 6'5"; Spy 1.79 m vs 6'4") | Unresolved | — |
| Sniper's Olympic gold | Munich (CommandosHQ) vs Berlin (fandom) | Berlin (1936 Games) | — |
| Spy's tally | 30+ other vehicles vs 50 | Unresolved | — |
| Origins release / score | 9 vs 10 April 2025; Metacritic 72 vs 71 | Unresolved | — |
| BCD handcuffs | Everyone vs GB and Spy | GB and Spy | manual, files |
| BCD Lee-Enfield ammo | Unlimited vs 50 | Unresolved (file 50) | — |
| BCD start rank | Major vs Sergeant | Unresolved; Major fits the 24-star maximum | — |
| BCD M4 charges | 3 / 4 / file 4 bombs + 2 grenades | File | gap 6 |
| BCD M6 planes | File 5 + 3 + jet vs Ruetli vs fandom | File counts; types unresolved | gap 6 |
| BCD par tick rate | 25 Hz vs 20 Hz | Unresolved; both shown | — |

---

## 18. Open questions

- Retail values the demo executable cannot give: the par-to-stars and damage-to-stars thresholds; the retail password alphabet and keys; the retail `VISTAELIPTICA` global; whether retail ends a mission immediately when a commando dies.
- The 18 unpublished BEL `PAR_TICKS` values and the M5-M20 `.MIS` files (zones, barracks wiring, exact loadouts): readable from an owned copy of the game.
- Enemy damage per hit (rifle, MP40, MG nest), whether weapon-table field `+0x28` is damage, the SMG spread arc, the grenade blast radius, crawl speed, whether patrol `.VEL` is absolute; traceable in the demo disassembly (`acDisparar` projectile creation, `MotorGranada` explosion at `<addr>`).
- What the BEL warning flash shows; the zoom steps; the F2-F7 layouts per key press; whether a 7th (guest) portrait slot exists; the `ALT` field of `Vista01`; the `0x13b3` focus-mode trigger; the meaning of `.NOVERHASTA`.
- Footprint fade time, siren restart behaviour, reinforcement respawn delay, and which noise levels trip zone sensors.
- Body and decoy alarm behaviour per patrol (`REACT_EVENTS` scripting).
- M12's vehicle, M15's timing, M20's loadout and gun, McRae's name in other language versions.
- BCD: KO duration, stone and cigarette radii, Lee-Enfield range, animal stats.
- A full transcription of the voice clips from the "All sounds" rip.

---

## 19. Sources

### Primary game materials and data
- *Commandos: Behind Enemy Lines* US manual (Eidos, 1998): https://retrogamer.biz/wp-content/uploads/2015/10/Commandos-Behind-Enemy-Lines-manual.pdf ; scan and OCR https://archive.org/details/commandos-behind-enemy-lines-manual_202408 ; replacementdocs scan http://www.replacementdocs.com
- *Commandos: Prima's Official Strategy Guide* (Michael Knight, 1998): https://archive.org/details/Commandos_Behind_Enemy_Lines_Prima_Official_eGuide (text: https://archive.org/stream/Commandos_Behind_Enemy_Lines_Prima_Official_eGuide/Commandos_Behind_Enemy_Lines_Prima_Official_eGuide_djvu.txt ; PDF: https://archive.org/download/Commandos_Behind_Enemy_Lines_Prima_Official_eGuide/)
- Official BEL demo (May 1998; `Comandos.exe`, `WARGAME.DIR`, `.MAC`, `GLOBAL.STR`): https://archive.org/details/CommandosBehindEnemyLinesDemo
- Retail M1 mission file (Krogell's 1998 mod): https://github.com/mwaf/cbel
- herbert3000 modding archive: https://herbert3000.github.io/files/Mods/ModExamples.zip (retail `MAPA0002.MIS` = M4; InterfaceMod WADs), https://herbert3000.github.io/files/Mods/MISSION1.zip, https://herbert3000.github.io/files/Misc/userDefineLang.xml, https://herbert3000.github.io/files/Tutorials/C1/MIS_keywords_1.pdf, https://herbert3000.github.io/files/Tutorials/C1/MissionEditingTutorial.pdf
- *CommandosFileTypes.pdf*: https://retrogamesvault.com/commandosmod/downloads/CommandosFileTypes.pdf ; *BCD_SEC_Format.txt*: https://retrogamesvault.com/commandosmod/downloads/BCD_SEC_Format.txt ; https://sites.google.com/site/commandosmod/downloads
- *Beyond the Call of Duty* US manual: https://store.steampowered.com/manual/6810 (also an OCR copy on archive.org)
- BCD retail mission data (French Steam `DATOS`): archive.org item `commandosbtcodfr` (`DATOS+VIDEO.zip`); BCD demo: archive.org item `CommandosBeyondTheCallOfDutyDemo`
- Steam store pages: https://store.steampowered.com/app/6800/ (BEL screenshots), https://store.steampowered.com/app/1100410/Commandos_2__HD_Remaster/
- Official soundtrack: https://music.apple.com/us/album/commandos-behind-enemy-lines/1324154709
- "Commandos – Behind Enemy Lines – All sounds": https://www.youtube.com/watch?v=PN2A5yaexQY

### Guides, FAQs and walkthroughs
- Kildread2, FAQ/Walkthrough (GameFAQs #2256): https://gamefaqs.gamespot.com/pc/63451-commandos-behind-enemy-lines/faqs/2256 (read via Wayback; mirrors https://the-spoiler.com/ACTION/Eidos.interactive/commandos.1.html and https://coregamers.com/walkthrough/commandos-behind-enemy-lines)
- Ruetli_1291, German FAQ (GameFAQs #64751): https://gamefaqs.gamespot.com/pc/63451-commandos-behind-enemy-lines/faqs/64751 (archived http://web.archive.org/web/20210120004748/https://gamefaqs.gamespot.com/pc/63451-commandos-behind-enemy-lines/faqs/64751)
- Ruetli_1291, BCD German FAQ (GameFAQs #64857)
- Dutch FAQ (GameFAQs #22515): https://gamefaqs.gamespot.com/pc/63451-commandos-behind-enemy-lines/faqs/22515
- Varkovsky, BCD FAQ (GameFAQs #9115): https://gamefaqs.gamespot.com/pc/958234-commandos-behind-enemy-lines-beyond-the-call-of-duty/faqs/9115 (Wayback: http://www.gamefaqs.com/computer/doswin/file/130794/9115)
- eggie's max-merit walkthroughs: https://www.metamud.org/~eggie/commandos/ (mis1 … mis17)
- oocities walkthroughs: https://www.oocities.org/timessquare/castle/9308/commandos/comlev01.htm (through comlev20.htm)
- alt.games.commandos FAQ v5.0 (Awpy/Iakovos, 2004), local copy
- CommandosHQ: https://commandoshq.net/greenb_profile.php, sniper_profile.php, diver_profile.php, sapper_profile.php, driver_profile.php, spy_profile.php, https://commandoshq.net/bel_hotkeys.php, https://commandoshq.net/bel_tips.php, https://commandoshq.net/bel_weapons.php (and bel_weap_*.php), https://commandoshq.net/bel_bugs.php, and the `bcod_*` pages
- Super Adventures in Gaming, "Commandos: Behind Enemy Lines (PC)" (2012): http://superadventuresingaming.blogspot.com/2012/07/commandos-behind-enemy-lines-pc.html
- Steam community: merit https://steamcommunity.com/app/6800/discussions/0/350542683194492837/ ; passwords https://steamcommunity.com/app/6800/discussions/0/666826703364228323/ ; hotkeys https://steamcommunity.com/app/6800/discussions/0/627457521164694485/ ; sergeant's shout https://steamcommunity.com/app/6800/discussions/0/1489987634022971536/ ; BCTD voices https://steamcommunity.com/app/6810/discussions/0/6400272499512230261/ ; keyboard-shortcuts guide https://steamcommunity.com/sharedfiles/filedetails/?id=681184406 ; cheats and passwords guide https://steamcommunity.com/sharedfiles/filedetails/?id=316775092
- Cheats and passwords: https://www.cheatbook.de/files/comdcc.htm ; https://www.absolutcheats.com/pc/commandos-behind-enemy-lines-cheats ; https://www.cheatcc.com/pc/cbel.html (search snippet only) ; https://gamedevtraum.com/en/game-and-app-development-with-unity/video-game-analysis/commandos-behind-enemy-lines-all-missions-passwords-and-gameplay/

### Wikis and references
- Wikipedia EN: https://en.wikipedia.org/wiki/Commandos:_Behind_Enemy_Lines ; https://en.wikipedia.org/wiki/Commandos:_Beyond_the_Call_of_Duty ; https://en.wikipedia.org/wiki/Commandos_(series) ; https://en.wikipedia.org/wiki/Pyro_Studios ; https://en.wikipedia.org/wiki/Real-time_tactics ; https://en.wikipedia.org/wiki/Commandos_2:_Men_of_Courage ; https://en.wikipedia.org/wiki/Commandos:_Origins
- Wikipedia ES: https://es.wikipedia.org/wiki/Commandos:_Behind_Enemy_Lines ; https://es.wikipedia.org/wiki/Commandos:_Beyond_the_Call_of_Duty ; https://es.wikipedia.org/wiki/Commandos_(serie) ; https://es.wikipedia.org/wiki/Pyro_Studios ; https://es.wikipedia.org/wiki/Gonzo_Su%C3%A1rez
- PCGamingWiki: https://www.pcgamingwiki.com/wiki/Commandos:_Behind_Enemy_Lines
- Commandos fan wiki: https://commandos.fandom.com/wiki/Commandos:_Behind_Enemy_Lines ; https://commandos.fandom.com/wiki/Commandos:_Beyond_the_Call_of_Duty ; https://commandos.fandom.com/wiki/Category:Commandos:_Behind_Enemy_Lines_missions and the 28 mission pages (e.g. https://commandos.fandom.com/wiki/Baptism_of_Fire … https://commandos.fandom.com/wiki/Operation_Valhalla, https://commandos.fandom.com/wiki/Stop_Wildfire) with their full maps and briefing stills ; character pages https://commandos.fandom.com/wiki/Jack_O%27Hara, https://commandos.fandom.com/wiki/Samuel_Brooklyn, https://commandos.fandom.com/wiki/Francis_T._Woolridge, https://commandos.fandom.com/wiki/James_Blackwood, https://commandos.fandom.com/wiki/Thomas_Hancock, https://commandos.fandom.com/wiki/Rene_Duchamp, https://commandos.fandom.com/wiki/Commandos ; quote pages https://commandos.fandom.com/wiki/Jack_O%27Hara/Quotes, https://commandos.fandom.com/wiki/Samuel_Brooklyn/Quotes ; https://commandos.fandom.com/wiki/Montague_Smith ; https://commandos.fandom.com/wiki/Merit ; https://commandos.fandom.com/wiki/File:Merit_creen_.png ; https://commandos.fandom.com/wiki/Difficulty ; https://commandos.fandom.com/wiki/Fixing_Commandos ; https://commandos.fandom.com/wiki/Pyro_Studios ; https://commandos.fandom.com/wiki/Enemies_and_Their_Kinds (C2/C3 scope) ; https://commandos.fandom.com/wiki/Submachine_gun ; https://commandos.fandom.com/wiki/Enemy_uniform ; https://commandos.fandom.com/wiki/Inflatable_Raft ; Alsatian, Barracks, Tank Depot, Bunker, Jail, Guard Tower, Machine Gun Nest pages ; Spanish list https://commandos.fandom.com/es/wiki/Misiones_de_Commandos:_Behind_Enemy_Lines
- Commandos Modding Wiki: https://commandosmodding.fandom.com/wiki/Commandos/SEC_file ; /Commandos/Mission ; /Commandos/Patrols ; /Commandos/BANPE_BAP ; /Commandos/BICHOALIADO ; /Commandos/UNIFORME ; /Commandos/ZODIAC ; /Commandos/Vehicles ; /Commandos_2/Data_files (all under https://commandosmodding.fandom.com/wiki/)
- Roman G's mission-editing notes (Wayback): http://www.strategyplanet.com/commandos/commandos.html
- TV Tropes: https://tvtropes.org/pmwiki/pmwiki.php/Characters/Commandos ; All The Tropes: https://allthetropes.org/wiki/Commandos
- DoblajeVideojuegos (Spanish cast): https://www.doblajevideojuegos.es/fichajuego/commandos-behind-enemy-lines ; La Cueva de los Clásicos: https://cuevadeclasicos.org/comunidad/temas/sonidos-commandos-tras-las-lineas-del-enemigo.12767/

### Reviews, history and interviews
- GameSpot review (Greg Kasavin, 1998): https://www.gamespot.com/reviews/commandos-behind-enemy-lines-review/1900-2538454/ (archived: https://web.archive.org/web/2005/http://www.gamespot.com/pc/strategy/commandosbehindenemylines/review.html ; http://web.archive.org/web/20100606032726/http://www.gamespot.com:80/pc/strategy/commandosbehindenemylines/review.html)
- IGN (Trent C. Ward, 1998): https://www.ign.com/articles/1998/09/01/commandos-behind-enemy-lines (archived: https://web.archive.org/web/20230818163635/https://www.ign.com/articles/1998/09/01/commandos-behind-enemy-lines)
- Computer Gaming World #173 (Dec 1998), pp. 406-407: https://www.cgwmuseum.org/galleries/issues/cgw_173.pdf
- Metacritic user reviews: https://www.metacritic.com/game/commandos-behind-enemy-lines/user-reviews/
- BCD reviews via Wayback: GameSpot (Kasavin), CGSP, Electric Playground, GamePro, Gamecenter
- The Games of 1998: https://gamesof1998.com/home/commandos ; drew1440: https://drew1440.com/2022/02/08/commandos-behind-enemy-lines/
- Vandal retro feature: https://vandal.elespanol.com/retro/commandos-behind-enemy-lines
- Arcade Attack interviews: https://www.arcadeattack.co.uk/jon-beltran-de-heredia/ ; https://www.arcadeattack.co.uk/ignacio-perez-dolset/
- Gonzo Suárez interviews: http://deusexmachina.es/entrevista-a-gonzo-suarez-desarrollador-de-videojuegos/ ; https://gamereport.es/hablamos-con-gonzo-suarez/ ; Xataka: https://www.xataka.com/videojuegos/desarrollar-videojuegos-como-fuesen-peliculas-funciona-asi-fue-como-gonzalo-suarez-gonzo-arraso-saga-commandos
- 421.news: https://www.421.news/en/commandos-1998-pyro-studios-en/ ; ComputerEmuzone: https://computeremuzone.com/ficha/763/commandos-behind-enemy-lines?l=en
- Retro Gamer ES #25, "Commandos: compases de guerra"; Jaume Esteve, *Boinas Verdes: De Commandos a Pyro Studios* (2021)
- Schnittberichte (German USK 16 cuts): https://www.schnittberichte.com/schnittbericht.php?ID=3583
- otenko, resolution fix: https://modelrail.otenko.com/electronics/commandos-behind-enemy-lines-resolution-fix
- Revora forums: https://forums.revora.net/topic/106959-noisy-mother-nature-option/ ; https://forums.revora.net/topic/109233-modding-commandos-1-a-few-questions/ ; https://forums.revora.net/topic/102378-commandos-bel-vol-file-how-do-i-handle-depth-sorting-and-rendering-in-a-map/ ; https://forums.revora.net/topic/109902-commandos-2-fov/ ; https://forums.revora.net/topic/85903-commandos-2-destination-paris-official-discussion/page-57 ; …/page-70 ; https://forums.revora.net/topic/79893-commandos-2-destination-paris-140/ ; https://forums.revora.net/topic/105274-want-to-make-your-own-commandos-game-heres-something-that-can-help/

### Remakes, code and genre design
- https://github.com/martinstarman/open-commandos ; https://github.com/michi84o/WargameLib ; https://github.com/gokselgoktas/nme ; https://github.com/topics/commandos-games ; https://github.com/ammarrmalik185/Commandos-Remake ; https://github.com/joscanper/unity_coneofsightfx ; https://github.com/d-bucur/godot-vision-cone ; https://rich-p.itch.io/commandos
- Commandos: Origins: https://www.kalypsomedia.com/post/commandos-origins-faq ; https://www.thesixthaxis.com/2025/04/09/commandos-origins-review/ ; https://gamingbolt.com/commandos-origins-review-an-isometric-blast-from-the-past ; Commandos 3 HD: https://www.gematsu.com/2022/06/commandos-3-hd-remaster-announced-for-ps4-xbox-one-switch-and-pc
- Mimimi: https://www.gamedeveloper.com/design/game-design-deep-dive-dynamic-detection-in-i-shadow-tactics-i- ; https://www.gamedeveloper.com/business/postmortem-mimimi-s-i-shadow-tactics-blades-of-the-shogun-i- ; https://www.gdcvault.com/play/1025239/-Shadow-Tactics-Postmortem-Commandos ; https://www.youtube.com/watch?v=4h2ZvfYjHp0 ; https://www.gamedeveloper.com/design/designing-the-real-time-stealth-and-combat-of-i-desperados-iii-i- ; https://www.gamedeveloper.com/design/how-shadow-gambit-the-cursed-crew-was-able-to-make-save-scumming-a-central-mechanic ; https://www.pcgamer.com/real-time-stealth-game-shadow-tactics-is-a-fun-ode-to-quicksaving/ ; https://www.hardcoregaming101.net/shadow-tactics-blade-of-the-shogun/ ; https://godisageek.com/desperados-iii-character-guide-john-cooper/
- Techniques and libraries: https://www.redblobgames.com/articles/visibility/ ; https://github.com/isaac-mason/navcat ; https://github.com/isaac-mason/recast-navigation-js ; https://github.com/donmccurdy/three-pathfinding ; https://github.com/Mugen87/yuka ; https://github.com/gkjohnson/three-mesh-bvh ; https://threejs.org/examples/misc_boxselection.html

### Research working files
- Raw reports in `docs/research-raw/`: `overview.md`, `characters.md`, `controls.md`, `mechanics.md`, `missions.md`, `systems.md`, `remakes.md`, `visuals.md`, and gap follow-ups `gap-0.md` (vision cones, EXE), `gap-1.md` (reactions and alarms, EXE), `gap-2.md` (tick, speeds, damage, weapons, EXE), `gap-3.md` (missions 5-12), `gap-4.md` (missions 13-20), `gap-5.md` (BCD mechanics and keys), `gap-6.md` (BCD missions), `gap-7.md` (win/lose, scoring, passwords), `gap-8.md` (contradiction resolution).
- Scratchpad artefacts referenced by the reports (disassembly `gap0/all.asm`, password codec `pw/pw.py`, map images `refs/missions/`, Prima PDF, notes) live in the research session's scratchpad directory, not in the repository.
