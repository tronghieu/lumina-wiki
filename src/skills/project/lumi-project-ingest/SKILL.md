---
name: lumi-project-ingest
description: >
  Extracts relations and fragment status from project doc prose and commits
  them per doc, changed/stale only by default. Use when the user asks to
  ingest, update, or re-ingest project docs after adding or editing them.
allowed-tools: [Bash, Read]
---

Read `_lumina/project/PROJECT.md` at the project root before this SKILL.md.

## Role

You are project mode's fact extractor. The deterministic parse already
covers frontmatter, links, ID mentions, heading-based status, and concept
mentions — you add only what prose says that the parse cannot see:
meta-relation edges (`supersedes`, `satisfies`, `governs`, `depends-on`,
`part-of`, `contradicts`, `justified-by`, `owned-by`) and fragment-level
status. Every fact you write carries a verbatim quote from the doc you are
reading, and you commit it through `facts-write` — you never touch a doc's
own bytes.

## Context

- `_lumina/project/PROJECT.md` — engine commands, meta-ontology, exit codes.
- `## Engine facts` below — behaviour this skill depends on that
  `PROJECT.md` does not spell out; get these wrong and a fact that looks
  right silently commits the wrong thing.
- `_lumina/config/project.yaml` — read-only; its `concepts:` list is the
  concept vocabulary you may cite.
- You never read or write `_lumina/facts/`, `_lumina/graph/`, or
  `_lumina/_state/` directly — only through `project.mjs` subcommands.

## Engine facts

**1. Update mode is the default.** `status` prints `{docs:[{path, hash,
state}], summary}` for every in-scope doc. By default, candidates are only
docs whose `state` is `changed` or `stale` — `never-ingested` docs are
*not* auto-selected, and `fresh` never is. Include `never-ingested` docs
too only when one of:
- the user explicitly asked for them (e.g. "ingest all", "ingest
  everything", or named specific paths/folders — a named path is always a
  candidate regardless of its state);
- this is the first run: `summary` shows zero docs `fresh`, `changed`, and
  `stale` combined (nothing has ever been ingested), so every doc is
  `never-ingested` and all are offered.

`status`'s own JSON is small (state per doc) — read it directly, no
filtering needed. Before starting a batch of more than 20 candidate docs
(whatever the selection rule produced), show the count and get the user's
approval first. A user-named path that does not appear in `status`'s own
doc list at all is out of scope — report it and skip it; don't attempt to
write it. A `never-ingested` doc whose content matches a gone doc's facts
is a rename candidate — `lumi-project-verify` surfaces it as P15, not this
skill, but if the user already knows a doc was renamed, name its new path
explicitly rather than waiting on update mode or the next full run.

**2. `facts-write`'s stdin contract.** It needs piped or redirected JSON,
never a TTY, and rejects anything else with exit 1: `{source, sourceHash,
facts: []}`. A quoted heredoc needs no file and no shell-escaping, even
though evidence quotes routinely contain quotes, brackets, and newlines:
```bash
node _lumina/project/project.mjs facts-write <<'JSON'
{ "source": "...", "sourceHash": "...", "facts": [ ... ] }
JSON
```
`sourceHash` is exactly the `hash` string `status` reported for that doc.

**3. One fact's shape** (each entry in `facts`). An edge:
```json
{
  "kind": "edge",
  "subject": "doc:docs/adr/0052-seli-owns-purchasing-supplier-ap-and-the-cost-book.md",
  "relation": "supersedes",
  "object": "ADR-0009",
  "scope": "AP clause and supplier-payment seam",
  "evidence": { "quote": "Partially supersedes [ADR-0009](0009-accounts-receivable-owned-by-seli.md): its\nAP clause and its supplier-payment seam are replaced, its AR decision stands." },
  "provenance": "extracted"
}
```
An attr, fragment status only:
```json
{
  "kind": "attr",
  "subject": "frag:docs/adr/0052-seli-owns-purchasing-supplier-ap-and-the-cost-book.md#3-the-cost-book-superseded-by-adr-0053",
  "relation": "status",
  "value": "superseded",
  "evidence": { "quote": "### 3. The cost book (superseded by ADR-0053)" },
  "provenance": "extracted"
}
```
- `subject` must be `doc:<this source>` or `frag:<this source>#<anchor>` —
  only ever a node in **this** doc, the one whose hash you are sending. A
  claim that reads the other way round (this doc is the one being
  superseded, governed, or depended on) is written from the *other* doc's
  own ingest pass, in the canonical direction — see fact 6 for the one
  exception (a project-specific inverse mapping).
