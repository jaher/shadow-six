# Expansion mechanics: what a mission can use

Every mechanic below runs only under the BCD ruleset: a mission def with `campaign: 'BCD'` (`world.rules` =
`CONFIG.rulesets.BCD`). Under BEL each one is off and BEL behaviour is unchanged. Behaviour, numbers and sources:
`docs/bcd-plan.md` §1. Tunables: `CONFIG.bcd`. Status and tests: `STATUS.md` (below the registration contract).

The **b00** column names the station of the BCD sandbox (`src/missions/m00_bcd_sandbox.js`, `?debug` level select)
where you can try it: **A** knock-out row (z 10–14), **B** lures (x 34–50, z 18–36), **C** rifle range (z 12–15),
**D** zoo and specials (z 42–75), **E** water and machines (z 62–92). "unit" = no station yet; see the named test in
`tests/unit/bcd-capabilities.test.mjs` (or the file given).

## Commando kit (keys = the BCD layout, bcd-plan §2)

| Mechanic | In game | Key · flag | Mission data | b00 |
|---|---|---|---|---|
| Knock-out: Fist (GB), Blackjack (Driver), Chloroform (Spy) | Out cold for 30 s from behind (unaware men only; patrol members immune); he wakes and runs to raise the alarm | X · `knockouts`, `driverClub`, `spyChloroform` | nothing (no item) | A |
| Handcuffs (GB, Spy) | Cuff a knocked-out man: he stays down until a comrade sees and frees him; his cigarettes go to you | J · `handcuffs` | fixed kit | A |
| Puppet (any commando) | Walk a cuffed man on strings within 13.5 m and in sight: doors, switches, levers, a winch, the bridge switch, lifts; talk to soldiers his rank allows | R (D = talk) · `puppet` | nothing | A |
| Stones | A click 4 m round where it lands: he looks; the 3rd stone in 20 s makes a walker go and look | Y · `stones` | `stones: 50` (default kit) | B |
| Cigarette packs | Thrown into a soldier's near band: the nearest walks over and kneels 3 s to pocket it; loot packs with H | V · `cigarettes` | `inventory: { cigarettes: 3 }`; soldiers carry `cigs` (default 1) | B |
| Hanger, wardrobe | Take a knocked-out / cuffed man's uniform (T); U cycles the uniforms held; ranks see through lower uniforms | T, U · `spyUniformFromCaptives`, `disguiseRanks` | `{ kind: 'clothesline', uniform: 'officer' }` or `{ itemId: 'uniform', uniform: 'officer' }` pickup | A |
| Lee-Enfield (Driver) | One-shot kill to 27 m, 2.5 s bolt, pistol-loud | E · `driverRifle` | `leeEnfield: 50` (default kit) | C |

## Units and guests

| Mechanic | In game | Flag | Mission data | b00 |
|---|---|---|---|---|
| Gestapo | Black coat; sees through every disguise and Grethe's cover; cannot be distracted; Luger hits 1.25× (100) | `disguiseRanks` | `{ soldierType: 'gestapo', … }` | D `gestapo1` |
| Lieutenant | An armed officer (rank 2): holds and shoots like a soldier | — | `{ soldierType: 'lieutenant', … }` | D `lieut1` |
| Keeper | Unarmed; sees a commando → shouts and runs to `fleeTo`; his coat is a rank-1 uniform (hanger only) | — | `{ soldierType: 'zookeeper', fleeTo: [x, z], post: {…} }` | D `zookeeper1` |
| Snitch | A prisoner who walks to the nearest guard and reports what he saw | — | `{ soldierType: 'snitch', … }` | E `snitch1` |
| Prisoner | Ambient, unarmed, no cone | — | `{ soldierType: 'pow', … }` (+ `flee`, below) | E `pow1` |
| Dog | Barks (an alarm) and bites 35; ignores stones, packs and uniforms | `animals` | `{ soldierType: 'dog', … }` | D `dog1` |
| Lion | Charges a commando inside its pen (8 m); never raises the alarm | `animals` | `{ soldierType: 'lion', pen: { x, z, r } \| { points } }` | D `lion1` |
| Ostrich | Kicks whoever comes within 3 m inside its pen | `animals` | `{ soldierType: 'ostrich', pen: {…}, penGate: '<gate id>', roam?: { x, z, r } }` | D `ostrich1` |
| Chicken | Scatters and clucks (a level-1 noise) | `animals` | `{ soldierType: 'chicken', x, z }` | D `chicken1` |
| Grethe Holm ("Lark") | Key 8. Pocket pistol (Q), lipstick (D: his cone follows her; not the Gestapo), packs; passes as a civilian until she acts or a Gestapo man sees her | `guests` | `{ role: 'grethe', x, z }` | D (x 100, z 72) |
| Tonino Esposito | Key 7. Stones, packs, hand; no weapon | `guests` | `{ role: 'tonino', x, z }` | E (joins at 104, 86) |
| Guest joins when reached | Out of play until a commando comes within `r` | `guests` | `joinsAt: { x, z, r }` on any commando spawn | E Tonino |

