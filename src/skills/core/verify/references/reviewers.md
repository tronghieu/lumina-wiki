# Reviewer Prompts for /lumi-verify

This file contains the full text of the three reviewer sub-prompts. Load this
file when launching any reviewer (SKILL.md Step 3a) or when writing Bash-only
prompt files (SKILL.md Step 3b).

Substitute `{{ENTRY_TEXT}}`, `{{RAW_CONTENTS}}`, and `{{GRAPH_EXCERPT}}`
with the actual content before sending to a sub-agent or writing to the
prompt file.

---

## Reviewer 1: Blind

**Context you have:** The wiki entry text only. No raw source files, no graph
edges, no `sources:` frontmatter field showing provenance.

**Your task:**

Read the entry below. Report any of the following:

1. Claims stated as fact without any attribution or hedging (e.g. specific
   numbers, percentages, dates, rankings, named results).
2. Internal contradictions — two claims that cannot both be true.
3. Mushy attribution — "researchers found", "studies show" without saying
   which researchers or which studies.
4. Claims that sound too precise to be paraphrase (specific figures like
   "97.3%") but have no source reference inline.

For each issue found, produce a finding object with this shape:
```json
{
  "reviewer": "blind",
  "class": "patch" | "defer" | "dismiss",
  "claim": "<exact quote or close paraphrase of the claim>",
  "evidence": "<what makes this suspicious>",
  "action": "<what the user should do>"
}
```

Use `dismiss` if the claim is clearly a well-known fact unlikely to be
fabricated. Use `defer` if the issue is stylistic rather than factual. Use
`patch` if the claim could be a hallucination or inaccuracy that warrants
checking against the source.

Do not use `decision_needed` — that class is reserved for External reviewer
findings where open-web evidence contradicts the claim.

If no issues found, return an empty array `[]`.

---

**Entry text:**

{{ENTRY_TEXT}}

---

## Reviewer 2: Grounding

**Context you have:** The wiki entry text, the contents of the raw artifacts
cited in `raw_paths`, and a graph excerpt showing edges for this entry.

**Your task:**

Cross-check every specific claim in the wiki entry against the raw source
material. For each claim:

1. Find the corresponding passage in the raw artifact(s).
2. Determine whether the claim is supported, contradicted, or absent.
3. Check that edge types used in the graph excerpt match the actual relationship
   in the raw text (e.g. `introduces_concept` vs `mentions`).

For each discrepancy found, produce a finding object:
```json
{
  "reviewer": "grounding",
  "class": "patch" | "defer" | "dismiss",
  "claim": "<exact quote or close paraphrase>",
  "evidence": "<what the raw says vs what the entry says>",
  "action": "<what the user should do>"
}
```

Use `patch` when the raw contradicts the claim or when the claim is absent
from the raw entirely. Use `defer` when the discrepancy may be intentional
(e.g. the entry synthesizes across multiple sources and the raw is only one).
Use `dismiss` for trivial paraphrase differences that do not change meaning.

If no discrepancies found, return an empty array `[]`.

---

**Entry text:**

{{ENTRY_TEXT}}

---

**Raw artifact contents:**

{{RAW_CONTENTS}}

---

**Graph excerpt (edges for this entry):**

{{GRAPH_EXCERPT}}

---

## Reviewer 3: External

**Context you have:** The wiki entry text. You will run two web searches:
one confirmatory and one adversarial. Both are mandatory.

**Your task:**

1. Extract the central, most specific factual claim in the entry (a figure,
   finding, or attributed result that could be verified externally).

2. Run a confirmatory web search: `<central claim> <source name>` or similar.

3. Run an adversarial web search: `<central claim> debunked|criticism|alternative`.
   This query is non-negotiable. It guards against confirmation bias. Do not
   skip it even if the confirmatory search looks clean.

4. Compare the entry's claim against what you find.

For each discrepancy found, produce a finding object:
```json
{
  "reviewer": "external",
  "class": "decision_needed" | "patch" | "defer" | "dismiss",
  "claim": "<exact quote or close paraphrase>",
  "evidence": "<what web search returned and why it conflicts>",
  "action": "<what the user should do>"
}
```

Use `decision_needed` when the adversarial search returns credible evidence
that directly contradicts the claim (retraction, correction, alternative result
from another study). This class triggers an immediate HALT in the parent skill.

Use `patch` when the evidence suggests an inaccuracy but is not conclusive.
Use `defer` when results are ambiguous or the contradiction is interpretive.
Use `dismiss` when the adversarial search returns no relevant contradictory
evidence.

If a web search is unreachable (network error), add one finding with
`class: defer`, `evidence: "web search unreachable"`, and continue. Do not
fail the run.

If no issues found after both searches, return an empty array `[]`.

---

**Entry text:**

{{ENTRY_TEXT}}
