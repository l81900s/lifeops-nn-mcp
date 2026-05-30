---
name: smart-compact
description: Snapshot current session state to JSON, hand off to /compact, then read the snapshot back to seamlessly resume work after compaction
argument-hint: "[optional one-line label, e.g. 'pre-phase-4-handoff']"
user-invocable: true
---

# /smart-compact — Handoff-aware context compaction

Wraps the manual "write a JSON context summary, then `/compact`, then resume" workflow into a slash command. Operates in two modes — **write** (default; before compaction) and **read** (after compaction, when invoked with a snapshot path).

## When to use

- Conversation is getting long; cache TTL pressure is real, or you want a clean checkpoint before the next phase of work
- A phase just shipped and you want a tidy handoff before tackling something new
- You're switching contexts (e.g. "stop coding, start on MCP server setup")

## When NOT to use

- A regular `/compact` is fine for mid-task tidy-ups where you don't need to preserve specific state across the boundary
- The session is already short

## Modes

### Write mode (default)

Triggered when you invoke `/smart-compact` with no arguments (or with an optional label like `/smart-compact pre-mcp-setup`).

**What Claude does:**

1. Reviews the current session for: primary goal, current state, key decisions, important facts, open questions, next steps, files modified (since last push), external-state changes (deploys, DB writes, etc.)
2. Writes the snapshot to `.claude/context-summaries/<slug>.json` where `<slug>` is either the label you provided or an auto-generated `YYYY-MM-DD-HHMM` timestamp.
3. Prints two commands for you to copy-paste:
   - The `/compact` invocation with a hint that includes the snapshot path
   - The first message to send *after* compaction completes (which re-enters this skill in read mode)
4. **Stops.** Does not attempt to run `/compact` itself — slash commands aren't tool-invokable.

The snapshot format (below) is designed so that the read-mode replay gives the post-compact Claude a complete, structured rehydration of what was happening before.

### Read mode (post-compact)

Triggered when you invoke `/smart-compact read <path>` (or, in practice, when you paste the resume prompt that write mode produced).

**What Claude does:**

1. Reads the snapshot JSON at the provided path.
2. Reads any file mentioned in `files_modified` that's still relevant to the next steps (uses Read tool).
3. Acknowledges the resumed state in one tight paragraph: primary goal, what was just done, what's next.
4. Begins the next step from `next_steps[0]` (unless you redirect).

## Snapshot format

`.claude/context-summaries/<slug>.json`:

```json
{
  "session_label": "human-readable identifier",
  "saved_at": "ISO8601 timestamp with Z suffix",
  "primary_goal": "What the user is trying to accomplish next, in 1-2 sentences",
  "current_state": "What's true right now: branch, latest commit, deploy state, any in-progress work",
  "key_decisions": [
    {
      "decision": "...",
      "rationale": "Why this and not alternatives",
      "alternatives_considered": ["..."]
    }
  ],
  "important_facts": [
    "Specific facts that are load-bearing and won't be obvious from the code (resource IDs, IP addresses, the current test entity's IDs, SSM parameter names, etc.)"
  ],
  "open_questions": [
    "Genuine unresolveds that block or shape the next step"
  ],
  "next_steps": [
    {
      "step": "Concrete next action",
      "blocking_on": "What needs to happen first (or 'nothing' if ready)"
    }
  ],
  "files_modified": [
    "Files touched since the last clean state. Empty if working tree is clean."
  ],
  "external_state_changes": [
    "Deploys, DB writes, AWS resource changes, SSM parameter additions, anything that exists outside this repo's filesystem"
  ]
}
```

Fields are required but can be empty arrays / empty strings if genuinely n/a. The format is intentionally close to a meeting handoff — terse enough to read in 30 seconds, complete enough to resume work.

## Workflow

### From the user's POV

```
You:    /smart-compact pre-mcp-setup
Claude: [writes .claude/context-summaries/pre-mcp-setup.json]
        ✓ Snapshot saved.
        Now run:
          /compact resuming work; will read snapshot at .claude/context-summaries/pre-mcp-setup.json
        After compact completes, send this exact message to resume:
          /smart-compact read .claude/context-summaries/pre-mcp-setup.json

You:    /compact resuming work; will read snapshot at .claude/context-summaries/pre-mcp-setup.json
[…compaction happens…]

You:    /smart-compact read .claude/context-summaries/pre-mcp-setup.json
Claude: [reads snapshot, briefs back in one paragraph, proceeds with next_steps[0]]
```

### Slug rules

- If you pass a label, it's slugified to lowercase + hyphens for the filename (`pre-mcp-setup` → `pre-mcp-setup.json`).
- If no label, the slug is `YYYY-MM-DD-HHMM` based on current local time.
- Existing snapshots are NOT overwritten silently — if `<slug>.json` already exists, Claude asks before overwriting.

## What goes in `important_facts` vs `current_state`

- **`current_state`** = the one-paragraph "where we are right now" view: branch, latest commit SHA, deploy state, working-tree cleanliness, what was just shipped.
- **`important_facts`** = the assorted load-bearing details that aren't obvious from reading the code: specific resource IDs, SSM parameter names, the current test entity's records, who owns what across third-party systems. The kind of stuff that takes 10 grep-and-curl operations to rediscover if lost.

When in doubt, put it in `important_facts`. It's cheap to include; expensive to omit.

## Don't put in the snapshot

- Code patterns / architecture / file paths → derivable from the current repo state, no need to capture
- Recent git history → `git log` exists
- Debug recipes / fix instructions → the fix is in the code
- Routine task tracking → that's the live task list, not handoff material

## Recovery procedures

### Snapshot file got deleted before resume

If the snapshot is gone, just describe where you left off in plain English. Claude will re-orient from `git log`, the working tree, and your description. Less smooth, but functional.

### Resume prompt didn't trigger this skill

If the post-compact Claude doesn't auto-invoke read mode, you can:
1. Paste the snapshot path explicitly: `Read .claude/context-summaries/<slug>.json and continue.`
2. Or invoke explicitly: `/smart-compact read .claude/context-summaries/<slug>.json`

### Two snapshots from the same session

If you invoke `/smart-compact` twice in one session (e.g. after additional work), the second invocation will offer to overwrite the existing snapshot or save with a new slug. Both are fine — there's no harm in stale snapshots, and `.claude/context-summaries/` should be gitignored (it is, by default, in payload's `gitignore.additions`).

## Constraints + caveats

- **`/compact` is a user action, not a tool call.** Claude cannot trigger compaction directly. The skill's job is to make the boundary as smooth as possible: snapshot + prompt + read-back.
- **Snapshots live in `.claude/context-summaries/`** — don't track them in git. They capture mid-build state that's noisy in history. The bootstrap's `gitignore.additions` already covers this.
- **Read mode validates the snapshot path** before trusting it (must exist, must be JSON, must have the documented top-level fields). If validation fails, Claude reports the error and asks how to proceed.
