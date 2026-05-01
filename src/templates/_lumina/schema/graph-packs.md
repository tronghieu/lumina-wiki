# Graph Edge Types by Pack

Documents the edge type vocabulary for `wiki/graph/edges.jsonl`.
The graph builder reads this file when determining valid edge types per pack.

---

## Core edge types (always available)

| Edge type          | Symmetric | From      | To        | Reverse           |
|--------------------|-----------|-----------|-----------|-------------------|
| `related_to`       | Yes       | concepts  | concepts  | `related_to`      |
| `builds_on`        | No        | sources   | sources   | `built_upon_by`   |
| `built_upon_by`    | No        | sources   | sources   | `builds_on`       |
| `contradicts`      | Yes       | sources   | sources   | `contradicts`     |
| `cites`            | No        | sources   | sources   | `cited_by`        |
| `cited_by`         | No        | sources   | sources   | `cites`           |
| `mentions`         | No        | *         | *         | (terminal)        |
| `part_of`          | No        | concepts  | concepts  | `has_part`        |
| `has_part`         | No        | concepts  | concepts  | `part_of`         |
| `authored_by`      | No        | sources   | people    | `authored`        |
| `authored`         | No        | people    | sources   | `authored_by`     |
| `introduces_concept`| No       | sources   | concepts  | `introduced_in`   |
| `introduced_in`    | No        | concepts  | sources   | `introduces_concept`|
| `uses_concept`     | No        | sources   | concepts  | `used_in`         |
| `used_in`          | No        | concepts  | sources   | `uses_concept`    |
| `produced`         | No        | *         | outputs   | (terminal)        |
| `see_also_url`     | No        | *         | *         | (terminal)        |
{{#if pack_research}}

---

## Research pack edge types

| Edge type          | Symmetric | From      | To          | Reverse           |
|--------------------|-----------|-----------|-------------|-------------------|
| `grounded_in`      | No        | *         | foundations | (terminal)        |
| `same_problem_as`  | Yes       | sources   | sources     | `same_problem_as` |
| `similar_method_to`| Yes       | sources   | sources     | `similar_method_to`|
| `surveys`          | No        | sources   | sources     | `surveyed_by`     |
| `surveyed_by`      | No        | sources   | sources     | `surveys`         |
{{/if}}
{{#if pack_reading}}

---

## Reading pack edge types

| Edge type          | Symmetric | From       | To         | Reverse           |
|--------------------|-----------|-----------|------------|-------------------|
| `features`         | No        | chapters   | characters| `appears_in`      |
| `appears_in`       | No        | *          | chapters  | (terminal)        |
| `tagged_with`      | No        | chapters   | themes    | `appears_in`      |
| `associated_with`  | No        | themes     | characters| `expresses_theme` |
| `expresses_theme`  | No        | characters | themes    | `associated_with` |
| `appears_with`     | Yes       | characters | characters| `appears_with`    |
{{/if}}
