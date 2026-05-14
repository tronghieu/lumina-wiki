# Security Policy

## Supported versions

Lumina-Wiki ships from `main`. We patch only the **latest minor release** on
npm. Older minor versions do not receive security backports — upgrade via
`npx lumina-wiki@latest install` to pick up fixes.

| Version | Supported |
|---------|-----------|
| 1.5.x   | ✅        |
| < 1.5   | ❌        |

The installer is idempotent and preserves user content (`wiki/`, `raw/`,
user-edited config sections), so upgrading is low-risk for end users.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.** Use one of the
two private channels below.

### Preferred: GitHub Private Vulnerability Reporting

1. Open the repo's **Security** tab on GitHub
2. Click **Report a vulnerability**
3. Fill in the form — it goes directly to the maintainer in a private thread

This is the fastest path and gives you status tracking, CVE assignment
support, and auto-credit in the published advisory if you wish.

### Email

If you prefer not to use GitHub:

- `tronghieu.luu@gmail.com`
- Subject line: `[lumina-wiki security]` plus a short summary

## What to include

- Affected version (`npm view lumina-wiki version` or `_lumina/manifest.json`)
- Affected component (installer, a fetcher, lint, a skill, etc.)
- Steps to reproduce — minimal repro is gold
- Impact assessment as you see it (data loss, RCE, SSRF, info disclosure, etc.)
- Proof-of-concept code, screenshots, or logs (sanitized)
- Suggested fix if you have one

## What you can expect

Lumina-Wiki is currently maintained by **one person** in their spare time.
We do not promise a fixed SLA, but the practical pattern is:

- **Acknowledgement**: best-effort within 7 days
- **Triage and severity assessment**: within 14 days of acknowledgement
- **Fix and patched release**: depends on severity (see below)
- **Public advisory**: published after the fix lands on npm

If you do not hear back within 14 days, ping again — the report may have
been missed.

## Severity guidance

We use rough CVSS-aligned bands:

| Band | Examples | Approx. fix target |
|---|---|---|
| **Critical** | RCE via installer, arbitrary file write outside the workspace, secret exfiltration | Hot fix on `main`, npm patch within days |
| **High** | SSRF bypass in fetchers, path traversal allowing read outside the project, supply-chain compromise of a runtime dep | Patch in next minor |
| **Medium** | DoS against a single workspace, info leak limited to public metadata | Patch in next minor |
| **Low / hardening** | Defense-in-depth improvements, robustness against malformed input that does not cross a trust boundary | Folded into the next feature release |

## In scope

The following surfaces are in scope for security reports:

- **The installer** (`bin/lumina.js`, `src/installer/**`) — atomic writes,
  symlink fallback, manifest read/write, template rendering, locale handling
- **Path safety** (`safePath()` in `src/installer/fs.js`) — anything that
  bypasses the rejection of `..`, absolute paths, drive letters, or backslash
  traversals
- **Fetchers and resolvers** (`src/tools/fetch_*.py`, `src/tools/resolve_pdf.py`)
  — SSRF guards, redirect re-validation, size caps, XXE rejection, filename
  hashing
- **Wiki engine** (`src/scripts/wiki.mjs`, `src/scripts/lint.mjs`) — anything
  that mutates the workspace based on user input
- **Skills and templates** (`src/skills/**`, `src/templates/**`) — shell or
  flag injection from user-supplied identifiers reaching `Bash` tool calls
- **Update check** — the optional `npm view` call (suppressible via
  `LUMINA_NO_UPDATE_CHECK=1`)
- **Supply chain** — runtime dependency vulnerabilities; we have no
  devDependencies, no postinstall, and no native modules by policy

## Out of scope

- **Local DoS against your own workspace** — for example, deleting files in
  your own `raw/` or pointing the installer at a path you don't own
- **The wiki content** — if you write something dangerous into your own
  `wiki/` pages, that is content, not a vulnerability
- **Performance regressions** that don't cross a trust boundary — file these
  as regular issues
- **Vulnerabilities in third-party services** Lumina-Wiki *talks to* (arXiv,
  Unpaywall, CORE, OpenAlex, S2, Wikipedia). Report those to the upstream
  provider directly
- **Vulnerabilities requiring a hostile maintainer** — if you can run
  arbitrary code as the user, you are already past every Lumina-Wiki control
- **Social engineering** against the maintainer or contributors

## Coordinated disclosure

If you want CVE assignment, we can request one through GitHub's CNA
relationship with MITRE when the advisory is published. Credit goes to the
reporter unless you ask to remain anonymous.

Please give us a reasonable window (typically 90 days, less for actively
exploited issues, more for issues that need coordinated multi-provider
fixes) before public disclosure. We will work with you on a timeline.

## Hall of fame

If you find and report a real vulnerability, we will list you here unless
you ask to remain anonymous. None yet — be the first.

---

**Last reviewed:** 2026-05.
