#!/usr/bin/env bash
# Usage: verify.sh [all|e2e|up]
set -euo pipefail

MODE=${1:-all}
case $MODE in all | e2e | up) ;; *) echo "usage: verify.sh [all|e2e|up]" >&2; exit 2 ;; esac

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/verify/lib.sh"

STATE=$(state_dir)
mkdir -p "$STATE/runs" "$STATE/verified" "$STATE/tmp"
find "$STATE/runs" -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf {} + 2>/dev/null || true
RUN=$(mktemp -d "$STATE/runs/XXXXXX")
PIDS=()
STEP=init
START=$SECONDS

step() { STEP=$1; printf '\n== %s\n' "$1"; }

teardown() {
  local rc=$? pid
  trap - EXIT INT TERM
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    # Escalate if SIGTERM is ignored; bounded so teardown itself cannot hang.
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [ "$rc" -eq 0 ]; then
    rm -rf "$RUN"
  else
    printf '\nFAILED at step: %s (exit %s). Run dir kept: %s\n' "$STEP" "$rc" "$RUN" >&2
    report_failure
  fi
  exit "$rc"
}

report_failure() {
  local f
  if [ -d "$RUN/test-results" ]; then
    find "$RUN/test-results" -name '*.png' 2>/dev/null | sed 's/^/screenshot: /' >&2
    find "$RUN/test-results" -name 'trace.zip' 2>/dev/null | while read -r f; do
      echo "trace: $f  (pnpm -C web exec playwright show-trace '$f')" >&2
    done
  fi
  if [ -f "$RUN/app.log" ]; then
    echo "--- tail -50 $RUN/app.log" >&2
    tail -50 "$RUN/app.log" >&2
  fi
}
trap teardown EXIT
# Stopping `up` is its normal exit, not a failure.
trap '[ "$MODE" = up ] && [ "$STEP" = "up (serving)" ] && exit 0; exit 130' INT
trap '[ "$MODE" = up ] && [ "$STEP" = "up (serving)" ] && exit 0; exit 143' TERM

fail() { echo "ERROR: $*" >&2; exit 1; }

alive() { kill -0 "$1" 2>/dev/null; }

# wait_for <seconds> <pid> <what> <cmd...>: poll cmd until it succeeds, failing fast if pid dies.
wait_for() {
  local secs=$1 pid=$2 what=$3 deadline
  shift 3
  deadline=$((SECONDS + secs))
  until "$@"; do
    alive "$pid" || fail "process exited while waiting for: $what"
    [ "$SECONDS" -lt "$deadline" ] || fail "timed out after ${secs}s waiting for: $what"
    sleep 0.1
  done
}

tree_before=$(worktree_tree)

if [ "$MODE" = all ]; then
  step "tsc"; pnpm -C web exec tsc --noEmit
  step "web unit tests"; pnpm -C web test
  step "go vet"; go vet ./...
  step "go test"; go test -race -count=1 ./...
  step "go vet (e2e tags)"; go vet -tags e2e ./...
  if [ -x scripts/verify/check-feature-map.sh ]; then
    step "feature map"; scripts/verify/check-feature-map.sh
  fi
fi

step "build web"; pnpm -C web run build
step "build backend"
go build -tags e2e -o "$RUN/rss-reader" .
go build -tags e2e -o "$RUN/fixtures" ./e2e/fixtureserver

step "start fixtures"
"$RUN/fixtures" > "$RUN/fixtures.log" 2>&1 &
FIX_PID=$!
PIDS+=("$FIX_PID")
fixture_ready() { grep -q '^FIXTURE_URL=' "$RUN/fixtures.log"; }
wait_for 10 "$FIX_PID" "fixture server FIXTURE_URL line (see $RUN/fixtures.log)" fixture_ready
FIXTURE_URL=$(sed -n 's/^FIXTURE_URL=//p' "$RUN/fixtures.log" | head -1)

cat > "$RUN/feeds.opml" <<OPML
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>verify</title></head>
  <body>
    <outline text="Fixture" title="Fixture" type="rss" xmlUrl="$FIXTURE_URL/feed.xml"/>
  </body>
