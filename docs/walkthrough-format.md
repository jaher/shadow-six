# Walkthrough files (debug VIDEO MODE)

Debug mode's **WATCH WALKTHROUGH** plays a mission's scripted solution live in the game, as a guided film: a camera
director frames each moment, a caption panel narrates who does what and why, and a chapter card opens each stage. It
reads two files per mission, both in `tools/solutions/`:

| File | Who writes it | What it holds |
|---|---|---|
| `mNN.solution.mjs` | the solution | `STAGES` + `solve(D, ctx)` (driver API: `tools/solutions/driver.mjs`). Stage ids and `D.checkpoint('<id> …')` calls are the anchors the walkthrough hangs on. |
| `mNN.walkthrough.mjs` | the solution's author too | chapter titles, one narration step per checkpoint, optional camera and cone cues. Text only: no game code, no imports needed. |

**Nothing else to register.** Video mode lists every mission that has a `mNN.solution.mjs`; the walkthrough file is
picked up next to it (the dev server lists the folder, the web build bundles every `*.solution.mjs` /
`*.walkthrough.mjs` it finds). A solution without a walkthrough file still plays, with the stage titles and the
checkpoint names as captions. A mission without a solution shows "No walkthrough yet".

Check a file with `node tests/unit/run.mjs walkthrough` (it validates every `*.walkthrough.mjs` against its solution
and its mission). Format version: **1** (stable; new fields will only ever be optional).

## How the walkthrough maps onto a solution

