#!/usr/bin/env bash
# One-time per-clone setup. Run after cloning the repo:
#   .claude/hooks/install.sh
#
# 1. Points git at .claude/hooks/git as the hooks directory (so the
#    tracked dispatcher runs instead of the untracked .git/hooks/).
# 2. Marks the dispatcher and every pre-commit.d/ script executable
#    (git does not preserve the executable bit on every checkout path).
# 3. Seeds .claude/settings.local.json from settings.example.json if
#    not already present, so the developer has somewhere to put their
#    personal values.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git config core.hooksPath .claude/hooks/git
echo "  set core.hooksPath = .claude/hooks/git"

chmod +x .claude/hooks/git/pre-commit
for f in .claude/hooks/git/pre-commit.d/*; do
  [[ -f "$f" ]] && chmod +x "$f"
done
echo "  marked hooks executable"

if [[ -f .claude/settings.example.json && ! -f .claude/settings.local.json ]]; then
  cp .claude/settings.example.json .claude/settings.local.json
  echo "  seeded .claude/settings.local.json  (edit it with your real values)"
fi

# Warn if the legacy .git/hooks/pre-commit has content — it will now be
# ignored because core.hooksPath was redirected.
LEGACY=".git/hooks/pre-commit"
if [[ -f "$LEGACY" && -s "$LEGACY" ]]; then
  echo
  echo "  WARNING: $LEGACY exists and is no longer being run."
  echo "  If it had project-specific checks, move them into"
  echo "  .claude/hooks/git/pre-commit.d/ so they continue to fire."
fi

echo
echo "  done. The pre-commit hook will now block commits to shared"
echo "  .claude/ files unless CLAUDE_BOOTSTRAP_MAINTAINER=1 is set."
