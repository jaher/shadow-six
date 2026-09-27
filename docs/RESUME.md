# How to resume the SHADOW SIX build

Written 2026-09-27 for the case where the weekly Claude usage limit runs out mid-build
(weekly reset: **Wed Sep 30, 6 pm America/Los_Angeles**; session limit resets every ~5 h).
Nothing is lost when a limit hits: work is saved in five layers.

## Where the work lives

| Layer | Location | Saved how |
|---|---|---|
| Committed code/assets/docs | `master` + feature branches in this repo | git commits (each workflow step commits) |
| Uncommitted work in progress | every git worktree (see below) | **WIP snapshot refs** `refs/wip/<branch>` every 10 min (cron) (`git for-each-ref refs/wip`) — includes untracked files; restore with `git checkout refs/wip/<branch> -- .` inside that worktree, or `git diff HEAD refs/wip/<branch>` |
| Agent notes (what each agent had done / was doing) | `<claude-tmp>` | mirrored every 3 min (cron) to `<projects>/commandos-rnd-backup/scratchpad/` |
| R&D + asset-production scratch (Blender outputs, renders, music, voices, faces, vfx, water, terrain) | same scratchpad | same mirror (≈67 GB) — if `/tmp` was wiped (reboot), copy the mirror back: `rsync -a <projects>/commandos-rnd-backup/scratchpad/ <claude-tmp>` |
| Workflow state (per-agent results, resumable) | `~/.claude/projects/-home-jaherrero-projects/f925f159-56cb-4b42-b065-406d3c4ffa40/subagents/workflows/wf_*/journal.jsonl` + scripts under `~/.claude/projects/*/f925f159-…/workflows/scripts/` | written by Claude Code; persistent under `/home` |

**Backups run from the user's crontab, independent of Claude Code** (survive restarts / the computer being switched off):
- `*/3 * * * * <projects>/commandos-rnd-backup/backup.sh` (was */10; tightened 2026-09-27 near the weekly limit) — mirrors the /tmp scratchpad (~67 GB incl. venvs,
  sample libraries, model weights, renders) and /tmp task outputs to `<projects>/commandos-rnd-backup/`,
  snapshots every worktree's uncommitted work to `refs/wip/<branch>`, and hourly writes `repo.bundle` (all git refs).
- `@reboot … restore.sh` — after a boot, copies the scratchpad + task outputs back into /tmp at the same session path.
- Last run time: `commandos-rnd-backup/last-sync.txt`. Remove the jobs with `crontab -e` when the project is done.

## Worktrees / branches in flight (see `git worktree list`)

- `commandos-wt-missions` → `feat/missions` (missions 4–20)
- `commandos-wt-phase3` → `feat/phase3` (wind, fish, pavement + street furniture + lamp posts)
- `commandos-wt-icons` → `feat/hud-icons` (high-quality HUD icons)
- `commandos-wt-clip` → `feat/clipping` (interpenetration audit + fixes)
- `commandos-wt-align` → `feat/align` (buildings parallel to their fences; M1–M3, then M4–M20 after the missions merge)
- `commandos-wt-pain` → `feat/portraits-pain` (portrait pain faces + lip resync to voices v2)
- `commandos-wt-vehint` → `feat/vehicle-integration` (vehicle library wired into the game + flyovers, windsock, crews, night lights)
- `commandos-wt-crawl` → `feat/crawl` (military low crawl + prone animation set)
- vehicles production works in the scratchpad (`vehicles/`), consolidates into master at the end

## IN FLIGHT when the weekly limit was approaching (snapshot updated 2026-09-27 13:25 PDT)

