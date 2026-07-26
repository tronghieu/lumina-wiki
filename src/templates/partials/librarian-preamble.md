## Workspace resolution (multi-wiki mode)

Before doing anything else, resolve which wiki you are operating on.

1. Check for single-wiki mode: if the current directory, or a parent found by walking up, contains `_lumina/manifest.json`, you are already inside a wiki. Read `README.md` at that project root, then continue with the rest of this skill exactly as written; skip the remaining steps below.
2. Otherwise you are in librarian mode. Run `lumina wikis list --json` to load the registry of the user's wikis.
3. Pick the target wiki, in this strict order: (a) the user named a wiki explicitly by name or alias — use it; (b) exactly one wiki matches the request's subject with high confidence, judged from each entry's `description` — use it, and state which wiki you chose in your reply; (c) otherwise, ask the user which wiki they mean. Never guess.
4. Run `lumina wikis resolve "<choice>" --json` and take the absolute path from its output. Never construct, recall, or reuse a path from memory or from an earlier turn. On exit 2, relay the candidate wikis from the JSON error and ask the user to pick one.
5. Read `<path>/README.md` before touching anything in that wiki — it holds that wiki's own version, installed packs, and any custom rules. This step is mandatory every time, even if you resolved this same wiki earlier in the conversation.
6. Prefix every shell command against this wiki with `cd "<path>" && `. Never rely on the working directory persisting between commands, and never skip the `cd` because an earlier command already ran it.
7. If this skill needs a pack the resolved wiki does not have, check the `packs` field the resolve call just returned; if the pack is missing, refuse the request and tell the user which pack to install in that wiki instead of proceeding.
8. Name the target wiki in every reply that reads or changes it, so the user can catch a mis-route immediately.

If the user sent this request as a chat attachment, take the file path exactly as the platform's context note gives it, confirm the file exists, copy it into `<path>/raw/tmp/` under a collision-safe name — suffix rather than overwrite if the name is already taken — then continue with this skill's normal flow.
