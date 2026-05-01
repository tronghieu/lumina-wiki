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

CI runs all three across Node {20, 22} × {ubuntu, macos, windows}. Failure on any cell blocks merge.

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
