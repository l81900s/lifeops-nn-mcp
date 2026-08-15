/**
 * The injected adapter shims that let `@notesnook/core` — written to run inside a
 * browser/Electron/RN app — boot headlessly under plain Node.
 *
 * `db.setup({ storage, fs, compressor, sqliteOptions })` requires four surfaces:
 *  - IStorage    — a key-value store PLUS the crypto surface (encrypt/decrypt/hash/keys)
 *  - IFileStorage — attachment download + streaming file decryption
 *  - ICompressor  — backup/session-content compression (NOT used on the sync path)
 *  - a SQLite dialect
 *
 * Every non-obvious line here was reverse-engineered against Notesnook's own source
 * and is load-bearing. See ../lifeops-system/docs/nn-mcp-integration.md. The five
 * that matter most:
 *  1. hash() salts with APP_SALT + email (NNStorage.hash) — else "Password is incorrect".
 *  2. decrypt()/decryptMulti() stamp format:"base64" on cipher items — else libsodium
 *     throws "Data cannot be null" (surfaced as a server-relayed RequestFetch error).
 *  3. readEncrypted() slices the blob into (chunkSize + ABYTES) XChaCha20 secretstream
 *     chunks — writing the whole blob at once fails to decrypt.
 *  4. downloadFile() is two-step: GET /s3?name= WITH bearer -> presigned URL (text),
 *     then GET that URL WITHOUT auth -> the encrypted bytes.
 *  5. (elsewhere) NODE_ENV=production is required so core targets api.notesnook.com.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SqliteDialect } from "@streetwriters/kysely";
import BetterSqlite3 from "better-sqlite3";

// @notesnook/crypto's node build cannot be imported via ESM named imports (its
// sodium-native addon is CJS), so bring it in through createRequire.
const require = createRequire(import.meta.url);
const { NNCrypto } = require("@notesnook/crypto");

/** Fixed application salt prepended to the (lowercased) email before the login hash. */
const APP_SALT = "oVzKtazBo7d8sb7TBvY9jw";
/** XChaCha20-Poly1305 secretstream per-chunk overhead. */
const ABYTES = 17;

export interface Shims {
  storage: any;
  fs: any;
  compressor: any;
  sqliteOptions: any;
}

/**
 * Build the four shims. `dbPath` is the SQLite file path minus the `.sqlite`
 * suffix the dialect appends; `kvPath` is the file backing the IStorage KV so the
 * session (and thus 2FA) survives process restarts.
 */
