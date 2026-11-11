# SHADOW SIX: the BCD ruleset plan (expansion mechanics)

> **Boundary.** The expansion campaign is original: docs/expansion/ (README.md: the campaign; MECHANICS.md: what a mission
> builder can use; STATUS.md: what is built). The M1–M8 / [MIS] tags below are research notes on where the 1999 expansion
> used a mechanic, never a build plan. Its levels, mission data, briefings and named characters are not rebuilt.

The ruleset `'BCD'` (campaign id) carries the expansion-style mechanics, modelled on the 1999 expansion to *Commandos*; SHADOW SIX's own expansion missions run on it. This file lists every BCD weapon, gadget, ability, unit and mechanic. For each one it gives the exact behaviour and numbers, how it plugs into the ruleset architecture (ARCHITECTURE.md "Campaigns & rulesets"), and a phased build plan.

**Hard rule.** Under the `BEL` ruleset, behaviour stays **100% unchanged**. Every item below is gated by a `world.rules.*` flag, an ability's `campaigns: ['BCD']`, or BCD-only mission data. The BEL test suites must stay green without being edited. A new BEL regression test pins the BEL hotkey map, ability list and loadouts (§3, N1).

**Sources and tags.**
- [MAN]: the BCD manual.
- [HQ]: CommandosHQ.
- [VFAQ]: Varkovsky's FAQ.
- [RU]: Ruetli's FAQ.
- [DEMO]: the demo files.
- [MIS]: the retail mission files. Research is in `research-raw/gap-5.md` and `gap-6.md`, with a summary in research.md §11.
- [rec]: our own number or rule, used where the sources say nothing. Every [rec] value lives in one place, `CONFIG.bcd` (§1.14), so tuning never touches code.

Contents: §1 catalogue · §2 hotkeys · §3 phases (NOW / LATER) · §4 assets · §5 open points.

---

## 1. Catalogue

### 1.0 Ruleset flags (`CONFIG.rulesets.BCD`; every flag is `false` or absent under BEL)

| Flag | Turns on | § |
|---|---|---|
| `knockouts` | X: Fist, Blackjack, Chloroform; the `stunned` state; the wake-up timer | 1.1 |
| `handcuffs` | J: handcuffs; the `bound` state; comrades free a cuffed man | 1.2 |
| `puppet` | R: puppet control of a cuffed soldier | 1.3 |
| `stones` | Y: stone throw; look and investigate reactions | 1.4 |
| `cigarettes` | V: cigarette packs; looting packs; the walk-over-and-pick-up reaction | 1.5 |
| `spyChloroform` | the Spy's X is Chloroform | 1.1 |
| `spyUniformFromCaptives` | T: the hanger; the uniform wardrobe; U cycles through it | 1.6 |
| `disguiseRanks` (was `sergeantsSeeThroughDisguise`) | rank-based recognition of disguises (§1.6 table) | 1.6 |
| `driverClub` | the Driver's X is the Blackjack | 1.1 |
| `driverRifle` | E: the Lee-Enfield | 1.7 |
| `difficulty` | Easy/Hard data variants; the Skill screen | 1.12 |
| `hotkeys: {abilityId: key}` | the BCD key layout (§2); absent means the defs' BEL keys | 2 |
| `commandoWarnings` | the blue/red portrait warnings option | 1.11 |
| `careerStartGold: 36`, `maxGold: 24` | start at Major; Field Marshal at 24 stars | 1.13 |
| `pushables`, `seaMines`, `lifts`, `drawbridges`, `animals` | world mechanics; missions only use them when their data asks | 1.9–1.10 |

The existing `enemyAccuracyMul` and `enemyHearingMul` stay at 1. BCD has **no** global difficulty multipliers; difficulty is data (§1.12).

### 1.1 Knock-outs: X (`knockout`, one def per role, `group: 'melee'`, `campaigns: ['BCD']`)

| Commando | Name | Animation | Noise |
|---|---|---|---|
| Green Beret | **Fist** [MAN] | a punch to the jaw from behind, 0.6 s | 0 |
| Driver | **Blackjack** (the club) [MAN] | a swing to the back of the head, 0.6 s | 0 |
| Spy | **Chloroform** ("Ether" [HQ]) | the rag held over the mouth, 1.2 s; a longer hold, but in the Spy's style | 0 |

- **Reach:** the knife's reach (1.2 m). Walk to the target, then strike. Uses are **unlimited** [HQ].
- **Valid targets:** only **unaware** soldiers. That means an enemy whose brain state is not one of the **aware** states (`COMBAT`, `SEARCH`, `CHALLENGE`, `ARREST`, `REINFORCE`, `BODY`, `TRACKS`) and whose cone does not currently hold the attacker (the BEL "in the eyes" test) [MAN/HQ].
  - On an aware target the strike happens but has **no effect**: the "✗" cursor, and the swing plays and misses [HQ].
  - **Patrol members** (`squad` units with MP40s) cannot be knocked out [RU]. **Gestapo** can, when unaware.
  - **Animals** cannot be knocked out [rec].
- **Result:** the enemy's brain enters a new state `STUNNED`, falls, and drops his weapon beside him. He is an **unconscious body**:
  - He can be carried (GB, Spy, as in BEL) and hidden.
  - He has a **cigarette pack** to loot (§1.5).
  - His uniform can be taken with the hanger (§1.6).
- **Wake-up:** `CONFIG.bcd.koDuration = 30 s` [rec; the sources give none, and research suggested 20–40].
  - Knocking out a man who is still stunned resets the timer.
  - When he wakes **un-cuffed**, he stands, picks up his weapon and **raises the alarm** [MAN]. He runs to his zone's alarm point and shouts: the BEL alarm event with his zone as its source.
- **Found by comrades:** an enemy who sees a stunned man reacts as he would to a BEL **body** (alarm). He then walks over and revives him in 3 s [rec]. Both men stay alerted.
- **Visibility:** striking is a *suspicious act* (`visibleToEnemies: true`). A soldier who sees the knock-out raises the alarm, as with the knife.
- **AI and save:** add `stunnedT` to enemy state; save and load round-trip it. The HUD shows a small "zzz" timer ring above the body while it is selected or hovered [rec].

### 1.2 Handcuffs: J (`handcuff`; GB and Spy only; `campaigns: ['BCD']`)

