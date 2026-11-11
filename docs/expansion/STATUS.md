# *Lights Out*: status

*Lights Out* is SHADOW SIX's own expansion campaign: eight original missions, 1943–1945. Its internal code id is
`BCD` (`campaign: 'BCD'`, `CONFIG.rulesets.BCD`). Every player-facing string says **LIGHTS OUT**.

## Mission registration contract

This section is for the mission builders. It is complete on its own: follow it and your mission appears in the
menus, the map table, the `?debug` level select, the career and the passwords. Nothing else in the shell needs to
change.

### 1. File and name

- One module per mission: `src/missions/expansion/eNN_<slug>.js`.
  - `NN` is your slot, `01` … `08`.
  - `<slug>` is your title in lower-case snake case: mission `e0N` titled *Your Title* is `e0N_your_title.js`.
- The module registers its own def when it is imported:

```js
/** LIGHTS OUT mission N: … (docs/expansion/e0N.md). */
import { registerExpansionMission } from './registry.js';

const def = {
  id: 'e0N', campaign: 'BCD', number: N, // your slot: 'e01' with number 1 … 'e08' with number 8
  title: 'Your Title', place: 'Town, Region, Country', date: 'YYYY-MM-DD',
  pin: { lat: 0.0, lon: 0.0 }, // the place's latitude and longitude in degrees
  context: 'One or two sentences in our own words: the first paragraph of the briefing.',
  // … the mission data (§2.2) …
  variants: { easy: { /* … */ }, hard: { /* … */ } },
};

registerExpansionMission(def);
export default def;
```

### 2. Required fields

#### 2.1 Registration and menu info

`registerExpansionMission` checks these fields. On any problem it throws at import, with one line per problem, so a
broken def fails every test at once.

| Field | Rule | Where it shows |
|---|---|---|
| `id` | `'e01'` … `'e08'`, matching `number` | everywhere; `?debug&mission=e0N` |
| `campaign` | `'BCD'` | the ruleset (`world.rules`), the LIGHTS OUT career |
| `number` | `1` … `8`: your slot. One mission per slot. | campaign order, the career, passwords, the level select |
| `title` | non-empty string | the menus, the map-table card, the briefing, the loading card, the debug tile |
| `place` | non-empty string, e.g. `'Town, Region, Country'` | the map-table card, the briefing header, the narration title card |
| `date` | ISO `'YYYY-MM-DD'` | the map-table card (`'1944-06-02'` shows as `Jun 2, 1944`), the briefing, the narration title card |
| `pin` | `{ lat, lon }` in degrees | the pin on the map table, the target on the briefing's Europe map |
| `context` | non-empty string: 1–2 sentences of situation, our own words | the first paragraph of the briefing |
| `variants` | `{ easy: {...}, hard: {...} }` (docs/bcd-plan.md §1.12) | the Skill screen's Easy / Difficult data |
| `dev` | absent: a campaign mission is never `dev: true` | |

In `variants`, each side may set `par`, `enemyPatch: { id: {...} }`, `routeSpeedMul`, `pauseMul` and any other def
key. Entries in `enemies`, `vehicles`, `interactables`, `items`, `commandos` or `structures` can be tagged
`only: 'easy'` or `only: 'hard'`. Hard is the default variant. Your solution must win on Hard and on Easy.

#### 2.2 Mission data

Write the mission data like m01–m20 (design-spec §7.3, `src/missions/schema.js`): `subtitle`, `theater`, `size`,
`seed`, `briefing: { historical, text, objectivesSummary }`, `baseTerrain`, `terrain`, `structures`, `commandos`,
`enemies`, `vehicles`, `interactables`, `objectives`, `extraction`, `par`, `cameraStart`, `lighting`, and so on.

- `theater` must have a backdrop still (`STILL_THEATERS` in `src/ui/menu-model.js`: `snow`, `temperate`, `desert`,
  `coast`, …).
- The def must pass `validateMission` with no errors and no warnings, on both Easy and Hard. The unit test
  `lights-out` checks this.
- Guests (Tonino `tonino`, Grethe `grethe`), new units and world mechanics are described in
  `docs/expansion/MECHANICS.md` and docs/bcd-plan.md §1.

### 3. The one import line

`src/missions/expansion/index.js` has one slot marker per mission, with a blank line after each. Add exactly one line
directly under your own marker:

