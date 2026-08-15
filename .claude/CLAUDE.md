# Project Overview

**lifeops-nn-mcp** is the **MCP server** that gives Claude Code handles to read and act on a [Notesnook](https://notesnook.com) account — an open-source, end-to-end-encrypted notes app — exposing Notesnook actions (read / search / create / update / etc.) as tools Claude Code can invoke.

It is one of the three [LifeOps](../lifeops-system) sibling repos and serves as LifeOps's capture/read bridge: phone-captured notes and screenshots sync (E2E-encrypted) to Notesnook, and this server lets LifeOps read and consolidate them with no third party able to scan the content. The other siblings are `lifeops-system` (architecture, GitHub) and `lifeops-data` (the personal corpus + runtime state, self-hosted gitea, never GitHub). This repo is GitHub-bound, so it must never contain personal data or credentials.

The project is local-only today; there is no npm / hosted distribution path yet. Once the MCP surface stabilizes it may grow into a publishable package, but that's not a current concern.

> **Naming**: **lifeops-nn-mcp** is the repo / package name (`nn` = Notesnook). Use it verbatim in code, config, and docs.

## Architecture / Stack

- **TypeScript on Node.js** — primary implementation language. Chosen so lifeops-nn-mcp can directly `import` Notesnook's own client packages instead of reimplementing crypto or bridging across runtimes.
- **MCP server** — the project's deliverable. Built with [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk). Registered (eventually) via this repo's `.mcp.json` (at the repo root, not under `.claude/`). The dev session will likely want to add lifeops-nn-mcp to its own `.mcp.json` once a prototype exists, for dogfood testing.
- **Notesnook integration approach** — wrap [`@notesnook/core`](https://www.npmjs.com/package/@notesnook/core) (with `@notesnook/crypto`, `@notesnook/sodium`). This gives lifeops-nn-mcp full client behavior — auth, sync, encrypt/decrypt, schema — using the same code paths Notesnook's own apps use. Auth model follows from `@notesnook/core`: user account password is required at startup (Argon2-derived key); credentials live in `.env` and/or OS keyring, never in code or git history. The hosted Notesnook backend at `api.notesnook.com` is the target server.
  - **Alternative considered:** the Inbox API (write-only OpenPGP endpoint) would let this server be pure Python/pure-anything with no copyleft, but it can't read/search/update/delete. We picked the richer surface. Full tradeoff analysis + the decision record live in [`../lifeops-system/docs/nn-mcp-integration.md`](../lifeops-system/docs/nn-mcp-integration.md).
  - **`@notesnook/core` runs inside an app** (web/Electron/RN) and assumes browser storage / fetch / etc. Running it headless from Node needs injected shims — `IStorage` (KV + crypto), `IFileStorage`, `ICompressor`, and a SQLite dialect (`@streetwriters/kysely` + `better-sqlite3`). **This is proven working** end-to-end (login → sync → note read → image decrypt); the non-obvious fixes (login-hash salt, `NODE_ENV=production`, `format:"base64"` on decrypt, chunked file decrypt, two-step attachment download) are recorded in the integration doc above. Port from the validated spike rather than re-deriving.

## Repo Layout

```
lifeops-nn-mcp/
├── README.md
├── .gitignore
├── package.json
├── tsconfig.json
└── .claude/                ← Claude Code config (this file, skills, hooks, settings)
```

Populate as code lands. Current / planned structure:
- `package-lock.json` (npm) — pin the package manager early; switching later is painful
- `node_modules/` (gitignored)
- `src/notesnook/` — the headless `@notesnook/core` client: shims (`storage`, `fs`, `compressor`), login, sync, read
- `src/server.ts` — MCP server entry point (stdio transport)
- `src/tools/` — one file per MCP tool (or grouped by Notesnook entity)
- `src/login.ts` — the one-time interactive 2FA bootstrap CLI (`npm run login`)
- `dist/` (compiled output, gitignored)
- `.mcp.json` (registers lifeops-nn-mcp for this dev session, at repo root)
- `.env` (gitignored) — `NOTESNOOK_EMAIL` / `NOTESNOOK_PASSWORD`
- `tests/`

**Runtime state lives OUTSIDE this repo**, in `lifeops-data/state/nn-mcp/` (the SQLite cache + session KV). `lifeops-data` has no GitHub remote, so account data and auth material are structurally unable to reach a public host. The path is resolved from `LIFEOPS_STATE_DIR` (default: the sibling `../lifeops-data/state/nn-mcp`). Never write session/cache/auth files inside this repo.

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

Fill in real commands as the project grows. Pin Node in `package.json` `engines` to **≥20** — the headless client needs `net.setDefaultAutoSelectFamily` / `dns.setDefaultResultOrder` (Node 20+) to survive IPv6-first/slow links. Node 22 LTS or newer recommended.

## Local configuration (personal paths, credentials)

The tracked `.claude/` directory is shared across anyone working on lifeops-nn-mcp. Anything that varies per-developer — credential paths, dev hostnames, local DB URLs, SSH keys — belongs in `.claude/settings.local.json` (gitignored). Skills, hooks, and this file reference those values as `$VAR_NAME`, and Claude Code exports them into the session's environment via the file's `env` block.

After cloning, run once:

```bash
.claude/hooks/install.sh
```

This sets `core.hooksPath` to `.claude/hooks/git`, marks the hook scripts executable, and seeds `settings.local.json` from the tracked `settings.example.json` template if you don't already have one.

The pre-commit guard at `.claude/hooks/git/pre-commit.d/00-protect-tracked-claude-files.sh` blocks any commit that touches shared `.claude/` files. Only the maintainer should bypass it, by exporting `CLAUDE_BOOTSTRAP_MAINTAINER=1` (typically in their shell rc).

**For Claude:** when asked to change a credential path or hostname, edit `.claude/settings.local.json`, NOT the skill, hook, or CLAUDE.md that references it. If the value isn't already a `$VAR_NAME`, propose renaming it to one and add the variable to both `settings.example.json` (with a redacted placeholder) and `settings.local.json` (with the real value) — but only update `settings.example.json` if you're the maintainer.

lifeops-nn-mcp currently has zero `$VAR_NAME` references — Notesnook credentials live in `lifeops-data/state/nn-mcp/credentials.json` (gitea-only, gitignored), not in `.env` and not in `settings.local.json`. The convention is in place for when a future skill needs one.

## Important Caveats

- **Node / package manager**: pin Node to an LTS version in `package.json` `engines` so contributors and CI match. Default to **npm** unless there's a reason to use pnpm/yarn; do not mix lockfiles.
- **MCP servers are security-sensitive.** Tools exposed by an MCP server execute on behalf of the calling Claude session. Any Notesnook action lifeops-nn-mcp exposes — especially destructive ones like delete-note, delete-notebook, or bulk-edit — should validate inputs carefully and prefer reversible operations. Notesnook's schema has soft-delete (`dateDeleted` → trash, recoverable) vs. hard-delete (`deleted=true` → tombstone); prefer soft-delete by default and reserve hard-delete for an explicitly destructive tool. Run `/code-review` on changes that add or alter exposed tools before relying on them.
- **Notesnook is end-to-end encrypted.** Crypto is libsodium (XChaCha20-Poly1305 + Argon2id/i). The user's account password is required to derive the encryption key — there is no token-only or service-account path that decrypts content. Treat the password as the most sensitive input lifeops-nn-mcp handles; never log it, never persist it except via OS keyring or `.env`. Whatever integration approach lifeops-nn-mcp uses, the auth / key model must not leak unencrypted user data into commit history, logs, or repo files.
- **GPL-3.0-or-later contagion via `@notesnook/core`.** `@notesnook/core` is GPL-3.0-or-later, and lifeops-nn-mcp `import`s it directly — that makes lifeops-nn-mcp a combined work under the GPL. Fine for local-only exploratory use today, but if/when lifeops-nn-mcp is published or distributed, lifeops-nn-mcp itself must be GPL-3.0-compatible. Pick a license file deliberately before shipping; do not add proprietary code paths that assume otherwise.
- **No secrets in the repo, and no `.env`.** Notesnook credentials (email + account password) live in `lifeops-data/state/nn-mcp/credentials.json` (gitea-only, gitignored), never in this repo, code, tests, or fixtures. `NOTESNOOK_EMAIL` / `NOTESNOOK_PASSWORD` env vars are an optional override. `.env*` is still denied for read / edit in `settings.json` as defense-in-depth.
- **Coordinates with `lifeops-data` for state.** This repo is GitHub-bound and holds no personal data, but it *reads/writes runtime state* into the sibling `lifeops-data/state/nn-mcp/` (gitea-only, gitignored) — see Repo Layout. The dependency is soft and configurable via `LIFEOPS_STATE_DIR`, so the server still runs if pointed elsewhere. It also references `lifeops-system/docs/nn-mcp-integration.md` for the decision record. Never inline personal data or credentials into this repo to avoid the sibling dependency.
- **Never persist data/auth inside this repo.** SQLite cache, session KV (tokens + derived encryption key), and `credentials.json` all live in the state dir under `lifeops-data` — never the repo tree. A stray write of any of these into the repo is a privacy-boundary violation, since this repo pushes to GitHub.
- **Commit messages**: see "Commit Message Tags" below — this project uses `[drop-in]` / `[breaks: ...]`.
- **No Claude attribution in commits.** Commit messages must never contain `🤖 Generated with Claude Code`, `Co-Authored-By: Claude`, or similar auto-attribution. Write commits in the operator's voice.

## Commit Message Tags

Every commit subject line ends with one of these tags:

| Tag | When to use |
|---|---|
| `[drop-in]` | No new dependencies, no schema changes, no config changes. Just `git pull`. |
| `[breaks: X, Y, …]` | Extra steps required beyond pulling. |

**`breaks:` items currently relevant to lifeops-nn-mcp (local-only TypeScript/Node MCP server):**

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

- **Deploy / production hosting** — lifeops-nn-mcp is local-only. Do not spend effort on systemd units, container images, or CI deploy pipelines unless explicitly asked.
- **npm publishing** — not in scope yet. The `/deploy` skill is kept only as a future scaffold; don't activate it.
- **Backwards compatibility with non-existent users** — this is exploratory. Break the MCP surface freely until something stabilizes; flag the break in the commit tag.

## MCP Servers

> **PLACEMENT:** MCP server registration lives at the **repo root** in `.mcp.json` — Claude Code does not support placing it under `.claude/`. Add `.mcp.json` when lifeops-nn-mcp (or any other MCP server) needs to be registered for this dev session.

| Server | Purpose |
|---|---|
| `lifeops-nn-mcp` *(prototype — register when built)* | The project's own MCP server (stdio). The headless client path is proven; register in `.mcp.json` for dogfood testing once `npm run build` produces `dist/server.js`. |

Other MCP servers (e.g., a vault MCP, a Linear MCP) can be added if/when lifeops-nn-mcp's development needs them.

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
| `/deploy` | `.claude/skills/deploy/SKILL.md` | *(template — kept as a future scaffold)* Deploy + validate. lifeops-nn-mcp is local-only today; customize this when a publish or install path materializes. |
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