- For a `frag:` **subject**, the anchor may be the heading's exact rendered
  text, unslugged — `facts-write` re-slugs it once and corrects it in the
  committed file, as long as the slugged form matches a real heading in this
  doc. An anchor matching no heading either way fails the whole call (fact
  7).
- `relation` for an attr fact must be exactly `"status"` — that is the only
  relation `buildGraph` treats as a status assignment; anything else on an
  `attr` fact is stored but never applied. `value` is the fragment's status
  word, by convention lowercase and, for a `Decision`-typed doc, one of its
  lifecycle words: `proposed`, `accepted`, `partially-superseded`,
  `superseded`, `deprecated` (the engine does not enforce this vocabulary on
  a fragment the way it does on a doc's own parsed status — get it right by
  convention).
- `object` (edge only) is written the same way you'd cite it in prose: a
  declared ID (`ADR-0009`), a bare path, `path#anchor`, or (fact 11) a
  concept's name unprefixed. The engine resolves and canonicalizes it (e.g.
  `ADR-0009` becomes `doc:docs/adr/0009-....md` in the committed file);
  `ref` is optional and defaults to `object` (edge) / `subject` (attr) — the
  ID/path/name text as written is enough. A `path#anchor` object whose
  anchor an **in-scope** target doc lacks is rejected outright (exit 1,
  `errors[]`) — never guess one; only cite a target fragment whose id you
  already confirmed exists (fact 4). An anchor on an **out-of-scope** target
  is never checked at all (that doc is never parsed) and always resolves to
  the whole document silently, anchor or not — so for a target outside
  project-mode scope, omit the anchor and cite the bare path.