```js
// e0N
import './e0N_your_title.js';
```

Touch no other line of that file, and do not edit `src/missions/index.js`. Several missions can land in any order
without merge conflicts.

A mission module must **not** import `src/missions/index.js` (nor anything that imports it). That import is
circular: `src/missions/index.js` imports `./expansion/index.js`, which imports your module, so its bindings are still
uninitialised while your module registers. A mission module imports only `./registry.js`, `../schema.js`, its own
scripts and data (`../scripts/…`, `../../art/…-dressing.js`, or files next to it), never `src/game.js` or a UI
module (`src/ui/…`). A git experiment proved this on the shipped file: two branches added e01 and e02 (adjacent
slots, the closest case) and merged cleanly. All eight branches also merged cleanly, one at a time in a scrambled
order, and as one octopus merge.

### 4. How the game picks the mission up

- **Mission lists.** `src/missions/index.js` adds every registered def to `MISSIONS` (after the BCD sandbox `b00`) and
  to `CAMPAIGNS.BCD`, in number order. `getMission('e0N')` finds it. The lists are live: a mission registered later
  (a test page) joins them in place.
- **Menus.** NEW GAME → SINGLE PLAYER → **LIGHTS OUT**.
  - The print beside it counts the registered missions: *n OF 8 READY*.
  - **START CAMPAIGN** opens once `e01` is registered. Until then it is disabled with *IN PREPARATION*. It goes to the
    Skill screen (Easy / Difficult), then to mission 1's briefing.
  - **MISSION SELECT** opens the map table on the LIGHTS OUT tab. It pins every registered mission at its `pin`. A slip
    on the sheet lists the slots still *IN PREPARATION*.
- **Unlocks.**
  - Mission 1 is always open.
  - A win unlocks the next number, if that mission is registered. While the next slot is empty, the debrief offers no
    NEXT MISSION.
  - `?unlock=1` (or `?dev=1`) opens every pin of the map table.
- **`?debug` level select.**
  - The *Lights Out* group lists the registered missions, numbered by `number`.
  - PageUp / PageDown run BEL M1–M20, then *Lights Out*, then the test maps.
  - `?debug&mission=e0N` loads `e0N` directly.
- **Career.**
  - LIGHTS OUT is its own career: `game.flows.BCD`, stored under `shadowsix.career.v1.BCD`. The BEL career is
    untouched.
  - It starts at **Major** (36 gold). It earns at most 3 gold per mission (+24), so **Field Marshal** is 60.
  - The Skill choice is stored in the career and builds every load from the menus.
  - Starting any LIGHTS OUT mission makes `game.flow` the LIGHTS OUT career, so the debrief, NEXT MISSION, PLAY AGAIN,
    CONTINUE and the main menu's LAST OPERATION follow it. Starting a BEL mission switches back.
- **Passwords.**
  - A win issues the password of the next mission (2–8). It carries the slot number, the Skill bit and the career's
    gold.
  - The PASSWORD screen takes BEL and LIGHTS OUT codes alike. A LIGHTS OUT code replays its mission.
  - A valid code for a slot that is still empty says *LIGHTS OUT MISSION n — IN PREPARATION*.
- **Briefing.**
  - The header and the narration title card read *Mission n. Title. Place. Date.* from the def.
  - Then come `briefing.historical`, `context` and `briefing.text`.
  - The Europe map centres on `pin`. The slides fall back to the theater's photo set.
  - The narrator reads the mission's clips from `assets/audio/narration/manifest.json` once they are recorded
    (`tools/audio/narration/build.sh WORK_DIR eNN`, docs/narration.md). The Colonel's tour captions need clips too:
    build `tour` as well. Without clips the briefing is silent, with no error.
- **Music.** The map-table theme and the start stinger follow the def's `theater`; the briefing plays the first
  briefing loop.

### 5. Tests a builder runs

Before you merge:

- `node tests/unit/run.mjs` passes with 0 failed. These tests touch every registered mission:
  - `lights-out` checks the contract and `validateMission` on Easy and Hard.
  - `narration` requires the mission's narration and tour clips once its briefing has text.
  - `apron-coverage` requires `tests/edges-void-eNN.test.mjs`, the one-line GPU test copied from
    `tests/edges-void-m01.test.mjs`.
  - `enclosure` requires every wall and fence to be closed.
  - `loading-stills` requires the theater to have a still.
  - `debug-options` checks the level order.
