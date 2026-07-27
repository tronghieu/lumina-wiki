---
title: "Automated Native Package Gates"
created: 2026-07-28
status: passed
candidate: "83d7e076156e40ff197867081ed744635bea53e6"
run: 30291654296
---

# Automated Native Package Gates

GitHub Actions run
[`30291654296`](https://github.com/nguyennguyenit/lumina-wiki/actions/runs/30291654296)
passed for release-candidate source
`83d7e076156e40ff197867081ed744635bea53e6`.

## Job Results

| Job | Job ID | Result |
|---|---:|---|
| Visual, accessibility, and Go gates | `90062613067` | success |
| Package / ubuntu-latest | `90062613181` | success |
| Package / macos-26 | `90062613184` | success |
| Package / windows-latest | `90062613208` | success |

The native package jobs ran the composed lifecycle/filesystem gate before
packaging. They then built the real application, verified the artifact,
installed the Windows/Linux packages or copied the macOS app to a fresh
Applications-like location, and passed the bounded launch smoke.

The Windows gate additionally passed native junction/reparse, 128-bit
filesystem identity, owner+SYSTEM DACL, cross-process lock, concurrent private
state, and clean-process Open coverage. The final fix preserves one exact
handle-based app-state protection policy across settings, history, and private
state instead of accepting broader Windows principals.

## Retained Artifacts

GitHub retains these artifacts until 2026-08-10. The API digest binds the
uploaded archive; inner hashes bind the downloaded package files.

| Artifact | Artifact ID | API SHA-256 | Size |
|---|---:|---|---:|
| `lumina-desktop-macOS` | `8663126635` | `ecf36b028ea7ed6c883d10b8d486e1e17c1650438f782c5f67b63aa14a53aecd` | 12,952,577 bytes |
| `lumina-desktop-Windows` | `8663101410` | `be6df085d6fa293d354f624c4057d8ead52f4f10c28d3bb937c5ded70d43deef` | 14,844,877 bytes |
| `lumina-desktop-Linux` | `8663091794` | `dd37a4da087c6ceeb50cf3d190805bbd580adbbf4c9d95b5ad3c8a7f901fb299` | 26,570,953 bytes |

### Inner SHA-256

| Platform file | SHA-256 |
|---|---|
| macOS `lumina-desktop.app/Contents/MacOS/lumina-desktop` | `e82f02fe282c3f712678379e09de743050ff846c88851a7822e722ae13255ad9` |
| macOS retained standalone `lumina-desktop` | `91cebf5f0b5c31f1e0409f167b32d87db6c3fbe26f585be0ee5056d8888b1895` |
| Windows `lumina-desktop-amd64-installer.exe` | `c93bb173729e22b7b11675d398f068b71a33029851ff7ef12cb4772ffcd26d22` |
| Windows `lumina-desktop.exe` | `76aa597e43355172aa894c7d5aed2195da158484c0323d8a850ffd18a02328da` |
| Linux `lumina-desktop.deb` | `cc65b6e1470defbb7183df0b2d69b8f6d5d87a7375ec2f8da49405631f1d1c8a` |
| Linux `lumina-desktop.rpm` | `33bcf98f1ef6f622a20c3cd84f01012ba568205b56e14d49491514b45e557822` |
| Linux `lumina-desktop.pkg.tar.zst` | `145a52488082c384be862e06de4ac13bfbb6cf30b193f0887353e6e934623c4e` |
| Linux retained standalone `lumina-desktop` | `20e40c399d96199e8f21afd94c921d97ee9ab6f8a2fa69511d56d2f2d6723c48` |

## Evidence Boundary

This completes automated cook evidence:

- composed Create/Open/continuity with external runtimes unavailable;
- native filesystem, identity, permission, and lock behavior;
- package construction, verification, installation or clean-location copy;
- bounded launch of each retained artifact.

It does not claim a human exercised Welcome, Create, Open, and close/relaunch
through each installed GUI. Phase 5 therefore remains in progress until the
release owner adds three
`package-acceptance-<os>-83d7e076156e40ff197867081ed744635bea53e6-<artifact-digest>.md`
reports. Signing and notarization remain a separate distribution boundary.