- `value` (attr only) sets a fragment's own status string. An attr fact may
  set `status` only on a `frag:` subject. One on a `doc:` subject is written
  without error but fires lint P18 (document status always comes from the
  doc's own configured status source, unaffected) — never do this.
- Only `evidence.quote` matters on the way in; any `line` you send is
  ignored and recomputed from the quote's actual position in the current
  doc text. The quote must appear in the doc verbatim — the file's own
  wording, links in their raw markdown form, no `...` elision of any kind
  (NFC + whitespace collapsed, so a quote spanning a line-wrap is fine and
  does not need to be one physical line, but it must still be complete).
- `scope` is a short label, a non-empty string or omitted — never `null` or
  `""` (fact 4 for how to choose it).

**4. Gathering what already exists, without reading the whole graph.**
`query node <ref>` (declared ID or path) returns `{node, out, in}` — each
edge's `evidence[]` is trimmed to `{file, line, quote}` (no `scope`, no
`provenance`, and no marker for whether the edge came from the parse or
from a fact you or an earlier ingest already committed — see fact 9). `build`
prints the whole graph (roughly 1 MB on a real repo) — never read that
output as text. Run it once per batch (not once per doc), pipe it straight
into one filter covering every target path the batch might cite, and read
only the small result:
```bash
set -o pipefail
node _lumina/project/project.mjs build | node -e '
const targets = process.argv.slice(1);
let data = "";
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  let g;
  try { g = JSON.parse(data); } catch (e) { console.error("build: bad JSON:", e.message); process.exit(1); }
  const out = {};
  for (const path of targets) {
    const id = `doc:${path}`;
    out[path] = {
      frags: g.nodes.filter(n => n.kind === "frag" && n.id.startsWith(`frag:${path}#`)).map(n => n.id),
      scopes: [...new Set(
        g.edges.filter(e => [e.to, e.from].includes(id) || e.to.startsWith(`frag:${path}#`) || e.from.startsWith(`frag:${path}#`))
          .flatMap(e => e.evidence ?? []).filter(e => e.scope).map(e => e.scope)
      )],
    };
  }
  console.log(JSON.stringify(out));
});
' "docs/adr/0009-....md" "docs/adr/0052-....md"
```
(`set -o pipefail` makes a `build` failure fail the whole pipeline instead
of silently feeding empty/error text to the filter; the filter's own
try/catch is the second check named in the same rule.) This gives you, per
target: `frags` — fragment ids already known to the graph (from some
existing link or committed attr fact), the only anchors on another doc you
may use as a fragment object; `scopes` — every `scope` label already used
against that target, for fact 5.

**5. Partial supersession, the two supported shapes.** A `supersedes` fact
with a `doc:` object and no `scope` means "replaces the whole target" —
every citer of that doc gets flagged by lint. To mark a *partial*
replacement, do one of: target the whole `doc:` object and add a `scope`
label (safe — matched by exact string, no anchor risk); or target a `frag:`
object whose id you already confirmed exists via fact 4. A finer span than
any heading — a status-table row, for instance — has no anchor of its own
at all, so it can only go through `scope`, never a fabricated `frag:`.
Choosing the label: if fact 4's filter already shows a `scope` on an edge
to the same target, copy it verbatim — never invent a synonym for a label
that already exists. Otherwise write a short new one in the source doc's
own words, lifted from the quote itself (not from the target doc's text).

**6. Relation names.** `relation` must be spelled exactly as one of the 8
meta-relation names above — `facts-write` does not check this. A
misspelling (`supercedes`, `governed-by`) is accepted without error and
silently types as `references` once built, with no warning anywhere. A
project's config may map an additional relation key (including one that
reads the other way round, e.g. a `superseded_by` key mapped with
`inverse: true`) — that mapping applies to your facts exactly as it does to
parsed frontmatter, so if the project declares one, using that key from the
*older* doc's own subject is correct and produces the same edge the
*newer* doc's canonical-direction fact would. Absent such a mapping, a claim
stated only from the other side (the old doc says "superseded by X", the
new doc says nothing) cannot be captured from this doc at all — note it in
the report as uncaptured rather than inventing a relation name, and rely on
the other doc's own ingest pass if and when it runs.

**7. `facts-write` errors, and what each means:**
- Exit 1, `{error, code:1, errors:[{index, message}]}` — **all-or-nothing**:
  every fact in that call was rejected, not just the ones named. Fix or drop
  the named indices and resend the whole array once more.
- Exit 1 with a message about `sourceHash` not matching — the doc changed
  since you read it. Re-run `status` for the new hash, re-check the quotes
  still exist in the new text, and resend; this uses up the one retry the
  same as any other exit 1.
- A second exit 1 for the same doc, or exit 2 (bad/unsafe/out-of-scope
  source path): skip that doc, note why in the report, and continue with
  the rest of the batch.
- Exit 3 (lock timeout, internal error): stop the whole batch and report —
  this is not doc-specific.

**8. Nothing to add is still a write.** A doc whose prose adds nothing
beyond the parse gets `facts: []` — `status` then reports it `fresh`, same
as a doc with real facts. Skipping the call entirely leaves it
`never-ingested` forever.

**9. Replace-all, every run — re-derive, never skip.** One `facts-write`
call replaces a doc's *entire* committed fact set; there is no add/patch
mode. This means every run must re-derive every meta-relation and
fragment-status fact the doc's prose *currently* states, including ones a
previous ingest already committed — never skip re-deriving one just because
`query node` already shows an edge for it (fact 4: that view can't tell you
whether the edge came from the parse or from your own earlier fact, and if
it was the latter, leaving it out of this call deletes it). This re-derive-
the-whole-set rule applies only to a doc actually selected this run (fact
1) — a `fresh` doc outside the batch gets no `facts-write` call at all, so
its existing committed facts are untouched; re-deriving in full is never
something you do to an unchanged doc, only to each changed/stale (or
explicitly-requested) doc you are processing. The only facts you skip on
principle, every run, are the parse-only kinds: links, bare ID
mentions, frontmatter-key relations, concept mentions, and heading-based
status — never write a fact duplicating one of those, regardless of what
`query node` shows.

**10. Report the engine's own count.** A `facts-write` success reports
`facts: <N>` — the number of *distinct* `(kind, relation, subject,
object/value, scope)` combinations actually committed; two facts that
differ only in wording or evidence collapse into one, silently, with the
first one's evidence kept. Report this number, not the count of fact
objects you sent.

**11. Dangling objects never resolve themselves.** An edge fact whose
`object` cannot be resolved at all (no declared-ID/path/concept match) is
still accepted — it becomes a dangling reference, and a doc with one stays
`stale` forever (checked every run, hash or no hash), meaning it is
re-selected on every future ingest until the fact is fixed or dropped.
Before writing an edge fact whose object is unprefixed, confirm it resolves
first: `query node <object>` must exit 0. Write a concept object as the
concept's bare name from `project.yaml` (unprefixed) — the engine matches
it against the configured names and aliases the same way it matches a path
or declared ID; you do not compute or write a `concept:` id yourself.

## Instructions

1. **Select docs.**
   ```bash
   node _lumina/project/project.mjs status
   ```
   Candidates: every doc whose `state` is `changed` or `stale` (update
   mode, the default). Add `never-ingested` docs only if the user asked for
   them explicitly or this is the first run (fact 1); named paths absent
   from `status`'s own list are reported and skipped, never attempted. If
   the candidate count exceeds 20, show it and wait for approval before
   continuing.

2. **Gather what exists** (Engine facts §4):
   - Once per batch: run the `build`-piped filter above, passing every
     target path the batch might cite, to learn known fragment ids and
     already-used scope labels for those targets.
   - Read the `concepts:` list from `_lumina/config/project.yaml` for
     concept names/aliases you may cite unprefixed.

3. **Per doc, extract and check.**
   - Read the doc's full text.
   - `node _lumina/project/project.mjs query node <declared-id-or-path>` for
     the doc's current in/out edges — context only, per fact 9; never use
     its presence to decide what to skip.
   - Re-derive, every run, one fact per meta-relation the prose currently
     states about *this* doc (subject `doc:<this source>` or
     `frag:<this source>#<anchor>`), quoting the exact sentence,
     `provenance: "extracted"` when the quote states it outright,
     `"inferred"` when you are reading between two statements; and one attr
     fact per fragment whose status the prose states (not already covered
     by the doc's configured status source). Never write a fact duplicating
     a link, bare ID mention, frontmatter-key relation, concept mention, or
     heading status (fact 9).
   - For each fact's `relation`, use one of the 8 canonical names exactly,
     or a project-mapped key (fact 6); note any relation statable only from
     the other side as uncaptured instead of guessing a name.
   - For each edge fact's unprefixed `object`, confirm it resolves first:
     `query node <object>` must exit 0 (fact 11). Drop or fix any that
     doesn't before moving on.

4. **Write.** One `facts-write` call per doc (Engine facts §2, §7, §8, §9,
   §10): the full current fact set for that doc, piped via a heredoc,
   `sourceHash` the hash `status` reported. On an all-or-nothing rejection,
   fix or drop the named facts and resend the whole array once. On a second
   rejection or exit 2, skip this doc and continue the batch; on exit 3,
   stop the whole batch.

5. **Finish.** Re-run `status`; report its `summary` counts. Whenever the
   `never-ingested` count is non-zero — update mode's own exclusion, a
   first run or "ingest all" where the user declined the >20 gate, or any
   other reason some stayed unprocessed — state that count and how to
   include them (`lumi-project-ingest` "ingest all", "ingest everything",
   or naming their paths/folders). Suggest running lumi-project-check or
   lumi-project-verify in a fresh session or subagent — this context's own
   reasoning just built these facts and is biased toward seeing them as
   correct.

## Output Format

```
Mode: update (changed/stale only) | all (never-ingested included: <why>)
Candidates: <N> docs (changed: Y, stale: Z[, never-ingested: X])
[if N > 20: "N exceeds 20 — proceed? [yes/no]"]

docs/adr/0052-....md — 2 facts written (supersedes ADR-0009 scope "...";
  frag status superseded)
docs/adr/0009-....md — 0 facts (nothing beyond the parse)
docs/adr/xyz.md — skipped: <engine's error message>
...

status after: fresh <N>, changed <N>, stale <N>, never-ingested <N>
Never-ingested remaining, not processed: <N> — run with "ingest all" or
  name their paths/folders to include them.
Uncaptured (stated only from the other side, no config mapping): <list, or none>
Suggest: run lumi-project-check or lumi-project-verify in a fresh session
or subagent.
```

For a skipped or stopped doc, show the engine's `errors[]` or error message
instead of a fact count, and say whether it was retried before being
skipped.

## Examples

<example>
Seli, `docs/adr/0052-seli-owns-purchasing-supplier-ap-and-the-cost-book.md`
and `docs/adr/0009-accounts-receivable-owned-by-seli.md` named by the user.
`status` shows both `never-ingested`. Reading 0052 finds: "Partially
supersedes [ADR-0009](0009-accounts-receivable-owned-by-seli.md): its
AP clause and its supplier-payment seam are replaced, its AR decision
stands." — a meta-relation the parse cannot see (it only saw a plain
`references` link to 0009) — and its own heading "### 3. The cost book
(superseded by ADR-0053)". `query node ADR-0009` exits 0, so the object is
safe. Two facts committed for 0052: the `supersedes` edge (object
`ADR-0009`, scope `"AP clause and supplier-payment seam"`, lifted from the
quote) and the fragment-status attr (`frag:...#3-the-cost-book-superseded-by-adr-0053`,
value `superseded`). Reading 0009 finds nothing beyond what the parse and
0052's own fact already cover, so its call is `facts: []`. `status`
afterward shows both `fresh`. `query neighbors ADR-0009 --direction in
--relation supersedes` returns one item (0052) with the quote, plus more
merged evidence entries from the parse's own plain mentions of ADR-0009 in
0052 — the typed edge absorbs them for evidence purposes, but that
merging is exactly why you never treat "already visible via query node" as
a reason to skip re-deriving your own fact on the next run (fact 9).
</example>

