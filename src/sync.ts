/**
 * Standalone sync CLI (`npm run sync`) — pulls the latest data into the local
 * cache using the persisted session. Handy for testing and for a cron refresh.
 * Fails clearly if the session hasn't been bootstrapped (run `npm run login`).
 */
import "./bootstrap.js";
import { loadConfig } from "./config.js";
import { NotesnookClient } from "./notesnook/client.js";

async function main() {
  const config = loadConfig();
  const client = new NotesnookClient(config);
  await client.init();
  await client.ensureAuthenticated(); // no TOTP — reuse session
  const { merged, lastSynced } = await client.sync();
  console.log(`itemsMerged=${merged}, lastSynced=${lastSynced}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("sync failed:", e?.message ?? e);
  process.exit(1);
});