- **Carriers:** only the **Green Beret and the Spy** [MAN, MIS, HQ]. The Driver must hand his clubbed man to one of them.
- **Count:** unlimited [MIS: no count field]; the HUD shows no number.
- **Target:** only a **stunned** (unconscious) soldier. Cuffing takes 1.5 s [rec] and is a suspicious act.
- **Result:** new brain state `BOUND`. The man sits against the nearest wall or on the ground, hands behind his back, and awake.
  - The wake-up timer is cancelled. He stays out of play **until seen by a comrade** [MAN].
  - Cuffing **automatically moves his cigarette pack** to the cuffer (§1.5) [MAN].
- **Freed:** an enemy whose cone (either band) contains a bound man walks to him. He frees him in 4 s [rec], and **both then raise the alarm** [MAN]. A freed man is unarmed until he picks his weapon up again from where he fell [rec].
- **Carry:** a bound man can be carried like a body (GB, Spy) [rec]. Dropping him keeps him bound.
- **Kill:** a bound man can be knifed or injected. The body is then an ordinary BEL body.

### 1.3 Puppet: R (`puppet`; every commando; `campaigns: ['BCD']`)

- **Who:** any commando, including the Driver [MAN, EP, GamePro]. Guests (Grethe, Tonino) cannot [rec].
- **Start:** press R, then click a **bound** soldier. The target must be within `CONFIG.bcd.puppet.range = 13.5 m` [rec: the pistol's range, after GameSpot's "within range of the commando's sidearm"] and in the commando's line of sight.
- **Display:** a translucent **blue disc** of radius 13.5 m around the controller, clipped by the LOS grid [MAN: "blue area"; EP: "blue circle"]. The puppet gets a blue selection ring.
- **Control:** while the puppet is active, right-click orders go to the puppet, not the commando. The commando stays where he is; press R again, Esc or select another man to release him. A released puppet sits down again, still bound [rec].
  - The puppet walks with his hands apparently free. Enemies read him as an ordinary soldier of his rank. He carries no weapon and cannot attack.
- **Uses [MAN]:**
  - **Doors:** he opens doors and walks through them (enemy door rules).
  - **Machines:** he can work any `use` interactable (switches, levers, the drawbridge switch, a winch, lifts). A soldier who sees a machine work raises nothing unless he sees who worked it (a puppet reads as one of his own).
  - **Vehicles:** he can drive an **empty** vehicle, but only with the Driver aboard as well: click the vehicle with the puppet, then board it with the Driver. The vehicle is ignored by enemies unless it does something suspicious (runs a man over, fires, drives into a restricted zone) [MAN].
  - **Distract (D while the puppet is active):** he talks to a soldier, who freezes and faces him like the Spy's distract. Who can be distracted depends on the puppet's rank [HQ]:

| Puppet rank | Can distract |
|---|---|
| Private (`soldier`, `sentry`, `trooper`) | privates only |
| Sergeant (`sergeant`, patrol NCO) | privates, sergeants and **patrols** |
| Officer (`officer`, `lieutenant`) | anyone except Gestapo [rec: Gestapo cannot be distracted, §1.6] |

- **Losing control [MAN]:**
  - **He leaves the controller's LOS or range:** control ends at once, the puppet frees himself (the bound state ends) and **raises the alarm** from where he stands.
  - **The controller is seen by any other enemy** (in either band): the same result. The check runs every AI tick.
  - **The controller is shot at:** the puppet runs off toward his zone's alarm point and raises the alarm.
  - **LOS and houses:** a puppet inside a house still counts as in sight. A controller inside a house counts as out of sight, so he cannot run a puppet from inside [MAN].
  - Only one puppet per commando at a time; each commando can run one [rec].
- **Implementation:** a new brain state `PUPPET` in `enemy-brain.js` that consumes a move queue instead of its route. Perception keeps running, so other enemies see him normally. Save/load stores `puppetOf`.

### 1.4 Stones: Y (`stone`; every commando and Tonino, **not** Grethe; `campaigns: ['BCD']`)

- **Count:** 50 per man in the mission data [DEMO, MIS]. The HUD shows no count; `CONFIG.bcd.stones.hiddenCount = 50` still decrements, so a runaway script cannot spam them [rec].
- **Throw:** targeting `point`, range `12 m` [rec], an arc with a 0.6 s flight [rec]. The stone lands with a small click (a level-1 noise of radius `4 m` [rec]); it is **not** a suspicious act.
- **Reaction [MAN; Varkovsky]:**
  - A soldier within `4 m` of the landing point, or hit by the stone, **turns and looks** at the point for 4 s [rec] (the BEL level-1 noise reaction), then resumes his route or sweep.
  - Each soldier counts stones that reached him in a rolling `20 s` window [rec]. On the **3rd** [rec: "several" / "a few throws"] he **walks over and investigates**: he goes to the last landing point, looks around for 6 s [rec] and returns. He is not alerted; the zone does not go to alarm.
  - Aware soldiers (§1.1) ignore stones. Posts with `holdsPost` only look, never walk [rec].
- **Pick-up:** thrown stones stay where they land as tiny props but cannot be picked up again [rec].

### 1.5 Cigarette packs: V (`cigarettes`; every commando and both guests; `campaigns: ['BCD']`)

- **Stock:** a commando's count starts at the mission value (usually 0) and is shown on the HUD icon ("CIGARETTES: n").
- **Sources [MAN, EP, DEMO]:**
  - **Cuffing** a soldier moves his pack to the cuffer automatically (§1.2).
  - **Bodies:** hovering a dead or unconscious soldier who still has a pack shows the **hand-holding-a-pack cursor**. Clicking with the hand (H) takes it in 0.8 s [rec].
  - **Ground:** packs lie on the map as pickups; H picks one up.
  - Every soldier carries one pack (`.TENGOTABACO 1`) unless the mission data says otherwise; dogs, animals and the zookeeper have none [rec].
- **Throw:** targeting `point`, range `10 m` [rec]. Not suspicious.
- **Reaction:** the pack works only if its landing point is inside a soldier's **near (light-green) band** at the moment it lands [MAN]. Ranges come from the soldier's profile (18 m near band for `soldier`).
  - That soldier **walks over and picks it up**: he leaves his route or post, walks to the pack (normal speed), kneels for 3 s [rec] to pick it up, lights up, and walks back. During the kneel his cone is lowered and shortened to the near band [rec]. This is the window to knock him out or slip past [MAN].
  - If several soldiers qualify, only the nearest goes [rec]; the pack then belongs to him (he can be looted again).
  - Aware soldiers (§1.1), MG gunners, crews and Gestapo ignore packs [rec]. The C2 rule "smokers ignore packs" is **not** used [gap-5].
  - A pack that lands outside every near band stays on the ground and can be picked up again.

