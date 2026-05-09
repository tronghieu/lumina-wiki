# /lumi-help — runbook

Procedural detail for the `lumi-help` skill: exact Bash commands, output
templates, multilingual keyword lists, and fallback codes. The skill reads this
file when it needs precision; `SKILL.md` is the contract.

## Step 0 · Read languages (always first)

```bash
sed -n 's/^communication_language:[[:space:]]*"\?\([^"]*\)"\?.*/\1/p' \
  _lumina/config/lumina.config.yaml
sed -n 's/^document_output_language:[[:space:]]*"\?\([^"]*\)"\?.*/\1/p' \
  _lumina/config/lumina.config.yaml
```

Bind two locals:

- `COMM_LANG` — every word back to user. If config missing or empty, fall back
  to the language detected from the user's most recent message.
- `DOC_LANG` — surface this whenever recommending a write-skill (`/lumi-init`,
  `/lumi-ingest`, `/lumi-edit`, `/lumi-research-*`, `/lumi-reading-*`).

Also snap tone from the input: casual → casual response register; formal →
templated form.

## Router · multilingual keyword lists

**Mode B — Catalog** (priority over C):
`skills`, `catalog`, `list`, `features`, `available`, `commands`,
`capabilities`, `tính năng`, `khả năng`, `lệnh`, `liệt kê`, `có gì`,
`có những gì`, `什么命令`, `有什么`, `命令`.

**Mode C — Framework Q&A** requires BOTH:

- *Question form*: `how does`, `how do`, `what is`, `what's the difference`,
  `why does`, `why do`, `explain`, `tell me about`, `cách nào`, `như thế nào`,
  `tại sao`, `giải thích`, `nghĩa là gì`, `怎么`, `如何`, `为什么`, `解释`, `什么是`.
- *Plus Lumina noun*: `lumi-`, `wiki`, `raw`, `foundations`, `outputs`,
  `summary`, `concepts`, `sources`, `ingest`, `bidirectional`, `link`, `edge`,
  `graph`, `frontmatter`, `slug`, `pack`, `lint`, `manifest`, `Lumina`.

If the question is about wiki *content* (not framework), bridge to `/lumi-ask`
instead of Mode C.

## Mode A · Bash reads

### Step a · Locate

```bash
cat _lumina/manifest.json 2>/dev/null || echo "__NO_MANIFEST__"
cat _lumina/schema/skills-catalog.csv 2>/dev/null || echo "__NO_CATALOG__"
date +%Y-%m-%d 2>/dev/null || echo "__NO_DATE__"
```

`__NO_MANIFEST__` → recommend `/lumi-init`, stop.
`__NO_CATALOG__` → recommend re-running `npx lumina-wiki install`, stop.

CSV header: `id,menu,pack,phase,after,before,required,args,outputs,description`.
Multi-value fields (`after`, `before`, `outputs`) are semicolon-separated.

### Step b · Detect state

```bash
node _lumina/scripts/wiki.mjs list-entities 2>/dev/null || echo "__NO_GRAPH__"
grep -E "^## \[[0-9]{4}-[0-9]{2}-[0-9]{2}\] " "wiki/log.md" 2>/dev/null | tail -n 30
find "raw/" -maxdepth 1 -type f ! -name ".*" ! -name ".gitkeep" 2>/dev/null | sort
sed -n '/^<!-- lumina:index -->/,/^<!-- \/lumina:index -->/p' "wiki/index.md" 2>/dev/null | head -60
```

Substitute `raw/`, `wiki/log.md`, `wiki/index.md` with paths from
`manifest.resolvedPaths` if relocated. `__NO_GRAPH__` → entity counts = 0.

### Step c · Compute next (DAG over CSV)

For every row S:

1. Pack gating — already done by installer (rendered CSV is in-scope).
2. Completion — true if any `S.outputs` glob matches a live entity OR `S.id`
   appears in parsed log entries.
3. Upstream — every id in `S.after` must be completed.
4. Downstream — for every other row T, if `T.before` contains `S.id`, don't
   pick T before S has run.
5. Phase order: `1-bootstrap → 2-ingest → 3-query → anytime`.

Pick (first match wins):

