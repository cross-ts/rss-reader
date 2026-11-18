#!/usr/bin/env bash
# Sourced by verify.sh and by hooks.

state_dir() {
  printf '%s\n' "${XDG_STATE_HOME:-$HOME/.local/state}/rss-reader"
}

# Hashes the working tree through a throwaway index so the real index and stash stay untouched.
worktree_tree() {
  local dir t tree
  dir="$(state_dir)/tmp"
  mkdir -p "$dir"
  t=$(mktemp "$dir/index.XXXXXX") || return 1
  rm -f "$t"
  tree=$(GIT_INDEX_FILE=$t git read-tree HEAD &&
    GIT_INDEX_FILE=$t git add -A &&
    GIT_INDEX_FILE=$t git write-tree) || { rm -f "$t"; return 1; }
  rm -f "$t"
  printf '%s\n' "$tree"
}

changed_paths() {
  git status --porcelain -uall | sed -E 's/^.{3}//; s/^.* -> //; s/^"(.*)"$/\1/'
}
