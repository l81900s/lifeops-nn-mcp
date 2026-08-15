# lifeops-nn-mcp

**lifeops-nn-mcp** gives Claude Code handles to read and act on a [Notesnook](https://notesnook.com) account — the open-source, end-to-end-encrypted notes app — by exposing Notesnook actions as [MCP](https://modelcontextprotocol.io) tools.

It is the capture/read bridge for [LifeOps](../lifeops-system): notes and screenshots captured on a phone sync (E2E-encrypted) to Notesnook's backend, and this server lets LifeOps read and consolidate them without any content ever passing through a third party that could scan it.

## How it works

The server runs a **headless [`@notesnook/core`](https://www.npmjs.com/package/@notesnook/core) client** — the same code path Notesnook's own apps use — so it authenticates, syncs, and decrypts with full fidelity (libsodium XChaCha20-Poly1305 + Argon2id). The hosted backend at `api.notesnook.com` is the source of truth; the server keeps a local encrypted-at-rest cache and reuses its session across runs.

This approach is **proven end-to-end** (login → sync → note read → image attachment decrypt). See [`../lifeops-system/docs/nn-mcp-integration.md`](../lifeops-system/docs/nn-mcp-integration.md) for the decision record and the non-obvious protocol fixes.

## State & credentials

- **Session/cache** (SQLite + key-value store) **and credentials** all live in **`lifeops-data/state/nn-mcp/`** — gitignored, and `lifeops-data` has no GitHub remote, so account data and auth material are structurally unable to reach a public host. The path is overridable via `LIFEOPS_STATE_DIR`.
- **No `.env`.** Credentials are read from `lifeops-data/state/nn-mcp/credentials.json` (`{"email","password"}`, gitignored — in the sensitive repo but out of git history). `NOTESNOOK_EMAIL` / `NOTESNOOK_PASSWORD` env vars override if set.
- **Two-factor login is a one-time bootstrap** (`npm run login`, prompts for the TOTP once). Afterward the server silently reuses the persisted session.

## Quick start

```bash
npm install
# put your creds in lifeops-data/state/nn-mcp/credentials.json (see credentials.example.json)
npm run login                 # one-time interactive 2FA bootstrap
npm run build && npm start    # run the MCP server (stdio)
```

## Status

Early. See `.claude/CLAUDE.md` for architecture, conventions, and the tool roadmap.
