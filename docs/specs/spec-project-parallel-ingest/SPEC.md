---
id: SPEC-project-parallel-ingest
companions:
  - ../spec-project-docs-overlay/SPEC.md
  - ../spec-project-docs-overlay/graph-view.md
  - ../../project-context.md
  - ../../planning-artifacts/architecture/architecture-project-docs-overlay-2026-09-26/ARCHITECTURE-SPINE.md
---

# Project Mode — Parallel Ingest, Setup Handoff, Auto View

## Why

On a project with hundreds of docs, project mode stops short of a usable graph. Setup writes the config and ends, with no pointer to ingest. Ingest processes docs one by one in a single context, which is slow and fills the context window. The graph view exists only if the user knows to run `/lumi-project-view`, and goes stale after every ingest.

The engine already supports concurrent writers: each doc's facts live in their own file, `facts-write` holds `_lumina/_state/lock` and re-checks `sourceHash` under it, and the graph is rebuilt from docs + facts on every read with no stored graph file. Write order cannot change the graph. What is missing is orchestration in the skills.

## Capabilities

- **CAP-1 — Doc type in `status`**
  - **intent:** `status` reports each doc's project type and meta-type next to `path`, `hash`, `state`, so skills can group docs without guessing from paths.
  - **success:** `status` on a fixture with a typed and an untyped doc returns `type` for the typed one, omits it (or `null`) for the untyped one, and `metaType` for both (`Document` when untyped). Existing fields and `summary` are unchanged.
- **CAP-2 — Parallel ingest by default**
  - **intent:** When the candidate count exceeds 20 and the host can spawn subagents, `/lumi-project-ingest` acts as an orchestrator: it partitions candidates into clusters, dispatches one subagent per cluster, and merges their reports. At or below 20, or on a host with no subagent tool, it runs sequentially as today.
  - **success:** On Seli's `docs/` (234 files, first run), ingest dispatches clusters, every candidate is ingested by exactly one subagent, the final `status` shows every committed doc `fresh`, and the `build` output is byte-identical to a sequential ingest of the same fact files.
- **CAP-3 — Partition rule**
  - **intent:** The orchestrator partitions candidates itself, with no engine helper. Rule: sort candidates by (`type` ?? `metaType`, `path`); agents = min(8, ceil(N / 25)); split the sorted list into that many contiguous clusters of near-equal size. Sorting by path within a type keeps docs of the same folder together.
  - **success:** Every candidate is listed in exactly one cluster brief; the orchestrator states N, the cluster count, and per-cluster counts that sum to N before dispatch.
- **CAP-4 — Sweep for missed docs**
  - **intent:** After all subagents return, the orchestrator runs `status`. Candidates that are not `fresh` and were not reported as skipped or stopped by a subagent are re-dispatched once (sequentially when few, as one more cluster otherwise). Anything still missing after that sweep is reported, not retried again.
  - **success:** With one cluster brief deliberately missing a doc, the final report shows that doc ingested by the sweep; with a doc that fails twice, the report lists it as unprocessed after one sweep.
- **CAP-5 — One approval, isolated failures**
  - **intent:** The existing >20 gate is asked once by the orchestrator and shows the plan (candidate count, cluster count, docs per cluster by type). Subagents do not ask again. A subagent that hits a batch-stopping exit 3 (lock timeout, internal error) stops only its own cluster; other clusters continue.
  - **success:** With one subagent forced into lock timeout (`LUMINA_PROJECT_LOCK_TIMEOUT_MS` set low while the lock is held), the other clusters complete, and the final report lists the stopped cluster's unprocessed docs and how to re-run them.
- **CAP-6 — Setup hands off to ingest**
  - **intent:** When setup has written a config and its Definition of Done passes, it reports the in-scope doc count and offers to run ingest. A yes starts `/lumi-project-ingest` in first-run mode and counts as the >20 approval. Setup itself still never runs `facts-write`.
  - **success:** On a fresh Seli install, approving setup and then answering yes to the handoff ends with facts committed, without the user typing a second command. Answering no ends setup with the command to run later.
- **CAP-7 — Ingest regenerates the view**
  - **intent:** After the final `status`, ingest runs `project.mjs view` once and reports its `url`. A `view` failure is reported but does not change the ingest outcome.
  - **success:** After any ingest that committed at least one doc, `_lumina/graph/view.html` reflects the new facts and the report ends with its `file://` URL.

## Constraints

- The only engine change is CAP-1. `facts-write`, the lock, and the fact-file format stay as they are. A missed or duplicated doc in a partition is safe: a miss stays non-`fresh` and is caught by CAP-4; a duplicate wastes work and the last write wins with a valid fact set.
- Subagent brief carries everything already known: the cluster's paths with their `hash` from `status`, the note that the gate is approved, and the per-doc procedure and output line format from the existing skill. Subagents return per-doc outcome lines and uncaptured relations; the orchestrator writes the single report in the existing Output Format.
- Only the orchestrator runs the final `status`, the sweep, and `view`.
- Host-neutral wording: the skill says "if the host provides a subagent tool", never a product-specific tool name as the only path. Project-mode hosts are Claude Code, Codex, Antigravity.
- All repo policies in `project-context.md` hold (atomicWrite, safePath, cold start under 300 ms, exit codes, no emoji, en/vi/zh doc sync).
- AD-16 (one inlined viewer file) and AD-12 (no stored graph) are unchanged.

## Non-goals

- Splitting the viewer into a fixed HTML shell plus a data file.
- Regenerating the view after each `facts-write`.
- Clustering by citation locality or folder topology.
- Parallel ingest in classic wiki mode (`wiki.mjs` has no lock; out of scope).
- Changing the cluster size or agent cap per project through config.

## Success signal

- On Seli, a first-run ingest from setup handoff to open view needs one approval and no second command, finishes faster in wall-clock time than the sequential run, and produces the same `build` output.
- A stress test with 20 concurrent `facts-write` processes on distinct docs: all exit 0, and `build` matches the sequential result byte for byte.

## Assumptions

- Holding the lock for one read + hash + atomic write keeps contention negligible at 8 writers; the stress test confirms it.
- Cross-cluster scope-label synonyms (two subagents naming the same target scope differently) are rare and caught by `/lumi-project-verify`/`/lumi-project-check`, which the report already suggests running in a fresh context.
- `allowed-tools` stays `[Bash, Read]`: the installer copies it verbatim, Claude Code treats it as pre-approval rather than a restriction, and other hosts ignore it. The Seli run confirms the subagent tool is usable without a prompt.
