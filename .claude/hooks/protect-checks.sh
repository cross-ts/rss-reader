#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit): denies edits to the verification gate files.
# Fails open: an internal error must not block unrelated edits.

command -v jq >/dev/null || exit 0
payload=$(cat)
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$payload" 2>/dev/null) || exit 0
[ -n "$path" ] || exit 0
root=${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$payload" 2>/dev/null)}
[ -n "$root" ] || exit 0

# realpath is absent on older macOS. Resolves the deepest existing ancestor physically
# (cd -P) and follows a symlinked leaf, so symlinks cannot route around the protected set.
resolve() {
  local p=$1 base="" dir t i=0
  while [ -n "$p" ] && [ "$p" != / ] && [ ! -e "$p" ] && [ ! -L "$p" ]; do
    base="/${p##*/}$base"
    p=${p%/*}
    [ -n "$p" ] || p=/
  done
  while [ -L "$p" ] && [ $((i++)) -lt 20 ]; do
    t=$(readlink "$p") || return 1
    case $t in /*) p=$t ;; *) p="${p%/*}/$t" ;; esac
  done
  if [ -d "$p" ]; then
    dir=$(cd -P "$p" 2>/dev/null && pwd -P) || return 1
    printf '%s%s' "${dir%/}" "$base"
  else
    dir=$(cd -P "${p%/*}" 2>/dev/null && pwd -P) || return 1
    printf '%s/%s%s' "${dir%/}" "${p##*/}" "$base"
  fi
}

normalize() {
  local IFS=/ part out=() seg
  for part in $1; do
    case $part in
      ""|.) ;;
      ..) [ "${#out[@]}" -gt 0 ] && unset 'out[${#out[@]}-1]' ;;
      *) out+=("$part") ;;
    esac
  done
  seg=$(printf '/%s' "${out[@]}")
  printf '%s' "${seg:-/}"
}

case $path in /*) abs=$path ;; *) abs="$root/$path" ;; esac
# Existing paths are resolved first so ".." after a symlinked directory follows the kernel's
# semantics; non-existent ones are collapsed lexically first.
if [ -e "$abs" ] || [ -L "$abs" ]; then
  full=$(resolve "$abs") || exit 0
else
  full=$(resolve "$(normalize "$abs")") || exit 0
fi
full=$(normalize "$full")
rootp=$(cd -P "$root" 2>/dev/null && pwd -P) || exit 0

case $full in
  "$rootp"/.claude/settings.json|"$rootp"/.claude/hooks/*|"$rootp"/.githooks/*|"$rootp"/scripts/verify/*)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"verification gate file; a human edits this outside the agent"}}'
    ;;
esac
exit 0
