---
title: "Linux Installed-GUI Package Acceptance"
created: 2026-07-28
status: awaiting-execution-and-release-owner-attestation
platform: pending
candidate: "83d7e076156e40ff197867081ed744635bea53e6"
artifact_id: 8663091794
artifact_digest: "dd37a4da087c6ceeb50cf3d190805bbd580adbbf4c9d95b5ad3c8a7f901fb299"
acceptance_owner: pending
attested_at: pending
---

# Linux Installed-GUI Package Acceptance

This digest-bound report is ready for execution on a Linux candidate machine.
It is not acceptance evidence until every required item passes and the project
release owner replaces the pending frontmatter fields.

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

- [ ] Record distribution, version, desktop environment, display protocol, and
      architecture in `platform`.
- [ ] Install the digest-verified native package.
- [ ] Use a fresh test account or isolated home with no prior Lumina app state.
- [ ] Confirm Node, npm, Python, and the Lumina CLI are unavailable to the app.
- [ ] Fresh launch displays Welcome with no recent libraries.
- [ ] Create preview displays the exact destination before mutation.
- [ ] Create `Lumina Việt Runtime-Free` at a Unicode/space path.
- [ ] Create completes without an external runtime and displays a real empty
      graph with 0 notes, 0 documents, and 0 relationships.
- [ ] Close terminates the installed application.
- [ ] Relaunch requests the expected identity confirmation and restores the
      same library and Graph focus after confirmation.
- [ ] `Open existing library` uses the native folder picker and explicit
      workspace confirmation.
- [ ] A path/type/mode/content snapshot taken before and after Open is
      identical.
- [ ] App-private state and created library directories retain owner-only
      permissions.
- [ ] Record the snapshot digest and any screenshots or observations below.

## Observations

Pending execution.

## Release-Owner Attestation

- [ ] I personally executed or directly witnessed every required GUI item.
- [ ] I accept the observed Welcome, Create, Open, and close/relaunch behavior
      on Linux for this candidate and artifact.
- [ ] I set `platform`, `acceptance_owner`, `attested_at`, and
      `status: passed` above.

Signing remains outside this feature gate.
