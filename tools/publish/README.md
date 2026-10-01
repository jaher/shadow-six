# tools/publish

`sync-public.sh` publishes the game to the public repository
<https://github.com/jaher/shadow-six> (site: <https://jaher.github.io/shadow-six/>).

The dev repository's history is **never** pushed: early commits contain
research material (retail-data dumps, verbatim briefings) that must not be
public. The public repo has its own clean, linear history instead.

## What it does

1. **Export** `git archive master` into a temp dir, then drop dev-only material:
   `docs/research-raw/`, `docs/realism-raw/`, `tests/out/`, `*.bak*`, and any
   tracked file that matches a `.gitignore` rule.
2. **Safety scan** (aborts before touching the public repo) for:
   retail data files (`*.MIS`, `gap-6-bcd-missions.json`, `gap-6-briefings.txt`),
   long unparaphrased `TA:` briefing transcripts, code addresses from the
   original executable in `docs/` or Markdown, secret patterns
   (GitHub/OpenAI/AWS tokens, private keys) and files over 95 MB.
3. **Mirror** the tree into `<projects>/shadow-six-public`
   with `rsync --delete` (its `.git` is never touched; created with
   `git init -b master` on first run).
4. **Commit** as `Jose-Angel Herrero Bajo <id+jaher@users.noreply.github.com>`
   with the message `Sync from dev master <sha>: <dev subject>`.
5. **Push** to `origin master`. The public repo's `pages.yml` workflow then
   builds the web target (`npm ci && npm run build`, see `tools/build/`) and
   deploys `dist/`; `ci.yml` runs the unit tests and the web build.

## Usage

```sh
tools/publish/sync-public.sh             # export, scan, commit, push
tools/publish/sync-public.sh --scan-only # dry run: export + scan only
tools/publish/sync-public.sh --no-push   # commit locally, push later
```

Needs `git`, `rsync` and an authenticated `gh` (used to look up the numeric
GitHub user id; set `GH_USER_ID` to skip). Fix anything the scan flags in the
dev repo, commit it there, and run the script again.