- GPU tests (headless Chromium; on this host run `export CHROME=<projects>/commandos-shots/loading/tools/chrome-nv.sh` first):
  - `node tests/run.mjs lights-out-shell`: the menus with your mission registered.
  - `node tests/run.mjs smoke`: every mission loads and plays 20 s.
  - `node tests/run.mjs edges-void-eNN`
  - `node tests/run.mjs debug-select`
  - `node tests/run.mjs eNN-solution`: your scripted solution wins with 0 detections and 0 exposures on Hard. The same
    plan also wins on Easy.
- Also add:
  - `tools/solutions/eNN.solution.mjs` and `tools/solutions/eNN.walkthrough.mjs`.
  - An entry in `tests/render-budgets.json`, then run `RENDER_BUDGET_MISSIONS=eNN node tests/run.mjs render-budget`.
  - A video-perf run in AUTO (`tests/video-perf-mission.test.mjs`): own tick ≤ 16 ms and 0 new programs mid-run.
  - The art standard of the base missions: `tools/audit/clipping.mjs` is clean, 3D trees, and the alignment and
    enclosure checks pass.

## Foundation audit: bcd-plan §3 NOW (N1–N13)

Audited on `feat/expansion-mechanics` (from master db856afba), 2026-11-10. Status: **done**, **partial** (what is
missing is said), **shell lane** (the running-game flow wiring, built on `feat/expansion-shell`). Unit tests are
`tests/unit/<name>.test.mjs`; GPU tests are `tests/<name>.test.mjs`. "caps" = `tests/unit/bcd-capabilities.test.mjs`.

