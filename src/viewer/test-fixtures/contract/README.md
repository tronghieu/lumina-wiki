# Contract fixture
One small wiki and the JSON the viewer must produce from it (spine AD-23). `expected/` is derived by hand from the spine, never from `data.mjs`. `pages.json` holds `index`, `sources/lora-2`, and `readings/deep-work/01-focus`. The `schema` block in `wiki.json` is a snapshot for client tests; nothing compares it to the engine, so it may trail `schemas.mjs`.

## Pages (`workspace/wiki/`)
- `index.md`: no frontmatter, so type null and title `index`. Links a root page, `[[log]]`. Leaves out only `graph/notes.md`: one L09.
- `log.md`: no frontmatter. L05 on lines 4 and 11, so `line` must sort as a number. `[[deep-work]]` resolves by basename and is still reported.
- `sources/lora.md`: plain page. `pending_citations` gives the only info finding (L22).
- `sources/lora-2.md`: id is `sources/lora` plus `-2`, so a `|`-joined sort key orders edges and findings wrongly. Holds every link form: bare, aliased, inner spaces, broken, URL-shaped.
- `sources/deep-work.md`: lacks `year` and `importance`. Two L01 on one file, ordered by `message` alone.
- `readings/deep-work/00-preface.md`: `title: 0` becomes `"0"`. No edge touches it: a community of one.
- `readings/deep-work/01-focus.md`: nested reading unit. Three-segment id, type `readings`.
- `concepts/adapters.md`: the page a bare edge endpoint (`adapters`) resolves to.
- `concepts/rank.md`: `title` is a list, so the title falls back to `rank`.
- `people/ada-park.md`: `title: ""`, so the title falls back to `ada-park`.
- `summary/2024.md`: `title: 2024` becomes `"2024"`.
- `graph/notes.md`: under `graph/`, so no node and no page. Its L04 finding has `nodeId: null`.
## `graph/edges.jsonl`, by line
1. Symmetric type, endpoints unsorted, `high`.
2. The same relation the other way, `low`. One undirected edge, `from < to`, `high`. Two L07.
3. `used_in` with a bare `from`, `medium`. The dropped half of a pair. Its L06 has `file: "adapters"`.
4. `uses_concept`, no confidence. Kept, as the type listed first in `EDGE_TYPES`; takes `medium`. Its L06 has `file: "sources/lora"`.
5. `authored` alone: a reverse row with no partner, emitted as stored. L06.
6. `cited_by`: flipped to `cites`. Same pair as citations line 1, so `source: "citations"`. L19.
7. `cites` found only here, so `source: "edges"`. L19.
8. `mentions`: unknown type, emitted directed. `confidence: "certain"` becomes null.
9. `see_also_url`: URL endpoint, node `url:https://example.org/lora`.
10. `related_to` self-loop: symmetric, emitted once, `from` equal to `to`.
11. `part_of` self-loop: directed, emitted once, never paired with itself. L06.
12. `annotated_by`, `high`: the dropped half of a pair stored both ways in full.
13. `annotates`, `low`: kept, and keeps its own `low`.
14. Not JSON: skipped.
15. `42`: skipped.
16. `[1]`: skipped.
17. `type` is a number: skipped.
## `graph/citations.jsonl`, by line
1. Same pair as edges line 6. One `cites` edge.
2. No `type`: still `cites`.
3. Typed `cited_by`: `cites` from `from` to `to`, never flipped. Edges line 7 runs the other way and stays a second edge.
4. `to` is `sources/gone`: node `missing:sources/gone`. L20 on `graph/citations.jsonl`, `nodeId: null`.
