# Triage Rubric for /lumi-verify

This file defines the four-bucket classification system for verify findings
and the rules for merging findings from multiple reviewers.

---

## Four-Bucket Classification

### `decision_needed`

Credible external evidence (from the External reviewer) directly contradicts
a claim in the entry. This could be a retraction, a correction notice, a
replication failure, or a directly contradicting result from another source.

**Effect:** HALT immediately. Present the finding to the user. Do not continue
to the next entry or write any other findings until the user confirms.

**Who assigns it:** External reviewer only.

---

### `patch`

A specific, checkable claim is either:
- Absent from the cited raw artifact (Grounding reviewer)
- Present in raw but with different values (e.g. wrong figure)
- Stated without attribution in the entry (Blind reviewer)
- Suggested as inaccurate by web evidence that is not conclusive enough for
  `decision_needed` (External reviewer)

**Effect:** Write to `findings:` frontmatter. Set `verify_status: findings_pending`.
The user must review and correct or confirm.

---

### `defer`

The issue exists but is pre-existing, out-of-scope for this run, or
requires context this reviewer does not have. Examples:
- The entry synthesizes across multiple sources; the discrepancy may be
  intentional
- A web search was unreachable (network failure)
- The raw file cited is a draft version; the final version may differ
- The issue is stylistic, not factual

**Effect:** Write to `findings:` frontmatter. Set `verify_status: findings_pending`
if no other findings are present. User may choose to ignore.

---

### `dismiss`

False positive. The claim is a well-known fact, a trivial paraphrase
difference, or the apparent discrepancy dissolves under closer inspection.

**Effect:** Write to `findings:` if you are unsure, or omit entirely if
confident it is noise. Dismissed findings do not affect `verify_status`.

---

## Merging Rules

When multiple reviewers return findings for the same entry:

1. Combine all findings into a single array, ordered: blind first, grounding
   second, external third.
2. Assign sequential integer ids starting at 1 across the combined array.
3. If the same claim is flagged by two reviewers with the same `class`,
   keep both findings — they provide independent evidence.
4. If the same claim is flagged by two reviewers with different classes, use
   the higher-severity class: `decision_needed` > `patch` > `defer` > `dismiss`.
5. `verdict` for the entry is determined by the highest-severity class across
   all findings after merging.

## Verdict Derivation

| Highest finding class | verify_status |
|---|---|
| `decision_needed` | HALT before writing — user must confirm |
| `patch` | `findings_pending` |
| `defer` (only) | `findings_pending` |
| `dismiss` (only) | `passed` (dismissals do not trigger pending) |
| No findings | `passed` |
| Drift preflight failed | `drift_detected` |
| No raw / no provenance | `skipped` |
| Non-sources entity | `not_applicable` |
