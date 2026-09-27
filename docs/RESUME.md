# How to resume the SHADOW SIX build

Written 2026-09-27 for the case where the weekly Claude usage limit runs out mid-build
(weekly reset: **Wed Sep 30, 6 pm America/Los_Angeles**; session limit resets every ~5 h).
Nothing is lost when a limit hits: work is saved in five layers.

## Where the work lives

| Layer | Location | Saved how |
|---|---|---|
| Committed code/assets/docs | `master` + feature branches in this repo | git commits (each workflow step commits) |
| Uncommitted work in progress | every git worktree (see below) | **WIP snapshot refs** `refs/wip/<branch>` every 10 min (cron) (`git for-each-ref refs/wip`) — includes untracked files; restore with `git checkout refs/wip/<branch> -- .` inside that worktree, or `git diff HEAD refs/wip/<branch>` |
| Agent notes (what each agent had done / was doing) | `<claude-tmp>` | mirrored every 10 min (cron) to `<projects>/commandos-rnd-backup/scratchpad/` |
| R&D + asset-production scratch (Blender outputs, renders, music, voices, faces, vfx, water, terrain) | same scratchpad | same mirror (≈67 GB) — if `/tmp` was wiped (reboot), copy the mirror back: `rsync -a <projects>/commandos-rnd-backup/scratchpad/ <claude-tmp>` |
| Workflow state (per-agent results, resumable) | `~/.claude/projects/-home-jaherrero-projects/f925f159-56cb-4b42-b065-406d3c4ffa40/subagents/workflows/wf_*/journal.jsonl` + scripts under `~/.claude/projects/*/f925f159-…/workflows/scripts/` | written by Claude Code; persistent under `/home` |

**Backups run from the user's crontab, independent of Claude Code** (survive restarts / the computer being switched off):
- `*/10 * * * * <projects>/commandos-rnd-backup/backup.sh` — mirrors the /tmp scratchpad (~67 GB incl. venvs,
  sample libraries, model weights, renders) and /tmp task outputs to `<projects>/commandos-rnd-backup/`,
  snapshots every worktree's uncommitted work to `refs/wip/<branch>`, and hourly writes `repo.bundle` (all git refs).
- `@reboot … restore.sh` — after a boot, copies the scratchpad + task outputs back into /tmp at the same session path.
- Last run time: `commandos-rnd-backup/last-sync.txt`. Remove the jobs with `crontab -e` when the project is done.

## Worktrees / branches in flight (see `git worktree list`)

- `commandos-wt-missions` → `feat/missions` (missions 4–20)
- `commandos-wt-phase3` → `feat/phase3` (wind, fish, pavement + street furniture + lamp posts)
- `commandos-wt-icons` → `feat/hud-icons` (high-quality HUD icons)
- `commandos-wt-clip` → `feat/clipping` (interpenetration audit + fixes)
- `commandos-wt-crawl` → `feat/crawl` (military low crawl + prone animation set)
- vehicles production works in the scratchpad (`vehicles/`), consolidates into master at the end

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
