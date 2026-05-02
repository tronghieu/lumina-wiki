# Ranking Signals

Use this reference after source fetchers return candidate JSON for
`/lumi-research-discover`.

## Deduplication

Before ranking, build a seen set from:

- `wiki/sources` frontmatter: title, URL, DOI/arXiv/S2 identifiers when present
- `raw/discovered/**.json`: `id`, `paperId`, `url`, `doi`, `arxivId`, normalized title
- `_lumina/_state/discovery-*.json`: phase result IDs and titles
- the current candidate batch

Normalize titles by lowercasing, trimming punctuation, and collapsing whitespace.
Treat exact identifier matches as duplicates. Treat near-identical normalized
titles as duplicate coverage and keep the richer metadata record.

## Scoring

Rank candidate JSON with:

```bash
python3 _lumina/tools/discover.py --topic "<topic>"
```

`discover.py` emits `_score` from citation count, recency, and topic overlap. Do
not rewrite `_score`.

## Rationale

Add one short rationale per candidate that explains the dominant reason it
ranked:

- strong topic match
- high citation count
- recency
- anchor proximity
- useful background context

Flag common risks: missing abstract, weak topic overlap, metadata-only record,
Wikipedia background page rather than primary source, or duplicate coverage.

## Shortlist

Shortlist 5-10 items unless the user requested a different count. Separate:

- `ready`: strong metadata and no duplicate found
- `maybe`: relevant but weak metadata, duplicate coverage, or unclear fit
- `skip`: clear duplicate or outside scope

For long sessions, checkpoint the final shortlist with:

```bash
node _lumina/scripts/wiki.mjs checkpoint-write research-discover shortlist -
```

The checkpoint should contain the topic, seed mode, commands run, candidate
counts, and shortlisted IDs. This writes `_lumina/_state` only; it must not
create wiki pages, graph edges, index entries, or log entries.