1. Manifest missing → `lumi-init`. *Reason: workspace not initialized.*
2. Required skill, both gates satisfied, completed=false (phase order) →
   that skill. *Reason: this required step is the next gate.*
3. raw/ orphans exist → `lumi-ingest`. *Reason: N file(s) in `raw/` not yet
   ingested. Include filenames when N ≤ 3.*
4. Default → `lumi-ask`. *Reason: wiki is healthy — query the knowledge base.*

Idle hint (additive, never replaces primary): if last `## [YYYY-MM-DD]` log
heading is more than 30 days before today, append:

> 💡 No wiki activity in N days — `/lumi-check` runs a graph-health audit when you're ready.

### Step d · Ground

For S.id `lumi-X`, citation in priority order:

1. `node _lumina/scripts/wiki.mjs resolve-alias "X"` → if returns
   `foundations/<slug>`, use it.
2. Else: `.agents/skills/lumi-X/SKILL.md` "<section heading>".
3. Else: `README.md` "Available Skills".

One `resolve-alias` call. No retry. Omit citation arrow when none found.

### Step e · Output template (formal register)

```
## Lumina — Next action

**`[<menu>]` /<skill-name>** — <display name>
[Reason — one sentence in COMM_LANG]

→ Run: `/<skill-name>` [<args>]
[if write-skill: "Wiki pages will be written in <DOC_LANG>."]

↳ <citation path>     ← only if step d found one
[💡 Idle-wiki hint, if applicable]

Want me to run it now? (yes / show me first / skip)

To see every available skill: `/lumi-help skills`
For how Lumina works: `/lumi-help explain <topic>`
```

Skip the "Want me to run it now?" prompt for case (4) — `/lumi-ask` is the
default-healthy state, no offer needed.

If user replies "yes" → invoke the recommended skill in this conversation.
Anything non-affirmative ("show me first", "skip", silence) → don't invoke.

### Step e · Output template (casual register)

When input is casual ("hi bro", "chào", "嗨", emojis, slang), drop the `##`
heading and the trailing two-line footer. Lead with a one-sentence answer in
`COMM_LANG`, then the bullet, then "Want me to run it now?". Keep the citation
arrow `↳` if step d found one.

## Mode B · Catalog rendering

```bash
cat _lumina/schema/skills-catalog.csv 2>/dev/null || echo "__NO_CATALOG__"
```

Parse with the canonical header. Group rows by `pack` in order:
core → research → reading → other (alphabetical). Within each group, preserve
the row order in the CSV.

Pack labels (hardcoded):

- `core` → "Core (always installed)"
- `research` → "Research pack"
- `reading` → "Reading pack"
- other → pack name with first letter capitalized

Output:

```
## Lumina — Skills catalog

### <Pack label>

- `[<menu>]` `/<id>` <args if non-empty> — <description>
- `[<menu>]` `/<id>` <args if non-empty> — <description>

### <Pack label>

- ...

→ For a recommendation based on your current state: `/lumi-help`
→ For a how-it-works question about Lumina: `/lumi-help explain <topic>`
```

Render `args` directly after the id with a single space, e.g.
`` `/lumi-ingest` [path/to/file] — read a source ... ``.

`__NO_CATALOG__` → fall back to Mode A with a one-line note that the catalog
file is missing and re-running `npx lumina-wiki install` is needed. Never
invent a skill list from memory.

## Mode C · Output templates

### Formal register

```
## Lumina — <topic phrased as a noun>

<direct answer, 1–4 sentences in COMM_LANG>

**Source**: `<path>` § <section heading>
[Optional 2nd source line if claim spans multiple docs]

→ Try it: `/<skill-name>` [<args>] — <one-line nudge>
[if Try-it points at a write-skill: "Wiki pages will be written in <DOC_LANG>."]
```

The "Try it" line is optional — include only when an obviously-relevant next
skill exists (e.g. an "explain ingest" answer naturally points at
`/lumi-ingest`).

### No-doc fallback

```
## Lumina — <topic>

The local docs don't cover this directly. The closest reference is `<path>`. You can also open an issue at the lumina-wiki repository if this is a real gap.
```

### Casual register

Same content, but drop the `## Lumina — <topic>` heading and lead with the
answer directly. Keep the `**Source**:` line — citations are non-negotiable.
