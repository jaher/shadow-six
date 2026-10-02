# Crawl and prone animation spec

Status: **implemented** (feat/crawl, see §8). The old procedural `crawl` / `crawl_idle` clips
(`crawl.js` + `synth.js crawlPlanted`, and commandos_a `ca_poses.js makeCrawl`) are removed; the prone set is authored
in `tools/characters/prone/`. The sections below are the spec the build follows.

User feedback: *"Crawling should look better: elbows should be on the ground, weapon in the hands (it looks like
crawling is done with the hands on the floor)."*

## 1. Sources

All sources are public-domain US Army field manuals or our own measurements. The images are kept for internal reference only (scratchpad `crawlref/`), not shipped.

| Source | What it gives |
|---|---|
| **FM 21-75** *Combat Skills of the Soldier* (1984), ch. 3 "Movement", Fig. 3-2 "Crawls" (globalsecurity.org mirror `military/library/policy/army/fm/21-75/Ch3.htm`) | Low crawl, high crawl, rush, going prone and getting up. The quotes below are from this manual. |
| **FM 3-22.9** *Rifle Marksmanship M16/M4* (2003), §4-6, Fig. 4-22 "Basic prone unsupported firing position" (`.../fm/3-22-9/c04.htm`) | Prone firing position, and the breathing cycle (the inhale/exhale diagram with the pause before the shot) |
| `docs/research.md` §700 (original `.ANM` data) | Original BEL crawl stride: **30 u per 8-frame cycle** (walk 33, run 75). Crawl speed about 1.0 u/tick, so a cycle takes about 30 ticks = **1.5 s** and covers about **1.35 m** |
| `docs/design-spec.md` §3.2, `CONFIG.units.crawl` | Crawl speed **0.9 m/s**. Going prone takes **0.5 s**, standing up **0.6 s**, and the unit cannot move during either |
| UAL skeleton (measured from `UAL1_Standard.glb`) | Upper arm 0.274 m, forearm 0.273 m, hand 0.122 m, thigh 0.400 m, calf 0.429 m, shoulder to hip 0.523 m, head bone at 1.57 m, facing +Z |

Key doctrine quotes (FM 21-75):

- **Low crawl:** "Keep your body flat against the ground. With your firing hand, grasp your weapon sling at the upper
  sling swivel. Let the front handguard rest on your forearm (keeping the muzzle off the ground), and let the weapon
  butt drag on the ground. To move, push your arms forward and pull your firing side leg forward. Then pull with your
  arms and push with your leg."
- **High crawl:** "Keep your body off the ground and resting on your forearms and lower legs. Cradle your weapon in
  your arms and keep its muzzle off the ground. Keep your knees well behind your buttocks … alternately advance your
  right elbow and left knee, then your left elbow and right knee."
- **Getting up from prone:** "Slowly raise your head … Draw your arms into your body (keeping your elbows in). Pull your
  right leg forward. Raise your body by straightening your arms. Get up quickly."
- **Hitting the ground at the end of a rush:** "Plant both of your feet. Drop to your knees (at the same time slide a hand to the butt
  of your rifle). Fall forward, breaking the fall with the butt of the rifle. Go to a prone firing position."
- **Going prone quietly:** "Hold your rifle with one hand and crouch slowly. Feel for the ground with your free
  hand … Lower your knees … Shift your weight to your free hand and opposite knee. Raise your free leg up and back …
  Roll quietly into a prone position."
- **Prone unsupported firing position (FM 3-22.9):** "drops to his knees. Using the butt of the rifle as a pivot, the firer rolls onto his
  nonfiring side, placing the nonfiring elbow close to the side of the magazine … places the rifle butt in the pocket
  formed by the firing shoulder, grasps the pistol grip … lowers the firing elbow to the ground. The rifle rests in
  the V formed by the thumb and fingers of the non-firing hand … adjusts … until his shoulders are about level …
  keeping his heels close to the ground." The figure shows the body angled about 20° off the line of fire, legs apart and
  toes turned out.

Original game (BEL): commandos crawl **flat on the belly on their elbows**. The weapon is not visible as a separate item at
sprite scale. The silhouette is a flat bar with the arms working in front of the head and the legs frogging behind. There is
no fast crawl ("Commandos cannot fast crawl"). The fan wiki (commandos.fandom.com) has no animation
description, and web search was unavailable for this pass. The sprite description above comes from `research.md` and the
`.ANM` strides.

## 2. What is wrong now

The current clip (`scratchpad chars/review/final/v_greenberet_strip_crawl.png`) and code have these problems:

1. **The arms are nearly straight and the palms are planted** (`crawlPlanted` / `armTo` IK targets the palm at y 0.02 to 0.05, palm down).
   The elbows ride 20 to 30 cm up in the air, so it reads as a push-up walk or a "hands on the floor" crawl. This is the user's complaint.
2. **The weapon is on the back**. `HOLD.crawl = HOLD.crawl_idle = 'back'` in `src/art/characters/*/weapons.js`, so the hands are empty.
3. **The head is dropped** (face toward the ground). A soldier crawling looks forward along the ground.
4. **The lower legs point up** (the knee is bent with the boot sole in the air, `REACH.calf` has a +Y component and the IK target is below the hip). Real crawlers keep
   the whole leg on the ground: the knee is drawn up **sideways** in the ground plane and the inside of the boot is flat on the ground.
5. **The clip is too slow for 0.9 m/s**. The authored ground speed is 0.60 m/s (commandos_b: stroke 0.45 m, T 1.5 s) or 0.50 m/s
   (commandos_a), so runtime speed matching plays it at ×1.5 to ×1.8 and it looks frantic.
6. The pelvis moves forward at a constant rate. A real crawl surges forward on each pull and nearly stops during the reach.

## 3. Low crawl (`crawl`): the target pose and cycle

### 3.1 Style decision

We use the **FM low crawl body** (flat, weapon carried per doctrine) with a **leopard-crawl leg rhythm**:

- The legs **alternate** between strokes, not the firing-side leg only as in the FM. An alternating, symmetric loop is less mechanical and reads better from the
  isometric camera.
