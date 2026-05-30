# Project Overview

**ccnn** (*Claude Code Notesnook*) is a project to give Claude Code handles for executing actions in [Notesnook](https://notesnook.com) — an open-source, end-to-end-encrypted notes app. ccnn will ship as an **MCP server** that exposes Notesnook actions (read / create / update / search / etc.) as tools that Claude Code can invoke.

The project is local-only today; there is no npm / hosted distribution path yet, and no sister repos. Once the MCP surface stabilizes it may grow into a publishable package, but that's not a current concern.

> **Naming**:
> - **ccnn** is the repo / package short name.
> - **Claude Code Notesnook** is the full name; use the short name in code, the long name in docs and commit messages where clarity matters.

## Architecture / Stack

- **TypeScript on Node.js** — primary implementation language. Chosen so ccnn can directly `import` Notesnook's own client packages instead of reimplementing crypto or bridging across runtimes.
- **MCP server** — the project's deliverable. Built with [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk). Registered (eventually) via this repo's `.mcp.json` (at the repo root, not under `.claude/`). The dev session will likely want to add ccnn to its own `.mcp.json` once a prototype exists, for dogfood testing.
- **Notesnook integration approach** — wrap [`@notesnook/core`](https://www.npmjs.com/package/@notesnook/core) (with `@notesnook/crypto`, `@notesnook/sodium`). This gives ccnn full client behavior — auth, sync, encrypt/decrypt, schema — using the same code paths Notesnook's own apps use. Auth model follows from `@notesnook/core`: user account password is required at startup (Argon2-derived key); credentials live in `.env` and/or OS keyring, never in code or git history. The hosted Notesnook backend at `api.notesnook.com` is the target server.
  - **Alternative considered:** the Inbox API (write-only OpenPGP endpoint) would let ccnn be pure Python/pure-anything with no copyleft, but it can't read/search/update/delete. We picked the richer surface — see `[[integration-approach-decision]]` in session memory for the tradeoff analysis.
  - **`@notesnook/core` runs inside an app** (web/Electron/RN) and may assume browser storage / fetch / etc. Some adapter wiring is likely needed to run it from a plain Node MCP server. `streetwriters/notesnook-importer` is the closest precedent for "use `@notesnook/core` outside an app" — read it before scaffolding.

## Repo Layout

```
ccnn/
├── README.md
├── .gitignore
├── package.json
├── tsconfig.json
└── .claude/                ← Claude Code config (this file, skills, hooks, settings)
```

Greenfield — populate as code lands. Likely additions:
- `package-lock.json` (npm) — pin the package manager early; switching later is painful
- `node_modules/` (gitignored)
- `src/` (TypeScript source)
- `src/server.ts` (MCP server entry point)
- `src/tools/` (one file per MCP tool, or grouped by Notesnook entity)
- `dist/` (compiled output, gitignored)
- `.mcp.json` (registers ccnn for this dev session, at repo root)
- `tests/`

## CLI / Common Commands

```bash
# Install dependencies
npm install

# Run the MCP server in dev mode (tsx watches and reruns on change)
npm run dev

# Build + run compiled
npm run build && npm start

# Tests (once tests exist — vitest is the planned framework)
npm test
```

Fill in real commands as the project grows. Pin Node to the current Active LTS (Node 22.x as of 2026-05) in `package.json` `engines`.

## Local configuration (personal paths, credentials)

The tracked `.claude/` directory is shared across anyone working on ccnn. Anything that varies per-developer — credential paths, dev hostnames, local DB URLs, SSH keys — belongs in `.claude/settings.local.json` (gitignored). Skills, hooks, and this file reference those values as `$VAR_NAME`, and Claude Code exports them into the session's environment via the file's `env` block.

After cloning, run once:

```bash
.claude/hooks/install.sh
```

This sets `core.hooksPath` to `.claude/hooks/git`, marks the hook scripts executable, and seeds `settings.local.json` from the tracked `settings.example.json` template if you don't already have one.

The pre-commit guard at `.claude/hooks/git/pre-commit.d/00-protect-tracked-claude-files.sh` blocks any commit that touches shared `.claude/` files. Only the maintainer should bypass it, by exporting `CLAUDE_BOOTSTRAP_MAINTAINER=1` (typically in their shell rc).

**For Claude:** when asked to change a credential path or hostname, edit `.claude/settings.local.json`, NOT the skill, hook, or CLAUDE.md that references it. If the value isn't already a `$VAR_NAME`, propose renaming it to one and add the variable to both `settings.example.json` (with a redacted placeholder) and `settings.local.json` (with the real value) — but only update `settings.example.json` if you're the maintainer.

ccnn currently has zero `$VAR_NAME` references — Notesnook credentials live in a top-level `.env` (already gitignored and denied in `settings.json`), not in `settings.local.json`. The convention is in place for when a future skill needs one.

## Important Caveats

- **Node / package manager**: pin Node to an LTS version in `package.json` `engines` so contributors and CI match. Default to **npm** unless there's a reason to use pnpm/yarn; do not mix lockfiles.
- **MCP servers are security-sensitive.** Tools exposed by an MCP server execute on behalf of the calling Claude session. Any Notesnook action ccnn exposes — especially destructive ones like delete-note, delete-notebook, or bulk-edit — should validate inputs carefully and prefer reversible operations. Notesnook's schema has soft-delete (`dateDeleted` → trash, recoverable) vs. hard-delete (`deleted=true` → tombstone); prefer soft-delete by default and reserve hard-delete for an explicitly destructive tool. Run `/code-review` on changes that add or alter exposed tools before relying on them.
- **Notesnook is end-to-end encrypted.** Crypto is libsodium (XChaCha20-Poly1305 + Argon2id/i). The user's account password is required to derive the encryption key — there is no token-only or service-account path that decrypts content. Treat the password as the most sensitive input ccnn handles; never log it, never persist it except via OS keyring or `.env`. Whatever integration approach ccnn uses, the auth / key model must not leak unencrypted user data into commit history, logs, or repo files.
- **GPL-3.0-or-later contagion via `@notesnook/core`.** `@notesnook/core` is GPL-3.0-or-later, and ccnn `import`s it directly — that makes ccnn a combined work under the GPL. Fine for local-only exploratory use today, but if/when ccnn is published or distributed, ccnn itself must be GPL-3.0-compatible. Pick a license file deliberately before shipping; do not add proprietary code paths that assume otherwise.
- **No secrets in the repo.** Notesnook credentials (account password, recovery key, any API tokens) live in `.env` (gitignored), never in code, tests, or fixtures. `.env*` is denied for read / edit in `settings.json` as defense-in-depth.
- **Standalone repo.** ccnn does not coordinate with sister repos. If that changes, add the relationship to this section.
- **Commit messages**: see "Commit Message Tags" below — this project uses `[drop-in]` / `[breaks: ...]`.
- **No Claude attribution in commits.** Commit messages must never contain `🤖 Generated with Claude Code`, `Co-Authored-By: Claude`, or similar auto-attribution. Write commits in the operator's voice.

## Commit Message Tags

Every commit subject line ends with one of these tags:

| Tag | When to use |
|---|---|
| `[drop-in]` | No new dependencies, no schema changes, no config changes. Just `git pull`. |
| `[breaks: X, Y, …]` | Extra steps required beyond pulling. |

**`breaks:` items currently relevant to ccnn (local-only TypeScript/Node MCP server):**

| Item | Required action |
|---|---|
| `deps` | `npm install` (lockfile or `package.json` changed) |
| `node` | Required Node version changed (`engines` bumped). Re-install Node / update `nvm use`. |
| `env` | A new env var or `.env` entry is needed (e.g., a new Notesnook credential). Document the var in commit body. |
| `mcp-config` | The MCP registration in `.mcp.json` changed (server name, command, args). Restart the dev Claude session to pick up the change. |
| `hooks` | `.claude/hooks/git/` or `install.sh` changed. Re-run `.claude/hooks/install.sh` to pick up new dispatcher scripts or permissions. |

Add more `breaks:` items as the project grows. Keep the table truthful — only list items that actually apply.

**Examples:**
```
feat: scaffold MCP server skeleton, add @modelcontextprotocol/sdk + @notesnook/core [breaks: deps, mcp-config]
feat: add list-notebooks tool [drop-in]
feat: read NOTESNOOK_PASSWORD from env [breaks: env]
fix: handle 401 from @notesnook/core auth gracefully [drop-in]
```

## Do Not Worry About

- **Deploy / production hosting** — ccnn is local-only. Do not spend effort on systemd units, container images, or CI deploy pipelines unless explicitly asked.
- **npm publishing** — not in scope yet. The `/deploy` skill is kept only as a future scaffold; don't activate it.
- **Backwards compatibility with non-existent users** — this is exploratory. Break the MCP surface freely until something stabilizes; flag the break in the commit tag.

## MCP Servers

> **PLACEMENT:** MCP server registration lives at the **repo root** in `.mcp.json` — Claude Code does not support placing it under `.claude/`. Add `.mcp.json` when ccnn (or any other MCP server) needs to be registered for this dev session.

| Server | Purpose |
|---|---|
| `ccnn` *(in development — not yet registered)* | The project's own MCP server. Once a prototype exists, register it here for dogfood testing. |

Other MCP servers (e.g., a vault MCP, a Linear MCP) can be added if/when ccnn's development needs them.

## Plugins

| Plugin | Purpose |
|---|---|
| `feature-dev` | Guided feature development with codebase analysis, architecture design, and code review agents |
| `skill-creator` | Create and iterate on Claude Code skills |
| `commit-commands` | `/commit` and `/commit-push-pr` for streamlined git workflows |
| `claude-code-setup` | Recommends automations (hooks, subagents, skills, plugins, MCP servers) |
| `hookify` | Helps create hooks that prevent unwanted behaviors |
| `code-review` | 5 parallel agents checking bugs, security, quality, and correctness — useful for MCP tool surfaces |

## Project Skills

Project-specific slash commands live in `.claude/skills/<name>/SKILL.md`.

**Core skills (shipped by the bootstrap — directories exist but `SKILL.md` files are not populated yet):**

| Command | File | Purpose |
|---|---|---|
| `/deploy` | `.claude/skills/deploy/SKILL.md` | *(template — kept as a future scaffold)* Deploy + validate. ccnn is local-only today; customize this when a publish or install path materializes. |
| `/annotate` | `.claude/skills/annotate/SKILL.md` | Add or improve TSDoc / JSDoc comments across the codebase using project-aware vocabulary |
| `/smart-compact` | `.claude/skills/smart-compact/SKILL.md` | Snapshot session state to JSON, hand off to `/compact`, and rehydrate on the other side |

**Your skills:**

(Add project-specific skills here as you build them.)

## Project Hooks

Project-specific git hooks live in `.claude/hooks/`. Install them by copying into `.git/hooks/`. The directory exists but no hooks are populated yet; add them as needs surface (e.g., a TSDoc-coverage check on staged `.ts` files, a `tsc --noEmit` gate on commit).

## Annotation / docstring standards

All TypeScript files should have:
- A **module-level header comment** describing the file's role, assumptions, and any non-obvious invariants
- **TSDoc on every exported function, class, and type** explaining intent (the WHY), state, and cross-module semantics
- **TSDoc on every MCP tool handler** — but note that for MCP tool *discovery* Claude reads the `description` field passed at tool-registration time, not the TSDoc. Keep both in sync; the description is the load-bearing one.
- TSDoc on non-trivial internals — anything where a reader would have to re-derive the rationale from code alone

Use plain prose. Focus on WHY and what's non-obvious. Don't restate types or signatures — TypeScript already does that.
