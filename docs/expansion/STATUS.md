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
