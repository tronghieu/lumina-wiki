# Runner behavior and troubleshooting

Read this before running scheduled discovery or interpreting its JSON output.

## Commands and effects

Run from the workspace root:

```bash
node _lumina/scripts/discover-runner.mjs --json
node _lumina/scripts/discover-runner.mjs --schedule weekly --json
node _lumina/scripts/discover-runner.mjs --source rss --json
```

The runner checks enabled watchlist items, then writes new candidate records to
`raw/discovered/<date>/<watchlist-id>/`. It does not create wiki pages, change
the citation graph, download PDFs, or alter the watchlist. Topic candidates are
ranked before records are written. Duplicate records are suppressed across
providers and past runs using identifiers, titles, and saved discovery state.

`--dry-run` reports topic candidates without writing candidate records or the
main discovery-runner state. A feed dry-run still calls the feed poller, whose
ETag and seen-item state may be updated; do not present it as a no-I/O preview
when feed items are enabled.

## Reading the JSON summary

Use `checked`, `queriesRun`, `fetched`, `new`, `duplicates`, and `errorsCount`
for the overall result. `candidates` contains the individual records; group it
by `watchlistId` to summarize new findings for each item. `skipped` contains
disabled items, cadence/source-filter mismatches, missing optional keys, and
per-item caps. `errors` contains an `id`, source, and message for failures.

The command exits 0 for a successful pass, 2 for invalid arguments or
watchlist data, and 3 when one or more source operations fail. A missing
Semantic Scholar key is an optional-source skip, not a runner failure.

## Feed reliability and safety

Each feed keeps state in `_lumina/_state/feeds/<id>.json`. Conditional requests
use ETag and Last-Modified values when available. Seen GUIDs are retained up to
5,000 entries and expire after 90 days. A maximum of `max_new` entries is
emitted per poll; un-emitted later entries remain eligible for the next poll.

The feed fetcher accepts HTTPS endpoints only, blocks unsafe local/private
destinations, and rejects XML with external entities. Preserve those
protections. A network or server failure leaves the previous feed state in
place, so the next normal poll can recover.

## Troubleshooting

| Symptom | Response |
| --- | --- |
| No candidates | Check `enabled`, the selected cadence, and source filter with a topic-only dry run. |
| Missing Semantic Scholar results | Configure its API key or remove `s2` from that topic; other sources can still run. |
| Feed temporarily unreachable | Report the item id and retry no more than once by hand; state is preserved. |
| Unsafe XML or unsafe destination | Verify the publisher's URL. Do not bypass the rejection. |
| Same feed item repeats | The publisher may be changing item identifiers; report the feed URL for investigation. |
