# Lint Checks

Use this reference when interpreting `node _lumina/scripts/lint.mjs --json`
output in `/lumi-check`.

## Check Table

| ID | Name | Severity | Auto-fixable |
|----|------|----------|-------------|
| L01 | Missing frontmatter field | error | Mostly — derives a type-valid value (`[]` for arrays, dates from a legacy field or file mtime, `id`/`type`/`title` from the file itself); leaves `number`/enum fields with no safe default standing |
| L02 | Wrong frontmatter type | error | Mostly — wraps a bare string into an array, reconstructs `key_sources`/`related_concepts` from `graph/edges.jsonl` (falls back to `[]`); treats the literal value `TODO` as invalid on any declared field and recovers `id`/`type`/`title` from it the same way a missing field is recovered; cannot repair `number`/enum values or a `TODO` on any other string field |
| L03 | Non-kebab slug | error | Yes — renames file, rewrites wikilinks, updates the page's own `id`; refused when the target name is taken |
| L04 | Orphan page | warning | No — user decides whether to link or leave |
| L05 | Broken wikilink | error | Only when unambiguous — rewrites the link when exactly one page's basename matches; ambiguous or zero matches are reported with candidates instead of guessed |
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
| L17 | Dangling edge endpoint (edge `from`/`to` does not resolve to an existing wiki file) | error | No — user must run `wiki.mjs remove-edge` or recreate the missing page |
| L18 | Frontmatter `id` no longer names the file it lives in | warning | No — by design; user sets `id` to match the file or renames the file to match `id`. The pre-v0.1 form `<own-entity-dir>/<slug>` (e.g. `concepts/ab-testing` on a page in `concepts/`) is tolerated and never rewritten; a prefix naming a *different* entity dir is not |

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
- L17: dangling edge endpoints

Advisories to surface to the user:

- L04: orphan pages
- L07: duplicate symmetric edges
- L09: index out of sync
- L11: missing `confidence` on a source/concept page
- L12: `raw_paths` missing, unsafe, or transient
- L13: `external_ids` missing a derivable namespace
- L16: `external_ids` disagrees with `urls[]`
- L18: `id` no longer names the file it lives in

## Fix Behavior

`lint.mjs --fix --json` can apply L01, L02, L03, L05, L06, L07, and L09.

- L01 derives a type-valid value for the missing field instead of a
  placeholder: `[]` for array fields, a date recovered from a legacy
  `date_added` field or the file's mtime, `id` from a legacy `slug` field or
  the file path, `type` from the entity directory, `title` from the page's H1.
  For `number` fields and enums with no safe default it writes nothing and
  leaves the finding standing — a loud correct error beats a silent wrong
  value.
- L02 repairs type mismatches: wraps a bare string into an array, and
  reconstructs `key_sources`/`related_concepts` from `graph/edges.jsonl` (the
  graph is the source of truth for those two fields; frontmatter arrays are a
  projection of it), falling back to `[]` when no edges exist. It cannot
  repair `number`/enum values.
- L02 also treats the exact literal value `TODO` (after trimming, matched
  case-sensitively) as invalid for any field the entity type declares, of
  any type — this is the placeholder an older `--fix` used to write for a
  missing field, and on a `string` field (`id`, `type`, `title`, or a type's
  own fields like a reading's `source` or a chapter's `book`) it previously
  passed unnoticed, since `TODO` is itself a valid string. `id`, `type`, and
  `title` are repaired the same way a *missing* field is: `id` from a legacy
  `slug` field or the file path, `type` from the entity directory, `title`
  from the page's H1. Any other string field holding `TODO` (e.g. a
  reading's `source`, a chapter's `book`) has no such derivation and is left
  standing. A free-form key a page owner set to `TODO` themselves — one not
  declared for that entity type — is never inspected by this rule.
- Once `id` is recovered from a legacy `slug` this way, L02's legacy-field
  cleanup (see the `slug`/`date_added`/`url` renames noted throughout this
  wiki's docs) also recognizes an `id` that carries its own entity-type
  folder ahead of the same value — `id: concepts/ab-testing` next to a
  legacy `slug: ab-testing` — as carrying the same information as the
  shorter legacy value, so the redundant `slug` is removed in the same
  `--fix` pass. A folder name that isn't one of the wiki's own entity types
  is never accepted this way, so an unrelated identifier that happens to
  contain a slash (for example an arXiv id) is never mistaken for a match.
- L03 renames the file to kebab-case, rewrites matching wikilinks, and
  updates the page's own `id` (and legacy `slug`) so it still names the file.
  The rename is refused, and the finding left standing with an explanation,
  when the kebab-case name is already taken by another page, when two flagged
  files would kebab-case to the same name, or when the name is made entirely
  of punctuation and would leave nothing behind. Renaming over an existing
  page would destroy it, so the collision is surfaced for a human instead:
  merge the two pages, or rename one by hand, then re-run `--fix`.
- L05 rewrites a broken wikilink only when exactly one page's basename
  matches (e.g. `[[agent-taxonomy]]` → `[[concepts/agent-taxonomy]]`).
  Ambiguous (multiple candidates) or zero-match links are never guessed — the
  finding is left standing and reported with the candidate list.
- L06 appends the missing reverse edge with the linter fixer.
- L07 deduplicates symmetric edges.
- L09 regenerates the `<!-- lumina:index --> ... <!-- /lumina:index -->` block.

L04, L08, L10, L11, L12, L13, L14, L16, L17, and L18 require manual correction
— none of them are touched by `--fix`. So do the individual L01/L02/L05
findings above that `--fix` could recognize but not safely resolve on its own
(a `number`/enum field with no default, or an ambiguous/unresolvable wikilink)
— they remain in the findings list with `fixable: false` after a `--fix` pass.
If L06 remains after `--fix`, the target page may not exist; identify it and
suggest `/lumi-ingest` or `/lumi-edit`. For L13 and L16, the fix path is
`/lumi-migrate-legacy --backfill-ids`, not `lint.mjs --fix`. For L17, the fix
path is `wiki.mjs remove-edge` (drop the stale edge) or recreating the missing
page the edge still points at — never hand-edit `edges.jsonl`.

### `--suggest` — resolutions for what `--fix` could not resolve

`lint.mjs --suggest --json` adds a `suggestion` string to every finding whose
`fixable` field is `false` — the specific value or action needed (this
includes the L01/L02/L05 findings that survive a `--fix` pass, since a
surviving finding is by definition one `fixable: false` marked unresolvable).
A finding with `fixable: true` never gets a `suggestion` key, whether or not
`--fix` has actually run yet — there is nothing to suggest when the linter
already knows how to resolve it. For an ambiguous or zero-match L05
wikilink, the finding also carries a `candidates` array (the pages whose
basename matched — empty when none did); `--suggest` folds those same
candidates into its `suggestion` text too, so reading `suggestion` alone is
enough for every check. Read the finding's `suggestion` (and, for L05,
`candidates`) rather than guessing — this is the input `/lumi-migrate-legacy`
uses to make its own inferences, and what a human should read before
hand-editing a page.

The linter reads `_lumina/config/lumina.config.yaml` for exemption globs.
`foundations/**`, `outputs/**`, and external URL targets are exempt from L06.
