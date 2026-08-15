/**
 * One-time interactive login/bootstrap CLI (`npm run login`).
 *
 * Notesnook requires 2FA on a fresh login but not on session reuse, so this is the
 * single interactive step: it prompts for the current TOTP, completes the 3-step
 * login, persists the session into the state dir, and does an initial sync. After
 * this, the MCP server runs non-interactively.
 */
import "./bootstrap.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { NotesnookClient } from "./notesnook/client.js";

async function main() {
  const config = loadConfig();
  const client = new NotesnookClient(config);
  await client.init();

  const alreadyAuthed = await client.isAuthenticated();
  const rl = readline.createInterface({ input, output });
  let prompts = 0;
  const totpProvider = async () => {
    const label =
      prompts++ === 0
        ? "Enter your current 6-digit Notesnook authenticator code: "
        : "Not accepted yet — enter a fresh 6-digit code: ";
    return (await rl.question(label)).trim();
  };

  if (alreadyAuthed) {
    console.log(`Already logged in as ${config.email}. Reusing the persisted session (no 2FA needed).`);
  } else {
    console.log(`Logging in as ${config.email} …`);
  }

  // Derives the encryption key on reuse; runs full 3-step login (with TOTP) otherwise.
  await client.ensureAuthenticated(totpProvider);
  rl.close();

  if (!alreadyAuthed) console.log(`Login OK. Session persisted to ${config.stateDir}`);

  console.log("Syncing …");
  const { merged, lastSynced } = await client.sync();
  console.log(`Done. itemsMerged=${merged}, lastSynced=${lastSynced}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("login failed:", e?.message ?? e);
  process.exit(1);
});
