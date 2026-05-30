#!/usr/bin/env bash
# Block commits that modify tracked, shared Claude Code config files.
#
# These files (skills, CLAUDE.md, settings.json, hooks, commands, agents)
# are tuned by the bootstrap maintainer and shared across the team.
# Personal/environment-specific values belong in .claude/settings.local.json
# (gitignored) and are referenced from the tracked files as $VAR_NAME.
#
# Override (only the maintainer should set this in their shell):
#   export CLAUDE_BOOTSTRAP_MAINTAINER=1

set -euo pipefail

if [[ "${CLAUDE_BOOTSTRAP_MAINTAINER:-0}" == "1" ]]; then
  exit 0
fi

PROTECTED_PREFIXES=(
  '.claude/CLAUDE.md'
  '.claude/settings.json'
  '.claude/settings.example.json'
  '.claude/skills/'
  '.claude/hooks/'
  '.claude/commands/'
  '.claude/agents/'
)

STAGED="$(git diff --cached --name-only --diff-filter=ACMRTD)"
[[ -z "$STAGED" ]] && exit 0

OFFENDERS=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  for prefix in "${PROTECTED_PREFIXES[@]}"; do
    if [[ "$f" == "$prefix"* ]]; then
      OFFENDERS+=("$f")
      break
    fi
  done
done <<< "$STAGED"

if [[ ${#OFFENDERS[@]} -eq 0 ]]; then
  exit 0
fi

{
  echo
  echo "  pre-commit: blocked commit touching shared Claude Code config."
  echo
  echo "  These files are tuned by the bootstrap maintainer and are not"
  echo "  meant to hold personal or environment-specific values:"
  echo
  for f in "${OFFENDERS[@]}"; do
    printf '      %s\n' "$f"
  done
  echo
  echo "  If you need to point a skill at your own credentials or paths,"
  echo "  edit  .claude/settings.local.json  (gitignored) instead. The"
  echo "  \$VAR_NAME placeholders in skills/CLAUDE.md resolve from there."
  echo
  echo "  If you ARE the bootstrap maintainer and meant to update these"
  echo "  files, re-run with the override flag set:"
  echo
  echo "      CLAUDE_BOOTSTRAP_MAINTAINER=1 git commit ..."
  echo
  echo "  Or export it once per shell:"
  echo
  echo "      export CLAUDE_BOOTSTRAP_MAINTAINER=1"
  echo
} >&2

exit 1
