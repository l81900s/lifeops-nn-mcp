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
  await client.ensureAuthenticated(); // throws with guidance if not bootstrapped

  try {
    const { merged } = await client.sync();
    console.error(`[lifeops-nn-mcp] initial sync ok (itemsMerged=${merged})`);
  } catch (e: any) {
    console.error(`[lifeops-nn-mcp] initial sync failed (continuing with cache): ${e?.message ?? e}`);
  }

  const server = new McpServer({ name: "lifeops-nn-mcp", version: "0.1.0" });
  registerTools(server, client);
  await server.connect(new StdioServerTransport());
  console.error("[lifeops-nn-mcp] ready on stdio");
}

main().catch((e) => {
  console.error("[lifeops-nn-mcp] fatal:", e?.message ?? e);
  process.exit(1);
});
