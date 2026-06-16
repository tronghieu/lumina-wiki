# The 4C Quality Rubric

Score each of the four dimensions from **1 to 5**. These are *your* qualitative
judgments, not measured facts — record them with `quality_source: llm` and keep
one short rationale per score. When the evidence for a dimension is thin (e.g.
you only read the abstract), score conservatively and say so.

| Score | Meaning            |
|-------|--------------------|
| 5     | Exceptional        |
| 4     | Strong             |
| 3     | Adequate / typical |
| 2     | Weak               |
| 1     | Poor / unreliable  |

## Correctness — *Is the work sound?*

Methodological integrity and the absence of obvious flaws. Look for: sensible
experimental design, appropriate baselines and ablations, honest treatment of
limitations, claims that are actually supported by the evidence presented,
reproducibility signals (released code/data, clear hyperparameters).

Lower the score for: overclaiming beyond the evidence, missing baselines,
cherry-picked results, statistical weaknesses, or unaddressed confounds.

## Clarity — *Can a reader follow it?*

Logical flow and presentation quality. Look for: a clear problem statement, a
readable structure, well-labeled figures and tables, defined notation, and a
contribution that is easy to state in one sentence.

Lower the score for: disorganized structure, undefined terms, figures that do
not support the text, or a thesis you have to reconstruct yourself.

## Contribution — *Does it matter?*

Novelty and impact on the field. Look for: a genuinely new idea, method, result,
dataset, or synthesis; a meaningful improvement over prior work; usefulness to
other researchers or practitioners.

Lower the score for: incremental tweaks framed as breakthroughs, results already
well established elsewhere, or a contribution that is hard to identify.

## Context — *Is it well situated?*

Quality of citations and relationship to prior work. Look for: fair and
reasonably complete related-work coverage, accurate characterization of what
came before, and a clear positioning of this work against it.

Lower the score for: thin or one-sided citations, ignoring obvious prior art, or
mischaracterizing competing approaches.

## Recording

The four scores go into the `ranking` frontmatter as
`quality_correctness`, `quality_clarity`, `quality_contribution`,
`quality_context`, plus `quality_source: llm` and `quality_assessed: <date>`.
The rationales go into the human-readable `## Ranking` section, not the
frontmatter.

Do **not** invent a single "overall" number. The four dimensions are reported
separately so a reader can weigh them for their own purpose.