export function createShims(dbPath: string, kvPath: string): Shims {
  const crypto = new NNCrypto();

  // --- File-backed IStorage KV: persists tokens/keys across runs ---
  const kv = new Map<string, any>(
    existsSync(kvPath) ? JSON.parse(readFileSync(kvPath, "utf8")) : []
  );
  const flushKV = () => {
    try {
      writeFileSync(kvPath, JSON.stringify([...kv.entries()]));
    } catch {
      /* best-effort; SQLite is the primary session store */
    }
  };

  const storage = {
    async write(key: string, data: any) { kv.set(key, data); flushKV(); },
    async writeMulti(entries: [string, any][]) { for (const [k, v] of entries) kv.set(k, v); flushKV(); },
    async readMulti(keys: string[]) { return keys.map((k) => [k, kv.get(k)]); },
    async read(key: string) { return kv.get(key); },
    async remove(key: string) { kv.delete(key); flushKV(); },
    async removeMulti(keys: string[]) { keys.forEach((k) => kv.delete(k)); flushKV(); },
    async clear() { kv.clear(); flushKV(); },
    async getAllKeys() { return [...kv.keys()]; },
    async encrypt(key: any, plainText: string) { return crypto.encrypt(key, plainText, "text", "base64"); },
    async encryptMulti(key: any, items: any[]) { return crypto.encryptMulti(key, items, "text", "base64"); },
    // Fix #2: sync items arrive with no `format`; NNCrypto.transformInput needs it.
    async decrypt(key: any, cipherData: any) { cipherData.format = "base64"; return crypto.decrypt(key, cipherData, "text"); },
    async decryptMulti(key: any, items: any[]) { items.forEach((c) => { c.format = "base64"; }); return crypto.decryptMulti(key, items, "text"); },
    // Fix #1: login hash salts with APP_SALT + email.
    async hash(password: string, email: string) { return crypto.hash(password, APP_SALT + email); },
    async generateCryptoKey(password: string, salt: string) { return crypto.exportKey(password, salt); },
    async deriveCryptoKey(credentials: { password: string; salt: string }) {
      const derived = await crypto.exportKey(credentials.password, credentials.salt);
      kv.set("userEncryptionKey", derived);
      flushKV();
    },
    async getCryptoKey() { return kv.get("userEncryptionKey")?.key; },
  };

  // --- IFileStorage: attachment download + streaming decrypt ---
  const fileChunks = new Map<string, Uint8Array>();
  const fs = {
    downloadFile(filename: string, requestOptions: any) {
      let cancelled = false;
      return {
        async execute() {
          if (cancelled) return false;
          // Fix #4: two-step download.
          const urlRes = await fetch(requestOptions.url, { headers: requestOptions.headers });
          if (!urlRes.ok) throw new Error(`downloadFile ${filename}: signed-url HTTP ${urlRes.status}`);
          const signedUrl = (await urlRes.text()).trim();
          const res = await fetch(signedUrl);
          if (!res.ok) throw new Error(`downloadFile ${filename}: fetch HTTP ${res.status}`);
          fileChunks.set(filename, new Uint8Array(await res.arrayBuffer()));
          return true;
        },
        async cancel() { cancelled = true; },
      };
    },
    uploadFile() { return { async execute() { return true; }, async cancel() {} }; },
    // Fix #3: decrypt the file one (chunkSize + ABYTES) secretstream chunk at a time.
    async readEncrypted(filename: string, encryptionKey: any, cipherData: any) {
      const enc = fileChunks.get(filename);
      if (!enc) return undefined;
      const encChunkSize = (cipherData.chunkSize || 512 * 1024) + ABYTES;
      const decryptionStream = await crypto.createDecryptionStream(encryptionKey, cipherData.iv);
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let off = 0; off < enc.length; off += encChunkSize)
            controller.enqueue(enc.subarray(off, Math.min(off + encChunkSize, enc.length)));
          controller.close();
        },
      });
      const out: Uint8Array[] = [];
      // decryptionStream is `any` (untyped NNCrypto); assert the piped output type.
      const decrypted = source.pipeThrough(decryptionStream) as ReadableStream<Uint8Array>;
      const reader = decrypted.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) out.push(value); }
      const total = out.reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(total);
      let off = 0; for (const c of out) { bytes.set(c, off); off += c.length; }
      return cipherData.outputType === "uint8array" ? bytes : Buffer.from(bytes).toString("base64");
    },
    async writeEncryptedBase64() { throw new Error("writeEncryptedBase64 not implemented (upload path unused)"); },
    async deleteFile(filename: string) { fileChunks.delete(filename); return true; },
    async exists(filename: string) { return fileChunks.has(filename); },
    async bulkExists(filenames: string[]) { return filenames.filter((f) => fileChunks.has(f)); },
    async getUploadedFileSize(filename: string) { return fileChunks.get(filename)?.length ?? 0; },
    async clearFileStorage() { fileChunks.clear(); },
    async hashBase64() { throw new Error("hashBase64 not implemented (upload path unused)"); },
  };

  // --- ICompressor: only used by backup/session-content paths, not sync ---
  const { gzipSync, gunzipSync } = require("node:zlib");
  const compressor = {
    async compress(data: string) { return gzipSync(Buffer.from(data, "utf8")).toString("base64"); },
    async decompress(data: string) { return gunzipSync(Buffer.from(data, "base64")).toString("utf8"); },
  };

  // Force the DB into the state dir (absolute dbPath), NOT core's relative `name`
  // — otherwise the SQLite file lands in the process CWD (this repo), a privacy-
  // boundary violation. core uses a single db, so ignoring `name` is safe.
  const sqliteOptions = {
    dialect: (_name: string) => new SqliteDialect({ database: new BetterSqlite3(`${dbPath}.sqlite`) as any }),
    journalMode: "WAL",
    synchronous: "normal",
  };

  return { storage, fs, compressor, sqliteOptions };
}