| Step | Item | Status | Evidence |
|---|---|---|---|
| N1 | §1.0 flags in `CONFIG.rulesets.BCD`, all false under BEL; `disguiseRanks` (alias `sergeantsSeeThroughDisguise` kept) | done | `src/config.js` rulesets; bel-lock "every BEL ruleset flag is off"; rulesets "BEL flags off, BCD flags on" |
| N1 | `CONFIG.bcd` (§1.14) | done | `src/config.js` `bcd` (+ `ostrich.chase/calm`, `animals.scare` added) |
| N1 | `campaigns` filtering in the ability registry and loadouts | done | `abilities/registry.js` abilitiesForRole/abilityInCampaign; `items.js` spawnInventory/itemInCampaign; rulesets "abilities and items are campaign-scoped" |
| N1 | BEL lock test (hotkey map, ability ids per role, loadouts, flags) | done | bel-lock (5 cases) |
| N2 | `rules.hotkeys` map + `hotkeyFor()` | done | `engine/hotkeys.js` hotkeyFor / keyLabel / abilitiesForCode; bcd-hotkeys "the §2 table", "each BCD key arms the right def" |
| N2 | HUD key labels, help screen | done | `ui/knapsack-model.js` keyLabel; `ui/help.js` → `ui/bcd-ui.js` bcdHelpRows; bcd-hotkeys "reach the knapsack labels and the help screen" |
| N2 | tour reads the layout | done (n/a) | the Colonel's tour (`ui/tour.js`) shows no keys |
| N2 | per-role key uniqueness under BCD; BEL map unchanged | done | bcd-hotkeys "never repeated inside one role's kit"; bel-lock "BEL hotkey map … pinned" |
| N3 | STUNNED, BOUND, PUPPET brain states | done | `ai/bcd-brain.js` bcdPre (called from enemy-brain update); BCD_BRAIN_STATES in `ai/bcd-enemy.js` |
| N3 | enemy fields (`koT` = stunnedT, `ko: 'bound'`, `puppetOf`, `cigs`, `uniformTaken`) + save/load | done | `ai/bcd-enemy.js` bcdSerialize / bcdDeserialize / bcdPostRestore; bcd-ko "save/load round-trips a stunned man mid-KO"; GPU bcd-saveload |
| N3 | wake → alarm; comrade frees → both alarm; stunned man found = body alarm + revive | done | bcd-brain wake / reviveStep / bcdScan; bcd-ko (wake, freed, revive); bcd-review "one ko-found … no livelock", "runs to his alarm point" |
| N4 | `knockout` X (Fist / Blackjack / Chloroform), `handcuff` J | done | `abilities/bcd-melee.js`; bcd-ko (9 cases) |
| N4 | aware-target rule, patrol immunity, timer reset, cuff only when stunned, pack moves on cuffing | done | bcd-enemy koLands / koImmune / cuff; bcd-ko "aware target", "patrol members… immune", "resets the timer", "cuffs: only on a stunned man" |
| N5 | `stone` Y, `cigarettes` V, arcs, look → investigate after 3 in 20 s | done | `abilities/bcd-throw.js`; `ai/bcd-reactions.js` stoneLanded; bcd-lures (3 stone cases) |
| N5 | near-band pack pickup with the 3 s kneel; nearest only; aware / Gestapo ignore; H loots packs | done | bcd-reactions cigsStep; bcd-lures (3 pack cases) |
| N6 | `puppet` R, order routing (plain moves go to the puppet), release | done | `abilities/bcd-puppet.js`; `entities/commando.js` issue; bcd-spy-driver puppet cases; bcd-review "selecting another man releases the puppet" |
| N6 | blue range disc | done | `render/bcd-overlay.js`; GPU bcd-sandbox "puppet disc / knock-out arcs drawn" |
| N6 | doors and `use` machines | done | bcd-spy-driver "walk him through a door"; caps "puppet works machines" (switch, lever, bridge switch, lift), "winch" |
| N6 | Driver + puppet vehicle | partial | the puppet walks to an empty vehicle and boards it, and the Driver can board and drive; but the link breaks when the Driver boards (the puppet raises the alarm) and the "enemies ignore the vehicle" rule is not built. No mission needs it now |
| N6 | rank-based distract; loss rules (range, LOS, controller seen / shot, house) | done | `ai/bcd-ranks.js` puppetCanDistract; bcd-brain puppetStep; bcd-spy-driver "loss rules", "rank decides"; bcd-review "walks up to a soldier before talking" |
| N7 | `hanger` T, wardrobe + U cycle | done | bcd-melee hanger; `entities/wardrobe.js`; bcd-spy-driver "hanger + wardrobe" |
| N7 | `disguiseRanks` recognition matrix; Gestapo never distracted; BEL path unchanged | done | bcd-ranks recognises / distractable; bcd-spy-driver (rank table, perception, distract); bel-lock "BEL rules ignore stones and ranks" |
| N8 | `rifle` E (Lee-Enfield), SMG on W, `driverClub` | done | `abilities/bcd-guns.js`; config hotkeys; bcd-spy-driver "Lee-Enfield (E)" (27 m kill, 28 m refused, 2.5 s, pistol noise) |
| N9 | guest roles with their kits and civilian cover | done | renamed: `grethe` (pocket pistol `beretta`, lipstick, packs) and `tonino` (stones, packs); bcd-units (5 guest cases) |
| N9 | keys 7 / 8; join triggers | done | `engine/input.js` commandoForKey; `joinsAt` (bcd-enemy installBcdSystems); bcd-mechanics "guests join when a commando reaches them"; caps "jail start" |
| N10 | `gestapo`, `lieutenant`, `zookeeper`, `snitch`, `pow` | done | `ai/archetypes.js`, bcd-enemy LOOK / BCD_WEAPON, bcd-brain bcdOnSeen; bcd-units (zookeeper, snitch); caps "pins" (lieutenant fights, Gestapo 1.25× per hit) |
| N10 | `animal-brain.js`: lion, ostrich, chicken; dog BCD tuning | done | `ai/animal-brain.js`; bcd-units (lion, ostrich, chickens, dog) |
| N11 | `seaMine`, `pushable` (wagon on rails, free tank) | done | `entities/bcd-interactables.js`; bcd-mechanics (sea mine, wagon, fuel tank) |
| N11 | `lift` | done | bcd-mechanics "lift"; caps "lift between levels" (stop heights), "winch" |
| N11 | `drawbridge` + switch | done | bcd-mechanics "drawbridge"; caps "boats and patrols", "save / load" |
| N11 | `jail`, `knapsack`, `animalZone` (`pen`), pen gate | done | BEL jail door + caps "jail start"; bcd-mechanics "knapsack"; caps "pen gate" |
| N12 | Commando Warnings (blue / red portraits) and its option | done | `ui/bcd-ui.js` CommandoWarnings; `ui/topbar.js`; bcd-flow "Commando Warnings"; caps "pins". The option is the GAME PREFERENCES "COMMANDOS WARNING" toggle (shared with BEL, default on), not a separate BCD-only row |
| N12 | Skill screen | done (module) / shell lane (flow) | `ui/menus.js` showSkill, `core/flow.js` setDifficulty; bcd-flow "Skill screen choices". New Game → expansion → Skill → campaign: **shell lane** |
| N12 | `variants` merge in `schema.js` | done | applyVariant; bcd-hotkeys "Easy/Hard: variant merge"; bcd-sandbox (unit) "b00 … variants" |
| N12 | BCD career (Major 36, cap 24, separate key) | done (module) / shell lane (live game) | `core/flow.js` (careerStartGold, maxGold cap, key `shadowsix.career.v1.BCD`); bcd-flow "career". The career in the running game: **shell lane** |
| N12 | BCD passwords (difficulty bit; replays one mission) | done (module) / shell lane (menu) | `core/passwords.js` encode/decodePassword; bcd-flow "password". Passwords from the menu: **shell lane** |
| N13 | BCD sandbox b00 (`campaign: 'BCD'`, dev only, every commando, both guests, every unit, animal and mechanic, Easy/Hard) | done | `src/missions/m00_bcd_sandbox.js`; bcd-sandbox (unit, 2 cases); GPU bcd-sandbox, bcd-saveload. The foundation's new capabilities (jail start, winch, deliver, escort / flee, alarm-fail zones) have unit tests, not stations |
| N13 | BEL missions still load with no BCD ability | done | GPU bcd-sandbox (m00: no BCD ability, X = knife); bel-lock; bcd-mechanics "inert under BEL" |

