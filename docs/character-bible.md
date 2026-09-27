# SHADOW SIX: character bible

This bible exists because of a user complaint: "All characters' faces look the same. Add some variety, make them look like the characters in the original game."

It tells artists, the MPFB build scripts and the portrait generators how to make:
- six commandos who are clearly different from each other and recognisable as the 1998 *Commandos: Behind Enemy Lines* (BEL) team;
- German soldiers who vary enough that no two standing near each other look identical;
- the guest characters.

It does **not** copy the original portrait artwork. Every description below is a list of generic traits, written so that a new, original face can be built from it.

Related docs:
- `design-spec.md` §3.0: canonical names and silhouettes. §3.3 of this bible corrects three of the headgear cues listed there.
- §6.3: talking portraits. §10.6: content rules.
- `realism-pipeline.md`: MPFB2 bodies and the "every German has the same face" finding.
- `research-raw/characters.md`: bios and stats. `research-raw/visuals.md`: sprites, HUD and voices.

---

## 0. Ground rules

### 0.1 Source tags
Every trait carries a tag that says where it comes from.

| Tag | Meaning |
|---|---|
| **[HUD]** | The original in-game top-bar portraits. I viewed crops of native 640×480 BEL screenshots (M1, M2, the tutorial) and a fandom M1 capture. Unselected portraits are **greyscale**; the selected commando's portrait is in **warm colour**. |
| **[team]** | The Pyro Studios BEL-era team artwork: all six heads plus a seventh, with the Green Beret in front (fandom file `Bel_team_pyro.jpg`). |
| **[art]** | Other BEL-era artwork: the "Keep an original CD" Green Beret screen, and the Sniper kneeling-with-rifle render (`Duke_art.jpg`). |
| **[dossier]** | The official-site "Commandos Headquarter Data Files" dossiers mirrored on CommandosHQ and fandom. |
| **[manual]** | The 1998 US manual (`bel_manual.txt`). |
| **[sprite]** | The in-game unit sprites, 22–28 px tall. |
| **[C2]** | Commandos 2 (2001) renders. These are secondary hints only: a C2 trait is used only when BEL shows nothing that contradicts it. |
| **[ours]** | Our own art-direction choice, made where the original shows nothing (hair under a hat, eye colour and so on). Chosen for variety and plausibility. |

### 0.2 Likeness and IP rules (hard)
- **No real person's likeness.**
  - A producer once said the Green Beret was modelled on a film role played by a well-known actor. **Ignore that.** Describe and build him only from the generic traits below. Never put an actor's name, or "looks like …", into a prompt.
  - The Sniper's dossier photo is a retouched version of a **real WWII photograph of a real officer**. Never use it as a reference, as an img2img input or for face matching.
  - Portrait generators get **text prompts only**. No face-reference or IP-adapter input taken from the original art or from photographs of real people. This follows the no-cloning rule in `realism-pipeline.md` §1.8.
- **No tracing.** Reference images live only in the scratchpad (`refs/characters/`) for internal viewing and are **never shipped**. The traits here are generic ("shaved head, gaunt, big ears"), and any one of them could describe thousands of men.
- **No swastikas, SS runes or death's-head badges** anywhere (spec §10.6). Where real insignia would contain one, §5.4 gives a substitute.

### 0.3 Canon age against apparent age
- By birth date, all six commandos are **29 to 31 in February 1941** and 33 to 35 in 1945 (born 1909–1911).
- The original portraits and art make them look **older and harder-lived** than that. Duke has a gaunt, deeply lined face; the Sapper and the Spy have fleshy, middle-aged faces.
- If we built every face at "age 30", we would recreate exactly the sameness the user complained about.
- **Rule:** each commando gets an *apparent-age* band that matches the original's reading of him, stays plausible for a hard-living man of about 30 to 35, and **differs from all the other five**:

| Apparent age | Commando |
|---|---|
| 28–32 | Marine |
| 32–36 | Green Beret |
| 34–38 | Driver |
| 36–40 | Spy |
| 38–42 | Sapper |
| 40–44 (the "oldest-looking") | Sniper |

- The UI and dossier text still show the **canon** birth dates.

### 0.4 MPFB2 parameter conventions (used in every brief)
The bodies come from `mpfb_make2.py` (MakeHuman CC0 system assets, macros `gender age muscle weight proportions height race`).

- **age macro:** 0.5 = 25 years; each year above 25 adds 1/130. So `age = 0.5 + (years − 25) / 130`. That gives 30 → 0.538, 35 → 0.577, 40 → 0.615, 44 → 0.646, 50 → 0.692, 55 → 0.731.
- **muscle / weight:** 0.5 = average. Ranges below are 0–1.
- **height:** a target in metres. Calibrate the macro against the measured mesh height; do not trust the macro value alone.
- **Face modifiers:** named in MakeHuman modifier-group style (`head/head-square`, `nose/nose-hump-incr`, `chin/chin-prominent-incr`, `eyebrows/eyebrows-trans-down`, `ears/r-ear-size-incr`, …).
  - Values are −1…+1 targets. **Check the exact names against MPFB2's `modeling_modifiers.json` before scripting.**
  - These modifiers are the *main* means of variety. Skin and hair alone are not enough.
- **Skins:** MakeHuman CC0 system skins, tinted by the existing `tint` step:
  - `young_caucasian_male` for the Marine;
  - `middleage_caucasian_male` for the Green Beret, Driver, Spy, Sapper and Sniper, with the Sniper at `old_caucasian_male` blend 0.25 if available.
  - Add a per-character **complexion overlay** (redness, tan, stubble, scars) as a small decal texture on the head UV.
- **Hair and facial hair:**
  - Hair from the CC0 system assets (`short02` and similar), recoloured.
  - **Moustaches and stubble** are our own cards or decals: a stubble layer in the skin albedo and normal, and a moustache as an alpha-card mesh.
  - Community beard assets are only allowed after a per-asset licence check.
- **Headgear hides hair** (`hideHair`). Model the hair anyway for close zoom and for bare-headed states: the Sniper, the Spy disguised, dead bodies that have lost their helmet.

---

## 1. The six commandos

### 1.1 Green Beret: Jerry McHale "Tiny" (EU: Jack O'Hara "Butcher")

| Field | Value |
|---|---|
| Key / role id | 1 / `greenberet` |
| Names | **Jerry McHale "Tiny"** (US manual). EU, official site and HD remaster: **Jack O'Hara "Butcher"**. |
| Born; age | 10 Oct 1909, Dublin. **31** in Feb 1941, 35 in 1945. **Apparent 32–36.** |
| Nationality | Irish. Former Army heavyweight boxing champion 1934–37; a sergeant. |
| Height / build | **2.00 m** (spec; the sources say 1.96–2.10), about 100 kg. **The biggest and strongest of the six** [manual: "Tiny is your strongest"]. Heavyweight boxer's frame: very broad shoulders, huge upper arms and forearms, thick neck, deep chest. Some waist thickness, but not fat. |
| Face shape | **Broad and square**, heavy [HUD, team]. A wide, flat-planed face with high, hard cheekbones. |
| Jaw / chin | **Massive, square, wide jaw**; a strong, slightly jutting chin [HUD, art]. Thick neck muscle runs straight down from the jaw corners. |
| Nose | **Broad, flattened boxer's nose.** Low, wide bridge, a slight kink from old breaks [HUD reads broad; the break is ours, justified by the boxing bio]. |
| Brows | **Heavy, dark, straight brows** low over the eyes; a thick brow ridge [HUD]. A small scar notch through the left brow [ours]. |
| Eyes | Deep-set, narrowed, a hard squint. **Pale grey-blue** [ours]. |
| Skin | Weathered and ruddy [HUD colour reads warm tan-ruddy]: an outdoors Irishman, broken capillaries on the cheeks, a faint scar on the upper lip [ours], thickened ears (mild "cauliflower" on the left) [ours, boxing]. |
| Hair | Short **dark brown**, cropped short-back-and-sides, mostly hidden by the beret [HUD, team]. |
| Facial hair | **Clean-shaven** in the HUD portrait and team art. Some BEL promo paintings show a heavy moustache; we **do not** use it, so that he stays distinct from the Sapper. Allow a light 1-day shadow. |
| Expression | A hard, confident, half-contemptuous look, the mouth a flat line or a slight sneer [team]. "Only his mom can call him tiny." |
| Headgear | **Beret**: very dark bottle-green to near-black in the portraits [HUD, team]. Worn pulled right with a cap badge over the left eye (a generic Commando dagger-style badge [ours; no real unit crest]). |
| Uniform (original) | **Sleeveless** camouflage top, a mottled green-brown brushstroke pattern [team, art], with **bare, massive arms**. Webbing **braces or suspenders** crossing the chest [team, art], and a roll-neck under it in some art [team]. Dark olive trousers, ammo boots. |
| Sprite colours [sprite, M1] | Dark olive-green torso, **bare tan arms** (the key read at 25 px), dark beret, olive legs. |
| Gear | Commando knife (fighting-knife silhouette) in a sheath on the left chest strap or belt; pistol holster; the decoy (a small box radio) on his belt; an entrenching shovel strapped at the back; the climbing-axe "pick" on his belt. |
| Posture / walk | Heavy, **rolling boxer's walk**: shoulders forward, arms held a little away from the body by their bulk, fists loose. Idle: rolls the neck, cracks the knuckles. Carrying a barrel looks easy (no strain). |
| Voice | Gruff, low baritone-bass, **Irish** ("dat", "outta"), clipped and cocky. "Consider it done!", "Comin' over!", "Huh. Wish I could do dat." |

