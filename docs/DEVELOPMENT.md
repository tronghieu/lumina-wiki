# Lumina-Wiki — Local Development Guide

How to develop and test the **installer itself** without going through `npx lumina-wiki install` against the public registry.

> Note: the user-facing `README.md` describes the workspace **after** install (`raw/`, `wiki/`, `/lumi-*`). This file is for contributors developing the installer / scripts / skills inside this repo.

---

## TL;DR — fastest dev loop

```bash
npm link                                  # one-time, in repo root
cd /tmp/anywhere && git init -q
lumina-wiki install --yes                 # uses your local source
```

Or, even faster (no global symlink):

```bash
npm run dev:sandbox                       # creates temp dir, installs, prints tree, cleans up
npm run dev:sandbox -- --keep             # keep the temp dir for inspection
npm run dev:sandbox -- --reuse            # reuse a fixed path: $TMPDIR/lumi-sandbox
npm run dev:sandbox -- --yes -- --packs core,research   # forward install flags
```

---

## 1. Run from source — no install, no link

The lowest-friction path. Just call `bin/lumina.js` with `cwd` pointing at a sandbox.

```bash
mkdir -p /tmp/test-lumina && cd /tmp/test-lumina
git init -q
node /absolute/path/to/lumina-wiki/bin/lumina.js install --yes
```

Edit code → re-run. No relinking, no repackaging.

`--yes` skips prompts (defaults). Drop it to exercise the `@clack/prompts` flow.

---

## 2. `npm link` — globally addressable like the published package

Closest to real `npx lumina-wiki install` UX while still pointing at local source.

```bash
# In the repo:
npm link

# Anywhere else:
cd /tmp/sandbox
lumina-wiki install     # also: lumina, lumi

# When done:
cd <repo> && npm unlink -g lumina-wiki
```

Code changes in `src/installer/` are picked up immediately — the global binary is a symlink to the repo.

---

## 3. `npm pack` — exercise the actual tarball

The most accurate simulation of what users will get from npm. Catches `files` allowlist mistakes, missing assets, accidental `postinstall`.

```bash
cd <repo>
npm pack                                          # → lumina-wiki-0.1.0.tgz

cd /tmp/test-lumina
npx /absolute/path/to/lumina-wiki-0.1.0.tgz install
# or:
npm install -g /absolute/path/to/lumina-wiki-0.1.0.tgz
lumina-wiki install
```

Slower because you must repack after every change. Use this before publishing.

---

## 4. The `dev:sandbox` script

Convenience harness that wraps cycle 1 with: temp dir creation, `git init`, install, tree print, cleanup.

```bash
npm run dev:sandbox                   # one-shot, auto-clean
npm run dev:sandbox -- --keep         # keep tmp dir for inspection
npm run dev:sandbox -- --reuse        # always use $TMPDIR/lumi-sandbox (stable path)
npm run dev:sandbox -- --packs core,research --ide claude_code
```