## Finished by the foundation

Commits on `feat/expansion-mechanics`; every new behaviour is behind the BCD ruleset or BCD-only data, and the BEL
suites pass unedited. Tests: `tests/unit/bcd-capabilities.test.mjs` (15 cases).

- **Guests renamed** to our own characters, ability sets unchanged: `natasha` → `grethe` (Grethe Holm, "Lark"),
  `skopje` → `tonino` (Tonino Esposito); the pistol label is "Pocket pistol" (id `beretta`). The b00 briefing clip was
  re-rendered with the narration pipeline.
- **Jail start**: `jailed: '<jail id>'` on any commando spawn (shorthand for `jailed` + `jailId`).
- **Puppet on machines** proven (switch, lever, bridge switch, lift); a guard who sees a machine work raises nothing.
- **Winch** (`kind: 'winch'`): sends its target lifts to their other stop; the bridge switch can target a lift too.
- **Lift between heights**: per-stop height (`a: [x, z, y]`, `aY`/`bY`, default the ground); save/load of the cage
  and a ride in progress.
- **Drawbridge**: a lowered span blocks boats (`grid.boatBlock`, read by `Vehicle.passableAt` for boats); a patrol
  whose route crosses a raised span waits at its edge (brain state `BRIDGE`); save/load restores the span.
- **Pen gate** (`PenGate`): its leaf blocks and clears its gap in the fence (before, an open gate let nothing out);
  loose ostriches roam (`roam`), walk up to people, kick soldiers as well as commandos, give up 10 m from the start
  of a chase and leave a kicked soldier alone for 8 s; the soldier runs clear, watches 4 s, goes back (no alarm).
- **Alarm-fail zones**: `alarmFail.zones`, `onFail`, and the `mission:alarmFail` event for a scripted volley.
- **`deliver` objective** (capture alive / escort to a point; `world.ai.fled` remembers those who left the map).
- **Escort / flee**: guest `follow: 'team'`; `flee: {to, when, leave}` spawn field and the `flee` trigger action.
- **Pins**: Commando Warnings option row and default, the lieutenant fights, the Gestapo Luger's 1.25× per hit.
- Docs: `docs/expansion/MECHANICS.md` (builder's table), bcd-plan boundary note, §1.8 rewrite, §1.10 rows, LATER
  steps pointing to docs/expansion/; guest mentions in design-spec, bodies-design, realism-pipeline, clipping-audit.

**Not built (not needed by the mechanics list):** the Driver + puppet vehicle rule (N6, partial above).