- **Chapter** = a solution stage (`STAGES[i][0]`, e.g. `'A'`). Its card shows when the stage starts.
- **Step** = the stretch of play that ends at a checkpoint. Step `A2` is shown from the moment checkpoint `A1` is
  reached (or from its chapter's start, whichever is later) until `D.checkpoint('A2 …')` runs. So **write each step
  as what is about to happen**, leading up to its checkpoint: "The sergeant walks back and steps into the bear
  trap" for the checkpoint `A2 sergeant e1 trapped`.
- Put a checkpoint after every action worth narrating (a kill, a distraction, a vehicle boarded, a charge set, an
  objective). Checkpoint ids are a stage letter + a number (`A1`, `A2`, … `J2`; a suffix is fine: `G5b`), unique, in
  play order.
- A checkpoint the solution sets only on one branch (`if (...) D.checkpoint('G5b …')`) still gets its step. In a run
  that skips it the caption moves on at the next checkpoint, and a jump to it stops at the next one.
- Long waits (a patrol walking off, a cone sweeping past) need no step of their own: the director fast-forwards
  idle stretches when the viewer asks it to, and the caption stays on the step being waited for.

## The file

```js
// tools/solutions/m03.walkthrough.mjs
export const WALKTHROUGH = {
  version: 1,
  mission: 'm03',
  title: 'Reverse Engineering',             // shown on the opening card (default: the mission's own title)
  intro: 'Destroy the bunker, blow the dam and escape in the truck, without ever being seen.',
  chapters: [                                // one per STAGES entry, same ids, same order
    { id: 'A', title: 'The plateau', say: 'A patrol of three walks the plateau path. All three must go, silently.' },
    // …
  ],
  steps: [                                   // one per checkpoint, in play order
    {
      cp: 'A1',                              // the checkpoint this step leads up to
      who: 'sapper',                         // acting commando(s): role or [roles]
      say: 'While the patrol walks off east, the Sapper crawls onto its path and sets a bear trap; the Green Beret lays his decoy beside it, switched off.',
      look: [[97, 13], 'e1'],                // also frame these (optional)
      cones: ['e1', 'e2', 'e3'],             // draw these guards' vision cones during the step (optional)
    },
    {
      cp: 'A3', who: 'greenberet',
      say: 'When the two troopers calm down and walk back past the decoy, the Green Beret switches it on by radio. Both stop and stare at it.',
      cones: ['e2', 'e3'],
      beats: [                               // finer cues inside the step, fired by live events (optional)
        { on: 'greenberet:decoyToggle', look: ['decoy', 'e2', 'e3'], shot: true },
      ],
    },
    // …
  ],
  outro: 'Mission complete: three objectives, four commandos home, never spotted.',
};
```

### Fields

**Top level**

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | `1` |
| `mission` | yes | mission id (`'m03'`), same as the file name |
| `title` | no | opening card title (default: the mission's title) |
| `intro` | no | opening card text: the goal and the approach in one or two sentences |
| `chapters` | yes | one entry per solution stage, same ids, same order |
| `steps` | yes | one entry per `D.checkpoint` of the solution, same ids, same order |
| `outro` | no | text on the closing card after the win |
| `pitchAt(x, z)` | no | function → camera pitch in degrees for a view centred on (x, z); for maps where the game's 40° view hides men behind a cliff (M3 re-exports the film's `pitchAt` from `m03.cut.mjs`) |

**Chapter** `{ id, title, say? }`: `id` = the stage id; `title` = 2–6 words ("The plateau", "The bunker (objective
1)"); `say` = one sentence: the situation and the goal of this stage.

**Step** `{ cp, who?, say, look?, shot?, cones?, zoom?, beats? }`

| Field | Meaning |
|---|---|
| `cp` | the checkpoint id this step ends at (the first word of the `D.checkpoint()` name) |
| `who` | the acting commando: `'greenberet'`, `'sapper'`, `'diver'` (Marine), `'spy'`, `'driver'`, `'sniper'`, or a list. Shown as the caption's label; the camera follows him (aboard a vehicle: the vehicle). Omit when nobody acts (a guard walking into a trap): the camera then follows the commando the last order went to. |
| `say` | the narration: **who does what, and why**, 1–2 sentences, at most 240 characters. Name guards by their tag (e18) or their job ("the bunker gunner e34"). Present tense. No coordinates. |
| `look` | things to frame together with the actor: a guard's tag (`'e18'`), a commando role, any id from the mission file (structure, vehicle, interactable, marker, switch: `'dam_bunker'`, `'raft'`, `'fence_switch'`), `'decoy'` (the Green Beret's decoy), `'charge'` (the last armed charge), or a point `[x, z]` |
| `shot` | `true`: frame only `look`, not the actor (a guard's reaction, a building about to blow) |
| `cones` | guard tags whose vision cones are drawn during the step. Default: the guards in `look` plus every guard whose cone reaches within 6 m of the actor. `[]` = none. |
| `zoom` | `'close'` or `'wide'`: a hint for the framing (default: fit actor + look) |
| `beats` | a list of cues inside the step, each fired once, in order, by a live event (below) |

**Beat** `{ on, say?, look?, shot?, cones?, hold? }`: when `on` happens during the step, `say` (if any) replaces the
step's caption for the rest of the step, and `look` / `shot` / `cones` replace the step's camera cues for `hold`
seconds of game time (default: until the next beat or the end of the step).

`on` is one of:

| `on` | fires when |
|---|---|
| `'<role>:<ability>'` | that commando is given that ability order: `knife`, `harpoon`, `decoyDrop`, `decoyToggle`, `distract`, `trap`, `cutters`, `timeBomb`, `use`, `hand`, `drop`, `shovel`, `enterVehicle`, `leaveVehicle`, … (the ability ids of `src/abilities`) |
| `'<role>:<ability>>e18'` | the same, aimed at that target (`'diver:harpoon>e2'`) |
| `'<role>:move'`, `'<role>:run'`, `'<role>:crawl'` | that commando is sent somewhere (walking / running / crawling) |
| `'kill:<tag>'` | that guard dies |
| `'objective:<id>'` | that objective is done (`'objective:o1'`) |
| `'state:<tag>:<STATE>'` | that guard's brain enters `STATE` (`DISTRACTED`, `DECOY`, `ALERT`, …) |
| `'alarm'`, `'alarm:off'` | the alarm starts / dies down |

### What the director does on its own

You do not need cues for these; they happen in every mission:

- follows the acting commando (`who`, else the last ordered one), his vehicle while he rides;
- an ability aimed at someone or something (knife, harpoon, distract, use, enter a vehicle) frames the man and his
  target until the action ends;
- an armed time bomb is framed for the last seconds of its fuse and the blast; a finished objective is held on
  screen for a moment;
- a guard's cone is drawn while he is in `cones`, in `look`, or close to the actor;
- smooth pans and zooms only, `pitchAt` where the file gives one, and the player's own yaw, swung aside (30° or
  55°) only while a building would hide the men or the guards in the shot;
- the acting men always stay in the picture: when not everything fits even zoomed out, the farthest `look` targets
  are left out first.

### Style

- Say **why**, not only what: "The Spy chats up e18 from his west side, so e18 turns his back on the gate the Green
  Beret will crawl through." Not "Spy: distract e18".
- One step = one idea. Two or three short sentences at most; the viewer reads it at 1×.
- Use the commandos' names as the game shows them: the Green Beret, the Sapper, the Marine, the Spy, the Driver, the
  Sniper. Guards by tag (e18) or job (the bunker gunner).
- No numbers the viewer cannot see (coordinates, timings in ticks). Distances in metres are fine when they matter
  ("13 m from the bunker, inside the gunner's hearing").
