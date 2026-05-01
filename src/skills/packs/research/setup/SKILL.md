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
python3 _lumina/tools/fetch_deepxiv.py --help
python3 _lumina/tools/fetch_wikipedia.py --help
```

3. Report missing optional keys by name only. Never print secret values.
4. If the user asks you to write `.env`, preserve existing keys and write only
   the provided values.
5. Run a harmless smoke check for the selected provider when credentials are
   available.

## Constraints

- Never commit, log, or display secret values.
- Do not mutate `wiki/` or `raw/`.
- Do not install system packages unless the user explicitly requests it.
