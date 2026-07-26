# Lumina-Wiki command reference

Use this page to look up a command after you know what you want to do. The commands below are grouped by the feature set that provides them. Your workspace includes the Core commands; the other groups appear only when you chose that feature set during installation. To see exactly what is available in your workspace, run `/lumi-help skills` or `$lumi-help skills`.

Examples below use `/`. In Codex, replace the first `/` with `$`.

## Core commands

| Command | Use it when you want to | Example | What you get |
| --- | --- | --- | --- |
| `/lumi-init` | prepare a new or empty wiki | `/lumi-init` | A ready place for your first source. Safe to run again. |
| `/lumi-ingest` | add a document, a link, or a paper to your wiki | `/lumi-ingest raw/sources/article.pdf` | A source note, connected notes for important ideas, and an updated index. |
| `/lumi-ask` | ask what your wiki says about a question | `/lumi-ask What do these sources agree on?` | An answer that points to the notes and sources it used. |
| `/lumi-edit` | revise one existing wiki page | `/lumi-edit wiki/sources/article.md` | The requested change while keeping related notes connected. |
| `/lumi-check` | check whether the wiki needs attention | `/lumi-check` | A clear list of issues and help with safe repairs. |
| `/lumi-reset` | start over with selected material | `/lumi-reset` | A proposed plan first, then changes only after you confirm. |
| `/lumi-verify` | compare notes with the sources they name | `/lumi-verify article` | Findings you can inspect; it does not change your notes by itself. |
| `/lumi-migrate-legacy` | update older notes after a Lumina-Wiki upgrade | `/lumi-migrate-legacy --backfill-ids` | Help filling in information needed by older pages. |
| `/lumi-help` | find the next step or learn how a feature works | `/lumi-help` | One suggested next action. Use `skills` to see your installed commands or `explain <question>` for a product question. |

`/lumi-ingest` also accepts a paper title, an arXiv identifier, or a web link when you do not have a local file. `/lumi-ask` may save an answer only when you explicitly ask it to do so.

## Research commands

These commands require the Research pack.

| Command | Use it when you want to | Example | What you get |
| --- | --- | --- | --- |
| `/lumi-research-setup` | prepare optional research tools | `/lumi-research-setup` | A check of what is ready and guided setup for services you choose to use. |
| `/lumi-research-prefill` | add stable background ideas before collecting sources | `/lumi-research-prefill` | Reusable background notes that reduce duplicate explanations. |
| `/lumi-research-discover` | find candidate sources for a topic | `/lumi-research-discover` | A shortlist for you to choose from; it does not add sources without your choice. |
| `/lumi-research-watchlist` | choose topics you want to follow | `/lumi-research-watchlist` | An updated list of topics and feeds to check later. |
| `/lumi-research-watch-run` | check the topics you follow now | `/lumi-research-watch-run` | A plain-language report of new candidate sources. |
| `/lumi-research-survey` | turn existing notes into a literature-style overview | `/lumi-research-survey` | A connected overview, saved only if you ask. |
| `/lumi-research-topic` | group existing notes around one theme | `/lumi-research-topic` | A theme page that makes related sources and ideas easier to find. |
| `/lumi-research-rank` | decide what an added paper is worth reading next | `/lumi-research-rank source-name` | A reading-priority assessment recorded on that source page. |

## Reading commands

These commands require the Reading pack.

| Command | Use it when you want to | Example | What you get |
| --- | --- | --- | --- |
| `/lumi-reading-chapter-ingest` | add one chapter of a book | `/lumi-reading-chapter-ingest chapter-3` | Chapter notes plus people, themes, and events mentioned there. |
| `/lumi-reading-character-track` | refresh what the wiki knows about characters | `/lumi-reading-character-track` | Updated character pages and relationships. |
| `/lumi-reading-theme-map` | see themes across several chapters | `/lumi-reading-theme-map` | Theme pages linked to the relevant chapters and characters. |
| `/lumi-reading-plot-recap` | get a recap without reading past your place | `/lumi-reading-plot-recap book-name:chapter-4` | A recap that stops before the chapter you name. |

## Learning command

This command requires the Learning pack.

| Command | Use it when you want to | Example | What you get |
| --- | --- | --- | --- |
| `/lumi-learning-reflect` | record and revisit your own understanding | `/lumi-learning-reflect spaced-repetition` | A guided reflection in your own words and a place to revisit how your view changes. |

## Related

- [Start with your first document](en.md).
- [Follow a practical research routine](research.en.md).
