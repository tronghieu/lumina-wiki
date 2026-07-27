# Automated macOS Package Smoke

## Context

- Platform: macOS 26.5.2, Apple Silicon arm64
- Base commit: `f429421e0b66541ed6f622fb38363e7237419e7b`
- Source state: dirty implementation worktree
- Tooling: Wails `v3.0.0-alpha.78`, Go `1.25.12`
- Binary SHA-256: `4276b3bd55a9687f0ec35ff6a015d4e0c287fc3ccb46c4b76cda4093b532f1bf`

## Evidence

- `GOTOOLCHAIN=go1.25.12 wails3 package` completed successfully.
- The generated application passed strict deep ad-hoc code-signature verification.
- The `.app` was copied to a fresh temporary `Applications`-like directory.
- The copied executable remained alive for the required five-second smoke window.
- The captured runtime log contained zero bytes and was moved to Trash with the temporary copy.

## Boundary

This is local automated engineering evidence only. Existing Lumina Desktop
configuration was present on the machine, so this run does not prove clean
first launch. The source tree was not committed, so the digest is not eligible
for a release-owner acceptance report. Native GitHub Actions execution,
digest-bound installed-GUI interaction, signing, notarization, and trusted
distribution remain pending.
