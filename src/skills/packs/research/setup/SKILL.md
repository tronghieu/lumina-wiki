---
name: lumi-research-setup
description: >
  Configure the research pack runtime by checking Python dependencies and
  helping the user populate local API-key environment files.
allowed-tools:
  - Bash
  - Read
  - Write
---

# /lumi-research-setup

## Role

You prepare the local workspace to use research pack tools. This is runtime
setup for optional fetchers; it is not the Lumina installer.

## Context

Read `README.md` first. The installer may create `.env.example`, but it must not
create `.env` with secrets. This skill can help the user create or update `.env`
after they provide values.

## Instructions

1. Inspect `.env.example` and `_lumina/tools/requirements.txt`.
2. Check tool availability:

```bash
python3 _lumina/tools/init_discovery.py --help
python3 _lumina/tools/fetch_arxiv.py --help
python3 _lumina/tools/fetch_s2.py --help
python3 _lumina/tools/fetch_openalex.py --help
python3 _lumina/tools/fetch_unpaywall.py --help
python3 _lumina/tools/fetch_core.py --help
python3 _lumina/tools/fetch_deepxiv.py --help
python3 _lumina/tools/fetch_wikipedia.py --help
python3 _lumina/tools/resolve_pdf.py --help
```

3. Report missing optional keys by name only. Never print secret values. For
   each missing key, tell the user what the provider is for, whether it is
   required or optional, and where to register:

   | Key                          | Provider          | Required? | Register at                                          |
   |------------------------------|-------------------|-----------|------------------------------------------------------|
   | (none)                       | arXiv             | no key    | Public XML API at `export.arxiv.org` — no signup     |
   | `SEMANTIC_SCHOLAR_API_KEY`   | Semantic Scholar  | optional  | https://www.semanticscholar.org/product/api (request form; raises rate limits from ~100/5min to higher tier) |
   | `OPENALEX_API_KEY`           | OpenAlex          | optional  | https://openalex.org/settings/api (free key; enables the daily API budget and usage tracking). Report presence as "set" / "unset" only; never display the value. |
   | `UNPAYWALL_EMAIL`            | Unpaywall         | required for Unpaywall step in `resolve_pdf` ladder | Free — supply any email you own. The ladder skips Unpaywall gracefully when this is unset (the rest of the ladder still runs). |
   | `CORE_API_KEY`               | CORE              | optional  | https://core.ac.uk/services/api (free tier ≈1000 req/day). When unset, `resolve_pdf` skips CORE silently. On 429 the ladder skips CORE for the remainder of the run. |
   | `DEEPXIV_TOKEN`              | DeepXiv           | optional  | https://deepxiv.com (sign up, copy token from account settings; enables full-text PDF + semantic search) |

   Wikipedia fetcher uses the public REST API and needs no key.

4. If the user asks you to write `.env`, preserve existing keys and write only
   the provided values.
5. Run a harmless smoke check for the selected provider when credentials are
   available.

## Constraints

- Never commit, log, or display secret values.
- Do not mutate `wiki/` or `raw/`.
- Do not install system packages unless the user explicitly requests it.

## Definition of Done

- Tool help commands completed or failures are reported with the missing
  dependency/key by name only.
- `.env` is unchanged unless the user supplied values and asked you to write it.
- No `wiki/`, `raw/`, index, graph, or log files are changed.
