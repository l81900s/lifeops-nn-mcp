/**
 * MCP server entry point (stdio transport).
 *
 * Boots the headless Notesnook client, reuses the persisted session (no 2FA —
 * bootstrap once via `npm run login`), does a best-effort initial sync, then serves
 * the read tools. NOTE: on stdio, stdout is the protocol channel — all logging goes
 * to stderr.
 */
import "./bootstrap.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { NotesnookClient } from "./notesnook/client.js";
import { registerTools } from "./tools/index.js";

async function main() {
  const config = loadConfig();
  const client = new NotesnookClient(config);
  await client.init();
  await client.ensureAuthenticated(); // local (derive key), fast; throws if not bootstrapped

  const server = new McpServer({ name: "lifeops-nn-mcp", version: "0.1.0" });
  registerTools(server, client);
  // Connect FIRST so the MCP handshake is answered immediately. A blocking initial
  // sync here previously delayed the handshake ~20s on a slow link, and Claude Code
  // timed out the connection. Tools serve the local cache; the background sync below
  // refreshes it, and nn_sync forces a fresh pull on demand.
  await server.connect(new StdioServerTransport());
  console.error("[lifeops-nn-mcp] ready on stdio");

  client.sync()
    .then(({ merged }) => console.error(`[lifeops-nn-mcp] initial sync ok (itemsMerged=${merged})`))
    .catch((e: any) => console.error(`[lifeops-nn-mcp] initial sync failed (serving cache): ${e?.message ?? e}`));
}

main().catch((e) => {
  console.error("[lifeops-nn-mcp] fatal:", e?.message ?? e);
  process.exit(1);
});
