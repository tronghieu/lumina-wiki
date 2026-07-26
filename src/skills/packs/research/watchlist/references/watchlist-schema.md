# Watchlist schema and feed configuration

Read this before creating or changing `_lumina/config/watchlist.yml`. It is an
agent-operational reference: preserve the user's existing items and make the
smallest valid edit.

## Root structure

The file must be a YAML object with `version: 1`. `defaults` is optional; its
values are inherited by topic items. `items` is the canonical list (older
`watchlist` and `topics` lists are accepted by the runner but should not be
introduced in new edits).

```yaml
version: 1
defaults:
  sources: [arxiv]
  schedule: weekly
  limit: 20
  max_new: 5
items: []
```

`schedule` must be `manual`, `daily`, `weekly`, or `monthly`. `limit` and
`max_new`, when present, are integers from 1 through 100. Each `id` must be
unique, 1–64 characters, start with a lowercase letter or number, and then use
only lowercase letters, numbers, or hyphens.

## Topic items

An omitted `type` means `topic`. A topic needs a non-empty `query` and one or
more sources from `arxiv`, `s2`, and `openalex`.

```yaml
  - id: agent-memory
    type: topic
    enabled: true
    query: "LLM agent memory"
    sources: [arxiv, openalex]
    schedule: weekly
    limit: 20
    max_new: 5
```

`enabled` is active only when it is the boolean `true`; any other value is
treated as disabled. Use `manual` for a saved topic that must not run under a
cadence filter. Semantic Scholar (`s2`) needs its configured API key; a missing
optional key is reported as a skipped source rather than a hard failure.

## RSS and Atom feed items

Use `type: feed` for a feed. A feed needs an HTTPS `url`; it must not begin
with `--`. `query` and `sources` do not apply to feeds and should be omitted.

```yaml
  - id: arxiv-cs-lg
    type: feed
    enabled: true
    url: "https://arxiv.org/rss/cs.LG"
    name: "arXiv cs.LG"
    schedule: daily
    max_new: 20
    extract_dois: true
```

`name` is an optional display label. `extract_dois` defaults to `true`; set it
to `false` only when identifier harvesting from entries is unwanted. The feed
fetcher rejects unsafe destinations, including local and private network
addresses, and rejects XML with external entities. Do not weaken those checks.

## Validation and safe repair

Run `lumina discover run --dry-run --json`, or
`node _lumina/scripts/discover-runner.mjs --dry-run --json`, from the workspace
root after editing only when no enabled feed is present and the user asked for
a preview. For a watchlist with enabled feeds, manually inspect the schema
instead: the preview polls feeds and can update their deduplication state, so
it is not a no-I/O check.

If validation fails, explain the named item and field, then repair only that
problem. Do not delete unrelated items or rewrite comments merely to normalize
formatting.
