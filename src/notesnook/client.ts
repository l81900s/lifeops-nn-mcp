/**
 * NotesnookClient — a thin, typed wrapper over a headless `@notesnook/core`
 * Database. Owns boot, authentication (with session reuse), sync, and the read
 * helpers the MCP tools expose.
 *
 * Auth model: the account password derives the E2E key; 2FA is required only on a
 * fresh login. Because the session (device id, tokens) persists in the SQLite DB
 * and the KV file, a bootstrapped install reuses the session and never needs the
 * TOTP again — which is why the server can run non-interactively after a one-time
 * `npm run login`.
 *
 * IMPORTANT: `../bootstrap.js` must be imported before this module (it sets
 * NODE_ENV + IPv4 preference before core's module code evaluates).
 */
import * as core from "@notesnook/core";
import type { Config } from "../config.js";
import { createShims } from "./shims.js";

const { Database, getContentFromData } = core as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A callback that yields the current 6-digit TOTP; retried until one is accepted. */
export type TotpProvider = () => Promise<string>;

export interface NoteSummary {
  id: string;
  title: string;
  headline?: string;
  dateCreated?: number;
  dateModified?: number;
}

export interface NoteDetail extends NoteSummary {
  contentHtml?: string;
  contentText?: string;
  attachmentHashes: string[];
}

export interface AttachmentData {
  hash: string;
  mimeType: string;
  filename?: string;
  size: number;
  base64: string;
}

export class NotesnookClient {
  private db: any;
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /** Boot the headless database. Idempotent-ish; call once per process. */
  async init(): Promise<void> {
    const { storage, fs, compressor, sqliteOptions } = createShims(
      this.config.dbPath,
      this.config.kvPath
    );
    this.db = new Database();
    this.db.setup({ storage, fs, compressor, sqliteOptions, batchSize: 100 });
    await this.db.init();
  }

  /** True if a persisted session exists (device already logged in). */
  async isAuthenticated(): Promise<boolean> {
    const user = await this.db.user.getUser();
    return !!user?.email;
  }

  /**
   * Ensure we have a usable session + encryption key. Reuses a persisted session
   * when present (re-deriving the encryption key from the password + user salt, no
   * TOTP). Otherwise runs the 3-step MFA login, which needs `totpProvider`.
   */
  async ensureAuthenticated(totpProvider?: TotpProvider): Promise<void> {
    const existing = await this.db.user.getUser();
    if (existing?.email) {
      if (!(await this.db.storage().getCryptoKey())) {
        await this.db.storage().deriveCryptoKey({
          password: this.config.password,
          salt: existing.salt,
        });
      }
      return;
    }

    if (!totpProvider) {
      throw new Error(
        "Not authenticated and no TOTP provider. Run `npm run login` once to bootstrap the session."
      );
    }
    await this.login(totpProvider);
  }

  /** The 3-step email -> MFA(app) -> password login. */
  private async login(totpProvider: TotpProvider): Promise<void> {
    const { email, password } = this.config;
    await this.db.user.authenticateEmail(email);

    // MFA: retry fresh codes until one is accepted (or ~6 min budget).
    let done = false;
    let lastTried = "";
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline && !done) {
      const code = (await totpProvider())?.trim();
      if (/^\d{6}$/.test(code) && code !== lastTried) {
        lastTried = code;
        try {
          await this.db.user.authenticateMultiFactorCode(code, "app");
          done = true;
        } catch (e: any) {
          if (/no token/i.test(e?.message || "")) await this.db.user.authenticateEmail(email);
        }
      }
      if (!done) await sleep(1500);
    }
    if (!done) throw new Error("No valid 2FA code accepted within the time budget.");

    await this.db.user.authenticatePassword(email, password);
  }

  /** Pull latest data from the server (read-only fetch). Returns items merged. */
  async sync(force = false): Promise<{ merged: number; lastSynced: number }> {
    let merged = 0;
    // subscribe(...) returns { unsubscribe }; capture it so repeated syncs in the
    // long-running server don't leak a listener per call.
    const sub = this.db.eventManager.subscribe("sync:itemMerged", () => { merged++; });
    try {
      await this.db.sync({ type: "fetch", force });
    } finally {
      try { sub?.unsubscribe?.(); } catch { /* ignore */ }
    }
    return { merged, lastSynced: await this.db.lastSynced() };
  }

  /** Most-recently-created notes, newest first. */
  async listRecentNotes(limit = 20): Promise<NoteSummary[]> {
    const ids: string[] = await this.db.notes.all.ids();
    const slice = ids.slice(0, Math.max(0, limit));
    const notes = await Promise.all(slice.map((id) => this.db.notes.note(id)));
    return notes.filter(Boolean).map((n: any) => this.toSummary(n));
  }

  /** Full-text/title search. Falls back to id-mapping if items() is unavailable. */
  async searchNotes(query: string, limit = 20): Promise<NoteSummary[]> {
    const result = this.db.lookup.notes(query);
    let notes: any[] = [];
    try {
      notes = await result.items();
    } catch {
      const ids: string[] = await result.ids();
      notes = (await Promise.all(ids.slice(0, limit).map((id) => this.db.notes.note(id)))).filter(Boolean);
    }
    return notes.slice(0, limit).map((n) => this.toSummary(n));
  }

  /** A note with decrypted content (HTML + plaintext) and its attachment hashes. */
  async readNote(id: string): Promise<NoteDetail | null> {
    const note = await this.db.notes.note(id);
    if (!note) return null;

    let contentHtml: string | undefined;
    let contentText: string | undefined;
    if (note.contentId) {
      const content = await this.db.content.get(note.contentId);
      if (content && !content.locked && typeof content.data === "string") {
        contentHtml = content.data;
        try {
          // core signature is getContentFromData(type, data) — order matters.
          contentText = getContentFromData(content.type, content.data).toTXT();
        } catch {
          /* leave contentText undefined if the processor can't parse it */
        }
      }
    }

    const attachments = await this.db.attachments.ofNote(id, "all").items().catch(() => []);
    const attachmentHashes = (attachments || [])
      .map((a: any) => a.hash ?? a.metadata?.hash)
      .filter(Boolean);

    return { ...this.toSummary(note), contentHtml, contentText, attachmentHashes };
  }

  /** All notebooks (id + title). */
  async listNotebooks(): Promise<{ id: string; title: string }[]> {
    const items: any[] = await this.db.notebooks.all.items();
    return items.map((nb) => ({ id: nb.id, title: nb.title }));
  }

  /** Download + decrypt an attachment by hash, returned as base64 + metadata. */
  async readAttachment(hash: string): Promise<AttachmentData | null> {
    const att = await this.db.attachments.attachment(hash);
    if (!att) return null;
    // FileStorage.downloadFile builds the /s3 url + bearer token and calls our shim.
    await this.db.fs().downloadFile(hash, hash, att.chunkSize);
    // Read the exact spike-proven way (uint8array), then base64-encode ourselves —
    // more predictable than core's base64 data-URL wrapping.
    const bytes: Uint8Array | undefined = await this.db.attachments.read(hash, "uint8array");
    if (!bytes || !bytes.length) return null;
    return {
      hash,
      mimeType: att.mimeType || "application/octet-stream",
      filename: att.filename,
      size: att.size,
      base64: Buffer.from(bytes).toString("base64"),
    };
  }

  private toSummary(n: any): NoteSummary {
    return {
      id: n.id,
      title: n.title,
      headline: n.headline,
      dateCreated: n.dateCreated,
      dateModified: n.dateModified,
    };
  }
}