**Art direction brief.**
- **Portrait:** a photoreal head-and-shoulders portrait of a huge Irish sergeant in his mid-thirties, a former heavyweight boxer.
  - Broad square face, massive jaw, flattened broken nose, heavy low dark brows, deep-set pale grey-blue eyes narrowed in a hard stare.
  - Ruddy, weathered skin with small scars on the brow and lip, a slightly thickened left ear, a thick muscular neck.
  - Clean-shaven with light stubble, short dark-brown hair under a near-black green beret worn low and angled to the right, with a small generic dagger badge.
  - A sleeveless mottled-camouflage top with webbing braces over bare, very muscular shoulders.
  - Low warm key light from the upper left, a dark background, 1940s war-film grit.
- **3D head** (MPFB):
  - macros: `age 0.57` (34 y), `muscle 0.95`, `weight 0.72`, `proportions 0.8`, height 2.00 m;
  - modifiers: `head/head-square +0.8`, `head/head-fat +0.2`, `chin/chin-width-incr +0.6`, `chin/chin-prominent-incr +0.4`, `nose/nose-scale-horiz-incr +0.6`, `nose/nose-hump-decr +0.4` (flattened), `nose/nose-nostrils-width-incr +0.5`, `eyebrows/eyebrows-trans-down +0.5`, `forehead/forehead-scale-vert-decr +0.3`, `cheek/r|l-cheek-bones-incr +0.5`, `neck/neck-scale-horiz-incr +0.8`, `ears/l-ear-flap-incr +0.3`;
  - skin `middleage_caucasian_male`, tinted ruddy (+R);
  - hair `short02`, dark brown, hidden under the beret;
  - no facial-hair card; stubble decal at 25 %.

---

### 1.2 Sniper: Sir Francis T. Woolridge "Duke"

| Field | Value |
|---|---|
| Key / role id | 2 / `sniper` |
| Names | **Sir Francis T. Woolridge "Duke"** (every version). |
| Born; age | 21 Mar 1909, Sheffield. **31** in Mar 1941, 35 in 1945. **Apparent 40–44: the oldest-looking of the six** (gaunt and deeply lined) [HUD, team, art]. |
| Nationality | English aristocrat. Olympic shooter; served in India 1937–39. |
| Height / build | **1.85 m**, lean and wiry, about 75 kg (the bio says 180 lb; we build him thinner to match the art). **The weakest of the six** [manual: "Duke your weakest"]. Long limbs, narrow shoulders, flat chest, sinewy forearms [art]. |
| Face shape | **Long, gaunt, narrow**, with hollow cheeks [HUD, team]. |
| Jaw / chin | Narrow but sharply defined jaw; a long, slightly pointed chin. |
| Nose | **Long, thin, high-bridged, slightly aquiline** ("aristocratic") [team reads long and narrow; the aquiline curve is ours]. |
| Brows | Thin, level, light brown going grey; slightly raised, a cool, appraising look. |
| Eyes | Hooded, narrowed, **pale ice-blue** [ours]; crow's feet from squinting down a scope. |
| Skin | **Weathered, tanned, leathery** [HUD colour reads warm tan; matches the India service]. **Deep nasolabial folds** and forehead lines [HUD, team]. |
| Hair | **Shaved head / very close crop**, with a faint light-brown and grey stubble [HUD, team, art]. **Prominent ears** that stand out from the bare skull [team, HUD]. This is his signature read. |
| Facial hair | **Clean-shaven**, immaculately [HUD, team]. |
| Expression | Cold, detached, faintly amused or bored; a small flat mouth, one corner fractionally up. "Haughty and reserved"; "stand-offish… cold and very calculating" [manual, dossier]. |
| Headgear | **None**: the bare shaved head is the BEL look [HUD, team, art]. The spec's knitted **cap comforter** becomes an *optional* Norway/snow item (M1–M7). It must be a close-fitting khaki wool tube cap, never black (black is the Marine's). |
| Uniform (original) | **Dark green field jacket** (a smock) over **khaki/tan trousers**, a leather **bandolier** of rifle rounds across the chest, a belt pouch, **ankle boots with short puttees or gaiters** [art]. Desert missions: a khaki drill shirt [ours]. |
| Sprite colours | Not verified from sprites. Build dark green top over khaki legs, with a bare skin-tone head (the scalp is a highlight at 25 px). |
| Gear | A **long bolt-action rifle with a telescopic sight** carried slung on the back, muzzle up [art]. The fandom wiki says it is a Springfield; the art shows a generic scoped bolt-action with a wooden full stock. Brass cartridges in the bandolier; a pistol; the first-aid kit (when the Driver and Spy are absent). |
| Posture / walk | **Upright, stiff, unhurried**, a slight lean back: officer-class bearing even as a private. Long, measured strides. Kneels to fire [dossier tip]. Idle: checks the scope, or reads a pocket book (**he reads Shelley under fire** [manual]). |
| Voice | **Upper-class RP**, cool, ice-cold, clipped, almost bored. The answer to a kill order is a casual "Yep…" [visuals]. Mid-to-high baritone, a slow cadence. |

**Art direction brief.**
- **Portrait:** a photoreal portrait of a lean English aristocrat-marksman who looks about 42.
  - A **clean-shaven, shaved head** with faint grey stubble, prominent ears, a long gaunt face with hollow cheeks and deep nasolabial lines.
  - A long thin high-bridged nose, a narrow defined jaw, hooded pale ice-blue eyes with crow's feet, thin level brows, and a cool, faintly superior expression.
  - Leathery tanned skin.
  - A dark-green field smock with a leather cartridge bandolier across the chest; the scope of a slung rifle visible over one shoulder.
  - Soft cool key light; a composed, patient, detached mood.
- **3D head** (MPFB):
  - macros: `age 0.635` (43 y apparent), `muscle 0.45`, `weight 0.30`, `proportions 0.9`, height 1.85 m;
  - modifiers: `head/head-oval +0.4`, `head/head-rectangular +0.3`, `cheek/r|l-cheek-volume-decr +0.8`, `cheek/r|l-cheek-bones-incr +0.3`, `nose/nose-scale-vert-incr +0.5`, `nose/nose-hump-incr +0.3`, `nose/nose-scale-horiz-decr +0.4`, `chin/chin-height-incr +0.4`, `chin/chin-width-decr +0.3`, `ears/r|l-ear-flap-incr +0.7`, `ears/r|l-ear-size-incr +0.4`, `eyes/r|l-eye-height2-decr +0.3` (hooded), `mouth/mouth-scale-horiz-decr +0.2`;
  - skin `middleage_caucasian_male` blended 25 % toward `old_caucasian_male`, tinted tan;
  - hair: none (a scalp-stubble decal, light brown and grey);
  - facial hair: none.

---

### 1.3 Marine: James Blackwood "Fins"

| Field | Value |
|---|---|
| Key / role id | 3 / `diver` |
| Names | **James Blackwood "Fins"**. Called "Diver" from C2 on. |
| Born; age | 3 Aug 1911, Melbourne. **29** in Feb 1941, 33 in 1945. **Apparent 28–32: the youngest-looking.** |
| Nationality | Australian, educated at Oxford. Naval engineer, rower, Channel swimmer. An ex-captain demoted for a brawl; drinks. |
| Height / build | **1.81 m**, about 82 kg. A **swimmer's build**: long torso, broad lats and shoulders, narrow hips, long arms. Wiry rather than bulky. |
| Face shape | **Long and narrow, lean**, slightly hollow under the cheekbones [HUD, team]. |
| Jaw / chin | Angular, narrow jaw, a pointed chin, covered in stubble. |
| Nose | **Long and straight**, a narrow bridge [HUD]. |
| Brows | **Dark, thick, slightly slanted** (outer ends down), giving a sardonic, world-weary look [HUD]. |
| Eyes | **Deep-set, dark brown**, heavy-lidded; the "morning after" look [HUD reads dark; hint of shadows under the eyes from the drinking bio]. |
| Skin | **Sun-weathered olive-tan**: sea and sun, salt-dried, wind-chapped lips [HUD colour reads darker than the others]. |
| Hair | **Black**, short, mostly hidden under the cap; a few strands at the temples [HUD, team]. |
| Facial hair | **Heavy dark stubble / 3–5-day growth** over the jaw and upper lip [HUD, team]. This is his signature, and the only commando with a scruffy face. |
| Expression | **Sardonic half-smirk**, one corner of the mouth up, eyebrows slightly raised: "polite", but sarcastic and a bit annoyed [manual, visuals]. |
| Headgear | **Black knitted wool watch cap**, rolled cuff, worn snug on the crown [HUD, team, C2]. |
| Uniform (original) | Dark (navy or black) **roll-neck wool jumper** [ours, reads right with the watch cap], dark trousers, rubber-soled boots. The **diving mask hangs on his chest** (spec). When diving: a **black rubber dry suit** with a closed-circuit rebreather (a chest bag and a small back cylinder), mask and fins (realism-pipeline: a black rubber material, never a skin shader). |
| Sprite colours | Not verified from sprites. Build near-black / dark navy from head to toe, with the mask a pale glint on the chest. **The darkest silhouette on the team.** |
| Gear | Knife; **speargun** (harpoon gun) slung across the back; pistol; the folded inflatable boat as a big grey rubber bundle on his back when carried; diving kit. |
| Posture / walk | Loose, lanky, a slight **rolling sailor's gait**; hands swing wide. Slower than the others (spec). Idle: stretches his back, glances at a hip flask he doesn't drink [ours; a nod to the bio]. |
| Voice | **Australian**, dry and sarcastic; a mid baritone with a drawl and a pause before "sir" ("Coming right over! … sir."). One reviewer heard it as cockney. We cast Australian, per the bio (spec §3.0). |

