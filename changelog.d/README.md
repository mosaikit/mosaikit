# Changelog fragments

A pull request that changes the product adds a file here instead of editing
[CHANGELOG.md](../CHANGELOG.md): pull requests then never conflict on the Unreleased section, and
they merge in any order.

The file is named after the requirement, `MK-093.md`, or a short slug for a change without one,
`fix-session-cookie.md`; a second fragment of the same requirement takes a suffix, `MK-093-api.md`.
It starts with a heading of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (`### Added`,
`### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or `### Security`) followed by the
entries, as list items written as they will read in the changelog:

```markdown
### Added

- Signed, expiring links to the files of extensions (MK-093): `POST /api/v1/files/{extension}/links`
  makes a link to a file ...
```

A fragment may hold more than one heading. `node build/changelog.ts check` validates the fragments
(the frontend tests do too). At release time `distribution/release/prepare.sh` runs
`node build/changelog.ts assemble`, which puts each entry at the top of its subsection of
`## [Unreleased]` and deletes the fragments (see
[docs/development/release.md](../docs/development/release.md)).
