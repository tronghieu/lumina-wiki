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
| L08 | Missing required confidence field | error | No — user must add confidence |
| L09 | Index out of sync | warning | Yes — rebuilds the index catalog |

## Classification

Errors that must be resolved before done:

- L01: missing frontmatter fields
- L02: wrong frontmatter types
- L03: non-kebab slugs
- L05: broken wikilinks
- L06: missing reverse edges
- L08: missing required confidence fields

Advisories to surface to the user:

- L04: orphan pages
- L07: duplicate symmetric edges
- L09: index out of sync

## Fix Behavior

`lint.mjs --fix --json` can apply L01, L03, L06, L07, and L09.

- L01 inserts a `TODO` placeholder for the missing field.
- L03 renames the file to kebab-case and rewrites matching wikilinks.
- L06 appends the missing reverse edge with the linter fixer.
- L07 deduplicates symmetric edges.
- L09 regenerates the `<!-- lumina:index --> ... <!-- /lumina:index -->` block.

L02, L05, and L08 require manual correction. If L06 remains after `--fix`, the
target page may not exist; identify it and suggest `/lumi-ingest` or
`/lumi-edit`.

The linter reads `_lumina/config/lumina.config.yaml` for exemption globs.
`foundations/**`, `outputs/**`, and external URL targets are exempt from L06.