### 1.6 The Spy: hanger (T), wardrobe (U), ranks and Gestapo

**Hanger: T** (`hanger`; Spy only; `spyUniformFromCaptives`)
- **Target:** a **stunned or bound** soldier (not a dead one [MAN: "knocked-out"; rec for bound]). Reach 1.2 m, 2.0 s [rec]. It is a suspicious act.
- **Result:** the Spy gains that soldier's uniform, keyed by the soldier's rank (§ table below). The victim is left in his underclothes (a texture swap) and stays stunned or bound. Unlimited uses [rec].
- **Also:** BEL clotheslines and uniform pickups still add a uniform. The zookeeper's uniform can only be taken with the hanger (M2) [VFAQ].

**Wardrobe: U** (`uniform` keeps its id and key)
- The Spy holds a list of uniforms: `spy.wardrobe = ['officer', 'soldier', 'zookeeper', …]`, with no duplicates.
- **U** puts on the next uniform in the list (1.5 s change [rec], unseen only, as in BEL). After the last one, U takes the uniform off (plain clothes), then starts again at the first [rec].
- The HUD icon shows the uniform he is wearing; a small counter shows how many he holds.
- **Losing a disguise:** a suspicious act in sight of any enemy strips the disguise (BEL rule). He keeps the uniform in his wardrobe and can put it back on out of sight [rec].

**Rank recognition** (`disguiseRanks`; replaces the placeholder flag `sergeantsSeeThroughDisguise`)

Each disguise and each viewer has a rank level: private 0, sergeant 1, officer 2, Gestapo 3. A viewer **recognises** the disguise when `viewerLevel > uniformLevel`, or when the viewer is Gestapo [MAN, VFAQ].

| Uniform worn | Level | Recognised by |
|---|---|---|
| Private (`soldier`) | 0 | sergeants (including patrol NCOs [VFAQ]), officers, Gestapo |
| Zookeeper | 1 [rec] | officers, Gestapo; it passes patrol sergeants [VFAQ] |
| Sergeant | 1 | officers, Gestapo |
| Officer | 2 | **Gestapo only** |
| Any | – | Gestapo always [MAN] |

- **Viewer levels:** `soldier`, `sentry`, `trooper`, `mg`, `crew`, `gunner`, `engineer`, `courier` are 0; `sergeant` and patrol leaders are 1; `officer`, `lieutenant` and `general` are 2; `gestapo` is 3. Dogs and animals ignore disguises entirely: a dog treats the Spy as a commando (BEL dog rule) [rec], and animals react to anyone (§1.9).
- **What recognition does:** perception returns `seen` as if `ignoreDisguise` were set, and the viewer reacts as he would to a commando (normal detection meter, then combat). It does not strip the disguise from other viewers [rec].
- **Distract (D):** works on every rank except Gestapo [MAN]. A Gestapo target shows the "✗" cursor.
- **Under BEL:** `disguiseRanks` is false, so perception skips the check. BEL disguise behaviour is unchanged.

### 1.7 The Driver's Lee-Enfield (E) and the SMG on W

