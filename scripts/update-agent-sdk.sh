#!/usr/bin/env bash
# Weekly self-update of C3's Claude Agent SDK (and the Anthropic SDK peer it requires).
#
# C3 runs the SDK's bundled Claude Code runtime, not the claude on PATH, so a
# stale pin quietly costs tokens (0.2.50 sat from April to August 2026 and
# tripled turn-one context every morning). This runs from system cron on
# chipdev, Sundays 04:00 ET, and behaves like the rest of the fleet: silent
# when there is nothing to do, one Discord line when something changed or
# failed.
#
#   scripts/update-agent-sdk.sh            # normal weekly run
#   scripts/update-agent-sdk.sh --force    # reinstall the current version to exercise the path
#   scripts/update-agent-sdk.sh --no-post  # never touch Discord (testing)
#
# Gate before anything is committed: src/ typecheck (the pre-push rule), the
# full vitest suite, next build. Green: commit to main, push, restart the local
# instance unless a session is running (then the restart waits for next week),
# post. Red: package.json and the lock are restored, nothing is pushed, post
# the failing step and the log path.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=${HOME}/.c3/logs/update-agent-sdk.log
CHANNEL=${C3_USAGE_CHANNEL_ID:-1492594841266294835}
FORCE=0; POST=1
for a in "$@"; do case "$a" in --force) FORCE=1;; --no-post) POST=0;; esac; done
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }
post() {
  [ "$POST" = 1 ] || { log "post (suppressed): $*"; return 0; }
  local token; token=$(grep '^DISCORD_BOT_TOKEN=' .env.local 2>/dev/null | cut -d= -f2-)
  [ -n "$token" ] || { log "no DISCORD_BOT_TOKEN in .env.local; not posted: $*"; return 0; }
  curl -s -X POST "https://discord.com/api/v10/channels/$CHANNEL/messages" -H "Authorization: Bot $token" \
    -H "Content-Type: application/json" -d "$(python3 -c 'import json,sys;print(json.dumps({"content":sys.argv[1],"allowed_mentions":{"parse":[]}}))' "$*")" >/dev/null || log "discord post failed"
}
fail() { log "FAILED at $1"; git checkout -q -- package.json package-lock.json 2>/dev/null; npm ci --silent >/dev/null 2>&1 || true; post "**C3 Agent SDK update failed** at $1 ($CUR -> $LATEST). Nothing changed. Log: $LOG"; exit 1; }

ver() { python3 -c "import json;print(json.load(open('node_modules/@anthropic-ai/claude-agent-sdk/package.json'))['version'])"; }
CUR=$(ver)
LATEST=$(npm view @anthropic-ai/claude-agent-sdk version 2>/dev/null) || { log "npm view failed"; exit 1; }
if [ "$CUR" = "$LATEST" ] && [ "$FORCE" = 0 ]; then exit 0; fi
log "update $CUR -> $LATEST (force=$FORCE)"

[ "$(git branch --show-current)" = main ] || fail "not on main ($(git branch --show-current))"
if [ -n "$(git status --porcelain -- package.json package-lock.json)" ]; then fail "package.json or the lock has uncommitted changes"; fi
git fetch -q origin && git merge-base --is-ancestor origin/main HEAD || git pull -q --ff-only origin main || fail "main is not fast-forwardable"

npm i --save-exact "@anthropic-ai/claude-agent-sdk@$LATEST" @anthropic-ai/sdk@latest >>"$LOG" 2>&1 || fail "npm install"
RUNTIME=$(python3 -c "import json;print(json.load(open('node_modules/@anthropic-ai/claude-agent-sdk/manifest.json')).get('version','?'))" 2>/dev/null || echo "?")
SRC_ERRORS=$(npx tsc --noEmit 2>&1 | grep "^src/" || true); [ -z "$SRC_ERRORS" ] || { echo "$SRC_ERRORS" >>"$LOG"; fail "typecheck"; }
TESTS=$(npx vitest run 2>&1 | tee -a "$LOG" | grep -E "^\s*Tests " | tail -1 | sed 's/^ *//'); echo "$TESTS" | grep -q "passed" && ! echo "$TESTS" | grep -q "failed" || fail "tests ($TESTS)"
npm run build >>"$LOG" 2>&1 || fail "build"

if [ -n "$(git status --porcelain -- package.json package-lock.json)" ]; then
  git add package.json package-lock.json
  git commit -q -m "Agent SDK $CUR -> $LATEST (weekly auto-update, runtime $RUNTIME)" || fail "commit"
  git push -q --no-verify origin main || fail "push"
  log "pushed"
else
  log "no package change (force run)"
fi

# "running" in the store outlives crashed sessions; a session that has not been
# updated for two hours is not one a restart would interrupt.
RUNNING=$(python3 - <<'PY' 2>/dev/null || echo 0
import json,os,datetime
d=json.load(open(os.path.expanduser('~/.ccc/data/sessions.json'))); v=d if isinstance(d,list) else list(d.values())
cut=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=2)).isoformat()
print(sum(1 for s in v if isinstance(s,dict) and s.get('status')=='running' and str(s.get('updatedAt',''))>=cut))
PY
)
if [ "$RUNNING" = 0 ]; then
  npx pm2 restart c3 --update-env >>"$LOG" 2>&1 && RESTART="restarted" || RESTART="restart failed, check pm2"
else
  RESTART="restart deferred, $RUNNING session(s) running"
fi
log "done: $CUR -> $LATEST runtime $RUNTIME, $TESTS, $RESTART"
post "**C3 Agent SDK** $CUR -> $LATEST (runtime $RUNTIME). $TESTS. Local instance $RESTART."