**Art direction brief.**
- **Portrait:** a photoreal portrait of a lean Australian naval commando of about 30.
  - A long narrow face with hollow cheeks and an angular jaw covered in **heavy dark stubble**.
  - A long straight nose; thick dark slanted brows over deep-set, heavy-lidded dark-brown eyes with faint shadows beneath; a **sardonic lop-sided smirk**.
  - Sun- and salt-weathered olive-tan skin, chapped lips, short black hair under a **black knitted wool watch cap** with a rolled cuff.
  - A dark roll-neck jumper, with a rubber diving mask on a strap hanging on his chest.
  - Cool sea-grey light with a warm rim; an irreverent, hung-over charm.
- **3D head** (MPFB):
  - macros: `age 0.54` (30 y), `muscle 0.70`, `weight 0.45`, `proportions 0.85`, height 1.81 m;
  - modifiers: `head/head-oval +0.5`, `head/head-invertedtriangle +0.3`, `cheek/r|l-cheek-volume-decr +0.5`, `chin/chin-width-decr +0.4`, `chin/chin-prominent-incr +0.2`, `nose/nose-scale-vert-incr +0.3`, `nose/nose-scale-horiz-decr +0.3`, `eyebrows/eyebrows-angle-down +0.4`, `eyes/r|l-eye-move-in +0.2` (deep-set: combine with `forehead` brow-ridge +0.3), `mouth/mouth-angles-up` on one side only (asymmetric smirk, a shape key used by the expression rig);
  - skin `young_caucasian_male`, tinted olive-tan;
  - hair `short02`, black, under the cap;
  - stubble decal at **100 %** (dark, with normal-map grain).

---

### 1.4 Sapper: Thomas Hancock "Inferno" (EU: "Fireman")

| Field | Value |
|---|---|
| Key / role id | 4 / `sapper` |
| Names | **Thomas Hancock "Inferno"** (US). EU and official site: **"Fireman"**. |
| Born; age | 14 Jan 1911, Liverpool. **30** in Feb 1941, 34 in 1945. **Apparent 38–42** (a fleshy, lined, middle-aged face in the HUD and team art; the C2 render greys the moustache). |
| Nationality | English, from Liverpool. A chemistry graduate and ex-Fire Brigade explosives specialist; escaped a PoW camp over the Pyrenees. |
| Height / build | **1.78 m: the shortest of the six**, about 80 kg. **Compact and stocky**: barrel chest, short thick neck, strong hands, a slight paunch [ours; reads right with the fleshy face]. |
| Face shape | **Round-square, fleshy** with full cheeks [team, HUD]. |
| Jaw / chin | A softish, broad jaw with the start of jowls; a rounded chin. |
| Nose | **Short, fleshy, bulbous tip**, reddened [team; the redness is ours]. |
| Brows | Medium-thick, **mid-brown flecked with grey**, arched and mobile: an expressive, excitable face. |
| Eyes | Small, bright, crinkled when he grins; **hazel** [ours]. Laugh lines. |
| Skin | **Fair English complexion, ruddy-red cheeks and nose**; a few small pale **flash-burn marks** on the backs of the hands and one on the cheekbone [ours; the fireman/explosives bio]. |
| Hair | **Mid-brown going grey at the temples**, short, under the helmet [ours]. |
| Facial hair | **A thick brush moustache**, bristly and straight-cut, mid-brown salted with grey [HUD, team; greyer in C2]. **The only moustache on the team.** |
| Expression | A **broad, toothy, slightly manic grin** [HUD M2], or a gleeful "watch this" look. "An English gentleman, but with an explosive temper" [manual]: the grin flips to a red-faced scowl. |
| Headgear | A **steel helmet**, painted mid-green [team, HUD]. The BEL art shows a **domed helmet with a short, slightly flared brim**, not the wide flat Brodie dish the spec named. **Decision:** follow the original's domed, short-brim profile (a Mk III-style shape [ours]), with a chin strap and camouflage netting in Europe. This still reads "helmet" at 25 px and is distinct from every German M35. |
| Uniform (original) | **Brown leather jerkin** over a khaki battledress [C2, consistent with the brown tones in the team art], with **grenades hung on the chest straps** [C2]. A canvas **satchel** of charges on the hip (spec); wire cutters in a leg pocket; khaki trousers with anklets. |
| Sprite colours | Not verified. Build a brown/khaki body with a green helmet dome, and the satchel as a darker block at the hip. |
| Gear | Pistol; bear traps (a steel-jaw trap clipped to the satchel); time and remote bombs (packets with wires); **grenades on the chest**; wire cutters; a remote detonator box. |
| Posture / walk | **Brisk, bustling, compact strides**, leaning slightly forward and eager to get to the next thing. Idle: fiddles with wires, pats his pockets, checks a pocket watch (time bombs) [ours]. |
| Voice | **English, northern (Liverpool)**, cheerful and quick-fire, turning irritable. Dry humour (spec: "dry northern English"). A mid-high baritone. |

**Art direction brief.**
- **Portrait:** a photoreal portrait of a stocky English demolitions expert who looks about 40.
  - A round-square fleshy face with full ruddy cheeks and a reddened bulbous nose.
  - A **thick bristly brush moustache**, mid-brown salted with grey; small bright hazel eyes with laugh lines; arched expressive greying brows.
  - A **broad, slightly manic toothy grin**, and a few small pale burn scars on one cheekbone.
  - A domed green steel helmet with a short flared brim and a chin strap; a brown leather jerkin over khaki battledress with grenades hung on the chest straps.
  - Warm light, flecks of soot, cheerful menace.
- **3D head** (MPFB):
  - macros: `age 0.615` (40 y), `muscle 0.60`, `weight 0.62`, `proportions 0.6`, height 1.78 m;
  - modifiers: `head/head-round +0.5`, `head/head-square +0.3`, `head/head-fat +0.4`, `cheek/r|l-cheek-volume-incr +0.6`, `nose/nose-scale-vert-decr +0.3`, `nose/nose-point-width-incr +0.6` (bulbous), `nose/nose-volume-incr +0.4`, `chin/chin-prominent-decr +0.2`, `neck/neck-scale-vert-decr +0.4`, `neck/neck-scale-horiz-incr +0.4`, `eyes/r|l-eye-size-decr +0.2`, `eyebrows/eyebrows-angle-up +0.3`;
  - skin `middleage_caucasian_male`, tinted fair with red cheeks and nose (a redness mask);
  - hair `short02`, mid-brown with 30 % grey at the temples;
  - **brush-moustache card** (mid-brown and grey); light stubble at 15 %.

---

### 1.5 Driver: Sid Perkins "Tread" (later canon: Samuel Brooklyn)

