#!/usr/bin/env bash
# Stop hook: cheap checks for changed scopes. No E2E here (that is the verify skill).
# stop_hook_active is deliberately ignored: short-circuiting on it would defeat the fix loop.

fail_open() {
  jq -n --arg m "stop-checks.sh internal error: $1 (checks skipped)" '{systemMessage:$m}' 2>/dev/null
  exit 0
}

command -v jq >/dev/null || exit 0
payload=$(cat)
sid=$(jq -r '.session_id // empty' <<<"$payload") || fail_open "bad stdin"
cwd=$(jq -r '.cwd // empty' <<<"$payload")
[ -n "$sid" ] || fail_open "no session_id"
[ -z "$cwd" ] || cd "$cwd" || fail_open "cannot cd to $cwd"

top=$(git rev-parse --show-toplevel) || fail_open "not a git repository"
cd "$top" || fail_open "cannot cd to $top"
# shellcheck source=../../scripts/verify/lib.sh
source "$top/scripts/verify/lib.sh" || fail_open "cannot source lib.sh"

paths=$(changed_paths) || fail_open "git status failed"
go_paths=$(grep -E '(\.go|^go\.mod|^go\.sum)$' <<<"$paths")
web_paths=$(grep -E '^web/' <<<"$paths" | grep -Ev '\.md$')
[ -n "$go_paths$web_paths" ] || exit 0

state=$(state_dir)
tree=$(worktree_tree) || fail_open "worktree_tree failed"
mkdir -p "$state/checks" "$state/sessions/$sid" || fail_open "cannot create state dirs"
[ -e "$state/checks/$tree.pass" ] && exit 0

log="$state/sessions/$sid/stop.log"
: >"$log"
scope=()
cmds=()
first3=$(printf '%s\n%s\n' "$go_paths" "$web_paths" | sed '/^$/d' | head -3 | paste -sd, - | sed 's/,/, /g')
[ -z "$go_paths" ] || { scope+=(Go); cmds+=("go vet ./... && go test -race -count=1 ./..."); }
[ -z "$web_paths" ] || { scope+=(web); cmds+=("pnpm -C web exec tsc --noEmit && pnpm -C web test"); }
scope_s=$(IFS=/; echo "${scope[*]}")
cmd_s=$(printf '%s\n' "${cmds[@]}" | paste -sd';' - | sed 's/;/; /g')

ok=1
for c in "${cmds[@]}"; do
  { echo "+ $c"; bash -c "$c" </dev/null; } >>"$log" 2>&1 || ok=0
done

fails="$state/sessions/$sid/stop-failures"
if [ "$ok" = 1 ]; then
  touch "$state/checks/$tree.pass"
  rm -f "$fails"
  exit 0
fi

n=$(( $(cat "$fails" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$fails"
if [ "$n" -ge 3 ]; then
  jq -n --arg m "Cheap checks still failing after 3 rounds: $cmd_s. Hand off to a human. Log: $log" '{systemMessage:$m}'
  exit 0
fi
tailtxt=$(tail -30 "$log")
jq -n --arg r "Stop hook: $scope_s files changed ($first3), so it ran $cmd_s; it failed (round $n/3). $tailtxt
Full log: $log. Fix the root cause; no skips, sleeps or retries." '{decision:"block",reason:$r}'
