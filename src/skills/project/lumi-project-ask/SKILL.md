---
name: lumi-project-ask
description: >
  Answers a question about this project — decisions, requirements, rules,
  capabilities, processes, structures, concepts, actors, issues, evidence —
  from the typed doc graph, citing file:line for every claim. Use whenever
  the user asks such a question, including what supersedes, governs, depends
  on, satisfies, or contradicts what.
allowed-tools: [Bash, Read]
---

Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.

## Role

You answer project questions strictly from the graph the engine already
built. The graph holds status, relations, and locations — never a document's
content. State what the graph itself asserts (a node's status, an edge's
relation) with `file:line`; when the question needs the content itself, say
it is at `file:line` for the user to open. Never summarize or recall a doc's
content from its title, slug, or memory — the graph doesn't carry it, so
neither do you.

## Context

- `_lumina/project/PROJECT.md`: engine commands, meta-types, meta-relations,
  exit codes.
- `_lumina/config/project.yaml`: this project's own `types`/`relations`/
  `concepts`. Read it — the only doc-adjacent file this skill reads — to
  translate the user's words into the fixed meta-type/meta-relation list.
  Never hardcode a mapping (e.g. assume "ADR" always means `Decision`):
  another project may call decisions "KEP" or "Record"; check its own
  `types` entry.
- `## Engine facts` below: the exact `query` JSON shapes and ref rules —
  `PROJECT.md` names the three ops but not their fields.

## Engine facts

**1. Three ops, one engine call each** — `node _lumina/project/project.mjs query <op> ...`:
- `node <ref>` — the node plus every edge touching it. Prints
  `{schemaVersion, op:"node", node:{id, metaType?, status?, at:{file,line,quote}}, out:[{relation,to,evidence:[{file,line,quote}]}], in:[{relation,from,evidence:[...]}], freshness}`.
- `list --meta-type <T> [--status <S>]` — every node of that meta-type, `<S>`
  filtering to an exact status value when given. Prints
  `{schemaVersion, op:"list", items:[{id, metaType, status?, at}], freshness}`,
  sorted by `id`.
- `neighbors <ref> --direction in|out [--relation <R>]` — one hop from
  `<ref>`'s node; `out` walks edges where `<ref>` is the source, `in` walks
  edges pointing at it. Prints
  `{schemaVersion, op:"neighbors", items:[{relation, node:{id,metaType?,status?,at}, evidence:[{file,line,quote}]}], freshness}`,
  sorted by `(relation, node.id)`.

**2. `<ref>`** resolves a declared ID (frontmatter `id`, or a matching H1), a
repo-relative doc path, `path#anchor` for a fragment, a concept name/alias,
or a node id already seen in prior output (`doc:...`, `frag:...#...`,
`concept:...`, `id:...`) — pass an `items[].id`/`node.id` from an earlier
response straight back in, no need to strip its prefix.

**3. `--meta-type`/`--relation`/`--status`** must be the fixed PROJECT.md
names (11 PascalCase meta-types, 10 kebab-case meta-relations) — a
misspelled or unmapped one exits 1 with the valid list in the message, not a
silent empty result. `--status` matches the node's own status value
**exactly** — no synonym or prefix match. When unsure which values a
meta-type actually uses, run `list --meta-type <T>` with no `--status` first
and use only the values seen. A question about "superseded" things checks
both `superseded` and `partially-superseded` — the `Decision` lifecycle
(`proposed`/`accepted`/`partially-superseded`/`superseded`/`deprecated`)
treats a partial supersession as its own value, and a user asking about
"superseded" decisions usually means both.

**4. `at` vs. `evidence`** — a node's own `at` backs an existence/status
claim ("X is a Decision, status superseded, defined here"); an edge's
`evidence[]` backs a relation claim ("X supersedes Y, per this quote").
Neither ever holds a doc's prose beyond one quoted line. Cite whichever the
claim needs; never invent a location neither field returned, and never
substitute a summary of the doc's content for either.

**5. Node-id prefix labels the kind** — `doc:` a whole document, `frag:` a
fragment (a heading-addressable part of a document), `concept:` a concept,
`id:` an external ID or an ID cited with no single defining doc (e.g. a
duplicate declared ID). Label results by this prefix when you count or group
them — never call a `frag:`/`id:` result "a document".

**6. Empty is an answer; a run error is not.** `items: []` (from `list` or
`neighbors`) means no node/edge matches — say so. `query node`/`query
neighbors` exit 2 with exactly
`{"error":"no node resolves for ref: <ref>","code":2}` on stderr when
`<ref>` matches nothing — same meaning, read the graph as silent on that
ref. Every other exit 2 (no project root, invalid config, a path-safety or
scope-collision error) and every exit 3 (internal error, lock timeout,
newer `schemaVersion`) is **not** "no answer" — report the `error`/`code`
verbatim and stop; never reinterpret it and never retry around it. Exit 1
is a bad flag/op — fix the command, don't reinterpret the result either.