The user asked to keep working until ~99 % of the weekly usage and continue at the **weekly reset (Wed Sep 30, 6 pm PDT)**.
A one-shot session cron fires at **Wed Sep 30 18:07** (plus the hourly :17 safety net) and resumes everything below.
S = `~/.claude/projects/-home-jaherrero-projects/f925f159-56cb-4b42-b065-406d3c4ffa40/workflows/scripts`,
T = `~/.claude/projects/-home-jaherrero-projects-commandos-threejs/f925f159-56cb-4b42-b065-406d3c4ffa40/workflows/scripts`,
D = `~/.claude/projects/-home-jaherrero-projects-commandos-threejs-docs-screenshots/f925f159-56cb-4b42-b065-406d3c4ffa40/workflows/scripts`.

| # | Workflow (runId) | scriptPath | Worktree / branch | Next after resume |
|---|---|---|---|---|
| 1 | missions 4–20 (`wf_f8b05e29-c7b`) | T/missions-4-20-wf_f8b05e29-c7b.js | commandos-wt-missions / feat/missions | 62 agents done; last playtest/fix passes (M7, M20 …), then MERGE into master — unblocks align M4–M20 + mission art pass |
| 2 | ~~clipping audit~~ DONE (merged 30c7254) — QUEUED follow-up "clip-2" (see PROGRESS.md 2026-09-27T19:05Z) | — | — | launch after the reset |
| 3 | bodies: physics (Rapier), blood, drag/carry, buddy rescue, craters (`wf_be5a0824-a7d`) | T/bodies-combat-feedback-wf_be5a0824-a7d.js | commandos-wt-bodies / feat/bodies | drag/carry fixes (put-down flip, overlap after revive, upright drag start, M2 e5 corpse through the walkway — see bodies_dragcarry notes) → verify → merge — unblocks gate-smash merge |
| 4 | ~~portraits pain + lip resync~~ DONE (merged 165efe6) | — | — | — |
| 5 | buildings aligned to fences (`wf_0a14f1b4-fd5`) | S/align-buildings-to-fences-wf_0a14f1b4-fd5.js | commandos-wt-align / feat/align | M1–M3 MERGED (203693d); fix-m4-20 agent is polling for the missions merge (≤ 8 h), then realigns M4–M20 (tanks strict, others aesthetic) → verify → merge |
| 6 | vehicle integration (`wf_5468d5f3-2cf`) | S/vehicle-integration-wf_5468d5f3-2cf.js | commandos-wt-vehint / feat/vehicle-integration | core done (a96d9b6 also fixes the red loading-int2 test); AMBIENT step (flyovers, windsock, crews — fix R75 passenger in the tub + theater uniforms, night lights) → verify → merge |
| 7 | ~~30 s gameplay video~~ DONE — user accepted the first cut (scratchpad/video/shadow-six-m02-gameplay-30s*.mp4) | — | — | — |
| 8 | gate/door smash by vehicles (`wf_048f7b58-69f`) | ~/.claude/projects/-home-jaherrero-projects-commandos-wt-bodies/f925f159-56cb-4b42-b065-406d3c4ffa40/workflows/scripts/gate-smash-wf_048f7b58-69f.js | commandos-wt-smash / feat/gate-smash (from feat/bodies) | BUILD step running → demo clip (SEND scratchpad/video/gate-smash-m02.mp4) → verify → merge after feat/bodies |
| 9 | music production, route A (`wf_56cb00cb-7cb`) | T/music-production-wf_56cb00cb-7cb.js | commandos-wt-music / feat/music | compose 3 batches (scratchpad/music/a/cues) → review + reel (SEND scratchpad/music/for_user/soundtrack-reel.mp3) → integrate (no in-mission music, faithful to BEL) → verify → merge |
| 10 | clip-2 dynamic penetrations + eaves (`wf_0e57658f-125`) | T/clip-2-wf_0e57658f-125.js | commandos-wt-clip2 / feat/clip2 | fix → verify → merge |