- **The forearms ALTERNATE** (user, 2026-09-30: *"when crawling alternate between left / right arm, don't use both arms"*).
  This is the contralateral coordination of the FM high crawl ("alternately advance your right elbow and left knee, then your
  left elbow and right knee") on the low-crawl body: the left elbow plants with the right knee drawn up and pulls while the right
  leg pushes, as the right forearm (rifle on it) skims forward; then they swap. The elbows stay on the ground (the reaching one
  skims 1 to 1.5 cm up) and the weapon stays in the right fist. *First build (superseded): both forearms pulled together, the
  contralateral elbow leading by 8% of the cycle.* See §10 for the as-built numbers.

### 3.2 Contact rules (always true in `crawl` and `crawl_idle`)

| Body part | Rule |
|---|---|
| Elbows | **Both on the ground** (elbow joint centre y = **0.04 m**, the sleeve touches). They are the anchors of the pull and stay world-planted during the power phase. |
| Forearms | Flat on the ground, pointing **forward and inward by 30 to 45° at the catch and 55 to 60° at the finish of the pull**, so the hands meet about 15 to 25 cm in front of the chin. Wrists at y = 0.05 to 0.07. **The palms never carry weight.** |
| Hands | Right: a fist around the weapon at the **front sling swivel** (`sling_f` socket), thumb up. Left: flat or lightly cupped under or beside the handguard, palm down but not pushing. Unarmed: loose fists or relaxed half-open hands, resting on their little-finger side. |
| Weapon | The **handguard rests on the right forearm**. Muzzle **off the ground** (y ≥ 0.10 m), 20 to 35 cm ahead of the right fist. **The butt drags on the ground** (y ≈ 0.03) beside the right ribs or hip. The weapon lies roughly along the body, yawed 5 to 10° muzzle-inward and pitched 5 to 8° muzzle-up. |
| Torso | **Flat**, belly and chest on or just above the ground. Pelvis (hip centre) y = **0.13 m**, shoulders y = **0.15 m**, spine horizontal ±5°. |
| Head | Neck extended so the **face looks forward along the ground**: eyes about 10 to 15° below the horizon, chin 8 to 12 cm above the ground. The helmet or cap is the highest point (≈ 0.30 m). No nodding with the strokes; only ±2° damping. |
| Legs | **The whole leg stays in the ground plane.** The drawn-up knee goes **sideways** (thigh abducted 45 to 60°, knee flexed 90 to 110°) with the **inside of the knee and the inside edge of the boot** on the ground. The straight leg lies extended with the foot turned out 30 to 45°, and the toe and inside edge of the boot drag. The **boot sole never faces the sky** and the lower leg never rises above about 0.15 m. |

### 3.3 Timing and stride (meets 0.9 m/s)

- **Cycle T = 0.90 s** = two strokes (right leg push, then left leg push), each **0.405 m**, so the ground speed is **0.90 m/s** exactly.
  (First build: T 1.0 s / 0.45 m strokes. The shoulder then had to travel ~0.37 m past each planted elbow, which the fixed upper arm
  only allows by propping the chest up ~13 cm mid-pull - a sphinx / high crawl. See §9.)
  Runtime plays it at ×1.0 at `CONFIG.units.crawl`.
  For comparison, the original BEL sprite used 1.35 m per 1.5 s, which is the same speed with a longer lunge.
  A real low crawl runs 0.3 to 0.5 m/s. Ours is a brisk game crawl, which is also why the stroke is at the long end.
- Each half cycle (0.50 s) = a **power phase of 60%** (0.30 s: elbows and pushing foot planted, body surges) plus a **reach phase of 40%**
  (0.20 s: forearms slide forward about 1 cm above the ground, the next knee draws up, the body glides).
- Body speed profile (as built, §9): **v·(1 + 0.4·cos)**, 1.4·v mid-pull and 0.6·v mid-reach, changing smoothly (no stop-and-go). The pelvis surges **±2.6 cm**
  relative to the root. (Original plan: 1.33·v in power and 0.5·v in reach, surge ±0.05 m, relative to the root, which moves at a constant rate
  (`pelvis.position.z` offset: −0.05 at the catch, +0.05 at the end of power).
- Elbow travel relative to its shoulder: **+0.22 m (catch) → −0.08 m (finish)**, plus about 0.06 m of scapular slide from the `clavicle` bone.
  Because the elbow is on the ground and 0.274 m from the shoulder, it swings **outward** at the finish (about 0.23 m lateral of the
  shoulder). That "wings-out" pull is the characteristic leopard-crawl silhouette.

### 3.4 Keyframes (per 0.25 cycle; the second half mirrors the first)

> **Superseded for the arms by §10:** the elbows now alternate (left elbow with the right knee, then right elbow with the left knee). The leg, pelvis and head columns still hold.

Space: the root follows the ground at constant v. +Z is forward, +X is the character's left, Y is up, in metres, for the 1.80 m UAL body.
**Elbow and hand values are relative to the same-side shoulder joint (`upperarm_*`)**. Leg values are relative to the pelvis.
R = the right leg pushes during the first half.

| Phase (t) | Name | Arms (both elbows planted unless noted) | Right leg | Left leg | Pelvis / torso / head |
|---|---|---|---|---|---|
| **0.00** (0.00 s) | **R catch** | Fully forward: **L elbow z +0.24**, R elbow +0.20 (the contralateral elbow leads), x 0.10 to 0.12 outboard of the shoulder, y 0.04. Forearms 35° inward, hands together about 0.45 m in front of the shoulders, rifle muzzle y 0.12 | **Drawn up**: knee z −0.05, x −0.42, y 0.07 (inside of the knee on the ground); foot inside edge planted at z −0.40, x −0.30, toes pointing out and back | Straight, foot turned out 40°, toe dragging at z −0.92, x +0.16 | Surge −0.05. **Roll 12° (right hip up)**, spine bent 5° toward the right knee. Head pitch set so the gaze is level, yaw 0 |
| 0.125 | R pull | Elbows planted, shoulders moving over them: elbow z ≈ +0.08, x 0.18 outboard | Pushing: knee z −0.20, x −0.36; foot planted, knee extending | Straight | Surge −0.01, roll 7°. Chest slides and the torso does not lift |
| **0.25** (0.25 s) | **R finish** | Elbows at z −0.06 (beside the chest), **x 0.23 outboard**, forearms still flat but turned **55 to 60° inward**, so the hands stay about 0.15 m ahead of the shoulders, under the chin. The rifle stays planted on the forearm, so the body slides past it and the butt goes from chest level to beside the hip | Nearly straight: foot at z −0.75, x −0.22, inside edge still in contact | Knee starts to draw: z −0.45, x +0.30 | **Surge +0.05 (maximum)**, roll 0°. Head steady |
| 0.375 | Reach | **Recovery**: forearms slide forward 1 to 2 cm above the ground (the elbow y goes to 0.055 for 0.1 s), R elbow z +0.12, L +0.10. Rifle carried forward on the forearm, muzzle y ≥ 0.10 | Straight, turning out to drag | Knee drawing: z −0.20, x +0.38; foot sliding to z −0.45 | Surge +0.01, roll −6° (left hip lifting) |
| **0.50** (0.50 s) | **L catch** | Mirror of 0.00: **R elbow +0.24**, L +0.20 | Straight, toe dragging at z −0.92 | **Drawn up**, foot planted (the mirror of R at 0.00) | Surge −0.05, **roll −12°** |
| 0.75 | L finish | Mirror of 0.25 | Knee starts to draw | Nearly straight, pushing | Surge +0.05, roll 0° |
| 1.00 | = 0.00 | | | | |

Tangents: use ease-in/out on the reach, and a quick start and slow finish on the power phase (the body accelerates when the forearms bite).
Planted contacts (both elbows and the pushing foot's inner edge) move backward in root space at exactly −v while planted. The dragging toe and the rifle butt are not planted: they slide with the body at ground height. The planted paths are
the effector paths `ground.js` already consumes (`meta.paths`), renamed `elbow_l/elbow_r/foot_l/foot_r`.
Secondary motion: breathing is not visible while crawling. The shoulder blades show as clavicle rotation of ±6° about the spine axis in phase
with the pull. The hips yaw ±4° toward the pushing leg, which keeps the rifle butt from snagging the pushing thigh.

### 3.5 Per-weapon and per-character variants of the crawl

The body cycle stays the same. Only the hands, the weapon and a few offsets change, so one base clip plus an arms override per carry class
is enough (`overrideUpper`-style, with the elbow effector paths shared).

| Variant | Who (`CARRY_WEAPON`) | Hands and weapon |
|---|---|---|
| **Long gun** (`crawl`) | Sniper `no4_sniper`, enemy `kar98k` | As in §3.2. The right fist is at `sling_f`, the handguard rests on the right forearm and the butt drags beside the hip (a rifle is about 1.1 m long, so the butt lands 0.75 to 0.8 m behind the fist). The scope faces up, away from the dirt. |
| **SMG** (`crawl`, SMG hold) | Driver `thompson`, enemy `mp40` | The right fist is on the front of the receiver or the barrel shroud (Thompson: the foregrip; MP40: the barrel shroud ahead of the magazine). The weapon lies across both forearms, **magazine pointing outboard** (not into the dirt) and the muzzle 15 to 20 cm ahead of the fist. The folded MP40 stock ends under the right chest and does not drag. The Thompson butt drags beside the ribs. |
| **Harpoon gun** (`crawl`, long-gun hold) | Marine `harpoon_gun` | Same as the long gun. The spear tip stays ≥ 0.12 m above the ground. |
| **Pistol** (`crawl_unarmed`) | GB `colt1911`, Sapper/Spy `walther_p38` | The **pistol stays holstered** while crawling, as in BEL, where the pistol is drawn only for the shot. The crawl is unarmed (below). |
| **Knife in hand** (`crawl_knife`) | GB with the knife selected | The right fist grips the knife with the **blade forward, flat side horizontal and edge down**. The fist rests on its little-finger side on the ground at the end of the flat forearm, and the blade stays clear of the ground (tip y ≥ 0.03). The left hand is flat or lightly cupped. The pull is the same, with the knife fist stationary on the ground during power. |
| **Unarmed** (`crawl_unarmed`) | Anyone with nothing held, guests (not the M17 prisoners, who cannot crawl) | Forearms flat. Hands are loose fists or half-open, resting on the little-finger side about 20 cm apart and never palm-planted. The same arm rhythm as the long gun. |
| **Diver in the dry suit** | Marine after `dive` (fins on) | Fins must not dig in: the **ankles are plantar-flexed** (fins flat, pointing back), and the push comes from the **inside of the knee** and the fin blade's edge, not a planted boot. The drawn-up knee reaches 20% less far out. The rebreather bag on the chest lifts the chest by +0.03 m, so shoulders are at y 0.18. The mask hangs off the chest and the forehead is up. |

## 4. The other prone states

### 4.1 Prone idle (`crawl_idle`)

- **Pose, sphinx on elbows:** both elbows planted at z +0.12 relative to the shoulder and x 0.10 outboard. Forearms converge at 40° and the
  **weapon is held in both hands** in front of the face: right hand at the wrist or pistol grip, left hand under the handguard. The rifle is level at y 0.14 to 0.18, the muzzle
  0.5 m ahead of the chin and the butt on the ground or resting under the right armpit. The chest is slightly raised (shoulders y 0.17 to 0.19), the pelvis
  flat (y 0.12), and the legs straight and apart (heels 0.35 to 0.45 m apart) with the **toes turned out and heels down** (FM 3-22.9: "heels close to the ground").
- **Breathing:** 16 breaths/min at rest (3.75 s cycle), or 24/min for the first 4 s after crawling. `spine_03` pitch ±1.0° and `spine_02` ±0.6°,
  the shoulders lifting 4 to 6 mm, clavicles ±1°. The weapon muzzle follows at about ±3 mm (the FM breathing diagram shows the rise and fall of the muzzle).
- **Idle life (loop length 8 s, or layered randomly):** the head scans with yaw ±12° over 6 s (slow, holding at the extremes). At 1 in 3 loops a slight
  weight shift makes one hip roll 3° and one leg's toe re-seat. Blink via the face rig if present.
- **Unarmed or pistol idle:** forearms flat and crossed loosely in front, or the hands under the chin. With the pistol drawn, see §4.3.
- The loop must start and end on the **crawl catch pose's elbows** (not a different arm layout), so `crawl` ↔ `crawl_idle` crossfades
  (0.15 s) never lift the elbows.

### 4.2 Prone aim / shoot: rifle, SMG, harpoon (`prone_aim`, `prone_shoot`)

- **Body angled about 15 to 20° off the line of fire** toward the firing side (FM Fig. 4-22). The game yaws the unit so that the **rifle** points
  at the target, and the clip bakes the body offset. The left elbow is under the rifle, close to the magazine. The **rifle butt is in the right shoulder pocket**
  and the right hand on the pistol grip or wrist of the stock. **Both elbows are planted** and the shoulders level. The cheek is on the stock (head pitched forward
  and rolled 10° right). Legs apart with the toes out and heels down, and the right knee may be drawn up 20° (the relaxed variant).
- **From `crawl_idle` to `prone_aim` in 0.25 s:** the butt comes back to the shoulder, the left hand slides under the handguard and the head drops onto the stock.
- **Shot:** recoil moves the rifle 4 to 6° muzzle-up and pushes the shoulder back 2 to 3 cm (`clavicle_r` and `upperarm_r`). The upper body rocks 1 to 2°, and it settles in 0.15 s.
  - **Bolt action** (No4 / Kar98k): after 0.25 s the right hand goes to the bolt, up, back, forward and down, and back to the grip. This takes 0.8 s, with the head staying on the stock.
  - **SMG:** a 0.4 to 0.6 s burst with per-shot vibration of ±1.5° pitch and ±0.8° yaw, and the muzzle climbing about 4°.
  - **Harpoon:** a single shot with no cycling. The reload is a slow 1.5 s spear insertion with the gun turned on its side.
- **Traverse while aiming** (target moving): rotate the whole body about the **elbows** (the pivot is between the elbows and the legs sweep). Keep ±25° as an upper-body
  twist before the feet/pelvis re-seat.

### 4.3 Prone pistol aim / shoot (`prone_pistol_aim`, `prone_pistol_shoot`)

- The pistol comes from the holster with the right hand in 0.4 s. The right arm then extends forward along the ground line, with the forearm lifted about 20° off the ground, the elbow
  still planted and the wrist straight. It is **one-handed in the period manner**: the left forearm is flat across in front as a rest, and the right wrist lies on it. The pistol
  is about 0.40 m ahead of the eyes at y ≈ 0.20. The head is raised a little and the chin lifted to sight.
- **Shot:** the muzzle flips 8 to 10° and returns in 0.12 s. Loop the idle aim with a tremor of ±0.3°.

### 4.4 Stance transitions

| Clip | Duration | Keys |
|---|---|---|
| **`go_prone`** (stand → prone) | **0.50 s** (= `CONFIG.units.stanceDown`) | The `get_up` path played backward with a quicker drop: 0.00 idle → **0.06** the right foot steps back (a lunge), the left stays planted → **0.14** down onto the right knee, the left foot forward (a kneel), hands off the ground → **0.27** both hands planted ahead (left palm flat, right fist on the weapon), the left leg swung back on an arc, toes on the ground (a one-knee push-up) → **0.42** the chest lowered between the hands, the right knee slides back to the prone line → **0.50** the hands slide forward just over the ground to `crawl_idle` frame 0 (elbows planted). |
| **`get_up`** (prone → stand) | **0.60 s** (= `CONFIG.units.stanceUp`) | 0.00 `crawl_idle` frame 0 → **0.10** head up, the hands drawn in under the shoulders, just over the ground (left palm flat, right fist around the weapon) → **0.25** push-up: arms straight, chest up, the **right knee drawn 7 cm forward along the ground under the hip**, the left toes on the ground → **0.37** rocked back onto the right knee (it does not slide), hands off the ground, the **left foot swung forward on an arc and planted** where `idle` has it → **0.47** driving up off the left leg; the right toes pivot in place (heel up), then the right foot steps through on an arc → **0.60** exactly `idle` frame 0. |
| **`dive_prone`** (optional, run → prone) | 0.70 s | FM rush stop: plant both feet, drop to the knees, fall forward **breaking the fall with the rifle butt** (unarmed: both forearms), then slide 0.2 m. Use when a prone order arrives while running. |
| **Crawl start / stop** | (blend) | `crawl_idle` ↔ `crawl` crossfade 0.15 s, phase-matched: enter at t = 0.00 or 0.50 (the catch pose, whichever foot is closer). Stopping waits for the next catch (≤ 0.25 s) or blends out at the finish. |

As built (2026-10, `tools/characters/prone/stance_trans.mjs`; the first version slerped five key poses and its left leg swung
through the ground between 0.22 and 0.35 s, so the contact solve lifted the whole body and the pelvis spiked 0.97 → 0.66 m mid-rise: in
the game a floating lunge with the hands off the ground): one shared path over six key poses (PRONE, HANDS, PUSH, KNEEL, RISE, IDLE). Torso and arms
blend per bone between them; the hip centre (monotone cubic height, its z from the kneeling knee), both legs (two-bone IK to explicit knee /
ankle / toe targets with the foot's world rotation) and the planted hands are solved every frame, so the hip rises (falls) monotonically,
nothing passes through the ground, nothing levitates and contacts hold (kneeling knee and planted feet < 3 cm). Per-frame hand-plant weights
ship as `contacts.hd`; `prone-fit.js` (step 4h) bends this body's trunk forward (<= 25°) and lets the arms reach so the palms stay on the
ground on every body, and for transitions lifts the whole body only over a knee / shin (boots and forearms are fitted per limb). Every
runtime plays the transition over exactly the sim's stance time (`h.trDur` / unit-model `speed`), the fade into `get_up` is 0.1 s (a longer
cross-fade from `crawl_idle` dipped the fingers 7 cm into the ground), and a knife crawl-in keeps the knife in the fist (`crawl_knife` grip
through `go_prone` / `get_up`). Tests: `tests/unit/stance-transitions.test.mjs`, `tests/stance-transitions.test.mjs`; strip
`docs/screenshots/stance-transitions.jpg`.

### 4.5 Prone death (`die_prone` → `dead_prone`)

- **`die_prone` (0.9 s), hit while crawling or lying:** 0.00 the current prone pose → **0.08** hit reaction: the head snaps down 15° and the shoulders jerk
  (the hit side's clavicle goes back 5°) → **0.25** the head drops and turns to one cheek, and the **elbows give way**: the forearms slide out and the chest settles
  from y 0.15 to 0.11 → **0.45** the weapon is released. It rolls off the forearm to lie beside the body (the `drop` hold: the weapon becomes a ground prop
  at the hand's last position, muzzle-forward) → **0.70** the legs relax: the drawn knee slides out a little and the feet fall to their sides → **0.90** matches
  `dead_prone`.
- **`dead_prone` (static pose):** face turned to the left cheek, with the helmet or cap rolled or tipped. The left arm is forward on the ground and bent 100°, and the right arm lies along the body
  **palm up**. The legs are straight and apart, toes out, and one knee is slightly bent. The whole body is on the ground (grounding via `ground.js` r8).
- A standing unit killed after `go_prone` has started uses `die_prone` too (`h._prone` is set at the start of the stance change).

### 4.6 Turning while prone (`prone_turn_l`, `prone_turn_r`)

A prone man cannot pivot like a standing one. He **walks his elbows sideways** and **swings his legs around the hips**, or, in a tight turn, around the
chest. The clip: **45° in 0.60 s (75°/s)**, in place.

- 0.00 the idle or catch pose → **0.15** the elbow on the outside of the turn lifts 2 cm and steps 0.15 m sideways, and the inside elbow follows → **0.30** the upper body has yawed 25°
  and the spine bends to absorb it → **0.45** the hips lift 1 to 2 cm, the legs sweep across the ground (the feet travel about 0.7 m along an arc) and the pelvis yaws
  to match → **0.60** the idle pose rotated 45°. The pivot point is the chest (about +0.25 m ahead of the pelvis), and the root yaws about the unit position.
- **Runtime:** while `stance === 'crawl'`, cap the visual turn rate at **75°/s instead of 540°/s**. Small heading changes (< 30°) while crawling are
  absorbed by a spine twist: the shoulders lead and the hips follow at 90°/s, so no clip is needed. For a larger turn at the start of a crawl path, the
  art layer plays `prone_turn_*` (repeated) before the `crawl` clip. This is visual only. Do not delay the sim; if the sim is ahead, blend the turn at 1.5× rate.
- Crawling a curve: the root yaw is smoothed at ≤ 120°/s, the shoulders lead by up to 15° (spine twist), and the elbows plant along the new heading.

## 5. Mocap: is there a license-clean army crawl?

| Source | Licence | Army / low crawl? | Verdict |
|---|---|---|---|
| **CMU** `111_03` "Crawling" (subject 111, a pregnant woman) | CMU custom licence: allowed only as **baked clips** | **No.** Downloaded and analysed (`111_03.amc`): the pelvis median is at **0.44 m**, range 0.29 to 0.85, and the net travel is 0.58 m in 12.7 s. That is a **hands-and-knees** crawl, slow and non-military | Reference only. Reject for the crawl. |
| CMU `133_01/02` "Walk Crawl" (baby-styled walk) | same | No: a stylised upright walk | Reject |
| CMU `77_16/77_17` "laying down, getting up, careful ready pose" | same | Transitions only (civilian lie-down and get-up) | Possible **reference** for `go_prone` / `get_up` timing. Keying is simpler (see below). |
| CMU `90_16` "fall on face" | same | Death only | Already listed for `die` |
| **ACCAD** Open Motion Project | CC BY 3.0 (verified, `realism-pipeline.md`) | Has crawl, lie and look-around takes, but **the BVH rest pose is broken** (torso along +X, L/R hips inconsistent). Its crawl is a generic belly crawl, not the doctrinal low crawl with a weapon | Usable for `go_prone` / `get_up` **after** a rest-pose fix in Blender. Not worth it for the crawl itself. |
| Quaternius UAL1/UAL2 | CC0 | No crawl or prone clip (only `Death01`, `Fixing_Kneeling`) | n/a |
| Bandai-Namco Research motion dataset, LAFAN1, AMASS, 100STYLE | NC / ND / research-only, or no prone content | 100STYLE is CC BY but has no prone content | **Reject** (NC/ND or not applicable) |

**Retargeting feasibility:** mechanically, a CMU → UAL retarget is solved (`retargetBVH(bvh, ual1.scene, {map: BVH_MAPS.cmu})`
works on the standard CMU T-pose). The problem is content: no clean source has the **weapon-carrying, elbow-planted low crawl**. Even a good
belly-crawl take would need its hands re-keyed around the weapon, its speed rescaled from about 0.3 to 0.9 m/s (which breaks the contact timing), and
contact clean-up. That is more work than authoring it.

**Recommendation: authored keyframes (procedural, CC0 project code).**
The crawl is a short symmetric loop with exact ground contacts, and it must hit a precise ground speed, several weapon variants and phase-matched blends. That suits the
existing world-direction and IK authoring (`crawl.js` / `synth.js`) better than mocap. Use CMU `77_16/17` and FM 21-75 only as timing references for the
transitions. Keep ACCAD's `A8_CrouchToLie` / `A10_LieToCrouch` as an optional upgrade for `go_prone` / `get_up` once its rest pose is fixed.

## 6. Implementation notes (for the build step)

1. **Authoring (tools):** rewrite the arm and leg solve of `crawlPlanted` (commandos_b `synth.js`, and `makeCrawl` in commandos_a `ca_poses.js`) to be
   **elbow-first**:
   - aim `upperarm_*` so that the elbow lands on the §3.4 elbow target. It is a single-bone aim, because the target lies on the 0.251 m ground circle around the shoulder.
   - lay `lowerarm_*` flat along the forearm direction (y of the wrist is 0.05 to 0.07).
   - set `hand_*` and the fingers from a per-hold **hand pose** (fist on the `sling_f` socket, knife fist, loose fist) instead of the palm-down IK.
   - legs: aim the thigh in the ground plane (abducted), put the knee on the ground, lay the calf flat and put the foot on its inner edge. Remove the +Y from `REACH.calf`.
   - body: pelvis y 0.13, the surge, the roll, and the neck extension to a level gaze.
   Cycle `T = 0.9`, `strokeLen = 0.405`, so `userData.groundSpeed = 0.9`.
2. **Effector paths:** export `meta.paths` as `elbow_l/elbow_r/foot_l/foot_r`, plus `butt` for the weapon drag. Update `ground.js` so the per-character
   grounding IK uses the **elbow** paths: aim the upper arm at the elbow, then keep the forearm on the ground. It must no longer IK the hand onto a palm point
   (the current `paths['hand_' + s]` branch). The finger/glove-above-ground pass stays.
3. **Weapons:** add a hold **`crawl`**, used for `crawl` and `crawl_idle` instead of `'back'` in `HOLD`, in both `weapons.js` copies:
   - long gun: grip the right hand at `sling_f`, aim the weapon so the `butt` socket lies on the ground at y 0.03, with the constraint that the handguard is not below the right forearm's top surface.
   - SMG: the right hand at `grip_l`, since the foregrip or shroud is where the left hand normally goes; the magazine is rolled outboard.
   - pistols: stay in the holster (`back`/holster behaviour unchanged).
   - knife: `hand`, with a crawl-specific wrist rotation.
   - no left-hand IK in `crawl` (the left hand is on the ground). In `crawl_idle` and `prone_aim`, use the normal left-hand IK to `grip_l`.
4. **Clips to add** (all anim GLBs that carry `crawl`: base, commando, enemy and guest). The table adds a prone branch to `mapAnim` for `aim`/`shoot` (today it plays the
   standing aim while prone):

   | Gameplay | Prone clip candidates |
   |---|---|
   | `crawl` (weapon class) | `crawl` (long gun or SMG), `crawl_unarmed`, `crawl_knife` |
   | `crawl_idle` | `crawl_idle` (weapon-class arms as above) |
   | `aim` / `shoot` while prone | `prone_aim` / `prone_shoot` (long gun), `prone_pistol_aim` / `prone_pistol_shoot` (pistol), falling back to `crawl_idle` |
   | stance change | `go_prone`, `get_up` (0.5 s / 0.6 s; `ca_runtime.js` already has `go_prone: 0, get_up: 0` grounding entries) |
   | die / dead | `die_prone` / `dead_prone` (redo with the new base pose) |
   | turning | `prone_turn_l`, `prone_turn_r` (optional, §4.6) |

5. **Playback:** `crawl` is in `LOCOMOTION`, so the rate is `speed / groundSpeed`. With `groundSpeed = 0.9`, it plays at ×1.0. Phase-match the
   `crawl_idle` ↔ `crawl` blends at the catch poses.
6. **Wind flutter (feat/phase3 `cloth-wind.js`):** flutter is a post-skinning vertex offset along the relative air velocity. The new clips change only bones,
   so they are compatible. Recommended follow-up there: scale the flutter amplitude by about 0.3 while the unit is prone (a per-draw uniform like `VEL`). Otherwise
   a greatcoat skirt lying on the ground flaps up into the air or down into the terrain. Use the character's own crawl velocity (0.9 m/s), as it already does.
7. **Acceptance checks (headless render, 4 views + a 6-frame strip):**
   - both elbow joints are at y ≤ 0.06 in every `crawl` / `crawl_idle` frame.
   - no palm or finger carries a contact point.
   - the rifle muzzle is at y ≥ 0.08 and the butt within 0.05 of the ground in `crawl`.
   - the head bone's forward vector is within 20° of horizontal.
   - the maximum boot-sole normal y is < 0.5 (no soles to the sky).
   - pelvis y is 0.11 to 0.16.
   - `groundSpeed` is 0.90 ± 0.02.
   - elbow foot-skate is < 1.5 cm while planted.
   - `node tests/unit/run.mjs` and `node tests/run.mjs` stay green.

## 7. One-paragraph brief (for the modeller or animator)

Flat on the belly, head up looking along the ground, helmet the highest point. **Elbows and forearms on the ground**, forearms angled in. The right fist holds the rifle at the front sling swivel, the rifle **rests on the right forearm**, muzzle up off the dirt and butt dragging
by the hip. Each stroke (0.45 s): **one** forearm reaches forward while the **opposite** knee draws up **sideways along the ground**, then that elbow pulls and that boot
pushes off its inside edge, while the other forearm skims forward for the next stroke (left elbow + right knee, then right elbow + left knee). The body surges about 10 cm, the hips roll 12° toward the drawn knee, and the next stroke uses the other leg. Two strokes per second-long
cycle cover 0.9 m. Palms never carry weight, and boot soles never face the sky.

## 8. As built

**Authoring** (`tools/characters/prone/`, CC0 project code, reproducible):

| File | What |
|---|---|
| `rig.mjs`, `pose.mjs` | UAL skeleton kit: every bone set from a world "along" and "front" direction; prone torso / neck / head, flat arm, frog leg, two-bone chains |
| `crawl.mjs` | the low crawl §3: T = 0.9 s, 2 x 0.405 m strokes (0.90 m/s, plays at x1), 60 % power / 40 % reach, smooth body speed 0.6-1.4 v (surge ±2.6 cm), roll ±8°. Elbow-first: the planted elbow is a world point, the chest lift and the scapular slide (clavicle) are solved per frame so the upper arm reaches it exactly (skate ≤ 1.2 cm per pull) |
| `prone_clips.mjs`, `prone_trans.mjs` | prone aim / shoot (bolt cycle), SMG burst, one-handed pistol, `go_prone` 0.5 s, `get_up` 0.6 s (FM order, contacts kept on the ground), `die_prone` → `dead_prone`, `prone_turn_l/_r` |
| `grip_build.mjs` → `src/art/characters/prone-grips.js` | weapon grip frames in hand-bone space (generated) |
| `bake_prone.mjs` | runs all of the above → `prone_clips.json` + the grips module |
| `write_anims.mjs` | replaces the old clips in `base_anims`, `ca_anims`, `commando_anims`, `guest_anims` (keyframe reduction, meshopt), meta + per-frame contacts in the Scene extras and the `.json` sidecars |
| `strips.mjs`, `strip_page.js` | frame strips (side / top / 3-4 view on the real characters, or the game camera in a mission) |

```
node --import ./tools/characters/prone/node-three.mjs tools/characters/prone/bake_prone.mjs --out=/tmp/prone/
GLTF_DEPS=<dir>/node_modules node tools/characters/prone/write_anims.mjs /tmp/prone/prone_clips.json
```

**Clips** (all four libraries): `crawl` (long gun / SMG), `crawl_unarmed` (pistol holstered, no weapon), `crawl_knife`,
`crawl_idle`, `crawl_idle_unarmed`, `prone_aim`, `prone_shoot` (bolt action), `prone_shoot_smg`, `prone_pistol_aim`,
`prone_pistol_shoot`, `go_prone`, `get_up`, `die_prone`, `dead_prone`, `prone_turn_l`, `prone_turn_r`.

**Runtime:**
- `src/art/characters/prone-fit.js`: once per character template + clip, the prone clips are fitted to that body
  (MPFB bodies differ a lot: the Green Beret's legs are 1.21x UAL, greatcoats add 3-5 cm): belly on the ground (lift or
  lower), each upper arm re-aimed so the forearm's lowest vertex touches the ground on planted frames (1.5 cm skim on
  reach frames), each ankle moved so the leg / boot touches. Transitions fade the fit in as a part nears the ground.
- `src/art/characters/prone-grips.js`: the weapon rides the hand bone in every prone clip (rifle / Kar98k / harpoon:
  right fist at `sling_f`, handguard over the forearm, butt dragging; SMG: fist on the foregrip, magazine outboard (MP40: fist on the magazine, gun upright);
  knife in the fist; pistol holstered). All four weapon codes use it (`pipeline/weapons.js`, `commandos_b/weapons.js`,
  `guests/weapons.js`, `enemies/enemy_weapons.js`); `go_prone` / `get_up` carry the gun in the right fist; `weapon-handover.js` blends every hand-over (sling <-> hands, right <-> left hand) over 0.25 s.
- `src/art/prone-ground.js` (called by `unit-model.js`): the body pitches / rolls to the real terrain (`world.groundY`
  under chest, feet and both sides), elbows and ankles follow the local relief, and the displayed heading turns at
  ≤ 75°/s (112°/s while crawling) about the chest with `prone_turn_l/_r` while lying still. View-side only.
- `unit-anim-map.js`: prone branch (`proneAnim`) by carry class: crawl / idle / aim / shoot / pistol / death.
  `unit-model.js` inserts `go_prone` / `get_up` for runtimes without their own (commandos_b, enemies) and shows the
  knife while the Green Beret crawls with the knife cursor up (`readyTool`, view only).

**Deviations from §3-4:** `crawl_idle` keeps the crawl hold (rifle over the forearms, right fist at the swivel) so
`crawl` ↔ `crawl_idle` never moves the gun; in `prone_aim` / `prone_shoot` the gun rides the LEFT (support) hand so the
right hand can work the bolt; the drawn-up knee is abducted ~80° (the long stroke needs the foot close to the hip);
turning uses an in-place loop and the view-side yaw rather than a baked 45° root turn.

**Checks:** `tests/unit/prone-anims.test.mjs` (elbows / forearms within 3 cm of the ground while planted, skate < 1.5 cm,
palms never on the ground, pelvis 0.11-0.16 m, head level ±20°, soles never up, rifle swivel in the fist, muzzle ≥ 0.08 m,
butt dragging, right hand on the grip while aiming, set present in every library, `mapAnim` prone branch) and
`tests/crawl.test.mjs` (in game, M02: rifle in the hand, elbows on the terrain, 0.9 m/s gait, knife crawl, prone death,
LOD2 + X-ray renders, screenshot).

**Screenshots:** `docs/screenshots/crawl-{sniper,greenberet-knife,rifleman}-side.jpg` (side / top / 3-4 view, 8 frames
per cycle) and `crawl-{sniper,greenberet-knife,rifleman}-game.jpg` (game camera, zoom 1 and 2, 8 frames per cycle).

**feat/phase3 (wind flutter):** the new clips only move bones; the recommended follow-up (flutter × 0.3 while prone) stands.

## 9. Review fixes (second pass)

An in-game review of the first build (M1 / M2, close-up and zoom 1-2) confirmed the core complaint was fixed and listed these
defects. All of them are fixed:

| Defect | Fix |
|---|---|
| Chest propped up (shoulder joints 0.22-0.35 m) and bobbing ~13 cm per stroke, upper arm near vertical mid-pull; the pelvis stopped in the reach (13-20 cm/s) and lunged in the pull (150 cm/s, jumping 70 → 150 cm/s in one tick) | `crawl.mjs`: T 0.9 s with 0.405 m strokes, so the shoulder only travels ~0.21 m past a planted elbow (`PULL`). The catch and finish sit symmetrically on the circle the upper arm reaches at the flat-torso shoulder height (`dyN` from the rig), and in the reach the elbow swings out round the shoulder instead of passing under it. The body speed is `v·(1 + 0.4·cos)`. Roll is ±8°. In game (Driver): shoulders 0.24-0.30 m, pelvis 51-127 cm/s with no jumps. `prone-fit.js` lets the belly and chest gear press 1 cm into the ground (`TRUNK_CLEAR`) instead of propping the body on a buckle |
| Planted elbows slid 25-55 cm/s in the world on every runtime (the UAL clip was fine; the per-body proportions and the trunk / forearm fits moved them) | `prone-fit.js` step 4, `pinElbows`: for each planted run the elbow is pinned to its best-fit ground point, which moves back at the playback root speed (`groundSpeed × pelvisRatio` per clip second). It is reached by sliding the scapula (clavicle, in the ground plane only) and aiming the upper arm, with the forearm, hand and gun keeping their world rotation. The correction is eased across the reach frames. In game: 0-8 cm/s while planted |
| Catch reach short: the fists ended at the chin (reads as hands on the head from behind) | Forearms straighter at the catch (12-22° inward): the fists are 0.38-0.42 m ahead of the shoulders and 0.26-0.30 m ahead of the head bone |
| Free (left) hand flat, palm down on the snow | A loose fist on its little-finger side in every crawl (`crawl.mjs`: no flat-palm style left) |
| MP40 looked crosswise: its 25 cm magazine, rolled outboard, stuck out sideways | `crawl_mp40` grip (`grip_build.mjs`): the fist holds the magazine, and the gun stands upright above it, pointing forward (in game: 11° yaw, 8° pitch). The Thompson keeps the foregrip grip. `proneGrip` looks up a per-weapon grip before the per-class one |
| Rifle popped upright for ~6 frames when prone_shoot (support hand) handed over to crawl_idle / prone_turn (right fist) | `src/art/characters/weapon-handover.js`, called last in every charkit `update`: when the weapon's placement key changes (`h._wKey`: prone grip hand, drop, other holds), the gun is blended in character-root space from where it was drawn to its new placement over 0.25 s |
| prone_shoot cut after ~0.3 s (the bolt cycle was never seen) | `unit-model.js`: a prone shot clip (`prone_shoot`, `prone_shoot_smg`, `prone_pistol_shoot`) plays to its end. The follow-up anim waits, except death or locomotion |
| German prone death: the rifle became a ground prop within 8 ticks and lay under the torso | `enemy_weapons.js`: the fist carries the gun, which keeps its lie, until 0.45 s. It is then released to the ground beside the right arm (x ≤ -0.42 m), muzzle forward, and the hand-over blend rolls it off |
| go_prone: 10-14 cm "knee" penetration at 0.05-0.15 s (it was the toes: the 0.2 s cross-fade from the standing foot to the kneeling one); the slung rifle stuck up off the back; get_up snapped the rifle from the hands to the back | Cross-fade into go_prone is 0.08 s (unit-model, guestkit, ca_runtime), since go_prone starts on the idle frame. Transition fits also lift the body over its lowest limb. go_prone / get_up now carry the gun in the right fist (crawl grip, `BY_CLIP`), with the right-hand keys re-authored so the rifle is carried low and forward. The hand-over blend moves it between the sling and the hands |
| Slopes: uphill, joints 3-5 cm lower than on the flat | `prone-ground.js`: the slope tilt now turns the body about the unit origin on the ground. Only the lagging heading pivots about the chest. Pivoting the tilt about the chest had sunk the body by 0.3·tan(slope). On the M1 drift the minimums are now elbow 0.036 m, knee 0.048 m and toe 0.056 m |
| Enemy (zoomed-out) crawl updated every other frame | `humanoid-real.js`: the LOD half-rate mixer step is skipped for the moving crawl clips (planted contacts move against the root every frame) |

## 10. Alternating elbows (third pass, feat/locomotion)

User (2026-09-30, while playing): *"when crawling alternate between left / right arm, don't use both arms"*. The first two
builds pulled with both forearms at once. The crawl is now a **contralateral elbow crawl** (FM high-crawl rhythm on the
low-crawl body); legs, body speed, grips and the weapon carry are unchanged.

| | As built (`crawl.mjs`, `ARM`) |
|---|---|
| Rhythm | Left elbow + right knee pull / push through the first half (0.45 s), right elbow + left knee through the second. The arms run exactly half a cycle apart |
| Plant | Each elbow lands at 8% of a half *before* its own half (on the slow glide) and lifts at 84% of it: planted 0.41 s per cycle (46%), never both at once; a 36 ms glide with neither planted |
| Pull | Shoulder travel past the planted elbow `PULL_A` = 0.26 m: catch 0.13 m ahead of the shoulder, finish 0.13 m behind it, on the upper-arm circle |
| Reach | The free forearm (with the rifle, on the right) skims forward 1 to 1.5 cm up, swinging out round the shoulder. Its motion eases in and out **in the world**, so it peels off and settles onto the ground at rest (no slide into or out of a plant). Fists reach 0.38 m ahead of the shoulder at each catch |
| Shoulders | Torso flat. Per side, the scapula slides (protracted 6 cm at the catch, retracted at the finish) and the pulling shoulder alone lifts by clavicle elevation (solved per frame so its upper arm reaches the elbow exactly). The chest rolls ±6° with the arms (pulling shoulder up mid-pull), the hips ±8° with the legs. Shoulder joints 0.218 to 0.243 m |
| Weapon | Unchanged hold: right fist at the front swivel, handguard on the right forearm, butt dragging. The grip frame is built at the right elbow's catch (t = T/2) |
| Turning on the spot | `prone_turn_l/_r`: the elbows step one at a time, half a loop apart |
| Idle / transitions | `crawl_idle`, `go_prone`, `get_up`, aim and death clips keep the symmetric idle pose (both elbows at the catch). Entering the crawl at t = 0 matches the left arm; the right forearm blends back into its reach in the 0.2 s cross-fade |

**Checks:** `tests/unit/prone-anims.test.mjs` "elbows ALTERNATE": per cycle the left and right elbow forward-travel peaks are
0.5 ± 0.1 cycle apart, each elbow strokes > 18 cm, the planted runs (almost) never overlap, both forearms never swing
forward together, the knee drawn up at an elbow's catch is the opposite one, and planted boots slide < 3 cm. The planted
elbow skate (< 1.5 cm) and flat-chest checks still hold. `tests/crawl.test.mjs` (in game, M02 Sniper): each forearm swings
in turn and never together (`alt.both` = 0), planted elbows 0.06 m/s. Strip: `docs/screenshots/crawl-alternate-strip.jpg`.