**7. A concept ref that exits 2 may still be configured.** A `concept:` node
only exists once something in scope mentions it — a concept declared in
`project.yaml`'s `concepts` with zero mentions resolves to no node, same
exit 2 as an unconfigured name. Check the config to tell "not configured"
from "configured, not yet mentioned" before answering either way.

**8. `freshness`** — every response carries
`{stale, changed, neverIngested, staleDocs:[...]}`: live, project-wide
counts, not scoped to the question. A doc counts as `stale` for any of
several reasons: a quoted sentence is gone, a fact's reference no longer
resolves, the project's config/ontology changed since that doc was
ingested, or its committed fact file is malformed. Report `staleDocs` by
path; give `changed`/`neverIngested` as counts. `governs`/`supersedes`/etc.
relations can come either from agent ingest or from a `project.yaml`
`relatedRules` entry typing a plain link at parse time — an empty result
never proves ingest is the missing piece.

## Instructions

1. **Read `_lumina/config/project.yaml`** for this project's own `types`,
   `relations`/`relatedRules`, and `concepts`. Translate the question's
   project-specific words to the fixed meta-type/meta-relation list through
   it — never assume a label ahead of reading the config (Engine facts §3
   also applies: for a "superseded" question, plan to check both status
   values).
2. **Pick the op(s)**:
   - A named, specific thing ("what does ADR-052 say", "what supersedes
     ADR-009") -> `query node <ref>`, or `query neighbors <ref> --direction
     in|out [--relation R]` when the question is about one relation.
   - "which/all X (in state S)" -> `query list --meta-type T [--status S]`.
   - A two-step question over a set ("which features are governed by a
     superseded decision") -> `list` first, then `neighbors` once per item
     from that list's `id`, filtered by the named relation (see Examples).
3. **Cap the fan-out.** Expanding a `list` result into one `neighbors` call
   per item is fine up to 20 calls. Past that, narrow the question (a
   tighter `--meta-type`/`--status` filter) or ask the user which subset to
   check, before running any of them.
4. **Run each engine call one step at a time** and read only its JSON —
   never a doc's contents, never a directory listing of the docs themselves.
5. **Handle every response** per Engine facts §6/§7: an empty result or a
   "no node resolves for ref" exit 2 means that part has no graph answer —
   say so and move on. Any other exit 2 or an exit 3 is a run error, not an
   answer — report it verbatim and stop.
6. **Compose the answer** from only what the graph returned: state each
   node's status and each relevant relation, cited `file:line` from
   `at`/`evidence` (Engine facts §4); when the question needs the doc's
   content itself, point to `file:line` for the user to open it rather than
   describing that content. Label every item by its node-id prefix (Engine
   facts §5).
7. **Close with the freshness caveat**, always: name every `staleDocs` path,
   and give `changed`/`neverIngested` as counts, drawn from the final query
   response's `freshness`. Whenever `neverIngested > 0`, add that
   agent-extracted relations (the kind ingest adds beyond frontmatter,
   links, and headings) may be incomplete or missing for those un-ingested
   docs.

## Output Format

```
**Answer:** <what the graph asserts — status/relations, each cited
file:line> <if the content itself was asked for> Read it at `<file>:<line>`.

**Evidence:**
- <claim> — `<file>:<line>` "<quote>"
- ...

**No graph answer:** <only for a part with no matching node/edge, or a "no
node resolves for ref" exit 2> The graph has nothing for <X>.

**Error:** <only when a query call exited 2 for another reason, or exited 3>
`<error>` (code <code>) — reported as-is; this is a run problem, not "no
answer".

**Freshness:** <N> stale doc(s): <path>, <path>. <M> changed and <K>
never-ingested doc(s) also exist project-wide. <when K > 0> Agent-extracted
relations may be incomplete for those un-ingested docs.
```

## Examples

<example>
CAP-10: "Which features are governed by a superseded decision?" Verified
against a read-only copy of Capigo with project mode installed but not yet
ingested (423 in-scope docs, 0 ingested).

Step 0 — translate the words via this project's own config,
`_lumina/config/project.yaml`: it maps `ADR: {metaType: Decision, ...}` and
`Feature: {metaType: Capability, ...}` — confirmed from the config, not
assumed from the words themselves.

Step 1 — every decision the user might call "superseded" (both lifecycle
values, per Engine facts §3):
```
node _lumina/project/project.mjs query list --meta-type Decision --status superseded
node _lumina/project/project.mjs query list --meta-type Decision --status partially-superseded
```
The first call returned 3 real items, all `doc:` (whole documents), e.g.
`{"id":"doc:docs/adr/adr-006-help-chat-webhook-auth-via-supabase-auth-api.md","metaType":"Decision","status":"superseded","at":{"file":"docs/adr/adr-006-help-chat-webhook-auth-via-supabase-auth-api.md","line":2,"quote":"id: ADR-006"}}`
(plus `adr-017-...` and `adr-032-...`); the second returned `items: []` — no
`partially-superseded` decision exists in this fixture. (A project with a
partial supersession, e.g. one ADR partially replacing an older one, would
surface it here instead of under plain `superseded`.)

Step 2 — per item (3 total, well under the fan-out cap), walk its `governs`
edges:
```
node _lumina/project/project.mjs query neighbors "doc:docs/adr/adr-006-help-chat-webhook-auth-via-supabase-auth-api.md" --direction out --relation governs
```
returned real `{"schemaVersion":1,"op":"neighbors","items":[],"freshness":{"stale":0,"changed":0,"neverIngested":423,"staleDocs":[]}}`
for all three — no `governs` edge exists for any of them yet. That can mean
either no agent has ingested these docs, or this project's `project.yaml`
has no `relatedRules` entry typing a `Decision -> Capability` link as
`governs` (either can produce the edge, per Engine facts §8) — say both are
possible, don't assume it's specifically ingest.

Answer: "The graph has no `governs` edge for any of the 3 currently
superseded decisions (`ADR-006`, `ADR-017`, `ADR-032`, all whole documents;
no `partially-superseded` decision exists) — no feature is recorded as
governed by any of them." Freshness: 0 stale, 0 changed, 423 never-ingested
— add that agent-extracted relations such as `governs` may simply be
missing for these un-ingested docs.

Once a `governs` edge exists, a populated `items[]` entry looks like
`{"relation":"governs","node":{"id":"doc:docs/features/help-chat.md","metaType":"Capability","status":"current","at":{"file":"docs/features/help-chat.md","line":1,"quote":"# Help Chat"}},"evidence":[{"file":"docs/adr/adr-006-....md","line":9,"quote":"this decision governs the help-chat capability"}]}`
— cite the capability's own `node.id`/`at` for "it's a Capability, defined
at `docs/features/help-chat.md:1`" and the `evidence` quote for "ADR-006
governs it, per `docs/adr/adr-006-....md:9`" — never summarize what
`docs/features/help-chat.md` itself says beyond that.
</example>

<example>
"What does ADR-006 say, and what's stale about it?"
```
node _lumina/project/project.mjs query node ADR-006
```
The graph holds only ADR-006's status, its own location, and its typed
relations (`out`/`in`) — never its prose. Answer: state `node.status` and
every `out`/`in` relation, each cited `file:line` from its `evidence`; then
say the decision's own text is at `node.at.file:node.at.line` for the user
to open — never paraphrase what the ADR says from its title or from memory.
Use the response's own `freshness` for the stale caveat, no second call
needed.
</example>

<example>
"What do we know about the credit limit concept?"
```
node _lumina/project/project.mjs query node "credit limit"
```
Exits 2: `{"error":"no node resolves for ref: credit limit","code":2}` —
the one exit-2 message that means "no graph answer" (Engine facts §6), but
it does not mean the concept is undefined (Engine facts §7). Check
`_lumina/config/project.yaml`'s `concepts` list: if `credit limit` isn't
there, say "not a configured concept in this project"; if it is there, say
"configured, but no in-scope doc mentions it yet". Never grep `docs/` to
answer either way.
</example>

## Guardrails

- Read-only. `Read` is used only for `_lumina/config/project.yaml` — never a
  doc's own contents. No writes anywhere, no git operations.
- Never run `facts-write`, `build`, `lint`, `verify-evidence`, `view`,
  `status`, `scope`, or `config-check` — `query` only, plus reading the
  config.
- Never state or imply a doc's content. The graph gives status, relations,
  and one-line locations only; point to `file:line` for the content itself.
- Never treat any exit 2 other than the exact "no node resolves for ref"
  message, or any exit 3, as "no answer" — report those verbatim instead
  (Engine facts §6).
- Never query with a project-specific type/relation name (e.g. "ADR",
  "superseded_by") — always translate through `project.yaml` first.
- Never expand a `list` result into more than 20 `neighbors` calls without
  narrowing the question or asking the user first.
- Never call a configured-but-unmentioned concept "undefined" — check the
  config before answering (Engine facts §7).

## Definition of Done

- Every claim in the answer traces to an `at` or `evidence` value the
  engine actually printed this run — none from a doc's content, title,
  slug, or memory.
- A question about a doc's content is answered by pointing to `file:line`,
  never by summarizing.
- Every part of the question with no matching node/edge is named as such;
  every exit 2 other than "no node resolves for ref", and every exit 3, is
  reported verbatim as an error, not silently reinterpreted as "no answer".
- Every reported item is labeled by its correct node-id prefix (document,
  fragment, concept, external ID).
- The freshness caveat names every `staleDocs` path, states the
  `changed`/`neverIngested` counts, and — when `neverIngested > 0` — notes
  that agent-extracted relations may be incomplete for those docs.
- No file changed: this skill only ever runs `query` and reads
  `_lumina/config/project.yaml`.
