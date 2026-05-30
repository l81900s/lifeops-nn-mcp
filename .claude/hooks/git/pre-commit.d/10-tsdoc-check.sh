#!/usr/bin/env bash
# Warn if staged TypeScript / JavaScript files lack a module-level header
# comment or TSDoc on exported declarations.
#
# Heuristic (line-based), not AST-based. Catches the obvious omissions
# without requiring the TypeScript compiler at commit time. Swap for a
# tsc-based Node script when you want stricter coverage.
#
# Non-blocking by default — change the trailing `exit 0` to `exit 1` to
# make missing docs a commit-blocking error.
#
# See CLAUDE.md → "Annotation / docstring standards" for what the project
# considers a good docstring, and run `/annotate` to fill gaps in bulk.

set -uo pipefail

mapfile -t STAGED < <(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|mjs|cjs|js)$' || true)
(( ${#STAGED[@]} == 0 )) && exit 0

warnings=0
warn() { printf '  ⚠ %s\n' "$1" >&2; warnings=$((warnings + 1)); }

for f in "${STAGED[@]}"; do
  [[ -f "$f" ]] || continue   # deleted/renamed-out — skip

  # 1) Module-level header: first non-blank, non-shebang line should begin
  # a comment.
  first="$(awk 'NR==1 && /^#!/ {next} NF {print; exit}' "$f")"
  if ! [[ "$first" =~ ^[[:space:]]*(//|/\*|\*) ]]; then
    warn "$f: no module-level header comment"
  fi

  # 2) Exported declarations should be preceded by a TSDoc block close (*/)
  # or at least an inline comment line. `export { foo } from ...` re-exports
  # don't match because the regex requires a declaration keyword.
  while IFS=: read -r lineno _; do
    [[ -z "$lineno" ]] && continue
    prev=$(sed -n "$((lineno - 1))p" "$f")
    if ! [[ "$prev" =~ (\*/[[:space:]]*$)|(^[[:space:]]*//)|(^[[:space:]]*\*) ]]; then
      warn "$f:$lineno: exported declaration without TSDoc"
    fi
  done < <(grep -nE '^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?(function|class|interface|type|enum|const|let|var)\b' "$f" || true)
done

if (( warnings > 0 )); then
  s=""; (( warnings == 1 )) || s="s"
  printf '  (%d docstring warning%s — commit allowed; flip trailing exit 0 to exit 1 in 10-tsdoc-check.sh to block)\n' "$warnings" "$s" >&2
fi

# Non-blocking by default. Change to `exit 1` to enforce.
exit 0
