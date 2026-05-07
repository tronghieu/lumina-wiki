---
name: lumi-help
description: >
  Orient the user in their Lumina wiki workspace. Default mode reads live
  workspace state (manifest, index, log, raw/) and recommends ONE next action.
  When the user passes `skills`/`catalog`/`list` as an argument OR asks a
  features question (e.g. "what skills are available", "có những tính năng
  nào", "list commands"), switch to catalog mode and dump the full skill
  list. Use whenever the user says "help", "what do I do next", "where do
  I start", "I'm lost", or asks for an orientation.
allowed-tools:
  - Bash
---

# /lumi-help

Read `README.md` at the project root before this SKILL.md.

## Two modes, two jobs

| Trigger | Mode | Job |
|---|---|---|
| No argument, or "help / I'm lost / what next" | **Orientation** | "Tell me the one thing to do next." |
| Argument is `skills`/`catalog`/`list`, OR user asks a features/capabilities question | **Catalog** | "Show me everything Lumina can do." |

Decide mode **before** running the decision ladder. Never mix the two.

### Catalog-mode keyword detection (case-insensitive, EN + VI)

`skills`, `catalog`, `list`, `features`, `available`, `commands`, `capabilities`,
`tính năng`, `khả năng`, `lệnh`, `liệt kê`, `có gì`, `có những gì`, `what can`, `what does`

If any of these appear in the argument or the user's surrounding message → catalog mode. Otherwise → orientation mode.

---

## Mode A — Orientation (default)

### Outcomes

1. The user receives a recommendation grounded in live workspace state.
2. Exactly one primary recommendation, with a one-sentence reason citing observed state.
3. An explicit usage line so the user can run it immediately.
4. No questions back to the user.

### Read state (single Bash call)

```bash
cat _lumina/manifest.json 2>/dev/null || echo "__MISSING__"
grep -c "\- \[\[" wiki/index.md 2>/dev/null || echo "0"
tail -n 10 wiki/log.md 2>/dev/null || echo "__NO_LOG__"
find raw/ -maxdepth 1 -type f ! -name ".*" ! -name ".gitkeep" 2>/dev/null | sort
date +%Y-%m-%d 2>/dev/null || echo "__NO_DATE__"
```

### Decision ladder (first match wins)

1. **Manifest is `__MISSING__` or invalid JSON** → `/lumi-init`
   *Reason:* workspace is not initialized yet.
2. **Wiki page count is 0** → `/lumi-ingest`
   *Reason:* wiki has no pages — ingest the first file from `raw/`.
3. **`raw/` has top-level files whose stems do not appear in `wiki/index.md` wikilinks** → `/lumi-ingest`
   *Reason:* N file(s) in `raw/` not yet ingested. Include filenames if N ≤ 3.
4. **Default — wiki is healthy** → `/lumi-ask`
   *Reason:* wiki is healthy — query the knowledge base.

Reasons above are templates. Localize to the user's communication language at output time.

### Idle-wiki hint (additive, not primary)

After the primary recommendation, if `wiki/log.md` is parseable and the most recent `## [YYYY-MM-DD]` heading is more than **30 days** before today, append one line:

> 💡 No wiki activity in N days — `/lumi-check` runs a graph-health audit when you're ready.

The hint never replaces the primary recommendation. The user's job on returning is to resume work, not audit. Skip the hint if `__NO_DATE__` is returned or the date cannot be parsed.

### Output format (orientation)

```
## Lumina — Next action

**/[skill-name]**
[Reason — one sentence, factual, in the user's language.]

→ Run: `/[skill-name]`

[Optional idle-wiki hint here.]

To see every available skill: `/lumi-help skills`
```

The trailing "To see every available skill" line appears on every orientation response — it is the bridge to catalog mode for explorer-type users.

---

## Mode B — Catalog (skills/catalog/list arg, or features keyword)

### Outcomes

1. The user sees every skill installed in their workspace, grouped by pack.
2. The list is grounded in the on-disk catalog file — never composed from memory.
3. The user is shown how to return to orientation.

### Read

```bash
cat _lumina/schema/skills-catalog.md 2>/dev/null || echo "__NO_CATALOG__"
```

The catalog file is rendered at install time with only the sections matching the user's installed packs — no further filtering is needed in this skill.

### Output format (catalog)

If the file is present, emit its body verbatim under your own heading, then the bridge line back to orientation:

```
## Lumina — Skills catalog

[verbatim contents of skills-catalog.md, body only — drop the file's own H1 and intro paragraph]

→ For a recommendation based on your current state: `/lumi-help`
```

If `__NO_CATALOG__` is returned, fall back to orientation mode and add a one-line note that the catalog file is missing. Never invent a skill list from memory.

---

## Constraints (both modes)

- Read only the data sources listed above. Never read wiki page bodies.
- Never write a file. Never call `wiki.mjs`, `lint.mjs`, or any script.
- If `wiki/log.md` or `wiki/index.md` is missing, treat as empty — do not surface the error.
- Surface only what is relevant to the current state. No preamble, no trailing summary, no general reflections about Lumina.
- All Bash reads run before any reasoning — never infer state from prior conversation.
- Respond in the user's communication language; localize the reason templates above accordingly.
