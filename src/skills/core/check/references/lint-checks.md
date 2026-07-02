# Lint Checks

Use this reference when interpreting `node _lumina/scripts/lint.mjs --json`
output in `/lumi-check`.

## Check Table

| ID | Name | Severity | Auto-fixable |
|----|------|----------|-------------|
| L01 | Missing frontmatter field | error | Yes — adds placeholder value |
| L02 | Wrong frontmatter type | error | No — user must provide the correct value |
| L03 | Non-kebab slug | error | Yes — renames file and rewrites wikilinks |
| L04 | Orphan page | warning | No — user decides whether to link or leave |
| L05 | Broken wikilink | error | No — user must correct or create target |
| L06 | Missing reverse edge | error | Yes — writes the reverse edge |
| L07 | Duplicate symmetric edge | warning | Yes — deduplicates |
| L08 | Missing required confidence field on an edge | error | No — user must add confidence |
| L09 | Index out of sync | warning | Yes — rebuilds the index catalog |
| L10 | Foundation alias conflict | error | No — user must rename or merge the colliding title/alias |
| L11 | Missing `confidence` field on a source/concept page | warning | No — user must set a value |
| L12 | `raw_paths` entry missing, unsafe, or parked in `raw/tmp/` | warning | No — user must move or fix the file, then update `raw_paths` |
| L13 | `external_ids` missing a namespace derivable from `urls[]` | warning | No — run `/lumi-migrate-legacy --backfill-ids` |
| L14 | `external_ids` value fails validation for its namespace | error | No — user must correct or remove the value |
| L16 | `external_ids` value disagrees with the value derived from `urls[]` | warning | No — run `/lumi-migrate-legacy --backfill-ids` to reconcile |

(L15 is intentionally unassigned — reserved for a future collision check.)

## Classification

Errors that must be resolved before done:

- L01: missing frontmatter fields
- L02: wrong frontmatter types
- L03: non-kebab slugs
- L05: broken wikilinks
- L06: missing reverse edges
- L08: missing required confidence field on an edge
- L10: foundation alias conflicts
- L14: invalid `external_ids` values

Advisories to surface to the user:

- L04: orphan pages
- L07: duplicate symmetric edges
- L09: index out of sync
- L11: missing `confidence` on a source/concept page
- L12: `raw_paths` missing, unsafe, or transient
- L13: `external_ids` missing a derivable namespace
- L16: `external_ids` disagrees with `urls[]`

## Fix Behavior

`lint.mjs --fix --json` can apply L01, L03, L06, L07, and L09.

- L01 inserts a `TODO` placeholder for the missing field.
- L03 renames the file to kebab-case and rewrites matching wikilinks.
- L06 appends the missing reverse edge with the linter fixer.
- L07 deduplicates symmetric edges.
- L09 regenerates the `<!-- lumina:index --> ... <!-- /lumina:index -->` block.

L02, L04, L05, L08, L10, L11, L12, L13, L14, and L16 require manual
correction — none of them are touched by `--fix`. If L06 remains after
`--fix`, the target page may not exist; identify it and suggest
`/lumi-ingest` or `/lumi-edit`. For L13 and L16, the fix path is
`/lumi-migrate-legacy --backfill-ids`, not `lint.mjs --fix`.

The linter reads `_lumina/config/lumina.config.yaml` for exemption globs.
`foundations/**`, `outputs/**`, and external URL targets are exempt from L06.
