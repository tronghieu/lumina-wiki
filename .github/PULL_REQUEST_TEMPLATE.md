<!--
Thanks for contributing to Lumina-Wiki! A few seconds spent on this
template saves a few minutes per review for everyone.

If you have not read CONTRIBUTING.md, please skim it first:
https://github.com/tronghieu/lumina-wiki/blob/main/CONTRIBUTING.md
-->

## Summary

<!-- 1–3 sentences. What does this PR do, and why? -->

## Type of change

<!-- Tick all that apply. Each type has a checklist below — fill in the relevant ones, delete the rest. -->

- [ ] New / renamed / removed skill — see CONTRIBUTING §5.1
- [ ] New provider or fetcher (research pack) — see §5.2
- [ ] Schema or frontmatter change — see §5.3
- [ ] Installer change — see §5.4
- [ ] Entry-point stub change (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/) — see §5.5
- [ ] Docs only
- [ ] Bug fix
- [ ] Tests only
- [ ] Other (please explain in summary)

---

## Skill change checklist (delete if not applicable)

- [ ] `src/skills/<pack>/<name>/SKILL.md` with required frontmatter
- [ ] Registered in `src/installer/commands.js` `getSkillDefs()`
- [ ] **Row added to `src/templates/_lumina/schema/lumi-help.csv`** under the matching `{{#if pack_*}}` guard
- [ ] Skill table updated in `README.md`, `README.vi.md`, `README.zh.md`
- [ ] Skill table updated in `src/templates/README.md`, `src/templates/README.vi.md`, `src/templates/README.zh.md`
- [ ] `docs/user-guide/{en,vi,zh}.md` updated if the workflow changes
- [ ] `CHANGELOG.md` `[Unreleased]` entry added

## Fetcher / provider checklist (delete if not applicable)

- [ ] `_safe_url()` / `_safe_get()` on every outbound request, re-validated after each redirect hop
- [ ] `defusedxml` (with base-class exception) for any XML/HTML parsing
- [ ] Mid-stream size cap on binary downloads with `.tmp` cleanup
- [ ] Filename hashing for user-supplied identifiers (Windows reserved names safe)
- [ ] Added to `VALID_SOURCES` in both `watchlist-config.mjs` and `discover-runner.mjs`
- [ ] Provenance written through `buildSourceEntry()` / `build_source_entry()`
- [ ] Wired into the research-pack copy step in `commands.js`
- [ ] Node ↔ Python parity via the shared `id-cases.json` fixture

## Schema change checklist (delete if not applicable)

- [ ] `src/scripts/schemas.mjs` updated (single source of truth)
- [ ] `src/tools/id_utils.py` mirrored if the namespace is consumed by Python
- [ ] Additive only (or a migration path documented)
- [ ] `docs/project-context.md` §5 updated with a version stamp ("added 2026-MM")
- [ ] Lint check added in `src/scripts/lint.mjs` if invariants exist
- [ ] Migration note in `CHANGELOG.md` `[Unreleased]`
- [ ] Existing wikis still lint clean (or have a documented `/lumi-migrate-legacy` flow)

## Installer change checklist (delete if not applicable)

- [ ] 18-step numbering preserved
- [ ] All file writes through `atomicWrite`
- [ ] Symlink creation goes through the `symlink → junction → copy` ladder
- [ ] No new top-level imports in `bin/lumina.js` (lazy stays lazy)
- [ ] State files written last, atomically
- [ ] `npm run ci:idempotency` passes
- [ ] Cold-start median < 350 ms

---

## Trilingual docs

<!-- Required for any user-facing surface change. See CONTRIBUTING §6. -->

- [ ] N/A — no user-facing surface changed
- [ ] EN updated
- [ ] VI updated
- [ ] ZH updated
- [ ] One or two languages deferred to a follow-up — explain why and link the tracking issue

## Tests

- [ ] `npm run test:all` passes locally
- [ ] `npm run test:catalog` passes
- [ ] `npm run ci:idempotency` passes
- [ ] `npm run ci:package` passes
- [ ] Cold-start measured locally (`node scripts/measure-cold-start.mjs`) — paste result if cross-platform impact possible

## Rule deviations

<!--
If this PR deviates from a rule in docs/project-context.md or CONTRIBUTING.md,
call it out here with the rule number and the justification. Silent deviations
slow review down. Common examples: adding a top-level import, accepting a
cold-start regression, single-language docs.
-->

None.

## Related issues / PRs

<!-- Link issues this PR closes or relates to, e.g. "Closes #42". -->

---

<!--
By submitting this pull request, you agree your contribution is MIT-licensed
and you have read the Code of Conduct
(https://github.com/tronghieu/lumina-wiki/blob/main/CODE_OF_CONDUCT.md).
-->
