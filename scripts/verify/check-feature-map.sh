#!/usr/bin/env bash
# Fails when web/e2e/FEATURES.md and the [F-…] spec titles disagree.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT/web/e2e"

doc=$(grep -oE '^\| *F-[A-Z]+-[0-9]+ *\|' FEATURES.md | grep -oE 'F-[A-Z]+-[0-9]+' | sort -u)
specs=$(grep -hoE "test\(\s*'\[F-[A-Z]+-[0-9]+\]" ./*.spec.ts | grep -oE 'F-[A-Z]+-[0-9]+' | sort -u)

[ -n "$doc" ] || { echo "no feature IDs found in web/e2e/FEATURES.md" >&2; exit 1; }

missing_tests=$(comm -23 <(printf '%s\n' "$doc") <(printf '%s\n' "$specs"))
missing_docs=$(comm -13 <(printf '%s\n' "$doc") <(printf '%s\n' "$specs"))

rc=0
if [ -n "$missing_tests" ]; then
  echo "In FEATURES.md but no spec title starts with [ID]:" >&2
  printf '  %s\n' $missing_tests >&2
  rc=1
fi
if [ -n "$missing_docs" ]; then
  echo "Spec titles with an ID missing from FEATURES.md:" >&2
  printf '  %s\n' $missing_docs >&2
  rc=1
fi
[ "$rc" -eq 0 ] && echo "feature map ok: $(printf '%s\n' "$doc" | wc -l | tr -d ' ') features"
exit "$rc"