**Lee-Enfield** (`rifle` ability, item `leeEnfield`; Driver only; `driverRifle`)
- **Shot:** hitscan, **one shot kills** (`dmg: KILL`) [MAN]. No aim delay beyond the sniper's 0.6 s [rec].
- **Range:** `27 m` [rec: between the pistol's 13.5 m and the sniper's 45 m; the sources give no number]. It fires at targets in LOS, like the pistol.
- **Reload:** `2.5 s` between shots [rec: "slow to reload"; the sniper reloads in 0.5 s]. A reload bar shows on the portrait.
- **Noise:** `18 m`, `noiseKind: 'pistol'` [VFAQ: "as noisy as the regular pistol"; the manual's "lots of noise" is read as "loud, unlike the sniper"].
- **Ammo:** the manual says unlimited and the mission files say 50. We use a **hidden** count of 50 per mission (`CONFIG.bcd.rifle.hiddenCount`) that is never shown and that no BCD mission can exhaust in practice [rec]. The HUD shows ∞.
- **Config:** `CONFIG.weapons.leeEnfield = { range: 27, dmg: KILL, reload: 2.5, aim: 0.6, noise: 18, noiseKind: 'pistol', accuracy: 1 }`. It sits next to the enemy Kar98k (`rifle`) without touching it.
- **Assets:** a Lee-Enfield No. 4 model, a bolt-work reload animation (one per shot), and a sharp report distinct from the Kar98k [rec].

**SMG to W** (`smg` keeps its id; only its key changes, through `rules.hotkeys`, §2). Ammo 100 [DEMO, MIS]; M7 gives 50. Behaviour is unchanged from BEL.

### 1.8 Guests: Grethe and Tonino

Two guests of our own (the 1999 expansion's guests are not used; the two ability sets are kept): roles `grethe` and `tonino`, keys 8 = Grethe and 7 = Tonino. A guest has 100 HP (`CONFIG.units.hp`) and the ordinary selection, move, crouch and hand controls. A mission places a guest like any commando: playable from the start, jailed until a commando opens the cell (`jailed: '<jail id>'`, §1.10), or joining when a commando comes close (`joinsAt: {x, z, r}`).

**Grethe Holm**, code name *Lark* (role `grethe`, nickname "Lark")
- 27. A switchboard operator at the Copenhagen telephone exchange and a courier for the resistance since 1942. She grew up in Flensburg and speaks German like a native. Soldiers see a pretty civilian; the Gestapo know her face.
- **Kit:** a pocket pistol from her handbag (Q; ability and item id `beretta`, the BEL pistol's stats) and cigarette packs (V). No stones, knock-out or cuffs.
- **Lipstick** (`lipstick`, D): targeting `enemy`, range 6 m [rec; the Spy's distract range].
  - It works on **any rank**, officers included, but **not the Gestapo**.
  - The soldier stares at her until the player right-clicks to end it. His **cone follows her as she moves**: his facing tracks her position every tick, and his sweep stops.
  - She can lead him: while he stares, she can walk and he turns (he does not walk after her) [rec].
  - It ends when she leaves his far band, when she is attacked, or when a suspicious act happens in his sight [rec].
- **Cover:** soldiers treat her as a civilian (not a threat, no cone reaction) unless she does something suspicious, or a **Gestapo** man sees her; then she is a commando to everyone who sees her. Dogs do not see through her cover.

**Tonino Esposito** (role `tonino`)
- 15. A *scugnizzo*, a street boy of the Quartieri Spagnoli in Naples. His father was killed in the summer raids. He sells contraband cigarettes to the soldiers, can hit a tin can at twenty paces with a stone, and knows every roof and stair of the quarter.
- **Kit:** stones (Y), cigarette packs (V) and the hand (H). No weapon, no knock-out, no cuffs.

### 1.9 New units and wild animals

All new types are `soldierType` values in `src/ai/archetypes.js` and `CONFIG.stealth.profileByType`. BEL missions never place them, so BEL is untouched.

| Type | Missions | Vision | Weapon | Behaviour |
|---|---|---|---|---|
| `gestapo` | M8 (5 men) | `soldier` profile | Luger, **accuracy 1.25×** the BEL pistol [rec: "crack shots"]: BEL enemy fire never misses, so it is 1.25× the damage per hit (`gestapoLuger` 100 vs the Luger's 80) | Black leather coat and cap. **Always** sees through the Spy's disguise and Grethe's cover (§1.6, §1.8). Cannot be distracted (D, lipstick, puppet). Ignores cigarette packs. Can be knocked out when unaware. Rank level 3. |
| `lieutenant` | M5, M8 [rec: armed officers in the files] | `soldier` | Luger | An armed officer (rank level 2). Behaves as a BEL officer (reinforces, leads searches) but fights. |
| `zookeeper` | M2 (1) | `soldier` | none | Unarmed civilian of rank level 1. Walks among the lions unharmed. If he sees a commando he **raises the alarm and flees into the barracks** [gap-5 §7]. Knock-out and hanger work on him; his uniform has level 1 (§1.6). |
| `firingSquad` | M2 (2 riflemen + a corporal) | `soldier` | Kar98k | Stands at the execution post. An alarm in its linked zones makes it **shoot the hostages: mission lost**. Built as the mission's `alarmFail: {zones, message, onFail}` (§1.10), not a new brain. |
| `snitch` | M7 (1 POW; position differs Easy/Hard) | `soldier` profile, **near band only** [rec] | none | A POW in prisoner clothes who walks a yard route. If he sees a **suspicious act** or a commando in a restricted spot, he walks to the nearest guard (6 s [rec]) and the guard raises the alarm. Commandos can knock him out, cuff him or knife him; other POWs ignore it [rec]. |
| `pow` | M7 (9) | none | none | Ambient prisoners (BEL civilian rules). At the objective they run north. GB and the Driver start as scripted prisoners walking yard routes, and become playable when freed [MIS]. |
| `dog` (German shepherd) | M3 (1) | existing `dog` profile | bite: 35 HP per bite, 1 s [rec] | Uses the BEL dog type. On sight **barks** (a level-3 noise of radius 36 m = an alarm) and **attacks** [gap-6]. Ignores disguises, stones and packs. Cannot be knocked out; can be shot or knifed. |
| `lion` | M2 (3, in the pit) | 360° ring, radius 8 m [rec] | claws: kill in 2 hits, 1.5 s [rec] | Animals only act **inside their pen** (`animalZone`). A commando inside the pit within 8 m is charged at 6 m/s [rec]. They never leave the pit, ignore disguises and never raise the German alarm. The zookeeper is ignored. Killable with the syringe, a knife (risky: must be unaware, which lions are when facing away), or guns (noise). |
| `ostrich` | M2 (4, in their pen) | 360°, radius 5 m [rec] | kick: 40 HP, 1 s [rec] | Wander their pen. "Killers when provoked": they attack a commando who comes within 3 m [rec] or who attacks one of them, and chase him to the edge of the pen. No alarm. |
| `chicken` | M6 (4) | – | – | Ambient; flee from anyone within 3 m and cluck (a level-1 noise of radius 6 m [rec]). |

- **Animal AI:** a small `animal-brain.js` with states `IDLE` (wander inside `animalZone`), `CHARGE`, `ATTACK`, `RETURN`. It does not use the soldier alarm system, zones or disguise checks. Gated by `rules.animals`.
- **Named NPCs:** the 1999 missions' named characters are not built. Our missions bring their own; the generic tools they need are the `deliver` objective (capture alive), escort / flee and zone-linked alarm-fail (§1.10, docs/expansion/MECHANICS.md).

### 1.10 World mechanics

Object tokens are from the retail mission data [MIS] (summarised in `research-raw/gap-6.md`; the full parse is a local, untracked research aid). Each is a data-driven interactable or prop type; a mission only gets one when its data places it.

| Mechanic | Where [MIS] | Behaviour |
|---|---|---|
| **Sea mines** (`MINASUB`, `seaMines`) | M1: 22 | Floating contact mines on chains. A **boat** (dinghy, launch) whose hull comes within 1.5 m [rec] sets one off: bomb explosion (`CONFIG.weapons.explosions.bomb`), everyone aboard dies, a level-3 noise. A **swimming or diving** Marine passes safely [rec: the M1 route relies on it]. A bullet or grenade detonates a mine from a distance (noise alarm) [rec]. Mines show a hover tooltip "Sea mine". |
| **Lift** (`ASCENSOR`, `lifts`) | M1: cliff to the beach | A cage between two stops. `use` at either stop calls or rides it: 6 s travel [rec], room for 4 men or 1 carried body plus 2 [rec]. It creaks (level-1 noise, 8 m [rec]). Enemies do not use it unless a route says so. A puppet can ride it. Each stop has its own height (`a: [x, z, y]` / `aY`, `bY`; default the ground there): two levels are two places on the map (one walking surface per grid cell). A `winch` (or the bridge switch) whose `targets` name the lift sends the cage from where it is to its other stop. |
| **Drawbridge** (`PUENTE` + `INTERRUPTOR`, `drawbridges`) | M8: west canal | The switch raises or lowers the span in 5 s [rec]. Raised: boats pass, walkers cannot cross, and a patrol whose route crosses walks to the edge and waits (`BRIDGE`). Lowered: the reverse (a lowered span closes the channel to boats). Any commando or a puppet can work the switch; an enemy who sees it move raises no alarm unless he sees who did it [rec]. Save / load keeps the span's state. |
| **Pushable wagons** (`VAGEMPUJ`, `pushables`) | M4: 2 | Railway wagons on the track graph. The **GB and the Driver** push [rec: the strong men]; 0.8 m/s [rec], one man. `use` on the wagon's end, then right-click a point along the track. Pushing is a suspicious act if seen, and a level-1 noise of radius 6 m. They are **moving cover** [spec §7.2]: a man walking beside a wagon, on the side away from a cone, is hidden from it (the wagon blocks LOS like a crate) [rec]. |
| **Pushable fuel tanks** (`DEPOSEMP`, `pushables`) | M6: 4 | Wheeled fuel bowsers. Same push rules, but free movement on the navgrid (no rails), 0.6 m/s [rec]. Blow up with an explosion, a grenade or 3 bullets [rec], as a big barrel (radius 1.5× the barrel's [rec]); used to destroy the prototype planes. |
| **Footprints on paths** | M6 [spec §7.2] | Soft paths (`surface: 'mud'`) leave tracks like BEL snow; an enemy who sees them enters the existing `TRACKS` state. No new code beyond a surface flag [rec]. |
| **`PEMPUJE`** | M2 2, M3 2, M4 4, M5 2, M6 8, M7 2 | Unknown token; read as "push door" (a door opened by pushing, **no** key or lock) [rec]; built as ordinary doors. §5 open point. |
| **Ostrich gate** (`PUERTAAVESTRUCES`) | M2 | A pen gate (`penGate`): shut, its leaf blocks its gap in the fence; opened by anyone, it lets the ostriches out to roam (`roam` area, default 3× the pen radius round the gate). Loose, they walk up to whoever is near (10 m) and kick soldiers as well as commandos within 3 m [rec]; a kicked soldier runs clear and watches the bird (no alarm), so it is a legitimate distraction. A chase ends 10 m from where it began. |
| **Knapsacks** (`MOCHILA_COMANDO`, `MOCHILA_CONDUCTOR`) | M7 | GB and the Driver start with an empty kit. Picking up his own knapsack (H) restores his BCD loadout [MIS, inferred]. |
| **Ammo box** (`CAJABALA`) | M5 | +4 sniper rounds on pickup [MIS]. BEL item; no change. |
| **Uniform pickup** (`UNIFORME`) | M5: officer uniform on a roof | Adds `officer` to the Spy's wardrobe (§1.6). |
| **Jails** (`CARCEL`) | M5 (Spy jailed), M7 | A locked cell; the prisoner becomes playable when a commando opens it with `use` [rec]. Any commando or guest can start in one: `jailed: '<jail id>'` on his spawn (the BEL `jail` door, §4.10). |
| **Capture alive** | M5 | Objective `type: 'deliver'`, `targets: [ids]`, `zone?`: every target alive and brought into the zone (default the extraction zone, or aboard the extraction vehicle once it has left); an enemy counts only as a captive (knocked out, cuffed, carried, on puppet strings). |
| **Escort / flee** | M7 | A guest with `follow: '<tag>'` (BEL single file) or `follow: 'team'` (the nearest commando) follows once freed. Non-combatants (`pow` and other unarmed types) with `flee: {to, when?, leave?}` run to `to` when the `when` door / gate opens (or a trigger's `flee` action) and leave the map there (`unit:fled`; `deliver` counts them). |
| **Hostage set piece** | M2 | `alarmFail: {zones: [...], message, onFail?}`: an alarm event raised in a linked zone fails the mission; 'mission:alarmFail' lets a trigger dress it (a volley) during the end grace. |
| **Escape vehicles** | van (M2), lorry (M3, M7), locomotive `TREN_HUIDA` (M4, rail, Driver), Panzer II (M5), jet `AVION_HUIDA` (M6, flown by the kidnapped pilot), launch `LANCHA_HUIDA` (M8, drives itself east under fire), dinghy to the buoy (M1) | BEL vehicle system; new models (§4). Rail and aircraft movement are LATER. |
| **Animal pens** (`animalZone`) | M2 | Polygons that bound animal AI (§1.9). |

### 1.11 "Commando Warnings" (`commandoWarnings`)

- A new option in Options → Game: "Commando Warnings", default **on** under BCD [rec]; hidden under BEL.
- While a commando is inside any enemy's cone (either band, detection meter above 0), his portrait border glows **blue** [MAN].
- While he is being shot at or attacked in melee, the portrait **flashes red** at 4 Hz for 1.5 s after each hit or near-miss [MAN; rate rec].
- Red overrides blue. The portrait flash is purely UI: it reads `enemy.seenTargets` and damage events, and changes nothing in the simulation.

### 1.12 Easy and Hard (`difficulty`)

- **Choice:** a **Skill** screen after New Game → BCD: "Easy — for Rookies" and "Difficult — for Veterans" [MAN]. The choice is stored in the BCD career and in the password (1 bit) [rec]. BEL shows no Skill screen.
- **What changes is data only** [DEMO diff, gap-5 §10]. A BCD mission def has a base plus an optional `variants: { easy: {...}, hard: {...} }` patch, merged by `schema.js` at load:
  - `enemies`: extra entries (`only: 'hard'`) and removals (`only: 'easy'`). Hard has more guards and patrollers (M1 23/27, M2 30/31, M3 32/37 … M8 50/55 [MIS]).
  - Route speed: Easy routes walk at 0.8× [DEMO: `.VEL` 2.0 → 1.6]; pauses are about 2.5× longer [DEMO: `ESPERA` 40 → 100].
  - Some routes swap `pingpong`/`loop`; some sentries get a sweep or a new facing.
  - `par.time` per variant (gap-6 §3: e.g. M1 11:17 Easy / 11:32 Hard).
  - Object positions per variant (the M7 snitch).
- **Unchanged:** cones, hearing, damage, accuracy, weapons, patrols' composition. `enemyAccuracyMul` and `enemyHearingMul` stay 1. Scoring (time + wounds) is the same on both.
- **The sandbox** (§3) carries a tiny variant to test the merge.

### 1.13 Career: rank and stars

- BCD keeps BEL's scoring: 0–3 silver stars per category, the gold conversion table and one rank per 6 gold stars; 11 rank names [MIS `GLOBAL.STR`].
- **Start rank Major** [Ruetli]: a new BCD career starts at `careerStartGold = 36` (rank index 6, Major, in `CONFIG.mission.ranks`). 8 missions × 3 gold = **24** more gold (`maxGold: 24`) reach **Field Marshal at 60** (index 10). The manual's "begin as Sergeant" is not used (it cannot reach Field Marshal).
- **Separate career:** `shadowsix.career.bcd.v1`; the BEL career key and data are untouched.
- **Passwords:** a BCD password encodes the mission, the difficulty bit and the gold. It **replays one mission and does not continue a career** [MAN]. There is no bonus mission and no M20-style gate.

### 1.14 `CONFIG.bcd`: every tunable in one place

```js
bcd: {
  koDuration: 30, koReach: 1.2, koTime: { fist: 0.6, blackjack: 0.6, chloroform: 1.2 },
  reviveTime: 3, cuffTime: 1.5, freeTime: 4, lootTime: 0.8, hangerTime: 2.0, uniformChange: 1.5,
  puppet: { range: 13.5 },
  stones: { range: 12, flight: 0.6, noiseRadius: 4, lookTime: 4, window: 20, investigateAt: 3, investigateLook: 6, hiddenCount: 50 },
  cigarettes: { range: 10, pickupTime: 3, perSoldier: 1 },
  lipstick: { range: 6 },
  rifle: { hiddenCount: 50 },            // stats in CONFIG.weapons.leeEnfield (§1.7)
  gestapoAccuracy: 1.25,
  animals: { lion: { radius: 8, speed: 6, hits: 2, cadence: 1.5 }, ostrich: { radius: 5, provoke: 3, dmg: 40, cadence: 1, chase: 10, calm: 8 }, dog: { bite: 35, cadence: 1 }, scare: 4 },
  push: { wagon: 0.8, tank: 0.6, noiseRadius: 6 },
  seaMine: { trigger: 1.5 }, lift: { travel: 6, capacity: 4 }, drawbridge: { time: 5 },
  easy: { routeSpeedMul: 0.8, pauseMul: 2.5 }, // reference values; the missions carry their own data
  warnings: { redHz: 4, redHold: 1.5 },
}
```

---

## 2. Hotkeys: BCD layout vs BEL

BCD moved the most-used keys to the left of the keyboard, with **no remapping** [MAN p.3, scan-verified; HQ; GameSpot]. We select the layout by ruleset:

- `CONFIG.rulesets.BCD.hotkeys` is a map `{ abilityId: key }`. BEL has no map, so every def keeps its own `hotkey`.
- `input.js` gets `hotkeyFor(def) = world.rules.hotkeys?.[def.id] ?? def.hotkey`. `abilitiesForCode()` and the HUD tooltips/key labels call it. Defs whose `campaigns` exclude the active campaign are skipped, so BEL never sees a BCD ability.
- Keys can repeat across roles (E = grenade, harpoon, sniper rifle, Lee-Enfield). They never repeat inside one role's kit; a unit test checks that for all six roles and both guests under BCD, and pins the BEL map unchanged.

| Ability (`id`) | Who | BEL key | **BCD key** | Note |
|---|---|---|---|---|
| Detonator (`detonate`) | Sapper | A | **A** | same |
| Time/remote bomb (`timeBomb`, `remoteBomb`) | Sapper | B | **B** | same |
| Crawl / stand | all | C / S | **C / S** | same |
| Diving gear (`dive`) | Marine | D | **D** | same |
| Distract (`distract`) | Spy | D | **D** | same; not on Gestapo |
| Lipstick (`lipstick`) | Grethe | – | **D** | new |
| Grenade (`grenade`) | Sapper | E | **E** | same |
| Harpoon (`harpoon`) | Marine | J | **E** | moved |
| Sniper rifle (`sniper`) | Sniper | R | **E** | moved |
| Lee-Enfield (`rifle`) | Driver | – | **E** | new |
| Shovel (`shovel`) | GB | F | **F** | same |
| Drop decoy (`decoyDrop`) | GB | Q | **G** | moved |
| Hand (`hand`) | all | H | **H** | same; also loots packs |
| Decoy on/off (`decoyToggle`) | GB | I | **I** | same |
| Handcuffs (`handcuff`) | GB, Spy | – | **J** | new |
| Wire cutters (`cutters`) | Sapper | W | **J** | moved |
| First aid (`firstAid`) | Sniper, Driver, Spy | K | **K** | same |
| Inflatable boat (`raft`) | Marine | T | **N** | moved |
| Pistol (`pistol`; Grethe's pocket pistol is `beretta`) | all six, Grethe | G | **Q** | moved |
| Puppet (`puppet`) | all six | – | **R** | new |
| Hanger (`hanger`) | Spy | – | **T** | new |
| Reuse / cycle uniform (`uniform`) | Spy | U | **U** | same key, now cycles the wardrobe |
| Cigarettes (`cigarettes`) | all six, both guests | – | **V** | new |
| SMG (`smg`) | Driver | M | **W** | moved |
| Knife (`knife`) | GB, Marine | X | **W** | moved |
| Bear trap (`trap`) | Sapper | J | **W** | moved |
| Lethal injection (`syringe`) | Spy | L | **W** | moved |
| Knock-out (`knockout`: Fist / Blackjack / Chloroform) | GB / Driver / Spy | – | **X** | new; BEL X was the knife |
| Stone (`stone`) | all six, Tonino | – | **Y** | new |

- **Unchanged in both:** 1–8 select (7 = Tonino, 8 = Grethe under BCD), 0 deselects, Tab knapsack, arrows scroll, numpad +/−/* zoom, F2–F7 views, Alt/Shift/Ctrl-click, Ctrl+S / Ctrl+L, Esc menu, P pause, F1 help [inferred].
- **Keyboard help screen and tour** read `hotkeyFor()`, so they show the right layout per campaign.
- **Freed keys:** under BCD, L and M do nothing. Global UI keys (Ctrl+B, the HUD's H handler, P) keep their current behaviour in both layouts.

---

## 3. Phases

### NOW: every BCD system behind the ruleset, proven in a BCD sandbox

Each step keeps `node tests/unit/run.mjs` and `node tests/run.mjs` green, **with no edits to existing BEL tests**. New props and characters use placeholders (tinted existing models, simple procedural meshes) until the LATER assets exist. Nothing under `assets/models/*` or `assets/characters/*` changes in this phase.

| Step | Work | Tests (new) |
|---|---|---|
| **N1** Ruleset plumbing | `CONFIG.rulesets.BCD` gets the §1.0 flags (rename `sergeantsSeeThroughDisguise` → `disguiseRanks`); `CONFIG.bcd` (§1.14); `campaigns` filtering in the ability registry and `loadout`. | `bel-lock.test`: the BEL hotkey map, ability ids per role, loadouts and every BEL flag = false, snapshotted. |
| **N2** Hotkeys | `rules.hotkeys` map and `hotkeyFor()` (§2); HUD labels, help screen and tour read it. | Per-role key uniqueness under BCD; BEL map unchanged; each BCD key arms the right def. |
| **N3** Enemy states | `STUNNED`, `BOUND`, `PUPPET` in `enemy-brain.js`; `stunnedT`, `bound`, `puppetOf`, `cigs`, `uniformTaken` on enemies; save/load round-trip; revive and free reactions; body-found reaction for stunned men. | Brain transitions; wake → alarm; comrade frees → both alarm; save/load mid-KO. |
| **N4** Knock-outs and cuffs | `knockout` (X; Fist/Blackjack/Chloroform by role), `handcuff` (J); aware-target rule; patrol immunity; automatic pack transfer. | Unaware vs aware target; timer reset; cuff only when stunned; pack moves on cuffing. |
| **N5** Stones and packs | `stone` (Y), `cigarettes` (V); projectile arcs; look → investigate after 3 in 20 s; near-band pack pickup with the 3 s kneel; H loots packs from bodies and the ground. | Look vs investigate counts; pack outside the near band ignored; nearest soldier only; aware and Gestapo ignore. |
| **N6** Puppet | `puppet` (R); blue range disc; order routing; doors, `use` interactables, Driver + puppet vehicle; rank-based distract; loss rules (range, LOS, controller seen or shot, house rule). | Each loss rule raises the alarm; rank distract table; puppet opens a door. |
| **N7** Spy | `hanger` (T); wardrobe and U cycling; `disguiseRanks` recognition table; Gestapo never distracted. | The full recognition matrix; U cycle order; BEL disguise path unchanged. |
| **N8** Driver | `rifle` (E, `CONFIG.weapons.leeEnfield`); SMG on W; `driverClub`. | One-shot kill at 27 m, none at 28 m; 2.5 s reload; pistol-class noise. |
| **N9** Guests | guest roles `grethe` (pocket pistol, lipstick, packs; civilian cover) and `tonino` (stones, packs); selection keys 7/8; join triggers. | Lipstick cone tracks her; any rank but Gestapo; Gestapo blows her cover. |
| **N10** Units | `gestapo`, `lieutenant`, `zookeeper`, `snitch`, `pow`; `animal-brain.js` with `lion`, `ostrich`, `chicken`; the dog's BCD tuning. | Zookeeper flees and alarms; snitch reports; lion stays in its pen; ostrich provoke radius; dog barks an alarm. |
| **N11** World mechanics | Generic interactables: `seaMine`, `lift`, `drawbridge` (+ switch), `pushable` (rail wagon, free tank), `jail`, `knapsack`, `animalZone`, pen gate. | Boat hits a mine; swimmer passes; lift ride; drawbridge blocks the patrol; wagon moves along rails; fuel tank explodes. |
| **N12** UI and flow | Commando Warnings (blue/red portraits, option); Skill screen; `variants` merge in `schema.js`; the BCD career (start Major, max 24, separate key); BCD passwords. | Portrait states from perception and damage; Easy/Hard merge; rank arithmetic 36 → 60; a password replays one mission. |
| **N13** BCD sandbox | `src/missions/b00_bcd_sandbox.js` (`campaign: 'BCD'`, dev-menu only): one of every commando, both guests, one of every new unit and animal, every mechanic, and a small Easy/Hard variant; laid out as test stations. | `tests/bcd-sandbox.test.mjs` (GPU headless): every gadget used once end-to-end; the sandbox loads under BCD; BEL missions still load with no BCD ability. |

Order: N1 → N2 → N3 → (N4, N5, N7, N8 in parallel) → N6 → N9 → N10 → N11 → N12 → N13; the sandbox grows with each step so every step lands with a scenario.

### LATER: the expansion missions and their content

The missions are SHADOW SIX's own, designed and built from docs/expansion/README.md (the campaign) with
docs/expansion/MECHANICS.md (the mechanics and their mission data). The 1999 levels are not rebuilt: no retail mission
data, layouts or briefings are used.

| Step | Work |
|---|---|
| **L1** Buildings | The buildings each mission's own design calls for, through the existing building pipeline (docs/expansion/). |
| **L2** Characters and props | The models in §4, including Gestapo, Grethe, Tonino, the zookeeper, the animals and the gadget props; they replace the NOW placeholders one for one. |
| **L3** Missions | The original missions of docs/expansion/README.md, each with its own design, Easy and Hard data, solution and briefing in our own words. |
| **L4** Vehicles | The escape and set-piece vehicles each mission's design needs. |
| **L5** Voices and audio | Guest voice sets (Grethe, Tonino), the Gestapo's German barks, the zookeeper, animal sounds (lion roar, ostrich, dog bark, chickens), gadget SFX (punch, club, chloroform, cuffs click, stone, pack, bolt-action rifle). |
| **L6** Campaign UI | The BCD main-menu entry, scrapbook/briefing art, and the debrief with BCD ranks. |

---

## 4. Assets needed (LATER, step L2; NOW uses placeholders)

All new people follow the character bible's likeness rules (§0.2) and insignia rules (§5.4): **no swastikas, no SS runes, no death's-head badges**; plain stylised eagles or none. Every character gets the standard humanoid rig so existing clips work.

**Characters and uniforms**

| Asset | Used by | Notes | NOW placeholder |
|---|---|---|---|
| **Gestapo** (black) | M8 (5) | Black leather greatcoat, black peaked cap, plain black trousers and boots; Luger holster. Seeded faces (bible §5.2). | BEL officer, tinted black |
| **Lieutenant** | M5, M8 | Officer tunic with a holster (armed-officer variant). | BEL officer |
| **Zookeeper** | M2 | Grey-green work coat, flat cap, rubber boots, bucket prop; also a **Spy uniform** (the Spy wearing it). | BEL civilian |
| **Underclothes texture** | any KO'd man stripped by the hanger | Vest and trousers swap for each enemy body. | tint swap |
| **Spy uniform set** | Spy | Private, sergeant, officer, zookeeper (all but the last exist from BEL). | BEL |
| **Grethe Holm** ("Lark") | guest | Original face; 1940s civilian coat and dress, handbag, red lipstick. Voice: English with a light Danish accent. | BEL female civilian, or a tinted commando |
| **Tonino Esposito** | guest | Original face; a 15-year-old Neapolitan street boy: cap, worn jacket, short trousers. | BEL guest |
| **POWs and the snitch** | M7 (9 + 1) | Allied POW battledress variants; the snitch identical but seeded differently (no tell-tale) [rec]. | BEL guest |
| **GB and Driver as prisoners** | M7 | Same models, no kit, dirt decals. | BEL |
| **Mission characters** | per mission | Whoever each mission's own design needs (docs/expansion/); no 1999 named character is built. | BEL officer / civilian |
| **Firing squad** | M2 | Ordinary soldiers with rifles; an execution-post prop. | BEL soldier |

**Animals** (a quadruped rig and clips each: idle, walk, run, attack, die)

| Asset | Missions | Notes |
|---|---|---|
| Lion (×3 variants) | M2 | Males and a lioness; roar and growl SFX. |
| Ostrich | M2 | Walk, run, kick. |
| German shepherd | M3 | BEL dog asset if already built (bible §6.5), else new; bark SFX. |
| Chicken | M6 | Tiny; flutter and cluck. |

**Gadgets and weapons** (hand props, HUD icons and portrait-bar icons for each)

| Asset | Notes |
|---|---|
| Lee-Enfield No. 4 | Rifle model, bolt-cycle animation, report and bolt SFX. |
| Blackjack (club) | Leather cosh; swing clip. |
| Fist | Punch clip only. |
| Chloroform rag and bottle | Rag-over-mouth clip. |
| Handcuffs | Cuffs prop on the bound man; cuffing clip; click SFX. |
| Hanger | Coat-hanger prop; uniform-take clip. |
| Stone | Pebble prop; throw clip; landing click SFX. |
| Cigarette pack | Pack prop (plain generic brand); throw clip; the soldier's kneel-pick-up-and-light clip with a lighter flare. |
| Lipstick and handbag | Hand props; the "stare" pose for the target. |
| Puppet | Blue range disc (shader), blue selection ring; bound "sitting, hands behind the back" pose and "free walk" clip. |
| New cursors | KO fist/club/rag, cuffs, puppet strings, hanger, stone, pack, hand-with-pack loot, "✗". |

**Props and vehicles**

| Asset | Mechanic |
|---|---|
| Sea mine with chain | sea mines |
| Lift tower / cage, winch | lift |
| Pushable railway wagon | pushables (rail) |
| Pushable fuel bowser | pushables (free) |
| Drawbridge and switch | drawbridge |
| Animal pens, pen gate | animals |
| Knapsacks | knapsack |
| Vehicles and set-piece props | per mission design (docs/expansion/) |

**Audio and UI:** guest voice sets, German Gestapo barks, all gadget and animal SFX above; the Skill screen, Commando Warnings option, blue/red portrait frames, the BCD menu entry and briefing art.

---

## 5. Open points

1. **KO duration, stone and pack radii, rifle range, animal stats, lift and bridge timings:** no source gives numbers; all are [rec] values in `CONFIG.bcd` and get tuned in the sandbox.
2. **Par times:** gap-6 converted `PAR_TICKS` at 25 ticks/s; at our 20 Hz base they run 25 % longer (spec §7.2). Decide when M1 is built.
3. **`PEMPUJE`:** read as push doors [rec]; our missions use ordinary doors.
4. **Puppet range:** 13.5 m is our reading of "the sidearm's range". Revisit if a primary source gives a figure.
5. **Hidden counts** (stones 50, rifle 50): kept to match the files while the HUD shows none, per the manual.
6. **The demo** is pre-release (no KO, hanger or puppet strings); retail values may differ where only [DEMO] is cited.
7. **Guests:** closed. The two guests are our own characters (§1.8).
8. **Skill screen wiring:** `Menus.showSkill(flow)` and `Flow.setDifficulty` exist and are unit-tested, but the running game still builds only a BEL `Flow`. Wire New Game → BCD → Skill when the BCD campaign flow lands (phase LATER). Save games already carry `difficulty` at the top level so a load builds the right Easy/Hard variant before the entities restore. `maxGold` is read under BCD as the cap on earned gold (36 + 24 = Field Marshal at 60).

### 5.1 Decisions from the NOW review

- **Alarm point** (§1.1, §1.3): a man who wakes on his own, or a puppet whose controller is shot at, runs (`ALARM_RUN`) to his zone's alarm point before he shouts: spawn `alarmPoint: [x, z]`, else the zone's `alarmPoint`, else the door of the barracks answering that zone's onSeen event, else the nearest barracks door. With none he shouts where he stands. The puppet losses by range, LOS and "controller seen" still shout on the spot.
- **Weapon pickup** (§1.2): a roused man is unarmed until he picks his weapon up where he fell (`rearmTime` 1.5 s within `rearmReach` 2 m; carried away, when he next passes the spot) [rec].
- **Officers** (§1.6): the BEL unarmed officer never reacts to commandos. Under BCD, an officer who sees through a disguise (private or sergeant uniform) watches the Spy for `officerRecognise` (1 s) and then shouts the alarm (his zone's onSeen sensor) [rec].
- **Dogs** see through uniforms, but not Grethe's civilian cover (only the Gestapo do, §1.8).
- **Knock-out immunity** is squad membership (MP40 patrols: `squad` or `trooper`) [RU]. A lone sergeant sentry can be knocked out, so the sergeant puppet and the sergeant uniform can be reached.
- **Wardrobe** (§1.6): clotheslines and `uniform` pickups add a typed entry (`uniform: 'officer'` on the spec, default `soldier`) and work while the wardrobe is not empty. An unmask clears the worn rank.
- **Puppet talk** (§1.3): D while a puppet is active (the def's `puppetKey`; D stays the Diver's dive in the key map) or R + click on a soldier. The puppet walks to the Spy's distract reach first; targets beyond the puppet range are refused; the talk ends when he walks more than 3 m away. Esc or selecting another man releases the puppet.
- **Save/load** keeps the puppet link (both sides), the wardrobe and worn uniform, the lipstick link, thrown cigarette packs, a carried knocked-out man's state, and the brain goal refs to entities restored later (`bcdPostRestore`).
- **Revive**: REVIVE, FLEE and REPORT ignore noises of every level; only the first finder of a man on the ground reports and shouts.
- **HUD**: cigarettes show their count; the Lee-Enfield shows ∞; stones show no count.