| Field | Value |
|---|---|
| Key / role id | 5 / `driver` |
| Names | **Sid Perkins "Tread"** (the US manual; once "Sam"). Later canon: **Samuel Brooklyn**, with "Sid Perkins" as his alias. "We will probably never know his real name" [manual]. |
| Born; age | 4 Apr 1910, Brooklyn. **30** in Feb 1941, 34 in 1945. **Apparent 34–38** (a jowly, deeply creased face in the HUD). |
| Nationality | American, from Brooklyn, New York. A career criminal who fled US justice in 1937; "education he received on the street" [manual]. |
| Height / build | **1.83 m**, about 85 kg. **Thickset and heavy-boned**: broad back, thick waist, big hands, **fast on his feet** despite the bulk (tied fastest runner). |
| Face shape | **Broad and fleshy, wide lower face**, jowly [HUD, team]. |
| Jaw / chin | A wide, heavy jaw with soft jowls; a broad rounded chin. |
| Nose | **Wide, pug-like, slightly upturned**, broad nostrils [HUD, team]. |
| Brows | Thick, **low and bushy**, sandy-brown [ours for colour]. |
| Eyes | Smallish, **warm brown**, crinkled; a street-wise twinkle [ours]. |
| Skin | **Ruddy-tan, weathered and creased**; **deep nasolabial folds** [HUD]. **Burn scars:** the manual says the Tamet airfield raid (Dec 1941) "left him with serious burns". From **M8 (Oct 1942) onward**, he has glossy mottled burn scarring on the **left side of the neck and jaw, running up to the ear, and on the back of the left hand**. None in M1–M7 [ours, from the bio]. |
| Hair | **Sandy / dirty-blond**, short, visible at the sides under the cap [ours: gives the team one fair head]. |
| Facial hair | **Clean-shaven** [HUD, team]; a slightly patchy shave line [ours]. |
| Expression | **Cheerful, eager grin**; a faint smile even at rest [HUD colour]. "Cheerful but occasionally timid" [manual]: in the idle-scared state his brows lift. |
| Headgear | A **camouflage-pattern peaked field cap** (mottled green and brown, soft crown, short stiff peak) [HUD colour, team; C2 also has a peaked field cap]. **This corrects spec §3.0**, which gave him a "leather cap and goggles". In the original, the leather flying helmet and goggles belong to the pilot McRae (§6.1). Driving goggles may **hang round his neck** as a secondary cue [ours]. |
| Uniform (original) | A **dark olive-green** uniform shirt or tunic and trousers [sprite M1, HUD colour]. In the desert (M8–M12): a khaki shirt with rolled sleeves and a sand scarf [ours]. C2 gives him a brown leather jacket and camouflage trousers; we keep that as a Europe-1944 variant only. |
| Sprite colours [sprite, M1] | **Dark green head to toe** plus the cap. At 25 px he and the Green Beret are both green, and the difference is the **Driver's sleeves and cap peak against the Beret's bare arms and beret** (visuals.md). Keep his uniform a lighter, yellower green than the Green Beret's olive-black. |
| Gear | Pistol; **a submachine gun or full-auto rifle** slung across the chest (Thompson-type drum or stick silhouette [ours]); the **first-aid kit** in a white canvas bag with a red cross (he is the default medic); a spanner in the back pocket [ours]. |
| Posture / walk | **Springy, bouncy, eager**, a little swagger; shoulders loose, hands in pockets when idle, chewing gum [ours]. Runs flat out, arms pumping. |
| Voice | **Brooklyn accent**, enthusiastic, a fast talker: "Sure thing!", "Okie dokie!", "Consider it done, boss!", "This looks bad!" A mid baritone with a rasp. |

**Art direction brief.**
- **Portrait:** a photoreal portrait of a thickset Brooklyn ex-con turned commando driver who looks about 36.
  - A broad, fleshy, jowly face with deep smile creases, a wide pug nose, thick low bushy sandy brows and small twinkling brown eyes.
  - A **cheerful, eager, slightly cheeky grin**; ruddy, weathered, clean-shaven skin.
  - Short sandy-blond hair under a **mottled green-brown camouflage peaked field cap**.
  - A dark olive uniform shirt, driving goggles hanging at the throat, a submachine-gun sling across the chest.
  - For desert and late-war shots: **glossy burn scarring down the left side of the neck and jaw**.
  - Warm key light; a street-smart, friendly toughness.
- **3D head** (MPFB):
  - macros: `age 0.585` (36 y), `muscle 0.65`, `weight 0.65`, `proportions 0.65`, height 1.83 m;
  - modifiers: `head/head-square +0.3`, `head/head-fat +0.6`, `head/head-round +0.3`, `cheek/r|l-cheek-volume-incr +0.5`, `chin/chin-width-incr +0.5`, `nose/nose-scale-horiz-incr +0.5`, `nose/nose-scale-vert-decr +0.3`, `nose/nose-septumangle-incr +0.4` (upturned), `nose/nose-nostrils-width-incr +0.5`, `eyebrows/eyebrows-trans-down +0.4`, `eyes/r|l-eye-size-decr +0.2`, `mouth/mouth-scale-horiz-incr +0.3`;
  - skin `middleage_caucasian_male`, tinted ruddy-tan, plus a **burn-scar decal** (left neck, jaw, ear, hand) switched on by a mission flag `driverBurns` for M8 and later;
  - hair `short02`, sandy blond;
  - clean-shaven.

---

### 1.6 Spy: René Duchamp "Spooky" (EU: "Frenchy")

