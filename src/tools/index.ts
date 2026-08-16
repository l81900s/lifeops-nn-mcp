/**
 * MCP tool registrations. Read-first surface for v0.1: sync + search/read notes,
 * list notebooks, and download/decrypt attachments (images returned inline).
 *
 * Destructive tools (delete/edit) are intentionally omitted until the read surface
 * is proven — see the security notes in .claude/CLAUDE.md. The `description` string
 * passed here is what Claude reads for tool discovery; keep it accurate.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotesnookClient } from "../notesnook/client.js";

const asJson = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function registerTools(server: McpServer, client: NotesnookClient): void {
  server.tool(
    "nn_sync",
    "Pull the latest notes and attachments from the Notesnook account into the local cache. Run this before reads if you need fresh data.",
    {},
    async () => {
      const r = await client.sync();
      return { content: [{ type: "text", text: `Synced. itemsMerged=${r.merged}, lastSynced=${r.lastSynced}` }] };
    }
  );

  server.tool(
    "nn_search_notes",
    "Search Notesnook notes by title and content. Returns matching notes' id, title, and headline.",
    { query: z.string().describe("Text to search for"), limit: z.number().int().positive().max(100).optional() },
    async ({ query, limit }) => asJson(await client.searchNotes(query, limit ?? 20))
  );

  server.tool(
    "nn_list_recent_notes",
    "List the most recently created Notesnook notes (id, title, headline).",
    { limit: z.number().int().positive().max(100).optional() },
    async ({ limit }) => asJson(await client.listRecentNotes(limit ?? 20))
  );

  server.tool(
    "nn_read_note",
    "Read one note by id: decrypted title, plain-text content, and the hashes of its attachments (use nn_read_attachment to fetch an image).",
    { id: z.string().describe("The note id") },
    async ({ id }) => {
      const note = await client.readNote(id);
      if (!note) return { content: [{ type: "text", text: `No note with id ${id}` }], isError: true };
      return asJson(note);
    }
  );

  server.tool(
    "nn_list_notebooks",
    "List all Notesnook notebooks (id + title).",
    {},
    async () => asJson(await client.listNotebooks())
  );

  server.tool(
    "nn_create_note",
    "Create a new Notesnook note and sync it up to the account (so it appears on the user's phone). Content is tiptap HTML — use standard tags (p, h1-h3, ul/ol/li, strong, em, a, blockquote, code). Optionally file it under a notebook by name (created if missing). Returns the created note. This WRITES to the user's live account — show the intended content and get confirmation before calling.",
    {
      title: z.string().describe("The note title"),
      contentHtml: z.string().optional().describe("Note body as tiptap HTML (standard tags). Omit for an empty note."),
      notebook: z.string().optional().describe("Notebook name to file the note under; created if it doesn't exist."),
    },
    async ({ title, contentHtml, notebook }) => asJson(await client.createNote({ title, contentHtml, notebook }))
  );

  server.tool(
    "nn_update_note",
    "Update an existing Notesnook note's title and/or content by id, then sync up to the account. Only provided fields change. Content is tiptap HTML (same tags as nn_create_note). Fails if the id is unknown. Returns the updated note. This WRITES to the user's live account — show the intended change and get confirmation before calling. IMPORTANT: contentHtml REPLACES the entire note body (not append/merge) — to edit a note, first call nn_read_note and pass back its full body with your edits applied, or you will wipe the rest of the note and orphan any embedded images.",
    {
      id: z.string().describe("The id of the note to update (from nn_read_note / search)"),
      title: z.string().optional().describe("New title (omit to leave unchanged)"),
      contentHtml: z.string().optional().describe("New body as tiptap HTML. REPLACES the whole body — include the existing content you want to keep. Omit to leave content unchanged."),
    },
    async ({ id, title, contentHtml }) => asJson(await client.updateNote({ id, title, contentHtml }))
  );

  server.tool(
    "nn_read_attachment",
    "Download and decrypt one attachment by its hash. Images are returned inline so you can view them; other types are returned as base64.",
    { hash: z.string().describe("The attachment hash (from nn_read_note)") },
    async ({ hash }) => {
      const att = await client.readAttachment(hash);
      if (!att) return { content: [{ type: "text", text: `No attachment ${hash}` }], isError: true };
      if (att.mimeType.startsWith("image/")) {
        return { content: [{ type: "image", data: att.base64, mimeType: att.mimeType }] };
      }
      return {
        content: [
          { type: "text", text: `${att.filename ?? hash} (${att.mimeType}, ${att.size} bytes), base64 below:` },
          { type: "text", text: att.base64 },
        ],
      };
    }
  );
}
