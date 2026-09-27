#!/usr/bin/env bash
# sync-public.sh: export the dev repo's master tree into the separate, clean
# public repository (jaher/shadow-six), run a safety scan, commit and push.
#
# The dev history is never published. The public repo gets its own linear
# history: one "Sync from dev master <sha>" commit per run.
#
# Usage: tools/publish/sync-public.sh [--no-push] [--scan-only] [--ref <rev>]
#   --no-push    commit in the public repo but do not push
#   --scan-only  export + safety scan only; touch nothing in the public repo
#   --ref <rev>  dev revision to export (default: master)
# Env: PUBLIC_REPO (default <projects>/shadow-six-public)
#      PUBLIC_REMOTE_URL (used only when creating origin on first run)
set -euo pipefail

DEV="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PUB="${PUBLIC_REPO:-<projects>/shadow-six-public}"
REMOTE_URL="${PUBLIC_REMOTE_URL:-https://github.com/jaher/shadow-six.git}"
REF=master
PUSH=1
SCAN_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-push) PUSH=0 ;;
    --scan-only) SCAN_ONLY=1 ;;
    --ref) REF="$2"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

AUTHOR_NAME='Jose-Angel Herrero Bajo'
GH_ID="${GH_USER_ID:-$(gh api user --jq .id)}"
AUTHOR_EMAIL="${GH_ID}+jaher@users.noreply.github.com"
TRAILERS='Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VLerBwZuqghUz5tSfkGuoS'

log() { printf '[sync-public] %s\n' "$*"; }
die() { printf '[sync-public] ABORT: %s\n' "$*" >&2; exit 1; }

SHA="$(git -C "$DEV" rev-parse --short "$REF")"
SUBJECT="$(git -C "$DEV" log -1 --format=%s "$REF")"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/sync-public.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

# ---- (a) export ------------------------------------------------------------
log "exporting dev $REF ($SHA) -> $STAGE"
git -C "$DEV" archive --format=tar "$REF" | tar -x -C "$STAGE"

# dev-only material
rm -rf "$STAGE/docs/research-raw" "$STAGE/docs/realism-raw" "$STAGE/tests/out"
find "$STAGE" -name '*.bak*' -print0 | xargs -0 -r rm -rf
# tracked files that nevertheless match an ignore rule
git -C "$DEV" ls-files -c -i --exclude-standard -z | \
  while IFS= read -r -d '' f; do rm -rf "${STAGE:?}/$f"; done
find "$STAGE" -mindepth 1 -type d -empty -delete

# local machine paths in docs/tool scripts (they only reveal the dev machine's username/layout).
# Patterns are built at runtime from $HOME / the uid so this script itself contains no literal path.
log "scrubbing local paths"
HOME_RE="$(printf '%s' "$HOME" | sed 's/[.[\*^$/]/\\&/g')"
CTMP_RE="/tmp/claude-$(id -u)"
grep -rlIZ -e "$HOME" -e "$CTMP_RE" "$STAGE" 2>/dev/null | \
  xargs -0 -r sed -i -E \
    -e "s#${CTMP_RE}/[^[:space:]\`'\")|]*#<claude-tmp>#g" \
    -e "s#${HOME_RE}/projects/commandos-threejs#<repo>#g" \
    -e "s#${HOME_RE}/projects/#<projects>/#g" \
    -e "s#${HOME_RE}#~#g"

# ---- (b) safety scan -------------------------------------------------------
log "safety scan"
FAIL=0
flag() { printf '  - %s\n' "$*" >&2; FAIL=1; }
cd "$STAGE"

# retail data files
while IFS= read -r f; do flag "retail data file: $f"; done < <(
  find . \( -iname '*.mis' -o -name 'gap-6-bcd-missions.json' -o -name 'gap-6-briefings.txt' \) -print)

# briefing transcripts: 'TA:' lines must be short or marked (paraphrased)
while IFS= read -r hit; do
  line="${hit#*:*:}"
  n=${#line}
  if [ "$n" -gt 400 ] || { [ "$n" -gt 160 ] && ! grep -qi 'paraphrased' <<<"$line"; }; then
    flag "possible briefing transcript (${n} chars): ${hit:0:120}"
  fi
done < <(grep -rnIE '(^|[^A-Za-z])TA:' . || true)

# code addresses from the original executable (image base 0x400000) in docs
while IFS= read -r hit; do flag "code address in docs: ${hit:0:140}"; done < <(
  { grep -rnIiE '\b0x0{0,2}[45][0-9a-f]{5}\b' docs 2>/dev/null || true
    find . -name '*.md' -not -path './docs/*' -print0 | \
      xargs -0 -r grep -nIiHE '\b0x0{0,2}[45][0-9a-f]{5}\b' || true; })

# secrets
while IFS= read -r hit; do flag "secret-like string: ${hit:0:100}"; done < <(
  grep -rnIE 'ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----' . || true)
while IFS= read -r f; do flag "private key file: $f"; done < <(
  find . \( -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.pem' -o -name '*.key' -o -name '.env' \) -print)

# local paths must have been scrubbed
while IFS= read -r hit; do flag "local path left: ${hit:0:120}"; done < <(
  grep -rnIF -e "$HOME" -e "$CTMP_RE" . || true)

# GitHub hard limit is 100 MB per file
while IFS= read -r f; do flag "file > 95 MB: $f"; done < <(find . -type f -size +97280k -print)

cd - >/dev/null
[ "$FAIL" -eq 0 ] || die "safety scan failed (see above); nothing was synced"
log "scan clean: $(find "$STAGE" -type f | wc -l) files, $(du -sh "$STAGE" | cut -f1)"
[ "$SCAN_ONLY" -eq 1 ] && { log "--scan-only: done"; exit 0; }

# ---- mirror into the public repo --------------------------------------------
if [ ! -d "$PUB/.git" ]; then
  log "creating public repo at $PUB"
  mkdir -p "$PUB"
  git -C "$PUB" init -q -b master
fi
git -C "$PUB" config user.name "$AUTHOR_NAME"
git -C "$PUB" config user.email "$AUTHOR_EMAIL"
git -C "$PUB" remote get-url origin >/dev/null 2>&1 || git -C "$PUB" remote add origin "$REMOTE_URL"

rsync -a --delete --exclude='/.git' "$STAGE/" "$PUB/"

# ---- (c) commit ------------------------------------------------------------
git -C "$PUB" add -A
if git -C "$PUB" rev-parse -q --verify HEAD >/dev/null; then
  if git -C "$PUB" diff --cached --quiet; then
    log "public tree already matches dev $REF ($SHA); nothing to commit"
  else
    MSG="Sync from dev master ${SHA}: ${SUBJECT}"
  fi
else
  MSG="SHADOW SIX — initial public release"
fi
if [ -n "${MSG:-}" ]; then
  GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
  GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
    git -C "$PUB" commit -q -m "$MSG" -m "$TRAILERS"
  log "committed: $(git -C "$PUB" log -1 --format='%h %s')"
fi

# ---- (d) push --------------------------------------------------------------
if [ "$PUSH" -eq 1 ]; then
  git -C "$PUB" config http.postBuffer 524288000
  log "pushing to origin master"
  git -C "$PUB" push -u origin master
fi
log "done"