**QUEUED — launch after the in-flight work (in this order, ≤ 8 agents total):**
1. ~~`clip-2`~~ LAUNCHED (row 10). Remaining part: the clipping audit over M4–M20 after the missions merge → do it inside the mission art pass. Was: dynamic penetrations (m00 7 / m01 3 / m03 18: soldiers vs M3 dam parapet + barracks, GB/e6 vs M1 wall_s), roof eaves in turret arcs + vehicle drive probe; then the clipping audit over M4–M20 once missions merged (acceptance (e)).
2. Mission art pass M4–M20 (roads/pavement, furniture, weather, ambient life, building variety, lamp posts, desert ground scatter fix — no flat paper cutouts; M3 dam blocky terrain slabs; M3 briefing-skip camera snap).
3. Building batches 3c-2 (112 new types) and 3c-3 (≥12 variants per type + set dressing).
4. ~~Music production~~ LAUNCHED with route A (row 9). BEL has no in-mission music, so M2 silence is faithful.
5. Phase 3 leftovers (telegraph wires, antennas, dust devil, gull dive, bird calls, X-ray flutter); BCD missions (4c); final review + perf on a quiet machine; periodic `tools/publish/sync-public.sh` once the user has pushed the public repo.

Resume each with `Workflow({scriptPath, resumeFromRunId})`, at most 8 agents running in total (these 7 run ~1 agent each except missions ≤3).
If a resume is refused (runtime lost the run), relaunch the same scriptPath as a new run — agents continue from their
notes files (`scratchpad/notes/*.notes.md`) and from committed + WIP work (`git for-each-ref refs/wip`).

**Before resuming, check for half-finished git operations** (an agent can stop mid-merge when the limit hits):
`git -C <repo or worktree> status` for MERGE_HEAD / UU files in master and every worktree; a stale `.git/index.lock` or
`.git/worktrees/*/index.lock` with no git process running can be removed. If master is mid-merge, let the re-run merge
agent finish it (or `git merge --abort` and let it redo the merge) — never commit other workflows' files.

**Waiting on the user (not blocked):** the GitHub publish push (one-liner in PROGRESS.md; the tool blocks Claude from
pushing the public repo) and the music choice A/B/C (default A). After the reset also: send the pending screenshots
(align before/after final, pain sheet final, vehint-*, video), then continue the not-yet-started steps in PROGRESS.md
(mission art pass for M4–M20, building batches 3c-2/3c-3, music production, phase 3 leftovers, BCD missions, final review).

## Resuming

**In the same Claude Code session** (if it stayed open): the hourly safety-net job (`:17`) detects failed/interrupted
workflows and resumes them from their journals (completed agents replay from cache). Extra one-shot checks are
scheduled right after the session reset and the weekly reset.

**After the computer was shut down / restarted** — best option, resumes THIS conversation with all context and
workflow run ids:

```
cd ~/projects && claude --resume f925f159-56cb-4b42-b065-406d3c4ffa40
```
then say "resume the build". (Claude: first check `last-sync.txt`/`restore.log`, run `restore.sh` if /tmp is empty,
re-create the session-only cron jobs — hourly safety net at :17, screenshot updates at :43, and the one-shot
post-reset checks — then resume every interrupted workflow; if a Workflow resume is refused because the runtime lost
the run, relaunch the same scriptPath as a new run: agents continue from their notes files and committed/WIP work.)

**In a brand-new Claude Code session** (if the resume above is not possible), open `<repo>` and say:

> Resume the SHADOW SIX build: read docs/RESUME.md and docs/PROGRESS.md, check the backup cron (crontab -l), restore the
> scratchpad from the backup if /tmp was wiped, then for every workflow in PROGRESS.md that is not DONE, resume it
> with Workflow({scriptPath, resumeFromRunId}) — keep ≤ 8 agents running in total — and continue the plan.

Resume order (highest value first): missions 4–20 → phase 3 → clipping audit → HUD icons → vehicles →
(then the not-yet-started steps in PROGRESS.md: vehicle integration, building batches/variety, music production,
BCD missions, final review, GitHub publish).