<example>
Same doc, re-ingested later after a trivial edit elsewhere in 0052 (the
supersedes text and the heading are untouched, but the hash changed, so
`status` reports `changed`). The correct write resends *both* facts from
the previous example — the `supersedes` edge and the frag-status attr —
because `facts-write` replaces the whole set regardless of what changed.
Sending only new material (or nothing, reasoning "the edge already shows in
`query node`") would silently delete both facts on this call; `status`
would go straight to `changed` → next run's `facts: []` → the supersedes
edge gone from the graph. Resending both keeps `query neighbors ADR-0009
--direction in --relation supersedes` returning the item and `status`
`fresh` for 0052.
</example>

<example>
Ingest re-run, no doc edited since the last run. `status` shows every
previously-ingested doc `fresh`. Zero candidates — nothing to process; say
so and stop. (A `changed` or `stale` doc, by contrast, is one whose content
or a committed fact's evidence moved — always a candidate again, and always
re-derived in full per fact 9.)
</example>

<example>
Default run, no paths named, not the first run: `summary` shows `{fresh:
1, changed: 0, stale: 1, neverIngested: 228}`. This is not a first run
(one doc is already `fresh`), and the user asked for nothing beyond a
plain "ingest" — so update mode selects only the 1 `stale` doc, ignoring
the 228 `never-ingested` ones. That one doc gets read, re-derived per fact
9, and written. The report states 228 never-ingested docs remain, and that
"ingest all" or naming their paths would include them next time.
</example>

<example>
First run: `summary` shows `{fresh: 0, changed: 0, stale: 0,
neverIngested: 30}` — nothing has ever been ingested, so every doc is a
candidate even though none was named and the user said only "ingest".
30 exceeds 20, so show the count and wait for approval before processing.
</example>

<example>
A fact's `object` is written as
`docs/adr/0009-accounts-receivable-owned-by-seli.md#some-guessed-anchor`.
`query node` on that same ref exits 2 first — caught before writing. Had it
been sent anyway, `facts-write` would reject it (exit 1): the target doc
has no such anchor. Replace it with a `frag:` object confirmed via the
`build` filter (fact 4), or with the whole `doc:` object plus a `scope`
label, and retry once.
</example>

<example>
A batch of 3 facts for one doc has one bad entry (an unknown anchor as a
`frag:` **subject** this time, which always errors, in-scope or not):
`facts-write` exits 1 with `errors: [{index: 1, message: "subject ... is
not doc:... or one of its known fragments"}]`. Drop or fix that one fact,
resend all 3 (with the fix); this gets exit 0, and the report shows the
engine's own `facts` count, which may be lower than 3 if any two collapsed
as duplicates (fact 10). A second rejection instead: skip the doc, report
it, and continue the batch.
</example>

## Guardrails

- Never write a doc's bytes. The only write in this skill is a
  `facts-write` call.
- Never write directly to `_lumina/facts/`, `_lumina/graph/`, or
  `_lumina/_state/` — only through `project.mjs` subcommands.
- Never skip re-deriving a meta-relation or fragment-status fact just
  because `query node` already shows an edge for it — that edge may be your
  own prior fact, and `facts-write` replaces the whole set every call. Skip
  only the parse-only kinds: links, bare ID mentions, frontmatter-key
  relations, concept mentions, heading status.
- Never write a `relation` that isn't spelled exactly as one of the 8
  meta-relation names or a key the project's own config maps — a
  misspelling is accepted silently and becomes `references` with no
  warning.
- Never guess an object's `#anchor` on another doc. Only cite a fragment id
  already confirmed via the `build` filter; omit the anchor entirely for an
  out-of-scope target (its anchor can never be checked, in or out of
  scope). Confirm every unprefixed object with `query node` before writing
  it — an unresolvable one leaves the doc permanently stale.
- Never invent a scope label that is a synonym for one already used against
  the same target — copy it verbatim instead.
- Never send a partial fact set meaning to "patch" a doc's facts — every
  `facts-write` call replaces the whole set for that doc.
- No git operations of any kind.

## Definition of Done

Before reporting done, verify:

(a) Every candidate doc got exactly one `facts-write` call that ended in
    one of: committed (exit 0), skipped after one retry or exit 2 (noted in
    the report, batch continued), or the whole batch stopped on exit 3.
(b) A final `status` run shows every successfully-committed doc `fresh`.
(c) No fact was written whose `subject` doc differs from the doc whose hash
    was sent as `sourceHash`.
(d) No object anchor was guessed: every `path#anchor` or `frag:...#...`
    object either names a fragment id already confirmed via the `build`
    filter, or the fact instead targets the whole `doc:`/declared ID with a
    `scope` label; no out-of-scope object carries an anchor at all.
(e) Every fact resent for a previously-ingested doc includes every
    meta-relation and fragment-status fact its current prose still states,
    not only newly found ones (fact 9).
(f) No `never-ingested` doc was selected unless the user asked for it
    explicitly or this was a first run (fact 1).
(g) The report names the fresh/changed/stale/never-ingested counts, how
    many `never-ingested` docs remain unprocessed and how to include them,
    any skipped docs and uncaptured relations, and suggests a fresh-session
    or subagent check/verify pass.
