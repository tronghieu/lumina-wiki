---
title: "Linux Installed-GUI Package Acceptance"
created: 2026-07-28
status: awaiting-release-owner-attestation
platform: "Ubuntu 24.04.4 LTS, Openbox/Xvfb X11, amd64"
candidate: "83d7e076156e40ff197867081ed744635bea53e6"
artifact_id: 8663091794
artifact_digest: "dd37a4da087c6ceeb50cf3d190805bbd580adbbf4c9d95b5ad3c8a7f901fb299"
acceptance_owner: pending
attested_at: pending
---

# Linux Installed-GUI Package Acceptance

The required GUI path below was executed by an agent on the digest-bound Linux
candidate. This report remains pending until the project release owner directly
witnesses or personally repeats the run and replaces the pending attestation
fields.

## Artifact Binding

- Source candidate:
  `83d7e076156e40ff197867081ed744635bea53e6`
- GitHub Actions run:
  [`30291654296`](https://github.com/nguyennguyenit/lumina-wiki/actions/runs/30291654296)
- Artifact: `lumina-desktop-Linux`, ID `8663091794`
- Artifact API SHA-256:
  `dd37a4da087c6ceeb50cf3d190805bbd580adbbf4c9d95b5ad3c8a7f901fb299`
- Debian package SHA-256:
  `cc65b6e1470defbb7183df0b2d69b8f6d5d87a7375ec2f8da49405631f1d1c8a`
- RPM package SHA-256:
  `33bcf98f1ef6f622a20c3cd84f01012ba568205b56e14d49491514b45e557822`
- Arch package SHA-256:
  `145a52488082c384be862e06de4ac13bfbb6cf30b193f0887353e6e934623c4e`
- Retained executable SHA-256:
  `20e40c399d96199e8f21afd94c921d97ee9ab6f8a2fa69511d56d2f2d6723c48`

Verify the package selected for the candidate distribution before installing:

```sh
sha256sum lumina-desktop.deb
# or: sha256sum lumina-desktop.rpm
# or: sha256sum lumina-desktop.pkg.tar.zst
```

The result must equal the matching digest above.

## Required GUI Checklist

- [x] Record distribution, version, desktop environment, display protocol, and
      architecture in `platform`.
- [x] Install the digest-verified native package.
- [x] Use a fresh test account or isolated home with no prior Lumina app state.
- [x] Confirm Node, npm, Python, and the Lumina CLI are unavailable to the app.
- [x] Fresh launch displays Welcome with no recent libraries.
- [x] Create preview displays the exact destination before mutation.
- [x] Create `Lumina Việt Runtime-Free` at a Unicode/space path.
- [x] Create completes without an external runtime and displays a real empty
      graph with 0 notes, 0 documents, and 0 relationships.
- [x] Close terminates the installed application.
- [x] Relaunch requests the expected identity confirmation and restores the
      same library and Graph focus after confirmation.
- [x] `Open existing library` uses the native folder picker and explicit
      workspace confirmation.
- [x] A path/type/mode/content snapshot taken before and after Open is
      identical.
- [x] App-private state and created library directories retain owner-only
      permissions.
- [x] Record the snapshot digest and any screenshots or observations below.

## Observations

Agent-driven execution completed on 2026-07-28 in a disposable OrbStack
Ubuntu amd64 machine:

- The installed Debian package reported `lumina-desktop 0.1.0-1`, architecture
  `amd64`, status `install ok installed`. Its installed executable SHA-256 was
  `20e40c399d96199e8f21afd94c921d97ee9ab6f8a2fa69511d56d2f2d6723c48`,
  matching the retained executable above.
- The app used a new isolated home and config directory. Its process environment
  had an empty-bin-only `PATH`; that directory contained no Node, npm, Python,
  Python 3, or Lumina CLI executable.
- Fresh launch showed Welcome with no recents. Create preview showed the exact
  destination ending in `Documents/Lumina Việt Runtime-Free`.
- Create reached the empty Knowledge graph with 0 notes, 0 documents, and
  0 relationships. The app-private state and created library roots were both
  mode `0700`.
- After close and process reconstruction, relaunch displayed the required
  workspace-identity confirmation. Continue restored the same library and
  Graph focus.
- Open used the GTK folder picker and the separate `Open Lumina workspace?`
  confirmation. The 174-entry path/type/mode/content snapshots before and
  after Open were byte-identical, each with SHA-256
  `051cdeaffc8ed55074ef1b6532c46dfb34f42fa8dc0c583144305ef86c771be7`.
- The installed app was closed after the run. A temporary local screenshot and
  snapshot bundle was retained as
  `/private/tmp/lumina-linux-acceptance-evidence-83d7e07.tar.gz`, SHA-256
  `5af2590849813477c1606239c9b7786fa5303963df4c26b0cf1f4879f7f37134`.

These observations are agent-generated evidence only. They do not satisfy the
release-owner attestation below.

## Release-Owner Attestation

- [ ] I personally executed or directly witnessed every required GUI item.
- [ ] I accept the observed Welcome, Create, Open, and close/relaunch behavior
      on Linux for this candidate and artifact.
- [ ] I set `platform`, `acceptance_owner`, `attested_at`, and
      `status: passed` above.

Signing remains outside this feature gate.
