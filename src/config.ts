/**
 * Configuration + path resolution for the headless Notesnook client.
 *
 * Two hard rules encoded here:
 *  1. Credentials live in `lifeops-data` (self-hosted gitea, no GitHub remote),
 *     NOT in this repo and NOT in a `.env`. They're read from a `credentials.json`
 *     in the state dir (gitignored — physically in the sensitive repo, but kept out
 *     of git history, since a committed password is the one thing worth avoiding
 *     even in private gitea). Environment variables override if set, so no file is
 *     mandatory when running with real env vars.
 *  2. Runtime state (SQLite cache + session KV, which includes auth tokens and the
 *     derived encryption key) lives in the same state dir. Default is the sibling
 *     `lifeops-data/state/nn-mcp`; override with LIFEOPS_STATE_DIR.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

/** Repo root, resolved from this module's location (works from src/ via tsx and dist/ via node). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Config {
  email: string;
  password: string;
  /** Absolute directory holding credentials.json, the SQLite DB, and session KV. */
  stateDir: string;
  /** Path of the SQLite database file (without the .sqlite suffix the dialect appends). */
  dbPath: string;
  /** Path of the file-backed IStorage key-value store. */
  kvPath: string;
  /** Path of the credentials file (for error messages / bootstrap). */
  credentialsPath: string;
}

/** Resolve the state directory (env override or the sibling lifeops-data path). Created if missing. */
export function resolveStateDir(): string {
  const stateDir =
    process.env.LIFEOPS_STATE_DIR?.trim() ||
    resolve(repoRoot, "..", "lifeops-data", "state", "nn-mcp");
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

/**
 * Build the runtime config. Credentials come from env vars if present, else from
 * `<stateDir>/credentials.json` ({ "email": "...", "password": "..." }).
 * `requireCreds` is false for contexts that only need paths.
 */
export function loadConfig(requireCreds = true): Config {
  const stateDir = resolveStateDir();
  const credentialsPath = resolve(stateDir, "credentials.json");

  let email = process.env.NOTESNOOK_EMAIL?.trim() ?? "";
  let password = process.env.NOTESNOOK_PASSWORD ?? "";

  if ((!email || !password) && existsSync(credentialsPath)) {
    try {
      const fromFile = JSON.parse(readFileSync(credentialsPath, "utf8"));
      email ||= (fromFile.email ?? "").trim();
      password ||= fromFile.password ?? "";
    } catch (e: any) {
      throw new Error(`Could not parse ${credentialsPath}: ${e?.message}`);
    }
  }

  if (requireCreds && (!email || !password)) {
    throw new Error(
      `Missing Notesnook credentials. Create ${credentialsPath} with {"email","password"} ` +
        `(see credentials.example.json), or set NOTESNOOK_EMAIL / NOTESNOOK_PASSWORD.`
    );
  }

  return {
    email,
    password,
    stateDir,
    dbPath: resolve(stateDir, "notesnook"),
    kvPath: resolve(stateDir, "kv.json"),
    credentialsPath,
  };
}
