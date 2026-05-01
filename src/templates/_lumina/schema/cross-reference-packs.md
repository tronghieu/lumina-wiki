# Cross-Reference Rules by Pack

Pack-specific bidirectional-link rules that extend the core rules in `README.md`.
The linter reads this file only when the corresponding pack is installed.

---

## Core cross-reference rules

These apply in all workspaces regardless of installed packs.

| Forward link                        | Required reverse link                     | Exemption? |
|-------------------------------------|-------------------------------------------|------------|
| `sources/A` -> `concepts/B`         | `concepts/B` -> `sources/A`              | No         |
| `sources/A` -> `people/C`           | `people/C` -> `sources/A`               | No         |
| `concepts/K` -> `sources/E`         | `sources/E` -> `concepts/K`             | No         |
| `summary/S` -> `concepts/K`         | `concepts/K` -> `summary/S`             | No         |
| Any -> `outputs/**`                  | (no reverse required)                   | Yes        |
| Any -> `*://*`                       | (no reverse required — external URL)    | Yes        |
{{#if pack_research}}

---

## Research pack cross-reference rules

| Forward link                        | Required reverse link                     | Exemption? |
|-------------------------------------|-------------------------------------------|------------|
| `sources/A` -> `topics/T`           | `topics/T` -> `sources/A`               | No         |
| Any -> `foundations/**`             | (no reverse required — terminal pages)  | Yes        |
| `topics/T` -> `concepts/K`          | `concepts/K` -> `topics/T`              | No         |
{{/if}}
{{#if pack_reading}}

---

## Reading pack cross-reference rules

| Forward link                        | Required reverse link                     | Exemption? |
|-------------------------------------|-------------------------------------------|------------|
| `chapters/C` -> `characters/P`      | `characters/P` -> `chapters/C`          | No         |
| `chapters/C` -> `themes/T`          | `themes/T` -> `chapters/C`              | No         |
| `characters/P` -> `characters/Q`    | `characters/Q` -> `characters/P`        | No         |
{{/if}}