| Field | Value |
|---|---|
| Key / role id | 6 / `spy` |
| Names | **René Duchamp "Spooky"** (US). EU and official site: **"Frenchy"**. |
| Born; age | 20 Nov 1911, Lyon. **29** in Feb 1941, 33 in 1945. **Apparent 36–40** [team: a soft, middle-aged civilian face]. During BEL development he had a "younger appearance" (a beta image on the Windows inside cover), which confirms that the final art deliberately aged him. |
| Nationality | French. Secret Service; ex-security chief at the Berlin embassy; Resistance co-founder. Speaks five languages; **imitates German generals' voices and expressions** [manual]. |
| Height / build | **1.79 m**, about 80 kg (the dossier's 6'4" is an outlier). **Soft, well-fed, unathletic civilian build**: narrow shoulders, a slight belly, delicate hands. The **least military-looking body**, which is exactly why he passes as anything. |
| Face shape | **Oval and fleshy**, soft features, a slightly heavy lower face [team]. |
| Jaw / chin | A soft jaw, a small rounded chin, a hint of a double chin. |
| Nose | **Medium, straight and slightly long, with a rounded tip**; the glasses sit on it [team]. |
| Brows | Fine, **dark**, neatly arched, expressive (he is an actor). |
| Eyes | **Dark brown, intelligent, amused**, magnified slightly by the lenses. |
| Skin | **Pale, sallow indoor complexion** [ours]: the palest of the six. Smooth and well-kept, faint lines. |
| Hair | **Dark brown / near-black, oiled and combed back** with a neat side parting, slightly receding at the temples [dossier: dark hair; the recession is ours]. |
| Facial hair | **Clean-shaven**, close and neat [team]. (No moustache: that belongs to the Sapper.) |
| Glasses | **Round wire-rimmed spectacles** [team, C2; the dossier photo shows round dark lenses]. **The only commando with glasses**, and his signature. He keeps them on when disguised (plenty of German officers wore them). |
| Expression | **Amiable, faintly amused, knowing half-smile**; "amiable character, great at conversation" [dossier]. When disguised, the mask switches to a stern, haughty German-officer face (his impersonation). |
| Headgear | **Civilian: a tweed flat cap** (brown herringbone, eight-panel "newsboy" or flat cap) [team, C2]. The spec's **fedora and trench coat** is kept as an *alternative* outfit for urban France (M15–M17) only. **Disguised:** a German officer's peaked cap (§5.3; no skull or eagle-swastika badge). |
| Uniform (original) | Civilian: **brown / tan tweed jacket**, a shirt with a dark tie or cravat, a waistcoat, brown trousers, polished shoes [team, C2]. Disguise: field-grey German officer's tunic, breeches and tall boots; the peaked cap (spec). |
| Sprite colours | Not verified. Civilian: brown-tan tones with a dark cap (the only non-military silhouette on the team). Disguised: field grey with a peaked cap, identical in silhouette to an enemy officer, **plus the glint of the round glasses** at close zoom. |
| Gear | Pistol (he dislikes it: "not refined" [manual]); the **poison syringe** in an inside pocket; the first-aid kit (when the Driver is absent). |
| Posture / walk | **Smooth, unhurried, gliding**; hands behind the back or one in a pocket; an attentive head tilt. In disguise: **ramrod-straight officer bearing**, chin up, a gloved hand at the belt. Idle: polishes his glasses [ours]. |
| Voice | **French-accented English**, suave, witty and soft; a light baritone. Switches into flawless clipped German in disguise. (The BCD lines "Revenge is sweet" and "Nazi scum!" are *not* BEL.) |

**Art direction brief.**
- **Portrait:** a photoreal portrait of a soft-featured French secret-service agent who looks about 38.
  - An oval, slightly fleshy clean-shaven face with pale, sallow skin.
  - Dark-brown hair oiled and combed back from a slightly receding hairline, with fine dark arched brows.
  - **Round wire-rimmed spectacles** over intelligent, amused dark-brown eyes, and a **knowing half-smile**.
  - A brown herringbone tweed flat cap, a tan tweed jacket, a waistcoat and a dark knitted tie.
  - Soft window light, the look of a pleasant bookish civilian, with a hint of danger in the eyes.
  - **Disguise variant:** the same face with a stern expression, a German officer's peaked cap and a field-grey collar, with no swastika, runes or skull.
- **3D head** (MPFB):
  - macros: `age 0.60` (38 y), `muscle 0.40`, `weight 0.58`, `proportions 0.55`, height 1.79 m;
  - modifiers: `head/head-oval +0.6`, `head/head-fat +0.3`, `cheek/r|l-cheek-volume-incr +0.3`, `chin/chin-prominent-decr +0.3`, `chin/chin-width-decr +0.2`, `neck/neck-double-incr +0.2` (if present), `nose/nose-scale-vert-incr +0.2`, `nose/nose-point-width-incr +0.2`, `eyebrows/eyebrows-angle-up +0.2`, `forehead/forehead-scale-vert-incr +0.3` (higher hairline), `mouth/mouth-lowerlip-volume-incr +0.2`;
  - skin `middleage_caucasian_male`, tinted pale and sallow (−sat, +Y);
  - hair `short04` (or the nearest slicked-back CC0 system hair), near-black, glossy;
  - **round wire-glasses mesh** (thin torus rims plus a bridge; about 600 tris) on a head bone;
  - clean-shaven.

---

## 2. The six at a glance

### 2.1 Comparison table
Every row differs from every other in **apparent age band, hair and facial hair, and headgear**. Each column on its own is already unique in at least four of the six rows.

| # | Commando | Canon age 1941→45 | Apparent age | Height, build | Face shape | Hair (colour, style) | Facial hair | Headgear | Skin | Eyes | Glasses | Signature cue |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Green Beret "Tiny" | 31→35 | **32–36** | **2.00 m, massive** | Broad **square**, huge jaw, broken nose | Dark brown, cropped | Clean (light stubble) | **Dark-green beret** | Ruddy, scarred | Pale grey-blue | – | Bare boxer's arms |
| 2 | Sniper "Duke" | 31→35 | **40–44** | 1.85 m, **gaunt, lean** | **Long, hollow-cheeked** | **Shaved** (grey stubble) | Clean, immaculate | **None, bare head** (khaki cap comforter optional in snow) | Leathery tan | Ice blue | – | Shaved skull, big ears, scoped rifle |
| 3 | Marine "Fins" | 29→33 | **28–32** | 1.81 m, swimmer | **Long narrow**, angular | **Black**, short | **Heavy dark stubble** | **Black knit watch cap** | Olive sea-tan | Dark brown | – | Stubble, smirk, mask on chest |
| 4 | Sapper "Inferno" | 30→34 | **38–42** | **1.78 m, stocky** | **Round-square, fleshy** | Mid-brown, greying | **Brush moustache** | **Green domed steel helmet** | Fair, red cheeks and nose | Hazel | – | Moustache and manic grin, grenades |
| 5 | Driver "Tread" | 30→34 | **34–38** | 1.83 m, **thickset** | **Broad, jowly**, pug nose | **Sandy blond** | Clean | **Camo peaked field cap** | Ruddy-tan (burn scars from M8) | Warm brown | – | Eager grin, camo cap, SMG |
| 6 | Spy "Spooky" | 29→33 | **36–40** | 1.79 m, **soft civilian** | **Oval, soft** | Near-black, **oiled back**, receding | Clean | **Tweed flat cap** (disguised: officer's peaked cap) | **Pale, sallow** | Dark brown | **Round wire** | Round glasses, tweed |

### 2.2 How to tell them apart at each zoom level
| Distance | What the viewer sees | What must differ |
|---|---|---|
| **Sprite scale (25–45 px, the default camera)** | Headgear shape, uniform value and hue, body mass | beret against bare scalp against watch cap against dome helmet against peaked cap against flat cap; bare arms (Green Beret); near-black (Marine); civilian brown (Spy) |
| **Close zoom (150–300 px tall)** | Face mass, facial hair, glasses, skin tone | the moustache (Sapper), stubble (Marine), glasses (Spy), shaved head (Sniper), huge jaw (Green Beret), jowls and scars (Driver) |
| **HUD portrait (about 64 px)** | Head silhouette plus one feature | Same as close zoom, at 3/4 view angles: the Green Beret and Sniper in 3/4 profile (as in BEL), the others frontal or near-frontal |

Rule of thumb for artists: **squint at a 32 px grey thumbnail of all six.** If two read the same, change headgear value or body mass first, and the face second.

---

## 3. Original in-game look and spec corrections

### 3.1 What was verified in the original
- **HUD portraits** (top bar, native 640×480):
  - **greyscale when unselected, warm full colour when selected**;
  - a red vertical health bar on the right;
  - a stitched brass-and-leather frame;
  - the Green Beret is shown in 3/4 profile facing left, the Sniper frontal or 3/4, the Marine 3/4, the Sapper 3/4 grinning, the Driver frontal.
- **Implement the grey/colour swap in §6.3 talking portraits:** a desaturation uniform set to 1 when unselected and 0 when selected, with a 150 ms tween.
- **Sprites:** the Green Beret and Driver are **both green** in M1 (visuals.md). At the sprite level the Green Beret reads by his **bare, light-coloured arms and dark beret**, the Driver by his **covered arms and peaked cap**.
- The Germans in Norway wear **long field-grey greatcoats and helmets** (`ALEGABAR`); desert units wear tan (`ALEMDES`, `CABODES`).

### 3.2 Not verified (sprites of the Sniper, Marine, Sapper and Spy)
The colours given in §1 for these four come from their BEL portraits and art, with C2 used only where BEL has nothing. They are the build target. Replace them with measured values if someone samples native sprites later. **Do not** let any two commandos share a dominant sprite hue *and* value.

| Commando | Sprite key colours (target) | Value |
|---|---|---|
| Green Beret | olive-black top, **skin-tone arms**, olive legs | mid-dark with bright arms |
| Sniper | dark green smock, **khaki legs**, **skin-tone scalp** | mid, with a bright head |
| Marine | **near-black / navy** head to toe | darkest |
| Sapper | brown leather and khaki, **green helmet dome** | mid-warm |
| Driver | yellow-olive green, camo cap | mid-light green |
| Spy | **tan-brown civilian** and a dark cap; disguised: field grey | light-warm; disguised = enemy |

### 3.3 Corrections to design-spec §3.0 silhouette cues
Proposed. The spec owner should apply them.

| Commando | Spec §3.0 says | Original shows | Change |
|---|---|---|---|
| Sniper | Cap comforter and scoped rifle | **Bare shaved head** [HUD, team, art] | Bare shaved head plus a scoped rifle on the back. The cap comforter becomes optional (Norway), khaki. |
| Sapper | Brodie helmet and satchel | **Domed** green steel helmet with a short brim [team, HUD] | Domed short-brim helmet plus satchel plus grenades on the chest. |
| Driver | Leather cap and goggles | **Camo peaked field cap** [HUD colour, team]; the leather helmet and goggles are the pilot McRae's | Camo peaked field cap; goggles round the neck at most. |
| Spy | Civilian trench coat and fedora | **Tweed flat cap, round wire glasses, tweed jacket** [team] | Flat cap plus round glasses plus tweed jacket; the fedora and trench coat become an alternative for the urban missions. |
| Green Beret | Green beret, bulky | Confirmed; also **sleeveless, bare arms** | Add "sleeveless, bare arms". |
| Marine | Wool cap and diving mask on the chest | Confirmed (a black knit cap) | – |

---

## 4. Portraits and 3D heads: production notes
- **One master head per commando**: a separate GLB head mesh, or the MPFB body with the listed modifiers baked in.
  - Keep **these blend shapes unbaked**: the 34 expression units from `talking-portraits.md` plus 4 character-expression presets: **rest, bark, hurt, dead-skull fade**.
  - The rest-state expression is from §1: the Green Beret's flat sneer, the Sniper's cool half-smile, the Marine's lop-sided smirk, the Sapper's grin, the Driver's eager smile, the Spy's knowing smile.
- **Portrait camera:**
  - 35° 3/4 view for the Green Beret, Marine and Sapper; frontal for the Driver, Sniper and Spy (as in BEL);
  - 85 mm equivalent, key light upper-left (the game's global key direction), warm fill, dark background;
  - graded to the HUD's grey or colour state.
- **Generator prompts** (if a neural portrait model is used):
  - Build them from the "Art direction brief" paragraphs, plus a shared suffix: "photorealistic 1940s WWII portrait, 85mm, film grain, natural skin texture, no text, no insignia with swastika or runes".
  - Negative prompt: "celebrity, famous actor, cartoon, modern haircut, modern gear, swastika, SS runes, skull badge".
  - **Seed-lock** each commando's accepted seed and store it with the licence record.
- **Consistency across views:** the portrait, the close-zoom 3D head and the dossier image must share hair colour, facial hair, headgear, glasses and scars. The **3D head is the source of truth**. Neural portraits are conditioned on a render of the 3D head (depth or normal control), **never** on the original art.
- **Per-mission state:**
  - The Driver's burns from M8 on.
  - Theatre outfits: Norway adds greatcoats and snow cap options; the desert switches to khaki drill; Europe 1944 adds the late variants.
  - Dead: the portrait fades to the skull (spec).
  - The Spy's disguised portrait swaps to the officer's cap while the uniform is worn.

---

## 5. German enemy variety

### 5.1 The problem and the target
- Today there is **one GLB per soldier type, so every German has the same face** (realism-pipeline verifier).
- **Target:** within any camera view, or any squad, **no two soldiers share the same head variant, skin tone, facial hair and glasses combination**, and body height and width vary visibly.
- The original's Germans were deliberately "anonymous grey". The variety should stay **subtle and realistic**: ordinary young conscripts, with no caricatures and no comic villains.
- The **silhouette per type** (helmet, cap, greatcoat, weapon) stays strictly consistent, because it carries the gameplay read.

### 5.2 Seeded variation scheme
**Seed.** `seed = hash32(missionId, spawnId)` (FNV-1a or similar). The PRNG is `mulberry32(seed)`. The same mission therefore always shows the same faces, which keeps saves, replays and screenshots stable.

**Parameters drawn per soldier:**

| Parameter | How it is drawn | Range, or the type's table in §5.3 |
|---|---|---|
| `headVariant` | one of **16 baked head meshes**, or 1 base head with 8 face morph targets whose weights are drawn per instance | archetype weights by type |
| `age` | drives the age morph and the wrinkle-decal strength | type range |
| `height` | skeleton root scale | N(1.74 m, 0.06), clamped 1.64–1.90 |
| `width` | spine and shoulder bone x-scale | 0.94–1.08 |
| `skinTone` | one of 6 tint presets, then ±4 % jitter | pale-pink, fair, fair-ruddy, light-olive, weathered-tan (desert), sunburnt (desert, fresh arrivals) |
| `hairColour` | only visible under caps, or bare-headed and dead | blond 25 %, light brown 30 %, mid brown 28 %, dark brown / black 14 %, red 3 % |
| `facialHair` | per type | none / stubble / moustache / beard |
| `glasses` | 5 % (officers 12 %, NCOs 6 %, riflemen 4 %) | round wire rims |
| `extras` | 0–2 of: bandaged hand, cigarette behind the ear, scarf, rolled sleeves (desert), snow on the shoulders (Norway), missing canteen, bread bag left or right | cosmetic |

**The 16 head archetypes** combine MPFB modifiers; each also gets ±0.15 random jitter on 6 minor modifiers: nose width, nose length, ear size, brow height, lip volume and cheek volume.

| # | Archetype | # | Archetype |
|---|---|---|---|
| 1 | Narrow oval, long nose | 9 | Heavy brow ridge, deep-set eyes |
| 2 | Broad square, wide jaw | 10 | Soft round, small nose ("farm boy") |
| 3 | Round, full cheeks, snub nose | 11 | Angular, high cheekbones, hollow cheeks |
| 4 | Long rectangular, big chin | 12 | Wide-set eyes, flat bridge |
| 5 | Triangular, pointed chin, big ears | 13 | Aquiline nose, narrow lips |
| 6 | Heart-shaped, high forehead | 14 | Heavy jowls (older only) |
| 7 | Gaunt, prominent cheekbones | 15 | Boyish, smooth (teen conscript) |
| 8 | Fleshy, double chin | 16 | Rugged, weathered, broken nose |

**Neighbour rule** (applied at spawn, deterministically):
- Sort spawns by id.
- For each soldier, compare the key `(headVariant, skinTone, facialHair, glasses)` with every soldier **within 30 m or in the same squad**.
- On a collision, redraw `headVariant`, then `skinTone`, using `mulberry32(seed + attempt)` for up to 8 attempts.
- Also forbid identical `headVariant` inside one squad outright. There are 16 variants and a squad has at most 6 men.

**Runtime cost:**
- Skinned meshes are per-instance, so head variants are just different geometry (16 × about 1.5k tris) sharing **one** skin atlas.
- Skin tone is a per-instance tint on the shared material, via `onBeforeCompile` with an instance-colour attribute or a userData uniform.
- Facial hair is a stubble and moustache decal layer selected by a per-instance index into a small 4-slot atlas.
- Glasses are a shared 600-tri mesh toggled per instance.
- Height and width come from bone scale, at no extra cost.

**Uniform variation** (subtle, never breaking the silhouette):
- Fabric tint ±6 % in hue and value, because field grey varied a lot between batches.
- Helmet paint wear (0–1).
- Greatcoat collar up or down.
- Sleeves: rolled (desert) or down.
- Mess tin or no mess tin.

### 5.3 Soldier types: faces, bodies and uniform rules
Ages are real-world plausible for 1941–45. Facial hair follows Wehrmacht grooming: mostly clean-shaven, with stubble in the field; beards only where noted.

| Type (`soldierType`) | Where | Age range | Build | Facial hair odds | Uniform and headgear (must match silhouette) |
|---|---|---|---|---|---|
| **Rifleman** (`soldier`, `trooper`) | everywhere | **18–30** (mode 21) | average; muscle 0.45–0.65, weight 0.35–0.60 | none 70 %, stubble 25 %, moustache 5 % | **Field-grey** (feldgrau) M36/M40 tunic, early **dark bottle-green collar**, stone-grey or field-grey trousers, **jackboots**; **M35 steel helmet** (smooth, field grey, flared "coal-scuttle" skirt); Y-straps, ammo pouches, bread bag, canteen, **fluted gas-mask canister** on the back. Kar98k (riflemen), MP40 (patrol troopers). |
| **Sentry** (`sentry`) | posts, gates, towers | **19–42**: Norway garrisons mix in older reservists (35–42) | wider spread; older = heavier | none 60 %, stubble 25 %, moustache 15 % | As the rifleman. **Norway: long field-grey greatcoat** (to mid-calf, double-breasted, dark-green collar), sometimes a knitted toque under the helmet; a cigarette in the hand when idling (BEL smoking idle). |
| **NCO / sergeant** (`sergeant`) | patrol leaders | **24–38** | sturdier; muscle 0.55–0.75 | none 55 %, **moustache 30 %**, stubble 15 % | **Peaked cap** (spec: the sergeant's read). Tunic with **silver-grey braid (Tresse)** on the collar and shoulder straps, a **Luger holster** on the left front, a map case, **binoculars** on the chest. More upright, confident stance. Sprite sets `CABO` / `CABODES`. |
| **Officer** (`officer`) | trucks, HQs | **28–52** | often slimmer or softer; weight 0.3–0.7 | none 70 %, moustache 20 %, glasses 12 % (independent) | **Peaked cap with silver cords**, a tailored field-grey tunic with **open collar and a shirt and tie** (the M36 officer cut), **riding breeches and tall boots**, a brown belt with a pistol, leather gloves. No medals that carry swastikas (§5.4). |
| **MG gunner** (`mg`) | nests, towers, bunkers | **20–32** | stocky; muscle 0.6–0.8 | none 60 %, stubble 40 % | Helmet (often with foliage or snow-camo netting); **MG34** with a belt of rounds; the gunner's tool pouch; a pistol holster instead of rifle pouches; a spare-barrel case. |
| **Afrika Korps** (`sentry` / `soldier` in M8–M12; sprite set `ALEMDES`) | desert | **19–30** | leaner (weight 0.3–0.5) | none 55 %, stubble 40 %, moustache 5 % | **Olive / khaki tropical drill tunic** (bleached to sand), open collar; trousers or **shorts** (20 %) with **high lace-up canvas-and-leather boots**. Headgear mix: **M35 helmet painted sand** (60 %), the long-peaked **tropical field cap** (30 %), **pith helmet** (10 %, early 1942 only). **Goggles** on the cap or helmet (30 %). Skin: **tanned or sunburnt**, peeling noses, sweat-dark collars. |
| **Winter / mountain troops** | Norway M1–M7 (M2 heavy snow) | **20–35** | average | stubble 50 % (cold), moustache 10 %, **beard 5 %** (remote posts) | Greatcoat or a **white snow smock** over the field grey (the snow map in M2); **mountain troops** (optional flavour in M3–M5): a soft **mountain cap** (Bergmütze) with a short peak, windproof anorak, **puttees and climbing boots**. Red cheeks and noses; breath fog. |
| **Engineer / pioneer** (`engineer`, M16) | bridges, demolitions | **22–38** | sturdy, big hands | none 50 %, stubble 40 %, moustache 10 % | Helmet; field grey with **rolled sleeves**; **work gloves**; a **satchel charge** and a folding shovel; a **detonator box**; black branch colour on the shoulder straps. Must read as "busy workman" so the player spots them as the M16 threat. |
| **Mechanic** (sprite `MECANIC`) | airfields, motor pools | **18–40** | mixed | stubble 50 % | **Grey-drill or black overalls**, a side cap (the soft boat-shaped field cap), oil smears, a spanner. |
| **Truck driver** (`truckDriver`) / **courier** (`courier`) | roads | **20–40** | mixed | as the rifleman | Driver: a **side cap**, tunic. Courier: helmet with **goggles**, a long rubberised **motorcyclist's coat**, gauntlets. **No Feldgendarmerie gorget** (its eagle carries a swastika). |
| **Tank / armoured-car crew** (`crew`) | Panzer II/III/IV, SdKfz 231 | **19–28** | short to medium (1.66–1.78) | none 80 %, stubble 20 % | **Black double-breasted Panzer wrap jacket** and black trousers; **black side cap** (1941: the padded black beret as an option). **Headphones** with a throat mic; pink branch piping. Only seen at close zoom, or when bailing out or dead. |
| **Artillery gunner** (`gunner`, M6 railway gun, coastal guns) | emplacements | **20–40** | stocky | stubble 40 % | Helmet or side cap, shirt-sleeves when serving the gun, ear protection optional; red branch piping. |
| **Kriegsmarine sailor** (optional flavour, M4, M7 U-boat pens, M13 Le Havre) | docks, patrol boats | **18–35** | lean | **U-boat crews: beard 40 %**, stubble 40 % | Navy-blue pea jacket or grey leather deck gear, the **sailor's cap** with a plain tally (a tally without text, or generic lettering). BEL has no dedicated sailor sprite, so this is optional variety. |
| **Tutorial "enemies"** (`tutorial`) | training | 20–35 | any | any | Allied troops in German-style kit, with an **armband** so the player can tell. |

### 5.4 Insignia and content rules (spec §10.6)
- **No swastika** anywhere:
  - The **breast eagle** and **cap eagle** are rendered as a **plain stylised eagle, wings spread, perched on a plain bar or roundel**: no wreath, no swastika. Alternatively omit them (below about 60 px they are invisible anyway).
  - Medals: plain **Iron Cross** outlines are fine (no central swastika: leave the centre blank). No Party badges. No Wound Badge (its helmet carries a swastika).
- **No SS runes, no death's-head (skull) cap badges, no SS cuff titles.**
- **Balkenkreuz** (the straight-armed cross) is allowed on vehicles (spec).
- Unit numerals on shoulder straps are allowed but kept **generic**: random 1–3 digit numbers, never a real notorious unit.

### 5.5 SS-Gruppenführer Helmut Schleper ("the Butcher", M15)
The mission is titled *The End of the Butcher*. He is the only named German in BEL.

| Field | Value |
|---|---|
| Age / build | **About 52** (MPFB `age 0.71`). 1.80 m, **heavy-set and paunchy**, thick short neck, heavy shoulders (weight 0.75, muscle 0.45). |
| Face | **Broad, heavy, jowly, square-ish**, a thick fold at the back of the neck, **small pale cold eyes under heavy lids**, thin tight lips turned down, a fleshy nose, a smooth pale complexion with broken veins on the cheeks. |
| Hair / facial hair | **Grey, close-cropped at the sides, thin on top and combed flat**; clean-shaven. **No glasses, no duelling scar, no moustache**: generic, to avoid any resemblance to a real person (see §0.2). |
| Expression | Cold, bored contempt; hands clasped behind his back on his **garden walk** (spec: the walk loop in the W courtyard). |
| Uniform | **Field-grey general's tunic** (1944 SS generals wore field grey, not black) with **silver-grey oak-leaf collar tabs on both sides** (general-rank tabs carry no runes, which is historically right *and* compliant). Silver shoulder boards, **a peaked cap with silver cords and a plain eagle-less cap badge** (no skull). Riding breeches, tall polished boots, leather gloves, a **grey leather greatcoat** over the shoulders (optional). A tiny **unreadable ribbon bar**. |
| Retinue | Staff car (Citroën 15 or Kübelwagen per the M15 data); an aide (an officer type, 25–30, glasses 50 %). |
| Silhouette | Must read at 25 px as "**wider and slower than every other officer**": the paunch plus the grey-leather greatcoat, and a slow, heavy walk (0.8× walk speed animation). |

---

## 6. Guests (key 7) and other named people
Guests are prisoners when found (spec §3.5): **no belts, no weapons, dishevelled**. Each has dirt and bruise decals at 50 %, and **hands tied in front** until freed (the tied-hands pose clip).

### 6.1 Capt. Gregor McRae, pilot (M10 *Operation Icarus*, Oct–Nov 1942, desert)
| Field | Value |
|---|---|
| Identity | "Capt. McRae, RAF". First name **Gregor** (spec decision; Prima says "George"). Scottish surname, so a **Scottish accent** [ours]. Only he can fly the Ju 52. |
| Look | **The seventh head in the BEL team art** [team, identification inferred]: a **leather flying helmet with goggles pushed up on the brow**, a lean, sharp face, and a **thin, neat pencil moustache**. Apparent age **30–34**, 1.77 m, slim (weight 0.35). |
| Face | Narrow, fine-boned; a straight nose; **light-brown / auburn hair** at the helmet edges [ours]; **freckles and a sunburnt nose** [ours, desert]; green-grey eyes [ours]; a cocky, wry expression even as a prisoner. |
| Clothing | Captured in the desert: a **khaki drill shirt** with RAF blue-grey rank slides, khaki shorts or trousers, desert boots, and a **silk scarf** round the neck. His **sheepskin flying jacket** is tied round the waist (a strong silhouette cue; optional). No belt or holster (prisoner). |
| Voice | Scottish, light and dry, a tenor-baritone. |
| Art brief | Photoreal portrait of a lean RAF pilot of about 32: leather flying helmet with goggles pushed up, a thin neat pencil moustache, a fine-boned sunburnt freckled face, auburn hair, a wry cocky smile; a dusty khaki shirt and a silk scarf; bruised cheekbone. |

### 6.2 The Informer (M12 *Up on the Roof*, Tunis, early 1943)
| Field | Value |
|---|---|
| Identity | An unnamed informant held in the town (every English source says "the Informer"; ES Wikipedia's "Claude Gilbert" is a conflation, research-raw/missions.md). |
| Look [ours: the original's look is undocumented] | A **Tunisian civilian, 40–48**, medium height (1.72 m), wiry. Short **dark hair with grey**, a **neat dark moustache**, a lined, alert, anxious face, brown eyes, olive-brown skin. |
| Clothing | A **red felt chechia** (the Tunisian brimless cap) and a **crumpled light linen jacket** over a collarless shirt, loose trousers, worn leather shoes. Dignified, not a stereotype: a clerk or merchant who has been beaten, with bruises and a torn sleeve. |
| Voice | Arabic- and French-accented English, quiet, quick. |

### 6.3 Claude Gilbert and 4 prisoners (M17 *Before Dawn*, Alsace, 28 Nov 1944)
| Field | Value |
|---|---|
| Identity | **Claude Gilbert**, a French Resistance leader [inferred from the name and setting], held with four others in the fenced camp. They move as one group and cannot crawl (spec §3.5). |
| Gilbert | **About 50, 1.76 m, gaunt from captivity**. **Grey hair, bare-headed**, a **grey walrus moustache**, stubble, a hollow-cheeked lined face, hard grey eyes. A **long dark wool overcoat** with torn lapels, no tie. Walks at the head of the file, upright despite it all. |
| The four | Varied civilians and resisters, seeded like the Germans but from **French civilian** tables: ages **19–60**, one each of a young farmhand (flat cap, 20), a middle-aged worker (blue work jacket, 40s), an older man (beret, 58), and a young clerk (glasses, 25). Filthy, unshaven, blankets over the shoulders. **Not** in striped camp uniforms. |
| Colour | Browns, dark blues and greys, desaturated. They must stand apart from the green and brown commandos and the field-grey Germans. |

### 6.4 Colonel Montague Smith (briefings)
Never seen in BEL: a voice only, British and clipped (spec §7: "the Colonel"). **Do not** create a face; if a speaker card is ever needed, use a **silhouette** behind the briefing slides.

### 6.5 Animals
**Alsatian guard dogs** (M19 only; spec): black-and-tan, 30–38 kg. Seed-vary the saddle-patch size and ear set so that neighbouring dogs differ.

---

## 7. Sources used for this bible
- **Local:**
  - `research-raw/characters.md` (names, birth dates, heights, bios);
  - `research-raw/visuals.md` (sprite sets, HUD, voices);
  - `research-raw/missions.md` (guests, Schleper);
  - `design-spec.md` §3.0, §3.1, §3.5, the soldier-type table, §6.3 and §10.6;
  - `realism-pipeline.md` (MPFB2 pipeline, per-instance face variety);
  - the 1998 US manual text (`bel_manual.txt`: commando bios).
- **Original imagery**, viewed only as internal reference and never shipped:
  - native BEL 640×480 screenshots (M1, M2, tutorial) from earlier research, top-bar portrait crops;
  - fandom (commandos.fandom.com, via its MediaWiki API): `Bel_team_pyro.jpg` (BEL team art), `Bel_GreenBeret_original_cd.jpg`, `Duke_art.jpg`, dossier images `Profil-duke.gif` and `Profil-frenchy.gif`, the M1 walkthrough captures (HUD colour portraits, sprites), and the character pages' trivia: the Spy's younger beta look; the Sniper's dossier photo being a retouched real photograph; the actor anecdote about the Green Beret, deliberately **not** followed;
  - Commandos 2 renders (`Green_Beret.jpg`, `Sapper.jpg`, `Driver.jpg`, `Sniper.jpg`, `Marine.jpg`, `Spy.jpg`), used only as secondary hints and tagged **[C2]**.
- **Gaps:**
  - native in-game **sprites** for the Sniper, Marine, Sapper and Spy were not sampled (§3.2);
  - no BEL HUD portrait of the Spy was found (his look comes from the team art and the dossier);
  - the Informer's and Gilbert's original looks are undocumented (§6.2, §6.3 are our design).

---

## Verification

An independent check of §0–§3 and §6.1 against the sources, done by a verifier who did not write the bible. The verifier re-opened the original material: the 1998 US manual text; the fandom wiki pages (`Francis_T._Woolridge`, `Rene_Duchamp`, `Thomas_Hancock`, `Jack_O'Hara`, fetched through the MediaWiki API); the dossier images `Profil-duke.gif` and `Profil-frenchy.gif`; enlarged face crops of `Bel_team_pyro.jpg`; the HUD crop `hudtops.jpg`; and `Duke_art.jpg`. Nothing in this section overrides the likeness rules in §0.2. **Where a correction below conflicts with §1 or §2, the correction wins.** Anyone building from this bible should apply it.

### V.1 Claims confirmed (10)
| Claim | Source checked | Result |
|---|---|---|
| "Tiny is your strongest and Duke your weakest" | manual | Confirmed, verbatim. |
| Duke reads Shelley under fire | manual: "spend his time reading Shelly and laughing" | Confirmed. The manual spells it "Shelly". |
| Duke: "haughty and reserved"; "stand-offish… cold and very calculating" | manual; `Profil-duke.gif` Additional Info | Both confirmed, verbatim. |
| Sniper: shaved head, prominent ears, long lined face, clean-shaven | team art, HUD, `Duke_art` | Confirmed. |
| Sniper outfit: dark-green smock, khaki trousers, cartridge bandolier, ankle gaiters, scoped bolt-action rifle with a wooden stock | `Duke_art` | Confirmed. |
| Sapper: domed green helmet with a short brim, moustache, toothy grin in the HUD | team art, HUD | Confirmed. The §3.3 correction of the spec's Brodie helmet stands. |
| Driver: camouflage peaked cap, broad clean-shaven face, grin | team art, HUD colour portrait | Confirmed. The §3.3 correction of the spec's "leather cap and goggles" stands. The seventh head (leather helmet, goggles, thin moustache) exists, as §6.1 says; naming him McRae is still an inference. |
| Spy: round wire glasses, flat cap, clean-shaven; "amiable character, great at conversation"; five languages; "not refined" | team art, `Profil-frenchy.gif`, manual | Confirmed. |
| Marine: black knitted watch cap and heavy dark stubble | team art, HUD | Confirmed. |
| Green Beret: sleeveless camouflage top, braces, roll-neck, bare arms, dark beret with a front badge, 3/4 profile in the HUD | team art, HUD | Confirmed. The beret reads as **charcoal**, with only a faint green cast. |
| Spec §3.0 headgear cues quoted in §3.3 | `design-spec.md` rows 194–198 | Quoted accurately. |

### V.2 Corrections: claims the sources do not support
1. **Spy, face shape (§1.6 "Oval and fleshy… [team]").**
   - *Problem:* Enlarged, the team art shows a **medium-long, lean, lined face** with a long straight nose, thin lips and deep nasolabial folds. It is not soft or fleshy.
   - *Fix:* Change the face to "medium-long, lean-cheeked but not gaunt, long straight nose, thin lips, moderate lines". Re-tag the soft civilian **body** as [ours].
   - *MPFB:* `head/head-fat 0`, `cheek volume 0`, `nose/nose-scale-vert-incr +0.4`, `mouth/mouth-lowerlip-volume-incr 0`. Keep `head-oval +0.4` and the double-chin modifier at 0.
   - *Knock-on benefit:* this splits the six evenly, three broad faces (Green Beret, Driver, Sapper) and three long faces (Sniper, Marine, Spy). The version as written had four broad or fleshy faces. See V.4.
2. **Spy, cap (§1.6 "brown herringbone").**
   - *Problem:* The team art shows a **rust-brown check (plaid) flat cap** with a short stiff peak. It is not herringbone.
   - *Fix:* Use "rust-brown check wool flat cap".
3. **Spy, tweed jacket, waistcoat and tie ([team, C2]).**
   - *Problem:* The BEL team art shows only the head, with no clothing visible.
   - *Fix:* Re-tag the outfit **[C2]**. It stays the build target because BEL shows nothing that contradicts it.
4. **Spy, hair ([dossier: dark hair]).**
   - *Problem:* The dossier face is a tiny photographic image with dark round lenses. Like Duke's dossier photo, it may be a retouched photograph of a real person.
   - *Fix:* Apply the §0.2 rule to **both** dossier photos: derive nothing from them. Re-tag the Spy's hair colour, slick-back and recession as **[ours]**. The round glasses are already confirmed by the team art.
5. **Sapper, moustache colour (§1.4 "mid-brown salted with grey [HUD, team]").**
   - *Problem:* In BEL the moustache is **dark brown with no visible grey**. The grey comes only from C2.
   - *Fix:* In BEL missions use a dark-brown brush moustache and only faint temple grey [ours]. The Sapper still reads as older from his lines and the grin creases, not from grey.
6. **Sapper, face fleshiness (§1.4 "round-square, fleshy… [team, HUD]").**
   - *Problem:* The art shows a **medium-broad square face** with moderately full cheeks, strong cheekbones and deep grin lines. It does not show jowls.
   - *Fix:* Change `head/head-fat` to +0.2 and `head/head-round` to +0.3. Re-tag the paunch and barrel body as [ours] (already tagged).
7. **Marine, "youngest-looking, apparent 28–32 [HUD, team]".**
   - *Problem:* In the team art his face is **lined and hollow-cheeked, with bags under the eyes**, and reads as about 40. Every BEL head reads older than canon. The Marine being the youngest is an **[ours]** variety choice, not the original's.
   - *Fix:* Keep him the youngest-looking, but set the band to **30–34** (`age 0.555`). Keep crow's feet, under-eye shadows and cheek hollows so he still reads as a hard-drinking sailor, not a fresh-faced recruit.
8. **Green Beret, broad square face.**
   - *Problem:* In the team art his face is more **angular long-square**, with high cheekbones. The massive jaw is confirmed. The flattened, broken boxer's nose does not show in BEL; it is **[ours]** (the bible already tags the break as ours; tag the broadness as ours too).
   - *Fix:* Re-tag as above. The beret should be a visibly **dark bottle-green**, not near-black; see V.4, headgear.
9. **Heights (§1, every commando).**
   - *Problem:* The "ES Wikipedia metric" heights in `research-raw/characters.md` match the CommandosHQ **weights in lb** digit for digit for five of the six men (1.80 m and 180 lb; 1.81 m and 181 lb; 1.75 m and 175 lb; 1.83 m and 183 lb; 1.79 m and 179 lb). They look like a transcription error, not an independent source. The official dossier heights are imperial: Green Beret 6'5", Sniper 6'2", Marine 6'1", Sapper 6'0", Driver 6'2", Spy 6'4" (the Spy's 6'4" is confirmed on `Profil-frenchy.gif`). So the Spy's 6'4" is the *primary* figure, not an outlier.
   - *Fix:* Keep the bible's heights as a deliberate **[ours]** choice for silhouette variety. The shortest is the Sapper and the tallest the Green Beret in every source. The Spy at 1.79 m is an art-direction decision for the "unmilitary" read. Do not cite ES Wikipedia heights as evidence.
10. **Driver's burns, "the manual says the Tamet airfield raid (Dec 1941)".**
    - *Problem:* The manual gives **no date**; the December 1941 date is a historical inference. The burns themselves are confirmed ("left him with serious burns").
    - *Fix:* The "from M8" switch-on remains **[ours]**; keep it.
11. **Sapper walk "brisk, bustling".**
    - *Problem:* The fandom wiki (a description of the whole series) says his heavy explosives "force him to move slowly". BEL has no measured speed for him (`characters.md`).
    - *Fix:* Keep the brisk, eager **body language** [ours] with the spec's speed values. Do not make him visibly faster than the Driver or Green Beret.

### V.3 Likeness and IP check
- **Pass.** No prompt, brief or modifier names a real person or says "looks like…".
  - The Green Beret actor anecdote is acknowledged without naming the actor, and it is not followed. Dropping the promo-art moustache is correct: it also keeps the Green Beret away from that anecdote's reference look.
  - The Sniper's dossier photo is correctly banned. The fandom wiki identifies it as a doctored photograph of a named real US officer, so it must never be used as a reference.
  - Schleper is deliberately generic (§5.5).
- **Add (V.2 item 4):** treat `Profil-frenchy.gif`'s photo exactly like Duke's. It may not be used for reference, img2img or face matching.
- **Add:** a human review gate. Any generated Green Beret portrait that a reviewer can name as resembling a specific actor is rejected and re-seeded. The same applies to every head. Keep the "celebrity, famous actor" negative prompt.
- The manual mentions real people in passing (Anders Lassen, "Paddy Maine" in the Driver's bio). **Never** give any character or guest their faces.

### V.4 Distinct at a glance: pairs that still risk reading alike
| Risk | Pair | Fix |
|---|---|---|
| Headgear value at 25 px and in the grey HUD | Green Beret beret against the Marine's black knit cap: both dark, soft and cloth | The Green Beret's beret is **mid-dark green** (value about 25–30 %), flat and pulled hard to one side, with a bright badge. The Marine's cap is **pure black** (value about 8 %), a round dome with a rolled cuff. Each also has its body cue: bare arms (Green Beret); all-black body (Marine). |
| Face mass | Green Beret, Driver, Sapper and Spy were all "broad or fleshy" | V.2 item 1 moves the Spy to a lean face, giving three broad and three long faces. Within each group the faces must still differ. Broad: square, jutting jaw (Green Beret); jowly, pug-nosed (Driver); moustache and grin creases (Sapper). Long: bald and big-eared (Sniper); stubble (Marine); glasses and lines, fuller than the other two (Spy). |
| Apparent age | Driver 36, Spy 38, Sapper 40: MPFB age steps of 0.015 cannot be seen | Do **not** count age as a distinguishing axis for these three. Sell age with the skin decals (lines, greying) and rely on facial hair, headgear and glasses. The bands can stay as written. |
| Facial hair | Four of the six are clean-shaven (Green Beret, Sniper, Driver, Spy) | Acceptable. Each clean-shaven face has a unique top cue: beret, bare scalp, camo peaked cap, flat cap plus glasses. Do not add stubble to the Driver or the Spy. |
| Hair colour | The Marine (black) and Spy (near-black) are both dark, but both are hidden under caps | Acceptable. Hair colour is a minor axis here because only the Sniper is normally bare-headed. |

**Verdict:** the six are distinct at every zoom, provided the fixes above are applied (the headgear values and the Spy's face). The bible follows the originals closely where BEL shows something. Where it goes beyond them, the additions are tagged [ours], with the exceptions corrected in V.2.
