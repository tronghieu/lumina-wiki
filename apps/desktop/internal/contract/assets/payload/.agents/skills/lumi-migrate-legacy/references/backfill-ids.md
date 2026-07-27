# /lumi-migrate-legacy --backfill-ids

Opt-in pass that populates the `external_ids` frontmatter object on every
source page from the canonical URLs already stored in `urls[]`. Non-destructive:
existing `external_ids` keys are NEVER overwritten — missing keys are added.
Mismatches (URL-derived value disagrees with stored value) are NOT touched
here; lint check **L16** surfaces them on the next `/lumi-check`.

## Triggering

The user runs `/lumi-migrate-legacy --backfill-ids` (typically after upgrading
to a release that introduced `external_ids`). The flag is opt-in — the
standard migration flow does NOT invoke it. There is no `--dry-run`; the merge
is non-destructive, so reviewing with `git diff wiki/sources/` is the
recommended way to inspect changes before committing.

## Recipe

The recipe uses `merge-ids.mjs` for the merge step so that **no shell-interpolated
`python -c` or `node -e` blocks ever embed user data in source code.** All data
flows through argv (URL only — re-validated by parse/merge scripts) and stdin
(JSON only — parsed via `JSON.parse`, never `eval`).

```bash
# 1. Enumerate all source slugs (the LLM driving this recipe should iterate
#    over `wiki.mjs list-entities --type sources` and call read-meta per slug;
#    a small jq or Node helper is fine. Below shows the per-slug inner loop.)

#    Per slug — vars: $slug, $url1, $url2, ... (driven by the LLM after parsing
#    the read-meta JSON with `node -e` over a TRUSTED schema, NOT user data).
merged='{}'
for url in "$url1" "$url2"; do      # quote each URL to prevent $(...) eval
  [ -z "$url" ] && continue
  next=$(printf '%s' "$merged" | node _lumina/scripts/merge-ids.mjs "$url") \
    || continue                     # parse failure → skip url, keep merged
  merged="$next"
done

# 2. Write only if non-empty. set-meta runs sanitizeExternalIdsObject so
#    even a compromised stdin chain cannot smuggle __proto__ etc.
if [ "$merged" != "{}" ]; then
  node _lumina/scripts/wiki.mjs set-meta "$slug" external_ids "$merged" --json-value
fi
```

`merge-ids.mjs` reads the existing map from stdin (printf-piped) and the URL
from argv. It performs the non-destructive merge (existing keys win), expands
arxiv↔arxiv-DOI, sanitizes against the namespace allowlist, and emits the
merged JSON to stdout. Errors go to stderr with exit 2.

To enumerate URLs per slug, the LLM should call `read-meta` and parse the
result with a small Node helper. Example using a one-liner that reads stdin:

```bash
node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); for (const u of (j.frontmatter.urls||[])) console.log(u);' \
  < <(node _lumina/scripts/wiki.mjs read-meta "$slug")
```

Note: the `node -e` body above contains NO interpolated user variables —
all input flows through stdin as JSON. This is the only `node -e` pattern that
remains safe; never embed `$slug`, `$url`, or any other variable into a
`node -e`/`python -c` source string.

## Safety guarantees

- `parse-ids.mjs` reads URL from `argv` (no shell interpolation in its body).
- `set-meta` allowlist-filters keys via `sanitizeExternalIdsObject` — even if
  a malicious frontmatter contained `__proto__`, it is dropped before write.
- `safeIdToken` re-validates the namespace pattern before any value is
  interpolated into a path or glob (consumer-side; this recipe does not glob,
  but downstream Tier 2 scans rely on the same helper).
- Idempotent: a second run with no new URLs produces zero diff. CI's
  idempotency gate watches `wiki/`, so a regression is caught at gate time.

## What this does NOT do

- It does not touch a source's `urls[]` array.
- It does not overwrite an existing `external_ids[ns]` value, even if the
  URL-derived value differs. That mismatch is owned by lint check **L16**.
- It does not invoke `/lumi-check --fix`; running `--backfill-ids` and
  `--fix` are independent operations.
