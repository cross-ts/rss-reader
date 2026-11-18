#!/usr/bin/env bash
# PreToolUse(Bash) gate: a `git commit` needs a tree with a verify or code-review marker.
# Usage: commit-gate.sh off|observe|enforce

mode=${1:-observe}
[ "$mode" = off ] && exit 0

fail_open() {
  jq -n --arg m "commit-gate.sh internal error: $1 (gate skipped)" '{systemMessage:$m}' 2>/dev/null
  exit 0
}

command -v jq >/dev/null || exit 0
payload=$(cat)
[ "$(jq -r '.tool_name // empty' <<<"$payload")" = Bash ]  || exit 0
cmd=$(jq -r '.tool_input.command // empty' <<<"$payload")
sid=$(jq -r '.session_id // "unknown"' <<<"$payload")
cwd=$(jq -r '.cwd // empty' <<<"$payload")

sp='[[:space:]]'
git_opts="(${sp}+(-c${sp}+[^[:space:]]+|-C${sp}+[^[:space:]]+))*"
re_commit="(^|[;&|(\`]|${sp})git${git_opts}${sp}+commit([[:space:]]|$)"
[[ $cmd =~ $re_commit ]] || exit 0

[ -z "$cwd" ] || cd "$cwd" || fail_open "cannot cd to $cwd"
re_C="git${sp}+-C${sp}+([^[:space:]]+)${sp}+commit"
if [[ $cmd =~ $re_C ]]; then
  p=${BASH_REMATCH[1]}
  p=${p#[\"\']}; p=${p%[\"\']}
  cd "$p" 2>/dev/null || fail_open "cannot cd to -C path $p"
fi
top=$(git rev-parse --show-toplevel 2>/dev/null) || fail_open "not a git repository"
cd "$top" || fail_open "cannot cd to $top"
source "$top/scripts/verify/lib.sh" || fail_open "cannot source lib.sh"

# `commit -a` and chained add/rm/mv change the committed tree after this hook runs.
re_all="commit[^;&|]*${sp}(-[a-zA-Z]*a[a-zA-Z]*|--all)([[:space:]]|$)"
re_stage="git${git_opts}${sp}+(add|rm|mv)([[:space:]]|$)"
if [[ $cmd =~ $re_all || $cmd =~ $re_stage ]]; then
  tree=$(worktree_tree) || fail_open "worktree_tree failed"
else
  tree=$(git write-tree 2>/dev/null) || tree=$(worktree_tree) || fail_open "write-tree failed"
fi

state=$(state_dir)
verified=0
[ -e "$state/verified/$tree.verify" ] || [ -e "$state/verified/$tree.code-review" ] && verified=1
explained=0
[[ $cmd == *"Verification-Skipped:"* ]] && explained=1

log() {
  mkdir -p "$state" && jq -nc --arg ts "$(date -u +%FT%TZ)" --arg s "$sid" --arg m "$mode" --arg t "$tree" --arg d "$1" \
    '{ts:$ts,session:$s,mode:$m,tree:$t,decision:$d}' >>"$state/gate.jsonl"
}

ctx=""
hp=$(git config --get core.hooksPath 2>/dev/null)
[ "$hp" = .githooks ] || ctx="Verified-By stamping is not installed (core.hooksPath is '${hp}'); run: git config core.hooksPath .githooks"

emit() { # $1 = deny reason or empty
  jq -nc --arg ctx "$ctx" --arg reason "$1" '
    {hookEventName:"PreToolUse"}
    + (if $reason != "" then {permissionDecision:"deny", permissionDecisionReason:$reason} else {} end)
    + (if $ctx != "" then {additionalContext:$ctx} else {} end)
    | if length > 1 then {hookSpecificOutput:.} else empty end'
}

if [ "$verified" = 1 ]; then log pass; emit ""; exit 0; fi
if [ "$explained" = 1 ]; then log explained; emit ""; exit 0; fi

if [ "$mode" != enforce ]; then log would-block; emit ""; exit 0; fi

mkdir -p "$state/sessions/$sid" || fail_open "cannot create session dir"
f="$state/sessions/$sid/gate-blocks"
n=$(cat "$f" 2>/dev/null || echo 0)
if [ "$n" -ge 2 ]; then log escaped; emit ""; exit 0; fi
n=$((n + 1)); echo "$n" >"$f"
log blocked
emit "Commit gate: tree ${tree:0:12} has no passing /verify or /code-review. Run the verify skill, or add trailer \`Verification-Skipped: <why>\` (block $n/2)."
