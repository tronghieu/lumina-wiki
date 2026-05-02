# Dedup Policy

Use this reference before creating or updating source, concept, person, and graph
records during `/lumi-ingest`.

## Source Pages

Generate the source slug with:

```bash
node _lumina/scripts/wiki.mjs slug "<Title of the source>"
```

If `wiki/sources/<slug>.md` already exists, treat the run as a re-ingest. Confirm
with the user before overwriting body content. If the user confirms, keep stable
frontmatter values when possible and only update fields supported by the source.

## Foundation Resolution (Before Creating Concept Stubs)

Before creating any concept stub, check whether the term already has a foundation
page. This avoids duplicate concept pages when a foundation covers the same term
under its canonical name.

```bash
node _lumina/scripts/wiki.mjs resolve-alias "<concept-name>"
```

Decision tree by exit code:

- **exit 0, exactly 1 match (`ambiguous: false`)** — do NOT create a concept stub.
  Link to `[[foundations/<match-slug>]]` in the source page's `## Concepts` section.
  Add edge:
  ```bash
  node _lumina/scripts/wiki.mjs add-edge sources/<source-slug> grounded_in foundations/<match-slug>
  ```
  Note: `grounded_in` is terminal — no reverse edge will be written.

- **exit 0, `ambiguous: true`** — present the candidate foundations to the user
  with their slugs and ask which one applies. If none match the source's intended
  meaning, fall back to creating a concept stub.

- **exit 2 (no match)** — proceed with normal concept stub creation per the next
  section.

Run resolve-alias for every candidate concept name extracted in Phase 4, before
making any `add-edge concepts/<slug>` calls.

## Concept And Person Stubs

Before creating a concept or person page, check metadata:

```bash
node _lumina/scripts/wiki.mjs read-meta concepts/<slug>
node _lumina/scripts/wiki.mjs read-meta people/<slug>
```

Exit 2 means the page is absent and safe to create. If the page exists, append the
new source to its `## Key sources` section and update frontmatter with
`wiki.mjs set-meta`; do not overwrite the existing body.

## Graph Edges

Use `wiki.mjs add-edge` once for the forward relationship. It is idempotent and
automatically writes the reverse edge unless the edge is terminal, exempt, or
symmetric. Do not add reverse edges manually.

Use `wiki.mjs add-citation` only for cited source pages that already exist in
`wiki/sources/`. For cited works not yet ingested, record them in
`## Open Questions` rather than creating placeholder source pages.

## Idempotency Target

A repeated ingest of the same source should avoid duplicate stubs, duplicate
index entries, duplicate citations, and duplicate graph edges. If the second run
would change existing prose, ask the user before applying the update.