</opml>
OPML

step "start app"
mkdir -p "$RUN/config" "$RUN/data"
env -u PORT -u HOST -u DB_PATH -u FEEDS_PATH -u STATIC_DIR -u FRONTEND_URL -u POLL_INTERVAL_MINUTES \
  XDG_CONFIG_HOME="$RUN/config" XDG_DATA_HOME="$RUN/data" \
  "$RUN/rss-reader" --host 127.0.0.1 --port 0 --db "$RUN/data/rss.sqlite" \
  --feeds "$RUN/feeds.opml" --static-dir "$ROOT/web/dist" --poll-interval 1440 \
  > "$RUN/app.log" 2>&1 &
APP_PID=$!
PIDS+=("$APP_PID")

BASE_URL=
addr_ready() {
  BASE_URL=$(grep -o 'addr=http://[^ ]*' "$RUN/app.log" | head -1 | sed 's/^addr=//') || true
  [ -n "$BASE_URL" ]
}
api_ready() { curl -fsS --max-time 2 "$BASE_URL/api/settings" > /dev/null 2>&1; }
# Without --static-dir the app silently proxies the deployed github.io UI, whose index.html can be byte-identical
# to the local build, so cmp alone cannot tell; the startup log line is the discriminator.
static_mode() { grep -q 'mode="static dir"' "$RUN/app.log"; }
ui_ready() { curl -fsS --max-time 2 "$BASE_URL/" 2> /dev/null | cmp -s - "$ROOT/web/dist/index.html"; }
articles_ready() {
  [ "$(curl -fsS --max-time 2 "$BASE_URL/api/articles" 2> /dev/null | jq -r '.total // 0' 2> /dev/null || echo 0)" -ge 3 ]
}

step "readiness"
wait_for 30 "$APP_PID" "app Listening line" addr_ready
static_mode || fail "app is not serving web/dist (log lacks mode=\"static dir\"; it would proxy the deployed UI instead)"
wait_for 30 "$APP_PID" "GET $BASE_URL/api/settings" api_ready
wait_for 30 "$APP_PID" "GET $BASE_URL/ serving web/dist/index.html (is --static-dir effective?)" ui_ready
wait_for 30 "$APP_PID" "fixture articles ingested (/api/articles total>=3)" articles_ready

cat > "$RUN/env" <<ENV
BASE_URL=$BASE_URL
FIXTURE_URL=$FIXTURE_URL
FEEDS_PATH=$RUN/feeds.opml
RUN_DIR=$RUN
ENV

if [ "$MODE" = up ]; then
  cat <<MSG

BASE_URL=$BASE_URL
FIXTURE_URL=$FIXTURE_URL
FEEDS_PATH=$RUN/feeds.opml
RUN_DIR=$RUN
Ctrl-C or kill this script to stop. Ready.
MSG
  step "up (serving)"
  while alive "$APP_PID" && alive "$FIX_PID"; do sleep 0.5; done
  fail "app or fixture server died"
fi

step "e2e"
if [ -f web/playwright.config.ts ]; then
  BASE_URL=$BASE_URL FIXTURE_URL=$FIXTURE_URL FEEDS_PATH=$RUN/feeds.opml RUN_DIR=$RUN \
    pnpm -C web exec playwright test
  alive "$APP_PID" || fail "app died during e2e"
  alive "$FIX_PID" || fail "fixture server died during e2e"
else
  echo "skipped: web/playwright.config.ts not present yet"
fi

step "marker"
tree_after=$(worktree_tree)
if [ "$MODE" = all ] && [ "$tree_before" = "$tree_after" ]; then
  jq -n --arg ts "$(date -u +%FT%TZ)" --arg branch "$(git rev-parse --abbrev-ref HEAD)" --arg head "$(git rev-parse HEAD)" \
    '{ts:$ts,branch:$branch,head:$head}' > "$STATE/verified/$tree_after.verify"
  echo "verified: $STATE/verified/$tree_after.verify"
elif [ "$MODE" = all ]; then
  echo "worktree changed during run; no marker written"
fi
echo "PASS ($MODE) in $((SECONDS - START))s"
