# SHADOW SIX: *Lights Out* (the expansion campaign)

*Lights Out* is SHADOW SIX's own expansion campaign: eight **original** missions, 1943–1945, that use the expansion-style
mechanics built behind the `BCD` ruleset (`docs/bcd-plan.md` §1). Those mechanics are knock-outs, handcuffs, the puppet,
stones, cigarette packs, the Spy's hanger and wardrobe, rank recognition, the Driver's rifle, guests, new units and
animals, sea mines, lifts, drawbridges, pushables, jails and animal pens.

`BCD` stays the internal code id (`campaign: 'BCD'`, `CONFIG.rulesets.BCD`). Every player-facing string says
**LIGHTS OUT**.

User requests behind this work (2026-11-10): "Start work on all expansion missions", "Work on as much in parallel as
possible if it means pausing perf improvements" and "When you make the missions use fable 5.2".

## 0. Boundary (non-negotiable)

- The missions are **our own**. They do not recreate the 1999 expansion's levels: not its layouts, objectives, enemy
  placements, mission data, briefings or named characters.
- `docs/bcd-plan.md` §1 is a **mechanics catalogue**. Its tags (M1…M8, [MIS]) note where the 1999 expansion used a
  mechanic. They are research notes, never a layout to copy.
- Never open `docs/research-raw/gap-6*` or any parsed retail data or briefing text. Briefings are written in our own words.
- The 1999 expansion's title never appears in player-facing text.
- Historical WWII settings and generic genre mechanics are fine.
- No assets from the 1998/1999 originals.
- No swastikas, SS runes or death's-head badges on new art (character bible §0.2, §5.4).

## 1. The campaign

**Premise.** 1943. The tide has turned, but the war is far from won. London needs the Six for quieter work: men taken
alive, doors opened from the inside, alarms that never sound. They get new tools for it: a fist, a cosh, a rag of
chloroform, handcuffs, a pocketful of stones and a few packets of cigarettes. They also get two new friends.

**Career.**
- A *Lights Out* career starts at **Major** (36 gold) and reaches **Field-Marshal** at 60: 8 missions × 3 gold
  (bcd-plan §1.13).
- It is a separate career from the base campaign.
- Every mission has **Easy** ("for rookies") and **Hard** ("for veterans") data variants (bcd-plan §1.12).
- A password replays one mission.

**Guests.** These are original characters. Each keeps the ability set of bcd-plan §1.8.

| Guest | Key | Kit |
|---|---|---|
| **Tonino Esposito** (role `tonino`), 15. A *scugnizzo*, a street boy from the Quartieri Spagnoli of Naples. His father died in the summer raids of 1943. He sells contraband cigarettes to the soldiers, can hit a tin can at twenty paces with a stone, and knows every roof and stair in his quarter. | 7 | stones (Y), cigarette packs (V), hand (H). No weapon, no knock-out, no cuffs. |
| **Grethe Holm**, code name *Lark* (role `grethe`), 27. A switchboard operator at the Copenhagen telephone exchange and a courier for the Danish resistance since 1942. She grew up in Flensburg and speaks German like a native. Her handbag holds a pocket pistol and a lipstick. Soldiers see only a pretty civilian; the Gestapo know her face. | 8 | pocket pistol (Q); lipstick (D): a soldier of any rank but the Gestapo stares at her, and his cone follows her; cigarette packs (V); hand (H). Civilian cover that only the Gestapo see through. |

## 2. Files

- `STATUS.md`: the mission registration contract (how a mission joins the campaign, menus and career), then the bcd-plan §3
  N1–N13 audit and what the foundation finished.
- `MECHANICS.md`: every expansion mechanic in a few lines, with its key, ruleset flag, mission-data form and the b00
  sandbox station where you can try it.
- The missions themselves (`src/missions/expansion/eNN_*.js`) and their dossiers are written by the mission builders.
