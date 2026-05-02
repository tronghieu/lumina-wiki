# Source Modes

Use this reference when choosing how `/lumi-research-discover` should seed a
candidate search. Do not invent flags beyond the commands shown here.

## Topic

Use `topic` when the user provides a subject area or question.

```bash
python3 _lumina/tools/init_discovery.py --topic "<topic>" --project-root . --phases 1,2,3 --fetchers arxiv,s2 --limit 20
```

Use `--resume` only when continuing existing
`_lumina/_state/discovery-*.json` checkpoints. Narrow phases deliberately:
phase 1 is keyword search, phase 2 is author backfill, phase 3 is citation
expansion.

## Anchor

Use `anchor` when the user provides a known paper, arXiv ID, Semantic Scholar ID,
DOI, or Wikipedia page. Use only supported subcommands:

```bash
python3 _lumina/tools/fetch_s2.py paper "<id>"
python3 _lumina/tools/fetch_s2.py citations "<id>" --limit 20
python3 _lumina/tools/fetch_s2.py references "<id>" --limit 20
python3 _lumina/tools/fetch_s2.py recommendations "<id>" --limit 10
python3 _lumina/tools/fetch_arxiv.py search "<query>" --max 20
python3 _lumina/tools/fetch_wikipedia.py page "<title>"
python3 _lumina/tools/fetch_wikipedia.py search "<query>" --limit 10
python3 _lumina/tools/fetch_deepxiv.py search "<query>" --limit 10
python3 _lumina/tools/fetch_deepxiv.py read "<arxiv_id>"
python3 _lumina/tools/fetch_deepxiv.py trending --limit 10
```

## From Wiki

Use `from-wiki` when the user wants discovery based on existing wiki context.
Inspect sources, concepts, and edges:

```bash
node _lumina/scripts/wiki.mjs list-entities
node _lumina/scripts/wiki.mjs read-meta <slug>
node _lumina/scripts/wiki.mjs read-edges --from <slug> --direction both
```

Extract topic words or anchor IDs from the wiki context, then run the supported
`topic` or `anchor` commands above. Do not pass wiki-derived values through
unsupported discovery flags.
