---
name: lumi-ingest
description: >
  Turn a raw source file into structured wiki pages: source page, concept and
  person stubs, wiki.mjs-managed graph edges, citation edges, and a log entry.
  Pauses at four checkpoints (draft, lint, verify, finalize) so you can review
  before the work is committed to the wiki — accept, revise, or quit at any
  checkpoint without losing progress. Resumable across sessions.
  Use this whenever the user says "ingest", "add", "file", "process", "summarize
  into the wiki", "create a wiki page for", or drops a filename from raw/sources/.
  Also fires for: "I added a PDF to raw/sources/", "add this paper to the wiki",
  "parse this article", "what should I do with raw/sources/X?", or any request
  to bring a new source into the wiki graph.
  Also accepts Mode B input — paper title, arxiv ID, or URL, without a local
  file path. Examples: "ingest paper 2604.03501v2", "ingest arxiv:2604.03501",
  "ingest https://arxiv.org/abs/2604.03501". The skill fetches the PDF
  automatically in that case.
  This is the most-used skill — when in doubt about whether something is an
  ingest vs an edit, ask the user.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Agent
---

# /lumi-ingest

You are the wiki's primary knowledge compiler. Read `README.md` at the project root before doing anything else — bidirectional-link discipline drives the whole workflow.

The work is split across four stage files under `references/`. Each stage ends with a human-in-the-loop gate so the user can review before changes commit. Gate state is durable on the source entry's frontmatter (`ingest_status`) so the workflow survives session restarts; fine-grained phase resume lives in `_lumina/_state/ingest-<file-basename>.json` and is handled inside step-01.

| Stage | Step file | Reads |
|---|---|---|
| 1. Draft | `references/step-01-draft.md` | Resolve input → detect type → write source page + stubs + edges + citations + index |
| 2. Lint | `references/step-02-lint.md` | `lint.mjs --fix --json`; surface residual errors |
| 3. Verify | `references/step-03-verify.md` | Invoke `/lumi-verify` grounding-only; user reviews findings |
| 4. Finalize | `references/step-04-finalize.md` | Append log entry, mark `ingest_status: finalized` |

Stage-1 also relies on `references/pdf-preprocessing.md` (PDFs / large sources) and `references/dedup-policy.md` (before creating or updating any source / concept / person / edge).

## Resume routing

This is the only logic in this body — everything else lives in step files. The router stays cheap to load whether the user is starting fresh or resuming on the last gate.

1. **No slug yet, or slug given but no entry on disk.** → Read fully and follow `./references/step-01-draft.md`.

2. **Slug given, entry exists.** Read its `ingest_status`:

   ```bash
   node _lumina/scripts/wiki.mjs read-meta sources/<slug>
   ```

   | `ingest_status` | Next |
   |---|---|
   | absent (legacy v0.8 entry) | Tell the user this entry predates the four-checkpoint workflow and ask: `[A] Run lint+verify only (skip draft, the page already exists)` \| `[Q] Quit`. On `[A]`: write `ingest_status: drafted` to mark the entry as adopted, then → `./references/step-02-lint.md`. On `[Q]`: exit cleanly. |
   | `drafted` | → `./references/step-02-lint.md` |
   | `linted` | → `./references/step-03-verify.md` |
   | `verified` | → `./references/step-04-finalize.md` |
   | `finalized` | HALT, ask "this entry is already finalized; restart from scratch?" On `[Q]` (decline): exit cleanly, exit 0 — declining is not an error. On confirm, do these in order before re-entering step-01: (1) `set-meta sources/<slug> ingest_status drafted` (so a session crash mid-restart leaves the entry in a coherent stage, not a stale-finalized one), (2) delete the phase checkpoint at `_lumina/_state/ingest-<file-basename>.json`, (3) → `./references/step-01-draft.md`. |

## Examples

<example>
"/lumi-ingest raw/sources/attention-revisited-2026.pdf" — fresh ingest, all four gates accepted: drafted → linted → verified (passed) → finalized. One log entry, lint 0, verify_status: passed.
</example>

<example>
"/lumi-ingest attention-revisited-2026" in a new session after quitting yesterday at the verify gate. SKILL.md reads `ingest_status: linted`, jumps to step-03 without re-running draft or lint. Verify gate presents findings; user accepts; finalize runs.
</example>

<example>
"/lumi-ingest raw/sources/old-paper.pdf" — entry already `finalized`. HALT and confirm restart. Decline → no-op. Confirm → checkpoint deleted, step-01 from top.
</example>

## Next step

After step-04 completes, suggest `/lumi-check` (structural review) or `/lumi-verify --external <slug>` (adversarial open-web check) in a fresh session or sub-agent. Blank context catches bias from the reasoning chain that just built these pages.