## World mechanics

| Mechanic | In game | Flag | Mission data | b00 |
|---|---|---|---|---|
| Jail start | A commando or guest starts locked in a cell; any commando opens it with Use (unseen) and he is playable | — (BEL §4.10) | `{ role: 'grethe', …, jailed: 'cell_a' }` + `{ kind: 'jail', id: 'cell_a', x, z }` | unit: jail start |
| Sea mine | A boat hull within 1.5 m sets it off (boat and crew lost); swimmers pass; a bullet sets it off | `seaMines` | `{ kind: 'seaMine', id, x, z }` | E `mine1` |
| Lift | Use at a stop calls / rides the cage (6 s, 4 men); each stop has its own height | `lifts` | `{ kind: 'lift', id, x, z, a: [x, z, y?], b: [x, z, y?] }` (y default: the ground there) | E `lift1` |
| Winch | Use sends its target cage(s) to the other stop with whoever stands in it (a puppet can work it) | `lifts` | `{ kind: 'winch', id, x, z, targets: ['<lift id>'] }` | unit: winch |
| Drawbridge + switch | The switch raises / lowers the span (5 s). Down: walkers cross, boats cannot pass. Up: boats pass, walkers cannot; a patrol whose route crosses waits at the edge. Seeing it move raises nothing | `drawbridges` | `{ kind: 'drawbridge', id, x, z, rect: { x, z, w, d, rot } }` + `{ kind: 'drawbridgeSwitch', id, x, z, targets: [id] }` | E `bridge1` |
| Pushable wagon / fuel tank | GB or Driver pushes (0.8 / 0.6 m/s); moving cover; the tank blows up (explosion or 3 bullets) | `pushables` | `{ kind: 'pushable', id, x, z, rail: [[x, z], …] }` · `{ kind: 'pushable', variant: 'tank', … }` | E `wagon1`, `tank1` |
| Pen gate | Shut, it closes its gap in the fence; open, the ostriches roam (default 3× the pen radius round the gate), walk up to people and kick soldiers too; a kicked soldier runs clear and watches (no alarm) | `animals` | `{ kind: 'penGate', id, x, z, w?: 3.2, rot? }` on the fence line | D `pen_gate` |
| Knapsack | The owner's Use restores his kit | — | `{ kind: 'knapsack', id, x, z, ownerRole: 'driver', contents?: {…} }` | E `knap_drv` |
| Uniform pickup | Adds that rank to the Spy's wardrobe | `spyUniformFromCaptives` | `{ kind: 'pickup', itemId: 'uniform', uniform: 'officer', x, z }` | unit (bcd-review) |
| Mud tracks | Mud leaves prints soldiers follow (as snow) | `mudTracks` | `terrain: [{ type: 'rect', terrain: 'mud', … }]` | unit (bcd-mechanics) |
| Hostage set piece | An alarm event raised in a linked zone fails the mission; dress the volley in the 5 s end grace | — | `alarmFail: { zones: ['yard'], message: 'THE HOSTAGES HAVE BEEN SHOT.', onFail?: (world, p) => … }` + `triggers: [{ on: 'mission:alarmFail', do: [{ kill: ['hostage1'] }] }]`; the zones need `onSeen` / `onHeard` events | unit: alarmFail zones |
| Capture alive | Bring a man in alive: an enemy counts only as a captive (out cold, cuffed, carried, on strings); aboard the extraction vehicle counts once it has left | — | `objectives: [{ id, text, type: 'deliver', targets: ['officer'], zone?: { x, z, r } }]` (default zone: the extraction) | unit: deliver |
| Escort | A freed guest follows the nearest commando (or one named unit, BEL single file) | — | `{ role: 'guest', id, guestId, jailed: 'room', follow: 'team' \| '<tag>' }` | unit: escort |
| Flee | Prisoners run to a point when their gate / door opens (or a trigger says so) and leave the map; `deliver` counts them | — | `{ soldierType: 'pow', flee: { to: [x, z], when: '<door id>', leave?: true } }` · trigger action `{ flee: ['pow1'], to: [x, z] }` | unit: flee |


## Every mission

| Mechanic | In game | Flag | Mission data | b00 |
|---|---|---|---|---|
| Commando Warnings | Portrait glows blue while a cone holds him, flashes red while he is shot at; Options → Game → COMMANDOS WARNING | `commandoWarnings` | nothing | every station |
| Easy / Hard | Skill screen choice; difficulty is data | `difficulty` | list entries `only: 'easy' \| 'hard'`; `variants: { easy: { par, routeSpeedMul: 0.8, pauseMul: 2.5, enemyPatch: { id: {…} } }, hard: {…} }` | `easy_extra`, `hard_extra` |
