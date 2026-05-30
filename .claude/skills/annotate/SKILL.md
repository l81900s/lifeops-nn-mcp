---
name: annotate
description: Add or improve docstrings and module-level comments across the codebase so future LLM sessions and human contributors can read any file and immediately understand its role, assumptions, and non-obvious invariants
allowed-tools: Read, Edit, Bash, Glob
---

# /annotate — Annotate the codebase

> **TEMPLATE NOTICE:** Replace every `[BRACKETED_PLACEHOLDER]` with content specific to your project, then delete this notice. The "Project vocabulary" section at the bottom is the most important customization — filling it in is what makes `/annotate` produce *project-aware* docstrings rather than generic ones.

Adds or improves docstrings and module-level comments across `[PROJECT_PACKAGE_DIR]` (and any other source dirs you specify). The goal: any future LLM session — or a new human contributor — can read any file and immediately understand what role it plays in the overall architecture, what it does, what it assumes about state, and any non-obvious invariants.

## Arguments

- **No argument**: annotate the full default scope (`[PROJECT_PACKAGE_DIR]/` and any other top-level source directories).
- **File path argument** (e.g. `/annotate src/foo/bar.py`): annotate only that file.

## Annotation standards

Follow the style already established in this codebase — **plain prose, not Google/NumPy format**. Focus on WHY and what's non-obvious; don't restate what well-named identifiers already express.

### Module docstrings (every source file should have one)
- What architectural layer this file belongs to ([CUSTOMIZE: list your project's layers here, e.g., "Administrative Plane / Authoring Layer / Knowledge Layer / Output Layer" or "transport / domain / persistence" or whichever vocabulary you've adopted])
- What the file contains and why it exists
- Any critical invariants or assumptions (e.g. "engine is a singleton", "session must be flushed before FK references are read")
- For router / handler / controller files: list the endpoints and one-line descriptions

### Class docstrings (all data models, services, and non-trivial classes)
- What real-world concept the class represents
- Any nullable FK columns and what NULL means (e.g. `owner_user_id NULL = admin-owned global asset`)
- Any uniqueness constraints that enforce business rules
- Any invariants the class is responsible for enforcing

### Function / method docstrings (all public + non-trivial private)
- What the function does — *only if* the name alone doesn't make it obvious
- What it assumes about its inputs (session state, transaction state, calling thread, etc.)
- What it returns or raises, if non-obvious
- Skip one-liners that are completely self-evident from their name

### Inline comments
- Only where the WHY is non-obvious — a hidden constraint, subtle invariant, or workaround for a specific bug.
- Do NOT comment what the code does if well-named identifiers already explain it.

## What NOT to annotate

- `__init__.py` files that are just re-exports
- Placeholder / scaffold files for unused integrations (e.g., `llm/anthropic/` if you only use OpenAI today)
- Test fixtures with self-evident shape
- Generated code, vendored third-party code
- HTML, CSS, template files

## Process

1. If no argument given, list all source files in the default scope.
2. For each file (or the single specified file):
   a. Read the file
   b. Identify what's missing: module docstring, class docstrings, function docstrings
   c. Add them using Edit — **one Edit call per file**, not one per docstring
   d. Never remove or rewrite existing code — only add or improve docstrings
   e. Never change logic, imports, or formatting outside the docstrings
3. After all files are processed, report a summary: how many files touched, what kinds of docstrings were added.

## Project vocabulary

> **THIS IS THE CUSTOMIZATION THAT MATTERS MOST.** List the domain vocabulary that should appear in annotations so they're project-aware, not generic. Example bullets — replace with your own:

- **[Architecture term, e.g., "Administrative Plane"]** — what it covers (users, auth, billing, etc.)
- **[Architecture term, e.g., "Knowledge Layer"]** — what it covers (vector store, reference docs, etc.)
- **[Naming prefix, e.g., "rd_*"]** — what the prefix means and when to use it
- **[Acronym, e.g., "RAG"]** — expansion + what it does in this codebase
- **[Key column convention, e.g., "owner_user_id NULL"]** — what NULL means
- **[Phase / version marker, e.g., "Phase 3.10"]** — what's in scope as of this point in the project's history

Once filled in, `/annotate` produces docstrings that *use* these terms correctly, making the codebase self-explanatory to a fresh session.