Anything after `--` (or that doesn't match `--keep` / `--reuse`) is forwarded to `lumina install`. By default, `--yes` is added.

---

## 5. Test harness — the same gates CI runs

Run before pushing:

```bash
npm run test:all           # node --test (installer + scripts) + pytest (tools)
npm run ci:idempotency     # install twice → git diff must be empty
npm run ci:package         # npm pack --dry-run, validate files allowlist + postinstall ban
```

CI runs all three on Node 24 × {ubuntu, macos, windows}. Failure on any cell blocks merge. `engines` still allows Node >= 20, which CI no longer exercises.

### What each gate catches

| Command | Catches |
|---|---|
| `test:installer` | Pure-unit + integration tests for `src/installer/*.js` (fs, manifest, template, update-check, commands) |
| `test:scripts` | `wiki.mjs` / `lint.mjs` / `reset.mjs` — schema invariants, idempotency, path safety |
| `test:python` | `src/tools/tests/` — fetcher contracts, env loading, prepare_source idempotency |
| `ci:idempotency` | Re-install drift across `wiki/`, `raw/`, `_lumina/`, all entry-point stubs |
| `ci:package` | Missing required files, prohibited test/state files in tarball, `postinstall` script presence |

### Per-module quick tests

```bash
npm run test:fs            # filesystem helpers
npm run test:manifest      # manifest read/write + CSV escaping
npm run test:template      # {{var}} + {{#if}} + schema region
npm run test:update        # update-check timeouts
```

---

## 6. Releasing — `latest` and pre-release channels

Publishing is tag-driven: pushing a `v*` tag runs `.github/workflows/publish.yml`, which re-runs the gates against the tagged commit, publishes to npm, and opens a GitHub Release from the matching `CHANGELOG.md` entry.

Publish from that workflow, never from a laptop. `npm publish` runs with `--provenance`, which signs the tarball with the workflow's OIDC identity so npm can attest which repository, commit and run built it. A publish run anywhere else cannot produce that attestation: npm does not refuse it, but the package lands with no provenance, which is visible on npmjs.com and to `npm audit signatures`.

The npm dist-tag is derived from the version itself — the workflow never takes it as an input:

| `package.json` version | git tag | npm dist-tag | GitHub Release |
|---|---|---|---|
| `1.14.0` | `v1.14.0` | `latest` | normal |
| `1.14.0-next.0` | `v1.14.0-next.0` | `next` | pre-release |
| `1.14.0-rc.1` | `v1.14.0-rc.1` | `rc` | pre-release |

A version with a pre-release identifier publishes to a channel of that name and **leaves `latest` untouched**, so nobody running `npx lumina-wiki install` is affected. Build metadata is not part of the channel (`1.14.0+build-next` is a stable release, not a `next` one). An identifier the workflow cannot read as a channel — empty, uppercase, purely numeric, literally `latest`, or one npm itself refuses because it parses as a version range (`x`, `v1`) — fails the job rather than guessing.

### A bump is not a release

Merging a `chore(release):` commit does nothing on its own. The tag is what
publishes — `publish.yml` triggers on `push: tags: v*` and on nothing else. A
bumped `package.json` and a written `CHANGELOG.md` entry sitting on `main`
with no tag behind them read exactly like a shipped release and are not one.

This has already happened twice. **1.11.0** (2026-07-27) and **1.12.0**
(2026-08-12) were each bumped, documented and merged, and neither was ever
tagged, so neither reached npm: `latest` sat on 1.10.1 for over a month while
the repo read as though two releases had shipped. Their content first reached
users in `1.13.0-next.0`. Both commits now carry an annotated
`archive/<version>` tag recording what happened; those deliberately sit
outside the `v*` namespace so they never trigger a publish.

Finish every release by confirming the channel actually moved. Both checks
have to query a remote — a tag that exists only on your laptop is the exact
failure being guarded against, and `git tag --list` would report it as
present:

```bash
npm view lumina-wiki dist-tags
git ls-remote --tags origin 'v*' | grep -v '\^{}'
```

The version you just bumped has to appear in **both**. Missing from
`ls-remote` means the tag never reached GitHub, so `publish.yml` never ran.
Present there but missing from `dist-tags` means the workflow ran and failed
— read its log rather than re-tagging.

Do not re-tag an old release commit to catch up: `publish.yml` reads the
version from that commit's `package.json`, so the job would pass its own
check and push a months-old build — bugs included — straight to `latest`.
Roll the missed content into the next version instead, which is what
1.13.0-next.0 did.

### Cutting a pre-release

```bash
# 1.14.0-next.0, .next.1, … as many as the change needs
npm version 1.14.0-next.0 --no-git-tag-version
git commit -am "chore(release): 1.14.0-next.0"
git tag v1.14.0-next.0
git push origin main --tags
```

Testers then run:

```bash
npx lumina-wiki@next install
```

When the change is ready, bump to the plain `1.14.0`, tag it, and the same workflow moves `latest`.

### What pre-release users see

`checkForUpdate()` always queries the `latest` dist-tag, and `isNewerVersion()` follows semver precedence — a stable release outranks the pre-release that led to it. So someone on `1.14.0-next.0` is nudged to upgrade the moment `1.14.0` ships, but is not nagged while only pre-releases exist. They are *not* notified about a newer build within the same channel; re-running `npx lumina-wiki@next install` is the way to pick that up.

### Before tagging anything

Prefer `npm pack` (cycle 3 above) over a pre-release for a change you can verify yourself. A pre-release is for putting a build in *someone else's* hands; the tarball is faster and leaves no published artifact behind.

---

## Testing AI-agent global installs (`--agents`)

`--agents openclaw` / `--agents hermes` write skills into a **global**, user-level skills directory (see `docs/specs/spec-librarian-mode/platform-integration.md` for the exact paths per platform), not into a project. That means a careless manual test can drop files into your real home directory.

- **Never run `--agents ...` against your real `$HOME`** during development unless you mean to. Any manual check needs an overridden `HOME` (or platform-equivalent env var) pointed at a scratch directory first.
- Prefer the automated coverage instead of manual runs: `commands-agents.test.js` (run via `npm run test:installer:commands-agents`, folded into `npm run test:installer`) spawns the CLI with `HOME` redirected to a temp directory per test, so it's always safe to run and is the fastest way to check a change to the agent-install path.
- Two CI gates guard this surface specifically:
  - `npm run ci:agent-isolation` — proves the installer never deletes or overwrites a foreign skill already sitting in the target skills directory (global or project-level), and that removal only ever touches previously-installed `lumi-*` entries.
  - `test:e2e` — an end-to-end pass over the full agent-install flow; check `package.json` for whether this script is wired up yet before relying on it locally.

---

## Recommended dev loop

```bash
# Terminal 1 — repo
cd /Users/luutronghieu/Projects/lumina-wiki

# Terminal 2 — fast iteration
npm run dev:sandbox -- --reuse                  # ← inspect on each run
# or
npm link && cd /tmp/sandbox && lumina-wiki install --yes
```

Before push:

```bash
npm run test:all && npm run ci:idempotency && npm run ci:package
```

---

## Common pitfalls

- **Forgetting `git init` in the sandbox** — idempotency tests need git to compute diffs. The `dev:sandbox` script does this for you.
- **Running `lumina-wiki install` inside the repo itself** — the installer will scaffold a wiki workspace on top of the source code. Always use a sandbox dir.
- **Stale `npm link`** — if `lumina-wiki` global command points at an old clone, `npm unlink -g lumina-wiki` and re-link from the current repo.
- **macOS `pip install pytest` failures under `npm run test:python`** — install pytest globally once: `pip3 install pytest pypdf requests`.
- **Editing `wiki.mjs` and forgetting `schemas.mjs`** — `schemas.mjs` is the single source of truth. Update it first, then `wiki.mjs` and `lint.mjs` consume the change.
- **`--packs core` is not what selects "core only"** — `core` is always force-inserted; `--packs research` means "core + research". You cannot exclude `core`.
